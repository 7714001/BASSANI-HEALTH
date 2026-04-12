from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from typing import Optional, List
from pydantic import BaseModel
from datetime import datetime, timezone
from auth import get_current_user, require_admin
from database import col, NO_ID
from config import get_settings

router = APIRouter(prefix="/api/notifications", tags=["notifications"])
settings = get_settings()

# ── Pydantic models ───────────────────────────────────────────────────────────

class PushKeys(BaseModel):
    p256dh: str
    auth: str

class PushSubscription(BaseModel):
    endpoint: str
    keys: PushKeys

class NotificationPreferences(BaseModel):
    low_stock: bool = True
    new_orders: bool = True
    commission_updates: bool = True
    system_announcements: bool = True

class BroadcastMessage(BaseModel):
    title: str
    body: str
    url: Optional[str] = "/"
    target_roles: Optional[List[str]] = None    # None = all users

# ── Push helper ───────────────────────────────────────────────────────────────

def send_push(subscription_info: dict, title: str, body: str, url: str = "/") -> bool:
    """Send a single push notification via VAPID."""
    if not settings.vapid_private_key or not settings.vapid_public_key:
        print(f"📲 [Mock push] {title}: {body}")
        return True
    try:
        from pywebpush import webpush, WebPushException
        webpush(
            subscription_info={
                "endpoint": subscription_info["endpoint"],
                "keys": subscription_info["keys"],
            },
            data=f'{{"title":"{title}","body":"{body}","url":"{url}"}}',
            vapid_private_key=settings.vapid_private_key,
            vapid_claims={
                "sub": f"mailto:{settings.vapid_claims_email}",
            },
        )
        return True
    except Exception as e:
        print(f"⚠️  Push failed: {e}")
        return False

# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/vapid-key")
def get_vapid_key():
    """Return the VAPID public key for browser push subscription."""
    if not settings.vapid_public_key:
        raise HTTPException(status_code=503, detail="Push notifications not configured")
    return {"public_key": settings.vapid_public_key}


@router.post("/subscribe")
async def subscribe(
    subscription: PushSubscription,
    preferences: Optional[NotificationPreferences] = None,
    current_user: dict = Depends(get_current_user),
):
    """Register a push subscription for the current user."""
    now = datetime.now(timezone.utc)
    prefs = preferences.model_dump() if preferences else {
        "low_stock": True,
        "new_orders": True,
        "commission_updates": True,
        "system_announcements": True,
    }

    await col("push_subscriptions").update_one(
        {"endpoint": subscription.endpoint},
        {
            "$set": {
                "endpoint": subscription.endpoint,
                "keys": subscription.keys.model_dump(),
                "user_id": current_user["id"],
                "user_role": current_user.get("role", "user"),
                "preferences": prefs,
                "active": True,
                "updated_at": now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )
    return {"success": True, "message": "Push subscription registered"}


@router.delete("/unsubscribe")
async def unsubscribe(current_user: dict = Depends(get_current_user)):
    """Remove all push subscriptions for the current user."""
    result = await col("push_subscriptions").update_many(
        {"user_id": current_user["id"]},
        {"$set": {"active": False, "updated_at": datetime.now(timezone.utc)}},
    )
    return {"success": True, "removed": result.modified_count}


@router.put("/preferences")
async def update_preferences(
    preferences: NotificationPreferences,
    current_user: dict = Depends(get_current_user),
):
    """Update notification preferences for the current user."""
    await col("push_subscriptions").update_many(
        {"user_id": current_user["id"], "active": True},
        {"$set": {
            "preferences": preferences.model_dump(),
            "updated_at": datetime.now(timezone.utc),
        }},
    )
    return {"success": True}


@router.get("/preferences")
async def get_preferences(current_user: dict = Depends(get_current_user)):
    """Get the current user's notification preferences."""
    sub = await col("push_subscriptions").find_one(
        {"user_id": current_user["id"], "active": True}, NO_ID
    )
    if not sub:
        return NotificationPreferences().model_dump()
    return sub.get("preferences", NotificationPreferences().model_dump())


@router.post("/broadcast")
async def broadcast(
    message: BroadcastMessage,
    background_tasks: BackgroundTasks,
    current_user: dict = Depends(require_admin),
):
    """
    Send a push notification to all subscribed users (or filtered by role).
    Admin only. Runs as background task.
    """
    query = {"active": True, "preferences.system_announcements": True}
    if message.target_roles:
        query["user_role"] = {"$in": message.target_roles}

    subs = await col("push_subscriptions").find(query, NO_ID).to_list(length=1000)

    async def do_broadcast():
        sent = 0
        failed = 0
        for sub in subs:
            ok = send_push(sub, message.title, message.body, message.url or "/")
            if ok:
                sent += 1
            else:
                failed += 1

        await col("notification_logs").insert_one({
            "type": "broadcast",
            "title": message.title,
            "body": message.body,
            "target_roles": message.target_roles,
            "sent_count": sent,
            "failed_count": failed,
            "triggered_by": current_user["username"],
            "created_at": datetime.now(timezone.utc),
        })

    background_tasks.add_task(do_broadcast)
    return {"success": True, "queued": len(subs)}


@router.get("/logs")
async def notification_logs(
    limit: int = 20,
    current_user: dict = Depends(require_admin),
):
    """Recent notification broadcast history. Admin only."""
    logs = await (
        col("notification_logs")
        .find({}, NO_ID)
        .sort("created_at", -1)
        .limit(limit)
        .to_list(length=limit)
    )
    return {"logs": logs}
