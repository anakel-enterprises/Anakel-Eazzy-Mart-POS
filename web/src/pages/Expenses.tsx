import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";
import { ClearableInput } from "../components/ClearableInput";

interface Category {
  id: string;
  name: string;
}

interface ExpenseRow {
  id: string;
  amount: string | number;
  description: string | null;
  date: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  category: Category;
  requestedBy: { name: string };
  approvedBy: { name: string } | null;
}

interface IncomeRow {
  id: string;
  source: string;
  amount: string | number;
  description: string | null;
  date: string;
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

export function Expenses() {
  const { user } = useAuth();
  const canDecide = user?.role === "ADMIN" || !!user?.permissions?.MANAGE_EXPENSES;
  const [tab, setTab] = useState<"expenses" | "income">("expenses");
  const [categories, setCategories] = useState<Category[]>([]);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [incomes, setIncomes] = useState<IncomeRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [expenseForm, setExpenseForm] = useState({ categoryId: "", amount: "", description: "" });
  const [incomeForm, setIncomeForm] = useState({ source: "", amount: "", description: "" });

  async function load() {
    const [cats, exp, inc] = await Promise.all([
      api.get<Category[]>("/api/expenses/categories"),
      api.get<ExpenseRow[]>("/api/expenses"),
      api.get<IncomeRow[]>("/api/income"),
    ]);
    setCategories(cats);
    setExpenses(exp);
    setIncomes(inc);
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitExpense(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/expenses", {
        categoryId: expenseForm.categoryId,
        amount: Number(expenseForm.amount),
        description: expenseForm.description || undefined,
      });
      setExpenseForm({ categoryId: "", amount: "", description: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't submit expense");
    }
  }

  async function submitIncome(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/income", {
        source: incomeForm.source,
        amount: Number(incomeForm.amount),
        description: incomeForm.description || undefined,
      });
      setIncomeForm({ source: "", amount: "", description: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't record income");
    }
  }

  async function decide(id: string, status: "APPROVED" | "REJECTED") {
    await api.put(`/api/expenses/${id}/decision`, { status });
    await load();
  }

  return (
    <>
      <Topbar title="Expenses & Income" subtitle="Track spending and other income, with approval for expenses" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setTab("expenses")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === "expenses" ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"}`}
            >
              Expenses
            </button>
            <button
              onClick={() => setTab("income")}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === "income" ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"}`}
            >
              Other Income
            </button>
          </div>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : tab === "expenses" ? "Add expense" : "Add income"}</Button>
        </div>

        {showForm && tab === "expenses" && (
          <Card>
            <form onSubmit={submitExpense} className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <select required value={expenseForm.categoryId} onChange={(e) => setExpenseForm({ ...expenseForm, categoryId: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm">
                <option value="">Select category</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <input required type="number" min="0" step="0.01" placeholder="Amount (KSh)" value={expenseForm.amount} onChange={(e) => setExpenseForm({ ...expenseForm, amount: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <ClearableInput
                placeholder="Description"
                value={expenseForm.description}
                onChange={(e) => setExpenseForm({ ...expenseForm, description: e.target.value })}
                onClear={() => setExpenseForm({ ...expenseForm, description: "" })}
                className="rounded-lg border border-brand-border px-3 py-2 text-sm"
              />
              {error && <div className="col-span-full text-sm font-medium text-brand-warn">{error}</div>}
              <div className="col-span-full">
                <Button type="submit">Submit for approval</Button>
              </div>
            </form>
          </Card>
        )}

        {showForm && tab === "income" && (
          <Card>
            <form onSubmit={submitIncome} className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <ClearableInput
                required
                placeholder="Source (e.g. Airtime commission)"
                value={incomeForm.source}
                onChange={(e) => setIncomeForm({ ...incomeForm, source: e.target.value })}
                onClear={() => setIncomeForm({ ...incomeForm, source: "" })}
                className="rounded-lg border border-brand-border px-3 py-2 text-sm"
              />
              <input required type="number" min="0" step="0.01" placeholder="Amount (KSh)" value={incomeForm.amount} onChange={(e) => setIncomeForm({ ...incomeForm, amount: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <ClearableInput
                placeholder="Description"
                value={incomeForm.description}
                onChange={(e) => setIncomeForm({ ...incomeForm, description: e.target.value })}
                onClear={() => setIncomeForm({ ...incomeForm, description: "" })}
                className="rounded-lg border border-brand-border px-3 py-2 text-sm"
              />
              {error && <div className="col-span-full text-sm font-medium text-brand-warn">{error}</div>}
              <div className="col-span-full">
                <Button type="submit">Record income</Button>
              </div>
            </form>
          </Card>
        )}

        {tab === "expenses" && (
          <Card>
            <div className="overflow-x-auto">
              <div className="min-w-[720px]">
                <div className="grid grid-cols-6 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                  <span>DATE</span>
                  <span>CATEGORY</span>
                  <span>AMOUNT</span>
                  <span>REQUESTED BY</span>
                  <span>STATUS</span>
                  <span>ACTION</span>
                </div>
                {expenses.map((e) => (
                  <div key={e.id} className="grid grid-cols-6 items-center border-b border-brand-border/60 py-2.5 text-sm">
                    <span>{new Date(e.date).toLocaleDateString("en-KE")}</span>
                    <span>{e.category.name}</span>
                    <span className="font-semibold">{currencyFmt.format(Number(e.amount))}</span>
                    <span className="text-brand-inkMuted">{e.requestedBy.name}</span>
                    <span
                      className={`w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                        e.status === "APPROVED"
                          ? "bg-brand-accent/20 text-brand-accentText"
                          : e.status === "REJECTED"
                          ? "bg-brand-warnBg text-brand-warn"
                          : "bg-brand-bg text-brand-inkMuted"
                      }`}
                    >
                      {e.status}
                    </span>
                    {e.status === "PENDING" && canDecide ? (
                      <div className="flex gap-1.5">
                        <Button className="px-2 py-1 text-xs" onClick={() => void decide(e.id, "APPROVED")}>
                          Approve
                        </Button>
                        <Button variant="danger" className="px-2 py-1 text-xs" onClick={() => void decide(e.id, "REJECTED")}>
                          Reject
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-brand-inkMuted">{e.approvedBy?.name ?? "—"}</span>
                    )}
                  </div>
                ))}
                {expenses.length === 0 && <div className="py-6 text-sm text-brand-inkMuted">No expenses recorded yet.</div>}
              </div>
            </div>
          </Card>
        )}

        {tab === "income" && (
          <Card>
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-4 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                  <span>DATE</span>
                  <span>SOURCE</span>
                  <span>DESCRIPTION</span>
                  <span>AMOUNT</span>
                </div>
                {incomes.map((i) => (
                  <div key={i.id} className="grid grid-cols-4 items-center border-b border-brand-border/60 py-2.5 text-sm">
                    <span>{new Date(i.date).toLocaleDateString("en-KE")}</span>
                    <span className="font-semibold">{i.source}</span>
                    <span className="text-brand-inkMuted">{i.description ?? "—"}</span>
                    <span className="font-semibold text-brand-accentText">{currencyFmt.format(Number(i.amount))}</span>
                  </div>
                ))}
                {incomes.length === 0 && <div className="py-6 text-sm text-brand-inkMuted">No other income recorded yet.</div>}
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
