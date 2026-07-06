import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle, Building2, User, MapPin, ClipboardList,
  FileText, Download, Upload, X, Loader2, AlertCircle,
} from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";

// ── Constants ──────────────────────────────────────────────────────────────────

const BUSINESS_TYPES = [
  "Pharmacy", "Dispensary", "Healthcare Provider",
  "Wellness Centre", "Private Practice", "Other",
];

const PROVINCES = [
  "Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape",
  "Limpopo", "Mpumalanga", "North West", "Free State", "Northern Cape",
];

const ORDER_VOLUMES = [
  "Less than 10 orders/month",
  "10 – 50 orders/month",
  "50 – 100 orders/month",
  "More than 100 orders/month",
];

const STEPS = [
  { label: "Documents",        icon: FileText    },
  { label: "Business Details", icon: Building2   },
  { label: "Primary Contact",  icon: User        },
  { label: "Business Address", icon: MapPin      },
  { label: "Additional Info",  icon: ClipboardList },
];

const TEMPLATES = [
  { filename: "store-onboarding-agreement.pdf", label: "Store Onboarding Agreement" },
  { filename: "customer-information-form.pdf",  label: "Customer Information Form"  },
  { filename: "nda.pdf",                        label: "NDA"                        },
  { filename: "tqa.pdf",                        label: "TQA Document"               },
];

const REQUIRED_DOCS = [
  { type: "store_onboarding_agreement", label: "Signed Store Onboarding Agreement" },
  { type: "customer_information_form",  label: "Signed Customer Information Form"  },
  { type: "nda",                        label: "Signed NDA"                        },
  { type: "tqa",                        label: "Signed TQA Document"               },
  { type: "cipc_certificate",           label: "CIPC Company Registration Certificate" },
];

const BLANK = {
  company_name: "", trading_name: "", registration_number: "",
  vat_number: "", business_type: "Pharmacy",
  contact_name: "", contact_position: "", contact_email: "",
  contact_phone: "", contact_alt_phone: "",
  street: "", suburb: "", city: "", province: "",
  postal_code: "", country: "South Africa",
  ordering_volume: "", referral_source: "", notes: "",
};

// ── Small UI components ────────────────────────────────────────────────────────

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", autoFocus }) {
  return (
    <input
      type={type} value={value} onChange={onChange}
      placeholder={placeholder} autoFocus={autoFocus}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
        focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
    />
  );
}

function SelectInput({ value, onChange, children }) {
  return (
    <select
      value={value} onChange={onChange}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
        focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white text-gray-700"
    >
      {children}
    </select>
  );
}

