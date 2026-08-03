"""
Bug-fix pass tests for Unique Prime Reality CRM:
- Admin (Sandeep) == Superadmin (Vranda) in power (Administrator equivalence)
- Sandeep attendance_exempt (no attendance required)
- Vranda wfh (GPS bypass on check-in)
- CSV import duplicate detector
- Alerts with duration_hours/expires_at
- /auth/profile, /auth/avatar, /avatars/{filename}
- joining_date field on users
"""
import io
import os
import time
import uuid
import base64
import pytest
import requests
from datetime import datetime, timezone, timedelta

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
                break
API = f"{BASE_URL}/api"

OFFICE_LAT, OFFICE_LNG = 28.4595, 77.0266
FAR_LAT, FAR_LNG = 19.0760, 72.8777  # Mumbai

CREDS = {
    "super": ("vranda.aggarwal", "Vranda@123"),
    "admin": ("sandeep.chauhan", "Sandeep@123"),
    "tl": ("abhishek.janghu", "Welcome@123"),
    "sales": ("kashish.aggarwal", "Welcome@123"),
}


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=15)
    assert r.status_code == 200, f"login failed for {u}: {r.status_code} {r.text}"
    d = r.json()
    return d["access_token"], d["user"]


@pytest.fixture(scope="module")
def tokens():
    out = {}
    for k, (u, p) in CREDS.items():
        tok, user = _login(u, p)
        out[k] = {"token": tok, "user": user, "headers": {"Authorization": f"Bearer {tok}"}}
    return out


def H(tokens, k):
    return tokens[k]["headers"]


# ---------------- Admin == Super equivalence ----------------
class TestAdminSuperEquivalence:
    def test_admin_can_edit_super_phone(self, tokens):
        super_id = tokens["super"]["user"]["id"]
        r = requests.put(f"{API}/users/{super_id}", headers=H(tokens, "admin"),
                         json={"phone": "+919999900001"})
        assert r.status_code == 200, r.text
        assert r.json().get("phone") == "+919999900001"

    def test_super_can_edit_admin_phone(self, tokens):
        admin_id = tokens["admin"]["user"]["id"]
        r = requests.put(f"{API}/users/{admin_id}", headers=H(tokens, "super"),
                         json={"phone": "+919999900002"})
        assert r.status_code == 200, r.text
        assert r.json().get("phone") == "+919999900002"

    def test_admin_can_update_settings(self, tokens):
        r = requests.put(f"{API}/settings", headers=H(tokens, "admin"),
                         json={"office_lat": OFFICE_LAT, "office_lng": OFFICE_LNG,
                               "office_radius_m": 500, "office_start": "11:00",
                               "office_end": "18:00"})
        assert r.status_code == 200, r.text
        assert abs(r.json()["office_lat"] - OFFICE_LAT) < 1e-6

    def test_admin_can_create_admin_role(self, tokens):
        u = f"test_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/users", headers=H(tokens, "admin"),
                          json={"username": u, "name": "TEST admin2", "role": "admin"})
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        requests.delete(f"{API}/users/{uid}", headers=H(tokens, "super"))

    def test_admin_can_create_superadmin_role(self, tokens):
        u = f"test_{uuid.uuid4().hex[:8]}"
        r = requests.post(f"{API}/users", headers=H(tokens, "admin"),
                          json={"username": u, "name": "TEST super2", "role": "superadmin"})
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        requests.delete(f"{API}/users/{uid}", headers=H(tokens, "super"))

    def test_tl_still_cannot_create_admin(self, tokens):
        for role in ["admin", "superadmin", "team_lead"]:
            u = f"test_{uuid.uuid4().hex[:6]}"
            r = requests.post(f"{API}/users", headers=H(tokens, "tl"),
                              json={"username": u, "name": "X", "role": role})
            assert r.status_code == 403, f"tl create {role} expected 403 got {r.status_code}"


