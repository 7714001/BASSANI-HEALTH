import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import { Printer, X, ExternalLink, Send, Download, RotateCcw, FileX, Plus, Loader2 } from "lucide-react";
import {
  TopBar, DataTable, SearchBar, FilterPill, ChipRow,
  Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger,
  fmtR, fmtDate,
} from "../components/UI";

// ── Static Bassani details ─────────────────────────────────────────────────────
const BASSANI = {
  name:    "Bassani Health (PTY) LTD",
  vat:     "4430323131",
  tagline: "Transforming Lives Through Health",
  bank:    "First National Bank (FNB)",
  account_name:   "Bassani Health",
  account_number: "63137121842",
  branch_code:    "210554",
  payment_terms:  [
    "Payment is due upon collection.",
    "Interest on overdue amounts shall accrue at the prime rate plus 2%.",
    "4 days to collect orders once ready.",
  ],
};

// ── Helpers ────────────────────────────────────────────────────────────────────

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

function fmt(n) {
  if (n == null) return "—";
  return new Intl.NumberFormat("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}

// ── Invoice print view ─────────────────────────────────────────────────────────

function InvoiceView({ invoice, onClose }) {
  const printRef = useRef();

  const print = () => {
    const content = printRef.current?.innerHTML;
    if (!content) return;
    const win = window.open("", "_blank", "width=900,height=1200");
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${invoice.name || "Invoice"}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: 12px; color: #111; background: #fff; }
            .page { width: 794px; min-height: 1123px; margin: 0 auto; padding: 48px 48px 40px; display: flex; flex-direction: column; }
          </style>
        </head>
        <body>${content}</body>
      </html>
    `);
    win.document.close();
    win.focus();
    setTimeout(() => { win.print(); win.close(); }, 400);
  };

  const p = invoice.partner_detail || {};
  const addressLines = [
    p.street, p.street2, [p.city, p.zip].filter(Boolean).join(", "),
    p.state_id?.[1], p.country_id?.[1],
  ].filter(Boolean);

  const source = invoice.invoice_origin || invoice.ref || "—";

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-100 overflow-hidden">
      <div className="flex items-center justify-between px-6 py-3 bg-white border-b border-gray-200 shrink-0">
        <div>
          <p className="text-sm font-semibold text-gray-800">{invoice.name || "Invoice"}</p>
          <p className="text-xs text-gray-400">{invoice.partner_id?.[1]}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={print}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-bassani-600 hover:bg-bassani-700 text-white text-xs font-semibold rounded-lg transition-colors">
            <Printer size={13} /> Print / Save PDF
          </button>
          <button onClick={onClose}
            className="flex items-center gap-1 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors">
            <X size={13} /> Close
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-8 px-4">
        <div ref={printRef} className="bg-white shadow-lg mx-auto"
          style={{ width: 794, minHeight: 1123, padding: "48px 48px 40px", fontFamily: "system-ui, sans-serif", fontSize: 12, color: "#111", display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 36 }}>
            <div>
              <img src="/logo.png" alt="Bassani Health" style={{ height: 40 }}
                onError={e => { e.target.style.display = "none"; e.target.nextSibling.style.display = "block"; }} />
              <div style={{ display: "none", fontSize: 20, fontWeight: 800, color: "#0f6e56", letterSpacing: -0.5 }}>BASSANI HEALTH</div>
              <div style={{ marginTop: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 700 }}>{BASSANI.name}</p>
                <p style={{ fontSize: 11, color: "#666" }}>VAT NO: {BASSANI.vat}</p>
              </div>
            </div>
            <p style={{ fontSize: 11, fontStyle: "italic", color: "#0f6e56", textAlign: "right", paddingTop: 4 }}>{BASSANI.tagline}</p>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 28 }}>
            <div style={{ textAlign: "right", fontSize: 11, lineHeight: 1.6, color: "#444" }}>
              <p style={{ fontWeight: 700, fontSize: 12, color: "#111" }}>{p.name || invoice.partner_id?.[1]}</p>
              {addressLines.map((l, i) => <p key={i}>{l}</p>)}
              {p.vat && <p style={{ marginTop: 4 }}>VAT NO: {p.vat}</p>}
            </div>
          </div>
          <h1 style={{ fontSize: 28, fontWeight: 800, marginBottom: 16 }}>Invoice {invoice.name}</h1>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, borderTop: "1px solid #e5e7eb", borderBottom: "1px solid #e5e7eb", padding: "12px 0", marginBottom: 28 }}>
            {[
              ["Invoice Date", fmtDate(invoice.invoice_date)],
              ["Due Date",     fmtDate(invoice.invoice_date_due)],
              ["Source",       source],
              ["Reference",    invoice.ref || source],
            ].map(([label, val]) => (
              <div key={label}>
                <span style={{ display: "block", fontSize: 9, fontWeight: 700, color: "#999", textTransform: "uppercase", letterSpacing: 0.5, marginBottom: 2 }}>{label}</span>
                <span style={{ fontSize: 12, fontWeight: 600 }}>{val || "—"}</span>
              </div>
            ))}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
            <thead>
              <tr>
                {["Description", "Quantity", "Unit Price", "Taxes", "Amount"].map((h, i) => (
                  <th key={h} style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", color: "#999", letterSpacing: 0.5, padding: "8px 6px", borderBottom: "2px solid #e5e7eb", textAlign: i > 0 ? "right" : "left" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(invoice.lines || []).map((line, i) => (
                <tr key={i}>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", fontSize: 11.5, color: "#333" }}>{line.name}</td>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5 }}>{line.quantity?.toFixed ? `${line.quantity.toFixed(2)} Units` : line.quantity}</td>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5 }}>{fmt(line.price_unit)}</td>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5, color: "#666" }}>{line.tax_display || "—"}</td>
                  <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>R {fmt(line.price_subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 8 }}>
            <div style={{ fontSize: 11, color: "#444", maxWidth: 320 }}>
              <p>Payment Communication: <strong style={{ fontSize: 12, color: "#111" }}>{invoice.name}</strong></p>
              <div style={{ marginTop: 10 }}>
                {BASSANI.payment_terms.map((t, i) => <p key={i} style={{ fontSize: 10, color: "#888", lineHeight: 1.7 }}>{t}</p>)}
              </div>
            </div>
            <table style={{ minWidth: 260 }}>
              <tbody>
                <tr><td style={{ padding: "4px 6px", fontSize: 12, color: "#666" }}>Untaxed Amount</td><td style={{ padding: "4px 6px", fontSize: 12, textAlign: "right", paddingLeft: 40 }}>R {fmt(invoice.amount_untaxed)}</td></tr>
                <tr><td style={{ padding: "4px 6px", fontSize: 12, color: "#666" }}>VAT 15%</td><td style={{ padding: "4px 6px", fontSize: 12, textAlign: "right", paddingLeft: 40 }}>R {fmt(invoice.amount_tax)}</td></tr>
                <tr><td style={{ padding: "8px 6px 4px", fontSize: 14, fontWeight: 800, borderTop: "2px solid #111" }}>Total</td><td style={{ padding: "8px 6px 4px", fontSize: 14, fontWeight: 800, textAlign: "right", paddingLeft: 40, borderTop: "2px solid #111" }}>R {fmt(invoice.amount_total)}</td></tr>
              </tbody>
            </table>
          </div>
          <div style={{ marginTop: "auto", paddingTop: 24, borderTop: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
            <div>{BASSANI.payment_terms.map((t, i) => <p key={i} style={{ fontSize: 10, color: "#888", lineHeight: 1.7 }}>{t}</p>)}</div>
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 11, fontWeight: 700, color: "#444" }}>Bank Name: {BASSANI.bank}</p>
              <p style={{ fontSize: 10, color: "#888" }}>Account Name: {BASSANI.account_name}</p>
              <p style={{ fontSize: 10, color: "#888" }}>Account Number: {BASSANI.account_number} &nbsp; Branch Code: {BASSANI.branch_code}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Main Invoices view ─────────────────────────────────────────────────────────

export default function Invoices() {
  const { user, can } = useAuth();
  const isAdmin    = user?.role === "admin";
  const canFinance = can("tickets.finance_confirm");
  const location   = useLocation();
  const navigate   = useNavigate();
  const initialFilter = location.state?.filter || "unpaid";

  const [invoices,   setInvoices  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [search,     setSearch    ] = useState("");
  const [filter,     setFilter    ] = useState(initialFilter);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "invoice_date", desc: true }]);

  const [viewInvoice,  setViewInvoice ] = useState(null);
  const [viewLoading,  setViewLoading ] = useState(false);

  // Per-row action states — keyed by invoice id
  const [sendingId,          setSendingId         ] = useState(null);
  const [creatingTicketId,   setCreatingTicketId  ] = useState(null);

  // Reset to draft confirm
  const [resetConfirm,  setResetConfirm ] = useState(null); // null | invoice
  const [resetting,     setResetting    ] = useState(false);

  // Credit note modal
  const [cnModal,      setCnModal    ] = useState(null); // null | invoice
  const [cnJournals,   setCnJournals ] = useState([]);
  const [cnForm,       setCnForm     ] = useState({ reason: "", date: "", journal_id: "" });
  const [cnSaving,     setCnSaving   ] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const sort = sorting[0];
      const params = { limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize };
      if (sort) { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      if (search) params.search = search;
      if (filter === "credit_notes") {
        params.move_type = "out_refund";
      } else if (filter !== "all") {
        params.payment_state = filter;
      }
      const r = await api.get("/api/invoices/", { params });
      setInvoices(r.data.invoices);
      setTotal(r.data.total);
    } catch { toast.error("Failed to load invoices"); }
    finally { setLoading(false); }
  }, [search, filter, pagination, sorting]);

  useEffect(() => { load(); }, [load]);

  const openViewInvoice = async (inv) => {
    setViewLoading(true);
    try {
      const r = await api.get(`/api/invoices/${inv.id}`);
      setViewInvoice(r.data);
    } catch { toast.error("Failed to load invoice details"); }
    finally { setViewLoading(false); }
  };

  const openTicket = (ticketId) =>
    navigate("/tickets/sales", { state: { openTicketId: ticketId } });

  const sendInvoice = async (inv) => {
    setSendingId(inv.id);
    try {
      await api.post(`/api/invoices/${inv.id}/send`);
      toast.success(`Invoice ${inv.name} sent to customer`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send invoice");
    } finally {
      setSendingId(null);
    }
  };

  const doResetToDraft = async () => {
    const inv = resetConfirm;
    setResetting(true);
    try {
      await api.post(`/api/invoices/${inv.id}/reset-to-draft`);
      toast.success(`${inv.name} reset to draft`);
      setResetConfirm(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Reset failed");
    } finally {
      setResetting(false);
    }
  };

  const openCreditNote = async (inv) => {
    setCnForm({ reason: "", date: new Date().toISOString().split("T")[0], journal_id: "" });
    setCnModal(inv);
    try {
      const r = await api.get("/api/invoices/credit-note-journals");
      const journals = r.data.journals || [];
      setCnJournals(journals);
      if (journals.length > 0) setCnForm(f => ({ ...f, journal_id: String(journals[0].id) }));
    } catch { setCnJournals([]); }
  };

  const createCreditNote = async () => {
    if (!cnForm.reason.trim()) return toast.error("Reason is required");
    setCnSaving(true);
    try {
      const r = await api.post(`/api/invoices/${cnModal.id}/credit-note`, {
        reason:     cnForm.reason,
        date:       cnForm.date || undefined,
        journal_id: cnForm.journal_id ? parseInt(cnForm.journal_id) : undefined,
      });
      toast.success(`Credit note ${r.data.credit_note_name} created`);
      setCnModal(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create credit note");
    } finally {
      setCnSaving(false);
    }
  };

  const createTicket = async (inv) => {
    if (!inv.sale_order_id) return;
    setCreatingTicketId(inv.id);
    try {
      const r = await api.post("/api/tickets/from-order", { order_id: inv.sale_order_id });
      toast.success("Sales ticket created");
      navigate("/tickets/sales", { state: { openTicketId: r.data.ticket_id } });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create ticket");
    } finally {
      setCreatingTicketId(null);
    }
  };

  const FILTERS = [
    { key: "unpaid",       label: "Outstanding" },
    { key: "not_paid",     label: "Unpaid" },
    { key: "partial",      label: "Partial" },
    { key: "paid",         label: "Paid" },
    { key: "all",          label: "All" },
    { key: "credit_notes", label: "Credit Notes" },
  ];

  const outstandingTotal = invoices.reduce((s, i) => s + (i.amount_residual || 0), 0);

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
          <SearchBar value={search} onChange={v => { setSearch(v); setPagination(p => ({ ...p, pageIndex: 0 })); }} placeholder="Search invoice #, customer, sale order…" />
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
              cell: ({ row: { original: inv } }) => (
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-bassani-700 font-semibold">{inv.name || "Draft"}</span>
                    {inv.move_type === "out_refund" && (
                      <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-100 px-1.5 py-0.5 rounded-full font-semibold">CN</span>
                    )}
                  </div>
                  {inv.invoice_origin && (
                    <p className="text-[10px] text-gray-400 font-mono mt-0.5">{inv.invoice_origin}</p>
                  )}
                </div>
              ),
            },
            { id: "customer", header: "Customer", enableSorting: false,
              cell: ({ row: { original: inv } }) =>
                <span className="font-medium text-gray-900">{inv.partner_id?.[1] || "—"}</span> },
            { accessorKey: "invoice_date", header: "Date", meta: { className: "hidden sm:table-cell" },
              cell: ({ row: { original: inv } }) =>
                <span className="text-xs text-gray-500">{fmtDate(inv.invoice_date)}</span> },
            { accessorKey: "invoice_date_due", header: "Due", meta: { className: "hidden md:table-cell" },
              cell: ({ row: { original: inv } }) => {
                const overdue = inv.invoice_date_due && new Date(inv.invoice_date_due) < new Date() && inv.payment_state !== "paid";
                return <span className={`text-xs ${overdue ? "text-red-600 font-semibold" : "text-gray-500"}`}>{fmtDate(inv.invoice_date_due)}</span>;
              } },
            { accessorKey: "amount_total", header: "Total",
              cell: ({ row: { original: inv } }) =>
                <span className="font-semibold">{fmtR(inv.amount_total)}</span> },
            { accessorKey: "amount_residual", header: "Outstanding", meta: { className: "hidden sm:table-cell" },
              cell: ({ row: { original: inv } }) =>
                <span className={`font-semibold ${inv.amount_residual > 0 ? "text-red-600" : "text-green-700"}`}>
                  {inv.amount_residual > 0 ? fmtR(inv.amount_residual) : "—"}
                </span> },
            { id: "payment_state", header: "Status", enableSorting: false,
              cell: ({ row: { original: inv } }) => (
                <div className="flex flex-col gap-1">
                  <PaymentBadge state={inv.payment_state} />
                  {inv.linked_ticket_id && (
                    <button
                      onClick={e => { e.stopPropagation(); openTicket(inv.linked_ticket_id); }}
                      className="flex items-center gap-0.5 text-[10px] text-blue-600 hover:text-blue-700 font-medium">
                      Ticket <ExternalLink size={9} />
                    </button>
                  )}
                </div>
              ) },
            {
              id: "actions", header: "", enableSorting: false,
              cell: ({ row: { original: inv } }) => {
                const isPosted   = inv.state === "posted";
                const isUnpaid   = inv.payment_state === "not_paid";
                const isOutInv   = inv.move_type === "out_invoice";
                const isSending  = sendingId === inv.id;
                const isCreating = creatingTicketId === inv.id;
                return (
                  <div className="flex items-center gap-2 flex-wrap" onClick={e => e.stopPropagation()}>
                    {/* View portal invoice */}
                    <button
                      onClick={() => openViewInvoice(inv)}
                      disabled={viewLoading}
                      className="text-xs text-bassani-600 hover:text-bassani-700 font-medium hover:underline disabled:opacity-40">
                      View
                    </button>

                    {/* PDF download — direct Odoo PDF */}
                    {isPosted && canFinance && (
                      <a
                        href={`/api/invoices/${inv.id}/pdf`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-0.5 text-xs text-gray-500 hover:text-bassani-600 font-medium transition-colors"
                        title="Download Odoo PDF">
                        <Download size={11} />PDF
                      </a>
                    )}

                    {/* Send invoice */}
                    {isPosted && isOutInv && canFinance && (
                      <button
                        onClick={() => sendInvoice(inv)}
                        disabled={isSending}
                        className="flex items-center gap-0.5 text-xs text-gray-500 hover:text-bassani-600 font-medium transition-colors disabled:opacity-40"
                        title="Send invoice email to customer">
                        {isSending ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
                        Send
                      </button>
                    )}

                    {/* Reset to draft */}
                    {isPosted && isUnpaid && isOutInv && canFinance && isAdmin && (
                      <button
                        onClick={() => setResetConfirm(inv)}
                        className="flex items-center gap-0.5 text-xs text-amber-600 hover:text-amber-700 font-medium transition-colors"
                        title="Reset to draft">
                        <RotateCcw size={11} />Draft
                      </button>
                    )}

                    {/* Credit note */}
                    {isPosted && isOutInv && canFinance && (
                      <button
                        onClick={() => openCreditNote(inv)}
                        className="flex items-center gap-0.5 text-xs text-purple-600 hover:text-purple-700 font-medium transition-colors"
                        title="Raise credit note">
                        <FileX size={11} />CN
                      </button>
                    )}

                    {/* Create Sales Ticket — only when linked order exists and no ticket yet */}
                    {inv.sale_order_id && !inv.linked_ticket_id && isAdmin && (
                      <button
                        onClick={() => createTicket(inv)}
                        disabled={isCreating}
                        className="flex items-center gap-0.5 text-xs text-green-600 hover:text-green-700 font-medium transition-colors disabled:opacity-40"
                        title="Create a Sales Ticket for the linked order">
                        {isCreating ? <Loader2 size={11} className="animate-spin" /> : <Plus size={11} />}
                        Ticket
                      </button>
                    )}
                  </div>
                );
              },
            },
          ]}
          data={invoices} loading={loading} total={total}
          pagination={pagination} onPaginationChange={setPagination}
          sorting={sorting} onSortingChange={u => { setSorting(typeof u === "function" ? u(sorting) : u); setPagination(p => ({ ...p, pageIndex: 0 })); }}
          manualPagination manualSorting
          onRowClick={inv => openViewInvoice(inv)}
        />
      </main>

      {/* Full-screen invoice viewer */}
      {viewInvoice && <InvoiceView invoice={viewInvoice} onClose={() => setViewInvoice(null)} />}

      {/* Reset to draft confirm */}
      {resetConfirm && (
        <Modal title="Reset Invoice to Draft" onClose={() => setResetConfirm(null)}>
          <p className="text-sm text-gray-600 mb-1">
            Reset <strong>{resetConfirm.name}</strong> to draft?
          </p>
          <p className="text-sm text-gray-500 mb-4">
            The invoice will become editable again. This cannot be done if any payment has been registered against it.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setResetConfirm(null)} disabled={resetting}>Cancel</BtnSecondary>
            <BtnDanger onClick={doResetToDraft} loading={resetting}>Reset to Draft</BtnDanger>
          </div>
        </Modal>
      )}

      {/* Credit note modal */}
      {cnModal && (
        <Modal title={`Raise Credit Note — ${cnModal.name}`} onClose={() => setCnModal(null)}>
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 gap-2 text-sm">
              <span className="text-gray-500">Customer</span>
              <span className="font-medium text-right">{cnModal.partner_id?.[1]}</span>
              <span className="text-gray-500">Invoice Total</span>
              <span className="font-semibold text-right">{fmtR(cnModal.amount_total)}</span>
            </div>
            <FormGroup label="Reason" required>
              <Textarea
                rows={3}
                placeholder="Damaged goods, short delivery, pricing correction…"
                value={cnForm.reason}
                onChange={e => setCnForm(f => ({ ...f, reason: e.target.value }))}
              />
            </FormGroup>
            <div className="grid grid-cols-2 gap-3">
              <FormGroup label="Credit note date">
                <Input type="date" value={cnForm.date} onChange={e => setCnForm(f => ({ ...f, date: e.target.value }))} />
              </FormGroup>
              <FormGroup label="Journal">
                <Select value={cnForm.journal_id} onChange={e => setCnForm(f => ({ ...f, journal_id: e.target.value }))}>
                  <option value="">Default</option>
                  {cnJournals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
                </Select>
              </FormGroup>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCnModal(null)} disabled={cnSaving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={createCreditNote} loading={cnSaving}>Create Credit Note</BtnPrimary>
          </div>
        </Modal>
      )}

    </div>
  );
}
