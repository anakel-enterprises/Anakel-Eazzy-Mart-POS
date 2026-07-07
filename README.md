# Anakel Eazzy Mart POS

Point of Sale for Anakel Eazzy Mart — a Kenyan minimart. Built as an
installable PWA so checkout keeps working when the internet drops, syncing
queued sales back to the server once the connection returns.

## Stack

- **Backend:** Node.js, Express, PostgreSQL, Prisma
- **Frontend:** React (Vite), TypeScript, Tailwind CSS, Dexie (IndexedDB) for
  the offline sales queue, vite-plugin-pwa for installability
- **Design:** "Fresh Grocer" direction — dark green sidebar, soft rounded
  white cards, Inter/Space Grotesk type

## Project layout

```
server/   Express API + Prisma schema/migrations
web/      React PWA frontend
```

Every business table in the Prisma schema carries a `storeId`, even though
Phase 1 only ever runs a single store — this keeps a future multi-store
rollout a config change instead of a data migration.

## Getting started

Requires Node 20+ and a PostgreSQL server.

```bash
npm install

# Backend
cp server/.env.example server/.env   # edit DATABASE_URL / JWT_SECRET
createdb anakel_pos                  # or update DATABASE_URL to an existing db
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

## Phase 1 (MVP) scope

Dashboard, Checkout/POS (cash + M-Pesa + card/bank/credit), Inventory,
Categories, Cash Register (open/close + reconciliation), basic Reports,
Employees & Roles (Admin/Cashier), Settings.

Deferred to later phases: Suppliers, Purchase Orders, Customers/Credit Sales,
Loyalty, Promotions, Returns, Multi-store, Notifications, Audit Trail,
Analytics, Backup, AI features.

## Offline behavior

Checkout reads and writes against a local Dexie (IndexedDB) database first.
Completed sales are queued locally with a client-generated `clientId` and
pushed to the server when online; the server treats `clientId` as an
idempotency key so a retried sync never double-books a sale or double-counts
stock. The product catalog is cached locally on login and refreshed whenever
the app comes back online.
