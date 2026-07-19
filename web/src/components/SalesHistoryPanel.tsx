import { useEffect, useMemo, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "../lib/paymentMethods";
import type { SaleHistoryRow } from "../types/reports";
import { Card } from "./ui";

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

// Calendar-day key in the viewer's local timezone (not UTC), so a sale made
// at 11pm and one made just after midnight land in different day groups
// exactly when a human would expect, not when UTC happens to roll over.
function dayKeyFor(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Renders a "YYYY-MM-DD" day key as a full local date label — used for the
// empty state when a date picked on the calendar has no sales. Parsed as
// y/m/d components (not `new Date(dayKey)`) so it's built from the same
// local-calendar-day meaning as dayKeyFor, not reinterpreted as UTC midnight.
function formatDayKey(dayKey: string): string {
  const [year, month, day] = dayKey.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString("en-KE", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

interface SalesHistoryPanelProps {
  cashierId: string;
  employeeName: string;
  // Shown under the "Sales history" heading — defaults to a line that makes
  // sense for the Reports "Employees" drill-down; pass something else (or
  // omit) for the self-service "My Sales" context.
  description?: string;
  // Present only for the Reports drill-down, which can be collapsed back
  // into the employee list. The self-service page has nothing to collapse
  // into, so it omits this and no ✕ renders.
  onClose?: () => void;
}

// A single employee's complete sale-by-sale history: a payment-method
// filter, a calendar date picker (jumping straight to any day instead of
// scrolling a mixed list), and a tap-to-expand line-item + customer
// breakdown per sale. Shared between the Reports "Employees" tab (any
// employee an admin/manager selects) and the self-service "My Sales" page
// (every employee's own history, permission-free — see GET /api/sales'
// server-side scoping for the authorization half of that).
export function SalesHistoryPanel({ cashierId, employeeName, description, onClose }: SalesHistoryPanelProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "ADMIN";
  const [sales, setSales] = useState<SaleHistoryRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentFilter, setPaymentFilter] = useState<PaymentMethod | "">("");
  // Which row is expanded to show its line items + customer — at most one
  // at a time, collapsed by default so the table stays scannable.
  const [expandedSaleId, setExpandedSaleId] = useState<string | null>(null);

  useEffect(() => {
    setExpandedSaleId(null);
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ cashierId });
    if (paymentFilter) params.set("paymentMethod", paymentFilter);
    api
      .get<SaleHistoryRow[]>(`/api/sales?${params.toString()}`)
      .then((rows) => {
        if (!cancelled) setSales(rows);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : "Couldn't load sales history");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [cashierId, paymentFilter]);

  // Groups the (already newest-first) sales history into per-day sections —
  // a long-tenured employee's "complete history" can span months, so a
  // calendar picker below jumps straight to a day instead of scrolling
  // through every day at once.
  const salesByDay = useMemo(() => {
    const todayKey = dayKeyFor(new Date());
    const yesterdayKey = dayKeyFor(new Date(Date.now() - 86_400_000));
    const groups = new Map<string, SaleHistoryRow[]>();
    for (const s of sales) {
      const key = dayKeyFor(new Date(s.createdAt));
      (groups.get(key) ?? groups.set(key, []).get(key)!).push(s);
    }
    return Array.from(groups.entries()).map(([dayKey, daySales]) => ({
      dayKey,
      dayLabel:
        dayKey === todayKey
          ? "Today"
          : dayKey === yesterdayKey
            ? "Yesterday"
            : new Date(daySales[0].createdAt).toLocaleDateString("en-KE", {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric",
              }),
      sales: daySales,
    }));
  }, [sales]);

  // Which day's sales are on screen. Snaps to the most recent day whenever
  // the underlying sales change (a different employee, or the payment
  // filter changes what's in range).
  const [selectedDayKey, setSelectedDayKey] = useState<string | null>(null);
  useEffect(() => {
    setSelectedDayKey(salesByDay[0]?.dayKey ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sales]);
  const activeDay = salesByDay.find((g) => g.dayKey === selectedDayKey) ?? null;

  // Admin-only: how the selected day's total breaks down by payment method
  // — scoped to whichever day the date picker above has on screen (plus
  // whatever payment filter is applied), not the employee's entire history.
  // Not shown to the employee viewing their own history via "My Sales".
  const paymentTotals = useMemo(() => {
    if (!isAdmin || !activeDay) return [];
    const totals = new Map<string, { total: number; count: number }>();
    for (const s of activeDay.sales) {
      const entry = totals.get(s.paymentMethod) ?? { total: 0, count: 0 };
      entry.total += Number(s.total);
      entry.count += 1;
      totals.set(s.paymentMethod, entry);
    }
    return Array.from(totals.entries())
      .map(([method, v]) => ({ method, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [activeDay, isAdmin]);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="font-display text-[15px] font-bold text-brand-ink">Sales history</div>
          <div className="text-xs text-brand-inkMuted">
            {description ?? `${employeeName} · complete history, not limited to any period filter`}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {salesByDay.length > 0 && (
            <input
              type="date"
              value={selectedDayKey ?? ""}
              min={salesByDay[salesByDay.length - 1]?.dayKey}
              max={salesByDay[0]?.dayKey}
              onChange={(e) => setSelectedDayKey(e.target.value || null)}
              aria-label="Pick a date"
              className="rounded-lg border border-brand-border px-3 py-2 text-sm"
            />
          )}
          <select
            value={paymentFilter}
            onChange={(e) => setPaymentFilter(e.target.value as PaymentMethod | "")}
            className="rounded-lg border border-brand-border px-3 py-2 text-sm"
          >
            <option value="">All payment methods</option>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABELS[m]}
              </option>
            ))}
          </select>
          {onClose && (
            <button onClick={onClose} aria-label="Close sales history" className="text-sm text-brand-inkMuted hover:text-brand-ink">
              ✕
            </button>
          )}
        </div>
      </div>

      {isAdmin && !loading && !error && paymentTotals.length > 0 && (
        <div className="flex flex-col gap-2 border-b border-brand-border pb-3">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-brand-inkMuted">
            Payment totals — {activeDay?.dayLabel}
          </div>
          <div className="flex flex-wrap gap-2">
            {paymentTotals.map((t) => (
              <div key={t.method} className="rounded-lg bg-brand-bg px-3 py-2">
                <div className="text-[10.5px] font-semibold uppercase tracking-wide text-brand-inkMuted">
                  {PAYMENT_METHOD_LABELS[t.method as PaymentMethod] ?? t.method}
                </div>
                <div className="text-sm font-bold text-brand-ink">{currencyFmt.format(t.total)}</div>
                <div className="text-[11px] text-brand-inkMuted">
                  {t.count} sale{t.count === 1 ? "" : "s"}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
      {!error && loading && <div className="text-sm text-brand-inkMuted">Loading…</div>}
      {!error && !loading && activeDay && (
        <div className="overflow-x-auto">
          <div className="min-w-[600px]">
            <div className="mb-1.5 flex items-baseline gap-2 rounded-md bg-brand-bg px-2 py-1.5">
              <span className="text-[12.5px] font-bold text-brand-ink">{activeDay.dayLabel}</span>
              <span className="text-[11px] text-brand-inkMuted">
                {activeDay.sales.length} sale{activeDay.sales.length === 1 ? "" : "s"} ·{" "}
                {currencyFmt.format(activeDay.sales.reduce((sum, s) => sum + Number(s.total), 0))}
              </span>
            </div>
            <div className="grid grid-cols-[0.7fr_0.7fr_0.9fr_1.1fr_0.9fr] gap-2 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
              <span>TIME</span>
              <span>ITEMS</span>
              <span>TOTAL</span>
              <span>PAYMENT</span>
              <span>STATUS</span>
            </div>
            {activeDay.sales.map((s) => {
              const createdAt = new Date(s.createdAt);
              const expanded = expandedSaleId === s.id;
              return (
                <div key={s.id} className="border-b border-brand-border/60">
                  <button
                    onClick={() => setExpandedSaleId(expanded ? null : s.id)}
                    aria-expanded={expanded}
                    className={`grid w-full grid-cols-[0.7fr_0.7fr_0.9fr_1.1fr_0.9fr] items-center gap-2 py-2.5 text-left text-sm hover:bg-brand-bg ${
                      expanded ? "bg-brand-bg" : ""
                    }`}
                  >
                    <span className="text-brand-inkMuted">{createdAt.toLocaleTimeString("en-KE", { hour: "numeric", minute: "2-digit" })}</span>
                    <span>{s.items.reduce((n, i) => n + i.quantity, 0)}</span>
                    <span className="font-semibold text-brand-ink">{currencyFmt.format(Number(s.total))}</span>
                    <span className="text-brand-inkMuted">{PAYMENT_METHOD_LABELS[s.paymentMethod as PaymentMethod] ?? s.paymentMethod}</span>
                    <span className="w-fit rounded-full bg-brand-accent/20 px-2.5 py-1 text-[11.5px] font-bold text-brand-accentText">
                      {s.status}
                    </span>
                  </button>
                  {expanded && (
                    <div className="mb-2 rounded-lg bg-brand-bg px-3 py-3 text-sm">
                      <div className="mb-2 text-xs font-semibold text-brand-inkMuted">
                        Sold to <span className="text-brand-ink">{s.customer?.name ?? "Walk-in customer (no name recorded)"}</span>
                      </div>
                      <div className="grid grid-cols-[2fr_0.6fr_0.9fr_0.9fr] gap-2 border-b border-brand-border/60 pb-1.5 text-[11px] font-semibold text-brand-inkMuted">
                        <span>ITEM</span>
                        <span>QTY</span>
                        <span>UNIT PRICE</span>
                        <span>LINE TOTAL</span>
                      </div>
                      {s.items.map((item) => (
                        <div key={item.id} className="grid grid-cols-[2fr_0.6fr_0.9fr_0.9fr] gap-2 border-b border-brand-border/40 py-1.5 text-[13px]">
                          <span className="text-brand-ink">{item.name}</span>
                          <span className="text-brand-inkMuted">{item.quantity}</span>
                          <span className="text-brand-inkMuted">{currencyFmt.format(Number(item.unitPrice))}</span>
                          <span className="font-semibold text-brand-ink">{currencyFmt.format(Number(item.lineTotal))}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
      {!error && !loading && !activeDay && (
        <div className="py-6 text-sm text-brand-inkMuted">
          {sales.length === 0
            ? `No sales${paymentFilter ? ` paid by ${PAYMENT_METHOD_LABELS[paymentFilter]}` : ""} yet.`
            : `No sales${paymentFilter ? ` paid by ${PAYMENT_METHOD_LABELS[paymentFilter]}` : ""} on ${
                selectedDayKey ? formatDayKey(selectedDayKey) : "this date"
              }.`}
        </div>
      )}
      {!error && !loading && activeDay && (
        <div className="text-xs text-brand-inkMuted">Tap a sale to see the items sold and which customer it went to.</div>
      )}
    </Card>
  );
}
