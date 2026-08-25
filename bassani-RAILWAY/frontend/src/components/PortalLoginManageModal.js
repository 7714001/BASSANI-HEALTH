import { useState, useEffect } from "react";
import api from "../api";
import toast from "react-hot-toast";
import { Badge, BtnSecondary, BtnDanger, Modal, LoadingState, fmtDate } from "./UI";

// Shows every company a customer portal login can switch between, looked up
// by email rather than scoped to one company's own profile page — reachable
// from CustomerProfile.js's Portal Access table (context: a specific
// contact under a specific store) and from Users.js's customer-role rows
// (context: a specific login, no store in view). Both pass the same `email`
// prop and get the same view, since it's the same underlying `users`
// document(s) either way.
//
// Also the tool that surfaces and repairs the duplicate-login split
// `grant_portal_access` can produce when two company profiles grant access
// for the same email in close succession (no unique index on `username`,
// only on `companies.odoo_partner_id` — see the backend endpoint's own
// docstring in customer_routes.py). `GET /portal-logins/{email}` returns
// every matching document instead of picking one, so a split shows up here
// directly instead of only being discoverable by reading raw Mongo data.
// `context`, when passed, is the specific company/contact combination the
// modal was opened from — { customerCompanyPartnerId, companyName,
// odooPartnerId }. It exists because the normal Grant Access checkbox on a
// company's own Portal Access table only appears when that page's own
// status lookup says "not provisioned" — if that lookup is ever wrong for a
// given contact (status shows "active" when the login actually has no entry
// for this company at all), the checkbox never renders and there is no way
// to grant it through the normal flow. Passing `context` adds a direct
// "Add this company" action that calls the exact same grant endpoint
// (`POST .../portal-access`) with this specific contact id, bypassing that
// checkbox gate entirely. Only CustomerProfile.js passes this — Users.js's
// bare login rows have no "current company" to offer.
export default function PortalLoginManageModal({ email, onClose, onChanged, context }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [keepId, setKeepId] = useState(null);
  const [confirmingMerge, setConfirmingMerge] = useState(false);
  const [merging, setMerging] = useState(false);
  const [adding, setAdding] = useState(false);

  const load = () => {
    setLoading(true);
    api.get(`/api/customers/portal-logins/${encodeURIComponent(email)}`)
      .then(r => {
        setData(r.data);
        // Default "keep" choice: whichever login has actually been used to
        // log in, so merging never resets a password the customer already
        // knows. Falls back to the first if neither has logged in yet.
        const withLogin = (r.data.logins || []).find(l => l.last_login_at);
        setKeepId((withLogin || r.data.logins?.[0])?.id || null);
      })
      .catch(e => toast.error(e.response?.data?.detail || "Failed to load portal login"))
      .finally(() => setLoading(false));
  };
  useEffect(load, [email]); // eslint-disable-line

  const toggleCompany = async (company) => {
    const key = `${company.customer_company_partner_id}-${company.odoo_partner_id}`;
    setBusyKey(key);
    try {
      await api.post(
        `/api/customers/${company.customer_company_partner_id}/portal-access/${company.odoo_partner_id}/${company.active ? "deactivate" : "reactivate"}`
      );
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to update access");
    } finally {
      setBusyKey(null);
    }
  };

  const contextAlreadyLinked = !!(context && data && data.logins.some(
    l => (l.companies || []).some(c => c.customer_company_partner_id === context.customerCompanyPartnerId)
  ));

  const addCurrentCompany = async () => {
    if (!context) return;
    setAdding(true);
    try {
      const { data: res } = await api.post(`/api/customers/${context.customerCompanyPartnerId}/portal-access`, {
        contact_ids: [context.odooPartnerId],
      });
      if (res.errors?.length) {
        res.errors.forEach(e => toast.error(e.detail));
      } else {
        toast.success(`Added ${context.companyName} to this login`);
      }
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to add company");
    } finally {
      setAdding(false);
    }
  };

  const doMerge = async () => {
    if (!keepId) return;
    setMerging(true);
    try {
      let addedTotal = 0;
      for (const other of data.logins.filter(l => l.id !== keepId)) {
        const { data: res } = await api.post(`/api/customers/portal-logins/${encodeURIComponent(email)}/merge`, {
          keep_user_id: keepId, remove_user_id: other.id,
        });
        addedTotal += res.companies_added;
      }
      toast.success(`Merged into one login (${addedTotal} compan${addedTotal === 1 ? "y" : "ies"} added)`);
      setConfirmingMerge(false);
      load();
      onChanged?.();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Merge failed");
    } finally {
      setMerging(false);
    }
  };

  return (
    <Modal title={`Portal Access — ${email}`} onClose={onClose}>
      {loading ? (
        <LoadingState />
      ) : !data ? (
        <p className="text-sm text-gray-400 py-4">Could not load this login.</p>
      ) : (
        <div className="space-y-4">
          {context && !contextAlreadyLinked && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg px-3.5 py-3 text-xs text-blue-800 flex items-center justify-between gap-3">
              <div>
                <p className="font-semibold">This login doesn't have {context.companyName} yet</p>
                <p className="text-blue-700 mt-0.5">
                  {data.duplicate_logins
                    ? "Merge the duplicate logins below first, then add this company."
                    : "Add it directly here — this bypasses the checkbox on this page's own Portal Access table."}
                </p>
              </div>
              <BtnSecondary size="sm" onClick={addCurrentCompany} disabled={adding || data.duplicate_logins}>
                {adding ? "Adding…" : "Add This Company"}
              </BtnSecondary>
            </div>
          )}

          {data.duplicate_logins && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3.5 py-3 text-xs text-amber-800 space-y-2.5">
              <p className="font-semibold">Two separate login records share this email</p>
              <p className="text-amber-700">
                This can happen when portal access is granted on two company profiles at nearly the same time.
                Each login below only sees the company it was granted against. Pick which one to keep, then merge
                the other's companies into it.
              </p>
              {!confirmingMerge ? (
                <div className="flex items-center gap-2 flex-wrap">
                  <select
                    value={keepId || ""}
                    onChange={e => setKeepId(e.target.value)}
                    className="text-xs border border-amber-300 rounded-md px-2 py-1 bg-white"
                  >
                    {data.logins.map(l => (
                      <option key={l.id} value={l.id}>
                        Keep: {l.last_login_at ? `logged in ${fmtDate(l.last_login_at)}` : "never logged in"} ({l.companies.length} co.)
                      </option>
                    ))}
                  </select>
                  <BtnSecondary size="sm" onClick={() => setConfirmingMerge(true)}>Merge Into Selected</BtnSecondary>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <span className="text-amber-800">Merge the other login's companies in and delete it? This can't be undone.</span>
                  <BtnSecondary size="sm" onClick={() => setConfirmingMerge(false)}>Cancel</BtnSecondary>
                  <BtnDanger onClick={doMerge} disabled={merging}>{merging ? "Merging…" : "Confirm Merge"}</BtnDanger>
                </div>
              )}
            </div>
          )}

          {data.logins.map(login => (
            <div key={login.id} className="border border-gray-100 rounded-xl overflow-hidden">
              <div className="bg-gray-50 px-3.5 py-2 text-xs text-gray-500">
                <span className="font-medium text-gray-700">{login.name || "—"}</span>
                {login.last_login_at
                  ? ` · last login ${fmtDate(login.last_login_at)}`
                  : " · never logged in"}
                {!login.active && <span className="text-red-500 font-medium"> · account suspended</span>}
              </div>
              <div className="divide-y divide-gray-50">
                {(login.companies || []).length === 0 ? (
                  <p className="px-3.5 py-3 text-xs text-gray-400">No companies on this login.</p>
                ) : login.companies.map(c => {
                  const key = `${c.customer_company_partner_id}-${c.odoo_partner_id}`;
                  return (
                    <div key={key} className="px-3.5 py-2.5 flex items-center justify-between gap-2">
                      <span className="text-sm text-gray-800">{c.company_name}</span>
                      <div className="flex items-center gap-2">
                        <Badge color={c.active ? "green" : "gray"}>{c.active ? "Active" : "Deactivated"}</Badge>
                        <button
                          onClick={() => toggleCompany(c)}
                          disabled={busyKey === key}
                          className={`text-xs font-medium disabled:opacity-50 ${c.active ? "text-red-600 hover:text-red-700" : "text-bassani-700 hover:text-bassani-800"}`}
                        >
                          {busyKey === key ? "Working…" : c.active ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="flex justify-end mt-4">
        <BtnSecondary onClick={onClose}>Close</BtnSecondary>
      </div>
    </Modal>
  );
}
