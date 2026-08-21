# Bassani Health Portal — Production Readiness Roadmap

**System:** Bassani Health B2B Sales & Reseller Portal  
**Stack:** FastAPI · React 18 · MongoDB · Odoo 19.0 (XML-RPC) · Railway — corrected 2026-08-11, live-confirmed via `common.version()`; previously documented as v17, which had drifted from what the third-party host was actually running (see 8.47 follow-up fixes)  
**Last Updated:** 2026-07-19  
**Overall Status:** 🟡 Pre-Production — Phases 0, 1, 2, 4, 6, 7, 9 complete; Phase 3 in progress (2 live VAT verification items remaining); Phase 8 DoD 9/10 complete — only staff account creation outstanding (operational, no code required); Phase 8 sub-deploys 1–17 complete (8.1–8.22) — partner directory, ticket reassignment, customer contact surfacing, document upload request, Sentry noise fixes — 2026-07-07; Phase 8.23 partial fulfilment + backorder pipeline — 2026-07-09; Phase 8.33 Order Passport — 2026-07-11; Phase 8.34 Reseller traceability across all views — 2026-07-12; Phase 8.35 Per-line qty packed + packing-time shortfall handling — 2026-07-13; Phase 8.36 Ticket linking + inbox integration — 2026-07-13; Phase 10 responsive UI in progress (10.0–10.4 complete, 10.5 large-screen caps pending, 10.6 pagination complete); Phase 11 dual-mailbox inbox live — 11.C.1–11.C.5 complete — 2026-07-05; Phase 12 in progress (12.0 complete, 12.4 GS1 label printing complete, 12.5 GTIN Pool management complete — 2026-07-11); Phase 15 stock report live — 2026-07-06; Phase 16 self-service registration live — 2026-07-06; Phase 17 document template management live — 2026-07-07; Phase 18 multi-authority signing + My Profile live — 2026-07-08; Phase 19 My Profile + per-user signing complete — 2026-07-08; Phase 20 Sales Agents rename + commission_eligible flag — 2026-07-08; Phase 20 reseller wizard simplified (docs removed, global warehouse default) — 2026-07-17; Phase 21 Customer data model hardening — 2026-07-09; Phase 23 Operations Monitor live — 2026-07-15; Phase 1.9 path traversal protection — 2026-07-17  

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
| 7 | Missing Commercial Workflows | 🟢 Complete | 2026-06-24 · 7.7 — 2026-07-01 · 7.4 — 2026-07-01 · 7.8 + 7.9 — 2026-07-02 · 7.10 Balance Payment — 2026-07-04 · 7.11 MOQ — 2026-07-06 |
| 8 | Order Workflow & Ticketing System | 🟡 In Progress | Sub-deploys 1–17 (8.1–8.22 code complete) — 2026-07-06 · 8.16–8.22 — 2026-07-07 · 8.23 Reseller quote flow — 2026-07-09 · 8.24–8.29 invoice lifecycle + address + payment terms + invoice page — 2026-07-10 · 8.30 Backorders admin view · 8.31 Batch/lot on print docs · 8.32 Manufacturing order visibility · 8.33 Order Passport — 2026-07-11 · 8.34 Reseller traceability across all views — 2026-07-12 · 8.35 Per-line qty packed + packing-time shortfall — 2026-07-13 · 8.36 Ticket linking + inbox integration — 2026-07-13 · (see sub-phase sections below for 8.37 onward, including 8.46 Recurring Orders and 8.47 Deposit Gate reinstatement, both 2026-07-29, and 8.49 Ready-for-Collection customer notification, 2026-08-04) |
| 9 | Go-Live Infrastructure | 🟢 Complete | portal.bassanihealth.com live, Resend domain verified, all Railway vars confirmed — 2026-06-29 |
| 10 | Responsive UI | 🟡 In Progress | 10.0–10.4 complete (login fix, shell overflow, column hiding, form grids, quote builder) — 2026-06-26 · 10.5 large-screen caps pending · 10.6 profile pagination + reseller nav grouping — 2026-07-02 |
| 11 | Mailbox Integration | 🟢 Live (dual-mailbox) | Graph code built 2026-06-29 · Azure credentials wired 2026-07-05 · IMAP/SMTP live 2026-07-04 · Two-panel inbox UI — 2026-07-05 · 11.C.1 doc progress tracking · 11.C.2 inbox UX hardening · 11.C.3 reseller onboarding ownership gap (three-tier fix) · 11.C.4 save-to-application + approval doc transfer (reference-only, no copy) · 11.C.5 reseller wizard draft/resume flow — 2026-07-05 · 11.D Sales Inbox ingest unification + sync reliability hardening — 2026-08-04 |
| 12 | Barcode Integration | 🟡 In Progress | Starting 12.0 — 2026-06-29 |
| 13 | Production & Cultivation Module (GrowerIQ In-House) | 🟡 In Progress — 13.0 built | 13.0 Vault Movement Module (Track A starter) built 2026-07-24 in staged mode: batch ID generator + registry, vault movement logbook (Patricia replacement), vault ledger, readiness probe, `vault_custodian` role. Live Odoo writes gated on `GACP_ODOO_WRITES=on` + GACP access confirmation + sub-location setup. Track B still gated on Odoo BoMs. SAHPRA reporting requirements not yet obtained. |
| 14 | External Ecommerce API | 🔵 Concept — Needs Scoping | Three modes: WooCommerce sync (preferred — Green Clouds) + direct REST + Integration Partner API (multi-tenant, Cannaverse first). Compliance flag outstanding before 14.6/14.7 order endpoints — does not block the partner path (14.10–14.17) |
| 15 | Stock Report | 🟢 Complete | 15.0–15.2 complete — 2026-07-06 |
| 16 | Self-Service Customer Registration | 🟢 Complete | 16.0–16.4 complete — 2026-07-16 |
| 17 | Document Template Management | 🟢 Complete | 17.0–17.5 complete — 2026-07-07; 17.6 Welcome Pack slot-based management — 2026-07-14 |
| 18 | In-Portal Customer Document Signing | 🟢 Complete | 18.0–18.4 complete — 2026-07-08 |
| 19 | My Profile & Multi-Authority Signing | 🟢 Complete | 19.0–19.4 complete — 2026-07-08 |
| 20 | Sales Agent Accounts & Commission Eligibility | 🟢 Complete | 20.0–20.3 complete — 2026-07-08 |
| 21 | Customer Data Model Hardening | 🟢 Complete | 21.0–21.5 complete — 2026-07-09 |
| 23 | Operations Monitor | 🟢 Complete | 23.0 complete — 2026-07-15 |
| 24 | Named Patient & Section 21 Compliance Archive (Cannati) | 🔵 Concept — Needs Scoping | One-way ingest from Cannaverse's Cannati store: patients, S21 applications, scripts. Depends on Phase 14.10–14.13 (Cannati is a connected store) |
| 25 | Customer Self-Service Portal Accounts & WhatsApp Bot API | 🟡 In Progress | 25.0/25.1 complete (2026-08-21) — `customer` portal role live: admin-initiated per-contact login provisioning, company-level order/invoice sharing, self-service catalogue/orders/invoices/dashboard. 25.2–25.6 (WhatsApp Bot API) still Concept — Needs Scoping, now layered on top of the shipped role/data model |

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
**Completed:** Sub-deploy 1 (1.1, 1.3, 1.4, 1.6) — 2026-06-19 · Sub-deploy 2 (1.7 Forced Password Reset) — 2026-06-23 · Sub-deploy 3 (1.2 CORS lockdown + 1.5 email OTP 2FA) — 2026-06-29 · Sub-deploy 4 (1.8 Self-Serve Password Reset) — 2026-07-05 · Sub-deploy 5 (1.9 Path Traversal Protection) — 2026-07-17  

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
- [x] **Fixed 2026-08-04 — the "per IP" part wasn't actually true.** `slowapi`'s `get_remote_address` (the limiter's key function, `rate_limit.py`) reads `request.client.host`, but `railway.toml`'s `startCommand` ran plain `uvicorn server:app --host 0.0.0.0 --port 8000` with no `--proxy-headers` flag — so every request's `request.client` was Railway's own edge proxy, not the real visitor, for every request regardless of source. In practice this meant the 5/15min login limit was one shared bucket across all traffic, not a per-visitor limit, and the general request logger (`server.py::log_requests`) didn't capture client IP at all, so a burst of failed logins was impossible to attribute to one source or several. Found while investigating a repeating pattern of `401`s on `/api/auth/login` in the logs. Fixed: `startCommand` now includes `--proxy-headers --forwarded-allow-ips='*'` (safe here specifically because this app is only ever reached via Railway's edge, never directly), and `log_requests` now logs `client_ip` on every request.

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

#### 1.9 Path Traversal Protection

**Goal:** Prevent the SPA catch-all route from serving files outside the static build directory.

The SPA catch-all in `server.py` previously used `os.path.join(static_dir, full_path)` without any confinement check. On Linux, `/proc/self/cmdline` is a real pseudo-file that passes `os.path.isfile()` — a scanner discovered this and read it (process command line only — not sensitive). All other traversal targets (`.env`, PHP config files, log files) do not exist on the Railway container and returned `index.html` harmlessly.

- [x] Capture `_static_real = os.path.realpath(static_dir)` at server startup
- [x] In the catch-all handler, compute `resolved = os.path.realpath(os.path.join(static_dir, full_path))`
- [x] Gate the `FileResponse(resolved)` path on `resolved == _static_real or resolved.startswith(_static_real + os.sep)` — anything else serves `index.html` with no-cache headers
- [x] `os.path.realpath` resolves all `..` segments and symlinks to a canonical absolute path, making it impossible for `../` traversal sequences to escape the build directory boundary

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
- [x] URL paths that resolve outside the static build directory (path traversal attempts) serve `index.html` rather than the target file

### Notes
> **Sub-deploy 5 (2026-07-17):** 1.9 Path Traversal Protection. The SPA catch-all route in `server.py` used `os.path.join(static_dir, full_path)` to resolve arbitrary URL paths to filesystem files. Because `os.path.isfile()` returns `True` for Linux `/proc/self/cmdline` (a real pseudo-file), a scanner exploiting this pattern was able to open that file; all other traversal targets (`.env`, config files, log files) returned `index.html` because those paths do not exist on the Railway container. Fixed by capturing `os.path.realpath(static_dir)` at startup and rejecting any resolved path that does not start with it before checking `os.path.isfile()` — paths outside the static build directory silently serve `index.html` with no-cache headers instead. No data was exposed; `/proc/self/cmdline` contains only the process start command.

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

**Design decisions (confirmed 2026-06-19; switcher access widened 2026-08-04 — see Notes):**
- Each **reseller** has an assigned default `warehouse_id` (set by admin on their profile) — their orders always draw from that vault automatically. External role, no in-app switcher.
- Every **internal role** (including warehouse_supervisor/packer/vault_custodian) gets the persisted `active_warehouse_id` top-nav selector (2026-08-04: originally admin/super_admin-only; opened to all internal roles). A fixed `warehouse_id` on the user document still exists for warehouse_supervisor/packer/vault_custodian as their assigned-floor fallback when they haven't made an active selection.
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
- [x] **Global default warehouse** — super admin sets a system-wide default via Settings > Warehouses; stored in `portal_settings._id: "default_warehouse"`. `warehouse_context.py::_get_global_default_warehouse_id()` reads this. `resolve_warehouse_id()` falls back to the global default for: resellers with no profile warehouse set, admins with no active selection, and all other staff roles. Resellers never see the warehouse switcher in the top nav — it is hidden for the `reseller` role. The switcher displays the global default when the admin has no active selection. This replaces the previous behaviour of returning `None` when no warehouse was resolved, which caused un-scoped Odoo reads.

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

> **Sub-deploy 10 (2026-08-04):** Two gaps found while investigating "the Orders screen doesn't refresh when I switch warehouses." First, `order_routes.py::list_orders` (`GET /api/orders/`, the Orders screen) had never been included in 3.7's original warehouse-scoping pass — every other read (`product_routes.py`, `forecast_routes.py`, `report_routes.py`) went through `resolve_warehouse_id()`, but the orders list domain was built from `status`/`partner_id`/`search`/reseller-ownership only, with no `warehouse_id` clause at all — so it showed orders across every warehouse regardless of the selector. Now scoped the same way as every other warehouse-aware read. Second, even scoped correctly server-side, the frontend `Orders()` component's `load()` `useCallback` in `Views.js` didn't list `user.active_warehouse_id` as a dependency, so switching warehouse never re-triggered a fetch — fixed by adding it to the dependency array. **Same deploy, at the business's request:** `resolve_warehouse_id()` and `PUT /api/users/me/warehouse` were unified so the top-nav switcher works for every internal role, not just admin/super_admin (previously admin/super_admin-only; warehouse_supervisor/packer/vault_custodian's fixed `warehouse_id` is now a fallback for when they haven't made an active selection, not their only option) — see Design decisions above.

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

#### 4.3 Tier Configuration — Fully Configurable (upgraded 2026-07-08)
> **Originally:** rate-only edits on 5 fixed brackets. **Upgraded:** full add/remove/edit of tiers — label, turnover bracket, and rate — all configurable. Backend validates contiguity and derives the display range string. Audit trail captures full before/after on every save. Reseller commission view is data-driven and required no changes.
- [x] Display tier change history inline in the admin Tier Settings tab — added `GET /api/commission/tiers/history` endpoint and "Change History" section in the Tier Settings tab
- [x] Full tier CRUD — add tiers, remove tiers, edit labels, brackets, and rates
- [x] Backend validation: contiguous brackets, last tier must be Unlimited, all rates 0–100, labels required
- [x] `_tier_range()` helper derives display string (e.g. "R300k – <R500k") from min/max on save
- [x] `next_tier` lookup in `current-month` endpoint uses list position, not numeric tier index

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
**Completed:** 2026-06-23 · 7.4 — 2026-07-01 · 7.8 — 2026-07-02 · 7.12 — 2026-07-28 · 7.13 — 2026-07-28  

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
- [x] **Refined 2026-08-04 — the contact-email condition on this check was too broad for how this business actually operates.** Real applications surfaced the gap: two "Curabliss" entities (different CIPC docs, same signatory email) and two "Cannapure Plus NPC" branches (identical CIPC docs, different trading names, no VAT) both needed separate `res.partner` company records with the same contact linked to each — but the original check blocked the second application in both cases purely because the signatory's email already existed on the first company's record. Contact email matching an existing partner/contact is no longer a blocking condition — only a matching VAT number, or the exact same `company_name` + `trading_name` combination already approved (an accidental literal resubmission), still returns 409 (directing to `approve-link` as before). A contact-email match is now recorded as an informational `linked_contact_note` on the `onboarding.approve` audit entry instead. Also: the Odoo partner's `name` now folds in the trading name (`"{company_name} - {trading_name}"`) whenever it differs from the legal entity name, since two branches of one legal entity were otherwise indistinguishable everywhere the customer name appears (order lists, dashboard, invoices, ticket headers). **Not yet touched:** the sibling duplicate check in `create_customer` (the admin-facing Add Customer wizard, `GET /api/customers/check-duplicate`) is a separate, name-search-based path and may have the same underlying gap for a manually-added customer — out of scope for this fix, flagged for follow-up if it comes up in practice.
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

#### 7.11 — Minimum Order Quantity (MOQ) — Added 2026-07-06

**Goal:** Admins can set a minimum order quantity per product in the reseller catalog. Resellers see the minimum on product cards and cannot submit an order with a line quantity below it.

**Storage:** MOQ is a portal-layer concern — it does not exist in Odoo and Odoo has no native sales-side MOQ enforcement. Stored as a `moq` map on the existing `reseller_catalog` MongoDB document alongside `product_ids`: `{ "_id": "global", "product_ids": [...], "moq": { "123": 10, "456": 25 } }`. Products not in the map have no minimum.

- [x] `GET /api/reseller-catalog/` updated to return `{ product_ids, moq }` — previously returned `product_ids` only
- [x] `PUT /api/reseller-catalog/{product_id}/moq` — sets or clears the MOQ for a product; `moq: 0` unsets the key; audit-logged as `reseller_catalog.moq_set`; requires `products.manage` permission
- [x] Admin Products table — "Reseller / MOQ" column: toggle remains as-is; when the toggle is on, a small number input appears inline to set the MOQ (saves on blur); input hides when the product is toggled off
- [x] Reseller catalog (read-only view) — "Min. X units" amber badge next to SKU on any product with `moq > 0`
- [x] Reseller order builder (cart) — MOQ data loaded alongside products; "Min. X units" badge on product cards; `addToCart` starts at MOQ qty (not 1) when MOQ > 1; `updateCartQty` blocks quantities below MOQ with a toast error; qty input `min` attribute set to `Math.max(1, moq)` for native browser validation

#### 7.12 — Reseller Parent Categories — Added 2026-07-28

> Odoo `product.category` is a single flat taxonomy shared by the whole business and Bassani didn't want to fix its messy naming there — it would affect every other workflow that depends on it. They also wanted a weekly-rotating "Specials" bucket assembled by hand, independent of Odoo category. This phase adds a portal-only grouping layer that resellers browse by, sitting entirely in front of the existing 7.7 reseller-catalog visibility gate rather than replacing it.

**Goal:** Admins define named "parent categories" that group Odoo categories and/or individually hand-picked product variants for reseller browsing, without touching Odoo. Resellers browse by parent category instead of raw Odoo category on both the catalog page and the order cart. Any catalog-visible product not covered by any parent category falls into a synthetic "Uncategorised" bucket so nothing already visible to resellers silently disappears.

**Architecture:** Pure portal-layer concern, same philosophy as 7.7's `reseller_catalog` — a new `parent_categories` MongoDB collection, no Odoo schema change. Each doc: `{_id, name, sort_order, odoo_category_ids: [int], product_ids: [int], active, parent_id: Optional[str], created_by, updated_by, created_at, updated_at}`. Membership rule is a union, not exclusive: a product belongs to a parent category if its `categ_id` is in `odoo_category_ids` **or** its own id is in `product_ids` — supporting both bulk category rollups and individually reshuffled "Specials"-style buckets under the same grouping doc. Many-to-many is intentional: the same Odoo category or product can appear under multiple parent categories. Parent categories are a display/grouping layer only — visibility is still governed exclusively by `reseller_catalog` (7.7); adding a product to a parent category's hand-pick list idempotently ensures it's also present in `reseller_catalog.product_ids` so a product can't be "in a bucket" but invisible.

**Two-level nesting (added same day, from real Bassani category examples):** Bassani's actual Odoo categories are two layers deep in practice — e.g. "Flower" isn't one Odoo category, it's four (Exotic/Indoor/Greendoor/Greenhouse) × five formats each (20 real categories total), and "Vapes" is two real categories (CannaCrafter's Vapes, Green Clouds Vapes) that resellers think of as one family with two brands. A flat parent category can't express "select Flower, see all 20 categories' worth of products, then narrow to just Indoor" — so `parent_categories` docs can now reference another doc via `parent_id`, one level deep (e.g. "Flower" top-level, "Indoor"/"Exotic"/"Greendoor"/"Greenhouse" each a child pointing at Flower, each wrapping its own real Odoo categories). `resolve_parent_category_product_ids()` resolves a top-level doc's *entire family* (itself plus all children) recursively in one batched Odoo call, so selecting "Flower" immediately returns the full 20-category aggregate; selecting a child narrows to just that grade/brand. Enforced two levels deep at the API layer (`_validate_parent_id` in `parent_category_routes.py`): a category already nested can't be chosen as a parent, and a category with its own children can't itself be nested — though the resolution logic underneath is depth-agnostic if a third tier is ever needed.

- [x] `parent_categories` MongoDB collection — CRUD via `backend/routes/parent_category_routes.py`; shared membership resolver in `backend/parent_categories.py` (used by both `parent_category_routes.py` and `product_routes.py` to avoid a route-importing-route circular import)
- [x] `GET /api/parent-categories/` — admin/staff see all docs (incl. inactive); resellers see only active docs plus a synthetic `"uncategorised"` entry when at least one catalog-visible product isn't covered by any active parent category
- [x] `POST` / `PUT` / `DELETE /api/parent-categories/{id}` — gated on `products.manage` (reused, no new permission); every write audit-logged (`parent_category.create/update/delete`)
- [x] Adding a product to a parent category's `product_ids` idempotently `$addToSet`s it into `reseller_catalog.product_ids`, audit-logged separately as `reseller_catalog.auto_added` so the Audit Trail distinguishes it from an explicit manual toggle; removing a product from a parent category never revokes its independently-managed catalog visibility
- [x] `GET /api/products/` extended with `parent_category_id` (resolves category-union ∪ hand-pick membership, including the `uncategorised` sentinel) and `ids` (comma-separated, resolves labels for already-hand-picked variants in the edit UI)
- [x] Admin nav: "Categories" renamed to **Odoo Categories** (same route/component) with an added on-page warning banner that edits write directly to Odoo; new **Parent Categories** nav item and full page (`/catalogue/parent-categories`) with its own banner clarifying it's portal-only
- [x] Parent Categories admin page (`frontend/src/views/ParentCategories.js`) — list, create/edit modal with two membership pickers (`MultiSearchableSelect` for bulk Odoo categories, a search-driven hand-pick list for individual variants), delete with confirmation modal
- [x] `POST /api/parent-categories/preview` — resolves an in-progress (unsaved) category/hand-pick selection into the real product list, live in the edit modal (debounced 400ms) before the admin saves; flags each match `catalog_visible` and its `source` (`category` vs `handpick`) so the admin can see not just *what* will be grouped but whether it's actually visible to resellers yet — a category-matched product not already in `reseller_catalog` shows as "Hidden — not in catalog" (the auto-add nicety only fires for hand-picks, never for bulk category rollups)
- [x] `ResellerCatalog.js` and the reseller order cart in `Views.js` — category filtering now sourced from `GET /api/parent-categories/` and filtered via `parent_category_id`, replacing raw Odoo category name/id filtering; variant derivation (`getVariantLabel`/`parseDisplayName`) unchanged
- [x] Staff-facing views (`Products.js`, `ProductPickerDrawer.js`) intentionally left on raw Odoo categories — out of scope for this phase
- [x] Parent Categories admin page extended with a "Parent category (optional)" picker (native `Select`, top-level options only); `PUT` supports an explicit `clear_parent` flag since `Optional[str]=None` can't distinguish "leave unchanged" from "unparent"; deleting a category with existing children is blocked (400) until they're reassigned or removed. The list table shows the hierarchy directly rather than via a separate "Parent" text column (dropped after user feedback that it read as two unrelated rows referencing each other, not a tree): each child is grouped immediately beneath its parent and indented with a "↳" connector; sorting is disabled on every column so this grouped order can never be scrambled by a header click
- [x] **Chips replaced with three cascading `SearchableSelect` dropdowns** (Category → Brand/Grade → Variant) on both `ResellerCatalog.js` and the reseller order cart — the Brand/Grade dropdown only renders when the selected top-level category actually has children, and the Variant dropdown only when the resolved product list has more than one distinct `display_name` attribute group; the "In Stock"/"Out of Stock" toggle chips in the cart are unaffected (binary toggles, not a hierarchical picker, so chips remain the right fit there)
- [x] **Category Mapping bulk-setup tab** — a second tab on the same `ParentCategories.js` page (not a separate nav item/page; the two are different views over the same data), one row per real Odoo category with a Parent Category dropdown and a Sub Category dropdown (populated from that parent's children), mirroring exactly how Bassani planned their real mapping on paper. `PUT /api/parent-categories/category-mapping/{odoo_category_id}` performs the assignment as a **move**: pulls the category out of every doc it currently belongs to before adding it to the new target, so the tab's one-category-has-one-home mental model holds even though the schema still allows many-to-many (used elsewhere by the hand-pick flow, e.g. Specials). Search box + "Unmapped only" toggle for auditing a large category list in one sitting; the page subtitle shows a running "N of M mapped" count while this tab is active. Complements rather than replaces the per-category edit modal (still on the first tab), which remains the tool for naming, hand-picked products, and preview.

**Design decisions:**
- **Portal-only, no Odoo write** — mirrors 7.7's philosophy exactly; Odoo's `product.category` remains the single business-wide taxonomy, untouched by this layer.
- **Union membership rule, not exclusive** — deliberately supports both "whole category rollups" and "hand-picked individual variants" in the same bucket, because the business's real use case (a weekly "Specials" bucket assembled by hand, independent of category) can't be expressed as pure category rollup alone.
- **Grouping layer sits on top of, never bypasses, visibility** — a product added to a parent category's hand-pick list is idempotently added to the existing `reseller_catalog` allow-list so display and visibility never fall out of sync; parent categories cannot make a product visible to resellers that wasn't already meant to be.
- **Uncategorised is a computed bucket, not stored** — resolved on every request as `reseller_catalog.product_ids − (union of all active parent categories' resolved membership)`, so it's always correct even as parent categories are edited, never a stale cached list.
- **Reused `products.manage` permission** — no new permission domain; the same admins who manage the reseller catalog (7.7) manage parent categories.
- **Variant level, consistent with 7.7** — hand-picked `product_ids` are `product.product` (variant) ids, not template ids.
- **Two levels of nesting, not arbitrary depth** — matches Bassani's actual category structure (family → grade/brand) exactly with no speculative extra generality in the UI; the resolver is written depth-agnostic so lifting the cap later is a small change, not a rewrite.
- **Dropdowns over chips for category/brand/variant filtering** — chip rows work well for a handful of options but Bassani's real structure is ~15 top-level families, several with 2-5 children each; three searchable dropdowns stay compact and let a reseller type to narrow, reusing the existing `SearchableSelect` component rather than a new one. Binary toggle filters (In Stock/Out of Stock) stay as chips — that's still the right fit for a two-state toggle.
- **A dedicated bulk-mapping view, not an extension of the per-category modal** — validated against Bassani's actual ~40-category list: assigning categories one at a time via search-and-click across N different Parent Category modals doesn't scale to a full first-time setup, and there was no single view to check what's still unmapped. The flat, one-row-per-Odoo-category table matches how the business had already planned the mapping on paper, so the tool should look like their plan, not like our data model.
- **A second tab on the same page, not a separate nav item** — Parent Categories and Category Mapping are two views of the same underlying data (creating/naming a category vs. bulk-assigning Odoo categories to it), so a third sidebar entry would fragment one workflow across two places in the nav for no benefit.
- **Redundant grade code stripped from the Variant dropdown once a Brand/Grade sub-category is picked, not aliased** — a short-lived attempt at solving this with an admin-editable "Variant Label Aliases" dictionary (translating codes like `EXO`/`GD`/`GH`/`IND` into friendly names) was built, tested, and removed the same day: once Bassani set up Indoor/Exotic/Greendoor/Greenhouse as real sub-categories under Flower (and under Pre Roll), the grade is already selected via the Brand/Grade dropdown, so repeating it in the Variant dropdown (`EXO / 1G`) is just noise, not an unreadable code — the fix is to drop the redundant leading attribute group entirely once a sub-category is active, not translate it. `getVariantLabel(p, { stripLeadingGroup })` in both `ResellerCatalog.js` and `Views.js` drops the first `parseDisplayName` group when `stripLeadingGroup` is true and the product has more than one group (so a product with only one attribute, e.g. Vapes with no shared grade attribute, is untouched); `stripLeadingGroup` is passed as `subCat !== "all"` (`cartProdSubCat` in the cart). The same stripping is applied to the inline variant chips shown on each product row/card, not just the dropdown, so the two stay consistent.

#### 7.13 — Ownership-Based Order/Ticket Visibility & Commission — Added 2026-07-28

> Bassani flagged that a reseller could only see and earn commission on orders they personally placed — a staff member taking a phone order for a reseller's own linked customer made that order invisible to the reseller and uncommissioned. The correct rule is ownership of the *customer* (the existing `customer_ownership` link), not who physically placed the order.

**Goal:** A reseller linked to a customer via `customer_ownership` sees and can act on ALL of that customer's orders/tickets, and earns commission on all of them, regardless of who placed each one — with no retroactive commission on orders that predate the link.

**Architecture:** New `backend/ownership.py` module (mirrors `backend/parent_categories.py`'s route-import-avoidance pattern) centralizes every `customer_ownership` read behind `get_owned_partner_ids()`, `get_owning_reseller_id()`, and `is_partner_owned_by()`. Every reseller-visibility/access check across `order_routes.py`, `ticket_routes.py`, and `customer_routes.py` that previously compared against `order_commissions.reseller_id` or `tickets.reseller_id` ("who placed this") now goes through this module instead. `ticket.reseller_id`/`order.reseller_id` are unchanged and still populated — Phase 8.34's "who physically placed this" traceability display still works; it's just no longer trusted for access control or commission crediting.

- [x] `backend/ownership.py` — new shared module, `get_owned_partner_ids`, `get_owning_reseller_id`, `is_partner_owned_by`
- [x] `customer_ownership` — unique index on `odoo_partner_id` (self-verifying at startup: a duplicate pre-flight aggregation runs first and skips the unique index with a warning log if any exist, rather than crashing), index on `reseller_id`; `tickets` — new index on `customer_id`
- [x] `order_routes.py` — orders list, order detail, order passport, and confirm-order access all switch to ownership-based resolution (`("commercial_partner_id", "in", owned_ids)` for the list domain, `is_partner_owned_by()` for single-record checks); the commission-record-creation block at confirm time resolves the crediting reseller via `get_owning_reseller_id()` instead of the ticket's stamped `reseller_id`, composed unchanged with the existing `commission_eligible` check; `create_order` gains a server-side "reseller may only order for owned customers" check (previously frontend-filtering only), checked against the post-`commercial_partner_id`-resolution id so ordering against a contact person under an owned company is never incorrectly rejected
- [x] `ticket_routes.py` — tickets list, `_assert_reseller_owns_ticket` (now async, reused by the 4 order-from-ticket mutation endpoints), and the WebSocket connection manager all switch to ownership-based resolution. Ownership matching uses `customer_company_id` when present, falling back to `customer_id` (`_ticket_customer_partner_id()`) — order-linked tickets always store an already company-resolved `customer_id`, while manually-created tickets (`POST /api/tickets`, staff-only) may have `customer_id` pointing at a contact person with the resolved parent company separately in `customer_company_id`; no data migration needed since both ticket-creation paths already populate the right field for this fallback to work
- [x] WebSocket broadcast scoping rebuilt around a per-connection owned-partner-id snapshot (fetched at connect time, refreshed via `ticket_manager.refresh_reseller()` called from every `customer_ownership` write site — admin link/unlink, reseller self-claim, reseller-created customer, both onboarding-approval paths) rather than a live Mongo query per broadcast per connection. Fixed a pre-existing bug found while rebuilding this: the old scoping compared a Mongo ObjectId string against the reseller's UUID `id` field — two different id spaces that could never match, so reseller WebSocket connections never actually received a live push, always silently falling back to page refresh
- [x] `customer_routes.py` — `customer_profile`'s order sub-list re-narrowing (`order_commissions.reseller_id`) deleted; the page's existing `customer_ownership` access gate is sufficient on its own — this was the clearest reproduction of the bug, since the page's own access gate was already correctly ownership-based while the order list shown on it wasn't

**Design decisions:**
- **No retroactive commission, by construction, not by date comparison** — `order_commissions` records are only ever created going forward at confirm time; resolving ownership fresh at that moment (mirroring the existing `commission_eligible` precedent from Phase 20) means a customer linked today never retroactively credits a reseller for orders confirmed before the link existed, with zero extra date-comparison code.
- **`reseller_id` fields on `order`/`ticket` docs are kept, not repurposed** — still authoritative for Phase 8.34's "who placed this" traceability display; only access control and commission crediting stop trusting them.
- **Ownership is looked up fresh on every REST request, not cached** — matches the existing correct pattern (`customer_routes.py`'s customer list/profile/statement, already ownership-gated before this phase); only the WebSocket layer needs an explicit cache, for scale (avoiding a Mongo query per broadcast per connection) rather than correctness.
- **Unique index is self-verifying, not blindly applied** — `customer_ownership` uniqueness was previously enforced only at the application layer; a startup pre-flight aggregation checks for existing duplicates and skips the unique index (with a warning log) if any are found, rather than risk a startup crash against data that predates this index.

#### 7.14 — Sales Agent Entity Type (Sole Proprietor Support) — Added 2026-07-28

> The Add/Edit Sales Agent wizard was company-first: a flat Company Reg Number field with no way to represent an individual/sole-proprietor agent, who has no company registration number but does have a personal SA ID number. Mirrors the Legal Entity Type pattern already built for customer self-registration (Phase 8.44 / `PublicRegister.js`) rather than inventing a new one.

- [x] `ResellerCreate`/`ResellerUpdate` (`reseller_routes.py`) gain `entity_type`, `entity_type_other`, `id_number` — all optional; existing resellers with no value render the wizard exactly as before
- [x] `Resellers()` in `Views.js` — Legal Entity Type dropdown (same 5 options as `PublicRegister.js`'s `ENTITY_TYPES`) in both the create wizard's Step 2 and the edit modal's Business Details section. Selecting Sole Proprietor swaps the Company Reg Number field for a Luhn-validated ID Number field (same grid position); VAT and Banking sections are unconditional for every entity type, unchanged
- [x] `validateSAID`/`validateSAPhone` extracted from `PublicRegister.js` into shared `frontend/src/utils/validators.js`; `PublicRegister.js` now imports from there instead of a local definition
- [x] `CUSTOMER_FIELDS` (`customer_routes.py`) gains `vat`; selecting an existing Odoo vendor partner in Step 1 now auto-fills VAT number (and flips the VAT toggle on) in addition to the name/email/phone/seller_code it already populated — entity type and address are not touched by this autofill (address has no UI in this wizard and stays that way)

#### 7.15 — Product Images — Added 2026-07-28

> Odoo already supports product images natively (`product.template.image_1920`, with smaller sizes auto-derived and auto-resized by Odoo's own ORM on write); the portal had zero image handling anywhere and every product-listing surface was text-only. Images are written straight to Odoo — no new storage system — and thumbnails now appear everywhere a product is listed, not just the admin catalogue.

- [x] `PRODUCT_FIELDS` (`product_routes.py`) gains `image_128` — the base64 128px thumbnail only, never the full-resolution `image_1920`, in any list/read response. Since every product-listing surface (admin Products table, reseller catalogue, quote builder Browse Products drawer, per-row product search) already calls the same `GET /api/products/`, this one field addition makes thumbnails available everywhere at once
- [x] `POST /{product_id}/image` (multipart) and `DELETE /{product_id}/image` — both `products.manage`-gated, resolve `product.product` → `product_tmpl_id` (image is template-level, same as name/price/category) and write/clear `image_1920`; upload validates content-type (JPEG/PNG/WEBP) and an 8MB cap
- [x] New shared `ProductThumb` component (`UI.js`) — base64 thumbnail or placeholder, one definition reused by all five surfaces below
- [x] New `ProductImageModal.js` — upload/replace/remove with a live preview before upload; "Remove Image" uses the standard confirmation-modal pattern (no `window.confirm`)
- [x] Admin Products table (`Views.js`) gets a new leading thumbnail column; clicking it (`products.manage` only) opens `ProductImageModal`
- [x] `ResellerCatalog.js`, `ProductPickerDrawer.js` (quote builder Browse Products), and `ProductLineRow.js` (per-row search, quote builder + reseller cart) all show the thumbnail read-only alongside the existing product name

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
- [x] A reseller's category chips (catalog page and order cart) reflect admin-defined Parent Categories, not raw Odoo categories, with an Uncategorised bucket for anything unmapped; Odoo's own category structure remains untouched by this layer
- [x] Once a reseller picks a Brand/Grade sub-category (e.g. "Exotic" under "Flower"), the Variant dropdown and inline variant chips stop repeating that grade code and show only the remaining attribute (e.g. "1G" instead of "EXO / 1G")
- [x] A reseller sees and can act on every order/ticket for a customer linked to them, whether they or Bassani staff placed it, and earns commission on all of them; a customer linked today never retroactively generates commission for orders confirmed before the link existed
- [x] Creating a Sole Proprietor sales agent shows ID Number instead of Company Reg Number, requires a valid 13-digit SA ID, and saves correctly; creating/editing a sales agent with no entity type selected behaves identically to before this change
- [x] Selecting a linked Odoo vendor partner in the Sales Agent wizard with a VAT number populates the VAT toggle and number automatically
- [x] Uploading an image on a product writes it to Odoo's `product.template.image_1920` and it appears in Odoo's own product form
- [x] A product's thumbnail shows up on the admin Products table, reseller catalogue, quote builder Browse Products drawer, and per-row product search without a page reload after upload
- [x] Removing a product's image reverts all four surfaces to the placeholder

---

## Phase 8 — Order Workflow & Ticketing System

**Goal:** Cross-team handoff from Sales → Orders → QA/RP → Finance is tracked end-to-end in the portal, with each team seeing only what's relevant to them and automatic handoff notifications — replacing reliance on ad-hoc email/verbal handoffs for order fulfilment status. This is the core reason the business wanted this portal built.  
**Estimate:** 2–3 weeks  
**Status:** 🟡 In Progress — 8.1–8.12 code complete; DoD 8/9 items done; one remaining item is operational (create 6 named staff accounts via Users page — no code required)  
**Completed:** Sub-deploy 1 (8.1 Roles & Permissions) — 2026-06-19 · Sub-deploy 2 (8.2–8.4 backend) — 2026-06-19 · Sub-deploy 3 (8.5 UI) — 2026-06-19 · Sub-deploy 4 (unified pipeline) — 2026-06-19 · Sub-deploy 5 (8.6 Quote Builder + Deposit + 8.7 Quote Edit) — 2026-06-21 · Sub-deploy 6 (8.8 Orders Tickets full-page detail) — 2026-06-22 · Sub-deploy 7 (8.9 Stock accuracy + Orders pipeline enforcement) — 2026-06-23 · Sub-deploy 8 (8.10 Orders screen read-only + Confirm Order in Sales Ticket) — 2026-06-23 · Sub-deploy 9 (8.11 Send Quote to customer) — 2026-06-23 · Sub-deploy 10 (8.12 Reseller order cart restoration) — 2026-06-29 · 8.38 Samples Account — 2026-07-15 · 8.45 Notification Escalation & Digests — 2026-07-28  

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

#### 8.23 — Partial Fulfilment and Backorder Pipeline — Added 2026-07-09

**Goal:** Allow Bassani to partially fulfil an order (ship what is in stock), automatically create an Odoo backorder for the remainder, and track each delivery independently through the portal pipeline — from packing to QA/RP sign-off to customer collection to invoicing. Resellers and internal staff see live visibility of which items are ready and which are pending stock, with email and in-app notifications at every handoff. When upstream production replenishes the backordered stock, the system surfaces this automatically so the team can close the loop without manual chasing.

**Context:** The existing packing board pipeline validates the full delivery in Odoo when the Orders Clerk marks an order complete after QA and RP sign-off (`_validate_odoo_delivery` in `packing_board_routes.py`). When stock is partially reserved, `action_set_quantities_to_reservation()` already sets `qty_done` to the reserved quantity only, and `button_validate()` already triggers Odoo's backorder wizard — but the portal currently treats this as a non-blocking best-effort and does nothing with the created backorder. This sub-deploy makes backorder handling deliberate and visible throughout the pipeline.

**Odoo prerequisite (Bassani configuration):** Set `invoice_policy = 'delivery'` on all product templates in Odoo. This instructs Odoo's invoice wizard to create invoices based on actually delivered quantities, not ordered quantities — which is the correct model for partial fulfilment. Until this is set, invoice amounts will reflect the full ordered quantity regardless of what was physically moved.

**Phase 13 integration point:** When backordered items are produced, manicured, and entered into the vault as finished goods, this pipeline is the downstream consumer. Once a new batch is received into the vault location and Odoo assigns it to the waiting backorder picking (reserved stock), the portal detects this and re-queues the backorder on the packing board automatically.

> **Note (2026-08-04):** This sub-phase's checkboxes describe the original per-picking design (`PUT /api/packing/{entry_id}/collected`, invoice created per picking at collection time). What actually shipped is simpler: one endpoint, `PUT /api/packing/mark-collected` (`packing_board_routes.py`), used for both the primary and backorder entries; the delivered-qty invoice is created once at `mark_complete` (not at collection), and `mark_collected` only flips `status`/`collected_at`. The one real bug this surfaced: `OrdersTickets.js`'s "Mark as Collected" button (line ~869, this doc's line 1322 below) was gated on `has_pending_invoice`, a flag only ever set on partial/backorder entries — so the button never appeared for a normal, full/single-delivery order, old or new. Fixed by dropping that condition; the button now shows for any `status: "complete"`, uncollected entry, matching this section's original intent.

---

**New ticket statuses:**
- `partially_fulfilled` — at least one picking is validated done; a backorder picking exists and is not yet complete. Sits between `confirmed_wip` and `ready_for_collection` in the pipeline.

**New packing board fields (per entry):**
- `is_backorder: bool` — true if this entry corresponds to an Odoo backorder picking
- `parent_packing_id: str | None` — `_id` of the original packing board entry (set on backorder entries only)
- `odoo_picking_id: int` — the Odoo `stock.picking.id` this entry maps to (needed for partial validation)
- `picking_name: str` — the Odoo picking reference (e.g. `WH/OUT/00045`)
- `collected_at: datetime | None` — set when Orders Clerk marks this delivery as collected
- `collected_by: str | None` — user id of the clerk who marked it collected
- `waiting_stock: bool` — true when this is a backorder entry waiting for Odoo to reserve stock
- `invoice_id: int | None` / `invoice_name: str | None` — the invoice created for THIS picking's delivered quantities (may differ from the ticket-level `invoice_id` when there are multiple pickings)
- `items[n].qty_ordered: float` — ordered quantity for this move line
- `items[n].qty_reserved: float` — what Odoo reserved at packing time
- `items[n].is_backordered: bool` — true when qty_reserved < qty_ordered

**Stock shortfall detection (at `confirm_order` time):**
- [ ] After `action_confirm`, read all `stock.move` records on the sale order's picking(s); compare `product_uom_qty` (ordered) with `reserved_availability` (what Odoo could reserve)
- [ ] If any move has `reserved_availability < product_uom_qty`, the order is "partial" — collect a shortfall list: `[{product_name, qty_ordered, qty_available, qty_short}]`
- [ ] `confirm_order` response gains `is_partial: bool` and `shortfalls: list` fields alongside existing `warnings`
- [ ] If partial: **skip the immediate invoice creation step** in `confirm_order` — invoice is deferred to collection time. The ticket is flagged `has_pending_invoice: true` in MongoDB.
- [ ] If not partial: existing invoice-on-confirm behaviour is unchanged
- [ ] `confirm_order` fires `send_order_confirmed_partial` email to reseller (if reseller order) listing which items will ship and which are on backorder
- [ ] `confirm_order` fires `send_backorder_alert_internal` email to the `order_to` routing address listing the shortfalls so the fulfilment team is immediately aware

**Pre-confirm shortfall preview (reseller flow):**
- [ ] `GET /api/orders/{order_id}/stock-check` — new endpoint; reads all `stock.move` records for the order's picking; returns `{is_partial, lines: [{product_name, qty_ordered, qty_available, qty_short, is_backordered}]}`; gated on reseller ownership (same logic as `get_order`)
- [ ] `SalesTickets.js` — before calling `confirmOrder()` for a reseller, call `stock-check`; if `is_partial`, show a modal: "Some items in this order are not currently in stock and will be placed on backorder. Items ready to ship: [list]. Items on backorder: [list with qty]. Confirm anyway?" — reseller must explicitly acknowledge before the confirmation call proceeds
- [ ] If reseller declines, return to the ticket detail without confirming

**Packing board — partial-aware entry creation:**
- [ ] `confirm_order`: when creating the packing board entry, populate `items[n].qty_ordered`, `items[n].qty_reserved`, `items[n].is_backordered` from the stock move data; set `odoo_picking_id` from the picking record; set `picking_name` from `picking["name"]`
- [ ] `items[n].is_backordered = true` items are visually flagged on the packing board card with an amber "Backordered" chip — packer sees exactly what to pack and what will not be in this delivery

**Packing board complete → Odoo partial validation + backorder creation:**
- [ ] When `PUT /api/packing/complete` is called (after QA + RP sign-off — existing gate unchanged):
  - `_validate_odoo_delivery()` runs as now: `action_set_quantities_to_reservation()` then `button_validate()`
  - If `button_validate` returns a backorder wizard action: call `stock.backorder.confirmation` → `process()` to confirm backorder creation (NOT `process_cancel_backorder`)
  - After `process()`: read the newly created backorder picking from Odoo — query `stock.picking` where `backorder_id = [original_picking_id]` to get its `id`, `name`, and `move_ids`
  - Create a new packing board entry for the backorder picking: `is_backorder: true`, `parent_packing_id: str(original_entry._id)`, `odoo_picking_id: backorder_picking_id`, `status: "waiting_stock"`, `waiting_stock: true`; populate items from the backorder's move lines with their remaining quantities
  - Update the original ticket: `status → "partially_fulfilled"`, push to `stage_history`
  - Fire `send_partial_delivery_ready` email to reseller (if reseller order) and `send_backorder_created_internal` to fulfilment team
- [ ] If `button_validate` does NOT return a wizard (full stock was available): existing full-order flow unchanged, no backorder created, ticket advances normally

**Orders Clerk: "Mark as Collected" action (per packing entry):**
- [ ] New action on the packing board entry detail: `PUT /api/packing/{entry_id}/collected` — gated on `orders_clerk` role or `packing.manage` permission; sets `collected_at`, `collected_by` on the packing board document; triggers invoice creation for THIS picking's delivered quantities via the Odoo advance payment wizard (invoice is scoped to delivered quantities — requires `invoice_policy = 'delivery'` on Odoo products); stores resulting `invoice_id` and `invoice_name` on the packing board entry; audit-logged
- [ ] After invoice creation for this picking, check if ALL packing entries for this ticket are now `collected` — if yes, advance the ticket to `ready_for_collection` and fire existing payment/completion notifications
- [ ] `OrdersTickets.js` — "Mark as Collected" button visible per packing entry once it is in `complete` state; shows `collected_at` timestamp and collector name after action

**Backorder stock assignment detection (periodic check / Phase 13 bridge):**
- [ ] `GET /api/packing/backorders/check-stock` — admin-triggered or scheduled; for all packing board entries where `waiting_stock: true`, read the linked Odoo picking's state; if `state` has moved from `confirmed`/`waiting` to `assigned` (Odoo has reserved stock), update `waiting_stock: false`, `status: "queued"` on the packing board entry, push a `stage_history` entry "Stock available — backorder ready to pack"; fire `send_backorder_stock_ready` email to internal fulfilment team and reseller
- [ ] In the interim (before Phase 13 automated restock): admin can manually trigger this check from the packing board via a "Check stock availability" button on any `waiting_stock` entry
- [ ] Phase 13 hook point: when a new batch is received into the vault location and Odoo auto-assigns it to a waiting backorder picking, the next run of this check surfaces it. The hook point is documented here; the automated trigger is built in Phase 13.

**Ticket status model additions:**
- [ ] `FORWARD_STATUSES` in `SalesTickets.js`: add `"partially_fulfilled"` between `"confirmed_wip"` and `"ready_for_collection"`
- [ ] `STATUS_LABEL`: `partially_fulfilled → "Partially Fulfilled"`; `STATUS_COLOR`: `partially_fulfilled → "orange"`
- [ ] Reseller constants: `R_STATUS_LABEL`: `partially_fulfilled → "Partially Shipped — Items on Backorder"`; `R_STATUS_COLOR`: `partially_fulfilled → "orange"`
- [ ] `R_STEPS` gains a step between "Being Packed" and "Ready": `{ key: "partial", label: "Partial Delivery" }` — active when ticket is `partially_fulfilled`; shows sub-label "Your backordered items will ship when stock is available"
- [ ] `resellerStep()` updated to map `partially_fulfilled` to the new step index

**Packing board UI — backorder entry visibility:**
- [ ] `OrdersTickets.js` packing board card: when `is_backorder: true`, show an "Backorder" chip in the card header; `waiting_stock: true` entries render with a distinct amber "Waiting for Stock" state instead of the normal pipeline steps
- [ ] Packing board list filter: add "Waiting Stock" filter chip (shows only `waiting_stock: true` entries) so the fulfilment team can see all open backorders in one view
- [ ] Items list on packing card: show `qty_reserved` / `qty_ordered` per item; `is_backordered` items shown in amber with strikethrough on the quantity

**Sales ticket detail — multi-delivery view:**
- [ ] `SalesTickets.js` detail view Delivery & Fulfilment section already renders all pickings; add `collected_at` display per delivery and the "Mark as Collected" button (for Orders Clerk role) per picking that has `status = done` in Odoo
- [ ] If ticket is `partially_fulfilled`, show an amber banner: "This order has been partially fulfilled — [N] item(s) are on backorder" with the backorder item list

**Email templates (all in `email_service.py`):**
- [ ] `send_order_confirmed_partial(reseller_email, order_ref, customer_name, shipped_lines, backorder_lines, reseller_name, cc)` — confirms the order, lists what will ship in the first delivery, lists backordered items and explains they will be fulfilled when stock is available; warm, clear language; no internal system names
- [ ] `send_backorder_alert_internal(to, order_ref, customer_name, reseller_name, backorder_lines)` — internal alert to fulfilment team at `order_to` routing address; lists the shortfall items, flags the order ref, links to action needed
- [ ] `send_partial_delivery_ready(reseller_email, order_ref, customer_name, collected_lines, backorder_lines, reseller_name, cc)` — tells reseller their partial delivery is ready for collection; lists what's ready now and what's still on backorder
- [ ] `send_backorder_created_internal(to, order_ref, customer_name, backorder_ref, backorder_lines)` — internal; backorder picking created in Odoo, items listed, asks fulfilment team to monitor stock
- [ ] `send_backorder_stock_ready(reseller_email, internal_to, order_ref, customer_name, backorder_lines, reseller_name)` — two sends: internal alert + reseller notification that backordered items are now in stock and will be packed
- [ ] All templates: no em dashes, no internal system names to external recipients, `_wrap()` shell, responsive layout

**Design decisions:**
- **Invoice deferred to collection, not confirm, for partial orders only** — full orders continue to invoice on confirm (existing behaviour). Only when `is_partial` is detected at confirm time does the invoice step skip. This avoids invoicing for quantities that haven't shipped, and matches the user's explicit requirement ("invoice on collection for what they collected").
- **Odoo is source of truth for backorder picking identity** — backorder packing board entries are created by reading the actual Odoo picking created by the backorder wizard. The portal never invents a backorder; it always reads one back from Odoo.
- **`waiting_stock` is a portal-layer concept** — Odoo's `stock.picking.state` is the authoritative signal (`confirmed`/`waiting` = not yet assigned, `assigned` = ready). The portal's `waiting_stock` flag mirrors this so the packing board can render without a live Odoo call per card.
- **Mark as Collected is an Orders Clerk action, not Finance** — collection is a physical logistics event, not a financial one. Finance's role begins when the invoice for the collected portion is confirmed paid, using the existing `confirm-payment` flow.
- **Reseller must explicitly acknowledge backorder at confirm time** — a passive warning is not enough for a financial commitment. The reseller clicks through a modal that lists exactly what will ship and what will be backordered.
- **Phase 13 bridge is a documented hook, not built here** — the automated "new stock enters vault → backorder assigned → notify team" loop requires Phase 13's batch traceability and vault receipt workflow. The manual "Check stock availability" button on the packing board serves as the interim solution.

#### 8.22 — Customer Document Upload Request — Added 2026-07-07

**Goal:** Admins can request outstanding onboarding documents from an existing customer by generating a secure, time-limited upload link. The link is emailed to the customer (or a contact on their account) and allows unauthenticated file upload directly to R2. The customer profile shows the request status so other admins know a request was sent and can see whether it was acted on.

- [x] `POST /api/upload-requests/` — admin creates an upload request for a given Odoo partner; generates a `secrets.token_urlsafe(32)` token; stores in `doc_upload_requests` collection with partner details, sent-to email, sent-by user, created_at, expires_at (+7 days), status `pending`; fires `send_doc_upload_request` email via BackgroundTask; audit-logged
- [x] `GET /api/upload-requests/customer/{partner_id}` — returns the most recent upload request for a customer (for the profile status banner); gated on `customers.manage`
- [x] `GET /api/upload-requests/{token}` — public (unauthenticated); validates token; returns expired/not_found or `{ valid, partner_name, already_uploaded }`; marks `first_accessed_at` and advances status to `accessed` on first visit
- [x] `POST /api/upload-requests/{token}/files` — public; accepts multipart file upload (multiple files); stores each in R2 under `customers/{partner_id}/uploads/`; mirrors into `customer_documents` collection so files appear on the admin profile immediately with `source: "customer_upload"`; advances status to `uploaded`; fires `send_doc_upload_notification` to onboarding inbox via BackgroundTask
- [x] `send_doc_upload_request` email template — warm language, amber info box with account/expiry details, CTA button, `footer_note` invites reply
- [x] `send_doc_upload_notification` email template — sent to onboarding inbox; lists files received, uploaded-by email, timestamp
- [x] `PublicDocUpload.js` — standalone branded public page at `/upload-docs/:token`; no portal auth required; states: loading, valid (drag-drop upload), expired, not_found, done; multi-file drag-and-drop with remove control; submit button disabled until files selected
- [x] `UploadRequestBanner` component inside CustomerProfile.js Documents section — colour-coded by status: amber (pending), blue (accessed/awaiting upload), green (uploaded with file count), gray (expired/not used); shows sent-to email, sent-by name, created date, expiry date; "Send new link" / "Resend" button for non-uploaded states
- [x] "Request docs" button added to Documents section header — opens a modal listing available recipient emails (company email + all contact emails as radio options); admin selects recipient, submits; banner refreshes on success
- [x] `SOURCE_BADGE` + `docProvenance` in CustomerProfile.js updated to handle `customer_upload` source (amber "Customer Upload" badge)

**Status tracking states:**
- `pending` — link sent, link not yet opened
- `accessed` — link was opened, no files uploaded yet
- `uploaded` — files received (terminal state, banner turns green)
- `expired` — derived at read time when `expires_at < now` and status is not `uploaded`

#### 8.21 — Sentry Noise Fixes — Added 2026-07-07

**Goal:** Four Sentry events were generating error-level alerts for conditions that are expected or user-caused, not server failures.

- [x] **Graph 404 in inbox:** Microsoft Graph webhook fires on message delivery; if the message is deleted (spam filter, ZAP rule) before the portal fetches it, Graph returns 404. Reclassified from `logger.error` to `logger.info` in `_ingest_message` with descriptive message `inbox_message_not_found`. `httpx.HTTPStatusError` caught explicitly before the catch-all.
- [x] **IMAP EOF on idle connections:** `imaplib.IMAP4.abort` is raised on socket-level connection drops (idle timeout). Reclassified from `logger.error` to `logger.warning` in the IMAP poll loop in `server.py`. `isinstance(exc, imaplib.IMAP4.abort)` check added before the generic error branch.
- [x] **Mailbox test Graph 401:** When an admin tests Microsoft 365 credentials that are wrong/expired, Microsoft returns 401. Previously wrapped as `HTTPException(502)` — a server error. Now caught with `_httpx.HTTPStatusError` specifically: if `status_code == 401`, raises `HTTPException(422)` with a plain-English message about checking Client ID/Secret/Tenant ID. Other `HTTPStatusError` codes still raise 502. Generic exceptions still raise 502.
- [x] **Mailbox test IMAP AUTHENTICATIONFAILED:** When an admin tests IMAP credentials for a mailbox that doesn't exist or has a wrong password, the IMAP server returns `[AUTHENTICATIONFAILED]`. Previously wrapped as `HTTPException(502)`. Now detected by string match in the exception message and raised as `HTTPException(422)` with a clear credentials message.

#### 8.20 — Ticket Reassignment — Added 2026-07-07

**Goal:** Admins can reassign any open ticket to a different internal staff member from within the ticket detail view.

- [x] `PUT /api/tickets/{ticket_id}/reassign` — `require_admin`-gated; validates new assignee exists and is not a reseller; updates `assigned_to`, `assigned_to_name`, `assigned_to_email`; pushes a stage_history entry "Reassigned from X to Y by Z"; audit-logs before/after; background tasks: `notify_ticket_assigned` push notification + `send_ticket_assigned` email to new assignee
- [x] `SalesTickets.js` — assignee display in sidebar replaced with editable block; Pencil/Reassign button (visible to `isAdmin` on open tickets); inline dropdown with staff search typeahead (fetches `/api/users/`, filters out resellers, caches in `staffList`); current assignee highlighted in list; `submitReassign()` handler calls the new endpoint and refreshes detail

#### 8.19 — Ticket Customer Context — Added 2026-07-07

**Goal:** Surface the customer's email address and company link in the ticket detail sidebar, and back-fill this data on existing tickets lazily.

- [x] `create_ticket`: fetches `["name", "email", "parent_id"]` from Odoo when creating tickets; stores `customer_email`, `customer_company_id`, `customer_company_name` on the ticket document
- [x] `create_ticket_from_inbox` (inbox routes): stores `customer_email` from the `from_email` of the root inbox document
- [x] `get_ticket` lazy backfill: on ticket GET, if `customer_company_id` or `customer_email` is missing, fetches from Odoo and writes back to MongoDB (one-time per ticket; silent on failure)
- [x] `SalesTickets.js` sidebar: shows `customer_email` as a `mailto:` link; if `customer_company_id` set, shows "Contact at [Company]" with a navigate button to the company profile; if standalone contact, shows "View customer profile" link and (for `customers.manage`) a "Link to company" inline modal; ticket list "Customer" column appends `(customer_company_name)` when set

#### 8.18 — Partner Directory — Added 2026-07-07

**Goal:** Surface all Odoo `res.partner` records (not just those with `customer_rank > 0`) so admins can find standalone contacts like Stuart Oakes who exist in Odoo but are not visible in the Customers list, and link them to their correct company.

- [x] `partner_routes.py` — `GET /api/partners/counts`, `GET /api/partners/?filter=all|company|linked|unlinked&search=&limit=&offset=` with Odoo domain per filter; `PATCH /api/partners/{partner_id}/link-company` — validates partner is not a company, target is a company, writes `parent_id` + `type="contact"` to Odoo; audit-logged
- [x] `PartnerDirectory.js` — filter pills: All Partners / Companies / Linked Contacts / Unlinked Contacts (amber badge count); SearchBar; DataTable with Name/Email (avatar icon), Type badge, "Linked to" column (amber "Not linked" for unlinked), Roles badges, Actions (Link/Relink/Profile); "Link to company" modal with company search typeahead; pagination 50/page
- [x] Added to `ADMIN_NAV` in `UI.js` under "Admin" section, gated on `customers.manage`; route `/partners` added as `adminOnly` in `App.js`

#### 8.17 — Contact Link to Company — Added 2026-07-07

**Goal:** Allow admins to set `parent_id` on a standalone Odoo contact, linking them to a company, directly from the portal. Previously required opening Odoo.

- [x] `PATCH /api/customers/{partner_id}/link-company` — validates the partner is not already a company; validates the target `company_id` is a valid `is_company=True` record; writes `parent_id` + `type="contact"` to Odoo via XML-RPC; audit-logged
- [x] Exposed via the Partner Directory "Link to company" modal and the ticket sidebar "Link to company" action

#### 8.16 — Customer Profile Contacts Section — Added 2026-07-07

**Goal:** Show all Odoo child contacts (sub-partners with `parent_id = customer_id`) on the customer's 360 profile, so admins can see who is associated with the account without opening Odoo.

- [x] `GET /api/customers/{id}/profile` — contacts fetch updated: removed `["type", "=", "contact"]` filter that was excluding contacts with non-standard Odoo types (e.g. Stuart Oakes, who had no type set); now fetches all active partners with `parent_id = customer_id`
- [x] `CustomerProfile.js` — Contacts section added between Addresses and Documents; renders Name, Job Title, Email, Phone, Mobile in a table; hidden when `contacts.length === 0`; destructure updated to `contacts = []` default

#### 8.15 — Link Existing Order to Ticket — Added 2026-07-06

**Goal:** When a ticket is created from an inbox inquiry about an existing order (e.g. "can we collect our order?"), the sales rep can link the existing Odoo sale order to the ticket instead of building a new quote. Previously the only path from an open ticket was "Build Quote," which is wrong for follow-up inquiries.

- [x] `POST /api/tickets/{ticket_id}/link-order` — accepts `{ order_id: int }`; validates ticket is open and unlinked; fetches `sale.order` from Odoo; rejects cancelled orders and orders already tracked by another open ticket; advances ticket stage to match Odoo state (draft/sent → quote, sale/done → sale_order), never backwards; writes timeline entry and audit log; broadcasts via WebSocket
- [x] `SalesTickets.js` — "Link Existing Order" button added alongside "Build Quote" in the empty-state panel and in the Actions sidebar (both gated on `canDrive && !detail.order_id && !detail.exit_status`); typeahead order search modal (300ms debounce, min 2 chars) calls `GET /api/orders/?search=<q>&limit=10`; results show order ref, customer name, Odoo state label, and amount total; selected order shows a confirmation card before submit

**Design decisions:**
- **Any confirmed Odoo state is accepted** (unlike `POST /from-order` which restricts to draft/sent). A ticket linked to a sale-confirmed order correctly lands at `sale_order` stage — Finance can then register the deposit without the BA needing to re-confirm.
- **Stage advancement only, never backwards.** If the ticket is already at `sale_order` and the linked order is a draft, the ticket stays at `sale_order`. The rep drove it there intentionally.
- **Cancelled Odoo orders are rejected.** There is no useful state to advance to — reject with a clear message rather than silently linking a dead order.

#### 8.24 — Invoice Lifecycle Actions from Portal — Complete 2026-07-10

**Goal:** Finance and Sales never need to open Odoo to manage invoice state. The Sales Ticket detail sidebar exposes every invoice action (send invoice, PDF download, credit note, reset to draft) so the portal is the single interface for the full invoice lifecycle.

**Context:** The existing `confirm-payment` action reads Odoo's `payment_state` to verify payment. But sending the invoice PDF, downloading it, issuing a credit note for returns, or resetting a draft invoice all currently require opening Odoo directly — violating Architecture Principle 2.

- [x] `POST /api/tickets/{ticket_id}/send-invoice` — finds the linked `account.move`; locates Odoo's invoice mail template (model = `account.move`, name contains "invoice"); calls `send_mail` with `force_send=True`; stamps `invoice_sent_at` on the ticket document; fires background notification to Finance; graceful degradation if Odoo mail server not configured (returns `warning` field); requires `tickets.finance_confirm`
- [x] `GET /api/invoices/{invoice_id}/pdf` — calls `ir.actions.report.render_qweb_pdf` via XML-RPC with report `account.report_move_full_lines`; returns PDF bytes as `application/pdf` streaming response; filename: `Invoice-{invoice_name}.pdf`; requires `require_admin`
- [x] `POST /api/invoices/{invoice_id}/reset-to-draft` — calls `button_draft()` on Odoo `account.move`; only allowed on `posted` state where `payment_state = 'not_paid'`; blocks on paid invoices (400); audit-logged; requires admin + `tickets.finance_confirm`
- [x] `SalesTickets.js` — Invoice section gains: "Send Invoice" / "Resend Invoice" button (adapts label, same pattern as Send Quote), "Download PDF" link (opens `/api/invoices/{id}/pdf` in new tab), "Reset to Draft" button (danger styling, confirm modal, `isAdmin` gate), "Credit Note" button (opens 8.26 modal); `invoice_sent_at` timestamp displayed when set

#### 8.25 — Invoice Type Selection — Complete 2026-07-10

**Goal:** The deposit registration modal offers all three Odoo invoice types: regular invoice, down payment by percentage, and down payment by fixed amount. Currently the portal hardcodes fixed-amount down payments — the other two types require opening Odoo.

**Context:** Odoo's `sale.advance.payment.inv` wizard supports `advance_payment_method` values: `'delivered'` (regular invoice for delivered quantities), `'percentage'` (down payment as % of total), `'fixed'` (fixed amount). The existing `register-deposit` endpoint hardcodes `'fixed'`.

- [x] Extend `DepositBody` Pydantic model in `ticket_routes.py`: add `invoice_type: Literal['delivered', 'percentage', 'fixed'] = 'fixed'`; add `percentage: Optional[float] = None`; validate `percentage` in range (0, 100] when type is `'percentage'`; `amount` required only when type is `'fixed'`; `'delivered'` type requires neither
- [x] `register-deposit` backend: passes `advance_payment_method = body.invoice_type` and the correct amount field to the Odoo wizard; `percentage` maps to Odoo's `amount` field; `delivered` passes no amount; audit log `before`/`after` includes `invoice_type`
- [x] `SalesTickets.js` — Deposit modal gains a 3-option radio selector: "Regular Invoice (100%)", "Down Payment (%)", "Down Payment (Fixed Amount)"; amount/percentage input shown conditionally; human-readable descriptions under each option; no Odoo terminology exposed

#### 8.26 — Customer Credit Notes — Complete 2026-07-10

**Goal:** Finance can raise a credit note against a posted invoice directly from the portal for damaged goods, short deliveries, or pricing corrections. Creates an `account.move` credit note in Odoo, linked back to the ticket.

- [x] `POST /api/invoices/{invoice_id}/credit-note` — creates `account.move.reversal` in Odoo pointing to the original invoice; calls `reverse_moves()` to generate the credit note; accepts `reason: str`, `date: str`, `journal_id: int`; returns credit note `{id, name, amount}`; stores `credit_note_id` and `credit_note_name` on the ticket document; fires `send_credit_note_raised_internal` email to Finance; audit-logged with full before/after; requires `tickets.finance_confirm`
- [x] `GET /api/tickets/credit-note-journals` — returns Odoo `sale` or `general` type journals suitable for credit notes (same XML-RPC pattern as `payment-journals`)
- [x] `SalesTickets.js` — "Credit Note" action card in Finance section; shown when `invoice_id` is set and ticket not `cancelled` or `complete`; modal with reason (required free-text), date (defaults today), journal dropdown; confirm step: "This will create a credit note in Odoo against invoice {name}"; shows credit note reference + download link after creation

#### 8.27 — Customer Address Types — Complete 2026-07-10

**Goal:** Customers can have separate invoice and delivery addresses that flow through to Odoo sale orders and delivery notes. Currently all addresses are treated as the single contact address — preventing correct delivery documentation for customers with multiple sites.

**Context:** Odoo `sale.order` has `partner_invoice_id` and `partner_shipping_id` alongside `partner_id`. Odoo auto-resolves these from child `res.partner` records typed as `'invoice'` or `'delivery'`. Creating typed address records for customers unlocks correct billing and shipping on every order.

- [x] `GET /api/customers/{id}/addresses` — returns all `res.partner` records with `parent_id = customer_id`, `active = True`, grouped by type (`contact`, `invoice`, `delivery`, `other`)
- [x] `POST /api/customers/{id}/addresses` — creates a child `res.partner` in Odoo with `parent_id = customer_id`, `type` from request body (`'invoice'` | `'delivery'` | `'other'`); required: `street`, `city`, `zip`, `country_id`; optional: `name`, `phone`, `email`; requires `customers.manage`; audit-logged
- [x] `PUT /api/customers/{id}/addresses/{address_id}` — updates the child partner; validates `address_id` has correct `parent_id`; audit-logged
- [x] `DELETE /api/customers/{id}/addresses/{address_id}` — archives (`active = False`) in Odoo; blocks archiving the main contact address; requires `customers.manage`; audit-logged
- [x] `CustomerProfile.js` — Addresses section extended: type badge per address (Invoice / Delivery / Other / Contact); "Add address" button (admin gate) opens modal with type selector and address fields; pencil/archive actions per non-contact row
- [x] Quote builder `SalesTickets.js`: "Invoice Address" and "Delivery Address" dropdowns in quote header, populated from `/api/customers/{id}/addresses`; selected IDs passed as `partner_invoice_id` and `partner_shipping_id` in `create-order` and `update-order`; defaults to main contact if only one address exists
- [x] `create-order` / `update-order` backend: accept optional `partner_invoice_id` and `partner_shipping_id`; write to `sale.order` in Odoo alongside `partner_id`
- [ ] Onboarding wizard Step 2 (Business Details): add optional "Delivery Address (if different)" collapsible section; stored in the application document; on approval, creates a child delivery-type partner in Odoo alongside the main company partner — **deferred, lower priority**

#### 8.28 — Payment Terms and Quotation Descriptions — Complete 2026-07-10

**Goal:** The quote builder surfaces the customer's Odoo payment terms so Sales knows the agreed terms before building the quote, and product lines auto-populate from Odoo's sales description field — reducing manual entry and keeping quotes consistent with Odoo records.

- [x] `GET /api/customers/{id}/payment-terms` — reads `property_payment_term_id` from Odoo `res.partner`; returns `{id, name}` or `null` if not set
- [x] `GET /api/tickets/payment-terms` — returns all active `account.payment.term` records from Odoo for the quote builder override dropdown; requires `require_admin`
- [x] Quote builder `SalesTickets.js`: "Payment Terms" row in quote header; pre-populated from customer's Odoo record; selectable from full list via `GET /api/tickets/payment-terms`; `payment_term_id` passed in `create-order` / `update-order` body
- [x] `create-order` / `update-order` backend: accept optional `payment_term_id`; write to `sale.order` in Odoo; skip (not error) if omitted
- [x] `GET /api/products/?search=...` response: include `description_sale` from Odoo `product.product` in each result row
- [x] `ProductLineRow.js` inline search dropdown: show `description_sale` as a subtitle line below product name/SKU in results
- [x] `ProductLineRow.js` on product selection: if line description field is blank, auto-populate from `description_sale`; field remains editable; auto-populated value can be cleared or overridden

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
- [x] Resellers can build a draft quote via the cart (Orders view), view and manage their quotes in My Quotes (Sales Tickets), and edit a quote by returning to the cart pre-populated — reseller draft quotes are hidden from the staff queue until confirmed
- [x] Finance can send an invoice PDF to a customer from the ticket detail — no Odoo access required (8.24)
- [x] Finance can download an invoice PDF from the portal (8.24)
- [x] Finance can raise a credit note against an invoice from the ticket detail — no Odoo access required (8.26)
- [x] The deposit registration modal offers Regular Invoice, Down Payment (%), and Down Payment (Fixed Amount) — all three Odoo invoice types accessible from the portal (8.25)
- [x] Customer invoice and delivery addresses are set at quote creation and flow through to the Odoo sale order (8.27)
- [x] Customer's Odoo payment terms appear in the quote builder and are written to the Odoo sale order (8.28)
- [x] Product line descriptions auto-populate from Odoo's sales description field when a product is added to a quote (8.28)
- [x] Finance can perform all invoice lifecycle actions (Send, PDF, Reset to Draft, Credit Note) directly from the Invoices page without requiring a linked Sales Ticket (8.29)
- [x] Invoices with a linked Odoo sale order but no portal ticket show a "Create Ticket" action on the Invoices page (8.29)
- [x] Dedicated Backorders view at `/orders/backorders` — all pending Odoo backorder pickings with outstanding product quantities, linked tickets, MO status, and By Order / By Product toggle (8.30)
- [x] Batch/lot numbers displayed on order A4 view, packing slip, and invoice print view — sourced from `stock.move.line.lot_id` on done pickings linked to the sale order (8.31)
- [x] Manufacturing order (MO) status visible on Sales Ticket detail (Production Status card, shown when any delivery is a backorder), Orders Ticket waiting_stock panel, and Backorders admin view MO chip — sourced from `mrp.production` via origin field match on sale order name (8.32)
- [x] Order Passport — unified lifecycle view at `/orders/{id}/passport` showing overall status, pipeline stepper, ticket, invoice, deliveries, batch/lot numbers, and MOs on one page; barcode scan and invoice scan navigate here directly (8.33)
- [x] Reseller identity visible on every order-related view — Sales Ticket list, Sales Ticket detail, Order list, Order detail, Order Passport ticket card, packing board order detail, and Backorders page — for all reseller orders regardless of commission eligibility (8.34)

#### 8.32 — Manufacturing Order Visibility — Complete 2026-07-11

**Goal:** Staff can see whether a replenishment manufacturing order exists for a backordered product and what its current state is, without opening Odoo. This closes the "do it in Odoo" gap for backorder tracking.

- [x] `GET /api/orders/{order_id}/manufacturing-orders` — reads `mrp.production` records where `origin = SO name`, excludes done/cancelled; returns `mo_id`, `mo_name`, `state`, `product_id`, `product_name`, `product_qty`, `qty_producing`, `date_planned_start`, `date_planned_finished`; non-fatal (degrades to empty array if mrp module not installed)
- [x] Backorders view MO chip (`Backorders.js`) — enhanced with `qty_producing/total` and `due {date}` from `date_planned_finished`
- [x] Sales Ticket detail (`SalesTickets.js`) — "Production Status" card appears below Delivery & Fulfilment section when any delivery is a backorder; auto-fetches MOs; shows MO name, product, qty_producing, due date, and colour-coded state badge
- [x] Orders Ticket waiting_stock panel (`OrdersTickets.js`) — "Production orders" sub-section appears inside the amber waiting_stock card when MOs are found; same fields + state colours
- [x] MO state colour scheme: `draft` → grey, `confirmed` → amber, `progress` → green, `to_close` → blue

**State propagation:** `detail?.order_id + deliveries.some(d => d.is_backorder)` triggers MO fetch in SalesTickets; `detail?.status === "waiting_stock"` triggers MO fetch in OrdersTickets. Both degrade gracefully when no MOs exist.

---

#### 8.33 — Order Passport — Complete 2026-07-11 (extended 2026-07-12)

**Goal:** Any staff member scanning a barcode, typing an order ref, or typing an invoice ref gets a single page showing the complete lifecycle of that order — ticket stage, invoice status, delivery state, batch/lot numbers, and any active MOs — without having to navigate between three separate views.

- [x] `GET /api/orders/{order_id}/passport` — aggregates sale order, partner detail, order lines, MongoDB sales ticket, first linked invoice, outgoing pickings, lot map from done pickings, and MOs (if backorder); derives single `overall_status` object (`label`, `color`, `detail`) from all sources combined; enforces same reseller access check as `GET /{order_id}`
- [x] `OrderPassport.js` — full-page view at `/orders/:orderId/passport`; pipeline stepper (Quote → Order → Deposit → Packing → Complete) reflects active ticket stage; overall status badge with colour-coded pill; two-column grid for ticket + invoice cards; delivery section with per-line qty and batch chips; order lines table with batch references; quick-link footer buttons
- [x] `App.js` — route `/orders/:orderId/passport` added (no `adminOnly` — accessible to any authenticated role that can access orders)
- [x] `search_routes.py` — order scan navigates directly to `/orders/{id}/passport`; invoice scan resolves linked sale order via `invoice_origin` and navigates to that order's passport
- [x] Lot map built via independent `search_read` block (not inside delivery block) — correctly resolves lots from done pickings regardless of delivery fetch outcome
- [x] Deliveries fetched via parallel call to `/api/orders/{id}/deliveries` (proven endpoint) — avoids Odoo computed field silent-return issue with `picking_ids` on `read()`
- [x] Odoo order state displayed as human-readable badge inline with the order reference (`draft` → Quotation, `sale` → Sales Order, etc.) — consistent with Orders view terminology
- [x] `hasPartialDelivery` gate — backorder state and outstanding line highlighting only trigger after at least one delivery is in `done` state; draft quotes are never falsely flagged
- [x] Outstanding order line rows are clickable — navigate to `/orders/backorders` pre-filtered to that SO name
- [x] Sales Ticket card on passport shows: order type pill (purple Reseller Order / blue Internal Order), reseller name, customer name, ticket notes, and both created and last-updated timestamps

**Overall status derivation:** Reads `order.state`, `ticket.status`, `ticket.exit_status`, `invoice.payment_state`, and `deliveries` in priority order to produce one human-readable label + detail string — e.g. "Awaiting Stock · Invoice INV/2026/00042 is outstanding."

---

#### 8.34 — Reseller Traceability Across All Views — Complete 2026-07-12

**Goal:** Every view that shows an order — whether in the ticket pipeline, the orders list, the packing board, or the backorders view — identifies the reseller who placed it. This applies to all reseller orders regardless of whether the reseller is commission-eligible (non-commission resellers had no `order_commissions` record, so their name was silently missing).

- [x] `order_routes.py` — new reseller tickets now stamp `reseller_name` and `source="reseller"` at write time (looked up from `resellers` collection during auto-ticket creation in `create_order`); eliminates read-time join for all new orders
- [x] `ticket_routes.py` `list_tickets` — batch-resolves `reseller_name` for old tickets with `reseller_id` but no `reseller_name` (one `resellers` collection query per list call, not N); also normalises `source` from `"portal"` to `"reseller"` for old reseller tickets
- [x] `ticket_routes.py` `get_ticket` — single reseller lookup fallback for old tickets; normalises `source` field
- [x] `order_routes.py` `list_orders` — commission fetch converted from N individual `find_one` calls to one batch query; falls back to linked ticket's `reseller_name` for orders with no commission record (non-commission resellers, draft quotes)
- [x] `order_routes.py` `get_order` — same ticket fallback for single-order detail
- [x] `ticket_routes.py` auto-sync packing board creation — falls back to ticket's `reseller_id`/`reseller_name` when no commission record exists; `is_reseller` flag now set from ticket presence, not commission presence
- [x] `ticket_routes.py` admin-override packing board creation — same fallback
- [x] `SalesTickets.js` ticket list — customer column now shows purple "Reseller Order" badge + reseller name; "Email Inquiry" badge added; `"portal"` source now shows correctly as "Portal Order"
- [x] `SalesTickets.js` ticket detail — "Via reseller: [name]" banner (purple) above Bill To section; source badge updated to handle `"reseller"` source
- [x] `OrdersTickets.js` packing board detail — reseller name shown whenever present (removed `is_reseller` gate); consistent purple colour
- [x] `OrderPassport.js` ticket card — order type pill (purple Reseller Order / blue Internal Order) + reseller name row + customer name row

**Key design decision:** Reseller name is denormalised onto the ticket document at creation time. Read-time backfill only fires for pre-existing tickets that predate this change. This avoids joins on every list render while ensuring all historical data is still surfaced correctly.

---

#### 8.35 — Per-Line Qty Packed + Packing-Time Shortfall Handling — Complete 2026-07-13

**Goal:** When a packer physically has fewer units than Odoo reserved (e.g. 9 units in the bin, 10 reserved), they can record the actual qty for that line without halting the entire order. Odoo then creates a backorder automatically for the shortfall via its standard wizard. "Report Packing Issue" (previously "Mark Incomplete") is reserved for true order-blocking situations only.

- [x] `order_routes.py` `create_order` packing board item builder — adds `product_id` to every item dict so the backend can match portal items to Odoo move lines
- [x] `packing_board_routes.py` — `UpdateItemQtyBody` Pydantic model; `PUT /update-item-qty` endpoint: validates qty_packed is in [0, qty_reserved], writes to the item's `qty_packed` field in MongoDB, audit-logs the change; permission: `tickets.orders`
- [x] `_validate_odoo_delivery` — accepts optional `qty_overrides: {product_id: qty_packed}` dict; when provided, reads `stock.move.line` records for the picking and writes `qty_done` per move line (filling in order until the override qty is reached, leaving remainder at 0); falls back to `action_set_quantities_to_reservation` when no overrides present
- [x] `complete_entry` — builds `qty_overrides` from any `qty_packed` values stored on the packing board items; passes to `_validate_odoo_delivery`; detects packing-time shortfall (qty_overrides produced a backorder); creates a portal backorder entry for the short lines with the correct short qty; sets `has_pending_invoice=True` on the primary entry when a packing-time shortfall creates a new delivery (so `mark_collected` creates the invoice)
- [x] `OrdersTickets.js` — "Qty Packed" column added to the items table (between Reserved and Batch/Lot), visible when `canOrders && !isTerminal`; number input defaults to `qty_packed ?? qty_reserved`; saves on blur/Enter via `PUT /update-item-qty`; amber "Short N" label appears below the input when qty_packed < qty_reserved; hidden for backordered items; draft state cleared on order switch
- [x] `OrdersTickets.js` — "Mark Incomplete" renamed to "Report Packing Issue" throughout (button, modal title, confirm button, amber label in notes section); action card description updated to direct packers to use Qty Packed for shortfalls and reserve this action for order-blocking issues

**Two-path shortfall design:**
- Qty shortfall on a line (9 of 10): adjust Qty Packed, Odoo creates backorder automatically, order proceeds for the 9 units
- True blocking issue (damaged goods, wrong product, QA failure): Report Packing Issue, order halted, Sales notified, reason visible on all downstream views

---

#### 8.36 — Ticket Linking and Inbox Integration — Complete 2026-07-13

**Goal:** Close gaps where the 1-ticket-per-order constraint creates dead-ends, and surface the ticket pipeline at every point in the workflow where an email or order first enters the system.

**Three scenarios addressed:**

1. **Inbox "Convert to Ticket" with optional SO link** — the "Create Ticket" button in the Sales Inbox now opens a modal instead of firing immediately. Staff can optionally enter the Odoo order reference. If provided: the backend checks whether that order already has an open ticket; if yes, the email thread is linked to the existing ticket (not creating a new one); if no, the new ticket is created with `order_id` already set. If no order is entered, an unlinked inquiry ticket is created as before.

2. **"Create Ticket" preflight from Orders / Invoices / Order Passport** — clicking "Create Sales Ticket" from any of these three surfaces now first calls a preflight endpoint. If the order already has an open ticket, a modal shows a direct link to that ticket (escape hatch replaces the dead-end 409 toast). If the same customer has open inquiry tickets with no order linked, the modal lists them and offers a "Link This" action (routes to `POST /api/tickets/{id}/link-order`) as an alternative to creating new.

3. **Email thread linking to existing ticket** — new `POST /api/inbox/{item_id}/link-thread` endpoint allows linking an existing inbox thread to an existing sales ticket, stamping both directions. Used by the inbox "Convert to Ticket" modal's order-linked path.

**Implementation:**
- [x] `ticket_routes.py` — `GET /api/tickets/from-order/preflight?order_id=X`: looks up Odoo order, checks for existing linked ticket, returns up to 10 open unlinked tickets for the same customer; `POST /api/tickets/from-order` 409 now returns `{message, existing_ticket_id}` dict in detail for frontend escape hatch
- [x] `inbox_routes.py` — `create_ticket_from_inbox` accepts optional `order_id` body param; if provided and order has existing ticket, routes to thread-linking logic (returns `{linked: true}`); `_stamp_thread_with_ticket` extracted as shared helper; `POST /{item_id}/link-thread` new endpoint
- [x] `SalesInbox.js` — "Create Ticket" button opens a modal with optional order search; three outcomes handled: linked to existing ticket, new ticket with order, new unlinked ticket; navigates to ticket on success
- [x] `Views.js` (Orders) — preflight call on "Create Sales Ticket"; modal with linked-ticket path (open existing) and unlinked-ticket path (link or create new); `doLinkUnlinkedTicket` calls existing `link-order` endpoint
- [x] `Invoices.js` — same preflight + modal pattern
- [x] `OrderPassport.js` — same preflight + modal pattern

**Audit:** Every link action (thread-to-ticket, ticket-to-order via preflight) is audit-logged under `inbox.thread_linked` / `ticket.link_order`.

---

#### 8.37 — Customer Onboarding Redesign (Full Flow) — Complete 2026-07-13

**Goal:** Remove the TQA document from all surfaces and redesign the onboarding flow so that customers only sign the Customer Information Form at self-registration time. NDA and Store Onboarding Agreement are generated by admin for review, then deliberately sent to the customer via a 30-day secure signing session. After countersigning, a welcome pack is sent to the customer by Dean/Kashi to complete onboarding.

**Business rationale:** Prevents confidential Bassani template documents (NDA, SOA) from being distributed publicly via the /apply URL. Admin has full visibility and control at each handoff — generate, review, send, countersign, welcome pack, approve.

**Key decisions confirmed:**
- Hard gate: all 4 docs (CIF + CIPC + NDA + SOA) must be present and NDA + SOA countersigned before Odoo customer creation is allowed.
- Signing sessions expire after 30 days; admin can resend the same link (or regenerate for a fresh session).
- Generate and Send are separate actions: admin must review pre-filled documents before the customer link is activated.
- TQA removed entirely from all surfaces — templates, doc type constants, signing flows, admin document templates page.
- `BASSANI_SIG_DOC_TYPES` reduced from `{"nda", "tqa", "store_onboarding_agreement"}` to `{"nda", "store_onboarding_agreement"}`.
- Welcome Pack is a fourth managed template in `doc_template_routes.py`, but is not customer-signed — it is attached to the welcome pack email.
- Applications support multiple linked inbox threads (`inbox_thread_ids` array, `$addToSet`). Legacy `inbox_thread_id` string field treated as fallback.

**Phase 1 — TQA removal:**
- [x] `onboarding_routes.py` — removed `tqa.pdf` from `TEMPLATES`, removed `tqa` from `REQUIRED_DOC_TYPES`, updated `BASSANI_SIG_DOC_TYPES`, updated `email_templates` endpoint to send only CIF
- [x] `doc_template_routes.py` — removed `tqa` from `DOC_TYPES`; now three managed templates; added `"welcome_pack"` as a fourth managed template (not customer-signed)
- [x] `public_routes.py` — removed TQA from `TEMPLATES` and `REQUIRED_DOC_TYPES`
- [x] `email_service.py` — removed TQA from `send_onboarding_templates`; updated copy to reflect CIF-only send
- [x] `pdfSigning.js` — removed `tqa` from `DOC_CONFIGS` and `buildPrefill()`
- [x] `DocumentTemplates.js` — removed TQA from `FIELD_REF_DOCS`; added Welcome Pack; description updated to "four templates"
- [x] `CustomerApplicationDetail.js` — removed `tqa` from both `_BASSANI_SIG_TYPES` (status derive) and `BASSANI_SIG_TYPES` (doc card)

**Phase 2 — Customer submission docs reduction:**
- [x] `PublicRegister.js` — `SIGN_DOCS` reduced to `customer_information_form` only; updated signing step instruction copy and progress counter; added Section 22C Facility, Sole Proprietor, Company (Pty) Ltd, Partnership to business type dropdown (now 10 options)
- [x] `CustomerOnboarding.js` — `TEMPLATES` reduced to CIF only; `REQUIRED_DOCS` reduced to CIF + CIPC; updated validation messages

**Phase 3 — Signing session infrastructure (generate/send split):**
- [x] `onboarding_routes.py` — `POST /{id}/generate-signing-docs`: validates initial docs present; creates `signing_sessions` MongoDB doc with 30-day UUID token, `status: "generated"`, `sent_at: null`, form_data snapshot; stamps `signing_session_token` + `signing_session_generated_at` on app; audit-logged; no email sent
- [x] `onboarding_routes.py` — `POST /{id}/send-signing-docs`: finds existing session by token; sends `send_signing_invitation` email via BackgroundTask; updates session `status: "sent"` + `sent_at`; stamps `signing_session_sent_at` on app; audit-logged; can be called multiple times to resend
- [x] `onboarding_routes.py` — `GET /{id}/signing-session`: returns current session state + `form_data` (needed for client-side preview) for admin detail page
- [x] `public_routes.py` — `GET /api/public/signing/{token}`: validates token + expiry + session status (`"generated"` sessions return 403 — customer cannot access before admin sends); returns `form_data` + `docs_to_sign` + `signed` status
- [x] `public_routes.py` — `POST /api/public/signing/{token}/sign/{doc_type}`: accepts signed PDF, stores in R2 under `onboarding/signing-sessions/{token}/{doc_type}.pdf`, updates session, stamps document onto application's `documents` array with `signed_in_portal=true`
- [x] `email_service.py` — `send_signing_invitation()`: sends customer an email with unique `/sign/{token}` link and 30-day expiry date

**Phase 4 — Public signing page:**
- [x] `SigningPage.js` — new public view at `/sign/:token`. No auth required. Loads session from backend, shows a card per document with Sign button. In-modal signing experience (same canvas + pdf-lib pattern as PublicRegister). Posts signed PDFs to the backend signing endpoint. Completion screen shown when all docs signed.
- [x] `App.js` — route `/sign/:token` → `SigningPage` added alongside `/apply` and `/upload-docs/:token`

**Phase 5 — Admin application detail page:**
- [x] `CustomerApplicationDetail.js` — `signingSession` state fetched on load; three-state signing panel: (a) no session/expired → "Generate Documents" button; (b) session `status: "generated"` → green banner + "Preview NDA" / "Preview Store Agreement" (client-side PDF fill via `generateSignedPdf`, opens in new tab with TEST watermark) + "Send to Customer" button; (c) session `status: "sent"` → blue "Awaiting customer signature" banner + doc checklist + "Resend signing link"; panel hidden once NDA + SOA both received
- [x] `CustomerApplicationDetail.js` — `deriveStatus` now distinguishes `"docs_generated"` (session exists, not yet sent) from `"awaiting_signature"` (session sent); new indigo status badge
- [x] `CustomerApplications.js` — list page: `deriveStatus` uses `signing_session_sent_at` (not `signing_session_token`) to determine `awaiting_signature`; `docs_generated` status added to `STATUS_CFG` and `FILTERS`
- [x] `CustomerApplicationDetail.js` — Countersign Assignment panel hidden until at least one portal-signed Bassani-sig doc exists; Actions card shows correct next action at each stage of the pipeline

**Phase 6 — Post-countersign notification and welcome pack:**
- [x] `onboarding_routes.py` — when all Bassani-sig docs countersigned, fires `send_countersign_complete_notification()` to `countersign_complete_to` routing list; iterates `inbox_thread_ids` array
- [x] `onboarding_routes.py` — `POST /{id}/send-welcome-pack`: validates all Bassani-sig docs countersigned; fetches all four onboarding documents (CIF, CIPC, countersigned NDA, countersigned SOA) from R2 plus active welcome pack slot files (budget, letter, price_list, brochure); sends `send_customer_welcome_pack()` email with all files attached (up to 8 attachments); stamps `welcome_pack_sent_at`/`welcome_pack_sent_by`; creates outgoing onboarding inbox thread; audit-logged
- [x] `email_service.py` — `send_countersign_complete_notification()`: notifies configured recipients when all NDA+SOA are countersigned
- [x] `email_service.py` — `send_customer_welcome_pack()`: warm professional email with custom body, sender's `signing_name`/`signing_title` as footer, PDF attachments support
- [x] `settings_routes.py` — `countersign_complete_to: List[str]` added to `EmailRoutingConfig`; included in `get_email_routing` fallback and MongoDB read
- [x] `CustomerApplicationDetail.js` — "Send Welcome Pack" teal button shown when all signing complete and welcome pack not yet sent; confirmation badge shown after send; Welcome Pack modal with custom message textarea

**Phase 7 — Inbox and application flow improvements:**
- [x] `email_service.py` — `send_onboarding_submitted()`: button URL updated to `/applications/{app_ref}` (deep link to specific application, not the list)
- [x] `onboarding_routes.py` — `inbox_thread_ids: []` array on new applications (replaces single `inbox_thread_id`); `$addToSet` used everywhere to prevent duplicates; backward compat: `inbox_thread_id` fallback for old records
- [x] `public_routes.py` — links confirmation email thread to application via `$addToSet inbox_thread_ids`
- [x] `CustomerApplicationDetail.js` — header shows "Thread 1 / Thread 2 / …" chips for multiple linked threads; Contact Applicant button gated on `!(inbox_thread_ids || []).length`; all threads archived on approval
- [x] `EmailSettings.js` — "Onboarding: Documents Countersigned" routing section added between application submitted and order ready sections

**Phase 8 — Admin document review before sending (generate/send split UI):**
- [x] `CustomerApplicationDetail.js` — `generateSigningDocs` handler (calls `generate-signing-docs`); `sendSigningLink` handler (calls `send-signing-docs`); `previewGeneratedDoc(docType)` downloads template from `/api/templates/{docType}/download`, fills via `generateSignedPdf` client-side, opens blob URL in new tab with TEST watermark
- [x] `CustomerApplicationDetail.js` — `DocumentsCard` three-state panel fully implemented

**Definition of Done:**
- Customer submits /apply → only CIF signed + CIPC uploaded → application in `pending` state
- Admin receives email with direct link to the application
- Admin reviews application → clicks **Generate Documents** → session created (`status: "generated"`), no email sent
- Admin clicks **Preview NDA** / **Preview Store Agreement** → pre-filled PDF opens in new tab for review
- Admin clicks **Send to Customer** → signing link email sent → session `status: "sent"`
- Customer opens /sign/{token} → signs NDA → signs SOA → success screen shown
- Admin sees signing session status on application detail page; both docs appear in document list with `signed_in_portal: true`; status badge shows "Awaiting Signature"
- Signing authority claims application → countersigns NDA → countersigns SOA → application status reaches `ready_to_approve`
- Kashi and Dean receive notification email that countersigning is complete
- Dean opens application → clicks **Send Welcome Pack** → enters custom message → sends email with welcome pack + both countersigned docs attached
- Admin approves → Odoo customer created → all 4 docs transferred to customer_documents

---

#### 8.38 — Samples Account — Complete 2026-07-15

**Goal:** Internal Bassani staff use a dedicated Bassani Samples customer account in Odoo for sample orders. These are real stock movements with zero monetary value. The portal classifies them as Sample tickets, enforces R0.00 pricing, records the intended recipient, and hides all finance payment steps. A R0.00 invoice is created in Odoo at mark_complete (same trigger as regular orders) — Odoo marks it paid immediately since nothing is owed — providing a full financial record without requiring Finance to act.

**Key decisions confirmed:**
- `samples_account` flag lives in MongoDB `customer_metadata` collection (keyed by `odoo_partner_id`) — no Odoo changes required
- Each sample ticket requires an Odoo customer lookup for the actual sample recipient (`sample_recipient_id` / `sample_recipient_name`) — free text not allowed
- Portal auto-zeroes all `price_unit` on product select when `is_sample` is true; price field is locked read-only in the quote builder
- Backend also enforces `price_unit = 0.0` for all lines in `create_order_from_ticket` — dual enforcement
- Invoice created at `mark_complete` (same as all orders) — R0.00 total; Odoo marks it paid immediately since `amount_residual = 0`
- Register Deposit, Confirm Payment, Register Balance Payment, and invoice lifecycle actions are all hidden in ticket detail for sample tickets; invoice number IS shown for audit trail
- Stock still moves through the full packing board pipeline

**What was built:**
- [x] `customer_routes.py` — `PATCH /api/customers/{id}/samples-account` writes `samples_account` flag to `customer_metadata` collection; upserts by `odoo_partner_id`; audit-logged
- [x] `customer_routes.py` — `/profile` 360 view includes `samples_account` from `customer_metadata`
- [x] `customer_routes.py` — `/search` endpoint made async; overlays `samples_account` flag from `customer_metadata` on results — lets the create-ticket modal detect samples accounts in search results
- [x] `ticket_routes.py` — `TicketCreate` model: added `sample_recipient_id: Optional[int]`, `sample_recipient_name: Optional[str]`
- [x] `ticket_routes.py` — `create_ticket`: checks `customer_metadata` for `samples_account`; if set, requires `sample_recipient_id`; validates recipient exists in Odoo; stamps `is_sample: True`, `sample_recipient_id`, `sample_recipient_name` on ticket; audit-logs `is_sample`
- [x] `ticket_routes.py` — `create_order_from_ticket`: forces `price_unit = 0.0` for all lines when `ticket.is_sample` is true
- [x] `order_routes.py` — `confirm_order`: extended `_sales_ticket` projection to include `is_sample`; `is_sample` flag stamped on packing board doc at confirm time
- [x] `packing_board_routes.py` — `complete_entry`: `is_sample` guard removed — invoice creation runs unconditionally for all orders; R0.00 sample invoices are posted and Odoo marks them paid immediately
- [x] `CustomerProfile.js` — "Samples Account" section (admin only, `customers.manage` permission) with enable/disable toggle and confirmation modals; "Samples Account" badge in customer header; `samplesAccount` state initialized from profile 360 view response
- [x] `SalesTickets.js` — create modal: shows "Samples Account" badge on matched customer; shows "Sample recipient" Odoo customer search field when customer is a samples account; required validation before create; `sample_recipient_id`/`sample_recipient_name` included in `POST /api/tickets/` body
- [x] `SalesTickets.js` — ticket list: "Sample" badge (amber) replaces source badge for sample tickets; "For: [recipient name]" sub-line shown
- [x] `SalesTickets.js` — ticket detail: amber "Sample order — for [recipient]" metadata banner; Register Deposit, Confirm Payment, Register Balance Payment, and all invoice lifecycle actions gated with `!detail.is_sample`
- [x] `SalesTickets.js` — quote builder: `isSample={!!quoteTicket?.is_sample}` passed to `ProductLineRow`
- [x] `ProductLineRow.js` — `isSample` prop: sets `price_unit: 0` instead of `p.list_price` on product select; replaces price input with a locked "R 0.00" display

**Definition of Done:**
- Admin opens customer profile for the Bassani Samples account → sees "Samples Account" section → enables it → confirmation modal shown → flag saved to `customer_metadata`
- "Samples Account" amber badge appears in customer header
- Sales staff opens New Direct Inquiry → searches for the Samples customer → sees "Samples" label in results → selects it → "Sample recipient" search field appears with amber warning → selects actual recipient customer → creates ticket
- Ticket is created with `is_sample: true`, `sample_recipient_id`, `sample_recipient_name`
- Ticket list shows "Sample" amber badge and "For: [recipient]" sub-line
- Ticket detail shows amber "Sample order — for [recipient]" banner; finance payment actions are absent; invoice number IS shown once created
- Quote builder: adding a product auto-sets price to R0.00; price field is a locked read-only display
- Confirm Order goes directly to packing board (no invoice at this stage); at Mark Complete, a R0.00 invoice is created and posted in Odoo; Odoo marks it paid immediately
- Backend rejects price override — `create_order_from_ticket` forces all `price_unit = 0.0` even if frontend sends non-zero

---

#### 8.39 — Pipeline Redesign: Invoice at Collection, Remove Deposit Step — Complete 2026-07-15

> **Superseded 2026-07-29 by 8.47:** the "no deposit required" decision below was later reversed — a 50% deposit is now a mandatory, universal gate before an order can reach the packing board. The "invoice at collection" (mark_complete) mechanics described here are unaffected and remain current. See 8.47 for the reversal and its reasoning.

**Goal:** Remove the 50% deposit step from the sales/orders ticket pipeline. Orders go straight to the packing board on confirmation, the invoice is raised when the order is ready for collection (after QA + RP sign-off), and the customer pays and collects. This reflects how Bassani actually operates — there is no upfront deposit requirement.

**Old pipeline:** Confirm order → Invoice created immediately → Finance registers deposit → Packing board queued → QA/RP → Mark Complete → Mark Collected

**New pipeline:** Confirm order → Packing board queued immediately → Packing → QA/RP approve → Mark Complete → **Invoice created and posted in Odoo** → Ticket advances to `ready_for_collection` → Finance confirms payment → Customer collects → Mark Collected → Complete

For backorders: each delivery goes through its own packing → QA/RP → Mark Complete → invoice cycle. Customer pays per delivery and collects.

**Key decisions:**
- `"invoice"` stage removed from `STATUSES` — `sale_order` advances directly to `confirmed_wip` on order confirmation
- Invoice created via `sale.advance.payment.inv` wizard at `mark_complete` (after both QA + RP have signed off), not at `confirm_order`
- Invoice posted (not draft) immediately at `mark_complete` — customer can pay on receipt of the notification
- `invoice_id` stamped on the linked Sales ticket at `mark_complete` time so Finance sees it
- Sample tickets continue to produce no invoice at any stage
- `has_pending_invoice` flag on packing board entries is retained — still used to detect pre-confirmation stock shortfalls (partial orders) and drive backorder creation logic

**What was removed:**
- `register-deposit` endpoint (`POST /api/tickets/{id}/register-deposit`) — deleted
- `list_payment_journals` endpoint (`GET /api/tickets/payment-journals`) — deleted
- `TicketDepositRegister` Pydantic model — deleted
- "Register Deposit" button and modal in `SalesTickets.js` — deleted
- Deposit state variables in `SalesTickets.js` (`depositModal`, `depositJournals`, `depositForm`, `depositSaving`) — deleted

**What was built:**
- [x] `ticket_routes.py` — `STATUSES` list: removed `"invoice"` stage; auto-sync `_s2s` map now routes Odoo `sale/done` state directly to `confirmed_wip` (not via `sale_order` → `invoice` → `confirmed_wip`); auto-sync packing board creation triggered on `live_state in ("sale", "done")` (not gated on deposit payment state)
- [x] `order_routes.py` — `confirm_order`: Step 2 (invoice creation) removed entirely; packing board doc now includes `is_sample` flag; `inv_num` starts empty (populated later at `mark_complete`); audit log and response no longer include `invoice_id`/`invoice_name`
- [x] `order_routes.py` — `_passport_status`: removed `"invoice"` status entry; `sale_order` label updated to "Confirmed — Awaiting Packing"; `confirmed_wip` label updated to "In Fulfilment"
- [x] `packing_board_routes.py` — `_sync_sales_ticket`: added `"ready_for_collection"` outcome case
- [x] `packing_board_routes.py` — `complete_entry`: invoice created and posted in Odoo after delivery validation; `invoice_id` + `inv_num` stamped on packing board entry; `invoice_id` stamped on linked Sales ticket; `_sync_sales_ticket` now called with `"ready_for_collection"` (not `"complete"`) for full deliveries
- [x] `packing_board_routes.py` — `mark_collected`: invoice creation block removed; audit log no longer includes `invoice_id`; response simplified
- [x] `SalesTickets.js` — removed `"invoice"` from `STATUS_LABEL`, `STATUS_COLOR`, `FORWARD_STATUSES`, `PRE_CONFIRM`; `sale_order` label updated to "Confirmed"; removed all deposit state/functions/modal; "Queue for Packing" override button condition updated to `!detail.orders_ticket_ref` only (no longer requires `!payment_confirmed_at`)

**Definition of Done:**
- Sales staff confirms a quote → packing board entry created immediately, no invoice, ticket at `confirmed_wip`
- Orders Clerk marks packing → QA approves → RP approves → Orders Clerk marks complete → invoice created and posted in Odoo → `inv_num` appears on packing board card → ticket advances to `ready_for_collection`
- Finance sees the ticket at `ready_for_collection` with `invoice_id` set → can register balance payment
- Customer pays → Finance confirms → Orders Clerk marks collected → ticket exits as `complete`
- No "Register Deposit" button anywhere in the portal
- Sample tickets: no invoice at any stage; packing board completes without invoice creation

---

#### 8.40 — Reseller Order Notifications and Portal Progress Visibility — Complete 2026-07-21

**Goal:** Resellers receive proactive email notifications at every stage of their order so they do not need to call Bassani for status updates. The portal's order progress stepper must advance correctly for resellers as the order moves through the pipeline.

**Root cause fixed:** The packing board document created at `confirm_order` was missing the `reseller_id` field entirely — it stored `is_reseller: bool` and `reseller_name: str` but not `reseller_id`. This meant every reseller email lookup in `mark_packing` and `mark_complete` silently skipped, and the reseller's portal progress stepper was always stuck at "Confirmed" because `GET /api/packing/entry` returned 403 for resellers.

- [x] `order_routes.py` — `confirm_order`: `"reseller_id": _ticket_reseller_id or None` added to packing board document on creation (critical data fix)
- [x] `packing_board_routes.py` — `get_entry`: rewritten to allow resellers to access their own order's packing entry (ownership check via `reseller_id` field match); staff gate preserved for non-resellers
- [x] `email_service.py` — `send_order_packing_started(reseller_email, order_ref, customer_name, reseller_name, cc)`: fires when orders clerk marks packing; blue info box, "Track your order" CTA
- [x] `email_service.py` — `send_order_ready_for_collection_reseller(reseller_email, order_ref, customer_name, reseller_name, cc)`: fires at `mark_complete` for full-delivery reseller orders; green info box, "View order" CTA
- [x] `packing_board_routes.py` — `mark_packing`: accepts `BackgroundTasks`; fires `send_order_packing_started` to reseller via background task; routes through `get_email_routing()` for `order_cc`
- [x] `packing_board_routes.py` — `mark_complete`: full-delivery branch fires `send_order_ready_for_collection_reseller` via background task after warehouse supervisor notification

**Definition of Done:**
- Reseller receives "Packing Started" email when orders clerk marks their order as packing
- Reseller receives "Ready for Collection" email when their order passes QA+RP and is marked complete
- Reseller portal progress stepper advances to "Packing" and "Ready for Collection" correctly as the order moves through the board
- All reseller email lookups succeed (no silent skips due to missing reseller_id)

---

#### 8.42 — Reports Export and Period Selection — Complete 2026-07-22

**Goal:** Give operations managers and finance the ability to view reports for any SA financial year or any specific month within a FY, and export all analytics reports to Excel for offline use.

**Previous behaviour:** Reports always showed the current calendar month with no way to change the period, and no export capability.

**New behaviour:** A period selector bar sits above the report content area. Users can select any of the 3 most recent SA financial years (FY selector dropdown), then choose a specific month within that FY (month pills in Mar–Feb order) or "Full Year" to aggregate the entire FY. The Export Excel button (gated by `reports.export`) fetches all 6 reports for the current period in parallel and generates a multi-tab `.xlsx` file client-side using SheetJS.

- [x] `frontend/package.json` — added `"xlsx": "^0.18.5"` (SheetJS) dependency
- [x] `backend/routes/report_routes.py` — added `parse_date_str()` helper; added `from_date`/`to_date` Optional params to `monthly_turnover`, `best_sellers`, `best_customers`, `category_performance` (override month-based bounds when provided); added `fy_start_year` Optional param to `best_resellers` (selects which SA FY to display)
- [x] `frontend/src/views/Views.js` — `Reports` component rewritten: `fyStart`/`selectedMonth` state; `getPeriodParams()` computes `from_date`/`to_date` for selected period; `load()` passes params to backend; `exportToExcel()` dynamically imports `xlsx`, fetches all 6 reports in parallel via `Promise.allSettled`, builds 6-tab workbook, downloads as `Bassani Health Analytics {period}.xlsx`; Export button hidden if `!can("reports.export")`
- [x] `reports.export` permission already defined in `auth.py` (DEFAULT_ADMIN_PERMISSIONS, FULL_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS) and in `Users.js` (PERMISSION_GROUPS, DEFAULT_ADMIN_PERMS, ROLE_DEFAULT_PERMS) — no changes needed to permission infrastructure

- [x] All report endpoints warehouse-scoped: use `current_user.get("active_warehouse_id")` directly (not `resolve_warehouse_id` which falls back to global default and breaks "All warehouses"). `_wh_filter` spreads cleanly into Odoo domains; `null` = no filter (all warehouses).
- [x] `monthly_turnover` 6-month trend loop warehouse-scoped (had its own separate Odoo `sale.order` query that previously ignored `_wh_filter`)
- [x] `dead_stock` `recent_lines` query warehouse-scoped (stock quant query already used `odoo_context`; the `sale.order.line` recency check was missing the filter)
- [x] `WarehouseSwitcher` in `UI.js` fixed: `active_warehouse_id !== undefined` check distinguishes `null` ("All warehouses" explicitly selected) from `undefined` (never set) — `??` was collapsing both to the global default, causing the picker to show the wrong selection after choosing "All warehouses"

**Definition of Done:**
- FY selector shows current FY and 2 previous FYs
- Month pills display in SA FY order (Mar, Apr, May, Jun, Jul, Aug, Sep, Oct, Nov, Dec, Jan, Feb)
- Full Year pill aggregates the entire selected FY for all date-sensitive reports
- Best Resellers report always shows FY-scoped data regardless of month pill selection (uses `fy_start_year` param)
- Dead Stock report ignores the period selector (it reflects current stock position)
- Export Excel button produces a `.xlsx` with 6 tabs: Turnover, Best Sellers, Best Customers, Best Resellers, Dead Stock, Categories
- Export button only visible to users with `reports.export` permission
- Period change immediately reloads the active report
- All six reports filter to the user's selected warehouse; "All warehouses" correctly returns unfiltered data
- Warehouse picker displays "All warehouses" when `active_warehouse_id = null` (not the global default)

---

#### 8.43 — Customer Search Gap — Company Contacts with No Order History — Complete 2026-07-23

**Goal:** Staff must be able to search for and select any Odoo company contact when building a quote, not just contacts that have an existing confirmed sale order.

**Previous behaviour:** `/api/customers/search` filtered by `customer_rank > 0`, which Odoo only sets after a confirmed SO exists. A customer contact created directly in Odoo without any orders was invisible to the quote builder, reseller creation form, partner directory, and all other surfaces using this endpoint.

**New behaviour:** The domain is widened to `customer_rank > 0 OR is_company = True`. Any active Odoo company contact is now searchable regardless of order history. Individual contacts (vendor reps, employees) without prior order history are still excluded.

- [x] `backend/routes/customer_routes.py` — `search_all_customers` domain updated to `[("active", "=", True), "|", ("name", "ilike", q), ("email", "ilike", q), "|", ("customer_rank", ">", 0), ("is_company", "=", True)]`
- [x] Fix covers all 7 frontend surfaces that call `/api/customers/search`: quote builder (`SalesTickets.js`), reseller creation (`ResellerProfile.js`), partner directory (`Views.js`), onboarding inbox (`OnboardingInbox.js`), sales inbox (`SalesInbox.js`), scripts (`Scripts.js`)

**Definition of Done:**
- A company contact created in Odoo with no prior orders appears in the quote builder customer search
- Existing behaviour (only confirmed-order customers in the list view) is unchanged — the widened search applies to the `/search` endpoint only, not the main customer list

---

#### 8.44 — Business Type Restructure + Customer Page All-Accounts View — Complete 2026-07-23

**Goal:** Replace the single confusing "Business Type" dropdown on `/apply` with three separate, semantically correct fields. Additionally, restructure the Customers page to show all Odoo accounts (not just those with orders), move Partner Directory under the Customers nav section, and remove the manual "Add Customer" button in favour of the onboarding flow.

**Business rationale:** The old Business Type dropdown mixed legal entity types (Sole Proprietor), business functions (Pharmacy, Dispensary), and regulatory status (Section 22C Facility) — three independent dimensions. Separating them produces cleaner data for admin review and is closer to industry standard practice.

**Business Type restructure:**
- [x] `PublicRegister.js` — replaced `BUSINESS_TYPE_OPTIONS` with two constants: `BUSINESS_CATEGORIES` (Pharmacy, Dispensary, Wellness Centre, Medical Clinic, Health Retailer, Other) and `ENTITY_TYPES` (Private Company (Pty) Ltd, Close Corporation (CC), Sole Proprietor, Partnership, Other). Both show a required text input when "Other" selected. Added `section22c_licensed` boolean checkbox (Section 22C Licensed Facility). `isSoleProprietor` now derives from `entity_type === "Sole Proprietor"`. Step 0 validation updated. Summary sidebar updated.
- [x] `BLANK` form updated: removed `business_type` / `business_type_other`; added `business_category`, `business_category_other`, `entity_type`, `entity_type_other`, `section22c_licensed`
- [x] `backend/routes/public_routes.py` — `PublicRegistration` model: added five new fields; `business_type` kept as `Optional[str] = ""` for legacy document reads

**Customer page all-accounts view:**
- [x] `Customers.js` — `has_orders` filter param; "Has Orders" filter pill; all active Odoo companies shown by default; info note explains unfiltered view
- [x] `backend/routes/customer_routes.py` — `has_orders: bool = Query(False)` param on list endpoint; domain logic branches on `has_orders`, `mode`, and defaults
- [x] Partner Directory nav item moved from Admin section to Customers section in `UI.js`
- [x] `PartnerDirectory.js` — Profile link and row click-through enabled for all companies (not just `customer_rank > 0`)
- [x] "Add Customer" button removed from `Customers.js`; replaced with "Onboard Customer" button (BtnPrimary, green) that triggers the onboarding invitation modal

**Reseller modal fixes:**
- [x] `mode=partner` domain in `customer_routes.py` widened to include individual contacts (`parent_id != False`)
- [x] Reseller creation wizard auto-resolves selected individual contact to parent company (`_resolvedFrom` field)
- [x] Modal width increased to `max-w-2xl`; step 1 container gets `min-h-80` to prevent dropdown scroll

**Definition of Done:**
- `/apply` wizard step 0 shows Business Category, Legal Entity Type, and Section 22C toggle as three independent fields
- "Other" on either dropdown reveals a required text input
- Sole Proprietor entity type hides Company Reg field and changes company name label
- Staff can see all active Odoo accounts on the Customers page; "Has Orders" pill reverts to order-only view
- Partner Directory is discoverable from the Customers nav section; clicking any company row opens its profile

---

#### 8.45 — Notification Escalation & Digests — Complete 2026-07-28

**Goal:** Six workflow stalls that previously sat silently until someone happened to notice now escalate automatically by email: a submitted application with no signing documents generated after 4 hours, a customer's fully-signed documents waiting on countersignature, an order sitting ready for QA or RP inspection, and — at 17:00 SAST daily — a digest of every order still awaiting QA/RP sign-off and every order on backorder. Also redesigns the Email Notifications settings page (`EmailSettings.js`), which had grown to 6 hand-coded routing keys as one long flat page, into a sidebar-grouped layout ahead of these six new keys pushing it to 12.

**Root cause found during implementation:** none of the three request-triggered notifications previously sent any email at all — `mark_ready` (packing board → QA/RP ready), `submit_signed_doc` (public signing endpoint), and there was no stale-application check anywhere. Confirmed by reading each function directly before writing the trigger code.

- [x] `backend/routes/settings_routes.py` — `EmailRoutingConfig` gains 6 fields: `application_escalation_to`, `countersign_needed_to`, `qa_approval_to`, `rp_approval_to`, `qa_rp_daily_digest_to`, `backorder_daily_digest_to`
- [x] `backend/services/email_service.py` — 6 new send functions, same convention as every existing one (guard on empty recipient list, composed from the shared HTML primitives, deep link via `settings.portal_url`). QA/RP approval-needed emails are the first to link to Order Passport (`/orders/{id}/passport`) rather than the general orders list; the two daily digests link to `/orders-tickets` and `/orders/backorders` respectively since a digest lists multiple orders and doesn't deep-link per row
- [x] New `backend/services/scheduler.py` — the first "run at a specific wall-clock time" mechanism in the codebase (fixed UTC+2/SAST offset, no zoneinfo/tzdata dependency), plus a 30-minute interval loop for the escalation check, mirroring the existing Phase 22.1 payment-check loop shape. Started from one new `server.py` startup event. Application escalation stamps `escalation_notified_at` on the application doc so each stalled application is only escalated once, not every 30 minutes
- [x] `backend/routes/public_routes.py::submit_signed_doc` — fires `send_countersign_needed` once the signing session reaches `fully_signed` (both NDA and SOA submitted, not on each individual document)
- [x] `backend/routes/packing_board_routes.py::mark_ready` — fires both `send_qa_approval_needed` and `send_rp_approval_needed` (two independent recipient lists, since QA and RP are different people/roles even though they share one trigger point)
- [x] `frontend/src/views/EmailSettings.js` — rebuilt around a `ROUTING_KEYS` metadata array (12 entries) grouped by a `GROUPS` array (Onboarding & Applications / Orders & Fulfilment / Finance / Production & Vault) into a sidebar-nav + content layout; adding a future notification type is one array entry, not a new hand-written card. Grouping is a navigation convenience only — every key keeps its own independent recipient list, no group-level defaults. `RoutingSection`/`EmailTagInput` unchanged and reused. Widened to `max-w-5xl` (the sidebar needs more room than the standard admin `max-w-4xl`)

**Design decisions:**
- **Countersigning-needed fires once, on full completion, not per document** — matches "customer submits signed copies" (plural) and avoids two separate emails per application for what is really one countersigning task.
- **Escalation and both digests skip the query entirely if their recipient list is empty** — avoids stamping `escalation_notified_at` (or running a Mongo scan) for a notification nobody is configured to receive.
- **Sidebar grouping is presentation-only** — no group-level default recipients, no merge logic. Keeps the redesign additive and low-risk; a group-level override tier can be added later if it's ever actually needed.

### Definition of Done
- [x] An application with no signing documents generated after 4 hours triggers exactly one escalation email with a working deep link, not a repeat every 30 minutes
- [x] A customer submitting both signed onboarding documents triggers a countersigning-needed email to the configured list
- [x] Marking an order ready on the packing board sends two separate emails (QA and RP) to their respective configured lists, each linking to that order's Passport
- [x] At 17:00 SAST, a digest email lists every order still awaiting QA/RP sign-off (only if at least one exists and the list is configured)
- [x] At 17:00 SAST, a separate digest email lists every order on backorder (only if at least one exists and the list is configured)
- [x] Email Notifications settings page shows a sidebar of 4 groups; selecting a group filters the visible cards; Save still persists the full 12-key config regardless of which group is active

---

#### 8.47 — Reinstate the 50% Deposit Gate + Automatic Pro-Forma Invoice — Complete 2026-07-29

**Goal:** Reverse 8.39's removal of the deposit step. A 50% deposit must be registered against the sale order before it can reach the packing board ("order ticket") — for **every** order, no reseller/credit-terms exception. This is a deliberate, confirmed reversal of 8.39's "no deposit" business decision, not a bug fix. A pro-forma invoice must also go out to the customer automatically the moment staff confirm the order, so they know what to pay without anyone needing to open Odoo.

**Context:** 8.39 (2026-07-15) removed the deposit step so a confirmed order went straight to the packing board, with the (separate, full-value) delivery invoice deferred to `mark_complete`. That remains correct and is untouched by this phase. What's being reversed is only the "no deposit required before packing" part — the business now requires the deposit unconditionally.

- [x] `backend/routes/order_routes.py` — `PUT /{order_id}/confirm` split into a thin route wrapper and `_confirm_order_core()` (the full body), so the same confirm logic can be called from a non-HTTP context (see 8.46). `_confirm_order_core` still does `action_confirm` + the credit-limit hard gate + commission-record creation (all unchanged from before), but now advances the linked ticket to a new `awaiting_deposit` stage instead of calling straight into packing-board creation.
- [x] `backend/routes/order_routes.py` — new `_queue_packing_board(order_id, background_tasks)`: the packing-board-creation logic extracted verbatim from the old inline `confirm_order` body, plus the reseller "order confirmed"/partial emails and the internal backorder alert (all deferred to this point now, since the order only actually enters the fulfilment pipeline once packing is queued). Stock shortfall detection is re-run fresh here rather than reusing a confirm-time snapshot, since a deposit can take days to arrive and reservations can shift in that window. This function is the **only** thing in the codebase that creates a packing board entry — there is no other path.
- [x] `backend/routes/ticket_routes.py` — `STATUSES` gains `awaiting_deposit` (between `sale_order` and `confirmed_wip`). `register-deposit`, `payment-journals`, and the `TicketDepositRegister` model are restored (they were fully deleted by 8.39 — recovered from git history at the pre-removal revision) with one change: the endpoint now requires `ticket.status == "awaiting_deposit"` and, on success, calls `_queue_packing_board()` — this is the actual gate enforcement point. Also fixed a real pre-existing bug found while restoring this: `TicketDepositRegister`'s deletion had left its trailing `date`/`journal_id`/`note` fields orphaned onto the end of the unrelated `TicketOrderUpdate` model, silently making `date`/`journal_id` required (but unused) fields on every order-line-edit request.
- [x] `backend/routes/ticket_routes.py` — the Odoo-state auto-sync block (for orders confirmed directly in Odoo, bypassing the portal) now routes `sale`/`done` to `awaiting_deposit` too, and no longer auto-creates a packing board entry inline — that auto-creation path predates this phase and would otherwise have been a second, ungated route onto the packing board.
- [x] `backend/routes/ticket_routes.py` — **removed** `POST /{ticket_id}/admin-override-payment` entirely (found during this work): an existing "Queue for Packing" admin action that created a packing board entry with no payment check at all beyond the Odoo order being confirmed. Keeping it would have left a standing bypass of the exact requirement this phase implements, so it was deleted rather than left as a loophole. Its frontend trigger button and confirmation modal (`SalesTickets.js`) were removed with it.
- [x] `backend/services/email_service.py` — `send_deposit_due_proforma()`: fetches Odoo's native Pro-Forma Invoice report live via XML-RPC (`odoo.execute("ir.actions.report", "_render_qweb_pdf", "sale.report_saleorder_pro_forma_invoice", [order_id])`, unwrapping the `xmlrpc.client.Binary`-wrapped PDF bytes) and emails it to the customer with the 50% deposit amount and Bassani's banking details in the covering email, reseller CC'd for reseller-placed orders. Fired as a background task from `_confirm_order_core`, right after the ticket lands on `awaiting_deposit`. Non-fatal: wrapped in try/except so a missing/disabled Pro-Forma Invoice feature in Odoo's Sales settings (`group_proforma_sales`) degrades to a response warning, never blocks confirmation.
- [x] `frontend/src/views/SalesTickets.js` — `awaiting_deposit` added to `STATUS_LABEL`/`STATUS_COLOR`/`FORWARD_STATUSES` (staff) and `R_STATUS_LABEL`/`R_STATUS_COLOR` (reseller-facing). Register Deposit button/modal restored (originally a 3-invoice-type flow: fixed/percentage/delivered — the third, `delivered`, was removed 2026-08-11, it could never succeed at this pipeline stage; see the follow-up fixes below), now gated on `detail.status === "awaiting_deposit"` rather than the Odoo order state directly.

**Follow-up fixes (2026-08-04), found investigating "Register Deposit gives an Odoo error, no payment methods load":**
- [x] `ticket_routes.py::list_payment_journals` was silently catching its own Odoo failures with a bare `print()` and returning `200 {"journals": []}` instead of a real error — invisible to Sentry (which only captures via the `logging` module or explicit `sentry_sdk` calls, never `print()`) and invisible to the user (the frontend saw a "successful" empty response, not a failure). Now logs via `logger.error()` and raises a proper `502`.
- [x] `SalesTickets.js::openDepositModal` was catching that failure generically (`toast.error("Failed to load deposit details")`) and **still opening the modal anyway** with no payment methods in it. Now shows the real backend error and doesn't open a modal it just told the user is broken.
- [x] Fixing the above surfaced a second, deeper, pre-existing bug: `GET /payment-journals` and `GET /payment-terms` are literal single-segment paths that had been registered *after* `GET /{ticket_id}` in the router — FastAPI/Starlette matches routes in registration order, so both were permanently shadowed the whole time. Every call to either actually invoked `get_ticket(ticket_id="payment-journals")` / `"payment-terms"`, which correctly failed to parse that as a Mongo `ObjectId` and returned `400 "Invalid ticket ID"`. This had been silently masked by the generic frontend error handling above; fixing that handling made the pre-existing routing bug visible for the first time, looking like a brand-new error rather than what it was. Both routes moved above `GET /{ticket_id}`, matching the "Literal-path routes — MUST stay before /{order_id}" guard `order_routes.py` already uses for the same reason.
- [x] Multi-company journal filtering: `GET /payment-journals` accepts an optional `order_id`, scoping the returned journals to that order's own Odoo company (resolved the same way `register_deposit` already resolves `order_company_id` for its wizard calls) instead of listing every company's journals with just a `"Bank — CompanyName"` label to tell them apart. Picking a journal from the wrong company was a real, correct Odoo error (payments must be registered in the same company as the invoice) — this prevents the mistake at the source rather than requiring finance staff to already know each journal's company. `SalesTickets.js`'s deposit and balance-payment modals both now pass `order_id`. `register_deposit`/`register_balance_payment` also re-validate the submitted journal's company server-side before calling Odoo (the dropdown filter doesn't cover a stale-list or direct-API-call case), returning a clear portal message instead of a raw Odoo fault on mismatch.

**Further follow-up fixes (2026-08-04), found investigating "orders marked Complete never show a way to mark them Collected":**
- [x] `packing_board_routes.py::complete_entry` — the full delivery invoice (created + posted here, unchanged from 8.39) is now also automatically emailed to the customer via Odoo's own `mail.template`/`send_mail` mechanism, same as the existing manual "Send Invoice" button in `ticket_routes.py`. Non-fatal: a missing/misconfigured Odoo invoice template degrades to a warning, never blocks completion. `ticket.invoice_sent_at` is stamped on success, so the manual button correctly flips to "Resend Invoice" afterward. This slightly extends the 8.47 DoD line below ("`mark_complete` invoice-at-collection behaviour is unchanged") — the invoice creation/posting mechanics are unchanged, only the auto-send is new.
- [x] `OrdersTickets.js` — "Mark as Collected" button was gated on `detail.has_pending_invoice`, a flag only ever set on partial/backorder packing entries (see 8.23) — so it never appeared for a normal, full/single-delivery order, old or new alike. There was no other UI path to reach the collected state for these orders. Fixed by dropping that condition so the button shows for any `status: "complete"`, uncollected entry (backend `mark-collected` endpoint never required the flag).
- [x] `OrdersTickets.js` / `SalesTickets.js` — packing-board `status: "complete"` badge relabelled from "Complete" to "Ready for Collection" in both files. It was showing the same word as the ticket's separate terminal `exit_status: "complete"`, which read as a stuck/duplicate order when in fact `mark_complete` and "Mark as Collected" are two different pipeline stages.

**Follow-up fix (2026-08-11), found investigating "deposit registered successfully but the order never appeared on the packing board":**
- [x] `order_routes.py::_queue_packing_board` previously returned silently (no exception, no log a caller could act on) whenever Odoo hadn't yet generated the order's delivery record at the moment it ran — the single most common reason it can fail. Now raises instead, so every caller gets a real, descriptive error.
- [x] `ticket_routes.py::register_deposit` was catching that failure with a bare `logger.warning()` and still returning `{"success": true}` — the deposit (already committed in Odoo: invoice posted, payment reconciled) correctly stayed successful, but nothing else ever surfaced the fact that the packing board step failed. A ticket could sit at `awaiting_deposit` indefinitely, invisibly, with `register-deposit` itself refusing to run a second time (`payment_confirmed_at` already set) and no other code path ever retrying `_queue_packing_board`. Now persists `packing_board_queue_error`/`packing_board_queue_failed_at` on the ticket, audit-logs it (`ticket.packing_board_queue_failed`), and returns a `warning` in the response so the toast surfaces it at the moment it happens. Surfaced in the UI as a red banner on the Sales Ticket detail page and a "Not Queued" badge on the Sales Tickets list, so it's discoverable without already knowing to look.
- [x] `ticket_routes.py::update_ticket_stage` (the Sales Ticket's own Admin Override "Stage" action) previously did nothing but rewrite the `status` text field — moving a stuck ticket to `confirmed_wip` ("In Fulfilment") looked like a fix but created no packing board entry at all, since only `_queue_packing_board()` does that. It now calls `_queue_packing_board()` itself when moving to `confirmed_wip` with no existing `packing_board` entry for the order — making it a genuine, working recovery action for exactly this failure mode. Guarded on both sides: it only fires when no entry exists yet (never re-runs against an order already mid-pack, which would overwrite the packer's progress/item ticks/QA-RP sign-off), and it hard-blocks with `400` unless `ticket.payment_confirmed_at` is already set (or the ticket `is_sample`) — so it can only ever *retry* queueing after a deposit genuinely happened, never become a second way to skip the deposit gate.
- [x] **Real root cause found the same day, via the new loud error surfacing above:** the first admin-override retry attempt immediately hit a live Odoo fault — `ValueError: Invalid field 'reserved_availability' on 'stock.move'`. This field (used in `stock_check` and twice inside `_queue_packing_board` to compute shortfall/backorder splits) does not exist on the live Odoo instance's `stock.move` model — a schema mismatch, not an access-rights issue. This is almost certainly the true original cause of "deposit registered, packing board never created": the old swallow-and-log code was masking this exact fault the whole time, on every order.
- [x] **Resolved the same day, live-verified rather than guessed:** a read-only `fields_get`/`read` probe against production Odoo (explicit product-owner authorization, credentials never persisted to disk) revealed the live instance is actually **Odoo 19.0**, not the v17 documented everywhere — the third-party host had upgraded it with no corresponding doc update. Odoo 19 merged the old `reserved_availability` (pre-pick reserved) and `quantity_done` (post-pick done) into one field, `quantity`, confirmed live across every relevant `stock.move` state (`waiting`/`confirmed`/`partially_available`/`assigned`/`done`) and re-verified against the exact order from the original incident (S00764/picking 910) before shipping. All `order_routes.py` reads of either old field name now use `quantity`. This also fixed two more silently-broken features sharing the same root cause (both swallowed by an enclosing `try/except: pass`, so never even logged): the Order Passport's Deliveries section and its per-line MO/backorder breakdown had been returning empty for every order. **Shortfall/backorder detection is genuinely functional for the first time since 8.47 shipped** — it had always silently returned "no shortfall" before this fix, so treat any backorder behavior observed before 2026-08-11 as unverified. `CLAUDE.md`'s Tech Stack table and system description corrected from Odoo v17 to 19.0.
- [x] **Separate, unrelated bug found the same day via a Sentry review of other recent errors:** Tristan hit `Failed to post deposit invoice: <Fault 2: 'The entry INV/2026/00149 (id 1017) must be in draft.'>` on `register-deposit`. Root cause: the deposit modal's third option, "Regular Invoice" (`invoice_type: "delivered"` → Odoo's `advance_payment_method: "delivered"`, meaning "invoice per the order's own invoice policy"), can never succeed at this pipeline stage — every Bassani product is `invoice_policy = 'delivery'` and nothing has been delivered yet when a deposit is registered (that happens before the order even reaches the packing board), so Odoo correctly refused with "No items are available to invoice... products have not been delivered." That part is Odoo enforcing policy correctly, not a bug. The real bug: `register_deposit`'s `create_invoices` error handler assumed *any* exception was a harmless, already-known XML-RPC response-serialization quirk (the action dict `create_invoices` returns can contain `None` values the marshaller rejects even though the invoice really was created) and, to recover, grabbed the highest `invoice_id` already on the order and tried to post it — on a *real* failure like this one, that meant grabbing an unrelated, already-posted invoice and re-posting it, producing the confusing secondary "must be in draft" error instead of the real one. Fixed both: (1) removed the "Regular Invoice" option entirely from the deposit modal (`SalesTickets.js`) and backend validation (`invoice_type` now only `fixed`/`percentage`) — a customer paying the full order upfront should use "Fixed Amount" with the full order total; (2) `register_deposit` now snapshots the order's `invoice_ids` before calling `create_invoices` and only treats a raised exception as the harmless serialization quirk if a genuinely new invoice ID appears afterward — otherwise it raises Odoo's real error. This defends any future `create_invoices` failure for `fixed`/`percentage` too, not just the removed option. No data was corrupted (Odoo's `action_post` rejected the bad re-post outright), but the deposit registration failed outright each time this was tried, leaving the ticket at `awaiting_deposit` with nothing recorded.
- [x] **Full-codebase audit, requested by the product owner before the next deploy, given two independent Odoo-schema-drift incidents in one day:** every Odoo field name referenced anywhere in `backend/` was extracted programmatically (regex scan across all routes/services for `(model, fields=[...])` pairings, including positional field-list arguments) and checked against a live, read-only `fields_get` per model — 127 candidate model names extracted, 36 resolved to real Odoo models, every field on every one of them checked. The `create_invoices`-recovery bug pattern (assume any exception means success, then guess at a record) was also specifically searched for elsewhere in the codebase — the other three matches (`_confirm_order_core`'s `action_confirm` recovery, and `register_deposit`'s own payment-registration and balance-payment recovery blocks) were all confirmed safe on inspection, since each re-reads the state of the *exact same, already-known* record rather than guessing at "the highest ID" or similar — the deposit-invoice bug just fixed was the only unsafe instance. Two more real, live-hit field-drift bugs turned up from the same `reserved_availability`/`quantity_done` family and were fixed the same way (verified live before and after against real records, credentials never persisted to disk): `mrp.production.date_planned_start`/`date_planned_finished` → `date_start`/`date_finished` (`order_routes.py`, three call sites feeding the Order Passport's Manufacturing Orders display — silently empty via the same swallowed-`try/except` pattern), and `stock.move.line.reserved_uom_qty` → `quantity` (`packing_board_routes.py`'s `_validate_odoo_delivery`, the packer-reported-partial-quantity path at Mark Complete — unguarded, would have hard-failed exactly like the packing-board crash the first time any packer reported a short pack post-upgrade). Everything else the automated scan flagged (a large majority of the raw hits) was manually reviewed and confirmed to be noise — domain/state values like `"done"`/`"draft"` misidentified as field names, or fields correctly belonging to a different, proximate model call merged in by the window-based extraction — `sale.order`, `account.move`, `res.partner`, `product.product`/`product.template`, `sale.order.line`, and the remaining `stock.picking`/`stock.move`/`stock.move.line` fields all check out clean. **Explicitly out of scope / still unverified:** the Vault module's live-write paths (`services/vault_odoo.py` — `mrp.production.action_confirm`/`button_mark_done`, `stock.picking.action_confirm`/`action_assign`/`button_validate`) were not exercised, since `GACP_ODOO_WRITES` is still `off` (staged-only). Re-run this same field-audit approach before flipping that flag live. The other private-method call this audit flagged as a "fragility worth a closer look" — `stock.quant._update_available_quantity` in `return_routes.py`'s stock-restore path — turned out to be a real, live-hit bug the same day; see 2026-08-14 below for the fix.
- [x] **Whole-portal follow-up, same day** — product owner explicitly asked to extend the audit past the order/packing pipeline to the rest of the portal before deploying, specifically flagging customer onboarding as a "seems fine but verify" area since it was built the same era as everything else under the assumed-v17 documentation. Re-ran the extraction with per-field source-line tracking (not just per-model) so every flagged item could be traced back to its exact call site rather than triaged by pattern alone. `onboarding_routes.py`'s `approve_application` (creates the Odoo `res.partner` on approval, both business and individual registration types) was read in full: every field it writes — `name`, `company_type`, `customer_rank`, `comment`, `vat`, `email`, `phone`, `street`, `street2`, `city`, `zip`, `state_id`, `country_id`, plus the child-contact write's `parent_id`/`type`/`function` — is a long-stable core `res.partner` field untouched by the stock/mrp reservation rework that caused every bug found so far; none were flagged, confirming the product owner's instinct that onboarding was never at risk. Every remaining flagged group across the whole codebase (reseller/commission routes, invoicing, bank reconciliation, reporting, aged debtors, supplier/purchase-order linking, GTIN pool, forecast) was traced to its source line and confirmed to be either noise from the extraction merging two nearby-but-different Odoo calls into one bucket, or a Python dict-subscript artifact (e.g. `app["vat_number"]` inside a domain filter gets misread as a one-item field list — the mechanism behind nearly every single-item false positive attributed to portal-variable-shaped names like `contact_email`/`reseller_id`/`patient_name`). Also swept WRITE payloads specifically, since the original extraction only covered reads: the one live (non-Vault-staged) write path found outside the already-audited order/packing flow, `product_routes.py`'s manual stock-quantity adjustment (`stock.quant.inventory_quantity`, plus `action_apply_inventory`), was live-verified as a valid, writable field. **Net result: no further schema mismatches anywhere else in the portal.** The four fixes already shipped from this investigation (`reserved_availability`, `quantity_done`, `date_planned_start`/`date_planned_finished`, `reserved_uom_qty` — all in the stock/mrp reservation-rework family) are believed to be the complete set for the currently-live codebase, modulo the Vault module's still-staged write paths noted above.
- [x] **2026-08-14 — a genuinely different class of Odoo drift, found live via Tristan hitting `Could not send proforma invoice: <Fault 4: "Private methods ... cannot be called remotely">`.** Not a field rename this time: Odoo's XML-RPC dispatcher now hard-rejects calling any private (underscore-prefixed) method remotely — `send_deposit_due_proforma`'s PDF fetch called `ir.actions.report._render_qweb_pdf` directly, which had only ever worked because older Odoo XML-RPC didn't enforce the public/private boundary; there was never a public XML-RPC equivalent. Confirmed via a full codebase sweep this was one of exactly two such calls anywhere in `backend/` — the other, `stock.quant._update_available_quantity` in `return_routes.py`'s return-to-stock flow, was fixed the same way (see below). The fix, `odoo_client.py`'s new `fetch_report_pdf()`: authenticate a second, separate session via Odoo's own `/web/session/authenticate` (cookie-based, not XML-RPC), then `GET /report/pdf/<report>/<ids>` — the exact mechanism Odoo's own web client uses when a user clicks Print, not a workaround. Fixing this surfaced two more live-verified problems that had been masking each other: the report's own technical name had drifted (`sale.report_saleorder_pro_forma_invoice` → `sale.report_saleorder_pro_forma` on this Odoo version — confirmed by listing every `ir.actions.report` registered on `sale.order`), and a fresh web session defaults to the API user's single primary company, 403'ing on any record belonging to a different one on this multi-company instance ("doesn't have 'read' access ... multi-company issue") — fixed by capturing every company the service account can see at login and passing them back in via the `context=` query param on each report request. All three pieces (auth, report name, company scoping) were live-verified individually and then re-verified end-to-end by running the actual shipped function against a real order before considering this done.
- [x] **Same root cause, found and fixed in the same pass:** `return_routes.py`'s return-approval flow restored stock via the same now-blocked private method (`stock.quant._update_available_quantity`), wrapped in a bare `except: print(...)` that never surfaced the failure — a customer return could be marked "approved" with the response claiming stock was restored while nothing happened in Odoo at all. Replaced with the public pattern `product_routes.py`'s manual stock adjustment already used safely: read (or create) the `stock.quant`, write the new counted total to `inventory_quantity` (return quantity added to whatever's already on hand, not an absolute overwrite), then apply it via the public `action_apply_inventory`. **Separately noted, not fixed:** this same function's docstring says it "raises a credit note in Odoo," but it only ever generates a local `CN-RA-...` reference string in Mongo — no `account.move` credit note is actually created in Odoo. Pre-existing, unrelated to this fix; flagged for whoever picks up the Returns feature next, since it means "Credit note {cn_num} raised" in the approval response is currently not true.

**Key decisions:**
- **Universal gate, no exceptions** — confirmed explicitly with the product owner. The pre-8.39 design had let resellers on approved credit terms confirm straight through without a deposit; that exception is not carried forward.
- **Deposit amount stays operator-entered, not hardcoded to exactly 50%** — the modal pre-fills at order-total ÷ 2 but Finance can adjust (same as the pre-8.39 flow), since real-world deposits sometimes need a manual adjustment.
- **Shortfall/partial-order detection moved from confirm-time to deposit-registration-time** — it's recomputed fresh in `_queue_packing_board` rather than duplicated in `_confirm_order_core`, since packing-board creation is now the only place it's actually used.

### Definition of Done
- [x] Confirming an order (staff or reseller) advances the linked ticket to `awaiting_deposit`; no packing board entry exists yet
- [x] The customer (and reseller, if applicable, via CC) receives a pro-forma invoice email with the PDF attached immediately on confirm
- [x] Registering a deposit (any of the 3 invoice types) creates the packing board entry, stamps `orders_ticket_ref`, and advances the ticket to `confirmed_wip`
- [x] There is no way to reach the packing board without a registered deposit — `admin-override-payment` no longer exists anywhere in the codebase
- [x] An order confirmed directly in Odoo (bypassing the portal) still lands at `awaiting_deposit` via auto-sync, not straight onto the packing board
- [x] The existing `mark_complete` invoice-at-collection behaviour (8.39) is unchanged — this phase only touches what happens between confirm and packing, not the later collection invoice

---

#### 8.46 — Recurring Orders — Complete 2026-07-29

**Goal:** A direct-inquiry Sales ticket or a reseller-placed order can be flagged to recur on a schedule. Two days before each occurrence, the portal generates a draft replica order and emails the end customer directly to review and accept or decline — no portal login required. Accepting confirms the order automatically; Bassani's control point is the same 50% deposit registration every order requires (8.47), not a separate manual confirm click. A missed or declined occurrence is not an error: it's skipped and the schedule continues to the next cycle.

**Context:** Requested alongside 8.47's deposit-gate reinstatement, and deliberately sequenced to land on top of it — an accepted recurring order flows through exactly the same confirm → deposit → packing-board pipeline as any other order, recurring or not (Architecture Principle #4: one processing pipeline for all orders).

- [x] New `recurring_orders` MongoDB collection + `backend/routes/recurring_order_routes.py`: `POST /api/recurring-orders` (setup — snapshots line items/customer/reseller/warehouse off an existing ticket's linked order; cadence weekly/biweekly/monthly with optional `weekday`/`day_of_month`, optional `end_date`/`max_occurrences`), `GET` list + per-schedule detail (with occurrence history), `POST /{id}/pause|resume|cancel`. Gated by a new `orders.recurring_manage` permission (added to `auth.py` + `Users.js` in all 3 required places).
- [x] `_compute_first_occurrence()`/`_advance_occurrence()` — weekly/biweekly/monthly date math in plain `datetime` arithmetic, no new dependency. `day_of_month` is validated to 1-28 specifically so month-rollover never has to handle a day that doesn't exist in the target month.
- [x] `generate_recurring_notices()` (`recurring_order_routes.py`, scheduled daily at 08:00 SAST from `services/scheduler.py`): for every active schedule due in exactly 2 days, builds a draft `sale.order` replica in Odoo with **live re-fetched pricing** (never the frozen setup-time price), creates a linked Sales ticket (`source: "recurring"`, `status: "quote"`), stamps a single-use `accept_token` + `accept_token_expires_at` directly on the ticket doc (no separate token collection — one ticket, one token, one purpose), and emails the customer a review link. Advances the schedule's `next_run_date` to the following cycle immediately, so this can never re-fire for the same occurrence.
- [x] `backend/routes/public_routes.py` — `GET /api/public/recurring/{token}` (order summary for the review page) and `POST /api/public/recurring/{token}/accept|decline`, no auth. **Accept** calls `order_routes.py`'s `_confirm_order_core()` directly with a synthetic system actor (`{"id": None, "name": "System (Customer Acceptance)", "role": "system"}`) — the exact same confirm path a staff member's click would take, so the recurring order lands on `awaiting_deposit` and gets a proforma email exactly like any other confirm. A 402 credit-limit block from that call is caught specifically and turned into a `needs_manual_confirm: true` flag + staff notification instead of failing outright — the automated path can't silently override a credit block, so that's the one case a human still has to click Confirm. **Decline** cancels the draft Odoo order and closes the ticket (`exit_status: "not_interested"`).
- [x] `expire_unaccepted_occurrences()` (daily at 18:00 SAST): any recurring-generated ticket whose `scheduled_for` has passed with no accept/decline is closed (`exit_status: "cancelled"`, draft order cancelled in Odoo), staff notified. The schedule itself needs no changes here — `next_run_date` was already advanced at generation time — so "skip and continue" falls out with zero extra logic.
- [x] `backend/services/email_service.py` — 5 new templates: `send_deposit_due_proforma` (shared with 8.47), `send_recurring_order_upcoming` (customer, T-2-day notice), `send_recurring_order_accepted_internal`, `send_recurring_order_needs_confirm_internal`, `send_recurring_order_declined_internal`, `send_recurring_order_skipped_internal` (all staff-facing).
- [x] `backend/routes/settings_routes.py` + `frontend/src/views/EmailSettings.js` — 4 new routing keys (`recurring_order_accepted_to`/`recurring_order_needs_confirm_to`/`recurring_order_declined_to`/`recurring_order_skipped_to`), one `ROUTING_KEYS` array entry each under the existing "Orders & Fulfilment" group. `needs_confirm` was split into its own key the same day (see 8.48) rather than sharing `accepted`'s list, once it was clear a credit-limit block needing a human is a different audience/urgency than a plain acceptance FYI.
- [x] `frontend/src/components/RecurringOrderSetupModal.js` — shared "Make Recurring" setup modal (cadence + weekday/day-of-month + optional end conditions). Opened from `frontend/src/views/SalesTickets.js`'s ticket detail sidebar once the ticket has a linked order (`detail.order_id` set, no existing `recurring_order_id`).
- [x] `frontend/src/views/RecurringOrderReview.js` — public page at `/recurring/:token`. No auth, no dependency on `UI.js`/`AuthContext`, matching `SigningPage.js`/`PublicRegister.js`'s existing public-page convention. Shows the draft order's line items and total; Accept and Decline actions (Decline has an extra inline confirm step, since it's the harder-to-reverse action).
- [x] `frontend/src/views/RecurringOrders.js` — `/orders/recurring` ("Recurring Orders" nav item under Orders, `orders.recurring_manage`): schedule list with status counts, cadence, next run date; expandable per-row occurrence history (accepted/declined/skipped/needs-manual-confirm, linking out to the Order Passport); pause/resume/cancel via the standard confirmation-modal pattern.

**Key decisions (all confirmed with the product owner during scoping):**
- **Accepting auto-confirms the order — no separate manual staff "Confirm" step.** Originally scoped as staff-must-click-Confirm, revised once 8.47's deposit gate was in place: since a confirmed order still can't reach the packing board without a manually-registered deposit, that step is already Bassani's control point for every order, recurring or not. Adding a second manual gate on top would be redundant.
- **Universal gate applies to recurring orders too** — no special-casing. An accepted recurring order goes through `_confirm_order_core()`/`register-deposit` exactly like a manually-confirmed one.
- **Cadence supports weekly/biweekly/monthly with an optional end date or occurrence cap** — broader than a literal "every Monday" reading of the original request, scoped up front rather than needing a follow-up phase.
- **Review/accept link goes to the end customer directly, never routed through the reseller** — even for reseller-placed recurring orders. The customer is who's actually paying the deposit and receiving the goods.
- **No response is not a failure state** — "skip and continue": the occurrence is dropped, staff notified, and the schedule keeps running unattended. A pause requires an explicit staff or customer-decline action, never happens automatically from silence.

### Definition of Done
- [x] Marking a ticket recurring computes a correct first `next_run_date` for weekly/biweekly/monthly cadences
- [x] 2 days before the scheduled date, a draft Odoo order + linked ticket are created automatically and the customer receives a working review link
- [x] Accepting auto-confirms the order in Odoo (no staff click), lands the ticket on `awaiting_deposit`, and fires the proforma email — the only remaining manual step is Finance registering the deposit
- [x] A credit-limit block on accept does not silently override — the ticket is flagged `needs_manual_confirm` and staff are notified
- [x] Declining cancels the draft order and closes the ticket; the schedule is untouched
- [x] No response by the scheduled date closes the ticket as skipped, cancels the draft order, and the schedule's next cycle proceeds normally with no manual re-enable needed
- [x] Staff can pause, resume, and cancel a schedule from `/orders/recurring`, and see full occurrence history per schedule

---

#### 8.48 — Send Test Email on Notification Settings — Complete 2026-07-29

**Goal:** Let an admin verify what any configured notification actually looks like — enter an email address, click Send Test on any notification card in Settings > Email Notifications, and receive the real template populated with fabricated dummy data. No waiting for the real trigger event (an application stalling for 4 hours, an order reaching QA, etc.) just to see the copy and layout.

- [x] `backend/routes/settings_routes.py` — `POST /email-routing/test` (`settings.manage`-gated, same permission as configuring routing): looks up the posted `key` in `TEST_EMAIL_SENDERS`, a dict of one lambda per `ROUTING_KEYS` entry that calls the real `email_service.py` send function with realistic fabricated data (fake company/order/reference names, never real records) at the submitted address. `order_cc` isn't a standalone template — it's a `cc=` add-on to reseller order emails — so its test previews via `send_order_confirmed` with the test address as the primary recipient instead.
- [x] `frontend/src/views/EmailSettings.js` — one shared test-email input above the notification cards; `RoutingSection` gains a `headerAction` slot; each card renders a `SendTestButton` that POSTs `{key, to}` and reports success/failure via toast.

**Follow-up fix, same day — recurring order coverage gap:** a pass to confirm every notification type was represented turned up two gaps specific to 8.46's recurring orders: (1) `send_recurring_order_needs_confirm_internal` (fires when a customer accepts but auto-confirm is blocked by a credit limit) was silently piggy-backing on the `recurring_order_accepted_to` recipient list — a plain "customer said yes" FYI and "a human needs to intervene right now" are different audiences/urgency, so it was split into its own `recurring_order_needs_confirm_to` key (`public_routes.py`'s accept handler updated to route to it); (2) `send_recurring_order_upcoming` (the customer-facing T-2-day notice) had no card at all, since it isn't staff-routed — added as a `previewOnly: true` `ROUTING_KEYS` entry (`recurring_order_upcoming`) with a Send Test button but no recipient list, since it always goes to whichever customer is on the recurring schedule, not a configurable address. `ROUTING_KEYS` is now 17 entries: 16 configurable (one `EmailRoutingConfig` field each) plus this one preview-only entry, excluded from `BLANK_CONFIG` and the saved config payload.

**Design decisions:**
- **One shared test-email field, not one per card** — matches the real workflow (an admin tests several notification types in a row against their own inbox), and avoids 17 duplicate input fields.
- **Real templates, fabricated data — never real records.** The test-send path never reads from the database; every value is a hardcoded placeholder, so there's no risk of a test click leaking a real customer's name or order details.
- **A missing dispatch entry 400s clearly** rather than silently no-opping — surfaces immediately if a future notification type is added to `ROUTING_KEYS` without its `TEST_EMAIL_SENDERS` counterpart. This is exactly the check that caught the two recurring-order gaps above.
- **Preview-only entries get a Send Test button but no recipient list** — `previewOnly: true` skips `EmailTagInput` and `BLANK_CONFIG` inclusion, for the (currently one, possibly more later) notification that's never staff-routed but still worth being able to preview.

### Definition of Done
- [x] Every one of the 17 configured notification types (16 configurable + 1 preview-only) has a working Send Test button that delivers a realistic preview
- [x] The test email address field is shared across all cards — no need to re-enter it per notification
- [x] A failed send (e.g. invalid address, Resend misconfiguration) reports a clear error via toast rather than failing silently
- [x] A customer accepting a recurring order under a credit-limit block notifies `recurring_order_needs_confirm_to`, not the general `recurring_order_accepted_to` list
- [x] The customer-facing "upcoming recurring order" notice is previewable from Settings despite having no configurable recipient list

---

#### 8.49 — Ready for Collection: Notify the Actual Customer, Not Just a Reseller — Complete 2026-08-04

**Goal:** When an order is marked ready for collection, the actual customer account should be notified, not just a reseller who happened to place the order on their behalf. Before this, `send_order_ready_for_collection_reseller` (8.40) only fired when the packing board entry had a `reseller_id` — a staff-placed order with no reseller attached notified nobody outside the warehouse. The notification must reach the customer's main company email plus every other contact Odoo has on file for that account, and must fire regardless of which of the two paths advances the ticket to `ready_for_collection` (the normal Mark Complete button, or the `tickets.manage` admin override).

- [x] `email_service.py` — new `send_order_ready_for_collection_customer(customer_email, order_ref, customer_name, cc=None)`. Same green "ready for collection" visual language as the existing internal/reseller templates; no portal-login CTA button (the end customer has no portal account, unlike a reseller).
- [x] `packing_board_routes.py` — new `_resolve_customer_notification_recipients(odoo, partner_id)`: resolves the account's company email (via `commercial_partner_id`, defensive against being passed a contact rather than the company) plus every other active child `res.partner` with `type` `contact`/`invoice`, deduped case-insensitively. Best-effort — returns `(None, [])` on any Odoo error rather than raising, so a lookup failure never blocks the packing/status update that triggered it.
- [x] `packing_board_routes.py::_sync_sales_ticket` — the single chokepoint both trigger paths already route through — gained an optional `background_tasks` param; its `ready_for_collection` branch now resolves `customer_company_id`/`customer_id` already present on the linked ticket (no extra Odoo `sale.order` read needed) and queues the new customer email as a background task. Hooking the shared chokepoint rather than duplicating the call in both `complete_entry` and `override_status` means one implementation covers both paths automatically.
- [x] `complete_entry` (Mark Complete button) and `override_status` (admin override, `tickets.manage`) — both now pass `background_tasks` through to `_sync_sales_ticket`; `override_status` didn't previously accept `background_tasks` at all, so this required adding it to the route signature.
- [x] Also fixed in passing: `_sync_sales_ticket`'s own error handler used `print()` instead of `logger.warning()` — the same invisible-to-Sentry anti-pattern fixed elsewhere this week — upgraded while already deep in this function.
- [x] `settings_routes.py`/`EmailSettings.js` — new `order_ready_customer` entry, `previewOnly: true` (same shape as 8.46/8.48's `recurring_order_upcoming`): always resolved from Odoo per order, not a configurable staff list, so no `EmailRoutingConfig` field — just a `TEST_EMAIL_SENDERS` lambda and a Send Test card. `ROUTING_KEYS` is now 18 entries: 16 configurable, 2 preview-only.

**Design decisions:**
- **Independent of the existing reseller notification**, not a replacement — a reseller-placed order now sends both `send_order_ready_for_collection_reseller` (to the reseller, who has portal access to track it) and `send_order_ready_for_collection_customer` (to the actual customer account, who does not). A staff-placed order with no reseller now sends the customer email where previously it sent nothing beyond the warehouse.
- **Main company email as `to`, every other contact as `cc`** — matches the existing "reseller CC'd" convention used elsewhere in this codebase (e.g. the 8.47 pro-forma invoice) rather than sending N separate individual emails.
- **`type` filter (`contact`/`invoice`) on child contacts** — deliberately excludes `delivery`/`other` address-type child partners, since those represent physical locations, not people to notify. This filter didn't exist anywhere else in the codebase before now (every prior "list a company's contacts" read took every type) — it's a new policy invented for this specific use case, not copied from precedent.

### Definition of Done
- [x] Marking an order ready for collection via the Mark Complete button sends the customer notification email to the account's main email + all other contacts, in addition to the existing supervisor/reseller emails
- [x] The same notification fires when an admin reaches `ready_for_collection` via the override-status escalation path, not just the normal flow
- [x] A staff-placed order with no reseller attached now notifies the actual customer, closing the previous silent gap
- [x] A failed Odoo contact lookup degrades gracefully (no email sent, packing/status update still succeeds) rather than blocking the request
- [x] The new notification type is previewable from Settings > Email Notifications via Send Test

---

#### 8.50 — Individual (Natural-Person) Self-Service Registration — Complete 2026-08-04

**Goal:** Let a private individual (a named patient with a Section 21 outcome letter, not a business) register via the public `/apply` self-service wizard. Scoped to the self-service flow only — the separate reseller-initiated onboarding wizard (`CustomerOnboarding.js` / `POST /api/onboarding/`, `submit_application`) remains business-only and was not touched.

**Context:** Every existing onboarding surface assumed a company: a CIPC certificate, a registered name, a trading name, an entity type. An individual has none of that — instead they need to prove identity (ID document) and prescribing authority (Section 21 outcome letter). The Customer Information Form, NDA, and Store Onboarding Agreement are still signed exactly the same way for both registration types (confirmed with the product owner) — only the non-signed supporting documents and the underlying Odoo record shape change.

- [x] `PublicRegister.js` — new `registration_type` field (`"business"` default | `"individual"`), chosen via a two-card toggle at the top of Step 0. Individual applicants skip all company fields (category, entity type, Section 22C, company/trading name, registration number, VAT) and see a short explanatory note instead; Step 0's label becomes "Your Details". Step 1 (Primary Contact) is unchanged except "Position / Title" is not asked of an individual (they're signing for themselves, not on behalf of an employer). Step 4's non-signed document upload was generalised from a single hardcoded CIPC uploader into a small `UPLOAD_DOCS` config (`business`: CIPC certificate; `individual`: ID document + Section 21 outcome letter) rendered as a loop, so both flows share the same upload/remove UI.
- [x] `public_routes.py` — `REQUIRED_DOC_TYPES` split into `BUSINESS_DOC_TYPES`/`INDIVIDUAL_DOC_TYPES` (+ `_required_doc_types_for()`); `PublicRegistration.company_name` relaxed from required to optional; the submission-time document-completeness gate now checks the right set for the submitted `registration_type`. Confirmation emails (Sentry-free, non-blocking) fall back to `contact_name` wherever `company_name` would otherwise be blank.
- [x] `onboarding_routes.py` (shared by both onboarding flows at the approval stage) — `INDIVIDUAL_DOC_TYPES` + `ALL_DOC_TYPES` (union, used by the generic admin upload/replace/delete endpoints so `id_document`/`section21_outcome` are accepted there too); `_required_doc_types(app)` (final approval gate: CIF+CIPC+NDA+SOA for business, CIF+ID+Section21+NDA+SOA for individual) and `_pre_signing_doc_types(app)` (same minus NDA/SOA, gates the "Generate Documents" step — previously hardcoded to `("customer_information_form", "cipc_certificate")`, which would have permanently blocked every individual application at that step).
- [x] `approve_application` — duplicate-check branch: VAT-match and trading-name-match (both business-only signals) are skipped for individuals; a new check blocks approval if another **approved** individual application already has the same `signatory_id_number` (checked against the portal's own `customer_onboarding` records — there is no dedicated ID-number field on Odoo `res.partner` to match against). Odoo record creation branches: an individual gets a single standalone `res.partner` (`company_type: "person"`, `name` = the applicant's own name) with no separate child contact — unlike a business, the applicant IS the contact, so there's no company/signatory split to model. `_display_name` and every downstream reference (audit log, inbox-thread archival stamp, approval email) fall back to `contact_name` when `company_name` is blank.
- [x] `CustomerApplicationDetail.js` — blue "Individual" badge next to the status pill; the "Business Details" card is replaced with a "Registration Details" card (type + SA ID number) for individual applications; the Primary Contact card gained an SA ID Number row (previously collected but never displayed, for either type); sidebar "Application Details" shows "Type: Individual" instead of Category/Entity.
- [x] `CustomerApplications.js` (admin list) — "Business Name" column renamed "Name" with a `contact_name` fallback; the "Type" column (previously showing the unused legacy `business_type` field) now shows a Business/Individual badge.
- [x] **Diagnosis / Indication field (2026-08-04, same day):** an optional free-text field, individual registrations only, added to Step 3 (Additional Information) with an inline note that it's confidential and used internally. Discussed against the broader SAHPRA/Section 21 compliance checklist (prescribing doctor, authorised product/quantity, approval expiry) — those remain deliberately out of scope for now pending RP/compliance sign-off; diagnosis/indication was the one field the product owner wanted captured immediately as useful data. On approval, `approve_application` persists it to `customer_metadata` (keyed by `odoo_partner_id`, upserted) so it survives past the one-off application document and stays associated with the ongoing customer record — not just displayed on the (eventually-archived) application. Shown on `CustomerApplicationDetail.js`'s Registration Details card pre-approval.

**Design decisions:**
- **Scoped to self-service `/apply` only.** The reseller-initiated onboarding wizard was not extended to individuals in this pass — nothing in the request referenced it, and extending it would mean also relaxing its own (separate, business-only) `submit_application`/`upload_document` gates, which stay untouched.
- **The uploaded ID document and Section 21 outcome letter are onboarding-time KYC/eligibility documents only** — reviewed once before Generate Documents, then archived to `customer_documents` on approval, exactly like a CIPC certificate. They are not wired into the existing per-order Section 21 authorisation gap (`s21script`, flagged separately under Phase 8 hardening) — that remains a distinct, still-open item.
- **Individual duplicate-check matches on SA ID number, not company identity** — unlike the business "same person, multiple legitimate branches" case (8.44/2026-08-04), one natural person registering twice is presumptively a duplicate, not two separate accounts, so it hard-blocks rather than surfacing as an informational note.

### Definition of Done
- [x] An individual can complete `/apply` end-to-end: toggle to "An individual," fill contact/address, sign the Customer Information Form, upload an ID document and Section 21 outcome letter, and submit
- [x] Admin review shows an "Individual" badge and the correct document set; Generate Documents and Approve both work for an individual application without requiring a CIPC certificate
- [x] Approving an individual application creates a single standalone Odoo `res.partner` (person, not company) with no orphaned child contact
- [x] A second individual application with the same SA ID number as an already-approved one is blocked at approval
- [x] The reseller-initiated onboarding wizard's business-only behaviour is unchanged

---

#### 8.53 — Use Existing Odoo Invoice Instead of a Redundant Deposit — Complete 2026-08-11

**Goal:** When a ticket's linked sale order already has a posted, paid (or partially paid) customer invoice in Odoo — most commonly a historical order that was confirmed and invoiced directly in Odoo before ever being tracked in the portal, then attached to a fresh direct-enquiry ticket via **Link Existing Order** — Register Deposit should not force the creation of a second, redundant down-payment invoice against it.

**Context:** Raised while reviewing the Link Existing Order flow: linking never creates a packing board entry regardless of the order's invoice status (`link_existing_order` only maps Odoo state → ticket stage, at most `awaiting_deposit`), so the order still has to go through Register Deposit like any other — but `register_deposit` had no awareness that money might already be sitting against this order in Odoo. Two designs were considered — purely informational display vs. a deliberate action that consumes the existing invoice — the product owner chose the latter.

- [x] `backend/routes/ticket_routes.py` — `GET /{ticket_id}/existing-invoices` (read-only): returns the linked order's Odoo invoices filtered to `move_type="out_invoice"`, `state="posted"`, `payment_state` in `paid`/`partial`/`in_payment` — a draft or wholly-unpaid invoice confirms nothing and is excluded.
- [x] `backend/routes/ticket_routes.py` — `POST /{ticket_id}/use-existing-invoice` (`UseExistingInvoiceBody{invoice_id}`, `tickets.finance_confirm`): validates the same preconditions as `register_deposit` (ticket `awaiting_deposit`, not already deposited) plus that the given invoice genuinely belongs to the order and is posted with real payment against it, then stamps `payment_confirmed_by`/`payment_confirmed_at`/`invoice_id` and calls `_queue_packing_board()` — same universal 50%-deposit gate as a normal deposit (8.47), still one explicit staff click, just skipping the redundant new-invoice creation. Shares `register_deposit`'s non-blocking `packing_board_queue_error` surfacing (2026-08-11) rather than a bare `logger.warning()`. Audit-logged under its own `ticket.use_existing_invoice` action, kept distinct from `ticket.register_deposit` in the trail.
- [x] `frontend/src/views/SalesTickets.js` — Register Deposit modal fetches `existing-invoices` alongside its usual journal/order data on open; when any exist, a blue card lists them (name, amount, payment status, outstanding balance) each with a **Use This Invoice** button, above the normal Fixed/Percentage deposit form (which stays fully available regardless — this is an alternative, not a replacement).

**Key decision:** deliberately **not** automatic. Even when a qualifying invoice exists, Finance must still explicitly click to use it — consistent with the "no exceptions, no silent bypass" spirit of the 8.47 deposit gate; this only removes the need to create a *second* invoice when suitable payment is already provably on record in Odoo, it does not weaken what counts as proof of payment.

### Definition of Done
- [x] Linking an existing, already-invoiced-and-paid order into a new ticket and opening Register Deposit shows the existing invoice(s) with correct amount/status
- [x] Clicking "Use This Invoice" links it as the ticket's deposit invoice, queues the packing board, and never creates a new Odoo invoice
- [x] The normal Fixed Amount / Percentage deposit flow is unaffected and still available on the same modal
- [x] The action is audit-logged distinctly from a normal deposit registration

---

#### 8.54 — View Odoo's Own PDFs In-Portal (Invoice, Quote, Delivery Slip) — Complete 2026-08-14

**Goal:** Let staff view the actual document Odoo itself would print — its own template, not a portal-built approximation — for the three documents staff most often need: the customer invoice, the sale order/quotation, and a delivery's picking slip. Product owner's framing: "I want them to view as much Odoo specific stuff as they can" — Architecture Principle #2 (Odoo invisible to staff) means the portal should be able to show the authoritative version of these documents without anyone opening Odoo directly, not just the portal's own re-rendering of the underlying data.

**Context:** Built as a direct follow-on to the same-day proforma-invoice fix (`odoo_client.py`'s `fetch_report_pdf()`, added to work around Odoo's XML-RPC now rejecting private-method calls). That function is general-purpose — it takes any report's technical name — so extending it to power an in-portal viewer for other Odoo reports was a small, natural next step rather than a new mechanism. Report technical names for all three were confirmed live against `ir.actions.report` before use (per the running lesson this whole investigation surfaced: never assume a report or field name without checking it against the live instance).

- [x] `backend/routes/invoice_routes.py` — `GET /{invoice_id}/pdf`, streams `account.report_invoice_with_payments` (Odoo's default invoice print action, includes payment status). Distinct from this file's existing `GET /{invoice_id}`, which powers the portal's own `InvoiceView` in-browser rendering (`Invoices.js`) — that one was and remains completely unaffected, it never touched Odoo's report engine.
- [x] `backend/routes/order_routes.py` — `GET /{order_id}/quote-pdf` (`sale.report_saleorder`, Odoo's "PDF Quote" action) and `GET /{order_id}/deliveries/{picking_id}/pdf` (`stock.report_deliveryslip`). The delivery-slip route reads the picking's `sale_id` first and 404s if it doesn't match the given `order_id`, so a picking can't be fetched by guessing an ID outside its own order's context. Both accept the same integer-ID-or-SO-name resolution (`_order_int_id`) the existing `/deliveries` endpoint already uses.
- [x] `frontend/src/components/UI.js` — new shared `OdooPdfViewerModal({url, title, onClose})`: full-screen modal, fetches the given URL as a blob via the app's authenticated `api` client (required — a plain link/`window.open` can't carry the JWT bearer header these endpoints need), renders it in an `<iframe>`, with loading/error states. Mirrors `DocumentTemplates.js`'s pre-existing local `PdfViewerModal` almost exactly; promoted to a shared component once a second and third document type needed the identical shape.
- [x] `frontend/src/views/Invoices.js` — "View Original (Odoo)" button in `InvoiceView`'s header, alongside the existing "Print / Save PDF" (which still prints the portal's own rendering — both stay available, this is additive).
- [x] `frontend/src/views/OrderPassport.js` — "View Quote (Odoo)" in the page toolbar; a "Slip" link on each delivery row in the Deliveries card.
- [x] **Extended the same day** to the two screens staff actually spend their working day in, rather than requiring a click-through to Order Passport first: `frontend/src/views/SalesTickets.js` (ticket detail header — "View" next to "Odoo SO #" and "Invoice #", staff-only/`!isReseller`, matching the existing scoping of the invoice line itself) and `frontend/src/views/OrdersTickets.js` (packing board detail's document header — "View" next to the order ref, Invoice, and DN). `OrdersTickets.js`'s Invoice link only appears once `detail.invoice_id` exists — that field is stamped onto the packing board entry at `mark_complete` (`packing_board_routes.py`), so a not-yet-completed entry correctly shows the invoice number with no link rather than a broken one; the DN link needs both `detail.order_id` and `detail.odoo_picking_id`, both already present on every packing board entry (`_queue_packing_board`'s doc shape) — no backend changes needed for either surface, purely additive frontend wiring onto data already being returned.

**Verification, given how much of this session was spent on exactly this class of bug:** every report name was checked against a live `ir.actions.report` search (not assumed), and every endpoint's underlying `fetch_report_pdf()` call was independently smoke-tested against a real record (a real posted invoice, a real done picking, a real confirmed order) before any frontend wiring — all three returned valid PDF bytes. Before wiring `OrdersTickets.js`, confirmed `GET /api/packing/entry/{order_id}` returns the full packing board document (`NO_ID` only strips `_id`) rather than assuming `odoo_picking_id`/`invoice_id` would be present in the API response.

### Definition of Done
- [x] `Invoices.js`'s invoice viewer can open Odoo's own Invoice PDF (with payment status) alongside the existing portal-rendered view
- [x] `OrderPassport.js` can open Odoo's own Quotation PDF for the order
- [x] `OrderPassport.js` can open Odoo's own Delivery Slip PDF for any individual delivery on the order, and cannot be pointed at a delivery belonging to a different order
- [x] `SalesTickets.js`'s ticket detail can open the real Odoo SO/quote PDF and (staff-only) the real Odoo invoice PDF
- [x] `OrdersTickets.js`'s packing board detail can open the real Odoo SO/quote, invoice (post-completion), and delivery slip PDFs
- [x] All report names verified live against `ir.actions.report`, not assumed from documentation or memory
- [x] Shared `OdooPdfViewerModal` handles a failed fetch (e.g. Odoo report error) with a visible message, not a blank/broken iframe

---

#### 8.55 — Merge Approve + Send Welcome Pack, Fix Attachment Preview — Complete 2026-08-18

**Goal:** Once NDA + SOA are both countersigned, approving the application (creating the Odoo customer) and sending the welcome pack email were two separate manual actions/clicks. Product owner asked for a single **Approve & Send Welcome Pack** action that does both. Separately, the welcome pack compose modal's attachment preview was misleading — it only ever showed the two countersigned Bassani-sig docs plus one fake "Bassani Health Welcome Pack.pdf" placeholder line, never the CIF/CIPC/ID+S21 docs or the real per-slot welcome-pack filenames the backend actually attaches.

**Context:** The two actions were already gated on the identical precondition (all Bassani-sig docs countersigned), so there was no real reason for them to be separate clicks in the normal flow. Inbox-sourced (`awaiting_docs`) applications never go through the portal welcome-pack flow at all (their docs arrive by email) and keep their own plain approve action, unaffected by this change.

- [x] `backend/routes/onboarding_routes.py` — `approve_application` and `send_welcome_pack` route bodies extracted into `_approve_application_impl()` / `_send_welcome_pack_impl()`, called by thin `@router.put`/`@router.post` wrappers so the two original standalone endpoints behave identically to before.
- [x] `backend/routes/onboarding_routes.py` — new `PUT /{app_id}/approve-and-send-welcome-pack` (`ApproveAndSendWelcomePackBody{company_name?, message, subject?}`): runs approval first (the harder-to-reverse step — creates the Odoo customer + `customer_ownership` record), then the welcome pack send. If the send fails after approval succeeded, the exception is caught and returned as `{success, odoo_partner_id, welcome_pack_sent: false, welcome_pack_error}` rather than raising — the approval is **not** rolled back (same non-blocking-failure convention as `_queue_packing_board`'s `packing_board_queue_error`).
- [x] `backend/routes/onboarding_routes.py` — new shared `_welcome_pack_doc_attachments(app)` helper (every onboarding doc with an `r2_key`, with resolved label) used by both the real send and the new preview endpoint, so they can never diverge.
- [x] `backend/routes/onboarding_routes.py` — new `GET /{app_id}/welcome-pack-preview`: returns the exact documents list (label, filename, countersigned status) plus the real active welcome-pack bundle filenames (`get_active_bundle_files("welcome_pack")`) — the true attachment list, not a client-side guess.
- [x] `frontend/src/views/CustomerApplicationDetail.js` — `WelcomePackModal` takes a `mode` prop (`"approve"` merged action / `"send"` retry-only), fetches `GET /welcome-pack-preview` on open and renders the real documents + bundle-file list (with a loading state and an empty-state warning if nothing resolves), instead of the old `BASSANI_SIG_TYPES`-filtered guess. In `"approve"` mode it also shows the reseller-linkage/commission blurb that used to live in a separate "Confirm Approval" modal — that modal is now only used for the plain-approve paths (inbox-sourced apps, and legacy in-flight apps where the pack was already sent under the old separate-steps order).
- [x] `frontend/src/views/CustomerApplicationDetail.js` — `ActionsCard`'s actionable section now shows a single **Approve & Send Welcome Pack** button once signing is complete and countersigned (replacing the old separate "Approve & Create Customer" + "Send Welcome Pack" buttons), calling the merged endpoint via the compose modal. The "Decision" card (shown once approved) gained a **Send Welcome Pack** retry button for the one failure case: approved, still countersigned, but `welcome_pack_sent_at` unset.
- [x] `frontend/src/views/CustomerApplicationDetail.js` — the Decision card also gained a **View Customer Profile** button (`navigate('/customers/{odoo_partner_id}')`, same route/param `PartnerDirectory.js`/`Views.js`'s Customers table already link through) for any approved application, so staff can jump straight to the customer 360 profile the approval created instead of navigating to Customers and searching by name. Both approve paths (`approve()` for the plain/legacy flow, `sendWelcomePack()`'s `"approve"` mode for the merged flow) now store `odoo_partner_id` from the approval response onto local `app` state so the button appears immediately without a page refresh.
- [x] `frontend/src/components/UI.js` — new shared `OnboardCustomerButton` (self-contained button + modal: copy the `/apply` link, or send an invite email via `POST /api/onboarding/invite`; owns its own open/email/sending state, no props needed). Extracted from `Customers()` in `Views.js`, which previously carried its own copy of the modal, invite handler, and state — now just renders `<OnboardCustomerButton />`. Added to the same top-right `TopBar` spot on `CustomerApplications.js` and `OnboardingInbox.js` (alongside its existing search/refresh actions) so staff can start onboarding a customer from any of the three onboarding-adjacent screens without navigating to Customers first.

**Key decision:** approval runs before the send, not after, because it's the harder-to-reverse and more load-bearing of the two (it creates the live Odoo customer record) — a failed welcome pack send is recoverable via the retry button, whereas rolling back a just-created Odoo customer to retry in a different order is not something the portal attempts.

### Definition of Done
- [x] With NDA + SOA countersigned, a single **Approve & Send Welcome Pack** button creates the Odoo customer and sends the welcome pack email in one action
- [x] If the welcome pack send fails after approval succeeds, the application is left approved (not rolled back) with a visible retry action
- [x] Inbox-sourced (`awaiting_docs`) applications keep the plain **Approve & Create Customer** action, unaffected by the merge
- [x] The compose-modal attachment preview shows every document and welcome-pack file the backend will actually attach — CIF, supporting ID/CIPC doc(s), countersigned NDA/SOA, and the real slot filenames — sourced from the same backend call the real send uses
- [x] The two original standalone endpoints (`/approve`, `/send-welcome-pack`) are unchanged in behaviour, now implemented via shared `_impl` functions
- [x] An approved application's Decision card shows a **View Customer Profile** button linking directly to `/customers/{odoo_partner_id}`
- [x] The **Onboard Customer** button (copy link / email invite) appears in the same top-right position on Customers, Customer Applications, and Onboarding Inbox — one shared component, not three separate implementations

---

#### 8.41 — Reseller Quote Visibility in Staff Queue — Complete 2026-07-21

**Goal:** Reseller-created draft quotes are visible to Bassani sales staff from the moment they are submitted, so staff can assign them, track them, and confirm them on the reseller's behalf if the reseller is unavailable.

**Previous behaviour:** The staff sales queue excluded reseller tickets with status `open` or `quote`. Staff could not see a reseller order until the reseller confirmed it (advancing it to `sale_order`).

**New behaviour:** Reseller tickets at all statuses (including `quote`) appear in the staff queue. The existing source filter on the ticket list (Internal / Reseller chips) lets staff filter these out if they want to focus on direct tickets only.

- [x] `ticket_routes.py` — `list_tickets`: for `sales` role, removed `"quote"` from `$nin` exclusion in the reseller ticket sub-query; updated comment to reflect new intent
- [x] `order_routes.py` — `confirm_order` / `_require_confirm_access`: staff with `orders.confirm` permission could already confirm any order (reseller ownership check only fires for the `reseller` role); no code change required

**Definition of Done:**
- A reseller submits a quote → it immediately appears in the staff sales ticket queue
- Staff can assign the ticket to a team member for tracking at the quote stage
- Staff can confirm the order on the reseller's behalf if needed
- Reseller can still confirm their own quote through the normal portal flow

---

#### 8.31 — Batch/Lot Numbers on Print Documents — Complete 2026-07-11

**Goal:** Every A4 document the portal generates (order view, packing slip, invoice) shows the batch/lot number(s) that were physically dispatched with that order. Required for medicinal cannabis compliance traceability — the dispensed batch must be identifiable from the paper document.

- [x] `GET /api/orders/{id}` — builds `lot_map: {product_id: [lot_name, ...]}` from `stock.move.line` records on all done pickings for the sale order; non-fatal (degrades to empty if not yet packed); overlaid onto order response
- [x] `OrderView.js` — batch names rendered in monospace below each product description in the line items table
- [x] Packing slip (print HTML in `OrdersTickets.js`) — lot map fetched from order API before printing; batch names included per line item
- [x] `GET /api/invoices/{id}` — builds same `lot_map` structure via `invoice_origin → sale.order → stock.picking (done) → stock.move.line`; non-fatal; returned alongside invoice data
- [x] `InvoiceView` in `Invoices.js` — batch names rendered in same monospace style below each line description; only shown when picking has been validated (lots assigned)

**Traceability chain:** Picking → `stock.move.line.lot_id` → `stock.lot.name` (Bassani batch ID scheme) → rendered on both order and invoice documents, identical to what is physically labelled on the dispatched product.

---

#### 8.30 — Backorders Admin View — Complete 2026-07-11

**Goal:** Admin and warehouse supervisor can see all outstanding backorder demand across every customer order in one place, with links to the relevant sales ticket and any linked manufacturing orders.

- [x] `GET /api/orders/backorders` — searches `stock.picking` where `backorder_id != False` and `state in (confirmed, assigned, waiting)` and `picking_type_code = outgoing`; reads `stock.move` per picking for per-product outstanding qty; cross-references `tickets` MongoDB collection for linked portal ticket ref; non-fatal MRP lookup via `mrp.production.origin` match for any linked manufacturing orders; gated by `orders.view`
- [x] `Backorders.js` — new view at `/orders/backorders`; stats row (total pickings, products affected, Confirmed count, Ready count); By Order / By Product toggle; state filter pills; expandable multi-product rows in By Order view; By Product view aggregates total outstanding qty and order count per product with MO status; click-through link to linked sales ticket; `adminOnly: true` route
- [x] "Backorders" nav item added under Orders section in sidebar (`Clock` icon, `orders.view` + `adminOnly`); `Clock` added to lucide-react import in `UI.js`
- [x] Route `/orders/backorders` registered in `App.js` with `adminOnly`
- [x] SO reference in By Order view is a clickable link to `/orders/{id}/passport` — direct navigation from backorder to full order lifecycle (8.34)
- [x] SO name filter pre-populated when navigated from Order Passport outstanding line rows (8.33)

**Phase 13 integration point:** Once Phase 13 production scheduling is built, this view will gain write actions — allocating stock from a completed manufacturing batch to the waiting backorder picking, which auto-advances the backorder on the packing board.

---

#### 8.29 — Invoice Page Enhancements — Complete 2026-07-10

**Goal:** Finance can fully manage the invoice lifecycle directly from the Invoices page, not just from within a Sales Ticket. Pre-portal invoices (created directly in Odoo) are also accessible for ticket creation.

- [x] `sale_order_id` returned per invoice in `GET /api/invoices/` — batch-resolved from `invoice_origin` via `sale.order` lookup; enables "Create Ticket" action
- [x] `linked_ticket_id` returned per invoice — batch-resolved from `tickets` MongoDB collection against `order_id`; enables "View Ticket" link and gates "Create Ticket" action
- [x] `POST /api/invoices/{id}/send` — standalone send endpoint; sends via Odoo mail template; validates `state=posted`; no linked ticket required; gated by `tickets.finance_confirm`; audit-logged as `invoice.sent`
- [x] `GET /api/invoices/{id}/pdf` and `GET /api/invoices/credit-note-journals` — permission updated from `require_admin` to `require_permission("tickets.finance_confirm")` so finance users can access without admin role
- [x] `Invoices.js` — blue read-only banner removed; "Sale Order" reference shown per invoice (via `invoice_origin`); Sale Order column (origin ref) displayed in the table
- [x] Actions column per invoice row: "View" (portal print view), "PDF" link (Odoo PDF, new tab), "Send" (fires standalone send endpoint), "Draft" (reset to draft, admin-gated confirm modal), "CN" (credit note modal), "Ticket" (create ticket from linked sale order, shown when `sale_order_id` set and no `linked_ticket_id`)
- [x] Reset to draft confirm modal — `Modal` + `BtnDanger` pattern; backend guards that payment_state is not_paid before allowing it
- [x] Credit note modal — reason (required), date, journal selector populated from `/api/invoices/credit-note-journals`; uses existing `POST /api/invoices/{id}/credit-note` endpoint
- [x] "Create Ticket" flow — calls `POST /api/tickets/from-order` with `order_id: inv.sale_order_id`; navigates to ticket on success; only shown when `inv.sale_order_id` is set and `inv.linked_ticket_id` is null
- [x] Existing "Ticket" link in status column navigates to `/tickets/sales` with `openTicketId` state when `linked_ticket_id` is present
- [x] "Credit Notes" filter added to filter pills (sets `move_type=out_refund` in API params); CN badge shown in invoice number column for `out_refund` records

### Notes
> **Sub-deploy 18 (2026-07-09):** 8.23 Reseller quote flow. Resellers now create draft quotes through the existing cart (Orders view) rather than being forwarded to the internal quote builder. `create_order` in `order_routes.py`: reseller orders land at `status: "quote"` (not `sale_order`) in the tickets collection, so pre-confirm reseller drafts are hidden from the staff Sales Tickets queue — staff only see them once confirmed. Commission record, `total_sales` increment, and order-placed email are all deferred from `create_order` to `confirm_order` (commission lookup is idempotent; no duplicate risk). New `_require_confirm_access` dependency in `order_routes.py` grants resellers access to `PUT /api/orders/{id}/confirm` for their own orders. New `_reseller_id_for_user`, `_assert_reseller_owns_ticket`, `_require_ticket_viewer`, `_require_ticket_driver` helpers in `ticket_routes.py` — every ticket endpoint gated so resellers can only read/drive tickets where `reseller_id` matches their own. Packing board reseller-name lookup at confirm time uses `_ticket_reseller_id` from the ticket (not the commission record, which is created at the same moment). Frontend: `SalesTickets.js` — `isReseller` flag gates "New Direct Inquiry" button, source filter, and "Assign to me" hidden for resellers; "My Quotes" added to `RESELLER_NAV` in `UI.js`; "Edit Quote" action now routes resellers to `/orders` with `editQuote` location state instead of opening the internal quote builder. `Views.js` (Orders component): detects `location.state?.editQuote` on mount, pre-populates cart, locks customer picker, routes submit to `PUT /api/tickets/{id}/update-order`, shows "Save Quote"/"Saving…" button labels, Cancel navigates back to `/tickets/sales`. `ResellerProfile.js` (admin view): pipeline section shows the reseller's tickets filtered by `reseller_id`.

> **Sub-deploy 17 (2026-07-07):** 8.22 Customer Document Upload Request. New `upload_request_routes.py` router with 4 endpoints: admin create (POST, `customers.manage`, generates `secrets.token_urlsafe(32)` token, stores in `doc_upload_requests` collection, fires `send_doc_upload_request` email); admin status fetch (GET `/customer/{partner_id}`, returns most recent request); public validate (GET `/{token}`, marks `first_accessed_at` on first visit, returns valid/expired/not_found); public upload (POST `/{token}/files`, multipart, stores in R2, mirrors to `customer_documents` with `source: "customer_upload"`, fires `send_doc_upload_notification` to onboarding routing emails). Two new email templates in `email_service.py`: `send_doc_upload_request` (amber info box, CTA button, reply-inviting footer) and `send_doc_upload_notification` (file list table, sent to onboarding inbox). `PublicDocUpload.js` — standalone branded public page (no auth); drag-drop multi-file upload; states: loading / valid / expired / not_found / done. `CustomerProfile.js`: `UploadRequestBanner` component (colour-coded amber/blue/green/gray by status); "Request docs" button in Documents section header; recipient modal (company email + contact emails as radio options); `customer_upload` source badge + provenance text added. Route `/upload-docs/:token` added as public in `App.js`.

> **Sub-deploy 16 (2026-07-07):** 8.21 Sentry noise fixes (4 issues). (1) Graph 404 in inbox — `httpx.HTTPStatusError` caught before catch-all in `_ingest_message`; 404 → `logger.info`, other HTTP errors → `logger.error`. (2) IMAP EOF — `isinstance(exc, imaplib.IMAP4.abort)` added to IMAP poll loop in `server.py`; `abort` → `logger.warning`. (3) Mailbox test Graph 401 — `_httpx.HTTPStatusError` caught before generic `Exception` in `_test_mailbox`; 401 → `HTTPException(422)` with credentials message, other HTTP errors → 502. (4) Mailbox test IMAP AUTHENTICATIONFAILED — `"AUTHENTICATIONFAILED"` string matched in exception message; raises `HTTPException(422)` with credentials message instead of 502.

> **Sub-deploy 15 (2026-07-07):** 8.16–8.20 Customer profile + partner management + ticket improvements. 8.16: `contacts` fetch in `GET /api/customers/{id}/profile` — removed `type=contact` filter that excluded non-standard Odoo contact types; `CustomerProfile.js` Contacts section added between Addresses and Documents. 8.17: `PATCH /api/customers/{partner_id}/link-company` endpoint — writes `parent_id + type=contact` to Odoo, audit-logged. 8.18: `partner_routes.py` new router — `GET /counts`, `GET /` with filter=all|company|linked|unlinked, `PATCH /{partner_id}/link-company`; `PartnerDirectory.js` new page with filter pills (amber unlinked badge), DataTable, link-company typeahead modal; nav item added to `ADMIN_NAV`; route `/partners` in `App.js`. 8.19: Ticket customer context — `create_ticket` stores `customer_email/company_id/company_name`; `get_ticket` lazy-backfills from Odoo if fields missing; `SalesTickets.js` sidebar shows email (mailto link), company navigate button, and link-to-company modal for standalone contacts. 8.20: `PUT /api/tickets/{id}/reassign` — `require_admin`, updates assignee, stage_history entry, audit log, push + email notification; `SalesTickets.js` — assignee row replaced with editable inline dropdown with staff search.

> **Sub-deploy 14 (2026-07-06):** 8.15 Link Existing Order to Ticket. New `POST /api/tickets/{ticket_id}/link-order` endpoint in `ticket_routes.py` — validates the ticket has no existing order, fetches the Odoo `sale.order`, rejects cancelled orders and duplicate-linked tickets, maps Odoo state to portal stage (draft/sent → quote, sale/done → sale_order), advances stage only forward, writes timeline entry, audit log, and WebSocket broadcast. `SalesTickets.js` — `Search`, `Loader2`, `Link2` added to lucide imports; link-order state block (`linkOrderOpen/Query/Results/Searching/Selected/Submitting`); debounced search `useEffect`; `openLinkOrderModal()` and `linkOrder()` handlers; "Link Existing Order" button added to both the empty-state panel (alongside "Build Quote") and the Actions sidebar (above "Not Interested"); modal with typeahead order search showing ref, customer name, state label, and amount, plus a confirmation card before submit.

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

**11.C.5 — Reseller wizard draft/resume flow (2026-07-05):** *Complete*

Closes the UX gap where resellers were blocked at Step 0 until all five signed documents were uploaded, even when they had already emailed the docs to the customer and needed to wait for the reply.

- [x] `CustomerOnboarding.js` — Step 0 now has two paths: (A) email path: reseller enters business name (required) + customer email, clicks Send Docs — wizard unlocks Steps 1-4 immediately; (B) upload path: reseller uploads all 5 signed docs before continuing. Business name is validated client- and server-side before email send. On send, business name is passed as `customer_name` and pre-filled into Step 1's company name field
- [x] `CustomerOnboarding.js` — resume mode: `?resume=APP-XXX` URL param loads existing `awaiting_docs` application into the wizard, populates all form fields, starts at Step 1; draft indicator banner shown with app reference
- [x] `CustomerOnboarding.js` — auto-save on step navigation (email/draft path): each call to `next()` calls `PUT /api/onboarding/:draftAppId` before advancing; final step calls `POST /api/onboarding/:draftAppId/submit` instead of the fresh-submit endpoint
- [x] `onboarding_routes.py` — `PUT /api/onboarding/:app_id` now accepts `awaiting_docs` status in addition to `pending`; new `POST /api/onboarding/:app_id/submit` endpoint transitions `awaiting_docs → pending`, validates all required fields and all 5 docs present, fires admin notification email
- [x] `onboarding_inbox_routes.py` — after `save-documents-to-application` saves docs, if `application.reseller_id` is set, fetches reseller user email and fires `send_onboarding_docs_received_reseller` as a background task
- [x] `email_service.py` — new `send_onboarding_docs_received_reseller` template: warm notification to reseller with direct `/onboard?resume=:app_id` link
- [x] `ResellerApplications.js` — `awaiting_docs` added as "Draft" status with blue badge; "Drafts" filter chip added; clicking a draft row navigates to `/onboard?resume=:id` with "Continue" CTA in the row

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

**11.D — Sales Inbox ingest unification + sync reliability hardening (2026-08-04):** *Complete*

An architecture review (prompted by reports of some emails not syncing correctly) found that `inbox_routes.py` (Sales Inbox) had never actually been migrated onto the shared `inbox_service.py` pipeline built in 11.C — it still ran its own pre-11.C copy of the ingest functions, carrying the exact thread-matching bug 11.4.3 already fixed in the shared service: matching conversation ancestors only among prior messages with `is_reply: False`. Since Microsoft Graph delivers webhook notifications with no ordering guarantee, a reply could be processed before its own root, find no match under that filter, and become a second, orphaned thread for one real conversation — the direct explanation for the reported symptom.

- [x] `inbox_routes.py` — deleted the local `_ingest_message`/`_ingest_imap_message` functions; webhook, poll, and all call sites now route through `inbox_service.ingest_graph_message`/`ingest_imap_message`, identical to `onboarding_inbox_routes.py`/`orders_inbox_routes.py`
- [x] `inbox_routes.py::reply_to_email`/`download_attachment`/`poll_inbox` — now thread `mailbox_address` through explicitly to every Graph client call instead of relying on `graph_client`'s global default (which reflects whichever mailbox's config was loaded last across all three mailboxes' shared startup sequence); also fixed the outgoing-reply doc's `mailbox_address`/`from_email` previously falling back to the customer's own address when Graph was the active backend
- [x] `server.py::_run_inbox_startup` — added a 30-minute periodic Graph reconciliation sweep (`_graph_reconcile_loop`), the Graph-side counterpart to the IMAP mailboxes' existing permanent 60s poll loop. Previously a Graph mailbox only self-healed once, at server startup — if the subscription silently lapsed afterward, inbound mail stopped until someone noticed and hit `/poll` manually or the server redeployed
- [x] `graph_subscription.py::ensure_subscription` — Sentry alerting on subscription failure: a renewal failure that falls back to a fresh `create_subscription()` now emits a tagged Sentry warning (`graph_subscription_stage=renew`); if creation also fails (the terminal case — this mailbox now has no live subscription until the next renewal cycle or a restart), it's reported via `sentry_sdk.capture_exception` (`graph_subscription_stage=create`), both tagged with `mailbox`

**Follow-up the same day:** deploying the above surfaced a live incident — the Sales mailbox's Graph subscription had silently lapsed around 2026-07-24 (before Sentry alerting existed to catch it), and the only recovery mechanism at that point was the one-shot startup catch-up, fixed to a 72-hour lookback. Nothing between 2026-07-24 and the 2026-08-04 deploy was ever pushed or caught up — a fixed window, however the sweep above was scheduled, would have hit the exact same ceiling on any outage longer than 72h.

- [x] `inbox_service.py` — new `last_ingested_at(collection, mailbox_address)` and `graph_catchup_message_ids(collection, mailbox_address)`. The catch-up lower bound is now anchored to the most recently *stored* message for that mailbox (minus a 1h safety overlap) instead of a fixed 72h constant, so an outage of any length is fully recoverable on the next sweep rather than capped at a fixed ceiling; falls back to 72h only when a mailbox has never ingested anything yet (first connect). Paginates via `skip` up to 10 pages (500 messages) per sweep — `list_messages()` already accepted a `skip` param that no caller had ever used, so this closes a real gap: a catch-up window wider than one page (50 messages) previously silently truncated at the 50 newest regardless of what the filter nominally covered
- [x] `server.py`'s startup catch-up and `_graph_reconcile_loop`, plus the `/poll` handler in all three of `inbox_routes.py`/`onboarding_inbox_routes.py`/`orders_inbox_routes.py` (the manual "Sync" button), now all call `inbox_service.graph_catchup_message_ids()` instead of independently computing a fixed 72h filter — one shared adaptive implementation, not four fixed ones
- [ ] **Known limitation, not yet closed:** the adaptive window anchors to the *newest* stored message, so it cannot retroactively discover a hole that sits behind messages already ingested — once the 2026-08-04 deploy's (then-fixed-72h) startup catch-up had already pulled in same-day mail, the anchor became "today," not "2026-07-24." The 2026-07-24 → 2026-08-04 gap itself still needs a one-off wider fetch to recover; the adaptive window only guarantees no *future* gap of this kind goes unrecovered.

**Second follow-up the same day:** Railway logs showed `onboarding_inbox_webhook_invalid_state received=<real value> expected=None` — a live Graph subscription still sending webhooks for the onboarding mailbox, which is configured on IMAP, not Graph. Root cause: `graph_subscription.py` had `delete_subscription()` listed in the original 11.1 spec but it was never actually implemented, and `settings_routes.py` never called anything equivalent when a mailbox's provider was switched or its config cleared — so an old Graph subscription just kept running on Microsoft's side for its full ~3-day lifetime, sending notifications nobody could match against a `client_state` that no longer existed locally.

- [x] `graph_subscription.py` — implemented `delete_subscription(mailbox)` for real: deletes the subscription on Microsoft's side (treats a 404 there as already-gone, not an error) and clears the local `settings` record regardless of whether the remote call succeeded.
- [x] `settings_routes.py::_save_mailbox_doc` — calls `delete_subscription(mailbox)` when the existing config's provider was `"graph"` and the new one isn't, **before** `imap_client.load_config_from_db()` swaps the runtime Graph credentials over (the delete call still needs the outgoing credentials to authenticate). New shared `_clear_mailbox_doc()` helper applies the same check to all three `DELETE` (clear) endpoints, which previously just blind-deleted the config doc with no cleanup at all.
- [x] All three `graph_webhook` handlers (`inbox_routes.py`/`onboarding_inbox_routes.py`/`orders_inbox_routes.py`) now check `get_graph_mailbox_address(mailbox)` first and return a plain `202` with an info-level log if the mailbox isn't currently Graph-configured, instead of proceeding to a `client_state` check that produces a confusing warning either way. Defensive second layer in case a subscription ever survives a failed delete.

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

**11.4.4 — Retry the webhook-triggered message fetch on 404 (2026-08-14)** — *Complete*
- [x] Found via a live Sentry error (`inbox_graph_fetch_failed mailbox=sales ... 404 Not Found`) on a message that genuinely existed — the `created` webhook had fired before Microsoft Graph's own backend had finished indexing the message for `GET /messages/{id}`, a documented Graph race condition. `ingest_graph_message()`'s fetch previously caught *any* exception and just logged + dropped the message permanently, with no retry at all.
- [x] `inbox_service.py`: new `_fetch_message_with_404_retry()` — retries specifically on a 404 response (2s/5s/10s backoff, ~4 attempts total), re-raises immediately for anything else (auth failure, 5xx, a message genuinely deleted before ingest). Confirmed safe to spend a few seconds here: `ingest_graph_message()` only ever runs inside a FastAPI `background_tasks` call, dispatched *after* the webhook handler has already sent Microsoft's required fast `202` ack — verified by reading the actual request flow in `inbox_routes.py`, not assumed.
- [x] Applies to all three mailboxes (Sales, Onboarding, Orders) automatically, since all three share this one ingest function. Without this fix, a message lost to the race was only ever rescued by the 30-minute periodic reconciliation sweep (11.4's catch-up window) — this closes the gap for the common case instead of relying on that as the only safety net.

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

**Estimate:** 2–3 weeks  
**Status:** 🟡 In Progress — 12.0 complete; 12.4 GS1 backend + Products-page label printing built; 12.5 GTIN Pool management complete; 12.6 Global Barcode Search + Order Barcode complete; serial tracking + packing-board integration pending  
**Completed:** Sub-deploy 1 (12.0 Backend foundation) — 2026-06-29; Sub-deploy 2 (12.4 GS1 backend + Products page modal) — 2026-07-09; Sub-deploy 3 (12.5 GTIN Pool) — 2026-07-11; Sub-deploy 4 (12.6 Global search + order barcode) — 2026-07-11

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

### 12.4 — GS1 Pharmaceutical Label Generation (Finished Goods to Pharmacy)

**Goal:** Every finished goods order dispatched to a pharmacy carries two GS1-compliant labels: a GS1 DataMatrix on each individual unit (bottle/blister) encoding GTIN + batch + expiry + per-unit serial number, and a GS1-128 on the outer shipping carton encoding GTIN + batch + expiry + quantity. Labels are sent directly from the portal to a networked Zebra ZT411 label printer via ZPL over TCP. All issued serial numbers are permanently recorded for traceability.

**Business dependency (must be completed before any build work starts):**
- Bassani registers with GS1 South Africa ([gs1za.org](https://www.gs1za.org)) and receives their Company Prefix — estimated R2,500–R4,000/year
- Tristan assigns a unique GTIN (Global Trade Item Number) to every finished goods product variant in Odoo's `barcode` field — this is the GS1 product identifier. One GTIN per sellable variant (e.g. "Tincture 10mg" and "Tincture 20mg" are two GTINs)
- Hardware: Zebra ZT411 300 DPI, thermal transfer, Ethernet model — printer must be on the same network as the portal server or accessible via static IP

**What a GS1 DataMatrix unit label encodes:**
```
(01) GTIN-13/14      ← from Odoo product.barcode field
(10) Batch/Lot no.   ← from Odoo stock.lot name (Phase 13 batch ID once built)
(17) Expiry date     ← from Odoo stock.lot expiration_date (YYMMDD format)
(21) Serial number   ← portal-generated, auto-incremented per unit within this GTIN+batch
```

**What a GS1-128 carton label encodes:**
```
(01) GTIN-13/14
(10) Batch/Lot no.
(17) Expiry date
(37) Quantity in carton
```

---

**Task list:**

**Python dependencies (backend):**
- [x] No server-side barcode rendering library needed — DataMatrix is rendered client-side in the browser via `bwip-js`; ZPL DataMatrix uses Zebra's onboard `^BX` command (no Python image library required)
- [ ] Add `reportlab` to `requirements.txt` — PDF fallback label generation (deferred to PDF fallback phase)

**Serial number tracking — new MongoDB collection `gs1_serials`:**
- [ ] Schema per document: `{ gtin, lot_name, warehouse_id, next_serial, serials: [{ serial_no, order_id, packing_entry_id, product_id, issued_at }] }`
- [ ] `next_serial` auto-increments per GTIN+lot combination — atomic MongoDB `findOneAndUpdate` with `$inc` to prevent duplicate serial assignment under concurrent prints
- [ ] Serial numbers are zero-padded to 8 digits (e.g. `00000042`) — compliant with GS1 serialization recommendations
- [ ] Serial records are permanent — never deleted even if an order is cancelled (cancelled serials are flagged `voided: true`, not removed)

**GS1 string builder (Python utility — `backend/services/gs1.py`) — BUILT 2026-07-09:**
- [x] `build_gs1_text(gtin, lot, expiry_yymmdd, serial)` — assembles GS1 AI bracket-notation string for bwip-js and ZPL; fixed-length AIs first, variable-length last (no unnecessary FNC1 separators)
- [x] `build_zpl_unit_label(product_name, gtin, lot, expiry_display, expiry_yymmdd, serial, width_mm, height_mm, dpi)` — complete ZPL for unit label: Bassani Health wordmark, product name, lot + expiry + serial (human-readable), GS1 DataMatrix (`^BX` with `>8` prefix)
- [x] `build_zpl_carton_label(product_name, gtin, lot, expiry_display, expiry_yymmdd, qty, width_mm, height_mm, dpi)` — complete ZPL for carton label: header fields + GS1-128 linear barcode (`^BC` with `>;` prefix)
- [x] `send_zpl(printer_ip, zpl, port=9100, timeout=10)` — TCP socket to `printer_ip:9100`, sends ZPL bytes; raises `ConnectionError` on failure (surfaces as `503` from API)
- [x] `validate_gtin(gtin)` — checks digit count (8/12/13/14), all-numeric, GS1 check digit algorithm; `gtin14(gtin)` zero-pads to 14 chars for AI string

**GTIN validation:**
- [x] Before generating any label, validate that `product.barcode` is a valid GTIN-13 or GTIN-14: all digits, correct length, passes GS1 check digit algorithm
- [x] Products that fail GTIN validation get a `422` from the print endpoint; the GS1 button in the Products table is only shown for products whose barcode passes `/^\d{13,14}$/`

**Backend endpoints (`backend/routes/label_routes.py` — BUILT 2026-07-09):**
- [x] `POST /api/labels/gs1/print` — gated by `require_permission("labels.print")`: body `{ product_id, product_name, gtin, lot, expiry_display, expiry_yymmdd, serial_start, qty, printer_key, label_type }`. Validates GTIN, fetches printer IP, generates unit labels (one per unit with incrementing serial) and/or carton label, sends via TCP. Returns label count. Note: this is a standalone per-product endpoint (Products page); order-integrated packing-board version with serial tracking is a separate task below.
- [ ] Order-integrated print: `POST /api/labels/gs1/print-order` — fetches packing entry, reads Odoo lots/expiry, assigns serials from `gs1_serials`, writes serial manifest, audit-logs, updates packing entry with `labels_printed: true`
- [ ] `GET /api/labels/gs1/serials/{order_id}` — returns the full serial manifest for an order (gated by `require_admin`)
- [ ] `GET /api/labels/gs1/pdf/{order_id}` — PDF fallback using ReportLab, 4-up tiled A4 layout
- [x] `GET /api/labels/printers` — list configured printers (`require_admin`)
- [x] `PUT /api/labels/printers` — add/update printer by key (`settings.manage`)
- [x] `DELETE /api/labels/printers/{key}` — remove printer (`settings.manage`)
- [x] `POST /api/labels/printers/{key}/test` — send test ZPL; returns `503` on connection failure

**Frontend — Settings > Label Printers (BUILT 2026-07-09 — `frontend/src/views/LabelPrinters.js`):**
- [x] New "Label Printers" tab in admin Settings page (`Settings.js` updated)
- [x] Table: printer name, IP address, warehouse assignment, Delete button with confirmation modal
- [x] "Add Printer" form: name, IP address, optional warehouse ID
- [x] "Test" button per printer row — calls test endpoint, shows success toast or inline error
- [x] Standard `max-w-4xl mx-auto w-full` container, confirmation modal on delete (no `window.confirm`)

**Frontend — Products page GS1 button + modal (BUILT 2026-07-09 — `frontend/src/components/GS1LabelModal.js`):**
- [x] GS1 badge button in the Barcode column of the Products table — visible only when barcode passes GTIN-13/14 regex AND `can("labels.print")`; clicking opens `GS1LabelModal`
- [x] Modal: product name + GTIN header; lot/expiry/serial/qty fields; Unit/Carton/Both label type toggle; printer selector (loaded from `/api/labels/printers`); live bwip-js DataMatrix + GS1-128 preview (updates as fields change); "Print to Zebra" button (POST to `/api/labels/gs1/print`); "Print via browser" fallback (`window.print()` on hidden print-only div)
- [x] Amber warning banner when no printer is configured — links to Settings → Label Printers
- [x] Amber notice when GTIN is not a valid GTIN-13/14 — instructs staff to update Odoo barcode field
- [x] Dummy GTIN reminder shown at bottom of modal
- [x] **Lot/batch combo field** — `GET /api/products/{product_id}/lots` loads in-stock lots on modal open; lot field is a combo: free-text input + dropdown of existing lots (filtered as user types); selecting a lot auto-populates expiry date, quantity (floor of on-hand qty), and qty label with UOM name (e.g. "Quantity (Units)")
- [x] **GS1 AI fix** — carton label was using AI `(37)` (Count of Trade Items — SSCC-only, mutually exclusive with GTIN `(01)`); corrected to AI `(30)` (Variable count of items — valid alongside GTIN) in both `gs1.py` (backend ZPL builder) and `GS1LabelModal.js` (frontend bwip-js preview)

**Products page lot drill-down (BUILT 2026-07-10 — `frontend/src/views/Views.js`):**
- [x] Layers icon button added in the "On Hand" column alongside the existing History button; visible for all admin users
- [x] Clicking "Layers" opens a lot breakdown modal: fetches `GET /api/products/{id}/lots`, shows lot name / qty + UOM / expiry date per row, total count + total on-hand qty in footer
- [x] `GET /api/products/{product_id}/lots` backend endpoint — aggregates `stock.quant` across all internal locations per lot, fetches `stock.lot` for name + expiry date; returns `{lots: [{id, name, qty, uom_name, expiration_date}]}`

**Frontend — Packing board "Print GS1 Labels" button (pending serial tracking build):**
- [ ] Button appears on packing board entries in `packing` or `ready` state (after QA + RP approval, before collection) — gated by `can("labels.print")`
- [ ] If no printer is configured: button is disabled with tooltip "No label printer configured — add one in Settings"
- [ ] If any product line is missing a valid GTIN: button shows amber warning chip "X products missing GTIN" and is disabled; clicking the chip shows a modal listing the affected products with a prompt to update them in Odoo
- [ ] If all GTINs valid and printer configured: button is active — clicking opens a confirm modal:
  - Summary: "X unit labels + X carton labels will be printed to [Printer Name]"
  - Serial range preview: "Serials will be assigned starting at XXXXXXXX for each product line"
  - Confirm / Cancel
- [ ] On confirm: POST to order-integrated print endpoint → success shows "Labels printed" green badge on the entry with timestamp and total serial count; error shows specific message (printer offline, GTIN invalid, lot not found)
- [ ] If `labels_printed: true` already on the entry: button changes to "Reprint Labels" with amber styling and a warning in the confirm modal ("These serials were already issued — reprinting will not assign new serial numbers")
- [ ] Serial manifest link: small "View serials" link on entries with `labels_printed: true` — opens a modal listing every serial issued for the order

**PDF fallback UI:**
- [ ] "Download PDF Labels" link appears alongside "Print GS1 Labels" when no Zebra printer is configured
- [ ] Calls `GET /api/labels/gs1/pdf/{order_id}` — browser downloads the PDF
- [ ] PDF opens in browser print dialog; user selects their label printer manually

**`labels.print` permission (BUILT 2026-07-09):**
- [x] `labels.print` in `auth.py` `DEFAULT_ADMIN_PERMISSIONS` and `FULL_PERMISSIONS`
- [x] `labels.print: True` granted by default to: `orders_clerk`
- [x] `labels.print: False` for all other non-admin roles; grantable by super_admin via permission management UI

---

**Definition of Done for 12.4:**

- [ ] GS1 SA registration is complete and Bassani has their Company Prefix (business dependency — not a code task)
- [ ] Every finished goods product variant has a valid GTIN-13 or GTIN-14 in Odoo's barcode field
- [ ] Pressing "Print GS1 Labels" on a packing board entry sends ZPL to the configured Zebra ZT411 and labels physically emerge from the printer
- [ ] Each unit label's DataMatrix decodes correctly on a GS1-capable scanner: GTIN matches the product, batch matches the Odoo lot, expiry matches the lot expiry date, serial is unique across all orders
- [ ] Carton label GS1-128 decodes correctly: GTIN, batch, expiry, and quantity all present and correct
- [ ] No two units in any order share a serial number; no serial number is ever reused across orders for the same GTIN+lot
- [ ] The `gs1_serials` collection contains a complete record of every serial ever issued — sufficient to answer "which order and pharmacy received unit serial XXXXXXXX?"
- [ ] A product with a missing or invalid GTIN shows a clear error before printing is blocked; other products in the same order are not affected if their GTINs are valid
- [ ] Reprint scenario: reprinting an already-printed order does not issue new serial numbers
- [ ] PDF fallback produces a correctly tiled A4 PDF that prints readable labels on a standard laser printer
- [ ] "Test Printer" in Settings confirms connectivity before a real print job is attempted
- [ ] All print actions are audit-logged with actor, order reference, printer IP, serial ranges, and timestamp

---

### 12.5 — GTIN Pool Management ✅

**Goal:** Bassani purchases a block of GTIN codes from GS1 South Africa and needs to track which codes are available and which are assigned to which product. This replaces ad-hoc GTIN tracking in spreadsheets and ensures no GTIN is accidentally used twice.

**Status:** Complete — 2026-07-11

**Backend (`backend/routes/gtin_pool_routes.py` — NEW):**
- [x] MongoDB `gtin_pool` collection: `{ gtin, status: "available"|"assigned", odoo_product_id, product_name, assigned_at, assigned_by, created_at }`; unique index on `gtin`, index on `status`
- [x] `GET /api/gtin-pool/stats` — `{ total, available, assigned }` counts (`require_admin`)
- [x] `GET /api/gtin-pool` — list with optional `?status=available|assigned` filter and `limit` param (`require_admin`)
- [x] `POST /api/gtin-pool/bulk-add` — accepts `{ gtins: [...] }`, validates each via `validate_gtin()` from `gs1.py`, inserts new entries, skips duplicates; returns `{ added, skipped, invalid: [...] }` (`settings.manage`)
- [x] `GET /api/gtin-pool/{gtin}` — single GTIN lookup, returns pool record or 404 (`require_admin`)
- [x] `DELETE /api/gtin-pool/{gtin}` — removes from pool; blocked if status is `assigned` (`settings.manage`)
- [x] `POST /api/gtin-pool/{gtin}/assign` — body `{ odoo_product_id, product_name }`: marks GTIN assigned and writes `product.template.barcode` in Odoo via XML-RPC; audit-logged (`require_admin`)
- [x] `POST /api/gtin-pool/{gtin}/unassign` — clears Odoo barcode field and returns GTIN to `available`; audit-logged (`require_admin`)
- [x] Route ordering: `/stats` and `/bulk-add` registered before `/{gtin}` to prevent literal strings being captured by the path parameter
- [x] Registered in `server.py`; MongoDB indexes created on startup

**Frontend — Settings > GTIN Pool (`frontend/src/views/GTINPool.js` — NEW):**
- [x] New "GTIN Pool" tab in `Settings.js`
- [x] Stats row: Total / Available / Assigned cards
- [x] Upload panel: paste textarea (one per line or comma-separated), "Add to Pool" button → `POST /api/gtin-pool/bulk-add`; result summary shows added count, skipped count, and any invalid GTINs
- [x] GTIN Registry table: GTIN | Status (badge) | Product | Assigned date | Actions
  - Available GTINs: "Remove" action with confirmation modal
  - Assigned GTINs: "Unassign" action with confirmation modal (shows product name + GTIN, explains Odoo barcode will be cleared)
- [x] Filter pills: All / Available / Assigned
- [x] Standard `max-w-4xl mx-auto w-full` container; no `window.confirm` — all destructive actions use `Modal` + `pendingState` pattern

**Frontend — Products page "Pool" button + picker modal:**
- [x] Indigo "Pool" badge button added in the Barcode column of the Products table (before the GS1 button); visible to all admin users; clicking opens `GTINPickerModal`
- [x] `frontend/src/components/GTINPickerModal.js` — modal (`width="max-w-xl"`) showing:
  - Product context block (name + SKU)
  - Current barcode status: green badge if GTIN is in the pool as assigned; amber badge if barcode is set but not from the pool; nothing if no barcode set
  - Unassign action (pool-assigned barcodes only): inline confirm block, calls `POST /api/gtin-pool/{gtin}/unassign`
  - Available GTINs list (max-h-64 scrollable): real-time search filter; each row has "Assign" button calling `POST /api/gtin-pool/{gtin}/assign`; spinner on in-flight row; empty state distinguishes "pool empty" from "no search match"
  - On assign/unassign: `onAssigned(gtin)` callback updates the Products table row in-place without a full reload

**Definition of Done for 12.5:**
- [x] Uploading a list of GTINs via the Settings > GTIN Pool textarea adds all valid codes, skips duplicates, and reports invalid ones
- [x] Stats cards reflect current pool state accurately
- [x] Clicking "Pool" on a product row opens the picker; selecting a GTIN assigns it in the portal AND writes the barcode field in Odoo
- [x] The Products table barcode cell updates immediately on assignment without a page reload
- [x] Unassigning a GTIN from the picker (or from the registry) clears the Odoo barcode and returns the code to available
- [x] Removing a GTIN from the registry is blocked if it is currently assigned
- [x] A GTIN that fails the GS1 check digit algorithm is rejected at upload time with a clear error
- [x] All assign/unassign actions are audit-logged with actor, GTIN, product, and timestamp

---

### 12.6 — Global Barcode Search + Order Barcode

> **Added 2026-07-11** — Physical barcode scanners (USB/Bluetooth) are now used in the warehouse. Staff need a way to scan any barcode — product GS1, sale order reference, or invoice number — and land on the correct portal page immediately without knowing which URL to navigate to.

**Goal:** A global search bar in the TopBar (visible to all admin roles) accepts barcode scanner input and dispatches to the right page. Sale order tickets display a Code 128 barcode of the Odoo order reference so warehouse staff can scan a printed packing slip or tablet screen to pull up the ticket instantly.

**How scanners work:** USB/Bluetooth scanners emulate keyboard input — they type the value and press Enter into whatever input is focused. No browser extension or special detection needed. Pressing `/` from anywhere on any page focuses the global search input.

**Smart dispatch logic:**
1. 13–14 digit string with valid GS1 check digit → product barcode lookup → navigate to `/products?q={sku}`
2. Matches a `sale.order` name (exact or case-insensitive) → find linked sales ticket → navigate to ticket detail
3. Matches an `account.move` name → navigate to invoice detail

**Barcode format for orders:** Code 128 encoding the Odoo sale order name (e.g. `S00142`). GS1-128 with AI `(400)` is the formally correct standard for order references in regulated pharmaceutical supply chains; the current implementation uses plain Code 128 for simplicity. The scanner output is identical — the portal strips any AI prefix before dispatching.

**Backend:** `GET /api/search/global?q=...` in `search_routes.py`. Requires `require_admin` (staff roles only — resellers don't use scanners). Returns `{ type, id, ref, name, navigate_to }`.

**Frontend:**
- `GlobalSearch` component in `UI.js` — compact expanding input in every TopBar; `/` shortcut to focus; Escape clears
- `OrderBarcode` component in `SalesTickets.js` — `bwip-js` renders Code 128 canvas inline in the ticket detail header; print-safe
- `Products` page reads `?q=` URL param on mount to pre-populate search when navigating from a scan result

**Definition of Done for 12.6:**
- [x] Scanning a product GTIN in the global search bar navigates to the Products page pre-filtered to that product's SKU
- [x] Scanning a sale order reference (e.g. `S00142`) navigates directly to the sales ticket detail
- [x] Scanning an invoice reference navigates to the invoice detail page
- [x] Unrecognised barcode or reference shows a toast error ("No match found for: ...")
- [x] Pressing `/` from any portal page focuses the search bar without interfering with other inputs
- [x] Pressing Escape clears and blurs the search bar
- [x] A Code 128 barcode of the Odoo order name renders in the ticket detail header
- [x] The barcode is readable by a scanner from the screen and survives browser print (`@media print`)
- [x] GlobalSearch is hidden from reseller-role users

---

### 12.7 — Plain Retail Barcode Export — Complete 2026-08-03

**Goal:** Bassani's retail product lines (e.g. CannaCraze Cannabis Soda) ship in externally pre-printed packaging (sleeves per flavour) rather than portal-printed labels. The packaging printer needs a plain retail barcode graphic to embed in their print-ready artwork — just the GTIN, no batch/lot/expiry/serial data. This is a distinct need from the existing GS1 Label feature (12.4), which is specifically the DataMatrix/GS1-128 traceability format for per-unit pharmacy dispatch labels.

**Key distinction (confirmed with the product owner):** every barcode Bassani uses is still a GS1 GTIN number underneath — GS1 isn't pharmacy-specific, it's the standard behind every retail barcode. What differs is the *symbol*: a retail product needs the GTIN alone as an ordinary EAN-13, while pharmacy dispatch needs the GTIN plus batch/expiry/serial as a GS1 DataMatrix. The portal previously had no way to produce the plain version as a standalone graphic — setting `product.barcode` only stores a number, and the GS1 Label modal only renders the compliance format.

- [x] `frontend/src/components/BarcodeExportModal.js` (new) — renders an EAN-13 barcode (falls back to Code128 if the barcode isn't a clean 12-13 digit GTIN) via `bwip-js`, sized to the real **GS1 General Specifications retail barcode standard**: nominal 37.29 × 25.93mm at 100% magnification, adjustable 80%-200% via a slider (below 80% risks unreliable scans at checkout, per spec). Downloads as SVG (vector, recommended for packaging artwork — resizable by the printer/designer with no quality loss) or PNG (300 DPI raster fallback).
- [x] Sizing is driven by `bwip-js`'s own millimeter-native `width`/`height` options (confirmed against the installed 4.11.2 build, not assumed) rather than pixel/scale guesswork: `height` specifically sets bar height, and passing the GS1 nominal bar height (22.85mm) with `includetext:true` reproduces the textbook 25.93mm total. True rendered size is read back from the returned SVG's `viewBox` divided by the `scaleX`/`scaleY` bwip-js mutates onto the passed options object (it auto-picks these for rendering quality at small sizes) — verified empirically to track the requested size within normal barcode-generator snap-rounding tolerance at every magnification from 80%-200%.
- [x] `frontend/src/views/Views.js` — new **Export** button in the Products table's Barcode column, alongside the existing GS1 button, gated on `labels.print` and requiring any barcode value (not just a strict GTIN, since the Code128 fallback handles non-GTIN codes).
- [x] No backend changes — this is fully client-side (bwip-js renders and the browser downloads directly), since it's a one-off design asset, not a repeated operational print job like the GS1/Zebra path.

**Design decisions:**
- **SVG recommended over PNG** — the deliverable goes into external packaging artwork the printer will place and likely resize themselves, so vector avoids any quality loss regardless of final print size. PNG is offered at 300 DPI purely as a fallback for tools that can't take vector input.
- **GS1 magnification (%), not arbitrary small/medium/large presets** — matches the actual language a packaging printer or GS1 SA will use, and visibly anchors the choice to the legal 80%-200% range rather than an app-invented scale.
- **Separate modal from GS1LabelModal.js, not a mode toggle inside it** — the two serve genuinely different audiences (external packaging printer vs. Bassani's own pharmacy dispatch floor) and reusing one modal for both would blur a distinction worth keeping clear in the UI.

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
**Status:** 🟡 In Progress — 13.0 Vault Movement Module (Track A starter) in build; the rest of the phase remains concept pending SAHPRA requirements  
**Blocked on:** SAHPRA reporting requirements (exact fields, formats, submission method) must be obtained before the *full* production data model can be finalised. 13.0 is deliberately scoped to not depend on them — it digitises an existing live logbook and uses only the confirmed V6 batch standard.

> **Origin:** Bassani Health attended a meeting with GrowerIQ (June 2026) to evaluate their platform. Decision is to build the equivalent in-house, retaining full data ownership and tight integration with the existing commercial portal. The commercial portal already covers the downstream (vault → sales); this phase covers the upstream (cultivation → vault).

> **Compliance standard:** GrowerIQ provided their EU GMP Annex 11 (Computerised Systems) compliance mapping in June 2026. EU GMP Annex 11 is the pharmaceutical industry standard governing how software managing medicinal product manufacturing must behave — covering audit trails, access control, electronic signatures, data integrity, and batch release. SAHPRA aligns with EU GMP for medicinal cannabis in South Africa, making this the most likely standard Bassani must satisfy. Building against Annex 11 from the start is the correct design target. Confirm explicitly with Bassani's compliance officer before scoping begins.

---

### Confirmed Odoo Architecture (2026-07-11)

These facts are confirmed from conversation with the product owner and must not be re-derived during Phase 13 design.

**Legal entity structure:**
- GACP (cultivation/manufacturing facility) and La Farmacia (finished goods distribution) are **separate legal entities** registered in Odoo as separate companies.
- The intercompany transfer mechanism is correct as currently configured: La Farmacia raises a **Purchase Order** against the GACP vault. Odoo's intercompany rules auto-generate a corresponding Sales Order on the GACP side. This is industry-standard Odoo for regulated multi-entity cannabis operations.
- Do not replace this with internal transfers. The PO/SO pair is the correct commercial record between two legal entities.

**Current state of Odoo inventory:**
- `stock.lot` records exist in Odoo for cultivation batches — the lot tracking model is already in use.
- Batch ID generation is **still manual via spreadsheet**. Staff generate IDs in a spreadsheet and then enter them into Odoo. This is the primary source of the format inconsistency already observed (confirmed live in logbook data). The portal batch ID generator (Track A below) eliminates this immediately.
- Bills of Materials (`mrp.bom`) for the transformation steps (flower → manicured/pops/trim → crushed → pre-roll) have **not yet been built** in Odoo. This is a hard dependency for any MO-driven portal work.
- Odoo sub-locations within the GACP warehouse (grow rooms, drying room, processing room, vault) **have not yet been configured**. These are required before internal transfers between stages can be tracked.

**Intercompany rules:**
- Confirm with Luca/Tristan whether Odoo's intercompany automation is active (La Farmacia PO auto-creating GACP SO). If not yet active, this is a one-time Odoo configuration task, not portal development.

---

### Phase 13 Delivery — Track A vs Track B

Work splits into two tracks based on Odoo prerequisites. Track A can start immediately. Track B is gated on Odoo configuration being complete.

**Track A — No Odoo prerequisites, can start now:**

| Deliverable | What it does |
|---|---|
| Batch ID generation form | Portal generates the batch ID from strain code, sequence, and date; creates `stock.lot` in Odoo (GACP company) via XML-RPC; eliminates spreadsheet entry entirely |
| Intercompany transfer visibility | Portal surfaces GACP → La Farmacia PO/SO pairs so staff can see pending and completed vault transfers without opening Odoo |
| GACP logbook (plant tracking) | Grow room, row, strain, plant count, expected harvest — MongoDB `cultivation_batches`; no Odoo object at this stage (plants are not Odoo inventory until harvest) |

**Track B — Gated on Odoo configuration:**

| Deliverable | Odoo prerequisite |
|---|---|
| MO progression through stages | BoMs must exist for each transformation (harvest → dry, dry → manicure, manicure → crush, etc.) |
| Yield capture vs expected bands | BoMs define expected yield ratios; portal compares actual MO output vs BoM-defined band |
| Stage-to-stage internal transfers | Sub-locations must be configured in the GACP warehouse (grow room, drying, processing, vault) |
| Full traceability chain | All of the above + vault IN scan linking lot to production session |

**Recommended sequencing:** Deliver Track A first — it provides immediate value (eliminates spreadsheet, stops format drift) and has no Odoo configuration dependency. While Track A is being built, agree the BoM structure and sub-location setup with Luca/Tristan so Track B can proceed without delay.

---

### 13.0 — Vault Movement Module (Track A Starter) — Built 2026-07-24 (staged mode), pending live verification

> **Source document:** `Patricia Logbook for Nick (1).xlsx` — a live single-sheet **Vault Transaction Logbook** (77 rows, 1–5 June 2026) received 2026-07-24. Patricia (vault custodian) records every movement across the vault threshold: Date, Time, Strain, Batch #, Reason (Storage = IN / Packing = OUT / Manicuring = OUT), Weight Received, Weight Removed, Trim Weight Received. Process note from the workbook: all flower sent to Manicuring is Unmanicured Bulk (`-U`); it returns same day as Manicured (`-M`) plus trim weight (`-T`) — the batch suffix amendment happening at the vault door. Observed data problems that motivate this module: no running balance (current vault stock is unknowable from the sheet), malformed batch IDs (`BIBG--GGL204-040626`, trailing hyphens, same batch typo'd two ways in one day), mixed units (`0.290kg` / `5g` / `0.470KG`), 18 half-empty rows with no batch or weight, almost no times, no actor identity, and an undocumented `BIBG-` prefix family not in the V6 standard (externally sourced flower — awaiting Bassani clarification).

**Purpose:** First concrete Track A delivery and the business demo for the full Phase 13 build. Digitises the vault logbook with portal-enforced batch IDs and real Odoo stock movements — behind a staged-writes switch until GACP Odoo access is confirmed. The headline demo value is **batch number consistency**: IDs are generated, never typed, and every batch has a live movement timeline.

**Open questions (asked of Bassani 2026-07-24):**
1. ✅ **`BIBG-` answered 2026-07-27** — external imports. `BI` = Bassani Import; the second letter pair is a supplier code (`BG` = BudGrow). So `BIBG-GGL204-040626-M` = Bassani Import / BudGrow / Gorilla Glue supplier ref 204 / 4 June 2026 / Manicured. This is a fifth prefix family the V6 guide never documented. Bassani also keeps an **"S6 Receiving Logbook"** (Schedule 6 substance record keeping, Excel) — copy promised; it is the source document for the import/receiving flow. See 13.0.6.
2. Is GACP a company on the **same Odoo database** (service account just needs the company added to its allowed companies) or a **separate Odoo instance** (second XML-RPC connection — real architectural work)? The confirmed intercompany PO/SO automation suggests same-DB, but do not build on the assumption.
3. If same DB: add the GACP company to the service account's allowed companies with inventory/manufacturing rights.

**Staged Odoo writes (core design decision):** All Odoo stock calls for this module go through a single `VaultOdooWriter` adapter with a mode switch (`GACP_ODOO_WRITES=off|on` Railway env var). In `off` mode every movement is fully recorded in `vault_movements` (MongoDB) together with the exact Odoo payload it *would* send, stamped `odoo_sync: "staged"`. When GACP access is confirmed, an admin "Sync staged movements" action replays the queue in order against Odoo, stamping resulting picking/lot IDs and `odoo_sync: "done"`; new movements then write live. **The staged queue is a temporary outbox, not a ledger** — once writes are enabled it must be flushed and reconciled so Odoo remains the sole source of truth (no-parallel-ledger principle). Nothing is throwaway: adapter, movement documents, and probe are exactly what the live version uses; `off` mode just skips the final step.

**Sub-phases:**

**13.0.1 — GACP readiness probe + Odoo prerequisites**
- [x] Read-only probe (`GET /api/production/odoo-probe`, `production.manage`): reports companies the service account can see, warehouses per company, location tree per warehouse, and whether `mrp` is installed — answers "do we have GACP access yet?" empirically the moment Bassani changes anything
- [x] **Frontend surfaced (2026-07-27):** "Check stock system access" button on the Vault Logbook top bar (`production.manage`) opens a results modal — writes-live status, GACP warehouse configured y/n, manufacturing app installed, and the full company → warehouse → location tree the connection can currently see, with a GACP badge on the configured warehouse if it appears. Previously API-only with no way to view the answer from the running app. Companies/warehouses the service account has not been granted access to are invisible to this probe (Odoo hides them entirely, no error) — the modal explains this and that granting access is a one-time Odoo-side step, not something the portal can do itself.
- [ ] Once access confirmed: GACP sub-locations created under the GACP warehouse's stock root (`Vault`, `Manicuring Room`, `Packing Room`, `Drying Room`) — one-time `stock.location` setup (Odoo UI or portal script, decision with Luca/Tristan)

**13.0.2 — Batch ID generator + registry — Complete 2026-07-24**
- [x] Deterministic V6-format generator (`services/batch_id.py`, unit-tested against real IDs from the naming sheet + live logbook): product shortcode (searchable dropdown seeded from the 73-code master list), auto-incremented per-product sequence, auto date (DDMMYY), prefix family (`BHAPI`/single-strain/`BHB`/`BHG`) — live ID preview endpoint; staff never type any part of an ID
- [x] `batch_registry` MongoDB collection: generated IDs with strain, prefix family, sequence, dates, created_by; creates the Odoo `stock.lot` (GACP company) when writes are live, stages the op otherwise
- [x] Suffix amendment derives a child ID from a parent batch — stage suffixes REPLACE each other per the workbook's Batch Naming rules (`-U` → `-M`/`-T`, not stacked); registry links child to parent; no free-text derivation
- [x] Product shortcode master list imported from the logbook workbook's "Shortcode for products" sheet (`backend/data/product_shortcodes.json`, lazily seeded into `product_shortcodes`); `production.manage` can add new products in the UI. Named **Products** throughout (2026-07-24 rename from "strains") since the list mixes flower strains, gummy flavours, vapes and oils — matching Bassani's own sheet title; "strain" is only used where it genuinely means the flower strain (batch type labels).
- [x] Manage Products modal (`production.manage`, added 2026-07-24): add / archive / restore / delete. Archive hides a product from the generator picker and blocks new batches without touching existing ones; hard delete only allowed when no batch has ever used the code (409 otherwise) — used codes must stay resolvable for the traceability chain. All actions audit-logged.
- [x] **Flower batches carry `-U` (Unmanicured) from the moment of creation (2026-07-28):** previously a freshly generated base batch had no stage suffix at all — inconsistent with the vault module's own documented lifecycle ("Receive to Vault: unmanicured -U bulk in from drying") and with no way to tell unmanicured vs manicured stock apart until the first vault movement. `create_batch` and `GET /batches/preview` now apply `derive_stage_id(bare_id, "U")` for `FLOWER_FAMILIES = {single, api, blend}` (Gummy has no manicuring stage and stays bare); `base_batch_id` is stored as the pre-suffix root so registry grouping and later `-U`→`-M`/`-T` derivation are unaffected. No UI change needed — the suggested-movement logic in VaultLogbook.js already reads `stage_suffix` correctly.
  - **Bug found and fixed same day:** baking a suffix into the very first stored entry means `base_batch_id` (the bare root) no longer always equals a real document's `batch_id` — three places assumed it did. (1) `GET /batches/{id}/timeline`, called by the registry table's expand action with the group's `baseId`, 404'd with "Batch X is not in the registry" whenever that id had no matching document (every flower batch, and every import that got a stage suffix) — fixed by resolving `base_batch_id` from the found document *if one exists*, otherwise treating the input itself as the lineage root, so the endpoint accepts either a real `batch_id` or a synthetic `base_batch_id`. (2) The quarantine gate's receipt lookup in `create_movement` matched `s6_receipts.batch_id` against a derived stage's `base_batch_id` — after a manicured import forked into `-M`/`-T`, issuing those derived batches would find no receipt and wrongly block with "no S6 receiving record on file." Fixed by storing `base_batch_id` on the receipt at creation (`receive_import`) and matching on that field (with a `batch_id` fallback for receipts written before the field existed). (3) `vault_ledger`'s `unreleased_imports` list returned raw receipt `batch_id`s, which the Vault Logbook compares against `batch.base_batch_id` — same mismatch, silently failing to grey out tiles for a legitimately-unreleased batch. Fixed by returning `base_batch_id` (falling back to `batch_id`) instead.

**13.0.3 — Vault Transaction form (the Patricia replacement) — Complete 2026-07-24**
- [x] Four movement types mirroring her Reason column: Receive to Vault (source: production / external supplier / opening balance), Issue to Packing, Issue to Manicuring, Return from Manicuring
- [x] Receive/Issue → `stock.picking` internal transfer with lot on the move line (via `VaultOdooWriter`)
- [x] Return from Manicuring → transformation: consumes the issued lot, produces `-M` + `-T` lots, waste auto-computed from the issued weight — Odoo `mrp.production` **without a BoM** (manual raw/finished moves; supported in Odoo 17), a real manufacturing record from day one, not gated on Track B BoM setup (⚠️ written when the live instance was believed to be Odoo v17 — it's actually 19.0, confirmed 2026-08-11; this specific `mrp.production` no-BoM claim has not been re-verified against 19.0 and should be checked before Phase 13 build work relies on it)
- [x] Batch field is a registry picker only — no free-text batch entry exists anywhere in the module
- [x] Quantities normalised to grams; actor + timestamp captured from the logged-in user automatically
- [x] Every movement audit-logged via `audit_log()`
- [x] Usability hardening (2026-07-24): selected-batch summary panel (product, plain-language stage, current vault balance, out-at-manicuring weight) shown before saving; soft warning when issuing more than the recorded vault balance (does not block); plain-language stage labels and hover tooltips (`product — stage`) on batch IDs across the picker, registry, ledger, movement history, and timeline
- [x] Guided batch-first flow (2026-07-24): the form asks "which batch?" first; the movement tiles are then gated by where the batch actually is — impossible movements greyed out with the reason (issue with nothing in vault, return when not out at manicuring), and the suggested next step badged and auto-selected (never moved → Receive; `-U` in vault → Issue to Manicuring; out at manicuring → Return; otherwise → Issue to Packing). Receive stays always-enabled because stock legitimately arrives in tranches. Ledger endpoint now returns `manicuring_out` per batch to drive this.

**13.0.4 — Vault Ledger + batch timeline — Complete 2026-07-24**
- [x] Vault holdings per batch computed from the movement log, badged "pending sync" while `GACP_ODOO_WRITES=off` (once live and flushed, Odoo `stock.quant` is the authoritative figure)
- [x] Per-batch timeline: stage chain (`-U` → `-M`/`-T`) plus every movement with type, weight, actor, timestamp — the generate/track demo centrepiece
- [x] **Registry table grouped by physical batch, expandable (2026-07-27):** replaces the earlier one-row-per-stage layout (unreadable once a batch has moved through several stages) and the separate Timeline modal it opened into. Rows are grouped client-side by `base_batch_id`; each group shows one line — batch, product, current stage(s), started, aggregated stock-system status — with a chevron to expand inline into the full stage chain + movement history (same data the old modal showed, fetched from the existing `GET /batches/{id}/timeline` endpoint, lazily on first expand). "Current stage(s)" is computed as the group's *leaf* entries — stages nothing else in the group was derived from — so a batch that has forked via manicuring (Manicured + Trim, sibling outputs of the same `-U` input, not one replacing the other) correctly shows both current forms as separate chips rather than picking one arbitrarily, with a "(N stages)" count alongside when the full history is longer than what's currently active.
- [x] **Vault Ledger table gets the same grouping (2026-07-28):** same problem as the registry table — one row per stage meant a batch with several stages (e.g. a fully-issued `-U` plus its `-M`/`-T` outputs) showed as multiple separate ledger lines. `GET /vault/ledger` now attaches `base_batch_id` to every row (from the registry, falling back to stripping the stage suffix off the row's own `batch_id`); the frontend groups by that field, client-side, no extra fetch needed since every stage's balance is already in `ledger.rows`. The collapsed row shows the summed **total currently in the vault across the whole lineage** plus a chip per active (non-zero) stage — e.g. "Manicured" + "Trim" side by side — so the headline number is never an opaque blob; expanding (only shown when there is more than one stage) reveals the exact per-stage breakdown, including any zeroed-out intermediate stage, for anyone auditing the numbers.
- [x] Movement history list, searchable, with per-row Odoo sync status and error surfacing
- [x] Test-data purge (2026-07-24): `POST /api/production/purge-test-data`, super admin only — wipes `batch_registry` + `vault_movements` (product master list kept, sequences reset naturally); refuses with 409 if any record has `odoo_sync: "done"` (real stock records must be reversed in Odoo, not deleted); purge itself audit-logged with counts; audit entries are self-contained so no orphaned references. Button on Vault Logbook top bar, visible to super admin only.
- [x] Built-in reference guide (`ProductionGuideButton` on both production pages): plain-language batch ID anatomy, the four prefix families, stage-letter meanings and the replace-not-stack rule, packaging codes, movement type explanations, Staged-label meaning — added 2026-07-24 so vault staff never need the paper V6 standard

**13.0.5 — Role + permissions (`vault_custodian`) — Complete 2026-07-24**
- [x] New `production` permission domain: `production.batch_generate` (generate IDs, view registry), `production.vault` (record movements, view ledger), `production.manage` (sync staged movements, readiness probe, product list — super admin initially)
- [x] New `vault_custodian` role: added to `ALL_ROLES` + new `PRODUCTION_ROLES` set (kept out of `TICKET_ROLES`), included in both permission-gate unions in `auth.py` and in `AuthContext.js` `PERMISSION_ROLES`; fixed `ROLE_DEFAULT_PERMISSIONS` — production permissions only, everything downstream off
- [x] `resolve_warehouse_id()`: `vault_custodian` pinned to fixed `warehouse_id` on the user document (same branch as `warehouse_supervisor`/`packer`, global-default fallback) — set to the GACP warehouse once confirmed
- [x] `Users.js` wiring: `ROLE_OPTIONS`, `EDITABLE_ROLES`, `ROLE_COLORS`, `ROLE_DEFAULT_PERMS`, `ROLE_LOCKED_PERMS`, role filter pill, warehouse-assignment paths, new "Production (GACP Facility)" `PERMISSION_GROUPS` group, off-by-default in admin defaults
- [x] `/` route in `App.js` redirects `vault_custodian` to the Vault Logbook; "Production" nav section (Batch Registry + Vault Logbook) permission-gated so this role sees nothing downstream

**13.0.6 — External import batches (`BI` prefix family) + S6 Receiving Register — Built 2026-07-27**

> **Source document reviewed 2026-07-27: `S6 Stock Receiving Logbook.xlsx`** (Register: 108 live rows Oct 2025–Jul 2026; Look Up Table; Notes). Confirmed BI ID anatomy: `BI{supplier}-{product}{type_digit}{import_ref}{subcat?}-{DDMMYY}` — e.g. `BISB-JSY340L-300426` = Bassani Import / Seven Blade / Jealousy / Greenhouse (3) / import ref 40 / Large / received 30 Apr 26. Segments: 13 supplier shortcodes (CF Cradle Farms, GC GreenCo, BG BudGrow, BM Blom Medical, PH Pfresh, VV Verve, IG Innovation Guru, AF Ambary, TN Tom and Nick, SB Seven Blade, NK Nick Klotz, TV Triple A, SG Stable Grow); type digits 1 Indoor / 2 Greendoor / 3 Greenhouse / 4 Distillate / 5 Vape / 6 Hash / 7 Edible / 8 Tincture / 9 Trim (type can change per shipment for the same product); stable 2-digit **import ref** per product (01–59 assigned so far — duplicate-assignment drift already visible in the sheet, e.g. BDA as both 45 and 47, which auto-assignment fixes); optional sub-category character L/P/S (Large/Pops/Smalls, added 2026-05-04 per Notes sheet). The register is the Schedule 6 legal receiving record: quoted vs received qty (discrepancies recorded), document checklist (Invoice / COA / Delivery Note / S6 Transfer Doc), "Loaded on Odoo" flag (manual step the portal replaces), comments. Stage suffixes apply to BI bases unchanged (`BIBG-GGL204-040626-M` in the vault logbook).

- [x] Review the S6 Receiving Logbook and confirm the `BI` ID segment structure + required Schedule 6 receipt fields
- [x] `import_suppliers` master list seeded from the Look Up Table (`backend/data/import_suppliers.json`, 13 suppliers), add/archive/restore endpoints (`production.manage`)
- [x] Product import refs: `import_ref` on `product_shortcodes`, seeded from the Look Up Table (`backend/data/import_product_refs.json`, 57 products incl. ~20 new ones merged into the master list; BDA duplicate in the sheet resolved to 45); auto-assigned (next free number) when a product is imported for the first time
- [x] ~~Generator origin toggle~~ **Removed 2026-07-27 — compliance decision.** A BH/BI toggle on the Batch Registry generator originally let staff generate an imported batch ID directly, bypassing the S6 receive flow entirely: the batch would be created with no `s6_receipts` entry, no quarantine, and — critically — the quarantine gate in `create_movement` only blocked issuance *if a receipt existed and wasn't released*; with no receipt at all it silently allowed the movement. **Fixed at both ends:** `POST /api/production/batches` now refuses `family: "import"` outright (imported batches are only ever created inside `receive_import`, atomically with the receipt), and the quarantine gate now denies by default when no receipt is found rather than allowing the movement through. The Batch Registry generator is Bassani-produced batches only, with a pointer to S6 Receiving for imports; the registry **table** still lists every batch regardless of origin, since full traceability is the point — `build_import_batch_id` remains unit-tested and lives on, used exclusively by the S6 receive flow.
- [x] **Receive Imported Stock flow** (`POST /api/production/vault/receive-import`, `production.vault`): one action = whole S6 register row — supplier, product, type, size, qty quoted vs received (discrepancy auto-computed and flagged in the UI), 4-document checklist (yes/no v1; R2 uploads = v2), comment → atomically creates the BI batch, the vault Receive movement (`source: external_supplier`), and the `s6_receipts` register entry; purge-test-data clears `s6_receipts` too
- [x] Odoo side: `po_receipt` op — staged now; live path creates a `purchase.order` on the supplier partner, confirms it, and validates the receipt picking with the lot (fails with clear messages when the supplier partner or product is unmapped, surfaced by sync)
- [x] **S6 Register view** (`S6Register.js`, `/production/receiving`, "S6 Receiving" nav item): receive form + the digital register — searchable table with received date, supplier, product/type/size, batch, qty (+quoted when discrepant), document ticks, actor
- [x] Guide modal updated: BI family row + colour-coded import anatomy (`BISB-JSY340L-300426`) + the 9 stock types
- [x] **Import material state captured at receipt (2026-07-28):** previously every BI batch was created with no stage suffix, so an already-manicured import and raw unmanicured bulk were indistinguishable in the registry, and the guided vault flow couldn't suggest the right next movement. `_determine_import_stage()` derives the stage automatically wherever the data already implies it — sub-category Large/Smalls → `-M` (both are manicured-flower gradings), Pops → `-P`, stock type Trim → `-T` always, Distillate/Vape/Hash/Edible/Tincture → no suffix (finished products, no manicuring stage). The **only** case that asks the operator directly is a flower-type delivery (Indoor/Greendoor/Greenhouse) with no size given, where the batch number genuinely can't tell — a required "Has this delivery already been manicured?" toggle appears only then. A manicured import is created with `-M` and, once RP-released, the guided flow already suggests Issue to Packing directly (`VaultLogbook.js` reads `stage_suffix` unchanged — no gating logic needed updating); an unmanicured one is created with `-U` and still needs Issue to Manicuring like a BH batch. The live batch-number preview on the S6 Receiving form shows the resolved stage ("Recorded as: Manicured/Unmanicured/Trim/…") before the operator saves.

**13.0.7 — PO linking, investigation flags + RP quarantine release — Built 2026-07-27**

> Schedule 6 control layer on top of the S6 receiving flow, following GMP incoming-goods practice: **quarantine on receipt, documented release before use**. Segregation of duties: the receiver records the facts (weights, documents); the Responsible Pharmacist verifies and releases — they never originate the numbers they check.

- [x] **PO linking:** `GET /api/production/suppliers/{code}/open-pos` — live read of the supplier's open Odoo purchase orders (draft/sent/purchase, resolved via the supplier partner by name; degrades gracefully when Odoo is unreachable or no partner exists). The S6 receive form requires either a linked PO or the explicit flag; a linked PO makes the staged `po_receipt` op receive against that PO (confirming it if still draft) instead of creating a duplicate
- [x] **Investigation flags:** "No purchase order found — flag for investigation" option on the receive form; flagged receipts are highlighted, notify the `s6_flag_to` email routing key (Settings > Email Routing > "Production: Stock Received Without Purchase Order", via BackgroundTasks), and **cannot be released until resolved** by `production.manage` with a mandatory note (`POST /s6/{id}/resolve-flag`, audit-logged)
- [x] **Quarantine + RP release:** every S6 receipt lands with `status: "quarantine"`; issue movements for the batch (and its derived stages) are blocked server-side (409) and greyed out on the Vault Logbook tiles ("Awaiting Responsible Pharmacist release", ledger returns `unreleased_imports`) until released. **Hardened 2026-07-27 to deny by default:** the gate originally only blocked when a receipt existed and wasn't released — an import batch with *no* receipt at all (possible before the generator origin-toggle was removed, see 13.0.6) fell through silently. It now requires a receipt to exist at all for any non-receive movement on an import-family batch, blocking with "no S6 receiving record on file" otherwise.
- [x] New permission `production.rp_release` — `responsible_pharmacist` role default ON (all the usual auth.py + Users.js wiring); **S6 Releases** nav item + `/production/releases` queue view: pending receipts with full detail (PO/flag state, document ticks with missing-docs warning, quoted vs received), **Release** (confirm modal) and **Query** (mandatory note, locks the batch, `status: "queried"`) actions; Resolve Flag action shown to `production.manage`
- [x] Release writes a `signature_events` record (`method: "session"`) — explicitly marked for in-place upgrade to the Annex 11 re-authentication e-signature module when built (same gap as the packing board QA/RP approvals)
- [x] S6 register table shows PO / flag / status columns; `status` filter on the register endpoint (`pending` = not released)
- [x] **Supplier account linking (2026-07-27):** Manage Suppliers modal on the S6 Receiving page (`production.manage`) — add / archive / restore, plus **Link account**: searches Odoo vendor partners (`GET /odoo-vendors`, `supplier_rank > 0`) and pins `odoo_partner_id`/`odoo_partner_name` on the `import_suppliers` doc (link/unlink audit-logged). PO lookups and `po_receipt` writes use the pinned ID deterministically; name matching survives only as a read-time fallback, labelled in the UI ("Matched by name — ask an admin to link"). Same explicit-FK pattern as `customer_metadata.odoo_partner_id`.
- [x] **The portal never creates purchase orders (confirmed rule, 2026-07-27):** the 13.0.6 auto-create branch in the sync path was removed. POs are raised in Odoo by Bassani and linked in the portal — at receive time (open-PO selector) or when resolving a no-PO flag (the resolve modal offers the supplier's open POs; linking updates the receipt and its staged movement op). A receipt whose flag was resolved without a PO fails sync with a clear message instead of inventing one.

**13.0.8 — Product → Odoo product linking — Built 2026-07-27**

> Every batch is a `stock.lot` on exactly one Odoo `product.product`. Previously the writer resolved that product by **name match at write time** — a guess, deferred because zero Odoo writes had happened yet. Replaced with the explicit-pin pattern proven on suppliers (13.0.7). **Confirmed by product owner 2026-07-27:** the GACP warehouse setup mirrors the current app usage; product creation happens in Odoo only — **the portal never creates `product.product` records** (same rule as purchase orders). Catalogue-structure question (per-strain vs per-strain-per-state bulk products) sits with Luca/Tristan; if they later split by material state, the mapping extends to per-stage pins on the same mechanism — not a redesign.

- [x] `odoo_product_id` + `odoo_product_name` fields on `product_shortcodes`; `POST /api/production/products/{code}/link` and `/unlink` (`production.manage`, audit-logged as `production.product_linked`/`_unlinked`) — mirrors the supplier link endpoints
- [x] `GET /api/production/odoo-products?q=` (`production.manage`): searches `product.product` by name (min 2 chars, limit 15, normalises `False` → `None`) — mirrors `GET /odoo-vendors`
- [x] Manage Products modal (`BatchRegistry.js`): per-row link status ("Linked to X" green / "Not linked to a stock system product" amber) + **Link product** picker (pre-filled with the product name) + Unlink — mirrors the supplier UI pattern in `S6Register.js`'s Manage Suppliers modal
- [x] **Link Product picker upgraded to full category/variant browsing (2026-07-27):** since products and categories are global in Odoo (only stock quantity is warehouse-scoped, and irrelevant to picking a link target), the picker now matches the commercial quote builder's Browse Products drawer exactly — search bar, category `SearchableSelect` (exported from `ProductPickerDrawer.js` for reuse), variant `SearchableSelect` derived client-side via `parseDisplayName` from the loaded result set, and a result list showing base name + variant chips + SKU. Backed by `GET /api/production/odoo-categories` (new) and `GET /api/production/odoo-products` (extended with `category_id`, made `q` optional) — both gated on `production.manage` rather than the admin-only role `/api/products/` requires, and deliberately carry no `warehouse_id` since linking needs product identity, not stock availability.
- [x] `VaultOdooWriter`: every op builder (`op_ensure_lot`, `op_internal_transfer`, `op_manufacture_split` — both the input and every output — `op_po_receipt`) now carries `product_code` + `product_id`. New shared `_product_id_for()` resolves the pinned id when present, falling back to the old name match (`_resolve_product()`) only when unlinked; its failure message now points at Manage Products ("Link the product to its stock system record")
- [x] Batch creation (`create_batch`, `_create_import_batch`), movement (`create_movement`, `_register_derived`) and receive (`receive_import`) endpoints all fetch the current product doc and pass `product_code`/`odoo_product_id` into the op builders
- [x] **Sync-time re-resolution**: new `_refresh_product_pins(ops)` helper re-reads the CURRENT link for every `product_code` referenced in an op list (including manufacture_split outputs and the input) and overwrites `product_id` immediately before every `writer.execute_ops()` call — live-write paths and `sync_staged`'s two loops alike. This is what lets a batch/movement staged before a product was linked still resolve against the right Odoo record once it is, without needing to re-create anything.
- [x] Docs: CLAUDE.md writer entry carries the "portal never creates products" rule; user manual quick-ref row for linking products

**13.0.9 — Pagination & Ledger Scalability — Scoped 2026-07-28, ledger fix built same day**

> Raised by the product owner: none of the production module's three list views (Batch Registry, Vault Movement History, S6 Register) paginate or use the shared `DataTable` component the rest of the app uses (e.g. `Invoices.js` — `manualPagination`/`manualSorting`, server `skip`/`limit`/`total`); all three fetch a fixed 100–200 row chunk client-side. All three backend endpoints already support `skip`/`limit`/`total` — the pagination plumbing exists, it's just not wired up. Separately, and more urgently: `GET /vault/ledger` recomputed every batch's running balance from **the entire `vault_movements` history** on every page load, capped at `to_list(5000)`. Past 5000 total movements this doesn't degrade gracefully — it silently computes balances from only the oldest 5000 and drops everything after, producing **wrong, uncaught numbers** rather than a slow response. For a system meant to run for years and back compliance reporting, that combination (silent + wrong) is the priority fix.

- [x] **Materialized ledger balances (built 2026-07-28) — the correctness fix, independent of any pagination decision.** New `batch_balances` collection: one document per `batch_id` (`{batch_id, qty_g, movements, last_movement_at, manicuring_out}`), updated **incrementally at write time** in `create_movement` and `receive_import` via `_ledger_bump()`/`_ledger_manicuring_out_delta()` — the exact same delta arithmetic the old full-history recompute used (`receive` → `+qty`; `issue_packing`/`issue_manicuring` → `-qty`; `issue_manicuring` also adds to the issuing batch's `manicuring_out`; `return_manicuring` → `+qty` per output batch, and subtracts `outputs + waste` from the *issuing* batch's `manicuring_out`), just relocated to fire once per movement instead of being replayed over the whole collection on every read. `GET /vault/ledger` now reads `batch_balances` directly — cost is proportional to **distinct batches**, not **movements ever recorded**, so it stays flat as history grows. Cross-checked against the original full-recompute algorithm on a synthetic multi-stage dataset (receive → issue_manicuring → return_manicuring split → issue_packing) before cutover — see `scratchpad` verification script; both produced identical `qty_g`/`movements`/`manicuring_out` per batch.
- [x] `POST /api/production/vault/rebuild-ledger` (`production.manage`): recomputes `batch_balances` from scratch by replaying the full `vault_movements` history — the same reconciliation tool a ledger system should always have on hand, not just a migration step. `purge-test-data` now clears `batch_balances` too, so a purge doesn't leave phantom balances behind.
- [x] Indexes added at startup (`server.py`): `vault_movements` on `batch_id` + `created_at`; `batch_registry` on `batch_id` (unique) + `base_batch_id`; `batch_balances` on `batch_id` (unique); `s6_receipts` on `base_batch_id` + `status`.
- [x] **Pagination (built 2026-07-27).** `GET /api/production/batches/grouped`: a Mongo aggregation groups `batch_registry` by `base_batch_id` (`$group` + `$push` of each stage's `batch_id`/`parent_batch_id`/`stage_suffix`/`odoo_sync`), computes `leaves`/`syncStatus`/`mixedSync` per group in Python (bounded to the current page only), and paginates over the *group count* via `$facet` — a flat `skip`/`limit` on raw rows would have split a batch's own stages across pages, which is meaningless for a compliance-relevant view. `GET /vault/ledger` gained `group_skip`/`group_limit`: it still returns the full, unpaginated `rows` list (the Record Movement form's guided next-step logic needs to look up any arbitrary batch's balance regardless of what page the table is on) plus a new paginated `groups`/`total_groups` pair, grouped in Python from the same already-fetched `batch_balances` docs — no extra query, and cheap because that collection is bounded by distinct batch count (same reasoning as the correctness fix above). `GET /vault/movements` and `GET /s6-register` already had working `skip`/`limit`/`total` — only the frontend needed wiring.
- [x] **Frontend wiring (built 2026-07-27) — kept the bespoke `<table>` markup, did not switch to `DataTable`.** Investigating the swap surfaced a real conflict at the time: `DataTable` (see `Invoices.js`) is light-mode only (zero `dark:` classes anywhere in that component or its reference usage) and has no expand/sub-row support, while Batch Registry's and Vault Ledger's tables were dark-mode-aware throughout and relied on the `Fragment`-based expand-to-fetch-detail row for their grouped view. Forcing the swap would have regressed dark mode on two production pages or required extending `DataTable` itself — out of scope for a pagination task. Instead, added one shared component, `Pager` (`components/UI.js`), a pagination footer with the same `pageIndex`/`pageSize`/`total` contract `DataTable` uses, and wired it into all four views (`BatchRegistry.js`, and `VaultLogbook.js`'s ledger table + movement history, `S6Register.js`) on top of their existing table markup. Each view resets its `pagination` state to page 1 (a new object reference, which reliably re-triggers the `load` `useCallback`/`useEffect` pair even when already on page 1) after any action that changes the underlying data, rather than calling `load()` directly — the latter would still close over the pre-update pagination value from the same render.
- [x] **Dark-mode styling removed (2026-07-28).** The production module (`BatchRegistry.js`, `VaultLogbook.js`, `S6Register.js`, `S6Releases.js`, `ProductionGuide.js`, and the `Pager` component) had been built with `dark:` Tailwind classes throughout since Phase 13.0, but the app has no in-app light/dark toggle anywhere and `tailwind.config.js` has no `darkMode` key — so those classes activated purely from the OS/browser's `prefers-color-scheme: dark`, independent of anything the user controls in the portal. Since virtually no other page in the app (`Invoices.js` and the rest of the `DataTable`-based views) carries any `dark:` styling at all, this meant the production pages alone would flip dark for any user whose system was in dark mode, which read as broken/inconsistent rather than intentional. All `dark:` classes were stripped from these six files so the whole app now renders consistently light, matching everywhere else. If dark mode is wanted app-wide in future, it needs a real toggle (`darkMode: 'class'` + a theme context) applied consistently everywhere, not partial `dark:` styling on a subset of pages.

**13.0.10 — Compliance Report Export (S6 / Import Ledger) — Scoped 2026-07-28**

> Anticipated need: a financial-year export of the S6 receiving register and/or the vault movement ledger for compliance reporting, e.g. an annual Schedule 6 submission. This is not a new pattern — Phase 24 (Reports Export and Period Selection) already established SA financial-year selection, `from_date`/`to_date` backend range params, and client-side `xlsx` (SheetJS) export for the commercial reports. This phase applies that exact pattern to the production side rather than inventing a new one.

- [ ] Backend: `s6-register` and `vault/movements` (or a combined "Import Ledger" view) accept `from_date`/`to_date` range params, mirroring `report_routes.py`'s existing convention
- [ ] Frontend: SA financial-year selector + month pills, reusing the component already built for Phase 24, wired to a new "Production" or "Compliance" reports tab
- [ ] Excel export button using the same client-side `xlsx` pattern as the six existing reports — export endpoints return the full range dataset directly (a bounded financial year of data, not "all history"), so no pagination concern applies to exports specifically
- [ ] Gate behind a permission consistent with existing reports (`reports.export` or a new `production.export` — decide based on who should pull compliance exports vs. day-to-day production permissions)

**Definition of Done (13.0 overall)** — code complete 2026-07-24; live checks pending deployment + GACP access:
- [x] Patricia can be onboarded from the Users page, sees only the Production section, and can record a full day's vault movements without typing a single batch ID
- [ ] Every movement is recorded with actor + timestamp and, in live mode, produces a validated Odoo internal transfer (or no-BoM MO for the manicuring round-trip) in the GACP company *(staged mode built; live path unverified until GACP access is confirmed)*
- [x] In staged mode, each movement stores its exact intended Odoo payload; the sync action replays the queue oldest-first and marks each item done/error
- [x] The vault ledger answers "how much of batch X is in the vault right now" — the question the Excel cannot answer
- [x] Zero free-text batch IDs anywhere in the module

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

## Phase 14 — External Ecommerce API

**Goal:** Expose a secure, warehouse-scoped API that allows external systems to read Bassani's product catalogue and real-time stock levels, with three integration modes: a WooCommerce sync mode (portal pushes products and stock to WC; WC fires order webhooks back), a direct REST mode for systems with REST client capability, and a general-purpose **Integration Partner API** for any POS platform whose users are themselves Stores under the existing reseller model — one Sales Agent account per platform, with every connected store an owned customer under it. The first integration target for WooCommerce is Green Clouds Pharmacy's WooCommerce store; the first Integration Partner is Nick's own Cannaverse Production Flutter app (the dispensary POS/management app stores use — see 14.10 below), with the explicit intent that other POS vendors integrate the same way later.  
**Estimate:** 3–4 weeks (WooCommerce + direct REST) + 4–5 weeks (Integration Partner API, 14.10–14.17 — larger than originally scoped once partner governance, sandbox mode, and reliability were factored in; see Notes)  
**Status:** 🔵 Concept — Needs Scoping  
**Completed:** —

### Context

Green Clouds Pharmacy is building a WooCommerce ecommerce site to sell Bassani's products. Bassani controls the Green Clouds warehouse in Odoo — it already exists as a company in the current portal setup. The WP developer is experienced with WooCommerce but not with custom REST API clients or Odoo, and builds primarily with drag-and-drop WooCommerce tooling. The **WooCommerce sync mode** is therefore the recommended path: the portal manages product data directly inside WC via the WC REST API, and WooCommerce fires its native order-created webhook when a purchase is made. This means the WP developer does not need to write custom API code — WooCommerce's built-in features handle the storefront, cart, and checkout entirely.

A **direct REST mode** is documented alongside it for future integrations where the consuming system has its own REST client and does not need WooCommerce.

**Compliance flag — must be resolved before building the WooCommerce/direct-REST order endpoints (14.6, 14.7):** Confirm with Green Clouds whether customers purchasing on the WP site are named patients (requiring a SAHPRA Section 21 Authorisation Letter per order, per medicine) or licensed dispensaries (who manage their own scripts and authorisations). Named patients require the portal to validate a Section 21 Authorisation before creating each `sale.order` in Odoo — this changes the architecture of the order intake endpoint materially. Do not scope or build 14.6 or 14.7 until this is answered in writing. **This flag does not block 14.10–14.13** — Cannaverse stores ordering via the Reseller Link API are themselves Section 21 "Stores" under Bassani's existing Store Onboarding Agreement (the same legal category as every reseller onboarded through the portal today), placing ordinary B2B stock-replenishment orders, not per-patient purchases.

**Why a third mode, not just 14.7/14.8 reused:** the WooCommerce/direct-REST modes were scoped around an anonymous storefront customer — `POST /customers` (14.8) takes just `{email, name}`, auto-creates an Odoo partner, and has no identity verification at all. That's the right amount of friction for a patient checking out on a WordPress site, and the wrong amount for a business partner: no per-store order attribution, no reuse of the existing onboarding/document-signing/admin-review flow, no commission tracking, and — most importantly — email-only matching is not safe for linking a request to an *existing* Bassani customer record (a bad actor claiming to be an established store could otherwise hijack that store's pricing and order history). Cannaverse stores map naturally onto the existing `reseller` role and `customer_ownership` model (see "Reseller model" and "Customer onboarding" in `CLAUDE.md`) — the Reseller Link API's job is to let a store securely attach itself to that existing infrastructure over an API instead of through the portal's own UI.

---

### 14.0 — API Key Management (Super Admin)

Super admin gets a new "External API" section in settings to create and manage external API clients.

- [ ] `api_clients` collection in MongoDB: `{ id, name, description, warehouse_id, key_prefix (first 8 chars for display), key_hash (SHA-256 of full key — raw key never stored), markup_pct, scoped_category_ids (null = all categories), wc_store_url, wc_consumer_key, wc_consumer_secret, active, created_at, last_used_at }`
- [ ] Generate API key: 256-bit `secrets.token_urlsafe(32)`, returned **once** in plaintext on creation (not retrievable again), stored as SHA-256 hash only
- [ ] Key rotation: generates new key, immediately invalidates old one — atomic swap, no window where both are valid
- [ ] Revoke / deactivate client
- [ ] Super Admin → Settings → External API: table of clients showing name, warehouse, last used, active status — with rotate/revoke actions
- [ ] Client detail page: edit markup %, category scope, WC credentials, view key prefix
- [ ] `APIKeyAuth` FastAPI dependency: reads `X-API-Key` header, SHA-256 hashes it, looks up matching active `api_clients` document, resolves `warehouse_id` via `warehouse_context.py` — used on every `/api/external/v1/` endpoint

---

### 14.1 — Product Catalogue Endpoint

Read-only. Scoped to the client's warehouse and optional category restrictions.

- [ ] `GET /api/external/v1/products` — paginated (`?page`, `?per_page`), filterable by `?category_id`
- [ ] Response per product: `{ id, sku, name, description, category_id, category_name, price_ex_vat, price_inc_vat, unit, in_stock, qty_available, image_url }`
- [ ] Pricing: `price_inc_vat` = Odoo list price × `(1 + markup_pct / 100)` × `(1 + vat_rate)`, rounded to 2 decimal places. `price_ex_vat` = Odoo list price × `(1 + markup_pct / 100)`
- [ ] Category scope: if `scoped_category_ids` is set on the client, only products in those categories are returned regardless of what the caller requests
- [ ] `GET /api/external/v1/products/{product_id}` — single product

---

### 14.2 — Category Endpoint

- [ ] `GET /api/external/v1/categories` — list of product categories available to this client (filtered by `scoped_category_ids` if set)
- [ ] Response: `{ id, name, product_count }`

---

### 14.3 — Stock Level Endpoint

Live stock figures from Odoo, warehouse-scoped.

- [ ] `GET /api/external/v1/stock` — `{ product_id, sku, qty_available, in_stock }[]` for all products in scope
- [ ] `GET /api/external/v1/stock/{product_id}` — single product stock
- [ ] `qty_available` comes from `stock.quant` via `qty_available` field, scoped to the client's warehouse location (same as the existing reseller catalogue)

---

### 14.4 — WooCommerce Product Sync (Portal → WooCommerce)

The portal pushes its product catalogue into WooCommerce. The WP developer manages the storefront presentation using standard WC features — no custom code on the WP side.

- [ ] WC credentials (`wc_store_url`, `wc_consumer_key`, `wc_consumer_secret`) stored on `api_clients` document
- [ ] Sync function: for each scoped portal product, call WC REST API — `POST /wp-json/wc/v3/products` on first sync, `PUT .../products/{wc_id}` on subsequent syncs (upsert by SKU = Odoo product reference code)
- [ ] Fields synced to WC: `name`, `description`, `sku`, `regular_price` (= `price_inc_vat` with markup), `categories`, `stock_quantity`, `manage_stock: true`, `stock_status: instock/outofstock`, `images` (R2 image URL if set)
- [ ] `wc_product_map` stored in MongoDB: `{ client_id, portal_product_id, wc_product_id }` — allows updates to target the correct WC product on subsequent syncs without re-scanning by SKU
- [ ] Manual trigger: Super Admin → External API → client detail → "Sync Products Now" button (`POST /api/external/v1/admin/sync-products/{client_id}`)
- [ ] Scheduled sync: Railway cron every 15 minutes — runs the sync function for all active WC-configured clients

---

### 14.5 — Stock Sync (Portal → WooCommerce)

Keeps WooCommerce's stock counts current so products flip to out-of-stock when Odoo has no qty.

- [ ] On the 15-minute scheduled tick (same cron as 14.4): `PUT /wp-json/wc/v3/products/{wc_id}` with `{ stock_quantity, stock_status }` only — not a full product sync
- [ ] Immediate stock push: whenever the portal processes a confirmed delivery or Odoo stock change for a product, trigger an immediate background stock push to all active WC clients whose scope includes that product
- [ ] Stock push always fires as a `BackgroundTask` — never blocks the order confirmation or ticket response

---

### 14.6 — WooCommerce Order Webhook Receiver (WooCommerce → Portal)

WooCommerce POSTs a `order.created` webhook when a customer completes checkout. The portal intakes the order, creates a `sale.order` in Odoo, and kicks off the standard sales ticket pipeline.

- [ ] `POST /api/external/v1/webhooks/woocommerce/{client_id}` — validates `X-WC-Webhook-Signature` header (HMAC-SHA256 of raw payload body using the WC webhook secret); reject with 401 on mismatch
- [ ] Idempotency: store `wc_order_id` in `external_orders` collection on first receipt; return 200 without reprocessing if the same `wc_order_id` arrives again
- [ ] Customer resolution: match WC billing email to a customer token via 14.8; create Odoo partner if none exists
- [ ] Line item mapping: WC product SKU → portal product ID → Odoo product ID (via `wc_product_map`)
- [ ] Create Odoo `sale.order` in the client's warehouse-scoped company (same XML-RPC path as a reseller-placed order)
- [ ] Create a Sales ticket for the order — it enters the standard Sales → Orders → QA/RP → Finance pipeline
- [ ] Email internal sales: "New order received via Green Clouds Pharmacy website" with order summary and ticket link
- [ ] Return HTTP 200 immediately; all processing is `BackgroundTask`
- [ ] ⚠️ **Blocked on compliance scoping** — do not build until named patient vs licensed dispensary question is answered (see Context)

---

### 14.7 — Direct REST Order Creation (Non-WooCommerce)

For integrations where the consuming system calls the portal API directly rather than via WooCommerce webhooks.

- [ ] `POST /api/external/v1/orders` — body: `{ customer_token, line_items[{ product_id, qty }], external_reference, notes }`
- [ ] Same Odoo sale.order creation and Sales ticket pipeline as 14.6
- [ ] Returns `{ order_id, reference, status: "received" }`
- [ ] `GET /api/external/v1/orders/{order_id}` — check intake status
- [ ] ⚠️ **Blocked on compliance scoping** — same constraint as 14.6

---

### 14.8 — Customer Token Management

WP purchasers must map to Odoo partners. The portal manages this mapping; no internal Odoo IDs are exposed externally.

- [ ] `customer_tokens` collection: `{ token (UUID v4), client_id, odoo_partner_id, email, name, created_at }`
- [ ] `POST /api/external/v1/customers` — body: `{ email, name }`. If a token exists for this `client_id` + `email`, return it. Otherwise create an Odoo partner (warehouse-scoped company), store the token, return it
- [ ] `GET /api/external/v1/customers/{token}` — returns `{ token, name, email }` — Odoo partner ID is never returned in the response
- [ ] For the WooCommerce path (14.6): customer token resolution and creation happens automatically inside the webhook receiver — the WP developer does not call this endpoint

---

### 14.9 — Order Status Pushback (Portal → WooCommerce)

Closes the loop: when the portal ticket status changes, push the update back to WooCommerce so the customer's order history on the WP site reflects current fulfilment status.

- [ ] When a Sales ticket linked to a WC order transitions to a key state, call `PUT /wp-json/wc/v3/orders/{wc_order_id}` with updated `status`
- [ ] State mapping: portal `packing` → WC `processing`; portal `dispatched` → WC `completed`; portal `cancelled` → WC `cancelled`
- [ ] `wc_order_id` stored on the `external_orders` document during 14.6 intake, retrieved here via `external_orders.wc_order_id`
- [ ] Always fires as a `BackgroundTask`

---

### 14.10 — Integration Partner Model (Data Model)

**Reframed 2026-08-19 — see Notes.** This is not a Cannaverse-specific feature. Any POS platform that wants to sell Bassani stock through its own stores becomes an **Integration Partner**: one Sales Agent (reseller) account, held by the platform itself, under which every one of the platform's connected stores becomes an owned customer via the existing `customer_ownership` model (7.13) — exactly as if a human sales agent had onboarded and now manages a large portfolio of customers. No new commercial/ledger logic: the existing `resellers` collection, `customer_ownership`, `order_commissions`, and tier-band commission statement engine (Phase 20) already do the job. What's missing is purely the API-driven access layer. Cannaverse is the first Integration Partner onboarded, not a special case in the code — every field and endpoint below is partner-agnostic (`integration_partner_id`, `external_store_ref`), never `cannaverse_*`.

- [ ] `resellers` collection gains `channel: "portal" | "api_partner"` (default `"portal"`) — an `api_partner` reseller is still a normal reseller/Sales Agent everywhere else (commission, statements, `commission_eligible`), just flagged so it's filterable into its own admin view instead of cluttering the human Sales Agents list
- [ ] `api_clients` (from 14.0) gains `integration_partner_id` (→ the partner's `reseller_id`), `client_type: "partner_platform" | "partner_store"`, and `parent_client_id` (set on `partner_store` keys, pointing at the partner's platform-level key) — a credential hierarchy, not a flat list
- [ ] A **platform-level key** (`client_type: partner_platform`) is scoped to catalog reads (14.1–14.3) and the linking endpoints (14.11–14.12) only — it can never place an order directly
- [ ] A **store-level key** (`client_type: partner_store`, issued per 14.12) is scoped to its own linked `odoo_partner_id` only, but every order it places credits commission to the parent `integration_partner_id`'s `reseller_id` — identical to how a human sales agent's customer orders already work

---

### 14.11 — Store Linking: Existing Bassani Account (Lookup + OTP)

For a connecting store that may already have a Bassani account **not** currently owned by this Integration Partner (e.g. a store that ordered from Bassani directly, pre-dating the integration).

- [ ] `POST /api/external/v1/partner/link/lookup` — body: `{ trading_name, registration_number, vat_number, contact_email, contact_phone, external_store_ref }`. Matches Odoo `res.partner` primarily on `vat`/registration number — never on name or email alone, both spoofable. Returns `{ match_found: bool, link_request_id }` only — never the matched partner's name, address, or any other Odoo data back to the calling platform
- [ ] On a match, an OTP is sent to the **contact email/phone already on file on the matched Odoo partner** — never to the address submitted in the lookup call. This is the actual security property: proving control of a channel Bassani already trusts, not one just typed into a form
- [ ] `pending_partner_links` collection: `{ id, integration_partner_id, external_store_ref, odoo_partner_id, otp_hash, otp_expires_at, otp_attempts, verified_at, status: pending_otp/pending_admin_approval/approved/rejected/expired, created_at }`
- [ ] `POST /api/external/v1/partner/link/{link_request_id}/verify-otp` — body: `{ code }`. Rate-limited (`slowapi`, same pattern as existing OTP endpoints), max attempts before the request must restart from lookup. Success moves status to `pending_admin_approval` — verifying the OTP does **not** itself grant a credential; every link still passes through 14.13
- [ ] No match found → `match_found: false`, no OTP flow; the caller falls through to 14.12 (new account)

---

### 14.12 — Store Linking: New Bassani Account (Referral Link Reuse)

For a store with no existing Bassani account. **No new onboarding endpoint needed** — every `api_partner` reseller already has a working self-service referral link from Phase 16.2 (`{origin}/apply?ref={user.id}` — `GET /api/public/referral/{code}` validates it, and submission/approval already auto-links the resulting customer to that reseller). The only gap is correlating the resulting application back to which store, on the platform's side, initiated it — so the platform can flip that store's connection state once approved.

- [ ] `PublicRegistration` (the `/apply` submission model) gains an optional `external_store_ref` field, carried via a query param on the existing referral link: `{origin}/apply?ref={user.id}&partner_ref={external_store_ref}` — stored on the application, no other change to the 5-step self-registration wizard, CIF signing, or admin review queue (Phase 16/17/18 flows are untouched; the connecting store completes the *same* Bassani-hosted onboarding every other new customer does, including their own NDA + Store Onboarding Agreement — confirmed 2026-08-19: an Integration Partner's own vetting of a store never substitutes for Bassani's direct compliance record on that store)
- [ ] The platform opens this URL in an in-app webview — no new UI or signing logic needed on the platform side
- [ ] On `approve_application` for an application carrying `external_store_ref`, the existing approval flow (Odoo customer created, linked to reseller per the referral code) additionally creates an **already-approved** `pending_partner_links` record (skips 14.11's OTP step — identity was already established through document signing) and proceeds straight to 14.13's credential issuance, with `external_store_ref` carried through to the outbound webhook so the platform can match it back to the right store

---

### 14.13 — Admin Approval + Credential Issuance

Every link — via OTP (14.11) or new-account approval (14.12) — passes through one explicit admin step before a store can place an order. Mirrors the existing onboarding review queue rather than a second, differently-shaped approval surface, and is where Bassani retains final control over every store that gets to trade under a partner's umbrella.

- [ ] New admin section — **Integration Partners** (Settings), distinct from the existing Sales Agents list (`channel: api_partner` resellers only) — lists each partner, its connected-store count, monthly order volume, and a drill-down per store; not a tab bolted onto the existing "External API" settings page, since partner management and raw API-key CRUD are different concerns for different audiences
- [ ] Queue of `pending_partner_links` at `pending_admin_approval` within a partner's detail page — store name/ref, matched or newly-created Odoo partner, link method (OTP / new account)
- [ ] `POST /api/external/v1/admin/partner-links/{link_request_id}/approve` — `resellers.manage`-gated. Issues a `partner_store` API key (same `secrets.token_urlsafe(32)` + SHA-256-hash pattern as 14.0), pinned to `odoo_partner_id`, `integration_partner_id`, and `warehouse_id` (resolved from the partner reseller's warehouse). Key returned once, in the approval response — the platform's backend stores it; it must never reach the store's own client app
- [ ] `POST .../reject` — `resellers.manage`-gated, requires a reason; no credential issued
- [ ] Every approve/reject audit-logged (`partner_link.approved` / `partner_link.rejected`), threading `reseller_id` (the partner) per the existing audit convention
- [ ] Outbound signed webhook (`POST` to the partner's registered callback URL, `BackgroundTask`, HMAC-SHA256 — same construction as 14.6's inbound WooCommerce signature) fires on approval/rejection carrying `external_store_ref` so the platform's own backend can flip that store's connection state without polling, then mint/store the credential itself
- [ ] Instant **revoke** action per store-level key and per whole partner (`active: false` on the `api_clients` doc) — independent of the softer key-rotation flow in 14.0, this is the incident-response path: one click, immediate effect, no window

---

### 14.14 — Sandbox Mode

Lets a new Integration Partner build and test against the API without ever touching live Odoo — required if this is going to onboard platforms Bassani doesn't already trust operationally. Reuses the staged-write pattern already proven in the Vault module (`vault_odoo.py`'s `GACP_ODOO_WRITES=off`, 13.0) rather than inventing a second sandbox mechanism.

- [ ] `api_clients.sandbox: bool` (settable on a `partner_platform` key at creation, inherited by every `partner_store` key issued under it)
- [ ] In sandbox mode, 14.13's order-placement path stages the exact intended `sale.order` payload to an `external_orders` doc (`odoo_sync: "staged"`) instead of executing it — mirrors `VaultOdooWriter`'s outbox shape exactly, including a synthetic order id/reference returned to the caller
- [ ] Catalog/stock reads (14.1–14.3) in sandbox mode are read-only against the real catalogue (no reason to fake product data) but tagged in the response so a partner's dev environment can visibly confirm it's in sandbox
- [ ] A sandbox partner cannot be promoted to a live `partner_platform` key by itself — going live is an explicit admin action on the Integration Partners page (14.13), the same trust boundary as approving any other link

---

### 14.15 — Partner-Scoped Order Endpoint

Distinct from 14.7: orders placed here flow through the **real** reseller order path — `order_routes.py`'s existing create/confirm logic, `customer_ownership` (7.13), commission crediting, and the standard Sales → Orders → QA/RP → Finance ticket pipeline — not a bespoke intake shim. A `partner_store` key (from 14.13) identifies its `reseller_id`/`odoo_partner_id` directly, so there is no per-request customer token to resolve.

- [ ] `GET /api/external/v1/products`, `/categories`, `/stock` (14.1–14.3) reused unchanged — already warehouse-scoped, no compliance dependency
- [ ] `POST /api/external/v1/partner-orders` — body: `{ line_items[{ product_id, qty }], external_reference, notes }`. Calls the same order-creation path a reseller placing an order through the portal UI hits, with `current_user` synthesized from the key's pinned `reseller_id` (same synthetic-actor pattern already used by `public_routes.py`'s recurring-order accept endpoint, 8.46)
- [ ] Enforces the existing server-side rule that a reseller may only order for customers linked to their own profile — no new authorization logic, just the existing check applied to an API-originated request
- [ ] `GET /api/external/v1/partner-orders/{order_id}` — status, mapped from the linked ticket's stage (reuses 14.9's state-mapping table)
- [ ] Ticket stage changes push to the partner via the signed webhook mechanism (14.13/14.16), `BackgroundTask`-only, never blocking the portal-side transition
- [ ] Not gated on the Green Clouds compliance flag (see Context) — built and shipped independently of 14.6/14.7. Billing stays exactly as it is for any reseller's customer today: **the store is invoiced and pays Bassani directly** (confirmed 2026-08-19) — the Integration Partner earns commission on the volume but is never a billing counterparty, so no new invoicing/collections logic is needed anywhere in this phase

---

### 14.16 — Partner Governance & Reliability

The pieces that turn 14.10–14.15 from three working endpoints into something Bassani can safely run as a real multi-tenant platform, protecting the single Odoo XML-RPC connection every request ultimately goes through.

- [ ] Per-partner and per-store rate limiting (`slowapi`, keyed by API key rather than IP) on catalog reads and order creation — a runaway or buggy integration must not be able to degrade Odoo for the portal's own staff
- [ ] `webhook_deliveries` collection — every outbound webhook (14.13 link-status, 14.15 order-status, 14.9 WC pushback) logs payload, signature, attempt count, last status, next retry time. Retried with backoff (e.g. 3 attempts); a permanently-failed delivery is surfaced in the partner's admin detail page with a manual **Resend** action — 14.6/14.9/14.13 as scoped are fire-and-forget `BackgroundTask`s with no record, which silently drops order-status updates on any transient outage at the receiving end
- [ ] Sentry error tagging by `integration_partner_id` on every `/api/external/v1/` route, so a broken integration's errors are visibly attributable rather than lost in general noise
- [ ] Integration Partners admin page (14.13) surfaces basic health per partner: `last_used_at` (already in 14.0), request volume, error rate over the last 24h — extends the existing `last_used_at` field rather than a parallel metrics system
- [ ] Global kill switch (`portal_settings._id: "external_api_enabled"`, super-admin only) — pauses **all** external order intake across every partner in one action, standard incident-response tooling for anything writing into Odoo on Bassani's behalf

---

### 14.17 — Partner Integration Agreement

A platform must accept Bassani's terms before it can even request a `partner_platform` key — reuses the existing versioned document-template + hosted e-signing system built for the NDA/Store Onboarding Agreement (Phases 17–19) rather than building anything new.

- [ ] New managed template type: **API Integration Partner Agreement**, versioned the same way as the existing three (`DocumentTemplates.js`, `DocTypeCard`)
- [ ] Signed once per Integration Partner (not per store — stores still sign their own Store Onboarding Agreement individually via 14.12) through the existing `/sign/:token` flow before their `partner_platform` key is issued
- [ ] Countersigned by a Bassani signing authority exactly like every other Bassani-signature-bearing document today — no new signing model

---

### Notes

> **2026-08-19 — Reframed from a Cannaverse-specific "Reseller Link API" to a general Integration Partner model, following a deeper planning conversation with Nick.** Original scoping (single session) treated each connecting store as linking to its own independent Bassani account. Corrected model: an Integration Partner (a POS platform — Cannaverse first, but the architecture is explicitly not Cannaverse-specific, since Bassani intends to onboard other POS platforms later) holds **one** Sales Agent/reseller account, and every store that connects through it becomes one of that reseller's owned customers via the existing `customer_ownership` model — the same mechanism a human sales agent's customer portfolio already uses. This means commission, tier-band statements, and ownership needed zero new logic; only the API access layer (14.10, 14.13, 14.16) is genuinely new. Also discovered the new-account path (14.12) needs no new onboarding endpoint at all — Phase 16.2's existing reseller referral link (`/apply?ref={user.id}`) already does exactly this; the only addition is an `external_store_ref` correlation param so a platform can match an approved application back to its own store record. Three decisions locked in: (1) every connecting store still individually signs Bassani's own NDA + Store Onboarding Agreement regardless of how the partner vetted them — Bassani keeps an independent compliance record on every store, not just on the partner; (2) the store is billed and pays Bassani directly — the Integration Partner earns commission but is never a billing/collections counterparty, so 14.15 needed no new invoicing logic; (3) OTP verification alone is not sufficient trust for the existing-account path — every link, OTP-verified or onboarding-approved, still passes through an explicit admin approval step (14.13) before a credential is issued. Field/endpoint naming was deliberately genericized (`integration_partner_id`, `external_store_ref`, `/partner/...`) rather than `cannaverse_*` — Cannaverse is the first row of data in `resellers`/`api_clients`, not a special code path; being first to integrate is a contractual/sequencing lever with Bassani, not something the platform architecture itself should encode. On the Cannaverse side: the partner-store API key must be held server-side (a Cloud Function proxy, never the Flutter client, since it's a long-lived secret in a distributable app binary) — that function is the natural receiver for the 14.13/14.15/14.16 webhooks, fanned out to store staff via Cannaverse's existing FCM/notification infrastructure. Cannaverse-side entities for this (a supplier-connection record, a supplier-order record) are deliberately separate from the unrelated existing `WholesalerEntity` (an in-app seller with a manually-curated catalog) and `StockRequestEntity` (internal store-to-manager stock requests) — neither models an external supply link.

> **2026-07-06 — Phase scoped following conversations with Nick (product owner) and Green Clouds Pharmacy WP developer.** Developer is experienced with WP/WooCommerce but not REST API client code or Odoo — confirmed preference is the WooCommerce sync route (14.4–14.6) so they can use native WC features for storefront, cart, and checkout without writing custom integration code. Direct REST mode (14.7) documented for future integrations. Green Clouds' warehouse already exists as an Odoo company in the current portal. Compliance flag raised: whether WP purchasers are named patients or licensed dispensaries must be confirmed in writing before 14.6 or 14.7 order intake can be built — this is not an edge case, it is the architectural fork for the order endpoint. Product sync and stock sync (14.4, 14.5) and the catalogue/stock read endpoints (14.1–14.3) have no compliance dependency and can proceed independently.

---

*This document is the single source of truth for the production readiness programme. Update it after every phase completion. Do not start a new phase until the previous phase's Definition of Done is fully checked off.*

---

## Phase 15 — Stock Report

**Goal:** Give operations staff and the BA a dedicated stock report view inside the portal that mirrors what they previously had to open Odoo to see: a product list with current stock quantities, a per-product lot/batch breakdown with expiry dates, and a full movement history (traceability trail) per lot.  
**Estimate:** 1 day  
**Status:** 🟢 Complete  
**Completed:** 2026-07-06

### Context

Bassani uses FIFO costing in Odoo. The BA's primary stock reporting workflow was: Odoo → Inventory → Products → click product → view lots/batches and their stock. This phase removes that dependency — the same data is now accessible directly in the portal. The Products tab retains its per-product inline stock panel for quick reference while managing a product; the Stock Report is the dedicated operational view for batch-level analysis.

The Products tab's existing traceability and stock history sections are not removed — they remain useful inline while editing a product. The Stock Report is the preferred view for batch reporting.

### Odoo models used

| Model | Purpose |
|---|---|
| `stock.quant` | Current physical stock — on-hand, reserved, available per lot × location |
| `stock.lot` | Lot/batch metadata — name, reference, expiry date, receipt date |
| `stock.move.line` | Lot-level movement history — every inbound/outbound event for a batch |
| `stock.location` | Location names and types for movement classification |

### 15.0 — Backend: Stock Report API

- [x] `GET /api/stock-report` — product list with aggregated on-hand, reserved, and available quantities from `stock.quant`; warehouse- and company-scoped; search by product name, ref, or category
- [x] `GET /api/stock-report/{product_id}/lots` — lot/batch breakdown for one product enriched with expiry and receipt dates from `stock.lot`
- [x] `GET /api/stock-report/lots/{lot_id}/movements` — full movement history for a lot from `stock.move.line`, with movement type classification (receipt, delivery, transfer, adjustment, production)
- [x] All endpoints gate on `products.view` permission; all warehouse/company scoping via `warehouse_context.py`

### 15.1 — Frontend: Stock Report View

- [x] Two-level navigation: product list → lot breakdown (back button returns to report)
- [x] Product list: name, ref, category, on-hand, reserved, available, lot count; search bar; click any row to drill in
- [x] Lot breakdown: lot name (monospace), location, on-hand, reserved, available, received date, expiry date; expired lots flagged with warning icon
- [x] Movement history: modal per lot showing full traceability trail with move-type badges (Received, Dispatched, Internal Transfer, Adjustment, etc.) and ± quantity labels
- [x] Nav item: Stock Report under Insights section, `Boxes` icon, `products.view` permission gate

### 15.2 — FIFO Stock Valuation (Deferred)

FIFO valuation per lot via `stock.valuation.layer` is deferred pending confirmation that `lot_id` is populated on that model in the live Odoo instance (it is present in Odoo v17 but requires serial/lot tracking to be enabled on the product's category — ⚠️ the live instance is actually Odoo 19.0, confirmed 2026-08-11; re-verify this field still exists there before relying on it, given `stock.move.reserved_availability` from the same v17 assumption turned out not to). Once confirmed, add:

- [ ] `GET /api/stock-report/lots/{lot_id}/valuation` — FIFO cost layers for a lot: date, quantity received, unit cost, remaining qty, remaining value
- [ ] Valuation summary row in the lot breakdown table: current FIFO value per lot

### Definition of Done

- [x] Admin can navigate to Stock Report, see all products with stock, and search by name/ref/category
- [x] Clicking a product shows its lot/batch breakdown with expiry flags
- [x] Clicking History on any lot shows the full movement trail with move-type labels
- [x] All reads are warehouse-scoped when a warehouse is selected in the top-nav switcher
- [ ] FIFO valuation per lot (15.2 — deferred)

---

## Phase 16 — Self-Service Customer Registration

**Status:** 🟢 Complete — 2026-07-06

**Context:** Bassani stakeholders requested a public-facing registration path so customers can apply directly without staff involvement. This runs alongside (not replacing) the existing staff/reseller-initiated wizard. The admin review queue, Odoo customer creation, and reseller linkage are unchanged — only the intake channel is new.

**What was built:**

**16.0 — Backend public endpoints (`/api/public/...`)**

| Endpoint | Purpose |
|---|---|
| `GET /api/public/referral/{code}` | Validate reseller referral code, return name |
| `GET /api/public/templates` | List template documents (no auth) |
| `GET /api/public/templates/download/{filename}` | Download template PDF (no auth) |
| `POST /api/public/documents/upload` | Upload signed doc to R2 (session-scoped, no auth) |
| `DELETE /api/public/documents/{session_id}/{doc_type}` | Remove uploaded doc |
| `POST /api/public/register` | Submit registration — creates `customer_onboarding` doc with `source: "self_service"` |

Session IDs are validated as UUIDs on all document endpoints to prevent R2 path traversal. File size is capped at 20 MB.

**16.1 — Public registration page (`/apply`)**

Fully standalone, no portal auth required. Branded Bassani Health header. Five steps mirroring the staff wizard (Documents → Business Details → Contact → Address → Additional Info) but with the email-doc-dispatch path removed (staff-only). If a `?ref=` query param is present, the referral code is validated and the applicant sees a "referred by" banner; on submission the application is linked to that reseller. Application summary sidebar appears from step 3. Responsive (works on mobile).

**16.2 — Reseller referral link in onboarding wizard**

Step 0 of the existing CustomerOnboarding wizard gains a "Share self-registration link" card (reseller role only). The link is `{origin}/apply?ref={user.id}`. Resellers copy and send this link to their customers; the resulting application is automatically linked to the reseller on submission and on approval creates the Odoo customer linked to that reseller. The existing email-dispatch and manual-upload paths are unchanged.

**16.3 — Confirmation email to applicant**

`send_registration_confirmation` sends the applicant a confirmation with reference number and expected timeline. `send_onboarding_submitted` updated with `source` parameter so the admin notification correctly labels self-service submissions.

**16.4 — Google Places address autocomplete (2026-07-16)**

The Business Address step (Step 2 on `/apply`, Step 3 in the reseller-initiated wizard) now has a smart address input backed by Google Places API. As the customer types, SA-restricted address predictions appear in a dropdown. Selecting a result auto-populates all five address fields (street, suburb, city, province, postal code) in a single click. All fields remain editable after selection.

Implementation: Google Places API is called server-side (`places_routes.py`) — the API key (`GOOGLE_PLACES_API_KEY` Railway env var) is never exposed to the browser. Two rate-limited public endpoints proxy the autocomplete and details calls. Session tokens group each search+select pair into a single billing transaction. The `AddressAutocomplete` component degrades silently to a plain text input if the API key is not configured. Google's "Powered by Google" attribution is shown in the dropdown per their terms of service.

**16.5 — Adaptive wizard: Business Type dropdown + field validation (2026-07-16)**

Business Type is now a dropdown at the top of Step 0 (Business Details) in the `/apply` wizard. The rest of the step adapts immediately based on the selection: Sole Proprietors see a "Business / Trading Name" label, no Company Registration Number field, and no Trading Name field. All other types (Pharmacy, Dispensary, Wellness Centre, Section 22C Facility, Company (Pty) Ltd, Partnership, Other) require a CIPC registration number. Healthcare Provider and Private Practice removed — Bassani's customer base is businesses purchasing stock, not individual practitioners.

Full format validation added at each step:
- Step 0 (Business Details): Business type required. Company reg required for non-sole-proprietors + CIPC format check (`YYYY/NNNNNN/NN` or `CK...`). VAT format-checked if provided (10 digits, starts with 4).
- Step 1 (Primary Contact): Position required. SA ID required + 13-digit Luhn validation + embedded DOB validity. Email format. SA phone format (`0XXXXXXXXX` or `+27XXXXXXXXX`), applied to alt phone if provided.
- Step 2 (Business Address): Suburb, province, and postal code all required. Postal code validated as exactly 4 digits.

Same Business Type dropdown added to the top of Step 1 (Business Details) in `CustomerOnboarding.js` (reseller-initiated wizard), with identical adaptive field logic. Same format validation applied to Steps 1–3 of that wizard (no SA ID field in the reseller wizard — that only applies to `/apply` signatories).

`validateSAID()` and `validateSAPhone()` defined as module-level helpers in each file.

**Future: reseller self-registration**

Reseller self-registration (`/reseller-apply`) is architecturally similar but requires portal account creation on approval. Descoped from Phase 16 — implement when needed.

**Future: DocuSign**

DocuSign requires a separate service decision and API credentials. The current download-fill-upload flow covers the immediate requirement. DocuSign completion webhooks would replace the manual upload step on this same page when the integration is ready.

### Definition of Done — Phase 16

- [x] `/apply` accessible without portal login, works on mobile
- [x] `?ref=` param validated, referral banner shown, application linked to reseller on submission
- [x] All 5 documents required before form progresses (same gate as staff wizard)
- [x] Application lands in existing admin review queue with `source: "self_service"` tag
- [x] Confirmation email sent to applicant with reference number
- [x] Admin notification email updated to distinguish self-service from reseller submissions
- [x] Reseller referral link shown in CustomerOnboarding wizard step 0 (reseller role only)
- [x] Approval of self-service app creates Odoo customer and reseller link (handled by existing approve endpoint, unchanged)
- [x] Address autocomplete on Business Address step in both `/apply` and reseller-initiated wizard — SA-restricted, all address types, server-side proxy, silent fallback
- [x] Business Type dropdown at top of Step 0 (Business Details) in `/apply` wizard — 8 types, Healthcare Provider and Private Practice removed
- [x] Adaptive form fields — Sole Proprietor hides Company Reg, Trading Name, relabels Company Name
- [x] Full field validation — SA ID (Luhn), SA phone format, VAT format, reg number format, postal code 4 digits, suburb/province required
- [x] Same adaptive business type + validation applied to reseller-initiated `CustomerOnboarding.js` wizard

---

## Phase 17 — Document Template Management

**Status:** 🟢 Complete — 2026-07-07

**Goal:** Super admin can upload, version, and activate the four Bassani-issued onboarding template documents directly from the portal. Three are single PDFs (NDA, Store Onboarding Agreement, Customer Information Form). The Welcome Pack consists of four independently managed document slots (Help Me Budget, Welcome Letter, Price List, Product Brochure) — each with its own version history and rollback, so any one can be updated without affecting the others. Once uploaded, the active version is served immediately — no redeployment required.

### Motivation

The four Bassani-issued onboarding documents were previously static files baked into the Docker image. Updating them required a code change and redeployment. This created three problems:

1. Bassani's legal team could not update agreements without developer involvement.
2. Signed copies referenced a particular document version, but there was no way to prove which version a customer signed against.
3. Any future in-portal e-signing feature requires knowing where in the PDF the signature fields sit — this must be stored in the PDF itself (AcroForm fields), which means the portal needs to manage the PDF, not just serve a static file.

### What Was Built

**Backend — `backend/routes/doc_template_routes.py`**

Four doc types managed: `store_onboarding_agreement`, `customer_information_form`, `nda`, `welcome_pack`. `welcome_pack` is flagged `is_slots: True` in `DOC_TYPES` with four named slots: `budget`, `letter`, `price_list`, `brochure`.

| Endpoint | Auth | Description |
|---|---|---|
| `GET /api/doc-templates/` | admin | List all four doc types; welcome_pack returns `is_slots: true` and `slots[]` with active version per slot |
| `GET /api/doc-templates/{doc_type}/history` | admin | All versions for a single-file doc type, newest first |
| `POST /api/doc-templates/{doc_type}/upload` | super_admin | Upload new single-file PDF version (rejects `welcome_pack`) |
| `GET /api/doc-templates/welcome_pack/slots` | admin | List all four slots with their active versions |
| `POST /api/doc-templates/welcome_pack/{slot}/upload` | super_admin | Upload new version for one slot only; deactivates only that slot's previous versions |
| `GET /api/doc-templates/welcome_pack/{slot}/history` | admin | Version history for one slot |
| `POST /api/doc-templates/welcome_pack/{slot}/activate/{version_id}` | super_admin | Roll back one slot to a specific version |
| `GET /api/doc-templates/welcome_pack/{slot}/download` | admin | Download active file for a slot |
| `GET /api/doc-templates/welcome_pack/{slot}/download/{version_id}` | admin | Download specific version for a slot |
| `POST /api/doc-templates/{doc_type}/activate/{version_id}` | super_admin | Roll back single-file doc type to a specific archived version |
| `GET /api/doc-templates/{doc_type}/download` | admin | Download active single-file version (rejects `welcome_pack`) |
| `GET /api/doc-templates/{doc_type}/download/{version_id}` | admin | Download specific single-file version |

Shared helpers: `get_active_template_bytes(doc_type)` for single-file types; `get_active_bundle_files(doc_type)` for the welcome pack — iterates all four slots, returns `list[{filename, label, content_type, data: bytes}]` for every slot that has an active version.

**Backward-compatible download migration**

`FILENAME_TO_DOC_TYPE` reverse map allows the existing public endpoints (`/api/public/templates/download/nda.pdf` and `/api/onboarding/templates/download/nda.pdf`) to resolve the doc type, check R2, and fall back to the static file. No frontend changes needed for callers that already used the filename-based endpoints.

**MongoDB collection — `doc_templates`**

Single-file fields: `doc_type`, `version`, `label`, `filename`, `r2_key`, `file_size`, `uploaded_at`, `uploaded_by_id`, `uploaded_by_name`, `is_active`, `notes`.

Welcome pack slot fields: same + `slot` field (one of `budget`, `letter`, `price_list`, `brochure`), `content_type`. R2 key pattern: `doc-templates/welcome_pack/{slot}/v{version}/{filename}`. Activating one slot version deactivates only other versions of that same slot — other slots are unaffected.

Versions are never deleted. Only the `is_active` flag changes on upload or rollback.

**Frontend — `frontend/src/views/DocumentTemplates.js`**

- Three single-file PDF cards use `DocTypeCard` — unchanged UX
- Welcome Pack uses `WelcomePackSlotsCard` — switched on `template.is_slots` from the API
- `WelcomePackSlotsCard`: renders four `SlotCard` components, one per slot; shows "all uploaded" or "{n} missing" badge at the card header
- `SlotCard`: shows active version per slot with upload date, uploader, size, and release note; per-slot upload modal with `accept` attribute set to that slot's allowed formats; expandable `SlotVersionHistory`
- `SlotVersionHistory`: version table with filename, date, uploader, size, activate/download per row; activate only affects that slot
- Amber warning per slot when no version has been uploaded for it
- Upload and activate gated to super admin (`settings.manage` permission)

**Audit trail**

Every upload (`doc_template.uploaded`) and activation (`doc_template.activated`) writes an audit log entry with actor, version number, file size, and release notes.

**E-signing preparation note**

The blue info panel in the view instructs super_admin to embed AcroForm fields (signature, name, date, company) in PDFs using Adobe Acrobat or LibreOffice before enabling e-signing. Because field positions are stored in the PDF itself, they update automatically when a new version is uploaded — no hardcoded coordinates in the portal code.

### Sub-deploys

#### 17.0 — Backend: doc_template_routes + R2 storage (complete 2026-07-07)

- [x] `doc_template_routes.py` created with all six endpoints
- [x] `get_active_template_bytes()` shared helper
- [x] `FILENAME_TO_DOC_TYPE` reverse map
- [x] Router registered in `server.py`
- [x] All upload and activate actions audit logged

#### 17.1 — Backward-compatible download migration (complete 2026-07-07)

- [x] `public_routes.py` `download_public_template` checks R2 first, falls back to static file
- [x] `onboarding_routes.py` `download_template` checks R2 first, falls back to static file
- [x] No changes to existing callers required

#### 17.2 — Frontend: DocumentTemplates view (complete 2026-07-07)

- [x] `DocumentTemplates.js` created with 4 doc type cards
- [x] Active version details (date, uploader, size, release note)
- [x] Upload modal with PDF picker and release notes field
- [x] Version history accordion per card
- [x] Rollback button on each archived version row
- [x] Super admin info panel: AcroForm preparation guidance for future e-signing

#### 17.3 — App wiring (complete 2026-07-07)

- [x] Route added to `App.js` at `/doc-templates`, `adminOnly`
- [x] Nav item added to `ADMIN_NAV` in `UI.js`, `superAdminOnly: true`

#### 17.4 — Signing Authority (complete 2026-07-07)

The Document Templates page gained a second tab: **Signing Authority**. Super admin configures the CEO signatory profile once — name, title, signing location, and a signature image. This profile is automatically embedded into Bassani's signing block on every co-signed onboarding document when a customer signs, so the CEO never has to actively participate per document. The date on both signing blocks is set to the day the customer signs.

**Two capture methods for the signature image:**
- **Upload photo/scan** — sign on paper with a pen, photograph or scan it, upload the image. A client-side background removal pass (luminance threshold, adjustable sensitivity slider) strips the white background so the signature sits cleanly on documents without a white box. Works best with good contrast.
- **Draw in app** — HTML5 canvas with mouse/touch support. Functional on desktop and mobile. The upload method produces a higher quality result.

**Preview before saving:** A document mockup shows exactly how the signature, name, title, location, and date will appear embedded in a signed document, before committing.

**Backend — `signing_authority_routes.py`:**
- `GET /api/signing-authority/` — returns current profile metadata
- `POST /api/signing-authority/` — save/replace (form fields + optional file or base64 drawn PNG); signature stored in R2 at `signing-authority/signature.png`
- `GET /api/signing-authority/signature` — stream signature image for preview and PDF embedding
- Every save is audit logged

**Frontend:** Embedded as the second tab of the Document Templates page. No separate nav item.

- [x] Super admin can upload a new PDF version from the portal — no redeployment required
- [x] Uploaded version is immediately served to any download endpoint (public and onboarding)
- [x] Previous version is archived in R2 and can be downloaded or restored at any time
- [x] Every upload and rollback is audit logged with actor, version, file size, and notes
- [x] Existing filename-based download endpoints (`/api/public/templates/download/nda.pdf`) continue to work unchanged
- [x] Static file fallback is in place — sites without any managed version still serve the baked-in file
- [x] View is accessible to all admins for read/download; upload and rollback gated to super_admin only
- [x] Version numbering is sequential and auto-incremented (v1, v2, v3…)

### Signing Authority Definition of Done

- [x] Super admin can set name, title, and signing location
- [x] Signature captured via photo upload or in-app canvas draw
- [x] White background removal with adjustable sensitivity for uploaded photos
- [x] Live document preview before saving
- [x] Signature stored securely in R2; no other staff can view or retrieve it
- [x] Replace flow available at any time — existing signed copies in storage are unaffected
- [x] Every save is audit logged with actor and change summary
- [x] Embedded in Document Templates page as second tab — no additional nav item

#### 17.5 — Test Signing Flow (complete 2026-07-07)

Super admin can preview the exact signing experience a customer will see for any document, directly from the Document Templates page. A **Test signing flow** button appears on each document card (super admin only, requires an active version to be uploaded).

Clicking the button opens a full-screen modal with:
- **Left panel** — live PDF preview of the document
- **Right panel** — pre-filled form with realistic dummy data and a signature canvas

The form is grouped by section and pre-populated with test defaults matching the document's field layout:

| Document | Sections |
|---|---|
| NDA | Company details, Contact details |
| Customer Information Form | Business details, Contact details, Business address |
| TQA | Company details, Contact details |
| Store Onboarding Agreement | Business details, Signatory details, Signature block, Other |

For co-signed documents (NDA, TQA, Store Onboarding Agreement), the Bassani signing block is auto-filled from the configured Signing Authority profile — name, title/position, and both dates embedded automatically. The admin can draw a test customer signature on the canvas.

Clicking **Download signed test PDF** runs the full pdf-lib generation pipeline client-side: all form fields are filled, signature images are embedded in the correct field positions (aspect-ratio-preserving, centred), the form is flattened, and a "TEST DOCUMENT - NOT FOR USE" watermark is applied. The result is a real PDF that looks exactly like what the customer will receive.

**Technical notes:**
- All field type detection is name-based (not constructor-name-based) because pdf-lib class names are minified in production builds
- Per-document config (`DOC_CONFIGS` in `DocumentTemplates.js`) declares sections, field labels, test defaults, auto-fill rules, and whether a Bassani co-signer is required — making the modal fully data-driven and reusable for all four documents
- Signature image drawn to field bounds using `Math.min(scaleX, scaleY)` to preserve aspect ratio

- [x] Test signing flow button on each document card (super admin, active version required)
- [x] Full-screen modal: PDF preview left, grouped form right
- [x] Form pre-populated with per-document test defaults
- [x] Bassani auto-fill card: shows signing authority name/title; amber warning if not configured
- [x] Customer signature canvas with mouse and touch support
- [x] Generated PDF matches the real customer output exactly
- [x] All four documents configured with correct field mappings and section groupings

#### 17.6 — Welcome Pack slot-based management (complete 2026-07-14)

The Welcome Pack consists of four separately maintained documents (Help Me Budget, Welcome Letter, Price List, Product Brochure). This sub-deploy implements slot-based management so each file has its own independent version history — updating the price list does not require re-uploading the brochure or any other file.

**Backend:**
- `welcome_pack` flagged `is_slots: True` in `DOC_TYPES`; `SLOT_DOC_TYPES` set guards all single-file endpoints
- `WELCOME_PACK_SLOTS` list defines four slots: `budget` (Excel), `letter` (PDF), `price_list` (PDF/Excel), `brochure` (PDF)
- `POST /api/doc-templates/welcome_pack/{slot}/upload` — uploads one file to one slot; validates extension against `slot.accepts`; deactivates only that slot's previous versions; R2 key `doc-templates/welcome_pack/{slot}/v{n}/{filename}`; audit-logged
- `GET /api/doc-templates/welcome_pack/slots` — lists all four slots with their active version metadata
- `GET /api/doc-templates/welcome_pack/{slot}/history` — version history per slot
- `POST /api/doc-templates/welcome_pack/{slot}/activate/{version_id}` — per-slot rollback
- `GET /api/doc-templates/welcome_pack/{slot}/download[/{version_id}]` — download active or specific version for a slot
- `get_active_bundle_files("welcome_pack")` — iterates all four slots; returns `[{filename, label, content_type, data}]` for every slot that has an active version
- `send_welcome_pack` in `onboarding_routes.py` calls `get_active_bundle_files()` — attaches the active file from each uploaded slot to the email
- `list_doc_templates()` returns `is_slots: true` and `slots[]` array for the welcome pack

**Frontend:**
- `WelcomePackSlotsCard` renders for `template.is_slots === true` — teal Package icon, "all uploaded" or "{n} missing" header badge
- `SlotCard` per slot: active version badge, meta grid (date / uploader / size), download button, per-slot upload modal with correct `accept` attribute, expandable `SlotVersionHistory`
- `SlotVersionHistory`: version table with filename, date, uploader, size, activate/download per row
- Field reference modal unchanged — three PDFs only (welcome pack slots are non-signed)

- [x] `doc_template_routes.py` rewritten — slot endpoints, `is_slots` flag, `WELCOME_PACK_SLOTS` + `WELCOME_PACK_SLOT_MAP` constants
- [x] `onboarding_routes.py` `send-welcome-pack` uses `get_active_bundle_files()` — unchanged call, updated implementation iterates slots
- [x] `DocumentTemplates.js` `WelcomePackSlotsCard` + `SlotCard` + `SlotVersionHistory` implemented; renders on `template.is_slots`

---

## Phase 18 — In-Portal Customer Document Signing

**Status:** 🟢 Complete

**Goal:** Replace the current "download, print, sign, scan, upload" step in the customer self-service apply flow with an in-portal signing experience. The customer fills in their business and contact details in the wizard, the portal pre-fills all four onboarding documents with their data, the customer draws their signature once per document, and completed signed PDFs are generated and stored against their application automatically — ready for admin review without any manual document handling.

### Motivation

The current Step 5 of the `/apply` wizard asks the customer to:
1. Download each of the four blank template PDFs
2. Print, sign by hand, scan or photograph
3. Upload each signed copy back to the portal

This process creates friction, causes drop-off, and produces inconsistent document quality (hand-filled forms, photo scans, missing fields). All the data needed to fill the documents is already captured in Steps 1–4 of the wizard. Phase 18 closes the loop: that data pre-fills the PDFs, the customer just draws their signature and clicks confirm.

Phase 17 (document template management, test signing flow, signing authority) is the complete prerequisite for this phase. The PDF field maps and generation pipeline already exist.

### Field Mapping — Wizard Data to PDF Fields

All wizard fields are in the `PublicRegistration` model (`backend/routes/public_routes.py`).

**NDA**

| PDF field | Wizard field |
|---|---|
| `company_name_1` | `company_name` |
| `company_address` | `street + suburb + city + province + postal_code` |
| `company_reg_number` | `registration_number` |
| `customer_company_name` | `company_name` |
| `customer_name` | `contact_name` |
| `customer_position` | `contact_position` |
| `customer_location` | `city` |
| `effective_date_es_:date`, `customer_date_es_:date`, `bassani_date_es_:signer:date` | Today's date (auto) |
| `bassani_position` | Signing authority title (auto) |

**Customer Information Form**

| PDF field | Wizard field |
|---|---|
| `business_name` | `trading_name` (fall back to `company_name`) |
| `company_name` | `company_name` |
| `company_reg_number` | `registration_number` |
| `vat_number` | `vat_number` |
| `full_name` | `contact_name` |
| `position` | `contact_position` |
| `phone_number` | `contact_phone` |
| `email_address` | `contact_email` |
| `alt_phone` | `contact_alt_phone` |
| `street_address` | `street` |
| `suburb` | `suburb` |
| `city` | `city` |
| `province` | `province` |
| `postal_code` | `postal_code` |
| `date_day/month/year` | Today's date split (auto) |

**TQA**

| PDF field | Wizard field |
|---|---|
| `company_name` | `company_name` |
| `company_reg_number` | `registration_number` |
| `customer_name` | `contact_name` |
| `customer_designation` | `contact_position` |
| `bassani_name` | Signing authority name (auto) |
| `bassani_date_es_:date`, `customer_date_es_:date` | Today's date (auto) |

**Store Onboarding Agreement**

| PDF field | Wizard field |
|---|---|
| `registered_business_name` | `company_name` |
| `tradingin_name` | `trading_name` |
| `company_reg_number` | `registration_number` |
| `vat_reg_number` | `vat_number` |
| `registered_business_address` | `street + suburb + city + province + postal_code` |
| `collection_point_address` | `street + suburb + city + province + postal_code` (editable, defaults to registered address) |
| `signatory_full_name` | `contact_name` |
| `signatory_id_number` | `signatory_id_number` (**new field — see 18.0**) |
| `signatory_title` | `contact_position` |
| `primary_contact_number` | `contact_phone` |
| `primary_email_address` | `contact_email` |
| `store_signed_at` | `city` |
| `store_full_name` | `contact_name` |
| `store_capacity` | `contact_position` |
| `store_witness_name` | Customer-entered at signing time |
| `assigned_reseller_code` | Blank — admin fills on approval |
| `bassani_date_es_:signer:date`, `store_date_es_:signer:date` | Today's date (auto) |

### Sub-deploys

#### 18.0 — Add `signatory_id_number` to wizard (Complete)

The Store Onboarding Agreement requires the signatory's SA ID number. Added to:
- `PublicRegistration` model in `public_routes.py` as `signatory_id_number: Optional[str] = ""`
- Step 1 (Primary Contact) of the `/apply` wizard in `PublicRegister.js` — field sits between Full Name and Position
- `BLANK` form state initialised to `""`

#### 18.1 — In-portal signing component (Complete)

`DOC_CONFIGS`, `detectFields`, and `generateTestPdf` extracted from `DocumentTemplates.js` to a shared module `frontend/src/utils/pdfSigning.js`. New exports added:
- `buildPrefill(docType, form)` — maps wizard form state to PDF AcroForm field names for all four documents
- `generateSignedPdf(pdfBytes, options)` — refactored generator; accepts `mikeImageBytes` explicitly rather than fetching internally; `addWatermark` flag controls test vs real output

`CustomerSigningModal` built in `PublicRegister.js`:
- Loads PDF from `/api/public/templates/download/{filename}` (no auth)
- Detects fields via `detectFields`
- Pre-fills form from `buildPrefill` — customer only edits genuinely unknown fields (e.g. `store_witness_name`)
- Fetches `GET /api/public/signing-authority-meta` for Bassani name/title auto-fill; signature image not embedded (countersigned on approval — see 18.4)
- Same split-panel layout as `TestSigningModal` (PDF preview left, form + canvas right); right panel goes full-width on mobile

New public endpoint `GET /api/public/signing-authority-meta` returns `{ name, title }` only — intentionally omits the signature image which remains authenticated-only.

#### 18.2 — Replace document-first step of the apply wizard (Complete)

Wizard step order rewritten from `Documents → Business → Contact → Address → Info` to `Business Details → Primary Contact → Business Address → Additional Info → Sign Documents`. Data collection is front-loaded so documents can be pre-filled from it.

New Step 4 (Sign Documents):
- Four in-portal signing cards — one per document; each opens `CustomerSigningModal` on click
- CIPC certificate kept as a traditional file upload (government document, cannot be pre-filled)
- Submit button disabled until all four documents signed and CIPC uploaded

#### 18.3 — Upload signed PDFs to R2 (Complete)

Each `CustomerSigningModal` generates the signed PDF client-side via `generateSignedPdf` and immediately uploads it to R2 via `POST /api/public/documents/upload?session_id={id}&doc_type={type}`. The response `{ doc_type, r2_key, filename, … }` is stored in the parent's `uploads` state and submitted as `documents[]` on application submission. No backend changes required — the existing `REQUIRED_DOC_TYPES` map already covers all four signed documents.

#### 18.4 — Application countersigning and approval gate (Complete)

When a customer signs documents in-portal, the three documents that have a Bassani signature field (NDA, TQA, Store Onboarding Agreement) must be countersigned by the designated signing authority holder before the application can be approved.

**What was built:**

- `signed_in_portal: true` flag added to public upload endpoint (`POST /api/public/documents/upload?signed_in_portal=true`) and stored per-document in MongoDB.
- `BASSANI_SIG_DOC_TYPES = {"nda", "tqa", "store_onboarding_agreement"}` constant added to `onboarding_routes.py` — these are the three docs with a Bassani sig field. `customer_information_form` has no Bassani field and does not require countersigning.
- `POST /api/onboarding/{app_id}/countersign/{doc_type}` — accepts the countersigned PDF blob, stores it at `onboarding/sessions/{session_id}/{doc_type}-countersigned.pdf` in R2, and writes `countersigned_at`, `countersigned_by`, `countersigned_r2_key` to the document record. Requires `customers.approve_onboarding` permission. Audit-logged.
- `PUT /api/onboarding/{app_id}/approve` — hardened with a pre-flight check: if any `signed_in_portal` document in `BASSANI_SIG_DOC_TYPES` is missing `countersigned_at`, approval is blocked with a 400 listing the missing documents. Inbox-sourced applications (manual upload path) bypass this gate.
- `GET /api/signing-authority/am-i-holder` — lightweight endpoint any admin can call; returns `{"is_holder": bool}` by comparing the current user's ID to `updated_by_id` in the signing authority record. Used to gate the Countersign button.
- `GET /api/signing-authority/signature` — relaxed from super_admin-only to super_admin OR holder, so the signing authority can fetch their own image for the countersign flow.
- `countersignPdf(customerPdfBytes, blankTemplateBytes, docType, sigBytes)` added to `frontend/src/utils/pdfSigning.js`. Detects Bassani's signature field rect from the blank template (AcroForm intact), then draws the sig image at those coordinates on the already-flattened customer PDF using pdf-lib. No server-side PDF stack required.
- `CustomerApplicationDetail.js` fully updated:
  - Docs state lifted from `DocumentsCard` to the parent and passed to both `DocumentsCard` and `ActionsCard`.
  - `GET /api/signing-authority/am-i-holder` fetched on mount.
  - `DocumentsCard` shows per-document badges: "Signed in portal" (blue), "Countersigned by [name]" (green), or "Awaiting countersignature" (amber). The "Countersign" action button is shown only when `isHolder && signed_in_portal && !countersigned_at`.
  - `CountersignModal` — split-panel layout matching the customer signing flow: customer-signed PDF in an iframe (left), signature panel (right). Loads customer PDF bytes, blank template, and stored signature in parallel. Supports stored signature or drawn-on-canvas new signature. Calls `countersignPdf` client-side and uploads the result.
  - `ActionsCard` "Approve and Create Customer" button is disabled when any portal-signed Bassani-sig doc is uncountersigned, with an explanatory amber warning.

**Legacy applications:** any application whose documents do not have `signed_in_portal: true` (manually uploaded or inbox-sourced) bypasses the countersign gate entirely — approve works as before.

### Definition of Done

- [x] `signatory_id_number` captured in wizard and stored in application
- [x] `CustomerSigningModal` component built for all four documents
- [x] PDF generation pipeline extracted to `pdfSigning.js` shared between admin test and customer flow
- [x] `/apply` wizard reordered — data collection first, signing last (Step 4)
- [x] Pre-fill logic maps wizard data to PDF fields with no manual entry required for known fields
- [x] Bassani name and title auto-filled from public signing meta endpoint; signature countersigned on approval
- [x] Signed PDFs uploaded to R2 and attached to the application
- [x] Admin review queue shows "Signed in portal" badge and "Awaiting countersignature" status per document
- [x] Signing authority holder can countersign all three Bassani-sig documents in-browser via CountersignModal
- [x] Approve gate blocks until all portal-signed Bassani-sig docs are countersigned
- [x] All four documents can be signed in a single session before submission

---

## Phase 19 — My Profile & Multi-Authority Signing

**Goal:** Move from a single global signing authority to per-user signatures. Any staff member with the `signing_authority.sign` permission can configure their own signature on their profile and countersign applications independently. Application self-assignment prevents dual countersigning.  
**Status:** 🟢 Complete  
**Completed:** 19.0–19.4 — 2026-07-08

### Context

Previously a single "signing authority" profile (name, title, signature image) was stored globally in MongoDB. Only one person was designated as the countersignatory at a time. As the business scales, multiple authorised people (e.g. QA Manager, Responsible Pharmacist) need to countersign without requiring admin reconfiguration.

### 19.0 — Per-User Signature Storage

- [x] New `signing_authority.sign` permission added to all permission dicts in `auth.py`; defaults `True` for `qa_manager` and `responsible_pharmacist`, `False` for all others
- [x] Signature images now stored per user in R2 at `user-signatures/{user_id}.png`
- [x] `signing_name` and `signing_title` fields added to user documents (optional; set from My Profile)
- [x] `/api/signing-authority/signature` updated to serve the current user's own signature (falls back to legacy global image for backwards compatibility)
- [x] `am_i_holder` endpoint updated — now checks `signing_authority.sign` permission directly, not a global holder_user_id

### 19.1 — Profile Routes

- [x] New `backend/routes/profile_routes.py` registered in `server.py`
  - `GET /api/profile/` — current user's profile (name, email, role, signing fields, has_signature)
  - `PUT /api/profile/` — update name, signing_name, signing_title
  - `POST /api/profile/signature` — upload or draw signature (requires `signing_authority.sign`)
  - `GET /api/profile/signature` — serve own signature image
  - `DELETE /api/profile/signature` — remove own signature

### 19.2 — My Profile Page

- [x] New `/profile` route accessible to all authenticated users (admin and reseller)
- [x] Profile avatar button (user initial) added to `TopBar` — visible on every page, navigates to `/profile`
- [x] `MyProfile.js` view: personal info (name, email read-only, username read-only), password change, signature management section (only visible if `signing_authority.sign`)
- [x] Signing name and signing title fields for signing authorities — these autofill the Bassani signatory block on PDFs

### 19.3 — Application Assignment (Soft Claim)

- [x] `PUT /api/onboarding/{app_id}/assign` — toggle claim for the current user
  - Calling again when already claimed by self releases the claim
  - Claiming when assigned to someone else transfers the claim (with a browser confirmation prompt)
  - Only users with `signing_authority.sign` can assign
- [x] `assigned_to: { user_id, name, assigned_at }` stored on the application document; cleared on countersign completion
- [x] Assignment chip shown in the applications list (`CustomerApplications.js`) under the status badge
- [x] Assignment card shown in the `CustomerApplicationDetail.js` sidebar for signing authority users — Claim / Release button

### 19.4 — Permission & UI Wiring

- [x] `signing_authority` group added to `PERMISSION_GROUPS` in `Users.js` — visible in the permissions editor
- [x] `DEFAULT_ADMIN_PERMS` and `ROLE_DEFAULT_PERMS` updated to include `signing_authority.sign`
- [x] `CustomerApplicationDetail.js` — `am_i_holder` API call removed; replaced with `can("signing_authority.sign")`
- [x] Countersign flow now fetches signature from `/api/profile/signature` (own signature), not the global endpoint
- [x] `DocumentTemplates.js` test-signing modal now fetches signing profile from `/api/profile/` and maps `signing_name`/`signing_title` to the `name`/`title` shape expected by `generateSignedPdf`
- [x] `settings.manage` permission description updated — no longer covers signing authority (that is now `signing_authority.sign`)

### Definition of Done

- [x] Any user with `signing_authority.sign` can upload or draw their own signature on their profile
- [x] Countersign flow uses the acting user's own signature, not a shared global one
- [x] Multiple signing authorities can countersign different applications simultaneously
- [x] Application claim/release prevents accidental dual countersigning with a soft-lock and browser confirmation
- [x] `qa_manager` and `responsible_pharmacist` roles have `signing_authority.sign = True` by default
- [x] Profile avatar visible in the top bar on every page for all users
- [x] All authenticated users (admin and reseller) can access `/profile` and change their password

---

## Phase 20 — Sales Agent Accounts & Commission Eligibility

**Goal:** Rename "resellers" to "sales agents" throughout the portal UI and introduce a `commission_eligible` flag on agent accounts, so internal Bassani staff can hold sales agent accounts (managing a portfolio of customers) without appearing in commission statements or seeing the commission section.  
**Status:** 🟢 Complete  
**Completed:** 20.0–20.3 — 2026-07-08

### Context

Bassani plans to assign internal staff accounts with the `reseller` role so they can manage a defined portfolio of customers through the portal. These internal agents will not participate in the commission programme. Previously, all reseller-role accounts were assumed to be external, commission-earning agents. This phase:

- Renames the UI label from "Resellers" to "Sales Agents" everywhere user-facing (nav, page titles, modals, toasts)
- Introduces a boolean `commission_eligible` field (default `true`) on both the `resellers` collection document and the linked `users` document
- Gates commission nav visibility, statement generation, and the `/commission` route on this flag

No external-facing API breaking changes — existing resellers without the field default to `commission_eligible: true`.

### 20.0 — Backend: Model and Data Changes

- [x] `ResellerCreate` model: `commission_eligible: bool = True` added; `odoo_partner_id` changed from required `int` to `Optional[int] = None`
- [x] `ResellerUpdate` model: `commission_eligible: Optional[bool] = None` added
- [x] `create_reseller`: validates Odoo partner only when `commission_eligible=True`; uniqueness check for `odoo_partner_id` skipped when `None`; `commission_eligible` written to both `user_doc` and `reseller_doc`
- [x] `update_reseller`: after updating resellers collection, syncs `commission_eligible` to the linked user document (`users` collection, matched by `reseller_id`) so JWT picks it up on next login
- [x] `_user_payload` in `auth_routes.py`: `"commission_eligible": bool(user.get("commission_eligible", True))` added — exposed in JWT and `/me` response

### 20.1 — Backend: Commission Statement Filtering

- [x] `generate_statements` in `commission_routes.py`: when no specific `reseller_id` is targeted, fetches eligible IDs from the `resellers` collection (`commission_eligible != false` and `active != false`) and filters the aggregated rows before generating statements
- [x] Agents with `commission_eligible: false` are silently excluded from bulk statement runs; targeted single-agent runs (for admin review / correction) are unaffected
- [x] **2026-07-21 fix:** `confirm_order` in `order_routes.py` now checks `commission_eligible` at order confirmation time before creating the `order_commissions` record. Previously the check only happened at statement generation time, meaning toggling the flag off retroactively excluded all past orders from statements. Now the cut-off is at the moment of confirmation: orders confirmed while eligible produce a commission record; orders confirmed after the flag is toggled off produce no record. Past `order_commissions` records for orders confirmed while eligible are untouched and included in statements normally.

### 20.2 — Frontend: Nav and Sidebar

- [x] `UI.js` NAV: "Resellers" entry renamed to "Sales Agents"
- [x] `UI.js` RESELLER_NAV: Commission item marked `requiresCommission: true`
- [x] Sidebar filter: items with `requiresCommission: true` are hidden when `user?.commission_eligible === false`

### 20.3 — Frontend: Sales Agent CRUD and Commission Guard

- [x] `Views.js` Resellers component: all user-facing text updated — page title "Sales Agents", add button "Add Sales Agent", modal titles "Add Sales Agent" / "Edit Sales Agent", toasts "Sales agent created" / "Sales agent updated"
- [x] `BLANK_FORM` and `editForm` default state: `commission_eligible: true` added
- [x] `openEdit`: populates `commission_eligible` from reseller data (`r.commission_eligible !== false`)
- [x] Add wizard Step 1 renamed "Odoo Partner": commission_eligible checkbox at top; Odoo partner search shown for commission-eligible agents; for non-eligible agents, neither partner search nor any document upload is shown; Next button validates partner selection only for commission-eligible agents
- [x] Document upload removed entirely from the Add wizard — onboarding documents belong to the Customer Applications flow. If a customer does not yet exist in Odoo, the admin completes their onboarding via Customer Applications first, then returns to create the sales agent
- [x] "No partners found" empty state in the Odoo partner dropdown displays a clear hint: complete the customer's onboarding via Customer Applications first, then return to create the agent
- [x] Edit modal: commission_eligible checkbox added; Odoo vendor profile section + banking section conditional on `editForm.commission_eligible`
- [x] `ResellerCommissionView`: renders a "Commission not applicable" screen when `user?.commission_eligible === false`, replacing the data-loading flow

### Definition of Done

- [x] Internal staff accounts (reseller role, `commission_eligible: false`) can be created without an Odoo vendor partner
- [x] Non-eligible agents do not appear in bulk commission statement generation
- [x] Toggling `commission_eligible` off only affects orders confirmed after the change — past orders retain their commission records and appear in statements for the months they were placed
- [x] Commission nav item hidden for non-eligible agents; navigating to `/commission` directly shows "not applicable" screen
- [x] Odoo partner step in the Add wizard is shown only for commission-eligible agents; document upload is not part of the wizard at all (documents belong to Customer Applications)
- [x] Banking details section in Edit modal hidden for non-eligible agents
- [x] Existing resellers without the `commission_eligible` field default to `true` — no data migration required
- [x] Admin-targeted single-agent commission statement generation is not affected by the eligibility filter

---

## Phase 21 — Customer Data Model Hardening

**Goal:** Bring the customer data model into alignment with Odoo's actual contact hierarchy — Company vs Individual, bill-to vs contact person, and contact person management — so the portal correctly reflects how Bassani's customer accounts are structured.  
**Status:** 🟢 Complete  
**Completed:** 21.0–21.5 — 2026-07-09

### Context

Several gaps existed between how the portal presented customer data and how Odoo's `res.partner` model actually works. Orders were being placed against individual contact persons rather than their parent companies, the customer listing used a fragile regex against the Odoo `comment` field to derive contact type, and the customer profile had no way to add contact persons or change the Company/Individual classification. A production crash was also discovered where the contacts read was requesting `mobile` — a field that does not exist on `res.partner` in this Odoo instance.

### 21.0 — Customer Profile Crash Fix

- [x] `mobile` removed from contact person read (`customer_routes.py` line 268) — field does not exist on `res.partner` in this Odoo instance; was crashing all customer profile page loads
- [x] `mobile` removed from `ADDRESS_FIELDS` for the same reason
- [x] "Mobile" column removed from the contacts table in `CustomerProfile.js`

### 21.1 — Customer Listing: True Odoo Type and Business Category

- [x] `is_company` added to `CUSTOMER_FIELDS` in `customer_routes.py`
- [x] Customers listing "Type" column now reads directly from Odoo's `is_company` field — shows "Company" or "Individual" for all customers, not just portal-onboarded ones
- [x] Comment-parsed business category (Pharmacy / Retail etc.) moved to a separate "Category" column — shown for portal-onboarded customers; "—" for Odoo-native customers where the comment format was not written by the portal

### 21.2 — Sales Ticket: Bill-to Display and Contact Person Model

- [x] `is_company` added to ticket creation partner read in `ticket_routes.py`; stored as `customer_is_company` on the ticket document
- [x] Lazy backfill extended to populate `customer_is_company` on existing tickets on first view
- [x] "Link to company" button suppressed for company-type contacts (was incorrectly shown for companies who have no parent to link to)
- [x] Sales ticket customer info panel restructured: when the ticket's customer is an individual linked to a company, the panel now shows "Bill to" (company name, linked to account profile) and "Contact person" (individual name + email) instead of the ambiguous "Contact at X" label
- [x] TopBar title on sales ticket detail leads with the company name when the customer is a contact linked to a company

### 21.3 — Order Creation: Commercial Partner Resolution

- [x] `effective_partner_id` in `order_routes.py` is now resolved to `commercial_partner_id` before the Odoo `sale.order` is created — if the selected customer is an individual linked to a company, the order and invoice are raised against the company (the account holder), not the contact person
- [x] Standalone individuals (no parent company) are unaffected — `commercial_partner_id` equals self for top-level partners

### 21.4 — Customer Profile: Add Contact Persons

- [x] `POST /api/customers/{id}/contacts` endpoint added — validates parent is a company (400 if not), creates `res.partner` in Odoo with `parent_id` set and `type = "contact"`. Fields: name (required), job title (`function`), email, phone
- [x] Contacts section in `CustomerProfile.js` now only renders for company-type customers
- [x] "Add contact" button visible to admins with `customers.manage`; opens modal with name, job title, email, phone fields
- [x] Empty state shown when no contacts exist ("No contacts on file") so the section and button are always visible for companies
- [x] Profile refreshed on successful add so the new contact appears immediately

### 21.5 — Customer Profile: Type Display and Editing

- [x] `PATCH /api/customers/{id}/type` endpoint — reads current `is_company`, blocks Company→Individual conversion if child contacts exist (400), writes `is_company` to Odoo, audit-logs the before/after state
- [x] Customer profile header shows "Company" / "Individual" type badge immediately below the customer name for all viewers
- [x] Admins with `customers.manage` see the badge as a dropdown — changing to Company applies immediately; changing to Individual shows a confirmation modal explaining implications before applying
- [x] Individual → Company: no confirmation required (safe operation)
- [x] Company → Individual: confirmation modal + backend guard blocks conversion if child contacts exist

### Definition of Done

- [x] Customer profile page loads for any customer (including those with contacts) — mobile field crash resolved
- [x] Customer listing Type column shows Company/Individual for all 120+ customers, not just portal-onboarded ones
- [x] Sales tickets for contact persons show the billing company as the primary account, not the individual name
- [x] New orders created via the portal are raised against the commercial partner (company) in Odoo
- [x] Admins can add contact persons to company profiles from the portal — no Odoo access required
- [x] Admins can change Company/Individual classification directly from the profile — audit-logged
- [x] Converting a company with child contacts to Individual is blocked with a clear error message

---

## Phase 22 — Automated Bank Reconciliation

**Goal:** Finance never manually confirms a payment after Bassani's bank statement is in the system. EFT receipts import into the portal, credits are auto-matched to open invoices, and the portal detects the match and automatically advances the linked ticket — eliminating the daily reconciliation bottleneck and the risk of manual mis-confirmation.  
**Priority:** High  
**Status:** ✅ Complete  
**Completed:** 2026-07-09

### Context

Odoo holds all financial records (`account.move`, `account.payment`). Bank statements in Odoo are `account.bank.statement` objects with child `account.bank.statement.line` records. Odoo's automated reconciliation models match statement lines to open invoices by amount, date, and payment reference. Once matched, the invoice's `payment_state` transitions to `in_payment` or `paid`.

The portal already reads `payment_state` on Finance's "Confirm Payment" action. This phase makes that reading automatic: a background task polls invoice payment states and advances tickets when Odoo confirms payment, without Finance triggering it. The bank statement import UI brings statements into Odoo without Finance opening Odoo directly.

**Why this is high priority:** The current Finance flow — download bank statement → open Odoo → locate invoice → register payment → return to portal → click "Confirm Payment" — is the single most time-consuming manual step per order. At volume this is a daily bottleneck and a source of confirmation errors. Auto-detection eliminates it once statements are imported.

**Odoo prerequisite (Bassani configuration — no portal code needed):**
- Create a bank journal in Odoo for the EFT account: type Bank, currency ZAR
- Configure at least one reconciliation model under Accounting > Configuration > Reconciliation Models (match by amount + SA EFT reference patterns)
- Note the journal `id` from Odoo — used as default in the import endpoint

### Tasks

#### 22.0 — Permission and Navigation Foundation
- [x] `finance.bank_reconciliation` added to `auth.py`: `True` for `finance` role and `FULL_PERMISSIONS`; `False` for all other roles and `DEFAULT_ADMIN_PERMISSIONS`
- [x] "Bank Reconciliation" added to `ADMIN_NAV` in `UI.js` under Finance section, gated on `finance.bank_reconciliation`, icon `Landmark`
- [x] Route `/finance/bank-recon` in `App.js` as `adminOnly`, rendering `BankReconciliation.js`

#### 22.1 — Auto-Payment Detection (Background Task)
- [x] `backend/services/bank_recon_service.py` — `check_invoice_payments()`: batch-reads Odoo `payment_state` for all open tickets with `invoice_id` set; stamps `payment_confirmed_by: "auto"` on any where Odoo shows `paid` or `in_payment`; digest email to `finance_notification_to` routing addresses; returns `{checked, confirmed}`
- [x] `server.py` startup event: asyncio loop calling `check_invoice_payments()` every 15 minutes; graceful Odoo-down handling
- [x] `SalesTickets.js`: "Auto-confirmed from bank" shown when `payment_confirmed_by === "auto"` (two locations: reseller view + sidebar)
- [x] `finance_notification_to` added to email routing config (`settings_routes.py`, `EmailSettings.js`)
- [x] `send_payment_auto_confirmed` digest email added to `email_service.py`

#### 22.2 — Bank Statement Import
- [x] `POST /api/finance/bank-statements/import` — CSV upload, auto-format detection, auto-match credits to open invoices, save statement + lines to MongoDB; returns `{statement_id, lines_imported, auto_matched}`
- [x] `GET /api/finance/bank-statements/` — list statements from MongoDB, most recent first
- [x] `GET /api/finance/bank-statements/{statement_id}/lines` — lines for a statement with match metadata
- [x] `GET /api/finance/bank-journals` — Odoo bank/cash journals for journal selector

#### 22.3 — Manual Reconciliation
- [x] `POST /api/finance/bank-statements/lines/{line_id}/match` — confirms match, registers Odoo payment via `account.payment.register` + `action_create_payments`; updates line to `manually_matched`; refreshes statement counts
- [x] `GET /api/finance/invoices/open` — open invoices for manual match typeahead
- [x] `POST /api/finance/bank-statements/lines/{line_id}/exclude` — portal-level flag, reason stored in MongoDB; does not touch Odoo
- [x] `POST /api/finance/bank-statements/lines/{line_id}/unmatch` — resets to `unmatched` (does not reverse Odoo payment)

#### 22.4 — Bank Reconciliation Dashboard
- [x] `frontend/src/views/BankReconciliation.js`:
  - Statements dashboard with "Import Statement" button, summary cards (total credits, matched, unmatched, excluded), statements table
  - Import modal: journal selector + CSV file picker; detects FNB/Nedbank format; shows auto-match result on success
  - Line review: filter pills (All/Unmatched/Auto-matched/Confirmed/Excluded); per-line actions (Match, Exclude, Reset); confidence dot on auto-matched lines
  - Match modal: invoice search typeahead, journal selector, confirm registers Odoo payment
  - Exclude modal with optional reason
  - Reset confirmation modal (warns Odoo payment is not reversed)

#### 22.5 — SA Bank CSV Format Support
- [x] FNB Business CSV parser: columns `Date, Transaction Type, Reference, Amount, Running Balance`; credits only (positive Amount); date format `DD MMM YYYY`
- [x] Nedbank Business CSV parser: columns `Date, Reference, Description, Debit, Credit, Balance`; Credit column only; date formats `YYYY-MM-DD`, `DD/MM/YYYY`, `YYYY/MM/DD`
- [x] Auto-detect by header inspection; `HTTPException(400)` if unrecognised with supported format list
- [x] Deduplication: `(date, reference, amount)` key checked against existing MongoDB lines; duplicate lines skipped with clear error if entire file is a duplicate

### Implementation notes
- Statement data is stored in MongoDB (`bank_statements`, `bank_statement_lines`) rather than as Odoo `account.bank.statement` records. This avoids unreliable XML-RPC calls into Odoo's bank statement API in v17 and keeps the portal in control of the UX. Payment registration still goes through Odoo via `account.payment.register` — Odoo stays the financial source of truth.
- Auto-match scores: exact amount match = 60pts; within 1% = 40pts; invoice name in reference = 40pts; customer name words = up to 20pts. Threshold 40pts to show a suggestion; 80pts = high confidence, 50pts = medium, anything lower = low.
- "Reset" does not reverse the Odoo payment if one was registered — Finance must handle reversals in Odoo directly. The portal line is reset to unmatched, leaving the Odoo payment intact.

### Definition of Done
- [x] Finance uploads a CSV bank statement; credits are auto-matched to open invoices; Finance reviews and confirms matches from the portal
- [x] Confirming a match registers the payment in Odoo — Finance does not open Odoo
- [x] Bank charges and transfers can be excluded from the unmatched list with an optional reason
- [x] Auto-confirmed tickets (22.1) show "Auto-confirmed from bank" — not a named user
- [x] Background payment check runs every 15 minutes
- [x] FNB Business and Nedbank Business CSV formats both import correctly
- [x] Duplicate lines are skipped on import

---

## Phase 23 — Operations Monitor

**Goal:** A live, read-only big-screen display that gives operations staff an at-a-glance view of the full order pipeline, highlighting orders approaching the 72-hour fulfilment deadline so the team can prioritise without manually reviewing the ticket list.  
**Priority:** Medium  
**Status:** ✅ Complete  
**Completed:** 2026-07-15

### Context

Orders should progress from confirmation to dispatch within 72 hours. Before this phase, the only way to identify aging orders was to open the ticket list and mentally scan. At volume this is error-prone. The monitor is designed to run on a dedicated TV or screen in the office — no login, public URL with a rotating token.

Sales quotes (unconfirmed) have a softer 48-hour alerting window to flag quotes that have stalled.

### Tasks

#### 23.0 — Monitor Backend

- [x] `backend/routes/monitor_routes.py` — new router at `/api/monitor`
- [x] `GET /api/monitor/token` (admin): retrieve current token + rotated_at
- [x] `POST /api/monitor/token` (admin): generate/rotate token via `secrets.token_urlsafe(32)`; stored in `portal_settings._id: "monitor_display_token"`
- [x] `GET /api/monitor/validate?token=` (public): 200 or 403
- [x] `GET /api/monitor/data?token=` (public): full KPIs + column card sets — no Odoo calls, all MongoDB
- [x] Age tiers: ok (0–33%), warning (33–66%), urgent (66–100%), overdue (>100%) — all relative to 72h deadline (48h for quotes)
- [x] KPIs: overdue, at_risk, in_pipeline, completed_today, units_today, open_quotes, avg_time_hours, pipeline_value, revenue_today, mtd_revenue
- [x] Columns: quotes (open/quote status), packing (queued/packing), qa (ready + no qa_approved_at), rp (ready + qa_approved_at set), collection (ready_for_collection) — **deposit column added 2026-08-04, see follow-up note below**
- [x] order_value stamped on packing board entry at confirm_order from Odoo `amount_total`
- [x] order_value added to `BoardEntry` Pydantic model as `Optional[float]`
- [x] monitor_router registered in `server.py`

#### 23.1 — Monitor Frontend

- [x] `frontend/src/views/OrderMonitor.js` — full-screen dark theme TV display
  - Token read from `?token=` URL param; validated on mount against `GET /api/monitor/validate`
  - 30-second polling of `GET /api/monitor/data`; 1-second `setInterval` for live countdown badges
  - KPI strip Row 1: Overdue / At Risk / Compliance Hold / Completed Today (all columns counted, no financials)
  - KPI strip Row 2: Open Inquiries / Awaiting Deposit / In Packing / QA Pending / RP Pending / Awaiting Collection / Oldest Active (Awaiting Deposit added 2026-08-04)
  - Kanban columns: Open Quotes (indigo) · Awaiting Deposit (gold, added 2026-08-04) · Packing (violet) · QA Review (cyan) · RP Review (teal) · Ready to Collect (amber)
  - Cards sorted oldest-first within each column (most urgent at top)
  - Age tier colour coding: ok=green, warning=amber, urgent=orange, overdue=red+animate-pulse
  - RESELLER and SAMPLE pill tags on cards; reseller name in card footer
  - Live countdown badge recomputes from `clock_start` + `deadline_hours` client-side every second
  - LIVE/OFFLINE indicator in header
- [x] `frontend/src/views/MonitorSettings.js` — Settings tab for token management
  - Generate URL (first-time), copy to clipboard, rotate token (with confirmation modal)
  - Rotation warning: all screens must update to new URL
- [x] `{ key: "monitor-display", label: "Monitor Display" }` tab added to `Settings.js`
- [x] `<Route path="/monitor" element={<OrderMonitor />} />` added to `App.js` (public, outside `ProtectedRoute`)

### Definition of Done

- [x] `/monitor?token=...` loads without login and shows live Kanban columns + KPIs
- [x] Invalid or missing token shows a clear error screen
- [x] Cards are sorted oldest-first within each column (highest-priority at top)
- [x] Age tier colours update live as time passes (1-second client-side recompute)
- [x] Overdue count KPI pulses red when non-zero
- [x] Admin can generate, view, copy, and rotate the display URL from Settings → Monitor Display
- [x] Rotating the token invalidates the old URL immediately

**Follow-up fix (2026-08-04) — the deposit gate (8.47) created an invisible pipeline stage on this board.** 8.47 (reinstated 2026-07-29, after this phase originally shipped) inserted `awaiting_deposit` between `sale_order` and packing-board creation — a packing board entry now only gets created once Finance registers the deposit, not at order confirmation. `monitor_routes.py`'s Quotes-column query (`status in ["open", "quote", "sale_order"]`) was never updated for the new status, and there's no packing board entry yet at this stage either — so a confirmed order sitting on the deposit gate matched **no column at all** and simply vanished from the board between confirmation and deposit registration, despite this being a real bottleneck stage staff specifically wanted visibility into.

- [x] `monitor_routes.py` — new query for `status: "awaiting_deposit"` tickets, reusing `_ticket_card()` (added `"awaiting_deposit": OVERDUE_HOURS` to `_QUOTE_STATUS_DEADLINE` — treated as the 72h "confirmed order" deadline, not the softer 48h quote deadline, since the customer has already committed at this point)
- [x] New `deposit` column (key `deposit`, gold accent `#eab308`) inserted between Quotes and Packing, matching pipeline order; included in the `all_active` roll-up so it automatically feeds the existing Overdue/At Risk Row-1 KPIs with no separate change needed there
- [x] New `awaiting_deposit` KPI added to Row 2, between Open Inquiries and In Packing
- **Design decision:** a dedicated column, not folded into Open Quotes — matches the existing precedent of QA Review and RP Review already being split into two columns rather than one combined "Compliance" column, specifically so each distinct role's action queue (here: Finance) stays unambiguous at a glance on a screen nobody is meant to interact with, only read from across a room.

---

## Phase 24 — Named Patient & Section 21 Compliance Archive (Cannati)

**Goal:** Give Bassani a durable, structured, read-only compliance archive of named-patient Section 21 applications and scripts originating from Cannati (a store on the Cannaverse platform that Bassani itself operates), closing the "Named Patient → Script → SAHPRA Section 21 Authorisation" gap at the end of the batch traceability chain (Phase 13) that the existing `s21script` flat-string check was already flagged as too thin to satisfy.  
**Estimate:** 2 weeks  
**Status:** 🔵 Concept — Needs Scoping  
**Completed:** —  
**Depends on:** Phase 14.10–14.13 (Cannati must exist as a linked, credentialed store under the Integration Partner model before it can push anything)

### Context

Cannati is a store Nick is building on the Cannaverse platform, registered and operated by Bassani, used for patients to work through the Section 21 process (doctor consultation → clinical assessment → submission to CuraScript, a separate third party Cannaverse already has a paid referral relationship with for the actual SAHPRA processing → outcome → script). Cannati buys its dispensing stock from Bassani like any other connected store (Phase 14). Bassani wants a copy of the patient/application/script data this generates.

**Why, precisely, matters for the design:** Bassani doesn't sell to the patient — it sells to Cannati. Its own Store Onboarding Agreement (Section 10.3) treats its own order records as the legal proof of lawful supply to a Store, with a volume mismatch treated as prima facie evidence of illicit sourcing. This phase isn't a patient CRM for Bassani — it's the evidentiary record that lets Bassani show, if ever asked, that the stock volume it supplied Cannati is backed by genuine named-patient Section 21 authorisations. That framing drives three structural decisions:

1. **One-way archive, not a second source of truth.** Cannaverse owns the clinical workflow (doctor review, CuraScript submission, status transitions) end to end. Bassani receives a mirror of key checkpoints; nothing here is ever edited from the Bassani side, and no field pushed here is ever fed back into Cannaverse.
2. **MongoDB only — no Odoo writes.** Per the existing architecture principle (financial records in Odoo, portal-layer/non-financial data in MongoDB), and because Bassani's actual Odoo customer is Cannati (the store), not the patient — creating a `res.partner` per patient would misrepresent the commercial relationship and pollute Odoo with non-buying contacts. This is a genuine departure from the existing individual (natural-person) self-registration pattern (8.50, which *does* create a `res.partner`) — that pattern is for a patient buying directly from Bassani, which is not this case.
3. **Auth reuses the Phase 14 store link, with an extra scope bit.** Cannati is just one connected store under the Cannaverse Integration Partner. No other integrating store should be able to push clinical data by default — only the one store Bassani directly operates and trusts for this purpose.

---

### 24.0 — Data Model & Storage

- [ ] Three new MongoDB collections, mirroring Cannaverse's own entity shapes closely enough that no lossy re-modelling happens in transit: `external_patients`, `external_s21_applications`, `external_scripts` — each keyed by `external_id` (Cannaverse's own document id) + `integration_partner_id` + `external_store_ref` (same generic fields introduced in Phase 14, not Cannati-specific names)
- [ ] `external_patients`: name, contact details, ID/passport number, linked `external_store_ref` — no Odoo partner created, ever
- [ ] `external_s21_applications`: mirrors the clinically-relevant fields of `Section21ApplicationEntity` (diagnosis/ICD-11 code, clinical justification, recommended medicine/strength/dosage/quantity, `sahpraReferenceNumber`, status, key timestamps) plus `bassani_certificate_r2_key` — Bassani fetches and stores its own copy of the SAHPRA certificate and signed patient consent PDF in Cloudflare R2 on ingest (already an approved service, same as onboarding documents), rather than keeping only a reference into Cannaverse's storage — the audit trail must not depend on Cannaverse's storage remaining available years later during a regulator inquiry
- [ ] `external_scripts`: mirrors `ScriptEntity` — script number, line items (product/dosage/quantity/dispensing period/repeat count), issue/expiry dates, status
- [ ] All three collections are upserted by `external_id` on every push — never appended as a new row per update

---

### 24.1 — Auth: Clinical Intake Scope

- [ ] `api_clients` (Phase 14.10) gains `clinical_intake_enabled: bool` (default `false`) — settable only by a Bassani super admin on a specific `partner_store` key's detail page, not something a connecting platform can self-enable. Cannati's key is the first (and for now, only) one with this flag set
- [ ] New Bassani permission `clinical_data.view` — gates the new admin surface (24.5); granted to `responsible_pharmacist`, `qa_manager`, and `admin`/`super_admin` roles. Not granted to `sales`, `orders_clerk`, `finance`, `reseller`, or `vault_custodian` — no compliance reason for those roles to see patient health data
- [ ] `POST /api/external/v1/clinical/*` endpoints (24.2–24.4) require both a valid `partner_store` key **and** `clinical_intake_enabled: true` on that key — a 403, not a silent no-op, if a store without the flag attempts to call these

---

### 24.2 — Patient Intake Endpoint

- [ ] `POST /api/external/v1/clinical/patients` — upserts one `external_patients` record. Fired once, on patient creation at Cannati (registration is the only event here — patients don't have a workflow state machine the way applications and scripts do)

---

### 24.3 — Section 21 Application Intake Endpoint

- [ ] `POST /api/external/v1/clinical/s21-applications` — upserts one `external_s21_applications` record. Fired only at the checkpoints that matter for the compliance record, not on every `Section21ApplicationStatus` transition: **doctor-approved, submitted-to-SAHPRA, approved, rejected**. Intermediate workflow noise (consultation booked, changes requested, patient uploading) is deliberately not pushed — Bassani's archive is for outcomes, not Cannaverse's internal workflow history
- [ ] On a push carrying a `certificateUrl` or `patientConsentSignatureUrl`, the endpoint fetches the file server-side and stores it in R2, recording the resulting key on the archive record (`BackgroundTask` — never blocks the response to Cannaverse)

---

### 24.4 — Script Intake Endpoint

- [ ] `POST /api/external/v1/clinical/scripts` — upserts one `external_scripts` record. Fired on issuance, renewal, and cancellation (`ScriptStatus` transitions to `active`/`renewed`/`cancelled`) — not on every field edit

---

### 24.5 — Compliance Archive Admin View

- [ ] New read-only admin page (`clinical_data.view`-gated) — searchable by patient name/ID, store, or date range; shows the S21 application and any linked script(s) for a patient, with a direct link to view the stored certificate/consent PDF from Bassani's own R2 copy
- [ ] No edit actions anywhere on this page — if a correction is needed, it happens in Cannaverse and re-pushes on the next checkpoint, consistent with the one-way-archive principle in the Context above
- [ ] Deliberately does **not** attempt automated volume reconciliation against Odoo `sale.order` data in this phase — that (matching supplied stock volume against valid authorisations) is a meaningful follow-on feature but a separate body of work; this phase only gets the raw compliance data into Bassani's hands

---

### 24.6 — Retention Policy (Flagged, Not Built)

- [ ] Not scoped in this phase, but flagged so it isn't forgotten: the Store Onboarding Agreement's existing 5-year retention figure for dispensing records is the likely precedent for this collection too, but health data (POPIA "special personal information") may carry its own retention/minimisation obligations distinct from ordinary dispensing records — confirm with Nick/compliance before this archive has been live long enough for it to matter, and before building any deletion job

---

### Definition of Done

- [ ] Cannati can push a patient, an S21 application at each of its four compliance checkpoints, and a script, and each lands correctly in the corresponding Bassani collection with the certificate/consent documents copied into Bassani's own R2
- [ ] A store without `clinical_intake_enabled` gets a clear 403 attempting any `/clinical/*` endpoint
- [ ] `responsible_pharmacist`, `qa_manager`, and `admin` can view the archive; `sales`, `orders_clerk`, `finance`, and `reseller` cannot
- [ ] No Odoo writes occur anywhere in this phase
- [ ] Re-pushing the same `external_id` updates the existing record rather than creating a duplicate

### Notes

> **2026-08-19 — Phase scoped following a planning conversation with Nick about Cannati, a Bassani-operated store on the Cannaverse platform used for Section 21 patient workflows.** Reframed from "sync patient data" to "one-way compliance archive" once the actual motivation became clear: Bassani's audit exposure is about proving supplied stock volume is backed by genuine named-patient authorisations (Store Onboarding Agreement §10.3), not about needing a patient relationship-management system. This directly closes a gap the roadmap already flagged under Phase 8 hardening — the existing `s21script` check is a flat string; this gives Bassani the actual structured SAHPRA-shaped data Cannaverse already collects. Three decisions locked in: (1) Bassani stores its own copy of certificates/consent documents in R2 rather than only a reference URL, so the audit trail doesn't depend on Cannaverse's storage remaining available indefinitely; (2) only key compliance checkpoints push, not every workflow status change, keeping the archive focused on outcomes; (3) access is broader than just the responsible pharmacist — RP, QA, and admin all get visibility, not RP alone. Deliberately did not create Odoo `res.partner` records per patient — Bassani's Odoo customer is Cannati, not the patient, and the existing individual self-registration pattern (8.50) is for a different relationship (patient buying directly from Bassani) that doesn't apply here. Auth reuses Phase 14's `partner_store` credential rather than a separate credential system, with one new scope bit (`clinical_intake_enabled`) that only Cannati has — every other Integration Partner's connected stores get none of this by default. Automated reconciliation against Odoo supply volume was considered and explicitly deferred — this phase is the data pipe, not the audit tool.

---

## Phase 25 — Customer Self-Service Portal Accounts & WhatsApp Bot API

**Goal:** Let an existing Bassani customer log into the portal directly — to view/download their own invoices, track their own orders, update their own contact/delivery details, and place their own orders through the real sales pipeline — and expose an API that a WhatsApp chatbot (ManyChat or equivalent) can call to identify the customer, browse the catalogue, build and submit an order request, and deliver a generated quotation, without the bot ever being able to directly create a financial transaction itself.  
**Estimate:** 2–3 weeks  
**Status:** 🟡 In Progress — 25.0/25.1 (customer role + self-service portal UI) complete; 25.2–25.6 (WhatsApp Bot API) still Concept — Needs Scoping  
**Completed:** 25.0, 25.1 — 2026-08-21

### Context

Today, customers are Odoo partners, not portal users — only staff and resellers can log in. Bassani's requirements for the bot (2026-08-19) turned out to map almost entirely onto workflow the portal already runs — this phase is mostly about exposing an API surface onto existing infrastructure, not building new business logic:

| Bassani requirement | How it's met |
|---|---|
| Automatically identify existing customers | 25.2/25.3 lookup, matched against the Odoo partner phone on file |
| Identify the correct company/store for an order | 25.4 — same "one contact, multiple branches" pattern already handled in onboarding (see `CLAUDE.md`'s "Same contact, multiple branches" note) |
| Access to the current product catalogue | 25.3 — reuses the Phase 14.1–14.3 read endpoints, scoped to whichever company was identified |
| Facilitate the ordering process | 25.3 — bot builds a draft request conversationally; submitting it creates a Sales Ticket at `inquiry`/`quote` stage exactly like a staff-created one, tagged `channel: whatsapp` |
| Receive completed order documentation | The submitted draft request itself — no separate document-upload mechanism needed |
| Deliver generated quotations to customers | 25.3 — reuses the existing quote-PDF generation (8.54, `sale.report_saleorder`) once staff (or the existing pricing logic, where no negotiation is needed) issues the quote |
| Capture quotation approval | **Still the magic link, not a chat reply** — see below |
| Pass customer actions back to the ERP | Handled entirely by the existing order-confirm pipeline once the magic link is used — the bot never calls it directly |
| Facilitate repeat/recurring-order requests | 25.5 — the existing recurring-order accept/decline flow (8.46, `/recurring/{token}`) already does this; WhatsApp just becomes an additional delivery channel for that link |
| Access to selected account services | 25.3 — invoices, order status, detail-change requests |
| Route sales/support/complaint requests to the right team | 25.6 — extends the existing `EmailRoutingConfig` pattern (`portal_settings.email_routing`) with new WhatsApp-sourced routing keys |

**The one point that needed a decision rather than a mapping:** "capture quotation approval" could mean the bot processes a chat reply like "yes" as the approval. Confirmed 2026-08-19 this is explicitly **not** the design — the bot's job stops at generating and delivering the magic link; the customer's tap on that link (landing them in the authenticated portal, 2FA and all) is what actually captures approval and passes it to the ERP. Everything upstream of that — identifying the customer, browsing the catalogue, building the request, receiving the quote — can genuinely happen inside WhatsApp. The commitment step can't. This is the same boundary as every other money-adjacent action in Phases 14/24/25: the bot facilitates, it never authorises.

This is conceptually the reseller model applied to a single company: a `customer` role is a "reseller" whose only linked account is its own company (potentially shared by several logins, one per contact), ordering into the exact same Sales → Orders → QA/RP → Finance pipeline everything else already flows through. See 25.0 for why it ended up company-level rather than a single pinned partner.

---

### 25.0 — Customer Role & Permission Model ✅ Complete (2026-08-21)

Rescoped and built 2026-08-21 once the real requirement was confirmed: **not** a single-partner pin, but a company-level model matching how Bassani's customers are actually structured (a company can have several contacts, each of whom may need their own login; individuals are a single partner). The WhatsApp-bot-driven pinned-partner sketch below has been replaced by this shipped design; 25.2–25.6 (WhatsApp bot) now build on top of it rather than defining their own activation/account model.

- [x] New role `customer` in `auth.py`'s `ALL_ROLES` — kept outside `require_permission`'s gate entirely, same as `reseller` (access is hand-checked per-route on role, not the staff permissions object)
- [x] **Company-level sharing, not a single pinned partner:** `users` gains `odoo_partner_id` (the specific Odoo contact this login is, or the individual's own partner id) and `customer_company_partner_id` (the commercial/company partner every order, invoice, and stock view is scoped to). Multiple logins under one company share the same order/invoice history — two contacts at the same pharmacy see and can act on the same orders
- [x] **Provisioning is opt-in and admin-initiated**, not automatic at onboarding approval. New `customers.manage_portal_access` permission (off by default for every role including `sales`, which already has `customers.manage`) gates a dedicated "Enable Portal Access" flow on the customer profile page: for a business, **always includes the company's own record as a candidate row** (labelled "Company account" — many customers only ever have an email/phone on the company itself, no separate contact ever split out in Odoo) alongside every Odoo child contact, each with its provisioning status (not provisioned / active / deactivated); the admin can select/deselect the company account and/or any contact, revisitable any time; for an individual, one enable/disable toggle on the partner itself (fixed 2026-08-21 — the first version only ever offered child contacts and blocked entirely with no path forward when a company had none, which is common)
- [x] `GET/POST /api/customers/{customer_id}/portal-access` (+ `/{contact_id}/deactivate`, `/reactivate`) in `customer_routes.py` — bulk-enable is idempotent, rejects contacts with no email (invite delivery depends on it), never touches the underlying Odoo contact on deactivate
- [x] Provisioning reuses the existing self-service password-reset token mechanism (`create_password_reset_token()`, extracted from `auth_routes.py::forgot_password` into a shared helper) rather than a new invite/token system — a newly granted login gets a random never-surfaced password plus an emailed set-password link
- [x] Commission: **zero new code required.** `customer_ownership`-based crediting at order-confirm time (`order_routes.py::confirm_order`, `get_owning_reseller_id`) was already independent of who placed the order, so a customer self-ordering against their own linked company account credits the linked reseller exactly as before. A `customer`-role user never has a `resellers` doc, which structurally guarantees they're never themselves commission-eligible
- [x] Server-side enforcement mirrors the reseller "only your own data" check (7.13) but simpler — a single fixed `customer_company_partner_id` equality check rather than an owned-partner-id set — applied to `order_routes.py` (`create_order`, `list_orders`, `get_order`, `get_order_passport`), `invoice_routes.py` (`list_invoices`, plus a new ownership check on `get_invoice`/`get_invoice_pdf` that closed a pre-existing gap affecting resellers too — see file notes), and `report_routes.py`'s dashboard endpoint (previously fell through to full admin-wide KPIs for any non-reseller role, a real exposure gap the moment a second self-service role could log in)
- [x] Warehouse scoping: admin-set global default unless explicitly overridden per customer company (`PUT /{customer_id}/warehouse`, stored on `customer_metadata.warehouse_id`, same collection/pattern as the existing `samples_account` flag) — deliberately does not inherit a linked reseller's warehouse, the two pins are independent

---

### 25.1 — Customer Self-Service Portal UI ✅ Complete (2026-08-21)

- [x] Order placement screen — reuses `ResellerCatalog.js` and the reseller order cart in `Views.js::Orders()` unchanged, parametrized on `role === "customer"` alongside the existing `role === "reseller"` checks. No "place order for..." picker — a customer's own company is pre-selected and the picker UI is hidden entirely, since a customer account only ever orders for itself
- [x] My Orders — the same `Orders()` list/detail view staff and resellers use, scoped server-side to the customer's own company; internal-only columns (Sales Ticket status, Packing status, Create Sales Ticket action) are hidden for both reseller and customer roles
- [x] My Invoices — reuses `invoice_routes.py`'s existing invoice list/detail/PDF endpoints and `Invoices.js`/`OrderPassport.js` views unchanged, scoped to the customer's own company
- [x] Dashboard — reuses the existing simplified reseller dashboard view and its matching scoped backend branch (`report_routes.py::dashboard_stats`), rather than the full admin dashboard
- [x] `CUSTOMER_NAV` in `UI.js` (Dashboard, Products, My Orders, Invoices — no Commission, My Customers, Invite Customer, or My Applications, all reseller-only referral tools)
- [ ] My Details (update own phone/delivery address) and the Quote review/approve screen for WhatsApp-originated drafts are still scoped to 25.3's bot flow, not yet built — tracked there, not here

---

### 25.2 — Account Activation Flow

**Needs reconciliation with 25.0 before building:** this was written when a `customer` account was assumed to be created lazily on first WhatsApp contact. Since 25.0 shipped provisioning as an explicit, admin-initiated, per-contact action (a `customer` login only ever exists because an admin granted it on the customer profile page), this flow can no longer "create the account first time" itself — at most it can activate/surface a login an admin has already provisioned, or prompt the bot to tell an unprovisioned contact to ask Bassani for portal access. Revisit the steps below with that constraint before implementing.

- [ ] `pending_customer_activations` collection: `{ id, odoo_partner_id, matched_phone, activation_token, status: pending/activated/expired, created_at }`
- [ ] The WhatsApp bot's lookup call (25.3) matches the inbound WhatsApp number against the phone already on file on the Odoo partner. On a match, an activation link is sent to the **email already on file** — never the WhatsApp number itself, and never anything the customer typed into the chat — same "prove control of a channel Bassani already trusts" principle used for the Phase 14 reseller-link OTP flow
- [ ] Clicking the link logs into the existing `customer` login for that contact (provisioned per 25.0). **Reaching the portal via the link does not bypass 2FA** — the portal's existing email-OTP 2FA still applies before an order can be placed, consistent with every other login path into a system that handles controlled-substance orders and financial data. The magic link solves discovery/first-touch, not authentication strength
- [ ] No phone match, or a phone match with no provisioned login yet → the bot is told "new customer" / "ask Bassani to enable your portal access" and directs them to the existing public `/apply` self-registration flow (Phase 16) where relevant — no new endpoint needed, pure reuse

---

### 25.3 — WhatsApp Bot API

New `client_type: "whatsapp_bot"` on `api_clients` (Phase 14's credential system, reused for its mechanism, not its commercial model — a chatbot isn't a reseller or an Integration Partner).

- [ ] `POST /api/external/v1/whatsapp/lookup-customer` — body: `{ whatsapp_number }`. Returns `{ known: bool, accounts: [{ account_id, display_name }] }` — more than one entry when the contact is signatory across multiple company/store accounts (25.4); triggers 25.2's activation email on a match. Never returns a raw name/address/partner ID beyond the minimal `display_name` needed to disambiguate
- [ ] `GET /api/external/v1/whatsapp/customers/{customer_token}/catalogue` — reuses the Phase 14.1–14.3 product/category/stock endpoints unchanged, scoped to whichever `account_id` the conversation has selected (25.4)
- [ ] `POST /api/external/v1/whatsapp/customers/{customer_token}/draft-request` — body: `{ account_id, line_items[{ product_id, qty }], notes }`. Creates a Sales Ticket at `inquiry`/`quote` stage via the existing ticket-creation path, tagged `channel: "whatsapp"` for traceability (same convention as the existing RESELLER/SAMPLE pill tags on the Operations Monitor) — this is "facilitate the ordering process" and "receive completed order documentation" together; it is **not** an order yet, just a ticket entering the same pipeline a staff-created inquiry would
- [ ] `GET /api/external/v1/whatsapp/customers/{customer_token}/quotes/{ticket_id}` — once staff (or auto-pricing, where no negotiation is needed) issues a quote against that ticket, returns the quote summary plus a signed magic link into 25.1's review/approve screen — this is "deliver generated quotations to customers." The bot's role ends at delivering that link
- [ ] `GET /api/external/v1/whatsapp/customers/{customer_token}/invoices` — sanitised list (number, date, amount, status) plus a short-lived signed URL per invoice PDF, not a raw portal deep link requiring separate auth
- [ ] `GET /api/external/v1/whatsapp/customers/{customer_token}/orders` — order/ticket status summary for their recent orders (pipeline stage only, matching the language already used elsewhere for customer-facing status — never internal stage names)
- [ ] `POST /api/external/v1/whatsapp/customers/{customer_token}/request-detail-change` — body: `{ field: "phone" | "delivery_address", new_value }`. **Does not write to Odoo.** Creates a `pending_customer_detail_changes` record and sends a confirmation link to the customer's on-file email (reusing 25.2's activation-link mechanism) — a WhatsApp conversation alone is not sufficient grounds to change where a controlled medicine gets delivered; the customer's own OTP-gated confirmation is required before it's applied
- [ ] `POST /api/external/v1/whatsapp/customers/{customer_token}/request-callback` — body: `{ intent: "sales" | "support" | "complaint", message }`. Routes per 25.6, doesn't touch Odoo
- [ ] **Hard 403, not just omission, on anything that confirms an order or moves money** — a `whatsapp_bot` key attempting to call any order-confirm, `/partner-orders`, `/reseller-orders`, or payment endpoint is rejected at the auth-dependency level, the same layer that resolves `client_type`. Building the draft request (above) is explicitly allowed; confirming it is not
- [ ] `customer_token`/`account_id` are opaque to the bot, never the raw `odoo_partner_id` — same pattern as the existing external customer-token design (14.8)
- [ ] Rate-limited per key (`slowapi`) — a chat platform retrying aggressively on a slow response must not be able to degrade the same shared Odoo connection everything else depends on

---

### 25.4 — Multi-Company / Branch Identification

- [ ] Reuses an already-confirmed real-world pattern (`CLAUDE.md`'s "Same contact, multiple branches" note under Customer onboarding): one person can legitimately be the signatory/contact on more than one Odoo partner (separate legal entities, or separate branches of one entity). The bot's lookup (25.3) must surface all of them, not silently pick one
- [ ] When `lookup-customer` returns more than one account, the bot conversation must resolve which one an order/invoice/detail-change request applies to before calling any account-scoped endpoint — a required `account_id` on every subsequent call, not an optional one, so there's no default-to-first-match failure mode
- [ ] Single-account customers (the overwhelming majority) never see this step — `accounts` has exactly one entry and the bot can proceed straight through

---

### 25.5 — Recurring Orders via WhatsApp

- [ ] No new backend logic — the existing recurring-order engine (8.46: `generate_recurring_notices`, `expire_unaccepted_occurrences`, the public `/recurring/{token}` review/accept page) is untouched
- [ ] Add WhatsApp as an additional delivery channel for the existing recurring-order notice, alongside email — a small addition to the existing dispatch step, not a new workflow. The link delivered is the same `/recurring/{token}` link `RecurringOrderReview.js` already serves

---

### 25.6 — Sales / Support / Complaint Routing

- [ ] Extends the existing `EmailRoutingConfig` / `portal_settings.email_routing` pattern (`settings_routes.py`) with new configurable keys for WhatsApp-sourced requests (e.g. `whatsapp_sales_inquiry`, `whatsapp_support_request`, `whatsapp_complaint`) rather than building separate routing infrastructure
- [ ] `request-callback`'s `intent` field (25.3) selects which routing key fires — same "one new field in `EmailRoutingConfig`, one new `ROUTING_KEYS` entry" pattern the codebase already uses for every other notification type

---

### Definition of Done

- [ ] An existing customer messaging the WhatsApp number is recognised (including being asked to pick an account, if they have more than one), can browse the catalogue, and can submit a draft order request that becomes a ticket
- [ ] A generated quote is deliverable back through the bot as a magic link, and tapping it lands the customer in an authenticated (2FA'd) portal session where accepting it runs through the standard order-confirm pipeline — the bot itself never calls that pipeline
- [ ] A non-customer messaging the bot is routed to `/apply`
- [ ] A `whatsapp_bot` API key cannot successfully call any order-confirmation or payment endpoint under any circumstance, even though it can create draft requests
- [ ] A detail-change request from WhatsApp never writes to Odoo until the customer confirms it via their own on-file email
- [ ] Recurring-order notices can be delivered via WhatsApp using the existing 8.46 mechanism, unmodified
- [ ] Sales/support/complaint requests route to the correct configured Bassani team

### Notes

> **2026-08-19 — Phase rescoped after Nick shared Bassani's actual requirements list for the bot.** The original scope (bot is purely read-only, hands off to the portal for everything else) undersold what was actually being asked for — most of the list (catalogue browsing, building an order request, quote delivery, recurring orders, request routing) turned out to already exist in some form (the ticket pipeline, 8.54's quote-PDF generation, 8.46's recurring-order accept flow, the email-routing config pattern) and just needed a WhatsApp-facing API surface, not new business logic. The one genuine decision was "capture quotation approval" — confirmed explicitly that the bot facilitates and delivers, but the magic-link tap (into the authenticated, 2FA'd portal) is still what actually captures approval and passes it to the ERP, preserving the same boundary used everywhere else in Phases 14/24/25: a chat reply is not a strong enough proof of intent for a controlled-substance order, no matter how conversational the surrounding experience is. Also added multi-company/branch identification (25.4) once "identify the correct company/store associated with an order" surfaced the existing "one contact, several branches" pattern already handled elsewhere in onboarding — the bot has to ask, not assume, when a contact maps to more than one account.
