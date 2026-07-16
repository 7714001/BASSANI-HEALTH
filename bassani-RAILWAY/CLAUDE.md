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
Reseller profiles, commission records, ownership mappings, onboarding applications, audit logs, tickets, settings, and customer metadata (e.g. `samples_account` flag) belong in MongoDB. Financial records (orders, invoices, payments) live in Odoo. Customer-level portal flags use the `customer_metadata` collection keyed by `odoo_partner_id`.

**6. All Odoo reads and writes are warehouse- and company-scoped.**
Bassani operates across multiple warehouses belonging to different Odoo companies. Every stock read, tax lookup, and record creation must be scoped to the resolved warehouse's company. Use `get_company_id()` and `company_context()` from `warehouse_context.py` — never bypass them.

**7. Every admin action is audit-logged.**
Every state change on a financial record captures actor, timestamp, IP, and before/after values. Use `audit_log()` from `middleware/audit.py` — this is the single canonical writer. Never add a second writer.

**8. Background tasks do not block API responses.**
Emails, push notifications, and non-critical writes always fire via FastAPI `BackgroundTasks`.

**9. All commission payments must produce an Odoo vendor bill.**
No statement can be marked paid without a corresponding `account.move` in Odoo.

**10. Everything runs on Railway.**
No new external services without an explicit decision. Approved additions: Resend (email), Sentry (errors), Cloudflare R2 (document storage), Google Places API (address autocomplete — proxied server-side via `places_routes.py`, key stored as `GOOGLE_PLACES_API_KEY` Railway env var, never exposed to the browser).

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
- `backend/routes/order_routes.py` — order pipeline, stock-check endpoint (`invoice_policy_block` logic here)
- `backend/routes/product_routes.py` — product list (`category_id` int param for picker drawer), categories endpoint, `GET /{product_id}/lots` (in-stock lot list with qty aggregated from `stock.quant`, expiry from `stock.lot`)
- `backend/routes/label_routes.py` — GS1 label printing: printer CRUD (`/api/labels/printers`) + ZPL print endpoint (`/api/labels/gs1/print`). Printers stored in MongoDB `portal_settings` `_id: "label_printers"`.
- `backend/routes/gtin_pool_routes.py` — GTIN Pool management: bulk-add, list, assign to Odoo product, unassign, delete. Collection: `gtin_pool`. Assignment writes to Odoo `product.template.barcode`.
- `backend/routes/search_routes.py` — `GET /api/search/global?q=` — smart dispatch: 13–14 digit GTIN → product barcode lookup; sale.order name → Order Passport (`/orders/{id}/passport`); account.move name → resolves linked SO via `invoice_origin` and navigates to passport. Requires `require_admin`.
- `backend/routes/monitor_routes.py` — Operations monitor. Admin: `GET/POST /api/monitor/token` (generate/rotate token stored in `portal_settings._id: "monitor_display_token"`). Public (token-verified): `GET /api/monitor/validate`, `GET /api/monitor/data` (KPIs + 5 columns — all MongoDB, no Odoo calls). Age tiers: ok/warning/urgent/overdue relative to 72h deadline (48h for quotes).
- `frontend/src/views/OrderPassport.js` — unified order lifecycle view at `/orders/:orderId/passport`. Aggregates ticket, invoice, deliveries, batch/lot numbers, MOs into one page with pipeline stepper and colour-coded overall status. Primary landing for all barcode/reference scans. Ticket card shows order type (Reseller/Internal pill), reseller name, customer name, notes, and timestamps. Deliveries fetched in parallel from `/api/orders/{id}/deliveries`. `hasPartialDelivery` gate prevents draft quotes being falsely flagged as backorders. Outstanding order lines are clickable — navigate to Backorders pre-filtered to that SO.
- `frontend/src/components/GTINPickerModal.js` — modal for assigning a pool GTIN to a product. Shows current assignment status, available GTIN list with search, assign/unassign actions. Opened from the "Pool" button in the Products table Barcode column.
- `frontend/src/views/GTINPool.js` — Settings > GTIN Pool tab. Stats (total/available/assigned), bulk-upload textarea, full registry table with unassign/delete actions.
- `frontend/src/views/OrderMonitor.js` — Public TV/big-screen operations monitor at `/monitor?token=`. Dark theme (`bg-slate-900`). Token validated on mount. 30-second data polling + 1-second countdown tick. KPI strip (2 rows): Row 1 — Overdue / At Risk / Compliance Hold / Completed Today; Row 2 — Open Inquiries / In Packing / QA Pending / RP Pending / Awaiting Collection / Oldest Active. 5 Kanban columns (Quotes/Packing/QA/RP/Ready to Collect). All KPIs span all 5 columns — no financials. Cards sorted oldest-first; age-tier colour borders; live countdown badges. No auth — access controlled by URL token only.
- `frontend/src/views/MonitorSettings.js` — Settings > Monitor Display tab. Generate display URL, copy to clipboard, rotate token (with confirmation modal).
- `backend/services/gs1.py` — `validate_gtin()`, `build_gs1_text()`, `build_zpl_unit_label()`, `build_zpl_carton_label()`, `send_zpl()` (TCP port 9100)
- `frontend/src/AuthContext.js` — auth state, `can()` permission helper, `isAdmin` flag
- `frontend/src/components/UI.js` — shared components: `TopBar`, `DataTable`, `SearchBar`, `FilterPill`, `Sidebar`, `Modal`, `BtnDanger`, `BtnPrimary`, `BtnSecondary`, `fmtR`, etc.
- `frontend/src/components/ProductLineRow.js` — shared product line row (quote builder + reseller cart). Uses `createPortal(dropdown, document.body)` with `getBoundingClientRect()` to escape the `overflow-x-auto` table ancestor — never add a containing ancestor that clips this dropdown.
- `frontend/src/components/ProductPickerDrawer.js` — right-side drawer for quote builder (staff only). Categories from `/api/products/categories`, variants derived client-side from `display_name` pattern `"Name (Variant)"`, `category_id` int param to backend. Category + variant filters use `SearchableSelect` (internal component: trigger + dropdown panel with search input, outside-click close, auto-focus).
- `frontend/src/components/GS1LabelModal.js` — GS1 label printing modal. `bwip-js` renders live DataMatrix + GS1-128 preview on canvas. Lot/expiry/serial/qty fields; Unit/Carton/Both toggle; printer selector from `/api/labels/printers`; "Print to Zebra" (POST) + "Print via browser" (`window.print()`) actions. Opened from the Barcode column GS1 button in the Products table.
- `frontend/src/views/SalesTickets.js` — the core ticket view: 3 sub-views in one file (list / detail / quote-builder). The quote builder has both "Add a line" (per-row inline search) and "Browse Products" (picker drawer) — both paths must stay working.
- `frontend/src/views/ConnectedMailboxes.js` — tabbed mailbox config panel (Sales Inbox tab + Onboarding Mailbox tab). `MailboxConfigPanel` is an inner component — state and modals must be scoped to it.
- `frontend/src/views/DocumentTemplates.js` — version-controlled onboarding template management. Three single-file PDFs (NDA, Store Onboarding Agreement, Customer Information Form) use `DocTypeCard`. Welcome Pack uses `WelcomePackSlotsCard` — four independently versioned slots (`budget`, `letter`, `price_list`, `brochure`), each with its own `SlotCard` and `SlotVersionHistory`. Switching on `template.is_slots` from the API drives which card renders.
- `frontend/src/views/SigningPage.js` — public page at `/sign/:token`. No auth. Customer signs NDA + Store Onboarding Agreement via 30-day signing session token. Pre-filled from form_data snapshot. POSTs signed PDFs to `POST /api/public/signing/{token}/sign/{doc_type}`.
- `frontend/src/utils/pdfSigning.js` — shared PDF field detection, prefill mapping, and signing utilities. `DOC_CONFIGS` covers nda, store_onboarding_agreement, customer_information_form. Used by DocumentTemplates (admin test flow), PublicRegister (self-service CIF signing), and SigningPage (NDA + SOA customer signing).
- `backend/routes/public_routes.py` — public endpoints including `GET /api/public/signing/{token}` (validate session + return form data) and `POST /api/public/signing/{token}/sign/{doc_type}` (accept signed PDF, update session + application).
- `backend/routes/places_routes.py` — Google Places API proxy. Two rate-limited public endpoints: `GET /api/public/places/autocomplete?q=&session_token=` and `GET /api/public/places/details?place_id=&session_token=`. Key read from `GOOGLE_PLACES_API_KEY` env var; degrades to 503 if unset (frontend falls back silently to plain text input).
- `frontend/src/components/AddressAutocomplete.js` — reusable SA-restricted address autocomplete input. Debounced predictions dropdown, keyboard nav, "Powered by Google" attribution, silent fallback if API unavailable. Used on the address step of both `PublicRegister.js` and `CustomerOnboarding.js`. On selection auto-populates street, suburb, city, province, and postal_code via `onAddressSelect` callback.
- `frontend/src/views/CustomerApplicationDetail.js` — application detail for admin review. Two-step document flow: "Generate Documents" calls `POST /generate-signing-docs` (creates session with `status: "generated"`, no email); admin previews pre-filled NDA and SOA client-side via `generateSignedPdf`; "Send to Customer" calls `POST /send-signing-docs` (sends email, sets `status: "sent"`). Signing session panel shows three states: no session / generated / sent. Signing session status card shows which docs the customer has signed.
- `frontend/src/views/LabelPrinters.js` — Settings tab for Zebra printer management (add/test/delete). Embedded into `Settings.js` as "Label Printers" tab.
- `frontend/src/App.js` — all routes; role-based route branching (e.g. reseller sees `ResellerCatalog`, admin sees `Products`)

