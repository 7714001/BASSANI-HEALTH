// Plain retail barcode export — Phase 12.7. Distinct from GS1LabelModal.js:
// that one encodes GTIN + batch/lot + expiry + serial as a GS1 DataMatrix/
// GS1-128 compliance label for per-unit pharmacy dispatch. This one is just
// the bare GTIN as an ordinary EAN-13 (or Code128 fallback), sized to the
// real GS1 retail barcode spec, for embedding into packaging artwork that
// gets sent to an external printer (e.g. a pre-printed can sleeve) rather
// than printed in-house per unit.
//
// GS1 General Specifications, retail barcode (EAN-13), verified directly
// against the installed bwip-js build rather than assumed:
//   - Nominal ("100%") size: 37.29mm wide x 25.93mm tall (bars + human-
//     readable digits together), magnification range 80%-200%.
//   - bwip-js's `width`/`height` options are natively in millimeters and
//     `height` sets the BAR height specifically — requesting the GS1
//     nominal bar height (22.85mm) with includetext:true reproduces the
//     textbook 25.93mm total, confirmed empirically (2026-08-03).
//   - bwip-js renders at a 72dpi baseline, then may pick its own internal
//     scaleX/scaleY (mutated back onto the options object) for rendering
//     quality at small sizes. True physical size = viewBox px / 2.835
//     (72dpi -> mm) / scaleX — verified against the requested size.
import { useState, useEffect, useRef, useCallback } from "react";
import bwipjs from "bwip-js";
import { Download, AlertTriangle } from "lucide-react";
import toast from "react-hot-toast";
import { Modal, BtnPrimary, BtnSecondary } from "./UI";

const GS1_NOMINAL_WIDTH_MM = 37.29;
const GS1_NOMINAL_BAR_HEIGHT_MM = 22.85; // bwip-js `height` = bar height, not total
const PX_PER_MM_72DPI = 72 / 25.4;
const MIN_MAG = 80;
const MAX_MAG = 200;
const PRINT_DPI = 300;

function isCleanGtin(code) {
  return /^\d{12,13}$/.test(code || "");
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Renders (without drawing anywhere) purely to read back the true physical
// size bwip-js settled on, via its own viewBox + the scaleX/scaleY it
// mutates onto the options object passed in.
function trueSizeMm(opts) {
  const svg = bwipjs.toSVG(opts); // mutates opts.scaleX/scaleY in place
  const m = svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/);
  if (!m) return null;
  const scaleX = opts.scaleX || 1;
  const scaleY = opts.scaleY || 1;
  return {
    widthMm:  (+m[1] / PX_PER_MM_72DPI) / scaleX,
    heightMm: (+m[2] / PX_PER_MM_72DPI) / scaleY,
  };
}

