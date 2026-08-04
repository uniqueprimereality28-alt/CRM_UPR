import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { UserPlus, Loader2, Pencil, Trash2, Timer, Trophy } from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDuration, fmtMoney } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Badge } from "../components/ui/badge";
import { Switch } from "../components/ui/switch";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

const ROLE_META = {
  superadmin: { label: "Administrator", cls: "bg-brand-light text-brand border-brand/30" },
  admin: { label: "Administrator", cls: "bg-brand-light text-brand border-brand/30" },
  hr: { label: "HR", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  team_lead: { label: "Team Leader", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  sales: { label: "Sales", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  employee: { label: "Employee", cls: "bg-slate-50 text-slate-600 border-slate-200" },
};

const emptyForm = {
  username: "", name: "", password: "", email: "", phone: "",
  role: "sales", team_lead_id: "",
  date_of_birth: "", joining_date: "",
  office_start: "11:00", office_end: "18:00",
  working_days: [0, 1, 2, 3, 4, 5],
  wfh: false, attendance_exempt: false,
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function Agents() {
  const { isAdmin, isTL } = useAuth();
  const [users, setUsers] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [u, dash] = await Promise.all([
        api.get("/users"),
        api.get("/dashboard/admin").catch(() => ({ data: { leaderboard: [] } })),
      ]);
      setUsers(u.data);
      setLeaderboard(dash.data?.leaderboard || []);
    } catch { setUsers(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const teamLeads = (users || []).filter((u) => u.role === "team_lead");

  // Restrict which roles this actor can create
  const availableRoles = (() => {
    if (isAdmin) return ["admin", "hr", "team_lead", "sales", "employee"];
    if (isTL) return ["sales"];
    return [];
  })();

  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (editing) {
        const payload = {
          name: form.name, email: form.email, phone: form.phone,
          date_of_birth: form.date_of_birth || null, joining_date: form.joining_date || null,
          office_start: form.office_start, office_end: form.office_end,
          working_days: form.working_days,
        };
        if (form.password) payload.password = form.password;
        if (isAdmin) {
          payload.role = form.role;
          payload.team_lead_id = form.team_lead_id || null;
          payload.wfh = form.wfh;
          payload.attendance_exempt = form.attendance_exempt;
        }
        await api.put(`/users/${editing}`, payload);
        toast.success("Profile updated");
      } else {
        await api.post("/users", {
          ...form,
          team_lead_id: form.team_lead_id || null,
          password: form.password || undefined,
        });
        toast.success("Profile created — default password: Welcome@123");
      }
      setOpen(false);
      setForm(emptyForm);
      setEditing(null);
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally {
      setBusy(false);
    }
  };

  const toggleActive = async (u) => {
    try {
      await api.put(`/users/${u.id}`, { active: !u.active });
      toast.success(u.active ? "Access revoked" : "Access restored");
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

  const remove = async (u) => {
    try {
      await api.delete(`/users/${u.id}`);
      toast.success("Profile removed");
      load();
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    }
  };

  const openEdit = (u) => {
    setEditing(u.id);
    setForm({
      username: u.username, name: u.name, password: "",
      email: u.email || "", phone: u.phone || "",
      role: u.role, team_lead_id: u.team_lead_id || "",
      date_of_birth: u.date_of_birth || "", joining_date: u.joining_date || "",
      office_start: u.office_start || "11:00", office_end: u.office_end || "18:00",
      working_days: u.working_days || [0, 1, 2, 3, 4, 5],
      wfh: !!u.wfh, attendance_exempt: !!u.attendance_exempt,
    });
    setOpen(true);
  };

  const scoreByAgent = Object.fromEntries((leaderboard || []).map((a) => [a.agent_id, a]));

  return (
    <div className="space-y-5" data-testid="team-page">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Team</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            {isAdmin ? "Create administrators, team leaders, sales executives, HR and employees." :
              "Your sales team roster."}
          </p>
        </div>
        {availableRoles.length > 0 && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setEditing(null); setForm(emptyForm); } }}>
            <DialogTrigger asChild>
              <Button data-testid="add-user-btn" className="gap-2 bg-brand hover:bg-brand-dark">
                <UserPlus className="h-4 w-4" /> New Profile
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>{editing ? "Edit profile" : "Create profile"}</DialogTitle></DialogHeader>
              <form onSubmit={save} className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>Full name *</Label>
                    <Input data-testid="user-name-input" required value={form.name}
                      onChange={(e) => setForm({ ...form, name: e.target.value })} />
                  </div>
                  {!editing && (
                    <div className="space-y-2">
                      <Label>Login ID *</Label>
                      <Input data-testid="user-username-input" required value={form.username}
                        onChange={(e) => setForm({ ...form, username: e.target.value.toLowerCase() })}
                        placeholder="firstname.lastname" />
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>Role *</Label>
                    <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v })}>
                      <SelectTrigger data-testid="user-role-select"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {availableRoles.map((r) => (
                          <SelectItem key={r} value={r}>{ROLE_META[r]?.label || r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {form.role === "sales" && (
                    <div className="space-y-2">
                      <Label>Team leader</Label>
                      <Select value={form.team_lead_id || "none"} onValueChange={(v) => setForm({ ...form, team_lead_id: v === "none" ? "" : v })}>
                        <SelectTrigger data-testid="user-tl-select"><SelectValue placeholder="Choose TL" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">— No TL —</SelectItem>
                          {teamLeads.map((tl) => <SelectItem key={tl.id} value={tl.id}>{tl.name}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2">
                    <Label>{editing ? "New password (optional)" : "Password (default Welcome@123)"}</Label>
                    <Input data-testid="user-password-input" value={form.password}
                      onChange={(e) => setForm({ ...form, password: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Email</Label>
                    <Input data-testid="user-email-input" value={form.email}
                      onChange={(e) => setForm({ ...form, email: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Phone</Label>
                    <Input data-testid="user-phone-input" value={form.phone}
                      onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+919810000000" />
                  </div>
                  <div className="space-y-2">
                    <Label>Date of birth</Label>
                    <Input type="date" data-testid="user-dob-input" value={form.date_of_birth}
                      onChange={(e) => setForm({ ...form, date_of_birth: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Joining date</Label>
                    <Input type="date" data-testid="user-joining-date-input" value={form.joining_date}
                      onChange={(e) => setForm({ ...form, joining_date: e.target.value })} />
                  </div>
                  <div className="space-y-2">
                    <Label>Office start</Label>
                    <Input data-testid="user-start-input" value={form.office_start}
                      onChange={(e) => setForm({ ...form, office_start: e.target.value })} placeholder="11:00" />
                  </div>
                  <div className="space-y-2">
                    <Label>Office end</Label>
                    <Input data-testid="user-end-input" value={form.office_end}
                      onChange={(e) => setForm({ ...form, office_end: e.target.value })} placeholder="18:00" />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Working days</Label>
                  <div className="flex flex-wrap gap-2" data-testid="working-days">
                    {WEEKDAYS.map((d, i) => {
                      const active = form.working_days.includes(i);
                      return (
                        <button key={d} type="button"
                          data-testid={`working-day-${i}`}
                          onClick={() => setForm({
                            ...form,
                            working_days: active ? form.working_days.filter((x) => x !== i)
                              : [...form.working_days, i].sort(),
                          })}
                          className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                            active ? "border-brand bg-brand text-white" : "border-slate-200 bg-white text-slate-600"
                          }`}>
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {isAdmin && (
                  <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <Label className="text-sm font-semibold text-slate-800">Work from home (no GPS)</Label>
                        <p className="text-xs text-slate-500">
                          Attendance check-in/out is marked without verifying office GPS location.
                        </p>
                      </div>
                      <Switch
                        data-testid="user-wfh-switch"
                        checked={form.wfh}
                        onCheckedChange={(v) => setForm({ ...form, wfh: v })}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t border-slate-200 pt-3">
                      <div>
                        <Label className="text-sm font-semibold text-slate-800">Attendance not required</Label>
                        <p className="text-xs text-slate-500">
                          This profile won't need to check in/out at all (e.g. exempt roles).
                        </p>
                      </div>
                      <Switch
                        data-testid="user-attendance-exempt-switch"
                        checked={form.attendance_exempt}
                        onCheckedChange={(v) => setForm({ ...form, attendance_exempt: v })}
                      />
                    </div>
                  </div>
                )}

                <DialogFooter>
                  <Button type="submit" disabled={busy} data-testid="user-submit-btn" className="bg-brand hover:bg-brand-dark">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : editing ? "Save changes" : "Create profile"}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </div>

      {users === null && <div className="grid h-40 place-items-center"><Loader2 className="h-5 w-5 animate-spin text-brand" /></div>}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {users?.map((u, i) => {
          const meta = ROLE_META[u.role] || { label: u.role, cls: "bg-slate-50 text-slate-600 border-slate-200" };
          const score = scoreByAgent[u.id];
          return (
            <div key={u.id} data-testid={`user-card-${u.id}`}
              className="stagger-in rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-transform hover:-translate-y-[2px]"
              style={{ animationDelay: `${i * 40}ms` }}>
              <div className="flex items-start justify-between gap-2">
                <Link to={`/team/${u.id}`} className="flex items-center gap-3">
                  {u.avatar_url ? (
                    <img src={u.avatar_url} alt={u.name} className="h-11 w-11 rounded-full object-cover" />
                  ) : (
                    <div className="grid h-11 w-11 place-items-center rounded-full bg-brand-light text-sm font-bold text-brand">
                      {u.name.slice(0, 1)}
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-slate-900 hover:text-brand">{u.name}</div>
                    <div className="text-[11px] text-slate-400">{u.username}</div>
                  </div>
                </Link>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline" className={meta.cls}>
                    {meta.label}
                  </Badge>
                  {u.wfh && (
                    <Badge variant="outline" className="border-violet-200 bg-violet-50 text-violet-700">
                      WFH
                    </Badge>
                  )}
                  {u.team_lead_name && (
                    <div className="text-[10px] text-slate-400">under <b>{u.team_lead_name}</b></div>
                  )}
                </div>
              </div>

              {score && (
                <div className="mt-5 grid grid-cols-3 gap-2 text-center">
                  {[["Leads", score.leads], ["Won", score.won], ["Conv.", `${score.conversion}%`]].map(([k, v]) => (
                    <div key={k} className="rounded-lg bg-slate-50 py-2">
                      <div className="brand-font text-lg font-bold text-slate-900">{v}</div>
                      <div className="text-[10px] uppercase tracking-wider text-slate-400">{k}</div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-4 flex items-center justify-between text-xs text-slate-500">
                <span>{u.office_start || "11:00"} – {u.office_end || "18:00"}</span>
                {score && (
                  <span className="flex items-center gap-1.5">
                    <Timer className="h-3.5 w-3.5 text-brand" />{fmtDuration(score.talk_time || 0)}
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-center gap-2 border-t border-slate-100 pt-4">
                <Button size="sm" variant="outline" data-testid={`edit-user-${u.id}`}
                  onClick={() => openEdit(u)} className="gap-1.5">
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Link to={`/team/${u.id}`} data-testid={`view-user-${u.id}`}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50">
                  View
                </Link>
                {isAdmin && (
                  <div className="ml-auto flex items-center gap-2">
                    <Switch checked={u.active} onCheckedChange={() => toggleActive(u)} data-testid={`toggle-user-${u.id}`} />
                    <button onClick={() => remove(u)} data-testid={`delete-user-${u.id}`}
                      className="text-slate-300 transition-colors hover:text-rose-500">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {users?.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-400">
            No profiles yet. Create the first one.
          </div>
        )}
      </div>
    </div>
  );
}
