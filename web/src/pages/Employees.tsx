import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card, Switch } from "../components/ui";
import type { PermissionCatalogEntry, PermissionMap } from "../lib/permissions";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, type PaymentMethod } from "../lib/paymentMethods";

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
  permissions: PermissionMap;
  customized: boolean;
}

interface EmployeeForm {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
  role: Role;
}

const emptyForm: EmployeeForm = { name: "", email: "", password: "", confirmPassword: "", role: "CASHIER" };

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

interface SaleHistoryItem {
  id: string;
  name: string;
  quantity: number;
}

interface SaleHistoryRow {
  id: string;
  createdAt: string;
  total: string | number;
  paymentMethod: string;
  status: string;
  items: SaleHistoryItem[];
}

export function Employees() {
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [catalog, setCatalog] = useState<PermissionCatalogEntry[]>([]);
  const [roleDefaults, setRoleDefaults] = useState<Record<Role, PermissionMap> | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<EmployeeForm>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editRole, setEditRole] = useState<Role>("CASHIER");
  const [editPermissions, setEditPermissions] = useState<PermissionMap | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [showResetPassword, setShowResetPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState(false);

  const [salesHistory, setSalesHistory] = useState<SaleHistoryRow[]>([]);
  const [salesHistoryLoading, setSalesHistoryLoading] = useState(false);
  const [salesHistoryError, setSalesHistoryError] = useState<string | null>(null);
  const [paymentMethodFilter, setPaymentMethodFilter] = useState<PaymentMethod | "">("");

  const selected = employees.find((e) => e.id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) {
      setSalesHistory([]);
      return;
    }
    let cancelled = false;
    setSalesHistoryLoading(true);
    setSalesHistoryError(null);
    const params = new URLSearchParams({ cashierId: selectedId });
    if (paymentMethodFilter) params.set("paymentMethod", paymentMethodFilter);
    api
      .get<SaleHistoryRow[]>(`/api/sales?${params.toString()}`)
      .then((rows) => {
        if (!cancelled) setSalesHistory(rows);
      })
      .catch((err) => {
        if (!cancelled) setSalesHistoryError(err instanceof ApiError ? err.message : "Couldn't load sales history");
      })
      .finally(() => {
        if (!cancelled) setSalesHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, paymentMethodFilter]);

  async function load() {
    const [emps, cat] = await Promise.all([
      api.get<Employee[]>("/api/employees"),
      api.get<{ catalog: PermissionCatalogEntry[]; roleDefaults: Record<Role, PermissionMap> }>(
        "/api/employees/permission-catalog"
      ),
    ]);
    setEmployees(emps);
    setCatalog(cat.catalog);
    setRoleDefaults(cat.roleDefaults);
  }

  useEffect(() => {
    void load();
  }, []);

  function selectEmployee(emp: Employee) {
    setSelectedId(emp.id);
    setEditRole(emp.role);
    setEditPermissions(emp.permissions);
    setSaveError(null);
    setShowResetPassword(false);
    setNewPassword("");
    setConfirmNewPassword("");
    setResetPasswordError(null);
    setResetPasswordSuccess(false);
    setPaymentMethodFilter("");
  }

  async function resetPassword() {
    if (!selected || newPassword.length < 8) return;
    if (newPassword !== confirmNewPassword) {
      setResetPasswordError("Passwords don't match.");
      return;
    }
    setResettingPassword(true);
    setResetPasswordError(null);
    try {
      await api.put(`/api/employees/${selected.id}`, { password: newPassword });
      setNewPassword("");
      setConfirmNewPassword("");
      setShowResetPassword(false);
      setResetPasswordSuccess(true);
    } catch (err) {
      setResetPasswordError(err instanceof ApiError ? err.message : "Couldn't reset password");
    } finally {
      setResettingPassword(false);
    }
  }

  function applyRoleDefaults(role: Role) {
    if (roleDefaults) setEditPermissions(roleDefaults[role]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (form.password !== form.confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    try {
      await api.post("/api/employees", { name: form.name, email: form.email, password: form.password, role: form.role });
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

  async function savePermissions() {
    if (!selected || !editPermissions) return;
    setSaving(true);
    setSaveError(null);
    try {
      const updated = await api.put<Employee>(`/api/employees/${selected.id}`, {
        role: editRole,
        permissions: editPermissions,
      });
      setEmployees((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setEditPermissions(updated.permissions);
    } catch (err) {
      setSaveError(err instanceof ApiError ? err.message : "Couldn't save permissions");
    } finally {
      setSaving(false);
    }
  }

  const categories = Array.from(new Set(catalog.map((c) => c.category)));
  const isAdmin = editRole === "ADMIN";

  return (
    <>
      <Topbar title="Employees" subtitle="Admin, roles, and per-attendant permissions" />
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:flex-row lg:overflow-hidden lg:p-8">
        <div className="flex w-full flex-col gap-4 lg:max-w-md lg:overflow-auto">
          <div className="flex justify-end">
            <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : "Add employee"}</Button>
          </div>

          {showForm && (
            <Card>
              <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <input required placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
                <input required type="email" placeholder="Email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
                <input required type="password" minLength={8} placeholder="Temporary password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
                <input required type="password" minLength={8} placeholder="Confirm password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
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

          <Card className="flex flex-col gap-1 p-2">
            {employees.map((emp) => (
              <button
                key={emp.id}
                onClick={() => selectEmployee(emp)}
                className={`flex items-center justify-between rounded-lg px-3 py-2.5 text-left hover:bg-brand-bg ${selectedId === emp.id ? "bg-brand-bg" : ""}`}
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-brand-ink">{emp.name}</div>
                  <div className="truncate text-xs text-brand-inkMuted">{emp.email}</div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-brand-inkMuted">{ROLE_LABELS[emp.role]}</span>
                  <span
                    onClick={(e) => {
                      e.stopPropagation();
                      void toggleActive(emp);
                    }}
                    className={`w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold ${
                      emp.active ? "bg-brand-accent/20 text-brand-accentText" : "bg-brand-warnBg text-brand-warn"
                    }`}
                  >
                    {emp.active ? "Active" : "Disabled"}
                  </span>
                </div>
              </button>
            ))}
          </Card>
        </div>

        {selected && editPermissions && (
          <div className="flex w-full flex-1 flex-col gap-6 lg:overflow-auto">
          <Card className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="font-display text-lg font-bold text-brand-ink">{selected.name}</div>
                <div className="text-sm text-brand-inkMuted">{selected.email}</div>
              </div>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-brand-ink">Role</span>
                <select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as Role)}
                  className="rounded-lg border border-brand-border px-3 py-2"
                >
                  {Object.entries(ROLE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="border-b border-brand-border pb-4">
              {!showResetPassword ? (
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="text-sm text-brand-inkMuted">
                    {resetPasswordSuccess ? "Password updated." : "Forgot their password? Set a new one here."}
                  </span>
                  <Button
                    variant="secondary"
                    className="w-fit px-3 py-1.5 text-xs"
                    onClick={() => {
                      setShowResetPassword(true);
                      setResetPasswordSuccess(false);
                    }}
                  >
                    Reset password
                  </Button>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="mb-1 block font-medium text-brand-ink">New password</span>
                      <input
                        type="password"
                        minLength={8}
                        autoFocus
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="At least 8 characters"
                        className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="mb-1 block font-medium text-brand-ink">Confirm password</span>
                      <input
                        type="password"
                        minLength={8}
                        value={confirmNewPassword}
                        onChange={(e) => setConfirmNewPassword(e.target.value)}
                        placeholder="Re-enter the password"
                        className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm"
                      />
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="px-3 py-2 text-xs"
                      disabled={resettingPassword}
                      onClick={() => {
                        setShowResetPassword(false);
                        setNewPassword("");
                        setConfirmNewPassword("");
                        setResetPasswordError(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="px-3 py-2 text-xs"
                      disabled={resettingPassword || newPassword.length < 8 || confirmNewPassword.length < 8}
                      onClick={() => void resetPassword()}
                    >
                      {resettingPassword ? "Saving…" : "Save password"}
                    </Button>
                  </div>
                </div>
              )}
              {resetPasswordError && <div className="mt-2 text-sm font-medium text-brand-warn">{resetPasswordError}</div>}
            </div>

            {isAdmin ? (
              <div className="rounded-[10px] bg-brand-bg px-4 py-3 text-sm text-brand-inkMuted">
                Admins always have full access to every feature — permissions can't be restricted for this role.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-brand-border pb-4">
                  <span className="text-xs text-brand-inkMuted">
                    {selected.customized ? "Using custom permissions" : `Using ${ROLE_LABELS[editRole]} defaults`}
                  </span>
                  <Button variant="secondary" className="w-fit px-3 py-1.5 text-xs" onClick={() => applyRoleDefaults(editRole)}>
                    Reset to {ROLE_LABELS[editRole]} defaults
                  </Button>
                </div>

                <div className="flex flex-col gap-5">
                  {categories.map((category) => (
                    <div key={category}>
                      <div className="mb-2 text-[11.5px] font-bold uppercase tracking-wide text-brand-inkMuted">{category} roles</div>
                      <div className="flex flex-col divide-y divide-brand-border/60">
                        {catalog
                          .filter((entry) => entry.category === category)
                          .map((entry) => (
                            <div key={entry.key} className="flex items-center justify-between gap-3 py-2.5">
                              <span className="text-sm text-brand-ink">{entry.label}</span>
                              <Switch
                                checked={editPermissions[entry.key]}
                                onChange={(checked) =>
                                  setEditPermissions((prev) => (prev ? { ...prev, [entry.key]: checked } : prev))
                                }
                              />
                            </div>
                          ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {saveError && <div className="text-sm font-medium text-brand-warn">{saveError}</div>}
            <div>
              <Button onClick={() => void savePermissions()} disabled={saving}>
                {saving ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </Card>

          <Card className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="font-display text-[15px] font-bold text-brand-ink">Sales history</span>
              <select
                value={paymentMethodFilter}
                onChange={(e) => setPaymentMethodFilter(e.target.value as PaymentMethod | "")}
                className="rounded-lg border border-brand-border px-3 py-2 text-sm"
              >
                <option value="">All payment methods</option>
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>
                    {PAYMENT_METHOD_LABELS[m]}
                  </option>
                ))}
              </select>
            </div>

            {salesHistoryError && <div className="text-sm font-medium text-brand-warn">{salesHistoryError}</div>}
            {!salesHistoryError && salesHistoryLoading && <div className="text-sm text-brand-inkMuted">Loading…</div>}
            {!salesHistoryError && !salesHistoryLoading && (
              <div className="overflow-x-auto">
                <div className="min-w-[560px]">
                  <div className="grid grid-cols-[1.2fr_0.7fr_0.9fr_1fr_0.9fr] border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                    <span>DATE</span>
                    <span>ITEMS</span>
                    <span>TOTAL</span>
                    <span>PAYMENT</span>
                    <span>STATUS</span>
                  </div>
                  {salesHistory.map((s) => (
                    <div
                      key={s.id}
                      className="grid grid-cols-[1.2fr_0.7fr_0.9fr_1fr_0.9fr] items-center border-b border-brand-border/60 py-2.5 text-sm"
                    >
                      <span className="text-brand-inkMuted">{new Date(s.createdAt).toLocaleString("en-KE")}</span>
                      <span>{s.items.reduce((n, i) => n + i.quantity, 0)}</span>
                      <span className="font-semibold text-brand-ink">{currencyFmt.format(Number(s.total))}</span>
                      <span className="text-brand-inkMuted">
                        {PAYMENT_METHOD_LABELS[s.paymentMethod as PaymentMethod] ?? s.paymentMethod}
                      </span>
                      <span className="w-fit rounded-full bg-brand-accent/20 px-2.5 py-1 text-[11.5px] font-bold text-brand-accentText">
                        {s.status}
                      </span>
                    </div>
                  ))}
                  {salesHistory.length === 0 && (
                    <div className="py-6 text-sm text-brand-inkMuted">
                      No sales{paymentMethodFilter ? ` paid by ${PAYMENT_METHOD_LABELS[paymentMethodFilter]}` : ""} yet.
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
          </div>
        )}
      </div>
    </>
  );
}
