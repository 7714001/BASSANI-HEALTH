import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import {
  CheckCircle, Building2, User, MapPin, ClipboardList,
  FileText, Upload, X, Loader2, AlertCircle, PenLine,
} from "lucide-react";
import { DOC_CONFIGS, detectFields, generateSignedPdf, buildPrefill } from "../utils/pdfSigning";
import AddressAutocomplete from "../components/AddressAutocomplete";
import api from "../api";
import toast from "react-hot-toast";

// ── Constants ──────────────────────────────────────────────────────────────────

const BUSINESS_TYPE_OPTIONS = [
  { value: "Pharmacy",             label: "Pharmacy",             desc: "Licensed retail pharmacy" },
  { value: "Dispensary",           label: "Dispensary",           desc: "Collection point / retail outlet" },
  { value: "Wellness Centre",      label: "Wellness Centre",      desc: "Health and wellness retail" },
  { value: "Section 22C Facility", label: "Section 22C Facility", desc: "Licensed complementary medicines facility" },
  { value: "Company (Pty) Ltd",    label: "Company (Pty) Ltd",    desc: "Registered private company" },
  { value: "Partnership",          label: "Partnership",          desc: "Registered business partnership" },
  { value: "Sole Proprietor",      label: "Sole Proprietor",      desc: "Unincorporated individual trader" },
  { value: "Other",                label: "Other",                desc: null },
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
  { label: "Business Details", icon: Building2    },
  { label: "Primary Contact",  icon: User         },
  { label: "Business Address", icon: MapPin       },
  { label: "Additional Info",  icon: ClipboardList },
  { label: "Sign Documents",   icon: PenLine      },
];

// Documents the customer signs during self-registration.
// NDA and Store Onboarding Agreement are sent separately by admin after review.
const SIGN_DOCS = [
  { type: "customer_information_form", label: "Customer Information Form", filename: "customer-information-form.pdf" },
];

