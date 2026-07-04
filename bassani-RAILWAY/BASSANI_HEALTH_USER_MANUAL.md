# Bassani Health Portal — User Manual

**System:** Bassani Health B2B Sales & Reseller Portal  
**Audience:** Super Admins, Operations Staff, Resellers  
**Last Updated:** 4 July 2026

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
| `MS_TENANT_ID` | Azure Active Directory Tenant ID for M365 mailbox integration | From Azure Portal → App registrations → your app |
| `MS_CLIENT_ID` | Azure app client ID for M365 mailbox integration | From Azure Portal → App registrations → your app |
| `MS_CLIENT_SECRET` | Azure app secret for M365 mailbox integration | Generated in Azure Portal → Certificates & secrets |
| `MS_SHARED_MAILBOX` | The shared mailbox to monitor for inbound sales emails | e.g. `orders@bassanihealth.com` |
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
3. For each physical warehouse/vault, generate a **Display Token** — this is the unique URL your 85" packing board screen will use (no login required on the screen, just the token in the URL)
4. Keep a record of each warehouse's display token URL somewhere safe

> **Each warehouse gets its own packing board screen and its own display token.** If you have two vaults, you need two screens, two tokens, and two URLs.

---

## Step 4 — Create Your Staff Accounts

Go to **Users** in the sidebar. Create accounts for every person who will use the system. Use the role guide below to assign the right role to each person.

### Role Reference Table

| Role | What They Can Do | Named Person |
|---|---|---|
| `admin` | Full portal access with configurable permissions | Various |
| `sales` | Sales Tickets only — direct inquiries and quote building | Merveille |
| `orders_clerk` | Orders Tickets only — packing pipeline management | Tshidi |
| `finance` | Register deposits and confirm payments on tickets | Kashi, Ragini |
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

Commission is calculated as a percentage of the reseller's monthly turnover (excluding cancelled orders). The tier bands define what percentage applies at each revenue level. Example setup:

| Monthly Turnover | Commission Rate |
|---|---|
| R0 – R50,000 | 5% |
| R50,001 – R150,000 | 7% |
| R150,001 + | 10% |

Set these bands to match your actual reseller agreement. Changes to tiers are recorded in the audit trail with the before/after values and who made the change.

---

## Step 6 — Create Your Reseller Accounts

Resellers are external business partners who place orders on behalf of their customers. Each reseller needs:
- A portal login (username + password)
- An Odoo partner link (mandatory — explained below)
- An assigned warehouse (their orders draw from this vault)
- A commission tier assignment (if they participate in the commission programme)

**Why the Odoo partner link is mandatory**

When a commission statement is marked as paid, the system creates a vendor bill (creditor invoice) in Odoo against the reseller's partner record. This is how the payment flows into your accounts — Odoo cannot create the bill without knowing which partner to bill to. A reseller cannot be saved without this link.

The partner does not need to be set up as a supplier in Odoo — a customer-only partner works just as well. Odoo allows any partner to receive a vendor bill regardless of their rank. If the reseller is both a customer and a supplier (e.g. they also purchase direct), both badges will show in the search results.

To add a reseller — the wizard has 4 steps:

**Step 1 — Odoo Partner and Documents**
1. Go to **Resellers** in the sidebar and click **Add Reseller**
2. Type to search Odoo partners by name — results show whether each partner is a Customer, Supplier, or both
3. Select the correct partner. Their business details will pre-fill on the next step
4. If the partner does not yet have onboarding documents on file, a document upload section appears. Upload all 5 required documents. If documents are already on file, a confirmation banner replaces the upload section

**Step 2 — Business Details**
Review and adjust the pre-filled name, email, phone, and seller code. The seller code is the unique lookup key used throughout the system (e.g. `ABC001`).

**Step 3 — Login Credentials**
Set the portal username and password. The reseller will be required to change their password on first login.

**Step 4 — Financials**
Enter company registration number, VAT details, and banking information. These are used for commission statement records.

Click **Create Reseller** on the final step. A welcome email is sent automatically to the reseller's email address.

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

The portal sends automated notifications to different recipients depending on the event. By default, new application notifications go to the `SUPPORT_EMAIL` environment variable and order-ready notifications go to all users with the `warehouse_supervisor` role. You can override and extend these without touching Railway environment variables.

