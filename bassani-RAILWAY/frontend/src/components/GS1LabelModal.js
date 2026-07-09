import { useState, useEffect, useRef, useCallback } from "react";
import bwipjs from "bwip-js";
import { X, Printer, Download, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import api from "../api";
import { Modal, BtnPrimary, BtnSecondary, FormGroup, Input } from "./UI";
import toast from "react-hot-toast";

// ── GS1 AI text builder (bracket notation — bwip-js native format) ────────────
function buildGs1Text(gtin, lot = "", expiryYYMMDD = "", serial = "") {
  const g14 = gtin.padStart(14, "0");
  let s = `(01)${g14}`;
  if (expiryYYMMDD) s += `(17)${expiryYYMMDD}`;
  if (lot)          s += `(10)${lot}`;
  if (serial)       s += `(21)${serial}`;
  return s;
}

// YYMMDD from a YYYY-MM-DD date input value
function toYYMMDD(iso) {
  if (!iso) return "";
  return iso.replace(/-/g, "").slice(2); // "2027-01-31" → "270131"
}

// Friendly display from YYYY-MM-DD
function fmtExpiry(iso) {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", {
      month: "short", year: "numeric",
    });
  } catch {
    return iso;
  }
}

// Basic GTIN structure check (digits only, 13 or 14 chars)
function looksLikeGtin(s) {
  return /^\d{13,14}$/.test(s);
}

// ── Label canvas preview ──────────────────────────────────────────────────────
function BarcodeCanvas({ bcid, text, scale = 3, height, includetext = false, onError }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!ref.current || !text) return;
    try {
      bwipjs.toCanvas(ref.current, {
        bcid,
        text,
        scale,
        ...(height ? { height } : {}),
        includetext,
        padding: 4,
        backgroundcolor: "ffffff",
      });
      onError?.(null);
    } catch (e) {
      onError?.(e.message || "Barcode render error");
    }
  }, [bcid, text, scale, height, includetext, onError]);

  return <canvas ref={ref} className="block" />;
}

