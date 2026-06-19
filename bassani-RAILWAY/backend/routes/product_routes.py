from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client
from warehouse_context import resolve_warehouse_id, odoo_context

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

class ProductUpdate(BaseModel):
    name: Optional[str] = None
    default_code: Optional[str] = None
    list_price: Optional[float] = None
    standard_price: Optional[float] = None
    description: Optional[str] = None
    active: Optional[bool] = None

class StockAdjustment(BaseModel):
    qty: float

# ── Endpoints ─────────────────────────────────────────────────────────────────

PRODUCT_FIELDS = [
    "id", "name", "display_name", "default_code", "type", "categ_id",
    "lst_price", "standard_price", "uom_id",
    "qty_available", "virtual_available",
    "description", "active", "product_tmpl_id",
]


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
        domain.append(("name", "ilike", search))

    # Category filter using Odoo's categ_id.name
    if category and category != "all":
        domain.append(("categ_id.name", "ilike", category))

    warehouse_id = await resolve_warehouse_id(current_user)

    try:
        products = odoo.search_read(
            "product.product",
            domain=domain,
            fields=PRODUCT_FIELDS,
            limit=limit,
            offset=offset,
            order=f"{sort_by} {sort_dir}",
            context=odoo_context(warehouse_id),
        )
        # Normalise lst_price → list_price so the frontend doesn't need to change
        for p in products:
            p["list_price"] = p.pop("lst_price", 0)
        total = odoo.count("product.product", domain)
        return {"products": products, "total": total, "limit": limit, "offset": offset}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/categories")
def list_categories(current_user: dict = Depends(get_current_user)):
    """
    Return unique product categories derived from active storable products.
    Keys match the exact categ_id display name on each product — used to ensure
    commission rate keys align with what the cart sees at order time.
    """
    odoo = get_odoo_client()
    try:
        products = odoo.search_read(
            "product.product",
            domain=[("type", "=", "consu"), ("active", "=", True)],
            fields=["categ_id"],
            limit=2000,
        )
        seen: dict = {}
        for p in products:
            if p.get("categ_id") and p["categ_id"] is not False:
                cat_id, cat_name = p["categ_id"]
                seen[cat_id] = cat_name
        categories = sorted([{"id": k, "name": v} for k, v in seen.items()], key=lambda x: x["name"])
        return {"categories": categories}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


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
                ("qty_available", "<", 10),
            ],
            fields=["id", "name", "display_name", "default_code", "qty_available", "categ_id", "uom_id"],
            limit=50,
            order="name asc",
            context=odoo_context(warehouse_id),
        )
        return {"products": products, "total": len(products)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{product_id}")
async def get_product(product_id: int, current_user: dict = Depends(get_current_user)):
    """Get a single product variant by its Odoo product.product ID."""
    odoo = get_odoo_client()
    warehouse_id = await resolve_warehouse_id(current_user)
    try:
        records = odoo.read("product.product", [product_id], fields=PRODUCT_FIELDS, context=odoo_context(warehouse_id))
        if not records:
            raise HTTPException(status_code=404, detail="Product not found")
        records[0]["list_price"] = records[0].pop("lst_price", 0)
        return records[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.post("/")
def create_product(
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

    try:
        template_id = odoo.create("product.template", vals)
        templates = odoo.read("product.template", [template_id], fields=["product_variant_ids"])
        variant_id = templates[0]["product_variant_ids"][0]
        return {"success": True, "product_id": variant_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/{product_id}")
def update_product(
    product_id: int,
    product: ProductUpdate,
    current_user: dict = Depends(require_admin),
):
    """
    Update a product variant in Odoo. Admin only.
    Name/SKU/price/category are template-level in this catalog (no per-variant
    overrides are exposed here), so the variant id is resolved to its parent
    template and the write happens there — editing any variant of a multi-variant
    product updates the fields shared by all its siblings.
    """
    odoo = get_odoo_client()
    vals = {k: v for k, v in product.model_dump().items() if v is not None}
    if not vals:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        variants = odoo.read("product.product", [product_id], fields=["product_tmpl_id"])
        if not variants:
            raise HTTPException(status_code=404, detail="Product not found")
        template_id = variants[0]["product_tmpl_id"][0]
        odoo.write("product.template", [template_id], vals)
        return {"success": True}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.delete("/{product_id}")
def archive_product(
    product_id: int,
    current_user: dict = Depends(require_admin),
):
    """Archive (soft-delete) a product in Odoo. Admin only.
    Archives the parent template, hiding all of its variants — not just the one
    that was clicked — matching the existing single-product semantics."""
    odoo = get_odoo_client()
    try:
        variants = odoo.read("product.product", [product_id], fields=["product_tmpl_id"])
        if not variants:
            raise HTTPException(status_code=404, detail="Product not found")
        template_id = variants[0]["product_tmpl_id"][0]
        odoo.write("product.template", [template_id], {"active": False})
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


@router.post("/{product_id}/stock")
def set_stock_level(
    product_id: int,
    body: StockAdjustment,
    current_user: dict = Depends(require_admin),
):
    """
    Set the on-hand stock for a product variant via Odoo inventory adjustment.
    Finds the main internal location, then writes inventory_quantity on
    stock.quant and applies the adjustment.
    """
    odoo = get_odoo_client()
    variant_id = product_id

    # Find the main internal stock location (WH/Stock preferred, else first internal)
    locs = odoo.search_read(
        "stock.location",
        domain=[("usage", "=", "internal"), ("active", "=", True), ("name", "ilike", "Stock")],
        fields=["id", "complete_name"],
        limit=1,
        order="id asc",
    )
    if not locs:
        locs = odoo.search_read(
            "stock.location",
            domain=[("usage", "=", "internal"), ("active", "=", True)],
            fields=["id", "complete_name"],
            limit=1,
            order="id asc",
        )
    if not locs:
        raise HTTPException(status_code=400, detail="No internal stock location found in Odoo")
    location_id = locs[0]["id"]

    try:
        # Find existing quant for this product+location or create one
        quants = odoo.search_read(
            "stock.quant",
            domain=[("product_id", "=", variant_id), ("location_id", "=", location_id)],
            fields=["id"],
            limit=1,
        )
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
        return {"success": True, "quant_id": quant_id, "location_id": location_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")