Go to **Admin > Email Routing** in the left sidebar (visible to Super Admin only).

### Application Submitted Notifications

When a reseller submits a new customer onboarding application, the portal notifies the addresses in this list. If the list is empty, the `SUPPORT_EMAIL` env var is used as the fallback.

Add every address that should receive application review notifications — for example, the operations manager and any admin staff who review applications.

### Order Ready for Collection

When an order passes QA and RP review and is cleared for dispatch, all portal users with the `warehouse_supervisor` role are notified automatically. Add extra addresses here for distribution lists or staff who should be notified but do not have portal accounts (e.g. `warehouse@bassanihealth.com`).

### Order CC

These addresses are CC'd on every "Order Received" and "Order Confirmed" email sent to resellers. Useful for an operations inbox or account management team that wants visibility on all reseller orders without receiving individual assignment notifications.

> **How to add an address:** Type the email and press Enter or comma. Click the tag to remove it. Press **Save Changes** when done. Changes take effect immediately for all future notifications.

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
| **Your onboarding documents** | A reseller uses "Send Documents" in the onboarding wizard | The customer email address entered by the reseller |
| **Commission Statement Ready** | An admin generates a monthly commission statement | The reseller |
| **Commission Paid** | An admin marks a commission statement as paid | The reseller |
| **Commission Dispute Resolved** | An admin resolves a commission dispute | The reseller |
| **Ready for Collection** | An order passes both QA and RP approval on the packing board | All `warehouse_supervisor` portal users + any extra addresses in the Order Ready list |

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
- [ ] Sales Inbox connected (Azure credentials set, shared mailbox emails appearing in Inbox view)

---

# Part 2 — Operational Guide

## Understanding the Order Pipeline

Every order in Bassani Health — whether placed by a reseller online or brought in by Merveille from a customer email — flows through the same pipeline:

```
INQUIRY → QUOTE → SALE ORDER → CONFIRMED WIP → PACKING → QA + RP APPROVAL → COMPLETE
```

Each step is handled by a different team member, and the portal enforces that no step is skipped. Here is how real orders move through the system:

**Example: A pharmacy emails Merveille asking to order 500 units of a tincture.**

1. Merveille creates a **Sales Ticket** (Direct Inquiry) and builds a quote in the portal — no Odoo needed
2. The quote is emailed to the pharmacy directly from the ticket
3. The pharmacy confirms — Merveille advances the ticket to Sale Order stage
4. Finance (Kashi or Ragini) registers the 50% deposit — no Odoo needed. The deposit invoice is created and reconciled in Odoo automatically
5. Merveille confirms the order from the ticket — Odoo creates a confirmed sale order and the packing queue is updated automatically
6. The full balance invoice is available in Odoo immediately after confirmation
7. Once the customer pays the balance, Finance registers the balance payment against the full invoice directly from the ticket
8. Tshidi sees the order in her Orders Tickets and marks it as Packing
9. The warehouse packs the order — the packer ticks items on their handheld
10. When packing is done, Tshidi marks it Ready
11. Cullen approves from a QA perspective; Rookshanna approves from an RP perspective
12. Tshidi marks it Complete — Merveille's Sales Ticket automatically updates to show Complete

**Example: A reseller places an order online.**

1. Reseller logs in, browses the catalogue, and places an order — a Sales Ticket is created automatically
2. The ticket is unassigned — Merveille sees it in her queue and claims it
3. She confirms the order from the ticket (no deposit required for resellers on credit terms)
4. The rest of the flow is identical: packing → QA/RP → complete

---

## Sales Team — Merveille

**Role in system:** `sales` (permission: `tickets.sales`)  
**Access:** Sales Tickets only

### What you see

When you log in, you land on **Sales Tickets** (`/tickets/sales`). This shows:
- **Your queue** — tickets assigned to you
- **Unassigned** — tickets waiting to be claimed (reseller orders that came in while you were offline, or new direct inquiries)

A small **Live** indicator appears in the top-right of the ticket list. When it is green, the page is receiving real-time updates — any change made by another staff member (stage advance, payment registration, order cancellation) appears immediately without a manual refresh. If it shows **Reconnecting**, the live connection dropped temporarily and will restore itself automatically within 30 seconds.

