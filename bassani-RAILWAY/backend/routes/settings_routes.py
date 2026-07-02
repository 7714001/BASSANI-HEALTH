"""
Portal settings — email routing config (super_admin only).

The get_email_routing() helper is imported by other routes that need to
resolve recipients at send time. It reads from MongoDB first, falling
back to the support_email env var default.
"""
from fastapi import APIRouter, HTTPException, Depends
from typing import List
from pydantic import BaseModel
from auth import get_current_user
from database import col
from config import get_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])
settings = get_settings()


class EmailRoutingConfig(BaseModel):
    application_submitted_to: List[str] = []
    order_ready_extra_to:     List[str] = []
    order_cc:                 List[str] = []


async def get_email_routing() -> dict:
    """Return the active email routing config, falling back to env-var defaults."""
    doc = await col("portal_settings").find_one({"_id": "email_routing"})
    if not doc:
        return {
            "application_submitted_to": [settings.support_email],
            "order_ready_extra_to": [],
            "order_cc": [],
        }
    return {
        "application_submitted_to": doc.get("application_submitted_to") or [settings.support_email],
        "order_ready_extra_to":     doc.get("order_ready_extra_to", []),
        "order_cc":                 doc.get("order_cc", []),
    }


def _require_super_admin(current_user: dict = Depends(get_current_user)) -> dict:
    if not current_user.get("is_super_admin"):
        raise HTTPException(status_code=403, detail="Super admin access required")
    return current_user


@router.get("/email-routing")
async def get_email_routing_config(_: dict = Depends(_require_super_admin)):
    return await get_email_routing()


@router.put("/email-routing")
async def update_email_routing_config(
    body: EmailRoutingConfig,
    _: dict = Depends(_require_super_admin),
):
    await col("portal_settings").update_one(
        {"_id": "email_routing"},
        {"$set": body.model_dump()},
        upsert=True,
    )
    return {"success": True}
