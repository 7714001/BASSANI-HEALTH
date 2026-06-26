// ─────────────────────────────────────────────────────────────────────────────
// Orders Tickets view — Phase 8.8
// Full-page detail with strictly linear role-gated pipeline.
// orders_clerk: queued → packing → ready → complete / incomplete
// qa_manager: QA Approve (when ready)
// responsible_pharmacist: RP Approve (when ready)
// tickets.manage: Override Stage
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import {
  ShieldCheck, Stethoscope, CheckCircle2, XCircle,
  AlertTriangle, Package, Clock,
} from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Select, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger, Badge, LoadingState, EmptyState, fmtDate,
} from "../components/UI";

const STATUS_LABEL = {
  queued:     "Queued",
  packing:    "Packing In Progress",
  ready:      "Ready for Inspection",
  collected:  "Collected",
  complete:   "Complete",
  incomplete: "Incomplete",
  cancelled:  "Cancelled",
  cleared:    "Cleared",
};
const STATUS_COLOR = {
  queued: "gray", packing: "blue", ready: "amber", collected: "teal",
  complete: "green", incomplete: "orange", cancelled: "red", cleared: "gray",
};
const TERMINAL = new Set(["complete", "incomplete", "cancelled", "collected", "cleared"]);
const ALL_STATUSES = ["queued", "packing", "ready", "collected", "complete", "incomplete", "cancelled", "cleared"];

