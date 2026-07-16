import { useSyncExternalStore } from "react";
import { applyUpdate, isUpdateAvailable, subscribeToUpdateAvailable } from "../lib/swUpdate";
import { Button } from "./ui";

// Rendered once at the app root (see App.tsx) rather than per-page, since a
// new version can become available regardless of which screen is open.
// Reloading is left to the user rather than automatic — a cart mid-checkout
// only lives in memory, and force-reloading out from under a cashier would
// lose it.
export function UpdateBanner() {
  const needRefresh = useSyncExternalStore(subscribeToUpdateAvailable, isUpdateAvailable);

  if (!needRefresh) return null;

  return (
    <div className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-brand-accentDeep px-4 py-2 text-sm font-semibold text-white shadow-card">
      <span>A new version of this app is available.</span>
      <Button variant="secondary" className="px-3 py-1 text-xs" onClick={() => applyUpdate()}>
        Refresh now
      </Button>
    </div>
  );
}
