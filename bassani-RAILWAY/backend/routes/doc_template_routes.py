"""
Document template management endpoints.

Three single-file PDFs (NDA, Store Onboarding Agreement, Customer Information Form)
use the standard upload/activate/history endpoints.

Welcome Pack is slot-based: 4 named documents (Help Me Budget, Welcome Letter,
Price List, Product Brochure) each managed independently with their own version
history. Updating the price list only touches the price_list slot; the other
three are unaffected.

Collection: doc_templates
Single-file fields: doc_type, version, label, filename, r2_key, file_size,
                    uploaded_at, uploaded_by_id, uploaded_by_name, is_active, notes
Slot-version fields: same + slot, content_type (no r2_key at root — per slot)
"""
import io
from datetime import datetime
from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from typing import Optional

from auth import require_admin, require_permission
from database import col
from services.r2_client import r2_put, r2_get
from middleware.audit import audit_log

router = APIRouter(prefix="/api/doc-templates", tags=["doc-templates"])

DOC_TYPES: dict[str, dict] = {
    "store_onboarding_agreement": {
        "label":    "Store Onboarding Agreement",
        "filename": "store-onboarding-agreement.pdf",
    },
    "customer_information_form": {
        "label":    "Customer Information Form",
        "filename": "customer-information-form.pdf",
    },
    "nda": {
        "label":    "NDA",
        "filename": "nda.pdf",
    },
    "welcome_pack": {
        "label":    "Welcome Pack",
        "is_slots": True,   # slot-based — use /welcome_pack/{slot}/... endpoints
    },
}

# Reverse map: filename → doc_type key (used by public/onboarding download endpoints)
FILENAME_TO_DOC_TYPE: dict[str, str] = {
    meta["filename"]: key
    for key, meta in DOC_TYPES.items()
    if "filename" in meta
}

SLOT_DOC_TYPES = {k for k, v in DOC_TYPES.items() if v.get("is_slots")}

# The four named slots for the Welcome Pack — each independently versioned.
WELCOME_PACK_SLOTS: list[dict] = [
    {"slot": "budget",     "label": "Help Me Budget",   "accepts": [".xlsx", ".xls"]},
    {"slot": "letter",     "label": "Welcome Letter",   "accepts": [".pdf"]},
    {"slot": "price_list", "label": "Price List",       "accepts": [".pdf", ".xlsx", ".xls"]},
    {"slot": "brochure",   "label": "Product Brochure", "accepts": [".pdf"]},
]
WELCOME_PACK_SLOT_MAP = {s["slot"]: s for s in WELCOME_PACK_SLOTS}


def _content_type(filename: str) -> str:
    fn = (filename or "").lower()
    if fn.endswith(".pdf"):   return "application/pdf"
    if fn.endswith(".xlsx"):  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    if fn.endswith(".xls"):   return "application/vnd.ms-excel"
    return "application/octet-stream"


def _slot_accepts(slot: str, filename: str) -> bool:
    slot_def = WELCOME_PACK_SLOT_MAP.get(slot)
    if not slot_def:
        return False
    ext = ("." + filename.rsplit(".", 1)[-1].lower()) if "." in filename else ""
    return ext in slot_def["accepts"]


# ── Shared helpers ──────────────────────────────────────────────────────────────

async def get_active_template_bytes(doc_type: str) -> Optional[bytes]:
    """
    Return bytes of the current active single-file template from R2, or None.
    Not applicable to slot-based doc types — use get_active_bundle_files() instead.
    """
    if doc_type in SLOT_DOC_TYPES:
        return None
    doc = await col("doc_templates").find_one({"doc_type": doc_type, "is_active": True})
    if not doc:
        return None
    try:
        return await r2_get(doc["r2_key"])
    except Exception:
        return None


async def get_active_bundle_files(doc_type: str) -> list[dict]:
    """
    Return {filename, label, content_type, data: bytes} for every welcome pack slot
    that has an active version. Slots with nothing uploaded are skipped silently.
    """
    files = []
    for slot_def in WELCOME_PACK_SLOTS:
        doc = await col("doc_templates").find_one(
            {"doc_type": doc_type, "slot": slot_def["slot"], "is_active": True}
        )
        if not doc:
            continue
        try:
            data = await r2_get(doc["r2_key"])
            if data:
                files.append({
                    "filename":     doc["filename"],
                    "label":        doc.get("label", slot_def["label"]),
                    "content_type": doc.get("content_type", "application/octet-stream"),
                    "data":         data,
                })
        except Exception:
            pass
    return files


