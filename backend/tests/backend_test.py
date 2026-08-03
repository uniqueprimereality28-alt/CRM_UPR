"""
Backend tests for Unique Prime Reality CRM - Attendance module + role hierarchy.
Covers: auth, users/roles, settings, attendance (check-in/out, edit, manual, stats),
leads (tags, follow-up filters, import, assign), groups, alerts, dashboards, legacy endpoints.
"""
import io
import os
import time
import uuid
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback for local run (still real URL to preview)
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
API = f"{BASE_URL}/api"

OFFICE_LAT, OFFICE_LNG = 28.4595, 77.0266
FAR_LAT, FAR_LNG = 19.0760, 72.8777  # Mumbai - well outside 500m


CREDS = {
    "super": ("vranda.aggarwal", "Vranda@123"),
    "admin": ("sandeep.chauhan", "Sandeep@123"),
    "tl": ("abhishek.janghu", "Welcome@123"),
    "tl2": ("manish.singh", "Welcome@123"),
    "sales": ("kashish.aggarwal", "Welcome@123"),
    "sales2": ("paviter.dahiya", "Welcome@123"),
}


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=15)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    data = r.json()
    return data["access_token"], data["user"]


@pytest.fixture(scope="session")
def tokens():
    out = {}
    for k, (u, p) in CREDS.items():
        try:
            tok, user = _login(u, p)
            out[k] = {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}
        except AssertionError as e:
            out[k] = {"error": str(e)}
    return out


def H(tokens, k):
    return tokens[k]["headers"]


# ---------------- AUTH ----------------
class TestAuth:
    def test_all_logins(self, tokens):
        for role in CREDS:
            assert "error" not in tokens[role], f"login failed for {role}: {tokens[role].get('error')}"
            assert tokens[role]["user"]["username"] == CREDS[role][0].lower()

    def test_super_role(self, tokens):
        assert tokens["super"]["user"]["role"] == "superadmin"
        assert tokens["admin"]["user"]["role"] == "admin"
        assert tokens["tl"]["user"]["role"] == "team_lead"
        assert tokens["sales"]["user"]["role"] == "sales"

    def test_me(self, tokens):
        r = requests.get(f"{API}/auth/me", headers=H(tokens, "sales"))
        assert r.status_code == 200
        assert r.json()["username"] == "kashish.aggarwal"

    def test_change_password_wrong(self, tokens):
        r = requests.post(f"{API}/auth/change-password",
                          headers=H(tokens, "sales"),
                          json={"current_password": "WRONG_PW", "new_password": "Newpass1"})
        assert r.status_code == 400

    def test_change_password_short(self, tokens):
        r = requests.post(f"{API}/auth/change-password",
                          headers=H(tokens, "sales"),
                          json={"current_password": "Welcome@123", "new_password": "a1"})
        assert r.status_code == 400

    def test_change_password_success_then_revert(self, tokens):
        # Change and revert to keep credentials stable
        r = requests.post(f"{API}/auth/change-password",
                          headers=H(tokens, "sales2"),
                          json={"current_password": "Welcome@123", "new_password": "TempPass9"})
        assert r.status_code == 200
        # login with new
        tok2, _ = _login("paviter.dahiya", "TempPass9")
        # revert
        r2 = requests.post(f"{API}/auth/change-password",
                           headers={"Authorization": f"Bearer {tok2}"},
                           json={"current_password": "TempPass9", "new_password": "Welcome@123"})
        assert r2.status_code == 200


# ---------------- SETTINGS ----------------
class TestSettings:
    def test_get_settings(self, tokens):
        r = requests.get(f"{API}/settings", headers=H(tokens, "sales"))
        assert r.status_code == 200
        s = r.json()
        for k in ["office_lat", "office_lng", "office_radius_m", "office_start", "office_end"]:
            assert k in s

    def test_admin_can_update_settings(self, tokens):
        # Updated: admin now has equal power to superadmin
        r = requests.put(f"{API}/settings", headers=H(tokens, "admin"),
                         json={"office_radius_m": 500})
        assert r.status_code == 200, r.text

    def test_super_can_update_settings(self, tokens):
        # Get current then set
        cur = requests.get(f"{API}/settings", headers=H(tokens, "super")).json()
        r = requests.put(f"{API}/settings", headers=H(tokens, "super"),
                         json={"office_radius_m": 500, "office_lat": OFFICE_LAT,
                               "office_lng": OFFICE_LNG, "office_start": "11:00",
                               "office_end": "18:00"})
        assert r.status_code == 200
        s = r.json()
        assert s["office_radius_m"] == 500
        assert abs(s["office_lat"] - OFFICE_LAT) < 1e-6


