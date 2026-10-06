"""
Customer support desk (Phase 28) — queries, complaints and order feedback.

One queue, three ways in:
  - Portal users (customer / reseller roles) raise and follow up on requests
    inside the portal (`router`, /api/support).
  - Customers WITHOUT a portal login use signed links embedded in the emails
    they already receive (`public_router`, /api/public/support): an order link
    to raise a request about that order or rate it, and a per-case link to
    follow a request up. See support_links.py.
  - Staff log a request on a customer's behalf (phone call, walk-in, email).

Every entry point creates cases through _create_case_core() and posts
messages through _add_message_core(), so status, SLA clock and notification
behaviour can never drift between them.

MongoDB only (Architecture Principle #5) — a support case is a portal-layer
record. Odoo is read for order/invoice/customer context, never written.

Product quality complaints are a compliance track inside the same queue
(EU GMP Chapter 8 complaint handling): routed to QA/RP, and can only be
resolved or closed by a `support.quality_review` holder AFTER a recorded
quality review (investigation, root cause, outcome, CAPA, recall decision).
"""
import logging
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from pydantic import BaseModel
from pymongo import ReturnDocument

from auth import ADMIN_ROLES, PRODUCTION_ROLES, TICKET_ROLES, get_current_user, require_any_permission
from config import get_settings
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from ownership import get_owned_partner_ids, is_partner_owned_by
from rate_limit import limiter
from routes.settings_routes import get_email_routing
from services.age_tier import age_fields
from services.email_service import (
    send_support_case_assigned,
    send_support_case_new_internal,
    send_support_case_received,
    send_support_case_resolved,
    send_support_reply_customer,
    send_support_reply_internal,
    send_support_sla_escalation,
    send_order_feedback_request,
)
from services.r2_client import r2_presign, r2_put
from support_links import case_help_url, make_case_token, order_help_url, verify_case_token, verify_order_token

router = APIRouter(prefix="/api/support", tags=["support"])
public_router = APIRouter(prefix="/api/public/support", tags=["support-public"])
logger = logging.getLogger(__name__)
settings = get_settings()


# ── Constants ────────────────────────────────────────────────────────────────

CATEGORIES = {
    "order":           "Order or delivery query",
    "invoice":         "Invoice or payment query",
    "product_quality": "Product quality complaint",
    "account":         "Account or details",
    "feedback":        "Feedback",
    "general":         "General query",
}
# Category → EmailRoutingConfig key. Anything unlisted goes to support_general_to.
CATEGORY_ROUTING = {
    "order":           "support_order_to",
    "invoice":         "support_invoice_to",
    "product_quality": "support_quality_to",
}
PRIORITIES = {"low": "Low", "normal": "Normal", "high": "High", "urgent": "Urgent"}
# First-response / next-response target per priority, in calendar hours (same
# calendar-hour convention as services/age_tier.py's order deadlines).
RESPONSE_TARGET_HOURS = {"urgent": 4, "high": 8, "normal": 24, "low": 48}
STATUSES = {
    "new":               "New",
    "open":              "Open",
    "awaiting_customer": "Awaiting Customer",
    "resolved":          "Resolved",
    "closed":            "Closed",
}
ACTIVE_STATUSES = {"new", "open", "awaiting_customer"}
STAFF_SETTABLE_STATUSES = {"new", "open", "awaiting_customer"}
AUTO_CLOSE_DAYS = 7

MAX_FILES = 5
MAX_FILE_BYTES = 8 * 1024 * 1024
ALLOWED_EXT = {".pdf", ".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif",
               ".doc", ".docx", ".xls", ".xlsx", ".csv", ".txt"}
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
EXTERNAL_ROLES = {"customer", "reseller"}


# ── Request models ───────────────────────────────────────────────────────────

class CaseUpdateBody(BaseModel):
    status: Optional[str] = None
    priority: Optional[str] = None
    category: Optional[str] = None


class AssignBody(BaseModel):
    user_id: Optional[str] = None  # None/"" = unassign


class ResolveBody(BaseModel):
    resolution_note: str


class CloseBody(BaseModel):
    note: Optional[str] = None


class FeedbackBody(BaseModel):
    rating: int
    comment: Optional[str] = None


class QualityReviewBody(BaseModel):
    investigation_summary: str
    root_cause: Optional[str] = None
    outcome: str  # justified | not_justified | inconclusive
    capa: Optional[str] = None
    recall_required: bool = False
    recall_notes: Optional[str] = None
    reported_to_authority: bool = False  # SAHPRA adverse-event report made


class OrderFeedbackBody(BaseModel):
    order_id: int
    rating: int
    comment: Optional[str] = None


class FeedbackRequestBody(BaseModel):
    ticket_id: str
    recipients: Optional[List[str]] = None  # first = To, rest = CC (SendRecipientsModal)


class PublicOrderFeedbackBody(BaseModel):
    rating: int
    comment: Optional[str] = None
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None


QUALITY_OUTCOMES = {"justified": "Justified", "not_justified": "Not justified", "inconclusive": "Inconclusive"}


# ── Access helpers ───────────────────────────────────────────────────────────

def _now() -> datetime:
    return datetime.now(timezone.utc)


def _actor_name(user: dict) -> str:
    return user.get("name") or user.get("username") or "Unknown"


def _is_super(user: dict) -> bool:
    return bool(user.get("is_super_admin") or user.get("role") == "super_admin")


def _is_external(user: dict) -> bool:
    return user.get("role") in EXTERNAL_ROLES


def _perm(user: dict, action: str) -> bool:
    if _is_external(user):
        return False
    if _is_super(user):
        return True
    return bool(((user.get("permissions") or {}).get("support") or {}).get(action))


def _require_perm(user: dict, action: str) -> None:
    if not _perm(user, action):
        raise HTTPException(status_code=403, detail="You do not have permission to perform this action")


async def _require_support_access(current_user: dict = Depends(get_current_user)) -> dict:
    """Staff with support.view, or a reseller/customer (scoped to their own
    customers' cases inside each endpoint). Same external-role pass-through
    shape as ticket_routes.py's _require_ticket_uploader."""
    if _is_super(current_user) or _is_external(current_user):
        return current_user
    if current_user.get("role") not in (ADMIN_ROLES | TICKET_ROLES | PRODUCTION_ROLES):
        raise HTTPException(status_code=403, detail="Access denied")
    if not _perm(current_user, "view"):
        raise HTTPException(status_code=403, detail="You do not have permission to view the support desk")
    return current_user


async def _reseller_id_for(user: dict) -> Optional[str]:
    doc = await col("resellers").find_one({"user_id": user["id"]}, {"id": 1, "_id": 0})
    return doc["id"] if doc else None


async def _external_scope(user: dict) -> dict:
    """Mongo filter restricting an external viewer to their own customers'
    cases: a customer login sees every case on its active company (same
    company-level sharing as orders/invoices), a reseller sees cases for every
    customer it owns (7.13 ownership, same as orders/tickets)."""
    if user.get("role") == "customer":
        return {"customer_partner_id": user.get("customer_company_partner_id") or -1}
    rid = await _reseller_id_for(user)
    owned = list(await get_owned_partner_ids(rid)) if rid else []
    return {"customer_partner_id": {"$in": owned}}


async def _assert_owns_partner(user: dict, partner_id: Optional[int]) -> None:
    if not _is_external(user):
        return
    if not partner_id:
        raise HTTPException(status_code=403, detail="Access denied")
    if user.get("role") == "customer":
        if partner_id != user.get("customer_company_partner_id"):
            raise HTTPException(status_code=403, detail="Access denied")
        return
    rid = await _reseller_id_for(user)
    if not rid or not await is_partner_owned_by(rid, partner_id):
        raise HTTPException(status_code=403, detail="Access denied")


