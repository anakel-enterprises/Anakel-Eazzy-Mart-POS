import express from "express";
import cors from "cors";
import { env } from "./lib/env.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authRouter } from "./routes/auth.js";
import { categoriesRouter } from "./routes/categories.js";
import { productsRouter } from "./routes/products.js";
import { salesRouter } from "./routes/sales.js";
import { cashRegisterRouter } from "./routes/cashRegister.js";
import { reportsRouter } from "./routes/reports.js";
import { employeesRouter } from "./routes/employees.js";
import { settingsRouter } from "./routes/settings.js";

export const app = express();

app.use(cors({ origin: env.corsOrigins }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ status: "ok" }));

app.use("/api/auth", authRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/products", productsRouter);
app.use("/api/sales", salesRouter);
app.use("/api/cash-register", cashRegisterRouter);
app.use("/api/reports", reportsRouter);
app.use("/api/employees", employeesRouter);
app.use("/api/settings", settingsRouter);

app.use(errorHandler);
