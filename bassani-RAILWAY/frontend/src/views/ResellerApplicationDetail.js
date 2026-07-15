import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { CheckCircle, XCircle, Clock, ChevronDown } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { LoadingState, fmtDate } from "../components/UI";

// ── Status config ──────────────────────────────────────────────────────────────

const STATUS_CFG = {
  pending:  { label: "Pending Review", cls: "bg-amber-50 border-amber-200 text-amber-700",  icon: Clock },
  approved: { label: "Approved",       cls: "bg-green-50 border-green-200 text-green-700",  icon: CheckCircle },
  rejected: { label: "Rejected",       cls: "bg-red-50   border-red-200   text-red-700",    icon: XCircle },
};

// ── Layout helpers ─────────────────────────────────────────────────────────────

function Section({ title, children, action }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-50 flex items-center justify-between">
        <h3 className="text-sm font-bold text-gray-900">{title}</h3>
        {action}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between py-2.5 border-b border-gray-50 last:border-0 gap-4">
      <span className="text-xs text-gray-400 font-medium shrink-0">{label}</span>
      <span className="text-xs font-semibold text-gray-800 text-right">{value || "—"}</span>
    </div>
  );
}

// ── Application progress stepper ──────────────────────────────────────────────

function ProgressStepper({ app }) {
  const appDocs = app.documents || [];
  const nda = appDocs.find(d => d.doc_type === "nda");
  const soa = appDocs.find(d => d.doc_type === "store_onboarding_agreement");

  const stages = [
    {
      label: "Registration Submitted",
      desc:  app.submitted_at ? `Submitted ${fmtDate(app.submitted_at)}` : "Submitted",
      done:  true,
    },
    {
      label: "Under Review",
      desc:  app.signing_session_generated_at
        ? "Application reviewed — agreements prepared"
        : "Bassani is reviewing your application",
      done:  !!(app.signing_session_generated_at),
    },
    {
      label: "Agreements Sent for Signing",
      desc:  app.signing_session_sent_at
        ? `Sent to customer ${fmtDate(app.signing_session_sent_at)}`
        : "NDA and Store Agreement will be sent to the customer to sign",
      done:  !!(app.signing_session_sent_at),
    },
    {
      label: "Agreements Signed",
      desc:  nda?.signed_in_portal && soa?.signed_in_portal
        ? "Customer has signed both agreements"
        : "Waiting for the customer to sign",
      done:  !!(nda?.signed_in_portal && soa?.signed_in_portal),
    },
    {
      label: "Documents Countersigned",
      desc:  nda?.countersigned_at && soa?.countersigned_at
        ? "All agreements countersigned by Bassani"
        : "Bassani will countersign the customer's agreements",
      done:  !!(nda?.countersigned_at && soa?.countersigned_at),
    },
    {
      label: "Welcome Pack Sent",
      desc:  app.welcome_pack_sent_at
        ? `Welcome pack sent ${fmtDate(app.welcome_pack_sent_at)}`
        : "Welcome pack will be sent after countersigning",
      done:  !!(app.welcome_pack_sent_at),
    },
    {
      label: "Account Active",
      desc:  app.status === "approved"
        ? "Customer account is live and ready to place orders"
        : "Account will be created once all steps are complete",
      done:  app.status === "approved",
    },
  ];

  const isRejected = app.status === "rejected";
  const currentIdx = stages.findIndex(s => !s.done);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-50">
        <h3 className="text-sm font-bold text-gray-900">Application Progress</h3>
      </div>
      <div className="px-6 py-5">
        <div className="relative">
          {stages.map((stage, i) => {
            const isDone    = stage.done;
            const isCurrent = !isRejected && i === currentIdx;
            return (
              <div key={i} className="flex gap-4 pb-5 last:pb-0 relative">
                {i < stages.length - 1 && (
                  <div className={`absolute left-[15px] top-8 w-px bottom-0 ${isDone ? "bg-green-200" : "bg-gray-100"}`} />
                )}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 z-10 ${
                  isDone    ? "bg-green-100" :
                  isCurrent ? "bg-bassani-50 ring-2 ring-bassani-200" :
                              "bg-gray-50"
                }`}>
                  {isDone
                    ? <CheckCircle size={15} className="text-green-600" />
                    : isCurrent
                      ? <Clock size={15} className="text-bassani-600" />
                      : <div className="w-2 h-2 rounded-full bg-gray-200" />
                  }
                </div>
                <div className="flex-1 min-w-0 pt-1">
                  <p className={`text-xs font-semibold ${
                    isDone    ? "text-green-700" :
                    isCurrent ? "text-bassani-700" :
                                "text-gray-400"
                  }`}>{stage.label}</p>
                  <p className={`text-[11px] mt-0.5 leading-relaxed ${
                    isDone    ? "text-green-600" :
                    isCurrent ? "text-gray-500" :
                                "text-gray-300"
                  }`}>{stage.desc}</p>
                </div>
              </div>
            );
          })}

          {isRejected && (
            <div className="flex gap-4 pt-4 border-t border-gray-100 mt-1">
              <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 bg-red-100">
                <XCircle size={15} className="text-red-600" />
              </div>
              <div className="flex-1 min-w-0 pt-1">
                <p className="text-xs font-semibold text-red-700">Application Rejected</p>
                <p className="text-[11px] mt-0.5 text-red-500">
                  {app.rejection_reason || "Please contact Bassani Health for details."}
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ── Main component ─────────────────────────────────────────────────────────────

export default function ResellerApplicationDetail() {
  const { id }     = useParams();
  const navigate   = useNavigate();

  const [app,     setApp   ] = useState(null);
  const [loading, setLoading] = useState(true);

  // Load application
  useEffect(() => {
    api.get(`/api/onboarding/${id}`)
      .then(r => setApp(r.data))
      .catch(() => { toast.error("Application not found"); navigate("/my-applications"); })
      .finally(() => setLoading(false));
  }, [id, navigate]);

  if (loading) return <LoadingState />;
  if (!app)    return null;

  const statusCfg  = STATUS_CFG[app.status] || STATUS_CFG.pending;
  const StatusIcon = statusCfg.icon;

  return (
    <>
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Top bar */}
        <div className="border-b border-gray-100 bg-white px-6 py-3 flex items-center justify-between gap-4 shrink-0">
          <button onClick={() => navigate("/my-applications")}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors">
            <ChevronDown size={14} className="-rotate-90" />Back to Applications
          </button>
        </div>

        <main className="flex-1 overflow-y-auto p-6 bg-gray-50">
          <div className="max-w-4xl mx-auto w-full space-y-5">

            {/* Status header */}
            <div className={`rounded-2xl border px-6 py-5 flex items-start gap-4 ${statusCfg.cls}`}>
              <StatusIcon size={22} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm">{statusCfg.label}</p>
                <p className="text-xs mt-0.5 opacity-80">
                  Reference: <span className="font-mono font-semibold">{app.id}</span>
                  {app.submitted_at && <> · Submitted {fmtDate(app.submitted_at)}</>}
                  {app.reviewed_at  && <> · Reviewed {fmtDate(app.reviewed_at)}</>}
                </p>
                {app.status === "pending" && (
                  <p className="text-xs mt-1 opacity-70">Your application is under review.</p>
                )}
              </div>
            </div>

            {/* Application progress stepper */}
            <ProgressStepper app={app} />

            {/* ── Business Details ── */}
            <Section title="Business Details">
              <Row label="Business Name"     value={app.company_name} />
              <Row label="Trading Name"      value={app.trading_name} />
              <Row label="Registration No."  value={app.registration_number} />
              <Row label="VAT Number"        value={app.vat_number} />
              <Row label="Business Type"     value={app.business_type} />
            </Section>

            {/* ── Contact Details ── */}
            <Section title="Primary Contact">
              <Row label="Name"       value={app.contact_name} />
              <Row label="Position"   value={app.contact_position} />
              <Row label="Email"      value={app.contact_email} />
              <Row label="Phone"      value={app.contact_phone} />
              <Row label="Alt. Phone" value={app.contact_alt_phone} />
            </Section>

            {/* ── Address ── */}
            <Section title="Business Address">
              <Row label="Street"      value={app.street} />
              <Row label="Suburb"      value={app.suburb} />
              <Row label="City"        value={app.city} />
              <Row label="Province"    value={app.province} />
              <Row label="Postal Code" value={app.postal_code} />
              <Row label="Country"     value={app.country} />
            </Section>

            {/* ── Additional Information ── */}
            {(app.ordering_volume || app.referral_source || app.notes) && (
              <Section title="Additional Information">
                <Row label="Monthly Volume" value={app.ordering_volume} />
                <Row label="Referral Source" value={app.referral_source} />
                {app.notes && (
                  <div className="pt-2.5">
                    <p className="text-xs text-gray-400 font-medium mb-1">Notes</p>
                    <p className="text-xs text-gray-700 whitespace-pre-line">{app.notes}</p>
                  </div>
                )}
              </Section>
            )}

          </div>
        </main>
      </div>
    </>
  );
}
