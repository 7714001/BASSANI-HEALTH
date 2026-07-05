# Bassani Health Portal — Production Readiness Roadmap

**System:** Bassani Health B2B Sales & Reseller Portal  
**Stack:** FastAPI · React 18 · MongoDB · Odoo v17 (XML-RPC) · Railway  
**Last Updated:** 2026-07-05  
**Overall Status:** 🟡 Pre-Production — Phases 0, 1, 2, 4, 6, 7, 9 complete; Phase 3 in progress (2 live VAT verification items remaining); Phase 8 DoD 9/10 complete — only staff account creation outstanding (operational, no code required); Phase 10 responsive UI in progress (10.0–10.4 complete, 10.5 large-screen caps pending, 10.6 pagination complete); Phase 11 dual-mailbox inbox live — 11.C.1 doc progress tracking, 11.C.2 inbox UX hardening, 11.C.3 reseller onboarding ownership gap (three-tier fix: auto-draft application, reseller stamping, Tier 3 gate, awaiting_docs approval flow) — all deployed 2026-07-05; Phase 12 in progress (12.0 backend foundation complete)  

---

## Progress Overview

| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| 0 | Roles, Permissions & Identity Foundation | 🟢 Complete | Sub-deploys 1–4 complete — 2026-06-19 |
| 1 | Security Hardening | 🟢 Complete | All items complete — 2026-06-29 (1.2 CORS + 1.5 email OTP 2FA) · 1.8 Self-Serve Password Reset — 2026-07-05 |
| 2 | Email Engine | 🟢 Complete | All templates + wiring complete — 2026-06-23 · Resend domain verified — 2026-06-29 · 2.8 Email Routing Configuration (super admin) — 2026-07-02 |
| 3 | Core Odoo Integration | 🟡 In Progress | 3.1–3.3, 3.5–3.8 complete; 3.2 needs live VAT verification; 3.4 deferred (pricelists not in use); 3.5 cancellation email deferred to Phase 2 — 2026-06-19 |
| 4 | Commission Engine Hardening | 🟢 Complete | All 5 items (4.1–4.5) complete — 2026-06-23 |
| 5 | Reliability & Resilience | 🔴 Not Started | — |
| 6 | Observability & Operations | 🟢 Complete | 6.1–6.4 complete — 2026-06-23 · 6.5 (Cloudflare Pages) deferred |
| 7 | Missing Commercial Workflows | 🟢 Complete | 2026-06-24 · 7.7 — 2026-07-01 · 7.4 — 2026-07-01 · 7.8 + 7.9 — 2026-07-02 · 7.10 Balance Payment — 2026-07-04 |
| 8 | Order Workflow & Ticketing System | 🟡 In Progress | Sub-deploys 1–13 (8.1–8.14 code complete, three-tier reseller onboarding fix) — 2026-07-05 |
| 9 | Go-Live Infrastructure | 🟢 Complete | portal.bassanihealth.com live, Resend domain verified, all Railway vars confirmed — 2026-06-29 |
| 10 | Responsive UI | 🟡 In Progress | 10.0–10.4 complete (login fix, shell overflow, column hiding, form grids, quote builder) — 2026-06-26 · 10.5 large-screen caps pending · 10.6 profile pagination + reseller nav grouping — 2026-07-02 |
| 11 | Mailbox Integration | 🟢 Live (dual-mailbox) | Graph code built 2026-06-29 · Azure credentials wired 2026-07-05 · IMAP/SMTP live 2026-07-04 · Two-panel inbox UI — 2026-07-05 · 11.C.1 doc progress tracking · 11.C.2 inbox UX hardening · 11.C.3 reseller onboarding ownership gap (three-tier fix) · 11.C.4 save-to-application + approval doc transfer (reference-only, no copy) — 2026-07-05 |
| 12 | Barcode Integration | 🟡 In Progress | Starting 12.0 — 2026-06-29 |
| 13 | Production & Cultivation Module (GrowerIQ In-House) | 🔵 Concept — Needs Scoping | Architecture defined, SAHPRA requirements not yet obtained |

**Status Key:** 🔴 Not Started · 🟡 In Progress · 🟢 Complete · ⏸ Deferred · 🔵 Concept (needs scoping)

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
**Status:** 🟢 Complete  
**Completed:** Sub-deploy 1 (1.1, 1.3, 1.4, 1.6) — 2026-06-19 · Sub-deploy 2 (1.7 Forced Password Reset) — 2026-06-23 · Sub-deploy 3 (1.2 CORS lockdown + 1.5 email OTP 2FA) — 2026-06-29 · Sub-deploy 4 (1.8 Self-Serve Password Reset) — 2026-07-05  

### Tasks