# ---------------- ATTENDANCE ----------------
class TestAttendance:
    def test_check_in_outside(self, tokens):
        r = requests.post(f"{API}/attendance/check-in", headers=H(tokens, "sales2"),
                          json={"lat": FAR_LAT, "lng": FAR_LNG})
        assert r.status_code == 403
        assert "Outside office radius" in r.json().get("detail", "")

    def test_check_in_inside_and_idempotent(self, tokens):
        r = requests.post(f"{API}/attendance/check-in", headers=H(tokens, "sales"),
                          json={"lat": OFFICE_LAT, "lng": OFFICE_LNG})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["ok"] is True
        assert "distance_m" in d
        assert d["distance_m"] < 50
        # idempotent
        r2 = requests.post(f"{API}/attendance/check-in", headers=H(tokens, "sales"),
                           json={"lat": OFFICE_LAT, "lng": OFFICE_LNG})
        assert r2.status_code == 200
        assert r2.json().get("already") is True

    def test_check_out(self, tokens):
        # Ensure check in first
        requests.post(f"{API}/attendance/check-in", headers=H(tokens, "sales"),
                      json={"lat": OFFICE_LAT, "lng": OFFICE_LNG})
        r = requests.post(f"{API}/attendance/check-out", headers=H(tokens, "sales"),
                          json={"lat": OFFICE_LAT, "lng": OFFICE_LNG})
        assert r.status_code == 200, r.text
        d = r.json()
        assert "worked_seconds" in d and "overtime_seconds" in d

    def test_attendance_me(self, tokens):
        r = requests.get(f"{API}/attendance/me", headers=H(tokens, "sales"))
        assert r.status_code == 200
        d = r.json()
        assert "records" in d and "settings" in d

    def test_attendance_today_admin_excludes_exempt(self, tokens):
        r = requests.get(f"{API}/attendance/today", headers=H(tokens, "admin"))
        assert r.status_code == 200
        rows = r.json()["rows"]
        # Post-fix: filter is now attendance_exempt (not role). Sandeep is exempt admin, must be absent.
        for row in rows:
            assert row.get("username") != "sandeep.chauhan", f"exempt user leaked: {row}"
            assert "wfh" in row and isinstance(row["wfh"], bool)

    def test_attendance_today_sales_forbidden(self, tokens):
        r = requests.get(f"{API}/attendance/today", headers=H(tokens, "sales"))
        assert r.status_code == 403

    def test_stats_week_and_month(self, tokens):
        for period in ("week", "month"):
            r = requests.get(f"{API}/attendance/stats?period={period}", headers=H(tokens, "admin"))
            assert r.status_code == 200, r.text
            d = r.json()
            for k in ["per_user", "top_overtime", "top_absent", "top_late", "working_days"]:
                assert k in d

    def test_super_can_edit_attendance(self, tokens):
        # get a today row for sales
        rows = requests.get(f"{API}/attendance/today", headers=H(tokens, "super")).json()["rows"]
        row = next((r for r in rows if r["username"] == "kashish.aggarwal" and r["attendance_id"]), None)
        assert row is not None, "expected sales attendance row today"
        aid = row["attendance_id"]
        # admin now has equal power - can edit
        r_admin = requests.put(f"{API}/attendance/{aid}", headers=H(tokens, "admin"),
                               json={"note": "hi admin"})
        assert r_admin.status_code == 200, r_admin.text
        # super can
        r = requests.put(f"{API}/attendance/{aid}", headers=H(tokens, "super"),
                         json={"status": "present", "note": "test edit"})
        assert r.status_code == 200, r.text

    def test_mark_manual(self, tokens):
        # find some sales user id
        users = requests.get(f"{API}/users", headers=H(tokens, "super")).json()
        sales = next((u for u in users if u["username"] == "paviter.dahiya"), None)
        assert sales
        yesterday = (datetime.utcnow().date() - timedelta(days=1)).isoformat()
        data = {"user_id": sales["id"], "date_str": yesterday,
                "status": "present", "note": "TEST manual"}
        r = requests.post(f"{API}/attendance/mark-manual", headers=H(tokens, "super"), data=data)
        assert r.status_code == 200, r.text
        assert r.json()["ok"] is True
        # admin now equal to super - allowed
        r2 = requests.post(f"{API}/attendance/mark-manual", headers=H(tokens, "admin"), data=data)
        assert r2.status_code == 200, r2.text


