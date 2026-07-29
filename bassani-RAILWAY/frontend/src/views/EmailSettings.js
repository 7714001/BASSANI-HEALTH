import { useState, useEffect, useRef } from "react";
import { X, Loader2, Mail, Save, FileText, Truck, DollarSign, Package, Send } from "lucide-react";
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

function RoutingSection({ icon: Icon, title, description, note, headerAction, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-bassani-50 flex items-center justify-center shrink-0">
          <Icon size={15} className="text-bassani-600" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold text-gray-900">{title}</p>
          <p className="text-xs text-gray-400 mt-0.5">{description}</p>
        </div>
        {headerAction}
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

// ── Send Test button ──────────────────────────────────────────────────────────
// Fires the real template with fabricated dummy data at whatever address is
// currently in the shared test-email field, so an admin can see exactly what a
// notification looks like without waiting for its real trigger event.

function SendTestButton({ testEmail, sending, onSend }) {
  return (
    <button
      onClick={onSend}
      disabled={sending || !testEmail}
      title={testEmail ? `Send a test to ${testEmail}` : "Enter a test email address above first"}
      className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-bassani-700 bg-bassani-50 hover:bg-bassani-100 disabled:opacity-40 disabled:cursor-not-allowed rounded-lg transition-colors"
    >
      {sending ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
      Send Test
    </button>
  );
}

// ── Routing key metadata ─────────────────────────────────────────────────────
// One entry per notification. Adding a new notification type is one entry
// here (plus a field on the backend's EmailRoutingConfig) — never a new
// hand-written <RoutingSection> block.

const GROUPS = [
  { id: "onboarding", label: "Onboarding & Applications", icon: FileText },
  { id: "orders",     label: "Orders & Fulfilment",       icon: Truck },
  { id: "finance",    label: "Finance",                   icon: DollarSign },
  { id: "production", label: "Production & Vault",        icon: Package },
];

const ROUTING_KEYS = [
  {
    key: "application_submitted_to", group: "onboarding", icon: Mail,
    title: "New Customer Application",
    description: "Triggered when a reseller submits an onboarding application.",
    note: "If this list is empty, the notification falls back to the support email set in Railway environment variables.",
    placeholder: "support@bassanihealth.com",
  },
  {
    key: "application_escalation_to", group: "onboarding", icon: Mail,
    title: "Application Stalled (4+ Hours)",
    description: "Triggered when a submitted application has gone 4+ hours without its signing documents being generated — a safety net so nothing gets forgotten.",
    note: "Checked every 30 minutes. Each stalled application is escalated once. If this list is empty, no notification is sent.",
    placeholder: "ops@bassanihealth.com",
  },
  {
    key: "countersign_needed_to", group: "onboarding", icon: Mail,
    title: "Countersigning Needed",
    description: "Triggered once a customer has submitted signed copies of both onboarding documents and they are ready for a Bassani signing authority to countersign.",
    note: "If this list is empty, no notification is sent.",
    placeholder: "kashi@bassanihealth.com",
  },
  {
    key: "countersign_complete_to", group: "onboarding", icon: Mail,
    title: "Onboarding: Documents Countersigned",
    description: "Triggered when all customer onboarding documents have been countersigned. Use this to notify Dean and Kashi so the welcome pack can be sent.",
    note: "If this list is empty, no notification is sent.",
    placeholder: "dean@bassanihealth.com",
  },
  {
    key: "qa_approval_to", group: "orders", icon: Mail,
    title: "QA Approval Needed",
    description: "Triggered when an order is packed and ready for QA inspection.",
    note: "If this list is empty, no notification is sent. Typically the QA manager.",
    placeholder: "qa@bassanihealth.com",
  },
  {
    key: "rp_approval_to", group: "orders", icon: Mail,
    title: "RP Approval Needed",
    description: "Triggered when an order is packed and ready for Responsible Pharmacist inspection.",
    note: "If this list is empty, no notification is sent. Typically the Responsible Pharmacist.",
    placeholder: "rp@bassanihealth.com",
  },
  {
    key: "qa_rp_daily_digest_to", group: "orders", icon: Mail,
    title: "Daily Digest: Outstanding Inspections",
    description: "Sent automatically at 17:00 each day, listing every order still awaiting QA or RP sign-off that didn't get looked at.",
    note: "If this list is empty, no digest is sent. A digest only sends when there is at least one outstanding order.",
    placeholder: "qa@bassanihealth.com",
  },
  {
    key: "order_ready_extra_to", group: "orders", icon: Mail,
    title: "Order Ready for Collection",
    description: "Triggered when an order passes QA and RP review and is cleared for dispatch.",
    note: "Warehouse supervisors with a registered portal account are always notified automatically. Add addresses here for distribution lists or staff without portal accounts.",
    placeholder: "warehouse@bassanihealth.com",
    label: "Additional recipients (added to supervisor list):",
  },
  {
    key: "order_cc", group: "orders", icon: Mail,
    title: "Order CC",
    description: "CC'd on order placed and order confirmed emails sent to resellers.",
    note: "Useful for an operations inbox or account management team that needs visibility on all reseller orders without managing individual notifications.",
    placeholder: "ops@bassanihealth.com",
    label: "CC these addresses on reseller order emails:",
  },
  {
    key: "backorder_daily_digest_to", group: "orders", icon: Mail,
    title: "Daily Digest: Backorders",
    description: "Sent automatically at 17:00 each day, listing every order currently waiting on stock.",
    note: "If this list is empty, no digest is sent. A digest only sends when there is at least one order on backorder.",
    placeholder: "ops@bassanihealth.com",
  },
  {
    key: "recurring_order_upcoming", group: "orders", icon: Mail, previewOnly: true,
    title: "Recurring Order: Upcoming (Customer Notice)",
    description: "Sent 2 days before each recurring order occurrence, directly to the customer on file — asking them to review and accept or decline.",
    note: "This one always goes straight to the customer, not a configurable staff list — there's nothing to save here, but you can still send a preview to see exactly what the customer receives.",
  },
  {
    key: "recurring_order_accepted_to", group: "orders", icon: Mail,
    title: "Recurring Order: Accepted",
    description: "Triggered when a customer accepts an upcoming recurring order occurrence — it has auto-confirmed and is now awaiting a registered deposit.",
    note: "If this list is empty, no notification is sent.",
    placeholder: "sales@bassanihealth.com",
  },
  {
    key: "recurring_order_needs_confirm_to", group: "orders", icon: Mail,
    title: "Recurring Order: Needs Manual Confirmation",
    description: "Triggered when a customer accepts an upcoming recurring order occurrence but it could not auto-confirm (e.g. the customer is over their credit limit) — a staff member needs to review and confirm manually.",
    note: "If this list is empty, no notification is sent. Consider routing this to whoever handles credit limit overrides, since it's more urgent than a plain acceptance.",
    placeholder: "finance@bassanihealth.com",
  },
  {
    key: "recurring_order_declined_to", group: "orders", icon: Mail,
    title: "Recurring Order: Declined",
    description: "Triggered when a customer declines an upcoming recurring order occurrence. No action is required — the schedule continues from the next date.",
    note: "If this list is empty, no notification is sent.",
    placeholder: "sales@bassanihealth.com",
  },
  {
    key: "recurring_order_skipped_to", group: "orders", icon: Mail,
    title: "Recurring Order: Skipped (No Response)",
    description: "Triggered when a recurring order occurrence expires with no customer response. The draft order is cancelled and the schedule continues from the next date.",
    note: "If this list is empty, no notification is sent.",
    placeholder: "sales@bassanihealth.com",
  },
  {
    key: "finance_notification_to", group: "finance", icon: Mail,
    title: "Finance: Payment Auto-Confirmed",
    description: "Sent when the portal detects a paid invoice from bank records and auto-confirms the ticket — no manual click needed.",
    note: "Add the Finance team addresses here. A single digest email is sent per check cycle listing all auto-confirmed invoices. If this list is empty, no email is sent but the ticket still advances automatically.",
    placeholder: "finance@bassanihealth.com",
  },
  {
    key: "s6_flag_to", group: "production", icon: Mail,
    title: "Production: Stock Received Without Purchase Order",
    description: "Triggered when imported stock is recorded on the S6 receiving register with no matching purchase order. The batch is held until the flag is investigated and resolved.",
    note: "If this list is empty, no notification is sent. Typically the compliance officer.",
    placeholder: "compliance@bassanihealth.com",
  },
];

// previewOnly keys (e.g. recurring_order_upcoming) have no configurable recipient
// list — they always go straight to a specific person on the relevant record — so
// they're excluded from the saved EmailRoutingConfig entirely.
const BLANK_CONFIG = ROUTING_KEYS.filter(rk => !rk.previewOnly).reduce((acc, rk) => ({ ...acc, [rk.key]: [] }), {});

// ── Main component ─────────────────────────────────────────────────────────────

export default function EmailSettings({ embedded = false }) {
  const [loading,     setLoading    ] = useState(true);
  const [saving,      setSaving     ] = useState(false);
  const [config,      setConfig     ] = useState(BLANK_CONFIG);
  const [activeGroup, setActiveGroup] = useState(GROUPS[0].id);
  const [testEmail,   setTestEmail  ] = useState("");
  const [sendingKey,  setSendingKey ] = useState(null); // routing key currently sending, or null

  useEffect(() => {
    api.get("/api/settings/email-routing")
      .then(r => setConfig({ ...BLANK_CONFIG, ...r.data }))
      .catch(() => toast.error("Failed to load email routing config"))
      .finally(() => setLoading(false));
  }, []);

  const upd = (key) => (val) => setConfig(c => ({ ...c, [key]: val }));

  const sendTest = async (key) => {
    if (!testEmail) return;
    setSendingKey(key);
    try {
      await api.post("/api/settings/email-routing/test", { key, to: testEmail });
      toast.success(`Test email sent to ${testEmail}`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send test email");
    } finally {
      setSendingKey(null);
    }
  };

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

  const visibleKeys = ROUTING_KEYS.filter(rk => rk.group === activeGroup);

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
        <div className="max-w-5xl mx-auto w-full space-y-5">

          <div className="bg-white rounded-2xl border border-gray-100 px-5 py-4 flex items-center gap-3 flex-wrap">
            <Send size={15} className="text-bassani-500 shrink-0" />
            <div className="flex-1 min-w-[220px]">
              <p className="text-xs font-semibold text-gray-700">Test email address</p>
              <p className="text-[11px] text-gray-400">Enter an address, then click Send Test on any notification below to preview it with sample data.</p>
            </div>
            <input
              type="email"
              value={testEmail}
              onChange={e => setTestEmail(e.target.value)}
              placeholder="you@bassanihealth.com"
              className="w-64 px-3 py-2 text-sm border border-gray-200 rounded-xl outline-none focus:border-bassani-400"
            />
          </div>

          <div className="flex gap-5 items-start">
            <nav className="w-56 shrink-0 bg-white rounded-2xl border border-gray-100 p-2 space-y-1">
              {GROUPS.map(g => {
                const Icon = g.icon;
                const active = g.id === activeGroup;
                const count = ROUTING_KEYS.filter(rk => rk.group === g.id).length;
                return (
                  <button
                    key={g.id}
                    onClick={() => setActiveGroup(g.id)}
                    className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left text-sm font-semibold transition-colors ${
                      active ? "bg-bassani-50 text-bassani-700" : "text-gray-500 hover:bg-gray-50"
                    }`}
                  >
                    <Icon size={15} className={active ? "text-bassani-600" : "text-gray-400"} />
                    <span className="flex-1">{g.label}</span>
                    <span className={`text-[10px] font-bold rounded-full px-1.5 py-0.5 ${active ? "bg-bassani-100 text-bassani-700" : "bg-gray-100 text-gray-400"}`}>
                      {count}
                    </span>
                  </button>
                );
              })}
            </nav>

            <div className="flex-1 min-w-0 space-y-5">
              {visibleKeys.map(rk => (
                <RoutingSection
                  key={rk.key} icon={rk.icon} title={rk.title} description={rk.description} note={rk.note}
                  headerAction={
                    <SendTestButton
                      testEmail={testEmail}
                      sending={sendingKey === rk.key}
                      onSend={() => sendTest(rk.key)}
                    />
                  }
                >
                  {!rk.previewOnly && (
                    <div>
                      <p className="text-xs font-semibold text-gray-600 mb-2">{rk.label || "Notify these addresses:"}</p>
                      <EmailTagInput
                        emails={config[rk.key] || []}
                        onChange={upd(rk.key)}
                        placeholder={rk.placeholder}
                      />
                    </div>
                  )}
                </RoutingSection>
              ))}
            </div>
          </div>

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
