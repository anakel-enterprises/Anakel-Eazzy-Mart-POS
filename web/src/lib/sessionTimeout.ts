// Idle-based session timeout, independent of the JWT's own (long, 30-day)
// expiry. The token stays valid across a slow offline shift, but the app
// itself should still force a fresh login if the device sits untouched —
// including a PWA that was simply closed and reopened hours or days later,
// which is exactly the case a running setInterval can't catch on its own.
const LAST_ACTIVITY_KEY = "last_activity";

export const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes idle

export function recordActivity(): void {
  localStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
}

export function clearActivity(): void {
  localStorage.removeItem(LAST_ACTIVITY_KEY);
}

// No recorded activity (e.g. a session from before this feature existed, or
// one that was already cleared) is treated as timed out — the safe default
// for a security control is to require a fresh login, not to grandfather it in.
export function isSessionTimedOut(): boolean {
  const raw = localStorage.getItem(LAST_ACTIVITY_KEY);
  if (!raw) return true;
  const last = Number(raw);
  if (!Number.isFinite(last)) return true;
  return Date.now() - last > SESSION_TIMEOUT_MS;
}