# ---------------- USERS & ROLES ----------------
class TestUsersRoles:
    def _new_username(self):
        return f"test_{uuid.uuid4().hex[:8]}"

    def test_admin_can_create_tl_sales(self, tokens):
        for role in ["team_lead", "sales", "employee", "hr"]:
            u = self._new_username()
            r = requests.post(f"{API}/users", headers=H(tokens, "admin"),
                              json={"username": u, "name": f"TEST {u}", "role": role})
            assert r.status_code == 200, f"{role}: {r.text}"
            # cleanup
            uid = r.json()["id"]
            requests.delete(f"{API}/users/{uid}", headers=H(tokens, "super"))

    def test_admin_can_create_admin_or_super(self, tokens):
        # Bug fix: admin & superadmin are equal Administrators; both can create admin/superadmin
        for role in ["admin", "superadmin"]:
            u = self._new_username()
            r = requests.post(f"{API}/users", headers=H(tokens, "admin"),
                              json={"username": u, "name": "TEST X", "role": role})
            assert r.status_code == 200, f"{role} expected 200 got {r.status_code} {r.text}"
            uid = r.json()["id"]
            requests.delete(f"{API}/users/{uid}", headers=H(tokens, "super"))

    def test_tl_can_only_create_sales(self, tokens):
        # TL create sales -> success
        u = self._new_username()
        r = requests.post(f"{API}/users", headers=H(tokens, "tl"),
                          json={"username": u, "name": "TEST sales", "role": "sales"})
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        # cleanup
        requests.delete(f"{API}/users/{uid}", headers=H(tokens, "super"))
        # TL create team_lead -> 403
        r2 = requests.post(f"{API}/users", headers=H(tokens, "tl"),
                           json={"username": self._new_username(), "name": "X", "role": "team_lead"})
        assert r2.status_code == 403

    def test_super_can_create_admin(self, tokens):
        u = self._new_username()
        r = requests.post(f"{API}/users", headers=H(tokens, "super"),
                          json={"username": u, "name": "TEST admin", "role": "admin"})
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        requests.delete(f"{API}/users/{uid}", headers=H(tokens, "super"))

    def test_admin_can_edit_super(self, tokens):
        # Bug fix: admin and superadmin are equal; admin can edit super's phone
        super_id = tokens["super"]["user"]["id"]
        r = requests.put(f"{API}/users/{super_id}", headers=H(tokens, "admin"),
                         json={"phone": "+919999999999"})
        assert r.status_code == 200, r.text

    def test_tl_sees_only_own_team(self, tokens):
        r = requests.get(f"{API}/users", headers=H(tokens, "tl"))
        assert r.status_code == 200
        users = r.json()
        usernames = {u["username"] for u in users}
        assert "abhishek.janghu" in usernames
        assert "kashish.aggarwal" in usernames
        assert "paviter.dahiya" in usernames
        # should NOT contain other TLs or admin
        assert "manish.singh" not in usernames
        assert "sandeep.chauhan" not in usernames


