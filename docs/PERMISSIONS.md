# Roles & Permissions

Source of truth: [`server/src/lib/permissions.ts`](../server/src/lib/permissions.ts) (catalog + role
defaults + resolver) and [`server/src/middleware/auth.ts`](../server/src/middleware/auth.ts)
(enforcement). The employee-facing editor for this lives at `/employees` in the web app (ADMIN only).

## Two layers of access control

1. **Role** (`User.role`) — a fixed enum, gates entire pages/route groups. Some server routes are
   locked to a role regardless of permissions (`requireRole("ADMIN")`); some frontend routes are
   role-gated the same way (see [ARCHITECTURE.md](./ARCHITECTURE.md#routing--layout)).
2. **Permissions** (`User.permissions`) — a fine-grained, per-employee, per-feature boolean map that
   can override the role's defaults. Most server mutation routes are gated by a specific permission
   key rather than a role, so an admin can, for example, grant a cashier the ability to manage
   customers without making them a manager.

A request only needs to satisfy **one** applicable check per route — routes are gated by either a role
*or* a permission, never both (see the [API reference](./API.md) for the exact gate on each endpoint).

## Roles

| Role | Intended use |
|---|---|
| `ADMIN` | Store owner/manager with full access. **Always passes every permission check**, regardless of their own `permissions` row — this is deliberate, so an admin can never lock themselves out by misconfiguring their own overrides. Employees, Settings, and the destructive data-reset endpoint are hardcoded to `requireRole("ADMIN")` and are not permission-toggleable for anyone else. |
| `MANAGER` | Day-to-day operations lead. Defaults to all permissions, like ADMIN, but is not treated as ADMIN by `requireRole("ADMIN")` routes (Employees/Settings/data reset stay admin-only). |
| `CASHIER` | Till operator. Defaults to sales + customer lookup only. |
| `STOREKEEPER` | Stock/inventory role. Defaults to product and supplier management. |
| `ACCOUNTANT` | Finance role. Defaults to expenses, suppliers, customers, and reports. |

## Permission catalog

| Category | Key | Label | Gates (examples) |
|---|---|---|---|
| Sales | `MAKE_SALES` | Can make sales & manage the cash register | `POST /api/sales`, all of `/api/cash-register/*`, `POST /api/mpesa/stk-push` |
| Sales | `MANAGE_CUSTOMERS` | Can view & manage customers / credit sales | `POST/PUT /api/customers`, `POST /api/customers/:id/payments` |
| Sales | `VIEW_REPORTS` | Can view reports & sales totals | every route under `/api/reports/*` |
| Stock | `MANAGE_PRODUCTS` | Can add/edit products, categories & stock | `/api/products/*` mutations, `/api/categories/*` mutations, stock adjustments |
| Stock | `MANAGE_SUPPLIERS` | Can manage suppliers & purchases | `/api/suppliers/*` mutations |
| Finance | `MANAGE_EXPENSES` | Can approve expenses & record income | `PUT /api/expenses/:id/decision`, `POST /api/income`, expense category creation |
| Marketing | `MANAGE_PROMOTIONS` | Can create promotions & coupons | `/api/promotions/*` and `/api/coupons/*` mutations |

Read-only GETs on most of these resources only require `requireAuth` (any logged-in user), not the
specific permission — the permission gate applies to *mutations*. Check [API.md](./API.md) for the
exact auth requirement per route; it is not always symmetric between GET and POST/PUT/DELETE on the
same resource.

## Role defaults

Applied whenever `User.permissions` is `null` (i.e. an employee has no explicit overrides):

| Permission | ADMIN | MANAGER | CASHIER | STOREKEEPER | ACCOUNTANT |
|---|:---:|:---:|:---:|:---:|:---:|
| `MAKE_SALES` | ✅ | ✅ | ✅ | | |
| `MANAGE_CUSTOMERS` | ✅ | ✅ | ✅ | | ✅ |
| `VIEW_REPORTS` | ✅ | ✅ | | | ✅ |
| `MANAGE_PRODUCTS` | ✅ | ✅ | | ✅ | |
| `MANAGE_SUPPLIERS` | ✅ | ✅ | | ✅ | ✅ |
| `MANAGE_EXPENSES` | ✅ | ✅ | | | ✅ |
| `MANAGE_PROMOTIONS` | ✅ | ✅ | | | |

## Per-employee overrides

`User.permissions` is a nullable JSON column holding a **partial** map (only the keys that differ from
the role default need to be present). `resolvePermissions(role, overrides)` starts from
`ROLE_DEFAULT_PERMISSIONS[role]` and merges any boolean-valued keys from `overrides` on top.

From the Employees page (ADMIN only), an admin can toggle any of the 7 keys per employee; "reset to
role defaults" clears the override (sends `permissions: null`), reverting the employee to their role's
defaults. `PUT /api/employees/:id` distinguishes three cases for the `permissions` field:

| Request value | Effect |
|---|---|
| omitted entirely | leave existing overrides untouched |
| `null` | clear overrides — employee reverts to pure role defaults |
| `{ "MANAGE_PRODUCTS": true, ... }` | merge these keys into the existing override map |

The employee list response includes a `customized: boolean` flag (`true` if the raw DB value is
non-null) so the UI can show "custom permissions" vs "role defaults" per employee.

## Server-side enforcement

Three middleware functions in `server/src/middleware/auth.ts`, always applied after `requireAuth`:

- **`requireAuth`** — validates the JWT, loads the user fresh from the database (not just the token
  payload) and rejects with `401` if the account is missing or `active: false`. Populates
  `req.auth = { userId, storeId, role, permissions }` where `role`/`storeId` come from the live DB row
  and `permissions` is the already-resolved `PermissionMap` (role defaults + overrides merged).
- **`requireRole(...roles)`** — `403 Insufficient permissions` unless `req.auth.role` is in the list.
  Used only for `ADMIN`-only routes (Employees, Settings, cash-register... no — cash register uses
  `requirePermission`; see [API.md](./API.md) for the exact list).
- **`requirePermission(key)`** — `403 Insufficient permissions` unless `req.auth.role === "ADMIN"` (an
  automatic pass) or `req.auth.permissions[key] === true`.

Because `requireAuth` re-resolves role/permissions from the database on every request, an admin
changing an employee's role or permissions (or disabling their account) takes effect on that
employee's *next* request — there's no need to force a re-login, and no stale-permission window beyond
one request's network latency.

## Frontend enforcement

The frontend applies the **same** role/permission model, but as UX, not as a security boundary — the
server is the actual authority. Two mechanisms in `web/src/`:

- **Route-level role gating** (`App.tsx`'s `ProtectedRoutes`): each top-level route declares an allowed
  `roles` list; a logged-in user whose role isn't in it gets redirected to `/`. See the full route
  table in [ARCHITECTURE.md](./ARCHITECTURE.md#routing--layout).
- **Permission-based UI filtering**: `Sidebar.tsx` hides nav items the user's `permissions` map doesn't
  allow (ADMIN bypasses this, same as the backend). Individual pages also gate specific actions inline
  — e.g. `Expenses.tsx` only shows the approve/reject buttons when
  `role === "ADMIN" || permissions.MANAGE_EXPENSES`.

Since the frontend check is only for UX, never add a new mutation without also gating it server-side —
a hidden button is not access control.
