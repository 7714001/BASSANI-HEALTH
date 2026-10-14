"""
Packing Board — real-time WebSocket hub.

Connections (all require token auth):
  wss://host/api/packing/ws/board?token=<per-warehouse display token>   ← 85" screen
  wss://host/api/packing/ws/supervisor?token=<supervisor_jwt>             ← supervisor phone
  wss://host/api/packing/ws/packer?token=<packer_jwt>                    ← packer handheld

Every connection is scoped to exactly one warehouse (the screen's token maps to
one warehouse; the supervisor/packer's fixed `warehouse_id`) — board state and
broadcasts are filtered so a vault never sees another vault's queue.

Board state lives in MongoDB `packing_board` collection so it
survives server restarts.
"""
import asyncio
import json
import jwt
import logging
import re
import xmlrpc.client
from datetime import datetime, timezone
from bson import ObjectId
from fastapi import APIRouter, BackgroundTasks, WebSocket, WebSocketDisconnect, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from auth import require_admin, get_current_user, get_user_by_username, require_permission, require_any_permission, require_super_admin, ADMIN_ROLES
from config import get_settings
from database import col, NO_ID
from middleware.audit import audit_log
from odoo_client import get_odoo_client, fetch_report_pdf
from routes.settings_routes import get_email_routing
from routes.monitor_routes import broadcast_monitor_refresh
from services.email_service import (
    send_order_packing_started,
    send_order_ready_for_collection,
    send_order_ready_for_collection_reseller,
    send_order_ready_for_collection_customer,
    send_partial_delivery_ready,
    send_backorder_created_internal,
    send_backorder_stock_ready,
    send_qa_approval_needed,
    send_rp_approval_needed,
    send_invoice_email,
    send_payment_hold_finance,
)
from support_links import order_help_url
from services.notification_service import notify_ticket_handoff
from services.age_tier import board_entry_age_fields

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/packing", tags=["packing-board"])
settings = get_settings()


def _dumps(obj) -> str:
    """json.dumps that handles MongoDB datetime objects."""
    def _default(o):
        if isinstance(o, datetime):
            return o.isoformat()
        raise TypeError(f"Not serializable: {type(o)}")
    return json.dumps(obj, default=_default)


# ── Connection manager ────────────────────────────────────────────────────────

class BoardManager:
    def __init__(self):
        self.screens:     list[tuple[WebSocket, Optional[int]]] = []
        self.supervisors: list[tuple[WebSocket, Optional[int]]] = []
        self.packers:     list[tuple[WebSocket, Optional[int]]] = []

    async def connect_screen(self, ws: WebSocket, warehouse_id: Optional[int]):
        self.screens.append((ws, warehouse_id))
        await ws.send_text(_dumps({"type": "full_state", "data": await get_board_state(warehouse_id)}))

    async def connect_supervisor(self, ws: WebSocket, warehouse_id: Optional[int]):
        self.supervisors.append((ws, warehouse_id))
        await ws.send_text(_dumps({"type": "full_state", "data": await get_board_state(warehouse_id)}))

    async def connect_packer(self, ws: WebSocket, warehouse_id: Optional[int]):
        self.packers.append((ws, warehouse_id))
        await ws.send_text(_dumps({"type": "full_state", "data": await get_board_state(warehouse_id)}))

    def disconnect(self, ws: WebSocket):
        self.screens     = [c for c in self.screens     if c[0] is not ws]
        self.supervisors = [c for c in self.supervisors if c[0] is not ws]
        self.packers     = [c for c in self.packers     if c[0] is not ws]

    async def broadcast(self, message: dict, warehouse_id: Optional[int] = None):
        """Deliver to every connection, unless `warehouse_id` is given — then
        skip connections scoped to a *different* warehouse. Connections with no
        warehouse (e.g. a super_admin testing a role JWT) always receive."""
        payload = _dumps(message)
        dead = []
        for ws, ws_wh in self.screens + self.supervisors + self.packers:
            if warehouse_id is not None and ws_wh is not None and ws_wh != warehouse_id:
                continue
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


manager = BoardManager()


# ── Board state helpers ───────────────────────────────────────────────────────

def _with_age(entry: dict) -> dict:
    """Attach age_tier/hours_elapsed/deadline_hours to a packing_board entry
    — same clock/deadline choice services/age_tier.py's board_entry_age_fields
    (shared with monitor_routes.py's own _board_card) already uses for the
    public Operations Monitor (2026-08-26), so this page's age badge can
    never disagree with that board's."""
    entry.update(board_entry_age_fields(entry))
    return entry


async def _drop_rest_chosen(entry: dict) -> bool:
    """True when Sales recorded that the customer takes part now and drops
    the rest (8.70f): the unshipped remainder is cancelled, not backordered."""
    try:
        t = await col("tickets").find_one({"type": "sales", "order_id": int(entry["order_id"])},
                                          {"partial_decision": 1})
    except (ValueError, TypeError):
        return False
    return ((t or {}).get("partial_decision") or {}).get("choice") == "ship_partial_drop"


async def _with_ticket_summary(entry: dict) -> dict:
    """Attach a small set of linked-Sales-ticket fields for the Orders Ticket
    detail page's own "Sales Ticket" reference card (2026-08-27) — a plain
    single lookup, not get_board_state()'s batched join, since this only
    ever backs the single-entry GET /entry/{order_id} the detail page calls.
    An order ticket can never exist without a linked Sales ticket (the 8.47
    deposit gate only ever creates a packing_board entry from one already at
    awaiting_deposit), so `ticket` is expected to always resolve — the
    fallback is defensive, not a real empty-state this page needs to design
    for."""
    ticket = None
    try:
        ticket = await col("tickets").find_one(
            {"type": "sales", "order_id": int(entry["order_id"]), "exit_status": None},
            {"source": 1, "assigned_to_name": 1, "stage_history": 1, "partial_decision": 1,
             "payment_arrangement": 1, "released_on_account_at": 1, "released_on_account_by_name": 1,
             "on_account_payment_term": 1, "is_sample": 1, "status": 1,
             "pbc_approved_at": 1, "pbc_approved_by_name": 1},
        )
    except (ValueError, TypeError):
        pass
    entry["ticket_id"] = str(ticket["_id"]) if ticket else None
    entry["ticket_source"] = ticket.get("source") if ticket else None
    entry["ticket_assigned_to_name"] = ticket.get("assigned_to_name") if ticket else None
    entry["ticket_stage_history"] = (ticket.get("stage_history") or []) if ticket else []
    entry["partial_decision"] = ticket.get("partial_decision") if ticket else None
    # 8.69 — how this order is being paid, for the Order Ticket's Payment
    # card, badge and timeline.
    entry["payment_arrangement"] = (
        "sample" if (ticket or {}).get("is_sample")
        else ((ticket or {}).get("payment_arrangement") or ("deposit" if ticket else None))
    )
    entry["payment_required_before_collection"] = payment_required_before_collection(ticket)
    for k in ("released_on_account_at", "released_on_account_by_name", "on_account_payment_term",
              "pbc_approved_at", "pbc_approved_by_name"):
        entry[k] = (ticket or {}).get(k)
    entry["ticket_status"] = (ticket or {}).get("status")
    return entry


def _with_invoice_payment(entry: dict) -> dict:
    """8.69 — live payment state of this delivery's final invoice, for the
    Order Ticket's Payment card. Non-fatal: None when there's no invoice or
    Odoo can't be read."""
    entry["invoice_payment"] = None
    if entry.get("invoice_id"):
        inv = _read_invoice_payment(get_odoo_client(), entry["invoice_id"])
        if inv:
            entry["invoice_payment"] = {
                "name": inv.get("name"), "state": inv.get("state"),
                "payment_state": inv.get("payment_state"),
                "amount_residual": float(inv.get("amount_residual") or 0),
                "amount_total": float(inv.get("amount_total") or 0),
                "paid": _invoice_is_paid(inv),
            }
    return entry


def _entry_active_pickings(odoo, order_id, picking_id=None) -> list:
    """The open (not done/cancelled) Odoo delivery an entry is packing against.

    Scoped to the specific picking when known — a backorder and its primary
    are separate pickings under the same sale order (2026-08-23), so falling
    back to "every active picking for this sale order" is only for legacy
    entries with no odoo_picking_id stamped."""
    domain = ([("id", "=", int(picking_id))] if picking_id
              else [("sale_id", "=", int(order_id)), ("picking_type_code", "=", "outgoing")])
    return odoo.search_read(
        "stock.picking",
        domain + [("state", "not in", ["done", "cancel"])],
        fields=["id", "location_id", "move_line_ids"],
    )


def _read_picking_lots(odoo, pickings: list) -> dict:
    """{product_id: [{move_line_id, lot_id, lot_name, quantity}]} for the given
    pickings' move lines — the batch currently assigned on the open delivery,
    whatever was written by assign-lot or by Odoo's own reservation. Distinct
    from order_routes.py's lot_map, which only reads DONE pickings and so
    can't reflect a batch picked mid-pack (2026-10-07)."""
    ml_ids = [ml for p in pickings for ml in p.get("move_line_ids", [])]
    if not ml_ids:
        return {}
    mls = odoo.read("stock.move.line", ml_ids, fields=["product_id", "lot_id", "quantity"])
    out: dict = {}
    for ml in mls:
        pid = ml["product_id"][0] if isinstance(ml["product_id"], list) else ml["product_id"]
        lot = ml.get("lot_id")
        out.setdefault(str(pid), []).append({
            "move_line_id": ml["id"],
            "lot_id":       lot[0] if isinstance(lot, list) else None,
            "lot_name":     lot[1] if isinstance(lot, list) else None,
            "quantity":     ml.get("quantity") or 0,
        })
    for lines in out.values():
        lines.sort(key=lambda l: l["move_line_id"])
    return out


def _with_picking_lots(entry: dict) -> dict:
    """Attach the open delivery's current batch assignments (`picking_lots`)
    and its source location (`picking_location_id`, used to scope the batch
    picker to stock that's actually in this delivery's warehouse). Non-fatal:
    an Odoo failure leaves both empty rather than failing the detail page."""
    entry["picking_lots"] = {}
    entry["picking_location_id"] = None
    if entry.get("status") not in ("queued", "packing", "ready"):
        return entry
    try:
        odoo = get_odoo_client()
        pickings = _entry_active_pickings(odoo, entry["order_id"], entry.get("odoo_picking_id"))
        if pickings:
            loc = pickings[0].get("location_id")
            entry["picking_location_id"] = loc[0] if isinstance(loc, list) else None
            entry["picking_lots"] = _read_picking_lots(odoo, pickings)
    except Exception as e:
        logger.warning(f"picking_lots_read_failed order_id={entry.get('order_id')} error={e}")
    return entry


_BOARD_TERMINAL = ["collected", "incomplete", "cancelled"]


async def _board_search_clause(q: str) -> Optional[dict]:
    """Mongo `$or` for the Orders Tickets list search (2026-09-21). Matches
    the entry's own customer/SO/DN/invoice/packer fields, plus anything found
    via the linked Sales ticket (company name, TKT-XXXXXXXX reference) —
    resolved to order_ids first, since packing_board stores order_id as a
    string and the ticket reference isn't stored on the entry itself."""
    q = q.strip()
    if not q:
        return None
    rx = {"$regex": re.escape(q), "$options": "i"}
    clauses: list = [
        {"customer_name": rx}, {"ps_num": rx}, {"dn_num": rx},
        {"inv_num": rx}, {"packer_name": rx}, {"order_id": q},
    ]
    ticket_or: list = [{"customer_company_name": rx}, {"customer_name": rx}]
    m = re.match(r"^TKT-?([0-9a-fA-F]{1,8})$", q, re.IGNORECASE)
    if m:
        ticket_or.append({"$expr": {"$regexMatch": {
            "input": {"$toLower": {"$substrCP": [{"$toString": "$_id"}, 16, 8]}},
            "regex": "^" + re.escape(m.group(1).lower()),
        }}})
    try:
        ids = [
            str(t["order_id"])
            async for t in col("tickets").find(
                {"type": "sales", "order_id": {"$ne": None}, "$or": ticket_or}, {"order_id": 1},
            ).limit(200)
        ]
        if ids:
            clauses.append({"order_id": {"$in": ids}})
    except Exception as e:
        logger.warning("board_search_ticket_lookup_failed q=%s error=%s", q, e)
    return {"$or": clauses}


async def get_board_state(warehouse_id: Optional[int] = None, search: Optional[str] = None, admin_view: bool = False) -> list:
    query: dict = {"status": {"$ne": "cleared"}}
    if warehouse_id is not None:
        query["warehouse_id"] = warehouse_id
    search_clause = await _board_search_clause(search or "")
    if search_clause:
        query = {"$and": [query, search_clause]}
    if admin_view:
        # Admin list (OrdersTickets.js): every active entry, however old, plus
        # the most recent finished ones. The original single oldest-first
        # 100-entry cap (still used, unchanged, by the warehouse floor display
        # and its WebSocket feed below) silently dropped the NEWEST orders once
        # collected/complete history filled it, so they could never be seen or
        # searched (found live 2026-09-21).
        active = await (
            col("packing_board")
            .find({"$and": [query, {"status": {"$nin": _BOARD_TERMINAL}}]}, NO_ID)
            .sort("queued_at", 1)
            .to_list(length=500)
        )
        finished = await (
            col("packing_board")
            .find({"$and": [query, {"status": {"$in": _BOARD_TERMINAL}}]}, NO_ID)
            .sort("queued_at", -1)
            .to_list(length=200)
        )
        entries = active + finished
    else:
        entries = await (
            col("packing_board")
            .find(query, NO_ID)
            .sort("queued_at", 1)
            .to_list(length=100)
        )
    entries = [_with_age(e) for e in entries]

    # Batch-resolve each entry's linked Sales ticket (2026-08-27, for
    # OrdersTickets.js's list "Sales Ticket" column) — same order_id join
    # every other cross-pipeline lookup in this file already uses (e.g.
    # _sync_sales_ticket, _create_final_invoice's deposit-exclusion lookup),
    # one batched query for the whole page rather than N+1 per entry.
    # packing_board.order_id is stored as a string, tickets.order_id as an
    # int — same mismatch every other join in this codebase already handles.
    order_ids: set = set()
    for e in entries:
        try:
            order_ids.add(int(e["order_id"]))
        except (KeyError, ValueError, TypeError):
            pass
    # ticket_source (2026-08-28) added to this same batched join for
    # OrdersTickets.js's Source filter (Internal/Resellers/Customers) — the
    # same t.source vocabulary SalesTickets.js's own Source filter already
    # uses, so the two pages' Source buckets can never disagree about what
    # counts as "internal"/"reseller"/"customer" for the same underlying
    # ticket.
    ticket_map: dict = {}
    if order_ids:
        async for t in col("tickets").find(
            {"type": "sales", "order_id": {"$in": list(order_ids)}, "exit_status": None},
            {"order_id": 1, "source": 1, "payment_arrangement": 1, "is_sample": 1, "released_on_account_at": 1},
        ):
            ticket_map[t["order_id"]] = {
                "ticket_id": str(t["_id"]), "source": t.get("source"),
                # 8.69 — badge on the Orders board ("Pay before collection")
                "payment_arrangement": "sample" if t.get("is_sample") else (t.get("payment_arrangement") or "deposit"),
            }
    for e in entries:
        try:
            t = ticket_map.get(int(e["order_id"]))
        except (ValueError, TypeError):
            t = None
        e["ticket_id"] = t["ticket_id"] if t else None
        e["ticket_source"] = t["source"] if t else None
        e["payment_arrangement"] = t["payment_arrangement"] if t else None

    return entries


async def push_update(entry: dict):
    await manager.broadcast({"type": "entry_update", "data": entry}, warehouse_id=entry.get("warehouse_id"))


async def _resolve_customer_notification_recipients(odoo, partner_id: int) -> tuple:
    """Resolve recipients for a customer-facing milestone email (currently:
    ready for collection) — the account's main company email plus every
    other active contact on file, so the notification reaches the actual
    customer regardless of who placed the order (reseller or Bassani staff).

    Returns (company_email, other_contact_emails). Best-effort: returns
    (None, []) on any Odoo error rather than raising — a failed lookup here
    must never block the packing/status update that triggered it."""
    try:
        _cpr = odoo.read("res.partner", [partner_id], fields=["commercial_partner_id"])
        company_id = partner_id
        if _cpr:
            _cp = _cpr[0].get("commercial_partner_id")
            if _cp and _cp is not False:
                company_id = _cp[0]

        company_rows = odoo.read("res.partner", [company_id], fields=["email"])
        company_email = company_rows[0].get("email") if company_rows else None
        company_email = company_email if company_email and company_email is not False else None

        contact_ids = odoo.search(
            "res.partner", [["parent_id", "=", company_id], ["active", "=", True]], limit=50,
        )
        other_emails: list = []
        if contact_ids:
            raw = odoo.read("res.partner", contact_ids, fields=["email", "type"])
            for c in raw:
                email = c.get("email")
                if email and email is not False and c.get("type") in ("contact", "invoice"):
                    other_emails.append(email)

        seen = {company_email.lower()} if company_email else set()
        deduped: list = []
        for e in other_emails:
            if e.lower() not in seen:
                seen.add(e.lower())
                deduped.append(e)
        return company_email, deduped
    except Exception as exc:
        logger.warning("customer_notification_recipients_failed partner_id=%s error=%s", partner_id, exc)
        return None, []


