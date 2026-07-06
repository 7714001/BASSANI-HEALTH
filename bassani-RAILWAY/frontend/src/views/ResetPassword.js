import { useState } from "react";
import { Link, useSearchParams, useNavigate } from "react-router-dom";
import { CheckCircle, AlertCircle } from "lucide-react";
import api from "../api";
import toast from "react-hot-toast";

const LEFT_PANEL = (
  <div className="hidden md:flex md:w-72 bg-slate-900 flex-col justify-between p-8 flex-shrink-0">
    <div>
      <img src="/favicon.ico" alt="Bassani Health" className="w-10 h-10 mb-6 object-contain" />
      <h1 className="text-white text-xl font-semibold">Bassani Health</h1>
      <p className="text-slate-500 text-sm mt-1">Internal Operations</p>
    </div>
    <p className="text-slate-600 text-xs">Authorised personnel only · v2.0</p>
  </div>
);

export default function ResetPassword() {
  const [searchParams]                  = useSearchParams();
  const navigate                        = useNavigate();
  const token                           = searchParams.get("token") || "";

  const [password,  setPassword ] = useState("");
  const [confirm,   setConfirm  ] = useState("");
  const [loading,   setLoading  ] = useState(false);
  const [done,      setDone     ] = useState(false);
  const [error,     setError    ] = useState("");

  const inputCls =
    "w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 bg-white transition-all";

  if (!token) {
    return (
      <div className="min-h-screen flex">
        {LEFT_PANEL}
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="w-full max-w-sm text-center">
            <AlertCircle size={36} className="text-red-400 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-gray-900 mb-2">Invalid reset link</h2>
            <p className="text-gray-500 text-sm mb-6">
              This link is missing a reset token. Please request a new one.
            </p>
            <Link to="/forgot-password"
              className="text-sm font-semibold text-bassani-600 hover:text-bassani-700 transition-colors">
              Request a new reset link
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setLoading(true);
    try {
      await api.post("/api/auth/reset-password", { token, new_password: password });
      setDone(true);
    } catch (err) {
      const msg = err.response?.data?.detail || "Something went wrong. Please try again.";
      setError(msg);
      toast.error(msg);
    } finally {
      setLoading(false);
    }
  };

  if (done) {
    return (
      <div className="min-h-screen flex">
        {LEFT_PANEL}
        <div className="flex-1 flex items-center justify-center bg-gray-50">
          <div className="w-full max-w-sm text-center">
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center mx-auto mb-6">
              <CheckCircle size={20} className="text-green-600" />
            </div>
            <h2 className="text-2xl font-semibold text-gray-900 mb-1">Password updated</h2>
            <p className="text-gray-500 text-sm mb-8">
              Your password has been changed successfully. Any other active sessions have been
              signed out for your security.
            </p>
            <button
              onClick={() => navigate("/login")}
              className="w-full bg-bassani-600 hover:bg-bassani-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors"
            >
              Sign in with new password
            </button>
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
          <h2 className="text-2xl font-semibold text-gray-900 mb-1">Set a new password</h2>
          <p className="text-gray-500 text-sm mb-8">
            Choose a strong password. This will sign out any other active sessions.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                New password
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password"
                className={inputCls}
                required
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">
                Confirm new password
              </label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter new password"
                autoComplete="new-password"
                className={inputCls}
                required
              />
            </div>
            {error && (
              <p className="text-xs text-red-600 font-medium">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !password || !confirm}
              className="w-full bg-bassani-600 hover:bg-bassani-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-60"
            >
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
          <div className="mt-5 text-center">
            <Link to="/login"
              className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
