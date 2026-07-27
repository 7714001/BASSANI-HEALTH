"""
VaultOdooWriter — the single gateway for every Odoo stock call the Phase 13
vault module makes. No route in production_routes.py talks to Odoo stock
models directly; everything goes through here.

Two modes, driven by the GACP_ODOO_WRITES Railway env var:

  off (default)  Every movement is recorded in MongoDB together with the exact
                 operation list it WOULD send to Odoo (`ops` below), stamped
                 odoo_sync="staged". Nothing touches Odoo. This is the mode the
                 module launches in, until GACP Odoo access is confirmed.

  on             Operations execute against Odoo immediately, and the staged
                 queue can be replayed via the sync endpoint.

The staged queue is a temporary OUTBOX, not a ledger — once writes are enabled
it must be flushed so Odoo remains the sole source of stock truth.

Operation shapes (stored verbatim on staged movements so the intended write is
auditable before it happens):

  {"op": "ensure_lot",        "lot_name": str, "product_name": str,
   "product_hint": str, "product_id": None}
  {"op": "internal_transfer", "lot_name": str, "qty_g": float,
   "from_location": str, "to_location": str, "product_hint": str}
  {"op": "manufacture_split", "input_lot": str, "input_qty_g": float,
   "outputs": [{"lot_name": str, "qty_g": float, "product_hint": str}],
   "waste_g": float}

Product resolution: each registry product maps to a GACP Odoo product record.
That mapping cannot exist until GACP access is confirmed, so staged ops carry a
`product_hint` (the product name); at execute time the Odoo product is resolved by
name within the GACP company and the op fails with a clear message when no
match is found — surfaced per movement by the sync endpoint.
"""
import logging
from typing import Optional

from config import get_settings
from odoo_client import get_odoo_client
from warehouse_context import get_company_id, company_context

logger = logging.getLogger(__name__)

# Portal-side names for the GACP sub-locations (13.0.1). Created in Odoo under
# the GACP warehouse's stock root; matched by name at execute time.
LOC_VAULT      = "Vault"
LOC_MANICURING = "Manicuring Room"
LOC_PACKING    = "Packing Room"
LOC_PRODUCTION = "Production Floor"   # generic source for receipts into the vault


