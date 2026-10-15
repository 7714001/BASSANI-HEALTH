"""
Odoo Helpdesk gateway for the support desk (Phase 28.6).

Every support request is an Odoo `helpdesk.ticket`; its conversation is the
ticket's chatter (`mail.message`) and its files are `ir.attachment`s on the
ticket. This module is the only place the portal reads or writes them, so
routes/support_routes.py never builds a helpdesk domain or a message_post
call itself.

Things that matter on this Odoo (19.0, live-probed 2026-10-15):

- Odoo must not email the customer. The portal sends every support email
  itself (Resend, portal branding). So writes run with QUIET_CTX
  (tracking_disable also stops the New stage's "Ticket Received" template),
  the customer is unsubscribed straight after create (helpdesk subscribes
  partner_id unconditionally), and the ticket never gets a `user_id`.
- Never write `partner_email`/`partner_phone`: helpdesk's inverse copies a
  differing value onto the customer's own res.partner record. The person
  who raised the request is kept in the portal record and in the description.
- Staff authors are portal users, not Odoo users, so a staff message is
  posted with author_id=False and email_from="Name (Bassani Health) <...>",
  which Odoo's chatter shows as that name.
- No ticket types on 19.0; the request type is a helpdesk.tag.
"""
import base64
import html as _html
import logging
import re
import time
from email.utils import parseaddr
from typing import Iterable, Optional

from odoo_client import odoo

logger = logging.getLogger(__name__)

TICKET = "helpdesk.ticket"
QUIET_CTX = {"tracking_disable": True, "mail_create_nosubscribe": True,
             "mail_create_nolog": True, "mail_notrack": True}

PRIORITY_TO_ODOO = {"low": "0", "normal": "1", "high": "2", "urgent": "3"}
PRIORITY_FROM_ODOO = {v: k for k, v in PRIORITY_TO_ODOO.items()}

# Portal status → Odoo stage name. "closed" has no stage of its own: a closed
# request stays in Solved (closed_at recorded portal-side) unless it was
# closed without being resolved, which is Cancelled.
STAGE_NAMES = {"new": "New", "open": "In Progress", "awaiting_customer": "On Hold",
               "resolved": "Solved", "cancelled": "Cancelled"}

TICKET_FIELDS = ["id", "ticket_ref", "name", "description", "partner_id", "commercial_partner_id", "sale_order_id",
                 "stage_id", "priority", "tag_ids", "team_id", "company_id",
                 "create_date", "write_date", "close_date"]

_cache: dict = {}
_CACHE_TTL = 600


def _cached(key, loader):
    hit = _cache.get(key)
    if hit and time.monotonic() - hit[0] < _CACHE_TTL:
        return hit[1]
    val = loader()
    _cache[key] = (time.monotonic(), val)
    return val


def _ctx(company_id: Optional[int], extra: Optional[dict] = None) -> dict:
    ctx = dict(QUIET_CTX)
    if company_id:
        ctx.update({"allowed_company_ids": [company_id], "company_id": company_id})
    if extra:
        ctx.update(extra)
    return ctx


def m2o_id(val):
    return val[0] if isinstance(val, (list, tuple)) and val else None


def m2o_name(val):
    return val[1] if isinstance(val, (list, tuple)) and len(val) > 1 else None


def odoo_dt(val):
    """Odoo datetimes come back as naive UTC strings; the portal returns ISO."""
    if not val or val is False:
        return None
    s = str(val).replace(" ", "T")
    return s if s.endswith("Z") else s + "Z"


# ── Configuration lookups (cached) ───────────────────────────────────────────

def stage_ids() -> dict:
    """{portal status: stage id}. Raises if a stage was renamed in Odoo, so a
    config change fails loudly instead of silently mis-filing requests."""
    def load():
        rows = odoo("helpdesk.stage", "search_read", [[]], {"fields": ["name"], "order": "sequence, id"})
        by_name = {r["name"].strip().lower(): r["id"] for r in rows}
        out = {}
        for status, name in STAGE_NAMES.items():
            if name.lower() not in by_name:
                raise RuntimeError(f"Helpdesk stage '{name}' not found in Odoo")
            out[status] = by_name[name.lower()]
        return out
    return _cached("stages", load)


