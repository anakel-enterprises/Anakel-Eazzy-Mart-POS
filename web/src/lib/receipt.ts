import { PAYMENT_METHOD_LABELS, type PaymentMethod } from "./paymentMethods";

export interface ReceiptStore {
  name: string;
  address: string | null;
  phone: string | null;
}

export interface ReceiptLine {
  name: string;
  quantity: number;
  unitPrice: number;
}

export interface ReceiptData {
  clientId: string;
  createdAt: string;
  lines: ReceiptLine[];
  subtotal: number;
  total: number;
  paymentMethod: PaymentMethod;
  amountTendered?: number;
  changeDue: number;
  customerName?: string;
  couponCode?: string;
  cashierName: string;
}

const currencyFmt = new Intl.NumberFormat("en-KE", { style: "currency", currency: "KES" });

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// Opens a small popup window with a printable, thermal-receipt-style layout
// and triggers the browser's print dialog — the standard way to print from
// a web POS without a native print-driver integration. Uses the figures
// already shown on the "Sale complete" screen (what was actually
// charged/collected at the counter) rather than re-fetching the synced
// server total, so the receipt always matches what the cashier and customer
// already agreed on — including while this device is still offline.
export function printReceipt(sale: ReceiptData, store: ReceiptStore | null): void {
  const win = window.open("", "_blank", "width=380,height=640");
  if (!win) return; // popup blocked — nothing more to do without another user gesture

  const rowsHtml = sale.lines
    .map(
      (l) => `
      <tr>
        <td>${escapeHtml(l.name)}</td>
        <td class="center">${l.quantity}</td>
        <td class="right">${currencyFmt.format(l.unitPrice)}</td>
        <td class="right">${currencyFmt.format(l.unitPrice * l.quantity)}</td>
      </tr>`
    )
    .join("");

  const discount = sale.subtotal - sale.total;

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: "Courier New", Courier, monospace; font-size: 12px; color: #000; width: 300px; margin: 0 auto; padding: 14px; }
  h1 { font-size: 15px; text-align: center; margin: 0 0 2px; }
  .center { text-align: center; }
  .right { text-align: right; }
  .muted { color: #444; font-size: 11px; }
  .divider { border-top: 1px dashed #000; margin: 8px 0; }
  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 10px; border-bottom: 1px dashed #000; padding-bottom: 3px; }
  tbody td { padding: 2px 0; vertical-align: top; }
  .totals td { padding-top: 2px; }
  .bold { font-weight: bold; }
  .totals .grand td { font-size: 13px; padding-top: 6px; }
</style>
</head>
<body>
  <h1>${escapeHtml(store?.name ?? "Receipt")}</h1>
  ${store?.address ? `<div class="center muted">${escapeHtml(store.address)}</div>` : ""}
  ${store?.phone ? `<div class="center muted">${escapeHtml(store.phone)}</div>` : ""}
  <div class="divider"></div>
  <div>Receipt #${escapeHtml(sale.clientId.slice(0, 10).toUpperCase())}</div>
  <div>${new Date(sale.createdAt).toLocaleString("en-KE")}</div>
  <div>Served by: ${escapeHtml(sale.cashierName)}</div>
  ${sale.customerName ? `<div>Customer: ${escapeHtml(sale.customerName)}</div>` : ""}
  <div class="divider"></div>
  <table>
    <thead><tr><th>Item</th><th class="center">Qty</th><th class="right">Price</th><th class="right">Total</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="divider"></div>
  <table class="totals">
    <tr><td>Subtotal</td><td class="right">${currencyFmt.format(sale.subtotal)}</td></tr>
    ${
      discount > 0.001
        ? `<tr><td>Discount${sale.couponCode ? ` (${escapeHtml(sale.couponCode)})` : ""}</td><td class="right">-${currencyFmt.format(discount)}</td></tr>`
        : ""
    }
    <tr class="grand bold"><td>TOTAL</td><td class="right">${currencyFmt.format(sale.total)}</td></tr>
    <tr><td>Payment</td><td class="right">${PAYMENT_METHOD_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</td></tr>
    ${
      sale.paymentMethod === "CASH"
        ? `<tr><td>Tendered</td><td class="right">${currencyFmt.format(sale.amountTendered ?? 0)}</td></tr>
           <tr><td>Change</td><td class="right">${currencyFmt.format(sale.changeDue)}</td></tr>`
        : ""
    }
  </table>
  <div class="divider"></div>
  <div class="center muted">Thank you for shopping with us!</div>
</body>
</html>`);
  win.document.close();
  win.focus();
  // A brief delay lets the popup finish laying out the just-written document
  // before print() captures it — calling print() synchronously right after
  // write() can occasionally grab a blank page in some browsers.
  setTimeout(() => win.print(), 150);
}
