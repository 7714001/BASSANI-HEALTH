"""
Recurring Orders — Phase 8.46.

A direct-inquiry Sales ticket or a reseller-placed order can be flagged to
recur on a schedule (weekly / biweekly / monthly). Two days before each
occurrence, generate_recurring_notices() (called from services/scheduler.py)
builds a draft replica sale.order + a linked Sales ticket and emails the end
customer a review/accept link (public, no login — see routes/public_routes.py's
/recurring/{token} endpoints). Accepting auto-confirms the order via
order_routes.py's _confirm_order_core; Bassani's manual control point is then
the same one every order has post-8.47: a 50% deposit must be registered
before the order reaches the packing board.

A missed/undecided occurrence is not an error — expire_unaccepted_occurrences()
(also called from scheduler.py) quietly cancels that one draft order and lets
the schedule continue to the next cycle ("skip and continue", confirmed with
the product owner).
"""
import logging
from datetime import datetime, date, timedelta, timezone
from uuid import uuid4
from fastapi import APIRouter, Depends, HTTPException
from typing import Optional
from pydantic import BaseModel
from bson import ObjectId

from auth import require_permission
from config import get_settings
from odoo_client import get_odoo_client
from database import col, NO_ID
from middleware.audit import audit_log
from routes.settings_routes import get_email_routing
from routes.ticket_routes import (
    _require_ticket_driver, _reseller_id_for_user, _assert_reseller_owns_ticket, _actor,
)
from services.email_service import send_recurring_order_upcoming

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/recurring-orders", tags=["recurring-orders"])

CADENCES = ("weekly", "biweekly", "monthly")


# ── Pydantic models ───────────────────────────────────────────────────────────

class RecurringOrderCreate(BaseModel):
    ticket_id: str
    cadence: str
    weekday: Optional[int] = None       # 0=Monday .. 6=Sunday — required for weekly/biweekly
    day_of_month: Optional[int] = None  # 1-28 — required for monthly
    start_date: Optional[str] = None    # ISO date (YYYY-MM-DD) — first occurrence; auto-computed if omitted
    end_date: Optional[str] = None      # ISO date — optional cutoff
    max_occurrences: Optional[int] = None


# ── Date helpers ──────────────────────────────────────────────────────────────

def _compute_first_occurrence(cadence: str, weekday: Optional[int], day_of_month: Optional[int],
                               start_date: Optional[date]) -> date:
    if start_date:
        return start_date
    today = datetime.now(timezone.utc).date()
    if cadence in ("weekly", "biweekly"):
        days_ahead = (weekday - today.weekday()) % 7
        if days_ahead == 0:
            days_ahead = 7  # today is the weekday — start next cycle, not today
        return today + timedelta(days=days_ahead)
    # monthly
    if today.day < day_of_month:
        return date(today.year, today.month, day_of_month)
    y, m = (today.year, today.month + 1) if today.month < 12 else (today.year + 1, 1)
    return date(y, m, day_of_month)


def _advance_occurrence(cadence: str, current: date) -> date:
    if cadence == "weekly":
        return current + timedelta(days=7)
    if cadence == "biweekly":
        return current + timedelta(days=14)
    y, m, d = current.year, current.month, current.day
    y, m = (y, m + 1) if m < 12 else (y + 1, 1)
    return date(y, m, d)


def _as_utc_midnight(d: date) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=timezone.utc)


# ── CRUD endpoints ─────────────────────────────────────────────────────────────

