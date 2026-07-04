"""
Sales Ticket — Phase 8.2.

Tracks the customer-facing lifecycle (PO/RFQ → Quote → Sale Order → Invoice →
Payment → Work In Progress → Ready/Incomplete → Complete/Cancelled) that Odoo's
own sale.order.state doesn't model on its own (no "Not Interested," "50%
Payment Received," or "Ready for Collection" concept exists in Odoo).

The Orders side of this handoff is NOT a separate collection — it's the
existing `packing_board` document, extended in Phase 8.3. See
`packing_board_routes.py` and the `orders_ticket_ref` field below.
"""
import base64
import logging
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from fastapi.responses import Response
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
from auth import require_permission, require_any_permission, get_current_user
from odoo_client import get_odoo_client, odoo as odoo_call, fetch_odoo_report_pdf
from warehouse_context import company_context
from database import col
from middleware.audit import audit_log
from services.notification_service import notify_ticket_assigned
from services.email_service import send_ticket_assigned

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])

# Forward stages — a ticket normally moves left to right through these.
STATUSES = ["open", "quote", "sale_order", "invoice", "confirmed_wip", "ready_for_collection", "incomplete"]

# Side-exits — reachable from most stages, not a fixed final step (mirrors how
# Odoo's own sale.order can cancel from draft, sent, *or* sale).
EXIT_STATUSES = ["not_interested", "cancelled", "complete"]


# ── Pydantic models ───────────────────────────────────────────────────────────

class TicketCreate(BaseModel):
    customer_id: int
    assigned_to: Optional[str] = None   # defaults to the creating sales rep
    note: Optional[str] = None          # free text — e.g. what the PO/RFQ asked for


class TicketStageUpdate(BaseModel):
    status: Optional[str] = None
    exit_status: Optional[str] = None
    order_id: Optional[int] = None
    invoice_id: Optional[int] = None
    incomplete_reason: Optional[str] = None
    note: Optional[str] = None
    assigned_to: Optional[str] = None   # empty string = unassign; user id = assign


class TicketOrderLine(BaseModel):
    product_id: int
    product_uom_qty: float
    price_unit: float
    name: Optional[str] = ""


class TicketOrderCreate(BaseModel):
    order_line: List[TicketOrderLine]
    warehouse_id: Optional[int] = None
    partner_shipping_id: Optional[int] = None   # explicit delivery address; auto-resolved if omitted
    note: Optional[str] = ""


class TicketOrderUpdate(BaseModel):
    order_line: List[TicketOrderLine]
    customer_id: Optional[int] = None           # if provided, updates partner_id on the Odoo order
    partner_shipping_id: Optional[int] = None   # if provided, updates delivery address on the Odoo order
    note: Optional[str] = ""


class TicketDepositRegister(BaseModel):
    amount: float
    date: str           # YYYY-MM-DD
    journal_id: int
    note: Optional[str] = ""


class TicketBalancePayment(BaseModel):
    amount: float
    date: str           # YYYY-MM-DD
    journal_id: int
    note: Optional[str] = ""


class TicketFromOrder(BaseModel):
    order_id: int


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(t: dict) -> dict:
    t["id"] = str(t.pop("_id"))
    return t