async def _load_case(case_id: str) -> dict:
    try:
        oid = ObjectId(case_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid request ID")
    case = await col("support_cases").find_one({"_id": oid})
    if not case:
        raise HTTPException(status_code=404, detail="Request not found")
    return case


async def _load_case_for(case_id: str, user: dict) -> dict:
    case = await _load_case(case_id)
    await _assert_owns_partner(user, case.get("customer_partner_id"))
    return case


# ── Odoo context resolution (read-only) ──────────────────────────────────────

def _m2o_id(val):
    return val[0] if isinstance(val, (list, tuple)) and val else None


def _company_of(odoo, partner_id: int) -> dict:
    """Resolve any partner (a contact or the company itself) to its
    commercial company — the id customer_ownership, orders and tickets are
    all keyed on."""
    rows = odoo.read("res.partner", [partner_id], fields=["commercial_partner_id"])
    company_id = _m2o_id(rows[0].get("commercial_partner_id")) if rows else None
    company_id = company_id or partner_id
    crow = odoo.read("res.partner", [company_id], fields=["name", "email"])
    crow = crow[0] if crow else {}
    email = crow.get("email")
    return {
        "customer_partner_id": company_id,
        "customer_name": crow.get("name") or "",
        "customer_email": email if email and email is not False else None,
    }


def _order_context(odoo, order_id: int, include_lines: bool = False) -> dict:
    rows = odoo.read("sale.order", [int(order_id)], fields=["name", "partner_id", "date_order", "order_line"])
    if not rows:
        raise HTTPException(status_code=404, detail="Order not found")
    o = rows[0]
    partner_id = _m2o_id(o.get("partner_id"))
    ctx = {"order_id": int(order_id), "order_name": o.get("name") or f"#{order_id}",
           "date_order": o.get("date_order") or None}
    ctx.update(_company_of(odoo, partner_id) if partner_id else
               {"customer_partner_id": None, "customer_name": "", "customer_email": None})
    if include_lines:
        lines = []
        line_ids = o.get("order_line") or []
        if line_ids:
            try:
                raw = odoo.read("sale.order.line", line_ids,
                                fields=["product_id", "name", "product_uom_qty", "display_type", "is_downpayment"])
            except Exception:
                raw = odoo.read("sale.order.line", line_ids, fields=["product_id", "name", "product_uom_qty"])
            for l in raw:
                if l.get("display_type") or l.get("is_downpayment") or not l.get("product_id"):
                    continue
                lines.append({
                    "product_id": _m2o_id(l.get("product_id")),
                    "product_name": l["product_id"][1] if isinstance(l.get("product_id"), (list, tuple)) else l.get("name"),
                    "qty": l.get("product_uom_qty") or 0,
                })
        ctx["lines"] = lines
    return ctx


def _invoice_context(odoo, invoice_id: int) -> dict:
    rows = odoo.read("account.move", [int(invoice_id)], fields=["name", "partner_id", "invoice_origin"])
    if not rows:
        raise HTTPException(status_code=404, detail="Invoice not found")
    inv = rows[0]
    partner_id = _m2o_id(inv.get("partner_id"))
    name = inv.get("name")
    ctx = {"invoice_id": int(invoice_id), "invoice_name": name if name and name is not False else f"#{invoice_id}"}
    ctx.update(_company_of(odoo, partner_id) if partner_id else
               {"customer_partner_id": None, "customer_name": "", "customer_email": None})
    origin = inv.get("invoice_origin")
    if origin and origin is not False:
        try:
            so = odoo.search_read("sale.order", [("name", "=", origin)], fields=["id", "name"], limit=1)
            if so:
                ctx["order_id"], ctx["order_name"] = so[0]["id"], so[0]["name"]
        except Exception:
            pass
    return ctx


# ── Shared helpers ───────────────────────────────────────────────────────────

async def _next_ref() -> str:
    doc = await col("counters").find_one_and_update(
        {"_id": "support_case"}, {"$inc": {"seq": 1}},
        upsert=True, return_document=ReturnDocument.AFTER,
    )
    return f"SUP-{doc['seq']:05d}"


async def _store_attachments(case_id: str, files: Optional[List[UploadFile]]) -> list:
    """Validates every file first, then uploads — a bad file in the batch
    never leaves the others half-stored in R2."""
    files = [f for f in (files or []) if f is not None and (f.filename or "").strip()]
    if not files:
        return []
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=422, detail=f"You can attach up to {MAX_FILES} files at a time")
    staged = []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(status_code=422, detail=f"{f.filename}: this file type isn't supported")
        data = await f.read()
        if not data:
            raise HTTPException(status_code=422, detail=f"{f.filename} is empty")
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=422, detail=f"{f.filename} is larger than 8MB")
        staged.append((f, ext, data))
    out = []
    for f, ext, data in staged:
        att_id = str(uuid.uuid4())
        key = f"support/{case_id}/{att_id}{ext}"
        await r2_put(key, data, content_type=f.content_type or "application/octet-stream")
        out.append({"id": att_id, "filename": f.filename, "size": len(data), "r2_key": key})
    return out


def _sla(case: dict) -> dict:
    """Response-target tier — only while the case is waiting on US. Same tier
    thresholds as the order pipeline (services/age_tier.py), so 'Overdue' and
    'At Risk' mean the same thing on the support desk as everywhere else."""
    if case.get("status") in ACTIVE_STATUSES and case.get("waiting_on") == "staff" and case.get("staff_clock_since"):
        return age_fields(case["staff_clock_since"], RESPONSE_TARGET_HOURS.get(case.get("priority"), 24))
    return {"age_tier": None, "hours_elapsed": None, "deadline_hours": None}


_EXTERNAL_HIDDEN = {"quality_review", "staff_clock_since", "escalated_at", "assigned_to"}


def _serialize(case: dict, external: bool) -> dict:
    out = {k: v for k, v in case.items() if k != "_id"}
    out["id"] = str(case["_id"])
    out["category_label"] = CATEGORIES.get(case.get("category"), "General query")
    out["priority_label"] = PRIORITIES.get(case.get("priority"), "Normal")
    out["status_label"] = STATUSES.get(case.get("status"), case.get("status"))
    if "messages" in case:
        msgs = []
        for m in case.get("messages") or []:
            if external and m.get("internal"):
                continue
            m = dict(m)
            m["attachments"] = [{k: v for k, v in a.items() if k != "r2_key"} for a in m.get("attachments") or []]
            msgs.append(m)
        out["messages"] = msgs
    if external:
        for k in _EXTERNAL_HIDDEN:
            out.pop(k, None)
    else:
        out.update(_sla(case))
    return out


async def _routing_for(category: str) -> list:
    """Category list → support_general_to → support_email env var. A customer
    complaint must never silently reach nobody."""
    routing = await get_email_routing()
    emails = routing.get(CATEGORY_ROUTING.get(category, "support_general_to")) or []
    if not emails:
        emails = routing.get("support_general_to") or [settings.support_email]
    return list(dict.fromkeys(e.lower() for e in emails if e))


async def _user_email(user_id: Optional[str]) -> Optional[str]:
    if not user_id:
        return None
    try:
        u = await col("users").find_one({"_id": ObjectId(user_id)}, {"email": 1, "username": 1})
    except Exception:
        return None
    if not u:
        return None
    return u.get("email") or (u.get("username") if "@" in (u.get("username") or "") else None)


def _customer_case_url(case: dict) -> str:
    """Portal deep link when the request was raised from a portal login;
    otherwise the signed no-login link (works for portal users too)."""
    if case.get("source") == "portal":
        return f"{settings.portal_url}/support?case={case['_id']}"
    return case_help_url(str(case["_id"]))


