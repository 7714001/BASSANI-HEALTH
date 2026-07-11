import { useRef, useState, useEffect } from "react";
import { Printer, X, ChevronLeft, Truck } from "lucide-react";
import { fmtDate } from "../components/UI";
import api from "../api";
import bwipjs from "bwip-js";

// ── Static Bassani details (mirrored from Invoices.js) ─────────────────────────
const BASSANI = {
  name:    "Bassani Health (PTY) LTD",
  vat:     "4430323131",
  tagline: "Transforming Lives Through Health",
  bank:    "First National Bank (FNB)",
  account_name:   "Bassani Health",
  account_number: "63137121842",
  branch_code:    "210554",
  payment_terms:  [
    "Payment is due upon collection.",
    "Interest on overdue amounts shall accrue at the prime rate plus 2%.",
    "4 days to collect orders once ready.",
  ],
};

const STATE_LABEL = { draft: "Quotation", sent: "Quotation Sent", sale: "Sales Order", cancel: "Cancelled", done: "Done" };
const STATE_COLOR = {
  draft:  "#b45309",   // amber
  sent:   "#1d4ed8",   // blue
  sale:   "#15803d",   // green
  cancel: "#b91c1c",   // red
  done:   "#6b7280",   // gray
};
const STATE_BG = {
  draft:  "#fffbeb",
  sent:   "#eff6ff",
  sale:   "#f0fdf4",
  cancel: "#fef2f2",
  done:   "#f9fafb",
};

function fmt(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

const PICKING_STATE_COLOR = {
  done:      "bg-green-50 text-green-700",
  assigned:  "bg-blue-50 text-blue-700",
  confirmed: "bg-amber-50 text-amber-700",
  waiting:   "bg-orange-50 text-orange-700",
  cancel:    "bg-gray-100 text-gray-400",
  draft:     "bg-gray-100 text-gray-400",
};

// Renders a Code 128 barcode as a <img data:> so it survives the innerHTML → new window print copy.
// Canvas pixel data is lost when innerHTML is serialised — converting to a PNG data URL preserves it.
function BarcodeImg({ text, style }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!text) return;
    const canvas = document.createElement("canvas");
    try {
      bwipjs.toCanvas(canvas, {
        bcid: "code128", text, scale: 2, height: 12,
        includetext: true, textxalign: "center", padding: 2, backgroundcolor: "ffffff",
      });
      setSrc(canvas.toDataURL("image/png"));
    } catch { /* non-fatal */ }
  }, [text]);
  if (!src) return null;
  return <img src={src} alt={text} style={{ display: "block", maxHeight: 52, ...style }} />;
}