def _serialize(doc: dict) -> dict:
    return {
        "id":               str(doc["_id"]),
        "doc_type":         doc.get("doc_type"),
        "slot":             doc.get("slot"),
        "label":            doc.get("label"),
        "filename":         doc.get("filename"),
        "version":          doc.get("version"),
        "file_size":        doc.get("file_size"),
        "content_type":     doc.get("content_type"),
        "r2_key":           doc.get("r2_key"),
        "uploaded_at":      doc["uploaded_at"].isoformat() if doc.get("uploaded_at") else None,
        "uploaded_by_id":   doc.get("uploaded_by_id"),
        "uploaded_by_name": doc.get("uploaded_by_name"),
        "is_active":        doc.get("is_active", False),
        "notes":            doc.get("notes", ""),
    }


# ── Welcome Pack slot endpoints ─────────────────────────────────────────────────
# Defined before the generic /{doc_type}/... routes so the router sees them first.

@router.get("/welcome_pack/slots", dependencies=[Depends(require_admin)])
async def list_welcome_pack_slots():
    """List all four welcome pack slots with their active version summary."""
    slots_data = []
    for slot_def in WELCOME_PACK_SLOTS:
        active = await col("doc_templates").find_one(
            {"doc_type": "welcome_pack", "slot": slot_def["slot"], "is_active": True}
        )
        count = await col("doc_templates").count_documents(
            {"doc_type": "welcome_pack", "slot": slot_def["slot"]}
        )
        slots_data.append({
            "slot":          slot_def["slot"],
            "label":         slot_def["label"],
            "accepts":       slot_def["accepts"],
            "version_count": count,
            "active":        _serialize(active) if active else None,
        })
    return {"slots": slots_data}


@router.post("/welcome_pack/{slot}/upload")
async def upload_welcome_pack_slot(
    slot:  str,
    file:  UploadFile = File(...),
    notes: str        = Form(""),
    current_user: dict = Depends(require_permission("settings.manage")),
):
    """Upload a new version for a specific welcome pack slot."""
    slot_def = WELCOME_PACK_SLOT_MAP.get(slot)
    if not slot_def:
        raise HTTPException(status_code=404, detail=f"Unknown welcome pack slot '{slot}'")

    filename = file.filename or ""
    if not _slot_accepts(slot, filename):
        raise HTTPException(
            status_code=422,
            detail=f"{slot_def['label']} only accepts: {', '.join(slot_def['accepts'])}",
        )

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    now = datetime.utcnow()
    latest = await col("doc_templates").find_one(
        {"doc_type": "welcome_pack", "slot": slot},
        sort=[("version", -1)],
    )
    version = (latest["version"] + 1) if latest else 1

    ct     = _content_type(filename)
    r2_key = f"doc-templates/welcome_pack/{slot}/v{version}/{filename}"
    await r2_put(r2_key, contents, content_type=ct)

    # Deactivate previous versions for this slot only — other slots unaffected
    await col("doc_templates").update_many(
        {"doc_type": "welcome_pack", "slot": slot},
        {"$set": {"is_active": False}},
    )

    new_doc = {
        "doc_type":         "welcome_pack",
        "slot":             slot,
        "label":            slot_def["label"],
        "filename":         filename,
        "version":          version,
        "r2_key":           r2_key,
        "file_size":        len(contents),
        "content_type":     ct,
        "uploaded_at":      now,
        "uploaded_by_id":   str(current_user.get("_id") or current_user.get("username", "unknown")),
        "uploaded_by_name": current_user.get("name") or current_user.get("username"),
        "is_active":        True,
        "notes":            notes.strip(),
    }
    result = await col("doc_templates").insert_one(new_doc)

    await audit_log(
        user=current_user,
        action="doc_template.uploaded",
        entity_type="doc_template",
        entity_id=str(result.inserted_id),
        entity_label=f"Welcome Pack / {slot_def['label']} v{version}",
        after={"slot": slot, "version": version, "file_size": len(contents), "notes": notes.strip()},
    )

    return {"success": True, "version": version, "id": str(result.inserted_id)}


@router.get("/welcome_pack/{slot}/history", dependencies=[Depends(require_admin)])
async def get_welcome_pack_slot_history(slot: str):
    if slot not in WELCOME_PACK_SLOT_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown welcome pack slot '{slot}'")
    cursor = col("doc_templates").find(
        {"doc_type": "welcome_pack", "slot": slot},
        sort=[("version", -1)],
    )
    docs = [_serialize(d) async for d in cursor]
    return {"slot": slot, "versions": docs}


