import { useState, useEffect, useRef } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  CheckCircle, Building2, User, MapPin, ClipboardList,
  FileText, Download, Mail, Upload, X, Loader2, AlertCircle, Clock, Link2,
} from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { useAuth } from "../AuthContext";

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

const REFERRAL_SOURCES = [
  "Bassani Health representative",
  "Referral from another reseller",
  "Social media",
  "Industry event / conference",
  "Online search",
  "Other",
];

const STEPS = [
  { label: "Documents",        icon: FileText },
  { label: "Business Details", icon: Building2 },
  { label: "Primary Contact",  icon: User },
  { label: "Business Address", icon: MapPin },
  { label: "Additional Info",  icon: ClipboardList },
];

const TEMPLATES = [
  { filename: "store-onboarding-agreement.pdf", label: "Store Onboarding Agreement" },
  { filename: "customer-information-form.pdf",  label: "Customer Information Form" },
  { filename: "nda.pdf",                        label: "NDA" },
  { filename: "tqa.pdf",                        label: "TQA Document" },
];

const REQUIRED_DOCS = [
  { type: "store_onboarding_agreement", label: "Signed Store Onboarding Agreement" },
  { type: "customer_information_form",  label: "Signed Customer Information Form" },
  { type: "nda",                        label: "Signed NDA" },
  { type: "tqa",                        label: "Signed TQA Document" },
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

// ── Small reusable form components ─────────────────────────────────────────────

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
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400" />
  );
}

