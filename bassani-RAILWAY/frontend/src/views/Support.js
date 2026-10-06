// Support Desk (staff) / Help & Support (customer, reseller) — Phase 28.
// One route, /support, role-branched like SalesTickets.js: list view, and a
// detail view opened via ?case=<id> (a real URL param, so the deep links in
// support notification emails survive a fresh page load).
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ChevronLeft, LifeBuoy, Plus, User, Package, FileText, ShieldCheck, CheckCircle2, XCircle,
  Star, MessageSquare, AlertTriangle, Building2,
} from "lucide-react";
import api from "../api";
import { useAuth } from "../AuthContext";
import {
  TopBar, DataTable, SearchBar, ChipRow, FilterPill, BtnPrimary, BtnSecondary, BtnDanger, Modal,
  FormGroup, Select, Textarea, Input, LoadingState, EmptyState, StatCard, AgeTierBadge, AgePriorityStrip,
  fmtDate, fmtDateTime,
} from "../components/UI";
import {
  SupportStatusBadge, SupportPriorityBadge, CaseThread, ReplyComposer, RatingForm, StarRating,
  AdverseEventBanner, SUPPORT_CATEGORY_LABEL, RATING_WORDS,
} from "../components/SupportKit";
import NewSupportCaseModal from "../components/NewSupportCaseModal";

const isExternalRole = (role) => role === "customer" || role === "reseller";

async function openAttachment(caseId, att) {
  try {
    const r = await api.get(`/api/support/cases/${caseId}/attachments/${att.id}`);
    window.open(r.data.url, "_blank", "noopener,noreferrer");
  } catch (e) {
    toast.error(e.response?.data?.detail || "Could not open file");
  }
}

function postMultipart(url, { body, files, internal }) {
  const fd = new FormData();
  fd.append("body", body);
  if (internal) fd.append("internal", "true");
  for (const f of files || []) fd.append("files", f);
  return api.post(url, fd, { headers: { "Content-Type": "multipart/form-data" } });
}

export default function Support() {
  const location = useLocation();
  const navigate = useNavigate();
  const caseId = new URLSearchParams(location.search).get("case");
  // Stable callbacks — CaseDetail's load() depends on onBack, so an inline
  // arrow here would re-trigger its fetch effect on every render.
  const goBack = useCallback(() => navigate("/support"), [navigate]);
  const openCase = useCallback((id) => navigate(`/support?case=${id}`), [navigate]);
  if (caseId) return <CaseDetail key={caseId} caseId={caseId} onBack={goBack} />;
  return <CaseList onOpen={openCase} />;
}

// ── List ─────────────────────────────────────────────────────────────────────

const STAFF_STATUS_FILTERS = [
  { key: "active", label: "Active" }, { key: "new", label: "New" }, { key: "open", label: "Open" },
  { key: "awaiting_customer", label: "Awaiting Customer" }, { key: "resolved", label: "Resolved" },
  { key: "closed", label: "Closed" }, { key: "", label: "All" },
];
const EXTERNAL_STATUS_FILTERS = [
  { key: "", label: "All" }, { key: "active", label: "Open" },
  { key: "awaiting_customer,resolved", label: "Needs your reply" }, { key: "closed", label: "Closed" },
];