def status_for_stage(stage_id: Optional[int], closed: bool) -> str:
    rev = {v: k for k, v in stage_ids().items()}
    st = rev.get(stage_id, "open")
    if st == "cancelled":
        return "closed"
    if st == "resolved" and closed:
        return "closed"
    return st


def team_for_company(company_id: Optional[int]) -> Optional[int]:
    """The helpdesk team that belongs to this company (one per company)."""
    def load():
        rows = odoo("helpdesk.team", "search_read", [[]],
                    {"fields": ["company_id"], "order": "id"})
        out = {}
        for r in rows:
            out.setdefault(m2o_id(r.get("company_id")), r["id"])
        return out
    teams = _cached("teams", load)
    return teams.get(company_id) or next(iter(teams.values()), None)


def tag_id(label: str) -> int:
    """helpdesk.tag by name, created on first use (request types are tags)."""
    def load():
        found = odoo("helpdesk.tag", "search", [[("name", "=", label)]], {"limit": 1})
        return found[0] if found else odoo("helpdesk.tag", "create", [{"name": label}])
    return _cached(("tag", label), load)


def tag_names(ids: Iterable[int]) -> dict:
    ids = [i for i in ids if i]
    if not ids:
        return {}
    return {r["id"]: r["name"] for r in odoo("helpdesk.tag", "read", [ids], {"fields": ["name"]})}


def internal_subtype_ids() -> set:
    return _cached("internal_subtypes", lambda: set(
        odoo("mail.message.subtype", "search", [[("internal", "=", True)]], {"limit": 200})))


def ticket_model_id() -> int:
    return _cached("ticket_model_id", lambda: odoo("ir.model", "search", [[("model", "=", TICKET)]], {"limit": 1})[0])


# ── Text helpers ─────────────────────────────────────────────────────────────

def escape(text) -> str:
    return _html.escape(str(text))


def text_to_html(text: str) -> str:
    return "<p>" + _html.escape(text or "").replace("\n", "<br>") + "</p>"


_BLOCK_RE = re.compile(r"(?i)<\s*(br|/p|/div|/li|/h\d|/tr)\s*/?>")
_TAG_RE = re.compile(r"<[^>]+>")


def html_to_text(value) -> str:
    if not value or value is False:
        return ""
    text = _BLOCK_RE.sub("\n", str(value))
    text = _html.unescape(_TAG_RE.sub("", text))
    return re.sub(r"\n{3,}", "\n\n", text).strip()


# ── Tickets ──────────────────────────────────────────────────────────────────

def create_ticket(*, company_id: Optional[int], subject: str, description_html: str,
                  partner_id: Optional[int], priority: str, tag_ids: list,
                  sale_order_id: Optional[int]) -> int:
    team_id = team_for_company(company_id)
    vals = {
        "name": subject,
        "description": description_html,
        "priority": PRIORITY_TO_ODOO.get(priority, "1"),
        "tag_ids": [(6, 0, tag_ids)],
        "stage_id": stage_ids()["new"],
    }
    if team_id:
        vals["team_id"] = team_id
    if partner_id:
        vals["partner_id"] = partner_id
    if sale_order_id:
        vals["sale_order_id"] = sale_order_id
    tid = odoo(TICKET, "create", [vals], {"context": _ctx(company_id)})
    tid = tid[0] if isinstance(tid, list) else tid
    if partner_id:
        try:
            odoo(TICKET, "message_unsubscribe", [[tid]], {"partner_ids": [partner_id], "context": _ctx(company_id)})
        except Exception as exc:  # never fail the request over a follower
            logger.warning("helpdesk_unsubscribe_failed ticket=%s error=%s", tid, exc)
    return tid


def write_ticket(ticket_id: int, company_id: Optional[int], vals: dict) -> None:
    odoo(TICKET, "write", [[ticket_id], vals], {"context": _ctx(company_id)})


