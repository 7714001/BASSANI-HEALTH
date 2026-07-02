# Bassani Health Portal — Claude Code Instructions

This is the single source of truth for how to build and extend this system. Read this before making any decision. Everything here reflects confirmed direction from the product owner.

---

## What This System Is

The Bassani Health portal is a B2B sales and reseller portal for a licensed medicinal cannabis distributor in South Africa. It sits as a middleware layer between internal staff/resellers (who use it) and Odoo v17 (which stores all financial and inventory data).

**Roles in the system:**
- `super_admin` — seeded from Railway env vars, unconditional access
- `admin` — operations staff, granular permission-gated
- `sales` — sales ticket workflow only (Merveille)
- `orders_clerk` — packing pipeline only (Tshidi)
- `finance` — deposit/payment confirmation only (Kashi, Ragini)
- `qa_manager` — QA approval on orders (Cullen Grant)
- `responsible_pharmacist` — RP approval on orders (Rookshanna Hussain)
- `warehouse_supervisor` — packing floor supervision
- `packer` — packing floor, own orders only
- `reseller` — external partners who place orders for their customers

---

## Architecture Principles — Non-Negotiable

These govern every decision. Do not deviate from them.

**1. Odoo is the financial source of truth.**
Every invoice, payment, order, and stock figure must originate in or be confirmed by Odoo. The portal never becomes a parallel ledger. All financial writes go through Odoo via XML-RPC.

**2. The portal is the main point of access — Odoo is invisible to staff.**
Staff should never need to log into Odoo for routine operations. Any step in the business workflow that requires opening Odoo is an unfinished portal feature, not an acceptable design choice. When a field-parity gap is found (an Odoo field shown but not editable in the portal), treat it as in-scope work.

**3. The portal maps to how the business works, not how Odoo works.**
The natural business workflow is: inquiry → quote → customer acceptance → deposit → fulfilment → collection. The portal expresses this in business language. Never expose Odoo's internal language (sale.order.state, account.move, stock.picking) to users.

**4. The ticket system is the single processing pipeline for all orders.**
Every sale.order — whether placed by a reseller, by staff, or converted from an inquiry — flows through Sales → Orders (packing board) → QA/RP → Finance. No order is processed outside this pipeline.

**5. MongoDB handles portal-layer concerns only.**
Reseller profiles, commission records, ownership mappings, onboarding applications, audit logs, tickets, and settings belong in MongoDB. Financial records (orders, invoices, payments) live in Odoo.

**6. All Odoo reads and writes are warehouse- and company-scoped.**
Bassani operates across multiple warehouses belonging to different Odoo companies. Every stock read, tax lookup, and record creation must be scoped to the resolved warehouse's company. Use `get_company_id()` and `company_context()` from `warehouse_context.py` — never bypass them.

**7. Every admin action is audit-logged.**
Every state change on a financial record captures actor, timestamp, IP, and before/after values. Use `audit_log()` from `middleware/audit.py` — this is the single canonical writer. Never add a second writer.

**8. Background tasks do not block API responses.**
Emails, push notifications, and non-critical writes always fire via FastAPI `BackgroundTasks`.

**9. All commission payments must produce an Odoo vendor bill.**
No statement can be marked paid without a corresponding `account.move` in Odoo.

**10. Everything runs on Railway.**
No new external services without an explicit decision. Approved additions: Resend (email), Sentry (errors), Cloudflare R2 (document storage).

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI (Python 3.11), deployed on Railway |
| Frontend | React 18, served as static files from the FastAPI server |
| Database | MongoDB (Railway plugin) — portal-layer data only |
| ERP | Odoo v17, XML-RPC API |
| Email | Resend — all transactional email via `backend/services/email_service.py` |
| File storage | Cloudflare R2 (S3-compatible) — onboarding docs and customer documents |
| Error monitoring | Sentry |
| Auth | JWT + email OTP 2FA (via Resend) |

