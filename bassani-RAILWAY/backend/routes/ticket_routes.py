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
import re
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from bson import ObjectId
from config import get_settings
from auth import (
    require_permission, require_any_permission, require_admin,
    get_current_user, get_user_by_username, require_super_admin, ADMIN_ROLES, TICKET_ROLES,
)
from routes.monitor_routes import broadcast_monitor_refresh
from routes.order_routes import _queue_packing_board, _send_order_confirmation_email, order_fulfilment_state, FULLY_DELIVERED_MSG
from routes.packing_board_routes import (
    push_update as _push_packing_board_update, release_collection_holds,
    payment_required_before_collection,
)
from odoo_client import get_odoo_client, odoo as odoo_call, fetch_report_pdf
from warehouse_context import company_context
from database import col
from middleware.audit import audit_log
from services.notification_service import notify_ticket_assigned
from services.email_service import (
    send_ticket_assigned, send_pop_uploaded_notification,
    send_quote_email, send_invoice_email,
    send_release_request_notification, send_release_decision_notification,
)
from routes.settings_routes import get_email_routing
from support_links import order_help_url
from services.r2_client import r2_put, r2_presign
from ownership import get_owned_partner_ids, is_partner_owned_by, get_owning_reseller_id
from account_terms import (
    evaluate_release, commercial_partner_id, get_account_terms, payment_terms_catalog,
    is_credit_term, read_company_credit,
)
from portal_sales_agent import sync_portal_sales_agent
from discount_requests import cancel_pending_request
from services.age_tier import ticket_age_fields
from deposit_integrity import (
    customer_unallocated, invoice_outstanding, apply_credit, order_deposit_state,
    restore_deposit_invoice, unallocated_detail,
)

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
# awaiting_payment (8.69): packed and signed off, but the customer is only
# told it is ready once the final invoice is paid (deposit balance, or a
# pay-before-collection order).
STATUSES = ["open", "quote", "sale_order", "awaiting_deposit", "confirmed_wip", "awaiting_payment",
            "ready_for_collection", "incomplete"]

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
    journal_id: Optional[int] = None   # required unless use_credit_line_id is given
    note: Optional[str] = ""
    # 8.72 — apply a payment already on the customer's account (an
    # unallocated account.move.line) to the deposit invoice instead of
    # recording a new payment.
    use_credit_line_id: Optional[int] = None
    # 8.72 — must be True to record a NEW payment when the customer already
    # has unallocated payments that could be applied instead.
    confirm_new_payment: bool = False
    # 8.71 — required when the deposit is under TOKEN_DEPOSIT_PCT of the order
    # total. Token deposits (e.g. R1) were being used to get past the gate,
    # leaving a junk invoice and payment in the books; Request Release on
    # Account is the proper route for a customer with a payment agreement.
    small_deposit_reason: Optional[str] = None
    # 8.69d — False when Finance chooses not to email the customer (and their
    # reseller), e.g. recording a payment on an old order already collected.
    # Defaults True so every other caller behaves exactly as before.
    notify_customer: bool = True


TOKEN_DEPOSIT_PCT = 10.0


class TicketBalancePayment(BaseModel):
    amount: float
    date: str           # YYYY-MM-DD
    journal_id: int
    note: Optional[str] = ""
    # 8.72 — must be True to record a NEW payment when the customer already
    # has unallocated payments or credits that could be applied instead.
    confirm_new_payment: bool = False
    # 8.69d — False when Finance chooses not to email the customer (and their
    # reseller), e.g. recording a payment on an old order already collected.
    # Defaults True so every other caller behaves exactly as before.
    notify_customer: bool = True


class UseExistingInvoiceBody(BaseModel):
    invoice_id: int
    # 8.69d — False when Finance chooses not to email the customer (and their
    # reseller), e.g. recording a payment on an old order already collected.
    # Defaults True so every other caller behaves exactly as before.
    notify_customer: bool = True


class TicketFromOrder(BaseModel):
    order_id: int


class LinkOrderBody(BaseModel):
    order_id: int


class ReassignBody(BaseModel):
    assigned_to: str  # portal user ID


class SendRecipientsBody(BaseModel):
    """Recipient picker (2026-08-27) — Send Quote/Send Invoice. recipients[0]
    is used as the primary To address, any further entries as CC. Optional
    on both endpoints so an older client (or a future automated caller) that
    omits it still gets the pre-existing single-auto-resolved-recipient
    behavior."""
    recipients: Optional[List[str]] = None


# ── Helpers ───────────────────────────────────────────────────────────────────

def _serialize(t: dict) -> dict:
    t["id"] = str(t.pop("_id"))
    # age_tier (2026-08-26) — same deadline/clock logic monitor_routes.py
    # uses for the Operations Monitor's Quotes/Deposit columns, so this
    # ticket's badge can never disagree with its own card on that board.
    t.update(ticket_age_fields(t))
    # Self-heal (2026-08-27): create_ticket used to fall back to the raw
    # assigned_to ObjectId string as assigned_to_name on a failed/missing
    # user lookup (fixed at the source above) — a ticket written before that
    # fix still has the ID permanently stored as its "name". Rather than a
    # one-off data migration, null it out on read so it displays the normal
    # "Unassigned" state instead of a raw ID, same self-heal-on-read
    # convention already used for historical audit rows (middleware/audit.py).
    if t.get("assigned_to_name") and t["assigned_to_name"] == t.get("assigned_to"):
        t["assigned_to_name"] = None
    return t


def _actor(current_user: dict) -> str:
    return current_user.get("name") or current_user.get("username") or "unknown"


async def _cancel_linked_packing_board(order_id, reason: Optional[str] = None, actor: Optional[dict] = None) -> None:
    """The missing reverse leg of packing_board_routes.py's _sync_sales_ticket
    (2026-09-07). That function already pushes packing-board outcomes
    (complete/incomplete/cancelled) back onto the linked Sales ticket, but
    nothing ever went the other way: closing a Sales ticket as cancelled
    (via the Odoo-order-cancelled auto-sync below, or an Admin Override
    exit_status write) left any already-created packing_board ("Order
    Ticket") entry sitting active — still shown on the Operations Monitor
    and OrdersTickets.js, contradicting the ticket it exists to track.
    Cancels every non-terminal packing_board entry for this order (there
    can be more than one — a primary delivery plus a re-queued backorder
    child share one order_id, 2026-08-23), mirroring cancel_entry's own
    field shape exactly. Best-effort and silent on failure, same convention
    as _sync_sales_ticket itself — a sync failure here must never block the
    ticket-cancel action that triggered it."""
    try:
        now = datetime.now(timezone.utc)
        cursor = col("packing_board").find({
            "order_id": str(order_id),
            "status": {"$nin": ["collected", "cleared", "cancelled", "complete", "incomplete"]},
        })
        entries = await cursor.to_list(length=50)
        for entry in entries:
            updated = await col("packing_board").find_one_and_update(
                {"_id": entry["_id"]},
                {"$set": {
                    "status": "cancelled",
                    "cancelled_at": now,
                    "incomplete_reason": reason or "Linked Sales ticket was cancelled",
                }},
                return_document=True,
            )
            updated.pop("_id", None)
            await _push_packing_board_update(updated)
            await audit_log(
                "packing.cancelled", "packing_board", str(order_id), entity_label=str(order_id),
                user=actor, detail={"reason": reason or "Linked Sales ticket was cancelled", "source": "ticket_cancel_sync"},
            )
        if entries:
            await broadcast_monitor_refresh()
    except Exception as e:
        logger.warning("packing_board_cancel_sync_failed order_id=%s error=%s", order_id, e)


def _deposit_gate_cleared(ticket: dict) -> bool:
    """Has this ticket cleared the deposit gate (8.47)? True once a deposit is
    confirmed, the order was released on account by an authorised user (8.68),
    or it's a sample order (nothing to deposit). The single definition every
    "may this order reach the packing board" check uses — payment_confirmed_at
    alone means money received, which an on-account order deliberately
    doesn't have at this point."""
    return bool(
        ticket.get("payment_confirmed_at")
        or ticket.get("released_on_account_at")
        or ticket.get("pbc_approved_at")      # 8.69 — pay before collection
        or ticket.get("is_sample")
    )


def _order_invoices(odoo, invoice_ids: list) -> list:
    """Posted customer invoices on an order (cancelled and draft ignored)."""
    if not invoice_ids:
        return []
    rows = odoo.read(
        "account.move", list(invoice_ids),
        fields=["id", "name", "amount_total", "amount_residual", "payment_state", "move_type", "state",
                "invoice_date", "invoice_date_due"],
    )
    return [r for r in rows if r.get("move_type") == "out_invoice" and r.get("state") == "posted"]


def _paid_on_invoices(invoices: list) -> float:
    """Money received across an order's posted invoices. A final invoice
    already nets off any down payment (live-checked on Odoo 19: it carries a
    negative "Down Payment" line), so summing what's been paid on each posted
    invoice never counts a deposit twice."""
    return round(sum(float(i.get("amount_total") or 0) - float(i.get("amount_residual") or 0) for i in invoices), 2)


async def _advance_ticket_to_odoo_state(ticket: dict, live_state: str, now: datetime) -> bool:
    """Move a ticket forward to match its Odoo order's live state (never
    backwards), stamping each skipped stage "System (Auto-sync)" in
    stage_history. Confirmed orders (sale/done) advance to awaiting_deposit:
    the deposit gate applies even to orders confirmed directly in Odoo,
    bypassing the portal's confirm flow. Cancellation is handled by the
    caller, not here. Mutates ticket["status"]; returns True if it moved.

    Shared by get_ticket (on every detail fetch) and Expected Payments
    (8.69d), so a ticket whose order was confirmed in Odoo reaches Finance's
    deposit list without anyone having to open it first."""
    set_fields: dict = {"updated_at": now}
    history:    list = []
    current_status = ticket.get("status", "open")
    # Unknown / legacy statuses (e.g. "invoice" from pre-8.39) are treated as
    # beyond the pipeline so the "never go backward" guard blocks all movement.
    current_idx = STATUSES.index(current_status) if current_status in STATUSES else len(STATUSES)

    if live_state != ticket.get("odoo_order_state"):
        set_fields["odoo_order_state"] = live_state
        ticket["odoo_order_state"] = live_state

    _s2s = {"draft": "quote", "sent": "quote", "sale": "awaiting_deposit", "done": "awaiting_deposit"}
    target_status = _s2s.get(live_state, current_status)
    target_idx = STATUSES.index(target_status) if target_status in STATUSES else 0

    if target_idx > current_idx:
        note = (f"Auto-sync: Odoo order confirmed (state: {live_state})"
                if target_status == "awaiting_deposit" else f"Auto-sync: Odoo state {live_state}")
        for stage in STATUSES[current_idx + 1 : target_idx + 1]:
            history.append({
                "status": stage, "exit_status": None,
                "actor_id": "system", "actor_name": "System (Auto-sync)",
                "at": now,
                "note": note if stage in ("sale_order", "awaiting_deposit") else f"Auto-sync: Odoo state {live_state}",
            })
        set_fields["status"] = target_status
        ticket["status"] = target_status

    if set(set_fields) - {"updated_at"} or history:
        mongo_op: dict = {"$set": set_fields}
        if history:
            mongo_op["$push"] = {"stage_history": {"$each": history}}
        await col("tickets").update_one({"_id": ticket["_id"]}, mongo_op)
        if history:
            await ticket_manager.broadcast(str(ticket["_id"]), _ticket_customer_partner_id(ticket))
    return bool(history)


def _order_amount_owing(odoo, order_id: int, order_total: float) -> float:
    """What is still owing on an order: its total less every payment received
    on its posted invoices (deposits, advance payments, final invoices)."""
    try:
        rows = odoo.read("sale.order", [order_id], fields=["invoice_ids"])
        invoices = _order_invoices(odoo, rows[0].get("invoice_ids", []) if rows else [])
    except Exception:
        invoices = []
    return max(round(order_total - _paid_on_invoices(invoices), 2), 0.0)


async def _resolve_balance_invoice(odoo, order_id: int, invoice_ids: list) -> Optional[dict]:
    """The invoice a balance payment should go against (8.69 fix). Previously
    "the customer invoice with the largest total", which picks the wrong one
    when a deposit is 50% or more (a 50/50 order has two equal invoices, live-
    checked on S00907) and never excluded cancelled invoices. Now: the oldest
    unpaid posted invoice linked to one of this order's deliveries, else the
    unpaid posted invoice with the most owing. None when nothing is owing."""
    invoices = _order_invoices(odoo, invoice_ids)
    open_invoices = [i for i in invoices if float(i.get("amount_residual") or 0) > 0.005]
    if not open_invoices:
        return None
    linked = set()
    async for e in col("packing_board").find(
        {"order_id": str(order_id), "invoice_id": {"$nin": [None, False]}}, {"invoice_id": 1},
    ):
        linked.add(int(e["invoice_id"]))
    delivery_invoices = sorted((i for i in open_invoices if i["id"] in linked), key=lambda i: i["id"])
    if delivery_invoices:
        return delivery_invoices[0]
    return max(open_invoices, key=lambda i: float(i.get("amount_residual") or 0))


