"""
Customer support desk (Phase 28, moved onto Odoo Helpdesk in 28.6) —
queries, complaints and order feedback.

One queue, three ways in:
  - Portal users (customer / reseller roles) raise and follow up on requests
    inside the portal (`router`, /api/support).
  - Customers WITHOUT a portal login use signed links embedded in the emails
    they already receive (`public_router`, /api/public/support), and can reply
    to support emails directly once inbound email is switched on
    (run_support_inbound_sync).
  - Staff log a request on a customer's behalf (phone call, walk-in, email).

Odoo is the record (28.6, product owner 2026-10-15). Every request is an
Odoo `helpdesk.ticket` on the team of the company it concerns: subject,
customer, linked sales order, stage, priority, type (a tag), the whole
conversation incl. internal notes (chatter), files (ir.attachment) and the
customer's rating (rating.rating). A product quality complaint's
investigation is an Odoo Quality alert. All Odoo I/O goes through
services/helpdesk_odoo.py.

`support_case_meta` (Mongo, keyed by the Odoo ticket id) holds only what
Odoo has no field for: the portal assignee (handlers are portal users, not
licensed Odoo users), who raised it and how to reach them (writing a
contact's email onto the ticket would overwrite the customer's own Odoo
email), the response-target clock, the portal author of each message, and
the structured quality review answers that have no Quality alert field.
Closed vs resolved: both sit in Odoo's Solved stage; `closed_at` says which.
A request closed without being resolved is Cancelled.

Every entry point creates requests through _create_case_core() and posts
messages through _add_message_core(), so status, clock and notifications
can never drift between them. Odoo never emails the customer: the portal
sends every support email itself.
"""
import logging
import os
import re
from email.utils import parseaddr
from datetime import datetime, timedelta, timezone
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel

from auth import ADMIN_ROLES, PRODUCTION_ROLES, TICKET_ROLES, get_current_user, require_any_permission
from config import get_settings
from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from ownership import get_owned_partner_ids, is_partner_owned_by
from rate_limit import limiter
from routes.settings_routes import get_email_routing
from services import helpdesk_odoo as hd
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
from support_links import case_help_url, make_case_token, order_help_url, verify_case_token, verify_order_token
from warehouse_context import _get_global_default_warehouse_id, get_company_id

router = APIRouter(prefix="/api/support", tags=["support"])
public_router = APIRouter(prefix="/api/public/support", tags=["support-public"])
logger = logging.getLogger(__name__)
settings = get_settings()

META = "support_case_meta"


# ── Constants ────────────────────────────────────────────────────────────────

CATEGORIES = {
    "order":           "Order or delivery query",
    "invoice":         "Invoice or payment query",
    "product_quality": "Product quality complaint",
    "account":         "Account or details",
    "feedback":        "Feedback",
    "general":         "General query",
}
CATEGORY_BY_LABEL = {v.lower(): k for k, v in CATEGORIES.items()}
ADVERSE_TAG = "Adverse reaction"
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
ODOO_DOWN = "We couldn't reach our support system just now. Please try again in a moment."


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


def _user_email_of(user: dict) -> Optional[str]:
    return user.get("email") or (user.get("username") if "@" in (user.get("username") or "") else None)


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
    customers' requests inside each endpoint)."""
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


async def _external_partner_ids(user: dict) -> list:
    """The customer companies an external viewer may see: a customer login
    its active company (same company-level sharing as orders/invoices), a
    reseller every customer it owns (7.13 ownership)."""
    if user.get("role") == "customer":
        return [user.get("customer_company_partner_id") or -1]
    rid = await _reseller_id_for(user)
    return list(await get_owned_partner_ids(rid)) if rid else [-1]


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


# ── Odoo context resolution (read-only) ──────────────────────────────────────

_m2o_id = hd.m2o_id


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
    rows = odoo.read("sale.order", [int(order_id)], fields=["name", "partner_id", "date_order", "order_line", "company_id"])
    if not rows:
        raise HTTPException(status_code=404, detail="Order not found")
    o = rows[0]
    partner_id = _m2o_id(o.get("partner_id"))
    ctx = {"order_id": int(order_id), "order_name": o.get("name") or f"#{order_id}",
           "date_order": o.get("date_order") or None, "company_id": _m2o_id(o.get("company_id"))}
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
    rows = odoo.read("account.move", [int(invoice_id)], fields=["name", "partner_id", "invoice_origin", "company_id"])
    if not rows:
        raise HTTPException(status_code=404, detail="Invoice not found")
    inv = rows[0]
    partner_id = _m2o_id(inv.get("partner_id"))
    name = inv.get("name")
    ctx = {"invoice_id": int(invoice_id), "invoice_name": name if name and name is not False else f"#{invoice_id}",
           "company_id": _m2o_id(inv.get("company_id"))}
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


async def _default_company_id() -> Optional[int]:
    """Company for a request about no specific order or invoice: the company
    of the portal's default warehouse (Architecture Principle #6)."""
    try:
        return get_company_id(get_odoo_client(), await _get_global_default_warehouse_id())
    except Exception:
        return None


# ── Case assembly: Odoo ticket + portal meta → the API shape ─────────────────

def _parse_dt(val) -> Optional[datetime]:
    if not val or val is False:
        return None
    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(val).replace("Z", "").replace(" ", "T")).replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _ref(ticket: dict) -> str:
    ref = ticket.get("ticket_ref")
    return f"#{ref}" if ref and ref is not False else f"#{ticket['id']}"


def _category_from(ticket: dict, meta: dict, tags: dict) -> str:
    for tid in ticket.get("tag_ids") or []:
        key = CATEGORY_BY_LABEL.get((tags.get(tid) or "").lower())
        if key:
            return key
    return meta.get("category") or "general"


def _status_of(ticket: dict, meta: dict) -> str:
    return hd.status_for_stage(_m2o_id(ticket.get("stage_id")), bool(meta.get("closed_at")))


def _waiting_on(status: str) -> Optional[str]:
    if status in ("new", "open"):
        return "staff"
    if status in ("awaiting_customer", "resolved"):
        return "customer"
    return None


def _clock_since(ticket: dict, meta: dict) -> Optional[datetime]:
    return meta.get("staff_clock_since") or _parse_dt(ticket.get("create_date"))


def _sla(status: str, priority: str, clock_since) -> dict:
    """Response-target tier — only while the request is waiting on US. Same
    tier thresholds as the order pipeline (services/age_tier.py)."""
    if _waiting_on(status) == "staff" and clock_since:
        return age_fields(clock_since, RESPONSE_TARGET_HOURS.get(priority, 24))
    return {"age_tier": None, "hours_elapsed": None, "deadline_hours": None}


