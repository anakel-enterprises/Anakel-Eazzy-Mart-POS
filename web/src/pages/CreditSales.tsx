import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";

interface CreditCustomer {
  id: string;
  name: string;
  phone: string | null;
  creditLimit: string | number;
  creditBalance: string | number;
  oldestDueDate: string | null;
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

function isOverdue(dueDate: string | null) {
  return !!dueDate && new Date(dueDate) < new Date();
}

export function CreditSales() {
  const [customers, setCustomers] = useState<CreditCustomer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [amount, setAmount] = useState("");

  async function load() {
    setCustomers(await api.get<CreditCustomer[]>("/api/customers/credit"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function recordPayment(customerId: string) {
    setError(null);
    try {
      await api.post(`/api/customers/${customerId}/payments`, { amount: Number(amount) });
      setAmount("");
      setPayingId(null);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record payment");
    }
  }

  const totalOutstanding = customers.reduce((sum, c) => sum + Number(c.creditBalance), 0);

  return (
    <>
      <Topbar title="Credit Sales" subtitle={`${currencyFmt.format(totalOutstanding)} outstanding across ${customers.length} customers`} />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6 lg:p-8">
        {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
        <Card>
          <div className="overflow-x-auto">
            <div className="min-w-[640px]">
              <div className="grid grid-cols-5 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                <span>CUSTOMER</span>
                <span>PHONE</span>
                <span>OWES</span>
                <span>DUE DATE</span>
                <span>ACTION</span>
              </div>
              {customers.map((c) => {
                const overdue = isOverdue(c.oldestDueDate);
                return (
                  <div key={c.id} className="grid grid-cols-5 items-center border-b border-brand-border/60 py-2.5 text-sm">
                    <span className="font-semibold text-brand-ink">{c.name}</span>
                    <span className="text-brand-inkMuted">{c.phone ?? "—"}</span>
                    <span className="font-bold text-brand-warn">{currencyFmt.format(Number(c.creditBalance))}</span>
                    <span className={overdue ? "font-bold text-brand-warn" : "text-brand-inkMuted"}>
                      {c.oldestDueDate ? new Date(c.oldestDueDate).toLocaleDateString("en-KE") : "—"}
                      {overdue && " (overdue)"}
                    </span>
                    {payingId === c.id ? (
                      <div className="flex gap-2">
                        <input
                          autoFocus
                          type="number"
                          min="0"
                          placeholder="Amount"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="w-24 rounded-lg border border-brand-border px-2 py-1 text-sm"
                        />
                        <Button className="px-2 py-1 text-xs" onClick={() => void recordPayment(c.id)}>
                          Save
                        </Button>
                      </div>
                    ) : (
                      <Button variant="secondary" className="w-fit px-3 py-1.5 text-xs" onClick={() => setPayingId(c.id)}>
                        Record payment
                      </Button>
                    )}
                  </div>
                );
              })}
              {customers.length === 0 && <div className="py-6 text-sm text-brand-inkMuted">No outstanding credit balances.</div>}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