**Key files:**
- `backend/server.py` — FastAPI app, startup events, SPA catch-all route
- `backend/auth.py` — `require_permission()`, `require_admin()`, role/permission constants
- `backend/middleware/audit.py` — single canonical `audit_log()` function
- `backend/services/email_service.py` — all transactional email templates and send logic
- `backend/services/warehouse_context.py` — `get_company_id()` and `company_context()` helpers
- `frontend/src/AuthContext.js` — auth state, `can()` permission helper, `isAdmin` flag
- `frontend/src/components/UI.js` — shared components: `TopBar`, `DataTable`, `SearchBar`, `FilterPill`, `Sidebar`, etc.
- `frontend/src/App.js` — all routes; role-based route branching (e.g. reseller vs admin product view)

---

## Roadmap Status (as of 2026-07-02)

| Phase | Name | Status |
|---|---|---|
| 0 | Roles, Permissions and Identity Foundation | Complete |
| 1 | Security Hardening | Complete |
| 2 | Email Engine | Complete |
| 3 | Core Odoo Integration | In Progress (2 live VAT verification items outstanding) |
| 4 | Commission Engine Hardening | Complete |
| 5 | Reliability and Resilience | Not Started |
| 6 | Observability and Operations | Complete |
| 7 | Missing Commercial Workflows | Complete |
| 8 | Order Workflow and Ticketing System | In Progress (staff account creation outstanding) |
| 9 | Go-Live Infrastructure | Complete — portal.bassanihealth.com live |
| 10 | Responsive UI | In Progress (10.5 pending) |
| 11 | Microsoft 365 Mailbox Integration | Built, blocked on Azure credentials from M365 admin |
| 12 | Barcode Integration | In Progress |
| 13 | Production and Cultivation Module | Concept — needs SAHPRA scoping |

See `PRODUCTION_ROADMAP.md` for the full Definition of Done per phase and all sub-deploy notes. That document is the authoritative phase tracker.

---

## Key Business Rules

**Reseller model:**
- Resellers are external business partners who place orders on behalf of their own customers.
- Each reseller can only place orders for customers linked to their profile (onboarded by them or linked by an admin).
- Resellers have a read-only product catalog view — they never see stock history, barcodes, or admin controls.
- Commission is calculated as a percentage of monthly turnover using configurable tier bands.

**Customer onboarding:**
- Resellers initiate customer onboarding via a 5-step wizard (Step 0 gates: send/download template docs, Step 1: company details, Step 2: contact, Step 3: banking, Step 4: documents).
- Applications go to an admin review queue. Approval creates the customer in Odoo and links them to the reseller.
- Onboarding documents are stored in R2. Admin can also upload documents directly to a customer profile.
- Admins can link existing Odoo customers to a reseller or unlink them. Both actions are audit-logged.

**Order pipeline:**
- Reseller places order → Sales ticket created → Orders clerk confirms packing → QA approval → RP approval → Finance confirms payment → Complete.
- Finance confirmation checks Odoo's real invoice payment_state — it is not a disconnected checkbox.

**Section 21 authorisation:**
- Every order for a named patient requires a structured Section 21 Authorisation Letter (medicine-specific, quantity-specific). The current implementation stores a single s21script string — this is a known gap flagged for Phase 8 hardening.

**Batch traceability (Phase 13):**
- Bassani's batch ID schema is fixed: `BH` + `API`/`B` + strain code + sequence + date (e.g. `BHAPIBBY-001-010126`). Suffixes: `-D` Drying, `-U` Unmanicured, `-M` Manicured, `-P` Pops, `-T` Trim. Post-manicure: `-MC` Crushed, `-MCPR` Pre-Roll. Do not re-derive this schema — it is confirmed from Bassani's own Medicinal Cannabis Batch Traceability Guide V6.
- Full traceability chain: cultivation batch → manufacturing/blend batch → finished goods → Sale Order → Delivery Note → Named Patient + Script + Section 21 Authorisation.

---

## Coding Standards