export default function OrderView({ order: o, onClose, onConfirm, onCancel, confirming, cancelling, isAdmin, canConfirmOrder = true, canCancelOrder = true }) {
  const printRef = useRef();
  const [deliveries,        setDeliveries       ] = useState([]);
  const [deliveriesLoading, setDeliveriesLoading] = useState(false);
  const [deliveriesOpen,    setDeliveriesOpen   ] = useState(true);

  useEffect(() => {
    if (!o?.id) return;
    setDeliveriesLoading(true);
    api.get(`/api/orders/${o.id}/deliveries`)
      .then(r => setDeliveries(r.data.deliveries || []))
      .catch(() => {})
      .finally(() => setDeliveriesLoading(false));
  }, [o?.id]);

  const print = () => {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    const win = window.open("", "_blank", "width=900,height=1200");
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${o.name || "Order"}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; color: #111; background: #fff; }
            .page { width: 794px; min-height: 1123px; margin: 0 auto; padding: 48px 48px 40px; display: flex; flex-direction: column; }
            table { width: 100%; border-collapse: collapse; }
            thead th { font-size: 10px; font-weight: 700; text-transform: uppercase; color: #999; letter-spacing: 0.5px; padding: 8px 6px; border-bottom: 2px solid #e5e7eb; text-align: left; }
            thead th.right { text-align: right; }
            tbody td { padding: 9px 6px; border-bottom: 1px solid #f3f4f6; font-size: 11.5px; color: #333; }
            tbody td.right { text-align: right; }
            .totals td { padding: 4px 6px; font-size: 12px; }
            .totals td:last-child { text-align: right; padding-left: 40px; }
            .total-row td { font-weight: 800; font-size: 14px; border-top: 2px solid #111; padding-top: 8px; }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  const p = o.partner_detail || {};
  const addressLines = [
    p.street, p.street2,
    [p.city, p.zip].filter(Boolean).join(", "),
    p.state_id?.[1], p.country_id?.[1],
  ].filter(Boolean);

  const stateLabel = STATE_LABEL[o.state] || o.state;
  const stateColor = STATE_COLOR[o.state] || "#6b7280";
  const stateBg    = STATE_BG[o.state]    || "#f9fafb";

  const canConfirm = isAdmin && canConfirmOrder && o.state === "draft";
  const canCancel  = isAdmin && canCancelOrder  && (o.state === "draft" || o.state === "sent");

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-100 overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <button onClick={onClose}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronLeft size={14} /> Back to Orders
        </button>
        <div className="flex items-center gap-2">
          {canCancel && (
            <button onClick={onCancel} disabled={cancelling}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40">
              {cancelling ? "Cancelling…" : "Cancel Order"}
            </button>
          )}
          {canConfirm && (
            <button onClick={onConfirm} disabled={confirming}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-bassani-600 hover:bg-bassani-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-40">
              {confirming ? "Confirming…" : "Confirm Order"}
            </button>
          )}
          <button onClick={print}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors">
            <Printer size={13} /> Print / Save PDF
          </button>
          <button onClick={onClose}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors">
            <X size={13} /> Close
          </button>
        </div>
      </div>

      {/* Delivery status strip — non-printable */}
      {(deliveriesLoading || deliveries.length > 0) && (
        <div className="bg-slate-50 border-b border-gray-200 px-6 py-3">
          <button
            onClick={() => setDeliveriesOpen(o => !o)}
            className="flex items-center gap-2 text-xs font-semibold text-gray-600 hover:text-gray-900 transition-colors w-full text-left">
            <Truck size={13} className="text-bassani-600" />
            Delivery Status
            {deliveries.length > 0 && (
              <span className="ml-1 text-gray-400 font-normal">({deliveries.length} shipment{deliveries.length !== 1 ? "s" : ""})</span>
            )}
            <span className="ml-auto text-gray-300">{deliveriesOpen ? "▲" : "▼"}</span>
          </button>
          {deliveriesOpen && (
            deliveriesLoading ? (
              <p className="text-xs text-gray-400 mt-2">Loading deliveries…</p>
            ) : (
              <div className="mt-3 space-y-2">
                {deliveries.map(d => (
                  <div key={d.id} className="flex flex-wrap items-start gap-3 bg-white border border-gray-100 rounded-xl px-4 py-3">
                    <div className="flex items-center gap-2 min-w-[140px]">
                      <span className="font-mono text-xs text-bassani-700 font-semibold">{d.name}</span>
                      {d.is_backorder && (
                        <span className="text-[10px] bg-orange-50 text-orange-600 border border-orange-100 px-1.5 py-0.5 rounded-full font-semibold">Backorder</span>
                      )}
                    </div>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${PICKING_STATE_COLOR[d.state] || "bg-gray-100 text-gray-500"}`}>
                      {d.state_label}
                    </span>
                    {d.date_done && (
                      <span className="text-xs text-gray-400">Delivered {fmtDate(d.date_done)}</span>
                    )}
                    {d.scheduled_date && d.state !== "done" && (
                      <span className="text-xs text-gray-400">Expected {fmtDate(d.scheduled_date)}</span>
                    )}
                    {d.tracking_ref && (
                      <span className="text-xs text-gray-500">Tracking: <span className="font-mono">{d.tracking_ref}</span></span>
                    )}
                    {d.lines.length > 0 && (
                      <div className="w-full mt-1 border-t border-gray-50 pt-2 space-y-0.5">
                        {d.lines.map((l, i) => {
                          const pct = l.qty_ordered > 0 ? Math.min(Math.round(l.qty_done / l.qty_ordered * 100), 100) : 0;
                          return (
                            <div key={i} className="flex items-center gap-2 text-xs text-gray-500">
                              <span className="flex-1 truncate">{l.product_name}</span>
                              <span className="shrink-0">
                                {l.qty_done}/{l.qty_ordered} units
                                {l.qty_done < l.qty_ordered && <span className="text-orange-500 ml-1">({l.qty_ordered - l.qty_done} outstanding)</span>}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      )}

      {/* Scrollable order area */}
      <div className="flex-1 overflow-y-auto py-8 px-4">
        <div ref={printRef} className="bg-white shadow-lg mx-auto"
          style={{ width: 794, minHeight: 1123, padding: "48px 48px 40px", fontFamily: "system-ui, sans-serif", fontSize: 12, color: "#111", display: "flex", flexDirection: "column" }}>

          {/* Header */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 36 }}>
            <div>
              <img src="/logo.png" alt="Bassani Health" style={{ height: 40 }}
                onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "block"; }} />
              <div style={{ display: "none", fontSize: 20, fontWeight: 800, color: "#0f6e56", letterSpacing: -0.5 }}>BASSANI HEALTH</div>
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700 }}>{BASSANI.name}</p>
                <p style={{ fontSize: 11, color: "#666" }}>VAT NO: {BASSANI.vat}</p>
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 11, fontStyle: "italic", color: "#0f6e56", marginBottom: 8 }}>
                {BASSANI.tagline}
              </p>
              {o.name && <BarcodeImg text={o.name} style={{ marginLeft: "auto" }} />}
            </div>
          </div>

          {/* Customer address — right-aligned */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 28 }}>
            <div style={{ textAlign: "right", fontSize: 11, lineHeight: 1.6, color: "#444" }}>
              <p style={{ fontWeight: 700, fontSize: 12, color: "#111" }}>{p.name || o.partner_id?.[1]}</p>
              {addressLines.map((l, i) => <p key={i}>{l}</p>)}
              {p.vat && <p style={{ marginTop: 4 }}>VAT NO: {p.vat}</p>}
            </div>
          </div>

          {/* Order title + state */}
          <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 16 }}>
            <h1 style={{ fontSize: 28, fontWeight: 800 }}>Order {o.name}</h1>
            <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 10px", borderRadius: 20, color: stateColor, background: stateBg, border: `1px solid ${stateColor}33` }}>
              {stateLabel}
            </span>
          </div>

          {/* Meta row */}
          <div style={{ display: "grid", gridTemplateColumns: `repeat(${o.reseller_name ? 4 : 3}, 1fr)`, gap: 8, borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", padding: "12px 0", marginBottom: 28 }}>
            {[
              ["Order Date", fmtDate(o.date_order?.split("T")[0])],
              ["Customer",   p.name || o.partner_id?.[1]],
              ["Order Ref",  o.name],
              ...(o.reseller_name ? [["Via Reseller", o.reseller_name]] : []),
            ].map(([label, val]) => (
              <div key={label}>
                <span style={{ display: "block", fontSize: 9, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{val || "—"}</span>
              </div>
            ))}
          </div>

          {/* Line items */}
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
            <thead>
              <tr>
                {["Description", "Quantity", "Unit Price", "Subtotal"].map((h, i) => (
                  <th key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#999", letterSpacing: 0.5, padding: "8px 6px", borderBottom: "2px solid #e5e7eb", textAlign: i > 0 ? "right" : "left" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(o.lines || []).map((line, i) => {
                const pid = line.product_id?.[0];
                const lots = pid && o.lot_map?.[pid] ? o.lot_map[pid] : [];
                return (
                <tr key={i}>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", fontSize: 11.5, color: "#333" }}>
                    {line.product_id?.[1] || line.name}
                    {line.name && line.product_id?.[1] && line.name !== line.product_id[1] && (
                      <span style={{ display: "block", fontSize: 10, color: "#999", marginTop: 1 }}>{line.name}</span>
                    )}
                    {lots.length > 0 && (
                      <span style={{ display: "block", fontSize: 9.5, color: "#6b7280", marginTop: 2, fontFamily: "monospace", letterSpacing: 0.3 }}>
                        Batch: {lots.join(", ")}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5 }}>
                    {line.product_uom_qty?.toFixed ? `${line.product_uom_qty.toFixed(2)} Units` : line.product_uom_qty}
                  </td>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5 }}>{fmt(line.price_unit)}</td>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>R {fmt(line.price_subtotal)}</td>
                </tr>
                );
              })}
            </tbody>
          </table>

          {/* Totals + notes */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 8 }}>
            {/* Notes / payment terms */}
            <div style={{ fontSize: 11, color: "#444", maxWidth: 320 }}>
              {o.note ? (
                <>
                  <p style={{ fontWeight: 700, fontSize: 11, color: "#111", marginBottom: 4 }}>Notes</p>
                  <p style={{ fontSize: 11, color: "#666", lineHeight: 1.6 }}>{o.note.replace(/<[^>]*>/g, "")}</p>
                  <div style={{ marginTop: 12 }}>
                    {BASSANI.payment_terms.map((t, i) => (
                      <p key={i} style={{ fontSize: 10, color: "#aaa", lineHeight: 1.7 }}>{t}</p>
                    ))}
                  </div>
                </>
              ) : (
                <div>
                  {BASSANI.payment_terms.map((t, i) => (
                    <p key={i} style={{ fontSize: 10, color: "#888", lineHeight: 1.7 }}>{t}</p>
                  ))}
                </div>
              )}
            </div>

            {/* Totals */}
            <table style={{ minWidth: 260 }}>
              <tbody>
                <tr>
                  <td style={{ padding: "4px 6px", fontSize: 12, color: "#666" }}>Untaxed Amount</td>
                  <td style={{ padding: "4px 6px", fontSize: 12, textAlign: "right", paddingLeft: 40 }}>R {fmt(o.amount_untaxed)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "4px 6px", fontSize: 12, color: "#666" }}>VAT 15%</td>
                  <td style={{ padding: "4px 6px", fontSize: 12, textAlign: "right", paddingLeft: 40 }}>R {fmt(o.amount_tax)}</td>
                </tr>
                <tr>
                  <td style={{ padding: "8px 6px 4px", fontSize: 14, fontWeight: 800, borderTop: "2px solid #111" }}>Total</td>
                  <td style={{ padding: "8px 6px 4px", fontSize: 14, fontWeight: 800, textAlign: "right", paddingLeft: 40, borderTop: "2px solid #111" }}>R {fmt(o.amount_total)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer */}
          <div style={{ marginTop: "auto", paddingTop: 24, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>
              {BASSANI.payment_terms.map((t, i) => (
                <p key={i} style={{ fontSize: 10, color: "#888", lineHeight: 1.7 }}>{t}</p>
              ))}
            </div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#444" }}>Bank Name: {BASSANI.bank}</p>
              <p style={{ fontSize: 10, color: "#888" }}>Account Name: {BASSANI.account_name}</p>
              <p style={{ fontSize: 10, color: "#888" }}>Account Number: {BASSANI.account_number} &nbsp; Branch Code: {BASSANI.branch_code}</p>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}