def _actor(current_user: dict) -> str:
    return current_user.get("name") or current_user.get("username") or "unknown"


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/")
async def create_ticket(
    body: TicketCreate,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """Create a Sales ticket for an existing Odoo customer. The customer must
    already exist in Odoo — create them via the Customers page first if not."""
    odoo = get_odoo_client()
    try:
        customers = odoo.read("res.partner", [body.customer_id], fields=["name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not customers:
        raise HTTPException(status_code=404, detail="Customer not found")

    now = datetime.now(timezone.utc)
    _assignee_id = body.assigned_to or current_user["id"]
    _assignee_name = current_user.get("name") or current_user.get("username") or "unknown"
    _assignee_role = current_user.get("role", "")
    if body.assigned_to and body.assigned_to != current_user["id"]:
        _au = await col("users").find_one({"id": body.assigned_to}, {"name": 1, "username": 1, "role": 1})
        _assignee_name = (_au.get("name") or _au.get("username")) if _au else body.assigned_to
        _assignee_role = _au.get("role", "") if _au else ""
    doc = {
        "type": "sales",
        "source": "direct",
        "customer_id": body.customer_id,
        "customer_name": customers[0]["name"],
        "order_id": None,
        "invoice_id": None,
        "orders_ticket_ref": None,
        "status": "open",
        "exit_status": None,
        "assigned_to": _assignee_id,
        "assigned_to_name": _assignee_name,
        "assigned_to_role": _assignee_role,
        "payment_confirmed_by": None,
        "payment_confirmed_at": None,
        "incomplete_reason": None,
        "stage_history": [{
            "status": "open", "exit_status": None,
            "actor_id": current_user["id"], "actor_name": _actor(current_user),
            "at": now, "note": body.note,
        }],
        "created_at": now,
        "updated_at": now,
    }
    result = await col("tickets").insert_one(doc)
    await audit_log("ticket.create", "ticket", str(result.inserted_id), entity_label=customers[0]["name"],
                    user=current_user, after={"status": "open", "customer_id": body.customer_id})
    await notify_ticket_assigned("sales", customers[0]["name"], doc["assigned_to"])
    return {"success": True, "ticket_id": str(result.inserted_id)}


@router.get("/")
async def list_tickets(
    status: Optional[str] = None,
    exit_status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    current_user: dict = Depends(require_any_permission("tickets.sales", "tickets.finance_confirm")),
):
    """
    List Sales tickets. A plain `sales`-role account only sees their own queue
    by default (no `assigned_to` override) — admins/super_admins and finance
    (who need to find tickets awaiting payment confirmation across all reps)
    see everything unless they filter explicitly.
    """
    query: dict = {"type": "sales"}
    if status:
        query["status"] = status
    if exit_status:
        query["exit_status"] = exit_status
    if assigned_to:
        query["assigned_to"] = assigned_to
    elif current_user.get("role") == "sales":
        # Sales users see their own queue plus unassigned tickets (portal orders
        # placed by resellers/admins that haven't been claimed yet).
        query["$or"] = [{"assigned_to": current_user["id"]}, {"assigned_to": None}]

    tickets = await col("tickets").find(query).sort("updated_at", -1).to_list(length=500)
    return {"tickets": [_serialize(t) for t in tickets], "total": len(tickets)}


@router.get("/payment-journals")
async def list_payment_journals(
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """Return Odoo bank/cash journals for the deposit registration modal.
    Builds the same descriptive display_label as the invoices journals endpoint
    so the finance team sees bank account numbers and company names, not generic
    'Bank' labels that are indistinguishable in a multi-company setup."""
    odoo = get_odoo_client()
    try:
        journals = odoo.search_read(
            "account.journal",
            domain=[["type", "in", ["bank", "cash"]], ["active", "=", True]],
            fields=["id", "name", "type", "code", "bank_account_id", "company_id"],
            limit=50,
            order="company_id asc, type asc, name asc",
        )
        company_ids = {j["company_id"][0] for j in journals if j.get("company_id")}
        multi_company = len(company_ids) > 1
        for j in journals:
            bank_account = j.get("bank_account_id")
            acc_display  = bank_account[1] if bank_account and bank_account is not False else None
            base         = acc_display or j.get("code") or j["name"]
            company_name = j["company_id"][1] if j.get("company_id") else None
            j["display_label"] = f"{base} — {company_name}" if (multi_company and company_name) else base
        return {"journals": journals}
    except Exception as e:
        print(f"⚠️  payment-journals: {e}")
        return {"journals": []}


@router.get("/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.sales", "tickets.finance_confirm")),
):
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    return _serialize(ticket)


@router.put("/{ticket_id}/stage")
async def update_ticket_stage(
    ticket_id: str,
    body: TicketStageUpdate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """
    Move a ticket forward (`status`) and/or close it out (`exit_status`).
    Both are optional but at least one is required — a ticket can pick up an
    `order_id`/`invoice_id` at the same time it advances stage, since linking
    naturally happens the moment that Odoo record is created (e.g. moving to
    "quote" is the moment the draft sale.order exists).
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")

    if body.status and body.status not in STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid status '{body.status}'")
    if body.exit_status and body.exit_status not in EXIT_STATUSES:
        raise HTTPException(status_code=400, detail=f"Invalid exit_status '{body.exit_status}'")
    if (not body.status and not body.exit_status and body.order_id is None
            and body.invoice_id is None and body.assigned_to is None):
        raise HTTPException(status_code=400, detail="Nothing to update — provide status, exit_status, order_id, invoice_id, or assigned_to")
    if body.status == "incomplete" and not body.incomplete_reason:
        raise HTTPException(status_code=400, detail="incomplete_reason is required when marking a ticket incomplete")

    now = datetime.now(timezone.utc)
    updates: dict = {"updated_at": now}
    if body.status:
        updates["status"] = body.status
    if body.exit_status:
        updates["exit_status"] = body.exit_status
    if body.order_id is not None:
        updates["order_id"] = body.order_id
    if body.invoice_id is not None:
        updates["invoice_id"] = body.invoice_id
    if body.incomplete_reason:
        updates["incomplete_reason"] = body.incomplete_reason
    _au = None
    if body.assigned_to is not None:
        updates["assigned_to"] = body.assigned_to or None
        if body.assigned_to:
            _au = await col("users").find_one({"id": body.assigned_to}, {"name": 1, "username": 1, "role": 1, "email": 1})
            updates["assigned_to_name"] = (_au.get("name") or _au.get("username")) if _au else None
            updates["assigned_to_role"] = _au.get("role", "") if _au else ""
        else:
            updates["assigned_to_name"] = None
            updates["assigned_to_role"] = None

    mongo_ops: dict = {"$set": updates}
    # Only append to stage timeline for actual stage changes, not silent assignment
    if body.status or body.exit_status or body.note:
        mongo_ops["$push"] = {"stage_history": {
            "status": body.status or ticket["status"],
            "exit_status": body.exit_status,
            "actor_id": current_user["id"], "actor_name": _actor(current_user),
            "at": now, "note": body.note,
        }}

    await col("tickets").update_one({"_id": oid}, mongo_ops)
    await audit_log(
        "ticket.stage", "ticket", ticket_id, entity_label=ticket.get("customer_name", ""),
        user=current_user,
        before={"status": ticket["status"], "exit_status": ticket.get("exit_status")},
        after={"status": body.status, "exit_status": body.exit_status},
    )
    if _au and _au.get("email"):
        background_tasks.add_task(
            send_ticket_assigned,
            ticket_ref=f"TKT-{ticket_id[-8:].upper()}",
            customer_name=ticket.get("customer_name", ""),
            stage=body.status or ticket["status"],
            assignee_name=updates.get("assigned_to_name") or "",
            assignee_email=_au["email"],
        )
    return {"success": True}


@router.put("/{ticket_id}/confirm-payment")
async def confirm_payment(
    ticket_id: str,
    current_user: dict = Depends(require_permission("tickets.finance_confirm")),
):
    """
    Confirms the "50% Payment Received" checkpoint. Reads the linked invoice's
    real Odoo payment_state rather than trusting a bare click — so this can
    never drift from what Odoo (the financial source of truth) actually shows.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.get("invoice_id"):
        raise HTTPException(status_code=400, detail="This ticket has no linked invoice yet")

    odoo = get_odoo_client()
    try:
        invoices = odoo.read("account.move", [ticket["invoice_id"]], fields=["payment_state", "amount_residual"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not invoices:
        raise HTTPException(status_code=404, detail="Linked invoice not found in Odoo")
    invoice = invoices[0]
    if invoice["payment_state"] not in ("partial", "in_payment", "paid"):
        raise HTTPException(
            status_code=400,
            detail=f"Odoo shows no payment recorded on this invoice yet (payment_state={invoice['payment_state']}) "
                   "— register the payment in Odoo first.",
        )

    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {"payment_confirmed_by": current_user["id"], "payment_confirmed_at": now, "updated_at": now},
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now, "note": f"Payment confirmed (Odoo payment_state={invoice['payment_state']})",
            }},
        },
    )
    await audit_log(
        "ticket.confirm_payment", "ticket", ticket_id, entity_label=ticket.get("customer_name", ""),
        user=current_user, detail={"payment_state": invoice["payment_state"], "amount_residual": invoice["amount_residual"]},
    )
    return {"success": True, "payment_state": invoice["payment_state"]}


@router.post("/{ticket_id}/create-order")
async def create_order_from_ticket(
    ticket_id: str,
    body: TicketOrderCreate,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """
    Build a draft Odoo sale.order from a direct inquiry ticket.
    Customer is locked to the ticket's customer_id — no override possible.
    On success, ticket advances to 'quote' and order_id is linked.
    Does NOT create a second ticket (the existing one is the tracker).
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    if ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="This ticket already has a linked order — cancel it first to rebuild")
    if not body.order_line:
        raise HTTPException(status_code=400, detail="At least one product line is required")

    odoo = get_odoo_client()

    # Resolve the warehouse's company so the order is created in the correct
    # Odoo entity. Without this, Odoo uses the service account's default company
    # which may differ from the warehouse's company — causing a cross-company error.
    company_id = None
    if body.warehouse_id:
        try:
            wh = odoo.read("stock.warehouse", [body.warehouse_id], fields=["company_id"])
            if wh and wh[0].get("company_id"):
                company_id = wh[0]["company_id"][0]
        except Exception:
            pass

    create_context = {"company_id": company_id, "allowed_company_ids": [company_id]} if company_id else None

    lines = [
        (0, 0, {
            "product_id": l.product_id,
            "product_uom_qty": l.product_uom_qty,
            "price_unit": round(l.price_unit, 2),
            **({"name": l.name} if l.name else {}),
        })
        for l in body.order_line
    ]
    # Resolve the customer's delivery address. Odoo normally defaults
    # partner_shipping_id from partner_id via onchange, but that doesn't fire
    # over XML-RPC — if left unset the field stays False, which blocks
    # action_confirm when stock picking creation requires a shipping address.
    customer_id = ticket["customer_id"]
    if body.partner_shipping_id:
        partner_shipping_id = body.partner_shipping_id
    else:
        partner_shipping_id = customer_id  # fallback: bill-to = ship-to
        try:
            shipping_rows = odoo.read("res.partner", [customer_id], fields=["child_ids", "type"])
            if shipping_rows:
                child_ids = shipping_rows[0].get("child_ids") or []
                if child_ids:
                    children = odoo.read("res.partner", child_ids, fields=["type"])
                    delivery = next((c["id"] for c in children if c.get("type") == "delivery"), None)
                    if delivery:
                        partner_shipping_id = delivery
        except Exception:
            pass  # non-fatal — fallback to customer as shipping address

    vals: dict = {
        "partner_id": customer_id,
        "partner_shipping_id": partner_shipping_id,
        "order_line": lines,
        "note": body.note or "",
    }
    if body.warehouse_id:
        vals["warehouse_id"] = body.warehouse_id

    try:
        odoo_order_id = odoo.create("sale.order", vals, context=create_context)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {"order_id": odoo_order_id, "status": "quote", "updated_at": now},
            "$push": {"stage_history": {
                "status": "quote", "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now, "note": f"Quote built — Odoo order #{odoo_order_id} created (draft)",
            }},
        },
    )
    await audit_log(
        "ticket.create_order", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        after={"order_id": odoo_order_id, "status": "quote"},
    )
    return {"success": True, "odoo_order_id": odoo_order_id}


@router.post("/{ticket_id}/cancel-order")
async def cancel_order_from_ticket(
    ticket_id: str,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """
    Cancel the linked Odoo draft order and close the ticket as 'cancelled'.
    Only works on draft/sent quotations — confirmed orders must be cancelled
    in Odoo directly (they have posted invoices and packing board entries).
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order on this ticket")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()
    try:
        rows = odoo.read("sale.order", [order_id], fields=["state", "name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    order = rows[0]
    if order["state"] not in ("draft", "sent"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Order {order['name']} is already confirmed — cancel it directly in Odoo "
                "(it has a posted invoice and may have a packing board entry)."
            ),
        )

    try:
        odoo.execute("sale.order", "action_cancel", [order_id])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo cancel failed: {str(e)}")

    # Void any commission record so it never appears in payout queue
    await col("order_commissions").update_one(
        {"odoo_order_id": str(order_id), "payout_status": "pending"},
        {"$set": {
            "payout_status": "cancelled",
            "cancelled_at": datetime.now(timezone.utc),
            "cancelled_by": current_user.get("username", ""),
        }},
    )

    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {"exit_status": "cancelled", "updated_at": now},
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": "cancelled",
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now, "note": f"Quote cancelled — Odoo order {order['name']} cancelled",
            }},
        },
    )
    await audit_log(
        "ticket.cancel_order", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"order_id": order_id, "order_name": order["name"]},
    )
    return {"success": True}


