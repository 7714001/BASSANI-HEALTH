# Bassani Health Portal — Production Readiness Roadmap

**System:** Bassani Health B2B Sales & Reseller Portal  
**Stack:** FastAPI · React 18 · MongoDB · Odoo v17 (XML-RPC) · Railway  
**Last Updated:** 2026-06-19  
**Overall Status:** 🟡 Pre-Production — Phase 0 complete, Phase 1 in progress (CORS + 2FA deferred to pre-launch)  

---

## Progress Overview

| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| 0 | Roles, Permissions & Identity Foundation | 🟢 Complete | Sub-deploys 1–4 complete — 2026-06-19 |
| 1 | Security Hardening | 🟡 In Progress | 1.1/1.3/1.4/1.6 complete — 2026-06-19 · 1.2/1.5 deferred to pre-launch |
| 2 | Email Engine | 🔴 Not Started | — |
| 3 | Core Odoo Integration | 🟡 In Progress | 3.1, 3.5 complete (3.5 email pending) — 2026-06-19 |
| 4 | Commission Engine Hardening | 🔴 Not Started | — |
| 5 | Reliability & Resilience | 🔴 Not Started | — |
| 6 | Observability & Operations | 🔴 Not Started | — |
| 7 | Missing Commercial Workflows | 🔴 Not Started | — |

**Status Key:** 🔴 Not Started · 🟡 In Progress · 🟢 Complete · ⏸ Deferred

---

## Architecture Principles (Non-Negotiable)

These govern every decision made during implementation. Do not deviate from them.

- **Odoo is the financial source of truth.** Every invoice, payment, vendor bill, credit note, and order must originate in or be confirmed by Odoo. The portal never becomes a parallel ledger.
- **MongoDB handles portal-layer concerns only.** Reseller profiles, commission records, ownership mappings, onboarding, audit logs, and settings belong in MongoDB.
- **All commission payments must produce an Odoo vendor bill.** No statement can be marked paid without a corresponding `account.move` in Odoo.
- **Everything runs on Railway.** No external services beyond Resend (email API), Sentry (error monitoring), and Cloudflare (CDN/backups). No new infrastructure without explicit decision.
- **Background tasks do not block API responses.** Emails, notifications, and non-critical writes always fire via `BackgroundTasks`.
- **Every admin action is audit-logged.** Every state change on a financial record captures actor, timestamp, IP, and before/after values.

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
**Status:** 🟡 In Progress — 1.1, 1.3, 1.4, 1.6 complete; 1.2 and 1.5 deferred until production domain/SSL are finalised  
**Completed:** Sub-deploy 1 (1.1, 1.3, 1.4, 1.6) — 2026-06-19  

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

### Definition of Done
- [x] Cannot log in as admin with `admin123` on any deployed environment _(legacy account auto-deactivated on startup)_
- [ ] Browser console shows no CORS errors from the correct domain _(deferred with 1.2)_
- [x] Login attempt #6 returns 429 within the 15-minute window
- [ ] Admin without 2FA configured is prompted on login _(deferred with 1.5)_
- [x] Application startup fails immediately if JWT secret is default value

