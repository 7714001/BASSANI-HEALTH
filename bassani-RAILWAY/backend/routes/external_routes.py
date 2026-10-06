"""Phase 14.1–14.3 — the external (API-key) read API: catalogue, categories
and stock, scoped to the calling API client's warehouse/company.

Product universe and categories (2026-10-06): exactly what resellers and
customers see in their cart — products in the curated reseller catalogue
(`reseller_catalog`), grouped by the portal's own Parent Categories (7.12)
with the same "Uncategorised" bucket, never raw Odoo categories. A client
can be narrowed to some parent categories (`scoped_parent_category_ids`;
choosing a top-level one includes its sub-categories). Built from one
index per request (parent_categories.build_catalog_category_index).

Every route depends on `require_api_client` (external_auth.py) and is rate
limited per API key. Responses use a stable `{data, meta}` envelope and never
mention internal system names — integrators see "the catalogue service", not
the ERP behind it.

Pricing (14.1): Odoo's own pricelist price computation is a private method
that XML-RPC refuses to call remotely, so prices are resolved here by reading
`product.pricelist.item` directly. Supported: fixed-price items on a variant
(wins) or a template, min quantity ≤ 1, inside their date window — exactly
what the portal's Web Store screen (14.4) writes. Anything else falls back to
the product's sales price, flagged `source: "list_price"`.

Stock (14.3): the sellable figure is `free_qty` (on hand minus reserved), not
`qty_available` — a consumer must never be offered stock already promised to
another order. Exact numbers only for `stock_detail: "quantity"` clients;
the default is in-stock/out-of-stock only (the 2026-08-21 stock rule).
"""
import base64
import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response

from config import get_settings
from external_auth import api_key_rate_key, require_api_client
from odoo_client import get_odoo_client
from parent_categories import UNCATEGORISED, build_catalog_category_index, index_family_ids
from rate_limit import limiter
from warehouse_context import odoo_context

logger = logging.getLogger(__name__)
settings = get_settings()

router = APIRouter(prefix="/api/external/v1", tags=["external-api"])

READ_LIMIT = "120/minute"
MAX_PER_PAGE = 100

_PRODUCT_FIELDS = [
    "id", "name", "display_name", "default_code", "barcode", "uom_id",
    "lst_price", "taxes_id", "description_sale", "product_tmpl_id", "free_qty", "image_128",
]
_UNAVAILABLE = "The catalogue service is temporarily unavailable. Please retry shortly."


async def _scope(odoo, client: dict) -> tuple[dict, set]:
    """(category index, product ids this client may see): the reseller
    catalogue, narrowed to the client's parent categories when it has any."""
    index = await build_catalog_category_index(odoo)
    universe = set(index["catalog_ids"])
    scoped = client.get("scoped_parent_category_ids")
    if scoped:
        universe &= set().union(*(index_family_ids(index, c) for c in scoped))
    return index, universe


def _domain(universe: set) -> list:
    return [("type", "=", "consu"), ("active", "=", True), ("id", "in", sorted(universe))]


def _categories_for(index: dict, product_id: int) -> list:
    """The parent categories a product sits in, most specific first: a
    sub-category (with its parent) rather than the top-level one it rolls up
    into. A hand-picked product can legitimately sit in several (e.g. a
    "Specials" bucket as well as its usual home)."""
    if product_id in index["uncategorised"]:
        return [{"id": UNCATEGORISED, "name": "Uncategorised", "parent": None}]
    hits = {did for did, m in index["members"].items() if product_id in m}
    out = []
    for d in index["docs"]:
        did = str(d["_id"])
        if did not in hits:
            continue
        parent_id = d.get("parent_id")
        if parent_id:
            parent = index["docs_by_id"].get(parent_id)
            out.append({
                "id": did, "name": d.get("name", ""),
                "parent": {"id": parent_id, "name": parent.get("name", "")} if parent else None,
            })
        elif not any(index["docs_by_id"][h].get("parent_id") == did for h in hits):
            out.append({"id": did, "name": d.get("name", ""), "parent": None})
    return out


def _ctx(client: dict, **extra) -> dict:
    ctx = odoo_context(client.get("warehouse_id"), client.get("company_id")) or {}
    ctx.update(extra)
    return ctx


def _meta(client: dict, **extra) -> dict:
    return {"sandbox": bool(client.get("sandbox")), **extra}