def _assemble(ticket: dict, meta: dict, tags: dict, external: bool, messages: Optional[list] = None) -> dict:
    meta = meta or {}
    status = _status_of(ticket, meta)
    priority = hd.PRIORITY_FROM_ODOO.get(str(ticket.get("priority")), "normal")
    category = _category_from(ticket, meta, tags)
    commercial = _m2o_id(ticket.get("commercial_partner_id")) or _m2o_id(ticket.get("partner_id"))
    out = {
        "id": str(ticket["id"]),
        "odoo_ticket_id": ticket["id"],
        "ref": _ref(ticket),
        "subject": ticket.get("name") or "",
        "category": category,
        "category_label": CATEGORIES.get(category, "General query"),
        "priority": priority,
        "priority_label": PRIORITIES.get(priority, "Normal"),
        "status": status,
        "status_label": STATUSES.get(status, status),
        "waiting_on": _waiting_on(status),
        "source": meta.get("source") or "odoo",
        "customer_partner_id": meta.get("customer_partner_id") or commercial,
        "customer_name": meta.get("customer_name") or hd.m2o_name(ticket.get("commercial_partner_id"))
                         or hd.m2o_name(ticket.get("partner_id")) or "",
        "contact_name": meta.get("contact_name") or hd.m2o_name(ticket.get("partner_id")) or "",
        "contact_email": meta.get("contact_email"),
        "raised_by": meta.get("raised_by"),
        "order_id": _m2o_id(ticket.get("sale_order_id")) or meta.get("order_id"),
        "order_name": hd.m2o_name(ticket.get("sale_order_id")) or meta.get("order_name"),
        "invoice_id": meta.get("invoice_id"),
        "invoice_name": meta.get("invoice_name"),
        "sales_ticket_id": meta.get("sales_ticket_id"),
        "product_name": meta.get("product_name"),
        "lot_number": meta.get("lot_number"),
        "adverse_event": bool(meta.get("adverse_event")),
        "assigned_to": meta.get("assigned_to"),
        "message_count": meta.get("message_count"),
        "last_message_at": meta.get("last_message_at"),
        "first_response_at": meta.get("first_response_at"),
        "resolved_at": meta.get("resolved_at"),
        "closed_at": meta.get("closed_at"),
        "resolution": meta.get("resolution"),
        "quality_review": meta.get("quality_review"),
        "quality_alert_id": meta.get("quality_alert_id"),
        "csat": meta.get("csat"),
        "created_at": hd.odoo_dt(ticket.get("create_date")),
        "updated_at": hd.odoo_dt(ticket.get("write_date")),
    }
    if messages is not None:
        authors = meta.get("authors") or {}
        msgs = []
        for m in messages:
            if external and m["internal"]:
                continue
            a = authors.get(str(m["id"])) or {}
            is_staff = a.get("is_staff") if a else m["message_type"] != "email"
            msgs.append({
                "id": str(m["id"]),
                "author": {"id": a.get("id"), "name": a.get("name") or m["author_name"],
                           "role": a.get("role") or ("staff" if is_staff else "customer")},
                "is_staff": bool(is_staff),
                "internal": m["internal"],
                "body": m["body"],
                "attachments": m["attachments"],
                "at": m["at"],
                "kind": a.get("kind"),
            })
        out["messages"] = msgs
        out["message_count"] = len(msgs)
    if external:
        for k in ("quality_review", "quality_alert_id", "assigned_to"):
            out.pop(k, None)
    else:
        out.update(_sla(status, priority, _clock_since(ticket, meta)))
    return out


async def _metas(ids: list) -> dict:
    if not ids:
        return {}
    return {d["_id"]: d async for d in col(META).find({"_id": {"$in": ids}}, {"authors": 0})}


async def _meta_set(ticket_id: int, sets: dict, unset: Optional[list] = None) -> None:
    upd = {"$set": {**sets, "updated_at": _now()}}
    if unset:
        upd["$unset"] = {k: "" for k in unset}
    await col(META).update_one({"_id": ticket_id}, upd, upsert=True)


