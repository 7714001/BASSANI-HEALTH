# Bassani Health Portal — Production Readiness Roadmap

**System:** Bassani Health B2B Sales & Reseller Portal  
**Stack:** FastAPI · React 18 · MongoDB · Odoo v17 (XML-RPC) · Railway  
**Last Updated:** 2026-06-26  
**Overall Status:** 🟡 Pre-Production — Phases 0, 2, 4, 6, 8 code complete; Phase 1 in progress (CORS + 2FA deferred to pre-launch); Phase 8 DoD 7/8 complete — only staff account creation outstanding; Phase 10 responsive UI in progress (10.0–10.4 core work complete)  

---

## Progress Overview

| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| 0 | Roles, Permissions & Identity Foundation | 🟢 Complete | Sub-deploys 1–4 complete — 2026-06-19 |
| 1 | Security Hardening | 🟡 In Progress | 1.1/1.3/1.4/1.6/1.7 complete — 2026-06-19/2026-06-23 · 1.2/1.5 deferred to pre-launch |
| 2 | Email Engine | 🟢 Complete | All templates + wiring complete — 2026-06-23 · Resend domain verification pending client credentials |
| 3 | Core Odoo Integration | 🟡 In Progress | 3.1–3.3, 3.5–3.8 complete; 3.2 needs live VAT verification; 3.4 deferred (pricelists not in use); 3.5 cancellation email deferred to Phase 2 — 2026-06-19 |
| 4 | Commission Engine Hardening | 🟢 Complete | All 5 items (4.1–4.5) complete — 2026-06-23 |
| 5 | Reliability & Resilience | 🔴 Not Started | — |
| 6 | Observability & Operations | 🟢 Complete | 6.1–6.4 complete — 2026-06-23 · 6.5 (Cloudflare Pages) deferred |
| 7 | Missing Commercial Workflows | 🟡 Partial (7.4 deferred — R2 needed; 7.6 complete) | 2026-06-24 |
| 8 | Order Workflow & Ticketing System | 🟡 In Progress | Sub-deploys 1–9 (8.1–8.11 code complete) — 2026-06-23 |
| 9 | Go-Live Infrastructure | 🔴 Not Started | — |
| 10 | Responsive UI | 🟡 In Progress | 10.0–10.4 complete (login fix, shell overflow, column hiding, form grids, quote builder) — 2026-06-26 |

**Status Key:** 🔴 Not Started · 🟡 In Progress · 🟢 Complete · ⏸ Deferred

---

## Architecture Principles (Non-Negotiable)

These govern every decision made during implementation. Do not deviate from them.

- **Odoo is the financial source of truth.** Every invoice, payment, vendor bill, credit note, and order must originate in or be confirmed by Odoo. The portal never becomes a parallel ledger.
- **The portal is the intended main point of access, not Odoo directly.** Odoo stays the single source of truth (the data), but the portal should grow toward full operational coverage of Odoo's day-to-day capability for this business — product/customer/order management, stock, tax, credit, etc. — so admins log into Odoo itself only in an emergency or when the portal genuinely lacks a capability, not as routine practice. (Confirmed with the business 2026-06-19.) Every field-parity gap found going forward (e.g. an Odoo field shown but not editable in the portal) should be treated as in-scope, not "Odoo-only by design," unless there's a specific reason to keep it Odoo-only (e.g. fiscal/compliance-sensitive operations).
- **The ticket system is the single processing pipeline for all orders.** Every `sale.order` created via the portal — whether placed by a reseller, by internal Bassani staff, or converted from a direct customer inquiry — automatically creates a Sales ticket and flows through Sales → Orders (packing board) → QA/RP → Finance. No order moves through the business outside the ticket pipeline. Nobody logs into Odoo to process an order. (Confirmed with the business 2026-06-19.)
- **The portal is a true middleware layer — it maps to how the business already works, not how Odoo works.** The business has a natural process: inquiry → quote → customer acceptance → deposit → fulfilment → collection. The portal must express that process in business language, not Odoo language. Every step in that workflow — creating a quote, registering a deposit, confirming an order, tracking packing — must be completable entirely within the portal without the operator needing to know that Odoo exists. Odoo is the system of record; the portal is the system of operation. Any gap where a staff member is currently directed to "do this part in Odoo" is a gap in the portal, not an acceptable design choice. (Confirmed with the business 2026-06-21.)
- **MongoDB handles portal-layer concerns only.** Reseller profiles, commission records, ownership mappings, onboarding, audit logs, and settings belong in MongoDB.
- **All commission payments must produce an Odoo vendor bill.** No statement can be marked paid without a corresponding `account.move` in Odoo.
- **Everything runs on Railway.** No external services beyond Resend (email API), Sentry (error monitoring), and Cloudflare (CDN/backups). No new infrastructure without explicit decision.
- **Background tasks do not block API responses.** Emails, notifications, and non-critical writes always fire via `BackgroundTasks`.
- **Every admin action is audit-logged.** Every state change on a financial record captures actor, timestamp, IP, and before/after values.
- **All Odoo reads and writes are warehouse- and company-scoped.** Bassani operates across multiple warehouses belonging to different Odoo companies. Every stock read (`qty_available`, `virtual_available`), tax lookup (`taxes_id`), and record creation (`sale.order`, `account.move`, `account.payment`) must be scoped to the resolved warehouse's company — passing `company_id` and `allowed_company_ids` in context for creates/wizards, and filtering tax lookups by `company_id`. Without this, Odoo returns cross-company totals for reads and raises company-consistency errors on writes. The shared helpers `get_company_id()` and `company_context()` in `warehouse_context.py` are the single implementation point — any new endpoint that touches Odoo stock, pricing, or financial records must use them. (Identified and fixed 2026-06-22.)

---

## Phase 0 — Roles, Permissions & Identity Foundation

**Goal:** Every person who touches the system has their own named account with appropriate access. Audit logs identify individuals, not just "admin". The packing floor is authenticated end-to-end.  
**Estimate:** 1–2 weeks  
**Status:** 🟢 Complete  
**Completed:** Sub-deploy 1 (0.1–0.4) — 2026-06-18 · Sub-deploy 2 (permission-gated UI, products domain, sidebar filtering) — 2026-06-18 · Sub-deploy 3 (0.5 Packing Board Auth) — 2026-06-18 · Sub-deploy 4 (0.6 Audit Trail Foundation) — 2026-06-19  

### Context

Currently the system has two roles: `admin` (full access to everything) and `reseller`. All admins share identical god-mode permissions, meaning audit logs say `"user": "admin"` with no way to know which staff member acted. The packing board WebSocket endpoints have **zero authentication** — anyone with the URL can see all orders and control the board. Packers are hardcoded name strings, not real accounts.

This phase is the foundation for everything that follows. It must be completed before Phase 1 because it changes how `require_admin` works across every route.

---

### 0.1 — User Roles Definition

The system will support five distinct roles:

| Role | Created By | Purpose |
|---|---|---|
| `super_admin` | Env var seed only | Full system access. Manages admin accounts, system config, tier settings. One per deployment. |
| `admin` | Super admin | Day-to-day operations with a configurable permission set. |
| `warehouse_supervisor` | Super admin or admin | Packing floor supervision. Assigns packers, manages order flow. |
| `packer` | Super admin or admin | Warehouse packer. Sees and works their own assigned orders only. |
| `reseller` | Admin | Unchanged from current behaviour. |

- [x] Add `role` enum to user schema to support all five values
- [x] Add `is_super_admin: bool` flag to user document (separate from role — super admin is the one seeded from env)
- [x] Ensure existing `admin` and `reseller` users migrate cleanly to the new schema

---

### 0.2 — Granular Admin Permissions

Each `admin` user has a `permissions` object stored on their user document. `super_admin` and `warehouse_supervisor` have fixed permission sets.

**Permission structure:**

```json
{
  "permissions": {
    "products":    { "manage": false },
    "orders":      { "view": true,  "confirm": false, "cancel": false },
    "customers":   { "view": true,  "approve_onboarding": false, "reject_onboarding": false },
    "commission":  { "view": true,  "generate_statements": false, "mark_paid": false, "configure_tiers": false },
    "resellers":   { "view": true,  "manage": false },
    "invoices":    { "view": true,  "record_payment": false },
    "reports":     { "view": true,  "export": false },
    "healthcare":  { "view": true,  "manage": false },
    "users":       { "manage": false },
    "warehouse":   { "view": false, "supervise": false }
  }
}
```

- [x] Add `permissions` object to user document schema
- [x] Define default permission set for new `admin` accounts (view-only on sensitive operations)
- [x] `super_admin` always has all permissions regardless of stored values
- [x] Add `products` domain (`products.manage`) — covers create, edit, archive, and future variant management
- [x] Frontend action buttons gated by `can()` in every view: Orders (confirm/cancel), Commission (generate statements, mark paid, configure tiers), Resellers (add/edit), Healthcare (approve, mark contacted, status dropdown), Customer Applications (approve/reject), Products (add/edit/archive)
- [x] Sidebar navigation filtered per admin user — only nav items the user has `view` (or `manage`) permission for are shown; super admin sees all
- [x] Default admin permissions pre-populated in the create user modal — view permissions on by default, write permissions off; switching role to admin loads defaults, switching away clears them
- [ ] `warehouse_supervisor` always has `warehouse.supervise` regardless of stored values — _pending 0.5_
- [ ] `packer` always has `warehouse.view` scoped to their assigned orders only — _pending 0.5_

---

### 0.3 — Permission-Based API Guards

Replace the single `require_admin` dependency with granular permission checks.

- [x] Create `require_permission(permission: str)` dependency factory in `auth.py`
  - e.g. `Depends(require_permission("commission.mark_paid"))`
  - Evaluates: is user `super_admin`? → allow. Does user have the named permission? → allow. Otherwise 403.
- [x] Audit every `require_admin` call across all route files and replace with the appropriate specific permission
- [x] Key permission mappings applied:
  - `POST /api/commission/statements/generate` → `commission.generate_statements`
  - `PUT /api/commission/statements/{id}/mark-paid` → `commission.mark_paid`
  - `PUT /api/commission/tiers` → `commission.configure_tiers`
  - `DELETE /api/commission/tiers/reset` → `commission.configure_tiers`
  - `PUT /api/orders/{id}/confirm` → `orders.confirm`
  - `PUT /api/orders/{id}/cancel` → `orders.cancel`
  - `PUT /api/onboarding/{id}/approve` → `customers.approve_onboarding`
  - `PUT /api/onboarding/{id}/reject` → `customers.reject_onboarding`
- [x] Keep `require_admin` as an alias for "any admin role" for non-sensitive list endpoints
- [x] Return clear 403 message: `"You do not have permission to perform this action"`

---

### 0.4 — Admin User Management UI

Super admin needs a UI to create and configure admin accounts.

- [x] Add `role` selector (admin / warehouse_supervisor / packer) to the Create User form
- [x] Add permissions panel in the User edit view — toggle switches per permission group, only visible when editing an `admin` role user
- [x] Super admin badge displayed on the super admin account row (non-editable)
- [x] Admin cannot edit their own permissions (prevents privilege escalation)
- [x] Admin cannot promote another user to `super_admin`
- [x] Display effective permissions summary on each user card in the Users list

---

### 0.5 — Packing Board Authentication

**Current state:** Both WebSocket endpoints (`/ws/board` and `/ws/supervisor`) have zero authentication. `supervisor.html` and `packing-board.html` are publicly accessible standalone HTML pages. Packers are hardcoded strings.

#### 0.5a — WebSocket Token Authentication

- [x] Add `token` query parameter support to both WebSocket endpoints:
  `wss://host/api/packing/ws/supervisor?token=eyJ...`
- [x] Validate JWT on WebSocket connect — reject with close code 4001 if invalid or missing
- [x] `/ws/board` (display screen): accept a long-lived read-only **display token** (not a user JWT) stored in `PACKING_BOARD_DISPLAY_TOKEN` env var. The screen URL becomes `wss://host/api/packing/ws/board?token=<display_token>`
- [x] `/ws/supervisor`: require a valid `warehouse_supervisor` JWT — regular user tokens are rejected
- [x] WebSocket actions (assign, tick, status update) now capture the authenticated user and write to audit log

#### 0.5b — Supervisor Authentication Flow

- [x] `supervisor.html` gets a login screen before the board is shown
- [x] Login posts to `/api/auth/login` and stores token in `sessionStorage` (not localStorage — clears on tab close)
- [x] Token is appended to the WebSocket URL on connect
- [x] Supervisor identity is shown in the header: "Logged in as: Sarah M."
- [x] Session expires after 8 hours (matching JWT expiry); supervisor is returned to login screen

#### 0.5c — Packer Accounts & Packer View

- [x] Packers are real portal users with `role: "packer"` — created by admin
- [x] Packer profile fields: `display_name` (shown on board, e.g. "THEMBI"), `phone`, `active`
- [x] Remove hardcoded `PACKERS` array from `supervisor.html`; populate packer picker from `GET /api/packing/packers`
- [x] `GET /api/packing/packers` returns active packer user accounts, not settings strings
- [x] Create `packer.html` — a new standalone page for the packer's handheld device:
  - Login screen → JWT stored in sessionStorage
  - Shows only orders where `packer_name == current_user.display_name`
  - Packer ticks items on their screen; WebSocket broadcasts to board and supervisor in real time
  - Large touch-friendly buttons — designed for warehouse gloves
- [x] Packing board display shows packer's `display_name` (unchanged visually)

#### 0.5d — Audit Trail for Packing Actions

- [x] WebSocket supervisor actions previously bypassed the REST layer and wrote directly to MongoDB — they skipped audit logging entirely
- [x] Route all WebSocket write actions through the same logic as the REST endpoints (extract into shared service functions)
- [x] Every `assign_packer`, `tick_item`, and `update_status` action logs to `audit_logs` with actor identity, timestamp, and order ID

#### 0.5e — Display Board Token

- [x] Add `PACKING_BOARD_DISPLAY_TOKEN` to Railway environment variables (generate: `openssl rand -hex 32`)
- [x] Board URL format: `https://yourdomain.com/packing-board.html?token=<display_token>` — no login prompt, auto-reconnects, read-only
- [x] The 85" screen connects using this URL — no login prompt, auto-reconnects, read-only

---

### 0.6 — Audit Trail Foundation

**Current state (confirmed from code):** Two competing audit implementations exist in the codebase. `middleware/audit.py::audit_log()` writes `{action, entity_id, user, user_id, detail:{before,after}, ip, timestamp}` and is only called from `packing_board_routes.py`. `routes/audit_routes.py::log_audit()` writes a *different* shape — `{action, entity_type, entity_id, entity_label, before, after, notes, user, user_role, ip, created_at}` — to the **same** `audit_logs` collection, and is never called by any route except its own manual-entry endpoint. Despite the "every admin action is audit-logged" principle, no route for orders, invoices, commission, onboarding, users, resellers, or healthcare writes an audit entry today. There is also no frontend page that reads `/api/audit/` — the data that does exist is invisible to a super admin.

This must be fixed before Phase 1+ adds more write-actions on top of an inconsistent foundation.

#### 0.6a — Unify the Audit Schema & Helper
- [x] Establish one canonical `audit_log()` in `middleware/audit.py` — single schema: `action, entity_type, entity_id, entity_label, actor_username, actor_id, actor_role, before, after, detail, ip, created_at`
- [x] Delete the duplicate `log_audit()` writer in `routes/audit_routes.py` — that file becomes query/read-only
- [x] Add MongoDB indexes on `audit_logs`: `created_at` (desc), `entity_type + entity_id`, `actor_username`, `action`

#### 0.6b — Permission-Gated Access
- [x] Add `audit: {"view": false}` to the permission schema (`DEFAULT_ADMIN_PERMISSIONS`, `FULL_PERMISSIONS`) — consistent with the Phase 0.2 pattern; `super_admin` always has it
- [x] Gate `GET /api/audit/` and `GET /api/audit/actions` with `require_permission("audit.view")` instead of `require_admin`
- [x] Add `from`/`to` date-range query params and `actor` filter to `GET /api/audit/`

#### 0.6c — Wire Audit Logging Into Existing Sensitive Actions
- [x] Orders: `confirm`, `cancel`
- [x] Invoices: `post`, `reset`, `pay` (record payment)
- [x] Commission: `configure_tiers`, `reset_tiers`, `generate_statements`, `mark-paid`
- [x] Onboarding: `approve`, `reject`
- [x] Users: `create`, `update` (capture before/after on role and permission changes specifically), `reset-password`, `deactivate`, `reactivate`
- [x] Resellers: `create`, `update`, `delete`
- [x] Healthcare: submission `status` change, `delete`
- [x] Each call captures the authenticated actor, a human-readable `entity_label` (order ref, customer name, username), and `before`/`after` where the action changes state

