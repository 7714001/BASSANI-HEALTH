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
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
from auth import require_permission, require_any_permission
from odoo_client import get_odoo_client, odoo as odoo_call
from warehouse_context import company_context
from database import col
from middleware.audit import audit_log
from services.notification_service import notify_ticket_assigned

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
    note: Optional[str] = ""


class TicketDepositRegister(BaseModel):
    amount: float
    date: str           # YYYY-MM-DD
    journal_id: int
    note: Optional[str] = ""


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
    if body.assigned_to and body.assigned_to != current_user["id"]:
        _au = await col("users").find_one({"id": body.assigned_to}, {"name": 1, "username": 1})
        _assignee_name = (_au.get("name") or _au.get("username")) if _au else body.assigned_to
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
    """Return Odoo bank/cash journals for the deposit registration modal."""
    odoo = get_odoo_client()
    try:
        journals = odoo.search_read(
            "account.journal",
            domain=[["type", "in", ["bank", "cash"]]],
            fields=["id", "name", "type"],
            limit=50,
            order="name asc",
        )
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
    if body.assigned_to is not None:
        updates["assigned_to"] = body.assigned_to or None
        if body.assigned_to:
            _au = await col("users").find_one({"id": body.assigned_to}, {"name": 1, "username": 1})
            updates["assigned_to_name"] = (_au.get("name") or _au.get("username")) if _au else None
        else:
            updates["assigned_to_name"] = None

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
    vals: dict = {
        "partner_id": ticket["customer_id"],
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

    # Resolve the order's company so wizard calls create records in the correct entity
    _order_co = odoo.read("sale.order", [order_id], fields=["company_id"])
    _co = _order_co[0].get("company_id") if _order_co else None
    order_company_id = _co[0] if _co else None
    _cctx = company_context(order_company_id)

    # Step 1: Create fixed-amount down payment invoice via Odoo wizard
    try:
        ctx = {"active_ids": [order_id], "active_model": "sale.order", "active_id": order_id, **_cctx}
        wizard_id = odoo_call(
            "sale.advance.payment.inv", "create",
            [{"advance_payment_method": "fixed", "fixed_amount": body.amount}],
            {"context": ctx},
        )
        odoo_call(
            "sale.advance.payment.inv", "create_invoices",
            [[wizard_id]],
            {"context": ctx},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to create deposit invoice in Odoo: {str(e)}")

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
        odoo_call(
            "account.payment.register", "action_create_payments",
            [[pay_wizard_id]],
            {"context": pay_ctx},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Payment registration failed: {str(e)}")

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
