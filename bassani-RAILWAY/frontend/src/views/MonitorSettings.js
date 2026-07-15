import { useState, useEffect } from "react";
import { Monitor, Copy, RefreshCw, CheckCircle } from "lucide-react";
import { BtnPrimary, BtnSecondary, Modal } from "../components/UI";
import api from "../api";
import toast from "react-hot-toast";

export default function MonitorSettings({ embedded }) {
  const [tokenData,    setTokenData   ] = useState(null);
  const [loading,      setLoading     ] = useState(true);
  const [rotating,     setRotating    ] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [copied,       setCopied      ] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get("/api/monitor/token");
      setTokenData(data);
    } catch {
      toast.error("Failed to load monitor token");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const monitorUrl = tokenData?.token
    ? `${window.location.origin}/monitor?token=${tokenData.token}`
    : null;

  const copyUrl = async () => {
    if (!monitorUrl) return;
    await navigator.clipboard.writeText(monitorUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doRotate = async () => {
    setRotateConfirm(false);
    setRotating(true);
    try {
      await api.post("/api/monitor/token");
      await load();
      toast.success("Token rotated. Update any screens using the old URL.");
    } catch {
      toast.error("Failed to rotate token");
    } finally {
      setRotating(false);
    }
  };

  const generateFirst = async () => {
    setRotating(true);
    try {
      await api.post("/api/monitor/token");
      await load();
      toast.success("Monitor URL generated.");
    } catch {
      toast.error("Failed to generate token");
    } finally {
      setRotating(false);
    }
  };

  const content = (
    <div className={embedded ? "p-6 max-w-4xl mx-auto w-full" : ""}>
      <div className="flex items-center gap-3 mb-6">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center">
          <Monitor size={18} className="text-indigo-600" />
        </div>
        <div>
          <h2 className="text-base font-semibold text-gray-900">Operations Monitor</h2>
          <p className="text-sm text-gray-500">
            A live read-only board for TV / big-screen display. No login required — access is controlled by the URL token.
          </p>
        </div>
      </div>

      {loading ? (
        <div className="h-32 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : !tokenData?.token ? (
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-8 text-center">
          <Monitor size={32} className="text-gray-300 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-4">No display URL has been generated yet.</p>
          <BtnPrimary onClick={generateFirst} disabled={rotating}>
            {rotating ? "Generating…" : "Generate Display URL"}
          </BtnPrimary>
        </div>
      ) : (
        <>
          {/* URL box */}
          <div className="bg-slate-900 rounded-2xl p-5 mb-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Display URL</span>
              {tokenData.rotated_at && (
                <span className="text-xs text-slate-600">
                  Generated {new Date(tokenData.rotated_at).toLocaleString("en-ZA")}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm text-green-400 font-mono break-all bg-slate-800 rounded-xl px-4 py-3 border border-slate-700">
                {monitorUrl}
              </code>
              <button
                onClick={copyUrl}
                className="flex items-center gap-1.5 px-4 py-3 rounded-xl bg-slate-700 hover:bg-slate-600 text-sm font-medium text-slate-200 transition-colors shrink-0"
              >
                {copied ? <CheckCircle size={14} className="text-green-400" /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-blue-50 rounded-xl border border-blue-100 px-5 py-4 mb-6 text-sm text-blue-800">
            <p className="font-semibold mb-1">How to use</p>
            <ul className="space-y-1 text-blue-700 list-disc list-inside">
              <li>Open the URL in a browser on any TV or display — no login needed.</li>
              <li>The screen refreshes automatically every 30 seconds.</li>
              <li>If you rotate the token, you must update the URL on all screens.</li>
            </ul>
          </div>

          {/* Danger zone */}
          <div className="border border-red-100 rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-red-800 mb-1">Rotate token</h3>
            <p className="text-sm text-gray-500 mb-4">
              Rotating invalidates the current URL immediately. Any screens using the old URL will stop working until updated.
            </p>
            <BtnSecondary
              onClick={() => setRotateConfirm(true)}
              disabled={rotating}
              className="flex items-center gap-2"
            >
              <RefreshCw size={14} className={rotating ? "animate-spin" : ""} />
              {rotating ? "Rotating…" : "Rotate token"}
            </BtnSecondary>
          </div>
        </>
      )}

      {rotateConfirm && (
        <Modal title="Rotate monitor token?" onClose={() => setRotateConfirm(false)}>
          <p className="text-sm text-gray-600 mb-1">
            The current display URL will stop working immediately.
          </p>
          <p className="text-sm text-gray-600 mb-5">
            You will need to update the URL on every screen or device that is currently using it.
          </p>
          <div className="flex justify-end gap-2">
            <BtnSecondary onClick={() => setRotateConfirm(false)}>Cancel</BtnSecondary>
            <BtnPrimary onClick={doRotate}>Rotate token</BtnPrimary>
          </div>
        </Modal>
      )}
    </div>
  );

  return embedded ? content : (
    <div className="flex-1 overflow-y-auto bg-gray-50">{content}</div>
  );
}
