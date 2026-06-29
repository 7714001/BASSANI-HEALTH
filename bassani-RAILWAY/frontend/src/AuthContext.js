import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "./api";

const AuthContext = createContext(null);

// Roles evaluated against their stored `permissions` object — mirrors
// backend auth.py's ADMIN_ROLES | TICKET_ROLES gate in require_permission().
const PERMISSION_ROLES = ["admin", "super_admin", "sales", "orders_clerk", "finance", "qa_manager", "responsible_pharmacist"];

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);

  // Re-hydrate from token on page load
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) { setLoading(false); return; }
    api.get("/api/auth/me")
      .then((r) => setUser(r.data))
      .catch(() => localStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, []);

  const login = async (username, password) => {
    const form = new FormData();
    form.append("username", username);
    form.append("password", password);
    const { data } = await api.post("/api/auth/login", form, {
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    if (data.otp_required) {
      return { otp_required: true, otp_session_id: data.otp_session_id };
    }
    localStorage.setItem("token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const verifyOtp = async (sessionId, otp) => {
    const { data } = await api.post("/api/auth/verify-otp", { session_id: sessionId, otp });
    localStorage.setItem("token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const logout = () => {
    localStorage.removeItem("token");
    setUser(null);
  };

  /** Admin/super_admin self-service: switch which warehouse the portal is scoped to. */
  const setActiveWarehouse = async (warehouseId) => {
    const { data } = await api.put("/api/users/me/warehouse", { warehouse_id: warehouseId });
    setUser((u) => ({ ...u, active_warehouse_id: data.active_warehouse_id }));
  };

  /** Authenticated user sets their own new password (required on first login). */
  const changePassword = async (currentPassword, newPassword) => {
    await api.post("/api/auth/change-password", {
      current_password: currentPassword,
      new_password: newPassword,
    });
    setUser((u) => ({ ...u, must_change_password: false }));
  };

  /**
   * Check whether the current user has a specific permission.
   * Format: "domain.action"  e.g.  can("commission.mark_paid")
   *
   * Super admins always return true. Roles outside PERMISSION_ROLES (e.g.
   * reseller) always return false. If the permission key doesn't exist,
   * returns false (deny by default).
   */
  const can = useCallback((permission) => {
    if (!user) return false;
    if (user.is_super_admin) return true;
    if (!PERMISSION_ROLES.includes(user.role)) return false;

    const [domain, action] = permission.split(".");
    return Boolean(user.permissions?.[domain]?.[action]);
  }, [user]);

  /** True if the user is a super_admin or a regular admin (i.e. portal staff). */
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  return (
    <AuthContext.Provider value={{ user, login, verifyOtp, logout, loading, can, isAdmin, setActiveWarehouse, changePassword }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
