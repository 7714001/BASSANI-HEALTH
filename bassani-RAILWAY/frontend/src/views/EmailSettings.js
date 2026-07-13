import { useState, useEffect, useRef } from "react";
import { Plus, X, Loader2, Mail, Save } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, BtnPrimary, LoadingState } from "../components/UI";

// ── Email tag input ────────────────────────────────────────────────────────────

function EmailTagInput({ emails, onChange, placeholder = "Add email address…" }) {
  const [input, setInput] = useState("");
  const inputRef = useRef(null);

  const add = () => {
    const val = input.trim().toLowerCase();
    if (!val) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      toast.error(`"${val}" is not a valid email address`);
      return;
    }
    if (emails.includes(val)) {
      toast.error("That address is already in the list");
      return;
    }
    onChange([...emails, val]);
    setInput("");
  };

  const remove = (email) => onChange(emails.filter(e => e !== email));

  return (
    <div
      className="min-h-[42px] flex flex-wrap gap-1.5 p-2 border border-gray-200 rounded-xl bg-white cursor-text"
      onClick={() => inputRef.current?.focus()}
    >
      {emails.map(email => (
        <span key={email}
          className="inline-flex items-center gap-1.5 bg-bassani-50 text-bassani-700 border border-bassani-200 text-xs font-semibold px-2.5 py-1 rounded-full">
          {email}
          <button onClick={() => remove(email)} className="text-bassani-400 hover:text-bassani-700 transition-colors">
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        type="email"
        value={input}
        onChange={e => setInput(e.target.value)}
        onKeyDown={e => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); }
          if (e.key === "Backspace" && !input && emails.length) remove(emails[emails.length - 1]);
        }}
        onBlur={add}
        placeholder={emails.length ? "" : placeholder}
        className="flex-1 min-w-[180px] text-sm outline-none bg-transparent placeholder-gray-400 py-0.5"
      />
    </div>
  );
}

// ── Section card ───────────────────────────────────────────────────────────────

function RoutingSection({ icon: Icon, title, description, note, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-bassani-50 flex items-center justify-center shrink-0">
          <Icon size={15} className="text-bassani-600" />
        </div>
        <div>
          <p className="text-sm font-bold text-gray-900">{title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
      </div>
      <div className="px-6 py-5 space-y-3">
        {children}
        {note && (
          <p className="text-[11px] text-gray-400 leading-relaxed">{note}</p>
        )}
      </div>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function EmailSettings({ embedded = false }) {
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving ] = useState(false);
  const [config,  setConfig ] = useState({
    application_submitted_to: [],
    countersign_complete_to:  [],
    order_ready_extra_to:     [],
    order_cc:                 [],
    finance_notification_to:  [],
  });

  useEffect(() => {
    api.get("/api/settings/email-routing")
      .then(r => setConfig(r.data))
      .catch(() => toast.error("Failed to load email routing config"))
      .finally(() => setLoading(false));
  }, []);

  const upd = (key) => (val) => setConfig(c => ({ ...c, [key]: val }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/api/settings/email-routing", config);
      toast.success("Email routing saved");
    } catch {
      toast.error("Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {!embedded && (
        <TopBar
          title="Email Notifications"
          subtitle="Configure who receives automated notifications"
          actions={
            <BtnPrimary onClick={save} disabled={saving}>
              {saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Save size={13} className="mr-1.5" />}
              Save Changes
            </BtnPrimary>
          }
        />
      )}

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-4xl mx-auto w-full space-y-5">

          <div className="bg-amber-50 border border-amber-200 rounded-2xl px-5 py-4">
            <p className="text-xs font-semibold text-amber-700 mb-1">Super Admin only</p>
            <p className="text-xs text-amber-600 leading-relaxed">
              Changes to email routing take effect immediately for all future notifications.
              Enter addresses then press Enter or comma to add. Click the tag to remove.
            </p>
          </div>

          <RoutingSection
            icon={Mail}
            title="New Customer Application"
            description="Triggered when a reseller submits an onboarding application."
            note="If this list is empty, the notification falls back to the support email set in Railway environment variables."
          >
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Notify these addresses:</p>
              <EmailTagInput
                emails={config.application_submitted_to}
                onChange={upd("application_submitted_to")}
                placeholder="support@bassanihealth.com"
              />
            </div>
          </RoutingSection>

          <RoutingSection
            icon={Mail}
            title="Onboarding: Documents Countersigned"
            description="Triggered when all customer onboarding documents have been countersigned. Use this to notify Dean and Kashi so the welcome pack can be sent."
            note="If this list is empty, no notification is sent."
          >
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Notify these addresses:</p>
              <EmailTagInput
                emails={config.countersign_complete_to}
                onChange={upd("countersign_complete_to")}
                placeholder="dean@bassanihealth.com"
              />
            </div>
          </RoutingSection>

          <RoutingSection
            icon={Mail}
            title="Order Ready for Collection"
            description="Triggered when an order passes QA and RP review and is cleared for dispatch."
            note="Warehouse supervisors with a registered portal account are always notified automatically. Add addresses here for distribution lists or staff without portal accounts."
          >
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Additional recipients (added to supervisor list):</p>
              <EmailTagInput
                emails={config.order_ready_extra_to}
                onChange={upd("order_ready_extra_to")}
                placeholder="warehouse@bassanihealth.com"
              />
            </div>
          </RoutingSection>

          <RoutingSection
            icon={Mail}
            title="Order CC"
            description="CC'd on order placed and order confirmed emails sent to resellers."
            note="Useful for an operations inbox or account management team that needs visibility on all reseller orders without managing individual notifications."
          >
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">CC these addresses on reseller order emails:</p>
              <EmailTagInput
                emails={config.order_cc}
                onChange={upd("order_cc")}
                placeholder="ops@bassanihealth.com"
              />
            </div>
          </RoutingSection>

          <RoutingSection
            icon={Mail}
            title="Finance: Payment Auto-Confirmed"
            description="Sent when the portal detects a paid invoice from bank records and auto-confirms the ticket — no manual click needed."
            note="Add the Finance team addresses here. A single digest email is sent per check cycle listing all auto-confirmed invoices. If this list is empty, no email is sent but the ticket still advances automatically."
          >
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Notify these addresses:</p>
              <EmailTagInput
                emails={config.finance_notification_to}
                onChange={upd("finance_notification_to")}
                placeholder="finance@bassanihealth.com"
              />
            </div>
          </RoutingSection>

          {embedded && (
            <div className="flex justify-end pt-2">
              <BtnPrimary onClick={save} disabled={saving}>
                {saving ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <Save size={13} className="mr-1.5" />}
                Save Changes
              </BtnPrimary>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
