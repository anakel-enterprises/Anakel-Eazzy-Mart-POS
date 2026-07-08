import { useEffect, useRef, useState } from "react";
import { BrowserMultiFormatReader } from "@zxing/browser";
import type { IScannerControls } from "@zxing/browser";
import { Button, Card } from "./ui";

export function BarcodeScannerModal({ onScan, onClose }: { onScan: (value: string) => void; onClose: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const reader = new BrowserMultiFormatReader();
    let cancelled = false;

    reader
      .decodeFromVideoDevice(undefined, videoRef.current!, (result, err, controls) => {
        controlsRef.current = controls;
        if (cancelled) return;
        if (result) {
          onScan(result.getText());
          controls.stop();
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't access the camera — check browser permissions.");
      });

    return () => {
      cancelled = true;
      controlsRef.current?.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-3 flex items-center justify-between">
          <span className="font-display text-[15px] font-bold text-brand-ink">Scan barcode</span>
          <button onClick={onClose} className="text-sm text-brand-inkMuted hover:text-brand-ink">
            ✕
          </button>
        </div>
        {error ? (
          <div className="py-6 text-center text-sm font-medium text-brand-warn">{error}</div>
        ) : (
          <video ref={videoRef} className="w-full rounded-lg bg-black" muted playsInline />
        )}
        <Button variant="secondary" className="mt-3 w-full" onClick={onClose}>
          Cancel
        </Button>
      </Card>
    </div>
  );
}
