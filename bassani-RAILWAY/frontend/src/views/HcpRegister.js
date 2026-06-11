import { useState } from "react";
import { CheckCircle, ChevronRight, ChevronLeft, Package } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";

// ── Primitives ─────────────────────────────────────────────────────────────────

function Label({ children, required }) {
  return (
    <label className="block text-xs font-semibold text-gray-600 mb-1.5">
      {children}{required && <span className="text-red-500 ml-0.5">*</span>}
    </label>
  );
}

function Field({ label, required, children }) {
  return (
    <div>
      <Label required={required}>{label}</Label>
      {children}
    </div>
  );
}

const inputCls = "w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 bg-white transition-all";
const selectCls = inputCls + " cursor-pointer";

function TextInput({ value, onChange, placeholder, type = "text", ...rest }) {
  return <input type={type} value={value} onChange={onChange} placeholder={placeholder}
    className={inputCls} {...rest} />;
}

function SelectInput({ value, onChange, children }) {
  return <select value={value} onChange={onChange} className={selectCls}>{children}</select>;
}

function Textarea({ value, onChange, placeholder, rows = 3 }) {
  return <textarea value={value} onChange={onChange} placeholder={placeholder} rows={rows}
    className={inputCls + " resize-none"} />;
}

function Checkbox({ id, checked, onChange, label, sub }) {
  return (
    <label htmlFor={id} className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${checked ? "border-bassani-400 bg-bassani-50" : "border-gray-200 hover:bg-gray-50"}`}>
      <input type="checkbox" id={id} checked={checked} onChange={onChange}
        className="mt-0.5 accent-bassani-600 w-4 h-4 shrink-0" />
      <div>
        <p className="text-sm font-medium text-gray-800">{label}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
    </label>
  );
}

// ── Progress bar ───────────────────────────────────────────────────────────────

const STEPS = ["Your Profile", "Your Practice", "Prescribing & Section 21", "Requests"];

function ProgressBar({ step }) {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-2">
        {STEPS.map((s, i) => (
          <div key={s} className="flex items-center">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold transition-colors
              ${i < step ? "bg-bassani-600 text-white" : i === step ? "bg-bassani-600 text-white ring-4 ring-bassani-100" : "bg-gray-100 text-gray-400"}`}>
              {i < step ? <CheckCircle size={14} /> : i + 1}
            </div>
            {i < STEPS.length - 1 && (
              <div className={`h-0.5 w-8 sm:w-16 mx-1 transition-colors ${i < step ? "bg-bassani-600" : "bg-gray-200"}`} />
            )}
          </div>
        ))}
      </div>
      <p className="text-xs text-gray-400">Step {step + 1} of {STEPS.length} — <span className="font-medium text-gray-600">{STEPS[step]}</span></p>
    </div>
  );
}

// ── Step components ────────────────────────────────────────────────────────────

function Step1({ form, set }) {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Full Name" required>
          <TextInput value={form.full_name} onChange={e => set("full_name", e.target.value)} placeholder="Dr. Jane Smith" autoFocus />
        </Field>
        <Field label="HPCSA Registration Number" required>
          <TextInput value={form.hpcsa_number} onChange={e => set("hpcsa_number", e.target.value)} placeholder="MP0123456" />
        </Field>
      </div>
      <Field label="Profession" required>
        <SelectInput value={form.profession} onChange={e => set("profession", e.target.value)}>
          <option value="">Select profession…</option>
          {["GP", "Specialist", "Pharmacist", "Nurse"].map(p => <option key={p} value={p}>{p}</option>)}
        </SelectInput>
      </Field>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Email Address" required>
          <TextInput type="email" value={form.email} onChange={e => set("email", e.target.value)} placeholder="jane@practice.co.za" />
        </Field>
        <Field label="Phone Number" required>
          <TextInput type="tel" value={form.phone} onChange={e => set("phone", e.target.value)} placeholder="+27 11 555 1234" />
        </Field>
      </div>
    </div>
  );
}

function Step2({ form, set }) {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Practice / Facility Name" required>
          <TextInput value={form.practice_name} onChange={e => set("practice_name", e.target.value)} placeholder="Sandton Medical Centre" />
        </Field>
        <Field label="Practice Location" required>
          <TextInput value={form.practice_location} onChange={e => set("practice_location", e.target.value)} placeholder="Sandton, Johannesburg" />
        </Field>
      </div>
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Practice Type" required>
          <SelectInput value={form.practice_type} onChange={e => set("practice_type", e.target.value)}>
            {["Private", "Public", "Both"].map(t => <option key={t} value={t}>{t}</option>)}
          </SelectInput>
        </Field>
        <Field label="Years in Practice" required>
          <SelectInput value={form.years_in_practice} onChange={e => set("years_in_practice", e.target.value)}>
            <option value="">Select…</option>
            <option value={1}>Less than 2 years</option>
            <option value={3}>2–5 years</option>
            <option value={7}>5–10 years</option>
            <option value={15}>10–20 years</option>
            <option value={25}>20+ years</option>
          </SelectInput>
        </Field>
      </div>
    </div>
  );
}

