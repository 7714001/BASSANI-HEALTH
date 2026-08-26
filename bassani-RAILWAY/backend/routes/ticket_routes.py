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
import jwt
import logging
import os
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
from config import get_settings
from auth import (
    require_permission, require_any_permission, require_admin,
    get_current_user, get_user_by_username, require_super_admin, ADMIN_ROLES, TICKET_ROLES,
)
from routes.monitor_routes import broadcast_monitor_refresh
from routes.order_routes import _queue_packing_board
from odoo_client import get_odoo_client, odoo as odoo_call
from warehouse_context import company_context
from database import col
from middleware.audit import audit_log
from services.notification_service import notify_ticket_assigned
from services.email_service import send_ticket_assigned, send_pop_uploaded_notification
from services.r2_client import r2_put, r2_presign
from ownership import get_owned_partner_ids, is_partner_owned_by

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


# ── Real-time connection manager ───────────────────────────────────────────────

class TicketConnectionManager:
    """Manages active WebSocket connections for real-time ticket push notifications.

    Staff (any non-reseller role) receive every update.
    Reseller connections receive only updates for tickets belonging to a
    customer linked to them (Phase 7.13 — ownership-based, matching the REST
    endpoints; a reseller connection caches its owned-partner-id set at
    connect time rather than re-querying Mongo on every single broadcast for
    every connected client, which wouldn't scale with many concurrent
    reseller connections). The cache is invalidated (re-fetched) whenever
    that reseller's customer_ownership links change — see refresh_reseller().
    Dead connections are pruned silently on the next broadcast.

    Fixes a pre-existing bug found while rebuilding this for ownership: the
    old scoping compared a Mongo ObjectId string (from ticket_websocket's
    `str(reseller_doc["_id"])`) against the reseller's `id` field (a UUID) —
    two different id spaces that could never match, so reseller connections
    never actually received a live push, always silently falling back to
    the next page refresh.
    """
    def __init__(self):
        self._conns: list[tuple] = []  # (ws, role, reseller_id | None, owned_partner_ids: set | None)

    async def connect(self, ws: WebSocket, role: str, reseller_id: str | None):
        # ws is already accepted by the caller by this point (see
        # ticket_websocket) — accepting here too would raise, since a
        # WebSocket can only be accepted once.
        owned = await get_owned_partner_ids(reseller_id) if role == "reseller" else None
        self._conns.append((ws, role, reseller_id, owned))

    def disconnect(self, ws: WebSocket):
        self._conns = [c for c in self._conns if c[0] is not ws]

    async def refresh_reseller(self, reseller_id: str | None):
        """Re-fetch the owned-partner-id cache for any live connection
        belonging to this reseller — called from every customer_ownership
        link/unlink/claim/onboarding-approve write site so an already-
        connected reseller doesn't have to reconnect to see the effect."""
        if not reseller_id:
            return
        updated: list = []
        for ws, role, rid, owned in self._conns:
            if role == "reseller" and rid == reseller_id:
                owned = await get_owned_partner_ids(reseller_id)
            updated.append((ws, role, rid, owned))
        self._conns = updated

    async def broadcast(self, ticket_id: str, ticket_customer_id: int | None = None):
        payload = {"type": "ticket_update", "ticket_id": ticket_id}
        dead: list = []
        for ws, role, _rid, owned in list(self._conns):
            if role != "reseller" or (owned and ticket_customer_id in owned):
                try:
                    await ws.send_json(payload)
                except Exception:
                    dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

ticket_manager = TicketConnectionManager()


# ── WebSocket endpoint ─────────────────────────────────────────────────────────

@router.websocket("/ws")
async def ticket_websocket(ws: WebSocket):
    """Real-time ticket update stream. Any active portal user can subscribe.

    Auth: JWT passed as ?token= query param (same pattern as the packing board).
    The socket is accepted BEFORE the token is checked, and an explicit
    {"type": "auth_error"} message is sent before closing on failure, mirroring
    packing_board_routes.py's _ws_reject: closing pre-accept has the ASGI
    server (Uvicorn) reject the handshake as a bare HTTP 403 with no signal
    reaching the browser at all (logged as "connection rejected (403
    Forbidden)"), and Railway's proxy strips custom WebSocket close codes
    even post-accept, so the client can't rely on reading the close code
    either — an explicit message is the only channel that reliably arrives.
    On connect the server sends {type: "connected"}.
    On any ticket mutation the server pushes {type: "ticket_update", ticket_id: "..."}.
    No other inbound messages are expected — the connection is server-push only.
    """
    await ws.accept()
    cfg = get_settings()
    token = ws.query_params.get("token", "")
    try:
        payload = jwt.decode(token, cfg.jwt_secret, algorithms=[cfg.jwt_algorithm])
        username = payload.get("sub")
        user = await get_user_by_username(username) if username else None
        if not user or not user.get("active", True):
            await ws.send_json({"type": "auth_error"})
            await ws.close(code=4001)
            return
    except Exception:
        await ws.send_json({"type": "auth_error"})
        await ws.close(code=4001)
        return

    role = user.get("role", "")
    reseller_id: str | None = None
    if role == "reseller":
        # Use the reseller's own `id` field (matches customer_ownership.reseller_id
        # and every REST-side lookup) — not the Mongo _id ObjectId, which was the
        # pre-existing bug described on TicketConnectionManager above.
        reseller_doc = await col("resellers").find_one({"user_id": user["id"]}, {"id": 1, "_id": 0})
        reseller_id = reseller_doc["id"] if reseller_doc else None

    await ticket_manager.connect(ws, role, reseller_id)
    try:
        await ws.send_json({"type": "connected"})
        while True:
            await ws.receive_text()  # keep-alive; no inbound messages expected
    except WebSocketDisconnect:
        ticket_manager.disconnect(ws)
    except Exception:
        ticket_manager.disconnect(ws)


# Forward stages — a ticket normally moves left to right through these.
STATUSES = ["open", "quote", "sale_order", "awaiting_deposit", "confirmed_wip", "ready_for_collection", "incomplete"]

# Side-exits — reachable from most stages, not a fixed final step (mirrors how
# Odoo's own sale.order can cancel from draft, sent, *or* sale).
EXIT_STATUSES = ["not_interested", "cancelled", "complete"]


# ── Pydantic models ───────────────────────────────────────────────────────────

class TicketCreate(BaseModel):
    customer_id: int
    assigned_to: Optional[str] = None          # defaults to the creating sales rep
    note: Optional[str] = None                 # free text — e.g. what the PO/RFQ asked for
    sample_recipient_id: Optional[int] = None  # Odoo partner ID of the actual recipient
    sample_recipient_name: Optional[str] = None


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
    partner_invoice_id: Optional[int] = None    # explicit invoice address (8.27)
    payment_term_id: Optional[int] = None       # Odoo payment term (8.28)
    note: Optional[str] = ""


class TicketOrderUpdate(BaseModel):
    order_line: List[TicketOrderLine]
    customer_id: Optional[int] = None           # if provided, updates partner_id on the Odoo order
    partner_shipping_id: Optional[int] = None   # if provided, updates delivery address on the Odoo order
    partner_invoice_id: Optional[int] = None    # if provided, updates invoice address on the Odoo order (8.27)
    payment_term_id: Optional[int] = None       # if provided, updates payment terms on the Odoo order (8.28)
    note: Optional[str] = ""


class TicketDepositRegister(BaseModel):
    invoice_type: str = "fixed"   # 'fixed' | 'percentage' — see register_deposit for why 'delivered' was removed (2026-08-11)
    amount: Optional[float] = None   # required for 'fixed'
    percentage: Optional[float] = None  # required for 'percentage', 0 < x <= 100
    date: str           # YYYY-MM-DD
    journal_id: int
    note: Optional[str] = ""


class TicketBalancePayment(BaseModel):
    amount: float
    date: str           # YYYY-MM-DD
    journal_id: int
    note: Optional[str] = ""


class UseExistingInvoiceBody(BaseModel):
    invoice_id: int


class TicketFromOrder(BaseModel):
    order_id: int


class LinkOrderBody(BaseModel):
    order_id: int


class ReassignBody(BaseModel):
    assigned_to: str  # portal user ID


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(t: dict) -> dict:
    t["id"] = str(t.pop("_id"))
    return t


def _actor(current_user: dict) -> str:
    return current_user.get("name") or current_user.get("username") or "unknown"


# ── Reseller-aware auth helpers ───────────────────────────────────────────────
# These replace individual require_permission() calls on endpoints that resellers
# need to reach. Each helper replicates the super-admin bypass and role gate from
# require_permission(), then adds a reseller pass-through beneath it.