async def _compute_override_gaps(ticket: dict) -> list:
    """Detects a real gap between what ticket.status/exit_status claims and
    what packing_board actually backs it with (2026-08-28) — independent of
    HOW the gap was created (Admin Override — update_ticket_stage's blind
    status write below — is the only currently-possible cause, but this
    stays mechanism-agnostic so it also catches any future desync source).
    Returns an ordered, always-contiguous list of gap keys the
    reconciliation wizard (packing_board_routes.py's retroactive/* endpoints)
    steps through: packing_entry -> qa_approval -> rp_approval ->
    final_invoice. Empty means the ticket's claimed status is honestly
    backed by real data. Balance-payment status is deliberately left to the
    frontend, which already has live invoice/payment data
    (detailOutstanding) without a redundant Odoo read here."""
    claims_wip = ticket.get("status") in ("confirmed_wip", "awaiting_payment", "ready_for_collection") or ticket.get("exit_status") == "complete"
    if not claims_wip:
        return []
    order_id = ticket.get("order_id")
    if not order_id:
        return []
    try:
        packing = await col("packing_board").find_one({"order_id": str(order_id)})
    except Exception:
        return []
    claims_done = ticket.get("status") in ("awaiting_payment", "ready_for_collection") or ticket.get("exit_status") == "complete"
    if not packing:
        gaps = ["packing_entry"]
        if claims_done:
            gaps += ["qa_approval", "rp_approval", "final_invoice"]
        return gaps
    if not claims_done:
        return []
    gaps = []
    if not packing.get("qa_approved_at"):
        gaps.append("qa_approval")
    if not packing.get("rp_approved_at"):
        gaps.append("rp_approval")
    if not packing.get("invoice_id"):
        gaps.append("final_invoice")
    return gaps


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
        # Found live 2026-08-27: on a failed/missing lookup this fell back to
        # the raw Mongo ObjectId string, which the frontend then displayed
        # verbatim as the "Assigned to" name instead of a person's name.
        # None matches update_ticket_stage's own already-correct fallback
        # for the identical lookup a few lines below in this file.
        _assignee_name = (_au.get("name") or _au.get("username")) if _au else None
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
    await sync_portal_sales_agent(doc)  # 2026-08-26 — see portal_sales_agent.py
    await notify_ticket_assigned("sales", _cust["name"], doc["assigned_to"])
    await broadcast_monitor_refresh()
    return {"success": True, "ticket_id": str(result.inserted_id)}


_TKT_REF_SEARCH_RE = re.compile(r"^TKT-?([0-9a-fA-F]{1,8})$", re.IGNORECASE)


def _ticket_search_clause(q: str) -> Optional[dict]:
    """
    Mongo `$or` for the Sales Tickets list search (2026-09-21). Runs server-side
    so it covers the full ticket history, not just the 500 most recent tickets
    the list loads by default. Matches customer/company/reseller/assignee names
    and the TKT-XXXXXXXX reference (full or partial suffix). The SO number
    lives in Odoo, not Mongo, so the caller resolves it separately and ORs
    the resulting order_ids in.
    """
    q = q.strip()
    if not q:
        return None
    rx = {"$regex": re.escape(q), "$options": "i"}
    clauses: list = [
        {"customer_name": rx},
        {"customer_company_name": rx},
        {"reseller_name": rx},
        {"assigned_to_name": rx},
    ]
    m = _TKT_REF_SEARCH_RE.match(q)
    if m:
        # Partial suffix match on the ObjectId's last 8 hex chars, the same
        # ref format the rest of the app displays as TKT-XXXXXXXX.
        clauses.append({"$expr": {"$regexMatch": {
            "input": {"$toLower": {"$substrCP": [{"$toString": "$_id"}, 16, 8]}},
            "regex": "^" + re.escape(m.group(1).lower()),
        }}})
    return {"$or": clauses}


