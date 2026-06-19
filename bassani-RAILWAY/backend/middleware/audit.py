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
from database import col


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
            "before":         before,
            "after":          after,
            "detail":         detail or {},
            "ip":             ip,
            "created_at":     datetime.now(timezone.utc),
        })
    except Exception as e:
        print(f"⚠️  Audit log failed: {e}")
