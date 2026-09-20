// "Register as Sales Agent" — Partner Directory (2026-09-20). Converts an
// existing Odoo partner into a portal reseller, pre-filled from data
// already known about the partner (name/email/phone from the row, VAT/ref
// via the same GET /api/customers/{id} call Resellers()'s own edit modal
// already makes). Commission defaults on, same as the general wizard.
// Account creation is invite-based (see reseller_routes.py) — no
// username/password fields here at all.
import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Modal, FormGroup, Input, Select, BtnPrimary, BtnSecondary } from "./UI";
import { validateSAID, validatePassport } from "../utils/validators";

const ENTITY_TYPES = [
  { value: "Private Company (Pty) Ltd",   label: "Private Company (Pty) Ltd"   },
  { value: "Close Corporation (CC)",      label: "Close Corporation (CC)"      },
  { value: "Sole Proprietor",             label: "Sole Proprietor"             },
  { value: "Partnership",                 label: "Partnership"                 },
  { value: "Other",                       label: "Other"                       },
];

const ID_TYPES = [
  { value: "sa_id",    label: "South African ID" },
  { value: "passport", label: "Passport" },
];

export default function RegisterSalesAgentModal({ partner, onClose, onCreated }) {
  const [form, setForm] = useState({
    name: partner.name || "",
    seller_code: "",
    contact_person: "",
    email: partner.email || "",
    phone: partner.phone || "",
    commission_eligible: true,
    warehouse_id: "",
    entity_type: partner.is_company ? "" : "Sole Proprietor",
    entity_type_other: "",
    id_type: "sa_id",
    id_number: "",
    company_reg_number: "",
    vat_registered: false,
    vat_number: "",
    bank_name: "",
    bank_account_holder: "",
    bank_account_number: "",
    bank_branch_code: "",
  });
  const [warehouses, setWarehouses] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [saving, setSaving] = useState(false);

  const isSoleProp = form.entity_type === "Sole Proprietor";

  useEffect(() => {
    api.get("/api/warehouses/").then(r => {
      const whs = r.data.warehouses || [];
      const defId = r.data.default_warehouse_id;
      setWarehouses(whs);
      if (whs.length > 0) {
        const preferred = defId && whs.find(w => w.id === defId) ? String(defId) : String(whs[0].id);
        setForm(f => ({ ...f, warehouse_id: preferred }));
      }
    }).catch(() => {});

    api.get(`/api/customers/${partner.id}`).then(r => {
      const d = r.data || {};
      setForm(f => ({
        ...f,
        seller_code: f.seller_code || (d.ref || ""),
        vat_number: d.vat || f.vat_number,
        vat_registered: !!d.vat,
      }));
    }).catch(() => { /* non-fatal — seller code/VAT just stay blank for manual entry */ })
      .finally(() => setLoadingDetail(false));
  }, [partner.id]);

  const save = async () => {
    if (!form.name) return toast.error("Business name is required");
    if (!form.seller_code) return toast.error("Seller code is required");
    if (!form.email) return toast.error("Email is required to send the portal invite");
    if (form.entity_type === "Other" && !form.entity_type_other.trim()) return toast.error("Please specify the entity type");
    if (isSoleProp) {
      const idNum = form.id_number.trim();
      const isPassport = form.id_type === "passport";
      if (!idNum) return toast.error(isPassport ? "Passport Number is required for a Sole Proprietor" : "ID Number is required for a Sole Proprietor");
      if (isPassport ? !validatePassport(idNum) : !validateSAID(idNum))
        return toast.error(isPassport ? "Enter a valid passport number" : "Must be a valid 13-digit South African ID number");
    }
    setSaving(true);
    try {
      const payload = { ...form, odoo_partner_id: partner.id };
      if (payload.warehouse_id) payload.warehouse_id = parseInt(payload.warehouse_id);
      else delete payload.warehouse_id;
      const r = await api.post("/api/resellers/", payload);
      toast.success(`Sales agent created — invite sent to ${form.email}`);
      if (r.data?.warning) toast(r.data.warning, { icon: "⚠️" });
      onCreated();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to create sales agent");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Register as Sales Agent" onClose={onClose} width="max-w-2xl">
      <div className="space-y-4">
        <p className="text-xs text-bassani-600 bg-bassani-50 border border-bassani-100 rounded-lg px-3 py-2">
          Pre-filled from <span className="font-semibold">{partner.name}</span> — review and adjust as needed.
        </p>

        {partner.is_customer_portal_user && (
          <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
            This partner already has a customer portal login. They can be both a customer and a sales agent — just confirm that's intended.
          </p>
        )}

        <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={form.commission_eligible}
              onChange={e => setForm(f => ({ ...f, commission_eligible: e.target.checked }))}
              className="mt-0.5 w-4 h-4 accent-bassani-600 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-gray-800">Applicable for commission</p>
              <p className="text-xs text-gray-400 mt-0.5">Uncheck for an internal Bassani staff account instead of a genuine external sales agent. Non-eligible agents are excluded from commission statements.</p>
            </div>
          </label>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormGroup label="Business Name" required>
            <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} autoFocus />
          </FormGroup>
          <FormGroup label="Legal Entity Type">
            <Select value={form.entity_type} onChange={e => {
              const v = e.target.value;
              setForm(f => ({ ...f, entity_type: v, entity_type_other: "",
                ...(v === "Sole Proprietor" ? { company_reg_number: "" } : { id_number: "" }) }));
            }}>
              <option value="">— Not specified —</option>
              {ENTITY_TYPES.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
            </Select>
          </FormGroup>
          {form.entity_type === "Other" && (
            <FormGroup label="Please specify entity type">
              <Input value={form.entity_type_other} onChange={e => setForm({ ...form, entity_type_other: e.target.value })} placeholder="e.g. Non-profit organisation" />
            </FormGroup>
          )}
          <FormGroup label="Seller Code" required>
            <Input value={form.seller_code} onChange={e => setForm({ ...form, seller_code: e.target.value.toUpperCase() })}
              placeholder={loadingDetail ? "Loading…" : "JOE001"} />
          </FormGroup>
          <FormGroup label="Contact Person">
            <Input value={form.contact_person} onChange={e => setForm({ ...form, contact_person: e.target.value })} />
          </FormGroup>
          <FormGroup label="Email" required>
            <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          </FormGroup>
          <FormGroup label="Phone">
            <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          </FormGroup>
          <FormGroup label="Warehouse" className="sm:col-span-2">
            <Select value={form.warehouse_id} onChange={e => setForm({ ...form, warehouse_id: e.target.value })}>
              <option value="">— No warehouse assigned —</option>
              {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </FormGroup>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Registration</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {isSoleProp ? (
              <FormGroup label={form.id_type === "passport" ? "Passport Number" : "ID Number"} required>
                <div className="flex gap-2">
                  <div className="w-32 shrink-0">
                    <Select value={form.id_type} onChange={e => setForm({ ...form, id_type: e.target.value, id_number: "" })}>
                      {ID_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </Select>
                  </div>
                  <Input value={form.id_number} onChange={e => setForm({ ...form, id_number: e.target.value })}
                    placeholder={form.id_type === "passport" ? "e.g. A12345678" : "8001015009087"}
                    maxLength={form.id_type === "passport" ? 15 : 13} />
                </div>
              </FormGroup>
            ) : (
              <FormGroup label="Company Reg Number">
                <Input value={form.company_reg_number} onChange={e => setForm({ ...form, company_reg_number: e.target.value })} placeholder="e.g. 2023/123456/07" />
              </FormGroup>
            )}
            <div className="space-y-2">
              <FormGroup label="VAT">
                <label className="flex items-center gap-2 cursor-pointer h-9">
                  <input type="checkbox" checked={form.vat_registered}
                    onChange={e => setForm({ ...form, vat_registered: e.target.checked, vat_number: e.target.checked ? form.vat_number : "" })}
                    className="w-4 h-4 accent-bassani-600" />
                  <span className="text-sm text-gray-700">VAT registered</span>
                </label>
              </FormGroup>
              {form.vat_registered && (
                <FormGroup label="VAT Number">
                  <Input value={form.vat_number} onChange={e => setForm({ ...form, vat_number: e.target.value })} placeholder="e.g. 4123456789" />
                </FormGroup>
              )}
            </div>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 mb-2 uppercase tracking-wider">Banking Details <span className="text-gray-300 font-normal normal-case">(for EFT commission payouts)</span></p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Bank Name"><Input value={form.bank_name} onChange={e => setForm({ ...form, bank_name: e.target.value })} placeholder="e.g. FNB" /></FormGroup>
            <FormGroup label="Account Holder"><Input value={form.bank_account_holder} onChange={e => setForm({ ...form, bank_account_holder: e.target.value })} /></FormGroup>
            <FormGroup label="Account Number"><Input value={form.bank_account_number} onChange={e => setForm({ ...form, bank_account_number: e.target.value })} /></FormGroup>
            <FormGroup label="Branch Code"><Input value={form.bank_branch_code} onChange={e => setForm({ ...form, bank_branch_code: e.target.value })} placeholder="e.g. 250655" /></FormGroup>
          </div>
        </div>

        <p className="text-xs text-gray-400 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
          An invite to set a password will be sent to this email once the sales agent is created — no password is set here.
        </p>

        <div className="flex justify-end gap-2">
          <BtnSecondary onClick={onClose} disabled={saving}>Cancel</BtnSecondary>
          <BtnPrimary onClick={save} loading={saving}>Create Sales Agent</BtnPrimary>
        </div>
      </div>
    </Modal>
  );
}
