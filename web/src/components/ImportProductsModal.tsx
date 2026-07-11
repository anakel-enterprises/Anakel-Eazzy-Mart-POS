import { useState } from "react";
import { api } from "../lib/api";
import { parseCsv } from "../lib/csv";
import { Button, Card } from "./ui";

interface ImportField {
  key: "name" | "sku" | "barcode" | "category" | "price" | "cost" | "stockQty" | "lowStockThreshold";
  label: string;
  required: boolean;
}

const IMPORT_FIELDS: ImportField[] = [
  { key: "name", label: "Product Name", required: true },
  { key: "sku", label: "SKU", required: false },
  { key: "barcode", label: "Barcode", required: false },
  { key: "category", label: "Category", required: false },
  { key: "price", label: "Selling Price", required: true },
  { key: "cost", label: "Buying Price / Cost", required: false },
  { key: "stockQty", label: "Stock Qty", required: false },
  { key: "lowStockThreshold", label: "Re-order Level", required: false },
];

const GUESS_KEYWORDS: Record<ImportField["key"], string[]> = {
  name: ["product name", "item name", "name", "product", "item", "description", "title"],
  sku: ["sku", "item code", "product code", "code"],
  barcode: ["barcode", "upc", "ean"],
  category: ["category", "department", "dept", "group"],
  price: ["selling price", "retail price", "sale price", "price", "sell"],
  cost: ["buying price", "cost price", "purchase price", "cost", "buy price", "wholesale"],
  stockQty: ["stock qty", "quantity", "on hand", "stock", "qty", "inventory"],
  lowStockThreshold: ["reorder level", "re-order level", "min stock", "minimum stock", "reorder", "low stock"],
};

function guessMapping(headers: string[]): Record<ImportField["key"], number | null> {
  const used = new Set<number>();
  const mapping = {} as Record<ImportField["key"], number | null>;
  for (const field of IMPORT_FIELDS) {
    let found: number | null = null;
    for (const kw of GUESS_KEYWORDS[field.key]) {
      const idx = headers.findIndex((h, i) => !used.has(i) && h.trim().toLowerCase().includes(kw));
      if (idx !== -1) {
        found = idx;
        break;
      }
    }
    mapping[field.key] = found;
    if (found !== null) used.add(found);
  }
  return mapping;
}

function parseNumber(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^0-9.-]/g, "");
  if (!cleaned) return undefined;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : undefined;
}

interface ImportRow {
  name?: string;
  sku?: string;
  barcode?: string;
  category?: string;
  price?: number;
  cost?: number;
  stockQty?: number;
  lowStockThreshold?: number;
}

interface ImportResult {
  created: number;
  updated: number;
  errors: { row: number; reason: string }[];
}

type Step = "upload" | "map" | "preview" | "result";

