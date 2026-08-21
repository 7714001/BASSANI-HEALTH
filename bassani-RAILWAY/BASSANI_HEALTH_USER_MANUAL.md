# Bassani Health Portal — User Manual

**System:** Bassani Health B2B Sales & Reseller Portal  
**Audience:** Super Admins, Operations Staff, Resellers  
**Last Updated:** 19 July 2026

---

## How to Use This Manual

This document is organised in two parts. **Part 1** is the setup guide for the super admin — the person responsible for getting the system configured correctly before anyone else logs in. **Part 2** is the operational guide — day-to-day instructions for each role in the business.

If you are taking over as super admin, read Part 1 from start to finish before doing anything else.

If you are a staff member or reseller, jump to the section that matches your role.

---

# Part 1 — Getting Started (Super Admin Setup)

## What Is This System?

The Bassani Health portal is the internal operating system for Bassani Health. It sits between your staff/resellers (who use it) and Odoo (which stores all the financial and inventory data). Think of it as the control panel — staff never need to log into Odoo directly. Everything from placing an order to registering a payment to managing reseller commissions happens here.

**One important rule to understand:** Odoo is always the source of financial truth. The portal reads from and writes to Odoo behind the scenes. If something looks wrong in the portal, the first place to verify is Odoo. The portal never makes up financial data — it only surfaces what Odoo knows.

---

## Step 1 — Set Your Environment Variables in Railway

Before the first user logs in, the following must be set in Railway's environment variable panel. If any of these are missing the system will either fail to start or behave incorrectly.

| Variable | What It Does | How to Generate |
|---|---|---|
| `SUPER_ADMIN_USERNAME` | Your super admin login username | Choose a secure username (e.g. `bassani.superadmin`) |
| `SUPER_ADMIN_PASSWORD` | Your super admin login password | Use a strong password — at least 16 characters |
| `SUPER_ADMIN_EMAIL` | Email address of the super admin account | Used to deliver 2FA OTP codes to the super admin |
| `JWT_SECRET` | Signs all login tokens — must be secret | Run `openssl rand -base64 48` in any terminal |
| `ODOO_URL` | URL of your Odoo instance | e.g. `https://bassanihealth.odoo.com` |
| `ODOO_DB` | Your Odoo database name | Found in Odoo's Settings → Database |
| `ODOO_USERNAME` | Odoo API user email | A dedicated Odoo API user — not your personal login |
| `ODOO_PASSWORD` | Odoo API user password | Set in Odoo → Settings → Users |
| `MONGODB_URL` | Your Railway MongoDB connection string | Provided automatically by Railway MongoDB plugin |
| `RESEND_API_KEY` | Sends all system emails (notifications, OTP codes) | From your Resend.com account dashboard — must match the account where `bassanihealth.com` is verified |
| `REQUIRE_2FA_ADMIN` | Enables email OTP two-factor authentication for all accounts | Set to `true` to enforce 2FA for every user with an email address |
| `CORS_ORIGINS` | Which browser origins can call the API | Set to your portal URL e.g. `https://portal.bassanihealth.com` |
| `MS_TENANT_ID` | Azure Tenant ID — **optional fallback only** | Preferred path: configure via Settings > Connected Mailboxes (stored in DB, no restart needed) |
| `MS_CLIENT_ID` | Azure Client ID — **optional fallback only** | Preferred path: configure via Settings > Connected Mailboxes |
| `MS_CLIENT_SECRET` | Azure Client Secret — **optional fallback only** | Preferred path: configure via Settings > Connected Mailboxes |
| `MS_SHARED_MAILBOX` | Shared mailbox address — **optional fallback only** | Preferred path: configure via Settings > Connected Mailboxes |
| `R2_ACCOUNT_ID` | Cloudflare R2 account identifier — used to build the endpoint URL | Found on your Cloudflare R2 dashboard → Account Details |
| `R2_ACCESS_KEY_ID` | R2 API access key ID (S3-compatible) | Generated in the Cloudflare R2 dashboard → API Tokens tab |
| `R2_SECRET_ACCESS_KEY` | R2 API secret access key | Generated alongside `R2_ACCESS_KEY_ID` — shown once, copy immediately |
| `R2_BUCKET` | Name of the R2 bucket that stores all uploaded documents | Must match the bucket you created in the Cloudflare R2 dashboard (e.g. `bassani-health-docs`) |
| `R2_ENDPOINT` | Full S3-compatible endpoint URL for your R2 bucket | Format: `https://<R2_ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `SENTRY_DSN` | Error monitoring | From your Sentry.io project settings (optional but recommended) |

> **Security note:** The system will refuse to start if `JWT_SECRET` is still set to its default placeholder. This is intentional — a weak JWT secret is a serious security risk.

> **After your first deploy**, the legacy `admin/admin123` account is automatically deactivated. This happens on every startup — you do not need to do this manually.

---

## Step 2 — Log In as Super Admin and Change Your Password

1. Navigate to the portal at `https://portal.bassanihealth.com`
2. Enter the username and password you set in Step 1
3. If `REQUIRE_2FA_ADMIN` is enabled and your account has an email address, the system will not issue a session yet — instead it sends a 6-digit code to your email and displays a verification screen
4. Enter the code from the email. The code expires in 10 minutes and allows 3 attempts before the session is invalidated (you must sign in again)
5. Once verified, you are logged in
6. If this is a first-time login with a temporary password, the system will immediately redirect you to a mandatory password change screen before you can access anything

> **The super admin account cannot be deactivated or edited by anyone else.** Only you can change its password. Keep these credentials in a secure password manager.

> **Accounts without an email address are not subject to 2FA** — this applies to warehouse floor accounts (packers, supervisors) where email delivery is impractical. Any account with an email address will require 2FA when the flag is enabled.

---

## Step 3 — Configure Your Warehouses

Before creating any users or resellers, make sure your warehouses are set up correctly. The system's stock figures, order routing, and packing board all depend on warehouse configuration.

1. Go to **Warehouses** in the left sidebar (only visible to super admin)
2. The system reads warehouses directly from Odoo — they should appear automatically
3. Set a **Default Warehouse** — this is the system-wide fallback used whenever no specific warehouse has been selected. Stock reads, order routing, and the product catalogue all fall back to this warehouse for any user who does not have a warehouse explicitly assigned or selected.
4. For each physical warehouse/vault, generate a **Display Token** — this is the unique URL your 85" packing board screen will use (no login required on the screen, just the token in the URL)
5. Keep a record of each warehouse's display token URL somewhere safe

> **Each warehouse gets its own packing board screen and its own display token.** If you have two vaults, you need two screens, two tokens, and two URLs.

> **The warehouse selector in the top navigation bar** is visible to all staff roles (admin, sales, finance, etc.) and lets them switch between warehouses for stock queries. It is not visible to sales agents (reseller role) — their warehouse is governed by their profile assignment, falling back to the global default set above.

---

## Step 4 — Create Your Staff Accounts

Go to **Users** in the sidebar. Create accounts for every person who will use the system. Use the role guide below to assign the right role to each person.

### Role Reference Table

| Role | What They Can Do | Named Person |
|---|---|---|
| `admin` | Full portal access with configurable permissions | Various |
| `sales` | Sales Tickets only — direct inquiries and quote building | Merveille |
| `orders_clerk` | Orders Tickets only — packing pipeline management | Tshidi |
| `finance` | Register invoice payments on tickets at Ready for Collection stage | Kashi, Ragini |
| `qa_manager` | Approve orders from a QA perspective before completion | Cullen Grant |
| `responsible_pharmacist` | Approve orders from an RP perspective before completion | Rookshanna Hussain |
| `warehouse_supervisor` | Packing floor — assign packers, manage queue, see full board | Warehouse supervisor |
| `packer` | Packing floor — see own assigned orders, tick items | Individual packers |
| `reseller` | Place orders, onboard customers, view commissions | External resellers |

### How to Create a Staff Account

1. Click **Add User**
2. Choose the role from the dropdown
3. Enter a username (no spaces — use dots, e.g. `merveille.sales`)
4. Enter a temporary password — the person will be forced to change it on first login
5. Enter their email address — they will receive a welcome email and any notifications
6. For `warehouse_supervisor` and `packer` roles, select which warehouse they belong to
7. Click **Create**

> **Only the super admin can create admin accounts.** Regular admins can create warehouse supervisors and packers, but not other admins. Nobody can create a second super admin via the portal.

> **Every new account requires a password change on first login.** The system enforces this — the user cannot access anything until they set their own password. Admin-set temporary passwords are shown once on creation and cannot be retrieved again.

### Configuring Admin Permissions

When you create an admin account, the default permissions are conservative — they can view most things but cannot perform sensitive operations (confirm orders, generate commission statements, record payments, etc.).

To customise an admin's permissions:
1. Open the **Users** list
2. Click **Edit** next to the admin account
3. The **Permissions** panel shows every available action grouped by domain
4. Toggle on the specific permissions this person needs
5. Save

> **You cannot edit your own permissions.** This prevents accidental privilege changes. If you need to review what the super admin can do — the answer is everything, unconditionally.

---

## Step 5 — Set Up Commission Tiers

Before any reseller can earn commissions, you need to configure the tier bands. Go to **Commission** → **Tier Settings**.

Commission is calculated as a percentage of the reseller's monthly turnover (excluding cancelled orders). "Turnover" means every order for a customer linked to that reseller, whether the reseller placed it themselves or Bassani staff took the order directly on the customer's behalf — commission follows the customer relationship, not who happened to click "place order." Linking an existing customer to a reseller only counts their orders from the date of the link onward, never retroactively. You have full control over the tier structure — add as many tiers as needed, set the turnover brackets, and assign a rate to each.

**How to configure tiers:**

