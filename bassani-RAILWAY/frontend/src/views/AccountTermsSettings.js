// Settings → Account Terms (super admin, 2026-10-14).
// Release on account (8.68/8.71) is switched off portal-wide until Bassani
// start using credit limits (ACCOUNT_TERMS_ENABLED env var, sent to the
// frontend as user.features.account_terms). Everywhere else it's hidden; this
// tab is where a super admin sees what the portal still has on record and
// removes it: customer approvals, orders already released on account (left as
// they are), and no-deposit requests still asking for release on account.
import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, RefreshCw, Trash2, CreditCard } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { BtnSecondary, BtnDanger, Badge, Modal, LoadingState, fmtR, fmtDate } from "../components/UI";
import { useAuth } from "../AuthContext";

const RELEASE_TYPE_LABEL = { exception: "One-off release", auto: "Released automatically", account_terms: "On account terms" };

function Section({ title, subtitle, count, children }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-900">{title} <span className="text-gray-400 font-normal">({count})</span></p>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export default function AccountTermsSettings({ embedded = false }) {
  const { feature } = useAuth();
  const navigate = useNavigate();
  const accountTermsOn = feature("account_terms");
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [removeConfirm, setRemoveConfirm] = useState(null);
  const [removing, setRemoving]       = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get("/api/customers/account-terms-records");
      setData(data);
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not load account terms");
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const doRemove = async () => {
    const target = removeConfirm;
    setRemoving(true);
    try {
      const { data } = await api.delete(`/api/customers/${target.partner_id}/account-terms`);
      setRemoveConfirm(null);
      if (data.warning) toast(data.warning, { icon: "⚠️", duration: 8000 });
      else toast.success(`Account terms removed for ${target.name}`);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Could not remove account terms");
    } finally {
      setRemoving(false);
    }
  };

  const openTicket = (ticketId) => navigate("/tickets/sales", { state: { openTicketId: ticketId } });

  const customers = data?.customers || [];
  const released  = data?.released_orders || [];
  const requests  = data?.pending_requests || [];

  const content = (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto w-full space-y-4">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-semibold text-gray-900">Account Terms</p>
              {accountTermsOn
                ? <Badge color="teal">Switched on</Badge>
                : <Badge color="gray">Switched off</Badge>}
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              {accountTermsOn
                ? "Customers can be approved for account terms, and orders released on account without a deposit."
                : "Release on account is switched off until Bassani start using credit limits. Every order needs a 50% deposit or Pay Before Collection, and account terms are hidden everywhere else in the portal. Switching it back on is a server setting (ACCOUNT_TERMS_ENABLED)."}
            </p>
          </div>
          <BtnSecondary onClick={load} disabled={loading}>
            {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            Refresh
          </BtnSecondary>
        </div>

        {loading && !data ? <LoadingState /> : (
          <>
            <Section
              title="Customers with account terms on record"
              subtitle="Removing deletes the approval. The payment terms and credit limit it set in Odoo are cleared too, but only where Odoo still holds what the approval set."
              count={customers.length}
            >
              {customers.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">No customer has account terms on record.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-xs text-gray-500">
                    <tr>
                      <th className="text-left font-medium px-4 py-2">Customer</th>
                      <th className="text-left font-medium px-4 py-2">Status</th>
                      <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Terms</th>
                      <th className="text-left font-medium px-4 py-2 hidden md:table-cell">Approved</th>
                      <th className="px-4 py-2" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {customers.map(c => {
                      const t = c.account_terms || {};
                      return (
                        <tr key={c.partner_id}>
                          <td className="px-4 py-2.5">
                            <button onClick={() => navigate(`/customers/${c.partner_id}`)} className="font-medium text-bassani-700 hover:underline text-left">{c.name}</button>
                            {t.company_names?.length > 0 && <p className="text-xs text-gray-400">{t.company_names.join(", ")}</p>}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge color={t.status === "approved" ? "teal" : "red"}>{t.status === "approved" ? "Approved" : "Suspended"}</Badge>
                          </td>
                          <td className="px-4 py-2.5 hidden md:table-cell text-xs text-gray-600">
                            {t.payment_term_name || "Not set"}, limit {fmtR(t.credit_limit)}
                            {t.reference && <p className="text-gray-400">Ref {t.reference}</p>}
                          </td>
                          <td className="px-4 py-2.5 hidden md:table-cell text-xs text-gray-500">
                            {t.approved_by_name || "Unknown"}<p className="text-gray-400">{fmtDate(t.approved_at)}</p>
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <BtnDanger onClick={() => setRemoveConfirm(c)}><Trash2 size={12} />Remove</BtnDanger>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </Section>

            <Section
              title="Orders released on account, still in progress"
              subtitle="These keep their arrangement: the full invoice is raised unpaid at Mark Complete, due per the terms on the order, and Finance records payment when it arrives."
              count={released.length}
            >
              {released.length === 0 ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">No orders released on account are in progress.</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {released.map(o => (
                    <button key={o.ticket_id} onClick={() => openTicket(o.ticket_id)} className="w-full text-left px-4 py-2.5 hover:bg-gray-50 flex items-center gap-3">
                      <CreditCard size={14} className="text-teal-500 shrink-0" />
                      <span className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-900">{o.order_name || `Order #${o.order_id}`}</span>
                        <span className="text-sm text-gray-500"> · {o.customer_name}</span>
                        <span className="block text-xs text-gray-400">
                          {RELEASE_TYPE_LABEL[o.release_type] || "On account"}{o.payment_term ? `, ${o.payment_term}` : ""}
                          {" · "}released by {o.released_by_name || "staff"} on {fmtDate(o.released_at)}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </Section>

            {requests.length > 0 && (
              <Section
                title="Requests still asking for release on account"
                subtitle="Open each ticket and decide it: approve it as pay before collection, or decline so a deposit is paid."
                count={requests.length}
              >
                <div className="divide-y divide-gray-100">
                  {requests.map(r => (
                    <button key={r.ticket_id} onClick={() => openTicket(r.ticket_id)} className="w-full text-left px-4 py-2.5 hover:bg-gray-50">
                      <span className="text-sm font-medium text-gray-900">{r.order_name || `Order #${r.order_id}`}</span>
                      <span className="text-sm text-gray-500"> · {r.customer_name}</span>
                      <span className="block text-xs text-gray-400">Asked by {r.requested_by_name || "staff"}{r.reason ? `: ${r.reason}` : ""}</span>
                    </button>
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {embedded ? content : <div className="flex flex-col flex-1 overflow-hidden">{content}</div>}

      {removeConfirm && (
        <Modal title="Remove Account Terms" onClose={() => !removing && setRemoveConfirm(null)}>
          <p className="text-sm text-gray-700">
            Remove the account terms for <span className="font-semibold">{removeConfirm.name}</span>? This can't be undone;
            they would need to be approved again.
          </p>
          <ul className="mt-3 text-xs text-gray-500 list-disc pl-5 space-y-1">
            <li>The approval is deleted from the portal. The removal is recorded in the audit log, with the terms that were removed.</li>
            <li>
              The payment terms ({removeConfirm.account_terms?.payment_term_name || "not set"}) and credit limit
              ({fmtR(removeConfirm.account_terms?.credit_limit)}) are cleared in Odoo for the companies they covered, unless they've since been changed there.
            </li>
            <li>Orders already released on account are not affected.</li>
          </ul>
          <div className="flex justify-end gap-2 mt-4">
            <BtnSecondary onClick={() => setRemoveConfirm(null)} disabled={removing}>Cancel</BtnSecondary>
            <BtnDanger onClick={doRemove} loading={removing}>Remove</BtnDanger>
          </div>
        </Modal>
      )}
    </>
  );
}
