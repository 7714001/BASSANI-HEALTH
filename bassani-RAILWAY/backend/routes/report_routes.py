from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timezone, date, timedelta
import calendar as _cal
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from database import col, NO_ID
from warehouse_context import odoo_context

router = APIRouter(prefix="/api/reports", tags=["reports"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def first_day_of_month(year: int, month: int) -> datetime:
    return datetime(year, month, 1, tzinfo=timezone.utc)

def last_day_of_month(year: int, month: int) -> datetime:
    if month == 12:
        return datetime(year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(seconds=1)
    return datetime(year, month + 1, 1, tzinfo=timezone.utc) - timedelta(seconds=1)

def financial_year_bounds(today: date) -> tuple:
    """
    SA financial year: 1 March → last day of February the following year.
    Returns (fy_start datetime, fy_end datetime, label str).
    """
    fy_start_year = today.year if today.month >= 3 else today.year - 1
    fy_end_year   = fy_start_year + 1
    fy_start = datetime(fy_start_year, 3, 1, tzinfo=timezone.utc)
    fy_end   = datetime(fy_end_year, 2, _cal.monthrange(fy_end_year, 2)[1], 23, 59, 59, tzinfo=timezone.utc)
    label    = f"FY{fy_start_year}/{str(fy_end_year)[2:]}"
    return fy_start, fy_end, label

def odoo_date_domain(field: str, from_date: str, to_date: str) -> list:
    """Build Odoo domain for date range filtering."""
    return [
        (field, ">=", from_date),
        (field, "<=", to_date),
    ]

def parse_date_str(s: str, end_of_day: bool = False) -> datetime:
    """Parse YYYY-MM-DD string to UTC datetime."""
    d = datetime.strptime(s, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    if end_of_day:
        d = d.replace(hour=23, minute=59, second=59)
    return d

# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard_stats(current_user: dict = Depends(get_current_user)):
    """
    Master dashboard — KPIs from Odoo + commission totals from MongoDB.
    Resellers see only their own data. Admins see everything.
    """
    odoo = get_odoo_client()
    today = date.today()
    month_start = first_day_of_month(today.year, today.month).strftime("%Y-%m-%d")
    month_end = last_day_of_month(today.year, today.month).strftime("%Y-%m-%d")
    warehouse_id = current_user.get("active_warehouse_id")
    ctx = odoo_context(warehouse_id)

    try:
        total_products = odoo.count(
            "product.template",
            [("type", "in", ["product", "consu"]), ("active", "=", True)]
        )
        low_stock = odoo.count(
            "product.product",
            [("type", "=", "product"), ("virtual_available", "<", 10), ("active", "=", True)],
            context=ctx,
        )
        low_stock_products = odoo.search_read(
            "product.product",
            domain=[("type", "=", "product"), ("virtual_available", "<", 10), ("active", "=", True)],
            fields=["id", "name", "virtual_available", "uom_id", "categ_id"],
            limit=5,
            order="name asc",
            context=ctx,
        )

        # ── Reseller dashboard ────────────────────────────────────────────────
        if current_user.get("role") == "reseller":
            reseller = await col("resellers").find_one(
                {"user_id": current_user["id"]}, NO_ID
            )
            reseller_id = reseller["id"] if reseller else None
            odoo_partner_id = reseller.get("odoo_partner_id") if reseller else None

            commission_records = await col("order_commissions").find(
                {"reseller_id": reseller_id}, NO_ID
            ).to_list(length=10000)
            allowed_odoo_ids = [int(r["odoo_order_id"]) for r in commission_records]

            # Fetch outstanding invoices for this reseller's Odoo partner
            unpaid_invoices = 0
            overdue_amount = 0.0
            if odoo_partner_id:
                try:
                    invoice_domain = [
                        ("move_type", "=", "out_invoice"),
                        ("payment_state", "in", ["not_paid", "partial"]),
                        ("state", "=", "posted"),
                        ("partner_id", "=", odoo_partner_id),
                    ]
                    unpaid_invoices = odoo.count("account.move", invoice_domain)
                    invoice_data = odoo.search_read(
                        "account.move",
                        domain=invoice_domain,
                        fields=["amount_residual"],
                        limit=500,
                    )
                    overdue_amount = sum(i["amount_residual"] for i in invoice_data)
                except Exception:
                    pass

            if not allowed_odoo_ids:
                return {
                    "products": {"total": total_products, "low_stock": low_stock},
                    "orders": {"total": 0, "this_month": 0, "month_revenue": 0.0},
                    "customers": {"active": 0},
                    "commission": {"due_this_month": 0.0},
                    "invoices": {"unpaid": unpaid_invoices, "overdue_amount": overdue_amount},
                    "recent_orders": [],
                    "low_stock_products": low_stock_products,
                }

            reseller_month_orders = odoo.search_read(
                "sale.order",
                domain=[
                    ("id", "in", allowed_odoo_ids),
                    ("state", "in", ["sale", "done"]),
                    ("date_order", ">=", month_start),
                    ("date_order", "<=", month_end),
                ],
                fields=["amount_total"],
                limit=5000,
            )
            recent_orders = odoo.search_read(
                "sale.order",
                domain=[("id", "in", allowed_odoo_ids)],
                fields=["id", "name", "partner_id", "amount_total", "state", "date_order"],
                limit=5,
                order="date_order desc",
            )

            pipeline = [
                {"$match": {
                    "reseller_id": reseller_id,
                    "created_at": {
                        "$gte": first_day_of_month(today.year, today.month),
                        "$lte": last_day_of_month(today.year, today.month),
                    },
                }},
                {"$group": {"_id": None, "total": {"$sum": "$commission_total"}}},
            ]
            result = await col("order_commissions").aggregate(pipeline).to_list(1)
            commission_due = result[0]["total"] if result else 0

            return {
                "products": {"total": total_products, "low_stock": low_stock},
                "orders": {
                    "total": len(allowed_odoo_ids),
                    "this_month": len(reseller_month_orders),
                    "month_revenue": sum(o["amount_total"] for o in reseller_month_orders),
                },
                "customers": {"active": 0},
                "commission": {"due_this_month": commission_due},
                "invoices": {"unpaid": unpaid_invoices, "overdue_amount": overdue_amount},
                "recent_orders": recent_orders,
                "low_stock_products": low_stock_products,
            }

        # ── Admin dashboard ───────────────────────────────────────────────────
        tomorrow = today + timedelta(days=1)
        today_str    = today.strftime("%Y-%m-%d")
        tomorrow_str = tomorrow.strftime("%Y-%m-%d")

        month_orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", month_start),
                ("date_order", "<=", month_end),
            ],
            fields=["id", "amount_total"],
            limit=5000,
        )
        month_revenue = sum(o["amount_total"] for o in month_orders)
        total_orders = odoo.count("sale.order", [])
        active_customers = odoo.count("res.partner", [("customer_rank", ">", 0), ("active", "=", True)])

        today_orders_count = odoo.count("sale.order", [
            ("date_order", ">=", today_str + " 00:00:00"),
            ("date_order", "<",  tomorrow_str + " 00:00:00"),
        ])
        draft_data = odoo.search_read(
            "sale.order",
            domain=[("state", "=", "draft")],
            fields=["amount_total"],
            limit=5000,
        )
        confirmed_data = odoo.search_read(
            "sale.order",
            domain=[("state", "=", "sale")],
            fields=["amount_total"],
            limit=5000,
        )

        unpaid_invoices = odoo.count(
            "account.move",
            [("move_type", "=", "out_invoice"), ("payment_state", "=", "not_paid"), ("state", "=", "posted")]
        )
        overdue_data = odoo.search_read(
            "account.move",
            domain=[
                ("move_type", "=", "out_invoice"),
                ("payment_state", "=", "not_paid"),
                ("state", "=", "posted"),
            ],
            fields=["amount_residual"],
            limit=5000,
        )
        overdue_amount = sum(i["amount_residual"] for i in overdue_data)

        recent_orders = odoo.search_read(
            "sale.order",
            domain=[],
            fields=["id", "name", "partner_id", "amount_total", "state", "date_order"],
            limit=5,
            order="date_order desc",
        )

        pipeline = [
            {"$match": {
                "created_at": {
                    "$gte": first_day_of_month(today.year, today.month),
                    "$lte": last_day_of_month(today.year, today.month),
                }
            }},
            {"$group": {"_id": None, "total": {"$sum": "$commission_total"}}},
        ]
        result = await col("order_commissions").aggregate(pipeline).to_list(1)
        commission_due = result[0]["total"] if result else 0

        # ── Channel KPIs: Bassani direct vs Reseller ──────────────────────────
        fy_start, fy_end, fy_label = financial_year_bounds(today)

        # FY confirmed orders from Odoo
        fy_orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", fy_start.strftime("%Y-%m-%d")),
                ("date_order", "<=", fy_end.strftime("%Y-%m-%d")),
            ],
            fields=["id", "amount_total"],
            limit=10000,
        )

        # All reseller order IDs ever — used to classify any order
        reseller_odoo_ids: set = set()
        async for doc in col("order_commissions").find({}, {"odoo_order_id": 1, "_id": 0}):
            reseller_odoo_ids.add(str(doc["odoo_order_id"]))

        # Split FY orders
        fy_bassani  = [o for o in fy_orders if str(o["id"]) not in reseller_odoo_ids]
        fy_reseller = [o for o in fy_orders if str(o["id"]) in reseller_odoo_ids]

        # Split month orders (already fetched above, now has id field)
        month_bassani  = [o for o in month_orders if str(o["id"]) not in reseller_odoo_ids]
        month_reseller = [o for o in month_orders if str(o["id"]) in reseller_odoo_ids]

        return {
            "products": {"total": total_products, "low_stock": low_stock},
            "orders": {
                "total": total_orders,
                "this_month": len(month_orders),
                "month_revenue": month_revenue,
            },
            "customers": {"active": active_customers},
            "invoices": {"unpaid": unpaid_invoices, "overdue_amount": overdue_amount},
            "commission": {"due_this_month": commission_due},
            "pipeline": {
                "today": today_orders_count,
                "draft_count": len(draft_data),
                "draft_value": sum(o["amount_total"] for o in draft_data),
                "confirmed_count": len(confirmed_data),
                "confirmed_value": sum(o["amount_total"] for o in confirmed_data),
            },
            "channel_kpis": {
                "fy_label": fy_label,
                "bassani": {
                    "fy_orders": len(fy_bassani),
                    "fy_value": round(sum(o["amount_total"] for o in fy_bassani), 2),
                    "month_orders": len(month_bassani),
                    "month_value": round(sum(o["amount_total"] for o in month_bassani), 2),
                },
                "reseller": {
                    "fy_orders": len(fy_reseller),
                    "fy_value": round(sum(o["amount_total"] for o in fy_reseller), 2),
                    "month_orders": len(month_reseller),
                    "month_value": round(sum(o["amount_total"] for o in month_reseller), 2),
                },
            },
            "recent_orders": recent_orders,
            "low_stock_products": low_stock_products,
        }

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Report error: {str(e)}")


