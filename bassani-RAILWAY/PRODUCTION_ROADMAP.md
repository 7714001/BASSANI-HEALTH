# Bassani Health Portal — Production Readiness Roadmap

**System:** Bassani Health B2B Sales & Reseller Portal  
**Stack:** FastAPI · React 18 · MongoDB · Odoo v17 (XML-RPC) · Railway  
**Last Updated:** 2026-06-18  
**Overall Status:** 🔴 Pre-Production — Phase 0 in progress  

---

## Progress Overview

| Phase | Name | Status | Completed |
|-------|------|--------|-----------|
| 0 | Roles, Permissions & Identity Foundation | 🟡 In Progress | Sub-deploys 1 & 2 (0.1–0.4 + permission-gated UI) complete — 2026-06-18 · Sub-deploy 3 (0.5 Packing Board Auth) — pending |
| 1 | Security Hardening | 🔴 Not Started | — |
| 2 | Email Engine | 🔴 Not Started | — |
| 3 | Core Odoo Integration | 🔴 Not Started | — |
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
**Status:** 🟡 In Progress  
**Completed:** Sub-deploy 1 (0.1–0.4) — 2026-06-18 · Sub-deploy 2 (permission-gated UI, products domain, sidebar filtering) — 2026-06-18 · Sub-deploy 3 (0.5 Packing Board Auth) — pending  

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

- [ ] Add `token` query parameter support to both WebSocket endpoints:
  `wss://host/api/packing/ws/supervisor?token=eyJ...`
- [ ] Validate JWT on WebSocket connect — reject with close code 4001 if invalid or missing
- [ ] `/ws/board` (display screen): accept a long-lived read-only **display token** (not a user JWT) stored in `PACKING_BOARD_DISPLAY_TOKEN` env var. The screen URL becomes `wss://host/api/packing/ws/board?token=<display_token>`
- [ ] `/ws/supervisor`: require a valid `warehouse_supervisor` JWT — regular user tokens are rejected
- [ ] WebSocket actions (assign, tick, status update) now capture the authenticated user and write to audit log

#### 0.5b — Supervisor Authentication Flow

- [ ] `supervisor.html` gets a login screen before the board is shown
- [ ] Login posts to `/api/auth/login` and stores token in `sessionStorage` (not localStorage — clears on tab close)
- [ ] Token is appended to the WebSocket URL on connect
- [ ] Supervisor identity is shown in the header: "Logged in as: Sarah M."
- [ ] Session expires after 8 hours (matching JWT expiry); supervisor is returned to login screen

#### 0.5c — Packer Accounts & Packer View

- [ ] Packers are real portal users with `role: "packer"` — created by admin
- [ ] Packer profile fields: `display_name` (shown on board, e.g. "THEMBI"), `phone`, `active`
- [ ] Remove hardcoded `PACKERS` array from `supervisor.html`; populate packer picker from `GET /api/users/?role=packer`
- [ ] `GET /api/packing/packers` returns active packer user accounts, not settings strings
- [ ] Create `packer.html` — a new standalone page for the packer's handheld device:
  - Login screen → JWT stored in sessionStorage
  - Shows only orders where `packer_name == current_user.display_name`
  - Packer ticks items on their screen; WebSocket broadcasts to board and supervisor in real time
  - Large touch-friendly buttons — designed for warehouse gloves
- [ ] Packing board display shows packer's `display_name` (unchanged visually)

#### 0.5d — Audit Trail for Packing Actions

- [ ] WebSocket supervisor actions currently bypass the REST layer and write directly to MongoDB — they skip audit logging entirely
- [ ] Route all WebSocket write actions through the same logic as the REST endpoints (extract into shared service functions)
- [ ] Every `assign_packer`, `tick_item`, and `update_status` action logs to `audit_logs` with actor identity, timestamp, and order ID

#### 0.5e — Display Board Token

- [ ] Add `PACKING_BOARD_DISPLAY_TOKEN` to Railway environment variables (generate: `openssl rand -hex 32`)
- [ ] Document the board URL format in `DEPLOY.md`: `https://yourdomain.com/packing-board.html?token=<display_token>`
- [ ] The 85" screen connects using this URL — no login prompt, auto-reconnects, read-only

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
- [ ] Navigating to `/supervisor.html` without a valid supervisor token shows a login screen — _pending 0.5_
- [ ] A packer logs in, sees only their assigned orders, ticks an item — the board updates in real time — _pending 0.5_
- [ ] All packing board WebSocket actions (assign, tick, status) appear in `audit_logs` with named actor — _pending 0.5_
- [ ] The 85" display screen connects using its display token URL — no login required, auto-reconnects — _pending 0.5_

