"""
Staff discount request/approval flow (8.61). Staff quote-builder only —
resellers and customers never request a discount. A draft SO is created (or
already exists) at normal pricing; a request here freezes the requested
percentages against it and blocks Send Quote / Confirm Order
(order_routes.py::_confirm_order_core, ticket_routes.py::send_quote) until a
holder of `discounts.approve` approves, rejects, or approves a different
percentage ("counters"). Approve/counter write `discount` directly onto the
existing sale.order.line rows in Odoo — no new SO is ever created here.

Separation of duties is enforced unconditionally (including for super_admin):
nobody decides their own request. Every request is decided manually — there
are no auto-approve thresholds.
"""
from datetime import datetime, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from auth import require_permission, require_any_permission
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from routes.settings_routes import get_email_routing
from services.email_service import (
    send_discount_request_notification,
    send_discount_decision_notification,
)

router = APIRouter(prefix="/api/discount-requests", tags=["discount-requests"])


class DiscountRequestLineIn(BaseModel):
    """Represents ONE line on the order — every line, not just the ones being
    discounted (8.61 follow-up, 2026-09-28). requested_pct is 0 for a line
    the requester left alone; this is what lets the approval queue show the
    full order in context (which lines were and weren't asked about) instead
    of only the discounted lines in isolation."""
    product_id: int
    product_name: str = ""
    qty: float = 0
    unit_price: float = 0
    requested_pct: float = 0


class DiscountRequestCreate(BaseModel):
    ticket_id: str
    lines: List[DiscountRequestLineIn]
    reason: str


class DiscountDecisionBody(BaseModel):
    note: Optional[str] = None


class DiscountCounterLine(BaseModel):
    product_id: int
    approved_pct: float


class DiscountCounterBody(BaseModel):
    lines: List[DiscountCounterLine]
    note: Optional[str] = None


def _actor(user: dict) -> str:
    return user.get("name") or user.get("username") or "unknown"


def _serialize(doc: dict) -> dict:
    doc["id"] = str(doc.pop("_id"))
    return doc


