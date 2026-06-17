"""Backend tests for Inkwell Notes API (auth, notes, tags, people, locations)."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://markdown-memo.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"email": "admin@inkwell.app", "password": "admin12345"}
TEST_USER = {"email": "test@inkwell.app", "password": "test12345"}


def _new_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(session, creds):
    r = session.post(f"{API}/auth/login", json=creds)
    return r


@pytest.fixture(scope="module")
def admin_session():
    s = _new_session()
    r = _login(s, ADMIN)
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    assert "access_token" in s.cookies
    return s


@pytest.fixture(scope="module")
def user_session():
    s = _new_session()
    r = _login(s, TEST_USER)
    if r.status_code != 200:
        rr = s.post(f"{API}/auth/register", json={**TEST_USER, "name": "Test"})
        assert rr.status_code in (200, 400)
        r = _login(s, TEST_USER)
    assert r.status_code == 200, f"Test user login failed: {r.text}"
    return s


# ---------------- Auth ----------------
class TestAuth:
    def test_health(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_register_creates_user_and_sets_cookies(self):
        s = _new_session()
        email = f"test_{uuid.uuid4().hex[:8]}@inkwell.app"
        r = s.post(f"{API}/auth/register", json={"email": email, "password": "pass1234", "name": "T"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["email"] == email
        assert "user_id" in data
        assert "access_token" in s.cookies
        assert "refresh_token" in s.cookies
        # me works with cookies
        rm = s.get(f"{API}/auth/me")
        assert rm.status_code == 200
        assert rm.json()["email"] == email
        # logout clears
        rl = s.post(f"{API}/auth/logout")
        assert rl.status_code == 200
        rm2 = requests.get(f"{API}/auth/me")  # no cookies
        assert rm2.status_code == 401

    def test_register_duplicate_returns_400(self):
        s = _new_session()
        r = s.post(f"{API}/auth/register", json={"email": ADMIN["email"], "password": "x" * 8})
        assert r.status_code == 400

    def test_login_admin_and_me(self, admin_session):
        r = admin_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN["email"]

    def test_login_wrong_password(self):
        s = _new_session()
        r = s.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "bad"})
        assert r.status_code == 401

    def test_unauthorized_returns_401(self):
        r = requests.get(f"{API}/notes")
        assert r.status_code == 401


# ---------------- Notes / Tags / People extraction ----------------
class TestNotes:
    created_notes = []

    def test_create_note_extracts_tags_and_people(self, user_session):
        content = "Bugun #tag1 ve #tag2 ile @person1 calistim."
        r = user_session.post(f"{API}/notes", json={"title": "T", "content": content})
        assert r.status_code == 200, r.text
        n = r.json()
        assert "tag1" in n["tags"] and "tag2" in n["tags"]
        assert "person1" in n["people"]
        assert n["date"]  # default today
        TestNotes.created_notes.append(n["note_id"])

        # tags / people collection populated
        rt = user_session.get(f"{API}/tags")
        assert rt.status_code == 200
        names = [t["name"] for t in rt.json()]
        assert "tag1" in names and "tag2" in names
        rp = user_session.get(f"{API}/people")
        assert rp.status_code == 200
        assert "person1" in [p["name"] for p in rp.json()]

    def test_list_notes_filters(self, user_session):
        # create a note for a specific date
        date = "2026-06-15"
        r = user_session.post(f"{API}/notes", json={"content": "spec #filtertag @filterperson", "date": date})
        assert r.status_code == 200
        nid = r.json()["note_id"]
        TestNotes.created_notes.append(nid)

        r1 = user_session.get(f"{API}/notes", params={"date": date})
        assert r1.status_code == 200
        assert any(n["note_id"] == nid for n in r1.json())

        r2 = user_session.get(f"{API}/notes", params={"tag": "filtertag"})
        assert r2.status_code == 200
        assert any(n["note_id"] == nid for n in r2.json())

        r3 = user_session.get(f"{API}/notes", params={"person": "filterperson"})
        assert r3.status_code == 200
        assert any(n["note_id"] == nid for n in r3.json())

    def test_calendar_counts(self, user_session):
        r = user_session.get(f"{API}/notes/calendar", params={"year": 2026, "month": 6})
        assert r.status_code == 200
        data = r.json()
        assert isinstance(data, dict)
        assert data.get("2026-06-15", 0) >= 1

    def test_get_update_delete_note(self, user_session):
        r = user_session.post(f"{API}/notes", json={"content": "init #x"})
        nid = r.json()["note_id"]

        rg = user_session.get(f"{API}/notes/{nid}")
        assert rg.status_code == 200

        ru = user_session.put(f"{API}/notes/{nid}", json={"content": "updated #y @z", "title": "New"})
        assert ru.status_code == 200
        upd = ru.json()
        assert upd["title"] == "New"
        assert "y" in upd["tags"] and "z" in upd["people"]

        rd = user_session.delete(f"{API}/notes/{nid}")
        assert rd.status_code == 200
        assert user_session.get(f"{API}/notes/{nid}").status_code == 404


# ---------------- Rename propagation ----------------
class TestRenames:
    def test_rename_tag_updates_notes(self, user_session):
        # create note
        r = user_session.post(f"{API}/notes", json={"content": "have #renametag here"})
        nid = r.json()["note_id"]
        # find tag id
        tags = user_session.get(f"{API}/tags").json()
        tag = next(t for t in tags if t["name"] == "renametag")
        ru = user_session.put(f"{API}/tags/{tag['tag_id']}", json={"name": "renamedtag"})
        assert ru.status_code == 200
        # verify note content + tags array updated
        note = user_session.get(f"{API}/notes/{nid}").json()
        assert "#renamedtag" in note["content"]
        assert "renamedtag" in note["tags"]
        assert "renametag" not in note["tags"]

    def test_rename_tag_conflict_returns_400(self, user_session):
        user_session.post(f"{API}/notes", json={"content": "#aaa #bbb"})
        tags = user_session.get(f"{API}/tags").json()
        a = next(t for t in tags if t["name"] == "aaa")
        r = user_session.put(f"{API}/tags/{a['tag_id']}", json={"name": "bbb"})
        assert r.status_code == 400

    def test_rename_person_updates_notes(self, user_session):
        r = user_session.post(f"{API}/notes", json={"content": "meet @renameperson"})
        nid = r.json()["note_id"]
        ppl = user_session.get(f"{API}/people").json()
        p = next(x for x in ppl if x["name"] == "renameperson")
        ru = user_session.put(f"{API}/people/{p['person_id']}", json={"name": "renamedperson"})
        assert ru.status_code == 200
        note = user_session.get(f"{API}/notes/{nid}").json()
        assert "@renamedperson" in note["content"]
        assert "renamedperson" in note["people"]


# ---------------- Locations ----------------
class TestLocations:
    def test_location_crud_and_clear_on_delete(self, user_session):
        # create
        r = user_session.post(f"{API}/locations", json={"name": "Office", "lat": 41.0, "lng": 29.0})
        assert r.status_code == 200
        loc = r.json()
        lid = loc["location_id"]

        # list
        rl = user_session.get(f"{API}/locations")
        assert rl.status_code == 200
        assert any(l["location_id"] == lid for l in rl.json())

        # rename
        ru = user_session.put(f"{API}/locations/{lid}", json={"name": "Home"})
        assert ru.status_code == 200
        assert ru.json()["name"] == "Home"

        # attach to note
        rn = user_session.post(f"{API}/notes", json={"content": "at place", "location_id": lid})
        assert rn.status_code == 200
        nid = rn.json()["note_id"]
        assert rn.json()["location_id"] == lid

        # delete location -> note.location_id cleared
        rd = user_session.delete(f"{API}/locations/{lid}")
        assert rd.status_code == 200
        note = user_session.get(f"{API}/notes/{nid}").json()
        assert note["location_id"] in (None, "")


# ---------------- Cross-user isolation ----------------
class TestIsolation:
    def test_user_a_cannot_see_user_b_notes(self):
        # admin creates a note
        sa = _new_session()
        assert _login(sa, ADMIN).status_code == 200
        ra = sa.post(f"{API}/notes", json={"content": "admin private #adminonly"})
        assert ra.status_code == 200
        admin_note_id = ra.json()["note_id"]

        # test user logs in
        sb = _new_session()
        if _login(sb, TEST_USER).status_code != 200:
            sb.post(f"{API}/auth/register", json={**TEST_USER, "name": "T"})
            _login(sb, TEST_USER)
        rb = sb.get(f"{API}/notes/{admin_note_id}")
        assert rb.status_code == 404
        notes = sb.get(f"{API}/notes").json()
        assert all(n["note_id"] != admin_note_id for n in notes)