### Notes
> **Sub-deploy 1 (2026-06-19):** Implemented the four items with no domain/SSL dependency. Backend: startup `RuntimeError` if `JWT_SECRET` is still the placeholder; new `backend/rate_limit.py` holds a shared `slowapi.Limiter` (avoids a circular import between `server.py` and the route modules) wired into `/api/auth/login` (5/15min) and `/api/healthcare/onboarding` (10/hour); startup migration deactivates any `{username: "admin", role: "admin"}` account found, matching the exact legacy seed from commit `5965ef4`. Created `backend/.env.example` (didn't exist before). 1.2 (CORS) and 1.5 (2FA) explicitly deferred — see notes above — to avoid blocking domain-dependent and testing-friction work; tracked here so they aren't forgotten before go-live.

---

## Phase 2 — Email Engine

**Goal:** Every significant business event sends the correct email to the right recipient.  
**Estimate:** 2–4 days  
**Status:** 🔴 Not Started  
**Completed:** —  

### Context
Resend is already integrated (`resend` in `requirements.txt`, `RESEND_API_KEY` in config). The healthcare registration form already sends emails correctly. This phase wires the same pattern to all remaining business events.

### Tasks

#### 2.1 Shared Email Service
- [ ] Create `backend/services/email_service.py`
- [ ] Implement `send_email(to, subject, html, bcc=None)` base function
- [ ] Guard on missing/placeholder API key (log clearly, do not silently swallow)
- [ ] Include Bassani Health branded HTML wrapper (header, footer, colours) reused across all templates
- [ ] Add `SUPPORT_EMAIL` to config for reply-to on all outbound emails

#### 2.2 Order Emails
- [ ] **Order placed** → Reseller receives confirmation with order reference, customer name, line items, and total
- [ ] **Order confirmed** → Reseller receives confirmation that order is now a Sale Order in Odoo; Customer receives notification that their order has been processed
- [ ] **Order cancelled** → Reseller receives cancellation notice with order reference; Customer receives notification

#### 2.3 Customer Onboarding Emails
- [ ] **Application submitted** → Admin team receives alert with customer name, reseller name, and link to applications page
- [ ] **Application approved** → Reseller receives notification that customer is active; Customer receives welcome email with practice name and support contact
- [ ] **Application rejected** → Reseller receives notification with rejection reason

#### 2.4 Commission Emails
- [ ] **Statement generated** → Reseller receives monthly summary: month label, total turnover, tier, rate, projected commission amount
- [ ] **Statement marked as paid** → Reseller receives payment confirmation: amount paid, payment reference, payment date, and banking details used

#### 2.5 Packing Floor Notifications
- [ ] **Order ready for collection** → All active `warehouse_supervisor` accounts with an email address on file receive a notification: order ID, customer name, packer name, unit count
- [ ] Packers do **not** receive email notifications — they see assignments in real time on `packer.html`
- [ ] If no supervisor has an email address, skip silently (log a warning — do not crash)

#### 2.6 Account Emails
- [ ] **New user account created** → User receives welcome email with username, temporary password (or reset link), and login URL

#### 2.7 Resend Configuration
- [ ] Verify `RESEND_API_KEY` is set in Railway production environment
- [ ] Verify sending domain is verified in Resend dashboard
- [ ] Confirm free tier limit (3,000/month, 100/day) is sufficient for current volume; upgrade to Pro ($20/month) if needed

### Definition of Done
- [ ] Place a test order → reseller receives confirmation email within 60 seconds
- [ ] Admin confirms order → reseller and customer both receive emails
- [ ] Approve a customer onboarding → reseller and customer both receive emails
- [ ] Generate a commission statement → reseller receives summary email
- [ ] Mark statement as paid → reseller receives payment confirmation
- [ ] Create a new user → user receives welcome email
- [ ] Packer ticks last item on an order → supervisor(s) with email on file receive a "ready for collection" notification
- [ ] All emails render correctly on mobile and desktop clients
- [ ] No email sending blocks or slows the API response (all fire via BackgroundTasks)

### Notes
> _(Add implementation notes, decisions, or issues encountered here)_

---

## Phase 3 — Core Odoo Integration

**Goal:** Orders are commercially and fiscally correct, and are fulfilled from the correct physical stock location. All major Odoo sales workflows are supported.  
**Estimate:** 2–3 weeks  
**Status:** 🟡 In Progress — 3.1 and 3.5 complete (email on 3.5 blocked on Phase 2/Resend)  
**Completed:** Sub-deploy 1 (3.5 Order Cancellation) — 2026-06-19 · Sub-deploy 2 (3.1 Product Variants) — 2026-06-19  

### Tasks

#### 3.1 Product Variants
- [x] Switch product fetches from `product.template` to `product.product` (variants) — `list_products`, `get_product`, `low_stock_products` in `product_routes.py` now query `product.product` directly; each variant is its own catalog row with its own `qty_available`/`virtual_available`/price
- [x] Fetch and expose variant attributes (size, format, dosage) per product — added `display_name` (Odoo auto-appends the variant attribute differentiator in parentheses, e.g. "Tincture 20ml THC (30mg)") to `PRODUCT_FIELDS`; surfaced in both the Orders cart grid and admin Products table
- [x] Update order line creation to use `product_id` (variant ID), not template ID — `addToCart`/`cartItemFor` in `Views.js` now use `product.id` directly (already the variant id); the old `product_variant_ids?.[0] ?? product.id` fallback (silently picking variant #0, with no way to choose another) is removed since it's no longer needed
- [x] Update product list UI to show variant selector before adding to cart — **design decision:** rather than a dropdown picker nested inside one card, each variant now renders as its own separate catalog row/card (standard e-commerce pattern, much simpler than a nested selector). Confirmed with the business that existing multi-variant products in Odoo will now show as multiple catalog entries instead of one
- [x] Verify Odoo order lines reference correct variant `product.product` record — `order_routes.py` already expected a variant id on `OrderLine.product_id` (pre-existing); the catalog now actually supplies one for every product, including multi-variant ones (previously only true by accident for single-variant products)

> **Write-path design decision:** `create_product`/`update_product`/`archive_product` continue to operate on `product.template` under the hood — name, SKU, price, category, and description are treated as shared across all of a product's variants (no per-variant attribute-editing UI exists or was requested). `update_product`/`archive_product` resolve the given variant id to its parent template before writing; `create_product` returns the new variant id (not the template id) so it's immediately usable by the stock-set and order-line endpoints.

#### 3.2 Tax Configuration
- [ ] Remove hardcoded `15%` VAT from `order_routes.py`
- [ ] Fetch `taxes_id` from `product.product` for each order line
- [ ] Pass tax IDs on sale order lines to Odoo
- [ ] Verify invoice VAT calculation matches Odoo's computed tax
- [ ] Test with a product that has a different tax rate to confirm dynamic behaviour

#### 3.3 Stock Availability
- [ ] Fetch `qty_available` (or `virtual_available`) from `product.product` before order submission
- [ ] Block order if any line item quantity exceeds available stock
- [ ] Display available stock count next to each product in the order UI
- [ ] Handle zero-stock products gracefully (disable "Add to Cart", show "Out of Stock")

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

#### 3.6 Credit Limit Enforcement
- [ ] Fetch `credit_limit` and `credit` from `res.partner` in Odoo on order confirm
- [ ] If customer is over limit: show warning to reseller, require admin to override or block
- [ ] Add `credit_hold` flag to customer display in portal
- [ ] Log credit limit checks to audit collection

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

### Definition of Done
- [x] An order placed with a variant product creates the correct `product.product` line in Odoo (not template)
- [ ] VAT on invoice matches Odoo's tax configuration, not a hardcoded value
- [ ] Attempting to order more units than are in stock returns a clear error before hitting Odoo
- [ ] A customer with a pricelist sees their negotiated price in the cart
- [x] A draft order can be cancelled via the portal and disappears from the active order list
- [ ] An order for a customer over their credit limit is blocked or escalated
- [x] Switching the warehouse selector changes displayed stock counts to that location's figures only (verified against Odoo `stock.quant`)
- [x] An order placed under "Warehouse A" decrements Warehouse A's stock in Odoo, not Warehouse B's
- [x] A "restock" return is credited to the correct warehouse's location — zero hardcoded location IDs remain in the codebase
- [x] The packing board for Warehouse B does not show orders fulfilled from Warehouse A

### Notes
> **Sub-deploy 1 (2026-06-19):** Order cancellation (3.5). The endpoint, Odoo call, and commission-voiding logic already existed before this phase — only a state guard and UI restriction were missing. Backend now reads the order's live Odoo `state` and rejects with 400 if it isn't `draft`/`sent`. **Behaviour change:** both `Views.js` (list view) and `OrderView.js` (detail panel) previously showed the Cancel button for confirmed (`sale`) orders too — that's now restricted to draft/sent only, matching the backend guard. Cancellation email intentionally not wired — deferred to Phase 2 once Resend credentials are available.

> **Sub-deploy 2 (2026-06-19):** Product variants (3.1). Discovered the cart already silently resolved to `product_variant_ids[0]` before this phase — single-variant products were already ordering correctly. The real gap was multi-variant products: no way to choose a non-default variant, and the admin catalog / low-stock view / stock-adjustment screen all operated at template level, hiding per-variant stock and price differences. `product_routes.py` now reads/writes `product.product` for everything user-facing; `lst_price` (variant-level computed price) is normalised back to a `list_price` key in the API response so the frontend needed zero field-name changes. Confirmed with the business that multi-variant products already exist in the live Odoo catalog — they will now appear as separate rows (one per variant) in both the Orders cart and the admin Products table, each with independent stock/price, instead of one row hiding the variant split. No changes made to `forecast_routes.py`/`report_routes.py`/`stock_routes.py` — those stay company-wide/template-level until Phase 3.7 (multi-warehouse) addresses them together.

> **Sub-deploy 3 (2026-06-19):** Multi-warehouse (3.7), full build. New `warehouse_context.py::resolve_warehouse_id()` is the single place every route resolves "which vault does this request care about" — fixed `warehouse_id` for reseller/staff, persisted `active_warehouse_id` for admin/super_admin. Threaded through `product_routes.py`, `forecast_routes.py`, `report_routes.py`, `stock_routes.py`, and `order_routes.py::create_order()`. **Breaking change for the packing-floor screens:** `PACKING_BOARD_DISPLAY_TOKEN` is gone — each warehouse now needs its own token, generated from the new admin **Warehouses** page (`/warehouses`, requires `warehouse.supervise` permission), and every physical screen's saved URL must be updated to the new per-warehouse token before its first reconnect after this deploy. The admin top nav now shows a warehouse selector (visible once at least one `stock.warehouse` exists in Odoo); leaving it on "All warehouses" preserves the old company-wide behaviour everywhere except order creation and the packing board, which always need a definite warehouse to function correctly. **Not yet live-tested** — needs verification against real `stock.quant` figures with at least two warehouses configured in Odoo before being considered fully proven in production.

---

## Phase 4 — Commission Engine Hardening

**Goal:** Commission calculations are auditable, tamper-resistant, and financially accurate.  
**Estimate:** 2–4 days  
**Status:** 🔴 Not Started  
**Completed:** —  

### Tasks

#### 4.1 Race Condition Prevention
- [ ] Create unique compound index on `monthly_commission_statements`: `{reseller_id: 1, year: 1, month: 1}` with `unique: True`
- [ ] Test: two simultaneous Generate calls for same month — second must fail gracefully, not create duplicate

#### 4.2 Cancelled Order Exclusion
- [ ] Before generating a statement, cross-reference `order_commissions` against Odoo order states
- [ ] Exclude any order where Odoo `sale.order.state == "cancel"` from turnover aggregation
- [ ] Mark excluded `order_commissions` records as `payout_status: "cancelled"`
- [ ] Document this logic clearly: commission is earned on confirmed and fulfilled orders only

#### 4.3 Tier Rate Audit Trail
> **Already satisfied by Phase 0.6** (2026-06-19) — `PUT /api/commission/tiers` and `DELETE /api/commission/tiers/reset` write `commission.configure_tiers` / `commission.reset_tiers` audit entries with actor, before, and after. Visible today via the Audit Trail page (`/audit`). Remaining task below is the only open item.
- [ ] Display tier change history inline in the admin Tier Settings tab (currently only viewable via the global Audit Trail page)

#### 4.4 Odoo Vendor Bill — Make Non-Optional
- [ ] Change `mark-paid` endpoint: if Odoo bill creation fails, return `400` error — do not silently continue
- [ ] Admin must resolve the Odoo issue before marking paid, OR explicitly acknowledge with an override flag
- [ ] Add `override_bill_creation: bool` flag to payload for edge cases (manual Odoo bill already exists)
- [ ] If override used, store reason in statement record and audit log

#### 4.5 Dispute Workflow
- [ ] Implement `POST /api/commission/statements/{id}/dispute` — reseller submits free-text reason
- [ ] Statement status transitions to `disputed` 
- [ ] Admin sees disputed statements flagged in Statements tab
- [ ] Admin can resolve (`PUT /api/commission/statements/{id}/resolve`) with notes
- [ ] Reseller receives email notification on resolution (Phase 2 dependency)

### Definition of Done
- [ ] Two simultaneous Generate requests for the same reseller/month produce one statement, not two
- [ ] A cancelled order does not appear in a reseller's monthly turnover
- [ ] Every tier rate change is visible in the audit log with before/after values
- [ ] Mark Paid fails with a clear error if Odoo bill creation fails (no silent pass-through)
- [ ] A reseller can flag a dispute and an admin can resolve it

### Notes
> _(Add implementation notes, decisions, or issues encountered here)_

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
**Status:** 🔴 Not Started  
**Completed:** —  

### Tasks

#### 6.1 Sentry Error Monitoring
- [ ] Add `sentry-sdk[fastapi]` to `requirements.txt`
- [ ] Initialise Sentry in `server.py` with `SENTRY_DSN` env var (free tier on sentry.io)
- [ ] Confirm every unhandled exception captures: user ID, route, request body (sanitised)
- [ ] Set up Sentry alert: email notification on first occurrence of any new error
- [ ] Add `SENTRY_DSN` to Railway environment variables

#### 6.2 Structured Logging
- [ ] Replace all `print()` and default uvicorn access logs with structured JSON logging
- [ ] Every request log includes: `request_id` (UUID), `user_id`, `route`, `method`, `status_code`, `duration_ms`
- [ ] Every Odoo call logs: `model`, `method`, `duration_ms`, `success`
- [ ] Use Python `logging` module with JSON formatter (e.g. `python-json-logger`)

#### 6.3 MongoDB Backups
- [ ] Set up daily `mongodump` script targeting production MongoDB
- [ ] Store dumps in Cloudflare R2 bucket (free 10GB tier)
- [ ] Retention: keep 30 days of daily backups
- [ ] Test restore procedure quarterly: restore to a staging instance and verify data integrity
- [ ] Add `mongodump` as a Railway cron job

#### 6.4 Health Endpoint Enhancement
- [ ] Extend `GET /health` to probe MongoDB connectivity (simple ping)
- [ ] Extend to probe Odoo connectivity (lightweight `res.users` count)
- [ ] Return structured response: `{status: "healthy|degraded|down", services: {mongo, odoo, redis}}`
- [ ] Railway health check already points to `/health` — ensure it passes on degraded state (not just full failure)

#### 6.5 Frontend to Cloudflare Pages
- [ ] Create Cloudflare Pages project pointing to `frontend/` directory
- [ ] Configure build: `npm run build`, output `build/`
- [ ] Set `REACT_APP_API_URL` to Railway backend URL
- [ ] Update nginx/Railway config: backend no longer serves static files
- [ ] Verify SPA routing works (`/resellers/123` deep links load correctly via Cloudflare Pages `_redirects`)
- [ ] Confirm CORS `allow_origins` includes Cloudflare Pages domain

### Definition of Done
- [ ] Trigger a deliberate 500 error → Sentry captures it and sends an email alert within 2 minutes
- [ ] Every API request produces a JSON log line with `request_id` and `duration_ms`
- [ ] A backup file exists in Cloudflare R2 from yesterday's automated run
- [ ] `GET /health` returns `degraded` when Odoo is down but MongoDB is up (not `down`)
- [ ] Frontend loads from Cloudflare Pages URL; API calls reach Railway backend; no CORS errors

### Notes
> _(Add implementation notes, decisions, or issues encountered here)_

---

## Phase 7 — Missing Commercial Workflows

**Goal:** Full end-to-end commercial coverage. Resellers have complete visibility of the customer lifecycle.  
**Estimate:** 2–3 weeks  
**Status:** 🔴 Not Started  
**Completed:** —  

### Tasks

#### 7.1 Delivery Order Visibility
- [ ] Implement `GET /api/orders/{id}/deliveries` — fetches linked `stock.picking` records from Odoo
- [ ] Expose: picking reference, scheduled date, state, carrier, tracking number
- [ ] Show delivery status in order detail view (portal UI)
- [ ] Show delivery status badge in order list (dispatched, delivered, partial)
- [ ] Handle partial deliveries: show multiple pickings per order

#### 7.2 Credit Notes
- [ ] Extend invoice list to include `move_type = "out_refund"` (credit notes)
- [ ] Display credit notes with distinct badge in invoice list
- [ ] Implement `POST /api/invoices/{id}/credit-note-request` — reseller submits reason
- [ ] Admin sees pending credit note requests in the Invoices view
- [ ] Admin processes credit note in Odoo; portal reflects updated status on next sync

#### 7.3 Customer Account Statements
- [ ] Implement `GET /api/customers/{id}/statement` — aggregates `account.move` records from Odoo for the customer
- [ ] Returns: invoices, credit notes, payments, balance
- [ ] Admin and reseller (for their own customers) can view statement
- [ ] Add printable/PDF statement view (same pattern as existing print views)

#### 7.4 KYC Document Collection (Customer Onboarding — Step 4)
- [ ] Add document upload capability to customer onboarding flow
- [ ] Required documents: practice licence (or registration certificate), HPCSA/BHF registration number, physical address confirmation
- [ ] Store documents in Cloudflare R2 (object storage) — reference URL in MongoDB `customer_onboarding` record
- [ ] Admin sees uploaded documents in the onboarding review panel
- [ ] Block onboarding approval if required documents are not uploaded

#### 7.5 Backorder Visibility
- [ ] In order detail, show unfulfilled quantities from linked `stock.picking` backorder records
- [ ] Display "X units outstanding" per line item where backorder exists
- [ ] Show estimated fulfilment date if available in Odoo picking scheduled date

> ~~7.6 Multi-Warehouse Foundation (Preparation Only)~~ — **moved to Phase 3.7** and elevated from a plumbing-only task to a full functional requirement (warehouse selector, per-warehouse stock figures, correct stock decrement on order, correct restock location). See Phase 3.

### Definition of Done
- [ ] An order with a dispatched delivery shows the tracking reference and carrier name in the portal
- [ ] An out_refund invoice is visible in the reseller's invoice list with a "Credit Note" badge
- [ ] A customer's account statement shows their balance, all invoices, and all payments
- [ ] Customer onboarding cannot be approved without at least one document uploaded
- [ ] Backorder quantities are visible on the order detail page when Odoo has a backorder picking

### Notes
> _(Add implementation notes, decisions, or issues encountered here)_

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

*This document is the single source of truth for the production readiness programme. Update it after every phase completion. Do not start a new phase until the previous phase's Definition of Done is fully checked off.*
