import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Topbar } from "../components/Topbar";
import { Card } from "../components/ui";

interface SummaryResponse {
  totals: { _sum: { subtotal: number | null; taxTotal: number | null; total: number | null }; _count: number };
  byPaymentMethod: { paymentMethod: string; _sum: { total: number | null }; _count: number }[];
  topProducts: { productId: string; name: string; _sum: { quantity: number | null; lineTotal: number | null } }[];
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

export function Reports() {
  const [data, setData] = useState<SummaryResponse | null>(null);

  useEffect(() => {
    void api.get<SummaryResponse>("/api/reports/sales-summary").then(setData);
  }, []);

  return (
    <>
      <Topbar title="Reports" subtitle="All-time sales summary" />
      <div className="flex flex-1 flex-col gap-6 overflow-auto p-8">
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <div className="text-[12.5px] font-semibold text-brand-inkMuted">Total Revenue</div>
            <div className="font-display text-2xl font-bold text-brand-ink">
              {currencyFmt.format(data?.totals._sum.total ?? 0)}
            </div>
          </Card>
          <Card>
            <div className="text-[12.5px] font-semibold text-brand-inkMuted">Transactions</div>
            <div className="font-display text-2xl font-bold text-brand-ink">{data?.totals._count ?? 0}</div>
          </Card>
          <Card>
            <div className="text-[12.5px] font-semibold text-brand-inkMuted">Tax Collected</div>
            <div className="font-display text-2xl font-bold text-brand-ink">
              {currencyFmt.format(data?.totals._sum.taxTotal ?? 0)}
            </div>
          </Card>
        </div>

        <Card>
          <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Sales by payment method</div>
          {data?.byPaymentMethod.map((row) => (
            <div key={row.paymentMethod} className="flex items-center justify-between border-b border-brand-border/60 py-2 text-sm">
              <span className="font-semibold text-brand-ink">{row.paymentMethod}</span>
              <span className="text-brand-inkMuted">{row._count} sales</span>
              <span className="font-semibold">{currencyFmt.format(row._sum.total ?? 0)}</span>
            </div>
          ))}
        </Card>

        <Card>
          <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Top products</div>
          {data?.topProducts.map((p) => (
            <div key={p.productId} className="flex items-center justify-between border-b border-brand-border/60 py-2 text-sm">
              <span className="font-semibold text-brand-ink">{p.name}</span>
              <span className="text-brand-inkMuted">{p._sum.quantity ?? 0} sold</span>
              <span className="font-semibold">{currencyFmt.format(p._sum.lineTotal ?? 0)}</span>
            </div>
          ))}
        </Card>
      </div>
    </>
  );
}
