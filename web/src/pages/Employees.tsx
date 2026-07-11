import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card, Switch } from "../components/ui";
import type { PermissionCatalogEntry, PermissionMap } from "../lib/permissions";

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
  role: Role;
}

const emptyForm: EmployeeForm = { name: "", email: "", password: "", role: "CASHIER" };

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
  const [resettingPassword, setResettingPassword] = useState(false);
  const [resetPasswordError, setResetPasswordError] = useState<string | null>(null);
  const [resetPasswordSuccess, setResetPasswordSuccess] = useState(false);

  const selected = employees.find((e) => e.id === selectedId) ?? null;

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
    setResetPasswordError(null);
    setResetPasswordSuccess(false);
  }

  async function resetPassword() {
    if (!selected || newPassword.length < 8) return;
    setResettingPassword(true);
    setResetPasswordError(null);
    try {
      await api.put(`/api/employees/${selected.id}`, { password: newPassword });
      setNewPassword("");
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
          <Card className="flex flex-1 flex-col gap-4 lg:overflow-auto">
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
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                  <label className="flex-1 text-sm">
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
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="px-3 py-2 text-xs"
                      disabled={resettingPassword}
                      onClick={() => {
                        setShowResetPassword(false);
                        setNewPassword("");
                        setResetPasswordError(null);
                      }}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="px-3 py-2 text-xs"
                      disabled={resettingPassword || newPassword.length < 8}
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
        )}
      </div>
    </>
  );
}