---

## Roadmap Status (as of 2026-07-10)

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
| 8 | Order Workflow and Ticketing System | In Progress — core pipeline built; partial fulfilment/backorder flow, invoice_policy_block safeguard, per-user document signing, self-service customer registration, product picker drawer all built. 8.24–8.36 complete: invoice lifecycle actions, credit notes, address management, Order Passport, reseller traceability, ticket linking + inbox integration, SO # column on ticket list. 8.37 complete: customer onboarding redesign. 8.38 complete: Samples Account. 8.39 complete: pipeline redesign — deposit step removed, invoice now raised at mark_complete (after QA+RP sign-off). Staff account creation outstanding. |
| 9 | Go-Live Infrastructure | Complete — portal.bassanihealth.com live |
| 10 | Responsive UI | In Progress (10.5 pending) |
| 11 | Microsoft 365 Mailbox Integration | Sales Inbox + Onboarding Inbox both built (IMAP + O365 Graph paths). Blocked on Azure credentials from M365 admin. |
| 12 | Barcode Integration | In Progress — 12.0 backend done; 12.4 GS1 backend + Products-page label modal built; 12.5 GTIN Pool management complete; 12.6 Global Barcode Search + Order Barcode complete; serial tracking + packing-board integration pending |
| 13 | Production and Cultivation Module | Concept — needs SAHPRA scoping |
| 19 | Per-User Document Signing | Complete — `signing_authority.sign` permission, My Profile setup, countersignature flow |
| 20 | Commission Eligibility Flag | Complete — `commission_eligible` flag, internal agents excluded from bulk runs |
| 22 | Automated Bank Reconciliation | Complete — 22.1 auto-payment detection (15-min Odoo poll); 22.2 CSV import + auto-match; 22.3 manual match/exclude/unmatch (registers Odoo payment via account.payment.register); 22.4 Finance dashboard (statements list + line review); 22.5 FNB Business + Nedbank Business CSV parsers. Permission: `finance.bank_reconciliation`. Routes: `bank_recon_routes.py`. View: `BankReconciliation.js` |
| 23 | Operations Monitor | Complete — token-verified public TV display at `/monitor?token=`; 5 Kanban columns (Ready to Collect renamed from Awaiting Payment); process-focused KPI strip (no financials): Overdue/At Risk/Compliance Hold/Completed Today + per-stage breakdown + Oldest Active order. Overdue and at-risk counts cover all 5 columns. Route: `monitor_routes.py`. Views: `OrderMonitor.js`, `MonitorSettings.js`. Settings tab: Monitor Display. |

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
- **Self-service registration:** Public route `/apply` — customers register without staff involvement. Reseller referral links use `?ref=RESELLER_CODE`. Customer signs only the Customer Information Form in-browser + uploads CIPC. NDA and Store Onboarding Agreement are sent separately by admin after review. The wizard is 6 steps: (0) Business Type card selector — 8 options, Healthcare Provider and Private Practice removed, Sole Proprietor supported; (1) Business Details — adaptive: Sole Proprietors see no Company Reg or Trading Name fields, "Registered Company Name" label becomes "Business / Trading Name"; (2) Primary Contact — SA ID required + Luhn-validated, position required, SA phone format enforced; (3) Business Address — suburb, province, and postal code all required, postal code validated as exactly 4 digits; (4) Additional Info; (5) Sign Documents. Business type card selector also appears at the top of Step 1 in the reseller-initiated `CustomerOnboarding.js` wizard, making both wizards adaptive.
- **Full onboarding flow:** (1) Customer submits `/apply` → CIF signed in-browser + CIPC uploaded → application created in `pending` state. (2) Admin receives email with a direct link to the specific application. (3) Admin reviews CIF + CIPC on the application detail page. (4) Admin clicks **Generate Documents** → `POST /generate-signing-docs` creates a `signing_sessions` MongoDB doc (status: `"generated"`) with a 30-day UUID token and a form_data snapshot — no email sent yet. (5) Admin previews the pre-filled NDA and SOA in-browser (client-side PDF rendering via `generateSignedPdf`). (6) Admin clicks **Send to Customer** → `POST /send-signing-docs` sends `send_signing_invitation` email; session status updated to `"sent"`. (7) Customer opens `/sign/{token}` (public, no auth), signs NDA + SOA in-browser; each signed PDF stored in R2 and stamped onto the application with `signed_in_portal: true`. (8) Signing authority claims the application and countersigns each document in-portal. (9) When both NDA + SOA are countersigned, a notification is sent to recipients configured in the `countersign_complete_to` email routing key (typically Kashi and Dean). (10) Dean sends the Welcome Pack via the portal: email attaches all four onboarding documents (CIF, CIPC, countersigned NDA, countersigned SOA) plus the four active Welcome Pack slot files (Help Me Budget, Welcome Letter, Price List, Product Brochure). (11) Admin approves → Odoo customer created → all 4 docs transferred to `customer_documents`. Hard gate: all 4 docs (CIF + CIPC + NDA + SOA) must be present and NDA + SOA countersigned before approval.
- **Signing session states:** `"generated"` (admin has created session, not yet sent) → `"sent"` (email sent to customer) → customer signs → `signed` map populated on session. Public `/sign/{token}` returns 403 if session status is `"generated"` — prevents customer accessing before admin deliberately sends. Legacy sessions in the DB with status `"pending"` are treated as `"sent"`.
- **TQA removed:** The TQA document has been removed from all surfaces (templates, doc types, signing flows, document templates admin). The three managed templates are now: Store Onboarding Agreement, Customer Information Form, NDA. A fourth managed template — Welcome Pack — is managed as four independently versioned slots (`budget`: Help Me Budget Excel; `letter`: Welcome Letter PDF; `price_list`: Price List PDF/Excel; `brochure`: Product Brochure PDF). Each slot has its own version history and can be updated without affecting the others. Not customer-signed.
- **Document signing (per-user model):** `signing_authority.sign` permission controls who can countersign. Each signing authority configures their own signature image/name/title on My Profile. Claim/release mechanism prevents double-signing. Approval button is locked until both Bassani-signature-bearing documents (NDA, Store Onboarding Agreement) are countersigned.
- **Countersign notification:** `countersign_complete_to` email routing key in `portal_settings` — when all Bassani-sig docs are countersigned, `send_countersign_complete_notification()` fires to the configured addresses. Configured under Settings > Email Routing > "Onboarding: Documents Countersigned".
- **Welcome pack:** Admin (`customers.approve_onboarding`) clicks **Send Welcome Pack** after all signing is complete. `POST /{app_id}/send-welcome-pack` attaches all four onboarding documents (CIF, CIPC, countersigned NDA, countersigned SOA) plus all four active welcome pack slot files (budget, letter, price_list, brochure) fetched via `get_active_bundle_files("welcome_pack")`. Countersigning overwrites the R2 key in place, so `r2_key` on NDA/SOA already points to the countersigned version. Sends `send_customer_welcome_pack()`. Sender's `signing_name`/`signing_title` from their `users` doc appears as the email footer. Stamps `welcome_pack_sent_at`/`welcome_pack_sent_by` on the application.
- **Welcome pack slots:** The Welcome Pack is managed as four independently versioned slots — not a single bundle. Super admin updates any slot independently via `POST /api/doc-templates/welcome_pack/{slot}/upload`. Slots: `budget` (Help Me Budget, Excel), `letter` (Welcome Letter, PDF), `price_list` (Price List, PDF/Excel), `brochure` (Product Brochure, PDF). Each slot has its own version history and rollback. The `WelcomePackSlotsCard` in `DocumentTemplates.js` renders one `SlotCard` per slot; `DocTypeCard` handles the three single-file PDFs unchanged.
- **Multi-thread inbox:** Applications support multiple linked inbox threads via `inbox_thread_ids: []` array (not a single `inbox_thread_id`). `$addToSet` prevents duplicates. Detail page shows "Thread 1", "Thread 2" etc. in the header. All threads are archived on approval.
- **Onboarding Inbox:** Separate mailbox from the Sales Inbox, gated by `onboarding.inbox` permission. Configured under Settings > Connected Mailboxes > Onboarding Mailbox tab. Tracks document progress per thread. "Save to Application" maps email attachments to document slots on a reseller application.

