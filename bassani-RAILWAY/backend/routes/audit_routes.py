"""Audit trail — every significant action logged with user, timestamp, diff."""
from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from typing import Optional, Any
from datetime import datetime, timezone
from auth import require_admin, get_current_user
from database import col, NO_ID

router = APIRouter(prefix="/api/audit", tags=["audit"])

class AuditEvent(BaseModel):
    action: str                  # e.g. ORDER_CREATED, INVOICE_GENERATED, ORDER_CANCELLED
    entity_type: str             # order | invoice | customer | product | patient | reseller
    entity_id: str
    entity_label: str = ""
    before: Optional[Any] = None
    after: Optional[Any] = None
    notes: str = ""

async def log_audit(
    action: str, entity_type: str, entity_id: str,
    entity_label: str = "", before: Any = None, after: Any = None,
    user: dict = None, notes: str = "", request: Request = None
):
    """Call this from any route to write an audit record."""
    await col("audit_logs").insert_one({
        "action":       action,
        "entity_type":  entity_type,
        "entity_id":    str(entity_id),
        "entity_label": entity_label,
        "before":       before,
        "after":        after,
        "notes":        notes,
        "user":         user.get("username","system") if user else "system",
        "user_role":    user.get("role","") if user else "",
        "ip":           request.client.host if request and request.client else "—",
        "created_at":   datetime.now(timezone.utc),
    })

@router.get("/")
async def get_audit_log(
    entity_type: str = "", entity_id: str = "", action: str = "",
    limit: int = 100, _: dict = Depends(require_admin)
):
    query = {}
    if entity_type: query["entity_type"] = entity_type
    if entity_id:   query["entity_id"]   = entity_id
    if action:      query["action"]       = {"$regex": action, "$options":"i"}
    logs = await col("audit_logs").find(query,NO_ID).sort("created_at",-1).limit(limit).to_list(limit)
    return {"logs": logs, "total": len(logs)}

@router.get("/actions")
async def distinct_actions(_: dict = Depends(require_admin)):
    actions = await col("audit_logs").distinct("action")
    return {"actions": sorted(actions)}

@router.post("/log")
async def manual_log(event: AuditEvent, current_user: dict = Depends(require_admin)):
    """Manually post an audit event (for testing or admin notes)."""
    await log_audit(event.action, event.entity_type, event.entity_id,
                    event.entity_label, event.before, event.after,
                    user=current_user, notes=event.notes)
    return {"success": True}
