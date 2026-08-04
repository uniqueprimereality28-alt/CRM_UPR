import { useEffect, useRef, useState } from "react";
import { KeyRound, Loader2, UserCog, Save, Camera, Calendar as CalIcon } from "lucide-react";
import { toast } from "sonner";
import { api, apiError } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";

export default function Profile() {
  const { user, refresh } = useAuth();
  const [pwd, setPwd] = useState({ current_password: "", new_password: "", confirm: "" });
  const [info, setInfo] = useState({ name: "", email: "", phone: "", date_of_birth: "", joining_date: "" });
  const [pwdBusy, setPwdBusy] = useState(false);
  const [infoBusy, setInfoBusy] = useState(false);
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileRef = useRef(null);

  useEffect(() => {
    if (user) setInfo({
      name: user.name || "", email: user.email || "", phone: user.phone || "",
      date_of_birth: user.date_of_birth || "", joining_date: user.joining_date || "",
    });
  }, [user]);

  const savePwd = async (e) => {
    e.preventDefault();
    if (pwd.new_password !== pwd.confirm) {
      toast.error("New password and confirmation don't match");
      return;
    }
    if (pwd.new_password.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setPwdBusy(true);
    try {
      await api.post("/auth/change-password", {
        current_password: pwd.current_password,
        new_password: pwd.new_password,
      });
      toast.success("Password updated. Use it next time you sign in.");
      setPwd({ current_password: "", new_password: "", confirm: "" });
    } catch (e2) {
      toast.error(apiError(e2.response?.data?.detail));
    } finally { setPwdBusy(false); }
  };

  const saveInfo = async (e) => {
    e.preventDefault();
    setInfoBusy(true);
    try {
      await api.put("/auth/profile", info);
      await refresh();
      toast.success("Profile updated");
    } catch (e2) {
      toast.error(apiError(e2.response?.data?.detail));
    } finally { setInfoBusy(false); }
  };

  const uploadAvatar = async (f) => {
    if (!f) return;
    if (!f.type?.startsWith("image/")) return toast.error("Please drop an image file");
    if (f.size > 3 * 1024 * 1024) return toast.error("Image too large (max 3 MB)");
    setAvatarBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      await api.post("/auth/avatar", fd);
      await refresh();
      toast.success("Profile picture updated");
    } catch (e) {
      toast.error(apiError(e.response?.data?.detail));
    } finally { setAvatarBusy(false); }
  };

  const stopEvt = (e) => { e.preventDefault(); e.stopPropagation(); };
  const onAvatarDragEnter = (e) => { stopEvt(e); setIsDragging(true); };
  const onAvatarDragOver = (e) => { stopEvt(e); setIsDragging(true); };
  const onAvatarDragLeave = (e) => { stopEvt(e); setIsDragging(false); };
  const onAvatarDrop = (e) => {
    stopEvt(e);
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) uploadAvatar(f);
  };

  const workingDays = (user?.working_days || []).map((d) => ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d]).join(", ");

  return (
    <div className="space-y-6" data-testid="profile-page">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Your Profile</h1>
        <p className="mt-1.5 text-sm text-slate-500">Update your personal information, profile picture and password.</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Personal info */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <UserCog className="h-5 w-5 text-brand" /> Personal information
          </div>

          <div className="mt-5 flex items-center gap-4">
            <div
              className={`relative cursor-pointer rounded-full transition-all ${isDragging ? "ring-4 ring-brand ring-offset-2" : ""}`}
              onClick={() => fileRef.current?.click()}
              onDragEnter={onAvatarDragEnter}
              onDragOver={onAvatarDragOver}
              onDragLeave={onAvatarDragLeave}
              onDrop={onAvatarDrop}
              data-testid="avatar-dropzone"
            >
              {user?.avatar_url ? (
                <img src={user.avatar_url} alt={user.name} data-testid="profile-avatar"
                  className={`h-20 w-20 rounded-full border-2 object-cover shadow transition-opacity ${isDragging ? "border-brand opacity-60" : "border-white"}`} />
              ) : (
                <div className={`grid h-20 w-20 place-items-center rounded-full bg-brand-light text-2xl font-bold text-brand transition-opacity ${isDragging ? "opacity-60" : ""}`} data-testid="profile-avatar">
                  {user?.name?.slice(0, 1)}
                </div>
              )}
              {isDragging && (
                <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-full bg-brand/20 text-[9px] font-semibold uppercase tracking-wide text-brand">
                  Drop
                </div>
              )}
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); fileRef.current?.click(); }}
                data-testid="upload-avatar-btn"
                className="absolute -bottom-1 -right-1 grid h-8 w-8 place-items-center rounded-full border-2 border-white bg-brand text-white shadow-md transition-transform hover:scale-110"
                title="Change picture"
              >
                {avatarBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
              </button>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                data-testid="avatar-file-input"
                onChange={(e) => uploadAvatar(e.target.files?.[0])} />
            </div>
            <div>
              <div className="text-base font-semibold text-slate-900">{user?.name}</div>
              <div className="text-xs text-slate-400">@{user?.username}</div>
              <div className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                <CalIcon className="h-3 w-3" /> Joined {user?.joining_date || "—"}
              </div>
              <div className="mt-1 text-[10px] text-slate-400">Drag &amp; drop an image, or click to change</div>
            </div>
          </div>

          <form onSubmit={saveInfo} className="mt-6 space-y-3">
            <div className="space-y-1.5">
              <Label>Full name</Label>
              <Input data-testid="info-name" value={info.name}
                onChange={(e) => setInfo({ ...info, name: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email / Gmail</Label>
              <Input data-testid="info-email" type="email" value={info.email}
                onChange={(e) => setInfo({ ...info, email: e.target.value })} placeholder="you@example.com" />
            </div>
            <div className="space-y-1.5">
              <Label>Phone number</Label>
              <Input data-testid="info-phone" value={info.phone}
                onChange={(e) => setInfo({ ...info, phone: e.target.value })} placeholder="+919812345678" />
            </div>
            <div className="space-y-1.5">
              <Label>Date of birth</Label>
              <Input type="date" data-testid="info-dob" value={info.date_of_birth}
                onChange={(e) => setInfo({ ...info, date_of_birth: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Joining date</Label>
              <Input type="date" data-testid="info-joining-date" value={info.joining_date}
                onChange={(e) => setInfo({ ...info, joining_date: e.target.value })} />
              <p className="text-[11px] text-slate-400">You can only change this yourself twice — after that, ask an administrator.</p>
            </div>
            <Button type="submit" disabled={infoBusy} data-testid="info-submit"
              className="w-full gap-2 bg-brand hover:bg-brand-dark">
              {infoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Save personal info
            </Button>
          </form>

          <div className="mt-6 space-y-2 rounded-lg bg-slate-50 p-4 text-xs">
            <Row label="Role" value={user?.role === "team_lead" ? "Team Leader" :
              user?.role === "sales" ? "Sales Executive" :
              ["admin", "superadmin"].includes(user?.role) ? "Administrator" :
              user?.role === "hr" ? "HR" :
              user?.role === "employee" ? "Employee" : user?.role} />
            <Row label="Team leader" value={user?.team_lead_name || "—"} />
            <Row label="Office hours" value={`${user?.office_start || "11:00"} – ${user?.office_end || "18:00"}`} />
            <Row label="Working days" value={workingDays || "Mon–Sat"} />
            <Row label="Attendance" value={user?.attendance_exempt ? "Not required" : user?.wfh ? "Work from home (no GPS)" : "GPS required"} />
          </div>
        </div>

        {/* Password */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-2 text-lg font-semibold text-slate-900">
            <KeyRound className="h-5 w-5 text-brand" /> Change password
          </div>
          <form onSubmit={savePwd} className="mt-4 space-y-4">
            <div className="space-y-1.5">
              <Label>Current password</Label>
              <Input type="password" data-testid="pw-current" required value={pwd.current_password}
                onChange={(e) => setPwd({ ...pwd, current_password: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>New password</Label>
              <Input type="password" data-testid="pw-new" required value={pwd.new_password}
                onChange={(e) => setPwd({ ...pwd, new_password: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Confirm new password</Label>
              <Input type="password" data-testid="pw-confirm" required value={pwd.confirm}
                onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} />
            </div>
            <Button type="submit" disabled={pwdBusy} data-testid="pw-submit"
              className="w-full gap-2 bg-brand hover:bg-brand-dark">
              {pwdBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Update password
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}

const Row = ({ label, value }) => (
  <div className="flex items-center justify-between border-b border-slate-100 pb-1.5 last:border-0">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
    <div className="text-xs font-medium text-slate-800">{value}</div>
  </div>
);
