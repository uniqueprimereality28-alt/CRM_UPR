import { useEffect, useState } from "react";
import {
  Loader2, Users, UserX, Timer, Award, ClipboardEdit, Pencil,
  Download, FileSpreadsheet, FileText, Calendar, RefreshCw, Check
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDate, fmtDuration } from "../lib/api";
import { StatCard } from "../components/StatCard";
import { useAuth } from "../context/AuthContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "../components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../components/ui/select";

const statusLabel = {
  present: { text: "Present", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  absent: { text: "Absent", cls: "bg-rose-50 text-rose-700 border-rose-200" },
  leave: { text: "On Leave", cls: "bg-amber-50 text-amber-700 border-amber-200" },
};

const emptyMarkForm = { user_id: "", date_str: new Date().toISOString().slice(0, 10), status: "present", note: "" };

export function getDisplayRole(name, role) {
  if (!role) return "—";
  const n = (name || "").toLowerCase();
  const r = (role || "").toLowerCase();
  if (n.includes("vrinda") || n.includes("vranda") || r === "superadmin") {
    return "Technical Head";
  }
  if (r === "admin") return "Admin";
  if (r === "team_lead") return "Team Lead";
  if (r === "sales") return "Sales";
  return role.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function toLocalInput(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function TeamAttendance() {
  const { isAdmin, isVranda } = useAuth();
  const [period, setPeriod] = useState("week");
  const [stats, setStats] = useState(null);
  const [today, setToday] = useState(null);
  const [users, setUsers] = useState([]);
  const [markOpen, setMarkOpen] = useState(false);
  const [markForm, setMarkForm] = useState(emptyMarkForm);
  const [markBusy, setMarkBusy] = useState(false);

  // In/out time correction — restricted to vranda.aggarwal only
  const [editRow, setEditRow] = useState(null);
  const [editCheckIn, setEditCheckIn] = useState("");
  const [editCheckOut, setEditCheckOut] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  // Download Attendance modal state
  const [exportOpen, setExportOpen] = useState(false);
  const [exportPeriodType, setExportPeriodType] = useState("august_2026");
  const [exportMonth, setExportMonth] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
  const [exportStartDate, setExportStartDate] = useState("2026-08-01");
  const [exportEndDate, setExportEndDate] = useState("2026-08-31");
  const [exportUser, setExportUser] = useState("all");
  const [previewData, setPreviewData] = useState(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState("");

  const loadStats = (p) => api.get("/attendance/stats", { params: { period: p } })
    .then((r) => setStats(r.data)).catch(() => setStats(false));

  const loadToday = () => api.get("/attendance/today")
    .then((r) => setToday(r.data)).catch(() => setToday(false));

  useEffect(() => { loadStats(period); }, [period]);
  useEffect(() => { loadToday(); }, []);
  useEffect(() => {
    if (isAdmin) api.get("/users").then((r) => setUsers(r.data || [])).catch(() => setUsers([]));
  }, [isAdmin]);

  const getExportParams = () => {
    const params = { user_id: exportUser };
    if (exportPeriodType === "august_2026") {
      params.month = "2026-08";
    } else if (exportPeriodType === "this_month") {
      const d = new Date();
      params.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } else if (exportPeriodType === "last_month") {
      const d = new Date();
      d.setMonth(d.getMonth() - 1);
      params.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    } else if (exportPeriodType === "specific_month") {
      params.month = exportMonth;
    } else if (exportPeriodType === "custom") {
      params.start_date = exportStartDate;
      params.end_date = exportEndDate;
    }
    return params;
  };

  const loadPreview = async () => {
    setPreviewBusy(true);
    try {
      const params = getExportParams();
      const res = await api.get("/attendance/report/preview", { params });
      setPreviewData(res.data);
    } catch (err) {
      toast.error("Failed to load attendance preview: " + apiError(err.response?.data?.detail));
    } finally {
      setPreviewBusy(false);
    }
  };

  useEffect(() => {
    if (exportOpen) {
      loadPreview();
    }
  }, [exportOpen, exportPeriodType, exportMonth, exportStartDate, exportEndDate, exportUser]);

  const handleDownload = async (format = "excel") => {
    setDownloadBusy(format);
    try {
      const params = getExportParams();
      const endpoint = format === "excel" ? "/attendance/export/excel" : "/attendance/export/pdf";
      const res = await api.get(endpoint, {
        params,
        responseType: "blob",
      });

      let filename = `UPR_Attendance_${format === "excel" ? "Report.xlsx" : "Report.pdf"}`;
      const disposition = res.headers["content-disposition"];
      if (disposition && disposition.indexOf("filename=") !== -1) {
        const matches = /filename="([^"]+)"/.exec(disposition);
        if (matches && matches[1]) filename = matches[1];
      }

      const blob = new Blob([res.data], {
        type: format === "excel"
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "application/pdf",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      toast.success(`Downloaded ${format.toUpperCase()} attendance statement`);
    } catch (err) {
      toast.error(`Download failed: ${apiError(err.response?.data?.detail)}`);
    } finally {
      setDownloadBusy("");
    }
  };

  const submitMark = async (e) => {
    e.preventDefault();
    if (!markForm.user_id) return toast.error("Choose a team member");
    setMarkBusy(true);
    try {
      const fd = new FormData();
      fd.append("user_id", markForm.user_id);
      fd.append("date_str", markForm.date_str);
      fd.append("status", markForm.status);
      if (markForm.note) fd.append("note", markForm.note);
      await api.post("/attendance/mark-manual", fd);
      toast.success("Attendance marked");
      setMarkOpen(false);
      setMarkForm(emptyMarkForm);
      loadToday();
      loadStats(period);
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setMarkBusy(false); }
  };

  const openEdit = (r) => {
    setEditRow(r);
    setEditCheckIn(toLocalInput(r.check_in_at));
    setEditCheckOut(toLocalInput(r.check_out_at));
    setEditNote("");
  };

  const closeEdit = () => {
    if (editBusy) return;
    setEditRow(null);
  };

  const saveEditTimes = async (e) => {
    e.preventDefault();
    if (!editRow?.attendance_id) return;
    setEditBusy(true);
    try {
      await api.put(`/attendance/${editRow.attendance_id}`, {
        check_in_at: editCheckIn ? new Date(editCheckIn).toISOString() : null,
        check_out_at: editCheckOut ? new Date(editCheckOut).toISOString() : null,
        note: editNote || undefined,
      });
      toast.success("Attendance time updated");
      setEditRow(null);
      loadToday();
      loadStats(period);
    } catch (err) {
      toast.error(apiError(err.response?.data?.detail));
    } finally { setEditBusy(false); }
  };

  const perUser = stats?.per_user || [];
  const totalOvertime = perUser.reduce((a, u) => a + (u.overtime_seconds || 0), 0);
  const absenteeCount = perUser.filter((u) => u.absent_days > 0).length;
  const maxWorked = Math.max(1, ...perUser.map((u) => u.worked_seconds || 0));

  return (
    <div className="space-y-6" data-testid="team-attendance-page">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-slate-900 md:text-4xl">Team Attendance</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Weekly and monthly attendance stats across the whole team.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Download Attendance Button */}
          <Button
            data-testid="download-attendance-btn"
            onClick={() => setExportOpen(true)}
            className="gap-2 bg-emerald-600 font-semibold text-white shadow-sm hover:bg-emerald-700"
          >
            <Download className="h-4 w-4" /> Download Attendance
          </Button>

          {isAdmin && (
            <Dialog open={markOpen} onOpenChange={(v) => { setMarkOpen(v); if (!v) setMarkForm(emptyMarkForm); }}>
              <DialogTrigger asChild>
                <Button data-testid="mark-attendance-btn" variant="outline" className="gap-2">
                  <ClipboardEdit className="h-4 w-4" /> Mark attendance
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-md">
                <DialogHeader>
                  <DialogTitle>Mark attendance manually</DialogTitle>
                </DialogHeader>
                <p className="-mt-2 text-sm text-slate-500">
                  For anyone who forgot to check in/out, or needs a leave/absence recorded.
                </p>
                <form onSubmit={submitMark} className="space-y-4">
                  <div className="space-y-2">
                    <Label>Team member *</Label>
                    <Select value={markForm.user_id} onValueChange={(v) => setMarkForm({ ...markForm, user_id: v })}>
                      <SelectTrigger data-testid="mark-attendance-user-select"><SelectValue placeholder="Choose a team member" /></SelectTrigger>
                      <SelectContent>
                        {users.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name} ({getDisplayRole(u.name, u.role)})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Date</Label>
                      <Input type="date" data-testid="mark-attendance-date-input" value={markForm.date_str}
                        onChange={(e) => setMarkForm({ ...markForm, date_str: e.target.value })} />
                    </div>
                    <div className="space-y-2">
                      <Label>Status</Label>
                      <Select value={markForm.status} onValueChange={(v) => setMarkForm({ ...markForm, status: v })}>
                        <SelectTrigger data-testid="mark-attendance-status-select"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="present">Present</SelectItem>
                          <SelectItem value="absent">Absent</SelectItem>
                          <SelectItem value="leave">On Leave</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Note (optional)</Label>
                    <Textarea data-testid="mark-attendance-note-input" value={markForm.note} rows={2}
                      placeholder="e.g. Forgot to check in, confirmed present in office"
                      onChange={(e) => setMarkForm({ ...markForm, note: e.target.value })} />
                  </div>
                  <DialogFooter>
                    <Button type="submit" disabled={markBusy} data-testid="mark-attendance-submit-btn" className="bg-brand hover:bg-brand-dark">
                      {markBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save attendance"}
                    </Button>
                  </DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          )}
        </div>
      </div>

      {/* Download Attendance Modal */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-h-[92vh] max-w-5xl overflow-y-auto" data-testid="export-attendance-dialog">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <Download className="h-5 w-5 text-emerald-600" />
              Download Attendance Report
            </DialogTitle>
          </DialogHeader>
          <p className="-mt-2 text-sm text-slate-500">
            Select a period and team member to export multi-sheet Excel workbooks (.xlsx) with individual In/Out punch logs or styled PDF statements.
          </p>

          <div className="space-y-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Duration Period</Label>
                <Select value={exportPeriodType} onValueChange={setExportPeriodType}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="august_2026">August 2026 (Full Month)</SelectItem>
                    <SelectItem value="this_month">Current Month</SelectItem>
                    <SelectItem value="last_month">Previous Month</SelectItem>
                    <SelectItem value="specific_month">Select Specific Month</SelectItem>
                    <SelectItem value="custom">Custom Date Range</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {exportPeriodType === "specific_month" && (
                <div className="space-y-1.5">
                  <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Month</Label>
                  <Input
                    type="month"
                    className="bg-white"
                    value={exportMonth}
                    onChange={(e) => setExportMonth(e.target.value)}
                  />
                </div>
              )}

              {exportPeriodType === "custom" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Start Date</Label>
                    <Input
                      type="date"
                      className="bg-white"
                      value={exportStartDate}
                      onChange={(e) => setExportStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">End Date</Label>
                    <Input
                      type="date"
                      className="bg-white"
                      value={exportEndDate}
                      onChange={(e) => setExportEndDate(e.target.value)}
                    />
                  </div>
                </>
              )}

              <div className="space-y-1.5">
                <Label className="text-xs font-semibold uppercase tracking-wider text-slate-500">Team Member</Label>
                <Select value={exportUser} onValueChange={setExportUser}>
                  <SelectTrigger className="bg-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Team Members (Full Team)</SelectItem>
                    {users.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name} ({getDisplayRole(u.name, u.role)})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-end">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={loadPreview}
                  disabled={previewBusy}
                  className="w-full gap-2 bg-white"
                >
                  <RefreshCw className={`h-4 w-4 ${previewBusy ? "animate-spin text-brand" : ""}`} />
                  Refresh Preview
                </Button>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-bold text-slate-900">
                Attendance Report Preview — {previewData?.period_label || "Loading..."}
              </h4>
              {previewData && (
                <span className="text-xs text-slate-500">
                  {previewData.total_tracked} member{previewData.total_tracked === 1 ? "" : "s"} tracked
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-100 text-xs font-bold uppercase tracking-wider text-slate-600">
                    <th className="px-3 py-2.5 text-center">S.No</th>
                    <th className="px-4 py-2.5 text-left">Employee Name</th>
                    <th className="px-3 py-2.5 text-center">Role</th>
                    <th className="px-3 py-2.5 text-center">Days Present</th>
                    <th className="px-3 py-2.5 text-center">Total Hours Worked</th>
                    <th className="px-3 py-2.5 text-center">Total Overtime</th>
                    <th className="px-3 py-2.5 text-center">Late Markings</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {previewBusy && (
                    <tr>
                      <td colSpan={7} className="py-12 text-center">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin text-brand" />
                        <span className="mt-2 block text-xs text-slate-400">Loading attendance data...</span>
                      </td>
                    </tr>
                  )}

                  {!previewBusy && (!previewData?.summary_rows || previewData.summary_rows.length === 0) && (
                    <tr>
                      <td colSpan={7} className="py-8 text-center text-sm text-slate-400">
                        No attendance records found for the selected period.
                      </td>
                    </tr>
                  )}

                  {!previewBusy && previewData?.summary_rows?.map((r) => (
                    <tr key={r.user_id || r.sno} className="hover:bg-slate-50/80">
                      <td className="px-3 py-2 text-center text-slate-500">{r.sno}</td>
                      <td className="px-4 py-2 font-semibold text-slate-800">{r.name}</td>
                      <td className="px-3 py-2 text-center">
                        <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                          {r.role}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-center font-bold text-emerald-600">{r.present_days}</td>
                      <td className="px-3 py-2 text-center font-medium text-slate-700">{r.worked_hm}</td>
                      <td className="px-3 py-2 text-center font-medium text-amber-600">{r.overtime_hm}</td>
                      <td className="px-3 py-2 text-center font-medium text-rose-600">{r.late_markings}</td>
                    </tr>
                  ))}
                </tbody>
                {previewData?.totals && !previewBusy && previewData.summary_rows?.length > 0 && (
                  <tfoot>
                    <tr className="border-t border-slate-200 bg-slate-100/90 font-bold text-slate-900">
                      <td className="px-3 py-2.5 text-center">—</td>
                      <td className="px-4 py-2.5">Total ({previewData.total_tracked} members)</td>
                      <td className="px-3 py-2.5 text-center">—</td>
                      <td className="px-3 py-2.5 text-center text-emerald-700">{previewData.totals.present_days}</td>
                      <td className="px-3 py-2.5 text-center">{previewData.totals.worked_hm}</td>
                      <td className="px-3 py-2.5 text-center text-amber-700">{previewData.totals.overtime_hm}</td>
                      <td className="px-3 py-2.5 text-center text-rose-700">{previewData.totals.late_markings}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <DialogFooter className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-4">
            <div className="text-xs text-slate-400">
              * Excel file includes <b>Summary</b>, <b>Attendance Matrix</b>, and <b>Individual sheets</b> with In/Out timings for each employee.
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={!!downloadBusy}
                onClick={() => setExportOpen(false)}
              >
                Close
              </Button>

              <Button
                type="button"
                data-testid="export-excel-btn"
                disabled={!!downloadBusy}
                onClick={() => handleDownload("excel")}
                className="gap-2 bg-emerald-600 text-white hover:bg-emerald-700"
              >
                {downloadBusy === "excel" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileSpreadsheet className="h-4 w-4" />
                )}
                Download Excel (.xlsx)
              </Button>

              <Button
                type="button"
                data-testid="export-pdf-btn"
                disabled={!!downloadBusy}
                onClick={() => handleDownload("pdf")}
                className="gap-2 bg-brand text-white hover:bg-brand-dark"
              >
                {downloadBusy === "pdf" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <FileText className="h-4 w-4" />
                )}
                Download PDF (.pdf)
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Team Attendance Dashboard</h2>
          <p className="mt-0.5 text-sm text-slate-500">
            {stats ? `${stats.start} to ${stats.end} · ${stats.working_days} working days` : "Loading…"}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 shadow-sm">
          {["week", "month"].map((p) => (
            <button
              key={p}
              data-testid={`attendance-period-${p}`}
              onClick={() => setPeriod(p)}
              className={`rounded-md px-4 py-1.5 text-sm font-semibold capitalize transition ${
                period === p ? "bg-brand text-white" : "text-slate-500 hover:text-slate-800"
              }`}
            >
              This {p}
            </button>
          ))}
        </div>
      </div>

      {stats === null && (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-brand" /></div>
      )}

      {stats === false && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          Couldn't load team attendance stats.
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatCard testId="team-kpi-tracked" label="Team members tracked" value={perUser.length} icon={Users} accent="brand" />
            <StatCard testId="team-kpi-ontime" label="On-time (no lates)" value={stats.on_time_count} icon={Award} accent="emerald" delay={60} />
            <StatCard testId="team-kpi-absentees" label="Have absences" value={absenteeCount} icon={UserX} accent="rose" delay={120} />
            <StatCard testId="team-kpi-overtime" label="Total overtime" value={fmtDuration(totalOvertime)} icon={Timer} accent="amber" delay={180} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* Top overtime */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Top overtime this {period}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {stats.top_overtime.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-400">No overtime logged</div>
                )}
                {stats.top_overtime.map((u, i) => (
                  <div key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{i + 1}</span>
                      <span className="font-medium text-slate-800">{u.name}</span>
                      {u.team_lead_name && <span className="text-xs text-slate-400">· {u.team_lead_name}</span>}
                    </div>
                    <span className="font-semibold text-emerald-600">{fmtDuration(u.overtime_seconds)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Top absentees */}
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="border-b border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-900">Most absences this {period}</h3>
              </div>
              <div className="divide-y divide-slate-100">
                {stats.top_absent.length === 0 && (
                  <div className="p-6 text-center text-sm text-slate-400">No absences — 🎉</div>
                )}
                {stats.top_absent.map((u, i) => (
                  <div key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{i + 1}</span>
                      <span className="font-medium text-slate-800">{u.name}</span>
                      {u.team_lead_name && <span className="text-xs text-slate-400">· {u.team_lead_name}</span>}
                    </div>
                    <span className="font-semibold text-rose-600">{u.absent_days}d absent</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Worked-hours bar comparison */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Hours worked this {period}</h3>
            </div>
            <div className="space-y-3 p-4">
              {perUser.length === 0 && <div className="py-6 text-center text-sm text-slate-400">No data yet</div>}
              {perUser
                .slice()
                .sort((a, b) => (b.worked_seconds || 0) - (a.worked_seconds || 0))
                .map((u, idx) => (
                  <div key={u.user_id} className="flex items-center gap-3">
                    <span className="w-5 text-xs font-semibold text-slate-400">{idx + 1}</span>
                    <div className="w-36 shrink-0 truncate text-sm font-medium text-slate-700">
                      {u.name}
                    </div>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                      <div
                        className="h-full rounded-full bg-brand"
                        style={{ width: `${Math.max(2, ((u.worked_seconds || 0) / maxWorked) * 100)}%` }}
                      />
                    </div>
                    <div className="w-20 shrink-0 text-right text-xs font-semibold text-slate-500">
                      {fmtDuration(u.worked_seconds || 0)}
                    </div>
                  </div>
                ))}
            </div>
          </div>

          {/* Top late */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-4">
              <h3 className="text-sm font-semibold text-slate-900">Most late-arrivals this {period}</h3>
            </div>
            <div className="divide-y divide-slate-100">
              {stats.top_late.length === 0 && (
                <div className="p-6 text-center text-sm text-slate-400">No late arrivals</div>
              )}
              {stats.top_late.map((u, i) => (
                <div key={u.user_id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">{i + 1}</span>
                    <span className="font-medium text-slate-800">{u.name}</span>
                    <span className="text-xs text-slate-400">· {u.late_days} late day{u.late_days === 1 ? "" : "s"}</span>
                  </div>
                  <span className="font-semibold text-amber-600">{fmtDuration(u.late_seconds)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Live today */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-900">Today, live</h3>
          {today && <span className="text-xs text-slate-400">{today.date}</span>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-[11px] uppercase tracking-wider text-slate-400">
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-left">Role</th>
                <th className="px-3 py-2 text-left">Status</th>
                <th className="px-3 py-2 text-left">Check-in</th>
                <th className="px-3 py-2 text-left">Check-out</th>
                <th className="px-4 py-2 text-right">Worked</th>
                {isVranda && <th className="w-10 px-3 py-2" />}
              </tr>
            </thead>
            <tbody>
              {today === null && (
                <tr><td colSpan={isVranda ? 7 : 6} className="p-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-brand" /></td></tr>
              )}
              {today?.rows?.length === 0 && (
                <tr><td colSpan={isVranda ? 7 : 6} className="p-8 text-center text-slate-400">No one to show yet.</td></tr>
              )}
              {today?.rows?.map((r) => {
                const sl = statusLabel[r.status] || statusLabel.absent;
                return (
                  <tr key={r.user_id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <td className="px-4 py-2 font-medium text-slate-800">{r.user_name}{r.check_in_wfh && <span className="ml-1 text-[10px] text-slate-400">(WFH)</span>}</td>
                    <td className="px-3 py-2 text-slate-600 font-medium">{getDisplayRole(r.user_name, r.role)}</td>
                    <td className="px-3 py-2">
                      <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${sl.cls}`}>{sl.text}</span>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{r.check_in_at ? fmtDate(r.check_in_at) : "—"}</td>
                    <td className="px-3 py-2 text-slate-600">{r.check_out_at ? fmtDate(r.check_out_at) : "—"}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">{r.worked_seconds ? fmtDuration(r.worked_seconds) : "—"}</td>
                    {isVranda && (
                      <td className="px-3 py-2 text-right">
                        <button type="button" onClick={() => openEdit(r)} disabled={!r.attendance_id}
                          data-testid={`edit-attendance-${r.user_id}`} title={r.attendance_id ? "Correct check-in/out time" : "No attendance record yet today"}
                          className="rounded p-1 text-slate-300 transition-colors hover:text-brand disabled:cursor-not-allowed disabled:opacity-30">
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* In/out time correction — vranda.aggarwal only */}
      <Dialog open={!!editRow} onOpenChange={(open) => !open && closeEdit()}>
        <DialogContent className="sm:max-w-md" data-testid="edit-attendance-dialog">
          <DialogHeader>
            <DialogTitle>Correct check-in / check-out time</DialogTitle>
          </DialogHeader>
          {editRow && (
            <p className="-mt-2 text-sm text-slate-500">
              {editRow.user_name} · {today?.date}
            </p>
          )}
          <form onSubmit={saveEditTimes} className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Check-in</Label>
                <Input type="datetime-local" data-testid="edit-attendance-checkin"
                  value={editCheckIn} onChange={(e) => setEditCheckIn(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Check-out</Label>
                <Input type="datetime-local" data-testid="edit-attendance-checkout"
                  value={editCheckOut} onChange={(e) => setEditCheckOut(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Reason (optional)</Label>
              <Textarea data-testid="edit-attendance-note" value={editNote} rows={2}
                placeholder="e.g. Phone GPS lagged, actual check-in was earlier"
                onChange={(e) => setEditNote(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeEdit} disabled={editBusy}>Cancel</Button>
              <Button type="submit" disabled={editBusy} data-testid="save-attendance-edit" className="bg-brand hover:bg-brand-dark">
                {editBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save correction"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
