# Bassani Health — Digital Operations System
## Executive Overview

**Prepared by:** DynamicTech SA  
**Date:** 9 July 2026  
**Status:** Phases 1–9 + Phase 11 + Phase 15–21 live at portal.bassanihealth.com · Phase 12 in progress (12.4 GS1 label printing + 12.5 GTIN Pool live) · Phase 13 (Production Module) — Proposal · Phase 14 (Ecommerce API) — Concept

---

## What This Document Covers

This document gives management a plain-language overview of the Bassani Health digital operations system — what it does, who uses it, how it improves day-to-day operations, and how the planned Phase 13 production module will complete the picture by connecting your cultivation and manufacturing processes to the commercial system already live today.

---

## The Core Idea

Bassani Health operates across two distinct worlds that, until now, have never been connected:

**The upstream world** — where cannabis is cultivated, processed, and packaged into finished medicines. This is your GACP cultivation facility, your manufacturing floor, and your quality assurance chain.

**The downstream world** — where finished products are sold to resellers, dispensed to named patients, and invoiced. This is your sales team, your warehouse dispatch, your finance team, and your external reseller partners.

The Bassani Health Portal is the digital backbone of the downstream world, live and in use today. The Production Module (Phase 13) will be the digital backbone of the upstream world, and the two systems will connect at a single, auditable handoff point — the vault — where finished goods leave manufacturing and enter inventory.

The result is a complete, unbroken digital record from the moment a plant is seeded to the moment a medicine is dispensed to a named patient. This is what SAHPRA requires for full compliance, and it is what gives Bassani a defensible, auditable supply chain.

---

## The Problem Before This System

Before the portal, Bassani's commercial operations ran on a combination of Odoo (the financial system), email threads, WhatsApp messages, and verbal handoffs. The practical consequences:

- **Resellers had no self-service access.** Placing an order required emailing Bassani. Checking order status required calling someone. There was no single source of truth for what had been ordered, confirmed, or dispatched.
- **The sales and fulfilment pipeline existed only in people's heads.** There was no formal record of who received a quote, who confirmed it, whether a deposit had been received, or where an order was in the packing process.
- **Finance confirmed payments verbally.** Whether a customer had paid before an order was released was tracked informally, creating risk.
- **QA and RP approvals happened outside the system.** There was no digital record of who signed off on what and when — a significant compliance gap.
- **Audit logs identified "admin", not individuals.** When a record changed, there was no way to know which staff member made the change.
- **Commission for resellers was calculated manually.** There was no automated tracking of turnover, no formal statement, and no audit trail for payments.

---

## How the System Works Today (Downstream — Live)

The portal is the single interface through which all commercial operations are managed. Staff and resellers never need to log into the financial system directly; the portal does that on their behalf.

### For Resellers

A reseller partner logs into the portal and sees their own workspace:

- **Product catalogue** — only the products Bassani has enabled for resellers, with real-time stock figures from the warehouse. Where Bassani has set a minimum order quantity on a product, this is displayed on the product card and enforced when the reseller builds their order.
- **Customer management** — their onboarded customers, each with full account history, outstanding invoices, and account statements. Onboarding new customers goes through a structured five-step application process with mandatory documentation, reviewed and approved by Bassani admin.
- **Order placement** — select a customer, build an order from the catalogue, submit. The system checks stock availability, customer credit limits, and whether a valid Section 21 authorisation exists for controlled substances, before the order is accepted.
- **Commission dashboard** — monthly statements showing turnover, tier rate, and projected commission. Resellers can dispute statements or track payment history without calling Bassani.

### For the Sales Team

Every order — whether placed by a reseller or initiated by a direct customer inquiry — flows into the Sales Ticket pipeline:

1. **Open** — a customer inquiry arrives (by email or directly in the system)
2. **Quote** — the sales rep builds a formal quotation in the system, which is automatically sent to the customer via the company email address
3. **Sale Confirmed** — the customer accepts; the order is formally created in the financial system
4. **Deposit Registered** — if a deposit is required, finance registers it through the portal, which verifies against the actual financial record
5. **Confirmed WIP** — the order moves to the warehouse

