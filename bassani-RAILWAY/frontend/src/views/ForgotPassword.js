import { useState } from "react";
import { Link } from "react-router-dom";
import { Package, Mail } from "lucide-react";
import api from "../api";

const LEFT_PANEL = (
  <div className="hidden md:flex md:w-72 bg-slate-900 flex-col justify-between p-8 flex-shrink-0">
    <div>
      <div className="w-10 h-10 bg-bassani-600 rounded-xl flex items-center justify-center mb-6">
        <Package size={20} color="white" />
      </div>
      <h1 className="text-white text-xl font-semibold">Bassani Health</h1>
      <p className="text-slate-500 text-sm mt-1">Internal Operations</p>
    </div>
    <p className="text-slate-600 text-xs">Authorised personnel only · v2.0</p>
  </div>
);

export default function ForgotPassword() {
  const [email,     setEmail    ] = useState("");
  const [loading,   setLoading  ] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await api.post("/api/auth/forgot-password", { email: email.trim() });
    } catch {
      // Swallow errors — never reveal whether the email exists
    } finally {
      setLoading(false);
      setSubmitted(true);
    }
  };

  const inputCls =
    "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 bg-white transition-all";

  return (
    <div className="min-h-screen flex">
      {LEFT_PANEL}
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm">
          {submitted ? (
            <>
              <div className="w-10 h-10 bg-bassani-50 rounded-xl flex items-center justify-center mb-6">
                <Mail size={20} className="text-bassani-600" />
              </div>
              <h2 className="text-2xl font-semibold text-gray-900 mb-1">Check your email</h2>
              <p className="text-gray-500 text-sm mb-8">
                If an account exists for <span className="font-medium text-gray-700">{email}</span>,
                a password reset link has been sent. It expires in 15 minutes.
              </p>
              <p className="text-xs text-gray-400 mb-6">
                Did not receive it? Check your spam folder, or make sure you entered the email
                address registered to your account.
              </p>
              <Link
                to="/login"
                className="block text-center text-sm text-bassani-600 hover:text-bassani-700 font-semibold transition-colors"
              >
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold text-gray-900 mb-1">Forgot your password?</h2>
              <p className="text-gray-500 text-sm mb-8">
                Enter the email address on your account and we will send you a reset link.
              </p>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                    Email address
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    className={inputCls}
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="w-full bg-bassani-600 hover:bg-bassani-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-60"
                >
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
              <div className="mt-5 text-center">
                <Link
                  to="/login"
                  className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                >
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