@router.get("/")
async def list_tickets(
    status: Optional[str] = None,
    exit_status: Optional[str] = None,
    assigned_to: Optional[str] = None,
    reseller_id: Optional[str] = None,
    search: Optional[str] = None,
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

    # Server-side search (2026-09-21) — combined with the role-scoped query via
    # $and so a search can never widen what this caller is allowed to see.
    search_clause = _ticket_search_clause(search or "")
    if search_clause:
        # SO numbers live in Odoo, not Mongo: resolve matching sale.order ids
        # by name (partial, so "1116" finds S01116) and OR them in. Non-fatal:
        # if Odoo is unavailable the Mongo-side fields still match.
        try:
            so_rows = get_odoo_client().search_read(
                "sale.order", domain=[("name", "ilike", search.strip())], fields=["id"], limit=50,
            )
            if so_rows:
                search_clause["$or"].append({"order_id": {"$in": [r["id"] for r in so_rows]}})
        except Exception as e:
            logger.warning("list_tickets_search_so_lookup_failed q=%s error=%s", search, e)
        query = {"$and": [query, search_clause]}

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
    # Root cause found live 2026-08-26 (SO # column blank for every single
    # ticket, not just the affected one): this used odoo.read(order_ids, ...),
    # a direct pass-through to Odoo's own `read()` ORM method (confirmed in
    # odoo_client.py) — which raises MissingError for the *entire* batch if
    # even one id in it no longer exists in Odoo (easy to end up with: test
    # data cleanup, an order deleted directly in Odoo, a stale order_id left
    # on a ticket). One bad id in the shared list-wide batch poisoned every
    # other ticket's SO # too. Switched to search_read() with an `id in [...]`
    # domain instead — same resilient pattern already used elsewhere in this
    # codebase (e.g. order_routes.py's SO-name lookups) — which never raises
    # for a missing/inaccessible id, it just omits it from the results, so
    # one stale reference no longer takes down every other ticket's SO # with
    # it. The exception logging (rather than a bare `except: pass`) is kept
    # as defense in depth for a genuine Odoo connectivity failure.
    order_ids = list({t["order_id"] for t in tickets if t.get("order_id")})
    if order_ids:
        try:
            odoo = get_odoo_client()
            so_records = odoo.search_read("sale.order", domain=[("id", "in", order_ids)], fields=["id", "name"], limit=len(order_ids))
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


DEPOSIT_PCT = 50.0   # the deposit asked for on the pro-forma (send_deposit_due_proforma)
_PAID_STATES = ("paid", "partial", "in_payment")
_BALANCE_WAITING_STAGES = ("packed_waiting", "packed_notified")


async def _expected_deposit_rows(odoo, exclude_order_ids: set) -> list:
    """8.69d — confirmed orders still waiting on their deposit (the first
    payment on a normal order), for Finance's Expected Payments list.

    First catches up tickets the portal hasn't seen confirmed yet: a ticket
    only moves to awaiting_deposit when someone opens it if its order was
    confirmed directly in Odoo, or when Link Existing Order wrote the old
    sale_order stage. Those are advanced here with the same auto-sync
    get_ticket uses, so Finance never has to wait for someone to open them.

    The expected deposit is DEPOSIT_PCT of the order total less anything
    already paid on its posted invoices. Pay-before-collection orders are
    left to the balance rows (exclude_order_ids); samples owe nothing."""
    now = datetime.now(timezone.utc)

    lagging = await col("tickets").find({
        "type": "sales", "exit_status": None, "order_id": {"$ne": None},
        "status": {"$in": ["open", "quote", "sale_order"]},
    }).to_list(2000)
    if lagging:
        ids = list({t["order_id"] for t in lagging})
        try:
            states = {o["id"]: o["state"] for o in odoo.search_read(
                "sale.order", [("id", "in", ids), ("state", "in", ["sale", "done"])],
                fields=["id", "state"], limit=len(ids),
            )}
        except Exception as e:
            logger.warning("expected_payments_state_catchup_failed error=%s", e)
            states = {}
        for t in lagging:
            if t["order_id"] in states:
                try:
                    await _advance_ticket_to_odoo_state(t, states[t["order_id"]], now)
                except Exception as e:
                    logger.warning("expected_payments_advance_failed ticket=%s error=%s", t["_id"], e)

    tickets = [t for t in await col("tickets").find({
        "type": "sales", "exit_status": None, "order_id": {"$ne": None}, "status": "awaiting_deposit",
    }).to_list(1000) if t["order_id"] not in exclude_order_ids
        and not t.get("is_sample") and t.get("payment_arrangement") != "pay_before_collection"]
    if not tickets:
        return []

    order_ids = list({t["order_id"] for t in tickets})
    orders = {o["id"]: o for o in odoo.search_read(
        "sale.order", [("id", "in", order_ids)],
        fields=["id", "name", "amount_total", "invoice_ids", "state"], limit=len(order_ids),
    )}
    invoices = {i["id"]: i for i in _order_invoices(
        odoo, list({i for o in orders.values() for i in (o.get("invoice_ids") or [])}))}
    try:
        fulfilment = order_fulfilment_state(odoo, order_ids)
    except Exception as e:
        logger.warning("expected_payments_fulfilment_failed error=%s", e)
        fulfilment = {}

    rows = []
    for t in tickets:
        order = orders.get(t["order_id"])
        if not order or order.get("state") not in ("sale", "done"):
            continue
        order_invoices = [invoices[i] for i in (order.get("invoice_ids") or []) if i in invoices]
        total = float(order.get("amount_total") or 0)
        paid = _paid_on_invoices(order_invoices)
        expected = round(total * DEPOSIT_PCT / 100, 2)
        due = max(round(expected - paid, 2), 0.0)
        paid_invoices = sorted((i for i in order_invoices if i.get("payment_state") in _PAID_STATES),
                               key=lambda i: -(float(i.get("amount_total") or 0) - float(i.get("amount_residual") or 0)))
        rr = t.get("release_request") or {}
        link_invoice = None

        if fulfilment.get(t["order_id"], {}).get("delivered"):
            # Delivered entirely in Odoo before the portal tracked it: not a
            # deposit to collect, and never to be queued for packing.
            stage = "deposit_delivered"
            stage_label = "Already delivered in Odoo"
            pay_mode = None
            due = 0.0
            rr = {"reason": "A super admin can close this ticket from Orders Tickets > Close Fulfilled Orders."}
        elif t.get("payment_confirmed_at") or t.get("released_on_account_at"):
            # Gate already cleared but the packing board was never created
            # (packing_board_queue_error). Nothing to collect; it needs the
            # Admin Override retry on the Sales ticket.
            stage = "deposit_stuck"
            stage_label = ("Released on account, not on packing board" if t.get("released_on_account_at")
                           else "Deposit received, not on packing board")
            pay_mode = None
            due = 0.0
        elif paid_invoices:
            stage, stage_label, pay_mode = "deposit_unlinked", "Paid in Odoo, not linked to the ticket", "link"
            link_invoice = paid_invoices[0]
        elif rr.get("status") == "pending":
            stage = "deposit_requested"
            stage_label = ("Pay before collection requested" if rr.get("kind") == "pay_before_collection"
                           else "Release on account requested")
            pay_mode = "deposit"
        elif t.get("auto_release_held"):
            stage, stage_label, pay_mode = "deposit_held", "Account customer, not released automatically", "deposit"
        else:
            stage, stage_label, pay_mode = "deposit_due", "Deposit due", "deposit"

        # Same clock and 72h deadline as the Sales ticket's own age badge and
        # the Operations Monitor's Deposit column (services/age_tier.py), so
        # the three can never disagree about whether this order is overdue.
        age = ticket_age_fields(t)
        hours = age.get("hours_elapsed")
        rows.append({
            "ticket_id": str(t["_id"]),
            "ref": f"TKT-{str(t['_id'])[-8:].upper()}",
            "customer_name": t.get("customer_name"),
            "reseller_name": t.get("reseller_name"),
            "assigned_to_name": t.get("assigned_to_name"),
            "order_id": t["order_id"],
            "order_name": order.get("name"),
            "order_total": total,
            "amount_paid": paid,
            "amount_due": due,
            "expected_deposit": expected,
            "invoice_id": link_invoice["id"] if link_invoice else None,
            "invoice_name": link_invoice["name"] if link_invoice else None,
            "invoice_residual": None,
            "invoice_due_date": None,
            "arrangement": "deposit_upfront",
            "row_type": "deposit",
            "stage": stage,
            "stage_label": stage_label,
            "stage_detail": " ".join((t.get("auto_release_held") or {}).get("blocks") or []) or
                            t.get("packing_board_queue_error") or rr.get("reason") or None,
            "waiting_since": t.get("created_at"),
            "days_waiting": int(hours // 24) if hours is not None else None,
            "age_tier": age.get("age_tier"),
            "pop_awaiting_review": bool(t.get("pop_awaiting_review")),
            "pop_count": len(t.get("pop_uploads") or []),
            "pay_mode": pay_mode,
            "customer_notified_at": None,
        })
    return rows


@router.get("/expected-payments")
async def list_expected_payments(
    view: str = "waiting",
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """8.69 — Finance's list of payments to look out for, one row per order,
    amounts read live from Odoo:
      * deposits due (8.69d): confirmed orders waiting on their 50% deposit
        before they can be packed;
      * balances due: every pay-before-collection order not yet paid in full,
        and every deposit order packed and waiting on its balance.

    view: waiting (balances on packed orders: the customer is waiting to hear),
    deposits, not_packed (pay-before-collection approved, still being packed or
    signed off), all, or paid_today (released today, to confirm the day's work
    landed). Counts and totals always cover every view, so the tab badges are
    right whichever one is open.
    Literal route, so it must stay registered before GET /{ticket_id}."""
    now = datetime.now(timezone.utc)
    sast_today_start = (now + timedelta(hours=2)).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(hours=2)

    if view == "paid_today":
        released = await col("packing_board").find(
            {"collection_released_at": {"$gte": sast_today_start}}, {"order_id": 1},
        ).to_list(500)
        ticket_query = {"type": "sales", "order_id": {"$in": [int(e["order_id"]) for e in released
                                                               if str(e.get("order_id", "")).isdigit()]}}
        tickets = await col("tickets").find(ticket_query).to_list(500)
    else:
        tickets = await col("tickets").find({
            "type": "sales", "exit_status": None, "order_id": {"$ne": None},
            "$or": [{"payment_arrangement": "pay_before_collection"}, {"status": "awaiting_payment"}],
        }).to_list(1000)
        # Deposit orders completed before 8.69 that still owe a balance (no
        # payment_hold field): the same list, so nothing is missed.
        legacy = await col("packing_board").find(
            {"status": "complete", "collected_at": None, "payment_hold": {"$exists": False}}, {"order_id": 1},
        ).to_list(1000)
        known = {t["order_id"] for t in tickets}
        legacy_ids = [int(e["order_id"]) for e in legacy
                      if str(e.get("order_id", "")).isdigit() and int(e["order_id"]) not in known]
        if legacy_ids:
            extra = await col("tickets").find({"type": "sales", "exit_status": None, "order_id": {"$in": legacy_ids}}).to_list(1000)
            tickets += [t for t in extra if payment_required_before_collection(t)]

    odoo = get_odoo_client()
    rows = []
    if tickets:
        order_ids = list({t["order_id"] for t in tickets})
        entries_by_order: dict = {}
        async for e in col("packing_board").find(
            {"order_id": {"$in": [str(i) for i in order_ids]}, "status": {"$ne": "cleared"}},
            {"_id": 0, "order_id": 1, "status": 1, "invoice_id": 1, "inv_num": 1, "payment_hold": 1,
             "payment_hold_at": 1, "completed_at": 1, "collection_released_at": 1, "customer_notified_at": 1,
             "collected_at": 1, "is_backorder": 1, "waiting_stock": 1},
        ):
            entries_by_order.setdefault(int(e["order_id"]), []).append(e)

        try:
            orders = {o["id"]: o for o in odoo.search_read(
                "sale.order", [("id", "in", order_ids)],
                fields=["id", "name", "amount_total", "invoice_ids", "state"], limit=len(order_ids),
            )}
            all_inv_ids = list({i for o in orders.values() for i in (o.get("invoice_ids") or [])})
            invoices = {i["id"]: i for i in _order_invoices(odoo, all_inv_ids)}
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

        for t in tickets:
            order = orders.get(t["order_id"])
            if not order or order.get("state") == "cancel":
                continue
            order_invoices = [invoices[i] for i in (order.get("invoice_ids") or []) if i in invoices]
            total = float(order.get("amount_total") or 0)
            paid = _paid_on_invoices(order_invoices)
            due = max(round(total - paid, 2), 0.0)
            entries = entries_by_order.get(t["order_id"], [])
            linked = {int(e["invoice_id"]) for e in entries if e.get("invoice_id")}
            open_invoices = [i for i in order_invoices if float(i.get("amount_residual") or 0) > 0.005]
            open_inv = (sorted((i for i in open_invoices if i["id"] in linked), key=lambda i: i["id"]) or
                        sorted(open_invoices, key=lambda i: -float(i.get("amount_residual") or 0)) or [None])[0]

            held = [e for e in entries if e.get("payment_hold") and not e.get("collection_released_at")]
            legacy_unpaid = [e for e in entries if e.get("status") == "complete" and "payment_hold" not in e
                             and not e.get("collected_at") and e.get("invoice_id") in {i["id"] for i in open_invoices}]
            released_today = [e for e in entries if e.get("collection_released_at")
                              and e["collection_released_at"].replace(tzinfo=timezone.utc) >= sast_today_start]
            statuses = {e.get("status") for e in entries}
            if view == "paid_today":
                if not released_today:
                    continue
                stage, stage_label = "paid", "Paid, customer notified"
            elif held:
                stage, stage_label = "packed_waiting", "Packed, waiting on payment"
            elif legacy_unpaid:
                stage, stage_label = "packed_notified", "Packed, customer already told it's ready"
            elif statuses & {"ready"}:
                stage, stage_label = "signoff", "Packed, awaiting QA/RP"
            elif statuses & {"queued", "packing", "waiting_stock"}:
                stage, stage_label = "packing", "Being packed"
            elif entries:
                stage, stage_label = "in_progress", "In fulfilment"
            else:
                stage, stage_label = "approved", "Approved, not on the packing board yet"
            if view != "paid_today" and due <= 0.005:
                continue

            since = None
            if held:
                since = min((e.get("payment_hold_at") or e.get("completed_at") for e in held if e.get("payment_hold_at") or e.get("completed_at")), default=None)
            elif legacy_unpaid:
                since = min((e.get("completed_at") for e in legacy_unpaid if e.get("completed_at")), default=None)
            days = None
            tier = None
            if since:
                days = int((now - since.replace(tzinfo=timezone.utc)).total_seconds() // 86400)
                tier = "overdue" if days >= 7 else ("urgent" if days >= 3 else "ok")

            arrangement = t.get("payment_arrangement") or "deposit"
            has_final_invoice = bool(linked)
            if open_inv:
                pay_mode = "invoice"
            elif arrangement == "pay_before_collection" and not has_final_invoice and due > 0.005:
                pay_mode = "advance"
            else:
                pay_mode = None
            rows.append({
                "ticket_id": str(t["_id"]),
                "ref": f"TKT-{str(t['_id'])[-8:].upper()}",
                "customer_name": t.get("customer_name"),
                "reseller_name": t.get("reseller_name"),
                "assigned_to_name": t.get("assigned_to_name"),
                "order_id": t["order_id"],
                "order_name": order.get("name"),
                "order_total": total,
                "amount_paid": paid,
                "amount_due": due,
                "invoice_id": open_inv["id"] if open_inv else None,
                "invoice_name": open_inv["name"] if open_inv else None,
                "invoice_residual": float(open_inv["amount_residual"]) if open_inv else None,
                "invoice_due_date": (open_inv or {}).get("invoice_date_due") or None,
                "arrangement": arrangement,
                "row_type": "balance",
                "stage": stage,
                "stage_label": stage_label,
                "stage_detail": None,
                "waiting_since": since,
                "days_waiting": days,
                "age_tier": tier,
                "pop_awaiting_review": bool(t.get("pop_awaiting_review")),
                "pop_count": len(t.get("pop_uploads") or []),
                "pay_mode": pay_mode,
                "customer_notified_at": max((e["customer_notified_at"] for e in entries if e.get("customer_notified_at")), default=None),
            })

    if view == "paid_today":
        deposit_rows = []
    else:
        try:
            deposit_rows = await _expected_deposit_rows(odoo, {t["order_id"] for t in tickets})
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    balance_rows = rows
    counts = {
        "waiting": sum(1 for r in balance_rows if r["stage"] in _BALANCE_WAITING_STAGES),
        "not_packed": sum(1 for r in balance_rows if r["stage"] not in _BALANCE_WAITING_STAGES + ("paid",)),
        "deposits": len(deposit_rows),
    }
    total_due = round(sum(r["amount_due"] for r in balance_rows if r["stage"] != "paid"), 2)
    deposits_due = round(sum(r["amount_due"] for r in deposit_rows), 2)

    if view == "waiting":
        rows = [r for r in balance_rows if r["stage"] in _BALANCE_WAITING_STAGES]
    elif view == "not_packed":
        rows = [r for r in balance_rows if r["stage"] not in _BALANCE_WAITING_STAGES]
    elif view == "deposits":
        rows = deposit_rows
    elif view == "all":
        rows = balance_rows + deposit_rows
    # paid_today: balance_rows already filtered to today's releases

    order_rank = {"packed_waiting": 0, "packed_notified": 1, "signoff": 2, "packing": 3, "in_progress": 4,
                  "approved": 5, "deposit_unlinked": 6, "deposit_stuck": 7, "deposit_due": 8,
                  "deposit_held": 9, "deposit_requested": 10, "deposit_delivered": 11, "paid": 12}
    rows.sort(key=lambda r: (order_rank.get(r["stage"], 99), -(r["days_waiting"] or 0), r["customer_name"] or ""))
    return {"rows": rows, "counts": counts, "total_due": total_due, "deposits_due": deposits_due}


@router.get("/release-requests")
async def list_release_requests(
    status: str = "pending",
    current_user: dict = Depends(require_any_permission("tickets.release_on_account", "tickets.finance_confirm")),
):
    """8.71 — the Release Requests queue. `status=pending` (default) lists
    requests waiting for a decision on orders still at awaiting deposit;
    `status=all` adds the 100 most recently decided ones. Literal route, so
    it must stay registered before GET /{ticket_id}."""
    query = {"release_request": {"$exists": True}}
    if status == "pending":
        query = {"release_request.status": "pending", "status": "awaiting_deposit", "exit_status": None}
    rows = await col("tickets").find(query, {
        "customer_name": 1, "order_id": 1, "order_name": 1, "status": 1, "exit_status": 1,
        "release_request": 1, "release_type": 1, "released_on_account_at": 1, "assigned_to_name": 1,
    }).sort("release_request.requested_at", -1).to_list(length=100 if status != "pending" else 500)
    order_ids = [r["order_id"] for r in rows if r.get("order_id")]
    names = {}
    if order_ids:
        try:
            odoo = get_odoo_client()
            for o in odoo.search_read("sale.order", [("id", "in", order_ids)],
                                      fields=["id", "name", "amount_total"], limit=len(order_ids)):
                names[o["id"]] = o
        except Exception:
            names = {}
    out = []
    for r in rows:
        rr = r.get("release_request") or {}
        o = names.get(r.get("order_id")) or {}
        out.append({
            "ticket_id": str(r["_id"]),
            "ref": f"TKT-{str(r['_id'])[-8:].upper()}",
            "customer_name": r.get("customer_name"),
            "order_id": r.get("order_id"),
            "order_name": o.get("name") or r.get("order_name"),
            "order_total": o.get("amount_total", rr.get("order_total")),
            "ticket_status": r.get("status"),
            "release_type": r.get("release_type"),
            "kind": rr.get("kind") or "on_account",
            **{k: rr.get(k) for k in ("status", "reason", "requested_by_id", "requested_by_name", "requested_at",
                                      "decided_by_name", "decided_at", "decision_note")},
        })
    return {"requests": out}


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
                    await _cancel_linked_packing_board(order_id, "Odoo order was cancelled")

                else:
                    await _advance_ticket_to_odoo_state(ticket, live_state, now)

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

    # 8.69 — opening a ticket that's waiting on payment re-checks Odoo, so a
    # payment entered straight in Odoo releases it without waiting for the
    # 15-minute poll.
    if ticket.get("status") == "awaiting_payment" and ticket.get("order_id") and not ticket.get("exit_status"):
        try:
            if await release_collection_holds(order_id=ticket["order_id"]):
                ticket["status"] = (await col("tickets").find_one({"_id": oid}, {"status": 1}) or {}).get("status", ticket["status"])
                fresh = await col("tickets").find_one({"_id": oid}, {"stage_history": 1})
                if fresh:
                    ticket["stage_history"] = fresh.get("stage_history", ticket.get("stage_history"))
        except Exception as e:
            logger.warning("get_ticket_release_check_failed ticket_id=%s error=%s", ticket_id, e)

    # Admin Override reconciliation (2026-08-28) — see _compute_override_gaps'
    # own docstring. Detail-view only, not list_tickets, to avoid an extra
    # packing_board query per row on the list.
    ticket["override_gaps"] = await _compute_override_gaps(ticket)

    # 8.72 — a deposit invoice cancelled in Odoo (its payment unallocated,
    # the final invoice left with nothing to deduct). Only checked once a
    # deposit or advance payment has been recorded on the ticket.
    ticket["deposit_issue"] = None
    if ticket.get("order_id") and (ticket.get("payment_confirmed_at") or ticket.get("deposit_invoice_ids")):
        try:
            _ds = order_deposit_state(get_odoo_client(), ticket["order_id"])
            if _ds.get("problem"):
                ticket["deposit_issue"] = _ds
        except Exception as e:
            logger.warning("get_ticket_deposit_state_failed ticket_id=%s error=%s", ticket_id, e)

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

    # Admin Override is admins only (2026-10-14). This endpoint also serves
    # two everyday Sales buttons, Assign to me and Not Interested / Cancel,
    # which stay on tickets.sales. Anything else (setting a stage, repointing
    # the Odoo order or invoice, an incomplete reason, closing a ticket as
    # complete) is the override and needs tickets.manage, which only an admin
    # or super admin can hold (auth.effective_permissions). Without this the
    # dropdown was only hidden on screen, not enforced.
    is_override = (
        body.status is not None or body.order_id is not None or body.invoice_id is not None
        or bool(body.incomplete_reason) or body.exit_status == "complete"
    )
    if is_override and not _user_has(current_user, "tickets.manage"):
        raise HTTPException(
            status_code=403,
            detail="Only an admin can override a ticket's stage. Use the Actions and Next Step on the ticket instead.",
        )

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
            if not _deposit_gate_cleared(ticket):
                raise HTTPException(
                    status_code=400,
                    detail="A 50% deposit must be registered (or the order released on account) before it can "
                           "reach the packing board. Admin Override cannot skip this gate.",
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
    # Closing a ticket out (cancelled/not_interested) must also cancel any
    # packing_board entry already created for it (2026-09-07) — see
    # _cancel_linked_packing_board's own docstring for why this direction was
    # missing. A ticket can only reach confirmed_wip/a packing_board entry
    # via the deposit gate, so order_id is always the right key here.
    if body.exit_status in ("cancelled", "not_interested") and ticket.get("order_id"):
        await _cancel_linked_packing_board(ticket["order_id"], body.note, current_user)
    # 2026-08-26 — this endpoint also handles "Assign to me" (body.assigned_to
    # only, no status change) — another trigger point for portal_sales_agent.py.
    # Only fires when an assignee was actually set (body.assigned_to truthy),
    # matching "unassigned → no write" — clearing an assignment never touches
    # the Odoo field.
    if body.assigned_to:
        await sync_portal_sales_agent({**ticket, **updates})
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

    # Deliberately does NOT send the quote automatically (reverted 2026-09-07
    # — auto-send was added 2026-08-26, but for a direct-inquiry ticket the
    # sales clerk routinely needs to come back and edit the draft quote
    # before it's ready to go out; auto-sending the moment it's built meant
    # the customer could already have a copy of a quote that hadn't been
    # edited yet. Sending is now only ever triggered by an explicit click on
    # Send Quote (POST /{id}/send-quote, _send_quote_impl), same as Edit
    # Quote (update_order_from_ticket) has always worked.
    return {"success": True, "odoo_order_id": odoo_order_id}


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

    # 8.61 — editing lines invalidates a pending discount request: it was
    # built against a line set that's about to no longer exist. Best-effort,
    # never blocks the edit itself.
    if ticket.get("discount_status") == "pending":
        await cancel_pending_request(ticket, "Quote lines were edited before a decision was made", actor=current_user)

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
    # Carry each product's current discount % across the unlink/recreate below
    # (8.61) so editing a discounted quote never silently resets it to 0. Taken
    # from Odoo's own lines, never from the request body, so this endpoint can't
    # become a way to set a discount without going through the approval flow.
    # Matched per product in order, so duplicate product lines each keep theirs.
    #
    # Quantity-decrease forfeiture (8.65, 2026-09-30): a discount was granted
    # against a specific quantity, not just a percentage — reducing the
    # quantity while keeping the discount would let staff quietly undercut
    # what was actually approved (e.g. "20% off for 100 units", then edited
    # down to 10 while keeping the 20%). Compared at the PRODUCT level
    # (summed across all lines of that product) against whatever is
    # currently in Odoo right before this save — not the quantity at the
    # moment of original approval — since Edit Quote is the only place
    # quantity ever changes on a draft order, so "current" and "at approval"
    # are the same number unless a prior edit already raised it; a later
    # edit that reduces back toward (but still above) the original approved
    # quantity still forfeits, because the discount stands against whatever
    # the quote currently reflects, not just its original numbers.
    # Increasing or holding steady always keeps the discount, unchanged from
    # the pre-8.65 behaviour.
    carried_discounts: dict = {}
    old_qty_by_product: dict = {}
    if existing_line_ids:
        try:
            for el in odoo.read("sale.order.line", existing_line_ids, fields=["product_id", "discount", "product_uom_qty", "display_type", "is_downpayment"]):
                if el.get("display_type") or el.get("is_downpayment"):
                    continue
                pid = el["product_id"][0] if isinstance(el.get("product_id"), (list, tuple)) else el.get("product_id")
                old_qty_by_product[pid] = old_qty_by_product.get(pid, 0) + (el.get("product_uom_qty") or 0)
                if el.get("discount"):
                    carried_discounts.setdefault(pid, []).append(el["discount"])
        except Exception:
            logger.warning("update_order_from_ticket: could not read existing line discounts for order %s", order_id)
        try:
            odoo.unlink("sale.order.line", existing_line_ids)
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error unlinking lines: {str(e)}")

    new_qty_by_product: dict = {}
    for l in body.order_line:
        new_qty_by_product[l.product_id] = new_qty_by_product.get(l.product_id, 0) + l.product_uom_qty
    forfeited_pids = [
        pid for pid in carried_discounts
        if new_qty_by_product.get(pid, 0) < old_qty_by_product.get(pid, 0)
    ]
    forfeitures: list = []
    if forfeited_pids:
        try:
            names = {p["id"]: p["name"] for p in odoo.read("product.product", forfeited_pids, fields=["name"])}
        except Exception:
            names = {}
        for pid in forfeited_pids:
            forfeitures.append({
                "product_id": pid, "product_name": names.get(pid, f"Product #{pid}"),
                "old_qty": old_qty_by_product.get(pid, 0), "new_qty": new_qty_by_product.get(pid, 0),
                "old_pct": carried_discounts[pid][0] if carried_discounts.get(pid) else 0,
                "at": datetime.now(timezone.utc),
            })
            carried_discounts[pid] = []  # never re-applied below

    final_lines_count = 0
    final_pct_sum = 0.0
    final_total_amount = 0.0
    try:
        for l in body.order_line:
            line_vals = {
                "order_id": order_id,
                "product_id": l.product_id,
                "product_uom_qty": l.product_uom_qty,
                "price_unit": round(l.price_unit, 2),
            }
            if carried_discounts.get(l.product_id):
                pct = carried_discounts[l.product_id].pop(0)
                line_vals["discount"] = pct
                final_lines_count += 1
                final_pct_sum += pct
                final_total_amount += l.product_uom_qty * l.price_unit * (pct / 100)
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
    stage_history_entries = [{
        "status": ticket["status"], "exit_status": None,
        "actor_id": current_user["id"], "actor_name": _actor(current_user),
        "at": now, "note": timeline_note,
    }]
    push_clause: dict = {"stage_history": {"$each": stage_history_entries}}
    # 8.65 — a forfeiture only means something if there's a live decision to
    # adjust; a ticket with no last_discount_decision at all (or one whose
    # only decision was "rejected"/"cancelled", which never applied anything)
    # has nothing to recompute. Recomputes lines_count/avg_pct/total_amount
    # from what's ACTUALLY still applied post-edit (final_* accumulated in
    # the write loop above, which already excludes forfeited products) —
    # the banner must reflect reality, not the original approval's stale
    # figures, once a line's discount has been zeroed out from under it.
    if forfeitures and (ticket.get("last_discount_decision") or {}).get("status") in ("approved", "countered"):
        mongo_set["last_discount_decision.lines_count"] = final_lines_count
        mongo_set["last_discount_decision.avg_pct"] = (final_pct_sum / final_lines_count) if final_lines_count else 0
        mongo_set["last_discount_decision.total_amount"] = final_total_amount
        push_clause["last_discount_decision.forfeitures"] = {"$each": forfeitures}
        forfeit_summary = ", ".join(f"{f['product_name']} ({f['old_qty']}→{f['new_qty']})" for f in forfeitures)
        stage_history_entries.append({
            "status": ticket["status"], "exit_status": None,
            "actor_id": current_user["id"], "actor_name": _actor(current_user),
            "at": now, "note": f"Discount forfeited: quantity reduced on {forfeit_summary} — discount removed for the affected line(s)",
        })
    await col("tickets").update_one({"_id": oid}, {"$set": mongo_set, "$push": push_clause})
    await audit_log(
        "ticket.update_order", "ticket", ticket_id,
        entity_label=ticket_field_updates.get("customer_name", ticket.get("customer_name", "")),
        user=current_user,
        after={"order_id": order_id, "line_count": n, **ticket_field_updates, "discount_forfeitures": forfeitures or None},
    )
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True, "odoo_order_id": order_id, "discounts_forfeited": forfeitures}


async def _send_quote_impl(ticket_id: str, oid: ObjectId, ticket: dict, current_user: dict, background_tasks: BackgroundTasks, recipients: Optional[List[str]] = None) -> dict:
    """Core of the quote-send flow — extracted 2026-08-26 so
    create_order_from_ticket could automatically send the quote the moment
    it was built. That auto-send was reverted 2026-09-07 (a direct-inquiry
    sales clerk routinely needs to come back and edit the draft quote before
    it's ready to go out, and auto-sending meant the customer could already
    have an unedited copy) — this is now only ever reached via an explicit
    click: the standalone POST /{ticket_id}/send-quote endpoint below (first
    send or a deliberate resend after editing). Kept as its own function
    regardless, since Send Quote itself has two entry points (the ticket
    detail sidebar button and the recipient-picker resend) that must never
    implement this twice.
    Caller is responsible for the ticket-lookup/exit-status/reseller-
    ownership checks; this assumes `ticket` already reflects order_id being
    set."""
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order — build a quote first")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()
    try:
        rows = odoo.read("sale.order", [order_id], fields=["state", "name", "partner_id", "amount_total"])
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

    # Send via the portal's own email system (2026-08-27) — replaces the
    # previous Odoo mail.template send so this email carries the portal's
    # own branding and follows the Email Standards, same reasoning as
    # send_deposit_due_proforma. If the customer has no email on file, or
    # the PDF fetch fails, we still mark the state as 'sent' and warn —
    # better than a hard failure that blocks the rep from progressing the
    # ticket. `recipients` (2026-08-27, recipient picker): when a staff
    # member deliberately chose recipients via the Send Quote modal, that
    # ordered list is used as-is (first = To, rest = CC) instead of the
    # single auto-resolved customer email — omitted entirely by
    # create_order_from_ticket's automatic send, which keeps the original
    # single-recipient behavior since there's no user present to choose.
    email_sent = False
    warning = None
    try:
        partner = order.get("partner_id")
        if recipients:
            customer_email, cc_emails = recipients[0], (recipients[1:] or None)
        else:
            customer_email = None
            if partner:
                p_rows = odoo.read("res.partner", [partner[0]], fields=["email"])
                customer_email = p_rows[0].get("email") if p_rows else None
            cc_emails = None
        if not customer_email:
            warning = "Customer has no email on file — order marked sent but no email was delivered"
        else:
            pdf_bytes = fetch_report_pdf("sale.report_saleorder", [order_id])
            background_tasks.add_task(
                send_quote_email,
                customer_email=customer_email,
                customer_name=partner[1] if partner else ticket.get("customer_name", ""),
                order_ref=order["name"],
                amount_total=float(order.get("amount_total", 0) or 0),
                pdf_bytes=bytes(pdf_bytes),
                cc=cc_emails,
            )
            email_sent = True
    except Exception as e:
        warning = f"Could not send quote email ({e}) — order marked sent but email may not have been delivered"

    # Mark the Odoo order as 'sent' regardless of email outcome
    try:
        odoo.write("sale.order", [order_id], {"state": "sent"})
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error marking order sent: {str(e)}")

    # Log a chatter note on the order so anyone opening it directly in Odoo
    # can see the send actually happened (2026-08-28) — state alone doesn't
    # say who it went to or when, and since the send no longer goes through
    # Odoo's own mail.template, nothing else writes this. Best-effort, and
    # only logged when an email genuinely went out (not the no-email-on-file
    # case) so the chatter stays an honest record.
    if email_sent:
        try:
            _cc_note = f" (cc: {', '.join(cc_emails)})" if cc_emails else ""
            odoo.message_post(
                "sale.order", order_id,
                f"Quote sent to {customer_email}{_cc_note} via the Bassani Health Portal.",
            )
        except Exception:
            pass

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
    background_tasks: BackgroundTasks,
    body: SendRecipientsBody = SendRecipientsBody(),
    current_user: dict = Depends(_require_ticket_driver),
):
    """Email the PDF quotation to the customer via the portal's own email
    system (2026-08-27 — was Odoo's built-in quotation template). Marks the
    Odoo order as 'sent' and stamps quote_sent_at on the ticket. Idempotent —
    safe to call again after edits (resend); this is now the ONLY path that
    sends a quote email at all — create_order_from_ticket used to auto-send
    on build (2026-08-26), reverted 2026-09-07 so a sales clerk can edit a
    direct-inquiry quote before the customer ever sees it. `body.recipients`,
    when provided (the Send Quote recipient-picker modal), overrides the
    default single auto-resolved recipient."""
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
    if ticket.get("discount_status") == "pending":
        raise HTTPException(status_code=400, detail="A discount request on this quote is awaiting approval before it can be sent.")
    return await _send_quote_impl(ticket_id, oid, ticket, current_user, background_tasks, recipients=body.recipients)


# ── 8.72 — Apply, never duplicate; restore a cancelled deposit ───────────────
# Odoo is the source of truth. When the customer already has a payment on
# their account that isn't allocated to anything, the portal applies it
# rather than recording the same money again; and a deposit invoice
# cancelled in Odoo is restored (same number, same payment) rather than
# replaced. See deposit_integrity.py.

class ApplyPaymentBody(BaseModel):
    line_id: int
    notify_customer: bool = True   # 8.69d — emails if this releases a held order


async def _load_finance_ticket(ticket_id: str) -> tuple:
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order")
    return oid, ticket


@router.get("/{ticket_id}/unallocated-payments")
async def list_unallocated_payments(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """Payments and credits on this order's customer account that aren't
    allocated to anything (in the order's own company), plus the order's
    deposit state. Shown in every payment window before anything new is
    recorded."""
    _oid, ticket = await _load_finance_ticket(ticket_id)
    odoo = get_odoo_client()
    try:
        so = odoo.read("sale.order", [ticket["order_id"]], fields=["partner_id", "company_id"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {e}")
    if not so:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    credits = customer_unallocated(odoo, (so[0].get("partner_id") or [None])[0], (so[0].get("company_id") or [None])[0])
    return {"credits": credits, "deposit_state": order_deposit_state(odoo, ticket["order_id"])}


@router.post("/{ticket_id}/apply-payment")
async def apply_existing_payment(
    ticket_id: str,
    body: ApplyPaymentBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """Apply a payment already on the customer's account to this order's
    open invoice (the delivery's own unpaid final invoice, same resolver as
    Register Payment). No new payment is created in Odoo."""
    oid, ticket = await _load_finance_ticket(ticket_id)
    odoo = get_odoo_client()
    try:
        so = odoo.read("sale.order", [ticket["order_id"]], fields=["invoice_ids", "name"])
        inv = await _resolve_balance_invoice(odoo, ticket["order_id"], so[0].get("invoice_ids", []) if so else [])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {e}")
    if not inv:
        raise HTTPException(status_code=400, detail=(
            "This order has no open invoice to apply a payment to. Before it is invoiced, use Record Deposit "
            "or Record Payment and choose the existing payment there."))
    _inv, items = invoice_outstanding(odoo, inv["id"])
    match = next((i for i in items if i["line_id"] == body.line_id), None)
    if not match:
        raise HTTPException(status_code=400, detail="That payment is no longer available to apply to this invoice. Refresh and try again.")
    try:
        res = apply_credit(odoo, inv["id"], body.line_id)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not apply the payment: {e}")
    now = datetime.now(timezone.utc)
    await col("tickets").update_one({"_id": oid}, {
        "$set": {"updated_at": now, "pop_awaiting_review": False},
        "$push": {"stage_history": {
            "status": ticket["status"], "exit_status": None,
            "actor_id": current_user["id"], "actor_name": _actor(current_user), "at": now,
            "note": f"Existing payment {match['reference']} (R{float(match['amount']):,.2f}) applied to {inv['name']}"
                    + ("" if body.notify_customer else ". Customer not emailed"),
        }},
    })
    await audit_log(
        "ticket.apply_existing_payment", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""), user=current_user,
        before={"amount_residual": res["before"]},
        after={"amount_residual": res["after"], "payment_state": res["payment_state"]},
        detail={"invoice_id": inv["id"], "invoice_name": inv["name"], "line_id": body.line_id,
                "reference": match["reference"], "notify_customer": body.notify_customer},
    )
    released = await release_collection_holds(order_id=ticket["order_id"], background_tasks=background_tasks,
                                              actor=current_user, notify=body.notify_customer)
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True, "invoice_name": inv["name"], "amount_residual": res["after"],
            "payment_state": res["payment_state"], "released": bool(released),
            "customer_notified": bool(released) and body.notify_customer}


@router.post("/{ticket_id}/restore-deposit")
async def restore_cancelled_deposit(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """Restore a deposit invoice that was cancelled in Odoo: reset it to
    draft and post it again (it keeps its number), then re-apply the payment
    that was unhooked when it was cancelled. Only before the final invoice
    exists; afterwards it would invoice the deposit twice, so Finance sorts
    it out in Odoo instead (the message says so)."""
    oid, ticket = await _load_finance_ticket(ticket_id)
    odoo = get_odoo_client()
    state = order_deposit_state(odoo, ticket["order_id"])
    if state.get("error"):
        raise HTTPException(status_code=502, detail=f"Odoo error: {state['error']}")
    if not state.get("problem"):
        raise HTTPException(status_code=400, detail="This order's deposit invoice isn't cancelled. Nothing to restore.")
    if not state.get("restorable"):
        raise HTTPException(status_code=400, detail=state.get("message") or "The final invoice already exists; sort this out in Odoo.")

    restored, applied, problems = [], [], []
    for inv in state["cancelled"]:
        try:
            restore_deposit_invoice(odoo, inv["id"])
            restored.append(inv["name"])
        except Exception as e:
            problems.append(f"{inv['name']}: could not restore ({e})")
            continue
        _inv, items = invoice_outstanding(odoo, inv["id"])
        for cred in [c for c in state["stranded"] if inv["name"] in (c.get("memo") or "")]:
            if not any(i["line_id"] == cred["line_id"] for i in items):
                continue
            try:
                apply_credit(odoo, inv["id"], cred["line_id"])
                applied.append(cred["reference"])
            except Exception as e:
                problems.append(f"{cred['reference']}: could not apply to {inv['name']} ({e})")

    after = order_deposit_state(odoo, ticket["order_id"])
    now = datetime.now(timezone.utc)
    note = (f"Deposit invoice restored: {', '.join(restored) or 'none'}"
            + (f"; payment re-applied: {', '.join(applied)}" if applied else "; no payment re-applied")
            + (f". Problems: {'; '.join(problems)}" if problems else ""))
    await col("tickets").update_one({"_id": oid}, {
        "$set": {"updated_at": now},
        "$push": {"stage_history": {
            "status": ticket["status"], "exit_status": None,
            "actor_id": current_user["id"], "actor_name": _actor(current_user), "at": now, "note": note,
        }},
    })
    await audit_log(
        "ticket.restore_deposit", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""), user=current_user,
        before={"cancelled": [c["name"] for c in state["cancelled"]]},
        after={"posted": [p["name"] for p in after.get("posted", [])], "problem": after.get("problem")},
        detail={"restored": restored, "applied": applied, "problems": problems},
    )
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": not problems, "restored": restored, "applied": applied, "problems": problems,
            "deposit_state": after}


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
    if ticket.get("released_on_account_at"):
        raise HTTPException(status_code=400, detail="This order was already released on account — no deposit is needed")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()
    try:
        order_rows = odoo.read("sale.order", [order_id], fields=["invoice_ids"])
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not order_rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    # 2026-10-14 — never queue an order Odoo shows as already delivered.
    if order_fulfilment_state(odoo, [order_id]).get(int(order_id), {}).get("delivered"):
        raise HTTPException(status_code=400, detail=FULLY_DELIVERED_MSG)
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
                "note": f"Used existing Odoo invoice {inv['name']} ({inv['payment_state']}) in place of a new deposit"
                        + ("" if body.notify_customer else ". Customer not emailed"),
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
            "notify_customer": body.notify_customer,
        },
    )

    # Same non-blocking packing-board-queue behavior as register_deposit —
    # the invoice link above is already committed, a queueing hiccup here
    # must never be reported back as if linking the invoice failed.
    packing_board_warning = None
    try:
        await _queue_packing_board(order_id, background_tasks, notify=body.notify_customer)
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
            ticket_id=str(oid),
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
    # 8.69 — a pay-before-collection order is already on the packing board
    # with no deposit. A payment received before its final invoice exists is
    # recorded the same way as a deposit (a paid down-payment invoice, which
    # Odoo deducts on the final invoice and which is VAT-correct, since SA
    # time of supply is triggered by receiving payment). More than one is
    # allowed. Once the final invoice exists, Register Payment pays that.
    is_advance = ticket.get("payment_arrangement") == "pay_before_collection"
    if is_advance:
        if await col("packing_board").find_one({"order_id": str(ticket["order_id"]), "invoice_id": {"$nin": [None, False]}}):
            raise HTTPException(
                status_code=400,
                detail="The final invoice has already been raised for this order. Record the payment against that invoice instead.",
            )
    else:
        if ticket.get("status") != "awaiting_deposit":
            raise HTTPException(
                status_code=400,
                detail=f"Ticket must be awaiting a deposit to register one (current stage: {ticket.get('status')})",
            )
        if ticket.get("payment_confirmed_at"):
            raise HTTPException(status_code=400, detail="Deposit already registered on this ticket")
        if ticket.get("released_on_account_at"):
            raise HTTPException(status_code=400, detail="This order was already released on account — no deposit is needed")

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
    if not body.use_credit_line_id and not body.journal_id:
        raise HTTPException(status_code=400, detail="Choose a payment method")
    if invoice_type == "percentage":
        if not body.percentage or not (0 < body.percentage <= 100):
            raise HTTPException(status_code=400, detail="Percentage must be between 0 and 100")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()

    # Resolve the order's company and validate it is confirmed before running the wizard
    _order_co = odoo.read("sale.order", [order_id], fields=["company_id", "state", "name", "amount_total", "partner_id"])
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

    # 2026-10-14 — a deposit would queue the order for packing; never for an
    # order Odoo shows as already delivered (nothing to pack).
    if not is_advance and order_fulfilment_state(odoo, [order_id]).get(int(order_id), {}).get("delivered"):
        raise HTTPException(status_code=400, detail=FULLY_DELIVERED_MSG)

    # 8.71 — token deposit guard. Doesn't apply to a payment towards a
    # pay-before-collection order: any amount the customer actually paid is
    # real money, not a way past the gate (the gate is already cleared).
    _order_total = float(_order_row.get("amount_total") or 0)
    _deposit_amount = body.amount if invoice_type == "fixed" else _order_total * (body.percentage or 0) / 100
    small_deposit_reason = (body.small_deposit_reason or "").strip() or None
    is_small_deposit = (not is_advance) and _order_total > 0 and _deposit_amount < _order_total * TOKEN_DEPOSIT_PCT / 100
    if is_advance:
        _owing = _order_amount_owing(odoo, order_id, _order_total)
        if _deposit_amount > _owing + 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"That is more than is owing on this order (R{_owing:,.2f}).",
            )
    # 8.72 — apply, never duplicate. Before creating anything in Odoo: if the
    # customer already has unallocated payments or credits, either one of
    # them is applied to the deposit invoice (use_credit_line_id) or the
    # caller confirms this is a separate payment that genuinely arrived.
    _partner_id = (_order_row.get("partner_id") or [None])[0]
    _credits = customer_unallocated(odoo, _partner_id, order_company_id)
    _use_credit = None
    if body.use_credit_line_id:
        _use_credit = next((c for c in _credits if c["line_id"] == body.use_credit_line_id), None)
        if not _use_credit:
            raise HTTPException(status_code=400, detail="That payment is no longer unallocated on the customer's account. Refresh and try again.")
        if _deposit_amount > _use_credit["amount"] + 0.01:
            raise HTTPException(
                status_code=400,
                detail=f"The deposit (R{_deposit_amount:,.2f}) is more than that payment (R{_use_credit['amount']:,.2f}). "
                       "Enter the payment's amount, or record the difference separately.",
            )
    elif _credits and not body.confirm_new_payment:
        raise HTTPException(status_code=409, detail=unallocated_detail(_credits, "deposit"))

    if is_small_deposit and not small_deposit_reason:
        raise HTTPException(
            status_code=400,
            detail=(f"This deposit is under {TOKEN_DEPOSIT_PCT:g}% of the order total. Token deposits create extra "
                    "invoices; if the customer has a payment agreement, use Request Release on Account instead. "
                    "To register it anyway, give a reason."),
        )

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

    # Step 2: Register and reconcile payment via Odoo wizard — or, 8.72,
    # apply the payment already on the customer's account instead.
    if _use_credit:
        try:
            apply_credit(odoo, invoice_id, _use_credit["line_id"])
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Deposit invoice created, but the existing payment could not be applied: {e}. "
                       "Apply it from the invoice in the portal.",
            )
    else:
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
    if is_advance:
        # Pay before collection: a payment towards the full amount, not the
        # deposit gate (already cleared). Recorded without touching
        # payment_confirmed_at / invoice_id, which mean "deposit registered".
        await col("tickets").update_one(
            {"_id": oid},
            {
                "$set": {"last_payment_at": now, "updated_at": now, "pop_awaiting_review": False},
                "$addToSet": {"deposit_invoice_ids": invoice_id},
                "$push": {"stage_history": {
                    "status": ticket["status"], "exit_status": None,
                    "actor_id": current_user["id"], "actor_name": _actor(current_user),
                    "at": now,
                    "note": body.note or (f"Payment received before invoicing: R{pay_amount:,.2f}"
                                          + (f" (applied existing payment {_use_credit['reference']})" if _use_credit else "")),
                }},
            },
        )
        await audit_log(
            "ticket.register_advance_payment", "ticket", ticket_id,
            entity_label=ticket.get("customer_name", ""), user=current_user,
            detail={"invoice_type": invoice_type, "amount": pay_amount, "journal_id": body.journal_id,
                    "invoice_id": invoice_id, "date": body.date,
                    "applied_existing_payment": (_use_credit or {}).get("reference")},
        )
        await broadcast_monitor_refresh()
        await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
        return {"success": True, "invoice_id": invoice_id, "advance_payment": True}

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
            "$addToSet": {"deposit_invoice_ids": invoice_id},
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": _actor(current_user),
                "at": now,
                "note": (body.note or (f"Deposit registered ({invoice_type}) — R{pay_amount:,.2f} by applying existing payment {_use_credit['reference']}"
                                       if _use_credit else f"Deposit registered ({invoice_type}) — R{pay_amount:,.2f} via journal {body.journal_id}"))
                        + (f" (small deposit: {small_deposit_reason})" if is_small_deposit else "")
                        + ("" if body.notify_customer else ". Customer not emailed"),
            }},
        },
    )
    await _close_release_request(oid, ticket, "deposit_registered", current_user)
    await audit_log(
        "ticket.register_deposit", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"invoice_type": invoice_type, "amount": pay_amount, "journal_id": body.journal_id, "invoice_id": invoice_id, "date": body.date,
                "small_deposit": is_small_deposit, "small_deposit_reason": small_deposit_reason,
                "notify_customer": body.notify_customer,
                "applied_existing_payment": (_use_credit or {}).get("reference"),
                "confirmed_new_despite_unallocated": body.confirm_new_payment and bool(_credits)},
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
        await _queue_packing_board(order_id, background_tasks, notify=body.notify_customer)
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


