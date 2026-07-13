import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";

interface Store {
  name: string;
  address: string | null;
  phone: string | null;
  currency: string;
}

const RESET_CONFIRM_PHRASE = "DELETE";

interface ResetResult {
  mpesaTransactions: number;
  sales: number;
  stockAdjustments: number;
  registerSessions: number;
  creditPayments: number;
  customers: number;
  supplierTransactions: number;
  suppliers: number;
  expenses: number;
  expenseCategories: number;
  incomes: number;
  promotions: number;
  coupons: number;
  products: number;
  categories: number;
}

function ResetDataSection() {
  const [confirmText, setConfirmText] = useState("");
  const [resetting, setResetting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ResetResult | null>(null);

  async function handleReset() {
    if (confirmText !== RESET_CONFIRM_PHRASE) return;
    const confirmed = window.confirm(
      "This permanently deletes all products, stock, sales, cash register history, customers, suppliers, expenses, income, promotions, and coupons for this store. Employee accounts and these store settings are kept. This cannot be undone — continue?"
    );
    if (!confirmed) return;

    setResetting(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.post<{ deleted: ResetResult }>("/api/settings/reset-data", { confirm: "DELETE" });
      setResult(res.deleted);
      setConfirmText("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't reset data — check your connection and try again.");
    } finally {
      setResetting(false);
    }
  }

  return (
    <Card className="max-w-lg border-brand-warn/40 bg-brand-warnBg/30">
      <div className="mb-1 font-display text-[15px] font-bold text-brand-warn">Reset store data</div>
      <p className="mb-3 text-sm text-brand-inkMuted">
        Permanently deletes all products, stock, sales, cash register history, customers, suppliers, expenses, income,
        promotions, and coupons — useful for clearing out test data before you start selling for real. Employee accounts
        and these store settings are kept. This cannot be undone.
      </p>
      <label className="mb-3 block text-sm">
        <span className="mb-1 block font-medium text-brand-ink">Type DELETE to confirm</span>
        <input
          value={confirmText}
          onChange={(e) => setConfirmText(e.target.value)}
          placeholder="DELETE"
          className="w-full rounded-lg border border-brand-border px-3 py-2"
        />
      </label>
      {error && <div className="mb-3 text-sm font-medium text-brand-warn">{error}</div>}
      {result && (
        <div className="mb-3 rounded-lg bg-white px-3 py-2 text-sm text-brand-ink">
          Deleted {result.products} products, {result.sales} sales, {result.customers} customers, {result.suppliers}{" "}
          suppliers, and all related records. Employees and store settings were kept.
        </div>
      )}
      <Button variant="danger" disabled={confirmText !== RESET_CONFIRM_PHRASE || resetting} onClick={() => void handleReset()}>
        {resetting ? "Resetting…" : "Permanently reset store data"}
      </Button>
    </Card>
  );
}

export function Settings() {
  const [form, setForm] = useState<Store | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void api.get<Store>("/api/settings").then(setForm);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    await api.put("/api/settings", form);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  if (!form) return null;

  return (
    <>
      <Topbar title="Settings" subtitle="Store profile and currency" />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-4 sm:p-6 lg:p-8">
        <Card className="max-w-lg">
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Store name</span>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="w-full rounded-lg border border-brand-border px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Address</span>
              <input value={form.address ?? ""} onChange={(e) => setForm({ ...form, address: e.target.value })} className="w-full rounded-lg border border-brand-border px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Phone</span>
              <input value={form.phone ?? ""} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="w-full rounded-lg border border-brand-border px-3 py-2" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Currency</span>
              <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} className="w-full rounded-lg border border-brand-border px-3 py-2" />
            </label>
            {saved && <div className="text-sm font-medium text-brand-accentText">Saved.</div>}
            <Button type="submit" className="w-fit">
              Save settings
            </Button>
          </form>
        </Card>

        <ResetDataSection />
      </div>
    </>
  );
}