async def _sync_sales_ticket(
    order_id: str,
    outcome: str,
    reason: Optional[str] = None,
    background_tasks: Optional[BackgroundTasks] = None,
    actor: Optional[dict] = None,
    payment_received: bool = False,
    note: Optional[str] = None,
):
    """
    Phase 8.4 — write an Orders outcome (complete/incomplete/cancelled) back
    to the linked Sales ticket and notify the assigned sales rep. Best-effort
    and silent if no Sales ticket exists for this order — a packing board
    entry can exist without ever having gone through one (e.g. legacy orders
    confirmed before Phase 8, or orders placed without a logged PO/RFQ).

    background_tasks is optional and only used for the ready_for_collection
    customer-notification email below — callers that don't need it (or that
    never reach that outcome) can omit it.

    actor (2026-08-27 fix) — every one of this function's five call sites
    already had a real current_user in scope, but the stage_history entry
    pushed below always hardcoded "system" regardless, throwing away who
    actually clicked Mark Complete / Report Packing Issue / Cancel / Admin
    Override. Optional (not every caller has one — none currently omit it,
    but this stays a real gate rather than a silent assumption) so a missing
    actor still degrades to "system" rather than crashing.
    """
    try:
        ticket = await col("tickets").find_one(
            {"type": "sales", "order_id": int(order_id), "exit_status": None}
        )
        if not ticket:
            return
        now = datetime.now(timezone.utc)
        updates: dict = {"updated_at": now}
        if outcome == "incomplete":
            updates["status"] = "incomplete"
            updates["incomplete_reason"] = reason
        elif outcome == "partially_fulfilled":
            updates["status"] = "partially_fulfilled"
        elif outcome == "ready_for_collection":
            updates["status"] = "ready_for_collection"
        elif outcome == "awaiting_payment":
            # 8.69 — packed and signed off, customer notice held until paid.
            updates["status"] = "awaiting_payment"
        else:  # complete | cancelled — terminal exit
            updates["exit_status"] = outcome
        await col("tickets").update_one(
            {"_id": ticket["_id"]},
            {"$set": updates, "$push": {"stage_history": {
                "status": updates.get("status", ticket["status"]),
                "exit_status": updates.get("exit_status"),
                "actor_id": (actor or {}).get("id"),
                "actor_name": (actor or {}).get("name") or (actor or {}).get("username") or "system",
                "at": now,
                "note": note or (f"Orders ticket reached '{outcome}'" + (f": {reason}" if reason else "")),
            }}},
        )
        await notify_ticket_handoff(ticket.get("customer_name", ""), outcome, ticket.get("assigned_to"))

        # Notify the actual customer account — main company email plus every
        # other contact on file — regardless of whether this order was placed
        # by a reseller (who gets their own separate notification) or
        # directly by Bassani staff (who today notified nobody outside the
        # warehouse). Reuses customer_id/customer_company_id already on the
        # ticket doc rather than a fresh Odoo sale.order read.
        if outcome == "ready_for_collection" and background_tasks is not None:
            partner_id = ticket.get("customer_company_id") or ticket.get("customer_id")
            if partner_id:
                odoo = get_odoo_client()
                company_email, other_emails = await _resolve_customer_notification_recipients(odoo, partner_id)
                if company_email:
                    # Show the customer their real order number (e.g. S00972),
                    # not the internal numeric id order_id holds here.
                    _order_ref = str(order_id)
                    try:
                        _so = odoo.read("sale.order", [int(order_id)], fields=["name"])
                        _order_ref = _so[0]["name"] if _so else _order_ref
                    except Exception:
                        pass
                    background_tasks.add_task(
                        send_order_ready_for_collection_customer,
                        customer_email=company_email,
                        order_ref=_order_ref,
                        customer_name=ticket.get("customer_name", ""),
                        cc=other_emails or None,
                        support_url=order_help_url(order_id),
                        payment_received=payment_received,
                    )
    except Exception as e:
        logger.warning("sales_ticket_sync_failed order_id=%s error=%s", order_id, e)


# ── 8.69 — Payment before collection ──────────────────────────────────────────
# A deposit order (balance still owing) or a pay-before-collection order is
# packed and signed off as normal, but the customer is only told it is ready
# once its final invoice is paid. The hold is per delivery (one packing_board
# entry, its own final invoice), so a backorder delivery gets its own hold.
#
# Fields on the packing_board entry:
#   payment_hold            True while the customer notice is held
#   payment_hold_at / _amount / _invoice_name   what was owing when held
#   held_notice             what to send on release: {kind: full|partial, ...}
#   collection_released_at  when it was released (payment received)
#   collection_released_by  who/what released it (user, "Automatic")
#   customer_notified_at    when the customer was told it's ready
# An entry with no payment_hold field at all predates 8.69: treated as
# already notified (decision 2026-10-12); Mark as Collected still checks
# payment live for it.

PAID_STATES = ("paid", "in_payment")


class _DeferredTasks:
    """Stand-in for BackgroundTasks when the caller has none (the 15-minute
    payment poll): collects the sends, then runs them in a worker thread so a
    slow email provider can't stall the event loop."""
    def __init__(self):
        self.tasks: list = []

    def add_task(self, fn, *args, **kwargs):
        self.tasks.append((fn, args, kwargs))

    async def run(self):
        for fn, args, kwargs in self.tasks:
            try:
                await asyncio.to_thread(fn, *args, **kwargs)
            except Exception as e:
                logger.warning("deferred_email_failed fn=%s error=%s", getattr(fn, "__name__", fn), e)


async def _linked_sales_ticket(order_id) -> Optional[dict]:
    try:
        return await col("tickets").find_one({"type": "sales", "order_id": int(order_id), "exit_status": None})
    except (ValueError, TypeError):
        return None


def payment_required_before_collection(ticket: Optional[dict]) -> bool:
    """Does this order have to be paid before the customer collects? True for
    a deposit order and a pay-before-collection order; False for an order
    released on account (paid later, per terms), a sample, or a legacy order
    with no Sales ticket."""
    if not ticket:
        return False
    if ticket.get("is_sample"):
        return False
    if ticket.get("payment_arrangement") == "on_account" or ticket.get("released_on_account_at"):
        return False
    return True


def _read_invoice_payment(odoo, invoice_id) -> Optional[dict]:
    try:
        rows = odoo.read("account.move", [int(invoice_id)],
                         fields=["name", "state", "payment_state", "amount_residual", "amount_total"])
    except Exception as e:
        logger.warning("invoice_payment_read_failed invoice_id=%s error=%s", invoice_id, e)
        return None
    return rows[0] if rows else None


def down_payment_invoice_ids(odoo, move_ids: list) -> set:
    """Which of these invoices are pure down-payment (deposit / advance
    payment) invoices: every product line is linked to a sale.order.line with
    is_downpayment set. A final invoice also carries a negative down-payment
    deduction line, but has real product lines too, so it never matches.
    Live-checked on Odoo 19 (2026-10-12). Returns an empty set on any error."""
    if not move_ids:
        return set()
    try:
        lines = odoo.search_read(
            "account.move.line",
            [("move_id", "in", list(move_ids)), ("display_type", "=", "product")],
            fields=["move_id", "sale_line_ids"], limit=5000,
        )
        sol_ids = list({s for l in lines for s in (l.get("sale_line_ids") or [])})
        dp_sols = set()
        if sol_ids:
            dp_sols = {r["id"] for r in odoo.read("sale.order.line", sol_ids, fields=["is_downpayment"])
                       if r.get("is_downpayment")}
        by_move: dict = {}
        for l in lines:
            mid = l["move_id"][0] if isinstance(l["move_id"], list) else l["move_id"]
            sols = l.get("sale_line_ids") or []
            by_move.setdefault(mid, []).append(bool(sols) and all(s in dp_sols for s in sols))
        return {mid for mid, flags in by_move.items() if flags and all(flags)}
    except Exception as e:
        logger.warning("down_payment_invoice_check_failed error=%s", e)
        return set()


def _invoice_is_paid(inv: Optional[dict]) -> bool:
    return bool(inv) and inv.get("state") == "posted" and inv.get("payment_state") in PAID_STATES


async def _send_collection_notices(entry: dict, ticket: Optional[dict], notice: dict,
                                   background_tasks, actor: Optional[dict], payment_received: bool,
                                   note: Optional[str] = None, notify: bool = True) -> None:
    """The customer/reseller "your order is ready" notices, plus the Sales
    ticket status, exactly as Mark Complete has always sent them. Called at
    Mark Complete when nothing is owing, or later by release_collection_holds
    once payment lands. notify=False moves the Sales ticket on but emails
    neither the customer nor the reseller (8.69d: Finance chose not to, e.g.
    the customer already collected)."""
    order_id = str(entry.get("order_id"))
    routing = await get_email_routing()
    # _sync_sales_ticket only emails the customer when given background_tasks.
    sync_tasks = background_tasks if notify else None
    if notice.get("kind") == "partial":
        await _sync_sales_ticket(order_id, "partially_fulfilled", background_tasks=sync_tasks,
                                 actor=actor, payment_received=payment_received, note=note)
        if notify and entry.get("reseller_id"):
            _res = await col("resellers").find_one({"id": entry["reseller_id"]}, {"email": 1, "name": 1, "_id": 0})
            if _res and _res.get("email"):
                background_tasks.add_task(
                    send_partial_delivery_ready,
                    reseller_email=_res["email"],
                    order_ref=str(entry.get("order_id")),
                    customer_name=entry.get("customer_name", ""),
                    reseller_name=_res.get("name") or "",
                    shipped_lines=notice.get("shipped_lines") or [],
                    backorder_lines=notice.get("backorder_lines") or [],
                    cc=routing.get("order_cc") or None,
                )
        return
    await _sync_sales_ticket(order_id, "ready_for_collection", background_tasks=sync_tasks,
                             actor=actor, payment_received=payment_received, note=note)
    if notify and entry.get("reseller_id"):
        _res = await col("resellers").find_one({"id": entry["reseller_id"]}, {"email": 1, "name": 1, "_id": 0})
        if _res and _res.get("email"):
            background_tasks.add_task(
                send_order_ready_for_collection_reseller,
                reseller_email=_res["email"],
                order_ref=str(entry.get("order_id")),
                customer_name=entry.get("customer_name", ""),
                reseller_name=_res.get("name", ""),
                cc=routing.get("order_cc") or None,
                payment_received=payment_received,
            )


async def hold_or_notify_after_complete(entry: dict, notice: dict, background_tasks, actor: dict) -> dict:
    """Mark Complete's customer-notice step (8.69). If the order must be paid
    before collection and its final invoice isn't paid, hold the notice,
    move the Sales ticket to Awaiting Payment and tell Finance. Otherwise send
    the notices now. Returns the fields written to the entry. Never raises:
    the delivery and invoice are already committed in Odoo by this point."""
    try:
        return await _hold_or_notify_impl(entry, notice, background_tasks, actor)
    except Exception as e:
        logger.error("hold_or_notify_after_complete_failed order_id=%s error=%s", entry.get("order_id"), e)
        return {}


async def _hold_or_notify_impl(entry: dict, notice: dict, background_tasks, actor: dict) -> dict:
    ticket = await _linked_sales_ticket(entry.get("order_id"))
    now = datetime.now(timezone.utc)
    inv = None
    if payment_required_before_collection(ticket):
        if entry.get("invoice_id"):
            inv = _read_invoice_payment(get_odoo_client(), entry["invoice_id"])
        if not _invoice_is_paid(inv):
            amount_due = float((inv or {}).get("amount_residual") or 0) if inv else None
            fields = {
                "payment_hold": True,
                "payment_hold_at": now,
                "payment_hold_amount": amount_due,
                "payment_hold_invoice_name": (inv or {}).get("name") or entry.get("inv_num") or None,
                "held_notice": notice,
                "collection_released_at": None,
                "customer_notified_at": None,
            }
            await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": fields})
            due_txt = f"R{amount_due:,.2f}" if amount_due is not None else "the invoice amount (invoice not raised yet)"
            await _sync_sales_ticket(
                str(entry["order_id"]), "awaiting_payment", actor=actor,
                note=f"Packed and signed off. Customer will be told it is ready once {due_txt} is paid.",
            )
            routing = await get_email_routing()
            order_ref = str(entry.get("order_id"))
            try:
                _so = get_odoo_client().read("sale.order", [int(entry["order_id"])], fields=["name"])
                order_ref = _so[0]["name"] if _so else order_ref
            except Exception:
                pass
            if routing.get("finance_notification_to"):
                background_tasks.add_task(
                    send_payment_hold_finance,
                    routing["finance_notification_to"],
                    customer_name=entry.get("customer_name", ""),
                    order_ref=order_ref,
                    invoice_ref=fields["payment_hold_invoice_name"] or "",
                    amount_due=amount_due,
                    arrangement=(ticket or {}).get("payment_arrangement") or "deposit",
                )
            await audit_log(
                "packing.payment_hold", "packing_board", str(entry["order_id"]),
                entity_label=entry.get("customer_name", ""), user=actor,
                detail={"invoice_id": entry.get("invoice_id"), "amount_due": amount_due,
                        "arrangement": (ticket or {}).get("payment_arrangement") or "deposit"},
            )
            await broadcast_monitor_refresh()
            return fields
    await _send_collection_notices(entry, ticket, notice, background_tasks, actor, payment_received=False)
    fields = {"payment_hold": False, "customer_notified_at": now}
    await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": fields})
    return fields


async def release_collection_holds(
    order_id: Optional[str] = None,
    invoice_ids: Optional[list] = None,
    background_tasks=None,
    actor: Optional[dict] = None,
    notify: bool = True,
) -> list:
    """The single place a held "ready for collection" notice is released
    (8.69). Finds held entries (by order and/or invoice), re-reads each final
    invoice in Odoo, and for every one now paid: sends the held notices,
    moves the Sales ticket to Ready for Collection, stamps
    customer_notified_at, logs it. Idempotent: an entry is claimed with a
    conditional update before anything is sent, so two callers racing (the
    poll and a button) can never notify twice. Never raises.

    notify=False (8.69d, Finance's choice on Expected Payments) still releases
    the hold and moves the ticket on, but sends no customer or reseller email;
    customer_notified_at stays empty and customer_notice_skipped is set, so
    nothing later sends it either (the entry is already released).

    Called after every payment path: Register Balance Payment / deposit on
    the ticket, Register Payment and Apply Credit on invoices, bank
    reconciliation matches, the 15-minute payment poll, and when a ticket or
    order ticket is opened."""
    query: dict = {"payment_hold": True, "collection_released_at": None,
                   "status": {"$in": ["complete", "collected"]}}
    ors = []
    if order_id is not None:
        ors.append({"order_id": str(order_id)})
    if invoice_ids:
        ors.append({"invoice_id": {"$in": [int(i) for i in invoice_ids]}})
    if ors:
        query["$or"] = ors
    try:
        held = await col("packing_board").find(query).to_list(length=200)
    except Exception as e:
        logger.warning("release_collection_holds_query_failed error=%s", e)
        return []
    held = [e for e in held if e.get("invoice_id")]
    if not held:
        return []
    try:
        odoo = get_odoo_client()
        rows = odoo.read("account.move", list({int(e["invoice_id"]) for e in held}),
                         fields=["name", "state", "payment_state", "amount_residual"])
    except Exception as e:
        logger.warning("release_collection_holds_odoo_failed error=%s", e)
        return []
    inv_map = {r["id"]: r for r in rows}
    tasks = background_tasks if background_tasks is not None else _DeferredTasks()
    actor = actor or {"id": None, "name": "Automatic (payment received)", "role": "system"}
    released = []
    for entry in held:
        inv = inv_map.get(int(entry["invoice_id"]))
        if not _invoice_is_paid(inv):
            continue
        now = datetime.now(timezone.utc)
        claimed = await col("packing_board").find_one_and_update(
            {"_id": entry["_id"], "payment_hold": True, "collection_released_at": None},
            {"$set": {"collection_released_at": now, "customer_notified_at": now if notify else None,
                      "customer_notice_skipped": not notify,
                      "collection_released_by": actor.get("name") or actor.get("username") or "Automatic"}},
            return_document=True,
        )
        if not claimed:
            continue
        ticket = await _linked_sales_ticket(entry["order_id"])
        notice = entry.get("held_notice") or {"kind": "full"}
        await _send_collection_notices(
            claimed, ticket, notice, tasks, actor, payment_received=True,
            note=(f"Payment received ({inv['name']}), customer told the order is ready to collect" if notify
                  else f"Payment received ({inv['name']}). Customer not emailed (chosen by {actor.get('name') or 'Finance'})"),
            notify=notify,
        )
        claimed.pop("_id", None)
        await push_update(_with_age(claimed))
        await audit_log(
            "packing.payment_hold_released", "packing_board", str(entry["order_id"]),
            entity_label=entry.get("customer_name", ""), user=actor if actor.get("id") else None,
            detail={"invoice_id": entry["invoice_id"], "invoice_name": inv.get("name"),
                    "payment_state": inv.get("payment_state"), "released_by": claimed.get("collection_released_by"),
                    "customer_notified": notify},
        )
        released.append(str(entry["order_id"]))
    if released:
        await broadcast_monitor_refresh()
        if isinstance(tasks, _DeferredTasks):
            await tasks.run()
    return released


