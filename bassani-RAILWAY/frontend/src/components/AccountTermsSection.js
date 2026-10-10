import { useState, useEffect, useCallback } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { Badge, BtnPrimary, BtnSecondary, BtnDanger, Input, Select, Modal, FormGroup, fmtR, fmtDate } from "./UI";

// Phase 8.68 — Account Terms card on the customer profile.
//
// An approved account customer can have orders "released on account" at the
// deposit stage: no deposit, invoiced unpaid at Mark Complete, due per their
// payment terms. Approval is recorded in the portal; the payment terms and
// credit limit it rests on are written to (and always read live from) Odoo,
// which holds them per company — so this card shows each trading company
// separately and the approval lists which companies it covers.

function oneYearFromToday() {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 1);
  return d.toISOString().split("T")[0];
}

export default function AccountTermsSection({ customerId, customerName, canManage, onChanged }) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(true);
  const [approveOpen, setApproveOpen] = useState(false);
  const [suspendOpen, setSuspendOpen] = useState(false);
  const [form, setForm]           = useState(null);
  const [reason, setReason]       = useState("");
  const [saving, setSaving]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/customers/${customerId}/account-terms`);
      setData(r.data);
    } catch (e) {
      setData({ error: e.response?.data?.detail || "Could not load account terms" });
    } finally {
      setLoading(false);
    }
  }, [customerId]);

  useEffect(() => { load(); }, [load]);

  const terms = data?.account_terms;
  const creditTerms = (data?.payment_terms || []).filter(t => t.is_credit);

  const openApprove = () => {
    setForm({
      payment_term_id: terms?.payment_term_id ? String(terms.payment_term_id) : "",
      credit_limit:    terms?.credit_limit ? String(terms.credit_limit) : "",
      company_ids:     terms?.company_ids?.length ? terms.company_ids : (data?.trading_companies || []).map(c => c.id),
      reference:       terms?.reference || "",
      review_date:     terms && !terms.review_overdue && terms.review_date ? terms.review_date : oneYearFromToday(),
      note:            terms?.note || "",
    });
    setApproveOpen(true);
  };

  const toggleCompany = (id) => setForm(f => ({
    ...f,
    company_ids: f.company_ids.includes(id) ? f.company_ids.filter(c => c !== id) : [...f.company_ids, id],
  }));

  const approve = async () => {
    if (!form.payment_term_id) return toast.error("Choose payment terms");
    if (!(parseFloat(form.credit_limit) > 0)) return toast.error("Enter a credit limit above zero");
    if (!form.company_ids.length) return toast.error("Select at least one company");
    if (!form.reference.trim()) return toast.error("Enter the agreement reference");
    if (!form.review_date) return toast.error("Choose a review date");
    setSaving(true);
    try {
      await api.put(`/api/customers/${customerId}/account-terms`, {
        payment_term_id: parseInt(form.payment_term_id),
        credit_limit:    parseFloat(form.credit_limit),
        company_ids:     form.company_ids,
        reference:       form.reference.trim(),
        review_date:     form.review_date,
        note:            form.note.trim() || undefined,
      });
      toast.success("Account terms approved");
      setApproveOpen(false);
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not approve account terms");
    } finally {
      setSaving(false);
    }
  };

  const suspend = async () => {
    if (!reason.trim()) return toast.error("A reason is required");
    setSaving(true);
    try {
      await api.post(`/api/customers/${customerId}/account-terms/suspend`, { reason: reason.trim() });
      toast.success("Account terms suspended");
      setSuspendOpen(false);
      setReason("");
      await load();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not suspend account terms");
    } finally {
      setSaving(false);
    }
  };

  let statusBadge = <Badge color="gray">Not approved</Badge>;
  if (terms?.status === "approved" && terms.review_overdue) statusBadge = <Badge color="amber">Review overdue</Badge>;
  else if (terms?.status === "approved") statusBadge = <Badge color="green">Approved</Badge>;
  else if (terms?.status === "suspended") statusBadge = <Badge color="red">Suspended</Badge>;

  const actions = canManage && data && !data.error ? (
    <>
      {terms?.status === "approved" && (
        <BtnSecondary onClick={() => { setReason(""); setSuspendOpen(true); }}>Suspend</BtnSecondary>
      )}
      <BtnPrimary onClick={openApprove}>
        {terms ? "Edit / Re-approve" : "Approve Account Terms"}
      </BtnPrimary>
    </>
  ) : null;

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-800 text-sm flex items-center gap-2">
          <ShieldCheck size={15} className="text-gray-400" />Account Terms {!loading && data && !data.error && statusBadge}
        </h3>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>

      <div className="px-5 py-4 space-y-4">
        <p className="text-xs text-gray-500">
          A customer approved for account terms can have orders released on account instead of paying a deposit.
          The order is invoiced when it's ready and the invoice is due according to their payment terms.
          Every release is checked against their credit limit.
        </p>

        {loading ? (
          <p className="text-sm text-gray-400 flex items-center gap-2"><Loader2 size={13} className="animate-spin" />Loading…</p>
        ) : data?.error ? (
          <p className="text-sm text-red-600">{data.error}</p>
        ) : (
          <>
            {terms && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-sm">
                {[
                  ["Payment terms", terms.payment_term_name],
                  ["Credit limit", fmtR(terms.credit_limit || 0)],
                  ["Agreement", terms.reference],
                  ["Review date", terms.review_date ? fmtDate(terms.review_date) : "Not set"],
                  ["Approved by", terms.approved_by_name ? `${terms.approved_by_name}, ${fmtDate(terms.approved_at)}` : "Not recorded"],
                  ["Applies to", (terms.company_names || []).join(", ") || "None"],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-xs text-gray-400">{k}</p>
                    <p className="font-medium text-gray-800">{v}</p>
                  </div>
                ))}
              </div>
            )}
            {terms?.status === "suspended" && (
              <div className="rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-xs text-red-700">
                Suspended by {terms.suspended_by_name || "staff"} on {fmtDate(terms.suspended_at)}: {terms.suspended_reason}.
                No orders can be released on account until the terms are re-approved.
              </div>
            )}
            {terms?.status === "approved" && terms.review_overdue && (
              <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                The review date has passed. Orders can't be released on account until the terms are re-approved.
              </div>
            )}
            {terms?.note && <p className="text-xs text-gray-500">Note: {terms.note}</p>}

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                    <th className="py-2 pr-3 font-medium">Company</th>
                    <th className="py-2 pr-3 font-medium">Payment terms</th>
                    <th className="py-2 pr-3 font-medium text-right">Credit limit</th>
                    <th className="py-2 pr-3 font-medium text-right">Balance</th>
                    <th className="py-2 font-medium text-right">Overdue</th>
                  </tr>
                </thead>
                <tbody>
                  {(data?.credit_by_company || []).map(row => {
                    const covered = terms?.status === "approved" && (terms.company_ids || []).includes(row.company_id);
                    return (
                      <tr key={row.company_id} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-3">
                          <span className="text-gray-800">{row.company_name}</span>
                          {covered && <Badge color="green" className="ml-2">Covered</Badge>}
                        </td>
                        <td className="py-2 pr-3 text-gray-600">{row.payment_term?.name || "None"}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{row.credit_limit ? fmtR(row.credit_limit) : "None"}</td>
                        <td className="py-2 pr-3 text-right text-gray-600">{fmtR(row.credit || 0)}</td>
                        <td className={`py-2 text-right ${row.total_overdue > 0 ? "text-red-600 font-medium" : "text-gray-600"}`}>
                          {fmtR(Math.max(row.total_overdue || 0, 0))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-[11px] text-gray-400 mt-1.5">Live figures for each company the customer can be invoiced from.</p>
            </div>
          </>
        )}
      </div>

      {approveOpen && form && (
        <Modal title={terms ? "Edit Account Terms" : "Approve Account Terms"} onClose={() => setApproveOpen(false)}>
          <p className="text-xs text-gray-500 mb-4">
            Approves <strong>{customerName}</strong> for account terms. The payment terms and credit limit are saved
            to the customer's account for each company selected below.
          </p>
          <FormGroup label="Payment terms" required>
            <Select value={form.payment_term_id} onChange={e => setForm(f => ({ ...f, payment_term_id: e.target.value }))}>
              <option value="">— Select —</option>
              {creditTerms.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </FormGroup>
          <FormGroup label="Credit limit (ZAR)" required>
            <Input type="number" step="0.01" min="0.01" value={form.credit_limit}
              onChange={e => setForm(f => ({ ...f, credit_limit: e.target.value }))} placeholder="e.g. 50000.00" />
          </FormGroup>
          <FormGroup label="Applies to" required>
            <div className="space-y-1.5">
              {(data?.trading_companies || []).map(co => (
                <label key={co.id} className="flex items-center gap-2 text-sm text-gray-700 cursor-pointer">
                  <input type="checkbox" checked={form.company_ids.includes(co.id)} onChange={() => toggleCompany(co.id)}
                    className="accent-bassani-600" />
                  {co.name}
                </label>
              ))}
            </div>
          </FormGroup>
          <FormGroup label="Agreement reference" required>
            <Input value={form.reference} onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
              placeholder="e.g. Signed credit application ACC-0042" />
          </FormGroup>
          <FormGroup label="Review date" required>
            <Input type="date" value={form.review_date} onChange={e => setForm(f => ({ ...f, review_date: e.target.value }))} />
          </FormGroup>
          <FormGroup label="Note">
            <Input value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="Optional" />
          </FormGroup>
          <p className="text-[11px] text-gray-400 -mt-1 mb-2">
            Upload the signed agreement under Documents on this page so it's kept with the customer's record.
          </p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setApproveOpen(false)} disabled={saving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={approve} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
              Approve
            </BtnPrimary>
          </div>
        </Modal>
      )}

      {suspendOpen && (
        <Modal title="Suspend Account Terms?" onClose={() => setSuspendOpen(false)}>
          <p className="text-sm text-gray-600 mb-3">
            No new orders for <strong>{customerName}</strong> can be released on account until the terms are re-approved.
            Orders already released keep their terms.
          </p>
          <FormGroup label="Reason" required>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Invoices 60 days overdue" autoFocus />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setSuspendOpen(false)} disabled={saving}>Cancel</BtnSecondary>
            <BtnDanger onClick={suspend} disabled={saving || !reason.trim()}>Suspend</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}
