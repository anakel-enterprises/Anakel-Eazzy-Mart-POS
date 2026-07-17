import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { PERMISSION_CATALOG, PERMISSION_KEYS, ROLE_DEFAULT_PERMISSIONS, resolvePermissions } from "../lib/permissions.js";

export const employeesRouter = Router();
employeesRouter.use(requireAuth, requireRole("ADMIN"));

employeesRouter.get(
  "/permission-catalog",
  asyncHandler(async (_req, res) => {
    res.json({ catalog: PERMISSION_CATALOG, roleDefaults: ROLE_DEFAULT_PERMISSIONS });
  })
);

employeesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { storeId: req.auth!.storeId },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, permissions: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(
      users.map((u) => ({
        ...u,
        permissions: resolvePermissions(u.role, u.permissions),
        // Whether each key has an explicit override vs. inheriting the role default.
        customized: u.permissions !== null,
      }))
    );
  })
);

const createSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "MANAGER", "CASHIER", "STOREKEEPER", "ACCOUNTANT"]).default("CASHIER"),
});

employeesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = createSchema.parse(req.body);
    const passwordHash = await bcrypt.hash(data.password, 10);
    const user = await prisma.user.create({
      data: {
        name: data.name,
        email: data.email,
        role: data.role,
        passwordHash,
        storeId: req.auth!.storeId,
      },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, permissions: true },
    });
    res.status(201).json({ ...user, permissions: resolvePermissions(user.role, user.permissions), customized: false });
  })
);

const permissionsSchema = z.object(
  Object.fromEntries(PERMISSION_KEYS.map((key) => [key, z.boolean()])) as Record<
    (typeof PERMISSION_KEYS)[number],
    z.ZodBoolean
  >
).partial();

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  email: z.string().email().optional(),
  role: z.enum(["ADMIN", "MANAGER", "CASHIER", "STOREKEEPER", "ACCOUNTANT"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
  // Explicit per-key overrides on top of the role's defaults. Pass `null` to
  // clear all overrides and go back to inheriting the role's defaults.
  permissions: permissionsSchema.nullable().optional(),
});

employeesRouter.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const data = updateSchema.parse(req.body);
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }

    const passwordHash = data.password ? await bcrypt.hash(data.password, 10) : undefined;

    let user;
    try {
      user = await prisma.user.update({
        where: { id: existing.id },
        data: {
          name: data.name,
          email: data.email,
          role: data.role,
          active: data.active,
          passwordHash,
          ...(data.permissions === undefined ? {} : { permissions: data.permissions ?? Prisma.DbNull }),
        },
        select: { id: true, name: true, email: true, role: true, active: true, createdAt: true, permissions: true },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        res.status(400).json({ error: "That email is already in use by another employee" });
        return;
      }
      throw err;
    }

    res.json({
      ...user,
      permissions: resolvePermissions(user.role, user.permissions),
      customized: user.permissions !== null,
    });
  })
);

employeesRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const existing = await prisma.user.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Employee not found" });
      return;
    }
    if (existing.id === req.auth!.userId) {
      res.status(400).json({ error: "You can't delete your own account" });
      return;
    }

    try {
      await prisma.user.delete({ where: { id: existing.id } });
    } catch (err) {
      // FK constraint violation — this employee has sales, stock
      // adjustments, or other activity recorded against their account.
      // That history has to stay attributable, so a real delete is only
      // possible for an account that's never actually been used; anyone
      // else can only be disabled (active: false), not removed.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
        res.status(400).json({
          error:
            "This employee has sales or other activity recorded against their account, so they can't be permanently deleted. Use Disable instead to remove their access while keeping that history intact.",
        });
        return;
      }
      throw err;
    }

    res.status(204).end();
  })
);
