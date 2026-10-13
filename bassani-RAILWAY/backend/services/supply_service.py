"""
GMP supply and backorder fulfilment (8.70).

La Farmacia (the receiving company/warehouse) sells; GMP (the supplying
company) makes most products and supplies them through Odoo's company-to-
company rules: a La Farmacia purchase order to GMP creates GMP's sales order
automatically, stock moves GMP/Stock -> Inter-company transit -> receiving
stock, and with "Synchronize Deliveries to your Receipts" on, validating GMP's
delivery completes La Farmacia's receipt too. (All live-checked 2026-10-11.)

Design rules, so Bassani's planned Odoo rework needs no code change:
  * Discover, never hardcode: companies and warehouses come from portal
    settings; everything else is found through Odoo's own relations
    (picking <-> sale order, purchase order <-> auto sales order, transit
    locations, each company's intercompany_* settings).
  * Only public, standard Odoo actions (action_assign, button_validate, the
    backorder wizard, purchase button_confirm, stock.quant inventory apply),
    re-reading state after every write.
  * Work whether or not Odoo automation does a step: after dispatch, if Odoo
    already completed the receipt the portal confirms it, otherwise it
    validates the receipt itself.

Plain sync functions taking an OdooClient; the route file runs them in a
threadpool. Writes that need a company use odoo_client.odoo() so a context
can be passed.
"""
from collections import defaultdict
from datetime import datetime, timezone
from typing import Optional

from odoo_client import odoo as odoo_call


# The GMP Vault is the one physical vault: GMP Supply ships from it and the
# Phase 13 vault module (services/vault_odoo.py) records movements in it.
# resolve_config() keeps this up to date so both use the same warehouse
# (confirmed with the product owner 2026-10-11; previously Phase 13 read a
# separate GACP_WAREHOUSE_ID variable).
_VAULT = {"warehouse_id": None, "warehouse_name": None, "company_id": None}


def vault_warehouse() -> dict:
    return dict(_VAULT)


class SupplyNotConfigured(Exception):
    pass


class SupplyError(Exception):
    """A business-level failure with a message safe to show the user."""


DEMAND_MOVE_STATES = ["waiting", "confirmed", "partially_available"]


def _id(v):
    return v[0] if isinstance(v, (list, tuple)) and v else (v or None)


def _name(v):
    return v[1] if isinstance(v, (list, tuple)) and len(v) > 1 else None


def _ctx(company_id: Optional[int], **extra) -> dict:
    c = {"allowed_company_ids": [company_id], "company_id": company_id} if company_id else {}
    c.update(extra)
    return c


def _call(model: str, method: str, args: list, kwargs: Optional[dict] = None):
    """odoo_call that tolerates Odoo 19's empty-reply quirk: some actions
    (e.g. stock.quant.action_apply_inventory) complete, then fail to send a
    None reply over XML-RPC ("cannot marshal None"). Live-confirmed
    2026-10-11. Callers re-read state afterwards rather than trust the reply."""
    try:
        return odoo_call(model, method, args, kwargs or {})
    except Exception as e:
        if "cannot marshal None" in str(e):
            return None
        raise


def _assign(model_ids: list, company_id: Optional[int]) -> None:
    """Odoo's Check Availability. On Odoo 19 it raises "Nothing to check the
    availability for" when there's nothing left to reserve; that's not an
    error for us, the caller reads what got reserved."""
    try:
        _call("stock.picking", "action_assign", [model_ids], {"context": _ctx(company_id)})
    except Exception as e:
        if "Nothing to check the availability" not in str(e):
            raise


def _f(n) -> float:
    try:
        return float(n or 0)
    except (TypeError, ValueError):
        return 0.0


# ── Configuration ─────────────────────────────────────────────────────────────

def resolve_config(odoo, settings: dict) -> dict:
    """Turn the two portal settings (supplying company, receiving warehouse)
    into everything the supply flow needs, read live from Odoo."""
    supplier_company_id = settings.get("supplier_company_id")
    receiving_warehouse_id = settings.get("receiving_warehouse_id")
    if not supplier_company_id or not receiving_warehouse_id:
        raise SupplyNotConfigured("GMP supply isn't set up yet. Choose the supplying company and receiving warehouse in Supply settings.")

    wh = odoo.read("stock.warehouse", [receiving_warehouse_id], fields=["name", "company_id", "lot_stock_id", "in_type_id"])
    if not wh:
        raise SupplyNotConfigured("The receiving warehouse no longer exists in Odoo. Update Supply settings.")
    wh = wh[0]
    receiving_company_id = _id(wh["company_id"])
    if receiving_company_id == supplier_company_id:
        raise SupplyNotConfigured("The supplying company and the receiving warehouse's company are the same. Update Supply settings.")

    companies = {c["id"]: c for c in odoo.read(
        "res.company", [supplier_company_id, receiving_company_id],
        fields=["name", "partner_id", "intercompany_warehouse_id", "intercompany_sync_delivery_receipt",
                "intercompany_generate_sales_orders"],
    )}
    sc, rc = companies.get(supplier_company_id), companies.get(receiving_company_id)
    if not sc or not rc:
        raise SupplyNotConfigured("A configured company no longer exists in Odoo. Update Supply settings.")

    supplier_warehouse_id = settings.get("supplier_warehouse_id") or _id(sc.get("intercompany_warehouse_id"))
    if not supplier_warehouse_id:
        rows = odoo.search_read("stock.warehouse", [("company_id", "=", supplier_company_id)], fields=["id"], limit=1)
        supplier_warehouse_id = rows[0]["id"] if rows else None
    if not supplier_warehouse_id:
        raise SupplyNotConfigured("The supplying company has no warehouse in Odoo.")
    sw = odoo.read("stock.warehouse", [supplier_warehouse_id], fields=["name", "lot_stock_id"])[0]

    internal_partner_ids = sorted({_id(c["partner_id"]) for c in odoo.search_read("res.company", [], fields=["partner_id"])
                                   if c.get("partner_id")})
    _VAULT.update(warehouse_id=supplier_warehouse_id, warehouse_name=sw["name"], company_id=supplier_company_id)
    return {
        "supplier_company_id": supplier_company_id,
        "supplier_company_name": sc["name"],
        "supplier_partner_id": _id(sc["partner_id"]),
        "supplier_warehouse_id": supplier_warehouse_id,
        "supplier_warehouse_name": sw["name"],
        "supplier_stock_location_id": _id(sw["lot_stock_id"]),
        "receiving_company_id": receiving_company_id,
        "receiving_company_name": rc["name"],
        "receiving_partner_id": _id(rc["partner_id"]),
        "receiving_warehouse_id": receiving_warehouse_id,
        "receiving_warehouse_name": wh["name"],
        "receiving_stock_location_id": _id(wh["lot_stock_id"]),
        "receiving_in_type_id": _id(wh.get("in_type_id")),
        "receipt_sync": bool(sc.get("intercompany_sync_delivery_receipt") or rc.get("intercompany_sync_delivery_receipt")),
        "auto_sales_orders": bool(sc.get("intercompany_generate_sales_orders")),
        "internal_partner_ids": internal_partner_ids,
    }