async def _require_ticket_viewer(current_user: dict = Depends(get_current_user)) -> dict:
    """Staff with tickets.sales or tickets.finance_confirm, OR any reseller."""
    if current_user.get("is_super_admin") or current_user.get("role") == "super_admin":
        return current_user
    if current_user.get("role") == "reseller":
        return current_user
    if current_user.get("role") not in (ADMIN_ROLES | TICKET_ROLES):
        raise HTTPException(status_code=403, detail="Access denied")
    perms = current_user.get("permissions") or {}
    if perms.get("tickets", {}).get("sales") or perms.get("tickets", {}).get("finance_confirm"):
        return current_user
    raise HTTPException(status_code=403, detail="Access denied")


async def _require_ticket_driver(current_user: dict = Depends(get_current_user)) -> dict:
    """Staff with tickets.sales, OR any reseller (for their own tickets)."""
    if current_user.get("is_super_admin") or current_user.get("role") == "super_admin":
        return current_user
    if current_user.get("role") == "reseller":
        return current_user
    if current_user.get("role") not in (ADMIN_ROLES | TICKET_ROLES):
        raise HTTPException(status_code=403, detail="Access denied")
    perms = current_user.get("permissions") or {}
    if perms.get("tickets", {}).get("sales"):
        return current_user
    raise HTTPException(status_code=403, detail="Access denied")


async def _require_ticket_editor(current_user: dict = Depends(get_current_user)) -> dict:
    """Staff with tickets.sales, OR any reseller/customer (ownership checked
    separately inside the endpoint, via _assert_ticket_uploader_owns_ticket
    below — reused here despite its "uploader" name since its logic is
    role-generic, not upload-specific). 2026-08-25: `update_order_from_ticket`
    (Edit Quote) moved onto this dependency instead of _require_ticket_driver
    specifically to extend edit access to customer without touching
    _require_ticket_driver itself, which also gates create/cancel/send-quote —
    those three deliberately stay staff/reseller-only, unaffected by this."""
    if current_user.get("is_super_admin") or current_user.get("role") == "super_admin":
        return current_user
    if current_user.get("role") in ("reseller", "customer"):
        return current_user
    if current_user.get("role") not in (ADMIN_ROLES | TICKET_ROLES):
        raise HTTPException(status_code=403, detail="Access denied")
    perms = current_user.get("permissions") or {}
    if perms.get("tickets", {}).get("sales"):
        return current_user
    raise HTTPException(status_code=403, detail="Access denied")


async def _require_ticket_uploader(current_user: dict = Depends(get_current_user)) -> dict:
    """Staff with tickets.sales/finance_confirm, OR any reseller/customer (for
    their own ticket — checked separately inside the endpoint, same split as
    _require_ticket_driver above). First customer-role branch in this file —
    every other helper here only ever passed through "reseller"."""
    if current_user.get("is_super_admin") or current_user.get("role") == "super_admin":
        return current_user
    if current_user.get("role") in ("reseller", "customer"):
        return current_user
    if current_user.get("role") not in (ADMIN_ROLES | TICKET_ROLES):
        raise HTTPException(status_code=403, detail="Access denied")
    perms = current_user.get("permissions") or {}
    if perms.get("tickets", {}).get("sales") or perms.get("tickets", {}).get("finance_confirm"):
        return current_user
    raise HTTPException(status_code=403, detail="Access denied")


async def _assert_ticket_uploader_owns_ticket(ticket: dict, current_user: dict) -> None:
    """Ownership check for the POP upload/download endpoints — mirrors
    _assert_reseller_owns_ticket, extended with the equivalent customer-role
    equality check already used throughout order_routes.py/
    recurring_order_routes.py's customer branches. No-op for staff (already
    gated by permission in _require_ticket_uploader)."""
    role = current_user.get("role")
    if role == "reseller":
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            raise HTTPException(status_code=403, detail="Access denied")
        await _assert_reseller_owns_ticket(ticket, rid)
    elif role == "customer":
        if _ticket_customer_partner_id(ticket) != current_user.get("customer_company_partner_id"):
            raise HTTPException(status_code=403, detail="Access denied")


async def _reseller_id_for_user(user: dict) -> Optional[str]:
    """Return the reseller's `id` field — the same value stored in ticket.reseller_id by create_order."""
    if user.get("role") != "reseller":
        return None
    doc = await col("resellers").find_one({"user_id": user["id"]}, {"id": 1, "_id": 0})
    return doc["id"] if doc else None


def _ticket_customer_partner_id(ticket: dict) -> Optional[int]:
    """The Odoo partner id customer_ownership is actually keyed on for this
    ticket. Order-linked tickets store an already commercial_partner_id-
    resolved company id directly in customer_id (order_routes.py resolves it
    before the ticket is even created). Manually-created tickets
    (POST /api/tickets) may instead have customer_id pointing at a contact
    person, with the resolved parent company separately in
    customer_company_id — prefer that field when present."""
    return ticket.get("customer_company_id") or ticket.get("customer_id")


