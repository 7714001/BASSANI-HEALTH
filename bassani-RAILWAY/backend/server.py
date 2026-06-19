import os
from datetime import datetime, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from config import get_settings
from auth import hash_password, FULL_PERMISSIONS
from rate_limit import limiter

settings = get_settings()

# Fail fast — refuse to start with the placeholder JWT secret. A default secret
# means anyone can forge a valid token for any user, including super_admin.
if settings.jwt_secret == "change-me-in-production":
    raise RuntimeError(
        "JWT_SECRET is still the placeholder value. Set a real secret "
        "(32+ random characters) via the JWT_SECRET environment variable "
        "before starting. Generate one with: openssl rand -base64 48"
    )

app = FastAPI(title="Bassani Health Internal ERP", version="2.0.0")

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def initialise_users():
    """
    On every startup:
    1. Ensure a super admin account exists (from SUPER_ADMIN_USERNAME/PASSWORD env vars).
    2. Migrate any existing admin users that predate the permissions system.

    If env vars are not set and no super admin exists yet, the app logs a clear
    warning but does not crash — existing accounts remain accessible.
    """
    from database import col

    sa_username = settings.super_admin_username.strip()
    sa_password = settings.super_admin_password.strip()

    if sa_username and sa_password:
        existing = await col("users").find_one({"username": sa_username})
        if existing:
            # Sync credentials and role from env vars (idempotent on re-deploy)
            await col("users").update_one(
                {"username": sa_username},
                {"$set": {
                    "role": "super_admin",
                    "is_super_admin": True,
                    "active": True,
                    "permissions": FULL_PERMISSIONS,
                    "password": hash_password(sa_password),
                }},
            )
            print(f"[startup] Super admin '{sa_username}' verified.")
        else:
            await col("users").insert_one({
                "username": sa_username,
                "password": hash_password(sa_password),
                "role": "super_admin",
                "is_super_admin": True,
                "name": "Super Admin",
                "active": True,
                "permissions": FULL_PERMISSIONS,
                "created_at": datetime.now(timezone.utc),
            })
            print(f"[startup] Super admin '{sa_username}' created.")
    else:
        existing_sa = await col("users").find_one({"is_super_admin": True})
        if existing_sa:
            print("[startup] SUPER_ADMIN_USERNAME not set — using existing super admin.")
        else:
            count = await col("users").count_documents({})
            if count == 0:
                print(
                    "[startup] WARNING: No users exist and SUPER_ADMIN_USERNAME/SUPER_ADMIN_PASSWORD "
                    "are not set. Add these env vars to Railway and redeploy to create the super admin account."
                )
            else:
                print(
                    "[startup] WARNING: SUPER_ADMIN_USERNAME not set and no super admin account found. "
                    "Set SUPER_ADMIN_USERNAME and SUPER_ADMIN_PASSWORD in Railway env vars."
                )

    # Migration: give FULL_PERMISSIONS to any admin user that predates the permissions system
    result = await col("users").update_many(
        {"role": "admin", "permissions": {"$exists": False}},
        {"$set": {"permissions": FULL_PERMISSIONS}},
    )
    if result.modified_count:
        print(f"[startup] Migrated {result.modified_count} existing admin user(s) to full permissions.")

    # Migration: give every admin user the audit.view permission key (default false)
    # so the Audit Trail panel renders correctly for accounts created before 0.6.
    result = await col("users").update_many(
        {"role": "admin", "permissions.audit": {"$exists": False}},
        {"$set": {"permissions.audit": {"view": False}}},
    )
    if result.modified_count:
        print(f"[startup] Added default audit.view=False to {result.modified_count} existing admin user(s).")

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

    # Migration: backfill the two new Phase 8 notification preference keys for
    # subscriptions created before they existed, defaulting to opted-in.
    result = await col("push_subscriptions").update_many(
        {"preferences.ticket_assigned": {"$exists": False}},
        {"$set": {"preferences.ticket_assigned": True, "preferences.ticket_handoff": True}},
    )
    if result.modified_count:
        print(f"[startup] Added Phase 8 ticket notification preferences to {result.modified_count} existing subscription(s).")

    # Deactivate the legacy "admin" / "admin123" account that predates the
    # credential overhaul (Phase 0.1) — it may still exist in older databases.
    legacy_admin = await col("users").find_one({"username": "admin", "role": "admin"})
    if legacy_admin and not legacy_admin.get("is_super_admin") and legacy_admin.get("active", True):
        await col("users").update_one(
            {"_id": legacy_admin["_id"]},
            {"$set": {"active": False, "updated_at": datetime.now(timezone.utc)}},
        )
        print("[startup] Deactivated legacy 'admin' account — superseded by the super admin/permissions system.")


@app.get("/health")
def health():
    return JSONResponse({"status": "ok", "version": "2.0.0"})


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
from routes.warehouse_routes      import router as warehouse_router
from routes.ticket_routes         import router as ticket_router

for router in [
    auth_router, user_router, product_router, customer_router, order_router,
    stock_router, invoice_router, reseller_router, commission_router,
    report_router, healthcare_router, notification_router,
    aged_debtors_router, payment_router, audit_router, batch_router,
    return_router, statement_router, forecast_router, twofa_router,
    script_router, onboarding_router, packing_board_router, target_router,
    warehouse_router, ticket_router,
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
