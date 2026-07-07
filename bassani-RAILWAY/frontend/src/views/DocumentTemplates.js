import { useState, useEffect, useRef } from "react";
import { Upload, Download, Clock, CheckCircle, ChevronDown, ChevronUp, Loader2, FileText, RotateCcw } from "lucide-react";
import { useAuth } from "../AuthContext";
import { TopBar, BtnPrimary, BtnSecondary, Modal, FormGroup } from "../components/UI";
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
      isActive
        ? "bg-green-50 text-green-700"
        : "bg-gray-100 text-gray-500"
    }`}>
      {isActive && <CheckCircle size={10} />}
      v{version}
    </span>
  );
}

function VersionHistory({ docType, isSuperAdmin, onActivated }) {
  const [versions, setVersions] = useState([]);
  const [loading,  setLoading ] = useState(true);
  const [activating, setActivating] = useState(null);

  useEffect(() => {
    api.get(`/api/doc-templates/${docType}/history`)
      .then(r => setVersions(r.data.versions || []))
      .catch(() => toast.error("Failed to load version history"))
      .finally(() => setLoading(false));
  }, [docType]);

  const handleActivate = async (version) => {
    setActivating(version.id);
    try {
      await api.post(`/api/doc-templates/${docType}/activate/${version.id}`);
      toast.success(`v${version.version} is now active`);
      onActivated();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to activate version");
    } finally {
      setActivating(null);
    }
  };

  const handleDownload = async (version) => {
    try {
      const res = await api.get(
        `/api/doc-templates/${docType}/download/${version.id}`,
        { responseType: "blob" }
      );
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement("a");
      a.href = url;
      a.download = `${docType}-v${version.version}.pdf`;
      a.click();
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
              <td className="px-4 py-2.5">
                <VersionBadge version={v.version} isActive={v.is_active} />
              </td>
              <td className="px-4 py-2.5 text-gray-600">{fmtDate(v.uploaded_at)}</td>
              <td className="px-4 py-2.5 text-gray-600 truncate max-w-[120px]">{v.uploaded_by_name || "—"}</td>
              <td className="px-4 py-2.5 text-gray-400">{fmtSize(v.file_size)}</td>
              <td className="px-4 py-2.5 text-gray-400 truncate max-w-[180px]">{v.notes || "—"}</td>
              <td className="px-4 py-2.5">
                <div className="flex items-center gap-2 justify-end">
                  <button
                    onClick={() => handleDownload(v)}
                    className="text-gray-400 hover:text-bassani-600 transition-colors"
                    title="Download this version"
                  >
                    <Download size={13} />
                  </button>
                  {isSuperAdmin && !v.is_active && (
                    <button
                      onClick={() => handleActivate(v)}
                      disabled={!!activating}
                      className="flex items-center gap-1 text-xs text-amber-600 hover:text-amber-700 font-medium disabled:opacity-50"
                      title="Roll back to this version"
                    >
                      {activating === v.id
                        ? <Loader2 size={12} className="animate-spin" />
                        : <RotateCcw size={12} />
                      }
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

function DocTypeCard({ template, isSuperAdmin, onUploaded }) {
  const [expanded,  setExpanded ] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [notes,     setNotes    ] = useState("");
  const [chosenFile, setChosenFile] = useState(null);
  const fileRef = useRef(null);

  const active = template.active;

  const handleDownloadActive = async () => {
    if (!active) return;
    try {
      const res = await api.get(`/api/doc-templates/${template.doc_type}/download`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement("a");
      a.href = url;
      a.download = template.filename;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    }
  };

  const openModal = () => {
    setChosenFile(null);
    setNotes("");
    setModalOpen(true);
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
        {/* Header row */}
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
          <div className="flex items-center gap-2 shrink-0">
            {active
              ? <VersionBadge version={active.version} isActive />
              : <span className="text-xs text-amber-600 font-medium">No version uploaded</span>
            }
          </div>
        </div>

        {/* Active version details */}
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

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {active && (
            <BtnSecondary size="sm" onClick={handleDownloadActive}>
              <Download size={13} /> Download current
            </BtnSecondary>
          )}
          {isSuperAdmin && (
            <BtnPrimary size="sm" onClick={openModal}>
              <Upload size={13} /> Upload new version
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

        {/* Version history */}
        {expanded && (
          <VersionHistory
            key={historyKey}
            docType={template.doc_type}
            isSuperAdmin={isSuperAdmin}
            onActivated={() => { setHistoryKey(k => k + 1); onUploaded(); }}
          />
        )}
      </div>

      {/* Upload modal */}
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
                  chosenFile
                    ? "border-bassani-400 bg-bassani-50"
                    : "border-gray-200 hover:border-bassani-300 hover:bg-gray-50"
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
                <input
                  ref={fileRef}
                  type="file"
                  accept=".pdf"
                  className="hidden"
                  onChange={e => setChosenFile(e.target.files?.[0] || null)}
                />
              </div>
            </FormGroup>
            <FormGroup label="Release notes (optional)">
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                placeholder="e.g. Updated indemnity clause — approved by legal 2026-07-07"
                rows={3}
                className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-bassani-500"
              />
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

export default function DocumentTemplates() {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin || user?.role === "super_admin";
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
      <main className="flex-1 p-6 max-w-4xl mx-auto w-full">

        <div className="mb-6">
          <p className="text-sm text-gray-500 max-w-2xl">
            Manage the four Bassani-issued onboarding template PDFs. Uploading a new version immediately
            replaces what customers download — no redeployment needed. Previous versions are archived
            and can be restored at any time.
          </p>
          {isSuperAdmin && (
            <div className="mt-3 flex items-start gap-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 max-w-2xl">
              <span className="text-blue-500 text-xs mt-0.5">ℹ</span>
              <p className="text-xs text-blue-700">
                Before enabling e-signatures, prepare each PDF with embedded form fields
                (signature, name, date, company) in Adobe Acrobat or LibreOffice. The field
                positions are stored in the PDF itself, so they update automatically when you upload a new version.
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
      </main>
    </div>
  );
}
