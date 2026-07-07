import { useState, useEffect, useRef } from "react";
import { useParams } from "react-router-dom";
import { Upload, CheckCircle, XCircle, Loader2, FileText, X, Download } from "lucide-react";
import axios from "axios";

const api = axios.create({ baseURL: "" });

const DOC_LABELS = {
  store_onboarding_agreement: "Signed Store Onboarding Agreement",
  customer_information_form:  "Signed Customer Information Form",
  nda:                        "Signed NDA",
  tqa:                        "Signed TQA Document",
  cipc_certificate:           "CIPC Company Registration Certificate",
};

// Template files for the 4 Bassani-issued documents (cipc_certificate is the customer's own doc)
const DOC_TEMPLATES = {
  store_onboarding_agreement: { filename: "store-onboarding-agreement.pdf", label: "Store Onboarding Agreement" },
  customer_information_form:  { filename: "customer-information-form.pdf",  label: "Customer Information Form"  },
  nda:                        { filename: "nda.pdf",                        label: "NDA"                        },
  tqa:                        { filename: "tqa.pdf",                        label: "TQA Document"               },
};

export default function PublicDocUpload() {
  const { token } = useParams();

  const [state,             setState            ] = useState("loading");
  const [partnerName,       setPartnerName      ] = useState("");
  const [requestedDocTypes, setRequestedDocTypes] = useState([]);
  const [slots,             setSlots            ] = useState({});   // { [docType]: File }
  const [uploading,         setUploading        ] = useState(false);
  const [uploadError,       setUploadError      ] = useState("");

  const fileInputRef = useRef(null);
  const pendingSlot  = useRef(null);

  useEffect(() => {
    api.get(`/api/upload-requests/${token}`)
      .then(r => {
        if (r.data.valid) {
          setPartnerName(r.data.partner_name || "");
          const types = r.data.requested_doc_types || Object.keys(DOC_LABELS);
          setRequestedDocTypes(types);
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

  const triggerSlot = (docType) => {
    pendingSlot.current = docType;
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
      fileInputRef.current.click();
    }
  };

  const handleFileChosen = (e) => {
    const file = e.target.files?.[0];
    const dt   = pendingSlot.current;
    if (!file || !dt) return;
    setSlots(prev => ({ ...prev, [dt]: file }));
    pendingSlot.current = null;
  };

  const clearSlot = (docType) => {
    setSlots(prev => {
      const next = { ...prev };
      delete next[docType];
      return next;
    });
  };

  const filledCount = Object.keys(slots).length;

  const downloadTemplate = async (docType) => {
    const tpl = DOC_TEMPLATES[docType];
    if (!tpl) return;
    try {
      const res = await api.get(`/api/public/templates/download/${tpl.filename}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement("a");
      a.href = url; a.download = tpl.label + ".pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch {
      // fail silently — user can try again
    }
  };

  const handleSubmit = async () => {
    if (!filledCount) return;
    setUploading(true);
    setUploadError("");
    try {
      const fd = new FormData();
      Object.entries(slots).forEach(([docType, file]) => {
        fd.append("files", file);
        fd.append("doc_types", docType);
      });
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
          <img src="/logo.png" alt="Bassani Health" className="w-full block" />
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
                  Select a file for each document below. Accepted formats: PDF, Word, JPG, PNG.
                </p>
              </div>

              {/* Hidden shared file input */}
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"
                className="hidden"
                onChange={handleFileChosen}
              />

              {/* Per-document slots */}
              <div className="space-y-3 mb-6">
                {requestedDocTypes.map(docType => {
                  const label = DOC_LABELS[docType] || docType;
                  const file  = slots[docType];
                  const hasTpl = !!DOC_TEMPLATES[docType];
                  return (
                    <div key={docType}
                      className="border border-gray-100 rounded-xl p-4 bg-gray-50"
                    >
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <p className="text-sm font-medium text-gray-700">{label}</p>
                        {hasTpl && (
                          <button
                            onClick={() => downloadTemplate(docType)}
                            type="button"
                            className="flex items-center gap-1 text-xs text-bassani-600 hover:text-bassani-700 font-medium whitespace-nowrap shrink-0"
                          >
                            <Download size={12} />
                            Download template
                          </button>
                        )}
                      </div>
                      {hasTpl && !file && (
                        <p className="text-xs text-gray-400 mb-2">
                          Download, complete and sign, then upload below.
                        </p>
                      )}
                      {file ? (
                        <div className="flex items-center gap-3 bg-white rounded-lg px-3 py-2 border border-gray-100">
                          <FileText size={14} className="text-bassani-500 shrink-0" />
                          <span className="flex-1 text-sm text-gray-700 truncate">{file.name}</span>
                          <span className="text-xs text-gray-400 shrink-0">
                            {(file.size / 1024).toFixed(0)} KB
                          </span>
                          <button
                            onClick={() => clearSlot(docType)}
                            className="text-gray-300 hover:text-red-400 transition-colors shrink-0"
                            type="button"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => triggerSlot(docType)}
                          type="button"
                          className="flex items-center gap-2 text-sm text-bassani-600 hover:text-bassani-700 font-medium"
                        >
                          <Upload size={14} />
                          Browse…
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {uploadError && (
                <p className="text-sm text-red-500 mb-4">{uploadError}</p>
              )}

              <button
                onClick={handleSubmit}
                disabled={!filledCount || uploading}
                className="w-full py-3 rounded-xl bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                type="button"
              >
                {uploading ? (
                  <><Loader2 size={15} className="animate-spin" /> Uploading…</>
                ) : (
                  <><Upload size={15} /> Submit {filledCount > 0 ? `${filledCount} document${filledCount > 1 ? "s" : ""}` : "documents"}</>
                )}
              </button>

              {filledCount < requestedDocTypes.length && (
                <p className="text-xs text-gray-400 text-center mt-3">
                  {requestedDocTypes.length - filledCount} document{requestedDocTypes.length - filledCount > 1 ? "s" : ""} still needed. You can submit what you have and send the rest later.
                </p>
              )}
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