The sales team can see every ticket in their queue, claim unassigned orders, and see the full history of every action taken on every order.

**Email inbox integration.** The portal includes a two-panel email inbox connected directly to Bassani's operational mailboxes (sales@ and orders@). Emails from customers and resellers arrive in the inbox alongside the corresponding ticket, so the sales team never needs to switch between the portal and a separate mail client to manage a customer conversation. Importantly, the pipeline does not depend on the inbox to function — orders can be created and processed entirely through the portal without any email ever arriving. The inbox connection is an operational convenience that reduces context-switching and keeps the full conversation history in one place. For reseller customer onboarding specifically, documents received by email can be saved directly to the pending application from inside the inbox view, rather than requiring a manual download and re-upload.

### For the Warehouse

When an order is confirmed, it appears automatically on the packing board — a large-screen display in the warehouse showing all orders queued for packing, with real-time updates.

- The **team leader** (warehouse supervisor) assigns orders to packers and manages the floor
- **Packers** use handheld devices to tick off each item as they pack it, with updates visible on the board in real time
- Once packing is complete, the order goes through **QA approval** (Cullen Grant) and **RP approval** (Rookshanna Hussain) — both are independent sign-offs recorded in the system with the approver's identity and timestamp
- Only after both approvals does the order reach **Ready for Collection / Dispatch**
- Warehouse supervisors receive an automatic notification when an order is cleared for dispatch

**Partial fulfilment and backorders.** When a confirmed order cannot be fully filled from current stock, the system handles the split without requiring manual intervention. It ships what is available immediately, automatically creates a backorder picking in the warehouse management system for the remainder, and adds a second entry to the packing board labelled "Waiting for Stock." The reseller receives an email showing exactly which items are shipping and which are backordered. When the backordered stock arrives and is reserved, a single button in the portal notifies the reseller and the internal team — no manual chasing is required. Invoicing is tied to collection: each delivery is invoiced only when the customer physically collects it, which means Bassani only invoices for what has actually been delivered. The Orders Clerk has a dedicated "Mark as Collected" action for each delivery, and the invoice is created in the financial system automatically on confirmation.

**Order Passport and reseller traceability.** Every order now has a single-page lifecycle view — the Order Passport — that shows the ticket stage, invoice status, deliveries, batch/lot numbers, and any outstanding backorder items in one place. Staff can reach it by scanning a barcode, typing an order reference, or typing an invoice number. On every order-related view (Sales Ticket list, ticket detail, order list, order detail, packing board, and backorders), the system now clearly identifies which reseller partner an order came from — even for resellers who are not on a commission arrangement. This means any staff member handling an order can immediately see its origin without having to look it up separately.

### For Finance

The finance team confirms payments through the portal. Critically, the system reads the actual financial record to verify payment status — if the financial system shows no payment recorded, the portal will not allow the payment to be confirmed. This closes the gap where orders were previously released based on verbal confirmation.

**Full invoice lifecycle without Odoo.** Finance can now manage the complete invoice lifecycle from the Invoices page — send an invoice to a customer, download the PDF, raise a credit note (created directly in the financial system, not just a request), or reset a draft invoice for correction. Invoices created directly in Odoo before the portal existed can be pulled into the ticket pipeline with a single "Create Ticket" action, ensuring nothing falls outside the tracked workflow.

**Bank reconciliation is now built into the portal.** Finance uploads a bank statement CSV (FNB Business or Nedbank Business format) and the portal auto-matches credits to open invoices by amount and reference. Finance reviews the matches, confirms them with a single click, and the payment is registered in the accounting system immediately — without anyone opening Odoo. The portal also runs a background check every 15 minutes and automatically advances any ticket where the payment has already been registered, eliminating the daily manual "confirm payment" step entirely for invoices processed outside the portal.

