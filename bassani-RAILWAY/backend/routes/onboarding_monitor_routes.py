"""
Onboarding monitor — read-only live board for TV / big-screen display,
covering the customer onboarding application pipeline (Phase 8 companion to
monitor_routes.py's order-pipeline board). Same architecture, deliberately
copied rather than shared: a token in `portal_settings` (no login, URL
query-token only), admin generate/rotate, public validate + data.

No WebSocket live-push here (2026-08-21, deliberate scope trim vs. the order
monitor) — an application's stage doesn't change fast enough to need it, and
wiring a refresh-broadcast into every mutation across onboarding_routes.py
*and* public_routes.py's customer-signing endpoint is real surface area this
first version doesn't need. The 30s poll every monitor screen already falls
back to is enough; add WS the same way monitor_routes.py did if that ever
proves too slow in practice.

Public endpoints (token-verified, no login required):
  GET /api/onboarding-monitor/validate?token=   — check token validity
  GET /api/onboarding-monitor/data?token=       — full board data + KPIs

Admin endpoints (JWT):
  GET  /api/onboarding-monitor/token            — retrieve current token
  POST /api/onboarding-monitor/token            — generate / rotate token
"""
import secrets
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from auth import require_admin
from database import col

router = APIRouter(prefix="/api/onboarding-monitor", tags=["onboarding-monitor"])

NO_ID = {"_id": 0}

# Deadlines below are proposed defaults, not confirmed business policy — the
# 4h PENDING_REVIEW figure is the one real exception, reused verbatim from
# scheduler.py::check_stale_applications's existing escalation threshold so
# this column's "overdue" agrees with the escalation email that already
# fires at that exact point. The rest are first-pass estimates, easy to tune
# once real usage shows what's actually urgent.
_DEADLINES = {
    "pending_review":              4,
    "awaiting_docs":                48,
    "docs_generated":               24,
    "awaiting_signature":           72,
    "needs_countersigning":         24,
    "countersigning_in_progress":   24,
    "ready_to_approve":             24,
    "welcome_pack_pending":         24,
}

_BASSANI_SIG_DOC_TYPES = ("nda", "store_onboarding_agreement")


# ── Token helpers (identical shape to monitor_routes.py) ──────────────────────

async def _verify_token(token: str) -> bool:
    if not token:
        return False
    rec = await col("portal_settings").find_one({"_id": "onboarding_monitor_display_token"})
    return bool(rec and rec.get("token") == token)


@router.get("/token")
async def get_token(current_user: dict = Depends(require_admin)):
    rec = await col("portal_settings").find_one(
        {"_id": "onboarding_monitor_display_token"},
        {"token": 1, "rotated_at": 1, "_id": 0},
    )
    return {
        "token":      rec.get("token") if rec else None,
        "rotated_at": rec["rotated_at"].isoformat() if rec and rec.get("rotated_at") else None,
    }


@router.post("/token")
async def rotate_token(current_user: dict = Depends(require_admin)):
    token = secrets.token_urlsafe(32)
    now   = datetime.now(timezone.utc)
    await col("portal_settings").update_one(
        {"_id": "onboarding_monitor_display_token"},
        {"$set": {"token": token, "rotated_at": now}, "$setOnInsert": {"created_at": now}},
        upsert=True,
    )
    return {"token": token}


# ── Shared helpers ────────────────────────────────────────────────────────────

def _utc(dt: datetime) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _iso(dt) -> str | None:
    return _utc(dt).isoformat() if dt else None


def _parse_iso(s) -> datetime | None:
    """Several onboarding timestamps (documents[].uploaded_at/countersigned_at,
    welcome_pack_sent_at) are stored as ISO strings, not BSON dates, unlike
    submitted_at/signing_session_generated_at/signing_session_sent_at which
    are. Both shapes need to reach this monitor as real datetimes."""
    if not s:
        return None
    if isinstance(s, datetime):
        return _utc(s)
    try:
        return _utc(datetime.fromisoformat(s))
    except (ValueError, TypeError):
        return None


def _hours_elapsed(since: datetime) -> float:
    return (datetime.now(timezone.utc) - _utc(since)).total_seconds() / 3600


def _age_tier(elapsed: float, deadline: float) -> str:
    pct = elapsed / deadline
    if pct >= 1.0:   return "overdue"
    if pct >= 0.66:  return "urgent"
    if pct >= 0.33:  return "warning"
    return "ok"


def _clock_fallback(app: dict) -> datetime:
    """ObjectId embeds its own creation timestamp — a strictly more accurate
    fallback than "default to right now" (which would make a genuinely old,
    untouched application look brand new) for the rare doc missing every
    other timestamp this monitor looks for."""
    oid = app.get("_id")
    try:
        return _utc(oid.generation_time)
    except Exception:
        return datetime.now(timezone.utc)


# ── Stage derivation — Python port of CustomerApplications.js's deriveStatus() ─
# That function is the only other place this pipeline's real stages are
# computed, and it only ever ran client-side for the admin list page. Keep
# this in careful lockstep with that one; if it changes, this needs the
# matching update. "complete"/"welcome_pack_pending" are new here — the
# frontend's function stops at "approved", but the product owner's own
# completion definition (profile created *and* welcome pack sent) needed
# splitting that single status into two real, different monitor states.

