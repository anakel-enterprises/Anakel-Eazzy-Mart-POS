// Vercel entrypoint: any exported request handler with an (req, res) signature
// is treated as a serverless function, and an Express app satisfies that
// signature directly — no adapter needed. vercel.json rewrites every path
// here so Express's own routing (already mounted under /api/...) takes over.
import { app } from "../src/app.js";

export default app;