async def _push_ticket_activity(ticket_id, actor_name: str, note: str) -> None:
    """Note-only stage_history entry on the linked Sales ticket, so its
    Activity Log shows a customer raised a request on that order — same
    best-effort shape as discount_routes.py's _push_ticket_activity."""
    try:
        ticket = await col("tickets").find_one({"_id": ObjectId(str(ticket_id))}, {"status": 1, "exit_status": 1})
        if not ticket:
            return
        await col("tickets").update_one({"_id": ticket["_id"]}, {"$push": {"stage_history": {
            "status": ticket.get("status"), "exit_status": ticket.get("exit_status"),
            "actor_id": None, "actor_name": actor_name, "at": _now(), "note": note,
        }}})
    except Exception as exc:
        logger.warning("support_ticket_activity_failed ticket_id=%s error=%s", ticket_id, exc)


def _clean_text(value: Optional[str], field: str, min_len: int, max_len: int) -> str:
    v = (value or "").strip()
    if len(v) < min_len:
        raise HTTPException(status_code=422, detail=f"Please enter a {field}")
    if len(v) > max_len:
        raise HTTPException(status_code=422, detail=f"The {field} is too long (max {max_len} characters)")
    return v


# ── Core: create case ────────────────────────────────────────────────────────

async def _create_case_core(
    *,
    background_tasks: BackgroundTasks,
    category: str,
    subject: str,
    body: str,
    customer: dict,               # {customer_partner_id, customer_name, customer_email}
    contact_name: Optional[str],
    contact_email: Optional[str],
    raised_by: dict,              # {id, name, role}
    source: str,                  # portal | staff | email_link | order_feedback
    priority: Optional[str] = None,
    order: Optional[dict] = None,
    invoice: Optional[dict] = None,
    product_name: Optional[str] = None,
    lot_number: Optional[str] = None,
    adverse_event: bool = False,
    files: Optional[List[UploadFile]] = None,
    notify_customer: bool = True,
    actor_user: Optional[dict] = None,
) -> dict:
    if category not in CATEGORIES:
        raise HTTPException(status_code=422, detail="Please choose what your request is about")
    subject = _clean_text(subject, "subject", 3, 200)
    body = _clean_text(body, "message", 1, 5000)
    if contact_email and not _EMAIL_RE.match(contact_email.strip()):
        raise HTTPException(status_code=422, detail="Please enter a valid email address")
    adverse_event = bool(adverse_event) and category == "product_quality"
    if priority not in PRIORITIES:
        priority = "urgent" if adverse_event else ("high" if category == "product_quality" else "normal")

    case_oid = ObjectId()
    attachments = await _store_attachments(str(case_oid), files)
    now = _now()

    order_id = (order or {}).get("order_id") or (invoice or {}).get("order_id")
    order_name = (order or {}).get("order_name") or (invoice or {}).get("order_name")
    sales_ticket = None
    if order_id:
        sales_ticket = await col("tickets").find_one(
            {"order_id": {"$in": [str(order_id), order_id]}},
            {"_id": 1, "assigned_to": 1}, sort=[("created_at", -1)],
        )

    is_staff_author = raised_by.get("role") not in (EXTERNAL_ROLES | {"public"})
    message = {
        "id": str(uuid.uuid4()),
        "author": {"id": raised_by.get("id"), "name": raised_by.get("name"), "role": raised_by.get("role")},
        "is_staff": is_staff_author,
        "internal": False,
        "body": body,
        "attachments": attachments,
        "at": now,
    }
    doc = {
        "_id": case_oid,
        "ref": await _next_ref(),
        "subject": subject,
        "category": category,
        "priority": priority,
        "status": "new",
        "waiting_on": "staff",
        "source": source,
        "customer_partner_id": customer.get("customer_partner_id"),
        "customer_name": customer.get("customer_name") or "",
        "contact_name": (contact_name or "").strip() or customer.get("customer_name") or "",
        "contact_email": ((contact_email or "").strip().lower() or customer.get("customer_email") or None),
        "raised_by": {"id": raised_by.get("id"), "name": raised_by.get("name"), "role": raised_by.get("role")},
        "order_id": order_id,
        "order_name": order_name,
        "invoice_id": (invoice or {}).get("invoice_id"),
        "invoice_name": (invoice or {}).get("invoice_name"),
        "sales_ticket_id": str(sales_ticket["_id"]) if sales_ticket else None,
        "product_name": (product_name or "").strip() or None,
        "lot_number": (lot_number or "").strip() or None,
        "adverse_event": adverse_event,
        "assigned_to": None,
        "messages": [message],
        "message_count": 1,
        "last_message_at": now,
        "last_message_by_staff": is_staff_author,
        "first_response_at": None,
        "staff_clock_since": now,
        "escalated_at": None,
        "resolved_at": None,
        "closed_at": None,
        "resolution": None,
        "quality_review": None,
        "csat": None,
        "created_at": now,
        "updated_at": now,
    }
    await col("support_cases").insert_one(doc)

    await audit_log(
        "support.case_created", "support_case", str(case_oid), entity_label=doc["ref"],
        user=actor_user,
        after={"category": category, "priority": priority, "customer": doc["customer_name"],
               "order": order_name, "source": source, "adverse_event": adverse_event},
    )
    if sales_ticket:
        await _push_ticket_activity(
            sales_ticket["_id"], raised_by.get("name") or "Customer",
            f"Support request {doc['ref']} raised: {subject}",
        )

    # ── Notifications ──
    internal_to = await _routing_for(category)
    if adverse_event:
        routing = await get_email_routing()
        internal_to += [e.lower() for e in routing.get("support_quality_to") or []]
    assignee_email = await _user_email((sales_ticket or {}).get("assigned_to"))
    if assignee_email:
        internal_to.append(assignee_email.lower())
    internal_to = list(dict.fromkeys(internal_to))
    background_tasks.add_task(
        send_support_case_new_internal, internal_to,
        case_ref=doc["ref"], case_id=str(case_oid), subject=subject,
        customer_name=doc["customer_name"], category_label=CATEGORIES[category],
        priority_label=PRIORITIES[priority], raised_by=raised_by.get("name") or doc["contact_name"],
        message=body, order_ref=order_name, adverse_event=adverse_event,
    )
    if notify_customer and doc["contact_email"] and source != "order_feedback":
        background_tasks.add_task(
            send_support_case_received, doc["contact_email"],
            contact_name=doc["contact_name"], case_ref=doc["ref"], subject=subject,
            category_label=CATEGORIES[category], case_url=_customer_case_url(doc),
        )
    return doc


# ── Core: add message ────────────────────────────────────────────────────────

