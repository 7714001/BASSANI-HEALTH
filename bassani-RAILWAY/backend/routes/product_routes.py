from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from warehouse_context import resolve_warehouse_id, odoo_context, get_company_id
from middleware.audit import audit_log

router = APIRouter(prefix="/api/products", tags=["products"])

# ── Pydantic models ───────────────────────────────────────────────────────────

class ProductCreate(BaseModel):
    name: str
    default_code: Optional[str] = None          # SKU
    categ_id: Optional[int] = None              # Odoo category ID
    list_price: float = 0.0                     # Sale price
    standard_price: float = 0.0                 # Cost
    type: str = "product"                       # product | consu | service
    description: Optional[str] = None
    uom_id: Optional[int] = None                # Unit of measure (for grams etc.)
    tax_id: Optional[int] = None                # Customer Tax (account.tax), single select

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    default_code: Optional[str] = None
    categ_id: Optional[int] = None
    list_price: Optional[float] = None
    standard_price: Optional[float] = None
    description: Optional[str] = None
    uom_id: Optional[int] = None
    tax_id: Optional[int] = None
    active: Optional[bool] = None

class StockAdjustment(BaseModel):
    qty: float

class CategoryCreate(BaseModel):
    name: str
    parent_id: Optional[int] = None

class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    parent_id: Optional[int] = None

class UOMCreate(BaseModel):
    name: str
    category_id: int
    factor: float = 1.0
    uom_type: str = "bigger"    # reference | bigger | smaller

class UOMUpdate(BaseModel):
    name: str

# ── Endpoints ─────────────────────────────────────────────────────────────────

PRODUCT_FIELDS = [
    "id", "name", "display_name", "default_code", "type", "categ_id",
    "lst_price", "standard_price", "uom_id",
    "qty_available", "virtual_available", "taxes_id",
    "description", "active", "product_tmpl_id",
]


def _attach_tax_rates(odoo, products: list, company_id: Optional[int] = None) -> None:
    """Resolve each product's taxes_id into a single percentage rate.

    In a multi-company Odoo setup, taxes_id carries one tax record per company
    (e.g. 8 companies × 15% = 120% if naively summed). When company_id is
    provided we filter to only that company's taxes before summing. When it is
    not provided (all-warehouses view) we deduplicate by (amount, amount_type)
    so identical rates from multiple companies are counted only once.
    """
    tax_ids = {t for p in products for t in (p.get("taxes_id") or [])}
    tax_map: dict = {}
    if tax_ids:
        if company_id:
            taxes = odoo.search_read(
                "account.tax",
                domain=[("id", "in", list(tax_ids)), ("company_id", "=", company_id)],
                fields=["id", "amount", "amount_type"],
                limit=200,
            )
        else:
            taxes = odoo.read("account.tax", list(tax_ids), fields=["amount", "amount_type"])
        tax_map = {t["id"]: t for t in taxes}

    for p in products:
        ids = p.pop("taxes_id", None) or []
        applicable = [t for t in ids if t in tax_map]

        if company_id:
            rate = sum(
                tax_map[t]["amount"]
                for t in applicable
                if tax_map[t].get("amount_type") == "percent"
            )
        else:
            # Deduplicate identical rates from multi-company duplicates
            seen: set = set()
            rate = 0.0
            for t in applicable:
                tax = tax_map[t]
                if tax.get("amount_type") != "percent":
                    continue
                key = (tax["amount"], tax["amount_type"])
                if key not in seen:
                    seen.add(key)
                    rate += tax["amount"]

        p["tax_rate"] = rate
        p["tax_id"] = applicable[0] if applicable else None


