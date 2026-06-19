import { createContext, useContext, useState, useEffect, useCallback } from "react";
import api from "./api";

const AuthContext = createContext(null);

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

  /**
   * Check whether the current user has a specific permission.
   * Format: "domain.action"  e.g.  can("commission.mark_paid")
   *
   * Super admins always return true. Non-admin roles always return false.
   * If the permission key doesn't exist, returns false (deny by default).
   */
  const can = useCallback((permission) => {
    if (!user) return false;
    if (user.is_super_admin) return true;
    if (!["admin", "super_admin"].includes(user.role)) return false;

    const [domain, action] = permission.split(".");
    return Boolean(user.permissions?.[domain]?.[action]);
  }, [user]);

  /** True if the user is a super_admin or a regular admin (i.e. portal staff). */
  const isAdmin = user?.role === "admin" || user?.role === "super_admin";

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, can, isAdmin, setActiveWarehouse }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
