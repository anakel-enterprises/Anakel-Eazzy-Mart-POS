import { localDb } from "../db/localDb";
import type { AuthUser } from "../types/auth";

// PBKDF2-SHA256 iteration count for the locally-cached login credential.
// Stored per-record (not hardcoded at verify time) so a future bump doesn't
// break records written under an older value. This is a much smaller cost
// than a server-side password hash would use — the threat model here is a
// lost/stolen device's local storage, not defending a centralized password
// database, and it has to stay fast enough for a till on modest hardware.
const PBKDF2_ITERATIONS = 200_000;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<string> {
  const keyMaterial = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" },
    keyMaterial,
    256
  );
  return toHex(new Uint8Array(bits));
}

// Called after every successful *online* login so this device can verify the
// same credentials again later without contacting the server. The password
// is never stored — only a salted PBKDF2 hash of it, plus the freshly issued
// JWT (which is what actually authenticates API calls once "logged in" this
// way; there's no way to mint a new one offline, only reuse the last real
// one as long as it hasn't expired). Overwrites any previous record for this
// email, so a changed password — or simply a fresher token — always wins the
// next time its owner logs in online.
export async function cacheOfflineCredential(email: string, password: string, token: string, user: AuthUser): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, PBKDF2_ITERATIONS);
  await localDb.offlineCredentials.put({
    email: email.trim().toLowerCase(),
    salt: toHex(salt),
    hash,
    iterations: PBKDF2_ITERATIONS,
    token,
    user,
    updatedAt: new Date().toISOString(),
  });
}

export type OfflineLoginResult =
  | { ok: true; token: string; user: AuthUser }
  | { ok: false; reason: "no-record" | "wrong-password" | "token-expired" };

// Verifies a login attempt purely from this device's local cache. Only
// meant to be tried when the server genuinely can't be reached — see
// AuthContext.login, which is the sole caller.
export async function tryOfflineLogin(email: string, password: string): Promise<OfflineLoginResult> {
  const record = await localDb.offlineCredentials.get(email.trim().toLowerCase());
  if (!record) return { ok: false, reason: "no-record" };

  const candidate = await derive(password, fromHex(record.salt), record.iterations);
  if (candidate !== record.hash) return { ok: false, reason: "wrong-password" };

  if (isJwtExpired(record.token)) return { ok: false, reason: "token-expired" };

  return { ok: true, token: record.token, user: record.user };
}

// Reads a JWT's `exp` claim without verifying its signature — there's no way
// to check that offline anyway, and requireAuth re-verifies it server-side
// on the next real request regardless. This only rules out handing back a
// token the server would already reject as expired the moment it's used.
function isJwtExpired(token: string): boolean {
  try {
    const payloadB64 = token.split(".")[1];
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/"))) as { exp?: number };
    if (typeof payload.exp !== "number") return true;
    return Date.now() >= payload.exp * 1000;
  } catch {
    return true;
  }
}