async def _assert_reseller_owns_ticket(ticket: dict, reseller_id: str) -> None:
    """Raise 403 unless the reseller owns this ticket's customer (Phase 7.13:
    ownership-based, not who-placed-it — ticket.reseller_id is kept for
    traceability display only, no longer used as an access gate)."""
    if not await is_partner_owned_by(reseller_id, _ticket_customer_partner_id(ticket)):
        raise HTTPException(status_code=403, detail="Access denied")


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
        customers = odoo.read("res.partner", [body.customer_id], fields=["name", "email", "parent_id", "is_company"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not customers:
        raise HTTPException(status_code=404, detail="Customer not found")

    _cust = customers[0]
    _parent = _cust.get("parent_id")
    _company_id   = _parent[0] if _parent and _parent is not False else None
    _company_name = _parent[1] if _parent and _parent is not False else None
    _customer_email = _cust.get("email") or None
    if _customer_email is False:
        _customer_email = None

    # Check if this customer is a Samples Account
    meta = await col("customer_metadata").find_one({"odoo_partner_id": body.customer_id}, {"_id": 0})
    is_sample = bool(meta.get("samples_account")) if meta else False

    if is_sample:
        if not body.sample_recipient_id:
            raise HTTPException(status_code=400, detail="Sample recipient is required for a Samples Account customer")
        # Validate recipient exists in Odoo
        try:
            recipient_rows = odoo.read("res.partner", [body.sample_recipient_id], fields=["id", "name"])
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
        if not recipient_rows:
            raise HTTPException(status_code=404, detail="Sample recipient not found")
        _recipient_name = body.sample_recipient_name or recipient_rows[0]["name"]
    else:
        _recipient_name = None

    now = datetime.now(timezone.utc)
    _assignee_id = body.assigned_to or current_user["id"]
    _assignee_name = current_user.get("name") or current_user.get("username") or "unknown"
    _assignee_role = current_user.get("role", "")
    if body.assigned_to and body.assigned_to != current_user["id"]:
        try:
            _au = await col("users").find_one({"_id": ObjectId(body.assigned_to)}, {"name": 1, "username": 1, "role": 1})
        except Exception:
            _au = None
        _assignee_name = (_au.get("name") or _au.get("username")) if _au else body.assigned_to
        _assignee_role = _au.get("role", "") if _au else ""
    doc = {
        "type": "sales",
        "source": "direct",
        "customer_id": body.customer_id,
        "customer_name": _cust["name"],
        "customer_email": _customer_email,
        "customer_is_company": bool(_cust.get("is_company")),
        "customer_company_id": _company_id,
        "customer_company_name": _company_name,
        "is_sample": is_sample,
        "sample_recipient_id": body.sample_recipient_id if is_sample else None,
        "sample_recipient_name": _recipient_name,
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
    await audit_log("ticket.create", "ticket", str(result.inserted_id), entity_label=_cust["name"],
                    user=current_user, after={"status": "open", "customer_id": body.customer_id, "is_sample": is_sample})
    await notify_ticket_assigned("sales", _cust["name"], doc["assigned_to"])
    await broadcast_monitor_refresh()
    return {"success": True, "ticket_id": str(result.inserted_id)}


@router.get("/")
async def list_tickets(
    status: Optional[str] = None,
    exit_status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    reseller_id: Optional[str] = None,
    current_user: dict = Depends(_require_ticket_viewer),
):
    """
    List Sales tickets.
    - Resellers see only their own tickets (scoped by reseller_id automatically).
    - Sales role sees their own queue + unassigned internal tickets + reseller
      tickets only from sale_order onwards (pre-confirm drafts are the reseller's
      workspace, not the staff queue).
    - Admins/super_admins see everything; can pass reseller_id to scope to one
      reseller (used by the Reseller Profile pipeline panel).
    - Finance sees everything (needs cross-rep visibility to find tickets awaiting
      payment confirmation).
    """
    role = current_user.get("role", "")
    query: dict = {"type": "sales"}
    if status:
        query["status"] = status
    if exit_status:
        query["exit_status"] = exit_status

    if role == "reseller":
        # Phase 7.13: a reseller sees every ticket for a customer linked to
        # them, not just tickets they personally placed. customer_id is
        # usually already the company-level id (order-linked tickets always
        # resolve it that way at creation); the customer_company_id clause
        # covers manually-created tickets where a contact person was picked.
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            return {"tickets": [], "total": 0}
        owned_ids = list(await get_owned_partner_ids(rid))
        if not owned_ids:
            return {"tickets": [], "total": 0}
        query["$or"] = [
            {"customer_id": {"$in": owned_ids}},
            {"customer_company_id": {"$in": owned_ids}},
        ]
    elif reseller_id and (current_user.get("is_super_admin") or role in ADMIN_ROLES):
        # Admin drilling into a specific reseller's pipeline (e.g. from Reseller Profile page)
        query["reseller_id"] = reseller_id
    elif assigned_to:
        query["assigned_to"] = assigned_to
    elif role == "sales":
        # Staff sales queue: own tickets + unassigned internal + all reseller tickets
        # (including quote-status drafts so staff can assign, track, and confirm on
        # the reseller's behalf if needed).
        query["$or"] = [
            {"assigned_to": current_user["id"]},
            {"assigned_to": None, "reseller_id": None},
            {"reseller_id": {"$ne": None}},
        ]

    tickets = await col("tickets").find(query).sort("updated_at", -1).to_list(length=500)

    # Backfill reseller_name for old tickets that only have reseller_id
    missing_ids = list({
        t["reseller_id"] for t in tickets
        if t.get("reseller_id") and not t.get("reseller_name")
    })
    if missing_ids:
        reseller_name_map = {
            r["id"]: r["name"]
            async for r in col("resellers").find(
                {"id": {"$in": missing_ids}}, {"id": 1, "name": 1, "_id": 0}
            )
        }
        for t in tickets:
            if t.get("reseller_id") and not t.get("reseller_name"):
                t["reseller_name"] = reseller_name_map.get(t["reseller_id"])
            if t.get("reseller_id") and t.get("source") == "portal":
                t["source"] = "reseller"

    # Batch-resolve order_id integers to human-readable SO names (e.g. S00045).
    # Single Odoo call for all linked orders — non-fatal if Odoo is unavailable.
    # Logged rather than silently swallowed (2026-08-26, found live — the SO #
    # column was blank for every single ticket, with nothing anywhere to
    # explain why; this bare `except: pass` was the only thing in the whole
    # request that could have caused that, so it's now visible in logs the
    # next time it fires instead of degrading invisibly).
    order_ids = list({t["order_id"] for t in tickets if t.get("order_id")})
    if order_ids:
        try:
            odoo = get_odoo_client()
            so_records = odoo.read("sale.order", order_ids, fields=["id", "name"])
            order_name_map = {r["id"]: r["name"] for r in so_records}
            for t in tickets:
                if t.get("order_id"):
                    t["order_name"] = order_name_map.get(t["order_id"])
        except Exception as e:
            logger.warning("list_tickets_order_name_resolve_failed order_ids=%s error=%s", order_ids, e)
            # degrade gracefully — list still works, names just absent

    return {"tickets": [_serialize(t) for t in tickets], "total": len(tickets)}


# ── Literal-path routes — MUST stay before /{ticket_id} ──────────────────────
# FastAPI/Starlette matches routes in registration order. Any literal single
# segment under /api/tickets/ (e.g. /payment-journals, /payment-terms) must be
# registered before GET /{ticket_id} or it gets swallowed by it — the request
# still "succeeds" as far as routing is concerned, it just calls get_ticket()
# with the literal segment as ticket_id, which then 400s "Invalid ticket ID"
# once ObjectId() fails to parse it. Both routes below sat after /{ticket_id}
# for a long time; the bug was invisible because the frontend caught the
# error generically instead of surfacing e.response.data.detail — once that
# was fixed (2026-08-04), this routing bug became visible as "Invalid Ticket
# Id" on Register Deposit instead of the deeper Odoo error it looked like.
# (See order_routes.py for the same pattern, already applied there.)

@router.get("/payment-journals")
async def list_payment_journals(
    order_id: Optional[int] = None,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """Return Odoo bank/cash journals for the deposit/balance registration modals.
    Builds the same descriptive display_label as the invoices journals endpoint
    so the finance team sees bank account numbers and company names, not generic
    'Bank' labels that are indistinguishable in a multi-company setup.

    When order_id is given, scoped to that order's own company — registering a
    payment against a journal from the wrong company is a hard Odoo error
    (payments must be in the same company as the invoice), so filtering the
    options here prevents the mistake instead of surfacing it as a raw Odoo
    error after the fact. Falls back to every company's journals if order_id
    is omitted or its company can't be resolved, rather than blocking the
    modal outright."""
    odoo = get_odoo_client()
    domain: list = [["type", "in", ["bank", "cash"]], ["active", "=", True]]
    if order_id:
        try:
            order_rows = odoo.read("sale.order", [order_id], fields=["company_id"])
            if order_rows and order_rows[0].get("company_id"):
                domain.append(["company_id", "=", order_rows[0]["company_id"][0]])
        except Exception as e:
            logger.warning("payment_journals_order_company_resolve_failed order_id=%s error=%s", order_id, e)
    try:
        journals = odoo.search_read(
            "account.journal",
            domain=domain,
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
        # Was silently caught and papered over with a 200 + empty list — meant
        # the deposit modal just looked broken with no payment methods and
        # nothing landed in Sentry (print() bypasses both the logging module
        # and Sentry's log capture entirely). Raise for real instead.
        logger.error("payment_journals_fetch_failed error=%s", e)
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/payment-terms")
def list_payment_terms(current_user: dict = Depends(require_admin)):
    """All active Odoo payment terms for the quote builder override dropdown."""
    odoo = get_odoo_client()
    terms = odoo.search_read(
        "account.payment.term",
        [("active", "=", True)],
        fields=["id", "name", "note"],
        limit=100,
    )
    return {"payment_terms": terms}


@router.get("/{ticket_id}")
async def get_ticket(
    ticket_id: str,
    current_user: dict = Depends(_require_ticket_viewer),
):
    try:
        oid = ObjectId(ticket_id)
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

    # Full sync with Odoo on every detail fetch. Odoo is the financial source of truth.
    # Handles three cases: cancellation, and forward-advancement through the portal pipeline
    # for orders that were processed directly in Odoo (skipping portal actions). Every sync
    # step is stamped "System (Auto-sync)" in stage_history so users can distinguish it from
    # deliberate portal actions.
    order_id = ticket.get("order_id")
    if order_id and not ticket.get("exit_status"):
        try:
            odoo = get_odoo_client()
            rows = odoo.read(
                "sale.order", [order_id],
                fields=["state", "invoice_ids", "picking_ids", "name", "partner_id", "warehouse_id", "note"],
            )
            if rows:
                row        = rows[0]
                live_state = row["state"]
                now        = datetime.now(timezone.utc)

                if live_state == "cancel":
                    await col("tickets").update_one(
                        {"_id": oid},
                        {
                            "$set": {"odoo_order_state": live_state, "exit_status": "cancelled", "updated_at": now},
                            "$push": {"stage_history": {
                                "status": ticket["status"], "exit_status": "cancelled",
                                "actor_id": "system", "actor_name": "System",
                                "at": now, "note": "Auto-closed: Odoo order was cancelled",
                            }},
                        },
                    )
                    ticket["odoo_order_state"] = live_state
                    ticket["exit_status"]      = "cancelled"
                    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))

                else:
                    set_fields: dict = {"updated_at": now}
                    history:    list = []
                    current_status = ticket.get("status", "open")
                    # Unknown / legacy statuses (e.g. "invoice" from pre-8.39) are treated as
                    # beyond the pipeline so the "never go backward" guard blocks all movement.
                    current_idx    = STATUSES.index(current_status) if current_status in STATUSES else len(STATUSES)

                    if live_state != ticket.get("odoo_order_state"):
                        set_fields["odoo_order_state"] = live_state

                    # ── Determine target portal status ─────────────────────
                    # Confirmed orders (sale/done) advance to awaiting_deposit —
                    # a 50% deposit must be registered (via register-deposit,
                    # below) before a packing board entry can be created. This
                    # applies even to orders confirmed directly in Odoo, bypassing
                    # the portal's confirm flow entirely: the deposit gate is not
                    # something a particular confirm path can skip.
                    _s2s = {"draft": "quote", "sent": "quote", "sale": "awaiting_deposit", "done": "awaiting_deposit"}
                    target_status = _s2s.get(live_state, current_status)

                    target_idx = STATUSES.index(target_status) if target_status in STATUSES else 0

                    # ── Advance (never go backward) ────────────────────────
                    if target_idx > current_idx:
                        _notes = {
                            "sale_order":       f"Auto-sync: Odoo order confirmed (state: {live_state})",
                            "awaiting_deposit": f"Auto-sync: Odoo order confirmed (state: {live_state})",
                        }
                        for stage in STATUSES[current_idx + 1 : target_idx + 1]:
                            history.append({
                                "status": stage, "exit_status": None,
                                "actor_id": "system", "actor_name": "System (Auto-sync)",
                                "at": now,
                                "note": _notes.get(stage, f"Auto-sync: Odoo state {live_state}"),
                            })
                        set_fields["status"] = target_status
                        ticket["status"]     = target_status

                    # ── Commit ────────────────────────────────────────────
                    if set(set_fields) - {"updated_at"} or history:
                        mongo_op: dict = {"$set": set_fields}
                        if history:
                            mongo_op["$push"] = {"stage_history": {"$each": history}}
                        await col("tickets").update_one({"_id": oid}, mongo_op)
                        if history:
                            await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))

        except Exception:
            pass  # Non-fatal — stale display is better than a broken detail page

    # Lazy-backfill parent company + email for tickets created before these fields were stored.
    _needs_backfill = (
        ticket.get("customer_id") and (
            "customer_company_id" not in ticket or
            "customer_email" not in ticket or
            "customer_is_company" not in ticket
        )
    )
    if _needs_backfill:
        try:
            _odoo = get_odoo_client()
            _pr = _odoo.read("res.partner", [ticket["customer_id"]], fields=["parent_id", "email", "is_company"])
            if _pr:
                _bf: dict = {}
                _p = _pr[0].get("parent_id")
                if "customer_company_id" not in ticket:
                    _bf["customer_company_id"]   = _p[0] if _p and _p is not False else None
                    _bf["customer_company_name"] = _p[1] if _p and _p is not False else None
                if "customer_email" not in ticket:
                    _em = _pr[0].get("email")
                    _bf["customer_email"] = _em if _em and _em is not False else None
                if "customer_is_company" not in ticket:
                    _bf["customer_is_company"] = bool(_pr[0].get("is_company"))
                if _bf:
                    ticket.update(_bf)
                    await col("tickets").update_one({"_id": oid}, {"$set": _bf})
        except Exception:
            pass

    # Backfill reseller_name for old tickets that only have reseller_id
    if ticket.get("reseller_id") and not ticket.get("reseller_name"):
        _res = await col("resellers").find_one(
            {"id": ticket["reseller_id"]}, {"name": 1, "_id": 0}
        )
        if _res:
            ticket["reseller_name"] = _res["name"]
    if ticket.get("reseller_id") and ticket.get("source") == "portal":
        ticket["source"] = "reseller"

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

    # Moving a ticket to confirmed_wip ("In Fulfilment") is how an order
    # reaches the packing board — normally done automatically by
    # register_deposit once a deposit is registered (order_routes.py's
    # _queue_packing_board). If that step failed (e.g. Odoo hadn't generated
    # the delivery yet at the time), the ticket can get stuck here with no
    # packing_board entry at all. Rather than let this override just relabel
    # the ticket with nothing behind it, create the entry now via the same
    # canonical path — but only if one doesn't already exist: re-running it
    # against an order already mid-pack would overwrite the packer's
    # progress, item ticks, and QA/RP sign-off with a fresh "queued" doc.
    packing_board_queued = False
    if body.status == "confirmed_wip":
        _target_order_id = body.order_id if body.order_id is not None else ticket.get("order_id")
        if not _target_order_id:
            raise HTTPException(status_code=400, detail="Cannot move to In Fulfilment: ticket has no linked order")
        if not await col("packing_board").find_one({"order_id": str(_target_order_id)}):
            # The 50% deposit gate (8.47) is a hard, non-bypassable requirement —
            # this override may only ever RETRY queueing after a deposit (or the
            # sample-order exemption) already genuinely happened; it must never
            # become a second way to reach the packing board without one.
            if not ticket.get("payment_confirmed_at") and not ticket.get("is_sample"):
                raise HTTPException(
                    status_code=400,
                    detail="A 50% deposit must be registered before this order can reach the packing board. "
                           "Use Register Deposit — Admin Override cannot skip this gate.",
                )
            try:
                await _queue_packing_board(_target_order_id, background_tasks)
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Could not queue packing board: {str(e)}")
            packing_board_queued = True  # status + its own stage_history entry already written

    if body.status and not packing_board_queued:
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
            try:
                _au = await col("users").find_one({"_id": ObjectId(body.assigned_to)}, {"name": 1, "username": 1, "role": 1, "email": 1})
            except Exception:
                _au = None
            updates["assigned_to_name"] = (_au.get("name") or _au.get("username")) if _au else None
            updates["assigned_to_role"] = _au.get("role", "") if _au else ""
        else:
            updates["assigned_to_name"] = None
            updates["assigned_to_role"] = None

    mongo_ops: dict = {"$set": updates}
    # Only append to stage timeline for actual stage changes, not silent assignment
    # (skipped for the confirmed_wip/packing-board-queued case above — that
    # already pushed its own stage_history entry).
    if (body.status and not packing_board_queued) or body.exit_status or body.note:
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
        detail={"packing_board_queued": True} if packing_board_queued else None,
    )
    await broadcast_monitor_refresh()
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
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
            "$set": {"payment_confirmed_by": current_user["id"], "payment_confirmed_at": now, "updated_at": now, "pop_awaiting_review": False},
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
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True, "payment_state": invoice["payment_state"]}