### Creating a Direct Inquiry Ticket

When a customer emails or calls in an order that isn't coming through a reseller:

1. Click **New Direct Inquiry**
2. Search for the customer by name — the system searches Odoo live
3. Enter any notes about the enquiry
4. Click **Create**

The ticket starts at `Open` stage. From here you move it forward as the conversation progresses.

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

Once the customer confirms and (if required) finance has registered a deposit:

1. Click **Confirm Order** in the right sidebar
2. If the customer is over their credit limit, you will be prompted to confirm the override
3. On confirmation, the ticket automatically advances to `Confirmed WIP` and the order joins the packing queue

### Cancelling a Quote

If the customer is not interested:

1. Click **Cancel Quote**
2. Confirm the cancellation
3. Set the exit status to `Not Interested` or `Cancelled`
4. The ticket is closed

### What Happens After Confirmation

Once an order is confirmed, it moves to the Orders team (Tshidi). You will see the ticket status change to `Confirmed WIP`, then later `Ready for Collection`, then `Complete` — all automatically, without you doing anything. If there is a problem with packing, the ticket will show `Incomplete` with a reason from Tshidi.

---

## Sales Inbox

**Access:** Sales role (`inbox.view` permission), Admins with `inbox.view`, Super Admin

The Sales Inbox connects the shared sales mailbox directly into the portal. Every email that arrives appears here — no need to open a separate email client. You can read, reply, create tickets, and clear the queue without leaving the portal. The mailbox is configured by a super admin in **Settings > Mailbox**.

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
- All order lifecycle actions (quote, deposit, packing, payment confirmation) happen in the ticket from this point

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

## Finance Team — Kashi & Ragini

**Role in system:** `finance` (permission: `tickets.finance_confirm`)  
**Access:** Sales Tickets (payment confirmation and deposit registration only)

### Registering a Deposit

For direct inquiry customers who require a 50% deposit before their order is confirmed:

1. Open the Sales Ticket (Merveille will tell you which one, or you can search by customer name)
2. Click **Register Deposit** in the right sidebar
3. Enter the deposit amount (pre-filled at 50% of the order total — adjust if needed)
4. Select the payment date
5. Select the payment journal (which bank account the payment came in through)
6. Click **Register Deposit in Odoo**

The system creates a down payment invoice in Odoo and registers the payment against it. The ticket records who registered the deposit and when.

> **This is the only step Finance needs to do before the order is confirmed.** Merveille handles the confirmation itself.

### Registering the Balance Payment

Once an order is confirmed and the full invoice has been created in Odoo, the customer pays the outstanding balance. Register this directly from the portal:

1. Open the Sales Ticket
2. Click **Register Balance Payment** in the right sidebar
3. The outstanding balance is pre-filled from the live Odoo invoice — verify the amount
4. Select the payment journal (which bank account the funds arrived in)
5. Select the payment date
6. Click **Register Payment in Odoo**

The payment is applied to the full sale invoice in Odoo immediately. The ticket records who registered it and when.

> **This is separate from the deposit.** The deposit (if applicable) is registered before order confirmation against a down payment invoice. The balance payment is registered after confirmation against the full invoice.

> If the customer is on credit terms with no deposit requirement, use this action to register the single full payment when it arrives.

### Confirming Payment Received

For tickets where the payment was registered directly in Odoo (outside the portal) rather than through Register Balance Payment:

1. Open the Sales Ticket
2. Click **Confirm Payment Received**
3. The system checks Odoo's live payment data — if Odoo shows no payment recorded yet, this button will block with a message explaining the shortfall
4. If Odoo shows the payment, you confirm it and the ticket advances

> **You cannot confirm payment if Odoo does not show it.** This is a hard rule — the portal reads directly from Odoo, so if the payment isn't there, it hasn't been properly recorded yet.

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

The Sales Ticket is automatically updated to `Complete`.

---

## QA Manager — Cullen Grant

**Role in system:** `qa_manager` (permission: `tickets.qa_approve`)  
**Access:** Orders Tickets (QA approval only)

When you log in, you see Orders Tickets. Your action is visible only when an order is at `Ready` status.