# ── 8.68 — Release on account (no deposit) ───────────────────────────────────

class ReleaseOnAccountBody(BaseModel):
    reason: str


async def _load_release_context(ticket_id: str):
    """Shared by the check and the release itself: the ticket, its order's
    company/total/state/terms, and the customer's commercial partner id."""
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order — build the quote first")
    odoo = get_odoo_client()
    try:
        rows = odoo.read(
            "sale.order", [ticket["order_id"]],
            fields=["name", "state", "company_id", "amount_total", "partner_id", "payment_term_id"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    order = rows[0]
    _co = order.get("company_id")
    company_id = _co[0] if _co else None
    raw_partner = _ticket_customer_partner_id(ticket) or ((order.get("partner_id") or [None])[0])
    partner_id = commercial_partner_id(odoo, raw_partner) if raw_partner else None
    return oid, ticket, odoo, order, company_id, partner_id


def _release_stage_blocks(ticket: dict, order: dict) -> list:
    """Pipeline-state reasons release can't happen, separate from the credit
    decision (which evaluate_release() owns)."""
    blocks = []
    if ticket.get("exit_status"):
        blocks.append(f"Ticket is already closed as '{ticket['exit_status']}'.")
    if ticket.get("status") != "awaiting_deposit":
        blocks.append(f"The order must be confirmed and awaiting a deposit (current stage: {ticket.get('status')}).")
    if ticket.get("payment_confirmed_at"):
        blocks.append("A deposit is already registered on this order.")
    if ticket.get("released_on_account_at"):
        blocks.append("This order was already released on account.")
    if ticket.get("pbc_approved_at"):
        blocks.append("This order was already approved to pay before collection.")
    if ticket.get("is_sample"):
        blocks.append("Sample orders don't need a deposit or a release.")
    if order.get("state") != "sale":
        blocks.append(f"Order {order.get('name')} must be confirmed first (current state: {order.get('state')}).")
    return blocks


@router.get("/{ticket_id}/release-on-account/check")
async def check_release_on_account(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.release_on_account", "tickets.finance_confirm")),
):
    """Read-only: can this order be released on account, and why not. Powers
    the Release on Account button and window on the Sales ticket. Reads Odoo live."""
    oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
    if not partner_id:
        raise HTTPException(status_code=400, detail="Could not resolve the customer on this order")
    result = await evaluate_release(odoo, partner_id, company_id, float(order.get("amount_total") or 0),
                                    exclude_ticket_id=oid)
    stage_blocks = _release_stage_blocks(ticket, order)
    result["blocks"] = stage_blocks + result["blocks"]
    result["eligible"] = not result["blocks"]
    result["order_ref"] = order.get("name")
    result["partner_id"] = partner_id
    return result


@router.post("/{ticket_id}/release-on-account")
async def release_on_account(
    ticket_id: str,
    body: ReleaseOnAccountBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.release_on_account")),
):
    """Phase 8.68 — the second way through the deposit gate. For a customer
    approved for account terms with the order's company, within their credit
    limit, an authorised user releases the confirmed order to the packing
    board without a deposit. No invoice is created here: the full invoice is
    raised at Mark Complete as for every order (_create_final_invoice), left
    unpaid, due per the customer's payment terms. Finance records payment
    later with Register Balance Payment.

    Nothing is written to Odoo except, if needed, the order's payment terms,
    so the invoice's due date is right."""
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required (e.g. the account agreement reference)")
    oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
    stage_blocks = _release_stage_blocks(ticket, order)
    if stage_blocks:
        raise HTTPException(status_code=400, detail=" ".join(stage_blocks))
    if not partner_id:
        raise HTTPException(status_code=400, detail="Could not resolve the customer on this order")

    order_total = float(order.get("amount_total") or 0)
    check = await evaluate_release(odoo, partner_id, company_id, order_total, exclude_ticket_id=oid)
    if not check["eligible"]:
        await audit_log(
            "ticket.release_on_account_blocked", "ticket", ticket_id,
            entity_label=ticket.get("customer_name", ""), user=current_user,
            detail={"blocks": check["blocks"], "order_id": ticket["order_id"]},
        )
        raise HTTPException(status_code=400, detail=" ".join(check["blocks"]))

    return await _commit_release(
        oid=oid, ticket=ticket, ticket_id=ticket_id, odoo=odoo, order=order, company_id=company_id,
        current_user=current_user, reason=reason, background_tasks=background_tasks,
        release_type="account_terms", payment_term=check["payment_term"],
        audit_extra={
            "credit_limit": check["credit_limit"], "balance": check["balance"],
            "pending_on_account": check["pending_on_account"], "total_overdue": check["total_overdue"],
        },
        warnings=check["warnings"],
    )


async def _commit_release(
    *, oid, ticket, ticket_id, odoo, order, company_id, current_user, reason, background_tasks,
    release_type: str, payment_term: Optional[dict], audit_extra: Optional[dict] = None,
    warnings: Optional[list] = None,
):
    """Shared end of every release without a deposit (8.68 account terms,
    8.71 one-off exception): set payment terms on the order if it has none
    (or only immediate terms), stamp the ticket, close any pending release
    request, audit, and queue the packing board. No invoice is created here;
    the full invoice is raised at Mark Complete, unpaid. A one-off exception
    counts towards the customer's exposure exactly like an account release
    (_uninvoiced_on_account_exposure reads released_on_account_at)."""
    order_total = float(order.get("amount_total") or 0)
    # The invoice's due date comes from the sale order's own payment terms. If
    # the order has none, or only immediate terms, set the chosen terms onto
    # it now — before any invoice exists.
    term = payment_term
    order_term = order.get("payment_term_id")
    term_note = None
    if term and (not order_term or order_term[0] != term["id"]):
        from account_terms import is_credit_term
        if not order_term or not is_credit_term(odoo, order_term[0]):
            try:
                odoo_call(
                    "sale.order", "write",
                    [[ticket["order_id"]], {"payment_term_id": term["id"]}],
                    {"context": company_context(company_id)},
                )
                term_note = f"Order payment terms set to {term['name']}"
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Could not set payment terms on the order: {str(e)}")
    effective_term = term if (term_note or not order_term) else {"id": order_term[0], "name": order_term[1]}

    now = datetime.now(timezone.utc)
    actor_name = _actor(current_user)
    if release_type == "exception":
        label = "One-off release, no deposit"
    elif release_type == "auto":
        label = f"Released automatically on account terms ({(effective_term or {}).get('name', 'account terms')}), no deposit"
    else:
        label = f"Released on account ({(effective_term or {}).get('name', 'account terms')}), no deposit"
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {
                "payment_arrangement": "on_account",
                "release_type": release_type,
                "released_on_account_at": now,
                "released_on_account_by": current_user["id"],
                "released_on_account_by_name": actor_name,
                "released_on_account_reason": reason,
                "on_account_company_id": company_id,
                "on_account_amount": order_total,
                "on_account_payment_term": effective_term,
                "updated_at": now,
            },
            "$unset": {"auto_release_held": ""},
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": actor_name,
                "at": now,
                "note": f"{label}: {reason}",
            }},
        },
    )
    await _close_release_request(oid, ticket, "exception" if release_type == "exception" else "released",
                                 current_user, note=reason, background_tasks=background_tasks)
    await audit_log(
        "ticket.release_exception" if release_type == "exception" else "ticket.release_on_account",
        "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""), user=current_user,
        before={"status": ticket["status"], "payment_arrangement": ticket.get("payment_arrangement")},
        after={"payment_arrangement": "on_account", "release_type": release_type},
        detail={
            "reason": reason, "order_id": ticket["order_id"], "order_total": order_total,
            "company_id": company_id, "payment_term": effective_term, "term_note": term_note,
            "warnings": warnings or [], **(audit_extra or {}),
        },
    )

    # Same queue + non-blocking failure handling as register_deposit: the
    # release is committed; a queue failure stays flagged on the ticket until
    # retried via Admin Override (which accepts a released order, see
    # _deposit_gate_cleared).
    packing_board_warning = None
    try:
        await _queue_packing_board(ticket["order_id"], background_tasks)
    except Exception as e:
        packing_board_warning = str(e)
        logger.warning("queue_packing_board_after_release_failed",
                       extra={"ticket_id": ticket_id, "order_id": ticket["order_id"], "error": packing_board_warning})
        await col("tickets").update_one(
            {"_id": oid},
            {"$set": {"packing_board_queue_error": packing_board_warning, "packing_board_queue_failed_at": now}},
        )
        await audit_log(
            "ticket.packing_board_queue_failed", "ticket", ticket_id,
            entity_label=ticket.get("customer_name", ""), user=current_user,
            detail={"order_id": ticket["order_id"], "error": packing_board_warning},
        )

    await broadcast_monitor_refresh()
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    resp = {"success": True, "warnings": warnings or []}
    if packing_board_warning:
        resp["warning"] = (
            f"Released, but the order could not be queued for packing: "
            f"{packing_board_warning}. Use Admin Override once resolved to retry."
        )
    return resp