#### 0.6d — Audit Trail Admin UI
- [x] New `frontend/src/views/AuditTrail.js` — `DataTable` + `SearchBar` pattern (consistent with Users/Orders)
- [x] Filters: date range, actor (user dropdown), action (dropdown from `/api/audit/actions`), entity type chips
- [x] Row expands to show `before`/`after` diff
- [x] New sidebar nav item "Audit Trail", gated by `audit.view` permission
- [x] New route `/audit` in `App.js` — `adminOnly`, permission-gated

#### 0.6e — Reseller-Initiated Actions & Per-Reseller Activity View
- [x] Add `reseller.submit` coverage: `onboarding.submit` (reseller submits a customer application) and `order.create` (reseller places an order) were previously unlogged — both call `get_current_user`, not `require_admin`, so the reseller's own actions had zero audit coverage
- [x] Add optional top-level `reseller_id` field to the `audit_log()` schema — threaded through every call that relates to a specific reseller (reseller create/update/delete, onboarding submit/approve/reject, order create/confirm/cancel, commission generate/mark-paid) regardless of `entity_type`, so "show everything for Reseller X" doesn't require querying every entity type separately
- [x] Add `reseller_id` filter to `GET /api/audit/` and a matching MongoDB index
- [x] Add an "Activity" section to `ResellerProfile.js` — fetches `GET /api/audit/?reseller_id=<id>`, gated by `audit.view`

