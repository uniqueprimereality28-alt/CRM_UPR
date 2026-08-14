import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import "./App.css";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { Layout } from "./components/Layout";
import { Toaster } from "./components/ui/sonner";
import { Loader2 } from "lucide-react";

// Loaded eagerly: Login is the very first screen for anyone not signed in,
// so there's no benefit to splitting it out.
import Login from "./pages/Login";

// Every other page is loaded lazily, one JS chunk per page instead of one
// giant bundle. Nothing about how these pages work changes — only when
// their code is downloaded (on first visit to that route instead of on
// app load), which is what was making first load slow on mobile.
const AdminDashboard = lazy(() => import("./pages/AdminDashboard"));
const AgentDashboard = lazy(() => import("./pages/AgentDashboard"));
const Leads = lazy(() => import("./pages/Leads"));
const MyLeads = lazy(() => import("./pages/MyLeads"));
const LeadDetail = lazy(() => import("./pages/LeadDetail"));
const Agents = lazy(() => import("./pages/Agents"));
const AgentDetail = lazy(() => import("./pages/AgentDetail"));
const Calls = lazy(() => import("./pages/Calls"));
const Followups = lazy(() => import("./pages/Followups"));
const Attendance = lazy(() => import("./pages/Attendance"));
const TeamAttendance = lazy(() => import("./pages/TeamAttendance"));
const Reports = lazy(() => import("./pages/Reports"));
const Chat = lazy(() => import("./pages/Chat"));
const Profile = lazy(() => import("./pages/Profile"));
const Settings = lazy(() => import("./pages/Settings"));
const AICalling = lazy(() => import("./pages/AICalling"));

const Splash = () => (
  <div className="grid min-h-screen place-items-center">
    <Loader2 className="h-6 w-6 animate-spin text-brand" />
  </div>
);

const Protected = ({ children, roles, usernames }) => {
  const { user, loading } = useAuth();
  if (loading) return <Splash />;
  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role))
    return <Navigate to="/dashboard" replace />;
  if (usernames && !usernames.includes(user.username))
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
          <Suspense fallback={<Splash />}>
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

            <Route
              path="/ai-calling"
              element={
                <Protected usernames={["vranda.aggarwal"]}>
                  <AICalling />
                </Protected>
              }
            />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
          </Suspense>

          <Toaster position="top-right" richColors />
        </AuthProvider>
      </BrowserRouter>
    </div>
  );
}

export default App;
