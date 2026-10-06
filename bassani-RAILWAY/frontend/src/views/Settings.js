import { useSearchParams } from "react-router-dom";
import { TopBar } from "../components/UI";
import Warehouses from "./Warehouses";
import EmailSettings from "./EmailSettings";
import ConnectedMailboxes from "./ConnectedMailboxes";
import DocumentTemplates from "./DocumentTemplates";
import LabelPrinters from "./LabelPrinters";
import GTINPool from "./GTINPool";
import MonitorDisplaysSettings from "./MonitorDisplaysSettings";
import ExternalApiSettings from "./ExternalApiSettings";
import { useAuth } from "../AuthContext";

const TABS = [
  { key: "warehouses",       label: "Warehouses" },
  { key: "email-routing",    label: "Email Notifications" },
  { key: "mailboxes",        label: "Connected Mailboxes" },
  { key: "doc-templates",    label: "Document Templates" },
  { key: "label-printers",   label: "Label Printers" },
  { key: "gtin-pool",        label: "GTIN Pool" },
  { key: "monitor-displays", label: "Monitor Displays" },
  // Phase 14 — API keys + kill switch are super-admin only; online stores need
  // channels.manage. The tab shows for anyone who can use at least one part.
  { key: "external-api",     label: "External API", visible: (user, can) => user?.is_super_admin || can("channels.manage") },
];

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, can } = useAuth();
  const tabs = TABS.filter(t => !t.visible || t.visible(user, can));
  const rawTab = searchParams.get("tab") || "warehouses";
  // Old per-monitor tab keys (pre-2026-08-22 consolidation) still redirect
  // correctly rather than landing on a blank pane, in case a bookmark or a
  // stale link out there still points at one of them.
  const active = (rawTab === "monitor-display" || rawTab === "onboarding-monitor-display")
    ? "monitor-displays"
    : rawTab;

  const switchTab = (key) => setSearchParams({ tab: key }, { replace: true });

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Settings" subtitle="System configuration" />

      <div className="border-b border-gray-200 bg-white px-6 shrink-0">
        <div className="flex gap-1">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className={`px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                active === t.key
                  ? "border-bassani-600 text-bassani-700"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {active === "warehouses"       && <Warehouses embedded />}
      {active === "email-routing"    && <EmailSettings embedded />}
      {active === "mailboxes"        && <ConnectedMailboxes embedded />}
      {active === "doc-templates"    && <DocumentTemplates embedded />}
      {active === "label-printers"   && <LabelPrinters embedded />}
      {active === "gtin-pool"        && <GTINPool embedded />}
      {active === "monitor-displays" && <MonitorDisplaysSettings embedded />}
      {active === "external-api"     && tabs.some(t => t.key === "external-api") && <ExternalApiSettings />}
    </div>
  );
}