Each row in the tier table has four fields:
- **Label** — a name shown to agents (e.g. "Tier 1", "Bronze", "Standard")
- **From** — the minimum turnover for this tier (read-only, auto-derived from the previous tier's upper limit)
- **Up To** — the upper turnover threshold. The last tier always shows "Unlimited" and cannot be changed
- **Rate** — the commission percentage that applies to agents in this bracket

**Adding a tier:** Click **Add Tier** at the bottom of the table. A new row is added with "Unlimited" as its upper limit. Set a maximum threshold on the tier above it to define where the new tier begins.

**Removing a tier:** Click the delete icon on any row. The tier below it automatically inherits the removed tier's lower bound. You must have at least one tier at all times.

Example setup matching a typical reseller agreement:

| Label | From | Up To | Rate |
|---|---|---|---|
| Tier 1 | R0 | R300,000 | 2.5% |
| Tier 2 | R300,000 | R500,000 | 5% |
| Tier 3 | R500,000 | R750,000 | 7.5% |
| Tier 4 | R750,000 | R1,000,000 | 10% |
| Tier 5 | R1,000,000 | Unlimited | 12.5% |

Click **Save Tiers** to apply. Every save is recorded in the audit trail with the full before and after structure and the name of the person who made the change. Click **Reset to Defaults** to revert to the five-tier structure above.

---

## Step 6 — Create Your Sales Agent Accounts

Sales agents are the people who place orders on behalf of customers through the portal. There are two kinds:

- **External agents** — reseller partners who earn commission on their turnover. These require an Odoo vendor partner link so a vendor bill can be raised when a commission statement is paid.
- **Internal agents** — Bassani staff who manage a portfolio of customers through the portal but do not participate in the commission programme. These do not require an Odoo partner and are excluded from commission statements automatically.

The distinction is controlled by the **Applicable for commission** checkbox in the wizard. It defaults to on (ticked). Untick it for internal staff accounts.

To add a sales agent — go to **Sales Agents** in the sidebar and click **Add Sales Agent**. The wizard has 4 steps:

**Step 1 — Odoo Partner**

The first control on this step is the **Applicable for commission** checkbox. Make your decision here before proceeding:

- **For external (commission-eligible) agents:** Leave the checkbox ticked. An Odoo partner search field appears below. Search Odoo partners by name — results show whether each partner is a Customer, Supplier, or both. Select the correct partner (their business details will pre-fill on Step 2).

  **Why the Odoo partner link is required for commission agents:** When a commission statement is paid, the system creates a vendor bill in Odoo against the agent's partner record. Without this link, Odoo cannot raise the bill. The partner does not need to be set up as a supplier in Odoo — a customer-only partner works just as well.

  **If the customer does not yet exist in Odoo:** Do not try to create them here. Complete their customer onboarding first via Customer Applications, wait for approval (which creates the Odoo customer record), then return to this wizard to create the sales agent.

- **For internal (non-commission) agents:** Untick the checkbox. The Odoo partner search is hidden — no partner link is required for internal staff.

> **Documents are not uploaded in this wizard.** Onboarding documents (NDA, Store Onboarding Agreement, etc.) are managed through the Customer Applications flow, not through the Sales Agent creation wizard.

**Step 2 — Business Details**
Review and adjust the name, email, phone, and seller code. For commission-eligible agents, these pre-fill from the selected Odoo partner (including VAT number, on Step 4, if the partner has one set in Odoo). The seller code is the unique lookup key used throughout the system (e.g. `ABC001`).

Optionally set the **Legal Entity Type** — Private Company (Pty) Ltd, Close Corporation (CC), Sole Proprietor, Partnership, or Other. Leave it unset if you're not sure; the wizard behaves exactly as before. Selecting **Sole Proprietor** changes what Step 4 asks for (see below) — use this for an individual agent rather than a registered company.

**Step 3 — Login Credentials**
Set the portal username and password. The agent will be required to change their password on first login.

**Step 4 — Financials**
For a company entity type (or no entity type set), enter the Company Registration Number. For a **Sole Proprietor**, this field is replaced with an **ID Number** field instead — enter the agent's 13-digit South African ID number (validated automatically). VAT details and banking information are entered the same way regardless of entity type — VAT registration is optional for everyone, and banking details are always required since that's where commission gets paid out.

Click **Create Sales Agent** on the final step. A welcome email is sent automatically to the agent's email address.

> **For non-commission internal agents,** the banking section on Step 4 is still visible but optional — fill it in only if relevant.

---

## Step 7 — Configure the Packing Board Screens

Each warehouse's 85" display screen connects to the packing board via a display token URL — no login required on the screen itself.

The URL format is:  
`https://yourportal.railway.app/packing-board.html?token=<DISPLAY_TOKEN>`

1. From the **Warehouses** page, copy the display token for each warehouse
2. Open a browser on each display screen and navigate to the URL above
3. The board will connect automatically and display queued/packing/ready orders for that warehouse
4. The screen auto-reconnects if the connection drops — no maintenance required

Packers use `packer.html` on their handheld devices. Warehouse supervisors use `supervisor.html`. Both require their own portal login (packer or warehouse_supervisor role).

---

## Step 8 — Verify Email Sending

All system emails go through Resend. Before go-live, confirm that:

1. The Resend API key is set in Railway environment variables
2. The sending domain (`bassanihealth.com`) is verified in the Resend dashboard
3. Send a test order from a reseller account and verify the confirmation email arrives

Until the domain is verified, emails will send from Resend's sandbox domain. Real customers will not receive them correctly.

---

## Step 8a — Configure Email Routing (Super Admin)

The portal sends automated notifications to different recipients depending on the event. You can override and extend these without touching Railway environment variables.

Go to **Settings > Email Notifications** (requires the `settings.manage` permission — Super Admin has it by default, and it can be granted to individual admin accounts via the Users permission panel). Notifications are organised into a sidebar of four groups — click a group to see just its notifications:

**Previewing what a notification actually looks like:** Type an email address into the **Test email address** field at the top of the page, then click **Send Test** on any notification card. A real copy of that email is sent immediately to the address you entered, filled in with sample data (a fake customer, order reference, etc.) so you can check the wording and layout without waiting for the real event to happen. Sending a test never touches real customer or order data and has no effect on the actual notification recipient list.

**Onboarding & Applications**
- **New Customer Application** — a reseller submits an onboarding application. Falls back to the `SUPPORT_EMAIL` env var if this list is empty.
- **Application Stalled (4+ Hours)** — a submitted application has gone 4+ hours with no signing documents generated. Checked every 30 minutes; each stalled application is only escalated once. Empty list = no check runs.
- **Countersigning Needed** — a customer has submitted signed copies of both onboarding documents (NDA and Store Onboarding Agreement) and they're ready for a signing authority to countersign.
- **Onboarding: Documents Countersigned** — both documents have been countersigned by a Bassani signing authority. Typically Kashi and Dean, so the welcome pack can be sent.

**Orders & Fulfilment**
- **QA Approval Needed** — an order has been packed and is ready for QA inspection. Typically the QA manager.
- **RP Approval Needed** — an order has been packed and is ready for Responsible Pharmacist inspection. Typically the RP.
- **Daily Digest: Outstanding Inspections** — sent automatically at 17:00 every day, listing every order still awaiting QA or RP sign-off that wasn't looked at. Only sends if there's at least one outstanding order.
- **Order Ready for Collection** — an order passes QA and RP review and is cleared for dispatch. All portal users with the `warehouse_supervisor` role are notified automatically; add extra addresses here for distribution lists or staff without portal accounts (e.g. `warehouse@bassanihealth.com`).
- **Order CC** — CC'd on every "Order Received" and "Order Confirmed" email sent to resellers. Useful for an operations inbox or account management team.
- **Daily Digest: Backorders** — sent automatically at 17:00 every day, listing every order currently waiting on stock. Only sends if there's at least one order on backorder.

**Finance**
- **Finance: Payment Auto-Confirmed** — the portal detects a paid invoice from bank records and auto-confirms the ticket automatically.

**Production & Vault**
- **Production: Stock Received Without Purchase Order** — an S6 import receipt is recorded with no matching purchase order. Typically the compliance officer.

> **How to add an address:** Type the email and press Enter or comma. Click the tag to remove it. Press **Save Changes** when done — this saves every group's settings at once, not just the group you're currently viewing. Changes take effect immediately for all future notifications.

---

## Step 8b — Manage Onboarding Document Templates (Super Admin)

The three Bassani-issued onboarding PDFs — Store Onboarding Agreement, Customer Information Form, and NDA — and the four Welcome Pack documents can all be updated directly from the portal without any code change or redeployment.

Navigate to **Admin > Document Templates** in the left sidebar (visible to Super Admin only).

### What You See

The three PDF documents (NDA, Store Onboarding Agreement, Customer Information Form) each appear as a card showing:

- **Active version badge** — the current version number (v1, v2, v3…) in green
- **Uploaded by / date / file size** of the current active version
- **Release note** — any notes the uploader added when publishing this version
- **View / Download current** — access the active version directly
- **Upload new version** — publish a new PDF (super admin only)
- **Version count** — click to expand the full version history

The **Welcome Pack** appears as a single card (teal icon) containing four independently managed document slots:

| Slot | File type |
|---|---|
| Help Me Budget | Excel (.xlsx / .xls) |
| Welcome Letter | PDF |
| Price List | PDF or Excel |
| Product Brochure | PDF |

Each slot has its own version history, upload date, and rollback. Updating one slot has no effect on the others. An amber "missing" count is shown on the card header if any slot has not yet had a file uploaded.

If no version has been uploaded for a slot yet, an amber warning appears on that slot.

### Uploading a New Version (PDF documents)

1. Click **Upload new version** on the relevant document card
2. Click the upload area to choose a PDF file from your computer
3. Add an optional release note — record what changed, for example "Updated POPIA clause, signed off by legal team 2026-07-07"
4. Click **Upload and activate**

The new version is live immediately.

### Updating a Welcome Pack Document

Each Welcome Pack slot is updated independently:

1. On the Welcome Pack card, find the slot you want to update (e.g. Price List)
2. Click **Upload new version** on that slot
3. Select the file — the upload area shows the accepted format for that slot
4. Add an optional release note, for example "Updated pricing for Q3 2026"
5. Click **Upload and activate**

The new version for that slot is live immediately. All other slots are unaffected. When the next welcome pack email is sent, the active version from each slot is attached automatically.

### Version History and Rollback

Click the version count at the bottom-right of any card or slot to expand the full version history. Each row shows the version number, upload date, uploader, file size, and release note.

- **Download** any archived version to verify its content before restoring it
- **Activate** any non-active row to roll back to that version — it becomes the active version immediately and the current version is archived

Versions are never deleted. Every version uploaded is permanently stored and can be retrieved at any time.

### Audit Trail

Every upload and every activation is recorded in the portal's audit log. The entry captures who performed the action, which document and version were affected, and any release notes provided. This creates a full paper trail of document changes — important for compliance purposes.

### Testing the Signing Flow (Super Admin)

Once a document has active AcroForm fields and an active version uploaded, you can preview the exact experience a customer will have when signing — with realistic dummy data pre-filled and Bassani's block completed automatically.

Click the **Test signing flow** button on any document card (visible to super admin only, requires an active version).

A full-screen panel opens:
- **Left side** — live PDF preview of the current document
- **Right side** — a pre-filled form grouped by section, plus a signature canvas at the bottom

The form arrives pre-filled with realistic test data (company name, registration number, contact details, address). For co-signed documents, the **Bassani Health** card at the top shows the signing authority profile that will be auto-embedded — name, title, and today's date. If the signing authority has not been configured, an amber warning appears.

Edit any form field if you want to test with specific data. Draw a test signature on the canvas. Click **Download signed test PDF** to generate the completed document — this runs the same PDF generation pipeline the customer will use: fields filled, signature embedded in the correct position, Bassani's block completed, document flattened, and a "TEST DOCUMENT - NOT FOR USE" watermark applied.

The downloaded PDF is the exact output the customer will receive. Use this to verify that all fields line up correctly, the signature fits the allocated space, and the document reads as intended before enabling the customer signing flow.

---

### Step 8c — Set Up Signing Authorities (My Profile)

The portal uses a **per-user signing model**. Every person who needs to countersign onboarding documents on behalf of Bassani Health configures their own personal signature on their own profile page. Multiple people can hold signing authority simultaneously — they work independently, on different applications, without any conflict.

The `signing_authority.sign` permission controls who can configure a signature and countersign applications. By default it is on for the `qa_manager` and `responsible_pharmacist` roles. It can be toggled on or off for individual admin accounts from the Users permission panel.

#### Who needs to complete this setup

Every person who holds the `signing_authority.sign` permission must complete their own profile setup before they can countersign an application. The checklist has three items:

1. **Signing name** — their full name as it should appear on the signature block
2. **Signing title / position** — e.g. Responsible Pharmacist, QA Manager, Chief Executive Officer
3. **Signature image** — a drawing or upload of their personal signature

The profile page shows a **Signature Status** badge that reads "Configured" only when all three are in place. The Countersign button on an application will not work without all three.

#### How each person sets up their signature

1. Click the **person icon** in the top right of any page, or navigate to `/profile` directly
2. On the profile page, scroll to the **Signing Authority** card (visible only to users with the `signing_authority.sign` permission)
3. Fill in:
   - **Signing Name** — full name as it should appear on documents
   - **Title / Position** — their role title (e.g. Responsible Pharmacist)
4. Choose how to provide their signature:

   **Option A — Upload a photo or scan (recommended)**
   
   Sign your name on plain white paper with a dark pen. Take a clear photograph or scan it. Upload the image file (PNG, JPG, or WebP).
   
   After uploading, toggle **Remove white background** on to strip the paper colour — the signature will appear as clean dark ink on document pages. Use the **Sensitivity** slider to adjust how aggressively the background is removed. Click **Re-apply** to preview before saving. A scanned pen signature always looks more professional on documents than a drawn one.

   **Option B — Draw in the app**
   
   Switch to **Draw** and use a mouse, trackpad, or finger to draw your signature on the canvas. Click **Clear** to start again. This works on any device but produces a lower quality result than a scanned signature.

5. Click **Save Changes** — this saves the signing name, title, and signature image in one step. The Signature Status badge on the left updates to "Configured" when all three fields are present.

#### Replacing a signature

Return to **My Profile** at any time and repeat the upload or draw step, then click **Save Changes**. All future countersignatures use the new image. Already-completed signed documents stored in the system are not affected.

> **Security note:** Signature images are stored in secure cloud storage (Cloudflare R2), keyed per user. No other staff member can view or download another person's signature image through the portal.

#### What the "Configured" status means

The Signature Status badge on the My Profile sidebar shows:
- **Configured** (green) — signing name, signing title, and signature image are all present. Ready to countersign.
- **Incomplete** (amber) — one or more fields are missing, with the missing items listed. The countersign button on applications will not work until all three are set.

#### Granting or revoking signing authority

Go to **Users**, open the user's permissions panel, and toggle **signing_authority → sign** on or off. The change takes effect immediately — the user's profile page will show or hide the Signing Authority card on their next page load.

---

## Automated Email Reference

The table below documents every automated email the portal sends, when it fires, and who receives it.

| Email | Trigger | Recipient(s) |
|---|---|---|
| **Welcome to Bassani Health** | A super admin or admin creates a new staff account | The new staff member (their registered email) |
| **Your sign-in code** | A user with 2FA enabled logs in | The user logging in |
| **Order Received** | A reseller submits a new order through the portal | The reseller + Order CC list (if configured) |
| **Order Confirmed** | An admin or sales staff confirms the order (converts quotation to sale order) | The reseller + Order CC list (if configured) |
| **Order Cancellation** | An admin or sales staff cancels an order | The reseller |
| **New Assignment** | A sales ticket is assigned to a staff member | The assigned staff member |
| **New Customer Application** | A reseller submits an onboarding application | Addresses in the Application Submitted list (or `SUPPORT_EMAIL` fallback) |
| **Customer Approved** | An admin approves an onboarding application | The reseller who submitted it; optionally the customer contact email |
| **Application Not Approved** | An admin rejects an onboarding application | The reseller who submitted it |
| **Onboarding docs received** | Admin saves signed documents to a reseller's draft application | The reseller — with a direct link to resume and complete the application |
| **Your onboarding documents** | A reseller sends docs to a customer in the onboarding wizard | The customer email address entered by the reseller |
| **Commission Statement Ready** | An admin generates a monthly commission statement | The reseller |
| **Commission Paid** | An admin marks a commission statement as paid | The reseller |
| **Commission Dispute Resolved** | An admin resolves a commission dispute | The reseller |
| **Packing Started** | An orders clerk marks a reseller order as packing | The reseller who placed the order + Order CC list (if configured) |
| **Ready for Collection** | An order passes both QA and RP approval on the packing board | All `warehouse_supervisor` portal users + any extra addresses in the Order Ready list |
| **Order Ready for Collection** (reseller) | Same mark-complete event on a full-delivery reseller order | The reseller who placed the order + Order CC list (if configured) |
| **Daily Digest: Production Orders (MOs)** | Automatic, every day at 17:00, if at least one Manufacturing Order is still in progress | Addresses configured in Settings > Email Notifications > "Daily Digest: Production Orders (MOs)" |

**Notes:**

- All emails are sent from `noreply@bassanihealth.com` via Resend. The sender name is always "Bassani Health".
- No email ever contains Odoo, MongoDB, or internal system names. Internal identifiers appear in the portal only.
- If the Resend API key is missing or set to a placeholder, email sends are skipped silently and logged to the Railway console. No crash, no blocked response.
- The customer approval email optionally copies the customer's own contact email. This only fires if the application includes a contact email address.

---

## Step 9 — Enable Error Monitoring (Sentry)

1. Create a free account at sentry.io
2. Create a new project (Python)
3. Copy the DSN value
4. Add it to Railway as `SENTRY_DSN`
5. Set up an email alert in Sentry for "first occurrence of a new error"

Once set up, any unhandled error in the portal will be captured automatically and you will receive an email alert. This is how you find out when something breaks before a user reports it.

---

## Step 10 — Enable MongoDB Backups

1. Open the Railway MongoDB plugin in your Railway project
2. Navigate to the **Backups** tab
3. Enable daily scheduled backups
4. Confirm a backup appears the following day

MongoDB is your portal's primary database — it stores reseller profiles, commission records, onboarding applications, audit logs, tickets, and the packing queue. Back it up daily.

---

## Before Go-Live Checklist

- [ ] All environment variables set in Railway (including the 5 R2 variables)
- [ ] R2 bucket created in Cloudflare and named to match `R2_BUCKET`
- [ ] Super admin password changed from temporary
- [ ] `REQUIRE_2FA_ADMIN=true` set in Railway and OTP email delivery confirmed working
- [ ] `SUPER_ADMIN_EMAIL` set so super admin receives OTP codes
- [ ] `CORS_ORIGINS` set to `https://portal.bassanihealth.com`
- [ ] Warehouses configured and display tokens generated
- [ ] Packing board screens connected and tested
- [ ] All 6 named staff accounts created (Merveille, Tshidi, Kashi, Ragini, Cullen Grant, Rookshanna) with correct email addresses for 2FA delivery
- [ ] Commission tiers configured to match reseller agreements
- [ ] All reseller accounts created with correct Odoo partner IDs and assigned warehouses
- [ ] Resend domain (`bassanihealth.com`) verified in the same Resend account as the API key in Railway
- [ ] Test OTP sign-in flow for each staff account
- [ ] Sentry DSN added to Railway
- [ ] MongoDB daily backups enabled
- [ ] At least one full order flow tested from quote to completion
- [ ] Sales Inbox connected (configure via Settings > Connected Mailboxes — Office 365 with Azure credentials, or IMAP)

---

# Part 2 — Operational Guide

## Understanding the Order Pipeline

Every order in Bassani Health — whether placed by a reseller online or brought in by Merveille from a customer email — flows through the same pipeline:

```
INQUIRY → QUOTE → SALE ORDER → AWAITING DEPOSIT → CONFIRMED WIP → PACKING → QA + RP APPROVAL → COMPLETE
```

Each step is handled by a different team member, and the portal enforces that no step is skipped. Here is how real orders move through the system:

**Example: A pharmacy emails Merveille asking to order 500 units of a tincture.**

1. Merveille creates a **Sales Ticket** (Direct Inquiry) and builds a quote in the portal — no Odoo needed
2. The quote is emailed to the pharmacy directly from the ticket
3. The pharmacy confirms — Merveille advances the ticket to Sale Order stage
4. Merveille confirms the order from the ticket — Odoo creates a confirmed sale order. The customer is automatically emailed a pro-forma invoice showing the 50% deposit due. The ticket sits at **Awaiting Deposit** — it does **not** go to the packing board yet.
5. The pharmacy pays the deposit. Finance (Kashi or Ragini) registers it on the ticket — this creates the down payment invoice and payment record in Odoo automatically, and is what actually queues the order for packing. There is no way to skip this step, for any order.
6. Tshidi sees the order in her Orders Tickets and marks it as Packing
7. The warehouse packs the order — the packer ticks items on their handheld
8. When packing is done, Tshidi marks it Ready
9. Cullen approves from a QA perspective; Rookshanna approves from an RP perspective
10. Tshidi marks it Complete — the (remaining balance) invoice is created in Odoo automatically and the ticket advances to Ready for Collection
11. Finance sees the invoice on the ticket and registers the balance payment when it arrives — no Odoo needed
12. Customer collects their order — Tshidi marks it Collected — Merveille's Sales Ticket automatically updates to Complete

**Example: A reseller places an order online.**

1. Reseller logs in, browses the catalogue, and places an order — a Sales Ticket is created automatically
2. The ticket is unassigned — Merveille sees it in her queue and claims it
3. She confirms the order from the ticket — the customer gets the pro-forma invoice email automatically and the ticket sits at Awaiting Deposit
4. The rest of the flow is identical: Finance registers the deposit (queues packing) → packing → QA/RP → Mark Complete (balance invoice created) → Finance confirms balance payment → customer collects

**Recurring orders:** If a customer orders the same thing on a regular schedule, Merveille (or the reseller) can click **Make Recurring** on a ticket that already has a quote built, and set how often it repeats (weekly, every 2 weeks, or monthly). Two days before each repeat date, the portal automatically emails the customer a link showing what's about to be ordered — the customer can accept or decline it themselves, no login needed. Accepting confirms the order automatically in Odoo (same as Merveille clicking Confirm Order); Finance still has to register the deposit before it moves to packing, exactly like any other order. If the customer doesn't respond in time, that one order is simply skipped and the schedule carries on to the next date — nothing breaks and nobody needs to intervene. Staff can see and manage all recurring schedules under **Orders > Recurring Orders**.

---

## Sales Team — Merveille

**Role in system:** `sales` (permission: `tickets.sales`)  
**Access:** Sales Tickets only

### What you see

When you log in, you land on **Sales Tickets** (`/tickets/sales`). This shows:
- **Your queue** — tickets assigned to you
- **Unassigned** — tickets waiting to be claimed (direct inquiries with no assigned staff member)
- **Reseller orders** — reseller-created quotes appear in the ticket list from the moment they are submitted, even before the reseller has confirmed them. You can assign them to yourself or a colleague for tracking, and confirm them on the reseller's behalf if needed

**Identifying reseller orders:** The Customer column in the ticket list shows a purple **Reseller Order** badge and the reseller's name beneath the customer name for any order that came through a reseller partner. Internal orders show a blue **Portal Order** or **Direct Inquiry** badge. Opening a reseller ticket shows a purple "Via reseller: [name]" banner above the customer billing section.

A small **Live** indicator appears in the top-right of the ticket list. When it is green, the page is receiving real-time updates — any change made by another staff member (stage advance, payment registration, order cancellation) appears immediately without a manual refresh. If it shows **Reconnecting**, the live connection dropped temporarily and will restore itself automatically within 30 seconds.

### Creating a Direct Inquiry Ticket

When a customer emails or calls in an order that isn't coming through a reseller:

1. Click **New Direct Inquiry**
2. Search for the customer by name — the system searches Odoo live
3. Enter any notes about the enquiry
4. Click **Create**

The ticket starts at `Open` stage. From here you move it forward as the conversation progresses.

### Creating a Sample Order Ticket

When placing an order against the Bassani Samples Account (products distributed as samples, no charge):

1. Click **New Direct Inquiry**
2. Search for and select the **Samples Account** customer — it shows an amber "Samples" label
3. A **Sample recipient** field appears. Search for and select the actual customer who will receive the sample — this is required and must be an existing Odoo customer
4. Add any notes and click **Create**

The ticket is created as a **Sample order** (amber "Sample" badge on the ticket list; amber banner in ticket detail showing who the sample is for).

In the quote builder, all product prices are automatically locked to R0.00 and cannot be changed. On confirmation, the order goes straight to the packing board — no invoice at this stage. The packing board pipeline runs as normal (packing → QA approval → RP approval). At Mark Complete, a R0.00 invoice is automatically created and posted in the financial system — it is marked paid immediately since nothing is owed. No Finance action is required on sample tickets; payment and invoice lifecycle buttons are hidden throughout.

### Handling a Follow-up Inquiry (Link Existing Order)

Sometimes an email or call is about an **existing order** rather than a new one — for example, a customer asking about collection, delivery timing, or an amendment. In these cases you do not need to build a new quote.

1. Open the ticket (or create a Direct Inquiry ticket for the inquiry)
2. In the empty-state panel or the **Actions** sidebar, click **Link Existing Order**
3. Search by order reference (e.g. `S00123`) or customer name — results come live from Odoo
4. Select the correct order — you will see the order ref, customer name, Odoo status, and amount
5. Click **Link Order**

The ticket advances to the appropriate stage automatically:
- If the order is still a draft or sent quotation → ticket moves to `Quote`
- If the order is already a confirmed sale order → ticket moves to `Sale Order`

Finance, QA, and RP steps from that point follow the normal pipeline. You cannot link a cancelled Odoo order.

### Building a Quote

Once you know what the customer wants:

1. Open the ticket and click **Build Quote**
2. You are now in the quote builder — a full-page form that mirrors an Odoo quotation
3. Search for products by name or SKU — results come live from Odoo (no catalogue limit)
4. Enter quantities and confirm unit prices
5. Select the warehouse the order should draw from
6. Add any notes for the order
7. Click **Create Quote in Odoo**

The quote is now a draft sale order in Odoo. The ticket advances to `Quote` stage automatically.

### Sending the Quote

Once a quote is built:

1. Click **Send Quote** in the right sidebar
2. The PDF quotation is emailed to the customer from `sales@bassanihealth.com` (using Odoo's mail system)
3. The button label changes to **Resend Quote** once sent

If you edit the quote after sending it, the button changes to **Send Updated Quote** with an amber warning — this reminds you that the customer's copy is out of date.

### Editing a Quote

If the customer wants changes before confirming:

1. Click **Edit Quote** in the right sidebar
2. The quote builder opens pre-populated with the current lines
3. Make your changes and click **Update Quote in Odoo**
4. The ticket timeline records who edited it and when

### Confirming an Order

Once the customer confirms their order:

1. Click **Confirm Order** in the right sidebar
2. If the customer is over their credit limit, you will be prompted to confirm the override
3. The portal checks stock availability — if all items are in stock, the order confirms immediately. If some items are short, a modal appears showing what will ship now and what will be backordered. Confirm to proceed with a partial delivery, or cancel to wait
4. On confirmation, the customer is automatically emailed a pro-forma invoice showing the 50% deposit due, and the ticket advances to `Awaiting Deposit`. The order does **not** join the packing queue yet — Finance has to register the deposit first (see the Finance Team section). You can also set up a recurring schedule for this customer from the ticket detail once the quote exists — see **Recurring Orders** below.

> **If the stock check modal shows a red "Partial fulfilment blocked" notice:** The backorder option is not available because one or more products on the order have their Odoo invoicing policy set to "Ordered quantities" instead of "Delivered quantities". A partial delivery requires the "Delivered quantities" setting so the invoice reflects what actually shipped. To fix: open the product in Odoo, go to the General Information tab, change Invoicing Policy to "Delivered quantities", and save. Then return to the ticket and click Confirm Order again.

### Cancelling a Quote

If the customer is not interested:

1. Click **Cancel Quote**
2. Confirm the cancellation
3. Set the exit status to `Not Interested` or `Cancelled`
4. The ticket is closed

### What Happens After Confirmation

Once an order is confirmed, it sits at `Awaiting Deposit` until Finance registers the 50% deposit — this is the same for every order, no exceptions. Once that's done, it moves to the Orders team (Tshidi). You will see the ticket status change to `Confirmed WIP`, then later `Ready for Collection`, then `Complete` — all automatically, without you doing anything. If there is a problem with packing, the ticket will show `Incomplete` with a reason from Tshidi.

### Recurring Orders

For a customer who orders on a regular schedule, click **Make Recurring** on a ticket that already has a quote built (any status, including before it's confirmed). Choose how often it repeats — weekly, every 2 weeks, or monthly — and optionally an end date or a maximum number of repeats. Two days before each repeat date, the portal automatically:

1. Builds a fresh draft order in Odoo with the same products and quantities (at current pricing, not the original price)
2. Creates a new Sales Ticket for it, which appears in the queue like any other new ticket
3. Emails the customer directly (not you) a link to review and accept or decline

If the customer accepts, the order confirms itself automatically — you don't need to click Confirm Order for it. It still needs Finance to register the deposit before it moves into fulfilment, exactly like a normal order. If the customer declines, or simply doesn't respond in time, that occurrence is skipped and the schedule carries on to the next date by itself.

---

## Sales Inbox

**Access:** Sales role (`inbox.view` permission), Admins with `inbox.view`, Super Admin

The Sales Inbox connects the shared sales mailbox directly into the portal. Every email that arrives appears here — no need to open a separate email client. You can read, reply, create tickets, and clear the queue without leaving the portal. The mailbox is configured by a super admin in **Settings > Connected Mailboxes**.

### Layout

The inbox uses a two-panel layout:

- **Left panel** — the thread list. One row per conversation, ordered by most recent activity.
- **Right panel** — the full conversation. Click any thread on the left to open it.

### The Thread List

Each row shows:
- A **blue dot** on the left if the thread has unread messages
- The sender name (bold when unread)
- The subject line
- A preview of the latest message
- The timestamp of the latest message
- A message count badge if the thread has more than one message

**Status pill** (right edge of each row):
- Green **Ticket** — a sales ticket has been created. Click it to jump straight to the ticket.
- Red **Unknown** — the sender hasn't been matched to a customer yet. Action required before a ticket can be created.
- Amber **Pending** — flagged for customer onboarding.
- No pill — unhandled, customer matched. The thread is ready for a ticket to be created.

**Status tabs** across the top of the list:
- **Inbox** (default) — all active threads, excluding archived and done
- **New** — unhandled only
- **Pending** — threads flagged for customer onboarding
- **Done** — threads where a ticket has been created
- **Archived** — dismissed threads

Use the **search bar** to filter by sender name, email address, or subject.

### Opening a Thread

Click any row to open the conversation in the right panel. The thread displays all messages in chronological order with the oldest at the top and newest at the bottom. Incoming messages appear on the left (white), your replies on the right (teal).

The thread is automatically marked as read when you open it.

### Customer Matching

When an email arrives, the system tries to match the sender's email address to a known customer automatically. If matched, the customer's name appears in green at the top of the thread detail.

**If the sender is not matched (red "Unknown" pill):**
1. Open the thread
2. Click **Link customer** in the action bar
3. Search for the customer by name or email
4. Select the correct customer

Or, if the sender represents a brand-new customer:
1. Click **Start onboarding**
2. Add an optional note
3. Complete the onboarding in the Customers section, then return to link the customer and create a ticket

### Creating a Sales Ticket

Once a customer is matched:

1. Open the thread
2. Click **Create ticket** in the action bar
3. A Sales Ticket is created at Open stage and linked to this thread

Once created:
- The green **View Ticket** button appears in the thread header — click it to go directly to the ticket
- The green **Ticket** pill appears in the thread list row — click it to go to the ticket without opening the thread
- All order lifecycle actions (quote building, confirmation, packing, payment confirmation) happen in the ticket from this point

You can only create one ticket per thread.

### Replying

The reply box is always visible at the bottom of the open thread:

1. Type your reply
2. Click **Send Reply** (or press Ctrl+Enter)

The reply is sent from the shared mailbox and appears as a new message in the thread. It is also stored in the portal so the full conversation is always visible in one place.

### Clearing the Queue

**Unrelated email** (misdirected, spam, vendor correspondence that needs no action):
1. Open the thread
2. Click **Archive** in the action bar

The thread moves to the Archived tab and is removed from the active queue. It is not deleted.

**Cold ticket** (a ticket was created but the deal went quiet and you want to clean up the inbox entry):
1. Open the thread
2. Click **Dismiss** in the action bar

Dismiss works identically to Archive — the inbox entry is removed from the active queue. The linked ticket is not affected and remains on the ticket board exactly as it was.

### How Inbox and Tickets Work Together

- An email arrives in the shared sales mailbox
- It appears in the Inbox under the **New** tab
- Merveille opens it, links the customer, and clicks **Create ticket**
- She builds the quote and sends it from within the ticket
- The customer replies — their reply appears in the same inbox thread under **Inbox**
- Merveille can reply from the portal or advance the ticket as needed
- When the order is complete she clicks **Dismiss** to clean the inbox entry

The inbox is the entry point. All order lifecycle actions happen in the ticket.

---

## Onboarding Inbox

**Access:** Users with the `onboarding.inbox` permission. Granted individually by a super admin — not enabled by default for any role.

The Onboarding Inbox is a second dedicated mailbox view, completely separate from the Sales Inbox. It surfaces emails sent to a designated onboarding address (e.g. `onboarding@bassanihealth.com`). The intended workflow is that customers and resellers send their onboarding documents — company registration certificates, banking confirmations, authorisation letters, and Section 21 documents — to this address, and the relevant staff member processes them directly in the portal without downloading files or switching to a mail client.

The Sales Inbox and Onboarding Inbox are independent: different mailbox, different permission, different list.

### Admin Setup (Super Admin Only)

Before anyone can use the Onboarding Inbox, a super admin must connect a mailbox.

1. Navigate to **Settings > Connected Mailboxes** in the sidebar and select the **Onboarding Mailbox** tab
2. Choose the connection type:
   - **Office 365** — for Microsoft 365 shared mailboxes using the Graph API (OAuth2, no Basic Auth required). Enter the Tenant ID, Client ID, Client Secret, and Shared Mailbox Address from your Azure app registration.
   - **IMAP** — for any other provider (Xneelo, Gmail, custom). Select a quick-setup preset or fill in server details manually.
3. Click **Test Connection** to verify before saving
4. Click **Save**

The portal connects immediately — no restart required. New emails arrive within 60 seconds.

To disconnect, click **Disconnect**. The inbox stops receiving emails until a mailbox is reconnected.

**Granting the permission:**  
Go to **Users** and open the user's permission settings. Toggle on `Onboarding Inbox` under the Onboarding section. The nav item and the view appear immediately on their next login.

### Layout

The Onboarding Inbox uses the same two-panel layout as the Sales Inbox:

- **Left panel** — thread list, one row per conversation, ordered by most recent activity
- **Right panel** — the full conversation with all messages in chronological order

**Status tabs** across the top:
- **Inbox** (default) — all active threads, excluding archived
- **New** — unhandled threads only
- **In Progress** — threads where some (but not all) required documents have been saved to the customer profile
- **Linked** — threads linked to a pending onboarding application (typically reseller-originated)
- **Docs Complete** — threads where all required documents have been received and saved
- **Archived** — dismissed threads

**Document progress pills** on each thread row show how many of the required documents have been saved for that thread. An amber pill means more documents are still outstanding. A green pill with a checkmark means all required documents have been received and saved to the customer's profile.

**Thread header chips:**
- Green **Application linked** chip — thread is linked to a pending reseller application; click to open the application
- Blue **Customer** chip — thread is linked to a known Odoo customer
- Red **Unknown** — sender has not been matched; action required

### Opening a Thread

Click any row to open the conversation. The thread auto-marks as read. Incoming messages appear left (white), outgoing replies appear right (teal).

Each row shows a **Linked** pill (green) when linked to an application, a **Customer** pill (blue) when linked to a known customer, or an **Unknown** pill (red) when the sender has not been matched to any customer. Auto-detection runs on every inbound message — if the sender's email matches an Odoo customer record the customer is identified automatically without any manual step.

### Replying

1. Click **Reply** in the thread header
2. Type your reply in the compose box that slides open below the messages
3. Click **Send**

The reply goes out from the onboarding mailbox address and is stored in the portal thread so the full conversation stays in one place.

### Creating a New Customer from the Inbox

When a thread comes from a sender who is not yet in the system and is **not** linked to a reseller application, use **Create Customer** to onboard them directly:

1. Open the thread — a **Create Customer** button appears in the header when the sender has no linked customer and no pending application
2. Click **Create Customer**

**Step 1 — Map Documents:** The required onboarding document slots are displayed. For each slot, choose the matching attachment from the email using the dropdown. Leave a slot blank if that document was not included in this email.

3. Click **Continue**

**Step 2 — Customer Details:** The form opens pre-filled with the sender's name and email address. Complete the remaining fields (phone, address, VAT number, customer type, credit limit).

4. Click **Create Customer**

The customer record is created in the system, all mapped documents are saved to their profile in one step, and the inbox thread is linked to the new customer. The **Customer** pill appears on the thread row immediately.

If the system finds a customer with the same email address or VAT number, creation is blocked. Use **Link** instead to connect the thread to the existing record.

### Reseller-Originated Threads — Saving Documents to an Application

When a reseller sends onboarding documents to a customer via the portal's **Onboarding Docs** page, the system automatically creates a draft onboarding application and links it to that reseller. When the customer replies with their signed documents, the thread appears in the Onboarding Inbox with a green **Application linked** chip — clicking it opens the application directly.

**The correct flow for these threads:**

1. Open the thread — a **Review Application** button and a **Save to Application** button appear in the header
2. Click **Save to Application** to attach the customer's signed documents to the pending application:
   - A modal lists every attachment in the thread
   - Use the dropdown on each row to assign it to the correct document slot
   - Set any attachment to **Don't save** if it should be skipped
   - Click **Save N Documents** — the files are written to secure cloud storage against the application record
3. Once all required documents are saved, click **Review Application** to open the application detail
4. Enter the customer's registered company name (required for account creation)
5. Click **Approve and Create Customer**

On approval, the system creates the customer record, automatically links all application documents to the customer's profile (no re-upload), and writes the reseller ownership link so the customer appears under the correct reseller's account.

> **Why this flow instead of Create Customer?** Threads linked to a reseller application bypass the direct "Create Customer" path. This preserves the reseller ownership link and ensures the full document audit trail flows through the application — the reseller can see the application status in their portal, and admin has a complete record of which reseller introduced the customer.

### Saving Documents to a Customer's Profile

When a known customer emails a signed document and the thread already has a linked customer:

1. Open the thread — **Save Documents** appears in the header when attachments are present and a customer is already linked
2. Click **Save Documents**
3. A modal lists every attachment in the thread. For each one, use the dropdown to assign it to the correct document slot (Signed Store Onboarding Agreement, Signed NDA, etc.)
4. Set any attachment to **Don't save this attachment** if it should be skipped
5. Click **Save N Documents**

If the customer already has a document of the same type on file, an amber warning appears on that row showing the existing filename. A confirmation step lists old → new before overwriting.

The documents are saved directly from the email to secure cloud storage and linked to the customer's profile. No manual download or re-upload is needed.

**Document progress tracking:** After saving, the thread's status updates automatically. The progress pill on the thread row shows how many required documents have been received. When all required documents are saved, the pill turns green and the thread moves to the **Docs Complete** tab.

The customer's profile shows the same structured view: each document type has its own row with a green dot when uploaded and a grey dot when outstanding.

### Archiving a Thread

When a thread requires no further action:

1. Open the thread
2. Click **Archive** in the thread header

The thread moves to the Archived tab. Archived threads are automatically deleted after 180 days.

### Sending Onboarding Documents

To send the Customer Information Form template to a prospective customer directly from the onboarding mailbox:

1. Click **Send Docs** in the top bar
2. Enter the customer's email address and optionally their name (used in the greeting)
3. Click **Send Documents**

The email goes out from the onboarding mailbox address with the Customer Information Form attached. When the customer replies with their signed form and CIPC certificate, their reply threads back into the inbox automatically — no manual matching needed. After the admin reviews the application, they generate and preview the NDA and Store Onboarding Agreement on the application detail page, then deliberately send the signing link to the customer once satisfied with the pre-filled content.

### Previewing PDF Attachments

Click the **eye icon** next to any `.pdf` attachment to preview it inline without downloading. The PDF opens in a secure viewer within the portal. Close the viewer when done.

### Typical Workflow — Reseller Customer via Email

This covers the most common path: a reseller sends onboarding documents to a customer via the wizard, fills in the application while waiting for the signed documents to arrive, and admin processes it.

**Reseller side:**

1. Reseller opens **Applications** → clicks **Start Application**
2. The onboarding wizard opens at Step 0. Reseller enters the **business name** (required) and the customer's email address, clicks **Send Docs**
3. The Customer Information Form is emailed to the customer. A draft application is created and linked to the reseller
4. The wizard unlocks Steps 1-4. Reseller continues filling in business details, contact, address, and additional info with whatever they know. Progress is saved automatically as they move between steps
5. Reseller can close and return at any time — the draft appears in **Applications** under the **Drafts** filter with a **Continue** button

**While waiting for the customer:**

6. Customer signs all documents and replies to the email — the reply appears in the Onboarding Inbox with a green **Application linked** chip

**Admin side:**

7. Admin opens the thread, clicks **Save to Application** — assigns each attachment to the correct document slot, saves
8. The reseller receives an email: "Docs received — complete and submit your application", with a direct link to resume
9. Reseller clicks the link, reviews the pre-filled form, completes any remaining fields, clicks **Submit for Review**
10. Admin opens the application from the Applications queue, clicks **Review Application** (or it was already ready if all fields were filled in step 4)
11. Admin clicks **Approve and Create Customer** — customer is created, all application documents are linked to their profile, and the reseller ownership link is written automatically
12. Admin archives the inbox thread

### Typical Workflow — Direct Customer via Email (No Reseller)

- Admin sends onboarding template PDFs via **Send Docs** in the top bar of the Onboarding Inbox
- Customer signs and replies to the email with the completed documents attached
- The reply threads into the Onboarding Inbox automatically
- Auto-detection identifies the customer if their email matches an existing record; if not, an **Unknown** pill appears
- Admin opens the thread and clicks **Create Customer**
- Step 1: maps each signed document attachment to the correct document slot
- Step 2: completes the customer details form (pre-filled from the sender's name and email)
- Customer is created, documents are saved, thread is linked — all in one action
- Admin replies from the portal to confirm receipt, then archives the thread

### Typical Workflow — Documents for an Existing Customer

- A known customer emails a new document (e.g. a renewed Section 21 authorisation) to the onboarding address
- Auto-detection resolves the customer — a blue **Customer** pill appears on the thread row
- Admin opens the thread and clicks **Save Documents**, assigns the attachment to the correct slot, and saves
- The document appears in the customer's profile immediately
- Admin archives the thread

---

## Finance Team — Kashi & Ragini

**Role in system:** `finance` (permissions: `tickets.finance_confirm`, `finance.bank_reconciliation`)  
**Access:** Sales Tickets, Bank Reconciliation

### When Finance Acts

Finance is involved at **two** points in the order pipeline:

1. **Awaiting Deposit** — immediately after a Sales or Orders Clerk confirms an order. The customer has already been emailed a pro-forma invoice automatically. Nothing moves onto the packing board until you register the 50% deposit — this applies to every order, no exceptions.
2. **Ready for Collection** — after the order has been packed and approved by QA and RP. When the Orders Clerk marks an order Complete, the system automatically creates and posts the (remaining balance) invoice in Odoo, and you register the balance payment once the customer pays.

### Proof of Payment Alerts (2026-08-21)

A customer or reseller can optionally upload a photo or PDF of their payment confirmation from the order's own page. When they do, you'll get:

- An **email** (if configured under Settings > Email Notifications > Finance: "Proof of Payment Uploaded")
- An amber **"POP Uploaded"** badge next to the ticket on the Sales Tickets list, alongside the existing green "Confirmed" badge if a deposit was already registered — a ticket can have its deposit confirmed and still show a new upload for the balance payment

**This is only a heads-up, never a payment record.** Open the ticket, review the file (there's a "View files in Order Passport" link on the ticket detail page), and check it against your bank records as usual — then register the deposit or balance payment the normal way below. If a file turns out to be a duplicate or doesn't need any action, click **Mark POP Reviewed** on the ticket to clear the badge without registering anything. Registering a deposit or balance payment through the steps below always clears the badge automatically too.

### Registering the Deposit

1. Open the Sales Ticket (it will be in **Awaiting Deposit** status)
2. Click **Register Deposit** in the right sidebar
3. Choose the invoice type — usually **Fixed Amount**, pre-filled at 50% of the order total, but you can enter a different amount if needed (if the customer paid the full order upfront rather than a deposit, use **Fixed Amount** and enter the full order total)
4. Select the payment journal (which bank account the funds arrived in) and the payment date
5. Click **Register in Odoo**

This creates the down payment invoice and records the payment against it in Odoo in one step, and immediately queues the order onto the packing board — this is the only way an order reaches packing. Until this is done, the order simply sits at Awaiting Deposit no matter how long it takes.

**If the order was already invoiced and paid in Odoo before this ticket existed** — most often a historical order attached via **Link Existing Order** — the Register Deposit screen shows a blue panel listing the existing invoice(s) and their payment status, with a **Use This Invoice** button next to each. Clicking it links that invoice as the deposit and queues the order onto the packing board, without creating a second, redundant invoice in Odoo. This only appears when Odoo shows real payment already registered against an invoice on that order — the normal Fixed Amount / Percentage deposit flow is still there and works exactly as before if you'd rather register a fresh deposit.

### Registering the Balance Payment

1. Open the Sales Ticket (it will be in **Ready for Collection** status)
2. Click **Register Balance Payment** in the right sidebar
3. The outstanding balance is pre-filled from the live Odoo invoice — verify the amount
4. Select the payment journal (which bank account the funds arrived in)
5. Select the payment date
6. Click **Register Payment in Odoo**

The payment is applied to the invoice in Odoo immediately. The ticket records who registered it and when.

### Confirming Payment Received

For tickets where the payment was registered directly in Odoo (outside the portal) rather than through Register Balance Payment:

1. Open the Sales Ticket
2. Click **Confirm Payment Received**
3. The system checks Odoo's live payment data — if Odoo shows no payment recorded yet, this button will block with a message explaining the shortfall
4. If Odoo shows the payment, you confirm it and the ticket advances

> **You cannot confirm payment if Odoo does not show it.** This is a hard rule — the portal reads directly from Odoo, so if the payment isn't there, it hasn't been properly recorded yet.

### Bank Reconciliation

**Navigate to:** Finance > Bank Reconciliation

The Bank Reconciliation page lets you import a bank statement CSV and match credits to open invoices directly in the portal — without opening Odoo. Confirming a match registers the payment in the accounting system immediately.

#### Importing a Bank Statement

1. Click **Import Statement**
2. Select the bank journal (which bank account)
3. Choose your CSV file (FNB Business or Nedbank Business format)
4. Click **Import**

The portal reads the CSV, extracts credit lines only, auto-matches them to open invoices by amount and payment reference, and shows you the result. Duplicate lines from previous imports are automatically skipped.

#### Reviewing Lines

After import, each credit line has one of four states:

| Status | Meaning | Action needed |
|---|---|---|
| **Auto-matched** | Portal found a high-confidence invoice match | Review and confirm, or override with a different invoice |
| **Unmatched** | No confident match found | Search for the invoice and match manually |
| **Confirmed** | Match approved — payment registered | No action needed |
| **Excluded** | Line marked as fee/transfer/not a customer payment | No action needed |

Use the filter pills at the top to focus on **Unmatched** lines.

#### Confirming a Match

1. Hover the line and click **Match**
2. Select the payment journal
3. Search for the invoice by number or customer name
4. Click **Confirm Match**

The payment is registered in the accounting system. The line moves to Confirmed.

#### Excluding a Line

Bank fees, inter-account transfers, and refunds are not customer payments. Hover the line and click **Exclude** (with an optional reason). The line is hidden from the unmatched count and does not affect accounting.

#### Auto-Confirmed Tickets

Every 15 minutes, the portal checks whether any outstanding invoices have been marked as paid in the accounting system. When it detects a payment, it automatically advances the linked sales ticket without Finance clicking "Confirm Payment". The ticket will show "Auto-confirmed from bank" with the date.

> **Tip:** If you use **Register Balance Payment** directly in the portal (see above), the ticket advances immediately. The auto-confirm background check is the backstop for payments registered outside the portal.

---

## Operations Monitor (TV Display)

The Operations Monitor is a live, read-only display designed to run on a dedicated screen or TV in the office. It shows the full order pipeline at a glance, with colour-coded aging alerts so the team can instantly see which orders need attention without opening the ticket list.

**No login is required.** Access is controlled by a secret URL token managed by the super admin.

### Setting Up the Monitor Display

1. Go to **Settings → Monitor Display**
2. Click **Generate Display URL** (first time only)
3. Click **Copy** to copy the full URL
4. Open the URL in a browser on the display device and set it to full-screen (F11 on most browsers)

The display refreshes automatically every 30 seconds.

**Rotating the token:** If the display URL is compromised or you want to revoke access to a specific device, click **Rotate token** in Settings → Monitor Display. The old URL stops working immediately. Copy the new URL and update all display devices.

### Reading the Monitor

**KPI strip (top of screen):**

Row 1 — headline health indicators:
- **Overdue** — orders past their deadline across all stages. Pulses red when non-zero. Requires immediate action.
- **At Risk** — orders approaching the 72-hour deadline. Address these before they become overdue.
- **Compliance Hold** — total orders currently in QA Review or RP Review. Elevated counts here mean compliance sign-off is the bottleneck.
- **Completed Today** — orders fulfilled since midnight.

Row 2 — live pipeline breakdown:
- **Open Inquiries** — unconfirmed tickets (inquiry, quote, or confirmed but not yet on the packing board).
- **In Packing** — orders actively being picked and packed.
- **QA Pending** — packed orders awaiting QA sign-off.
- **RP Pending** — QA-approved orders awaiting RP sign-off.
- **Awaiting Collection** — invoice raised, customer has not yet collected.
- **Oldest Active** — age of the oldest live order across all stages. Green = under 48h, orange = 48–72h, red = overdue.

**Pipeline columns (left to right):**

| Column | What it shows |
|---|---|
| Open Quotes | Sales tickets in quote stage — awaiting customer confirmation |
| Packing | Confirmed orders being packed (queued + in packing) |
| QA Review | Orders packed and awaiting QA sign-off |
| RP Review | QA approved — awaiting RP sign-off |
| Ready to Collect | Invoice raised — customer has not yet collected |

Within each column, orders are sorted **oldest first** (most urgent at top).

**Colour coding on each card:**

| Colour | Meaning |
|---|---|
| Green border | On track — under 33% of the 72h window elapsed |
| Amber border | Attention — between 33% and 66% of the window |
| Orange border | Urgent — between 66% and 100% of the window |
| Red border + pulse | Overdue — past the 72h deadline |

The countdown badge on each card updates every second. Quotes use a 48-hour alerting window instead of 72 hours.

---

## Orders Clerk — Tshidi

**Role in system:** `orders_clerk` (permission: `tickets.orders`)  
**Access:** Orders Tickets only

### Your View

When you log in, you see **Orders Tickets** (`/tickets/orders`). This shows all orders that have been confirmed and are in the packing pipeline.

Click any order to open the full detail view. You will see:
- The full order document (customer, items, quantities, invoice number, delivery note)
- Which packer is assigned
- Which items have been ticked off by the packer
- QA and RP approval status
- Your action cards for advancing the order

### Moving an Order Through the Pipeline

**Queued → Packing**
When the warehouse is ready to start on an order:
1. Open the order ticket
2. Click **Mark as Packing**

**Packing → Ready**
When the warehouse has finished packing:
1. Open the order ticket
2. Click **Mark as Ready**

At this point the order waits for QA and RP approval before it can be completed.

**Marking Incomplete**
If there is a problem with the order (wrong items, stock issues, damaged goods):
1. Click **Mark Incomplete**
2. Enter the reason
3. The sales team is automatically notified

> Once marked Incomplete, the originating Sales Ticket updates automatically — Merveille sees the reason without you needing to call her.

**Completing an Order**
Once both QA Manager and Responsible Pharmacist have approved:
1. The **Mark Complete** button becomes available
2. Click it to close the order

If the order ships in full, the Sales Ticket automatically updates to `Complete` and a ready-for-collection email goes to the warehouse supervisors.

**Partial Fulfilment (Backorders)**
When a confirmed order cannot be fully filled from current stock, the system handles the split automatically:

1. Click **Mark Complete** as normal — the system validates what is available in Odoo and creates a backorder picking for the remainder
2. The Orders Tickets list shows the original delivery at `Complete` and a new `Waiting for Stock` entry for the backordered items
3. The reseller receives an email listing what is shipping now and what is on backorder

**Marking a delivery as collected**
For orders where the invoice is created on collection (partial orders), an additional step appears:
1. When the customer collects the delivery, open the order ticket at `Complete` stage
2. Click **Mark as Collected** — this creates the Odoo invoice for the quantities delivered and records the collection timestamp
3. When all deliveries for an order (including backorders) have been collected, the Sales Ticket advances to `Complete`

**Checking backorder stock availability**
When backorder entries are on the board:
- A **Check backorder stock** button appears in the top bar
- Click it to poll Odoo for stock changes — if stock has been reserved for any waiting backorder, the system notifies the reseller and internal team automatically

---

## QA Manager — Cullen Grant

**Role in system:** `qa_manager` (permission: `tickets.qa_approve`)  
**Access:** Orders Tickets (QA approval only)

When you log in, you see Orders Tickets. Your action is visible only when an order is at `Ready` status. You also receive an email as soon as an order reaches `Ready` status (if configured under **Settings > Email Notifications > Orders & Fulfilment > QA Approval Needed**), with a direct link to the order. If an order is still awaiting your sign-off at close of business, it appears in the 17:00 daily "Outstanding Inspections" digest email so nothing is missed overnight.

1. Open an order at `Ready` status
2. Review the order details and packing information
3. Click **QA Approve**

Your approval is recorded with your name and timestamp. The order will not complete until both QA and RP have independently approved — your approval does not depend on Rookshanna's, and vice versa.

---

## Responsible Pharmacist — Rookshanna Hussain

**Role in system:** `responsible_pharmacist` (permissions: `tickets.rp_approve`, `production.rp_release`)  
**Access:** Orders Tickets (RP approval) and S6 Releases (imported stock sign-off)

**Order approval** — identical flow to QA Manager, but from the pharmacist perspective. You also receive an email as soon as an order reaches `Ready` status (if configured under **Settings > Email Notifications > Orders & Fulfilment > RP Approval Needed**), and any order still awaiting your sign-off at close of business appears in the 17:00 daily "Outstanding Inspections" digest:

1. Open an order at `Ready` status
2. Review the order
3. Click **RP Approve**

Both approvals are required before Tshidi can mark the order Complete.

**S6 Releases (imported stock sign-off):**
Every imported Schedule 6 delivery recorded on the receiving register is held in quarantine until you release it. The **S6 Releases** page is your queue:

1. Each card shows the full receipt: supplier, product, batch number, the purchase order it was matched to, the quantity quoted versus received (any shortfall highlighted), which delivery documents arrived, and which are missing
2. If everything checks out, click **Release**. The batch becomes available for issue from the vault, and your release is recorded permanently with your name and the time
3. If something needs checking first, click **Query** and record what must be resolved. The batch stays locked and your note goes on record
4. A receipt flagged as having no purchase order cannot be released until the flag has been investigated and resolved by an admin

You record the sign-off; you do not enter the weights. The person who physically received the stock recorded those, and your role is to verify them against the documents. This keeps the receiving record and its verification in separate hands.

---

## Warehouse Supervisor

**Role in system:** `warehouse_supervisor`  
**Access:** Supervisor board (`supervisor.html`) — not the main portal

The supervisor board is a dedicated webpage separate from the main portal, designed for use on the warehouse floor.

**Login:**
1. Navigate to `https://yourportal.railway.app/supervisor.html`
2. Log in with your warehouse supervisor credentials
3. Your identity is shown in the header — session expires after 8 hours

**What you see:**
The full packing queue for your assigned warehouse — all orders at every stage.

**What you can do:**
- Assign a packer to an order (pick from the list of active packer accounts)
- See real-time progress as packers tick items on their handhelds
- See when orders move from Packing to Ready

> The supervisor board is connected to the packing board display screen in real time via WebSocket. When you assign a packer or an order status changes, the big screen updates instantly — no refresh needed.

---

## Packers

**Role in system:** `packer`  
**Access:** Packer view (`packer.html`) — not the main portal

Each packer has their own login for a lightweight handheld-friendly page.

**Login:**
1. Navigate to `https://yourportal.railway.app/packer.html`
2. Log in with your packer credentials
3. You see only orders assigned to you

**What you see:**
Your assigned orders with the full item list for each one.

**What you do:**
Tap each item as you pack it. The item ticks in real time on both the supervisor board and the 85" display screen. When all items are ticked, the supervisor knows the order is done.

> You do not confirm the order complete — that is Tshidi's action. Your job is to tick items as you go.

---

## Vault Custodian (Production Facility)

**Role in system:** `vault_custodian`  
**Access:** Batch Registry and Vault Logbook only — nothing from the sales side

The vault custodian records every movement of stock into and out of the production vault. This replaces the paper Vault Transaction Logbook. Your name and the exact time are recorded automatically on every entry, and batch numbers are always generated or picked from a list — never typed by hand.

**Logging in:**
Log in at the normal portal address. You land directly on the Vault Logbook.

**The Guide button:**
Both production pages have a **Guide** button at the top right. It opens a plain-language reference explaining how batch numbers are put together (the four batch types, the stage letters and what each one means, and the finished goods packaging codes), what each of the four vault movements is for, and what the "Staged" label means. Use it any time you are unsure — you never need the paper standard.

**Generating a batch number (Batch Registry page):**
This page is for stock produced at Bassani only.
1. Pick the batch type: Single Strain, Mixed Room (API), Blend, or Gummy / Product Lot
2. Search for the product by name or shortcode
3. The next batch number appears automatically in the preview box, built to the Bassani standard with the correct sequence number and today's date. Single Strain, Mixed Room and Blend batches are always created as **Unmanicured** (`-U`) — that is what actually arrives at the vault door — so unmanicured and manicured stock are never mixed up. Gummy batches have no manicuring stage, so they carry no stage letter.
4. Click **Create Batch**. The number is now in the registry and ready to use on movements

Imported stock is never generated here — it is created automatically when you receive the delivery on the **S6 Receiving** page (see below). This keeps every imported batch tied to its Schedule 6 paperwork and quarantine sign-off from the moment it exists. The Batch Registry's registry table still lists imported batches alongside Bassani-produced ones, so you can see the full history of any batch in one place.

**Recording a vault movement (Vault Logbook page):**
1. Search for the batch first. Every entry in the picker shows the product name and stage next to the batch number, so you never need to memorise the numbering.
2. Check the summary bar that appears: the product, the stage in plain language, how much of that batch is in the vault right now, and how much is out at manicuring.
3. The system marks the suggested movement with a **Next step** badge and selects it for you, based on where the batch actually is: a new batch suggests Receive to Vault; unmanicured stock in the vault suggests Issue to Manicuring; stock out at manicuring suggests Return from Manicuring; anything else in the vault suggests Issue to Packing. Movements that are physically impossible (issuing a batch with nothing in the vault, returning a batch that is not out) are greyed out with the reason shown. You can tap a different available movement if the suggestion is not what happened.
4. Enter the weight in grams (for a return, enter the manicured weight and the trim weight separately — the system books them in under the correct `-M` and `-T` batch numbers and works out the processing waste). If you try to issue more than the vault holds, a warning appears (you can still save it, but check the weight and batch first).
5. Add a note if anything was unusual, then click **Record Movement**

The normal life of a flower batch through the vault: **Receive to Vault** (unmanicured `-U` bulk in from drying) → **Issue to Manicuring** → **Return from Manicuring** (comes back as `-M` manicured plus `-T` trim) → **Issue to Packing**. Gummies have no manicuring stage and go straight from receiving to packing. Imported flower follows the same path as Bassani-grown flower if it arrives unmanicured; if it arrives already manicured, it skips straight to Issue to Packing once released — see S6 Receiving below for how that is captured at the point of receipt.

**Receiving imported stock (S6 Receiving page):**
Stock bought in from an external supplier is recorded here, not on the Vault Logbook. One entry does everything: pick the supplier and product, choose the stock type (Indoor, Greenhouse, Vape, Edible and so on) and size for flower, enter the quantity quoted and the quantity actually received, tick which documents arrived with the delivery (Invoice, COA, Delivery Note, S6 Transfer Doc), and add a comment if needed. The imported batch number (starting `BI`) is generated automatically and previewed as you fill in the form, along with what stage it will be recorded at (Unmanicured, Manicured, Trim, Pops, or Finished product).

Most of the time you do not need to say what state the delivery arrived in — the system works it out: giving a size (Large, Smalls or Pops) means it is already manicured, a Trim delivery is always recorded as Trim, and product types like Vape, Edible, Distillate, Hash and Tincture are finished products with no manicuring stage at all. The only time you are asked directly is a flower delivery (Indoor, Greendoor or Greenhouse) with no size given — a **"Has this delivery already been manicured?"** choice appears, since the batch number alone cannot tell. Answer it honestly: an unmanicured delivery still needs to go through Issue to Manicuring on the Vault Logbook once released, while an already-manicured delivery goes straight to Issue to Packing.

Every receipt must be matched to a **purchase order**: when you pick the supplier, their open purchase orders load automatically so you can select the right one. If you cannot find a purchase order for the delivery, choose **"No purchase order found — flag for investigation"**. The stock is still booked in, but the receipt is held, the compliance contact is notified, and the batch cannot be released until the flag is investigated and resolved.

Received imported stock always starts in **quarantine**: it is in the vault and on the register, but it cannot be issued out until the Responsible Pharmacist has released it on the S6 Releases page. The register table below the form shows each receipt's status (Awaiting release, Queried, or Released) alongside the full receiving history.

If the received weight differs from what was quoted, the difference is recorded on the register entry and shown as a warning before you save.

**The Vault Ledger:**
The ledger shows what is in the vault right now, per batch — the running balance the old spreadsheet could not give you. Each batch appears as one line with the total currently in the vault and a small tag for each form it currently exists as (for example "Manicured" and "Trim" side by side, if it has been split). If a batch has more than one stage on record, a small arrow lets you expand the row to see the exact breakdown per stage. Click any batch on the Batch Registry page to see its full history: every stage of the batch and every movement, with who recorded it and when.

Users who can manage production (`production.manage`, typically the super admin) see a small **"Rebuild"** link in the ledger card header. This recalculates every balance from scratch by replaying the full movement history — a reconciliation tool, not something needed for day-to-day use. Use it only if a balance ever looks wrong; a confirmation step explains what it does before it runs.

**About the "Staged" label:**
While the connection to the production facility's stock system is being finalised, movements show a "Staged" label. Nothing is lost — every entry is queued and will be written into the stock system automatically once the connection is switched on. Keep recording as normal.

---

## Admin Users

**Role in system:** `admin`  
**Access:** Depends on permissions granted by the super admin

Admins have a broad view of the portal, but specific actions depend on what the super admin has enabled for them. The sidebar only shows sections the admin has access to.

### Products

*Requires `products.manage` permission*

Go to **Products** to view the full product catalogue. Each product shows:
- On-hand stock (physical units in the warehouse)
- Forecasted stock (on-hand minus reservations from confirmed orders plus incoming)
- Tax rate (the VAT% configured in Odoo for that product)
- Price

**Why Forecasted stock matters:** If a product shows 150 on hand but 0 forecasted, it means 150 units are reserved against confirmed orders that haven't been delivered yet. Click the icon next to the Forecasted figure to see exactly which orders are holding that stock.

**Adding/editing products:** Products are managed in Odoo and synced automatically to the portal. Do not use the portal to create or edit products — use Odoo directly so all pricing, tax, and stock configurations are correct. The portal reflects Odoo as the source of truth.

**Product images:** The one exception to the rule above. Click a product's thumbnail (leftmost column) to open the image manager — upload a JPEG, PNG, or WEBP (max 8MB), or remove the current image. The image is written directly to Odoo, so it also appears on the product there. The thumbnail updates immediately across the whole portal: the Products table, the reseller catalogue, the quote builder's product picker, and per-row product search all show it. Products with no image show a placeholder icon instead.

**GS1 pharmaceutical labels:** Products with a valid GTIN barcode (set in Odoo's barcode field or assigned from the GTIN Pool) show a small **GS1** badge button in the Barcode column. Clicking it opens the label printing modal. You can enter the batch/lot number, expiry date, and starting serial number, choose Unit label (GS1 DataMatrix, 57×32mm), Carton label (GS1-128, 100×50mm), or both, set the quantity, select a Zebra printer, and click **Print to Zebra**. A live preview of the label renders in the modal as you type. If no Zebra printer is configured, use **Print via browser** to print to any connected printer. Printers are configured in **Settings → Label Printers**. Note: GTINs must be officially registered with GS1 South Africa before labels can be used on product dispatched to pharmacy — dummy GTINs may be used for setup and testing.

**Set GTIN / Barcode:** The Barcode column shows either the current barcode value or a **+ Set GTIN** link. Clicking it opens the barcode manager modal, which handles all barcode operations in one place:
- Current barcode status: green badge if assigned from the pool; amber badge if entered manually
- Unassign (pool barcodes) or Clear (manual barcodes) buttons with inline confirmation
- A searchable list of available GTINs from your pool — click Assign to write it to Odoo immediately
- A custom barcode entry field for non-pool barcodes (any format, including Code 128 or EAN-13)

Assigning a GTIN from the picker writes the barcode field directly to Odoo and marks the code as assigned in the pool. The Products table barcode cell updates immediately. To manage the full GTIN pool (upload codes, view the registry, remove unused codes), go to **Settings → GTIN Pool**.

**Global barcode search:** Every admin role sees a search bar in the top-right of the portal header on every page. Press `/` on your keyboard from anywhere to focus it (as long as you are not already typing in another field). Then scan any barcode or type a reference:

- **Product GS1 barcode:** Scanning a product's GTIN (13 or 14 digits) takes you straight to the Products page filtered to that item's SKU. Use this when you have a physical product and want to check its stock, price, or lot details without browsing.
- **Sale order reference:** Typing or scanning the Odoo order number (e.g. `S00142`) opens the sales ticket for that order if one exists — including its current status, invoice, and all actions. For orders that have not yet been pulled into the portal pipeline, the Orders list opens pre-filtered to that order reference so you can create a ticket from there.
- **Invoice number:** Typing the invoice reference (e.g. `INV/2026/00043`) navigates to the Invoices page.

If no match is found, a red toast appears. Press Escape to clear the search bar at any time.

**Order barcodes on tickets:** Every sales ticket detail page shows a compact Code 128 barcode of the sale order reference in the top-right of the order document header. Warehouse staff can scan this from a tablet screen or a printed packing slip to pull up the order instantly via the global search bar.

**Reseller catalog toggle:** The "Reseller / MOQ" column controls which products appear in the reseller catalog. The toggle switch adds or removes the product. When a product is toggled on, a small number input appears next to the toggle — enter a minimum order quantity (MOQ) and click away to save. Leave it blank for no minimum. If you toggle a product off and back on, any previously set MOQ is restored.

**Minimum Order Quantity (MOQ):** Setting an MOQ means resellers cannot add fewer than that number of units to an order for that product. The minimum appears as an amber "Min. X units" badge on the product card in the reseller catalog and order builder. When a reseller opens the order cart and clicks "Add to Order", the quantity starts at the MOQ rather than 1. If they try to reduce below the minimum, the system blocks it with an error.

**Low stock:** The dashboard highlights any product with forecasted stock below 10 units. This is the same figure that drives the orange badge in the order catalogue.

**Odoo Categories vs. Parent Categories:** The Products sidebar group has two category pages, and they do very different things:
- **Odoo Categories** — manages Odoo's real `product.category` records. Creating, renaming, or reparenting a category here writes directly to Odoo and affects every system connected to it, not just the portal. A red banner on the page is a reminder of this.
- **Parent Categories** — a portal-only grouping layer that never touches Odoo. Use this to define the clean category buckets resellers actually see (e.g. "Flower"), grouping one or more messy Odoo categories underneath. You can also hand-pick individual product variants into a Parent Category regardless of their Odoo category — this is how a rotating "Specials" bucket works: add or remove specific variants weekly without needing a real Odoo category for it. A product added this way is automatically made visible in the reseller catalog if it wasn't already, so you don't need a separate step. Deleting or editing a Parent Category never affects a product's underlying reseller-catalog visibility (set via the toggle above) — it only changes how the product is grouped for browsing. Any catalog-visible product not covered by any Parent Category shows up under an automatic "Uncategorised" chip on the reseller side, so nothing quietly disappears just because nobody's grouped it yet.

**Sub-categories (brand/grade drill-down):** A Parent Category can optionally sit inside another one, one level deep, using the "Parent category" field on its edit form. This is for cases where a reseller should be able to narrow a family down to a specific brand or grade — for example, "Vapes" containing "CannaCrafter's Vapes" and "Green Clouds Vapes" as two sub-categories, each pointing at its own real Odoo category. Bassani's actual "Flower" and "Pre Roll" groupings don't need this: both are set up as flat top-level categories whose Odoo categories already span every grade (Indoor, Exotic, Greendoor, Greenhouse), so selecting "Flower" or "Pre Roll" shows everything at once with no extra drill-down step. Use sub-categories only where a genuine brand/grade narrowing is useful. A category that already has its own children can't be nested under another one, and only top-level categories can be picked as a parent — both are enforced so nesting never goes more than two levels deep.

As you build a Parent Category, a **Preview** panel updates automatically below the two pickers, showing exactly which products currently match your selection before you save anything. Each product is tagged: green **Visible** means it's already in the reseller catalog, blue **Will be added** means it's a hand-pick that will be made visible automatically when you save, and amber **Hidden — not in catalog** is a warning — that product matches one of your selected Odoo categories but isn't in the reseller catalog, so it still won't show up to resellers until you separately toggle it on under Products. If the category has sub-categories of its own, the preview only reflects what's added directly to it — open each sub-category to preview its own matches.

**Category Mapping (bulk setup):** Building up a full set of category mappings one Parent Category at a time can be slow when there are dozens of Odoo categories to place. The **Parent Categories** page has a second tab, **Category Mapping**, for a faster way: one row per real Odoo category, with a Parent Category dropdown and a Sub Category dropdown next to it. Picking a Parent Category from the dropdown assigns that Odoo category to it immediately — no save button, no modal. If the Parent Category you picked has sub-categories of its own, the Sub Category dropdown fills in so you can assign it more precisely (e.g. under "Vapes", to either "CannaCrafter's Vapes" or "Green Clouds Vapes" specifically); leaving Sub Category on "None" keeps it directly under the parent. Re-picking a different Parent Category for a row simply moves it — a category only ever has one home. Use the search box and the "Unmapped only" toggle to work through a long category list without losing your place, and check the page subtitle while this tab is active for a running count of how many categories are mapped. You still create the Parent Categories and sub-categories themselves (name, hand-picked products, etc.) on the first tab — the Category Mapping tab is only for assigning Odoo categories to categories that already exist.


### Customers

Go to **Customers** to see all active Odoo accounts — companies and individuals, including those that have not yet placed an order. Toggle the **Has Orders** filter pill to narrow the list to accounts with at least one confirmed sale order. The **Partner Directory** (also under Customers in the sidebar) shows every Odoo contact record including individual contacts not linked to a company.

**Adding a New Customer**

Customers are not created manually through the portal. All new customers follow the onboarding flow:

- Click **Onboard Customer** to send a registration invitation email to a prospective customer. They complete the self-service `/apply` wizard (Business Details, Primary Contact, Address, Additional Info, Sign CIF + upload CIPC) and submit their application.
- Admin reviews the application, generates and sends signing documents (NDA + SOA), countersigns, then clicks **Approve & Send Welcome Pack** — one action that creates the customer in Odoo and sends the Welcome Pack email together.
- If a customer exists in Odoo but has not yet placed an order, they are visible in the Customers list without toggling "Has Orders".

> The **Onboard Customer** button (top right) is not limited to the Customers page — it appears in the same place on **Customer Applications** and **Onboarding Inbox**, so you can start onboarding a new customer from whichever of those three screens you're already working in.

> If an emergency manual creation is needed, it must be done directly in Odoo by a super admin.

---

**Viewing a customer profile:**
Click any customer to open their full profile. You will see:
- Their lifetime orders and spend
- This month's orders and revenue
- Outstanding invoices and balance
- Their credit limit and how much of it is used
- The reseller who onboarded them (if applicable)
- Their contact persons (for company accounts)
- Their delivery addresses
- Their onboarding and compliance documents
- Their full account statement (all invoices and credit notes)

**Customer type badge:** Every customer profile shows a "Company" or "Individual" badge directly under their name. This reflects the Odoo contact type.

**Changing a customer's type** *(requires `customers.manage` permission)*

Admins see the type badge as a dropdown. Select "Company" or "Individual" to change the classification:

- **Individual → Company:** Applied immediately. The account becomes a company-level partner and can now have linked contact persons and delivery addresses.
- **Company → Individual:** A confirmation screen appears explaining the implications. The change is blocked if the customer has any linked contact persons — remove or reassign them first. Once confirmed, the change is applied in Odoo immediately and audit-logged.

> Only change a customer's type if you are certain it is misclassified. Orders and invoices already raised against the account are unaffected, but the change affects how future orders are structured.

**Credit Hold:** If a customer appears with a red "Credit Hold" badge, they are over their Odoo credit limit. Orders for this customer will produce a warning at quote stage and a hard block at confirmation stage (unless you override).

**Samples Account** *(requires `customers.manage` permission)*

The Bassani Samples Account is a dedicated Odoo customer used when Bassani distributes product samples at no charge. Any customer can be designated as a Samples Account from their customer profile page.

To enable the Samples Account flag:
1. Open the customer profile
2. Scroll to the **Samples Account** section
3. Click **Disabled — click to enable**
4. A confirmation modal explains the effect — click **Enable**

Once enabled, an amber "Samples Account" badge appears in the customer header. All future sales tickets created against this customer are automatically classified as Sample orders. The flag applies to new tickets only; existing tickets are not affected.

To disable, click **Enabled — click to disable** and confirm.

**Contact persons** *(company accounts only)*

Company profiles show a Contacts section listing all individuals linked to that company account in Odoo. These are the people Bassani communicates with at that business (pharmacists in charge, procurement managers, etc.).

To add a contact person *(requires `customers.manage` permission)*:
1. Open the company's customer profile
2. Scroll to the **Contacts** section
3. Click **Add contact**
4. Enter their full name (required), job title, email address, and phone number
5. Click **Add Contact**

The new contact appears in the list immediately and is created in Odoo.

**Customer Documents:**
The **Documents** section on a customer's profile shows all compliance documents associated with that customer, with a progress counter in the section header (e.g. "Documents (3 / 4 onboarding)"):
- **Onboarding documents** — the signed agreements and CIPC certificate submitted through the onboarding process. These carry an "Onboarding" badge and cannot be deleted from this view.
- **Admin-uploaded documents** — any additional documents uploaded directly by an admin. These carry an "Admin Upload" badge and can be deleted.
- **Customer-uploaded documents** — files submitted by the customer via a secure upload link (see below). These carry a "Customer Upload" badge.
- **Inbox documents** — files saved from an email thread. These carry an "Inbox" badge.

**Uploading a document directly (admin has the file on hand):**
1. Open the customer's profile
2. Scroll to the **Documents** section
3. For a named onboarding document type (e.g. Signed NDA), click **Upload** next to that row
4. To add any other document, click **Upload additional document**, enter a label, and select the file
5. The upload begins automatically on file selection

**Requesting documents from the customer (admin does not have the file):**

If you need documents from the customer but do not have them on hand, you can send them a secure upload link by email.

1. Open the customer's profile
2. Scroll to the **Documents** section
3. Click **Request docs** in the section header
4. A modal shows the available recipient emails — the company's own email address plus any contacts listed on the account. Select the correct recipient.
5. Click **Send upload link**

The customer receives an email with a button linking to a secure upload page. The link expires after 7 days. From that page, the customer can drag and drop or browse for files and submit them directly. No portal account is required.

**Upload request status banner:**
Once a request has been sent, a status strip appears at the top of the Documents section so any admin viewing the profile can see what happened:

| Status | Meaning |
|---|---|
| Amber — "Awaiting response" | Link sent, not yet opened |
| Blue — "Link opened, awaiting upload" | Customer clicked the link but has not uploaded yet |
| Green — "Documents received" | Files have been uploaded and are now on the profile |
| Gray — "Link expired — not used" | 7 days elapsed without any upload |

If the link expires without being used, or if the customer needs a new link for any reason, click **Send new link** / **Resend** in the banner to send a fresh link. The new request replaces the displayed status.

When documents are received, the onboarding team receives a notification email listing the files uploaded.

All documents are stored in Cloudflare R2 and served via secure, time-limited download links. Click **Download** next to any document to access it.

### Orders

Go to **Orders** to see all orders in Odoo.

The Orders screen is a **monitoring view** — you cannot confirm, cancel, or place orders from here. All order lifecycle actions happen through **Sales Tickets**.

What you can do here:
- See every order's status in Odoo
- See the linked Sales Ticket status and packing board status for each order
- For old draft orders without a Sales Ticket: click **Create Sales Ticket** to bring them into the pipeline

> A confirmed order that hasn't reached the packing queue is normal, not an error — it's waiting on Finance to register the 50% deposit (Awaiting Deposit status on the linked Sales Ticket). There is no "queue it anyway" override anymore — every order reaches packing the same way, through a registered deposit.

**Reseller orders:** If an order was placed by a reseller partner on behalf of a customer, the Customer column shows the reseller's name in a purple badge beneath the customer name. This appears for all reseller orders — including those from resellers who are not commission-eligible.

### Order Passport

Click any order row to open its **Order Passport** — a single-page lifecycle summary that shows everything about an order in one place, without needing to navigate between three separate views.

**What the passport shows:**
- **Overall status** — a colour-coded badge derived from the combined state of the Odoo order, ticket stage, invoice, and deliveries (e.g. "Awaiting Payment", "In Packing", "Complete")
- **Pipeline stepper** — visual progress indicator from Quote through to Complete, with the active stage highlighted
- **Sales Ticket card** — ticket reference, current stage, who it is assigned to, order type (Reseller Order / Internal Order), reseller name if applicable, customer name, any notes, and both created and last-updated timestamps
- **Invoice card** — invoice reference, amount, payment state, and due date
- **Delivery & Fulfilment section** — each outgoing delivery with state, scheduled date, and per-product quantities delivered vs ordered; batch/lot numbers shown as chips on each line
- **Order lines table** — all products with quantities, unit prices, and the batch references dispatched against each line
- **Outstanding line rows** — any product not yet fully delivered is highlighted in amber; clicking the row navigates to the Backorders page pre-filtered to that order

The passport is also the landing page for all barcode scans and order reference searches via the global search bar.

### Backorders

Go to **Backorders** (under the Orders section in the sidebar) to see a consolidated view of all outstanding backorder demand across every customer order.

A backorder exists when an order was partially delivered — some products shipped, but others could not because stock was unavailable. Odoo creates a separate delivery picking for the shortfall, which sits in this view until the stock is received and the delivery is completed.

Every backorder still waiting on stock at 17:00 is included automatically in a daily digest email (configured under **Settings > Email Notifications > Orders & Fulfilment > Daily Digest: Backorders**), so nothing sits forgotten overnight.

**Stats row:** Total backorder pickings, distinct products affected, and a breakdown by state (Confirmed vs Ready).

**State meanings:**
- **Confirmed** — the backorder picking is confirmed but stock has not yet been reserved to it.
- **Ready** — Odoo has reserved stock to this backorder; the order clerk can action it on the packing board.
- **Waiting** — the backorder is blocked, waiting on an upstream picking or manufacturing order.

**By Order view (default):** One row per backorder picking. Rows with multiple products collapse to show the first product with a "+N more" link — click to expand. Click the **sale order reference** (e.g. S00042) in the first column to open the Order Passport for that order — the full lifecycle view showing ticket stage, invoice, deliveries, and batch numbers. Each row also links to the portal Sales Ticket if one exists.

**By Product view:** Aggregates by product across all waiting orders. Shows total units outstanding and how many orders are waiting. Useful for production planning — tells you the aggregate demand for each product before raising a manufacturing order. Click any row to expand and see which specific orders are waiting.

**Manufacturing Orders:** When Odoo has created an `mrp.production` record linked to the same sale order, the MO name and state appear inline on the relevant product line. The chip shows the MO reference, its state (Confirmed / In Progress / To Close), how many units are currently being produced (e.g. "5/10 producing"), and the planned finish date when set. Phase 13 will add the ability to schedule and drive production directly from this view.

**MO visibility on tickets:** The same production status information appears in two other places:
- **Sales Ticket detail** — a "Production Status" card appears below the Delivery and Fulfilment section whenever any delivery on the order is a backorder. It auto-loads without refreshing the page.
- **Orders Ticket waiting_stock panel** — when an order is in Awaiting Stock state (a backorder entry), a "Production orders" section appears inside the amber panel, showing the same MO detail.

If no MOs exist (Odoo has not yet created a replenishment manufacturing order), neither the card nor the section appears.

### Invoices

*Requires `invoices.view` permission*

Go to **Invoices** to see all customer invoices from Odoo. Click any row to open the print-ready invoice view (portal format with bank details and payment terms).

**Batch/lot numbers on invoices:** The invoice print view shows the batch/lot number(s) next to each line item, sourced directly from the Odoo delivery picking linked to the sale order. This ensures the dispatched batch is identifiable from the invoice document — a medicinal cannabis compliance requirement. Batch numbers only appear once the order has been packed and the delivery validated; they are blank on invoices for orders not yet dispatched.

**Filter chips:**
- **Outstanding** — invoices with an unpaid or partially paid balance
- **Unpaid** — fully unpaid invoices
- **Partial** — partially paid
- **Paid** — fully settled
- **All** — everything
- **Credit Notes** — credit notes issued in Odoo (marked with a purple CN badge)

**Invoice actions** *(requires `tickets.finance_confirm`)*:

Each invoice row shows the relevant actions for its state:

- **View** — opens the portal print view; use Print / Save PDF to generate a PDF for the customer.
- **PDF** — downloads the Odoo-generated invoice PDF directly.
- **Send** — sends the invoice email to the customer via Odoo's mail template. Only available for posted invoices.
- **Draft** *(admin only)* — resets a posted, unpaid invoice to draft for editing. A confirmation modal is shown. Not available if any payment has been registered.
- **CN** — raises a credit note against the invoice. Enter a reason (required), date, and journal, then confirm. The credit note is created in Odoo immediately and appears in the Credit Notes filter.
- **Ticket** — creates a Sales Ticket from the linked Odoo sale order. Only shown for invoices that have a linked sale order but no portal ticket yet — useful for invoices created directly in Odoo before the portal existed.

If a ticket already exists for the invoice, a **Ticket** link appears in the Status column — click it to open the ticket directly.

**Registering a payment** *(requires `invoices.record_payment`)*:
For an unpaid invoice, click **Register Payment**, select the payment journal, enter the amount and date, and confirm. The payment is recorded in Odoo immediately.

### Customer Applications

*Requires `customers.view` permission*

Go to **Applications** to review customer onboarding applications submitted by resellers. A badge on the sidebar menu shows the number of applications currently awaiting review — this count refreshes automatically every minute.

**Application list:**
Filter by status using the chips at the top. Each row shows the business name, the reseller who submitted it, the contact details, submission date, and current status. Click any row or the Review/View button to open the full application.

Status values on the list:
- **Pending Review** — initial submission received, awaiting admin review
- **Docs Generated** — admin has generated pre-filled NDA and SOA; not yet sent to customer
- **Awaiting Signature** — signing link has been sent; customer has not yet signed all documents
- **Needs Countersign** — customer has signed; Bassani signing authority needs to countersign
- **In Progress** — one document countersigned, one outstanding
- **Ready to Approve** — all documents signed and countersigned; approval available
- **Approved / Rejected** — terminal states

**Reviewing an application:**
The application detail page is a two-column view:
- **Left column:** Full business details, primary contact, business address, additional information, and all submitted documents
- **Right column (sidebar):** Application metadata and action buttons

**Documents:** The Documents section on the application shows the documents received. Initially this will be the Customer Information Form and CIPC certificate. The NDA and Store Onboarding Agreement are collected via a separate signing session described below. Click **Download** next to any document to access the secure download link.

> If an application sits for 4+ hours after submission with documents not yet generated, an escalation email is sent automatically to the addresses configured under **Settings > Email Notifications > Onboarding & Applications > Application Stalled (4+ Hours)**, with a direct link to the application — a safety net so a submission never just gets forgotten. Each application is only escalated once.

**Step 1 — Generate documents for review** *(requires `customers.approve_onboarding`)*:

After reviewing the initial submission (Customer Information Form + CIPC) and confirming the customer's details are correct:

1. Click **Generate Documents** in the NDA and Store Agreement panel below the documents list
2. The system creates a 30-day signing session and snapshots the customer's data from the application — no email is sent at this point
3. The panel updates to show a **Preview NDA** and **Preview Store Agreement** button. Click either to open a pre-filled version of that document in a new browser tab. Check that the company name, registration number, contact details, and address all read correctly
4. If details are wrong, close the preview and correct them on the application record, then regenerate
5. Once satisfied with the pre-filled content, proceed to Step 2

**Step 2 — Send documents to the customer** *(requires `customers.approve_onboarding`)*:

1. Click **Send to Customer** in the NDA and Store Agreement panel
2. The customer receives a secure email with a unique 30-day link to `/sign/{token}`
3. The panel updates to "Awaiting customer signature" and shows which documents have been signed
4. The application status badge on the list page updates to **Awaiting Signature**
5. If the customer has not signed after a few days, click **Resend signing link** to send the email again with the same link

**What the customer does:**
The customer opens the link (no portal account required), sees a pre-filled copy of each document, draws their signature on a canvas, and submits. Each signed document appears in the Documents list with a "Signed in portal" badge. The customer can sign both documents in one sitting or return later — the link stays valid for 30 days.

**Step 3 — Countersign** *(requires `signing_authority.sign`)*:

Once the customer has signed both documents, they appear in the Documents section with a "Signed in portal" badge and a **Countersign** button. The Countersign Assignment card in the sidebar becomes visible.

1. Click **Claim Application** in the Countersign Assignment card to reserve the application
2. Click **Countersign** next to the NDA, review the document, draw or apply your configured signature, and submit
3. Repeat for the Store Onboarding Agreement
4. Both countersigned documents now show a "Countersigned by [your name]" badge

When both are countersigned, a notification email is sent automatically to the recipients configured under **Settings > Email Notifications > Onboarding & Applications > Onboarding: Documents Countersigned** (typically Kashi and Dean). Before that, once the customer has submitted both signed documents, a separate **Countersigning Needed** notification already alerted signing authorities that this step was waiting on them.

**Step 4 — Approve & Send Welcome Pack** *(requires `customers.approve_onboarding`)*:

Once countersigning is complete, approving the application and sending the Welcome Pack are done together as a single action — there is no separate "send" step first.

1. Click **Approve & Send Welcome Pack** in the right sidebar
2. A compose window opens showing the customer's email, a pre-populated subject and message (edit if needed), and the full list of attachments the email will actually send — this list is pulled live from the system, so what you see is exactly what the customer will receive: the Signed CIF, supporting business/ID document(s), countersigned NDA, countersigned Store Agreement, plus the active version of each Welcome Pack document (Help Me Budget, Welcome Letter, Price List, Product Brochure)
3. Click **Approve & Send Welcome Pack** to confirm
4. The system creates the customer in Odoo, links them to the reseller's account, and sends the Welcome Pack email in the same step. Your name and title appear as the email footer
5. The reseller receives a separate approval email
6. The application status updates to **Approved**, and a "Welcome pack sent by [your name]" badge appears on the page — no navigation away required
7. A **View Customer Profile** button also appears on the page — click it to jump straight to the new customer's profile in the Customers section

> If any of the 4 documents are missing, or the NDA/SOA have not been countersigned, the action is blocked with a specific error before anything is created.

**If the Welcome Pack email fails to send after the customer has already been approved** (for example, no active Welcome Pack template is configured): the customer account is still created — that step is not undone — and a **Send Welcome Pack** retry button appears on the application's Decision card once approved. Use it to retry the send on its own once the underlying issue (e.g. missing template) is resolved.

**If approval is blocked by a duplicate customer:**

When you click **Approve & Send Welcome Pack**, the system checks Odoo for a customer with a matching email or VAT before creating anything. If a match is found, the approval is blocked with a message identifying the existing customer.

This means the customer already exists in Odoo — possibly created directly in Odoo before the portal existed, or via a previous admin-created entry. In this case you have two options:

- **Link to the existing customer** — If the existing Odoo customer is the correct match for this application, use **Approve & Link to Existing Customer**. Enter the Odoo partner ID of the existing customer and confirm. The reseller is linked to that existing customer, the application's documents are attached to their profile, and the reseller receives the same approval email. No new Odoo record is created.
- **Reject** — If the existing Odoo customer is a genuinely different business (name collision, not a true duplicate), reject this application with an explanation and ask the reseller to clarify.

> Never create a duplicate customer in Odoo to work around the block. The duplicate check exists because dirty data causes incorrect stock reservations, billing confusion, and compliance exposure.

**Rejecting an application** *(requires `customers.reject_onboarding`)*:
1. Click **Reject Application**
2. A text field appears — enter a clear reason for rejection (this is sent to the reseller)
3. Click **Confirm Rejection**
4. The reseller receives a rejection email with your reason
5. The application status updates to **Rejected** — the rejection reason is displayed on the application for future reference

---

### Sales Agents

*Requires `resellers.view` permission*

Go to **Sales Agents** to manage your sales agent network.

Each agent's profile shows:
- Their contact details and assigned warehouse
- Their order history and total revenue
- Their linked customers with the ability to link or unlink accounts
- Their activity feed — every significant action recorded in the audit trail (orders placed, customers linked, applications submitted, etc.)

**Linking an existing customer to a sales agent:**
Customers created through the onboarding wizard are automatically linked to the submitting agent. However, an admin can also manually link any existing Odoo customer to an agent — for example, if a customer was created directly in Odoo before the portal existed, or if account management responsibility is being transferred.

1. Open the agent's profile
2. In the **Customers** section, click **Link Customer** (top-right of the section, or the link at the bottom of the list)
3. A search modal opens — type at least 2 characters to search Odoo customers by name or email
4. Click **Link** next to the correct customer
5. The customer is added to the agent's account immediately and appears in the list

> If the customer is already linked to a different agent, the link will be blocked with a clear error message showing which agent currently owns that account.

> **What linking actually does:** from the moment you link a customer, the agent gets full visibility of every order for that customer — including ones Bassani staff place directly on the customer's behalf — and earns commission on all of it, exactly as if they'd placed every order themselves. This is not retroactive: if the customer already has past orders, the agent does not earn commission on those, only on orders confirmed from the link date forward.

**Unlinking a customer from a sales agent:**
1. Open the agent's profile
2. In the **Customers** section, click **Unlink** on the customer row
3. A confirmation dialog appears — confirm the action
4. The customer is removed from the agent's account

> Unlinking does not delete the customer from Odoo — it only removes the ownership association. The customer's orders, invoices, and history remain intact. The agent will no longer be able to place orders for this customer or see them in their customer list.

Both link and unlink actions are recorded in the audit trail and appear in the agent's Activity section.

### Commission

*Requires `commission.view` permission*

Go to **Commission** to manage monthly reseller commission statements.

**How commission works:**
At the end of each month, you generate a commission statement for each reseller. The system:
1. Pulls all confirmed, non-cancelled orders for that reseller in the target month
2. Calculates total turnover
3. Applies the correct tier rate
4. Produces a statement showing the amount owed

**Generating statements** *(requires `commission.generate_statements`)*:
1. Click **Generate Statements**
2. Select the month and year
3. Select a specific sales agent or all agents
4. Click Generate

Cancelled orders are automatically excluded. Sales agents with **Applicable for commission** unticked are automatically excluded from bulk "all agents" runs — only commission-eligible agents receive statements. The agent receives an email with their statement summary.

> If you need to generate a statement for a specific agent regardless of their commission eligibility (e.g. for a correction run), select that agent individually from the dropdown rather than using "all agents".

**Marking statements paid** *(requires `commission.mark_paid`)*:
1. Open the statement
2. Click **Mark as Paid**
3. Enter the payment reference and date
4. The system creates a vendor bill in Odoo automatically — commission payments must have an Odoo record
5. The reseller receives a payment confirmation email

> If Odoo bill creation fails, the payment will not be marked as paid. You must resolve the Odoo issue first. If you have already created the bill manually in Odoo, you can tick the override checkbox and provide a reason.

**Disputes:**
A reseller may raise a dispute on any statement they believe is incorrect. Disputed statements appear with a red badge in the Statements list. Review the dispute, then click **Resolve** and enter your response notes. The reseller receives an email with your resolution.

**Tier settings** *(requires `commission.configure_tiers`)*:
Go to **Commission** → **Tier Settings** to add, remove, or reconfigure tier brackets and rates. See Step 5 for full instructions. The Change History panel below the tier table shows every change made — who made it and when.

### Reports

*Requires `reports.view` permission. Export requires `reports.export` permission.*

The Reports page provides six analytics reports sourced from Odoo's confirmed sale orders and MongoDB commission records.

**Period selector:** A selector bar at the top of the report area lets you choose which period to view. Select the SA financial year (current year or up to 2 previous years) from the dropdown, then choose a specific month (displayed in SA FY order: Mar through Feb) or **Full Year** to see the entire FY aggregated. Changing the period immediately reloads the active report.

**Warehouse scoping:** Reports filter to the warehouse you have selected in the top-navigation warehouse picker. Select **All warehouses** to see unfiltered data across all warehouses. The period selector and warehouse scope work together — change either and the report reloads automatically.

**Reports available:**
- **Monthly Turnover** — total revenue, direct vs reseller split, VAT, commission paid out, and a 6-month revenue trend
- **Best Sellers** — top products by revenue for the selected period
- **Best Customers** — top customers by total spend for the selected period
- **Best Resellers** — reseller FY leaderboard; always shows full FY data regardless of month selection (commission, revenue, orders, customers onboarded)
- **Dead Stock** — products with no sales in the last 60 days that still hold stock; always reflects current position, not the selected period
- **Category Performance** — revenue share by product category for the selected period

**Exporting to Excel:** Click **Export Excel** (top right of the period bar) to generate a multi-tab `.xlsx` file. All six reports are fetched for the current period simultaneously and bundled into one file, with each report as a separate tab. The filename includes the selected period (e.g. `Bassani Health Analytics FY2025-26.xlsx` or `Bassani Health Analytics Jul 2026.xlsx`). This button only appears if you have the `reports.export` permission.

### Stock Report

*Requires `products.view` permission — found in the Insights section of the sidebar*

The Stock Report mirrors the Odoo stock report view, giving operations staff and the BA a dedicated place to check batch-level stock without opening Odoo.

**Product list:** Shows every product with stock on hand, including aggregated on-hand, reserved (committed to open orders), and available quantities. Use the search bar to filter by product name, internal reference code, or category. The Lots column shows how many distinct batches are currently in stock for that product.

**Lot / batch breakdown:** Click any product row to drill into its lot-level breakdown. Each row shows the batch name, storage location, on-hand, reserved, and available quantities, the date the batch was received, and the expiry date. Expired lots are flagged with a warning icon.

**Movement history (traceability):** Click the History button on any lot to open its full movement trail. Every inbound and outbound event is shown with a move-type label (Received, Dispatched, Internal Transfer, Adjustment, and so on), the quantity moved, and the date. This is the portal-native equivalent of Odoo's traceability report.

All stock figures are scoped to the warehouse you have selected in the top navigation. Switching warehouse updates the report automatically.

### Audit Trail

*Requires `audit.view` permission*

The Audit Trail records every significant action taken in the system — who did it, when, and what changed.

Filter by:
- Date range
- User (who did it)
- Action type (order.confirm, invoice.pay, user.create, etc.)
- Entity type (order, invoice, user, commission, etc.)

Click any row to see the before/after detail. This is your definitive record of everything that happened and who is responsible.

---

## Self-Service Customer Registration

**URL:** `portal.bassanihealth.com/apply`  
**Access:** Public — no login required

Customers can register directly without contacting Bassani staff or going through a reseller. The page is accessible without a portal account and works on mobile devices.

### How it works

**For a customer registering directly:**
1. Navigate to `portal.bassanihealth.com/apply`
2. **Step 1 — Business Details:** Complete three fields at the top of this step:
   - **Business Category** — what type of business they operate (Pharmacy, Dispensary, Wellness Centre, Medical Clinic, Health Retailer, or Other). "Other" reveals a required text input.
   - **Legal Entity Type** — the legal structure of the business (Private Company (Pty) Ltd, Close Corporation (CC), Sole Proprietor, Partnership, or Other). "Other" reveals a required text input. Selecting "Sole Proprietor" simplifies the form: Company Reg field is hidden, and "Registered Company Name" becomes "Business / Trading Name".
   - **Section 22C Licensed Facility** — tick this box if the business holds a Section 22C licence under the Medicines and Related Substances Act.
   Once Legal Entity Type is selected, the company name, registration number, and VAT fields appear below.
3. **Step 2 — Primary Contact:** Full name, position (required), SA ID number (13-digit, Luhn-validated), email, and phone (SA format enforced). The ID number is embedded in the Customer Information Form for document signing.
4. **Step 3 — Business Address:** Street, suburb (required), city, province (required), and 4-digit postal code (required).
   - The street field has smart autocomplete — start typing and a dropdown of South African suggestions appears. Selecting one fills in street, suburb, city, province, and postal code automatically.
5. **Step 4 — Additional Information:** Order volume, referral source, and notes — all optional.
6. **Step 5 — Sign Documents:** The Customer Information Form opens pre-filled. The customer reviews, draws their signature, and clicks Sign. Upload the CIPC certificate. Click Submit.
7. A confirmation email with a reference number is sent immediately. Bassani staff review the application within 2 to 3 business days.

**For a customer referred by a reseller:**
1. The reseller shares their personal referral link (see below)
2. The customer opens the link — a "Referred by [Reseller Name]" banner confirms the association
3. The customer completes the same five-step process
4. On approval, the customer account is automatically linked to the referring reseller — no manual linking required

### In-portal document signing

On the final step of the wizard (Sign Documents) the customer signs all four onboarding documents without leaving the browser. Each document:

- Opens in a full-screen panel with the original PDF visible on the left and a pre-filled form on the right
- All fields populated from the customer's own answers — company name, registration number, contact details, address, signatory ID number — appear already filled in. The customer can correct any field before signing
- Bassani Health's name, title, and today's date are auto-embedded in Bassani's text fields. The Bassani signature block is completed by a Bassani representative on application approval
- The customer draws their signature on the canvas and clicks Sign Document
- The signed PDF is generated in the browser and uploaded automatically — no download or email required

A green tick appears on the document card once each document is signed. The customer can re-sign any document before submitting if they need to correct information. The Submit button is locked until all four documents are signed and the CIPC certificate is uploaded.

### Reseller referral links

Resellers have a personal referral link available from inside the portal. The link looks like: `portal.bassanihealth.com/apply?ref=RESELLER_CODE`

Resellers can copy this link and share it with prospective customers by email, WhatsApp, or any other channel. The link is permanent and does not expire.

### What the admin sees

Self-service applications appear in the existing Customer Applications review queue alongside reseller-submitted and inbox-sourced applications. They are labelled "Direct (self-service)" in the Submitted By column so staff can distinguish them. All five documents are always attached (unlike inbox-sourced applications which may have documents arriving separately).

For applications signed in-portal, the documents section of the review page shows additional status badges on each document:

- **Signed in portal** (blue) — the PDF was signed in the browser, not manually uploaded.
- **Awaiting countersignature** (amber) — Bassani's signature block has not yet been completed.
- **Countersigned by [name]** (green) — the signing authority has countersigned this document.

The **Approve and Create Customer** button is locked until all three documents that carry a Bassani signature field (NDA, Trading Quality Agreement, and Store Onboarding Agreement) are countersigned. The Customer Information Form has no Bassani signature field and does not need to be countersigned.

### Countersigning applications (Signing Authority)

Any staff member with the `signing_authority.sign` permission can countersign. If you do not hold this permission, the Countersign button is not shown. Multiple people can hold this permission and countersign different applications at the same time.

**Before you can countersign,** your profile must be fully configured — signing name, signing title, and signature image must all be set (see My Profile below). The Countersign button will not work until your Signature Status shows "Configured".

**Claiming an application (optional but recommended)**

To prevent two signing authorities from countersigning the same application at the same time, use the claim mechanism:

1. Open the application from Customer Applications
2. In the right sidebar, click **Claim** — the application now shows as assigned to you
3. If another signing authority has already claimed it, a confirmation prompt appears before you can take over

To release a claim (if you can no longer complete it), click **Release**. Another signing authority can then claim it.

**To countersign a document:**

1. Open the application from Customer Applications
2. In the Supporting Documents section, find a document showing "Awaiting countersignature"
3. Click **Countersign** next to that document
4. A split-panel window opens: the customer's signed PDF is shown on the left; the signature panel is on the right
5. Choose **Use stored** to embed your configured signature, or **Draw new** to sign on the canvas
6. Click **Countersign Document** — the portal generates the final co-signed PDF in your browser, uploads it automatically, and marks the document as countersigned
7. Repeat for each remaining document
8. Once all three documents are countersigned the Approve button unlocks

> **Note:** Manually uploaded documents (applications that arrived by email or were uploaded by a reseller) do not require countersigning and the Approve button is never blocked for those applications.

The countersigned PDFs are stored in secure cloud storage and are visible from the document list alongside the customer-signed originals.

---

## Sales Agents

**Role in system:** `reseller`  
**Access:** Products (catalog view), Orders, Customers (own), Commission (commission-eligible agents only), Invoices (own), Sales Tickets, Onboarding Docs

Sales agents are the people who sell Bassani Health products to customers on behalf of Bassani. Some agents are external business partners who earn commission; others are internal Bassani staff who manage a portfolio of clients. The Commission section and menu item are only visible to agents where commission has been enabled on their account.

### Product Catalog

Go to **Products** to browse the Bassani Health product catalog. This is a read-only view showing only the products that Bassani admin has made available to resellers.

Each product shows:
- A product image, where Bassani admin has uploaded one (a placeholder icon shows otherwise)
- Product name and SKU
- Category
- Sale price (the price you order at)
- **Available Stock** — the forecasted quantity available for new orders. This is the same figure the order cart uses when you place an order. If this is 0 or negative, those units are committed to existing orders
- **Min. X units** (amber badge, where applicable) — the minimum order quantity set by Bassani admin. You must order at least this many units of this product per order line

**Filtering by category:** Above the product list are up to three dropdowns — **Category**, **Brand / Grade**, and **Variant**. Category lists Bassani-defined groupings (e.g. "Flower", "Vapes", "Specials") set up by admin to make browsing easier — not Bassani's internal product categories, which is what the Category column on each product row still shows for reference. Only groupings that currently have products appear in the list; if a product hasn't been grouped yet it appears under an "Uncategorised" option instead of disappearing. Selecting a Category immediately shows every product in it. If that category has sub-groups underneath it (e.g. "Flower" splits into Indoor/Exotic/Greendoor/Greenhouse, or "Vapes" splits into its two brands), the **Brand / Grade** dropdown appears so you can narrow further — you don't have to use it, the full list is already showing. If the products in view have variants (e.g. different strengths or sizes), a **Variant** dropdown appears too. Once a Brand / Grade is selected, the Variant dropdown drops that grade from its options automatically — under "Flower" > "Exotic," it shows plain sizes like "1G," "3G," "5G" rather than repeating "Exotic" in every entry, since you've already picked it. Each dropdown supports typing to search rather than scrolling a long list.

> You do not see internal stock figures, cost prices, or any stock movement history. Available Stock is the only quantity shown and it is the one that matters for ordering.

### Placing an Order

1. Go to **My Quotes** in the sidebar and click **New Quote** — the product catalogue opens in cart mode
2. Select the customer you are ordering for using the search box on the right
3. Search or browse the catalogue and click **Add to Order** — the item appears in your cart
4. Adjust quantities as needed (you cannot go below any minimum order quantity shown in amber)
5. Click **Place Order** to submit and confirm it in one step, or **Save as Draft** if you're not ready to commit yet (for example, you still need to double-check something with the customer)

**Place Order** (2026-08-21) checks current stock availability before committing, in the same way Confirm Order always has:

- If all items are in stock, it confirms immediately — no extra click needed
- If some items are not available, a **stock check modal** shows which items will ship now and which will be backordered; choose **Confirm — Create Backorder** to proceed, or **Save as Draft Instead** if you'd rather hold off
- If you confirm, Bassani will ship what is available immediately and fulfil the rest as soon as stock arrives, and you'll get a separate email when the backorder is ready
- If the customer is over their credit limit, you'll be offered **Confirm Anyway** to proceed regardless, or **Save as Draft Instead**

> **If the stock check modal shows a red "Partial fulfilment blocked" notice:** no confirm option will be offered. This is a configuration issue on the Bassani side — one or more products on the order need a setting updated before a partial delivery can be invoiced correctly. Contact Bassani directly. Your order is saved as a draft in the meantime; do not attempt to confirm it until you have been notified that the issue is resolved.

**Save as Draft** creates the quote without confirming it — exactly like Place Order used to work. Use this when you want a chance to review, edit, or discuss the order with your customer before it commits. A draft quote sits in **My Quotes** where you (or Bassani staff) can pick it up later.

From **My Quotes**, a draft quote (one you saved without confirming, or one you cancelled out of a stock/credit check on) offers:
- **Edit Quote** — returns you to the cart pre-populated with the current lines so you can adjust quantities or add/remove products. The customer cannot be changed once the quote is created.
- **Send Quote** — sends the quote to the customer for review (optional)
- **Confirm Order** — runs the same stock-check-then-confirm flow described above, whenever you're ready to commit it

On your **My Quotes** detail view, when an order is partially fulfilled you can see the split: items that shipped are listed under "Shipping now" and backordered items under "Backordered" with quantities.

> Once an order is confirmed (whether via Place Order or a later Confirm Order), your customer receives a pro-forma invoice by email showing the 50% deposit due. Bassani's finance team registers that deposit once it's paid — only then does the order move onto the packing board for fulfilment. You cannot edit or cancel after confirmation — contact Bassani directly if changes are needed at that stage.

**Uploading proof of payment (2026-08-21):** on any order's page, a "Proof of Payment" card lets you (or your customer) upload a photo or PDF of the payment confirmation. It's optional — Bassani still confirms the deposit or balance through the usual process either way — but it puts the file straight in front of Finance, which can speed things up.

### Recurring Orders

If a customer orders on a regular schedule, you can set it up two ways: tick **Make this a recurring order** in the cart before you click Place Order or Save as Draft (2026-08-21 — set it up in the same step as the order itself, no separate trip needed), or set it up afterwards from a ticket that already has an order on it (Merveille can also do this from her side for a direct-inquiry customer). Either way, you choose how often it repeats (weekly, every two weeks, or monthly) and optionally when it should stop. Two days before each repeat date, the portal emails the customer directly — not you — a link to review and accept or decline that occurrence. Accepting confirms the order automatically; Bassani finance still needs to register the deposit before it moves into fulfilment, same as any other order. If the customer doesn't respond, that occurrence is simply skipped and the schedule continues from the next date — nothing further is required from you.

### Viewing Your Commissions

Go to **Commission** to see your monthly statements.

Each statement shows:
- Your total qualifying turnover for the month
- Your tier (which commission rate applied)
- The commission amount owed
- Payment status (Pending / Paid / Disputed)

If you believe a statement is incorrect:
1. Click **Dispute** on the relevant statement
2. Enter your reason
3. The admin team will review and respond — you will receive an email when resolved

### Onboarding Docs — Quick Access

The **Onboarding Docs** page lets you download or send the Customer Information Form template at any time — for example, when a prospect asks for the form before you are ready to start a formal application.

Go to **Onboarding Docs** in the sidebar. From here you can:

- **Download** the Customer Information Form directly to your device
- **Email the Customer Information Form** to your customer by entering their email address and clicking **Send Documents**

> The NDA and Store Onboarding Agreement are not distributed directly. Bassani Health generates and sends those documents to the customer directly after reviewing your application — this ensures confidential agreement terms are only shared after admin review.

> **For a formal onboarding, use the wizard instead.** Go to **Applications** → **Start Application**. The wizard creates the application, saves your progress, and notifies Bassani Health to begin the signing process. Using the wizard avoids having to re-enter the customer's details later.

---

### Onboarding a New Customer

Go to **Applications** in the sidebar → click **Start Application**. The wizard opens at Step 0.

#### Step 0 — Documents

Step 0 has two paths depending on whether you have the signed documents in hand.

**Path A — Email the docs and continue (recommended)**

Enter the **customer's business name** (required) and their email address, then click **Send Docs**. The four template PDFs are emailed to the customer from the Bassani Health address. As soon as the email is sent:

- A draft application is created and linked to you
- The rest of the wizard unlocks immediately — you do not need to wait for the customer to return the docs
- Click **Continue — fill in details** and complete Steps 1-4 with whatever you know now

The customer's signed documents will arrive via email. The Bassani admin team will save them to your application and you will receive an email notification with a link to resume and submit.

**Path B — Upload signed documents directly**

If the customer has already returned the signed documents, upload them here instead. All five must be uploaded before you can continue:
- Signed Store Onboarding Agreement
- Signed Customer Information Form
- Signed NDA
- Signed TQA Document
- CIPC Company Registration Certificate

Click **Upload** next to each document, select the file, and wait for the green tick. The progress counter shows how many are done (e.g. `3 / 5`). Once all 5 are uploaded, click **Continue**.

#### Steps 1-4 — Application Details

- **Step 1:** Business details — company name (required), trading name, registration number, VAT, business type
- **Step 2:** Primary contact — name, email, phone
- **Step 3:** Business address — street, city, province
- **Step 4:** Ordering volume and additional notes

Progress is saved automatically each time you move between steps (email path). You can close the browser and resume later.

#### Submitting for Review

When all fields are filled and documents are on file, click **Submit for Review**. The Bassani admin team is notified and will action the application.

Once approved, the customer is created and linked to your account — their orders count toward your commission turnover. You will receive a confirmation email.

#### Resuming a Draft

Draft applications (email path, waiting for docs) appear in **Applications** under the **Drafts** filter. Click any row to resume the wizard.

You can also use the link in the "Docs received" notification email, which takes you directly to the wizard pre-loaded with the application.

#### Tracking Your Applications

All applications are listed under **Applications**:
- **Drafts** — email sent, waiting for docs or not yet submitted
- **Pending** — submitted, awaiting admin review
- **Approved** — customer is active and linked to you
- **Rejected** — includes the rejection reason so you can address it

### Viewing Customer Profiles

Click any customer under **My Customers** to see their full profile:
- All of their orders, whether you placed them or Bassani staff took the order directly on their behalf
- Their outstanding invoices and account balance
- Their account statement (all invoices and credit notes, filterable by date)

> Once a customer is linked to you, you see everything for that customer — as if every order had come through you, even ones Bassani staff placed directly (e.g. the customer phoned in). You earn commission on all of it too. The only exception is timing: if an existing customer gets linked to you later, you don't retroactively earn commission on orders they placed before the link — only from the date they became your customer onward.

### Requesting a Credit Note

If a customer received incorrect goods or there is a billing dispute:

1. Go to **Invoices**
2. Find the relevant invoice
3. Click **Request CN**
4. Enter the reason

The Bassani finance team is notified. They will process the credit note in Odoo. The request status changes from Pending to Acknowledged once processed.

### Delivery Tracking

Open any confirmed order to see delivery status:
- **Ready** — picked and waiting for dispatch
- **Done** — delivered
- **Assigned** — being prepared

If your order is being delivered in multiple shipments (backorder), you will see multiple delivery records — one for the items already dispatched and one (marked "Backorder") for the outstanding items. Each delivery line shows how many units were dispatched versus ordered.

---

## Customer Self-Service Portal

**Access:** `customer` role — an already-approved Bassani customer given their own portal login.

Some customers can log into the portal directly rather than ordering through a Sales Agent or by phone/email. A customer login can place its own orders, view its own order status, and view its own invoices — the same real pipeline every other order goes through. A customer account never earns commission. If the customer's business is linked to a Sales Agent, that agent still earns commission on everything the customer orders, exactly as before — nothing changes on the commission side.

### Granting a customer portal access (Admin)

Portal access is never automatic — an admin must turn it on for a specific customer.

1. Go to **Customers** and open the customer's profile.
2. Scroll to the **Portal Access** section (only visible if you have the "Grant & revoke customer portal logins" permission).
3. For a business, the list always starts with a row for the **company account itself** (marked "Company account"), using whatever email/phone is on the company's own record — useful when a customer has never had a separate named contact split out, only a general email address. Below that, every contact on file for the company also gets its own row. Each row has a checkbox and a status: **Not provisioned**, **Active**, or **Deactivated**. Tick the box next to whoever should get a login — the company account, one or more named contacts, or both — then click **Grant Access**. You can come back at any time and enable more logins as needed — nothing is locked in.
4. For an individual customer (a named patient, not a company), there's a single enable toggle instead of a list.
5. Each newly granted login receives an email inviting them to set their own password. The link expires after 15 minutes — if it's expired, they can use "Forgot password" on the sign-in page to request a new one.
6. To turn off a login (e.g. someone has left the business), click **Deactivate** next to their name. This only disables their login — it does not touch their contact record in the customer's account.

If a row has no email address on file (including the company account row itself), it can't be granted a login until one is added — use **Add contact** in the Contacts section above to add a person, or edit the company's own email, then come back to this section.

**Same person, more than one company (2026-08-21):** it's common for one email address to be linked to more than one Bassani customer, the way "Same contact, multiple branches" already works during onboarding. If you try to grant access to an email that already has an active login for a *different* company, the row shows an amber note ("Also has portal access to: [company]") and clicking Grant Access asks you to confirm first. The confirm screen lists every other company that login already has access to, each with a tick box, ticked by default. Confirming adds the new company to their existing login rather than creating a second one, no new password required, one email letting them know. If one of the other companies listed is a duplicate or a store being phased out, untick it before confirming. That removes that company's access in the same step, so it stops appearing in their switcher, without needing a separate trip to that company's own profile. That person then sees a company switcher at the top of their portal to move between whichever companies they still have access to, using the exact same sign-in.

**Default warehouse:** Once at least one login has been granted, a **Default Warehouse** field appears at the bottom of the Portal Access section, letting you pin which warehouse that customer's orders and product catalogue draw from. Leave it blank to use the standard admin default. It only appears once portal access actually exists, since it has nothing to affect before then.

### What a customer sees once logged in

A customer's portal is deliberately simple — four items in the sidebar:

- **Dashboard** — a summary of their own recent orders and account status. They never see business-wide figures, other customers' data, or anything reseller- or staff-facing.
- **Products** — the same browsable catalogue a Sales Agent's customers see: search, filter by category, add to cart.
- **My Orders** — every order placed on the account, whether they placed it themselves, a colleague at the same company placed it, or Bassani staff placed it on their behalf. Clicking an order opens the same Order Passport view staff use to track its progress.
- **Invoices** — every invoice for the account, with the same PDF download available elsewhere in the portal.

If more than one person at a company has portal access, they all see the exact same orders and invoices — a company account is shared, not split per person, **including orders Bassani staff place on the customer's behalf** — a customer's My Orders list is never limited to only what they personally placed. Placing an order never asks "who is this for" the way a Sales Agent's cart does — a customer login only ever orders for its own account.

**Switching between companies (2026-08-21):** every customer sees a company indicator at the top of the portal showing which account they're currently viewing, on both desktop and mobile. If that login only has access to one company, it just displays that company's name. If it's been granted access to more than one, it becomes a working dropdown. Switching it updates the Dashboard, Products, My Orders, and Invoices to that company's data immediately, with no need to sign out or sign in again.

### Placing an order

After adding products to the cart, a customer has two options:

- **Place Order** — submits and confirms the order in one step. The portal checks stock first: if everything is in stock, it confirms right away; if something isn't, a summary shows what ships now versus what's backordered, with a button to confirm anyway or hold off. If the account is over its credit limit, the customer is told to contact Bassani directly — there's no self-service override.
- **Save as Draft** — creates the order without confirming it, for when the customer isn't ready to commit yet. A saved draft appears in My Orders with its own **Confirm Order** button for whenever they're ready.

Either way, the order exists the moment either button is clicked — cancelling out of the stock or credit check just leaves it as a draft rather than losing it.

### Other things a customer can do

- **View a larger product photo.** Where a product has a photo uploaded, tapping its thumbnail in the catalogue opens a bigger version. Products without a photo just show the usual placeholder icon and aren't clickable.
- **Order items that are out of stock.** The catalogue only ever shows "In Stock" or "Out of Stock" — never an exact quantity. An out-of-stock item can still be added to the order; it ships as a backorder once restocked, and the cart shows a note explaining that.
- **Choose a delivery address.** If the customer's account has more than one saved address, a "Deliver To" dropdown appears in the cart, defaulting to their main registered address.
- **Reorder.** A "Reorder" button on any past order's page fills a fresh cart with the same items, at current prices, ready to review and submit again — quicker than rebuilding a large order from scratch.
- **Set an order to repeat automatically.** Tick "Make this a recurring order" in the cart before placing or saving the order to set it up in the same step, or use the "Make Recurring" button on any existing order's page afterwards — both set it up to repeat weekly, every two weeks, or monthly, the same feature a Sales Agent already has.
- **Clear the cart.** A "Clear" link next to the order summary empties it in one step, with a confirmation prompt first since it can't be undone.
- **Order comfortably from a phone.** On a phone or narrow tablet, the catalogue filters tuck behind a "Filters" button and the order summary becomes a slim bar pinned to the bottom of the screen showing the item count and total — tap it to review the full order, change quantities, or submit. This is the same cart as on a laptop, just laid out to fit a smaller screen; nothing about placing an order works differently.
- **Upload proof of payment (2026-08-21).** On any order's page (Order Passport, opened from My Orders), a "Proof of Payment" card lets the customer upload a photo or PDF of their payment confirmation. **This is optional** — Bassani will still confirm payment through the usual process either way — but sharing it can help speed things up, since it puts the file straight in front of Finance instead of them having to be told separately. Uploaded files stay listed there with a "View" link.

---

## My Profile

**Access:** All authenticated users (all roles)

Every user has a personal profile page accessible at any time. Click the **person icon** in the top-right corner of any page to open it.

### Personal Information

- **Display name** — your name as it appears in the portal (audit log entries, ticket ownership, etc.). Update it and click **Save Changes**.
- **Email address** — read-only. Contact the super admin to change your registered email.
- **Username** — read-only. Usernames are permanent.

### Change Password

Enter your current password, then your new password twice, and click **Change Password**. The new password takes effect immediately. The system logs out any other active sessions for your account when a password change completes.

### Signing Authority (staff with `signing_authority.sign` permission only)

The Signing Authority card is visible only to staff who have been granted the `signing_authority.sign` permission. It shows a **Signature Status** badge in the left sidebar:

- **Configured** (green) — all three required fields are present. You are ready to countersign documents.
- **Incomplete** (amber) — one or more fields are missing. The badge lists which items are outstanding. You cannot countersign until all three are set.

**To set up or update your signing identity:**

1. Fill in **Signing Name** — your name exactly as it should appear on the signature block in signed documents
2. Fill in **Title / Position** — e.g. Responsible Pharmacist, QA Manager
3. Choose how to provide your signature image:

   **Upload (recommended):** Click **Upload image**, select a photo or scan of your handwritten signature (PNG, JPG, or WebP). After uploading, toggle **Remove white background** to clean up the paper colour. Adjust the **Sensitivity** slider if fine strokes are disappearing (lower sensitivity) or a grey halo remains (higher sensitivity). Click **Re-apply** to preview before saving.

   **Draw:** Click **Draw** and use your mouse, trackpad, or finger on the canvas. Click **Clear** to start again.

4. Click **Save Changes** — saves your name, title, and signature image together. The Signature Status badge updates immediately.

> Click **Remove** to delete your stored signature image (this will change your status back to Incomplete and prevent countersigning until you re-upload or re-draw).

---

## Common Questions

**Q: An order is stuck — how do I move it forward?**  
Every stage in the pipeline can be overridden by someone with `tickets.manage` permission (typically the super admin or a senior admin). In the Orders Ticket detail, the **Override Stage** dropdown is available to that role and allows setting any status directly. This is the escape hatch for edge cases — use it carefully, as it is audit-logged.

**Q: A deposit was registered but the order never appeared on the packing board (Sales Ticket is stuck at "Awaiting Deposit" with a payment already showing).**  
This happens if Odoo hadn't yet generated the order's delivery record at the moment the deposit was registered — the deposit itself is unaffected (it's already posted and paid in Odoo), but the packing board card couldn't be created. The ticket shows a red "Not yet queued for packing" notice on its detail page (and a "Not Queued" badge on the Sales Tickets list) explaining why. Once the delivery exists in Odoo, an admin with `tickets.manage` can retry from the Sales Ticket's own **Admin Override** panel: select **In Fulfilment** in the Stage dropdown and save — this re-attempts queueing the packing board rather than just relabelling the ticket. This retry is only available once a deposit has genuinely been registered (or the order is a sample) — it cannot be used to skip the deposit requirement.

**Q: A reseller's commission statement shows the wrong amount.**  
Resellers can raise a dispute (see Commission section above). Admins should also check the Audit Trail for the generate statement event to see exactly which orders were included in the calculation. Cancelled orders are automatically excluded.

**Q: I forgot my password and cannot sign in.**  
On the sign-in page, click **Forgot your password?** below the sign-in button. Enter the email address registered to your account. If a matching account is found, a reset link is emailed to you — it expires in 15 minutes and can only be used once. Click the link, set a new password, and sign in. Any other active sessions are automatically signed out when the reset completes. If you do not receive the email, check your spam folder or contact your super admin to confirm the email address on your account.

**Q: I need to reset a staff member's password.**  
Go to **Users**, find the account, and click **Reset Password**. A new temporary password is generated and shown once — copy it before closing. The staff member is forced to change it on their next login. Optionally enter your own password instead of using the auto-generated one. Alternatively, ask the staff member to use the **Forgot your password?** self-service link on the sign-in page — this is the preferred approach as it does not require the temporary password to be communicated verbally.

**Q: A ticket shows "Order Cancelled" or closed itself automatically — nobody cancelled it.**  
If an order is cancelled directly in the ERP (Odoo), the portal detects this the next time anyone opens that ticket and closes it automatically. Odoo is the financial source of truth — if the order is gone there, the ticket reflects that immediately. An amber notice on the closed ticket explains that it was auto-closed due to an ERP cancellation. Check the ticket's timeline for the "Auto-closed: Odoo order was cancelled" entry, and investigate the cancellation in Odoo if it was unexpected.

**Q: A new order came in from Odoo that isn't in the portal.**  
All orders placed through the portal auto-create a Sales Ticket. Orders placed directly in Odoo will appear in the **Orders** screen but will not have a linked ticket. Use the **Create Sales Ticket** button on that order row to bring it into the pipeline. Once the ticket exists, Merveille can claim it and the normal flow applies.

**Q: The packing board display screen is blank or shows a disconnected message.**  
The display token URL may be incorrect or the token may have been regenerated. Go to **Warehouses**, copy the current display token for that warehouse, and update the URL in the browser. Tokens do not expire automatically — they only change when you generate a new one.

**Q: Odoo is down — can we still use the portal?**  
The portal will enter a degraded state. The health endpoint (`/health`) will report `degraded`. MongoDB-only features (commission statements, audit trail, tickets, reseller profiles) will still work. Anything that reads from or writes to Odoo (products, orders, invoices, customer data) will fail with an appropriate error message. The portal will recover automatically once Odoo comes back online.

**Q: The stock check modal shows a red "Partial fulfilment blocked" message and there is no option to confirm the backorder.**  
One or more products on the order are configured in Odoo with an invoicing policy of "Ordered quantities". Partial deliveries require the "Delivered quantities" policy so each invoice reflects only what has actually shipped. **Admin / sales:** Open the affected product in Odoo, go to the General Information tab, set Invoicing Policy to "Delivered quantities", and save. Then return to the ticket and retry confirming. All Bassani products should have this policy — if you see this error it means the Odoo product record was not updated correctly. **Resellers:** Contact Bassani directly — this cannot be resolved from the reseller portal and Bassani's team will fix it promptly.

**Q: A product shows 0 forecasted stock but I can see it on the shelf.**  
Check the **Reservations** drill-down — click the icon next to the Forecasted figure in the Products table. This shows every confirmed order that is reserving those units. The forecasted figure is on-hand minus reserved, so 0 forecasted = all on-hand units are committed to open orders. Those units are not available to promise to new orders until the existing orders are fulfilled or cancelled.

---

## Security Notes for All Users

- **Never share your login credentials.** Every person has their own account so the audit trail can identify exactly who did what.
- **Change your password on first login.** The system enforces this — you cannot proceed until it is done.
- **Two-factor authentication (2FA)** is required for every account with an email address. After entering your password, a 6-digit code is emailed to you. Enter it to complete sign-in. Codes expire in 10 minutes and allow 3 attempts — if all attempts are used, you must start the sign-in process again.
- **Do not share your OTP code** with anyone, including colleagues. Each code is single-use and specific to your sign-in session.
- **If you forget your password**, use the **Forgot your password?** link on the sign-in page. Enter your registered email address and a reset link will be sent. The link expires in 15 minutes and can only be used once. Completing a reset automatically signs out all other active sessions for your account.
- **If you receive a password reset email you did not request**, do not click the link. Your password has not changed. Contact the super admin immediately as someone may have obtained your email address.
- **If you receive an OTP email you did not request**, your password may be compromised. Contact the super admin immediately.
- **Password reset links must not be shared.** Each link is tied to your account and single-use. Forwarding it to someone else gives them full access to set your password.
- **Your session lasts 8 hours** from the point of successful 2FA verification. After 8 hours your session expires and you will be asked to sign in (and verify via OTP) again.
- **Logging out** clears your session. Always log out when stepping away from a shared computer.
- **Login is rate-limited**: after 5 failed password attempts within 15 minutes, your IP is temporarily blocked. OTP verification is rate-limited to 10 attempts per 15 minutes. Password reset requests are limited to 3 per hour. If you are legitimately locked out, wait or contact the super admin.

---

## Quick Reference — Who Does What

| Task | Who |
|---|---|
| Read inbound sales emails | Merveille (sales) or admin with `inbox.view` |
| Reply to an email from the portal (sales) | Merveille (sales) or admin with `inbox.view` |
| Create a ticket from an email thread | Merveille (sales) or admin with `inbox.view` |
| Archive a sales email thread | Merveille (sales) or admin with `inbox.view` |
| Read inbound onboarding emails | Admin with `onboarding.inbox` (granted by super admin) |
| Reply to an onboarding email from the portal | Admin with `onboarding.inbox` |
| Send onboarding template PDFs from the onboarding mailbox | Admin with `onboarding.inbox` |
| Preview PDF attachments inline | Admin with `onboarding.inbox` |
| Link an email thread to an existing customer | Admin with `onboarding.inbox` |
| Create a new customer from an inbox thread (with doc mapping) | Admin with `onboarding.inbox` |
| Save an email attachment to a customer profile | Admin with `onboarding.inbox` |
| Archive an onboarding email thread | Admin with `onboarding.inbox` |
| Configure the onboarding mailbox | Super Admin only (Settings > Onboarding Mailbox) |
| Create a direct inquiry ticket | Merveille (sales) |
| Build or edit a quote (staff — internal quote builder) | Merveille (sales) |
| Build or edit a quote (reseller — cart view) | Any reseller |
| Place an order directly (customer self-service) | Any customer with portal access |
| Grant or revoke a customer's portal login | Admin with `customers.manage_portal_access` |
| Send quote to customer | Merveille (sales) or any reseller |
| Register a 50% deposit | Kashi or Ragini (finance) |
| Register balance (final) payment | Kashi or Ragini (finance) |
| Confirm payment received | Kashi or Ragini (finance) |
| Confirm an order | Merveille or anyone with `orders.confirm` |
| Set up a recurring order on a ticket | Merveille (sales) or any reseller, on their own tickets |
| Pause/resume/cancel a recurring order schedule | Admin with `orders.recurring_manage` |
| Move order from queued to packing | Tshidi (orders_clerk) |
| Move order from packing to ready | Tshidi (orders_clerk) |
| Mark order incomplete | Tshidi (orders_clerk) |
| Mark order complete | Tshidi (orders_clerk) — after both approvals |
| QA approve | Cullen Grant (qa_manager) |
| RP approve | Rookshanna Hussain (responsible_pharmacist) |
| Assign packer to order | Warehouse Supervisor |
| Tick items on handheld | Packer |
| Generate a production batch number | Vault Custodian or anyone with `production.batch_generate` |
| Record a vault stock movement | Vault Custodian or anyone with `production.vault` |
| Add, archive, delete or link product shortcodes to their stock system record | Super admin or admin with `production.manage` |
| Receive imported stock (S6 register entry) | Vault Custodian or anyone with `production.vault` |
| Release imported stock from quarantine | Rookshanna (responsible_pharmacist) or anyone with `production.rp_release` |
| Resolve a no-purchase-order flag on a receipt | Super admin or admin with `production.manage` |
| Add, archive or link import suppliers to their stock system account | Super admin or admin with `production.manage` |
| Sync staged vault records to the stock system | Super admin or admin with `production.manage` |
| Purge production test data (batches + movements) | Super Admin only — blocked once records exist in the stock system |
| Generate commission statements | Admin with `commission.generate_statements` |
| Mark commission statement paid | Admin with `commission.mark_paid` |
| Approve customer onboarding application | Admin with `customers.approve_onboarding` |
| Reject customer onboarding application | Admin with `customers.reject_onboarding` |
| Download application documents | Admin with `customers.approve_onboarding` |
| Upload document to customer profile | Admin with `customers.manage` |
| Send a secure document upload link to a customer | Admin with `customers.manage` |
| View document upload request status on customer profile | Admin with `customers.manage` |
| Link existing customer to sales agent | Admin only |
| Unlink customer from sales agent | Admin only |
| Record invoice payment | Admin with `invoices.record_payment` |
| Create/edit admin accounts | Super Admin only |
| Configure email routing | Admin with `settings.manage` |
| View document templates and download any version | Any admin |
| Upload new document template version | Super Admin only |
| Activate / roll back document template version | Super Admin only |
| Set up personal signing name, title, and signature | Any user with `signing_authority.sign` permission |
| Grant or revoke signing authority permission | Super Admin only (via Users permissions panel) |
| Claim / release an onboarding application for countersigning | User with `signing_authority.sign` |
| Countersign a customer-signed onboarding document | User with `signing_authority.sign` and fully configured profile |
| Configure commission tiers | Admin with `commission.configure_tiers` |
| View audit trail | Admin with `audit.view` |
| Override order pipeline stage | Admin with `tickets.manage` |
| Download onboarding template docs | Any authenticated user |
| Email onboarding template docs to customer | Any authenticated user |
| Upload signed documents (onboarding wizard) | Reseller |
| Browse reseller product catalog | Reseller |
| Print GS1 pharmaceutical labels from the Products page | Admin or staff with `labels.print` (Tshidi by default) |
| Add/edit/delete/test a label printer | Super Admin or admin with `settings.manage` |
| Upload GTIN codes to the pool | Admin with `settings.manage` |
| Assign/unassign a GTIN from the pool to a product | Any admin |
| View GTIN pool registry and stats | Any admin |

---

**Last Updated:** 19 July 2026

*This manual covers the system as built through Phase 20 and Phase 12.5, including: Phase 8 Sales Ticket pipeline (deposit registration, balance payment registration, full order-to-payment cycle), real-time ticket updates via WebSocket (live indicator, instant cross-user sync), automatic ticket closure when an Odoo order is cancelled, the 3-step Add Customer wizard with hard duplicate prevention, mandatory onboarding documents for all creation paths, admin document upload, sales agent creation document step with conditional skip, the approve-link flow for duplicate-blocked applications, multi-authority per-user signing via My Profile (Phase 19), the Sales Agent commission_eligible flag with commission exclusion (Phase 20), GS1 pharmaceutical label printing from the Products page (Phase 12.4 — requires Zebra ZT411 printer and valid GTINs from GS1 South Africa), and GTIN Pool management (Phase 12.5 — upload purchased GS1 GTIN codes, assign to products from the Products page, track availability across the pool). For questions about features not covered here, contact your system administrator or refer to the Production Roadmap document for the full technical specification.*
