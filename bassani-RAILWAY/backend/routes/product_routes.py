from fastapi import APIRouter, Depends, HTTPException, Query
from typing import Optional
from pydantic import BaseModel
from auth import get_current_user, require_admin
from odoo_client import get_odoo_client

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

# ── Endpoints ─────────────────────────────────────────────────────────────────

PRODUCT_FIELDS = [
    "id", "name", "default_code", "type", "categ_id",
    "list_price", "standard_price", "uom_id",
    "qty_available", "virtual_available",
    "description", "active",
]


@router.get("/")
def list_products(
    search: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = Query(50, le=200),
    offset: int = 0,
    current_user: dict = Depends(get_current_user),
):
    """List all products from Odoo with optional search and category filter."""
    odoo = get_odoo_client()
    domain = [("type", "in", ["product", "consu"]), ("active", "=", True)]

    if search:
        domain.append(("name", "ilike", search))

    # Category filter using Odoo's categ_id.name
    if category and category != "all":
        domain.append(("categ_id.name", "ilike", category))

    try:
        products = odoo.search_read(
            "product.template",
            domain=domain,
            fields=PRODUCT_FIELDS,
            limit=limit,
            offset=offset,
            order="name asc",
        )
        total = odoo.count("product.template", domain)
        return {"products": products, "total": total, "limit": limit, "offset": offset}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/categories")
def list_categories(current_user: dict = Depends(get_current_user)):
    """Return all product categories from Odoo."""
    odoo = get_odoo_client()
    try:
        cats = odoo.search_read(
            "product.category",
            fields=["id", "name", "complete_name"],
            limit=200,
        )
        return {"categories": cats}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/low-stock")
def low_stock_products(current_user: dict = Depends(get_current_user)):
    """Return products where qty_available is below a threshold."""
    odoo = get_odoo_client()
    try:
        products = odoo.search_read(
            "product.template",
            domain=[
                ("type", "=", "product"),
                ("active", "=", True),
                ("qty_available", "<", 10),
            ],
            fields=["id", "name", "default_code", "qty_available", "categ_id", "uom_id"],
            limit=50,
            order="qty_available asc",
        )
        return {"products": products, "total": len(products)}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")


@router.get("/{product_id}")
def get_product(product_id: int, current_user: dict = Depends(get_current_user)):
    """Get a single product by Odoo ID."""
    odoo = get_odoo_client()
    try:
        records = odoo.read("product.template", [product_id], fields=PRODUCT_FIELDS)
        if not records:
            raise HTTPException(status_code=404, detail="Product not found")
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
    """Create a new product in Odoo. Admin only."""
    odoo = get_odoo_client()
    vals = {
        "name": product.name,
        "list_price": product.list_price,
        "standard_price": product.standard_price,
        "type": product.type,
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
        product_id = odoo.create("product.template", vals)
        return {"success": True, "product_id": product_id}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.put("/{product_id}")
def update_product(
    product_id: int,
    product: ProductUpdate,
    current_user: dict = Depends(require_admin),
):
    """Update a product in Odoo. Admin only."""
    odoo = get_odoo_client()
    vals = {k: v for k, v in product.model_dump().items() if v is not None}
    if not vals:
        raise HTTPException(status_code=400, detail="No fields to update")
    try:
        odoo.write("product.template", [product_id], vals)
        return {"success": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.delete("/{product_id}")
def archive_product(
    product_id: int,
    current_user: dict = Depends(require_admin),
):
    """Archive (soft-delete) a product in Odoo. Admin only."""
    odoo = get_odoo_client()
    try:
        odoo.write("product.template", [product_id], {"active": False})
        return {"success": True, "message": "Product archived"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Odoo error: {str(e)}")


@router.get("/{product_id}/stock")
def get_product_stock(product_id: int, current_user: dict = Depends(get_current_user)):
    """Get stock levels per location for a product."""
    odoo = get_odoo_client()
    try:
        quants = odoo.search_read(
            "stock.quant",
            domain=[
                ("product_id.product_tmpl_id", "=", product_id),
                ("location_id.usage", "=", "internal"),
            ],
            fields=["product_id", "location_id", "quantity", "reserved_quantity"],
            limit=50,
        )
        return {"stock": quants}
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Odoo error: {str(e)}")