@router.put("/{ticket_id}/update-order")
async def update_order_from_ticket(
    ticket_id: str,
    body: TicketOrderUpdate,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """
    Replace line items on an existing draft/sent Odoo sale.order.
    The order must still be in quotation state — confirmed orders are locked
    in Odoo and cannot be edited here. Replaces all lines atomically:
    unlink existing, create new. Logs to ticket timeline and audit trail.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order on this ticket")
    if not body.order_line:
        raise HTTPException(status_code=400, detail="At least one product line is required")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()

    try:
        rows = odoo.read("sale.order", [order_id], fields=["state", "name", "order_line", "company_id", "partner_id"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    order = rows[0]
    if order["state"] not in ("draft", "sent"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Order {order['name']} is already confirmed — lines are locked. "
                "Cancel the order in Odoo first if a revision is needed."
            ),
        )

    _co = order.get("company_id")
    company_id = _co[0] if _co else None
    ctx = company_context(company_id) or None

    # Optionally update the customer if one was provided and differs from current
    ticket_field_updates: dict = {}
    customer_note = ""
    if body.customer_id:
        current_partner_id = order["partner_id"][0] if order.get("partner_id") else None
        if body.customer_id != current_partner_id:
            try:
                partners = odoo.read("res.partner", [body.customer_id], fields=["name"])
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Odoo error fetching customer: {str(e)}")
            if not partners:
                raise HTTPException(status_code=404, detail="Customer not found in Odoo")
            new_customer_name = partners[0]["name"]
            try:
                odoo.write("sale.order", [order_id], {"partner_id": body.customer_id})
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Odoo error updating customer: {str(e)}")
            ticket_field_updates["customer_id"] = body.customer_id
            ticket_field_updates["customer_name"] = new_customer_name
            customer_note = f" | Customer changed to {new_customer_name}"

    if body.partner_shipping_id:
        try:
            odoo.write("sale.order", [order_id], {"partner_shipping_id": body.partner_shipping_id})
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error updating delivery address: {str(e)}")

    # Replace lines atomically: unlink all existing, then create the new set
    existing_line_ids = order.get("order_line") or []
    if existing_line_ids:
        try:
            odoo.unlink("sale.order.line", existing_line_ids)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error unlinking lines: {str(e)}")

    try:
        for l in body.order_line:
            line_vals = {
                "order_id": order_id,
                "product_id": l.product_id,
                "product_uom_qty": l.product_uom_qty,
                "price_unit": round(l.price_unit, 2),
            }
            if l.name:
                line_vals["name"] = l.name
            odoo.create("sale.order.line", line_vals, context=ctx)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error writing lines: {str(e)}")

    # If the customer already received a sent copy, reset to draft — their copy is stale.
    # The portal will show an amber warning prompting the rep to resend.
    if order["state"] == "sent":
        try:
            odoo.write("sale.order", [order_id], {"state": "draft"})
        except Exception:
            pass  # Non-fatal — state reset is best-effort; rep can resend regardless

    now = datetime.now(timezone.utc)
    n = len(body.order_line)
    timeline_note = f"Quote revised — {n} line{'s' if n != 1 else ''} (Odoo {order['name']}){customer_note}"
    if body.note:
        timeline_note += f". {body.note}"

    mongo_set = {"updated_at": now, **ticket_field_updates}
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": mongo_set,
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now, "note": timeline_note,
            }},
        },
    )
    await audit_log(
        "ticket.update_order", "ticket", ticket_id,
        entity_label=ticket_field_updates.get("customer_name", ticket.get("customer_name", "")),
        user=current_user,
        after={"order_id": order_id, "line_count": n, **ticket_field_updates},
    )
    return {"success": True, "odoo_order_id": order_id}


@router.post("/{ticket_id}/send-quote")
async def send_quote(
    ticket_id: str,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """Email the PDF quotation to the customer via Odoo's built-in quotation
    template. Marks the Odoo order as 'sent' and stamps quote_sent_at on the
    ticket. Idempotent — safe to call again after edits (resend)."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order — build a quote first")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()
    try:
        rows = odoo.read("sale.order", [order_id], fields=["state", "name", "partner_id"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    order = rows[0]
    if order["state"] not in ("draft", "sent"):
        raise HTTPException(
            status_code=400,
            detail=f"Order {order['name']} is already confirmed — cannot resend a confirmed order as a quote",
        )

    # Attempt to send via Odoo's built-in sale quotation email template.
    # If the template is missing or Odoo's mail server isn't configured we still
    # mark the state as 'sent' and warn — better than a hard failure that blocks
    # the rep from progressing the ticket.
    email_sent = False
    warning = None
    try:
        templates = odoo.search_read(
            "mail.template",
            domain=[["model", "=", "sale.order"], ["name", "ilike", "quotation"]],
            fields=["id", "name"],
            limit=5,
        )
        if templates:
            template_id = templates[0]["id"]
            odoo_call("mail.template", "send_mail", [template_id, order_id], {"force_send": True})
            email_sent = True
        else:
            warning = "Quotation email template not found in Odoo — order marked sent but no email was delivered"
    except Exception as e:
        warning = f"Odoo mail send failed ({e}) — order marked sent but email may not have been delivered"

    # Mark the Odoo order as 'sent' regardless of email outcome
    try:
        odoo.write("sale.order", [order_id], {"state": "sent"})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error marking order sent: {str(e)}")

    now = datetime.now(timezone.utc)
    actor = _actor(current_user)
    note = f"Quote {'sent' if email_sent else 'marked sent (email not delivered)'} to customer (Odoo {order['name']})"

    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {"quote_sent_at": now, "updated_at": now},
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": actor,
                "at": now, "note": note,
            }},
        },
    )
    await audit_log(
        "ticket.send_quote", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"order_id": order_id, "order_name": order["name"], "email_sent": email_sent},
    )

    result: dict = {"success": True, "email_sent": email_sent}
    if warning:
        result["warning"] = warning
    return result


