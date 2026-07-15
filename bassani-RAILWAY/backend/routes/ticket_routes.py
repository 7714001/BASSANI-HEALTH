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
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, WebSocket, WebSocketDisconnect
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from bson import ObjectId
from config import get_settings
from auth import (
    require_permission, require_any_permission, require_admin,
    get_current_user, get_user_by_username, ADMIN_ROLES, TICKET_ROLES,
)
from odoo_client import get_odoo_client, odoo as odoo_call
from warehouse_context import company_context
from database import col, NO_ID
from middleware.audit import audit_log
from services.notification_service import notify_ticket_assigned
from services.email_service import send_ticket_assigned

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/tickets", tags=["tickets"])


# ── Real-time connection manager ───────────────────────────────────────────────

class TicketConnectionManager:
    """Manages active WebSocket connections for real-time ticket push notifications.

    Staff (any non-reseller role) receive every update.
    Reseller connections receive only updates scoped to their own tickets.
    Dead connections are pruned silently on the next broadcast.
    """
    def __init__(self):
        self._conns: list[tuple] = []  # (ws, role, reseller_id_str | None)

    async def connect(self, ws: WebSocket, role: str, reseller_id: str | None):
        await ws.accept()
        self._conns.append((ws, role, reseller_id))

    def disconnect(self, ws: WebSocket):
        self._conns = [(w, r, rid) for (w, r, rid) in self._conns if w is not ws]

    async def broadcast(self, ticket_id: str, ticket_reseller_id: str | None = None):
        payload = {"type": "ticket_update", "ticket_id": ticket_id}
        dead: list = []
        for ws, role, reseller_id in list(self._conns):
            if role != "reseller" or reseller_id == ticket_reseller_id:
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
    On connect the server sends {type: "connected"}.
    On any ticket mutation the server pushes {type: "ticket_update", ticket_id: "..."}.
    No inbound messages are expected — the connection is server-push only.
    """
    cfg = get_settings()
    token = ws.query_params.get("token", "")
    try:
        payload = jwt.decode(token, cfg.jwt_secret, algorithms=[cfg.jwt_algorithm])
        username = payload.get("sub")
        user = await get_user_by_username(username) if username else None
        if not user or not user.get("active", True):
            await ws.close(code=4001)
            return
    except Exception:
        await ws.close(code=4001)
        return

    role = user.get("role", "")
    reseller_id: str | None = None
    if role == "reseller":
        reseller_doc = await col("resellers").find_one({"user_id": user["id"]}, {"_id": 1})
        reseller_id = str(reseller_doc["_id"]) if reseller_doc else None

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
STATUSES = ["open", "quote", "sale_order", "confirmed_wip", "ready_for_collection", "incomplete"]

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


async def _reseller_id_for_user(user: dict) -> Optional[str]:
    """Return the reseller's `id` field — the same value stored in ticket.reseller_id by create_order."""
    if user.get("role") != "reseller":
        return None
    doc = await col("resellers").find_one({"user_id": user["id"]}, {"id": 1, "_id": 0})
    return doc["id"] if doc else None


