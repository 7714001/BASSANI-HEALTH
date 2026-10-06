// Shared building blocks for the customer support desk (Phase 28).
//
// Deliberately self-contained — no UI.js / AuthContext imports — because the
// public no-login help pages (views/PublicSupport.js, reached from a signed
// link in a customer email) use these too, and public pages in this codebase
// never depend on the authenticated app shell (same convention as
// SigningPage.js / RecurringOrderReview.js).
import { useRef, useState } from "react";
import { Paperclip, X, Star, Loader2, Lock, Download, AlertTriangle, Send } from "lucide-react";

// ── Labels / colours (mirror backend/routes/support_routes.py) ───────────────
export const SUPPORT_CATEGORIES = [
  { key: "order",           label: "Order or delivery",     hint: "Missing or wrong items, delivery or collection questions" },
  { key: "invoice",         label: "Invoice or payment",    hint: "Amounts, payments, statements or credit notes" },
  { key: "product_quality", label: "Product quality complaint", hint: "A problem with a product itself, or a reaction to it" },
  { key: "account",         label: "Account or details",    hint: "Contact details, addresses or portal access" },
  { key: "general",         label: "Something else",        hint: "Anything that doesn't fit the options above" },
];
export const SUPPORT_CATEGORY_LABEL = {
  order: "Order or delivery query", invoice: "Invoice or payment query",
  product_quality: "Product quality complaint", account: "Account or details",
  feedback: "Feedback", general: "General query",
};
export const SUPPORT_STATUS_LABEL = {
  new: "New", open: "Open", awaiting_customer: "Awaiting Customer", resolved: "Resolved", closed: "Closed",
};
// What the CUSTOMER should read for each status — written from their side.
export const SUPPORT_STATUS_LABEL_EXTERNAL = {
  new: "Received", open: "In progress", awaiting_customer: "Awaiting your reply", resolved: "Resolved", closed: "Closed",
};
const STATUS_CLS = {
  new: "bg-blue-50 text-blue-700", open: "bg-amber-50 text-amber-700",
  awaiting_customer: "bg-purple-100 text-purple-700", resolved: "bg-green-50 text-green-700",
  closed: "bg-gray-100 text-gray-600",
};
export const SUPPORT_PRIORITY_LABEL = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent" };
const PRIORITY_CLS = {
  low: "bg-gray-100 text-gray-500", normal: "bg-gray-100 text-gray-600",
  high: "bg-orange-50 text-orange-700", urgent: "bg-red-50 text-red-600",
};

const pill = "inline-block text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap";

export function SupportStatusBadge({ status, external = false }) {
  const label = (external ? SUPPORT_STATUS_LABEL_EXTERNAL : SUPPORT_STATUS_LABEL)[status] || status;
  return <span className={`${pill} ${STATUS_CLS[status] || STATUS_CLS.closed}`}>{label}</span>;
}

export function SupportPriorityBadge({ priority }) {
  return <span className={`${pill} ${PRIORITY_CLS[priority] || PRIORITY_CLS.normal}`}>{SUPPORT_PRIORITY_LABEL[priority] || priority}</span>;
}

const SAST = { timeZone: "Africa/Johannesburg" };
export const fmtWhen = (d) => d
  ? new Date(d).toLocaleString("en-ZA", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...SAST })
  : "";

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-gray-50 focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 transition-all placeholder-gray-400";

// ── Attachments picker ───────────────────────────────────────────────────────
const MAX_FILES = 5;
const MAX_BYTES = 8 * 1024 * 1024;
export const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.gif,.doc,.docx,.xls,.xlsx,.csv,.txt";