function CaseList({ onOpen }) {
  const { user, can } = useAuth();
  const external = isExternalRole(user?.role);
  const canLog = !external && can("support.respond");

  const [tab, setTab] = useState("cases");
  const [status, setStatus] = useState(external ? "" : "active");
  const [assigned, setAssigned] = useState("");
  const [category, setCategory] = useState("");
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [ageTier, setAgeTier] = useState(null);
  const [pagination, setPagination] = useState({ pageIndex: 0, pageSize: 25 });
  const [cases, setCases] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState(null);
  const [newOpen, setNewOpen] = useState(false);

  useEffect(() => { const t = setTimeout(() => setDebounced(search), 350); return () => clearTimeout(t); }, [search]);
  useEffect(() => { setPagination((p) => ({ ...p, pageIndex: 0 })); }, [status, assigned, category, debounced]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        status: status || undefined, assigned: assigned || undefined, category: category || undefined,
        search: debounced || undefined, skip: pagination.pageIndex * pagination.pageSize, limit: pagination.pageSize,
      };
      const [r, s] = await Promise.all([
        api.get("/api/support/cases", { params }),
        api.get("/api/support/summary").catch(() => ({ data: null })),
      ]);
      setCases(r.data.cases || []);
      setTotal(r.data.total || 0);
      setSummary(s.data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to load requests");
    } finally {
      setLoading(false);
    }
  }, [status, assigned, category, debounced, pagination]);

  useEffect(() => { if (tab === "cases") load(); }, [load, tab]);

  const visible = useMemo(() => (ageTier ? cases.filter((c) => c.age_tier === ageTier) : cases), [cases, ageTier]);

  const staffColumns = [
    { accessorKey: "ref", header: "Ref", cell: ({ row: { original: c } }) => <span className="font-mono text-xs text-gray-700">{c.ref}</span> },
    { accessorKey: "subject", header: "Request", enableSorting: false, cell: ({ row: { original: c } }) => (
      <div className="min-w-0 max-w-[320px]">
        <p className="font-medium text-gray-900 truncate flex items-center gap-1.5">
          {c.adverse_event && <AlertTriangle size={13} className="text-red-600 shrink-0" title="Possible adverse reaction" />}
          <span className="truncate">{c.subject}</span>
        </p>
        <p className="text-xs text-gray-500 truncate">{c.customer_name}{c.order_name ? ` · ${c.order_name}` : ""}</p>
      </div>
    ) },
    { accessorKey: "category", header: "Type", cell: ({ row: { original: c } }) => <span className="text-xs text-gray-600">{SUPPORT_CATEGORY_LABEL[c.category]}</span> },
    { accessorKey: "priority", header: "Priority", cell: ({ row: { original: c } }) => <SupportPriorityBadge priority={c.priority} /> },
    { accessorKey: "status", header: "Status", cell: ({ row: { original: c } }) => <SupportStatusBadge status={c.status} /> },
    { id: "response", header: "Response", enableSorting: false, cell: ({ row: { original: c } }) => (
      c.age_tier ? <AgeTierBadge tier={c.age_tier} />
        : c.waiting_on === "customer" ? <span className="text-[11px] text-gray-400">With customer</span> : <span className="text-[11px] text-gray-300">—</span>
    ) },
    { id: "assignee", header: "Assigned", enableSorting: false, cell: ({ row: { original: c } }) => (
      <span className={`text-xs ${c.assigned_to ? "text-gray-700" : "text-amber-600 font-medium"}`}>{c.assigned_to?.name || "Unassigned"}</span>
    ) },
    { accessorKey: "updated_at", header: "Updated", cell: ({ row: { original: c } }) => <span className="text-xs text-gray-500">{fmtDateTime(c.updated_at)}</span> },
  ];
  const externalColumns = [
    { accessorKey: "ref", header: "Ref", cell: ({ row: { original: c } }) => <span className="font-mono text-xs text-gray-700">{c.ref}</span> },
    { accessorKey: "subject", header: "Request", enableSorting: false, cell: ({ row: { original: c } }) => (
      <div className="min-w-0 max-w-[340px]">
        <p className="font-medium text-gray-900 truncate">{c.subject}</p>
        <p className="text-xs text-gray-500 truncate">
          {SUPPORT_CATEGORY_LABEL[c.category]}{c.order_name ? ` · ${c.order_name}` : c.invoice_name ? ` · ${c.invoice_name}` : ""}
          {user?.role === "reseller" && c.customer_name ? ` · ${c.customer_name}` : ""}
        </p>
      </div>
    ) },
    { accessorKey: "status", header: "Status", cell: ({ row: { original: c } }) => <SupportStatusBadge status={c.status} external /> },
    { accessorKey: "created_at", header: "Raised", cell: ({ row: { original: c } }) => <span className="text-xs text-gray-500">{fmtDate(c.created_at)}</span> },
    { accessorKey: "updated_at", header: "Last update", cell: ({ row: { original: c } }) => <span className="text-xs text-gray-500">{fmtDateTime(c.updated_at)}</span> },
  ];

  const statusFilters = external ? EXTERNAL_STATUS_FILTERS : STAFF_STATUS_FILTERS;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={external ? "Help & Support" : "Support Desk"}
        subtitle={external ? "Questions, queries and complaints about your orders and account" : "Customer queries, complaints and order feedback"}
        onRefresh={load}
        actions={
          (external || canLog) && (
            <BtnPrimary onClick={() => setNewOpen(true)}><Plus size={14} className="mr-1" />{external ? "New Request" : "Log Request"}</BtnPrimary>
          )
        }
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
        {!external && (
          <div className="flex gap-1 border-b border-gray-200">
            {[{ key: "cases", label: "Requests" }, { key: "feedback", label: "Order Feedback" }].map((t) => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${tab === t.key ? "border-bassani-600 text-bassani-700" : "border-transparent text-gray-500 hover:text-gray-700"}`}>
                {t.label}
              </button>
            ))}
          </div>
        )}

        {tab === "feedback" ? <OrderFeedbackPanel /> : (
          <>
            {!external && summary && (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <StatCard label="Waiting on us" value={summary.waiting_on_us} />
                <StatCard label="Unassigned" value={summary.unassigned} accent={summary.unassigned ? "text-amber-600" : undefined} />
                <StatCard label="Assigned to me" value={summary.mine} />
                <StatCard label="Past response target" value={summary.overdue} accent={summary.overdue ? "text-red-600" : undefined} />
              </div>
            )}
            {external && summary?.awaiting_your_reply > 0 && (
              <div className="flex items-center gap-2 rounded-xl border border-purple-200 bg-purple-50 px-4 py-3 text-sm text-purple-800">
                <MessageSquare size={15} />
                {summary.awaiting_your_reply === 1 ? "1 request is" : `${summary.awaiting_your_reply} requests are`} waiting for your reply or confirmation.
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <SearchBar value={search} onChange={setSearch} placeholder={external ? "Search your requests…" : "Search ref, subject, customer, order…"} />
              {!external && (
                <>
                  <div className="w-52">
                    <Select value={category} onChange={(e) => setCategory(e.target.value)}>
                      <option value="">All types</option>
                      {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </Select>
                  </div>
                  <div className="flex gap-1.5">
                    {[{ key: "", label: "Everyone" }, { key: "me", label: "Mine" }, { key: "unassigned", label: "Unassigned" }].map((a) => (
                      <FilterPill key={a.key} label={a.label} active={assigned === a.key} onClick={() => setAssigned(a.key)} />
                    ))}
                  </div>
                </>
              )}
            </div>
            <ChipRow>
              {!external && <AgePriorityStrip items={cases} activeTier={ageTier} onSelect={setAgeTier} />}
              {!external && cases.some((c) => c.age_tier === "overdue" || c.age_tier === "urgent") && <span className="text-gray-300 self-center">|</span>}
              {statusFilters.map((s) => <FilterPill key={s.key || "all"} label={s.label} active={status === s.key} onClick={() => setStatus(s.key)} />)}
            </ChipRow>

            {!loading && visible.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100">
                <EmptyState icon={LifeBuoy}
                  heading={external ? "No requests yet" : "Nothing here"}
                  message={external ? "Raise a request any time you have a question or a problem with an order. You can also do this from any order's page." : "No requests match these filters."}
                  action={external && <BtnPrimary onClick={() => setNewOpen(true)}><Plus size={14} className="mr-1" />New Request</BtnPrimary>} />
              </div>
            ) : (
              <DataTable
                columns={external ? externalColumns : staffColumns}
                data={visible} loading={loading}
                manualPagination total={ageTier ? visible.length : total}
                pagination={pagination} onPaginationChange={setPagination}
                onRowClick={(c) => onOpen(c.id)}
              />
            )}
          </>
        )}
      </div>
      {newOpen && <NewSupportCaseModal onClose={() => setNewOpen(false)} onCreated={(c) => onOpen(c.id)} />}
    </div>
  );
}

// ── Order feedback report (staff) ────────────────────────────────────────────

function OrderFeedbackPanel() {
  const navigate = useNavigate();
  const [days, setDays] = useState(90);
  const [lowOnly, setLowOnly] = useState(false);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    api.get("/api/support/order-feedback", { params: { days, max_rating: lowOnly ? 2 : undefined } })
      .then((r) => setData(r.data))
      .catch((e) => toast.error(e.response?.data?.detail || "Failed to load feedback"))
      .finally(() => setLoading(false));
  }, [days, lowOnly]);

  if (loading && !data) return <LoadingState />;
  const s = data?.stats || {};
  const columns = [
    { accessorKey: "order_name", header: "Order", cell: ({ row: { original: f } }) => (
      <button onClick={(e) => { e.stopPropagation(); navigate(`/orders/${f.order_id}/passport`); }} className="font-mono text-xs text-bassani-700 hover:underline">{f.order_name}</button>
    ) },
    { accessorKey: "customer_name", header: "Customer" },
    { accessorKey: "rating", header: "Rating", cell: ({ row: { original: f } }) => (
      <div className="flex items-center gap-2"><StarRating value={f.rating} readOnly size={14} /><span className="text-xs text-gray-500">{RATING_WORDS[f.rating]}</span></div>
    ) },
    { accessorKey: "comment", header: "Comment", enableSorting: false, cell: ({ row: { original: f } }) => (
      <span className="text-xs text-gray-600 line-clamp-2 max-w-[360px]">{f.comment || <span className="text-gray-300">No comment</span>}</span>
    ) },
    { id: "follow", header: "Follow-up", enableSorting: false, cell: ({ row: { original: f } }) => (
      f.case_id ? <button onClick={(e) => { e.stopPropagation(); navigate(`/support?case=${f.case_id}`); }} className="font-mono text-xs text-bassani-700 hover:underline">{f.case_ref}</button>
        : <span className="text-[11px] text-gray-300">—</span>
    ) },
    { accessorKey: "created_at", header: "Date", cell: ({ row: { original: f } }) => <span className="text-xs text-gray-500">{fmtDate(f.created_at)}</span> },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {[30, 90, 365].map((d) => <FilterPill key={d} label={`Last ${d} days`} active={days === d} onClick={() => setDays(d)} />)}
        <span className="text-gray-300">|</span>
        <FilterPill label="Low ratings only" active={lowOnly} onClick={() => setLowOnly((v) => !v)} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard label="Ratings received" value={s.count ?? 0} />
        <StatCard label="Average rating" value={s.average != null ? `${s.average} / 5` : "No ratings yet"} />
        <StatCard label="Satisfied (4 or 5 stars)" value={s.satisfied_pct != null ? `${s.satisfied_pct}%` : "No ratings yet"} />
        <StatCard label="Low ratings (1 or 2)" value={s.low_count ?? 0} accent={s.low_count ? "text-red-600" : undefined}
          sub="Each one opens a follow-up request automatically" />
      </div>
      {data?.items?.length ? <DataTable columns={columns} data={data.items} loading={loading} /> : (
        <div className="bg-white rounded-2xl border border-gray-100"><EmptyState icon={Star} heading="No feedback yet" message="Customers are asked to rate each order once it has been collected." /></div>
      )}
    </div>
  );
}

// ── Detail ───────────────────────────────────────────────────────────────────

function SideCard({ icon: Icon, title, action, children }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1.5"><Icon size={12} />{title}</p>
        {action}
      </div>
      {children}
    </div>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex justify-between gap-3 text-xs">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="text-gray-800 font-medium text-right min-w-0 break-words">{children}</span>
    </div>
  );
}

const EMPTY_REVIEW = { investigation_summary: "", root_cause: "", outcome: "", capa: "", recall_required: false, recall_notes: "", reported_to_authority: false };

function CaseDetail({ caseId, onBack }) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const external = isExternalRole(user?.role);
  const canRespond = !external && can("support.respond");
  const canManage = !external && can("support.manage");
  const canQuality = !external && can("support.quality_review");

  const [c, setC] = useState(null);
  const [loading, setLoading] = useState(true);
  const [assignees, setAssignees] = useState([]);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveNote, setResolveNote] = useState("");
  const [closeOpen, setCloseOpen] = useState(false);
  const [closeNote, setCloseNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(EMPTY_REVIEW);
  const [reviewEditing, setReviewEditing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get(`/api/support/cases/${caseId}`);
      setC(r.data);
      setReview(r.data.quality_review ? { ...EMPTY_REVIEW, ...r.data.quality_review } : EMPTY_REVIEW);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not load this request");
      onBack();
    } finally {
      setLoading(false);
    }
  }, [caseId, onBack]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!canRespond) return;
    api.get("/api/support/assignees").then((r) => setAssignees(r.data || [])).catch(() => {});
  }, [canRespond]);

  if (loading || !c) return <div className="flex flex-col h-full"><TopBar title="Loading…" /><LoadingState /></div>;

  const active = ["new", "open", "awaiting_customer"].includes(c.status);
  const isQuality = c.category === "product_quality";
  const reviewDone = !!c.quality_review?.reviewed_at;

  const reply = async (payload) => {
    try {
      const r = await postMultipart(`/api/support/cases/${caseId}/messages`, payload);
      setC(r.data);
      toast.success(payload.internal ? "Note added" : external ? "Reply sent" : "Reply sent to the customer");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not send");
      throw e;
    }
  };

  const update = async (patch) => {
    try {
      const r = await api.put(`/api/support/cases/${caseId}`, patch);
      setC(r.data);
      toast.success("Updated");
    } catch (e) { toast.error(e.response?.data?.detail || "Update failed"); }
  };

  const assign = async (userId) => {
    try {
      const r = await api.post(`/api/support/cases/${caseId}/assign`, { user_id: userId || null });
      setC(r.data);
      toast.success(userId ? "Assigned" : "Unassigned");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not assign"); }
  };

  const doResolve = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/support/cases/${caseId}/resolve`, { resolution_note: resolveNote });
      setC(r.data); setResolveOpen(false); setResolveNote("");
      toast.success("Resolved. The customer has been emailed.");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not resolve"); }
    finally { setBusy(false); }
  };

  const doClose = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/api/support/cases/${caseId}/close`, { note: closeNote || null });
      setC(r.data); setCloseOpen(false); setCloseNote("");
      toast.success("Request closed");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not close"); }
    finally { setBusy(false); }
  };

  const saveReview = async () => {
    setBusy(true);
    try {
      const r = await api.put(`/api/support/cases/${caseId}/quality-review`, review);
      setC(r.data); setReviewEditing(false);
      toast.success("Quality review saved");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not save the review"); }
    finally { setBusy(false); }
  };

  const rate = async (rating, comment) => {
    try {
      const r = await api.post(`/api/support/cases/${caseId}/feedback`, { rating, comment });
      setC(r.data);
      toast.success("Thank you for your feedback");
    } catch (e) { toast.error(e.response?.data?.detail || "Could not save your rating"); throw e; }
  };

  const reviewEditable = canQuality && c.status !== "closed" && (!reviewDone || reviewEditing);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <TopBar
        title={`${c.ref}: ${c.subject}`}
        subtitle={external ? SUPPORT_CATEGORY_LABEL[c.category] : `${c.customer_name} · ${SUPPORT_CATEGORY_LABEL[c.category]}`}
        onRefresh={load}
        leftAction={<button onClick={onBack} className="p-1.5 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50"><ChevronLeft size={16} /></button>}
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="max-w-6xl mx-auto w-full grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* ── Conversation ── */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <SupportStatusBadge status={c.status} external={external} />
              {!external && <SupportPriorityBadge priority={c.priority} />}
              {!external && c.age_tier && <AgeTierBadge tier={c.age_tier} />}
              <span className="text-xs text-gray-400">Raised {fmtDateTime(c.created_at)}</span>
            </div>
            {!external && c.adverse_event && <AdverseEventBanner />}

            <CaseThread messages={c.messages} viewer={external ? "external" : "staff"} onDownload={(a) => openAttachment(caseId, a)} />

            {/* Customer: resolved → confirm/rate, or reply to reopen */}
            {external && c.status === "resolved" && !c.csat && (
              <div className="bg-green-50 border border-green-200 rounded-2xl p-4">
                <RatingForm title="Has this resolved your request?"
                  subtitle="Rate how we did to close it. If you still need help, reply below instead and we'll reopen it."
                  submitLabel="Confirm and Rate" onSubmit={rate} />
              </div>
            )}
            {external && c.status === "closed" && !c.csat && (
              <div className="bg-white border border-gray-200 rounded-2xl p-4">
                <RatingForm title="How did we do?" onSubmit={rate} />
              </div>
            )}
            {c.csat && (
              <div className="flex items-center gap-3 bg-white border border-gray-100 rounded-2xl px-4 py-3">
                <StarRating value={c.csat.rating} readOnly size={16} />
                <span className="text-xs text-gray-600">{external ? "Your rating" : `Customer rated ${RATING_WORDS[c.csat.rating].toLowerCase()}`}{c.csat.comment ? `: "${c.csat.comment}"` : ""}</span>
              </div>
            )}

            {c.status === "closed" ? (
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                This request is closed. {external ? "If you need more help, please raise a new request." : ""}
              </p>
            ) : (external || canRespond) && (
              <ReplyComposer
                onSubmit={reply}
                allowInternal={!external}
                placeholder={external ? (c.status === "resolved" ? "Still need help? Reply here and we'll reopen your request" : "Add more information or reply to our team") : "Reply to the customer"}
                note={!external ? "The customer is emailed your reply with a link to respond. Replying moves the request to Awaiting Customer." : null}
                onFileError={toast.error}
              />
            )}
          </div>

          {/* ── Sidebar ── */}
          <div className="space-y-4 lg:sticky lg:top-0 self-start w-full">
            {!external && active && canRespond && (
              <SideCard icon={CheckCircle2} title="Actions">
                <div className="grid grid-cols-1 gap-2">
                  <BtnPrimary onClick={() => setResolveOpen(true)} disabled={isQuality && (!canQuality || !reviewDone)} className="w-full justify-center">
                    <CheckCircle2 size={14} className="mr-1" />Resolve
                  </BtnPrimary>
                  {isQuality && !reviewDone && (
                    <p className="text-[11px] text-amber-700">A quality complaint can only be resolved by QA or the Responsible Pharmacist, after the quality review below is completed.</p>
                  )}
                  {canManage && (
                    <BtnSecondary onClick={() => setCloseOpen(true)} disabled={isQuality && !reviewDone} className="w-full justify-center">
                      <XCircle size={14} className="mr-1" />Close without resolving
                    </BtnSecondary>
                  )}
                </div>
              </SideCard>
            )}

            {!external && (
              <SideCard icon={User} title="Handling">
                <FormGroup label="Assigned to">
                  <Select value={c.assigned_to?.id || ""} disabled={!canRespond || c.status === "closed"}
                    onChange={(e) => assign(e.target.value)}>
                    <option value="">Unassigned</option>
                    {assignees.filter((a) => canManage || a.id === user.id || a.id === c.assigned_to?.id)
                      .map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                  {canRespond && c.assigned_to?.id !== user.id && c.status !== "closed" && (
                    <button onClick={() => assign(user.id)} className="text-[11px] font-medium text-bassani-700 hover:underline mt-1">Assign to me</button>
                  )}
                </FormGroup>
                {active && canRespond && (
                  <>
                    <FormGroup label="Status">
                      <Select value={c.status} onChange={(e) => update({ status: e.target.value })}>
                        <option value="new">New</option>
                        <option value="open">Open</option>
                        <option value="awaiting_customer">Awaiting Customer</option>
                      </Select>
                    </FormGroup>
                    <FormGroup label="Priority">
                      <Select value={c.priority} onChange={(e) => update({ priority: e.target.value })}>
                        <option value="low">Low (48h response)</option>
                        <option value="normal">Normal (24h response)</option>
                        <option value="high">High (8h response)</option>
                        <option value="urgent">Urgent (4h response)</option>
                      </Select>
                    </FormGroup>
                    <FormGroup label="Type">
                      <Select value={c.category} onChange={(e) => update({ category: e.target.value })}
                        disabled={isQuality && reviewDone}>
                        {Object.entries(SUPPORT_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    </FormGroup>
                  </>
                )}
                {c.first_response_at && <Row label="First response">{fmtDateTime(c.first_response_at)}</Row>}
                {c.resolution && <Row label="Resolved by">{c.resolution.by}, {fmtDate(c.resolution.at)}</Row>}
              </SideCard>
            )}

            <SideCard icon={FileText} title="Details">
              {!external && (
                <Row label="Customer">
                  {c.customer_partner_id
                    ? <button onClick={() => navigate(`/customers/${c.customer_partner_id}`)} className="text-bassani-700 hover:underline inline-flex items-center gap-1"><Building2 size={11} />{c.customer_name}</button>
                    : c.customer_name}
                </Row>
              )}
              {external && user?.role === "reseller" && <Row label="Customer">{c.customer_name}</Row>}
              {!external && <Row label="Contact">{c.contact_name}{c.contact_email ? <span className="block text-gray-500 font-normal">{c.contact_email}</span> : null}</Row>}
              {!external && <Row label="Raised via">{{ portal: "Portal", staff: `Logged by ${c.raised_by?.name}`, email_link: "Email link (no login)", order_feedback: "Low order rating" }[c.source] || c.source}</Row>}
              {c.order_name && (
                <Row label="Order">
                  <button onClick={() => navigate(`/orders/${c.order_id}/passport`)} className="text-bassani-700 hover:underline inline-flex items-center gap-1"><Package size={11} />{c.order_name}</button>
                </Row>
              )}
              {c.invoice_name && <Row label="Invoice">{c.invoice_name}</Row>}
              {!external && c.sales_ticket_id && (
                <Row label="Sales ticket">
                  <button onClick={() => navigate(`/tickets/sales?ticket=${c.sales_ticket_id}`)} className="text-bassani-700 hover:underline font-mono">TKT-{c.sales_ticket_id.slice(-8).toUpperCase()}</button>
                </Row>
              )}
              {c.product_name && <Row label="Product">{c.product_name}</Row>}
              {c.lot_number && <Row label="Batch / lot">{c.lot_number}</Row>}
              {c.adverse_event && <Row label="Adverse reaction">Reported</Row>}
            </SideCard>

            {!external && isQuality && (
              <SideCard icon={ShieldCheck} title="Quality Review"
                action={canQuality && reviewDone && c.status !== "closed" && !reviewEditing && (
                  <button onClick={() => setReviewEditing(true)} className="text-[11px] font-medium text-bassani-700 hover:underline">Edit</button>
                )}>
                {reviewEditable ? (
                  <div>
                    <FormGroup label="Investigation summary" required>
                      <Textarea rows={3} value={review.investigation_summary} onChange={(e) => setReview({ ...review, investigation_summary: e.target.value })} />
                    </FormGroup>
                    <FormGroup label="Root cause">
                      <Textarea rows={2} value={review.root_cause || ""} onChange={(e) => setReview({ ...review, root_cause: e.target.value })} />
                    </FormGroup>
                    <FormGroup label="Outcome" required>
                      <Select value={review.outcome} onChange={(e) => setReview({ ...review, outcome: e.target.value })}>
                        <option value="">Select…</option>
                        <option value="justified">Justified</option>
                        <option value="not_justified">Not justified</option>
                        <option value="inconclusive">Inconclusive</option>
                      </Select>
                    </FormGroup>
                    <FormGroup label="Corrective / preventive action (CAPA)">
                      <Textarea rows={2} value={review.capa || ""} onChange={(e) => setReview({ ...review, capa: e.target.value })} />
                    </FormGroup>
                    <label className="flex items-center gap-2 text-xs text-gray-700 mb-2 cursor-pointer">
                      <input type="checkbox" checked={review.recall_required} onChange={(e) => setReview({ ...review, recall_required: e.target.checked })} className="accent-red-600" />
                      Recall required
                    </label>
                    {review.recall_required && (
                      <FormGroup label="Recall notes">
                        <Textarea rows={2} value={review.recall_notes || ""} onChange={(e) => setReview({ ...review, recall_notes: e.target.value })} />
                      </FormGroup>
                    )}
                    {c.adverse_event && (
                      <label className="flex items-center gap-2 text-xs text-gray-700 mb-3 cursor-pointer">
                        <input type="checkbox" checked={review.reported_to_authority} onChange={(e) => setReview({ ...review, reported_to_authority: e.target.checked })} className="accent-bassani-600" />
                        Adverse event reported to SAHPRA
                      </label>
                    )}
                    <div className="flex gap-2">
                      <BtnPrimary onClick={saveReview} loading={busy} disabled={!review.investigation_summary.trim() || !review.outcome}>Save Review</BtnPrimary>
                      {reviewEditing && <BtnSecondary onClick={() => { setReviewEditing(false); setReview({ ...EMPTY_REVIEW, ...c.quality_review }); }}>Cancel</BtnSecondary>}
                    </div>
                  </div>
                ) : reviewDone ? (
                  <div className="space-y-2">
                    <Row label="Outcome">{{ justified: "Justified", not_justified: "Not justified", inconclusive: "Inconclusive" }[c.quality_review.outcome]}</Row>
                    <Row label="Recall">{c.quality_review.recall_required ? "Required" : "Not required"}</Row>
                    {c.adverse_event && <Row label="SAHPRA report">{c.quality_review.reported_to_authority ? "Made" : "Not made"}</Row>}
                    <p className="text-xs text-gray-700 whitespace-pre-wrap">{c.quality_review.investigation_summary}</p>
                    {c.quality_review.root_cause && <p className="text-xs text-gray-600"><span className="font-semibold">Root cause: </span>{c.quality_review.root_cause}</p>}
                    {c.quality_review.capa && <p className="text-xs text-gray-600"><span className="font-semibold">CAPA: </span>{c.quality_review.capa}</p>}
                    {c.quality_review.recall_notes && <p className="text-xs text-gray-600"><span className="font-semibold">Recall: </span>{c.quality_review.recall_notes}</p>}
                    <p className="text-[11px] text-gray-400">Reviewed by {c.quality_review.reviewed_by}, {fmtDateTime(c.quality_review.reviewed_at)}</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">Awaiting review by QA or the Responsible Pharmacist.</p>
                )}
              </SideCard>
            )}
          </div>
        </div>
      </div>

      {resolveOpen && (
        <Modal title={`Resolve ${c.ref}`} onClose={() => setResolveOpen(false)}>
          <p className="text-sm text-gray-600 mb-3">
            Explain the outcome for the customer. This is added to the conversation and emailed to them. They can confirm and rate it, or reopen it by replying. It closes automatically after 7 days.
          </p>
          <Textarea rows={5} value={resolveNote} onChange={(e) => setResolveNote(e.target.value)} placeholder="What we did and the outcome" />
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setResolveOpen(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doResolve} loading={busy} disabled={resolveNote.trim().length < 3}>Resolve and Notify Customer</BtnPrimary>
          </div>
        </Modal>
      )}
      {closeOpen && (
        <Modal title={`Close ${c.ref}`} onClose={() => setCloseOpen(false)}>
          <p className="text-sm text-gray-600 mb-3">
            Close this request without sending the customer a resolution, for example a duplicate or a request handled another way. The customer is not emailed.
          </p>
          <FormGroup label="Internal reason">
            <Input value={closeNote} onChange={(e) => setCloseNote(e.target.value)} placeholder="e.g. Duplicate of SUP-00012" />
          </FormGroup>
          <div className="flex justify-end gap-2 mt-2">
            <BtnSecondary onClick={() => setCloseOpen(false)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doClose} loading={busy}>Close Request</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}
