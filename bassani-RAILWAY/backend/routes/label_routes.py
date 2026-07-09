"""
GS1 label printing — printer settings CRUD + ZPL print endpoints.
"""
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from auth import require_permission, require_admin
from database import col
from services.gs1 import (
    validate_gtin, build_gs1_text,
    build_zpl_unit_label, build_zpl_carton_label, send_zpl,
)

router = APIRouter(prefix="/api/labels", tags=["labels"])


# ── Printer settings ──────────────────────────────────────────────────────────

class PrinterIn(BaseModel):
    key: str
    name: str
    ip: str
    warehouse_id: Optional[int] = None


async def _get_printers() -> list:
    doc = await col("portal_settings").find_one({"_id": "label_printers"})
    return doc.get("printers", []) if doc else []


@router.get("/printers")
async def list_printers(current_user=Depends(require_admin)):
    return {"printers": await _get_printers()}


@router.put("/printers")
async def upsert_printer(body: PrinterIn, current_user=Depends(require_permission("settings.manage"))):
    printers = await _get_printers()
    existing = next((p for p in printers if p["key"] == body.key), None)
    if existing:
        existing.update(body.model_dump())
    else:
        printers.append(body.model_dump())
    await col("portal_settings").update_one(
        {"_id": "label_printers"},
        {"$set": {"printers": printers}},
        upsert=True,
    )
    return {"ok": True, "printers": printers}


@router.delete("/printers/{key}")
async def delete_printer(key: str, current_user=Depends(require_permission("settings.manage"))):
    printers = [p for p in await _get_printers() if p["key"] != key]
    await col("portal_settings").update_one(
        {"_id": "label_printers"},
        {"$set": {"printers": printers}},
        upsert=True,
    )
    return {"ok": True, "printers": printers}


@router.post("/printers/{key}/test")
async def test_printer(key: str, current_user=Depends(require_permission("settings.manage"))):
    printers = await _get_printers()
    printer = next((p for p in printers if p["key"] == key), None)
    if not printer:
        raise HTTPException(404, "Printer not found")
    test_zpl = (
        "^XA"
        "^FO50,50^A0N,40,40^FDBassani Health^FS"
        "^FO50,100^A0N,28,28^FDLabel Printer Test^FS"
        "^FO50,140^A0N,22,22^FDGS1 Label System^FS"
        "^XZ"
    )
    try:
        send_zpl(printer["ip"], test_zpl)
        return {"ok": True, "message": f"Test label sent to {printer['name']} ({printer['ip']})"}
    except ConnectionError as e:
        raise HTTPException(503, str(e))


# ── GS1 label print ───────────────────────────────────────────────────────────

class PrintLabelRequest(BaseModel):
    product_id: int
    product_name: str
    gtin: str
    lot: Optional[str] = ""
    expiry_display: Optional[str] = ""
    expiry_yymmdd: Optional[str] = ""
    serial_start: Optional[int] = 1
    qty: Optional[int] = 1
    printer_key: str
    label_type: str = "unit"     # "unit" | "carton" | "both"


@router.post("/gs1/print")
async def print_gs1_label(
    body: PrintLabelRequest,
    current_user=Depends(require_permission("labels.print")),
):
    if not validate_gtin(body.gtin):
        raise HTTPException(
            422,
            f"'{body.gtin}' is not a valid GTIN — verify the barcode field in Odoo and ensure "
            "the check digit is correct.",
        )

    printers = await _get_printers()
    printer = next((p for p in printers if p["key"] == body.printer_key), None)
    if not printer:
        raise HTTPException(404, "Printer not configured — add it in Settings > Label Printers")

    qty = max(1, body.qty or 1)

    if body.label_type in ("unit", "both"):
        for i in range(qty):
            serial = str((body.serial_start or 1) + i).zfill(8)
            zpl = build_zpl_unit_label(
                product_name=body.product_name,
                gtin=body.gtin,
                lot=body.lot or "",
                expiry_display=body.expiry_display or "",
                expiry_yymmdd=body.expiry_yymmdd or "",
                serial=serial,
            )
            try:
                send_zpl(printer["ip"], zpl)
            except ConnectionError as e:
                raise HTTPException(503, str(e))

    if body.label_type in ("carton", "both"):
        zpl = build_zpl_carton_label(
            product_name=body.product_name,
            gtin=body.gtin,
            lot=body.lot or "",
            expiry_display=body.expiry_display or "",
            expiry_yymmdd=body.expiry_yymmdd or "",
            qty=qty,
        )
        try:
            send_zpl(printer["ip"], zpl)
        except ConnectionError as e:
            raise HTTPException(503, str(e))

    unit_count = qty if body.label_type in ("unit", "both") else 0
    carton_count = 1 if body.label_type in ("carton", "both") else 0
    total = unit_count + carton_count
    return {
        "ok": True,
        "message": f"{total} label{'s' if total != 1 else ''} sent to {printer['name']}",
        "unit_labels": unit_count,
        "carton_labels": carton_count,
    }


@router.get("/gs1/preview-text")
async def preview_gs1_text(
    gtin: str,
    lot: str = "",
    expiry: str = "",
    serial: str = "",
    current_user=Depends(require_admin),
):
    """Return the GS1 AI string that bwip-js will encode (for debugging/verification)."""
    if not validate_gtin(gtin):
        raise HTTPException(422, f"'{gtin}' is not a valid GTIN")
    return {"gs1_text": build_gs1_text(gtin, lot, expiry, serial)}
