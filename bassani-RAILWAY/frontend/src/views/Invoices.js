import { useState, useEffect, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  TopBar, DataTable, SearchBar, FilterPill, ChipRow, Badge,
  Modal, FormGroup, Input, Select, BtnPrimary, BtnSecondary,
  fmtR, fmtDate,
} from "../components/UI";

const PAYMENT_STATE_LABEL = {
  not_paid:   "Unpaid",
  partial:    "Partial",
  in_payment: "In Payment",
  paid:       "Paid",
  reversed:   "Reversed",
};

const PAYMENT_STATE_STYLE = {
  not_paid:   "bg-red-50 text-red-700",
  partial:    "bg-amber-50 text-amber-700",
  in_payment: "bg-blue-50 text-blue-700",
  paid:       "bg-green-50 text-green-700",
  reversed:   "bg-gray-100 text-gray-500",
};

function PaymentBadge({ state }) {
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${PAYMENT_STATE_STYLE[state] || "bg-gray-100 text-gray-500"}`}>
      {PAYMENT_STATE_LABEL[state] || state}
    </span>
  );
}

export default function Invoices() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const location = useLocation();
  const initialFilter = location.state?.filter || "unpaid";

  const [invoices,   setInvoices  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [search,     setSearch    ] = useState("");
  const [filter,     setFilter    ] = useState(initialFilter);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "invoice_date", desc: true }]);

  // Payment registration state
  const [journals,      setJournals     ] = useState([]);
  const [payModal,      setPayModal     ] = useState(null);   // invoice object or null
  const [payForm,       setPayForm      ] = useState({ journal_id: "", payment_date: "", amount: "" });
  const [paying,        setPaying       ] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort = sorting[0];
      const params = {
        limit:  pagination.pageSize,
        offset: pagination.pageIndex * pagination.pageSize,
      };
      if (sort) { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search = search;
      if (filter !== "all") params.payment_state = filter;
      const r = await api.get("/api/invoices/", { params });
      setInvoices(r.data.invoices);
      setTotal(r.data.total);
    } catch { toast.error("Failed to load invoices"); }
    finally { setLoading(false); }
  }, [search, filter, pagination, sorting]);

  useEffect(() => { load(); }, [load]);

  // Load payment journals once for admin
  useEffect(() => {
    if (!isAdmin) return;
    api.get("/api/invoices/payment-journals")
      .then(r => setJournals(r.data.journals || []))
      .catch(() => {});
  }, [isAdmin]);

  const openPayModal = (inv) => {
    setPayModal(inv);
    setPayForm({
      journal_id:   journals[0]?.id || "",
      payment_date: new Date().toISOString().split("T")[0],
      amount:       String(inv.amount_residual || inv.amount_total),
    });
  };

  const submitPayment = async () => {
    if (!payForm.journal_id) return toast.error("Select a payment journal");
    if (!payForm.amount || parseFloat(payForm.amount) <= 0) return toast.error("Enter a valid amount");
    setPaying(true);
    try {
      await api.put(`/api/invoices/${payModal.id}/pay`, {
        journal_id:   parseInt(payForm.journal_id),
        payment_date: payForm.payment_date || undefined,
        amount:       parseFloat(payForm.amount),
      });
      toast.success(`Payment of ${fmtR(parseFloat(payForm.amount))} registered`);
      setPayModal(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Payment failed");
    } finally {
      setPaying(false);
    }
  };

  const FILTERS = [
    { key: "unpaid",   label: "Outstanding" },
    { key: "not_paid", label: "Unpaid" },
    { key: "partial",  label: "Partial" },
    { key: "paid",     label: "Paid" },
    { key: "all",      label: "All" },
  ];

  const outstandingTotal = invoices.reduce((s, i) => s + (i.amount_residual || 0), 0);
  const canPay = (inv) => isAdmin && (inv.payment_state === "not_paid" || inv.payment_state === "partial");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Invoices"
        subtitle={total > 0
          ? `${total} invoice${total !== 1 ? "s" : ""} · ${fmtR(outstandingTotal)} outstanding on this page`
          : "Customer invoices from Odoo"}
        onRefresh={load}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4 space-y-2">
          <SearchBar value={search} onChange={v => { setSearch(v); setPagination(p => ({ ...p, pageIndex: 0 })); }} placeholder="Search invoice #, customer…" />
          <ChipRow>
            {FILTERS.map(f => (
              <FilterPill key={f.key} label={f.label} active={filter === f.key}
                onClick={() => { setFilter(f.key); setPagination(p => ({ ...p, pageIndex: 0 })); }} />
            ))}
          </ChipRow>
        </div>

        <DataTable
          columns={[
            { accessorKey: "name", header: "Invoice #",
              cell: ({ row: { original: inv } }) =>
                <span className="font-mono text-xs text-bassani-700">{inv.name || "Draft"}</span> },
            { id: "customer", header: "Customer", enableSorting: false,
              cell: ({ row: { original: inv } }) =>
                <span className="font-medium text-gray-900">{inv.partner_id?.[1] || "—"}</span> },
            { accessorKey: "invoice_date", header: "Date",
              cell: ({ row: { original: inv } }) =>
                <span className="text-xs text-gray-500">{fmtDate(inv.invoice_date)}</span> },
            { accessorKey: "invoice_date_due", header: "Due Date",
              cell: ({ row: { original: inv } }) => {
                const overdue = inv.invoice_date_due && new Date(inv.invoice_date_due) < new Date() && inv.payment_state !== "paid";
                return <span className={`text-xs ${overdue ? "text-red-600 font-semibold" : "text-gray-500"}`}>{fmtDate(inv.invoice_date_due)}</span>;
              }},
            { accessorKey: "amount_total", header: "Total",
              cell: ({ row: { original: inv } }) =>
                <span className="font-semibold">{fmtR(inv.amount_total)}</span> },
            { accessorKey: "amount_residual", header: "Outstanding",
              cell: ({ row: { original: inv } }) =>
                <span className={`font-semibold ${inv.amount_residual > 0 ? "text-red-600" : "text-green-700"}`}>
                  {inv.amount_residual > 0 ? fmtR(inv.amount_residual) : "—"}
                </span> },
            { id: "payment_state", header: "Status", enableSorting: false,
              cell: ({ row: { original: inv } }) => <PaymentBadge state={inv.payment_state} /> },
            ...(isAdmin ? [{
              id: "actions", header: "", enableSorting: false,
              cell: ({ row: { original: inv } }) => canPay(inv) ? (
                <BtnPrimary size="sm" onClick={e => { e.stopPropagation(); openPayModal(inv); }}>
                  Register Payment
                </BtnPrimary>
              ) : null,
            }] : []),
          ]}
          data={invoices} loading={loading} total={total}
          pagination={pagination} onPaginationChange={setPagination}
          sorting={sorting} onSortingChange={u => { setSorting(typeof u === "function" ? u(sorting) : u); setPagination(p => ({ ...p, pageIndex: 0 })); }}
          manualPagination manualSorting
        />
      </main>

      {payModal && (
        <Modal title={`Register Payment — ${payModal.name}`} onClose={() => setPayModal(null)}>
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-xl p-3 flex justify-between text-sm">
              <span className="text-gray-500">Customer</span>
              <span className="font-medium">{payModal.partner_id?.[1]}</span>
            </div>
            <div className="bg-gray-50 rounded-xl p-3 flex justify-between text-sm">
              <span className="text-gray-500">Outstanding</span>
              <span className="font-semibold text-red-600">{fmtR(payModal.amount_residual)}</span>
            </div>
            <FormGroup label="Payment Journal" required>
              <Select value={payForm.journal_id} onChange={e => setPayForm({ ...payForm, journal_id: e.target.value })}>
                <option value="">— Select journal —</option>
                {journals.map(j => (
                  <option key={j.id} value={j.id}>{j.display_label} ({j.type})</option>
                ))}
              </Select>
            </FormGroup>
            <FormGroup label="Payment Date">
              <Input type="date" value={payForm.payment_date} onChange={e => setPayForm({ ...payForm, payment_date: e.target.value })} />
            </FormGroup>
            <FormGroup label="Amount (ZAR)" required>
              <Input type="number" min="0.01" step="0.01" value={payForm.amount} onChange={e => setPayForm({ ...payForm, amount: e.target.value })} />
            </FormGroup>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setPayModal(null)} disabled={paying}>Cancel</BtnSecondary>
            <BtnPrimary onClick={submitPayment} loading={paying}>Confirm Payment</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
