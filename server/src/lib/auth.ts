import jwt from "jsonwebtoken";
import { env } from "./env.js";
import type { Role } from "@prisma/client";

export interface AuthTokenPayload {
  userId: string;
  storeId: string;
  role: Role;
}

// Long-lived: this is a till-side device that can go offline for a full shift
// or a weekend, and a JWT that expires mid-offline-period silently blocks
// sync (the retry just keeps 401ing) until someone notices and re-logs-in.
// Disabling an employee's account (Employees page) still takes effect
// immediately on their next online request, since role/active is re-checked
// server-side on every call — this only widens how long a *stale* token
// works while offline.
export function signToken(payload: AuthTokenPayload): string {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: "30d" });
}

export function verifyToken(token: string): AuthTokenPayload {
  return jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
}
