import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronDown, ShoppingCart, FileText, TrendingUp, AlertCircle, CreditCard, User, Pencil, Plus, Download, Upload, Trash2, Loader2, Mail } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";
import { Badge, BtnPrimary, BtnSecondary, Input, Select, Modal, FormGroup, LoadingState, PaginationBar, fmtR, fmtDate } from "../components/UI";

function KpiCard({ label, value, sub, icon: Icon, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-start gap-4">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${accent}`}>
        <Icon size={18} className="text-white" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-400 font-medium mb-0.5">{label}</p>
        <p className="text-xl font-bold text-gray-900 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Section({ title, actions, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-50 flex items-center justify-between gap-3">
        <h3 className="font-semibold text-gray-800 text-sm">{title}</h3>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      {children}
    </div>
  );
}

// ── Customer Documents Section ─────────────────────────────────────────────────

const ONBOARDING_DOC_TYPES = [
  { key: "store_onboarding_agreement", label: "Signed Store Onboarding Agreement" },
  { key: "customer_information_form",  label: "Signed Customer Information Form"  },
  { key: "nda",                        label: "Signed NDA"                        },
  { key: "tqa",                        label: "Signed TQA Document"               },
  { key: "cipc_certificate",           label: "CIPC Company Registration Certificate" },
];

const KNOWN_DOC_KEYS = new Set(ONBOARDING_DOC_TYPES.map(d => d.key));

function docProvenance(doc) {
  if (!doc) return "";
  const when = doc.uploaded_at ? fmtDate(doc.uploaded_at) : "";
  const by   = doc.uploaded_by ? ` · ${doc.uploaded_by}` : "";
  const src  = doc.source === "inbox"       ? "Via inbox"
             : doc.source === "onboarding"  ? "Onboarding application"
             : "Admin upload";
  return `${src}${by} · ${when}`;
}

const SOURCE_BADGE = {
  inbox:      { label: "Inbox",        cls: "bg-blue-50 text-blue-700"      },
  admin:      { label: "Admin Upload", cls: "bg-purple-50 text-purple-700"  },
  onboarding: { label: "Onboarding",   cls: "bg-bassani-50 text-bassani-700"},
};