export default function OrdersTickets() {
  const { can } = useAuth();
  const canOrders = can("tickets.orders");
  const canQa     = can("tickets.qa_approve");
  const canRp     = can("tickets.rp_approve");
  const canManage = can("tickets.manage");

  // ── List state ──────────────────────────────────────────────────────────────
  const [view, setView]       = useState("list");
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/packing/board");
      setEntries(r.data.entries || []);
    } catch { toast.error("Failed to load orders tickets"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // ── Detail state ────────────────────────────────────────────────────────────
  const [detail, setDetail]               = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busyId, setBusyId]               = useState(null);
  const [incompleteModal, setIncompleteModal]   = useState(false);
  const [incompleteReason, setIncompleteReason] = useState("");
  const [overrideStatus, setOverrideStatus]     = useState("");

  const openDetail = async (entry) => {
    setDetail(null);
    setDetailLoading(true);
    setView("detail");
    try {
      const r = await api.get(`/api/packing/entry/${entry.order_id}`);
      setDetail(r.data);
      setOverrideStatus(r.data.status);
    } catch {
      toast.error("Failed to load order");
      setView("list");
    } finally {
      setDetailLoading(false);
    }
  };

  const refreshDetail = async (order_id) => {
    try {
      const r = await api.get(`/api/packing/entry/${order_id}`);
      setDetail(r.data);
      setOverrideStatus(r.data.status);
    } catch { toast.error("Failed to refresh order"); }
    load(); // silently refresh list in background
  };

  const act = async (path, order_id, extra = {}) => {
    setBusyId(order_id);
    try {
      await api.put(`/api/packing/${path}`, { order_id, ...extra });
      toast.success("Updated");
      await refreshDetail(order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    finally { setBusyId(null); }
  };

  const submitIncomplete = async () => {
    if (!incompleteReason.trim()) return toast.error("A reason is required");
    setBusyId(detail.order_id);
    try {
      await api.put("/api/packing/incomplete", { order_id: detail.order_id, reason: incompleteReason.trim() });
      toast.success("Marked incomplete");
      setIncompleteModal(false);
      setIncompleteReason("");
      await refreshDetail(detail.order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    finally { setBusyId(null); }
  };

  const submitOverride = async () => {
    setBusyId(detail.order_id);
    try {
      await api.put("/api/packing/override-status", { order_id: detail.order_id, status: overrideStatus });
      toast.success("Stage overridden");
      await refreshDetail(detail.order_id);
    } catch (e) { toast.error(e.response?.data?.detail || "Override failed"); }
    finally { setBusyId(null); }
  };


  // ── Detail — full-page view ─────────────────────────────────────────────────
  if (view === "detail") {
    const isTerminal   = detail ? TERMINAL.has(detail.status) : false;
    const bothApproved = !!(detail?.qa_approved_at && detail?.rp_approved_at);

    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-slate-50">
        <TopBar
          title={detail?.customer_name || "Loading…"}
          subtitle={detail ? `${detail.ps_num} — ${STATUS_LABEL[detail.status] || detail.status}` : ""}
          actions={
            <BtnSecondary onClick={() => { setDetail(null); setView("list"); }}>
              ← Back to Tickets
            </BtnSecondary>
          }
        />

        {detailLoading || !detail ? (
          <div className="flex-1 flex items-center justify-center"><LoadingState /></div>
        ) : (
          <main className="flex-1 overflow-y-auto p-6">
            <div className="max-w-7xl mx-auto">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">

                {/* ── Left: Order document ── */}
                <div className="lg:col-span-2 space-y-4">
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">

                    {/* Document header */}
                    <div className="p-6 border-b border-gray-100">
                      <div className="flex items-start justify-between mb-5">
                        <div>
                          <h2 className="text-2xl font-bold tracking-tight text-gray-900">
                            {(STATUS_LABEL[detail.status] || detail.status).toUpperCase()}
                          </h2>
                          <p className="text-sm font-mono text-gray-400 mt-0.5">{detail.ps_num}</p>
                        </div>
                        <div className="text-right">
                          <Badge color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Badge>
                          <p className="text-xs text-gray-400 mt-1.5">Queued {fmtDate(detail.queued_at)}</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-4 border-t border-gray-50">
                        <div>
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Customer</p>
                          <p className="text-sm font-semibold text-gray-900">{detail.customer_name}</p>
                          {detail.customer_city && (
                            <p className="text-xs text-gray-400 mt-0.5">{detail.customer_city}</p>
                          )}
                          {detail.is_reseller && detail.reseller_name && (
                            <p className="text-xs text-bassani-600 mt-0.5">via {detail.reseller_name}</p>
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {detail.inv_num && (
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-400 uppercase font-semibold tracking-wide">Invoice</span>
                              <span className="font-mono text-gray-700">{detail.inv_num}</span>
                            </div>
                          )}
                          {detail.dn_num && (
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-400 uppercase font-semibold tracking-wide">DN</span>
                              <span className="font-mono text-gray-700">{detail.dn_num}</span>
                            </div>
                          )}
                          {detail.packer_name && (
                            <div className="flex justify-between text-xs">
                              <span className="text-gray-400 uppercase font-semibold tracking-wide">Packer</span>
                              <span className="font-medium text-gray-700">{detail.packer_name}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-400 uppercase font-semibold tracking-wide">Warehouse</span>
                            <span className="font-medium text-gray-700">{detail.warehouse_name || "—"}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Items table */}
                    <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-100 bg-slate-50/50">
                          <th className="text-left p-3 pl-6 text-xs font-semibold text-gray-400 uppercase tracking-wide">Item</th>
                          <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Qty</th>
                          <th className="text-center p-3 pr-6 text-xs font-semibold text-gray-400 uppercase tracking-wide w-20">Packed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(detail.items || []).map((item, i) => {
                          const ticked = detail.item_ticks?.[item.sku];
                          return (
                            <tr key={i} className="border-b border-gray-50 hover:bg-slate-50/30">
                              <td className="p-3 pl-6">
                                <p className="text-sm font-medium text-gray-900">{item.name || item.description || item.sku}</p>
                                {item.sku && (
                                  <p className="text-[10px] font-mono text-gray-400 mt-0.5">{item.sku}</p>
                                )}
                              </td>
                              <td className="p-3 text-center text-sm text-gray-600">
                                {item.qty ?? item.product_uom_qty ?? "—"}
                              </td>
                              <td className="p-3 pr-6 text-center">
                                {ticked
                                  ? <CheckCircle2 size={16} className="text-green-500 mx-auto" />
                                  : <XCircle size={16} className="text-gray-200 mx-auto" />}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    </div>

                    {/* Notes / incomplete reason */}
                    {(detail.notes || detail.incomplete_reason) && (
                      <div className="p-6 border-t border-gray-100 space-y-3">
                        {detail.notes && (
                          <div>
                            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Notes</p>
                            <p className="text-sm text-gray-600">{detail.notes}</p>
                          </div>
                        )}
                        {detail.incomplete_reason && (
                          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl p-3">
                            <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                            <div>
                              <p className="text-xs font-semibold text-amber-700">Incomplete reason</p>
                              <p className="text-sm text-amber-600 mt-0.5">{detail.incomplete_reason}</p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {/* ── Right sidebar ── */}
                <div className="space-y-4">

                  {/* Status + timestamps */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                    <div className="flex flex-wrap gap-2 items-center">
                      <Badge color={STATUS_COLOR[detail.status]}>{STATUS_LABEL[detail.status] || detail.status}</Badge>
                      {detail.total_units != null && (
                        <span className="text-xs text-gray-400">{detail.total_units} unit{detail.total_units !== 1 ? "s" : ""}</span>
                      )}
                    </div>
                    <div className="pt-2 border-t border-gray-100 space-y-1.5">
                      {[
                        { label: "Queued",     at: detail.queued_at },
                        { label: "Packing",    at: detail.assigned_at },
                        { label: "Ready",      at: detail.ready_at },
                        { label: "Completed",  at: detail.completed_at },
                        { label: "Incomplete", at: detail.incomplete_at },
                      ].filter(e => e.at).map((e, i) => (
                        <div key={i} className="flex items-center gap-1.5 text-xs">
                          <Clock size={10} className="text-gray-300 shrink-0" />
                          <span className="text-gray-500 font-medium">{e.label}:</span>
                          <span className="text-gray-400">{fmtDate(e.at)}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* QA + RP approval status */}
                  <div className="bg-white rounded-2xl shadow-sm border border-gray-100 divide-y divide-gray-100">
                    <div className="px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500 flex items-center gap-1.5 shrink-0">
                        <ShieldCheck size={13} />QA
                      </span>
                      {detail.qa_approved_at
                        ? <span className="text-xs text-green-600 text-right">{detail.qa_approved_by} — {fmtDate(detail.qa_approved_at)}</span>
                        : <span className="text-xs text-gray-400">Pending</span>}
                    </div>
                    <div className="px-4 py-3 flex items-center justify-between gap-3">
                      <span className="text-xs text-gray-500 flex items-center gap-1.5 shrink-0">
                        <Stethoscope size={13} />RP
                      </span>
                      {detail.rp_approved_at
                        ? <span className="text-xs text-green-600 text-right">{detail.rp_approved_by} — {fmtDate(detail.rp_approved_at)}</span>
                        : <span className="text-xs text-gray-400">Pending</span>}
                    </div>
                  </div>

                  {/* Role-gated action cards */}
                  {!isTerminal && (
                    <div className="space-y-3">

                      {/* orders_clerk: queued → packing */}
                      {canOrders && detail.status === "queued" && (
                        <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
                          <p className="text-xs text-blue-700 mb-3">
                            Move this order to active packing — the packer will see it on the floor board.
                          </p>
                          <BtnPrimary
                            onClick={() => act("mark-packing", detail.order_id)}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            <Package size={13} />Mark as Packing
                          </BtnPrimary>
                        </div>
                      )}

                      {/* orders_clerk: packing → ready */}
                      {canOrders && detail.status === "packing" && (
                        <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4">
                          <p className="text-xs text-amber-700 mb-3">
                            Packing done? Move to Ready for Inspection — QA and RP will then review and sign off.
                          </p>
                          <BtnPrimary
                            onClick={() => act("mark-ready", detail.order_id)}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            <CheckCircle2 size={13} />Mark as Ready
                          </BtnPrimary>
                        </div>
                      )}

                      {/* orders_clerk: ready → complete (only once both approved) */}
                      {canOrders && detail.status === "ready" && (
                        <div className={`rounded-2xl p-4 ${bothApproved ? "bg-green-50 border border-green-100" : "bg-white shadow-sm border border-gray-100"}`}>
                          {bothApproved ? (
                            <>
                              <p className="text-xs text-green-700 mb-3">
                                Both QA and RP have signed off. Complete this order.
                              </p>
                              <BtnPrimary
                                onClick={() => act("complete", detail.order_id)}
                                loading={busyId === detail.order_id}
                                className="w-full justify-center"
                              >
                                <CheckCircle2 size={13} />Mark Complete
                              </BtnPrimary>
                            </>
                          ) : (
                            <div className="flex items-start gap-2">
                              <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                              <p className="text-xs text-gray-500">
                                Waiting for QA and RP to approve before this order can be completed.
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* orders_clerk: mark incomplete (packing or ready) */}
                      {canOrders && ["packing", "ready"].includes(detail.status) && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                          <p className="text-xs text-gray-400 mb-3">
                            Something wrong? Flag this order so Sales can contact the client.
                          </p>
                          <BtnSecondary
                            onClick={() => { setIncompleteReason(""); setIncompleteModal(true); }}
                            className="w-full justify-center text-amber-600 border-amber-200 hover:bg-amber-50"
                          >
                            <AlertTriangle size={13} />Mark Incomplete
                          </BtnSecondary>
                        </div>
                      )}

                      {/* qa_manager: approve when ready */}
                      {canQa && detail.status === "ready" && !detail.qa_approved_at && (
                        <div className="bg-indigo-50 border border-indigo-100 rounded-2xl p-4">
                          <p className="text-xs text-indigo-700 mb-3">
                            Review the packed order and confirm QA sign-off.
                          </p>
                          <BtnPrimary
                            onClick={() => act("qa-approve", detail.order_id)}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            <ShieldCheck size={13} />QA Approve
                          </BtnPrimary>
                        </div>
                      )}

                      {/* responsible_pharmacist: approve when ready */}
                      {canRp && detail.status === "ready" && !detail.rp_approved_at && (
                        <div className="bg-purple-50 border border-purple-100 rounded-2xl p-4">
                          <p className="text-xs text-purple-700 mb-3">
                            Review and provide Responsible Pharmacist sign-off.
                          </p>
                          <BtnPrimary
                            onClick={() => act("rp-approve", detail.order_id)}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            <Stethoscope size={13} />RP Approve
                          </BtnPrimary>
                        </div>
                      )}

                      {/* Override stage (tickets.manage only) */}
                      {canManage && (
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
                          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Override Stage</p>
                          <FormGroup label="Stage">
                            <Select value={overrideStatus} onChange={e => setOverrideStatus(e.target.value)}>
                              {ALL_STATUSES.map(s => (
                                <option key={s} value={s}>{STATUS_LABEL[s]}</option>
                              ))}
                            </Select>
                          </FormGroup>
                          <BtnPrimary
                            onClick={submitOverride}
                            loading={busyId === detail.order_id}
                            className="w-full justify-center"
                          >
                            Save
                          </BtnPrimary>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </main>
        )}

        {/* Incomplete reason modal overlays the detail page */}
        {incompleteModal && (
          <Modal title="Mark Incomplete" onClose={() => setIncompleteModal(false)}>
            <p className="text-xs text-gray-500 mb-4">
              Sales will relay this reason to the client when following up on the order.
            </p>
            <FormGroup label="Reason" required>
              <Textarea
                value={incompleteReason}
                onChange={e => setIncompleteReason(e.target.value)}
                rows={3}
                placeholder="e.g. Item X out of stock — awaiting restock from supplier"
                autoFocus
              />
            </FormGroup>
            <div className="flex justify-end gap-2 mt-4">
              <BtnSecondary onClick={() => setIncompleteModal(false)}>Cancel</BtnSecondary>
              <BtnDanger onClick={submitIncomplete} loading={busyId === detail?.order_id}>
                Mark Incomplete
              </BtnDanger>
            </div>
          </Modal>
        )}
      </div>
    );
  }


  // ── List view ───────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Orders Tickets"
        subtitle="Queued → Packing → Ready → QA + RP Approved → Complete"
        onRefresh={load}
      />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? <LoadingState /> : entries.length === 0 ? (
          <EmptyState message="No active orders on the board." />
        ) : (
          <DataTable
            data={entries}
            onRowClick={openDetail}
            columns={[
              { accessorKey: "customer_name", header: "Customer", cell: ({ row: { original: e } }) => (
                <div>
                  <p className="font-medium text-gray-900">{e.customer_name}</p>
                  <p className="text-[10px] font-mono text-gray-400">{e.ps_num}</p>
                </div>
              )},
              { id: "status", header: "Stage", cell: ({ row: { original: e } }) => (
                <Badge color={STATUS_COLOR[e.status]}>{STATUS_LABEL[e.status] || e.status}</Badge>
              )},
              { accessorKey: "packer_name", header: "Packer", cell: ({ row: { original: e } }) =>
                e.packer_name || <span className="text-gray-300">—</span>
              },
              { id: "qa", header: "QA", cell: ({ row: { original: e } }) =>
                e.qa_approved_at
                  ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />{e.qa_approved_by}</span>
                  : <span className="text-xs text-gray-400">Pending</span>
              },
              { id: "rp", header: "RP", cell: ({ row: { original: e } }) =>
                e.rp_approved_at
                  ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />{e.rp_approved_by}</span>
                  : <span className="text-xs text-gray-400">Pending</span>
              },
              { accessorKey: "queued_at", header: "Queued", cell: ({ row: { original: e } }) =>
                <span className="text-xs text-gray-400">{fmtDate(e.queued_at)}</span>
              },
            ]}
          />
        )}
      </main>
    </div>
  );
}