# ── Monthly Turnover ──────────────────────────────────────────────────────────

@router.get("/monthly-turnover")
async def monthly_turnover(
    year: int = Query(default=None),
    month: int = Query(default=None),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(require_admin),
):
    """
    Monthly revenue split — direct vs reseller sales.
    Accepts either year/month or from_date/to_date (ISO date strings) for range mode.
    """
    odoo = get_odoo_client()
    warehouse_id = current_user.get("active_warehouse_id")
    today = date.today()
    if from_date and to_date:
        _from, _to = from_date, to_date
        _from_dt = parse_date_str(from_date)
        _to_dt   = parse_date_str(to_date, end_of_day=True)
    else:
        year  = year  or today.year
        month = month or today.month
        _from = first_day_of_month(year, month).strftime("%Y-%m-%d")
        _to   = last_day_of_month(year, month).strftime("%Y-%m-%d")
        _from_dt = first_day_of_month(year, month)
        _to_dt   = last_day_of_month(year, month)

    _wh_filter = [("warehouse_id", "=", warehouse_id)] if warehouse_id else []

    try:
        # All confirmed orders in the period from Odoo, scoped to selected warehouse
        orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                *odoo_date_domain("date_order", _from, _to),
                *_wh_filter,
            ],
            fields=["id", "name", "amount_untaxed", "amount_tax", "amount_total", "date_order"],
            limit=5000,
        )

        total_revenue  = sum(o["amount_total"]   for o in orders)
        total_subtotal = sum(o["amount_untaxed"] for o in orders)
        total_vat      = sum(o["amount_tax"]     for o in orders)

        # Commission from MongoDB — scoped to the warehouse-filtered order IDs
        order_id_strs = [str(o["id"]) for o in orders]
        comm_match: dict = {"created_at": {"$gte": _from_dt, "$lte": _to_dt}}
        if warehouse_id:
            comm_match["odoo_order_id"] = {"$in": order_id_strs}

        pipeline = [
            {"$match": comm_match},
            {
                "$group": {
                    "_id": "$reseller_id",
                    "reseller_name": {"$first": "$reseller_name"},
                    "commission_total": {"$sum": "$commission_total"},
                    "order_count": {"$sum": 1},
                }
            },
        ]
        commission_by_reseller = await col("order_commissions").aggregate(pipeline).to_list(100)
        total_commission = sum(r["commission_total"] for r in commission_by_reseller)

        # Reseller vs direct split (cross-reference with warehouse-filtered orders)
        reseller_order_ids = set()
        async for doc in col("order_commissions").find(comm_match, {"odoo_order_id": 1}):
            reseller_order_ids.add(doc["odoo_order_id"])

        reseller_revenue = sum(
            o["amount_total"] for o in orders if str(o["id"]) in reseller_order_ids
        )
        direct_revenue = total_revenue - reseller_revenue

        # 6-month trend
        trend = []
        for i in range(5, -1, -1):
            m = today.month - i
            y = today.year
            while m <= 0:
                m += 12
                y -= 1
            fd = first_day_of_month(y, m).strftime("%Y-%m-%d")
            ld = last_day_of_month(y, m).strftime("%Y-%m-%d")
            month_orders = odoo.search_read(
                "sale.order",
                domain=[
                    ("state", "in", ["sale", "done"]),
                    *odoo_date_domain("date_order", fd, ld),
                ],
                fields=["amount_total"],
                limit=5000,
            )
            trend.append({
                "month": datetime(y, m, 1).strftime("%b"),
                "year": y,
                "revenue": sum(o["amount_total"] for o in month_orders),
                "order_count": len(month_orders),
            })

        return {
            "period": {"year": year, "month": month, "from": _from, "to": _to},
            "revenue": {
                "total": total_revenue,
                "subtotal": total_subtotal,
                "vat": total_vat,
                "direct": direct_revenue,
                "reseller": reseller_revenue,
            },
            "commission": {
                "total": total_commission,
                "net_to_bassani": total_subtotal - total_commission,
                "by_reseller": commission_by_reseller,
            },
            "order_count": len(orders),
            "trend": trend,
        }

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Report error: {str(e)}")


