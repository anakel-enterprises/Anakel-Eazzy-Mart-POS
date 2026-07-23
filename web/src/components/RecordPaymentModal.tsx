import { useState } from "react";
import { Button, Card } from "./ui";

export type CreditPaymentMethod = "CASH" | "MPESA_MANUAL" | "SPLIT";
export type CreditPaymentSplitMethod = "CASH" | "MPESA_MANUAL";

export interface CreditPaymentSubmission {
  amount: number;
  method: CreditPaymentMethod;
  splitPayments?: { method: CreditPaymentSplitMethod; amount: number }[];
}

const METHOD_LABELS: Record<CreditPaymentMethod, string> = {
  CASH: "Cash",
  MPESA_MANUAL: "M-Pesa",
  SPLIT: "Split",
};

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

interface RecordPaymentModalProps {
  customerName: string;
  outstanding: number;
  onClose: () => void;
  onSubmit: (data: CreditPaymentSubmission) => Promise<void>;
}

// A window asking how a credit payment was actually received — cash,
// M-Pesa, or split across both — replacing what used to be a bare amount
// field with no way to record how the money came in. Same three choices
// (and the same split-across-methods shape) as Checkout's own payment
// selection, so a payment collected in two parts is recorded the same way
// a split sale is.
export function RecordPaymentModal({ customerName, outstanding, onClose, onSubmit }: RecordPaymentModalProps) {
  const [amount, setAmount] = useState(outstanding > 0 ? String(outstanding) : "");
  const [method, setMethod] = useState<CreditPaymentMethod>("CASH");
  const [splitRows, setSplitRows] = useState<{ method: CreditPaymentSplitMethod; amount: number }[]>([
    { method: "CASH", amount: 0 },
    { method: "MPESA_MANUAL", amount: 0 },
  ]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amountNum = Number(amount) || 0;
  const splitAllocated = splitRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const splitRemaining = Math.round((amountNum - splitAllocated) * 100) / 100;

  function updateSplitRow(index: number, patch: Partial<{ method: CreditPaymentSplitMethod; amount: number }>) {
    setSplitRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  const canSubmit = amountNum > 0 && (method !== "SPLIT" || Math.abs(splitRemaining) < 0.01);

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        amount: amountNum,
        method,
        splitPayments: method === "SPLIT" ? splitRows.filter((r) => r.amount > 0) : undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't record this payment");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-1 font-display text-lg font-bold text-brand-ink">Record payment</div>
        <div className="mb-4 text-sm text-brand-inkMuted">{customerName}</div>

        <label className="mb-3 block text-sm">
          <span className="mb-1 block font-medium text-brand-ink">Amount</span>
          <input
            autoFocus
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
          />
        </label>

        <div className="mb-3">
          <span className="mb-1 block text-sm font-medium text-brand-ink">Paid via</span>
          <div className="flex gap-2">
            {(Object.keys(METHOD_LABELS) as CreditPaymentMethod[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod(m)}
                className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${
                  method === m ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"
                }`}
              >
                {METHOD_LABELS[m]}
              </button>
            ))}
          </div>
        </div>

        {method === "SPLIT" && (
          <div className="mb-3 flex flex-col gap-2 text-sm">
            {splitRows.map((row, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={row.method}
                  onChange={(e) => updateSplitRow(i, { method: e.target.value as CreditPaymentSplitMethod })}
                  className="rounded-lg border border-brand-border px-2 py-2 text-sm"
                >
                  <option value="CASH">Cash</option>
                  <option value="MPESA_MANUAL">M-Pesa</option>
                </select>
                <input
                  type="number"
                  min="0"
                  value={row.amount || ""}
                  onChange={(e) => updateSplitRow(i, { amount: Number(e.target.value) || 0 })}
                  placeholder="Amount"
                  className="flex-1 rounded-lg border border-brand-border px-3 py-2"
                />
              </div>
            ))}
            <div className={`text-xs font-semibold ${Math.abs(splitRemaining) < 0.01 ? "text-brand-accentText" : "text-brand-warn"}`}>
              {Math.abs(splitRemaining) < 0.01
                ? "Fully allocated"
                : splitRemaining > 0
                  ? `${currencyFmt.format(splitRemaining)} remaining`
                  : `${currencyFmt.format(-splitRemaining)} over the amount`}
            </div>
          </div>
        )}

        {error && <div className="mb-3 text-xs font-medium text-brand-warn">{error}</div>}

        <div className="flex gap-2">
          <Button variant="secondary" className="flex-1" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button className="flex-1" onClick={() => void handleSubmit()} disabled={!canSubmit || submitting}>
            {submitting ? "Saving…" : "Save"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
