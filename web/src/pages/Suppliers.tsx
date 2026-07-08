import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";

interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  balance: string | number;
}

interface SupplierTransaction {
  id: string;
  type: "PURCHASE" | "PAYMENT";
  amount: string | number;
  description: string | null;
  createdAt: string;
  recordedBy: { name: string };
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });
const emptyForm = { name: "", phone: "", email: "", address: "" };

export function Suppliers() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Supplier | null>(null);
  const [transactions, setTransactions] = useState<SupplierTransaction[]>([]);
  const [txForm, setTxForm] = useState({ type: "PURCHASE" as "PURCHASE" | "PAYMENT", amount: "", description: "" });

  async function load() {
    setSuppliers(await api.get<Supplier[]>("/api/suppliers"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function openSupplier(supplier: Supplier) {
    setSelected(supplier);
    setTransactions(await api.get<SupplierTransaction[]>(`/api/suppliers/${supplier.id}/transactions`));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/suppliers", form);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save supplier");
    }
  }

  async function recordTransaction(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setError(null);
    try {
      await api.post(`/api/suppliers/${selected.id}/transactions`, {
        type: txForm.type,
        amount: Number(txForm.amount),
        description: txForm.description || undefined,
      });
      setTxForm({ type: "PURCHASE", amount: "", description: "" });
      await load();
      const updated = await api.get<Supplier[]>("/api/suppliers");
      const fresh = updated.find((s) => s.id === selected.id);
      if (fresh) await openSupplier(fresh);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record transaction");
    }
  }

  return (
    <>
      <Topbar title="Suppliers" subtitle={`${suppliers.length} suppliers`} />
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:flex-row lg:overflow-hidden lg:p-8">
        <div className="flex w-full flex-col gap-4 lg:max-w-md lg:overflow-auto">
          <div className="flex justify-end">
            <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add supplier"}</Button>
          </div>

          {showForm && (
            <Card>
              <form onSubmit={handleSubmit} className="flex flex-col gap-3">
                <input required placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
                <input placeholder="Phone" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
                <input placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
                <input placeholder="Address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
                {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
                <Button type="submit">Save supplier</Button>
              </form>
            </Card>
          )}

          <Card className="flex flex-col gap-1 p-2">
            {suppliers.map((s) => (
              <button
                key={s.id}
                onClick={() => void openSupplier(s)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-brand-bg ${selected?.id === s.id ? "bg-brand-bg" : ""}`}
              >
                <div>
                  <div className="text-sm font-semibold text-brand-ink">{s.name}</div>
                  <div className="text-xs text-brand-inkMuted">{s.phone ?? "No phone"}</div>
                </div>
                <span className={`text-sm font-bold ${Number(s.balance) > 0 ? "text-brand-warn" : "text-brand-accentText"}`}>
                  {currencyFmt.format(Number(s.balance))}
                </span>
              </button>
            ))}
          </Card>
        </div>

        {selected && (
          <Card className="flex flex-1 flex-col gap-4 lg:overflow-auto">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-display text-lg font-bold text-brand-ink">{selected.name}</div>
                <div className="text-sm text-brand-inkMuted">
                  Balance owed: <span className="font-bold text-brand-warn">{currencyFmt.format(Number(selected.balance))}</span>
                </div>
              </div>
            </div>

            <form onSubmit={recordTransaction} className="flex flex-wrap items-end gap-3 border-b border-brand-border pb-4">
              <label className="text-sm">
                <span className="mb-1 block font-medium text-brand-ink">Type</span>
                <select value={txForm.type} onChange={(e) => setTxForm({ ...txForm, type: e.target.value as "PURCHASE" | "PAYMENT" })} className="rounded-lg border border-brand-border px-3 py-2">
                  <option value="PURCHASE">Purchase (increases balance)</option>
                  <option value="PAYMENT">Payment (reduces balance)</option>
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-brand-ink">Amount (KSh)</span>
                <input required type="number" min="0" step="0.01" value={txForm.amount} onChange={(e) => setTxForm({ ...txForm, amount: e.target.value })} className="w-32 rounded-lg border border-brand-border px-3 py-2" />
              </label>
              <label className="flex-1 text-sm">
                <span className="mb-1 block font-medium text-brand-ink">Description</span>
                <input value={txForm.description} onChange={(e) => setTxForm({ ...txForm, description: e.target.value })} className="w-full rounded-lg border border-brand-border px-3 py-2" />
              </label>
              <Button type="submit">Record</Button>
            </form>

            <div className="flex flex-col gap-2">
              {transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-[10px] bg-brand-bg px-3 py-2.5 text-sm">
                  <div>
                    <span className={`mr-2 font-bold ${t.type === "PURCHASE" ? "text-brand-warn" : "text-brand-accentText"}`}>
                      {t.type === "PURCHASE" ? "+" : "-"}{currencyFmt.format(Number(t.amount))}
                    </span>
                    <span className="text-brand-inkMuted">{t.description ?? t.type}</span>
                  </div>
                  <span className="text-xs text-brand-inkMuted">
                    {new Date(t.createdAt).toLocaleDateString("en-KE")} · {t.recordedBy.name}
                  </span>
                </div>
              ))}
              {transactions.length === 0 && <div className="text-sm text-brand-inkMuted">No transactions yet.</div>}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
