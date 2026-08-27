// Public page — Phase 8.46. No auth. Lets a customer review the draft
// replica order generated 2 days ahead of their next recurring occurrence and
// accept (auto-confirms in Odoo) or decline (cancels the draft, schedule
// continues from the next date).
import { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle, XCircle, Loader2, AlertTriangle, Package } from "lucide-react";
import api from "../api";

const fmtR = (n) =>
  `R ${(n || 0).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function RecurringOrderReview() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [outcome, setOutcome] = useState(null); // "accepted" | "declined" | null
  const [confirmDecline, setConfirmDecline] = useState(false);

  useEffect(() => {
    api.get(`/api/public/recurring/${token}`)
      .then(r => setData(r.data))
      .catch(e => setError(e.response?.data?.detail || "This link is not valid or has expired."))
      .finally(() => setLoading(false));
  }, [token]);

  const accept = async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/public/recurring/${token}/accept`);
      setOutcome("accepted");
    } catch (e) {
      setError(e.response?.data?.detail || "Something went wrong. Please try again or contact us.");
    } finally {
      setSubmitting(false);
    }
  };

  const decline = async () => {
    setSubmitting(true);
    try {
      await api.post(`/api/public/recurring/${token}/decline`);
      setOutcome("declined");
    } catch (e) {
      setError(e.response?.data?.detail || "Something went wrong. Please try again or contact us.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <Loader2 size={28} className="animate-spin text-bassani-500" />
          <p className="text-sm text-gray-500">Loading your order…</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
          <div className="w-14 h-14 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertTriangle size={26} className="text-red-500" />
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-2">Link unavailable</h2>
          <p className="text-sm text-gray-500">{error}</p>
          <p className="text-xs text-gray-400 mt-4">
            If you believe this is an error, please contact us directly.
          </p>
        </div>
      </div>
    );
  }

  if (outcome === "accepted") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-5">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Order confirmed</h2>
          <p className="text-sm text-gray-500">
            Thank you. Your order has been confirmed. We'll be in touch shortly with
            payment details for the deposit due before it moves into fulfilment.
          </p>
        </div>
      </div>
    );
  }

  if (outcome === "declined") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 max-w-md w-full p-8 text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-5">
            <XCircle size={32} className="text-gray-500" />
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Order declined</h2>
          <p className="text-sm text-gray-500">
            No problem. This order will not go ahead. Your regular ordering schedule will continue
            as normal from the next date.
          </p>
        </div>
      </div>
    );
  }

  const scheduledDate = data?.scheduled_for
    ? new Date(data.scheduled_for).toLocaleDateString("en-ZA", { day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Johannesburg" })
    : null;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="bg-white border-b border-gray-100 px-6 py-5">
        <div className="max-w-lg mx-auto">
          <p className="text-xs font-semibold text-bassani-600 uppercase tracking-wider mb-1">Bassani Health</p>
          <h1 className="text-xl font-bold text-gray-900">Review your order</h1>
          <p className="text-sm text-gray-500 mt-1">
            {data?.customer_name ? `Hi ${data.customer_name}, this` : "This"} is your regular order
            {scheduledDate ? `, prepared for ${scheduledDate}` : ""}. Please review and let us know if you'd like to go ahead.
          </p>
        </div>
      </div>

      <main className="max-w-lg mx-auto px-6 py-8 space-y-4">
        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100">
            <div className="w-9 h-9 rounded-xl bg-bassani-50 flex items-center justify-center shrink-0">
              <Package size={16} className="text-bassani-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{data?.order_ref}</p>
              <p className="text-xs text-gray-400">{(data?.lines || []).length} item{(data?.lines || []).length !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {(data?.lines || []).map((l, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0 pr-3">
                  <p className="text-sm text-gray-900 truncate">{l.name}</p>
                  <p className="text-xs text-gray-400">Qty {l.qty}</p>
                </div>
                <p className="text-sm text-gray-600 shrink-0">{fmtR(l.subtotal)}</p>
              </div>
            ))}
          </div>
          <div className="flex items-center justify-between px-5 py-4 border-t border-gray-100 bg-gray-50">
            <p className="text-sm font-semibold text-gray-900">Total</p>
            <p className="text-base font-bold text-gray-900">{fmtR(data?.order_total)}</p>
          </div>
        </div>

        <div className="bg-white border border-gray-100 rounded-2xl shadow-sm p-5 space-y-3">
          {!confirmDecline ? (
            <>
              <button
                onClick={accept}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
              >
                {submitting ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                Accept this order
              </button>
              <button
                onClick={() => setConfirmDecline(true)}
                disabled={submitting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-white hover:bg-gray-50 disabled:opacity-60 text-gray-500 text-sm font-semibold rounded-xl border border-gray-200 transition-colors"
              >
                <XCircle size={15} />
                Decline this order
              </button>
            </>
          ) : (
            <>
              <p className="text-sm text-gray-600 text-center mb-1">
                Are you sure? This order will not go ahead this time.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setConfirmDecline(false)}
                  disabled={submitting}
                  className="flex-1 px-4 py-2.5 bg-white hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-xl border border-gray-200 transition-colors"
                >
                  Go back
                </button>
                <button
                  onClick={decline}
                  disabled={submitting}
                  className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 disabled:opacity-60 text-white text-sm font-semibold rounded-xl transition-colors"
                >
                  {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                  Confirm decline
                </button>
              </div>
            </>
          )}
        </div>

        <p className="text-xs text-gray-400 text-center px-4">
          If you do not respond in time, this order will simply be skipped and your regular
          schedule will continue as normal.
        </p>
      </main>
    </div>
  );
}