# ── Pricing ───────────────────────────────────────────────────────────────────

def _pricelist_prices(odoo, pricelist_id: int, products: list) -> dict:
    """{product_id: fixed price} for every product with a usable fixed-price
    item on this pricelist. Variant-level items beat template-level ones."""
    if not products:
        return {}
    pids = [p["id"] for p in products]
    tmpl_ids = list({p["product_tmpl_id"][0] for p in products if p.get("product_tmpl_id")})
    items = odoo.search_read(
        "product.pricelist.item",
        domain=[
            ("pricelist_id", "=", pricelist_id),
            ("compute_price", "=", "fixed"),
            ("min_quantity", "<=", 1),
            "|",
            "&", ("applied_on", "=", "0_product_variant"), ("product_id", "in", pids),
            "&", ("applied_on", "=", "1_product"), ("product_tmpl_id", "in", tmpl_ids),
        ],
        fields=["applied_on", "product_id", "product_tmpl_id", "fixed_price", "date_start", "date_end"],
        limit=5000,
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None).strftime("%Y-%m-%d %H:%M:%S")
    variant, template = {}, {}
    for it in items:
        if it.get("date_start") and it["date_start"] > now:
            continue
        if it.get("date_end") and it["date_end"] < now:
            continue
        if it["applied_on"] == "0_product_variant" and it.get("product_id"):
            variant[it["product_id"][0]] = it["fixed_price"]
        elif it.get("product_tmpl_id"):
            template[it["product_tmpl_id"][0]] = it["fixed_price"]
    out = {}
    for p in products:
        if p["id"] in variant:
            out[p["id"]] = variant[p["id"]]
        elif p.get("product_tmpl_id") and p["product_tmpl_id"][0] in template:
            out[p["id"]] = template[p["product_tmpl_id"][0]]
    return out


def _company_taxes(odoo, products: list, company_id: Optional[int]) -> dict:
    """{tax_id: tax} for the client's own company only — taxes_id carries one
    tax per company on this multi-company instance, so summing them all would
    multiply VAT (see product_routes._attach_tax_rates)."""
    tax_ids = list({t for p in products for t in (p.get("taxes_id") or [])})
    if not tax_ids:
        return {}
    domain = [("id", "in", tax_ids)]
    if company_id:
        domain.append(("company_id", "=", company_id))
    rows = odoo.search_read("account.tax", domain=domain, fields=["id", "amount", "amount_type", "price_include"], limit=500)
    return {t["id"]: t for t in rows}


def _attach_prices(odoo, client: dict, products: list) -> None:
    """Sets p["_price"] (or None when the client has no pricelist)."""
    if not client.get("pricelist_id"):
        for p in products:
            p["_price"] = None
        return
    fixed = _pricelist_prices(odoo, client["pricelist_id"], products)
    taxes = _company_taxes(odoo, products, client.get("company_id"))
    for p in products:
        applicable = [taxes[t] for t in (p.get("taxes_id") or []) if t in taxes and taxes[t].get("amount_type") == "percent"]
        rate = sum(t["amount"] for t in applicable) / 100.0
        included = any(t.get("price_include") for t in applicable)
        base = fixed.get(p["id"], p.get("lst_price") or 0.0)
        ex_vat = base / (1 + rate) if included and rate else base
        inc_vat = base if included else base * (1 + rate)
        p["_price"] = {
            "currency": "ZAR",
            "ex_vat": round(ex_vat, 2),
            "inc_vat": round(inc_vat, 2),
            "vat_rate": round(rate * 100, 2),
            "source": "pricelist" if p["id"] in fixed else "list_price",
        }


# ── Serialisation ─────────────────────────────────────────────────────────────

def _stock_out(client: dict, p: dict) -> dict:
    free = max(p.get("free_qty") or 0.0, 0.0)
    out = {"in_stock": free > 0}
    if client.get("stock_detail") == "quantity":
        out["qty_available"] = free
    return out


def _display_name(p: dict) -> str:
    """display_name carries the variant (e.g. "(1 PER TUBE)") but Odoo also
    prefixes it with "[SKU] " — strip that, since sku is its own field."""
    name = p.get("display_name") or p.get("name") or ""
    code = p.get("default_code")
    if code and name.startswith(f"[{code}] "):
        name = name[len(code) + 3:]
    return name


