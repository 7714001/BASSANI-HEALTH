import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  CheckCircle, XCircle, Clock, ArrowLeft, Building2, User,
  MapPin, ClipboardList, FileText, Download, Loader2, AlertTriangle, Eye, X, Link2, Mail,
} from "lucide-react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import { Spinner, fmtDate } from "../components/UI";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:       { label: "Pending Review",  cls: "bg-amber-50 text-amber-700 border-amber-200",  dot: "bg-amber-400",  icon: Clock },
  awaiting_docs: { label: "Awaiting Docs",   cls: "bg-amber-50 text-amber-700 border-amber-200",  dot: "bg-amber-400",  icon: Clock },
  approved:      { label: "Approved",        cls: "bg-green-50  text-green-700  border-green-200",  dot: "bg-green-500",  icon: CheckCircle },
  rejected:      { label: "Rejected",        cls: "bg-red-50    text-red-700    border-red-200",    dot: "bg-red-500",    icon: XCircle },
};

function StatusBadge({ status, size = "md" }) {
  const cfg  = STATUS_CFG[status] || STATUS_CFG.pending;
  const Icon = cfg.icon;
  const cls  = size === "lg"
    ? "text-sm px-3 py-1.5 gap-1.5"
    : "text-[11px] px-2.5 py-1 gap-1";
  return (
    <span className={`inline-flex items-center font-semibold rounded-full border ${cfg.cls} ${cls}`}>
      <Icon size={size === "lg" ? 14 : 11} />
      {cfg.label}
    </span>
  );
}

// ── Layout primitives ──────────────────────────────────────────────────────────