# ── Best Sellers ──────────────────────────────────────────────────────────────

@router.get("/best-sellers")
async def best_sellers(
    limit: int = Query(10, le=50),
    year: int = Query(default=None),
    month: int = Query(default=None),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(require_admin),
):
    """Top products by revenue — pulled from Odoo sale order lines."""
    odoo = get_odoo_client()
    warehouse_id = current_user.get("active_warehouse_id")
    today = date.today()
    if from_date and to_date:
        _from, _to = from_date, to_date
    else:
        year  = year  or today.year
        month = month or today.month
        _from = first_day_of_month(year, month).strftime("%Y-%m-%d")
        _to   = last_day_of_month(year, month).strftime("%Y-%m-%d")

    _wh_filter = [("order_id.warehouse_id", "=", warehouse_id)] if warehouse_id else []

    try:
        lines = odoo.search_read(
            "sale.order.line",
            domain=[
                ("order_id.state", "in", ["sale", "done"]),
                ("order_id.date_order", ">=", _from),
                ("order_id.date_order", "<=", _to),
                *_wh_filter,
            ],
            fields=["product_id", "product_uom_qty", "price_subtotal", "price_unit"],
            limit=10000,
        )

        # Aggregate by product
        product_map = {}
        for line in lines:
            pid = line["product_id"][0] if line.get("product_id") else None
            pname = line["product_id"][1] if line.get("product_id") else "Unknown"
            if not pid:
                continue
            if pid not in product_map:
                product_map[pid] = {
                    "product_id": pid,
                    "product_name": pname,
                    "units_sold": 0,
                    "revenue": 0.0,
                }
            product_map[pid]["units_sold"] += line["product_uom_qty"]
            product_map[pid]["revenue"]    += line["price_subtotal"]

        ranked = sorted(product_map.values(), key=lambda x: x["revenue"], reverse=True)[:limit]
        for i, p in enumerate(ranked):
            p["rank"] = i + 1

        return {
            "period": {"year": year, "month": month},
            "products": ranked,
            "total_products_sold": len(product_map),
        }

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Report error: {str(e)}")