@router.post("/{ticket_id}/create-order")
async def create_order_from_ticket(
    ticket_id: str,
    body: TicketOrderCreate,
    current_user: dict = Depends(_require_ticket_driver),
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
    if current_user.get("role") == "reseller":
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            raise HTTPException(status_code=403, detail="Access denied")
        await _assert_reseller_owns_ticket(ticket, rid)
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

    _is_sample = bool(ticket.get("is_sample"))
    lines = [
        (0, 0, {
            "product_id": l.product_id,
            "product_uom_qty": l.product_uom_qty,
            "price_unit": 0.0 if _is_sample else round(l.price_unit, 2),
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
        "partner_invoice_id": body.partner_invoice_id or customer_id,
        "order_line": lines,
        "note": body.note or "",
    }
    if body.warehouse_id:
        vals["warehouse_id"] = body.warehouse_id
    if body.payment_term_id:
        vals["payment_term_id"] = body.payment_term_id

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
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))

    # Auto-send the quote the moment it's built (2026-08-26) — product owner:
    # staff shouldn't need a separate "Send Quote" click right after this one;
    # by the time they're deciding what to do next, the quote should already
    # be in the customer's inbox and the next real decision is Confirm Order.
    # Re-reads the ticket doc rather than reusing the pre-creation `ticket`
    # variable above, since _send_quote_impl requires order_id to already be
    # set. Never fails or rolls back order creation on a send failure — same
    # non-blocking-failure convention as _queue_packing_board's
    # packing_board_queue_error and 8.55's welcome-pack-send-after-approval —
    # the order was already committed in Odoo by the time this runs.
    quote_sent = False
    send_warning = None
    try:
        ticket_after = await col("tickets").find_one({"_id": oid})
        send_result = await _send_quote_impl(ticket_id, oid, ticket_after, current_user)
        quote_sent = bool(send_result.get("email_sent"))
        send_warning = send_result.get("warning")
    except HTTPException as e:
        send_warning = e.detail if isinstance(e.detail, str) else "Failed to send the quote automatically"
    except Exception as e:
        send_warning = f"Failed to send the quote automatically: {e}"

    result: dict = {"success": True, "odoo_order_id": odoo_order_id, "quote_sent": quote_sent}
    if send_warning:
        result["warning"] = send_warning
    return result


@router.post("/{ticket_id}/cancel-order")
async def cancel_order_from_ticket(
    ticket_id: str,
    current_user: dict = Depends(_require_ticket_driver),
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
    if current_user.get("role") == "reseller":
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            raise HTTPException(status_code=403, detail="Access denied")
        await _assert_reseller_owns_ticket(ticket, rid)
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
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True}


@router.put("/{ticket_id}/update-order")
async def update_order_from_ticket(
    ticket_id: str,
    body: TicketOrderUpdate,
    current_user: dict = Depends(_require_ticket_editor),
):
    """
    Replace line items on an existing draft/sent Odoo sale.order.
    The order must still be in quotation state — confirmed orders are locked
    in Odoo and cannot be edited here. Replaces all lines atomically:
    unlink existing, create new. Logs to ticket timeline and audit trail.

    Customer role (2026-08-25): extended to this endpoint specifically (see
    _require_ticket_editor's own comment for why not via _require_ticket_driver
    itself) — a customer can now edit their own still-draft order's line
    items, same "Edit Quote" flow a reseller already had via My Quotes,
    reachable from their own Order Passport instead.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    is_reseller_caller = current_user.get("role") == "reseller"
    is_customer_caller = current_user.get("role") == "customer"
    if is_reseller_caller:
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            raise HTTPException(status_code=403, detail="Access denied")
        await _assert_reseller_owns_ticket(ticket, rid)
        if body.customer_id:
            raise HTTPException(status_code=403, detail="Resellers cannot change the customer on a quote")
    elif is_customer_caller:
        if _ticket_customer_partner_id(ticket) != current_user.get("customer_company_partner_id"):
            raise HTTPException(status_code=403, detail="Access denied")
        if body.customer_id:
            raise HTTPException(status_code=403, detail="You cannot change the customer on your own order")
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

    if body.partner_invoice_id:
        try:
            odoo.write("sale.order", [order_id], {"partner_invoice_id": body.partner_invoice_id})
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error updating invoice address: {str(e)}")

    if body.payment_term_id:
        try:
            odoo.write("sale.order", [order_id], {"payment_term_id": body.payment_term_id})
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error updating payment terms: {str(e)}")

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
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True, "odoo_order_id": order_id}


async def _send_quote_impl(ticket_id: str, oid: ObjectId, ticket: dict, current_user: dict) -> dict:
    """Core of the quote-send flow — extracted 2026-08-26 so
    create_order_from_ticket can automatically send the quote the moment
    it's built, rather than leaving it to a separate manual "Send Quote"
    click afterward (product owner: the quote should already be in the
    customer's inbox by the time staff decide the next step is Confirm
    Order, not Send Quote). Shared with the standalone POST
    /{ticket_id}/send-quote endpoint below, which callers still use for a
    deliberate resend after editing an already-sent quote — one
    implementation either way, so an Odoo mail-template change never has
    to be made twice. Caller is responsible for the ticket-lookup/exit-
    status/reseller-ownership checks; this assumes `ticket` already
    reflects order_id being set (create_order_from_ticket re-reads its own
    just-updated ticket doc before calling this, rather than reusing its
    pre-creation in-memory copy)."""
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
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))

    result: dict = {"success": True, "email_sent": email_sent}
    if warning:
        result["warning"] = warning
    return result


@router.post("/{ticket_id}/send-quote")
async def send_quote(
    ticket_id: str,
    current_user: dict = Depends(_require_ticket_driver),
):
    """Email the PDF quotation to the customer via Odoo's built-in quotation
    template. Marks the Odoo order as 'sent' and stamps quote_sent_at on the
    ticket. Idempotent — safe to call again after edits (resend); this is
    the deliberate-resend path, since create_order_from_ticket already sends
    the quote automatically the moment it's built."""
    try:
        oid = ObjectId(ticket_id)
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
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    return await _send_quote_impl(ticket_id, oid, ticket, current_user)


@router.get("/{ticket_id}/existing-invoices")
async def list_existing_invoices(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """
    Customer invoices already on this ticket's linked order in Odoo with some
    payment already registered — surfaced in the Register Deposit modal so
    Finance isn't misled into creating a redundant new deposit invoice for an
    order that was already invoiced/paid outside the portal (most commonly a
    historical order confirmed directly in Odoo, later attached to a fresh
    direct-enquiry ticket via link-order). Read-only; see use_existing_invoice
    below for the action that actually consumes one of these.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.get("order_id"):
        return {"invoices": []}

    odoo = get_odoo_client()
    try:
        order_rows = odoo.read("sale.order", [ticket["order_id"]], fields=["invoice_ids"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    inv_ids = order_rows[0].get("invoice_ids", []) if order_rows else []
    if not inv_ids:
        return {"invoices": []}

    try:
        invoices = odoo.read(
            "account.move", inv_ids,
            fields=["id", "name", "amount_total", "amount_residual", "payment_state", "move_type", "state"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error reading invoices: {str(e)}")

    # Only posted customer invoices with some payment already registered are
    # useful here — a draft or wholly-unpaid invoice confirms nothing.
    eligible = [
        i for i in invoices
        if i.get("move_type") == "out_invoice"
        and i.get("state") == "posted"
        and i.get("payment_state") in ("paid", "partial", "in_payment")
    ]
    return {
        "invoices": [
            {
                "invoice_id":      i["id"],
                "invoice_name":    i["name"],
                "amount_total":    i["amount_total"],
                "amount_residual": i["amount_residual"],
                "payment_state":   i["payment_state"],
            }
            for i in eligible
        ],
    }


@router.post("/{ticket_id}/use-existing-invoice")
async def use_existing_invoice(
    ticket_id: str,
    body: UseExistingInvoiceBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """
    Deliberate alternative to register_deposit for an order that was already
    invoiced and (at least partially) paid directly in Odoo before ever being
    tracked in the portal. Links the existing invoice as the ticket's deposit
    invoice instead of creating a redundant new down-payment invoice, then
    queues the packing board exactly like a normal deposit would. This is
    still the same universal 50%-deposit gate (8.47) — it requires a real,
    already-posted invoice with real payment registered against it in Odoo,
    never a bare click — it just doesn't have to be a *new* invoice. Every use
    is audit-logged under its own distinct action (ticket.use_existing_invoice)
    so it's never confused with a normal deposit registration in the trail.
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
    if ticket.get("status") != "awaiting_deposit":
        raise HTTPException(
            status_code=400,
            detail=f"Ticket must be awaiting a deposit to do this (current stage: {ticket.get('status')})",
        )
    if ticket.get("payment_confirmed_at"):
        raise HTTPException(status_code=400, detail="Deposit already registered on this ticket")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()
    try:
        order_rows = odoo.read("sale.order", [order_id], fields=["invoice_ids"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not order_rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    inv_ids = order_rows[0].get("invoice_ids", [])
    if body.invoice_id not in inv_ids:
        raise HTTPException(status_code=400, detail="That invoice does not belong to this ticket's linked order")

    try:
        inv_rows = odoo.read(
            "account.move", [body.invoice_id],
            fields=["name", "amount_total", "amount_residual", "payment_state", "move_type", "state"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error reading invoice: {str(e)}")
    if not inv_rows:
        raise HTTPException(status_code=404, detail="Invoice not found in Odoo")
    inv = inv_rows[0]
    if inv.get("move_type") != "out_invoice" or inv.get("state") != "posted":
        raise HTTPException(status_code=400, detail="Only a posted customer invoice can be used this way")
    if inv.get("payment_state") not in ("paid", "partial", "in_payment"):
        raise HTTPException(status_code=400, detail="This invoice has no payment registered against it in Odoo")

    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {
                "payment_confirmed_by": current_user["id"],
                "payment_confirmed_at": now,
                "invoice_id": body.invoice_id,
                "updated_at": now,
                "pop_awaiting_review": False,
            },
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now,
                "note": f"Used existing Odoo invoice {inv['name']} ({inv['payment_state']}) in place of a new deposit",
            }},
        },
    )
    await audit_log(
        "ticket.use_existing_invoice", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={
            "invoice_id": body.invoice_id, "invoice_name": inv["name"], "payment_state": inv["payment_state"],
            "amount_total": inv["amount_total"], "amount_residual": inv["amount_residual"],
        },
    )

    # Same non-blocking packing-board-queue behavior as register_deposit —
    # the invoice link above is already committed, a queueing hiccup here
    # must never be reported back as if linking the invoice failed.
    packing_board_warning = None
    try:
        await _queue_packing_board(order_id, background_tasks)
    except Exception as e:
        packing_board_warning = str(e)
        logger.warning("queue_packing_board_after_existing_invoice_failed",
                       extra={"ticket_id": ticket_id, "order_id": order_id, "error": packing_board_warning})
        await col("tickets").update_one(
            {"_id": oid},
            {"$set": {"packing_board_queue_error": packing_board_warning, "packing_board_queue_failed_at": now}},
        )
        await audit_log(
            "ticket.packing_board_queue_failed", "ticket", ticket_id,
            entity_label=ticket.get("customer_name", ""), user=current_user,
            detail={"order_id": order_id, "error": packing_board_warning},
        )

    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
    resp = {"success": True, "invoice_id": body.invoice_id}
    if packing_board_warning:
        resp["warning"] = (
            f"Invoice linked successfully, but the order could not be queued for packing: "
            f"{packing_board_warning}. Use Admin Override once resolved to retry."
        )
    return resp


@router.post("/{ticket_id}/pop")
async def upload_proof_of_payment(
    ticket_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    note: Optional[str] = None,
    current_user: dict = Depends(_require_ticket_uploader),
):
    """Customer/reseller self-service Proof of Payment upload (2026-08-21) —
    evidence and a trigger only, never registers a payment itself. Finance
    still explicitly clicks Register Deposit/Register Balance Payment
    afterward, same as today; this just gets the ticket in front of them
    faster than waiting to be told by email/WhatsApp outside the portal.
    Mirrors customer_routes.py::upload_customer_document's R2 upload shape."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is already closed as '{ticket['exit_status']}'")
    await _assert_ticket_uploader_owns_ticket(ticket, current_user)

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")
    if len(contents) > 8 * 1024 * 1024:
        raise HTTPException(status_code=422, detail="File must be under 8MB")

    ext = os.path.splitext(file.filename or "")[1] or ".pdf"
    upload_id = str(uuid.uuid4())
    key = f"tickets/{ticket_id}/pop/{upload_id}{ext}"
    await r2_put(key, contents, content_type=file.content_type or "application/octet-stream")

    now = datetime.now(timezone.utc)
    upload_doc = {
        "id": upload_id,
        "r2_key": key,
        "filename": file.filename,
        "size": len(contents),
        "uploaded_at": now,
        "uploaded_by_name": current_user.get("name") or current_user.get("username", ""),
        "note": (note or "").strip() or None,
    }
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$push": {"pop_uploads": upload_doc},
            "$set": {"pop_awaiting_review": True, "updated_at": now},
        },
    )
    await audit_log(
        "ticket.pop_uploaded", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        after={"filename": file.filename, "size": len(contents)},
    )

    from routes.settings_routes import get_email_routing
    routing = await get_email_routing()
    notify = list(routing.get("pop_uploaded_to") or [])

    # Also notify the sales clerk this ticket is assigned to (2026-08-25) —
    # additive to the configured routing list, not a replacement for it: the
    # configured addresses must always be attempted regardless of whether
    # the ticket happens to be assigned, and an unassigned ticket just means
    # there's no extra address to add, not that the send should be skipped.
    assignee_id = ticket.get("assigned_to")
    if assignee_id:
        try:
            assignee = await col("users").find_one({"_id": ObjectId(assignee_id)}, {"email": 1})
        except Exception:
            assignee = None
        if assignee and assignee.get("email") and assignee["email"] not in notify:
            notify.append(assignee["email"])

    if notify:
        ticket_ref = ticket.get("orders_ticket_ref") or str(oid)
        background_tasks.add_task(
            send_pop_uploaded_notification,
            notify, ticket_ref, ticket.get("customer_name", ""), file.filename,
        )

    return {"success": True, "upload": {k: v for k, v in upload_doc.items() if k != "r2_key"}}


@router.get("/{ticket_id}/pop/{upload_id}/download")
async def download_proof_of_payment(
    ticket_id: str,
    upload_id: str,
    current_user: dict = Depends(_require_ticket_uploader),
):
    """Fresh presigned URL, generated on demand — never baked into the main
    ticket payload since presigned URLs expire."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await _assert_ticket_uploader_owns_ticket(ticket, current_user)

    upload = next((u for u in (ticket.get("pop_uploads") or []) if u.get("id") == upload_id), None)
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    url = await r2_presign(upload["r2_key"])
    return {"url": url, "filename": upload.get("filename")}


@router.post("/{ticket_id}/pop/mark-reviewed")
async def mark_pop_reviewed(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """Clears the awaiting-review flag without registering any payment — for
    a duplicate upload, or one that doesn't need action (e.g. handled another
    way). Finance's queue to clear, same permission that gates Register
    Deposit/Balance Payment; register_deposit/register_balance_payment also
    clear this flag automatically on success, so this is only needed for the
    no-payment-registered case."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    await col("tickets").update_one(
        {"_id": oid},
        {"$set": {"pop_awaiting_review": False, "updated_at": datetime.now(timezone.utc)}},
    )
    await audit_log(
        "ticket.pop_marked_reviewed", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
    )
    return {"success": True}


@router.post("/{ticket_id}/register-deposit")
async def register_deposit(
    ticket_id: str,
    body: TicketDepositRegister,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """
    Register the 50% deposit against the linked sale order — Phase 8.47. This is
    the gate that determines whether an order ever reaches the packing board:
      1. Create a down payment invoice via Odoo's advance payment wizard
      2. Post the invoice (account.move → action_post)
      3. Register and reconcile payment via account.payment.register wizard
      4. Stamp payment_confirmed_by/at + link invoice_id on the ticket
      5. Queue the packing board entry (_queue_packing_board, order_routes.py)
         and advance the ticket to confirmed_wip — nothing gets this far without
         a registered deposit, whether the order was confirmed by staff or
         auto-confirmed via an accepted recurring order.

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
    if ticket.get("status") != "awaiting_deposit":
        raise HTTPException(
            status_code=400,
            detail=f"Ticket must be awaiting a deposit to register one (current stage: {ticket.get('status')})",
        )
    if ticket.get("payment_confirmed_at"):
        raise HTTPException(status_code=400, detail="Deposit already registered on this ticket")

    invoice_type = body.invoice_type or "fixed"
    if invoice_type not in ("fixed", "percentage"):
        # 'delivered' (Odoo's advance_payment_method "Regular invoice" — invoice
        # per the order's own invoice policy) was removed 2026-08-11: every
        # Bassani product is invoice_policy='delivery', and nothing has been
        # delivered yet at deposit-registration time (deposit happens before
        # the order even reaches the packing board) — Odoo can never produce
        # an invoice for this case, it isn't a portal bug. A customer paying
        # the full order upfront should use 'fixed' with the full order total.
        raise HTTPException(status_code=400, detail="invoice_type must be 'fixed' or 'percentage'")
    if invoice_type == "fixed":
        if not body.amount or body.amount <= 0:
            raise HTTPException(status_code=400, detail="Amount must be positive for a fixed invoice")
    if invoice_type == "percentage":
        if not body.percentage or not (0 < body.percentage <= 100):
            raise HTTPException(status_code=400, detail="Percentage must be between 0 and 100")

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

    # Defense in depth — /payment-journals already scopes the dropdown to this
    # order's company, but re-check server-side in case the list was fetched
    # before the ticket had an order, went stale, or this was called directly.
    # A journal from the wrong company is a hard Odoo error deep inside the
    # payment wizard; catching the mismatch here gives a clear portal message
    # instead of a raw Odoo fault.
    if order_company_id and body.journal_id:
        try:
            _journal_rows = odoo.read("account.journal", [body.journal_id], fields=["name", "company_id"])
        except Exception:
            _journal_rows = None
        if _journal_rows:
            _journal_co = _journal_rows[0].get("company_id")
            _journal_co_id = _journal_co[0] if _journal_co else None
            if _journal_co_id and _journal_co_id != order_company_id:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Payment method \"{_journal_rows[0]['name']}\" belongs to a different "
                        f"company than order {_order_row.get('name')} — select a payment method "
                        f"for this order's own warehouse."
                    ),
                )

    # Step 1: Create down payment invoice via Odoo wizard
    ctx = {"active_ids": [order_id], "active_model": "sale.order", "active_id": order_id, **_cctx}
    wizard_vals: dict = {"advance_payment_method": invoice_type}
    if invoice_type == "fixed":
        wizard_vals["fixed_amount"] = body.amount
    elif invoice_type == "percentage":
        wizard_vals["amount"] = body.percentage
    try:
        wizard_id = odoo_call(
            "sale.advance.payment.inv", "create",
            [wizard_vals],
            {"context": ctx},
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to create deposit invoice in Odoo: {str(e)}")

    # Capture invoice_ids before the call so a genuine failure can be told
    # apart from create_invoices' known XML-RPC response-serialization quirk
    # (2026-08-11 fix): the action dict it returns can contain None values
    # the marshaller rejects even though the invoice really was created, but
    # a real Odoo-side failure (e.g. nothing to invoice yet) also raises here
    # and previously looked identical — the old code assumed every exception
    # was the harmless quirk and went hunting for "the new invoice" by
    # grabbing the highest invoice_id on the order, which on a real failure
    # meant grabbing an unrelated, already-posted invoice and trying (and
    # failing) to post it again.
    try:
        _before_rows = odoo.read("sale.order", [order_id], fields=["invoice_ids"])
        _invoice_ids_before = set(_before_rows[0].get("invoice_ids", [])) if _before_rows else set()
    except Exception:
        _invoice_ids_before = set()

    try:
        odoo_call(
            "sale.advance.payment.inv", "create_invoices",
            [[wizard_id]],
            {"context": ctx},
        )
    except Exception as e:
        logger.warning("deposit_create_invoices_response_error",
                       extra={"wizard_id": wizard_id, "error": str(e)})
        try:
            _after_rows = odoo.read("sale.order", [order_id], fields=["invoice_ids"])
            _new_ids = set(_after_rows[0].get("invoice_ids", [])) - _invoice_ids_before if _after_rows else set()
        except Exception:
            _new_ids = set()
        if not _new_ids:
            # No new invoice actually appeared — this was a real failure, not
            # the serialization quirk. Surface Odoo's real message.
            raise HTTPException(status_code=502, detail=f"Failed to create deposit invoice in Odoo: {str(e)}")

    # Resolve the new invoice — must be one that wasn't already on the order
    # before this call, never just "the highest ID" (which could be a stale,
    # already-posted, unrelated invoice).
    try:
        order_data = odoo.read("sale.order", [order_id], fields=["invoice_ids"])
        inv_ids = order_data[0].get("invoice_ids", []) if order_data else []
        new_inv_ids = [i for i in inv_ids if i not in _invoice_ids_before]
        if not new_inv_ids:
            raise HTTPException(status_code=502, detail="Deposit invoice was not created in Odoo — check Odoo configuration")
        invoice_id = max(new_inv_ids)
        odoo.execute("account.move", "action_post", [invoice_id])
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Failed to post deposit invoice: {str(e)}")

    # Resolve invoice amount for non-fixed types (Odoo computes it)
    if invoice_type != "fixed":
        inv_row = odoo.read("account.move", [invoice_id], fields=["amount_residual"])
        pay_amount = inv_row[0]["amount_residual"] if inv_row else body.amount
    else:
        pay_amount = body.amount

    # Step 2: Register and reconcile payment via Odoo wizard
    try:
        pay_ctx = {"active_model": "account.move", "active_ids": [invoice_id], **_cctx}
        pay_wizard_id = odoo_call(
            "account.payment.register", "create",
            [{
                "amount": pay_amount,
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
                "pop_awaiting_review": False,
            },
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now,
                "note": body.note or f"Deposit registered ({invoice_type}) — R{pay_amount:,.2f} via journal {body.journal_id}",
            }},
        },
    )
    await audit_log(
        "ticket.register_deposit", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"invoice_type": invoice_type, "amount": pay_amount, "journal_id": body.journal_id, "invoice_id": invoice_id, "date": body.date},
    )

    # Gate enforcement point — nothing reaches the packing board without this.
    # The deposit above is already committed in Odoo and must never be rolled
    # back or reported as failed because of a problem here (most commonly:
    # Odoo hasn't generated the order's delivery yet). Instead, persist the
    # failure on the ticket so it stays visible until someone retries it — via
    # the Admin Override "Stage" action, which re-queues the packing board
    # when moving a ticket to confirmed_wip with none created yet.
    packing_board_warning = None
    try:
        await _queue_packing_board(order_id, background_tasks)
    except Exception as e:
        packing_board_warning = str(e)
        logger.warning("queue_packing_board_after_deposit_failed",
                       extra={"ticket_id": ticket_id, "order_id": order_id, "error": packing_board_warning})
        await col("tickets").update_one(
            {"_id": oid},
            {"$set": {"packing_board_queue_error": packing_board_warning, "packing_board_queue_failed_at": now}},
        )
        await audit_log(
            "ticket.packing_board_queue_failed", "ticket", ticket_id,
            entity_label=ticket.get("customer_name", ""), user=current_user,
            detail={"order_id": order_id, "error": packing_board_warning},
        )

    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
    resp = {"success": True, "invoice_id": invoice_id}
    if packing_board_warning:
        resp["warning"] = (
            f"Deposit registered successfully, but the order could not be queued for packing: "
            f"{packing_board_warning}. Use Admin Override once resolved to retry."
        )
    return resp


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

    # Defense in depth — see the equivalent check in register_deposit above.
    if order_company_id and body.journal_id:
        try:
            _journal_rows = odoo.read("account.journal", [body.journal_id], fields=["name", "company_id"])
        except Exception:
            _journal_rows = None
        if _journal_rows:
            _journal_co = _journal_rows[0].get("company_id")
            _journal_co_id = _journal_co[0] if _journal_co else None
            if _journal_co_id and _journal_co_id != order_company_id:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"Payment method \"{_journal_rows[0]['name']}\" belongs to a different "
                        f"company than order {order_row.get('name')} — select a payment method "
                        f"for this order's own warehouse."
                    ),
                )

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
                "pop_awaiting_review": False,
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
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True, "invoice_id": invoice_id, "payment_state": final_state, "amount_residual": final_residual}


