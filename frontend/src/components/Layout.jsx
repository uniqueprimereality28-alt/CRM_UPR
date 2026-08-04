import { NavLink, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import {
  LayoutDashboard, Users, Contact, PhoneCall, LogOut, Menu, X,
  AlarmClock, MapPin, MessagesSquare, Settings as SettingsIcon,
  UserCog, Building2,
} from "lucide-react";
import { Brand } from "./Brand";
import { ReminderBell } from "./ReminderBell";
import { useAuth } from "../context/AuthContext";
import { api } from "../lib/api";
import { Button } from "./ui/button";

export const Layout = ({ children }) => {
  const { user, logout, isAdmin, isTL, isEmployee, isManager, attendanceExempt } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [alertCount, setAlertCount] = useState(0);

  useEffect(() => {
    let alive = true;
    const poll = async () => {
      try {
        const { data } = await api.get("/alerts", { params: { limit: 20 } });
        if (!alive) return;
        const lastSeen = Number(localStorage.getItem("upr_alerts_seen") || 0);
        const unseen = data.filter((a) => new Date(a.created_at).getTime() > lastSeen).length;
        setAlertCount(unseen);
      } catch { /* ignore */ }
    };
    poll();
    const t = setInterval(poll, 45000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const nav = [
    (!isEmployee) && { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, id: "nav-dashboard" },
    (!isEmployee) && { to: "/leads", label: isManager ? "All Leads" : "My Leads", icon: Contact, id: "nav-leads" },
    (!isEmployee) && { to: "/followups", label: "Follow-ups", icon: AlarmClock, id: "nav-followups" },
    isManager && { to: "/team", label: "Team", icon: Users, id: "nav-team" },
    (!isEmployee) && { to: "/calls", label: "Call Logs", icon: PhoneCall, id: "nav-calls" },
    (!attendanceExempt) && { to: "/attendance", label: "Attendance", icon: MapPin, id: "nav-attendance" },
    isManager && { to: "/team-attendance", label: "Team Attendance", icon: Building2, id: "nav-team-attendance" },
    { to: "/chat", label: "Team Chat", icon: MessagesSquare, id: "nav-chat", badge: alertCount },
    isAdmin && { to: "/settings", label: "Settings", icon: SettingsIcon, id: "nav-settings" },
    { to: "/profile", label: "Profile", icon: UserCog, id: "nav-profile" },
  ].filter(Boolean);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const roleLabel = ({
    superadmin: "Administrator",
    admin: "Administrator",
    team_lead: "Team Leader",
    sales: "Sales Executive",
    employee: "Employee",
    hr: "HR",
  })[user?.role] || user?.role;

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform lg:static lg:translate-x-0 ${
          open ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex h-16 shrink-0 items-center justify-between border-b border-slate-200 px-5">
          <Brand />
          <button className="lg:hidden" onClick={() => setOpen(false)} data-testid="sidebar-close">
            <X className="h-5 w-5 text-slate-400" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {nav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              data-testid={item.id}
              onClick={() => {
                setOpen(false);
                if (item.to === "/chat") localStorage.setItem("upr_alerts_seen", String(Date.now()));
              }}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg border-l-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                  isActive
                    ? "border-brand bg-brand-light text-brand"
                    : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.badge > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1.5 text-[10px] font-bold text-white">
                  {item.badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>
        <div className="shrink-0 border-t border-slate-200 p-4">
          <div className="mb-3 flex items-center gap-3">
            {user?.avatar_url ? (
              <img src={user.avatar_url} alt={user.name}
                className="h-9 w-9 rounded-full object-cover" />
            ) : (
              <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-light text-sm font-semibold text-brand">
                {user?.name?.slice(0, 1)}
              </div>
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-slate-800">{user?.name}</div>
              <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                {roleLabel}
              </div>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="w-full justify-start gap-2"
            onClick={handleLogout}
            data-testid="logout-btn"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </Button>
        </div>
      </aside>

      {open && (
        <div className="fixed inset-0 z-30 bg-slate-900/30 lg:hidden" onClick={() => setOpen(false)} />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur-md lg:px-8">
          <button className="lg:hidden" onClick={() => setOpen(true)} data-testid="sidebar-open">
            <Menu className="h-5 w-5 text-slate-600" />
          </button>
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
            {isAdmin ? "Administrator Command Center" : isTL ? "Team Leader Workspace" : "Workspace"}
          </div>
          <div className="ml-auto hidden items-center gap-2 rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-500 sm:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live
          </div>
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-8">{children}</main>
      </div>
      <ReminderBell />
    </div>
  );
};
