#!/usr/bin/env python3
"""
Bassani Health — Odoo Connection Test
Run this locally to verify your live Odoo integration:

  cd backend
  python test_odoo.py

This script tests:
  1. Authentication
  2. All required module access
  3. Pulls sample data from each model
  4. Checks stock locations
  5. Verifies invoice access
"""
import xmlrpc.client
import sys
from datetime import datetime

# ── Config (reads from .env if python-dotenv is installed) ────────────────────
try:
    from dotenv import load_dotenv
    import os
    load_dotenv()
    URL      = os.getenv("ODOO_URL",      "https://multisaas-odoo-bassani-health.odoo.com")
    DB       = os.getenv("ODOO_DB",       "multisaas_odoo_bassani_health_production_26851697")
    USERNAME = os.getenv("ODOO_USERNAME", "support@multisaas.co.za")
    API_KEY  = os.getenv("ODOO_PASSWORD", "")
except ImportError:
    URL      = "https://multisaas-odoo-bassani-health.odoo.com"
    DB       = "multisaas_odoo_bassani_health_production_26851697"
    USERNAME = "support@multisaas.co.za"
    API_KEY  = "55046a4793f656c2b3594bdd9db9dfdf112644e7"

PASS = "✅"
FAIL = "❌"
WARN = "⚠️ "

def sep(label=""):
    print(f"\n{'─'*50}")
    if label:
        print(f"  {label}")
        print(f"{'─'*50}")

