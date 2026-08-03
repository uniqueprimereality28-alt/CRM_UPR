import { createContext, useContext, useEffect, useState } from "react";
import { api } from "../lib/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await api.get("/auth/me");
        setUser(data);
      } catch {
        setUser(false);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = async (username, password) => {
    const { data } = await api.post("/auth/login", { username, password });
    localStorage.setItem("upr_token", data.access_token);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    try { await api.post("/auth/logout"); } catch { /* ignore */ }
    localStorage.removeItem("upr_token");
    setUser(false);
  };

  const refresh = async () => {
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
    } catch { /* ignore */ }
  };

  const role = user?.role;
  // Sandeep (admin) and Vranda (superadmin) are equal top-level Administrators.
  const isAdmin = role === "admin" || role === "superadmin";
  const isTL = role === "team_lead";
  const isSales = role === "sales";
  const isEmployee = role === "employee";
  const isHR = role === "hr";
  const isManager = isAdmin || isTL || isHR;
  const canViewAll = isAdmin || isHR;
  const canEditAll = isAdmin; // both admins can edit everything
  const attendanceExempt = !!user?.attendance_exempt;
  const isWFH = !!user?.wfh;
  const mustMarkAttendance = user && !attendanceExempt;

  return (
    <AuthContext.Provider value={{
      user, loading, login, logout, refresh,
      isAdmin, isTL, isSales, isEmployee, isHR, isManager,
      canViewAll, canEditAll, mustMarkAttendance, attendanceExempt, isWFH,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
