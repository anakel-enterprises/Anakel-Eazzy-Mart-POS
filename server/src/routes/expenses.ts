import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

export const expensesRouter = Router();
expensesRouter.use(requireAuth);

expensesRouter.get(
  "/categories",
  asyncHandler(async (req, res) => {
    const categories = await prisma.expenseCategory.findMany({
      where: { storeId: req.auth!.storeId },
      orderBy: { name: "asc" },
    });
    res.json(categories);
  })
);

const categorySchema = z.object({ name: z.string().min(1) });

expensesRouter.post(
  "/categories",
  requirePermission("MANAGE_EXPENSES"),
  asyncHandler(async (req, res) => {
    const { name } = categorySchema.parse(req.body);
    const category = await prisma.expenseCategory.create({ data: { name, storeId: req.auth!.storeId } });
    res.status(201).json(category);
  })
);

expensesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const { status } = req.query;
    const expenses = await prisma.expense.findMany({
      where: {
        storeId: req.auth!.storeId,
        ...(typeof status === "string" ? { status: status as never } : {}),
      },
      include: {
        category: true,
        requestedBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
      orderBy: { date: "desc" },
    });
    res.json(expenses);
  })
);

const expenseSchema = z.object({
  categoryId: z.string(),
  amount: z.number().positive(),
  description: z.string().optional(),
  date: z.string().datetime().optional(),
});

// Any authenticated employee can submit an expense for approval.
expensesRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const data = expenseSchema.parse(req.body);
    const expense = await prisma.expense.create({
      data: {
        storeId: req.auth!.storeId,
        categoryId: data.categoryId,
        amount: data.amount,
        description: data.description,
        date: data.date ? new Date(data.date) : undefined,
        requestedById: req.auth!.userId,
      },
    });
    res.status(201).json(expense);
  })
);

const decisionSchema = z.object({ status: z.enum(["APPROVED", "REJECTED"]) });

expensesRouter.put(
  "/:id/decision",
  requirePermission("MANAGE_EXPENSES"),
  asyncHandler(async (req, res) => {
    const { status } = decisionSchema.parse(req.body);
    const existing = await prisma.expense.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId, status: "PENDING" },
    });
    if (!existing) {
      res.status(404).json({ error: "Pending expense not found" });
      return;
    }
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: { status, approvedById: req.auth!.userId },
    });
    res.json(expense);
  })
);

export const incomeRouter = Router();
incomeRouter.use(requireAuth);

incomeRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const incomes = await prisma.income.findMany({
      where: { storeId: req.auth!.storeId },
      orderBy: { date: "desc" },
    });
    res.json(incomes);
  })
);

const incomeSchema = z.object({
  source: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
  date: z.string().datetime().optional(),
});

incomeRouter.post(
  "/",
  requirePermission("MANAGE_EXPENSES"),
  asyncHandler(async (req, res) => {
    const data = incomeSchema.parse(req.body);
    const income = await prisma.income.create({
      data: { ...data, date: data.date ? new Date(data.date) : undefined, storeId: req.auth!.storeId },
    });
    res.status(201).json(income);
  })
);
