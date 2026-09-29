// Discount Approvals — Phase 8.61. Approval queue for staff discount
// requests raised from the Sales Ticket quote builder. Every request is
// decided manually here: Approve (apply the requested %), Reject (leave the
// quote at normal pricing), or Counter (apply a different % than requested).
// Nobody can decide their own request — enforced server-side regardless of
// role, including super_admin.
//
// 8.63 additions: Cost Price + BOM/margin popup on the expanded line table
// (backed by GET /{id}/financial-detail and GET /{id}/bom/{product_id}, both
// degrading honestly to "not set"/"no BOM found" rather than a fabricated
// number — see discount_routes.py's live-probe note: 100% of Bassani's
// active products have no cost price in Odoo today), plus filters, a
// Group by Customer view, and an Excel export.
import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  CheckCircle2, XCircle, PenLine, ChevronDown, ChevronRight, Percent, ExternalLink,
  Download, Users, List as ListIcon, Loader2, Package,
} from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import {
  TopBar, Modal, FormGroup, Textarea, Input, BtnSecondary, BtnDanger, BtnPrimary, Badge,
  EmptyState, LoadingState, FilterPill, ChipRow, SearchBar, fmtDateTime, fmtDate,
  DISCOUNT_STATUS_LABEL as STATUS_LABEL, DISCOUNT_STATUS_COLOR as STATUS_COLOR, DiscountStatusKey,
} from "../components/UI";

const fmtR = (n) => `R ${Number(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtPct = (n) => `${Number(n || 0).toFixed(1)}%`;

// ── BOM / margin popup (8.63) ────────────────────────────────────────────────
// Opened from a line's Cost Price cell. Fetches on demand rather than eagerly
// for every line — most products have no BOM at all (live-probe confirmed:
// 2 of 147 recently-ordered products), so eagerly searching mrp.bom for
// every row would mostly be wasted calls.
function BomMarginModal({ requestId, line, onClose }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api.get(`/api/discount-requests/${requestId}/bom/${line.product_id}`)
      .then(r => { if (!cancelled) setData(r.data); })
      .catch(() => { if (!cancelled) toast.error("Could not load cost/BOM detail"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [requestId, line.product_id]);

  const pct = line.requested_pct || 0;
  const discountedPrice = line.unit_price * (1 - pct / 100);
  const cost = data?.cost_price;
  const costSet = data?.cost_set;
  const marginBefore = costSet ? line.unit_price - cost : null;
  const marginAfter = costSet ? discountedPrice - cost : null;
  const revenueImpact = (line.unit_price - discountedPrice) * line.qty;

  return (
    <Modal title={`Cost & Margin — ${line.product_name}`} onClose={onClose}>
      {loading ? <LoadingState /> : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Unit Price</p>
              <p className="font-semibold text-gray-900">{fmtR(line.unit_price)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Discounted Price ({fmtPct(pct)})</p>
              <p className="font-semibold text-gray-900">{fmtR(discountedPrice)}</p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Cost Price</p>
              <p className={`font-semibold ${costSet ? "text-gray-900" : "text-gray-400 italic"}`}>
                {costSet ? fmtR(cost) : "Not set in Odoo"}
              </p>
            </div>
            <div className="bg-gray-50 rounded-lg p-3">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Revenue Impact ({line.qty} units)</p>
              <p className="font-semibold text-red-600">-{fmtR(revenueImpact)}</p>
            </div>
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Margin</p>
            {costSet ? (
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div className="bg-green-50 border border-green-100 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide">Before Discount</p>
                  <p className="font-semibold text-green-800">{fmtR(marginBefore)} ({fmtPct(line.unit_price ? marginBefore / line.unit_price * 100 : 0)})</p>
                </div>
                <div className="bg-amber-50 border border-amber-100 rounded-lg p-3">
                  <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">After Discount</p>
                  <p className="font-semibold text-amber-800">{fmtR(marginAfter)} ({fmtPct(discountedPrice ? marginAfter / discountedPrice * 100 : 0)})</p>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic bg-gray-50 rounded-lg p-3">
                Cost price not set in Odoo for this product — margin can't be calculated.
              </p>
            )}
          </div>

          <div>
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Bill of Materials</p>
            {!data?.bom?.found ? (
              <p className="text-xs text-gray-400 italic bg-gray-50 rounded-lg p-3">
                No Bill of Materials found for this product in Odoo.
              </p>
            ) : (
              <>
                <table className="w-full text-xs border border-gray-100 rounded-lg overflow-hidden">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="text-left p-2 pl-3 font-semibold text-gray-400 uppercase">Component</th>
                      <th className="text-right p-2 font-semibold text-gray-400 uppercase">Qty / Unit</th>
                      <th className="text-right p-2 pr-3 font-semibold text-gray-400 uppercase">Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.bom.components.map((c, i) => (
                      <tr key={i} className="border-t border-gray-50">
                        <td className="p-2 pl-3 text-gray-700">{c.name || `#${c.product_id}`}</td>
                        <td className="p-2 text-right text-gray-500">{c.qty_per_unit}</td>
                        <td className="p-2 pr-3 text-right text-gray-500">{c.cost_set ? fmtR(c.unit_cost) : <span className="text-gray-300 italic">Not set</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="text-[11px] text-gray-400 mt-1.5">
                  {data.bom.total_component_cost != null
                    ? `Total component cost: ${fmtR(data.bom.total_component_cost)} (${data.bom.components_with_cost} of ${data.bom.components_total} components have a cost price set)`
                    : `No component cost prices set in Odoo (0 of ${data.bom.components_total} components).`}
                </p>
              </>
            )}
          </div>
        </div>
      )}
      <div className="flex justify-end mt-4">
        <BtnSecondary onClick={onClose}>Close</BtnSecondary>
      </div>
    </Modal>
  );
}

