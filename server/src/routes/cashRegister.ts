import { Router } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { asyncHandler } from "../middleware/errorHandler.js";
import { requireAuth } from "../middleware/auth.js";

export const cashRegisterRouter = Router();
cashRegisterRouter.use(requireAuth);

cashRegisterRouter.get(
  "/current",
  asyncHandler(async (req, res) => {
    const session = await prisma.cashRegisterSession.findFirst({
      where: { storeId: req.auth!.storeId, cashierId: req.auth!.userId, status: "OPEN" },
    });
    res.json(session);
  })
);

const openSchema = z.object({ openingFloat: z.number().nonnegative() });

cashRegisterRouter.post(
  "/open",
  asyncHandler(async (req, res) => {
    const { openingFloat } = openSchema.parse(req.body);

    const existing = await prisma.cashRegisterSession.findFirst({
      where: { storeId: req.auth!.storeId, cashierId: req.auth!.userId, status: "OPEN" },
    });
    if (existing) {
      res.status(409).json({ error: "A register session is already open", session: existing });
      return;
    }

    const session = await prisma.cashRegisterSession.create({
      data: { storeId: req.auth!.storeId, cashierId: req.auth!.userId, openingFloat },
    });
    res.status(201).json(session);
  })
);

const closeSchema = z.object({ closingCounted: z.number().nonnegative(), notes: z.string().optional() });

cashRegisterRouter.post(
  "/:id/close",
  asyncHandler(async (req, res) => {
    const { closingCounted, notes } = closeSchema.parse(req.body);

    const session = await prisma.cashRegisterSession.findFirst({
      where: { id: req.params.id, storeId: req.auth!.storeId, status: "OPEN" },
    });
    if (!session) {
      res.status(404).json({ error: "Open session not found" });
      return;
    }

    const cashSalesTotal = await prisma.sale.aggregate({
      where: { registerSessionId: session.id, paymentMethod: "CASH", status: "COMPLETED" },
      _sum: { total: true },
    });

    const expectedCash = session.openingFloat.add(cashSalesTotal._sum.total ?? new Prisma.Decimal(0));
    const variance = new Prisma.Decimal(closingCounted).sub(expectedCash);

    const closed = await prisma.cashRegisterSession.update({
      where: { id: session.id },
      data: {
        status: "CLOSED",
        closingCounted,
        expectedCash,
        variance,
        notes,
        closedAt: new Date(),
      },
    });

    res.json(closed);
  })
);

cashRegisterRouter.get(
  "/history",
  asyncHandler(async (req, res) => {
    const sessions = await prisma.cashRegisterSession.findMany({
      where: { storeId: req.auth!.storeId },
      include: { cashier: { select: { name: true } } },
      orderBy: { openedAt: "desc" },
      take: 50,
    });
    res.json(sessions);
  })
);
