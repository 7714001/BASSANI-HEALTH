"""
Shared helpers for the staff discount request/approval flow (8.61). Kept as
its own root-level module — same precedent as ownership.py/contacts.py —
since both routes/ticket_routes.py (cancel-on-edit) and routes/discount_routes.py
need it, and those two would otherwise risk a route-importing-route circular
import.

Only staff request discounts (never reseller/customer). A ticket can have at
most one *active* (pending) request at a time — `tickets.discount_status` /
`tickets.discount_request_id` are the gate every other endpoint checks before
letting a quote be sent or an order confirmed (see order_routes.py's
_confirm_order_core and ticket_routes.py's send_quote).
"""
import logging
from datetime import datetime, timezone
from typing import Optional
from bson import ObjectId
from database import col

logger = logging.getLogger(__name__)


async def cancel_pending_request(ticket: dict, reason: str, actor: Optional[dict] = None) -> None:
    """Withdraws a ticket's pending discount request — called when the quote's
    line items are edited before a decision was made (the request was built
    against a line set that no longer exists), or when the requester
    withdraws it themselves. Best-effort and silent on failure, same
    convention as ticket_routes.py's _cancel_linked_packing_board — this must
    never block the edit/withdraw action that triggered it. No-op if the
    ticket has no active request (the common case).
    """
    req_id = ticket.get("discount_request_id")
    if not req_id:
        return
    now = datetime.now(timezone.utc)
    try:
        await col("discount_requests").update_one(
            {"_id": ObjectId(req_id), "status": "pending"},
            {"$set": {
                "status": "cancelled",
                "decision": {
                    "by": {"id": actor.get("id"), "name": actor.get("name") or actor.get("username")} if actor else None,
                    "at": now,
                    "note": reason,
                },
                "updated_at": now,
            }},
        )
    except Exception as exc:
        logger.warning("discount_request_cancel_failed request_id=%s error=%s", req_id, exc)
    try:
        await col("tickets").update_one(
            {"_id": ticket["_id"]},
            {"$unset": {"discount_status": "", "discount_request_id": ""}},
        )
    except Exception as exc:
        logger.warning("discount_request_ticket_flag_clear_failed ticket_id=%s error=%s", ticket.get("_id"), exc)
