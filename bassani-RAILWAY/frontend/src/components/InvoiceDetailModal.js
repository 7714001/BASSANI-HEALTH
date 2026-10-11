// Invoice detail + finance actions (7.17), opened by clicking an invoice or
// credit note number on the customer profile (Account Statement and
// Outstanding Invoices) so Finance can act without leaving the page.
//
// Actions mirror the Invoices page row actions and their permission gates:
//   Register Payment / Allocate credit — invoices.record_payment
//   Send / Credit Note                 — tickets.finance_confirm
//   Reset to Draft                     — tickets.finance_confirm + admin, unpaid only
// There is deliberately no "set status to Paid" toggle: Paid is Odoo's own
// result of a payment being matched to the invoice (Architecture Principle 1).
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { CreditCard, Send, FileX, RotateCcw, FileText, ExternalLink, Link2, Loader2 } from "lucide-react";
import api from "../api";
import { useAuth } from "../AuthContext";
import { Modal, BtnPrimary, BtnSecondary, BtnDanger, OdooPdfViewerModal, fmtR, fmtDate } from "./UI";
import RegisterPaymentModal from "./RegisterPaymentModal";
import CreditNoteModal from "./CreditNoteModal";
import SendRecipientsModal from "./SendRecipientsModal";

const PAYMENT_LABEL = { not_paid: "Unpaid", partial: "Partially paid", in_payment: "In payment", paid: "Paid", reversed: "Reversed" };
const PAYMENT_STYLE = {
  not_paid: "bg-red-50 text-red-700 border-red-100",
  partial: "bg-amber-50 text-amber-700 border-amber-100",
  in_payment: "bg-blue-50 text-blue-700 border-blue-100",
  paid: "bg-green-50 text-green-700 border-green-100",
  reversed: "bg-gray-100 text-gray-500 border-gray-200",
};

