import { useState, useEffect } from "react";
import { Loader2, Save, Trash2, Wifi, WifiOff, AlertCircle, CheckCircle2, Building2, Server, MailX } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, Modal, BtnPrimary, BtnSecondary, BtnDanger, LoadingState } from "../components/UI";

// Quick-fill presets for IMAP (avoids making users look up server addresses)
const IMAP_PRESETS = [
  { label: "Custom / other",               value: "custom" },
  { label: "Xneelo — custom domain",       value: "xneelo_domain",
    imap_host: "mail.yourdomain.com",  imap_port: 993,
    smtp_host: "smtp.yourdomain.com",  smtp_port: 465 },
  { label: "Xneelo — shared hosting",      value: "xneelo",
    imap_host: "mail.xneelo.co.za",    imap_port: 993,
    smtp_host: "smtp.xneelo.co.za",    smtp_port: 465 },
  { label: "Microsoft 365 (IMAP/Basic Auth)", value: "m365",
    imap_host: "outlook.office365.com", imap_port: 993,
    smtp_host: "smtp.office365.com",    smtp_port: 587 },
  { label: "Gmail",                        value: "gmail",
    imap_host: "imap.gmail.com", imap_port: 993,
    smtp_host: "smtp.gmail.com", smtp_port: 587 },
];

const BLANK = {
  provider: "imap",
  imap_host: "", imap_port: 993, imap_username: "", imap_password: "",
  smtp_host: "", smtp_port: 587, smtp_username: "", smtp_password: "",
  mailbox_address: "",
  ms_tenant_id: "", ms_client_id: "", ms_client_secret: "", graph_mailbox_address: "",
};

const TABS = [
  { key: "sales",      label: "Sales Mailbox",      apiBase: "/api/settings/mailbox",            inboxName: "Sales Inbox",      placeholder: "orders@bassanihealth.com" },
  { key: "onboarding", label: "Onboarding Mailbox", apiBase: "/api/settings/onboarding-mailbox", inboxName: "Onboarding Inbox", placeholder: "onboarding@bassanihealth.com" },
  { key: "orders",     label: "Orders Mailbox",     apiBase: "/api/settings/orders-mailbox",     inboxName: "Orders Inbox",     placeholder: "orders-ops@bassanihealth.com" },
];

function Field({ label, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-700 mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">{hint}</p>}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", ...rest }) {
  return (
    <input
      type={type}
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 outline-none focus:border-bassani-400 focus:ring-2 focus:ring-bassani-100 placeholder-gray-400 bg-white transition-all"
      {...rest}
    />
  );
}

function NumInput({ value, onChange, ...rest }) {
  return (
    <input
      type="number"
      value={value}
      onChange={e => onChange(Number(e.target.value))}
      className="w-24 text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 outline-none focus:border-bassani-400 focus:ring-2 focus:ring-bassani-100 bg-white transition-all"
      {...rest}
    />
  );
}

