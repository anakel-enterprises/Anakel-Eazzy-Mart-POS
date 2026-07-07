import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const employeesRouter = Router();
employeesRouter.use(requireAuth, requireRole("ADMIN"));

employeesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const users = await prisma.user.findMany({
      where: { storeId: req.auth!.storeId },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    });
    res.json(users);
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
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    res.status(201).json(user);
  })
);

const updateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["ADMIN", "MANAGER", "CASHIER", "STOREKEEPER", "ACCOUNTANT"]).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).optional(),
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

    const user = await prisma.user.update({
      where: { id: existing.id },
      data: { name: data.name, role: data.role, active: data.active, passwordHash },
      select: { id: true, name: true, email: true, role: true, active: true, createdAt: true },
    });
    res.json(user);
  })
);
