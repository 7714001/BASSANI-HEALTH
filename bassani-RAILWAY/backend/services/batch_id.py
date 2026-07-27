"""
Batch ID generation — Bassani Medicinal Cannabis Batch Traceability Standard V6.

The single deterministic implementation of the V6 format. Batch IDs are
GENERATED here, never typed by staff — free-text entry is what produced the
format drift visible in the live Excel logbooks (Phase 13 scoping notes).

Base ID families (prefix + product shortcode + zero-padded sequence + DDMMYY):

    single  BH{CODE}-{seq}-{date}       BHDSD-011-100626      single-strain batch
    api     BHAPI{CODE}-{seq}-{date}    BHAPIBBY-001-010126   mixed-strain room batch
    blend   BHB{CODE}-{seq}-{date}      BHBBBY-003-220426     multi-batch blend
    gummy   BHG{CODE}-{seq}-{date}      BHGPIN-001-181225     supplier gummy lot

Stage suffixes REPLACE each other as material progresses (confirmed from the
"Batch Naming" sheet of the operational workbook: "Swap D with U",
"Split U into M, T and P") — they are not stacked. The stage token is always
the segment after the final hyphen:

    base -> -D -> -U -> {-M, -P, -T} -> {-PC, -TC} -> {-PCPR, -TCPR} -> packaging
"""
from datetime import date as _date
from typing import Optional

FAMILIES = {
    "single": "BH",
    "api":    "BHAPI",
    "blend":  "BHB",
    "gummy":  "BHG",
}

FAMILY_LABELS = {
    "single": "Single Strain",
    "api":    "Mixed Room (API)",
    "blend":  "Blend",
    "gummy":  "Gummy / Product Lot",
}

# Stage suffixes in processing order. Value = human label.
STAGE_SUFFIXES = {
    "D":       "Drying",
    "U":       "Unmanicured (Dried)",
    "M":       "Manicured Flower",
    "P":       "Pops",
    "T":       "Trim",
    "PC":      "Crushed (standard, from Pops)",
    "TC":      "Crushed (budget, from Trim)",
    "PCPR":    "Pre Roll (standard)",
    "TCPR":    "Pre Roll (budget)",
    "PCPRPTT": "Pop Top Tube (standard)",
    "TCPRPTT": "Pop Top Tube (budget)",
    "PCPRPJR": "Jar (standard)",
    "TCPRPJR": "Jar (budget)",
    "MP1G":    "Mylar Bag 1g (Manicured)",
    "MP3G":    "Mylar Bag 3g (Manicured)",
    "MP5G":    "Mylar Bag 5g (Manicured)",
    "PP1G":    "Mylar Bag 1g (Pops)",
    "PP3G":    "Mylar Bag 3g (Pops)",
    "PP5G":    "Mylar Bag 5g (Pops)",
}


def format_date_code(d: Optional[_date] = None) -> str:
    d = d or _date.today()
    return d.strftime("%d%m%y")


def build_batch_id(family: str, product_code: str, sequence: int, date_code: str) -> str:
    """Deterministic V6 base batch ID. Raises ValueError on bad input."""
    prefix = FAMILIES.get(family)
    if not prefix:
        raise ValueError(f"Unknown batch family '{family}'")
    code = (product_code or "").strip().upper()
    if not code.isalnum() or not (2 <= len(code) <= 4):
        raise ValueError("Product shortcode must be 2-4 alphanumeric characters")
    if not (1 <= sequence <= 999):
        raise ValueError("Sequence must be between 1 and 999")
    if len(date_code) != 6 or not date_code.isdigit():
        raise ValueError("Date code must be DDMMYY")
    return f"{prefix}{code}-{sequence:03d}-{date_code}"


# ── Imported stock (BI prefix) — confirmed from the S6 Stock Receiving Logbook ─
# Format: BI{supplier}-{product}{type_digit}{import_ref:02d}{subcat?}-{DDMMYY}
# e.g. BISB-JSY340L-300426 = Seven Blade / Jealousy / Greenhouse / ref 40 / Large.
# The import ref is a stable per-product 2-digit registry number; the type digit
# describes this shipment and can differ between shipments of the same product.

IMPORT_TYPES = {
    1: "Indoor",
    2: "Greendoor",
    3: "Greenhouse",
    4: "Distillate",
    5: "Vape",
    6: "Hash",
    7: "Edible",
    8: "Tincture",
    9: "Trim",
}

IMPORT_SUBCATS = {
    "L": "Large",
    "P": "Pops",
    "S": "Smalls",
}


def build_import_batch_id(supplier_code: str, product_code: str, type_digit: int,
                          import_ref: int, subcat: Optional[str], date_code: str) -> str:
    """Deterministic BI (Bassani Import) batch ID. Raises ValueError on bad input."""
    sup = (supplier_code or "").strip().upper()
    if not sup.isalpha() or len(sup) != 2:
        raise ValueError("Supplier shortcode must be exactly 2 letters")
    prod = (product_code or "").strip().upper()
    if not prod.isalnum() or not (2 <= len(prod) <= 4):
        raise ValueError("Product shortcode must be 2-4 alphanumeric characters")
    if type_digit not in IMPORT_TYPES:
        raise ValueError("Unknown stock type")
    if not (1 <= import_ref <= 99):
        raise ValueError("Import reference must be between 1 and 99")
    sub = (subcat or "").strip().upper()
    if sub and sub not in IMPORT_SUBCATS:
        raise ValueError("Unknown sub-category character")
    if len(date_code) != 6 or not date_code.isdigit():
        raise ValueError("Date code must be DDMMYY")
    return f"BI{sup}-{prod}{type_digit}{import_ref:02d}{sub}-{date_code}"


def split_stage(batch_id: str) -> tuple[str, Optional[str]]:
    """Return (base_id, stage_suffix|None) for any registry batch ID."""
    head, _, tail = batch_id.rpartition("-")
    if head and tail in STAGE_SUFFIXES:
        return head, tail
    return batch_id, None


def derive_stage_id(parent_batch_id: str, suffix: str) -> str:
    """Stage progression: strip the parent's current stage token (if any) and
    apply the new one — suffixes replace, they never stack."""
    suffix = suffix.strip().upper()
    if suffix not in STAGE_SUFFIXES:
        raise ValueError(f"Unknown stage suffix '{suffix}'")
    base, _current = split_stage(parent_batch_id)
    return f"{base}-{suffix}"