# ---------------- Attendance exemption / WFH bypass ----------------
class TestAttendanceExemption:
    def test_sandeep_check_in_forbidden(self, tokens):
        r = requests.post(f"{API}/attendance/check-in", headers=H(tokens, "admin"),
                          json={"lat": OFFICE_LAT, "lng": OFFICE_LNG})
        assert r.status_code == 400, r.text
        detail = (r.json().get("detail") or "").lower()
        assert "does not require attendance" in detail or "exempt" in detail, \
            f"unexpected detail: {r.json()}"

    def test_vranda_wfh_bypass_gps(self, tokens):
        # Vranda has wfh=true, so far-from-office coordinates must still succeed
        r = requests.post(f"{API}/attendance/check-in", headers=H(tokens, "super"),
                          json={"lat": FAR_LAT, "lng": FAR_LNG})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("ok") is True or d.get("already") is True

    def test_today_excludes_sandeep_includes_vranda(self, tokens):
        r = requests.get(f"{API}/attendance/today", headers=H(tokens, "admin"))
        assert r.status_code == 200, r.text
        rows = r.json().get("rows", [])
        usernames = {row.get("username") for row in rows}
        assert "sandeep.chauhan" not in usernames, "attendance_exempt user should be excluded"
        # Vranda is wfh but NOT attendance_exempt; she must appear
        assert "vranda.aggarwal" in usernames, \
            f"wfh user (Vranda) should still appear in today rows; got: {usernames}"
        # Every row must contain a boolean wfh field
        for row in rows:
            assert "wfh" in row and isinstance(row["wfh"], bool), f"row missing bool wfh: {row}"
        vranda_row = next(r for r in rows if r.get("username") == "vranda.aggarwal")
        assert vranda_row["wfh"] is True, f"Vranda row wfh should be True: {vranda_row}"

    def test_stats_excludes_admin_and_exempt(self, tokens):
        r = requests.get(f"{API}/attendance/stats?period=week", headers=H(tokens, "admin"))
        assert r.status_code == 200, r.text
        d = r.json()
        assert "per_user" in d
        for row in d["per_user"]:
            # Sandeep must NOT appear (admin + exempt)
            assert row.get("username") != "sandeep.chauhan", \
                f"exempt user leaked into stats: {row}"


# ---------------- User model / seed data ----------------
class TestUserFields:
    def test_users_list_has_new_fields(self, tokens):
        r = requests.get(f"{API}/users", headers=H(tokens, "super"))
        assert r.status_code == 200
        users = r.json()
        assert users, "users empty"
        u = users[0]
        for k in ("joining_date", "wfh", "attendance_exempt", "avatar_url"):
            assert k in u, f"missing {k} in user response: {list(u.keys())}"

    def test_sandeep_exempt_and_vranda_wfh(self, tokens):
        users = requests.get(f"{API}/users", headers=H(tokens, "super")).json()
        sandeep = next((u for u in users if u["username"] == "sandeep.chauhan"), None)
        vranda = next((u for u in users if u["username"] == "vranda.aggarwal"), None)
        assert sandeep and vranda
        assert sandeep.get("attendance_exempt") is True, f"Sandeep not exempt: {sandeep}"
        assert vranda.get("wfh") is True, f"Vranda not wfh: {vranda}"

    def test_joining_date_populated(self, tokens):
        users = requests.get(f"{API}/users", headers=H(tokens, "super")).json()
        sandeep = next(u for u in users if u["username"] == "sandeep.chauhan")
        vranda = next(u for u in users if u["username"] == "vranda.aggarwal")
        assert sandeep.get("joining_date"), f"sandeep joining_date empty: {sandeep}"
        assert vranda.get("joining_date"), f"vranda joining_date empty: {vranda}"


# ---------------- Profile & avatar ----------------
# 1x1 transparent PNG bytes
_TINY_PNG = base64.b64decode(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII="
)


