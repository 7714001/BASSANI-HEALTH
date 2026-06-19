// ─────────────────────────────────────────────────────────────────────────────
// Sales Tickets view — Phase 8.5
// Tracks PO/RFQ → Quote → Sale Order → Invoice → Payment → WIP → Complete,
// the lifecycle Odoo's own sale.order.state doesn't model on its own.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import { Plus, CreditCard, XCircle, CheckCircle2, Clock } from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Input, Select, Textarea,
  BtnPrimary, BtnSecondary, Badge, LoadingState, EmptyState, fmtDate,
} from "../components/UI";

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

export default function SalesTickets() {
  const { can } = useAuth();
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

  const confirmPayment = async () => {
    setSaving(true);
    try {
      const r = await api.put(`/api/tickets/${detail.id}/confirm-payment`);
      toast.success(`Payment confirmed (Odoo: ${r.data.payment_state})`);
      setDetail(null); load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not confirm payment"); }
    finally { setSaving(false); }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Sales Tickets" subtitle="PO/RFQ → Quote → Sale Order → Invoice → Payment → Complete" onRefresh={load}
        actions={canDrive && <BtnPrimary onClick={openCreate}><Plus size={14} />New Ticket</BtnPrimary>} />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? <LoadingState /> : tickets.length === 0 ? (
          <EmptyState message="No sales tickets yet." />
        ) : (
          <DataTable
            data={tickets}
            onRowClick={openDetail}
            columns={[
              { accessorKey: "customer_name", header: "Customer", cell: ({ row: { original: t } }) => <span className="font-medium text-gray-900">{t.customer_name}</span> },
              { id: "status", header: "Stage", cell: ({ row: { original: t } }) =>
                t.exit_status
                  ? <Badge color={EXIT_COLOR[t.exit_status]}>{EXIT_LABEL[t.exit_status]}</Badge>
                  : <Badge color={STATUS_COLOR[t.status]}>{STATUS_LABEL[t.status] || t.status}</Badge>
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
        <Modal title="New Sales Ticket" onClose={() => setCreateModal(false)}>
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
          <div className="flex items-center gap-2 mb-4">
            {detail.exit_status
              ? <Badge color={EXIT_COLOR[detail.exit_status]}>{EXIT_LABEL[detail.exit_status]}</Badge>
              : <Badge color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Badge>}
            {detail.order_id && <span className="text-xs text-gray-400">Order #{detail.order_id}</span>}
            {detail.invoice_id && <span className="text-xs text-gray-400">Invoice #{detail.invoice_id}</span>}
          </div>

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
              <FormGroup label="Note"><Input value={stageForm.note} onChange={e => setStageForm({ ...stageForm, note: e.target.value })} placeholder="Optional note for the timeline" /></FormGroup>
              <div className="flex justify-end gap-2">
                <BtnSecondary onClick={() => markExit("not_interested")} disabled={saving}><XCircle size={13} />Not Interested</BtnSecondary>
                <BtnPrimary onClick={advance} loading={saving}>Save</BtnPrimary>
              </div>
            </div>
          )}

          {!detail.exit_status && detail.invoice_id && !detail.payment_confirmed_at && canFinance && (
            <div className="border border-amber-200 bg-amber-50 rounded-xl p-3 mb-4 flex items-center justify-between">
              <p className="text-xs text-amber-700">Confirm "50% Payment Received" — checks Odoo's real invoice payment status.</p>
              <BtnPrimary onClick={confirmPayment} loading={saving}><CreditCard size={13} />Confirm Payment</BtnPrimary>
            </div>
          )}
          {detail.payment_confirmed_at && (
            <p className="text-xs text-green-600 mb-4 flex items-center gap-1"><CheckCircle2 size={12} />Payment confirmed {fmtDate(detail.payment_confirmed_at)}</p>
          )}

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
    </div>
  );
}