function ActionButton({ icon: Icon, children, onClick, tone = "gray", disabled }) {
  const tones = {
    gray: "border-gray-200 text-gray-700 hover:bg-gray-50",
    green: "border-green-200 text-green-700 hover:bg-green-50",
    blue: "border-blue-200 text-blue-700 hover:bg-blue-50",
    purple: "border-purple-200 text-purple-700 hover:bg-purple-50",
    amber: "border-amber-200 text-amber-700 hover:bg-amber-50",
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border bg-white transition-colors disabled:opacity-50 ${tones[tone]}`}>
      <Icon size={13} />{children}
    </button>
  );
}

export default function InvoiceDetailModal({ invoiceId, onClose, onChanged }) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const canFinance = can("tickets.finance_confirm");
  const canRecordPayment = can("invoices.record_payment");
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  const [inv, setInv] = useState(null);
  const [loading, setLoading] = useState(true);
  const [credits, setCredits] = useState([]);
  const [allocatingId, setAllocatingId] = useState(null);
  const [allocateConfirm, setAllocateConfirm] = useState(null);
  const [payOpen, setPayOpen] = useState(false);
  const [cnOpen, setCnOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const [resetConfirm, setResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/invoices/${invoiceId}`);
      setInv(r.data);
      if (r.data.state === "posted" && r.data.move_type === "out_invoice" && r.data.amount_residual > 0) {
        api.get(`/api/invoices/${invoiceId}/outstanding-credits`)
          .then(c => setCredits(c.data.credits || []))
          .catch(() => setCredits([]));
      } else {
        setCredits([]);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load invoice");
      onClose();
    } finally {
      setLoading(false);
    }
  }, [invoiceId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  const changed = () => { load(); onChanged?.(); };

  const doAllocate = async () => {
    const c = allocateConfirm;
    setAllocateConfirm(null);
    setAllocatingId(c.line_id);
    try {
      await api.post(`/api/invoices/${invoiceId}/allocate-credit`, { line_id: c.line_id });
      toast.success(`${c.reference} applied to ${inv.name}`);
      changed();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not apply the credit");
    } finally {
      setAllocatingId(null);
    }
  };

  const doSend = async (recipients) => {
    try {
      await api.post(`/api/invoices/${invoiceId}/send`, { recipients });
      toast.success(`Invoice ${inv.name} sent`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send invoice");
      throw e;
    }
  };

  const doReset = async () => {
    setResetting(true);
    try {
      await api.post(`/api/invoices/${invoiceId}/reset-to-draft`);
      toast.success(`${inv.name} reset to draft`);
      setResetConfirm(false);
      changed();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const isCN = inv?.move_type === "out_refund";
  const isPosted = inv?.state === "posted";
  const isOutInv = inv?.move_type === "out_invoice";
  const unpaid = ["not_paid", "partial"].includes(inv?.payment_state);
  const docLabel = isCN ? "Credit Note" : "Invoice";
  const partnerId = Array.isArray(inv?.partner_id) ? inv.partner_id[0] : null;

  return (
    <>
      <Modal title={inv ? `${docLabel} ${inv.name || "(draft)"}` : "Invoice"} onClose={onClose} width="max-w-3xl">
        {loading || !inv ? (
          <div className="py-10 flex items-center justify-center text-sm text-gray-400 gap-2">
            <Loader2 size={15} className="animate-spin" />Loading…
          </div>
        ) : (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-gray-800">{inv.partner_id?.[1]}</p>
                <p className="text-xs text-gray-400">{inv.company_id?.[1]}</p>
                {inv.invoice_origin && <p className="text-xs text-gray-500 mt-0.5">Order {inv.invoice_origin}</p>}
              </div>
              <div className="flex items-center gap-2">
                {inv.state !== "posted" && (
                  <span className="text-[11px] px-2 py-0.5 rounded-full border bg-gray-100 text-gray-600 border-gray-200 font-semibold capitalize">{inv.state}</span>
                )}
                {isPosted && (
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border font-semibold ${PAYMENT_STYLE[inv.payment_state] || "bg-gray-100 text-gray-500 border-gray-200"}`}>
                    {PAYMENT_LABEL[inv.payment_state] || inv.payment_state}
                  </span>
                )}
              </div>
            </div>

            {/* Key figures */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {[
                ["Date", fmtDate(inv.invoice_date)],
                ["Due", inv.invoice_date_due ? fmtDate(inv.invoice_date_due) : "—"],
                ["Total", fmtR(inv.amount_total)],
                ["Outstanding", fmtR(inv.amount_residual)],
              ].map(([label, value]) => (
                <div key={label} className="bg-gray-50 rounded-lg px-3 py-2">
                  <p className="text-[11px] text-gray-400">{label}</p>
                  <p className={`text-sm font-semibold ${label === "Outstanding" && inv.amount_residual > 0 ? "text-red-600" : "text-gray-800"}`}>{value}</p>
                </div>
              ))}
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2">
              <ActionButton icon={FileText} onClick={() => setPdfOpen(true)}>View PDF</ActionButton>
              {isPosted && isOutInv && unpaid && canRecordPayment && (
                <ActionButton icon={CreditCard} tone="green" onClick={() => setPayOpen(true)}>Register Payment</ActionButton>
              )}
              {isPosted && isOutInv && canFinance && (
                <ActionButton icon={Send} tone="blue" onClick={() => setSendOpen(true)}>Send</ActionButton>
              )}
              {isPosted && isOutInv && canFinance && (
                <ActionButton icon={FileX} tone="purple" onClick={() => setCnOpen(true)}>Credit Note</ActionButton>
              )}
              {isPosted && isOutInv && inv.payment_state === "not_paid" && canFinance && isAdmin && (
                <ActionButton icon={RotateCcw} tone="amber" onClick={() => setResetConfirm(true)}>Reset to Draft</ActionButton>
              )}
              <ActionButton icon={ExternalLink} onClick={() => navigate("/invoices", { state: { openInvoiceId: inv.id, filter: "all" } })}>
                Open in Invoices
              </ActionButton>
            </div>
            {isPosted && isOutInv && unpaid && (
              <p className="text-[11px] text-gray-400 -mt-2">
                To mark this invoice paid, register the payment received. It changes to Paid automatically once the full amount is matched.
              </p>
            )}

            {/* Unallocated payments/credits that could settle it */}
            {credits.length > 0 && (
              <div className="border border-amber-200 bg-amber-50 rounded-xl p-3">
                <p className="text-sm font-semibold text-amber-800 mb-0.5">Unallocated payments and credits on this account</p>
                <p className="text-xs text-amber-700 mb-2">
                  The customer has money on account that is not yet matched to an invoice. Apply it here instead of registering a new payment.
                </p>
                <div className="space-y-1">
                  {credits.map(c => (
                    <div key={c.line_id} className="flex items-center justify-between gap-2 bg-white rounded-lg px-3 py-1.5 border border-amber-100">
                      <div className="min-w-0">
                        <p className="text-xs font-medium text-gray-800 truncate">{c.is_payment ? "Payment" : "Credit note"} {c.reference}</p>
                        <p className="text-[11px] text-gray-400">{fmtDate(c.date)}</p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-sm font-semibold text-gray-800">{fmtR(c.amount)}</span>
                        {canRecordPayment && (
                          <button type="button" onClick={() => setAllocateConfirm(c)} disabled={allocatingId !== null}
                            className="inline-flex items-center gap-1 text-xs font-medium text-bassani-700 border border-bassani-200 rounded-lg px-2 py-1 hover:bg-bassani-50 disabled:opacity-50">
                            {allocatingId === c.line_id ? <Loader2 size={12} className="animate-spin" /> : <Link2 size={12} />}Apply
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Lines */}
            {inv.lines?.length > 0 && (
              <div className="overflow-x-auto border border-gray-100 rounded-xl">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500">
                      <th className="text-left px-3 py-2 font-medium">Item</th>
                      <th className="text-right px-3 py-2 font-medium">Qty</th>
                      <th className="text-right px-3 py-2 font-medium">Unit price</th>
                      <th className="text-right px-3 py-2 font-medium">Disc.</th>
                      <th className="text-right px-3 py-2 font-medium">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inv.lines.map(l => (
                      <tr key={l.id} className="border-t border-gray-50">
                        <td className="px-3 py-2 text-gray-700">{l.product_id?.[1] || l.name}</td>
                        <td className="px-3 py-2 text-right">{l.quantity}</td>
                        <td className="px-3 py-2 text-right">{fmtR(l.price_unit)}</td>
                        <td className="px-3 py-2 text-right text-gray-500">{l.discount ? `${l.discount}%` : ""}</td>
                        <td className="px-3 py-2 text-right font-medium">{fmtR(l.price_subtotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="text-xs">
                    <tr className="border-t border-gray-100"><td colSpan={4} className="px-3 py-1.5 text-right text-gray-500">Subtotal (excl. VAT)</td><td className="px-3 py-1.5 text-right">{fmtR(inv.amount_untaxed)}</td></tr>
                    <tr><td colSpan={4} className="px-3 py-1.5 text-right text-gray-500">VAT</td><td className="px-3 py-1.5 text-right">{fmtR(inv.amount_tax)}</td></tr>
                    <tr><td colSpan={4} className="px-3 py-1.5 text-right font-semibold text-gray-700">Total</td><td className="px-3 py-1.5 text-right font-semibold">{fmtR(inv.amount_total)}</td></tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}
        <div className="flex justify-end mt-4">
          <BtnSecondary onClick={onClose}>Close</BtnSecondary>
        </div>
      </Modal>

      {pdfOpen && inv && (
        <OdooPdfViewerModal url={`/api/invoices/${inv.id}/pdf`} title={`${docLabel} ${inv.name || ""}`} onClose={() => setPdfOpen(false)} />
      )}
      {payOpen && inv && <RegisterPaymentModal invoice={inv} onClose={() => setPayOpen(false)} onPaid={changed} />}
      {cnOpen && inv && <CreditNoteModal invoice={inv} onClose={() => setCnOpen(false)} onCreated={changed} />}
      {sendOpen && inv && (
        <SendRecipientsModal partnerId={partnerId} title={`Send Invoice — ${inv.name}`} onClose={() => setSendOpen(false)} onSend={doSend} />
      )}
      {allocateConfirm && inv && (
        <Modal title="Apply credit to invoice" onClose={() => setAllocateConfirm(null)}>
          <p className="text-sm text-gray-600">
            Apply {allocateConfirm.is_payment ? "payment" : "credit note"} <strong>{allocateConfirm.reference}</strong> ({fmtR(allocateConfirm.amount)}) to <strong>{inv.name}</strong>?
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Up to {fmtR(Math.min(allocateConfirm.amount, inv.amount_residual))} will be matched. Any remainder stays on the customer's account to use later.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setAllocateConfirm(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doAllocate}>Apply</BtnPrimary>
          </div>
        </Modal>
      )}
      {resetConfirm && inv && (
        <Modal title="Reset Invoice to Draft" onClose={() => setResetConfirm(false)}>
          <p className="text-sm text-gray-600 mb-1">Reset <strong>{inv.name}</strong> to draft?</p>
          <p className="text-sm text-gray-500 mb-4">
            The invoice will become editable again. This cannot be done if any payment has been registered against it.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setResetConfirm(false)} disabled={resetting}>Cancel</BtnSecondary>
            <BtnDanger onClick={doReset} loading={resetting}>Reset to Draft</BtnDanger>
          </div>
        </Modal>
      )}
    </>
  );
}
