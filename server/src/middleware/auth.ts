import type { NextFunction, Request, Response } from "express";
import { verifyToken, type AuthTokenPayload } from "../lib/auth.js";
import { prisma } from "../lib/prisma.js";
import type { Role } from "@prisma/client";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthTokenPayload;
    }
  }
}

// Re-checks active/role from the database rather than trusting the JWT
// payload alone — the token is long-lived (30d, to survive an attendant
// being offline for a shift or a weekend), so a disabled account or a role
// change needs to take effect on the next request, not on next login.
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) {
    res.status(401).json({ error: "Missing authorization token" });
    return;
  }
  try {
    const payload = verifyToken(token);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: { active: true, role: true, storeId: true },
    });
    if (!user || !user.active) {
      res.status(401).json({ error: "Account is disabled" });
      return;
    }
    req.auth = { userId: payload.userId, storeId: user.storeId, role: user.role };
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.auth || !roles.includes(req.auth.role)) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}
