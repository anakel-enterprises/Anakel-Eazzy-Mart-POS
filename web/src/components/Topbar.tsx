import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "../db/localDb";
import { flushPendingSales } from "../lib/sync";
import { isApiReachable } from "../lib/api";

const REACHABILITY_CHECK_MS = 15_000;

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const [reachable, setReachable] = useState(true);
  const pendingCount = useLiveQuery(() => localDb.pendingSales.where("syncStatus").equals("pending").count(), [], 0);
  const errorCount = useLiveQuery(() => localDb.pendingSales.where("syncStatus").equals("error").count(), [], 0);

  useEffect(() => {
    let cancelled = false;
    const check = () => {
      void isApiReachable().then((ok) => {
        if (!cancelled) setReachable(ok);
      });
    };
    check();
    const interval = setInterval(check, REACHABILITY_CHECK_MS);
    window.addEventListener("online", check);
    window.addEventListener("offline", check);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("online", check);
      window.removeEventListener("offline", check);
    };
  }, []);

  return (
    <div className="flex h-[76px] shrink-0 items-center justify-between border-b border-brand-border px-8">
      <div>
        <div className="font-display text-xl font-bold text-brand-ink">{title}</div>
        {subtitle && <div className="text-[12.5px] text-brand-inkMuted">{subtitle}</div>}
      </div>
      <div className="flex items-center gap-3">
        {!reachable && (
          <span className="rounded-full bg-brand-warnBg px-3 py-1 text-xs font-semibold text-brand-warn">
            Offline — sales are queued on this device
          </span>
        )}
        {reachable && pendingCount > 0 && (
          <span className="rounded-full bg-brand-accent/20 px-3 py-1 text-xs font-semibold text-brand-accentText">
            Syncing {pendingCount} sale{pendingCount === 1 ? "" : "s"}…
          </span>
        )}
        {errorCount > 0 && (
          <button
            onClick={() => void flushPendingSales()}
            className="rounded-full bg-brand-warnBg px-3 py-1 text-xs font-semibold text-brand-warn"
          >
            {errorCount} sale{errorCount === 1 ? "" : "s"} failed to sync — tap to retry
          </button>
        )}
      </div>
    </div>
  );
}