1. Open an order at `Ready` status
2. Review the order details and packing information
3. Click **QA Approve**

Your approval is recorded with your name and timestamp. The order will not complete until both QA and RP have independently approved — your approval does not depend on Rookshanna's, and vice versa.

---

## Responsible Pharmacist — Rookshanna Hussain

**Role in system:** `responsible_pharmacist` (permission: `tickets.rp_approve`)  
**Access:** Orders Tickets (RP approval only)

Identical flow to QA Manager, but from the pharmacist perspective:

1. Open an order at `Ready` status
2. Review the order
3. Click **RP Approve**

Both approvals are required before Tshidi can mark the order Complete.

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

**Adding/editing products:** The portal syncs with Odoo. When you create or edit a product here, it writes directly to Odoo. You do not need to log into Odoo to manage your catalogue.

**Low stock:** The dashboard highlights any product with forecasted stock below 10 units. This is the same figure that drives the orange badge in the order catalogue.

### Customers

Go to **Customers** to see your active account list (pulled from Odoo).

**Adding a New Customer** *(requires `customers.manage` permission)*

Click **Add Customer** to open the 3-step wizard. All three steps must be completed before the customer is created.

**Step 1 — Search (duplicate check)**

Type the customer's business name and wait for the search to run. The search checks Odoo live for any existing customers with a matching name.

- If results appear, review them carefully. If none of them are the same business, refine your search and try variations of the name until no results appear. You cannot proceed while results are shown.
- Once the search returns zero results, the **Continue** button activates and you can move to Step 2.

> This step is a hard gate. The system also checks for duplicate email and VAT at Step 3 submission — if a match is found there, the creation is blocked with a clear message identifying the existing customer. There is no override. Investigate before creating.

**Step 2 — Documents**

Upload all five of the following signed documents before continuing:

- Signed Store Onboarding Agreement
- Signed Customer Information Form
- Signed NDA
- Signed TQA Document
- CIPC Company Registration Certificate

Click the upload slot for each document, select the file, and wait for the green tick. You can remove and re-upload any document. The progress counter shows `{n} of 5 uploaded`. The **Continue to Details** button is disabled until all five slots are filled.

> Documents are staged to Cloudflare R2 as you upload them and will be attached to the customer's profile the moment the customer is created. If you close the browser before completing Step 3, you will need to start a new session and re-upload.

**Step 3 — Details**

Fill in the customer's information:

- Business name (pre-filled from your Step 1 search)
- Customer type (e.g. Pharmacy, Clinic)
- Email address
- Phone number
- VAT registration number — required for compliance
- Credit limit
- Street address, city, postal code
- Section 21 — tick this if the customer holds a SAHPRA Section 21 authorisation

Click **Create Customer**. The customer is created in Odoo immediately and their documents are attached to their profile.

> Banking details are not collected at the customer level. Bassani invoices customers directly and receives payment from them — banking details are a reseller-level concern (Bassani pays resellers commission) and are not needed here.

---

**Viewing a customer profile:**
Click any customer to open their full profile. You will see:
- Their lifetime orders and spend
- This month's orders and revenue
- Outstanding invoices and balance
- Their credit limit and how much of it is used
- The reseller who onboarded them (if applicable)
- Their delivery addresses
- Their onboarding and compliance documents
- Their full account statement (all invoices and credit notes)

**Credit Hold:** If a customer appears with a red "Credit Hold" badge, they are over their Odoo credit limit. Orders for this customer will produce a warning at quote stage and a hard block at confirmation stage (unless you override).

**Customer Documents:**
The **Documents** section on a customer's profile shows all compliance documents associated with that customer:
- **Onboarding documents** — the signed agreements and CIPC certificate submitted by the reseller during the customer's onboarding application. These carry an "Onboarding" badge and cannot be deleted from this view (they are permanently attached to the approved application).
- **Admin-uploaded documents** — any additional documents uploaded directly by an admin. These carry an "Admin Upload" badge and can be deleted from this view.

To upload a document to a customer profile:
1. Open the customer's profile
2. Scroll to the **Documents** section
3. Click **Upload document**
4. Enter a label (e.g. "Updated NDA 2026")
5. Select the file — the upload begins automatically on file selection
6. A green confirmation appears when the upload is complete

