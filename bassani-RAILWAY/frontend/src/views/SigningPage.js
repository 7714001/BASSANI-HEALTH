import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle, PenLine, Loader2, AlertTriangle, X, FileText, Upload,
} from "lucide-react";
import { DOC_CONFIGS, detectFields, generateSignedPdf, buildPrefill } from "../utils/pdfSigning";
import api from "../api";
import toast from "react-hot-toast";

const DOC_META = {
  nda: {
    label:    "Non-Disclosure Agreement",
    filename: "nda.pdf",
  },
  store_onboarding_agreement: {
    label:    "Store Onboarding Agreement",
    filename: "store-onboarding-agreement.pdf",
  },
};

// ── In-page signing modal ──────────────────────────────────────────────────────

function SigningModal({ token, docType, formData, onSigned, onClose }) {
  const meta = DOC_META[docType];
  const [loading,    setLoading   ] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error,      setError     ] = useState(null);
  const [pdfUrl,     setPdfUrl    ] = useState(null);
  const [pdfBytes,   setPdfBytes  ] = useState(null);
  const [fields,     setFields    ] = useState([]);
  const [textValues, setTextValues] = useState({});
  const [sigMeta,    setSigMeta   ] = useState(null);
  const [sigMode,    setSigMode   ] = useState("draw"); // "draw" | "upload"
  const [uploadedSig, setUploadedSig] = useState(null); // PNG data URL
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos   = useRef({ x: 0, y: 0 });
  const hasMark   = useRef(false);

  useEffect(() => {
    let url;
    Promise.all([
      api.get(`/api/public/templates/download/${meta.filename}`, { responseType: "arraybuffer" }),
      api.get("/api/public/signing-authority-meta").catch(() => null),
    ]).then(async ([pdfRes, metaRes]) => {
      const bytes = new Uint8Array(pdfRes.data);
      setPdfBytes(bytes);
      setSigMeta(metaRes?.data || null);

      const detected = await detectFields(bytes);
      setFields(detected);

      const cfg     = DOC_CONFIGS[docType];
      const prefill = buildPrefill(docType, formData);
      const names   = new Set(detected.map(f => f.name));
      const init    = {};
      (cfg?.sections || []).forEach(section =>
        section.fields.forEach(f => {
          if (names.has(f.name) && !cfg.isAutoFill(f.name)) {
            init[f.name] = prefill[f.name] ?? "";
          }
        })
      );
      setTextValues(init);

      const preview = await generateSignedPdf(bytes, {
        textValues: prefill, config: cfg, addWatermark: false,
      });
      url = URL.createObjectURL(new Blob([preview], { type: "application/pdf" }));
      setPdfUrl(url);
    }).catch(() => setError("Failed to load document. Please try again."))
      .finally(() => setLoading(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [docType, meta.filename, formData]); // eslint-disable-line

  const getPos = (e) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r   = c.getBoundingClientRect();
    const src = e.touches ? e.touches[0] : e;
    return { x: (src.clientX - r.left) * (c.width / r.width), y: (src.clientY - r.top) * (c.height / r.height) };
  };
  const startDraw = (e) => { e.preventDefault(); isDrawing.current = true; lastPos.current = getPos(e); };
  const draw = (e) => {
    e.preventDefault();
    if (!isDrawing.current) return;
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext("2d");
    const pos = getPos(e);
    ctx.strokeStyle = "#111827"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y); ctx.stroke();
    lastPos.current = pos; hasMark.current = true;
  };
  const endDraw = () => { isDrawing.current = false; };
  const clearCanvas = () => {
    const c = canvasRef.current; if (!c) return;
    c.getContext("2d").clearRect(0, 0, c.width, c.height);
    hasMark.current = false;
  };

  const handleFileUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Convert to PNG via canvas so pdf-lib can embed it regardless of source format
      const img = new Image();
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        c.getContext("2d").drawImage(img, 0, 0);
        setUploadedSig(c.toDataURL("image/png"));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };

  const handleSign = async () => {
    if (sigMode === "draw"   && !hasMark.current) return toast.error("Please draw your signature before signing");
    if (sigMode === "upload" && !uploadedSig)     return toast.error("Please upload a signature image before signing");
    if (!pdfBytes) return;
    setGenerating(true);
    try {
      const cfg       = DOC_CONFIGS[docType];
      const sigFields = fields.filter(f => f.type === "Signature");
      const mikeField = cfg?.hasBassaniSig
        ? sigFields.find(f => f.name.startsWith("bassani_"))?.name ?? null
        : null;

      const customerSigDataUrl = sigMode === "draw"
        ? canvasRef.current.toDataURL("image/png")
        : uploadedSig;

      const result = await generateSignedPdf(pdfBytes, {
        textValues,
        signingProfile: sigMeta,
        mikeFieldName:  mikeField,
        customerSigDataUrl,
        config: cfg,
        addWatermark: false,
      });

      const blob = new Blob([result], { type: "application/pdf" });
      const fd   = new FormData();
      fd.append("file", blob, `${docType}-signed.pdf`);
      await api.post(`/api/public/signing/${token}/sign/${docType}`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      toast.success(`${meta.label} signed`);
      onSigned(docType);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Signing failed. Please try again.");
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/80 backdrop-blur-sm">
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2.5">
          <PenLine size={16} className="text-bassani-600" />
          <span className="text-sm font-semibold text-gray-800">{meta.label}</span>
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
            <AlertTriangle size={24} className="text-amber-400 mx-auto mb-2" />
            <p className="text-sm text-gray-700">{error}</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex">
          <div className="flex-1 p-4 min-w-0">
            {pdfUrl && (
              <iframe src={pdfUrl} title={meta.label}
                className="w-full h-full rounded-xl border border-gray-200 bg-white" />
            )}
          </div>

          <div className="w-72 shrink-0 border-l border-gray-200 bg-white flex flex-col">
            <div className="flex-1 overflow-y-auto p-5">
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">Your signature</p>

              {/* Draw / Upload toggle */}
              <div className="flex rounded-lg border border-gray-200 overflow-hidden mb-4">
                <button
                  onClick={() => setSigMode("draw")}
                  className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${sigMode === "draw" ? "bg-bassani-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                >
                  Draw
                </button>
                <button
                  onClick={() => setSigMode("upload")}
                  className={`flex-1 py-1.5 text-xs font-semibold transition-colors ${sigMode === "upload" ? "bg-bassani-600 text-white" : "bg-white text-gray-500 hover:bg-gray-50"}`}
                >
                  Upload image
                </button>
              </div>

              {sigMode === "draw" ? (
                <div>
                  <div className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                    <canvas
                      ref={canvasRef}
                      width={280}
                      height={140}
                      className="w-full touch-none cursor-crosshair"
                      onMouseDown={startDraw}
                      onMouseMove={draw}
                      onMouseUp={endDraw}
                      onMouseLeave={endDraw}
                      onTouchStart={startDraw}
                      onTouchMove={draw}
                      onTouchEnd={endDraw}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="text-[10px] text-gray-400">Draw your signature above</p>
                    <button onClick={clearCanvas} className="text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-1">Clear</button>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block cursor-pointer">
                    <div className={`border-2 border-dashed rounded-xl p-5 text-center transition-colors ${uploadedSig ? "border-bassani-200 bg-bassani-50" : "border-gray-200 bg-gray-50 hover:border-bassani-300 hover:bg-bassani-50/30"}`}>
                      {uploadedSig ? (
                        <img src={uploadedSig} alt="Signature preview" className="max-h-20 mx-auto object-contain" />
                      ) : (
                        <>
                          <Upload size={22} className="mx-auto mb-2 text-gray-300" />
                          <p className="text-xs font-medium text-gray-500">Click to upload signature</p>
                          <p className="text-[10px] text-gray-400 mt-1">PNG, JPG or GIF — any device</p>
                        </>
                      )}
                    </div>
                    <input type="file" accept="image/*" className="sr-only" onChange={handleFileUpload} />
                  </label>
                  {uploadedSig && (
                    <button onClick={() => setUploadedSig(null)} className="text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-1 mt-1.5">
                      Remove and choose again
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="p-5 border-t border-gray-100">
              <button
                onClick={handleSign}
                disabled={generating}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {generating ? <Loader2 size={15} className="animate-spin" /> : <PenLine size={15} />}
                Sign document
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

export default function SigningPage() {
  const { token } = useParams();
  const [loading,  setLoading ] = useState(true);
  const [error,    setError   ] = useState(null);
  const [session,  setSession ] = useState(null);
  const [signed,   setSigned  ] = useState({});
  const [signing,  setSigning ] = useState(null); // doc_type currently open in modal

  useEffect(() => {
    api.get(`/api/public/signing/${token}`)
      .then(r => {
        setSession(r.data);
        setSigned(r.data.signed || {});
      })
      .catch(e => setError(e.response?.data?.detail || "This signing link is not valid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSigned = (docType) => {
    setSigned(prev => ({ ...prev, [docType]: true }));
    setSigning(null);
  };

  const allSigned = session
    ? (session.docs_to_sign || []).every(d => signed[d])
    : false;

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-bassani-500" />
          <p className="text-sm text-gray-500">Loading your documents…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={26} className="text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Link unavailable</h2>
          <p className="text-sm text-gray-500">{error}</p>
          <p className="text-xs text-gray-400 mt-4">
            If you believe this is an error, please contact Bassani Health directly.
          </p>
        </div>
      </div>
    );
  }

  if (allSigned) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">All documents signed</h2>
          <p className="text-sm text-gray-500 mb-1">
            Thank you. Your signed documents have been received by Bassani Health.
          </p>
          <p className="text-sm text-gray-500">
            Our team will countersign them and finalise your account. You will receive a confirmation once your account is active.
          </p>
        </div>
      </div>
    );
  }

  const formData = session?.form_data || {};
  const docsToSign = session?.docs_to_sign || [];

  return (
    <>
      {signing && (
        <SigningModal
          token={token}
          docType={signing}
          formData={formData}
          onSigned={handleSigned}
          onClose={() => setSigning(null)}
        />
      )}

      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <div className="bg-white border-b border-gray-100 px-6 py-5">
          <div className="max-w-lg mx-auto">
            <p className="text-xs font-semibold text-bassani-600 uppercase tracking-wider mb-1">Bassani Health</p>
            <h1 className="text-xl font-bold text-gray-900">Sign your documents</h1>
            <p className="text-sm text-gray-500 mt-1">
              Your details have been pre-filled. Review each document and draw your signature to complete your onboarding.
            </p>
          </div>
        </div>

        <main className="max-w-lg mx-auto px-6 py-8 space-y-4">

          {/* Expiry notice */}
          {session?.expires_at && (
            <div className="flex items-center gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-2.5">
              <AlertTriangle size={13} className="text-amber-500 shrink-0" />
              <p className="text-xs text-amber-700">
                This link expires on {new Date(session.expires_at).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric" })}.
              </p>
            </div>
          )}

          {/* Document cards */}
          {docsToSign.map((docType, i) => {
            const meta      = DOC_META[docType];
            const isSigned  = !!signed[docType];
            return (
              <div
                key={docType}
                className={`bg-white border rounded-2xl p-5 shadow-sm flex items-center gap-4 ${
                  isSigned ? "border-green-200" : "border-gray-100"
                }`}
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                  isSigned ? "bg-green-50" : "bg-bassani-50"
                }`}>
                  {isSigned
                    ? <CheckCircle size={20} className="text-green-600" />
                    : <FileText size={18} className="text-bassani-600" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{meta?.label || docType}</p>
                  <p className={`text-xs mt-0.5 ${isSigned ? "text-green-600" : "text-gray-400"}`}>
                    {isSigned ? "Signed" : `Document ${i + 1} of ${docsToSign.length}`}
                  </p>
                </div>
                {!isSigned && (
                  <button
                    onClick={() => setSigning(docType)}
                    className="shrink-0 flex items-center gap-1.5 px-4 py-2 bg-bassani-600 hover:bg-bassani-700 text-white text-xs font-semibold rounded-lg transition-colors"
                  >
                    <PenLine size={13} />
                    Sign
                  </button>
                )}
              </div>
            );
          })}

          <p className="text-center text-[11px] text-gray-400 pt-2">
            Bassani Health &middot; Cnr Dytchley &amp; Marcius Roads, Kyalami
          </p>
        </main>
      </div>
    </>
  );
}