# ── WebSocket auth helpers ────────────────────────────────────────────────────

async def _verify_display_token(ws: WebSocket) -> Optional[int]:
    """Validate ?token= against the Mongo-stored per-warehouse display token.
    Returns the matched warehouse_id, or None if invalid/missing."""
    provided = ws.query_params.get("token", "").strip()
    if not provided:
        return None
    record = await col("warehouse_display_tokens").find_one({"token": provided}, {"warehouse_id": 1})
    return record["warehouse_id"] if record else None


# Phase 8.3 — roles that need read access to the board to do their job, even
# though they don't hold a granular `warehouse.*` permission. Kept separate
# from require_admin (coarse, all admins) and require_permission (granular,
# tickets.* specific) since this is neither — just "can see the board".
_BOARD_VIEW_ROLES = {"orders_clerk", "qa_manager", "responsible_pharmacist", "sales"}


async def require_board_access(current_user: dict = Depends(get_current_user)) -> dict:
    if current_user.get("is_super_admin") or current_user.get("role") in ADMIN_ROLES:
        return current_user
    if current_user.get("role") in _BOARD_VIEW_ROLES:
        return current_user
    raise HTTPException(status_code=403, detail="Access denied")


async def _verify_ws_user(ws: WebSocket, required_roles: set) -> Optional[dict]:
    token = ws.query_params.get("token", "")
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
        username = payload.get("sub")
        if not username:
            return None
        user = await get_user_by_username(username)
        if not user or not user.get("active", True):
            return None
        if user.get("is_super_admin"):
            return user
        if user.get("role") not in required_roles:
            return None
        return user
    except Exception:
        return None


# ── Shared action service ─────────────────────────────────────────────────────
# Used by both REST endpoints and WebSocket handlers to ensure audit logging
# is consistent regardless of how an action is triggered.

def _entry_query(order_id: str, picking_id: Optional[int] = None) -> dict:
    """The single lookup rule every per-entry packing_board endpoint uses to
    find the right document (2026-08-23). order_id alone is NOT unique — a
    backorder entry deliberately shares its parent's order_id (set at the
    split point in complete_entry below), so once both the primary and a
    reactivated backorder exist at the same time under the same order_id,
    a bare {"order_id": ...} lookup can silently resolve to either one.
    picking_id (Odoo's own stock.picking id, already stored on every entry
    as odoo_picking_id) is the real unique identifier for "which delivery."
    When omitted, defaults to the primary (non-backorder) entry — the exact
    rule mark_collected already used for itself before this was generalised,
    which is also why this is fully backward compatible: an order with no
    backorder only ever has one entry matching either branch, so nothing
    about the existing trained flow changes."""
    query: dict = {"order_id": order_id}
    if picking_id:
        query["odoo_picking_id"] = picking_id
    else:
        query["is_backorder"] = {"$ne": True}
    return query


async def _do_assign_packer(order_id: str, packer_name: str, actor: dict, picking_id: Optional[int] = None) -> Optional[dict]:
    result = await col("packing_board").find_one_and_update(
        _entry_query(order_id, picking_id),
        {"$set": {
            "packer_name": packer_name.upper(),
            "status":      "packing",
            "assigned_at": datetime.now(timezone.utc),
        }},
        return_document=True,
    )
    if not result:
        return None
    result.pop("_id", None)
    await push_update(result)
    await audit_log("packing.assigned", "packing_board", order_id, entity_label=order_id,
                    user=actor, detail={"packer": packer_name})
    return result


async def _do_tick_item(order_id: str, sku: str, ticked: bool, actor: dict, picking_id: Optional[int] = None) -> Optional[dict]:
    entry = await col("packing_board").find_one(_entry_query(order_id, picking_id))
    if not entry:
        return None
    ticks = entry.get("item_ticks", {})
    ticks[sku] = ticked
    all_done = all(ticks.values()) if ticks else False
    update: dict = {"item_ticks": ticks}
    if all_done:
        update["status"]   = "ready"
        update["ready_at"] = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": update},
        return_document=True,
    )
    if not updated:
        return None
    updated.pop("_id", None)
    await push_update(updated)
    if all_done:
        await audit_log("packing.items_complete", "packing_board", order_id, entity_label=order_id,
                        user=actor, detail={"packer": entry.get("packer_name")})
    return updated


async def _do_update_status(order_id: str, new_status: str, actor: dict, picking_id: Optional[int] = None) -> Optional[dict]:
    ts_field = {
        "collected": "collected_at",
        "cleared":   "cleared_at",
        "ready":     "ready_at",
    }.get(new_status)
    update: dict = {"status": new_status}
    if ts_field:
        update[ts_field] = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        _entry_query(order_id, picking_id),
        {"$set": update},
        return_document=True,
    )
    if not updated:
        return None
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log(f"packing.{new_status}", "packing_board", order_id, entity_label=order_id, user=actor)
    await broadcast_monitor_refresh()
    return updated


# ── Pydantic models ───────────────────────────────────────────────────────────

class BoardEntry(BaseModel):
    order_id:      str
    warehouse_id:  Optional[int] = None
    customer_name: str
    customer_city: str
    items:         List[dict]
    total_units:   int
    inv_num:       str
    dn_num:        str
    ps_num:        str
    notes:         Optional[str] = ""
    is_reseller:   bool = False
    reseller_name: Optional[str] = None
    order_value:   Optional[float] = None


class AssignPacker(BaseModel):
    order_id:    str
    packer_name: str
    picking_id:  Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class UpdateStatus(BaseModel):
    order_id:   str
    status:     str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class OrderIdBody(BaseModel):
    order_id:   str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class RetroactivePackingBody(BaseModel):
    """Reconciliation wizard, step 1 (2026-08-28) — see the endpoint's own
    docstring below."""
    order_id:    str
    picking_id:  Optional[int] = None
    packer_name: Optional[str] = None


class IncompleteBody(BaseModel):
    order_id:   str
    reason:     str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class CancelBody(BaseModel):
    order_id:   str
    reason:     Optional[str] = None
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


class AdoptBody(BaseModel):
    order_id: int  # Odoo sale.order ID (integer)

class MarkCollectedBody(BaseModel):
    order_id: str
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry

class UpdateItemQtyBody(BaseModel):
    order_id:   str
    sku:        str
    qty_packed: float
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry


# ── REST endpoints ────────────────────────────────────────────────────────────

@router.post("/queue")
async def add_to_board(
    entry: BoardEntry,
    current_user: dict = Depends(require_admin),
):
    now = datetime.now(timezone.utc)
    doc = {
        **entry.model_dump(),
        "packer_name":  None,
        "status":       "queued",
        "queued_at":    now,
        "packed_at":    None,
        "ready_at":     None,
        "collected_at": None,
        "cancelled_at":   None,
        "incomplete_at":  None,
        "completed_at":   None,
        "incomplete_reason": None,
        "qa_approved_by": None, "qa_approved_at": None,
        "rp_approved_by": None, "rp_approved_at": None,
        "item_ticks":   {i["sku"]: False for i in entry.items},
    }
    await col("packing_board").replace_one(
        {"order_id": entry.order_id},
        doc,
        upsert=True,
    )
    await push_update(doc)
    await audit_log("packing.queued", "packing_board", entry.order_id, entity_label=entry.customer_name,
                    user=current_user, detail={"customer": entry.customer_name, "units": entry.total_units})
    await broadcast_monitor_refresh()
    return {"success": True, "order_id": entry.order_id}


@router.put("/assign")
async def assign_packer(
    body: AssignPacker,
    current_user: dict = Depends(require_admin),
):
    result = await _do_assign_packer(body.order_id, body.packer_name, current_user, body.picking_id)
    if not result:
        raise HTTPException(status_code=404, detail="Order not on board")
    return {"success": True, "packer": body.packer_name.upper()}


