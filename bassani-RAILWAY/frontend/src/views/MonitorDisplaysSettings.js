// Settings tab for every big-screen TV display's URL/token (2026-08-22) —
// consolidated from two separate tabs (MonitorSettings.js/
// OnboardingMonitorSettings.js) into one, now that a second monitor exists
// and more are planned. Each monitor still has its own independent token
// and backend endpoints (monitor_routes.py, onboarding_monitor_routes.py,
// ...) — this file only merges the admin-facing management UI, driven by
// the MONITORS config array below. Adding a future monitor (e.g. a
// Manufacturing Orders / Backorders board) is one new array entry, not a
// new tab or a new settings file.
import { useState, useEffect } from "react";
import { Monitor, ClipboardCheck, Copy, RefreshCw, CheckCircle } from "lucide-react";
import { BtnPrimary, BtnSecondary, Modal } from "../components/UI";
import api from "../api";
import toast from "react-hot-toast";

const MONITORS = [
  {
    key: "operations",
    label: "Operations Monitor",
    description: "A live, read-only board of the full order pipeline. No login required — access is controlled by the URL token.",
    icon: Monitor,
    tokenPath: "/api/monitor/token",
    displayPath: "/monitor",
  },
  {
    key: "onboarding",
    label: "Onboarding Monitor",
    description: "A live, read-only board of the customer onboarding pipeline. No login required — access is controlled by the URL token.",
    icon: ClipboardCheck,
    tokenPath: "/api/onboarding-monitor/token",
    displayPath: "/onboarding-monitor",
  },
];

function MonitorDisplayCard({ config }) {
  const { label, description, icon: Icon, tokenPath, displayPath } = config;
  const [tokenData,     setTokenData    ] = useState(null);
  const [loading,       setLoading      ] = useState(true);
  const [rotating,      setRotating     ] = useState(false);
  const [rotateConfirm, setRotateConfirm] = useState(false);
  const [copied,        setCopied       ] = useState(false);

  const load = async () => {
    try {
      const { data } = await api.get(tokenPath);
      setTokenData(data);
    } catch {
      toast.error(`Failed to load ${label} token`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []); // eslint-disable-line

  const displayUrl = tokenData?.token
    ? `${window.location.origin}${displayPath}?token=${tokenData.token}`
    : null;

  const copyUrl = async () => {
    if (!displayUrl) return;
    await navigator.clipboard.writeText(displayUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doRotate = async () => {
    setRotateConfirm(false);
    setRotating(true);
    try {
      await api.post(tokenPath);
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
      await api.post(tokenPath);
      await load();
      toast.success(`${label} URL generated.`);
    } catch {
      toast.error("Failed to generate token");
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex items-center gap-3 mb-5">
        <div className="w-9 h-9 rounded-xl bg-indigo-50 flex items-center justify-center shrink-0">
          <Icon size={18} className="text-indigo-600" />
        </div>
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{label}</h3>
          <p className="text-xs text-gray-500">{description}</p>
        </div>
      </div>

      {loading ? (
        <div className="h-24 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : !tokenData?.token ? (
        <div className="bg-gray-50 rounded-2xl border border-gray-200 p-6 text-center">
          <p className="text-sm text-gray-500 mb-4">No display URL has been generated yet.</p>
          <BtnPrimary onClick={generateFirst} disabled={rotating}>
            {rotating ? "Generating…" : "Generate Display URL"}
          </BtnPrimary>
        </div>
      ) : (
        <>
          <div className="bg-slate-900 rounded-2xl p-5 mb-3">
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
                {displayUrl}
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

          <div className="flex items-center justify-between gap-3 border border-red-100 rounded-xl px-4 py-3">
            <p className="text-xs text-gray-500">
              Rotating invalidates the current URL immediately — any screens using it will stop working until updated.
            </p>
            <BtnSecondary
              onClick={() => setRotateConfirm(true)}
              disabled={rotating}
              className="flex items-center gap-2 shrink-0"
            >
              <RefreshCw size={13} className={rotating ? "animate-spin" : ""} />
              {rotating ? "Rotating…" : "Rotate token"}
            </BtnSecondary>
          </div>
        </>
      )}

      {rotateConfirm && (
        <Modal title={`Rotate ${label} token?`} onClose={() => setRotateConfirm(false)}>
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
}

export default function MonitorDisplaysSettings({ embedded }) {
  const content = (
    <div className={embedded ? "p-6 max-w-4xl mx-auto w-full space-y-6" : "space-y-6"}>
      <div>
        <h2 className="text-base font-semibold text-gray-900">Monitor Displays</h2>
        <p className="text-sm text-gray-500 mt-0.5">
          Live, read-only big-screen boards for TV/display use — one URL and token per board below, managed independently. Open a URL in a browser on any TV or display; no login is needed, and each screen refreshes itself automatically.
        </p>
      </div>
      {MONITORS.map(m => <MonitorDisplayCard key={m.key} config={m} />)}
    </div>
  );

  return embedded ? content : (
    <div className="flex-1 overflow-y-auto bg-gray-50">{content}</div>
  );
}
