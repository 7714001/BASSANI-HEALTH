import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import bwipjs from "bwip-js";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import { Printer, X, ExternalLink, Send, RotateCcw, FileX, Plus, Loader2, FileSearch, ChevronDown, ChevronRight, Eye, CreditCard } from "lucide-react";
import {
  TopBar, DataTable, SearchBar, FilterPill, ChipRow, Pager,
  Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger,
  OdooPdfViewerModal,
  fmtR, fmtDate,
} from "../components/UI";
import SendRecipientsModal from "../components/SendRecipientsModal";

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

// ── Row action chip (2026-08-27) — replaces the plain text/underline links
// the row actions used to be with an actual compact button (background +
// border), so a row with several conditional actions (View/Send/Pay/Draft/
// CN/Ticket) reads as a cluster of distinct buttons rather than a run of
// inline text. Deliberately small (px-2 py-1, text-[11px]) rather than the
// standard BtnSecondary size — a data table row with up to 6 possible
// actions needs to stay compact, not full-size buttons stacked in one cell.
const ACTION_CHIP_COLOR = {
  bassani: "bg-bassani-50 text-bassani-700 border-bassani-100 hover:bg-bassani-100",
  blue:    "bg-blue-50 text-blue-700 border-blue-100 hover:bg-blue-100",
  green:   "bg-green-50 text-green-700 border-green-100 hover:bg-green-100",
  amber:   "bg-amber-50 text-amber-700 border-amber-100 hover:bg-amber-100",
  purple:  "bg-purple-50 text-purple-700 border-purple-100 hover:bg-purple-100",
};
function ActionChip({ onClick, disabled, loading, icon: Icon, color = "bassani", title, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled || loading}
      title={title}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold border transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${ACTION_CHIP_COLOR[color] || ACTION_CHIP_COLOR.bassani}`}
    >
      {loading ? <Loader2 size={11} className="animate-spin" /> : Icon && <Icon size={11} />}
      {children}
    </button>
  );
}

// canvas → PNG data URL so the barcode survives the innerHTML → new window print copy
function BarcodeImg({ text, style }) {
  const [src, setSrc] = useState("");
  useEffect(() => {
    if (!text) return;
    const canvas = document.createElement("canvas");
    try {
      bwipjs.toCanvas(canvas, {
        bcid: "code128", text, scale: 2, height: 12,
        includetext: true, textxalign: "center", padding: 2, backgroundcolor: "ffffff",
      });
      setSrc(canvas.toDataURL("image/png"));
    } catch { /* non-fatal */ }
  }, [text]);
  if (!src) return null;
  return <img src={src} alt={text} style={{ display: "block", maxHeight: 52, ...style }} />;
}

// ── Invoice print view ─────────────────────────────────────────────────────────

function InvoiceView({ invoice, onClose }) {
  const printRef = useRef();
  const [odooPdfOpen, setOdooPdfOpen] = useState(false);

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
          <button onClick={() => setOdooPdfOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-700 text-xs font-semibold rounded-lg transition-colors">
            <FileSearch size={13} /> View Original (Odoo)
          </button>
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
      {odooPdfOpen && (
        <OdooPdfViewerModal
          url={`/api/invoices/${invoice.id}/pdf`}
          title={`${invoice.name || "Invoice"} — Odoo original`}
          onClose={() => setOdooPdfOpen(false)}
        />
      )}
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
            <div style={{ textAlign: "right" }}>
              <p style={{ fontSize: 11, fontStyle: "italic", color: "#0f6e56", marginBottom: 8 }}>{BASSANI.tagline}</p>
              {invoice.name && <BarcodeImg text={invoice.name} style={{ marginLeft: "auto" }} />}
            </div>
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
              {(invoice.lines || []).map((line, i) => {
                const pid = line.product_id?.[0];
                const lots = pid && invoice.lot_map?.[pid] ? invoice.lot_map[pid] : [];
                return (
                  <tr key={i}>
                    <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", fontSize: 11.5, color: "#333" }}>
                      {line.name}
                      {lots.length > 0 && (
                        <span style={{ display: "block", fontSize: 9.5, color: "#6b7280", marginTop: 2, fontFamily: "monospace", letterSpacing: 0.3 }}>
                          Batch: {lots.join(", ")}
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5 }}>{line.quantity?.toFixed ? `${line.quantity.toFixed(2)} Units` : line.quantity}</td>
                    <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5 }}>{fmt(line.price_unit)}</td>
                    <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5, color: "#666" }}>{line.tax_display || "—"}</td>
                    <td style={{ padding: "9px 6px", borderBottom: "1px solid #f3f4f6", textAlign: "right", fontSize: 11.5, fontWeight: 600 }}>R {fmt(line.price_subtotal)}</td>
                  </tr>
                );
              })}
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

// ── By-Order view (2026-08-27) — grouped/expandable rows for the reseller/
// customer role, mirroring ManufacturingOrders.js's OrderGroupRow pattern
// exactly (chevron-expand, order ref links to Order Passport, first group
// defaultExpanded). A customer's invoices naturally come in small clusters
// per order (a deposit invoice + a final invoice), so seeing them grouped
// answers "what's the full picture for this order" at a glance instead of
// scanning a flat list to spot which two rows belong together.
function InvoiceOrderGroupRow({ group, defaultExpanded, navigate, onView }) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  return (
    <>
      <tr
        className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer"
        onClick={() => setExpanded(v => !v)}
      >
        <td className="p-3 w-8">
          <button onClick={e => { e.stopPropagation(); setExpanded(v => !v); }} className="text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="p-3 font-mono text-sm whitespace-nowrap">
          {group.sale_order_id ? (
            <button
              onClick={e => { e.stopPropagation(); navigate(`/orders/${group.sale_order_id}/passport`); }}
              className="text-bassani-700 hover:text-bassani-900 hover:underline font-medium flex items-center gap-1"
            >
              {group.order_ref}
              <ExternalLink size={11} className="text-bassani-400" />
            </button>
          ) : (
            <span className="text-gray-900">{group.order_ref || "No Order"}</span>
          )}
        </td>
        <td className="p-3 text-xs text-gray-400 whitespace-nowrap">
          {group.invoices.length} invoice{group.invoices.length !== 1 ? "s" : ""}
        </td>
        <td className="p-3 font-semibold whitespace-nowrap">{fmtR(group.total)}</td>
        <td className="p-3 whitespace-nowrap">
          <span className={`font-semibold ${group.outstanding > 0 ? "text-red-600" : "text-green-700"}`}>
            {group.outstanding > 0 ? fmtR(group.outstanding) : "Paid in full"}
          </span>
        </td>
      </tr>
      {expanded && group.invoices.map(inv => (
        <tr key={inv.id} className="bg-gray-50 border-b border-gray-100">
          <td className="p-3" />
          <td className="p-3 pl-8" colSpan={2}>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs text-bassani-700 font-semibold">{inv.name || "Draft"}</span>
              {inv.move_type === "out_refund" && (
                <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-100 px-1.5 py-0.5 rounded-full font-semibold">CN</span>
              )}
            </div>
            <p className="text-[10px] text-gray-400 mt-0.5">{fmtDate(inv.invoice_date)}</p>
          </td>
          <td className="p-3">
            <span className="font-semibold text-sm">{fmtR(inv.amount_total)}</span>
          </td>
          <td className="p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-col gap-1">
                <PaymentBadge state={inv.payment_state} />
                {inv.amount_residual > 0 && (
                  <span className="text-[10px] text-red-600 font-medium whitespace-nowrap">{fmtR(inv.amount_residual)} due</span>
                )}
              </div>
              <ActionChip onClick={() => onView(inv)} icon={Eye} color="bassani">
                View
              </ActionChip>
            </div>
          </td>
        </tr>
      ))}
    </>
  );
}

// ── Main Invoices view ─────────────────────────────────────────────────────────

export default function Invoices() {
  const { user, can } = useAuth();
  const isAdmin          = user?.role === "admin";
  const canFinance       = can("tickets.finance_confirm");
  const canRecordPayment = can("invoices.record_payment");
  const location   = useLocation();
  const navigate   = useNavigate();
  // A customer/reseller landing on their own invoice history wants to see
  // everything by default, not just what's currently outstanding — "unpaid"
  // is the right default for staff (who care about what needs action), but
  // for a customer whose invoices happen to all be paid it meant landing on
  // an empty list every time (2026-08-21 fix).
  const isExternalRole = user?.role === "reseller" || user?.role === "customer";
  const initialFilter = location.state?.filter || (isExternalRole ? "all" : "unpaid");

  const [invoices,   setInvoices  ] = useState([]);
  const [total,      setTotal     ] = useState(0);
  const [loading,    setLoading   ] = useState(true);
  const [search,     setSearch    ] = useState("");
  const [filter,     setFilter    ] = useState(initialFilter);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [sorting,    setSorting   ] = useState([{ id: "invoice_date", desc: true }]);

  // By Order view (2026-08-27) — reseller/customer only, defaults on. "All
  // Invoices" keeps the existing flat, server-paginated table exactly as
  // before (also the only mode staff ever see — grouping by SO doesn't
  // serve a searchable business-wide list the way it does a customer's own
  // small, order-clustered invoice history).
  const [viewMode,       setViewMode      ] = useState(isExternalRole ? "grouped" : "flat");
  const [groupPageIndex, setGroupPageIndex] = useState(0);
  const [groupPageSize,  setGroupPageSize ] = useState(25);

  const [viewInvoice,  setViewInvoice ] = useState(null);
  const [viewLoading,  setViewLoading ] = useState(false);

  // Per-row action states — keyed by invoice id
  const [sendingId,        setSendingId       ] = useState(null);
  const [creatingTicketId,       setCreatingTicketId      ] = useState(null);
  const [ticketPreflightModal,   setTicketPreflightModal  ] = useState(null); // { inv, orderName, has_linked_ticket, existing_ticket_id, unlinked_tickets }

  // Reset to draft confirm
  const [resetConfirm,  setResetConfirm ] = useState(null); // null | invoice
  const [resetting,     setResetting    ] = useState(false);

  // Register payment modal
  const [payModal,    setPayModal   ] = useState(null); // null | invoice
  const [payJournals, setPayJournals] = useState([]);
  const [payForm,     setPayForm    ] = useState({ amount: "", date: "", journal_id: "" });
  const [paySaving,   setPaySaving  ] = useState(false);

  // Credit note modal
  const [cnModal,      setCnModal    ] = useState(null); // null | invoice
  const [cnJournals,   setCnJournals ] = useState([]);
  const [cnForm,       setCnForm     ] = useState({ reason: "", date: "", journal_id: "" });
  const [cnSaving,     setCnSaving   ] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const grouped = isExternalRole && viewMode === "grouped";
      // Grouped view paginates SO groups client-side (Pager below), same
      // shape ManufacturingOrders.js's own By Order view already uses, so
      // a group never gets split across two server pages — fetches the
      // largest batch the backend allows (200, its own hard cap) instead
      // of the normal page-at-a-time params. A customer/reseller's own
      // invoice history realistically never exceeds that; flagged, not
      // solved, if it ever does — "All Invoices" + search still works past it.
      const params = grouped
        ? { limit: 200, offset: 0 }
        : { limit: pagination.pageSize, offset: pagination.pageIndex * pagination.pageSize };
      if (!grouped) {
        const sort = sorting[0];
        if (sort) { params.sort_by = sort.id; params.sort_dir = sort.desc ? "desc" : "asc"; }
      }
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
  }, [search, filter, pagination, sorting, viewMode, isExternalRole]);

  useEffect(() => { load(); }, [load]);

  // Auto-open a specific invoice when navigated here from Order Passport
  useEffect(() => {
    const id = location.state?.openInvoiceId;
    if (id) openViewInvoice({ id });
  }, []); // eslint-disable-line

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

  // Send recipient picker (2026-08-27) — opens a modal to choose which
  // contact(s) on the company receive the email, instead of it silently
  // going to whichever single email auto-resolves.
  const [sendModalInvoice, setSendModalInvoice] = useState(null);
  const sendInvoice = (inv) => setSendModalInvoice(inv);

  const doSendInvoice = async (recipients) => {
    const inv = sendModalInvoice;
    setSendingId(inv.id);
    try {
      await api.post(`/api/invoices/${inv.id}/send`, { recipients });
      toast.success(`Invoice ${inv.name} sent to customer`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send invoice");
      throw e;
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

  const openPayModal = async (inv) => {
    setPayForm({
      amount:     String(inv.amount_residual || inv.amount_total || ""),
      date:       new Date().toISOString().split("T")[0],
      journal_id: "",
    });
    setPayModal(inv);
    try {
      const r = await api.get("/api/invoices/payment-journals");
      const journals = r.data.journals || [];
      setPayJournals(journals);
      if (journals.length > 0) setPayForm(f => ({ ...f, journal_id: String(journals[0].id) }));
    } catch { setPayJournals([]); }
  };

  const registerPayment = async () => {
    if (!payForm.journal_id) return toast.error("Select a payment journal");
    if (!payForm.amount || Number(payForm.amount) <= 0) return toast.error("Enter a valid amount");
    setPaySaving(true);
    try {
      await api.put(`/api/invoices/${payModal.id}/pay`, {
        journal_id:   parseInt(payForm.journal_id),
        payment_date: payForm.date || undefined,
        amount:       parseFloat(payForm.amount),
      });
      toast.success(`Payment registered against ${payModal.name}`);
      setPayModal(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Payment registration failed");
    } finally {
      setPaySaving(false);
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
      const pf = await api.get("/api/tickets/from-order/preflight", { params: { order_id: inv.sale_order_id } });
      const data = pf.data;
      if (data.has_linked_ticket || data.unlinked_tickets?.length > 0) {
        setTicketPreflightModal({ inv, ...data });
        return;
      }
      const r = await api.post("/api/tickets/from-order", { order_id: inv.sale_order_id });
      toast.success("Sales ticket created");
      navigate("/tickets/sales", { state: { openTicketId: r.data.ticket_id } });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create ticket");
    } finally {
      setCreatingTicketId(null);
    }
  };

  const doCreateTicketFromPreflight = async () => {
    const { inv } = ticketPreflightModal;
    setTicketPreflightModal(null);
    setCreatingTicketId(inv.id);
    try {
      const r = await api.post("/api/tickets/from-order", { order_id: inv.sale_order_id });
      toast.success("Sales ticket created");
      navigate("/tickets/sales", { state: { openTicketId: r.data.ticket_id } });
    } catch (e) {
      const detail = e.response?.data?.detail;
      const existingId = typeof detail === "object" ? detail?.existing_ticket_id : null;
      if (existingId) {
        toast.error("A ticket already exists for this order");
        navigate("/tickets/sales", { state: { openTicketId: existingId } });
      } else {
        toast.error((typeof detail === "object" ? detail?.message : detail) || "Failed to create ticket");
      }
    } finally {
      setCreatingTicketId(null);
    }
  };

  const doLinkUnlinkedTicket = async (ticketId) => {
    const { inv } = ticketPreflightModal;
    setTicketPreflightModal(null);
    try {
      await api.post(`/api/tickets/${ticketId}/link-order`, { order_id: inv.sale_order_id });
      toast.success("Existing ticket linked to order");
      navigate("/tickets/sales", { state: { openTicketId: ticketId } });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to link ticket");
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

  // Groups the currently-loaded invoices by their linked sale order — one
  // group per SO (a deposit + a final invoice on the same order land
  // together), sorted newest-first by each group's most recent invoice
  // date (matches this app's default newest-first admin-list convention,
  // unlike ManufacturingOrders.js's own oldest-first triage ordering,
  // which doesn't apply to a customer looking at their own history).
  // Falls back to invoice_origin (the human-readable SO name) when
  // sale_order_id is missing, then a single "No Order" bucket.
  const invoiceGroups = useMemo(() => {
    const map = new Map();
    invoices.forEach(inv => {
      const key = inv.sale_order_id ? `so-${inv.sale_order_id}` : (inv.invoice_origin || "no-order");
      if (!map.has(key)) {
        map.set(key, { key, sale_order_id: inv.sale_order_id || null, order_ref: inv.invoice_origin || null, invoices: [] });
      }
      map.get(key).invoices.push(inv);
    });
    const groups = Array.from(map.values()).map(g => ({
      ...g,
      total:       g.invoices.reduce((s, i) => s + (i.amount_total || 0), 0),
      outstanding: g.invoices.reduce((s, i) => s + (i.amount_residual || 0), 0),
      latestDate:  g.invoices.reduce((max, i) => (i.invoice_date && i.invoice_date > max ? i.invoice_date : max), ""),
    }));
    return groups.sort((a, b) => (b.latestDate || "").localeCompare(a.latestDate || ""));
  }, [invoices]);

  // Reset to page 1 whenever the underlying group list changes shape,
  // otherwise a filter/search that shrinks the result set can strand the
  // view on a now-empty page (same guard ManufacturingOrders.js uses).
  useEffect(() => { setGroupPageIndex(0); }, [invoiceGroups.length, groupPageSize]);

  const pagedGroups = useMemo(() => {
    const start = groupPageIndex * groupPageSize;
    return invoiceGroups.slice(start, start + groupPageSize);
  }, [invoiceGroups, groupPageIndex, groupPageSize]);

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
          <div className="flex items-center gap-3 flex-wrap">
            <SearchBar value={search} onChange={v => { setSearch(v); setPagination(p => ({ ...p, pageIndex: 0 })); }} placeholder="Search invoice #, customer, sale order…" />
            {/* By Order / All Invoices toggle (2026-08-27) — reseller/
                customer only; staff always see the flat, searchable list
                unchanged. Mirrors ManufacturingOrders.js's By Order / By
                Product toggle. */}
            {isExternalRole && (
              <div className="flex items-center bg-white border border-gray-200 rounded-lg p-1 gap-1">
                <button
                  onClick={() => setViewMode("grouped")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === "grouped" ? "bg-bassani-600 text-white" : "text-gray-500 hover:text-gray-700"}`}
                >
                  By Order
                </button>
                <button
                  onClick={() => setViewMode("flat")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${viewMode === "flat" ? "bg-bassani-600 text-white" : "text-gray-500 hover:text-gray-700"}`}
                >
                  All Invoices
                </button>
              </div>
            )}
          </div>
          <ChipRow>
            {FILTERS.map(f => (
              <FilterPill key={f.key} label={f.label} active={filter === f.key}
                onClick={() => { setFilter(f.key); setPagination(p => ({ ...p, pageIndex: 0 })); }} />
            ))}
          </ChipRow>
        </div>

        {isExternalRole && viewMode === "grouped" ? (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            {loading ? (
              <div className="py-16 text-center text-sm text-gray-400">Loading…</div>
            ) : invoiceGroups.length === 0 ? (
              <div className="py-16 text-center">
                <p className="text-sm font-medium text-gray-500">No invoices</p>
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="p-3 w-8" />
                        <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Order</th>
                        <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Invoices</th>
                        <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Total</th>
                        <th className="p-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">Outstanding</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagedGroups.map((group, i) => (
                        <InvoiceOrderGroupRow
                          key={group.key}
                          group={group}
                          defaultExpanded={i === 0}
                          navigate={navigate}
                          onView={openViewInvoice}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager
                  pageIndex={groupPageIndex} pageSize={groupPageSize} total={invoiceGroups.length}
                  onPageChange={setGroupPageIndex} onPageSizeChange={setGroupPageSize}
                />
              </>
            )}
          </div>
        ) : (
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
                  <div className="flex items-center gap-1.5 flex-wrap" onClick={e => e.stopPropagation()}>
                    <ActionChip onClick={() => openViewInvoice(inv)} disabled={viewLoading} icon={Eye} color="bassani">
                      View
                    </ActionChip>

                    {isPosted && isOutInv && canFinance && (
                      <ActionChip onClick={() => sendInvoice(inv)} loading={isSending} icon={Send} color="blue" title="Send invoice email to customer">
                        Send
                      </ActionChip>
                    )}

                    {isPosted && inv.payment_state !== "paid" && isOutInv && canRecordPayment && (
                      <ActionChip onClick={() => openPayModal(inv)} icon={CreditCard} color="green" title="Register a payment against this invoice">
                        Pay
                      </ActionChip>
                    )}

                    {isPosted && isUnpaid && isOutInv && canFinance && isAdmin && (
                      <ActionChip onClick={() => setResetConfirm(inv)} icon={RotateCcw} color="amber" title="Reset to draft">
                        Draft
                      </ActionChip>
                    )}

                    {isPosted && isOutInv && canFinance && (
                      <ActionChip onClick={() => openCreditNote(inv)} icon={FileX} color="purple" title="Raise credit note">
                        CN
                      </ActionChip>
                    )}

                    {/* Create Sales Ticket — only when linked order exists and no ticket yet */}
                    {inv.sale_order_id && !inv.linked_ticket_id && isAdmin && (
                      <ActionChip onClick={() => createTicket(inv)} loading={isCreating} icon={Plus} color="green" title="Create a Sales Ticket for the linked order">
                        Ticket
                      </ActionChip>
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
        )}
      </main>

      {/* Full-screen invoice viewer */}
      {viewInvoice && <InvoiceView invoice={viewInvoice} onClose={() => setViewInvoice(null)} />}

      {/* Send Invoice recipient picker (2026-08-27) */}
      {sendModalInvoice && (
        <SendRecipientsModal
          partnerId={Array.isArray(sendModalInvoice.partner_id) ? sendModalInvoice.partner_id[0] : null}
          title={`Send Invoice — ${sendModalInvoice.name}`}
          onClose={() => setSendModalInvoice(null)}
          onSend={doSendInvoice}
        />
      )}

      {/* Register payment modal */}
      {payModal && (
        <Modal title={`Register Payment — ${payModal.name}`} onClose={() => setPayModal(null)}>
          <div className="space-y-3">
            <div className="bg-gray-50 rounded-xl p-3 grid grid-cols-2 gap-2 text-sm">
              <span className="text-gray-500">Customer</span>
              <span className="font-medium text-right">{payModal.partner_id?.[1]}</span>
              <span className="text-gray-500">Outstanding</span>
              <span className="font-semibold text-right text-red-600">{fmtR(payModal.amount_residual)}</span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormGroup label="Amount" required>
                <Input
                  type="number" step="0.01" min="0.01"
                  value={payForm.amount}
                  onChange={e => setPayForm(f => ({ ...f, amount: e.target.value }))}
                />
              </FormGroup>
              <FormGroup label="Payment date">
                <Input type="date" value={payForm.date} onChange={e => setPayForm(f => ({ ...f, date: e.target.value }))} />
              </FormGroup>
            </div>
            <FormGroup label="Journal" required>
              <Select value={payForm.journal_id} onChange={e => setPayForm(f => ({ ...f, journal_id: e.target.value }))}>
                <option value="">Select journal…</option>
                {payJournals.map(j => <option key={j.id} value={j.id}>{j.display_label || j.name}</option>)}
              </Select>
            </FormGroup>
          </div>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setPayModal(null)} disabled={paySaving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={registerPayment} loading={paySaving}>Register Payment</BtnPrimary>
          </div>
        </Modal>
      )}

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

      {/* Ticket preflight modal */}
      {ticketPreflightModal && (
        <Modal
          title={ticketPreflightModal.has_linked_ticket ? "Ticket Already Exists" : "Link Existing Ticket?"}
          onClose={() => setTicketPreflightModal(null)}
          width="max-w-lg"
        >
          {ticketPreflightModal.has_linked_ticket ? (
            <>
              <p className="text-sm text-gray-600 mb-4">
                A Sales Ticket already exists for order <strong>{ticketPreflightModal.order_name}</strong>.
                Open it to continue managing this order in the pipeline.
              </p>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => setTicketPreflightModal(null)}>Cancel</BtnSecondary>
                <BtnPrimary onClick={() => {
                  navigate("/tickets/sales", { state: { openTicketId: ticketPreflightModal.existing_ticket_id } });
                  setTicketPreflightModal(null);
                }}>Open Existing Ticket</BtnPrimary>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 mb-4">
                The following open inquiry tickets have no order assigned yet. Link one to
                order <strong>{ticketPreflightModal.order_name}</strong>, or create a new ticket.
              </p>
              <div className="border border-gray-200 rounded-xl overflow-hidden mb-4">
                {ticketPreflightModal.unlinked_tickets.map(t => (
                  <div key={t.id} className="flex items-center justify-between px-4 py-3 border-b border-gray-100 last:border-0">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{t.customer_name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {t.source === "email" ? "Email inquiry" : "Direct inquiry"} · {t.created_at ? new Date(t.created_at).toLocaleDateString("en-ZA", { timeZone: "Africa/Johannesburg" }) : ""}
                      </p>
                    </div>
                    <BtnSecondary size="sm" onClick={() => doLinkUnlinkedTicket(t.id)}>Link This</BtnSecondary>
                  </div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => setTicketPreflightModal(null)}>Cancel</BtnSecondary>
                <BtnPrimary onClick={doCreateTicketFromPreflight}>Create New Ticket</BtnPrimary>
              </div>
            </>
          )}
        </Modal>
      )}

    </div>
  );
}