def _assert_reseller_owns_ticket(ticket: dict, reseller_id: str) -> None:
    """Raise 403 if this ticket does not belong to the given reseller."""
    if ticket.get("reseller_id") != reseller_id:
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
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            return {"tickets": [], "total": 0}
        query["reseller_id"] = rid
    elif reseller_id and (current_user.get("is_super_admin") or role in ADMIN_ROLES):
        # Admin drilling into a specific reseller's pipeline (e.g. from Reseller Profile page)
        query["reseller_id"] = reseller_id
    elif assigned_to:
        query["assigned_to"] = assigned_to
    elif role == "sales":
        # Staff sales queue: own tickets + unassigned internal + reseller tickets
        # that have been confirmed and handed to Bassani (sale_order and beyond).
        # Pre-confirm reseller quotes (open/quote) are hidden — the reseller is
        # still working on them and they haven't entered the Bassani pipeline yet.
        query["$or"] = [
            {"assigned_to": current_user["id"]},
            {"assigned_to": None, "reseller_id": None},
            {"reseller_id": {"$ne": None}, "status": {"$nin": ["open", "quote"]}},
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
    order_ids = list({t["order_id"] for t in tickets if t.get("order_id")})
    if order_ids:
        try:
            odoo = get_odoo_client()
            so_records = odoo.read("sale.order", order_ids, fields=["id", "name"])
            order_name_map = {r["id"]: r["name"] for r in so_records}
            for t in tickets:
                if t.get("order_id"):
                    t["order_name"] = order_name_map.get(t["order_id"])
        except Exception:
            pass  # degrade gracefully — list still works, names just absent

    return {"tickets": [_serialize(t) for t in tickets], "total": len(tickets)}




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
        _assert_reseller_owns_ticket(ticket, rid)

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
                    rid = ticket.get("reseller_id")
                    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)

                else:
                    set_fields: dict = {"updated_at": now}
                    history:    list = []
                    current_status = ticket.get("status", "open")
                    current_idx    = STATUSES.index(current_status) if current_status in STATUSES else 0

                    if live_state != ticket.get("odoo_order_state"):
                        set_fields["odoo_order_state"] = live_state

                    # ── Determine target portal status ─────────────────────
                    # Confirmed orders (sale/done) advance directly to confirmed_wip —
                    # no deposit or invoice step in the pipeline.
                    _s2s = {"draft": "quote", "sent": "quote", "sale": "confirmed_wip", "done": "confirmed_wip"}
                    target_status = _s2s.get(live_state, current_status)

                    target_idx = STATUSES.index(target_status) if target_status in STATUSES else 0

                    # ── Advance (never go backward) ────────────────────────
                    if target_idx > current_idx:
                        _notes = {
                            "sale_order":    f"Auto-sync: Odoo order confirmed (state: {live_state})",
                            "confirmed_wip": f"Auto-sync: Odoo order confirmed (state: {live_state})",
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

                    # ── Packing board — create entry if order is confirmed
                    # but was never pushed through the portal confirm flow.
                    if live_state in ("sale", "done") and not ticket.get("orders_ticket_ref"):
                        try:
                            items       = []
                            dn_num      = ""
                            picking_ids = row.get("picking_ids", [])
                            if picking_ids:
                                pkgs = odoo.read("stock.picking", [picking_ids[0]], fields=["name", "move_ids"])
                                if pkgs:
                                    dn_num = pkgs[0].get("name", "")
                                    if pkgs[0].get("move_ids"):
                                        moves = odoo.read(
                                            "stock.move", pkgs[0]["move_ids"],
                                            fields=["product_id", "product_uom_qty"],
                                        )
                                        for m in moves:
                                            pname = m["product_id"][1] if m.get("product_id") else "Unknown"
                                            prods = (
                                                odoo.read("product.product", [m["product_id"][0]], fields=["default_code"])
                                                if m.get("product_id") else []
                                            )
                                            sku = (prods[0].get("default_code") or str(m["product_id"][0])) if prods else ""
                                            items.append({"name": pname, "sku": sku, "product_id": m["product_id"][0] if m.get("product_id") else None, "qty": m["product_uom_qty"], "location": ""})

                            comm_data = await col("order_commissions").find_one(
                                {"odoo_order_id": str(order_id)}, NO_ID
                            )
                            _pb_reseller_name = (
                                comm_data.get("reseller_name") if comm_data
                                else ticket.get("reseller_name")
                            )
                            if not _pb_reseller_name and ticket.get("reseller_id"):
                                _res_pb = await col("resellers").find_one(
                                    {"id": ticket["reseller_id"]}, {"name": 1, "_id": 0}
                                )
                                _pb_reseller_name = _res_pb["name"] if _res_pb else None
                            pb_doc = {
                                "order_id":       str(order_id),
                                "warehouse_id":   row["warehouse_id"][0]  if row.get("warehouse_id") else None,
                                "warehouse_name": row["warehouse_id"][1]  if row.get("warehouse_id") else None,
                                "customer_name":  row["partner_id"][1]    if row.get("partner_id")   else "",
                                "customer_city":  "",
                                "items":          items,
                                "total_units":    int(sum(i["qty"] for i in items)),
                                "inv_num":        "",
                                "dn_num":         dn_num,
                                "ps_num":         row.get("name", ""),
                                "notes":          row.get("note") or "",
                                "is_reseller":    bool(comm_data) or bool(ticket.get("reseller_id")),
                                "reseller_name":  _pb_reseller_name,
                                "packer_name": None, "status": "queued", "queued_at": now,
                                "packed_at": None, "ready_at": None, "collected_at": None,
                                "cancelled_at": None, "incomplete_at": None, "completed_at": None,
                                "incomplete_reason": None,
                                "qa_approved_by": None, "qa_approved_at": None,
                                "rp_approved_by": None, "rp_approved_at": None,
                                "item_ticks": {i["sku"]: False for i in items},
                            }
                            await col("packing_board").replace_one(
                                {"order_id": str(order_id)}, pb_doc, upsert=True
                            )
                            set_fields["orders_ticket_ref"] = str(order_id)
                            ticket["orders_ticket_ref"]     = str(order_id)
                        except Exception as _pb_err:
                            print(f"⚠️  Auto-sync packing board failed: {_pb_err}")

                    # ── Commit ────────────────────────────────────────────
                    if set(set_fields) - {"updated_at"} or history:
                        mongo_op: dict = {"$set": set_fields}
                        if history:
                            mongo_op["$push"] = {"stage_history": {"$each": history}}
                        await col("tickets").update_one({"_id": oid}, mongo_op)
                        if history:
                            rid = ticket.get("reseller_id")
                            await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)

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
    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
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
    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
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
        _assert_reseller_owns_ticket(ticket, rid)
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
    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
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
        _assert_reseller_owns_ticket(ticket, rid)
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
    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
    return {"success": True}