function DocumentsSection({ customerId, canUpload, onSendDocs, sendingDocs, docsSentInfo, canSendDocs }) {
  const [docs,             setDocs            ] = useState([]);
  const [docsLoading,      setDocsLoading     ] = useState(true);
  const [uploading,        setUploading       ] = useState(null); // doc_type key or "custom"
  const [deleting,         setDeleting        ] = useState(null);
  const [showCustomUpload, setShowCustomUpload] = useState(false);
  const [customLabel,      setCustomLabel     ] = useState("");
  const fileInputRef  = useRef(null);   // hidden input for structured doc types
  const customFileRef = useRef(null);   // visible input for custom/additional docs
  const pendingType   = useRef(null);   // which doc_type is queued for upload

  const loadDocs = () => {
    setDocsLoading(true);
    api.get(`/api/customers/${customerId}/documents`)
      .then(r => setDocs(r.data.documents || []))
      .catch(() => toast.error("Failed to load documents"))
      .finally(() => setDocsLoading(false));
  };

  useEffect(() => { loadDocs(); }, [customerId]); // eslint-disable-line

  const triggerStructuredUpload = (docTypeKey) => {
    pendingType.current = docTypeKey;
    fileInputRef.current?.click();
  };

  const handleStructuredUpload = async (file) => {
    const dtKey  = pendingType.current;
    const dtMeta = ONBOARDING_DOC_TYPES.find(d => d.key === dtKey);
    if (!dtKey || !dtMeta) return;
    setUploading(dtKey);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(
        `/api/customers/${customerId}/documents/upload?label=${encodeURIComponent(dtMeta.label)}&doc_type=${dtKey}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      toast.success(`${dtMeta.label} uploaded`);
      loadDocs();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(null);
      pendingType.current = null;
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleCustomUpload = async (file) => {
    if (!customLabel.trim()) return toast.error("Enter a document label first");
    setUploading("custom");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(
        `/api/customers/${customerId}/documents/upload?label=${encodeURIComponent(customLabel.trim())}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      toast.success("Document uploaded");
      setCustomLabel("");
      setShowCustomUpload(false);
      loadDocs();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(null);
      if (customFileRef.current) customFileRef.current.value = "";
    }
  };

  const handleDelete = async (doc) => {
    setDeleting(doc.id);
    try {
      await api.delete(`/api/customers/${customerId}/documents/${doc.id}`);
      toast.success("Document removed");
      setDocs(prev => prev.filter(d => d.id !== doc.id));
    } catch {
      toast.error("Failed to remove document");
    } finally {
      setDeleting(null);
    }
  };

  const docByType  = Object.fromEntries(ONBOARDING_DOC_TYPES.map(dt => [dt.key, docs.find(d => d.doc_type === dt.key) || null]));
  const otherDocs  = docs.filter(d => !KNOWN_DOC_KEYS.has(d.doc_type));
  const uploadedCount = ONBOARDING_DOC_TYPES.filter(dt => docByType[dt.key]).length;

  const allOnboardingComplete = uploadedCount === ONBOARDING_DOC_TYPES.length;
  const sendDocsAction = canSendDocs && !allOnboardingComplete ? (
    <div className="flex items-center gap-2">
      {docsSentInfo?.sent && (
        <span className="text-[11px] text-gray-400 whitespace-nowrap hidden sm:block">
          Sent {fmtDate(docsSentInfo.sent_at)}
        </span>
      )}
      <BtnSecondary size="sm" onClick={onSendDocs} disabled={sendingDocs}>
        {sendingDocs ? <Loader2 size={13} className="animate-spin" /> : <Mail size={13} />}
        Send Onboarding Docs
      </BtnSecondary>
    </div>
  ) : null;

  return (
    <Section
      title={`Documents (${uploadedCount} / ${ONBOARDING_DOC_TYPES.length} onboarding${otherDocs.length ? ` + ${otherDocs.length} other` : ""})`}
      actions={sendDocsAction}
    >
      {/* Hidden file input — triggered programmatically for structured doc types */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
        className="hidden"
        onChange={e => { if (e.target.files[0]) handleStructuredUpload(e.target.files[0]); }}
      />

      {docsLoading ? (
        <p className="text-sm text-gray-400 px-5 py-4">Loading…</p>
      ) : (
        <>
          {/* Structured onboarding doc type rows */}
          <div className="divide-y divide-gray-50">
            {ONBOARDING_DOC_TYPES.map(dt => {
              const doc        = docByType[dt.key];
              const isUploading = uploading === dt.key;
              return (
                <div key={dt.key} className="flex items-center gap-3 px-5 py-3">
                  <div className={`w-2 h-2 rounded-full shrink-0 mt-0.5 ${doc ? "bg-green-400" : "bg-gray-200"}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-gray-800">{dt.label}</p>
                    {doc && (
                      <>
                        <p className="text-[10px] text-gray-500 truncate mt-0.5">{doc.filename}</p>
                        <p className="text-[10px] text-gray-400 truncate">{docProvenance(doc)}</p>
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {isUploading ? (
                      <Loader2 size={13} className="animate-spin text-bassani-600" />
                    ) : doc ? (
                      <>
                        {doc.download_url && (
                          <a href={doc.download_url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
                            <Download size={12} /> Download
                          </a>
                        )}
                        {canUpload && (
                          <>
                            <button onClick={() => triggerStructuredUpload(dt.key)}
                              className="flex items-center gap-1 text-xs text-gray-400 hover:text-bassani-600 transition-colors">
                              <Upload size={12} /> Replace
                            </button>
                            <button onClick={() => handleDelete(doc)} disabled={deleting === doc.id}
                              className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50">
                              {deleting === doc.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                            </button>
                          </>
                        )}
                      </>
                    ) : canUpload ? (
                      <button onClick={() => triggerStructuredUpload(dt.key)}
                        className="flex items-center gap-1 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
                        <Upload size={12} /> Upload
                      </button>
                    ) : (
                      <span className="text-[10px] text-gray-400">Not uploaded</span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Other docs: inbox-saved or custom uploads that don't map to a known type */}
          {otherDocs.length > 0 && (
            <div className="border-t border-gray-50">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider px-5 pt-3 pb-1">Additional Documents</p>
              <div className="divide-y divide-gray-50">
                {otherDocs.map((d, i) => {
                  const badge = SOURCE_BADGE[d.source] || SOURCE_BADGE.admin;
                  return (
                    <div key={d.id || i} className="flex items-center gap-3 px-5 py-3">
                      <FileText size={14} className="text-gray-300 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-800 truncate">{d.label || d.doc_type || "Document"}</p>
                        {d.filename && <p className="text-[10px] text-gray-500 truncate mt-0.5">{d.filename}</p>}
                        <p className="text-[10px] text-gray-400 truncate">{docProvenance(d)}</p>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {d.download_url ? (
                          <a href={d.download_url} target="_blank" rel="noreferrer"
                            className="flex items-center gap-1 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
                            <Download size={12} /> Download
                          </a>
                        ) : (
                          <span className="text-[10px] text-gray-400">Unavailable</span>
                        )}
                        {canUpload && d.source !== "inbox" && (
                          <button onClick={() => handleDelete(d)} disabled={deleting === d.id}
                            className="text-gray-300 hover:text-red-500 transition-colors disabled:opacity-50">
                            {deleting === d.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Upload additional / custom document */}
          {canUpload && (
            <div className="px-5 py-3 border-t border-gray-50 space-y-3">
              {!showCustomUpload ? (
                <button onClick={() => setShowCustomUpload(true)}
                  className="flex items-center gap-1.5 text-sm text-bassani-600 hover:text-bassani-700 font-medium transition-colors">
                  <Upload size={14} /> Upload additional document
                </button>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  <div className="flex-1 min-w-40">
                    <p className="text-xs text-gray-400 mb-1">Document label</p>
                    <Input
                      value={customLabel}
                      onChange={e => setCustomLabel(e.target.value)}
                      placeholder="e.g. Letter of Good Standing"
                      autoFocus
                    />
                  </div>
                  <div>
                    <p className="text-xs text-gray-400 mb-1">File</p>
                    <input ref={customFileRef} type="file"
                      accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                      disabled={uploading === "custom"}
                      onChange={e => { if (e.target.files[0]) handleCustomUpload(e.target.files[0]); }}
                      className="block text-xs text-gray-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:text-xs file:font-semibold file:bg-bassani-50 file:text-bassani-700 hover:file:bg-bassani-100 cursor-pointer disabled:opacity-50"
                    />
                  </div>
                  {uploading === "custom" && <Loader2 size={16} className="animate-spin text-bassani-600 mb-1.5" />}
                  <button onClick={() => { setShowCustomUpload(false); setCustomLabel(""); }}
                    className="text-xs text-gray-400 hover:text-gray-600 mb-1.5 transition-colors">
                    Cancel
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </Section>
  );
}

const STATE_LABEL = { draft:"Quotation", sale:"Confirmed", done:"Done", cancel:"Cancelled", sent:"Sent" };
const PAYMENT_LABEL = { not_paid:"Unpaid", partial:"Partial", in_payment:"In Payment", paid:"Paid" };
const PAYMENT_COLOR = { not_paid:"text-red-600", partial:"text-amber-600", in_payment:"text-blue-600", paid:"text-green-600" };

export default function CustomerProfile() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const canManageAddresses = user?.permissions?.customers?.manage;

  const INV_PAGE_SIZE  = 10;
  const STMT_PAGE_SIZE = 15;

  const [data,         setData        ] = useState(null);
  const [loading,      setLoading     ] = useState(true);
  const [stmt,         setStmt        ] = useState(null);
  const [stmtLoading,  setStmtLoading ] = useState(false);
  const [stmtFrom,     setStmtFrom    ] = useState("");
  const [stmtTo,       setStmtTo      ] = useState("");
  const [invPage,      setInvPage     ] = useState(0);
  const [stmtPage,     setStmtPage    ] = useState(0);

  // ── Addresses ─────────────────────────────────────────────────────────────
  const [addresses,  setAddresses ] = useState([]);
  const [addrLoading,setAddrLoading] = useState(false);
  const [addrModal,  setAddrModal ] = useState(false);
  const [addrTarget, setAddrTarget] = useState(null);
  const [addrForm,   setAddrForm  ] = useState({ name: "", type: "delivery", street: "", street2: "", city: "", zip: "", phone: "", email: "" });
  const [addrSaving, setAddrSaving] = useState(false);

  const [sendingDocs,  setSendingDocs ] = useState(false);
  const [docsSentInfo, setDocsSentInfo] = useState(null); // { sent, sent_at, sent_by, to_email }

  useEffect(() => {
    api.get(`/api/customers/${id}/profile`)
      .then(r => setData(r.data))
      .catch(() => { toast.error("Failed to load customer profile"); navigate("/customers"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    if (!can("onboarding.inbox")) return;
    api.get(`/api/customers/${id}/docs-sent-history`)
      .then(r => setDocsSentInfo(r.data))
      .catch(() => {});
  }, [id]); // eslint-disable-line

  useEffect(() => {
    setAddrLoading(true);
    api.get(`/api/customers/${id}/addresses`)
      .then(r => setAddresses(r.data.addresses || []))
      .catch(() => {})
      .finally(() => setAddrLoading(false));
  }, [id]);

  const loadAddresses = () => {
    setAddrLoading(true);
    api.get(`/api/customers/${id}/addresses`)
      .then(r => setAddresses(r.data.addresses || []))
      .catch(() => {})
      .finally(() => setAddrLoading(false));
  };

  const openAddrCreate = () => {
    setAddrForm({ name: "", type: "delivery", street: "", street2: "", city: "", zip: "", phone: "", email: "" });
    setAddrTarget(null);
    setAddrModal(true);
  };

  const openAddrEdit = (addr) => {
    setAddrForm({
      name: addr.name || "", type: addr.type || "delivery",
      street: addr.street || "", street2: addr.street2 || "",
      city: addr.city || "", zip: addr.zip || "",
      phone: addr.phone || "", email: addr.email || "",
    });
    setAddrTarget(addr);
    setAddrModal(true);
  };

  const saveAddr = async () => {
    if (!addrForm.name.trim()) return toast.error("Name is required");
    setAddrSaving(true);
    try {
      if (addrTarget) {
        await api.put(`/api/customers/${id}/addresses/${addrTarget.id}`, addrForm);
        toast.success("Address updated");
      } else {
        await api.post(`/api/customers/${id}/addresses`, addrForm);
        toast.success("Address added");
      }
      setAddrModal(false);
      loadAddresses();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save address");
    } finally {
      setAddrSaving(false);
    }
  };

  const handleSendDocs = async () => {
    const email = data?.customer?.email;
    const name  = data?.customer?.name;
    if (!email) return;

    if (docsSentInfo?.sent) {
      const sentAt  = new Date(docsSentInfo.sent_at);
      const ageMs   = Date.now() - sentAt.getTime();
      const ageDays = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays < 7) {
        const when = fmtDate(docsSentInfo.sent_at);
        const who  = docsSentInfo.sent_by;
        if (!window.confirm(
          `Onboarding documents were already sent to ${email} on ${when} by ${who}.\n\nSend again?`
        )) return;
      }
    }

    setSendingDocs(true);
    try {
      await api.post("/api/onboarding-inbox/send-docs", {
        to_email:        email,
        customer_name:   name,
        odoo_partner_id: parseInt(id),
      });
      toast.success(`Onboarding documents sent to ${email}`);
      api.get(`/api/customers/${id}/docs-sent-history`)
        .then(r => setDocsSentInfo(r.data))
        .catch(() => {});
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send documents");
    } finally {
      setSendingDocs(false);
    }
  };

  const loadStatement = async () => {
    setStmtLoading(true);
    try {
      const params = {};
      if (stmtFrom) params.date_from = stmtFrom;
      if (stmtTo)   params.date_to   = stmtTo;
      const r = await api.get(`/api/customers/${id}/statement`, { params });
      setStmt(r.data);
      setStmtPage(0);
    } catch {
      toast.error("Failed to load account statement");
    } finally {
      setStmtLoading(false);
    }
  };

  useEffect(() => { loadStatement(); }, [id]); // eslint-disable-line

  if (loading) return <LoadingState />;
  if (!data)   return null;

  const { customer: c, stats, recent_orders, outstanding_invoices, ownership } = data;
  const invSlice  = outstanding_invoices.slice(invPage * INV_PAGE_SIZE,  (invPage  + 1) * INV_PAGE_SIZE);
  const typeMatch = c.comment?.match(/Type: (\w+)/);
  const customerType = typeMatch?.[1] || null;
  const isSection21 = c.comment?.includes("Section 21: Registered");
  const creditPct = stats.credit_utilisation;
  const creditBarColor = !creditPct ? "bg-bassani-600"
    : creditPct >= 90 ? "bg-red-500"
    : creditPct >= 70 ? "bg-amber-500"
    : "bg-bassani-600";

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="border-b border-gray-100 bg-white px-6 py-3 flex items-center justify-between gap-4 shrink-0">
        <button onClick={() => navigate("/customers")}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
          <ChevronDown size={14} className="-rotate-90" />Back to Customers
        </button>
        <div className="flex items-center gap-2">
          <BtnSecondary size="sm" onClick={() => navigate(`/invoices`)}>View Invoices</BtnSecondary>
          <BtnPrimary size="sm" onClick={() => navigate("/orders")}>Place Order</BtnPrimary>
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-5xl mx-auto space-y-5">

          {/* Customer header */}
          <div className="bg-white rounded-2xl border border-gray-100 p-6">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-14 h-14 rounded-2xl bg-bassani-600 flex items-center justify-center shrink-0">
                  <span className="text-white text-xl font-bold">
                    {c.name?.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h1 className="text-xl font-bold text-gray-900">{c.name}</h1>
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    {customerType && (
                      <span className="text-xs bg-bassani-50 text-bassani-700 px-2 py-0.5 rounded-full font-medium">{customerType}</span>
                    )}
                    {isSection21 && (
                      <span className="text-xs bg-green-50 text-green-700 px-2 py-0.5 rounded-full font-medium">Section 21</span>
                    )}
                    {c.credit_hold && (
                      <span title="Over their Odoo credit limit — order confirmation requires an admin override" className="text-xs bg-red-50 text-red-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                        <AlertCircle size={11} />Credit Hold
                      </span>
                    )}
                    {ownership?.reseller_name && (
                      <span className="text-xs bg-purple-50 text-purple-700 px-2 py-0.5 rounded-full font-medium">
                        Via {ownership.reseller_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-6 text-sm">
                {c.email && <div><p className="text-xs text-gray-400 mb-0.5">Email</p><p className="font-medium text-gray-700">{c.email}</p></div>}
                {c.phone && <div><p className="text-xs text-gray-400 mb-0.5">Phone</p><p className="font-medium text-gray-700">{c.phone}</p></div>}
                {c.city  && <div><p className="text-xs text-gray-400 mb-0.5">City</p><p className="font-medium text-gray-700">{c.city}</p></div>}
                {c.property_payment_term_id && <div><p className="text-xs text-gray-400 mb-0.5">Terms</p><p className="font-medium text-gray-700">{c.property_payment_term_id[1]}</p></div>}
              </div>
            </div>

            {/* Credit bar */}
            {stats.credit_limit > 0 && (
              <div className="mt-5 pt-5 border-t border-gray-50">
                <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                  <span>Credit used: <strong className="text-gray-700">{fmtR(stats.outstanding_balance)}</strong></span>
                  <span>Limit: <strong className="text-gray-700">{fmtR(stats.credit_limit)}</strong></span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${creditBarColor}`}
                    style={{ width: `${Math.min(creditPct || 0, 100)}%` }} />
                </div>
                {creditPct >= 90 && (
                  <p className="text-xs text-red-600 mt-1 flex items-center gap-1">
                    <AlertCircle size={11} />Credit limit {creditPct >= 100 ? "exceeded" : "nearly reached"} ({creditPct}%)
                  </p>
                )}
              </div>
            )}
          </div>

          {/* KPI cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <KpiCard label="Lifetime Orders"   value={stats.total_orders}             sub="Confirmed orders"           icon={ShoppingCart} accent="bg-bassani-600" />
            <KpiCard label="Lifetime Spend"    value={fmtR(stats.total_spend)}        sub="Excl. cancelled"            icon={TrendingUp}   accent="bg-emerald-500" />
            <KpiCard label="This Month"        value={fmtR(stats.revenue_this_month)} sub={`${stats.orders_this_month} orders`} icon={CreditCard} accent="bg-blue-500" />
            <KpiCard label="Outstanding"       value={fmtR(stats.outstanding_balance)} sub={`${stats.outstanding_invoices} invoice${stats.outstanding_invoices !== 1 ? "s" : ""}`} icon={FileText} accent={stats.outstanding_balance > 0 ? "bg-red-500" : "bg-gray-400"} />
            {stats.credit_limit > 0 && (
              <KpiCard label="Credit Limit"    value={fmtR(stats.credit_limit)}       sub={creditPct != null ? `${creditPct}% used` : "No usage"} icon={CreditCard} accent="bg-violet-500" />
            )}
            {ownership && (
              <KpiCard label="Account Manager" value={ownership.reseller_name}        sub="Onboarded via reseller"     icon={User}         accent="bg-purple-500" />
            )}
          </div>

          {/* Addresses */}
          <Section title={`Addresses (${addresses.length})`}>
            {addrLoading ? (
              <p className="text-sm text-gray-400 px-5 py-4">Loading…</p>
            ) : addresses.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No addresses on file.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Name</th>
                    <th className="text-left px-5 py-2.5 font-medium">Type</th>
                    <th className="text-left px-5 py-2.5 font-medium">Street</th>
                    <th className="text-left px-5 py-2.5 font-medium">City / ZIP</th>
                    <th className="text-left px-5 py-2.5 font-medium">Phone</th>
                    {canManageAddresses && <th className="w-10" />}
                  </tr>
                </thead>
                <tbody>
                  {addresses.map(a => (
                    <tr key={a.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-medium text-gray-900">{a.name}</td>
                      <td className="px-5 py-3">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                          a.type === "delivery" ? "bg-blue-50 text-blue-700"
                          : a.type === "invoice" ? "bg-purple-50 text-purple-700"
                          : "bg-gray-100 text-gray-500"
                        }`}>
                          {a.type === "delivery" ? "Delivery" : a.type === "invoice" ? "Billing" : a.type || "Other"}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-gray-500">{[a.street, a.street2].filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-5 py-3 text-gray-500">{[a.city, a.zip].filter(Boolean).join(" ") || "—"}</td>
                      <td className="px-5 py-3 text-gray-500">{a.phone || "—"}</td>
                      {canManageAddresses && (
                        <td className="px-5 py-3">
                          <button onClick={() => openAddrEdit(a)} className="text-gray-400 hover:text-bassani-600 transition-colors p-1">
                            <Pencil size={13} />
                          </button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
            {canManageAddresses && (
              <div className="px-5 py-3 border-t border-gray-50">
                <button
                  onClick={openAddrCreate}
                  className="flex items-center gap-1.5 text-sm text-bassani-600 hover:text-bassani-700 font-medium transition-colors"
                >
                  <Plus size={14} />Add address
                </button>
              </div>
            )}
          </Section>

          {/* Documents */}
          <DocumentsSection
            customerId={id}
            canUpload={!!canManageAddresses}
            onSendDocs={handleSendDocs}
            sendingDocs={sendingDocs}
            docsSentInfo={docsSentInfo}
            canSendDocs={can("onboarding.inbox") && !!c.email}
          />

          {/* Recent orders */}
          <Section title={`Recent Orders (${recent_orders.length})`}>
            {recent_orders.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 text-xs text-gray-500">
                    <th className="text-left px-5 py-2.5 font-medium">Order #</th>
                    <th className="text-left px-5 py-2.5 font-medium">Date</th>
                    <th className="text-right px-5 py-2.5 font-medium">Total</th>
                    <th className="text-left px-5 py-2.5 font-medium">Status</th>
                    <th className="text-left px-5 py-2.5 font-medium">Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {recent_orders.map(o => (
                    <tr key={o.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                      <td className="px-5 py-3 font-mono text-xs text-bassani-700">{o.name}</td>
                      <td className="px-5 py-3 text-gray-500">{fmtDate(o.date_order?.split("T")[0])}</td>
                      <td className="px-5 py-3 text-right font-semibold">{fmtR(o.amount_total)}</td>
                      <td className="px-5 py-3"><Badge status={o.state} label={STATE_LABEL[o.state] || o.state} /></td>
                      <td className="px-5 py-3"><Badge status={o.invoice_status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            )}
          </Section>

          {/* Outstanding invoices */}
          <Section title={`Outstanding Invoices (${outstanding_invoices.length})`}>
            {outstanding_invoices.length === 0 ? (
              <p className="text-sm text-gray-400 px-5 py-4">No outstanding invoices.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-xs text-gray-500">
                      <th className="text-left px-5 py-2.5 font-medium">Invoice #</th>
                      <th className="text-left px-5 py-2.5 font-medium">Date</th>
                      <th className="text-left px-5 py-2.5 font-medium">Due</th>
                      <th className="text-right px-5 py-2.5 font-medium">Total</th>
                      <th className="text-right px-5 py-2.5 font-medium">Outstanding</th>
                      <th className="text-left px-5 py-2.5 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invSlice.map(inv => {
                      const overdue = inv.invoice_date_due && new Date(inv.invoice_date_due) < new Date();
                      return (
                        <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                          <td className="px-5 py-3 font-mono text-xs text-bassani-700">{inv.name}</td>
                          <td className="px-5 py-3 text-gray-500">{fmtDate(inv.invoice_date)}</td>
                          <td className={`px-5 py-3 font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
                            {fmtDate(inv.invoice_date_due)}{overdue ? " ⚠" : ""}
                          </td>
                          <td className="px-5 py-3 text-right">{fmtR(inv.amount_total)}</td>
                          <td className={`px-5 py-3 text-right font-semibold ${PAYMENT_COLOR[inv.payment_state] || ""}`}>
                            {fmtR(inv.amount_residual)}
                          </td>
                          <td className="px-5 py-3">
                            <span className="text-xs font-medium">{PAYMENT_LABEL[inv.payment_state] || inv.payment_state}</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                </div>
                <PaginationBar page={invPage} pageSize={INV_PAGE_SIZE} total={outstanding_invoices.length}
                  onChange={p => setInvPage(p)} />
              </>
            )}
          </Section>

          {/* Account Statement — 7.3 */}
          <Section title="Account Statement">
            <div className="px-5 py-4 border-b border-gray-50 flex flex-wrap items-end gap-3">
              <div>
                <p className="text-xs text-gray-400 mb-1">From</p>
                <Input type="date" value={stmtFrom} onChange={e => setStmtFrom(e.target.value)} className="w-36" />
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">To</p>
                <Input type="date" value={stmtTo} onChange={e => setStmtTo(e.target.value)} className="w-36" />
              </div>
              <BtnSecondary size="sm" onClick={loadStatement} disabled={stmtLoading}>
                {stmtLoading ? "Loading…" : "Load Statement"}
              </BtnSecondary>
            </div>

            {stmtLoading ? (
              <p className="px-5 py-6 text-xs text-gray-400">Loading statement…</p>
            ) : stmt ? (
              <>
                {/* Summary row */}
                <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-gray-50 border-b border-gray-50">
                  {[
                    { label: "Total Invoiced",   value: fmtR(stmt.summary.total_invoiced),   color: "text-gray-800" },
                    { label: "Total Credits",     value: fmtR(stmt.summary.total_credits),    color: "text-purple-700" },
                    { label: "Total Outstanding", value: fmtR(stmt.summary.total_outstanding), color: "text-red-600"   },
                    { label: "Net Balance",       value: fmtR(stmt.summary.net_balance),      color: stmt.summary.net_balance > 0 ? "text-red-600" : "text-green-700" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="px-5 py-3">
                      <p className="text-xs text-gray-400 mb-0.5">{label}</p>
                      <p className={`text-sm font-bold ${color}`}>{value}</p>
                    </div>
                  ))}
                </div>

                {/* Transaction table */}
                {stmt.invoices.length === 0 ? (
                  <p className="px-5 py-4 text-sm text-gray-400">No transactions in this period.</p>
                ) : (() => {
                  const stmtSlice = stmt.invoices.slice(stmtPage * STMT_PAGE_SIZE, (stmtPage + 1) * STMT_PAGE_SIZE);
                  return (
                    <>
                      <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-gray-50 text-xs text-gray-500">
                            <th className="text-left px-5 py-2.5 font-medium">Ref</th>
                            <th className="text-left px-5 py-2.5 font-medium">Type</th>
                            <th className="text-left px-5 py-2.5 font-medium">Date</th>
                            <th className="text-left px-5 py-2.5 font-medium">Due</th>
                            <th className="text-right px-5 py-2.5 font-medium">Total</th>
                            <th className="text-right px-5 py-2.5 font-medium">Outstanding</th>
                            <th className="text-left px-5 py-2.5 font-medium">Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {stmtSlice.map(inv => {
                            const isCN = inv.move_type === "out_refund";
                            const overdue = !isCN && inv.invoice_date_due && new Date(inv.invoice_date_due) < new Date() && inv.payment_state !== "paid";
                            return (
                              <tr key={inv.id} className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                                <td className="px-5 py-3 font-mono text-xs text-bassani-700">{inv.name}</td>
                                <td className="px-5 py-3">
                                  {isCN
                                    ? <span className="text-[10px] bg-purple-50 text-purple-700 border border-purple-100 px-1.5 py-0.5 rounded-full font-semibold">Credit Note</span>
                                    : <span className="text-[10px] bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded-full font-semibold">Invoice</span>
                                  }
                                </td>
                                <td className="px-5 py-3 text-gray-500">{fmtDate(inv.invoice_date)}</td>
                                <td className={`px-5 py-3 font-medium ${overdue ? "text-red-600" : "text-gray-500"}`}>
                                  {inv.invoice_date_due ? fmtDate(inv.invoice_date_due) : "—"}{overdue ? " ⚠" : ""}
                                </td>
                                <td className={`px-5 py-3 text-right font-semibold ${isCN ? "text-purple-700" : ""}`}>
                                  {isCN ? `(${fmtR(inv.amount_total)})` : fmtR(inv.amount_total)}
                                </td>
                                <td className={`px-5 py-3 text-right font-semibold ${inv.amount_residual > 0 ? "text-red-600" : "text-gray-400"}`}>
                                  {inv.amount_residual > 0 ? fmtR(inv.amount_residual) : "—"}
                                </td>
                                <td className="px-5 py-3">
                                  <span className="text-xs font-medium">{PAYMENT_LABEL[inv.payment_state] || inv.payment_state}</span>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      </div>
                      <PaginationBar page={stmtPage} pageSize={STMT_PAGE_SIZE} total={stmt.invoices.length}
                        onChange={p => setStmtPage(p)} />
                    </>
                  );
                })()}
              </>
            ) : null}
          </Section>

        </div>
      </main>

      {addrModal && (
        <Modal title={addrTarget ? "Edit Address" : "Add Address"} onClose={() => setAddrModal(false)}>
          <div className="space-y-4">
            <FormGroup label="Name" required>
              <Input
                value={addrForm.name}
                onChange={e => setAddrForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Branch name or contact name"
                autoFocus
              />
            </FormGroup>
            <FormGroup label="Type">
              <Select value={addrForm.type} onChange={e => setAddrForm(f => ({ ...f, type: e.target.value }))}>
                <option value="delivery">Delivery</option>
                <option value="invoice">Invoice / Billing</option>
                <option value="other">Other</option>
              </Select>
            </FormGroup>
            <FormGroup label="Street">
              <Input value={addrForm.street} onChange={e => setAddrForm(f => ({ ...f, street: e.target.value }))} placeholder="Street address" />
            </FormGroup>
            <FormGroup label="Street 2">
              <Input value={addrForm.street2} onChange={e => setAddrForm(f => ({ ...f, street2: e.target.value }))} placeholder="Unit / Suite / Floor" />
            </FormGroup>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormGroup label="City">
                <Input value={addrForm.city} onChange={e => setAddrForm(f => ({ ...f, city: e.target.value }))} />
              </FormGroup>
              <FormGroup label="Postal Code">
                <Input value={addrForm.zip} onChange={e => setAddrForm(f => ({ ...f, zip: e.target.value }))} />
              </FormGroup>
            </div>
            <FormGroup label="Phone">
              <Input value={addrForm.phone} onChange={e => setAddrForm(f => ({ ...f, phone: e.target.value }))} placeholder="+27 …" />
            </FormGroup>
            <FormGroup label="Email">
              <Input type="email" value={addrForm.email} onChange={e => setAddrForm(f => ({ ...f, email: e.target.value }))} />
            </FormGroup>
            <div className="flex justify-end gap-2 pt-2">
              <BtnSecondary onClick={() => setAddrModal(false)}>Cancel</BtnSecondary>
              <BtnPrimary onClick={saveAddr} loading={addrSaving}>
                {addrTarget ? "Save Changes" : "Add Address"}
              </BtnPrimary>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