AUTO_RELEASE_ACTOR = {"id": None, "name": "Automatic (account terms)", "username": "system", "role": "system"}


async def auto_release_on_confirm(ticket_oid, background_tasks: BackgroundTasks) -> dict:
    """8.71 — called by order_routes._confirm_order_core right after an order
    is confirmed and its ticket moved to awaiting_deposit. A customer approved
    for account terms who passes the full evaluate_release() check (approved
    for this company, not suspended, review date not passed, credit terms and
    a credit limit in Odoo, within the limit) is released straight away, with
    no human step — the standard ERP automatic credit check. If they're
    approved but fail, the ticket keeps waiting for a deposit and records why
    (auto_release_held) so staff can see it and request or release. Customers
    with no account terms are untouched. Never raises: the order is already
    confirmed whatever happens here."""
    ticket_id = str(ticket_oid)
    try:
        oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
        if not partner_id or _release_stage_blocks(ticket, order):
            return {"released": False}
        terms = await get_account_terms(partner_id)
        if not terms or terms.get("status") != "approved":
            return {"released": False}
        check = await evaluate_release(odoo, partner_id, company_id, float(order.get("amount_total") or 0),
                                       exclude_ticket_id=oid)
        if not check["eligible"]:
            now = datetime.now(timezone.utc)
            await col("tickets").update_one(
                {"_id": oid},
                {"$set": {"auto_release_held": {"at": now, "blocks": check["blocks"]}},
                 "$push": {"stage_history": {
                     "status": ticket["status"], "exit_status": None,
                     "actor_id": None, "actor_name": AUTO_RELEASE_ACTOR["name"], "at": now,
                     "note": "Not released automatically on account terms: " + " ".join(check["blocks"]),
                 }}},
            )
            await audit_log("ticket.auto_release_held", "ticket", ticket_id,
                            entity_label=ticket.get("customer_name", ""), user=AUTO_RELEASE_ACTOR,
                            detail={"blocks": check["blocks"], "order_id": ticket["order_id"]})
            return {"released": False, "held": check["blocks"]}
        resp = await _commit_release(
            oid=oid, ticket=ticket, ticket_id=ticket_id, odoo=odoo, order=order, company_id=company_id,
            current_user=AUTO_RELEASE_ACTOR,
            reason=f"Approved account terms ({terms.get('reference') or 'agreement on file'}), within credit limit",
            background_tasks=background_tasks, release_type="auto", payment_term=check["payment_term"],
            audit_extra={"credit_limit": check["credit_limit"], "balance": check["balance"],
                         "pending_on_account": check["pending_on_account"], "total_overdue": check["total_overdue"]},
            warnings=check["warnings"],
        )
        return {"released": True, "warning": resp.get("warning")}
    except Exception as e:
        logger.warning("auto_release_on_confirm_failed", extra={"ticket_id": ticket_id, "error": str(e)})
        return {"released": False}