@router.put("/tick")
async def tick_item(
    order_id: str,
    sku:      str,
    ticked:   bool = True,
    picking_id: Optional[int] = None,
    current_user: dict = Depends(require_admin),
):
    updated = await _do_tick_item(order_id, sku, ticked, current_user, picking_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    all_done = all(updated["item_ticks"].values()) if updated.get("item_ticks") else False
    return {"success": True, "all_done": all_done, "status": updated["status"]}


@router.put("/update-item-qty")
async def update_item_qty(
    body: UpdateItemQtyBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Packer sets the actual qty they have in hand for a specific line item.
    Stored as qty_packed on the item; used as qty_done when validating in Odoo.
    Must be >= 0 and <= qty_reserved. If below reserved, Odoo will auto-create
    a backorder for the shortfall when the order is marked complete."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "packing":
        raise HTTPException(status_code=400, detail=f"Qty can only be edited while packing (current status: '{entry['status']}')")

    items = entry.get("items", [])
    item = next((i for i in items if i.get("sku") == body.sku), None)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found on this order")

    qty_reserved = float(item.get("qty_reserved") or item.get("qty") or 0)
    if body.qty_packed < 0:
        raise HTTPException(status_code=400, detail="Qty packed cannot be negative")
    if body.qty_packed > qty_reserved:
        raise HTTPException(status_code=400, detail=f"Qty packed ({body.qty_packed}) cannot exceed reserved qty ({qty_reserved})")

    new_items = [
        {**i, "qty_packed": body.qty_packed} if i.get("sku") == body.sku else i
        for i in items
    ]
    await col("packing_board").update_one(
        {"_id": entry["_id"]},
        {"$set": {"items": new_items}},
    )
    await audit_log(
        "packing.qty_packed", "packing_board", body.order_id,
        entity_label=body.order_id, user=current_user,
        detail={"sku": body.sku, "qty_packed": body.qty_packed, "qty_reserved": qty_reserved},
    )
    return {"success": True, "qty_packed": body.qty_packed}


@router.put("/status")
async def update_status(
    body: UpdateStatus,
    current_user: dict = Depends(require_admin),
):
    updated = await _do_update_status(body.order_id, body.status, current_user, body.picking_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    return {"success": True}


async def _log_signoff_activity(order_id: str, current_user: dict, note: str) -> None:
    """QA/RP sign-off (2026-09-29) already writes a full audit_logs entry via
    audit_log(), but never touched the linked ticket's own stage_history —
    so the Activity Log a sales/ops user actually looks at (SalesTickets.js /
    OrdersTickets.js / OrderPassport.js's ActivityLogCard) showed the deposit
    and the terminal outcome but skipped the two sign-offs in between. Mirrors
    _sync_sales_ticket's own note-only push shape (status/exit_status
    unchanged) — best-effort and silent, must never block a sign-off that
    already wrote to Odoo/packing_board."""
    try:
        ticket = await col("tickets").find_one({"type": "sales", "order_id": int(order_id), "exit_status": None})
        if not ticket:
            return
        await col("tickets").update_one(
            {"_id": ticket["_id"]},
            {"$push": {"stage_history": {
                "status": ticket.get("status"), "exit_status": None,
                "actor_id": current_user.get("id"),
                "actor_name": current_user.get("name") or current_user.get("username") or "system",
                "at": datetime.now(timezone.utc), "note": note,
            }}},
        )
    except Exception as exc:
        logger.warning("signoff_activity_log_failed order_id=%s error=%s", order_id, exc)


@router.put("/qa-approve")
async def qa_approve(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.qa_approve")),
):
    """QA Manager sign-off — required (alongside RP) before an entry can be
    marked complete. Only valid once packing has finished (status='ready')."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "ready":
        raise HTTPException(status_code=400, detail="Order isn't ready for inspection yet")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"qa_approved_by": current_user.get("name") or current_user.get("username"), "qa_approved_at": now}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.qa_approve", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
    await _log_signoff_activity(body.order_id, current_user, f"QA approved by {current_user.get('name') or current_user.get('username')}")
    await broadcast_monitor_refresh()
    return {"success": True}


@router.put("/rp-approve")
async def rp_approve(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.rp_approve")),
):
    """Responsible Pharmacist sign-off — required (alongside QA) before an
    entry can be marked complete. Independent of QA's approval — neither
    approves on the other's behalf."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "ready":
        raise HTTPException(status_code=400, detail="Order isn't ready for inspection yet")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"rp_approved_by": current_user.get("name") or current_user.get("username"), "rp_approved_at": now}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.rp_approve", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
    await _log_signoff_activity(body.order_id, current_user, f"RP approved by {current_user.get('name') or current_user.get('username')}")
    await broadcast_monitor_refresh()
    return {"success": True}


def _odoo_error_text(e: Exception) -> str:
    """Readable one-line reason from an Odoo error. An XML-RPC Fault carries
    Odoo's whole server traceback; only its last line ("TypeError: ...",
    "UserError: ...") means anything to the Finance user who sees it in the
    invoice banner (found 2026-10-13, Sentry #152634442)."""
    if isinstance(e, xmlrpc.client.Fault):
        lines = [ln.strip() for ln in str(e.faultString).splitlines() if ln.strip()]
        return (lines[-1] if lines else str(e.faultString))[:300]
    return str(e)[:300]


def _validate_odoo_delivery(odoo_order_id: int, qty_overrides: Optional[dict] = None,
                            cancel_backorder: bool = False) -> dict:
    """Validate all assigned stock.picking records linked to an Odoo sale order.

    Normally sets qty_done = reserved quantity by writing it directly onto each
    move line (there is no working Odoo convenience method for this on this
    Odoo 19 instance — see the 2026-09-08 note below). When qty_overrides is
    provided ({product_id: qty_packed}), writes those specific qty_done values
    to the move lines instead — allowing a packer-reported shortfall to
    produce a backorder automatically via Odoo's standard wizard.

    Returns {"success": bool, "pickings": [name, ...], "error": str|None,
             "backorder_picking_id": int|None, "backorder_picking_name": str|None}.
    Never raises — caller always continues regardless of outcome.
    """
    _odoo = get_odoo_client()
    _no_backorder = {"backorder_picking_id": None, "backorder_picking_name": None}
    # Only outgoing transfers (deliveries) count (2026-10-10, found live on
    # S01181): Odoo also links receipts to a sale order (e.g. a buy/resupply
    # route triggered at confirm), and a cancelled transfer stays linked
    # forever. Without this filter an assigned receipt would be validated
    # here as if it were the delivery, and the reconcile fallback below could
    # never succeed for an order carrying a cancelled transfer. Odoo has 139
    # non-delivery transfers linked to sale orders, so this isn't rare.
    _outgoing = [("sale_id", "=", odoo_order_id), ("picking_type_code", "=", "outgoing")]
    try:
        pickings = _odoo.search_read(
            "stock.picking",
            _outgoing + [("state", "=", "assigned")],
            ["id", "name"],
        )
    except Exception as e:
        return {"success": False, "pickings": [], "error": f"Could not fetch delivery orders from Odoo: {e}", **_no_backorder}

    if not pickings:
        # Nothing left in Odoo's "assigned" (Ready) state — this used to be
        # treated as a flat failure regardless of why, which conflated two
        # very different situations: a delivery that was already validated
        # (state "done") outside this button — most commonly staff doing
        # the picking directly in Odoo instead of through the portal — is
        # functionally the same outcome this function itself would have
        # produced, just not via this call; a delivery that's genuinely not
        # ready (no stock reserved yet, or no delivery generated at all) is
        # a real problem. Reconciling against Odoo's actual state here
        # (2026-08-27, found live) rather than assuming the portal is the
        # only possible actor matches this app's own architecture principle
        # that staff shouldn't need Odoo at all for routine work — but that
        # only holds if the portal also correctly recognizes when someone
        # legitimately did act there directly.
        try:
            all_pickings = _odoo.search_read(
                "stock.picking",
                _outgoing + [("state", "!=", "cancel")],
                ["id", "name", "state"],
            )
        except Exception as e:
            return {"success": False, "pickings": [], "error": f"Could not fetch delivery orders from Odoo: {e}", **_no_backorder}

        if not all_pickings:
            return {
                "success": False, "pickings": [],
                "error": "No delivery orders found for this order in Odoo — check that the sale order has generated a delivery",
                **_no_backorder,
            }
        done_pickings = [p for p in all_pickings if p["state"] == "done"]
        if len(done_pickings) == len(all_pickings):
            # Every delivery on this order was already validated — nothing
            # left for this call to do, and that's a success, not an error.
            return {"success": True, "pickings": [p["name"] for p in done_pickings], "error": None, **_no_backorder}
        states = ", ".join(sorted({p["state"] for p in all_pickings}))
        return {
            "success": False, "pickings": [],
            "error": f"Delivery not yet ready to validate in Odoo (current state: {states}) — check stock reservation",
            **_no_backorder,
        }

    validated: list = []
    errors: list = []
    backorder_picking_id: Optional[int] = None
    backorder_picking_name: Optional[str] = None
    for picking in pickings:
        pid = picking["id"]
        pname = picking["name"]
        try:
            # 'quantity' not 'reserved_uom_qty' (2026-08-11, live-verified
            # against production Odoo 19 — see order_routes.py's
            # _queue_packing_board for the fuller field-drift writeup):
            # 'reserved_uom_qty' does not exist on this instance's
            # stock.move.line at all. 'quantity' holds the reserved-but-
            # unpicked amount for that specific move line before completion,
            # confirmed live across real assigned pickings.
            #
            # Odoo 19 has no stored qty_done on stock.move.line (2026-10-13,
            # live-checked: qty_done is a non-stored compatibility field). The
            # amount being delivered is the move line's own `quantity`, and a
            # line only counts towards this delivery once `picked` is True;
            # unpicked lines are left for the backorder. Written through
            # OdooClient.write() — execute(model, "write", [[id], vals]) wraps
            # the args in one list too many, so Odoo saw write([[id], vals])
            # and every Mark Complete since 2026-09-08 failed here (Sentry
            # #153357473, caught by the 6.6 drift alerting).
            #
            # quantities must be written directly to each move line rather than
            # via Odoo's old "Set" convenience button — there is no
            # 'action_set_quantities_to_reservation' method on this Odoo 19
            # instance at all (2026-09-08, root cause of Sentry #143212165 /
            # every order silently never reaching a validated delivery:
            # confirmed live via a safe empty-id probe —
            # AttributeError: "The method
            # 'stock.picking.action_set_quantities_to_reservation' does not
            # exist" — that convenience button was removed in this Odoo
            # version). This used to only run in the qty_overrides branch;
            # both branches now share the same direct-write mechanism so
            # there is no code path left that depends on the missing method.
            from collections import defaultdict as _dd
            move_lines = _odoo.search_read(
                "stock.move.line",
                [("picking_id", "=", pid), ("state", "not in", ["done", "cancel"])],
                ["id", "product_id", "quantity"],
            )
            if qty_overrides:
                # Apply per-product qty_done values; fill move lines in order,
                # stopping when the packer-reported qty is reached.
                product_mls: dict = _dd(list)
                for ml in move_lines:
                    pid_val = ml["product_id"][0] if isinstance(ml["product_id"], list) else ml["product_id"]
                    product_mls[pid_val].append(ml)
                for product_id_val, mls in product_mls.items():
                    override = qty_overrides.get(product_id_val)
                    remaining = float(override) if override is not None else None
                    for ml in mls:
                        reserved = float(ml.get("quantity", 0))
                        take = reserved if remaining is None else min(remaining, reserved)
                        # A fully short line stays unpicked so it goes to the backorder
                        _odoo.write("stock.move.line", [ml["id"]],
                                    {"quantity": take, "picked": True} if take > 0 else {"picked": False})
                        if remaining is not None:
                            remaining = max(0.0, remaining - take)
            else:
                for ml in move_lines:
                    _odoo.write("stock.move.line", [ml["id"]], {"picked": True})
            result = _odoo.execute("stock.picking", "button_validate", [pid])
            if isinstance(result, dict) and result.get("res_model") == "stock.backorder.confirmation":
                # Partial reservation — ask Odoo to auto-create a backorder,
                # unless the customer chose to take part and drop the rest
                # (8.70f), in which case the remainder is cancelled instead.
                # The wizard must receive the context button_validate returned
                # (button_validate_picking_ids etc.): on Odoo 17+ process() /
                # process_cancel_backorder() validate nothing without it, and
                # returned quietly here before (found 2026-10-11 building 8.70).
                try:
                    from odoo_client import odoo as _odoo_call
                    _wctx = result.get("context") or {}
                    wiz_id = _odoo_call("stock.backorder.confirmation", "create",
                                        [{"pick_ids": [(4, pid)]}], {"context": _wctx})
                    _odoo_call("stock.backorder.confirmation",
                               "process_cancel_backorder" if cancel_backorder else "process",
                               [[wiz_id]], {"context": _wctx})
                    # Capture the new backorder picking so we can create a portal entry
                    _bo_picks = _odoo.search_read(
                        "stock.picking",
                        [("backorder_id", "=", pid), ("state", "not in", ["done", "cancel"])],
                        ["id", "name"],
                        limit=1,
                    )
                    if _bo_picks:
                        backorder_picking_id = _bo_picks[0]["id"]
                        backorder_picking_name = _bo_picks[0]["name"]
                except Exception:
                    pass  # wizard failed; the state check below reports it honestly
            # Re-read rather than assume (2026-10-11): a validate that Odoo
            # didn't actually complete used to be reported as validated.
            _state = _odoo.read("stock.picking", [pid], ["state"])
            if _state and _state[0].get("state") == "done":
                validated.append(pname)
            else:
                errors.append(f"{pname}: not completed in Odoo (state: {(_state or [{}])[0].get('state', 'unknown')})")
        except Exception as e:
            errors.append(f"{pname}: {_odoo_error_text(e)}")

    if errors and not validated:
        return {"success": False, "pickings": [], "error": "; ".join(errors), **_no_backorder}
    if errors:
        return {"success": True, "pickings": validated, "error": f"Partial: {'; '.join(errors)}", "backorder_picking_id": backorder_picking_id, "backorder_picking_name": backorder_picking_name}
    return {"success": True, "pickings": validated, "error": None, "backorder_picking_id": backorder_picking_id, "backorder_picking_name": backorder_picking_name}


async def _create_final_invoice(entry: dict, now: datetime, background_tasks: BackgroundTasks) -> dict:
    """Create + post the final delivery invoice for an order in Odoo (after
    QA + RP sign-off) and stamp its id back onto the linked Sales ticket.
    Extracted from complete_entry (2026-08-27) so the same logic can be
    re-run standalone by the retry-invoice-creation endpoint below, for an
    order that reached "complete" with no invoice created — e.g. the
    create_invoices() TypeError incident (see this file's own history) left
    orders stuck at "complete" with no invoice and no way to register the
    balance payment. Never raises — returns invoice_warning on any failure,
    same as complete_entry's own original inline try/except did."""
    invoice_id: Optional[int] = None
    invoice_name: Optional[str] = None
    invoice_warning: Optional[str] = None
    invoice_sent = False
    try:
        odoo = get_odoo_client()
        sale_order_id = int(entry["order_id"])

        # All invoice lookups below key off sale.order.invoice_ids — Odoo's
        # own authoritative relation — never a string match against
        # invoice_origin (2026-08-27 fix, found live: that heuristic missed
        # a real draft final invoice that genuinely existed in Odoo, because
        # this specific order's invoice_origin didn't contain the plain
        # order id as a substring the way it was assumed to).
        _ticket_doc = await col("tickets").find_one(
            {"type": "sales", "order_id": sale_order_id, "exit_status": None},
            {"invoice_id": 1, "is_sample": 1, "payment_arrangement": 1, "released_on_account_at": 1,
             "deposit_invoice_ids": 1},
        )
        _deposit_invoice_id = _ticket_doc.get("invoice_id") if _ticket_doc else None
        _collection_after_payment = payment_required_before_collection(_ticket_doc)

        try:
            _order_rows = odoo.read("sale.order", [sale_order_id], fields=["invoice_ids"])
            _invoice_ids_before = set(_order_rows[0].get("invoice_ids", [])) if _order_rows else set()
        except Exception:
            _invoice_ids_before = set()

        # Check for a usable final invoice already sitting in Odoo before
        # creating a new one — the create_invoices() XML-RPC marshalling
        # quirk below can leave a real draft invoice created server-side
        # even when the call raises and the overall attempt gets reported
        # as a failure; a second create_invoices() call against the same
        # order can then behave unpredictably (Odoo may see nothing further
        # to invoice) rather than cleanly erroring. Reusing an already-
        # existing, not-yet-linked invoice instead of blindly creating
        # another is the same "check before creating" principle
        # ticket_routes.py's existing-invoices/use-existing-invoice flow
        # already established for the deposit invoice — never a parallel-
        # ledger risk (Architecture Principle #1), just avoiding a genuine
        # duplicate-invoice risk. Excludes the deposit invoice specifically.
        # 8.69 — also exclude every down-payment invoice (several advance
        # payments on a pay-before-collection order, or a deposit whose id was
        # overwritten on the ticket by an earlier delivery's final invoice)
        # and any invoice already linked to another delivery of this order.
        # Without this, a paid deposit invoice could be reused as a later
        # delivery's "final" invoice.
        _excluded = {_deposit_invoice_id} if _deposit_invoice_id else set()
        _excluded |= set((_ticket_doc or {}).get("deposit_invoice_ids") or [])
        async for _other in col("packing_board").find(
            {"order_id": str(sale_order_id), "invoice_id": {"$ne": None}}, {"invoice_id": 1},
        ):
            if _other.get("invoice_id"):
                _excluded.add(int(_other["invoice_id"]))
        _candidate_ids = [i for i in _invoice_ids_before if i not in _excluded]
        _existing = []
        if _candidate_ids:
            try:
                _rows = odoo.read("account.move", _candidate_ids, fields=["id", "name", "state", "move_type"])
                _rows = [r for r in _rows if r.get("move_type") == "out_invoice" and r.get("state") != "cancel"]
                _dp = down_payment_invoice_ids(odoo, [r["id"] for r in _rows])
                _existing = sorted((r for r in _rows if r["id"] not in _dp), key=lambda r: r["id"], reverse=True)
            except Exception:
                _existing = []

        if _existing:
            invoice_id = _existing[0]["id"]
            invoice_name = _existing[0]["name"]
            if _existing[0]["state"] == "draft":
                odoo.execute("account.move", "action_post", [invoice_id])
        else:
            # Never invoice before something is delivered (2026-10-13, found
            # live on S01191). With nothing delivered, the only thing left to
            # invoice is the deposit deduction, which is negative, so Odoo
            # creates a draft CREDIT NOTE for the deposit instead of an
            # invoice. That draft then counts as the deduction, so the real
            # invoice created after delivery charged the full amount again.
            # Guarded here so every caller (Mark Complete, Retry, the
            # reconciliation wizard) is covered.
            try:
                _lines = odoo.search_read(
                    "sale.order.line",
                    [("order_id", "=", sale_order_id), ("display_type", "=", False),
                     ("is_downpayment", "=", False)],
                    ["qty_to_invoice"],
                )
                _to_invoice = sum(float(l.get("qty_to_invoice") or 0) for l in _lines)
            except Exception:
                _to_invoice = None  # can't tell; the credit-note check below still protects
            if _to_invoice is not None and _to_invoice <= 0:
                return {
                    "invoice_id": None, "invoice_name": None,
                    "invoice_warning": ("Nothing has been delivered yet, so there is nothing to invoice. "
                                        "The delivery must be validated in Odoo first."),
                    "invoice_sent": False,
                }
            wiz_id = odoo.create(
                "sale.advance.payment.inv",
                {"advance_payment_method": "delivered", "sale_order_ids": [(4, sale_order_id)]},
            )

            # Capture invoice_ids before the call so a genuine failure can be
            # told apart from create_invoices' known XML-RPC response-
            # serialization quirk (found and fixed once already in
            # ticket_routes.py::register_deposit for the deposit invoice, hit
            # again here for the final invoice) — the action dict Odoo
            # returns can contain None values the marshaller rejects even
            # though the invoice really was created. Assuming every
            # exception from create_invoices IS that harmless quirk is
            # itself the mistake register_deposit's own fix corrected — a
            # genuine failure (nothing to invoice, a validation error)
            # raises the exact same way and looks identical from here
            # without this check. (_invoice_ids_before already captured above.)
            _raised: Optional[Exception] = None
            try:
                # OdooClient.execute()'s (*args) -> single flat args list has
                # no way to send real XML-RPC kwargs/context —
                # create_invoices() on Odoo 19 takes no extra arguments at
                # all, deriving everything from the wizard's own already-set
                # sale_order_ids field (2026-08-27 fix).
                odoo.execute("sale.advance.payment.inv", "create_invoices", [wiz_id])
            except Exception as e:
                _raised = e
                logger.warning(
                    "final_invoice_create_invoices_response_error",
                    extra={"wiz_id": wiz_id, "order_id": sale_order_id, "error": str(e)},
                )

            # Resolve the new invoice by diffing invoice_ids, whether or not
            # create_invoices() itself raised — on success this is the only
            # lookup (replacing an earlier invoice_origin string search that
            # could miss a real invoice); on the marshalling quirk it's what
            # tells a harmless response-serialization failure apart from a
            # genuine one (nothing new means genuine).
            try:
                _after_rows = odoo.read("sale.order", [sale_order_id], fields=["invoice_ids"])
                _new_ids = (set(_after_rows[0].get("invoice_ids", [])) - _invoice_ids_before) if _after_rows else set()
            except Exception:
                _new_ids = set()

            if _raised and not _new_ids:
                # No new invoice actually appeared — a real failure, not the
                # serialization quirk. invoice_id is still None here, so the
                # ticket-stamping block below is already correctly a no-op.
                return {
                    "invoice_id": None, "invoice_name": None,
                    "invoice_warning": f"Invoice creation failed: {_raised}", "invoice_sent": False,
                }

            if _new_ids:
                try:
                    _new_rows = odoo.read("account.move", list(_new_ids), fields=["id", "name", "move_type", "state"])
                    # A credit note here means Odoo found a negative amount to
                    # invoice (see the guard above). Delete the draft we just
                    # caused rather than leave it to swallow the deposit.
                    _stray = [r["id"] for r in _new_rows if r.get("move_type") == "out_refund" and r.get("state") == "draft"]
                    if _stray:
                        odoo.unlink("account.move", _stray)
                        return {
                            "invoice_id": None, "invoice_name": None,
                            "invoice_warning": ("Odoo produced a credit note instead of an invoice (nothing delivered "
                                                "beyond the deposit). It has been removed; validate the delivery and retry."),
                            "invoice_sent": False,
                        }
                    _new_out = sorted(
                        (r for r in _new_rows if r.get("move_type") == "out_invoice"),
                        key=lambda r: r["id"], reverse=True,
                    )
                except Exception:
                    _new_out = []
                if _new_out:
                    invoice_id = _new_out[0]["id"]
                    invoice_name = _new_out[0]["name"]
                    if _new_out[0]["state"] == "draft":
                        odoo.execute("account.move", "action_post", [invoice_id])

        if invoice_id:
            # Auto-send the final invoice to the customer via the portal's own
            # email system (2026-08-27) — replaces the previous Odoo
            # mail.template send (same change applied to ticket_routes.py's
            # manual "Send Invoice" action and invoice_routes.py's standalone
            # one) so this email carries the portal's own branding and follows
            # the Email Standards, matching send_deposit_due_proforma. Non-
            # fatal — degrades to a warning, same as before. Runs whether this
            # invoice was newly created above or an existing not-yet-linked
            # one was just found and reused.
            try:
                _inv_rows = odoo.read("account.move", [invoice_id], fields=["name", "partner_id", "amount_total", "payment_state", "payment_reference", "invoice_date_due"])
                _inv = _inv_rows[0] if _inv_rows else {}
                _inv_partner = _inv.get("partner_id")
                _customer_email = None
                if _inv_partner:
                    _p_rows = odoo.read("res.partner", [_inv_partner[0]], fields=["email"])
                    _customer_email = _p_rows[0].get("email") if _p_rows else None
                if not _customer_email:
                    invoice_warning = "Invoice created but the customer has no email on file — invoice was not sent"
                else:
                    _order_rows = odoo.read("sale.order", [sale_order_id], fields=["name"])
                    _order_ref = _order_rows[0]["name"] if _order_rows else str(sale_order_id)
                    _pdf_bytes = fetch_report_pdf("account.report_invoice_with_payments", [invoice_id])
                    background_tasks.add_task(
                        send_invoice_email,
                        customer_email=_customer_email,
                        customer_name=_inv_partner[1] if _inv_partner else "",
                        order_ref=_order_ref,
                        invoice_ref=_inv.get("name") or invoice_name or f"#{invoice_id}",
                        amount_total=float(_inv.get("amount_total", 0) or 0),
                        pdf_bytes=bytes(_pdf_bytes),
                        payment_state=_inv.get("payment_state"),
                        payment_reference=_inv.get("payment_reference"),
                        support_url=order_help_url(sale_order_id),
                        due_date=_inv.get("invoice_date_due") or None,
                        collection_after_payment=_collection_after_payment,
                    )
                    invoice_sent = True
                    # Chatter note (2026-08-28) — see the matching note in
                    # ticket_routes.py's send_invoice/_send_quote_impl for why
                    # this is needed now that the send doesn't go through
                    # Odoo's own mail.template. Best-effort, isolated in its
                    # own try so a chatter-write failure can never turn a
                    # genuinely successful invoice send into a warning.
                    try:
                        odoo.message_post(
                            "account.move", invoice_id,
                            f"Invoice sent to {_customer_email} via the Bassani Health Portal.",
                        )
                    except Exception:
                        pass
            except Exception as e:
                invoice_warning = f"Invoice created but the email may not have been sent: {e}"
    except Exception as e:
        invoice_warning = f"Invoice creation failed: {e}"

    # Stamp invoice_id on the linked sales ticket so Finance can register payment
    if invoice_id:
        try:
            _st = await col("tickets").find_one(
                {"type": "sales", "order_id": int(entry["order_id"]), "exit_status": None}
            )
            if _st:
                _ticket_set: dict = {"invoice_id": invoice_id}
                if invoice_sent:
                    _ticket_set["invoice_sent_at"] = now
                await col("tickets").update_one({"_id": _st["_id"]}, {"$set": _ticket_set})
        except Exception:
            pass

    return {
        "invoice_id": invoice_id, "invoice_name": invoice_name,
        "invoice_warning": invoice_warning, "invoice_sent": invoice_sent,
    }


@router.put("/complete")
async def complete_entry(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk's final close-out action — the explicit "I'm declaring
    this ready" step the business described, taken only after both QA and RP
    have independently signed off."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "ready":
        raise HTTPException(status_code=400, detail="Order must be ready before it can be marked complete")
    if not entry.get("qa_approved_at") or not entry.get("rp_approved_at"):
        raise HTTPException(status_code=400, detail="Both QA and RP approval are required before marking complete")

    now = datetime.now(timezone.utc)

    # ── Odoo delivery validation (non-blocking) ────────────────────────────────
    _no_bo: dict = {"backorder_picking_id": None, "backorder_picking_name": None}
    delivery_result: dict = {"success": False, "pickings": [], "error": "Not attempted", **_no_bo}

    # Build per-product qty overrides from packer-reported qty_packed values.
    packing_items = entry.get("items", [])
    qty_overrides: Optional[dict] = None
    _packed_map = {
        i["product_id"]: float(i["qty_packed"])
        for i in packing_items
        if i.get("product_id") and i.get("qty_packed") is not None
    }
    if _packed_map:
        qty_overrides = _packed_map

    try:
        odoo_order_id = int(entry["order_id"])
        delivery_result = _validate_odoo_delivery(odoo_order_id, qty_overrides,
                                                  cancel_backorder=await _drop_rest_chosen(entry))
    except (ValueError, TypeError) as e:
        delivery_result = {"success": False, "pickings": [], "error": f"Invalid order ID: {e}", **_no_bo}
    except Exception as e:
        delivery_result = {"success": False, "pickings": [], "error": str(e), **_no_bo}

    is_partial = bool(entry.get("has_pending_invoice"))

    # Detect packing-time shortfall: packer reported less than reserved for at least one product
    # and Odoo created a new backorder picking.
    _is_packing_shortfall = bool(
        qty_overrides
        and delivery_result.get("backorder_picking_id")
        and any(
            _packed_map.get(i.get("product_id"), i.get("qty_reserved", 0)) < float(i.get("qty_reserved", 0))
            for i in packing_items
            if i.get("product_id")
        )
    )

    backorder_entry_id: Optional[str] = None
    backorder_picking_name: Optional[str] = delivery_result.get("backorder_picking_name")

    # ── Create backorder packing entry when a partial delivery was validated ──
    if (is_partial or _is_packing_shortfall) and delivery_result.get("backorder_picking_id"):
        if _is_packing_shortfall:
            # Items that were short at packing time — qty = reserved minus what was packed
            _bo_items = [
                {
                    "name": i["name"],
                    "sku": i.get("sku", ""),
                    "product_id": i.get("product_id"),
                    "qty": round(float(i.get("qty_reserved", 0)) - _packed_map.get(i["product_id"], float(i.get("qty_reserved", 0))), 4),
                    "qty_ordered": round(float(i.get("qty_reserved", 0)) - _packed_map.get(i["product_id"], float(i.get("qty_reserved", 0))), 4),
                    "qty_reserved": 0,
                    "is_backordered": False,
                    "location": "",
                }
                for i in packing_items
                if i.get("product_id") and _packed_map.get(i["product_id"]) is not None
                and _packed_map[i["product_id"]] < float(i.get("qty_reserved", 0))
            ]
            # Ensure mark_collected will create an invoice for the delivered qty
            if not is_partial:
                await col("packing_board").update_one(
                    {"_id": entry["_id"]},
                    {"$set": {"has_pending_invoice": True}},
                )
        else:
            # Pre-packing backorder (existing logic) — items flagged is_backordered at confirmation
            _bo_items = [
                {
                    "name": i["name"],
                    "sku": i.get("sku", ""),
                    "product_id": i.get("product_id"),
                    "qty": round(i.get("qty_ordered", i.get("qty", 0)) - i.get("qty_reserved", 0), 4),
                    "qty_ordered": round(i.get("qty_ordered", i.get("qty", 0)) - i.get("qty_reserved", 0), 4),
                    "qty_reserved": 0,
                    "is_backordered": False,
                    "location": "",
                }
                for i in packing_items
                if i.get("is_backordered")
            ]
        _bo_entry = {
            "order_id": body.order_id,
            "odoo_picking_id": delivery_result["backorder_picking_id"],
            "picking_name": backorder_picking_name,
            "is_backorder": True,
            "parent_packing_id": str(entry["_id"]),
            "waiting_stock": True,
            "has_pending_invoice": True,
            "status": "waiting_stock",
            "items": _bo_items,
            "reseller_id": entry.get("reseller_id"),
            "customer_name": entry.get("customer_name"),
            "partner_id": entry.get("partner_id"),
            "assigned_packer": None,
            "qa_approved_at": None, "qa_approved_by": None,
            "rp_approved_at": None, "rp_approved_by": None,
            "collected_at": None, "collected_by": None,
            "delivery_validated": None,
            "created_at": now,
            "completed_at": None,
            "notes": f"Backorder for {entry.get('picking_name', body.order_id)}",
        }
        _bo_result = await col("packing_board").insert_one(_bo_entry)
        backorder_entry_id = str(_bo_result.inserted_id)

    # ── Create and post Odoo invoice for delivered qty ────────────────────────
    # Invoice is raised here (after QA + RP sign-off) for all orders including
    # samples. Sample invoices total R0.00 and Odoo marks them paid immediately.
    # Skipped entirely when delivery validation itself failed above (2026-09-08,
    # found live via Sentry #143212165) — every Bassani product is
    # invoice_policy=delivery, so Odoo will always refuse "no items available
    # to invoice" until the delivery is genuinely validated (picking state
    # "done"). Attempting create_invoices() anyway just spends an Odoo round
    # trip to reproduce that confusing fault in place of the real, actionable
    # reason — the delivery issue itself, which is what gets persisted instead.
    if delivery_result["success"]:
        _inv_result = await _create_final_invoice(entry, now, background_tasks)
        invoice_id      = _inv_result["invoice_id"]
        invoice_name    = _inv_result["invoice_name"]
        invoice_warning = _inv_result["invoice_warning"]
    else:
        invoice_id = None
        invoice_name = None
        invoice_warning = (
            "Delivery could not be validated in Odoo, so no invoice was created: "
            f"{delivery_result.get('error') or 'unknown error'}"
        )

    _complete_set: dict = {
        "status": "complete",
        "completed_at": now,
        "delivery_validated": delivery_result["success"],
    }
    if invoice_id:
        _complete_set["inv_num"] = invoice_name or ""
        _complete_set["invoice_id"] = invoice_id
        # Clear any stale error from a previous failed attempt (e.g. this
        # order already went through the retry-invoice-creation endpoint).
        _complete_set["invoice_creation_error"] = None
        _complete_set["invoice_creation_failed_at"] = None
    else:
        # Persisted (2026-08-27), not just returned as a one-off response
        # warning — the create_invoices() TypeError incident showed a
        # transient toast was the only trace of this failure, leaving an
        # order stuck at "complete" with no invoice and no visible reason
        # why. Surfaced on the ticket detail page with a Retry Invoice
        # Creation action, same non-blocking-failure convention as
        # packing_board_queue_error elsewhere in this codebase.
        _complete_set["invoice_creation_error"] = invoice_warning
        _complete_set["invoice_creation_failed_at"] = now

    # Targets the exact same document resolved at the top of this function via
    # entry["_id"] — previously hardcoded to {"order_id": ..., "is_backorder":
    # {"$ne": True}} regardless of which entry was actually being completed,
    # which meant completing a backorder's own delivery here would have
    # silently tried to re-complete the primary entry instead (2026-08-23 fix).
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": _complete_set},
        return_document=True,
    )
    if updated:
        updated.pop("_id", None)
        await push_update(updated)
    await audit_log("packing.complete", "packing_board", body.order_id, entity_label=body.order_id, user=current_user)
    await audit_log(
        "packing.delivery_validated",
        "packing_board",
        body.order_id,
        entity_label=body.order_id,
        user=current_user,
        detail=delivery_result,
    )
    _routing = await get_email_routing()

    if is_partial:
        # ── Partial: notify reseller of first delivery + backorder creation ──
        _shipped_items = [
            {"name": i["name"], "qty": i.get("qty_reserved", i.get("qty", 0))}
            for i in entry.get("items", [])
            if not i.get("is_backordered")
        ]
        _backorder_items = [
            {"name": i["name"], "qty": round(i.get("qty_ordered", i.get("qty", 0)) - i.get("qty_reserved", 0), 4)}
            for i in entry.get("items", [])
            if i.get("is_backordered")
        ]
        # 8.69 — the customer/reseller "ready" notices (and the Sales ticket's
        # status) go through hold_or_notify_after_complete: sent now if
        # nothing is owing, otherwise held until the invoice is paid.
        hold_fields = await hold_or_notify_after_complete(
            {**entry, **_complete_set},
            {"kind": "partial", "shipped_lines": _shipped_items, "backorder_lines": _backorder_items},
            background_tasks, current_user,
        )
        if _routing.get("order_to"):
            background_tasks.add_task(
                send_backorder_created_internal,
                to=_routing["order_to"],
                order_ref=str(entry.get("order_id", body.order_id)),
                customer_name=entry.get("customer_name", ""),
                backorder_ref=backorder_picking_name or "",
                backorder_lines=_backorder_items,
            )
    else:
        # ── Full delivery: notify supervisors + reseller for collection ────────
        _sups = await col("users").find(
            {"role": "warehouse_supervisor", "email": {"$exists": True, "$ne": ""}},
            {"email": 1, "_id": 0},
        ).to_list(50)
        _sup_emails = [u["email"] for u in _sups if u.get("email")]
        for _extra in _routing.get("order_ready_extra_to", []):
            if _extra and _extra not in _sup_emails:
                _sup_emails.append(_extra)
        if _sup_emails:
            background_tasks.add_task(
                send_order_ready_for_collection,
                order_ref=str((updated or entry).get("order_id", body.order_id)),
                customer_name=(updated or entry).get("customer_name", ""),
                packer_name=(updated or entry).get("assigned_packer", "") or (updated or entry).get("packer_name", ""),
                supervisor_emails=_sup_emails,
            )
        hold_fields = await hold_or_notify_after_complete(
            {**entry, **_complete_set}, {"kind": "full"}, background_tasks, current_user,
        )

    if hold_fields:
        refreshed = await col("packing_board").find_one({"_id": entry["_id"]})
        if refreshed:
            refreshed.pop("_id", None)
            await push_update(_with_age(refreshed))

    response: dict = {
        "success": True,
        "delivery_validated": delivery_result["success"],
        "invoice_id": invoice_id,
        "invoice_name": invoice_name,
        "payment_hold": bool(hold_fields.get("payment_hold")),
        "payment_hold_amount": hold_fields.get("payment_hold_amount"),
    }
    if is_partial:
        response["is_partial"] = True
        response["backorder_entry_id"] = backorder_entry_id
    warnings: list = []
    if not delivery_result["success"]:
        # invoice_warning already restates this same delivery error (see
        # above) when delivery validation is what blocked invoicing, so only
        # one of the two is shown rather than the same root cause twice.
        warnings.append(
            delivery_result.get("error")
            or "Delivery could not be validated in Odoo. Stock levels may not reflect this completion."
        )
    elif invoice_warning:
        warnings.append(invoice_warning)
    if warnings:
        response["warning"] = " | ".join(warnings)
    return response


@router.put("/retry-invoice-creation")
async def retry_invoice_creation(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_any_permission("tickets.orders", "tickets.finance_confirm")),
):
    """Recovery action (2026-08-27) for an order that reached packing status
    "complete" (or later) with no final invoice ever created — most
    commonly a transient Odoo-side failure at Mark Complete time (see
    _create_final_invoice's own history for the create_invoices() TypeError
    incident that prompted this). Re-runs the exact same invoice-creation
    logic complete_entry itself uses. Refuses to run at all once an invoice
    already exists on this entry, so this can never create a duplicate —
    unlike complete_entry, a failure here IS the whole point of the call,
    so it raises rather than degrading to a response `warning`. Gated to
    `tickets.orders` OR `tickets.finance_confirm` (2026-08-27, widened from
    `tickets.orders` alone once this action was also surfaced on Order
    Passport) — Finance is the role most likely to actually discover this
    failure, via a blank Register Balance Payment amount."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry.get("status") not in ("complete", "collected"):
        raise HTTPException(status_code=400, detail="Order must be complete before an invoice can be created")
    if entry.get("invoice_id"):
        raise HTTPException(
            status_code=400,
            detail=f"An invoice already exists for this order ({entry.get('inv_num') or entry['invoice_id']}) — nothing to retry",
        )

    now = datetime.now(timezone.utc)

    # Re-validate the Odoo delivery first if it never actually succeeded
    # (2026-09-08, found live via Sentry #143212165) — this endpoint used to
    # go straight to invoice creation, which meant an order that reached
    # "complete" with an unvalidated delivery (delivery_validated: False)
    # reproduced the exact same "no items available to invoice" Odoo fault
    # on every single retry, forever, since nothing had ever re-attempted the
    # delivery itself. Confirmed with Tristan: the portal must validate
    # deliveries automatically — there is no manual Odoo step in this
    # pipeline, so "retry" has to mean retry the whole chain, not just the
    # invoice half of it. Skipped once delivery_validated is already true —
    # no reason to re-touch Odoo's stock moves for an already-done delivery.
    if not entry.get("delivery_validated"):
        _packing_items = entry.get("items", [])
        _qty_overrides = {
            i["product_id"]: float(i["qty_packed"])
            for i in _packing_items
            if i.get("product_id") and i.get("qty_packed") is not None
        } or None
        try:
            _delivery_result = _validate_odoo_delivery(int(entry["order_id"]), _qty_overrides,
                                                       cancel_backorder=await _drop_rest_chosen(entry))
        except (ValueError, TypeError) as e:
            _delivery_result = {"success": False, "error": f"Invalid order ID: {e}"}
        except Exception as e:
            _delivery_result = {"success": False, "error": str(e)}

        await audit_log(
            "packing.retry_delivery_validation", "packing_board", body.order_id,
            entity_label=body.order_id, user=current_user, detail=_delivery_result,
        )

        if not _delivery_result.get("success"):
            _fail_set = {
                "delivery_validated": False,
                "invoice_creation_error": (
                    "Delivery could not be validated in Odoo, so no invoice was created: "
                    f"{_delivery_result.get('error') or 'unknown error'}"
                ),
                "invoice_creation_failed_at": now,
            }
            _updated = await col("packing_board").find_one_and_update(
                {"_id": entry["_id"]}, {"$set": _fail_set}, return_document=True,
            )
            if _updated:
                _updated.pop("_id", None)
                await push_update(_updated)
            raise HTTPException(status_code=502, detail=_fail_set["invoice_creation_error"])

        entry["delivery_validated"] = True

    result = await _create_final_invoice(entry, now, background_tasks)
    invoice_id = result["invoice_id"]

    update_set: dict = {"delivery_validated": True}
    if invoice_id:
        update_set["inv_num"] = result["invoice_name"] or ""
        update_set["invoice_id"] = invoice_id
        update_set["invoice_creation_error"] = None
        update_set["invoice_creation_failed_at"] = None
    else:
        update_set["invoice_creation_error"] = result["invoice_warning"]
        update_set["invoice_creation_failed_at"] = now

    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]}, {"$set": update_set}, return_document=True,
    )
    if updated:
        updated.pop("_id", None)
        await push_update(updated)
    await audit_log(
        "packing.retry_invoice_creation", "packing_board", body.order_id,
        entity_label=body.order_id, user=current_user,
        detail={"success": bool(invoice_id), "invoice_id": invoice_id},
    )

    if not invoice_id:
        raise HTTPException(status_code=502, detail=result["invoice_warning"] or "Invoice creation failed")
    # 8.69 — a held order's invoice now exists; if it's already settled (a
    # 100% deposit leaves a R0 final invoice) the customer can be told now.
    if entry.get("payment_hold"):
        if entry.get("payment_hold_amount") is None:
            _inv = _read_invoice_payment(get_odoo_client(), invoice_id)
            if _inv:
                await col("packing_board").update_one(
                    {"_id": entry["_id"]},
                    {"$set": {"payment_hold_amount": float(_inv.get("amount_residual") or 0),
                              "payment_hold_invoice_name": _inv.get("name")}},
                )
        await release_collection_holds(order_id=body.order_id, background_tasks=background_tasks)
    return {"success": True, "invoice_id": invoice_id, "invoice_name": result["invoice_name"], "warning": result["invoice_warning"]}


# ── Admin Override reconciliation wizard (2026-08-28) ─────────────────────────
# Found live: update_ticket_stage (ticket_routes.py's Admin Override "Stage"
# action) special-cases only a move to confirmed_wip (retry-queue an existing
# packing board failure) — every other target status, including
# ready_for_collection, is a blind `ticket.status = body.status` write with
# no packing_board entry, no QA/RP sign-off, and no final invoice ever
# created. A ticket overridden straight to ready_for_collection can end up
# claiming a pipeline it never actually ran through in the portal, even when
# (as confirmed with the product owner, 2026-08-28) the real physical work —
# packing, QA/RP inspection, sometimes collection — genuinely happened, just
# outside the portal's own buttons.
#
# The fix is NOT to silently backfill fake history — that would corrupt an
# Annex-11-relevant audit trail (QA/RP sign-off is a real compliance record,
# not just a UI checkbox; see CLAUDE.md's Phase 13 compliance notes). Instead
# this is a genuine retrospective attestation: each step below can only be
# confirmed by someone holding that step's REAL permission (an admin who
# overrode the ticket cannot also rubber-stamp "QA approved" — only
# tickets.qa_approve can), each write is clearly marked retrospective, and
# the real actor/timestamp of the *attestation* (not a guessed original time)
# is recorded. get_ticket's `override_gaps` field (ticket_routes.py) drives
# which of these four steps SalesTickets.js's reconciliation modal shows —
# always a contiguous sequence (packing -> QA -> RP -> invoice), so a step
# can never be attempted before the one before it is genuinely resolved.

async def _retroactive_gate(order_id: str) -> dict:
    """Shared 404 for every step below — every retroactive action operates on
    an already-existing packing_board entry except confirm-packing itself."""
    entry = await col("packing_board").find_one({"order_id": order_id})
    if not entry:
        raise HTTPException(status_code=400, detail="No packing entry exists yet for this order — confirm packing first")
    return entry


@router.post("/retroactive/confirm-packing")
async def retroactive_confirm_packing(
    body: RetroactivePackingBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Reconciliation step 1 — backfills a real packing_board entry for an
    order whose Sales ticket claims further progress than any entry exists
    to back. Reuses order_routes.py's _queue_packing_board() for correctness
    (real line items/warehouse/picking data read fresh from Odoo, identical
    to the normal creation path) rather than hand-rolling a second doc-
    builder — but that function unconditionally regresses the linked
    ticket's status to "confirmed_wip" for its own normal callers, which is
    exactly wrong here: the ticket is deliberately already further along
    and preserving that claim (now that it's about to be genuinely backed)
    is the whole point, not undoing it. The ticket's real status is restored
    immediately after. The fresh entry is then advanced from "queued" to
    "ready" (packing already physically happened, per this attestation) with
    a `retrospective: True` marker — it can never silently read as having
    gone through a real live queued->packing->ready run."""
    try:
        order_id_int = int(body.order_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid order ID")
    ticket = await col("tickets").find_one({"type": "sales", "order_id": order_id_int, "exit_status": None})
    if not ticket:
        raise HTTPException(status_code=404, detail="No Sales ticket found for this order")
    if await col("packing_board").find_one({"order_id": body.order_id}):
        raise HTTPException(status_code=400, detail="A packing entry already exists for this order")

    from routes.order_routes import _queue_packing_board  # deferred import, same defensive pattern order_routes.py itself already uses for packing_board_routes.manager
    _orig_status = ticket["status"]
    try:
        await _queue_packing_board(order_id_int, background_tasks)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not create the packing entry: {str(e)}")

    now = datetime.now(timezone.utc)
    await col("packing_board").update_one(
        {"order_id": body.order_id},
        {"$set": {
            "status": "ready", "packer_name": body.packer_name or None,
            "packed_at": now, "ready_at": now, "retrospective": True,
        }},
    )
    # Restore the ticket's real status — see the function docstring above for why.
    await col("tickets").update_one(
        {"_id": ticket["_id"]},
        {
            "$set": {"status": _orig_status, "updated_at": now},
            "$push": {"stage_history": {
                "status": _orig_status, "exit_status": None,
                "actor_id": current_user["id"], "actor_name": current_user.get("name") or current_user.get("username", ""),
                "at": now, "note": "Reconciliation: packing entry backfilled retrospectively (confirmed already packed)",
            }},
        },
    )
    await audit_log(
        "ticket.retroactive_confirm_packing", "ticket", str(ticket["_id"]),
        entity_label=ticket.get("customer_name", ""), user=current_user,
    )
    updated = await col("packing_board").find_one({"order_id": body.order_id})
    if updated:
        updated.pop("_id", None)
        await push_update(updated)
    return {"success": True}


@router.post("/retroactive/confirm-qa")
async def retroactive_confirm_qa(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.qa_approve")),
):
    """Reconciliation step 2 — gated by the REAL QA permission, not the
    admin who overrode the ticket, so this can never become a second way
    for one person to skip a compliance sign-off. Same idea as the normal
    QA approve action, just marked retrospective and reachable without the
    entry having gone through a live packing run first."""
    entry = await _retroactive_gate(body.order_id)
    if entry.get("qa_approved_at"):
        raise HTTPException(status_code=400, detail="QA has already signed off on this order")
    now = datetime.now(timezone.utc)
    await col("packing_board").update_one(
        {"_id": entry["_id"]},
        {"$set": {"qa_approved_by": current_user.get("name") or current_user.get("username", ""), "qa_approved_at": now, "qa_retrospective": True}},
    )
    await audit_log(
        "packing.retroactive_confirm_qa", "packing_board", body.order_id,
        entity_label=entry.get("customer_name", ""), user=current_user,
    )
    updated = await col("packing_board").find_one({"_id": entry["_id"]})
    if updated:
        updated.pop("_id", None)
        await push_update(updated)
    return {"success": True}


@router.post("/retroactive/confirm-rp")
async def retroactive_confirm_rp(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.rp_approve")),
):
    """Reconciliation step 3 — mirrors retroactive_confirm_qa exactly, gated
    on the real RP permission."""
    entry = await _retroactive_gate(body.order_id)
    if entry.get("rp_approved_at"):
        raise HTTPException(status_code=400, detail="RP has already signed off on this order")
    now = datetime.now(timezone.utc)
    await col("packing_board").update_one(
        {"_id": entry["_id"]},
        {"$set": {"rp_approved_by": current_user.get("name") or current_user.get("username", ""), "rp_approved_at": now, "rp_retrospective": True}},
    )
    await audit_log(
        "packing.retroactive_confirm_rp", "packing_board", body.order_id,
        entity_label=entry.get("customer_name", ""), user=current_user,
    )
    updated = await col("packing_board").find_one({"_id": entry["_id"]})
    if updated:
        updated.pop("_id", None)
        await push_update(updated)
    return {"success": True}


@router.post("/retroactive/confirm-invoice")
async def retroactive_confirm_invoice(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.finance_confirm")),
):
    """Reconciliation step 4 — the direct fix for the original complaint
    (a real, already-existing Odoo invoice for this order that the ticket
    had no way to link, since the existing "Link" button on an untracked
    invoice is deliberately restricted to already-paid invoices — correct
    for its own deposit-linking use case, wrong here). Reuses
    _create_final_invoice() exactly as complete_entry/retry_invoice_creation
    do — it already checks for a real, existing, not-yet-linked invoice on
    the order before creating a new one, so this both fixes the linking gap
    and never risks a duplicate invoice. Requires QA and RP already
    confirmed — the same sequencing complete_entry itself enforces (an
    Orders Clerk cannot Mark Complete before both have signed off), applied
    here too rather than let this step be reachable out of order."""
    entry = await _retroactive_gate(body.order_id)
    if not entry.get("qa_approved_at") or not entry.get("rp_approved_at"):
        raise HTTPException(status_code=400, detail="QA and RP sign-off must both be confirmed before the final invoice")
    if entry.get("invoice_id"):
        raise HTTPException(status_code=400, detail="An invoice is already linked to this order")

    now = datetime.now(timezone.utc)
    result = await _create_final_invoice(entry, now, background_tasks)
    if not result.get("invoice_id"):
        raise HTTPException(status_code=502, detail=result.get("invoice_warning") or "Could not create or link the final invoice")

    await col("packing_board").update_one(
        {"_id": entry["_id"]},
        {"$set": {
            "inv_num": result.get("invoice_name") or "",
            "invoice_id": result["invoice_id"],
            "status": "complete", "completed_at": now,
            "invoice_creation_error": None, "invoice_creation_failed_at": None,
            "invoice_retrospective": True,
        }},
    )
    await audit_log(
        "packing.retroactive_confirm_invoice", "packing_board", body.order_id,
        entity_label=entry.get("customer_name", ""), user=current_user,
        detail={"invoice_id": result["invoice_id"]},
    )
    updated = await col("packing_board").find_one({"_id": entry["_id"]})
    if updated:
        updated.pop("_id", None)
        await push_update(updated)
    return {"success": True, "invoice_id": result["invoice_id"], "invoice_name": result.get("invoice_name")}


@router.put("/mark-collected")
async def mark_collected(
    body: MarkCollectedBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk confirms customer has collected a delivery (primary or backorder).
    Creates the Odoo invoice for the delivered qty, then checks whether all pickings
    for this order are now collected — if so, advances the ticket to complete."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Packing entry not found")
    if entry.get("collected_at"):
        raise HTTPException(status_code=400, detail="This delivery has already been marked as collected")
    if entry.get("status") != "complete":
        raise HTTPException(status_code=400, detail="Delivery must be complete before it can be marked as collected")

    # 8.69 — goods never leave unpaid. A deposit or pay-before-collection
    # order needs its final invoice paid in Odoo first, checked live here
    # whatever the entry's hold flag says (covers orders completed before
    # 8.69, and any Admin Override). On account and sample orders are exempt.
    ticket = await _linked_sales_ticket(body.order_id)
    if payment_required_before_collection(ticket):
        if not entry.get("invoice_id"):
            raise HTTPException(
                status_code=400,
                detail="No invoice has been raised for this delivery yet, so payment can't be confirmed. "
                       "Retry invoice creation first.",
            )
        inv = _read_invoice_payment(get_odoo_client(), entry["invoice_id"])
        if inv is None:
            raise HTTPException(status_code=502, detail="Could not check the invoice's payment in Odoo. Try again shortly.")
        if not _invoice_is_paid(inv):
            raise HTTPException(
                status_code=400,
                detail=(f"Invoice {inv.get('name')} still has R{float(inv.get('amount_residual') or 0):,.2f} "
                        "outstanding. The customer can't collect until Finance records the payment."),
            )
        if entry.get("payment_hold") and not entry.get("collection_released_at"):
            # Paid, but the release hasn't run yet (e.g. paid in Odoo moments
            # ago): release it now so the notice and status are consistent.
            await release_collection_holds(order_id=body.order_id, background_tasks=background_tasks)

    now = datetime.now(timezone.utc)
    actor_name = current_user.get("name") or current_user.get("username", "")

    # ── Mark entry collected ──────────────────────────────────────────────────
    # Invoice was already created at mark_complete (after QA + RP sign-off).
    update_fields: dict = {"collected_at": now, "collected_by": actor_name, "status": "collected"}

    await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": update_fields})
    await audit_log(
        "packing.collected",
        "packing_board",
        body.order_id,
        entity_label=body.order_id,
        user=current_user,
        detail={"picking_id": entry.get("odoo_picking_id")},
    )

    # ── Check if all pickings for this order are now collected ────────────────
    all_entries = await col("packing_board").find({"order_id": body.order_id}).to_list(50)
    # Exclude waiting_stock backorders — they haven't started yet and don't count
    relevant = [e for e in all_entries if not e.get("waiting_stock")]
    all_collected = bool(relevant) and all(e.get("collected_at") is not None for e in relevant)
    if all_collected:
        await _sync_sales_ticket(body.order_id, "complete", actor=current_user)

    await broadcast_monitor_refresh()
    return {
        "success": True,
        "collected_at": now.isoformat(),
        "order_complete": all_collected,
    }


async def _refresh_entry_item_backorder_flags(odoo, entry: dict) -> Optional[list]:
    """Re-read live stock.move reservation for one packing_board entry's
    delivery and recompute each item's is_backordered/qty_reserved from
    scratch (2026-08-27). The flag _queue_packing_board originally computes
    is a one-time snapshot taken at deposit-registration time — if Odoo
    hadn't finished reserving stock against the delivery at that exact
    moment, every line gets flagged, and nothing ever re-checks it
    afterward even once reservation catches up. Found live: every item on
    an order showed the yellow "Backorder" label while the Backorders page
    (which only tracks genuine Odoo-created backorder pickings, a
    completely different signal) correctly showed none.

    Never raises — returns the corrected items list only when something
    actually changed, or None on any failure/no-op, so callers can treat
    this as pure best-effort and skip the write entirely when there's
    nothing to do."""
    picking_id = entry.get("odoo_picking_id")
    if not picking_id:
        return None
    try:
        pick_rows = odoo.read("stock.picking", [picking_id], fields=["move_ids", "location_id"])
        if not pick_rows or not pick_rows[0].get("move_ids"):
            return None
        # 'quantity' not 'reserved_availability' — see the field-drift note
        # on this exact read elsewhere in this file (_validate_odoo_delivery)
        # and in order_routes.py's _queue_packing_board, which this mirrors.
        moves = odoo.read(
            "stock.move", pick_rows[0]["move_ids"],
            fields=["product_id", "product_uom_qty", "quantity"],
        )
    except Exception:
        return None

    by_product = {m["product_id"][0]: m for m in moves if m.get("product_id")}

    # 8.70f — "not reserved" is not the same as "short". Read free stock at
    # the delivery's own location for the unreserved products so the Order
    # Ticket can say "In stock, not reserved yet" (Check Availability fixes
    # it) vs "Short: waiting on stock" (needs stock from GMP/a supplier).
    free_by_product: dict = {}
    unreserved = [pid for pid, m in by_product.items()
                  if float(m.get("quantity", 0)) < float(m.get("product_uom_qty", 0))]
    loc = pick_rows[0].get("location_id")
    if unreserved and isinstance(loc, list):
        try:
            for r in odoo.read("product.product", unreserved, fields=["free_qty"], context={"location": loc[0]}):
                free_by_product[r["id"]] = float(r.get("free_qty") or 0)
        except Exception:
            free_by_product = {}

    items = entry.get("items", [])
    changed = False
    for item in items:
        move = by_product.get(item.get("product_id"))
        if not move:
            continue
        qty_ordered  = float(move.get("product_uom_qty", 0))
        qty_reserved = float(move.get("quantity", 0))
        new_flag = qty_reserved < qty_ordered
        if not new_flag:
            status = "reserved"
        elif free_by_product.get(item.get("product_id"), 0) >= qty_ordered - qty_reserved - 0.0001:
            status = "available"
        else:
            status = "short"
        if (item.get("qty_reserved") != qty_reserved or item.get("is_backordered") != new_flag
                or item.get("stock_status") != status):
            item["qty_reserved"] = qty_reserved
            item["is_backordered"] = new_flag
            item["stock_status"] = status
            changed = True
    return items if changed else None


async def _refresh_active_item_backorder_flags() -> dict:
    """Bulk companion to _check_and_notify_backorder_stock below (2026-08-27)
    — that function re-checks whole BACKORDER CHILD entries (is_backorder
    True, waiting_stock True); this one re-checks the per-line
    is_backordered flags on regular, still-active entries (queued/packing)
    that were snapshotted stale at deposit-registration time. Deliberately
    reuses the exact same event-driven trigger points (the manual "Check
    backorder stock" button, and Manufacturing Order record-production/
    complete) rather than adding a new poll or a live check on every page
    read — production/stock events advancing is exactly when a recheck is
    worth paying for; a live check on every Order Ticket view would not be,
    at real production volume."""
    entries = await col("packing_board").find(
        {"status": {"$in": ["queued", "packing"]}, "items.is_backordered": True}
    ).to_list(200)
    if not entries:
        return {"checked": 0, "updated": 0}

    odoo = get_odoo_client()
    updated = 0
    for entry in entries:
        new_items = await _refresh_entry_item_backorder_flags(odoo, entry)
        if new_items is None:
            continue
        await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": {"items": new_items}})
        updated += 1
        entry["items"] = new_items
        entry.pop("_id", None)
        await push_update(entry)
    return {"checked": len(entries), "updated": updated}


async def _check_and_notify_backorder_stock(background_tasks: BackgroundTasks, actor: Optional[dict] = None) -> dict:
    """Check all waiting_stock backorder entries against Odoo. When a backorder picking
    has moved to 'assigned' (stock reserved), clears the waiting flag, moves the
    entry back into the active pipeline, and fires notifications to the
    reseller, internal staff, and the assigned sales rep.

    Shared by the manual "Check backorder stock" button (check_backorder_stock
    below, actor=current_user so the audit trail attributes the clerk who
    triggered it) and, since 2026-08-22, automatically called from
    order_routes.py's Manufacturing Order Record Production / Mark Complete
    endpoints (actor=whoever updated the MO) — production finishing or
    advancing is exactly the kind of event that should prompt a reservation
    recheck, not just wait for someone to click the manual button.
    Deliberately not scoped to the specific product an MO just produced: this
    sweep is already cheap and bounded (≤200 waiting_stock entries), so
    reusing the same blanket check avoids the real complexity of correlating
    an MO's product back to which backorder line(s) it might unblock.

    **2026-08-23 fix:** this used to only clear the `waiting_stock` boolean —
    the notifications fired correctly, but the entry's own `status` field
    stayed `"waiting_stock"` forever, so it never actually reappeared in the
    Queued column or anywhere staff would naturally look for active work.
    The only way to progress it was a generic admin-only status override.
    Now explicitly re-queues it (`status: "queued"`, fresh `queued_at` so its
    age on the monitor starts counting from when it actually became
    actionable, not from whenever the original shortfall was discovered) —
    the same entry point a brand-new packing_board entry starts at
    (`POST /queue`), so every existing queued→packing→ready→QA→RP→complete
    action already works on it with no special-casing needed."""
    entries = await col("packing_board").find(
        {"is_backorder": True, "waiting_stock": True}
    ).to_list(200)

    if not entries:
        return {"checked": 0, "ready": 0, "updated": []}

    odoo = get_odoo_client()
    _routing = await get_email_routing()
    updated_refs: list = []

    for bo_entry in entries:
        picking_id = bo_entry.get("odoo_picking_id")
        if not picking_id:
            continue
        try:
            pick_rows = odoo.read("stock.picking", [picking_id], fields=["id", "state"])
        except Exception:
            continue
        if not pick_rows or pick_rows[0]["state"] != "assigned":
            continue

        now = datetime.now(timezone.utc)
        await col("packing_board").update_one(
            {"_id": bo_entry["_id"]},
            {"$set": {"waiting_stock": False, "status": "queued", "queued_at": now}},
        )

        order_ref = str(bo_entry.get("order_id", ""))
        customer_name = bo_entry.get("customer_name", "")
        await audit_log("packing.backorder_stock_ready", "packing_board", order_ref,
                         entity_label=customer_name, user=actor,
                         detail={"picking_id": picking_id, "picking_name": bo_entry.get("picking_name")})
        await broadcast_monitor_refresh()
        reseller_email: Optional[str] = None
        reseller_name: Optional[str] = None
        if bo_entry.get("reseller_id"):
            _res = await col("resellers").find_one(
                {"id": bo_entry["reseller_id"]}, {"email": 1, "name": 1, "_id": 0}
            )
            if _res:
                reseller_email = _res.get("email")
                reseller_name = _res.get("name")

        _bo_items = [
            {"name": i["name"], "qty": i.get("qty_ordered", i.get("qty", 0))}
            for i in bo_entry.get("items", [])
        ]

        background_tasks.add_task(
            send_backorder_stock_ready,
            reseller_email=reseller_email,
            internal_to=_routing.get("order_to"),
            order_ref=order_ref,
            customer_name=customer_name,
            reseller_name=reseller_name or "",
            backorder_lines=_bo_items,
        )

        # Push notification to whoever owns the Sales ticket (2026-08-22) —
        # reuses notify_ticket_handoff's existing "a ticket I own changed
        # stage" semantics rather than inventing a new preference key nobody
        # can configure yet (no notification-preferences UI exists in the
        # frontend today). order_id on a backorder entry is the same
        # str(sale_order_id) the primary entry it split from carries.
        try:
            _bo_ticket = await col("tickets").find_one(
                {"type": "sales", "order_id": int(bo_entry["order_id"]), "exit_status": None},
                {"assigned_to": 1, "_id": 0},
            )
            if _bo_ticket and _bo_ticket.get("assigned_to"):
                background_tasks.add_task(
                    notify_ticket_handoff,
                    customer_name=customer_name,
                    outcome="stock now available for packing",
                    assigned_user_id=_bo_ticket["assigned_to"],
                )
        except (ValueError, TypeError):
            pass  # order_id wasn't a plain int string — non-fatal, email notice above already fired

        updated_refs.append(order_ref)

    return {"checked": len(entries), "ready": len(updated_refs), "updated": updated_refs}


@router.get("/backorders/check-stock")
async def check_backorder_stock(
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    result = await _check_and_notify_backorder_stock(background_tasks, actor=current_user)
    item_result = await _refresh_active_item_backorder_flags()
    result["items_updated"] = item_result["updated"]
    return result


@router.put("/incomplete")
async def mark_incomplete(
    body: IncompleteBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk flags a partial/blocked order — always requires a reason
    so Sales has something concrete to relay to the client."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] in ("collected", "cleared", "cancelled", "complete", "incomplete"):
        raise HTTPException(status_code=400, detail=f"Order is already '{entry['status']}'")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"status": "incomplete", "incomplete_at": now, "incomplete_reason": body.reason}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.incomplete", "packing_board", body.order_id, entity_label=body.order_id,
                    user=current_user, detail={"reason": body.reason})
    await _sync_sales_ticket(body.order_id, "incomplete", body.reason, actor=current_user)
    return {"success": True}


@router.put("/cancel")
async def cancel_entry(
    body: CancelBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk cancels an order before fulfilment completes."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] in ("collected", "cleared", "cancelled", "complete", "incomplete"):
        raise HTTPException(status_code=400, detail=f"Order is already '{entry['status']}'")

    now = datetime.now(timezone.utc)
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"status": "cancelled", "cancelled_at": now, "incomplete_reason": body.reason}},
        return_document=True,
    )
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.cancelled", "packing_board", body.order_id, entity_label=body.order_id,
                    user=current_user, detail={"reason": body.reason})
    await _sync_sales_ticket(body.order_id, "cancelled", body.reason, actor=current_user)
    return {"success": True}


