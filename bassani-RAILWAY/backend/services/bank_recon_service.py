"""
Phase 22.1 — Automated payment detection.

check_invoice_payments() is called every 15 minutes from server.py's startup
event. It batch-reads Odoo payment_state for all tickets with an unpaid linked
invoice, auto-confirms any where Odoo shows paid or in_payment, and sends a
digest email to the finance_notification_to routing addresses.
"""
import logging
from datetime import datetime, timezone

from database import col
from middleware.audit import audit_log
from odoo_client import get_odoo_client
from services.email_service import send_payment_auto_confirmed

logger = logging.getLogger(__name__)


async def check_invoice_payments() -> dict:
    """
    Batch-checks Odoo payment_state for all open tickets with a linked invoice.
    Auto-confirms any where Odoo shows paid or in_payment.
    Returns {checked: int, confirmed: int}.
    """
    tickets = await col("tickets").find({
        "status": {"$in": ["invoice", "confirmed_wip", "sale_order"]},
        "payment_confirmed_at": None,
        "invoice_id": {"$exists": True, "$ne": None},
        "exit_status": {"$in": [None, ""]},
    }).to_list(length=None)

    if not tickets:
        return {"checked": 0, "confirmed": 0}

    valid_tickets = [t for t in tickets if isinstance(t.get("invoice_id"), int)]
    if not valid_tickets:
        return {"checked": len(tickets), "confirmed": 0}

    invoice_ids = list({t["invoice_id"] for t in valid_tickets})

    try:
        odoo = get_odoo_client()
        invoice_records = odoo.read(
            "account.move",
            invoice_ids,
            fields=["id", "name", "payment_state", "amount_residual"],
        )
    except Exception as exc:
        logger.warning("auto_payment_check_odoo_failed", extra={"error": str(exc)})
        return {"checked": len(valid_tickets), "confirmed": 0}

    invoice_map = {inv["id"]: inv for inv in invoice_records}

    now = datetime.now(timezone.utc)
    confirmed_items = []

    for ticket in valid_tickets:
        inv = invoice_map.get(ticket["invoice_id"])
        if not inv:
            continue
        if inv["payment_state"] not in ("paid", "in_payment"):
            continue

        tid = ticket["_id"]
        ticket_id_str = str(tid)

        await col("tickets").update_one(
            {"_id": tid},
            {
                "$set": {
                    "payment_confirmed_by": "auto",
                    "payment_confirmed_at": now,
                    "auto_payment_confirmed": True,
                    "updated_at": now,
                },
                "$push": {"stage_history": {
                    "status": ticket.get("status"),
                    "exit_status": None,
                    "actor_id": "system",
                    "actor_name": "System (auto)",
                    "at": now,
                    "note": f"Payment auto-confirmed (Odoo payment_state={inv['payment_state']})",
                }},
            },
        )

        await audit_log(
            "ticket.auto_confirm_payment", "ticket", ticket_id_str,
            entity_label=ticket.get("customer_name", ""),
            user=None,
            detail={
                "payment_state": inv["payment_state"],
                "amount_residual": inv["amount_residual"],
                "invoice_name": inv["name"],
            },
        )

        confirmed_items.append({
            "customer_name": ticket.get("customer_name", ""),
            "order_id": ticket.get("order_id", ""),
            "invoice_name": inv["name"],
        })

        logger.info("auto_payment_confirmed", extra={
            "ticket_id": ticket_id_str,
            "invoice_id": ticket["invoice_id"],
            "payment_state": inv["payment_state"],
        })

    if confirmed_items:
        try:
            routing_doc = await col("portal_settings").find_one({"_id": "email_routing"})
            finance_emails = (routing_doc or {}).get("finance_notification_to", [])
            if finance_emails:
                send_payment_auto_confirmed(to=finance_emails, confirmed_items=confirmed_items)
        except Exception as exc:
            logger.warning("auto_payment_email_failed", extra={"error": str(exc)})

    return {"checked": len(valid_tickets), "confirmed": len(confirmed_items)}
