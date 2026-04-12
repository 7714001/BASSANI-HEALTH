from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from datetime import datetime, timezone, date, timedelta
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from database import col, NO_ID

router = APIRouter(prefix="/api/reports", tags=["reports"])

# ── Helpers ───────────────────────────────────────────────────────────────────

def first_day_of_month(year: int, month: int) -> datetime:
    return datetime(year, month, 1, tzinfo=timezone.utc)

def last_day_of_month(year: int, month: int) -> datetime:
    if month == 12:
        return datetime(year + 1, 1, 1, tzinfo=timezone.utc) - timedelta(seconds=1)
    return datetime(year, month + 1, 1, tzinfo=timezone.utc) - timedelta(seconds=1)

def odoo_date_domain(field: str, from_date: str, to_date: str) -> list:
    """Build Odoo domain for date range filtering."""
    return [
        (field, ">=", from_date),
        (field, "<=", to_date),
    ]

# ── Dashboard ─────────────────────────────────────────────────────────────────

@router.get("/dashboard")
async def dashboard_stats(current_user: dict = Depends(get_current_user)):
    """
    Master dashboard — KPIs from Odoo + commission totals from MongoDB.
    Single endpoint so the dashboard loads in one request.
    """
    odoo = get_odoo_client()
    today = date.today()
    month_start = first_day_of_month(today.year, today.month).strftime("%Y-%m-%d")
    month_end = last_day_of_month(today.year, today.month).strftime("%Y-%m-%d")

    try:
        # Product counts
        total_products = odoo.count(
            "product.template",
            [("type", "in", ["product", "consu"]), ("active", "=", True)]
        )
        low_stock = odoo.count(
            "product.template",
            [("type", "=", "product"), ("qty_available", "<", 10), ("active", "=", True)]
        )

        # Order counts + revenue this month
        month_orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", month_start),
                ("date_order", "<=", month_end),
            ],
            fields=["amount_total"],
            limit=5000,
        )
        month_revenue = sum(o["amount_total"] for o in month_orders)

        total_orders   = odoo.count("sale.order", [])
        active_customers = odoo.count("res.partner", [("customer_rank", ">", 0), ("active", "=", True)])

        # Invoice summary
        unpaid_invoices = odoo.count(
            "account.move",
            [
                ("move_type", "=", "out_invoice"),
                ("payment_state", "=", "not_paid"),
                ("state", "=", "posted"),
            ]
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

        # Recent orders (last 5)
        recent_orders = odoo.search_read(
            "sale.order",
            domain=[],
            fields=["id", "name", "partner_id", "amount_total", "state", "date_order"],
            limit=5,
            order="date_order desc",
        )

        # Low stock products
        low_stock_products = odoo.search_read(
            "product.template",
            domain=[("type", "=", "product"), ("qty_available", "<", 10), ("active", "=", True)],
            fields=["id", "name", "qty_available", "uom_id", "categ_id"],
            limit=5,
            order="qty_available asc",
        )

        # Commission due this month from MongoDB
        pipeline = [
            {
                "$match": {
                    "created_at": {
                        "$gte": first_day_of_month(today.year, today.month),
                        "$lte": last_day_of_month(today.year, today.month),
                    }
                }
            },
            {"$group": {"_id": None, "total": {"$sum": "$commission_total"}}},
        ]
        result = await col("order_commissions").aggregate(pipeline).to_list(1)
        commission_due = result[0]["total"] if result else 0

        return {
            "products": {
                "total": total_products,
                "low_stock": low_stock,
            },
            "orders": {
                "total": total_orders,
                "this_month": len(month_orders),
                "month_revenue": month_revenue,
            },
            "customers": {
                "active": active_customers,
            },
            "invoices": {
                "unpaid": unpaid_invoices,
                "overdue_amount": overdue_amount,
            },
            "commission": {
                "due_this_month": commission_due,
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
    current_user: dict = Depends(get_current_user),
):
    """
    Monthly revenue split — direct vs reseller sales.
    Pulls order totals from Odoo, commission data from MongoDB.
    """
    odoo = get_odoo_client()
    today = date.today()
    year  = year  or today.year
    month = month or today.month

    from_date = first_day_of_month(year, month).strftime("%Y-%m-%d")
    to_date   = last_day_of_month(year, month).strftime("%Y-%m-%d")

    try:
        # All confirmed orders this month from Odoo
        orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                *odoo_date_domain("date_order", from_date, to_date),
            ],
            fields=["id", "name", "amount_untaxed", "amount_tax", "amount_total", "date_order"],
            limit=5000,
        )

        total_revenue  = sum(o["amount_total"]   for o in orders)
        total_subtotal = sum(o["amount_untaxed"] for o in orders)
        total_vat      = sum(o["amount_tax"]     for o in orders)

        # Commission from MongoDB
        pipeline = [
            {
                "$match": {
                    "created_at": {
                        "$gte": first_day_of_month(year, month),
                        "$lte": last_day_of_month(year, month),
                    }
                }
            },
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

        # Reseller vs direct split
        reseller_order_ids = set()
        async for doc in col("order_commissions").find(
            {"created_at": {
                "$gte": first_day_of_month(year, month),
                "$lte": last_day_of_month(year, month),
            }},
            {"odoo_order_id": 1}
        ):
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
            "period": {"year": year, "month": month, "from": from_date, "to": to_date},
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
def best_sellers(
    limit: int = Query(10, le=50),
    year: int = Query(default=None),
    month: int = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Top products by revenue — pulled from Odoo sale order lines."""
    odoo = get_odoo_client()
    today = date.today()
    year  = year  or today.year
    month = month or today.month

    from_date = first_day_of_month(year, month).strftime("%Y-%m-%d")
    to_date   = last_day_of_month(year, month).strftime("%Y-%m-%d")

    try:
        lines = odoo.search_read(
            "sale.order.line",
            domain=[
                ("order_id.state", "in", ["sale", "done"]),
                ("order_id.date_order", ">=", from_date),
                ("order_id.date_order", "<=", to_date),
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
def best_customers(
    limit: int = Query(10, le=50),
    year: int = Query(default=None),
    month: int = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Top customers by spend — pulled from Odoo sale orders."""
    odoo = get_odoo_client()
    today = date.today()
    year  = year  or today.year
    month = month or today.month

    from_date = first_day_of_month(year, month).strftime("%Y-%m-%d")
    to_date   = last_day_of_month(year, month).strftime("%Y-%m-%d")

    try:
        orders = odoo.search_read(
            "sale.order",
            domain=[
                ("state", "in", ["sale", "done"]),
                ("date_order", ">=", from_date),
                ("date_order", "<=", to_date),
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
def dead_stock(
    days_threshold: int = Query(60),
    current_user: dict = Depends(get_current_user),
):
    """
    Products that haven't moved in `days_threshold` days.
    Pulls from Odoo stock moves to find last sale date per product.
    """
    odoo = get_odoo_client()
    cutoff = (date.today() - timedelta(days=days_threshold)).strftime("%Y-%m-%d")

    try:
        # Products with stock
        products = odoo.search_read(
            "product.template",
            domain=[("type", "=", "product"), ("qty_available", ">", 0), ("active", "=", True)],
            fields=["id", "name", "default_code", "qty_available", "categ_id", "uom_id"],
            limit=500,
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
                    "stock": p["qty_available"],
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
def category_performance(
    year: int = Query(default=None),
    month: int = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    """Revenue and order count broken down by product category."""
    odoo = get_odoo_client()
    today = date.today()
    year  = year  or today.year
    month = month or today.month

    from_date = first_day_of_month(year, month).strftime("%Y-%m-%d")
    to_date   = last_day_of_month(year, month).strftime("%Y-%m-%d")

    try:
        lines = odoo.search_read(
            "sale.order.line",
            domain=[
                ("order_id.state", "in", ["sale", "done"]),
                ("order_id.date_order", ">=", from_date),
                ("order_id.date_order", "<=", to_date),
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