### Notes
> **Sub-deploy 1 (2026-06-18):** Completed 0.1–0.4. Backend: 5-role schema, `is_super_admin` flag, `FULL_PERMISSIONS`/`DEFAULT_ADMIN_PERMISSIONS` constants, `require_permission()` factory, env-var super admin seed with startup migration of existing admins. Frontend: `AuthContext` exposes `can()` helper + `isAdmin`, `ProtectedRoute` fixed for `super_admin`, Users view fully rebuilt with role selector, permissions panel, super admin badge, display name for packers. Sensitive endpoints guarded with granular permissions. **Pre-deploy requirement:** set `SUPER_ADMIN_USERNAME` and `SUPER_ADMIN_PASSWORD` in Railway env vars before deploying.

> **Sub-deploy 2 (2026-06-18):** Permission-gated UI + products domain. Bug fix: startup event now syncs password from env vars on existing super admin accounts (fixes login failure when `SUPER_ADMIN_USERNAME` matches an existing user). Added `products.manage` permission domain (auth.py, Users.js, Views.js) — default off for new admins, on for super admin / migrated admins. Frontend: every action button across Orders, Commission, Resellers, Healthcare, Customer Applications, and Products now checks `can()` before rendering; sidebar nav filtered per-user permissions. Create user modal pre-populates default admin permissions (view on, write off) when admin role is selected. **Note:** existing admin accounts that already have `FULL_PERMISSIONS` will have `products.manage: true` — no migration needed. New admin accounts created after this deploy default to `products.manage: false`.

---

## Phase 1 — Security Hardening

**Goal:** Safe to expose to real users. No known exploitable vulnerabilities.  
**Estimate:** 1–3 days  
**Status:** 🔴 Not Started  
**Completed:** —  

### Tasks

#### 1.1 JWT Secret Enforcement
- [ ] Add startup check in `server.py` — fail with clear error if `JWT_SECRET == "change-me-in-production"`
- [ ] Document minimum requirements: 32+ character random string
- [ ] Update `.env.example` with `JWT_SECRET=<run: openssl rand -base64 48>`

#### 1.2 CORS Lockdown
- [ ] Replace `allow_origins=["*"]` in `server.py` with `settings.cors_origins_list()`
- [ ] Set `CORS_ORIGINS=https://yourdomain.com` in Railway environment variables
- [ ] Verify preflight requests work correctly on frontend after change

#### 1.3 Default Admin Credentials
- [x] Remove hardcoded admin seed from `server.py` startup event _(completed in Phase 0.1)_
- [x] Replace with env-var provisioned super admin: `SUPER_ADMIN_USERNAME`, `SUPER_ADMIN_PASSWORD` _(completed in Phase 0.1 — note: implemented as `super_admin` role, not plain `admin`)_
- [x] Startup event is idempotent — safe to re-run on every deploy; creates account on first run, syncs credentials on subsequent runs _(completed in Phase 0.1, password sync bug fixed in sub-deploy 2)_
- [ ] Deactivate or delete the legacy `admin / admin123` account from the Users UI — old account still exists in MongoDB from before the credential overhaul

#### 1.4 Login Rate Limiting
- [ ] Add `slowapi` to `requirements.txt`
- [ ] Apply rate limiter to `POST /api/auth/login` — 5 requests per 15 minutes per IP
- [ ] Return `429 Too Many Requests` with `Retry-After` header on breach
- [ ] Apply rate limiter to `POST /api/healthcare/onboarding` — 10 per hour per IP

#### 1.5 2FA Enforcement for Admins
- [ ] Set `require_2fa_admin=True` in config (infrastructure already exists via `pyotp`)
- [ ] Enforce 2FA setup prompt on first admin login after flag is enabled
- [ ] Verify admin cannot bypass 2FA by going directly to protected routes

#### 1.6 Cleanup
- [ ] Remove `/debug-static` endpoint from `server.py`
- [ ] Ensure FastAPI runs with `debug=False` in production
- [ ] Verify error responses return generic messages (no stack traces) to clients

### Definition of Done
- [ ] Cannot log in as admin with `admin123` on any deployed environment
- [ ] Browser console shows no CORS errors from the correct domain
- [ ] Login attempt #6 returns 429 within the 15-minute window
- [ ] Admin without 2FA configured is prompted on login
- [ ] Application startup fails immediately if JWT secret is default value

### Notes
> _(Add implementation notes, decisions, or issues encountered here)_

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

#### 2.5 Account Emails
- [ ] **New user account created** → User receives welcome email with username, temporary password (or reset link), and login URL

#### 2.6 Resend Configuration
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
- [ ] All emails render correctly on mobile and desktop clients
- [ ] No email sending blocks or slows the API response (all fire via BackgroundTasks)

### Notes
> _(Add implementation notes, decisions, or issues encountered here)_