function Card({ icon: Icon, title, children, className = "" }) {
  return (
    <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden ${className}`}>
      <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-2">
        {Icon && <Icon size={15} className="text-bassani-600 shrink-0" />}
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Row({ label, value, mono = false }) {
  if (!value) return null;
  return (
    <div className="flex justify-between py-2.5 border-b border-gray-50 last:border-0 gap-4">
      <span className="text-xs text-gray-400 font-medium shrink-0">{label}</span>
      <span className={`text-xs font-semibold text-gray-800 text-right ${mono ? "font-mono" : ""}`}>{value}</span>
    </div>
  );
}

function MetaRow({ label, value }) {
  return (
    <div className="py-2.5 border-b border-gray-50 last:border-0">
      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5">{label}</p>
      <p className="text-sm font-semibold text-gray-800">{value || "—"}</p>
    </div>
  );
}

// ── PDF viewer modal ───────────────────────────────────────────────────────────

function PdfViewer({ doc, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl" style={{ height: "90vh" }}
        onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText size={15} className="text-bassani-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900 truncate">{doc.label || doc.doc_type}</p>
              {doc.filename && <p className="text-[10px] text-gray-400 truncate">{doc.filename}</p>}
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0 ml-4">
            <a href={doc.download_url} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
              <Download size={12} /> Download
            </a>
            <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
              <X size={18} />
            </button>
          </div>
        </div>
        {/* PDF iframe */}
        <iframe
          src={doc.download_url}
          title={doc.label || doc.doc_type}
          className="flex-1 w-full rounded-b-2xl"
          style={{ border: "none" }}
        />
      </div>
    </div>
  );
}

// ── Documents section ──────────────────────────────────────────────────────────

function DocumentsCard({ appId }) {
  const [docs,    setDocs   ] = useState(null);
  const [loading, setLoading] = useState(true);
  const [viewing, setViewing] = useState(null);

  useEffect(() => {
    api.get(`/api/onboarding/${appId}/documents`)
      .then(r => setDocs(r.data.documents || []))
      .catch(() => setDocs([]))
      .finally(() => setLoading(false));
  }, [appId]);

  return (
    <>
      {viewing && <PdfViewer doc={viewing} onClose={() => setViewing(null)} />}
      <Card icon={FileText} title="Supporting Documents">
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
            <Loader2 size={13} className="animate-spin" /> Loading documents…
          </div>
        ) : !docs || docs.length === 0 ? (
          <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
            <AlertTriangle size={14} className="text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700 font-medium">No documents were uploaded with this application.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {docs.map((d, i) => (
              <div key={i} className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 bg-bassani-50 rounded-lg flex items-center justify-center shrink-0">
                    <FileText size={14} className="text-bassani-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-semibold text-gray-800 truncate">{d.label || d.doc_type}</p>
                    {d.filename && <p className="text-[10px] text-gray-400 truncate mt-0.5">{d.filename}</p>}
                  </div>
                </div>
                {d.download_url ? (
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <button onClick={() => setViewing(d)}
                      className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
                      <Eye size={12} /> View
                    </button>
                    <a href={d.download_url} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors">
                      <Download size={12} /> Download
                    </a>
                  </div>
                ) : (
                  <span className="text-[10px] text-gray-400 shrink-0 ml-4">Unavailable</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ── Actions sidebar ────────────────────────────────────────────────────────────

function ActionsCard({ app, canApprove, canReject, onApprove, onReject, onUpdate, navigate }) {
  const [rejectMode,      setRejectMode     ] = useState(false);
  const [rejectReason,    setRejectReason   ] = useState("");
  const [companyName,     setCompanyName    ] = useState(app.company_name || "");
  const [loading,         setLoading        ] = useState(false);
  const [contactMode,     setContactMode    ] = useState(false);
  const [contactSubject,  setContactSubject ] = useState("");
  const [contactMessage,  setContactMessage ] = useState("");
  const [contactSending,  setContactSending ] = useState(false);

  const isAwaitingDocs = app.status === "awaiting_docs";
  const isActionable   = app.status === "pending" || isAwaitingDocs;

  if (!isActionable) {
    return (
      <Card title="Decision">
        <MetaRow label="Outcome"     value={STATUS_CFG[app.status]?.label} />
        <MetaRow label="Reviewed by" value={app.reviewed_by} />
        <MetaRow label="Reviewed on" value={app.reviewed_at ? fmtDate(app.reviewed_at) : null} />
        {app.rejection_reason && (
          <div className="mt-3 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1">Rejection Reason</p>
            <p className="text-xs text-red-700">{app.rejection_reason}</p>
          </div>
        )}
      </Card>
    );
  }

  const handleApprove = async () => {
    if (isAwaitingDocs && !companyName.trim()) {
      toast.error("Enter the customer / company name before approving");
      return;
    }
    setLoading(true);
    try { await onApprove(isAwaitingDocs ? companyName.trim() : undefined); } finally { setLoading(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return toast.error("Enter a reason for rejection");
    setLoading(true);
    try { await onReject(rejectReason.trim()); } finally { setLoading(false); }
  };

  const handleContact = async () => {
    if (!contactMessage.trim()) return toast.error("Enter a message");
    setContactSending(true);
    try {
      const r = await api.post(`/api/onboarding/${app.id}/contact`, {
        subject: contactSubject.trim(),
        message: contactMessage.trim(),
      });
      onUpdate({ inbox_thread_id: r.data.inbox_thread_id });
      toast.success("Message sent");
      setContactMode(false);
      setContactSubject("");
      setContactMessage("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send message");
    } finally {
      setContactSending(false);
    }
  };

  return (
    <Card title="Actions">
      {/* Inbox thread link — show whenever a thread has been started */}
      {app.inbox_thread_id && !contactMode && !rejectMode && (
        <div className="mb-4 -mt-1">
          <button
            onClick={() => navigate(`/onboarding-inbox?thread=${app.inbox_thread_id}`)}
            className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-xl transition-colors border border-gray-200"
          >
            <Mail size={13} /> View Inbox Thread
          </button>
        </div>
      )}

      {contactMode ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">To</label>
            <p className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 truncate">
              {app.contact_email || "No email on record"}
            </p>
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">Subject</label>
            <input
              value={contactSubject}
              onChange={e => setContactSubject(e.target.value)}
              placeholder={`Your application: ${app.company_name || app.contact_name || app.id}`}
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-bassani-300 placeholder-gray-400"
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Message <span className="text-red-400">*</span>
            </label>
            <textarea
              value={contactMessage}
              onChange={e => setContactMessage(e.target.value)}
              rows={5}
              autoFocus
              placeholder="Write your message to the applicant…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-bassani-300 resize-none placeholder-gray-400"
            />
            <p className="text-[10px] text-gray-400 mt-1">
              Sent from the onboarding mailbox. Replies land in Onboarding Inbox and are linked to this application.
            </p>
          </div>
          <button onClick={handleContact} disabled={contactSending || !contactMessage.trim()}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
            {contactSending ? <Loader2 size={14} className="animate-spin" /> : <Mail size={14} />}
            Send Message
          </button>
          <button onClick={() => { setContactMode(false); setContactSubject(""); setContactMessage(""); }}
            disabled={contactSending}
            className="w-full px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
            Cancel
          </button>
        </div>
      ) : rejectMode ? (
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-semibold text-gray-600 mb-1.5">
              Reason for rejection <span className="text-red-400">*</span>
            </label>
            <textarea
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              rows={4}
              autoFocus
              placeholder="Provide a clear reason — this will be visible to the reseller…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-200 resize-none placeholder-gray-400"
            />
          </div>
          <button onClick={handleReject} disabled={loading}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
            {loading ? <Loader2 size={14} className="animate-spin" /> : <XCircle size={14} />}
            Confirm Rejection
          </button>
          <button onClick={() => { setRejectMode(false); setRejectReason(""); }} disabled={loading}
            className="w-full px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
            Cancel
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Company name input — required for inbox-sourced (awaiting_docs) apps */}
          {isAwaitingDocs && (
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Customer / Company Name <span className="text-red-400">*</span>
              </label>
              <input
                value={companyName}
                onChange={e => setCompanyName(e.target.value)}
                placeholder="Registered company name for Odoo"
                className="w-full px-3 py-2 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-bassani-300 placeholder-gray-400"
              />
              <p className="text-[10px] text-gray-400 mt-1">
                This application arrived via email. Enter the company name before approving.
              </p>
            </div>
          )}

          {canApprove && (
            <button onClick={handleApprove} disabled={loading || (isAwaitingDocs && !companyName.trim())}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors">
              {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Approve & Create Customer
            </button>
          )}

          {/* Contact applicant — only when no thread exists yet */}
          {!app.inbox_thread_id && canApprove && (
            <button onClick={() => setContactMode(true)} disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-50 hover:bg-gray-100 text-gray-700 text-sm font-semibold rounded-xl transition-colors border border-gray-200">
              <Mail size={14} />
              Contact Applicant
            </button>
          )}

          {canReject && (
            <button onClick={() => setRejectMode(true)} disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 text-sm font-semibold rounded-xl transition-colors border border-red-100">
              <XCircle size={14} />
              Reject Application
            </button>
          )}
          {!canApprove && !canReject && (
            <p className="text-xs text-gray-400 text-center py-2">You do not have permission to action this application.</p>
          )}
        </div>
      )}
    </Card>
  );
}

// ── Main view ──────────────────────────────────────────────────────────────────

export default function CustomerApplicationDetail() {
  const { id }       = useParams();
  const navigate     = useNavigate();
  const { can }      = useAuth();
  const [app,     setApp    ] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/api/onboarding/${id}`)
      .then(r => setApp(r.data))
      .catch(() => { toast.error("Application not found"); navigate("/applications"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const approve = async (companyName) => {
    try {
      const body = companyName ? { company_name: companyName } : {};
      await api.put(`/api/onboarding/${id}/approve`, body);
      toast.success("Customer approved and created");
      setApp(prev => ({
        ...prev,
        status: "approved",
        company_name: companyName || prev.company_name,
      }));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Approval failed");
      throw e;
    }
  };

  const reject = async (reason) => {
    try {
      await api.put(`/api/onboarding/${id}/reject`, { reason });
      toast.success("Application rejected");
      setApp(prev => ({ ...prev, status: "rejected", rejection_reason: reason }));
    } catch (e) {
      toast.error(e.response?.data?.detail || "Rejection failed");
      throw e;
    }
  };

  const updateApp = (fields) => {
    setApp(prev => ({ ...prev, ...fields }));
  };

  if (loading) return (
    <div className="flex items-center justify-center flex-1">
      <Spinner size="lg" />
    </div>
  );

  if (!app) return null;

  const address = [app.street, app.suburb, app.city, app.province, app.postal_code, app.country]
    .filter(Boolean).join(", ");

  return (
    <div className="flex flex-col flex-1 overflow-hidden">

      {/* Page header */}
      <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-4">
        <button onClick={() => navigate("/applications")}
          className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-700 font-medium mb-3 transition-colors">
          <ArrowLeft size={13} /> Back to Applications
        </button>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-lg font-bold text-gray-900">
                {app.company_name || app.contact_name || "Unnamed Application"}
              </h1>
              {app.trading_name && (
                <span className="text-xs text-gray-400 font-medium">t/a {app.trading_name}</span>
              )}
              {app.source === "inbox" && !app.company_name && (
                <span className="text-[11px] text-amber-700 font-semibold bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
                  Company name required before approval
                </span>
              )}
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-mono text-xs text-bassani-700 font-semibold bg-bassani-50 px-2 py-0.5 rounded-md">
                {app.id}
              </span>
              <StatusBadge status={app.status} size="md" />
              {app.reseller_name && (
                <span className="text-xs text-gray-400">
                  Submitted by <strong className="text-gray-600">{app.reseller_name}</strong> · {fmtDate(app.submitted_at)}
                </span>
              )}
              {app.inbox_thread_id && (
                <button
                  onClick={() => navigate(`/onboarding-inbox?thread=${app.inbox_thread_id}`)}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-600 font-medium bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 hover:bg-blue-100 transition-colors"
                >
                  <Mail size={9} /> View inbox thread
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-6xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

            {/* Main content — left 2/3 */}
            <div className="lg:col-span-2 space-y-5">

              <Card icon={Building2} title="Business Details">
                <Row label="Registered Company Name" value={app.company_name} />
                <Row label="Trading Name"             value={app.trading_name} />
                <Row label="Business Type"            value={app.business_type} />
                <Row label="Registration Number"      value={app.registration_number} mono />
                <Row label="VAT Number"               value={app.vat_number} mono />
              </Card>

              <Card icon={User} title="Primary Contact">
                <Row label="Full Name"    value={app.contact_name} />
                <Row label="Position"     value={app.contact_position} />
                <Row label="Email"        value={app.contact_email} />
                <Row label="Phone"        value={app.contact_phone} />
                <Row label="Alt. Phone"   value={app.contact_alt_phone} />
              </Card>

              <Card icon={MapPin} title="Business Address">
                <Row label="Address" value={address} />
              </Card>

              {(app.ordering_volume || app.referral_source || app.notes) && (
                <Card icon={ClipboardList} title="Additional Information">
                  <Row label="Monthly Order Volume" value={app.ordering_volume} />
                  <Row label="Referral Source"      value={app.referral_source} />
                  {app.notes && (
                    <div className="pt-3 mt-1">
                      <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Notes</p>
                      <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">{app.notes}</p>
                    </div>
                  )}
                </Card>
              )}

              <DocumentsCard appId={app.id} />

            </div>

            {/* Sidebar — right 1/3 */}
            <div className="space-y-5">

              <Card title="Application Details">
                <MetaRow label="Reference"    value={app.id} />
                <MetaRow label="Status"       value={<StatusBadge status={app.status} size="md" />} />
                <MetaRow label="Business Type" value={app.business_type} />
                <MetaRow label="Submitted by" value={app.reseller_name} />
                <MetaRow label="Submitted on" value={fmtDate(app.submitted_at)} />
              </Card>

              <ActionsCard
                app={app}
                canApprove={can("customers.approve_onboarding")}
                canReject={can("customers.reject_onboarding")}
                onApprove={approve}
                onReject={reject}
                onUpdate={updateApp}
                navigate={navigate}
              />

            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
