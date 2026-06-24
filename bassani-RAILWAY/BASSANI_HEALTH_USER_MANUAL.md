# Bassani Health Portal — User Manual

**System:** Bassani Health B2B Sales & Reseller Portal  
**Audience:** Super Admins, Operations Staff, Resellers  
**Last Updated:** June 2026

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
| `JWT_SECRET` | Signs all login tokens — must be secret | Run `openssl rand -base64 48` in any terminal |
| `ODOO_URL` | URL of your Odoo instance | e.g. `https://bassanihealth.odoo.com` |
| `ODOO_DB` | Your Odoo database name | Found in Odoo's Settings → Database |
| `ODOO_USERNAME` | Odoo API user email | A dedicated Odoo API user — not your personal login |
| `ODOO_PASSWORD` | Odoo API user password | Set in Odoo → Settings → Users |
| `MONGODB_URL` | Your Railway MongoDB connection string | Provided automatically by Railway MongoDB plugin |
| `RESEND_API_KEY` | Sends all system emails | From your Resend.com account dashboard |
| `SENTRY_DSN` | Error monitoring | From your Sentry.io project settings (optional but recommended) |

> **Security note:** The system will refuse to start if `JWT_SECRET` is still set to its default placeholder. This is intentional — a weak JWT secret is a serious security risk.

> **After your first deploy**, the legacy `admin/admin123` account is automatically deactivated. This happens on every startup — you do not need to do this manually.

---

## Step 2 — Log In as Super Admin and Change Your Password

1. Navigate to your portal URL (e.g. `https://yourportal.railway.app`)
2. Log in with the username and password you set in Step 1
3. If this is a first-time login with a temporary password, the system will immediately redirect you to a password change screen — this is mandatory before you can access anything

> **The super admin account cannot be deactivated or edited by anyone else.** Only you can change its password. Keep these credentials in a secure password manager.

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
- Their Odoo partner ID (so the system can link their orders to the right Odoo record)
- An assigned warehouse (their orders draw from this vault)
- A commission tier assignment (if they participate in the commission programme)

To add a reseller:
1. Go to **Resellers** in the sidebar
2. Click **Add Reseller**
3. Fill in their business name, contact email, and Odoo partner ID
4. Select their assigned warehouse
5. This automatically creates a portal login for them — share the credentials securely

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

- [ ] All environment variables set in Railway
- [ ] Super admin password changed from temporary
- [ ] Warehouses configured and display tokens generated
- [ ] Packing board screens connected and tested
- [ ] All 6 named staff accounts created (Merveille, Tshidi, Kashi, Ragini, Cullen Grant, Rookshanna)
- [ ] Commission tiers configured to match reseller agreements
- [ ] All reseller accounts created with correct Odoo partner IDs and assigned warehouses
- [ ] Resend domain verified and test email received
- [ ] Sentry DSN added to Railway
- [ ] MongoDB daily backups enabled
- [ ] At least one full order flow tested from quote to completion

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
4. Finance (Kashi or Ragini) registers the 50% deposit — no Odoo needed
5. Merveille confirms the order from the ticket — Odoo creates a confirmed sale order and the packing queue is updated automatically
6. Tshidi sees the order in her Orders Tickets and marks it as Packing
7. The warehouse packs the order — the packer ticks items on their handheld
8. When packing is done, Tshidi marks it Ready
9. Cullen approves from a QA perspective; Rookshanna approves from an RP perspective
10. Tshidi marks it Complete — Merveille's Sales Ticket automatically updates to show Complete

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

### Confirming Payment Received

For tickets that need payment confirmation at the `Invoice` stage (typically for invoice-on-delivery customers):

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

**Viewing a customer profile:**
Click any customer to open their full profile. You will see:
- Their lifetime orders and spend
- This month's orders and revenue
- Outstanding invoices and balance
- Their credit limit and how much of it is used
- The reseller who onboarded them (if applicable)
- Their full account statement (all invoices and credit notes)

**Credit Hold:** If a customer appears with a red "Credit Hold" badge, they are over their Odoo credit limit. Orders for this customer will produce a warning at quote stage and a hard block at confirmation stage (unless you override).

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

### Resellers

*Requires `resellers.view` permission*

Go to **Resellers** to manage your reseller network.

Each reseller's profile shows:
- Their contact details and assigned warehouse
- Their order history and total revenue
- Their activity feed (every action they have taken in the portal — orders placed, customers onboarded, etc.)

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
**Access:** Products, Orders, Customers (own), Commission, Invoices (own), Sales Tickets

Resellers are external business partners who sell Bassani Health products to their customers (pharmacies, clinics, dispensaries, etc.).

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

### Onboarding a New Customer

When you bring on a new pharmacy, clinic, or dispensary:

1. Go to **Customers** → click **Onboard Customer**
2. Complete the four-step application:
   - Step 1: Business details (company name, VAT, registration number)
   - Step 2: Primary contact
   - Step 3: Business address
   - Step 4: Ordering volume and additional information
3. Submit the application

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
- **If you think someone else knows your password**, contact the super admin immediately to have it reset.
- **Logging out** clears your session. Always log out when stepping away from a shared computer.
- **Login is rate-limited**: after 5 failed attempts within 15 minutes, your IP is temporarily blocked. If you are legitimately locked out, wait 15 minutes or contact the super admin.

---

## Quick Reference — Who Does What

| Task | Who |
|---|---|
| Create a direct inquiry ticket | Merveille (sales) |
| Build or edit a quote | Merveille (sales) |
| Send quote to customer | Merveille (sales) |
| Register a 50% deposit | Kashi or Ragini (finance) |
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
| Approve customer onboarding | Admin with `customers.approve_onboarding` |
| Record invoice payment | Admin with `invoices.record_payment` |
| Create/edit admin accounts | Super Admin only |
| Configure commission tiers | Admin with `commission.configure_tiers` |
| View audit trail | Admin with `audit.view` |
| Override order pipeline stage | Admin with `tickets.manage` |

---

*This manual covers the system as built through Phase 8. For questions about features not covered here, contact your system administrator or refer to the Production Roadmap document for the full technical specification.*