async def _find_orphaned_packing_boards(limit: int = 500) -> list:
    """
    The read-only half of the reconcile action (2026-09-07) — separated from
    the write so the frontend can show a real preview before anyone commits,
    matching this codebase's zero-window.confirm convention (every other
    mutating admin action, e.g. Purge Test Data / Cancel Quote, lists exactly
    what will change in a Modal before the user confirms; a bare "click and
    it's done" button was a real gap here, flagged by the product owner).

    Bounded scan (default 500) over every currently-active packing_board
    entry. For each, checks whether ANY sales ticket exists for its order_id
    (not just an open one) and returns the ones whose only matching ticket is
    already exited (cancelled/not_interested/complete) — these are the
    orphans _reconcile_cancelled_ticket_boards would cancel. Deliberately
    excludes an entry with no ticket at all — a packing_board entry can
    legitimately predate ticket-linking on old data, and that's a different,
    pre-existing case this sweep has no business guessing about.

    Returns one dict per orphan with enough context to review in a modal:
    order_id, ps_num, customer_name, status, queued_at, ticket_exit_status.
    """
    active = await col("packing_board").find(
        {"status": {"$nin": ["collected", "cleared", "cancelled", "complete", "incomplete"]}},
        {"order_id": 1, "status": 1, "ps_num": 1, "customer_name": 1, "queued_at": 1, "is_backorder": 1},
    ).to_list(length=limit)

    order_ids: set = set()
    for e in active:
        try:
            order_ids.add(int(e["order_id"]))
        except (KeyError, ValueError, TypeError):
            pass

    ticket_exit_by_order: dict = {}
    if order_ids:
        async for t in col("tickets").find(
            {"type": "sales", "order_id": {"$in": list(order_ids)}},
            {"order_id": 1, "exit_status": 1},
        ):
            # If more than one ticket ever referenced the same order (shouldn't
            # normally happen), an open one (exit_status None) always wins —
            # never treat the entry as orphaned while any ticket still claims it.
            existing = ticket_exit_by_order.get(t["order_id"], "__unset__")
            if existing in ("__unset__",) or (existing and not t.get("exit_status")):
                ticket_exit_by_order[t["order_id"]] = t.get("exit_status")

    orphans: list = []
    for e in active:
        try:
            oid_int = int(e["order_id"])
        except (KeyError, ValueError, TypeError):
            continue
        exit_status = ticket_exit_by_order.get(oid_int, "__unset__")
        if exit_status in ("__unset__", None):
            continue  # no ticket found, or its ticket is still open — not orphaned
        orphans.append({
            "packing_board_id": str(e["_id"]),
            "order_id": oid_int,
            "ps_num": e.get("ps_num"),
            "customer_name": e.get("customer_name"),
            "status": e.get("status"),
            "is_backorder": bool(e.get("is_backorder")),
            "queued_at": e.get("queued_at"),
            "ticket_exit_status": exit_status,
        })
    return orphans


