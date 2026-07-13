import { api } from "./api";
import { localDb } from "../db/localDb";

export interface CachedResult<T> {
  data: T;
  // true if this came from the local cache because the live request failed
  // (offline, unreachable, timed out) — not a normal "still loading" state.
  stale: boolean;
  // when this data was actually fetched from the server, whether that
  // happened just now or on some earlier successful request.
  cachedAt: string | null;
}

// GET with a local fallback: try the network first so online users always
// see live data, and only fall back to the last successful response when the
// request fails. `cacheKey` defaults to `path` but callers should pass a
// stable one explicitly whenever `path` embeds something that changes on
// every call without changing what's actually being asked for — e.g. a
// "to=<now>" timestamp on a rolling date range. Using the raw path as the
// key in that case would mean every call misses the cache it just wrote,
// since the exact URL is never repeated. Every successful fetch refreshes
// the cache, so the fallback is always the most recent data this device has
// actually seen — not a fixed snapshot.
export async function getCached<T>(path: string, cacheKey: string = path): Promise<CachedResult<T>> {
  try {
    const data = await api.get<T>(path);
    const cachedAt = new Date().toISOString();
    await localDb.apiCache.put({ url: cacheKey, data, cachedAt });
    return { data, stale: false, cachedAt };
  } catch (err) {
    const cached = await localDb.apiCache.get(cacheKey);
    if (cached) {
      return { data: cached.data as T, stale: true, cachedAt: cached.cachedAt };
    }
    throw err;
  }
}