def set_status(ticket_id: int, company_id: Optional[int], status: str) -> None:
    write_ticket(ticket_id, company_id, {"stage_id": stage_ids()[status]})


def read_tickets(ids: list) -> list:
    if not ids:
        return []
    return odoo(TICKET, "read", [ids], {"fields": TICKET_FIELDS})


def search_tickets(domain: list, offset: int = 0, limit: int = 50, order: str = "write_date desc, id desc") -> list:
    return odoo(TICKET, "search_read", [domain], {"fields": TICKET_FIELDS, "offset": offset,
                                                   "limit": limit, "order": order})


def search_ticket_ids(domain: list, limit: int = 1000) -> list:
    return odoo(TICKET, "search", [domain], {"limit": limit})


def count_tickets(domain: list) -> int:
    return odoo(TICKET, "search_count", [domain])


# ── Messages and attachments ─────────────────────────────────────────────────

def _create_attachments(ticket_id: int, company_id: Optional[int], files: list) -> list:
    ids = []
    for f in files or []:
        ids.append(odoo("ir.attachment", "create", [{
            "name": f["filename"],
            "datas": base64.b64encode(f["data"]).decode(),
            "res_model": TICKET,
            "res_id": ticket_id,
            "mimetype": f.get("content_type") or "application/octet-stream",
        }], {"context": _ctx(company_id)}))
    return [i[0] if isinstance(i, list) else i for i in ids]


def post_message(ticket_id: int, company_id: Optional[int], *, body: str, internal: bool,
                 author_partner_id: Optional[int] = None, email_from: Optional[str] = None,
                 files: Optional[list] = None) -> dict:
    """Post one message on the ticket's chatter. Returns {id, message_id};
    message_id is the RFC Message-ID that customer email replies thread on."""
    att_ids = _create_attachments(ticket_id, company_id, files or [])
    kwargs = {
        "body": text_to_html(body),
        "message_type": "comment",
        "subtype_xmlid": "mail.mt_note" if internal else "mail.mt_comment",
        "attachment_ids": att_ids,
        "context": _ctx(company_id),
    }
    if author_partner_id:
        kwargs["author_id"] = author_partner_id
    elif email_from:
        kwargs["author_id"] = False
        kwargs["email_from"] = email_from
    msg_id = odoo(TICKET, "message_post", [[ticket_id]], kwargs)
    msg_id = msg_id[0] if isinstance(msg_id, list) else msg_id
    header = None
    try:
        header = odoo("mail.message", "read", [[msg_id]], {"fields": ["message_id"]})[0].get("message_id")
    except Exception:
        pass
    return {"id": msg_id, "message_id": header or None}


def read_messages(ticket_id: int) -> list:
    """Chatter in date order: comments and emails only (no tracking notices).
    Each item: id, body (plain text), internal, at, author_partner_id,
    author_name, email, message_type, attachments[{id, filename, size}]."""
    rows = odoo("mail.message", "search_read", [[
        ("model", "=", TICKET), ("res_id", "=", ticket_id),
        ("message_type", "in", ["comment", "email"]),
    ]], {"fields": ["id", "body", "date", "author_id", "email_from", "subtype_id",
                    "attachment_ids", "message_type"], "order": "date asc, id asc", "limit": 500})
    att_ids = sorted({a for r in rows for a in r.get("attachment_ids") or []})
    atts = {}
    if att_ids:
        for a in odoo("ir.attachment", "read", [att_ids], {"fields": ["name", "file_size"]}):
            atts[a["id"]] = {"id": str(a["id"]), "filename": a.get("name"), "size": a.get("file_size") or 0}
    internal_subtypes = internal_subtype_ids()
    out = []
    for r in rows:
        name, addr = parseaddr(r.get("email_from") or "")
        out.append({
            "id": r["id"],
            "body": html_to_text(r.get("body")),
            "internal": m2o_id(r.get("subtype_id")) in internal_subtypes,
            "at": odoo_dt(r.get("date")),
            "author_partner_id": m2o_id(r.get("author_id")),
            "author_name": m2o_name(r.get("author_id")) or name or addr or "Customer",
            "email": addr or None,
            "message_type": r.get("message_type"),
            "attachments": [atts[a] for a in r.get("attachment_ids") or [] if a in atts],
        })
    return [m for m in out if m["body"] or m["attachments"]]


