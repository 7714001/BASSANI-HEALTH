import { useState, useEffect, useRef, useCallback } from "react";
import {
  Upload, Download, Clock, CheckCircle, ChevronDown, ChevronUp,
  Loader2, FileText, RotateCcw, PenLine, FlaskConical, AlertTriangle,
  Info, Eye, X,
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
const FIELD_TYPE_LABELS = { Text: "Text", Signature: "Signature", CheckBox: "Checkbox", Dropdown: "Dropdown" };

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
    const name    = field.getName();
    const rawType = field.constructor.name.replace("PDF", "").replace("Field", "");
    const type    = FIELD_TYPE_LABELS[rawType] || rawType;
    const widgets = field.acroField.getWidgets();
    const widget  = widgets[0];
    // widget.P() returns the PDFRef of the containing page — the correct source.
    const pageRef = widget?.P?.();
    const pageIdx = pageRef?.objectNumber != null
      ? (pageRefToIdx.get(pageRef.objectNumber) ?? 0)
      : 0;
    const rect    = widget?.getRectangle?.() || null;
    return { name, type, page: pageIdx + 1, rect };
  });
}

async function generateTestPdf(pdfBytes, textValues, signingProfile) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const pdfDoc = await PDFDocument.load(pdfBytes, { ignoreEncryption: true });
  const form   = pdfDoc.getForm();
  const pages  = pdfDoc.getPages();
  const font   = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

  // Map page object number → page index (same fix as detectFields)
  const pageRefToIdx = new Map();
  pages.forEach((page, idx) => pageRefToIdx.set(page.ref.objectNumber, idx));

  // Embed Mike's signature image if signing authority is configured
  let mikeImage = null;
  if (signingProfile) {
    try {
      const res  = await api.get("/api/signing-authority/signature", { responseType: "arraybuffer" });
      mikeImage  = await pdfDoc.embedPng(res.data);
    } catch { /* not configured */ }
  }

  for (const field of form.getFields()) {
    const name    = field.getName();
    const rawType = field.constructor.name.replace("PDF", "").replace("Field", "");

    if (rawType === "Text") {
      try {
        field.setText(textValues[name] ?? "");
        field.enableReadOnly();
      } catch {}
      continue;
    }

    // Signature field — draw overlay at widget position
    const widgets = field.acroField.getWidgets();
    for (const widget of widgets) {
      const rect    = widget.getRectangle?.();
      if (!rect) continue;
      const pageRef = widget.P?.();
      const pageIdx = pageRef?.objectNumber != null
        ? (pageRefToIdx.get(pageRef.objectNumber) ?? 0)
        : 0;
      const page    = pages[pageIdx];
      if (!page) continue;

      // Is this a Mike field or customer field?
      const isMike = signingProfile && (
        textValues[name]?.includes(signingProfile.name) ||
        name.toLowerCase().includes("signed at") ||
        name.toLowerCase().includes("bassani")
      );

      if (isMike && mikeImage) {
        // Embed real signature with padding
        const pad = 4;
        page.drawImage(mikeImage, {
          x: rect.x + pad, y: rect.y + pad,
          width: rect.width - pad * 2, height: rect.height - pad * 2,
        });
      } else {
        // Draw labelled placeholder
        const label    = isMike ? "[ CEO Signature ]" : "[ Customer Signature ]";
        const boxColor = isMike ? rgb(0.88, 0.94, 1) : rgb(0.92, 1, 0.92);
        const penColor = isMike ? rgb(0.2, 0.4, 0.8) : rgb(0.1, 0.5, 0.2);
        page.drawRectangle({
          x: rect.x, y: rect.y,
          width: rect.width, height: rect.height,
          color: boxColor,
          borderColor: penColor,
          borderWidth: 1.5,
          opacity: 0.8,
        });
        const fontSize = Math.min(10, rect.height * 0.35);
        page.drawText(label, {
          x: rect.x + 4,
          y: rect.y + (rect.height - fontSize) / 2,
          size: fontSize,
          font,
          color: penColor,
          maxWidth: rect.width - 8,
        });
      }
    }
  }

  // Flatten — bakes in everything
  try { form.flatten(); } catch {}

  // Stamp TEST watermark on first page
  const firstPage = pages[0];
  firstPage.drawText("TEST DOCUMENT — NOT FOR USE", {
    x: 40, y: firstPage.getHeight() - 30,
    size: 9, font: fontReg,
    color: rgb(0.8, 0.2, 0.2),
    opacity: 0.7,
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
  const [step,           setStep          ] = useState("loading"); // loading | ready | generating
  const [fields,         setFields        ] = useState([]);
  const [testValues,     setTestValues    ] = useState({});
  const [signingProfile, setSigningProfile] = useState(null);
  const [error,          setError         ] = useState(null);

  const load = useCallback(async () => {
    setStep("loading");
    try {
      // Fetch PDF bytes and signing authority in parallel
      const [pdfRes, authRes] = await Promise.all([
        api.get(`/api/doc-templates/${docType}/download`, { responseType: "arraybuffer" }),
        api.get("/api/signing-authority/").catch(() => ({ data: { configured: false } })),
      ]);

      const detected = await detectFields(pdfRes.data);
      setFields(detected);

      const profile = authRes.data.configured ? authRes.data.profile : null;
      setSigningProfile(profile);

      // Pre-populate text fields with sensible test defaults
      const defaults = {};
      for (const f of detected) {
        if (f.type !== "Text") continue;
        const n = f.name.toLowerCase();
        if (n.includes("name") && !n.includes("company")) defaults[f.name] = profile?.name || "Test Customer Name";
        else if (n.includes("company") || n.includes("trading")) defaults[f.name] = "Test Company (Pty) Ltd";
        else if (n.includes("position") || n.includes("title") || n.includes("authoris")) defaults[f.name] = profile ? profile.title : "Director";
        else if (n.includes("date") || n.includes("this") || n.includes(" on")) defaults[f.name] = new Date().toLocaleDateString("en-ZA", { day: "2-digit", month: "long", year: "numeric" });
        else if (n.includes("bassani") || n.includes("location") || n.includes("signed at")) defaults[f.name] = profile?.location || "Cape Town";
        else defaults[f.name] = `[${f.name}]`;
      }
      setTestValues(defaults);
      setStep("ready");
    } catch (e) {
      setError(e.message || "Failed to load document");
      setStep("error");
    }
  }, [docType]);

  useEffect(() => { load(); }, [load]);

  const handleGenerate = async () => {
    setStep("generating");
    try {
      const pdfRes  = await api.get(`/api/doc-templates/${docType}/download`, { responseType: "arraybuffer" });
      const bytes   = await generateTestPdf(pdfRes.data, testValues, signingProfile);
      const blob    = new Blob([bytes], { type: "application/pdf" });
      const url     = URL.createObjectURL(blob);
      const a       = document.createElement("a");
      a.href        = url;
      a.download    = `${docType}-TEST-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("Test PDF downloaded — open it to verify field positions");
      setStep("ready");
    } catch (e) {
      toast.error("Failed to generate test PDF");
      setStep("ready");
    }
  };

  const sigFields  = fields.filter(f => f.type === "Signature");
  const textFields = fields.filter(f => f.type === "Text");

  return (
    <Modal title={`Test signing flow — ${docLabel}`} onClose={onClose} width="max-w-2xl">
      {step === "loading" && (
        <div className="flex flex-col items-center gap-3 py-10">
          <Loader2 size={22} className="animate-spin text-bassani-600" />
          <p className="text-sm text-gray-500">Reading document fields…</p>
        </div>
      )}

      {step === "error" && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle size={24} className="text-amber-500" />
          <p className="text-sm text-gray-700 font-medium">Could not load document</p>
          <p className="text-xs text-gray-400">{error}</p>
          <BtnSecondary onClick={load}>Retry</BtnSecondary>
        </div>
      )}

      {(step === "ready" || step === "generating") && (
        <div className="space-y-5">

          {/* Signing authority status */}
          {signingProfile ? (
            <div className="flex items-start gap-2 bg-green-50 border border-green-100 rounded-xl px-4 py-3">
              <CheckCircle size={14} className="text-green-500 mt-0.5 shrink-0" />
              <p className="text-xs text-green-700">
                Signing authority configured — <strong>{signingProfile.name}</strong> ({signingProfile.title}, {signingProfile.location}).
                Mike's signature will be embedded in the test PDF.
              </p>
            </div>
          ) : (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-100 rounded-xl px-4 py-3">
              <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
              <p className="text-xs text-amber-700">
                No signing authority configured. Signature fields will render as labelled placeholder boxes in the test PDF.
                Set up the Signing Authority tab first for a fully realistic test.
              </p>
            </div>
          )}

          {/* Field summary */}
          <div>
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
              Detected fields ({fields.length})
            </p>
            <div className="border border-gray-100 rounded-xl overflow-hidden text-xs">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-3 py-2 text-gray-500 font-medium">Field name</th>
                    <th className="px-3 py-2 text-gray-500 font-medium">Type</th>
                    <th className="px-3 py-2 text-gray-500 font-medium">Page</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {fields.map((f, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-mono text-gray-700">{f.name}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full font-medium ${
                          f.type === "Signature"
                            ? "bg-purple-50 text-purple-700"
                            : "bg-blue-50 text-blue-700"
                        }`}>
                          {f.type}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-400">p.{f.page}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {sigFields.length > 0 && (
              <p className="text-[11px] text-gray-400 mt-1.5 flex items-center gap-1">
                <Info size={11} />
                Signature fields will appear as coloured placeholder boxes in the test PDF.
                {signingProfile && " Mike's box will contain his real signature image."}
              </p>
            )}
          </div>

          {/* Editable test values for text fields */}
          {textFields.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">
                Test values — text fields
              </p>
              <p className="text-xs text-gray-400 mb-3">
                Edit any value to test how it fits. These are only used in the downloaded test PDF.
              </p>
              <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                {textFields.map((f, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <label className="text-xs text-gray-500 w-44 shrink-0 truncate" title={f.name}>
                      {f.name}
                      <span className="text-gray-300 ml-1">(p.{f.page})</span>
                    </label>
                    <input
                      value={testValues[f.name] ?? ""}
                      onChange={e => setTestValues(v => ({ ...v, [f.name]: e.target.value }))}
                      className="flex-1 text-xs border border-gray-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:ring-2 focus:ring-bassani-500"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {fields.length === 0 && (
            <div className="text-center py-6">
              <AlertTriangle size={20} className="text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-gray-600 font-medium">No AcroForm fields detected</p>
              <p className="text-xs text-gray-400 mt-1">
                The PDF does not contain embedded form fields. Add interactive fields in Adobe Acrobat
                or LibreOffice before uploading this version.
              </p>
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
            <BtnSecondary onClick={onClose}>Close</BtnSecondary>
            {fields.length > 0 && (
              <BtnPrimary onClick={handleGenerate} disabled={step === "generating"}>
                {step === "generating"
                  ? <><Loader2 size={13} className="animate-spin" /> Generating…</>
                  : <><Download size={13} /> Download test PDF</>
                }
              </BtnPrimary>
            )}
          </div>
        </div>
      )}
    </Modal>
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
