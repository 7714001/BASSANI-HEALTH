// Stock status (2026-10-14) — the single place the portal decides what a
// product's stock figures mean, so the quote builder's search, the Browse
// Products drawer and the reseller/customer cart can never disagree.
//
//   Available now = Odoo free_qty: on the shelf and not already reserved for
//                   another order (raw On Hand can be fully promised already).
//   Forecast      = Odoo virtual_available: on hand + incoming − already
//                   promised to other orders.
//   Incoming      = Forecast − Available now: what's on its way that a new
//                   order can still count on. Smaller than Odoo's raw incoming
//                   figure when part of the incoming stock is already promised.
//
// Tiers: in_stock (something available now), reserved (on hand but all of it
// promised, more expected), incoming (nothing on hand, stock on its way),
// out (nothing available or coming).

const n = (v) => Math.floor(Number(v) || 0);

export function stockInfo(p) {
  const onHand    = Math.max(0, n(p?.qty_available));
  const available = Math.max(0, n(p?.free_qty ?? p?.qty_available));
  const forecast  = n(p?.virtual_available);
  const incoming  = Math.max(0, forecast - available);
  let tier;
  if (available > 0) tier = "in_stock";
  else if (forecast > 0) tier = onHand > 0 ? "reserved" : "incoming";
  else tier = "out";
  return { onHand, available, forecast, incoming, tier };
}

/** Fields a quote/cart line keeps so its note can be worked out later. */
export function lineStockFields(p) {
  const s = stockInfo(p);
  return { _stock: s.available, _forecast: Math.max(0, s.forecast), _on_hand: s.onHand };
}

/** Sort key: available now first, then stock on its way, then out of stock. */
export const stockRank = (p) => ({ in_stock: 0, reserved: 1, incoming: 1, out: 2 })[stockInfo(p).tier];

/**
 * What happens to a quantity on a line, given what's available now and the
 * forecast. Returns null when everything ships now.
 * { tone: "amber"|"red", short, full, fromIncoming, backorder }
 */
export function lineStockNote(qty, available, forecast) {
  qty = Number(qty) || 0;
  available = Math.max(0, Number(available) || 0);
  forecast = Math.max(0, Number(forecast) || 0);
  if (!qty || qty <= available) return null;
  const fromIncoming = Math.min(qty - available, Math.max(0, forecast - available));
  const backorder = qty - available - fromIncoming;
  const shortParts = [], fullParts = [];
  if (available > 0) { shortParts.push(`${available} now`); fullParts.push(`${available} ship now`); }
  if (fromIncoming > 0) { shortParts.push(`${fromIncoming} incoming`); fullParts.push(`${fromIncoming} from incoming stock, which may delay the order`); }
  if (backorder > 0) { shortParts.push(`${backorder} backorder`); fullParts.push(`${backorder} on backorder with nothing incoming yet`); }
  return {
    tone: backorder > 0 ? "red" : "amber",
    short: shortParts.join(" · "),
    full: fullParts.join("; ") + ".",
    fromIncoming, backorder,
  };
}

/** Customer/reseller wording: never numbers (stock figures stay internal). */
export const CUSTOMER_AVAILABILITY = {
  in_stock: { label: "In stock",       cls: "bg-green-50 text-green-700" },
  soon:     { label: "Available soon", cls: "bg-amber-50 text-amber-700" },
  out:      { label: "Out of stock",   cls: "bg-red-50 text-red-600" },
};
export function customerAvailability(p) {
  const t = stockInfo(p).tier;
  return t === "in_stock" ? "in_stock" : t === "out" ? "out" : "soon";
}
