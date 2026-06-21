// ─────────────────────────────────────────────────────────────────────────────
// Sales Tickets view — Phase 8.5 / 8.6
// Tracks PO/RFQ → Quote → Sale Order → Invoice → Payment → WIP → Complete.
// Phase 8.6 adds: Build Quote (draft Odoo order from ticket), Cancel Quote,
// Register Deposit (creates down-payment invoice + payment in Odoo).
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  Plus, CreditCard, XCircle, CheckCircle2, Clock,
  UserPlus, ShoppingCart, Ban, DollarSign,
} from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, Badge, LoadingState, EmptyState, fmtDate,
} from "../components/UI";

const fmtR = (n) =>
  `R${(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_LABEL = {
  open: "Open (RFQ)", quote: "Quote", sale_order: "Sale Order", invoice: "Invoice",
  confirmed_wip: "Confirmed — WIP", ready_for_collection: "Ready for Collection", incomplete: "Incomplete",
};
const STATUS_COLOR = {
  open: "gray", quote: "amber", sale_order: "blue", invoice: "indigo",
  confirmed_wip: "teal", ready_for_collection: "green", incomplete: "orange",
};
const EXIT_LABEL = { not_interested: "Not Interested", cancelled: "Cancelled", complete: "Complete" };
const EXIT_COLOR = { not_interested: "gray", cancelled: "red", complete: "green" };
const FORWARD_STATUSES = ["open", "quote", "sale_order", "invoice", "confirmed_wip", "ready_for_collection", "incomplete"];

// Stages before Odoo confirmation — cancel-quote is allowed here
const PRE_CONFIRM = new Set(["open", "quote", "sale_order", "invoice"]);

export default function SalesTickets() {
  const { can, user } = useAuth();
  const canDrive   = can("tickets.sales");
  const canFinance = can("tickets.finance_confirm");

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
  const [createModal, setCreateModal] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerResults, setCustomerResults] = useState([]);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [createNote, setCreateNote] = useState("");
  const [creating, setCreating] = useState(false);

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
    if (stageForm.status === "incomplete" && !stageForm.incomplete_reason) {
      return toast.error("A reason is required when marking incomplete");
    }
    setSaving(true);
    try {
      const body = { note: stageForm.note || undefined };
      if (stageForm.status !== detail.status) body.status = stageForm.status;
      if (stageForm.order_id)   body.order_id   = parseInt(stageForm.order_id);
      if (stageForm.invoice_id) body.invoice_id = parseInt(stageForm.invoice_id);
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
  const [quoteModal, setQuoteModal]         = useState(false);
  const [quoteProducts, setQuoteProducts]   = useState([]);
  const [quoteProdsLoading, setQuoteProdsLoading] = useState(false);
  const [quoteProdSearch, setQuoteProdSearch] = useState("");
  const [quoteCart, setQuoteCart]           = useState([]);
  const [quoteWarehouses, setQuoteWarehouses] = useState([]);
  const [quoteWarehouseId, setQuoteWarehouseId] = useState("");
  const [quoteNote, setQuoteNote]           = useState("");
  const [quoteSaving, setQuoteSaving]       = useState(false);

  const openQuoteBuilder = async () => {
    setQuoteCart([]); setQuoteProdSearch(""); setQuoteNote(""); setQuoteWarehouseId("");
    setQuoteProdsLoading(true);
    setQuoteModal(true);
    try {
      const [prodRes, whRes] = await Promise.all([
        api.get("/api/products/", { params: { limit: 200 } }),
        api.get("/api/warehouses/"),
      ]);
      setQuoteProducts(prodRes.data.products || []);
      const whs = whRes.data.warehouses || [];
      setQuoteWarehouses(whs);
      if (whs.length > 0) setQuoteWarehouseId(String(whs[0].id));
    } catch { toast.error("Failed to load products"); }
    finally { setQuoteProdsLoading(false); }
  };

  const addToQuoteCart = (p) => {
    setQuoteCart(prev => {
      const ex = prev.find(i => i.product_id === p.id);
      if (ex) return prev.map(i => i.product_id === p.id ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { product_id: p.id, qty: 1, price_unit: p.list_price, name: p.display_name || p.name, _sku: p.default_code || "" }];
    });
  };

  const updateQuoteQty = (pid, qty) => {
    if (qty <= 0) { setQuoteCart(prev => prev.filter(i => i.product_id !== pid)); return; }
    setQuoteCart(prev => prev.map(i => i.product_id === pid ? { ...i, qty } : i));
  };

  const submitQuote = async () => {
    if (quoteCart.length === 0) return toast.error("Add at least one product");
    setQuoteSaving(true);
    try {
      await api.post(`/api/tickets/${detail.id}/create-order`, {
        order_line: quoteCart.map(i => ({
          product_id: i.product_id,
          product_uom_qty: i.qty,
          price_unit: i.price_unit,
          name: i.name,
        })),
        warehouse_id: quoteWarehouseId ? parseInt(quoteWarehouseId) : undefined,
        note: quoteNote || undefined,
      });
      toast.success("Quote created in Odoo — ticket advanced to Quote stage");
      setQuoteModal(false);
      setDetail(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Failed to create quote"); }
    finally { setQuoteSaving(false); }
  };

  const cancelQuote = async () => {
    if (!window.confirm("Cancel this quote?\n\nThe Odoo draft order will be cancelled and the ticket closed as Cancelled.")) return;
    setSaving(true);
    try {
      await api.post(`/api/tickets/${detail.id}/cancel-order`);
      toast.success("Quote cancelled");
      setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Cancel failed"); }
    finally { setSaving(false); }
  };

  // ── Deposit Registration ──────────────────────────────────────────────────
  const [depositModal, setDepositModal]   = useState(false);
  const [depositJournals, setDepositJournals] = useState([]);
  const [depositForm, setDepositForm]     = useState({ amount: "", date: "", journal_id: "", note: "" });
  const [depositSaving, setDepositSaving] = useState(false);

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
        amount: orderTotal ? (orderTotal / 2).toFixed(2) : "",
        journal_id: journals[0]?.id ? String(journals[0].id) : "",
      }));
    } catch { toast.error("Failed to load deposit details"); }
    setDepositModal(true);
  };

  const registerDeposit = async () => {
    if (!depositForm.amount || !depositForm.date || !depositForm.journal_id) {
      return toast.error("Amount, date and payment method are required");
    }
    setDepositSaving(true);
    try {
      await api.post(`/api/tickets/${detail.id}/register-deposit`, {
        amount: parseFloat(depositForm.amount),
        date: depositForm.date,
        journal_id: parseInt(depositForm.journal_id),
        note: depositForm.note || undefined,
      });
      toast.success("Deposit registered and invoice created in Odoo");
      setDepositModal(false);
      setDetail(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Deposit registration failed"); }
    finally { setDepositSaving(false); }
  };

  // ── Derived ───────────────────────────────────────────────────────────────
  const quoteFiltered = quoteProducts
    .filter(p => {
      if (!quoteProdSearch) return true;
      const q = quoteProdSearch.toLowerCase();
      return p.name.toLowerCase().includes(q) || (p.default_code || "").toLowerCase().includes(q);
    })
    .sort((a, b) => {
      const aIn = (a.virtual_available ?? 0) > 0;
      const bIn = (b.virtual_available ?? 0) > 0;
      if (aIn !== bIn) return aIn ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, 60);

  const quoteCartTotal = quoteCart.reduce((s, i) => s + i.qty * i.price_unit, 0);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Sales Tickets" subtitle="PO/RFQ → Quote → Sale Order → Invoice → Payment → Complete" onRefresh={load}
        actions={canDrive && <BtnPrimary onClick={openCreate}><Plus size={14} />New Direct Inquiry</BtnPrimary>} />
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
              { accessorKey: "updated_at", header: "Last Updated", cell: ({ row: { original: t } }) => <span className="text-xs text-gray-400">{fmtDate(t.updated_at)}</span> },
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
            {detail.order_id && <span className="text-xs text-gray-400">Order #{detail.order_id}</span>}
            {detail.invoice_id && <span className="text-xs text-gray-400">Invoice #{detail.invoice_id}</span>}
          </div>

          {/* Assignment row */}
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

          {/* ── Build Quote — direct inquiry, no order yet ── */}
          {!detail.exit_status && !detail.order_id && detail.source === "direct" && canDrive && (
            <div className="border border-dashed border-bassani-300 bg-bassani-50 rounded-xl p-3 mb-3 flex items-center justify-between gap-3">
              <p className="text-xs text-bassani-700">Ready to build the quote? This creates a draft Odoo order linked to this ticket.</p>
              <BtnPrimary size="sm" onClick={openQuoteBuilder}>
                <ShoppingCart size={13} />Build Quote
              </BtnPrimary>
            </div>
          )}

          {/* ── Cancel Quote — pre-confirm, has order ── */}
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

          {/* ── Confirm Payment (fallback — invoice already linked manually) ── */}
          {!detail.exit_status && detail.invoice_id && !detail.payment_confirmed_at && canFinance && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 mb-4 flex items-center justify-between gap-3">
              <p className="text-xs text-amber-700">Confirm "Payment Received" — checks Odoo's real invoice payment status.</p>
              <BtnPrimary onClick={confirmPayment} loading={saving}><CreditCard size={13} />Confirm Payment</BtnPrimary>
            </div>
          )}

          {detail.payment_confirmed_at && (
            <p className="text-xs text-green-600 mb-4 flex items-center gap-1"><CheckCircle2 size={12} />Payment confirmed {fmtDate(detail.payment_confirmed_at)}</p>
          )}

          {/* ── Stage timeline ── */}
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

      {/* ── Quote Builder modal ── */}
      {quoteModal && (
        <Modal title={`Build Quote — ${detail?.customer_name}`} onClose={() => setQuoteModal(false)}>
          {quoteProdsLoading ? <LoadingState /> : (
            <>
              {/* Warehouse + note */}
              <div className="grid grid-cols-2 gap-3 mb-3">
                <FormGroup label="Warehouse">
                  <Select value={quoteWarehouseId} onChange={e => setQuoteWarehouseId(e.target.value)}>
                    {quoteWarehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                    {quoteWarehouses.length === 0 && <option value="">Default</option>}
                  </Select>
                </FormGroup>
                <FormGroup label="Note">
                  <Input value={quoteNote} onChange={e => setQuoteNote(e.target.value)} placeholder="Delivery notes…" />
                </FormGroup>
              </div>

              {/* Product search */}
              <Input
                value={quoteProdSearch}
                onChange={e => setQuoteProdSearch(e.target.value)}
                placeholder="Search by product name or SKU…"
                className="mb-3"
              />

              {/* Product list */}
              <div className="border border-gray-100 rounded-xl overflow-hidden mb-3 max-h-48 overflow-y-auto">
                {quoteFiltered.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-6">No products found</p>
                ) : quoteFiltered.map(p => {
                  const inCart = quoteCart.find(i => i.product_id === p.id);
                  const outOfStock = (p.virtual_available ?? 0) <= 0;
                  return (
                    <div key={p.id} className="flex items-center justify-between gap-2 px-3 py-2 border-b border-gray-50 last:border-0 hover:bg-gray-50">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-gray-900 truncate">{p.display_name || p.name}</p>
                        <p className="text-[10px] text-gray-400">{fmtR(p.list_price)} {p.default_code && `· ${p.default_code}`}</p>
                      </div>
                      {inCart ? (
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => updateQuoteQty(p.id, inCart.qty - 1)}
                            className="w-6 h-6 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 text-sm font-bold flex items-center justify-center">−</button>
                          <input type="number" min={1} value={inCart.qty}
                            onChange={e => { const v = parseInt(e.target.value); if (!isNaN(v) && v >= 1) updateQuoteQty(p.id, v); }}
                            className="w-10 text-center text-xs font-bold border-0 bg-transparent focus:outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none" />
                          <button onClick={() => updateQuoteQty(p.id, inCart.qty + 1)}
                            className="w-6 h-6 rounded border border-gray-200 text-gray-600 hover:bg-gray-100 text-sm font-bold flex items-center justify-center">+</button>
                          <button onClick={() => updateQuoteQty(p.id, 0)}
                            className="w-6 h-6 rounded border border-red-100 text-red-400 hover:bg-red-50 text-lg leading-none flex items-center justify-center">×</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => !outOfStock && addToQuoteCart(p)}
                          disabled={outOfStock}
                          className={`text-xs px-2 py-1 rounded-lg font-semibold shrink-0 transition-colors ${outOfStock ? "bg-gray-100 text-gray-400 cursor-not-allowed" : "bg-bassani-600 text-white hover:bg-bassani-700"}`}>
                          {outOfStock ? "No stock" : "+ Add"}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Cart summary */}
              {quoteCart.length > 0 && (
                <div className="bg-gray-50 rounded-xl p-3 mb-3">
                  <p className="text-xs font-semibold text-gray-600 mb-1.5">{quoteCart.length} item{quoteCart.length !== 1 ? "s" : ""} in quote</p>
                  {quoteCart.map(i => (
                    <div key={i.product_id} className="flex justify-between text-xs text-gray-600 py-0.5">
                      <span className="truncate">{i.name} ×{i.qty}</span>
                      <span className="font-medium ml-2 shrink-0">{fmtR(i.qty * i.price_unit)}</span>
                    </div>
                  ))}
                  <div className="border-t border-gray-200 mt-1.5 pt-1.5 flex justify-between text-xs font-bold text-gray-900">
                    <span>Subtotal (excl. VAT)</span>
                    <span>{fmtR(quoteCartTotal)}</span>
                  </div>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => setQuoteModal(false)} disabled={quoteSaving}>Cancel</BtnSecondary>
                <BtnPrimary onClick={submitQuote} loading={quoteSaving} disabled={quoteCart.length === 0}>
                  Create Quote in Odoo
                </BtnPrimary>
              </div>
            </>
          )}
        </Modal>
      )}

      {/* ── Register Deposit modal ── */}
      {depositModal && (
        <Modal title="Register Deposit" onClose={() => setDepositModal(false)}>
          <p className="text-xs text-gray-500 mb-4">
            This creates a down payment invoice in Odoo and registers the payment against it — keeping Odoo as the financial source of truth.
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
            <BtnPrimary onClick={registerDeposit} loading={depositSaving}>
              Register in Odoo
            </BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
