import { registerSW } from "virtual:pwa-register";

// Chrome only checks the network for a new service worker on a real page
// navigation. A cashier who installs this app once and then just resumes it
// from Android's app switcher — the normal way to "open" an installed
// PWA — may go a long time without a fresh navigation ever happening, so
// the installed app can silently run whatever build was current on install
// day indefinitely. Polling registration.update() on a timer, and again
// whenever the app comes back to the foreground, is what actually keeps a
// long-lived installed instance converging on the latest deploy.
const CHECK_INTERVAL_MS = 15 * 60_000;

let needsRefreshApply: (() => void) | null = null;
const listeners = new Set<() => void>();

function setNeedsRefresh(apply: () => void) {
  needsRefreshApply = apply;
  for (const listener of listeners) listener();
}

export function subscribeToUpdateAvailable(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function isUpdateAvailable(): boolean {
  return needsRefreshApply !== null;
}

// Reloads to pick up the already-downloaded new version. Left to the user
// to trigger (via the update banner) rather than applied automatically, so
// a cart mid-checkout — kept only in memory — isn't silently wiped out.
export function applyUpdate(): void {
  needsRefreshApply?.();
}

export function initServiceWorkerUpdates(): void {
  let registration: ServiceWorkerRegistration | undefined;

  const updateSW = registerSW({
    immediate: true,
    onRegisteredSW(_url, reg) {
      registration = reg;
    },
    onNeedRefresh() {
      setNeedsRefresh(() => updateSW(true));
    },
  });

  const checkForUpdate = () => void registration?.update().catch(() => {});
  setInterval(checkForUpdate, CHECK_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") checkForUpdate();
  });
}
