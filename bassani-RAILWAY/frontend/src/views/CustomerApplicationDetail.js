import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  CheckCircle, XCircle, Clock, ArrowLeft, Building2, User,
  MapPin, ClipboardList, FileText, Download, Loader2, AlertTriangle,
  Eye, X, Mail, PenLine, RotateCcw, FileCheck, UserCheck, UserMinus, Send,
  Upload,
} from "lucide-react";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";
import { Spinner, Modal, BtnPrimary, BtnSecondary, fmtDate } from "../components/UI";
import { DOC_CONFIGS, detectFields, countersignPdf } from "../utils/pdfSigning";

// ── Status helpers ─────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending_review:             { label: "Pending Review",     cls: "bg-gray-50   text-gray-700   border-gray-200",   dot: "bg-gray-400",   icon: Clock       },
  docs_generated:             { label: "Docs Generated",     cls: "bg-indigo-50 text-indigo-700 border-indigo-200", dot: "bg-indigo-400", icon: FileText    },
  awaiting_signature:         { label: "Awaiting Signature", cls: "bg-amber-50  text-amber-700  border-amber-200",  dot: "bg-amber-400",  icon: PenLine     },
  awaiting_docs:              { label: "Awaiting Docs",      cls: "bg-amber-50  text-amber-700  border-amber-200",  dot: "bg-amber-400",  icon: Clock       },
  needs_countersigning:       { label: "Needs Countersign",  cls: "bg-blue-50   text-blue-700   border-blue-200",   dot: "bg-blue-400",   icon: PenLine     },
  countersigning_in_progress: { label: "In Progress",        cls: "bg-purple-50 text-purple-700 border-purple-200", dot: "bg-purple-400", icon: PenLine     },
  ready_to_approve:           { label: "Ready to Approve",   cls: "bg-teal-50   text-teal-700   border-teal-200",   dot: "bg-teal-400",   icon: FileCheck   },
  approved:                   { label: "Approved",           cls: "bg-green-50  text-green-700  border-green-200",  dot: "bg-green-500",  icon: CheckCircle },
  rejected:                   { label: "Rejected",           cls: "bg-red-50    text-red-700    border-red-200",    dot: "bg-red-500",    icon: XCircle     },
};

const _BASSANI_SIG_TYPES = new Set(["nda", "store_onboarding_agreement"]);

function deriveStatus(app, docs, signingSession) {
  const s = app?.status;
  if (s === "approved")      return "approved";
  if (s === "rejected")      return "rejected";
  if (s === "awaiting_docs") return "awaiting_docs";
  if (!docs)                 return "pending_review";

  const bdocs = docs.filter(d => d.signed_in_portal && _BASSANI_SIG_TYPES.has(d.doc_type));
  if (bdocs.length >= 2) {
    const signed = bdocs.filter(d => d.countersigned_at).length;
    if (signed === 0)           return "needs_countersigning";
    if (signed < bdocs.length)  return "countersigning_in_progress";
    return "ready_to_approve";
  }

  if (signingSession && !signingSession.expired) {
    const st = signingSession.status;
    if (st === "sent" || st === "pending") return "awaiting_signature";
    return "docs_generated";
  }
  return "pending_review";
}

