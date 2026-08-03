# Unique Prime Reality CRM — PRD

## Original problem statement
Integrate a complete Attendance Management module into the existing Unique Prime Reality
React CRM. Do NOT rewrite the project — keep the current design language and code quality.
Requirements: role hierarchy (superadmin vranda.aggarwal / admin sandeep.chauhan / team_lead
/ sales / employee), GPS-verified attendance with 500 m office radius, working hours
11 am – 6 pm (configurable per user), overtime & late tracking, weekly/monthly absentee
dashboards, superadmin ability to edit anyone's attendance, CSV / manual lead import with
hot / raw / warm / cold / custom tags, follow-up filters by status and date range, team
hierarchy (TL manages sales), team chat groups + broadcast alerts, password change, admin
lead assignment to individual sales OR to team leaders, mobile-responsive UI. Default
password `Welcome@123`. Downloadable zip for Railway deploy. In-house CRM only — not for
Play/App Store.

## Architecture tasks done (Feb 2026 initial build)
- Imported existing CRM zip into `/app`; preserved design system (Outfit + Inter fonts,
  brand blue #1a3fbf, shadcn UI components, sonner toasts, lucide icons).
- Extended MongoDB models: `users.role` (super/admin/hr/team_lead/sales/employee),
  `team_lead_id`, `office_start`, `office_end`, `working_days`; `leads.tag`,
  `leads.follow_up_status`, `leads.remark`; new collections `attendance`, `groups`,
  `messages`, `alerts`, `settings`.
- FastAPI role helpers: `is_super`, `is_admin_or_super`, `is_manager`, `can_view_all`,
  `require_super`, `require_admin`, `require_manager`; lead / call / dashboard scoping
  automatically restricted to team_lead's team or sales user's own records.
- GPS attendance with Haversine distance vs configurable office coords + radius;
  IST-anchored date bucketing; late & overtime seconds computed at check-in/out.
- Superadmin-only endpoints: `/settings` (PUT), `/attendance/{id}` (edit),
  `/attendance/mark-manual`, create users of role admin/superadmin.
- Broadcast alerts polled every 45 s from Layout; unread badge on Team Chat nav.
- Zip export endpoint updated to include new modules and .env.example.

## User personas
- **Vranda Aggarwal** — Technical Head (superadmin). Edits any record, sets office
  coordinates, creates admin/HR accounts.
- **Sandeep Chauhan** — Admin. Creates team leaders, sales, employees; assigns leads;
  views all dashboards; listens to any call recording.
- **Team leaders** (Manish, Pankaj, Abhishek, Rakesh) — Manage own team, assign leads,
  mark attendance, view team's talk-time & pipeline.
- **Sales executives** (Kashish, Paviter, …) — Manage their leads, mark attendance,
  chat, receive alerts.
- **Employees** — Attendance + chat + profile only.

## Core requirements (static)
- Preserve existing UI/UX conventions
- Role hierarchy with granular permissions
- Attendance must be GPS-verified inside a configurable radius
- Every non-admin role must mark attendance
- Superadmin can edit anyone's attendance
- CSV import supports default tag + default remark for the whole file
- Follow-up filters by status and date range
- Team chat + broadcast alerts (polling, no external service)
- Downloadable full source zip (via admin sidebar)

## What's been implemented (Feb 2026)
- Auth: JWT + HttpOnly cookie, brute-force lockout, change-password
- 8 seeded users: vranda, sandeep + 4 team leaders + 2 sales
- Attendance: check-in/out, self history 60 days, team-today view, weekly/monthly stats
  (present/absent/late/overtime), superadmin edit + manual mark
- Leads: existing pipeline + new tag/follow-up-status/remark, CSV import with default
  tag/remark, tag filter + follow-up date range + status filter, inline row tag editor
- Team page: create profiles with role dropdown restricted per creator role, working-days
  chips, per-user office hours, hierarchy shown ("under TL name")
- Calls: unchanged behavior; visibility now respects role hierarchy
- Chat: groups with member picker, per-group message list (polling every 8 s),
  broadcast Alerts with role/user/all targeting and priority
- Settings (super only): office lat/lng/radius/label + default hours + "Use my current
  GPS" helper
- Profile: password change + view of working hours/days/team leader
- Layout: role-based nav, alerts unread badge, download-source button for admins,
  responsive sidebar for mobile
- Legacy features preserved: click-to-call with mic recording, follow-up reminders,
  WhatsApp brochure ticks, daily report card, ReminderBell popups

## Prioritized backlog
### P0 (before wider roll-out)
- HR role: build HR-facing pages (leave requests, payroll placeholder) — currently HR
  is just a permission bucket
- Employee "self attendance calendar" view (monthly heatmap)
- SMS or email notification when superadmin edits someone's attendance

### P1
- Push / browser notification when a new broadcast alert arrives (currently in-app poll)
- Excel export of monthly attendance for payroll
- Bulk import of team via CSV (usernames + roles + team leader mapping)
- Lead deduplication on phone during CSV import

### P2
- Real-time chat via WebSockets (replace 8 s polling)
- Multiple office locations (multi-tenant office switching)
- Face-recognition or QR-based attendance as a fallback to GPS