export function FilePicker({ files, onChange, onError }) {
  const ref = useRef(null);
  const add = (list) => {
    const next = [...files];
    for (const f of list) {
      if (next.length >= MAX_FILES) { onError?.(`You can attach up to ${MAX_FILES} files`); break; }
      if (f.size > MAX_BYTES) { onError?.(`${f.name} is larger than 8MB`); continue; }
      next.push(f);
    }
    onChange(next);
  };
  return (
    <div>
      <input ref={ref} type="file" multiple accept={ACCEPT} className="hidden"
        onChange={(e) => { add(Array.from(e.target.files || [])); e.target.value = ""; }} />
      <div className="flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={() => ref.current?.click()}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-600 hover:text-bassani-700 border border-gray-200 hover:border-bassani-300 rounded-lg px-2.5 py-1.5 bg-white">
          <Paperclip size={12} />Attach files
        </button>
        {files.map((f, i) => (
          <span key={`${f.name}-${i}`} className="inline-flex items-center gap-1 text-[11px] bg-gray-100 text-gray-700 rounded-full pl-2.5 pr-1 py-0.5 max-w-[220px]">
            <span className="truncate">{f.name}</span>
            <button type="button" onClick={() => onChange(files.filter((_, j) => j !== i))} className="text-gray-400 hover:text-gray-700" aria-label={`Remove ${f.name}`}>
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <p className="text-[10px] text-gray-400 mt-1">Up to {MAX_FILES} files, 8MB each. Photos, PDFs and documents.</p>
    </div>
  );
}

// ── Case form fields (shared by the portal modal and the public order page) ──
// `value` = { category, subject, body, product_name, lot_number, adverse_event, files }
export function CaseFormFields({ value, onChange, productOptions = [], categories = SUPPORT_CATEGORIES, onFileError }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const isQuality = value.category === "product_quality";
  return (
    <div className="space-y-4">
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">What is this about?<span className="text-red-400 ml-0.5">*</span></p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          {categories.map((c) => (
            <button key={c.key} type="button" onClick={() => set({ category: c.key })}
              className={`text-left rounded-xl border px-3 py-2.5 transition-all ${
                value.category === c.key ? "border-bassani-600 bg-bassani-50 ring-2 ring-bassani-600/10" : "border-gray-200 bg-white hover:border-gray-300"
              }`}>
              <p className={`text-sm font-semibold ${value.category === c.key ? "text-bassani-700" : "text-gray-800"}`}>{c.label}</p>
              {c.hint && <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">{c.hint}</p>}
            </button>
          ))}
        </div>
      </div>

      {isQuality && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 space-y-3">
          <p className="text-xs text-amber-800">
            Quality complaints are reviewed by our Quality Assurance team and Responsible Pharmacist.
            Please keep the product and its packaging if you can, as we may ask for it back.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1.5">Product</p>
              <input list="support-product-options" value={value.product_name || ""} onChange={(e) => set({ product_name: e.target.value })}
                placeholder="Which product?" className={inputCls} />
              <datalist id="support-product-options">
                {productOptions.map((p) => <option key={p} value={p} />)}
              </datalist>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1.5">Batch / lot number</p>
              <input value={value.lot_number || ""} onChange={(e) => set({ lot_number: e.target.value })}
                placeholder="Printed on the label, if you have it" className={inputCls} />
            </div>
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-800 cursor-pointer">
            <input type="checkbox" checked={!!value.adverse_event} onChange={(e) => set({ adverse_event: e.target.checked })}
              className="mt-0.5 accent-red-600" />
            <span>
              <span className="font-semibold">Someone had an unexpected reaction or side effect</span>
              <span className="block text-[11px] text-gray-500">This flags your complaint as urgent. If anyone needs medical attention, please contact a doctor first.</span>
            </span>
          </label>
        </div>
      )}

      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">Subject<span className="text-red-400 ml-0.5">*</span></p>
        <input value={value.subject || ""} onChange={(e) => set({ subject: e.target.value })} maxLength={200}
          placeholder="A short summary" className={inputCls} />
      </div>
      <div>
        <p className="text-xs font-semibold text-gray-600 mb-1.5">Message<span className="text-red-400 ml-0.5">*</span></p>
        <textarea value={value.body || ""} onChange={(e) => set({ body: e.target.value })} rows={5} maxLength={5000}
          placeholder="Tell us what happened and how we can help" className={`${inputCls} resize-none`} />
      </div>
      <FilePicker files={value.files || []} onChange={(files) => set({ files })} onError={onFileError} />
    </div>
  );
}