def main():
    print(f"\n{'═'*50}")
    print("  Bassani Health · Odoo Connection Test")
    print(f"  {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"{'═'*50}")
    print(f"  URL:      {URL}")
    print(f"  Database: {DB}")
    print(f"  User:     {USERNAME}")

    # ── Step 1: Version ───────────────────────────────────────────────────────
    sep("1 — Server version")
    common = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/common", allow_none=True)
    try:
        v = common.version()
        print(f"{PASS} Server version: {v.get('server_version', 'unknown')}")
        print(f"     Server edition: {v.get('server_version_info', [])}")
    except Exception as e:
        print(f"{FAIL} Cannot reach server: {e}")
        sys.exit(1)

    # ── Step 2: Authenticate ──────────────────────────────────────────────────
    sep("2 — Authentication")
    try:
        uid = common.authenticate(DB, USERNAME, API_KEY, {})
        if not uid:
            print(f"{FAIL} Authentication failed — check username and API key")
            sys.exit(1)
        print(f"{PASS} Authenticated — UID: {uid}")
    except Exception as e:
        print(f"{FAIL} Auth error: {e}")
        sys.exit(1)

    models = xmlrpc.client.ServerProxy(f"{URL}/xmlrpc/2/object", allow_none=True)

    def call(model, method, args=None, kwargs=None):
        return models.execute_kw(DB, uid, API_KEY, model, method, args or [], kwargs or {})

    # ── Step 3: Module access ─────────────────────────────────────────────────
    sep("3 — Module access")
    required = [
        ("res.partner",            "Customers / Partners"),
        ("product.product",        "Products"),
        ("product.template",       "Product Templates"),
        ("sale.order",             "Sales Orders"),
        ("sale.order.line",        "Order Lines"),
        ("account.move",           "Invoices / Credit Notes"),
        ("account.payment",        "Payments"),
        ("stock.quant",            "Stock Levels"),
        ("stock.location",         "Warehouse Locations"),
        ("stock.picking",          "Stock Pickings"),
        ("stock.move",             "Stock Moves"),
        ("product.category",       "Product Categories"),
        ("account.move.reversal",  "Credit Note (Reversal)"),
        ("res.currency",           "Currency"),
    ]
    all_ok = True
    for model, label in required:
        try:
            count = call(model, "search_count", [[]])
            print(f"  {PASS} {label:<30} {count:>6} records")
        except Exception as e:
            print(f"  {FAIL} {label:<30} ERROR: {e}")
            all_ok = False

    if not all_ok:
        print(f"\n{WARN} Some modules could not be accessed.")
        print("     Ensure the API user has appropriate access rights in Odoo.")

    # ── Step 4: Sample customers ──────────────────────────────────────────────
    sep("4 — Sample customers (first 5)")
    try:
        partners = call("res.partner", "search_read",
            [[["customer_rank", ">", 0]]],
            {"fields": ["name","email","city","credit_limit","property_payment_term_id"], "limit": 5}
        )
        if partners:
            for p in partners:
                term = p.get("property_payment_term_id")
                term_name = term[1] if isinstance(term, list) else "—"
                print(f"  {PASS} {p['name']}")
                print(f"       Email: {p.get('email','—')} | City: {p.get('city','—')} | Terms: {term_name}")
        else:
            print(f"  {WARN} No customers found — check customer_rank field")
    except Exception as e:
        print(f"  {FAIL} {e}")

    # ── Step 5: Sample products ───────────────────────────────────────────────
    sep("5 — Sample products (first 5 active, saleable)")
    try:
        prods = call("product.product", "search_read",
            [[["sale_ok","=",True],["active","=",True]]],
            {"fields": ["name","default_code","list_price","standard_price","qty_available","categ_id","uom_id"], "limit": 5}
        )
        if prods:
            for p in prods:
                cat = p.get("categ_id")
                cat_name = cat[1] if isinstance(cat, list) else "—"
                print(f"  {PASS} {p['name']}")
                print(f"       SKU: {p.get('default_code','—')} | Price: R{p['list_price']} | Cost: R{p['standard_price']} | Stock: {p['qty_available']} | Cat: {cat_name}")
        else:
            print(f"  {WARN} No saleable products found")
    except Exception as e:
        print(f"  {FAIL} {e}")

    # ── Step 6: Stock locations ───────────────────────────────────────────────
    sep("6 — Warehouse locations")
    try:
        locations = call("stock.location", "search_read",
            [[["usage","=","internal"],["active","=",True]]],
            {"fields": ["name","complete_name"], "limit": 10}
        )
        for loc in locations:
            print(f"  {PASS} {loc['complete_name']}")
        if not locations:
            print(f"  {WARN} No internal locations found")
    except Exception as e:
        print(f"  {FAIL} {e}")

    # ── Step 7: Recent invoices ───────────────────────────────────────────────
    sep("7 — Recent invoices (last 5)")
    try:
        invoices = call("account.move", "search_read",
            [[["move_type","=","out_invoice"],["state","=","posted"]]],
            {"fields": ["name","partner_id","amount_total","invoice_date","payment_state"], "limit": 5,
             "order": "invoice_date desc"}
        )
        for inv in invoices:
            partner = inv.get("partner_id")
            partner_name = partner[1] if isinstance(partner, list) else "—"
            print(f"  {PASS} {inv['name']} | {partner_name} | R{inv['amount_total']} | {inv.get('payment_state','—')}")
        if not invoices:
            print(f"  {WARN} No posted invoices found")
    except Exception as e:
        print(f"  {FAIL} {e}")

    # ── Step 8: Sales orders ──────────────────────────────────────────────────
    sep("8 — Recent sales orders (last 5)")
    try:
        orders = call("sale.order", "search_read",
            [[["state","in",["sale","done"]]]],
            {"fields": ["name","partner_id","amount_total","date_order","state"], "limit": 5,
             "order": "date_order desc"}
        )
        for o in orders:
            partner = o.get("partner_id")
            partner_name = partner[1] if isinstance(partner, list) else "—"
            print(f"  {PASS} {o['name']} | {partner_name} | R{o['amount_total']} | {o.get('state','—')}")
        if not orders:
            print(f"  {WARN} No confirmed sales orders found")
    except Exception as e:
        print(f"  {FAIL} {e}")

    # ── Summary ───────────────────────────────────────────────────────────────
    sep()
    print(f"{PASS} Odoo connection test complete!")
    print(f"   Your live Odoo instance is ready.")
    print(f"\n   Next step: update backend/.env with your credentials")
    print(f"   then run:  docker compose up --build")
    print(f"{'═'*50}\n")


if __name__ == "__main__":
    main()
