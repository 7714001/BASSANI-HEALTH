import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  CheckCircle, XCircle, Clock, ChevronDown, FileText,
  Download, Eye, X, Loader2, AlertTriangle, Pencil,
} from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { LoadingState, fmtDate, BtnPrimary, BtnSecondary } from "../components/UI";

// ── Constants (mirrors CustomerOnboarding.js) ──────────────────────────────────

const BUSINESS_TYPES  = ["Pharmacy", "Dispensary", "Healthcare Provider", "Wellness Centre", "Private Practice", "Other"];
const PROVINCES       = ["Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape", "Limpopo", "Mpumalanga", "North West", "Free State", "Northern Cape"];
const ORDER_VOLUMES   = ["Less than 10 orders/month", "10 – 50 orders/month", "50 – 100 orders/month", "More than 100 orders/month"];
const REFERRAL_SOURCES = ["Bassani Health representative", "Referral from another reseller", "Social media", "Industry event / conference", "Online search"];
const REQUIRED_DOC_TYPES = {
  store_onboarding_agreement: "Signed Store Onboarding Agreement",
  customer_information_form:  "Signed Customer Information Form",
  nda:                        "Signed NDA",
  tqa:                        "Signed TQA Document",
  cipc_certificate:           "CIPC Company Registration Certificate",
};

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:  { label: "Pending Review", cls: "bg-amber-50 border-amber-200 text-amber-700",  icon: Clock },
  approved: { label: "Approved",       cls: "bg-green-50 border-green-200 text-green-700",  icon: CheckCircle },
  rejected: { label: "Rejected",       cls: "bg-red-50   border-red-200   text-red-700",    icon: XCircle },
};

// ── Layout helpers ─────────────────────────────────────────────────────────────

function Section({ title, children, action }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        {action}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-gray-50 last:border-0 gap-4">
      <span className="text-xs text-gray-400 font-medium shrink-0">{label}</span>
      <span className="text-xs font-semibold text-gray-800 text-right">{value || "—"}</span>
    </div>
  );
}

function FieldInput({ label, value, onChange, type = "text" }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 font-medium mb-1">{label}</label>
      <input type={type} value={value || ""} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-bassani-400 focus:ring-1 focus:ring-bassani-200" />
    </div>
  );
}

function FieldSelect({ label, value, onChange, options, placeholder }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 font-medium mb-1">{label}</label>
      <select value={value || ""} onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-bassani-400 focus:ring-1 focus:ring-bassani-200 bg-white">
        {placeholder && <option value="">{placeholder}</option>}
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

function FieldTextarea({ label, value, onChange }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 font-medium mb-1">{label}</label>
      <textarea value={value || ""} onChange={e => onChange(e.target.value)} rows={3}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-800 focus:outline-none focus:border-bassani-400 focus:ring-1 focus:ring-bassani-200 resize-none" />
    </div>
  );
}

// ── PDF viewer modal ───────────────────────────────────────────────────────────