def settings_options(odoo) -> dict:
    """Choices for the Supply settings form, plus a suggestion: receiving =
    the warehouse of the company with the most customer deliveries, supplier =
    the internal company most often listed as a product's vendor."""
    companies = odoo.search_read("res.company", [], fields=["name", "partner_id"])
    warehouses = odoo.search_read("stock.warehouse", [], fields=["name", "company_id"], limit=200)
    wh_companies = {_id(w["company_id"]) for w in warehouses}
    partner_to_company = {_id(c["partner_id"]): c["id"] for c in companies if c.get("partner_id")}
    seller_counts: dict = defaultdict(int)
    try:
        for g in odoo_call("product.supplierinfo", "read_group",
                           [[("partner_id", "in", list(partner_to_company))], ["partner_id"], ["partner_id"]],
                           {"lazy": False}):
            cid = partner_to_company.get(_id(g.get("partner_id")))
            if cid:
                seller_counts[cid] += g.get("__count", 0)
    except Exception:
        pass
    delivery_counts: dict = defaultdict(int)
    try:
        for g in odoo_call("stock.picking", "read_group",
                           [[("picking_type_code", "=", "outgoing"), ("sale_id", "!=", False)], ["picking_type_id"], ["picking_type_id"]],
                           {"lazy": False}):
            delivery_counts[_id(g.get("picking_type_id"))] += g.get("__count", 0)
    except Exception:
        pass
    suggested_receiving = None
    if delivery_counts:
        top_type = max(delivery_counts, key=delivery_counts.get)
        try:
            t = odoo.read("stock.picking.type", [top_type], fields=["warehouse_id"])
            suggested_receiving = _id(t[0]["warehouse_id"]) if t else None
        except Exception:
            pass
    receiving_company = next((_id(w["company_id"]) for w in warehouses if w["id"] == suggested_receiving), None)
    candidates = [c for c in seller_counts if c != receiving_company and c in wh_companies]
    suggested_supplier = max(candidates, key=seller_counts.get) if candidates else None
    return {
        "companies": [{"id": c["id"], "name": c["name"]} for c in companies if c["id"] in wh_companies],
        "warehouses": [{"id": w["id"], "name": w["name"], "company_id": _id(w["company_id"]), "company_name": _name(w["company_id"])}
                       for w in warehouses],
        "suggested": {"supplier_company_id": suggested_supplier, "receiving_warehouse_id": suggested_receiving},
    }


# ── Reads ─────────────────────────────────────────────────────────────────────

def _product_stock(odoo, product_ids: list, warehouse_id: int) -> dict:
    if not product_ids:
        return {}
    rows = odoo.read("product.product", product_ids, fields=["qty_available", "free_qty"],
                     context={"warehouse_id": warehouse_id})
    return {r["id"]: {"on_hand": _f(r.get("qty_available")), "free": _f(r.get("free_qty"))} for r in rows}


def _demand_moves(odoo, cfg: dict) -> list:
    """Customer delivery lines at the receiving warehouse not fully reserved.
    Only sales-order deliveries count (returns to the supplier etc. are
    outgoing transfers too, but aren't customer demand)."""
    return odoo.search_read("stock.move", [
        ("picking_id.picking_type_code", "=", "outgoing"),
        ("picking_id.picking_type_id.warehouse_id", "=", cfg["receiving_warehouse_id"]),
        ("picking_id.sale_id", "!=", False),
        ("picking_id.state", "not in", ["draft", "done", "cancel"]),
        ("state", "in", DEMAND_MOVE_STATES),
    ], fields=["product_id", "product_uom_qty", "quantity", "picking_id"], limit=3000)


def _supplier_open_moves(odoo, cfg: dict, product_ids: Optional[list] = None) -> list:
    dom = [
        ("company_id", "=", cfg["supplier_company_id"]),
        ("picking_id.picking_type_code", "=", "outgoing"),
        ("picking_id.partner_id", "child_of", cfg["receiving_partner_id"]),
        ("state", "not in", ["draft", "done", "cancel"]),
    ]
    if product_ids is not None:
        dom.append(("product_id", "in", product_ids))
    return odoo.search_read("stock.move", dom, fields=["product_id", "product_uom_qty", "quantity", "state", "picking_id"], limit=5000)