@router.post("/{ticket_id}/register-deposit")
async def register_deposit(
    ticket_id: str,
    body: TicketDepositRegister,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """
    Register a deposit payment against the linked sale order from the portal:
      1. Create a fixed-amount down payment invoice via Odoo's advance payment wizard
      2. Post the invoice (account.move → action_post)
      3. Register and reconcile payment via account.payment.register wizard
      4. Stamp payment_confirmed_by/at + link invoice_id on the ticket

    Keeps Odoo as the financial source of truth — nothing is bypassed.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order — build the quote first")
    if ticket.get("payment_confirmed_at"):
        raise HTTPException(status_code=400, detail="Deposit already registered on this ticket")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()

    # Resolve the order's company and validate it is confirmed before running the wizard
    _order_co = odoo.read("sale.order", [order_id], fields=["company_id", "state", "name"])
    if not _order_co:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    _order_row = _order_co[0]
    if _order_row.get("state") != "sale":
        raise HTTPException(
            status_code=400,
            detail=f"Order {_order_row.get('name')} must be confirmed before registering a deposit (current state: {_order_row.get('state')})",
        )
    _co = _order_row.get("company_id")
    order_company_id = _co[0] if _co else None
    _cctx = company_context(order_company_id)

    # Step 1: Create fixed-amount down payment invoice via Odoo wizard
    ctx = {"active_ids": [order_id], "active_model": "sale.order", "active_id": order_id, **_cctx}
    try:
        wizard_id = odoo_call(
            "sale.advance.payment.inv", "create",
            [{"advance_payment_method": "fixed", "fixed_amount": body.amount}],
            {"context": ctx},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to create deposit invoice in Odoo: {str(e)}")

    try:
        odoo_call(
            "sale.advance.payment.inv", "create_invoices",
            [[wizard_id]],
            {"context": ctx},
        )
    except Exception as e:
        # create_invoices returns an Odoo action dict that may contain None values,
        # which Odoo's own XML-RPC marshaller rejects. The invoice is still created —
        # we verify it exists by reading invoice_ids below rather than trusting the return value.
        logger.warning("deposit_create_invoices_response_error",
                       extra={"wizard_id": wizard_id, "error": str(e)})

    # Resolve the new invoice (highest ID among this order's invoices)
    try:
        order_data = odoo.read("sale.order", [order_id], fields=["invoice_ids"])
        inv_ids = order_data[0].get("invoice_ids", []) if order_data else []
        if not inv_ids:
            raise HTTPException(status_code=502, detail="Deposit invoice was not created in Odoo — check Odoo configuration")
        invoice_id = max(inv_ids)
        odoo.execute("account.move", "action_post", [invoice_id])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to post deposit invoice: {str(e)}")

    # Step 2: Register and reconcile payment via Odoo wizard
    try:
        pay_ctx = {"active_model": "account.move", "active_ids": [invoice_id], **_cctx}
        pay_wizard_id = odoo_call(
            "account.payment.register", "create",
            [{
                "amount": body.amount,
                "journal_id": body.journal_id,
                "payment_date": body.date,
            }],
            {"context": pay_ctx},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Payment registration failed: {str(e)}")

    try:
        odoo_call(
            "account.payment.register", "action_create_payments",
            [[pay_wizard_id]],
            {"context": pay_ctx},
        )
    except Exception as e:
        # Same Odoo XML-RPC serialisation quirk on the action response.
        # Verify the payment actually landed before treating this as a failure.
        try:
            updated = odoo.read("account.move", [invoice_id], fields=["payment_state"])
            if not updated or updated[0].get("payment_state") not in ("in_payment", "paid"):
                raise HTTPException(status_code=502, detail=f"Payment registration failed: {str(e)}")
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=502, detail=f"Payment registration failed: {str(e)}")
        logger.warning("deposit_payment_response_error",
                       extra={"invoice_id": invoice_id, "error": str(e)})

    # Stamp ticket
    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {
                "payment_confirmed_by": current_user["id"],
                "payment_confirmed_at": now,
                "invoice_id": invoice_id,
                "updated_at": now,
            },
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now,
                "note": body.note or f"Deposit registered — R{body.amount:,.2f} via journal {body.journal_id}",
            }},
        },
    )
    await audit_log(
        "ticket.register_deposit", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"amount": body.amount, "journal_id": body.journal_id, "invoice_id": invoice_id, "date": body.date},
    )
    return {"success": True, "invoice_id": invoice_id}


@router.get("/{ticket_id}/invoice-balance")
async def get_invoice_balance(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """Return the outstanding balance on the full sale invoice for this ticket.
    Used by the Register Balance Payment modal to pre-populate the amount."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order on this ticket")

    odoo = get_odoo_client()
    try:
        order_rows = odoo.read("sale.order", [ticket["order_id"]], fields=["invoice_ids", "name"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not order_rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")

    inv_ids = order_rows[0].get("invoice_ids", [])
    if not inv_ids:
        return {"invoice_id": None, "invoice_name": None, "amount_total": 0, "amount_residual": 0, "payment_state": "not_found"}

    try:
        invoices = odoo.read(
            "account.move", inv_ids,
            fields=["id", "name", "amount_total", "amount_residual", "payment_state", "move_type"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error reading invoices: {str(e)}")

    # The full SO invoice is the customer invoice with the largest amount_total — down
    # payment invoices are always smaller partial amounts against the same order.
    out_invoices = [i for i in invoices if i.get("move_type") == "out_invoice"]
    if not out_invoices:
        return {"invoice_id": None, "invoice_name": None, "amount_total": 0, "amount_residual": 0, "payment_state": "not_found"}

    full_invoice = max(out_invoices, key=lambda i: i.get("amount_total", 0))
    return {
        "invoice_id":      full_invoice["id"],
        "invoice_name":    full_invoice["name"],
        "amount_total":    full_invoice["amount_total"],
        "amount_residual": full_invoice["amount_residual"],
        "payment_state":   full_invoice["payment_state"],
    }


# Odoo report reference names — used to render PDFs on demand
_REPORT_NAMES = {
    "quote":   "sale.report_saleorder",
    "invoice": "account.report_move_full",
}


@router.get("/{ticket_id}/documents/{doc_type}")
async def get_ticket_document(
    ticket_id: str,
    doc_type: str,
    current_user: dict = Depends(get_current_user),
):
    """Stream an Odoo-generated PDF (quote or invoice) for a Sales Ticket.

    Tries ir.attachment first (Odoo stores PDFs there after posting/sending).
    Falls back to rendering via ir.actions.report if no stored attachment exists.
    Returns the raw PDF bytes so the frontend can open it in a new tab or iframe.
    """
    if doc_type not in _REPORT_NAMES:
        raise HTTPException(status_code=400, detail=f"Unknown document type '{doc_type}' — use 'quote' or 'invoice'")
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    odoo = get_odoo_client()

    if doc_type == "quote":
        if not ticket.get("order_id"):
            raise HTTPException(status_code=404, detail="No linked order on this ticket — build the quote first")
        record_id = ticket["order_id"]
        odoo_model = "sale.order"
        filename = f"Quote-{ticket.get('customer_name', ticket_id)}.pdf"

    else:  # invoice — target the full SO invoice (largest out_invoice)
        if not ticket.get("order_id"):
            raise HTTPException(status_code=404, detail="No linked order on this ticket")
        try:
            order_rows = odoo.read("sale.order", [ticket["order_id"]], fields=["invoice_ids"])
            inv_ids = order_rows[0].get("invoice_ids", []) if order_rows else []
            if not inv_ids:
                raise HTTPException(status_code=404, detail="No invoices found on this order — confirm the order first")
            invoices = odoo.read("account.move", inv_ids, fields=["id", "amount_total", "move_type"])
            out_invoices = [i for i in invoices if i.get("move_type") == "out_invoice"]
            if not out_invoices:
                raise HTTPException(status_code=404, detail="No customer invoice found for this order")
            record_id = max(out_invoices, key=lambda i: i.get("amount_total", 0))["id"]
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error resolving invoice: {str(e)}")
        odoo_model = "account.move"
        filename = f"Invoice-{ticket.get('customer_name', ticket_id)}.pdf"

    # ── Try stored attachment first ────────────────────────────────────────────
    try:
        attachments = odoo.search_read(
            "ir.attachment",
            [("res_model", "=", odoo_model), ("res_id", "=", record_id), ("mimetype", "=", "application/pdf")],
            ["datas", "name"],
            limit=1,
            order="create_date desc",
        )
        if attachments and attachments[0].get("datas"):
            pdf_bytes = base64.b64decode(attachments[0]["datas"])
            return Response(
                content=pdf_bytes,
                media_type="application/pdf",
                headers={"Content-Disposition": f'inline; filename="{filename}"'},
            )
    except Exception:
        pass  # fall through to on-demand render

    # ── Render on demand via Odoo HTTP report endpoint ─────────────────────────
    report_name = _REPORT_NAMES[doc_type]
    try:
        pdf_bytes = fetch_odoo_report_pdf(report_name, record_id)
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={"Content-Disposition": f'inline; filename="{filename}"'},
        )
    except Exception as e:
        raise HTTPException(
            status_code=502,
            detail=f"Could not render {doc_type} PDF from Odoo: {str(e)}",
        )


@router.post("/{ticket_id}/register-payment")
async def register_balance_payment(
    ticket_id: str,
    body: TicketBalancePayment,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """Register a balance (or partial) payment against the full sale invoice.

    Unlike register-deposit (which creates a down payment invoice first), this
    registers payment directly against the existing full invoice created at order
    confirmation — keeping Odoo as the financial source of truth.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status") in ("cancelled", "not_interested"):
        raise HTTPException(status_code=400, detail=f"Ticket is closed as '{ticket['exit_status']}'")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order — build the quote first")
    if body.amount <= 0:
        raise HTTPException(status_code=400, detail="Amount must be positive")

    odoo = get_odoo_client()

    # Resolve company context from the order
    try:
        order_rows = odoo.read("sale.order", [ticket["order_id"]], fields=["company_id", "state", "name", "invoice_ids"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not order_rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    order_row = order_rows[0]
    _co = order_row.get("company_id")
    order_company_id = _co[0] if _co else None
    _cctx = company_context(order_company_id)

    # Find the full invoice — the out_invoice with the largest amount_total
    inv_ids = order_row.get("invoice_ids", [])
    if not inv_ids:
        raise HTTPException(status_code=400, detail="No invoices found on this order — confirm the order first")

    try:
        invoices = odoo.read(
            "account.move", inv_ids,
            fields=["id", "name", "amount_total", "amount_residual", "payment_state", "move_type"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error reading invoices: {str(e)}")

    out_invoices = [i for i in invoices if i.get("move_type") == "out_invoice"]
    if not out_invoices:
        raise HTTPException(status_code=400, detail="No customer invoice found for this order")

    full_invoice = max(out_invoices, key=lambda i: i.get("amount_total", 0))
    invoice_id = full_invoice["id"]

    if full_invoice.get("payment_state") == "paid":
        raise HTTPException(status_code=400, detail="This invoice is already fully paid in Odoo")
    if full_invoice.get("amount_residual", 0) <= 0:
        raise HTTPException(status_code=400, detail="No outstanding balance on this invoice")

    # Register payment via Odoo wizard
    pay_ctx = {"active_model": "account.move", "active_ids": [invoice_id], **_cctx}
    try:
        pay_wizard_id = odoo_call(
            "account.payment.register", "create",
            [{
                "amount": body.amount,
                "journal_id": body.journal_id,
                "payment_date": body.date,
            }],
            {"context": pay_ctx},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Payment registration failed: {str(e)}")

    try:
        odoo_call(
            "account.payment.register", "action_create_payments",
            [[pay_wizard_id]],
            {"context": pay_ctx},
        )
    except Exception as e:
        # Verify payment actually landed despite XML-RPC serialisation quirk on action response
        try:
            updated = odoo.read("account.move", [invoice_id], fields=["payment_state", "amount_residual"])
            if not updated or updated[0].get("payment_state") not in ("in_payment", "partial", "paid"):
                raise HTTPException(status_code=502, detail=f"Payment registration failed: {str(e)}")
            final_state = updated[0]["payment_state"]
            final_residual = updated[0]["amount_residual"]
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=502, detail=f"Payment registration failed: {str(e)}")
        logger.warning("balance_payment_response_error",
                       extra={"invoice_id": invoice_id, "error": str(e)})
    else:
        try:
            updated = odoo.read("account.move", [invoice_id], fields=["payment_state", "amount_residual"])
            final_state = updated[0]["payment_state"] if updated else "unknown"
            final_residual = updated[0]["amount_residual"] if updated else 0
        except Exception:
            final_state = "unknown"
            final_residual = 0

    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {
                "balance_payment_by": current_user["id"],
                "balance_payment_at": now,
                "updated_at": now,
            },
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now,
                "note": body.note or f"Balance payment registered — R{body.amount:,.2f} via journal {body.journal_id}",
            }},
        },
    )
    await audit_log(
        "ticket.register_payment", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"amount": body.amount, "journal_id": body.journal_id, "invoice_id": invoice_id,
                "date": body.date, "payment_state": final_state, "amount_residual": final_residual},
    )
    return {"success": True, "invoice_id": invoice_id, "payment_state": final_state, "amount_residual": final_residual}


@router.post("/from-order")
async def create_ticket_from_order(
    body: TicketFromOrder,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """Onboard an existing Odoo draft order into the Sales Ticket pipeline.
    Creates a Sales Ticket at 'quote' stage with the order already linked.
    Used by sales reps/admins to claim pre-portal orders during system migration."""
    odoo = get_odoo_client()
    try:
        orders = odoo.read(
            "sale.order",
            [body.order_id],
            fields=["name", "partner_id", "state"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not orders:
        raise HTTPException(status_code=404, detail="Order not found in Odoo")
    order = orders[0]
    if order["state"] not in ("draft", "sent"):
        raise HTTPException(
            status_code=400,
            detail=(
                f"Order {order['name']} is already confirmed (state: {order['state']}) — "
                "use 'Queue for Packing' to adopt it instead"
            ),
        )
    existing = await col("tickets").find_one({"order_id": body.order_id, "type": "sales", "exit_status": None})
    if existing:
        raise HTTPException(status_code=409, detail="A Sales Ticket already exists for this order")

    partner = order.get("partner_id")
    customer_id = partner[0] if partner and partner is not False else None
    customer_name = partner[1] if partner and partner is not False else "Unknown"

    now = datetime.now(timezone.utc)
    actor = _actor(current_user)
    doc = {
        "type": "sales",
        "source": "direct",
        "customer_id": customer_id,
        "customer_name": customer_name,
        "order_id": body.order_id,
        "invoice_id": None,
        "orders_ticket_ref": None,
        "status": "quote",
        "exit_status": None,
        "assigned_to": current_user["id"],
        "assigned_to_name": actor,
        "assigned_to_role": current_user.get("role", ""),
        "payment_confirmed_by": None,
        "payment_confirmed_at": None,
        "incomplete_reason": None,
        "stage_history": [{
            "status": "quote", "exit_status": None,
            "actor_id": current_user["id"], "actor_name": actor,
            "at": now,
            "note": f"Ticket created from existing Odoo order {order['name']}",
        }],
        "created_at": now,
        "updated_at": now,
    }
    result = await col("tickets").insert_one(doc)
    await audit_log(
        "ticket.create_from_order", "ticket", str(result.inserted_id),
        entity_label=customer_name,
        user=current_user,
        after={"status": "quote", "order_id": body.order_id, "order_name": order["name"]},
    )
    await notify_ticket_assigned("sales", customer_name, current_user["id"])
    return {"success": True, "ticket_id": str(result.inserted_id)}
