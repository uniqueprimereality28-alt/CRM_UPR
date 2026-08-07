import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./App.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { Toaster } from "./components/ui/sonner";
import { Loader2 } from "lucide-react";

import Login from "./pages/Login";
import AdminDashboard from "./pages/AdminDashboard";
import AgentDashboard from "./pages/AgentDashboard";
import Leads from "./pages/Leads";
import MyLeads from "./pages/MyLeads";
import LeadDetail from "./pages/LeadDetail";
import Agents from "./pages/Agents";
import AgentDetail from "./pages/AgentDetail";
import Calls from "./pages/Calls";
import Followups from "./pages/Followups";
import Attendance from "./pages/Attendance";
import TeamAttendance from "./pages/TeamAttendance";
import Reports from "./pages/Reports";
import Chat from "./pages/Chat";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";

const Splash = () => (
  <div className="grid min-h-screen place-items-center">
    <Loader2 className="h-6 w-6 animate-spin text-brand" />
  </div>
);

const Protected = ({ children, roles }) => {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/dashboard" replace />;
  return <Layout>{children}</Layout>;
};

const DashboardRoute = () => {
  const { user } = useAuth();
  const showAdminView =
    user && ["superadmin", "admin", "team_lead", "hr"].includes(user.role);

  if (user?.role === "employee") return <Navigate to="/attendance" replace />;

  return showAdminView ? <AdminDashboard /> : <AgentDashboard />;
};

function App() {
  return (
    <div className="App">
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<Navigate to="/dashboard" replace />} />

            <Route
              path="/dashboard"
              element={
                <Protected>
                  <DashboardRoute />
                </Protected>
              }
            />

            <Route
              path="/leads"
              element={
                <Protected roles={["superadmin", "admin", "team_lead", "sales", "hr"]}>
                  <Leads />
                </Protected>
              }
            />

            <Route
              path="/my-leads"
              element={
                <Protected roles={["superadmin", "admin", "team_lead", "hr"]}>
                  <MyLeads />
                </Protected>
              }
            />

            <Route
              path="/leads/:id"
              element={
                <Protected roles={["superadmin", "admin", "team_lead", "sales", "hr"]}>
                  <LeadDetail />
                </Protected>
              }
            />

            <Route
              path="/team"
              element={
                <Protected roles={["superadmin", "admin", "team_lead", "hr"]}>
                  <Agents />
                </Protected>
              }
            />

            <Route
              path="/team/:id"
              element={
                <Protected roles={["superadmin", "admin", "team_lead", "hr"]}>
                  <AgentDetail />
                </Protected>
              }
            />

            <Route
              path="/calls"
              element={
                <Protected roles={["superadmin", "admin", "team_lead", "sales", "hr"]}>
                  <Calls />
                </Protected>
              }
            />

            <Route
              path="/followups"
              element={
                <Protected roles={["superadmin", "admin", "team_lead", "sales"]}>
                  <Followups />
                </Protected>
              }
            />

            <Route
              path="/attendance"
              element={
                <Protected>
                  <Attendance />
                </Protected>
              }
            />

            <Route
              path="/team-attendance"
              element={
                <Protected roles={["superadmin", "admin", "team_lead", "hr"]}>
                  <TeamAttendance />
                </Protected>
              }
            />

            <Route
              path="/reports"
              element={
                <Protected roles={["superadmin", "admin"]}>
                  <Reports />
                </Protected>
              }
            />

            <Route
              path="/chat"
              element={
                <Protected>
                  <Chat />
                </Protected>
              }
            />

            <Route
              path="/profile"
              element={
                <Protected>
                  <Profile />
                </Protected>
              }
            />

            <Route
              path="/settings"
              element={
                <Protected roles={["superadmin", "admin"]}>
                  <Settings />
                </Protected>
              }
            />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>

          <Toaster position="top-right" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