All documents are stored in Cloudflare R2 and served via secure, time-limited download links. Click **Download** next to any document to access it.

### Orders

Go to **Orders** to see all orders in Odoo.

The Orders screen is a **monitoring view** — you cannot confirm, cancel, or place orders from here. All order lifecycle actions happen through **Sales Tickets**.

What you can do here:
- See every order's status in Odoo
- See the linked Sales Ticket status and packing board status for each order
- For confirmed orders not yet in the packing queue: click **Queue for Packing** (requires `tickets.manage`)
- For old draft orders without a Sales Ticket: click **Create Sales Ticket** to bring them into the pipeline

### Invoices

*Requires `invoices.view` permission*

Go to **Invoices** to see all customer invoices from Odoo.

**Filter chips:**
- **Outstanding** — invoices with an unpaid or partially paid balance
- **Unpaid** — fully unpaid invoices
- **Partial** — partially paid
- **Paid** — fully settled
- **All** — everything
- **Credit Notes** — credit notes issued in Odoo (marked with a purple CN badge)

**Registering a payment** *(requires `invoices.record_payment`)*:
For an unpaid invoice, click **Register Payment**, select the payment journal, enter the amount and date, and confirm. The payment is recorded in Odoo immediately.

**Requesting a credit note:**
On any posted invoice, click **Request CN** to log a credit note request. Enter the reason. The finance team will process the actual credit note in Odoo. The portal tracks the request (pending → acknowledged) so nothing falls through the cracks.

### Customer Applications

*Requires `customers.view` permission*

Go to **Applications** to review customer onboarding applications submitted by resellers. A badge on the sidebar menu shows the number of applications currently awaiting review — this count refreshes automatically every minute.

**Application list:**
Filter by status using the chips at the top — Pending, Approved, Rejected, or All. Each row shows the business name, the reseller who submitted it, the contact details, submission date, and current status. Click any row or the Review/View button to open the full application.

**Reviewing an application:**
The application detail page is a two-column view:
- **Left column:** Full business details, primary contact, business address, additional information, and all submitted documents
- **Right column (sidebar):** Application metadata and action buttons

**Documents:** The Documents section on the application shows all five documents the reseller uploaded — the four signed templates plus the CIPC certificate. Click **Download** next to any document to access the secure download link.

**Approving an application** *(requires `customers.approve_onboarding`)*:
1. Open the application
2. Review all details and confirm all 5 documents are present and correct
3. Click **Approve & Create Customer** in the right sidebar
4. The system creates the customer in Odoo automatically and links them to the reseller's account
5. The reseller receives an approval email
6. The application status updates to **Approved** on the page — no navigation away required

> If any of the 5 documents are missing, the approval button will be blocked with an error listing which documents are absent.

**If approval is blocked by a duplicate customer:**

When you click **Approve & Create Customer**, the system checks Odoo for a customer with a matching email or VAT before creating anything. If a match is found, the approval is blocked with a message identifying the existing customer.

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

### Resellers

*Requires `resellers.view` permission*

Go to **Resellers** to manage your reseller network.

Each reseller's profile shows:
- Their contact details and assigned warehouse
- Their order history and total revenue
- Their linked customers with the ability to link or unlink accounts
- Their activity feed — every significant action recorded in the audit trail (orders placed, customers linked, applications submitted, etc.)

**Linking an existing customer to a reseller:**
Customers created through the onboarding wizard are automatically linked to the submitting reseller. However, an admin can also manually link any existing Odoo customer to a reseller — for example, if a customer was created directly in Odoo before the portal existed, or if account management responsibility is being transferred.

1. Open the reseller's profile
2. In the **Customers** section, click **Link Customer** (top-right of the section, or the link at the bottom of the list)
3. A search modal opens — type at least 2 characters to search Odoo customers by name or email
4. Click **Link** next to the correct customer
5. The customer is added to the reseller's account immediately and appears in the list

> If the customer is already linked to a different reseller, the link will be blocked with a clear error message showing which reseller currently owns that account.

**Unlinking a customer from a reseller:**
1. Open the reseller's profile
2. In the **Customers** section, click **Unlink** on the customer row
3. A confirmation dialog appears — confirm the action
4. The customer is removed from the reseller's account

