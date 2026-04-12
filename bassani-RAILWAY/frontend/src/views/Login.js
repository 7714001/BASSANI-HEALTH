import { useState } from "react";
import { useAuth } from "../AuthContext";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import { Package } from "lucide-react";

export default function Login() {
  const { login } = useAuth();
  const navigate  = useNavigate();
  const [form, setForm]       = useState({ username: "", password: "" });
  const [loading, setLoading] = useState(false);

  const quickFill = (role) => {
    if (role === "admin")    setForm({ username: "admin",   password: "admin123"    });
    if (role === "reseller") setForm({ username: "joe2025", password: "reseller123" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      await login(form.username, form.password);
      navigate("/");
    } catch {
      toast.error("Incorrect username or password");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left panel */}
      <div className="w-72 bg-slate-900 flex flex-col justify-between p-8 flex-shrink-0">
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
        <p className="text-slate-600 text-xs">Authorised users only</p>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm">
          <h2 className="text-2xl font-semibold text-gray-900 mb-1">Welcome back</h2>
          <p className="text-gray-500 text-sm mb-8">Sign in to your account</p>

          {/* Quick fill */}
          <div className="flex gap-2 mb-6">
            <span className="text-xs text-gray-400 self-center">Quick fill:</span>
            {["admin","reseller"].map((r) => (
              <button key={r} onClick={() => quickFill(r)}
                className="px-3 py-1 text-xs border border-gray-200 rounded-lg text-gray-500 hover:border-bassani-600 hover:text-bassani-700 hover:bg-bassani-50 transition-all capitalize">
                {r}
              </button>
            ))}
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Username</label>
              <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })}
                placeholder="Enter username" autoComplete="username"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 bg-white transition-all" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1.5">Password</label>
              <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Enter password" autoComplete="current-password"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-bassani-600 focus:ring-2 focus:ring-bassani-600/10 bg-white transition-all" />
            </div>
            <button type="submit" disabled={loading}
              className="w-full bg-bassani-600 hover:bg-bassani-700 text-white rounded-xl py-3 text-sm font-semibold transition-colors disabled:opacity-60 mt-2">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
