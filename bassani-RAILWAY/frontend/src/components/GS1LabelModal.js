import { useState, useEffect, useRef, useCallback } from "react";
import bwipjs from "bwip-js";
import { Printer, Download, AlertTriangle, CheckCircle2, Tag } from "lucide-react";
import api from "../api";
import { Modal, BtnPrimary, BtnSecondary, FormGroup, Input, parseDisplayName } from "./UI";
import toast from "react-hot-toast";

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildGs1Text(gtin, lot = "", expiryYYMMDD = "", serial = "") {
  const g14 = gtin.padStart(14, "0");
  let s = `(01)${g14}`;
  if (expiryYYMMDD) s += `(17)${expiryYYMMDD}`;
  if (lot)          s += `(10)${lot}`;
  if (serial)       s += `(21)${serial}`;
  return s;
}

function toYYMMDD(iso) {
  if (!iso) return "";
  return iso.replace(/-/g, "").slice(2);
}

function fmtExpiry(iso) {
  if (!iso) return "";
  try {
    return new Date(iso + "T00:00:00").toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" });
  } catch { return iso; }
}

function looksLikeGtin(s) {
  return /^\d{13,14}$/.test(s);
}

// ── Barcode canvas ────────────────────────────────────────────────────────────

function BarcodeCanvas({ bcid, text, scale = 3, height, includetext = false, onError }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!ref.current || !text) return;
    try {
      bwipjs.toCanvas(ref.current, { bcid, text, scale, ...(height ? { height } : {}), includetext, padding: 2, backgroundcolor: "ffffff" });
      onError?.(null);
    } catch (e) { onError?.(e.message || "Render error"); }
  }, [bcid, text, scale, height, includetext, onError]);
  return <canvas ref={ref} className="block max-w-full" />;
}

// ── Unit label card ───────────────────────────────────────────────────────────