#### 1.1 JWT Secret Enforcement
- [x] Add startup check in `server.py` — fail with clear error if `JWT_SECRET == "change-me-in-production"`
- [x] Document minimum requirements: 32+ character random string
- [x] Update `.env.example` with `JWT_SECRET=<run: openssl rand -base64 48>` _(file didn't exist — created)_

#### 1.2 CORS Lockdown
- [x] Replace `allow_origins=["*"]` in `server.py` with `settings.cors_origins_list()`
- [x] Set `CORS_ORIGINS=https://portal.bassanihealth.com` in Railway environment variables
- [x] Verify preflight requests work correctly on frontend after change

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

#### 1.5 2FA for All Accounts — Email OTP
> **Implemented as email OTP** (2026-06-29) rather than the originally-planned TOTP/authenticator-app flow. Email OTP requires no user setup, leverages the now-verified Resend domain, and applies to every account that has an email address stored (not just admins — all portal roles). The TOTP routes (`twofa_routes.py`) remain as dead infrastructure; the live flow is entirely in `auth_routes.py` + `verify-otp`.
- [x] Email OTP 2FA implemented — 6-digit code, 10-minute TTL, 3-attempt limit, SHA-256 hash at rest
- [x] `POST /api/auth/login` returns `{otp_required: true, otp_session_id}` instead of JWT when 2FA triggers; JWT only issued after `POST /api/auth/verify-otp`
- [x] `otp_sessions` MongoDB collection with TTL index for automatic cleanup
- [x] `send_otp_email()` added to `email_service.py` using the branded template
- [x] `SUPER_ADMIN_EMAIL` Railway var + startup writes email onto super admin document
- [x] `REQUIRE_2FA_ADMIN=true` set in Railway — 2FA active for all accounts with email
- [x] Login.js OTP entry screen — numeric-only input, large monospace display
- [x] Applies to any account with a stored email — accounts without email fall through to normal login

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

#### 1.8 Self-Serve Password Reset

**Goal:** Any portal user with a registered email address can recover their own account without contacting an admin, using a secure time-limited email link that follows NIST SP 800-63B guidance.

- [x] `POST /api/auth/forgot-password` — rate-limited 3/hour per IP; looks up user by email; generates `secrets.token_urlsafe(32)` (256-bit entropy); stores SHA-256 hash in `password_reset_tokens` collection with 15-minute TTL; fires `send_password_reset_email()` via Resend as a background task; always returns `{"success": true}` regardless of whether email exists (prevents enumeration)
- [x] `POST /api/auth/reset-password` — rate-limited 10/hour per IP; validates token by hash lookup and TTL; deletes token immediately on first valid use (single-use); updates password (bcrypt); bumps `token_version` on the user document; clears `must_change_password`; audit-logs `user.password_reset_completed`
- [x] `token_version` field — integer on every user document, included as `tv` claim in all issued JWTs; `get_current_user` rejects any token whose `tv` does not match the current DB value; bumped on every password reset to instantly invalidate all active sessions (stateless JWT revocation without a blocklist)
- [x] `send_password_reset_email()` in `email_service.py` — branded template using `_h1`, `_p`, `_button`, `_divider`; reset link button; security note warning not to share the link; sent via Resend (system notification path, not connected mailbox)
- [x] `ForgotPassword.js` — public route `/forgot-password`; email input; same success screen regardless of result; "Back to sign in" link; errors swallowed client-side to prevent enumeration
- [x] `ResetPassword.js` — public route `/reset-password?token=...`; guards against missing token; new password + confirm fields; on success shows confirmation screen noting all other sessions have been signed out; links back to sign-in
- [x] `Login.js` — "Forgot your password?" link below the sign-in button linking to `/forgot-password`
- [x] Both new routes redirect authenticated users to `/` (cannot access reset flow while logged in)

**Security properties:** Token stored hashed at rest; 15-minute TTL; single-use deletion; enumeration-safe response; rate-limited; full session invalidation via `token_version`; both request and completion audit-logged with actor and timestamp.

### Definition of Done
- [x] Cannot log in as admin with `admin123` on any deployed environment _(legacy account auto-deactivated on startup)_
- [x] Browser console shows no CORS errors from the correct domain
- [x] Login attempt #6 returns 429 within the 15-minute window
- [x] Any account with an email address is challenged with an email OTP on login
- [x] Application startup fails immediately if JWT secret is default value
- [x] A newly created user account is intercepted at first login and cannot access the portal until they set a new password
- [x] Admin-initiated password reset re-triggers the same forced-change gate
- [x] Self-serve password reset link expires after 15 minutes and cannot be reused
- [x] Completing a password reset invalidates all other active sessions for that user

### Notes
> **Sub-deploy 4 (2026-07-05):** 1.8 Self-Serve Password Reset. Two new public routes: `POST /api/auth/forgot-password` (enumeration-safe, rate-limited 3/hour, 15-min token TTL, SHA-256 hash at rest, Resend delivery) and `POST /api/auth/reset-password` (single-use token deletion, bcrypt update, `token_version` bump). `token_version` added to user documents and included as `tv` claim in all new JWTs; `get_current_user` rejects mismatched `tv`, providing stateless session invalidation after reset. Frontend: `ForgotPassword.js` and `ResetPassword.js` views on public routes; "Forgot your password?" link added to `Login.js`.

> **Sub-deploy 2 (2026-06-23):** 1.7 Forced Password Reset. `must_change_password: True` is now set on `POST /api/users/` and `POST /api/users/{id}/reset-password`. `_user_payload()` exposes the flag in every login/me response. New `POST /api/auth/change-password` verifies the current password (bcrypt), validates min-8-char and differs-from-current rules, updates the hash, and clears the flag — audit-logged as `user.change_password`. Frontend: `ProtectedRoute` now redirects authenticated users with `must_change_password` to `/change-password` before any other page renders; a new `AuthRequired` wrapper used by that specific route lets you be authenticated without triggering the redirect loop; new `ChangePassword.js` view handles the form. Existing accounts are unaffected — the field's absence is treated as `False` everywhere.

> **Sub-deploy 3 (2026-06-29):** 1.2 CORS lockdown + 1.5 email OTP 2FA. `allow_origins` in `server.py` now calls `settings.cors_origins_list()` — `CORS_ORIGINS=https://portal.bassanihealth.com` set in Railway. 2FA implemented as email OTP (not TOTP) — any account with a stored email gets challenged on login when `REQUIRE_2FA_ADMIN=true`. Flow: login validates password → if 2FA triggers, OTP generated, SHA-256 hashed, stored in `otp_sessions` with 10-minute TTL index, emailed via Resend → login returns `{otp_required: true, otp_session_id}` — no JWT yet → frontend shows OTP entry screen → `POST /api/auth/verify-otp` validates code and issues JWT. 3-attempt lockout; session auto-deleted on success or exhaustion; TTL index auto-purges expired sessions. `SUPER_ADMIN_EMAIL` Railway var stamps email onto super admin document at startup so the super admin account is covered. `config.py` `portal_url` default updated to `portal.bassanihealth.com`. `index.html` CSS-only spinner on `#root:empty` eliminates white-page flash before React loads.

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
- [x] Verify sending domain is verified in Resend dashboard — `bassanihealth.com` verified 2026-06-29
- [x] Confirm free tier limit (3,000/month, 100/day) is sufficient for current volume; upgrade to Pro ($20/month) if needed

#### 2.8 Email Routing Configuration (Super Admin) — Added 2026-07-02

**Goal:** Allow a super admin to configure which addresses receive automated notifications without requiring Railway env var changes. Three routing categories are configurable from the portal itself.

- [x] New MongoDB collection `portal_settings`, document `{ _id: "email_routing" }` — stores the three routing arrays
- [x] `backend/routes/settings_routes.py` — `GET /api/settings/email-routing` (returns config, super admin gated) and `PUT /api/settings/email-routing` (upserts, super admin gated)
- [x] `get_email_routing()` shared async helper — imported by route files that send notification emails; reads from MongoDB, falls back to `SUPPORT_EMAIL` env var if unconfigured; single import point, no duplication
- [x] Three configurable routing lists:
  - `application_submitted_to` — who receives new customer application alerts (default: `SUPPORT_EMAIL` env var)
  - `order_ready_extra_to` — extra recipients for "order ready for collection" (warehouse supervisors always auto-detected; this adds distribution lists or staff without portal accounts)
  - `order_cc` — CC'd on all reseller-facing order placed and order confirmed emails (useful for an ops inbox)
- [x] `email_service.py` `_send()` gained `cc` parameter; `send_onboarding_submitted` gained `to` override; `send_order_placed` and `send_order_confirmed` gained `cc`
- [x] Call sites updated: `onboarding_routes.py`, `packing_board_routes.py`, `order_routes.py` — each fetches routing config and applies appropriate `to`/`cc` override before the `background_tasks.add_task()` call
- [x] `frontend/src/views/EmailSettings.js` — super admin only view at `/settings/email-routing`; `EmailTagInput` component (tag pills, Enter/comma to add, Backspace to remove, email format validation); three `RoutingSection` cards with descriptions; amber "Super Admin only" info banner
- [x] `superAdminOnly: true` nav item flag in `ADMIN_NAV` (in `UI.js`) — filter skips the item for non-super-admin users; only super admins see "Email Routing" in the sidebar
- [x] User manual updated: Step 8a section and full Automated Email Reference table (14 emails, trigger, recipient)

### Definition of Done
- [x] Place a test order → reseller receives confirmation email within 60 seconds
- [x] Admin confirms order → reseller and customer both receive emails
- [x] Approve a customer onboarding → reseller and customer both receive emails
- [x] Generate a commission statement → reseller receives summary email
- [x] Mark statement as paid → reseller receives payment confirmation
- [x] Create a new user → user receives welcome email
- [x] Packer ticks last item on an order → supervisor(s) with email on file receive a "ready for collection" notification
- [x] All emails render correctly on mobile and desktop clients — verified via 2FA OTP emails post domain confirmation 2026-06-29
- [x] No email sending blocks or slows the API response (all fire via BackgroundTasks)

### Notes
> **2026-06-23:** All templates and route wiring complete. Dev account uses nick@rubixdevelopment.co.za Resend key — swap to client's key when credentials are available and verify the bassanihealth.com sending domain in the Resend dashboard. Graceful degradation is in place: if `RESEND_API_KEY` is unset, emails log a mock message and skip without crashing.

> **2.8 (2026-07-02):** Email routing configuration. New `backend/routes/settings_routes.py` with `GET` / `PUT /api/settings/email-routing` (super admin gated via `_require_super_admin` dependency). `get_email_routing()` is a shared async helper imported by the three route files that fire notification emails (`onboarding_routes.py`, `packing_board_routes.py`, `order_routes.py`) — importing from a sibling route file is slightly unusual but avoids creating a new shared module for a single helper. `email_service.py` `_send()` gained a `cc` parameter; `send_onboarding_submitted` can now accept a `to` override list; `send_order_placed` and `send_order_confirmed` accept `cc`. Frontend: `EmailSettings.js` (new view) with `EmailTagInput` tag-pill component (email validation, duplicate detection, Backspace-to-remove-last). Sidebar: "Email Routing" nav item in the Admin section with `superAdminOnly: true` flag; `UI.js` nav filter checks this flag as the first gate before any permission check. All changes take effect immediately on next save — no server restart, no Railway env var change needed.

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
**Status:** 🟢 Complete  
**Completed:** 2026-06-23 · 7.4 — 2026-07-01 · 7.8 — 2026-07-02  

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
- [x] Provision Cloudflare R2 bucket (`bassani-health-docs`) — 5 Railway env vars set (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_ENDPOINT`)
- [x] `services/r2_client.py` — async boto3 wrappers (`r2_put`, `r2_delete`, `r2_presign`) using `run_in_executor` to avoid blocking the event loop
- [x] Step 0 added to onboarding wizard (before existing 4 steps) — Section A: download/email Bassani template docs; Section B: 5 named upload slots with per-slot spinner, remove button, progress counter
- [x] 4 Bassani template PDFs served from `backend/static/onboarding-templates/` via `GET /api/onboarding/templates/download/{filename}`; blob-streamed to browser via axios for clean filename on download
- [x] `POST /api/onboarding/templates/email` — sends all 4 template PDFs as Resend attachments to a given customer email; called from the wizard email input
- [x] `POST /api/onboarding/documents/upload?session_id=&doc_type=` — uploads file to R2 under `onboarding/sessions/{session_id}/{doc_type}.ext`; returns metadata stored in component state
- [x] `DELETE /api/onboarding/documents/{session_id}/{doc_type}` — removes from R2 before submission
- [x] `OnboardingApplication` model extended with `document_session_id` + `documents[]`; submission payload includes both; backend enforces all 5 doc types present before accepting
- [x] `GET /api/onboarding/{app_id}/documents` — generates 1-hour presigned R2 URLs for each uploaded document; gated by `customers.approve_onboarding`
- [x] Admin ReviewModal (`CustomerApplications.js`) — new "Supporting Documents" section loads and renders presigned download links for each uploaded file
- [x] `PUT /api/onboarding/{app_id}/approve` — hard-blocks approval if any of the 5 required document types are missing from the application record

> **Required documents (5, all mandatory):** Signed Store Onboarding Agreement · Signed Customer Information Form · Signed NDA · Signed TQA Document · CIPC Company Registration Certificate

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

#### 7.7 — Reseller Product Catalog Configuration

**Goal:** Admin controls which products (at variant level) are visible to resellers. Resellers only see and can order products explicitly added to the catalog. Admins see all products regardless.

**Architecture:** Portal-layer concern — visibility control is not an Odoo concept. A single `reseller_catalog` MongoDB document holds the list of allowed `product.product` IDs. Stock, price, and tax data all still come from Odoo; only visibility is controlled at the portal layer. Same philosophy as `sales_tickets` over `sale.order` — MongoDB adds the portal layer, Odoo retains the source-of-truth records.

- [x] `GET /api/reseller-catalog/` — returns `{ product_ids: [...] }` for any authenticated user (resellers use it to know what they can see; not needed in practice since the filter is server-side, but available)
- [x] `POST /api/reseller-catalog/toggle/{product_id}` — adds product if absent, removes if present; requires `products.manage`; audit-logged as `reseller_catalog.added` / `reseller_catalog.removed`
- [x] `list_products()` — if caller role is `reseller`, fetches catalog IDs from MongoDB and appends `("id", "in", catalog_ids)` to the Odoo domain before querying; returns empty list if catalog is unconfigured (safe default — resellers see nothing until explicitly configured)
- [x] `get_product_by_barcode()` — same catalog gate applied to barcode lookups for reseller-role callers
- [x] `reseller_catalog` MongoDB collection — single document `{ _id: "global", product_ids: [int, ...], updated_by }`, upserted on every toggle
- [x] Products admin table — new **Reseller** column (toggle switch per row, `hidden sm:table-cell`) visible only to `products.manage` users; optimistic UI update, confirmed by server response; audit-logged on every change

**Design decisions:**
- **Global catalog, not per-reseller** — all resellers see the same configured set. Per-reseller overrides can be layered on top later without breaking this structure.
- **Variant level** — `product.product` IDs, not template IDs. Allows selling 3g bags but not 5g of the same strain if needed. Consistent with how the rest of the portal treats products (Phase 3.1).
- **Unconfigured = empty** — if no products have been toggled in, resellers see nothing. Safer than showing everything by default.
- **No new page** — toggle lives in the existing Products table column. Admin sees catalog status alongside stock and price in context.

#### 7.8 — Admin Customer Creation & Duplicate Prevention

> **Added 2026-07-02** — Admin-side customer creation was missing several compliance fields and had no duplicate guard. The reseller document upload flow also had no admin equivalent, meaning admins had to work around the reseller wizard to get documents onto a customer profile.

**Goal:** Enforce clean data at the point of customer creation. Every new Odoo customer created through the portal must pass a duplicate check (hard block, no override), carry VAT registration and postal code for compliance, and arrive with all five signed onboarding documents attached. Reseller creation gets the same document step, skipped automatically when the linked customer already has documents on file.

- [x] `GET /api/customers/check-duplicate` — fast preflight check; searches Odoo `res.partner` for an exact email or VAT match across active customers; returns `{ duplicates: [...] }` with the conflicting partner's name/email/VAT; used by the Add Customer wizard's search step
- [x] `GET /api/customers/{id}/has-documents` — checks the `customer_documents` collection and the linked onboarding application for any uploaded files; returns `{ has_documents: bool }`; used by the reseller creation wizard to decide whether to require document upload for the selected customer
- [x] `PUT /api/onboarding/{app_id}/approve-link` — alternative approval path for applications that surface a duplicate at review time: links the application's reseller to an *existing* Odoo partner instead of creating a new one; marks the application approved and sends the same approval email; audit-logged as `onboarding.approve_link` with `linked_to_existing: true`; resolves the catch-22 where a well-documented application is blocked only because the customer already exists
- [x] `CustomerCreate` Pydantic model extended with `vat`, `document_session_id`, and `documents[]` fields
- [x] Hard duplicate block in `create_customer` (admin path only) — checks Odoo for a matching email or VAT before any write; returns HTTP 409 with the conflicting customer's details if matched; no override available; reseller applications are exempt (they go through the onboarding approval flow, which has its own duplicate check)
- [x] VAT registration number (`vat`) and postal code (`zip`) written to Odoo on admin-side customer creation — compliance requirement
- [x] Staged onboarding documents persisted into `customer_documents` collection on customer creation — every admin-created customer arrives with all five signed documents already on their profile, with `doc_type`, `r2_key`, `uploaded_by`, and timestamp recorded
- [x] Hard duplicate check added inside `approve_application` before Odoo partner creation — catches the case where a matching partner appears between application submission and admin approval; returns 409 directing admin to use `approve-link` instead
- [x] `upload_document` and `delete_document` in `onboarding_routes.py` extended to allow admin users alongside resellers; admin identity check uses `customers.manage` permission rather than role string
- [x] **Add Customer wizard** redesigned as a 3-step flow (replaces the single-form modal):
  - **Step 1 — Search:** live name search against Odoo; "Continue" button hard-disabled until the search returns zero results; amber warning shown when results are present; prevents a near-duplicate from slipping through on a name variation
  - **Step 2 — Documents:** upload panel for all 5 required document types (`store_onboarding_agreement`, `customer_information_form`, `nda`, `tqa`, `cipc_certificate`); per-slot upload/remove with spinner and R2 staging; progress counter (`{n} of 5 uploaded`); "Continue to Details" disabled until all 5 slots are filled
  - **Step 3 — Details:** VAT registration number, email, phone, credit limit, customer type, street address, city, postal code, Section 21 checkbox; responsive grid layout
  - Step indicator bar at top with green checkmarks for completed steps
- [x] `ResellerCreate` Pydantic model extended with `document_session_id` and `documents[]`
- [x] Add Reseller modal extended with a conditional document upload step:
  - When no customer is selected, or the selected customer has no documents on file: shows the 5-doc upload panel (same pattern as the customer wizard)
  - When the selected customer already has documents on file: shows a green "Documents on file — upload not required" confirmation banner; upload step skipped
  - The `has-documents` check fires immediately when a customer is selected; conservative null handling (`rSellerCustHasDocs !== true`) shows the upload panel until the check confirms otherwise
- [x] `effective_partner_id` pattern in `create_reseller` — if no Odoo partner is linked but documents were uploaded, a new `res.partner` is created in Odoo using the reseller's name/email/VAT before the documents are persisted; eliminates the edge case where staged documents have no partner to attach to

**Design decisions:**
- **Duplicate block is a hard stop, not a warning with an override** — the business explicitly decided against an override; dirty data entering Odoo is more expensive to correct than a blocked entry that sends admin to investigate first.
- **Admin document upload reuses the existing R2 staging path** (`onboarding/sessions/{session_id}/{doc_type}{ext}`) — no new infrastructure; the `upload_document` endpoint already handles R2 correctly and only needed an admin identity check added.
- **`approve-link` is the resolution path, not rejection** — when an application surfaces a duplicate at approval time, the admin links it to the existing partner rather than rejecting a properly-documented application. The reseller gets their customer linked; the duplicate is never created.
- **Customer banking details are not collected** — Bassani pays resellers (commission); customers pay Bassani (invoicing). Banking details are a reseller-level concern only, not a customer-level one.

### Definition of Done
- [x] An order with a dispatched delivery shows the tracking reference and carrier name in the portal
- [x] An out_refund invoice is visible in the reseller's invoice list with a "Credit Note" badge
- [x] A customer's account statement shows their balance, all invoices, and all payments
- [x] Customer onboarding cannot be approved without all 5 required documents uploaded (enforced at both submission and approval)
- [x] Backorder quantities are visible on the order detail page when Odoo has a backorder picking
- [x] Clicking the history icon on any product shows its complete stock movement trail — receipts, deliveries, transfers, and adjustments — with move type labels and ± quantities
- [x] Admin can toggle any product variant into/out of the reseller catalog from the Products table
- [x] A reseller's product list and order cart only show catalog products — no Odoo trip needed to enforce this
- [x] Toggling a product on/off produces an audit log entry with actor identity
- [x] A new customer cannot be created via the admin portal if any existing Odoo customer shares their email or VAT number — hard 409, no override
- [x] The Add Customer wizard blocks progression past Step 1 until the name search returns zero results
- [x] Every admin-created customer requires all 5 signed onboarding documents before the create button is enabled, and those documents land on the customer profile immediately after creation
- [x] An application that would create a duplicate customer can be resolved via `approve-link` — linking the reseller to the existing Odoo partner without creating a duplicate
- [x] Admin users can upload and delete documents via the onboarding upload endpoints (not reseller-only)
- [x] VAT registration number and postal code are captured on the customer creation form and written to Odoo

### Notes
- 7.8 complete 2026-07-02 — Admin customer creation overhauled: 3-step wizard (search → docs → details) replaces the previous single-form modal. Hard duplicate block on email and VAT at both the frontend (search step gated) and backend (HTTP 409 before any Odoo write). VAT and postal code added as compliance fields. All 5 onboarding documents now required for every admin-created customer, staged to Cloudflare R2 and persisted to `customer_documents` on creation. The `upload_document` endpoint opened to admin users (was reseller-only). Reseller creation wizard extended with the same document step, conditionally skipped when the linked customer already has documents on file. New `approve-link` endpoint resolves the case where an application surfaces a duplicate at approval time — admin can link the application to the existing Odoo partner rather than rejecting a fully-documented application. Banking details deliberately excluded from customer creation — Bassani pays resellers (commission); customers pay Bassani (invoicing); banking is a reseller-level concern only.
- 7.1 + 7.5 were implemented together — delivery endpoint returns both regular and backorder pickings with per-line fulfilment. UI surfaces in both OrderView.js (reseller order detail) and SalesTickets.js (staff ticket detail).
- 7.2 credit note requests are tracked in MongoDB (not Odoo) since Odoo credit note creation is a finance-team action; portal tracks the request lifecycle (pending → acknowledged).
- 7.4 complete 2026-07-01 — Cloudflare R2 provisioned (`bassani-health-docs` bucket). Document flow: reseller downloads/emails 4 Bassani template PDFs to customer → customer signs → reseller uploads 5 signed docs (4 templates + CIPC) → admin reviews with presigned download links → approval gated on all 5 being present. MongoDB backups are handled natively by Railway — R2 is used for document storage only (roadmap infrastructure table updated accordingly).
- 7.6 added after business meeting 2026-06-24 — they recognised the value of Odoo's traceability screen and wanted it surfaced in the portal. Inter-warehouse transfers are covered automatically via the location `usage=internal` classification.
- 7.7 added 2026-07-01 — came out of a business meeting. Resellers were seeing all Odoo products regardless of relevance. Implemented as a portal-layer MongoDB catalog config (not an Odoo change) consistent with the middleware architecture principle. Toggle column on Products table; server-side filter on all reseller product API calls.
- 7.9 complete 2026-07-02 — Suppliers identified as an active Odoo concept (cannabis cultivators, gummy manufacturers) with no portal visibility. Lightweight read-only supplier layer added as Phase 13 foundation. New `suppliers.view` / `suppliers.manage` permission domain; finance role gets view by default. Supplier list (`/suppliers`) and 360 profile (`/suppliers/:id`) surface partner details, vendor bills, purchase orders, goods receipts, and Odoo-configured products supplied. No write operations — portal reads from Odoo; Phase 13 will add goods receipt and batch traceability workflows on top of this.

#### 7.9 — Supplier Layer (Phase 13 Foundation)

> **Added 2026-07-02** — Bassani's Odoo instance has active suppliers (cannabis cultivators and gummy manufacturers) with no visibility in the portal. The field-parity principle requires any entity visible in Odoo to be surfaceable in the portal. Phase 13 will need supplier-linked batch traceability; this phase builds the foundation it can integrate into.

**Goal:** Read-only supplier visibility in the portal, gated behind a new `suppliers.view` permission. Finance can see what Bassani owes suppliers and the purchase history behind it. Phase 13 plugs batch/lot receipts into the Goods Receipts section without needing a new supplier layer.

**Design decisions:**
- **Read-only** — no PO creation or vendor bill management in the portal yet. Procurement staff use Odoo directly; this phase is about visibility, not write-back.
- **New permission domain** — `suppliers: { view, manage }` added to `DEFAULT_ADMIN_PERMISSIONS`, `FULL_PERMISSIONS`, and all role defaults. Finance gets `view: true` by default. All other ticket roles default to `view: false`.
- **Sidebar placement** — "Suppliers" sits below "Customers" in the Main section, sharing the same conceptual space (external parties in Odoo's partner registry).
- **Phase 13 hook** — the Goods Receipts section (`stock.picking` incoming, state=done) is exactly the entry point for batch traceability. Phase 13 adds a lot/batch column to those rows and links them to the cultivation module.
- **Products Supplied** — sourced from `product.supplierinfo`, deduplicated by template. Shows which SKUs Bassani sources from each supplier. Archived templates shown with a badge rather than hidden.

#### 7.10 — Balance Payment Registration — Added 2026-07-04

**Goal:** Finance can register the remaining balance payment against the full sale invoice directly from the Sales Ticket, without opening Odoo. Before this, the only portal payment action was deposit registration (which creates a down payment invoice). The final balance — typically due on collection — had no portal path, forcing finance to open Odoo's accounting module to register it.

**Context:** Two separate invoices exist per confirmed order: (1) a down payment invoice created and paid via "Register Deposit"; (2) a full delivery invoice (`advance_payment_method: "delivered"`) created and posted at order confirmation in `order_routes.py`. The deposit partially reconciles against the full invoice in Odoo, reducing its `amount_residual`. "Register Balance Payment" targets this full invoice for the remaining balance.

- [x] `GET /api/tickets/{ticket_id}/invoice-balance` — reads all `invoice_ids` from the Odoo sale order; filters for `out_invoice` type; returns the largest-amount invoice (the full SO invoice, not the smaller down payment invoice) with `amount_total`, `amount_residual`, `payment_state`, and `invoice_name`; used by the modal to pre-populate the amount and show outstanding balance context
- [x] `POST /api/tickets/{ticket_id}/register-payment` — resolves full invoice via same logic; validates `amount_residual > 0` and invoice is not already `paid`; registers payment via `account.payment.register` wizard (same XML-RPC pattern as deposit); reads back `payment_state` and `amount_residual` after registration; stamps `balance_payment_by/at` on the ticket; adds to `stage_history`; audit-logged as `ticket.register_payment`
- [x] "Register Balance Payment" button in the Sales Ticket sidebar — appears for `canFinance` users after `payment_confirmed_at` is set (deposit confirmed), regardless of pipeline stage — finance may need to register the balance at collection time even if the ticket is already in `confirmed_wip`
- [x] Modal pre-populates amount with `amount_residual` from `GET invoice-balance`; shows invoice name and outstanding amount as a subtitle; same journal dropdown as deposit modal (reuses `GET /api/tickets/payment-journals`)
- [x] Toast reports remaining outstanding amount if balance was partial, or "invoice fully paid" if `amount_residual = 0` after registration

**Design decisions:**
- **Targets the largest `out_invoice`** — most reliable way to distinguish the full SO invoice from down payment invoices without relying on Odoo's internal link fields; down payment invoices are always for smaller amounts than the full order value
- **No gating on exit status** — balance payment can be registered even after the ticket is marked complete or the order is collected; finance may record payments after the physical handoff
- **Allows partial payments** — `register-payment` can be called multiple times; each call registers however much finance enters and the residual is updated in Odoo; the portal doesn't enforce "must pay remainder in one go"

### Definition of Done
- [x] `GET /api/suppliers/` returns all active Odoo partners with `supplier_rank > 0`, searchable by name/email
- [x] `GET /api/suppliers/{id}/profile` returns partner details, vendor bills, purchase orders, goods receipts, and products supplied
- [x] Supplier list view with name, type badge (Customer/Supplier/Both), email, phone, payment terms
- [x] Supplier 360 profile: header card, KPI row (confirmed POs, total spend, outstanding balance, products supplied), and four data sections
- [x] Goods receipts sourced from completed incoming stock pickings linked to the supplier
- [x] Products supplied sourced from `product.supplierinfo`, deduplicated by product template
- [x] `suppliers.view` / `suppliers.manage` added to all permission dicts in `auth.py`
- [x] Finance role defaults to `suppliers.view: true`; all ticket roles default to `false`
- [x] "Suppliers" nav item in sidebar, gated by `suppliers.view`, with Truck icon
- [x] Finance can register the remaining balance payment against the full sale invoice from the portal — no Odoo access required for any standard payment in the order lifecycle

---

## Phase 8 — Order Workflow & Ticketing System

**Goal:** Cross-team handoff from Sales → Orders → QA/RP → Finance is tracked end-to-end in the portal, with each team seeing only what's relevant to them and automatic handoff notifications — replacing reliance on ad-hoc email/verbal handoffs for order fulfilment status. This is the core reason the business wanted this portal built.  
**Estimate:** 2–3 weeks  
**Status:** 🟡 In Progress — 8.1–8.12 code complete; DoD 8/9 items done; one remaining item is operational (create 6 named staff accounts via Users page — no code required)  
**Completed:** Sub-deploy 1 (8.1 Roles & Permissions) — 2026-06-19 · Sub-deploy 2 (8.2–8.4 backend) — 2026-06-19 · Sub-deploy 3 (8.5 UI) — 2026-06-19 · Sub-deploy 4 (unified pipeline) — 2026-06-19 · Sub-deploy 5 (8.6 Quote Builder + Deposit + 8.7 Quote Edit) — 2026-06-21 · Sub-deploy 6 (8.8 Orders Tickets full-page detail) — 2026-06-22 · Sub-deploy 7 (8.9 Stock accuracy + Orders pipeline enforcement) — 2026-06-23 · Sub-deploy 8 (8.10 Orders screen read-only + Confirm Order in Sales Ticket) — 2026-06-23 · Sub-deploy 9 (8.11 Send Quote to customer) — 2026-06-23 · Sub-deploy 10 (8.12 Reseller order cart restoration) — 2026-06-29  

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

#### 8.12 — Reseller Order Cart Restoration (regression fix)

**Found 2026-06-29:** Auditing the barcode-scanning request for the quote builder surfaced that resellers had no UI to place a new order at all. `POST /api/orders/` (the endpoint that creates the Odoo order and auto-creates an unassigned Sales Ticket — see 8.2/8.4 above) was never touched and still worked correctly, but the only frontend that called it — the original product-catalogue cart on the Orders screen — was removed in 8.9/8.10 to stop **staff** bypassing the ticket pipeline. Because resellers and staff shared that exact same `Orders` component, removing the cart took away the reseller's order-placing capability too, with nothing built to replace it. Resellers also can't use the Sales Ticket quote builder as a substitute — `tickets.sales` always evaluates `false` for the `reseller` role.

- [x] Restored the original product-catalogue cart UX (search bar, category filter chips, in-stock/out-of-stock chips, product grid with qty stepper and "+ Add to Order") as a reseller-only `view === "new"` branch inside the existing `Orders()` component — recovered from git history (commit `0656395`, the commit that removed it) rather than rebuilt from assumption
- [x] Restored the Section 21 controlled-substance script check (`GET /api/scripts/check/{customer_id}`) on submit — this was dropped silently along with the original cart and would otherwise have let private-patient orders bypass script validation
- [x] Customer search reuses `GET /api/customers/`, already server-side scoped to the reseller's own onboarded customers (`customer_ownership` collection) — no backend change needed
- [x] Stock and pricing shown is resolved via the existing `resolve_warehouse_id()` — the reseller's assigned warehouse, automatically, no warehouse picker needed in this UI
- [x] Submits unchanged to `POST /api/orders/` — zero backend changes; the auto-ticket-creation, credit-warning, and commission-tracking logic in `order_routes.py::create_order()` was correct the entire time
- [x] "New Order" button added to the Orders screen TopBar, visible only to `isReseller` — admin/staff Orders screen (read-only monitoring, pipeline-enforcement banner, Create Sales Ticket / Queue for Packing) is completely unchanged
- [x] Extracted the Sales Ticket quote builder's product search row into a shared `frontend/src/components/ProductLineRow.js` — used by the staff quote builder (type-and-search, for users who know SKUs); the reseller cart deliberately does **not** use this component, since it needs a browsable catalogue, not a search box

**Design decision — two different UIs for the same backend endpoint is correct, not duplication:** Staff (Merveille) know product names/SKUs and want to type-search quickly inside a ticket they're already working. Resellers are discovering what's available and want to browse/filter a catalogue. Both submit through the same pipeline-correct backend path; only the input UX differs by audience. Forcing one shared UI here would have been the wrong call.

#### 8.13 — Reseller Application Management — Added 2026-07-02

**Goal:** Resellers can view, edit, and manage their own customer onboarding applications entirely within the portal, without needing to contact an admin to check status or update details. An application can be revised after submission (fields and documents) while it is still under review.

**Context:** Before this, `ResellerApplications.js` listed submitted applications with status badges but had no detail view or edit capability. Resellers had no way to replace a rejected document or correct an error in submitted fields without resubmitting an entirely new application.

- [x] `PUT /api/onboarding/{id}` — partial update endpoint (Pydantic `model_dump(exclude_unset=True)`); reseller can update any non-locked field on their own application while it is still `pending` or `under_review`; admin can update any application they can view; audit-logged as `onboarding.update`
- [x] `POST /api/onboarding/{id}/documents/{doc_type}` — replace a single document slot on an existing application; removes old R2 object, uploads new file, updates the `documents` array in MongoDB; requires ownership (reseller) or `customers.approve_onboarding` (admin); audit-logged as `onboarding.document_replaced`
- [x] `frontend/src/views/ResellerApplicationDetail.js` — full detail view for resellers:
  - Section-based read/edit layout: Business Details, Primary Contact, Business Address, Additional Information, Documents
  - `editing` boolean toggles between read-only key-value display and editable form inputs
  - `REQUIRED_DOC_TYPES` shows all 5 doc slots; missing docs show amber "Not uploaded" state
  - Replace/Upload via file input; View (presigned PDF iframe) and Download for uploaded docs
  - Save calls `PUT /api/onboarding/{id}` with only changed fields; replace calls `POST /api/onboarding/{id}/documents/{doc_type}`
  - Status badge in header — reseller can see where their application is in the admin review queue
- [x] `ResellerApplications.js` — "Start Application" button (`BtnPrimary`) in TopBar actions → navigates to `/onboard`
- [x] Reseller sidebar nav reworked: `My Customers` and `My Applications` grouped under a `"Customers"` section (same section property pattern as admin NAV); `My Applications` tab removed from the Customers component in `Views.js` (was a tab inside the customers list — now a separate route)
- [x] Routes: `/my-applications` → `ResellerApplications`, `/my-applications/:id` → `ResellerApplicationDetail` in `App.js`

**Design decisions:**
- **Edit while pending only** — backend does not hard-block edits at `approved` or `rejected` status, but the frontend shows the edit button only when status is `pending` or `under_review`; approved applications are immutable in practice.
- **Document replacement reuses the same R2 key prefix** (`onboarding/sessions/{session_id}/{doc_type}`) — no new storage path; the existing presign and delete helpers cover it.
- **Split from the Customers tab** — the previous tab-inside-customers pattern mixed two conceptually different things (active customers vs pending applications) and made both lists harder to use. Splitting them gives each its own URL, breadcrumb, and eventual pagination.

#### 8.14 — Odoo Delivery Note Validation on Order Complete — Added 2026-07-04

**Goal:** When an Orders Clerk marks an order Complete, the linked Odoo Delivery Note (`stock.picking`) is validated at the same time — reducing reserved stock to zero and recording the physical dispatch. Before this, the portal marked the packing board entry complete in MongoDB but left the Delivery Note in "Ready" state forever, meaning Odoo's On Hand stock figures were never decremented for portal-completed orders.

**Context:** Odoo's three linked documents are `sale.order` (commercial) → `stock.picking` (logistics/Delivery Note) → `account.move` (invoice). Confirming a sale order auto-creates the Delivery Note in "assigned" (Ready) state. Validating the Delivery Note is what moves stock from On Hand to "Done" and triggers invoice creation if invoicing policy is "on delivery". This step was entirely missing from the portal's Order Complete action.

- [x] `_validate_odoo_delivery(odoo_order_id: int) -> dict` — module-level sync helper in `packing_board_routes.py`; queries all `stock.picking` records for the sale order in `assigned` state; calls `action_set_quantities_to_reservation()` on each (sets `qty_done = reserved_qty`, bypasses Immediate Transfer dialog), then `button_validate()`; if `button_validate` returns a wizard dict (partial reservation), processes the backorder confirmation best-effort via `stock.backorder.confirmation.process()`; returns `{"success": bool, "pickings": [name, ...], "error": str|None}`; never raises — caller always continues
- [x] `PUT /api/packing/complete` — delivery validation runs before the MongoDB update; `delivery_validated: bool` flag stored on the packing board document; two audit log entries written (`packing.complete` + `packing.delivery_validated`) with the full result detail; response includes `delivery_validated` flag and optional `warning` string if Odoo validation failed
- [x] `OrdersTickets.js` — `handleComplete()` replaces the generic `act("complete", ...)` call; reads the response `warning` field and shows a persistent error toast alongside the success toast if delivery validation failed; `Truck` icon shown in the timestamps sidebar for completed orders: green "Delivery validated in Odoo" or amber "Delivery not validated in Odoo" based on `delivery_validated` flag

**Design decisions:**
- **Non-blocking by design** — if Odoo delivery validation fails (picking not found, Odoo down, partial stock), the order is still marked complete in MongoDB. Blocking the complete action on Odoo's response would hold up the warehouse floor for an ERP connectivity issue. The amber warning gives the clerk visibility without stopping them.
- **`order_id` in packing board is the Odoo integer as string** — `int(entry["order_id"])` is the safe conversion. This was confirmed by reading `adopt_order()` which sets `order_id = str(body.order_id)` where `body.order_id` is the Odoo integer.
- **`action_set_quantities_to_reservation()` before validate** — avoids the Odoo "Immediate Transfer" wizard that would otherwise prompt for `qty_done` on every move line. Since QA and RP have already signed off, we want to validate exactly what was reserved.

### Definition of Done
- [x] Every portal order (reseller-placed or staff-placed) auto-creates a Sales ticket — no manual entry required for orders that come through the portal
- [x] A direct inquiry (manually created ticket) can move through every stage to Complete, Cancelled, or Incomplete, with a visible timeline of who did what and when
- [x] Confirming "50% Payment Received" is blocked if Odoo's invoice shows no payment yet
- [x] Confirming an order auto-queues the packing board entry and transitions the linked Sales ticket to `confirmed_wip` — no manual re-entry
- [x] An Orders ticket cannot reach Complete without both QA and RP approval recorded independently
- [x] An Orders ticket marked Incomplete or Cancelled automatically updates and notifies the originating Sales ticket, with a reason visible to Sales
- [x] An unassigned ticket (from a reseller/admin-placed order) is visible to all `tickets.sales` users; any sales rep can claim it via "Assign to me"
- [x] A reseller can browse the product catalogue, build a cart, and place an order from the portal — restored in 8.12 after being inadvertently removed in 8.9/8.10
- [x] Marking an Orders ticket Complete validates the linked Odoo Delivery Note, decrementing On Hand stock — non-blocking with visible warning if Odoo validation fails
- [ ] Each of the 6 named staff can log in and see only the tickets relevant to their role — **pending: accounts not yet created (operational, no code required)**

### Notes
> **Sub-deploy 13 (2026-07-05):** Reseller onboarding inbox gap — three-tier hardening. **Tier 1 (backend):** `onboarding_routes.py::email_templates()` now stamps `reseller_id`, `reseller_name`, `application_id`, and `status: "application_linked"` on the outbound thread when the caller is a reseller. `approve_application()` accepts optional `ApproveBody(company_name)`, allows `awaiting_docs` status for inbox-sourced apps (skips 5-docs check), and after creating the Odoo partner stamps `customer_id` across the linked inbox thread documents — enabling "Save Documents" immediately after approval. **Tier 2 (auto-application):** A draft `customer_onboarding` document (`status: "awaiting_docs"`, `source: "inbox"`, `inbox_thread_id`) is created the moment a reseller sends onboarding docs via `OnboardingDocs.js`, preserving the reseller link for the entire approval lifecycle. `TemplateEmailBody` extended with optional `customer_name`. Response now returns `application_id`. **Tier 3 (gate):** `OnboardingInbox.js` — if `detail.application_id` exists, "Create Customer" button is replaced with "Review Application" (navigates to `/applications/{id}`); direct customer creation is blocked for reseller-originated threads. **Frontend:** `OnboardingDocs.js` rewritten — adds `customer_name` field; success banner with "View application" link after send (only shown if `application_id` in response). `OnboardingInbox.js` — restored `application_linked` tab; added `awaiting_docs` to `STATUS_META`; "Application linked" badge in thread header is now a clickable link to the application. `CustomerApplicationDetail.js` — `awaiting_docs` added to `STATUS_CFG`; `ActionsCard` handles `awaiting_docs`: shows company name input (required before approve), inbox thread link, passes `company_name` in approve body; page header falls back to `contact_name` when `company_name` blank; "View inbox thread" button in header when `inbox_thread_id` present. `CustomerProfile.js` — "Send Onboarding Docs" button moved from TopBar into Documents section header; hidden when all 5 onboarding docs are already uploaded. `OnboardingInbox.js` — "Save Documents" button only shown when `customer_id` is present; "Create Customer" flow no longer stages docs to R2 at Step 1 (was orphaning files on cancel) — all R2 writes deferred to the final Create click via `save-documents`; overwrite warning added when saving to an existing customer who already has a doc type on file (inline amber row warning + explicit confirmation step listing old→new filenames before saving).

> **Sub-deploy 12 (2026-07-04):** 8.14 Odoo Delivery Note validation on Order Complete. `_validate_odoo_delivery()` sync helper added to `packing_board_routes.py` — searches for `stock.picking` records in `assigned` state for the sale order, calls `action_set_quantities_to_reservation()` then `button_validate()` on each, handles backorder wizard best-effort. Non-blocking: if Odoo validation fails, the MongoDB document is still marked complete but stamped `delivery_validated: false`. Two audit log entries per completion: `packing.complete` (existing) + `packing.delivery_validated` (new, includes full result detail). `OrdersTickets.js`: `handleComplete()` replaces generic `act()` for the complete action; reads `warning` from response and shows a persistent error toast if delivery failed; `Truck` icon added to the timestamps sidebar showing green/amber delivery status on completed entries.

> **Sub-deploy 11 (2026-07-02):** 8.13 Reseller Application Management. Backend: `PUT /api/onboarding/{id}` partial update endpoint using `model_dump(exclude_unset=True)` — resellers can update their own pending/under-review applications; `POST /api/onboarding/{id}/documents/{doc_type}` for per-slot document replacement (deletes old R2 object, uploads new, updates MongoDB array). Frontend: `ResellerApplicationDetail.js` (new file) — section-based read/edit layout with `editing` boolean toggle; all 5 document slots shown with status (uploaded / not uploaded); file input for replace/upload; presigned PDF iframe viewer; Save calls the partial update endpoint with only changed fields; replace calls `POST /api/onboarding/{id}/documents/{doc_type}`. `ResellerApplications.js` gained a "Start Application" `BtnPrimary` in the TopBar actions. The previous in-tab applications view inside `Customers.js` (in `Views.js`) was removed entirely — `custTab` state, `applications` state, `loadApplications` callback, `pendingApps` derived value, `APP_STATUS_CLS` constant, the tab bar JSX, and the entire applications list block were all deleted. The Customers component now always shows the customers table. Routes `/my-applications` and `/my-applications/:id` added to `App.js`.

> **Sub-deploy 10 (2026-06-29):** 8.12 Reseller order cart restoration. Found while scoping barcode scanning for the quote builder — resellers had no UI to place a new order at all, a silent regression from 8.9/8.10's pipeline-enforcement cart removal (scoped to stop staff, but reseller and staff shared the same `Orders` component). Recovered the original product-catalogue cart UX directly from git history (`git show 0656395`) rather than rebuild from assumption, including the Section 21 script compliance check that had been dropped along with it. Zero backend changes — `POST /api/orders/` was correct the whole time; only the reseller's entry point to it was missing. New `ProductLineRow.js` shared component extracted from the Sales Ticket quote builder (used there for staff type-and-search; deliberately not reused in the reseller cart, which needs a browsable grid instead).

> **Sub-deploy 11 (2026-07-02):** 8.13 Reseller Application Management. Backend: `PUT /api/onboarding/{id}` partial update endpoint using `model_dump(exclude_unset=True)` — resellers can update their own pending/under-review applications; `POST /api/onboarding/{id}/documents/{doc_type}` for per-slot document replacement (deletes old R2 object, uploads new, updates MongoDB array). Frontend: `ResellerApplicationDetail.js` (new file) — section-based read/edit layout with `editing` boolean toggle; all 5 document slots shown with status (uploaded / not uploaded); file input for replace/upload; presigned PDF iframe viewer; Save calls the partial update endpoint with only changed fields. `ResellerApplications.js` gained a "Start Application" `BtnPrimary` in the TopBar actions. The previous in-tab applications view inside `Customers.js` (in `Views.js`) was removed entirely — `custTab` state, `applications` state, `loadApplications` callback, `pendingApps` derived value, `APP_STATUS_CLS` constant, the tab bar JSX, and the entire applications list block were all deleted. The Customers component now always shows the customers table. Routes `/my-applications` and `/my-applications/:id` added to `App.js`.

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
| Document storage | Cloudflare R2 | Onboarding documents (signed contracts, CIPC) | Free (10GB) |
| Backups | Railway | MongoDB point-in-time recovery (native) | Included |
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
**Status:** 🟢 Complete  
**Completed:** 2026-06-29  

### Context

The portal is currently live at `https://bassani-health-production-3d68.up.railway.app`. This is a Railway-generated subdomain — functional but not client-facing. Before going live with staff, the URL needs to point to a real domain. This requires coordination with whoever manages `bassanihealth.com` DNS, and a parallel Resend domain verification for outbound email.

Current unknowns: who hosts `bassanihealth.com`, what control panel they use (cPanel, Plesk, Cloudflare, etc.), and whether there is a cost implication for the subdomain or SSL.

### Tasks

#### 9.1 Custom Domain on Railway
- [x] Identify who manages `bassanihealth.com` DNS
- [x] Decide on subdomain: `portal.bassanihealth.com`
- [x] In Railway: Project → Settings → Networking → Add Custom Domain → `portal.bassanihealth.com`
- [x] CNAME record created by DNS admin
- [x] DNS propagation complete
- [x] Railway SSL provisioned automatically
- [x] `PORTAL_URL=https://portal.bassanihealth.com` set in Railway
- [x] `backend/config.py` default updated to `https://portal.bassanihealth.com`

> **Cost:** Railway custom domains are included in all paid plans — no additional charge. The domain itself is the client's existing asset. No new hosting cost.

#### 9.2 Resend Sending Domain
- [x] Resend account confirmed, `bassanihealth.com` added as sending domain
- [x] SPF/DKIM DNS records added and verified
- [x] `SENDER_EMAIL=noreply@bassanihealth.com` set in Railway
- [x] `RESEND_API_KEY` set in Railway to production key
- [x] Email confirmed working — 2FA OTP emails arriving from `noreply@bassanihealth.com`

> **Cost:** Resend free tier is 3,000 emails/month, 100/day. Likely sufficient for current volume. Pro plan is $20/month if needed.

#### 9.3 Production Environment Verification
- [x] All Railway environment variables confirmed set for production
- [x] Email triggers confirmed working in production (2FA OTP verified live)
- [x] Portal loads correctly on `portal.bassanihealth.com` with HTTPS

### Definition of Done
- [x] `https://portal.bassanihealth.com` loads the portal with a valid SSL certificate
- [x] Outbound emails arrive from `noreply@bassanihealth.com` (not `onboarding@resend.dev`)
- [x] All production environment variables confirmed correct
- [x] The Railway-generated URL still works as a fallback

### Notes
> **2026-06-29:** Phase complete. `portal.bassanihealth.com` is live with SSL. `bassanihealth.com` domain verified in Resend; emails confirmed sending from `noreply@bassanihealth.com`. All Railway environment variables confirmed. The old Railway-generated URL (`bassani-health-production-3d68.up.railway.app`) remains active as a fallback.

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

### 10.6 — Profile Pagination & Sidebar Nav Grouping — 2026-07-02 ✅

**Goal:** Tables that will grow unbounded over time must be paginated before they become a performance and usability problem. Sidebar nav items for resellers needed logical grouping to match admin nav sections.

**Pagination:**
- [x] New shared `PaginationBar` component exported from `components/UI.js` — accepts `{ page, pageSize, total, onChange }`; renders "X total · Page N of M" + Previous/Next buttons; self-hides when `pageCount <= 1`
- [x] Reseller profile — activity/audit feed: server-side pagination (20/page); backend `GET /api/audit/` gained `offset` parameter; `count_documents(query)` used for real total (was `len(logs)` — wrong for paginated results); `actPage` / `actTotal` state in `ResellerProfile.js`; activity section shows loading state during page transitions
- [x] Reseller profile — customers table: client-side pagination (15/page); `custSlice` computed from full loaded array; `custPage` state
- [x] Customer profile — outstanding invoices: client-side pagination (10/page); `invSlice` from full loaded array; `invPage` state
- [x] Customer profile — account statement rows: client-side pagination (15/page); IIFE pattern inside JSX computes `stmtSlice` locally (avoids adding state for a derived value); `stmtPage` state reset to 0 on `loadStatement` call

**Reseller sidebar nav grouping:**
- [x] RESELLER_NAV items gained `section` property — `"Main"` and `"Customers"` — matching the admin NAV structure
- [x] Sidebar rendering unified: removed the `isReseller ? items.map(...) : sections.map(...)` branch; now always uses `sections.map` for both roles since both navs carry section metadata
- [x] `My Customers` → section `"Customers"` · `My Applications` → section `"Customers"` · `Onboarding Docs` → section `"Customers"` — visually grouped with a section label in the sidebar, same as admin's "Admin" section

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
- [x] Reseller profile activity feed is paginated — large audit log does not load all rows at once
- [x] Customers, invoices, and statement tables on profile views are paginated — long lists do not overflow the page
- [x] Reseller sidebar groups `My Customers`, `My Applications`, and `Onboarding Docs` under a "Customers" section label — consistent with admin nav section grouping

### Notes

> **10.0 (2026-06-26):** Login left panel hidden on mobile with `hidden md:flex`. Main app sidebar was already fully responsive from prior work — `fixed -translate-x-full` on mobile, `lg:static lg:translate-x-0` on desktop, hamburger in `TopBar` already in place. No changes to the sidebar or AppLayout were necessary.

> **10.1–10.4 (2026-06-26):** Comprehensive responsive pass across 9 files. `DataTable` and `Modal` in `UI.js` were already mobile-safe — confirmed and left unchanged. `DataTable` extended with `meta.className` support (applied to both `<th>` and `<td>`) enabling declarative column hiding from each view's column definition. Inline tables in `CustomerProfile.js` (addresses, recent orders, outstanding invoices, account statement) wrapped in `overflow-x-auto`. `SalesTickets.js` and `OrdersTickets.js` fixed two fixed-column grids in detail views and wrapped line-item tables. Quote builder (SalesTickets) collapsed 3-col header to responsive, made Notes/Totals stack on mobile, added overflow-x on the line items card. `CustomerOnboarding.js` all 5 form grids made responsive. `Users.js`, `AuditTrail.js`, and `CustomerProfile.js` modal grids all stacked to single-column below `sm:`. Column hiding applied to Customers, Orders, Products, Invoices, Resellers, Users list views — each hides secondary columns at `sm`/`md`/`lg` breakpoints so the most critical info always stays visible without horizontal scrolling. **Only 10.5 (max-width caps for 2560px+ displays) remains.**

> **10.6 (2026-07-02):** Profile pagination and reseller nav grouping. New shared `PaginationBar` component in `UI.js` — used across four paginated tables. Activity/audit on `ResellerProfile.js` is server-side paginated (20/page): `GET /api/audit/` gained an `offset` parameter; the endpoint now returns a real `total` from `count_documents(query)` instead of `len(logs)` (which was page-size, not total-count). Customer table on reseller profile: client-side pagination (15/page). Outstanding invoices on customer profile: client-side pagination (10/page). Account statement rows on customer profile: client-side pagination (15/page), using an IIFE inside the JSX to compute the slice without additional top-level state variables. Reseller sidebar nav: `RESELLER_NAV` items gained a `section` property; the sidebar rendering branch that handled resellers separately from admins was removed — both roles now use the same `sections.map(...)` path since both navs carry section metadata. `My Customers`, `My Applications`, and `Onboarding Docs` appear under a "Customers" section header.

---

---

## Phase 11 — Mailbox Integration

**Goal:** Surface the `orders@bassanihealth.com` shared mailbox inside the portal. Staff see incoming POs and RFQs in a Sales Inbox view, identify the customer, and convert emails directly into Sales Tickets — without leaving the portal or switching to Outlook. Replies from the portal go out as real emails from the shared mailbox, keeping the thread intact in the customer's inbox.

**Status:** 🟢 Live — IMAP/SMTP path complete (2026-07-04)

Two backends are supported. Only one needs to be configured:

| Backend | Status | When to use |
|---|---|---|
| IMAP/SMTP | **Live** | Any mailbox: Xneelo, Gmail, custom IMAP server |
| Microsoft Graph (M365) | **Live** — Azure credentials wired 2026-07-05 | M365 shared mailbox with OAuth2 — preferred (webhook push, no polling, no Basic Auth dependency) |

**ConnectedMailboxes UI** (updated 2026-07-05): super admin selects **Office 365** or **IMAP** per mailbox tab. Office 365 form stores Tenant ID, Client ID, Client Secret, and Shared Mailbox Address in MongoDB (`portal_settings`). No Railway env vars required for Graph — credentials are hot-reloaded from MongoDB on save without a deployment restart.

### 11.A — IMAP/SMTP Path (Active)

**How it works:** Super admin enters mailbox credentials in Settings > Mailbox. The portal connects via standard IMAP (SSL, port 993) and polls for new messages every 60 seconds. Replies are sent via SMTP (STARTTLS, port 587). No Azure app registration required — works with any email provider that supports IMAP.

**Completed (2026-07-04):**
- [x] `backend/services/imap_client.py` — provider-agnostic IMAP poll + SMTP send via `asyncio.to_thread` (no blocking)
- [x] Mailbox credentials stored in MongoDB `portal_settings` (`_id: "mailbox_config"`) — not in Railway env vars
- [x] `GET/PUT/DELETE /api/settings/mailbox` — super admin only; password fields never returned on GET
- [x] `POST /api/settings/mailbox/test` — live IMAP login test without saving
- [x] Credentials loaded at startup and hot-reloaded on settings save (no restart required)
- [x] 60-second background polling loop started on startup when IMAP is configured
- [x] `_ingest_imap_message()` — mirrors Graph ingest; handles thread detection via `In-Reply-To` header
- [x] Reply via SMTP (`Re:` subject prefix, `In-Reply-To` and `References` headers for correct threading)
- [x] `inbox_configured()` guard replaces `graph_configured()` across all inbox routes — either backend activates the inbox
- [x] Deduplication index on `imap_message_id` (unique + sparse)
- [x] Settings > Mailbox UI — provider presets (M365/Xneelo/Gmail/Custom), test connection, save, disconnect
- [x] Sales Inbox "not configured" state links super admin to Settings > Mailbox
- [x] Fallback to Railway env vars (`IMAP_HOST`, `IMAP_USERNAME`, `IMAP_PASSWORD`) if MongoDB has no entry

**M365 IMAP notes:**
- IMAP host: `outlook.office365.com:993`, SMTP host: `smtp.office365.com:587`
- IMAP/Basic Auth must be enabled in Exchange Admin Center for the shared mailbox
- Ask Tristan (M365 admin) to confirm. Command: `Get-CASMailbox orders@bassanihealth.com | Select ImapEnabled`
- If Basic Auth is disabled tenant-wide, options: (a) re-enable for this mailbox only, (b) forward to an Xneelo account, (c) pursue Graph OAuth2 path when Azure creds are available

### 11.B — Professional Inbox UI (Thread-Grouped, Read State, Pipeline Integration)

**Completed 2026-07-05:**
- [x] `list_inbox` replaced with MongoDB aggregation pipeline — one row per conversation (grouped by `thread_root_id`), ordered by most recent activity; `message_count`, `unread_count`, `has_unread` per row
- [x] `is_read: False` set on ingest (Graph + IMAP); `is_read: True` on outgoing reply copies
- [x] `_mark_thread_read()` helper + `POST /{id}/mark-read` endpoint; `GET /{id}/thread` auto-marks thread read as BackgroundTask
- [x] Thread endpoint includes `body_html` and correctly includes the root message when navigating from a reply
- [x] `status=open` default filter — excludes archived + ticket_created; `q` search across from_name, from_email, subject, body_preview
- [x] `SalesInbox.js` — full two-panel redesign:
  - Left panel: thread list with unread dot, initials avatar, bold unread state, message count badge
  - Status tabs: Inbox / New / Pending / Done / Archived
  - Debounced search
  - Status pills per row: green **Ticket** (clickable, navigates to ticket), red **Unknown**, amber **Pending**
  - Right panel: bubble-style message stream — incoming left/white, outgoing right/teal, date separators, auto-scroll to latest
  - Reply compose pinned to bottom, Ctrl+Enter shortcut
  - **View Ticket** button in thread header navigates to `/tickets/sales` with `openTicketId` state (reuses existing SalesTickets hook)
- [x] Archive/Dismiss — available on all non-archived threads including `ticket_created`; button label is **Dismiss** when a ticket exists (communicates that the inbox entry is dismissed, not the ticket), **Archive** otherwise

### 11.C — Onboarding Inbox + Multi-Mailbox Architecture (2026-07-05)

**Goal:** A second dedicated inbox for customer onboarding correspondence, fully independent from the Sales Inbox. Staff with the `onboarding.inbox` permission can read threads, reply, link a thread to an existing onboarding application, and save email attachments directly to a customer's R2 document profile — without any intermediate copy.

**Completed 2026-07-05:**

- [x] `backend/services/inbox_service.py` — canonical shared service parameterised by `collection` and `mailbox` slug. Implements: `resolve_customer()` (Odoo lookup, 10-min cache), `mark_thread_read()`, `build_list_pipeline()` (thread aggregation with `$max` ticket_id/application_id), `ingest_graph_message()`, `ingest_imap_message()`, `save_attachment_to_profile()` (streams bytes from Graph or IMAP store directly to R2, no intermediate copy; creates `customer_documents` record)
- [x] `imap_client.py` — multi-mailbox: `_configs` and `_graph_addresses` dicts keyed by slug; `load_config_from_db(mailbox)`, `fetch_new_messages(mailbox)`, `mark_as_read(uid, mailbox)`, `send_reply(..., mailbox)` all parameterised; `_SETTINGS_KEYS` maps slug to MongoDB settings key (`mailbox_config` for sales, `mailbox_config_onboarding` for onboarding)
- [x] `graph_client.py` — all functions accept `mailbox_address: Optional[str] = None`; credentials now resolve from MongoDB runtime config first (via `set_runtime_credentials()`), then Railway env vars as fallback; token cache invalidated on credential change; no breaking changes to callers
- [x] `graph_subscription.py` — `_settings_key(mailbox)`, `_webhook_url(mailbox)`, `ensure_subscription(mailbox, mailbox_address)`, `get_client_state(mailbox)` — each mailbox has its own subscription key and webhook URL (`/api/inbox/graph-webhook` for sales, `/api/onboarding-inbox/graph-webhook` for onboarding)
- [x] `onboarding_inbox_routes.py` — full inbox at `/api/onboarding-inbox`; requires `onboarding.inbox` permission; collection: `onboarding_inbox`; thread grouping, mark-read, reply, archive all implemented; **no ticket creation**; adds: `POST /{id}/send-docs` (sends template PDFs from onboarding SMTP, creates outgoing thread root), `POST /{id}/link-customer` (stamps customer_id/name across full thread, audit-logged), `POST /{id}/save-attachment/{attachment_id}` (delegates to `inbox_service.save_attachment_to_profile`), `POST /{id}/create-customer-session` (fetches mapped inbox attachments from MongoDB/Graph, writes to R2 under `onboarding/sessions/{sid}/{doc_type}`, returns session_id + documents array for `POST /api/customers/`)
- [x] `GET/PUT/DELETE/POST /api/settings/onboarding-mailbox` — mirrors sales mailbox settings endpoints; writes to `mailbox_config_onboarding`; hot-reloads onboarding config on save
- [x] `auth.py` — `"onboarding": {"inbox": False}` added to `DEFAULT_ADMIN_PERMISSIONS`, `FULL_PERMISSIONS`, and all five `ROLE_DEFAULT_PERMISSIONS` entries
- [x] `server.py` — `_run_inbox_startup(mailbox, collection, label)` shared helper replaces duplicated startup code; called for both sales and onboarding; removes private function imports from `inbox_routes`
- [x] `inbox_routes.py` — fixed: removed local `_customer_cache`/`_CUSTOMER_CACHE_TTL`/`_resolve_customer` (was broken: `import time` removed but `time.monotonic()` still referenced); imports `resolve_customer` from `inbox_service`; list aggregation fixed to `$max` `ticket_id`/`application_id` (thread badge now survives when newest doc is a reply without these fields)
- [x] `OnboardingInbox.js` — two-panel inbox view; sender auto-detected on ingest (same `resolve_customer` as sales inbox); PDF eye-icon preview (blob URL via authenticated fetch); Send Docs button (outgoing from onboarding SMTP, reply threads back automatically); Link to Customer modal pre-filled with auto-detected customer, manual search override; Create Customer button (unknown senders only) — step 1 maps email attachments to 5 required doc slots, backend stages bytes to R2 session, step 2 pre-fills form from sender name/email, remaining slots upload in-place, submits to `POST /api/customers/` and auto-links thread; 30s list / 15s thread silent polling with `visibilityState` guard
- [x] `OnboardingMailboxSettings.js` — super admin settings page; provider presets, IMAP/SMTP fields, test-connection, save, disconnect; mirrors Sales Mailbox Settings page
- [x] `UI.js` — `Onboarding Inbox` nav item (Tickets section, `permission: "onboarding.inbox"`, unhandled badge); `Onboarding Mailbox` nav item (Admin section, super admin only); 60s badge count poll against `/api/onboarding-inbox/unhandled-count`
- [x] `App.js` — `/onboarding-inbox` and `/settings/onboarding-mailbox` routes

**Attachment architecture:**
- Graph mailbox: attachment bytes live in Microsoft 365 and are fetched on-demand. "Save to Profile" action calls `get_attachment_content()` → streams bytes directly to R2 → writes `customer_documents` record. No copy in MongoDB.
- IMAP mailbox: attachment bytes are eagerly fetched at ingest time and stored in `onboarding_inbox_attachments` (BSON Binary, capped at 15 MB per attachment). "Save to Profile" reads from there → streams to R2. One copy in MongoDB (temporary, until the app adds a TTL index to expire them after the thread is archived).

**11.C.2 — Onboarding inbox UX hardening (2026-07-05):** *Complete*

- [x] `OnboardingInbox.js` — "Save Documents" button now only shown when `customer_id` is set on the thread (unknown senders can only use "Create Customer")
- [x] `OnboardingInbox.js` — Create Customer flow no longer stages docs to R2 at Step 1 ("Continue"); all R2 writes deferred to the final Create Customer click via the existing `save-documents` endpoint — eliminates orphaned R2 objects on cancel
- [x] `OnboardingInbox.js` — overwrite protection on Save Documents: fetches existing docs for the customer profile when the modal opens; shows inline amber warning per row when an attachment is mapped to a doc type that already has a file; adds an explicit `overwrite-confirm` step listing old filename → new filename before writing to R2
- [x] `OnboardingInbox.js` — fixed TopBar: was passing action buttons as JSX children (silently ignored); corrected to `actions` prop — "Send Docs" and "Refresh" buttons now render
- [x] `CustomerProfile.js` — "Send Onboarding Docs" button moved from TopBar into Documents section header (right-aligned); hidden automatically when all 5 required onboarding doc types are already on file

**11.C.3 — Reseller onboarding ownership gap — three-tier fix (2026-07-05):** *Complete*

Gap: When a reseller sent onboarding docs via `OnboardingDocs.js`, no application was created and no `reseller_id` was preserved on the resulting inbox thread. If admin created the customer directly from that thread, `customer_ownership` was never written — customer was permanently unlinked from the reseller.

- [x] `onboarding_routes.py::email_templates()` — when caller is a reseller: creates draft `customer_onboarding` doc (`status: "awaiting_docs"`, `source: "inbox"`, `inbox_thread_id`); stamps `application_id`, `reseller_id`, `reseller_name`, `status: "application_linked"` on the outbound thread; returns `application_id` in response
- [x] `onboarding_routes.py::approve_application()` — accepts `ApproveBody(company_name: Optional[str])`; allows `awaiting_docs` for inbox-sourced apps; skips 5-docs check for inbox-sourced; takes `company_name` override from body; after Odoo partner created, stamps `customer_id` across all inbox thread documents using `inbox_thread_id`
- [x] `OnboardingDocs.js` rewritten — adds optional `customer_name` field; passes both to API; success banner with "View application" link when `application_id` returned; reseller-specific explainer text shown conditionally
- [x] `OnboardingInbox.js` — restored `application_linked` tab; added `awaiting_docs` to `STATUS_META`; "Application linked" badge in thread header is now a clickable chip navigating to `/applications/{id}`; "Create Customer" button replaced with "Review Application" button when `detail.application_id` exists (Tier 3 gate — direct customer creation is blocked for reseller-originated threads)
- [x] `CustomerApplicationDetail.js` — `awaiting_docs` added to `STATUS_CFG`; `ActionsCard` handles `awaiting_docs`: company name input required before approve (passes `company_name` in body), "View Inbox Thread" button when `inbox_thread_id` present; page header falls back to `contact_name` when `company_name` blank; "View inbox thread" clickable chip in header subline

**11.C.4 — Application doc transfer on approval + inbox save-to-application (2026-07-05):** *Complete*

Closes the doc-transfer gap in both onboarding paths: application documents were never moved to `customer_documents` on approval — customer profiles were empty post-approval regardless of path used.

- [x] `approve_application` — after Odoo partner created + `customer_ownership` written, iterates `app["documents"]` and inserts a `customer_documents` record for each entry using the **same R2 key** (reference only, no byte copy). Works for portal-wizard and inbox-sourced applications. `source: "onboarding"`, `onboarding_ref: app_id` stamped for traceability
- [x] `approve_application_link` — same doc transfer logic when linking to an existing Odoo partner
- [x] `reject_application` — now accepts `awaiting_docs` status so inbox-sourced draft applications can be rejected
- [x] `onboarding_inbox_routes.py` — new `SaveToApplicationBody` model; `POST /{item_id}/save-documents-to-application`: validates app is `pending`/`awaiting_docs`, builds thread att_map, fetches bytes via R2/Graph/IMAP fallback chain, writes to `onboarding/applications/{app_id}/{doc_type}{ext}`, replaces existing entry for same `doc_type`, audit-logged
- [x] `OnboardingInbox.js` — "Save to Application" button (shown when `application_id` set, no `customer_id`); "Save Documents" button (shown when `customer_id` set); new Save to Application modal with same assignment UX, routed to application endpoint
- [x] `BASSANI_HEALTH_USER_MANUAL.md` — three-path workflow documented: reseller customer via email (save to application → approve → auto-transfer), direct customer via email (Create Customer), existing customer (Save Documents)

**Design decision — reference not copy:** On approval, `customer_documents` records point to the same R2 objects the application already references. No bytes moved, no storage cost. The only write is a new MongoDB document stamped with `odoo_partner_id`.

**11.C.1 — Thread document progress tracking (2026-07-05):** *Complete*

Enterprise state machine for onboarding thread lifecycle. Each time `save-documents` runs, the backend stamps `received_doc_types[]` on the thread root and advances `status` automatically:

| Status | Meaning |
|---|---|
| `unhandled` | New inbound thread, no action taken |
| `reply` | Customer replied, set by ingest |
| `in_progress` | Some required docs saved, more outstanding |
| `docs_complete` | All 5 required doc types received and saved |
| `archived` | Manually closed by staff |

- `received_doc_types` is a persistent array on the thread root, merged (not overwritten) on each save — supports edge case of partial saves across multiple replies.
- `docs_complete` is computed from whether all 5 keys (`store_onboarding_agreement`, `customer_information_form`, `nda`, `tqa`, `cipc_certificate`) are present. No join required on list query — status lives on the thread document.
- Frontend: two new tabs (`In Progress`, `Docs Complete`); `ThreadStatusPill` shows an amber `N/5 docs` pill for partial, green `N/5 docs` with checkmark for complete; `STATUS_META` updated with new entries.
- Customer profile (`DocumentsSection`): structured 5-row layout per doc type (green dot = uploaded, grey = missing); each row shows filename, upload date, Download, Replace, Delete; any inbox-saved or custom docs outside the 5 types appear under "Additional Documents". Backend `list_customer_documents` fixed to pass through stored `doc_type` and `source` fields instead of hardcoding `"admin_upload"`.

---

### Context

Bassani Health's email is confirmed on Microsoft 365 (MX: `bassanihealth-com.mail.protection.outlook.com`). The `orders@bassanihealth.com` shared mailbox already exists and is in active use.

This integrates with the existing Sales Ticket system (Phase 8). The inbox is not a replacement for tickets — it is the **top of the funnel** that feeds the ticket pipeline. Every PO or RFQ that arrives by email becomes a ticket within seconds of landing, without staff having to manually copy details across from Outlook.

---

### 11.0 — Azure App Registration (Client dependency — M365 Graph path)

The M365 admin must complete this once. No code required.

- [ ] In Azure Portal → Azure Active Directory → App registrations → **New registration**
  - Name: `Bassani Health Portal`
  - Account type: `Accounts in this organizational directory only`
- [ ] Add API permissions (Application permissions, not Delegated):
  - `Mail.Read` — read messages in the shared mailbox
  - `Mail.Send` — send replies from the shared mailbox
  - `Mail.ReadWrite` — mark messages as read, move to folders
- [ ] Admin grants consent for the organisation on those permissions
- [ ] Generate a **Client Secret** (set expiry to 24 months)
- [ ] Note down three values and provide to Nick: **Tenant ID**, **Client ID**, **Client Secret**
- [ ] Add to Railway environment variables: `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`, `MS_SHARED_MAILBOX` (e.g. `orders@bassanihealth.com`)

> **Security note:** The app registration is scoped to the shared mailbox only, not all staff mailboxes. Personal email is not accessible.

---

### 11.1 — Graph API Client & Subscription Management

- [ ] Add `httpx` (already available) or `msal` to `requirements.txt` for token acquisition
- [ ] New `backend/services/graph_client.py` — thin wrapper around Microsoft Graph:
  - `get_access_token()` — OAuth2 client-credentials flow using the three env vars; cache token, auto-refresh before expiry
  - `list_messages(mailbox, folder="inbox", filter=None)` — fetch messages with standard fields
  - `get_message(mailbox, message_id)` — fetch full message including body and attachments
  - `get_attachment(mailbox, message_id, attachment_id)` — download attachment bytes
  - `send_reply(mailbox, message_id, body_html)` — reply in-thread from the shared mailbox
  - `mark_read(mailbox, message_id)` — mark message as read in Outlook
- [ ] New `backend/services/graph_subscription.py` — manages the Graph change notification subscription:
  - `create_subscription(mailbox)` — POST to Graph to subscribe to new messages in the inbox; returns subscription ID and expiry
  - `renew_subscription(subscription_id)` — PATCH to extend; Graph subscriptions expire every 3 days (max)
  - `delete_subscription(subscription_id)` — cleanup
  - Subscription ID and expiry stored in MongoDB `settings` collection
- [ ] Add startup event in `server.py`: check if subscription exists and is not expired; create or renew as needed
- [ ] Add a background renewal task (runs every 47 hours) to renew before the 72-hour expiry — prevents a lapse that would cause missed messages
- [ ] **Fallback:** if subscription lapses (server restart, renewal failure), fall back to polling `GET /users/{mailbox}/mailFolders/inbox/messages?$filter=isRead eq false` on a 60-second interval until subscription is re-established

---

### 11.2 — Inbound Message Processing

- [ ] New `POST /api/inbox/graph-webhook` endpoint — Graph calls this when a new message arrives:
  - Validate the Graph notification signature (prevent spoofing)
  - Handle the initial `validationToken` handshake (Graph sends this once to verify the endpoint)
  - Fetch the full message from Graph using the `messageId` in the notification
  - Deduplicate (Graph may send duplicate notifications) — check `graph_message_id` in MongoDB before inserting
  - Process and store as a `sales_inbox` document (see schema below)
  - Return `202 Accepted` immediately — processing is async via `BackgroundTasks`
- [ ] New MongoDB collection: `sales_inbox`

```
{
  graph_message_id: str,         // Graph message ID — dedup key
  graph_conversation_id: str,    // Thread grouping key
  from_email: str,               // sender email address
  from_name: str,                // sender display name
  subject: str,
  body_preview: str,             // first 255 chars, plain text
  body_html: str,                // full rendered body
  received_at: datetime,
  has_attachments: bool,
  attachments: [                 // metadata only; content fetched on demand
    { id, name, content_type, size_bytes }
  ],
  customer_id: int | null,       // Odoo res.partner id — null if unknown sender
  customer_name: str | null,
  is_unknown_sender: bool,
  ticket_id: str | null,         // Sales ticket ID if converted
  status: str,                   // unhandled | ticket_created | pending_onboarding | archived
  is_reply: bool,                // true if this is a reply to an existing thread
  linked_ticket_id: str | null,  // populated when reply matched to existing ticket
  created_at: datetime,
  handled_by: str | null,        // username of staff member who acted on it
  handled_at: datetime | null
}
```

- [ ] **Customer matching logic** (runs on every inbound message):
  1. Look up `from_email` in Odoo `res.partner` (email field) — exact match
  2. If no match, check MongoDB customer records for the email
  3. If still no match → `is_unknown_sender: true`, `customer_id: null`
- [ ] **Thread matching logic** (runs on every inbound message):
  1. Check `graph_conversation_id` against existing `sales_inbox` documents and `ticket` records
  2. If match found and ticket exists → this is a reply → set `is_reply: true`, `linked_ticket_id` → append to ticket's email thread timeline; do not surface as a new unhandled item
  3. If match found but no ticket yet → group with existing inbox item (same conversation)
  4. If no match → new conversation → standalone inbox item

---

### 11.3 — Sales Inbox API Routes

- [ ] `GET /api/inbox` — list inbox items, paginated, filterable:
  - `?status=unhandled|all|pending_onboarding|archived`
  - `?unknown_only=true`
  - Returns: id, from, subject, preview, received_at, customer name, status, has_attachments, ticket_id
- [ ] `GET /api/inbox/{id}` — full inbox item including body_html and attachment list
- [ ] `GET /api/inbox/{id}/attachment/{attachment_id}` — stream attachment bytes from Graph on demand; no storage needed
- [ ] `POST /api/inbox/{id}/create-ticket` — convert to sales ticket:
  - Requires `customer_id` to be resolved (cannot create ticket for unknown sender)
  - Creates a sales ticket record (same MongoDB document as Phase 8 creates)
  - Updates inbox item: `status: ticket_created`, `ticket_id`, `handled_by`, `handled_at`
  - Returns the new ticket ID → frontend navigates to quote builder
- [ ] `POST /api/inbox/{id}/link-customer` — assign a customer to an unknown sender:
  - Body: `{ customer_id: int }`
  - Updates `customer_id`, `customer_name`, `is_unknown_sender: false` on the inbox item
  - Does not create a ticket — staff still needs to explicitly do that
- [ ] `POST /api/inbox/{id}/start-onboarding` — flag for new customer onboarding:
  - Sets `status: pending_onboarding`
  - Optionally pre-fills and sends the onboarding form link to `from_email`
  - Inbox item stays visible until onboarding completes and customer is linked
- [ ] `POST /api/inbox/{id}/reply` — send a reply from the shared mailbox:
  - Body: `{ body_html: str }`
  - Calls `graph_client.send_reply()` — goes out as a genuine in-thread reply from `orders@bassanihealth.com`
  - Audit-logged as `inbox.reply`
- [ ] `POST /api/inbox/{id}/archive` — mark as not relevant:
  - Sets `status: archived`; soft delete only
  - Optionally marks as read in Outlook via Graph
- [ ] `GET /api/inbox/unhandled-count` — returns `{ count: int }` — used for the sidebar badge

All routes require `require_permission("inbox.view")` or `require_permission("tickets.sales")`.

---

### 11.4 — Sales Inbox UI (`SalesInbox.js`)

New view at `/inbox`, added to sidebar nav between Dashboard and Sales Tickets.

**Sidebar nav item:**
- Label: "Sales Inbox"
- Icon: `Mail` (lucide)
- Unhandled count badge (red dot with number) — live-polled every 60 seconds via `GET /api/inbox/unhandled-count`
- Gated by `tickets.sales` or new `inbox.view` permission

**Inbox list view:**

Filter chips: `Unhandled` (default) · `All` · `Unknown Senders` · `Pending Onboarding` · `Archived`

Each row shows:
- Sender name + email
- Subject line
- Body preview (truncated)
- Received timestamp (relative: "2 hours ago")
- 📎 attachment indicator if present
- Customer chip: green "City Clinic" if matched, amber "Unknown Sender" if not
- Status badge: `Unhandled` · `Ticket Created — ST-043` · `Pending Onboarding` · `Archived`

Row click → opens the detail panel (slide-in right panel, same pattern as SalesTickets detail).

**Inbox detail panel:**

- Full rendered email body (sandboxed iframe or sanitised HTML)
- Attachment list: filename, size, Download button (fetches from `/attachment/{id}` on demand)
- **Customer section:**
  - Known customer → name card with "View Profile" link
  - Unknown sender → search-and-link dropdown ("Assign to existing customer") + "Start Onboarding" button
- **Email thread history** — prior messages in the same `graph_conversation_id`, collapsed, expandable
- **Reply composer** — textarea + "Send Reply" button; reply goes from `orders@bassanihealth.com` in-thread
- **Action bar:**
  - `Create Sales Ticket` (primary, disabled until customer is resolved)
  - `Archive` (secondary)
- If ticket already created → shows "View Ticket ST-043" link instead of create button

---

### 11.4 — Inbox Infrastructure Hardening (2026-07-05)

Three architectural gaps identified after Graph API went live:

**11.4.1 — Eager R2 attachment storage for Graph messages** — *Complete*
- [x] `inbox_service.py::ingest_graph_message()`: after inserting the inbox doc, immediately downloads all attachment bytes via `get_attachment_content()` and stores them in R2 at `inbox/{collection}/{graph_message_id}/atts/{attachment_id}`
- [x] Attachment metadata updated with `r2_key` so future reads never touch Graph API
- [x] `save_attachment_to_profile()` and `save_documents` batch endpoint: check `att_meta.r2_key` first (R2 read), fall back to live Graph call for messages ingested before this change, then IMAP MongoDB store
- [x] `r2_client.py`: added `r2_get(key) -> bytes` helper

**11.4.2 — Graph `sendMail` for new outgoing emails** — *Complete*
- [x] `graph_client.py`: added `send_mail(to_email, subject, body_html, file_attachments, mailbox_address)` using `POST /users/{mailbox}/sendMail` — saves to Sent Items, no SMTP dependency
- [x] `onboarding_inbox_routes.py::send_docs()`: branches on `use_graph` flag — Graph path uses `send_mail()`, IMAP path uses existing `imap_send_new_email()`; removed hard 503 when IMAP not configured
- [x] Sales inbox replies already used `graph_send_reply()` (Graph API) — no change needed

**11.4.3 — Robust `conversationId` thread grouping** — *Complete*
- [x] `inbox_service.py::ingest_graph_message()`: thread lookup now finds any existing message with the same `conversationId` (not just `is_reply: False`), then propagates `thread_root_id` the same way the IMAP path does — handles out-of-order delivery and avoids duplicate thread roots

**Also fixed in this deploy:**
- [x] Graph poll and startup catchup changed from `isRead eq false` to `receivedDateTime ge {72h_cutoff}` — matching IMAP's 72-hour window so full history syncs on first connect
- [x] `mailbox_address` returned by both `list_inbox` endpoints and displayed in TopBar subtitle of SalesInbox and OnboardingInbox

---

### 11.5 — Sales Ticket Integration

Changes to the existing Sales Ticket system (Phase 8):

- [ ] Add optional `inbox_item_id` field to the ticket MongoDB document — set when ticket is created from an inbox item
- [ ] Ticket detail view in `SalesTickets.js`: add **Email Thread** section at the bottom when `inbox_item_id` is set:
  - Shows the original email (subject, sender, body preview, attachments)
  - Shows any subsequent replies received (`is_reply: true` items sharing the same `graph_conversation_id`)
  - "Reply" button opens composer inline → sends via Graph
- [ ] When a reply arrives that matches an existing ticket's conversation ID, it auto-appends to the ticket's thread and triggers a visual notification (toast: "New reply on ST-043 from City Clinic")
- [ ] Ticket list view: add optional "Source" column — `📧 Email` badge vs `Portal` or `Direct` for tickets not created from inbox

---

### 11.6 — Permissions & Audit

- [ ] Add `inbox: { view: false }` to `DEFAULT_ADMIN_PERMISSIONS` and `FULL_PERMISSIONS`
- [ ] Gate all inbox routes with `require_permission("inbox.view")`; creating tickets still requires `tickets.sales`
- [ ] Add `inbox.view` toggle to the permissions editor in `Users.js`
- [ ] Audit log entries: `inbox.ticket_created`, `inbox.customer_linked`, `inbox.onboarding_started`, `inbox.reply`, `inbox.archived` — each captures the staff actor and the inbox item / customer involved

---

### Definition of Done

- [ ] New email sent to `orders@bassanihealth.com` appears in the Sales Inbox within 30 seconds (Graph push notification)
- [ ] Email from a known customer shows their name and "Create Sales Ticket" is immediately available
- [ ] Email from an unknown sender shows "Unknown Sender" and requires customer resolution before a ticket can be created
- [ ] Creating a ticket from an inbox item opens the quote builder with the customer pre-selected and the inbox item linked
- [ ] A customer reply to an existing ticket's thread appears in the ticket detail view, not as a new unhandled inbox item
- [ ] Replying from the portal sends a real in-thread email from `orders@bassanihealth.com` visible in the customer's Outlook thread
- [ ] Attachments (PDF POs) are downloadable from within the portal without storage infrastructure — fetched from Graph on demand
- [ ] Graph subscription auto-renews before the 72-hour expiry; if it lapses, polling fallback kicks in
- [ ] Unhandled inbox count badge on sidebar nav stays accurate
- [ ] All inbox actions (create ticket, reply, archive, link customer) are audit-logged with actor identity

### Notes

> **2026-06-27:** Microsoft 365 confirmed via MX record lookup (`bassanihealth-com.mail.protection.outlook.com`). Shared mailbox `orders@bassanihealth.com` confirmed in active use. Microsoft Graph API (Option 2) selected over Resend Inbound — no DNS changes needed, reply-in-thread capability, attachment streaming, real-time push notifications. **Blocked on:** M365 admin completing Azure app registration (11.0) and providing Tenant ID, Client ID, Client Secret. No backend work can start until credentials are in Railway env vars.

---

## Phase 12 — Barcode Integration

**Goal:** Every product in the system has a scannable barcode. Staff can scan a barcode in the quote builder to instantly add a product line without typing. Admins can print professional barcode labels directly from the Products page. The vault team leader scans finished goods batches in at the vault as they arrive from production, and scans them out at dispatch — creating the physical handoff record that bridges the Phase 13 production chain to the commercial order pipeline.

**Estimate:** 1–2 weeks  
**Status:** 🟡 In Progress — 12.0 complete  
**Completed:** Sub-deploy 1 (12.0 Backend foundation) — 2026-06-29

### Context

Odoo stores a `barcode` field on every `product.product` record — EAN-13, Code-128, or any custom format. This field is already part of the Odoo data model and does not require any module to be installed. The portal currently ignores it entirely.

Three distinct integration points are in scope:

1. **Quote builder** — scan a physical barcode to look up and add a product line, eliminating typed search for catalogue items that have been barcoded
2. **Label printing** — generate print-ready barcode labels from the Products page, so the warehouse can label stock without a separate label management system
3. **Vault movement scanning** — the team leader (warehouse supervisor role) at the vault scans batches as they arrive from production (Vault IN) and scans orders at dispatch (Vault OUT); this is not a per-packer handheld flow — packers work under their team leader who handles the scanning station and marks completion

**Operational model (confirmed 2026-07-01):** Packers do not have their own scanning devices. Team leaders manage their packing team and are responsible for recording completions. The scanner sits at the vault — the physical boundary between the manufacturing/production side and the commercial/sales side. Scanning IN records finished goods entering the vault from production (creating or linking to an Odoo stock lot). Scanning OUT confirms goods leaving the vault on a dispatched order.

**Batch suffix progression and who creates it:** The batch suffix is *generated and advanced by Phase 13 production module events*, not by the vault scan. By the time a batch arrives at the vault, it already carries its full suffix (e.g. `-MP3G`) on the label applied during the production stage that produced it. The vault IN scan reads that label and records the receipt — it doesn't create the suffix. Phase 13 is what generates and advances suffixes as material moves through cultivation → manufacturing → packaging stages.

**Barcode scanner hardware:** USB and Bluetooth scanners emulate keyboard input — when a barcode is scanned, the scanner types the barcode digits into whatever input field is focused, followed by an Enter key. This means USB scanner support in any input field requires zero code changes — the scanner just types. Camera scanning uses `@zxing/browser` (the browser port of the ZXing barcode library — cross-platform, works in Chrome, Firefox, Safari, and Android WebView).

**Barcode types supported:** EAN-13 (most common for cannabis products in SA), Code-128 (alphanumeric, common for internal warehouse labels), QR Code.

**New npm dependencies (frontend only — no backend packages needed):**
- `@zxing/browser` — camera-based barcode scanning (React SPA and supervisor.html vault scanner)
- `JsBarcode` — barcode SVG generation for label printing (React SPA only)

---

### 12.0 — Odoo Barcode Field Exposure (Backend Foundation) ✅

Before any front-end scan or print feature can work, the barcode field must be read from Odoo and available in API responses.

- [x] Add `barcode` to `PRODUCT_FIELDS` in `product_routes.py` — every `list_products` and `get_product` response now includes the barcode value (or `null` if not set in Odoo)
- [x] Add `barcode` to `ProductCreate` and `ProductUpdate` Pydantic models — allows setting/clearing a product's barcode from the portal product form (no Odoo trip needed)
- [x] New `GET /api/products/barcode/{barcode_value}` endpoint:
  - Searches `product.product` in Odoo for `[('barcode', '=', barcode_value)]` scoped to the user's resolved warehouse/company (same `resolve_warehouse_id()`/`get_company_id()` pattern as every other product read)
  - Returns the same product shape as `GET /api/products/{id}` — name, SKU, price, stock, tax rate, barcode
  - Returns `404` with a human-readable message if no match: `"No product found for barcode {barcode_value}"`
  - Returns `409` if multiple products share the same barcode (should not happen but Odoo permits it — surface clearly rather than silently returning one)
  - Registered ahead of `GET /{product_id}` so the literal `barcode` path segment is never captured by the `{product_id}: int` catch-all (would otherwise 422)
  - **Deviation from original spec:** gated by `get_current_user` only, not `require_admin`/`tickets.sales` specifically — matches the existing `GET /api/products/` gate exactly. This also means the lookup is available to the reseller order cart (8.12), not just staff — consistent, since both surfaces are legitimate order-building UIs
- [x] `barcode` column added to the Products admin table — `hidden lg:table-cell` (lower priority than SKU, which is already shown inline under the product name); dash shown if unset
- [x] `Barcode` input field added to the product create/edit form, next to SKU

**Note on variant scope:** Barcode is written at the `product.template` level (same write-path pattern as name/SKU/price/category for this catalog — see Phase 3.1's design decision) via the existing `create_product`/`update_product` functions, which already resolve any variant id to its parent template before writing. This is consistent with the established design, not a new pattern.

---

### 12.1 — Quote Builder Product Scan

**Goal:** In the direct inquiry quote builder (Sales Tickets), a sales rep can scan a product barcode to add it to the quote without typing. Works with both a USB/Bluetooth scanner plugged into the desk and via the device's camera.

**USB/Bluetooth scanner support (zero code required):**
USB and Bluetooth scanners emulate a keyboard — they type the barcode value and press Enter. The quote builder's existing per-row product search input already captures keyboard input. The only addition needed is: when the input value is submitted (Enter pressed) without the user selecting from the dropdown, attempt a barcode lookup before showing "no results".

- [ ] In the quote builder's per-row product search, on `Enter` keydown with no dropdown selection active:
  - If the input value looks like a barcode (all digits, or recognisable Code-128 pattern) → call `GET /api/products/barcode/{value}` immediately
  - On match: auto-populate the product line (name, unit price, tax rate) and clear the search input — identical to selecting from the dropdown
  - On no match: show inline error "No product found for barcode — try searching by name"
  - This covers USB scanners with no UI changes needed on the scanner detection side

**Camera scanning:**
- [ ] Add `@zxing/browser` to `package.json`
- [ ] Add a small "Scan" icon button (camera icon, lucide) to each product row in the quote builder, positioned left of the product name search input
- [ ] Clicking the Scan button opens a compact camera modal:
  - Live camera feed (requests camera permission on first use; remembered thereafter)
  - Scanning overlay with a centred scan-zone rectangle (visual guide for alignment)
  - "Cancel" button closes without scanning
  - On barcode detected: modal closes automatically; calls `GET /api/products/barcode/{value}`; on match auto-fills the row; on no match shows a toast and re-opens the modal for retry
- [ ] Camera modal prefers rear-facing camera on mobile (`facingMode: "environment"`) — natural for pointing at a product label
- [ ] The modal is a shared component (`BarcodeScanner.js`) so it can be reused in Phase 12.3

---

### 12.2 — Barcode Label Printing (Commercial Products)

> **Scope:** This is for commercial product shelf/pick labels — printed by admin from the Products admin page for labelling inventory, shelves, or pick locations. It is **not** for production batch labels. Production batch labels are a Phase 13 concern and are printed at the end of each manufacturing stage as part of the RP sign-off workflow. Both label types use Bassani's existing label printer and the same `JsBarcode` library, but they serve different purposes, are triggered by different people, and carry different information.

**Goal:** An admin can generate and print a professional barcode label for any product directly from the Products page — no Dymo software, no label management system, just a browser print dialog.

- [ ] Add `JsBarcode` to `package.json`
- [ ] **Single label:** "Print Label" button (printer icon) in each product row's actions column on the Products table — visible to users with `products.manage`
- [ ] **Batch print:** checkbox column on the Products table (similar to the existing select-all pattern for other bulk actions); "Print Selected Labels" button appears in the table toolbar when any rows are checked
- [ ] Clicking Print Label (single or batch) opens a `BarcodePrintPreview` modal:
  - Renders one label card per product using `JsBarcode` to generate an SVG barcode
  - Label layout:
    - Bassani Health logo/wordmark (small, top)
    - Product name (bold)
    - SKU (`default_code`) below name
    - Barcode SVG (centred, large — EAN-13 or Code-128 depending on barcode format)
    - Barcode digits printed below the bars (standard label convention)
    - Sale price (bottom right)
  - Label size selector: `38mm × 25mm` (small), `57mm × 32mm` (medium), `100mm × 50mm` (A4-friendly), Custom
  - A "Print" button triggers `window.print()` — the browser's native print dialog opens, showing only the label(s) (modal content uses `@media print` CSS to hide everything else)
  - Labels tile on the printed page for batch prints — 2-up or 4-up depending on selected label size
- [ ] If a product has no barcode set in Odoo, the Print Label button shows a tooltip "No barcode set — edit this product to add one" and is disabled
- [ ] `@media print` CSS in the modal hides the portal chrome (sidebar, topbar, modal frame) and shows only the label cards — no full-page PDF generation needed

---

### 12.3 — Vault Movement Scanning (Team Leader)

**Goal:** The team leader (warehouse_supervisor role) scans finished goods batches in and out at the vault using a USB scanner or tablet camera. Vault IN records stock received from the production floor into Odoo. Vault OUT confirms items dispatched on a packing board order. This is the physical junction point between the Phase 13 production chain and the commercial order pipeline.

> **Not a per-packer handheld flow.** Packers are supervised by their team leader, who handles scanning. The scanner station lives at the vault, not in the hands of each individual packer. The `packer.html` per-packer device concept is not applicable here — team leaders work from `supervisor.html` or the vault scanner interface. `packer.html` may be repurposed or retired as this model solidifies.

**Interface — `vault.html` (new standalone page, same pattern as `supervisor.html`):**

A new dedicated vault scanning screen accessible to `warehouse_supervisor` role (same JWT login-gate pattern as `supervisor.html`). Two tabs:

**Tab 1 — Vault IN (Goods Receipt from Production)**

- [ ] Scan input field prominent at top — USB scanner types barcode and hits Enter automatically; camera scan button available as fallback
- [ ] On scan: calls `GET /api/products/barcode/{value}` (Phase 12.0 endpoint) to identify the product
- [ ] System displays: product name, SKU, current vault stock, and (once Phase 13 is live) the matched batch ID from the production module
- [ ] Team leader enters: **quantity received** and **batch/lot ID** (free-text for Phase 12; auto-populated by Phase 13 when built — the label arriving from production already has the full batch ID including suffix printed on it)
- [ ] New backend endpoint: `POST /api/vault/receive`:
  - Creates an Odoo stock receipt (`stock.picking`, picking type `incoming`, validated immediately) for the resolved warehouse's input location
  - Creates or updates an Odoo `stock.lot` with the provided lot/batch ID string on the received product
  - Writes a portal-side `vault_movements` MongoDB document: `{ type: "in", product_id, product_name, barcode, lot_id, qty, actor_id, actor_name, warehouse_id, received_at, linked_batch_id (Phase 13 ref, nullable) }`
  - Audit-logged: `vault.receive` with product, lot, qty, actor
- [ ] On success: confirmation flash + running tally of received items in the current session (so team leader can verify their delivery against a packing slip)
- [ ] If barcode not found in Odoo (404 from barcode lookup): warn clearly — "Product not found for this barcode. Has it been added to the product catalogue?" — do not proceed

**Tab 2 — Vault OUT (Dispatch Confirmation)**

- [ ] Displays the current packing board queue for the team leader's warehouse — open orders with packing in progress or ready
- [ ] Team leader selects an order to dispatch
- [ ] Scan mode activates: scan each item barcode to confirm it's leaving the vault
- [ ] On scan match against the order's items (matched via `barcode` field stored on packing board `items` — see data model below):
  - Item ticked on the packing board (fires the existing `tick_item` WebSocket action — same path as supervisor manually ticking)
  - Green flash on matched row
- [ ] If all items scanned: "Ready to dispatch" confirmation prompt → team leader confirms → order status updated to dispatched; triggers the existing "ready for collection" email flow
- [ ] Manual tick fallback remains — team leader can tap items if scanner unavailable; scan is additive, not a replacement

**Data model change — barcode on packing board items (needed for Vault OUT scan matching):**

- [ ] When a packing board entry is created (`packing_board_routes.py::confirm_order()` and `_do_adopt()`), batch-fetch the `barcode` field for all `product_id` values from Odoo — one batched `read()`, not one per line
- [ ] Store `barcode` (string or `null`) on each item in the `items` array alongside existing `{ product_id, name, qty, ticked }`
- [ ] **Backfill endpoint:** `POST /api/packing/backfill-barcodes` (admin/super_admin only) — iterates existing packing board entries, fetches missing barcodes from Odoo, writes them back; idempotent; run once after deploy

**Phase 13 linkage (design constraint for Phase 12 implementation):**

The vault IN endpoint is designed to accept a `linked_batch_id` reference that Phase 13 will populate once the production module exists. For Phase 12, this field is always `null` — the team leader manually types the batch ID from the physical label. When Phase 13 ships, the vault scan will auto-match the scanned barcode to an open production batch record, and the `linked_batch_id` will be written automatically. Phase 12 must not design the vault receipt endpoint in a way that prevents this linkage later — the `vault_movements` document must always carry the `linked_batch_id` field, even if null.

---

### Definition of Done

- [x] Every product with a barcode set in Odoo shows that barcode value in the Products admin table
- [x] Setting a barcode on a product from the product create/edit form writes it to Odoo correctly
- [ ] In the quote builder, typing a barcode and pressing Enter (USB scanner flow) auto-populates the product row without needing to select from the dropdown
- [ ] In the quote builder, clicking the camera scan button and presenting a barcoded label fills the product row instantly
- [ ] An unknown barcode (not in Odoo) shows a clear "no product found" message, not a crash
- [ ] A product with a barcode shows a Print Label button; a product without a barcode shows the button as disabled with a tooltip
- [ ] Printing a single label opens the browser print dialog with only the label visible — no portal chrome
- [ ] Printing 4 selected products prints 4 labels tiled on one page
- [ ] `vault.html` is accessible to warehouse_supervisor role and requires JWT login (same gate as `supervisor.html`)
- [ ] Team leader scans a barcode on Vault IN tab — product is identified, qty entered, stock receipt created in Odoo with correct lot/batch ID, `vault_movements` document written to MongoDB, audit entry logged
- [ ] Team leader scans an unrecognised barcode — clear "product not found" warning shown, no receipt created
- [ ] On Vault OUT tab, scanning an item barcode ticks it on the packing board display in real time
- [ ] When all items on an order are scanned out, the dispatch confirmation prompt appears
- [ ] `vault_movements` documents include `linked_batch_id: null` field (ready for Phase 13 auto-population)
- [ ] Packing board entries created before this deploy can have barcodes backfilled via the admin endpoint
- [ ] All vault IN/OUT actions appear in `audit_logs` with actor identity (warehouse_supervisor)

### Notes

> **Sub-deploy 1 (2026-06-29):** 12.0 Backend foundation. `barcode` added to `PRODUCT_FIELDS`, `ProductCreate`, and `ProductUpdate` — writes go through the existing template-level write path (Phase 3.1's established pattern for this catalog: name/SKU/price/category/tax are template-level, no per-variant overrides exposed). New `GET /api/products/barcode/{barcode_value}` registered ahead of `GET /{product_id}` in the route file (literal path segments must come before the `{product_id}: int` catch-all, or "barcode" would be parsed as an int and 422 before ever reaching the new route). Gated by `get_current_user` only — deliberately broader than the original spec's `require_admin`/`tickets.sales` suggestion, to match the existing `GET /api/products/` gate and to cover the reseller order cart (8.12) as well as the staff quote builder, since both are legitimate places to scan a barcode. Frontend: Barcode column on the Products table (`hidden lg:table-cell` — lower priority than SKU, which already shows inline) and a Barcode input on the create/edit form. 12.1 (quote builder scan) is next — will wire the lookup endpoint into both the staff quote builder and the reseller cart via a shared `BarcodeScanner` component.

> **2026-07-01 — Operational model confirmed, Phase 12.3 rewritten:** Business confirmed that packers do NOT have their own scanning devices. The barcode scanner sits at the vault — the boundary between the production floor and the commercial side. Team leaders (warehouse_supervisor role) operate the scanner station: scanning finished goods batches IN to the vault as they arrive from manufacturing, and scanning items OUT on dispatch. Phase 12.3 has been completely redesigned from "Packer Handheld Scan-to-Tick" to "Vault Movement Scanning (Team Leader)" — a new `vault.html` interface with two tabs (Vault IN / Vault OUT), a new `POST /api/vault/receive` backend endpoint that creates Odoo stock receipts and `vault_movements` MongoDB documents, and the existing packing board tick action wired to the Vault OUT scan. Key design constraint: the `vault_movements` document carries a `linked_batch_id` field (null in Phase 12) that Phase 13 will populate once the production module generates batch IDs — the Phase 12 implementation must not close that door.

---

---

## Phase 13 — Production & Cultivation Module (GrowerIQ In-House)

**Goal:** Build Bassani Health's own seed-to-sale production tracking system into the portal, replacing the need for a third-party platform like GrowerIQ. Covers the full upstream lifecycle — cultivation through to finished goods entering the vault — with SAHPRA compliance reporting as the primary regulatory output and yield intelligence as the primary operational output.

**Estimate:** To be scoped — significant. Likely 2–3 months of active development.  
**Status:** 🔵 Concept — Needs Scoping  
**Blocked on:** SAHPRA reporting requirements (exact fields, formats, submission method) must be obtained before any data model can be finalised. Do not design the schema without them.

> **Origin:** Bassani Health attended a meeting with GrowerIQ (June 2026) to evaluate their platform. Decision is to build the equivalent in-house, retaining full data ownership and tight integration with the existing commercial portal. The commercial portal already covers the downstream (vault → sales); this phase covers the upstream (cultivation → vault).

> **Compliance standard:** GrowerIQ provided their EU GMP Annex 11 (Computerised Systems) compliance mapping in June 2026. EU GMP Annex 11 is the pharmaceutical industry standard governing how software managing medicinal product manufacturing must behave — covering audit trails, access control, electronic signatures, data integrity, and batch release. SAHPRA aligns with EU GMP for medicinal cannabis in South Africa, making this the most likely standard Bassani must satisfy. Building against Annex 11 from the start is the correct design target. Confirm explicitly with Bassani's compliance officer before scoping begins.

---

### Architectural Vision

The portal already operates as two conceptual halves that share infrastructure. This phase formalises the upstream half:

```
╔══════════════════════════════════════════════════════════════╗
║  PRODUCTION SIDE (Phase 13 — new)                           ║
║                                                              ║
║  CULTIVATION (GACP facility)                                 ║
║    Grow rooms → plant batches → veg → flower → harvest       ║
║    Yield record: expected band vs actual weight              ║
║    Variance investigation if outside band                    ║
║          ↓                                                   ║
║  MANUFACTURING                                               ║
║    Processing → formulation → batch records                  ║
║    QA testing → RP sign-off                                  ║
║          ↓                                                   ║
║  PACKING & LABELLING                                         ║
║    Finished goods → barcode applied → SAHPRA lot number      ║
║          ↓                                                   ║
╚══════════════════════════╦═══════════════════════════════════╝
                           ║  (goods received into Odoo vault)
╔══════════════════════════╩═══════════════════════════════════╗
║  COMMERCIAL SIDE (existing portal)                           ║
║                                                              ║
║  VAULT (Odoo inventory)                                      ║
║    product.product + barcode + stock.lot + qty_available     ║
║          ↓                                                   ║
║  SALES                                                       ║
║    Resellers → quotes → orders → packing board → dispatch    ║
╚══════════════════════════════════════════════════════════════╝
```

**The vault scanner (Phase 12.3) is the junction point.** When finished goods arrive at the vault from production, the team leader scans the batch label — the barcode/lot number on that label is the same identifier that traces back through manufacturing to the cultivation batch. The vault IN scan is what converts a Phase 13 production batch into Phase 12 commercial stock. The vault OUT scan on dispatch is what links a sale order to the specific physical batch that fulfilled it. This is the traceability chain SAHPRA compliance requires.

---

### Data Model Philosophy — Same Pattern as Sales Tickets

This is already stated in the Architecture Principles above, but it is worth making explicit for Phase 13 because the temptation to build custom MongoDB logbooks will be strong.

**The Sales Ticket pattern is the template for every Phase 13 module:**

```
SALES TICKET (existing — correct pattern)
──────────────────────────────────────────
MongoDB  →  sales_tickets collection
           { stage, assigned_to, inbox_item_id, notes, created_at }
           Tracks: pipeline stage, who owns it, portal-layer metadata

Odoo     →  sale.order  (the quote, the prices, the line items)
           account.move  (the invoice)
           stock.picking  (the delivery)

The portal NEVER rebuilds these Odoo objects. It creates them in Odoo
and tracks the workflow state in MongoDB on top.
```

**Apply the same split to Phase 13:**

```
MANUFACTURING SESSION (Phase 13 — same pattern)
────────────────────────────────────────────────
MongoDB  →  production_sessions collection
           { stage, tl_verified_by, qa_verified_by, rp_released_by,
             batch_id, notes, created_at }
           Tracks: approval workflow state, portal-layer sign-off chain

Odoo     →  mrp.production  (the manufacturing order — inputs, outputs,
                              quantities, lot numbers, by-products)
           stock.picking    (internal transfer between locations)
           stock.lot        (the batch ID as the lot name)
           purchase.order   (supplier receipts for gummies)

The portal creates these Odoo objects. It NEVER rebuilds them in MongoDB.
```

**What belongs in MongoDB (genuinely no Odoo equivalent):**
- `cultivation_batches` — GACP room/row/plant tracking (plants are not Odoo inventory items before harvest)
- `yield_bands` — per-strain expected yield ranges, auto-calibrating from completed harvests
- `batch_investigations` — out-of-band yield investigation records and resolutions
- `sahpra_reports` — compliance report submissions, field mappings, submission status
- `signature_events` — Annex 11 §30 re-authentication events at sign-off (the who/when/what of a formal e-signature)
- `production_sessions` — workflow state overlay on top of Odoo `mrp.production` (same role as `sales_tickets` over `sale.order`)

**What must NOT be in MongoDB:**
- Manufacturing input/output quantities (these are on the Odoo MO)
- Stock movements between locations (these are Odoo `stock.picking`)
- Lot/batch stock levels (these are Odoo `stock.quant`)
- Finished goods on hand (Odoo `qty_available` per lot)

If we store these in MongoDB we create a parallel ledger — the exact violation the Architecture Principles prohibit.

---

### Annex 11 Compliance — What We Already Have

The existing portal satisfies more of EU GMP Annex 11 than might be expected — because the same engineering decisions that make the commercial portal auditable also satisfy pharmaceutical computerised system requirements.

| Annex 11 Requirement | Clause | Status in existing portal |
|---|---|---|
| Named users with defined roles and access levels | §2 | ✅ Phase 0 — full permission system, role-based access |
| Comprehensive audit trail — actor, timestamp, before/after, reason | §22 | ✅ Phase 0.6 — built to this exact spec |
| Identity recorded on every data entry, change, confirmation, deletion | §25–28 | ✅ Phase 0 + 0.6 cover all four requirements |
| Access authorisation changes recorded | §27 | ✅ User create/update/deactivate logged in audit trail |
| Time and date on all signed/confirmed actions | §30 | ✅ Every audit entry has UTC timestamp |
| Secure API with authentication tokens | §16 | ✅ JWT + 2FA (Phase 1.5) |
| Regular data backups | §19 | ✅ Railway MongoDB daily backups |
| Incident management and error monitoring | §29 | ✅ Sentry (Phase 6) |
| Printable records | §20 | ✅ Phase 12 barcode/label printing |

**The one significant gap: Electronic Signatures (§30–31)**

Annex 11 §30 requires that electronic signatures are permanently linked to their respective record, include time and date, and carry the same legal weight as a handwritten signature. §31 requires that only a Qualified Person can certify batch release, using an electronic signature.

GrowerIQ's implementation: **re-authentication at the point of signing** — the user enters their password again at the exact moment of approval. That credential event is permanently stored, linked to the batch record. It is not a button click authenticated by a background session token.

Currently, the portal's QA and RP approvals on the packing board are JWT-authenticated button presses. These satisfy naming and timestamping but not the formal e-signature requirement. This must be addressed in Phase 13 for production batch sign-off, and should be retrofitted to the existing QA/RP packing board approvals to bring the commercial side into full Annex 11 compliance as well.

**E-signature design (to implement in Phase 13, backport to packing board):**
- At the point of a critical sign-off action (batch release, RP approval, QA approval), the UI presents a confirmation dialog requiring the user to re-enter their password
- The backend verifies the password against the stored bcrypt hash independently of the existing JWT session
- On success, a `signature_event` document is created: `{ actor, actor_id, action, entity_type, entity_id, password_verified: true, signed_at, ip }` — permanently linked to the batch/order record
- The JWT session is unaffected — re-auth is purely for the signature event, not a login
- This satisfies Annex 11 §30 completely and is how GrowerIQ handles it

---

### Shared Infrastructure (No Duplication)

Everything from the existing portal carries over:

| Existing | How it carries into Phase 13 |
|---|---|
| Auth / permissions system | New production roles added; same `require_permission()` pattern |
| Audit trail | Every cultivation action logged with named actor; same schema — already Annex 11 compliant |
| E-signature module (to be built) | Shared by production batch sign-off and commercial QA/RP approvals |
| RP role (Rookshanna) | Already in the system; gains production batch sign-off on top of dispatch sign-off |
| Warehouse structure | GACP facility is a warehouse in Odoo; already modelled |
| Barcode field (Phase 12) | Cultivation lot → barcode → finished goods label → traceable in both portals |
| Email system | Yield alerts, batch approval notifications via existing Resend integration |
| MongoDB | Production collections sit alongside commercial collections; same database |

---

### Distinct User Population

Production staff never need to see the commercial side (resellers, commissions, invoices) and vice versa. New roles to define when scoping:

| Role (proposed) | Responsibility |
|---|---|
| `cultivation_manager` | Manage grow rooms, plant batches, advance cultivation stages |
| `lab_technician` | Log manufacturing batch records, upload test results |
| `production_supervisor` | Oversight across cultivation and manufacturing |
| `responsible_pharmacist` | Already exists — gains batch QA sign-off in addition to dispatch sign-off |

---

### Batch Numbering Standard (CONFIRMED — Bassani's own protocol, V6)

Unlike the rest of this concept section, batch numbering is **not speculative**. Bassani Health already operates an internal "Medicinal Cannabis Batch Traceability Standard (V6)" document defining the exact format. Any cultivation/manufacturing module must implement this scheme, not invent a new one.

**Base batch ID format:** `BH` + batch-type code + strain short name + sequence + date, e.g. `BHAPIBBY-001-010126`
- `BH` — Bassani Health
- `API` — single-source mixed-strain batch (literal "API" as placeholder when multiple strains in one room); or the strain's own shortcode for single-strain batches (e.g. `BHDSD...` for Dos Si Dos)
- `BBY` — Strain Short Name / shortcode (3-letter code from the Shortcodes master list, >70 strains already defined)
- `001` — sequential batch number for that strain
- `010126` — date, `DDMMYY`

**Gummy and non-flower products use a different prefix:** `BHG[flavour_shortcode]-[instance]-[DDMMYY]` e.g. `BHGPIN-001-181225` (Pineapple gummies, lot 1, packed 18 Dec 2025). These are received-from-supplier goods, not cultivated — they have expiry dates and a completely separate production flow (goods receipt → packing → secondary packing) without the GACP cultivation stages.

**Post-harvest stage suffixes** (appended to the base ID with a hyphen as material is processed):

| Stage | Suffix | Description |
|---|---|---|
| Drying | `-D` | Material in the drying room |
| Unmanicured | `-U` | Dried flower before trim/manicure |
| Manicured | `-M` | Premium flower after trim/pops removal — sub-graded as Bigs, Mids, Small in practice |
| Pops | `-P` | Small buds — parallel **byproduct** stream, NOT waste |
| Trim | `-T` | Leaf material — also a **byproduct** stream, NOT waste |
| Pops Crushed (standard) | `-PC` | Pops material crushed for standard pre-rolls |
| Trim Crushed (budget) | `-TC` | Trim material crushed for budget pre-rolls |
| Pre-Roll from Pops | `-PCPR` | Standard finished pre-roll |
| Pre-Roll from Trim | `-TCPR` | Budget finished pre-roll |

**Finished goods packaging suffixes** (appended at the primary packing stage):

| Finished Good | Suffix |
|---|---|
| Pop Top Tube — standard pre-roll | `PCPRPTT` |
| Pop Top Tube — budget pre-roll | `TCPRPTT` |
| Mylar Bag 1g (Manicured flower) | `MP1G` |
| Mylar Bag 3g (Manicured flower) | `MP3G` |
| Mylar Bag 5g (Manicured flower) | `MP5G` |
| Mylar Bag 1g (Pops flower) | `PP1G` |
| Mylar Bag 3g (Pops flower) | `PP3G` |
| Mylar Bag 5g (Pops flower) | `PP5G` |
| Jar — standard pre-roll | `PCPRPJR` |
| Jar — budget pre-roll | `TCPRPJR` |

**Blending convention:** When multiple cultivation batches are mixed, the prefix changes from `BHAPI` to `BHB` (Blend), followed by the strain short name **with no hyphen**, an instance count, and the blend date: `BHBBBY-003-220426`. A blend record links back to every parent API batch it was made from — this is the actual traceability mechanism, not something to design from scratch.

**Implementation requirement:** Batch IDs must be **generated by the portal, not typed by staff**. The live logbook data already shows inconsistent manual ID formatting (e.g. `BHADNS-240426`, `BHADNS240426-M`, `BHADNS-210526-M` all appearing for the same strain). Free-text entry creates SAHPRA audit exposure. The portal must enforce the standard format at entry time.

**Implementation implication:** batch ID generation should be a single deterministic function (strain code, sequence, date, optional stage/blend params in → formatted ID out), not free text entry — consistency of this format is what makes the traceability chain auditable.

### Production Batch Label Printing (Phase 13 — Critical Path)

**Why this belongs in Phase 13, not Phase 12:**
Phase 12.2 prints commercial product labels from the Odoo product catalogue — these identify a SKU, not a specific batch of it. Production batch labels are fundamentally different: they are the physical identity document of a specific manufactured batch. They are generated by the portal at the moment RP sign-off occurs on a packing logbook entry, carry the system-generated batch ID (enforcing the V6 standard), and are the exact label the vault team leader will scan at the Vault IN step. Without this, the traceability chain has a gap: the portal knows the batch ID internally, but the physical label was printed manually (or not at all), creating the format inconsistency already observed in the live logbook data.

**The workflow:**
1. Production supervisor records the packing session in the portal (Packing Logbook module)
2. QA approval recorded (with re-authentication, Annex 11 §30)
3. RP approval recorded (with re-authentication, Annex 11 §31)
4. **"Print Batch Label" button becomes active** — only after both approvals are on record
5. Label generated by the portal using `JsBarcode` + `window.print()` — printed on Bassani's existing label printer
6. Physical label applied to the batch
7. Batch transported to vault
8. Team leader scans the label at Vault IN — vault scanner reads the batch ID barcode, calls `GET /api/products/barcode/{value}` (Phase 12.3) to identify the product, then automatically resolves `linked_batch_id` from the production record instead of requiring manual entry (the key Phase 12→13 linkage)

**Label contents (production batch label):**
- Bassani Health logo/wordmark
- Product name and strain
- **Batch ID** (system-generated, V6 format — e.g. `BHAPIBBY-001-010126-MP3G`)
- **Barcode** of the Batch ID (Code-128, since batch IDs are alphanumeric)
- Stage / finished good description (e.g. "Manicured Flower — Mylar Bag 3g")
- Quantity / net weight
- Manufacturing / packing date
- RP release name and date
- "For Medicinal Use Only — Dispensing by Authorised Prescriber Only" (or Bassani's required compliance text)
- Expiry date (where applicable — gummies, pre-rolls)

**Label size:** Configured for Bassani's existing label printer (standard 57mm × 32mm thermal format). The `@media print` approach used in Phase 12.2 is reused here — browser triggers the print dialog, Bassani's label printer is set as the default printer, no Dymo SDK or third-party print software required.

**Design decisions:**
- **Print button gated on both approvals** — the system will not generate a printable label until QA and RP have both signed off. This is not a soft warning; the button does not exist in the UI until the approvals are on record. This makes label printing the physical consequence of system sign-off, not a separate step that can be done before approval.
- **Batch ID is generated by the system, not typed** — eliminates the format inconsistency already present in the live Excel logbooks (see Batch Numbering Standard above). The label carries exactly what the system assigned.
- **One label per production record** — the print action is tied to the `production_sessions` record, not a generic label designer. Reprinting a label reprints exactly the same content, audit-logged as a reprint with actor and timestamp.
- **Vault scanner reads what the portal printed** — because the portal generated the batch ID and printed the label, the vault scanner can resolve the scanned barcode directly back to the `production_sessions` record. No manual batch ID entry at the vault. No transcription errors.

**Definition of Done (production batch labels):**
- [ ] "Print Batch Label" button visible on Packing Logbook entries only after QA + RP sign-off recorded
- [ ] Label renders correctly in browser print preview for Bassani's label printer paper size
- [ ] Printed label barcode (Code-128) scans correctly with Bassani's vault scanner hardware
- [ ] Reprinting a label creates an audit entry: actor, timestamp, batch ID
- [ ] Vault IN scan of the printed label resolves `linked_batch_id` automatically — team leader does not need to type the batch ID manually
- [ ] Gummy labels include expiry date; flower/pre-roll labels display weight and RP release date

---

### The 8 Logbooks = 8 Portal Modules (CONFIRMED from live operational data)

The production team is currently filling in 8 separate Excel sheets. Each becomes one portal form/module in Phase 13. These are active today, not theoretical.

**Column guide:** "Odoo object" is what the portal creates in Odoo for this stage. "MongoDB overlay" is the portal-layer workflow state tracking on top (same pattern as `sales_tickets` over `sale.order`). If Odoo already handles the data, we do not store it again in MongoDB.

| Logbook | What it captures | Odoo object (source of truth) | MongoDB overlay (portal layer only) |
|---|---|---|---|
| GACP Logbook | Plants per room, per row, per strain — flowering dates, expected harvest | None — plants are not in Odoo before harvest; the harvest output creates the first `stock.lot` | `cultivation_batches` — room, row, plant count, strain, expected harvest, batch ID generated here |
| Dry Room Logbook | Batch IN/OUT as material moves between locations | `stock.picking` (internal transfer: Grow Room location → Dry Room location in Odoo) | None — the Odoo transfer IS the record; portal just creates and validates it |
| Manicuring Logbook | Input batch → output per grade (Bigs/Mids/Small/Pops) + waste, per staff | `mrp.production` — input lot consumed, output lots produced (Bigs/Mids/Small as separate lots, Pops as by-product lot), waste as scrap | `production_sessions` — TL sign-off state, per-staff output attribution (Odoo MO doesn't track which staff member produced which grade) |
| Crush Logbook | Weight before/after crushing + waste — requires TL + QA dual sign-off | `mrp.production` — input lot (Pops or Trim) consumed, output lot (Crushed) produced, waste recorded | `production_sessions` — TL verification + QA verification state; neither exists natively in Odoo |
| Pre Roll Logbook | Per-staff rolling output, cone batches, grading | `mrp.production` — input lots (crushed + cones) consumed, output pre-roll lot produced, waste recorded | `production_sessions` — per-staff output attribution, cone batch reference, TL sign-off state |
| Gummy Manufacturing | Supplier receipts + in-house packing lots, expiry dates | `purchase.order` receipt (supplier → Odoo stock, expiry date on `stock.lot`) + `mrp.production` for repack if quantities are broken down | `production_sessions` — defect/shortage notes, packing session sign-off (Odoo PO receipt doesn't capture these) |
| Packing Logbook | Batch → finished SKU → primary packaging run | `mrp.production` — bulk lot consumed, finished SKU units produced with full batch ID as lot name, packaging component consumed | `production_sessions` — sign-off workflow state (TL → QA → RP before vault receipt is triggered) |
| 2ndary Packing Logbook | Client-specific secondary packing | `mrp.production` — primary packed units consumed, client-packaged units produced | `production_sessions` — sign-off state, client reference |

**Key fields in live data (unchanged from logbook review):**
- GACP: Recorded Date, Flowering Date, Room, Row, Strain, Qty (plants), Expected Harvest Date, Batch ID
- Dry Room: Date, Movement (IN/OUT), Strain, Batch Number, Quantity, Grading
- Manicuring: Date, Received Batch, Strain, Size (Bigs/Mids/Small/Pops), Input Qty (g), Output Batch, Output Size, Output Qty (g), Waste (g), Staff Name
- Crush: Date, Batch, Strain, Material Used, Weight Before (g), Weight After (g), Waste (g), **TL Verification**, **QA Verification**
- Pre Roll: Date, Starting Weight, Waste, Received Batch, Cone Batch, Pre Roll Type, Qty (units), Pre Roll Batch Ref, Net Weight (g), Staff Name, Team Leader, Sub Category (Budget/Standard), Strain, Grading, Cone Size
- Gummy: Flavour, Shortcode, Strength, Invoice, Qty Received, Date Received, Lot Instance, Qty Packed, Defects/Shortages, Date Packed, Bassani Lot ID, Expiry Date
- Packing: Date, Batch Number, Packing Batch Number, Item Description, Quantity (g/units)
- 2ndary Packing: Date, Packing Batch Number, Item Description, Batch Number, Quantity

Each of these is one input form in the portal with real-time validation, batch ID auto-generation (not typed), and actor identity captured automatically from the logged-in user — replacing the manual name column and eliminating format inconsistency.

**Grow Room**
- Physical room identifier (F1–F7 etc.), capacity (max plants), current strain(s), status (active/idle/cleaning)
- Links to Odoo `stock.warehouse` / `stock.location` for the physical space
- Rooms currently in active use: F1 (autoflower/AT tracks), F4, F5, F6, F7 — each with row-level plant tracking

**Cultivation Batch (GACP Logbook replacement)**
- Tracked at **row level within each room** — not batch level. E.g. Room F4 has 6 rows, each with its own plant count and its own entry. Batch ID is the same across all rows of a room (they're all the same harvest batch), but plant counts are recorded per row.
- Entry: Recorded Date, Flowering Date, Room ID, Row ID, Strain Name, Plant Count (Qty), Expected Harvest Date → portal generates the Batch ID
- Stage column exists in the spreadsheet but is never filled in — stage is implied by which logbook the entry is in. The portal should derive/assign stage automatically as material moves through logbooks.
- Destruction events: plants that die before harvest recorded separately from byproduct streams

**Manicured flower has sub-grades beyond M/P/T** — the live manicuring logbook tracks 4 size grades: **Bigs, Mids, Small** (all fall under the `-M` batch suffix) plus **Pops** (byproduct, `-P` suffix). The portal manicuring form must let staff log output separately per grade per session, since packing uses specific grades for specific SKUs (e.g., 5g Mylar bags get Bigs, 1g bags get Mids/Small etc.)

**Yield Band**
- Per strain: historical average yield per plant (g dry weight), expressed as a [min, max] band
- Expected yield for a batch = plant count × [band min, band max]
- Band calibrates automatically from completed harvests over time (rolling average)
- Can be overridden manually by production manager with a reason

**Harvest Record**
- Actual wet weight at harvest → actual dry weight after drying/curing
- Comparison against expected band: `within_band | above_band | below_band`
- If outside band: investigation record required before batch can proceed
  - Above band: positive investigation ("what contributed to higher yield?" — environment, strain selection, nutrients)
  - Below band: negative investigation ("what caused the shortfall?" — potential damage, theft, disease, environmental failure); full pipeline backtrace available

**Manufacturing Batch / Blend Record**
- A Manufacturing Batch is an Odoo `mrp.production` (Manufacturing Order) — the portal creates it via XML-RPC; Odoo records input lots consumed, output lots produced, by-products, and waste quantities. The portal does not store these weights in MongoDB.
- Single-source batch stays on the `BHAPI...` lot ID. Mixing two or more cultivation batches triggers a Blend Record: the portal creates a new Odoo `mrp.production` consuming the parent lots and producing a new `BHB...` lot. The blend linkage (which parent lots feed this batch) is Odoo's native MO component traceability — no MongoDB document needed for this.
- Process type (crush, pre-roll, extraction, tincture, capsule) maps to Odoo's Bill of Materials — each process type has a BoM in Odoo defining standard inputs, outputs, and by-products.
- Lab test results: attached as documents to the `mrp.production` record in Odoo (Odoo supports attachments natively on any record).
- RP sign-off: the portal records an e-signature event in MongoDB (`signature_events`) and calls `mrp.production` → action_done (validate the MO) via XML-RPC. The Odoo MO is the authoritative record; the `signature_event` is the compliance overlay.

**Finished Goods Receipt**
- When the portal validates the packing MO in Odoo (`mrp.production::action_done`), Odoo automatically:
  - Creates the finished goods `stock.lot` with the full batch ID string as the lot name (e.g. `BHAPIBBY-001-010126-MP3G`)
  - Moves the produced qty into the finished goods location
  - Records the component lots consumed (full traceability chain in Odoo natively)
- The portal then triggers the Phase 12.3 Vault IN: creates an Odoo `stock.picking` (internal transfer from finished goods location to the vault/resellable stock location) and validates it
- `barcode` (Phase 12) is set on the `product.product` record — distinct from the lot ID but linked; one barcode per SKU, many lots per SKU over time
- Once the vault transfer is validated: qty appears in `qty_available` in the reseller/Store product catalogue — no manual stock adjustment, no MongoDB stock record

**Traceability Chain — confirmed end-to-end (see Store Onboarding Agreement below)**
- Cultivation batch → manufacturing/blend batch → finished goods lot/barcode → Sale Order → **Delivery Note** → **Named Patient**, cross-referenced against their **Script** and **SAHPRA Section 21 Authorisation**
- This is not a theoretical nice-to-have — Section 10.3 of Bassani's Store Onboarding Agreement makes Bassani's own order/batch records the audit trail that proves lawful supply; a gap anywhere in this chain is a real compliance exposure, not just an internal reporting gap
- Plant count accuracy: planted vs harvested vs destroyed vs transferred
- Destruction records: date, reason, witness, quantity
- *(Exact SAHPRA report format/fields: still to be obtained — the batch ID scheme and chain endpoints are now confirmed, but the regulator's specific submission format is not)*

---

### Yield Intelligence (Operational Layer)

On top of the compliance foundation, the yield band system provides operational intelligence:

- Dashboard for production managers: current batches by room and stage, days to expected harvest, projected yield by batch
- Harvest history by strain: trend line of actual yield vs band over time — identifies improving or declining performance
- Investigation log: all above/below-band events with resolution status
- Alert system: notify production manager when a batch is approaching harvest date, when a batch falls outside band after weighing

---

### What Needs to Happen Before Scoping Can Start

1. **Obtain SAHPRA reporting requirements** — ⚠️ **Still the primary blocker.** The batch ID scheme, workflow, staff, and module scope are all now confirmed. What remains is the regulator's specific report/submission format and field requirements.
2. **Confirm EU GMP Annex 11 applies to Bassani's licence** — ask Bassani's compliance officer to confirm formally (almost certain yes, but needs written confirmation before treating as hard requirement).
3. ✅ **Walk through current cultivation workflow** — **answered by the logbook.** 8 Excel sheets currently in active use (data dated May–June 2026). Each sheet maps directly to one portal module. See table above.
4. **Determine scale integration feasibility** — Annex 11 §17 risk. Weight entry currently manual in the logbook (grams typed in free text). Confirm whether GACP facility scales have USB/serial output for direct data capture — this is the highest-risk manual entry point for SAHPRA audit.
5. ✅ **Roles/staff who use the production portal** — **partially answered.** Floor staff visible in live logbook data: Linda, Pamela, Nkateko, Lebo, Risuna, Meltah, Tristan, Cullen, Salome, Clyde, Itumeleng, Puleng. Supervisory roles: Team Leader (TL verification on Crush logbook), QA verification (separate from RP), RP (batch release). Need to confirm named individuals for TL and QA roles specifically, and whether any of the commercial portal's named staff (Cullen Grant — QA Manager, Rookshanna — RP) also appear in production sign-offs.
6. **Confirm Odoo lot/serial number usage** — whether Odoo is currently configured for lot tracking on finished goods. The lot name should be the full batch ID string (e.g. `BHAPIBBY-001-010126-PCPRPTT`) — needs verification against current Odoo config.
7. **Agree on yield band methodology** — fixed band set by production manager, or auto-calibrating from historical harvests, or both. The GACP logbook tracks expected harvest dates but not expected yield weights — yield bands would be a new data capture not currently in any spreadsheet.
8. **Confirm data retention period** — GrowerIQ: 7 years; Store Onboarding Agreement: 5 years for dispensing records. Confirm SAHPRA production-side requirement specifically.
9. **Determine where the cultivation traceability chain terminates in the existing commercial portal** — see related Section 21 gap finding below. This may require Phase 8 hardening work before Phase 13 can deliver end-to-end traceability.

---

### Notes

> **2026-06-29:** Concept recorded following a business meeting with GrowerIQ and a brainstorming session. Bassani Health's decision is to build in-house rather than license GrowerIQ — retaining data ownership, tighter integration with the commercial portal, and avoiding a third-party subscription. The Phase 12 barcode infrastructure is the direct foundation this phase builds on. No design or implementation work to begin until SAHPRA reporting requirements are in hand and the cultivation workflow has been walked through with the production team.

> **2026-06-29 — EU GMP Annex 11 analysis:** GrowerIQ shared their EU GMP Annex 11 (Computerised Systems) compliance document. Key findings: (1) The existing portal already satisfies the majority of Annex 11 requirements — audit trail §22, named user identity §25–28, secure API §16, backups §19, incident management §29 are all covered by Phases 0, 1, and 6. (2) The single significant gap is **electronic signatures** (§30–31): Annex 11 requires re-authentication at the point of critical sign-off events (batch release, QA/RP approval), not just a session-token-authenticated button click. This must be built as a shared e-signature module for both Phase 13 (production batch sign-off) and retrofitted to the commercial packing board QA/RP approvals. (3) Scale integration (§17) is the recommended mitigation for manual weight transcription risk — worth confirming whether GACP facility scales support it. (4) Data retention of 7 years is GrowerIQ's standard — confirm SAHPRA's specific requirement before setting the Railway MongoDB backup retention policy. Document reference: `EU GMP Annex11 & GrowerIQ Compliance (1).pdf`.

> **2026-07-01 — Odoo-vs-MongoDB split clarified, data model philosophy documented:** The existing architecture principle ("Odoo is the financial source of truth / MongoDB handles portal-layer concerns only") was already stated in the roadmap header but needed to be applied explicitly to Phase 13. The Sales Ticket pattern is the correct template: `sales_tickets` in MongoDB tracks pipeline stage/workflow state; the actual `sale.order`, `account.move`, and `stock.picking` all live in Odoo. Phase 13 follows the same split: `production_sessions` in MongoDB tracks approval workflow state (TL/QA/RP sign-offs); the actual manufacturing operations (`mrp.production`), stock movements (`stock.picking`), lot numbers (`stock.lot`), and stock levels (`stock.quant`) all live in Odoo. The 8 logbook table has been updated with an "Odoo object" column explicitly mapping each logbook to the Odoo model it creates. The only genuinely custom MongoDB collections are: `cultivation_batches` (GACP plant/room tracking — no Odoo equivalent before harvest), `yield_bands`, `batch_investigations`, `sahpra_reports`, `signature_events`, and `production_sessions` (workflow overlay). Everything else uses Odoo natively via the portal's XML-RPC layer.

> **2026-06-30 — Operational logbook reviewed (`Logbook Example for Nick Cannaverse.xlsx`):** This is the single most concrete source document for Phase 13 to date — it is the actual Excel-based system the production team is running today. 13 sheets confirmed: Index, Batch Naming, Packing Batch Shortcode, Product Naming Rules, Shortcode for products, GACP Logbook, Dry Room Logbook, Manicuring Logbook, Crush Logbook, Pre Roll Logbook, Gummy Manufacturing, Packing Logbook, 2ndary Packing Logbook. Each logbook sheet = one portal form/module. Live data confirmed from May–June 2026. Key discoveries vs prior speculation: (1) The batch suffix scheme is more complete than the V6 PDF — includes standard vs budget branching at Crush (`PC`/`TC`), pre-roll (`PCPR`/`TCPR`), and 10 distinct finished goods packaging suffixes (PTT/PJR/MP1G–5G/PP1G–5G). (2) Gummy products follow a separate lot numbering scheme (`BHG[flavour]-[instance]-[DDMMYY]`) with a distinct packing flow (supplier receipt → packing → expiry). (3) Manicured flower sub-grades: Bigs, Mids, Small (all under the `-M` suffix) plus Pops — live data tracks per-staff, per-grade output. (4) GACP logbook is row-level inside rooms (Room F4 Row 1–6 etc.), not batch-level. (5) Multiple intermediate verifications before RP sign-off: Team Leader (TL) + QA on the Crush logbook — the portal needs at least 3 approval levels per stage. (6) Batch ID format inconsistency in live data confirms portal-enforced ID generation is essential, not optional. (7) ~70 strain shortcodes already defined in the "Shortcode for products" sheet — the portal inherits this master list at launch. Remaining gap: yield bands (not tracked in any current spreadsheet) and SAHPRA report format (primary blocker).

> **2026-06-30 — Batch traceability standard + Store Onboarding Agreement reviewed:** Two further source documents confirmed concrete details that were previously speculative in this phase. (1) `Medicinal Cannabis Batch Traceability Guide V6.pdf` — Bassani's own internal batch numbering protocol (not invented by this roadmap): base ID format `BH[API|B][strain][seq]-[date]`, single-letter post-harvest stage suffixes (D/U/M/P/T), compound processing suffixes (MC, MCPR), and a distinct blending convention (`BHB` prefix) for multi-batch blends with traceability back to every parent batch. This has fully replaced the placeholder cultivation-batch lifecycle and stage model in this section — see "Batch Numbering Standard" above. (2) `Bassani_Health_Store_Onboarding_Agreement_v1.pdf` (Section 21 Collection Point legal framework) — confirms the traceability chain must terminate at a **Delivery Note** linking dispensed units to a **Named Patient**, their **Script**, and their **SAHPRA Section 21 Authorisation** (medicine-specific, quantity-specific, 6-month validity). Section 10.3 of that agreement makes Bassani's own order records the legal audit trail proving lawful supply to each "Store" (the agreement's term for what the portal calls a reseller) — a volume mismatch is treated as prima facie evidence of illicit sourcing. **Separate but related finding, not folded into Phase 13:** the existing live portal's Section 21 check (`backend/routes/script_routes.py`) is a single `s21script` string + expiry date — materially thinner than what this agreement requires (a structured, medicine-specific, quantity-specific Authorisation Letter, validated per order). This is a gap in the *current, already-shipped* order flow, not a future production-tracking concept — flagged to the business for a decision on whether to scope it (likely as Phase 8 hardening) before further Phase 13 work proceeds. Document references: `Medicinal Cannabis Batch Traceability Guide V6.pdf`, `Bassani_Health_Store_Onboarding_Agreement_v1.pdf`.

---

*This document is the single source of truth for the production readiness programme. Update it after every phase completion. Do not start a new phase until the previous phase's Definition of Done is fully checked off.*
