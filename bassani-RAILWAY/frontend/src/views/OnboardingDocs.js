import { useState } from "react";
import { FileText, Download, Mail, Loader2 } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar } from "../components/UI";

const TEMPLATES = [
  { filename: "store-onboarding-agreement.pdf", label: "Store Onboarding Agreement" },
  { filename: "customer-information-form.pdf",  label: "Customer Information Form" },
  { filename: "nda.pdf",                        label: "NDA" },
  { filename: "tqa.pdf",                        label: "TQA Document" },
];

export default function OnboardingDocs() {
  const [emailTarget,  setEmailTarget ] = useState("");
  const [emailSending, setEmailSending] = useState(false);
  const [downloading,  setDownloading ] = useState(null);

  const downloadTemplate = async (filename, label) => {
    setDownloading(filename);
    try {
      const res = await api.get(`/api/onboarding/templates/download/${filename}`, { responseType: "blob" });
      const url = URL.createObjectURL(res.data);
      const a   = document.createElement("a");
      a.href = url; a.download = label + ".pdf"; a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Download failed");
    } finally {
      setDownloading(null);
    }
  };

  const emailTemplates = async () => {
    if (!emailTarget.trim()) return toast.error("Enter the customer's email address");
    setEmailSending(true);
    try {
      await api.post("/api/onboarding/templates/email", { to_email: emailTarget.trim() });
      toast.success("Documents sent to " + emailTarget.trim());
      setEmailTarget("");
    } catch {
      toast.error("Failed to send documents");
    } finally {
      setEmailSending(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Onboarding Documents"
        subtitle="Download or email Bassani Health customer onboarding templates"
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Template downloads */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-2">
              <FileText size={15} className="text-bassani-600 shrink-0" />
              <h3 className="text-sm font-bold text-gray-900">Template Documents</h3>
            </div>
            <div className="px-6 py-5 space-y-2">
              {TEMPLATES.map(t => (
                <div key={t.filename}
                  className="flex items-center justify-between bg-gray-50 rounded-xl px-4 py-3 border border-gray-100">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-8 h-8 bg-bassani-50 rounded-lg flex items-center justify-center shrink-0">
                      <FileText size={14} className="text-bassani-600" />
                    </div>
                    <span className="text-xs font-semibold text-gray-800 truncate">{t.label}</span>
                  </div>
                  <button
                    onClick={() => downloadTemplate(t.filename, t.label)}
                    disabled={downloading === t.filename}
                    className="flex items-center gap-1.5 text-xs font-semibold text-bassani-600 hover:text-bassani-700 disabled:opacity-50 shrink-0 ml-4 transition-colors">
                    {downloading === t.filename
                      ? <Loader2 size={12} className="animate-spin" />
                      : <Download size={12} />}
                    Download
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Email to customer */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-2">
              <Mail size={15} className="text-bassani-600 shrink-0" />
              <h3 className="text-sm font-bold text-gray-900">Email Documents to Customer</h3>
            </div>
            <div className="px-6 py-5">
              <p className="text-xs text-gray-500 mb-4">
                Send all four template documents to your customer's email address as attachments.
              </p>
              <div className="flex gap-2">
                <input
                  type="email"
                  value={emailTarget}
                  onChange={e => setEmailTarget(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && emailTemplates()}
                  placeholder="customer@example.co.za"
                  className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
                />
                <button
                  onClick={emailTemplates}
                  disabled={emailSending || !emailTarget.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                  {emailSending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                  Send Documents
                </button>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
