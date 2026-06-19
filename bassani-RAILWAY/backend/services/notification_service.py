"""
Notification service — helper functions called from other route modules.

Usage:
    from services.notification_service import notify_low_stock, notify_new_order

These are fire-and-forget — they log failures but never raise exceptions.
"""

from datetime import datetime, timezone
from database import col
from routes.notification_routes import send_push


async def _broadcast_to_users(
    user_ids: list,
    preference_key: str,
    title: str,
    body: str,
    url: str = "/",
    notification_type: str = "system",
):
    """Internal helper — find subscriptions and fire push notifications."""
    query = {
        "active": True,
        f"preferences.{preference_key}": True,
    }
    if user_ids:
        query["user_id"] = {"$in": user_ids}

    subs = await col("push_subscriptions").find(query, {"_id": 0}).to_list(length=500)

    sent = 0
    failed = 0
    for sub in subs:
        ok = send_push(sub, title, body, url)
        if ok:
            sent += 1
        else:
            failed += 1

    # Log the notification
    await col("notification_logs").insert_one({
        "type": notification_type,
        "title": title,
        "body": body,
        "target_user_ids": user_ids,
        "sent_count": sent,
        "failed_count": failed,
        "created_at": datetime.now(timezone.utc),
    })


async def notify_low_stock(product_name: str, current_qty: float, min_qty: float):
    """
    Fire when stock falls below minimum threshold.
    Notifies all admin users.
    """
    try:
        admin_users = await col("users").distinct("id", {"role": "admin", "active": True})
        await _broadcast_to_users(
            user_ids=admin_users,
            preference_key="low_stock",
            title="Low Stock Alert",
            body=f"{product_name} is low — {current_qty} remaining (min: {min_qty})",
            url="/products",
            notification_type="low_stock",
        )
    except Exception as e:
        print(f"⚠️  notify_low_stock failed: {e}")


async def notify_new_order(order_name: str, customer_name: str, amount: float):
    """
    Fire when a new order is created.
    Notifies all admin users.
    """
    try:
        admin_users = await col("users").distinct("id", {"role": "admin", "active": True})
        await _broadcast_to_users(
            user_ids=admin_users,
            preference_key="new_orders",
            title="New Order Received",
            body=f"{order_name} from {customer_name} — R {amount:,.2f}",
            url="/orders",
            notification_type="new_order",
        )
    except Exception as e:
        print(f"⚠️  notify_new_order failed: {e}")


async def notify_commission_update(
    reseller_name: str,
    commission_amount: float,
    period: str,
    reseller_user_id: str,
):
    """
    Fire when commission is calculated for a reseller.
    Notifies the specific reseller only.
    """
    try:
        await _broadcast_to_users(
            user_ids=[reseller_user_id],
            preference_key="commission_updates",
            title="Commission Update",
            body=f"R {commission_amount:,.2f} commission for {period}",
            url="/commission",
            notification_type="commission_update",
        )
    except Exception as e:
        print(f"⚠️  notify_commission_update failed: {e}")


async def notify_ticket_assigned(ticket_type: str, customer_name: str, assigned_user_id: str):
    """
    Fire when a ticket is created/assigned to a specific staff member.
    Notifies only that person.
    """
    try:
        await _broadcast_to_users(
            user_ids=[assigned_user_id],
            preference_key="ticket_assigned",
            title="New Ticket Assigned",
            body=f"{ticket_type.title()} ticket for {customer_name}",
            url="/tickets/sales",
            notification_type="ticket_assigned",
        )
    except Exception as e:
        print(f"⚠️  notify_ticket_assigned failed: {e}")


async def notify_ticket_handoff(customer_name: str, outcome: str, assigned_user_id: str):
    """
    Fire when an Orders ticket reaches complete/incomplete/cancelled and
    writes back to its parent Sales ticket — tells the assigned sales rep
    immediately instead of them needing to poll for the outcome.
    """
    try:
        await _broadcast_to_users(
            user_ids=[assigned_user_id],
            preference_key="ticket_handoff",
            title="Order Update",
            body=f"{customer_name}'s order is now '{outcome}' — check the ticket for details",
            url="/tickets/sales",
            notification_type="ticket_handoff",
        )
    except Exception as e:
        print(f"⚠️  notify_ticket_handoff failed: {e}")


async def notify_announcement(title: str, body: str, url: str = "/"):
    """
    Broadcast a system announcement to all users.
    """
    try:
        await _broadcast_to_users(
            user_ids=[],          # empty = all users
            preference_key="system_announcements",
            title=title,
            body=body,
            url=url,
            notification_type="announcement",
        )
    except Exception as e:
        print(f"⚠️  notify_announcement failed: {e}")
