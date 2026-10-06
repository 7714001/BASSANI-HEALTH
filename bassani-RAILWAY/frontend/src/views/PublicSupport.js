// Public help pages — Phase 28. No auth. Reached from signed links in the
// emails a customer already receives (support_links.py), so a customer with
// NO portal login can still raise a query or complaint about an order, rate
// it once collected, and follow a request up:
//   /help/order/:token  — one order: raise a request, see existing ones, rate it
//   /help/case/:token   — one request: read the thread, reply, reopen, rate
// Like SigningPage.js / RecurringOrderReview.js, deliberately independent of
// UI.js and AuthContext.
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useLocation } from "react-router-dom";
import { Loader2, AlertTriangle, Package, ChevronRight, CheckCircle2, LifeBuoy, ChevronLeft } from "lucide-react";
import api from "../api";
import {
  CaseFormFields, EMPTY_CASE_FORM, caseFormError, appendCaseForm, CaseThread, ReplyComposer,
  RatingForm, StarRating, SupportStatusBadge, SUPPORT_CATEGORIES, fmtWhen, RATING_WORDS,
} from "../components/SupportKit";

const inputCls = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 bg-gray-50 focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 placeholder-gray-400";
const errMsg = (e, fallback) => e.response?.data?.detail || fallback;

function Shell({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
          <img src="/logo.png" alt="Bassani Health" className="h-8 object-contain" />
          <Link to="/login" className="text-xs font-medium text-gray-500 hover:text-bassani-700">Have a portal login? Sign in</Link>
        </div>
      </header>
      <main className="max-w-3xl mx-auto px-4 py-6 space-y-4">{children}</main>
    </div>
  );
}

function Card({ children, className = "" }) {
  return <div className={`bg-white rounded-2xl border border-gray-100 shadow-sm p-5 ${className}`}>{children}</div>;
}

function Loading() {
  return (
    <Shell>
      <div className="flex flex-col items-center gap-3 py-24">
        <Loader2 size={28} className="animate-spin text-bassani-500" />
        <p className="text-sm text-gray-500">Loading…</p>
      </div>
    </Shell>
  );
}

function LinkError({ message }) {
  return (
    <Shell>
      <Card className="text-center py-10">
        <AlertTriangle size={28} className="mx-auto text-amber-500 mb-3" />
        <p className="text-sm font-semibold text-gray-900">We couldn't open this page</p>
        <p className="text-sm text-gray-500 mt-1">{message}</p>
      </Card>
    </Shell>
  );
}

