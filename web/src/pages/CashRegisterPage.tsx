import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";

interface Session {
  id: string;
  status: "OPEN" | "CLOSED";
  openingFloat: string | number;
  closingCounted: string | number | null;
  expectedCash: string | number | null;
  variance: string | number | null;
  openedAt: string;
  closedAt: string | null;
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

export function CashRegisterPage() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [history, setHistory] = useState<Session[]>([]);
  const [openingFloat, setOpeningFloat] = useState("");
  const [closingCounted, setClosingCounted] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const [current, hist] = await Promise.all([
      api.get<Session | null>("/api/cash-register/current"),
      api.get<Session[]>("/api/cash-register/history"),
    ]);
    setSession(current);
    setHistory(hist);
  }

  useEffect(() => {
    void load();
  }, []);

  async function openRegister(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/cash-register/open", { openingFloat: Number(openingFloat) });
      setOpeningFloat("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't open register");
    }
  }

  async function closeRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    setError(null);
    try {
      await api.post(`/api/cash-register/${session.id}/close`, { closingCounted: Number(closingCounted) });
      setClosingCounted("");
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't close register");
    }
  }

  return (
    <>
      <Topbar title="Cash Register" subtitle="Open and close your shift, reconcile cash" />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
        <Card className="max-w-md">
          {session === undefined && <div className="text-sm text-brand-inkMuted">Loading…</div>}

          {session === null && (
            <form onSubmit={openRegister} className="flex flex-col gap-3">
              <div className="font-display text-[15px] font-bold text-brand-ink">Open register</div>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-brand-ink">Opening float (cash in drawer)</span>
                <input
                  required
                  type="number"
                  min="0"
                  value={openingFloat}
                  onChange={(e) => setOpeningFloat(e.target.value)}
                  className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm"
                />
              </label>
              {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
              <Button type="submit">Open register</Button>
            </form>
          )}

          {session && session.status === "OPEN" && (
            <form onSubmit={closeRegister} className="flex flex-col gap-3">
              <div className="font-display text-[15px] font-bold text-brand-ink">Close register</div>
              <div className="text-sm text-brand-inkMuted">
                Opened {new Date(session.openedAt).toLocaleString("en-KE")} with {currencyFmt.format(Number(session.openingFloat))} float
              </div>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-brand-ink">Cash counted in drawer now</span>
                <input
                  required
                  type="number"
                  min="0"
                  value={closingCounted}
                  onChange={(e) => setClosingCounted(e.target.value)}
                  className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm"
                />
              </label>
              {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
              <Button type="submit" variant="danger">
                Close register
              </Button>
            </form>
          )}
        </Card>

        <Card>
          <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Shift history</div>
          <div className="grid grid-cols-5 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
            <span>OPENED</span>
            <span>FLOAT</span>
            <span>EXPECTED</span>
            <span>COUNTED</span>
            <span>VARIANCE</span>
          </div>
          {history.map((s) => (
            <div key={s.id} className="grid grid-cols-5 items-center border-b border-brand-border/60 py-2.5 text-sm">
              <span>{new Date(s.openedAt).toLocaleDateString("en-KE")}</span>
              <span>{currencyFmt.format(Number(s.openingFloat))}</span>
              <span>{s.expectedCash != null ? currencyFmt.format(Number(s.expectedCash)) : "—"}</span>
              <span>{s.closingCounted != null ? currencyFmt.format(Number(s.closingCounted)) : "—"}</span>
              <span className={Number(s.variance) < 0 ? "font-semibold text-brand-warn" : "font-semibold text-brand-accentText"}>
                {s.variance != null ? currencyFmt.format(Number(s.variance)) : "—"}
              </span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
