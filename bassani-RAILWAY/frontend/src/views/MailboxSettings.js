import { useState, useEffect } from "react";
import { Loader2, Save, Trash2, Wifi, WifiOff, AlertCircle, CheckCircle2, ChevronDown } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar, BtnPrimary, BtnSecondary, LoadingState } from "../components/UI";

const PROVIDERS = [
  { label: "Select provider…", value: "" },
  { label: "Xneelo – custom domain (mail.yourdomain.com)", value: "xneelo_domain",
    imap_host: "mail.yourdomain.com", imap_port: 993,
    smtp_host: "smtp.yourdomain.com", smtp_port: 465 },
  { label: "Xneelo – shared hosting (mail.xneelo.co.za)", value: "xneelo",
    imap_host: "mail.xneelo.co.za",   imap_port: 993,
    smtp_host: "smtp.xneelo.co.za",   smtp_port: 465 },
  { label: "Microsoft 365 (outlook.office365.com)", value: "m365",
    imap_host: "outlook.office365.com", imap_port: 993,
    smtp_host: "smtp.office365.com",   smtp_port: 587 },
  { label: "Gmail (imap.gmail.com)", value: "gmail",
    imap_host: "imap.gmail.com", imap_port: 993,
    smtp_host: "smtp.gmail.com",  smtp_port: 587 },
  { label: "Custom", value: "custom" },
];

const BLANK = {
  imap_host: "", imap_port: 993, imap_username: "", imap_password: "",
  smtp_host: "", smtp_port: 587, smtp_username: "", smtp_password: "",
  mailbox_address: "",
};

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
        <p className="text-xs text-gray-400 mt-0.5">{description}</p>
      </div>
      <div className="px-6 py-5 space-y-4">{children}</div>
    </div>
  );
}