async def _reconcile_cancelled_ticket_boards(limit: int = 500, actor: Optional[dict] = None) -> dict:
    """
    Data-fix sweep for the pre-2026-09-07 one-way sync gap (ticket cancelled
    -> packing_board entry never followed) — see ticket_routes.py's
    _cancel_linked_packing_board for the forward-fix this backfills.
    That fix only prevents NEW occurrences: it lives inside the
    ticket-cancellation code paths themselves, so a ticket that was already
    cancelled before the fix shipped has no trigger left to re-run — its
    stage_history entry already happened, and get_ticket's own auto-sync is
    guarded by `not ticket.get("exit_status")`, so simply reopening an
    already-closed ticket in the portal does nothing.

    Cancels every orphan _find_orphaned_packing_boards() identifies, the same
    way _cancel_linked_packing_board / cancel_entry do. Idempotent: an entry
    this sweep just cancelled will never match the active-status query again,
    so running it twice in a row (e.g. confirming the preview modal twice)
    is a safe no-op the second time — the find_one_and_update's own status
    filter re-checks this at write time too, not just at scan time, in case
    an entry changed state in the gap between preview and confirm.
    """
    now = datetime.now(timezone.utc)
    orphans = await _find_orphaned_packing_boards(limit=limit)

    fixed: list = []
    for o in orphans:
        updated = await col("packing_board").find_one_and_update(
            {"_id": ObjectId(o["packing_board_id"]), "status": {"$nin": ["collected", "cleared", "cancelled", "complete", "incomplete"]}},
            {"$set": {
                "status": "cancelled",
                "cancelled_at": now,
                "incomplete_reason": f"Linked Sales ticket was already '{o['ticket_exit_status']}' (reconciled)",
            }},
            return_document=True,
        )
        if not updated:
            continue
        updated.pop("_id", None)
        await push_update(updated)
        await audit_log(
            "packing.cancelled", "packing_board", str(o["order_id"]), entity_label=str(o["order_id"]),
            user=actor, detail={"reason": "reconcile_cancelled_ticket", "ticket_exit_status": o["ticket_exit_status"]},
        )
        fixed.append(o["order_id"])

    if fixed:
        await broadcast_monitor_refresh()
    return {"scanned": len(orphans), "fixed_order_ids": fixed}