@router.get("/from-order/preflight")
async def create_ticket_preflight(
    order_id: int,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """Pre-flight check before creating a ticket from an Odoo order.

    Returns whether the order already has an open ticket, and lists open tickets
    for the same customer with no order linked yet (candidates for linking instead
    of creating a new ticket).
    """
    odoo = get_odoo_client()
    try:
        orders = odoo.read("sale.order", [order_id], fields=["name", "partner_id", "state"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not orders:
        raise HTTPException(status_code=404, detail="Order not found in Odoo")
    order = orders[0]

    partner = order.get("partner_id")
    customer_id = partner[0] if partner and partner is not False else None

    existing = await col("tickets").find_one(
        {"order_id": order_id, "type": "sales", "exit_status": None},
        {"_id": 1, "status": 1},
    )

    unlinked = []
    if customer_id:
        async for t in col("tickets").find(
            {"customer_id": customer_id, "type": "sales", "exit_status": None, "order_id": None},
            {"_id": 1, "source": 1, "status": 1, "customer_name": 1, "created_at": 1},
        ).sort("created_at", -1).limit(10):
            unlinked.append({
                "id": str(t["_id"]),
                "source": t.get("source", "direct"),
                "status": t.get("status", "open"),
                "customer_name": t.get("customer_name", ""),
                "created_at": t["created_at"].isoformat() if t.get("created_at") else None,
            })

    return {
        "has_linked_ticket": bool(existing),
        "existing_ticket_id": str(existing["_id"]) if existing else None,
        "existing_ticket_status": existing.get("status") if existing else None,
        "order_name": order["name"],
        "unlinked_tickets": unlinked,
    }


@router.post("/from-order")
async def create_ticket_from_order(
    body: TicketFromOrder,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """Onboard an existing Odoo order into the Sales Ticket pipeline.
    Draft/sent orders start at 'quote' stage. Confirmed orders (state=sale)
    start at 'sale_order' stage — Finance still needs to confirm payment before
    the order reaches the packing board."""
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
    if order["state"] in ("done", "cancel"):
        raise HTTPException(
            status_code=400,
            detail=f"Order {order['name']} is {order['state']} and cannot be brought into the pipeline",
        )
    existing = await col("tickets").find_one({"order_id": body.order_id, "type": "sales", "exit_status": None})
    if existing:
        raise HTTPException(
            status_code=409,
            detail={"message": "A Sales Ticket already exists for this order", "existing_ticket_id": str(existing["_id"])},
        )

    partner = order.get("partner_id")
    customer_id = partner[0] if partner and partner is not False else None
    customer_name = partner[1] if partner and partner is not False else "Unknown"

    # Confirmed orders enter at sale_order stage — quote stage is for drafts only
    is_confirmed = order["state"] == "sale"
    initial_status = "sale_order" if is_confirmed else "quote"
    note = (
        f"Ticket created from confirmed Odoo order {order['name']} — awaiting Finance payment confirmation"
        if is_confirmed
        else f"Ticket created from existing Odoo order {order['name']}"
    )

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
        "status": initial_status,
        "exit_status": None,
        "assigned_to": current_user["id"],
        "assigned_to_name": actor,
        "assigned_to_role": current_user.get("role", ""),
        "payment_confirmed_by": None,
        "payment_confirmed_at": None,
        "incomplete_reason": None,
        "stage_history": [{
            "status": initial_status, "exit_status": None,
            "actor_id": current_user["id"], "actor_name": actor,
            "at": now,
            "note": note,
        }],
        "created_at": now,
        "updated_at": now,
    }
    result = await col("tickets").insert_one(doc)
    await audit_log(
        "ticket.create_from_order", "ticket", str(result.inserted_id),
        entity_label=customer_name,
        user=current_user,
        after={"status": initial_status, "order_id": body.order_id, "order_name": order["name"]},
    )
    await notify_ticket_assigned("sales", customer_name, current_user["id"])
    return {"success": True, "ticket_id": str(result.inserted_id), "status": initial_status}


@router.post("/{ticket_id}/link-order")
async def link_existing_order(
    ticket_id: str,
    body: LinkOrderBody,
    current_user: dict = Depends(require_permission("tickets.sales")),
):
    """Link an existing Odoo sale order to a ticket that has no order yet.

    Advances the ticket stage to match the order's current Odoo state:
    draft/sent → quote, sale/done → sale_order. Never moves the stage backwards.
    Rejects cancelled orders and orders already tracked by another open ticket.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")

    ticket = await col("tickets").find_one({"_id": oid, "type": "sales"})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=409, detail="Ticket is already closed")
    if ticket.get("order_id"):
        raise HTTPException(
            status_code=409,
            detail=(
                f"Ticket already has order #{ticket['order_id']} linked. "
                "Use Admin Override to change the order ID if needed."
            ),
        )

    odoo = get_odoo_client()
    try:
        orders = odoo.read(
            "sale.order",
            [body.order_id],
            fields=["name", "partner_id", "state", "amount_total"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not orders:
        raise HTTPException(status_code=404, detail="Order not found in Odoo")
    order = orders[0]

    if order.get("state") == "cancel":
        raise HTTPException(
            status_code=400,
            detail=f"Order {order['name']} is cancelled in Odoo and cannot be linked.",
        )

    existing = await col("tickets").find_one({
        "order_id": body.order_id,
        "type": "sales",
        "exit_status": None,
        "_id": {"$ne": oid},
    })
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Order {order['name']} is already tracked by another open ticket.",
        )

    odoo_state = order.get("state", "draft")
    _state_to_stage = {"draft": "quote", "sent": "quote", "sale": "sale_order", "done": "sale_order"}
    target_status = _state_to_stage.get(odoo_state, "quote")

    current_status = ticket.get("status", "open")
    current_idx = STATUSES.index(current_status) if current_status in STATUSES else 0
    target_idx  = STATUSES.index(target_status)  if target_status  in STATUSES else 1
    final_status = STATUSES[max(current_idx, target_idx)]

    now   = datetime.now(timezone.utc)
    actor = _actor(current_user)

    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {
                "order_id":         body.order_id,
                "odoo_order_state": odoo_state,
                "status":           final_status,
                "updated_at":       now,
            },
            "$push": {
                "stage_history": {
                    "status":      final_status,
                    "exit_status": None,
                    "actor_id":    current_user["id"],
                    "actor_name":  actor,
                    "at":          now,
                    "note":        f"Linked to existing order {order['name']} (Odoo #{body.order_id})",
                },
            },
        },
    )

    await audit_log(
        "ticket.link_order", "tickets", ticket_id,
        entity_label=f"{ticket.get('customer_name')} → {order['name']}",
        user=current_user,
        before={"order_id": None, "status": ticket.get("status")},
        after={"order_id": body.order_id, "status": final_status, "order_name": order["name"]},
    )
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))

    return {
        "success":    True,
        "order_id":   body.order_id,
        "order_ref":  order["name"],
        "status":     final_status,
        "odoo_state": odoo_state,
    }


@router.put("/{ticket_id}/reassign")
async def reassign_ticket(
    ticket_id: str,
    body: ReassignBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_admin),
):
    """Reassign a ticket to any internal staff member. Admin-only.
    Adds a timeline entry, audit-logs the change, and sends a push
    notification plus email to the new assignee."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")

    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    # Resolve new assignee from portal users — body.assigned_to is the _id string
    try:
        _assignee_oid = ObjectId(body.assigned_to)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid user ID")
    new_user = await col("users").find_one({"_id": _assignee_oid}, {"password": 0})
    if not new_user:
        raise HTTPException(status_code=404, detail="User not found")
    if new_user.get("role") == "reseller":
        raise HTTPException(status_code=422, detail="Cannot assign a ticket to a reseller account")

    new_name = new_user.get("name") or new_user.get("username") or body.assigned_to
    new_role = new_user.get("role", "")
    new_email = new_user.get("email", "")

    prev_name = ticket.get("assigned_to_name") or "Unassigned"
    actor     = _actor(current_user)
    now       = datetime.now(timezone.utc)

    timeline_note = f"Reassigned from {prev_name} to {new_name} by {actor}"

    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {
                "assigned_to":      body.assigned_to,
                "assigned_to_name": new_name,
                "assigned_to_role": new_role,
                "updated_at":       now,
            },
            "$push": {
                "stage_history": {
                    "status":      ticket.get("status"),
                    "exit_status": ticket.get("exit_status"),
                    "actor_id":    current_user["id"],
                    "actor_name":  actor,
                    "at":          now,
                    "note":        timeline_note,
                },
            },
        },
    )

    await audit_log(
        "ticket.reassign", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        before={"assigned_to": ticket.get("assigned_to"), "assigned_to_name": prev_name},
        after={"assigned_to": body.assigned_to, "assigned_to_name": new_name},
    )

    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))

    # Push notification to new assignee
    background_tasks.add_task(
        notify_ticket_assigned,
        "sales",
        ticket.get("customer_name", ""),
        body.assigned_to,
    )

    # Email to new assignee
    if new_email:
        background_tasks.add_task(
            send_ticket_assigned,
            ticket_ref=f"TKT-{ticket_id[-8:].upper()}",
            customer_name=ticket.get("customer_name", ""),
            stage=ticket.get("status", "open"),
            assignee_name=new_name,
            assignee_email=new_email,
        )

    return {
        "success":          True,
        "assigned_to":      body.assigned_to,
        "assigned_to_name": new_name,
        "assigned_to_role": new_role,
    }


