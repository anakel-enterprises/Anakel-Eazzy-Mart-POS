# Contributing

## Getting set up

See [DEPLOYMENT.md](./DEPLOYMENT.md#local-development-setup) for the full local dev setup (install,
`.env` files, database, seed, running both dev servers).

## Project layout

```
server/
  src/
    routes/        one file per resource, mounted in app.ts
    middleware/     requireAuth / requireRole / requirePermission / errorHandler
    lib/            auth (JWT sign/verify), env (validated config), permissions (catalog + resolver), prisma (client singleton)
    app.ts          Express app construction — cors, json, health check, router mounting, error handler
    index.ts        local/dev entrypoint (app.listen)
  api/
    index.ts        Vercel serverless entrypoint (re-exports app)
  prisma/
    schema.prisma
    migrations/
    seed.ts
web/
  src/
    pages/          one file per route (see the route table in ARCHITECTURE.md)
    components/      shared UI: Layout, Sidebar, Topbar, ui.tsx primitives, BarcodeLabel/ScannerModal, ImportProductsModal, ProductDetailModal
    context/         AuthContext, SidebarContext
    db/              Dexie (IndexedDB) schema — localDb.ts
    lib/             api.ts (fetch wrapper), sync.ts (offline sync engine), sessionTimeout.ts, csv.ts, permissions.ts
docs/                you are here
```

## Conventions

These aren't enforced by a linter — follow the existing code's patterns rather than introducing a new
style:

- **Store-scope every query.** Every business table has `storeId`; every read/write in a route handler
  should filter/set it from `req.auth.storeId`, never trust a client-supplied store id. See any
  existing route file for the pattern.
- **Validate at the boundary.** Every route that accepts a body defines its own Zod schema right above
  the handler and calls `.parse(req.body)` (or `.partial()` for PATCH-style updates) before touching
  Prisma. Don't reach into `req.body` unvalidated.
- **Money is `Decimal`.** Use Prisma's `Decimal` type / `Prisma.Decimal` for arithmetic on currency
  fields — never coerce to plain JS numbers mid-calculation and back.
- **Prefer soft delete for anything with history.** If a row can be referenced by a `Sale` (products,
  promotions, coupons), deactivate it (`active: false`) rather than deleting — Prisma's schema uses
  `RESTRICT` on those foreign keys specifically to make an accidental hard-delete fail loudly instead of
  silently orphaning sale history.
- **Gate mutations with `requirePermission`, not just `requireRole`.** Most resources use the
  fine-grained permission system (see [PERMISSIONS.md](./PERMISSIONS.md)) so access can be tuned per
  employee; reserve `requireRole("ADMIN")` for the handful of routes that are deliberately
  non-delegable (Employees, Settings, data reset).
- **A frontend permission/role check is UX, not security.** Never ship a mutation gated only on the
  client — always add the matching `requirePermission`/`requireRole` on the server route too.
- **Idempotency for anything the offline sync queue might retry.** If you add a new kind of
  offline-queueable write, follow the `Sale.clientId` pattern: a client-generated unique key, checked
  first, with a no-op replay on repeat rather than reprocessing.

## Branch & commit workflow

This repo currently develops on a long-lived feature branch alongside `main`, keeping both in sync:

```bash
# commit on main
git checkout main
git add <files>
git commit -m "…"
git push -u origin main

# fast-forward the feature branch to match
git checkout <feature-branch>
git merge --ff-only main
git push -u origin <feature-branch>
```

Vercel auto-deploys from `main`. Write commit messages that explain *why*, not just *what* — the diff
already shows what changed.

## Verifying a change before committing

There is no automated test suite or CI pipeline in this repo yet — verification is manual and should
cover both layers:

1. **Typecheck**: `npm run typecheck --workspace server` and `npm run typecheck --workspace web` (the
   web `build` script also gates on `tsc --noEmit` before running Vite).
2. **Build**: `npm run build:server` and `npm run build:web` — catches anything typecheck alone misses
   (e.g. Vite-specific bundling issues).
3. **Manual end-to-end testing**: start both dev servers against a local Postgres, and actually drive
   the changed flow in a real browser — don't rely on typecheck/build passing as a proxy for the
   feature working. For anything touching checkout, sync, or a destructive operation (like the data
   reset endpoint), test with realistic seeded data, not an empty database, so you actually exercise
   the code paths that matter (FK constraints, idempotent replay, stock decrements, etc.).
4. **For destructive/irreversible operations** (data wipes, hard deletes, migrations touching existing
   data): test against a disposable local database first, and verify both what should be deleted *and*
   what should survive — a reset script that deletes too much is exactly as broken as one that deletes
   too little.

Since there's no CI gate, these checks are the only thing standing between a change and production —
treat them as required, not optional, before pushing to `main`.

## Adding a new resource (a worked pattern)

If you're adding a new business entity (following the shape of, say, Suppliers or Promotions):

1. Add the model to `schema.prisma` with `storeId` + relation + `RESTRICT`/`SET NULL`/`CASCADE` chosen
   deliberately (see [DATA_MODEL.md](./DATA_MODEL.md) for the reasoning behind the existing choices),
   then `npm run db:migrate --workspace server` to generate and apply the migration.
2. Add a permission key to `PERMISSION_KEYS`/`PERMISSION_CATALOG`/`ROLE_DEFAULT_PERMISSIONS` in
   `server/src/lib/permissions.ts` if the resource needs its own gate, rather than reusing an existing
   key that doesn't quite fit.
3. Add a route file under `server/src/routes/`, mount it in `app.ts`, validate with Zod, scope every
   query by `storeId`.
4. Add a page under `web/src/pages/`, a route entry in `App.tsx` (with the roles that should see it),
   and a nav entry in `Sidebar.tsx` gated by the new permission key.
5. Update [API.md](./API.md), [DATA_MODEL.md](./DATA_MODEL.md), and
   [PERMISSIONS.md](./PERMISSIONS.md) — this repo has no OpenAPI spec or schema-introspection tooling
   generating docs automatically, so they're hand-maintained and will drift if not updated alongside
   the code.

## Documentation maintenance

The `docs/` folder is hand-written, not generated. When you change an API contract, a schema field, a
permission, or an architectural decision documented here, update the relevant file in the same PR —
treat stale docs as a bug, not a follow-up.