function Step3({ form, set }) {
  return (
    <div className="space-y-4">
      <div className="grid sm:grid-cols-2 gap-4">
        <Field label="Currently prescribing medical cannabis?" required>
          <SelectInput value={form.currently_prescribing} onChange={e => set("currently_prescribing", e.target.value)}>
            {["Yes", "No", "Planning"].map(v => <option key={v} value={v}>{v === "Planning" ? "Planning to" : v}</option>)}
          </SelectInput>
        </Field>
        <Field label="Estimated patients per month" required>
          <SelectInput value={form.estimated_patients} onChange={e => set("estimated_patients", e.target.value)}>
            <option value="">Select…</option>
            {["1–5", "6–15", "16–30", "31–50", "50+"].map(v => <option key={v} value={v}>{v}</option>)}
          </SelectInput>
        </Field>
      </div>
      <Field label="Conditions of interest" required>
        <Textarea value={form.conditions_of_interest} onChange={e => set("conditions_of_interest", e.target.value)}
          placeholder="e.g. chronic pain, anxiety, insomnia, epilepsy, palliative care…" />
      </Field>

      <div className="pt-2 border-t border-gray-100">
        <p className="text-sm font-semibold text-gray-700 mb-3">Section 21 Authorisation</p>
        <Field label="How familiar are you with the Section 21 process?" required>
          <SelectInput value={form.section21_familiar} onChange={e => set("section21_familiar", e.target.value)}>
            {[["Yes", "Very familiar"], ["Somewhat", "Somewhat familiar"], ["No", "Not familiar yet"]].map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </SelectInput>
        </Field>
        {(form.section21_familiar === "Yes" || form.section21_familiar === "Somewhat") && (
          <div className="mt-3">
            <Field label="Describe your Section 21 experience (optional)">
              <Textarea value={form.section21_experience} onChange={e => set("section21_experience", e.target.value)}
                placeholder="Tell us about your experience with Section 21 applications and patient outcomes…" />
            </Field>
          </div>
        )}
      </div>
    </div>
  );
}

function Step4({ form, set }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-gray-700 mb-3">How can we support you?</p>
        <div className="space-y-2">
          <Checkbox id="training" checked={form.interested_in_training}
            onChange={e => set("interested_in_training", e.target.checked)}
            label="Training & Education"
            sub="Access to CME-accredited webinars and clinical guidance on medical cannabis prescribing" />
          <Checkbox id="catalog" checked={form.request_product_catalog}
            onChange={e => set("request_product_catalog", e.target.checked)}
            label="Product Catalogue"
            sub="Full Bassani Health product listing with dosing guides and clinical data" />
          <Checkbox id="consult" checked={form.schedule_consultation}
            onChange={e => set("schedule_consultation", e.target.checked)}
            label="Schedule a Consultation"
            sub="A one-on-one call with our medical team to discuss your patients' needs" />
        </div>
      </div>
      <Field label="Additional comments or questions">
        <Textarea value={form.additional_comments} onChange={e => set("additional_comments", e.target.value)}
          placeholder="Anything else you'd like us to know…" rows={4} />
      </Field>
    </div>
  );
}

// ── Success screen ─────────────────────────────────────────────────────────────

