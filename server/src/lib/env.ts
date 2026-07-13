import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? 4000),
  jwtSecret: required("JWT_SECRET"),
  // Comma-separated so a Vercel preview deploy's web URL can be added
  // alongside the production one without a code change.
  corsOrigins: (process.env.CORS_ORIGIN ?? "http://localhost:5173").split(",").map((s) => s.trim()),
  // Not validated with required() — a deploy with no M-Pesa app registered
  // yet should still boot. lib/mpesa.ts checks these lazily and returns a
  // clear 503 from the stk-push route instead of crashing at startup.
  mpesa: {
    env: (process.env.MPESA_ENV ?? "sandbox") as "sandbox" | "production",
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    // 174379 + this passkey are Safaricom's published sandbox test values
    // for STK push (developer.safaricom.co.ke) — safe as defaults since
    // they only work against the sandbox base URL, never production.
    shortcode: process.env.MPESA_SHORTCODE ?? "174379",
    passkey: process.env.MPESA_PASSKEY ?? "bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919",
    callbackUrl: process.env.MPESA_CALLBACK_URL,
  },
};