async def _add_message_core(
    case: dict,
    *,
    author: dict,
    is_staff: bool,
    internal: bool,
    body: str,
    files: Optional[List[UploadFile]],
    background_tasks: BackgroundTasks,
    actor_user: Optional[dict] = None,
) -> dict:
    if case.get("status") == "closed":
        raise HTTPException(status_code=400, detail="This request is closed. Please raise a new request if you still need help.")
    body = _clean_text(body, "message", 1, 5000)
    internal = bool(internal) and is_staff
    attachments = await _store_attachments(str(case["_id"]), files)
    now = _now()
    message = {
        "id": str(uuid.uuid4()),
        "author": {"id": author.get("id"), "name": author.get("name"), "role": author.get("role")},
        "is_staff": is_staff, "internal": internal, "body": body,
        "attachments": attachments, "at": now,
    }
    sets: dict = {"updated_at": now}
    if not internal:
        sets.update({"last_message_at": now, "last_message_by_staff": is_staff})
    reopened = False
    if is_staff and not internal:
        # A public staff reply hands the ball to the customer: SLA clock stops.
        sets.update({"status": "awaiting_customer", "waiting_on": "customer",
                     "staff_clock_since": None, "escalated_at": None})
        if not case.get("first_response_at"):
            sets["first_response_at"] = now
        if not case.get("assigned_to") and author.get("id"):
            sets["assigned_to"] = {"id": author["id"], "name": author.get("name")}
    elif not is_staff:
        if case.get("status") in ("awaiting_customer", "resolved"):
            reopened = case.get("status") == "resolved"
            sets["status"] = "open"
            sets["resolved_at"] = None
        if case.get("waiting_on") != "staff":
            sets.update({"waiting_on": "staff", "staff_clock_since": now, "escalated_at": None})

    await col("support_cases").update_one(
        {"_id": case["_id"]},
        {"$set": sets, "$push": {"messages": message}, "$inc": {"message_count": 1}},
    )
    action = "support.internal_note" if internal else ("support.reply" if is_staff else "support.customer_reply")
    if is_staff or reopened:
        await audit_log(
            "support.reopened" if reopened else action, "support_case", str(case["_id"]),
            entity_label=case.get("ref", ""), user=actor_user,
            before={"status": case.get("status")}, after={"status": sets.get("status", case.get("status"))},
        )

    if not internal:
        if is_staff:
            background_tasks.add_task(
                send_support_reply_customer, case.get("contact_email"),
                contact_name=case.get("contact_name"), case_ref=case["ref"], subject=case["subject"],
                author_name=author.get("name") or "Our team", message=body, case_url=_customer_case_url(case),
            )
        else:
            assignee = await _user_email((case.get("assigned_to") or {}).get("id"))
            to = [assignee] if assignee else await _routing_for(case.get("category"))
            background_tasks.add_task(
                send_support_reply_internal, to, case_ref=case["ref"], case_id=str(case["_id"]),
                subject=case["subject"], customer_name=case.get("customer_name"), message=body,
            )
    return await col("support_cases").find_one({"_id": case["_id"]})


# ── Core: customer rating on a resolved case ─────────────────────────────────

async def _case_feedback_core(case: dict, rating: int, comment: Optional[str], by_name: str) -> dict:
    if case.get("status") not in ("resolved", "closed"):
        raise HTTPException(status_code=400, detail="You can rate a request once it has been resolved")
    if case.get("csat"):
        raise HTTPException(status_code=400, detail="Thank you, you have already rated this request")
    if rating not in (1, 2, 3, 4, 5):
        raise HTTPException(status_code=422, detail="Please choose a rating from 1 to 5")
    now = _now()
    sets = {"csat": {"rating": rating, "comment": (comment or "").strip()[:2000] or None, "by": by_name, "at": now},
            "updated_at": now}
    if case.get("status") == "resolved":
        sets.update({"status": "closed", "closed_at": now, "closed_reason": "confirmed_by_customer"})
    await col("support_cases").update_one({"_id": case["_id"]}, {"$set": sets})
    return await col("support_cases").find_one({"_id": case["_id"]})


# ── Order feedback ───────────────────────────────────────────────────────────

async def _order_feedback_eligible(order_id: int) -> bool:
    """Only once the order has actually been collected — rating an order
    still being packed would be rating the wait, not the order."""
    if await col("packing_board").find_one({"order_id": str(order_id), "status": "collected"}, {"_id": 1}):
        return True
    return bool(await col("tickets").find_one(
        {"order_id": {"$in": [str(order_id), order_id]}, "exit_status": "complete"}, {"_id": 1},
    ))


def _serialize_feedback(doc: Optional[dict]) -> Optional[dict]:
    if not doc:
        return None
    out = {k: v for k, v in doc.items() if k != "_id"}
    out["id"] = str(doc["_id"])
    return out


async def _submit_order_feedback_core(
    ctx: dict, rating: int, comment: Optional[str], submitted_by: dict,
    contact_email: Optional[str], background_tasks: BackgroundTasks,
) -> dict:
    if rating not in (1, 2, 3, 4, 5):
        raise HTTPException(status_code=422, detail="Please choose a rating from 1 to 5")
    if not await _order_feedback_eligible(ctx["order_id"]):
        raise HTTPException(status_code=400, detail="You can rate this order once it has been collected")
    if await col("order_feedback").find_one({"order_id": ctx["order_id"]}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="Thank you, feedback for this order has already been received")
    comment = (comment or "").strip()[:2000] or None
    now = _now()
    doc = {
        "order_id": ctx["order_id"], "order_name": ctx["order_name"],
        "customer_partner_id": ctx.get("customer_partner_id"), "customer_name": ctx.get("customer_name"),
        "rating": rating, "comment": comment, "submitted_by": submitted_by,
        "case_id": None, "created_at": now,
    }
    res = await col("order_feedback").insert_one(doc)
    doc["_id"] = res.inserted_id

    # A low rating is a service failure worth a human follow-up, so it opens
    # a case automatically rather than sitting unread in a report.
    if rating <= 2:
        case = await _create_case_core(
            background_tasks=background_tasks, category="feedback",
            subject=f"Low rating ({rating}/5) on order {ctx['order_name']}",
            body=comment or f"The customer rated this order {rating} out of 5 and did not leave a comment.",
            customer=ctx, contact_name=submitted_by.get("name"), contact_email=contact_email,
            raised_by={"id": submitted_by.get("id"), "name": submitted_by.get("name") or ctx.get("customer_name"),
                       "role": submitted_by.get("role") or "public"},
            source="order_feedback", priority="high", order=ctx,
        )
        await col("order_feedback").update_one({"_id": doc["_id"]}, {"$set": {"case_id": str(case["_id"]), "case_ref": case["ref"]}})
        doc["case_id"], doc["case_ref"] = str(case["_id"]), case["ref"]
    await audit_log("support.order_feedback", "order", str(ctx["order_id"]), entity_label=ctx["order_name"],
                    after={"rating": rating, "by": submitted_by.get("name")})
    return doc


# ══ Authenticated endpoints ══════════════════════════════════════════════════

@router.get("/meta")
async def support_meta(current_user: dict = Depends(_require_support_access)):
    return {
        "categories": [{"key": k, "label": v} for k, v in CATEGORIES.items()],
        "priorities": [{"key": k, "label": v, "target_hours": RESPONSE_TARGET_HOURS[k]} for k, v in PRIORITIES.items()],
        "statuses": [{"key": k, "label": v} for k, v in STATUSES.items()],
        "quality_outcomes": [{"key": k, "label": v} for k, v in QUALITY_OUTCOMES.items()],
    }


@router.get("/summary")
async def support_summary(current_user: dict = Depends(_require_support_access)):
    """Nav badge counts — what needs this viewer's attention right now."""
    if _is_external(current_user):
        scope = await _external_scope(current_user)
        return {"awaiting_your_reply": await col("support_cases").count_documents(
            {**scope, "status": {"$in": ["awaiting_customer", "resolved"]}})}
    waiting = await col("support_cases").find(
        {"status": {"$in": list(ACTIVE_STATUSES)}, "waiting_on": "staff"},
        {"priority": 1, "status": 1, "waiting_on": 1, "staff_clock_since": 1, "assigned_to": 1},
    ).to_list(1000)
    return {
        "waiting_on_us": len(waiting),
        "unassigned": sum(1 for c in waiting if not c.get("assigned_to")),
        "mine": sum(1 for c in waiting if (c.get("assigned_to") or {}).get("id") == current_user["id"]),
        "overdue": sum(1 for c in waiting if _sla(c)["age_tier"] == "overdue"),
    }