> Unlinking does not delete the customer from Odoo — it only removes the ownership association. The customer's orders, invoices, and history remain intact. The reseller will no longer be able to place orders for this customer or see them in their customer list.

Both link and unlink actions are recorded in the audit trail and appear in the reseller's Activity section.

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
3. Select a specific reseller or all resellers
4. Click Generate

Cancelled orders are automatically excluded. The reseller receives an email with their statement summary.

**Marking statements paid** *(requires `commission.mark_paid`)*:
1. Open the statement
2. Click **Mark as Paid**
3. Enter the payment reference and date
4. The system creates a vendor bill in Odoo automatically — commission payments must have an Odoo record
5. The reseller receives a payment confirmation email

> If Odoo bill creation fails, the payment will not be marked as paid. You must resolve the Odoo issue first. If you have already created the bill manually in Odoo, you can tick the override checkbox and provide a reason.

**Disputes:**
A reseller may raise a dispute on any statement they believe is incorrect. Disputed statements appear with a red badge in the Statements list. Review the dispute, then click **Resolve** and enter your response notes. The reseller receives an email with your resolution.

**Tier history:**
The Tier Settings tab shows the full history of every tier rate change — who changed it, when, and what the before/after values were.

### Reports

*Requires `reports.view` permission*

Reports include:
- Revenue by period and by reseller
- Dead stock (products with no sales in the last 90 days and low available stock)
- Top customers by spend

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

## Resellers

**Role in system:** `reseller`  
**Access:** Products (catalog view), Orders, Customers (own), Commission, Invoices (own), Sales Tickets, Onboarding Docs

Resellers are external business partners who sell Bassani Health products to their customers (pharmacies, clinics, dispensaries, etc.).

### Product Catalog

Go to **Products** to browse the Bassani Health product catalog. This is a read-only view showing only the products that Bassani admin has made available to resellers.

Each product shows:
- Product name and SKU
- Category
- Sale price (the price you order at)
- **Available Stock** — the forecasted quantity available for new orders. This is the same figure the order cart uses when you place an order. If this is 0 or negative, those units are committed to existing orders

**Filtering by category:** The category chips at the top of the page show only the categories that have products in the current catalog — no empty categories appear. Click a category chip to filter. If a category has product variants (e.g. different strengths or sizes), a second row of chips appears below letting you narrow further.

> You do not see internal stock figures, cost prices, or any stock movement history. Available Stock is the only quantity shown and it is the one that matters for ordering.

### Placing an Order

1. Go to **Tickets → Sales** and click **New Direct Inquiry** OR use the **Sales Tickets** flow to build a quote for a customer
2. Build your quote — search for products by name or SKU, set quantities
3. Your assigned warehouse is set automatically — your orders always draw from the correct vault
4. Once the quote is confirmed by Bassani admin, the order moves into fulfilment

> As a reseller, you can see your orders in **Orders** at any time. The order shows delivery status, tracking reference (if available), and whether any backorders exist.

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

Before you start an onboarding application, you may need to send the Bassani Health template documents to your prospective customer so they can read, sign, and return them.

Go to **Onboarding Docs** in the sidebar. From here you can:

- **Download** any of the four template documents directly to your device:
  - Store Onboarding Agreement
  - Customer Information Form
  - NDA
  - TQA Document
- **Email all four templates** to your customer by entering their email address and clicking **Send Documents** — the files are delivered as attachments from the Bassani Health email system

This page is available at any time, not just during an active onboarding. Use it whenever a prospect asks for the documents before you have started the application.

---

### Onboarding a New Customer

When you bring on a new pharmacy, clinic, or dispensary:

1. Go to **Customers** → click **Onboard Customer**
2. The wizard opens at **Step 0 — Documents** (this step must be completed before you can proceed)

#### Step 0 — Documents

This step has two sections:

**Section A — Share documents with customer**  
If you haven't already sent the template documents, you can download or email them from here. These are the blank templates your customer needs to complete and sign.

**Section B — Upload signed documents**  
Before the application can be submitted, all five of the following documents must be uploaded:
- Signed Store Onboarding Agreement
- Signed Customer Information Form
- Signed NDA
- Signed TQA Document
- CIPC Company Registration Certificate