function StatusBadge({ status, size = "md" }) {
  const cfg  = STATUS_CFG[status] || STATUS_CFG.awaiting_docs;
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

// ── Countersign modal ──────────────────────────────────────────────────────────

const TEMPLATE_FILENAMES = {
  nda:                        "nda.pdf",
  tqa:                        "tqa.pdf",
  store_onboarding_agreement: "store-onboarding-agreement.pdf",
};

function CountersignModal({ doc, appId, onCountersigned, onClose }) {
  const [loading,          setLoading         ] = useState(true);
  const [loadError,        setLoadError        ] = useState(null);
  const [customerPdfBytes, setCustomerPdfBytes ] = useState(null);
  const [blankBytes,       setBlankBytes       ] = useState(null);
  const [storedSigBytes,   setStoredSigBytes   ] = useState(null);
  const [sigMode,          setSigMode          ] = useState("stored");
  const [generating,       setGenerating       ] = useState(false);

  const canvasRef = useRef(null);
  const hasMark   = useRef(false);
  const drawing   = useRef(false);

  const docType  = doc.doc_type;
  const filename = TEMPLATE_FILENAMES[docType];

  useEffect(() => {
    const load = async () => {
      try {
        const [pdfRes, templateRes, sigRes] = await Promise.allSettled([
          // Proxy through backend to avoid CORS on R2 presigned URLs
          api.get(`/api/onboarding/${appId}/documents/${docType}/download`, { responseType: "arraybuffer" }),
          api.get(`/api/public/templates/download/${filename}`, { responseType: "arraybuffer" }),
          api.get("/api/profile/signature", { responseType: "arraybuffer" }),
        ]);

        if (pdfRes.status === "fulfilled") {
          setCustomerPdfBytes(new Uint8Array(pdfRes.value.data));
        } else {
          setLoadError("Could not load the customer-signed document.");
          return;
        }
        if (templateRes.status === "fulfilled") {
          setBlankBytes(new Uint8Array(templateRes.value.data));
        } else {
          setLoadError("Could not load the document template.");
          return;
        }
        if (sigRes.status === "fulfilled") {
          setStoredSigBytes(new Uint8Array(sigRes.value.data));
        }
      } catch {
        setLoadError("Failed to load required assets.");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [appId, docType, filename]);

  const getPos = useCallback((e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };
  }, []);

  const startDraw = useCallback((e) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    drawing.current = true;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(pos.x, pos.y);
    e.preventDefault();
  }, [getPos]);

  const draw = useCallback((e) => {
    if (!drawing.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const pos = getPos(e, canvas);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = "#1e3a5f";
    ctx.lineWidth   = 2;
    ctx.lineCap     = "round";
    ctx.stroke();
    hasMark.current = true;
    e.preventDefault();
  }, [getPos]);

  const stopDraw = useCallback(() => { drawing.current = false; }, []);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
    hasMark.current = false;
  };

  const handleCountersign = async () => {
    setGenerating(true);
    try {
      let finalSigBytes = storedSigBytes;

      if (sigMode === "draw") {
        if (!hasMark.current) {
          toast.error("Draw your signature before countersigning");
          return;
        }
        const dataUrl = canvasRef.current.toDataURL("image/png");
        const b64     = dataUrl.replace(/^data:image\/png;base64,/, "");
        finalSigBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      }

      if (!finalSigBytes) {
        toast.error("No signature available — configure one in Signing Authority settings or draw one here");
        return;
      }
      if (!blankBytes) {
        toast.error("Template not loaded — cannot determine signature position");
        return;
      }

      const countersignedBytes = await countersignPdf(
        customerPdfBytes, blankBytes, docType, finalSigBytes
      );

      const blob = new Blob([countersignedBytes], { type: "application/pdf" });
      const file = new File([blob], `${docType}-countersigned.pdf`, { type: "application/pdf" });
      const fd   = new FormData();
      fd.append("file", file);

      const { data } = await api.post(
        `/api/onboarding/${appId}/countersign/${docType}`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } },
      );

      onCountersigned(docType, data);
      toast.success(`${doc.label || docType} countersigned`);
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.detail || "Countersigning failed");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-6xl overflow-hidden"
        style={{ height: "92vh" }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <PenLine size={15} className="text-bassani-600" />
            <div>
              <p className="text-sm font-bold text-gray-900">Countersign Document</p>
              <p className="text-[11px] text-gray-400">{doc.label || docType}</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 flex items-center justify-center gap-3 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Loading documents…</span>
          </div>
        ) : loadError ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-center gap-3 bg-red-50 border border-red-100 rounded-xl px-5 py-4 max-w-md">
              <AlertTriangle size={16} className="text-red-500 shrink-0" />
              <p className="text-sm text-red-700">{loadError}</p>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex overflow-hidden">
            {/* Left — customer-signed PDF preview */}
            <div className="hidden md:flex flex-col flex-1 border-r border-gray-100 bg-gray-50">
              <div className="px-4 py-2.5 border-b border-gray-100 bg-white shrink-0">
                <p className="text-xs font-semibold text-gray-500">Customer-signed document (read-only)</p>
              </div>
              <iframe src={doc.download_url} title={doc.label || docType}
                className="flex-1 w-full" style={{ border: "none" }} />
            </div>

            {/* Right — signature panel */}
            <div className="w-full md:w-80 shrink-0 flex flex-col overflow-y-auto">
              <div className="p-5 space-y-4 flex-1">

                <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <p className="text-xs font-semibold text-blue-800 mb-1">Your signature position</p>
                  <p className="text-[11px] text-blue-600 leading-relaxed">
                    Your countersignature will be placed in the Bassani signing authority field. The customer's signature and all form data remain unchanged.
                  </p>
                </div>

                {/* Mode toggle */}
                <div>
                  <p className="text-xs font-semibold text-gray-600 mb-2">Signature</p>
                  <div className="flex rounded-xl border border-gray-200 overflow-hidden text-xs font-semibold">
                    <button
                      onClick={() => setSigMode("stored")}
                      className={`flex-1 py-2 transition-colors ${sigMode === "stored" ? "bg-bassani-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
                    >
                      Use stored
                    </button>
                    <button
                      onClick={() => setSigMode("draw")}
                      className={`flex-1 py-2 transition-colors ${sigMode === "draw" ? "bg-bassani-600 text-white" : "text-gray-500 hover:bg-gray-50"}`}
                    >
                      Draw new
                    </button>
                  </div>
                </div>

                {sigMode === "stored" ? (
                  storedSigBytes ? (
                    <div className="border border-gray-200 rounded-xl overflow-hidden bg-gray-50 flex items-center justify-center" style={{ height: 100 }}>
                      <img
                        src={URL.createObjectURL(new Blob([storedSigBytes], { type: "image/png" }))}
                        alt="Stored signature"
                        className="max-h-full max-w-full object-contain p-2"
                      />
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-3">
                      <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                      <p className="text-[11px] text-amber-700">No stored signature found. Draw one below or configure it in Signing Authority settings.</p>
                    </div>
                  )
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1.5">
                      <p className="text-[11px] text-gray-400">Draw your signature</p>
                      <button onClick={clearCanvas} className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-600 transition-colors">
                        <RotateCcw size={11} /> Clear
                      </button>
                    </div>
                    <canvas
                      ref={canvasRef}
                      width={288}
                      height={100}
                      className="border border-gray-200 rounded-xl bg-white w-full touch-none cursor-crosshair"
                      style={{ height: 100 }}
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={stopDraw}
                      onMouseLeave={stopDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={stopDraw}
                    />
                    <p className="text-[10px] text-gray-400 mt-1">Sign within the box above</p>
                  </div>
                )}

                <div className="bg-gray-50 border border-gray-100 rounded-xl px-4 py-3">
                  <p className="text-[11px] text-gray-500 leading-relaxed">
                    By countersigning, you confirm Bassani Health's acceptance of this onboarding agreement. This action is permanent and audit-logged.
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div className="p-4 border-t border-gray-100 shrink-0 space-y-2">
                <button
                  onClick={handleCountersign}
                  disabled={generating || (sigMode === "stored" && !storedSigBytes)}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {generating
                    ? <><Loader2 size={14} className="animate-spin" /> Countersigning…</>
                    : <><PenLine size={14} /> Countersign Document</>
                  }
                </button>
                <button onClick={onClose} disabled={generating}
                  className="w-full px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Documents section ──────────────────────────────────────────────────────────

const BASSANI_SIG_TYPES = new Set(["nda", "store_onboarding_agreement"]);

function DocumentsCard({ appId, docs, loading, isHolder, onDocUpdate, signingSession, onGenerateSigningDocs, generatingSignDocs, onSendSigningLink, sendingSignLink, onPreviewDoc, canSendDocs }) {
  const [viewing,        setViewing       ] = useState(null);
  const [countersigning, setCountersigning] = useState(null);

  const handleCountersigned = (docType, meta) => {
    onDocUpdate(docType, meta);
    setCountersigning(null);
  };

  return (
    <>
      {viewing && <PdfViewer doc={viewing} onClose={() => setViewing(null)} />}
      {countersigning && (
        <CountersignModal
          doc={countersigning}
          appId={appId}
          onCountersigned={handleCountersigned}
          onClose={() => setCountersigning(null)}
        />
      )}
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
            {docs.map((d, i) => {
              const needsCountersign = d.signed_in_portal && BASSANI_SIG_TYPES.has(d.doc_type) && !d.countersigned_at;
              const isCountersigned  = Boolean(d.countersigned_at);
              const isPortalSigned   = Boolean(d.signed_in_portal);

              return (
                <div key={i} className="bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                  <div className="flex items-center justify-between gap-3">
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
                      <div className="flex items-center gap-3 shrink-0 ml-2">
                        <button onClick={() => setViewing(d)}
                          className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
                          <Eye size={12} /> View
                        </button>
                        <a href={d.download_url} target="_blank" rel="noreferrer"
                          className="flex items-center gap-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 transition-colors">
                          <Download size={12} /> Download
                        </a>
                        {isHolder && needsCountersign && (
                          <button onClick={() => setCountersigning(d)}
                            className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:text-blue-700 transition-colors">
                            <PenLine size={12} /> Countersign
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className="text-[10px] text-gray-400 shrink-0 ml-4">Unavailable</span>
                    )}
                  </div>

                  {/* Per-doc status badges */}
                  {(isPortalSigned || isCountersigned) && (
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {isPortalSigned && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5">
                          <PenLine size={9} /> Signed in portal
                        </span>
                      )}
                      {isCountersigned ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-100 rounded px-1.5 py-0.5">
                          <CheckCircle size={9} /> Countersigned{d.countersigned_by ? ` by ${d.countersigned_by}` : ""}
                        </span>
                      ) : needsCountersign ? (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-100 rounded px-1.5 py-0.5">
                          <Clock size={9} /> Awaiting countersignature
                        </span>
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Signing session panel */}
      {canSendDocs && (() => {
        const submittedTypes = new Set((docs || []).map(d => d.doc_type));
        const hasInitialDocs = submittedTypes.has("customer_information_form") && submittedTypes.has("cipc_certificate");
        const ndaSigned = submittedTypes.has("nda");
        const soaSigned = submittedTypes.has("store_onboarding_agreement");
        const allSigningDone = ndaSigned && soaSigned;

        if (allSigningDone) return null; // all docs collected — no panel needed

        const sessionExists  = signingSession && !signingSession.expired;
        const sessionExpired = signingSession?.expired;
        // "pending" is the legacy status from before the generate/send split — treat as sent
        const sessionSent    = sessionExists && (signingSession.status === "sent" || signingSession.status === "pending");
        const sessionGenerated = sessionExists && signingSession.status === "generated";

        return (
          <Card icon={Send} title="NDA and Store Agreement">
            {!hasInitialDocs ? (
              <div className="flex items-start gap-2.5 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
                <AlertTriangle size={14} className="text-amber-500 shrink-0 mt-0.5" />
                <p className="text-xs text-amber-700">
                  The Customer Information Form and CIPC certificate must be submitted before you can generate the NDA and Store Agreement.
                </p>
              </div>
            ) : sessionSent ? (
              /* ── Sent to customer — awaiting their signature ── */
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                  <Clock size={14} className="text-blue-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-blue-800 mb-0.5">Awaiting customer signature</p>
                    <p className="text-xs text-blue-700">
                      Signing link sent {signingSession.sent_at ? new Date(signingSession.sent_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" }) : ""}.
                      {signingSession.expires_at ? ` Expires ${new Date(signingSession.expires_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}.` : ""}
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {["nda", "store_onboarding_agreement"].map(dt => {
                    const label    = dt === "nda" ? "NDA" : "Store Onboarding Agreement";
                    const isSigned = !!(signingSession.signed?.[dt] || submittedTypes.has(dt));
                    return (
                      <div key={dt} className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs ${isSigned ? "bg-green-50 text-green-700" : "bg-gray-50 text-gray-500"}`}>
                        {isSigned
                          ? <CheckCircle size={13} className="text-green-600 shrink-0" />
                          : <div className="w-3 h-3 rounded-full border-2 border-gray-300 shrink-0" />}
                        <span className="font-medium">{label}</span>
                        {isSigned && <span className="ml-auto text-[10px] font-semibold text-green-600">Signed</span>}
                      </div>
                    );
                  })}
                </div>
                <button
                  onClick={onSendSigningLink}
                  disabled={sendingSignLink}
                  className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 disabled:opacity-50 transition-colors"
                >
                  {sendingSignLink ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                  Resend signing link
                </button>
              </div>
            ) : sessionGenerated ? (
              /* ── Documents generated — admin review before sending ── */
              <div className="space-y-3">
                <div className="flex items-start gap-2.5 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
                  <CheckCircle size={14} className="text-green-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-green-800 mb-0.5">Documents generated</p>
                    <p className="text-xs text-green-700">
                      Pre-filled with the customer&apos;s application data. Review the documents below before sending.
                    </p>
                  </div>
                </div>
                <div className="space-y-1.5">
                  {[
                    { dt: "nda",                       label: "Non-Disclosure Agreement" },
                    { dt: "store_onboarding_agreement", label: "Store Onboarding Agreement" },
                  ].map(({ dt, label }) => (
                    <div key={dt} className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2.5 border border-gray-100">
                      <div className="flex items-center gap-2 text-xs font-medium text-gray-700">
                        <FileText size={13} className="text-bassani-500 shrink-0" />
                        {label}
                      </div>
                      <button
                        onClick={() => onPreviewDoc(dt)}
                        className="flex items-center gap-1 text-[11px] font-semibold text-bassani-600 hover:text-bassani-700 transition-colors"
                      >
                        <Eye size={11} /> Preview
                      </button>
                    </div>
                  ))}
                </div>
                <button
                  onClick={onSendSigningLink}
                  disabled={sendingSignLink}
                  className="flex items-center justify-center gap-2 w-full px-4 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors"
                >
                  {sendingSignLink ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Send to Customer
                </button>
                <p className="text-[11px] text-gray-400">
                  The customer will receive an email with a secure link to sign both documents.
                </p>
              </div>
            ) : (
              /* ── No session yet / expired ── */
              <div className="space-y-3">
                {sessionExpired && (
                  <div className="flex items-start gap-2 bg-red-50 border border-red-100 rounded-xl px-4 py-3">
                    <AlertTriangle size={13} className="text-red-500 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">The previous signing session has expired. Generate a new one below.</p>
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  The initial documents have been received. Generate pre-filled copies of the NDA and Store Agreement for review before sending them to the customer.
                </p>
                <button
                  onClick={onGenerateSigningDocs}
                  disabled={generatingSignDocs}
                  className="flex items-center gap-2 px-4 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-xs font-semibold rounded-xl transition-colors"
                >
                  {generatingSignDocs ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
                  Generate Documents
                </button>
              </div>
            )}
          </Card>
        );
      })()}
    </>
  );
}

