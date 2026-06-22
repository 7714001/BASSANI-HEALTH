// ─────────────────────────────────────────────────────────────────────────────
// Sales Tickets — Phase 8.5 / 8.6
// Includes a full-page, document-style Quote Builder so the sales team works
// the same way they do in Odoo: one product line at a time, inline search,
// editable description and price, running totals — the quote looks like a
// quote before it's even sent.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from "react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, CreditCard, XCircle, CheckCircle2, Clock,
  UserPlus, ShoppingCart, Ban, DollarSign, X,
} from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, Badge, LoadingState, EmptyState, fmtDate,
} from "../components/UI";

const fmtR = (n) =>
  `R ${(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL = {
  open: "Open (RFQ)", quote: "Quote", sale_order: "Sale Order", invoice: "Invoice",
  confirmed_wip: "Confirmed — WIP", ready_for_collection: "Ready for Collection", incomplete: "Incomplete",
};
const STATUS_COLOR = {
  open: "gray", quote: "amber", sale_order: "blue", invoice: "indigo",
  confirmed_wip: "teal", ready_for_collection: "green", incomplete: "orange",
};
const EXIT_LABEL  = { not_interested: "Not Interested", cancelled: "Cancelled", complete: "Complete" };
const EXIT_COLOR  = { not_interested: "gray", cancelled: "red", complete: "green" };
const FORWARD_STATUSES = ["open", "quote", "sale_order", "invoice", "confirmed_wip", "ready_for_collection", "incomplete"];
const PRE_CONFIRM = new Set(["open", "quote", "sale_order", "invoice"]);

// ── Line item row ─────────────────────────────────────────────────────────────
// Each row fires its own debounced Odoo search so results are always live and
// catalogue size is never a constraint (no preload, no 200-item cap).
function LineRow({ line, onUpdate, onRemove, autoFocus }) {
  const [prodSearch, setProdSearch]     = useState(line._product_label || "");
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searching, setSearching]       = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = prodSearch.trim();
    if (q.length < 2) { setSearchResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await api.get("/api/products/", { params: { search: q, limit: 10 } });
        setSearchResults(r.data.products || []);
        setDropdownOpen(true);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [prodSearch]);

  const selectProduct = (p) => {
    const label = p.display_name || p.name;
    setProdSearch(label);
    setDropdownOpen(false);
    onUpdate({
      product_id:       p.id,
      _product_label:   label,
      name:             label,
      price_unit:       p.list_price || 0,
      _tax_rate:        p.tax_rate   || 0,
      _sku:             p.default_code || "",
    });
  };

  const inStockBadge = (p) => {
    const qty = p.virtual_available || 0;
    return qty > 0
      ? <span className="text-[10px] text-green-600 font-medium">{Math.floor(qty)} in stock</span>
      : <span className="text-[10px] text-red-500 font-medium">Out of stock</span>;
  };

  return (
    <tr className="border-b border-gray-100 group hover:bg-slate-50/50 transition-colors">

      {/* ── Product search ── */}
      <td className="p-2.5 relative">
        <input
          autoFocus={autoFocus}
          value={prodSearch}
          onChange={e => {
            const v = e.target.value;
            setProdSearch(v);
            if (!v) {
              setSearchResults([]);
              setDropdownOpen(false);
              onUpdate({ product_id: null, _product_label: "", name: "", price_unit: 0, _tax_rate: 0 });
            }
          }}
          onFocus={() => { if (searchResults.length > 0) setDropdownOpen(true); }}
          onBlur={() => setTimeout(() => setDropdownOpen(false), 150)}
          placeholder="Type product name or SKU…"
          className="w-full text-sm bg-transparent border-0 focus:outline-none placeholder-gray-300"
        />
        {searching && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-gray-300 animate-pulse">searching…</span>
        )}
        {dropdownOpen && searchResults.length > 0 && (
          <div className="absolute z-50 left-0 top-full mt-0.5 w-80 bg-white border border-gray-200 rounded-xl shadow-2xl max-h-64 overflow-y-auto">
            {searchResults.map(p => (
              <button
                key={p.id}
                onMouseDown={() => selectProduct(p)}
                className="w-full text-left px-3 py-2.5 hover:bg-bassani-50 flex items-start justify-between gap-3 border-b border-gray-50 last:border-0 transition-colors"
              >
                <div className="min-w-0">
                  {(() => {
                    const full = p.display_name || p.name;
                    const bracketIdx = full.indexOf(" (");
                    const base    = bracketIdx !== -1 ? full.slice(0, bracketIdx) : full;
                    const variant = bracketIdx !== -1 ? full.slice(bracketIdx + 1) : null;
                    return (
                      <>
                        <p className="text-sm font-medium text-gray-900">{base}</p>
                        {variant && (
                          <p className="text-xs text-bassani-600 font-medium mt-0.5">{variant}</p>
                        )}
                      </>
                    );
                  })()}
                  {p.default_code && (
                    <p className="text-[10px] font-mono text-gray-400 mt-0.5">{p.default_code}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs font-semibold text-gray-800">{fmtR(p.list_price)}</p>
                  {inStockBadge(p)}
                </div>
              </button>
            ))}
          </div>
        )}
      </td>

      {/* ── Description ── */}
      <td className="p-2.5">
        <input
          value={line.name}
          onChange={e => onUpdate({ name: e.target.value })}
          placeholder="Description…"
          className="w-full text-sm bg-transparent border-0 focus:outline-none placeholder-gray-300 text-gray-600"
        />
      </td>

      {/* ── Qty ── */}
      <td className="p-2 w-20">
        <input
          type="number"
          min="0.001"
          step="1"
          value={line.product_uom_qty}
          onChange={e => onUpdate({ product_uom_qty: parseFloat(e.target.value) || 1 })}
          className="w-full text-sm text-center border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-bassani-300 bg-white"
        />
      </td>

      {/* ── Unit Price ── */}
      <td className="p-2 w-36">
        <div className="flex items-center border border-gray-200 rounded-lg bg-white px-2 py-1.5 focus-within:ring-1 focus-within:ring-bassani-300">
          <span className="text-xs text-gray-400 mr-1 shrink-0">R</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={line.price_unit}
            onChange={e => onUpdate({ price_unit: parseFloat(e.target.value) || 0 })}
            className="w-full text-sm text-right border-0 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </td>

      {/* ── Tax % ── */}
      <td className="p-2 w-16 text-center">
        {line._tax_rate
          ? <span className="text-xs bg-slate-100 text-slate-500 rounded-full px-2 py-0.5 font-medium">{line._tax_rate}%</span>
          : <span className="text-xs text-gray-300">—</span>}
      </td>

      {/* ── Line subtotal ── */}
      <td className="p-2.5 w-36 text-right">
        <span className="text-sm font-semibold text-gray-900">
          {fmtR(line.product_uom_qty * line.price_unit)}
        </span>
      </td>

      {/* ── Remove ── */}
      <td className="p-2 w-8">
        <button
          onClick={onRemove}
          className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all p-0.5 rounded"
        >
          <X size={13} />
        </button>
      </td>
    </tr>
  );
}


// ── Main component ────────────────────────────────────────────────────────────
export default function SalesTickets() {
  const { can, user } = useAuth();
  const canDrive   = can("tickets.sales");
  const canFinance = can("tickets.finance_confirm");

  // ── List state ────────────────────────────────────────────────────────────
  const [view, setView]       = useState("list"); // "list" | "quote-builder"
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/tickets/");
      setTickets(r.data.tickets || []);
    } catch { toast.error("Failed to load tickets"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Create modal ──────────────────────────────────────────────────────────
  const [createModal, setCreateModal]       = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [createNote, setCreateNote]         = useState("");
  const [creating, setCreating]             = useState(false);

  useEffect(() => {
    if (!createModal || customerSearch.length < 2) { setCustomerResults([]); return; }
    const t = setTimeout(async () => {
      try {
        const r = await api.get("/api/customers/search", { params: { q: customerSearch, limit: 8 } });
        setCustomerResults(r.data.customers || []);
      } catch { setCustomerResults([]); }
    }, 300);
    return () => clearTimeout(t);
  }, [customerSearch, createModal]);

  const openCreate = () => {
    setSelectedCustomer(null); setCustomerSearch(""); setCustomerResults([]); setCreateNote("");
    setCreateModal(true);
  };

  const createTicket = async () => {
    if (!selectedCustomer) return toast.error("Select a customer first");
    setCreating(true);
    try {
      await api.post("/api/tickets/", { customer_id: selectedCustomer.id, note: createNote || undefined });
      toast.success("Ticket created");
      setCreateModal(false); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Create failed"); }
    finally { setCreating(false); }
  };

  // ── Detail modal ──────────────────────────────────────────────────────────
  const [detail, setDetail] = useState(null);
  const [stageForm, setStageForm] = useState({ status: "", order_id: "", invoice_id: "", note: "", incomplete_reason: "" });
  const [saving, setSaving] = useState(false);

  const openDetail = async (t) => {
    try {
      const r = await api.get(`/api/tickets/${t.id}`);
      setDetail(r.data);
      setStageForm({ status: r.data.status, order_id: r.data.order_id || "", invoice_id: r.data.invoice_id || "", note: "", incomplete_reason: "" });
    } catch { toast.error("Failed to load ticket"); }
  };

  const advance = async () => {
    if (stageForm.status === "incomplete" && !stageForm.incomplete_reason)
      return toast.error("A reason is required when marking incomplete");
    setSaving(true);
    try {
      const body = { note: stageForm.note || undefined };
      if (stageForm.status !== detail.status) body.status = stageForm.status;
      if (stageForm.order_id)          body.order_id          = parseInt(stageForm.order_id);
      if (stageForm.invoice_id)        body.invoice_id        = parseInt(stageForm.invoice_id);
      if (stageForm.incomplete_reason) body.incomplete_reason = stageForm.incomplete_reason;
      await api.put(`/api/tickets/${detail.id}/stage`, body);
      toast.success("Ticket updated");
      setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
    finally { setSaving(false); }
  };

  const markExit = async (exit_status) => {
    if (!window.confirm(`Mark this ticket as "${EXIT_LABEL[exit_status]}"? This closes the ticket.`)) return;
    setSaving(true);
    try {
      await api.put(`/api/tickets/${detail.id}/stage`, { exit_status });
      toast.success("Ticket closed");
      setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
    finally { setSaving(false); }
  };

  const assignToMe = async (ticketId) => {
    try {
      await api.put(`/api/tickets/${ticketId}/stage`, { assigned_to: user.id });
      toast.success("Ticket assigned to you");
      if (detail?.id === ticketId) setDetail(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Assignment failed"); }
  };

  const confirmPayment = async () => {
    setSaving(true);
    try {
      const r = await api.put(`/api/tickets/${detail.id}/confirm-payment`);
      toast.success(`Payment confirmed (Odoo: ${r.data.payment_state})`);
      setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not confirm payment"); }
    finally { setSaving(false); }
  };

  // ── Quote Builder ─────────────────────────────────────────────────────────
  const [quoteTicket, setQuoteTicket]           = useState(null);
  const [quoteLines, setQuoteLines]             = useState([]);
  const [quoteWarehouses, setQuoteWarehouses]   = useState([]);
  const [quoteWarehouseId, setQuoteWarehouseId] = useState("");
  const [quoteNote, setQuoteNote]               = useState("");
  const [quoteSaving, setQuoteSaving]           = useState(false);
  const [lastAddedId, setLastAddedId]           = useState(null);

  const newLine = () => ({
    _id: Date.now() + Math.random(),
    product_id: null, _product_label: "",
    name: "", product_uom_qty: 1,
    price_unit: 0, _tax_rate: 0, _sku: "",
  });

  const openQuoteBuilder = async (ticket) => {
    const firstLine = newLine();
    setQuoteTicket(ticket);
    setQuoteLines([firstLine]);
    setLastAddedId(firstLine._id);
    setQuoteNote("");
    setDetail(null);
    setView("quote-builder");

    // Warehouses are small — load once and reuse. Products are fetched
    // per-row on demand (see LineRow) so no preload is needed here.
    if (quoteWarehouses.length === 0) {
      try {
        const r = await api.get("/api/warehouses/");
        const whs = r.data.warehouses || [];
        setQuoteWarehouses(whs);
        if (whs.length > 0) setQuoteWarehouseId(String(whs[0].id));
      } catch {
        console.warn("Quote builder — warehouses load failed (non-fatal)");
      }
    }
  };

  const addLine = () => {
    const l = newLine();
    setLastAddedId(l._id);
    setQuoteLines(prev => [...prev, l]);
  };

  const updateLine = (id, updates) =>
    setQuoteLines(prev => prev.map(l => l._id === id ? { ...l, ...updates } : l));

  const removeLine = (id) =>
    setQuoteLines(prev => {
      if (prev.length === 1) return [newLine()]; // always keep at least one row
      return prev.filter(l => l._id !== id);
    });

  const cancelQuote = async () => {
    if (!window.confirm("Cancel this quote?\n\nThe Odoo draft order will be cancelled and the ticket closed.")) return;
    setSaving(true);
    try {
      await api.post(`/api/tickets/${detail.id}/cancel-order`);
      toast.success("Quote cancelled");
      setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Cancel failed"); }
    finally { setSaving(false); }
  };

  const submitQuote = async () => {
    const validLines = quoteLines.filter(l => l.product_id);
    if (validLines.length === 0) return toast.error("Add at least one product before creating the quote");
    setQuoteSaving(true);
    try {
      await api.post(`/api/tickets/${quoteTicket.id}/create-order`, {
        order_line: validLines.map(l => ({
          product_id:      l.product_id,
          product_uom_qty: l.product_uom_qty,
          price_unit:      l.price_unit,
          name:            l.name,
        })),
        warehouse_id: quoteWarehouseId ? parseInt(quoteWarehouseId) : undefined,
        note:         quoteNote || undefined,
      });
      toast.success("Quote created in Odoo — ticket advanced to Quote stage");
      setView("list");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create quote"); }
    finally { setQuoteSaving(false); }
  };

  // ── Deposit Registration ──────────────────────────────────────────────────
  const [depositModal, setDepositModal]     = useState(false);
  const [depositJournals, setDepositJournals] = useState([]);
  const [depositForm, setDepositForm]       = useState({ amount: "", date: "", journal_id: "", note: "" });
  const [depositSaving, setDepositSaving]   = useState(false);

  const openDepositModal = async () => {
    const today = new Date().toISOString().split("T")[0];
    setDepositForm({ amount: "", date: today, journal_id: "", note: "" });
    try {
      const [journalRes, orderRes] = await Promise.all([
        api.get("/api/tickets/payment-journals"),
        detail?.order_id ? api.get(`/api/orders/${detail.order_id}`) : Promise.resolve(null),
      ]);
      const journals = journalRes.data.journals || [];
      setDepositJournals(journals);
      const orderTotal = orderRes?.data?.amount_total || 0;
      setDepositForm(f => ({
        ...f,
        amount:     orderTotal ? (orderTotal / 2).toFixed(2) : "",
        journal_id: journals[0]?.id ? String(journals[0].id) : "",
      }));
    } catch { toast.error("Failed to load deposit details"); }
    setDepositModal(true);
  };

  const registerDeposit = async () => {
    if (!depositForm.amount || !depositForm.date || !depositForm.journal_id)
      return toast.error("Amount, date and payment method are required");
    setDepositSaving(true);
    try {
      await api.post(`/api/tickets/${detail.id}/register-deposit`, {
        amount:     parseFloat(depositForm.amount),
        date:       depositForm.date,
        journal_id: parseInt(depositForm.journal_id),
        note:       depositForm.note || undefined,
      });
      toast.success("Deposit registered and invoice created in Odoo");
      setDepositModal(false);
      setDetail(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Deposit registration failed"); }
    finally { setDepositSaving(false); }
  };

  // ── Quote totals ──────────────────────────────────────────────────────────
  const quoteSubtotal = quoteLines.reduce((s, l) => s + l.product_uom_qty * l.price_unit, 0);
  const quoteVat      = quoteLines.reduce((s, l) => s + l.product_uom_qty * l.price_unit * (l._tax_rate / 100), 0);
  const quoteTotal    = quoteSubtotal + quoteVat;
  const hasValidLines = quoteLines.some(l => l.product_id);
  const today         = new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });


  // ── Quote Builder — full-page document view ───────────────────────────────
  if (view === "quote-builder") {
    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
        <TopBar
          title="Quote Builder"
          subtitle={quoteTicket?.customer_name}
          actions={
            <div className="flex items-center gap-2">
              <BtnSecondary onClick={() => setView("list")}>← Back to Tickets</BtnSecondary>
              <BtnPrimary
                onClick={submitQuote}
                loading={quoteSaving}
                disabled={!hasValidLines || quoteSaving}
              >
                Create Quote in Odoo →
              </BtnPrimary>
            </div>
          }
        />

        <main className="flex-1 overflow-y-auto p-6">
          <div className="max-w-5xl mx-auto space-y-4">

            {/* ── Document header ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
              <div className="flex items-start justify-between mb-5">
                <div>
                  <h2 className="text-2xl font-bold tracking-tight text-gray-900">QUOTATION</h2>
                  <p className="text-xs text-gray-400 mt-0.5">Draft — not yet confirmed in Odoo</p>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-400 uppercase tracking-wide font-semibold mb-0.5">Date</p>
                  <p className="text-sm font-medium text-gray-700">{today}</p>
                </div>
              </div>
              <div className="pt-5 border-t border-gray-100 grid grid-cols-2 gap-8">
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Bill To</p>
                  <p className="text-base font-semibold text-gray-900">{quoteTicket?.customer_name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">Customer locked — from ticket</p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Warehouse</p>
                  {quoteWarehouses.length > 0 ? (
                    <Select
                      value={quoteWarehouseId}
                      onChange={e => setQuoteWarehouseId(e.target.value)}
                    >
                      {quoteWarehouses.map(w => (
                        <option key={w.id} value={w.id}>{w.name}</option>
                      ))}
                    </Select>
                  ) : (
                    <p className="text-sm text-gray-400">Default warehouse</p>
                  )}
                </div>
              </div>
            </div>

            {/* ── Line items ── */}
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100">
              <table className="w-full">
                <thead>
                  <tr className="border-b-2 border-gray-100">
                    <th className="text-left p-3 pl-4 text-xs font-semibold text-gray-400 uppercase tracking-wide">Product</th>
                    <th className="text-left p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Description</th>
                    <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Qty</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">Unit Price</th>
                    <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-16">Tax</th>
                    <th className="text-right p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-36">Subtotal</th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {quoteLines.map(line => (
                    <LineRow
                      key={line._id}
                      line={line}
                      onUpdate={(updates) => updateLine(line._id, updates)}
                      onRemove={() => removeLine(line._id)}
                      autoFocus={line._id === lastAddedId}
                    />
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-50">
                    <td colSpan={7} className="p-2 pl-3">
                      <button
                        onClick={addLine}
                        className="flex items-center gap-1.5 text-sm text-bassani-600 hover:text-bassani-700 font-medium px-2 py-1.5 rounded-lg hover:bg-bassani-50 transition-colors"
                      >
                        <Plus size={14} />Add a line
                      </button>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* ── Notes + Totals ── */}
            <div className="grid grid-cols-5 gap-4">

              {/* Notes */}
              <div className="col-span-3 bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Notes</p>
                <textarea
                  value={quoteNote}
                  onChange={e => setQuoteNote(e.target.value)}
                  rows={4}
                  placeholder="Delivery instructions, special requirements, terms…"
                  className="w-full text-sm border-0 focus:outline-none resize-none text-gray-600 placeholder-gray-300"
                />
              </div>

              {/* Totals */}
              <div className="col-span-2 bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex flex-col justify-between">
                <div className="space-y-2.5">
                  <div className="flex justify-between text-sm text-gray-600">
                    <span>Subtotal</span>
                    <span className="font-medium text-gray-800">{fmtR(quoteSubtotal)}</span>
                  </div>
                  <div className="flex justify-between text-sm text-gray-500">
                    <span>VAT (per product rate)</span>
                    <span>{fmtR(quoteVat)}</span>
                  </div>
                  <div className="pt-3 border-t border-gray-100 flex justify-between">
                    <span className="text-base font-bold text-gray-900">Total</span>
                    <span className="text-base font-bold text-bassani-700">{fmtR(quoteTotal)}</span>
                  </div>
                </div>
                <p className="text-[10px] text-gray-300 mt-4 leading-relaxed">
                  Indicative only. Odoo applies fiscal position and tax rules on confirmation.
                </p>
              </div>
            </div>

          </div>
        </main>
      </div>
    );
  }


  // ── List + modals view ────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Sales Tickets"
        subtitle="PO/RFQ → Quote → Sale Order → Invoice → Payment → Complete"
        onRefresh={load}
        actions={canDrive && (
          <BtnPrimary onClick={openCreate}><Plus size={14} />New Direct Inquiry</BtnPrimary>
        )}
      />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? <LoadingState /> : tickets.length === 0 ? (
          <EmptyState message="No sales tickets yet." />
        ) : (
          <DataTable
            data={tickets}
            onRowClick={openDetail}
            columns={[
              { accessorKey: "customer_name", header: "Customer", cell: ({ row: { original: t } }) => (
                <div>
                  <p className="font-medium text-gray-900">{t.customer_name}</p>
                  <Badge color={t.source === "portal" ? "blue" : "gray"} className="mt-0.5">
                    {t.source === "portal" ? "Portal Order" : "Direct Inquiry"}
                  </Badge>
                </div>
              )},
              { id: "status", header: "Stage", cell: ({ row: { original: t } }) =>
                t.exit_status
                  ? <Badge color={EXIT_COLOR[t.exit_status]}>{EXIT_LABEL[t.exit_status]}</Badge>
                  : <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status] || t.status}</Badge>
              },
              { id: "assigned", header: "Assigned To", cell: ({ row: { original: t } }) =>
                t.assigned_to_name
                  ? <span className="text-xs text-gray-600">{t.assigned_to_name}</span>
                  : <span className="text-xs text-amber-500 flex items-center gap-1"><UserPlus size={11} />Unassigned</span>
              },
              { id: "payment", header: "Payment", cell: ({ row: { original: t } }) =>
                t.payment_confirmed_at
                  ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />Confirmed</span>
                  : <span className="text-xs text-gray-400">—</span>
              },
              { accessorKey: "updated_at", header: "Last Updated", cell: ({ row: { original: t } }) =>
                <span className="text-xs text-gray-400">{fmtDate(t.updated_at)}</span>
              },
            ]}
          />
        )}
      </main>

      {/* ── Create modal ── */}
      {createModal && (
        <Modal title="New Direct Inquiry" onClose={() => setCreateModal(false)}>
          <FormGroup label="Customer" required>
            {selectedCustomer ? (
              <div className="flex items-center justify-between bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">
                <span className="text-sm font-medium text-bassani-800">{selectedCustomer.name}</span>
                <button onClick={() => setSelectedCustomer(null)} className="text-xs text-gray-400 hover:text-gray-600">Change</button>
              </div>
            ) : (
              <>
                <Input value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} placeholder="Search customers…" />
                {customerResults.length > 0 && (
                  <div className="mt-1 border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-40 overflow-y-auto">
                    {customerResults.map(c => (
                      <button key={c.id} onClick={() => setSelectedCustomer(c)}
                        className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 transition-colors">
                        {c.name} {c.city && <span className="text-xs text-gray-400">— {c.city}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </FormGroup>
          <FormGroup label="Note">
            <Textarea value={createNote} onChange={e => setCreateNote(e.target.value)} rows={2} placeholder="What the PO/RFQ asked for" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCreateModal(false)} disabled={creating}>Cancel</BtnSecondary>
            <BtnPrimary onClick={createTicket} loading={creating}>Create Ticket</BtnPrimary>
          </div>
        </Modal>
      )}

      {/* ── Detail modal ── */}
      {detail && (
        <Modal title={detail.customer_name} onClose={() => setDetail(null)}>

          {/* Header chips */}
          <div className="flex items-center gap-2 flex-wrap mb-2">
            {detail.exit_status
              ? <Badge color={EXIT_COLOR[detail.exit_status]}>{EXIT_LABEL[detail.exit_status]}</Badge>
              : <Badge color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Badge>}
            <Badge color={detail.source === "portal" ? "blue" : "gray"}>
              {detail.source === "portal" ? "Portal Order" : "Direct Inquiry"}
            </Badge>
            {detail.order_id   && <span className="text-xs text-gray-400">Order #{detail.order_id}</span>}
            {detail.invoice_id && <span className="text-xs text-gray-400">Invoice #{detail.invoice_id}</span>}
          </div>

          {/* Assignment */}
          <div className="flex items-center justify-between mb-4">
            {detail.assigned_to_name
              ? <span className="text-xs text-gray-500">Assigned to <span className="font-medium text-gray-700">{detail.assigned_to_name}</span></span>
              : <span className="text-xs text-amber-600 flex items-center gap-1"><UserPlus size={11} />Unassigned</span>}
            {!detail.assigned_to && canDrive && (
              <BtnSecondary size="sm" onClick={() => assignToMe(detail.id)}>
                <UserPlus size={12} />Assign to me
              </BtnSecondary>
            )}
          </div>

          {/* ── Build Quote ── */}
          {!detail.exit_status && !detail.order_id && detail.source === "direct" && canDrive && (
            <div className="border border-dashed border-bassani-300 bg-bassani-50 rounded-xl p-3 mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-bassani-700">Ready to build the quote? Opens the document builder — add products line by line, just like Odoo.</p>
              <BtnPrimary size="sm" onClick={() => openQuoteBuilder(detail)}>
                <ShoppingCart size={13} />Build Quote
              </BtnPrimary>
            </div>
          )}

          {/* ── Cancel Quote ── */}
          {!detail.exit_status && detail.order_id && PRE_CONFIRM.has(detail.status) && canDrive && (
            <div className="border border-red-200 bg-red-50 rounded-xl p-3 mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-red-700">Customer rejected? Cancel the draft quote and close this ticket.</p>
              <BtnSecondary size="sm" onClick={cancelQuote} disabled={saving}
                className="text-red-600 border-red-200 hover:bg-red-100 shrink-0">
                <Ban size={13} />Cancel Quote
              </BtnSecondary>
            </div>
          )}

          {/* ── Stage advance form ── */}
          {!detail.exit_status && canDrive && (
            <div className="border border-gray-200 rounded-xl p-3 space-y-3 mb-4">
              <div className="grid grid-cols-2 gap-3">
                <FormGroup label="Stage">
                  <Select value={stageForm.status} onChange={e => setStageForm({ ...stageForm, status: e.target.value })}>
                    {FORWARD_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
                  </Select>
                </FormGroup>
                <FormGroup label="Linked Order ID">
                  <Input type="number" value={stageForm.order_id} onChange={e => setStageForm({ ...stageForm, order_id: e.target.value })} placeholder="Odoo sale.order id" />
                </FormGroup>
                <FormGroup label="Linked Invoice ID">
                  <Input type="number" value={stageForm.invoice_id} onChange={e => setStageForm({ ...stageForm, invoice_id: e.target.value })} placeholder="Odoo account.move id" />
                </FormGroup>
                {stageForm.status === "incomplete" && (
                  <FormGroup label="Reason" required className="col-span-2">
                    <Input value={stageForm.incomplete_reason} onChange={e => setStageForm({ ...stageForm, incomplete_reason: e.target.value })} placeholder="Why is this incomplete?" />
                  </FormGroup>
                )}
              </div>
              <FormGroup label="Note">
                <Input value={stageForm.note} onChange={e => setStageForm({ ...stageForm, note: e.target.value })} placeholder="Optional note for the timeline" />
              </FormGroup>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => markExit("not_interested")} disabled={saving}><XCircle size={13} />Not Interested</BtnSecondary>
                <BtnPrimary onClick={advance} loading={saving}>Save</BtnPrimary>
              </div>
            </div>
          )}

          {/* ── Register Deposit — finance, has order, no invoice yet ── */}
          {!detail.exit_status && detail.order_id && !detail.invoice_id && !detail.payment_confirmed_at && canFinance && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-700">Register the 50% deposit — creates a down payment invoice and records payment in Odoo.</p>
              <BtnPrimary onClick={openDepositModal}>
                <DollarSign size={13} />Register Deposit
              </BtnPrimary>
            </div>
          )}

          {/* ── Confirm Payment (fallback — invoice already manually linked) ── */}
          {!detail.exit_status && detail.invoice_id && !detail.payment_confirmed_at && canFinance && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-700">Confirm "Payment Received" — checks Odoo's real invoice payment status.</p>
              <BtnPrimary onClick={confirmPayment} loading={saving}><CreditCard size={13} />Confirm Payment</BtnPrimary>
            </div>
          )}

          {detail.payment_confirmed_at && (
            <p className="text-xs text-green-600 mb-4 flex items-center gap-1">
              <CheckCircle2 size={12} />Payment confirmed {fmtDate(detail.payment_confirmed_at)}
            </p>
          )}

          {/* ── Timeline ── */}
          <p className="text-xs font-semibold text-gray-500 mb-2">Timeline</p>
          <div className="space-y-2 max-h-56 overflow-y-auto">
            {(detail.stage_history || []).slice().reverse().map((h, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <Clock size={12} className="text-gray-300 mt-0.5 shrink-0" />
                <div>
                  <p className="text-gray-700">
                    <span className="font-medium">{h.actor_name}</span> → {h.exit_status ? EXIT_LABEL[h.exit_status] : (STATUS_LABEL[h.status] || h.status)}
                  </p>
                  {h.note && <p className="text-gray-400">{h.note}</p>}
                  <p className="text-gray-300">{fmtDate(h.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </Modal>
      )}

      {/* ── Register Deposit modal ── */}
      {depositModal && (
        <Modal title="Register Deposit" onClose={() => setDepositModal(false)}>
          <p className="text-xs text-gray-500 mb-4">
            Creates a down payment invoice in Odoo and registers payment against it — Odoo remains the financial source of truth.
          </p>
          <FormGroup label="Amount (ZAR)" required>
            <Input
              type="number" step="0.01" min="0.01"
              value={depositForm.amount}
              onChange={e => setDepositForm(f => ({ ...f, amount: e.target.value }))}
              placeholder="e.g. 15000.00"
              autoFocus
            />
          </FormGroup>
          <FormGroup label="Payment Date" required>
            <Input
              type="date"
              value={depositForm.date}
              onChange={e => setDepositForm(f => ({ ...f, date: e.target.value }))}
            />
          </FormGroup>
          <FormGroup label="Payment Method" required>
            <Select
              value={depositForm.journal_id}
              onChange={e => setDepositForm(f => ({ ...f, journal_id: e.target.value }))}
            >
              <option value="">— Select —</option>
              {depositJournals.map(j => (
                <option key={j.id} value={j.id}>{j.name} ({j.type})</option>
              ))}
            </Select>
          </FormGroup>
          <FormGroup label="Note">
            <Input
              value={depositForm.note}
              onChange={e => setDepositForm(f => ({ ...f, note: e.target.value }))}
              placeholder="e.g. EFT received 2026-06-21"
            />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setDepositModal(false)} disabled={depositSaving}>Cancel</BtnSecondary>
            <BtnPrimary onClick={registerDeposit} loading={depositSaving}>Register in Odoo</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