**Order pipeline:**
- Reseller places order → Sales ticket created → Orders clerk confirms packing → QA approval → RP approval → Invoice created → Finance confirms payment → Complete.
- **Invoice timing:** The invoice is created and posted in Odoo at `mark_complete` on the packing board (after QA + RP have both signed off). This is the "ready for collection" point — the customer can pay and collect. Finance confirmation checks Odoo's real invoice `payment_state` — it is not a disconnected checkbox.
- There is no deposit step. Orders go directly to the packing board on confirmation with no upfront invoice.
- **Partial fulfilment / backorders:** `GET /api/orders/{order_id}/stock-check` returns `is_partial`, `lines` (ships now vs backordered), `invoice_policy_block`, and `invoice_policy_blocked_products`. The stock-check modal shows the split before the user confirms. `invoice_policy_block = true` when any product has `invoice_policy = 'order'` in Odoo — this blocks the "Confirm with Backorder" button. All Bassani products must have `invoice_policy = 'delivery'` set in Odoo (Tristan instructed 2026-07-09). Staff see the Odoo fix path; resellers are told to contact Bassani.
- For partial orders: each delivery goes through its own packing → QA/RP → mark_complete → invoice cycle. Backorder entries sit in `waiting_stock` state until Phase 13 production flow assigns stock.
- **Sample orders:** Go through the full packing board pipeline including QA/RP sign-off. At `mark_complete`, a R0.00 invoice is created and posted in Odoo — Odoo marks it paid immediately (nothing owed). Finance takes no action on sample tickets; payment confirmation and invoice lifecycle buttons are hidden (`!detail.is_sample` gate). The invoice number is visible on the ticket for audit trail purposes.

