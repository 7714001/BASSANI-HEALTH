// Shared recipient picker (2026-08-27) — opened by every "Send Quote"/"Send
// Invoice"/"Resend" action so staff can choose which contact(s) on the
// company the email actually goes to, instead of it silently going to
// whichever single email happens to be resolved as "the" customer address.
// Backed by GET /api/customers/{partnerId}/send-recipients (customer's own
// record + every active Odoo child contact with an email on file).
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import api from "../api";
import { Modal, BtnPrimary, BtnSecondary, Input } from "./UI";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SendRecipientsModal({ partnerId, title = "Send Email", onClose, onSend }) {
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState([]);
  const [selected, setSelected] = useState(() => new Set());
  const [extraEmail, setExtraEmail] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!partnerId) { setLoading(false); return; }
    setLoading(true);
    api.get(`/api/customers/${partnerId}/send-recipients`)
      .then(r => {
        if (cancelled) return;
        const cs = r.data.contacts || [];
        setContacts(cs);
        // Default: pre-check the company's own record (or the first
        // contact returned, if there's no separate company-level email) so
        // the common case — send to the one obvious address — needs no
        // extra clicks, matching the pre-existing auto-resolved behavior.
        const def = cs.find(c => c.is_company_record) || cs[0];
        if (def) setSelected(new Set([def.email]));
      })
      .catch(() => { if (!cancelled) toast.error("Failed to load contacts for this customer"); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [partnerId]);

  const toggle = (email) => {
    setSelected(s => {
      const next = new Set(s);
      if (next.has(email)) next.delete(email); else next.add(email);
      return next;
    });
  };

  const handleSend = async () => {
    const recipients = [...selected];
    const extra = extraEmail.trim();
    if (extra) {
      if (!EMAIL_RE.test(extra)) { toast.error("Enter a valid email address"); return; }
      if (!recipients.includes(extra)) recipients.push(extra);
    }
    if (recipients.length === 0) { toast.error("Select at least one recipient"); return; }
    setSending(true);
    try {
      await onSend(recipients);
      onClose();
    } catch {
      // onSend's own caller is responsible for its own error toast — this
      // just keeps the modal open (setSending below) rather than closing on
      // a failed send.
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal title={title} onClose={onClose}>
      {loading ? (
        <div className="py-8 flex items-center justify-center text-sm text-gray-400 gap-2">
          <Loader2 size={15} className="animate-spin" />Loading contacts…
        </div>
      ) : (
        <>
          <p className="text-xs text-gray-500 mb-3">Choose who at the customer should receive this email.</p>
          <div className="space-y-1 max-h-64 overflow-y-auto border border-gray-100 rounded-lg p-1.5">
            {contacts.length === 0 ? (
              <p className="text-xs text-gray-400 px-2 py-3">No contacts with an email on file — add one below.</p>
            ) : (
              contacts.map(c => (
                <label key={c.id} className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selected.has(c.email)}
                    onChange={() => toggle(c.email)}
                    className="rounded border-gray-300 text-bassani-600 focus:ring-bassani-500 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800 truncate">
                      {c.name}{c.is_company_record && <span className="text-gray-400 font-normal"> (Company)</span>}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{c.email}</p>
                  </div>
                </label>
              ))
            )}
          </div>
          <div className="mt-3">
            <label className="text-xs font-medium text-gray-500 mb-1 block">Add another email (optional)</label>
            <Input value={extraEmail} onChange={e => setExtraEmail(e.target.value)} placeholder="name@example.com" />
          </div>
        </>
      )}
      <div className="flex justify-end gap-2 mt-4">
        <BtnSecondary onClick={onClose} disabled={sending}>Cancel</BtnSecondary>
        <BtnPrimary onClick={handleSend} loading={sending} disabled={loading}>Send</BtnPrimary>
      </div>
    </Modal>
  );
}
