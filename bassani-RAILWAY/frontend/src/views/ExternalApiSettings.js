// Settings > External API (Phase 14.0). Three sections:
//   - Kill switch (super admin): pause every external API request and store
//     sync in one action.
//   - API clients (super admin): external systems that call the portal with
//     an API key. The key is shown once, on create/rotate, and never again.
//   - Online stores / sales channels (channels.manage): stores the portal
//     connects out to (WooCommerce first). Store credentials are write-only —
//     the backend only ever reports whether each one is saved.
import { useState, useEffect, useCallback } from "react";
import { KeyRound, Store, Power, Copy, CheckCircle, AlertTriangle, Plus, Pencil, RefreshCw } from "lucide-react";
import {
  BtnPrimary, BtnSecondary, BtnDanger, Modal, FormGroup, Input, Select, Textarea, Badge, fmtDateTime,
} from "../components/UI";
import { MultiSearchableSelect } from "../components/ProductPickerDrawer";
import { useAuth } from "../AuthContext";
import api from "../api";
import toast from "react-hot-toast";

const errMsg = (e, fallback) => e.response?.data?.detail || fallback;

function Section({ icon: Icon, title, description, action, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-bassani-50 flex items-center justify-center shrink-0">
            <Icon size={18} className="text-bassani-700" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
            <p className="text-xs text-gray-500">{description}</p>
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

// ── Shared pickers ────────────────────────────────────────────────────────────

function useWarehouses() {
  const [warehouses, setWarehouses] = useState([]);
  useEffect(() => {
    api.get("/api/warehouses/").then(r => setWarehouses(r.data.warehouses || [])).catch(() => {});
  }, []);
  return warehouses;
}

function usePricelists(warehouseId) {
  const [pricelists, setPricelists] = useState([]);
  useEffect(() => {
    if (!warehouseId) { setPricelists([]); return; }
    api.get("/api/integrations/options/pricelists", { params: { warehouse_id: warehouseId } })
      .then(r => setPricelists(r.data.pricelists || []))
      .catch(() => setPricelists([]));
  }, [warehouseId]);
  return pricelists;
}

function WarehousePricelistFields({ form, set }) {
  const warehouses = useWarehouses();
  const pricelists = usePricelists(form.warehouse_id);
  return (
    <>
      <FormGroup label="Warehouse" required>
        <Select value={form.warehouse_id || ""} onChange={e => set({ warehouse_id: e.target.value ? Number(e.target.value) : null, pricelist_id: null })}>
          <option value="">Select a warehouse…</option>
          {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </Select>
        <p className="text-[11px] text-gray-400 mt-1">Stock figures and the company that sells come from this warehouse.</p>
      </FormGroup>
      <FormGroup label="Pricelist">
        <Select value={form.pricelist_id || ""} disabled={!form.warehouse_id} onChange={e => set({ pricelist_id: e.target.value ? Number(e.target.value) : null })}>
          <option value="">No prices</option>
          {pricelists.map(p => <option key={p.id} value={p.id}>{p.name} ({p.company_name})</option>)}
        </Select>
        <p className="text-[11px] text-gray-400 mt-1">Prices are read from this pricelist. Without one, no prices are shared.</p>
      </FormGroup>
    </>
  );
}

// ── Kill switch ───────────────────────────────────────────────────────────────

function KillSwitchSection() {
  const [state, setState]     = useState(null);
  const [confirm, setConfirm] = useState(null);   // "pause" | "resume" | null
  const [reason, setReason]   = useState("");
  const [saving, setSaving]   = useState(false);

  const load = useCallback(() => {
    api.get("/api/integrations/kill-switch").then(r => setState(r.data)).catch(() => toast.error("Failed to load the API status"));
  }, []);
  useEffect(() => { load(); }, [load]);

  const apply = async () => {
    setSaving(true);
    try {
      const { data } = await api.put("/api/integrations/kill-switch", { enabled: confirm === "resume", reason });
      setState(data);
      toast.success(confirm === "resume" ? "External API resumed" : "External API paused");
      setConfirm(null); setReason("");
    } catch (e) { toast.error(errMsg(e, "Failed to update")); }
    finally { setSaving(false); }
  };

  if (!state) return null;
  const enabled = state.enabled;
  return (
    <Section
      icon={Power}
      title="External API status"
      description="Pauses every external API request and online store sync at once. Use it if an integration misbehaves."
      action={enabled
        ? <BtnDanger onClick={() => setConfirm("pause")}>Pause API</BtnDanger>
        : <BtnPrimary onClick={() => setConfirm("resume")}>Resume API</BtnPrimary>}
    >
      <div className={`rounded-xl px-4 py-3 text-sm flex items-center gap-2 ${enabled ? "bg-green-50 text-green-800" : "bg-red-50 text-red-800"}`}>
        {enabled ? <CheckCircle size={16} /> : <AlertTriangle size={16} />}
        {enabled
          ? "Running. Active API clients can connect."
          : <span>Paused by {state.updated_by || "an admin"} on {fmtDateTime(state.updated_at)}{state.reason ? `: ${state.reason}` : ""}</span>}
      </div>

      {confirm && (
        <Modal title={confirm === "pause" ? "Pause the external API?" : "Resume the external API?"} onClose={() => setConfirm(null)}>
          {confirm === "pause" ? (
            <>
              <p className="text-sm text-gray-600 mb-4">Every API client will be refused until you resume, and online store syncing stops. Nothing already in the portal is affected.</p>
              <FormGroup label="Reason" required>
                <Textarea rows={2} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. Partner integration sending duplicate requests" />
              </FormGroup>
            </>
          ) : (
            <p className="text-sm text-gray-600">Active API clients will be able to connect again immediately.</p>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setConfirm(null)}>Cancel</BtnSecondary>
            {confirm === "pause"
              ? <BtnDanger onClick={apply} disabled={!reason.trim() || saving}>Pause API</BtnDanger>
              : <BtnPrimary onClick={apply} loading={saving}>Resume API</BtnPrimary>}
          </div>
        </Modal>
      )}
    </Section>
  );
}

// ── API clients ───────────────────────────────────────────────────────────────

const BLANK_CLIENT = {
  name: "", description: "", client_type: "standard", integration_partner_id: "", callback_url: "",
  warehouse_id: null, pricelist_id: null, stock_detail: "binary", scoped_parent_category_ids: [], sandbox: false,
};

function CopyRow({ label, value }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="mb-3">
      <div className="text-xs font-semibold text-gray-600 mb-1">{label}</div>
      <div className="flex items-center gap-2">
        <code className="flex-1 text-xs font-mono break-all bg-slate-900 text-green-400 rounded-xl px-4 py-3">{value}</code>
        <BtnSecondary onClick={copy}>{copied ? <CheckCircle size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}</BtnSecondary>
      </div>
    </div>
  );
}

// Shows a freshly issued API key and/or webhook signing secret, once.
function SecretRevealModal({ clientName, apiKey, webhookSecret, onClose }) {
  const both = apiKey && webhookSecret;
  return (
    <Modal title={`${both || apiKey ? "Credentials" : "Webhook secret"} for ${clientName}`} onClose={onClose}>
      <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-sm rounded-xl px-4 py-3 mb-4">
        <AlertTriangle size={16} className="shrink-0 mt-0.5" />
        <span>Copy {both ? "these now" : "this now"} and send {both ? "them" : "it"} to the integrator securely. {both ? "They" : "It"} can't be shown again. If lost, rotate to issue a new one.</span>
      </div>
      {apiKey && <CopyRow label="API key" value={apiKey} />}
      {webhookSecret && <CopyRow label="Webhook signing secret" value={webhookSecret} />}
      <p className="text-xs text-gray-500 mt-1">
        {apiKey && <>The integrator sends the key in an <code>X-API-Key</code> header; <code>GET /api/external/v1/ping</code> checks it works. </>}
        {webhookSecret && <>Every webhook we send is signed with the secret, so the integrator can verify it came from us.</>}
      </p>
      <div className="flex justify-end mt-4"><BtnPrimary onClick={onClose}>I've copied {both ? "them" : "it"}</BtnPrimary></div>
    </Modal>
  );
}

function usePartners(enabled) {
  const [partners, setPartners] = useState([]);
  useEffect(() => {
    if (!enabled) return;
    api.get("/api/resellers/", { params: { limit: 200 } })
      .then(r => setPartners(r.data.resellers || []))
      .catch(() => setPartners([]));
  }, [enabled]);
  return partners;
}

function ApiClientFormModal({ client, categories, onClose, onSaved }) {
  const editing = Boolean(client);
  const [form, setForm] = useState(editing
    ? { ...BLANK_CLIENT, ...client, callback_url: client.callback_url || "", scoped_parent_category_ids: client.scoped_parent_category_ids || [] }
    : BLANK_CLIENT);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm(f => ({ ...f, ...patch }));
  const isPartner = form.client_type === "partner_platform";
  const partners = usePartners(!editing && isPartner);

  const pickPartner = (id) => {
    const p = partners.find(x => x.id === id);
    // A partner's stores draw stock from the partner's own warehouse by default.
    set({ integration_partner_id: id, ...(p?.warehouse_id ? { warehouse_id: p.warehouse_id, pricelist_id: null } : {}), ...(!form.name && p ? { name: `${p.name} POS` } : {}) });
  };

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name, description: form.description, warehouse_id: form.warehouse_id,
        stock_detail: form.stock_detail, sandbox: form.sandbox,
      };
      if (isPartner) payload.callback_url = form.callback_url.trim();
      if (editing) {
        payload.pricelist_id = form.pricelist_id || undefined;
        payload.clear_pricelist = !form.pricelist_id;
        payload.scoped_parent_category_ids = form.scoped_parent_category_ids.length ? form.scoped_parent_category_ids : undefined;
        payload.clear_category_scope = form.scoped_parent_category_ids.length === 0;
        if (!isPartner) delete payload.callback_url;
        const { data } = await api.put(`/api/integrations/api-clients/${client.id}`, payload);
        toast.success("API client updated");
        onSaved(data);
      } else {
        payload.client_type = form.client_type;
        payload.integration_partner_id = isPartner ? form.integration_partner_id : null;
        payload.pricelist_id = form.pricelist_id || null;
        payload.scoped_parent_category_ids = form.scoped_parent_category_ids.length ? form.scoped_parent_category_ids : null;
        const { data } = await api.post("/api/integrations/api-clients", payload);
        onSaved(data);
      }
    } catch (e) { toast.error(errMsg(e, "Failed to save")); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={editing ? `Edit ${client.name}` : "New API client"} onClose={onClose} width="max-w-xl">
      {!editing && (
        <FormGroup label="Type">
          <Select value={form.client_type} onChange={e => set({ client_type: e.target.value })}>
            <option value="standard">Standard integration</option>
            <option value="partner_platform">POS partner (a point-of-sale platform whose stores order from us)</option>
          </Select>
        </FormGroup>
      )}
      {isPartner && !editing && (
        <FormGroup label="Sales Agent account" required>
          <Select value={form.integration_partner_id} onChange={e => pickPartner(e.target.value)}>
            <option value="">Select the POS company's Sales Agent account…</option>
            {partners.map(p => <option key={p.id} value={p.id}>{p.name}{p.channel === "api_partner" ? " (already a POS partner)" : ""}</option>)}
          </Select>
          <p className="text-[11px] text-gray-400 mt-1">Create the POS company's Sales Agent account first (Sales Agents). Stores that connect through it become its customers, and it earns commission on their orders.</p>
        </FormGroup>
      )}
      {isPartner && editing && (
        <p className="text-xs text-gray-500 bg-gray-50 rounded-xl px-3 py-2 mb-4">POS partner for Sales Agent <strong>{client.integration_partner_name}</strong>.</p>
      )}
      <FormGroup label="Name" required>
        <Input value={form.name} onChange={e => set({ name: e.target.value })} placeholder={isPartner ? "e.g. Cannaverse POS" : "e.g. Green Clouds website"} />
      </FormGroup>
      <FormGroup label="Description">
        <Input value={form.description} onChange={e => set({ description: e.target.value })} placeholder="Who runs it and what it's for" />
      </FormGroup>
      {isPartner && (
        <FormGroup label="Webhook address">
          <Input value={form.callback_url} onChange={e => set({ callback_url: e.target.value })} placeholder="https://api.example.com/bassani/webhooks" />
          <p className="text-[11px] text-gray-400 mt-1">Where we notify the POS when a store is approved or an order changes status. Can be added later.</p>
        </FormGroup>
      )}
      <WarehousePricelistFields form={form} set={set} />
      <FormGroup label="Product categories">
        <MultiSearchableSelect
          values={form.scoped_parent_category_ids}
          onChange={v => set({ scoped_parent_category_ids: v })}
          options={categories}
          placeholder="Whole catalogue"
          searchPlaceholder="Search categories…"
          width="w-full"
        />
        <p className="text-[11px] text-gray-400 mt-1">The same categories resellers and customers see when ordering. Clients only ever see products in the reseller catalogue. Leave empty to share the whole catalogue, or pick categories to narrow it (a top-level category includes its sub-categories).</p>
      </FormGroup>
      <FormGroup label="Stock detail">
        <Select value={form.stock_detail} onChange={e => set({ stock_detail: e.target.value })}>
          <option value="binary">In stock / out of stock only</option>
          <option value="quantity">Exact quantities</option>
        </Select>
        <p className="text-[11px] text-gray-400 mt-1">Exact quantities are only for systems we control, such as our own online store's stock sync.</p>
      </FormGroup>
      <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
        <input type="checkbox" checked={form.sandbox} onChange={e => set({ sandbox: e.target.checked })} />
        Sandbox (for building and testing; responses are marked as sandbox)
      </label>
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
        <BtnPrimary onClick={save} loading={saving}
          disabled={!form.name.trim() || !form.warehouse_id || (isPartner && !editing && !form.integration_partner_id)}>
          {editing ? "Save" : "Create & show key"}
        </BtnPrimary>
      </div>
    </Modal>
  );
}

const CONFIRM_COPY = {
  rotate:   { title: "Rotate this API key?", button: "Rotate key", danger: true,
              body: (c) => <>A new key is issued for <strong>{c.name}</strong> and the current key stops working immediately. The integrator must update their system before it can connect again.</> },
  "rotate-webhook-secret": { title: "Issue a new webhook secret?", button: "Issue new secret", danger: true,
              body: (c) => <>Webhooks to <strong>{c.name}</strong> are signed with the new secret from now on. The POS must switch to it, or it will reject our webhooks.</> },
  revoke:   { title: "Revoke this API client?", button: "Revoke", danger: true,
              body: (c) => <><strong>{c.name}</strong> is refused from its very next request.{c.client_type === "partner_platform" ? " Every store connected through it stops working too." : ""} You can restore it later with the same key.</> },
  activate: { title: "Restore access?", button: "Restore", danger: false,
              body: (c) => <><strong>{c.name}</strong> can connect again with its existing key.</> },
};

function ApiClientsSection() {
  const [clients, setClients]       = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [formTarget, setFormTarget] = useState(undefined);   // undefined = closed, null = new, obj = edit
  const [revealed, setRevealed]     = useState(null);        // { clientName, apiKey?, webhookSecret? }
  const [confirm, setConfirm]       = useState(null);        // { kind, client }

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/integrations/api-clients");
      setClients(data.clients || []);
    } catch { toast.error("Failed to load API clients"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    // Portal Parent Categories (the cart's grouping), labelled "Parent / Child"
    // and ordered so each sub-category sits under its parent.
    api.get("/api/parent-categories/").then(r => {
      const active = (r.data.categories || []).filter(c => c.active !== false);
      const byId = Object.fromEntries(active.map(c => [c.id, c]));
      const options = [];
      active.filter(c => !c.parent_id).forEach(top => {
        options.push({ value: top.id, label: top.name });
        active.filter(c => c.parent_id === top.id).forEach(child => options.push({ value: child.id, label: `${top.name} / ${child.name}` }));
      });
      active.filter(c => c.parent_id && !byId[c.parent_id]).forEach(c => options.push({ value: c.id, label: c.name }));
      options.push({ value: "uncategorised", label: "Uncategorised" });
      setCategories(options);
    }).catch(() => {});
  }, [load]);

  const doConfirm = async () => {
    const { kind, client } = confirm;
    setConfirm(null);
    try {
      const { data } = await api.post(`/api/integrations/api-clients/${client.id}/${kind}`);
      if (data.api_key || data.webhook_secret) {
        setRevealed({ clientName: client.name, apiKey: data.api_key, webhookSecret: data.webhook_secret });
      }
      toast.success({
        rotate: "Key rotated. The old key no longer works.",
        "rotate-webhook-secret": "New webhook secret issued",
        revoke: "Access revoked",
        activate: "Access restored",
      }[kind]);
      load();
    } catch (e) { toast.error(errMsg(e, "Failed")); }
  };

  const copy = confirm ? CONFIRM_COPY[confirm.kind] : null;
  return (
    <Section
      icon={KeyRound}
      title="API clients"
      description="External systems that read our catalogue and stock with an API key, including POS partners."
      action={<BtnPrimary onClick={() => setFormTarget(null)}><Plus size={14} /> New API client</BtnPrimary>}
    >
      {loading ? (
        <div className="h-16 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : clients.length === 0 ? (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-6 text-center">No API clients yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                <th className="py-2 pr-3 font-medium">Name</th>
                <th className="py-2 pr-3 font-medium hidden md:table-cell">Warehouse</th>
                <th className="py-2 pr-3 font-medium hidden lg:table-cell">Key</th>
                <th className="py-2 pr-3 font-medium hidden md:table-cell">Last used</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {clients.map(c => {
                const isPartner = c.client_type === "partner_platform";
                return (
                  <tr key={c.id} className="border-b border-gray-50 last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-gray-900">{c.name}</div>
                      {isPartner && (
                        <div className="text-xs text-indigo-700">
                          POS partner · Sales Agent {c.integration_partner_name}
                          {!c.callback_url && <span className="text-amber-600"> · No webhook address</span>}
                        </div>
                      )}
                      <div className="text-xs text-gray-500">
                        {c.pricelist_name ? `Prices: ${c.pricelist_name}` : "No prices"} · {c.stock_detail === "quantity" ? "Exact stock" : "In/out of stock"}
                        {" · "}{c.scoped_parent_category_ids?.length ? `${c.scoped_parent_category_ids.length} ${c.scoped_parent_category_ids.length === 1 ? "category" : "categories"}` : "Whole catalogue"}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3 hidden md:table-cell text-gray-600">{c.warehouse_name}</td>
                    <td className="py-2.5 pr-3 hidden lg:table-cell"><code className="text-xs text-gray-500">{c.key_prefix}…</code></td>
                    <td className="py-2.5 pr-3 hidden md:table-cell text-gray-600">{c.last_used_at ? fmtDateTime(c.last_used_at) : "Never"}</td>
                    <td className="py-2.5 pr-3">
                      <div className="flex flex-wrap gap-1">
                        <Badge color={c.active ? "green" : "red"}>{c.active ? "Active" : "Revoked"}</Badge>
                        {isPartner && <Badge color="indigo">POS partner</Badge>}
                        {c.sandbox && <Badge color="amber">Sandbox</Badge>}
                      </div>
                    </td>
                    <td className="py-2.5 text-right whitespace-nowrap">
                      <div className="inline-flex gap-1.5">
                        <BtnSecondary size="sm" onClick={() => setFormTarget(c)}><Pencil size={12} /></BtnSecondary>
                        <BtnSecondary size="sm" onClick={() => setConfirm({ kind: "rotate", client: c })}><RefreshCw size={12} /> Rotate</BtnSecondary>
                        {isPartner && (
                          <BtnSecondary size="sm" onClick={() => setConfirm({ kind: "rotate-webhook-secret", client: c })}>Webhook secret</BtnSecondary>
                        )}
                        {c.active
                          ? <BtnDanger onClick={() => setConfirm({ kind: "revoke", client: c })}>Revoke</BtnDanger>
                          : <BtnSecondary size="sm" onClick={() => setConfirm({ kind: "activate", client: c })}>Restore</BtnSecondary>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {formTarget !== undefined && (
        <ApiClientFormModal
          client={formTarget}
          categories={categories}
          onClose={() => setFormTarget(undefined)}
          onSaved={(data) => {
            setFormTarget(undefined);
            if (data.api_key || data.webhook_secret) {
              setRevealed({ clientName: data.client.name, apiKey: data.api_key, webhookSecret: data.webhook_secret });
            }
            load();
          }}
        />
      )}
      {revealed && <SecretRevealModal {...revealed} onClose={() => setRevealed(null)} />}
      {confirm && (
        <Modal title={copy.title} onClose={() => setConfirm(null)}>
          <p className="text-sm text-gray-600">{copy.body(confirm.client)}</p>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setConfirm(null)}>Cancel</BtnSecondary>
            {copy.danger
              ? <BtnDanger onClick={doConfirm}>{copy.button}</BtnDanger>
              : <BtnPrimary onClick={doConfirm}>{copy.button}</BtnPrimary>}
          </div>
        </Modal>
      )}
    </Section>
  );
}

// ── Sales channels ────────────────────────────────────────────────────────────

const BLANK_CHANNEL = {
  name: "", channel_type: "woocommerce", warehouse_id: null, pricelist_id: null, store_url: "",
  consumer_key: "", consumer_secret: "", webhook_secret: "", payment_journal_id: null, safety_buffer_qty: 0, active: true,
};

function SecretInput({ label, value, onChange, saved }) {
  return (
    <FormGroup label={label}>
      <Input type="password" value={value} onChange={e => onChange(e.target.value)} autoComplete="new-password"
        placeholder={saved ? "Saved. Leave blank to keep it." : "Not set"} />
    </FormGroup>
  );
}

function ChannelFormModal({ channel, onClose, onSaved }) {
  const editing = Boolean(channel);
  const [form, setForm] = useState(editing
    ? { ...BLANK_CHANNEL, ...channel, consumer_key: "", consumer_secret: "", webhook_secret: "" }
    : BLANK_CHANNEL);
  const [journals, setJournals] = useState([]);
  const [saving, setSaving]     = useState(false);
  const set = (patch) => setForm(f => ({ ...f, ...patch }));

  useEffect(() => {
    if (!form.warehouse_id) { setJournals([]); return; }
    api.get("/api/integrations/options/payment-journals", { params: { warehouse_id: form.warehouse_id } })
      .then(r => setJournals(r.data.journals || [])).catch(() => setJournals([]));
  }, [form.warehouse_id]);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        name: form.name, warehouse_id: form.warehouse_id, store_url: form.store_url,
        safety_buffer_qty: Number(form.safety_buffer_qty) || 0,
        consumer_key: form.consumer_key || null, consumer_secret: form.consumer_secret || null,
        webhook_secret: form.webhook_secret || null,
      };
      if (editing) {
        payload.pricelist_id = form.pricelist_id || undefined;
        payload.clear_pricelist = !form.pricelist_id;
        payload.payment_journal_id = form.payment_journal_id || undefined;
        payload.clear_payment_journal = !form.payment_journal_id;
        payload.active = form.active;
        await api.put(`/api/integrations/channels/${channel.id}`, payload);
      } else {
        payload.channel_type = form.channel_type;
        payload.pricelist_id = form.pricelist_id || null;
        payload.payment_journal_id = form.payment_journal_id || null;
        await api.post("/api/integrations/channels", payload);
      }
      toast.success(editing ? "Online store updated" : "Online store added");
      onSaved();
    } catch (e) { toast.error(errMsg(e, "Failed to save")); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={editing ? `Edit ${channel.name}` : "Connect an online store"} onClose={onClose} width="max-w-xl">
      <FormGroup label="Name" required>
        <Input value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. Green Clouds Pharmacy website" />
      </FormGroup>
      <FormGroup label="Store type">
        <Select value={form.channel_type} disabled={editing} onChange={e => set({ channel_type: e.target.value })}>
          <option value="woocommerce">WooCommerce (WordPress)</option>
        </Select>
      </FormGroup>
      <FormGroup label="Store address" required>
        <Input value={form.store_url} onChange={e => set({ store_url: e.target.value })} placeholder="https://shop.example.co.za" />
      </FormGroup>
      <WarehousePricelistFields form={form} set={set} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <SecretInput label="WooCommerce consumer key" value={form.consumer_key} onChange={v => set({ consumer_key: v })}
          saved={editing && channel.has_consumer_key} />
        <SecretInput label="WooCommerce consumer secret" value={form.consumer_secret} onChange={v => set({ consumer_secret: v })}
          saved={editing && channel.has_consumer_secret} />
      </div>
      <SecretInput label="Webhook secret" value={form.webhook_secret} onChange={v => set({ webhook_secret: v })}
        saved={editing && channel.has_webhook_secret} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
        <FormGroup label="Web payments journal">
          <Select value={form.payment_journal_id || ""} disabled={!form.warehouse_id} onChange={e => set({ payment_journal_id: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Not set yet</option>
            {journals.map(j => <option key={j.id} value={j.id}>{j.name}</option>)}
          </Select>
          <p className="text-[11px] text-gray-400 mt-1">Where paid online orders are recorded until the payout reaches the bank.</p>
        </FormGroup>
        <FormGroup label="Safety buffer (units)">
          <Input type="number" min="0" value={form.safety_buffer_qty} onChange={e => set({ safety_buffer_qty: e.target.value })} />
          <p className="text-[11px] text-gray-400 mt-1">Held back from the website on every product to avoid overselling.</p>
        </FormGroup>
      </div>
      {editing && (
        <label className="flex items-center gap-2 text-sm text-gray-700 mb-2">
          <input type="checkbox" checked={form.active} onChange={e => set({ active: e.target.checked })} />
          Active
        </label>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose}>Cancel</BtnSecondary>
        <BtnPrimary onClick={save} loading={saving} disabled={!form.name.trim() || !form.warehouse_id || !form.store_url.trim()}>
          {editing ? "Save" : "Add store"}
        </BtnPrimary>
      </div>
    </Modal>
  );
}

function ChannelsSection() {
  const [channels, setChannels]     = useState([]);
  const [storageOk, setStorageOk]   = useState(true);
  const [loading, setLoading]       = useState(true);
  const [formTarget, setFormTarget] = useState(undefined);

  const load = useCallback(async () => {
    try {
      const { data } = await api.get("/api/integrations/channels");
      setChannels(data.channels || []);
      setStorageOk(data.credentials_storage_configured);
    } catch { toast.error("Failed to load online stores"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  return (
    <Section
      icon={Store}
      title="Online stores"
      description="Websites we push products and stock to, and take paid orders from."
      action={<BtnPrimary onClick={() => setFormTarget(null)}><Plus size={14} /> Connect a store</BtnPrimary>}
    >
      {!storageOk && (
        <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-xs rounded-xl px-4 py-3 mb-4">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          <span>Secure credential storage isn't set up on the server yet (CREDENTIALS_ENCRYPTION_KEY), so store keys can't be saved. Stores can still be added without them.</span>
        </div>
      )}
      {loading ? (
        <div className="h-16 flex items-center justify-center text-sm text-gray-400">Loading…</div>
      ) : channels.length === 0 ? (
        <p className="text-sm text-gray-500 bg-gray-50 rounded-xl px-4 py-6 text-center">No online stores connected yet.</p>
      ) : (
        <div className="space-y-2">
          {channels.map(ch => (
            <div key={ch.id} className="flex items-start justify-between gap-3 border border-gray-100 rounded-xl px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-medium text-sm text-gray-900">{ch.name}</span>
                  <Badge color={ch.active ? "green" : "gray"}>{ch.active ? "Active" : "Inactive"}</Badge>
                  {ch.sandbox && <Badge color="amber">Not live yet</Badge>}
                </div>
                <div className="text-xs text-gray-500 truncate">{ch.store_url}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {ch.warehouse_name} · {ch.pricelist_name ? `Prices: ${ch.pricelist_name}` : <span className="text-amber-600">No pricelist</span>}
                  {" · "}{ch.has_consumer_key && ch.has_consumer_secret ? `Store key …${ch.consumer_key_hint || ""}` : <span className="text-amber-600">Store keys not set</span>}
                </div>
              </div>
              <BtnSecondary size="sm" onClick={() => setFormTarget(ch)}><Pencil size={12} /> Edit</BtnSecondary>
            </div>
          ))}
          <p className="text-[11px] text-gray-400 pt-1">Product sync and order intake are switched on per store once those features are released.</p>
        </div>
      )}
      {formTarget !== undefined && (
        <ChannelFormModal channel={formTarget} onClose={() => setFormTarget(undefined)} onSaved={() => { setFormTarget(undefined); load(); }} />
      )}
    </Section>
  );
}

export default function ExternalApiSettings() {
  const { user, can } = useAuth();
  const isSuperAdmin = Boolean(user?.is_super_admin);
  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto w-full space-y-6">
        {isSuperAdmin && <KillSwitchSection />}
        {isSuperAdmin && <ApiClientsSection />}
        {can("channels.manage") && <ChannelsSection />}
      </div>
    </div>
  );
}