Commission statements for resellers are generated through the portal, and each payment produces a corresponding vendor bill in the financial system automatically — there is no manual ledger entry.

### For Management

Every action in the system is recorded in a permanent, tamper-evident audit log: who did what, when, from which device, and what the record looked like before and after. This log is available to management and can be filtered by date, staff member, or action type.

### Document Management and Version Control

Bassani's customer onboarding process requires four signed documents from every customer: the Customer Information Form, the NDA, the Store Onboarding Agreement, and the CIPC company registration certificate. Previously, the document templates were static files built into the system — updating them required a developer, a code change, and a redeployment.

The portal now includes a document template management module that gives Bassani's management team direct control over these documents:

- **Upload new versions directly** — if an agreement changes, the authorised system administrator uploads the new PDF and it is live immediately. No code change, no downtime, no developer involvement.
- **Full version history** — every previous version is permanently archived and can be downloaded or restored at any time. If a dispute arises, the system can show exactly which version of a document a customer received on a given date.
- **Documented change log** — each new version includes a release note (for example, "Updated POPIA clause, approved by legal team 2026-07-07"). This creates a clear business-level record of why a document changed.
- **Rollback in seconds** — if a version is uploaded in error, the previous version can be restored immediately from the version history panel.
- **Audit trail** — every upload and every rollback is recorded in the system's audit log with the name of the person who performed the action.

Alongside document versioning, the portal now includes a **multi-authority signing model**. Rather than a single global "signing authority" account, every authorised staff member (QA Manager, Responsible Pharmacist, or any admin with the signing authority permission) configures their own personal signature on their profile page. Each person uploads or draws their signature once; from that point on, their own name, title, and signature image are used whenever they countersign a document. Multiple people can hold this permission simultaneously and countersign different applications at the same time.

To prevent two signing authorities from countersigning the same application in parallel, the system includes an **application claim mechanism**. Any signing authority can claim an application — it shows as assigned to them in the applications list and on the detail page. If a second person opens the same application, they see who has claimed it and must explicitly confirm before countersigning. Claims are released automatically when countersigning is complete, or manually if the original person is unavailable.

The portal also includes a **test signing flow** for administrators. For each of the four onboarding documents, a single button opens a full-screen preview that shows exactly what the customer will see: a live PDF view on the left and a pre-filled signing form on the right. The form arrives populated with realistic dummy data, the Bassani signing block is completed automatically from the acting user's profile, and the administrator can draw a test signature and download the completed PDF. This allows the team to verify that field positions, signatures, and layout are correct before enabling the customer-facing signing flow — without involving a real customer.

**My Profile** is now accessible to all users via a profile icon in the top bar of every page. Staff can update their display name, change their password, and (if they hold the signing authority permission) manage their personal signature and document signing details. Sales agents can do the same for their own account settings.

---

## What the System Connects To

The portal sits as a managed layer between your staff/resellers and your financial system (Odoo). Staff interact with the portal; the portal reads and writes to Odoo on their behalf, ensuring that every order, invoice, stock movement, and payment is recorded in the authoritative financial system — never in a spreadsheet or email thread.

This means:

- All stock figures come from real warehouse data, not estimates
- All invoices and payments are in the financial system, not duplicated elsewhere
- All order confirmations create real sale orders in the financial system
- All commission payments produce real vendor bills in the financial system

---

## The Gap — And What Phase 13 Closes

The system described above is fully live and operational. It covers everything from the moment a finished product enters the vault to the moment it is invoiced and dispatched.

**What it does not yet cover is everything that happens before the product reaches the vault.**

Your cultivation facility produces cannabis batches. Those batches go through drying, manicuring, and processing stages. They are formulated, tested, approved by your Responsible Pharmacist, packaged, and labelled. Only then do they physically cross into the vault and become inventory. Today, none of this upstream journey is digitally recorded in a way that connects to the commercial system.

