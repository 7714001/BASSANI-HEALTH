import { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload, Download, Clock, CheckCircle, ChevronDown, ChevronUp,
  Loader2, FileText, RotateCcw, PenLine, FlaskConical, AlertTriangle,
  Eye, X,
} from "lucide-react";
import { useAuth } from "../AuthContext";
import { TopBar, BtnPrimary, BtnSecondary, Modal, FormGroup } from "../components/UI";
import { SigningAuthoritySection } from "./SigningAuthority";
import api from "../api";
import toast from "react-hot-toast";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-ZA", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtSize(bytes) {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function VersionBadge({ version, isActive }) {
  if (!version) return null;
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${
      isActive ? "bg-green-50 text-green-700" : "bg-gray-100 text-gray-500"
    }`}>
      {isActive && <CheckCircle size={10} />}
      v{version}
    </span>
  );
}

function VersionHistory({ docType, isSuperAdmin, onActivated }) {
  const [versions,   setVersions  ] = useState([]);
  const [loading,    setLoading   ] = useState(true);
  const [activating, setActivating] = useState(null);

  useEffect(() => {
    api.get(`/api/doc-templates/${docType}/history`)
      .then(r => setVersions(r.data.versions || []))
      .catch(() => toast.error("Failed to load version history"))
      .finally(() => setLoading(false));
  }, [docType]);

  const handleActivate = async (v) => {
    setActivating(v.id);
    try {
      await api.post(`/api/doc-templates/${docType}/activate/${v.id}`);
      toast.success(`v${v.version} is now active`);
      onActivated();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to activate version");
    } finally {
      setActivating(null);
    }
  };

  const handleDownload = async (v) => {
    try {
      const res = await api.get(`/api/doc-templates/${docType}/download/${v.id}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = `${docType}-v${v.version}.pdf`; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  };

  if (loading) return <p className="text-xs text-gray-400 py-2">Loading…</p>;
  if (!versions.length) return <p className="text-xs text-gray-400 py-2">No versions uploaded yet.</p>;

  return (
    <div className="mt-3 border border-gray-100 rounded-xl overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-4 py-2 text-gray-500 font-medium">Version</th>
            <th className="px-4 py-2 text-gray-500 font-medium">Uploaded</th>
            <th className="px-4 py-2 text-gray-500 font-medium">By</th>
            <th className="px-4 py-2 text-gray-500 font-medium">Size</th>
            <th className="px-4 py-2 text-gray-500 font-medium">Notes</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {versions.map(v => (
            <tr key={v.id} className={v.is_active ? "bg-green-50/40" : ""}>
              <td className="px-4 py-2.5"><VersionBadge version={v.version} isActive={v.is_active} /></td>
              <td className="px-4 py-2.5 text-gray-600">{fmtDate(v.uploaded_at)}</td>
              <td className="px-4 py-2.5 text-gray-600 truncate max-w-[120px]">{v.uploaded_by_name || "—"}</td>
              <td className="px-4 py-2.5 text-gray-400">{fmtSize(v.file_size)}</td>
              <td className="px-4 py-2.5 text-gray-400 truncate max-w-[180px]">{v.notes || "—"}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2 justify-end">
                  <button onClick={() => handleDownload(v)} className="text-gray-400 hover:text-bassani-600 transition-colors" title="Download">
                    <Download size={13} />
                  </button>
                  {isSuperAdmin && !v.is_active && (
                    <button
                      onClick={() => handleActivate(v)}
                      disabled={!!activating}
                      className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50"
                    >
                      {activating === v.id ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />}
                      Activate
                    </button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Test Signing Modal ────────────────────────────────────────────────────────

const DOC_CONFIGS = {
  nda: {
    hasBassaniSig: true,
    sections: [
      { title: "Company details", fields: [
        { name: "company_name_1",        label: "Company Name",                   testDefault: "Test Company (Pty) Ltd" },
        { name: "company_address",       label: "Company Address",                testDefault: "123 Main Road, Johannesburg, Gauteng, 2000" },
        { name: "company_reg_number",    label: "Registration Number",            testDefault: "2024/123456/07" },
      ]},
      { title: "Contact details", fields: [
        { name: "customer_company_name", label: "Company Name (signature block)", testDefault: "Test Company (Pty) Ltd" },
        { name: "customer_name",         label: "Full Name",                      testDefault: "Test Customer" },
        { name: "customer_position",     label: "Position / Title",               testDefault: "Director" },
        { name: "customer_location",     label: "City / Location of Signing",     testDefault: "Johannesburg" },
      ]},
    ],
    isAutoFill: (name) => name.startsWith("bassani_") || name.startsWith("effective_date"),
    getAutoFillValue: (name, profile) => {
      if (name.toLowerCase().includes("position")) return profile?.title || "";
      return new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });
    },
  },
  customer_information_form: {
    hasBassaniSig: false,
    sections: [
      { title: "Business details", fields: [
        { name: "business_name",      label: "Trading / Business Name",  testDefault: "Test Trading Name" },
        { name: "company_name",       label: "Registered Company Name",  testDefault: "Test Company (Pty) Ltd" },
        { name: "company_reg_number", label: "Registration Number",      testDefault: "2024/123456/07" },
        { name: "vat_number",         label: "VAT Number",               testDefault: "4560123456" },
      ]},
      { title: "Contact details", fields: [
        { name: "full_name",     label: "Full Name",         testDefault: "Test Customer" },
        { name: "position",      label: "Position / Title",  testDefault: "Director" },
        { name: "phone_number",  label: "Phone Number",      testDefault: "+27 11 000 0000" },
        { name: "email_address", label: "Email Address",     testDefault: "test@example.com" },
        { name: "alt_phone",     label: "Alternative Phone", testDefault: "" },
      ]},
      { title: "Business address", fields: [
        { name: "street_address", label: "Street Address", testDefault: "123 Main Road" },
        { name: "suburb",         label: "Suburb",         testDefault: "Sandton" },
        { name: "city",           label: "City",           testDefault: "Johannesburg" },
        { name: "province",       label: "Province",       testDefault: "Gauteng" },
        { name: "postal_code",    label: "Postal Code",    testDefault: "2196" },
      ]},
    ],
    isAutoFill: (name) => name === "date_day" || name === "date_month" || name === "date_year",
    getAutoFillValue: (name) => {
      const now = new Date();
      if (name === "date_day")   return String(now.getDate()).padStart(2, "0");
      if (name === "date_month") return now.toLocaleString("en-ZA", { month: "long" });
      if (name === "date_year")  return String(now.getFullYear());
      return "";
    },
  },
};

async function detectFields(pdfBytes) {
  const { PDFDocument } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form   = pdfDoc.getForm();
  const pages  = pdfDoc.getPages();

  // Map page object number → page index using each page's own ref.
  // (The annotPageMap approach doesn't work: PDFArray.get() dereferences to a
  // PDFDict, not a PDFRef, so objectNumber is always undefined.)
  const pageRefToIdx = new Map();
  pages.forEach((page, idx) => pageRefToIdx.set(page.ref.objectNumber, idx));

  return form.getFields().map(field => {
    const name = field.getName();
    // constructor.name is minified in production — use name-based detection only.
    const type = name.toLowerCase().includes("signature") ? "Signature" : "Text";
    const widgets = field.acroField.getWidgets();
    const widget  = widgets[0];
    const pageRef = widget?.P?.();
    const pageIdx = pageRef?.objectNumber != null
      ? (pageRefToIdx.get(pageRef.objectNumber) ?? 0)
      : 0;
    const rect    = widget?.getRectangle?.() || null;
    return { name, type, page: pageIdx + 1, rect };
  });
}

async function generateTestPdf(pdfBytes, textValues, signingProfile, mikeFieldName, customerSigDataUrl, config) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdfDoc   = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form     = pdfDoc.getForm();
  const pages    = pdfDoc.getPages();
  const fontReg  = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const pageRefToIdx = new Map();
  pages.forEach((page, idx) => pageRefToIdx.set(page.ref.objectNumber, idx));

  // Pre-load Mike's signature PNG from the signing authority profile
  let mikeImage = null;
  if (signingProfile && mikeFieldName) {
    try {
      const res = await api.get("/api/signing-authority/signature", { responseType: "arraybuffer" });
      mikeImage = await pdfDoc.embedPng(res.data);
    } catch {}
  }

  // Embed the drawn customer signature
  let customerImage = null;
  if (customerSigDataUrl) {
    try {
      const b64   = customerSigDataUrl.replace(/^data:image\/png;base64,/, "");
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      customerImage = await pdfDoc.embedPng(bytes);
    } catch {}
  }

  for (const field of form.getFields()) {
    const name       = field.getName();
    // Name-based detection only — constructor.name is minified in production builds.
    const isSigField = name.toLowerCase().includes("signature");

    if (!isSigField) {
      let val = "";
      if (config?.isAutoFill?.(name)) {
        val = config.getAutoFillValue(name, signingProfile) || "";
      } else {
        val = textValues[name] ?? "";
      }
      try { field.setText(val); field.enableReadOnly(); } catch {}
      continue;
    }

    const isMike = name === mikeFieldName;
    const image  = isMike ? mikeImage : customerImage;

    for (const widget of field.acroField.getWidgets()) {
      const rect    = widget.getRectangle?.();
      if (!rect) continue;
      const pageRef = widget.P?.();
      const pageIdx = pageRef?.objectNumber != null ? (pageRefToIdx.get(pageRef.objectNumber) ?? 0) : 0;
      const page    = pages[pageIdx];
      if (!page) continue;

      if (image) {
        const pad    = 4;
        const fieldW = rect.width  - pad * 2;
        const fieldH = rect.height - pad * 2;
        const scale  = Math.min(fieldW / image.width, fieldH / image.height);
        const drawW  = image.width  * scale;
        const drawH  = image.height * scale;
        page.drawImage(image, {
          x: rect.x + pad + (fieldW - drawW) / 2,
          y: rect.y + pad + (fieldH - drawH) / 2,
          width: drawW, height: drawH,
        });
      } else {
        // Fallback labelled placeholder when no image is available
        const boxColor = isMike ? rgb(0.88, 0.94, 1) : rgb(0.95, 0.95, 0.95);
        const penColor = isMike ? rgb(0.2, 0.4, 0.8) : rgb(0.5, 0.5, 0.5);
        const label    = isMike ? "[ CEO Signature — not configured ]" : "[ No signature drawn ]";
        page.drawRectangle({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          color: boxColor, borderColor: penColor, borderWidth: 1.5, opacity: 0.8 });
        const fontSize = Math.min(10, rect.height * 0.35);
        page.drawText(label, { x: rect.x + 4, y: rect.y + (rect.height - fontSize) / 2,
          size: fontSize, font: fontBold, color: penColor, maxWidth: rect.width - 8 });
      }
    }
  }

  try { form.flatten(); } catch {}

  pages[0].drawText("TEST DOCUMENT - NOT FOR USE", {
    x: 40, y: pages[0].getHeight() - 30,
    size: 9, font: fontReg, color: rgb(0.8, 0.2, 0.2), opacity: 0.7,
  });

  return pdfDoc.save();
}

// ── PDF Viewer Modal ────────────────────────────────────────────────────────────
function PdfViewerModal({ docType, docLabel, onClose }) {
  const [objectUrl, setObjectUrl] = useState(null);
  const [loading,   setLoading  ] = useState(true);
  const [error,     setError    ] = useState(null);

  useEffect(() => {
    let url;
    api.get(`/api/doc-templates/${docType}/download`, { responseType: "blob" })
      .then(r => {
        url = URL.createObjectURL(new Blob([r.data], { type: "application/pdf" }));
        setObjectUrl(url);
      })
      .catch(() => setError("Could not load the PDF. Try downloading it instead."))
      .finally(() => setLoading(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [docType]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/80 backdrop-blur-sm">
      {/* Header bar */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2">
          <FileText size={16} className="text-bassani-600" />
          <span className="text-sm font-semibold text-gray-800">{docLabel}</span>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <X size={18} />
        </button>
      </div>

      {/* Viewer area */}
      <div className="flex-1 min-h-0 p-4">
        {loading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={28} className="animate-spin text-bassani-500" />
          </div>
        )}
        {error && (
          <div className="flex items-center justify-center h-full">
            <div className="bg-white rounded-xl p-6 text-center shadow">
              <AlertTriangle size={24} className="text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-gray-700">{error}</p>
            </div>
          </div>
        )}
        {objectUrl && (
          <iframe
            src={objectUrl}
            title={docLabel}
            className="w-full h-full rounded-xl border border-gray-200 bg-white"
          />
        )}
      </div>
    </div>
  );
}

function TestSigningModal({ docType, docLabel, onClose }) {
  const [loading,    setLoading   ] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error,      setError     ] = useState(null);
  const [pdfUrl,     setPdfUrl    ] = useState(null);
  const [pdfBytes,   setPdfBytes  ] = useState(null);
  const [fields,     setFields    ] = useState([]);
  const [textValues, setTextValues] = useState({});
  const [sigProfile, setSigProfile] = useState(null);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos   = useRef({ x: 0, y: 0 });
  const hasMark   = useRef(false);

  useEffect(() => {
    let url;
    Promise.all([
      api.get(`/api/doc-templates/${docType}/download`, { responseType: "arraybuffer" }),
      api.get("/api/signing-authority/").catch(() => null),
    ]).then(async ([pdfRes, authRes]) => {
      const bytes = new Uint8Array(pdfRes.data);
      setPdfBytes(bytes);
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setPdfUrl(url);
      setSigProfile(authRes?.data || null);
      const detected = await detectFields(bytes);
      setFields(detected);
      const cfg = DOC_CONFIGS[docType];
      const detectedSet = new Set(detected.map(f => f.name));
      const init = {};
      (cfg?.sections || []).forEach(section =>
        section.fields.forEach(f => { if (detectedSet.has(f.name)) init[f.name] = f.testDefault ?? ""; })
      );
      setTextValues(init);
    }).catch((e) => { console.error("TestSigningModal load error:", e); setError("Failed to load document"); })
      .finally(() => setLoading(false));
    return () => { if (url) URL.revokeObjectURL(url); };
  }, [docType]);

  // ── Canvas drawing ──────────────────────────────────────────────────────────
  const getCanvasPos = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
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

  const handleGenerate = async () => {
    setGenerating(true);
    try {
      let customerSigDataUrl = null;
      const canvas = canvasRef.current;
      if (canvas && hasMark.current) customerSigDataUrl = canvas.toDataURL("image/png");
      const result = await generateTestPdf(pdfBytes, textValues, sigProfile, mikeFieldName, customerSigDataUrl, config);
      const blob = new Blob([result], { type: "application/pdf" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `${docType}-test-signed-${new Date().toISOString().slice(0, 10)}.pdf`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Test PDF downloaded");
    } catch (err) { console.error("generateTestPdf error:", err); toast.error("Failed to generate test PDF"); }
    finally { setGenerating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/80 backdrop-blur-sm">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-2.5">
          <FlaskConical size={16} className="text-bassani-600" />
          <span className="text-sm font-semibold text-gray-800">{docLabel}</span>
          <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">signing flow preview</span>
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

          {/* Left: live PDF preview */}
          <div className="flex-1 p-4 min-w-0">
            {pdfUrl && (
              <iframe src={pdfUrl} title={docLabel}
                className="w-full h-full rounded-xl border border-gray-200 bg-white" />
            )}
          </div>

          {/* Right: signing panel */}
          <div className="w-80 shrink-0 border-l border-gray-200 bg-white flex flex-col">
            <div className="flex-1 overflow-y-auto p-5 space-y-5">

              {/* Bassani auto-fill card — only for co-signed documents */}
              {config?.hasBassaniSig && (
                <div>
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-2">Bassani Health (auto-filled)</p>
                  {sigProfile ? (
                    <div className="bg-green-50 border border-green-100 rounded-xl p-3 space-y-0.5">
                      <p className="text-xs font-semibold text-green-800">{sigProfile.name}</p>
                      <p className="text-xs text-green-600">{sigProfile.title}{sigProfile.location ? ` · ${sigProfile.location}` : ""}</p>
                      <p className="text-[10px] text-green-500 mt-1">Signature, position and today's date embedded automatically</p>
                    </div>
                  ) : (
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
                      <p className="text-xs text-amber-700">Signing authority not configured. Set up the Signing Authority tab for a realistic test.</p>
                    </div>
                  )}
                </div>
              )}

              {/* Form sections driven by DOC_CONFIGS */}
              {(config?.sections || []).map(section => {
                const visible = section.fields.filter(f => detectedNames.has(f.name));
                if (!visible.length) return null;
                return (
                  <div key={section.title}>
                    <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide mb-3">{section.title}</p>
                    <div className="space-y-3">
                      {visible.map(f => (
                        <div key={f.name}>
                          <label className="block text-xs text-gray-600 mb-1">{f.label}</label>
                          <input type="text" value={textValues[f.name] ?? ""}
                            onChange={e => setTextValues(v => ({ ...v, [f.name]: e.target.value }))}
                            className="w-full text-sm border border-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-bassani-500" />
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}

              {/* Customer signature canvas */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Your signature</p>
                  <button onClick={clearCanvas} className="text-[10px] text-gray-400 hover:text-gray-600 underline underline-offset-1">Clear</button>
                </div>
                <div className="border-2 border-dashed border-gray-200 rounded-xl overflow-hidden bg-gray-50">
                  <canvas ref={canvasRef} width={300} height={120}
                    className="w-full touch-none cursor-crosshair" style={{ display: "block" }}
                    onMouseDown={startDraw} onMouseMove={draw} onMouseUp={endDraw} onMouseLeave={endDraw}
                    onTouchStart={startDraw} onTouchMove={draw} onTouchEnd={endDraw} />
                </div>
                <p className="text-[10px] text-gray-400 mt-1.5">Draw your signature above — embedded in the PDF at download</p>
              </div>

            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-100 shrink-0">
              <BtnPrimary onClick={handleGenerate} disabled={generating} className="w-full justify-center">
                {generating
                  ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
                  : <><Download size={13} /> Download signed test PDF</>
                }
              </BtnPrimary>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}

function DocTypeCard({ template, isSuperAdmin, onUploaded }) {
  const [expanded,   setExpanded  ] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [uploading,  setUploading ] = useState(false);
  const [modalOpen,  setModalOpen ] = useState(false);
  const [testOpen,   setTestOpen  ] = useState(false);
  const [viewOpen,   setViewOpen  ] = useState(false);
  const [notes,      setNotes     ] = useState("");
  const [chosenFile, setChosenFile] = useState(null);
  const fileRef = useRef(null);

  const active = template.active;

  const handleDownloadActive = async () => {
    try {
      const res = await api.get(`/api/doc-templates/${template.doc_type}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = template.filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  };

  const handleUpload = async () => {
    if (!chosenFile) return toast.error("Select a PDF file first");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file",  chosenFile);
      fd.append("notes", notes.trim());
      await api.post(`/api/doc-templates/${template.doc_type}/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`${template.label} updated to v${(active?.version || 0) + 1}`);
      setModalOpen(false);
      setHistoryKey(k => k + 1);
      onUploaded();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-bassani-50 flex items-center justify-center shrink-0">
              <FileText size={18} className="text-bassani-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{template.label}</h3>
              <p className="text-xs text-gray-400 mt-0.5">{template.filename}</p>
            </div>
          </div>
          <div className="shrink-0">
            {active
              ? <VersionBadge version={active.version} isActive />
              : <span className="text-xs text-amber-600 font-medium">No version uploaded</span>
            }
          </div>
        </div>

        {active ? (
          <div className="grid grid-cols-3 gap-3 mb-4">
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-400 mb-0.5">Uploaded</p>
              <p className="text-xs font-medium text-gray-700">{fmtDate(active.uploaded_at)}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-400 mb-0.5">By</p>
              <p className="text-xs font-medium text-gray-700 truncate">{active.uploaded_by_name || "—"}</p>
            </div>
            <div className="bg-gray-50 rounded-xl px-3 py-2">
              <p className="text-[10px] text-gray-400 mb-0.5">Size</p>
              <p className="text-xs font-medium text-gray-700">{fmtSize(active.file_size)}</p>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-amber-700">
              No managed version uploaded yet. Customers currently download the static file baked into the deployment.
              Upload a version here to take over.
            </p>
          </div>
        )}
        {active?.notes && (
          <p className="text-xs text-gray-500 italic mb-4">Release note: {active.notes}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {active && (
            <BtnSecondary size="sm" onClick={() => setViewOpen(true)}>
              <Eye size={13} /> View
            </BtnSecondary>
          )}
          {active && (
            <BtnSecondary size="sm" onClick={handleDownloadActive}>
              <Download size={13} /> Download current
            </BtnSecondary>
          )}
          {isSuperAdmin && (
            <BtnPrimary size="sm" onClick={() => { setChosenFile(null); setNotes(""); setModalOpen(true); }}>
              <Upload size={13} /> Upload new version
            </BtnPrimary>
          )}
          {isSuperAdmin && active && (
            <button
              onClick={() => setTestOpen(true)}
              className="flex items-center gap-1.5 text-xs text-bassani-600 hover:text-bassani-700 font-medium border border-bassani-200 hover:border-bassani-300 bg-bassani-50 hover:bg-bassani-100 rounded-lg px-3 py-1.5 transition-colors"
            >
              <FlaskConical size={13} /> Test signing flow
            </button>
          )}
          <button
            onClick={() => setExpanded(e => !e)}
            className="ml-auto flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors"
          >
            <Clock size={12} />
            {template.version_count} version{template.version_count !== 1 ? "s" : ""}
            {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
        </div>

        {expanded && (
          <VersionHistory
            key={historyKey}
            docType={template.doc_type}
            isSuperAdmin={isSuperAdmin}
            onActivated={() => { setHistoryKey(k => k + 1); onUploaded(); }}
          />
        )}
      </div>

      {viewOpen && (
        <PdfViewerModal
          docType={template.doc_type}
          docLabel={template.label}
          onClose={() => setViewOpen(false)}
        />
      )}

      {testOpen && (
        <TestSigningModal
          docType={template.doc_type}
          docLabel={template.label}
          onClose={() => setTestOpen(false)}
        />
      )}

      {modalOpen && (
        <Modal title={`Upload new version — ${template.label}`} onClose={() => setModalOpen(false)}>
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              The uploaded PDF will immediately become the active version served to customers and resellers.
              The previous version is archived and can be restored at any time.
            </p>
            <FormGroup label="PDF file" required>
              <div
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  chosenFile ? "border-bassani-400 bg-bassani-50" : "border-gray-200 hover:border-bassani-300 hover:bg-gray-50"
                }`}
              >
                {chosenFile ? (
                  <div className="flex items-center justify-center gap-2">
                    <FileText size={16} className="text-bassani-600" />
                    <span className="text-sm font-medium text-bassani-700">{chosenFile.name}</span>
                    <span className="text-xs text-gray-400">({fmtSize(chosenFile.size)})</span>
                  </div>
                ) : (
                  <>
                    <Upload size={20} className="text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Click to select a PDF</p>
                  </>
                )}
                <input ref={fileRef} type="file" accept=".pdf" className="hidden"
                  onChange={e => setChosenFile(e.target.files?.[0] || null)} />
              </div>
            </FormGroup>
            <FormGroup label="Release notes (optional)">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Updated indemnity clause — approved by legal 2026-07-07"
                rows={3} className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-bassani-500" />
            </FormGroup>
            <div className="flex justify-end gap-2 pt-2">
              <BtnSecondary onClick={() => setModalOpen(false)}>Cancel</BtnSecondary>
              <BtnPrimary onClick={handleUpload} disabled={!chosenFile || uploading}>
                {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                Upload &amp; activate
              </BtnPrimary>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Tabs ───────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "documents",  label: "Documents",        icon: FileText },
  { id: "signing",    label: "Signing Authority", icon: PenLine  },
];

function TabBar({ active, onChange }) {
  return (
    <div className="flex border-b border-gray-200 mb-6">
      {TABS.map(t => {
        const Icon    = t.icon;
        const isActive = active === t.id;
        return (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors -mb-px ${
              isActive
                ? "border-bassani-600 text-bassani-700"
                : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
            }`}
          >
            <Icon size={15} />
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Main view ─────────────────────────────────────────────────────────────────
export default function DocumentTemplates() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin || user?.role === "super_admin";

  const [tab,       setTab      ] = useState("documents");
  const [templates, setTemplates] = useState([]);
  const [loading,   setLoading  ] = useState(true);
  const [listKey,   setListKey  ] = useState(0);

  const load = () => {
    setLoading(true);
    api.get("/api/doc-templates/")
      .then(r => setTemplates(r.data.templates || []))
      .catch(() => toast.error("Failed to load document templates"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [listKey]); // eslint-disable-line

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <TopBar title="Document Templates" />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto w-full">

          <TabBar active={tab} onChange={setTab} />

          {/* ── Documents tab ─────────────────────────────────────────── */}
          {tab === "documents" && (
            <>
              <div className="mb-6">
                <p className="text-sm text-gray-500 max-w-2xl">
                  Manage the four Bassani-issued onboarding template PDFs. Uploading a new version
                  immediately replaces what customers download — no redeployment needed. Previous
                  versions are archived and can be restored at any time.
                </p>
                {isSuperAdmin && (
                  <div className="mt-3 flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 max-w-2xl">
                    <span className="text-blue-500 text-xs mt-0.5">ℹ</span>
                    <p className="text-xs text-blue-700">
                      Before enabling e-signatures, prepare each PDF with embedded form fields
                      (signature, name, date, company) in Adobe Acrobat or LibreOffice. Field
                      positions are stored in the PDF itself and update automatically when you
                      upload a new version.
                    </p>
                  </div>
                )}
              </div>

              {loading ? (
                <div className="flex items-center justify-center py-16">
                  <Loader2 size={24} className="animate-spin text-bassani-600" />
                </div>
              ) : (
                <div className="space-y-4">
                  {templates.map(t => (
                    <DocTypeCard
                      key={t.doc_type}
                      template={t}
                      isSuperAdmin={isSuperAdmin}
                      onUploaded={() => setListKey(k => k + 1)}
                    />
                  ))}
                </div>
              )}

              <div className="mt-8 bg-gray-100 rounded-2xl px-6 py-5 max-w-2xl">
                <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Version control</h3>
                <ul className="space-y-1.5 text-xs text-gray-500">
                  <li>Each upload creates a numbered version — v1, v2, v3…</li>
                  <li>The active version is what customers and resellers download immediately.</li>
                  <li>Archived versions are never deleted — signed copies always reference the exact version at time of signing.</li>
                  <li>Roll back to any previous version using the Activate button in the version history.</li>
                </ul>
              </div>
            </>
          )}

          {/* ── Signing Authority tab ─────────────────────────────────── */}
          {tab === "signing" && (
            <>
              <div className="mb-6">
                <p className="text-sm text-gray-500 max-w-2xl">
                  Configure the signatory profile used to automatically complete Bassani's signing
                  block on all co-signed onboarding documents. Once set up, no action is required
                  per document — the name, title, location, and signature are embedded automatically
                  when a customer signs.
                </p>
              </div>
              <SigningAuthoritySection />
            </>
          )}

        </div>
      </main>
    </div>
  );
}
