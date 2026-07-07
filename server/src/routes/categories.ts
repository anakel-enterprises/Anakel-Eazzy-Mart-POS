import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export const categoriesRouter = Router();
categoriesRouter.use(requireAuth);

categoriesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const categories = await prisma.category.findMany({
      where: { storeId: req.auth!.storeId },
      orderBy: { name: "asc" },
    });
    res.json(categories);
  })
);

const categorySchema = z.object({ name: z.string().min(1) });

categoriesRouter.post(
  "/",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { name } = categorySchema.parse(req.body);
    const category = await prisma.category.create({
      data: { name, storeId: req.auth!.storeId },
    });
    res.status(201).json(category);
  })
);

categoriesRouter.put(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const { name } = categorySchema.parse(req.body);
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    const category = await prisma.category.update({ where: { id: existing.id }, data: { name } });
    res.json(category);
  })
);

categoriesRouter.delete(
  "/:id",
  requireRole("ADMIN", "MANAGER"),
  asyncHandler(async (req, res) => {
    const existing = await prisma.category.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId },
    });
    if (!existing) {
      res.status(404).json({ error: "Category not found" });
      return;
    }
    await prisma.category.delete({ where: { id: existing.id } });
    res.status(204).end();
  })
);