Phase 13 — the Production Module — changes this. It will:

- Track every cultivation batch from planting through harvest, with expected and actual yield recorded at each stage
- Record every manufacturing session across all eight logbooks currently maintained in Excel: drying, manicuring, crushing, pre-roll, gummy manufacturing, packing, and secondary packing
- Assign and track Bassani's confirmed batch ID scheme (already formalised in V6 of your internal Traceability Standard) automatically — the system generates the correct batch ID at each stage, eliminating the formatting inconsistencies already present in the live logbooks
- Gate the batch label on RP sign-off — the portal will not print a batch label until QA and RP approvals are both recorded. The label is printed directly from the portal onto Bassani's existing label printer. Because the portal generated the batch ID and printed the label, when the team leader scans it at the vault the system resolves it automatically — no manual entry, no transcription errors
- Connect the finished goods label — the same barcode and batch ID on the physical package — all the way back through to the cultivation batch it originated from, and forward to the sale order and named patient it was dispensed to

The result is a complete, unbroken chain: cultivation batch → manufacturing stages → RP sign-off → label printed by system → vault scan → Odoo inventory → sale order → delivery note → named patient.

---

## System Architecture — Full Picture

The diagram below shows how the upstream (Phase 13 — Production Module) and downstream (live portal) connect. The vault scanner is the physical junction point between the two worlds.

```
╔══════════════════════════════════════════════════════════════════════════════╗
║  UPSTREAM — PRODUCTION MODULE (Phase 13, planned)                           ║
║                                                                              ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │  CULTIVATION  (GACP Facility)                                       │    ║
║  │                                                                     │    ║
║  │  Grow rooms registered → Plant batches seeded → Vegetative stage   │    ║
║  │  → Flowering → Harvest → Yield recorded (expected vs actual)       │    ║
║  │  → Variance flagged if outside acceptable band                     │    ║
║  │                                                                     │    ║
║  │  Batch ID assigned:  BH + Strain Code + Sequence + Date            │    ║
║  │  Example:  BHAPIBBY-001-010126                                     │    ║
║  └───────────────────────────┬─────────────────────────────────────────┘    ║
║                              ↓                                               ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │  MANUFACTURING                                                      │    ║
║  │                                                                     │    ║
║  │  Drying (-D) → Unmanicured (-U) → Manicured (-M)                  │    ║
║  │  → Crushed (-MC) / Pre-Roll (-MCPR) / Trim (-T) / Pops (-P)       │    ║
║  │                                                                     │    ║
║  │  Batch suffix updated at each stage on the same Batch ID           │    ║
║  │  QA testing recorded → Responsible Pharmacist sign-off             │    ║
║  └───────────────────────────┬─────────────────────────────────────────┘    ║
║                              ↓                                               ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │  PACKING & LABELLING                                                │    ║
║  │                                                                     │    ║
║  │  Finished goods packaged                                           │    ║
║  │  → QA approval recorded in system (named, timestamped)            │    ║
║  │  → RP approval recorded in system (named, timestamped)            │    ║
║  │  → System unlocks "Print Batch Label" (only after both approvals) │    ║
║  │  → Label printed on Bassani's label printer directly from portal  │    ║
║  │     Contains: Batch ID barcode · strain · weight · RP sign-off   │    ║
║  │  → Label applied to physical product                              │    ║
║  └───────────────────────────┬─────────────────────────────────────────┘    ║
║                              ↓                                               ║
╚══════════════════════════════╪═══════════════════════════════════════════════╝
                               │
              ┌────────────────▼────────────────┐
              │         VAULT SCANNER           │
              │    (Phase 12 — In Progress)     │
              │                                 │
              │  Team leader scans batch label  │
              │  on arrival from production     │
              │                                 │
              │  → Reads Batch ID barcode       │
              │  → System auto-resolves batch   │
              │     back to production record   │
              │  → Records quantity received    │
              │  → Creates stock receipt        │
              │     in financial system         │
              │  → Production batch is now      │
              │     commercial inventory        │
              └────────────────┬────────────────┘
                               │
╔══════════════════════════════╪═══════════════════════════════════════════════╗
║  DOWNSTREAM — COMMERCIAL PORTAL (Live today)          ↓                     ║
║                                                                              ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │  INVENTORY                                                          │    ║
║  │                                                                     │    ║
║  │  Real-time stock per product, per warehouse, per batch/lot         │    ║
║  │  Staff see On Hand vs Forecasted (reserved) vs Available           │    ║
║  └───────────────────────────┬─────────────────────────────────────────┘    ║
║                              ↓                                               ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │  SALES PIPELINE                                                     │    ║
║  │                                                                     │    ║
║  │  Reseller order / Direct customer inquiry                          │    ║
║  │  → Quote built in portal (sent to customer automatically)          │    ║
║  │  → Deposit registered (verified against financial record)          │    ║
║  │  → Order confirmed → Sale order created in financial system        │    ║
║  │  → Section 21 authorisation validated (named patient orders)       │    ║
║  └───────────────────────────┬─────────────────────────────────────────┘    ║
║                              ↓                                               ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │  FULFILMENT                                                         │    ║
║  │                                                                     │    ║
║  │  Packing board → Packers tick items as packed                      │    ║
║  │  → QA Manager approval (recorded, timestamped)                     │    ║
║  │  → Responsible Pharmacist approval (recorded, timestamped)         │    ║
║  │  → Ready for Dispatch — supervisors notified automatically         │    ║
║  │  → Vault OUT scan confirms physical handoff at dispatch            │    ║
║  └───────────────────────────┬─────────────────────────────────────────┘    ║
║                              ↓                                               ║
║  ┌─────────────────────────────────────────────────────────────────────┐    ║
║  │  FINANCE & TRACEABILITY                                             │    ║
║  │                                                                     │    ║
║  │  Invoice generated in financial system                             │    ║
║  │  Payment confirmed against real financial record                   │    ║
║  │  Delivery note linked to:                                          │    ║
║  │    → Named patient                                                 │    ║
║  │    → Section 21 authorisation                                      │    ║
║  │    → Batch ID from production (Phase 13)                           │    ║
║  │  Reseller commission calculated → Statement generated → Paid       │    ║
║  └─────────────────────────────────────────────────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════════╝
```