@router.get("/")
async def list_products(
    search: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    sort_by: str = Query("name"),
    sort_dir: str = Query("asc"),
    current_user: dict = Depends(get_current_user),
):
    """
    List products from Odoo at the variant (product.product) level — not the
    template level — so each sellable SKU (e.g. each dosage/size) appears as
    its own row with its own stock and price, and the id returned is already
    the correct product.product id for order line creation.

    qty_available/virtual_available are scoped to the caller's resolved
    warehouse (their assigned vault, or the admin's active selection) so
    resellers/staff see stock for the warehouse their orders actually draw from.
    """
    _SORTABLE = {"name", "default_code", "list_price", "standard_price", "qty_available"}
    sort_by  = sort_by  if sort_by  in _SORTABLE          else "name"
    sort_dir = sort_dir if sort_dir in ("asc", "desc")    else "asc"
    odoo = get_odoo_client()
    domain = [("type", "=", "consu"), ("active", "=", True)]

    if search:
        domain += ["|", ("name", "ilike", search), ("default_code", "ilike", search)]

    # Category filter using Odoo's categ_id.name
    if category and category != "all":
        domain.append(("categ_id.name", "ilike", category))

    warehouse_id = await resolve_warehouse_id(current_user)
    company_id = get_company_id(odoo, warehouse_id)

    try:
        products = odoo.search_read(
            "product.product",
            domain=domain,
            fields=PRODUCT_FIELDS,
            limit=limit,
            offset=offset,
            order=f"{sort_by} {sort_dir}",
            context=odoo_context(warehouse_id, company_id),
        )
        # Normalise lst_price → list_price so the frontend doesn't need to change
        for p in products:
            p["list_price"] = p.pop("lst_price", 0)
        _attach_tax_rates(odoo, products, company_id)
        total = odoo.count("product.product", domain)
        return {"products": products, "total": total, "limit": limit, "offset": offset}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/categories")
def list_categories(current_user: dict = Depends(get_current_user)):
    """All product.category records from Odoo — used for the category dropdown and the
    Categories management page. Reading directly (not derived from products) so new
    categories appear immediately, before any products are assigned to them."""
    odoo = get_odoo_client()
    try:
        categories = odoo.search_read(
            "product.category",
            domain=[],
            fields=["id", "name", "complete_name", "parent_id"],
            limit=500,
            order="complete_name asc",
        )
        return {"categories": categories}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/categories")
