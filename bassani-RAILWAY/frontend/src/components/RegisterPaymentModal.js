// Register Payment (7.17) — shared by Invoices.js and the invoice detail
// modal on the customer profile, so both register payments exactly the same
// way. "Mark as paid" in this portal always means registering a real payment:
// Odoo sets the invoice to Paid itself once the payment is matched to it.
// Payment methods are limited to the invoice's own company (?invoice_id=).
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api from "../api";
import { Modal, FormGroup, Input, Select, BtnPrimary, BtnSecondary, fmtR } from "./UI";

export default function RegisterPaymentModal({ invoice, onClose, onPaid }) {
  const [journals, setJournals] = useState([]);
  const [loadingJournals, setLoadingJournals] = useState(true);
  const [form, setForm] = useState({
    amount: String(invoice.amount_residual || invoice.amount_total || ""),
    date: new Date().toISOString().split("T")[0],
    journal_id: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get("/api/invoices/payment-journals", { params: { invoice_id: invoice.id } })
      .then(r => {
        if (cancelled) return;
        const js = r.data.journals || [];
        setJournals(js);
        if (js.length > 0) setForm(f => ({ ...f, journal_id: String(js[0].id) }));
      })
      .catch(() => { if (!cancelled) setJournals([]); })
      .finally(() => { if (!cancelled) setLoadingJournals(false); });
    return () => { cancelled = true; };
  }, [invoice.id]);

  const outstanding = Number(invoice.amount_residual || 0);
  const amount = Number(form.amount || 0);

  const submit = async () => {
    if (!form.journal_id) return toast.error("Select a payment method");
    if (!amount || amount <= 0) return toast.error("Enter a valid amount");
    setSaving(true);
    try {
      await api.put(`/api/invoices/${invoice.id}/pay`, {
        journal_id: parseInt(form.journal_id),
        payment_date: form.date || undefined,
        amount,
      });
      toast.success(`Payment registered against ${invoice.name}`);
      onPaid?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Payment registration failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Register Payment — ${invoice.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 gap-2 text-sm">
          <span className="text-gray-500">Customer</span>
          <span className="font-medium text-right">{invoice.partner_id?.[1]}</span>
          <span className="text-gray-500">Outstanding</span>
          <span className="font-semibold text-right text-red-600">{fmtR(outstanding)}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <FormGroup label="Amount" required>
            <Input type="number" step="0.01" min="0.01" value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} />
          </FormGroup>
          <FormGroup label="Payment date">
            <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </FormGroup>
        </div>
        {amount > 0 && outstanding > 0 && amount < outstanding - 0.005 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            This is a part payment. {fmtR(outstanding - amount)} will still be outstanding and the invoice will show as Partial.
          </p>
        )}
        {amount > outstanding + 0.005 && outstanding > 0 && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            This is more than is outstanding. The extra {fmtR(amount - outstanding)} will sit on the customer's account as an unallocated credit.
          </p>
        )}
        <FormGroup label="Payment method" required>
          <Select value={form.journal_id} onChange={e => setForm(f => ({ ...f, journal_id: e.target.value }))} disabled={loadingJournals}>
            <option value="">{loadingJournals ? "Loading payment methods…" : "Select payment method…"}</option>
            {journals.map(j => <option key={j.id} value={j.id}>{j.display_label || j.name}</option>)}
          </Select>
        </FormGroup>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={submit} loading={saving} disabled={loadingJournals}>Register Payment</BtnPrimary>
      </div>
    </Modal>
  );
}
