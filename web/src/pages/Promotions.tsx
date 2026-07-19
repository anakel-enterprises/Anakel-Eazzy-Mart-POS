import { useEffect, useState } from "react";
import { api, ApiError } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";
import { ClearableInput } from "../components/ClearableInput";

interface Promotion {
  id: string;
  name: string;
  type: "PERCENTAGE_DISCOUNT" | "FIXED_DISCOUNT" | "BOGO";
  discountPercent: string | number | null;
  discountAmount: string | number | null;
  startDate: string;
  endDate: string;
  active: boolean;
}

interface Coupon {
  id: string;
  code: string;
  discountType: "PERCENTAGE" | "FIXED";
  discountValue: string | number;
  expiresAt: string | null;
  usageLimit: number | null;
  timesUsed: number;
  active: boolean;
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });
const toLocalInput = (d: Date) => d.toISOString().slice(0, 16);

export function Promotions() {
  const [tab, setTab] = useState<"promotions" | "coupons">("promotions");
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const now = new Date();
  const inAWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const [promoForm, setPromoForm] = useState({
    name: "",
    type: "PERCENTAGE_DISCOUNT" as Promotion["type"],
    discountPercent: "10",
    discountAmount: "",
    startDate: toLocalInput(now),
    endDate: toLocalInput(inAWeek),
  });
  const [couponForm, setCouponForm] = useState({ code: "", discountType: "PERCENTAGE" as Coupon["discountType"], discountValue: "10", usageLimit: "" });

  async function load() {
    setPromotions(await api.get<Promotion[]>("/api/promotions"));
    setCoupons(await api.get<Coupon[]>("/api/coupons"));
  }

  useEffect(() => {
    void load();
  }, []);

  async function submitPromotion(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/promotions", {
        name: promoForm.name,
        type: promoForm.type,
        discountPercent: promoForm.type === "PERCENTAGE_DISCOUNT" ? Number(promoForm.discountPercent) : undefined,
        discountAmount: promoForm.type === "FIXED_DISCOUNT" ? Number(promoForm.discountAmount) : undefined,
        startDate: new Date(promoForm.startDate).toISOString(),
        endDate: new Date(promoForm.endDate).toISOString(),
      });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save promotion");
    }
  }

  async function submitCoupon(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post("/api/coupons", {
        code: couponForm.code,
        discountType: couponForm.discountType,
        discountValue: Number(couponForm.discountValue),
        usageLimit: couponForm.usageLimit ? Number(couponForm.usageLimit) : undefined,
      });
      setCouponForm({ code: "", discountType: "PERCENTAGE", discountValue: "10", usageLimit: "" });
      setShowForm(false);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't save coupon");
    }
  }

  async function deactivatePromotion(id: string) {
    await api.delete(`/api/promotions/${id}`);
    await load();
  }

  async function deactivateCoupon(id: string) {
    await api.delete(`/api/coupons/${id}`);
    await load();
  }

  return (
    <>
      <Topbar title="Promotions" subtitle="Storewide/product discounts and coupon codes" />
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-4 sm:p-6 lg:p-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button onClick={() => setTab("promotions")} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === "promotions" ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"}`}>
              Promotions
            </button>
            <button onClick={() => setTab("coupons")} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${tab === "coupons" ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"}`}>
              Coupons
            </button>
          </div>
          <Button onClick={() => setShowForm((v) => !v)}>{showForm ? "Cancel" : tab === "promotions" ? "New promotion" : "New coupon"}</Button>
        </div>

        {showForm && tab === "promotions" && (
          <Card>
            <form onSubmit={submitPromotion} className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
              <ClearableInput
                required
                placeholder="Name (e.g. Weekend 10% Off)"
                value={promoForm.name}
                onChange={(e) => setPromoForm({ ...promoForm, name: e.target.value })}
                onClear={() => setPromoForm({ ...promoForm, name: "" })}
                className="rounded-lg border border-brand-border px-3 py-2 text-sm"
              />
              <select value={promoForm.type} onChange={(e) => setPromoForm({ ...promoForm, type: e.target.value as Promotion["type"] })} className="rounded-lg border border-brand-border px-3 py-2 text-sm">
                <option value="PERCENTAGE_DISCOUNT">Percentage discount (storewide)</option>
                <option value="FIXED_DISCOUNT">Fixed discount (storewide)</option>
              </select>
              {promoForm.type === "PERCENTAGE_DISCOUNT" ? (
                <input required type="number" min="0" max="100" placeholder="Discount %" value={promoForm.discountPercent} onChange={(e) => setPromoForm({ ...promoForm, discountPercent: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              ) : (
                <input required type="number" min="0" placeholder="Discount (KSh)" value={promoForm.discountAmount} onChange={(e) => setPromoForm({ ...promoForm, discountAmount: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              )}
              <label className="text-sm">
                <span className="mb-1 block font-medium text-brand-ink">Starts</span>
                <input required type="datetime-local" value={promoForm.startDate} onChange={(e) => setPromoForm({ ...promoForm, startDate: e.target.value })} className="w-full rounded-lg border border-brand-border px-3 py-2" />
              </label>
              <label className="text-sm">
                <span className="mb-1 block font-medium text-brand-ink">Ends</span>
                <input required type="datetime-local" value={promoForm.endDate} onChange={(e) => setPromoForm({ ...promoForm, endDate: e.target.value })} className="w-full rounded-lg border border-brand-border px-3 py-2" />
              </label>
              {error && <div className="col-span-full text-sm font-medium text-brand-warn">{error}</div>}
              <div className="col-span-full">
                <Button type="submit">Save promotion</Button>
              </div>
            </form>
          </Card>
        )}

        {showForm && tab === "coupons" && (
          <Card>
            <form onSubmit={submitCoupon} className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-4">
              <ClearableInput
                required
                placeholder="Code (e.g. SAVE50)"
                value={couponForm.code}
                onChange={(e) => setCouponForm({ ...couponForm, code: e.target.value.toUpperCase() })}
                onClear={() => setCouponForm({ ...couponForm, code: "" })}
                className="rounded-lg border border-brand-border px-3 py-2 text-sm"
              />
              <select value={couponForm.discountType} onChange={(e) => setCouponForm({ ...couponForm, discountType: e.target.value as Coupon["discountType"] })} className="rounded-lg border border-brand-border px-3 py-2 text-sm">
                <option value="PERCENTAGE">Percentage</option>
                <option value="FIXED">Fixed amount</option>
              </select>
              <input required type="number" min="0" placeholder="Value" value={couponForm.discountValue} onChange={(e) => setCouponForm({ ...couponForm, discountValue: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              <input type="number" min="1" placeholder="Usage limit (optional)" value={couponForm.usageLimit} onChange={(e) => setCouponForm({ ...couponForm, usageLimit: e.target.value })} className="rounded-lg border border-brand-border px-3 py-2 text-sm" />
              {error && <div className="col-span-full text-sm font-medium text-brand-warn">{error}</div>}
              <div className="col-span-full">
                <Button type="submit">Save coupon</Button>
              </div>
            </form>
          </Card>
        )}

        {tab === "promotions" && (
          <Card>
            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-5 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                  <span>NAME</span>
                  <span>DISCOUNT</span>
                  <span>STARTS</span>
                  <span>ENDS</span>
                  <span>ACTION</span>
                </div>
                {promotions.map((p) => (
                  <div key={p.id} className="grid grid-cols-5 items-center border-b border-brand-border/60 py-2.5 text-sm">
                    <span className="font-semibold text-brand-ink">{p.name}</span>
                    <span>{p.discountPercent ? `${p.discountPercent}%` : currencyFmt.format(Number(p.discountAmount))}</span>
                    <span className="text-brand-inkMuted">{new Date(p.startDate).toLocaleDateString("en-KE")}</span>
                    <span className="text-brand-inkMuted">{new Date(p.endDate).toLocaleDateString("en-KE")}</span>
                    {p.active ? (
                      <Button variant="danger" className="w-fit px-2 py-1 text-xs" onClick={() => void deactivatePromotion(p.id)}>
                        Deactivate
                      </Button>
                    ) : (
                      <span className="text-xs text-brand-inkMuted">Inactive</span>
                    )}
                  </div>
                ))}
                {promotions.length === 0 && <div className="py-6 text-sm text-brand-inkMuted">No promotions yet.</div>}
              </div>
            </div>
          </Card>
        )}

        {tab === "coupons" && (
          <Card>
            <div className="overflow-x-auto">
              <div className="min-w-[560px]">
                <div className="grid grid-cols-5 border-b border-brand-border pb-2 text-[11.5px] font-semibold text-brand-inkMuted">
                  <span>CODE</span>
                  <span>DISCOUNT</span>
                  <span>USAGE</span>
                  <span>STATUS</span>
                  <span>ACTION</span>
                </div>
                {coupons.map((c) => (
                  <div key={c.id} className="grid grid-cols-5 items-center border-b border-brand-border/60 py-2.5 text-sm">
                    <span className="font-mono font-semibold text-brand-ink">{c.code}</span>
                    <span>{c.discountType === "PERCENTAGE" ? `${c.discountValue}%` : currencyFmt.format(Number(c.discountValue))}</span>
                    <span className="text-brand-inkMuted">{c.timesUsed}{c.usageLimit ? ` / ${c.usageLimit}` : ""}</span>
                    <span className={c.active ? "text-brand-accentText" : "text-brand-inkMuted"}>{c.active ? "Active" : "Inactive"}</span>
                    {c.active && (
                      <Button variant="danger" className="w-fit px-2 py-1 text-xs" onClick={() => void deactivateCoupon(c.id)}>
                        Deactivate
                      </Button>
                    )}
                  </div>
                ))}
                {coupons.length === 0 && <div className="py-6 text-sm text-brand-inkMuted">No coupons yet.</div>}
              </div>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}