**The complete traceability chain (once Phase 13 is live):**

> Cultivation Batch `BHAPIBBY-001-010126` → Drying → Manicuring → Packing → **QA approval** → **RP approval** → **Label printed by portal** (`BHAPIBBY-001-010126-MP3G`) → **Team leader scans label at vault** → Odoo inventory → Sale Order `S00142` → Delivery Note → Named Patient: John Smith → Section 21 Authorisation #SA-2026-0047

Every link in this chain is digital, timestamped, permanently recorded, and traceable in both directions. Given a named patient, you can trace back to the cultivation batch. Given a cultivation batch, you can trace forward to every patient who received medicine from it.

> **The label is the junction point.** The portal generates it after RP sign-off — not before. The vault scanner reads it — not a manual entry. This single physical object, printed by the system and scanned by the system, is what makes the upstream and downstream records one connected chain rather than two separate logs.

---

## Compliance — What This System Provides

Bassani Health operates under SAHPRA licensing for medicinal cannabis. SAHPRA aligns with the European pharmaceutical standard for computerised systems — a standard that governs exactly how software managing medicinal products must behave. The system is built to this standard from the ground up.

**Named users and defined roles.** Every person who interacts with the system has their own account with a defined role. There are no shared passwords and no generic "admin" accounts. Every action in the system is recorded against the specific person who performed it.

**Comprehensive audit trail.** Every record change in the system captures: who made the change, when, from which device, what the record looked like before, and what it looks like after. This log cannot be edited and is available to management at any time.

