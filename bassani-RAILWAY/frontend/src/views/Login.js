import { useState } from "react";
import { useAuth } from "../AuthContext";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Package, Mail } from "lucide-react";

const LEFT_PANEL = (
  <div className="hidden md:flex md:w-72 bg-slate-900 flex-col justify-between p-8 flex-shrink-0">
    <div>
      <div className="w-10 h-10 bg-bassani-600 rounded-xl flex items-center justify-center mb-6">
        <Package size={20} color="white" />
      </div>
      <h1 className="text-white text-xl font-semibold">Bassani Health</h1>
      <p className="text-slate-500 text-sm mt-1">Internal Operations</p>
      <div className="mt-10 space-y-4">
        {[
          "Live Odoo stock sync",
          "Reseller commission tracking",
          "Section 21 compliance",
          "Healthcare onboarding",
        ].map((f) => (
          <div key={f} className="flex items-center gap-2.5">
            <div className="w-1.5 h-1.5 rounded-full bg-bassani-500" />
            <span className="text-slate-400 text-sm">{f}</span>
          </div>
        ))}
      </div>
    </div>
    <p className="text-slate-600 text-xs">Authorised personnel only · v2.0</p>
  </div>
);

export default function Login() {
  const { login, verifyOtp } = useAuth();
  const navigate = useNavigate();

  // Password step
  const [form, setForm]       = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);

  // OTP step
  const [otpStep, setOtpStep]           = useState(false);
  const [otpSessionId, setOtpSessionId] = useState(null);
  const [otp, setOtp]                   = useState("");
  const [otpLoading, setOtpLoading]     = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const result = await login(form.username, form.password);
      if (result?.otp_required) {
        setOtpSessionId(result.otp_session_id);
        setOtpStep(true);
        toast.success("A sign-in code has been sent to your email.");
      } else {
        navigate("/");
      }
    } catch {
      toast.error("Incorrect username or password");
    } finally {
      setLoading(false);
    }
  };

  const handleOtpSubmit = async (e) => {
    e.preventDefault();
    setOtpLoading(true);
    try {
      await verifyOtp(otpSessionId, otp);
      navigate("/");
    } catch (err) {
      const msg = err.response?.data?.detail || "Invalid code. Please try again.";
      toast.error(msg);
      // Session exhausted or expired — send them back to the password form
      if (msg.includes("sign in again") || msg.includes("expired") || msg.includes("all attempts")) {
        setOtpStep(false);
        setOtp("");
        setOtpSessionId(null);
      }
    } finally {
      setOtpLoading(false);
    }
  };

  const inputCls =
    "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 bg-white transition-all";

  if (otpStep) {
    return (
      <div className="min-h-screen flex">
        {LEFT_PANEL}
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="w-full max-w-sm">
            <div className="w-10 h-10 bg-bassani-50 rounded-xl flex items-center justify-center mb-6">
              <Mail size={20} className="text-bassani-600" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-1">Check your email</h2>
            <p className="text-gray-500 text-sm mb-8">
              We sent a 6-digit code to your registered email address. It expires in 10 minutes.
            </p>

            <form onSubmit={handleOtpSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                  Verification code
                </label>
                <input
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="000000"
                  maxLength={6}
                  autoComplete="one-time-code"
                  inputMode="numeric"
                  className="w-full border border-gray-200 rounded-xl px-4 py-3 text-2xl font-mono tracking-[0.5em] text-center focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 bg-white transition-all"
                />
              </div>
              <button
                type="submit"
                disabled={otpLoading || otp.length !== 6}
                className="w-full bg-bassani-600 hover:bg-bassani-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-60 mt-2"
              >
                {otpLoading ? "Verifying…" : "Verify code"}
              </button>
              <button
                type="button"
                onClick={() => { setOtpStep(false); setOtp(""); setOtpSessionId(null); }}
                className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors py-1"
              >
                Back to sign in
              </button>
            </form>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex">
      {LEFT_PANEL}
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-gray-500 text-sm mb-8">Sign in to your account</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Username</label>
              <input
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="Enter username"
                autoComplete="username"
                className={inputCls}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Enter password"
                autoComplete="current-password"
                className={inputCls}
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-bassani-600 hover:bg-bassani-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-60 mt-2"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
