// Stock badges (2026-10-14) — staff see Available now vs Incoming in colour,
// with the expected arrival dates one click away; resellers/customers see
// only In stock / Available soon / Out of stock (no figures). Logic lives in
// utils/stockStatus.js.
import { useState, useEffect } from "react";
import { Clock, Loader2 } from "lucide-react";
import api from "../api";
import { fmtDate } from "./UI";
import { stockInfo, CUSTOMER_AVAILABILITY, customerAvailability } from "../utils/stockStatus";

const TIER_STYLE = {
  in_stock: "bg-green-50 text-green-700 border-green-200",
  reserved: "bg-amber-50 text-amber-800 border-amber-200",
  incoming: "bg-amber-50 text-amber-800 border-amber-200",
  out:      "bg-red-50 text-red-600 border-red-200",
};

const EXPLAIN =
  "Available now: on the shelf and not already reserved for another order. " +
  "Incoming: on its way (purchase orders, transfers from GMP, production) and not yet promised to another order. " +
  "An order needing incoming stock ships when it arrives.";

/** Staff badge. `product` is an /api/products row, or {qty_available, free_qty, virtual_available}. */
export function StockBadge({ product, className = "" }) {
  const s = stockInfo(product);
  let text;
  if (s.tier === "in_stock") text = `${s.available} available${s.incoming > 0 ? ` · +${s.incoming} incoming` : ""}`;
  else if (s.tier === "reserved") text = `${s.onHand} on hand, all reserved · ${s.incoming} incoming`;
  else if (s.tier === "incoming") text = `0 available · ${s.incoming} incoming`;
  else text = "Out of stock";
  return (
    <span title={EXPLAIN}
      className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border whitespace-nowrap ${TIER_STYLE[s.tier]} ${className}`}>
      {(s.tier === "incoming" || s.tier === "reserved") && <Clock size={9} />}
      {text}
    </span>
  );
}

// Expected dates are cached per product for 5 minutes, so re-rendering a line
// or reopening the drawer doesn't refetch, but a receipt arriving shows up.
const _datesCache = new Map();
const CACHE_MS = 5 * 60 * 1000;
const cached = (id) => {
  const c = _datesCache.get(id);
  return c && Date.now() - c.at < CACHE_MS ? c.data : null;
};

/** When incoming stock is expected (GET /api/products/{id}/incoming-stock). */
export function IncomingDates({ productId, className = "" }) {
  const [data, setData] = useState(cached(productId));
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!productId || cached(productId)) return;
    let cancelled = false;
    api.get(`/api/products/${productId}/incoming-stock`)
      .then(r => { _datesCache.set(productId, { at: Date.now(), data: r.data }); if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, [productId]);
  if (failed) return null;
  if (!data) return <span className={`inline-flex items-center gap-1 text-[10px] text-gray-400 ${className}`}><Loader2 size={9} className="animate-spin" />Checking expected dates…</span>;
  if (!data.moves?.length) return <span className={`text-[10px] text-gray-500 ${className}`}>No expected date in Odoo yet</span>;
  return (
    <div className={`text-[10px] leading-snug text-gray-600 ${className}`}>
      {data.moves.slice(0, 3).map((m, i) => (
        <p key={i}>
          <span className="font-semibold">{m.qty}</span> expected {m.date ? fmtDate(m.date) : "(no date)"}
          {m.overdue && <span className="text-red-600 font-semibold"> (overdue)</span>}
          <span className="text-gray-400"> · {m.source}{m.reference ? `, ${m.reference}` : ""}</span>
        </p>
      ))}
      {data.moves.length > 3 && <p className="text-gray-400">+{data.moves.length - 3} more</p>}
    </div>
  );
}

/** Reseller/customer badge — never shows a number. */
export function CustomerStockBadge({ product, className = "" }) {
  const a = CUSTOMER_AVAILABILITY[customerAvailability(product)];
  return (
    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${a.cls} ${className}`}
      title={customerAvailability(product) === "soon" ? "More stock is on its way. Order now and we'll ship it as soon as it arrives." : undefined}>
      {a.label}
    </span>
  );
}