export function ImportProductsModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [dataRows, setDataRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<ImportField["key"], number | null>>({} as Record<ImportField["key"], number | null>);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function handleFile(file: File) {
    setError(null);
    const isCsv = /\.csv$/i.test(file.name) || file.type === "text/csv";
    if (!isCsv) {
      setError(
        "That doesn't look like a CSV file. If your export is an Excel file (.xlsx), open it and use \"Save As\" / \"Export\" → CSV, then upload the .csv."
      );
      return;
    }
    const text = await file.text();
    const parsed = parseCsv(text);
    if (parsed.length < 2) {
      setError("Couldn't find any data rows — make sure the first row is a header row followed by your products.");
      return;
    }
    const [headerRow, ...rows] = parsed;
    setFileName(file.name);
    setHeaders(headerRow);
    setDataRows(rows);
    setMapping(guessMapping(headerRow));
    setStep("map");
  }

  function buildRows(): { valid: ImportRow[]; invalidCount: number } {
    const valid: ImportRow[] = [];
    let invalidCount = 0;
    for (const row of dataRows) {
      const get = (key: ImportField["key"]) => {
        const idx = mapping[key];
        return idx == null ? undefined : row[idx]?.trim() || undefined;
      };
      const name = get("name");
      const price = parseNumber(get("price"));
      if (!name || price === undefined || price <= 0) {
        invalidCount++;
        continue;
      }
      valid.push({
        name,
        sku: get("sku"),
        barcode: get("barcode"),
        category: get("category"),
        price,
        cost: parseNumber(get("cost")),
        stockQty: parseNumber(get("stockQty")),
        lowStockThreshold: parseNumber(get("lowStockThreshold")),
      });
    }
    return { valid, invalidCount };
  }

  async function handleImport() {
    const { valid } = buildRows();
    if (valid.length === 0) return;
    setImporting(true);
    setError(null);
    try {
      const res = await api.post<ImportResult>("/api/products/import", { rows: valid });
      setResult(res);
      setStep("result");
      onImported();
    } catch {
      setError("Import failed — check your connection and try again.");
    } finally {
      setImporting(false);
    }
  }

  const { valid: previewValid, invalidCount } = step === "preview" || step === "map" ? buildRows() : { valid: [], invalidCount: 0 };
  const missingRequired = IMPORT_FIELDS.filter((f) => f.required && mapping[f.key] == null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden">
        <div className="mb-4 flex items-center justify-between">
          <span className="font-display text-[15px] font-bold text-brand-ink">Import products</span>
          <button onClick={onClose} className="text-sm text-brand-inkMuted hover:text-brand-ink">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {step === "upload" && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-brand-inkMuted">
                Export your other POS's product list as a CSV file (Product Name, Buying Price, Selling Price, etc — any column
                order or names are fine, you'll match them up next), then upload it here.
              </p>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleFile(file);
                }}
                className="rounded-lg border border-dashed border-brand-border px-3 py-6 text-sm text-brand-inkMuted"
              />
              {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
            </div>
          )}

          {step === "map" && (
            <div className="flex flex-col gap-4">
              <div className="text-xs text-brand-inkMuted">
                {fileName} — {dataRows.length} row{dataRows.length === 1 ? "" : "s"} found. Match each field to a column from your
                file.
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {IMPORT_FIELDS.map((field) => (
                  <label key={field.key} className="text-sm">
                    <span className="mb-1 block font-medium text-brand-ink">
                      {field.label}
                      {field.required && <span className="text-brand-warn"> *</span>}
                    </span>
                    <select
                      value={mapping[field.key] ?? ""}
                      onChange={(e) =>
                        setMapping((prev) => ({ ...prev, [field.key]: e.target.value === "" ? null : Number(e.target.value) }))
                      }
                      className="w-full rounded-lg border border-brand-border px-3 py-2 text-sm"
                    >
                      <option value="">— Not in file —</option>
                      {headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `Column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {missingRequired.length > 0 && (
                <div className="text-sm font-medium text-brand-warn">
                  Map {missingRequired.map((f) => f.label).join(" and ")} to continue.
                </div>
              )}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep("upload")}>
                  Back
                </Button>
                <Button onClick={() => setStep("preview")} disabled={missingRequired.length > 0}>
                  Next: Preview
                </Button>
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="flex flex-col gap-3">
              <div className="text-sm text-brand-inkMuted">
                <span className="font-semibold text-brand-accentText">{previewValid.length}</span> product
                {previewValid.length === 1 ? "" : "s"} ready to import
                {invalidCount > 0 && (
                  <>
                    {" "}
                    — <span className="font-semibold text-brand-warn">{invalidCount}</span> row{invalidCount === 1 ? "" : "s"} skipped
                    (missing name or a valid selling price)
                  </>
                )}
                . Products already in your inventory with a matching SKU will have their price/category updated instead of being
                duplicated; stock levels are only set for brand-new products.
              </div>
              <div className="overflow-x-auto rounded-lg border border-brand-border">
                <div className="min-w-[560px]">
                  <div className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] border-b border-brand-border bg-brand-bg px-3 py-2 text-[11px] font-semibold text-brand-inkMuted">
                    <span>NAME</span>
                    <span>SKU</span>
                    <span>CATEGORY</span>
                    <span>COST</span>
                    <span>PRICE</span>
                  </div>
                  {previewValid.slice(0, 10).map((r, i) => (
                    <div key={i} className="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center border-b border-brand-border/60 px-3 py-2 text-sm">
                      <span className="truncate font-semibold text-brand-ink">{r.name}</span>
                      <span className="truncate text-brand-inkMuted">{r.sku ?? "auto"}</span>
                      <span className="truncate text-brand-inkMuted">{r.category ?? "—"}</span>
                      <span className="text-brand-inkMuted">{r.cost != null ? r.cost.toFixed(2) : "—"}</span>
                      <span className="font-semibold">{r.price?.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
              {previewValid.length > 10 && (
                <div className="text-xs text-brand-inkMuted">…and {previewValid.length - 10} more.</div>
              )}
              {error && <div className="text-sm font-medium text-brand-warn">{error}</div>}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setStep("map")} disabled={importing}>
                  Back
                </Button>
                <Button onClick={() => void handleImport()} disabled={importing || previewValid.length === 0}>
                  {importing ? "Importing…" : `Import ${previewValid.length} product${previewValid.length === 1 ? "" : "s"}`}
                </Button>
              </div>
            </div>
          )}

          {step === "result" && result && (
            <div className="flex flex-col gap-3">
              <div className="text-sm text-brand-ink">
                <span className="font-semibold text-brand-accentText">{result.created}</span> new product
                {result.created === 1 ? "" : "s"} added,{" "}
                <span className="font-semibold text-brand-accentText">{result.updated}</span> existing product
                {result.updated === 1 ? "" : "s"} updated.
              </div>
              {result.errors.length > 0 && (
                <div className="rounded-lg bg-brand-warnBg px-3 py-2 text-sm text-brand-warn">
                  {result.errors.length} row{result.errors.length === 1 ? "" : "s"} failed:
                  <ul className="mt-1 list-inside list-disc">
                    {result.errors.slice(0, 5).map((e) => (
                      <li key={e.row}>
                        Row {e.row}: {e.reason}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <Button onClick={onClose}>Done</Button>
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
