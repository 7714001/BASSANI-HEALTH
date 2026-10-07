// Discount Request: full-page view of one request (2026-10-07). An
// alternative to expanding the row inline on Discount Approvals, built so
// Bassani can choose which they prefer. The body (totals, cost rollup, lines)
// and the Approve / Counter / Reject popups are the same shared pieces the
// list uses, so the two views can never disagree.
import { useState, useEffect, useCallback } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, CheckCircle2, XCircle, PenLine, ExternalLink, Percent } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { useAuth } from "../AuthContext";
import {
  TopBar, Badge, BtnPrimary, BtnSecondary, BtnDanger, LoadingState, EmptyState, fmtDateTime,
  DISCOUNT_STATUS_LABEL as STATUS_LABEL, DISCOUNT_STATUS_COLOR as STATUS_COLOR, DiscountStatusKey,
} from "../components/UI";
import { RequestDetailBody, BomMarginModal, useDiscountDecisions } from "./DiscountApprovals";

export default function DiscountRequestView() {
  const { requestId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [req, setReq] = useState(null);
  const [financial, setFinancial] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [bomLine, setBomLine] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await api.get(`/api/discount-requests/${requestId}`);
      setReq(r.data);
      setNotFound(false);
      api.get(`/api/discount-requests/${requestId}/financial-detail`)
        .then(f => setFinancial(f.data))
        .catch(() => toast.error("Could not load cost detail for this request"));
    } catch (e) {
      if (e.response?.status === 404 || e.response?.status === 400) setNotFound(true);
      else toast.error(e.response?.data?.detail || "Failed to load discount request");
    } finally { setLoading(false); }
  }, [requestId]);
  useEffect(() => { load(); }, [load]);

  const { openApprove, openReject, openCounter, modals } = useDiscountDecisions(load);

  const backToList = () => navigate("/tickets/discounts");
  // Nobody can decide their own request (enforced server-side); say so up
  // front instead of offering buttons that would only return an error.
  const isOwn = req && req.requested_by?.id === user?.id;
  const isPending = req?.status === "pending";

  const lines = req?.lines || [];
  const discounted = lines.filter(l => (l.requested_pct || 0) > 0);
  const removals = lines.filter(l => l.is_removal).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar
        title={req ? `Discount Request: ${req.order_name}` : "Discount Request"}
        subtitle={req ? req.customer_name || "" : ""}
        leftAction={
          <button onClick={backToList} aria-label="Back to Discount Approvals"
            className="p-1.5 rounded-md border border-gray-200 text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-all flex-shrink-0">
            <ArrowLeft size={16} />
          </button>
        }
        actions={req && (
          <BtnSecondary onClick={() => navigate("/tickets/sales", { state: { openTicketId: req.ticket_id } })}>
            <ExternalLink size={14} /><span className="hidden sm:inline">Open ticket</span>
          </BtnSecondary>
        )}
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-6xl mx-auto w-full">
          {loading && !req ? <LoadingState /> : notFound || !req ? (
            <EmptyState icon={Percent} heading="Request not found" message="This discount request doesn't exist or was removed." />
          ) : (
            <>
              {/* Summary + decision actions */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 mb-4">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-lg font-bold text-gray-900">{req.order_name}</span>
                      <Badge color={STATUS_COLOR[req.status] || "gray"}>{STATUS_LABEL[req.status] || req.status}</Badge>
                    </div>
                    <p className="text-sm text-gray-700">{req.customer_name || "Customer not set"}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      Requested by {req.requested_by?.name || "Unknown"} on {fmtDateTime(req.created_at)}
                    </p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {discounted.length} of {lines.length} line{lines.length !== 1 ? "s" : ""} discounted
                      {removals > 0 && `, discount removed on ${removals} line${removals !== 1 ? "s" : ""}`}
                    </p>
                  </div>
                  {isPending && (
                    isOwn ? (
                      <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 max-w-xs">
                        You raised this request, so someone else with Discount Approvals access must decide it.
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <BtnPrimary onClick={() => openApprove(req)}><CheckCircle2 size={14} />Approve</BtnPrimary>
                        <BtnSecondary onClick={() => openCounter(req)}><PenLine size={14} />Counter</BtnSecondary>
                        <BtnDanger onClick={() => openReject(req)}><XCircle size={14} />Reject</BtnDanger>
                      </div>
                    )
                  )}
                </div>

                <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Reason for the request</p>
                    <p className="text-sm text-gray-700">{req.reason || "Not provided"}</p>
                  </div>
                  {req.decision && (
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Decision</p>
                      <p className="text-sm text-gray-700">
                        {STATUS_LABEL[req.status] || req.status} by {req.decision.by?.name || "Unknown"} on {fmtDateTime(req.decision.at)}
                      </p>
                      {req.decision.note && <p className="text-sm text-gray-600 mt-1">"{req.decision.note}"</p>}
                    </div>
                  )}
                </div>
                <DiscountStatusKey className="mt-4 pt-3 border-t border-gray-100" />
              </div>

              {/* Same body as the inline expansion on the list */}
              <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
                <RequestDetailBody
                  req={req}
                  financial={financial}
                  onOpenBom={(line) => setBomLine({ requestId: req.id, line })}
                  navigate={navigate}
                  showHeader={false}
                  showDecision={false}
                />
              </div>
            </>
          )}
        </div>
      </main>

      {modals}
      {bomLine && (
        <BomMarginModal requestId={bomLine.requestId} line={bomLine.line} onClose={() => setBomLine(null)} />
      )}
    </div>
  );
}
