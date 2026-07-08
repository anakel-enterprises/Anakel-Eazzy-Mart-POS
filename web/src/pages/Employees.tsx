import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";

type Role = "ADMIN" | "MANAGER" | "CASHIER" | "STOREKEEPER" | "ACCOUNTANT";

const ROLE_LABELS: Record<Role, string> = {
  ADMIN: "Admin",
  MANAGER: "Manager",
  CASHIER: "Cashier",
  STOREKEEPER: "Storekeeper",
  ACCOUNTANT: "Accountant",
};

interface Employee {
  id: string;
  name: string;
  email: string;
  role: Role;
  active: boolean;
}

interface EmployeeForm {
  name: string;
  email: string;
  password: string;
  role: Role;
}

const emptyForm: EmployeeForm = { name: "", email: "", password: "", role: "CASHIER" };

export function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EmployeeForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setEmployees(await api.get<Employee[]>("/api/employees"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/employees", form);
      setForm(emptyForm);
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create employee");
    }
  }

  async function toggleActive(emp: Employee) {
    await api.put(`/api/employees/${emp.id}`, { active: !emp.active });
    await load();
  }

  return (
    <>
      <Topbar title="Employees" subtitle="Admin and cashier accounts" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6 lg:p-8">
        <div className="flex justify-end">
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add employee"}</Button>
        </div>

        {showForm && (
          <Card>
            <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input required type="password" minLength={8} placeholder="Temporary password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as Role })} className="rounded-lg border border-brand-border px-3 py-2 text-sm">
                {Object.entries(ROLE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              {error && <div className="col-span-full text-sm font-medium text-brand-warn">{error}</div>}
              <div className="col-span-full">
                <Button type="submit">Create account</Button>
              </div>
            </form>
          </Card>
        )}

        <Card>
          <div className="overflow-x-auto">
            <div className="min-w-[560px]">
              <div className="grid grid-cols-4 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                <span>NAME</span>
                <span>EMAIL</span>
                <span>ROLE</span>
                <span>STATUS</span>
              </div>
              {employees.map((emp) => (
                <div key={emp.id} className="grid grid-cols-4 items-center border-b border-brand-border/60 py-2.5 text-sm">
                  <span className="font-semibold text-brand-ink">{emp.name}</span>
                  <span className="text-brand-inkMuted">{emp.email}</span>
                  <span>{ROLE_LABELS[emp.role]}</span>
                  <button
                    onClick={() => void toggleActive(emp)}
                    className={`w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                      emp.active ? "bg-brand-accent/20 text-brand-accentText" : "bg-brand-warnBg text-brand-warn"
                    }`}
                  >
                    {emp.active ? "Active" : "Disabled"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