# ---------------- LEADS ----------------
class TestLeads:
    @pytest.fixture(scope="class")
    def created_lead(self, tokens):
        # create lead as super and assign to kashish
        users = requests.get(f"{API}/users", headers=H(tokens, "super")).json()
        kashish = next(u for u in users if u["username"] == "kashish.aggarwal")
        payload = {"name": "TEST Lead Alpha", "phone": "9999900001",
                   "assigned_to": kashish["id"], "tag": "warm"}
        r = requests.post(f"{API}/leads", headers=H(tokens, "super"), json=payload)
        assert r.status_code == 200, r.text
        return r.json()

    def test_sales_sees_own_leads(self, tokens, created_lead):
        r = requests.get(f"{API}/leads", headers=H(tokens, "sales"))
        assert r.status_code == 200
        leads = r.json()
        for l in leads:
            assert l.get("assigned_to") == tokens["sales"]["user"]["id"]

    def test_tl_sees_team_leads(self, tokens, created_lead):
        r = requests.get(f"{API}/leads", headers=H(tokens, "tl"))
        assert r.status_code == 200
        leads = r.json()
        # includes team member's lead
        assert any(l["id"] == created_lead["id"] for l in leads)

    def test_admin_sees_all(self, tokens, created_lead):
        r = requests.get(f"{API}/leads", headers=H(tokens, "admin"))
        assert r.status_code == 200
        ids = [l["id"] for l in r.json()]
        assert created_lead["id"] in ids

    def test_update_tag(self, tokens, created_lead):
        r = requests.put(f"{API}/leads/{created_lead['id']}", headers=H(tokens, "super"),
                         json={"tag": "hot"})
        assert r.status_code == 200
        assert r.json()["tag"] == "hot"
        # filter by tag=hot
        r2 = requests.get(f"{API}/leads?tag=hot", headers=H(tokens, "super"))
        assert r2.status_code == 200
        assert any(l["id"] == created_lead["id"] for l in r2.json())

    def test_follow_up_status_filter(self, tokens, created_lead):
        requests.put(f"{API}/leads/{created_lead['id']}", headers=H(tokens, "super"),
                     json={"follow_up_status": "interested"})
        r = requests.get(f"{API}/leads?follow_up_status=interested", headers=H(tokens, "super"))
        assert r.status_code == 200
        assert any(l["id"] == created_lead["id"] for l in r.json())

    def test_follow_up_date_range_filter(self, tokens, created_lead):
        fut = (datetime.now(timezone.utc) + timedelta(days=2)).isoformat()
        requests.put(f"{API}/leads/{created_lead['id']}", headers=H(tokens, "super"),
                     json={"follow_up_at": fut})
        f_from = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        f_to = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
        r = requests.get(f"{API}/leads?follow_up_from={f_from}&follow_up_to={f_to}",
                         headers=H(tokens, "super"))
        assert r.status_code == 200
        assert any(l["id"] == created_lead["id"] for l in r.json())

    def test_csv_import_defaults(self, tokens):
        p1 = f"98{uuid.uuid4().int % 100000000:08d}"
        p2 = f"98{uuid.uuid4().int % 100000000:08d}"
        csv_text = f"name,phone,email\nTEST Beta,{p1},b@x.com\nTEST Gamma,{p2},g@x.com\n"
        files = {"file": ("leads.csv", csv_text, "text/csv")}
        data = {"default_tag": "hot", "default_remark": "Q4 campaign"}
        r = requests.post(f"{API}/leads/import", headers=H(tokens, "admin"), files=files, data=data)
        assert r.status_code == 200, r.text
        assert r.json()["inserted"] == 2
        # verify tags applied
        r2 = requests.get(f"{API}/leads?tag=hot&search=TEST Beta", headers=H(tokens, "super"))
        assert r2.status_code == 200
        leads = r2.json()
        assert any(l["remark"] == "Q4 campaign" and l["tag"] == "hot" for l in leads)

    def test_tl_assign_own_team(self, tokens, created_lead):
        users = requests.get(f"{API}/users", headers=H(tokens, "tl")).json()
        paviter = next(u for u in users if u["username"] == "paviter.dahiya")
        r = requests.post(f"{API}/leads/assign", headers=H(tokens, "tl"),
                          json={"lead_ids": [created_lead["id"]], "agent_id": paviter["id"]})
        assert r.status_code == 200, r.text

    def test_tl_cannot_assign_outside_team(self, tokens, created_lead):
        # find a sales user under a different TL
        all_users = requests.get(f"{API}/users", headers=H(tokens, "super")).json()
        tl_id = tokens["tl"]["user"]["id"]
        other = next((u for u in all_users
                      if u["role"] == "sales" and u.get("team_lead_id") and u.get("team_lead_id") != tl_id), None)
        if not other:
            # create one under manish
            manish = next(u for u in all_users if u["username"] == "manish.singh")
            u = f"test_{uuid.uuid4().hex[:6]}"
            r_new = requests.post(f"{API}/users", headers=H(tokens, "super"),
                                  json={"username": u, "name": "TEST outsider",
                                        "role": "sales", "team_lead_id": manish["id"]})
            assert r_new.status_code == 200, r_new.text
            other = r_new.json()
        r = requests.post(f"{API}/leads/assign", headers=H(tokens, "tl"),
                          json={"lead_ids": [created_lead["id"]], "agent_id": other["id"]})
        assert r.status_code == 403