def _ticket_id(case_id) -> int:
    try:
        return int(str(case_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Request not found")


def _odoo(fn, *args, **kwargs):
    """Run an Odoo call, turning a connection or Odoo fault into a clean 502."""
    try:
        return fn(*args, **kwargs)
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("support_odoo_failed fn=%s error=%s", getattr(fn, "__name__", fn), exc)
        raise HTTPException(status_code=502, detail=ODOO_DOWN)


async def _load(case_id) -> tuple:
    """(ticket, meta) for one request, or 404."""
    tid = _ticket_id(case_id)
    rows = _odoo(hd.read_tickets, [tid])
    if not rows:
        raise HTTPException(status_code=404, detail="Request not found")
    meta = await col(META).find_one({"_id": tid}) or {"_id": tid}
    return rows[0], meta


async def _load_for(case_id, user: dict) -> tuple:
    ticket, meta = await _load(case_id)
    customer = meta.get("customer_partner_id") or _m2o_id(ticket.get("commercial_partner_id")) \
        or _m2o_id(ticket.get("partner_id"))
    await _assert_owns_partner(user, customer)
    return ticket, meta


async def _detail(case_id, external: bool) -> dict:
    ticket, meta = await _load(case_id)
    messages = _odoo(hd.read_messages, ticket["id"])
    return _assemble(ticket, meta, _odoo(hd.tag_names, ticket.get("tag_ids") or []), external, messages)


# ── Shared helpers ───────────────────────────────────────────────────────────

async def _read_files(files: Optional[List[UploadFile]]) -> list:
    """Validates every file before anything is sent to Odoo."""
    files = [f for f in (files or []) if f is not None and (f.filename or "").strip()]
    if not files:
        return []
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=422, detail=f"You can attach up to {MAX_FILES} files at a time")
    out = []
    for f in files:
        ext = os.path.splitext(f.filename)[1].lower()
        if ext not in ALLOWED_EXT:
            raise HTTPException(status_code=422, detail=f"{f.filename}: this file type isn't supported")
        data = await f.read()
        if not data:
            raise HTTPException(status_code=422, detail=f"{f.filename} is empty")
        if len(data) > MAX_FILE_BYTES:
            raise HTTPException(status_code=422, detail=f"{f.filename} is larger than 8MB")
        out.append({"filename": f.filename, "data": data, "content_type": f.content_type})
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


def _customer_case_url(ticket_id: int, meta: dict) -> str:
    """Portal deep link when the request was raised from a portal login;
    otherwise the signed no-login link (works for portal users too)."""
    if meta.get("source") == "portal":
        return f"{settings.portal_url}/support?case={ticket_id}"
    return case_help_url(str(ticket_id))


def _staff_email_from(user: dict) -> str:
    return f'"{_actor_name(user)} (Bassani Health)" <{_user_email_of(user) or settings.support_email}>'


def _author_kwargs(author: dict, user: Optional[dict] = None, email: Optional[str] = None) -> dict:
    """How a message is attributed in Odoo's chatter. A customer login posts
    as its own Odoo contact; staff and no-login customers by name."""
    if author.get("partner_id"):
        return {"author_partner_id": author["partner_id"]}
    if author.get("is_staff") and user:
        return {"email_from": _staff_email_from(user)}
    addr = email or settings.support_email
    return {"email_from": f'"{author.get("name") or "Customer"}" <{addr}>'}


async def _push_ticket_activity(ticket_id, actor_name: str, note: str) -> None:
    """Note-only stage_history entry on the linked Sales ticket, so its
    Activity Log shows a customer raised a request on that order."""
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


def _tags_for(category: str, adverse: bool) -> list:
    ids = [hd.tag_id(CATEGORIES[category])]
    if adverse:
        ids.append(hd.tag_id(ADVERSE_TAG))
    return ids


def _note_safe(ticket_id: int, company_id: Optional[int], body: str) -> None:
    """Best-effort internal note so the request's history also reads
    correctly for anyone looking at it in Odoo."""
    try:
        hd.post_message(ticket_id, company_id, body=body, internal=True,
                        email_from=f'"Bassani Health portal" <{settings.support_email}>')
    except Exception as exc:
        logger.warning("support_note_failed ticket=%s error=%s", ticket_id, exc)


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
    raised_by: dict,              # {id, name, role, partner_id?}
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
    """Creates the Odoo helpdesk ticket and its first message, then the
    portal meta. Returns {id, ref, ...} for the caller."""
    if category not in CATEGORIES:
        raise HTTPException(status_code=422, detail="Please choose what your request is about")
    subject = _clean_text(subject, "subject", 3, 200)
    body = _clean_text(body, "message", 1, 5000)
    if contact_email and not _EMAIL_RE.match(contact_email.strip()):
        raise HTTPException(status_code=422, detail="Please enter a valid email address")
    adverse_event = bool(adverse_event) and category == "product_quality"
    if priority not in PRIORITIES:
        priority = "urgent" if adverse_event else ("high" if category == "product_quality" else "normal")
    staged = await _read_files(files)
    now = _now()

    order_id = (order or {}).get("order_id") or (invoice or {}).get("order_id")
    order_name = (order or {}).get("order_name") or (invoice or {}).get("order_name")
    company_id = (order or {}).get("company_id") or (invoice or {}).get("company_id") or await _default_company_id()
    contact_name = (contact_name or "").strip() or customer.get("customer_name") or ""
    contact_email = (contact_email or "").strip().lower() or customer.get("customer_email") or None
    product_name = (product_name or "").strip() or None
    lot_number = (lot_number or "").strip() or None

    sales_ticket = None
    if order_id:
        sales_ticket = await col("tickets").find_one(
            {"order_id": {"$in": [str(order_id), order_id]}},
            {"_id": 1, "assigned_to": 1}, sort=[("created_at", -1)],
        )

    # Description: everything an Odoo user needs to read the request without
    # the portal. The conversation itself lives in the chatter.
    facts = [("Type", CATEGORIES[category]), ("Raised by", raised_by.get("name")),
             ("Contact", f"{contact_name} <{contact_email}>" if contact_email else contact_name),
             ("Order", order_name), ("Invoice", (invoice or {}).get("invoice_name")),
             ("Product", product_name), ("Batch / lot", lot_number),
             ("Possible adverse reaction", "YES, urgent QA/RP review" if adverse_event else None),
             ("Received via", {"portal": "Portal", "staff": "Logged by staff", "email_link": "Customer email link",
                               "order_feedback": "Low order rating"}.get(source, source))]
    description = "".join(f"<p><b>{k}:</b> {hd.escape(str(v))}</p>" for k, v in facts if v) \
        + "<hr/>" + hd.text_to_html(body)

    is_staff_author = raised_by.get("role") not in (EXTERNAL_ROLES | {"public"})
    try:
        tags = _tags_for(category, adverse_event)
        ticket_partner = raised_by.get("partner_id") or customer.get("customer_partner_id")
        tid = hd.create_ticket(company_id=company_id, subject=subject, description_html=description,
                               partner_id=ticket_partner, priority=priority, tag_ids=tags,
                               sale_order_id=int(order_id) if order_id else None)
    except Exception as exc:
        logger.warning("support_ticket_create_failed error=%s", exc)
        raise HTTPException(status_code=502, detail=ODOO_DOWN)

    thread_ref = None
    authors = {}
    try:
        posted = hd.post_message(
            tid, company_id, body=body, internal=False, files=staged,
            **_author_kwargs({**raised_by, "is_staff": is_staff_author}, actor_user, contact_email))
        thread_ref = posted["message_id"]
        authors[str(posted["id"])] = {"id": raised_by.get("id"), "name": raised_by.get("name"),
                                      "role": raised_by.get("role"), "is_staff": is_staff_author}
    except Exception as exc:
        # The request text is already in the ticket description; only the
        # chatter copy (and any files) are missing.
        logger.warning("support_first_message_failed ticket=%s error=%s", tid, exc)

    try:
        ticket = (hd.read_tickets([tid]) or [{"id": tid}])[0]
    except Exception:
        ticket = {"id": tid}
    ref = _ref(ticket)
    meta = {
        "_id": tid, "ref": ref, "company_id": company_id, "category": category, "source": source,
        "customer_partner_id": customer.get("customer_partner_id"),
        "customer_name": customer.get("customer_name") or "",
        "contact_name": contact_name, "contact_email": contact_email,
        "raised_by": {"id": raised_by.get("id"), "name": raised_by.get("name"), "role": raised_by.get("role")},
        "order_id": order_id, "order_name": order_name,
        "invoice_id": (invoice or {}).get("invoice_id"), "invoice_name": (invoice or {}).get("invoice_name"),
        "sales_ticket_id": str(sales_ticket["_id"]) if sales_ticket else None,
        "product_name": product_name, "lot_number": lot_number, "adverse_event": adverse_event,
        "assigned_to": None, "authors": authors, "thread_ref": thread_ref,
        "message_count": 1, "last_message_at": now, "last_message_by_staff": is_staff_author,
        "first_response_at": None, "staff_clock_since": now, "escalated_at": None,
        "resolved_at": None, "closed_at": None, "resolution": None, "quality_review": None, "csat": None,
        "created_at": now, "updated_at": now,
    }
    await col(META).replace_one({"_id": tid}, meta, upsert=True)

    await audit_log(
        "support.case_created", "support_case", str(tid), entity_label=ref, user=actor_user,
        after={"category": category, "priority": priority, "customer": meta["customer_name"],
               "order": order_name, "source": source, "adverse_event": adverse_event, "odoo_ticket_id": tid},
    )
    if sales_ticket:
        await _push_ticket_activity(sales_ticket["_id"], raised_by.get("name") or "Customer",
                                    f"Support request {ref} raised: {subject}")

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
        case_ref=ref, case_id=str(tid), subject=subject,
        customer_name=meta["customer_name"], category_label=CATEGORIES[category],
        priority_label=PRIORITIES[priority], raised_by=raised_by.get("name") or contact_name,
        message=body, order_ref=order_name, adverse_event=adverse_event,
    )
    if notify_customer and contact_email and source != "order_feedback":
        background_tasks.add_task(
            send_support_case_received, contact_email,
            contact_name=contact_name, case_ref=ref, subject=subject,
            category_label=CATEGORIES[category], case_url=_customer_case_url(tid, meta), thread_ref=thread_ref,
        )
    return {"id": tid, "ref": ref}


# ── Core: add message ────────────────────────────────────────────────────────