function PdfViewer({ doc, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-5xl"
        style={{ height: "90vh" }} onClick={e => e.stopPropagation()}>
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
        <iframe src={doc.download_url} title={doc.label || doc.doc_type}
          className="flex-1 w-full rounded-b-2xl" style={{ border: "none" }} />
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function ResellerApplicationDetail() {
  const { id }     = useParams();
  const navigate   = useNavigate();

  const [app,         setApp        ] = useState(null);
  const [loading,     setLoading    ] = useState(true);
  const [editing,     setEditing    ] = useState(false);
  const [form,        setForm       ] = useState({});
  const [saving,      setSaving     ] = useState(false);

  const [docs,        setDocs       ] = useState([]);
  const [docsLoading, setDocsLoading] = useState(true);
  const [viewing,     setViewing    ] = useState(null);
  const [replacing,   setReplacing  ] = useState(null); // doc_type currently uploading

  const fileRefs = useRef({});

  const isPending = app?.status === "pending";

  // Load application
  useEffect(() => {
    api.get(`/api/onboarding/${id}`)
      .then(r => setApp(r.data))
      .catch(() => { toast.error("Application not found"); navigate("/my-applications"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Load documents
  const loadDocs = () => {
    setDocsLoading(true);
    api.get(`/api/onboarding/${id}/documents`)
      .then(r => setDocs(r.data.documents || []))
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  };
  useEffect(() => { if (app) loadDocs(); }, [app]); // eslint-disable-line

  // Edit mode
  const startEditing = () => {
    setForm({
      company_name:        app.company_name        || "",
      trading_name:        app.trading_name        || "",
      registration_number: app.registration_number || "",
      vat_number:          app.vat_number          || "",
      business_type:       app.business_type       || "Pharmacy",
      contact_name:        app.contact_name        || "",
      contact_position:    app.contact_position    || "",
      contact_email:       app.contact_email       || "",
      contact_phone:       app.contact_phone       || "",
      contact_alt_phone:   app.contact_alt_phone   || "",
      street:              app.street              || "",
      suburb:              app.suburb              || "",
      city:                app.city                || "",
      province:            app.province            || "",
      postal_code:         app.postal_code         || "",
      country:             app.country             || "South Africa",
      ordering_volume:     app.ordering_volume     || "",
      referral_source:     app.referral_source     || "",
      notes:               app.notes               || "",
    });
    setEditing(true);
  };

  const cancelEditing = () => setEditing(false);

  const upd = key => val => setForm(f => ({ ...f, [key]: val }));

  const saveChanges = async () => {
    if (!form.company_name?.trim()) return toast.error("Business name is required");
    if (!form.contact_name?.trim()) return toast.error("Contact name is required");
    if (!form.contact_email?.trim()) return toast.error("Contact email is required");
    if (!form.contact_phone?.trim()) return toast.error("Contact phone is required");
    if (!form.street?.trim() || !form.city?.trim()) return toast.error("Address is required");
    setSaving(true);
    try {
      await api.put(`/api/onboarding/${id}`, form);
      setApp(prev => ({ ...prev, ...form }));
      setEditing(false);
      toast.success("Application updated");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save changes");
    } finally {
      setSaving(false);
    }
  };

  const replaceDoc = async (docType, file) => {
    setReplacing(docType);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api.post(`/api/onboarding/${id}/documents/${docType}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success("Document replaced");
      loadDocs();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to replace document");
    } finally {
      setReplacing(null);
      if (fileRefs.current[docType]) fileRefs.current[docType].value = "";
    }
  };

  if (loading) return <LoadingState />;
  if (!app)    return null;

  const statusCfg  = STATUS_CFG[app.status] || STATUS_CFG.pending;
  const StatusIcon = statusCfg.icon;

  return (
    <>
      {viewing && <PdfViewer doc={viewing} onClose={() => setViewing(null)} />}

      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <div className="border-b border-gray-100 bg-white px-6 py-3 flex items-center justify-between gap-4 shrink-0">
          <button onClick={() => navigate("/my-applications")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ChevronDown size={14} className="-rotate-90" />Back to Applications
          </button>
          {isPending && !editing && (
            <BtnSecondary size="sm" onClick={startEditing}>
              <Pencil size={13} className="mr-1.5" />Edit Application
            </BtnSecondary>
          )}
          {editing && (
            <div className="flex gap-2">
              <BtnSecondary size="sm" onClick={cancelEditing} disabled={saving}>Cancel</BtnSecondary>
              <BtnPrimary  size="sm" onClick={saveChanges}   disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : null}
                Save Changes
              </BtnPrimary>
            </div>
          )}
        </div>

        <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
          <div className="max-w-3xl mx-auto space-y-5">

            {/* Status header */}
            <div className={`rounded-2xl border px-6 py-5 flex items-start gap-4 ${statusCfg.cls}`}>
              <StatusIcon size={22} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">{statusCfg.label}</p>
                <p className="text-xs mt-0.5 opacity-80">
                  Reference: <span className="font-mono font-semibold">{app.id}</span>
                  {app.submitted_at && <> · Submitted {fmtDate(app.submitted_at)}</>}
                  {app.reviewed_at  && <> · Reviewed {fmtDate(app.reviewed_at)}</>}
                </p>
                {app.status === "pending" && (
                  <p className="text-xs mt-1 opacity-70">
                    Your application is awaiting review. You can update the details below until it is approved or rejected.
                  </p>
                )}
              </div>
            </div>

            {/* Rejection reason */}
            {app.status === "rejected" && app.rejection_reason && (
              <div className="bg-red-50 border border-red-200 rounded-2xl px-6 py-4 flex gap-3">
                <AlertTriangle size={16} className="text-red-500 shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs font-bold text-red-700 mb-1">Reason for Rejection</p>
                  <p className="text-sm text-red-700">{app.rejection_reason}</p>
                </div>
              </div>
            )}

            {/* ── Business Details ── */}
            <Section title="Business Details">
              {editing ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <FieldInput label="Business Name *"    value={form.company_name}        onChange={upd("company_name")} />
                    <FieldInput label="Trading Name"       value={form.trading_name}        onChange={upd("trading_name")} />
                    <FieldInput label="Registration No."   value={form.registration_number} onChange={upd("registration_number")} />
                    <FieldInput label="VAT Number"         value={form.vat_number}          onChange={upd("vat_number")} />
                  </div>
                  <FieldSelect label="Business Type" value={form.business_type} onChange={upd("business_type")} options={BUSINESS_TYPES} />
                </div>
              ) : (
                <>
                  <Row label="Business Name"     value={app.company_name} />
                  <Row label="Trading Name"      value={app.trading_name} />
                  <Row label="Registration No."  value={app.registration_number} />
                  <Row label="VAT Number"        value={app.vat_number} />
                  <Row label="Business Type"     value={app.business_type} />
                </>
              )}
            </Section>

            {/* ── Contact Details ── */}
            <Section title="Primary Contact">
              {editing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <FieldInput label="Contact Name *"    value={form.contact_name}      onChange={upd("contact_name")} />
                  <FieldInput label="Position / Title"  value={form.contact_position}  onChange={upd("contact_position")} />
                  <FieldInput label="Email *"           value={form.contact_email}     onChange={upd("contact_email")} type="email" />
                  <FieldInput label="Phone *"           value={form.contact_phone}     onChange={upd("contact_phone")} type="tel" />
                  <FieldInput label="Alt. Phone"        value={form.contact_alt_phone} onChange={upd("contact_alt_phone")} type="tel" />
                </div>
              ) : (
                <>
                  <Row label="Name"      value={app.contact_name} />
                  <Row label="Position"  value={app.contact_position} />
                  <Row label="Email"     value={app.contact_email} />
                  <Row label="Phone"     value={app.contact_phone} />
                  <Row label="Alt. Phone" value={app.contact_alt_phone} />
                </>
              )}
            </Section>

            {/* ── Address ── */}
            <Section title="Business Address">
              {editing ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <FieldInput label="Street Address *" value={form.street} onChange={upd("street")} />
                  </div>
                  <FieldInput label="Suburb"      value={form.suburb}      onChange={upd("suburb")} />
                  <FieldInput label="City *"      value={form.city}        onChange={upd("city")} />
                  <FieldSelect label="Province"   value={form.province}    onChange={upd("province")}
                    options={PROVINCES} placeholder="— Select province —" />
                  <FieldInput label="Postal Code" value={form.postal_code} onChange={upd("postal_code")} />
                  <div className="sm:col-span-2">
                    <FieldInput label="Country" value={form.country} onChange={upd("country")} />
                  </div>
                </div>
              ) : (
                <>
                  <Row label="Street"      value={app.street} />
                  <Row label="Suburb"      value={app.suburb} />
                  <Row label="City"        value={app.city} />
                  <Row label="Province"    value={app.province} />
                  <Row label="Postal Code" value={app.postal_code} />
                  <Row label="Country"     value={app.country} />
                </>
              )}
            </Section>

            {/* ── Additional Information ── */}
            <Section title="Additional Information">
              {editing ? (
                <div className="space-y-4">
                  <FieldSelect label="Expected Monthly Order Volume" value={form.ordering_volume}
                    onChange={upd("ordering_volume")} options={ORDER_VOLUMES} placeholder="— Select range —" />
                  <FieldSelect label="How did you hear about Bassani Health?" value={form.referral_source}
                    onChange={upd("referral_source")} options={REFERRAL_SOURCES} placeholder="— Select source —" />
                  <FieldTextarea label="Additional Notes" value={form.notes} onChange={upd("notes")} />
                </div>
              ) : (
                <>
                  <Row label="Monthly Volume" value={app.ordering_volume} />
                  <Row label="Referral Source" value={app.referral_source} />
                  {app.notes && (
                    <div className="pt-2.5">
                      <p className="text-xs text-gray-400 font-medium mb-1">Notes</p>
                      <p className="text-xs text-gray-700 whitespace-pre-line">{app.notes}</p>
                    </div>
                  )}
                </>
              )}
            </Section>

            {/* ── Documents ── */}
            <Section title="Supporting Documents">
              {docsLoading ? (
                <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                  <Loader2 size={13} className="animate-spin" /> Loading documents…
                </div>
              ) : docs.length === 0 ? (
                <p className="text-sm text-gray-400">No documents on file.</p>
              ) : (
                <div className="space-y-2">
                  {/* Show all 5 required types, merging with uploaded docs */}
                  {Object.entries(REQUIRED_DOC_TYPES).map(([key, typeLabel]) => {
                    const doc = docs.find(d => d.doc_type === key);
                    const isReplacing = replacing === key;
                    return (
                      <div key={key}
                        className={`flex items-center justify-between rounded-xl px-4 py-3 border ${doc ? "bg-gray-50 border-gray-100" : "bg-amber-50 border-amber-100"}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${doc ? "bg-bassani-50" : "bg-amber-100"}`}>
                            <FileText size={14} className={doc ? "text-bassani-600" : "text-amber-500"} />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-gray-800 truncate">{typeLabel}</p>
                            {doc?.filename
                              ? <p className="text-[10px] text-gray-400 truncate mt-0.5">{doc.filename}</p>
                              : <p className="text-[10px] text-amber-600 mt-0.5">Not uploaded</p>
                            }
                          </div>
                        </div>
                        <div className="flex items-center gap-3 shrink-0 ml-4">
                          {doc?.download_url && (
                            <>
                              <button onClick={() => setViewing(doc)}
                                className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
                                <Eye size={12} /> View
                              </button>
                              <a href={doc.download_url} target="_blank" rel="noreferrer"
                                className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors">
                                <Download size={12} /> Download
                              </a>
                            </>
                          )}
                          {isPending && (
                            <label className={`flex items-center gap-1.5 text-xs font-semibold text-purple-600 hover:text-purple-700 cursor-pointer transition-colors ${isReplacing ? "opacity-50 pointer-events-none" : ""}`}>
                              {isReplacing
                                ? <Loader2 size={12} className="animate-spin" />
                                : null
                              }
                              {doc ? "Replace" : "Upload"}
                              <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx" className="hidden"
                                ref={el => fileRefs.current[key] = el}
                                onChange={e => { if (e.target.files[0]) replaceDoc(key, e.target.files[0]); }} />
                            </label>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

          </div>
        </main>
      </div>
    </>
  );
}
