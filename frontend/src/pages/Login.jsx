import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Loader2, Lock, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { apiError } from "../lib/api";
import { Brand } from "../components/Brand";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

const SUPPORT_WHATSAPP_NUMBER = "917351735035";
const SUPPORT_WHATSAPP_MESSAGE =
  "Hello Vrinda ma'am, I'm unable to log into the UPR CRM. Kindly assist me with this.";
const supportWhatsappHref = `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(SUPPORT_WHATSAPP_MESSAGE)}`;

export default function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  if (user) return <Navigate to="/dashboard" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await login(username.trim(), password);
      navigate("/dashboard");
    } catch (err) {
      setError(apiError(err.response?.data?.detail) || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <div className="relative hidden overflow-hidden bg-brand lg:block">
        <img
          src="https://images.unsplash.com/photo-1549757521-4160565ff3de?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1NjZ8MHwxfHNlYXJjaHwzfHxtb2Rlcm4lMjBjb3Jwb3JhdGUlMjByZWFsJTIwZXN0YXRlJTIwYnVpbGRpbmclMjBleHRlcmlvcnxlbnwwfHx8fDE3ODUzMTY1ODd8MA&ixlib=rb-4.1.0&q=85"
          alt="Unique Prime Reality"
          className="absolute inset-0 h-full w-full object-cover opacity-35"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-[#0f2a8a] via-[#1a3fbf]/80 to-transparent" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="brand-font text-lg font-extrabold tracking-tight">
            UNIQUE PRIME REALITY
            <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-white/60">
              Property Consultants
            </div>
          </div>
          <div className="max-w-md stagger-in">
            <h1 className="text-4xl font-bold leading-tight lg:text-5xl">
              Leads. Calls. Attendance.
              <br />
              <span className="text-white/60">One in-house command center.</span>
            </h1>
            <p className="mt-6 text-sm leading-relaxed text-white/70">
              GPS-verified attendance, role-based lead assignment, click-to-call recording and team
              chat — everything the office and the field team need, in a single CRM.
            </p>
          </div>
          <div className="flex gap-10 text-sm">
            {[
              ["GPS", "Attendance"],
              ["Live", "Talk-time"],
              ["Roles", "TL / Sales / HR"],
            ].map(([a, b]) => (
              <div key={a}>
                <div className="brand-font text-xl font-bold">{a}</div>
                <div className="text-[11px] uppercase tracking-wider text-white/50">{b}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-center bg-white px-6 py-16">
        <div className="w-full max-w-sm stagger-in">
          <div className="lg:hidden">
            <Brand />
          </div>
          <h2 className="mt-8 text-2xl font-bold text-slate-900">Sign in to your CRM</h2>
          <p className="mt-1.5 text-sm text-slate-500">
            Use the credentials issued by your administrator.
          </p>

          <form onSubmit={submit} className="mt-8 space-y-5">
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                User ID
              </Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="username"
                  data-testid="login-username-input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="firstname.lastname"
                  className="pl-9"
                  required
                />
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                  Password
                </Label>
                <a
                  href={supportWhatsappHref}
                  target="_blank"
                  rel="noreferrer"
                  data-testid="login-forgot-password-link"
                  className="text-xs font-semibold text-brand hover:text-brand-dark"
                >
                  Forgot password?
                </a>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  data-testid="login-password-input"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="pl-9 pr-9"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  data-testid="login-password-toggle"
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  tabIndex={-1}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>

            {error && (
              <div
                data-testid="login-error"
                className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={busy}
              data-testid="login-submit-btn"
              className="w-full bg-brand py-5 text-sm font-semibold hover:bg-brand-dark"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-center text-[11px] text-slate-400">
            Built for Unique Prime Reality by Vranda Aggarwal
          </p>
        </div>
      </div>
    </div>
  );
}