#### Definition of Done — 0.6
- [x] One canonical audit schema exists; the duplicate writer is deleted
- [x] Confirming/cancelling an order, recording an invoice payment, generating/marking-paid a commission statement, approving/rejecting onboarding, creating/editing a user or reseller, and changing a healthcare submission status all produce a named-actor `audit_logs` entry
- [x] A reseller submitting an onboarding application or placing an order also produces a named-actor entry (previously the reseller's own actions were invisible)
- [x] A super admin can open Audit Trail, filter by date range and user, and see matching results
- [x] An admin without `audit.view` does not see the nav item and gets 403 calling the API directly
- [x] Opening a reseller's profile shows that reseller's own activity feed, filtered server-side by `reseller_id`
- [x] Indexes exist on `created_at`, `entity_type+entity_id`, `actor_username`, `reseller_id`

---

### Definition of Done

- [x] Every person interacting with the **portal** has their own named account — no shared credentials _(packing board pending 0.5)_
- [x] `audit_logs` entries show the specific user (`"user": "sarah.finance"`) not just `"admin"` _(portal actions only — packing board pending 0.5)_
- [x] An admin with only `orders.view` permission receives 403 when calling `POST /api/commission/statements/generate`
- [x] An admin without `orders.confirm` sees no Confirm button; an admin without `orders.cancel` sees no Cancel button
- [x] An admin without `products.manage` sees the product catalogue (read-only) but no Add / Edit / Archive controls
- [x] Admin sidebar only shows nav sections the user has permission to access
- [x] Super admin can create an admin user and assign/revoke individual permissions from the Users UI
- [x] New admin accounts open with sensible defaults pre-selected (view permissions on, write permissions off)
- [x] Navigating to `/supervisor.html` without a valid supervisor token shows a login screen
- [x] A packer logs in, sees only their assigned orders, ticks an item — the board updates in real time
- [x] All packing board WebSocket actions (assign, tick, status) appear in `audit_logs` with named actor
- [x] The 85" display screen connects using its display token URL — no login required, auto-reconnects

### Notes
> **Sub-deploy 1 (2026-06-18):** Completed 0.1–0.4. Backend: 5-role schema, `is_super_admin` flag, `FULL_PERMISSIONS`/`DEFAULT_ADMIN_PERMISSIONS` constants, `require_permission()` factory, env-var super admin seed with startup migration of existing admins. Frontend: `AuthContext` exposes `can()` helper + `isAdmin`, `ProtectedRoute` fixed for `super_admin`, Users view fully rebuilt with role selector, permissions panel, super admin badge, display name for packers. Sensitive endpoints guarded with granular permissions. **Pre-deploy requirement:** set `SUPER_ADMIN_USERNAME` and `SUPER_ADMIN_PASSWORD` in Railway env vars before deploying.

> **Sub-deploy 3 (2026-06-18):** Packing board authentication (0.5). Backend: `PACKING_BOARD_DISPLAY_TOKEN` added to config; WebSocket endpoints now require token auth (`?token=`) and close with code 4001 on rejection; shared action service functions (`_do_assign_packer`, `_do_tick_item`, `_do_update_status`) ensure all WS actions write to `audit_logs` with named actor; `GET /api/packing/packers` now returns real packer user accounts instead of settings strings; new `/ws/packer` endpoint for packer handhelds (tick-only). Frontend: `supervisor.html` replaced with login screen + sessionStorage token flow + real packers from API; `packing-board.html` reads token from `?token=` URL param with no-token error screen; new `packer.html` — login → filtered order view → large touch-friendly tick buttons; mock data fallback removed from packing-board.html. **Pre-deploy requirement:** generate and set `PACKING_BOARD_DISPLAY_TOKEN` in Railway env vars (`openssl rand -hex 32`). Board URL: `https://yourdomain.com/packing-board.html?token=<token>`.

> **Sub-deploy 4 (2026-06-19):** Audit Trail Foundation (0.6). Backend: unified `middleware/audit.py::audit_log()` to a single canonical schema (`action, entity_type, entity_id, entity_label, actor_username, actor_id, actor_role, before, after, detail, ip, created_at`); deleted the duplicate `log_audit()` writer that previously lived in `routes/audit_routes.py` and wrote a different, incompatible shape to the same collection; that file is now read-only (`GET /api/audit/`, `/actions`, `/actors`) with date-range and actor filters, gated by a new `audit.view` permission. Added MongoDB indexes on `created_at`, `entity_type+entity_id`, `actor_username`, `action`. Wired `audit_log()` into every existing sensitive write-action that previously had none: orders (confirm/cancel), invoices (post/reset/pay), commission (configure/reset tiers, generate statements, mark paid — with before/after on tier changes), onboarding (approve/reject), users (create/update/reset-password/deactivate/reactivate — before/after on role and permission changes), resellers (create/update/delete), healthcare (status change/delete). Packing board's existing audit calls updated to the new signature. Frontend: new `AuditTrail.js` view (DataTable + filters: entity type chips, actor, action, date range; row click shows before/after JSON diff), new sidebar nav item and `/audit` route, `audit.view` added to the permissions editor. **Migration:** startup event backfills `permissions.audit.view: false` on existing admin accounts. **Note:** Phase 4.3's planned commission-tier audit trail is now satisfied by this work — no separate implementation needed when Phase 4 is reached. **Follow-up same day (0.6e):** found that reseller-initiated actions (`onboarding.submit`, `order.create` — both use `get_current_user`, callable directly by resellers) had zero audit coverage; added those calls plus a top-level `reseller_id` field threaded through every reseller-related entry, and a per-reseller "Activity" feed on `ResellerProfile.js`. **Follow-up (0.6f):** added `user.login` audit entry on every successful `POST /api/auth/login` (alongside the existing `last_login_at` timestamp update), tagged with `reseller_id` when the logging-in user is a reseller. Pre-launch `audit_logs` collection cleared manually (no production data existed) so the collection starts clean on the unified schema.

> **Sub-deploy 2 (2026-06-18):** Permission-gated UI + products domain. Bug fix: startup event now syncs password from env vars on existing super admin accounts (fixes login failure when `SUPER_ADMIN_USERNAME` matches an existing user). Added `products.manage` permission domain (auth.py, Users.js, Views.js) — default off for new admins, on for super admin / migrated admins. Frontend: every action button across Orders, Commission, Resellers, Healthcare, Customer Applications, and Products now checks `can()` before rendering; sidebar nav filtered per-user permissions. Create user modal pre-populates default admin permissions (view on, write off) when admin role is selected. **Note:** existing admin accounts that already have `FULL_PERMISSIONS` will have `products.manage: true` — no migration needed. New admin accounts created after this deploy default to `products.manage: false`.

---

## Phase 1 — Security Hardening

**Goal:** Safe to expose to real users. No known exploitable vulnerabilities.  
**Estimate:** 1–3 days  
**Status:** 🟡 In Progress — 1.1, 1.3, 1.4, 1.6, 1.7 complete; 1.2 and 1.5 deferred until production domain/SSL are finalised  
**Completed:** Sub-deploy 1 (1.1, 1.3, 1.4, 1.6) — 2026-06-19 · Sub-deploy 2 (1.7 Forced Password Reset) — 2026-06-23  

### Tasks

#### 1.1 JWT Secret Enforcement
- [x] Add startup check in `server.py` — fail with clear error if `JWT_SECRET == "change-me-in-production"`
- [x] Document minimum requirements: 32+ character random string
- [x] Update `.env.example` with `JWT_SECRET=<run: openssl rand -base64 48>` _(file didn't exist — created)_

#### 1.2 CORS Lockdown — Deferred
> **Deferred until the production domain and SSL are finalised** (decided 2026-06-19). Locking `CORS_ORIGINS` to a domain that doesn't exist yet would break every deployed environment, including ongoing testing. Revisit immediately once the domain is live.
- [ ] Replace `allow_origins=["*"]` in `server.py` with `settings.cors_origins_list()`
- [ ] Set `CORS_ORIGINS=https://yourdomain.com` in Railway environment variables
- [ ] Verify preflight requests work correctly on frontend after change

#### 1.3 Default Admin Credentials
- [x] Remove hardcoded admin seed from `server.py` startup event _(completed in Phase 0.1)_
- [x] Replace with env-var provisioned super admin: `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD` _(completed in Phase 0.1 — note: implemented as `super_admin` role, not plain `admin`)_
- [x] Startup event is idempotent — safe to re-run on every deploy; creates account on first run, syncs credentials on subsequent runs _(completed in Phase 0.1, password sync bug fixed in sub-deploy 2)_
- [x] Deactivate the legacy `admin / admin123` account — startup migration now finds `{username: "admin", role: "admin"}` (excluding super_admin) and sets `active: False` automatically on every deploy, idempotent, reversible via the Users UI

#### 1.4 Login Rate Limiting
- [x] Add `slowapi` to `requirements.txt`
- [x] Apply rate limiter to `POST /api/auth/login` — 5 requests per 15 minutes per IP
- [x] Return `429 Too Many Requests` with `Retry-After` header on breach _(slowapi's default handler sets this)_
- [x] Apply rate limiter to `POST /api/healthcare/onboarding` — 10 per hour per IP

#### 1.5 2FA Enforcement for Admins — Deferred
> **Deferred alongside 1.2** (decided 2026-06-19). Forcing a 2FA setup prompt on every admin login would add friction to active testing of Phases 2–7. Revisit at the same time as the CORS lockdown, right before go-live.
- [ ] Set `require_2fa_admin=True` in config (infrastructure already exists via `pyotp`)
- [ ] Enforce 2FA setup prompt on first admin login after flag is enabled
- [ ] Verify admin cannot bypass 2FA by going directly to protected routes

#### 1.6 Cleanup
- [x] Remove `/debug-static` endpoint from `server.py` _(already removed in commit `2fae93a`, prior to this phase)_
- [x] Ensure FastAPI runs with `debug=False` in production _(default — never set to `True` anywhere; uvicorn start command has no `--reload`)_
- [x] Verify error responses return generic messages (no stack traces) to clients _(no custom exception handlers exist beyond slowapi's rate-limit handler; FastAPI's defaults apply)_

#### 1.7 Forced Password Reset on First Login

**Goal:** No staff account should sit on an admin-set password indefinitely. Admins set a temporary password when creating an account; the system enforces a password change on first login before the user can access anything else. The same gate re-fires whenever an admin resets a password.

- [x] Add `must_change_password: bool` to the user document — set `True` on `POST /api/users/` (new account creation) and on `POST /api/users/{id}/reset-password` (admin-initiated reset). Existing accounts (super admin, pre-existing staff) are not retroactively flagged — no migration needed; absence of the field is treated as `False`.
- [x] `_user_payload()` in `auth_routes.py` includes `must_change_password` — flows into both the login response and `/me` re-hydration so the frontend always has the current state
- [x] New `POST /api/auth/change-password` endpoint — requires authentication; verifies the current (temporary) password against the stored hash; validates new password is at least 8 characters and differs from the current one; updates the hash, clears `must_change_password`, audit-logs `user.change_password`
- [x] `ProtectedRoute` in `App.js` — if user is authenticated but `must_change_password` is `true`, redirects to `/change-password` before rendering any page; prevents navigation away until the password is set
- [x] New `ChangePassword.js` view at `/change-password` — styled like Login; fields: current password, new password, confirm; client-side validation (match + min length); on success clears the flag in `AuthContext` and redirects to the dashboard

**Design decision — no email dependency:** This flow works without Phase 2 (Email Engine). The admin tells the person their temp credentials verbally or via a secure channel; the system enforces rotation on first use. When Phase 2 lands, welcome emails with username-only (no password) can be layered on top — the forced-reset gate stays in place regardless.

### Definition of Done
- [x] Cannot log in as admin with `admin123` on any deployed environment _(legacy account auto-deactivated on startup)_
- [ ] Browser console shows no CORS errors from the correct domain _(deferred with 1.2)_
- [x] Login attempt #6 returns 429 within the 15-minute window
- [ ] Admin without 2FA configured is prompted on login _(deferred with 1.5)_
- [x] Application startup fails immediately if JWT secret is default value
- [x] A newly created user account is intercepted at first login and cannot access the portal until they set a new password
- [x] Admin-initiated password reset re-triggers the same forced-change gate

### Notes
> **Sub-deploy 2 (2026-06-23):** 1.7 Forced Password Reset. `must_change_password: True` is now set on `POST /api/users/` and `POST /api/users/{id}/reset-password`. `_user_payload()` exposes the flag in every login/me response. New `POST /api/auth/change-password` verifies the current password (bcrypt), validates min-8-char and differs-from-current rules, updates the hash, and clears the flag — audit-logged as `user.change_password`. Frontend: `ProtectedRoute` now redirects authenticated users with `must_change_password` to `/change-password` before any other page renders; a new `AuthRequired` wrapper used by that specific route lets you be authenticated without triggering the redirect loop; new `ChangePassword.js` view handles the form. Existing accounts are unaffected — the field's absence is treated as `False` everywhere.

> **Sub-deploy 1 (2026-06-19):** Implemented the four items with no domain/SSL dependency. Backend: startup `RuntimeError` if `JWT_SECRET` is still the placeholder; new `backend/rate_limit.py` holds a shared `slowapi.Limiter` (avoids a circular import between `server.py` and the route modules) wired into `/api/auth/login` (5/15min) and `/api/healthcare/onboarding` (10/hour); startup migration deactivates any `{username: "admin", role: "admin"}` account found, matching the exact legacy seed from commit `5965ef4`. Created `backend/.env.example` (didn't exist before). 1.2 (CORS) and 1.5 (2FA) explicitly deferred — see notes above — to avoid blocking domain-dependent and testing-friction work; tracked here so they aren't forgotten before go-live.

---

## Phase 2 — Email Engine

**Goal:** Every significant business event sends the correct email to the right recipient.  
**Estimate:** 2–4 days  
**Status:** 🟢 Complete  
**Completed:** Sub-deploy 1 (email service + all templates + full route wiring) — 2026-06-23  

### Context
Resend is already integrated (`resend` in `requirements.txt`, `RESEND_API_KEY` in config). The healthcare registration form already sends emails correctly. This phase wires the same pattern to all remaining business events.

### Tasks

#### 2.1 Shared Email Service
- [x] Create `backend/services/email_service.py`
- [x] Implement `send_email(to, subject, html, bcc=None)` base function
- [x] Guard on missing/placeholder API key (log clearly, do not silently swallow)
- [x] Include Bassani Health branded HTML wrapper (header, footer, colours) reused across all templates
- [x] Add `SUPPORT_EMAIL` to config for reply-to on all outbound emails

#### 2.2 Order Emails
- [x] **Order placed** → Reseller receives confirmation with order reference, customer name, line items, and total
- [x] **Order confirmed** → Reseller receives confirmation that order is now a Sale Order in Odoo; Customer receives notification that their order has been processed
- [x] **Order cancelled** → Reseller receives cancellation notice with order reference; Customer receives notification

#### 2.3 Customer Onboarding Emails
- [x] **Application submitted** → Admin team receives alert with customer name, reseller name, and link to applications page
- [x] **Application approved** → Reseller receives notification that customer is active; Customer receives welcome email with practice name and support contact
- [x] **Application rejected** → Reseller receives notification with rejection reason

#### 2.4 Commission Emails
- [x] **Statement generated** → Reseller receives monthly summary: month label, total turnover, tier, rate, projected commission amount
- [x] **Statement marked as paid** → Reseller receives payment confirmation: amount paid, payment reference, payment date, and banking details used

#### 2.5 Packing Floor Notifications
- [x] **Order ready for collection** → All active `warehouse_supervisor` accounts with an email address on file receive a notification: order ID, customer name, packer name, unit count
- [x] Packers do **not** receive email notifications — they see assignments in real time on `packer.html`
- [x] If no supervisor has an email address, skip silently (log a warning — do not crash)

#### 2.6 Account Emails
- [x] **New user account created** → User receives welcome email with username, temporary password (or reset link), and login URL

#### 2.7 Resend Configuration
- [x] Verify `RESEND_API_KEY` is set in Railway production environment
- [ ] Verify sending domain is verified in Resend dashboard — **pending: awaiting client Resend credentials**
- [x] Confirm free tier limit (3,000/month, 100/day) is sufficient for current volume; upgrade to Pro ($20/month) if needed

### Definition of Done
- [x] Place a test order → reseller receives confirmation email within 60 seconds
- [x] Admin confirms order → reseller and customer both receive emails
- [x] Approve a customer onboarding → reseller and customer both receive emails
- [x] Generate a commission statement → reseller receives summary email
- [x] Mark statement as paid → reseller receives payment confirmation
- [x] Create a new user → user receives welcome email
- [x] Packer ticks last item on an order → supervisor(s) with email on file receive a "ready for collection" notification
- [ ] All emails render correctly on mobile and desktop clients — **verify once Resend domain confirmed**
- [x] No email sending blocks or slows the API response (all fire via BackgroundTasks)

### Notes
> **2026-06-23:** All templates and route wiring complete. Dev account uses nick@rubixdevelopment.co.za Resend key — swap to client's key when credentials are available and verify the bassanihealth.com sending domain in the Resend dashboard. Graceful degradation is in place: if `RESEND_API_KEY` is unset, emails log a mock message and skip without crashing.

---

## Phase 3 — Core Odoo Integration

**Goal:** Orders are commercially and fiscally correct, and are fulfilled from the correct physical stock location. All major Odoo sales workflows are supported.  
**Estimate:** 2–3 weeks  
**Status:** 🟡 In Progress — 3.1, 3.2 (code complete, 2 items need live verification), 3.3, 3.5, 3.6, 3.7, 3.8 complete; 3.4 deferred (pricelists not in use), email on 3.5 blocked on Phase 2/Resend  
**Completed:** Sub-deploy 1 (3.5 Order Cancellation) — 2026-06-19 · Sub-deploy 2 (3.1 Product Variants) — 2026-06-19 · Sub-deploy 3 (3.7 Multi-Warehouse) — 2026-06-19 · Sub-deploy 4 (audit/stock-set/switcher scoping) — 2026-06-19 · Sub-deploy 5 (3.8 follow-up) — 2026-06-19 · Sub-deploy 6 (3.3 Stock Availability) — 2026-06-19 · Sub-deploy 7 (3.2 Tax Configuration) — 2026-06-19 · Sub-deploy 8 (3.6 Credit Limit Enforcement) — 2026-06-19 · Sub-deploy 9 (product form field-parity: category-edit bug, UOM/Tax editing) — 2026-06-19  

### Tasks

#### 3.1 Product Variants
- [x] Switch product fetches from `product.template` to `product.product` (variants) — `list_products`, `get_product`, `low_stock_products` in `product_routes.py` now query `product.product` directly; each variant is its own catalog row with its own `qty_available`/`virtual_available`/price
- [x] Fetch and expose variant attributes (size, format, dosage) per product — added `display_name` (Odoo auto-appends the variant attribute differentiator in parentheses, e.g. "Tincture 20ml THC (30mg)") to `PRODUCT_FIELDS`; surfaced in both the Orders cart grid and admin Products table
- [x] Update order line creation to use `product_id` (variant ID), not template ID — `addToCart`/`cartItemFor` in `Views.js` now use `product.id` directly (already the variant id); the old `product_variant_ids?.[0] ?? product.id` fallback (silently picking variant #0, with no way to choose another) is removed since it's no longer needed
- [x] Update product list UI to show variant selector before adding to cart — **design decision:** rather than a dropdown picker nested inside one card, each variant now renders as its own separate catalog row/card (standard e-commerce pattern, much simpler than a nested selector). Confirmed with the business that existing multi-variant products in Odoo will now show as multiple catalog entries instead of one
- [x] Verify Odoo order lines reference correct variant `product.product` record — `order_routes.py` already expected a variant id on `OrderLine.product_id` (pre-existing); the catalog now actually supplies one for every product, including multi-variant ones (previously only true by accident for single-variant products)

> **Write-path design decision:** `create_product`/`update_product`/`archive_product` continue to operate on `product.template` under the hood — name, SKU, price, category, description, UOM, and tax are treated as shared across all of a product's variants (no per-variant attribute-editing UI exists or was requested). `update_product`/`archive_product` resolve the given variant id to its parent template before writing; `create_product` returns the new variant id (not the template id) so it's immediately usable by the stock-set and order-line endpoints.

> **Bug fixed 2026-06-19:** `ProductUpdate` never declared `categ_id`, so the edit form's Category dropdown was silently dropped on save (Pydantic v2 ignores undeclared fields rather than erroring) — looked like a working field in the UI but never wrote anything. Fixed by adding `categ_id` (and `uom_id`, `tax_id`) to `ProductUpdate`. Found while auditing full Odoo field parity on the product form per the new standing goal that this portal should expose ~all of Odoo's day-to-day product capability so admins rarely need to open Odoo directly.

#### 3.2 Tax Configuration
- [x] Remove hardcoded `15%` VAT from `order_routes.py` — turned out to be a dead constant (`VAT_RATE`, never referenced) plus a *display-only* `cartVat = cartSubtotal * 0.15` in the Orders cart preview; deleted/replaced both. Order creation itself never sent a hardcoded rate to Odoo — see below.
- [x] Fetch `taxes_id` from `product.product` for each order line — added to `PRODUCT_FIELDS`; new `_attach_tax_rates()` helper resolves it to a real percentage (`tax_rate`) via a batched `account.tax` lookup, used by `list_products`/`get_product`. Cart now computes VAT per line from each product's real rate instead of a flat assumption.
- [x] Pass tax IDs on sale order lines to Odoo — **confirmed not needed, not a gap.** `sale.order.line.tax_id` is a stored *compute* field in Odoo (`@api.depends`, not just a UI onchange), so it's resolved automatically from the product's own tax/fiscal-position config the instant the line is created via RPC — identical to what the Odoo UI does. Explicitly setting it ourselves would risk overriding Odoo's own fiscal-position logic (e.g. customer-specific tax treatment) instead of trusting it.
- [ ] Verify invoice VAT calculation matches Odoo's computed tax — **needs live verification**, can't be confirmed without real data: open a posted invoice in both the portal and Odoo directly and confirm the VAT line matches.
- [ ] Test with a product that has a different tax rate to confirm dynamic behaviour — **needs live verification**: assign a zero-rated or different-percentage tax to one product in Odoo, then confirm the Orders cart shows the correct (non-15%) VAT for that line specifically.
- [x] Admin Products table now shows a **Tax** column (the resolved `tax_rate` per product, or "No tax set" if `taxes_id` is empty in Odoo) — lets an admin see exactly what's configured without opening Odoo, and was the direct answer to a live bug report (an R40 product showing R48 VAT — i.e. `tax_rate` resolving to 120%, meaning *something* in that product's Odoo "Customer Taxes" field is misconfigured/stacked; this column surfaces that immediately instead of requiring a trip into Odoo to spot it)
- [x] Admins can set/change a product's Customer Tax directly from the product create/edit form — no Odoo trip needed. New `GET /api/products/taxes` lists available `account.tax` (sale-use) records; `ProductCreate`/`ProductUpdate` write `taxes_id` as the proper Odoo m2m command (`[(6, 0, [tax_id])]`), single-select since this catalog only ever assigns one Customer Tax per product in practice

> **How Odoo actually models this (confirmed with the business 2026-06-19):** `taxes_id` ("Customer Taxes") lives on the product **template**, not the variant — same as name/price/category/description, so every variant of a product shares one tax configuration; there's no native per-variant tax override in Odoo. There's a second layer — **Fiscal Positions** on `res.partner`, which can remap a customer's taxes (e.g. tax-exempt, export, different jurisdiction) — but **confirmed not in use** for this business, so the cart's tax preview (product-level only, no fiscal-position resolution) is accurate as-is. Revisit only if fiscal positions come into use later.

#### 3.3 Stock Availability
- [x] Fetch `virtual_available` from `product.product` before order submission — `create_order()` re-checks stock server-side, scoped to the resolved warehouse, right before creating the Odoo order
- [x] Block order if any line item quantity exceeds available stock — rejects with 400 and a clear per-product message (e.g. "Tincture 20ml THC (requested 10, only 3 available)") rather than a generic error; this is the authoritative check — it catches direct API calls and stock that changed after the cart was loaded, not just UI bypass
- [x] Display available stock count next to each product in the order UI — already existed in the cart grid before this phase (`{virtual_available} available` badge)
- [x] Handle zero-stock products gracefully (disable "Add to Cart", show "Out of Stock") — already existed in the cart grid before this phase

#### 3.4 Pricelist Support
- [ ] Fetch customer's assigned `property_product_pricelist` from `res.partner`
- [ ] Pass `pricelist_id` on `sale.order` creation
- [ ] Derive unit price from pricelist before displaying in cart (call `product.pricelist` compute)
- [ ] Display "customer price" vs "list price" difference in cart if applicable

#### 3.5 Order Cancellation
- [x] Implement `PUT /api/orders/{id}/cancel` endpoint _(already existed prior to Phase 3 — implemented as PUT, not POST)_
- [x] Call `sale.order.action_cancel` in Odoo
- [x] Update MongoDB `order_commissions` record `payout_status` to `cancelled` on cancel
- [x] Only allow cancellation of orders in `draft` or `sent` state (not confirmed `sale`) — backend now reads the order's Odoo state and returns 400 if not draft/sent; both the Orders list view and `OrderView.js` detail panel now hide the Cancel button for confirmed orders too (previously showed for `sale` state as well — a real behaviour change, confirmed orders can no longer be cancelled from the portal)
- [x] Show Cancel button in portal UI for eligible orders _(button already existed but had no state restriction — fixed alongside the above)_
- [ ] Trigger cancellation email — deferred to Phase 2 (blocked on Resend credentials)

#### 3.4 Pricelist Support
> **Deferred (2026-06-19):** Confirmed with the business that customer/reseller pricelists aren't actively used in Odoo today — everyone effectively pays list price. Building this now would be effort spent on something invisible. Revisit if/when pricelists come into use.

#### 3.6 Credit Limit Enforcement
- [x] Fetch `credit_limit` and `credit` from `res.partner` in Odoo — new `backend/credit.py::credit_status()` is the single shared check, used by order creation, order confirmation, and the customer list/profile (`credit_hold` flag)
- [x] If customer is over limit: **two-stage behaviour, not a single check.** At order creation (still just a quotation) it's non-blocking — the response includes a `credit_warning` and the cart shows a toast naming the shortfall, but the order is still created. At confirm time (the point where it actually commits to an invoice) it's a hard gate — `PUT /api/orders/{id}/confirm` returns 402 with the shortfall unless called with `?override_credit=true`; the frontend catches the 402 and prompts the admin to confirm the override via a dialog rather than just failing
- [x] Add `credit_hold` flag to customer display in portal — Customers list shows a red "Credit Hold" badge next to Credit Limit when over; `CustomerProfile.js` shows the same badge in the header chip row
- [x] Log credit limit checks to audit collection — **only the events that matter**, not every routine check (consistent with how this app's audit trail is used elsewhere): `order.credit_warning` (created over limit), `order.credit_block` (confirm rejected), `order.credit_override` (admin confirmed anyway) — each captures credit/limit/shortfall in `detail`

#### 3.7 Multi-Warehouse / Vault Selection & Stock Accuracy
> **Status quo (confirmed from code):** The system is currently hardwired to a single location. `order_routes.py` `create_order()` sends no `warehouse_id` to `sale.order` — Odoo silently applies its default warehouse. `product_routes.py`, `forecast_routes.py`, and `report_routes.py` read `qty_available` / `virtual_available` directly with no warehouse context, so the portal shows a **company-wide total**, not stock at a specific vault. `return_routes.py` restocks returned items to a **hardcoded `location_id: 8`**. There is no warehouse selector anywhere in the UI and no `stock.warehouse` data is synced. `odoo_client.py`'s `OdooClient` methods don't support passing Odoo's `context` parameter at all — required foundation work before any warehouse-scoped read is possible. If a second warehouse/vault is brought online today, none of these numbers would be trustworthy.

**Design decisions (confirmed 2026-06-19):**
- Each **reseller** has an assigned default `warehouse_id` (set by admin on their profile) — their orders always draw from that vault automatically.
- Each **warehouse_supervisor/packer** account is tied to exactly one `warehouse_id` (same pattern as the existing packer `display_name` field) — no in-app switcher for packing floor staff.
- **Admin/super_admin** accounts get a persisted `active_warehouse_id` (stored on the user doc, not just localStorage) driving a top-nav selector — they're the only role that switches vaults.
- The 85" packing board display gets **one display token per warehouse** — each physical screen's saved URL already determines which vault's queue it shows, no extra param needed. Tokens are generated/rotated from the admin **Warehouses** page and stored in a new `warehouse_display_tokens` Mongo collection (not env vars), since warehouses are defined dynamically in Odoo, not at deploy time — replaces the old single static `PACKING_BOARD_DISPLAY_TOKEN` env var entirely.

- [x] `odoo_client.py` — add optional `context` kwarg to `OdooClient.search_read()`, `.read()`, `.search()`, and `.count()`, merged into the XML-RPC kwargs
- [x] Implement `GET /api/warehouses` — returns Odoo `stock.warehouse` records (`id`, `name`, `code`, `lot_stock_id`)
- [x] Add `warehouse_id` to reseller schema (`ResellerCreate`/`ResellerUpdate`) + dropdown on the Resellers create/edit form
- [x] Add `warehouse_id` to the user schema for `warehouse_supervisor`/`packer` roles + dropdown on the Users create/edit form (shown only for those roles)
- [x] Add `active_warehouse_id` to admin/super_admin users + a small endpoint to set it + a warehouse selector dropdown in the admin top nav
- [x] Pass `context={"warehouse": <id>}` on every `qty_available` / `virtual_available` read (`product_routes.py`, `forecast_routes.py`, `report_routes.py`, low-stock checks) — resolved via a new `warehouse_context.py::resolve_warehouse_id()` shared by every route (reseller's assigned warehouse, staff's fixed warehouse, or admin's `active_warehouse_id`)
- [x] Set `warehouse_id` on `sale.order` creation from the resolved warehouse — this is what determines which location's stock is reserved and decremented when the order is confirmed
- [x] Wire `/api/stock/levels` and `/api/stock/locations` to default-filter by the selected warehouse's `lot_stock_id`
- [x] Replace the hardcoded `location_id: 8` in `return_routes.py` — resolves the restock location from the original sale order's `warehouse_id` → `lot_stock_id`, with graceful fallback to the previous default if resolution fails
- [x] Tag packing board entries with `warehouse_id` at queue time; replaced `PACKING_BOARD_DISPLAY_TOKEN` with Mongo-stored per-warehouse tokens (admin-managed via the new Warehouses page); `BoardManager` and all three WebSocket endpoints (screen/supervisor/packer) now filter connections and broadcasts by `warehouse_id`
- [x] Low-stock alerts and reports (`dashboard_stats`, `dead_stock`) are computed per-warehouse, not company-wide

#### 3.8 Stock Reservation Visibility
> **Why this exists:** Discovered during 3.7 live testing — an admin saw a product with 150 on hand but 0 forecasted and assumed something was broken. It wasn't: `virtual_available = on_hand + incoming - outgoing`, so 0 forecasted means ~150 units are reserved against open (confirmed but undelivered) orders. The business's stated goal for this whole portal is to help admins who aren't fluent in Odoo understand what their Odoo configuration is actually telling them — so instead of just explaining this once, the portal should surface it directly wherever the confusion happens.

- [x] `GET /api/products/{product_id}/reservations` — `sale.order.line` rows for this product where the order is confirmed (`state in [sale, done]`) and not fully delivered (`qty_delivered < product_uom_qty`), scoped to the resolved warehouse when one is selected (company-wide on "All warehouses", consistent with every other read in 3.7) — returns order ref, customer name, date, and quantity reserved per order
- [x] Products table: a small icon next to the Forecasted column, shown only when Forecasted is meaningfully below On Hand — opens a modal listing the reservations from the endpoint above
- [x] Scoped to sale-order reservations only (not generic `stock.move`/warehouse-transfer visibility) — deliberately kept narrow to avoid turning this into a full stock-ledger feature; revisit only if transfers turn out to be a real source of confusion too
- [x] Reservations list is clickable — opens the full `OrderView` detail (read-only) so the admin doesn't have to leave the Products page and go hunt for the order manually
- [x] Each reservation row shows the warehouse the order actually belongs to (`sale.order.warehouse_id` is a standard Odoo field that's normally always set, defaulted from the salesperson/company default — confirmed live, not assumed); orders with a genuinely unset `warehouse_id` are still included rather than hidden, flagged "no warehouse recorded" instead of silently disappearing

### Definition of Done
- [x] An order placed with a variant product creates the correct `product.product` line in Odoo (not template)
- [ ] VAT on invoice matches Odoo's tax configuration, not a hardcoded value
- [x] Attempting to order more units than are in stock returns a clear error before hitting Odoo
- [ ] A customer with a pricelist sees their negotiated price in the cart
- [x] A draft order can be cancelled via the portal and disappears from the active order list
- [x] An order for a customer over their credit limit is blocked or escalated (two-stage: non-blocking warning at quote, hard 402 block at confirm with override prompt)
- [x] Switching the warehouse selector changes displayed stock counts to that location's figures only (verified against Odoo `stock.quant`)
- [x] An order placed under "Warehouse A" decrements Warehouse A's stock in Odoo, not Warehouse B's
- [x] A "restock" return is credited to the correct warehouse's location — zero hardcoded location IDs remain in the codebase
- [x] The packing board for Warehouse B does not show orders fulfilled from Warehouse A

### Notes
> **Sub-deploy 1 (2026-06-19):** Order cancellation (3.5). The endpoint, Odoo call, and commission-voiding logic already existed before this phase — only a state guard and UI restriction were missing. Backend now reads the order's live Odoo `state` and rejects with 400 if it isn't `draft`/`sent`. **Behaviour change:** both `Views.js` (list view) and `OrderView.js` (detail panel) previously showed the Cancel button for confirmed (`sale`) orders too — that's now restricted to draft/sent only, matching the backend guard. Cancellation email intentionally not wired — deferred to Phase 2 once Resend credentials are available.

> **Sub-deploy 2 (2026-06-19):** Product variants (3.1). Discovered the cart already silently resolved to `product_variant_ids[0]` before this phase — single-variant products were already ordering correctly. The real gap was multi-variant products: no way to choose a non-default variant, and the admin catalog / low-stock view / stock-adjustment screen all operated at template level, hiding per-variant stock and price differences. `product_routes.py` now reads/writes `product.product` for everything user-facing; `lst_price` (variant-level computed price) is normalised back to a `list_price` key in the API response so the frontend needed zero field-name changes. Confirmed with the business that multi-variant products already exist in the live Odoo catalog — they will now appear as separate rows (one per variant) in both the Orders cart and the admin Products table, each with independent stock/price, instead of one row hiding the variant split. No changes made to `forecast_routes.py`/`report_routes.py`/`stock_routes.py` — those stay company-wide/template-level until Phase 3.7 (multi-warehouse) addresses them together.

> **Sub-deploy 3 (2026-06-19):** Multi-warehouse (3.7), full build. New `warehouse_context.py::resolve_warehouse_id()` is the single place every route resolves "which vault does this request care about" — fixed `warehouse_id` for reseller/staff, persisted `active_warehouse_id` for admin/super_admin. Threaded through `product_routes.py`, `forecast_routes.py`, `report_routes.py`, `stock_routes.py`, and `order_routes.py::create_order()`. **Breaking change for the packing-floor screens:** `PACKING_BOARD_DISPLAY_TOKEN` is gone — each warehouse now needs its own token, generated from the new admin **Warehouses** page (`/warehouses`, requires `warehouse.supervise` permission), and every physical screen's saved URL must be updated to the new per-warehouse token before its first reconnect after this deploy. The admin top nav now shows a warehouse selector (visible once at least one `stock.warehouse` exists in Odoo); leaving it on "All warehouses" preserves the old company-wide behaviour everywhere except order creation and the packing board, which always need a definite warehouse to function correctly. **Not yet live-tested** — needs verification against real `stock.quant` figures with at least two warehouses configured in Odoo before being considered fully proven in production.

> **Sub-deploy 4 (2026-06-19):** Product audit coverage + stock-set warehouse guard + warehouse-switcher page scoping + stock reservation visibility (3.8). Found during 3.7 live testing that product create/update/archive/stock-set had **zero audit logging** — fixed, with `product.stock_set` capturing `before`/`after` qty plus `warehouse_id`/`warehouse_name`. `set_stock_level()` now requires a specific warehouse selected (was silently guessing "the first Stock location it found" — same class of bug as the `return_routes.py` hardcoded location fixed in 3.7); frontend disables the stock field with an inline warning instead of failing at submit. Top-nav warehouse switcher (`TopBar`'s `showWarehouseSwitcher` prop) is now scoped to Products, Orders, Dashboard, and Reports only — the only pages it affects — instead of every admin page. New 3.8 reservations drill-down explains the most common point of confusion found during testing: On Hand vs Forecasted stock. Business goal driving this: the portal exists to help admins who aren't fluent in Odoo understand what their own Odoo configuration is telling them, so this kind of "explain the number, don't just show it" feature should be the default instinct going forward, not a one-off.

> **Sub-deploy 5 (2026-06-19):** 3.8 follow-up, found during live testing — scoping reservations strictly to `order_id.warehouse_id = warehouse_id` showed "no orders found" for a newly selected warehouse, which initially looked like a data gap. Investigated with the business and confirmed it's correct behaviour, not a bug: `warehouse_id` is a standard Odoo field that's always defaulted on order creation, so pre-existing orders are correctly tagged to the warehouse that existed when they were placed — a brand-new second warehouse legitimately has zero order history until orders start being placed against it. Domain still defensively includes orders with a genuinely unset `warehouse_id` (rather than hiding them) for the rare case Odoo's default didn't apply, but the UI now shows each reservation's actual warehouse name rather than implying uncertainty that wasn't there. Also made each reservation row clickable, opening the existing `OrderView` overlay read-only (no `isAdmin` prop passed, so confirm/cancel don't render) so the admin can inspect the order without leaving the Products page.

> **Sub-deploy 6 (2026-06-19):** Stock availability (3.3). `create_order()` now re-checks `virtual_available` for every line server-side, scoped to the resolved warehouse, immediately before creating the Odoo order — rejects with a clear per-product message ("X (requested 10, only 3 available)") if any line exceeds what's available to promise. This is the authoritative gate; the cart UI already disabled "Add to Order" for out-of-stock items and showed a stock count badge before this phase, but that's bypassable via direct API calls or simply by stock changing between page load and submit. No frontend changes were needed — the existing cart UX already covered the "display stock"/"handle zero-stock" half of this task.

> **Sub-deploy 7 (2026-06-19):** Tax configuration (3.2). Investigated before writing anything — the "hardcoded 15% VAT" turned out to be two separate things, not one bug: a dead `VAT_RATE` constant in `order_routes.py` (never referenced anywhere) and a *display-only* `cartSubtotal * 0.15` in the Orders cart preview. Order creation itself was already correct — Odoo's `sale.order.line.tax_id` is a stored compute field that resolves automatically from the product's own tax config on RPC `create()`, the same as the Odoo UI, so no authoritative code needed to change. The real fix: `product_routes.py` now fetches `taxes_id` and resolves it to a real `tax_rate` percentage per product (new `_attach_tax_rates()` helper, batched `account.tax` lookup); the cart computes VAT per line from that instead of a flat 15%, so a zero-rated or differently-taxed product shows the correct number *before* the order is even submitted. **Two checklist items still need you to verify against live Odoo data** — they can't be confirmed without it: (1) that a posted invoice's VAT in the portal matches Odoo's own figure, (2) that a product with a non-15% tax actually shows that rate in the cart, not 15%.

> **Sub-deploy 8 (2026-06-19):** Credit limit enforcement (3.6). Confirmed with the business first that pricelists (3.4) aren't in use, so that item is deferred rather than built speculatively — moved straight to this instead. New `backend/credit.py::credit_status()` is the single shared check (mirrors the `warehouse_context.py` pattern from 3.7) used in three places: order creation (non-blocking warning — an order is just a quotation), order confirmation (hard 402 block unless `?override_credit=true`), and the customer list/profile (`credit_hold` badge, computed from Odoo's real `credit`/`credit_limit` fields rather than the customer profile's pre-existing invoice-residual estimate, which is still shown separately for collections detail). Frontend catches the 402 on confirm and prompts the admin with the exact shortfall before retrying with the override — not just a dead-end error. Audit logging deliberately covers only the three events that carry information (`order.credit_warning`, `order.credit_block`, `order.credit_override`) rather than every routine check, consistent with how the rest of this app's audit trail is used.

> **Sub-deploy 9 (2026-06-19):** Product form field-parity pass, triggered by the user asking "are we showing all fields aligned with Odoo?" while investigating the VAT bug above. Audit found: Category was shown in the edit form but silently dropped on save (`ProductUpdate` never declared `categ_id` — Pydantic v2 ignores undeclared fields instead of erroring); UOM was settable at create but had no edit path or UI control at all; Tax had no edit capability anywhere. Fixed all three together: `ProductUpdate`/`ProductCreate` now declare `categ_id`, `uom_id`, `tax_id`; new `GET /api/products/uoms` and `GET /api/products/taxes` lookup endpoints feed two new dropdowns on the product form; `taxes_id` is written to Odoo using the explicit m2m replace command (`[(6, 0, [id])]`) for version-safety. This is the first deploy under the newly-stated standing goal (below) that the portal should expose Odoo's day-to-day product/order capability directly, not just read it.

---

## Phase 4 — Commission Engine Hardening

**Goal:** Commission calculations are auditable, tamper-resistant, and financially accurate.  
**Estimate:** 2–4 days  
**Status:** 🟢 Complete  
**Completed:** All 5 items complete — 2026-06-23  

### Tasks

#### 4.1 Race Condition Prevention
- [x] Create unique compound index on `monthly_commission_statements`: `{reseller_id: 1, year: 1, month: 1}` with `unique: True`
- [x] Test: two simultaneous Generate calls for same month — second must fail gracefully, not create duplicate

#### 4.2 Cancelled Order Exclusion
- [x] Before generating a statement, cross-reference `order_commissions` against Odoo order states
- [x] Exclude any order where Odoo `sale.order.state == "cancel"` from turnover aggregation
- [x] Mark excluded `order_commissions` records as `payout_status: "cancelled"`
- [x] Document this logic clearly: commission is earned on confirmed and fulfilled orders only

#### 4.3 Tier Rate Audit Trail
> **Already satisfied by Phase 0.6** (2026-06-19) — `PUT /api/commission/tiers` and `DELETE /api/commission/tiers/reset` write `commission.configure_tiers` / `commission.reset_tiers` audit entries with actor, before, and after. Visible today via the Audit Trail page (`/audit`). Remaining task below is the only open item.
- [x] Display tier change history inline in the admin Tier Settings tab — added `GET /api/commission/tiers/history` endpoint and "Rate Change History" section in the Tier Settings tab

#### 4.4 Odoo Vendor Bill — Make Non-Optional
- [x] Change `mark-paid` endpoint: if Odoo bill creation fails, return `400` error — do not silently continue
- [x] Admin must resolve the Odoo issue before marking paid, OR explicitly acknowledge with an override flag
- [x] Add `override_bill_creation: bool` flag to payload for edge cases (manual Odoo bill already exists)
- [x] If override used, store reason in statement record and audit log

#### 4.5 Dispute Workflow
- [x] Implement `POST /api/commission/statements/{id}/dispute` — reseller submits free-text reason
- [x] Statement status transitions to `disputed`
- [x] Admin sees disputed statements flagged in Statements tab (red badge + Disputed filter chip + Resolve button)
- [x] Admin can resolve (`PUT /api/commission/statements/{id}/resolve`) with notes
- [x] Reseller receives email notification on resolution (`send_dispute_resolved` template wired)

### Definition of Done
- [x] Two simultaneous Generate requests for the same reseller/month produce one statement, not two
- [x] A cancelled order does not appear in a reseller's monthly turnover
- [x] Every tier rate change is visible in the audit log with before/after values
- [x] Mark Paid fails with a clear error if Odoo bill creation fails (no silent pass-through)
- [x] A reseller can flag a dispute and an admin can resolve it

### Notes
> **4.2 implementation:** The cancelled-order sync runs at the top of every `generate_statements` call. It's non-fatal — if Odoo is unreachable, generation proceeds with current data and the voided count is 0. The number of voided records is surfaced in the API response and audit log.  
> **4.4 override:** The override checkbox is available in the Mark Paid modal with a required reason field. Override reason is stored on the statement document and in the audit log detail.  
> **4.5 dispute email:** Uses `send_dispute_resolved` template in `email_service.py`, fires in a BackgroundTask after the resolve endpoint is called.

---

## Phase 5 — Reliability & Resilience

**Goal:** Odoo downtime causes graceful degradation, not full portal failure. Duplicate operations are impossible.  
**Estimate:** 3–5 days  
**Status:** 🔴 Not Started  
**Completed:** —  

### Infrastructure Addition
- [ ] Add Redis to Railway ($5–$10/month) — used for product cache and circuit breaker state

### Tasks

#### 5.1 Circuit Breaker on Odoo
- [ ] Add `pybreaker` to `requirements.txt`
- [ ] Wrap all Odoo XML-RPC calls in `odoo_client.py` with a circuit breaker
- [ ] Configuration: open after 3 consecutive failures; half-open retry after 30 seconds
- [ ] When circuit is open: product list serves from Redis cache; order placement returns a maintenance message
- [ ] Expose circuit breaker state in `/health` endpoint

#### 5.2 Redis Product Cache
- [ ] Add `redis` (or `aioredis`) to `requirements.txt`
- [ ] On product list request: check Redis first (TTL 15 minutes)
- [ ] On cache miss: fetch from Odoo, store in Redis, return result
- [ ] Add `POST /api/products/sync` admin endpoint to force cache invalidation
- [ ] Cache product categories separately (TTL 1 hour)
- [ ] Do NOT cache prices if pricelists are customer-specific (fetch live per order)

#### 5.3 Idempotency Keys
- [ ] Accept `X-Idempotency-Key` header on `POST /api/orders/`
- [ ] Store key in MongoDB `idempotency_keys` collection with TTL index (24 hours)
- [ ] If same key received again within TTL: return original response without calling Odoo
- [ ] Document the header requirement for any future API clients

#### 5.4 Two-Phase Commit Compensation
- [ ] After successful Odoo order creation, if MongoDB `order_commissions` insert fails:
  - Write to `failed_commission_records` collection with Odoo order ID and error
  - Log error to Sentry (Phase 6 dependency — log to console as fallback)
  - Admin sees failed records in a recovery view (or MongoDB query for now)
- [ ] Add admin endpoint `POST /api/commission/recover/{odoo_order_id}` to manually insert missing record

### Definition of Done
- [ ] With Odoo intentionally offline: product list still loads from cache
- [ ] With Odoo intentionally offline: placing an order shows a clear maintenance message, not a 500 error
- [ ] Sending the same `X-Idempotency-Key` twice returns the same response without creating a duplicate order in Odoo
- [ ] If MongoDB is briefly unavailable after an Odoo order creation, the failure is recorded (not silently lost)

### Notes
> _(Add implementation notes, decisions, or issues encountered here)_

---

## Phase 6 — Observability & Operations

**Goal:** Failures are detected and alerted before customers report them. Data is backed up and recoverable.  
**Estimate:** 2–3 days  
**Status:** 🟢 Complete  
**Completed:** Sub-deploy 1 (6.1–6.4) — 2026-06-23  

### Tasks

#### 6.1 Sentry Error Monitoring
- [x] Add `sentry-sdk[fastapi]` to `requirements.txt`
- [x] Initialise Sentry in `server.py` with `SENTRY_DSN` env var — graceful no-op if unset
- [x] Every unhandled exception captures user ID (from JWT), route, and request context automatically via FastAPI integration
- [ ] **Operational:** create free account at sentry.io, add `SENTRY_DSN` to Railway environment variables, set up email alert on first occurrence of new error

#### 6.2 Structured Logging
- [x] Created `backend/logging_config.py` — JSON formatter via `python-json-logger`, applied to root logger on startup
- [x] All `print()` calls in `server.py` replaced with structured `logger.info/warning` calls
- [x] HTTP request middleware: every request logs `request_id`, `method`, `path`, `status_code`, `duration_ms`, `user_id`
- [x] Odoo calls: every `execute_kw` logs `model`, `method`, `duration_ms`

#### 6.3 MongoDB Backups
- **Revised:** MongoDB is Railway's built-in plugin — no custom `mongodump` script needed
- [ ] **Operational:** open the Backup tab on the Railway MongoDB plugin and enable scheduled daily backups; confirm a backup appears the next day

#### 6.4 Health Endpoint Enhancement
- [x] `GET /health` now probes MongoDB (find_one) and Odoo (search_count on res.users)
- [x] Returns `{status: "healthy|degraded|down", version, timestamp, services: {mongo, odoo}}`
- [x] `degraded` (Odoo down, MongoDB up) returns HTTP 200 so Railway does not restart the container
- [x] `down` (MongoDB unreachable) returns HTTP 503

#### 6.5 Frontend to Cloudflare Pages
- **Deferred** — for ~30 users the CDN benefit is negligible; adds deployment complexity with no meaningful gain at current scale. Revisit if traffic grows significantly.

### Definition of Done
- [x] Every API request produces a JSON log line with `request_id` and `duration_ms`
- [x] `GET /health` returns `degraded` when Odoo is down but MongoDB is up
- [ ] Trigger a deliberate 500 error → Sentry captures it and sends email alert (requires `SENTRY_DSN` env var set)
- [ ] Backup file visible in Railway MongoDB Backup tab after first scheduled run

### Notes
> **2026-06-23:** 6.5 (Cloudflare Pages) dropped from this phase — not cost-effective at current scale. 6.3 is operational-only (Railway Backup tab). Sentry is wired and ready; only needs the `SENTRY_DSN` env var added to Railway once a free sentry.io account is created.

---

## Phase 7 — Missing Commercial Workflows

**Goal:** Full end-to-end commercial coverage. Resellers have complete visibility of the customer lifecycle.  
**Estimate:** 2–3 weeks  
**Status:** 🟡 Partial (7.4 deferred — needs Cloudflare R2)  
**Completed:** 2026-06-23  

### Tasks

#### 7.1 Delivery Order Visibility
- [x] Implement `GET /api/orders/{id}/deliveries` — fetches linked `stock.picking` records from Odoo
- [x] Expose: picking reference, scheduled date, state, carrier, tracking number
- [x] Show delivery status in order detail view (OrderView.js + SalesTickets.js ticket detail)
- [x] Handle partial deliveries: show multiple pickings per order

#### 7.2 Credit Notes
- [x] Extend invoice list to include `move_type = "out_refund"` (Credit Notes filter chip)
- [x] Display credit notes with distinct purple "CN" badge in invoice list
- [x] Implement `POST /api/invoices/{id}/request-credit-note` — any user submits reason
- [x] Credit note requests stored in MongoDB `credit_note_requests`; admin sees pending list
- [x] Admin acknowledges (marks processed in Odoo) via `PUT /credit-note-requests/{id}/acknowledge`

#### 7.3 Customer Account Statements
- [x] Implement `GET /api/customers/{id}/statement` — aggregates `account.move` (invoices + out_refunds) from Odoo
- [x] Returns: invoices/CNs table + summary (total_invoiced, total_credits, total_outstanding, net_balance)
- [x] Admin and reseller (ownership-checked) can view; date_from / date_to filter
- [x] Displayed as inline statement table in CustomerProfile.js with summary row

#### 7.4 KYC Document Collection (Customer Onboarding — Step 4)
- [ ] Add document upload capability to customer onboarding flow
- [ ] Required documents: practice licence (or registration certificate), HPCSA/BHF registration number, physical address confirmation
- [ ] Store documents in Cloudflare R2 (object storage) — reference URL in MongoDB `customer_onboarding` record
- [ ] Admin sees uploaded documents in the onboarding review panel
- [ ] Block onboarding approval if required documents are not uploaded

> **Deferred:** 7.4 requires Cloudflare R2 setup (object storage). No R2 bucket available yet — will revisit when infrastructure is provisioned.

#### 7.5 Backorder Visibility
- [x] Delivery endpoint (`/deliveries`) exposes `is_backorder` flag and `lines` with `qty_ordered` / `qty_done`
- [x] Display "X outstanding" per line item in delivery card (SalesTickets.js + OrderView.js)
- [x] "Backorders present" header badge appears when any picking is a backorder

> ~~7.6 Multi-Warehouse Foundation (Preparation Only)~~ — **moved to Phase 3.7** and elevated from a plumbing-only task to a full functional requirement (warehouse selector, per-warehouse stock figures, correct stock decrement on order, correct restock location). See Phase 3.

#### 7.6 Stock Movement Audit Trail (Product History)
> **Added 2026-06-24** — requested by the business after a meeting reviewing Odoo's traceability screen. The portal now surfaces the same data in a more readable, labelled form.

- [x] `GET /api/products/{product_id}/movements` — queries `stock.move` in `done` state, newest-first; optional `from_date`/`to_date` filters; default limit 100, max 500
- [x] Batch-fetches `stock.location` records for every from/to location referenced — resolves `complete_name` and `usage` for each
- [x] Move type classification from location `usage` pairs: `receipt` (supplier → internal), `delivery` (internal → customer), `return` (customer → internal), `vendor_return` (internal → supplier), `adjustment_in`/`adjustment_out` (inventory virtual location), `transfer` (internal → internal — covers both same-warehouse and inter-warehouse moves), `consumed`/`produced` (production location), `other`
- [x] Inter-warehouse transfers included automatically — they appear as `transfer` type moves with full from/to location names (e.g. "Vault A / Stock → Vault B / Stock"), distinguishable from same-warehouse moves by the location name difference
- [x] Frontend: small `History` icon button in the On Hand column of the Products table — opens a modal (consistent with the existing Reservations drill-down)
- [x] Modal: optional date-from / date-to filter with a "Filter" button that re-fetches; colour-coded move type badge per row; ± qty with sign colouring (red for outbound, green for inbound); `from → to` location path + formatted date below each row

### Definition of Done
- [x] An order with a dispatched delivery shows the tracking reference and carrier name in the portal
- [x] An out_refund invoice is visible in the reseller's invoice list with a "Credit Note" badge
- [x] A customer's account statement shows their balance, all invoices, and all payments
- [ ] Customer onboarding cannot be approved without at least one document uploaded *(7.4 — deferred)*
- [x] Backorder quantities are visible on the order detail page when Odoo has a backorder picking
- [x] Clicking the history icon on any product shows its complete stock movement trail — receipts, deliveries, transfers, and adjustments — with move type labels and ± quantities

### Notes
- 7.1 + 7.5 were implemented together — delivery endpoint returns both regular and backorder pickings with per-line fulfilment. UI surfaces in both OrderView.js (reseller order detail) and SalesTickets.js (staff ticket detail).
- 7.2 credit note requests are tracked in MongoDB (not Odoo) since Odoo credit note creation is a finance-team action; portal tracks the request lifecycle (pending → acknowledged).
- 7.4 blocked on R2 — no object storage provisioned yet. All other items complete.
- 7.6 added after business meeting 2026-06-24 — they recognised the value of Odoo's traceability screen and wanted it surfaced in the portal. Inter-warehouse transfers are covered automatically via the location `usage=internal` classification.

---

## Phase 8 — Order Workflow & Ticketing System

**Goal:** Cross-team handoff from Sales → Orders → QA/RP → Finance is tracked end-to-end in the portal, with each team seeing only what's relevant to them and automatic handoff notifications — replacing reliance on ad-hoc email/verbal handoffs for order fulfilment status. This is the core reason the business wanted this portal built.  
**Estimate:** 2–3 weeks  
**Status:** 🟡 In Progress — 8.1–8.11 code complete; DoD 7/8 items done; one remaining item is operational (create 6 named staff accounts via Users page — no code required)  
**Completed:** Sub-deploy 1 (8.1 Roles & Permissions) — 2026-06-19 · Sub-deploy 2 (8.2–8.4 backend) — 2026-06-19 · Sub-deploy 3 (8.5 UI) — 2026-06-19 · Sub-deploy 4 (unified pipeline) — 2026-06-19 · Sub-deploy 5 (8.6 Quote Builder + Deposit + 8.7 Quote Edit) — 2026-06-21 · Sub-deploy 6 (8.8 Orders Tickets full-page detail) — 2026-06-22 · Sub-deploy 7 (8.9 Stock accuracy + Orders pipeline enforcement) — 2026-06-23 · Sub-deploy 8 (8.10 Orders screen read-only + Confirm Order in Sales Ticket) — 2026-06-23 · Sub-deploy 9 (8.11 Send Quote to customer) — 2026-06-23  

### Context
Sourced from business process meeting minutes (2026-06-19). Two real-world mailboxes drive this: `sales@bassanihealth.com` (Merveille — customer-facing PO/RFQ intake and feedback) and `orders@bassanihealth.com` (Tshidi — fulfilment). A Sales ticket hands off to an Orders ticket once the customer confirms; the Orders ticket's outcome (complete / incomplete / cancelled) flows back to close out the Sales ticket.

**Design decisions (confirmed 2026-06-19):**
- **Portal-native tickets, not inbound email automation.** Staff keep using sales@/orders@ for external customer communication. The portal is the internal processing layer — tickets track every order, not email threads. Inbound email parsing is explicitly deferred.
- **Every portal order auto-creates a Sales ticket.** `POST /api/orders/` always inserts a ticket into the `tickets` collection after the Odoo order is created — best-effort and non-blocking. Whether the order comes from a reseller or internal Bassani staff, it enters the same pipeline. The ticket starts at `sale_order` stage (the placing party has already confirmed their intent, so `open`/`quote` are skipped). `assigned_to` is set to the creating user if they hold `tickets.sales` permission; otherwise left `null` for the sales team to claim.
- **Manual ticket creation (`POST /api/tickets`) is for direct customer inquiries only** — a customer emails a PO/RFQ before any portal order exists. Merveille creates the ticket at `open`, advances it to `quote` as she builds the Odoo quote, then to `sale_order` when the customer confirms. At that point the flow is identical to auto-created tickets.
- **Stage entry points:**
  - `open` / `quote` — pre-portal phases for direct inquiries
  - `sale_order` — a portal order exists; auto-created tickets start here
  - `invoice` → `confirmed_wip` → `ready_for_collection` → exit — same for all tickets
- **Sales ticket = new `tickets` MongoDB collection.** Nothing in the system currently models the full Open→Quote→Sale Order→Invoice→Payment→WIP→Ready/Incomplete→Complete/Cancelled lifecycle; Odoo's own `sale.order.state` is necessary but not sufficient — it has no concept of "Not Interested," "50% Payment Received," or "Ready for Collection."
- **Orders ticket = the existing `packing_board` document, extended — not a second collection.** The packing board already implements `queued → packing → ready → collected` with live WebSocket updates. Adding `cancelled`/`incomplete` statuses plus QA/RP approval fields is additive.
- **Finance's "50% Payment Received" confirmation reads Odoo's real invoice `payment_state`/`amount_residual`** — consistent with the Odoo-as-financial-source-of-truth principle. If Odoo shows no payment, the portal blocks confirmation.
- **New roles map 1:1 to named staff**: Merveille → `sales` (`tickets.sales`), Tshidi → `orders_clerk` (`tickets.orders`), Kashi & Ragini → `finance` (`tickets.finance_confirm`), Cullen Grant → `qa_manager` (`tickets.qa_approve`), Rookshanna Hussain → `responsible_pharmacist` (`tickets.rp_approve`).
- **`tickets.manage` permission** gates the manual "Override Stage" form on the ticket detail page. `super_admin` always has it; `admin` accounts can be granted it explicitly. No other role receives it. The ticket pipeline advances organically via clerk actions (building a quote, registering a deposit, etc.) — the override form exists only to correct mistakes or unblock edge cases. Clerks see the info and action cards but never the stage selector.
- Incomplete always requires a free-text reason. QA and RP approvals are independent.

### Tasks

#### 8.1 Roles & Permissions
- [x] Add `sales`, `orders_clerk`, `finance`, `qa_manager`, `responsible_pharmacist` to `ALL_ROLES` (`backend/auth.py`)
- [x] Add corresponding permission domains (`tickets.sales`, `tickets.orders`, `tickets.finance_confirm`, `tickets.qa_approve`, `tickets.rp_approve`) to the existing granular permission system — each new role gets exactly one fixed permission (the role IS the permission, no per-user customisation); `admin`-tier accounts can additionally be granted any of these domains for oversight, same as every other domain
- [ ] Create the 6 named staff accounts (Merveille, Tshidi, Kashi, Ragini, Cullen Grant, Rookshanna Hussain) — roles now exist in the Users admin page "Add User" dropdown; needs real usernames/initial passwords/emails decided with the business before creating, not invented

#### 8.2 Sales Ticket (`tickets` collection, `type: "sales"`)
- [x] New MongoDB collection `tickets` — schema: `type, source, customer_id, customer_name, order_id, invoice_id, orders_ticket_ref, status, exit_status, assigned_to, assigned_to_name, payment_confirmed_by, payment_confirmed_at, incomplete_reason, stage_history[], created_at, updated_at`
- [x] `source` field: `"portal"` (auto-created from `POST /api/orders/`) or `"direct"` (manually created via `POST /api/tickets` for mailbox inquiries)
- [x] `status` enum: `open → quote → sale_order → invoice → confirmed_wip → ready_for_collection → incomplete`
- [x] `exit_status` (side-exit, reachable from multiple stages): `not_interested | cancelled | complete`
- [x] `POST /api/tickets` (manual create for direct inquiries, `source: "direct"`), `PUT /api/tickets/{id}/stage` (transition + history append + optional `assigned_to`), `GET /api/tickets`, `GET /api/tickets/{id}`
- [x] `PUT /api/tickets/{id}/confirm-payment` (finance only) — reads Odoo `payment_state`/`amount_residual`; blocks if no payment recorded
- [x] Link ticket to Odoo `sale.order`/`account.move` as they're created — `order_id`/`invoice_id` attach via `PUT /stage`
- [x] `POST /api/orders/` auto-creates a `source: "portal"` Sales ticket at `sale_order` stage after the Odoo order is created (best-effort / non-blocking); `GET /api/tickets` returns unassigned tickets to `sales`-role users alongside their own queue; `PUT /api/tickets/{id}/stage` supports `assigned_to` for self-assignment from the queue

#### 8.3 Orders Ticket (extend `packing_board`)
- [x] Add `cancelled`, `incomplete`, `complete` to the packing board's `status` field; add `incomplete_reason`, `cancelled_at`, `incomplete_at`, `completed_at`
- [x] Add QA/RP approval fields: `qa_approved_by`, `qa_approved_at`, `rp_approved_by`, `rp_approved_at` — both required before a `ready` entry can be marked `complete`
- [x] New endpoints: `PUT /api/packing/qa-approve`, `PUT /api/packing/rp-approve`, `PUT /api/packing/complete`, `PUT /api/packing/incomplete`, `PUT /api/packing/cancel` (role-gated to `qa_manager`/`responsible_pharmacist`/`orders_clerk`/`orders_clerk`/`orders_clerk` respectively) — `complete` wasn't in the original task list but turned out to be necessary: it's the Orders Clerk's explicit final close-out action once both approvals exist, matching the business's "before they can state the order is complete" wording
- [x] No changes to existing `queued`/`packing`/`ready`/`collected` semantics or the WebSocket broadcast contract — purely additive. `GET /board` now also accepts `orders_clerk`/`qa_manager`/`responsible_pharmacist` (previously admin-only)

#### 8.4 Cross-Ticket Handoff & Notifications
- [x] When a Sales ticket's linked order is confirmed (`PUT /api/orders/{id}/confirm`), it auto-transitions to `confirmed_wip` and `orders_ticket_ref` is set — reuses the existing auto-queue-to-packing-board step already triggered there; matched by `order_id`, not a fixed final step
- [x] When the Orders ticket (packing board entry) reaches `complete`/`incomplete`/`cancelled`, the outcome writes back to the parent Sales ticket automatically (`_sync_sales_ticket()`) and notifies the assigned Sales rep — no manual polling required. Best-effort and silent if no Sales ticket exists for that order (e.g. legacy orders)
- [x] Extend the existing push notification service (`notification_service.py`) with new preference keys: `ticket_assigned`, `ticket_handoff` (default opt-in; backfilled onto existing subscriptions on startup)

#### 8.6 — Direct Inquiry Quote Builder + Deposit Registration

**Goal:** Close the remaining Odoo-only gaps in the direct inquiry flow so Merveille never needs to open Odoo. A direct inquiry ticket now spans its full lifecycle inside the portal: create ticket → build quote (draft Odoo order) → cancel if rejected / advance if accepted → finance registers deposit (creates down payment invoice + registers payment in Odoo) → admin confirms → packing pipeline. Portal orders (reseller/staff) already enter at `sale_order` and skip the quote phase — both flows converge at `sale_order` for the same downstream pipeline.

- [x] `POST /api/tickets/{id}/create-order` — builds a draft `sale.order` in Odoo from the ticket's customer + submitted line items; updates ticket `order_id` + advances status to `quote`. Customer is locked to the ticket's `customer_id`. Requires `tickets.sales`.
- [x] `POST /api/tickets/{id}/cancel-order` — cancels the linked draft Odoo order (`action_cancel`, only allowed on draft/sent state) and sets ticket `exit_status: "cancelled"`. Returns 400 if order is already confirmed — confirmed-order cancellation must go through Odoo. Requires `tickets.sales`.
- [x] `POST /api/tickets/{id}/register-deposit` — creates a fixed-amount down payment invoice via Odoo's `sale.advance.payment.inv` wizard, posts it, then registers payment via `account.payment.register`. Stamps `payment_confirmed_by/at` and links `invoice_id` on the ticket. Finance selects payment journal (fetched from `/api/tickets/payment-journals`). Requires `tickets.finance_confirm`.
- [x] `GET /api/tickets/payment-journals` — returns Odoo bank/cash type journals for the deposit modal dropdown.
- [x] `GET /api/orders/` enriched with `linked_ticket` — batch MongoDB lookup after Odoo fetch; each order row now carries `{id, status, exit_status}` of its linked Sales ticket so admin can see pipeline status from the Orders table.
- [x] Sales Ticket detail modal — **Build Quote** button (when no `order_id`) opens full-page document-style quote builder matching Odoo's quotation form: each line row fires a debounced live Odoo search (name + SKU, 300ms) so results are always current and catalogue size is never a constraint; qty stepper, editable description, unit price, per-product tax rate, running totals; warehouse selector; note; submits to `create-order` endpoint.
- [x] Sales Ticket detail modal — **Cancel Quote** button (when `order_id` set, status pre-`confirmed_wip`, not closed): confirm dialog → `cancel-order` endpoint.
- [x] Sales Ticket detail modal — **Register Deposit** button (finance role, when `order_id` set, no `invoice_id`, no `payment_confirmed_at`): modal with amount (pre-filled from order total / 2), ISO date (defaults today), payment journal dropdown; submits to `register-deposit` endpoint.
- [x] Orders table — **Linked Ticket** column: shows badge for ticket status (or "—" if no ticket linked); non-reseller only.

**Design decision — deposit is optional before confirm:** For resellers on credit terms, the admin can confirm the order without a deposit being registered first. For direct inquiry customers requiring a 50% deposit, finance registers it first and then the admin confirms. The portal does not enforce the deposit before confirm — that's a business-process decision, not a technical gate.

#### 8.7 — Quote Edit

**Goal:** Allow a sales clerk to revise an existing draft/sent quotation without cancelling and rebuilding it — a common B2B scenario where a customer comes back requesting line item changes before confirming.

- [x] `PUT /api/tickets/{id}/update-order` — replaces all lines on the linked Odoo `sale.order` atomically (unlink existing `sale.order.line` records, create new set). Only allowed on `draft`/`sent` state orders; returns 400 if already confirmed. Resolves company context from the order's `company_id` (same multi-company pattern as `create-order`). Appends a "Quote revised — N lines" entry to the ticket timeline and writes to the audit trail. Requires `tickets.sales`.
- [x] **Edit Quote** button on ticket detail page — shown when `detailOrder.state` is `draft` or `sent` (ground-truth Odoo state, not ticket status). Opens the quote builder pre-populated with current Odoo order lines. Warehouse field shows "Locked to existing order" (cannot change warehouse without cancelling the order).
- [x] Quote builder gains a `quoteMode` flag (`"create"` | `"edit"`). In edit mode: header shows "EDIT QUOTATION / Revising live draft in Odoo", submit button shows "Update Quote in Odoo →", warehouse selector is hidden. On save, calls `update-order` instead of `create-order`. On return, refreshes the detail page so the updated order document renders immediately.
- [x] Three-way paper trail: portal timeline entry, portal audit log (`ticket.update_order`), Odoo's native order chatter (line changes appear in Odoo automatically via XML-RPC write).

- [x] **Customer change in edit mode** — the "Bill To" field in the quote builder shows the live Odoo customer (from `detailOrder`, not the stale ticket field). A "Change customer" link opens an inline debounced search. If a different customer is selected, `update-order` calls `odoo.write("sale.order", [id], {"partner_id": new_id})` and syncs `customer_id` / `customer_name` on the ticket document. The backend only writes if the partner actually changed (compares against `partner_id` on the fetched order). Timeline entry notes the customer change (e.g. "Quote revised — 3 lines | Customer changed to Acme Ltd").

**Design decision — replace-all vs delta patch:** Unlinking all lines and recreating is simpler and produces the same end state. A delta patch (diff old vs new, only write changes) would be more Odoo-idiomatic but adds significant complexity for no user-facing benefit. Replace-all is the correct choice at this stage.

#### 8.5 UI
- [x] Sales Ticket view (`frontend/src/views/SalesTickets.js`, route `/tickets/sales`) — upgraded in 8.6/8.7 to a three-view full-page flow (list → detail → quote-builder); see 8.6 and 8.7 for full detail
- [x] Orders Ticket view (`frontend/src/views/OrdersTickets.js`, route `/tickets/orders`) — **new React view, not an extension of the existing packing board UI as originally planned.** Correction found during implementation: the existing packing board UI is the static `packing-board.html`/`supervisor.html`/`packer.html` pages under `frontend/public/`, built for the warehouse floor (display-token / role-JWT auth, not the React SPA) — there was no React-rendered board to extend. QA Manager/Responsible Pharmacist/Orders Clerk are React-portal (ticketing-role) accounts, so they needed a new SPA view hitting the same `/api/packing/*` REST endpoints instead. Upgraded to full-page detail in 8.8 — see below
- [x] Each named role sees only tickets relevant to their permission domain — both new Sidebar links (`Tickets` section) are gated by `permissions: [...]` (OR-matched against `can()`), a small generalisation of the existing single-`permission` nav filter; in-page action buttons are independently gated per action (e.g. an account with only `tickets.qa_approve` sees the QA approve button but not RP approve or complete/incomplete/cancel)

#### 8.8 — Orders Tickets Full-Page Detail (Strictly Linear Pipeline)

**Goal:** Match the full-page detail pattern introduced for Sales Tickets (8.6) on the Orders side, with strictly linear role-gated pipeline advancement so no stage can be skipped accidentally.

**Pipeline (strictly enforced — each step only shows for the right role at the right state):**
- `queued` → Orders Clerk: "Mark as Packing"
- `packing` → Orders Clerk: "Mark as Ready" or "Mark Incomplete" (with reason)
- `ready` → QA Manager: "QA Approve" (independently); RP: "RP Approve" (independently); Orders Clerk: "Mark Complete" (only once both approved) or "Mark Incomplete"
- `tickets.manage`: Override Stage dropdown (any status, audit-logged)

- [x] `GET /api/packing/entry/{order_id}` — single packing board entry lookup (board access required); used by the detail page to load and refresh without needing the full board list
- [x] `PUT /api/packing/mark-packing` — queued → packing (`tickets.orders` required; 400 if not queued)
- [x] `PUT /api/packing/mark-ready` — packing → ready (`tickets.orders` required; 400 if not packing)
- [x] `PUT /api/packing/override-status` — set any status directly (`tickets.manage` required); audit-logged with `from`/`to` values
- [x] `OrdersTickets.js` — full rewrite. Two-view flow: list | detail (no quote-builder needed — Orders tickets are fulfilment-only). Left panel shows the full order document: customer, PS/invoice/DN numbers, packer, items table with per-item tick status (from `item_ticks`), notes, and incomplete reason block. Right sidebar: status chip + key timestamps, QA/RP approval status cards, role-gated action cards (see pipeline above), Override Stage form for `tickets.manage`
- [x] `refreshDetail(order_id)` pattern — every action stays on the detail page and refreshes in place (same architecture as Sales Tickets `refreshDetail`); list silently updates in background
- [x] Incomplete reason modal overlays the detail page (same pattern as deposit modal in Sales Tickets)

**Design decision — strictly linear:** Packing → Ready → Complete cannot be skipped or reversed by the orders_clerk. The floor board (WebSocket packer app) and the portal orders clerk now share the same linear status model. Mark Incomplete is available at `packing` or `ready` (but not `queued`) since there is nothing yet to flag incomplete at queue time.

#### 8.9 — Stock Accuracy + Orders Screen Pipeline Enforcement

**Goal:** Ensure stock figures shown across the portal are consistent and correct, and remove the "place order directly" bypass that would let staff skip the Sales Ticket pipeline.

**Stock accuracy (virtual_available everywhere):**
- [x] Dashboard low-stock alerts — switched from `product.template` + `qty_available` to `product.product` + `virtual_available`; count and product list now reflect per-variant forecasted availability, not aggregated physical on-hand
- [x] Dead stock report (`/api/reports/dead-stock`) — same switch: `product.product` + `virtual_available`; also fixes a latent bug where `recently_sold_ids` from `sale.order.line` were `product.product` IDs being compared against `product.template` IDs (mismatch always produced false "never sold" classification)
- [x] `/api/products/low-stock` endpoint — switched domain filter from `qty_available < 10` to `virtual_available < 10` and updated returned field; now matches the catalogue's orange badge logic exactly (`virtual_available < 10` in `Views.js`)
- [x] `Dashboard.js` frontend — reads `p.virtual_available` from the updated response (was `p.qty_available`)

**Consistency rule applied:** All low-stock and dead-stock logic now uses `product.product` (per-variant, not aggregated) and `virtual_available` (forecasted = on-hand − reservations + incoming, not raw physical stock). This matches what the catalogue orange badge already used, eliminating the discrepancy where dashboard said "all healthy" while the catalogue showed orange numbers.

**Orders screen — pipeline enforcement:**
- [x] Direct order creation (the cart/product-browser view) removed from the Orders screen entirely — staff cannot build and place an order from this screen
- [x] Blue info banner on the Orders list explains the new flow: new orders must be created through Sales Tickets (Quote → Deposit → Confirm); the Orders screen is for monitoring and legacy adoption
- [x] New `POST /api/packing/adopt` endpoint — adopts an existing confirmed Odoo `sale.order` (state = `sale`) into the packing pipeline without going through the full Sales Ticket pre-confirmation steps; creates a packing board entry at `queued` using the same doc structure as the confirm flow (picking → items, invoice name, warehouse, commission); requires `tickets.manage`; returns 409 if already on board, 400 if order is not confirmed
- [x] `GET /api/orders/` list response enriched with `packing_status` — batch-fetched from `packing_board` so the Orders table knows which confirmed orders are already queued vs. still need adoption
- [x] New "Packing" column in the Orders table — shows packing board status badge (Queued/Packing/Ready/etc.) if the order is on the board; shows "Not queued" in italic for confirmed orders not yet in the pipeline; shows "—" for draft/done/cancel orders
- [x] "Queue for Packing" button in the actions column — appears only for confirmed (`sale`) orders with no packing board entry, gated by `tickets.manage`; calls `POST /api/packing/adopt` and refreshes the list

**Design decision — why orders are adopted directly to packing, not via a Sales Ticket:** Existing confirmed orders (`state = sale`) already skipped the pre-confirmation phase (deposit, approval, quote) — these steps happened outside the portal or directly in Odoo. Creating a Sales Ticket retroactively at the post-confirmation stage would be paperwork with no operational value. The correct entry point for these orders is the packing board (Orders Ticket) at `queued`. Going forward, all new orders must enter via Sales Tickets, which auto-queue to the packing board on confirmation — no adoption needed.

#### 8.10 — Orders Screen Read-Only + Confirm Order in Sales Ticket

**Goal:** Complete the pipeline enforcement started in 8.9. The Orders screen becomes fully read-only — no action on a draft order is possible from there. All order lifecycle actions (confirm, cancel) are consolidated into the Sales Ticket detail. Draft orders that pre-date the portal can be adopted into the pipeline via a "Create Sales Ticket" button.

**Orders screen — full read-only:**
- [x] Confirm and Cancel buttons removed from the Orders table actions column — no draft order can be actioned from this screen
- [x] Confirm and Cancel buttons removed from the `OrderView` full-page detail (`canConfirmOrder={false}` / `canCancelOrder={false}`) — the read-only view is now truly read-only
- [x] For draft orders without a linked Sales Ticket: "Create Sales Ticket" button appears (gated by `tickets.sales`) — calls `POST /api/tickets/from-order`
- [x] For draft orders with a linked Sales Ticket: existing "Sales Ticket" badge column shows the ticket status; no further action available here
- [x] Blue info banner updated to explain both adoption paths: draft orders → Create Sales Ticket; confirmed orders → Queue for Packing

**Sales Ticket — Confirm Order action:**
- [x] "Confirm Order" action card added to the Sales Ticket detail right sidebar
- [x] Shown when: ticket has a linked order, order is `draft`/`sent`, user has `orders.confirm`, ticket has no exit status
- [x] Positioned after "Edit Quote" (build the quote first, then confirm) and before "Cancel Quote" (logical ordering)
- [x] Calls `PUT /api/orders/{order_id}/confirm` (existing endpoint) — handles the 402 credit-limit override prompt
- [x] On success: refreshes the ticket detail; ticket auto-advances to `confirmed_wip` via the existing hook in `confirm_order()`

**New backend endpoint:**
- [x] `POST /api/tickets/from-order` — creates a Sales Ticket at `quote` stage for an existing Odoo draft order; requires `tickets.sales`; validates order is `draft`/`sent`; guards against duplicate tickets for the same order (409); assigns ticket to the creating user; sets `source: "direct"` and `order_id` already linked; logs to audit trail and fires assigned notification

**Design decision — onboarding path for existing draft orders:** When Merveille or another sales rep logs in for the first time, they will see all existing draft Odoo orders on the Orders screen. Clicking "Create Sales Ticket" on each one bootstraps a ticket at `quote` stage assigned to them — effectively claiming those orders and establishing ownership. Once all pre-portal orders have been claimed, every order in the system will have a ticket owner. Draft orders that already have a ticket show the ticket status badge with no action button — go to Sales Tickets to continue.

#### 8.11 — Send Quote to Customer

**Goal:** Complete the formal quote lifecycle — the sales rep can email the PDF quotation to the customer directly from the Sales Ticket, without touching Odoo. Sending is optional; the rep can still confirm verbally without it.

**Send Quote action:**
- [x] "Send Quote" action card in the Sales Ticket detail sidebar — shown when `order_id` exists, order is `draft`/`sent`, user has `tickets.sales`
- [x] Button label adapts: "Send Quote" (never sent) → "Resend Quote" (sent, unchanged) → "Send Updated Quote" (sent, then edited — order reset to draft)
- [x] Card style adapts: amber warning when quote was edited since last send; neutral otherwise
- [x] Calls `POST /api/tickets/{id}/send-quote`; on success refreshes ticket + reloads Odoo order state

**New backend endpoint `POST /api/tickets/{ticket_id}/send-quote`:**
- [x] Requires `tickets.sales`; validates order exists and is `draft`/`sent`
- [x] Searches for Odoo's built-in sale quotation `mail.template` (model = `sale.order`, name contains "quotation") and calls `send_mail` with `force_send=True` — email leaves via Odoo's configured mail server with the PDF quote attached
- [x] Graceful degradation: if the template is missing or Odoo's mail server is not configured, marks the order `sent` and returns a `warning` field (toast shown to rep) rather than failing hard — the ticket can still progress
- [x] Writes `state: "sent"` on the Odoo order regardless of email outcome
- [x] Stamps `quote_sent_at` on the MongoDB ticket; logs to stage history timeline and audit trail

**Edit-then-resend flow:**
- [x] When a `sent` order is revised via "Edit Quote", Odoo order state is reset to `draft` (customer's copy is stale)
- [x] `quote_sent_at` is preserved on the ticket so the portal can detect "was sent, then edited" → shows amber "edited since last send" warning
- [x] Ticket info panel shows "Quote sent [date]" line alongside payment confirmed timestamp

**Design decision — use Odoo's mail system, not Resend:** The PDF quote is generated by Odoo and stored in its mail chatter. Using Odoo's own `mail.template` keeps the email audit trail in Odoo, sends from the company's configured mail address (`sales@bassanihealth.com`), and requires zero custom PDF generation. Resend is reserved for portal notification emails (ticket assignments, status changes).

### Definition of Done
- [x] Every portal order (reseller-placed or staff-placed) auto-creates a Sales ticket — no manual entry required for orders that come through the portal
- [x] A direct inquiry (manually created ticket) can move through every stage to Complete, Cancelled, or Incomplete, with a visible timeline of who did what and when
- [x] Confirming "50% Payment Received" is blocked if Odoo's invoice shows no payment yet
- [x] Confirming an order auto-queues the packing board entry and transitions the linked Sales ticket to `confirmed_wip` — no manual re-entry
- [x] An Orders ticket cannot reach Complete without both QA and RP approval recorded independently
- [x] An Orders ticket marked Incomplete or Cancelled automatically updates and notifies the originating Sales ticket, with a reason visible to Sales
- [x] An unassigned ticket (from a reseller/admin-placed order) is visible to all `tickets.sales` users; any sales rep can claim it via "Assign to me"
- [ ] Each of the 6 named staff can log in and see only the tickets relevant to their role — **pending: accounts not yet created (operational, no code required)**

### Notes
> **Sub-deploy 1 (2026-06-19):** 8.1 Roles & Permissions. Rather than adding the 5 new roles to `ADMIN_ROLES` (which would have also granted them every `require_admin`-gated endpoint across the whole portal — products, customers, resellers, etc., not just tickets), `require_permission()`'s role-gate was broadened to `ADMIN_ROLES | TICKET_ROLES` specifically, leaving `require_admin`/`ADMIN_ROLES` itself untouched. Each ticket role gets exactly one fixed permission via `TICKET_ROLE_PERMISSIONS` — there's no per-user customisation panel for these roles, unlike `admin`. **Bug fixed along the way:** the Sidebar's nav-item filter (`frontend/src/components/UI.js`) only permission-checked items when `isAdmin` was true, falling through to "show everything" otherwise — harmless before now because the only non-admin, non-reseller roles (`warehouse_supervisor`/`packer`) never reached the Sidebar at all (intercepted earlier in `App.js`'s `ProtectedRoute`). The new ticket roles do reach it, so this would have shown them the full nav (Products, Customers, Resellers, Invoices, etc.) with every click failing on the backend's 403. Fixed by permission-checking unconditionally. **Known gap, not fixed:** changing an existing user's `role` via `PUT /api/users/{id}` doesn't recompute their `permissions` object — this was already true for promoting someone to `admin` before this change, not something newly introduced. Role changes should go through deactivate-and-recreate until that's addressed separately.

> **Sub-deploy 2 (2026-06-19):** 8.2–8.4 backend (Sales ticket, Orders ticket extension, cross-handoff). New `backend/routes/ticket_routes.py` owns the `tickets` collection end-to-end. Added `require_any_permission()` to `auth.py` (sibling to `require_permission()`) since a Sales ticket legitimately needs to be visible to both `sales` (drives it) and `finance` (needs to find tickets awaiting payment confirmation across all reps) — a plain `sales`-role account only sees their own queue by default; finance/admin see everything unless they filter. `confirm-payment` reads the linked invoice's real Odoo `payment_state` rather than trusting a bare click, per the standing "Odoo is the financial source of truth" principle — blocks with a clear message if Odoo shows nothing recorded yet. On the Orders side, `packing_board_routes.py` gained 5 new endpoints (`qa-approve`, `rp-approve`, `complete`, `incomplete`, `cancel`) plus a `require_board_access()` helper so the 3 new operational roles can view the board without needing `require_admin` or a granular `warehouse.*` grant. The cross-ticket handoff is two one-way hooks, not a shared sync engine: order confirmation (`order_routes.py::confirm_order()`) auto-transitions any linked Sales ticket to `confirmed_wip`; the three new Orders terminal-state endpoints call `_sync_sales_ticket()` to write the outcome back and fire a push notification. Both are best-effort/silent if no matching ticket exists (e.g. legacy orders placed before Phase 8) — a missing link is expected, not an error.

> **Sub-deploy 5 (2026-06-21):** 8.6 Direct inquiry quote builder + portal deposit registration. Every gap that previously required Merveille or finance to open Odoo is now covered in the portal. `ticket_routes.py` gained three new action endpoints (`create-order`, `cancel-order`, `register-deposit`) plus a `payment-journals` lookup used by the deposit modal. The down payment invoice + payment registration flow mirrors the wizard sequence Odoo uses internally (`sale.advance.payment.inv` to create the invoice, `account.payment.register` to post and reconcile the payment) — both are XML-RPC calls, keeping Odoo as the financial source of truth. `GET /api/orders/` now batch-queries the `tickets` collection and attaches `linked_ticket` to each row so the Orders table shows pipeline status at a glance. On the frontend, the Sales Ticket detail modal gained three conditional action panels: Build Quote (full-page document-style builder), Cancel Quote (confirm dialog, only on pre-confirm stages), and Register Deposit (amount, date, journal). The quote builder uses **per-row debounced live Odoo search** (300ms, name + SKU) rather than a preloaded product list — no catalogue size cap, results are always live from Odoo. `GET /api/products/` search parameter extended to match `default_code` (SKU) as well as name via an Odoo OR domain. Deposit is optional before order confirmation — credit-term resellers don't need one.

> **Sub-deploy 4 (2026-06-19):** Unified pipeline — every portal order auto-creates a Sales ticket. Key realisation: the ticket system was initially designed as a separate layer for mailbox inquiries, but the correct model is that it IS the processing pipeline for all orders, regardless of source. Changes: `create_order()` now inserts a `tickets` document (best-effort, non-blocking) immediately after the Odoo order is created — `source: "portal"`, `status: "sale_order"`, `order_id` already linked, `assigned_to` set to the creating user if they hold `tickets.sales`, otherwise `null`. `GET /api/tickets` updated so `sales`-role users see their own queue plus all unassigned tickets. `PUT /api/tickets/{id}/stage` extended with `assigned_to` support so a sales rep can claim an unassigned ticket from the queue. `SalesTickets.js` updated with a source badge (Portal Order / Direct Inquiry), assignment display, "Assign to me" button on unassigned tickets, and "New Direct Inquiry" label on the manual create button (portal orders no longer need manual ticket creation). `POST /api/tickets` (manual create) now stamps `source: "direct"` — this path remains for the pre-portal-order inquiry phase.

> **Sub-deploy 9 (2026-06-23):** 8.11 Send Quote to customer. `POST /api/tickets/{id}/send-quote` finds Odoo's sale quotation `mail.template`, calls `send_mail` with `force_send=True`, then writes `state: "sent"` on the order and stamps `quote_sent_at` on the ticket. Graceful degradation: if Odoo's mail server isn't configured or the template is missing, the endpoint still marks the order sent and returns a `warning` field rather than a hard 502 — the rep sees a toast but can continue. Edit flow: `update-order` now resets a `sent` order to `draft` after line replacement (customer's copy is stale); `quote_sent_at` is kept on the ticket so the frontend can detect "sent then edited" and show an amber warning with "Send Updated Quote" label. The "Send Quote" card is positioned after "Edit Quote" and before "Confirm Order" in the sidebar — the natural action sequence.

> **Sub-deploy 8 (2026-06-23):** 8.10 Orders screen read-only + Confirm Order in Sales Ticket. The Orders screen is now a pure monitoring view — no create, confirm, or cancel is possible from there. The confirm/cancel buttons were removed from both the table actions column and the `OrderView` full-page detail (passed `canConfirmOrder={false}` / `canCancelOrder={false}`). Draft orders without a ticket get a "Create Sales Ticket" button that calls the new `POST /api/tickets/from-order` endpoint — this creates a ticket at `quote` stage, assigns it to the creating user, and links the Odoo order immediately. The order's existing draft state is preserved; nothing changes in Odoo. The "Confirm Order" action card now lives exclusively in the Sales Ticket detail sidebar, shown when the linked order is still `draft`/`sent` and the user holds `orders.confirm`. It calls the existing `PUT /api/orders/{id}/confirm` and refreshes the ticket in place — the ticket auto-advances to `confirmed_wip` via the existing hook already written in `confirm_order()`. The credit-limit 402 override prompt (window.confirm fallback) is replicated in `SalesTickets.js` so the UX is identical to the old Orders screen behaviour.

> **Sub-deploy 7 (2026-06-23):** 8.9 Stock accuracy + Orders screen pipeline enforcement. **Stock accuracy:** Three locations in the codebase were using inconsistent models and fields for low-stock detection — dashboard used `product.template` + `qty_available` (aggregates across variants, physical only), dead stock report used the same, and `/products/low-stock` used `product.product` + `qty_available` (right model, wrong field). All three now use `product.product` + `virtual_available` to match the catalogue orange badge logic (`virtual_available < 10` in `Views.js`). Dead stock report also had a latent mismatch: `recently_sold_ids` collected from `sale.order.line.product_id` are `product.product` IDs, but were being compared against `product.template` IDs — every product was effectively classified "never sold". Switching the products query to `product.product` fixes the comparison. `Dashboard.js` updated to read `virtual_available` from the response. **Orders screen pipeline enforcement:** The cart view (direct order creation) has been removed from the Orders screen entirely; staff will be trained to enter all new orders via Sales Tickets. A blue info banner explains this on load. The screen now focuses on monitoring: every confirmed order row shows its packing board status in a new "Packing" column. For confirmed orders not yet in the pipeline, a `tickets.manage`-gated "Queue for Packing" button calls the new `POST /api/packing/adopt` endpoint, which reads the Odoo SO, validates `state = sale`, checks for duplicates, fetches the picking to build the items list, and upserts the packing board document at `queued` — identical structure to what `confirm_order()` produces. The order list API now batch-fetches `packing_status` from MongoDB alongside `linked_ticket` so a single page load shows the full pipeline state of every order at a glance. Confirmed with the business: staff have not yet used the portal (they're still on Odoo only), so removing the cart view before go-live is the right call rather than leaving a pipeline bypass permanently in place.

> **Sub-deploy 6 (2026-06-22):** 8.8 Orders Tickets full-page detail with strictly linear pipeline. `OrdersTickets.js` completely rewritten from a modal-based view to the same two-view (list | detail) full-page pattern used by Sales Tickets. Left panel renders the packing board entry as a document: customer info, reference numbers (PS/invoice/DN), packer, items table with per-item tick status from `item_ticks`, notes, and inline incomplete reason alert. Right sidebar shows status + key timestamps, QA/RP approval cards, and role-gated action cards enforcing the linear `queued → packing → ready → complete` pipeline — `canOrders` only sees the action for the current stage (no ability to skip); `canQa`/`canRp` only see their approve button when `status === "ready"` and they haven't approved yet; `canManage` gets an override dropdown for any status. `refreshDetail()` keeps the user on the detail page after every action. Incomplete reason opens as a modal overlay (same pattern as Sales Tickets' deposit modal). Backend gained four new endpoints: `GET /entry/{order_id}` (single-entry fetch, board access), `PUT /mark-packing` (tickets.orders, from queued only), `PUT /mark-ready` (tickets.orders, from packing only), `PUT /override-status` (tickets.manage, any status, audit-logged with from/to).

> **Sub-deploy 3 (2026-06-19):** 8.5 UI (SalesTickets + OrdersTickets React views). **Key discovery during implementation:** the original plan said "extend the existing packing board UI" for the Orders Ticket view — but the packing board has no React view. `frontend/public/` houses standalone `supervisor.html`/`packer.html`/`packing-board.html` pages with their own auth (display token / role JWT), purpose-built for warehouse floor screens. Those can't be extended as a React SPA view for ticket-role users who need portal-style nav and permissions. Built a new `OrdersTickets.js` instead, consuming the same `/api/packing/board` REST endpoint (REST polling, not WebSocket — ticket roles are desk users, not floor screens). `SalesTickets.js` includes debounced customer search for ticket creation, a full stage-advance form (status select, order_id/invoice_id linking, incomplete reason, note), stage history timeline, and finance payment-confirm section — all conditionally rendered based on `can()`. Sidebar's single-`permission` nav filter was generalised to also support a `permissions: [...]` array (OR semantics via `.some(p => can(p))`) to gate the Orders Tickets link on `tickets.orders OR tickets.qa_approve OR tickets.rp_approve` — necessary because three distinct roles share the same view. `PERMISSION_ROLES` constant in `AuthContext.js` moved to module level (not inside render scope) for stability. Both views added as non-`adminOnly` `ProtectedRoute`s in `App.js`. Notification service `url` updated from `/` to `/tickets/sales` for ticket-related pushes.

---

## Ongoing Standards

These apply throughout all phases and to all future development.

### Every new endpoint must
- [ ] Require authentication (`get_current_user` or `require_admin`)
- [ ] Validate and sanitise all inputs via Pydantic models
- [ ] Return consistent error format: `{"detail": "Human-readable message"}`
- [ ] Log significant actions to `audit_logs` collection
- [ ] Never expose raw Odoo error messages to the client (wrap in generic message)

### Every Odoo interaction must
- [ ] Use `get_odoo_client()` (never create a new XML-RPC connection directly)
- [ ] Be wrapped in try/except with a meaningful fallback or error message
- [ ] Never hardcode Odoo credentials — always from `settings`
- [ ] Respect Odoo as the source of truth — never override Odoo data in MongoDB

### Every email must
- [ ] Use the shared `email_service.py` helper (never inline `resend.Emails.send`)
- [ ] Fire via `BackgroundTasks` (never block the API response)
- [ ] Have a clearly named function: `send_order_confirmation_email(order, reseller)`
- [ ] Degrade gracefully if `RESEND_API_KEY` is not set (log, do not crash)

### Every MongoDB write must
- [ ] Use `datetime.now(timezone.utc)` for all timestamps (never `datetime.utcnow()` — deprecated)
- [ ] Include `created_at` on insert and `updated_at` on update
- [ ] Never store `float("inf")` or `NaN` — these are not JSON-serialisable

---

## Infrastructure Reference

| Service | Provider | Purpose | Cost |
|---------|----------|---------|------|
| Backend API | Railway | FastAPI + uvicorn | Current plan |
| MongoDB | Railway | Primary database | Current plan |
| Redis | Railway | Product cache + circuit breaker state | ~R90/month |
| Email | Resend | Transactional email | Free / $20/month Pro |
| Error monitoring | Sentry | Exception tracking and alerting | Free / $26/month |
| Frontend CDN | Cloudflare Pages | Static file serving | Free |
| Backups | Cloudflare R2 | MongoDB daily dumps | Free (10GB) |
| SSL | Cloudflare / Let's Encrypt | TLS termination | Free |

---

## Decision Log

> Record significant architectural decisions here as they are made during implementation.

| Date | Decision | Reason | Alternatives Considered |
|------|----------|--------|------------------------|
| 2026-06-13 | Resend chosen as email provider | Already integrated; free tier sufficient for initial scale | SendGrid, Mailgun |
| 2026-06-13 | Redis on Railway for cache | Keeps all infrastructure in one place; simple ops | Upstash Redis, ElastiCache |
| 2026-06-13 | Cloudflare Pages for frontend | Free; global CDN; independent deploys from backend | Vercel, Netlify |
| 2026-06-13 | XML-RPC retained (not migrated to JSON-RPC) | Sufficient for current scale; migration is medium-term roadmap | Odoo REST API, JSON-RPC |
| 2026-06-13 | Five distinct roles chosen over flat admin + permissions | Warehouse roles (supervisor, packer) have fundamentally different UX needs; cleaner than permission flags alone | Pure permission flags with no named roles |
| 2026-06-13 | Packing board display uses long-lived display token (not user JWT) | The 85" screen has no keyboard; a login flow is impractical. Display token is read-only and easily rotated | No auth (current, unacceptable), shared user account |
| 2026-06-13 | Packer view is a separate HTML page (not React app) | Consistency with supervisor.html pattern; lighter weight for handheld devices | React route with packer-specific layout |
| 2026-06-15 | Multi-warehouse stock accuracy moved from Phase 7 (prep-only) to Phase 3.7 (functional) | Code audit confirmed stock figures are company-wide totals and order creation has no `warehouse_id` — at multi-vault scale this risks overselling and incorrect stock decrement, which is core commercial correctness, not a future-proofing task | Leave as Phase 7 plumbing-only (rejected — too risky to defer) |
| 2026-06-18 | `products.manage` added as single permission covering all product catalog operations | Prevents sales-focused admins from accidentally modifying the catalog. One permission covers create/edit/archive/variants — splitting into granular sub-actions (create, edit, archive) adds UI complexity with no practical benefit at current team size | Individual create/edit/archive permissions (rejected — overkill); no products permission at all (rejected — genuine risk) |
| 2026-06-18 | `orders.create`, `customers.create/edit` not permission-gated | Creating orders and managing customers are core to every admin's job. Gating would add friction without preventing accidental harm. Permission system targets destructive/financial actions, not routine data entry | Full CRUD permissions per domain (rejected — over-engineered for current team size) |
| 2026-06-23 | Orders screen made fully read-only; Confirm Order action moved exclusively to Sales Ticket detail | Confirm and cancel on the Orders screen were the last remaining pipeline bypasses after 8.9 removed the cart view. A draft order on the Orders screen should only be actionable through its Sales Ticket — splitting confirm across two screens creates training confusion and a dual-entry risk. The Confirm Order card in the Sales Ticket sidebar calls the same existing endpoint and preserves the credit-limit override UX. | Leave Confirm on the Orders screen and educate staff to always confirm via the ticket (rejected — training-only controls fail); add a server-side guard that refuses confirm if no ticket exists (rejected — over-complicated; the UI change is sufficient and cleaner) |
| 2026-06-23 | `POST /api/tickets/from-order` creates ticket at `quote` stage (not `open`) | Draft Odoo orders already exist as quotations — the quote is already built. Starting at `open` would require the user to immediately advance to `quote` manually, which is pure overhead. `quote` is the correct stage when `order_id` is already linked. | Start at `open` (rejected — wrong stage, creates unnecessary manual step); start at `sale_order` (rejected — order is not confirmed yet) |
| 2026-06-23 | Direct order creation removed from the Orders screen; all new orders must enter via Sales Tickets | Staff have not yet used the portal (still on Odoo only) — the correct time to enforce pipeline discipline is before go-live, not after. Existing confirmed Odoo orders that pre-date the pipeline are adopted directly to the packing board (bypassing the Sales Ticket pre-confirmation steps, which already happened outside the portal) via `POST /api/packing/adopt` + a "Queue for Packing" button on the Orders screen | Leave the cart in place and train staff to "not use it" (rejected — every bypass is a training failure waiting to happen); require existing orders to go through a retroactive Sales Ticket (rejected — deposit/approval already happened; paperwork with no operational value) |
| 2026-06-19 | Audit trail pulled forward into Phase 0 (as 0.6) instead of left as an ambient cross-cutting standard | Code audit found two incompatible audit schemas writing to the same collection and zero route coverage outside the packing board, despite the documented "every action is audit-logged" principle. Retrofitting consistent logging after Phase 1–7 add more write-routes is more work than fixing the foundation now | Leave as a per-phase ad-hoc standard (rejected — already proven to drift); defer to a dedicated later phase (rejected — same risk as deferring Phase 0 itself) |

---

## Deferred Items (Out of Current Scope)

Items reviewed and intentionally deferred beyond Phase 7. Revisit when business requires.

- **Automated test suite** — pytest unit tests, Playwright E2E. Deferred in favour of faster production deployment. Add when team size increases.
- **Multi-company support** — parameterise `company_id` throughout. Deferred until second business entity is onboarded.
- **CRM integration** — `crm.lead` / `crm.opportunity`. Deferred; no immediate reseller requirement.
- **JWT to httpOnly cookie** — currently in localStorage. Acceptable risk for internal portal; revisit if public-facing exposure increases.
- **GraphQL API layer** — deferred; REST is sufficient for current scale.
- **SAGE integration** — referenced in original README roadmap; deferred pending client decision.
- **Returns / RMA workflow** — `stock.return.picking`. Deferred until operational volume justifies it.
- **Contract management** — reseller agreements and pricing contracts. Deferred.
- **Load testing** — k6 baseline tests. Deferred; add before any marketing campaign that expects traffic spikes.

---

---

## Phase 9 — Go-Live Infrastructure

**Goal:** Replace the Railway-generated URL with a permanent client-owned domain, verify email sending, and confirm all production environment variables are correct.  
**Estimate:** 1–3 days (largely blocked on client actions)  
**Status:** 🔴 Not Started  
**Completed:** —  

### Context

The portal is currently live at `https://bassani-health-production-3d68.up.railway.app`. This is a Railway-generated subdomain — functional but not client-facing. Before going live with staff, the URL needs to point to a real domain. This requires coordination with whoever manages `bassanihealth.com` DNS, and a parallel Resend domain verification for outbound email.

Current unknowns: who hosts `bassanihealth.com`, what control panel they use (cPanel, Plesk, Cloudflare, etc.), and whether there is a cost implication for the subdomain or SSL.

### Tasks

#### 9.1 Custom Domain on Railway
- [ ] Identify who manages `bassanihealth.com` DNS — ask the client (likely their web hosting provider or registrar)
- [ ] Decide on subdomain: `portal.bassanihealth.com` is the intended target (already hardcoded in roadmap references)
- [ ] In Railway: Project → Settings → Networking → Add Custom Domain → enter `portal.bassanihealth.com`
- [ ] Railway will display a CNAME target (e.g. `<project>.railway.app`) — provide this to the client's DNS admin to create the CNAME record
- [ ] Wait for DNS propagation (typically 5–60 minutes; up to 48 hours worst case)
- [ ] Railway provisions SSL automatically via Let's Encrypt once the CNAME resolves — no manual cert needed
- [ ] Once verified: set `PORTAL_URL=https://portal.bassanihealth.com` in Railway environment variables
- [ ] Update `backend/config.py` default to `https://portal.bassanihealth.com`

> **Cost:** Railway custom domains are included in all paid plans — no additional charge. The domain itself is the client's existing asset. No new hosting cost.

#### 9.2 Resend Sending Domain
- [ ] Client creates a Resend account (or provides access to existing one) at resend.com
- [ ] In Resend: Domains → Add Domain → enter `bassanihealth.com`
- [ ] Resend will display 3 DNS records (SPF, DKIM × 2, and optionally DMARC) — provide to client's DNS admin
- [ ] Once DNS records propagate and Resend shows domain as "Verified": update `SENDER_EMAIL=noreply@bassanihealth.com` in Railway environment variables
- [ ] Update `RESEND_API_KEY` in Railway to the client's production Resend API key
- [ ] Test: create a test user with a real email address, confirm welcome email arrives from `noreply@bassanihealth.com`

> **Cost:** Resend free tier is 3,000 emails/month, 100/day. Likely sufficient for current volume. Pro plan is $20/month if needed.

#### 9.3 Production Environment Verification
- [ ] Confirm all Railway environment variables are set correctly for production:
  - `RESEND_API_KEY` — client's production key
  - `SENDER_EMAIL` — `noreply@bassanihealth.com` (after domain verified)
  - `PORTAL_URL` — `https://portal.bassanihealth.com` (after domain live)
  - `MONGO_URL`, `JWT_SECRET`, `ODOO_URL`, `ODOO_DB`, `ODOO_USERNAME`, `ODOO_PASSWORD` — already set
- [ ] Smoke test all email triggers in production (welcome email, order placed, statement generated)
- [ ] Confirm portal loads correctly on the custom domain with HTTPS green lock

### Definition of Done
- [ ] `https://portal.bassanihealth.com` loads the portal with a valid SSL certificate
- [ ] Outbound emails arrive from `noreply@bassanihealth.com` (not `onboarding@resend.dev`)
- [ ] All production environment variables confirmed correct
- [ ] The Railway-generated URL still works as a fallback (Railway keeps it active alongside the custom domain)

### Notes
> **2026-06-23:** Current live URL is `https://bassani-health-production-3d68.up.railway.app`. Domain `portal.bassanihealth.com` is the intended target. Blocked on: (1) identifying the DNS provider for `bassanihealth.com`, (2) client access to their Resend account. No code changes required for this phase — it is entirely infrastructure and DNS coordination.

---

## Phase 10 — Responsive UI

**Goal:** The portal works correctly and looks professional on every screen used by the business: mobile phone (sales reps, remote access), tablet, laptop, desktop, and wide 4K displays. No view is broken, illegible, or unusable at any supported viewport.  
**Estimate:** 1–2 weeks  
**Status:** 🟡 In Progress — 10.0–10.4 complete; 10.5 (large screen caps) remaining  
**Completed:** 10.0 login fix, 10.1 shell overflow, 10.2 column hiding, 10.3 detail views, 10.4 form grids — 2026-06-26

### Context

The portal was built primarily for desktop/laptop use. Responsive Tailwind classes were applied to some components (the sidebar already has mobile slide-in behaviour via `fixed -translate-x-full` + hamburger toggle; TopBar already has a `lg:hidden` hamburger button), but most views — particularly tables, modals, and complex form layouts — have not been tested or adapted for smaller viewports. The login page's fixed-width left panel (`w-72`) occupied most of the screen on mobile, making the sign-in form unusable.

**Supported viewports:**
- **Mobile phone** (360px+) — sales reps on the go, remote access
- **Tablet** (768px+) — clinical or field staff
- **Laptop / Desktop** (1024px+) — primary internal workstation use
- **85" Packing floor screen** — the warehouse display board is a standalone HTML page with its own optimised layout; this phase covers the React SPA portal only

---

### 10.0 — Login Page Mobile Fix ✅

- [x] Login left panel (`w-72 bg-slate-900`) hidden on mobile — changed to `hidden md:flex md:w-72` so the sign-in form takes full width below `md` breakpoint
- [x] Verified: main app sidebar already has correct mobile behaviour (prior work) — `fixed -translate-x-full` default; `lg:static lg:translate-x-0` on desktop; hamburger in TopBar already present — no changes needed

---

### 10.1 — Shell & Navigation Polish ✅

- [x] Modals: already had bottom-sheet pattern (`items-end sm:items-center`, `rounded-t-2xl sm:rounded-2xl`) — no changes needed
- [x] `DataTable`: already had `overflow-x-auto` wrapper — no changes needed
- [x] `CustomerProfile.js` — all 4 inline tables (addresses, orders, invoices, account statement) wrapped in `overflow-x-auto`
- [x] `SalesTickets.js` detail view — Bill To / Warehouse grid: `grid-cols-1 sm:grid-cols-2`; line items table wrapped in `overflow-x-auto`
- [x] `OrdersTickets.js` detail view — Customer / Docs grid: `grid-cols-1 sm:grid-cols-2`; items table wrapped in `overflow-x-auto`

---

### 10.2 — List Views ✅

- [x] `DataTable` extended with `meta.className` support — column definitions can now declare `meta: { className: "hidden md:table-cell" }` and both `<th>` and `<td>` receive the class automatically
- [x] **Customers** — Contact, City, Section 21, Credit Limit, Terms, Created By → `hidden md:table-cell`; Name + Type always visible
- [x] **Orders** — Order # → `hidden sm:table-cell`; Date / Amount(untaxed) / Payment → `hidden md:table-cell`; Ticket / Packing → `hidden lg:table-cell`; Customer + Total + Status always visible
- [x] **Products** — Category / Cost / Tax / Forecasted → `hidden md:table-cell`; Sale Price → `hidden sm:table-cell`; Product/SKU + On Hand always visible
- [x] **Invoices** — Date / Due Date / Outstanding → `hidden sm:table-cell`; Invoice # + Customer + Total + Status always visible
- [x] **Resellers** — Type → `hidden sm:table-cell`; Contact → `hidden md:table-cell`; Name always visible
- [x] **Users** — Status → `hidden sm:table-cell`; Warehouse / Last Login → `hidden md:table-cell`; Permissions → `hidden lg:table-cell`; Username + Name + Role always visible

---

### 10.3 — Detail & Profile Views ✅

- [x] **SalesTickets detail** — Bill To / Warehouse header grid now `grid-cols-1 sm:grid-cols-2`; overall layout already `grid-cols-1 lg:grid-cols-3` (sidebar stacks correctly on mobile — no change needed)
- [x] **OrdersTickets detail** — Customer / docs header grid now `grid-cols-1 sm:grid-cols-2`; items table wrapped in `overflow-x-auto`
- [x] **CustomerProfile.js** — all inline section tables wrapped in `overflow-x-auto`; KPI grid already `grid-cols-2 lg:grid-cols-3` — no change needed
- [x] **ResellerProfile.js** — bank detail grid already `grid-cols-2 sm:grid-cols-4`; KPI grid already `grid-cols-2 lg:grid-cols-3` — no changes needed
- [x] **AuditTrail** — detail modal 2-col grid → `grid-cols-1 sm:grid-cols-2`

---

### 10.4 — Quote Builder & Complex Forms ✅

- [x] Quote builder 3-col header (Bill To / Warehouse / Deliver To) → `grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`
- [x] Quote builder line items card → `overflow-x-auto` on the card wrapper
- [x] Quote builder Notes / Totals → `grid-cols-1 lg:grid-cols-5`; col-span values prefixed with `lg:`
- [x] SalesTickets stage form Order ID / Invoice ID grid → `grid-cols-1 sm:grid-cols-2`
- [x] `CustomerOnboarding.js` — all 5 two-column form grids → `grid-cols-1 sm:grid-cols-2`
- [x] `CustomerProfile.js` address modal City / Postal Code grid → `grid-cols-1 sm:grid-cols-2`
- [x] `Users.js` create user modal Username / Password grid → `grid-cols-1 sm:grid-cols-2`
- [x] Modals: already full-screen on mobile via existing bottom-sheet pattern — no changes needed

---

### 10.5 — Large Screen Optimisation

- [ ] Content areas: add `max-w-screen-2xl mx-auto` cap to `main` containers to prevent extreme line-lengths and whitespace on 4K / ultrawide displays
- [ ] Table columns: use proportional widths (`w-1/4`, `min-w-[120px]`) so columns don't collapse to slivers on narrow viewports or balloon on wide ones
- [ ] The 85" packing board HTML (`packing-board.html`) already has its own fullscreen layout — verify touch targets and text sizes are suitable for floor use at that scale

---

### Definition of Done

- [x] Login page is fully usable on a 360px-wide mobile screen — form is visible, inputs are reachable, the black panel does not obscure the form
- [x] Sidebar hamburger opens and closes correctly on a mobile browser (via existing mechanism)
- [x] Every DataTable in the portal scrolls horizontally rather than breaking page layout on narrow screens (overflow-x-auto already present; inline tables in CustomerProfile/SalesTickets/OrdersTickets now wrapped)
- [x] No modal clips off-screen on a 375px viewport — existing bottom-sheet pattern (`items-end sm:items-center`) handles this
- [x] CustomerProfile KPI cards are readable on a 375px phone (grid already `grid-cols-2 lg:grid-cols-3`)
- [x] SalesTickets and OrdersTickets detail grids collapse to single-column below `sm:` breakpoint
- [x] Quote builder 3-column header collapses gracefully on mobile (`grid-cols-1 sm:grid-cols-2 lg:grid-cols-3`)
- [x] List views show only essential columns on narrow screens — secondary data hidden via `meta.className` responsive utility classes
- [x] All multi-column form grids in modals and onboarding stack to single column below `sm:` breakpoint
- [ ] All views render without excessive whitespace on a 2560px+ desktop (10.5 — max-width caps pending)

### Notes

> **10.0 (2026-06-26):** Login left panel hidden on mobile with `hidden md:flex`. Main app sidebar was already fully responsive from prior work — `fixed -translate-x-full` on mobile, `lg:static lg:translate-x-0` on desktop, hamburger in `TopBar` already in place. No changes to the sidebar or AppLayout were necessary.

> **10.1–10.4 (2026-06-26):** Comprehensive responsive pass across 9 files. `DataTable` and `Modal` in `UI.js` were already mobile-safe — confirmed and left unchanged. `DataTable` extended with `meta.className` support (applied to both `<th>` and `<td>`) enabling declarative column hiding from each view's column definition. Inline tables in `CustomerProfile.js` (addresses, recent orders, outstanding invoices, account statement) wrapped in `overflow-x-auto`. `SalesTickets.js` and `OrdersTickets.js` fixed two fixed-column grids in detail views and wrapped line-item tables. Quote builder (SalesTickets) collapsed 3-col header to responsive, made Notes/Totals stack on mobile, added overflow-x on the line items card. `CustomerOnboarding.js` all 5 form grids made responsive. `Users.js`, `AuditTrail.js`, and `CustomerProfile.js` modal grids all stacked to single-column below `sm:`. Column hiding applied to Customers, Orders, Products, Invoices, Resellers, Users list views — each hides secondary columns at `sm`/`md`/`lg` breakpoints so the most critical info always stays visible without horizontal scrolling. **Only 10.5 (max-width caps for 2560px+ displays) remains.**

---

*This document is the single source of truth for the production readiness programme. Update it after every phase completion. Do not start a new phase until the previous phase's Definition of Done is fully checked off.*