**Two-factor authentication.** Every login requires a one-time code sent to the user's email address, in addition to their password. Access cannot be gained with a stolen password alone.

**Independent approval chain.** Orders cannot be dispatched without independent QA and RP sign-off, each recorded as a separate, named action. These approvals cannot be bypassed or delegated through the system.

**Electronic signatures for critical sign-off.** When Phase 13 is built, all batch release approvals will use a formal re-authentication process at the point of signing — the same approach used by pharmaceutical software systems that have passed SAHPRA and EU GMP audit. This will be backported to existing QA/RP approvals on the dispatch side as well.

**Automated backups.** The system's database is backed up daily. There is no single point of failure.

---

## What Is Live Today

| Capability | Status |
|---|---|
| Sales Agent portal — product catalogue, order placement, commission (eligibility-gated per agent) | Live |
| Reseller quote flow — resellers build draft quotes via cart, manage them in My Quotes, edit/send/confirm without Bassani staff involvement; draft quotes hidden from staff queue until confirmed | Live |
| Minimum order quantities (MOQ) — per product, enforced in reseller order cart | Live |
| Customer onboarding — 5-step application, document collection, admin review | Live |
| Customer document upload request — admin sends a secure, time-limited upload link to an existing customer; status tracked on profile | Live |
| Sales ticket pipeline — inquiry → quote → deposit → confirm | Live |
| Email inbox integration — sales@ and orders@ mailboxes connected to the portal; documents saveable directly to onboarding applications from inbox | Live |
| Packing board — real-time warehouse floor with QA/RP approval | Live |
| Finance — invoice management, payment confirmation, credit limit enforcement | Live |
| Stock management — per-warehouse, real-time, with reservation visibility | Live |
| Stock Report — per-product lot/batch breakdown with movement history (traceability), warehouse-scoped | Live |
| Self-service customer registration — public /apply page with referral link support; applications land in existing admin review queue | Live |
| Document template management — version-controlled PDF uploads, rollback, audit trail; no redeployment required | Live |
| Multi-authority signing — every authorised staff member configures their own personal signature on their profile; multiple people can countersign simultaneously; application claim mechanism prevents accidental dual countersigning | Live |
| Test signing flow — super admin previews the exact customer signing experience for any document with pre-filled dummy data | Live |
| Controlled customer document signing — customer signs only the Customer Information Form during self-registration. Admin reviews the submission, generates pre-filled NDA and Store Agreement for internal review, then deliberately sends the signing link to the customer. Customer signs both documents in-browser via a secure 30-day link. No print/scan/upload at any stage. | Live |
| Application countersigning — signing authority reviews customer-signed PDFs and countersigns each Bassani signature block in-browser before approval; approve button gated on completion | Live |
| Countersign notification and welcome pack — when both NDA and Store Agreement are countersigned, a notification is sent automatically to configured recipients (Kashi and Dean). Dean then sends the customer a welcome pack email directly from the portal, with the countersigned documents and welcome letter attached. Approval is the final step after the welcome pack has been sent. | Live |
| Audit trail — named actor, before/after, every action | Live |
| Commission engine — turnover tracking, statements, dispute workflow | Live |
| Email notifications — all business events, configurable routing | Live |
| Supplier visibility — vendor bills, purchase history, goods receipts | Live |
| Product barcode — field exposed, scanning foundation in place | Live |
| Custom domain (portal.bassanihealth.com), SSL, 2FA | Live |
| Sales agent accounts — internal Bassani staff can hold sales agent accounts (managing customer portfolios) without appearing in commission statements; `commission_eligible` flag controls visibility and inclusion | Live |
| My Profile — all users manage their display name, password, and (if authorised) personal signature from a single profile page accessible via the top bar | Live |
| Phase 12 (partial): GS1 pharmaceutical label printing — warehouse staff can print GS1 DataMatrix unit labels and GS1-128 carton labels directly from the Products page to a Zebra ZT411 printer with one click. Live preview in the browser. Requires official GTINs from GS1 South Africa (registration process initiated). | In progress |
| Phase 12.5: GTIN Pool management — Bassani's purchased block of GS1 GTIN codes is tracked centrally in the portal. Staff can see at a glance how many codes are available versus assigned, upload new codes in bulk, and assign a code to a product directly from the Products page. Assignment writes the barcode field in Odoo automatically. No more spreadsheet tracking or risk of assigning the same GTIN twice. | Live |
| Phase 12.6: Global barcode search and order barcodes — any staff member can press `/` to focus a search bar that appears in every page header, then scan any barcode or type any reference. Scanning a product GTIN navigates instantly to that product. Scanning an order reference opens the linked sales ticket if one exists; for orders not yet in the portal pipeline, it filters the Orders list to that reference. Every ticket now displays a scannable Code 128 barcode of the order reference — warehouse staff can scan it from a tablet screen or printed packing slip to pull up the order with no typing. | Live |
| Backorders admin view — admin and warehouse supervisor can see every outstanding backorder demand across all customer orders in one place. Shows what is owed, to whom, in what quantity, and whether a manufacturing order exists. Toggle between a per-order view and an aggregate per-product view for production planning. Links directly to the relevant sales ticket. | Live |
| Batch/lot traceability on print documents — every A4 document generated by the portal (order view, packing slip, invoice) now shows the Bassani batch ID(s) physically dispatched with that order. Sourced directly from Odoo's lot tracking on the delivery picking. This is the paper-level end of the traceability chain: batch label on product → delivery picking in Odoo → batch ID on invoice and order document → named patient on file. | Live |
| Manufacturing order visibility — when Odoo automatically creates a replenishment manufacturing order for a backordered product, that information is now visible in the portal without opening Odoo. Staff can see the MO reference, its current state (Confirmed, In Progress, To Close), how many units are currently being produced, and the planned finish date. This appears on the backorders view, on the sales ticket detail, and inside the Orders packing board waiting-for-stock panel. No more opening Odoo to check whether production has been triggered. | Live |
| Phase 13: Production and cultivation module | Proposal stage |
| Phase 14: External ecommerce API — WooCommerce product sync and order intake for third-party online stores | Concept stage |

