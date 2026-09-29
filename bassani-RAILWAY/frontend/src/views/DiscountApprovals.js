// Discount Approvals — Phase 8.61. Approval queue for staff discount
// requests raised from the Sales Ticket quote builder. Every request is
// decided manually here: Approve (apply the requested %), Reject (leave the
// quote at normal pricing), or Counter (apply a different % than requested).
// Nobody can decide their own request — enforced server-side regardless of
// role, including super_admin.
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { CheckCircle2, XCircle, PenLine, ChevronDown, ChevronRight, Percent, ExternalLink } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import {
  TopBar, Modal, FormGroup, Textarea, BtnSecondary, BtnDanger, BtnPrimary, Badge,
  EmptyState, LoadingState, FilterPill, ChipRow, fmtDateTime,
} from "../components/UI";

const STATUS_LABEL = { pending: "Pending", approved: "Approved", countered: "Countered", rejected: "Rejected", cancelled: "Cancelled" };
const STATUS_COLOR = { pending: "amber", approved: "green", countered: "teal", rejected: "red", cancelled: "gray" };

const fmtR = (n) => `R ${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function RequestRow({ req, expanded, onToggle, onApprove, onReject, onCounter, navigate }) {
  const allLines = req.lines || [];
  // Every line on the order is stored (2026-09-28), not just the discounted
  // ones — requested_pct is 0 for a line the requester left alone. The row
  // summary and the modal actions below only ever care about the ones
  // actually asked about.
  const discountedLines = allLines.filter(l => (l.requested_pct || 0) > 0);
  const n = discountedLines.length;
  const avgPct = n > 0 ? discountedLines.reduce((s, l) => s + (l.requested_pct || 0), 0) / n : 0;
  return (
    <>
      <tr className="border-b border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => onToggle(req.id)}>
        <td className="p-3 w-8 text-gray-400">{expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}</td>
        <td className="p-3 text-sm font-mono text-gray-900">{req.order_name}</td>
        <td className="p-3 text-sm text-gray-700">{req.customer_name || "—"}</td>
        <td className="p-3 text-sm text-gray-600">{req.requested_by?.name || "—"}</td>
        <td className="p-3 text-sm text-gray-600 text-center">{n} of {allLines.length} line{allLines.length !== 1 ? "s" : ""}, avg {avgPct.toFixed(1)}%</td>
        <td className="p-3 text-xs text-gray-400 whitespace-nowrap">{fmtDateTime(req.created_at)}</td>
        <td className="p-3"><Badge color={STATUS_COLOR[req.status] || "gray"}>{STATUS_LABEL[req.status] || req.status}</Badge></td>
        <td className="p-3 text-right whitespace-nowrap" onClick={e => e.stopPropagation()}>
          {req.status === "pending" && (
            <div className="flex items-center justify-end gap-1">
              <button onClick={() => onApprove(req)} className="text-green-600 hover:text-green-800 p-1.5 rounded-lg hover:bg-green-50" title="Approve">
                <CheckCircle2 size={14} />
              </button>
              <button onClick={() => onCounter(req)} className="text-teal-600 hover:text-teal-800 p-1.5 rounded-lg hover:bg-teal-50" title="Counter">
                <PenLine size={14} />
              </button>
              <button onClick={() => onReject(req)} className="text-red-500 hover:text-red-700 p-1.5 rounded-lg hover:bg-red-50" title="Reject">
                <XCircle size={14} />
              </button>
            </div>
          )}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-50/60 border-b border-gray-100">
          <td colSpan={8} className="p-4">
            <div className="flex items-start justify-between gap-4 mb-3">
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Reason</p>
                <p className="text-sm text-gray-700">{req.reason || "Not provided"}</p>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                {req.order_total != null && (
                  <div className="text-right">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Order Total</p>
                    <p className="text-sm font-semibold text-gray-900">{fmtR(req.order_total)}</p>
                  </div>
                )}
                <button
                  onClick={() => navigate("/tickets/sales", { state: { openTicketId: req.ticket_id } })}
                  className="inline-flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-800 hover:underline"
                >
                  Open ticket <ExternalLink size={11} />
                </button>
              </div>
            </div>
            {/* Every line on the order — the discounted ones stand out so the
                approver can judge the request against the full quote, not
                just the lines asked about in isolation. */}
            <table className="w-full text-xs bg-white border border-gray-100 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left p-2 pl-3 font-semibold text-gray-400 uppercase">Product</th>
                  <th className="text-right p-2 font-semibold text-gray-400 uppercase">Qty</th>
                  <th className="text-right p-2 font-semibold text-gray-400 uppercase">Unit Price</th>
                  <th className="text-right p-2 pr-3 font-semibold text-gray-400 uppercase">Discount</th>
                </tr>
              </thead>
              <tbody>
                {allLines.map((l, i) => {
                  const isRequested = (l.requested_pct || 0) > 0;
                  return (
                    <tr key={i} className={`border-t border-gray-50 ${isRequested ? "bg-amber-50/60" : ""}`}>
                      <td className="p-2 pl-3 text-gray-700">{l.product_name}</td>
                      <td className="p-2 text-right text-gray-500">{l.qty}</td>
                      <td className="p-2 text-right text-gray-500">{fmtR(l.unit_price)}</td>
                      <td className="p-2 pr-3 text-right">
                        {isRequested
                          ? <span className="font-semibold text-amber-700">{Number(l.requested_pct).toFixed(2)}% requested</span>
                          : <span className="text-gray-300">No discount requested</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {req.decision && (
              <p className="text-xs text-gray-400 mt-3">
                {STATUS_LABEL[req.status]} by {req.decision.by?.name || "—"} on {fmtDateTime(req.decision.at)}
                {req.decision.note ? ` — "${req.decision.note}"` : ""}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export default function DiscountApprovals() {
  const navigate = useNavigate();
  const location = useLocation();
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [expandedId, setExpandedId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get("/api/discount-requests/", { params: statusFilter === "all" ? {} : { status: statusFilter } });
      setRequests(r.data.requests || []);
    } catch { toast.error("Failed to load discount requests"); }
    finally { setLoading(false); }
  }, [statusFilter]);
  useEffect(() => { load(); }, [load]);

  // Auto-expand a specific request when arriving via an email deep link
  // (?request=<id> — a genuine URL query param, since this must survive a
  // fresh page load from an external email, not just in-app navigation).
  useEffect(() => {
    const rid = new URLSearchParams(location.search).get("request");
    if (rid) { setStatusFilter("all"); setExpandedId(rid); }
  }, []); // eslint-disable-line

  const toggle = (id) => setExpandedId(prev => prev === id ? null : id);

  // ── Approve ──
  const [approveTarget, setApproveTarget] = useState(null);
  const [approveNote, setApproveNote] = useState("");
  const [approving, setApproving] = useState(false);
  const doApprove = async () => {
    setApproving(true);
    try {
      await api.post(`/api/discount-requests/${approveTarget.id}/approve`, { note: approveNote || undefined });
      toast.success("Discount approved");
      setApproveTarget(null); setApproveNote("");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not approve"); }
    finally { setApproving(false); }
  };

  // ── Reject ──
  const [rejectTarget, setRejectTarget] = useState(null);
  const [rejectNote, setRejectNote] = useState("");
  const [rejecting, setRejecting] = useState(false);
  const doReject = async () => {
    setRejecting(true);
    try {
      await api.post(`/api/discount-requests/${rejectTarget.id}/reject`, { note: rejectNote || undefined });
      toast.success("Discount request rejected");
      setRejectTarget(null); setRejectNote("");
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not reject"); }
    finally { setRejecting(false); }
  };

  // ── Counter ──
  const [counterTarget, setCounterTarget] = useState(null);
  const [counterLines, setCounterLines] = useState([]);
  const [counterNote, setCounterNote] = useState("");
  const [countering, setCountering] = useState(false);
  const openCounter = (req) => {
    setCounterTarget(req);
    // Only the lines actually asked about (requested_pct > 0) are
    // counterable — the rest of req.lines is full-order context only.
    setCounterLines((req.lines || []).filter(l => (l.requested_pct || 0) > 0)
      .map(l => ({ product_id: l.product_id, product_name: l.product_name, approved_pct: l.requested_pct })));
    setCounterNote("");
  };
  const doCounter = async () => {
    setCountering(true);
    try {
      await api.post(`/api/discount-requests/${counterTarget.id}/counter`, {
        lines: counterLines.map(l => ({ product_id: l.product_id, approved_pct: Number(l.approved_pct) })),
        note: counterNote || undefined,
      });
      toast.success("Counter-offer applied");
      setCounterTarget(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not apply counter-offer"); }
    finally { setCountering(false); }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar title="Discount Approvals" subtitle="Approve, reject or counter staff discount requests" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-4">
          <ChipRow>
            {["pending", "approved", "countered", "rejected", "cancelled", "all"].map(s => (
              <FilterPill key={s} label={s === "all" ? "All" : STATUS_LABEL[s]} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
            ))}
          </ChipRow>
        </div>
        {loading ? <LoadingState /> : requests.length === 0 ? (
          <EmptyState icon={Percent} heading="No requests" message="Nothing matches this filter." />
        ) : (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100 bg-slate-50/50">
                  <th className="p-3 w-8"></th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Quote</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Customer</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Requested By</th>
                  <th className="text-center p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Lines</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Requested</th>
                  <th className="text-left p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="text-right p-3 text-xs font-semibold text-gray-400 uppercase tracking-wide">Actions</th>
                </tr>
              </thead>
              <tbody>
                {requests.map(req => (
                  <RequestRow
                    key={req.id} req={req} expanded={expandedId === req.id} onToggle={toggle}
                    onApprove={setApproveTarget} onReject={setRejectTarget} onCounter={openCounter}
                    navigate={navigate}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {approveTarget && (
        <Modal title="Approve Discount" onClose={() => setApproveTarget(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Apply the requested discount to {approveTarget.order_name} exactly as requested?
          </p>
          <FormGroup label="Note (optional)">
            <Textarea value={approveNote} onChange={e => setApproveNote(e.target.value)} rows={2} />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setApproveTarget(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doApprove} disabled={approving}>{approving ? "Approving…" : "Approve"}</BtnPrimary>
          </div>
        </Modal>
      )}

      {rejectTarget && (
        <Modal title="Reject Discount" onClose={() => setRejectTarget(null)}>
          <p className="text-sm text-gray-600 mb-4">
            The quote for {rejectTarget.order_name} will stay at normal pricing. This cannot be undone from here
            — the requester would need to submit a new request.
          </p>
          <FormGroup label="Note (optional)">
            <Textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2} />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setRejectTarget(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doReject} disabled={rejecting}>{rejecting ? "Rejecting…" : "Reject"}</BtnDanger>
          </div>
        </Modal>
      )}

      {counterTarget && (
        <Modal title="Counter-Offer" onClose={() => setCounterTarget(null)}>
          <p className="text-sm text-gray-600 mb-4">
            Apply a different discount % than requested for {counterTarget.order_name}. This is applied
            immediately, same as an approval.
          </p>
          <div className="max-h-64 overflow-y-auto border border-gray-100 rounded-lg mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left p-2 pl-3 text-xs font-semibold text-gray-400 uppercase">Product</th>
                  <th className="text-right p-2 text-xs font-semibold text-gray-400 uppercase w-20">Requested</th>
                  <th className="text-right p-2 pr-3 text-xs font-semibold text-gray-400 uppercase w-24">Approved %</th>
                </tr>
              </thead>
              <tbody>
                {counterLines.map((l, i) => {
                  const original = counterTarget.lines.find(x => x.product_id === l.product_id);
                  return (
                    <tr key={l.product_id} className="border-b border-gray-50 last:border-0">
                      <td className="p-2 pl-3 text-gray-800">{l.product_name}</td>
                      <td className="p-2 text-right text-gray-500">{Number(original?.requested_pct || 0).toFixed(2)}%</td>
                      <td className="p-2 pr-3">
                        <input
                          type="number" min="0" max="100" step="0.01" value={l.approved_pct}
                          onChange={e => setCounterLines(ls => ls.map((x, xi) => xi === i ? { ...x, approved_pct: e.target.value } : x))}
                          className="w-full text-right text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-bassani-400"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <FormGroup label="Note (optional)">
            <Textarea value={counterNote} onChange={e => setCounterNote(e.target.value)} rows={2}
              placeholder="e.g. Approved at a lower rate given order size" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCounterTarget(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doCounter} disabled={countering}>{countering ? "Applying…" : "Apply Counter-Offer"}</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );
}