def read_attachment(ticket_id: int, attachment_id: int) -> Optional[dict]:
    rows = odoo("ir.attachment", "search_read", [[
        ("id", "=", attachment_id), ("res_model", "=", TICKET), ("res_id", "=", ticket_id),
    ]], {"fields": ["name", "mimetype", "datas"], "limit": 1})
    if not rows or not rows[0].get("datas"):
        return None
    r = rows[0]
    return {"filename": r.get("name") or "file", "mimetype": r.get("mimetype") or "application/octet-stream",
            "data": base64.b64decode(r["datas"])}


def inbound_emails_after(cursor: int, limit: int = 200) -> list:
    """Customer emails Odoo's mail gateway attached to tickets (new tickets
    from the support address, and replies threaded onto existing ones)."""
    return odoo("mail.message", "search_read", [[
        ("model", "=", TICKET), ("message_type", "=", "email"), ("id", ">", cursor),
    ]], {"fields": ["id", "res_id", "body", "email_from", "author_id", "date", "message_id"],
        "order": "id asc", "limit": limit})


def latest_message_id() -> int:
    rows = odoo("mail.message", "search", [[("model", "=", TICKET)]], {"limit": 1, "order": "id desc"})
    return rows[0] if rows else 0


# ── Ratings ──────────────────────────────────────────────────────────────────

def add_rating(ticket_id: int, company_id: Optional[int], rating: int, comment: Optional[str],
               partner_id: Optional[int]) -> None:
    vals = {"res_model_id": ticket_model_id(), "res_id": ticket_id, "rating": float(rating),
            "feedback": comment or False, "consumed": True}
    if partner_id:
        vals["partner_id"] = partner_id
    odoo("rating.rating", "create", [vals], {"context": _ctx(company_id)})


# ── Quality alerts (product quality complaints) ──────────────────────────────

def quality_team_id() -> Optional[int]:
    def load():
        rows = odoo("quality.alert.team", "search", [[]], {"limit": 1, "order": "sequence, id"})
        return rows[0] if rows else None
    return _cached("quality_team", load)


def quality_stage_id(done: bool) -> Optional[int]:
    def load():
        rows = odoo("quality.alert.stage", "search_read", [[]], {"fields": ["name", "done"], "order": "sequence, id"})
        return {"done": next((r["id"] for r in rows if r.get("done")), None),
                "open": next((r["id"] for r in rows if not r.get("done")), None)}
    return _cached("quality_stages", load)["done" if done else "open"]


def find_product(name: Optional[str]) -> Optional[int]:
    if not name:
        return None
    try:
        rows = odoo("product.product", "search", [[("name", "=ilike", name.strip())]], {"limit": 2})
        return rows[0] if len(rows) == 1 else None
    except Exception:
        return None


def find_lots(lot_number: Optional[str], product_id: Optional[int]) -> list:
    if not lot_number:
        return []
    domain = [("name", "=", lot_number.strip())]
    if product_id:
        domain.append(("product_id", "=", product_id))
    try:
        return odoo("stock.lot", "search", [domain], {"limit": 5})
    except Exception:
        return []


def upsert_quality_alert(alert_id: Optional[int], company_id: int, vals: dict) -> int:
    """Create or update the Quality alert that records a product quality
    complaint's investigation (EU GMP Chapter 8)."""
    ctx = _ctx(company_id)
    if alert_id:
        odoo("quality.alert", "write", [[alert_id], vals], {"context": ctx})
        return alert_id
    vals = dict(vals, company_id=company_id, team_id=quality_team_id())
    new_id = odoo("quality.alert", "create", [vals], {"context": ctx})
    return new_id[0] if isinstance(new_id, list) else new_id
