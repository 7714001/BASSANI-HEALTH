import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle, Building2, User, MapPin, ClipboardList } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";

// ── Constants ──────────────────────────────────────────────────────────────────

const BUSINESS_TYPES = [
  "Pharmacy", "Dispensary", "Healthcare Provider",
  "Wellness Centre", "Private Practice", "Other",
];

const PROVINCES = [
  "Gauteng", "Western Cape", "KwaZulu-Natal", "Eastern Cape",
  "Limpopo", "Mpumalanga", "North West", "Free State", "Northern Cape",
];

const ORDER_VOLUMES = [
  "Less than 10 orders/month",
  "10 – 50 orders/month",
  "50 – 100 orders/month",
  "More than 100 orders/month",
];

const REFERRAL_SOURCES = [
  "Bassani Health representative",
  "Referral from another reseller",
  "Social media",
  "Industry event / conference",
  "Online search",
  "Other",
];

const STEPS = [
  { label: "Business Details",  icon: Building2 },
  { label: "Primary Contact",   icon: User },
  { label: "Business Address",  icon: MapPin },
  { label: "Additional Info",   icon: ClipboardList },
];

const BLANK = {
  // Step 1
  company_name: "", trading_name: "", registration_number: "",
  vat_number: "", business_type: "Pharmacy",
  // Step 2
  contact_name: "", contact_position: "", contact_email: "",
  contact_phone: "", contact_alt_phone: "",
  // Step 3
  street: "", suburb: "", city: "", province: "",
  postal_code: "", country: "South Africa",
  // Step 4
  ordering_volume: "", referral_source: "", notes: "",
};

// ── Small reusable form components ─────────────────────────────────────────────

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-600 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  );
}

function TextInput({ value, onChange, placeholder, type = "text", autoFocus }) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder} autoFocus={autoFocus}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400" />
  );
}