**General:**
- Make confident technical choices and explain the reasoning briefly. Do not survey options — recommend and act.
- Ask before acting only when there is a genuine scope fork that affects production data, schema changes, or architectural direction. Never ask about implementation details that can be determined from the code.
- Do not expose internal system names (Odoo, MongoDB) to resellers or customers in any user-facing text, emails, or UI.
- When a number or status could confuse an admin who is not Odoo-fluent, add an explanation in business terms (e.g. "150 units reserved against these open orders"). Fold these into roadmap work naturally — do not go off-roadmap unprompted.

**Permissions:**
- Use `require_permission("domain.action")` from `auth.py` for sensitive endpoints.
- Use `require_admin` only for non-sensitive list/read endpoints that any admin role can access.
- Gate frontend action buttons with `can("domain.action")` from `useAuth()`.
- Gate nav items in `UI.js` — only show what the user has permission to access.

**Audit logging:**
- Every write action on a financial or operational record calls `audit_log()` from `middleware/audit.py`.
- Always include `user=current_user` (not individual actor fields), `entity_type`, `entity_id`, `entity_label`, and `before`/`after` where state changes.
- Thread `reseller_id` through any audit entry that relates to a specific reseller.

**Frontend patterns:**
- All views follow the `TopBar` + `DataTable` + `SearchBar` pattern from `components/UI.js`.
- Use `FilterPill` and `ChipRow` for category/variant filtering.
- New routes go in `App.js` under `ProtectedRoute`. Add `adminOnly` for admin-only views.
- Role-based route branching is done inline in `App.js` (e.g. reseller sees `ResellerCatalog`, admin sees `Products`).
- Reseller-specific nav items go in `RESELLER_NAV` in `UI.js`. Admin nav items go in `ADMIN_NAV`.

---

## Email Standards

All automated emails are defined in `backend/services/email_service.py`. Every template must follow these rules.

**Copy rules:**
- No em dashes (`—`) anywhere in subject lines or body copy. Use a colon in subjects (e.g. `Order Confirmed: {ref}`) and split into separate sentences or use a comma in body text.
- No en dashes or double hyphens as separators.
- No internal system names in emails sent to resellers or customers. Say "account" not "Odoo record". Say "our system" not "Odoo".
- Fallback empty values must read as text: use `"Not provided"` not `"—"`.
- Middle dots (`·`) used as separators must be rewritten as proper sentences.
- Language must be warm, professional, and fluent. Avoid abrupt single-sentence paragraphs for bad news.
- Security warnings must be calm: "consider updating your password as a precaution" not "your password may be compromised".

**Layout rules:**
- All templates share the single `_wrap(body_html)` shell. Do not add a subtitle parameter — it was removed.
- The shell includes a `<style>` block with `@media (max-width:480px)` overrides for `.bh-body` and `.bh-footer`. New templates inherit this automatically.
- OTP or code display blocks must use a nested `<td>` table cell for the code box — not `display:inline-block` on a `<p>`.
- The logo banner is a full-width `<img>` at the top of every email. No text or subtitle in the header.
- After writing any email template, search for `—` in the file. There should be zero matches in any user-visible string.

---

## Phase 13 — Compliance Notes

Phase 13 (Production and Cultivation Module) must be built to EU GMP Annex 11 (Computerised Systems) standards, which SAHPRA aligns with for medicinal cannabis.

**Already satisfied by the existing portal:**
- Named users and roles (Phase 0)
- Comprehensive audit trail with actor, timestamp, and before/after (Phase 0.6)
- Secure API with JWT and 2FA (Phase 1.5)
- Regular MongoDB backups (Railway)
- Incident management via Sentry (Phase 6)

**Critical gap — Electronic Signatures (Annex 11 §30-31):**
A JWT-authenticated button click does not satisfy Annex 11. Re-authentication at point of critical sign-off (QA/RP approval, batch release) is required. The e-signature module must: re-verify password at sign-off → verify bcrypt independently of JWT → create a permanent `signature_event` document linked to the record. This affects Phase 13 and is a retrofit on the existing packing board QA/RP approvals.

**Before starting Phase 13:** obtain SAHPRA's specific submission format and get compliance officer confirmation of Annex 11 requirement. The batch ID schema and traceability chain are already fixed — do not re-derive them.
