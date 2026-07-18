const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:4000";
const DEFAULT_TIMEOUT_MS = 15000;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

// Bare fetch() has no timeout — on a flaky connection a hung request could
// block indefinitely, and since the sync queue awaits requests one at a time
// under a mutex, a single stuck request would silently stall all sync until
// the browser's own (much longer) TCP timeout eventually gives up.
export async function apiFetch<T>(
  path: string,
  options: RequestInit = {},
  timeoutMs = DEFAULT_TIMEOUT_MS,
  tokenOverride?: string
): Promise<T> {
  const token = tokenOverride ?? getToken();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers,
      },
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new ApiError(0, "Request timed out");
    }
    throw new ApiError(0, "Network error");
  } finally {
    clearTimeout(timeout);
  }

  if (!res.ok) {
    let message = res.statusText;
    try {
      const body = await res.json();
      message = body.error ?? message;
    } catch {
      // response body wasn't JSON — fall back to statusText
    }

    // A 401 here means the session is actually invalid (bad/expired token,
    // or the account was disabled) — previously this just made every page
    // silently render empty lists with no indication why. Clear the stale
    // session and let AuthContext/ProtectedRoutes redirect to login instead.
    // Only when it's the *ambient* session's token, though — a tokenOverride
    // request (e.g. background-syncing a sale queued by a different, since
    // logged-out employee) failing must never log out whoever is actually
    // using the device right now.
    if (res.status === 401 && tokenOverride === undefined) {
      localStorage.removeItem("auth_token");
      localStorage.removeItem("auth_user");
      window.dispatchEvent(new Event("auth:session-expired"));
    }

    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown, timeoutMs?: number) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }, timeoutMs),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
  // Posts as a specific, already-known token rather than whatever's in the
  // active session — see PendingSale.authToken for why this matters.
  postAsUser: <T>(path: string, body: unknown, token: string) =>
    apiFetch<T>(path, { method: "POST", body: JSON.stringify(body) }, DEFAULT_TIMEOUT_MS, token),
};

export function getAuthToken(): string | null {
  return getToken();
}

// A real reachability check — navigator.onLine only reports whether *some*
// network interface is up, not whether the API is actually reachable (e.g.
// connected to a WiFi router with no internet, or a captive portal).
export async function isApiReachable(): Promise<boolean> {
  try {
    await apiFetch("/health", {}, 4000);
    return true;
  } catch {
    return false;
  }
}