def _derive_stage(app: dict) -> str:
    status = app.get("status")
    if status == "approved":
        return "complete" if app.get("welcome_pack_sent_at") else "welcome_pack_pending"
    if status == "rejected":
        return "rejected"
    if status == "awaiting_docs":
        return "awaiting_docs"

    documents = app.get("documents") or []
    bassani_docs = [
        d for d in documents
        if d.get("signed_in_portal") and d.get("doc_type") in _BASSANI_SIG_DOC_TYPES
    ]
    if len(bassani_docs) >= 2:
        signed_count = sum(1 for d in bassani_docs if d.get("countersigned_at"))
        if signed_count == 0:
            return "needs_countersigning"
        if signed_count < len(bassani_docs):
            return "countersigning_in_progress"
        return "ready_to_approve"

    if app.get("signing_session_sent_at"):
        return "awaiting_signature"
    if app.get("signing_session_token"):
        return "docs_generated"
    return "pending_review"


def _stage_clock(app: dict, stage: str) -> datetime:
    """Which timestamp started this application's current stage clock."""
    if stage == "pending_review":
        return app.get("submitted_at") or _clock_fallback(app)
    if stage == "awaiting_docs":
        return app.get("submitted_at") or app.get("created_at") or _clock_fallback(app)
    if stage == "docs_generated":
        return app.get("signing_session_generated_at") or _clock_fallback(app)
    if stage == "awaiting_signature":
        return app.get("signing_session_sent_at") or _clock_fallback(app)
    if stage in ("needs_countersigning", "countersigning_in_progress"):
        documents = app.get("documents") or []
        signed_at = [
            _parse_iso(d.get("uploaded_at")) for d in documents
            if d.get("signed_in_portal") and d.get("doc_type") in _BASSANI_SIG_DOC_TYPES
        ]
        signed_at = [d for d in signed_at if d]
        return max(signed_at) if signed_at else _clock_fallback(app)
    if stage == "ready_to_approve":
        documents = app.get("documents") or []
        counter_at = [
            _parse_iso(d.get("countersigned_at")) for d in documents
            if d.get("doc_type") in _BASSANI_SIG_DOC_TYPES
        ]
        counter_at = [d for d in counter_at if d]
        return max(counter_at) if counter_at else _clock_fallback(app)
    if stage == "welcome_pack_pending":
        return app.get("reviewed_at") or _clock_fallback(app)
    return _clock_fallback(app)


def _app_card(app: dict, stage: str) -> dict:
    clock   = _stage_clock(app, stage)
    deadline = _DEADLINES.get(stage, 24)
    elapsed  = _hours_elapsed(clock)
    return {
        "id":               app.get("id", ""),
        "company_name":     app.get("company_name") or app.get("contact_name") or "Unknown",
        "contact_name":     app.get("contact_name"),
        "reseller_name":    app.get("reseller_name"),
        "is_reseller":      bool(app.get("reseller_id")),
        "registration_type": app.get("registration_type") or "business",
        "source":           app.get("source") or "portal",
        "assigned_name":    (app.get("assigned_to") or {}).get("name"),
        "stage":            stage,
        "clock_start":      _iso(clock),
        "deadline_hours":   deadline,
        "hours_elapsed":    round(elapsed, 2),
        "age_tier":         _age_tier(elapsed, deadline),
    }


# ── Public: validate ──────────────────────────────────────────────────────────

@router.get("/validate")
async def validate_token(token: str = Query("")):
    if not await _verify_token(token):
        raise HTTPException(status_code=403, detail="Invalid monitor token")
    return {"valid": True}


# ── Public: full board data ───────────────────────────────────────────────────

_COLUMN_KEYS = [
    "pending_review", "awaiting_docs", "docs_generated", "awaiting_signature",
    "countersigning", "ready_to_approve", "welcome_pack_pending",
]


@router.get("/data")
async def get_onboarding_monitor_data(token: str = Query("")):
    if not await _verify_token(token):
        raise HTTPException(status_code=403, detail="Invalid monitor token")

    now         = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    # Single pass — no Odoo call, matching the order monitor's Mongo-only
    # design. Rejected applications are excluded entirely (not actionable,
    # same as the order monitor excluding cancelled orders).
    apps = await col("customer_onboarding").find(
        {"status": {"$ne": "rejected"}}, NO_ID,
    ).to_list(length=1000)

    columns: dict = {k: [] for k in _COLUMN_KEYS}
    completed_today = 0

    for app in apps:
        stage = _derive_stage(app)
        if stage == "complete":
            sent_at = _parse_iso(app.get("welcome_pack_sent_at"))
            if sent_at and sent_at >= today_start:
                completed_today += 1
            continue
        card = _app_card(app, stage)
        if stage in ("needs_countersigning", "countersigning_in_progress"):
            columns["countersigning"].append(card)
        elif stage in columns:
            columns[stage].append(card)

    for lst in columns.values():
        lst.sort(key=lambda c: c["hours_elapsed"], reverse=True)

    all_active   = [c for lst in columns.values() for c in lst]
    overdue      = sum(1 for c in all_active if c["age_tier"] == "overdue")
    at_risk      = sum(1 for c in all_active if c["age_tier"] == "urgent")
    oldest_hours = max((c["hours_elapsed"] for c in all_active), default=None)

    return {
        "kpis": {
            "overdue":               overdue,
            "at_risk":               at_risk,
            "awaiting_signing_authority": len(columns["countersigning"]),
            "completed_today":       completed_today,
            "pending_review":        len(columns["pending_review"]),
            "awaiting_docs":         len(columns["awaiting_docs"]),
            "docs_generated":        len(columns["docs_generated"]),
            "awaiting_signature":    len(columns["awaiting_signature"]),
            "countersigning":        len(columns["countersigning"]),
            "ready_to_approve":      len(columns["ready_to_approve"]),
            "welcome_pack_pending":  len(columns["welcome_pack_pending"]),
            "oldest_hours":          round(oldest_hours, 1) if oldest_hours is not None else None,
        },
        "columns": columns,
        "server_time": now.isoformat(),
    }
