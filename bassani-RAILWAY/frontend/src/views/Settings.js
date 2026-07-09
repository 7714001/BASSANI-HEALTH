import { useSearchParams } from "react-router-dom";
import { TopBar } from "../components/UI";
import Warehouses from "./Warehouses";
import EmailSettings from "./EmailSettings";
import ConnectedMailboxes from "./ConnectedMailboxes";
import DocumentTemplates from "./DocumentTemplates";

const TABS = [
  { key: "warehouses",    label: "Warehouses" },
  { key: "email-routing", label: "Email Routing" },
  { key: "mailboxes",     label: "Connected Mailboxes" },
  { key: "doc-templates", label: "Document Templates" },
];

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams();
  const active = searchParams.get("tab") || "warehouses";

  const switchTab = (key) => setSearchParams({ tab: key }, { replace: true });

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar title="Settings" subtitle="System configuration" />

      <div className="border-b border-gray-200 bg-white px-6 shrink-0">
        <div className="flex gap-1">
          {TABS.map(t => (
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

      {active === "warehouses"    && <Warehouses embedded />}
      {active === "email-routing" && <EmailSettings embedded />}
      {active === "mailboxes"     && <ConnectedMailboxes embedded />}
      {active === "doc-templates" && <DocumentTemplates embedded />}
    </div>
  );
}