async def _add_message_core(
    ticket: dict,
    meta: dict,
    *,
    author: dict,
    is_staff: bool,
    internal: bool,
    body: str,
    files: Optional[List[UploadFile]],
    background_tasks: BackgroundTasks,
    actor_user: Optional[dict] = None,
) -> None:
    status = _status_of(ticket, meta)
    if status == "closed":
        raise HTTPException(status_code=400, detail="This request is closed. Please raise a new request if you still need help.")
    body = _clean_text(body, "message", 1, 5000)
    internal = bool(internal) and is_staff
    staged = await _read_files(files)
    tid, company_id = ticket["id"], meta.get("company_id") or _m2o_id(ticket.get("company_id"))
    now = _now()

    posted = _odoo(hd.post_message, tid, company_id, body=body, internal=internal, files=staged,
                   **_author_kwargs({**author, "is_staff": is_staff}, actor_user, meta.get("contact_email")))

    sets: dict = {f"authors.{posted['id']}": {"id": author.get("id"), "name": author.get("name"),
                                              "role": author.get("role"), "is_staff": is_staff}}
    if not internal:
        sets.update({"last_message_at": now, "last_message_by_staff": is_staff})
    new_status = None
    reopened = False
    if is_staff and not internal:
        # A public staff reply hands the ball to the customer: clock stops.
        new_status = "awaiting_customer"
        sets.update({"staff_clock_since": None, "escalated_at": None})
        if not meta.get("first_response_at"):
            sets["first_response_at"] = now
        if not meta.get("assigned_to") and author.get("id"):
            sets["assigned_to"] = {"id": author["id"], "name": author.get("name")}
    elif not is_staff:
        if status in ("awaiting_customer", "resolved"):
            reopened = status == "resolved"
            new_status = "open"
            sets["resolved_at"] = None
        if _waiting_on(status) != "staff":
            sets.update({"staff_clock_since": now, "escalated_at": None})
    if new_status and new_status != status:
        _odoo(hd.set_status, tid, company_id, new_status)
    await col(META).update_one({"_id": tid}, {"$set": {**sets, "updated_at": now}, "$inc": {"message_count": 1}},
                               upsert=True)

    action = "support.internal_note" if internal else ("support.reply" if is_staff else "support.customer_reply")
    if is_staff or reopened:
        await audit_log(
            "support.reopened" if reopened else action, "support_case", str(tid),
            entity_label=_ref(ticket), user=actor_user,
            before={"status": status}, after={"status": new_status or status},
        )

    if not internal:
        if is_staff:
            background_tasks.add_task(
                send_support_reply_customer, meta.get("contact_email"),
                contact_name=meta.get("contact_name"), case_ref=_ref(ticket), subject=ticket.get("name") or "",
                author_name=author.get("name") or "Our team", message=body,
                case_url=_customer_case_url(tid, meta), thread_ref=posted.get("message_id"),
            )
        else:
            await _notify_customer_reply(ticket, meta, body, background_tasks)


async def _notify_customer_reply(ticket: dict, meta: dict, body: str, background_tasks: BackgroundTasks) -> None:
    assignee = await _user_email((meta.get("assigned_to") or {}).get("id"))
    to = [assignee] if assignee else await _routing_for(meta.get("category") or "general")
    background_tasks.add_task(
        send_support_reply_internal, to, case_ref=_ref(ticket), case_id=str(ticket["id"]),
        subject=ticket.get("name") or "", customer_name=meta.get("customer_name"), message=body,
    )


# ── Core: customer rating on a resolved case ─────────────────────────────────

async def _case_feedback_core(ticket: dict, meta: dict, rating: int, comment: Optional[str],
                              by_name: str, partner_id: Optional[int] = None) -> None:
    status = _status_of(ticket, meta)
    if status not in ("resolved", "closed"):
        raise HTTPException(status_code=400, detail="You can rate a request once it has been resolved")
    if meta.get("csat"):
        raise HTTPException(status_code=400, detail="Thank you, you have already rated this request")
    if rating not in (1, 2, 3, 4, 5):
        raise HTTPException(status_code=422, detail="Please choose a rating from 1 to 5")
    comment = (comment or "").strip()[:2000] or None
    company_id = meta.get("company_id") or _m2o_id(ticket.get("company_id"))
    _odoo(hd.add_rating, ticket["id"], company_id, rating, comment,
          partner_id or meta.get("customer_partner_id"))
    now = _now()
    sets = {"csat": {"rating": rating, "comment": comment, "by": by_name, "at": now}}
    if status == "resolved":
        sets.update({"closed_at": now, "closed_reason": "confirmed_by_customer"})
    await _meta_set(ticket["id"], sets)


# ── Order feedback (stays portal-side: only a 1-2 star rating becomes a
#    helpdesk ticket, product owner 2026-10-15) ───────────────────────────────

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
    # a helpdesk ticket automatically rather than sitting unread in a report.
    if rating <= 2:
        try:
            case = await _create_case_core(
                background_tasks=background_tasks, category="feedback",
                subject=f"Low rating ({rating}/5) on order {ctx['order_name']}",
                body=comment or f"The customer rated this order {rating} out of 5 and did not leave a comment.",
                customer=ctx, contact_name=submitted_by.get("name"), contact_email=contact_email,
                raised_by={"id": submitted_by.get("id"), "name": submitted_by.get("name") or ctx.get("customer_name"),
                           "role": submitted_by.get("role") or "public", "partner_id": submitted_by.get("partner_id")},
                source="order_feedback", priority="high", order=ctx,
            )
            await col("order_feedback").update_one({"_id": doc["_id"]},
                                                   {"$set": {"case_id": str(case["id"]), "case_ref": case["ref"]}})
            doc["case_id"], doc["case_ref"] = str(case["id"]), case["ref"]
        except HTTPException as exc:
            # The rating itself is saved; flag the missing follow-up loudly
            # rather than lose the customer's feedback.
            logger.error("support_low_rating_ticket_failed order=%s detail=%s", ctx["order_id"], exc.detail)
    await audit_log("support.order_feedback", "order", str(ctx["order_id"]), entity_label=ctx["order_name"],
                    after={"rating": rating, "by": submitted_by.get("name"), "case": doc.get("case_ref")})
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


def _or(*terms: list) -> list:
    terms = [t for t in terms if t]
    if not terms:
        return [("id", "=", 0)]
    return ["|"] * (len(terms) - 1) + [x for t in terms for x in t]


async def _closed_ids() -> list:
    return [d["_id"] async for d in col(META).find({"closed_at": {"$ne": None}}, {"_id": 1})]


def _status_domain(statuses: set, closed_ids: list) -> list:
    s = hd.stage_ids()
    terms = []
    for st in ("new", "open", "awaiting_customer"):
        if st in statuses:
            terms.append([("stage_id", "=", s[st])])
    if "resolved" in statuses:
        terms.append(["&", ("stage_id", "=", s["resolved"]), ("id", "not in", closed_ids)])
    if "closed" in statuses:
        terms.append(_or([("stage_id", "=", s["cancelled"])],
                         ["&", ("stage_id", "=", s["resolved"]), ("id", "in", closed_ids)]))
    return _or(*terms)