@router.get("/assignees")
async def list_assignees(current_user: dict = Depends(_require_support_access)):
    _require_perm(current_user, "view")
    users = await col("users").find(
        {"active": {"$ne": False}, "$or": [
            {"permissions.support.respond": True}, {"is_super_admin": True}, {"role": "super_admin"},
        ], "role": {"$nin": list(EXTERNAL_ROLES)}},
        {"name": 1, "username": 1, "role": 1},
    ).to_list(500)
    return [{"id": str(u["_id"]), "name": u.get("name") or u.get("username"), "role": u.get("role")} for u in users]


@router.get("/cases")
async def list_cases(
    status: Optional[str] = None,          # comma list, or "active"
    category: Optional[str] = None,
    assigned: Optional[str] = None,        # me | unassigned
    waiting_on: Optional[str] = None,      # staff | customer
    search: Optional[str] = None,
    customer_partner_id: Optional[int] = None,
    order_id: Optional[int] = None,
    skip: int = 0,
    limit: int = 50,
    current_user: dict = Depends(_require_support_access),
):
    external = _is_external(current_user)
    clauses: list = []
    if external:
        clauses.append(await _external_scope(current_user))
    if status:
        wanted = list(ACTIVE_STATUSES) if status == "active" else [s for s in status.split(",") if s in STATUSES]
        clauses.append({"status": {"$in": wanted}})
    if category in CATEGORIES:
        clauses.append({"category": category})
    if not external and assigned == "me":
        clauses.append({"assigned_to.id": current_user["id"]})
    elif not external and assigned == "unassigned":
        clauses.append({"assigned_to": None})
    if waiting_on in ("staff", "customer"):
        clauses.append({"waiting_on": waiting_on})
    if customer_partner_id:
        clauses.append({"customer_partner_id": customer_partner_id})
    if order_id:
        clauses.append({"order_id": order_id})
    if search and search.strip():
        rx = {"$regex": re.escape(search.strip()), "$options": "i"}
        clauses.append({"$or": [{"ref": rx}, {"subject": rx}, {"customer_name": rx},
                                {"order_name": rx}, {"invoice_name": rx}, {"contact_name": rx}]})
    query = {"$and": clauses} if clauses else {}
    limit = max(1, min(limit, 200))
    total = await col("support_cases").count_documents(query)
    rows = await col("support_cases").find(query, {"messages": 0}).sort("updated_at", -1).skip(max(skip, 0)).limit(limit).to_list(limit)
    return {"cases": [_serialize(r, external) for r in rows], "total": total}


@router.post("/cases")
async def create_case(
    background_tasks: BackgroundTasks,
    category: str = Form(...),
    subject: str = Form(...),
    body: str = Form(...),
    order_id: Optional[int] = Form(None),
    invoice_id: Optional[int] = Form(None),
    customer_partner_id: Optional[int] = Form(None),
    contact_name: Optional[str] = Form(None),
    contact_email: Optional[str] = Form(None),
    priority: Optional[str] = Form(None),
    product_name: Optional[str] = Form(None),
    lot_number: Optional[str] = Form(None),
    adverse_event: bool = Form(False),
    notify_customer: bool = Form(True),
    files: Optional[List[UploadFile]] = File(None),
    current_user: dict = Depends(_require_support_access),
):
    """Raise a request from the portal (customer/reseller), or log one on a
    customer's behalf (staff with support.respond)."""
    external = _is_external(current_user)
    if not external:
        _require_perm(current_user, "respond")
    odoo = get_odoo_client()
    order_ctx = invoice_ctx = None
    try:
        if invoice_id:
            invoice_ctx = _invoice_context(odoo, invoice_id)
        if order_id:
            order_ctx = _order_context(odoo, order_id)
        elif invoice_ctx and invoice_ctx.get("order_id"):
            order_ctx = {"order_id": invoice_ctx["order_id"], "order_name": invoice_ctx["order_name"]}
        if order_ctx and order_ctx.get("customer_partner_id"):
            customer = order_ctx
        elif invoice_ctx:
            customer = invoice_ctx
        elif external and current_user.get("role") == "customer":
            if not current_user.get("customer_company_partner_id"):
                raise HTTPException(status_code=403, detail="Your account has no active company")
            customer = _company_of(odoo, current_user["customer_company_partner_id"])
        elif customer_partner_id:
            customer = _company_of(odoo, customer_partner_id)
        else:
            raise HTTPException(status_code=422, detail="Please choose which customer this request is for")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("support_case_context_failed error=%s", exc)
        raise HTTPException(status_code=502, detail="We couldn't look up that order or customer right now. Please try again.")
    await _assert_owns_partner(current_user, customer.get("customer_partner_id"))

    if external:
        contact_name = _actor_name(current_user)
        contact_email = current_user.get("email") or (current_user.get("username") if "@" in (current_user.get("username") or "") else None)
        priority = None  # customers don't set priority — derived from category
        source = "portal"
    else:
        source = "staff"

    doc = await _create_case_core(
        background_tasks=background_tasks, category=category, subject=subject, body=body,
        customer=customer, contact_name=contact_name, contact_email=contact_email,
        raised_by={"id": current_user["id"], "name": _actor_name(current_user), "role": current_user.get("role")},
        source=source, priority=priority, order=order_ctx, invoice=invoice_ctx,
        product_name=product_name, lot_number=lot_number, adverse_event=adverse_event,
        files=files, notify_customer=notify_customer, actor_user=current_user,
    )
    return {"success": True, "case": _serialize(doc, external)}


@router.get("/cases/{case_id}")
async def get_case(case_id: str, current_user: dict = Depends(_require_support_access)):
    case = await _load_case_for(case_id, current_user)
    return _serialize(case, _is_external(current_user))


@router.post("/cases/{case_id}/messages")
async def post_message(
    case_id: str,
    background_tasks: BackgroundTasks,
    body: str = Form(...),
    internal: bool = Form(False),
    files: Optional[List[UploadFile]] = File(None),
    current_user: dict = Depends(_require_support_access),
):
    case = await _load_case_for(case_id, current_user)
    external = _is_external(current_user)
    if not external:
        _require_perm(current_user, "respond")
    updated = await _add_message_core(
        case, author={"id": current_user["id"], "name": _actor_name(current_user), "role": current_user.get("role")},
        is_staff=not external, internal=internal and not external, body=body, files=files,
        background_tasks=background_tasks, actor_user=current_user,
    )
    return _serialize(updated, external)


@router.put("/cases/{case_id}")
async def update_case(case_id: str, body: CaseUpdateBody, current_user: dict = Depends(_require_support_access)):
    _require_perm(current_user, "respond")
    case = await _load_case(case_id)
    if case.get("status") == "closed":
        raise HTTPException(status_code=400, detail="This request is closed")
    sets: dict = {}
    if body.status is not None:
        if body.status not in STAFF_SETTABLE_STATUSES:
            raise HTTPException(status_code=422, detail="Use Resolve or Close to finish a request")
        sets["status"] = body.status
        # Moving back to new/open puts the ball in our court again.
        if body.status in ("new", "open") and case.get("waiting_on") != "staff":
            sets.update({"waiting_on": "staff", "staff_clock_since": _now(), "escalated_at": None})
        elif body.status == "awaiting_customer":
            sets.update({"waiting_on": "customer", "staff_clock_since": None, "escalated_at": None})
        if case.get("status") == "resolved":
            sets["resolved_at"] = None
    if body.priority is not None:
        if body.priority not in PRIORITIES:
            raise HTTPException(status_code=422, detail="Unknown priority")
        sets["priority"] = body.priority
    if body.category is not None:
        if body.category not in CATEGORIES:
            raise HTTPException(status_code=422, detail="Unknown category")
        if case.get("category") == "product_quality" and body.category != "product_quality" and case.get("quality_review"):
            raise HTTPException(status_code=400, detail="A quality complaint that has been reviewed can't be recategorised")
        sets["category"] = body.category
    if not sets:
        return _serialize(case, False)
    before = {k: case.get(k) for k in sets if k in ("status", "priority", "category")}
    sets["updated_at"] = _now()
    await col("support_cases").update_one({"_id": case["_id"]}, {"$set": sets})
    await audit_log("support.case_updated", "support_case", case_id, entity_label=case.get("ref", ""),
                    user=current_user, before=before, after={k: sets[k] for k in before})
    return _serialize(await col("support_cases").find_one({"_id": case["_id"]}), False)


