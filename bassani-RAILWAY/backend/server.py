"""Bassani Health — FastAPI application entry point."""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from database import init_db
from config import get_settings

# ── Routers ────────────────────────────────────────────────────────────────
from routes.auth_routes         import router as auth_router
from routes.product_routes      import router as product_router
from routes.customer_routes     import router as customer_router
from routes.order_routes        import router as order_router
from routes.stock_routes        import router as stock_router
from routes.invoice_routes      import router as invoice_router
from routes.reseller_routes     import router as reseller_router
from routes.commission_routes   import router as commission_router
from routes.report_routes       import router as report_router
from routes.healthcare_routes   import router as healthcare_router
from routes.notification_routes import router as notification_router
from routes.aged_debtors_routes import router as aged_debtors_router
from routes.payment_routes      import router as payment_router
from routes.audit_routes        import router as audit_router
from routes.batch_routes        import router as batch_router
from routes.return_routes       import router as return_router
from routes.statement_routes    import router as statement_router
from routes.forecast_routes     import router as forecast_router
from routes.twofa_routes        import router as twofa_router
from routes.script_routes       import router as script_router

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    await _seed()
    yield


async def _seed():
    """Seed admin and demo resellers on first run."""
    from database import col
    from auth import hash_password
    import uuid

    if not await col("users").find_one({"username": "admin"}):
        await col("users").insert_one({
            "id": str(uuid.uuid4()), "username": "admin",
            "password": hash_password("admin123"),
            "role": "admin", "active": True,
            "totp_enabled": False,
        })
        print("✅ Admin user seeded")

    demo_resellers = [
        {"name":"Joe's Distribution","seller_code":"JOE001","type":"Distributor",
         "contact_person":"Joe Smith","email":"joe@joesdist.co.za","phone":"+27 21 555 0001",
         "commission_rates":{"Flower":15,"Tinctures":12,"Vapes":18,"Edibles":10,"Topicals":10,"Accessories":20}},
        {"name":"Cape Distributors","seller_code":"CAPE01","type":"Distributor",
         "contact_person":"Anna Brink","email":"anna@capedist.co.za","phone":"+27 21 555 0002",
         "commission_rates":{"Flower":13,"Tinctures":13,"Vapes":15,"Edibles":12,"Topicals":11,"Accessories":18}},
        {"name":"PTA Agents","seller_code":"PTA001","type":"Agent",
         "contact_person":"Sipho Ndlovu","email":"sipho@ptaagents.co.za","phone":"+27 12 555 0003",
         "commission_rates":{"Flower":10,"Tinctures":11,"Vapes":12,"Edibles":10,"Topicals":10,"Accessories":15}},
        {"name":"KZN Brokers","seller_code":"KZN001","type":"Broker",
         "contact_person":"Priya Naidoo","email":"priya@kznbrokers.co.za","phone":"+27 31 555 0004",
         "commission_rates":{"Flower":12,"Tinctures":11,"Vapes":14,"Edibles":10,"Topicals":10,"Accessories":16}},
    ]
    for r in demo_resellers:
        if not await col("resellers").find_one({"seller_code": r["seller_code"]}):
            await col("resellers").insert_one({
                "id": str(uuid.uuid4()), **r,
                "active": True, "total_sales": 0, "total_commission": 0,
            })

    # Seed default settings
    if not await col("settings").find_one({"key": "next_doc_number"}):
        await col("settings").insert_one({"key": "next_doc_number", "value": settings.doc_number_start})
        print(f"✅ Document numbering seeded at {settings.doc_number_start}")


# ── App ────────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Bassani Health Internal ERP",
    version="2.0.0",
    description="Full-stack ERP for Bassani Health — Odoo + MongoDB",
    lifespan=lifespan,
)

# CORS
origins = [o.strip() for o in settings.cors_origins.split(",")]
app.add_middleware(CORSMiddleware, allow_origins=origins,
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])

# ── Route registration ─────────────────────────────────────────────────────
for router in [
    auth_router, product_router, customer_router, order_router,
    stock_router, invoice_router, reseller_router, commission_router,
    report_router, healthcare_router, notification_router,
    aged_debtors_router, payment_router, audit_router, batch_router,
    return_router, statement_router, forecast_router, twofa_router, script_router,
]:
    app.include_router(router)


@app.get("/health")
def health():
    return {"status": "ok", "version": "2.0.0"}


# ── Serve React frontend ────────────────────────────────────────────────────
frontend_build = os.path.join(os.path.dirname(__file__), "..", "frontend", "build")
if os.path.exists(frontend_build):
    app.mount("/", StaticFiles(directory=frontend_build, html=True), name="frontend")

# Packing board
from routes.packing_board_routes import router as packing_board_router
app.include_router(packing_board_router)

# ── Serve React build + public files ─────────────────────────────────────────
import os
from fastapi.staticfiles import StaticFiles
from fastapi.responses    import FileResponse

static_dir = os.path.join(os.path.dirname(__file__), "static")
if os.path.exists(static_dir):
    # Serve React build
    app.mount("/static", StaticFiles(directory=static_dir), name="static")
    # Serve packing board and supervisor as standalone pages
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
    # SPA catch-all — all unknown routes → index.html
    @app.get("/{full_path:path}")
    async def spa_fallback(full_path: str):
        index = os.path.join(static_dir, "index.html")
        if os.path.exists(index):
            return FileResponse(index)
        return {"error": "Frontend not built yet"}