For each document, click the upload area, select the file from your device, and wait for the green tick to confirm the upload succeeded. You can remove and re-upload any document before submitting. The progress counter in the top right of this section shows how many of the five have been uploaded (e.g. `3 / 5`).

> **You cannot proceed to Step 1 until all 5 documents are uploaded.** The Continue button remains disabled until every slot is filled.

> **Documents are uploaded to secure cloud storage (Cloudflare R2) as you go** — they are attached to the application the moment you upload them, not when you submit. If you close the browser and return, you will need to start a new application and re-upload.

3. Once all 5 documents are uploaded, click **Continue** to proceed through the remaining steps:
   - Step 1: Business details (company name, VAT, registration number)
   - Step 2: Primary contact
   - Step 3: Business address
   - Step 4: Ordering volume and additional information
4. Review the summary and click **Submit Application**

The Bassani admin team is notified by email. Once they approve the application, the customer is created in Odoo and you receive confirmation. The customer is linked to your account — their orders count toward your commission turnover.

You can track all your applications under **Customers → My Applications**:
- **Pending** — awaiting admin review
- **Approved** — customer is active and linked to you
- **Rejected** — includes the rejection reason so you can address it

### Viewing Customer Profiles

Click any customer under **My Customers** to see their full profile:
- Their orders placed through you
- Their outstanding invoices and account balance
- Their account statement (all invoices and credit notes, filterable by date)

> You only see orders that came through you. If the same customer has orders placed directly with Bassani (not through you), those are not shown on your view.

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

## Common Questions

**Q: An order is stuck — how do I move it forward?**  
Every stage in the pipeline can be overridden by someone with `tickets.manage` permission (typically the super admin or a senior admin). In the Orders Ticket detail, the **Override Stage** dropdown is available to that role and allows setting any status directly. This is the escape hatch for edge cases — use it carefully, as it is audit-logged.

**Q: A reseller's commission statement shows the wrong amount.**  
Resellers can raise a dispute (see Commission section above). Admins should also check the Audit Trail for the generate statement event to see exactly which orders were included in the calculation. Cancelled orders are automatically excluded.

**Q: I need to reset a staff member's password.**  
Go to **Users**, find the account, and click **Reset Password**. A new temporary password is generated and shown once — copy it before closing. The staff member is forced to change it on their next login. Optionally enter your own password instead of using the auto-generated one.

**Q: A ticket shows "Order Cancelled" or closed itself automatically — nobody cancelled it.**  
If an order is cancelled directly in the ERP (Odoo), the portal detects this the next time anyone opens that ticket and closes it automatically. Odoo is the financial source of truth — if the order is gone there, the ticket reflects that immediately. An amber notice on the closed ticket explains that it was auto-closed due to an ERP cancellation. Check the ticket's timeline for the "Auto-closed: Odoo order was cancelled" entry, and investigate the cancellation in Odoo if it was unexpected.

**Q: A new order came in from Odoo that isn't in the portal.**  
All orders placed through the portal auto-create a Sales Ticket. Orders placed directly in Odoo will appear in the **Orders** screen but will not have a linked ticket. Use the **Create Sales Ticket** button on that order row to bring it into the pipeline. Once the ticket exists, Merveille can claim it and the normal flow applies.

**Q: The packing board display screen is blank or shows a disconnected message.**  
The display token URL may be incorrect or the token may have been regenerated. Go to **Warehouses**, copy the current display token for that warehouse, and update the URL in the browser. Tokens do not expire automatically — they only change when you generate a new one.

**Q: Odoo is down — can we still use the portal?**  
The portal will enter a degraded state. The health endpoint (`/health`) will report `degraded`. MongoDB-only features (commission statements, audit trail, tickets, reseller profiles) will still work. Anything that reads from or writes to Odoo (products, orders, invoices, customer data) will fail with an appropriate error message. The portal will recover automatically once Odoo comes back online.

**Q: A product shows 0 forecasted stock but I can see it on the shelf.**  
Check the **Reservations** drill-down — click the icon next to the Forecasted figure in the Products table. This shows every confirmed order that is reserving those units. The forecasted figure is on-hand minus reserved, so 0 forecasted = all on-hand units are committed to open orders. Those units are not available to promise to new orders until the existing orders are fulfilled or cancelled.

