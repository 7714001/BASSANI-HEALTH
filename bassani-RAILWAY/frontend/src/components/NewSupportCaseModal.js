// "New request" modal for the portal (Phase 28). One component for every
// in-portal entry point:
//   - a customer/reseller raising a request (from Help & Support, Order
//     Passport's Need Help card, or an invoice row) — the backend derives the
//     customer from the order/invoice, or from the customer login itself;
//   - staff logging a request on a customer's behalf (phone call, walk-in,
//     an email that came in outside the portal) — staff pick the customer,
//     set priority, and choose whether the customer gets the acknowledgement.
// Customers WITHOUT a portal login never see this — they use the signed-link
// public page (views/PublicSupport.js), which shares CaseFormFields with it.
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import api from "../api";
import { useAuth } from "../AuthContext";
import { Modal, BtnPrimary, BtnSecondary, FormGroup, Input, Select } from "./UI";
import { CaseFormFields, EMPTY_CASE_FORM, caseFormError, appendCaseForm, SUPPORT_CATEGORIES } from "./SupportKit";

const STAFF_CATEGORIES = [
  ...SUPPORT_CATEGORIES.slice(0, 4),
  { key: "feedback", label: "Feedback", hint: "Compliments, suggestions or general feedback" },
  SUPPORT_CATEGORIES[4],
];

export default function NewSupportCaseModal({ onClose, onCreated, prefill = {} }) {
  const { user } = useAuth();
  const isCustomer = user?.role === "customer";
  const isReseller = user?.role === "reseller";
  const isStaff = !isCustomer && !isReseller;
  const hasDocument = !!(prefill.orderId || prefill.invoiceId);

  const [form, setForm] = useState({ ...EMPTY_CASE_FORM, category: prefill.category || "" });
  const [productOptions, setProductOptions] = useState([]);
  const [saving, setSaving] = useState(false);

  // Customer selection — staff, or a reseller raising one not tied to an order.
  const needsCustomerPick = !hasDocument && !isCustomer && !prefill.customerPartnerId;
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerOptions, setCustomerOptions] = useState([]);
  const [customerId, setCustomerId] = useState(prefill.customerPartnerId || "");

  // Staff-only fields
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [priority, setPriority] = useState("");
  const [notifyCustomer, setNotifyCustomer] = useState(true);

  useEffect(() => {
    if (!prefill.orderId) return;
    api.get(`/api/orders/${prefill.orderId}`)
      .then((r) => {
        const names = (r.data?.lines || [])
          .map((l) => (Array.isArray(l.product_id) ? l.product_id[1] : l.product_name || l.name))
          .filter(Boolean);
        setProductOptions([...new Set(names)]);
      })
      .catch(() => {});
  }, [prefill.orderId]);

  useEffect(() => {
    if (!needsCustomerPick) return;
    // Resellers only ever see their own customers here (server-scoped list).
    const t = setTimeout(() => {
      api.get("/api/customers/", { params: { search: customerSearch || undefined, limit: isReseller ? 200 : 25 } })
        .then((r) => setCustomerOptions(r.data?.customers || []))
        .catch(() => setCustomerOptions([]));
    }, customerSearch ? 300 : 0);
    return () => clearTimeout(t);
  }, [customerSearch, needsCustomerPick, isReseller]);

  const submit = async () => {
    const err = caseFormError(form);
    if (err) return toast.error(err);
    if (needsCustomerPick && !customerId) return toast.error("Please choose the customer this request is for");
    setSaving(true);
    try {
      const fd = appendCaseForm(new FormData(), form);
      if (prefill.orderId) fd.append("order_id", prefill.orderId);
      if (prefill.invoiceId) fd.append("invoice_id", prefill.invoiceId);
      if (customerId) fd.append("customer_partner_id", customerId);
      if (isStaff) {
        if (contactName.trim()) fd.append("contact_name", contactName.trim());
        if (contactEmail.trim()) fd.append("contact_email", contactEmail.trim());
        if (priority) fd.append("priority", priority);
        fd.append("notify_customer", notifyCustomer ? "true" : "false");
      }
      const r = await api.post("/api/support/cases", fd, { headers: { "Content-Type": "multipart/form-data" } });
      toast.success(isStaff ? `Request ${r.data.case.ref} logged` : `Request ${r.data.case.ref} sent. We'll be in touch soon.`);
      onCreated?.(r.data.case);
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send your request");
    } finally {
      setSaving(false);
    }
  };

  const contextLine = prefill.orderName
    ? `About order ${prefill.orderName}`
    : prefill.invoiceName ? `About invoice ${prefill.invoiceName}` : null;

  return (
    <Modal title={isStaff ? "Log a Customer Request" : "New Request"} onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        {contextLine && (
          <p className="text-xs font-medium text-bassani-700 bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">{contextLine}</p>
        )}

        {needsCustomerPick && (
          <FormGroup label="Customer" required>
            <Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)}
              placeholder={isReseller ? "Filter your customers…" : "Search customers by name…"} />
            <div className="mt-1.5">
              <Select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                <option value="">Select a customer</option>
                {customerOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            </div>
          </FormGroup>
        )}

        <CaseFormFields value={form} onChange={setForm} productOptions={productOptions}
          categories={isStaff ? STAFF_CATEGORIES : SUPPORT_CATEGORIES} onFileError={toast.error} />

        {isStaff && (
          <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-3">
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Logging on the customer's behalf</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Contact name</p>
                <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Who raised it" />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Contact email</p>
                <Input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="Defaults to the company email" />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Priority</p>
                <Select value={priority} onChange={(e) => setPriority(e.target.value)}>
                  <option value="">Automatic</option>
                  <option value="low">Low (48h)</option>
                  <option value="normal">Normal (24h)</option>
                  <option value="high">High (8h)</option>
                  <option value="urgent">Urgent (4h)</option>
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={notifyCustomer} onChange={(e) => setNotifyCustomer(e.target.checked)} className="accent-bassani-600" />
              Email the customer an acknowledgement with a link to follow this request up (no login needed)
            </label>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
          <BtnPrimary onClick={submit} loading={saving}>{isStaff ? "Log Request" : "Send Request"}</BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}