export default function BarcodeExportModal({ product, onClose }) {
  const barcode = product?.barcode || "";
  const usesEan13 = isCleanGtin(barcode);
  const bcid = usesEan13 ? "ean13" : "code128";

  const [magnification, setMagnification] = useState(100);
  const [error, setError] = useState(null);
  const [size, setSize] = useState(null); // { widthMm, heightMm }
  const canvasRef = useRef(null);

  const buildOpts = useCallback(() => {
    if (usesEan13) {
      return {
        bcid, text: barcode, includetext: true, textxalign: "center",
        backgroundcolor: "ffffff",
        width:  GS1_NOMINAL_WIDTH_MM * magnification / 100,
        height: GS1_NOMINAL_BAR_HEIGHT_MM * magnification / 100,
      };
    }
    // Code128 fallback — no fixed GS1 retail box to target, just scale proportionally.
    return {
      bcid, text: barcode, includetext: true, textxalign: "center",
      backgroundcolor: "ffffff",
      scale: Math.max(1, Math.round(2 * magnification / 100)),
    };
  }, [bcid, barcode, usesEan13, magnification]);

  useEffect(() => {
    if (!canvasRef.current || !barcode) return;
    try {
      const opts = buildOpts();
      bwipjs.toCanvas(canvasRef.current, opts);
      setSize(trueSizeMm(buildOpts()));
      setError(null);
    } catch (e) {
      setError(e.message || "Could not render barcode");
      setSize(null);
    }
  }, [buildOpts, barcode]);

  const downloadSvg = () => {
    try {
      const opts = buildOpts();
      const svg = bwipjs.toSVG(opts);
      const s = trueSizeMm(buildOpts());
      const patched = s
        ? svg.replace("<svg ", `<svg width="${s.widthMm.toFixed(2)}mm" height="${s.heightMm.toFixed(2)}mm" `)
        : svg;
      downloadBlob(new Blob([patched], { type: "image/svg+xml" }), `${barcode}-${magnification}pct.svg`);
    } catch (e) {
      toast.error(e.message || "Failed to generate SVG");
    }
  };

  const downloadPng = () => {
    try {
      const s = trueSizeMm(buildOpts());
      const src = document.createElement("canvas");
      bwipjs.toCanvas(src, buildOpts());

      const outW = s ? Math.round((s.widthMm / 25.4) * PRINT_DPI) : src.width;
      const outH = s ? Math.round((s.heightMm / 25.4) * PRINT_DPI) : src.height;

      const out = document.createElement("canvas");
      out.width = outW;
      out.height = outH;
      const ctx = out.getContext("2d");
      ctx.imageSmoothingEnabled = false; // keep bar edges crisp on upscale
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(src, 0, 0, out.width, out.height);
      out.toBlob(blob => downloadBlob(blob, `${barcode}-${magnification}pct-300dpi.png`), "image/png");
    } catch (e) {
      toast.error(e.message || "Failed to generate PNG");
    }
  };

  if (!product) return null;

  return (
    <Modal title="Export Barcode" onClose={onClose} width="max-w-lg">
      <p className="text-xs text-gray-500 mb-4">
        A plain retail barcode for packaging artwork (sleeves, cartons, print files) — just the product
        identifier, no batch/lot/expiry data. For per-unit pharmacy dispatch labels with traceability
        data, use the GS1 button instead.
      </p>

      <div className="mb-4 px-3 py-2.5 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-xs text-gray-500 mb-0.5">Product</p>
        <p className="text-sm font-semibold text-gray-900">{product.name}</p>
        <p className="text-xs font-mono text-gray-500 mt-0.5">{barcode || "No barcode set"}</p>
      </div>

      {!barcode ? (
        <div className="text-center py-8 text-gray-400">
          <AlertTriangle size={22} className="mx-auto mb-2 text-amber-400" />
          <p className="text-sm">Set a barcode on this product first.</p>
        </div>
      ) : (
        <>
          {!usesEan13 && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5 mb-4">
              <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                This isn't a clean 12-13 digit GTIN, so it renders as Code128 rather than a standard
                EAN-13 retail barcode. Assign a proper GTIN from the pool for a true retail barcode.
              </p>
            </div>
          )}

          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-gray-600">Size {usesEan13 ? "(GS1 magnification)" : ""}</label>
              <span className="text-xs font-mono text-gray-500">
                {magnification}%{size ? ` — ${size.widthMm.toFixed(1)} × ${size.heightMm.toFixed(1)} mm` : ""}
              </span>
            </div>
            <input
              type="range" min={MIN_MAG} max={MAX_MAG} step={5}
              value={magnification}
              onChange={e => setMagnification(parseInt(e.target.value))}
              className="w-full accent-bassani-600"
            />
            {usesEan13 && (
              <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                <span>80% (min. scannable)</span>
                <span>100% (industry standard)</span>
                <span>200% (max)</span>
              </div>
            )}
          </div>

          <div className="flex items-center justify-center bg-white border border-gray-200 rounded-xl p-6 mb-4">
            {error ? (
              <p className="text-xs text-red-500">{error}</p>
            ) : (
              <canvas ref={canvasRef} className="max-w-full" />
            )}
          </div>

          <p className="text-[11px] text-gray-400 mb-4 leading-relaxed">
            {usesEan13 &&
              "GS1's retail barcode standard is 37.29 × 25.93mm at 100% magnification, scalable between 80% and 200%. Below 80%, checkout scanners may fail to read it reliably. "}
            <strong>SVG is recommended for packaging artwork</strong> — it's vector, so your printer or
            designer can resize it in their layout without any loss of quality. PNG is provided as a
            high-resolution (300 DPI) fallback for tools that don't accept vector files.
          </p>

          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={downloadPng}>
              <Download size={13} className="mr-1" />PNG
            </BtnSecondary>
            <BtnPrimary onClick={downloadSvg}>
              <Download size={13} className="mr-1" />SVG (recommended)
            </BtnPrimary>
          </div>
        </>
      )}
    </Modal>
  );
}
