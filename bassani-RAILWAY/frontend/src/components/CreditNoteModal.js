// Raise Credit Note (7.17) — shared by Invoices.js and the invoice detail
// modal on the customer profile. Journals are limited to the invoice's own
// company (?invoice_id=).
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import api from "../api";
import { Modal, FormGroup, Input, Select, Textarea, BtnPrimary, BtnSecondary, fmtR } from "./UI";

export default function CreditNoteModal({ invoice, onClose, onCreated }) {
  const [journals, setJournals] = useState([]);
  const [form, setForm] = useState({ reason: "", date: new Date().toISOString().split("T")[0], journal_id: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api.get("/api/invoices/credit-note-journals", { params: { invoice_id: invoice.id } })
      .then(r => { if (!cancelled) setJournals(r.data.journals || []); })
      .catch(() => { if (!cancelled) setJournals([]); });
    return () => { cancelled = true; };
  }, [invoice.id]);

  const submit = async () => {
    if (!form.reason.trim()) return toast.error("Reason is required");
    setSaving(true);
    try {
      const r = await api.post(`/api/invoices/${invoice.id}/credit-note`, {
        reason: form.reason,
        date: form.date || undefined,
        journal_id: form.journal_id ? parseInt(form.journal_id) : undefined,
      });
      toast.success(`Credit note ${r.data.credit_note_name} created`);
      onCreated?.(r.data);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create credit note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title={`Raise Credit Note — ${invoice.name}`} onClose={onClose}>
      <div className="space-y-3">
        <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 gap-2 text-sm">
          <span className="text-gray-500">Customer</span>
          <span className="font-medium text-right">{invoice.partner_id?.[1]}</span>
          <span className="text-gray-500">Invoice Total</span>
          <span className="font-semibold text-right">{fmtR(invoice.amount_total)}</span>
        </div>
        <FormGroup label="Reason" required>
          <Textarea rows={3} placeholder="Damaged goods, short delivery, pricing correction…"
            value={form.reason} onChange={e => setForm(f => ({ ...f, reason: e.target.value }))} />
        </FormGroup>
        <div className="grid grid-cols-2 gap-3">
          <FormGroup label="Credit note date">
            <Input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))} />
          </FormGroup>
          <FormGroup label="Journal">
            <Select value={form.journal_id} onChange={e => setForm(f => ({ ...f, journal_id: e.target.value }))}>
              <option value="">Default</option>
              {journals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
            </Select>
          </FormGroup>
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
        <BtnPrimary onClick={submit} loading={saving}>Create Credit Note</BtnPrimary>
      </div>
    </Modal>
  );
}
