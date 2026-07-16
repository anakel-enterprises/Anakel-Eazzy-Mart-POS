# Anakel Eazzy Mart POS

Point of Sale for Anakel Eazzy Mart — a Kenyan minimart. Built as an installable PWA so checkout keeps
working when the internet drops, syncing queued sales back to the server once the connection returns.

## Documentation

| Doc | Covers |
|---|---|
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | System design, request pipeline, auth, offline/sync engine, PWA config, design system, known gaps |
| [docs/API.md](./docs/API.md) | Full REST API reference — every endpoint, request/response shape, business rules |
| [docs/DATA_MODEL.md](./docs/DATA_MODEL.md) | Prisma schema reference, ERD, foreign key behavior, migration history |
| [docs/PERMISSIONS.md](./docs/PERMISSIONS.md) | Roles, the permission catalog, per-role defaults, how enforcement works |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Environment variables, Vercel topology, migrations on deploy, rollback |
| [docs/CONTRIBUTING.md](./docs/CONTRIBUTING.md) | Local setup, conventions, branch workflow, how to verify a change |

Start with **ARCHITECTURE.md** for the big picture, then **API.md**/**DATA_MODEL.md** as references
while you work.

## Stack

- **Backend:** Node.js, Express, PostgreSQL, Prisma, Zod, JWT auth — deployed as a Vercel serverless
  function
- **Frontend:** React (Vite), TypeScript, Tailwind CSS, Dexie (IndexedDB) for the offline sales queue,
  vite-plugin-pwa for installability — deployed as a static Vercel site
- **Design:** "Fresh Grocer" direction — dark green sidebar, soft rounded white cards, Inter/Space
  Grotesk type

## Project layout

```
server/   Express API + Prisma schema/migrations
web/      React PWA frontend
docs/     Architecture, API, data model, permissions, deployment, and contributing reference
```

Every business table in the Prisma schema carries a `storeId`, even though the product only ever runs a
single store today — this keeps a future multi-store rollout a config change instead of a data
migration.

## Quick start

Requires Node 20+ and a running PostgreSQL server.

```bash
npm install

# Backend
cp server/.env.example server/.env   # edit DATABASE_URL / DIRECT_URL / JWT_SECRET
createdb anakel_pos                  # or point DATABASE_URL at an existing db
npm run db:migrate --workspace server
npm run db:seed --workspace server

# Frontend
cp web/.env.example web/.env

# Run both (separate terminals)
npm run dev:server
npm run dev:web
```

The web app runs at http://localhost:5173, the API at http://localhost:4000.

Seeded accounts (see `server/prisma/seed.ts`):
- Admin — `admin@eazzymart.co.ke` / `admin123`
- Cashier — `cashier@eazzymart.co.ke` / `cashier123`

Full setup detail, environment variables, and production deployment: see
[docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md).

## What's built

Checkout/POS (cash, manually-recorded and live-STK-push M-Pesa, card, bank, split, and credit payment,
with tiered pricing, promotions, and coupon codes), Inventory (with CSV import and barcode label printing), Cash Register (open/close +
reconciliation), Suppliers & purchase ledgers, Customers & credit sales, Expenses & Income (with an
approval workflow), Promotions & Coupons, an 8-tab Reports suite (P&L, sales, profit, inventory,
finance, customers, suppliers, employee performance), Employees with per-employee role + fine-grained
permission overrides, and Settings (including an admin-gated full data reset for going live with fresh
inventory).

## Offline behavior

Signing in works offline too, as long as this device has signed in with that account at least once
before while online — an idle timeout, a logout, or reopening the app doesn't lock a cashier out just
because there's no connectivity right now. Checkout reads and writes against a local Dexie (IndexedDB) database first. Completed sales are queued
locally with a client-generated `clientId` and pushed to the server when online; the server treats
`clientId` as an idempotency key so a retried sync never double-books a sale or double-counts stock. The
product catalog is cached locally on login and refreshed whenever the app comes back online. Dashboard
and every Reports tab show this device's last-known figures while offline, live-adjusted the moment a
sale is rung up on this device — so totals, trends, and stock levels update instantly, offline or on,
before a sync ever happens — with a clear banner and an automatic refresh once connectivity returns.
Inventory works offline too — adding a product, editing one, and adjusting stock all queue locally and
sync the same way as a sale, and a product added offline is immediately searchable and sellable at
Checkout even before its own sync has completed. Full detail in
[docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md#offline-first--sync-architecture).