@router.post("/cases/{case_id}/assign")
async def assign_case(
    case_id: str, body: AssignBody, background_tasks: BackgroundTasks,
    current_user: dict = Depends(_require_support_access),
):
    """support.respond may take a request themselves (or release their own);
    assigning to anyone else needs support.manage."""
    _require_perm(current_user, "respond")
    case = await _load_case(case_id)
    target_id = (body.user_id or "").strip() or None
    current_owner = (case.get("assigned_to") or {}).get("id")
    if not _perm(current_user, "manage"):
        if target_id and target_id != current_user["id"]:
            raise HTTPException(status_code=403, detail="Only a support manager can assign requests to someone else")
        if not target_id and current_owner and current_owner != current_user["id"]:
            raise HTTPException(status_code=403, detail="Only a support manager can unassign someone else's request")
    assignee = None
    if target_id:
        try:
            u = await col("users").find_one({"_id": ObjectId(target_id)})
        except Exception:
            u = None
        if not u or u.get("active") is False or u.get("role") in EXTERNAL_ROLES:
            raise HTTPException(status_code=404, detail="User not found")
        if not (u.get("is_super_admin") or u.get("role") == "super_admin"
                or ((u.get("permissions") or {}).get("support") or {}).get("respond")):
            raise HTTPException(status_code=400, detail="That user doesn't have permission to respond to support requests")
        assignee = {"id": target_id, "name": u.get("name") or u.get("username")}
    await col("support_cases").update_one({"_id": case["_id"]}, {"$set": {"assigned_to": assignee, "updated_at": _now()}})
    await audit_log("support.case_assigned", "support_case", case_id, entity_label=case.get("ref", ""),
                    user=current_user, before={"assigned_to": case.get("assigned_to")}, after={"assigned_to": assignee})
    if assignee and target_id != current_user["id"]:
        background_tasks.add_task(
            send_support_case_assigned, await _user_email(target_id), case_ref=case["ref"], case_id=case_id,
            subject=case["subject"], customer_name=case.get("customer_name"), assigned_by=_actor_name(current_user),
        )
    return _serialize(await col("support_cases").find_one({"_id": case["_id"]}), False)


def _assert_quality_signoff(case: dict, user: dict) -> None:
    """GMP complaint handling: a product quality complaint can only be
    finished by QA/RP, and only after the review is on record."""
    if case.get("category") != "product_quality":
        return
    if not _perm(user, "quality_review"):
        raise HTTPException(status_code=403, detail="Only QA or the Responsible Pharmacist can resolve a product quality complaint")
    if not (case.get("quality_review") or {}).get("reviewed_at"):
        raise HTTPException(status_code=400, detail="Complete the quality review before resolving this complaint")


@router.post("/cases/{case_id}/resolve")
async def resolve_case(
    case_id: str, body: ResolveBody, background_tasks: BackgroundTasks,
    current_user: dict = Depends(_require_support_access),
):
    _require_perm(current_user, "respond")
    case = await _load_case(case_id)
    if case.get("status") not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail=f"This request is already {STATUSES.get(case['status'], case['status']).lower()}")
    _assert_quality_signoff(case, current_user)
    note = _clean_text(body.resolution_note, "resolution note", 3, 5000)
    now = _now()
    message = {
        "id": str(uuid.uuid4()),
        "author": {"id": current_user["id"], "name": _actor_name(current_user), "role": current_user.get("role")},
        "is_staff": True, "internal": False, "body": note, "attachments": [], "at": now, "kind": "resolution",
    }
    sets = {
        "status": "resolved", "waiting_on": "customer", "staff_clock_since": None, "escalated_at": None,
        "resolved_at": now, "updated_at": now, "last_message_at": now, "last_message_by_staff": True,
        "resolution": {"note": note, "by": _actor_name(current_user), "by_id": current_user["id"], "at": now},
    }
    if not case.get("first_response_at"):
        sets["first_response_at"] = now
    if not case.get("assigned_to"):
        sets["assigned_to"] = {"id": current_user["id"], "name": _actor_name(current_user)}
    await col("support_cases").update_one({"_id": case["_id"]},
                                          {"$set": sets, "$push": {"messages": message}, "$inc": {"message_count": 1}})
    await audit_log("support.case_resolved", "support_case", case_id, entity_label=case.get("ref", ""),
                    user=current_user, before={"status": case.get("status")}, after={"status": "resolved", "note": note})
    background_tasks.add_task(
        send_support_case_resolved, case.get("contact_email"), contact_name=case.get("contact_name"),
        case_ref=case["ref"], subject=case["subject"], resolution_note=note, case_url=_customer_case_url(case),
    )
    return _serialize(await col("support_cases").find_one({"_id": case["_id"]}), False)


@router.post("/cases/{case_id}/close")
async def close_case(case_id: str, body: CloseBody, current_user: dict = Depends(_require_support_access)):
    """Close without customer confirmation — duplicates, spam, or a resolved
    request the customer never came back to. support.manage only."""
    _require_perm(current_user, "manage")
    case = await _load_case(case_id)
    if case.get("status") == "closed":
        raise HTTPException(status_code=400, detail="This request is already closed")
    _assert_quality_signoff(case, current_user)
    now = _now()
    sets = {"status": "closed", "closed_at": now, "closed_reason": "closed_by_staff", "updated_at": now,
            "waiting_on": None, "staff_clock_since": None}
    push = {}
    if (body.note or "").strip():
        push = {"$push": {"messages": {
            "id": str(uuid.uuid4()),
            "author": {"id": current_user["id"], "name": _actor_name(current_user), "role": current_user.get("role")},
            "is_staff": True, "internal": True, "body": f"Closed: {body.note.strip()}", "attachments": [], "at": now,
        }}, "$inc": {"message_count": 1}}
    await col("support_cases").update_one({"_id": case["_id"]}, {"$set": sets, **push})
    await audit_log("support.case_closed", "support_case", case_id, entity_label=case.get("ref", ""),
                    user=current_user, before={"status": case.get("status")}, after={"status": "closed", "note": body.note})
    return _serialize(await col("support_cases").find_one({"_id": case["_id"]}), False)


@router.put("/cases/{case_id}/quality-review")
async def save_quality_review(case_id: str, body: QualityReviewBody, current_user: dict = Depends(_require_support_access)):
    _require_perm(current_user, "quality_review")
    case = await _load_case(case_id)
    if case.get("category") != "product_quality":
        raise HTTPException(status_code=400, detail="A quality review only applies to product quality complaints")
    if case.get("status") == "closed":
        raise HTTPException(status_code=400, detail="This complaint is closed")
    if body.outcome not in QUALITY_OUTCOMES:
        raise HTTPException(status_code=422, detail="Choose an outcome for the investigation")
    review = {
        "investigation_summary": _clean_text(body.investigation_summary, "investigation summary", 3, 5000),
        "root_cause": (body.root_cause or "").strip() or None,
        "outcome": body.outcome,
        "capa": (body.capa or "").strip() or None,
        "recall_required": body.recall_required,
        "recall_notes": (body.recall_notes or "").strip() or None,
        "reported_to_authority": body.reported_to_authority,
        "reviewed_by": _actor_name(current_user),
        "reviewed_by_id": current_user["id"],
        "reviewed_at": _now(),
    }
    await col("support_cases").update_one({"_id": case["_id"]}, {"$set": {"quality_review": review, "updated_at": _now()}})
    await audit_log("support.quality_review", "support_case", case_id, entity_label=case.get("ref", ""),
                    user=current_user, before=case.get("quality_review"), after=review)
    return _serialize(await col("support_cases").find_one({"_id": case["_id"]}), False)