def create_category(
    body: CategoryCreate,
    current_user: dict = Depends(require_admin),
):
    odoo = get_odoo_client()
    try:
        vals: dict = {"name": body.name}
        if body.parent_id:
            vals["parent_id"] = body.parent_id
        cat_id = odoo.create("product.category", vals)
        return {"success": True, "id": cat_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/categories/{category_id}")
def update_category(
    category_id: int,
    body: CategoryUpdate,
    current_user: dict = Depends(require_admin),
):
    odoo = get_odoo_client()
    try:
        vals: dict = {}
        if body.name is not None:
            vals["name"] = body.name
        if body.parent_id is not None:
            vals["parent_id"] = body.parent_id if body.parent_id else False
        if not vals:
            raise HTTPException(status_code=400, detail="Nothing to update")
        odoo.execute("product.category", "write", [[category_id], vals])
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.get("/low-stock")
async def low_stock_products(current_user: dict = Depends(get_current_user)):
    """Return variants where qty_available is below a threshold — checked
    per-variant so one low-stock dosage doesn't hide behind a sibling
    variant's healthy stock count. Scoped to the caller's resolved warehouse
    so the alert reflects the vault they actually pack from."""
    odoo = get_odoo_client()
    warehouse_id = await resolve_warehouse_id(current_user)
    try:
        products = odoo.search_read(
            "product.product",
            domain=[
                ("is_storable", "=", True),
                ("active", "=", True),
                ("virtual_available", "<", 10),
            ],
            fields=["id", "name", "display_name", "default_code", "virtual_available", "categ_id", "uom_id"],
            limit=50,
            order="name asc",
            context=odoo_context(warehouse_id),
        )
        return {"products": products, "total": len(products)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/taxes")
def list_taxes(current_user: dict = Depends(get_current_user)):
    """Available Odoo Customer Taxes — populates the Tax dropdown on the product form."""
    odoo = get_odoo_client()
    try:
        taxes = odoo.search_read(
            "account.tax",
            domain=[("type_tax_use", "=", "sale"), ("active", "=", True)],
            fields=["id", "name", "amount", "amount_type"],
            limit=100,
            order="amount asc",
        )
        return {"taxes": taxes}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/uom-categories")
def list_uom_categories(current_user: dict = Depends(get_current_user)):
    """UOM category groups (e.g. Unit, Weight, Volume) — used to populate the
    category picker when creating a new unit of measure. Returns empty list when
    UOM is not enabled in Odoo rather than raising an error."""
    odoo = get_odoo_client()
    try:
        cats = odoo.search_read(
            "uom.category",
            domain=[],
            fields=["id", "name"],
            limit=100,
            order="name asc",
        )
        return {"uom_categories": cats}
    except Exception as e:
        print(f"⚠️  uom-categories fetch failed (UOM may be disabled in Odoo): {e}")
        return {"uom_categories": []}


@router.get("/uoms")
def list_uoms(current_user: dict = Depends(get_current_user)):
    """Available Odoo Units of Measure — populates the UOM dropdown on the product form.
    Returns empty list when UOM is not enabled in Odoo rather than raising an error."""
    odoo = get_odoo_client()
    try:
        uoms = odoo.search_read(
            "uom.uom",
            domain=[("active", "=", True)],
            fields=["id", "name", "category_id"],
            limit=200,
            order="name asc",
        )
        return {"uoms": uoms}
    except Exception as e:
        print(f"⚠️  uoms fetch failed (UOM may be disabled in Odoo): {e}")
        return {"uoms": []}


@router.post("/uoms")
def create_uom(
    body: UOMCreate,
    current_user: dict = Depends(require_admin),
):
    odoo = get_odoo_client()
    try:
        uom_id = odoo.create("uom.uom", {
            "name": body.name,
            "category_id": body.category_id,
            "factor": body.factor,
            "uom_type": body.uom_type,
        })
        return {"success": True, "id": uom_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/uoms/{uom_id}")
def update_uom(
    uom_id: int,
    body: UOMUpdate,
    current_user: dict = Depends(require_admin),
):
    odoo = get_odoo_client()
    try:
        odoo.execute("uom.uom", "write", [[uom_id], {"name": body.name}])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/uoms/{uom_id}/archive")
def archive_uom(
    uom_id: int,
    current_user: dict = Depends(require_admin),
):
    odoo = get_odoo_client()
    try:
        odoo.execute("uom.uom", "write", [[uom_id], {"active": False}])
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.get("/{product_id}")
async def get_product(product_id: int, current_user: dict = Depends(get_current_user)):
    """Get a single product variant by its Odoo product.product ID."""
    odoo = get_odoo_client()
    warehouse_id = await resolve_warehouse_id(current_user)
    company_id = get_company_id(odoo, warehouse_id)
    try:
        records = odoo.read("product.product", [product_id], fields=PRODUCT_FIELDS, context=odoo_context(warehouse_id, company_id))
        if not records:
            raise HTTPException(status_code=404, detail="Product not found")
        records[0]["list_price"] = records[0].pop("lst_price", 0)
        _attach_tax_rates(odoo, records, company_id)
        return records[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/")
async def create_product(
    product: ProductCreate,
    current_user: dict = Depends(require_admin),
):
    """
    Create a new product in Odoo. Admin only.
    Creates a product.template — Odoo auto-creates its single default variant.
    Returns the variant (product.product) id, not the template id, so it's
    immediately usable with the stock-set and order-line endpoints below.
    """
    odoo = get_odoo_client()
    vals = {
        "name": product.name,
        "list_price": product.list_price,
        "standard_price": product.standard_price,
        "type": "consu",
        "is_storable": True,  # Enable inventory tracking
    }
    if product.default_code:
        vals["default_code"] = product.default_code
    if product.categ_id:
        vals["categ_id"] = product.categ_id
    if product.description:
        vals["description"] = product.description
    if product.uom_id:
        vals["uom_id"] = product.uom_id

    audit_after = dict(vals)
    if product.tax_id:
        vals["taxes_id"] = [(6, 0, [product.tax_id])]
        audit_after["tax_id"] = product.tax_id

    try:
        template_id = odoo.create("product.template", vals)
        templates = odoo.read("product.template", [template_id], fields=["product_variant_ids"])
        variant_id = templates[0]["product_variant_ids"][0]
        await audit_log("product.create", "product", variant_id, entity_label=product.name,
                        user=current_user, after=audit_after)
        return {"success": True, "product_id": variant_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/{product_id}")
async def update_product(
    product_id: int,
    product: ProductUpdate,
    current_user: dict = Depends(require_admin),
):
    """
    Update a product variant in Odoo. Admin only.
    Name/SKU/price/category/UOM/tax are template-level in this catalog (no
    per-variant overrides are exposed here), so the variant id is resolved to
    its parent template and the write happens there — editing any variant of
    a multi-variant product updates the fields shared by all its siblings.
    """
    odoo = get_odoo_client()
    after = {k: v for k, v in product.model_dump().items() if v is not None}
    if not after:
        raise HTTPException(status_code=400, detail="No fields to update")
    vals = dict(after)
    if "tax_id" in vals:
        vals["taxes_id"] = [(6, 0, [vals.pop("tax_id")])]
    try:
        variants = odoo.read("product.product", [product_id], fields=["product_tmpl_id", "name"])
        if not variants:
            raise HTTPException(status_code=404, detail="Product not found")
        template_id = variants[0]["product_tmpl_id"][0]
        odoo.write("product.template", [template_id], vals)
        await audit_log("product.update", "product", product_id, entity_label=variants[0].get("name", ""),
                        user=current_user, after=after)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.delete("/{product_id}")
async def archive_product(
    product_id: int,
    current_user: dict = Depends(require_admin),
):
    """Archive (soft-delete) a product in Odoo. Admin only.
    Archives the parent template, hiding all of its variants — not just the one
    that was clicked — matching the existing single-product semantics."""
    odoo = get_odoo_client()
    try:
        variants = odoo.read("product.product", [product_id], fields=["product_tmpl_id", "name"])
        if not variants:
            raise HTTPException(status_code=404, detail="Product not found")
        template_id = variants[0]["product_tmpl_id"][0]
        odoo.write("product.template", [template_id], {"active": False})
        await audit_log("product.archive", "product", product_id, entity_label=variants[0].get("name", ""),
                        user=current_user)
        return {"success": True, "message": "Product archived"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.get("/{product_id}/stock")
def get_product_stock(product_id: int, current_user: dict = Depends(get_current_user)):
    """Get stock levels per location for a product variant."""
    odoo = get_odoo_client()
    try:
        quants = odoo.search_read(
            "stock.quant",
            domain=[
                ("product_id", "=", product_id),
                ("location_id.usage", "=", "internal"),
            ],
            fields=["product_id", "location_id", "quantity", "reserved_quantity"],
            limit=50,
        )
        return {"stock": quants}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{product_id}/reservations")
async def get_product_reservations(product_id: int, current_user: dict = Depends(require_admin)):
    """
    Explains the gap between On Hand and Forecasted stock: lists the open
    (confirmed, not-yet-fully-delivered) sale orders currently reserving this
    product, so an admin unfamiliar with Odoo's stock model can see exactly
    where their stock went instead of just being told a number is lower.

    Scoped to the caller's resolved warehouse when one is selected — company-wide
    on "All warehouses", same as every other read in the multi-warehouse build.
    `warehouse_id` is a standard Odoo field that's normally always set (defaulted
    from the salesperson/company default warehouse), so most orders will show a
    real warehouse name. Orders with no `warehouse_id` at all (rare — only if
    something bypassed Odoo's normal defaulting) are still included rather than
    hidden, since silently dropping them would just relocate the "where did my
    stock go" confusion instead of resolving it.
    """
    odoo = get_odoo_client()
    warehouse_id = await resolve_warehouse_id(current_user)

    domain = [
        ("product_id", "=", product_id),
        ("order_id.state", "in", ["sale", "done"]),
    ]
    if warehouse_id:
        domain += ["|", ("order_id.warehouse_id", "=", warehouse_id), ("order_id.warehouse_id", "=", False)]

    try:
        lines = odoo.search_read(
            "sale.order.line",
            domain=domain,
            fields=["order_id", "product_uom_qty", "qty_delivered"],
            limit=500,
        )
        outstanding = [l for l in lines if l["product_uom_qty"] - l["qty_delivered"] > 0.001]
        if not outstanding:
            return {"reservations": [], "total_reserved": 0}

        order_ids = list({l["order_id"][0] for l in outstanding})
        orders = odoo.read("sale.order", order_ids, fields=["name", "partner_id", "date_order", "state", "warehouse_id"])
        order_map = {o["id"]: o for o in orders}

        reservations = []
        for l in outstanding:
            oid = l["order_id"][0]
            order = order_map.get(oid)
            if not order:
                continue
            qty_reserved = l["product_uom_qty"] - l["qty_delivered"]
            reservations.append({
                "order_id": oid,
                "order_name": order["name"],
                "customer_name": order["partner_id"][1] if order.get("partner_id") else "",
                "date_order": order.get("date_order"),
                "state": order["state"],
                "qty_reserved": qty_reserved,
                "warehouse_name": order["warehouse_id"][1] if order.get("warehouse_id") else None,
            })

        reservations.sort(key=lambda r: r["date_order"] or "", reverse=True)
        return {
            "reservations": reservations,
            "total_reserved": sum(r["qty_reserved"] for r in reservations),
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/{product_id}/stock")
async def set_stock_level(
    product_id: int,
    body: StockAdjustment,
    current_user: dict = Depends(require_admin),
):
    """
    Set the on-hand stock for a product variant via Odoo inventory adjustment,
    in the admin's currently selected warehouse.

    Requires a specific warehouse to be selected (not "All warehouses") —
    stock has to land in one physical place, and guessing which one risks
    silently dirtying the wrong vault's figures.
    """
    odoo = get_odoo_client()
    variant_id = product_id

    warehouse_id = await resolve_warehouse_id(current_user)
    if not warehouse_id:
        raise HTTPException(
            status_code=400,
            detail="Select a specific warehouse in the top-nav switcher before setting stock — "
                   "stock cannot be assigned while \"All warehouses\" is selected.",
        )

    warehouses = odoo.read("stock.warehouse", [warehouse_id], fields=["name", "lot_stock_id"])
    if not warehouses or not warehouses[0].get("lot_stock_id"):
        raise HTTPException(status_code=400, detail="Selected warehouse has no stock location configured in Odoo")
    location_id = warehouses[0]["lot_stock_id"][0]
    warehouse_name = warehouses[0]["name"]

    try:
        # Find existing quant for this product+location or create one
        quants = odoo.search_read(
            "stock.quant",
            domain=[("product_id", "=", variant_id), ("location_id", "=", location_id)],
            fields=["id", "quantity"],
            limit=1,
        )
        previous_qty = quants[0]["quantity"] if quants else 0
        if quants:
            quant_id = quants[0]["id"]
            odoo.write("stock.quant", [quant_id], {"inventory_quantity": body.qty})
        else:
            quant_id = odoo.create("stock.quant", {
                "product_id": variant_id,
                "location_id": location_id,
                "inventory_quantity": body.qty,
            })

        # Apply the inventory adjustment (creates the stock move)
        odoo.execute("stock.quant", "action_apply_inventory", [quant_id])

        await audit_log(
            "product.stock_set", "product", variant_id,
            user=current_user,
            before={"qty": previous_qty, "warehouse_id": warehouse_id, "warehouse_name": warehouse_name},
            after={"qty": body.qty, "warehouse_id": warehouse_id, "warehouse_name": warehouse_name},
        )
        return {"success": True, "quant_id": quant_id, "location_id": location_id, "warehouse_id": warehouse_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")