@router.put("/{ticket_id}/update-order")
async def update_order_from_ticket(
    ticket_id: str,
    body: TicketOrderUpdate,
    current_user: dict = Depends(_require_ticket_driver),
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
    is_reseller_caller = current_user.get("role") == "reseller"
    if is_reseller_caller:
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            raise HTTPException(status_code=403, detail="Access denied")
        _assert_reseller_owns_ticket(ticket, rid)
        if body.customer_id:
            raise HTTPException(status_code=403, detail="Resellers cannot change the customer on a quote")
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
    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
    return {"success": True, "odoo_order_id": order_id}


@router.post("/{ticket_id}/send-quote")
async def send_quote(
    ticket_id: str,
    current_user: dict = Depends(_require_ticket_driver),
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
    if current_user.get("role") == "reseller":
        rid = await _reseller_id_for_user(current_user)
        if not rid:
            raise HTTPException(status_code=403, detail="Access denied")
        _assert_reseller_owns_ticket(ticket, rid)
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
    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)

    result: dict = {"success": True, "email_sent": email_sent}
    if warning:
        result["warning"] = warning
    return result




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
    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
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


@router.post("/{ticket_id}/admin-override-payment")
async def admin_override_payment(
    ticket_id: str,
    current_user: dict = Depends(require_permission("tickets.manage")),
):
    """Admin shortcut for confirmed Odoo orders where payment is known to have been received
    but hasn't gone through the standard Finance deposit registration flow (e.g. legacy orders,
    pre-portal payments, or cases where Odoo already reflects payment).

    Marks payment confirmed at the portal layer and creates the packing board entry.
    Does NOT write to Odoo — the financial record must already exist in Odoo separately.
    """
    try:
        oid = ObjectId(ticket_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ticket ID")
    ticket = await col("tickets").find_one({"_id": oid})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found")
    if ticket.get("exit_status"):
        raise HTTPException(status_code=400, detail=f"Ticket is closed as '{ticket['exit_status']}'")
    if not ticket.get("order_id"):
        raise HTTPException(status_code=400, detail="No linked order on this ticket")
    if ticket.get("payment_confirmed_at"):
        raise HTTPException(status_code=400, detail="Payment already confirmed on this ticket")
    if ticket.get("orders_ticket_ref"):
        raise HTTPException(status_code=400, detail="Order is already in the packing queue")

    order_id = ticket["order_id"]
    odoo = get_odoo_client()
    try:
        rows = odoo.read(
            "sale.order", [order_id],
            fields=["name", "partner_id", "state", "warehouse_id", "picking_ids", "note", "invoice_ids"],
        )
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
    if not rows:
        raise HTTPException(status_code=404, detail="Linked order not found in Odoo")
    order_data = rows[0]
    if order_data["state"] != "sale":
        raise HTTPException(
            status_code=400,
            detail=f"Order {order_data['name']} is not confirmed in Odoo (state: {order_data['state']}). Confirm the order in Odoo first.",
        )

    # Build packing board entry from Odoo picking data
    items: list = []
    dn_num = ""
    inv_name = ""
    if order_data.get("invoice_ids"):
        try:
            inv_rows = odoo.read("account.move", [order_data["invoice_ids"][0]], fields=["name"])
            inv_name = inv_rows[0]["name"] if inv_rows else ""
        except Exception:
            pass
    if order_data.get("picking_ids"):
        try:
            picking_id = order_data["picking_ids"][0]
            pickings = odoo.read("stock.picking", [picking_id], fields=["name", "move_ids"])
            picking = pickings[0] if pickings else None
            if picking:
                dn_num = picking["name"]
                if picking.get("move_ids"):
                    moves = odoo.read("stock.move", picking["move_ids"], fields=["product_id", "product_uom_qty"])
                    for m in moves:
                        pname = m["product_id"][1] if m.get("product_id") else "Unknown"
                        prod = (
                            odoo.read("product.product", [m["product_id"][0]], fields=["default_code"])
                            if m.get("product_id") else []
                        )
                        sku = prod[0].get("default_code") or str(m["product_id"][0]) if prod else ""
                        items.append({"name": pname, "sku": sku, "product_id": m["product_id"][0] if m.get("product_id") else None, "qty": m["product_uom_qty"], "location": ""})
        except Exception as e:
            logger.warning("admin_override_picking_read_error", extra={"order_id": order_id, "error": str(e)})

    comm_data = await col("order_commissions").find_one({"odoo_order_id": str(order_id)}, NO_ID)
    now = datetime.now(timezone.utc)
    actor = _actor(current_user)

    _pb_reseller_name = (
        comm_data.get("reseller_name") if comm_data
        else ticket.get("reseller_name")
    )
    if not _pb_reseller_name and ticket.get("reseller_id"):
        _res_pb = await col("resellers").find_one(
            {"id": ticket["reseller_id"]}, {"name": 1, "_id": 0}
        )
        _pb_reseller_name = _res_pb["name"] if _res_pb else None

    pb_doc = {
        "order_id":       str(order_id),
        "warehouse_id":   order_data["warehouse_id"][0]  if order_data.get("warehouse_id") else None,
        "warehouse_name": order_data["warehouse_id"][1]  if order_data.get("warehouse_id") else None,
        "customer_name":  order_data["partner_id"][1]    if order_data.get("partner_id")   else "",
        "customer_city":  "",
        "items":          items,
        "total_units":    int(sum(i["qty"] for i in items)),
        "inv_num":        inv_name,
        "dn_num":         dn_num,
        "ps_num":         order_data.get("name", ""),
        "notes":          order_data.get("note") or "",
        "is_reseller":    bool(comm_data) or bool(ticket.get("reseller_id")),
        "reseller_name":  _pb_reseller_name,
        "packer_name": None, "status": "queued", "queued_at": now,
        "packed_at": None, "ready_at": None, "collected_at": None,
        "cancelled_at": None, "incomplete_at": None, "completed_at": None,
        "incomplete_reason": None,
        "qa_approved_by": None, "qa_approved_at": None,
        "rp_approved_by": None, "rp_approved_at": None,
        "item_ticks": {i["sku"]: False for i in items},
    }
    await col("packing_board").replace_one({"order_id": str(order_id)}, pb_doc, upsert=True)

    await col("tickets").update_one(
        {"_id": oid},
        {
            "$set": {
                "payment_confirmed_by": current_user["id"],
                "payment_confirmed_at": now,
                "orders_ticket_ref": str(order_id),
                "updated_at": now,
            },
            "$push": {"stage_history": {
                "status": ticket["status"], "exit_status": None,
                "actor_id": current_user["id"], "actor_name": actor,
                "at": now,
                "note": f"Admin override by {actor}: payment marked confirmed, order queued for packing. Financial record must be confirmed in Odoo separately.",
            }},
        },
    )
    await audit_log(
        "ticket.admin_override_payment", "ticket", ticket_id,
        entity_label=ticket.get("customer_name", ""),
        user=current_user,
        detail={"order_id": order_id, "order_name": order_data.get("name"), "override_by": actor},
    )
    rid = ticket.get("reseller_id")
    await ticket_manager.broadcast(ticket_id, str(rid) if rid else None)
    return {"success": True}


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
    await ticket_manager.broadcast(ticket_id, ticket.get("reseller_id"))

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

    await ticket_manager.broadcast(ticket_id, ticket.get("reseller_id"))

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


# ── 8.26 + 8.28 — Lookup endpoints ───────────────────────────────────────────

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