# ---------------- GROUPS & ALERTS ----------------
class TestGroupsAlerts:
    def test_all_hands_group_visible(self, tokens):
        r = requests.get(f"{API}/groups", headers=H(tokens, "sales"))
        assert r.status_code == 200
        groups = r.json()
        assert any(g.get("name", "").lower().find("all") >= 0 or "hand" in g.get("name", "").lower()
                   for g in groups), f"No 'All Hands' group found for sales: {[g.get('name') for g in groups]}"

    def test_group_flow_and_permissions(self, tokens):
        # create group with tl and sales
        tl_id = tokens["tl"]["user"]["id"]
        sales_id = tokens["sales"]["user"]["id"]
        r = requests.post(f"{API}/groups", headers=H(tokens, "tl"),
                          json={"name": f"TEST-{uuid.uuid4().hex[:6]}", "member_ids": [sales_id]})
        assert r.status_code == 200, r.text
        gid = r.json()["_id"]
        # post message as tl
        r2 = requests.post(f"{API}/groups/{gid}/messages", headers=H(tokens, "tl"),
                           json={"text": "hello team"})
        assert r2.status_code == 200
        # sales2 (paviter, not a member) cannot read/post
        r3 = requests.get(f"{API}/groups/{gid}/messages", headers=H(tokens, "sales2"))
        assert r3.status_code == 403
        r4 = requests.post(f"{API}/groups/{gid}/messages", headers=H(tokens, "sales2"),
                           json={"text": "sneak"})
        assert r4.status_code == 403
        # member reads
        r5 = requests.get(f"{API}/groups/{gid}/messages", headers=H(tokens, "sales"))
        assert r5.status_code == 200
        assert any(m["text"] == "hello team" for m in r5.json())

    def test_alerts_broadcast(self, tokens):
        r = requests.post(f"{API}/alerts", headers=H(tokens, "admin"),
                          json={"message": "TEST broadcast", "target": "all", "priority": "high"})
        assert r.status_code == 200
        r2 = requests.get(f"{API}/alerts", headers=H(tokens, "sales"))
        assert r2.status_code == 200
        assert any(a["message"] == "TEST broadcast" for a in r2.json())

    def test_alerts_role_targeted(self, tokens):
        r = requests.post(f"{API}/alerts", headers=H(tokens, "super"),
                          json={"message": "TEST TL only", "target": "team_lead"})
        assert r.status_code == 200
        r_tl = requests.get(f"{API}/alerts", headers=H(tokens, "tl")).json()
        assert any(a["message"] == "TEST TL only" for a in r_tl)
        r_sales = requests.get(f"{API}/alerts", headers=H(tokens, "sales")).json()
        assert not any(a["message"] == "TEST TL only" for a in r_sales)


# ---------------- DASHBOARDS & LEGACY ----------------
class TestDashboards:
    def test_admin_dashboard_full_for_super_admin(self, tokens):
        for k in ["super", "admin"]:
            r = requests.get(f"{API}/dashboard/admin", headers=H(tokens, k))
            assert r.status_code == 200, r.text
            assert r.json()["scope"] == "full"

    def test_admin_dashboard_team_for_tl(self, tokens):
        r = requests.get(f"{API}/dashboard/admin", headers=H(tokens, "tl"))
        assert r.status_code == 200
        d = r.json()
        assert d["scope"] == "team"
        # leaderboard should only contain team members (or self)
        tl_id = tokens["tl"]["user"]["id"]
        for row in d.get("leaderboard", []):
            # they should either be self or have this TL as team_lead
            assert row.get("agent_id") == tl_id or row.get("team_lead_name") == tokens["tl"]["user"]["name"]

    def test_legacy_endpoints(self, tokens):
        for path in ["/leads", "/followups", "/calls", "/dashboard/admin", "/reports/daily"]:
            r = requests.get(f"{API}{path}", headers=H(tokens, "super"))
            assert r.status_code == 200, f"{path}: {r.status_code} {r.text[:200]}"

    def test_followups_filter(self, tokens):
        # follow_up_status filter
        r = requests.get(f"{API}/followups?follow_up_status=interested",
                         headers=H(tokens, "super"))
        assert r.status_code == 200
        # date_from / date_to filter (per current code)
        f_from = (datetime.now(timezone.utc) - timedelta(days=30)).isoformat()
        f_to = (datetime.now(timezone.utc) + timedelta(days=30)).isoformat()
        r2 = requests.get(f"{API}/followups?date_from={f_from}&date_to={f_to}",
                          headers=H(tokens, "super"))
        assert r2.status_code == 200

    def test_source_download_zip(self, tokens):
        # try admin+; if endpoint exists
        r = requests.get(f"{API}/source/download", headers=H(tokens, "admin"))
        if r.status_code == 404:
            pytest.skip("source/download not implemented")
        assert r.status_code == 200, r.text
        ctype = r.headers.get("content-type", "")
        assert "zip" in ctype.lower(), f"Expected zip content-type, got {ctype}"