@router.post("/cases/{case_id}/feedback")
async def rate_case(case_id: str, body: FeedbackBody, current_user: dict = Depends(_require_support_access)):
    if not _is_external(current_user):
        raise HTTPException(status_code=403, detail="Only the customer can rate a request")
    case = await _load_case_for(case_id, current_user)
    updated = await _case_feedback_core(case, body.rating, body.comment, _actor_name(current_user))
    return _serialize(updated, True)


@router.get("/cases/{case_id}/attachments/{attachment_id}")
async def download_attachment(case_id: str, attachment_id: str, current_user: dict = Depends(_require_support_access)):
    case = await _load_case_for(case_id, current_user)
    return await _attachment_url(case, attachment_id, external=_is_external(current_user))


async def _attachment_url(case: dict, attachment_id: str, external: bool) -> dict:
    for m in case.get("messages") or []:
        if external and m.get("internal"):
            continue
        for a in m.get("attachments") or []:
            if a.get("id") == attachment_id:
                return {"url": await r2_presign(a["r2_key"], expires=600), "filename": a.get("filename")}
    raise HTTPException(status_code=404, detail="File not found")


# ── Order feedback (authenticated) ───────────────────────────────────────────

@router.get("/order-feedback/order/{order_id}")
async def get_order_feedback(order_id: int, current_user: dict = Depends(_require_support_access)):
    if _is_external(current_user):
        try:
            ctx = _order_context(get_odoo_client(), order_id)
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(status_code=502, detail="We couldn't look up that order right now")
        await _assert_owns_partner(current_user, ctx.get("customer_partner_id"))
    fb = await col("order_feedback").find_one({"order_id": order_id})
    return {"feedback": _serialize_feedback(fb), "eligible": await _order_feedback_eligible(order_id)}


@router.post("/order-feedback")
async def submit_order_feedback(
    body: OrderFeedbackBody, background_tasks: BackgroundTasks,
    current_user: dict = Depends(_require_support_access),
):
    if not _is_external(current_user):
        raise HTTPException(status_code=403, detail="Order feedback is left by the customer")
    try:
        ctx = _order_context(get_odoo_client(), body.order_id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="We couldn't look up that order right now")
    await _assert_owns_partner(current_user, ctx.get("customer_partner_id"))
    email = current_user.get("email") or (current_user.get("username") if "@" in (current_user.get("username") or "") else None)
    doc = await _submit_order_feedback_core(
        ctx, body.rating, body.comment,
        {"id": current_user["id"], "name": _actor_name(current_user), "role": current_user.get("role")},
        email, background_tasks,
    )
    return {"feedback": _serialize_feedback(doc)}


@router.post("/order-feedback/request")
async def request_order_feedback(
    body: FeedbackRequestBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.sales", "support.respond")),
):
    """Staff email the customer a "How did we do?" link for a completed order
    (Phase 28, manual by design — product owner 2026-10-06: Bassani decides
    when to ask, rather than an automatic send at collection). Offered as the
    Next Step on a completed Sales ticket, and as Request/Resend in its
    Actions card. The link is the signed order link, so no portal login is
    needed to answer it. Recorded on the ticket (feedback_requested_at/by,
    Activity Log) so staff can see it was sent and is awaiting a response."""
    try:
        ticket = await col("tickets").find_one({"_id": ObjectId(body.ticket_id)})
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="This ticket has no order to ask about")
    order_id = int(ticket["order_id"])
    if not await _order_feedback_eligible(order_id):
        raise HTTPException(status_code=400, detail="Feedback can be requested once the order has been collected")
    if await col("order_feedback").find_one({"order_id": order_id}, {"_id": 1}):
        raise HTTPException(status_code=400, detail="The customer has already rated this order")

    try:
        ctx = _order_context(get_odoo_client(), order_id)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=502, detail="We couldn't look up that order right now")
    recipients = [r.strip().lower() for r in (body.recipients or []) if r and r.strip()]
    for r in recipients:
        if not _EMAIL_RE.match(r):
            raise HTTPException(status_code=422, detail=f"{r} is not a valid email address")
    if not recipients and ctx.get("customer_email"):
        recipients = [ctx["customer_email"].lower()]
    if not recipients:
        raise HTTPException(status_code=400, detail="The customer has no email address on file. Add a recipient to send the request.")
    url = order_help_url(order_id)
    background_tasks.add_task(
        send_order_feedback_request, recipients[0],
        customer_name=ctx.get("customer_name") or ticket.get("customer_name", ""),
        order_ref=ctx["order_name"], feedback_url=f"{url}?feedback=1" if url else None,
        cc=recipients[1:] or None,
    )
    now = _now()
    sent_to = ", ".join(recipients)
    await col("tickets").update_one({"_id": ticket["_id"]}, {
        "$set": {"feedback_requested_at": now, "feedback_requested_by": _actor_name(current_user),
                 "updated_at": now},
        "$inc": {"feedback_request_count": 1},
        "$push": {"stage_history": {
            "status": ticket.get("status"), "exit_status": ticket.get("exit_status"),
            "actor_id": current_user["id"], "actor_name": _actor_name(current_user), "at": now,
            "note": f"Customer feedback requested (sent to {sent_to})",
        }},
    })
    await audit_log("support.feedback_requested", "ticket", body.ticket_id,
                    entity_label=ctx["order_name"], user=current_user, after={"sent_to": recipients})
    return {"success": True, "sent_to": recipients, "feedback_requested_at": now}


@router.get("/order-feedback")
async def list_order_feedback(
    days: int = 90,
    max_rating: Optional[int] = None,
    customer_partner_id: Optional[int] = None,
    current_user: dict = Depends(_require_support_access),
):
    """Staff report: recent order ratings plus the headline numbers."""
    _require_perm(current_user, "view")
    query: dict = {"created_at": {"$gte": _now() - timedelta(days=max(1, min(days, 730)))}}
    if customer_partner_id:
        query["customer_partner_id"] = customer_partner_id
    rows = await col("order_feedback").find(query).sort("created_at", -1).to_list(2000)
    dist = {str(i): 0 for i in range(1, 6)}
    for r in rows:
        dist[str(r["rating"])] = dist.get(str(r["rating"]), 0) + 1
    count = len(rows)
    avg = round(sum(r["rating"] for r in rows) / count, 2) if count else None
    listed = [r for r in rows if max_rating is None or r["rating"] <= max_rating][:500]
    return {
        "items": [_serialize_feedback(r) for r in listed],
        "stats": {"count": count, "average": avg, "distribution": dist,
                  "satisfied_pct": round(100 * sum(1 for r in rows if r["rating"] >= 4) / count) if count else None,
                  "low_count": sum(1 for r in rows if r["rating"] <= 2)},
    }


# ══ Public (signed-link) endpoints — customers without a portal login ═══════

def _order_from_token(token: str) -> int:
    order_id = verify_order_token(token)
    if not order_id:
        raise HTTPException(status_code=404, detail="This link is invalid or has expired. Please contact us for a new one.")
    return order_id