const BLANK = {
  company_name: "", trading_name: "", registration_number: "",
  vat_number: "", business_type: "",
  contact_name: "", contact_position: "", contact_email: "",
  contact_phone: "", contact_alt_phone: "", signatory_id_number: "",
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

// ── Customer Signing Modal ─────────────────────────────────────────────────────

function CustomerSigningModal({ docType, docLabel, filename, form: wizardForm, sessionId, onSigned, onClose }) {
  const [loading,    setLoading   ] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error,      setError     ] = useState(null);
  const [pdfUrl,     setPdfUrl    ] = useState(null);
  const [pdfBytes,   setPdfBytes  ] = useState(null);
  const [fields,     setFields    ] = useState([]);
  const [textValues, setTextValues] = useState({});
  const [sigMeta,    setSigMeta   ] = useState(null);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos   = useRef({ x: 0, y: 0 });
  const hasMark   = useRef(false);

  useEffect(() => {
    let url;
    Promise.all([
      api.get(`/api/public/templates/download/${filename}`, { responseType: "arraybuffer" }),
      api.get("/api/public/signing-authority-meta").catch(() => null),
    ]).then(async ([pdfRes, metaRes]) => {
      const bytes = new Uint8Array(pdfRes.data);
      setPdfBytes(bytes);
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setPdfUrl(url);
      setSigMeta(metaRes?.data || null);

      const detected = await detectFields(bytes);
      setFields(detected);

      const cfg      = DOC_CONFIGS[docType];
      const prefill  = buildPrefill(docType, wizardForm);
      const detected_ = new Set(detected.map(f => f.name));
      const init = {};
      (cfg?.sections || []).forEach(section =>
        section.fields.forEach(f => {
          if (detected_.has(f.name) && !cfg.isAutoFill(f.name)) {
            init[f.name] = prefill[f.name] ?? "";
          }
        })
      );
      setTextValues(init);
    }).catch(() => setError("Failed to load document. Please try again."))
      .finally(() => setLoading(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [docType, filename]); // eslint-disable-line

  const getCanvasPos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r   = canvas.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - r.left) * (canvas.width / r.width),
      y: (src.clientY - r.top)  * (canvas.height / r.height),
    };
  };
  const startDraw = (e) => { e.preventDefault(); isDrawing.current = true; lastPos.current = getCanvasPos(e); };
  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pos = getCanvasPos(e);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastPos.current = pos; hasMark.current = true;
  };
  const endDraw = () => { isDrawing.current = false; };
  const clearCanvas = () => {
    const canvas = canvasRef.current; if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    hasMark.current = false;
  };

  const config      = DOC_CONFIGS[docType];
  const sigFields   = fields.filter(f => f.type === "Signature");
  const mikeFieldName = config?.hasBassaniSig
    ? (sigFields.find(f => f.name.startsWith("bassani_"))?.name ?? null)
    : null;
  const detectedNames = new Set(fields.map(f => f.name));

  const handleSign = async () => {
    setGenerating(true);
    try {
      const customerSigDataUrl = (canvasRef.current && hasMark.current)
        ? canvasRef.current.toDataURL("image/png")
        : null;

      const pdfResult = await generateSignedPdf(pdfBytes, {
        textValues,
        signingProfile: sigMeta,
        mikeFieldName,
        mikeImageBytes: null,   // Bassani countersigns on approval — not embedded client-side
        customerSigDataUrl,
        config,
        addWatermark: false,
      });

      const blob = new Blob([pdfResult], { type: "application/pdf" });
      const file = new File([blob], `${docType}-signed.pdf`, { type: "application/pdf" });
      const fd   = new FormData();
      fd.append("file", file);
      const { data } = await api.post(
        `/api/public/documents/upload?session_id=${sessionId}&doc_type=${docType}&signed_in_portal=true`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      onSigned(data);
      toast.success(`${docLabel} signed`);
      onClose();
    } catch (err) {
      console.error("CustomerSigningModal sign error:", err);
      toast.error("Failed to sign document. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2.5">
          <PenLine size={16} className="text-bassani-600" />
          <span className="text-sm font-semibold text-gray-800">{docLabel}</span>
        </div>
        <button onClick={onClose} className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors">
          <X size={18} />
        </button>
      </div>

      {loading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <Loader2 size={24} className="animate-spin text-bassani-500" />
            <p className="text-sm text-gray-500">Loading document…</p>
          </div>
        </div>
      ) : error ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center">
            <AlertCircle size={24} className="text-amber-400 mx-auto mb-2" />
            <p className="text-sm text-gray-700">{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">

          {/* Left: document preview */}
          <div className="flex-1 p-4 min-w-0 hidden md:block">
            {pdfUrl && (
              <iframe src={pdfUrl} title={docLabel}
                className="w-full h-full rounded-xl border border-gray-200 bg-white" />
            )}
          </div>

          {/* Right: signing form */}
          <div className="w-full md:w-80 shrink-0 md:border-l border-gray-200 bg-white flex flex-col">
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Bassani auto-fill card */}
              {config?.hasBassaniSig && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Bassani Health (auto-filled)</p>
                  <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 space-y-0.5">
                    {sigMeta?.name ? (
                      <>
                        <p className="text-xs font-semibold text-blue-800">{sigMeta.name}</p>
                        <p className="text-xs text-blue-600">{sigMeta.title}</p>
                      </>
                    ) : (
                      <p className="text-xs font-semibold text-blue-800">Bassani Health (Pty) Ltd</p>
                    )}
                    <p className="text-[10px] text-blue-500 mt-1">Name, title, and today's date auto-filled. Countersignature completed on approval.</p>
                  </div>
                </div>
              )}

              {/* Pre-filled form fields */}
              {(config?.sections || []).map(section => {
                const visible = section.fields.filter(f =>
                  detectedNames.has(f.name) && !config.isAutoFill(f.name)
                );
                if (!visible.length) return null;
                return (
                  <div key={section.title}>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">{section.title}</p>
                    <div className="space-y-3">
                      {visible.map(f => (
                        <div key={f.name}>
                          <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                          <input
                            type="text"
                            value={textValues[f.name] ?? ""}
                            onChange={e => setTextValues(v => ({ ...v, [f.name]: e.target.value }))}
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-bassani-500"
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Signature canvas */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Your signature</p>
                  <button onClick={clearCanvas} className="text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-1">Clear</button>
                </div>
                <div className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                  <canvas
                    ref={canvasRef} width={300} height={120}
                    className="w-full touch-none cursor-crosshair" style={{ display: "block" }}
                    onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                    onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw}
                  />
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">Draw your signature above — embedded in the signed document</p>
              </div>

            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 shrink-0">
              <button
                onClick={handleSign}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bassani-600
                  hover:bg-bassani-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl
                  transition-colors"
              >
                {generating
                  ? <><Loader2 size={13} className="animate-spin" /> Signing…</>
                  : <><PenLine size={13} /> Sign document</>
                }
              </button>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

// ── Validation helpers ─────────────────────────────────────────────────────────

function validateSAID(id) {
  if (!/^\d{13}$/.test(id)) return false;
  const month = parseInt(id.substring(2, 4), 10);
  const day   = parseInt(id.substring(4, 6), 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return false;
  let sum = 0;
  for (let pos = 1; pos <= 13; pos++) {
    let d = parseInt(id[13 - pos], 10);
    if (pos % 2 === 0) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

function validateSAPhone(phone) {
  const stripped = phone.trim().replace(/[\s\-()]/g, "");
  return /^(\+27|0)\d{9}$/.test(stripped);
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function PublicRegister() {
  const [searchParams] = useSearchParams();
  const refCode        = searchParams.get("ref") || null;

  const [sessionId]           = useState(() => crypto.randomUUID());
  const [step,       setStep] = useState(0);
  const [form,       setForm] = useState(BLANK);
  const [submitting, setSubmitting] = useState(false);
  const [reference,  setReference] = useState(null);

  const [referrerName, setReferrerName] = useState(null);

  // uploads holds both portal-signed PDFs and the CIPC manual upload
  const [uploads,      setUploads]      = useState({});
  const [uploadingDoc, setUploadingDoc] = useState(null);
  const [removingDoc,  setRemovingDoc]  = useState(null);
  const [signingDoc,   setSigningDoc]   = useState(null); // doc type currently open in CustomerSigningModal
  const cipcFileRef = useRef(null);

  const upd = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));
  const isSoleProprietor = form.business_type === "Sole Proprietor";

  useEffect(() => {
    if (!refCode) return;
    api.get(`/api/public/referral/${refCode}`)
      .then(r => setReferrerName(r.data.reseller_name))
      .catch(() => {});
  }, [refCode]);

  // ── Document helpers ────────────────────────────────────────────────────────

  const uploadCipc = async (file) => {
    setUploadingDoc("cipc_certificate");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const { data } = await api.post(
        `/api/public/documents/upload?session_id=${sessionId}&doc_type=cipc_certificate`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );
      setUploads(prev => ({ ...prev, cipc_certificate: data }));
      toast.success("CIPC certificate uploaded");
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
      if (!form.business_type) { toast.error("Please select your business type"); return false; }
      if (!form.company_name.trim()) { toast.error("Company name is required"); return false; }
      const reg = form.registration_number.trim();
      if (!isSoleProprietor) {
        if (!reg) { toast.error("Company registration number is required"); return false; }
        if (!/^(\d{4}\/\d{4,7}\/\d{2}|CK.+)$/i.test(reg)) {
          toast.error("Registration number format: 2024/123456/07 or CK####/######/##"); return false;
        }
      }
      const vat = form.vat_number.trim();
      if (vat && !/^4\d{9}$/.test(vat)) {
        toast.error("VAT number must be 10 digits starting with 4"); return false;
      }
    }
    if (step === 1) {
      if (!form.contact_name.trim())     { toast.error("Full name is required"); return false; }
      if (!form.contact_position.trim()) { toast.error("Position / title is required"); return false; }
      const idNum = form.signatory_id_number.trim();
      if (!idNum)               { toast.error("ID number is required"); return false; }
      if (!validateSAID(idNum)) { toast.error("Please enter a valid 13-digit South African ID number"); return false; }
      if (!form.contact_email.trim()) { toast.error("Email address is required"); return false; }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.contact_email.trim())) {
        toast.error("Please enter a valid email address"); return false;
      }
      if (!form.contact_phone.trim()) { toast.error("Phone number is required"); return false; }
      if (!validateSAPhone(form.contact_phone)) {
        toast.error("Please enter a valid South African phone number (e.g. 011 555 1234 or +27 82 555 1234)"); return false;
      }
      if (form.contact_alt_phone.trim() && !validateSAPhone(form.contact_alt_phone)) {
        toast.error("Alternative phone number is not a valid South African number"); return false;
      }
    }
    if (step === 2) {
      if (!form.street.trim())  { toast.error("Street address is required"); return false; }
      if (!form.suburb.trim())  { toast.error("Suburb is required"); return false; }
      if (!form.city.trim())    { toast.error("City is required"); return false; }
      if (!form.province)       { toast.error("Province is required"); return false; }
      const pc = form.postal_code.trim();
      if (!pc)                  { toast.error("Postal code is required"); return false; }
      if (!/^\d{4}$/.test(pc)) { toast.error("Postal code must be exactly 4 digits"); return false; }
    }
    if (step === 4) {
      const missingSigned = SIGN_DOCS.filter(d => !uploads[d.type]);
      if (missingSigned.length) {
        toast.error(`Sign all documents before submitting (${missingSigned.length} remaining)`);
        return false;
      }
      if (!uploads.cipc_certificate) {
        toast.error("Upload your CIPC Company Registration Certificate before submitting");
        return false;
      }
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

  // ── Step 4 — Sign Documents ─────────────────────────────────────────────────

  const signedCount = SIGN_DOCS.filter(d => uploads[d.type]).length;
  const allSigned   = signedCount === SIGN_DOCS.length;
  const hasCipc     = !!uploads.cipc_certificate;
  const readyToSubmit = allSigned && hasCipc;

  const step5Content = (
    <div className="space-y-5">
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
        <p className="text-xs font-semibold text-blue-800 mb-1">Sign your onboarding documents</p>
        <p className="text-xs text-blue-700 leading-relaxed">
          Your details have been pre-filled from the information you provided. Review the document,
          draw your signature, and click Sign. The Customer Information Form must be signed before you can submit.
          You will receive the NDA and Store Onboarding Agreement to sign after your submission is reviewed.
        </p>
      </div>

      {/* In-portal signing cards */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Onboarding documents</p>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            allSigned ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"
          }`}>
            {signedCount} / {SIGN_DOCS.length} signed
          </span>
        </div>
        <div className="space-y-2">
          {SIGN_DOCS.map(doc => {
            const signed = !!uploads[doc.type];
            return (
              <div
                key={doc.type}
                className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${
                  signed ? "bg-green-50 border-green-100" : "bg-gray-50 border-gray-100"
                }`}
              >
                <div className="shrink-0">
                  {signed
                    ? <CheckCircle size={15} className="text-green-600" />
                    : <FileText    size={15} className="text-gray-400"  />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-semibold truncate ${signed ? "text-green-800" : "text-gray-700"}`}>
                    {doc.label}
                  </p>
                  {signed && (
                    <p className="text-[10px] text-green-600 mt-0.5">Signed and saved</p>
                  )}
                </div>
                {signed ? (
                  <button
                    onClick={() => { removeDoc(doc.type); }}
                    disabled={!!removingDoc}
                    title="Remove and re-sign"
                    className="shrink-0 p-1 rounded hover:bg-green-100 text-green-500 hover:text-red-400 transition-colors disabled:opacity-50"
                  >
                    {removingDoc === doc.type ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
                  </button>
                ) : (
                  <button
                    onClick={() => setSigningDoc(doc)}
                    className="shrink-0 flex items-center gap-1.5 text-xs font-semibold
                      text-bassani-600 hover:text-bassani-700 border border-bassani-200 hover:border-bassani-300
                      bg-white hover:bg-bassani-50 rounded-lg px-3 py-1.5 transition-colors"
                  >
                    <PenLine size={11} />
                    Sign
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* CIPC certificate upload */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Company registration</p>
        <div className={`flex items-center gap-3 rounded-xl px-4 py-3 border transition-colors ${
          hasCipc ? "bg-green-50 border-green-100" : "bg-gray-50 border-gray-100"
        }`}>
          <div className="shrink-0">
            {uploadingDoc === "cipc_certificate"
              ? <Loader2 size={15} className="text-bassani-500 animate-spin" />
              : hasCipc
                ? <CheckCircle size={15} className="text-green-600" />
                : <FileText    size={15} className="text-gray-400"  />
            }
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-xs font-semibold truncate ${hasCipc ? "text-green-800" : "text-gray-700"}`}>
              CIPC Company Registration Certificate
            </p>
            {hasCipc
              ? <p className="text-[10px] text-green-600 mt-0.5">{uploads.cipc_certificate?.filename}</p>
              : <p className="text-[10px] text-gray-400 mt-0.5">Upload your official CIPC certificate (PDF, JPG, or PNG)</p>
            }
          </div>
          {hasCipc ? (
            <button
              onClick={() => removeDoc("cipc_certificate")}
              disabled={!!removingDoc}
              title="Remove and re-upload"
              className="shrink-0 p-1 rounded hover:bg-green-100 text-green-500 hover:text-red-400 transition-colors disabled:opacity-50"
            >
              {removingDoc === "cipc_certificate" ? <Loader2 size={12} className="animate-spin" /> : <X size={12} />}
            </button>
          ) : (
            <>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                ref={cipcFileRef}
                onChange={e => {
                  if (e.target.files[0]) uploadCipc(e.target.files[0]);
                  e.target.value = "";
                }}
              />
              <button
                onClick={() => cipcFileRef.current?.click()}
                disabled={!!uploadingDoc}
                className="shrink-0 flex items-center gap-1 text-xs font-semibold
                  text-bassani-600 hover:text-bassani-700 disabled:opacity-50 transition-colors"
              >
                <Upload size={11} />
                Upload
              </button>
            </>
          )}
        </div>
      </div>

      {!readyToSubmit && (
        <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
          <AlertCircle size={13} className="text-amber-600 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700">
            Sign the Customer Information Form and upload your CIPC certificate to submit your application.
          </p>
        </div>
      )}
    </div>
  );

  // ── Step content ────────────────────────────────────────────────────────────

  const stepContent = [
    // Step 0 — Business Details
    <div key="0" className="space-y-4">
      <Field label="Business Type" required>
        <SelectInput
          value={form.business_type}
          onChange={(e) => setForm(f => ({
            ...f,
            business_type: e.target.value,
            ...(e.target.value === "Sole Proprietor" ? { registration_number: "" } : {}),
          }))}
        >
          <option value="">— Select business type —</option>
          {BUSINESS_TYPE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </SelectInput>
      </Field>
      <Field label={isSoleProprietor ? "Business / Trading Name" : "Registered Company Name"} required>
        <TextInput
          value={form.company_name}
          onChange={upd("company_name")}
          placeholder={isSoleProprietor ? "e.g. John Smith Trading" : "e.g. Wellness Pharma (Pty) Ltd"}
          autoFocus
        />
      </Field>
      {!isSoleProprietor && (
        <Field label="Trading Name (if different)">
          <TextInput value={form.trading_name} onChange={upd("trading_name")} placeholder="e.g. City Pharmacy" />
        </Field>
      )}
      {!isSoleProprietor ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Company Registration No." required>
            <TextInput value={form.registration_number} onChange={upd("registration_number")} placeholder="2024/123456/07" />
          </Field>
          <Field label="VAT Number">
            <TextInput value={form.vat_number} onChange={upd("vat_number")} placeholder="4xxxxxxxxx" />
          </Field>
        </div>
      ) : (
        <Field label="VAT Number">
          <TextInput value={form.vat_number} onChange={upd("vat_number")} placeholder="4xxxxxxxxx" />
        </Field>
      )}
    </div>,

    // Step 1 — Primary Contact
    <div key="1" className="space-y-4">
      <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        Please provide details for the person signing the onboarding documents.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full Name" required>
          <TextInput value={form.contact_name} onChange={upd("contact_name")} placeholder="Jane Smith" autoFocus />
        </Field>
        <Field label="Position / Title" required>
          <TextInput value={form.contact_position} onChange={upd("contact_position")} placeholder="Pharmacist / Manager" />
        </Field>
      </div>
      <Field label="SA ID Number" required>
        <TextInput value={form.signatory_id_number} onChange={upd("signatory_id_number")} placeholder="8001015009087" />
      </Field>
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

    // Step 2 — Business Address
    <div key="2" className="space-y-4">
      <Field label="Street Address" required>
        <AddressAutocomplete
          value={form.street}
          onChange={(v) => setForm(f => ({ ...f, street: v }))}
          onAddressSelect={(fields) => setForm(f => ({ ...f, ...fields }))}
          placeholder="123 Health Street"
          autoFocus
        />
      </Field>
      <Field label="Suburb" required>
        <TextInput value={form.suburb} onChange={upd("suburb")} placeholder="Sandton" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="City" required>
          <TextInput value={form.city} onChange={upd("city")} placeholder="Johannesburg" />
        </Field>
        <Field label="Postal Code" required>
          <TextInput value={form.postal_code} onChange={upd("postal_code")} placeholder="2196" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Province" required>
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

    // Step 3 — Additional Information
    <div key="3" className="space-y-4">
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

    // Step 4 — Sign Documents
    step5Content,
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
                className="px-5 py-2 bg-bassani-600 hover:bg-bassani-700 text-white text-sm
                  font-semibold rounded-lg transition-colors">
                Continue
              </button>
            ) : (
              <button
                onClick={submit}
                disabled={submitting || !readyToSubmit}
                title={!readyToSubmit ? "Sign all documents and upload CIPC certificate to submit" : undefined}
                className="px-5 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-40
                  disabled:cursor-not-allowed text-white text-sm font-semibold rounded-lg transition-colors"
              >
                {submitting
                  ? <span className="flex items-center gap-2"><Loader2 size={13} className="animate-spin" />Submitting…</span>
                  : "Submit Application"
                }
              </button>
            )}
          </div>
        </div>

        {/* Summary sidebar (shown after step 0) */}
        {step > 0 && (
          <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Application Summary</p>
            <div className="space-y-1.5 text-xs">
              {form.company_name && <div className="flex justify-between"><span className="text-gray-400">Company</span><span className="font-medium text-gray-700">{form.company_name}</span></div>}
              {form.business_type && <div className="flex justify-between"><span className="text-gray-400">Type</span><span className="font-medium text-gray-700">{form.business_type}</span></div>}
              {step > 1 && form.contact_name  && <div className="flex justify-between"><span className="text-gray-400">Contact</span><span className="font-medium text-gray-700">{form.contact_name}</span></div>}
              {step > 1 && form.contact_email && <div className="flex justify-between"><span className="text-gray-400">Email</span><span className="font-medium text-gray-700 truncate max-w-[160px]">{form.contact_email}</span></div>}
              {step > 2 && form.city && <div className="flex justify-between"><span className="text-gray-400">City</span><span className="font-medium text-gray-700">{form.city}{form.province ? `, ${form.province}` : ""}</span></div>}
              {step >= 4 && (
                <div className="flex justify-between">
                  <span className="text-gray-400">Documents</span>
                  <span className={`font-medium ${allSigned && hasCipc ? "text-green-700" : "text-amber-600"}`}>
                    {signedCount}/1 signed{hasCipc ? " + CIPC" : ""}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[11px] text-gray-400 pb-4">
          Bassani Health (Pty) Ltd &nbsp;&middot;&nbsp; Licensed medicinal cannabis distributor &nbsp;&middot;&nbsp; Cnr Dytchley &amp; Marcius Roads, Kyalami
        </p>
      </div>

      {/* Customer signing modal */}
      {signingDoc && (
        <CustomerSigningModal
          docType={signingDoc.type}
          docLabel={signingDoc.label}
          filename={signingDoc.filename}
          form={form}
          sessionId={sessionId}
          onSigned={(data) => setUploads(prev => ({ ...prev, [signingDoc.type]: data }))}
          onClose={() => setSigningDoc(null)}
        />
      )}
    </div>
  );
}
