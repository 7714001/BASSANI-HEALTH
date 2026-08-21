"""
Notification schedulers — time-based email triggers that no user action fires.

Two shapes, both started once from server.py's startup event:
  - _interval_loop: sleep N seconds, run, repeat (same shape as the existing
    22.1 payment-check loop in server.py).
  - _daily_loop: sleep until the next occurrence of a wall-clock time, run,
    repeat. No existing precedent for this in the codebase — computed here
    against a fixed UTC+2 offset (SAST has no DST, so no zoneinfo/tzdata
    dependency is needed).

Routing recipients are read directly from the portal_settings.email_routing
document, matching services/bank_recon_service.py's existing convention
(services-layer code reads the doc directly rather than importing the
routes.settings_routes helper).
"""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from database import col
from odoo_client import get_odoo_client
from services.email_service import (
    send_application_escalation,
    send_qa_rp_daily_digest,
    send_backorder_daily_digest,
    send_mo_daily_digest,
)
from routes.recurring_order_routes import (
    generate_recurring_notices,
    expire_unaccepted_occurrences,
)

logger = logging.getLogger(__name__)

SAST = timezone(timedelta(hours=2))


async def _get_routing_list(key: str) -> list:
    doc = await col("portal_settings").find_one({"_id": "email_routing"})
    return (doc or {}).get(key, [])


async def _sleep_until(hour: int, minute: int = 0) -> None:
    """Sleep until the next occurrence of hour:minute SAST."""
    now = datetime.now(SAST)
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    await asyncio.sleep((target - now).total_seconds())


async def _daily_loop(name: str, hour: int, minute: int, fn) -> None:
    while True:
        await _sleep_until(hour, minute)
        try:
            await fn()
            logger.info("%s_digest_complete", name)
        except Exception as exc:
            logger.warning("%s_digest_error", name, extra={"error": str(exc)})


async def _interval_loop(name: str, interval_s: int, fn, initial_delay: int = 60) -> None:
    await asyncio.sleep(initial_delay)
    while True:
        try:
            await fn()
        except Exception as exc:
            logger.warning("%s_loop_error", name, extra={"error": str(exc)})
        await asyncio.sleep(interval_s)


# ── Job bodies ────────────────────────────────────────────────────────────────

async def check_stale_applications() -> None:
    """Escalates onboarding applications that have sat 4+ hours with no signing
    documents generated. Each application is escalated once (escalation_notified_at
    stamped after a successful send)."""
    to = await _get_routing_list("application_escalation_to")
    if not to:
        return
    cutoff = datetime.now(timezone.utc) - timedelta(hours=4)
    stale = await col("customer_onboarding").find({
        "status": "pending",
        "signing_session_token": {"$exists": False},
        "submitted_at": {"$lt": cutoff},
        "escalation_notified_at": {"$exists": False},
    }).to_list(length=None)
    for app in stale:
        submitted_at = app.get("submitted_at")
        if submitted_at and submitted_at.tzinfo is None:
            submitted_at = submitted_at.replace(tzinfo=timezone.utc)
        hours_pending = (datetime.now(timezone.utc) - submitted_at).total_seconds() / 3600 if submitted_at else 4.0
        send_application_escalation(to, app["id"], app.get("company_name", "Applicant"), hours_pending)
        await col("customer_onboarding").update_one(
            {"id": app["id"]},
            {"$set": {"escalation_notified_at": datetime.now(timezone.utc)}},
        )


async def run_qa_rp_digest() -> None:
    """17:00 SAST — digest of orders still awaiting QA and/or RP sign-off."""
    to = await _get_routing_list("qa_rp_daily_digest_to")
    if not to:
        return
    entries = await col("packing_board").find({
        "status": "ready",
        "$or": [
            {"qa_approved_at": {"$exists": False}},
            {"rp_approved_at": {"$exists": False}},
        ],
    }).to_list(length=None)
    if not entries:
        return
    items = [
        {
            "order_ref": e.get("order_id", ""),
            "customer_name": e.get("customer_name", ""),
            "missing": [
                label for label, field in (("QA", "qa_approved_at"), ("RP", "rp_approved_at"))
                if not e.get(field)
            ],
        }
        for e in entries
    ]
    send_qa_rp_daily_digest(to, items)


async def run_backorder_digest() -> None:
    """17:00 SAST — digest of every order currently waiting on stock."""
    to = await _get_routing_list("backorder_daily_digest_to")
    if not to:
        return
    entries = await col("packing_board").find({
        "is_backorder": True,
        "waiting_stock": True,
    }).to_list(length=None)
    if not entries:
        return
    items = [
        {
            "order_ref": e.get("order_id", ""),
            "customer_name": e.get("customer_name", ""),
            "picking_name": e.get("picking_name", ""),
        }
        for e in entries
    ]
    send_backorder_daily_digest(to, items)


async def run_mo_digest() -> None:
    """17:00 SAST — digest of Manufacturing Orders still in progress (not
    done/cancelled) that Odoo's own replenishment routing created to fulfil
    a backordered sale order line. The portal never creates an MO itself —
    action_confirm on the sale order is the only write, and any resulting
    MO is Odoo's automatic side effect of that call, contingent on the
    product's own Manufacture/MTO route configuration. This digest exists
    purely because nothing previously told staff a new one had appeared —
    they'd only ever see it by opening the ticket/Order Passport.

    Domain is scoped to `origin like "S0"` (Bassani's confirmed sale.order
    naming convention, e.g. S00764/S00602 — see CLAUDE.md) specifically to
    exclude the unrelated vault/manicuring-lab MOs (services/vault_odoo.py),
    which are a different feature entirely and would otherwise be noise
    here — those don't originate from a customer sale order at all."""
    to = await _get_routing_list("mo_daily_digest_to")
    if not to:
        return
    odoo = get_odoo_client()
    try:
        mos = odoo.search_read(
            "mrp.production",
            domain=[("state", "not in", ["done", "cancel"]), ("origin", "like", "S0")],
            fields=["name", "product_id", "state", "origin"],
            limit=200,
            order="date_start asc",
        )
    except Exception as exc:
        logger.warning("mo_digest_odoo_error", extra={"error": str(exc)})
        return
    if not mos:
        return
    items = [
        {
            "mo_name": m.get("name", ""),
            "product_name": m["product_id"][1] if m.get("product_id") else "",
            "order_ref": m.get("origin") or "",
            "state": m.get("state", ""),
        }
        for m in mos
    ]
    send_mo_daily_digest(to, items)


def start_notification_schedulers() -> None:
    """Called once from server.py's startup event."""
    asyncio.create_task(_interval_loop("application_escalation", 1800, check_stale_applications))
    asyncio.create_task(_daily_loop("qa_rp", 17, 0, run_qa_rp_digest))
    asyncio.create_task(_daily_loop("backorder", 17, 0, run_backorder_digest))
    asyncio.create_task(_daily_loop("mo_digest", 17, 0, run_mo_digest))
    # Phase 8.46 — recurring orders: T-2-day notice/generation, then a same-day
    # sweep for occurrences nobody responded to in time.
    asyncio.create_task(_daily_loop("recurring_notice", 8, 0, generate_recurring_notices))
    asyncio.create_task(_daily_loop("recurring_expire", 18, 0, expire_unaccepted_occurrences))
    logger.info("notification_schedulers_started")
