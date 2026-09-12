import { useState, useEffect } from "react";
import {
  CalendarDays, Clock3, MapPin, Phone, MessageSquare, Loader2,
  CheckCircle2, Plus, RefreshCw, User, Building2, AlertCircle
} from "lucide-react";
import { toast } from "sonner";
import { api, apiError, fmtDate } from "../../lib/api";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Textarea } from "../ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "../ui/select";
import { Badge } from "../ui/badge";

export const AppointmentsView = () => {
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const [form, setForm] = useState({
    customerName: "",
    phone: "",
    date: "",
    time: "",
    purpose: "Site visit & project consultation",
    project: "Prime Elmwood Residences (Sector 79)",
    notes: "",
  });

  const loadAppointments = async () => {
    setLoading(true);
    setErrorMessage("");
    try {
      const res = await api.get("/ai/appointments");
      const items = res.data?.items || (Array.isArray(res.data) ? res.data : []);
      setAppointments(items);
    } catch (err) {
      setErrorMessage("Failed to load appointments.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAppointments();
  }, []);

  const updateField = (key, val) => {
    setForm((prev) => ({ ...prev, [key]: val }));
  };

  const handleCreateAppointment = async (e) => {
    e.preventDefault();
    if (!form.customerName.trim() || !form.phone.trim() || !form.date || !form.time) {
      toast.error("Please fill all required appointment fields");
      return;
    }

    setSaving(true);
    setStatusMessage("");
    setErrorMessage("");

    try {
      await api.post("/ai/appointments", {
        customer_name: form.customerName.trim(),
        phone: form.phone.trim(),
        date: form.date,
        time: form.time,
        purpose: form.purpose,
        project: form.project,
        notes: form.notes.trim() || undefined,
      });

      toast.success("Appointment & site visit booked successfully!");
      setStatusMessage("Appointment saved and added to CRM calendar.");
      setForm({
        customerName: "",
        phone: "",
        date: "",
        time: "",
        purpose: "Site visit & project consultation",
        project: "Prime Elmwood Residences (Sector 79)",
        notes: "",
      });
      await loadAppointments();
    } catch (err) {
      const msg = err.response?.data?.detail || err.message || "Failed to book appointment.";
      setErrorMessage(msg);
      toast.error(apiError(msg));
    } finally {
      setSaving(false);
    }
  };

  const formatScheduleDate = (d, t) => {
    try {
      const parsed = new Date(`${d}T${t || "00:00"}`);
      if (!isNaN(parsed.getTime())) {
        return new Intl.DateTimeFormat("en-IN", {
          weekday: "short",
          month: "short",
          day: "numeric",
          year: "numeric",
        }).format(parsed);
      }
    } catch (_) {}
    return d || "Date not set";
  };

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      {/* Booking Form */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
            <CalendarDays className="h-3.5 w-3.5" /> Site Visit & Appointment Desk
          </div>
          <h2 className="brand-font mt-1 text-xl font-bold text-slate-900">Book a Customer Appointment</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Schedule site visits or consultation calls for buyers generated via AI calling or direct sales.
          </p>
        </div>

        <form onSubmit={handleCreateAppointment} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-medium text-slate-700">Customer Name *</Label>
              <Input
                required
                value={form.customerName}
                onChange={(e) => updateField("customerName", e.target.value)}
                placeholder="e.g. Rajesh Sharma"
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-700">Phone Number *</Label>
              <Input
                required
                type="tel"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                placeholder="+91 9876543210"
                className="mt-1 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-medium text-slate-700">Date *</Label>
              <Input
                required
                type="date"
                value={form.date}
                onChange={(e) => updateField("date", e.target.value)}
                className="mt-1 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs font-medium text-slate-700">Time *</Label>
              <Input
                required
                type="time"
                value={form.time}
                onChange={(e) => updateField("time", e.target.value)}
                className="mt-1 text-sm"
              />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label className="text-xs font-medium text-slate-700">Project</Label>
              <Select value={form.project} onValueChange={(v) => updateField("project", v)}>
                <SelectTrigger className="mt-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Prime Elmwood Residences (Sector 79)">Prime Elmwood (Sec 79)</SelectItem>
                  <SelectItem value="Prime Skyline Towers (Golf Course Ext)">Prime Skyline Towers</SelectItem>
                  <SelectItem value="Prime Green Vista (Sohna Road)">Prime Green Vista</SelectItem>
                  <SelectItem value="General Consultation (Multiple)">General Consultation</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs font-medium text-slate-700">Purpose</Label>
              <Input
                value={form.purpose}
                onChange={(e) => updateField("purpose", e.target.value)}
                placeholder="Site visit, consultation, pricing..."
                className="mt-1 text-sm"
              />
            </div>
          </div>

          <div>
            <Label className="text-xs font-medium text-slate-700">Consultant Notes</Label>
            <Textarea
              rows={3}
              value={form.notes}
              onChange={(e) => updateField("notes", e.target.value)}
              placeholder="Customer looking for 3 BHK under 1.8 Cr. Prefers weekend morning slot..."
              className="mt-1 text-sm"
            />
          </div>

          <Button
            type="submit"
            disabled={saving}
            className="w-full gap-2 bg-brand py-2.5 text-sm font-semibold hover:bg-brand-dark"
          >
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Saving Appointment...
              </>
            ) : (
              <>
                <CalendarDays className="h-4 w-4" /> Book Site Visit / Appointment
              </>
            )}
          </Button>

          {statusMessage && (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-800">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
              <span>{statusMessage}</span>
            </div>
          )}

          {errorMessage && (
            <div className="flex items-center gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
              <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}
        </form>
      </div>

      {/* Appointments List */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-brand">
              <Clock3 className="h-3.5 w-3.5" /> Upcoming Schedule
            </div>
            <h2 className="brand-font mt-1 text-xl font-bold text-slate-900">Booked Site Visits & Calls</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              Live bookings captured automatically from AI voice calls and manual entries.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={loadAppointments}
            disabled={loading}
            className="gap-1 text-xs"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>

        <div className="mt-5">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-slate-400 text-sm gap-2">
              <Loader2 className="h-5 w-5 animate-spin text-brand" /> Loading schedule...
            </div>
          ) : appointments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 py-16 text-center">
              <CalendarDays className="mx-auto h-9 w-9 text-slate-300" />
              <div className="mt-3 text-sm font-semibold text-slate-800">No appointments yet</div>
              <p className="mt-1 text-xs text-slate-400 max-w-sm mx-auto">
                When Simran books a site visit during an AI telecall or you submit the form, it will appear right here.
              </p>
            </div>
          ) : (
            <div className="space-y-3 max-h-[540px] overflow-y-auto pr-1">
              {appointments.map((apt, idx) => {
                const name = apt.customer_name || apt.customerName || apt.name || "Unnamed Customer";
                const date = apt.date || apt.appointmentDate || "";
                const time = apt.time || apt.appointmentTime || "";
                const phone = apt.phone || "";
                const purpose = apt.purpose || "Property consultation";
                const project = apt.project || "Gurgaon Property";
                const notes = apt.notes || "";
                const status = apt.status || "Scheduled";

                return (
                  <div
                    key={apt.id || apt._id || `${date}-${time}-${idx}`}
                    className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 transition-all hover:bg-white hover:shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <div className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-brand" />
                          {name}
                        </div>
                        <div className="mt-1 flex items-center gap-1 text-xs font-medium text-slate-600">
                          <Clock3 className="h-3 w-3 text-slate-400" />
                          {formatScheduleDate(date, time)} · {time || "Time TBA"}
                        </div>
                      </div>
                      <Badge variant="outline" className="bg-brand-light/30 text-brand border-brand/20 font-semibold text-[11px]">
                        {status}
                      </Badge>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-slate-600">
                      {phone && (
                        <a
                          href={`tel:${phone}`}
                          className="flex items-center gap-1 text-slate-700 hover:text-brand transition-colors"
                        >
                          <Phone className="h-3 w-3 text-slate-400" />
                          {phone}
                        </a>
                      )}
                      <div className="flex items-center gap-1 text-slate-600">
                        <Building2 className="h-3 w-3 text-slate-400" />
                        {project}
                      </div>
                      <div className="flex items-center gap-1 text-slate-500">
                        <MapPin className="h-3 w-3 text-slate-400" />
                        {purpose}
                      </div>
                    </div>

                    {notes && (
                      <div className="mt-2 rounded-lg bg-white p-2.5 text-xs text-slate-600 border border-slate-100">
                        <span className="font-medium text-slate-700">Notes: </span>
                        {notes}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