async def _resolve_user_email(user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    try:
        u = await col("users").find_one({"_id": ObjectId(user_id)}, {"email": 1})
    except Exception:
        return None
    return (u or {}).get("email") or None


def _write_line_discounts(odoo, order_id: int, pct_by_product: dict) -> None:
    """Writes `discount` onto each sale.order.line on `order_id` whose
    product_id appears in pct_by_product — never touches a line for a
    product that isn't in the map (e.g. a line added to the quote after the
    request was raised). Section/down-payment lines have no product_id key
    matching a real request, so the display_type/is_downpayment filter other
    order-line reads in this codebase use isn't needed here for correctness,
    but is kept as defense in depth."""
    rows = odoo.read("sale.order", [order_id], fields=["order_line"])
    if not rows or not rows[0].get("order_line"):
        raise HTTPException(status_code=502, detail="Could not read the order's line items from Odoo")
    lines = odoo.read("sale.order.line", rows[0]["order_line"], fields=["product_id", "display_type", "is_downpayment"])
    matched = 0
    for l in lines:
        if l.get("display_type") or l.get("is_downpayment"):
            continue
        pid = l["product_id"][0] if isinstance(l.get("product_id"), (list, tuple)) else l.get("product_id")
        if pid in pct_by_product:
            odoo.write("sale.order.line", [l["id"]], {"discount": pct_by_product[pid]})
            matched += 1
    if matched == 0:
        raise HTTPException(status_code=502, detail="None of the requested products were found on the order's current lines")


async def _load_pending_request(request_id: str) -> dict:
    try:
        oid = ObjectId(request_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request ID")
    doc = await col("discount_requests").find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Discount request not found")
    if doc["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"This request has already been {doc['status']}")
    return doc


def _assert_not_own_request(doc: dict, current_user: dict) -> None:
    """Separation of duties, enforced unconditionally — including for
    super_admin, which require_permission() itself would otherwise let bypass
    entirely. This is a business rule, not a permission gate."""
    if doc.get("requested_by", {}).get("id") == current_user.get("id"):
        raise HTTPException(status_code=403, detail="You cannot decide your own discount request")


async def _clear_ticket_flag(ticket_id: str) -> None:
    try:
        await col("tickets").update_one(
            {"_id": ObjectId(ticket_id)},
            {"$unset": {"discount_status": "", "discount_request_id": ""}},
        )
    except Exception:
        pass  # Best-effort — the request doc's own status is the durable source of truth


@router.post("/")
async def create_discount_request(
    body: DiscountRequestCreate,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    try:
        oid = ObjectId(body.ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="Build a quote before requesting a discount")
    if ticket.get("discount_status") == "pending":
        raise HTTPException(status_code=400, detail="A discount request is already pending on this quote")
    if not body.lines:
        raise HTTPException(status_code=400, detail="At least one line is required")
    if not (body.reason or "").strip():
        raise HTTPException(status_code=400, detail="A reason is required")
    for l in body.lines:
        if not (0 <= l.requested_pct <= 100):
            raise HTTPException(status_code=400, detail="Discount percentage must be between 0 and 100")
    discounted_lines = [l for l in body.lines if l.requested_pct > 0]
    if not discounted_lines:
        raise HTTPException(status_code=400, detail="Enter a discount % on at least one line")

    odoo = get_odoo_client()
    try:
        order_rows = odoo.read("sale.order", [ticket["order_id"]], fields=["name", "amount_total"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    order_name = order_rows[0]["name"] if order_rows else str(ticket["order_id"])
    order_total = order_rows[0]["amount_total"] if order_rows else None

    now = datetime.now(timezone.utc)
    doc = {
        "ticket_id": body.ticket_id,
        "order_id": ticket["order_id"],
        "order_name": order_name,
        "order_total": order_total,
        "customer_name": ticket.get("customer_name", ""),
        "requested_by": {"id": current_user["id"], "name": _actor(current_user)},
        "reason": body.reason.strip(),
        "status": "pending",
        # Every line on the order, not just the discounted ones (2026-09-28) —
        # requested_pct is 0 for a line the requester left alone. This is what
        # lets the approval queue show the full order in context rather than
        # only the discounted lines in isolation.
        "lines": [l.model_dump() for l in body.lines],
        "decision": None,
        "created_at": now,
        "updated_at": now,
    }
    result = await col("discount_requests").insert_one(doc)
    request_id = str(result.inserted_id)
    n = len(discounted_lines)
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {"discount_status": "pending", "discount_request_id": request_id, "updated_at": now},
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now, "note": f"Discount requested ({n} line{'s' if n != 1 else ''}): {body.reason.strip()}",
            }},
        },
    )
    await audit_log(
        "discount_request.create", "discount_request", request_id,
        entity_label=f"{order_name} - {ticket.get('customer_name','')}",
        user=current_user, after=doc,
    )
    routing = await get_email_routing()
    to = routing.get("discount_request_to") or []
    if to:
        background_tasks.add_task(
            send_discount_request_notification, to, order_name, ticket.get("customer_name", ""),
            _actor(current_user), body.reason.strip(),
            [{"product_name": l.product_name, "requested_pct": l.requested_pct} for l in discounted_lines],
            request_id,
        )
    return {"success": True, "request_id": request_id}


@router.get("/")
async def list_discount_requests(
    status: Optional[str] = None,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    query: dict = {}
    if status:
        query["status"] = status
    docs = await col("discount_requests").find(query).sort("created_at", -1).to_list(length=200)
    return {"requests": [_serialize(d) for d in docs]}


@router.get("/{request_id}")
async def get_discount_request(
    request_id: str,
    current_user: dict = Depends(require_any_permission("discounts.approve", "tickets.sales")),
):
    try:
        oid = ObjectId(request_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request ID")
    doc = await col("discount_requests").find_one({"_id": oid})
    if not doc:
        raise HTTPException(status_code=404, detail="Discount request not found")
    return _serialize(doc)


@router.post("/{request_id}/approve")
async def approve_discount_request(
    request_id: str,
    body: DiscountDecisionBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    doc = await _load_pending_request(request_id)
    _assert_not_own_request(doc, current_user)
    # doc["lines"] is the full order snapshot (2026-09-28) — only the lines
    # actually asked about (requested_pct > 0) get a discount applied.
    pct_by_product = {l["product_id"]: l["requested_pct"] for l in doc["lines"] if l.get("requested_pct")}
    odoo = get_odoo_client()
    _write_line_discounts(odoo, doc["order_id"], pct_by_product)

    now = datetime.now(timezone.utc)
    note = (body.note or "").strip() or None
    decision = {"by": {"id": current_user["id"], "name": _actor(current_user)}, "at": now, "note": note}
    await col("discount_requests").update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "approved", "decision": decision, "updated_at": now}},
    )
    await _clear_ticket_flag(doc["ticket_id"])
    await audit_log(
        "discount_request.approve", "discount_request", request_id,
        entity_label=doc["order_name"], user=current_user, after=decision,
    )
    requester_email = await _resolve_user_email(doc.get("requested_by", {}).get("id"))
    if requester_email:
        background_tasks.add_task(
            send_discount_decision_notification, requester_email, doc["order_name"], doc["customer_name"],
            "approved", _actor(current_user), request_id, note or "",
        )
    return {"success": True}


@router.post("/{request_id}/reject")
async def reject_discount_request(
    request_id: str,
    body: DiscountDecisionBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    doc = await _load_pending_request(request_id)
    _assert_not_own_request(doc, current_user)

    now = datetime.now(timezone.utc)
    note = (body.note or "").strip() or None
    decision = {"by": {"id": current_user["id"], "name": _actor(current_user)}, "at": now, "note": note}
    await col("discount_requests").update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "rejected", "decision": decision, "updated_at": now}},
    )
    await _clear_ticket_flag(doc["ticket_id"])
    await audit_log(
        "discount_request.reject", "discount_request", request_id,
        entity_label=doc["order_name"], user=current_user, after=decision,
    )
    requester_email = await _resolve_user_email(doc.get("requested_by", {}).get("id"))
    if requester_email:
        background_tasks.add_task(
            send_discount_decision_notification, requester_email, doc["order_name"], doc["customer_name"],
            "rejected", _actor(current_user), request_id, note or "",
        )
    return {"success": True}