function RequestRow({ req, expanded, onToggle, onApprove, onReject, onCounter, navigate, financial, onOpenBom }) {
  const allLines = req.lines || [];
  // Every line on the order is stored (2026-09-28), not just the discounted
  // ones — requested_pct is 0 for a line the requester left alone. The row
  // summary and the modal actions below only ever care about the ones
  // actually asked about.
  const discountedLines = allLines.filter(l => (l.requested_pct || 0) > 0);
  const n = discountedLines.length;
  const avgPct = n > 0 ? discountedLines.reduce((s, l) => s + (l.requested_pct || 0), 0) / n : 0;
  // 8.63: once financial-detail has loaded, prefer its per-line cost_price
  // (looked up fresh from Odoo); render lines from it if available so the
  // Cost Price column has data, else fall back to the plain request lines.
  const linesToRender = financial?.lines || allLines;
  const rollup = financial?.rollup;
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

            {/* 8.63 — request-level financial rollup, fetched once on expand */}
            {!financial ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 mb-3"><Loader2 size={12} className="animate-spin" />Loading cost detail…</div>
            ) : rollup && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
                <div className="bg-white border border-gray-100 rounded-lg p-2.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Discount Requested</p>
                  <p className="text-sm font-semibold text-gray-900">{fmtR(rollup.total_requested_discount)}</p>
                </div>
                <div className="bg-white border border-gray-100 rounded-lg p-2.5">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Cost Data Coverage</p>
                  <p className="text-sm font-semibold text-gray-900">{rollup.lines_with_known_cost} of {rollup.lines_total} lines</p>
                </div>
                {rollup.margin ? (
                  <>
                    <div className="bg-green-50 border border-green-100 rounded-lg p-2.5">
                      <p className="text-[10px] font-semibold text-green-600 uppercase tracking-wide">Margin Before</p>
                      <p className="text-sm font-semibold text-green-800">{fmtPct(rollup.margin.margin_before_pct)}</p>
                    </div>
                    <div className="bg-amber-50 border border-amber-100 rounded-lg p-2.5">
                      <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">Margin After</p>
                      <p className="text-sm font-semibold text-amber-800">{fmtPct(rollup.margin.margin_after_pct)}</p>
                    </div>
                  </>
                ) : (
                  <div className="bg-gray-50 border border-gray-100 rounded-lg p-2.5 col-span-2">
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Margin Impact</p>
                    <p className="text-xs text-gray-400 italic">Cost price not set in Odoo for any discounted line</p>
                  </div>
                )}
              </div>
            )}

            {/* Every line on the order — the discounted ones stand out so the
                approver can judge the request against the full quote, not
                just the lines asked about in isolation. */}
            <table className="w-full text-xs bg-white border border-gray-100 rounded-lg overflow-hidden">
              <thead>
                <tr className="bg-gray-100">
                  <th className="text-left p-2 pl-3 font-semibold text-gray-400 uppercase">Product</th>
                  <th className="text-right p-2 font-semibold text-gray-400 uppercase">Qty</th>
                  <th className="text-right p-2 font-semibold text-gray-400 uppercase">Unit Price</th>
                  <th className="text-right p-2 font-semibold text-gray-400 uppercase">Cost Price</th>
                  <th className="text-right p-2 pr-3 font-semibold text-gray-400 uppercase">Discount</th>
                </tr>
              </thead>
              <tbody>
                {linesToRender.map((l, i) => {
                  const isRequested = (l.requested_pct || 0) > 0;
                  const hasCostInfo = financial != null;
                  return (
                    <tr key={i} className={`border-t border-gray-50 ${isRequested ? "bg-amber-50/60" : ""}`}>
                      <td className="p-2 pl-3 text-gray-700">{l.product_name}</td>
                      <td className="p-2 text-right text-gray-500">{l.qty}</td>
                      <td className="p-2 text-right text-gray-500">{fmtR(l.unit_price)}</td>
                      <td className="p-2 text-right">
                        {hasCostInfo ? (
                          <button
                            onClick={() => onOpenBom(l)}
                            className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 hover:underline"
                            title="View cost breakdown and Bill of Materials"
                          >
                            <Package size={11} />
                            {l.cost_set ? fmtR(l.cost_price) : <span className="italic">Not set</span>}
                          </button>
                        ) : <span className="text-gray-300">…</span>}
                      </td>
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
  // 8.63 — filters (search is client-side over the loaded page; the date
  // range re-fetches, matching the backend's own date_from/date_to params)
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [groupBy, setGroupBy] = useState("list"); // "list" | "customer"
  // 8.63 — financial-detail fetched lazily per request on first expand
  const [financialByRequest, setFinancialByRequest] = useState({});
  const [bomLine, setBomLine] = useState(null); // {requestId, line} | null

  // 8.63 — Customer 360's "View All" link lands here with the customer's
  // Odoo partner id in location.state, filtering server-side (via the same
  // customer_partner_id param list_discount_requests now accepts) rather
  // than relying on the client-side text search to match a name correctly.
  const [customerFilterId, setCustomerFilterId] = useState(location.state?.customerPartnerId || null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter === "all" ? {} : { status: statusFilter };
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      if (customerFilterId) params.customer_partner_id = customerFilterId;
      const r = await api.get("/api/discount-requests/", { params });
      setRequests(r.data.requests || []);
    } catch { toast.error("Failed to load discount requests"); }
    finally { setLoading(false); }
  }, [statusFilter, dateFrom, dateTo, customerFilterId]);
  useEffect(() => { load(); }, [load]);

  // Auto-expand a specific request when arriving via an email deep link
  // (?request=<id> — a genuine URL query param, since this must survive a
  // fresh page load from an external email, not just in-app navigation).
  useEffect(() => {
    const rid = new URLSearchParams(location.search).get("request");
    if (rid) { setStatusFilter("all"); setExpandedId(rid); }
    if (location.state?.customerPartnerId) setStatusFilter("all");
  }, []); // eslint-disable-line

  const toggle = (id) => {
    setExpandedId(prev => {
      const next = prev === id ? null : id;
      if (next && !financialByRequest[next]) {
        api.get(`/api/discount-requests/${next}/financial-detail`)
          .then(r => setFinancialByRequest(m => ({ ...m, [next]: r.data })))
          .catch(() => toast.error("Could not load cost detail for this request"));
      }
      return next;
    });
  };

  // Client-side search — matches customer, quote ref, requested-by name, or
  // any product on the request (including lines that weren't discounted,
  // since "filterable by product" should find the request even if that
  // particular product wasn't the one given a discount).
  const filteredRequests = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(r =>
      (r.customer_name || "").toLowerCase().includes(q) ||
      (r.order_name || "").toLowerCase().includes(q) ||
      (r.requested_by?.name || "").toLowerCase().includes(q) ||
      (r.lines || []).some(l => (l.product_name || "").toLowerCase().includes(q))
    );
  }, [requests, search]);

  // Group by Customer (8.63) — clusters the same request rows under a
  // customer heading rather than a second aggregate view; the Reports page's
  // own "Discounts by Customer"/"Discounts by Product" leaderboards handle
  // the cross-request aggregate analysis, so this stays a browsing view.
  const groupedByCustomer = useMemo(() => {
    if (groupBy !== "customer") return null;
    const groups = new Map();
    for (const r of filteredRequests) {
      const key = r.customer_partner_id != null ? `id:${r.customer_partner_id}` : `name:${r.customer_name || "Unknown"}`;
      if (!groups.has(key)) groups.set(key, { name: r.customer_name || "Unknown", requests: [] });
      groups.get(key).requests.push(r);
    }
    return Array.from(groups.values()).sort((a, b) => b.requests.length - a.requests.length);
  }, [filteredRequests, groupBy]);

  // Export (8.63) — one row per request, client-side over whatever's
  // currently filtered/loaded, same dynamic-import convention as every
  // other Excel export in this codebase (Views.js, productExport.js).
  const exportExcel = async () => {
    const XLSX = await import("xlsx");
    const rows = filteredRequests.map(r => {
      const discounted = (r.lines || []).filter(l => (l.requested_pct || 0) > 0);
      const grantedTotal = (r.final_lines || []).reduce((s, l) => s + (l.final_amount || 0), 0);
      return {
        "Quote": r.order_name,
        "Customer": r.customer_name || "",
        "Requested By": r.requested_by?.name || "",
        "Reason": r.reason || "",
        "Status": STATUS_LABEL[r.status] || r.status,
        "Lines Discounted": discounted.length,
        "Avg % Requested": discounted.length ? (discounted.reduce((s, l) => s + (l.requested_pct || 0), 0) / discounted.length).toFixed(2) : "0",
        "Order Total (R)": (r.order_total || 0).toFixed(2),
        "Requested (R)": discounted.reduce((s, l) => s + l.qty * l.unit_price * (l.requested_pct / 100), 0).toFixed(2),
        "Granted (R)": grantedTotal.toFixed(2),
        "Requested On": r.created_at ? fmtDate(r.created_at) : "",
        "Decided By": r.decision?.by?.name || "",
        "Decided On": r.decision?.at ? fmtDate(r.decision.at) : "",
        "Decision Note": r.decision?.note || "",
      };
    });
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Discount Requests");
    XLSX.writeFile(wb, `Bassani Discount Requests ${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

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
    // A reason is mandatory (2026-09-30) — enforced server-side too, this
    // is just the earlier, friendlier check. Sales staff read this reason
    // straight off the ticket's decision banner to explain the rejection.
    if (!rejectNote.trim()) return toast.error("A reason is required so sales staff can explain this to the customer");
    setRejecting(true);
    try {
      await api.post(`/api/discount-requests/${rejectTarget.id}/reject`, { note: rejectNote });
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
  // Amount (R) / Percent toggle (2026-09-29, defaulted to Rand + rewritten
  // 2026-09-30 after live testing — see the identical fix/rationale on
  // SalesTickets.js's Request Discount modal for the two bugs this fixes:
  // the Rand figure now converts against unit_price alone, not qty *
  // unit_price, so it matches what's shown in the Unit Price column; and
  // the input no longer round-trips through a live percent conversion on
  // every keystroke, which was breaking typing/backspacing entirely.
  // approved_pct is always the canonical value actually submitted.
  const [counterMode, setCounterMode] = useState("amount");
  const openCounter = (req) => {
    setCounterTarget(req);
    setCounterMode("amount");
    // Only the lines actually asked about (requested_pct > 0) are
    // counterable — the rest of req.lines is full-order context only. The
    // backend now requires every one of these to be resolved in the same
    // counter call, so none can be dropped from this list before submit.
    setCounterLines((req.lines || []).filter(l => (l.requested_pct || 0) > 0)
      .map(l => ({
        product_id: l.product_id, product_name: l.product_name,
        approved_pct: Number(l.requested_pct).toFixed(2),
        approved_amt: (l.unit_price * l.requested_pct / 100).toFixed(2),
      })));
    setCounterNote("");
  };
  const setCounterPct = (i, v) => setCounterLines(ls => ls.map((x, xi) => {
    if (xi !== i) return x;
    const original = counterTarget.lines.find(l => l.product_id === x.product_id);
    const n = Number(v);
    return { ...x, approved_pct: v, approved_amt: v === "" ? "" : (isNaN(n) ? x.approved_amt : n / 100 * (original?.unit_price || 0)) };
  }));
  const setCounterAmt = (i, v) => setCounterLines(ls => ls.map((x, xi) => {
    if (xi !== i) return x;
    const original = counterTarget.lines.find(l => l.product_id === x.product_id);
    const n = Number(v);
    const unitPrice = original?.unit_price || 0;
    return { ...x, approved_amt: v, approved_pct: v === "" || !unitPrice ? "" : (isNaN(n) ? x.approved_pct : n / unitPrice * 100) };
  }));
  const switchCounterMode = (mode) => {
    setCounterMode(mode);
    setCounterLines(ls => ls.map(x => mode === "pct"
      ? { ...x, approved_pct: x.approved_pct === "" ? "" : Number(x.approved_pct).toFixed(2) }
      : { ...x, approved_amt: x.approved_amt === "" ? "" : Number(x.approved_amt).toFixed(2) }));
  };
  const doCounter = async () => {
    // A reason is mandatory (2026-09-30) — a counter is exactly the case
    // sales staff need to go back to the customer about, so there must
    // always be something to relay. Enforced server-side too.
    if (!counterNote.trim()) return toast.error("A reason is required so sales staff can explain the counter-offer to the customer");
    setCountering(true);
    try {
      await api.post(`/api/discount-requests/${counterTarget.id}/counter`, {
        lines: counterLines.map(l => ({ product_id: l.product_id, approved_pct: Number(l.approved_pct) })),
        note: counterNote,
      });
      toast.success("Counter-offer applied");
      setCounterTarget(null);
      load();
    } catch (e) { toast.error(e.response?.data?.detail || "Could not apply counter-offer"); }
    finally { setCountering(false); }
  };

  const renderTable = (rows) => (
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
          {rows.map(req => (
            <RequestRow
              key={req.id} req={req} expanded={expandedId === req.id} onToggle={toggle}
              onApprove={setApproveTarget} onReject={setRejectTarget} onCounter={openCounter}
              navigate={navigate} financial={financialByRequest[req.id]}
              onOpenBom={(line) => setBomLine({ requestId: req.id, line })}
            />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <TopBar
        title="Discount Approvals"
        subtitle="Approve, reject or counter staff discount requests"
        actions={
          <BtnSecondary onClick={exportExcel} disabled={filteredRequests.length === 0}>
            <Download size={14} />Export
          </BtnSecondary>
        }
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="mb-2">
          <ChipRow>
            {["pending", "approved", "countered", "rejected", "cancelled", "all"].map(s => (
              <FilterPill key={s} label={s === "all" ? "All" : STATUS_LABEL[s]} active={statusFilter === s} onClick={() => setStatusFilter(s)} />
            ))}
          </ChipRow>
        </div>
        <DiscountStatusKey className="mb-3" />
        {customerFilterId && (
          <div className="mb-3 flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2 text-xs text-blue-700 w-fit">
            <span>Filtered to one customer{filteredRequests[0]?.customer_name ? `: ${filteredRequests[0].customer_name}` : ""}</span>
            <button onClick={() => setCustomerFilterId(null)} className="text-blue-500 hover:text-blue-800 font-semibold">Clear</button>
          </div>
        )}
        {/* Every item in this row follows the same [label row][control row]
            shape, including the ones that don't logically need a visible
            label — FormGroup's own baked-in mb-4 was pushing the From/To
            fields up relative to the plain, label-less SearchBar inside this
            items-end row (found live, looked "offset"); giving every item an
            identical label height, even an invisible one, is what actually
            guarantees their controls share one baseline, not items-end alone. */}
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">Search</label>
            <SearchBar value={search} onChange={setSearch} placeholder="Customer, quote #, requester or product…" />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">From</label>
            <Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} />
          </div>
          <div>
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-1.5">To</label>
            <Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} />
          </div>
          {(dateFrom || dateTo || search) && (
            <div>
              <label className="block text-[10px] mb-1.5 select-none" aria-hidden="true">&nbsp;</label>
              <BtnSecondary onClick={() => { setDateFrom(""); setDateTo(""); setSearch(""); }}>Clear filters</BtnSecondary>
            </div>
          )}
          <div className="ml-auto">
            <label className="block text-[10px] mb-1.5 select-none" aria-hidden="true">&nbsp;</label>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
              <button type="button" onClick={() => setGroupBy("list")}
                className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 ${groupBy === "list" ? "bg-bassani-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                <ListIcon size={12} />List
              </button>
              <button type="button" onClick={() => setGroupBy("customer")}
                className={`px-3 py-1.5 text-xs font-medium inline-flex items-center gap-1.5 border-l border-gray-200 ${groupBy === "customer" ? "bg-bassani-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                <Users size={12} />By Customer
              </button>
            </div>
          </div>
        </div>
        {loading ? <LoadingState /> : filteredRequests.length === 0 ? (
          <EmptyState icon={Percent} heading="No requests" message="Nothing matches this filter." />
        ) : groupBy === "customer" ? (
          <div className="space-y-4">
            {groupedByCustomer.map(g => (
              <div key={g.name}>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5 px-1">
                  {g.name} <span className="text-gray-300 font-normal">({g.requests.length} request{g.requests.length !== 1 ? "s" : ""})</span>
                </p>
                {renderTable(g.requests)}
              </div>
            ))}
          </div>
        ) : renderTable(filteredRequests)}
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
          <FormGroup label="Reason" required>
            <Textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={2}
              placeholder="This is what sales staff will use to explain the rejection to the customer…" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setRejectTarget(null)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doReject} disabled={rejecting || !rejectNote.trim()}>{rejecting ? "Rejecting…" : "Reject"}</BtnDanger>
          </div>
        </Modal>
      )}

      {counterTarget && (
        <Modal title="Counter-Offer" onClose={() => setCounterTarget(null)} width="max-w-3xl">
          <p className="text-sm text-gray-600 mb-3">
            Apply a different discount than requested for {counterTarget.order_name}. This is applied
            immediately, same as an approval. Every originally requested line must be given a rate below,
            even if that rate is 0%.
          </p>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Enter as</span>
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
              <button type="button" onClick={() => switchCounterMode("pct")}
                className={`px-3 py-1 text-xs font-medium ${counterMode === "pct" ? "bg-bassani-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                Percent
              </button>
              <button type="button" onClick={() => switchCounterMode("amount")}
                className={`px-3 py-1 text-xs font-medium border-l border-gray-200 ${counterMode === "amount" ? "bg-bassani-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}>
                Rand Amount
              </button>
            </div>
          </div>
          <div className="max-h-[28rem] overflow-y-auto border border-gray-100 rounded-lg mb-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 sticky top-0">
                  <th className="text-left p-2 pl-3 text-xs font-semibold text-gray-400 uppercase">Product</th>
                  <th className="text-right p-2 text-xs font-semibold text-gray-400 uppercase w-24">Requested / Unit</th>
                  <th className="text-right p-2 text-xs font-semibold text-gray-400 uppercase w-32">Approved / Unit</th>
                  <th className="text-right p-2 pr-3 text-xs font-semibold text-gray-400 uppercase w-28">Line Total</th>
                </tr>
              </thead>
              <tbody>
                {counterLines.map((l, i) => {
                  const original = counterTarget.lines.find(x => x.product_id === l.product_id);
                  const unitPrice = original?.unit_price || 0;
                  const qty = original?.qty || 0;
                  const pct = l.approved_pct === "" ? 0 : Number(l.approved_pct);
                  const perUnitAmt = l.approved_amt === "" ? 0 : Number(l.approved_amt);
                  const lineTotal = unitPrice * (pct / 100) * qty;
                  const requestedPerUnit = unitPrice * (original?.requested_pct || 0) / 100;
                  return (
                    <tr key={l.product_id} className="border-b border-gray-50 last:border-0">
                      <td className="p-2 pl-3 text-gray-800">{l.product_name}</td>
                      <td className="p-2 text-right text-gray-500">
                        {Number(original?.requested_pct || 0).toFixed(2)}%
                        <span className="block text-[10px] text-gray-300">{fmtR(requestedPerUnit)}</span>
                      </td>
                      <td className="p-2">
                        <div className="flex items-center justify-end gap-1">
                          {counterMode === "amount" && <span className="text-gray-400 text-xs">R</span>}
                          <input
                            type="number" min="0" step="0.01"
                            max={counterMode === "pct" ? 100 : undefined}
                            value={counterMode === "pct" ? l.approved_pct : l.approved_amt}
                            onChange={e => counterMode === "pct" ? setCounterPct(i, e.target.value) : setCounterAmt(i, e.target.value)}
                            className="w-20 text-right text-sm border border-gray-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-bassani-400"
                          />
                          {counterMode === "pct" && <span className="text-gray-400 text-xs">%</span>}
                        </div>
                        <span className="block text-[10px] text-gray-400 text-right mt-0.5">
                          {counterMode === "pct" ? `${fmtR(perUnitAmt)}` : `${pct.toFixed(2)}%`}
                        </span>
                      </td>
                      <td className="p-2 pr-3 text-right">
                        {pct > 0 ? <span className="font-semibold text-teal-700">{fmtR(lineTotal)}</span> : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <FormGroup label="Reason" required>
            <Textarea value={counterNote} onChange={e => setCounterNote(e.target.value)} rows={2}
              placeholder="e.g. Approved at a lower rate given order size — this is what sales staff will tell the customer" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setCounterTarget(null)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doCounter} disabled={countering || !counterNote.trim()}>{countering ? "Applying…" : "Apply Counter-Offer"}</BtnPrimary>
          </div>
        </Modal>
      )}

      {bomLine && (
        <BomMarginModal requestId={bomLine.requestId} line={bomLine.line} onClose={() => setBomLine(null)} />
      )}
    </div>
  );
}