def _product_out(client: dict, index: dict, p: dict) -> dict:
    return {
        "id": p["id"],
        "sku": p.get("default_code") or None,
        "barcode": p.get("barcode") or None,
        "name": _display_name(p),
        "description": p.get("description_sale") or None,
        "categories": _categories_for(index, p["id"]),
        "unit": p["uom_id"][1] if p.get("uom_id") else None,
        "price": p.get("_price"),
        **_stock_out(client, p),
        # image_128 is read with bin_size=True, so it's a size label (or
        # False) — tells us an image exists without transferring it.
        "image_url": f"{settings.portal_url}/api/external/v1/products/{p['id']}/image" if p.get("image_128") else None,
    }


def _read_scoped(odoo, client: dict, universe: set, product_id: int, fields: list) -> dict:
    if product_id not in universe:
        raise HTTPException(status_code=404, detail="Product not found")
    rows = odoo.search_read(
        "product.product",
        domain=_domain({product_id}),
        fields=fields, limit=1, context=_ctx(client, bin_size=True),
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Product not found")
    return rows[0]


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/ping")
@limiter.limit(READ_LIMIT, key_func=api_key_rate_key)
async def ping(request: Request, client: dict = Depends(require_api_client)):
    """Connectivity + credential check for integrators."""
    return {
        "data": {
            "client": client.get("name"),
            "warehouse": client.get("warehouse_name"),
            "prices_included": bool(client.get("pricelist_id")),
            "stock_detail": client.get("stock_detail", "binary"),
        },
        "meta": _meta(client),
    }


@router.get("/categories")
@limiter.limit(READ_LIMIT, key_func=api_key_rate_key)
async def list_categories(request: Request, client: dict = Depends(require_api_client)):
    """The parent-category tree as the cart shows it: top-level categories
    with their sub-categories, product counts limited to this client's
    scope, empty ones left out, and Uncategorised last when it has any."""
    odoo = get_odoo_client()
    try:
        index, universe = await _scope(odoo, client)
    except Exception as e:
        logger.error("external_categories_failed client_id=%s error=%s", client["id"], e)
        raise HTTPException(status_code=502, detail=_UNAVAILABLE)

    data = []
    for d in index["docs"]:
        if d.get("parent_id"):
            continue
        did = str(d["_id"])
        count = len(index_family_ids(index, did) & universe)
        if not count:
            continue
        children = []
        for c in index["docs"]:
            if c.get("parent_id") != did:
                continue
            c_count = len(index_family_ids(index, str(c["_id"])) & universe)
            if c_count:
                children.append({"id": str(c["_id"]), "name": c.get("name", ""), "product_count": c_count})
        data.append({"id": did, "name": d.get("name", ""), "product_count": count, "children": children})
    unc = len(index["uncategorised"] & universe)
    if unc:
        data.append({"id": UNCATEGORISED, "name": "Uncategorised", "product_count": unc, "children": []})
    return {"data": data, "meta": _meta(client, total=len(data))}


@router.get("/products")
@limiter.limit(READ_LIMIT, key_func=api_key_rate_key)
async def list_products(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=MAX_PER_PAGE),
    category_id: Optional[str] = Query(
        None, max_length=64,
        description='A category id from /categories (includes its sub-categories), or "uncategorised"',
    ),
    search: Optional[str] = Query(None, max_length=100),
    client: dict = Depends(require_api_client),
):
    odoo = get_odoo_client()
    try:
        index, universe = await _scope(odoo, client)
    except Exception as e:
        logger.error("external_products_scope_failed client_id=%s error=%s", client["id"], e)
        raise HTTPException(status_code=502, detail=_UNAVAILABLE)
    if category_id:
        if category_id != UNCATEGORISED and category_id not in index["docs_by_id"]:
            raise HTTPException(status_code=404, detail="Unknown category")
        universe &= index_family_ids(index, category_id)
    domain = _domain(universe)
    if search:
        domain += ["|", ("name", "ilike", search), ("default_code", "ilike", search)]
    try:
        total = odoo.count("product.product", domain, context=_ctx(client))
        products = odoo.search_read(
            "product.product", domain=domain, fields=_PRODUCT_FIELDS,
            limit=per_page, offset=(page - 1) * per_page, order="name asc, id asc",
            context=_ctx(client, bin_size=True),
        )
        _attach_prices(odoo, client, products)
    except Exception as e:
        logger.error("external_products_failed client_id=%s error=%s", client["id"], e)
        raise HTTPException(status_code=502, detail=_UNAVAILABLE)
    return {
        "data": [_product_out(client, index, p) for p in products],
        "meta": _meta(client, page=page, per_page=per_page, total=total),
    }