def _in_transit_moves(odoo, cfg: dict, product_ids: Optional[list] = None) -> list:
    """Receipt lines at the receiving company coming from a transit location
    that are available to receive: Odoo already shows them as having left the
    supplier."""
    dom = [
        ("company_id", "=", cfg["receiving_company_id"]),
        ("picking_id.picking_type_code", "=", "incoming"),
        ("location_id.usage", "=", "transit"),
        ("state", "in", ["assigned", "partially_available"]),
    ]
    if product_ids is not None:
        dom.append(("product_id", "in", product_ids))
    return odoo.search_read("stock.move", dom, fields=["product_id", "product_uom_qty", "quantity", "picking_id"], limit=5000)


def _po_outstanding(odoo, cfg: dict, product_ids: list) -> dict:
    """Quantity still to arrive on confirmed purchase orders, per product,
    split by supplier: the configured supplying company vs everyone else."""
    if not product_ids:
        return {}
    lines = odoo.search_read("purchase.order.line", [
        ("order_id.company_id", "=", cfg["receiving_company_id"]),
        ("product_id", "in", product_ids),
        ("state", "in", ["purchase", "done"]),
    ], fields=["product_id", "product_qty", "qty_received", "partner_id", "order_id"], limit=10000)
    out: dict = defaultdict(lambda: {"from_supplier": 0.0, "from_external": 0.0, "external_orders": set()})
    for l in lines:
        remaining = _f(l["product_qty"]) - _f(l["qty_received"])
        if remaining <= 0:
            continue
        o = out[_id(l["product_id"])]
        if _id(l["partner_id"]) in cfg["internal_partner_ids"]:
            o["from_supplier"] += remaining
        else:
            o["from_external"] += remaining
            o["external_orders"].add(_name(l["order_id"]))
    return out


def _external_products(odoo, cfg: dict, product_ids: list) -> dict:
    """Products whose listed vendors are all outside Bassani's own companies:
    {product_id: vendor name}. A product with no vendor listed is assumed to
    come from the supplying company (the majority case)."""
    if not product_ids:
        return {}
    prods = odoo.read("product.product", product_ids, fields=["product_tmpl_id"])
    tmpl_of = {p["id"]: _id(p["product_tmpl_id"]) for p in prods}
    sellers = odoo.search_read("product.supplierinfo", [("product_tmpl_id", "in", list(set(tmpl_of.values())))],
                               fields=["product_tmpl_id", "partner_id"], limit=5000)
    by_tmpl: dict = defaultdict(list)
    for s in sellers:
        by_tmpl[_id(s["product_tmpl_id"])].append(s)
    out = {}
    for pid, tid in tmpl_of.items():
        rows = by_tmpl.get(tid) or []
        if rows and not any(_id(r["partner_id"]) in cfg["internal_partner_ids"] for r in rows):
            out[pid] = _name(rows[0]["partner_id"])
    return out