# ── Best Customers ────────────────────────────────────────────────────────────

@router.get("/best-customers")
async def best_customers(
    limit: int = Query(10, le=50),
    year: int = Query(default=None),
    month: int = Query(default=None),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(require_admin),
):
    """Top customers by spend — pulled from Odoo sale orders."""
    odoo = get_odoo_client()
    warehouse_id = current_user.get("active_warehouse_id")
    today = date.today()
    if from_date and to_date:
        _from, _to = from_date, to_date
    else:
        year  = year  or today.year
        month = month or today.month
        _from = first_day_of_month(year, month).strftime("%Y-%m-%d")
        _to   = last_day_of_month(year, month).strftime("%Y-%m-%d")

    _wh_filter = [("warehouse_id", "=", warehouse_id)] if warehouse_id else []

    try:
        orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", _from),
                ("date_order", "<=", _to),
                *_wh_filter,
            ],
            fields=["partner_id", "amount_total", "invoice_status"],
            limit=5000,
        )

        customer_map = {}
        for o in orders:
            if not o.get("partner_id"):
                continue
            cid   = o["partner_id"][0]
            cname = o["partner_id"][1]
            if cid not in customer_map:
                customer_map[cid] = {
                    "customer_id": cid,
                    "customer_name": cname,
                    "order_count": 0,
                    "total_spend": 0.0,
                }
            customer_map[cid]["order_count"] += 1
            customer_map[cid]["total_spend"] += o["amount_total"]

        ranked = sorted(customer_map.values(), key=lambda x: x["total_spend"], reverse=True)[:limit]
        for i, c in enumerate(ranked):
            c["rank"] = i + 1
            c["avg_order"] = c["total_spend"] / c["order_count"] if c["order_count"] else 0

        return {
            "period": {"year": year, "month": month},
            "customers": ranked,
        }

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Report error: {str(e)}")


