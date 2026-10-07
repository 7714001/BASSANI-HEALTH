import React from "react";
import { fmtR } from "./UI";
import { lineDiscount } from "../utils/discountMath";

// Shared discount display pieces (2026-10-07) for the Sales Ticket and the
// Discount Approvals screen. Staff asked to always see the percentage AND
// the Rand amount, plus what the order total becomes, so both screens use
// these rather than each formatting discounts its own way.

const fmtPct = (p) => `${Number(p || 0).toLocaleString("en-ZA", { maximumFractionDigits: 4 })}%`;

// "45.17%" with "R12.36 off each unit" and "R1,544.81 off this line" under it.
export function DiscountAmountCell({ line, pct, tone = "text-green-700", align = "right" }) {
  // A requested removal of a discount already on the quote (2026-10-07).
  if (line?.is_removal && !(Number(pct) > 0)) {
    const cur = Number(line.current_pct) || 0;
    return (
      <div className={align === "right" ? "text-right" : ""}>
        <span className="font-semibold text-red-600">Remove discount</span>
        {cur > 0 && (
          <span className="block text-[10px] text-gray-500 mt-0.5">
            Currently {fmtPct(cur)} ({fmtR(lineDiscount(line, cur).lineOff)} off this line)
          </span>
        )}
      </div>
    );
  }
  if (!(Number(pct) > 0)) return <span className="text-gray-300">—</span>;
  const d = lineDiscount(line, pct);
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <span className={`font-semibold ${tone}`}>{fmtPct(pct)}</span>
      <span className="block text-[10px] text-gray-500 mt-0.5">{fmtR(d.perUnitOff)} off each unit</span>
      <span className="block text-[10px] text-gray-500">{fmtR(d.lineOff)} off this line</span>
    </div>
  );
}

// Side-by-side "now" vs "after" totals. `after` may have tax/total null
// (older requests with no recorded tax rate): those rows then say so
// instead of showing a guess.
export function DiscountTotalsCompare({ now, after, nowLabel = "Current quote", afterLabel = "If approved", note }) {
  const row = (label, a, b, { bold = false, negative = false } = {}) => (
    <tr className={bold ? "border-t border-gray-200" : ""}>
      <td className={`py-1.5 pr-3 text-sm ${bold ? "font-bold text-gray-900" : "text-gray-600"}`}>{label}</td>
      <td className={`py-1.5 px-3 text-right text-sm ${bold ? "font-bold text-gray-900" : "text-gray-600"}`}>
        {a == null ? <span className="text-gray-300">—</span> : `${negative && a > 0 ? "-" : ""}${fmtR(a)}`}
      </td>
      <td className={`py-1.5 pl-3 text-right text-sm ${bold ? "font-bold text-bassani-700" : "text-gray-900 font-medium"}`}>
        {b == null ? <span className="text-gray-400 text-xs font-normal">Not available</span> : `${negative && b > 0 ? "-" : ""}${fmtR(b)}`}
      </td>
    </tr>
  );
  const savesIncl = now?.total != null && after?.total != null ? now.total - after.total : null;
  const savesExcl = now && after ? now.untaxed - after.untaxed : null;
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <table className="w-full">
        <thead>
          <tr>
            <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wide pb-1"></th>
            <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wide pb-1 px-3">{nowLabel}</th>
            <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wide pb-1 pl-3">{afterLabel}</th>
          </tr>
        </thead>
        <tbody>
          {row("Price before discount (excl. VAT)", now?.gross, after?.gross)}
          {row("Discount (excl. VAT)", now?.discount, after?.discount, { negative: true })}
          {row("Subtotal (excl. VAT)", now?.untaxed, after?.untaxed)}
          {row("VAT", now?.tax, after?.tax)}
          {row("Order total (incl. VAT)", now?.total, after?.total, { bold: true })}
        </tbody>
      </table>
      {savesExcl != null && Math.abs(savesExcl) >= 0.005 && (
        <p className="text-xs text-gray-600 mt-2">
          {savesExcl > 0 ? "Customer pays " : "Customer pays an extra "}
          <span className="font-semibold">{fmtR(Math.abs(savesIncl != null ? savesIncl : savesExcl))}</span>
          {savesIncl != null ? " incl. VAT " : " excl. VAT "}
          {savesExcl > 0 ? "less than the current quote." : "compared with the current quote."}
        </p>
      )}
      {after && after.tax == null && (
        <p className="text-[11px] text-gray-400 mt-1">VAT can't be shown for this request: it was raised before VAT rates were recorded on requests.</p>
      )}
      {note && <p className="text-[11px] text-gray-400 mt-1">{note}</p>}
    </div>
  );
}

export const ESTIMATE_NOTE = "Calculated by the portal from the discount percentages. Final figures on the quote can differ by a few cents due to rounding.";