**Section 21 authorisation:**
- Every order for a named patient requires a structured Section 21 Authorisation Letter (medicine-specific, quantity-specific). The current implementation stores a single s21script string — this is a known gap flagged for Phase 8 hardening.

**Batch traceability (Phase 13):**
- Bassani's batch ID schema is fixed: `BH` + `API`/`B` + strain code + sequence + date (e.g. `BHAPIBBY-001-010126`). Suffixes: `-D` Drying, `-U` Unmanicured, `-M` Manicured, `-P` Pops, `-T` Trim. Post-manicure: `-MC` Crushed, `-MCPR` Pre-Roll. Do not re-derive this schema — it is confirmed from Bassani's own Medicinal Cannabis Batch Traceability Guide V6.
- Full traceability chain: cultivation batch → manufacturing/blend batch → finished goods → Sale Order → Delivery Note → Named Patient + Script + Section 21 Authorisation.

---

## Document Maintenance — Mandatory After Every Change

After every completed feature, fix, or refactor, update the four living documents below before considering the work done. This is not optional and is not deferred to a separate session.

**The four documents:**
- `CLAUDE.md` — this file. Architecture rules, key files, patterns, roadmap table.
- `PRODUCTION_ROADMAP.md` — authoritative phase tracker with Definition of Done per sub-phase.
- `BASSANI_HEALTH_USER_MANUAL.md` — operational guide for all roles.
- `BASSANI_HEALTH_EXECUTIVE_OVERVIEW.md` — business-level summary for non-technical stakeholders.