# ── Dead Stock ────────────────────────────────────────────────────────────────

@router.get("/dead-stock")
async def dead_stock(
    days_threshold: int = Query(60),
    current_user: dict = Depends(require_admin),
):
    """
    Products that haven't moved in `days_threshold` days.
    Pulls from Odoo stock moves to find last sale date per product.
    Stock levels are scoped to the caller's resolved warehouse.
    """
    odoo = get_odoo_client()
    cutoff = (date.today() - timedelta(days=days_threshold)).strftime("%Y-%m-%d")
    warehouse_id = current_user.get("active_warehouse_id")

    try:
        # Products with stock (per-variant so cross-variant aggregation can't hide shortages)
        products = odoo.search_read(
            "product.product",
            domain=[("type", "=", "product"), ("virtual_available", ">", 0), ("active", "=", True)],
            fields=["id", "name", "default_code", "virtual_available", "categ_id", "uom_id"],
            limit=500,
            context=odoo_context(warehouse_id),
        )

        # Recent order lines (within threshold)
        recent_lines = odoo.search_read(
            "sale.order.line",
            domain=[
                ("order_id.state", "in", ["sale", "done"]),
                ("order_id.date_order", ">=", cutoff),
            ],
            fields=["product_id"],
            limit=10000,
        )
        recently_sold_ids = {
            l["product_id"][0]
            for l in recent_lines
            if l.get("product_id")
        }

        dead = []
        for p in products:
            if p["id"] not in recently_sold_ids:
                dead.append({
                    "product_id": p["id"],
                    "product_name": p["name"],
                    "sku": p.get("default_code", ""),
                    "category": p["categ_id"][1] if p.get("categ_id") else "",
                    "stock": p["virtual_available"],
                    "uom": p["uom_id"][1] if p.get("uom_id") else "units",
                    "status": "never_sold" if p["id"] not in recently_sold_ids else "slow_moving",
                })

        return {
            "days_threshold": days_threshold,
            "cutoff_date": cutoff,
            "dead_stock": dead,
            "total": len(dead),
        }

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Report error: {str(e)}")


# ── Category Performance ──────────────────────────────────────────────────────

