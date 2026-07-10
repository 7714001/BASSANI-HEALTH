"""
GS1 barcode utilities — GTIN validation, AI string building, ZPL generation, TCP print.

All ZPL targets the Zebra ZT411 at 300 DPI (thermal transfer).
"""
import socket


# ── GTIN validation ───────────────────────────────────────────────────────────

def validate_gtin(gtin: str) -> bool:
    """Validate GS1 check digit for GTIN-8, 12, 13, or 14."""
    if not gtin.isdigit() or len(gtin) not in (8, 12, 13, 14):
        return False
    n = len(gtin)
    total = sum(
        int(d) * (3 if (n - 1 - i) % 2 == 1 else 1)
        for i, d in enumerate(gtin[:-1])
    )
    return (10 - (total % 10)) % 10 == int(gtin[-1])


def gtin14(gtin: str) -> str:
    """Zero-pad a GTIN to 14 digits (GTIN-13/EAN-13 → GTIN-14)."""
    return gtin.zfill(14)


# ── GS1 AI string (bracket notation — for bwip-js and human-readable output) ──

def build_gs1_text(gtin: str, lot: str = "", expiry_yymmdd: str = "", serial: str = "") -> str:
    """
    Return the GS1 AI string in bracket notation.
    bwip-js accepts this format directly for gs1datamatrix / gs1-128 barcodes.
    Fixed-length AIs first, variable-length last (minimises FNC1 separators).
    """
    g14 = gtin14(gtin)
    s = f"(01){g14}"
    if expiry_yymmdd:
        s += f"(17){expiry_yymmdd}"
    if lot:
        s += f"(10){lot}"
    if serial:
        s += f"(21){serial}"
    return s


# ── ZPL generation ────────────────────────────────────────────────────────────

def _mm_to_dots(mm: float, dpi: int = 300) -> int:
    return int(mm * dpi / 25.4)


def build_zpl_unit_label(
    product_name: str,
    gtin: str,
    lot: str = "",
    expiry_display: str = "",
    expiry_yymmdd: str = "",
    serial: str = "",
    width_mm: float = 57,
    height_mm: float = 32,
    dpi: int = 300,
) -> str:
    """
    ZPL for a GS1 DataMatrix unit label (unit-level, one per physical item).
    Default size 57 × 32 mm — common pharmaceutical label stock.
    """
    w = _mm_to_dots(width_mm, dpi)
    h = _mm_to_dots(height_mm, dpi)
    g14 = gtin14(gtin)
    name = product_name[:28]

    # GS1 DataMatrix data for ZPL:
    #   >8  = FNC1 in first position (signals GS1 DataMatrix to the printer)
    #   Fixed-length AIs (01=14 digits, 17=6 digits) need no terminator
    #   Variable-length AIs (10=lot, 21=serial) need >8 terminator before the next AI
    gs1 = f">801{g14}"
    if expiry_yymmdd:
        gs1 += f"17{expiry_yymmdd}"
    if lot and serial:
        gs1 += f"10{lot}>821{serial}"
    elif lot:
        gs1 += f"10{lot}"
    elif serial:
        gs1 += f"21{serial}"

    # DataMatrix module size — 6 dots at 300 DPI is reliable on 57 mm labels
    mod = max(4, dpi // 50)
    # DataMatrix starts at 70% of label width from the left edge
    dm_x = int(w * 0.60)

    zpl = ["^XA", f"^PW{w}", f"^LL{h}", "^CI28"]
    zpl.append(f"^FO20,14^A0N,28,28^FD{name}^FS")

    row = 50
    if lot or expiry_display:
        detail = ""
        if lot:
            detail += f"Lot: {lot}  "
        if expiry_display:
            detail += f"Exp: {expiry_display}"
        zpl.append(f"^FO20,{row}^A0N,22,22^FD{detail.strip()}^FS")
        row += 30

    if serial:
        zpl.append(f"^FO20,{row}^A0N,20,20^FDSerial: {serial}^FS")
        row += 28

    # GTIN human-readable — near bottom
    zpl.append(f"^FO20,{h - 30}^A0N,18,18^FDGTIN: {g14}^FS")

    # DataMatrix symbol
    zpl.append(f"^FO{dm_x},10^BXN,{mod},200^FD{gs1}^FS")

    zpl.append("^XZ")
    return "\n".join(zpl)


def build_zpl_carton_label(
    product_name: str,
    gtin: str,
    lot: str = "",
    expiry_display: str = "",
    expiry_yymmdd: str = "",
    qty: int = 0,
    width_mm: float = 100,
    height_mm: float = 50,
    dpi: int = 300,
) -> str:
    """
    ZPL for a GS1-128 outer carton label (one per shipping carton).
    Default size 100 × 50 mm.
    """
    w = _mm_to_dots(width_mm, dpi)
    h = _mm_to_dots(height_mm, dpi)
    g14 = gtin14(gtin)
    name = product_name[:38]

    # GS1-128 data for ZPL ^BC command:
    #   >; = FNC1 in first position for Code-128 GS1
    #   >8 = FNC1 separator between variable-length AIs
    gs1 = f">;01{g14}"
    if expiry_yymmdd:
        gs1 += f"17{expiry_yymmdd}"
    if lot:
        gs1 += f"10{lot}"
        if qty:
            gs1 += f">830{qty}"
    elif qty:
        gs1 += f"30{qty}"

    zpl = ["^XA", f"^PW{w}", f"^LL{h}", "^CI28"]
    zpl.append(f"^FO20,15^A0N,32,32^FD{name}^FS")

    row = 56
    if lot or expiry_display:
        detail = (f"Lot: {lot}   " if lot else "") + (expiry_display if expiry_display else "")
        zpl.append(f"^FO20,{row}^A0N,24,24^FD{detail.strip()}^FS")
        row += 32

    if qty:
        zpl.append(f"^FO20,{row}^A0N,24,24^FDQty: {qty}^FS")

    # GS1-128 barcode — positioned in lower portion
    bar_y = h - 110
    zpl.append(f"^FO20,{bar_y}^BCN,70,Y,N,N^FD{gs1}^FS")

    zpl.append("^XZ")
    return "\n".join(zpl)


# ── TCP print ─────────────────────────────────────────────────────────────────

def send_zpl(printer_ip: str, zpl: str, port: int = 9100, timeout: int = 10) -> None:
    """
    Send ZPL to a Zebra printer via raw TCP port 9100.
    Raises ConnectionError (→ HTTP 503) on any socket failure.
    """
    try:
        with socket.create_connection((printer_ip, port), timeout=timeout) as sock:
            sock.sendall(zpl.encode("utf-8"))
    except (OSError, TimeoutError) as exc:
        raise ConnectionError(
            f"Cannot reach label printer at {printer_ip}:{port} — {exc}"
        ) from exc