# ── 8.70f — Customer's choice on a partial shipment ──────────────────────────
# When an order can only ship in part, Sales asks the customer and records the
# answer here (decided 2026-10-10: the Orders team never decides). The Order
# Ticket shows it; "ship_partial_drop" makes Mark Complete cancel the unshipped
# remainder instead of creating a backorder (packing_board_routes).

PARTIAL_CHOICES = {
    "wait": "Wait for the full order",
    "ship_partial_backorder": "Ship what's available now, backorder the rest",
    "ship_partial_drop": "Ship what's available now, drop the rest",
}


class PartialDecisionBody(BaseModel):
    choice: str
    note: Optional[str] = ""


@router.put("/{ticket_id}/partial-decision")
async def set_partial_decision(
    ticket_id: str,
    body: PartialDecisionBody,
    current_user: dict = Depends(require_any_permission("tickets.sales", "tickets.manage")),
):
    if body.choice not in PARTIAL_CHOICES:
        raise HTTPException(status_code=400, detail="Unknown choice")
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail="This ticket is closed")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="This ticket has no order yet")
    now = datetime.now(timezone.utc)
    note = (body.note or "").strip() or None
    decision = {"choice": body.choice, "label": PARTIAL_CHOICES[body.choice], "note": note,
                "by_id": current_user["id"], "by_name": _actor(current_user), "at": now}
    await col("tickets").update_one(
        {"_id": oid},
        {"$set": {"partial_decision": decision, "updated_at": now},
         "$push": {"stage_history": {
             "status": ticket["status"], "exit_status": None,
             "actor_id": current_user["id"], "actor_name": _actor(current_user), "at": now,
             "note": f"Customer's choice on partial shipment: {PARTIAL_CHOICES[body.choice]}" + (f" ({note})" if note else ""),
         }}},
    )
    await audit_log("ticket.partial_decision", "ticket", ticket_id, entity_label=ticket.get("customer_name", ""),
                    user=current_user, before=ticket.get("partial_decision"), after={"choice": body.choice, "note": note})
    try:
        from routes.packing_board_routes import push_update as _pb_push
        entry = await col("packing_board").find_one({"order_id": str(ticket["order_id"]), "is_backorder": {"$ne": True}}, {"_id": 0})
        if entry:
            await _pb_push(entry)
    except Exception:
        pass
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True, "partial_decision": {**decision, "at": now.isoformat()}}


