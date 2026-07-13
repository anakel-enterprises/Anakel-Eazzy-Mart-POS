# Deployment

## Topology

The frontend and backend are deployed as **two separate Vercel projects** from the same monorepo —
there is no single combined deploy.

| Project | Root directory | `vercel.json` | What it serves |
|---|---|---|---|
| API | `server/` | `{ "rewrites": [{ "source": "/(.*)", "destination": "/api" }] }` | Every request is rewritten to the single serverless function `server/api/index.ts`, which re-exports the Express `app` (`server/src/app.ts`). Express's own router then dispatches based on the full path (`/api/sales`, etc.). |
| Web | `web/` | `{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }` | Standard SPA fallback — every path serves `index.html` and `react-router-dom` handles routing client-side. |

Both are configured to auto-deploy from the `main` branch.

## Environment variables

### Server (`server/.env.example` documents the same set)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `JWT_SECRET` | **yes** — the app refuses to start without it | — | Signs/verifies auth JWTs. Use a long random string in production; never reuse the dev placeholder. |
| `DATABASE_URL` | yes (required by Prisma) | — | Pooled Postgres connection string, used at runtime by Prisma Client. |
| `DIRECT_URL` | yes (required by Prisma) | — | Non-pooled Postgres connection string, used only by `prisma migrate`. On a plain Postgres instance with no connection pooler in front of it, this can be the same value as `DATABASE_URL`. On Vercel Postgres/Neon, use the pooled URL for `DATABASE_URL` and the direct one here. |
| `PORT` | no | `4000` | Only relevant to the local/traditional-server entrypoint (`src/index.ts`); irrelevant on Vercel, where `api/index.ts` is the actual entry. |
| `CORS_ORIGIN` | no | `http://localhost:5173` | Comma-separated list of allowed web origins, passed straight to the `cors` middleware. Add the deployed web app's URL (and any Vercel preview URLs you want to allow) here in production. |
| `MPESA_CONSUMER_KEY` | no — but the STK push endpoint 503s without it | — | From your Safaricom Daraja app. See [M-Pesa (Daraja) setup](#m-pesa-daraja-setup). |
| `MPESA_CONSUMER_SECRET` | no — but the STK push endpoint 503s without it | — | From your Safaricom Daraja app. |
| `MPESA_SHORTCODE` | no | `174379` (Safaricom's published sandbox test shortcode) | The Paybill/Till number STK push charges against. Set to your real Paybill/Till when moving to production. |
| `MPESA_PASSKEY` | no | Safaricom's published sandbox test passkey | Pairs with `MPESA_SHORTCODE` to sign the STK push request. Get your production passkey from the Daraja portal alongside your production shortcode. |
| `MPESA_ENV` | no | `sandbox` | `sandbox` or `production` — selects Safaricom's API base URL. |
| `MPESA_CALLBACK_URL` | no — but the STK push endpoint 503s without it | — | A **public HTTPS URL** Safaricom can reach — your deployed API's `<api-url>/api/mpesa/callback`. Can't be `localhost`; Safaricom's servers call this directly. |

### Web (`web/.env.example` documents the same set)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `VITE_API_URL` | no | `http://localhost:4000` | Base URL the SPA sends all API requests to. Set this to the deployed API project's URL in the web project's Vercel environment settings. |

Set server variables in the **API** Vercel project's environment settings, and `VITE_API_URL` in the
**web** project's — they're separate projects with separate env var scopes.

## Database migrations on deploy

`server/package.json`'s `vercel-build` script is `prisma generate && prisma migrate deploy` — Vercel
runs this automatically as part of every deploy of the API project. `prisma migrate deploy` applies any
migration files under `server/prisma/migrations/` that haven't been applied to the target database yet;
it does **not** create new migrations or prompt for confirmation. Practically, this means:

- Schema changes ship automatically the moment a deploy runs, as long as the migration file is
  committed — there's no separate manual migration step for production.
- **Always generate and commit the migration locally first** (`npm run db:migrate --workspace server`,
  which runs `prisma migrate dev` and will prompt you interactively if needed) — never hand-edit
  `schema.prisma` and expect `migrate deploy` to figure out the diff; it only replays already-generated
  SQL files in order.
- Because this runs on every deploy with no manual gate, a broken or destructive migration goes straight
  to production data. Review migration SQL before merging, same as you would review a raw SQL script
  running directly against prod.

## Local development setup

Prerequisites: Node 20+, a running PostgreSQL server.

```bash
npm install

# --- Backend ---
cp server/.env.example server/.env      # edit DATABASE_URL / DIRECT_URL / JWT_SECRET if needed
createdb anakel_pos                     # or point DATABASE_URL at an existing db
npm run db:migrate --workspace server   # applies migrations, prompts to create one if schema drifted
npm run db:seed --workspace server      # creates the demo store, accounts, and sample catalog

# --- Frontend ---
cp web/.env.example web/.env

# --- Run both (separate terminals) ---
npm run dev:server   # http://localhost:4000
npm run dev:web       # http://localhost:5173
```

Seeded accounts (from `server/prisma/seed.ts` — safe to re-run, all upserts):
- Admin — `admin@eazzymart.co.ke` / `admin123`
- Cashier — `cashier@eazzymart.co.ke` / `cashier123`

## Verifying a deploy

There's no automated CI (see [CONTRIBUTING.md](./CONTRIBUTING.md)), so treat every deploy as needing a
manual smoke check:

1. `GET /health` on the API project returns `{ "status": "ok" }`.
2. Log in on the deployed web app with a real account; confirm the dashboard loads.
3. Ring up a test sale end-to-end (Checkout → complete sale → confirm it lands in Reports).
4. If the deploy included a migration, confirm the migration actually applied — check the Vercel build
   log for the `prisma migrate deploy` step, or query the target database directly.

## M-Pesa (Daraja) setup

Live M-Pesa payments at checkout (see [ARCHITECTURE.md](./ARCHITECTURE.md#m-pesa-stk-push-integration))
need a Safaricom Daraja API app. The app boots fine with none of this configured — `POST
/api/mpesa/stk-push` just returns `503` until it's set up, everything else works normally.

**Sandbox (free, self-serve, for testing before going live):**

1. Create an account at [developer.safaricom.co.ke](https://developer.safaricom.co.ke) and create a new
   app. This gives you a sandbox **Consumer Key** and **Consumer Secret** — set these as
   `MPESA_CONSUMER_KEY` / `MPESA_CONSUMER_SECRET`.
2. Leave `MPESA_SHORTCODE`/`MPESA_PASSKEY`/`MPESA_ENV` unset — the defaults are Safaricom's own
   published sandbox test values (shortcode `174379`) and already point at the sandbox API.
3. Set `MPESA_CALLBACK_URL` to your deployed API's `/api/mpesa/callback` — this **must** be a public
   HTTPS URL Safaricom's servers can reach; `localhost` will never receive a callback. If you're testing
   locally rather than against a deployed API, you'll need a tunnel (e.g. ngrok) pointed at your local
   server and use that tunnel's HTTPS URL here.
4. Test with Safaricom's published sandbox test phone number/PIN (documented on the Daraja sandbox
   simulator) — a real phone number won't receive an actual prompt in sandbox mode.

**Production (once you're ready to take real payments):**

1. Apply for a production app / Paybill or Till number through Safaricom (this involves real business
   verification — it's not self-serve like the sandbox).
2. Set `MPESA_ENV=production`, and swap in your production `MPESA_CONSUMER_KEY`,
   `MPESA_CONSUMER_SECRET`, `MPESA_SHORTCODE`, and `MPESA_PASSKEY` — no code changes required, this is
   purely an environment variable swap in the API project's Vercel settings.
3. Update `MPESA_CALLBACK_URL` to the production API URL if it differs from what you tested sandbox
   against.

## Resetting a store's data before going live

`POST /api/settings/reset-data` (surfaced as "Reset store data" on the Settings page, admin-only) wipes
all products/sales/customers/suppliers/expenses/promotions for a store while preserving employee
accounts and the store profile — see [API.md](./API.md#post-apisettingsreset-data) and
[ARCHITECTURE.md](./ARCHITECTURE.md#destructive-operations) for exactly what it does and doesn't touch.
This is the intended way to clear out seed/demo data before a store starts selling for real; it is
irreversible, so back up anything worth keeping (e.g. export Inventory/Reports data) before running it
against a production database.

## Rollback

Vercel keeps prior deployments and supports instant rollback to a previous build from its dashboard for
both projects independently. A **schema rollback is not automatic** — `prisma migrate deploy` only
applies forward migrations; rolling back a deploy that included a migration does not revert the
database. If a migration needs to be undone, write and commit a new forward migration that reverses it,
rather than relying on redeploying an older build.