@router.post("")
async def create_recurring_order(
    body: RecurringOrderCreate,
    current_user: dict = Depends(_require_ticket_driver),
):
    """Mark an existing ticket's linked order as the template for a recurring
    schedule. Line items (products + quantities) are frozen from the order at
    setup time; pricing is re-fetched live from Odoo at each generation so a
    recurring order never invoices stale prices."""
    try:
        oid = ObjectId(body.ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if current_user.get("role") == "reseller":
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            raise HTTPException(status_code=403, detail="Access denied")
        await _assert_reseller_owns_ticket(ticket, rid)
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="Build a quote on this ticket before making it recurring")

    if body.cadence not in CADENCES:
        raise HTTPException(status_code=400, detail=f"cadence must be one of {CADENCES}")
    if body.cadence in ("weekly", "biweekly"):
        if body.weekday is None or not (0 <= body.weekday <= 6):
            raise HTTPException(status_code=400, detail="weekday (0-6) is required for weekly/biweekly cadence")
    else:
        if not body.day_of_month or not (1 <= body.day_of_month <= 28):
            raise HTTPException(status_code=400, detail="day_of_month (1-28) is required for monthly cadence")

    existing = await col("recurring_orders").find_one(
        {"source_ticket_id": str(oid), "status": "active"}
    )
    if existing:
        raise HTTPException(status_code=400, detail="This ticket already has an active recurring schedule")

    odoo = get_odoo_client()
    order_id = ticket["order_id"]
    try:
        order_rows = odoo.read("sale.order", [order_id], fields=["order_line", "warehouse_id", "note"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not order_rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")

    line_ids = order_rows[0].get("order_line") or []
    lines_data = odoo.read("sale.order.line", line_ids, fields=["product_id", "product_uom_qty", "name"]) if line_ids else []
    order_line = [
        {"product_id": l["product_id"][0], "product_uom_qty": l["product_uom_qty"], "name": l.get("name") or ""}
        for l in lines_data if l.get("product_id")
    ]
    if not order_line:
        raise HTTPException(status_code=400, detail="No product lines found on the linked order")

    _start_date = None
    if body.start_date:
        try:
            _start_date = datetime.strptime(body.start_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="start_date must be YYYY-MM-DD")
    _end_date = None
    if body.end_date:
        try:
            _end_date = datetime.strptime(body.end_date, "%Y-%m-%d").date()
        except ValueError:
            raise HTTPException(status_code=400, detail="end_date must be YYYY-MM-DD")
    if body.max_occurrences is not None and body.max_occurrences <= 0:
        raise HTTPException(status_code=400, detail="max_occurrences must be positive")

    next_run = _compute_first_occurrence(body.cadence, body.weekday, body.day_of_month, _start_date)

    customer_email = None
    try:
        p_rows = odoo.read("res.partner", [ticket["customer_id"]], fields=["email"])
        customer_email = p_rows[0].get("email") if p_rows else None
    except Exception:
        pass
    if not customer_email:
        logger.warning("recurring_order_no_customer_email", extra={"ticket_id": body.ticket_id})

    now = datetime.now(timezone.utc)
    doc = {
        "id": str(uuid4()),
        "source_ticket_id": str(oid),
        "customer_id": ticket["customer_id"],
        "customer_name": ticket.get("customer_name", ""),
        "customer_email": customer_email,
        "reseller_id": ticket.get("reseller_id"),
        "reseller_name": ticket.get("reseller_name"),
        "warehouse_id": order_rows[0]["warehouse_id"][0] if order_rows[0].get("warehouse_id") else None,
        "order_line": order_line,
        "note": order_rows[0].get("note") or "",
        "cadence": body.cadence,
        "weekday": body.weekday,
        "day_of_month": body.day_of_month,
        "next_run_date": _as_utc_midnight(next_run),
        "end_date": _as_utc_midnight(_end_date) if _end_date else None,
        "max_occurrences": body.max_occurrences,
        "occurrences_generated": 0,
        "status": "active",
        "created_by": current_user["id"],
        "created_by_name": _actor(current_user),
        "created_at": now,
        "updated_at": now,
    }
    await col("recurring_orders").insert_one(doc)
    await audit_log(
        "recurring_order.create", "recurring_order", doc["id"],
        entity_label=ticket.get("customer_name", ""), user=current_user,
        after={"cadence": body.cadence, "next_run_date": next_run.isoformat()},
    )
    return {"success": True, "id": doc["id"], "next_run_date": next_run.isoformat()}


@router.get("")
async def list_recurring_orders(
    current_user: dict = Depends(require_permission("orders.recurring_manage")),
):
    rows = await col("recurring_orders").find(NO_ID).sort("next_run_date", 1).to_list(length=None)
    for r in rows:
        for k in ("next_run_date", "end_date", "created_at", "updated_at"):
            if r.get(k):
                r[k] = r[k].isoformat()
    return {"schedules": rows, "total": len(rows)}


@router.get("/{schedule_id}")
async def get_recurring_order(
    schedule_id: str,
    current_user: dict = Depends(require_permission("orders.recurring_manage")),
):
    doc = await col("recurring_orders").find_one({"id": schedule_id}, NO_ID)
    if not doc:
        raise HTTPException(status_code=404, detail="Schedule not found")
    for k in ("next_run_date", "end_date", "created_at", "updated_at"):
        if doc.get(k):
            doc[k] = doc[k].isoformat()
    occurrences = await col("tickets").find(
        {"recurring_order_id": schedule_id}, NO_ID
    ).sort("created_at", -1).to_list(length=None)
    for t in occurrences:
        for k in ("scheduled_for", "created_at", "updated_at", "customer_accepted_at",
                   "customer_declined_at", "accept_token_expires_at"):
            if t.get(k):
                t[k] = t[k].isoformat()
        t.pop("accept_token", None)
    doc["occurrences"] = occurrences
    return doc


async def _set_schedule_status(schedule_id: str, from_statuses: tuple, to_status: str, current_user: dict) -> dict:
    doc = await col("recurring_orders").find_one({"id": schedule_id})
    if not doc:
        raise HTTPException(status_code=404, detail="Schedule not found")
    if doc["status"] not in from_statuses:
        raise HTTPException(
            status_code=400,
            detail=f"Schedule must be {' or '.join(from_statuses)} for this action (current: {doc['status']})",
        )
    now = datetime.now(timezone.utc)
    await col("recurring_orders").update_one(
        {"id": schedule_id}, {"$set": {"status": to_status, "updated_at": now}}
    )
    await audit_log(
        f"recurring_order.{to_status}", "recurring_order", schedule_id,
        entity_label=doc.get("customer_name", ""), user=current_user,
        before={"status": doc["status"]}, after={"status": to_status},
    )
    return {"success": True}


@router.post("/{schedule_id}/pause")
async def pause_recurring_order(
    schedule_id: str,
    current_user: dict = Depends(require_permission("orders.recurring_manage")),
):
    return await _set_schedule_status(schedule_id, ("active",), "paused", current_user)


@router.post("/{schedule_id}/resume")
async def resume_recurring_order(
    schedule_id: str,
    current_user: dict = Depends(require_permission("orders.recurring_manage")),
):
    return await _set_schedule_status(schedule_id, ("paused",), "active", current_user)


@router.post("/{schedule_id}/cancel")
async def cancel_recurring_order(
    schedule_id: str,
    current_user: dict = Depends(require_permission("orders.recurring_manage")),
):
    return await _set_schedule_status(schedule_id, ("active", "paused"), "cancelled", current_user)


# ── Generation jobs — called from services/scheduler.py ──────────────────────

async def generate_recurring_notices() -> None:
    """Daily. For every active schedule due in exactly 2 days: build a draft
    replica sale.order (current Odoo pricing), create a linked Sales ticket,
    and email the customer a review/accept link. Advances next_run_date to the
    following cycle immediately so this never re-fires for the same occurrence."""
    today = datetime.now(timezone.utc).date()
    target = today + timedelta(days=2)
    window_start = _as_utc_midnight(target)
    window_end = window_start + timedelta(days=1)
    due = await col("recurring_orders").find({
        "status": "active",
        "next_run_date": {"$gte": window_start, "$lt": window_end},
    }).to_list(length=None)

    odoo = get_odoo_client()
    for sched in due:
        try:
            await _generate_one_occurrence(odoo, sched)
        except Exception as e:
            logger.warning("recurring_notice_failed", extra={"schedule_id": sched.get("id"), "error": str(e)})


async def _generate_one_occurrence(odoo, sched: dict) -> None:
    scheduled_for = sched["next_run_date"]
    if scheduled_for.tzinfo is None:
        scheduled_for = scheduled_for.replace(tzinfo=timezone.utc)

    lines = []
    for l in sched["order_line"]:
        price_unit = 0
        try:
            price_rows = odoo.read("product.product", [l["product_id"]], fields=["list_price"])
            price_unit = price_rows[0]["list_price"] if price_rows else 0
        except Exception:
            pass
        lines.append((0, 0, {
            "product_id": l["product_id"],
            "product_uom_qty": l["product_uom_qty"],
            "price_unit": price_unit,
            **({"name": l["name"]} if l.get("name") else {}),
        }))

    vals: dict = {"partner_id": sched["customer_id"], "order_line": lines, "note": sched.get("note") or ""}
    if sched.get("warehouse_id"):
        vals["warehouse_id"] = sched["warehouse_id"]
    odoo_order_id = odoo.create("sale.order", vals)

    created = odoo.read("sale.order", [odoo_order_id], fields=["name", "amount_total"])
    order_ref = created[0]["name"] if created else f"#{odoo_order_id}"
    order_total = float(created[0].get("amount_total", 0)) if created else 0.0

    now = datetime.now(timezone.utc)
    accept_token = str(uuid4())
    ticket_doc = {
        "type": "sales",
        "source": "recurring",
        "customer_id": sched["customer_id"],
        "customer_name": sched.get("customer_name", ""),
        "order_id": odoo_order_id,
        "invoice_id": None,
        "orders_ticket_ref": None,
        "status": "quote",
        "exit_status": None,
        "reseller_id": sched.get("reseller_id"),
        "reseller_name": sched.get("reseller_name"),
        "assigned_to": None,
        "assigned_to_name": None,
        "payment_confirmed_by": None,
        "payment_confirmed_at": None,
        "incomplete_reason": None,
        "recurring_order_id": sched["id"],
        "scheduled_for": scheduled_for,
        "accept_token": accept_token,
        "accept_token_expires_at": scheduled_for + timedelta(days=4),
        "customer_accepted_at": None,
        "customer_declined_at": None,
        "stage_history": [{
            "status": "quote", "exit_status": None,
            "actor_id": None, "actor_name": "system",
            "at": now, "note": "Recurring order generated — awaiting customer review",
        }],
        "created_at": now,
        "updated_at": now,
    }
    await col("tickets").insert_one(ticket_doc)

    # Advance the schedule to the next cycle immediately — this occurrence is spent.
    next_run = _advance_occurrence(sched["cadence"], sched["next_run_date"].date())
    occurrences = sched.get("occurrences_generated", 0) + 1
    update: dict = {
        "next_run_date": _as_utc_midnight(next_run),
        "occurrences_generated": occurrences,
        "updated_at": now,
    }
    end_date = sched.get("end_date")
    hit_end = end_date and next_run > end_date.date()
    hit_max = sched.get("max_occurrences") and occurrences >= sched["max_occurrences"]
    if hit_end or hit_max:
        update["status"] = "completed"
    await col("recurring_orders").update_one({"id": sched["id"]}, {"$set": update})

    if sched.get("customer_email"):
        review_url = f"{settings.portal_url}/recurring/{accept_token}"
        send_recurring_order_upcoming(
            customer_email=sched["customer_email"],
            customer_name=sched.get("customer_name", ""),
            order_ref=order_ref,
            lines=[{"name": l.get("name") or "", "qty": l["product_uom_qty"]} for l in sched["order_line"]],
            order_total=order_total,
            scheduled_date=scheduled_for.strftime("%d %B %Y"),
            review_url=review_url,
        )
    else:
        logger.warning("recurring_notice_no_email", extra={"schedule_id": sched["id"], "order_id": odoo_order_id})


async def expire_unaccepted_occurrences() -> None:
    """Daily. Any recurring-generated ticket whose scheduled date has arrived
    with no customer response is skipped, not treated as an error: the draft
    order is cancelled, the ticket closed, staff notified. The schedule itself
    is untouched (next_run_date was already advanced at generation time), so
    it simply continues to the next cycle."""
    from services.email_service import send_recurring_order_skipped_internal

    now = datetime.now(timezone.utc)
    due = await col("tickets").find({
        "type": "sales", "source": "recurring", "status": "quote",
        "customer_accepted_at": None, "customer_declined_at": None,
        "exit_status": None,
        "scheduled_for": {"$lte": now},
    }).to_list(length=None)
    if not due:
        return

    odoo = get_odoo_client()
    routing = await get_email_routing()
    to = routing.get("recurring_order_skipped_to") or []

    for t in due:
        try:
            if t.get("order_id"):
                try:
                    odoo.execute("sale.order", "action_cancel", [t["order_id"]])
                except Exception:
                    pass
            await col("tickets").update_one(
                {"_id": t["_id"]},
                {
                    "$set": {"exit_status": "cancelled", "updated_at": now},
                    "$push": {"stage_history": {
                        "status": t["status"], "exit_status": "cancelled",
                        "actor_id": None, "actor_name": "system",
                        "at": now, "note": "Customer did not respond in time — recurring occurrence skipped",
                    }},
                },
            )
            if to:
                send_recurring_order_skipped_internal(
                    to, customer_name=t.get("customer_name", ""),
                    order_ref=f"#{t['order_id']}" if t.get("order_id") else "",
                )
        except Exception as e:
            logger.warning("recurring_expire_failed", extra={"ticket_id": str(t["_id"]), "error": str(e)})
