import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "../db/localDb";
import { flushPendingSales } from "../lib/sync";

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const [online, setOnline] = useState(navigator.onLine);
  const pendingCount = useLiveQuery(
    () => localDb.pendingSales.where("syncStatus").anyOf("pending", "error").count(),
    [],
    0
  );

  useEffect(() => {
    const goOnline = () => setOnline(true);
    const goOffline = () => setOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  return (
    <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-brand-border px-8">
      <div>
        <div className="font-display text-xl font-bold text-brand-ink">{title}</div>
        {subtitle && <div className="text-[12.5px] text-brand-inkMuted">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-4">
        {!online && (
          <span className="rounded-full bg-brand-warnBg px-3 py-1 text-xs font-semibold text-brand-warn">
            Offline — sales are queued
          </span>
        )}
        {online && pendingCount > 0 && (
          <button
            onClick={() => void flushPendingSales()}
            className="rounded-full bg-brand-accent/20 px-3 py-1 text-xs font-semibold text-brand-accentText"
          >
            Syncing {pendingCount} sale{pendingCount === 1 ? "" : "s"}…
          </button>
        )}
      </div>
    </div>
  );
}
