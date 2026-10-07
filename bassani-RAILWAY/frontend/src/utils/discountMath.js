// Discount figures shared by the Sales Ticket and Discount Approvals screens
// (2026-10-07), so the two can never show different numbers for the same
// request.
//
// Odoo stores only a percentage per order line, to a fixed number of
// decimals (the "Discount" decimal accuracy setting, read live via
// GET /api/discount-requests/precision). Every Rand figure here is derived
// from the % as Odoo will actually store it, never from an unrounded figure,
// so what staff see is exactly what the customer is charged.

const r2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// A request line is "in the request" if it asks for a discount OR asks for
// an existing discount to be removed (is_removal, set server-side when a
// line already discounted on the quote is cleared to 0).
export const isInRequest = (l) => (Number(l?.requested_pct) || 0) > 0 || !!l?.is_removal;

export const roundPct = (pct, digits = 2) => {
  const n = Number(pct);
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
};

// One line's discount in Rand. `perUnitOff` is what the Rand entry in the
// Request Discount modal means: the amount off each single unit.
export function lineDiscount({ qty, unit_price }, pct) {
  const p = Number(pct) || 0;
  const gross = (Number(qty) || 0) * (Number(unit_price) || 0);
  const perUnitOff = (Number(unit_price) || 0) * p / 100;
  const lineOff = gross * p / 100;
  return { gross, perUnitOff, lineOff, net: r2(gross - lineOff) };
}

// Excl. VAT / VAT / incl. VAT totals for a set of lines at pctOf(line).
// VAT is rounded on the total, matching Odoo's own totals on Bassani's
// orders. `tax` and `total` are null when any line has no known tax_rate
// (requests raised before 2026-10-07 didn't record one), so nothing pretends
// to know an incl. VAT figure it doesn't.
export function orderTotals(lines, pctOf) {
  let gross = 0, untaxed = 0, tax = 0;
  let taxKnown = lines.length > 0;
  for (const l of lines) {
    const d = lineDiscount(l, pctOf(l));
    gross += d.gross;
    untaxed += d.net;
    if (l.tax_rate == null) taxKnown = false;
    else tax += d.net * l.tax_rate / 100;
  }
  gross = r2(gross);
  untaxed = r2(untaxed);
  const vat = taxKnown ? r2(tax) : null;
  return {
    gross,
    discount: r2(gross - untaxed),
    untaxed,
    tax: vat,
    total: vat == null ? null : r2(untaxed + vat),
  };
}

// The quote exactly as Odoo has it now, from a live order (GET /api/orders/{id}).
export function liveOrderTotals(order) {
  const gross = r2((order?.lines || []).reduce((s, l) => s + l.product_uom_qty * l.price_unit, 0));
  const untaxed = r2(order?.amount_untaxed || 0);
  return { gross, discount: r2(gross - untaxed), untaxed, tax: r2(order?.amount_tax || 0), total: r2(order?.amount_total || 0) };
}

// Tax rate of a live Odoo order line, from Odoo's own computed tax. Rounded
// to 2 decimals because price_tax is itself already rounded (15% can read
// back as 14.9996%). Falls back to the order-wide rate for a line with a
// zero subtotal (e.g. already 100% off).
export function liveLineTaxRate(line, order) {
  if (line?.price_subtotal) return Math.round((line.price_tax || 0) / line.price_subtotal * 10000) / 100;
  if (order?.amount_untaxed) return Math.round((order.amount_tax || 0) / order.amount_untaxed * 10000) / 100;
  return null;
}