@router.get("/summary")
async def support_summary(current_user: dict = Depends(_require_support_access)):
    """Nav badge counts — what needs this viewer's attention right now."""
    try:
        if _is_external(current_user):
            scope = [("commercial_partner_id", "in", await _external_partner_ids(current_user))]
            dom = scope + _status_domain({"awaiting_customer", "resolved"}, await _closed_ids())
            return {"awaiting_your_reply": hd.count_tickets(dom)}
        s = hd.stage_ids()
        rows = hd.search_tickets([("stage_id", "in", [s["new"], s["open"]])], limit=1000, order="id")
    except HTTPException:
        raise
    except Exception as exc:
        logger.warning("support_summary_failed error=%s", exc)
        return {"waiting_on_us": 0, "unassigned": 0, "mine": 0, "overdue": 0, "unavailable": True}
    metas = await _metas([r["id"] for r in rows])
    overdue = 0
    for r in rows:
        m = metas.get(r["id"], {})
        pr = hd.PRIORITY_FROM_ODOO.get(str(r.get("priority")), "normal")
        if _sla("open", pr, _clock_since(r, m))["age_tier"] == "overdue":
            overdue += 1
    return {
        "waiting_on_us": len(rows),
        "unassigned": sum(1 for r in rows if not (metas.get(r["id"]) or {}).get("assigned_to")),
        "mine": sum(1 for r in rows if ((metas.get(r["id"]) or {}).get("assigned_to") or {}).get("id") == current_user["id"]),
        "overdue": overdue,
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
    domain: list = []
    closed_ids = None
    if external:
        domain.append(("commercial_partner_id", "in", await _external_partner_ids(current_user)))
    if status:
        wanted = set(ACTIVE_STATUSES) if status == "active" else {s for s in status.split(",") if s in STATUSES}
        closed_ids = await _closed_ids()
        domain += _status_domain(wanted, closed_ids)
    if waiting_on in ("staff", "customer"):
        closed_ids = closed_ids if closed_ids is not None else await _closed_ids()
        domain += _status_domain({"new", "open"} if waiting_on == "staff" else {"awaiting_customer", "resolved"}, closed_ids)
    if category in CATEGORIES:
        domain.append(("tag_ids.name", "=", CATEGORIES[category]))
    if not external and assigned == "me":
        ids = [d["_id"] async for d in col(META).find({"assigned_to.id": current_user["id"]}, {"_id": 1})]
        domain.append(("id", "in", ids))
    elif not external and assigned == "unassigned":
        ids = [d["_id"] async for d in col(META).find({"assigned_to": {"$ne": None}}, {"_id": 1})]
        domain.append(("id", "not in", ids))
    if customer_partner_id:
        domain.append(("commercial_partner_id", "=", customer_partner_id))
    if order_id:
        domain.append(("sale_order_id", "=", order_id))
    if search and search.strip():
        q = search.strip()
        rx = {"$regex": re.escape(q), "$options": "i"}
        meta_hits = [d["_id"] async for d in col(META).find(
            {"$or": [{"invoice_name": rx}, {"contact_name": rx}, {"customer_name": rx}]}, {"_id": 1}).limit(500)]
        domain += _or([("name", "ilike", q)], [("ticket_ref", "ilike", q.lstrip("#"))],
                      [("partner_id.name", "ilike", q)], [("partner_id.commercial_partner_id.name", "ilike", q)],
                      [("sale_order_id.name", "ilike", q)], [("id", "in", meta_hits)] if meta_hits else None)
    limit = max(1, min(limit, 200))
    try:
        total = hd.count_tickets(domain)
        rows = hd.search_tickets(domain, offset=max(skip, 0), limit=limit)
        tags = hd.tag_names({t for r in rows for t in r.get("tag_ids") or []})
    except Exception as exc:
        logger.warning("support_list_failed error=%s", exc)
        raise HTTPException(status_code=502, detail=ODOO_DOWN)
    metas = await _metas([r["id"] for r in rows])
    return {"cases": [_assemble(r, metas.get(r["id"]), tags, external) for r in rows], "total": total}


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
            order_ctx = {"order_id": invoice_ctx["order_id"], "order_name": invoice_ctx["order_name"],
                         "company_id": invoice_ctx.get("company_id")}
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

    partner_id = None
    if external:
        contact_name = _actor_name(current_user)
        contact_email = _user_email_of(current_user)
        priority = None  # customers don't set priority — derived from category
        source = "portal"
        if current_user.get("role") == "customer":
            partner_id = current_user.get("odoo_partner_id")
    else:
        source = "staff"

    created = await _create_case_core(
        background_tasks=background_tasks, category=category, subject=subject, body=body,
        customer=customer, contact_name=contact_name, contact_email=contact_email,
        raised_by={"id": current_user["id"], "name": _actor_name(current_user), "role": current_user.get("role"),
                   "partner_id": partner_id},
        source=source, priority=priority, order=order_ctx, invoice=invoice_ctx,
        product_name=product_name, lot_number=lot_number, adverse_event=adverse_event,
        files=files, notify_customer=notify_customer, actor_user=current_user,
    )
    return {"success": True, "case": await _detail(created["id"], external)}


@router.get("/cases/{case_id}")
async def get_case(case_id: str, current_user: dict = Depends(_require_support_access)):
    await _load_for(case_id, current_user)
    return await _detail(case_id, _is_external(current_user))


@router.post("/cases/{case_id}/messages")
async def post_message(
    case_id: str,
    background_tasks: BackgroundTasks,
    body: str = Form(...),
    internal: bool = Form(False),
    files: Optional[List[UploadFile]] = File(None),
    current_user: dict = Depends(_require_support_access),
):
    ticket, meta = await _load_for(case_id, current_user)
    external = _is_external(current_user)
    if not external:
        _require_perm(current_user, "respond")
    await _add_message_core(
        ticket, meta,
        author={"id": current_user["id"], "name": _actor_name(current_user), "role": current_user.get("role"),
                "partner_id": current_user.get("odoo_partner_id") if current_user.get("role") == "customer" else None},
        is_staff=not external, internal=internal and not external, body=body, files=files,
        background_tasks=background_tasks, actor_user=current_user,
    )
    return await _detail(case_id, external)


@router.put("/cases/{case_id}")
async def update_case(case_id: str, body: CaseUpdateBody, current_user: dict = Depends(_require_support_access)):
    _require_perm(current_user, "respond")
    ticket, meta = await _load(case_id)
    status = _status_of(ticket, meta)
    if status == "closed":
        raise HTTPException(status_code=400, detail="This request is closed")
    tid, company_id = ticket["id"], meta.get("company_id") or _m2o_id(ticket.get("company_id"))
    vals, meta_sets, before, after = {}, {}, {}, {}
    if body.status is not None and body.status != status:
        if body.status not in STAFF_SETTABLE_STATUSES:
            raise HTTPException(status_code=422, detail="Use Resolve or Close to finish a request")
        vals["stage_id"] = hd.stage_ids()[body.status]
        # Moving back to new/open puts the ball in our court again.
        if body.status in ("new", "open") and _waiting_on(status) != "staff":
            meta_sets.update({"staff_clock_since": _now(), "escalated_at": None})
        elif body.status == "awaiting_customer":
            meta_sets.update({"staff_clock_since": None, "escalated_at": None})
        if status == "resolved":
            meta_sets["resolved_at"] = None
        before["status"], after["status"] = status, body.status
    if body.priority is not None:
        if body.priority not in PRIORITIES:
            raise HTTPException(status_code=422, detail="Unknown priority")
        vals["priority"] = hd.PRIORITY_TO_ODOO[body.priority]
        before["priority"] = hd.PRIORITY_FROM_ODOO.get(str(ticket.get("priority")), "normal")
        after["priority"] = body.priority
    if body.category is not None:
        if body.category not in CATEGORIES:
            raise HTTPException(status_code=422, detail="Unknown category")
        current = _category_from(ticket, meta, _odoo(hd.tag_names, ticket.get("tag_ids") or []))
        if current == "product_quality" and body.category != "product_quality" and meta.get("quality_review"):
            raise HTTPException(status_code=400, detail="A quality complaint that has been reviewed can't be recategorised")
        vals["tag_ids"] = [(6, 0, _odoo(_tags_for, body.category, bool(meta.get("adverse_event"))))]
        meta_sets["category"] = body.category
        before["category"], after["category"] = current, body.category
    if vals:
        _odoo(hd.write_ticket, tid, company_id, vals)
    if meta_sets:
        await _meta_set(tid, meta_sets)
    if after:
        await audit_log("support.case_updated", "support_case", case_id, entity_label=_ref(ticket),
                        user=current_user, before=before, after=after)
    return await _detail(case_id, False)


@router.post("/cases/{case_id}/assign")
async def assign_case(
    case_id: str, body: AssignBody, background_tasks: BackgroundTasks,
    current_user: dict = Depends(_require_support_access),
):
    """support.respond may take a request themselves (or release their own);
    assigning to anyone else needs support.manage. The assignee is a portal
    user, so it is held portal-side (handlers aren't licensed Odoo users)."""
    _require_perm(current_user, "respond")
    ticket, meta = await _load(case_id)
    target_id = (body.user_id or "").strip() or None
    current_owner = (meta.get("assigned_to") or {}).get("id")
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
    await _meta_set(ticket["id"], {"assigned_to": assignee})
    _note_safe(ticket["id"], meta.get("company_id"),
               f"Assigned to {assignee['name']} by {_actor_name(current_user)}" if assignee
               else f"Unassigned by {_actor_name(current_user)}")
    await audit_log("support.case_assigned", "support_case", case_id, entity_label=_ref(ticket),
                    user=current_user, before={"assigned_to": meta.get("assigned_to")}, after={"assigned_to": assignee})
    if assignee and target_id != current_user["id"]:
        background_tasks.add_task(
            send_support_case_assigned, await _user_email(target_id), case_ref=_ref(ticket), case_id=case_id,
            subject=ticket.get("name") or "", customer_name=meta.get("customer_name"), assigned_by=_actor_name(current_user),
        )
    return await _detail(case_id, False)


def _assert_quality_signoff(ticket: dict, meta: dict, user: dict) -> None:
    """GMP complaint handling: a product quality complaint can only be
    finished by QA/RP, and only after the review is on record."""
    category = _category_from(ticket, meta, hd.tag_names(ticket.get("tag_ids") or []))
    if category != "product_quality":
        return
    if not _perm(user, "quality_review"):
        raise HTTPException(status_code=403, detail="Only QA or the Responsible Pharmacist can resolve a product quality complaint")
    if not (meta.get("quality_review") or {}).get("reviewed_at"):
        raise HTTPException(status_code=400, detail="Complete the quality review before resolving this complaint")


@router.post("/cases/{case_id}/resolve")
async def resolve_case(
    case_id: str, body: ResolveBody, background_tasks: BackgroundTasks,
    current_user: dict = Depends(_require_support_access),
):
    _require_perm(current_user, "respond")
    ticket, meta = await _load(case_id)
    status = _status_of(ticket, meta)
    if status not in ACTIVE_STATUSES:
        raise HTTPException(status_code=400, detail=f"This request is already {STATUSES.get(status, status).lower()}")
    _odoo(_assert_quality_signoff, ticket, meta, current_user)
    note = _clean_text(body.resolution_note, "resolution note", 3, 5000)
    tid, company_id = ticket["id"], meta.get("company_id") or _m2o_id(ticket.get("company_id"))
    now = _now()
    posted = _odoo(hd.post_message, tid, company_id, body=note, internal=False,
                   email_from=_staff_email_from(current_user))
    _odoo(hd.set_status, tid, company_id, "resolved")
    sets = {
        f"authors.{posted['id']}": {"id": current_user["id"], "name": _actor_name(current_user),
                                    "role": current_user.get("role"), "is_staff": True, "kind": "resolution"},
        "staff_clock_since": None, "escalated_at": None, "resolved_at": now,
        "last_message_at": now, "last_message_by_staff": True,
        "resolution": {"note": note, "by": _actor_name(current_user), "by_id": current_user["id"], "at": now},
    }
    if not meta.get("first_response_at"):
        sets["first_response_at"] = now
    if not meta.get("assigned_to"):
        sets["assigned_to"] = {"id": current_user["id"], "name": _actor_name(current_user)}
    await _meta_set(tid, sets)
    await audit_log("support.case_resolved", "support_case", case_id, entity_label=_ref(ticket),
                    user=current_user, before={"status": status}, after={"status": "resolved", "note": note})
    background_tasks.add_task(
        send_support_case_resolved, meta.get("contact_email"), contact_name=meta.get("contact_name"),
        case_ref=_ref(ticket), subject=ticket.get("name") or "", resolution_note=note,
        case_url=_customer_case_url(tid, meta), thread_ref=posted.get("message_id"),
    )
    return await _detail(case_id, False)


@router.post("/cases/{case_id}/close")
async def close_case(case_id: str, body: CloseBody, current_user: dict = Depends(_require_support_access)):
    """Close without customer confirmation — duplicates, spam, or a resolved
    request the customer never came back to. support.manage only. A resolved
    request stays in Odoo's Solved stage; anything else becomes Cancelled."""
    _require_perm(current_user, "manage")
    ticket, meta = await _load(case_id)
    status = _status_of(ticket, meta)
    if status == "closed":
        raise HTTPException(status_code=400, detail="This request is already closed")
    _odoo(_assert_quality_signoff, ticket, meta, current_user)
    tid, company_id = ticket["id"], meta.get("company_id") or _m2o_id(ticket.get("company_id"))
    if status != "resolved":
        _odoo(hd.set_status, tid, company_id, "cancelled")
    note = (body.note or "").strip()
    _note_safe(tid, company_id, f"Closed by {_actor_name(current_user)}" + (f": {note}" if note else ""))
    await _meta_set(tid, {"closed_at": _now(), "closed_reason": "closed_by_staff",
                          "staff_clock_since": None})
    await audit_log("support.case_closed", "support_case", case_id, entity_label=_ref(ticket),
                    user=current_user, before={"status": status}, after={"status": "closed", "note": body.note})
    return await _detail(case_id, False)


@router.put("/cases/{case_id}/quality-review")
async def save_quality_review(case_id: str, body: QualityReviewBody, current_user: dict = Depends(_require_support_access)):
    """Saves the QA/RP investigation as an Odoo Quality alert (created on the
    first save, updated after) and keeps the structured answers Odoo has no
    field for (outcome, recall decision, SAHPRA report) portal-side."""
    _require_perm(current_user, "quality_review")
    ticket, meta = await _load(case_id)
    if _category_from(ticket, meta, _odoo(hd.tag_names, ticket.get("tag_ids") or [])) != "product_quality":
        raise HTTPException(status_code=400, detail="A quality review only applies to product quality complaints")
    if _status_of(ticket, meta) == "closed":
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
    company_id = meta.get("company_id") or _m2o_id(ticket.get("company_id"))
    if not company_id:
        raise HTTPException(status_code=400, detail="This complaint has no company, so its quality record can't be filed")

    def _alert_vals():
        product_id = hd.find_product(meta.get("product_name"))
        sections = [
            ("Complaint", f"{_ref(ticket)}: {ticket.get('name') or ''}"),
            ("Customer", meta.get("customer_name")), ("Order", meta.get("order_name")),
            ("Product (as reported)", meta.get("product_name")), ("Batch / lot (as reported)", meta.get("lot_number")),
            ("Possible adverse reaction", "Yes" if meta.get("adverse_event") else None),
            ("Investigation", review["investigation_summary"]), ("Root cause", review["root_cause"]),
            ("Outcome", QUALITY_OUTCOMES[review["outcome"]]),
            ("Recall required", "Yes" if review["recall_required"] else "No"), ("Recall notes", review["recall_notes"]),
            ("Reported to SAHPRA", "Yes" if review["reported_to_authority"] else "No"),
            ("Reviewed by", f"{review['reviewed_by']} (via the portal)"),
        ]
        vals = {
            "title": f"Customer complaint {_ref(ticket)}: {ticket.get('name') or ''}"[:200],
            "description": "".join(f"<p><b>{k}:</b> {hd.escape(str(v))}</p>" for k, v in sections if v),
            "action_corrective": hd.text_to_html(review["capa"] or ""),
            "stage_id": hd.quality_stage_id(done=True),
        }
        partner = meta.get("customer_partner_id") or _m2o_id(ticket.get("partner_id"))
        if partner:
            vals["partner_id"] = partner
        if product_id:
            vals["product_id"] = product_id
            lots = hd.find_lots(meta.get("lot_number"), product_id)
            if lots:
                vals["lot_ids"] = [(6, 0, lots)]
        return hd.upsert_quality_alert(meta.get("quality_alert_id"), company_id, vals)

    alert_id = _odoo(_alert_vals)
    _note_safe(ticket["id"], company_id,
               f"Quality review saved by {review['reviewed_by']}. Outcome: {QUALITY_OUTCOMES[review['outcome']]}. "
               f"Recorded on Quality alert {alert_id}.")
    await _meta_set(ticket["id"], {"quality_review": review, "quality_alert_id": alert_id})
    await audit_log("support.quality_review", "support_case", case_id, entity_label=_ref(ticket),
                    user=current_user, before=meta.get("quality_review"), after={**review, "quality_alert_id": alert_id})
    return await _detail(case_id, False)


@router.post("/cases/{case_id}/feedback")
async def rate_case(case_id: str, body: FeedbackBody, current_user: dict = Depends(_require_support_access)):
    if not _is_external(current_user):
        raise HTTPException(status_code=403, detail="Only the customer can rate a request")
    ticket, meta = await _load_for(case_id, current_user)
    await _case_feedback_core(ticket, meta, body.rating, body.comment, _actor_name(current_user),
                              current_user.get("odoo_partner_id") if current_user.get("role") == "customer" else None)
    return await _detail(case_id, True)


def _visible_attachment(messages: list, attachment_id: str, external: bool) -> bool:
    return any(a["id"] == attachment_id for m in messages if not (external and m["internal"])
               for a in m["attachments"])


async def _attachment_response(ticket: dict, attachment_id: str, external: bool) -> Response:
    if not _visible_attachment(_odoo(hd.read_messages, ticket["id"]), attachment_id, external):
        raise HTTPException(status_code=404, detail="File not found")
    try:
        att = hd.read_attachment(ticket["id"], int(attachment_id))
    except Exception:
        raise HTTPException(status_code=502, detail=ODOO_DOWN)
    if not att:
        raise HTTPException(status_code=404, detail="File not found")
    safe_name = att["filename"].replace('"', "")
    return Response(content=att["data"], media_type=att["mimetype"],
                    headers={"Content-Disposition": f'inline; filename="{safe_name}"'})


@router.get("/cases/{case_id}/attachments/{attachment_id}")
async def download_attachment(case_id: str, attachment_id: str, current_user: dict = Depends(_require_support_access)):
    ticket, _meta = await _load_for(case_id, current_user)
    return await _attachment_response(ticket, attachment_id, _is_external(current_user))


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
    doc = await _submit_order_feedback_core(
        ctx, body.rating, body.comment,
        {"id": current_user["id"], "name": _actor_name(current_user), "role": current_user.get("role"),
         "partner_id": current_user.get("odoo_partner_id") if current_user.get("role") == "customer" else None},
        _user_email_of(current_user), background_tasks,
    )
    return {"feedback": _serialize_feedback(doc)}


@router.post("/order-feedback/request")
async def request_order_feedback(
    body: FeedbackRequestBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.sales", "support.respond")),
):
    """Staff email the customer a "How did we do?" link for a completed order
    (manual by design — product owner 2026-10-06). Offered as the Next Step on
    a completed Sales ticket, and as Request/Resend in its Actions card. The
    link is the signed order link, so no portal login is needed to answer it."""
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


async def _case_from_token(token: str) -> tuple:
    case_id = verify_case_token(token)
    if not case_id or not str(case_id).isdigit():
        # Links issued before 28.6 pointed at portal-only records.
        raise HTTPException(status_code=404, detail="This link is invalid or has expired. Please contact us for a new one.")
    return await _load(case_id)


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
    rows = _odoo(hd.search_tickets, [("sale_order_id", "=", order_id)], limit=50, order="create_date desc")
    metas = await _metas([r["id"] for r in rows])
    tags = _odoo(hd.tag_names, {t for r in rows for t in r.get("tag_ids") or []})
    cases = [_assemble(r, metas.get(r["id"]), tags, True) for r in rows]
    fb = await col("order_feedback").find_one({"order_id": order_id})
    return {
        "order": {"name": ctx["order_name"], "date": ctx.get("date_order"),
                  "customer_name": ctx.get("customer_name"), "lines": ctx.get("lines", [])},
        "cases": [{"ref": c["ref"], "subject": c["subject"], "status": c["status"],
                   "status_label": c["status_label"], "category_label": c["category_label"],
                   "created_at": c["created_at"], "case_token": make_case_token(c["id"])} for c in cases],
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
    created = await _create_case_core(
        background_tasks=background_tasks, category=category, subject=subject, body=body,
        customer=ctx, contact_name=name, contact_email=email,
        raised_by={"id": None, "name": name, "role": "public"}, source="email_link",
        order=ctx, product_name=product_name, lot_number=lot_number, adverse_event=adverse_event, files=files,
    )
    return {"success": True, "ref": created["ref"], "case_token": make_case_token(str(created["id"]))}


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


async def _public_case_out(case_id) -> dict:
    out = await _detail(case_id, external=True)
    out.pop("contact_email", None)
    return out


@public_router.get("/case/{token}")
@limiter.limit("60/minute")
async def public_case(request: Request, token: str):
    ticket, _meta = await _case_from_token(token)
    return await _public_case_out(ticket["id"])


@public_router.post("/case/{token}/messages")
@limiter.limit("30/hour")
async def public_case_message(
    request: Request,
    token: str,
    background_tasks: BackgroundTasks,
    body: str = Form(...),
    files: Optional[List[UploadFile]] = File(None),
):
    ticket, meta = await _case_from_token(token)
    await _add_message_core(
        ticket, meta, author={"id": None, "name": meta.get("contact_name") or "Customer", "role": "public"},
        is_staff=False, internal=False, body=body, files=files, background_tasks=background_tasks,
    )
    return await _public_case_out(ticket["id"])


@public_router.post("/case/{token}/feedback")
@limiter.limit("10/hour")
async def public_case_feedback(request: Request, token: str, body: FeedbackBody):
    ticket, meta = await _case_from_token(token)
    await _case_feedback_core(ticket, meta, body.rating, body.comment, meta.get("contact_name") or "Customer")
    return await _public_case_out(ticket["id"])


@public_router.get("/case/{token}/attachments/{attachment_id}")
@limiter.limit("60/minute")
async def public_case_attachment(request: Request, token: str, attachment_id: str):
    ticket, _meta = await _case_from_token(token)
    return await _attachment_response(ticket, attachment_id, external=True)


# ══ Scheduled jobs (registered in services/scheduler.py) ═════════════════════

async def run_support_sla_checks() -> None:
    """Hourly: (1) escalate requests waiting on us past their response target,
    once per waiting period (escalated_at resets whenever we reply);
    (2) auto-close requests resolved more than AUTO_CLOSE_DAYS ago that the
    customer never came back to (they stay in Odoo's Solved stage)."""
    now = _now()
    try:
        s = hd.stage_ids()
        rows = hd.search_tickets([("stage_id", "in", [s["new"], s["open"]])], limit=1000, order="id")
    except Exception as exc:
        logger.warning("support_sla_check_odoo_failed error=%s", exc)
        rows = []
    metas = await _metas([r["id"] for r in rows])
    overdue = []
    for r in rows:
        m = metas.get(r["id"], {})
        if m.get("escalated_at"):
            continue
        pr = hd.PRIORITY_FROM_ODOO.get(str(r.get("priority")), "normal")
        sla = _sla("open", pr, _clock_since(r, m))
        if sla["age_tier"] == "overdue":
            overdue.append((r, m, pr, sla))
    if overdue:
        routing = await get_email_routing()
        to = [e.lower() for e in routing.get("support_escalation_to") or []]
        if not to:
            for cat in {m.get("category") or "general" for _r, m, _p, _s in overdue}:
                to += await _routing_for(cat)
        for _r, m, _p, _s in overdue:
            email = await _user_email((m.get("assigned_to") or {}).get("id"))
            if email:
                to.append(email.lower())
        to = list(dict.fromkeys(to))
        items = [{"case_ref": _ref(r), "case_id": str(r["id"]),
                  "customer_name": m.get("customer_name") or hd.m2o_name(r.get("commercial_partner_id")) or "",
                  "priority_label": PRIORITIES.get(pr, "Normal"),
                  "hours_waiting": sla["hours_elapsed"] or 0} for r, m, pr, sla in overdue]
        try:
            send_support_sla_escalation(to, items)
        except Exception as exc:
            logger.warning("support_escalation_send_failed error=%s", exc)
        for r, _m, _p, _s in overdue:
            await _meta_set(r["id"], {"escalated_at": now})

    due = await col(META).find(
        {"resolved_at": {"$lt": now - timedelta(days=AUTO_CLOSE_DAYS)}, "closed_at": None},
        {"_id": 1, "company_id": 1},
    ).to_list(500)
    for d in due:
        await _meta_set(d["_id"], {"closed_at": now, "closed_reason": "auto_closed"})
        _note_safe(d["_id"], d.get("company_id"),
                   f"Closed automatically: resolved {AUTO_CLOSE_DAYS} days ago with no reply from the customer.")
    if due:
        logger.info("support_auto_closed count=%s", len(due))


async def run_support_inbound_sync() -> None:
    """Every few minutes: pick up customer emails Odoo's mail gateway has
    attached to helpdesk tickets since the last run. A brand-new ticket
    (emailed to the support address) gets its portal record, the team is
    told and the customer gets our acknowledgement; a reply on an existing
    request reopens it and tells the assignee. Does nothing until Odoo
    receives email for the support address (see PRODUCTION_ROADMAP 28.6)."""
    cursor_doc = await col("portal_settings").find_one({"_id": "support_inbound_cursor"})
    try:
        if not cursor_doc:
            # First run: start from now, never replay history.
            await col("portal_settings").update_one(
                {"_id": "support_inbound_cursor"}, {"$set": {"last_message_id": hd.latest_message_id()}}, upsert=True)
            return
        emails = hd.inbound_emails_after(int(cursor_doc.get("last_message_id") or 0))
    except Exception as exc:
        logger.warning("support_inbound_sync_failed error=%s", exc)
        return
    for msg in emails:
        try:
            await _ingest_inbound(msg)
        except Exception as exc:
            logger.warning("support_inbound_message_failed message=%s error=%s", msg.get("id"), exc)
        await col("portal_settings").update_one(
            {"_id": "support_inbound_cursor"}, {"$set": {"last_message_id": msg["id"]}})


class _Tasks:
    """BackgroundTasks stand-in for the scheduler: runs the send immediately
    (we're already off the request path)."""
    def add_task(self, fn, *args, **kwargs):
        try:
            fn(*args, **kwargs)
        except Exception as exc:
            logger.warning("support_inbound_send_failed fn=%s error=%s", getattr(fn, "__name__", fn), exc)


async def _ingest_inbound(msg: dict) -> None:
    tid = msg.get("res_id")
    if not tid:
        return
    rows = hd.read_tickets([tid])
    if not rows:
        return
    ticket = rows[0]
    body = hd.html_to_text(msg.get("body"))
    meta = await col(META).find_one({"_id": tid})
    tasks = _Tasks()
    now = _now()
    if not meta:
        name, addr = parseaddr(msg.get("email_from") or "")
        commercial = _m2o_id(ticket.get("commercial_partner_id"))
        company_id = _m2o_id(ticket.get("company_id"))
        try:
            hd.write_ticket(tid, company_id, {"tag_ids": [(4, hd.tag_id(CATEGORIES["general"]))]})
        except Exception:
            pass
        meta = {
            "_id": tid, "ref": _ref(ticket), "company_id": company_id, "category": "general", "source": "email",
            "customer_partner_id": commercial, "customer_name": hd.m2o_name(ticket.get("commercial_partner_id")) or "",
            "contact_name": name or addr, "contact_email": (addr or "").lower() or None,
            "raised_by": {"id": None, "name": name or addr, "role": "public"},
            "assigned_to": None, "authors": {}, "message_count": 1, "last_message_at": now,
            "last_message_by_staff": False, "first_response_at": None, "staff_clock_since": now,
            "escalated_at": None, "resolved_at": None, "closed_at": None, "created_at": now,
        }
        await col(META).replace_one({"_id": tid}, meta, upsert=True)
        await audit_log("support.case_created", "support_case", str(tid), entity_label=meta["ref"],
                        after={"source": "email", "from": meta["contact_email"], "odoo_ticket_id": tid})
        tasks.add_task(
            send_support_case_new_internal, await _routing_for("general"),
            case_ref=meta["ref"], case_id=str(tid), subject=ticket.get("name") or "",
            customer_name=meta["customer_name"] or meta["contact_name"], category_label=CATEGORIES["general"],
            priority_label=PRIORITIES.get(hd.PRIORITY_FROM_ODOO.get(str(ticket.get("priority")), "normal")),
            raised_by=meta["contact_name"], message=body,
        )
        if meta["contact_email"]:
            tasks.add_task(
                send_support_case_received, meta["contact_email"], contact_name=meta["contact_name"],
                case_ref=meta["ref"], subject=ticket.get("name") or "", category_label=CATEGORIES["general"],
                case_url=_customer_case_url(tid, meta), thread_ref=msg.get("message_id"),
            )
        return

    status = _status_of(ticket, meta)
    sets = {"last_message_at": now, "last_message_by_staff": False}
    unset = None
    if status in ("awaiting_customer", "resolved", "closed"):
        # Someone has to read an emailed reply, so even a closed request
        # reopens (the portal form blocks replies on closed requests instead).
        hd.set_status(tid, meta.get("company_id"), "open")
        sets["resolved_at"] = None
        if status == "closed":
            unset = {"closed_at": "", "closed_reason": ""}
    if _waiting_on(status) != "staff":
        sets.update({"staff_clock_since": now, "escalated_at": None})
    upd = {"$set": {**sets, "updated_at": now}, "$inc": {"message_count": 1}}
    if unset:
        upd["$unset"] = unset
    await col(META).update_one({"_id": tid}, upd)
    await _notify_customer_reply(ticket, meta, body, tasks)