@router.post("/welcome_pack/{slot}/activate/{version_id}")
async def activate_welcome_pack_slot_version(
    slot:       str,
    version_id: str,
    current_user: dict = Depends(require_permission("settings.manage")),
):
    if slot not in WELCOME_PACK_SLOT_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown welcome pack slot '{slot}'")

    from bson import ObjectId
    try:
        oid = ObjectId(version_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid version ID")

    target = await col("doc_templates").find_one(
        {"_id": oid, "doc_type": "welcome_pack", "slot": slot}
    )
    if not target:
        raise HTTPException(status_code=404, detail="Version not found")

    if target.get("is_active"):
        return {"success": True, "message": "Already the active version"}

    await col("doc_templates").update_many(
        {"doc_type": "welcome_pack", "slot": slot},
        {"$set": {"is_active": False}},
    )
    await col("doc_templates").update_one(
        {"_id": oid},
        {"$set": {"is_active": True}},
    )

    slot_def = WELCOME_PACK_SLOT_MAP[slot]
    await audit_log(
        user=current_user,
        action="doc_template.activated",
        entity_type="doc_template",
        entity_id=version_id,
        entity_label=f"Welcome Pack / {slot_def['label']} v{target['version']}",
        after={"slot": slot, "activated_version": target["version"]},
    )

    return {"success": True, "activated_version": target["version"]}


@router.get("/welcome_pack/{slot}/download", dependencies=[Depends(require_admin)])
async def download_active_welcome_pack_slot(slot: str):
    if slot not in WELCOME_PACK_SLOT_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown welcome pack slot '{slot}'")

    doc = await col("doc_templates").find_one(
        {"doc_type": "welcome_pack", "slot": slot, "is_active": True}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="No version uploaded for this slot yet")

    data = await r2_get(doc["r2_key"])
    ct   = doc.get("content_type", "application/octet-stream")
    return StreamingResponse(
        io.BytesIO(data),
        media_type=ct,
        headers={"Content-Disposition": f'attachment; filename="{doc["filename"]}"'},
    )


@router.get("/welcome_pack/{slot}/download/{version_id}", dependencies=[Depends(require_admin)])
async def download_welcome_pack_slot_version(slot: str, version_id: str):
    if slot not in WELCOME_PACK_SLOT_MAP:
        raise HTTPException(status_code=404, detail=f"Unknown welcome pack slot '{slot}'")

    from bson import ObjectId
    try:
        oid = ObjectId(version_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid version ID")

    doc = await col("doc_templates").find_one(
        {"_id": oid, "doc_type": "welcome_pack", "slot": slot}
    )
    if not doc:
        raise HTTPException(status_code=404, detail="Version not found")

    data = await r2_get(doc["r2_key"])
    ct   = doc.get("content_type", "application/octet-stream")
    # Versioned filename for the download
    fn   = doc["filename"]
    if "." in fn:
        base, ext = fn.rsplit(".", 1)
        fname = f"{base}-v{doc['version']}.{ext}"
    else:
        fname = f"{fn}-v{doc['version']}"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=ct,
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )


# ── List all doc types with their active version ───────────────────────────────

@router.get("/", dependencies=[Depends(require_admin)])
async def list_doc_templates():
    result = []
    for doc_type, meta in DOC_TYPES.items():
        if meta.get("is_slots"):
            # Welcome Pack: return slots array instead of a single active version
            slots_data = []
            for slot_def in WELCOME_PACK_SLOTS:
                active = await col("doc_templates").find_one(
                    {"doc_type": doc_type, "slot": slot_def["slot"], "is_active": True}
                )
                count = await col("doc_templates").count_documents(
                    {"doc_type": doc_type, "slot": slot_def["slot"]}
                )
                slots_data.append({
                    "slot":          slot_def["slot"],
                    "label":         slot_def["label"],
                    "accepts":       slot_def["accepts"],
                    "version_count": count,
                    "active":        _serialize(active) if active else None,
                })
            result.append({
                "doc_type": doc_type,
                "label":    meta["label"],
                "is_slots": True,
                "slots":    slots_data,
            })
        else:
            active = await col("doc_templates").find_one({"doc_type": doc_type, "is_active": True})
            count  = await col("doc_templates").count_documents({"doc_type": doc_type})
            result.append({
                "doc_type":      doc_type,
                "label":         meta["label"],
                "filename":      meta.get("filename", ""),
                "is_slots":      False,
                "version_count": count,
                "active":        _serialize(active) if active else None,
            })
    return {"templates": result}


# ── Version history for single-file doc types ──────────────────────────────────

@router.get("/{doc_type}/history", dependencies=[Depends(require_admin)])
async def get_version_history(doc_type: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    if doc_type in SLOT_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Welcome Pack uses per-slot history. Use GET /api/doc-templates/welcome_pack/{slot}/history",
        )
    cursor = col("doc_templates").find(
        {"doc_type": doc_type},
        sort=[("version", -1)],
    )
    docs = [_serialize(d) async for d in cursor]
    return {"doc_type": doc_type, "versions": docs}


# ── Upload a new single-file version ───────────────────────────────────────────

@router.post("/{doc_type}/upload")
async def upload_template_version(
    doc_type: str,
    file:  UploadFile = File(...),
    notes: str        = Form(""),
    current_user: dict = Depends(require_permission("settings.manage")),
):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    if doc_type in SLOT_DOC_TYPES:
        raise HTTPException(
            status_code=422,
            detail="Welcome Pack uses per-slot uploads. Use POST /api/doc-templates/welcome_pack/{slot}/upload",
        )
    if not file.filename or not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=422, detail="Only PDF files are accepted")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=422, detail="Uploaded file is empty")

    meta = DOC_TYPES[doc_type]
    now  = datetime.utcnow()

    latest = await col("doc_templates").find_one(
        {"doc_type": doc_type},
        sort=[("version", -1)],
    )
    version = (latest["version"] + 1) if latest else 1

    r2_key = f"doc-templates/{doc_type}/v{version}/{meta['filename']}"
    await r2_put(r2_key, contents, content_type="application/pdf")

    await col("doc_templates").update_many(
        {"doc_type": doc_type},
        {"$set": {"is_active": False}},
    )

    new_doc = {
        "doc_type":         doc_type,
        "label":            meta["label"],
        "filename":         meta["filename"],
        "version":          version,
        "r2_key":           r2_key,
        "file_size":        len(contents),
        "uploaded_at":      now,
        "uploaded_by_id":   str(current_user.get("_id") or current_user.get("username", "unknown")),
        "uploaded_by_name": current_user.get("name") or current_user.get("username"),
        "is_active":        True,
        "notes":            notes.strip(),
    }
    result = await col("doc_templates").insert_one(new_doc)

    await audit_log(
        user=current_user,
        action="doc_template.uploaded",
        entity_type="doc_template",
        entity_id=str(result.inserted_id),
        entity_label=f"{meta['label']} v{version}",
        after={"version": version, "file_size": len(contents), "notes": notes.strip()},
    )

    return {"success": True, "version": version, "id": str(result.inserted_id)}