@router.get("/reconcile-cancelled/preview")
async def preview_reconcile_cancelled_packing_boards(
    current_user: dict = Depends(require_permission("tickets.manage")),
):
    """
    Read-only preview for the Reconcile Cancelled action — returns exactly
    what POST /reconcile-cancelled would cancel, with no side effects, so the
    frontend can show it in a confirm Modal before anyone commits (this
    codebase's standard pattern for every other mutating admin action).
    """
    orphans = await _find_orphaned_packing_boards()
    return {"orphans": orphans}


@router.post("/reconcile-cancelled")
async def reconcile_cancelled_packing_boards(
    current_user: dict = Depends(require_permission("tickets.manage")),
):
    """
    Admin data-fix action: cancels any packing_board entry still sitting
    active whose linked Sales ticket already exited before the
    ticket-cancel -> packing-board sync existed (2026-09-07). Safe to run
    more than once — see _reconcile_cancelled_ticket_boards's own docstring.
    The frontend always calls GET .../preview first and shows the exact list
    in a confirm Modal — this endpoint itself performs no confirmation of its
    own, so it must never be wired to a bare button click.
    Exposed as a button rather than a one-off script so this stays a normal,
    audited portal action (Architecture Principle #7) rather than requiring
    direct database access, and so the same fix is available on demand if
    this class of drift is ever discovered again.
    """
    result = await _reconcile_cancelled_ticket_boards(actor=current_user)
    return {"success": True, **result}


@router.get("/entry/{order_id}")
async def get_entry(order_id: str, picking_id: Optional[int] = None, current_user: dict = Depends(get_current_user)):
    if current_user.get("role") == "reseller":
        res_doc = await col("resellers").find_one({"user_id": current_user["id"]}, {"id": 1, "_id": 0})
        rid = res_doc["id"] if res_doc else None
        entry = await col("packing_board").find_one({**_entry_query(order_id, picking_id), "reseller_id": rid}, NO_ID)
        if not entry:
            raise HTTPException(status_code=403, detail="Access denied")
        return await _with_ticket_summary(_with_age(entry))
    # Staff: enforce board access
    if not (
        current_user.get("is_super_admin")
        or current_user.get("role") in ADMIN_ROLES
        or current_user.get("role") in _BOARD_VIEW_ROLES
    ):
        raise HTTPException(status_code=403, detail="Access denied")
    entry = await col("packing_board").find_one(_entry_query(order_id, picking_id), NO_ID)
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")
    # 8.69 — opening a held order re-checks payment, so a payment entered
    # straight in Odoo releases the notice without waiting for the poll.
    if entry.get("payment_hold") and not entry.get("collection_released_at"):
        if await release_collection_holds(order_id=order_id):
            entry = await col("packing_board").find_one(_entry_query(order_id, picking_id), NO_ID) or entry
    return _with_invoice_payment(await _with_ticket_summary(_with_picking_lots(_with_age(entry))))