function UnitLabel({ productName, gtin, lot, expiryDisplay, expiryYYMMDD = "", serial }) {
  const [err, setErr] = useState(null);
  const onErr = useCallback(e => setErr(e), []);
  const text  = buildGs1Text(gtin, lot, expiryYYMMDD, serial);
  const g14   = gtin.padStart(14, "0");

  return (
    <div
      className="bg-white border border-gray-300 rounded-lg overflow-hidden"
      style={{ boxShadow: "0 2px 8px 0 rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)" }}
    >
      {/* Label header band */}
      <div className="bg-gray-800 px-3 py-1.5 flex items-center justify-between">
        <span className="text-white text-[10px] font-bold tracking-widest uppercase">Bassani Health</span>
        <span className="text-gray-400 text-[9px] tracking-wide uppercase">Unit Label · GS1 DataMatrix</span>
      </div>

      <div className="flex items-stretch">
        {/* Text area */}
        <div className="flex-1 px-3 py-2.5 flex flex-col justify-between min-w-0">
          <div>
            <p className="text-sm font-bold text-gray-900 leading-snug truncate">{productName || "—"}</p>
          </div>
          <div className="mt-2 space-y-0.5">
            <div className="flex items-center gap-3 flex-wrap">
              {lot && (
                <div>
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Lot / Batch</p>
                  <p className="text-xs font-mono text-gray-700 font-medium">{lot}</p>
                </div>
              )}
              {expiryDisplay && (
                <div>
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Expires</p>
                  <p className="text-xs font-mono text-gray-700 font-medium">{expiryDisplay}</p>
                </div>
              )}
              {serial && (
                <div>
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Serial</p>
                  <p className="text-xs font-mono text-gray-700 font-medium">{serial}</p>
                </div>
              )}
            </div>
            <p className="text-[9px] font-mono text-gray-400 mt-1">GTIN: {g14}</p>
          </div>
        </div>

        {/* Barcode area */}
        <div className="shrink-0 flex items-center justify-center p-3 bg-gray-50 border-l border-gray-200">
          {err ? (
            <div className="text-center p-2">
              <AlertTriangle size={16} className="text-amber-400 mx-auto mb-1" />
              <p className="text-[9px] text-amber-600 max-w-[72px]">{err}</p>
            </div>
          ) : (
            <BarcodeCanvas bcid="gs1datamatrix" text={text} scale={4} onError={onErr} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Carton label card ─────────────────────────────────────────────────────────

function CartonLabel({ productName, gtin, lot, expiryDisplay, expiryYYMMDD, qty }) {
  const [err, setErr] = useState(null);
  const onErr = useCallback(e => setErr(e), []);
  const text  = buildGs1Text(gtin, lot, expiryYYMMDD) + (qty > 0 ? `(30)${qty}` : "");
  const g14   = gtin.padStart(14, "0");

  return (
    <div
      className="bg-white border border-gray-300 rounded-lg overflow-hidden"
      style={{ boxShadow: "0 2px 8px 0 rgba(0,0,0,0.10), 0 0 0 1px rgba(0,0,0,0.04)" }}
    >
      <div className="bg-gray-800 px-3 py-1.5 flex items-center justify-between">
        <span className="text-white text-[10px] font-bold tracking-widest uppercase">Bassani Health</span>
        <span className="text-gray-400 text-[9px] tracking-wide uppercase">Outer Carton · GS1-128</span>
      </div>

      <div className="px-3 pt-2.5 pb-1">
        <div className="flex items-start justify-between gap-2 mb-2">
          <p className="text-sm font-bold text-gray-900 leading-snug">{productName || "—"}</p>
          {qty > 0 && (
            <span className="shrink-0 text-xs font-semibold text-gray-600 bg-gray-100 rounded px-2 py-0.5 border border-gray-200">
              Qty: {qty}
            </span>
          )}
        </div>
        <div className="flex gap-4 mb-2">
          {lot && (
            <div>
              <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Lot / Batch</p>
              <p className="text-xs font-mono text-gray-700">{lot}</p>
            </div>
          )}
          {expiryDisplay && (
            <div>
              <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wide">Expires</p>
              <p className="text-xs font-mono text-gray-700">{expiryDisplay}</p>
            </div>
          )}
        </div>
      </div>

      <div className="px-3 pb-2.5 border-t border-gray-100 pt-2">
        {err ? (
          <div className="flex items-center gap-2 py-2 text-amber-600 text-xs">
            <AlertTriangle size={13} />{err}
          </div>
        ) : (
          <div className="flex flex-col items-center">
            <BarcodeCanvas bcid="gs1-128" text={text} scale={2} height={14} includetext onError={onErr} />
          </div>
        )}
        <p className="text-[9px] font-mono text-gray-400 text-center mt-1">GTIN: {g14}</p>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

const LABEL_TYPES = [
  { key: "unit",   label: "Unit",   desc: "57 × 32 mm · DataMatrix" },
  { key: "carton", label: "Carton", desc: "100 × 50 mm · GS1-128"   },
  { key: "both",   label: "Both",   desc: "Unit + Carton"            },
];

export default function GS1LabelModal({ product, onClose }) {
  const [lot,         setLot        ] = useState("");
  const [expiry,      setExpiry     ] = useState("");
  const [serial,      setSerial     ] = useState("00000001");
  const [qty,         setQty        ] = useState(1);
  const [labelType,   setLabelType  ] = useState("unit");
  const [printers,    setPrinters   ] = useState([]);
  const [printerKey,  setPrinterKey ] = useState("");
  const [printing,    setPrinting   ] = useState(false);
  const [lots,        setLots       ] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [showLotDrop, setShowLotDrop] = useState(false);
  const [uomName,     setUomName    ] = useState(null);

  const gtin          = product?.barcode || "";
  const isValidGtin   = looksLikeGtin(gtin);
  const expiryYYMMDD  = toYYMMDD(expiry);
  const expiryDisplay = fmtExpiry(expiry);

  const { base: productName, groups: variantGroups } = parseDisplayName(product?.display_name || product?.name || "");
  const variantLabel = variantGroups.length > 0 ? variantGroups.join(" / ") : null;

  useEffect(() => {
    api.get("/api/labels/printers")
      .then(r => {
        const list = r.data.printers || [];
        setPrinters(list);
        if (list.length > 0) setPrinterKey(list[0].key);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!product?.id) return;
    setLotsLoading(true);
    api.get(`/api/products/${product.id}/lots`)
      .then(r => setLots(r.data.lots || []))
      .catch(() => {})
      .finally(() => setLotsLoading(false));
  }, [product?.id]); // eslint-disable-line

  const lotSuggestions = lots.filter(l =>
    !lot || l.name.toLowerCase().includes(lot.toLowerCase())
  );

  const selectLot = (l) => {
    setLot(l.name);
    if (l.expiration_date) setExpiry(l.expiration_date);
    setQty(Math.max(1, Math.floor(l.qty)));
    setUomName(l.uom_name || null);
    setShowLotDrop(false);
  };

  const printToZebra = async () => {
    if (!printerKey) return toast.error("No printer selected");
    setPrinting(true);
    try {
      const r = await api.post("/api/labels/gs1/print", {
        product_id:   product.id,
        product_name: productName,
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

  if (!product) return null;

  return (
    <>
      <style>{`
        @media print {
          body > * { display: none !important; }
          #gs1-print-content { display: block !important; position: fixed; top: 0; left: 0; padding: 12mm; }
        }
        #gs1-print-content { display: none; }
      `}</style>

      <div id="gs1-print-content">
        {labelType !== "carton" && (
          <UnitLabel
            productName={productName} gtin={gtin} lot={lot}
            expiryDisplay={expiryDisplay} expiryYYMMDD={expiryYYMMDD} serial={serial}
          />
        )}
        {labelType !== "unit" && (
          <div style={{ marginTop: 8 }}>
            <CartonLabel
              productName={productName} gtin={gtin} lot={lot}
              expiryDisplay={expiryDisplay} expiryYYMMDD={expiryYYMMDD} qty={qty}
            />
          </div>
        )}
      </div>

      <Modal title="Print GS1 Label" onClose={onClose} width="max-w-3xl">

        {/* ── Product identity banner ── */}
        <div className={`-mx-6 -mt-5 px-6 py-4 mb-6 border-b flex items-center gap-4 ${isValidGtin ? "bg-gray-50" : "bg-amber-50 border-amber-200"}`}>
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isValidGtin ? "bg-bassani-100" : "bg-amber-100"}`}>
            <Tag size={18} className={isValidGtin ? "text-bassani-600" : "text-amber-500"} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-gray-900 truncate">{productName}</p>
              {variantLabel && (
                <span className="text-[10px] bg-bassani-50 text-bassani-700 border border-bassani-100 rounded px-1.5 py-0.5 font-medium shrink-0">{variantLabel}</span>
              )}
            </div>
            <div className="flex items-center gap-2 mt-0.5">
              <p className="text-xs font-mono text-gray-500">GTIN: {gtin || "—"}</p>
              {isValidGtin ? (
                <span className="flex items-center gap-1 text-[10px] text-green-600 font-medium">
                  <CheckCircle2 size={11} />EAN-13 valid
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-amber-600 font-medium">
                  <AlertTriangle size={11} />No valid GTIN — set it in the Barcode column first
                </span>
              )}
            </div>
          </div>
        </div>

        {/* ── Two-panel body ── */}
        <div className="grid grid-cols-1 md:grid-cols-[300px_1fr] gap-8">

          {/* LEFT — form */}
          <div className="space-y-5">

            {/* Label type */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Label Type</p>
              <div className="flex flex-col gap-1.5">
                {LABEL_TYPES.map(o => (
                  <button
                    key={o.key}
                    onClick={() => setLabelType(o.key)}
                    className={`flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl border text-left transition-all ${
                      labelType === o.key
                        ? "border-bassani-400 bg-bassani-50 shadow-sm"
                        : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                    }`}
                  >
                    <span className={`w-3 h-3 rounded-full border-2 shrink-0 transition-colors ${
                      labelType === o.key ? "border-bassani-600 bg-bassani-600" : "border-gray-300"
                    }`} />
                    <div>
                      <p className={`text-sm font-medium ${labelType === o.key ? "text-bassani-800" : "text-gray-700"}`}>{o.label}</p>
                      <p className="text-[10px] text-gray-400">{o.desc}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-100" />

            {/* Label data fields */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Label Data</p>
              <div className="space-y-3">
                <FormGroup label="Batch / Lot number">
                  <div className="relative">
                    <Input
                      value={lot}
                      onChange={e => { setLot(e.target.value); setShowLotDrop(true); }}
                      onFocus={() => setShowLotDrop(true)}
                      onBlur={() => setTimeout(() => setShowLotDrop(false), 150)}
                      placeholder={lotsLoading ? "Loading lots…" : lots.length > 0 ? "Type or select a lot…" : "e.g. BHAPIBBY-001-010126"}
                    />
                    {showLotDrop && lotSuggestions.length > 0 && (
                      <div className="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg max-h-52 overflow-y-auto">
                        {lotSuggestions.map(l => (
                          <button
                            key={l.id}
                            onMouseDown={() => selectLot(l)}
                            className="w-full text-left px-3 py-2.5 hover:bg-bassani-50 transition-colors border-b border-gray-50 last:border-0"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-sm font-mono font-medium text-gray-900">{l.name}</span>
                              <span className="text-xs text-bassani-700 font-semibold shrink-0">{l.qty} {l.uom_name || ""}</span>
                            </div>
                            {l.expiration_date && (
                              <p className="text-[10px] text-gray-400 mt-0.5">Exp: {l.expiration_date}</p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </FormGroup>
                <FormGroup label="Expiry date">
                  <Input
                    type="date"
                    value={expiry}
                    onChange={e => setExpiry(e.target.value)}
                  />
                </FormGroup>
                <div className="grid grid-cols-2 gap-3">
                  <FormGroup label="Serial start">
                    <Input
                      type="number"
                      min="1"
                      value={parseInt(serial) || 1}
                      onChange={e => setSerial(String(Math.max(1, parseInt(e.target.value) || 1)).padStart(8, "0"))}
                    />
                  </FormGroup>
                  <FormGroup label={uomName ? `Quantity (${uomName})` : "Quantity"}>
                    <Input
                      type="number"
                      min="1"
                      value={qty}
                      onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))}
                    />
                  </FormGroup>
                </div>
              </div>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-100" />

            {/* Printer */}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Printer</p>
              {printers.length > 0 ? (
                <div className="space-y-1.5">
                  {printers.map(p => (
                    <button
                      key={p.key}
                      onClick={() => setPrinterKey(p.key)}
                      className={`flex items-center gap-3 w-full px-3.5 py-2.5 rounded-xl border text-left transition-all ${
                        printerKey === p.key
                          ? "border-bassani-400 bg-bassani-50 shadow-sm"
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <span className={`w-3 h-3 rounded-full border-2 shrink-0 ${
                        printerKey === p.key ? "border-bassani-600 bg-bassani-600" : "border-gray-300"
                      }`} />
                      <div className="min-w-0">
                        <p className={`text-sm font-medium truncate ${printerKey === p.key ? "text-bassani-800" : "text-gray-700"}`}>{p.name}</p>
                        <p className="text-[10px] font-mono text-gray-400">{p.ip}:9100</p>
                      </div>
                      <Printer size={14} className={`ml-auto shrink-0 ${printerKey === p.key ? "text-bassani-400" : "text-gray-300"}`} />
                    </button>
                  ))}
                </div>
              ) : (
                <div className="flex items-start gap-2.5 bg-gray-50 border border-gray-200 rounded-xl p-3">
                  <AlertTriangle size={14} className="text-gray-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-gray-500 leading-relaxed">
                    No printer configured.{" "}
                    <a href="/settings?tab=label-printers" className="text-bassani-600 underline font-medium">
                      Settings → Label Printers
                    </a>
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* RIGHT — live preview */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">Live Preview</p>

            {isValidGtin ? (
              <div className="space-y-4">
                {labelType !== "carton" && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1.5 font-medium">Unit label — prints {qty} {qty === 1 ? "copy" : "copies"}</p>
                    <UnitLabel
                      productName={productName}
                      gtin={gtin}
                      lot={lot}
                      expiryDisplay={expiryDisplay}
                      expiryYYMMDD={expiryYYMMDD}
                      serial={serial}
                    />
                  </div>
                )}
                {labelType !== "unit" && (
                  <div>
                    <p className="text-[10px] text-gray-400 mb-1.5 font-medium">Carton label — prints 1 copy</p>
                    <CartonLabel
                      productName={productName}
                      gtin={gtin}
                      lot={lot}
                      expiryDisplay={expiryDisplay}
                      expiryYYMMDD={expiryYYMMDD}
                      qty={qty}
                    />
                  </div>
                )}

                {/* Test GTIN notice */}
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                  <AlertTriangle size={12} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-700 leading-relaxed">
                    Printing with a dummy GTIN. Replace with your GS1 SA assigned GTIN before dispatching to pharmacy.
                  </p>
                </div>
              </div>
            ) : (
              <div className="h-48 flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl text-center px-6 gap-2">
                <Tag size={28} className="text-gray-200" />
                <p className="text-sm font-medium text-gray-400">No GTIN set</p>
                <p className="text-xs text-gray-400">Set a valid GTIN-13 or GTIN-14 on this product to preview the label.</p>
              </div>
            )}
          </div>
        </div>

        {/* ── Footer actions ── */}
        <div className="flex items-center justify-between pt-5 mt-6 border-t border-gray-100">
          <button
            onClick={() => window.print()}
            disabled={!isValidGtin}
            className="flex items-center gap-2 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <Download size={14} />
            Print via browser
          </button>
          <div className="flex items-center gap-2">
            <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
            <BtnPrimary
              onClick={printToZebra}
              loading={printing}
              disabled={!isValidGtin || !printerKey || printing}
            >
              <Printer size={14} />
              Print to Zebra
            </BtnPrimary>
          </div>
        </div>
      </Modal>
    </>
  );
}