**Rules for each change type:**

| Change type | What to do |
|---|---|
| **New feature** | Decide where it fits in the roadmap first. If it belongs under an existing phase, add it as a numbered sub-phase (e.g. 8.12) and check off items as built. If it introduces a genuinely new phase, create the phase with a clear scope and Definition of Done. Never add a feature to the roadmap as a vague bullet — it must have a sub-phase number and a Done condition. |
| **Refactor / improvement** | Update the *existing* section in each document that covers this area. Do not add a new section. Replace the outdated description with the current one. |
| **Bug fix** | Update only if the fix changes a documented behaviour or constraint. Otherwise no update needed. |
| **Removed / replaced feature** | Remove or overwrite the old description. Do not leave stale entries alongside new ones. |

**Scope discipline:**
- The roadmap grows only when scope genuinely grows. A refactor of an existing feature is not a new sub-phase.
- The user manual grows only when user-facing behaviour changes or new actions become available. Refactoring the internals of a feature does not require a manual update.
- The executive overview grows only when a new capability is available to the business. Implementation detail does not belong there.
- CLAUDE.md's key files list and patterns section are replaced/updated, not accumulated. Remove outdated file references when files are deleted or renamed.

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

## Confirmed UI Patterns

These patterns are established across the codebase. Follow them exactly — do not invent alternatives.