@router.post("/adopt")
async def adopt_order(
    body: AdoptBody,
    current_user: dict = Depends(require_permission("tickets.manage")),
):
    """Adopt an existing confirmed Odoo order into the packing pipeline.
    Used by admins to bring pre-pipeline orders into the Orders Ticket flow
    without going through the full Sales Ticket quote/deposit process."""
    order_id_str = str(body.order_id)

    existing = await col("packing_board").find_one({"order_id": order_id_str})
    if existing:
        raise HTTPException(
            status_code=409,
            detail=f"Order is already in the pipeline (status: {existing['status']})",
        )

    odoo = get_odoo_client()
    try:
        rows = odoo.read(
            "sale.order", [body.order_id],
            fields=["name", "partner_id", "state", "warehouse_id", "picking_ids", "note", "invoice_ids"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    if not rows:
        raise HTTPException(status_code=404, detail="Order not found in Odoo")
    order_data = rows[0]

    _STATE_LABELS = {
        "draft": "a draft quotation", "sent": "a sent quotation",
        "done": "already completed", "cancel": "cancelled",
    }
    if order_data["state"] != "sale":
        label = _STATE_LABELS.get(order_data["state"], order_data["state"])
        raise HTTPException(
            status_code=400,
            detail=f"Cannot adopt: order is {label}. Only confirmed Sales Orders can be queued.",
        )

    # Invoice name (best-effort — may not exist for orders confirmed outside portal)
    inv_name = ""
    if order_data.get("invoice_ids"):
        try:
            inv_rows = odoo.read("account.move", [order_data["invoice_ids"][0]], fields=["name"])
            inv_name = inv_rows[0]["name"] if inv_rows else ""
        except Exception:
            pass

    # Items from the delivery order (picking), same as the confirm flow
    items: list = []
    dn_num = ""
    if order_data.get("picking_ids"):
        try:
            picking_id = order_data["picking_ids"][0]
            pickings = odoo.read("stock.picking", [picking_id], fields=["name", "move_ids"])
            picking = pickings[0] if pickings else None
            if picking:
                dn_num = picking["name"]
                if picking.get("move_ids"):
                    moves = odoo.read(
                        "stock.move", picking["move_ids"],
                        fields=["product_id", "product_uom_qty"],
                    )
                    for m in moves:
                        pname = m["product_id"][1] if m.get("product_id") else "Unknown"
                        prod = (
                            odoo.read("product.product", [m["product_id"][0]], fields=["default_code"])
                            if m.get("product_id") else []
                        )
                        sku = prod[0].get("default_code") or str(m["product_id"][0]) if prod else ""
                        items.append({"name": pname, "sku": sku, "product_id": m["product_id"][0] if m.get("product_id") else None, "qty": m["product_uom_qty"], "location": ""})
        except Exception as e:
            print(f"⚠️  adopt: could not read picking for order {body.order_id}: {e}")

    partner_name = order_data["partner_id"][1] if order_data.get("partner_id") else ""
    comm_data = await col("order_commissions").find_one({"odoo_order_id": order_id_str}, NO_ID)

    now = datetime.now(timezone.utc)
    doc = {
        "order_id":      order_id_str,
        "warehouse_id":  order_data["warehouse_id"][0] if order_data.get("warehouse_id") else None,
        "warehouse_name": order_data["warehouse_id"][1] if order_data.get("warehouse_id") else None,
        "customer_name": partner_name,
        "customer_city": "",
        "items":         items,
        "total_units":   int(sum(i["qty"] for i in items)),
        "inv_num":       inv_name,
        "dn_num":        dn_num,
        "ps_num":        order_data["name"],
        "notes":         order_data.get("note") or "",
        "is_reseller":   bool(comm_data),
        "reseller_name": comm_data.get("reseller_name") if comm_data else None,
        "packer_name":   None,
        "status":        "queued",
        "queued_at":     now,
        "packed_at":     None,
        "ready_at":      None,
        "collected_at":  None,
        "cancelled_at":  None,
        "incomplete_at": None,
        "completed_at":  None,
        "incomplete_reason": None,
        "qa_approved_by": None, "qa_approved_at": None,
        "rp_approved_by": None, "rp_approved_at": None,
        "item_ticks":    {i["sku"]: False for i in items},
    }
    await col("packing_board").replace_one({"order_id": order_id_str}, doc, upsert=True)
    await manager.broadcast({"type": "entry_update", "data": {**doc, "queued_at": now.isoformat()}})
    await audit_log(
        "packing.adopted", "packing_board", order_id_str,
        entity_label=order_data["name"],
        user=current_user,
        detail={"customer": partner_name, "units": doc["total_units"]},
    )
    return {"success": True, "order_id": order_id_str}


@router.post("/check-availability")
async def check_availability(
    body: OrderIdBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """8.70f — Odoo's "Check Availability" for one order's delivery: reserve
    whatever stock is now on the shelf, then refresh each line's status."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    odoo = get_odoo_client()
    try:
        pickings = _entry_active_pickings(odoo, entry["order_id"], entry.get("odoo_picking_id"))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Could not read the delivery from Odoo: {e}")
    if not pickings:
        raise HTTPException(status_code=400, detail="This order has no open delivery in Odoo.")
    for p in pickings:
        try:
            odoo.execute("stock.picking", "action_assign", [p["id"]])
        except Exception as e:
            # Odoo 19 raises this when there's nothing left to reserve; the
            # refresh below then reports which lines are still short.
            if "Nothing to check the availability" not in str(e):
                raise HTTPException(status_code=502, detail=f"Odoo couldn't check availability: {e}")
    new_items = await _refresh_entry_item_backorder_flags(odoo, entry)
    if new_items is not None:
        await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": {"items": new_items}})
        entry["items"] = new_items
    items = entry.get("items", [])
    await audit_log("packing.check_availability", "packing_board", str(entry["order_id"]),
                    entity_label=entry.get("customer_name", ""), user=current_user,
                    detail={"short": sum(1 for i in items if i.get("stock_status") == "short")})
    entry_out = {k: v for k, v in entry.items() if k != "_id"}
    await push_update(entry_out)
    return {"items": items,
            "short": sum(1 for i in items if i.get("is_backordered")),
            "reserved": sum(1 for i in items if not i.get("is_backordered"))}


@router.put("/mark-packing")
async def mark_packing(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk: advance a queued order to packing."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "queued":
        raise HTTPException(status_code=400, detail="Order must be queued before marking as packing")

    # Refresh stale is_backordered flags right as packing starts (2026-08-27)
    # — the single highest-value moment to correct them, since the packer is
    # about to act on this data. See _refresh_entry_item_backorder_flags's
    # own docstring for why this snapshot can go stale in the first place.
    try:
        new_items = await _refresh_entry_item_backorder_flags(get_odoo_client(), entry)
        if new_items is not None:
            await col("packing_board").update_one({"_id": entry["_id"]}, {"$set": {"items": new_items}})
    except Exception as e:
        logger.warning("mark_packing_item_backorder_refresh_failed", extra={"order_id": body.order_id, "error": str(e)})

    updated = await _do_update_status(body.order_id, "packing", current_user, body.picking_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry.get("reseller_id"):
        _res = await col("resellers").find_one(
            {"id": entry["reseller_id"]}, {"email": 1, "name": 1, "_id": 0}
        )
        if _res and _res.get("email"):
            _routing = await get_email_routing()
            background_tasks.add_task(
                send_order_packing_started,
                reseller_email=_res["email"],
                order_ref=entry.get("order_id", body.order_id),
                customer_name=entry.get("customer_name", ""),
                reseller_name=_res.get("name", ""),
                cc=_routing.get("order_cc") or None,
            )
    return {"success": True}


@router.put("/mark-ready")
async def mark_ready(
    body: OrderIdBody,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Orders Clerk: advance a packing order to ready for inspection."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    if entry["status"] != "packing":
        raise HTTPException(status_code=400, detail="Order must be packing before marking as ready")
    updated = await _do_update_status(body.order_id, "ready", current_user, body.picking_id)
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")

    _routing = await get_email_routing()
    background_tasks.add_task(
        send_qa_approval_needed,
        _routing["qa_approval_to"], body.order_id, entry.get("customer_name", ""), body.order_id,
    )
    background_tasks.add_task(
        send_rp_approval_needed,
        _routing["rp_approval_to"], body.order_id, entry.get("customer_name", ""), body.order_id,
    )
    return {"success": True}


@router.put("/override-status")
async def override_status(
    body: UpdateStatus,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_permission("tickets.manage")),
):
    """Admin override — set any status directly (tickets.manage permission required).
    When overriding to a terminal status, also syncs the linked sales ticket so
    legacy or manually-corrected entries stay consistent with the sales pipeline."""
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on board")
    # 8.69 — an override can't release unpaid goods either.
    if body.status == "collected":
        _t = await _linked_sales_ticket(body.order_id)
        if payment_required_before_collection(_t):
            _inv = _read_invoice_payment(get_odoo_client(), entry["invoice_id"]) if entry.get("invoice_id") else None
            if not _invoice_is_paid(_inv):
                raise HTTPException(
                    status_code=400,
                    detail="This order's invoice isn't paid. Goods can't be marked collected until Finance records the payment.",
                )
    updated = await col("packing_board").find_one_and_update(
        {"_id": entry["_id"]},
        {"$set": {"status": body.status}},
        return_document=True,
    )
    if not updated:
        raise HTTPException(status_code=404, detail="Order not on board")
    _hold_target = dict(updated)
    updated.pop("_id", None)
    await push_update(updated)
    await audit_log("packing.override_status", "packing_board", body.order_id,
                    entity_label=body.order_id, user=current_user,
                    detail={"from": entry["status"], "to": body.status})

    # Overriding to complete goes through the same hold-or-notify step as
    # Mark Complete, so an unpaid order is held rather than announced.
    if body.status == "complete":
        await hold_or_notify_after_complete(_hold_target, {"kind": "full"}, background_tasks, current_user)
        return {"success": True}

    # Sync the linked sales ticket when overriding to a terminal packing status.
    _ticket_outcome = {
        "incomplete": "incomplete",
        "cancelled":  "cancelled",
        "collected":  "complete",
    }.get(body.status)
    if _ticket_outcome:
        await _sync_sales_ticket(body.order_id, _ticket_outcome, background_tasks=background_tasks, actor=current_user)

    return {"success": True}


class AssignLotBody(BaseModel):
    order_id: str
    product_id: int   # Odoo product.product ID
    lot_id: int       # Odoo stock.lot ID
    picking_id: Optional[int] = None  # Odoo picking ID; if omitted, targets the primary (non-backorder) entry
    move_line_id: Optional[int] = None  # specific stock.move.line; required when the product is split across several lines


@router.put("/assign-lot")
async def assign_lot(
    body: AssignLotBody,
    current_user: dict = Depends(require_permission("tickets.orders")),
):
    """Assign a specific lot/batch to a product line on the active delivery order.

    Writes lot_id to the matching stock.move.line in Odoo so the lot appears
    on the validated delivery note. Must be called before mark-complete.

    2026-10-07: when Odoo has split a product across several move lines
    (reserved from more than one batch/location), the caller must name the
    exact `move_line_id` — previously every line for the product was
    overwritten with one batch, collapsing the whole quantity onto a batch
    that may not hold it. The chosen batch must also have stock inside the
    delivery's own source location (the batch picker was previously
    unscoped, listing stock from every warehouse). Returns the delivery's
    refreshed `picking_lots` so the page reflects what Odoo now holds.
    """
    entry = await col("packing_board").find_one(_entry_query(body.order_id, body.picking_id))
    if not entry:
        raise HTTPException(status_code=404, detail="Order not on packing board")
    if entry.get("status") not in ("queued", "packing", "ready"):
        raise HTTPException(status_code=400, detail="Lot assignment is only allowed before the order is completed")

    odoo = get_odoo_client()
    try:
        pickings = _entry_active_pickings(odoo, body.order_id, body.picking_id or entry.get("odoo_picking_id"))
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")

    if not pickings:
        raise HTTPException(status_code=404, detail="No open delivery found for this order")

    try:
        picking_lots = _read_picking_lots(odoo, pickings)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error reading move lines: {str(e)}")

    product_lines = picking_lots.get(str(body.product_id), [])
    if not product_lines:
        raise HTTPException(status_code=404, detail="This product is not on the open delivery")

    if body.move_line_id is not None:
        target = next((l for l in product_lines if l["move_line_id"] == body.move_line_id), None)
        if not target:
            raise HTTPException(status_code=404, detail="That delivery line no longer exists. Refresh and try again.")
    elif len(product_lines) == 1:
        target = product_lines[0]
    else:
        raise HTTPException(
            status_code=409,
            detail="This product is split across several batches on the delivery. Choose the batch for each line separately.",
        )

    # The batch must physically be in this delivery's source location.
    loc = pickings[0].get("location_id")
    location_id = loc[0] if isinstance(loc, list) else None
    if location_id and target["lot_id"] != body.lot_id:
        try:
            in_location = odoo.count(
                "stock.quant",
                [
                    ("product_id", "=", body.product_id),
                    ("lot_id", "=", body.lot_id),
                    ("location_id", "child_of", location_id),
                    ("quantity", ">", 0),
                ],
            )
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Odoo error checking batch stock: {str(e)}")
        if not in_location:
            raise HTTPException(
                status_code=400,
                detail="That batch has no stock in this order's warehouse. Choose a batch held in the dispatching warehouse.",
            )

    before_lot = target.get("lot_name")
    if target["lot_id"] != body.lot_id:
        try:
            odoo.write("stock.move.line", [target["move_line_id"]], {"lot_id": body.lot_id})
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"Failed to assign batch: {str(e)}")

    # Re-read so the response reflects what Odoo actually holds now (Odoo can
    # re-split a line when the new batch can only cover part of it).
    try:
        picking_lots = _read_picking_lots(odoo, _entry_active_pickings(odoo, body.order_id, body.picking_id or entry.get("odoo_picking_id")))
    except Exception:
        pass

    lot_name = next(
        (l["lot_name"] for lines in picking_lots.values() for l in lines if l["lot_id"] == body.lot_id),
        None,
    )
    if not lot_name:
        try:
            lot_rows = odoo.read("stock.lot", [body.lot_id], fields=["name"])
            lot_name = lot_rows[0]["name"] if lot_rows else str(body.lot_id)
        except Exception:
            lot_name = str(body.lot_id)

    await audit_log(
        "packing.assign_lot", "packing_board", body.order_id,
        entity_label=body.order_id,
        user=current_user,
        before={"lot_name": before_lot},
        after={"lot_name": lot_name},
        detail={"product_id": body.product_id, "move_line_id": target["move_line_id"], "lot_id": body.lot_id, "lot_name": lot_name},
    )
    return {"success": True, "lot_id": body.lot_id, "lot_name": lot_name, "picking_lots": picking_lots}


@router.get("/board")
async def get_board(warehouse_id: Optional[int] = None, search: Optional[str] = None, _: dict = Depends(require_board_access)):
    return {"entries": await get_board_state(warehouse_id, search=search, admin_view=True)}


@router.get("/packers")
async def list_packers(_: dict = Depends(get_current_user)):
    """Return active packer user accounts."""
    packers = await col("users").find(
        {"role": "packer", "active": True},
        {"_id": 0, "username": 1, "display_name": 1, "name": 1},
    ).to_list(length=100)
    return {"packers": packers}


# ── WebSocket endpoints ───────────────────────────────────────────────────────

async def _ws_reject(ws: WebSocket, reason: str):
    """Send a JSON auth_error before closing — Railway's proxy strips custom close codes."""
    await ws.send_text(_dumps({"type": "auth_error", "reason": reason}))
    await ws.close(code=4001)


@router.websocket("/ws/board")
async def websocket_board(ws: WebSocket):
    """
    85" display screen — read-only.
    Authenticated via a per-warehouse display token (Mongo-stored) passed as ?token=.
    """
    await ws.accept()
    warehouse_id = await _verify_display_token(ws)
    if warehouse_id is None:
        await _ws_reject(ws, "invalid_token")
        return
    try:
        await manager.connect_screen(ws, warehouse_id)
        while True:
            await asyncio.sleep(15)
            await ws.send_text(_dumps({"type": "ping"}))
    except WebSocketDisconnect:
        manager.disconnect(ws)
    except Exception as e:
        print(f"⚠️  Board WS error: {e}")
        manager.disconnect(ws)


@router.websocket("/ws/supervisor")
async def websocket_supervisor(ws: WebSocket):
    """
    Supervisor phone/tablet — read + write.
    Requires a valid warehouse_supervisor JWT passed as ?token=.
    """
    await ws.accept()
    user = await _verify_ws_user(ws, {"warehouse_supervisor"})
    if not user:
        await _ws_reject(ws, "unauthorized")
        return
    await manager.connect_supervisor(ws, user.get("warehouse_id"))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                action = msg.get("action")
                if action == "assign_packer":
                    await _do_assign_packer(msg["order_id"], msg["packer_name"], user)
                elif action == "tick_item":
                    await _do_tick_item(msg["order_id"], msg["sku"], msg.get("ticked", True), user)
                elif action == "update_status":
                    await _do_update_status(msg["order_id"], msg["status"], user)
            except Exception as e:
                print(f"⚠️  Supervisor WS error: {e}")
    except WebSocketDisconnect:
        manager.disconnect(ws)


@router.websocket("/ws/packer")
async def websocket_packer(ws: WebSocket):
    """
    Packer handheld — read + tick only.
    Requires a valid packer JWT passed as ?token=.
    """
    await ws.accept()
    user = await _verify_ws_user(ws, {"packer"})
    if not user:
        await _ws_reject(ws, "unauthorized")
        return
    await manager.connect_packer(ws, user.get("warehouse_id"))
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
                if msg.get("action") == "tick_item":
                    await _do_tick_item(msg["order_id"], msg["sku"], msg.get("ticked", True), user)
            except Exception as e:
                print(f"⚠️  Packer WS error: {e}")
    except WebSocketDisconnect:
        manager.disconnect(ws)


# ── Super-admin: test data purge ──────────────────────────────────────────────

class PurgeOrderBody(BaseModel):
    order_id: str


@router.delete("/purge")
async def purge_packing_entry(
    body: PurgeOrderBody,
    current_user: dict = Depends(require_super_admin),
):
    """
    Permanently delete all packing board entries for an order_id and every
    audit log trace.  Cascades to the linked sales ticket (and its audit logs).
    Irreversible — super_admin only.
    """
    order_id = body.order_id

    # Linked sales ticket (if any) — capture before deletion
    linked_ticket = await col("tickets").find_one({"orders_ticket_ref": order_id})

    deleted: dict = {"packing_board": 0, "ticket": 0, "audit_logs": 0}

    # All packing board entries for this order (includes backorders)
    pb_result = await col("packing_board").delete_many({"order_id": order_id})
    deleted["packing_board"] = pb_result.deleted_count

    # Audit logs for the packing board entries
    al_pb = await col("audit_log").delete_many(
        {"entity_type": "packing_board", "entity_id": order_id}
    )
    deleted["audit_logs"] += al_pb.deleted_count

    # Cascade: linked sales ticket and its audit logs
    if linked_ticket:
        ticket_id = str(linked_ticket["_id"])
        al_t = await col("audit_log").delete_many(
            {"entity_type": {"$in": ["ticket", "tickets"]}, "entity_id": ticket_id}
        )
        deleted["audit_logs"] += al_t.deleted_count
        await col("tickets").delete_one({"_id": linked_ticket["_id"]})
        deleted["ticket"] = 1

    # Record the purge itself
    await audit_log(
        "packing.purge", "admin_purge", order_id,
        entity_label=order_id,
        user=current_user,
        detail={"linked_ticket": str(linked_ticket["_id"]) if linked_ticket else None, "deleted": deleted},
    )

    return {
        "success": True,
        "purged": deleted,
        "order_id": order_id,
        "customer_name": linked_ticket.get("customer_name", "") if linked_ticket else "",
    }
