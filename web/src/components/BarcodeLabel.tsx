import { useEffect, useRef } from "react";
import JsBarcode from "jsbarcode";

export function BarcodeLabel({
  value,
  name,
  price,
  width = 1.6,
  height = 40,
}: {
  value: string;
  name?: string;
  price?: string;
  width?: number;
  height?: number;
}) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current) return;
    try {
      JsBarcode(svgRef.current, value, {
        format: "CODE128",
        width,
        height,
        displayValue: true,
        fontSize: 12,
        margin: 4,
      });
    } catch {
      // invalid barcode value (e.g. empty) — leave the SVG blank
    }
  }, [value, width, height]);

  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-brand-border bg-white p-2 text-center">
      {name && <div className="max-w-[160px] truncate text-[11px] font-semibold text-brand-ink">{name}</div>}
      <svg ref={svgRef} />
      {price && <div className="text-[11px] font-bold text-brand-ink">{price}</div>}
    </div>
  );
}
