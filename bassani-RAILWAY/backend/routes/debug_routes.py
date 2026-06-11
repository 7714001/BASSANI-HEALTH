from fastapi import APIRouter
from odoo_client import odoo as odoo_call

router = APIRouter(prefix="/api/debug", tags=["debug"])

# Models and the specific fields we need to verify
CHECKS = {
    "product.template": [
        "type", "detailed_type", "is_storable", "tracking",
        "active", "name", "list_price", "standard_price",
        "default_code", "categ_id", "description",
    ],
    "sale.order": [
        "state", "note", "internal_note", "narration",
        "partner_id", "order_line", "invoice_ids",
    ],
    "sale.order.line": [
        "product_id", "product_uom", "product_uom_qty",
        "price_unit", "tax_id", "name",
    ],
    "account.move": [
        "move_type", "state", "partner_id",
        "invoice_line_ids", "invoice_origin", "ref", "name",
    ],
    "account.move.line": [
        "name", "quantity", "price_unit", "account_id", "tax_ids",
    ],
    "res.partner": [
        "name", "company_type", "customer_rank",
        "credit_limit", "comment", "active",
    ],
    "account.account": [
        "account_type", "code", "name", "deprecated",
    ],
}


@router.get("/odoo-fields")
def odoo_field_audit():
    """Returns field definitions for key Odoo models to verify correct field names."""
    result = {}

    for model, field_names in CHECKS.items():
        try:
            all_fields = odoo_call(
                model,
                "fields_get",
                [field_names],
                {"attributes": ["string", "type", "selection", "required", "readonly"]},
            )
            result[model] = {
                fname: {
                    "string":   fdef.get("string"),
                    "type":     fdef.get("type"),
                    "required": fdef.get("required", False),
                    "readonly": fdef.get("readonly", False),
                    **({"selection": fdef["selection"]} if fdef.get("selection") else {}),
                }
                for fname, fdef in (all_fields or {}).items()
            }
        except Exception as e:
            result[model] = {"error": str(e)}

    return result
