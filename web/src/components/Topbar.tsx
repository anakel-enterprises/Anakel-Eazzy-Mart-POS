import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { localDb } from "../db/localDb";
import { flushPendingSales } from "../lib/sync";
import { isApiReachable } from "../lib/api";
import { useSidebar } from "../context/SidebarContext";

const REACHABILITY_CHECK_MS = 15_000;

export function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  const [reachable, setReachable] = useState(true);
  const { toggle } = useSidebar();
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
    <div className="flex min-h-[68px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-brand-border px-4 py-3 lg:min-h-[76px] lg:px-8 lg:py-0">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={toggle}
          aria-label="Open menu"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-brand-ink hover:bg-brand-bg lg:hidden"
        >
          <span className="sr-only">Menu</span>
          <div className="flex flex-col gap-[3px]">
            <span className="h-[2px] w-5 bg-brand-ink" />
            <span className="h-[2px] w-5 bg-brand-ink" />
            <span className="h-[2px] w-5 bg-brand-ink" />
          </div>
        </button>
        <div className="min-w-0">
          <div className="truncate font-display text-lg font-bold text-brand-ink lg:text-xl">{title}</div>
          {subtitle && <div className="truncate text-[12.5px] text-brand-inkMuted">{subtitle}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
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
