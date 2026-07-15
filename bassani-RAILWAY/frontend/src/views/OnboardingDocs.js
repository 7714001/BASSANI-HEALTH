import { useState } from "react";
import { Mail, Loader2, CheckCircle, Copy, Link2, Send } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";
import { TopBar } from "../components/UI";
import { useAuth } from "../AuthContext";

export default function OnboardingDocs() {
  const { user } = useAuth();
  const referralLink = `${window.location.origin}/apply?ref=${user?.id}`;

  const [inviteEmail,   setInviteEmail  ] = useState("");
  const [customerName,  setCustomerName ] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [sentTo,        setSentTo       ] = useState(null);

  const sendInvite = async () => {
    if (!inviteEmail.trim()) return toast.error("Enter the customer's email address");
    setInviteSending(true);
    try {
      await api.post("/api/onboarding/invite", {
        to_email:         inviteEmail.trim(),
        customer_name:    customerName.trim(),
        registration_url: referralLink,
      });
      setSentTo(inviteEmail.trim());
      setInviteEmail("");
      setCustomerName("");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Failed to send invitation");
    } finally {
      setInviteSending(false);
    }
  };

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <TopBar
        title="Invite Customer"
        subtitle="Send your customer a registration link to complete their own onboarding"
      />
      <main className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto w-full space-y-6">

          {/* Success banner */}
          {sentTo && (
            <div className="bg-green-50 border border-green-200 rounded-2xl px-5 py-4 flex items-start gap-3">
              <CheckCircle size={16} className="text-green-600 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-green-800">Invitation sent to {sentTo}</p>
                <p className="text-xs text-green-700 mt-0.5">
                  Your customer will receive a link to complete their own registration. Once approved, they will be linked to your account.
                </p>
              </div>
              <button onClick={() => setSentTo(null)} className="text-green-400 hover:text-green-700 text-xs font-medium shrink-0">Dismiss</button>
            </div>
          )}

          {/* Referral link */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-2">
              <Link2 size={15} className="text-bassani-600 shrink-0" />
              <h3 className="text-sm font-bold text-gray-900">Your Registration Link</h3>
            </div>
            <div className="px-6 py-5">
              <p className="text-xs text-gray-500 mb-3">
                Share this link with your customer. Any application they submit will be automatically linked to your account.
              </p>
              <div className="flex gap-2">
                <input
                  readOnly
                  value={referralLink}
                  className="flex-1 px-3 py-2 text-xs font-mono border border-gray-200 rounded-lg bg-gray-50 text-gray-700 select-all"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(referralLink); toast.success("Link copied"); }}
                  className="flex items-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                  <Copy size={12} /> Copy
                </button>
              </div>
            </div>
          </div>

          {/* Email invitation */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-50 flex items-center gap-2">
              <Send size={15} className="text-bassani-600 shrink-0" />
              <h3 className="text-sm font-bold text-gray-900">Send Invitation by Email</h3>
            </div>
            <div className="px-6 py-5 space-y-3">
              <p className="text-xs text-gray-500">
                Enter your customer's email address and we'll send them your registration link directly. The email comes from the Bassani Health onboarding mailbox — any questions they reply with will be tracked automatically.
              </p>
              <div className="space-y-2">
                <input
                  type="text"
                  value={customerName}
                  onChange={e => setCustomerName(e.target.value)}
                  placeholder="Customer / company name (optional)"
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
                />
                <div className="flex gap-2">
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && sendInvite()}
                    placeholder="customer@example.co.za"
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-bassani-300 bg-white placeholder-gray-400"
                  />
                  <button
                    onClick={sendInvite}
                    disabled={inviteSending || !inviteEmail.trim()}
                    className="flex items-center gap-1.5 px-4 py-2 bg-bassani-600 hover:bg-bassani-700 disabled:opacity-50 text-white text-xs font-semibold rounded-lg transition-colors whitespace-nowrap">
                    {inviteSending ? <Loader2 size={12} className="animate-spin" /> : <Mail size={12} />}
                    Send Invitation
                  </button>
                </div>
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