# ── 8.71 — Release on account requests ───────────────────────────────────────
# A sales clerk who knows a customer has a payment agreement asks for the order
# to skip the deposit; someone holding tickets.release_on_account (Finance)
# decides: approve account terms and release (the frontend saves the terms via
# PUT /api/customers/{id}/account-terms first, then calls decide "release"),
# release this order only ("exception", audited), or decline. Stored on the
# ticket as `release_request`; the decision is kept after it closes so the
# ticket shows the outcome.

class ReleaseRequestBody(BaseModel):
    reason: str
    # 8.69 — what's being asked for: "on_account" (release on account terms)
    # or "pay_before_collection" (pack now, customer pays in full before
    # collection). Defaults to on_account for older clients.
    kind: Optional[str] = "on_account"


class ReleaseDecisionBody(BaseModel):
    decision: str                       # "release" | "exception" | "pay_before_collection" | "decline"
    note: Optional[str] = ""
    payment_term_id: Optional[int] = None   # exception only: terms to set on this order


class PayBeforeCollectionBody(BaseModel):
    reason: str


REQUEST_KINDS = ("on_account", "pay_before_collection")


def _user_has(user: dict, permission: str) -> bool:
    if user.get("is_super_admin") or user.get("role") == "super_admin":
        return True
    domain, action = permission.split(".", 1)
    return bool((user.get("permissions") or {}).get(domain, {}).get(action))


def _can_decide_request(user: dict, kind: str, decision: str) -> bool:
    """Who may decide what (8.69). Release on account / one-off release stay
    with tickets.release_on_account (credit controllers). Pay before
    collection carries no credit risk (goods never leave unpaid), so anyone
    who registers deposits (tickets.finance_confirm) can approve it. Declining
    a request needs the authority to grant what was asked."""
    can_release = _user_has(user, "tickets.release_on_account")
    can_finance = _user_has(user, "tickets.finance_confirm")
    if decision in ("release", "exception"):
        return can_release
    if decision == "pay_before_collection":
        return can_release or can_finance
    if decision == "decline":
        return can_release or (kind == "pay_before_collection" and can_finance)
    return False


async def _close_release_request(oid, ticket: dict, outcome: str, current_user: dict, note: str = "",
                                 background_tasks: Optional[BackgroundTasks] = None) -> None:
    """Close a pending release request because the deposit gate was cleared
    another way (released, exception, deposit registered). No-op otherwise."""
    rr = ticket.get("release_request") or {}
    if rr.get("status") != "pending":
        return
    await col("tickets").update_one(
        {"_id": oid, "release_request.status": "pending"},
        {"$set": {
            "release_request.status": outcome,
            "release_request.decided_by_id": current_user["id"],
            "release_request.decided_by_name": _actor(current_user),
            "release_request.decided_at": datetime.now(timezone.utc),
            "release_request.decision_note": note or None,
        }},
    )
    if outcome in ("released", "exception", "pay_before_collection") and rr.get("requested_by_email") and background_tasks:
        order_ref = ticket.get("order_name") or f"#{ticket.get('order_id')}"
        background_tasks.add_task(
            send_release_decision_notification,
            rr["requested_by_email"], ticket.get("customer_name", ""), order_ref, outcome,
            _actor(current_user), note or "", str(oid),
        )


@router.post("/{ticket_id}/release-request")
async def request_release_on_account(
    ticket_id: str,
    body: ReleaseRequestBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(get_current_user),
):
    """Anyone working the order can ask: every internal staff role, and a
    reseller for a customer it owns. Asking never releases anything; only a
    tickets.release_on_account holder decides. Customer logins can't ask —
    a customer wanting credit is a credit application for Finance."""
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Tell Finance why this order shouldn't need a deposit")
    kind = body.kind or "on_account"
    if kind not in REQUEST_KINDS:
        raise HTTPException(status_code=400, detail="Unknown request type")
    role = current_user.get("role")
    if role not in (ADMIN_ROLES | TICKET_ROLES | {"super_admin", "reseller"}):
        raise HTTPException(status_code=403, detail="Access denied")
    oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
    if role == "reseller":
        await _assert_reseller_owns_ticket(ticket, await _reseller_id_for_user(current_user))
    blocks = _release_stage_blocks(ticket, order)
    if blocks:
        raise HTTPException(status_code=400, detail=" ".join(blocks))
    if (ticket.get("release_request") or {}).get("status") == "pending":
        raise HTTPException(status_code=400, detail="A release request is already waiting for a decision")

    terms = await get_account_terms(partner_id) if partner_id else None
    now = datetime.now(timezone.utc)
    actor_name = _actor(current_user)
    order_ref = order.get("name") or f"#{ticket['order_id']}"
    request_doc = {
        "status": "pending",
        "reason": reason,
        "requested_by_id": current_user["id"],
        "requested_by_name": actor_name,
        "requested_by_email": current_user.get("email") or (
            current_user.get("username") if "@" in (current_user.get("username") or "") else None),
        "requested_at": now,
        "order_total": float(order.get("amount_total") or 0),
        "kind": kind,
    }
    await col("tickets").update_one(
        {"_id": oid},
        {"$set": {"release_request": request_doc, "updated_at": now},
         "$push": {"stage_history": {
             "status": ticket["status"], "exit_status": None,
             "actor_id": current_user["id"], "actor_name": actor_name, "at": now,
             "note": (f"Pay before collection requested: {reason}" if kind == "pay_before_collection"
                      else f"Release on account requested: {reason}"),
         }}},
    )
    await audit_log("ticket.release_requested", "ticket", ticket_id,
                    entity_label=ticket.get("customer_name", ""), user=current_user,
                    detail={"reason": reason, "kind": kind, "order_id": ticket["order_id"], "has_account_terms": bool(terms)})
    routing = await get_email_routing()
    background_tasks.add_task(
        send_release_request_notification,
        routing.get("release_request_to", []), ticket.get("customer_name", ""), order_ref,
        float(order.get("amount_total") or 0), actor_name, reason, ticket_id, bool(terms), kind,
    )
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True}


@router.post("/{ticket_id}/release-request/withdraw")
async def withdraw_release_request(ticket_id: str, current_user: dict = Depends(get_current_user)):
    oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
    rr = ticket.get("release_request") or {}
    if rr.get("status") != "pending":
        raise HTTPException(status_code=400, detail="There is no pending release request")
    is_decider = _can_decide_request(current_user, rr.get("kind") or "on_account", "decline")
    if rr.get("requested_by_id") != current_user.get("id") and not is_decider:
        raise HTTPException(status_code=403, detail="Only the person who asked can withdraw this request")
    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {"$set": {"release_request.status": "withdrawn", "release_request.decided_at": now,
                  "release_request.decided_by_name": _actor(current_user), "updated_at": now},
         "$push": {"stage_history": {
             "status": ticket["status"], "exit_status": None,
             "actor_id": current_user["id"], "actor_name": _actor(current_user), "at": now,
             "note": "No-deposit request withdrawn",
         }}},
    )
    await audit_log("ticket.release_request_withdrawn", "ticket", ticket_id,
                    entity_label=ticket.get("customer_name", ""), user=current_user)
    return {"success": True}


@router.post("/{ticket_id}/release-request/decide")
async def decide_release_request(
    ticket_id: str,
    body: ReleaseDecisionBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.release_on_account", "tickets.finance_confirm")),
):
    decision = body.decision
    if decision not in ("release", "exception", "pay_before_collection", "decline"):
        raise HTTPException(status_code=400, detail="Unknown decision")
    note = (body.note or "").strip()
    oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
    rr = ticket.get("release_request") or {}
    pending = rr.get("status") == "pending"
    if not _can_decide_request(current_user, rr.get("kind") or "on_account", decision):
        raise HTTPException(status_code=403, detail="You don't have permission to make this decision")
    # Without a pending request this is a direct release by someone who holds
    # the release permission themselves (e.g. Finance acting on their own
    # knowledge); there is nothing to decline in that case.
    if not pending and decision == "decline":
        raise HTTPException(status_code=400, detail="There is no pending release request on this ticket")
    # Separation of duties, same rule as discount approvals: nobody decides
    # their own request, super admins included.
    if pending and rr.get("requested_by_id") == current_user.get("id"):
        raise HTTPException(status_code=403, detail="You can't decide a release request you raised yourself")

    if decision == "decline":
        if not note:
            raise HTTPException(status_code=400, detail="Give the sales team a reason (it's emailed to them)")
        now = datetime.now(timezone.utc)
        await col("tickets").update_one(
            {"_id": oid},
            {"$set": {"release_request.status": "declined", "release_request.decision_note": note,
                      "release_request.decided_by_id": current_user["id"],
                      "release_request.decided_by_name": _actor(current_user),
                      "release_request.decided_at": now, "updated_at": now},
             "$push": {"stage_history": {
                 "status": ticket["status"], "exit_status": None,
                 "actor_id": current_user["id"], "actor_name": _actor(current_user), "at": now,
                 "note": f"No-deposit request declined, deposit required: {note}",
             }}},
        )
        await audit_log("ticket.release_request_declined", "ticket", ticket_id,
                        entity_label=ticket.get("customer_name", ""), user=current_user,
                        detail={"note": note, "request_reason": rr.get("reason")})
        if rr.get("requested_by_email"):
            background_tasks.add_task(
                send_release_decision_notification, rr["requested_by_email"], ticket.get("customer_name", ""),
                order.get("name") or f"#{ticket['order_id']}", "declined", _actor(current_user), note, ticket_id,
            )
        await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
        return {"success": True}

    blocks = _release_stage_blocks(ticket, order)
    if blocks:
        raise HTTPException(status_code=400, detail=" ".join(blocks))
    if not partner_id:
        raise HTTPException(status_code=400, detail="Could not resolve the customer on this order")
    reason = note or rr.get("reason") or ""

    if decision == "pay_before_collection":
        if not reason:
            raise HTTPException(status_code=400, detail="A reason is required")
        return await _commit_pay_before_collection(
            oid=oid, ticket=ticket, ticket_id=ticket_id, odoo=odoo, order=order, company_id=company_id,
            partner_id=partner_id, current_user=current_user, reason=reason, background_tasks=background_tasks,
            request_reason=rr.get("reason"),
        )

    if decision == "release":
        # Account-terms release: the full 8.68 check applies (terms approved
        # for this company, within the credit limit).
        check = await evaluate_release(odoo, partner_id, company_id, float(order.get("amount_total") or 0),
                                       exclude_ticket_id=oid)
        if not check["eligible"]:
            raise HTTPException(status_code=400, detail=" ".join(check["blocks"]))
        return await _commit_release(
            oid=oid, ticket=ticket, ticket_id=ticket_id, odoo=odoo, order=order, company_id=company_id,
            current_user=current_user, reason=reason, background_tasks=background_tasks,
            release_type="account_terms", payment_term=check["payment_term"],
            audit_extra={"request_reason": rr.get("reason"), "credit_limit": check["credit_limit"],
                         "balance": check["balance"], "pending_on_account": check["pending_on_account"]},
            warnings=check["warnings"],
        )

    # One-off exception: no standing terms, Finance's judgement, mandatory note.
    if not note:
        raise HTTPException(status_code=400, detail="A reason is required for a one-off release")
    term = None
    if body.payment_term_id:
        term = next((t for t in payment_terms_catalog(odoo) if t["id"] == body.payment_term_id), None)
        if not term:
            raise HTTPException(status_code=400, detail="Payment terms not found")
        term = {"id": term["id"], "name": term["name"]}
    return await _commit_release(
        oid=oid, ticket=ticket, ticket_id=ticket_id, odoo=odoo, order=order, company_id=company_id,
        current_user=current_user, reason=note, background_tasks=background_tasks,
        release_type="exception", payment_term=term,
        audit_extra={"request_reason": rr.get("reason")},
    )


# ── 8.69 — Pay before collection ─────────────────────────────────────────────
# The third way through the deposit gate: Finance approves the order going to
# the packing board with no deposit, on condition the customer pays the full
# amount before collecting. Mark Complete then holds the customer's "ready"
# email until the final invoice is paid (packing_board_routes.py's
# hold_or_notify_after_complete / release_collection_holds), and Mark as
# Collected refuses an unpaid order.