@router.get("/products/{product_id}")
@limiter.limit(READ_LIMIT, key_func=api_key_rate_key)
async def get_product(request: Request, product_id: int, client: dict = Depends(require_api_client)):
    odoo = get_odoo_client()
    try:
        index, universe = await _scope(odoo, client)
        p = _read_scoped(odoo, client, universe, product_id, _PRODUCT_FIELDS)
        _attach_prices(odoo, client, [p])
    except HTTPException:
        raise
    except Exception as e:
        logger.error("external_product_failed client_id=%s product_id=%s error=%s", client["id"], product_id, e)
        raise HTTPException(status_code=502, detail=_UNAVAILABLE)
    return {"data": _product_out(client, index, p), "meta": _meta(client)}


_IMAGE_SIGNATURES = [
    (b"\x89PNG", "image/png"),
    (b"\xff\xd8\xff", "image/jpeg"),
    (b"RIFF", "image/webp"),
    (b"GIF8", "image/gif"),
]


@router.get("/products/{product_id}/image")
@limiter.limit(READ_LIMIT, key_func=api_key_rate_key)
async def get_product_image(request: Request, product_id: int, client: dict = Depends(require_api_client)):
    """The product's 1024px image as raw bytes, for the `image_url` above."""
    odoo = get_odoo_client()
    try:
        _, universe = await _scope(odoo, client)
        _read_scoped(odoo, client, universe, product_id, ["id"])   # 404s if outside this client's scope
        rows = odoo.read("product.product", [product_id], fields=["image_1024"])
    except HTTPException:
        raise
    except Exception as e:
        logger.error("external_product_image_failed client_id=%s product_id=%s error=%s", client["id"], product_id, e)
        raise HTTPException(status_code=502, detail=_UNAVAILABLE)
    if not rows or not rows[0].get("image_1024"):
        raise HTTPException(status_code=404, detail="This product has no image")
    data = base64.b64decode(rows[0]["image_1024"])
    media_type = next((m for sig, m in _IMAGE_SIGNATURES if data.startswith(sig)), "application/octet-stream")
    return Response(content=data, media_type=media_type, headers={"Cache-Control": "private, max-age=3600"})


@router.get("/stock")
@limiter.limit(READ_LIMIT, key_func=api_key_rate_key)
async def list_stock(
    request: Request,
    page: int = Query(1, ge=1),
    per_page: int = Query(MAX_PER_PAGE, ge=1, le=500),
    client: dict = Depends(require_api_client),
):
    """Lightweight stock-only feed for frequent polling — no prices, images
    or descriptions. Larger page size than /products since rows are tiny."""
    odoo = get_odoo_client()
    try:
        _, universe = await _scope(odoo, client)
        domain = _domain(universe)
        total = odoo.count("product.product", domain, context=_ctx(client))
        rows = odoo.search_read(
            "product.product", domain=domain, fields=["id", "default_code", "free_qty"],
            limit=per_page, offset=(page - 1) * per_page, order="id asc", context=_ctx(client),
        )
    except Exception as e:
        logger.error("external_stock_failed client_id=%s error=%s", client["id"], e)
        raise HTTPException(status_code=502, detail=_UNAVAILABLE)
    data = [{"product_id": r["id"], "sku": r.get("default_code") or None, **_stock_out(client, r)} for r in rows]
    return {"data": data, "meta": _meta(client, page=page, per_page=per_page, total=total)}


@router.get("/stock/{product_id}")
@limiter.limit(READ_LIMIT, key_func=api_key_rate_key)
async def get_stock(request: Request, product_id: int, client: dict = Depends(require_api_client)):
    odoo = get_odoo_client()
    try:
        _, universe = await _scope(odoo, client)
        r = _read_scoped(odoo, client, universe, product_id, ["id", "default_code", "free_qty"])
    except HTTPException:
        raise
    except Exception as e:
        logger.error("external_stock_one_failed client_id=%s product_id=%s error=%s", client["id"], product_id, e)
        raise HTTPException(status_code=502, detail=_UNAVAILABLE)
    return {"data": {"product_id": r["id"], "sku": r.get("default_code") or None, **_stock_out(client, r)}, "meta": _meta(client)}
