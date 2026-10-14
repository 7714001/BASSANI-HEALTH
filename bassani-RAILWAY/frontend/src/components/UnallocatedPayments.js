// 8.72 — Deposit and payment integrity, shared UI. Odoo is the source of
// truth: when a customer already has a payment on their account that isn't
// allocated to anything, every payment window offers to apply it instead of
// recording the same money again (backend: deposit_integrity.py). A new
// payment can still be recorded, but only after confirming it's a separate
// payment that genuinely arrived.
import { AlertTriangle, Loader2, RotateCcw, FileText } from "lucide-react";
import { fmtR, fmtDate } from "./UI";

/** True when an API error is the backend's "unallocated payments exist" 409. */
export const isUnallocatedError = (e) =>
  e?.response?.status === 409 && e.response.data?.detail?.code === "unallocated_payments";

/** A readable message from any API error, whether detail is a string or a
 * structured {message} object (the 8.72 409s). */
export const errorText = (e, fallback) => {
  const d = e?.response?.data?.detail;
  if (typeof d === "string") return d;
  return d?.message || fallback;
};

/**
 * The list of unallocated payments/credits, each with an Apply button, and
 * the confirmation needed to record a new payment anyway.
 * credits: [{line_id, reference, memo?, amount, date, kind?|is_payment?}]
 */
export function UnallocatedPaymentsPanel({ credits, onApply, applyingId, confirmNew, onConfirmNew, applyLabel = "Apply", busy }) {
  if (!credits?.length) return null;
  const total = credits.reduce((s, c) => s + Number(c.amount || 0), 0);
  return (
    <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-3 text-xs text-amber-900">
      <p className="flex items-center gap-1.5 font-semibold text-sm">
        <AlertTriangle size={14} />Already on the customer's account: {fmtR(total)} not allocated
      </p>
      <p className="mt-1 text-amber-800">
        If the money for this is one of these, apply it rather than recording a new payment, so it isn't recorded twice.
      </p>
      <div className="mt-2 divide-y divide-amber-100 rounded-lg border border-amber-100 bg-white">
        {credits.map(c => (
          <div key={c.line_id} className="flex items-center justify-between gap-2 px-2.5 py-2">
            <div className="min-w-0">
              <p className="font-medium text-gray-900 truncate">
                {fmtR(c.amount)} · {c.reference || "Payment"}
              </p>
              <p className="text-[10px] text-gray-500 truncate">
                {(c.kind === "credit" || c.is_payment === false) ? "Credit note" : "Payment"}
                {c.date ? ` received ${fmtDate(c.date)}` : ""}
                {c.memo ? ` · ref ${c.memo}` : ""}
              </p>
            </div>
            {onApply && (
              <button type="button" onClick={() => onApply(c)} disabled={busy || applyingId != null}
                className="shrink-0 inline-flex items-center gap-1 px-2 py-1 text-[11px] font-semibold rounded-md border bg-amber-100 text-amber-900 border-amber-300 hover:bg-amber-200 disabled:opacity-50">
                {applyingId === c.line_id && <Loader2 size={11} className="animate-spin" />}{applyLabel}
              </button>
            )}
          </div>
        ))}
      </div>
      {onConfirmNew && (
        <label className="mt-2 flex items-start gap-2 cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={!!confirmNew} onChange={e => onConfirmNew(e.target.checked)} />
          <span>None of these: this is a separate payment that has just arrived, so record it as a new payment.</span>
        </label>
      )}
    </div>
  );
}

/** Banner for a ticket whose deposit invoice was cancelled in Odoo. */
export function DepositIssueBanner({ issue, canRestore, onRestore, restoring }) {
  if (!issue) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
      <p className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle size={14} />Deposit invoice cancelled in Odoo
      </p>
      <p className="mt-1 text-xs">{issue.message}</p>
      {issue.stranded?.length > 0 && (
        <p className="mt-1 text-xs">
          Unallocated deposit payment: {issue.stranded.map(s => `${s.reference} (${fmtR(s.amount)})`).join(", ")}.
        </p>
      )}
      {issue.restorable && canRestore && (
        <button type="button" onClick={onRestore} disabled={restoring}
          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-50">
          {restoring ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
          Restore Deposit Invoice
        </button>
      )}
      {issue.restorable && !canRestore && (
        <p className="mt-1 text-xs font-medium">Ask Finance to restore the deposit invoice before this order is marked complete.</p>
      )}
    </div>
  );
}

/** On a deposit (down payment) invoice: the order it's a deposit for.
 * staff=false gives the customer/reseller wording (no internal warning). */
export function DepositForOrderPanel({ deposit, staff = true, className = "" }) {
  if (!deposit) return null;
  return (
    <div className={`rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-900 ${className}`}>
      <p className="flex items-center gap-1.5 font-semibold text-sm">
        <FileText size={14} />Deposit for order {deposit.order_name}
        {deposit.deposit_pct != null ? ` (${deposit.deposit_pct}% of ${fmtR(deposit.order_total)})` : ""}
      </p>
      {staff ? (
        <p className="mt-1 text-blue-800">
          This invoice records the deposit received. It only shows a "Down Payment" line because products are invoiced
          when they're delivered. The final invoice, raised when the order is ready for collection, lists every item and
          deducts this deposit. Please don't cancel it: that unlinks the payment and the final invoice would charge the
          full amount.
        </p>
      ) : (
        <p className="mt-1 text-blue-800">
          This invoice records the deposit we received for your order. Your final invoice, sent when your order is ready
          for collection, lists every item and deducts this deposit.
        </p>
      )}
      {deposit.lines?.length > 0 && (
        <table className="mt-2 w-full bg-white rounded-lg border border-blue-100">
          <thead>
            <tr className="text-[10px] uppercase text-gray-400">
              <th className="text-left px-2 py-1 font-semibold">Item on the order</th>
              <th className="text-right px-2 py-1 font-semibold">Qty</th>
              <th className="text-right px-2 py-1 font-semibold">Subtotal (excl. VAT)</th>
            </tr>
          </thead>
          <tbody>
            {deposit.lines.map((l, i) => (
              <tr key={i} className="border-t border-blue-50 text-gray-700">
                <td className="px-2 py-1">{l.name}</td>
                <td className="px-2 py-1 text-right">{l.qty}</td>
                <td className="px-2 py-1 text-right">{fmtR(l.subtotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