function SectionCard({ title, description, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-50">
        <p className="text-sm font-bold text-gray-900">{title}</p>
        {description && <p className="text-xs text-gray-400 mt-0.5">{description}</p>}
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

function MailboxConfigPanel({ apiBase, inboxName, placeholder }) {
  const [loading,       setLoading      ] = useState(true);
  const [saving,        setSaving       ] = useState(false);
  const [testing,       setTesting      ] = useState(false);
  const [clearing,          setClearing         ] = useState(false);
  const [clearingInbox,     setClearingInbox     ] = useState(false);
  const [disconnectConfirm, setDisconnectConfirm] = useState(false);
  const [clearInboxConfirm, setClearInboxConfirm] = useState(false);
  const [testResult,    setTestResult   ] = useState(null);
  const [configured,    setConfigured   ] = useState(false);
  const [form,          setForm         ] = useState(BLANK);
  const [imapPreset,    setImapPreset   ] = useState("custom");

  useEffect(() => {
    setLoading(true);
    api.get(apiBase)
      .then(r => {
        setConfigured(r.data.configured || false);
        setForm(f => ({
          ...f,
          provider:             r.data.provider             || "imap",
          imap_host:            r.data.imap_host            || "",
          imap_port:            r.data.imap_port            || 993,
          imap_username:        r.data.imap_username         || "",
          smtp_host:            r.data.smtp_host            || "",
          smtp_port:            r.data.smtp_port            || 587,
          smtp_username:        r.data.smtp_username         || "",
          mailbox_address:      r.data.mailbox_address       || "",
          ms_tenant_id:         r.data.ms_tenant_id          || "",
          ms_client_id:         r.data.ms_client_id          || "",
          ms_client_secret:     r.data.ms_client_secret      || "",
          graph_mailbox_address: r.data.graph_mailbox_address || "",
          // passwords never returned — keep blank
          imap_password: "",
          smtp_password: "",
        }));
      })
      .catch(() => toast.error(`Failed to load ${inboxName} config`))
      .finally(() => setLoading(false));
  }, [apiBase, inboxName]);

  const upd = key => val => { setForm(f => ({ ...f, [key]: val })); setTestResult(null); };

  const setProvider = p => { setForm(f => ({ ...f, provider: p })); setTestResult(null); };

  const applyImapPreset = value => {
    setImapPreset(value);
    const p = IMAP_PRESETS.find(x => x.value === value);
    if (p && value !== "custom") {
      setForm(f => ({ ...f, imap_host: p.imap_host, imap_port: p.imap_port, smtp_host: p.smtp_host, smtp_port: p.smtp_port }));
    }
    setTestResult(null);
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post(`${apiBase}/test`, form);
      setTestResult({ ok: true, message: r.data.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.detail || "Connection failed" });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (form.provider === "graph") {
      if (!form.ms_tenant_id || !form.ms_client_id || !form.graph_mailbox_address) {
        toast.error("Tenant ID, Client ID, and Shared Mailbox Address are required");
        return;
      }
      if (!configured && !form.ms_client_secret) {
        toast.error("Client Secret is required for initial setup");
        return;
      }
    } else {
      if (!form.imap_host || !form.imap_username) {
        toast.error("IMAP host and username are required");
        return;
      }
      if (!configured && !form.imap_password) {
        toast.error("Password is required for initial setup");
        return;
      }
    }
    setSaving(true);
    try {
      await api.put(apiBase, form);
      setConfigured(true);
      toast.success(`${inboxName} connected successfully`);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const clear = () => setDisconnectConfirm(true);

  const doClear = async () => {
    setDisconnectConfirm(false);
    setClearing(true);
    try {
      await api.delete(apiBase);
      setConfigured(false);
      setForm(BLANK);
      setImapPreset("custom");
      setTestResult(null);
      toast.success("Mailbox disconnected");
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setClearing(false);
    }
  };

  const clearInbox = () => setClearInboxConfirm(true);

  const doClearInbox = async () => {
    setClearInboxConfirm(false);
    setClearingInbox(true);
    try {
      const r = await api.delete(`${apiBase}/clear-inbox`);
      toast.success(`${inboxName} cleared — ${r.data.deleted} message${r.data.deleted === 1 ? "" : "s"} removed`);
    } catch {
      toast.error("Failed to clear inbox");
    } finally {
      setClearingInbox(false);
    }
  };

  if (loading) return <LoadingState />;

  const isGraph = form.provider === "graph";

  return (
    <div className="p-6 bg-gray-50 min-h-full">
      <div className="max-w-4xl mx-auto w-full space-y-5">

        {/* Action row */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-semibold ${
            configured ? "bg-green-50 border-green-200 text-green-700" : "bg-amber-50 border-amber-200 text-amber-700"
          }`}>
            {configured ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {configured ? "Connected" : "Not configured"}
          </div>
          <div className="flex items-center gap-2">
            {configured && (
              <>
                <BtnSecondary onClick={clearInbox} disabled={clearingInbox} title="Remove all messages from this inbox">
                  {clearingInbox ? <Loader2 size={13} className="animate-spin" /> : <MailX size={13} />}
                  Clear Inbox
                </BtnSecondary>
                <BtnSecondary onClick={clear} disabled={clearing}>
                  {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  Disconnect
                </BtnSecondary>
              </>
            )}
            <BtnSecondary onClick={test} disabled={testing || saving}>
              {testing ? <Loader2 size={13} className="animate-spin" /> : <Wifi size={13} />}
              Test Connection
            </BtnSecondary>
            <BtnPrimary onClick={save} disabled={saving || testing}>
              {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
              Save
            </BtnPrimary>
          </div>
        </div>

        {/* Status banner */}
        <div className={`rounded-2xl px-5 py-4 border flex items-start gap-3 ${
          configured ? "bg-green-50 border-green-200" : "bg-amber-50 border-amber-200"
        }`}>
          {configured
            ? <CheckCircle2 size={16} className="text-green-500 mt-0.5 shrink-0" />
            : <AlertCircle  size={16} className="text-amber-500 mt-0.5 shrink-0" />}
          <div>
            <p className={`text-xs font-semibold ${configured ? "text-green-700" : "text-amber-700"}`}>
              {configured ? `${inboxName} mailbox connected` : `No ${inboxName} mailbox configured`}
            </p>
            <p className={`text-xs mt-0.5 leading-relaxed ${configured ? "text-green-600" : "text-amber-600"}`}>
              {configured
                ? isGraph
                  ? `Emails from ${form.graph_mailbox_address} are pulled via Microsoft Graph API every 60 seconds.`
                  : `Emails from ${form.imap_username || "the mailbox"} are pulled via IMAP every 60 seconds.`
                : `Connect a mailbox below to enable the ${inboxName}.`}
            </p>
          </div>
        </div>

        {/* Test result */}
        {testResult && (
          <div className={`rounded-2xl px-5 py-3.5 border flex items-start gap-3 ${
            testResult.ok ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200"
          }`}>
            {testResult.ok
              ? <CheckCircle2 size={15} className="text-green-500 mt-0.5 shrink-0" />
              : <WifiOff      size={15} className="text-red-500  mt-0.5 shrink-0" />}
            <p className={`text-xs leading-relaxed ${testResult.ok ? "text-green-700" : "text-red-700"}`}>
              {testResult.message}
            </p>
          </div>
        )}

        {/* Provider toggle */}
        <SectionCard title="Connection type" description="Choose how this mailbox connects to the portal.">
          <div className="grid grid-cols-2 gap-3">
            {[
              { value: "graph", label: "Office 365", sub: "Microsoft Graph API (recommended)", Icon: Building2 },
              { value: "imap",  label: "IMAP",        sub: "Standard IMAP / SMTP",              Icon: Server   },
            ].map(({ value, label, sub, Icon }) => (
              <button
                key={value}
                onClick={() => setProvider(value)}
                className={`flex items-start gap-3 px-4 py-3.5 rounded-xl border-2 text-left transition-all ${
                  form.provider === value
                    ? "border-bassani-500 bg-bassani-50"
                    : "border-gray-200 bg-white hover:border-gray-300"
                }`}
              >
                <Icon size={18} className={form.provider === value ? "text-bassani-600 mt-0.5 shrink-0" : "text-gray-400 mt-0.5 shrink-0"} />
                <div>
                  <p className={`text-sm font-semibold ${form.provider === value ? "text-bassani-700" : "text-gray-700"}`}>{label}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5 leading-snug">{sub}</p>
                </div>
              </button>
            ))}
          </div>
        </SectionCard>

        {/* Office 365 / Graph form */}
        {isGraph && (
          <SectionCard
            title="Microsoft 365 Credentials"
            description="Azure app registration with Mail.Read, Mail.ReadWrite, and Mail.Send application permissions."
          >
            <Field label="Tenant ID" hint="Found in Azure Portal → Azure Active Directory → Overview.">
              <TextInput value={form.ms_tenant_id} onChange={upd("ms_tenant_id")} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </Field>
            <Field label="Application (Client) ID" hint="Found in Azure Portal → App registrations → your app → Overview.">
              <TextInput value={form.ms_client_id} onChange={upd("ms_client_id")} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
            </Field>
            <Field
              label="Client Secret"
              hint={configured ? "Leave blank to keep the existing secret." : "Found in Azure Portal → App registrations → your app → Certificates & secrets."}
            >
              <TextInput
                type="password"
                value={form.ms_client_secret}
                onChange={upd("ms_client_secret")}
                placeholder={configured ? "••••••••  (unchanged)" : "Paste client secret value"}
                autoComplete="new-password"
              />
            </Field>
            <Field label="Shared Mailbox Address" hint="The email address of the shared mailbox this inbox monitors (e.g. orders@bassanihealth.com).">
              <TextInput value={form.graph_mailbox_address} onChange={upd("graph_mailbox_address")} placeholder={placeholder} />
            </Field>
          </SectionCard>
        )}

        {/* IMAP form */}
        {!isGraph && (
          <>
            <SectionCard title="Incoming Mail (IMAP)" description="The portal polls this mailbox every 60 seconds for new messages.">
              <Field label="Quick setup">
                <select
                  value={imapPreset}
                  onChange={e => applyImapPreset(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 outline-none focus:border-bassani-400 focus:ring-2 focus:ring-bassani-100 bg-white"
                >
                  {IMAP_PRESETS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </Field>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="IMAP host">
                    <TextInput value={form.imap_host} onChange={upd("imap_host")} placeholder="mail.example.com" />
                  </Field>
                </div>
                <Field label="Port">
                  <NumInput value={form.imap_port} onChange={upd("imap_port")} min={1} max={65535} />
                </Field>
              </div>
              <Field label="Username" hint="Usually the full email address of the mailbox.">
                <TextInput value={form.imap_username} onChange={upd("imap_username")} placeholder={placeholder} />
              </Field>
              <Field label="Password" hint={configured ? "Leave blank to keep the existing password." : ""}>
                <TextInput
                  type="password"
                  value={form.imap_password}
                  onChange={upd("imap_password")}
                  placeholder={configured ? "••••••••  (unchanged)" : "Enter password"}
                  autoComplete="new-password"
                />
              </Field>
            </SectionCard>

            <SectionCard title="Outgoing Mail (SMTP)" description="Used to send replies and outgoing threads.">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="SMTP host" hint="Leave blank to use the IMAP host.">
                    <TextInput value={form.smtp_host} onChange={upd("smtp_host")} placeholder="smtp.example.com (optional)" />
                  </Field>
                </div>
                <Field label="Port">
                  <NumInput value={form.smtp_port} onChange={upd("smtp_port")} min={1} max={65535} />
                </Field>
              </div>
              <Field label="Username" hint="Leave blank to use the IMAP username.">
                <TextInput value={form.smtp_username} onChange={upd("smtp_username")} placeholder="Same as IMAP username (optional)" />
              </Field>
              <Field label="Password" hint="Leave blank to use the IMAP password.">
                <TextInput type="password" value={form.smtp_password} onChange={upd("smtp_password")} placeholder="Same as IMAP password (optional)" autoComplete="new-password" />
              </Field>
            </SectionCard>

            <SectionCard title="Display Address" description="The From address shown to recipients.">
              <Field label="Mailbox display address" hint="Leave blank to use the IMAP username.">
                <TextInput value={form.mailbox_address} onChange={upd("mailbox_address")} placeholder={`${placeholder} (optional)`} />
              </Field>
            </SectionCard>
          </>
        )}

      </div>
      {disconnectConfirm && (
        <Modal title="Disconnect Mailbox" onClose={() => setDisconnectConfirm(false)}>
          <p className="text-sm text-gray-600">Disconnect the {inboxName}? It will stop receiving emails until reconnected.</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setDisconnectConfirm(false)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doClear}>Disconnect</BtnDanger>
          </div>
        </Modal>
      )}
      {clearInboxConfirm && (
        <Modal title="Clear Inbox" onClose={() => setClearInboxConfirm(false)}>
          <p className="text-sm text-gray-600">Clear all messages from the {inboxName}? This cannot be undone.</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setClearInboxConfirm(false)}>Cancel</BtnSecondary>
            <BtnDanger onClick={doClearInbox}>Clear Inbox</BtnDanger>
          </div>
        </Modal>
      )}
    </div>
  );
}

export default function ConnectedMailboxes({ embedded = false }) {
  const [active, setActive] = useState("sales");
  const tab = TABS.find(t => t.key === active);

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {!embedded && (
        <TopBar
          title="Connected Mailboxes"
          subtitle="Configure the mailboxes the portal monitors for incoming email"
        />
      )}

      <div className="border-b border-gray-200 bg-white px-6 shrink-0">
        <div className="flex gap-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setActive(t.key)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
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

      <div className="flex-1 overflow-y-auto">
        <MailboxConfigPanel
          key={active}
          apiBase={tab.apiBase}
          inboxName={tab.inboxName}
          placeholder={tab.placeholder}
        />
      </div>
    </div>
  );
}