async def _commit_pay_before_collection(
    *, oid, ticket, ticket_id, odoo, order, company_id, partner_id, current_user, reason, background_tasks,
    request_reason: Optional[str] = None,
):
    order_total = float(order.get("amount_total") or 0)
    # The final invoice should fall due on issue, not on the customer's usual
    # credit terms — this order is paid before collection by definition.
    term_note = None
    order_term = order.get("payment_term_id")
    if order_term and is_credit_term(odoo, order_term[0]):
        immediate = next((t for t in payment_terms_catalog(odoo) if not t["is_credit"]), None)
        if immediate:
            try:
                odoo_call(
                    "sale.order", "write",
                    [[ticket["order_id"]], {"payment_term_id": immediate["id"]}],
                    {"context": company_context(company_id)},
                )
                term_note = f"Order payment terms changed from {order_term[1]} to {immediate['name']}"
            except Exception as e:
                raise HTTPException(status_code=502, detail=f"Could not set payment terms on the order: {str(e)}")

    overdue = 0.0
    if partner_id:
        try:
            overdue = float(read_company_credit(odoo, partner_id, company_id).get("total_overdue") or 0)
        except Exception:
            overdue = 0.0

    now = datetime.now(timezone.utc)
    actor_name = _actor(current_user)
    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {
                "payment_arrangement": "pay_before_collection",
                "pbc_approved_at": now,
                "pbc_approved_by": current_user["id"],
                "pbc_approved_by_name": actor_name,
                "pbc_reason": reason,
                "pbc_order_total": order_total,
                "updated_at": now,
            },
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": actor_name, "at": now,
                "note": f"Approved to pay before collection, no deposit: {reason}"
                        + (f" ({term_note})" if term_note else ""),
            }},
        },
    )
    await _close_release_request(oid, ticket, "pay_before_collection", current_user, note=reason,
                                 background_tasks=background_tasks)
    await audit_log(
        "ticket.pay_before_collection", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""), user=current_user,
        before={"status": ticket["status"], "payment_arrangement": ticket.get("payment_arrangement")},
        after={"payment_arrangement": "pay_before_collection"},
        detail={"reason": reason, "request_reason": request_reason, "order_id": ticket["order_id"],
                "order_total": order_total, "company_id": company_id, "term_note": term_note,
                "total_overdue": overdue},
    )

    # Tell the customer no deposit is needed (they were sent the deposit
    # pro-forma at confirm time). Non-fatal.
    email_warning = None
    partner = order.get("partner_id")
    if partner:
        owning = await get_owning_reseller_id(partner_id) if partner_id else None
        email_warning = await _send_order_confirmation_email(
            order_id=ticket["order_id"], partner=partner, order_ref=order.get("name") or f"#{ticket['order_id']}",
            order_total=order_total, company_id=company_id, owning_reseller_id=owning,
            background_tasks=background_tasks, pay_before_collection=True,
        )

    packing_board_warning = None
    try:
        await _queue_packing_board(ticket["order_id"], background_tasks)
    except Exception as e:
        packing_board_warning = str(e)
        logger.warning("queue_packing_board_after_pbc_failed",
                       extra={"ticket_id": ticket_id, "order_id": ticket["order_id"], "error": packing_board_warning})
        await col("tickets").update_one(
            {"_id": oid},
            {"$set": {"packing_board_queue_error": packing_board_warning, "packing_board_queue_failed_at": now}},
        )
        await audit_log(
            "ticket.packing_board_queue_failed", "ticket", ticket_id,
            entity_label=ticket.get("customer_name", ""), user=current_user,
            detail={"order_id": ticket["order_id"], "error": packing_board_warning},
        )

    await broadcast_monitor_refresh()
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    warnings = []
    if overdue > 0:
        warnings.append(f"This customer has R{overdue:,.2f} overdue on other invoices.")
    if email_warning:
        warnings.append(email_warning)
    resp = {"success": True, "warnings": warnings}
    if packing_board_warning:
        resp["warning"] = (
            f"Approved, but the order could not be queued for packing: {packing_board_warning}. "
            "Use Admin Override once resolved to retry."
        )
    return resp


@router.get("/{ticket_id}/pay-before-collection/check")
async def check_pay_before_collection(
    ticket_id: str,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm", "tickets.release_on_account")),
):
    """Read-only context for the Pay Before Collection window: stage blocks,
    order total, and any overdue amount on the customer's account (a warning,
    never a block, since no credit is being extended)."""
    oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
    overdue = 0.0
    if partner_id:
        try:
            overdue = float(read_company_credit(odoo, partner_id, company_id).get("total_overdue") or 0)
        except Exception:
            overdue = 0.0
    order_term = order.get("payment_term_id")
    return {
        "blocks": _release_stage_blocks(ticket, order),
        "order_ref": order.get("name"),
        "order_total": float(order.get("amount_total") or 0),
        "total_overdue": overdue,
        "order_payment_term": order_term[1] if order_term else None,
        "term_will_change": bool(order_term and is_credit_term(odoo, order_term[0])),
    }


@router.post("/{ticket_id}/pay-before-collection")
async def approve_pay_before_collection(
    ticket_id: str,
    body: PayBeforeCollectionBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm", "tickets.release_on_account")),
):
    """Finance approves pay before collection directly (no request needed),
    the same way they register a deposit directly."""
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="A reason is required")
    oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
    rr = ticket.get("release_request") or {}
    if rr.get("status") == "pending" and rr.get("requested_by_id") == current_user.get("id"):
        raise HTTPException(status_code=403, detail="You can't approve a request you raised yourself")
    blocks = _release_stage_blocks(ticket, order)
    if blocks:
        raise HTTPException(status_code=400, detail=" ".join(blocks))
    return await _commit_pay_before_collection(
        oid=oid, ticket=ticket, ticket_id=ticket_id, odoo=odoo, order=order, company_id=company_id,
        partner_id=partner_id, current_user=current_user, reason=reason, background_tasks=background_tasks,
        request_reason=rr.get("reason") if rr.get("status") == "pending" else None,
    )

@router.post("/{ticket_id}/send-deposit-proforma")
async def send_deposit_proforma(
    ticket_id: str,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm", "tickets.release_on_account")),
):
    """8.68 — manually email the customer the 50% deposit-due pro-forma. An
    account-terms customer is sent the no-deposit confirmation at confirm
    time; if staff decide this particular order needs a deposit after all,
    this sends the deposit version instead."""
    oid, ticket, odoo, order, company_id, partner_id = await _load_release_context(ticket_id)
    if ticket.get("status") != "awaiting_deposit" or ticket.get("payment_confirmed_at") or ticket.get("released_on_account_at"):
        raise HTTPException(status_code=400, detail="This order isn't waiting on a deposit")
    partner = order.get("partner_id")
    if not partner:
        raise HTTPException(status_code=400, detail="Order has no customer")
    owning = await get_owning_reseller_id(partner_id) if partner_id else None
    warning = await _send_order_confirmation_email(
        order_id=ticket["order_id"], partner=partner, order_ref=order.get("name") or f"#{ticket['order_id']}",
        order_total=float(order.get("amount_total") or 0), company_id=company_id,
        owning_reseller_id=owning, background_tasks=background_tasks, force_deposit=True,
    )
    if warning:
        raise HTTPException(status_code=400, detail=warning)
    now = datetime.now(timezone.utc)
    await col("tickets").update_one(
        {"_id": oid},
        {"$set": {"deposit_proforma_sent_at": now, "updated_at": now},
         "$push": {"stage_history": {
             "status": ticket["status"], "exit_status": None,
             "actor_id": current_user["id"], "actor_name": _actor(current_user),
             "at": now, "note": "Deposit pro-forma emailed to the customer",
         }}},
    )
    await audit_log("ticket.send_deposit_proforma", "ticket", ticket_id,
                    entity_label=ticket.get("customer_name", ""), user=current_user)
    return {"success": True}


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
        full_invoice = await _resolve_balance_invoice(odoo, ticket["order_id"], inv_ids)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error reading invoices: {str(e)}")
    if not full_invoice:
        return {"invoice_id": None, "invoice_name": None, "amount_total": 0, "amount_residual": 0, "payment_state": "paid"}
    return {
        "invoice_id":      full_invoice["id"],
        "invoice_name":    full_invoice["name"],
        "amount_total":    full_invoice["amount_total"],
        "amount_residual": full_invoice["amount_residual"],
        "payment_state":   full_invoice["payment_state"],
        "invoice_date_due": full_invoice.get("invoice_date_due") or None,
    }


@router.post("/{ticket_id}/register-payment")
async def register_balance_payment(
    ticket_id: str,
    body: TicketBalancePayment,
    background_tasks: BackgroundTasks,
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

    # The invoice this payment goes against — see _resolve_balance_invoice
    # (8.69): the delivery's own unpaid final invoice, never "the biggest
    # invoice", which picked the already-paid deposit on a 50/50 order.
    inv_ids = order_row.get("invoice_ids", [])
    if not inv_ids:
        raise HTTPException(status_code=400, detail="No invoices found on this order — confirm the order first")
    try:
        full_invoice = await _resolve_balance_invoice(odoo, ticket["order_id"], inv_ids)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error reading invoices: {str(e)}")
    if not full_invoice:
        raise HTTPException(status_code=400, detail="Nothing is owing on this order's invoices")
    invoice_id = full_invoice["id"]
    if body.amount > float(full_invoice.get("amount_residual") or 0) + 0.01:
        raise HTTPException(
            status_code=400,
            detail=f"That is more than is owing on invoice {full_invoice['name']} (R{float(full_invoice['amount_residual']):,.2f}).",
        )

    # 8.72 — apply, never duplicate: if Odoo already holds a payment or
    # credit that could pay this invoice, the caller must apply it (POST
    # /apply-payment) or confirm this is a separate payment that arrived.
    if not body.confirm_new_payment:
        try:
            _inv, _credits = invoice_outstanding(odoo, invoice_id)
        except Exception:
            _credits = []
        if _credits:
            raise HTTPException(status_code=409, detail=unallocated_detail(_credits, "invoice"))

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
                "date": body.date, "payment_state": final_state, "amount_residual": final_residual,
                "notify_customer": body.notify_customer,
                "confirmed_new_despite_unallocated": body.confirm_new_payment},
    )
    # 8.69 — if this paid a held order's invoice, tell the customer it's ready.
    # notify_customer=False (8.69d) still releases the hold, just without emails.
    released = await release_collection_holds(order_id=ticket["order_id"], background_tasks=background_tasks,
                                              actor=current_user, notify=body.notify_customer)
    await ticket_manager.broadcast(ticket_id, _ticket_customer_partner_id(ticket))
    return {"success": True, "invoice_id": invoice_id, "payment_state": final_state, "amount_residual": final_residual,
            "customer_notified": bool(released) and body.notify_customer, "released": bool(released)}


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
    start at 'awaiting_deposit' — same target the Odoo-state auto-sync in
    get_ticket already uses for a `sale`/`done` order (2026-09-07 fix; this
    endpoint previously used the older pre-8.47 'sale_order' stage, which the
    next auto-sync would silently advance past anyway, but creating it at the
    wrong stage to begin with was never correct). The universal 50% deposit
    gate still applies — Finance still needs to register it before the order
    reaches the packing board."""
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

    # Confirmed orders enter straight at awaiting_deposit — quote stage is for drafts only
    is_confirmed = order["state"] == "sale"
    initial_status = "awaiting_deposit" if is_confirmed else "quote"
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
    await sync_portal_sales_agent(doc)  # 2026-08-26 — see portal_sales_agent.py
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
    # 2026-08-26 — reassignment is one of the trigger points for
    # portal_sales_agent.py; pass the ticket with its just-written new
    # assignee, not the stale pre-reassign copy fetched above.
    await sync_portal_sales_agent({**ticket, "assigned_to": body.assigned_to, "assigned_to_name": new_name})

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
    background_tasks: BackgroundTasks,
    body: SendRecipientsBody = SendRecipientsBody(),
    current_user: dict = Depends(require_any_permission("tickets.finance_confirm")),
):
    """
    Send (or resend) the invoice PDF to the customer via the portal's own
    email system (2026-08-27 — was Odoo's mail.template mechanism), same
    reasoning as send_deposit_due_proforma. Stamps invoice_sent_at on the
    ticket. Gracefully degrades if the customer has no email on file or the
    PDF fetch fails. `body.recipients`, when provided (the Send Invoice
    recipient-picker modal), overrides the default single auto-resolved
    recipient — first entry is To, the rest CC.
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
    records = odoo.read("account.move", [invoice_id], fields=["name", "state", "partner_id", "amount_total", "payment_state", "payment_reference", "invoice_date_due"])
    if not records:
        raise HTTPException(status_code=404, detail="Invoice not found in Odoo")
    inv = records[0]
    if inv.get("state") != "posted":
        raise HTTPException(status_code=400, detail="Invoice must be posted before sending")

    warning = None
    invoice_email_sent = False
    try:
        partner = inv.get("partner_id")
        if body.recipients:
            customer_email, cc_emails = body.recipients[0], (body.recipients[1:] or None)
        else:
            customer_email = None
            if partner:
                p_rows = odoo.read("res.partner", [partner[0]], fields=["email"])
                customer_email = p_rows[0].get("email") if p_rows else None
            cc_emails = None
        if not customer_email:
            warning = "Customer has no email on file — invoice was not sent"
        else:
            order_ref = None
            if ticket.get("order_id"):
                try:
                    _o_rows = odoo.read("sale.order", [ticket["order_id"]], fields=["name"])
                    order_ref = _o_rows[0]["name"] if _o_rows else None
                except Exception:
                    pass
            pdf_bytes = fetch_report_pdf("account.report_invoice_with_payments", [invoice_id])
            background_tasks.add_task(
                send_invoice_email,
                customer_email=customer_email,
                customer_name=partner[1] if partner else ticket.get("customer_name", ""),
                order_ref=order_ref or inv["name"],
                invoice_ref=inv["name"],
                cc=cc_emails,
                amount_total=float(inv.get("amount_total", 0) or 0),
                pdf_bytes=bytes(pdf_bytes),
                payment_state=inv.get("payment_state"),
                payment_reference=inv.get("payment_reference"),
                support_url=order_help_url(ticket.get("order_id")) if ticket.get("order_id") else None,
                due_date=inv.get("invoice_date_due") or None,
                collection_after_payment=ticket.get("status") == "awaiting_payment",
            )
            invoice_email_sent = True
    except Exception as e:
        warning = f"Email may not have been sent: {e}"

    # Chatter note (2026-08-28) — see the matching note in _send_quote_impl
    # above for why this is needed now that the send doesn't go through
    # Odoo's own mail.template. Best-effort, only logged on a genuine send.
    if invoice_email_sent:
        try:
            _cc_note = f" (cc: {', '.join(cc_emails)})" if cc_emails else ""
            odoo.message_post(
                "account.move", invoice_id,
                f"Invoice sent to {customer_email}{_cc_note} via the Bassani Health Portal.",
            )
        except Exception:
            pass

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