// ── Application timeline ───────────────────────────────────────────────────────

const BASSANI_SIG_SET = new Set(["nda", "store_onboarding_agreement"]);

const TL_CFG = {
  submitted:    { Icon: FileText,    bg: "bg-blue-100",   iconCls: "text-blue-600"   },
  uploaded:     { Icon: Upload,      bg: "bg-gray-100",   iconCls: "text-gray-500"   },
  signed:       { Icon: PenLine,     bg: "bg-indigo-100", iconCls: "text-indigo-600" },
  generated:    { Icon: FileText,    bg: "bg-purple-100", iconCls: "text-purple-600" },
  link_sent:    { Icon: Send,        bg: "bg-purple-100", iconCls: "text-purple-600" },
  countersigned:{ Icon: FileCheck,   bg: "bg-teal-100",   iconCls: "text-teal-600"   },
  welcome_pack: { Icon: Mail,        bg: "bg-teal-100",   iconCls: "text-teal-600"   },
  approved:     { Icon: CheckCircle, bg: "bg-green-100",  iconCls: "text-green-600"  },
  rejected:     { Icon: XCircle,     bg: "bg-red-100",    iconCls: "text-red-600"    },
};

function fmtTs(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d)) return null;
  return d.toLocaleString("en-ZA", {
    day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function buildTimeline(app, docs, signingSession) {
  const events = [];
  const push = (at, type, title, detail = null) => {
    if (!at) return;
    events.push({ at: new Date(at), type, title, detail, ...TL_CFG[type] });
  };

  // 1. Submission
  push(
    app.submitted_at,
    "submitted",
    "Application submitted",
    app.reseller_name
      ? `Submitted by ${app.reseller_name}`
      : app.source === "self_service" ? "Self-service registration" : null,
  );

  // 2. Documents uploaded / signed by customer at registration
  for (const doc of docs || []) {
    if (!doc.uploaded_at) continue;
    if (BASSANI_SIG_SET.has(doc.doc_type)) continue; // handled separately below
    if (doc.signed_in_portal) {
      push(doc.uploaded_at, "signed", `${doc.label || doc.doc_type} signed by customer`, "Signed in the customer portal");
    } else {
      push(doc.uploaded_at, "uploaded", `${doc.label || doc.doc_type} uploaded`, null);
    }
  }

  // 3. Signing session generated
  push(
    app.signing_session_generated_at,
    "generated",
    "NDA and Store Agreement generated",
    signingSession?.generated_by_name ? `by ${signingSession.generated_by_name}` : null,
  );

  // 4. Signing link sent to customer
  push(
    signingSession?.sent_at,
    "link_sent",
    "Signing link sent to customer",
    signingSession?.sent_by_name ? `by ${signingSession.sent_by_name}` : null,
  );

  // 5. NDA + SOA signed by customer
  for (const doc of docs || []) {
    if (!doc.uploaded_at || !BASSANI_SIG_SET.has(doc.doc_type) || !doc.signed_in_portal) continue;
    push(doc.uploaded_at, "signed", `${doc.label || doc.doc_type} signed by customer`, "Signed in the customer portal");
  }

  // 6. Countersignatures
  for (const doc of docs || []) {
    if (!doc.countersigned_at) continue;
    push(
      doc.countersigned_at,
      "countersigned",
      `${doc.label || doc.doc_type} countersigned`,
      doc.countersigned_by ? `by ${doc.countersigned_by}` : null,
    );
  }

  // 7. Welcome pack
  push(
    app.welcome_pack_sent_at,
    "welcome_pack",
    "Welcome pack sent to customer",
    app.welcome_pack_sent_by ? `by ${app.welcome_pack_sent_by}` : null,
  );

  // 8. Approval / rejection
  if (app.reviewed_at) {
    const isRejected = app.status === "rejected";
    const detail = [
      app.reviewed_by ? `by ${app.reviewed_by}` : null,
      isRejected && app.rejection_reason ? `Reason: ${app.rejection_reason}` : null,
    ].filter(Boolean).join(" — ");
    push(app.reviewed_at, isRejected ? "rejected" : "approved",
      isRejected ? "Application rejected" : "Application approved and customer created",
      detail || null,
    );
  }

  events.sort((a, b) => a.at - b.at);
  return events;
}

function TimelineCard({ app, docs, signingSession }) {
  const events = buildTimeline(app, docs, signingSession);

  return (
    <Card icon={Clock} title="Activity Timeline">
      {events.length === 0 ? (
        <p className="text-xs text-gray-300">No activity yet.</p>
      ) : (
        <div className="relative">
          {/* Vertical connector line */}
          <div className="absolute left-[9px] top-2 bottom-2 w-px bg-gray-100 pointer-events-none" />

          <div className="space-y-4">
            {events.map((ev, i) => (
              <div key={i} className="flex items-start gap-3 relative">
                {/* Dot */}
                <div className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 z-10 ${ev.bg}`}>
                  <ev.Icon size={9} className={ev.iconCls} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0 pb-0.5">
                  <p className="text-xs font-semibold text-gray-800 leading-snug">{ev.title}</p>
                  {ev.detail && (
                    <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{ev.detail}</p>
                  )}
                  <p className="text-[10px] text-gray-300 mt-1 tabular-nums">{fmtTs(ev.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

// ── Welcome pack compose modal ─────────────────────────────────────────────────

function WelcomePackModal({ app, docs, user, onSend, sending, onClose }) {
  const companyName   = app.company_name || app.contact_name || "Customer";
  const defaultSubject = "Welcome to Bassani Health";
  const defaultBody    = `Dear ${companyName},\n\nPlease find attached your signed onboarding documents and our welcome pack.\n\nWe look forward to working with you.`;
  const [subject, setSubject] = useState(defaultSubject);
  const [message, setMessage] = useState(defaultBody);

  const countersignedDocs = (docs || []).filter(
    d => d.signed_in_portal && BASSANI_SIG_TYPES.has(d.doc_type) && d.countersigned_at
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-2xl overflow-hidden" style={{ maxHeight: "92vh" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <Send size={15} className="text-teal-600" />
            <span className="text-sm font-bold text-gray-900">Send Welcome Pack</span>
          </div>
          <button onClick={onClose} disabled={sending} className="text-gray-400 hover:text-gray-700 transition-colors">
            <X size={18} />
          </button>
        </div>

        {/* Compose fields */}
        <div className="flex-1 overflow-y-auto divide-y divide-gray-100">

          {/* From */}
          <div className="flex items-center gap-4 px-5 py-3">
            <span className="text-xs font-semibold text-gray-400 w-14 shrink-0 text-right">From</span>
            <span className="text-sm text-gray-500 truncate">{user?.name || "Bassani Health"} via Bassani Health onboarding</span>
          </div>

          {/* To */}
          <div className="flex items-center gap-4 px-5 py-3">
            <span className="text-xs font-semibold text-gray-400 w-14 shrink-0 text-right">To</span>
            <span className="text-sm font-semibold text-gray-800">{app.contact_email}</span>
          </div>

          {/* Subject */}
          <div className="flex items-center gap-4 px-5 py-3">
            <span className="text-xs font-semibold text-gray-400 w-14 shrink-0 text-right">Subject</span>
            <input
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="flex-1 text-sm text-gray-900 focus:outline-none placeholder-gray-300"
              placeholder="Subject"
            />
          </div>

          {/* Body */}
          <textarea
            value={message}
            onChange={e => setMessage(e.target.value)}
            rows={8}
            autoFocus
            className="w-full px-5 py-4 text-sm text-gray-800 resize-none focus:outline-none leading-relaxed"
            placeholder="Write your message to the customer…"
          />

          {/* Attachments */}
          <div className="px-5 py-4 bg-gray-50">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2.5">
              Attachments ({countersignedDocs.length + 1})
            </p>
            <div className="space-y-1.5">
              {countersignedDocs.map(d => (
                <div key={d.doc_type} className="flex items-center gap-2.5 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                  <FileText size={13} className="text-bassani-500 shrink-0" />
                  <span className="text-xs font-medium text-gray-700 flex-1">{d.label || d.doc_type}</span>
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-green-700 bg-green-50 border border-green-100 rounded px-1.5 py-0.5">
                    <CheckCircle size={9} /> Countersigned
                  </span>
                </div>
              ))}
              <div className="flex items-center gap-2.5 bg-white rounded-xl px-3 py-2.5 border border-gray-100">
                <FileText size={13} className="text-teal-500 shrink-0" />
                <span className="text-xs font-medium text-gray-700">Bassani Health Welcome Pack.pdf</span>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-2 shrink-0">
          <BtnSecondary onClick={onClose} disabled={sending}>Cancel</BtnSecondary>
          <button
            onClick={() => onSend(subject, message)}
            disabled={sending || !message.trim()}
            className="flex items-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            Send Welcome Pack
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Actions sidebar ────────────────────────────────────────────────────────────

function ActionsCard({ app, docs, canApprove, canReject, onApprove, onReject, onUpdate, navigate, signingSession, onGenerateSigningDocs, generatingSignDocs, onSendSigningLink, sendingSignLink, canSendDocs, onSendWelcomePack }) {
  const [rejectMode,     setRejectMode    ] = useState(false);
  const [rejectReason,   setRejectReason  ] = useState("");
  const [companyName,    setCompanyName   ] = useState(app.company_name || "");
  const [loading,        setLoading       ] = useState(false);
  const [contactMode,    setContactMode   ] = useState(false);
  const [contactSubject, setContactSubject] = useState("");
  const [contactMessage, setContactMessage] = useState("");
  const [contactSending, setContactSending] = useState(false);

  const isAwaitingDocs = app.status === "awaiting_docs";
  const isActionable   = app.status === "pending" || isAwaitingDocs;

  const pendingCountersigns = (docs || []).filter(
    d => d.signed_in_portal && BASSANI_SIG_TYPES.has(d.doc_type) && !d.countersigned_at
  );
  const needsCountersign = pendingCountersigns.length > 0;

  // Signing completeness — customer must have returned NDA + SOA before approval is possible
  const allSigningComplete = !isAwaitingDocs && (docs || []).filter(
    d => d.signed_in_portal && BASSANI_SIG_TYPES.has(d.doc_type)
  ).length >= 2;
  // Welcome pack gate — both NDA + SOA must also be countersigned
  const allCountersigned = !isAwaitingDocs && (docs || []).filter(
    d => d.signed_in_portal && BASSANI_SIG_TYPES.has(d.doc_type) && d.countersigned_at
  ).length >= 2;
  const sessionSent      = signingSession && !signingSession.expired && (signingSession.status === "sent" || signingSession.status === "pending");
  const sessionGenerated = signingSession && !signingSession.expired && signingSession.status === "generated";
  const sessionActive    = sessionSent || sessionGenerated;

  if (!isActionable) {
    return (
      <Card title="Decision">
        <MetaRow label="Outcome"     value={STATUS_CFG[deriveStatus(app, docs, signingSession)]?.label} />
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
      onUpdate({ inbox_thread_ids: [...(app.inbox_thread_ids || []), r.data.inbox_thread_id] });
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
      {(app.inbox_thread_ids || []).length > 0 && !contactMode && !rejectMode && (
        <div className="mb-4 -mt-1 space-y-1.5">
          {(app.inbox_thread_ids || []).map((tid, i) => (
            <button
              key={tid}
              onClick={() => navigate(`/onboarding-inbox?thread=${tid}`)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-gray-50 hover:bg-gray-100 text-gray-700 text-xs font-semibold rounded-xl transition-colors border border-gray-200"
            >
              <Mail size={13} />
              {(app.inbox_thread_ids || []).length === 1 ? "View Inbox Thread" : `View Thread ${i + 1}`}
            </button>
          ))}
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

          {needsCountersign && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-3">
              <AlertTriangle size={13} className="text-amber-500 shrink-0 mt-0.5" />
              <div>
                <p className="text-[11px] font-semibold text-amber-800 mb-0.5">Countersignature required</p>
                <p className="text-[10px] text-amber-700">
                  {pendingCountersigns.length} document{pendingCountersigns.length !== 1 ? "s" : ""} must be countersigned by the signing authority before approval.
                </p>
              </div>
            </div>
          )}

          {canApprove && !isAwaitingDocs && !allSigningComplete ? (
            // Signing flow not yet complete — surface the correct next action
            sessionSent ? (
              <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2.5">
                <Clock size={13} className="text-amber-500 shrink-0" />
                <p className="text-xs text-amber-700 font-medium">Awaiting customer signature. Documents have been sent.</p>
              </div>
            ) : sessionGenerated ? (
              <button
                onClick={onSendSigningLink}
                disabled={sendingSignLink}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {sendingSignLink ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                Send to Customer
              </button>
            ) : canSendDocs ? (
              <button
                onClick={onGenerateSigningDocs}
                disabled={generatingSignDocs}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {generatingSignDocs ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                Generate Documents
              </button>
            ) : (
              <div className="flex items-center gap-2 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                <Clock size={13} className="text-gray-400 shrink-0" />
                <p className="text-xs text-gray-500">Awaiting signing documents to be sent to customer.</p>
              </div>
            )
          ) : canApprove && (
            <button
              onClick={handleApprove}
              disabled={loading || needsCountersign || (isAwaitingDocs && !companyName.trim())}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
              Approve &amp; Create Customer
            </button>
          )}

          {canApprove && allCountersigned && !app.welcome_pack_sent_at && (
            <button onClick={onSendWelcomePack} disabled={loading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 text-white text-sm font-semibold rounded-xl transition-colors">
              <Send size={14} />
              Send Welcome Pack
            </button>
          )}

          {canApprove && app.welcome_pack_sent_at && (
            <div className="flex items-center gap-2 bg-green-50 border border-green-100 rounded-xl px-3 py-2">
              <CheckCircle size={13} className="text-green-600 shrink-0" />
              <p className="text-xs text-green-700 font-medium">
                Welcome pack sent{app.welcome_pack_sent_by ? ` by ${app.welcome_pack_sent_by}` : ""}
              </p>
            </div>
          )}

          {!(app.inbox_thread_ids || []).length && canApprove && (
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
  const { id }        = useParams();
  const navigate      = useNavigate();
  const { can, user } = useAuth();
  const isHolder      = can("signing_authority.sign");
  const [app,         setApp        ] = useState(null);
  const [loading,     setLoading    ] = useState(true);
  const [docs,        setDocs       ] = useState(null);
  const [docsLoading, setDocsLoading] = useState(true);
  const [assigning,          setAssigning         ] = useState(false);
  const [takeoverConfirm,    setTakeoverConfirm   ] = useState(false);
  const [signingSession,     setSigningSession    ] = useState(undefined); // undefined = loading, null = none
  const [generatingSignDocs, setGeneratingSignDocs] = useState(false);
  const [sendingSignLink,    setSendingSignLink   ] = useState(false);
  const [welcomePackModal,   setWelcomePackModal  ] = useState(false);
  const [sendingWelcomePack, setSendingWelcomePack] = useState(false);

  useEffect(() => {
    api.get(`/api/onboarding/${id}`)
      .then(r => setApp(r.data))
      .catch(() => { toast.error("Application not found"); navigate("/applications"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const fetchDocs = useCallback(() => {
    api.get(`/api/onboarding/${id}/documents`)
      .then(r => setDocs(r.data.documents || []))
      .catch(() => setDocs([]))
      .finally(() => setDocsLoading(false));
  }, [id]);

  useEffect(() => { fetchDocs(); }, [fetchDocs]);

  const fetchSigningSession = useCallback(() => {
    api.get(`/api/onboarding/${id}/signing-session`)
      .then(r => setSigningSession(r.data.session || null))
      .catch(() => setSigningSession(null));
  }, [id]);

  useEffect(() => { fetchSigningSession(); }, [fetchSigningSession]);

  const generateSigningDocs = async () => {
    setGeneratingSignDocs(true);
    try {
      await api.post(`/api/onboarding/${id}/generate-signing-docs`);
      toast.success("Documents generated — review them before sending to the customer");
      fetchSigningSession();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to generate documents");
    } finally {
      setGeneratingSignDocs(false);
    }
  };

  const sendSigningLink = async () => {
    setSendingSignLink(true);
    try {
      await api.post(`/api/onboarding/${id}/send-signing-docs`);
      toast.success("Signing link sent to customer");
      fetchSigningSession();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send signing link");
    } finally {
      setSendingSignLink(false);
    }
  };

  const previewGeneratedDoc = async (docType) => {
    if (!signingSession?.form_data) return;
    try {
      const tplRes = await api.get(`/api/doc-templates/${docType}/download`, { responseType: "arraybuffer" });
      const { buildPrefill, generateSignedPdf, DOC_CONFIGS } = await import("../utils/pdfSigning");
      const prefill = buildPrefill(docType, signingSession.form_data);
      const pdfBytes = await generateSignedPdf(new Uint8Array(tplRes.data), {
        textValues: prefill,
        config: DOC_CONFIGS[docType],
        addWatermark: true,
      });
      const blob = new Blob([pdfBytes], { type: "application/pdf" });
      window.open(URL.createObjectURL(blob), "_blank");
    } catch (e) {
      console.error("PDF preview failed:", e);
      toast.error("Failed to generate preview");
    }
  };

  const sendWelcomePack = async (subject, message) => {
    setSendingWelcomePack(true);
    try {
      const r = await api.post(`/api/onboarding/${id}/send-welcome-pack`, {
        subject: subject.trim(),
        message: message.trim(),
      });
      toast.success("Welcome pack sent");
      setWelcomePackModal(false);
      updateApp({ inbox_thread_ids: [...(app.inbox_thread_ids || []), r.data.thread_id], welcome_pack_sent_at: new Date().toISOString() });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send welcome pack");
    } finally {
      setSendingWelcomePack(false);
    }
  };

  const handleAssign = async () => {
    setAssigning(true);
    try {
      const { data } = await api.put(`/api/onboarding/${id}/assign`);
      setApp(prev => ({ ...prev, assigned_to: data.assigned_to }));
      toast.success(data.assigned_to ? "Application claimed" : "Claim released");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update assignment");
    } finally {
      setAssigning(false);
    }
  };

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

  const updateApp = (fields) => setApp(prev => ({ ...prev, ...fields }));

  const handleDocUpdate = (docType, meta) => {
    // Optimistic local update so badges appear immediately
    setDocs(prev => (prev || []).map(d =>
      d.doc_type === docType ? { ...d, ...meta } : d
    ));
    // Re-fetch to get a fresh presigned URL for the overwritten R2 object
    fetchDocs();
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
              <StatusBadge status={deriveStatus(app, docs, signingSession)} size="md" />
              {app.reseller_name && (
                <span className="text-xs text-gray-400">
                  Submitted by <strong className="text-gray-600">{app.reseller_name}</strong> · {fmtDate(app.submitted_at)}
                </span>
              )}
              {(app.inbox_thread_ids || []).slice(0, 3).map((tid, i) => (
                <button
                  key={tid}
                  onClick={() => navigate(`/onboarding-inbox?thread=${tid}`)}
                  className="inline-flex items-center gap-1 text-[11px] text-blue-600 font-medium bg-blue-50 border border-blue-100 rounded px-1.5 py-0.5 hover:bg-blue-100 transition-colors"
                >
                  <Mail size={9} />
                  {(app.inbox_thread_ids || []).length === 1 ? "View inbox thread" : `Thread ${i + 1}`}
                </button>
              ))}
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

              <DocumentsCard
                appId={id}
                docs={docs}
                loading={docsLoading}
                isHolder={isHolder}
                onDocUpdate={handleDocUpdate}
                signingSession={signingSession}
                onGenerateSigningDocs={generateSigningDocs}
                generatingSignDocs={generatingSignDocs}
                onSendSigningLink={sendSigningLink}
                sendingSignLink={sendingSignLink}
                onPreviewDoc={previewGeneratedDoc}
                canSendDocs={can("customers.approve_onboarding") && ["pending", "awaiting_docs"].includes(app?.status)}
              />

            </div>

            {/* Sidebar — right 1/3 */}
            <div className="space-y-5">

              <Card title="Application Details">
                <MetaRow label="Reference"     value={app.id} />
                <MetaRow label="Status"        value={<StatusBadge status={app.status} size="md" />} />
                <MetaRow label="Business Type" value={app.business_type} />
                <MetaRow label="Submitted by"  value={app.reseller_name} />
                <MetaRow label="Submitted on"  value={fmtDate(app.submitted_at)} />
              </Card>

              {/* Countersign assignment — only relevant once customer has signed back */}
              {isHolder && (docs || []).some(d => d.signed_in_portal && _BASSANI_SIG_TYPES.has(d.doc_type)) && (
                <Card title="Countersign Assignment">
                  <div className="space-y-3">
                    {app.assigned_to ? (
                      <div className="flex items-center gap-2 text-xs">
                        <UserCheck size={13} className="text-bassani-600 shrink-0" />
                        <span className="text-gray-700">
                          Claimed by <strong>{app.assigned_to.name}</strong>
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">Not claimed — any signing authority can countersign.</p>
                    )}
                    <button
                      onClick={() => {
                        const myId = user?.id;
                        const assignedToMe = app.assigned_to?.user_id === myId;
                        if (!assignedToMe && app.assigned_to) {
                          setTakeoverConfirm(true);
                          return;
                        }
                        handleAssign();
                      }}
                      disabled={assigning}
                      className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        app.assigned_to?.user_id === user?.id
                          ? "bg-gray-100 hover:bg-gray-200 text-gray-700 border border-gray-200"
                          : "bg-bassani-50 hover:bg-bassani-100 text-bassani-700 border border-bassani-200"
                      }`}
                    >
                      {assigning ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : app.assigned_to?.user_id === user?.id ? (
                        <><UserMinus size={12} /> Release Claim</>
                      ) : (
                        <><UserCheck size={12} /> Claim Application</>
                      )}
                    </button>
                  </div>
                </Card>
              )}

              <ActionsCard
                app={app}
                docs={docs}
                canApprove={can("customers.approve_onboarding")}
                canReject={can("customers.reject_onboarding")}
                onApprove={approve}
                onReject={reject}
                onUpdate={updateApp}
                navigate={navigate}
                signingSession={signingSession}
                onGenerateSigningDocs={generateSigningDocs}
                generatingSignDocs={generatingSignDocs}
                onSendSigningLink={sendSigningLink}
                sendingSignLink={sendingSignLink}
                canSendDocs={can("customers.approve_onboarding") && ["pending", "awaiting_docs"].includes(app?.status)}
                onSendWelcomePack={() => setWelcomePackModal(true)}
              />

              <TimelineCard
                app={app}
                docs={docs}
                signingSession={signingSession}
              />

            </div>
          </div>
        </div>
      </div>
      {takeoverConfirm && app?.assigned_to && (
        <Modal title="Take Over Claim" onClose={() => setTakeoverConfirm(false)}>
          <p className="text-sm text-gray-600">This application is currently claimed by <strong>{app.assigned_to.name}</strong>. Take over the claim?</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setTakeoverConfirm(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={() => { setTakeoverConfirm(false); handleAssign(); }}>Take Over</BtnPrimary>
          </div>
        </Modal>
      )}

      {welcomePackModal && (
        <WelcomePackModal
          app={app}
          docs={docs}
          user={user}
          onSend={sendWelcomePack}
          sending={sendingWelcomePack}
          onClose={() => setWelcomePackModal(false)}
        />
      )}
    </div>
  );
}
