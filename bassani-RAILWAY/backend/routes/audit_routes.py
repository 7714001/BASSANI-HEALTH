"""
Audit trail — read-only query API.

All audit entries are written via middleware.audit.audit_log(); this file
never writes, it only queries the audit_logs collection.
"""
from fastapi import APIRouter, Depends
from typing import Optional
from datetime import datetime
from auth import require_permission
from database import col, NO_ID
from middleware.audit import sanitize_for_json

router = APIRouter(prefix="/api/audit", tags=["audit"])


@router.get("/")
async def get_audit_log(
    entity_type: str = "",
    entity_id:   str = "",
    action:      str = "",
    actor:       str = "",
    reseller_id: str = "",
    date_from:   Optional[str] = None,   # ISO date, e.g. "2026-06-01"
    date_to:     Optional[str] = None,
    limit:       int = 100,
    offset:      int = 0,
    _: dict = Depends(require_permission("audit.view")),
):
    query: dict = {}
    if entity_type: query["entity_type"] = entity_type
    if entity_id:   query["entity_id"] = entity_id
    if action:      query["action"] = {"$regex": action, "$options": "i"}
    if actor:       query["actor_username"] = actor
    if reseller_id: query["reseller_id"] = reseller_id
    if date_from or date_to:
        date_range = {}
        if date_from: date_range["$gte"] = datetime.fromisoformat(date_from)
        if date_to:   date_range["$lte"] = datetime.fromisoformat(date_to)
        query["created_at"] = date_range

    total = await col("audit_logs").count_documents(query)
    logs = await (
        col("audit_logs")
        .find(query, NO_ID)
        .sort("created_at", -1)
        .skip(offset)
        .limit(limit)
        .to_list(limit)
    )
    # Sanitize on read too, not just on write (middleware/audit.py) — self-heals
    # historical rows written before that fix existed, without needing a data
    # migration or ever deleting audit history to work around a bad row.
    logs = [sanitize_for_json(log) for log in logs]
    return {"logs": logs, "total": total}


@router.get("/actions")
async def distinct_actions(_: dict = Depends(require_permission("audit.view"))):
    actions = await col("audit_logs").distinct("action")
    return {"actions": sorted(actions)}


@router.get("/actors")
async def distinct_actors(_: dict = Depends(require_permission("audit.view"))):
    actors = await col("audit_logs").distinct("actor_username")
    return {"actors": sorted(a for a in actors if a)}