function TextArea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea
      value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg
        focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400 resize-none"
    />
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PublicRegister() {
  const [searchParams] = useSearchParams();
  const refCode        = searchParams.get("ref") || null;

  const [sessionId]            = useState(() => crypto.randomUUID());
  const [step,        setStep] = useState(0);
  const [form,        setForm] = useState(BLANK);
  const [submitting,  setSubmitting] = useState(false);
  const [reference,   setReference] = useState(null);

  const [referrerName, setReferrerName] = useState(null);

  const [uploads,      setUploads]      = useState({});
  const [uploadingDoc, setUploadingDoc] = useState(null);
  const [removingDoc,  setRemovingDoc]  = useState(null);
  const fileInputRefs = useRef({});

  const upd = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // Validate referral code on mount
  useEffect(() => {
    if (!refCode) return;
    api.get(`/api/public/referral/${refCode}`)
      .then(r => setReferrerName(r.data.reseller_name))
      .catch(() => { /* silently ignore invalid refs */ });
  }, [refCode]);

  // ── Document helpers ────────────────────────────────────────────────────────

  const downloadTemplate = async (filename, label) => {
    try {
      const res = await api.get(`/api/public/templates/download/${filename}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement("a");
      a.href = url; a.download = label + ".pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed — the file may not be available yet");
    }
  };

  const uploadDoc = async (docType, file) => {
    setUploadingDoc(docType);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(
        `/api/public/documents/upload?session_id=${sessionId}&doc_type=${docType}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setUploads(prev => ({ ...prev, [docType]: data }));
      toast.success("Document uploaded");
    } catch {
      toast.error("Upload failed — please try again");
    } finally {
      setUploadingDoc(null);
    }
  };

  const removeDoc = async (docType) => {
    setRemovingDoc(docType);
    try {
      await api.delete(`/api/public/documents/${sessionId}/${docType}`);
      setUploads(prev => { const n = { ...prev }; delete n[docType]; return n; });
    } catch {
      toast.error("Failed to remove document");
    } finally {
      setRemovingDoc(null);
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────────

  const validateStep = () => {
    if (step === 0) {
      const missing = REQUIRED_DOCS.filter(d => !uploads[d.type]);
      if (missing.length) {
        toast.error(`Upload all 5 required documents (${missing.length} remaining)`);
        return false;
      }
    }
    if (step === 1) {
      if (!form.company_name.trim()) { toast.error("Company name is required"); return false; }
    }
    if (step === 2) {
      if (!form.contact_name.trim())  { toast.error("Contact name is required"); return false; }
      if (!form.contact_email.trim()) { toast.error("Contact email is required"); return false; }
      if (!form.contact_phone.trim()) { toast.error("Contact phone is required"); return false; }
    }
    if (step === 3) {
      if (!form.street.trim()) { toast.error("Street address is required"); return false; }
      if (!form.city.trim())   { toast.error("City is required"); return false; }
    }
    return true;
  };

  const next = () => { if (validateStep()) setStep(s => s + 1); };
  const back = () => setStep(s => s - 1);

  const submit = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    try {
      const { data } = await api.post("/api/public/register", {
        ...form,
        document_session_id: sessionId,
        documents:           Object.values(uploads),
        referral_code:       refCode,
      });
      setReference(data.reference);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────────────

  if (reference) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-bassani-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-bassani-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Application Submitted</h2>
          <p className="text-gray-500 text-sm mb-5">
            Thank you. Your application for <strong>{form.company_name}</strong> has been submitted
            and is pending review. You will receive a confirmation email shortly.
          </p>
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="text-xs text-gray-400 font-medium mb-1">Your Reference Number</p>
            <p className="text-lg font-bold font-mono text-bassani-700">{reference}</p>
            <p className="text-xs text-gray-400 mt-1">Keep this for your records</p>
          </div>
          <p className="text-xs text-gray-400">
            We aim to process applications within 2 to 3 business days. If we need anything further,
            a member of our team will be in touch.
          </p>
        </div>
      </div>
    );
  }

  // ── Step 0 — Documents ──────────────────────────────────────────────────────

  const uploadedCount = Object.keys(uploads).length;
  const allUploaded   = uploadedCount === REQUIRED_DOCS.length;

  const step0Content = (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-xs font-semibold text-blue-800 mb-1">Before you begin</p>
        <p className="text-xs text-blue-700 leading-relaxed">
          Download each document below, complete and sign it, then upload the signed version.
          All five documents are required before you can submit your application.
        </p>
      </div>

      {/* Download templates */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
          Step A — Download and complete
        </p>
        <div className="space-y-2">
          {TEMPLATES.map(t => (
            <div key={t.filename}
              className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
              <div className="flex items-center gap-2 min-w-0">
                <FileText size={13} className="text-bassani-600 shrink-0" />
                <span className="text-xs font-medium text-gray-700 truncate">{t.label}</span>
              </div>
              <button
                onClick={() => downloadTemplate(t.filename, t.label)}
                className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600
                  hover:text-bassani-700 shrink-0 ml-3 transition-colors">
                <Download size={12} />
                Download
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Upload signed docs */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Step B — Upload signed documents
          </p>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            allUploaded ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
          }`}>
            {uploadedCount} / {REQUIRED_DOCS.length}
          </span>
        </div>

        <div className="space-y-2">
          {REQUIRED_DOCS.map(doc => {
            const uploaded = uploads[doc.type];
            const loading  = uploadingDoc === doc.type;
            const removing = removingDoc  === doc.type;
            return (
              <div key={doc.type}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 border transition-colors ${
                  uploaded ? "bg-green-50 border-green-100" : "bg-gray-50 border-gray-100"
                }`}>
                <div className="shrink-0">
                  {loading ? (
                    <Loader2 size={14} className="text-bassani-500 animate-spin" />
                  ) : uploaded ? (
                    <CheckCircle size={14} className="text-green-600" />
                  ) : (
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-gray-300" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${uploaded ? "text-green-800" : "text-gray-700"}`}>
                    {doc.label}
                  </p>
                  {uploaded && (
                    <p className="text-[10px] text-green-600 truncate mt-0.5">{uploaded.filename}</p>
                  )}
                </div>
                {uploaded ? (
                  <button
                    onClick={() => removeDoc(doc.type)}
                    disabled={!!removingDoc}
                    title="Remove and re-upload"
                    className="shrink-0 p-1 rounded hover:bg-green-100 text-green-600
                      hover:text-red-500 transition-colors disabled:opacity-50">
                    {removing ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  </button>
                ) : (
                  <>
                    <input
                      type="file"
                      accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
                      className="hidden"
                      ref={el => { fileInputRefs.current[doc.type] = el; }}
                      onChange={e => {
                        if (e.target.files[0]) uploadDoc(doc.type, e.target.files[0]);
                        e.target.value = "";
                      }}
                    />
                    <button
                      onClick={() => fileInputRefs.current[doc.type]?.click()}
                      disabled={loading || !!uploadingDoc}
                      className="shrink-0 flex items-center gap-1 text-xs font-semibold
                        text-bassani-600 hover:text-bassani-700 disabled:opacity-50 transition-colors">
                      <Upload size={11} />
                      Upload
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>

        {!allUploaded && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mt-3">
            <AlertCircle size={13} className="text-amber-600 shrink-0 mt-0.5" />
            <p className="text-xs text-amber-700">
              All 5 documents must be uploaded before you can continue.
            </p>
          </div>
        )}
      </div>
    </div>
  );

  // ── Step content ────────────────────────────────────────────────────────────

  const stepContent = [
    step0Content,

    // Step 1 — Business Details
    <div key="1" className="space-y-4">
      <Field label="Registered Company Name" required>
        <TextInput value={form.company_name} onChange={upd("company_name")} placeholder="e.g. Wellness Pharma (Pty) Ltd" autoFocus />
      </Field>
      <Field label="Trading Name (if different)">
        <TextInput value={form.trading_name} onChange={upd("trading_name")} placeholder="e.g. City Pharmacy" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Company Registration No.">
          <TextInput value={form.registration_number} onChange={upd("registration_number")} placeholder="2024/123456/07" />
        </Field>
        <Field label="VAT Number">
          <TextInput value={form.vat_number} onChange={upd("vat_number")} placeholder="4xxxxxxxxx" />
        </Field>
      </div>
      <Field label="Business Type" required>
        <SelectInput value={form.business_type} onChange={upd("business_type")}>
          {BUSINESS_TYPES.map(t => <option key={t}>{t}</option>)}
        </SelectInput>
      </Field>
    </div>,

    // Step 2 — Primary Contact
    <div key="2" className="space-y-4">
      <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        Please provide details for the person who will be responsible for placing orders.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full Name" required>
          <TextInput value={form.contact_name} onChange={upd("contact_name")} placeholder="Jane Smith" autoFocus />
        </Field>
        <Field label="Position / Title">
          <TextInput value={form.contact_position} onChange={upd("contact_position")} placeholder="Pharmacist / Manager" />
        </Field>
      </div>
      <Field label="Email Address" required>
        <TextInput type="email" value={form.contact_email} onChange={upd("contact_email")} placeholder="orders@example.co.za" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Phone Number" required>
          <TextInput value={form.contact_phone} onChange={upd("contact_phone")} placeholder="+27 11 555 1234" />
        </Field>
        <Field label="Alternative Phone">
          <TextInput value={form.contact_alt_phone} onChange={upd("contact_alt_phone")} placeholder="+27 82 555 1234" />
        </Field>
      </div>
    </div>,

    // Step 3 — Business Address
    <div key="3" className="space-y-4">
      <Field label="Street Address" required>
        <TextInput value={form.street} onChange={upd("street")} placeholder="123 Health Street" autoFocus />
      </Field>
      <Field label="Suburb">
        <TextInput value={form.suburb} onChange={upd("suburb")} placeholder="Sandton" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="City" required>
          <TextInput value={form.city} onChange={upd("city")} placeholder="Johannesburg" />
        </Field>
        <Field label="Postal Code">
          <TextInput value={form.postal_code} onChange={upd("postal_code")} placeholder="2196" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Province">
          <SelectInput value={form.province} onChange={upd("province")}>
            <option value="">— Select province —</option>
            {PROVINCES.map(p => <option key={p}>{p}</option>)}
          </SelectInput>
        </Field>
        <Field label="Country">
          <TextInput value={form.country} onChange={upd("country")} placeholder="South Africa" />
        </Field>
      </div>
    </div>,

    // Step 4 — Additional Information
    <div key="4" className="space-y-4">
      <Field label="Expected Monthly Order Volume">
        <SelectInput value={form.ordering_volume} onChange={upd("ordering_volume")}>
          <option value="">— Select range —</option>
          {ORDER_VOLUMES.map(v => <option key={v}>{v}</option>)}
        </SelectInput>
      </Field>
      <Field label="How did you hear about Bassani Health?">
        <SelectInput value={form.referral_source} onChange={upd("referral_source")}>
          <option value="">— Select source —</option>
          <option>Referred by a healthcare representative</option>
          <option>Social media</option>
          <option>Industry event / conference</option>
          <option>Online search</option>
          <option>Other</option>
        </SelectInput>
      </Field>
      <Field label="Additional Notes">
        <TextArea value={form.notes} onChange={upd("notes")}
          placeholder="Any special requirements, delivery preferences, or other information…" rows={4} />
      </Field>
    </div>,
  ];

  // ── Page layout ─────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-bassani-600 flex items-center justify-center shrink-0">
              <span className="text-white font-bold text-xs">BH</span>
            </div>
            <div>
              <p className="text-sm font-bold text-gray-900 leading-tight">Bassani Health</p>
              <p className="text-[10px] text-gray-400 leading-tight">Customer Registration</p>
            </div>
          </div>
          {referrerName && (
            <div className="text-right">
              <p className="text-[10px] text-gray-400">Referred by</p>
              <p className="text-xs font-semibold text-bassani-700">{referrerName}</p>
            </div>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        {/* Referral banner */}
        {referrerName && (
          <div className="bg-bassani-50 border border-bassani-200 rounded-xl px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-bassani-100 flex items-center justify-center shrink-0">
              <span className="text-bassani-700 font-bold text-xs">{referrerName[0]}</span>
            </div>
            <div>
              <p className="text-xs font-semibold text-bassani-800">Referred by {referrerName}</p>
              <p className="text-[11px] text-bassani-600">
                Your account will be linked to your referring partner on approval.
              </p>
            </div>
          </div>
        )}

        {/* Step indicators */}
        <div className="flex items-center gap-0">
          {STEPS.map((s, i) => {
            const Icon    = s.icon;
            const done    = i < step;
            const current = i === step;
            return (
              <div key={i} className="flex items-center flex-1 last:flex-none">
                <div className={`flex items-center gap-2 shrink-0 ${
                  current ? "text-bassani-700" : done ? "text-bassani-500" : "text-gray-300"
                }`}>
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors ${
                    current ? "border-bassani-600 bg-bassani-600 text-white"
                    : done   ? "border-bassani-500 bg-bassani-50 text-bassani-600"
                    :          "border-gray-200 bg-white text-gray-300"
                  }`}>
                    {done ? <CheckCircle size={14} /> : <Icon size={14} />}
                  </div>
                  <span className={`text-xs font-semibold hidden sm:block ${
                    current ? "text-bassani-700" : done ? "text-bassani-500" : "text-gray-300"
                  }`}>
                    {s.label}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <div className={`flex-1 h-px mx-3 ${i < step ? "bg-bassani-300" : "bg-gray-200"}`} />
                )}
              </div>
            );
          })}
        </div>

        {/* Form card */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
          <div className="px-6 py-5 border-b border-gray-50">
            <div className="flex items-center gap-2">
              {(() => { const Icon = STEPS[step].icon; return <Icon size={16} className="text-bassani-600" />; })()}
              <h2 className="text-sm font-bold text-gray-900">{STEPS[step].label}</h2>
              <span className="ml-auto text-xs text-gray-400">Step {step + 1} of {STEPS.length}</span>
            </div>
          </div>
          <div className="px-6 py-5">
            {stepContent[step]}
          </div>
          <div className="px-6 py-4 bg-gray-50/50 rounded-b-2xl border-t border-gray-50 flex justify-between items-center">
            {step > 0 ? (
              <button onClick={back}
                className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900
                  border border-gray-200 rounded-lg hover:bg-white transition-colors">
                Back
              </button>
            ) : <div />}

            {step < STEPS.length - 1 ? (
              <button
                onClick={next}
                disabled={step === 0 && !allUploaded}
                title={step === 0 && !allUploaded ? "Upload all 5 documents to continue" : undefined}
                className="px-5 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-40
                  disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
                Continue
              </button>
            ) : (
              <button onClick={submit} disabled={submitting}
                className="px-5 py-2 bg-bassani-600 hover:bg-bassani-700 text-white text-sm
                  font-semibold rounded-lg transition-colors disabled:opacity-50">
                {submitting ? <span className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" />Submitting…</span> : "Submit Application"}
              </button>
            )}
          </div>
        </div>

        {/* Summary sidebar (shown after step 1) */}
        {step > 1 && (
          <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Application Summary</p>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-400">Documents</span>
                <span className="font-medium text-green-700">{uploadedCount} / {REQUIRED_DOCS.length} uploaded</span>
              </div>
              {form.company_name && <div className="flex justify-between"><span className="text-gray-400">Company</span><span className="font-medium text-gray-700">{form.company_name}</span></div>}
              {form.business_type && <div className="flex justify-between"><span className="text-gray-400">Type</span><span className="font-medium text-gray-700">{form.business_type}</span></div>}
              {step > 2 && form.contact_name  && <div className="flex justify-between"><span className="text-gray-400">Contact</span><span className="font-medium text-gray-700">{form.contact_name}</span></div>}
              {step > 2 && form.contact_email && <div className="flex justify-between"><span className="text-gray-400">Email</span><span className="font-medium text-gray-700 truncate max-w-[160px]">{form.contact_email}</span></div>}
              {step > 3 && form.city && <div className="flex justify-between"><span className="text-gray-400">City</span><span className="font-medium text-gray-700">{form.city}{form.province ? `, ${form.province}` : ""}</span></div>}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[11px] text-gray-400 pb-4">
          Bassani Health (Pty) Ltd &nbsp;&middot;&nbsp; Licensed medicinal cannabis distributor &nbsp;&middot;&nbsp; Cnr Dytchley &amp; Marcius Roads, Kyalami
        </p>
      </div>
    </div>
  );
}