export default function MailboxSettings() {
  const [loading,  setLoading ] = useState(true);
  const [saving,   setSaving  ] = useState(false);
  const [testing,  setTesting ] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [testResult, setTestResult] = useState(null); // null | { ok, message }
  const [configured, setConfigured] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [provider, setProvider] = useState("");

  useEffect(() => {
    api.get("/api/settings/mailbox")
      .then(r => {
        setConfigured(r.data.configured || false);
        setForm(f => ({
          ...f,
          imap_host:       r.data.imap_host       || "",
          imap_port:       r.data.imap_port        || 993,
          imap_username:   r.data.imap_username    || "",
          smtp_host:       r.data.smtp_host        || "",
          smtp_port:       r.data.smtp_port        || 587,
          smtp_username:   r.data.smtp_username    || "",
          mailbox_address: r.data.mailbox_address  || "",
          // passwords are never returned — leave blank (empty = keep existing on save)
          imap_password: "",
          smtp_password: "",
        }));
      })
      .catch(() => toast.error("Failed to load mailbox config"))
      .finally(() => setLoading(false));
  }, []);

  const upd = key => val => {
    setForm(f => ({ ...f, [key]: val }));
    setTestResult(null);
  };

  const applyProvider = value => {
    setProvider(value);
    const p = PROVIDERS.find(x => x.value === value);
    if (p && value !== "custom" && value !== "") {
      setForm(f => ({
        ...f,
        imap_host: p.imap_host, imap_port: p.imap_port,
        smtp_host: p.smtp_host, smtp_port: p.smtp_port,
      }));
    }
    setTestResult(null);
  };

  const test = async () => {
    if (!form.imap_host || !form.imap_username || !form.imap_password) {
      toast.error("Enter IMAP host, username, and password before testing");
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const r = await api.post("/api/settings/mailbox/test", form);
      setTestResult({ ok: true, message: r.data.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.detail || "Connection failed" });
    } finally {
      setTesting(false);
    }
  };

  const save = async () => {
    if (!form.imap_host || !form.imap_username) {
      toast.error("IMAP host and username are required");
      return;
    }
    if (!configured && !form.imap_password) {
      toast.error("Password is required for the initial setup");
      return;
    }
    setSaving(true);
    try {
      await api.put("/api/settings/mailbox", form);
      setConfigured(true);
      toast.success("Mailbox connected successfully");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const clear = async () => {
    if (!window.confirm("Disconnect this mailbox? The Sales Inbox will stop receiving emails until a mailbox is reconnected.")) return;
    setClearing(true);
    try {
      await api.delete("/api/settings/mailbox");
      setConfigured(false);
      setForm(BLANK);
      setProvider("");
      setTestResult(null);
      toast.success("Mailbox disconnected");
    } catch {
      toast.error("Failed to disconnect");
    } finally {
      setClearing(false);
    }
  };

  if (loading) return <LoadingState />;

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Mailbox Settings"
        subtitle="Connect the sales mailbox to the portal inbox"
        actions={
          <div className="flex items-center gap-2">
            {configured && (
              <BtnSecondary onClick={clear} disabled={clearing}>
                {clearing ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Disconnect
              </BtnSecondary>
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
        }
      />

      <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
        <div className="max-w-2xl mx-auto space-y-5">

          {/* Status banner */}
          <div className={`rounded-2xl px-5 py-4 border flex items-start gap-3 ${
            configured
              ? "bg-green-50 border-green-200"
              : "bg-amber-50 border-amber-200"
          }`}>
            {configured
              ? <CheckCircle2 size={16} className="text-green-500 mt-0.5 shrink-0" />
              : <AlertCircle  size={16} className="text-amber-500 mt-0.5 shrink-0" />}
            <div>
              <p className={`text-xs font-semibold ${configured ? "text-green-700" : "text-amber-700"}`}>
                {configured ? "Mailbox connected" : "No mailbox configured"}
              </p>
              <p className={`text-xs mt-0.5 leading-relaxed ${configured ? "text-green-600" : "text-amber-600"}`}>
                {configured
                  ? `Emails from ${form.imap_username || "the mailbox"} are being pulled into the Sales Inbox every 60 seconds. Staff with Sales Inbox permission can view and reply without logging into any mailbox.`
                  : "Connect a mailbox below. Any user with Sales Inbox permission will be able to read and reply to emails directly in this portal."}
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
                : <WifiOff      size={15} className="text-red-500 mt-0.5 shrink-0" />}
              <p className={`text-xs leading-relaxed ${testResult.ok ? "text-green-700" : "text-red-700"}`}>
                {testResult.message}
              </p>
            </div>
          )}

          {/* Provider shortcut */}
          <SectionCard title="Provider" description="Choose a provider to pre-fill common server settings.">
            <Field label="Email provider">
              <div className="relative">
                <select
                  value={provider}
                  onChange={e => applyProvider(e.target.value)}
                  className="w-full text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 pr-9 outline-none focus:border-bassani-400 focus:ring-2 focus:ring-bassani-100 bg-white appearance-none"
                >
                  {PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
              </div>
            </Field>
          </SectionCard>

          {/* IMAP settings */}
          <SectionCard
            title="Incoming Mail (IMAP)"
            description="The portal polls this mailbox every 60 seconds for new messages."
          >
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="IMAP host">
                  <TextInput value={form.imap_host} onChange={upd("imap_host")} placeholder="outlook.office365.com" />
                </Field>
              </div>
              <Field label="Port">
                <NumInput value={form.imap_port} onChange={upd("imap_port")} min={1} max={65535} />
              </Field>
            </div>
            <Field label="Username (mailbox address)" hint="This is usually the full email address of the shared mailbox.">
              <TextInput value={form.imap_username} onChange={upd("imap_username")} placeholder="orders@bassanihealth.com" />
            </Field>
            <Field
              label="Password"
              hint={configured ? "Leave blank to keep the existing password. Enter a new password to update it." : ""}
            >
              <TextInput
                type="password"
                value={form.imap_password}
                onChange={upd("imap_password")}
                placeholder={configured ? "••••••••  (unchanged)" : "Enter password"}
                autoComplete="new-password"
              />
            </Field>
          </SectionCard>

          {/* SMTP settings */}
          <SectionCard
            title="Outgoing Mail (SMTP)"
            description="Used to send replies from the portal. Defaults to IMAP host settings if left blank."
          >
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <Field label="SMTP host" hint="Leave blank to use the same host as IMAP.">
                  <TextInput value={form.smtp_host} onChange={upd("smtp_host")} placeholder="smtp.office365.com (optional)" />
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

          {/* Display address */}
          <SectionCard
            title="Display Address"
            description="The From address shown to email recipients when a staff member replies."
          >
            <Field label="Mailbox display address" hint="Leave blank to use the IMAP username. For M365 shared mailboxes this is typically the mailbox address itself.">
              <TextInput value={form.mailbox_address} onChange={upd("mailbox_address")} placeholder="orders@bassanihealth.com (optional)" />
            </Field>
          </SectionCard>

          {/* Notes */}
          <div className="bg-white rounded-2xl border border-gray-100 px-6 py-5">
            <p className="text-xs font-bold text-gray-700 mb-2">Notes</p>
            <ul className="text-xs text-gray-500 space-y-1.5 leading-relaxed list-disc list-inside">
              <li><strong className="text-gray-600">Xneelo custom domain</strong> — IMAP: <code className="bg-gray-100 px-1 rounded">mail.yourdomain.com:993</code>, SMTP: <code className="bg-gray-100 px-1 rounded">smtp.yourdomain.com:465</code> (SSL). Use the mailbox password set in the Xneelo Control Panel.</li>
              <li><strong className="text-gray-600">Microsoft 365</strong> — IMAP must be enabled in Exchange Admin and Basic Auth allowed for this mailbox. IMAP: <code className="bg-gray-100 px-1 rounded">outlook.office365.com:993</code>, SMTP: <code className="bg-gray-100 px-1 rounded">smtp.office365.com:587</code> (STARTTLS).</li>
              <li><strong className="text-gray-600">Gmail</strong> — requires an App Password (not your regular password) if 2-Step Verification is on.</li>
              <li>Credentials are stored in the portal database and are never visible to non-super-admin users.</li>
            </ul>
          </div>

        </div>
      </main>
    </div>
  );
}
