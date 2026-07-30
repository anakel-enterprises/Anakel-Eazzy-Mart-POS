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

// Characters per line for an 80mm thermal roll at the printer's normal font
// (the standard ESC/POS "Font A" width most 80mm receipt printers default
// to). If receipts come out wrapping a couple of characters too early/late
// on your printer, this is the one number to adjust — everything below is
// laid out relative to it. For 58mm paper this is usually closer to 32.
const WIDTH = 42;
// How much room the rightmost (amount) column gets on a two-column line —
// the rest of the width is the label/description side. 10 comfortably fits
// "-12,345.00" (a discount line, the longest value a small shop's receipt
// should ever need) without crowding the label side.
const AMOUNT_WIDTH = 10;
const LABEL_WIDTH = WIDTH - AMOUNT_WIDTH;

const numberFmt = new Intl.NumberFormat("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function padRight(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : text + " ".repeat(width - text.length);
}

function padLeft(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width) : " ".repeat(width - text.length) + text;
}

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return " ".repeat(left) + text + " ".repeat(width - text.length - left);
}

function divider(): string {
  return "-".repeat(WIDTH);
}

// A label/value pair on one line, e.g. "Subtotal                    730.00" —
// the label is left-aligned, the value right-aligned, always summing to
// exactly WIDTH characters regardless of how long either side is. This (not
// an HTML table) is what actually keeps columns aligned once printed:
// several common thermal-printer setups — a "Generic / Text Only" Windows
// driver in particular — discard HTML/CSS layout entirely and print only
// the raw characters, so alignment has to already be baked into the text.
function row(label: string, value: string): string {
  return padRight(label, LABEL_WIDTH) + padLeft(value, AMOUNT_WIDTH);
}

// Greedy word-wrap to WIDTH characters — a long product name spans as many
// full lines as it needs instead of running into the qty/price line below
// it (the exact failure in the original table-based layout).
function wrapText(text: string, width: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > width) {
      if (current) lines.push(current);
      // A single word longer than the whole line (rare, but a barcode-ish
      // SKU could do it) — hard-break it rather than overflow.
      current = word.length > width ? word.slice(0, width) : word;
      if (word.length > width) {
        lines.push(current);
        current = word.slice(width);
      }
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

// Builds the receipt as plain fixed-width text — pulled out from
// printReceipt() so the exact character grid can be inspected/tested
// without a browser. Not an HTML table: several common thermal-printer
// setups (a "Generic / Text Only" Windows driver in particular) discard
// HTML/CSS layout entirely and print only the raw characters, so alignment
// has to already be baked into the text itself — see the `row()` comment.
export function buildReceiptText(sale: ReceiptData, store: ReceiptStore | null): string {
  const out: string[] = [];

  out.push(center(store?.name ?? "Receipt", WIDTH));
  if (store?.address) out.push(center(store.address, WIDTH));
  if (store?.phone) out.push(center(store.phone, WIDTH));
  out.push(divider());
  out.push(`Receipt #${sale.clientId.slice(0, 10).toUpperCase()}`);
  out.push(new Date(sale.createdAt).toLocaleString("en-KE"));
  out.push(`Served by: ${sale.cashierName}`);
  if (sale.customerName) out.push(`Customer: ${sale.customerName}`);
  out.push(divider());
  out.push(row("Item", "Total"));
  out.push(divider());

  for (const line of sale.lines) {
    for (const wrapped of wrapText(line.name, WIDTH)) out.push(wrapped);
    const qtyPrice = `  ${line.quantity} x ${numberFmt.format(line.unitPrice)}`;
    out.push(row(qtyPrice, numberFmt.format(line.unitPrice * line.quantity)));
  }
  out.push(divider());

  out.push(row("Subtotal", numberFmt.format(sale.subtotal)));
  const discount = sale.subtotal - sale.total;
  if (discount > 0.001) {
    out.push(row(sale.couponCode ? `Discount (${sale.couponCode})` : "Discount", `-${numberFmt.format(discount)}`));
  }
  out.push(row("TOTAL (KSH)", numberFmt.format(sale.total)));
  // Left-aligned, not run through row()/AMOUNT_WIDTH like the money lines
  // above — "M-PESA PROMPT" and friends are longer than the 10-char amount
  // column and would get silently truncated if squeezed into it.
  out.push(`Payment: ${PAYMENT_METHOD_LABELS[sale.paymentMethod] ?? sale.paymentMethod}`);
  if (sale.paymentMethod === "CASH") {
    out.push(row("Tendered", numberFmt.format(sale.amountTendered ?? 0)));
    out.push(row("Change", numberFmt.format(sale.changeDue)));
  }
  out.push(divider());
  out.push(center("Thank you for shopping with us!", WIDTH));

  return out.join("\n");
}

// Opens a small popup window with the receipt text above and triggers the
// browser's print dialog — the standard way to print from a web POS
// without a native print-driver integration. Uses the figures already
// shown on the "Sale complete" screen (what was actually charged/collected
// at the counter) rather than re-fetching the synced server total, so the
// receipt always matches what the cashier and customer already agreed on —
// including while this device is still offline.
export function printReceipt(sale: ReceiptData, store: ReceiptStore | null): void {
  const win = window.open("", "_blank", "width=380,height=640");
  if (!win) return; // popup blocked — nothing more to do without another user gesture

  const receiptText = escapeHtml(buildReceiptText(sale, store));

  win.document.write(`<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt</title>
<style>
  @page { size: 80mm auto; margin: 5mm 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 8px 6px; }
  pre {
    margin: 0;
    font-family: "Courier New", Courier, monospace;
    font-size: 12px;
    line-height: 1.35;
    white-space: pre;
  }
</style>
</head>
<body>
<pre>${receiptText}</pre>
</body>
</html>`);
  win.document.close();
  win.focus();
  // A brief delay lets the popup finish laying out the just-written document
  // before print() captures it — calling print() synchronously right after
  // write() can occasionally grab a blank page in some browsers.
  setTimeout(() => win.print(), 150);
}