export const EMPTY_CASE_FORM = { category: "", subject: "", body: "", product_name: "", lot_number: "", adverse_event: false, files: [] };

export function caseFormError(v) {
  if (!v.category) return "Please choose what your request is about";
  if ((v.subject || "").trim().length < 3) return "Please enter a subject";
  if (!(v.body || "").trim()) return "Please enter a message";
  return null;
}

export function appendCaseForm(form, v) {
  form.append("category", v.category);
  form.append("subject", v.subject.trim());
  form.append("body", v.body.trim());
  if (v.category === "product_quality") {
    if (v.product_name) form.append("product_name", v.product_name);
    if (v.lot_number) form.append("lot_number", v.lot_number);
    form.append("adverse_event", v.adverse_event ? "true" : "false");
  }
  for (const f of v.files || []) form.append("files", f);
  return form;
}

// ── Conversation thread ──────────────────────────────────────────────────────
// viewer: "staff" shows internal notes (tinted) and real author names;
// "external" never receives internal notes from the API in the first place.
export function CaseThread({ messages = [], viewer = "external", onDownload }) {
  return (
    <div className="space-y-3">
      {messages.map((m) => {
        const internal = m.internal;
        const fromUs = m.is_staff;
        const cls = internal
          ? "bg-yellow-50 border-yellow-200"
          : fromUs ? "bg-bassani-50/60 border-bassani-100" : "bg-white border-gray-200";
        const who = fromUs
          ? (viewer === "external" ? `${m.author?.name || "Our team"}, Bassani Health` : m.author?.name || "Staff")
          : m.author?.name || "Customer";
        return (
          <div key={m.id} className={`rounded-xl border px-4 py-3 ${cls}`}>
            <div className="flex items-center justify-between gap-2 mb-1.5">
              <p className="text-xs font-semibold text-gray-800 flex items-center gap-1.5 min-w-0">
                {internal && <Lock size={11} className="text-yellow-700 shrink-0" />}
                <span className="truncate">{who}</span>
                {internal && <span className="text-[10px] font-semibold text-yellow-700 uppercase tracking-wide">Internal note</span>}
                {m.kind === "resolution" && <span className="text-[10px] font-semibold text-green-700 uppercase tracking-wide">Resolution</span>}
                {viewer === "staff" && !fromUs && <span className="text-[10px] text-gray-400 font-normal">Customer</span>}
              </p>
              <span className="text-[11px] text-gray-400 shrink-0">{fmtWhen(m.at)}</span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap break-words leading-relaxed">{m.body}</p>
            {m.attachments?.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-2.5">
                {m.attachments.map((a) => (
                  <button key={a.id} type="button" onClick={() => onDownload?.(a)}
                    className="inline-flex items-center gap-1.5 text-[11px] font-medium text-bassani-700 bg-white border border-bassani-100 hover:border-bassani-300 rounded-lg px-2 py-1 max-w-[240px]">
                    <Download size={11} className="shrink-0" /><span className="truncate">{a.filename}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Reply composer ───────────────────────────────────────────────────────────
// onSubmit({ body, files, internal }) must return a promise; the composer
// clears itself only when that promise resolves.
export function ReplyComposer({ onSubmit, allowInternal = false, placeholder = "Write a reply…", submitLabel = "Send Reply", note, onFileError }) {
  const [body, setBody] = useState("");
  const [files, setFiles] = useState([]);
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onSubmit({ body: body.trim(), files, internal });
      setBody(""); setFiles([]); setInternal(false);
    } catch { /* caller toasts */ } finally { setBusy(false); }
  };
  return (
    <div className={`rounded-xl border p-3 space-y-2.5 ${internal ? "border-yellow-300 bg-yellow-50/60" : "border-gray-200 bg-white"}`}>
      {allowInternal && (
        <div className="flex gap-1 text-xs">
          <button type="button" onClick={() => setInternal(false)}
            className={`px-2.5 py-1 rounded-md font-medium ${!internal ? "bg-bassani-600 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
            Reply to customer
          </button>
          <button type="button" onClick={() => setInternal(true)}
            className={`px-2.5 py-1 rounded-md font-medium inline-flex items-center gap-1 ${internal ? "bg-yellow-500 text-white" : "text-gray-500 hover:bg-gray-100"}`}>
            <Lock size={11} />Internal note
          </button>
        </div>
      )}
      <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={5000}
        placeholder={internal ? "Only Bassani staff can see this note" : placeholder}
        className={`${inputCls} resize-none bg-white`} />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <FilePicker files={files} onChange={setFiles} onError={onFileError} />
        <button type="button" onClick={submit} disabled={busy || !body.trim()}
          className={`inline-flex items-center gap-1.5 text-sm font-semibold text-white rounded-lg px-4 py-2 disabled:opacity-50 ${internal ? "bg-yellow-600 hover:bg-yellow-700" : "bg-bassani-600 hover:bg-bassani-700"}`}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
          {internal ? "Add Note" : submitLabel}
        </button>
      </div>
      {note && !internal && <p className="text-[11px] text-gray-400">{note}</p>}
    </div>
  );
}

// ── Star rating ──────────────────────────────────────────────────────────────
export const RATING_WORDS = { 1: "Very poor", 2: "Poor", 3: "Okay", 4: "Good", 5: "Excellent" };

export function StarRating({ value = 0, onChange, size = 22, readOnly = false }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className="inline-flex items-center gap-0.5" onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={readOnly}
          onClick={() => onChange?.(n)} onMouseEnter={() => !readOnly && setHover(n)}
          aria-label={`${n} star${n > 1 ? "s" : ""}`}
          className={readOnly ? "cursor-default" : "cursor-pointer"}>
          <Star size={size} className={n <= shown ? "text-amber-400 fill-amber-400" : "text-gray-300"} />
        </button>
      ))}
    </div>
  );
}

// Rating + optional comment, used for both a resolved request (CSAT) and a
// collected order. onSubmit(rating, comment) returns a promise.
export function RatingForm({ title, subtitle, onSubmit, submitLabel = "Submit Rating" }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!rating) return;
    setBusy(true);
    try { await onSubmit(rating, comment.trim()); } catch { /* caller toasts */ } finally { setBusy(false); }
  };
  return (
    <div className="space-y-3">
      {title && <p className="text-sm font-semibold text-gray-900">{title}</p>}
      {subtitle && <p className="text-xs text-gray-500 -mt-2">{subtitle}</p>}
      <div className="flex items-center gap-3">
        <StarRating value={rating} onChange={setRating} />
        {rating > 0 && <span className="text-xs font-medium text-gray-600">{RATING_WORDS[rating]}</span>}
      </div>
      {rating > 0 && (
        <>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={3} maxLength={2000}
            placeholder={rating <= 2 ? "Sorry to hear that. What went wrong? Our team will follow up." : "Anything you'd like to add? (optional)"}
            className={`${inputCls} resize-none bg-white`} />
          <button type="button" onClick={submit} disabled={busy}
            className="inline-flex items-center gap-1.5 text-sm font-semibold text-white bg-bassani-600 hover:bg-bassani-700 rounded-lg px-4 py-2 disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />}{submitLabel}
          </button>
        </>
      )}
    </div>
  );
}

export function AdverseEventBanner() {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
      <AlertTriangle size={14} className="shrink-0 mt-0.5" />
      <span><strong>Possible adverse reaction reported.</strong> Treat as urgent: QA and the Responsible Pharmacist must review, and assess whether a SAHPRA adverse-event report is required.</span>
    </div>
  );
}