class VaultOdooWriter:
    @property
    def live(self) -> bool:
        return get_settings().gacp_odoo_writes.strip().lower() == "on"

    @property
    def warehouse_id(self) -> int:
        return get_settings().gacp_warehouse_id or 0

    # ── Op builders (pure — used in both modes) ───────────────────────────────

    def op_ensure_lot(self, lot_name: str, product_name: str) -> dict:
        return {"op": "ensure_lot", "lot_name": lot_name, "product_name": product_name,
                "product_hint": product_name, "product_id": None}

    def op_internal_transfer(self, lot_name: str, qty_g: float, from_location: str,
                             to_location: str, product_name: str) -> dict:
        return {"op": "internal_transfer", "lot_name": lot_name, "qty_g": qty_g,
                "from_location": from_location, "to_location": to_location,
                "product_hint": product_name}

    def op_manufacture_split(self, input_lot: str, input_qty_g: float,
                             outputs: list, waste_g: float) -> dict:
        return {"op": "manufacture_split", "input_lot": input_lot,
                "input_qty_g": input_qty_g, "outputs": outputs, "waste_g": waste_g}

    def op_po_receipt(self, supplier_name: str, lot_name: str, qty_g: float,
                      product_name: str, po_id: "int | None" = None,
                      po_name: "str | None" = None,
                      supplier_partner_id: "int | None" = None) -> dict:
        """Imported stock receipt — Odoo side is a purchase order against the
        supplier with a validated goods receipt into the vault, not an internal
        transfer (Phase 7.9 supplier layer). When po_id is given the receipt is
        booked against that existing PO instead of creating a new one. When the
        supplier is linked, supplier_partner_id pins the exact Odoo vendor —
        name matching is never used for writes when a link exists."""
        return {"op": "po_receipt", "supplier_name": supplier_name,
                "lot_name": lot_name, "qty_g": qty_g, "product_hint": product_name,
                "po_id": po_id, "po_name": po_name,
                "supplier_partner_id": supplier_partner_id}

    # ── Execution (live mode only) ────────────────────────────────────────────

    def execute_ops(self, ops: list[dict]) -> list[dict]:
        """Run an op list against Odoo. Returns per-op results. Raises on the
        first failure — callers mark the movement odoo_sync="error" with the
        message so it can be fixed and re-synced."""
        if not self.live:
            raise RuntimeError("Odoo writes for the GACP vault are not enabled (GACP_ODOO_WRITES=off)")
        if not self.warehouse_id:
            raise RuntimeError("GACP_WAREHOUSE_ID is not configured")
        results = []
        for op in ops:
            kind = op.get("op")
            if kind == "ensure_lot":
                results.append(self._ensure_lot(op))
            elif kind == "internal_transfer":
                results.append(self._internal_transfer(op))
            elif kind == "manufacture_split":
                results.append(self._manufacture_split(op))
            elif kind == "po_receipt":
                results.append(self._po_receipt(op))
            else:
                raise RuntimeError(f"Unknown vault op '{kind}'")
        return results

    # ── Odoo helpers ──────────────────────────────────────────────────────────

    def _company_id(self) -> int:
        cid = get_company_id(get_odoo_client(), self.warehouse_id)
        if not cid:
            raise RuntimeError("Could not resolve the GACP warehouse's company in Odoo")
        return cid

    def _resolve_product(self, product_hint: str, company_id: int) -> int:
        """Odoo product record for a registry product, by name, within the GACP company."""
        odoo = get_odoo_client()
        rows = odoo.search_read(
            "product.product",
            domain=["&", ("name", "ilike", product_hint),
                    "|", ("company_id", "=", company_id), ("company_id", "=", False)],
            fields=["id", "name"], limit=2,
        )
        if not rows:
            raise RuntimeError(
                f"No Odoo product found for '{product_hint}' in the GACP company. "
                "Create the matching bulk product in Odoo and re-run the sync."
            )
        return rows[0]["id"]

    def _resolve_location(self, name: str, company_id: int) -> int:
        odoo = get_odoo_client()
        rows = odoo.search_read(
            "stock.location",
            domain=[("complete_name", "ilike", name), ("usage", "=", "internal"),
                    ("company_id", "=", company_id)],
            fields=["id", "complete_name"], limit=1,
        )
        if not rows:
            raise RuntimeError(
                f"GACP sub-location '{name}' not found in Odoo. "
                "Create the sub-locations under the GACP warehouse first (13.0.1)."
            )
        return rows[0]["id"]

    def _ensure_lot(self, op: dict) -> dict:
        odoo = get_odoo_client()
        company_id = self._company_id()
        existing = odoo.search_read(
            "stock.lot",
            domain=[("name", "=", op["lot_name"]), ("company_id", "=", company_id)],
            fields=["id"], limit=1,
        )
        if existing:
            return {"op": "ensure_lot", "lot_id": existing[0]["id"], "created": False}
        product_id = op.get("product_id") or self._resolve_product(op["product_hint"], company_id)
        lot_id = odoo.create("stock.lot", {
            "name": op["lot_name"], "product_id": product_id, "company_id": company_id,
        }, context=company_context(company_id))
        return {"op": "ensure_lot", "lot_id": lot_id, "created": True}

    def _internal_transfer(self, op: dict) -> dict:
        odoo = get_odoo_client()
        company_id = self._company_id()
        product_id = self._resolve_product(op["product_hint"], company_id)
        lot = self._ensure_lot(self.op_ensure_lot(op["lot_name"], op["product_hint"]))
        src = self._resolve_location(op["from_location"], company_id)
        dst = self._resolve_location(op["to_location"], company_id)
        ptypes = odoo.search_read(
            "stock.picking.type",
            domain=[("code", "=", "internal"), ("warehouse_id", "=", self.warehouse_id)],
            fields=["id"], limit=1,
        )
        if not ptypes:
            raise RuntimeError("No internal transfer operation type on the GACP warehouse")
        ctx = company_context(company_id)
        picking_id = odoo.create("stock.picking", {
            "picking_type_id": ptypes[0]["id"],
            "location_id": src, "location_dest_id": dst,
            "company_id": company_id,
            "move_ids_without_package": [(0, 0, {
                "name": op["lot_name"],
                "product_id": product_id,
                "product_uom_qty": op["qty_g"],
                "location_id": src, "location_dest_id": dst,
            })],
        }, context=ctx)
        odoo.execute("stock.picking", "action_confirm", [picking_id])
        odoo.execute("stock.picking", "action_assign", [picking_id])
        move_lines = odoo.search_read(
            "stock.move.line", domain=[("picking_id", "=", picking_id)], fields=["id"],
        )
        for ml in move_lines:
            odoo.write("stock.move.line", [ml["id"]],
                       {"lot_id": lot["lot_id"], "qty_done": op["qty_g"]})
        odoo.execute("stock.picking", "button_validate", [picking_id])
        return {"op": "internal_transfer", "picking_id": picking_id, "lot_id": lot["lot_id"]}

    def _po_receipt(self, op: dict) -> dict:
        """Live path for an imported-stock receipt: purchase order on the
        supplier partner, confirmed, receipt picking validated with the lot
        into the vault. Fails with a clear message when the supplier partner
        or product cannot be resolved — surfaced per record by the sync."""
        odoo = get_odoo_client()
        company_id = self._company_id()
        if op.get("po_id"):
            # Receive against the PO Bassani already raised — never duplicate it.
            po_id = op["po_id"]
            existing = odoo.read("purchase.order", [po_id], fields=["state"])
            if not existing:
                raise RuntimeError(f"Linked purchase order {op.get('po_name') or po_id} no longer exists in Odoo")
            if existing[0]["state"] in ("draft", "sent"):
                odoo.execute("purchase.order", "button_confirm", [po_id])
        else:
            if op.get("supplier_partner_id"):
                # Admin-linked vendor account: deterministic, no name matching.
                partner_rows = odoo.read("res.partner", [op["supplier_partner_id"]], fields=["id", "name"])
                if not partner_rows:
                    raise RuntimeError(
                        f"The linked supplier account (id {op['supplier_partner_id']}) no longer exists in Odoo. "
                        "Re-link the supplier and re-run the sync."
                    )
                partners = partner_rows
            else:
                partners = odoo.search_read(
                    "res.partner",
                    domain=[("name", "ilike", op["supplier_name"])],
                    fields=["id", "name"], limit=1,
                )
                if not partners:
                    raise RuntimeError(
                        f"No Odoo supplier partner found matching '{op['supplier_name']}'. "
                        "Link the supplier to its Odoo account (Manage Suppliers) and re-run the sync."
                    )
            product_id = self._resolve_product(op["product_hint"], company_id)
            ctx = company_context(company_id)
            po_id = odoo.create("purchase.order", {
                "partner_id": partners[0]["id"],
                "company_id": company_id,
                "order_line": [(0, 0, {
                    "product_id": product_id,
                    "product_qty": op["qty_g"],
                })],
            }, context=ctx)
            odoo.execute("purchase.order", "button_confirm", [po_id])
        pickings = odoo.search_read(
            "stock.picking", domain=[("purchase_id", "=", po_id)], fields=["id"], limit=1,
        )
        if not pickings:
            raise RuntimeError("Odoo did not generate a receipt for the purchase order")
        picking_id = pickings[0]["id"]
        lot = self._ensure_lot(self.op_ensure_lot(op["lot_name"], op["product_hint"]))
        move_lines = odoo.search_read(
            "stock.move.line", domain=[("picking_id", "=", picking_id)], fields=["id"],
        )
        for ml in move_lines:
            odoo.write("stock.move.line", [ml["id"]],
                       {"lot_id": lot["lot_id"], "qty_done": op["qty_g"]})
        odoo.execute("stock.picking", "button_validate", [picking_id])
        return {"op": "po_receipt", "po_id": po_id, "picking_id": picking_id, "lot_id": lot["lot_id"]}

    def _manufacture_split(self, op: dict) -> dict:
        """The manicuring round-trip: consume the input lot, produce the -M and
        -T output lots. Odoo 17 supports MOs without a BoM (manual raw/finished
        moves), so this is a real mrp.production from day one — not gated on
        the Track B BoM setup. Falls back with a clear error if mrp is absent."""
        odoo = get_odoo_client()
        company_id = self._company_id()
        mods = odoo.search_read(
            "ir.module.module", domain=[("name", "=", "mrp")], fields=["state"], limit=1,
        )
        if not mods or mods[0]["state"] != "installed":
            raise RuntimeError("Manufacturing (mrp) is not installed on this Odoo database")

        results = []
        # Output side first: each produced lot must exist before the MO finishes.
        for out in op["outputs"]:
            product_id = self._resolve_product(out["product_hint"], company_id)
            lot = self._ensure_lot(self.op_ensure_lot(out["lot_name"], out["product_hint"]))
            loc_src = self._resolve_location(LOC_MANICURING, company_id)
            loc_dst = self._resolve_location(LOC_VAULT, company_id)
            input_product_id = self._resolve_product(op.get("input_hint") or out["product_hint"], company_id)
            input_lot = odoo.search_read(
                "stock.lot",
                domain=[("name", "=", op["input_lot"]), ("company_id", "=", company_id)],
                fields=["id"], limit=1,
            )
            if not input_lot:
                raise RuntimeError(f"Input lot {op['input_lot']} does not exist in Odoo")
            share = out["qty_g"] / max(sum(o["qty_g"] for o in op["outputs"]), 0.001)
            consume_qty = round((op["input_qty_g"] - op.get("waste_g", 0)) * share, 3)
            ctx = company_context(company_id)
            mo_id = odoo.create("mrp.production", {
                "product_id": product_id,
                "product_qty": out["qty_g"],
                "company_id": company_id,
                "location_src_id": loc_src,
                "location_dest_id": loc_dst,
                "move_raw_ids": [(0, 0, {
                    "name": op["input_lot"],
                    "product_id": input_product_id,
                    "product_uom_qty": consume_qty,
                    "location_id": loc_src, "location_dest_id": loc_dst,
                })],
            }, context=ctx)
            odoo.execute("mrp.production", "action_confirm", [mo_id])
            odoo.write("mrp.production", [mo_id], {"lot_producing_id": lot["lot_id"], "qty_producing": out["qty_g"]})
            raw_lines = odoo.search_read(
                "stock.move.line", domain=[("production_id", "=", mo_id)], fields=["id"],
            )
            for ml in raw_lines:
                odoo.write("stock.move.line", [ml["id"]],
                           {"lot_id": input_lot[0]["id"], "qty_done": consume_qty})
            odoo.execute("mrp.production", "button_mark_done", [mo_id])
            results.append({"mo_id": mo_id, "lot_id": lot["lot_id"], "lot_name": out["lot_name"]})
        return {"op": "manufacture_split", "productions": results}


_writer = VaultOdooWriter()


def get_vault_writer() -> VaultOdooWriter:
    return _writer
