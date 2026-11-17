"""Backend tests for Inkwell Notes API (auth, notes, tags, people, locations)."""
import uuid
import pytest
import requests

from conftest import API, make_session


# ---------------- Auth ----------------
class TestAuth:
    def test_health(self):
        r = requests.get(f"{API}/")
        assert r.status_code == 200
        assert r.json().get("ok") is True

    def test_me_with_session(self):
        email = f"test_{uuid.uuid4().hex[:8]}@inkwell.test"
        s = make_session(email)
        rm = s.get(f"{API}/auth/me")
        assert rm.status_code == 200
        assert rm.json()["email"] == email

    def test_logout_invalidates_session(self):
        s = make_session(f"test_{uuid.uuid4().hex[:8]}@inkwell.test")
        token = s.cookies.get("inkwell_session")
        assert s.post(f"{API}/auth/logout").status_code == 200
        r = requests.get(f"{API}/auth/me", cookies={"inkwell_session": token})
        assert r.status_code == 401

    def test_password_endpoints_removed(self):
        r = requests.post(f"{API}/auth/login", json={"email": "a@b.c", "password": "x" * 8})
        assert r.status_code in (404, 405)
        r = requests.post(f"{API}/auth/register", json={"email": "a@b.c", "password": "x" * 8})
        assert r.status_code in (404, 405)

    def test_google_login_redirects_to_google(self):
        r = requests.get(f"{API}/auth/google/login", allow_redirects=False)
        if r.status_code == 500:
            pytest.skip("Google OAuth not configured on this server")
        assert r.status_code == 302
        assert r.headers["location"].startswith("https://accounts.google.com/")
        assert "inkwell_oauth_state" in r.cookies

    def test_callback_rejects_bad_state(self):
        r = requests.get(f"{API}/auth/google/callback", params={"code": "x", "state": "bogus"}, allow_redirects=False)
        assert r.status_code == 302
        assert "auth_error=invalid_state" in r.headers["location"]

    def test_unauthorized_returns_401(self):
        r = requests.get(f"{API}/notes")
        assert r.status_code == 401

    def test_calendar_not_connected(self, user_session):
        r = user_session.get(f"{API}/google/calendar/status")
        assert r.status_code == 200
        assert r.json()["connected"] is False
        r = user_session.get(f"{API}/google/calendar/events",
                             params={"time_min": "2026-01-01T00:00:00Z", "time_max": "2026-01-02T00:00:00Z"})
        assert r.status_code == 409


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
    def test_user_a_cannot_see_user_b_notes(self, user_session, admin_session):
        ra = admin_session.post(f"{API}/notes", json={"content": "other private #otheronly"})
        assert ra.status_code == 200
        other_note_id = ra.json()["note_id"]

        rb = user_session.get(f"{API}/notes/{other_note_id}")
        assert rb.status_code == 404
        notes = user_session.get(f"{API}/notes").json()
        assert all(n["note_id"] != other_note_id for n in notes)