@router.post("/{request_id}/counter")
async def counter_discount_request(
    request_id: str,
    body: DiscountCounterBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("discounts.approve")),
):
    doc = await _load_pending_request(request_id)
    _assert_not_own_request(doc, current_user)
    if not body.lines:
        raise HTTPException(status_code=400, detail="At least one line is required")
    # Only lines that were actually asked about can be countered — a line the
    # requester left alone (requested_pct 0, kept only for full-order context)
    # is not a candidate.
    requested_pids = {l["product_id"] for l in doc["lines"] if l.get("requested_pct")}
    pct_by_product: dict = {}
    for l in body.lines:
        if l.product_id not in requested_pids:
            raise HTTPException(status_code=400, detail="Cannot counter a product that wasn't part of the original request")
        if not (0 <= l.approved_pct <= 100):
            raise HTTPException(status_code=400, detail="Discount percentage must be between 0 and 100")
        pct_by_product[l.product_id] = l.approved_pct

    odoo = get_odoo_client()
    _write_line_discounts(odoo, doc["order_id"], pct_by_product)

    now = datetime.now(timezone.utc)
    note = (body.note or "").strip() or None
    decision = {
        "by": {"id": current_user["id"], "name": _actor(current_user)}, "at": now, "note": note,
        "applied_lines": [{"product_id": l.product_id, "approved_pct": l.approved_pct} for l in body.lines],
    }
    await col("discount_requests").update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "countered", "decision": decision, "updated_at": now}},
    )
    await _clear_ticket_flag(doc["ticket_id"])
    await audit_log(
        "discount_request.counter", "discount_request", request_id,
        entity_label=doc["order_name"], user=current_user, after=decision,
    )
    requester_email = await _resolve_user_email(doc.get("requested_by", {}).get("id"))
    if requester_email:
        background_tasks.add_task(
            send_discount_decision_notification, requester_email, doc["order_name"], doc["customer_name"],
            "countered", _actor(current_user), request_id, note or "",
        )
    return {"success": True}


@router.post("/{request_id}/cancel")
async def cancel_discount_request(
    request_id: str,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """Withdraws a still-pending request — the requester changed their mind,
    or is about to edit the quote's lines (the frontend also calls this, or
    relies on the same-shape auto-cancel in update_order_from_ticket, before
    saving an edit while a request is pending). The requester or an admin
    can withdraw; nobody else."""
    doc = await _load_pending_request(request_id)
    is_owner = doc.get("requested_by", {}).get("id") == current_user.get("id")
    if not (is_owner or current_user.get("is_super_admin") or current_user.get("role") in ("super_admin", "admin")):
        raise HTTPException(status_code=403, detail="Only the requester or an admin can withdraw this request")

    now = datetime.now(timezone.utc)
    decision = {"by": {"id": current_user["id"], "name": _actor(current_user)}, "at": now, "note": "Withdrawn"}
    await col("discount_requests").update_one(
        {"_id": doc["_id"]}, {"$set": {"status": "cancelled", "decision": decision, "updated_at": now}},
    )
    await _clear_ticket_flag(doc["ticket_id"])
    await audit_log(
        "discount_request.cancel", "discount_request", request_id,
        entity_label=doc["order_name"], user=current_user,
    )
    return {"success": True}