function SelectInput({ value, onChange, children }) {
  return (
    <select value={value} onChange={onChange}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white text-gray-700">
      {children}
    </select>
  );
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
      className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400 resize-none" />
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function CustomerOnboarding() {
  const navigate = useNavigate();
  const [step,        setStep       ] = useState(0);
  const [form,        setForm       ] = useState(BLANK);
  const [submitting,  setSubmitting ] = useState(false);
  const [reference,   setReference  ] = useState(null);

  const upd = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  // ── Validation ──────────────────────────────────────────────────────────────

  const validateStep = () => {
    if (step === 0) {
      if (!form.company_name.trim()) { toast.error("Company name is required"); return false; }
    }
    if (step === 1) {
      if (!form.contact_name.trim())  { toast.error("Contact name is required"); return false; }
      if (!form.contact_email.trim()) { toast.error("Contact email is required"); return false; }
      if (!form.contact_phone.trim()) { toast.error("Contact phone is required"); return false; }
    }
    if (step === 2) {
      if (!form.street.trim()) { toast.error("Street address is required"); return false; }
      if (!form.city.trim())   { toast.error("City is required"); return false; }
    }
    return true;
  };

  const next = () => { if (validateStep()) setStep(s => s + 1); };
  const back = () => setStep(s => s - 1);

  // ── Submit ──────────────────────────────────────────────────────────────────

  const submit = async () => {
    if (!validateStep()) return;
    setSubmitting(true);
    try {
      const { data } = await api.post("/api/onboarding/", form);
      setReference(data.reference);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // ── Success screen ──────────────────────────────────────────────────────────

  if (reference) {
    return (
      <div className="flex flex-col flex-1 overflow-hidden bg-gray-50">
        <div className="flex-1 flex items-center justify-center p-8">
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
            <div className="w-16 h-16 bg-bassani-50 rounded-full flex items-center justify-center mx-auto mb-5">
              <CheckCircle size={32} className="text-bassani-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 mb-2">Application Submitted</h2>
            <p className="text-gray-500 text-sm mb-5">
              Your onboarding application for <strong>{form.company_name}</strong> has been submitted
              and is pending admin review. You will be notified once it has been approved.
            </p>
            <div className="bg-gray-50 rounded-xl p-4 mb-6">
              <p className="text-xs text-gray-400 font-medium mb-1">Reference Number</p>
              <p className="text-lg font-bold font-mono text-bassani-700">{reference}</p>
            </div>
            <div className="flex gap-3">
              <button onClick={() => navigate("/customers")}
                className="flex-1 px-4 py-2 border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 hover:bg-gray-50 transition-colors">
                Back to Customers
              </button>
              <button onClick={() => { setForm(BLANK); setStep(0); setReference(null); }}
                className="flex-1 px-4 py-2 bg-bassani-600 hover:bg-bassani-700 rounded-lg text-sm font-semibold text-white transition-colors">
                Onboard Another
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Step content ────────────────────────────────────────────────────────────

  const stepContent = [
    // Step 1 — Business Details
    <div key="1" className="space-y-4">
      <Field label="Registered Company Name" required>
        <TextInput value={form.company_name} onChange={upd("company_name")} placeholder="e.g. Wellness Pharma (Pty) Ltd" autoFocus />
      </Field>
      <Field label="Trading Name (if different)">
        <TextInput value={form.trading_name} onChange={upd("trading_name")} placeholder="e.g. City Pharmacy" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Company Registration No.">
          <TextInput value={form.registration_number} onChange={upd("registration_number")} placeholder="2024/123456/07" />
        </Field>
        <Field label="VAT Number">
          <TextInput value={form.vat_number} onChange={upd("vat_number")} placeholder="4xxxxxxxxx" />
        </Field>
      </div>
      <Field label="Business Type" required>
        <SelectInput value={form.business_type} onChange={upd("business_type")}>
          {BUSINESS_TYPES.map(t => <option key={t}>{t}</option>)}
        </SelectInput>
      </Field>
    </div>,

    // Step 2 — Primary Contact
    <div key="2" className="space-y-4">
      <p className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">
        Please provide the details of the primary contact person who will be responsible for orders.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full Name" required>
          <TextInput value={form.contact_name} onChange={upd("contact_name")} placeholder="Jane Smith" autoFocus />
        </Field>
        <Field label="Position / Title">
          <TextInput value={form.contact_position} onChange={upd("contact_position")} placeholder="Pharmacist / Manager" />
        </Field>
      </div>
      <Field label="Email Address" required>
        <TextInput type="email" value={form.contact_email} onChange={upd("contact_email")} placeholder="orders@example.co.za" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Phone Number" required>
          <TextInput value={form.contact_phone} onChange={upd("contact_phone")} placeholder="+27 11 555 1234" />
        </Field>
        <Field label="Alternative Phone">
          <TextInput value={form.contact_alt_phone} onChange={upd("contact_alt_phone")} placeholder="+27 82 555 1234" />
        </Field>
      </div>
    </div>,

    // Step 3 — Business Address
    <div key="3" className="space-y-4">
      <Field label="Street Address" required>
        <TextInput value={form.street} onChange={upd("street")} placeholder="123 Health Street" autoFocus />
      </Field>
      <Field label="Suburb">
        <TextInput value={form.suburb} onChange={upd("suburb")} placeholder="Sandton" />
      </Field>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="City" required>
          <TextInput value={form.city} onChange={upd("city")} placeholder="Johannesburg" />
        </Field>
        <Field label="Postal Code">
          <TextInput value={form.postal_code} onChange={upd("postal_code")} placeholder="2196" />
        </Field>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Province">
          <SelectInput value={form.province} onChange={upd("province")}>
            <option value="">— Select province —</option>
            {PROVINCES.map(p => <option key={p}>{p}</option>)}
          </SelectInput>
        </Field>
        <Field label="Country">
          <TextInput value={form.country} onChange={upd("country")} placeholder="South Africa" />
        </Field>
      </div>
    </div>,

    // Step 4 — Additional Information
    <div key="4" className="space-y-4">
      <Field label="Expected Monthly Order Volume">
        <SelectInput value={form.ordering_volume} onChange={upd("ordering_volume")}>
          <option value="">— Select range —</option>
          {ORDER_VOLUMES.map(v => <option key={v}>{v}</option>)}
        </SelectInput>
      </Field>
      <Field label="How did you hear about Bassani Health?">
        <SelectInput value={form.referral_source} onChange={upd("referral_source")}>
          <option value="">— Select source —</option>
          {REFERRAL_SOURCES.map(r => <option key={r}>{r}</option>)}
        </SelectInput>
      </Field>
      <Field label="Additional Notes">
        <Textarea value={form.notes} onChange={upd("notes")} placeholder="Any special requirements, delivery preferences, or additional context…" rows={4} />
      </Field>
      <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-700">
        <strong>Documents:</strong> Additional compliance documents (e.g. licence copies, banking details) may be requested during the review process. Your account manager will follow up directly.
      </div>
    </div>,
  ];

  // ── Layout ──────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Top bar */}
      <div className="shrink-0 bg-white border-b border-gray-100 px-6 py-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-gray-900">Onboard New Customer</p>
          <p className="text-xs text-gray-400">Complete all steps to submit for admin approval</p>
        </div>
        <button onClick={() => navigate("/customers")}
          className="text-xs text-gray-500 hover:text-gray-700 font-medium transition-colors">
          ← Back to Customers
        </button>
      </div>

      <div className="flex-1 overflow-y-auto bg-gray-50 p-6">
        <div className="max-w-2xl mx-auto space-y-6">

          {/* Step indicators */}
          <div className="flex items-center gap-0">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const done    = i < step;
              const current = i === step;
              return (
                <div key={i} className="flex items-center flex-1 last:flex-none">
                  <div className={`flex items-center gap-2 shrink-0 ${current ? "text-bassani-700" : done ? "text-bassani-500" : "text-gray-300"}`}>
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-colors
                      ${current ? "border-bassani-600 bg-bassani-600 text-white"
                               : done ? "border-bassani-500 bg-bassani-50 text-bassani-600"
                               : "border-gray-200 bg-white text-gray-300"}`}>
                      {done ? <CheckCircle size={14} /> : <Icon size={14} />}
                    </div>
                    <span className={`text-xs font-semibold hidden sm:block ${current ? "text-bassani-700" : done ? "text-bassani-500" : "text-gray-300"}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < STEPS.length - 1 && (
                    <div className={`flex-1 h-px mx-3 ${i < step ? "bg-bassani-300" : "bg-gray-200"}`} />
                  )}
                </div>
              );
            })}
          </div>

          {/* Form card */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
            <div className="px-6 py-5 border-b border-gray-50">
              <div className="flex items-center gap-2">
                {(() => { const Icon = STEPS[step].icon; return <Icon size={16} className="text-bassani-600" />; })()}
                <h2 className="text-sm font-bold text-gray-900">{STEPS[step].label}</h2>
                <span className="ml-auto text-xs text-gray-400">Step {step + 1} of {STEPS.length}</span>
              </div>
            </div>
            <div className="px-6 py-5">
              {stepContent[step]}
            </div>
            <div className="px-6 py-4 bg-gray-50/50 rounded-b-2xl border-t border-gray-50 flex justify-between">
              {step > 0 ? (
                <button onClick={back}
                  className="px-4 py-2 text-sm font-semibold text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-white transition-colors">
                  ← Back
                </button>
              ) : (
                <button onClick={() => navigate("/customers")}
                  className="px-4 py-2 text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors">
                  Cancel
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button onClick={next}
                  className="px-5 py-2 bg-bassani-600 hover:bg-bassani-700 text-white text-sm font-semibold rounded-lg transition-colors">
                  Continue →
                </button>
              ) : (
                <button onClick={submit} disabled={submitting}
                  className="px-5 py-2 bg-bassani-600 hover:bg-bassani-700 text-white text-sm font-semibold rounded-lg transition-colors disabled:opacity-50">
                  {submitting ? "Submitting…" : "Submit Application"}
                </button>
              )}
            </div>
          </div>

          {/* Summary sidebar — show entered data as user progresses */}
          {step > 0 && (
            <div className="bg-white rounded-xl border border-gray-100 px-5 py-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Application Summary</p>
              <div className="space-y-1.5 text-xs">
                {form.company_name && <div className="flex justify-between"><span className="text-gray-400">Company</span><span className="font-medium text-gray-700">{form.company_name}</span></div>}
                {form.business_type && <div className="flex justify-between"><span className="text-gray-400">Type</span><span className="font-medium text-gray-700">{form.business_type}</span></div>}
                {step > 1 && form.contact_name && <div className="flex justify-between"><span className="text-gray-400">Contact</span><span className="font-medium text-gray-700">{form.contact_name}</span></div>}
                {step > 1 && form.contact_email && <div className="flex justify-between"><span className="text-gray-400">Email</span><span className="font-medium text-gray-700">{form.contact_email}</span></div>}
                {step > 2 && form.city && <div className="flex justify-between"><span className="text-gray-400">City</span><span className="font-medium text-gray-700">{form.city}{form.province ? `, ${form.province}` : ""}</span></div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
