// ─────────────────────────────────────────────────────────────────────────────
// Orders Tickets view — Phase 8.5
// The Orders side of the handoff IS the packing board (extended in 8.3), not
// a separate collection — this view surfaces it for Orders Clerk / QA Manager /
// Responsible Pharmacist, who don't use the packer/supervisor floor screens.
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import { ShieldCheck, Stethoscope, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import {
  TopBar, DataTable, Modal, FormGroup, Textarea,
  BtnPrimary, BtnSecondary, BtnDanger, Badge, LoadingState, EmptyState, fmtDate,
} from "../components/UI";

const STATUS_COLOR = {
  queued: "gray", packing: "blue", ready: "amber", collected: "teal",
  complete: "green", incomplete: "orange", cancelled: "red", cleared: "gray",
};

export default function OrdersTickets() {
  const { can } = useAuth();
  const canOrders = can("tickets.orders");
  const canQa     = can("tickets.qa_approve");
  const canRp     = can("tickets.rp_approve");

  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/packing/board");
      setEntries(r.data.entries || []);
    } catch { toast.error("Failed to load orders tickets"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const [detail, setDetail] = useState(null);
  const [reasonModal, setReasonModal] = useState(null); // "incomplete" | "cancel"
  const [reason, setReason] = useState("");

  const act = async (path, order_id, extra = {}) => {
    setBusyId(order_id);
    try {
      await api.put(`/api/packing/${path}`, { order_id, ...extra });
      toast.success("Updated");
      setDetail(null); setReasonModal(null); setReason("");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Action failed"); }
    finally { setBusyId(null); }
  };

  const submitReason = () => {
    if (!reason.trim() && reasonModal === "incomplete") return toast.error("A reason is required");
    act(reasonModal, detail.order_id, { reason: reason.trim() || undefined });
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Orders Tickets" subtitle="Open → Assigned → Work In Progress → Ready for Inspection → Complete" onRefresh={load} />
      <main className="flex-1 overflow-y-auto p-6">
        {loading ? <LoadingState /> : entries.length === 0 ? (
          <EmptyState message="No active orders on the board." />
        ) : (
          <DataTable
            data={entries}
            onRowClick={setDetail}
            columns={[
              { accessorKey: "customer_name", header: "Customer", cell: ({ row: { original: e } }) => (
                <div><p className="font-medium text-gray-900">{e.customer_name}</p><p className="text-[10px] font-mono text-gray-400">{e.ps_num}</p></div>
              ) },
              { id: "status", header: "Stage", cell: ({ row: { original: e } }) => <Badge color={STATUS_COLOR[e.status]}>{e.status?.replace(/_/g, " ")}</Badge> },
              { accessorKey: "packer_name", header: "Packer", cell: ({ row: { original: e } }) => e.packer_name || <span className="text-gray-300">—</span> },
              { id: "qa", header: "QA", cell: ({ row: { original: e } }) => e.qa_approved_at
                ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />{e.qa_approved_by}</span>
                : <span className="text-xs text-gray-400">Pending</span> },
              { id: "rp", header: "RP", cell: ({ row: { original: e } }) => e.rp_approved_at
                ? <span className="text-xs text-green-600 flex items-center gap-1"><CheckCircle2 size={12} />{e.rp_approved_by}</span>
                : <span className="text-xs text-gray-400">Pending</span> },
              { accessorKey: "queued_at", header: "Queued", cell: ({ row: { original: e } }) => <span className="text-xs text-gray-400">{fmtDate(e.queued_at)}</span> },
            ]}
          />
        )}
      </main>

      {detail && (
        <Modal title={`${detail.customer_name} — ${detail.ps_num}`} onClose={() => setDetail(null)}>
          <div className="flex items-center gap-2 mb-4">
            <Badge color={STATUS_COLOR[detail.status]}>{detail.status?.replace(/_/g, " ")}</Badge>
            {detail.total_units != null && <span className="text-xs text-gray-400">{detail.total_units} units</span>}
          </div>

          <div className="border border-gray-100 rounded-xl divide-y divide-gray-100 mb-4">
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><ShieldCheck size={13} />QA Manager approval</span>
              {detail.qa_approved_at ? (
                <span className="text-xs text-green-600">{detail.qa_approved_by} — {fmtDate(detail.qa_approved_at)}</span>
              ) : detail.status === "ready" && canQa ? (
                <BtnPrimary size="sm" onClick={() => act("qa-approve", detail.order_id)} loading={busyId === detail.order_id}>Approve</BtnPrimary>
              ) : <span className="text-xs text-gray-400">Pending</span>}
            </div>
            <div className="px-3 py-2 flex items-center justify-between">
              <span className="text-xs text-gray-500 flex items-center gap-1.5"><Stethoscope size={13} />Responsible Pharmacist approval</span>
              {detail.rp_approved_at ? (
                <span className="text-xs text-green-600">{detail.rp_approved_by} — {fmtDate(detail.rp_approved_at)}</span>
              ) : detail.status === "ready" && canRp ? (
                <BtnPrimary size="sm" onClick={() => act("rp-approve", detail.order_id)} loading={busyId === detail.order_id}>Approve</BtnPrimary>
              ) : <span className="text-xs text-gray-400">Pending</span>}
            </div>
          </div>

          {detail.incomplete_reason && (
            <p className="text-xs text-amber-600 mb-4 flex items-center gap-1"><AlertTriangle size={12} />{detail.incomplete_reason}</p>
          )}

          {canOrders && !["complete", "incomplete", "cancelled", "collected", "cleared"].includes(detail.status) && (
            <div className="flex justify-between gap-2 border-t border-gray-100 pt-3">
              <div className="flex gap-2">
                <BtnSecondary size="sm" onClick={() => { setReasonModal("incomplete"); setReason(""); }}>Mark Incomplete</BtnSecondary>
                <BtnDanger onClick={() => { setReasonModal("cancel"); setReason(""); }}><XCircle size={12} />Cancel</BtnDanger>
              </div>
              {detail.status === "ready" && detail.qa_approved_at && detail.rp_approved_at && (
                <BtnPrimary onClick={() => act("complete", detail.order_id)} loading={busyId === detail.order_id}>Mark Complete</BtnPrimary>
              )}
            </div>
          )}
        </Modal>
      )}

      {reasonModal && (
        <Modal title={reasonModal === "incomplete" ? "Mark Incomplete" : "Cancel Order"} onClose={() => setReasonModal(null)}>
          <FormGroup label="Reason" required={reasonModal === "incomplete"}>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
              placeholder={reasonModal === "incomplete" ? "Why is this order incomplete? Sales will relay this to the client." : "Optional — why is this being cancelled?"} />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setReasonModal(null)}>Back</BtnSecondary>
            <BtnDanger onClick={submitReason} loading={busyId === detail?.order_id}>
              {reasonModal === "incomplete" ? "Mark Incomplete" : "Cancel Order"}
            </BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}
