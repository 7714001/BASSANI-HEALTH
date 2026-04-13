import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse
from config import get_settings

settings = get_settings()

app = FastAPI(title="Bassani Health Internal ERP", version="2.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/health")
def health():
    return JSONResponse({"status": "ok", "version": "2.0.0"})

from routes.auth_routes          import router as auth_router
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
from routes.packing_board_routes import router as packing_board_router

for router in [
    auth_router, product_router, customer_router, order_router,
    stock_router, invoice_router, reseller_router, commission_router,
    report_router, healthcare_router, notification_router,
    aged_debtors_router, payment_router, audit_router, batch_router,
    return_router, statement_router, forecast_router, twofa_router,
    script_router, packing_board_router,
]:
    app.include_router(router)

static_dir = os.path.join(os.path.dirname(__file__), "static")

if os.path.exists(static_dir):
    react_static = os.path.join(static_dir, "static")
    if os.path.exists(react_static):
        app.mount("/static", StaticFiles(directory=react_static), name="static-assets")

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
    async def spa_fallback(full_path: str):
        index = os.path.join(static_dir, "index.html")
        if os.path.exists(index):
            return FileResponse(index)
        return JSONResponse({"error": "Frontend not built yet"})
