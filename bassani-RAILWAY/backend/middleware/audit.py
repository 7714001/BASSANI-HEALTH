"""
Audit trail — every significant action is logged with:
  who (user), what (action + entity), when (timestamp), detail (before/after).

Usage in routes:
    from middleware.audit import audit_log
    await audit_log(request, "invoice.create", "INV-34687", user=current_user)
"""
from datetime import datetime, timezone
from typing import Optional
from database import col


async def audit_log(
    action: str,          # e.g. "order.confirm", "invoice.cancel", "patient.assign"
    entity_id: str,       # e.g. "ORD-2026-127", "INV-34687"
    user: Optional[dict] = None,
    detail: Optional[dict] = None,   # {"before": ..., "after": ...}
    ip: Optional[str] = None,
):
    """Fire-and-forget audit entry. Never raises."""
    try:
        await col("audit_logs").insert_one({
            "action":    action,
            "entity_id": entity_id,
            "user":      user.get("username") if user else "system",
            "user_id":   user.get("id") if user else None,
            "detail":    detail or {},
            "ip":        ip,
            "timestamp": datetime.now(timezone.utc),
        })
    except Exception as e:
        print(f"⚠️  Audit log failed: {e}")
