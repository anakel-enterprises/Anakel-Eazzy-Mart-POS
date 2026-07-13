import { env } from "./env.js";

const BASE_URL = env.mpesa.env === "production" ? "https://api.safaricom.co.ke" : "https://sandbox.safaricom.co.ke";

// Thrown when MPESA_CONSUMER_KEY/SECRET/CALLBACK_URL aren't set yet — distinct
// from MpesaApiError so the route can return 503 "not configured" instead of
// 502 "Safaricom rejected the request".
export class MpesaConfigError extends Error {}
export class MpesaApiError extends Error {}

function assertConfigured() {
  if (!env.mpesa.consumerKey || !env.mpesa.consumerSecret) {
    throw new MpesaConfigError("M-Pesa is not configured — set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET");
  }
  if (!env.mpesa.callbackUrl) {
    throw new MpesaConfigError("M-Pesa is not configured — set MPESA_CALLBACK_URL to a public HTTPS URL");
  }
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  assertConfigured();
  if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.token;

  const credentials = Buffer.from(`${env.mpesa.consumerKey}:${env.mpesa.consumerSecret}`).toString("base64");
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${credentials}` },
  });
  if (!res.ok) {
    throw new MpesaApiError(`Failed to get M-Pesa access token (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: string };
  // Refresh a minute early so a near-expiry cached token is never handed to
  // an in-flight request that might outlive it.
  cachedToken = { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000 };
  return cachedToken.token;
}

// Daraja requires the customer's number as a Kenyan MSISDN in 2547XXXXXXXX /
// 2541XXXXXXXX form. Cashiers will type 07XX, 01XX, +254, or 254 formats —
// normalize all of them rather than rejecting anything but one exact shape.
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, "");
  if (/^254(7|1)\d{8}$/.test(digits)) return digits;
  if (/^0(7|1)\d{8}$/.test(digits)) return `254${digits.slice(1)}`;
  if (/^(7|1)\d{8}$/.test(digits)) return `254${digits}`;
  throw new Error(`"${input}" doesn't look like a Kenyan phone number`);
}

function timestampNow(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

interface StkPushResult {
  merchantRequestId: string;
  checkoutRequestId: string;
  customerMessage: string;
}

interface StkPushResponse {
  ResponseCode?: string;
  ResponseDescription?: string;
  CustomerMessage?: string;
  MerchantRequestID?: string;
  CheckoutRequestID?: string;
  errorMessage?: string;
}

// Sends the actual STK ("Sim Toolkit") push — the customer sees a PIN
// prompt appear on their phone. This call only confirms Safaricom *accepted*
// the request; whether the customer approves, declines, or lets it time out
// is reported later via the callback route, not here.
export async function initiateStkPush(params: {
  phone: string;
  amount: number;
  accountReference: string;
  transactionDesc: string;
}): Promise<StkPushResult> {
  const token = await getAccessToken();
  const timestamp = timestampNow();
  const password = Buffer.from(`${env.mpesa.shortcode}${env.mpesa.passkey}${timestamp}`).toString("base64");

  const res = await fetch(`${BASE_URL}/mpesa/stkpush/v1/processrequest`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      BusinessShortCode: env.mpesa.shortcode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: "CustomerPayBillOnline",
      // Daraja rejects decimal amounts — STK push is whole-shilling only.
      Amount: Math.round(params.amount),
      PartyA: params.phone,
      PartyB: env.mpesa.shortcode,
      PhoneNumber: params.phone,
      CallBackURL: env.mpesa.callbackUrl,
      // Daraja caps these at 12 and 13 characters respectively.
      AccountReference: params.accountReference.slice(0, 12),
      TransactionDesc: params.transactionDesc.slice(0, 13),
    }),
  });

  const data = (await res.json()) as StkPushResponse;
  if (!res.ok || data.ResponseCode !== "0" || !data.CheckoutRequestID || !data.MerchantRequestID) {
    throw new MpesaApiError(data.errorMessage || data.ResponseDescription || "M-Pesa STK push was rejected");
  }

  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    customerMessage: data.CustomerMessage ?? "Enter your M-Pesa PIN on your phone to complete payment.",
  };
}

export interface StkCallbackItem {
  Name: string;
  Value: string | number;
}

export interface StkCallbackBody {
  Body?: {
    stkCallback?: {
      MerchantRequestID: string;
      CheckoutRequestID: string;
      ResultCode: number;
      ResultDesc: string;
      CallbackMetadata?: { Item: StkCallbackItem[] };
    };
  };
}