async def _case_from_token(token: str) -> dict:
    case_id = verify_case_token(token)
    if not case_id:
        raise HTTPException(status_code=404, detail="This link is invalid or has expired. Please contact us for a new one.")
    return await _load_case(case_id)


def _public_order_ctx(order_id: int, include_lines: bool = False) -> dict:
    try:
        return _order_context(get_odoo_client(), order_id, include_lines=include_lines)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("support_public_order_lookup_failed order_id=%s error=%s", order_id, exc)
        raise HTTPException(status_code=502, detail="We couldn't load your order right now. Please try again shortly.")


@public_router.get("/order/{token}")
@limiter.limit("60/minute")
async def public_order(request: Request, token: str):
    order_id = _order_from_token(token)
    ctx = _public_order_ctx(order_id, include_lines=True)
    cases = await col("support_cases").find(
        {"order_id": order_id}, {"ref": 1, "subject": 1, "status": 1, "created_at": 1, "category": 1},
    ).sort("created_at", -1).to_list(50)
    fb = await col("order_feedback").find_one({"order_id": order_id})
    return {
        "order": {"name": ctx["order_name"], "date": ctx.get("date_order"),
                  "customer_name": ctx.get("customer_name"), "lines": ctx.get("lines", [])},
        "cases": [{"ref": c["ref"], "subject": c["subject"], "status": c["status"],
                   "status_label": STATUSES.get(c["status"]), "category_label": CATEGORIES.get(c.get("category")),
                   "created_at": c["created_at"], "case_token": make_case_token(str(c["_id"]))} for c in cases],
        "feedback": {"rating": fb["rating"], "created_at": fb["created_at"]} if fb else None,
        "feedback_eligible": await _order_feedback_eligible(order_id),
        "categories": [{"key": k, "label": v} for k, v in CATEGORIES.items() if k != "feedback"],
    }


@public_router.post("/order/{token}/cases")
@limiter.limit("10/hour")
async def public_create_case(
    request: Request,
    token: str,
    background_tasks: BackgroundTasks,
    category: str = Form(...),
    subject: str = Form(...),
    body: str = Form(...),
    contact_name: str = Form(...),
    contact_email: str = Form(...),
    product_name: Optional[str] = Form(None),
    lot_number: Optional[str] = Form(None),
    adverse_event: bool = Form(False),
    files: Optional[List[UploadFile]] = File(None),
):
    order_id = _order_from_token(token)
    if category == "feedback":
        category = "general"
    name = _clean_text(contact_name, "name", 2, 120)
    email = (contact_email or "").strip().lower()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address so we can reply to you")
    ctx = _public_order_ctx(order_id)
    doc = await _create_case_core(
        background_tasks=background_tasks, category=category, subject=subject, body=body,
        customer=ctx, contact_name=name, contact_email=email,
        raised_by={"id": None, "name": name, "role": "public"}, source="email_link",
        order=ctx, product_name=product_name, lot_number=lot_number, adverse_event=adverse_event, files=files,
    )
    return {"success": True, "ref": doc["ref"], "case_token": make_case_token(str(doc["_id"]))}


@public_router.post("/order/{token}/feedback")
@limiter.limit("10/hour")
async def public_order_feedback(request: Request, token: str, body: PublicOrderFeedbackBody, background_tasks: BackgroundTasks):
    order_id = _order_from_token(token)
    email = (body.contact_email or "").strip().lower() or None
    if email and not _EMAIL_RE.match(email):
        raise HTTPException(status_code=422, detail="Please enter a valid email address")
    ctx = _public_order_ctx(order_id)
    name = (body.contact_name or "").strip()[:120] or ctx.get("customer_name")
    doc = await _submit_order_feedback_core(
        ctx, body.rating, body.comment, {"id": None, "name": name, "role": "public"},
        email or ctx.get("customer_email"), background_tasks,
    )
    return {"success": True, "rating": doc["rating"], "case_ref": doc.get("case_ref")}


@public_router.get("/case/{token}")
@limiter.limit("60/minute")
async def public_case(request: Request, token: str):
    case = await _case_from_token(token)
    out = _serialize(case, external=True)
    out.pop("contact_email", None)
    return out


@public_router.post("/case/{token}/messages")
@limiter.limit("30/hour")
async def public_case_message(
    request: Request,
    token: str,
    background_tasks: BackgroundTasks,
    body: str = Form(...),
    files: Optional[List[UploadFile]] = File(None),
):
    case = await _case_from_token(token)
    updated = await _add_message_core(
        case, author={"id": None, "name": case.get("contact_name") or "Customer", "role": "public"},
        is_staff=False, internal=False, body=body, files=files, background_tasks=background_tasks,
    )
    out = _serialize(updated, external=True)
    out.pop("contact_email", None)
    return out


@public_router.post("/case/{token}/feedback")
@limiter.limit("10/hour")
async def public_case_feedback(request: Request, token: str, body: FeedbackBody):
    case = await _case_from_token(token)
    updated = await _case_feedback_core(case, body.rating, body.comment, case.get("contact_name") or "Customer")
    out = _serialize(updated, external=True)
    out.pop("contact_email", None)
    return out


@public_router.get("/case/{token}/attachments/{attachment_id}")
@limiter.limit("60/minute")
async def public_case_attachment(request: Request, token: str, attachment_id: str):
    case = await _case_from_token(token)
    return await _attachment_url(case, attachment_id, external=True)


# ══ Scheduled job (registered in services/scheduler.py) ══════════════════════

async def run_support_sla_checks() -> None:
    """Hourly: (1) escalate requests waiting on us past their response target,
    once per waiting period (escalated_at resets whenever we reply);
    (2) auto-close requests resolved more than AUTO_CLOSE_DAYS ago that the
    customer never came back to."""
    now = _now()
    waiting = await col("support_cases").find(
        {"status": {"$in": list(ACTIVE_STATUSES)}, "waiting_on": "staff", "escalated_at": None},
        {"ref": 1, "customer_name": 1, "priority": 1, "status": 1, "waiting_on": 1,
         "staff_clock_since": 1, "assigned_to": 1, "category": 1},
    ).to_list(1000)
    overdue = [c for c in waiting if _sla(c)["age_tier"] == "overdue"]
    if overdue:
        routing = await get_email_routing()
        to = [e.lower() for e in routing.get("support_escalation_to") or []]
        if not to:
            for cat in {c.get("category") for c in overdue}:
                to += await _routing_for(cat)
        for c in overdue:
            email = await _user_email((c.get("assigned_to") or {}).get("id"))
            if email:
                to.append(email.lower())
        to = list(dict.fromkeys(to))
        items = [{"case_ref": c["ref"], "case_id": str(c["_id"]), "customer_name": c.get("customer_name"),
                  "priority_label": PRIORITIES.get(c.get("priority"), "Normal"),
                  "hours_waiting": _sla(c)["hours_elapsed"] or 0} for c in overdue]
        try:
            send_support_sla_escalation(to, items)
        except Exception as exc:
            logger.warning("support_escalation_send_failed error=%s", exc)
        await col("support_cases").update_many(
            {"_id": {"$in": [c["_id"] for c in overdue]}}, {"$set": {"escalated_at": now}},
        )

    res = await col("support_cases").update_many(
        # Safe for quality complaints too: resolving one already required the
        # QA/RP review on record (_assert_quality_signoff).
        {"status": "resolved", "resolved_at": {"$lt": now - timedelta(days=AUTO_CLOSE_DAYS)}},
        {"$set": {"status": "closed", "closed_at": now, "closed_reason": "auto_closed", "waiting_on": None,
                  "updated_at": now}},
    )
    if res.modified_count:
        logger.info("support_auto_closed count=%s", res.modified_count)
