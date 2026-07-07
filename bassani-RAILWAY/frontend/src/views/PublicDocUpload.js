import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Upload, CheckCircle, XCircle, Loader2, FileText, X } from "lucide-react";
import axios from "axios";

const api = axios.create({ baseURL: "" });

export default function PublicDocUpload() {
  const { token } = useParams();

  const [state,       setState      ] = useState("loading"); // loading | valid | expired | not_found | done | error
  const [partnerName, setPartnerName] = useState("");
  const [files,       setFiles      ] = useState([]);
  const [uploading,   setUploading  ] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [dragOver,    setDragOver   ] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    api.get(`/api/upload-requests/${token}`)
      .then(r => {
        if (r.data.valid) {
          setPartnerName(r.data.partner_name || "");
          setState("valid");
        } else {
          setPartnerName(r.data.partner_name || "");
          setState(r.data.reason === "expired" ? "expired" : "not_found");
        }
      })
      .catch(err => {
        setState(err.response?.status === 404 ? "not_found" : "error");
      });
  }, [token]);

  const addFiles = (incoming) => {
    const arr = Array.from(incoming).filter(f =>
      /\.(pdf|doc|docx|jpg|jpeg|png)$/i.test(f.name)
    );
    if (!arr.length) return;
    setFiles(prev => {
      const names = new Set(prev.map(f => f.name));
      return [...prev, ...arr.filter(f => !names.has(f.name))];
    });
  };

  const removeFile = (name) => setFiles(prev => prev.filter(f => f.name !== name));

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    addFiles(e.dataTransfer.files);
  };

  const handleSubmit = async () => {
    if (!files.length) return;
    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      files.forEach(f => fd.append("files", f));
      await api.post(`/api/upload-requests/${token}/files`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setState("done");
    } catch (e) {
      setUploadError(e.response?.data?.detail || "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg">

        {/* Header card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden mb-4">
          <img
            src="/logo.png"
            alt="Bassani Health"
            className="w-full block"
          />
        </div>

        {/* Content card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-8">

          {state === "loading" && (
            <div className="flex flex-col items-center py-8 gap-3">
              <Loader2 size={28} className="animate-spin text-bassani-600" />
              <p className="text-sm text-gray-400">Verifying link…</p>
            </div>
          )}

          {state === "expired" && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
                <XCircle size={28} className="text-amber-500" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">This link has expired</h2>
              {partnerName && (
                <p className="text-sm text-gray-500 mb-2">Account: <strong>{partnerName}</strong></p>
              )}
              <p className="text-sm text-gray-500">
                Document upload links expire after 7 days. Please contact your Bassani Health representative to request a new link.
              </p>
            </div>
          )}

          {state === "not_found" && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <XCircle size={28} className="text-red-400" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Link not found</h2>
              <p className="text-sm text-gray-500">
                This upload link is invalid or has already been used. Contact your Bassani Health representative if you need assistance.
              </p>
            </div>
          )}

          {state === "error" && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <XCircle size={28} className="text-red-400" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Something went wrong</h2>
              <p className="text-sm text-gray-500">
                We could not verify this link. Please try again or contact your Bassani Health representative.
              </p>
            </div>
          )}

          {state === "done" && (
            <div className="text-center py-4">
              <div className="w-14 h-14 rounded-full bg-green-50 flex items-center justify-center mx-auto mb-4">
                <CheckCircle size={28} className="text-green-500" />
              </div>
              <h2 className="text-lg font-bold text-gray-900 mb-2">Documents received</h2>
              {partnerName && (
                <p className="text-sm text-gray-500 mb-2">Account: <strong>{partnerName}</strong></p>
              )}
              <p className="text-sm text-gray-500">
                Thank you. Your documents have been submitted to the Bassani Health team and will be reviewed shortly.
              </p>
            </div>
          )}

          {state === "valid" && (
            <>
              <div className="mb-6">
                <h2 className="text-lg font-bold text-gray-900 mb-1">Upload your documents</h2>
                {partnerName && (
                  <p className="text-sm text-gray-500">Account: <strong>{partnerName}</strong></p>
                )}
                <p className="text-sm text-gray-400 mt-1">
                  Accepted formats: PDF, Word, JPG, PNG. You can select multiple files at once.
                </p>
              </div>

              {/* Drop zone */}
              <div
                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors mb-4 ${
                  dragOver
                    ? "border-bassani-500 bg-bassani-50"
                    : "border-gray-200 hover:border-bassani-300 hover:bg-gray-50"
                }`}
              >
                <Upload size={24} className="text-gray-300 mx-auto mb-2" />
                <p className="text-sm font-medium text-gray-600">
                  Drag files here or <span className="text-bassani-600">browse</span>
                </p>
                <input
                  ref={inputRef}
                  type="file"
                  multiple
                  accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                  className="hidden"
                  onChange={e => { if (e.target.files) addFiles(e.target.files); }}
                />
              </div>

              {/* Selected files */}
              {files.length > 0 && (
                <div className="space-y-2 mb-5">
                  {files.map(f => (
                    <div key={f.name}
                      className="flex items-center gap-3 bg-gray-50 rounded-xl px-4 py-2.5">
                      <FileText size={15} className="text-gray-400 shrink-0" />
                      <span className="flex-1 text-sm text-gray-700 truncate">{f.name}</span>
                      <span className="text-xs text-gray-400 shrink-0">
                        {(f.size / 1024).toFixed(0)} KB
                      </span>
                      <button
                        onClick={() => removeFile(f.name)}
                        className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {uploadError && (
                <p className="text-sm text-red-500 mb-4">{uploadError}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={!files.length || uploading}
                className="w-full py-3 rounded-xl bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
              >
                {uploading ? (
                  <><Loader2 size={15} className="animate-spin" /> Uploading…</>
                ) : (
                  <><Upload size={15} /> Submit {files.length > 0 ? `${files.length} file${files.length > 1 ? "s" : ""}` : "documents"}</>
                )}
              </button>
            </>
          )}

        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Bassani Health · Cnr Dytchley &amp; Marcius Roads, Kyalami
        </p>
      </div>
    </div>
  );
}
