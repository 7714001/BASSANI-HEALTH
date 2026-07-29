"""
Audit trail — single canonical writer for every significant action.

Who (actor), what (action + entity), when (created_at), before/after state.
Reads happen via routes/audit_routes.py — that file never writes.

Usage:
    from middleware.audit import audit_log
    await audit_log("order.confirm", "order", order_id, entity_label=order_ref,
                     user=current_user, before=before_state, after=after_state)
"""
from datetime import datetime, timezone
from typing import Optional, Any
from bson import ObjectId
from database import col


def sanitize_for_json(value: Any) -> Any:
    """Recursively convert raw ObjectId values into strings.

    before/after/detail are freeform — callers sometimes pass a dict straight
    out of an insert_one() call, and pymongo mutates that dict in place to add
    a raw ObjectId `_id` key (see parent_category_routes.py's create endpoint,
    fixed 2026-07-30, for the bug this caused: it stores into Mongo fine, since
    BSON supports ObjectId natively, but FastAPI's jsonable_encoder can't
    serialize a raw ObjectId back out, so the whole audit list 500s the moment
    a row like this is read). Applied both at write time here and again at read
    time in audit_routes.py, so already-broken historical rows self-heal on
    the next read too, rather than needing a data migration.
    """
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, dict):
        return {k: sanitize_for_json(v) for k, v in value.items()}
    if isinstance(value, list):
        return [sanitize_for_json(v) for v in value]
    return value


async def audit_log(
    action: str,             # e.g. "order.confirm", "user.permissions_changed"
    entity_type: str,        # e.g. "order", "invoice", "user", "packing_board"
    entity_id: str,
    entity_label: str = "",  # human-readable label, e.g. order ref or customer name
    user: Optional[dict] = None,
    before: Optional[Any] = None,
    after: Optional[Any] = None,
    detail: Optional[dict] = None,
    ip: Optional[str] = None,
    reseller_id: Optional[str] = None,  # set whenever the action relates to a specific reseller,
                                         # regardless of entity_type — powers the per-reseller activity view
):
    """Fire-and-forget audit entry. Never raises."""
    try:
        await col("audit_logs").insert_one({
            "action":         action,
            "entity_type":    entity_type,
            "entity_id":      str(entity_id),
            "entity_label":   entity_label,
            "actor_username": user.get("username") if user else "system",
            "actor_id":       user.get("id") if user else None,
            "actor_role":     user.get("role") if user else None,
            "reseller_id":    reseller_id,
            "before":         sanitize_for_json(before),
            "after":          sanitize_for_json(after),
            "detail":         sanitize_for_json(detail) or {},
            "ip":             ip,
            "created_at":     datetime.now(timezone.utc),
        })
    except Exception as e:
        print(f"⚠️  Audit log failed: {e}")