**Confirmation modals (replaces `window.confirm`):**
```js
const [fooConfirm, setFooConfirm] = useState(null);  // null | target object
const doFoo = async () => {
  const target = fooConfirm;
  setFooConfirm(null);
  try { await api.delete(...); toast.success("Done"); reload(); }
  catch (e) { toast.error(e.response?.data?.detail || "Failed"); }
};
// In JSX:
// <BtnDanger onClick={() => setFooConfirm(item)}>Delete</BtnDanger>
// {fooConfirm && <Modal title="..." onClose={() => setFooConfirm(null)}>
//   <p>...</p>
//   <div className="flex justify-end gap-2 mt-4">
//     <BtnSecondary onClick={() => setFooConfirm(null)}>Cancel</BtnSecondary>
//     <BtnDanger onClick={doFoo}>Confirm</BtnDanger>
//   </div>
// </Modal>}
```
There must be zero `window.confirm` calls in `frontend/src/`. Always use `Modal` + `BtnDanger`/`BtnPrimary` + `BtnSecondary`.

**Standard admin container width:**
All admin settings/detail pages use `max-w-4xl mx-auto w-full` as the content container. Do not use `max-w-2xl` or `max-w-3xl` for admin views — those narrow widths are reserved for external-facing public forms (`/apply`, `/register`).

**Product search in quote builder:**
Two paths coexist — both must stay working:
1. Per-row inline text search in `ProductLineRow` (power-user quick path)
2. `Browse Products` drawer (`ProductPickerDrawer`) — category + variant filter browse path, internal staff only

`handlePickerAdd` in `SalesTickets.js` replaces the trailing empty line when adding from the drawer rather than always appending — preserves a clean line count.

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