# ── Activate (rollback to) a specific single-file version ──────────────────────

@router.post("/{doc_type}/activate/{version_id}")
async def activate_template_version(
    doc_type:   str,
    version_id: str,
    current_user: dict = Depends(require_permission("settings.manage")),
):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    if doc_type in SLOT_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Welcome Pack uses per-slot activation. Use POST /api/doc-templates/welcome_pack/{slot}/activate/{version_id}",
        )

    from bson import ObjectId
    try:
        oid = ObjectId(version_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid version ID")

    target = await col("doc_templates").find_one({"_id": oid, "doc_type": doc_type})
    if not target:
        raise HTTPException(status_code=404, detail="Version not found")

    if target.get("is_active"):
        return {"success": True, "message": "Already the active version"}

    await col("doc_templates").update_many(
        {"doc_type": doc_type},
        {"$set": {"is_active": False}},
    )
    await col("doc_templates").update_one(
        {"_id": oid},
        {"$set": {"is_active": True}},
    )

    await audit_log(
        user=current_user,
        action="doc_template.activated",
        entity_type="doc_template",
        entity_id=version_id,
        entity_label=f"{DOC_TYPES[doc_type]['label']} v{target['version']}",
        after={"activated_version": target["version"]},
    )

    return {"success": True, "activated_version": target["version"]}


# ── Download active / specific single-file version ─────────────────────────────

@router.get("/{doc_type}/download", dependencies=[Depends(require_admin)])
async def download_active_template(doc_type: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    if doc_type in SLOT_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Welcome Pack files are downloaded per slot. Use GET /api/doc-templates/welcome_pack/{slot}/download",
        )
    data = await get_active_template_bytes(doc_type)
    if data is None:
        raise HTTPException(status_code=404, detail="No managed version uploaded yet")
    filename = DOC_TYPES[doc_type]["filename"]
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{doc_type}/download/{version_id}", dependencies=[Depends(require_admin)])
async def download_template_version(doc_type: str, version_id: str):
    if doc_type not in DOC_TYPES:
        raise HTTPException(status_code=404, detail="Unknown document type")
    if doc_type in SLOT_DOC_TYPES:
        raise HTTPException(
            status_code=400,
            detail="Welcome Pack files are downloaded per slot. Use GET /api/doc-templates/welcome_pack/{slot}/download/{version_id}",
        )

    from bson import ObjectId
    try:
        oid = ObjectId(version_id)
    except Exception:
        raise HTTPException(status_code=422, detail="Invalid version ID")

    doc = await col("doc_templates").find_one({"_id": oid, "doc_type": doc_type})
    if not doc:
        raise HTTPException(status_code=404, detail="Version not found")

    data  = await r2_get(doc["r2_key"])
    meta  = DOC_TYPES[doc_type]
    fname = f"{meta['filename'].replace('.pdf', '')}-v{doc['version']}.pdf"
    return StreamingResponse(
        io.BytesIO(data),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}"'},
    )