def work_list(odoo, cfg: dict) -> dict:
    """Everything the receiving warehouse is short of for customer orders,
    one row per product, matched against what's on its way. Bounded by the
    open short delivery lines (an operational set, not history), so the
    grouping happens here rather than in an Odoo report model."""
    moves = _demand_moves(odoo, cfg)
    short = [m for m in moves if _f(m["product_uom_qty"]) - _f(m["quantity"]) > 0.0001]
    picking_ids = sorted({_id(m["picking_id"]) for m in short})
    pickings = {p["id"]: p for p in odoo.read(
        "stock.picking", picking_ids,
        fields=["name", "sale_id", "partner_id", "backorder_id", "create_date", "scheduled_date"],
    )} if picking_ids else {}
    product_ids = sorted({_id(m["product_id"]) for m in short})

    receiving_stock = _product_stock(odoo, product_ids, cfg["receiving_warehouse_id"])
    supplier_stock = _product_stock(odoo, product_ids, cfg["supplier_warehouse_id"])
    sup_moves = _supplier_open_moves(odoo, cfg, product_ids) if product_ids else []
    transit = _in_transit_moves(odoo, cfg, product_ids) if product_ids else []
    po = _po_outstanding(odoo, cfg, product_ids)
    external = _external_products(odoo, cfg, product_ids)

    sup_open: dict = defaultdict(float)
    sup_ready: dict = defaultdict(float)
    for m in sup_moves:
        pid = _id(m["product_id"])
        sup_open[pid] += _f(m["product_uom_qty"])
        sup_ready[pid] += _f(m["quantity"])
    in_transit: dict = defaultdict(float)
    for m in transit:
        in_transit[_id(m["product_id"])] += _f(m["product_uom_qty"])

    rows: dict = {}
    for m in short:
        pid = _id(m["product_id"])
        p = pickings.get(_id(m["picking_id"]), {})
        row = rows.setdefault(pid, {"product_id": pid, "product_name": _name(m["product_id"]), "needed": 0.0,
                                    "orders": [], "oldest_since": None})
        qty_short = round(_f(m["product_uom_qty"]) - _f(m["quantity"]), 3)
        row["needed"] += qty_short
        since = p.get("create_date") or None
        if since and (not row["oldest_since"] or since < row["oldest_since"]):
            row["oldest_since"] = since
        row["orders"].append({
            "sale_order_id": _id(p.get("sale_id")), "order_name": _name(p.get("sale_id")),
            "customer_name": _name(p.get("partner_id")),
            "picking_id": _id(m["picking_id"]), "picking_name": p.get("name"),
            "is_backorder": bool(p.get("backorder_id")), "qty_short": qty_short,
            "qty_ordered": _f(m["product_uom_qty"]), "since": since,
        })

    products, external_rows = [], []
    for pid, row in rows.items():
        needed = round(row["needed"], 3)
        free_here = receiving_stock.get(pid, {}).get("free", 0.0)
        covered_here = min(max(free_here, 0.0), needed)
        still_needed = round(needed - covered_here, 3)
        requested = round(po.get(pid, {}).get("from_supplier", 0.0), 3)
        gmp_free = supplier_stock.get(pid, {}).get("free", 0.0)
        row.update({
            "needed": needed,
            "stock_here_unreserved": round(covered_here, 3),
            "still_needed": still_needed,
            "requested": requested,
            "uncovered": round(max(still_needed - requested - in_transit.get(pid, 0.0), 0.0), 3),
            "in_transit": round(in_transit.get(pid, 0.0), 3),
            "supplier_open": round(sup_open.get(pid, 0.0), 3),
            "supplier_ready": round(sup_ready.get(pid, 0.0), 3),
            "supplier_on_hand": round(supplier_stock.get(pid, {}).get("on_hand", 0.0), 3),
            "supplier_free": round(gmp_free, 3),
            "order_count": len({o["sale_order_id"] for o in row["orders"]}),
        })
        row["orders"].sort(key=lambda o: o["since"] or "")
        if pid in external:
            row["vendor"] = external[pid]
            row["external_on_order"] = round(po.get(pid, {}).get("from_external", 0.0), 3)
            row["external_orders"] = sorted(o for o in po.get(pid, {}).get("external_orders", set()) if o)
            row["status"] = "stock_here" if still_needed <= 0 else ("external_on_order" if row["external_on_order"] > 0 else "external_needs_ordering")
            external_rows.append(row)
            continue
        if still_needed <= 0:
            status = "stock_here"
        elif row["in_transit"] > 0:
            status = "in_transit"
        elif row["supplier_ready"] > 0 or (requested > 0 and gmp_free > 0):
            status = "ready_to_dispatch"
        elif row["uncovered"] > 0:
            status = "needs_requesting"
        else:
            status = "requested"
        row["status"] = status
        products.append(row)

    order_rank = {"needs_requesting": 0, "ready_to_dispatch": 1, "in_transit": 2, "stock_here": 3, "requested": 4}
    products.sort(key=lambda r: (order_rank.get(r["status"], 9), r["oldest_since"] or ""))
    external_rows.sort(key=lambda r: r["oldest_since"] or "")
    counts: dict = defaultdict(int)
    for r in products:
        counts[r["status"]] += 1
    return {
        "products": products,
        "external": external_rows,
        "summary": {
            "products_short": len(products) + len(external_rows),
            "orders_waiting": len({o["sale_order_id"] for r in products + external_rows for o in r["orders"]}),
            **{k: counts.get(k, 0) for k in order_rank},
        },
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


def order_request_plan(odoo, cfg: dict, sale_order_id: int) -> dict:
    """What to request from the supplier for one customer order (automatic
    request at deposit, 2026-10-11). Per product, request the order's own
    shortfall, capped by what nobody has covered yet across all waiting orders
    (free stock here, open purchase orders to the supplier, stock in transit),
    so a product already requested by hand or for another order is never
    requested twice. Products bought from external suppliers are left to staff."""
    so = odoo.read("sale.order", [sale_order_id], fields=["name"])
    order_name = so[0]["name"] if so else f"#{sale_order_id}"
    mine = odoo.search_read("stock.move", [
        ("picking_id.picking_type_code", "=", "outgoing"),
        ("picking_id.picking_type_id.warehouse_id", "=", cfg["receiving_warehouse_id"]),
        ("picking_id.sale_id", "=", sale_order_id),
        ("picking_id.state", "not in", ["draft", "done", "cancel"]),
        ("state", "in", DEMAND_MOVE_STATES),
    ], fields=["product_id", "product_uom_qty", "quantity"], limit=500)
    order_short: dict = defaultdict(float)
    names: dict = {}
    for m in mine:
        short = _f(m["product_uom_qty"]) - _f(m["quantity"])
        if short > 0.0001:
            pid = _id(m["product_id"])
            order_short[pid] += short
            names[pid] = _name(m["product_id"])
    out = {"order_name": order_name, "lines": [], "external": [], "covered": []}
    if not order_short:
        return out
    pids = sorted(order_short)
    demand = odoo.search_read("stock.move", [
        ("picking_id.picking_type_code", "=", "outgoing"),
        ("picking_id.picking_type_id.warehouse_id", "=", cfg["receiving_warehouse_id"]),
        ("picking_id.sale_id", "!=", False),
        ("picking_id.state", "not in", ["draft", "done", "cancel"]),
        ("state", "in", DEMAND_MOVE_STATES),
        ("product_id", "in", pids),
    ], fields=["product_id", "product_uom_qty", "quantity"], limit=3000)
    needed: dict = defaultdict(float)
    for m in demand:
        needed[_id(m["product_id"])] += max(_f(m["product_uom_qty"]) - _f(m["quantity"]), 0.0)
    here = _product_stock(odoo, pids, cfg["receiving_warehouse_id"])
    po = _po_outstanding(odoo, cfg, pids)
    transit: dict = defaultdict(float)
    for m in _in_transit_moves(odoo, cfg, pids):
        transit[_id(m["product_id"])] += _f(m["product_uom_qty"])
    external = _external_products(odoo, cfg, pids)
    for pid in pids:
        entry = {"product_id": pid, "product_name": names.get(pid), "order_short": round(order_short[pid], 3)}
        if pid in external:
            out["external"].append({**entry, "vendor": external[pid]})
            continue
        total = max(needed[pid], order_short[pid])
        uncovered = total - min(max(here.get(pid, {}).get("free", 0.0), 0.0), total) \
            - po.get(pid, {}).get("from_supplier", 0.0) - transit[pid]
        qty = round(min(order_short[pid], max(uncovered, 0.0)), 3)
        if qty > 0:
            out["lines"].append({**entry, "qty": qty})
        else:
            out["covered"].append(entry)
    return out


def supplier_deliveries(odoo, cfg: dict, include_waiting: bool = True) -> list:
    """Open supplier deliveries to the receiving company, with their lines,
    reserved quantities and batches, and the purchase order behind each."""
    states = ["confirmed", "waiting", "assigned"] if include_waiting else ["assigned"]
    picks = odoo.search_read("stock.picking", [
        ("company_id", "=", cfg["supplier_company_id"]),
        ("picking_type_code", "=", "outgoing"),
        ("partner_id", "child_of", cfg["receiving_partner_id"]),
        ("state", "in", states),
    ], fields=["name", "state", "sale_id", "origin", "scheduled_date", "create_date", "move_ids", "location_id"],
        order="create_date asc", limit=500)
    if not picks:
        return []
    move_ids = [m for p in picks for m in p.get("move_ids", [])]
    moves = odoo.read("stock.move", move_ids, fields=["product_id", "product_uom_qty", "quantity", "state", "move_line_ids"]) if move_ids else []
    ml_ids = [ml for m in moves for ml in m.get("move_line_ids", [])]
    mls = {ml["id"]: ml for ml in odoo.read("stock.move.line", ml_ids, fields=["lot_id", "quantity", "product_id"])} if ml_ids else {}
    so_ids = sorted({_id(p["sale_id"]) for p in picks if p.get("sale_id")})
    sos = {s["id"]: s for s in odoo.read("sale.order", so_ids, fields=["name", "client_order_ref", "auto_purchase_order_id"])} if so_ids else {}
    by_move = {m["id"]: m for m in moves}
    out = []
    for p in picks:
        lines = []
        for mid in p.get("move_ids", []):
            m = by_move.get(mid)
            if not m or m["state"] in ("cancel", "done"):
                continue
            lines.append({
                "move_id": m["id"], "product_id": _id(m["product_id"]), "product_name": _name(m["product_id"]),
                "demand": _f(m["product_uom_qty"]), "reserved": _f(m["quantity"]), "state": m["state"],
                "move_lines": [{"move_line_id": i, "lot_id": _id(mls[i].get("lot_id")), "lot_name": _name(mls[i].get("lot_id")),
                                "quantity": _f(mls[i].get("quantity"))} for i in m.get("move_line_ids", []) if i in mls],
            })
        so = sos.get(_id(p.get("sale_id"))) or {}
        reserved = sum(l["reserved"] for l in lines)
        demand = sum(l["demand"] for l in lines)
        out.append({
            "picking_id": p["id"], "name": p["name"], "state": p["state"],
            "readiness": "ready" if p["state"] == "assigned" and reserved >= demand - 0.0001 else
                         ("partial" if reserved > 0 else "waiting"),
            "sale_order": so.get("name"), "purchase_order": so.get("client_order_ref") or _name(so.get("auto_purchase_order_id")),
            "created": p.get("create_date"), "scheduled": p.get("scheduled_date"),
            "location_id": _id(p.get("location_id")), "lines": lines,
            "demand": round(demand, 3), "reserved": round(reserved, 3),
        })
    return out


def transit_receipts(odoo, cfg: dict) -> list:
    """Receiving-company receipts with lines waiting in transit: stock Odoo
    says has left the supplier but was never received."""
    moves = _in_transit_moves(odoo, cfg)
    if not moves:
        return []
    pids = sorted({_id(m["picking_id"]) for m in moves})
    picks = odoo.read("stock.picking", pids, fields=["name", "origin", "create_date", "state"])
    per: dict = defaultdict(lambda: {"lines": 0, "qty": 0.0})
    for m in moves:
        per[_id(m["picking_id"])]["lines"] += 1
        per[_id(m["picking_id"])]["qty"] += _f(m["product_uom_qty"])
    return [{"picking_id": p["id"], "name": p["name"], "origin": p.get("origin") or None, "created": p.get("create_date"),
             "state": p["state"], "lines": per[p["id"]]["lines"], "qty": round(per[p["id"]]["qty"], 3)} for p in picks]


# ── Writes ────────────────────────────────────────────────────────────────────

def _check_supplier_picking(odoo, cfg: dict, picking_id: int) -> dict:
    rows = odoo.read("stock.picking", [picking_id], fields=["name", "state", "company_id", "picking_type_code", "partner_id", "sale_id", "move_ids"])
    if not rows:
        raise SupplyError("That delivery no longer exists in Odoo.")
    p = rows[0]
    if _id(p["company_id"]) != cfg["supplier_company_id"] or p["picking_type_code"] != "outgoing":
        raise SupplyError(f"{p['name']} isn't a {cfg['supplier_company_name']} delivery.")
    if p["state"] in ("done", "cancel"):
        raise SupplyError(f"{p['name']} is already {'dispatched' if p['state'] == 'done' else 'cancelled'}.")
    partner = _id(p["partner_id"])
    if partner and partner != cfg["receiving_partner_id"]:
        cp = odoo.read("res.partner", [partner], fields=["commercial_partner_id"])
        if not cp or _id(cp[0]["commercial_partner_id"]) != cfg["receiving_partner_id"]:
            raise SupplyError(f"{p['name']} isn't addressed to {cfg['receiving_company_name']}.")
    return p


def _validate_picking(odoo, picking_id: int, company_id: int, create_backorder: bool = True) -> Optional[str]:
    """button_validate plus Odoo's follow-up wizards. Returns the error text
    for a wizard the portal won't answer on someone's behalf, else None."""
    result = _call("stock.picking", "button_validate", [[picking_id]], {"context": _ctx(company_id)})
    if isinstance(result, dict) and result.get("res_model"):
        model = result["res_model"]
        ctx = {**(result.get("context") or {}), **_ctx(company_id)}
        if model == "stock.backorder.confirmation":
            wiz = odoo_call(model, "create", [{"pick_ids": [(4, picking_id)]}], {"context": ctx})
            method = "process" if create_backorder else "process_cancel_backorder"
            _call(model, method, [[wiz]], {"context": ctx})
        elif model == "expiry.picking.confirmation":
            return "A selected batch has passed its expiry date. Choose a different batch."
        else:
            return f"Odoo asked for a confirmation the portal can't give ({model}). Complete it in Odoo."
    return None


def _ensure_lot(odoo, product_id: int, lot_name: str, company_id: int, expiration_date: Optional[str] = None) -> int:
    rows = odoo.search_read("stock.lot", [("product_id", "=", product_id), ("name", "=", lot_name),
                                          "|", ("company_id", "=", company_id), ("company_id", "=", False)],
                            fields=["id"], limit=1)
    if rows:
        return rows[0]["id"]
    # Shared across companies (company_id False), like almost every batch
    # already in Odoo (2,996 of 3,000, live 2026-10-11): the batch has to stay
    # visible to La Farmacia after it's dispatched from GMP.
    vals = {"name": lot_name, "product_id": product_id, "company_id": False}
    if expiration_date:
        vals["expiration_date"] = f"{expiration_date[:10]} 00:00:00"
    return odoo_call("stock.lot", "create", [vals], {"context": _ctx(company_id)})


def book_in(odoo, cfg: dict, product_id: int, qty: float, lot_name: Optional[str], expiration_date: Optional[str]) -> dict:
    """Add stock at the supplier's stock location (Odoo inventory adjustment),
    on a batch for batch-tracked products. Adds to whatever is there."""
    if qty <= 0:
        raise SupplyError("Enter a quantity above zero.")
    prod = odoo.read("product.product", [product_id], fields=["display_name", "tracking"])
    if not prod:
        raise SupplyError("Product not found.")
    tracking = prod[0].get("tracking") or "none"
    company_id, location_id = cfg["supplier_company_id"], cfg["supplier_stock_location_id"]
    lot_id = None
    if tracking != "none":
        if not (lot_name or "").strip():
            raise SupplyError("This product is batch-tracked. Enter the batch number.")
        lot_id = _ensure_lot(odoo, product_id, lot_name.strip(), company_id, expiration_date)
    dom = [("product_id", "=", product_id), ("location_id", "=", location_id), ("lot_id", "=", lot_id or False)]
    quants = odoo.search_read("stock.quant", dom, fields=["id", "quantity"], limit=1, context=_ctx(company_id))
    ctx = _ctx(company_id, inventory_mode=True)
    before = _f(quants[0]["quantity"]) if quants else 0.0
    if quants:
        quant_id = quants[0]["id"]
        odoo_call("stock.quant", "write", [[quant_id], {"inventory_quantity": before + qty}], {"context": ctx})
    else:
        vals = {"product_id": product_id, "location_id": location_id, "inventory_quantity": qty}
        if lot_id:
            vals["lot_id"] = lot_id
        quant_id = odoo_call("stock.quant", "create", [vals], {"context": ctx})
    _call("stock.quant", "action_apply_inventory", [[quant_id]], {"context": ctx})
    after = odoo.read("stock.quant", [quant_id], fields=["quantity"], context=_ctx(company_id))
    return {"product_name": prod[0]["display_name"], "lot_id": lot_id, "lot_name": (lot_name or "").strip() or None,
            "before": before, "after": _f(after[0]["quantity"]) if after else before + qty}


def request_from_supplier(odoo, cfg: dict, lines: list, origin_orders: list, note: Optional[str]) -> dict:
    """Create and confirm the receiving company's purchase order to the
    supplier. Odoo's inter-company rules create the supplier's sales order;
    the portal never creates one itself, so nothing is ever duplicated."""
    clean = [(int(l["product_id"]), _f(l["qty"])) for l in lines if _f(l.get("qty")) > 0]
    if not clean:
        raise SupplyError("Choose at least one product with a quantity.")
    ctx = _ctx(cfg["receiving_company_id"])
    vals = {
        "partner_id": cfg["supplier_partner_id"],
        "company_id": cfg["receiving_company_id"],
        "origin": ", ".join(sorted({o for o in origin_orders if o}))[:250] or "Portal stock request",
        "order_line": [(0, 0, {"product_id": pid, "product_qty": q}) for pid, q in clean],
    }
    if cfg.get("receiving_in_type_id"):
        vals["picking_type_id"] = cfg["receiving_in_type_id"]
    po_id = odoo_call("purchase.order", "create", [vals], {"context": ctx})
    if note:
        # Odoo 19's purchase.order `note` is the printed Terms and Conditions,
        # so an internal note goes on the order's chatter instead.
        try:
            odoo.message_post("purchase.order", po_id, f"Stock request note: {note}")
        except Exception:
            pass
    try:
        _call("purchase.order", "button_confirm", [[po_id]], {"context": ctx})
    except Exception:
        state = odoo.read("purchase.order", [po_id], fields=["state"], context=ctx)
        if not state or state[0]["state"] not in ("purchase", "done", "to approve"):
            raise
    po = odoo.read("purchase.order", [po_id], fields=["name", "state", "amount_total"], context=ctx)[0]
    so = odoo.search_read("sale.order", [("auto_purchase_order_id", "=", po_id)], fields=["name", "state"], limit=1,
                          context=_ctx(cfg["supplier_company_id"]))
    return {
        "purchase_order_id": po_id, "purchase_order": po["name"], "po_state": po["state"],
        "supplier_sale_order": so[0]["name"] if so else None,
        "warning": None if so else (
            f"The purchase order was created, but {cfg['supplier_company_name']}'s sales order wasn't created automatically. "
            "Odoo's inter-company rules may be switched off; ask whoever manages Odoo."
        ),
    }


def _receive_picking(odoo, picking_id: int, company_id: int, lots_by_product: Optional[dict] = None) -> Optional[str]:
    """Validate a receipt at the quantities Odoo has available on it. When
    the supplier side's batches are passed in and the receipt lines have no
    batch yet (Odoo's sync normally copies them), set them by name."""
    p = odoo.read("stock.picking", [picking_id], fields=["state", "move_line_ids"], context=_ctx(company_id))
    if not p or p[0]["state"] in ("done", "cancel"):
        return None
    if p[0]["state"] != "assigned":
        _assign([picking_id], company_id)
        p = odoo.read("stock.picking", [picking_id], fields=["state", "move_line_ids"], context=_ctx(company_id))
    ml_ids = p[0].get("move_line_ids") or []
    if not ml_ids:
        return "Nothing on this receipt is available to receive yet."
    mls = odoo.read("stock.move.line", ml_ids, fields=["product_id", "quantity", "lot_id", "lot_name"], context=_ctx(company_id))
    for ml in mls:
        vals = {"picked": True}
        pid = _id(ml["product_id"])
        if lots_by_product and not ml.get("lot_id") and not ml.get("lot_name") and lots_by_product.get(pid):
            vals["lot_name"] = lots_by_product[pid].pop(0)
        odoo_call("stock.move.line", "write", [[ml["id"]], vals], {"context": _ctx(company_id)})
    return _validate_picking(odoo, picking_id, company_id, create_backorder=True)


def _matching_receipts(odoo, cfg: dict, supplier_picking: dict) -> list:
    """The receiving company's open receipts for the purchase order behind a
    supplier delivery (supplier sales order -> auto purchase order)."""
    so_id = _id(supplier_picking.get("sale_id"))
    if not so_id:
        return []
    so = odoo.read("sale.order", [so_id], fields=["auto_purchase_order_id"])
    po_id = _id(so[0].get("auto_purchase_order_id")) if so else None
    if not po_id:
        return []
    return odoo.search_read("stock.picking", [
        ("purchase_id", "=", po_id), ("picking_type_code", "=", "incoming"), ("state", "not in", ["done", "cancel"]),
    ], fields=["id", "name", "state"], context=_ctx(cfg["receiving_company_id"]))


def dispatch(odoo, cfg: dict, picking_id: int, lines: Optional[list]) -> dict:
    """Dispatch a supplier delivery to the receiving company. `lines` (optional)
    is [{move_line_id, quantity, lot_id?}] to dispatch less than reserved or
    change a batch; omitted, everything reserved goes. Anything not dispatched
    stays on a backorder at the supplier. Then make sure the receipt landed."""
    p = _check_supplier_picking(odoo, cfg, picking_id)
    sc = cfg["supplier_company_id"]
    if p["state"] != "assigned":
        _assign([picking_id], sc)
    pick = odoo.read("stock.picking", [picking_id], fields=["move_line_ids", "state"], context=_ctx(sc))[0]
    ml_ids = pick.get("move_line_ids") or []
    if not ml_ids:
        raise SupplyError(f"Nothing on {p['name']} is reserved at {cfg['supplier_warehouse_name']}. "
                          "Book the stock in at GMP first, then dispatch.")
    current = {ml["id"]: ml for ml in odoo.read("stock.move.line", ml_ids, fields=["product_id", "quantity", "lot_id"], context=_ctx(sc))}
    wanted = {int(l["move_line_id"]): l for l in (lines or []) if l.get("move_line_id") is not None}
    unknown = set(wanted) - set(current)
    if unknown:
        raise SupplyError("The delivery changed in Odoo since it was loaded. Refresh and try again.")
    any_picked = False
    for ml_id, ml in current.items():
        if wanted:
            w = wanted.get(ml_id)
            if not w or _f(w.get("quantity")) <= 0:
                odoo_call("stock.move.line", "write", [[ml_id], {"picked": False}], {"context": _ctx(sc)})
                continue
            vals = {"quantity": _f(w["quantity"]), "picked": True}
            if w.get("lot_id") and w.get("lot_id") != _id(ml.get("lot_id")):
                vals["lot_id"] = int(w["lot_id"])
        else:
            vals = {"picked": True}
        odoo_call("stock.move.line", "write", [[ml_id], vals], {"context": _ctx(sc)})
        any_picked = True
    if not any_picked:
        raise SupplyError("Nothing selected to dispatch.")

    err = _validate_picking(odoo, picking_id, sc, create_backorder=True)
    if err:
        raise SupplyError(err)
    after = odoo.read("stock.picking", [picking_id], fields=["state"], context=_ctx(sc))[0]
    if after["state"] != "done":
        raise SupplyError(f"{p['name']} didn't complete in Odoo (state: {after['state']}).")
    backorder = odoo.search_read("stock.picking", [("backorder_id", "=", picking_id), ("state", "not in", ["done", "cancel"])],
                                 fields=["name"], limit=1, context=_ctx(sc))

    # Batches actually dispatched, for a receipt Odoo didn't sync.
    done_mls = odoo.search_read("stock.move.line", [("picking_id", "=", picking_id), ("picked", "=", True)],
                                fields=["product_id", "lot_id"], context=_ctx(sc))
    lots: dict = defaultdict(list)
    for ml in done_mls:
        if ml.get("lot_id"):
            lots[_id(ml["product_id"])].append(_name(ml["lot_id"]))

    received, receipt_errors = [], []
    for r in _matching_receipts(odoo, cfg, p):
        try:
            rerr = _receive_picking(odoo, r["id"], cfg["receiving_company_id"], lots)
            if rerr:
                receipt_errors.append(f"{r['name']}: {rerr}")
            else:
                received.append(r["name"])
        except Exception as e:
            receipt_errors.append(f"{r['name']}: {e}")
    return {
        "picking": p["name"], "backorder": backorder[0]["name"] if backorder else None,
        "received": received, "receipt_errors": receipt_errors,
        "product_ids": sorted({_id(ml["product_id"]) for ml in done_mls}),
    }


def receive_transit(odoo, cfg: dict, picking_id: int) -> dict:
    rows = odoo.read("stock.picking", [picking_id], fields=["name", "company_id", "picking_type_code", "state", "move_ids"])
    if not rows or _id(rows[0]["company_id"]) != cfg["receiving_company_id"] or rows[0]["picking_type_code"] != "incoming":
        raise SupplyError("That isn't a receipt for the receiving company.")
    err = _receive_picking(odoo, picking_id, cfg["receiving_company_id"])
    if err:
        raise SupplyError(err)
    moves = odoo.read("stock.move", rows[0]["move_ids"], fields=["product_id"]) if rows[0].get("move_ids") else []
    return {"picking": rows[0]["name"], "product_ids": sorted({_id(m["product_id"]) for m in moves})}


def picking_lot_names(odoo, picking_id: int, lines: Optional[list] = None) -> set:
    """Batch names a dispatch/receipt would move. With `lines` (dispatch
    overrides), a changed batch counts instead of the reserved one and lines
    set to 0 don't count."""
    p = odoo.read("stock.picking", [picking_id], fields=["move_line_ids"])
    ml_ids = (p[0].get("move_line_ids") or []) if p else []
    if not ml_ids:
        return set()
    mls = {ml["id"]: ml for ml in odoo.read("stock.move.line", ml_ids, fields=["lot_id", "lot_name"])}
    wanted = {int(l["move_line_id"]): l for l in (lines or []) if l.get("move_line_id") is not None}
    lot_ids, names = set(), set()
    for ml_id, ml in mls.items():
        w = wanted.get(ml_id)
        if wanted and (not w or _f(w.get("quantity")) <= 0):
            continue
        if w and w.get("lot_id"):
            lot_ids.add(int(w["lot_id"]))
        elif ml.get("lot_id"):
            names.add(_name(ml["lot_id"]))
        elif ml.get("lot_name"):
            names.add(ml["lot_name"])
    if lot_ids:
        names.update(r["name"] for r in odoo.read("stock.lot", sorted(lot_ids), fields=["name"]))
    return {n for n in names if n}


def product_lots(odoo, product_id: int, location_id: int) -> list:
    """Existing Odoo batches for a product, with quantity at a location."""
    lots = odoo.search_read("stock.lot", [("product_id", "=", product_id)],
                            fields=["name", "expiration_date", "create_date"], limit=200, order="create_date desc")
    if not lots:
        return []
    qty: dict = defaultdict(float)
    for q in odoo.search_read("stock.quant", [("product_id", "=", product_id), ("location_id", "child_of", location_id),
                                              ("lot_id", "in", [l["id"] for l in lots])],
                              fields=["lot_id", "quantity"], limit=1000):
        qty[_id(q["lot_id"])] += _f(q["quantity"])
    return [{"lot_id": l["id"], "name": l["name"], "qty_here": round(qty.get(l["id"], 0.0), 3),
             "expiration_date": (l.get("expiration_date") or "")[:10] or None} for l in lots]


def reserve_waiting_deliveries(odoo, cfg: dict, product_ids: list) -> int:
    """Check availability on the receiving warehouse's customer deliveries that
    are waiting for any of these products, so newly arrived stock gets
    reserved straight away. Returns how many deliveries were checked."""
    if not product_ids:
        return 0
    moves = odoo.search_read("stock.move", [
        ("picking_id.picking_type_code", "=", "outgoing"),
        ("picking_id.picking_type_id.warehouse_id", "=", cfg["receiving_warehouse_id"]),
        ("picking_id.sale_id", "!=", False),
        ("state", "in", DEMAND_MOVE_STATES),
        ("product_id", "in", product_ids),
    ], fields=["picking_id"], limit=2000)
    pids = sorted({_id(m["picking_id"]) for m in moves})
    for pid in pids:
        try:
            _assign([pid], cfg["receiving_company_id"])
        except Exception:
            continue
    return len(pids)