---

## Security Notes for All Users

- **Never share your login credentials.** Every person has their own account so the audit trail can identify exactly who did what.
- **Change your password on first login.** The system enforces this — you cannot proceed until it is done.
- **Two-factor authentication (2FA)** is required for every account with an email address. After entering your password, a 6-digit code is emailed to you. Enter it to complete sign-in. Codes expire in 10 minutes and allow 3 attempts — if all attempts are used, you must start the sign-in process again.
- **Do not share your OTP code** with anyone, including colleagues. Each code is single-use and specific to your sign-in session.
- **If you receive an OTP email you did not request**, your password may be compromised. Contact the super admin immediately.
- **If you think someone else knows your password**, contact the super admin immediately to have it reset.
- **Your session lasts 8 hours** from the point of successful 2FA verification. After 8 hours your session expires and you will be asked to sign in (and verify via OTP) again.
- **Logging out** clears your session. Always log out when stepping away from a shared computer.
- **Login is rate-limited**: after 5 failed password attempts within 15 minutes, your IP is temporarily blocked. OTP verification is rate-limited to 10 attempts per 15 minutes. If you are legitimately locked out, wait 15 minutes or contact the super admin.

---

## Quick Reference — Who Does What

| Task | Who |
|---|---|
| Read inbound sales emails | Merveille (sales) or admin with `inbox.view` |
| Reply to an email from the portal | Merveille (sales) or admin with `inbox.view` |
| Create a ticket from an email thread | Merveille (sales) or admin with `inbox.view` |
| Archive an email thread | Merveille (sales) or admin with `inbox.view` |
| Create a direct inquiry ticket | Merveille (sales) |
| Build or edit a quote | Merveille (sales) |
| Send quote to customer | Merveille (sales) |
| Register a 50% deposit | Kashi or Ragini (finance) |
| Register balance (final) payment | Kashi or Ragini (finance) |
| Confirm payment received | Kashi or Ragini (finance) |
| Confirm an order | Merveille or anyone with `orders.confirm` |
| Move order from queued to packing | Tshidi (orders_clerk) |
| Move order from packing to ready | Tshidi (orders_clerk) |
| Mark order incomplete | Tshidi (orders_clerk) |
| Mark order complete | Tshidi (orders_clerk) — after both approvals |
| QA approve | Cullen Grant (qa_manager) |
| RP approve | Rookshanna Hussain (responsible_pharmacist) |
| Assign packer to order | Warehouse Supervisor |
| Tick items on handheld | Packer |
| Generate commission statements | Admin with `commission.generate_statements` |
| Mark commission statement paid | Admin with `commission.mark_paid` |
| Approve customer onboarding application | Admin with `customers.approve_onboarding` |
| Reject customer onboarding application | Admin with `customers.reject_onboarding` |
| Download application documents | Admin with `customers.approve_onboarding` |
| Upload document to customer profile | Admin with `customers.manage` |
| Link existing customer to reseller | Admin only |
| Unlink customer from reseller | Admin only |
| Record invoice payment | Admin with `invoices.record_payment` |
| Create/edit admin accounts | Super Admin only |
| Configure email routing | Super Admin only |
| Configure commission tiers | Admin with `commission.configure_tiers` |
| View audit trail | Admin with `audit.view` |
| Override order pipeline stage | Admin with `tickets.manage` |
| Download onboarding template docs | Any authenticated user |
| Email onboarding template docs to customer | Any authenticated user |
| Upload signed documents (onboarding wizard) | Reseller |
| Browse reseller product catalog | Reseller |

---

**Last Updated:** 4 July 2026

*This manual covers the system as built through Phase 12 including: Phase 8 Sales Ticket pipeline (deposit registration, balance payment registration, full order-to-payment cycle), real-time ticket updates via WebSocket (live indicator, instant cross-user sync), automatic ticket closure when an Odoo order is cancelled, the 3-step Add Customer wizard with hard duplicate prevention, mandatory onboarding documents for all creation paths, admin document upload, reseller creation document step with conditional skip, and the approve-link flow for duplicate-blocked applications. For questions about features not covered here, contact your system administrator or refer to the Production Roadmap document for the full technical specification.*
