// Recurring Orders — Phase 8.46. Admin management view for recurring order
// schedules: pause/resume/cancel, and a per-schedule occurrence history.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { RefreshCw, Pause, Play, Ban, ExternalLink, ChevronDown, ChevronRight } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import {
  TopBar, Modal, BtnSecondary, BtnDanger, BtnPrimary, Badge,
  EmptyState, LoadingState, fmtDate,
} from "../components/UI";

const CADENCE_LABEL = { weekly: "Weekly", biweekly: "Biweekly", monthly: "Monthly" };
const STATUS_LABEL = { active: "Active", paused: "Paused", cancelled: "Cancelled", completed: "Completed" };
const STATUS_COLOR = { active: "green", paused: "amber", cancelled: "red", completed: "gray" };

function ScheduleRow({ sched, onAction, expanded, onToggle, occurrences, loadingOccurrences }) {
  const navigate = useNavigate();
  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
        <td className="p-3 w-8">
          <button onClick={() => onToggle(sched.id)} className="text-gray-400 hover:text-gray-600">
            {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          </button>
        </td>
        <td className="p-3 text-sm text-gray-900">{sched.customer_name || "—"}</td>
        <td className="p-3 text-sm text-gray-600">
          {CADENCE_LABEL[sched.cadence] || sched.cadence}
          {sched.reseller_name && <span className="block text-xs text-gray-400">via {sched.reseller_name}</span>}
        </td>
        <td className="p-3 text-sm text-gray-600 whitespace-nowrap">
          {sched.status === "active" ? fmtDate(sched.next_run_date) : "—"}
        </td>
        <td className="p-3 text-sm text-gray-600 text-center">{sched.occurrences_generated || 0}</td>
        <td className="p-3"><Badge color={STATUS_COLOR[sched.status] || "gray"}>{STATUS_LABEL[sched.status] || sched.status}</Badge></td>
        <td className="p-3 text-right whitespace-nowrap">
          {sched.status === "active" && (
            <button onClick={() => onAction("pause", sched)} className="text-amber-600 hover:text-amber-800 p-1.5 rounded-lg hover:bg-amber-50" title="Pause">
              <Pause size={14} />
            </button>
          )}
          {sched.status === "paused" && (
            <button onClick={() => onAction("resume", sched)} className="text-green-600 hover:text-green-800 p-1.5 rounded-lg hover:bg-green-50" title="Resume">
              <Play size={14} />
            </button>
          )}
          {(sched.status === "active" || sched.status === "paused") && (
            <button onClick={() => onAction("cancel", sched)} className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50" title="Cancel">
              <Ban size={14} />
            </button>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/60 border-b border-gray-100">
          <td colSpan={7} className="p-4">
            {loadingOccurrences ? (
              <p className="text-xs text-gray-400">Loading history…</p>
            ) : !occurrences || occurrences.length === 0 ? (
              <p className="text-xs text-gray-400">No occurrences generated yet.</p>
            ) : (
              <div className="space-y-1.5">
                {occurrences.map(t => (
                  <div key={t.id} className="flex items-center gap-3 text-xs">
                    <span className="text-gray-400 w-28 shrink-0">{fmtDate(t.scheduled_for)}</span>
                    <span className={`px-2 py-0.5 rounded-full font-medium shrink-0 ${
                      t.exit_status === "not_interested" ? "bg-gray-100 text-gray-500"
                      : t.exit_status === "cancelled" ? "bg-gray-100 text-gray-500"
                      : t.customer_accepted_at ? "bg-green-100 text-green-700"
                      : t.customer_declined_at ? "bg-gray-100 text-gray-500"
                      : "bg-amber-100 text-amber-700"
                    }`}>
                      {t.exit_status === "not_interested" ? "Declined"
                        : t.exit_status === "cancelled" ? "Skipped (no response)"
                        : t.needs_manual_confirm ? "Needs manual confirm"
                        : t.customer_accepted_at ? "Accepted"
                        : "Awaiting response"}
                    </span>
                    {t.order_id && (
                      <button
                        onClick={() => navigate(`/orders/${t.order_id}/passport`)}
                        className="text-bassani-700 hover:text-bassani-900 hover:underline font-medium flex items-center gap-1"
                      >
                        #{t.order_id}
                        <ExternalLink size={10} className="text-bassani-400" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function RecurringOrders() {
  const [schedules, setSchedules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [occurrenceCache, setOccurrenceCache] = useState({});
  const [loadingOccurrences, setLoadingOccurrences] = useState(false);
  const [actionModal, setActionModal] = useState(null); // { type, sched }
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/recurring-orders");
      setSchedules(r.data.schedules || []);
    } catch {
      toast.error("Failed to load recurring order schedules");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggleExpand = async (id) => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    if (!occurrenceCache[id]) {
      setLoadingOccurrences(true);
      try {
        const r = await api.get(`/api/recurring-orders/${id}`);
        setOccurrenceCache(c => ({ ...c, [id]: r.data.occurrences || [] }));
      } catch {
        toast.error("Failed to load occurrence history");
      } finally {
        setLoadingOccurrences(false);
      }
    }
  };

  const runAction = async () => {
    if (!actionModal) return;
    const { type, sched } = actionModal;
    setActing(true);
    try {
      await api.post(`/api/recurring-orders/${sched.id}/${type}`);
      toast.success(
        type === "pause" ? "Schedule paused" : type === "resume" ? "Schedule resumed" : "Schedule cancelled"
      );
      setActionModal(null);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Action failed");
    } finally {
      setActing(false);
    }
  };

  const counts = schedules.reduce((acc, s) => {
    acc[s.status] = (acc[s.status] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title="Recurring Orders"
        actions={
          <BtnSecondary onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
            Refresh
          </BtnSecondary>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Active",    value: counts.active || 0,    color: "text-green-600" },
            { label: "Paused",    value: counts.paused || 0,    color: "text-amber-600" },
            { label: "Completed", value: counts.completed || 0, color: "text-gray-500" },
            { label: "Cancelled", value: counts.cancelled || 0, color: "text-gray-400" },
          ].map(s => (
            <div key={s.label} className="bg-white rounded-xl border border-gray-200 p-4">
              <p className="text-xs text-gray-400 uppercase font-semibold tracking-wide mb-1">{s.label}</p>
              <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            </div>
          ))}
        </div>

        {loading ? (
          <LoadingState />
        ) : schedules.length === 0 ? (
          <EmptyState
            heading="No recurring orders yet"
            message="Mark an order as recurring from its Sales Ticket to see it here."
          />
        ) : (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="p-3 w-8"></th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Customer</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Cadence</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Next Run</th>
                  <th className="text-center text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Occurrences</th>
                  <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-3 py-3">Status</th>
                  <th className="px-3 py-3"></th>
                </tr>
              </thead>
              <tbody>
                {schedules.map(s => (
                  <ScheduleRow
                    key={s.id}
                    sched={s}
                    expanded={expandedId === s.id}
                    onToggle={toggleExpand}
                    occurrences={occurrenceCache[s.id]}
                    loadingOccurrences={loadingOccurrences && expandedId === s.id}
                    onAction={(type, sched) => setActionModal({ type, sched })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {actionModal && (
        <Modal
          title={
            actionModal.type === "pause" ? "Pause Schedule"
            : actionModal.type === "resume" ? "Resume Schedule"
            : "Cancel Schedule"
          }
          onClose={() => setActionModal(null)}
        >
          <p className="text-sm text-gray-600 mb-4">
            {actionModal.type === "pause" && `Pause the recurring schedule for ${actionModal.sched.customer_name}? No further occurrences will be generated until it's resumed.`}
            {actionModal.type === "resume" && `Resume the recurring schedule for ${actionModal.sched.customer_name}? It will continue generating occurrences from its next scheduled date.`}
            {actionModal.type === "cancel" && `Cancel the recurring schedule for ${actionModal.sched.customer_name}? This cannot be undone — a new schedule would need to be set up from scratch.`}
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setActionModal(null)} disabled={acting}>Never mind</BtnSecondary>
            {actionModal.type === "cancel" ? (
              <BtnDanger onClick={runAction} loading={acting}>Cancel Schedule</BtnDanger>
            ) : (
              <BtnPrimary onClick={runAction} loading={acting}>
                {actionModal.type === "pause" ? "Pause" : "Resume"}
              </BtnPrimary>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
