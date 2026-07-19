import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb, newClientId, type CachedProduct, type SplitPaymentEntry } from "../db/localDb";
import { queueSale, queueCustomerCreate, refreshProductCache, refreshCustomerCache, undoLastSale } from "../lib/sync";
import { api, ApiError, isApiReachable } from "../lib/api";
import { getCached } from "../lib/cachedFetch";
import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS } from "../lib/paymentMethods";
import { printReceipt, type ReceiptStore } from "../lib/receipt";
import { useAuth } from "../context/AuthContext";
import { Topbar } from "../components/Topbar";
import { Button, Card } from "../components/ui";
import { ClearableInput } from "../components/ClearableInput";

// The camera-scanning library is sizable and only needed once the modal
// opens, so it's split into its own chunk instead of bloating the app shell.
const BarcodeScannerModal = lazy(() =>
  import("../components/BarcodeScannerModal").then((m) => ({ default: m.BarcodeScannerModal }))
);

interface CartLine {
  product: CachedProduct;
  quantity: number;
}

interface CustomerOption {
  id: string;
  name: string;
  phone: string | null;
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });
// MPESA_MANUAL — customer already paid (e.g. sent to a till/paybill outside
// this system) and the cashier just records it, same trust level as
// CASH/CARD/BANK. MPESA — the live STK push flow below, which requires the
// customer to approve a prompt before the sale can complete.
const SPLIT_METHODS = ["CASH", "MPESA", "CARD", "BANK"] as const;
type MpesaStatus = "idle" | "sending" | "waiting" | "success" | "failed";
// Safaricom's own STK prompt expires client-side after roughly a minute if
// the customer never responds — poll a bit past that so a slow-but-real
// approval isn't cut off right before it would have landed.
const MPESA_POLL_INTERVAL_MS = 3000;
const MPESA_POLL_TIMEOUT_MS = 90_000;

