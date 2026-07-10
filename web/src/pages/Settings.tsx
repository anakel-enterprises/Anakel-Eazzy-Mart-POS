import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";

interface Store {
  name: string;
  address: string | null;
  phone: string | null;
  currency: string;
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
      </div>
    </>
  );
}
