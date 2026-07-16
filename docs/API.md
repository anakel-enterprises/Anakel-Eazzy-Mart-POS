# API Reference

Base URL: `http://localhost:4000` in development (`VITE_API_URL` in the web app), the deployed server
URL in production. Every route below is prefixed with `/api` except the health check.

## Conventions

- **Auth**: send `Authorization: Bearer <token>` on every request except `POST /api/auth/login` and
  `GET /health`. Tokens are issued by login and are valid for 30 days (see
  [ARCHITECTURE.md](./ARCHITECTURE.md#authentication) for why they're long-lived).
- **Content type**: `application/json` for all request/response bodies.
- **Store scoping**: every resource is implicitly scoped to the caller's `storeId` (from their JWT/DB
  row) — there is no way to read or write another store's data, and no `storeId` parameter to pass.
- **Validation**: request bodies are validated with [Zod](https://zod.dev) schemas; a failing schema
  returns `400` with Zod's error detail. Fields are listed below as documented in the route's schema.
- **Errors**: non-2xx responses are `{ "error": "<message>" }`. Common statuses:
  - `400` — validation failure or a business-rule rejection (e.g. insufficient credit limit)
  - `401` — missing/invalid/expired token, or the account is disabled
  - `403` — authenticated, but lacking the required role/permission
  - `404` — resource not found (or not in the caller's store, which is deliberately indistinguishable
    from not existing)
  - `409` — a state conflict (e.g. opening a register session while one is already open)
- **Decimals**: money fields serialize as JSON numbers via Prisma's `Decimal` type; treat them as
  arbitrary-precision values, not floats, when doing further arithmetic client-side.
- **Auth gate shorthand** used throughout this doc:
  - `none` — no token required
  - `auth` — any valid token (`requireAuth` only)
  - `role:ADMIN` — `requireRole("ADMIN")`
  - `perm:KEY` — `requirePermission("KEY")` (see [PERMISSIONS.md](./PERMISSIONS.md) for what each key
    means and each role's defaults)

## Health

| Method | Path | Auth |
|---|---|---|
| GET | `/health` | none |

Returns `{ "status": "ok" }`. Unauthenticated — used for uptime checks and the frontend's
`isApiReachable()` connectivity probe.

## Auth — `/api/auth`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/auth/login` | none | Exchange email + password for a JWT |
| GET | `/api/auth/me` | auth | Refresh the current user's profile/role/permissions |

### POST `/api/auth/login`

Request:

| Field | Type | Required |
|---|---|---|
| `email` | string, valid email | yes |
| `password` | string, min 1 | yes |

`401 Invalid email or password` if the account doesn't exist, is disabled, or the password doesn't
match (same message for all three, so login can't be used to enumerate valid emails).

Response `200`:
```json
{
  "token": "…jwt…",
  "user": { "id": "…", "name": "…", "email": "…", "role": "ADMIN", "storeId": "…", "permissions": { "...": true } }
}
```

### GET `/api/auth/me`

No body. Response: the same `user` shape as login, freshly loaded from the database. The frontend
calls this on app bootstrap to refresh a cached session's role/permissions without requiring a full
re-login.

## Categories — `/api/categories`

| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/api/categories/` | auth | — |
| POST | `/api/categories/` | perm:MANAGE_PRODUCTS | `{ name }` |
| PUT | `/api/categories/:id` | perm:MANAGE_PRODUCTS | `{ name }` |
| DELETE | `/api/categories/:id` | perm:MANAGE_PRODUCTS | — |

`name` is a required non-empty string, unique per store. GET returns all categories for the store
ordered by name. DELETE hard-deletes (categories have no history that needs preserving) and returns
`204`. `404 Category not found` on PUT/DELETE for an unknown/foreign id.

## Products — `/api/products`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/products/` | auth | Search/list active products |
| POST | `/api/products/` | perm:MANAGE_PRODUCTS | Create a product |
| PUT | `/api/products/:id` | perm:MANAGE_PRODUCTS | Update a product |
| DELETE | `/api/products/:id` | perm:MANAGE_PRODUCTS | Soft-delete (`active: false`) |
| POST | `/api/products/import` | perm:MANAGE_PRODUCTS | Bulk CSV-style import |
| POST | `/api/products/:id/adjustments` | perm:MANAGE_PRODUCTS | Record a stock adjustment |
| GET | `/api/products/:id/adjustments` | auth | List a product's adjustment history |

### GET `/api/products/`

Query params: `q` (string — case-insensitive match against name/sku/barcode), `lowStock` (`"true"` to
filter to items where `stockQty <= lowStockThreshold`). Only returns `active: true` products, with
`category` included, ordered by name.

### POST `/api/products/` / PUT `/api/products/:id`

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string, min 1 | yes | |
| `sku` | string, min 1 | yes | unique per store |
| `barcode` | string | no | |
| `categoryId` | string \| null | no | |
| `price` | number, positive | yes | retail price |
| `wholesalePrice` | number, positive | no | used for `WHOLESALE` customers |
| `vipPrice` | number, positive | no | used for `VIP` customers |
| `cost` | number, ≥ 0 | no | drives profit/COGS reports |
| `stockQty` | integer, ≥ 0 | no | default `0` on create |
| `lowStockThreshold` | integer, ≥ 0 | no | default `5` |
| `imageUrl` | string | no | |
| `clientId` | string | no | POST only — see below |

PUT accepts a partial version of the same schema (no `clientId` — a PUT is already safe to retry as-is).
`404 Product not found` if the id isn't in the caller's store.

**Idempotency**: `clientId` is set when a product is created offline and queued for sync (see
[ARCHITECTURE.md](./ARCHITECTURE.md#offline-product-management)). If a product with that `clientId`
already exists for the caller's store, POST returns it as-is with `200` instead of creating a duplicate
— the same pattern as `Sale.clientId`, guarding against a retried request whose earlier response was
lost after the create actually succeeded.

### DELETE `/api/products/:id`

Soft delete — sets `active: false`, does not remove the row (sale history references it). `204` on
success.

### POST `/api/products/import`

Body: `{ "rows": [ { name, sku?, barcode?, category?, price, cost?, stockQty?, lowStockThreshold? }, ... ] }`
(1–2000 rows; `name` and `price` required per row, everything else optional).

Upserts by SKU (case-insensitive). A blank/missing `sku` is auto-generated from the name (uppercased,
non-alphanumeric → `-`, truncated to 24 chars, deduplicated with a numeric suffix if needed). An
unrecognized `category` name auto-creates that category. **Updating an existing SKU never touches
`stockQty`** — re-importing a price list is not supposed to silently overwrite stock counts that have
already moved via sales or adjustments; only newly-created rows get `stockQty` from the import.
Per-row failures are collected without aborting the batch.

Response `200`:
```json
{ "created": 12, "updated": 3, "errors": [{ "row": 5, "reason": "…" }] }
```

### POST `/api/products/:id/adjustments`

| Field | Type | Required | Notes |
|---|---|---|---|
| `quantityDelta` | integer, ≠ 0 | yes | signed; positive adds stock, negative removes it |
| `reason` | enum: `RECEIVED_STOCK`, `DAMAGE`, `THEFT_LOSS`, `RECOUNT`, `MANUAL_CORRECTION` | yes | |
| `notes` | string | no | |
| `clientId` | string | no | idempotency key — see below |

Runs in a transaction: creates the `StockAdjustment` audit row and applies `quantityDelta` to
`Product.stockQty` atomically. `404` if the product isn't in the caller's store. Response `201`: the
created `StockAdjustment`.

**Idempotency**: unlike the product PUT above, this *increments* `stockQty` rather than overwriting it,
so it isn't naturally safe to retry. `clientId` is set when an adjustment is queued offline; if one with
that `clientId` already exists, it's returned as-is with `200` instead of applying the delta twice.

### GET `/api/products/:id/adjustments`

Lists that product's adjustment history, newest first, each including the acting user's name.

## Sales — `/api/sales`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/sales/` | perm:MAKE_SALES | Ring up (or replay) a sale — the core checkout endpoint |
| GET | `/api/sales/` | auth | List recent sales |
| GET | `/api/sales/held` | auth | List currently held (parked) sales |

### POST `/api/sales/`

| Field | Type | Required | Notes |
|---|---|---|---|
| `clientId` | string, min 1 | yes | **idempotency key** — see below |
| `items` | array of `{ productId, quantity }` (quantity: positive int) | yes | min 1 item |
| `paymentMethod` | enum `CASH`\|`MPESA_MANUAL`\|`MPESA`\|`CARD`\|`BANK`\|`SPLIT`\|`CREDIT` | yes | `MPESA_MANUAL` is cashier-asserted (like CASH/CARD/BANK); `MPESA` is STK push-verified — see M-Pesa below |
| `amountTendered` | number, ≥ 0 | no | |
| `status` | enum `HELD`\|`COMPLETED` | no | default `COMPLETED` |
| `createdAt` | ISO datetime string | no | lets an offline sale keep its original timestamp when synced later |
| `customerId` | string | no | required if `paymentMethod: CREDIT` |
| `couponCode` | string | no | |
| `creditDueDate` | ISO datetime string | no | CREDIT sales only; defaults to `now + 30 days` |
| `splitPayments` | array of `{ method: CASH\|MPESA\|CARD\|BANK, amount: positive number }` | no | required (≥2 entries) if `paymentMethod: SPLIT` |
| `mpesaCheckoutRequestId` | string | no | required if `paymentMethod: MPESA` (standalone STK push, not `MPESA_MANUAL` or `SPLIT`) — see M-Pesa below |

**Idempotency**: this is the endpoint the offline sync queue retries. If a `Sale` with the given
`clientId` already exists, the request is **not** re-processed — the existing sale is returned as-is
with `200`. This makes it safe for the frontend to retry a sync after a dropped connection without
risking a double sale or double stock decrement.

**Server-side pricing** (the client's own total is only an estimate — the server recomputes
everything): looks up the caller's open `CashRegisterSession` (if any) to attach as
`registerSessionId`. Per line item, price is chosen by customer type — `WHOLESALE` customers get
`product.wholesalePrice` if set, `VIP` get `vipPrice` if set, everyone else (or if the tier price isn't
set) gets `product.price`. `subtotal` = sum of line totals.

**Promotions** (only applied when `status: COMPLETED`): any `Promotion` currently active
(`startDate <= now <= endDate`) for the store is applied automatically — no code needed. Product-scoped
promotions apply to matching line items (`PERCENTAGE_DISCOUNT`, `FIXED_DISCOUNT` capped at the line
total, or `BOGO` = `floor(quantity/2)` free units). Storewide promotions (no `productId`) apply a
percentage or fixed amount off the whole subtotal.

**Coupon**: if `couponCode` is given, it's looked up by code (case-sensitive, stored uppercased);
`400 Invalid or expired coupon` if it doesn't exist, is expired, or has hit its `usageLimit`. Discount
is percentage-of-subtotal or a fixed amount capped at the subtotal.

`discountTotal = min(promotion discount + coupon discount, subtotal)`. **Tax is always `0`** — tax
charging was removed from the product because it was overcharging customers; `taxTotal` is hardcoded
and `total = subtotal - discountTotal`.

**Split payment validation**: for `SPLIT` + `COMPLETED`, the sum of `splitPayments` amounts must cover
`total` within a 1-cent shortfall tolerance (the client can't predict server-computed discounts in
advance, so a small allowed shortfall/overage avoids spurious rejections); `400` with the computed
`total` if genuinely short.

**Credit limit check**: for `CREDIT` sales, if the customer's `creditLimit > 0`, the sale is rejected
(`400`) when `creditBalance + total` would exceed it. **A `creditLimit` of exactly `0` is treated as
unlimited credit**, not "no credit allowed" — this is a schema/business-logic quirk worth knowing before
relying on it as a hard cap.

**M-Pesa validation**: for a standalone `MPESA` sale (not `SPLIT`), `mpesaCheckoutRequestId` must
reference an [`MpesaTransaction`](#m-pesa--apimpesa) in the caller's store that is `status: SUCCESS`,
not already linked to another sale, and whose `amount` covers the total (same shortfall tolerance as
split payments — the STK push amount is quoted before this request's promotions/coupon are known, so it
only needs to *cover* the total, not match exactly). `400` if the transaction is missing, still
`PENDING`, `FAILED`/`CANCELLED`, already used, or short. On success, the transaction is linked to the
new sale and its `mpesaReceiptNumber` is copied onto `Sale.mpesaReceiptNumber`. `MPESA_MANUAL` (the
customer already paid outside this system — e.g. to a till/paybill — and the cashier is just recording
it) and `SPLIT`'s MPESA leg are both unaffected by any of this — like CASH/CARD/BANK, they're just a
cashier-asserted amount, not verified against a real STK push.

**Effects on other tables** (only for `status: COMPLETED`, inside one transaction with the `Sale`
insert): each item's `Product.stockQty` is decremented; a used coupon's `timesUsed` is incremented; a
CREDIT sale increments the customer's `creditBalance` by `total`. `HELD` sales don't touch stock,
coupons, or credit — nothing happens until the held sale is later completed (there is currently no
"resume/complete a held sale" endpoint that transitions status; held sales live entirely client-side in
the web app's local Dexie store today — see [ARCHITECTURE.md](./ARCHITECTURE.md)).

Response: `201` with the created `Sale` (including `items`, and `splitPayments` if applicable) on a new
sale; `200` with the pre-existing `Sale` (including `items` only) on an idempotent replay.

### GET `/api/sales/`

Query: `status` (optional filter), `limit` (optional, default `50`). Returns sales for the store
including `items` and the cashier's name, newest first.

### GET `/api/sales/held`

Returns all `status: HELD` sales for the store with items included, newest first.

## M-Pesa — `/api/mpesa`

Live Safaricom STK Push ("Lipa na M-Pesa Online") integration for standalone MPESA sales. See
[ARCHITECTURE.md](./ARCHITECTURE.md#m-pesa-stk-push-integration) for the full flow and
[DEPLOYMENT.md](./DEPLOYMENT.md#m-pesa-daraja-setup) for how to get sandbox/production credentials.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| POST | `/api/mpesa/stk-push` | perm:MAKE_SALES | Send an STK push prompt to a customer's phone |
| GET | `/api/mpesa/stk-push/:checkoutRequestId` | auth | Poll the outcome of a push |
| POST | `/api/mpesa/callback` | **none (public)** | Safaricom's own callback — not for frontend use |

### POST `/api/mpesa/stk-push`

| Field | Type | Required |
|---|---|---|
| `phone` | string | yes — accepts `07XX...`, `01XX...`, `+254...`, or `254...`; normalized server-side to the `2547XXXXXXXX`/`2541XXXXXXXX` form Daraja requires |
| `amount` | number, positive | yes |

Calls Safaricom's Daraja API to send a PIN prompt to the customer's phone, then creates a `PENDING`
`MpesaTransaction` row scoped to the caller's store and cashier. This only confirms Safaricom *accepted*
the request — not that the customer approved it; that outcome arrives later via the callback route.

Responses:
- `201` — `{ checkoutRequestId, merchantRequestId, customerMessage }`. Poll `checkoutRequestId` next.
- `503` — M-Pesa isn't configured yet (missing `MPESA_CONSUMER_KEY`/`MPESA_CONSUMER_SECRET`/`MPESA_CALLBACK_URL`).
- `502` — Safaricom rejected the request (bad credentials, invalid shortcode, etc.) — the error message is Safaricom's own.
- `400` — the phone number couldn't be normalized to a Kenyan MSISDN.

### GET `/api/mpesa/stk-push/:checkoutRequestId`

Polled by the checkout screen every few seconds while waiting on the customer. `404` if the id isn't
found in the caller's store. Response:
```json
{ "status": "PENDING", "mpesaReceiptNumber": null, "resultDesc": null, "amount": "150.00", "phone": "254712345678" }
```
`status` is one of `PENDING` (still waiting), `SUCCESS` (paid — `mpesaReceiptNumber` is set), `FAILED`
(a real failure — insufficient funds, generic decline), or `CANCELLED` (the customer explicitly declined
the prompt on their phone; Safaricom result code `1032`, split out from `FAILED` so the UI can phrase it
appropriately).

### POST `/api/mpesa/callback`

**Not authenticated** — Safaricom's servers call this directly and can't attach a JWT.
`checkoutRequestId`, a token Safaricom itself generated, is what actually scopes this to one pending
transaction; there is no additional signature/IP verification. Register this URL (your deployed API's
`/api/mpesa/callback`) as the `CallBackURL` on your Daraja app — every STK push's callback route is
whatever `MPESA_CALLBACK_URL` was set to at push time.

Expects Safaricom's `stkCallback` payload shape and **always** responds `200` with
`{ "ResultCode": 0, "ResultDesc": "Accepted" }`, even for an unrecognized or already-resolved
`checkoutRequestId` — returning anything else risks Safaricom treating the delivery as failed and
retrying indefinitely. A callback for a transaction that isn't `PENDING` anymore (already resolved by an
earlier delivery) is acknowledged and ignored rather than reprocessed.

## Cash Register — `/api/cash-register`

Every route requires `perm:MAKE_SALES`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/cash-register/current` | The caller's currently open session, if any |
| POST | `/api/cash-register/open` | Open a new session |
| POST | `/api/cash-register/:id/close` | Close a session |
| GET | `/api/cash-register/history` | Last 50 sessions for the store |

### POST `/api/cash-register/open`

Body: `{ "openingFloat": number, ≥ 0 }`. `409 A register session is already open` (with the existing
`session` in the body) if the caller already has one open. Response `201`: the new session.

### POST `/api/cash-register/:id/close`

Body: `{ "closingCounted": number ≥ 0, "notes"?: string }`. `404 Open session not found` if there's no
matching open session by that id in the store. Computes `expectedCash = openingFloat + sum(CASH,
COMPLETED sale totals during the session)` and `variance = closingCounted - expectedCash`, then marks
the session `CLOSED`. Response: the updated session.

### GET `/api/cash-register/history`

Up to 50 sessions, newest opened first, each including the cashier's name.

## Customers — `/api/customers`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/customers/` | auth | Search customers |
| GET | `/api/customers/credit` | auth | Customers with an outstanding credit balance |
| POST | `/api/customers/` | perm:MANAGE_CUSTOMERS | Create a customer |
| PUT | `/api/customers/:id` | perm:MANAGE_CUSTOMERS | Update a customer |
| POST | `/api/customers/:id/payments` | perm:MANAGE_CUSTOMERS | Record a credit payment |
| GET | `/api/customers/:id/payments` | auth | Payment history for a customer |

### GET `/api/customers/`

Query: `q` (optional — matches name or phone, case-insensitive). Ordered by name.

### GET `/api/customers/credit`

Returns customers with `creditBalance > 0`, ordered by balance descending, each with an extra
`oldestDueDate` field (the `creditDueDate` of their oldest still-`COMPLETED` credit sale, or `null`) so
the UI can flag overdue accounts.

### POST `/api/customers/` / PUT `/api/customers/:id`

| Field | Type | Required |
|---|---|---|
| `name` | string, min 1 | yes (POST) |
| `phone` | string | no |
| `email` | valid email or empty string | no |
| `type` | enum `RETAIL`\|`WHOLESALE`\|`VIP` | no, default `RETAIL` |
| `creditLimit` | number, ≥ 0 | no, default `0` (see the "0 = unlimited" note under Sales above) |

PUT accepts a partial body. `404` on unknown id.

### POST `/api/customers/:id/payments`

Body: `{ "amount": positive number, "notes"?: string }`. In a transaction: creates a `CreditPayment`
row (`recordedById` = caller) and decrements `Customer.creditBalance` by `amount`. **Not clamped** —
overpaying will drive the balance negative rather than rejecting the request. `404` on unknown
customer. Response `201`: the payment.

### GET `/api/customers/:id/payments`

Payment history, newest first, including who recorded each payment.

## Employees — `/api/employees`

Every route requires `role:ADMIN`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/employees/permission-catalog` | The full permission catalog + role defaults, for building the editor UI |
| GET | `/api/employees/` | List all employees in the store |
| POST | `/api/employees/` | Create an employee account |
| PUT | `/api/employees/:id` | Update name/role/active/password/permissions |

### GET `/api/employees/permission-catalog`

Response: `{ "catalog": [...], "roleDefaults": { "ADMIN": {...}, ... } }` — see
[PERMISSIONS.md](./PERMISSIONS.md) for the actual values.

### GET `/api/employees/`

Each entry: `{ id, name, email, role, active, createdAt, permissions, customized }` — `permissions` is
the fully-resolved map (defaults + overrides); `customized` is `true` if the employee has any explicit
overrides stored.

### POST `/api/employees/`

| Field | Type | Required |
|---|---|---|
| `name` | string, min 1 | yes |
| `email` | valid email | yes |
| `password` | string, min 8 | yes |
| `role` | enum `ADMIN`\|`MANAGER`\|`CASHIER`\|`STOREKEEPER`\|`ACCOUNTANT` | no, default `CASHIER` |

Password is bcrypt-hashed (cost 10) before storage. Response `201`: the new employee in list-item
shape.

### PUT `/api/employees/:id`

| Field | Type | Notes |
|---|---|---|
| `name` | string, min 1 | optional |
| `role` | enum (same 5 values) | optional |
| `active` | boolean | optional — set `false` to disable the account (rejects their next login/request) |
| `password` | string, min 8 | optional — rehashed and replaces the old one; this is how an admin resets a forgotten password |
| `permissions` | partial map of the 7 permission keys, or `null` | optional — `null` clears overrides back to role defaults; omit the field entirely to leave overrides untouched; a partial object merges over existing overrides |

`404` if the employee isn't in the caller's store. Response: the updated employee in list-item shape.

## Expenses & Income — `/api/expenses`, `/api/income`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/expenses/categories` | auth | List expense categories |
| POST | `/api/expenses/categories` | perm:MANAGE_EXPENSES | Create a category |
| GET | `/api/expenses/` | auth | List expenses |
| POST | `/api/expenses/` | auth | Submit an expense for approval |
| PUT | `/api/expenses/:id/decision` | perm:MANAGE_EXPENSES | Approve or reject a pending expense |
| GET | `/api/income/` | auth | List income entries |
| POST | `/api/income/` | perm:MANAGE_EXPENSES | Record income |

### POST `/api/expenses/`

Any authenticated employee can submit an expense — this is intentional, since anyone might incur a
store expense; only *approving* it requires `MANAGE_EXPENSES`.

| Field | Type | Required |
|---|---|---|
| `categoryId` | string | yes |
| `amount` | number, positive | yes |
| `description` | string | no |
| `date` | ISO datetime | no, default now |

Created with `status: PENDING`, `requestedById` = caller.

### PUT `/api/expenses/:id/decision`

Body: `{ "status": "APPROVED" | "REJECTED" }`. `404 Pending expense not found` unless a `PENDING`
expense with that id exists in the store — **an already-decided expense cannot be re-decided**. Sets
`approvedById` = caller.

### POST `/api/income/`

| Field | Type | Required |
|---|---|---|
| `source` | string, min 1 | yes |
| `amount` | number, positive | yes |
| `description` | string | no |
| `date` | ISO datetime | no, default now |

No approval step — income entries are recorded directly.

## Promotions & Coupons — `/api/promotions`, `/api/coupons`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/promotions/` | auth | List promotions |
| POST | `/api/promotions/` | perm:MANAGE_PROMOTIONS | Create a promotion |
| PUT | `/api/promotions/:id` | perm:MANAGE_PROMOTIONS | Update a promotion |
| DELETE | `/api/promotions/:id` | perm:MANAGE_PROMOTIONS | Deactivate (`active: false`) |
| GET | `/api/coupons/` | auth | List coupons |
| POST | `/api/coupons/` | perm:MANAGE_PROMOTIONS | Create a coupon |
| DELETE | `/api/coupons/:id` | perm:MANAGE_PROMOTIONS | Deactivate (`active: false`) |

### POST `/api/promotions/` / PUT `/api/promotions/:id`

| Field | Type | Required |
|---|---|---|
| `name` | string, min 1 | yes |
| `type` | enum `PERCENTAGE_DISCOUNT`\|`FIXED_DISCOUNT`\|`BOGO` | yes |
| `discountPercent` | number, 0–100 | conditionally (percentage type) |
| `discountAmount` | number, ≥ 0 | conditionally (fixed type) |
| `productId` | string | no — omit for a storewide promotion |
| `startDate` / `endDate` | ISO datetime | yes |

Applied automatically by `POST /api/sales` while active — see the Sales section above. DELETE
soft-deletes (`active: false`, `204`).

### POST `/api/coupons/`

| Field | Type | Required |
|---|---|---|
| `code` | string, min 1 (auto-uppercased) | yes |
| `discountType` | enum `PERCENTAGE`\|`FIXED` | yes |
| `discountValue` | number, positive | yes |
| `expiresAt` | ISO datetime | no |
| `usageLimit` | positive integer | no — omit for unlimited redemptions |

Redeemed at checkout via `couponCode` on `POST /api/sales`. DELETE soft-deletes.

## Suppliers — `/api/suppliers`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/suppliers/` | auth | List suppliers |
| POST | `/api/suppliers/` | perm:MANAGE_SUPPLIERS | Create a supplier |
| PUT | `/api/suppliers/:id` | perm:MANAGE_SUPPLIERS | Update a supplier |
| POST | `/api/suppliers/:id/transactions` | perm:MANAGE_SUPPLIERS | Record a purchase or payment |
| GET | `/api/suppliers/:id/transactions` | auth | Transaction history for a supplier |

### POST `/api/suppliers/` / PUT `/api/suppliers/:id`

| Field | Type | Required |
|---|---|---|
| `name` | string, min 1 | yes (POST) |
| `phone` | string | no |
| `email` | valid email or empty string | no |
| `address` | string | no |

### POST `/api/suppliers/:id/transactions`

Body: `{ "type": "PURCHASE" | "PAYMENT", "amount": positive number, "description"?: string }`.
`PURCHASE` increases `Supplier.balance` (the store owes more), `PAYMENT` decreases it. Both the
transaction record and the balance update happen in one transaction. `404` if the supplier isn't in
the store.

## Reports — `/api/reports`

Every route requires `perm:VIEW_REPORTS`. Date-range params (`from`, `to`) are optional ISO date
strings; omitting both typically means "all time" for that endpoint (check each one — they don't all
behave identically with no range).

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/reports/dashboard` | Home dashboard summary (today's sales, weekly trend, low stock, recent sales) |
| GET | `/api/reports/sales-summary` | Totals + breakdown by payment method + top 10 products, for a date range |
| GET | `/api/reports/profit` | Revenue, COGS, gross profit, per-product breakdown, for a date range |
| GET | `/api/reports/profit-loss` | Full P&L: net sales, COGS, gross profit, other income, expenses by category, net profit |
| GET | `/api/reports/analytics` | Everything the P&L dashboard's charts need in one call: current period, previous-period comparison, a bucketed trend series, top products, top expense categories |
| GET | `/api/reports/inventory` | Point-in-time stock valuation snapshot (not date-ranged) |
| GET | `/api/reports/finance` | Revenue, expenses, other income, net cash flow, current credit outstanding, for a date range |
| GET | `/api/reports/customers` | Customer count, credit outstanding, top 10 customers by spend, for a date range |
| GET | `/api/reports/suppliers` | Point-in-time supplier balances (not date-ranged) |
| GET | `/api/reports/employee-performance` | Sales totals per cashier, for a date range |

### GET `/api/reports/dashboard`

No params. Returns:
```json
{
  "todaysSalesTotal": 0,
  "todaysTransactionCount": 0,
  "weeklySales": [{ "date": "2026-07-06", "total": 0 }, "…7 entries, zero-filled…"],
  "lowStock": [{ "id": "…", "name": "…", "sku": "…", "stockQty": 3, "lowStockThreshold": 8 }],
  "recentSales": ["…up to 8 most recent completed sales, with items and cashier name…"]
}
```

### GET `/api/reports/profit-loss`

`netSales = subtotal - discountTotal` (net of discounts is the real revenue line; tax is excluded
since none is charged). `cogs` from `Product.cost × quantity` on completed sale items. `grossProfit =
netSales - cogs`. `otherIncome` = sum of `Income` in range. `expensesByCategory`/`totalExpenses` only
count **`APPROVED`** expenses. `netProfit = grossProfit + otherIncome - totalExpenses`.

### GET `/api/reports/analytics`

`granularity` is `"day"` if the requested range spans ≤ 62 days, else `"month"` (the trend series
buckets accordingly). If both `from` and `to` are given, also computes `previous` — the immediately
preceding period of equal length — for period-over-period comparison; otherwise `previous: null`.
Response shape:
```json
{
  "current": { "revenue": 0, "cogs": 0, "expenses": 0, "otherIncome": 0, "grossProfit": 0, "netProfit": 0, "grossMarginPct": 0, "netMarginPct": 0 },
  "previous": null,
  "granularity": "day",
  "trend": [{ "label": "2026-07-06", "sales": 0, "expenses": 0, "profit": 0 }],
  "topProducts": [{ "name": "…", "revenue": 0 }],
  "topExpenseCategories": [{ "category": "…", "amount": 0 }]
}
```

### GET `/api/reports/finance`

`creditOutstanding` is a **current balance**, not filtered by the date range — it's the store's total
outstanding customer credit right now, alongside the period's revenue/expense/income figures.

## Settings — `/api/settings`

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/settings/` | auth | Get the store profile |
| PUT | `/api/settings/` | role:ADMIN | Update the store profile |
| POST | `/api/settings/reset-data` | role:ADMIN | **Destructive** — wipe all business data for a fresh start |

### PUT `/api/settings/`

| Field | Type | Required |
|---|---|---|
| `name` | string, min 1 | no |
| `address` | string | no |
| `phone` | string | no |
| `currency` | string | no |

Note: `taxRate` is not updatable through this endpoint despite existing on the `Store` model — and is
currently unused anyway, since `Sale.taxTotal` is hardcoded to `0`.

### POST `/api/settings/reset-data`

Body: `{ "confirm": "DELETE" }` — the literal string `"DELETE"`, nothing else validates.

**Irreversible.** Deletes, in one transaction (30s timeout), every `MpesaTransaction`, `Sale`,
`StockAdjustment`, `CashRegisterSession`, `CreditPayment`, `Customer`, `SupplierTransaction`,
`Supplier`, `Expense`, `ExpenseCategory`, `Income`, `Promotion`, `Coupon`, `Product`, and `Category` for
the caller's store — in that exact order, because FK `RESTRICT` constraints require sales (and
everything a sale might reference) to go first. `SaleItem`/`SalePayment` aren't listed explicitly
because they cascade-delete automatically with their parent `Sale`. **`User` accounts and the `Store`
row itself are never touched** — this is meant for clearing out seed/test data before a store goes
live, without losing employee logins or the store profile.

Response:
```json
{
  "deleted": {
    "mpesaTransactions": 0, "sales": 0, "stockAdjustments": 0, "registerSessions": 0,
    "creditPayments": 0, "customers": 0, "supplierTransactions": 0, "suppliers": 0,
    "expenses": 0, "expenseCategories": 0, "incomes": 0, "promotions": 0, "coupons": 0,
    "products": 0, "categories": 0
  }
}
```

See [ARCHITECTURE.md](./ARCHITECTURE.md#destructive-operations) for the client-side confirmation UX
that gates this endpoint.