# ── 8.24 — Send invoice from portal ──────────────────────────────────────────

@router.post("/{ticket_id}/send-invoice")
async def send_invoice(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """
    Send (or resend) the Odoo invoice PDF to the customer via Odoo's mail system.
    Stamps invoice_sent_at on the ticket. Gracefully degrades if Odoo mail isn't configured.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.get("invoice_id"):
        raise HTTPException(status_code=400, detail="No invoice linked to this ticket yet")

    invoice_id = ticket["invoice_id"]
    odoo = get_odoo_client()

    # Verify invoice exists and is posted
    records = odoo.read("account.move", [invoice_id], fields=["name", "state", "partner_id"])
    if not records:
        raise HTTPException(status_code=404, detail="Invoice not found in Odoo")
    inv = records[0]
    if inv.get("state") != "posted":
        raise HTTPException(status_code=400, detail="Invoice must be posted before sending")

    warning = None
    try:
        # Find Odoo's invoice mail template
        templates = odoo.search_read(
            "mail.template",
            [("model", "=", "account.move")],
            fields=["id", "name"],
            limit=10,
        )
        invoice_template = next(
            (t for t in templates if "invoice" in t["name"].lower()),
            templates[0] if templates else None,
        )
        if invoice_template:
            odoo_call(
                "mail.template", "send_mail",
                [invoice_template["id"], invoice_id],
                {"force_send": True},
            )
        else:
            warning = "No invoice email template found in Odoo — configure one under Email > Templates"
    except Exception as e:
        warning = f"Email may not have been sent: {e}"

    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {"$set": {"invoice_sent_at": now, "updated_at": now}},
    )
    await audit_log(
        "ticket.send_invoice", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"invoice_id": invoice_id, "invoice_name": inv["name"]},
    )
    result: dict = {"success": True, "invoice_sent_at": now.isoformat()}
    if warning:
        result["warning"] = warning
    return result


# ── Super-admin: test data purge ──────────────────────────────────────────────

@router.delete("/{ticket_id}/purge")
async def purge_ticket(
    ticket_id: str,
    current_user: dict = Depends(require_super_admin),
):
    """
    Permanently delete a sales ticket and all traces of it.
    Cascades to the linked packing board entry (all backorders) and every
    audit log record for both.  Irreversible — super_admin only.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")

    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")

    orders_ref = ticket.get("orders_ticket_ref")  # packing board order_id

    deleted: dict = {"ticket": 0, "packing_board": 0, "audit_logs": 0}

    # Cascade: packing board entries for this order (includes backorders)
    if orders_ref:
        pb_result = await col("packing_board").delete_many({"order_id": orders_ref})
        deleted["packing_board"] = pb_result.deleted_count
        al_pb = await col("audit_log").delete_many(
            {"entity_type": "packing_board", "entity_id": orders_ref}
        )
        deleted["audit_logs"] += al_pb.deleted_count

    # Audit logs for the ticket itself (two entity_type values used historically)
    al_t = await col("audit_log").delete_many(
        {"entity_type": {"$in": ["ticket", "tickets"]}, "entity_id": ticket_id}
    )
    deleted["audit_logs"] += al_t.deleted_count

    # The ticket
    await col("tickets").delete_one({"_id": oid})
    deleted["ticket"] = 1

    # Record the purge itself so there's a trace of who cleaned what
    await audit_log(
        "ticket.purge", "admin_purge", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"orders_ref": orders_ref, "deleted": deleted},
    )

    return {
        "success": True,
        "purged": deleted,
        "customer_name": ticket.get("customer_name", ""),
    }