function Success({ name, reference }) {
  return (
    <div className="text-center py-8">
      <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-5">
        <CheckCircle size={32} className="text-green-600" />
      </div>
      <h2 className="text-xl font-bold text-gray-900 mb-2">Registration received</h2>
      <p className="text-gray-500 text-sm mb-6 max-w-sm mx-auto">
        Thank you, <strong>{name}</strong>. A member of our healthcare team will be in touch within 48 hours.
      </p>
      <div className="inline-block bg-gray-50 border border-gray-200 rounded-xl px-5 py-3 text-sm">
        <p className="text-gray-400 text-xs mb-0.5">Reference number</p>
        <p className="font-mono font-semibold text-gray-700">{reference}</p>
      </div>
      <p className="text-xs text-gray-400 mt-6">
        Questions? Email us at <a href="mailto:healthcare@bassanihealth.com" className="text-bassani-600 underline">healthcare@bassanihealth.com</a>
      </p>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

const BLANK = {
  hpcsa_number: "", profession: "", full_name: "", email: "", phone: "",
  practice_name: "", practice_location: "", practice_type: "Private", years_in_practice: "",
  currently_prescribing: "Planning", conditions_of_interest: "", estimated_patients: "",
  section21_familiar: "No", section21_experience: "",
  interested_in_training: false, request_product_catalog: false, schedule_consultation: false,
  additional_comments: "",
};

const REQUIRED = {
  0: ["full_name", "hpcsa_number", "profession", "email", "phone"],
  1: ["practice_name", "practice_location", "years_in_practice"],
  2: ["conditions_of_interest", "estimated_patients"],
};
const LABELS = {
  full_name: "Full name", hpcsa_number: "HPCSA number", profession: "Profession",
  email: "Email", phone: "Phone", practice_name: "Practice name",
  practice_location: "Practice location", years_in_practice: "Years in practice",
  conditions_of_interest: "Conditions of interest", estimated_patients: "Estimated patients",
};

export default function HcpRegister() {
  const [step,      setStep     ] = useState(0);
  const [form,      setForm     ] = useState(BLANK);
  const [submitting,setSubmitting] = useState(false);
  const [reference, setReference] = useState(null);

  const set = (key, val) => setForm(f => ({ ...f, [key]: val }));

  const validate = () => {
    const required = REQUIRED[step] || [];
    for (const key of required) {
      if (!form[key] && form[key] !== 0) {
        toast.error(`${LABELS[key] || key} is required`);
        return false;
      }
    }
    if (step === 0 && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      toast.error("Please enter a valid email address");
      return false;
    }
    return true;
  };

  const next = () => {
    if (!validate()) return;
    setStep(s => s + 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const back = () => {
    setStep(s => s - 1);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async () => {
    if (!validate()) return;
    setSubmitting(true);
    try {
      const payload = { ...form, years_in_practice: parseInt(form.years_in_practice) || 1 };
      const r = await api.post("/api/healthcare/onboarding", payload);
      setReference(r.data.reference);
      setStep(4);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      toast.error(e.response?.data?.detail || "Submission failed — please try again");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Left branding panel */}
      <div className="hidden lg:flex w-72 xl:w-80 bg-slate-900 flex-col justify-between p-8 flex-shrink-0">
        <div>
          <div className="w-10 h-10 bg-bassani-600 rounded-xl flex items-center justify-center mb-6">
            <Package size={20} color="white" />
          </div>
          <h1 className="text-white text-xl font-semibold">Bassani Health</h1>
          <p className="text-slate-400 text-sm mt-1">Healthcare Professional Portal</p>

          <div className="mt-10 space-y-6">
            {[
              ["Section 21 Authorisation", "We guide you through the SAHPRA Section 21 process from start to finish."],
              ["Clinical Support", "Access to our medical team for dosing guidance and patient management."],
              ["Training & CPD", "CME-accredited educational content on medical cannabis prescribing."],
              ["Quality Products", "SAHPRA-approved medical cannabis products with full lab testing."],
            ].map(([title, desc]) => (
              <div key={title} className="flex gap-3">
                <div className="w-1.5 h-1.5 rounded-full bg-bassani-500 mt-1.5 shrink-0" />
                <div>
                  <p className="text-slate-200 text-sm font-medium">{title}</p>
                  <p className="text-slate-500 text-xs mt-0.5 leading-relaxed">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
        <p className="text-slate-600 text-xs">
          Bassani Health (Pty) Ltd · Registered with SAHPRA
        </p>
      </div>

      {/* Form panel */}
      <div className="flex-1 flex flex-col items-center justify-start py-10 px-4 overflow-y-auto">
        {/* Mobile logo */}
        <div className="flex items-center gap-2 mb-8 lg:hidden">
          <div className="w-8 h-8 bg-bassani-600 rounded-lg flex items-center justify-center">
            <Package size={16} color="white" />
          </div>
          <span className="font-semibold text-gray-800">Bassani Health</span>
        </div>

        <div className="w-full max-w-xl">
          {step < 4 && (
            <>
              <div className="mb-6">
                <h2 className="text-2xl font-bold text-gray-900">Healthcare Professional Registration</h2>
                <p className="text-gray-500 text-sm mt-1">
                  Register to access Section 21 authorisations, clinical support, and Bassani Health products.
                </p>
              </div>
              <ProgressBar step={step} />
            </>
          )}

          <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
            {step === 0 && <Step1 form={form} set={set} />}
            {step === 1 && <Step2 form={form} set={set} />}
            {step === 2 && <Step3 form={form} set={set} />}
            {step === 3 && <Step4 form={form} set={set} />}
            {step === 4 && <Success name={form.full_name} reference={reference} />}

            {step < 4 && (
              <div className="flex justify-between items-center mt-6 pt-5 border-t border-gray-100">
                <button onClick={back} disabled={step === 0}
                  className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors disabled:opacity-30 disabled:pointer-events-none">
                  <ChevronLeft size={16} />Back
                </button>
                {step < 3 ? (
                  <button onClick={next}
                    className="flex items-center gap-1.5 bg-bassani-600 hover:bg-bassani-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors">
                    Continue<ChevronRight size={16} />
                  </button>
                ) : (
                  <button onClick={submit} disabled={submitting}
                    className="flex items-center gap-1.5 bg-bassani-600 hover:bg-bassani-700 text-white text-sm font-semibold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-60">
                    {submitting ? "Submitting…" : "Submit Registration"}
                    {!submitting && <ChevronRight size={16} />}
                  </button>
                )}
              </div>
            )}
          </div>

          <p className="text-xs text-gray-400 text-center mt-6">
            By submitting this form you agree to our privacy policy.
            Your information is handled in compliance with POPIA.
          </p>
        </div>
      </div>
    </div>
  );
}