@router.get("/category-performance")
async def category_performance(
    year: int = Query(default=None),
    month: int = Query(default=None),
    from_date: Optional[str] = Query(default=None),
    to_date: Optional[str] = Query(default=None),
    current_user: dict = Depends(require_admin),
):
    """Revenue and order count broken down by product category."""
    odoo = get_odoo_client()
    warehouse_id = current_user.get("active_warehouse_id")
    today = date.today()
    if from_date and to_date:
        _from, _to = from_date, to_date
    else:
        year  = year  or today.year
        month = month or today.month
        _from = first_day_of_month(year, month).strftime("%Y-%m-%d")
        _to   = last_day_of_month(year, month).strftime("%Y-%m-%d")

    _wh_filter = [("order_id.warehouse_id", "=", warehouse_id)] if warehouse_id else []

    try:
        lines = odoo.search_read(
            "sale.order.line",
            domain=[
                ("order_id.state", "in", ["sale", "done"]),
                ("order_id.date_order", ">=", _from),
                ("order_id.date_order", "<=", _to),
                *_wh_filter,
            ],
            fields=["product_id", "price_subtotal", "product_uom_qty"],
            limit=10000,
        )

        # Fetch category per product (batch)
        product_ids = list({l["product_id"][0] for l in lines if l.get("product_id")})
        products = odoo.read(
            "product.product",
            product_ids,
            fields=["id", "categ_id"],
        ) if product_ids else []
        prod_cat = {p["id"]: p["categ_id"][1] if p.get("categ_id") else "Other" for p in products}

        cat_map = {}
        for line in lines:
            if not line.get("product_id"):
                continue
            pid = line["product_id"][0]
            cat = prod_cat.get(pid, "Other")
            if cat not in cat_map:
                cat_map[cat] = {"category": cat, "revenue": 0.0, "units": 0.0, "order_lines": 0}
            cat_map[cat]["revenue"]     += line["price_subtotal"]
            cat_map[cat]["units"]       += line["product_uom_qty"]
            cat_map[cat]["order_lines"] += 1

        total_revenue = sum(c["revenue"] for c in cat_map.values())
        result = sorted(cat_map.values(), key=lambda x: x["revenue"], reverse=True)
        for cat in result:
            cat["pct"] = round(cat["revenue"] / total_revenue * 100, 1) if total_revenue else 0

        return {
            "period": {"year": year, "month": month},
            "categories": result,
            "total_revenue": total_revenue,
        }

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Report error: {str(e)}")


# ── Best Resellers ────────────────────────────────────────────────────────────

