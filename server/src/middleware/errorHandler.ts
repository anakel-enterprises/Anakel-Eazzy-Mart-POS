import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";

// Turns a Prisma unique-constraint violation's raw target fields into a
// message a shop owner (not a developer) can act on — the default fallback
// otherwise surfaces Prisma's full query-engine invocation text verbatim
// (visible, unhelped, in e.g. Inventory's "SYNC FAILED" detail for a
// duplicate SKU), which explains what broke but not what to do about it.
function friendlyUniqueConstraintMessage(err: Prisma.PrismaClientKnownRequestError): string {
  const target = err.meta?.target;
  const fields = Array.isArray(target) ? target.filter((f) => f !== "storeId") : [];
  if (fields.includes("sku")) return "A product with this SKU already exists.";
  if (fields.includes("barcode")) return "A product with this barcode already exists.";
  if (fields.includes("clientId")) return "This was already submitted.";
  return fields.length > 0 ? `This ${fields.join(", ")} is already in use.` : "That value is already in use.";
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ error: "Validation failed", details: err.flatten() });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
    res.status(409).json({ error: friendlyUniqueConstraintMessage(err) });
    return;
  }
  if (err instanceof Error) {
    console.error(err);
    res.status(500).json({ error: err.message });
    return;
  }
  console.error(err);
  res.status(500).json({ error: "Unknown server error" });
}

export function asyncHandler<T extends (req: Request, res: Response) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}
