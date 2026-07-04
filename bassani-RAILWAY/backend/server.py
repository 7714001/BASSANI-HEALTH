import os
import uuid
import time
import logging
from datetime import datetime, timezone
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from config import get_settings
from auth import hash_password, FULL_PERMISSIONS, ROLE_DEFAULT_PERMISSIONS
from rate_limit import limiter
from logging_config import setup_logging

setup_logging()
logger = logging.getLogger(__name__)

settings = get_settings()

# Fail fast — refuse to start with the placeholder JWT secret. A default secret
# means anyone can forge a valid token for any user, including super_admin.
if settings.jwt_secret == "change-me-in-production":
    raise RuntimeError(
        "JWT_SECRET is still the placeholder value. Set a real secret "
        "(32+ random characters) via the JWT_SECRET environment variable "
        "before starting. Generate one with: openssl rand -base64 48"
    )

import sentry_sdk
if settings.sentry_dsn:
    sentry_sdk.init(
        dsn=settings.sentry_dsn,
        traces_sample_rate=0.0,   # errors only — no performance tracing quota used
        send_default_pii=False,
    )
    logger.info("sentry_initialised")

app = FastAPI(title="Bassani Health Internal ERP", version="2.0.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def log_requests(request: Request, call_next):
    """Log every request with timing and best-effort user identification."""
    request_id = str(uuid.uuid4())[:8]
    start = time.monotonic()

    user_id = "anonymous"
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        try:
            from jose import jwt as jose_jwt
            payload = jose_jwt.decode(
                auth[7:], settings.jwt_secret,
                algorithms=[settings.jwt_algorithm],
                options={"verify_exp": False},
            )
            user_id = payload.get("sub", "unknown")
            sentry_sdk.set_user({"id": user_id, "username": payload.get("username", "unknown")})
        except Exception:
            pass

    response = await call_next(request)
    duration_ms = round((time.monotonic() - start) * 1000)

    logger.info("http_request", extra={
        "request_id": request_id,
        "method": request.method,
        "path": request.url.path,
        "status_code": response.status_code,
        "duration_ms": duration_ms,
        "user_id": user_id,
    })
    return response


@app.on_event("startup")
async def initialise_users():
    """
    On every startup:
    1. Ensure a super admin account exists (from SUPER_ADMIN_USERNAME/PASSWORD env vars).
    2. Migrate any existing admin users that predate the permissions system.
    """
    from database import col

    sa_username = settings.super_admin_username.strip()
    sa_password = settings.super_admin_password.strip()

    if sa_username and sa_password:
        existing = await col("users").find_one({"username": sa_username})
        sa_fields: dict = {
            "role": "super_admin",
            "is_super_admin": True,
            "active": True,
            "permissions": FULL_PERMISSIONS,
            "password": hash_password(sa_password),
        }
        if settings.super_admin_email:
            sa_fields["email"] = settings.super_admin_email
        if existing:
            await col("users").update_one(
                {"username": sa_username},
                {"$set": sa_fields},
            )
            logger.info("startup_super_admin_verified", extra={"username": sa_username})
        else:
            await col("users").insert_one({
                "username": sa_username,
                "name": "Super Admin",
                "created_at": datetime.now(timezone.utc),
                **sa_fields,
            })
            logger.info("startup_super_admin_created", extra={"username": sa_username})
    else:
        existing_sa = await col("users").find_one({"is_super_admin": True})
        if existing_sa:
            logger.info("startup_super_admin_found")
        else:
            count = await col("users").count_documents({})
            if count == 0:
                logger.warning("startup_no_users_no_env_vars",
                               extra={"hint": "Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD in Railway"})
            else:
                logger.warning("startup_no_super_admin",
                               extra={"hint": "Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD in Railway"})

    result = await col("users").update_many(
        {"role": "admin", "permissions": {"$exists": False}},
        {"$set": {"permissions": FULL_PERMISSIONS}},
    )
    if result.modified_count:
        logger.info("startup_migrated_admin_permissions", extra={"count": result.modified_count})

    result = await col("users").update_many(
        {"role": "admin", "permissions.audit": {"$exists": False}},
        {"$set": {"permissions.audit": {"view": False}}},
    )
    if result.modified_count:
        logger.info("startup_migrated_audit_permission", extra={"count": result.modified_count})

    # Migrate ticket-role accounts from the old single-key permissions object
    # ({"tickets": {"sales": True}}) to the full ROLE_DEFAULT_PERMISSIONS set.
    # Detection: old format has exactly one key ("tickets") in permissions.
    # Accounts that have already been extended by a super admin are left untouched.
    migrated_ticket = 0
    for role, defaults in ROLE_DEFAULT_PERMISSIONS.items():
        async for user in col("users").find({"role": role}):
            perms = user.get("permissions") or {}
            if list(perms.keys()) == ["tickets"]:  # old minimal format
                await col("users").update_one(
                    {"_id": user["_id"]},
                    {"$set": {"permissions": defaults}},
                )
                migrated_ticket += 1
    if migrated_ticket:
        logger.info("startup_migrated_ticket_role_permissions", extra={"count": migrated_ticket})

    # Backfill customers.manage: False on admin accounts that predate this key.
    result = await col("users").update_many(
        {"role": "admin", "permissions.customers.manage": {"$exists": False}},
        {"$set": {"permissions.customers.manage": False}},
    )
    if result.modified_count:
        logger.info("startup_migrated_customers_manage", extra={"count": result.modified_count})

    await col("audit_logs").create_index([("created_at", -1)])
    await col("audit_logs").create_index([("entity_type", 1), ("entity_id", 1)])
    await col("audit_logs").create_index([("actor_username", 1)])
    await col("audit_logs").create_index([("action", 1)])
    await col("audit_logs").create_index([("reseller_id", 1)])

    await col("warehouse_display_tokens").create_index([("warehouse_id", 1)], unique=True)
    await col("warehouse_display_tokens").create_index([("token", 1)], unique=True)
    await col("packing_board").create_index([("warehouse_id", 1)])

    await col("tickets").create_index([("type", 1), ("status", 1)])
    await col("tickets").create_index([("assigned_to", 1)])
    await col("tickets").create_index([("order_id", 1)])
    await col("tickets").create_index([("updated_at", -1)])

    await col("monthly_commission_statements").create_index(
        [("reseller_id", 1), ("year", 1), ("month", 1)],
        unique=True,
        name="unique_reseller_year_month",
    )

    # Phase 1.5 — OTP sessions (auto-expire via MongoDB TTL)
    await col("otp_sessions").create_index(
        [("expires_at", 1)], expireAfterSeconds=0, name="otp_sessions_ttl"
    )
    await col("otp_sessions").create_index(
        [("session_token", 1)], unique=True, sparse=True
    )

    result = await col("push_subscriptions").update_many(
        {"preferences.ticket_assigned": {"$exists": False}},
        {"$set": {"preferences.ticket_assigned": True, "preferences.ticket_handoff": True}},
    )
    if result.modified_count:
        logger.info("startup_migrated_push_preferences", extra={"count": result.modified_count})

    legacy_admin = await col("users").find_one({"username": "admin", "role": "admin"})
    if legacy_admin and not legacy_admin.get("is_super_admin") and legacy_admin.get("active", True):
        await col("users").update_one(
            {"_id": legacy_admin["_id"]},
            {"$set": {"active": False, "updated_at": datetime.now(timezone.utc)}},
        )
        logger.info("startup_deactivated_legacy_admin")

    # Phase 11 — backfill inbox permission for all users that predate it.
    # Admins/super_admins get view:True (they had full access before).
    # Sales role gets view:True (they are the primary inbox users).
    # All other roles get view:False by default (super_admin can grant explicitly).
    r = await col("users").update_many(
        {"role": {"$in": ["super_admin", "admin"]}, "permissions.inbox": {"$exists": False}},
        {"$set": {"permissions.inbox": {"view": True}}},
    )
    if r.modified_count:
        logger.info("startup_migrated_inbox_admin", extra={"count": r.modified_count})

    r = await col("users").update_many(
        {"role": "sales", "permissions.inbox": {"$exists": False}},
        {"$set": {"permissions.inbox": {"view": True}}},
    )
    if r.modified_count:
        logger.info("startup_migrated_inbox_sales", extra={"count": r.modified_count})

    r = await col("users").update_many(
        {"permissions.inbox": {"$exists": False}},
        {"$set": {"permissions.inbox": {"view": False}}},
    )
    if r.modified_count:
        logger.info("startup_migrated_inbox_other", extra={"count": r.modified_count})


@app.on_event("startup")
async def initialise_inbox():
    """Phase 11 — sales_inbox indexes, Graph subscription, and IMAP polling."""
    import asyncio
    from database import col
    from services.graph_client import graph_configured
    from services.graph_subscription import ensure_subscription
    from services.imap_client import load_config_from_db
    from routes.inbox_routes import _ingest_imap_message

    await col("sales_inbox").create_index([("received_at", -1)])
    await col("sales_inbox").create_index([("status", 1)])
    await col("sales_inbox").create_index(
        [("graph_message_id", 1)], unique=True, sparse=True
    )
    await col("sales_inbox").create_index([("graph_conversation_id", 1)])
    await col("sales_inbox").create_index(
        [("imap_message_id", 1)], unique=True, sparse=True
    )
    await col("sales_inbox").create_index([("thread_root_id", 1)])
    await col("sales_inbox").create_index([("from_email", 1)])
    await col("sales_inbox").create_index([("ticket_id", 1)])

    # Load IMAP credentials from MongoDB (falls back to env vars).
    # Must happen before graph/IMAP checks below.
    await load_config_from_db()

    # Create or renew the Graph push-notification subscription.
    # Skipped silently when MS credentials are not configured.
    await ensure_subscription()

    if graph_configured():
        async def _graph_renewal_loop():
            while True:
                await asyncio.sleep(12 * 3600)  # every 12 h — renewal threshold is 47 h
                try:
                    await ensure_subscription()
                except Exception as exc:
                    logger.error("graph_renewal_loop_error error=%s", exc)

        asyncio.create_task(_graph_renewal_loop())

    # Always start the IMAP poll loop. It checks whether IMAP is configured on
    # each iteration so a mailbox connected at runtime (via Settings > Mailbox)
    # starts being polled within 60 seconds without requiring a restart.
    async def _imap_poll_loop():
        while True:
            await asyncio.sleep(60)  # IMAP has no push — poll every 60 s
            from services.imap_client import imap_configured as _imap_ok, fetch_new_messages
            if not _imap_ok():
                continue
            try:
                msgs = await fetch_new_messages()
                for m in msgs:
                    try:
                        await _ingest_imap_message(m)
                    except Exception as exc:
                        logger.error("imap_ingest_error error=%s", exc)
            except Exception as exc:
                logger.error("imap_poll_loop_error error=%s", exc)

    asyncio.create_task(_imap_poll_loop())
    logger.info("imap_poll_loop_started interval_s=60")


@app.get("/health")
async def health():
    from database import col
    from odoo_client import get_odoo_client

    result: dict = {
        "status": "healthy",
        "version": "2.0.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "services": {},
    }

    try:
        await col("users").find_one({}, {"_id": 1})
        result["services"]["mongo"] = "up"
    except Exception as exc:
        result["services"]["mongo"] = "down"
        result["status"] = "down"
        logger.error("health_mongo_down", extra={"error": str(exc)})

    try:
        get_odoo_client().count("res.users", [])
        result["services"]["odoo"] = "up"
    except Exception as exc:
        result["services"]["odoo"] = "down"
        if result["status"] == "healthy":
            result["status"] = "degraded"
        logger.warning("health_odoo_down", extra={"error": str(exc)})

    status_code = 503 if result["status"] == "down" else 200
    return JSONResponse(result, status_code=status_code)


from routes.auth_routes          import router as auth_router
from routes.user_routes          import router as user_router
from routes.product_routes       import router as product_router
from routes.customer_routes      import router as customer_router
from routes.order_routes         import router as order_router
from routes.stock_routes         import router as stock_router
from routes.invoice_routes       import router as invoice_router
from routes.reseller_routes      import router as reseller_router
from routes.commission_routes    import router as commission_router
from routes.report_routes        import router as report_router
from routes.healthcare_routes    import router as healthcare_router
from routes.notification_routes  import router as notification_router
from routes.aged_debtors_routes  import router as aged_debtors_router
from routes.payment_routes       import router as payment_router
from routes.audit_routes         import router as audit_router
from routes.batch_routes         import router as batch_router
from routes.return_routes        import router as return_router
from routes.statement_routes     import router as statement_router
from routes.forecast_routes      import router as forecast_router
from routes.twofa_routes         import router as twofa_router
from routes.script_routes        import router as script_router
from routes.onboarding_routes    import router as onboarding_router
from routes.target_routes        import router as target_router
from routes.packing_board_routes import router as packing_board_router
from routes.warehouse_routes          import router as warehouse_router
from routes.ticket_routes             import router as ticket_router
from routes.inbox_routes              import router as inbox_router
from routes.reseller_catalog_routes   import router as reseller_catalog_router
from routes.supplier_routes           import router as supplier_router
from routes.settings_routes           import router as settings_router

for router in [
    auth_router, user_router, product_router, customer_router, order_router,
    stock_router, invoice_router, reseller_router, commission_router,
    report_router, healthcare_router, notification_router,
    aged_debtors_router, payment_router, audit_router, batch_router,
    return_router, statement_router, forecast_router, twofa_router,
    script_router, onboarding_router, packing_board_router, target_router,
    warehouse_router, ticket_router, inbox_router,
    reseller_catalog_router, supplier_router, settings_router,
]:
    app.include_router(router)

static_dir = os.path.join(os.path.dirname(__file__), "static")

if os.path.exists(static_dir):
    @app.get("/packing-board.html")
    async def packing_board_page():
        return FileResponse(os.path.join(static_dir, "packing-board.html"))

    @app.get("/supervisor.html")
    async def supervisor_page():
        return FileResponse(os.path.join(static_dir, "supervisor.html"))

    @app.get("/sw.js")
    async def service_worker():
        return FileResponse(os.path.join(static_dir, "sw.js"),
                            headers={"Cache-Control": "no-cache"})

    @app.get("/manifest.json")
    async def manifest():
        return FileResponse(os.path.join(static_dir, "manifest.json"))

    @app.get("/{full_path:path}")
    async def serve_spa(full_path: str):
        file_path = os.path.join(static_dir, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        return FileResponse(
            os.path.join(static_dir, "index.html"),
            headers={
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
                "Expires": "0",
            },
        )