export function Checkout() {
  const [query, setQuery] = useState("");
  const [cart, setCart] = useState<CartLine[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<(typeof PAYMENT_METHODS)[number]>("CASH");
  const [amountTendered, setAmountTendered] = useState("");
  const [splitRows, setSplitRows] = useState<SplitPaymentEntry[]>([
    { method: "CASH", amount: 0 },
    { method: "MPESA", amount: 0 },
  ]);
  // What just got rung up — kept around after resetPaymentState() clears the
  // live payment form, both to render the "Sale complete" screen and so
  // "Undo this sale"/"Print receipt" have everything they need (the cart,
  // for a corrected re-ring; every other field, for a printable receipt)
  // without the cashier having to search and re-add everything.
  const [completedSale, setCompletedSale] = useState<{
    clientId: string;
    cart: CartLine[];
    paymentMethod: (typeof PAYMENT_METHODS)[number];
    amountTendered?: number;
    changeDue: number;
    subtotal: number;
    total: number;
    customerName?: string;
    couponCode?: string;
    createdAt: string;
  } | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [storeInfo, setStoreInfo] = useState<ReceiptStore | null>(null);
  const [showScanner, setShowScanner] = useState(false);
  const [couponCode, setCouponCode] = useState("");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerPhone, setNewCustomerPhone] = useState("");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [newCustomerError, setNewCustomerError] = useState<string | null>(null);
  const [showHeld, setShowHeld] = useState(false);
  const [mpesaPhone, setMpesaPhone] = useState("");
  const [mpesaStatus, setMpesaStatus] = useState<MpesaStatus>("idle");
  const [mpesaError, setMpesaError] = useState<string | null>(null);
  const [mpesaReceiptNumber, setMpesaReceiptNumber] = useState<string | null>(null);

  const { user } = useAuth();

  useEffect(() => {
    void isApiReachable().then((reachable) => {
      if (reachable) {
        void refreshProductCache();
        void refreshCustomerCache();
      }
    });
    // Store name/address/phone for the printable receipt header — cached
    // via getCached so a receipt can still be printed offline using
    // whatever this device last saw, not just when online.
    void getCached<ReceiptStore>("/api/settings").then((res) => setStoreInfo(res.data)).catch(() => {});
  }, []);

  // Searches this device's cached customer list instead of hitting the
  // network — same reason product search does the same (see `results`
  // below): a credit sale needs to work with zero connectivity, and the
  // cache is refreshed on load/online/periodically (see lib/sync.ts) so it
  // rarely lags behind by more than a few minutes.
  const customerOptions = useLiveQuery(async () => {
    if (paymentMethod !== "CREDIT" || !customerQuery.trim()) return [];
    const q = customerQuery.trim().toLowerCase();
    const all = await localDb.customers.toArray();
    return all.filter((c) => c.name.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q)).slice(0, 8);
  }, [customerQuery, paymentMethod], []);

  const results = useLiveQuery(async () => {
    if (!query.trim()) return [];
    const q = query.trim().toLowerCase();
    const all = await localDb.products.toArray();
    return all
      .filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q) || p.barcode?.includes(q))
      .slice(0, 8);
  }, [query]);

  const heldSales = useLiveQuery(() => localDb.heldSales.orderBy("createdAt").reverse().toArray(), [], []);

  const subtotal = useMemo(() => cart.reduce((sum, l) => sum + l.product.price * l.quantity, 0), [cart]);
  // Estimated, not authoritative — the server is the source of truth and
  // additionally applies any active promotions/coupon, which this doesn't
  // know about. Sales are untaxed, so this is just the discounted subtotal;
  // split payments only need to *cover* the server-computed total (see
  // sales.ts), so an estimate that ignores discounts is safe either way.
  const total = Math.round(subtotal * 100) / 100;
  const tendered = Number(amountTendered) || 0;
  const changeDue = paymentMethod === "CASH" ? Math.max(tendered - total, 0) : 0;
  const splitAllocated = splitRows.reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
  const splitRemaining = Math.round((total - splitAllocated) * 100) / 100;

  function addToCart(product: CachedProduct) {
    setCart((prev) => {
      const existing = prev.find((l) => l.product.id === product.id);
      if (existing) {
        return prev.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + 1 } : l));
      }
      return [...prev, { product, quantity: 1 }];
    });
    setQuery("");
  }

  function updateQuantity(productId: string, quantity: number) {
    setCart((prev) =>
      quantity <= 0 ? prev.filter((l) => l.product.id !== productId) : prev.map((l) => (l.product.id === productId ? { ...l, quantity } : l))
    );
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((l) => l.product.id !== productId));
  }

  function resetPaymentState() {
    setCart([]);
    setPaymentMethod("CASH");
    setAmountTendered("");
    setCouponCode("");
    setCustomer(null);
    setCustomerQuery("");
    setShowNewCustomerForm(false);
    setNewCustomerName("");
    setNewCustomerPhone("");
    setNewCustomerError(null);
    setSplitRows([
      { method: "CASH", amount: 0 },
      { method: "MPESA", amount: 0 },
    ]);
    setMpesaPhone("");
    setMpesaStatus("idle");
    setMpesaError(null);
    setMpesaReceiptNumber(null);
  }

  async function holdSale() {
    if (cart.length === 0) return;
    await localDb.heldSales.put({
      id: newClientId(),
      items: cart.map((l) => ({ productId: l.product.id, name: l.product.name, quantity: l.quantity, unitPrice: l.product.price })),
      createdAt: new Date().toISOString(),
    });
    resetPaymentState();
  }

  async function resumeHeldSale(id: string) {
    const held = await localDb.heldSales.get(id);
    if (!held) return;
    // Merges into whatever's already in the cart rather than replacing it,
    // so resuming a hold never silently drops an in-progress sale.
    for (const item of held.items) {
      const product = await localDb.products.get(item.productId);
      if (!product) continue;
      setCart((prev) => {
        const existing = prev.find((l) => l.product.id === product.id);
        if (existing) {
          return prev.map((l) => (l.product.id === product.id ? { ...l, quantity: l.quantity + item.quantity } : l));
        }
        return [...prev, { product, quantity: item.quantity }];
      });
    }
    await localDb.heldSales.delete(id);
    setShowHeld(false);
  }

  async function discardHeldSale(id: string) {
    await localDb.heldSales.delete(id);
  }

  async function completeSale(mpesaCheckoutRequestId?: string) {
    if (cart.length === 0) return;
    if (paymentMethod === "CREDIT" && !customer) return;
    if (paymentMethod === "SPLIT" && splitRemaining > 0.01) return;

    const clientId = newClientId();
    const createdAt = new Date().toISOString();
    await queueSale({
      clientId,
      items: cart.map((l) => ({ productId: l.product.id, name: l.product.name, quantity: l.quantity, unitPrice: l.product.price })),
      paymentMethod,
      amountTendered: paymentMethod === "CASH" ? tendered : undefined,
      status: "COMPLETED",
      createdAt,
      customerId: customer?.id,
      customerName: customer?.name,
      couponCode: couponCode.trim() || undefined,
      splitPayments: paymentMethod === "SPLIT" ? splitRows.filter((r) => r.amount > 0) : undefined,
      mpesaCheckoutRequestId,
    });

    await localDb.transaction("rw", localDb.products, async () => {
      for (const line of cart) {
        const p = await localDb.products.get(line.product.id);
        if (p) await localDb.products.update(p.id, { stockQty: p.stockQty - line.quantity });
      }
    });
    setCompletedSale({
      clientId,
      cart,
      paymentMethod,
      amountTendered: paymentMethod === "CASH" ? tendered : undefined,
      changeDue,
      subtotal,
      total,
      customerName: customer?.name,
      couponCode: couponCode.trim() || undefined,
      createdAt,
    });
    setUndoError(null);
    resetPaymentState();
  }

  // Reverses the sale just completed — a cashier's "I picked the wrong
  // payment method" recovery, not a general void tool (see
  // lib/sync.ts's undoLastSale and the server's own short time window for
  // anyone other than an admin). Restores the cart so the sale can be redone
  // correctly instead of re-searching and re-adding every item.
  async function undoSale() {
    if (!completedSale) return;
    setUndoing(true);
    setUndoError(null);
    const result = await undoLastSale(completedSale.clientId);
    setUndoing(false);
    if (!result.ok) {
      setUndoError(result.message ?? "Couldn't undo this sale");
      return;
    }
    setCart(completedSale.cart);
    setCompletedSale(null);
  }

  function printCompletedReceipt() {
    if (!completedSale) return;
    printReceipt(
      {
        clientId: completedSale.clientId,
        createdAt: completedSale.createdAt,
        lines: completedSale.cart.map((l) => ({ name: l.product.name, quantity: l.quantity, unitPrice: l.product.price })),
        subtotal: completedSale.subtotal,
        total: completedSale.total,
        paymentMethod: completedSale.paymentMethod,
        amountTendered: completedSale.amountTendered,
        changeDue: completedSale.changeDue,
        customerName: completedSale.customerName,
        couponCode: completedSale.couponCode,
        cashierName: user?.name ?? "—",
      },
      storeInfo
    );
  }

  // Live M-Pesa checkout has no offline path — the STK push itself needs
  // connectivity — so this runs as one linear online request/poll loop
  // rather than going through the offline sale queue until it succeeds.
  async function sendMpesaPush() {
    if (!mpesaPhone.trim() || cart.length === 0) return;
    setMpesaStatus("sending");
    setMpesaError(null);
    setMpesaReceiptNumber(null);

    let checkoutRequestId: string;
    try {
      const res = await api.post<{ checkoutRequestId: string }>("/api/mpesa/stk-push", {
        phone: mpesaPhone.trim(),
        amount: total,
      });
      checkoutRequestId = res.checkoutRequestId;
    } catch (err) {
      setMpesaError(err instanceof ApiError ? err.message : "Couldn't reach M-Pesa — check your connection");
      setMpesaStatus("failed");
      return;
    }

    setMpesaStatus("waiting");
    const deadline = Date.now() + MPESA_POLL_TIMEOUT_MS;

    while (Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, MPESA_POLL_INTERVAL_MS));
      try {
        const status = await api.get<{ status: string; mpesaReceiptNumber: string | null; resultDesc: string | null }>(
          `/api/mpesa/stk-push/${checkoutRequestId}`
        );
        if (status.status === "SUCCESS") {
          setMpesaReceiptNumber(status.mpesaReceiptNumber);
          setMpesaStatus("success");
          await completeSale(checkoutRequestId);
          return;
        }
        if (status.status === "FAILED" || status.status === "CANCELLED") {
          setMpesaError(status.resultDesc || "The customer didn't complete the payment.");
          setMpesaStatus("failed");
          return;
        }
        // still PENDING — keep polling until the deadline
      } catch {
        // transient error while polling; keep trying until the deadline
      }
    }

    setMpesaError("No response from the customer's phone — try again.");
    setMpesaStatus("failed");
  }

  function handleScan(value: string) {
    setShowScanner(false);
    setQuery(value);
  }

  function updateSplitRow(index: number, patch: Partial<SplitPaymentEntry>) {
    setSplitRows((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function openNewCustomerForm() {
    setNewCustomerName(customerQuery.trim());
    setNewCustomerPhone("");
    setNewCustomerError(null);
    setShowNewCustomerForm(true);
  }

  // Credit sales previously required the customer to already exist in the
  // system — a cashier meeting a first-time credit customer had to leave
  // Checkout, go create them in Customers, then come back. This creates them
  // inline and selects them for the current sale in one step — and, like
  // every other Checkout write, goes through the offline queue first: the
  // customer is created locally under a local-only id and immediately
  // usable for this sale, syncing (and getting its real server id) once a
  // connection is available. Requires MANAGE_CUSTOMERS (cashiers have it by
  // default), same as the customer search above it, but no connection.
  async function createCustomerInline() {
    if (!newCustomerName.trim()) return;
    setCreatingCustomer(true);
    setNewCustomerError(null);
    try {
      const name = newCustomerName.trim();
      const phone = newCustomerPhone.trim() || undefined;
      const id = await queueCustomerCreate({ name, phone });
      setCustomer({ id, name, phone: phone ?? null });
      setShowNewCustomerForm(false);
      setCustomerQuery("");
      setNewCustomerName("");
      setNewCustomerPhone("");
    } catch {
      setNewCustomerError("Couldn't add customer");
    } finally {
      setCreatingCustomer(false);
    }
  }

  return (
    <>
      <Topbar title="Checkout" subtitle="Search by name, SKU, or barcode" />
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6 lg:grid lg:grid-cols-[1.3fr_1fr] lg:overflow-hidden lg:p-8">
        <div className="flex flex-col gap-4 lg:overflow-hidden">
          <div className="flex flex-wrap gap-2">
            <ClearableInput
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onClear={() => setQuery("")}
              placeholder="Search products, orders… or scan a barcode"
              wrapperClassName="min-w-[200px] flex-1"
              className="w-full rounded-[10px] border border-brand-border bg-white px-4 py-3 text-sm outline-none focus:border-brand-accentDeep"
            />
            <Button variant="secondary" onClick={() => setShowScanner(true)}>
              Scan
            </Button>
            <Button variant="secondary" onClick={() => setShowHeld(true)} className="relative">
              Held sales
              {heldSales.length > 0 && (
                <span className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-brand-warn text-[10px] font-bold text-white">
                  {heldSales.length}
                </span>
              )}
            </Button>
          </div>
          {results && results.length > 0 && (
            <Card className="flex flex-col gap-1 p-2">
              {results.map((p) => (
                <button
                  key={p.id}
                  onClick={() => addToCart(p)}
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-left hover:bg-brand-bg"
                >
                  <div>
                    <div className="text-sm font-semibold text-brand-ink">{p.name}</div>
                    <div className={`text-xs ${p.stockQty <= 0 ? "font-semibold text-brand-warn" : "text-brand-inkMuted"}`}>
                      {p.sku} ·{" "}
                      {p.stockQty > 0 ? `${p.stockQty} in stock` : p.stockQty === 0 ? "Out of stock" : `${-p.stockQty} on backorder`}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-brand-ink">{currencyFmt.format(p.price)}</span>
                </button>
              ))}
            </Card>
          )}

          <Card className="lg:flex-1 lg:overflow-auto">
            <div className="mb-3 font-display text-[15px] font-bold text-brand-ink">Cart</div>
            {cart.length === 0 && <div className="text-sm text-brand-inkMuted">No items yet — search above to add products.</div>}
            <div className="flex flex-col gap-2">
              {cart.map((line) => (
                <div key={line.product.id} className="flex items-center justify-between rounded-[10px] bg-brand-bg px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-brand-ink">{line.product.name}</div>
                    <div className="text-xs text-brand-inkMuted">
                      {currencyFmt.format(line.product.price)} each
                      {line.quantity > 1 && (
                        <span className="ml-1 font-semibold text-brand-ink">
                          · {currencyFmt.format(line.product.price * line.quantity)} total
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => updateQuantity(line.product.id, line.quantity - 1)}
                      className="h-7 w-7 rounded-md bg-white text-brand-ink shadow-card"
                    >
                      −
                    </button>
                    <input
                      type="number"
                      min="1"
                      value={line.quantity}
                      onChange={(e) => updateQuantity(line.product.id, Math.trunc(Number(e.target.value)) || 0)}
                      aria-label={`Quantity for ${line.product.name}`}
                      className="w-12 rounded-md border border-brand-border bg-white px-1 py-1 text-center text-sm font-semibold outline-none focus:border-brand-accentDeep"
                    />
                    <button
                      onClick={() => updateQuantity(line.product.id, line.quantity + 1)}
                      className="h-7 w-7 rounded-md bg-white text-brand-ink shadow-card"
                    >
                      +
                    </button>
                    <button
                      onClick={() => removeFromCart(line.product.id)}
                      aria-label={`Remove ${line.product.name} from cart`}
                      className="h-7 w-7 rounded-md text-brand-inkMuted hover:bg-white hover:text-brand-warn"
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <Card className="flex flex-col gap-4 lg:overflow-auto">
          <div className="font-display text-[15px] font-bold text-brand-ink">Payment</div>

          <div className="flex flex-wrap gap-2">
            {PAYMENT_METHODS.map((method) => (
              <button
                key={method}
                onClick={() => setPaymentMethod(method)}
                className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
                  paymentMethod === method ? "bg-brand-accentDeep text-white" : "bg-brand-bg text-brand-inkMuted"
                }`}
              >
                {PAYMENT_METHOD_LABELS[method]}
              </button>
            ))}
          </div>

          {paymentMethod === "CASH" && (
            <label className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Amount tendered</span>
              <input
                type="number"
                min="0"
                value={amountTendered}
                onChange={(e) => setAmountTendered(e.target.value)}
                className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
              />
            </label>
          )}

          {paymentMethod === "MPESA_MANUAL" && (
            <p className="text-xs text-brand-inkMuted">
              For a customer who's already paid via M-Pesa outside this system (e.g. to a till or paybill number).
              Confirm the payment yourself, then complete the sale — no prompt is sent.
            </p>
          )}

          {paymentMethod === "MPESA" && (
            <div className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Customer's phone number</span>
              <ClearableInput
                type="tel"
                value={mpesaPhone}
                onChange={(e) => setMpesaPhone(e.target.value)}
                onClear={() => setMpesaPhone("")}
                placeholder="07XX XXX XXX"
                disabled={mpesaStatus === "sending" || mpesaStatus === "waiting"}
                className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep disabled:bg-brand-bg"
              />

              {mpesaStatus === "idle" && (
                <Button
                  variant="secondary"
                  className="mt-2 w-full"
                  onClick={() => void sendMpesaPush()}
                  disabled={!mpesaPhone.trim() || cart.length === 0}
                >
                  Send M-Pesa request
                </Button>
              )}
              {mpesaStatus === "sending" && <p className="mt-2 text-xs text-brand-inkMuted">Sending request…</p>}
              {mpesaStatus === "waiting" && (
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-brand-bg px-3 py-2 text-xs font-semibold text-brand-ink">
                  <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-brand-accentDeep" />
                  Waiting for the customer to enter their M-Pesa PIN…
                </div>
              )}
              {mpesaStatus === "success" && (
                <div className="mt-2 rounded-lg bg-brand-bg px-3 py-2 text-xs font-semibold text-brand-accentText">
                  Payment received{mpesaReceiptNumber ? ` — ${mpesaReceiptNumber}` : ""}
                </div>
              )}
              {mpesaStatus === "failed" && (
                <div className="mt-2 flex flex-col gap-2">
                  <div className="text-xs font-semibold text-brand-warn">{mpesaError ?? "Payment failed"}</div>
                  <Button variant="secondary" onClick={() => setMpesaStatus("idle")}>
                    Try again
                  </Button>
                </div>
              )}
            </div>
          )}

          {paymentMethod === "SPLIT" && (
            <div className="flex flex-col gap-2 text-sm">
              <span className="font-medium text-brand-ink">Split across methods</span>
              {splitRows.map((row, i) => (
                <div key={i} className="flex items-center gap-2">
                  <select
                    value={row.method}
                    onChange={(e) => updateSplitRow(i, { method: e.target.value as SplitPaymentEntry["method"] })}
                    className="rounded-lg border border-brand-border px-2 py-2 text-sm"
                  >
                    {SPLIT_METHODS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    min="0"
                    value={row.amount || ""}
                    onChange={(e) => updateSplitRow(i, { amount: Number(e.target.value) || 0 })}
                    placeholder="Amount"
                    className="flex-1 rounded-lg border border-brand-border px-3 py-2"
                  />
                  {splitRows.length > 2 && (
                    <button
                      onClick={() => setSplitRows((prev) => prev.filter((_, idx) => idx !== i))}
                      className="text-brand-inkMuted hover:text-brand-warn"
                    >
                      ✕
                    </button>
                  )}
                </div>
              ))}
              <button
                onClick={() => setSplitRows((prev) => [...prev, { method: "CASH", amount: 0 }])}
                className="w-fit text-xs font-semibold text-brand-accentText"
              >
                + Add another method
              </button>
              <div className={`text-xs font-semibold ${splitRemaining > 0.01 ? "text-brand-warn" : "text-brand-accentText"}`}>
                {splitRemaining > 0.01
                  ? `${currencyFmt.format(splitRemaining)} remaining`
                  : splitRemaining < -0.01
                    ? `${currencyFmt.format(-splitRemaining)} over the total`
                    : "Fully allocated"}
              </div>
            </div>
          )}

          {paymentMethod === "CREDIT" && (
            <div className="text-sm">
              <span className="mb-1 block font-medium text-brand-ink">Customer</span>
              {customer ? (
                <div className="flex items-center justify-between rounded-lg bg-brand-bg px-3 py-2">
                  <span className="font-semibold text-brand-ink">{customer.name}</span>
                  <button onClick={() => setCustomer(null)} className="text-xs text-brand-inkMuted hover:text-brand-ink">
                    Change
                  </button>
                </div>
              ) : showNewCustomerForm ? (
                <div className="flex flex-col gap-2 rounded-lg border border-brand-border p-3">
                  <ClearableInput
                    autoFocus
                    required
                    value={newCustomerName}
                    onChange={(e) => setNewCustomerName(e.target.value)}
                    onClear={() => setNewCustomerName("")}
                    placeholder="Customer name"
                    className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
                  />
                  <ClearableInput
                    value={newCustomerPhone}
                    onChange={(e) => setNewCustomerPhone(e.target.value)}
                    onClear={() => setNewCustomerPhone("")}
                    placeholder="Phone number (optional)"
                    className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
                  />
                  {newCustomerError && <div className="text-xs font-medium text-brand-warn">{newCustomerError}</div>}
                  <div className="flex gap-2">
                    <Button
                      variant="secondary"
                      className="flex-1 px-3 py-2 text-xs"
                      disabled={creatingCustomer}
                      onClick={() => setShowNewCustomerForm(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      className="flex-1 px-3 py-2 text-xs"
                      disabled={creatingCustomer || !newCustomerName.trim()}
                      onClick={() => void createCustomerInline()}
                    >
                      {creatingCustomer ? "Adding…" : "Save & select"}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="relative">
                  <ClearableInput
                    value={customerQuery}
                    onChange={(e) => setCustomerQuery(e.target.value)}
                    onClear={() => setCustomerQuery("")}
                    placeholder="Search customer by name or phone"
                    className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
                  />
                  {customerQuery.trim() && (
                    <div className="absolute z-10 mt-1 w-full rounded-lg border border-brand-border bg-white shadow-card">
                      {customerOptions.map((c) => (
                        <button
                          key={c.id}
                          onClick={() => setCustomer(c)}
                          className="block w-full px-3 py-2 text-left text-sm hover:bg-brand-bg"
                        >
                          {c.name} {c.phone && <span className="text-brand-inkMuted">· {c.phone}</span>}
                        </button>
                      ))}
                      <button
                        onClick={openNewCustomerForm}
                        className={`block w-full px-3 py-2 text-left text-sm font-semibold text-brand-accentText hover:bg-brand-bg ${
                          customerOptions.length > 0 ? "border-t border-brand-border" : ""
                        }`}
                      >
                        + Add "{customerQuery.trim()}" as a new customer
                      </button>
                    </div>
                  )}
                </div>
              )}
              <p className="mt-1 text-xs text-brand-inkMuted">
                Works offline too — a new customer syncs (and any credit limit is checked) once you're back online.
              </p>
            </div>
          )}

          <label className="text-sm">
            <span className="mb-1 block font-medium text-brand-ink">Coupon code (optional)</span>
            <ClearableInput
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
              onClear={() => setCouponCode("")}
              placeholder="e.g. SAVE50"
              className="w-full rounded-lg border border-brand-border px-3 py-2 outline-none focus:border-brand-accentDeep"
            />
          </label>

          <div className="mt-auto flex flex-col gap-2 border-t border-brand-border pt-4">
            <div className="flex justify-between text-sm text-brand-inkMuted">
              <span>Subtotal</span>
              <span>{currencyFmt.format(subtotal)}</span>
            </div>
            <div className="flex justify-between font-display text-lg font-bold text-brand-ink">
              <span>Total (estimated)</span>
              <span>{currencyFmt.format(total)}</span>
            </div>
            {paymentMethod === "CASH" && (
              <div className="flex justify-between text-sm font-semibold text-brand-accentText">
                <span>Change due</span>
                <span>{currencyFmt.format(changeDue)}</span>
              </div>
            )}
          </div>

          <div className="flex gap-3">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => void holdSale()}
              disabled={cart.length === 0 || mpesaStatus === "sending" || mpesaStatus === "waiting"}
            >
              Hold sale
            </Button>
            {paymentMethod !== "MPESA" && (
              <Button
                className="flex-1"
                onClick={() => void completeSale()}
                disabled={
                  cart.length === 0 ||
                  (paymentMethod === "CREDIT" && !customer) ||
                  (paymentMethod === "SPLIT" && splitRemaining > 0.01)
                }
              >
                Complete sale
              </Button>
            )}
          </div>
        </Card>
      </div>

      {completedSale && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-xs text-center">
            <div className="mb-2 font-display text-lg font-bold text-brand-ink">Sale complete</div>
            <div className="mb-1 text-sm text-brand-inkMuted">Total charged</div>
            <div className="mb-3 text-2xl font-bold text-brand-ink">{currencyFmt.format(completedSale.total)}</div>
            {completedSale.changeDue > 0 && (
              <div className="mb-4 text-sm font-semibold text-brand-accentText">
                Change due: {currencyFmt.format(completedSale.changeDue)}
              </div>
            )}
            {undoError && <div className="mb-3 text-xs font-medium text-brand-warn">{undoError}</div>}
            <Button className="w-full" onClick={printCompletedReceipt}>
              Print receipt
            </Button>
            <Button
              variant="secondary"
              className="mt-2 w-full"
              onClick={() => {
                setCompletedSale(null);
                setUndoError(null);
              }}
            >
              New sale
            </Button>
            <button
              onClick={() => void undoSale()}
              disabled={undoing}
              className="mt-2 w-full text-xs font-semibold text-brand-inkMuted hover:text-brand-warn disabled:opacity-60"
            >
              {undoing ? "Undoing…" : "Sold the wrong thing? Undo this sale"}
            </button>
          </Card>
        </div>
      )}

      {showHeld && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[80vh] w-full max-w-md overflow-auto">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-display text-lg font-bold text-brand-ink">Held sales</span>
              <button onClick={() => setShowHeld(false)} className="text-sm text-brand-inkMuted hover:text-brand-ink">
                ✕
              </button>
            </div>
            {heldSales.length === 0 && <div className="py-6 text-center text-sm text-brand-inkMuted">No held sales on this device.</div>}
            <div className="flex flex-col gap-2">
              {heldSales.map((h) => {
                const itemCount = h.items.reduce((sum, i) => sum + i.quantity, 0);
                const heldTotal = h.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);
                return (
                  <div key={h.id} className="flex items-center justify-between rounded-lg bg-brand-bg px-3 py-2.5">
                    <div>
                      <div className="text-sm font-semibold text-brand-ink">
                        {itemCount} item{itemCount === 1 ? "" : "s"} · {currencyFmt.format(heldTotal)}
                      </div>
                      <div className="text-xs text-brand-inkMuted">{new Date(h.createdAt).toLocaleTimeString("en-KE")}</div>
                    </div>
                    <div className="flex gap-2">
                      <Button className="px-3 py-1.5 text-xs" onClick={() => void resumeHeldSale(h.id)}>
                        Resume
                      </Button>
                      <Button variant="danger" className="px-3 py-1.5 text-xs" onClick={() => void discardHeldSale(h.id)}>
                        Discard
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      )}

      {showScanner && (
        <Suspense fallback={null}>
          <BarcodeScannerModal onScan={handleScan} onClose={() => setShowScanner(false)} />
        </Suspense>
      )}
    </>
  );
}