function Notice({ tone = "green", children }) {
  const cls = tone === "green" ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800";
  return <div className={`rounded-xl border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}

// ── /help/order/:token ───────────────────────────────────────────────────────

export function PublicOrderHelp() {
  const { token } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const wantsFeedback = new URLSearchParams(location.search).get("feedback") === "1";

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(EMPTY_CASE_FORM);
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [formError, setFormError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [showForm, setShowForm] = useState(!wantsFeedback);
  const [feedbackResult, setFeedbackResult] = useState(null);
  const [feedbackError, setFeedbackError] = useState(null);

  useEffect(() => {
    api.get(`/api/public/support/order/${token}`)
      .then((r) => setData(r.data))
      .catch((e) => setError(errMsg(e, "This link is not valid or has expired.")));
  }, [token]);

  if (error) return <LinkError message={error} />;
  if (!data) return <Loading />;
  const { order, cases, feedback, feedback_eligible } = data;

  const submit = async () => {
    const err = caseFormError(form)
      || (contactName.trim().length < 2 ? "Please enter your name" : null)
      || (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim()) ? "Please enter a valid email address so we can reply to you" : null);
    if (err) { setFormError(err); return; }
    setFormError(null);
    setSubmitting(true);
    try {
      const fd = appendCaseForm(new FormData(), form);
      fd.append("contact_name", contactName.trim());
      fd.append("contact_email", contactEmail.trim());
      const r = await api.post(`/api/public/support/order/${token}/cases`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      navigate(`/help/case/${r.data.case_token}?new=1`);
    } catch (e) {
      setFormError(errMsg(e, "Something went wrong sending your request. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const submitFeedback = async (rating, comment) => {
    setFeedbackError(null);
    try {
      const r = await api.post(`/api/public/support/order/${token}/feedback`, { rating, comment });
      setFeedbackResult(r.data);
    } catch (e) {
      setFeedbackError(errMsg(e, "We couldn't save your rating. Please try again."));
      throw e;
    }
  };

  const productNames = [...new Set((order.lines || []).map((l) => l.product_name).filter(Boolean))];

  return (
    <Shell>
      <Card>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">Order</p>
            <p className="text-lg font-semibold text-gray-900">{order.name}</p>
            <p className="text-sm text-gray-500">{order.customer_name}{order.date ? ` · ${new Date(order.date).toLocaleDateString("en-ZA", { day: "numeric", month: "short", year: "numeric" })}` : ""}</p>
          </div>
          <Package size={22} className="text-bassani-500 shrink-0" />
        </div>
        {order.lines?.length > 0 && (
          <div className="mt-4 border-t border-gray-100 pt-3 space-y-1">
            {order.lines.map((l, i) => (
              <div key={i} className="flex justify-between gap-3 text-sm">
                <span className="text-gray-700 min-w-0 truncate">{l.product_name}</span>
                <span className="text-gray-500 shrink-0">x {l.qty}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Order rating */}
      {feedback_eligible && (feedback || feedbackResult) ? (
        <Card>
          <div className="flex items-center gap-3">
            <StarRating value={feedbackResult?.rating || feedback?.rating} readOnly size={18} />
            <p className="text-sm text-gray-700">Thank you for rating this order.</p>
          </div>
          {feedbackResult?.case_ref && (
            <p className="text-sm text-gray-500 mt-2">
              We're sorry it wasn't a better experience. We've opened request <strong>{feedbackResult.case_ref}</strong> and someone from our team will be in touch.
            </p>
          )}
        </Card>
      ) : feedback_eligible && (
        <Card className={wantsFeedback ? "ring-2 ring-bassani-600/20" : ""}>
          <RatingForm title="How was this order?" subtitle="Your rating helps us improve. It takes less than a minute." onSubmit={submitFeedback} />
          {feedbackError && <div className="mt-3"><Notice tone="red">{feedbackError}</Notice></div>}
        </Card>
      )}

      {/* Existing requests */}
      {cases.length > 0 && (
        <Card>
          <p className="text-sm font-semibold text-gray-900 mb-2">Requests about this order</p>
          <div className="divide-y divide-gray-100">
            {cases.map((c) => (
              <Link key={c.ref} to={`/help/case/${c.case_token}`} className="flex items-center justify-between gap-3 py-2.5 group">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate group-hover:text-bassani-700">{c.subject}</p>
                  <p className="text-xs text-gray-400">{c.ref} · {fmtWhen(c.created_at)}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <SupportStatusBadge status={c.status} external />
                  <ChevronRight size={14} className="text-gray-300" />
                </div>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* New request */}
      <Card>
        {!showForm ? (
          <button onClick={() => setShowForm(true)} className="w-full flex items-center justify-between text-left">
            <span>
              <span className="block text-sm font-semibold text-gray-900">Something not right with this order?</span>
              <span className="block text-xs text-gray-500">Raise a query or complaint and our team will get back to you.</span>
            </span>
            <LifeBuoy size={20} className="text-bassani-600" />
          </button>
        ) : (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">Raise a query or complaint</p>
              <p className="text-xs text-gray-500">About order {order.name}. We'll email you a reference number and a link to follow it up.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Your name<span className="text-red-400 ml-0.5">*</span></p>
                <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputCls} />
              </div>
              <div>
                <p className="text-xs font-semibold text-gray-600 mb-1.5">Your email<span className="text-red-400 ml-0.5">*</span></p>
                <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} className={inputCls} />
              </div>
            </div>
            <CaseFormFields value={form} onChange={setForm} productOptions={productNames}
              categories={SUPPORT_CATEGORIES} onFileError={setFormError} />
            {formError && <Notice tone="red">{formError}</Notice>}
            <button onClick={submit} disabled={submitting}
              className="w-full sm:w-auto inline-flex items-center justify-center gap-2 text-sm font-semibold text-white bg-bassani-600 hover:bg-bassani-700 rounded-lg px-5 py-2.5 disabled:opacity-50">
              {submitting && <Loader2 size={14} className="animate-spin" />}Send Request
            </button>
          </div>
        )}
      </Card>
    </Shell>
  );
}

// ── /help/case/:token ────────────────────────────────────────────────────────

export function PublicCaseHelp() {
  const { token } = useParams();
  const location = useLocation();
  const isNew = new URLSearchParams(location.search).get("new") === "1";
  const [c, setC] = useState(null);
  const [error, setError] = useState(null);
  const [actionError, setActionError] = useState(null);

  const load = useCallback(() => {
    api.get(`/api/public/support/case/${token}`)
      .then((r) => setC(r.data))
      .catch((e) => setError(errMsg(e, "This link is not valid or has expired.")));
  }, [token]);
  useEffect(() => { load(); }, [load]);

  if (error) return <LinkError message={error} />;
  if (!c) return <Loading />;

  const download = async (att) => {
    try {
      const r = await api.get(`/api/public/support/case/${token}/attachments/${att.id}`);
      window.open(r.data.url, "_blank", "noopener,noreferrer");
    } catch (e) { setActionError(errMsg(e, "Could not open that file.")); }
  };
  const reply = async ({ body, files }) => {
    setActionError(null);
    const fd = new FormData();
    fd.append("body", body);
    for (const f of files || []) fd.append("files", f);
    try {
      const r = await api.post(`/api/public/support/case/${token}/messages`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setC(r.data);
    } catch (e) { setActionError(errMsg(e, "Your reply couldn't be sent. Please try again.")); throw e; }
  };
  const rate = async (rating, comment) => {
    setActionError(null);
    try {
      const r = await api.post(`/api/public/support/case/${token}/feedback`, { rating, comment });
      setC(r.data);
    } catch (e) { setActionError(errMsg(e, "We couldn't save your rating. Please try again.")); throw e; }
  };

  return (
    <Shell>
      {isNew && (
        <Notice>
          <span className="inline-flex items-center gap-1.5 font-semibold"><CheckCircle2 size={15} />Request received</span>
          <span className="block mt-0.5">Your reference is <strong>{c.ref}</strong>. We've emailed you a copy with a link back to this page.</span>
        </Notice>
      )}
      <Card>
        <p className="text-[11px] font-bold uppercase tracking-wider text-gray-400">{c.ref}</p>
        <p className="text-lg font-semibold text-gray-900">{c.subject}</p>
        <div className="flex flex-wrap items-center gap-2 mt-1.5">
          <SupportStatusBadge status={c.status} external />
          <span className="text-xs text-gray-500">{c.category_label}{c.order_name ? ` · Order ${c.order_name}` : ""}</span>
        </div>
      </Card>

      <CaseThread messages={c.messages} viewer="external" onDownload={download} />

      {c.status === "resolved" && !c.csat && (
        <Card className="bg-green-50 border-green-200">
          <RatingForm title="Has this resolved your request?"
            subtitle="Rate how we did to close it. If you still need help, reply below instead and we'll reopen it."
            submitLabel="Confirm and Rate" onSubmit={rate} />
        </Card>
      )}
      {c.status === "closed" && !c.csat && (
        <Card><RatingForm title="How did we do?" onSubmit={rate} /></Card>
      )}
      {c.csat && (
        <Card className="flex items-center gap-3">
          <StarRating value={c.csat.rating} readOnly size={16} />
          <span className="text-sm text-gray-600">Thank you for your rating ({RATING_WORDS[c.csat.rating].toLowerCase()}).</span>
        </Card>
      )}

      {actionError && <Notice tone="red">{actionError}</Notice>}

      {c.status === "closed" ? (
        <p className="text-sm text-gray-500 text-center">This request is closed. If you need more help, please use the link in your order email to raise a new request.</p>
      ) : (
        <ReplyComposer onSubmit={reply}
          placeholder={c.status === "resolved" ? "Still need help? Reply here and we'll reopen your request" : "Add more information or reply to our team"}
          onFileError={setActionError} />
      )}
      <Link to="/login" className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600"><ChevronLeft size={12} />Portal sign in</Link>
    </Shell>
  );
}