// ── Label preview card — mirrors the ZPL layout ───────────────────────────────
function LabelPreview({ type, productName, gtin, lot, expiryDisplay, expiryYYMMDD, serial, qty }) {
  const [unitErr, setUnitErr]   = useState(null);
  const [cartonErr, setCartonErr] = useState(null);
  const g14   = gtin.padStart(14, "0");
  const unitText   = buildGs1Text(gtin, lot, expiryYYMMDD, serial);
  const cartonText = buildGs1Text(gtin, lot, expiryYYMMDD) + (qty > 0 ? `(37)${qty}` : "");

  const onUnitErr   = useCallback(e => setUnitErr(e),   []);
  const onCartonErr = useCallback(e => setCartonErr(e), []);

  return (
    <div className="space-y-4">
      {/* Unit label */}
      {type !== "carton" && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Unit Label — GS1 DataMatrix
          </p>
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm">
            <div
              className="flex items-stretch gap-0"
              style={{ minHeight: 90, fontFamily: "monospace" }}
            >
              {/* Text side */}
              <div className="flex-1 px-3 py-2.5 flex flex-col justify-between">
                <div>
                  <p className="text-[11px] font-bold text-gray-500 tracking-wide">BASSANI HEALTH</p>
                  <p className="text-sm font-bold text-gray-900 leading-tight mt-0.5 line-clamp-1">
                    {productName}
                  </p>
                </div>
                <div className="space-y-0.5 mt-1">
                  {(lot || expiryDisplay) && (
                    <p className="text-[10px] text-gray-600">
                      {lot ? `Lot: ${lot}` : ""}
                      {lot && expiryDisplay ? "   " : ""}
                      {expiryDisplay ? `Exp: ${expiryDisplay}` : ""}
                    </p>
                  )}
                  {serial && (
                    <p className="text-[10px] text-gray-600">Serial: {serial || "—"}</p>
                  )}
                  <p className="text-[9px] text-gray-400 font-mono">GTIN: {g14}</p>
                </div>
              </div>
              {/* Barcode side */}
              <div className="shrink-0 flex items-center justify-center px-2 bg-gray-50/50 border-l border-gray-100">
                {unitErr ? (
                  <div className="text-center px-2 py-3">
                    <AlertTriangle size={14} className="text-amber-500 mx-auto mb-1" />
                    <p className="text-[9px] text-amber-600 max-w-[80px]">{unitErr}</p>
                  </div>
                ) : (
                  <BarcodeCanvas
                    bcid="gs1datamatrix"
                    text={unitText}
                    scale={3}
                    onError={onUnitErr}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Carton label */}
      {type !== "unit" && (
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">
            Carton Label — GS1-128
          </p>
          <div className="border border-gray-200 rounded-xl overflow-hidden bg-white shadow-sm p-3">
            <div className="flex items-center justify-between mb-1">
              <p className="text-[11px] font-bold text-gray-500 tracking-wide">BASSANI HEALTH</p>
              {qty > 0 && <p className="text-[10px] text-gray-500">Qty: {qty}</p>}
            </div>
            <p className="text-sm font-bold text-gray-900 leading-tight line-clamp-1 mb-1">{productName}</p>
            {(lot || expiryDisplay) && (
              <p className="text-[10px] text-gray-600 mb-2">
                {lot ? `Lot: ${lot}` : ""}
                {lot && expiryDisplay ? "   " : ""}
                {expiryDisplay ? `Exp: ${expiryDisplay}` : ""}
              </p>
            )}
            {cartonErr ? (
              <div className="flex items-center gap-1.5 text-amber-600 text-[10px]">
                <AlertTriangle size={11} />{cartonErr}
              </div>
            ) : (
              <BarcodeCanvas
                bcid="gs1-128"
                text={cartonText}
                scale={2}
                height={12}
                includetext
                onError={onCartonErr}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function GS1LabelModal({ product, onClose }) {
  const [lot,         setLot        ] = useState("");
  const [expiry,      setExpiry      ] = useState("");      // YYYY-MM-DD
  const [serial,      setSerial      ] = useState("00000001");
  const [qty,         setQty         ] = useState(1);
  const [labelType,   setLabelType   ] = useState("unit");  // "unit" | "carton" | "both"
  const [printers,    setPrinters    ] = useState([]);
  const [printerKey,  setPrinterKey  ] = useState("");
  const [printing,    setPrinting    ] = useState(false);

  const gtin        = product?.barcode || "";
  const isValidGtin = looksLikeGtin(gtin);
  const expiryYYMMDD  = toYYMMDD(expiry);
  const expiryDisplay = fmtExpiry(expiry);

  useEffect(() => {
    api.get("/api/labels/printers")
      .then(r => {
        const list = r.data.printers || [];
        setPrinters(list);
        if (list.length > 0) setPrinterKey(list[0].key);
      })
      .catch(() => {});
  }, []);

  const printToZebra = async () => {
    if (!printerKey) return toast.error("No printer selected");
    setPrinting(true);
    try {
      const r = await api.post("/api/labels/gs1/print", {
        product_id:    product.id,
        product_name:  product.name || product.display_name,
        gtin,
        lot,
        expiry_display:  expiryDisplay,
        expiry_yymmdd:   expiryYYMMDD,
        serial_start:    parseInt(serial) || 1,
        qty,
        printer_key: printerKey,
        label_type:  labelType,
      });
      toast.success(r.data.message);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Print failed");
    } finally {
      setPrinting(false);
    }
  };

  const printViaBrowser = () => {
    window.print();
  };

  if (!product) return null;

  const productName = (() => {
    const full = product.display_name || product.name || "";
    const bi   = full.indexOf(" (");
    return bi !== -1 ? full.slice(0, bi) : full;
  })();

  return (
    <>
      {/* Print-only stylesheet — hides everything except the label preview */}
      <style>{`
        @media print {
          body > * { display: none !important; }
          #gs1-print-content { display: block !important; position: fixed; top: 0; left: 0; padding: 12mm; }
        }
        #gs1-print-content { display: none; }
      `}</style>

      {/* Hidden print frame — mirrors the preview, no modal chrome */}
      <div id="gs1-print-content">
        <LabelPreview
          type={labelType}
          productName={productName}
          gtin={gtin}
          lot={lot}
          expiryDisplay={expiryDisplay}
          expiryYYMMDD={expiryYYMMDD}
          serial={serial}
          qty={qty}
        />
      </div>

      <Modal title="GS1 Label" onClose={onClose}>
        <div className="flex flex-col gap-4">
          {/* Product + GTIN header */}
          <div className="flex items-start justify-between gap-4 pb-3 border-b border-gray-100">
            <div>
              <p className="text-sm font-bold text-gray-900">{productName}</p>
              <p className="text-xs font-mono text-gray-500 mt-0.5">GTIN: {gtin}</p>
            </div>
            {!isValidGtin && (
              <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 shrink-0">
                <AlertTriangle size={12} className="text-amber-500" />
                <p className="text-[10px] text-amber-700 font-medium">
                  Not a valid GTIN-13/14 — add to Odoo barcode field
                </p>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Left — label fields */}
            <div className="space-y-3">
              <FormGroup label="Batch / Lot number">
                <Input
                  value={lot}
                  onChange={e => setLot(e.target.value)}
                  placeholder="e.g. BHAPIBBY-001-010126"
                />
              </FormGroup>
              <FormGroup label="Expiry date">
                <Input
                  type="date"
                  value={expiry}
                  onChange={e => setExpiry(e.target.value)}
                />
              </FormGroup>
              <div className="grid grid-cols-2 gap-2">
                <FormGroup label="Serial number (start)">
                  <Input
                    type="number"
                    min="1"
                    value={serial.replace(/^0+/, "") || "1"}
                    onChange={e => setSerial(String(parseInt(e.target.value) || 1).padStart(8, "0"))}
                  />
                </FormGroup>
                <FormGroup label="Quantity">
                  <Input
                    type="number"
                    min="1"
                    value={qty}
                    onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                  />
                </FormGroup>
              </div>

              {/* Label type */}
              <div>
                <p className="text-xs font-medium text-gray-700 mb-1.5">Label type</p>
                <div className="flex gap-1.5">
                  {[
                    { key: "unit",   label: "Unit" },
                    { key: "carton", label: "Carton" },
                    { key: "both",   label: "Both" },
                  ].map(o => (
                    <button
                      key={o.key}
                      onClick={() => setLabelType(o.key)}
                      className={`text-xs font-medium px-3 py-1.5 rounded-lg border transition-colors ${
                        labelType === o.key
                          ? "bg-bassani-600 text-white border-bassani-600"
                          : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Printer selector */}
              {printers.length > 0 ? (
                <div>
                  <p className="text-xs font-medium text-gray-700 mb-1.5">Printer</p>
                  <select
                    value={printerKey}
                    onChange={e => setPrinterKey(e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-bassani-300 bg-white"
                  >
                    {printers.map(p => (
                      <option key={p.key} value={p.key}>{p.name} ({p.ip})</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex items-start gap-2 bg-gray-50 border border-gray-200 rounded-lg p-2.5">
                  <AlertTriangle size={13} className="text-gray-400 shrink-0 mt-0.5" />
                  <p className="text-[11px] text-gray-500">
                    No Zebra printer configured. Add one in{" "}
                    <a href="/settings?tab=label-printers" className="text-bassani-600 underline">
                      Settings → Label Printers
                    </a>{" "}
                    to enable direct printing.
                  </p>
                </div>
              )}
            </div>

            {/* Right — live preview */}
            <div>
              <p className="text-xs font-medium text-gray-700 mb-1.5">Preview</p>
              {isValidGtin ? (
                <LabelPreview
                  type={labelType}
                  productName={productName}
                  gtin={gtin}
                  lot={lot}
                  expiryDisplay={expiryDisplay}
                  expiryYYMMDD={expiryYYMMDD}
                  serial={serial}
                  qty={qty}
                />
              ) : (
                <div className="border border-dashed border-gray-200 rounded-xl flex items-center justify-center h-32 text-center px-4">
                  <p className="text-xs text-gray-400">Enter a valid GTIN in Odoo to preview</p>
                </div>
              )}
            </div>
          </div>

          {/* Action row */}
          <div className="flex items-center justify-between pt-3 border-t border-gray-100">
            <button
              onClick={printViaBrowser}
              disabled={!isValidGtin}
              className="flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              <Download size={13} />
              Print via browser
            </button>
            <div className="flex items-center gap-2">
              <BtnSecondary onClick={onClose}>Close</BtnSecondary>
              <BtnPrimary
                onClick={printToZebra}
                loading={printing}
                disabled={!isValidGtin || !printerKey || printing}
              >
                <Printer size={13} />
                Print to Zebra
              </BtnPrimary>
            </div>
          </div>

          {/* Dummy GTIN notice */}
          {isValidGtin && (
            <p className="text-[10px] text-gray-400 text-center -mt-1">
              Using dummy GTIN for testing — replace with official GS1 SA assigned GTIN before going live.
            </p>
          )}
        </div>
      </Modal>
    </>
  );
}