function SelectInput({ value, onChange, children }) {
  return (
    <select value={value} onChange={onChange}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white text-gray-700">
      {children}
    </select>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400 resize-none" />
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CustomerOnboarding() {
  const navigate        = useNavigate();
  const [searchParams]  = useSearchParams();
  const resumeId        = searchParams.get("resume");
  const { user }        = useAuth();

  const [sessionId]            = useState(() => crypto.randomUUID());
  const [step,        setStep ]        = useState(0);
  const [form,        setForm ]        = useState(BLANK);
  const [submitting,  setSubmitting ]  = useState(false);
  const [reference,   setReference ]   = useState(null);
  const [loadingResume, setLoadingResume] = useState(!!resumeId);

  // Draft/email-path state
  const [draftAppId,  setDraftAppId]   = useState(resumeId || null);
  const [emailSent,   setEmailSent]    = useState(false);   // backward-compat: resumed awaiting_docs drafts
  const [serverDocs,  setServerDocs]   = useState([]); // docs already saved to the draft application

  // Step 0 — document upload path state
  const [uploads,       setUploads     ] = useState({});
  const [uploadingDoc,  setUploadingDoc] = useState(null);
  const [removingDoc,   setRemovingDoc ] = useState(null);

  // Step 0 — invitation path state
  const [inviteSent,    setInviteSent  ] = useState(false);
  const [inviteEmail,   setInviteEmail ] = useState("");
  const [customerName,  setCustomerName] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const fileInputRefs = useRef({});

  const upd = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // ── Resume: load existing draft application ─────────────────────────────────

  useEffect(() => {
    if (!resumeId) return;
    (async () => {
      try {
        const { data } = await api.get(`/api/onboarding/${resumeId}`);
        // Populate form with whatever was saved
        setForm({
          company_name:        data.company_name        || "",
          trading_name:        data.trading_name        || "",
          registration_number: data.registration_number || "",
          vat_number:          data.vat_number          || "",
          business_type:       data.business_type       || "Pharmacy",
          contact_name:        data.contact_name        || "",
          contact_position:    data.contact_position    || "",
          contact_email:       data.contact_email       || "",
          contact_phone:       data.contact_phone       || "",
          contact_alt_phone:   data.contact_alt_phone   || "",
          street:              data.street              || "",
          suburb:              data.suburb              || "",
          city:                data.city                || "",
          province:            data.province            || "",
          postal_code:         data.postal_code         || "",
          country:             data.country             || "South Africa",
          ordering_volume:     data.ordering_volume     || "",
          referral_source:     data.referral_source     || "",
          notes:               data.notes               || "",
        });
        setServerDocs(data.documents || []);
        setEmailSent(true); // docs were emailed by definition (source: inbox)
        setStep(1); // start at business details, docs managed by admin
      } catch {
        toast.error("Could not load application. It may have already been submitted.");
      } finally {
        setLoadingResume(false);
      }
    })();
  }, [resumeId]);

  // ── Document helpers ────────────────────────────────────────────────────────

  const downloadTemplate = async (filename, label) => {
    try {
      const res = await api.get(`/api/onboarding/templates/download/${filename}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement("a");
      a.href = url; a.download = label + ".pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed — file may not be available yet");
    }
  };

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return toast.error("Enter the customer's email address");
    setInviteSending(true);
    try {
      await api.post("/api/onboarding/invite", {
        to_email:         inviteEmail.trim(),
        customer_name:    customerName.trim(),
        registration_url: `${window.location.origin}/apply?ref=${user?.id}`,
      });
      toast.success("Invitation sent to " + inviteEmail.trim());
      setInviteEmail("");
      setCustomerName("");
      setInviteSent(true);
    } catch {
      toast.error("Failed to send invitation");
    } finally {
      setInviteSending(false);
    }
  };

  const uploadDoc = async (docType, file) => {
    setUploadingDoc(docType);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(
        `/api/onboarding/documents/upload?session_id=${sessionId}&doc_type=${docType}`,
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
      await api.delete(`/api/onboarding/documents/${sessionId}/${docType}`);
      setUploads(prev => { const n = { ...prev }; delete n[docType]; return n; });
    } catch {
      toast.error("Failed to remove document");
    } finally {
      setRemovingDoc(null);
    }
  };

  // ── Progress save (draft path) ──────────────────────────────────────────────

  const saveProgress = async (formSnapshot) => {
    if (!draftAppId) return;
    try {
      await api.put(`/api/onboarding/${draftAppId}`, formSnapshot);
    } catch {
      toast.error("Could not save progress — please check your connection");
    }
  };

  // ── Validation ──────────────────────────────────────────────────────────────

  const validateStep = () => {
    if (step === 0) {
      // Email path: allow continue — docs will arrive via inbox
      if (emailSent) return true;
      // Upload path: require all 5 docs
      const missing = REQUIRED_DOCS.filter(d => !uploads[d.type]);
      if (missing.length) {
        toast.error(`Upload all required documents (${missing.length} remaining)`);
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

  const next = async () => {
    if (!validateStep()) return;
    if (draftAppId && step >= 1) {
      await saveProgress(form);
    }
    setStep(s => s + 1);
  };

  const back = () => setStep(s => s - 1);

  // ── Submit ──────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    try {
      if (draftAppId) {
        // Save final step fields first, then submit the draft
        await api.put(`/api/onboarding/${draftAppId}`, form);
        const { data } = await api.post(`/api/onboarding/${draftAppId}/submit`);
        setReference(data.reference);
      } else {
        // Full upload path — submit everything in one shot
        const payload = {
          ...form,
          document_session_id: sessionId,
          documents: Object.values(uploads),
        };
        const { data } = await api.post("/api/onboarding/", payload);
        setReference(data.reference);
      }
    } catch (e) {
      toast.error(e.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Loading state ───────────────────────────────────────────────────────────

  if (loadingResume) {
    return (
      <div className="flex flex-col flex-1 items-center justify-center bg-gray-50">
        <Loader2 size={24} className="animate-spin text-bassani-500 mb-3" />
        <p className="text-sm text-gray-500">Loading application…</p>
      </div>
    );
  }

  // ── Success screen ──────────────────────────────────────────────────────────

  if (reference) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-gray-50">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 bg-bassani-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={32} className="text-bassani-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Application Submitted</h2>
            <p className="text-gray-500 text-sm mb-5">
              Your onboarding application for <strong>{form.company_name}</strong> has been submitted
              and is pending admin review.
            </p>
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <p className="text-xs text-gray-400 font-medium mb-1">Reference Number</p>
              <p className="text-lg font-bold font-mono text-bassani-700">{reference}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => navigate("/my-applications")}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                View Applications
              </button>
              <button onClick={() => { setForm(BLANK); setStep(0); setReference(null); setUploads({}); setEmailSent(false); setDraftAppId(null); setServerDocs([]); }}
                className="flex-1 px-4 py-2 bg-bassani-600 hover:bg-bassani-700 rounded-lg text-sm font-semibold text-white transition-colors">
                Onboard Another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step 0 — Documents ──────────────────────────────────────────────────────

  const uploadedCount = Object.keys(uploads).length;
  const allUploaded   = uploadedCount === REQUIRED_DOCS.length;
  const serverDocTypes = new Set(serverDocs.map(d => d.doc_type));

  const step0Content = (
    <div className="space-y-6">

      {/* Backward-compat banner for resumed awaiting_docs drafts */}
      {emailSent && (
        <div className="flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
          <Clock size={14} className="text-blue-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-semibold text-blue-800 mb-0.5">Documents sent — waiting for customer</p>
            <p className="text-xs text-blue-600">
              Continue filling in the details below while you wait. The admin team will save the
              signed documents once the customer replies.
            </p>
          </div>
        </div>
      )}

      {/* Invitation sent — terminal state */}
      {inviteSent && (
        <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-xl px-4 py-4">
          <CheckCircle size={15} className="text-green-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-green-800 mb-1">Invitation sent</p>
            <p className="text-xs text-green-700">
              Your customer will receive a link to complete their own registration. Once they submit and are approved, they will appear in your customer list automatically.
            </p>
            <button
              onClick={() => { setInviteSent(false); setInviteEmail(""); setCustomerName(""); }}
              className="mt-2 text-xs font-semibold text-green-700 underline underline-offset-2 hover:text-green-900">
              Send another invitation
            </button>
          </div>
        </div>
      )}

      {/* Step A — invite customer (shown when not on email-docs path and not yet invited) */}
      {!emailSent && !inviteSent && (
        <>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
              Step A — Invite your customer to register
            </p>
            {/* Referral link copy */}
            <div className="border border-bassani-100 rounded-xl p-4 bg-bassani-50/30 mb-3">
              <p className="text-xs text-gray-500 mb-2">Share your registration link — any application they submit will be linked to your account automatically.</p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={`${window.location.origin}/apply?ref=${user?.id}`}
                  className="flex-1 px-3 py-2 text-xs font-mono border border-bassani-200 rounded-lg bg-white text-gray-700 select-all"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/apply?ref=${user?.id}`); toast.success("Link copied"); }}
                  className="px-3 py-2 bg-bassani-600 hover:bg-bassani-700 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                  Copy
                </button>
              </div>
            </div>
            {/* Email invitation */}
            <div className="border border-gray-100 rounded-xl p-4 bg-white">
              <p className="text-xs font-semibold text-gray-600 mb-3 flex items-center gap-1.5">
                <Mail size={12} className="text-gray-400" />
                Or email the invitation link directly
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Customer / company name (optional)"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
                />
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendInvite()}
                    placeholder="customer@example.co.za"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
                  />
                  <button
                    onClick={sendInvite}
                    disabled={inviteSending || !inviteEmail.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                    {inviteSending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                    Send Invite
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* Section B — upload signed docs (shown when not on invitation/email path) */}
      {!emailSent && !inviteSent && (
        <>
          <div className="border-t border-gray-100" />
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                Step B — Upload signed documents &amp; CIPC
              </p>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${allUploaded ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}>
                {uploadedCount} / {REQUIRED_DOCS.length}
              </span>
            </div>

            {!allUploaded && (
              <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
                <AlertCircle size={13} className="text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">Upload all 5 documents, or send them to the customer via email above to continue.</p>
              </div>
            )}

            <div className="space-y-2">
              {REQUIRED_DOCS.map(doc => {
                const uploaded  = uploads[doc.type];
                const loading   = uploadingDoc === doc.type;
                const removing  = removingDoc  === doc.type;

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
                        className="shrink-0 p-1 rounded hover:bg-green-100 text-green-600 hover:text-red-500 transition-colors disabled:opacity-50">
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
                          className="shrink-0 flex items-center gap-1 text-xs font-semibold text-bassani-600 hover:text-bassani-700 disabled:opacity-50 transition-colors">
                          <Upload size={11} />
                          Upload
                        </button>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

      {/* Server docs status (resume mode — docs saved by admin) */}
      {emailSent && serverDocs.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
            Documents on file
          </p>
          <div className="space-y-1.5">
            {REQUIRED_DOCS.map(doc => {
              const onFile = serverDocTypes.has(doc.type);
              return (
                <div key={doc.type}
                  className={`flex items-center gap-2.5 rounded-lg px-3 py-2 border ${
                    onFile ? "bg-green-50 border-green-100" : "bg-gray-50 border-gray-100"
                  }`}>
                  {onFile
                    ? <CheckCircle size={13} className="text-green-600 shrink-0" />
                    : <div className="w-3 h-3 rounded-full border-2 border-gray-300 shrink-0" />
                  }
                  <p className={`text-xs font-medium truncate ${onFile ? "text-green-800" : "text-gray-400"}`}>
                    {doc.label}
                  </p>
                  {!onFile && (
                    <span className="ml-auto text-[10px] text-amber-600 font-medium shrink-0">Pending</span>
                  )}
                </div>
              );
            })}
          </div>
          {serverDocs.length < REQUIRED_DOCS.length && (
            <p className="text-[10px] text-amber-600 mt-2">
              {REQUIRED_DOCS.length - serverDocs.length} document(s) still awaiting the customer's reply.
              You can complete the application now and submit — the admin team can approve once all docs are received.
            </p>
          )}
        </div>
      )}
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
        Please provide the details of the primary contact person who will be responsible for orders.
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
          {REFERRAL_SOURCES.map(r => <option key={r}>{r}</option>)}
        </SelectInput>
      </Field>
      <Field label="Additional Notes">
        <Textarea value={form.notes} onChange={upd("notes")} placeholder="Any special requirements, delivery preferences, or additional context…" rows={4} />
      </Field>
    </div>,
  ];

  // ── Layout ──────────────────────────────────────────────────────────────────

  const isDraftMode = !!draftAppId;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">
            {isDraftMode ? "Complete Application" : "Onboard New Customer"}
          </p>
          <p className="text-xs text-gray-400">
            {isDraftMode
              ? "Complete and submit your application for admin review"
              : "Complete all steps to submit for admin approval"}
          </p>
        </div>
        <button onClick={() => navigate("/my-applications")}
          className="text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors">
          ← My Applications
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Draft mode indicator */}
          {isDraftMode && (
            <div className="flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-2.5">
              <Clock size={13} className="text-blue-600 shrink-0" />
              <p className="text-xs text-blue-700 font-medium">
                Resuming draft — progress is saved automatically as you move between steps.
              </p>
              <span className="ml-auto text-[10px] font-mono text-blue-400">{draftAppId}</span>
            </div>
          )}

          {/* Step indicators */}
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => {
              const Icon    = s.icon;
              const done    = i < step;
              const current = i === step;
              // In draft/resume mode, Step 0 is shown as complete
              const forceComplete = isDraftMode && i === 0;
              return (
                <div key={i} className="flex items-center flex-1 last:flex-none">
                  <div className={`flex items-center gap-2 shrink-0 ${current ? "text-bassani-700" : (done || forceComplete) ? "text-bassani-500" : "text-gray-300"}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                      ${current ? "border-bassani-600 bg-bassani-600 text-white"
                               : (done || forceComplete) ? "border-bassani-500 bg-bassani-50 text-bassani-600"
                               : "border-gray-200 bg-white text-gray-300"}`}>
                      {(done || forceComplete) ? <CheckCircle size={14} /> : <Icon size={14} />}
                    </div>
                    <span className={`text-xs font-semibold hidden sm:block ${current ? "text-bassani-700" : (done || forceComplete) ? "text-bassani-500" : "text-gray-300"}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-px mx-3 ${(i < step || forceComplete) ? "bg-bassani-300" : "bg-gray-200"}`} />
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
                  className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-white transition-colors">
                  ← Back
                </button>
              ) : (
                <button onClick={() => navigate("/my-applications")}
                  className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors">
                  Cancel
                </button>
              )}
              {step < STEPS.length - 1 && !inviteSent ? (
                <button
                  onClick={next}
                  disabled={step === 0 && !emailSent && !allUploaded}
                  title={step === 0 && !emailSent && !allUploaded ? "Upload all documents to continue, or send an invitation so your customer registers themselves" : undefined}
                  className="px-5 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors">
                  {step === 0 && emailSent ? "Continue — fill in details →" : "Continue →"}
                </button>
              ) : (
                <button onClick={submit} disabled={submitting}
                  className="px-5 py-2 bg-bassani-600 hover:bg-bassani-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                  {submitting ? "Submitting…" : "Submit for Review"}
                </button>
              )}
            </div>
          </div>

          {/* Summary sidebar */}
          {step > 1 && (
            <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Application Summary</p>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-400">Documents</span>
                  {emailSent
                    ? <span className="font-medium text-blue-600">{serverDocs.length} / {REQUIRED_DOCS.length} on file</span>
                    : <span className="font-medium text-green-700">{uploadedCount} / {REQUIRED_DOCS.length} uploaded</span>
                  }
                </div>
                {form.company_name && <div className="flex justify-between"><span className="text-gray-400">Company</span><span className="font-medium text-gray-700">{form.company_name}</span></div>}
                {form.business_type && <div className="flex justify-between"><span className="text-gray-400">Type</span><span className="font-medium text-gray-700">{form.business_type}</span></div>}
                {step > 2 && form.contact_name && <div className="flex justify-between"><span className="text-gray-400">Contact</span><span className="font-medium text-gray-700">{form.contact_name}</span></div>}
                {step > 2 && form.contact_email && <div className="flex justify-between"><span className="text-gray-400">Email</span><span className="font-medium text-gray-700">{form.contact_email}</span></div>}
                {step > 3 && form.city && <div className="flex justify-between"><span className="text-gray-400">City</span><span className="font-medium text-gray-700">{form.city}{form.province ? `, ${form.province}` : ""}</span></div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
