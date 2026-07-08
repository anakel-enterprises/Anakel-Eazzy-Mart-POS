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
export async function apiFetch<T>(path: string, options: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const token = getToken();
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
    throw new ApiError(res.status, message);
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  get: <T>(path: string) => apiFetch<T>(path),
  post: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "POST", body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    apiFetch<T>(path, { method: "PUT", body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: "DELETE" }),
};

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
