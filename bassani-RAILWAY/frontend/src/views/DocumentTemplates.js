import { useState, useEffect, useRef } from "react";
import {
  Upload, Download, Clock, CheckCircle, ChevronDown, ChevronUp,
  Loader2, FileText, RotateCcw, FlaskConical, AlertTriangle,
  Eye, X, Info, Package, Trash2,
} from "lucide-react";
import { useAuth } from "../AuthContext";
import { TopBar, BtnPrimary, BtnSecondary, Modal, FormGroup } from "../components/UI";
import { DOC_CONFIGS, detectFields, generateSignedPdf } from "../utils/pdfSigning";
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

function fileIcon(filename) {
  const ext = (filename || "").split(".").pop().toLowerCase();
  if (ext === "xlsx" || ext === "xls") return <Package size={14} className="text-green-600 shrink-0" />;
  return <FileText size={14} className="text-bassani-600 shrink-0" />;
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

// ── Bundle version history (Welcome Pack) ──────────────────────────────────────

function BundleVersionHistory({ isSuperAdmin, onActivated }) {
  const [versions,   setVersions  ] = useState([]);
  const [loading,    setLoading   ] = useState(true);
  const [activating, setActivating] = useState(null);
  const [expanded,   setExpanded  ] = useState(null); // bundle id with files visible

  const load = () => {
    setLoading(true);
    api.get("/api/doc-templates/welcome_pack/history")
      .then(r => setVersions(r.data.versions || []))
      .catch(() => toast.error("Failed to load version history"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const handleActivate = async (v) => {
    setActivating(v.id);
    try {
      await api.post(`/api/doc-templates/welcome_pack/activate/${v.id}`);
      toast.success(`v${v.version} is now active`);
      load();
      onActivated();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to activate bundle");
    } finally {
      setActivating(null);
    }
  };

  const handleDownloadFile = async (bundleId, fileIdx, filename) => {
    try {
      const res = await api.get(
        `/api/doc-templates/welcome_pack/bundle/${bundleId}/file/${fileIdx}`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  };

  if (loading) return <p className="text-xs text-gray-400 py-2">Loading…</p>;
  if (!versions.length) return <p className="text-xs text-gray-400 py-2">No bundles uploaded yet.</p>;

  return (
    <div className="mt-3 border border-gray-100 rounded-xl overflow-hidden">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-gray-50 text-left">
            <th className="px-4 py-2 text-gray-500 font-medium">Version</th>
            <th className="px-4 py-2 text-gray-500 font-medium">Uploaded</th>
            <th className="px-4 py-2 text-gray-500 font-medium">By</th>
            <th className="px-4 py-2 text-gray-500 font-medium">Files</th>
            <th className="px-4 py-2 text-gray-500 font-medium">Total size</th>
            <th className="px-4 py-2 text-gray-500 font-medium">Notes</th>
            <th className="px-4 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {versions.map(v => (
            <>
              <tr key={v.id} className={v.is_active ? "bg-green-50/40" : ""}>
                <td className="px-4 py-2.5"><VersionBadge version={v.version} isActive={v.is_active} /></td>
                <td className="px-4 py-2.5 text-gray-600">{fmtDate(v.uploaded_at)}</td>
                <td className="px-4 py-2.5 text-gray-600 truncate max-w-[120px]">{v.uploaded_by_name || "—"}</td>
                <td className="px-4 py-2.5">
                  <button
                    onClick={() => setExpanded(expanded === v.id ? null : v.id)}
                    className="flex items-center gap-1 text-gray-500 hover:text-bassani-600 transition-colors"
                  >
                    {v.files?.length || 0} file{(v.files?.length || 0) !== 1 ? "s" : ""}
                    {expanded === v.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                  </button>
                </td>
                <td className="px-4 py-2.5 text-gray-400">{fmtSize(v.total_file_size)}</td>
                <td className="px-4 py-2.5 text-gray-400 truncate max-w-[160px]">{v.notes || "—"}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2 justify-end">
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
              {expanded === v.id && (v.files || []).map((f, i) => (
                <tr key={`${v.id}-file-${i}`} className={`${v.is_active ? "bg-green-50/20" : "bg-gray-50/60"} border-t border-gray-100/60`}>
                  <td colSpan={2} className="pl-8 pr-3 py-2">
                    <div className="flex items-center gap-2">
                      {fileIcon(f.filename)}
                      <span className="text-gray-700 font-medium">{f.label}</span>
                    </div>
                  </td>
                  <td colSpan={3} className="px-3 py-2 text-gray-400">{f.filename} · {fmtSize(f.file_size)}</td>
                  <td colSpan={2} className="px-4 py-2">
                    <div className="flex justify-end">
                      <button
                        onClick={() => handleDownloadFile(v.id, i, f.filename)}
                        className="text-gray-400 hover:text-bassani-600 transition-colors"
                        title={`Download ${f.filename}`}
                      >
                        <Download size={13} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Welcome Pack Bundle Card ───────────────────────────────────────────────────

function WelcomePackBundleCard({ template, isSuperAdmin, onUploaded }) {
  const [expanded,     setExpanded    ] = useState(false);
  const [historyKey,   setHistoryKey  ] = useState(0);
  const [uploadOpen,   setUploadOpen  ] = useState(false);
  const [uploading,    setUploading   ] = useState(false);
  const [notes,        setNotes       ] = useState("");
  const [chosenFiles,  setChosenFiles ] = useState([]); // [{file, label}]
  const fileRef = useRef(null);

  const active = template.active;

  const handleFileSelect = (e) => {
    const files = Array.from(e.target.files || []);
    setChosenFiles(files.map(f => ({
      file:  f,
      label: f.name.replace(/\.[^.]+$/, "").replace(/[-_]/g, " "),
    })));
  };

  const updateLabel = (idx, value) => {
    setChosenFiles(prev => prev.map((cf, i) => i === idx ? { ...cf, label: value } : cf));
  };

  const removeFile = (idx) => {
    setChosenFiles(prev => prev.filter((_, i) => i !== idx));
  };

  const handleUpload = async () => {
    if (!chosenFiles.length) return toast.error("Select at least one file");
    setUploading(true);
    try {
      const fd = new FormData();
      chosenFiles.forEach(({ file }) => fd.append("files", file));
      fd.append("labels", JSON.stringify(chosenFiles.map(({ label }) => label)));
      fd.append("notes", notes.trim());
      await api.post("/api/doc-templates/welcome_pack/upload-bundle", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Welcome Pack updated to v${(active?.version || 0) + 1}`);
      setUploadOpen(false);
      setChosenFiles([]);
      setNotes("");
      setHistoryKey(k => k + 1);
      onUploaded();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDownloadFile = async (fileIdx, f) => {
    if (!active?.id) return;
    try {
      const res = await api.get(
        `/api/doc-templates/welcome_pack/bundle/${active.id}/file/${fileIdx}`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(res.data);
      const a = document.createElement("a");
      a.href = url; a.download = f.filename; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  };

  return (
    <>
      <div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-teal-50 flex items-center justify-center shrink-0">
              <Package size={18} className="text-teal-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{template.label}</h3>
              <p className="text-xs text-gray-400 mt-0.5">Multi-file bundle — PDF &amp; Excel</p>
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
          <>
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
                <p className="text-[10px] text-gray-400 mb-0.5">Total size</p>
                <p className="text-xs font-medium text-gray-700">{fmtSize(active.total_file_size)}</p>
              </div>
            </div>

            {/* Active bundle file list */}
            <div className="space-y-2 mb-4">
              {(active.files || []).map((f, i) => (
                <div key={i} className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5">
                  {fileIcon(f.filename)}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-gray-800 truncate">{f.label}</p>
                    <p className="text-[10px] text-gray-400 truncate">{f.filename} · {fmtSize(f.file_size)}</p>
                  </div>
                  <button
                    onClick={() => handleDownloadFile(i, f)}
                    className="text-gray-400 hover:text-bassani-600 transition-colors shrink-0"
                    title={`Download ${f.filename}`}
                  >
                    <Download size={13} />
                  </button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 mb-4">
            <p className="text-xs text-amber-700">
              No welcome pack bundle uploaded yet. Upload the price list, product guide, and any other documents
              that should be attached to the welcome pack email.
            </p>
          </div>
        )}

        {active?.notes && (
          <p className="text-xs text-gray-500 italic mb-4">Release note: {active.notes}</p>
        )}

        <div className="flex items-center gap-2 flex-wrap">
          {isSuperAdmin && (
            <BtnPrimary size="sm" onClick={() => { setChosenFiles([]); setNotes(""); setUploadOpen(true); }}>
              <Upload size={13} /> Upload new bundle
            </BtnPrimary>
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
          <BundleVersionHistory
            key={historyKey}
            isSuperAdmin={isSuperAdmin}
            onActivated={() => { setHistoryKey(k => k + 1); onUploaded(); }}
          />
        )}
      </div>

      {uploadOpen && (
        <Modal title="Upload new Welcome Pack bundle" onClose={() => setUploadOpen(false)} width="max-w-lg">
          <div className="space-y-4">
            <p className="text-sm text-gray-500">
              Select all files that make up the welcome pack (PDF and Excel accepted).
              These will be attached to every welcome pack email until a newer bundle is uploaded.
              The previous bundle is archived and can be restored at any time.
            </p>

            {/* File picker */}
            <FormGroup label="Files" required>
              <div
                onClick={() => fileRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-colors ${
                  chosenFiles.length ? "border-bassani-400 bg-bassani-50" : "border-gray-200 hover:border-bassani-300 hover:bg-gray-50"
                }`}
              >
                {chosenFiles.length === 0 ? (
                  <>
                    <Upload size={20} className="text-gray-300 mx-auto mb-2" />
                    <p className="text-sm text-gray-500">Click to select files</p>
                    <p className="text-xs text-gray-400 mt-1">PDF, XLSX, XLS — select multiple</p>
                  </>
                ) : (
                  <p className="text-sm font-medium text-bassani-700">{chosenFiles.length} file{chosenFiles.length !== 1 ? "s" : ""} selected — click to change</p>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf,.xlsx,.xls"
                  multiple
                  className="hidden"
                  onChange={handleFileSelect}
                />
              </div>
            </FormGroup>

            {/* Per-file label editor */}
            {chosenFiles.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">File labels</p>
                {chosenFiles.map(({ file, label }, i) => (
                  <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
                    {fileIcon(file.name)}
                    <div className="flex-1 min-w-0 space-y-1">
                      <input
                        type="text"
                        value={label}
                        onChange={e => updateLabel(i, e.target.value)}
                        placeholder="Label (shown in email)"
                        className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-bassani-500 bg-white"
                      />
                      <p className="text-[10px] text-gray-400 truncate">{file.name} · {fmtSize(file.size)}</p>
                    </div>
                    <button
                      onClick={() => removeFile(i)}
                      className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <FormGroup label="Release notes (optional)">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Updated price list for Q3 2026"
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-bassani-500"
              />
            </FormGroup>

            <div className="flex justify-end gap-2 pt-2">
              <BtnSecondary onClick={() => setUploadOpen(false)}>Cancel</BtnSecondary>
              <BtnPrimary onClick={handleUpload} disabled={!chosenFiles.length || uploading}>
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
  const [sigBytes,   setSigBytes  ] = useState(null);
  const canvasRef = useRef(null);
  const isDrawing = useRef(false);
  const lastPos   = useRef({ x: 0, y: 0 });
  const hasMark   = useRef(false);

  useEffect(() => {
    let url;
    Promise.all([
      api.get(`/api/doc-templates/${docType}/download`, { responseType: "arraybuffer" }),
      api.get("/api/profile/").catch(() => null),
      api.get("/api/profile/signature", { responseType: "arraybuffer" }).catch(() => null),
    ]).then(async ([pdfRes, profileRes, sigRes]) => {
      const bytes = new Uint8Array(pdfRes.data);
      setPdfBytes(bytes);
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setPdfUrl(url);
      const p = profileRes?.data;
      setSigProfile(p ? { name: p.signing_name || p.name || "", title: p.signing_title || "" } : null);
      setSigBytes(sigRes?.data || null);
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
      const result = await generateSignedPdf(pdfBytes, {
        textValues,
        signingProfile: sigProfile,
        mikeFieldName,
        mikeImageBytes: sigBytes,
        customerSigDataUrl,
        config,
        addWatermark: true,
      });
      const blob = new Blob([result], { type: "application/pdf" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = `${docType}-test-signed-${new Date().toISOString().slice(0, 10)}.pdf`; a.click();
      URL.revokeObjectURL(url);
      toast.success("Test PDF downloaded");
    } catch (err) { console.error("generateSignedPdf error:", err); toast.error("Failed to generate test PDF"); }
    finally { setGenerating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-gray-900/80 backdrop-blur-sm">
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
          <div className="flex-1 p-4 min-w-0">
            {pdfUrl && (
              <iframe src={pdfUrl} title={docLabel}
                className="w-full h-full rounded-xl border border-gray-200 bg-white" />
            )}
          </div>
          <div className="w-80 shrink-0 border-l border-gray-200 bg-white flex flex-col">
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
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
                      <p className="text-xs text-amber-700">No signing identity configured. Set up your signing name, title, and signature in My Profile for a realistic test.</p>
                    </div>
                  )}
                </div>
              )}
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

// ── Main view ─────────────────────────────────────────────────────────────────
export default function DocumentTemplates({ embedded = false }) {
  const { can } = useAuth();
  const isSuperAdmin = can("settings.manage");

  const [templates,    setTemplates   ] = useState([]);
  const [loading,      setLoading     ] = useState(true);
  const [listKey,      setListKey     ] = useState(0);
  const [fieldRefOpen, setFieldRefOpen] = useState(false);
  const [fieldRefTab,  setFieldRefTab ] = useState("nda");

  const FIELD_REF_DOCS = [
    { key: "nda",                        label: "NDA" },
    { key: "store_onboarding_agreement", label: "Store Agreement" },
    { key: "customer_information_form",  label: "Customer Info Form" },
  ];

  const load = () => {
    setLoading(true);
    api.get("/api/doc-templates/")
      .then(r => setTemplates(r.data.templates || []))
      .catch(() => toast.error("Failed to load document templates"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [listKey]); // eslint-disable-line

  return (
    <div className={embedded ? "flex flex-col flex-1 overflow-hidden" : "flex flex-col min-h-screen bg-gray-50"}>
      {!embedded && <TopBar title="Document Templates" />}
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto w-full">

          <div className="mb-6">
            <p className="text-sm text-gray-500">
              Manage the four Bassani-issued template documents. Uploading a new version
              immediately replaces what customers receive. No redeployment needed. Previous
              versions are archived and can be restored at any time.
            </p>
            {isSuperAdmin && (
              <div className="mt-3 flex items-start gap-3 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
                <Info size={14} className="text-blue-500 mt-0.5 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs text-blue-700">
                    Before enabling e-signatures, prepare each PDF with embedded form fields in Adobe Acrobat or LibreOffice.
                    Each field must use the exact name the portal expects. Field positions are stored in the PDF itself and update automatically when you upload a new version.
                  </p>
                  <button
                    onClick={() => setFieldRefOpen(true)}
                    className="mt-2 text-xs font-semibold text-blue-700 underline underline-offset-2 hover:text-blue-900 transition-colors"
                  >
                    View required field names per document
                  </button>
                </div>
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
                t.is_bundle ? (
                  <WelcomePackBundleCard
                    key={t.doc_type}
                    template={t}
                    isSuperAdmin={isSuperAdmin}
                    onUploaded={() => setListKey(k => k + 1)}
                  />
                ) : (
                  <DocTypeCard
                    key={t.doc_type}
                    template={t}
                    isSuperAdmin={isSuperAdmin}
                    onUploaded={() => setListKey(k => k + 1)}
                  />
                )
              ))}
            </div>
          )}

          <div className="mt-8 bg-gray-100 rounded-2xl px-6 py-5">
            <h3 className="text-xs font-semibold text-gray-600 uppercase tracking-wider mb-2">Version control</h3>
            <ul className="space-y-1.5 text-xs text-gray-500">
              <li>Each upload creates a numbered version (v1, v2, v3).</li>
              <li>The active version is what customers and resellers download immediately.</li>
              <li>Archived versions are never deleted. Signed copies always reference the exact version at time of signing.</li>
              <li>Roll back to any previous version using the Activate button in the version history.</li>
              <li>The Welcome Pack is a multi-file bundle — upload all files together as one versioned unit.</li>
            </ul>
          </div>
        </div>
      </main>

      {fieldRefOpen && (
        <Modal title="PDF Field Name Reference" onClose={() => setFieldRefOpen(false)} width="max-w-2xl">
          <p className="text-xs text-gray-500 mb-4">
            These are the exact AcroForm field names your PDF must use. Create them in Adobe Acrobat or LibreOffice Draw before uploading.
            Fields marked as auto-filled are written by the portal and do not need to be filled in by the customer.
          </p>

          <div className="border-b border-gray-200 mb-4">
            <div className="flex gap-1">
              {FIELD_REF_DOCS.map(d => (
                <button
                  key={d.key}
                  onClick={() => setFieldRefTab(d.key)}
                  className={`px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    fieldRefTab === d.key
                      ? "border-bassani-600 text-bassani-700"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>

          {FIELD_REF_DOCS.filter(d => d.key === fieldRefTab).map(d => {
            const cfg = DOC_CONFIGS[d.key];
            return (
              <div key={d.key} className="space-y-4">
                {(cfg?.sections || []).map(section => (
                  <div key={section.title}>
                    <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{section.title}</h4>
                    <div className="border border-gray-100 rounded-xl overflow-hidden">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="bg-gray-50 border-b border-gray-100">
                            <th className="text-left px-3 py-2 font-semibold text-gray-500 w-1/2">Field name</th>
                            <th className="text-left px-3 py-2 font-semibold text-gray-500">Label / purpose</th>
                          </tr>
                        </thead>
                        <tbody>
                          {section.fields.map((f, i) => (
                            <tr key={f.name} className={i % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                              <td className="px-3 py-2 font-mono text-bassani-700 select-all">{f.name}</td>
                              <td className="px-3 py-2 text-gray-600">{f.label}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
                {cfg?.hasBassaniSig && (
                  <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700 space-y-2">
                    <p>This document requires a Bassani countersignature. Add a signature field with a name starting with <span className="font-mono font-semibold">bassani_</span> — the portal embeds the signature image during admin approval.</p>
                    {cfg.bassaniTextFields?.length > 0 && (
                      <>
                        <p className="font-semibold pt-1">The following text fields are also auto-filled by the portal. Do not make them customer-editable:</p>
                        <div className="border border-amber-200 rounded-lg overflow-hidden">
                          <table className="w-full">
                            <thead>
                              <tr className="bg-amber-100/60 border-b border-amber-200">
                                <th className="text-left px-3 py-1.5 font-semibold w-1/2">Field name</th>
                                <th className="text-left px-3 py-1.5 font-semibold">Filled with</th>
                              </tr>
                            </thead>
                            <tbody>
                              {cfg.bassaniTextFields.map((f, i) => (
                                <tr key={f.name} className={i % 2 === 0 ? "" : "bg-amber-100/40"}>
                                  <td className="px-3 py-1.5 font-mono font-semibold">{f.name}</td>
                                  <td className="px-3 py-1.5">{f.description}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Modal>
      )}
    </div>
  );
}