---

## Phase 3 — Core Odoo Integration

**Goal:** Orders are commercially and fiscally correct, and are fulfilled from the correct physical stock location. All major Odoo sales workflows are supported.  
**Estimate:** 2–3 weeks  
**Status:** 🔴 Not Started  
**Completed:** —  

### Tasks

#### 3.1 Product Variants
- [ ] Switch product fetches from `product.template` to `product.product` (variants)
- [ ] Fetch and expose variant attributes (size, format, dosage) per product
- [ ] Update order line creation to use `product_id` (variant ID), not template ID
- [ ] Update product list UI to show variant selector before adding to cart
- [ ] Verify Odoo order lines reference correct variant `product.product` record

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
- [ ] Implement `POST /api/orders/{id}/cancel` endpoint
- [ ] Call `sale.order.action_cancel` in Odoo
- [ ] Update MongoDB `order_commissions` record `payout_status` to `cancelled` on cancel
- [ ] Only allow cancellation of orders in `draft` or `sent` state (not confirmed `sale`)
- [ ] Show Cancel button in portal UI for eligible orders
- [ ] Trigger cancellation email (Phase 2) from this endpoint

#### 3.6 Credit Limit Enforcement
- [ ] Fetch `credit_limit` and `credit` from `res.partner` in Odoo on order confirm
- [ ] If customer is over limit: show warning to reseller, require admin to override or block
- [ ] Add `credit_hold` flag to customer display in portal
- [ ] Log credit limit checks to audit collection

#### 3.7 Multi-Warehouse / Vault Selection & Stock Accuracy
> **Status quo (confirmed from code):** The system is currently hardwired to a single location. `order_routes.py` `create_order()` sends no `warehouse_id` to `sale.order` — Odoo silently applies its default warehouse. `product_routes.py`, `forecast_routes.py`, and `report_routes.py` read `qty_available` / `virtual_available` directly from `product.template` with no warehouse context, so the portal shows a **company-wide total**, not stock at a specific vault. `return_routes.py` restocks returned items to a **hardcoded `location_id: 8`**. There is no warehouse selector anywhere in the UI and no `stock.warehouse` data is synced. If a second warehouse/vault is brought online today, none of these numbers would be trustworthy.

- [ ] Implement `GET /api/warehouses` — returns Odoo `stock.warehouse` records (`id`, `name`, `code`, `lot_stock_id`, `view_location_id`)
- [ ] Add a warehouse selector to the admin top nav (and packing board context) — selection persists per session/user
- [ ] Pass `context={"warehouse": <id>}` on every `qty_available` / `virtual_available` read (`product_routes.py`, `forecast_routes.py`, `report_routes.py`, low-stock checks) so stock figures reflect the **selected warehouse only**
- [ ] Set `warehouse_id` on `sale.order` creation from the active warehouse context — this is what determines which location's stock is reserved and decremented when the order is confirmed
- [ ] Wire `/api/stock/levels` and `/api/stock/locations` to default-filter by the selected warehouse's `lot_stock_id`
- [ ] Replace the hardcoded `location_id: 8` in `return_routes.py` — resolve the correct restock location from the original order's `warehouse_id`
- [ ] Tag packing board entries with `warehouse_id`; warehouse supervisors/packers (Phase 0 roles) only see and action orders for their assigned warehouse
- [ ] Low-stock alerts and reports are computed per-warehouse, not company-wide

### Definition of Done
- [ ] An order placed with a variant product creates the correct `product.product` line in Odoo (not template)
- [ ] VAT on invoice matches Odoo's tax configuration, not a hardcoded value
- [ ] Attempting to order more units than are in stock returns a clear error before hitting Odoo
- [ ] A customer with a pricelist sees their negotiated price in the cart
- [ ] A draft order can be cancelled via the portal and disappears from the active order list
- [ ] An order for a customer over their credit limit is blocked or escalated
- [ ] Switching the warehouse selector changes displayed stock counts to that location's figures only (verified against Odoo `stock.quant`)
- [ ] An order placed under "Warehouse A" decrements Warehouse A's stock in Odoo, not Warehouse B's
- [ ] A "restock" return is credited to the correct warehouse's location — zero hardcoded location IDs remain in the codebase
- [ ] The packing board for Warehouse B does not show orders fulfilled from Warehouse A

### Notes
> _(Add implementation notes, decisions, or issues encountered here)_

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
- [ ] On every `PUT /api/commission/tiers`, write an audit record to `audit_logs` collection:
  - `action: "commission_tiers_updated"`
  - `before`: previous tier rates
  - `after`: new tier rates
  - `actor`: admin username + IP
  - `timestamp`
- [ ] Display tier change history in the admin Tier Settings tab

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