---

## Phase 13 — The Proposal

Building the Production Module in-house, integrated directly into this system, gives Bassani several advantages over a third-party platform:

**Full data ownership.** All cultivation and manufacturing records sit in Bassani's own system, not a vendor's cloud. If a third-party platform changes its pricing, discontinues a feature, or goes offline, Bassani's compliance records are unaffected.

**Native integration with the commercial side.** The batch ID assigned at cultivation is the same identifier that appears on the delivery note and is traceable back through the system. There is no manual data import or reconciliation step between a production platform and a sales platform.

**One audit trail, one compliance record.** SAHPRA requires a single, coherent record of the full supply chain. Two separate systems produce two separate audit trails that must be reconciled. One integrated system produces one complete trail with no gaps.

**The label printer is already in your building.** Bassani already has a label printer in active use for production batch labels. Phase 13 connects it directly to the system — the portal generates the label after RP sign-off and sends it to the printer. No new hardware, no third-party label software, no separate system to maintain. A standalone production platform cannot do this without a separate integration to your label printer and your vault scanner and your commercial system. In this system, all three are the same system.

**Built to SAHPRA standard from day one.** The system's existing architecture already satisfies the majority of the applicable compliance requirements. Phase 13 layers cultivation-specific data onto infrastructure that was built with this purpose in mind.

**Cost.** A purpose-built integrated module is a one-time development cost. A third-party platform is a recurring subscription for as long as Bassani operates, with pricing that Bassani does not control.

---

*For technical documentation, API references, and the full phase-by-phase roadmap, see `PRODUCTION_ROADMAP.md`.*

*For the full automated email reference and system configuration guide, see `BASSANI_HEALTH_USER_MANUAL.md`.*