@router.get("/best-resellers")
async def best_resellers_report(
    fy_start_year: Optional[int] = Query(default=None),
    current_user: dict = Depends(require_admin),
):
    """
    FY reseller performance — orders processed, revenue generated, customers onboarded.
    Uses SA financial year: 1 March → end of February.
    Pass fy_start_year to select a specific FY; defaults to the current FY.
    """
    today = date.today()
    if fy_start_year:
        fy_end_year = fy_start_year + 1
        fy_start = datetime(fy_start_year, 3, 1, tzinfo=timezone.utc)
        fy_end   = datetime(fy_end_year, 2, _cal.monthrange(fy_end_year, 2)[1], 23, 59, 59, tzinfo=timezone.utc)
        fy_label = f"FY{fy_start_year}/{str(fy_end_year)[2:]}"
    else:
        fy_start, fy_end, fy_label = financial_year_bounds(today)
    odoo = get_odoo_client()
    warehouse_id = current_user.get("active_warehouse_id")

    try:
        # Per-reseller FY aggregates from order_commissions
        fy_pipeline = [
            {"$match": {"created_at": {"$gte": fy_start, "$lte": fy_end}}},
            {"$group": {
                "_id": "$reseller_id",
                "reseller_name":    {"$first": "$reseller_name"},
                "fy_orders":        {"$sum": 1},
                "fy_commission":    {"$sum": "$commission_total"},
                "odoo_order_ids":   {"$push": "$odoo_order_id"},
            }},
        ]
        fy_stats = await col("order_commissions").aggregate(fy_pipeline).to_list(200)

        # All-time order + commission totals per reseller
        at_pipeline = [
            {"$group": {
                "_id": "$reseller_id",
                "all_time_orders":     {"$sum": 1},
                "all_time_commission": {"$sum": "$commission_total"},
            }},
        ]
        at_stats = await col("order_commissions").aggregate(at_pipeline).to_list(200)
        at_map = {r["_id"]: r for r in at_stats}

        # Customers onboarded per reseller (all-time, from customer_ownership)
        own_pipeline = [
            {"$group": {"_id": "$reseller_id", "customers_onboarded": {"$sum": 1}}}
        ]
        own_stats  = await col("customer_ownership").aggregate(own_pipeline).to_list(200)
        own_map    = {o["_id"]: o["customers_onboarded"] for o in own_stats}

        # Batch-fetch Odoo order amounts for FY revenue per reseller
        all_odoo_ids = [
            int(oid) for r in fy_stats for oid in r.get("odoo_order_ids", []) if oid
        ]
        odoo_amounts: dict = {}
        if all_odoo_ids:
            _wh_filter = [("warehouse_id", "=", warehouse_id)] if warehouse_id else []
            orders = odoo.search_read(
                "sale.order",
                domain=[("id", "in", all_odoo_ids), *_wh_filter],
                fields=["id", "amount_total"],
                limit=len(all_odoo_ids) + 1,
            )
            odoo_amounts = {o["id"]: o["amount_total"] for o in orders}

        # Build ranked list
        results = []
        for r in fy_stats:
            ids        = [int(oid) for oid in r.get("odoo_order_ids", []) if oid]
            fy_revenue = sum(odoo_amounts.get(i, 0) for i in ids)
            at         = at_map.get(r["_id"], {})
            results.append({
                "reseller_id":         r["_id"],
                "reseller_name":       r["reseller_name"] or "—",
                "fy_orders":           r["fy_orders"],
                "fy_revenue":          round(fy_revenue, 2),
                "fy_commission":       round(r["fy_commission"], 2),
                "avg_order_value":     round(fy_revenue / r["fy_orders"], 2) if r["fy_orders"] else 0,
                "customers_onboarded": own_map.get(r["_id"], 0),
                "all_time_orders":     at.get("all_time_orders", 0),
                "all_time_commission": round(at.get("all_time_commission", 0), 2),
            })

        # Include resellers with no FY orders (zero-activity rows)
        active_ids = {r["reseller_id"] for r in results}
        all_resellers = await col("resellers").find({}, NO_ID).to_list(200)
        for rs in all_resellers:
            rid = rs.get("id")
            if rid not in active_ids:
                at = at_map.get(rid, {})
                results.append({
                    "reseller_id":         rid,
                    "reseller_name":       rs.get("name", "—"),
                    "fy_orders":           0,
                    "fy_revenue":          0.0,
                    "fy_commission":       0.0,
                    "avg_order_value":     0.0,
                    "customers_onboarded": own_map.get(rid, 0),
                    "all_time_orders":     at.get("all_time_orders", 0),
                    "all_time_commission": round(at.get("all_time_commission", 0), 2),
                })

        results.sort(key=lambda x: (x["fy_orders"], x["fy_revenue"]), reverse=True)
        for i, r in enumerate(results):
            r["rank"] = i + 1

        return {
            "fy_label":                 fy_label,
            "fy_start":                 fy_start.date().isoformat(),
            "fy_end":                   fy_end.date().isoformat(),
            "resellers":                results,
            "total_fy_orders":          sum(r["fy_orders"]           for r in results),
            "total_fy_revenue":         round(sum(r["fy_revenue"]    for r in results), 2),
            "total_fy_commission":      round(sum(r["fy_commission"] for r in results), 2),
            "total_customers_onboarded":sum(r["customers_onboarded"] for r in results),
        }

    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Report error: {str(e)}")


# ── Commission Report ─────────────────────────────────────────────────────────

@router.get("/commissions")
async def commission_report(
    reseller_id: Optional[str] = None,
    year: int = Query(default=None),
    month: int = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """
    Commission breakdown per reseller.
    Resellers can only see their own data.
    """
    today = date.today()
    year  = year  or today.year
    month = month or today.month

    # Restrict resellers to own data
    if current_user.get("role") == "reseller":
        reseller = await col("resellers").find_one(
            {"user_id": current_user["id"]}, NO_ID
        )
        reseller_id = reseller["id"] if reseller else None

    match_query = {
        "created_at": {
            "$gte": first_day_of_month(year, month),
            "$lte": last_day_of_month(year, month),
        }
    }
    if reseller_id:
        match_query["reseller_id"] = reseller_id

    pipeline = [
        {"$match": match_query},
        {
            "$group": {
                "_id": "$reseller_id",
                "reseller_name": {"$first": "$reseller_name"},
                "commission_total": {"$sum": "$commission_total"},
                "order_count": {"$sum": 1},
            }
        },
        {"$sort": {"commission_total": -1}},
    ]
    results = await col("order_commissions").aggregate(pipeline).to_list(100)

    grand_total = sum(r["commission_total"] for r in results)

    return {
        "period": {"year": year, "month": month},
        "resellers": results,
        "grand_total": grand_total,
    }