class TestProfileAvatar:
    def test_update_own_profile(self, tokens):
        # login fresh as sales to avoid mutating shared user
        tok, _ = _login("kashish.aggarwal", "Welcome@123")
        headers = {"Authorization": f"Bearer {tok}"}
        new_phone = f"+9198{uuid.uuid4().int % 100000000:08d}"
        r = requests.put(f"{API}/auth/profile", headers=headers,
                         json={"phone": new_phone, "email": "kashish.test@example.com"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("phone") == new_phone
        assert d.get("email") == "kashish.test@example.com"

    def test_update_own_name_propagates_to_leads(self, tokens):
        # create a lead assigned to kashish
        users = requests.get(f"{API}/users", headers=H(tokens, "super")).json()
        kashish = next(u for u in users if u["username"] == "kashish.aggarwal")
        original_name = kashish["name"]
        lead_payload = {"name": "TEST propagate", "phone": f"98000{uuid.uuid4().int % 100000:05d}",
                        "assigned_to": kashish["id"]}
        lr = requests.post(f"{API}/leads", headers=H(tokens, "super"), json=lead_payload)
        assert lr.status_code == 200, lr.text
        lead_id = lr.json()["id"]
        try:
            tok, _ = _login("kashish.aggarwal", "Welcome@123")
            new_name = f"Kashish TEST {uuid.uuid4().hex[:4]}"
            r = requests.put(f"{API}/auth/profile", headers={"Authorization": f"Bearer {tok}"},
                             json={"name": new_name})
            assert r.status_code == 200, r.text
            # verify the lead assigned_to_name updated
            time.sleep(0.3)
            got = requests.get(f"{API}/leads?search=TEST propagate", headers=H(tokens, "super")).json()
            match = next((l for l in got if l["id"] == lead_id), None)
            assert match, "lead not found after propagate"
            assert match["assigned_to_name"] == new_name, f"assigned_to_name not propagated: {match}"
        finally:
            # cleanup: revert name and delete lead
            requests.put(f"{API}/auth/profile", headers={"Authorization": f"Bearer {tok}"},
                         json={"name": original_name})
            requests.delete(f"{API}/leads/{lead_id}", headers=H(tokens, "super"))

    def test_avatar_upload_png_and_serve(self, tokens):
        files = {"file": ("avatar.png", _TINY_PNG, "image/png")}
        r = requests.post(f"{API}/auth/avatar", headers=H(tokens, "sales"), files=files)
        assert r.status_code == 200, r.text
        d = r.json()
        assert "avatar_url" in d
        url = d["avatar_url"]
        assert url.startswith("/api/avatars/")
        # verify user record now has avatar_url
        me = requests.get(f"{API}/auth/me", headers=H(tokens, "sales")).json()
        assert me.get("avatar_url") == url
        # fetch the served image
        fname = url.rsplit("/", 1)[-1]
        r2 = requests.get(f"{API}/avatars/{fname}")
        assert r2.status_code == 200
        assert r2.headers.get("content-type", "").startswith("image/png")
        assert r2.content == _TINY_PNG

    def test_avatar_rejects_text_file(self, tokens):
        files = {"file": ("hack.txt", b"not an image", "text/plain")}
        r = requests.post(f"{API}/auth/avatar", headers=H(tokens, "sales"), files=files)
        assert r.status_code == 400, r.text
        assert "unsupported" in (r.json().get("detail") or "").lower()


# ---------------- CSV import duplicates ----------------
class TestCsvDuplicates:
    def _unique_phone(self):
        return f"98{uuid.uuid4().int % 100000000:08d}"

    def test_duplicate_detected_and_skipped(self, tokens):
        # First insert one lead we can duplicate
        seed_phone = self._unique_phone()
        r0 = requests.post(f"{API}/leads", headers=H(tokens, "super"),
                           json={"name": "TEST Seed Dup", "phone": seed_phone})
        assert r0.status_code == 200, r0.text
        csv_text = f"name,phone,email\nTEST Dup1,{seed_phone},a@x.com\nTEST Fresh,{self._unique_phone()},b@x.com\n"
        files = {"file": ("dup.csv", csv_text, "text/csv")}
        r = requests.post(f"{API}/leads/import", headers=H(tokens, "admin"), files=files,
                          data={"skip_duplicates": "true"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inserted"] == 1
        assert d["skipped"] == 1
        assert d["total_duplicates"] >= 1
        assert isinstance(d["duplicates"], list) and len(d["duplicates"]) >= 1
        dup = d["duplicates"][0]
        for k in ("name", "phone", "existing_name"):
            assert k in dup, f"missing {k} in duplicate entry: {dup}"

    def test_duplicate_not_skipped_when_false(self, tokens):
        seed_phone = self._unique_phone()
        r0 = requests.post(f"{API}/leads", headers=H(tokens, "super"),
                           json={"name": "TEST Seed NoSkip", "phone": seed_phone})
        assert r0.status_code == 200
        csv_text = f"name,phone\nTEST DupInsert,{seed_phone}\n"
        files = {"file": ("d.csv", csv_text, "text/csv")}
        r = requests.post(f"{API}/leads/import", headers=H(tokens, "admin"), files=files,
                          data={"skip_duplicates": "false"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["inserted"] == 1
        assert d["skipped"] == 0
        assert d["total_duplicates"] >= 1

    def test_missing_name_or_phone_counted(self, tokens):
        csv_text = "name,phone\n,9800012345\nOnlyName,\n"
        files = {"file": ("m.csv", csv_text, "text/csv")}
        r = requests.post(f"{API}/leads/import", headers=H(tokens, "admin"), files=files)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["missing"] == 2
        assert d["total_duplicates"] == 0
        assert d["inserted"] == 0

    def test_basic_import_still_works(self, tokens):
        csv_text = f"name,phone\nTEST Reg1,{self._unique_phone()}\nTEST Reg2,{self._unique_phone()}\n"
        files = {"file": ("r.csv", csv_text, "text/csv")}
        r = requests.post(f"{API}/leads/import", headers=H(tokens, "admin"), files=files)
        assert r.status_code == 200, r.text
        assert r.json()["inserted"] == 2


# ---------------- Alerts with expiry ----------------
class TestAlertsExpiry:
    def test_alert_with_duration_returns_expires_at(self, tokens):
        r = requests.post(f"{API}/alerts", headers=H(tokens, "admin"),
                          json={"message": "TEST expiry 6h", "target": "all",
                                "duration_hours": 6})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("duration_hours") == 6
        assert d.get("expires_at"), f"expires_at missing: {d}"
        # Parse and verify ~6h in future
        exp = datetime.fromisoformat(d["expires_at"].replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        delta = (exp - now).total_seconds()
        assert 5.5 * 3600 <= delta <= 6.5 * 3600, f"expires_at not ~6h: delta={delta}"

    def test_alert_default_24h(self, tokens):
        r = requests.post(f"{API}/alerts", headers=H(tokens, "admin"),
                          json={"message": "TEST expiry default", "target": "all"})
        assert r.status_code == 200, r.text
        d = r.json()
        assert d.get("expires_at")
        exp = datetime.fromisoformat(d["expires_at"].replace("Z", "+00:00"))
        delta = (exp - datetime.now(timezone.utc)).total_seconds()
        assert 23 * 3600 <= delta <= 25 * 3600, f"default not ~24h: {delta}"

    def test_get_alerts_filters_expired(self, tokens):
        # Create a fresh alert with 1h duration and confirm it appears
        r = requests.post(f"{API}/alerts", headers=H(tokens, "admin"),
                          json={"message": "TEST valid short", "target": "all",
                                "duration_hours": 1})
        assert r.status_code == 200
        alerts = requests.get(f"{API}/alerts", headers=H(tokens, "sales")).json()
        assert any(a["message"] == "TEST valid short" for a in alerts)


# ---------------- Regression sanity ----------------
class TestRegression:
    def test_change_password_still_enforces_current(self, tokens):
        tok, _ = _login("kashish.aggarwal", "Welcome@123")
        headers = {"Authorization": f"Bearer {tok}"}
        r = requests.post(f"{API}/auth/change-password", headers=headers,
                          json={"current_password": "WRONG", "new_password": "Newpass1"})
        assert r.status_code == 400

    def test_change_password_min_len(self, tokens):
        tok, _ = _login("kashish.aggarwal", "Welcome@123")
        headers = {"Authorization": f"Bearer {tok}"}
        r = requests.post(f"{API}/auth/change-password", headers=headers,
                          json={"current_password": "Welcome@123", "new_password": "abc"})
        assert r.status_code == 400

    def test_dashboard_admin_full_for_admin(self, tokens):
        r = requests.get(f"{API}/dashboard/admin", headers=H(tokens, "admin"))
        assert r.status_code == 200
        assert r.json()["scope"] == "full"

    def test_leads_list_admin(self, tokens):
        r = requests.get(f"{API}/leads", headers=H(tokens, "admin"))
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_attendance_today_admin(self, tokens):
        r = requests.get(f"{API}/attendance/today", headers=H(tokens, "admin"))
        assert r.status_code == 200
        assert "rows" in r.json()
