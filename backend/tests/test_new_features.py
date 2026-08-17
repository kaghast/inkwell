"""Backend tests for Inkwell new features: reminders, pin, uploads, files, link-preview, geocode."""
import io
import os
import time
import uuid
from datetime import datetime, timedelta, timezone

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


def _login_or_register(session, creds):
    r = session.post(f"{API}/auth/login", json=creds)
    if r.status_code != 200:
        session.post(f"{API}/auth/register", json={**creds, "name": "Test"})
        r = session.post(f"{API}/auth/login", json=creds)
    assert r.status_code == 200, f"login failed: {r.text}"
    return session


@pytest.fixture(scope="module")
def user_session():
    return _login_or_register(_new_session(), TEST_USER)


@pytest.fixture(scope="module")
def admin_session():
    s = _new_session()
    r = s.post(f"{API}/auth/login", json=ADMIN)
    assert r.status_code == 200, r.text
    return s


# tiny 1x1 png
PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489"
    "0000000d49444154789c6360000000020001e221bc330000000049454e44ae426082"
)


# ------------- reminders extraction (POST / PUT / DELETE) -------------
class TestReminders:
    def test_create_note_with_reminder_extracts(self, user_session):
        future = (datetime.now(timezone.utc) + timedelta(days=2)).replace(microsecond=0)
        iso = future.isoformat().replace("+00:00", "Z")
        text = "Toplantiya git"
        content = f"pre text\n\n```reminder\n{iso}\n{text}\n```\n\npost"
        r = user_session.post(f"{API}/notes", json={"title": "R1", "content": content})
        assert r.status_code == 200, r.text
        nid = r.json()["note_id"]

        # verify reminder in upcoming
        ru = user_session.get(f"{API}/reminders/upcoming")
        assert ru.status_code == 200
        items = ru.json()
        matched = [x for x in items if x.get("note_id") == nid]
        assert len(matched) == 1
        rem = matched[0]
        assert rem["text"] == text
        assert rem["fired"] is False
        # 'at' close to future
        got_at = datetime.fromisoformat(rem["at"].replace("Z", "+00:00"))
        assert abs((got_at - future).total_seconds()) < 5

        # cleanup
        user_session.delete(f"{API}/notes/{nid}")

    def test_update_note_replaces_reminders(self, user_session):
        future1 = (datetime.now(timezone.utc) + timedelta(days=1)).replace(microsecond=0)
        future2 = (datetime.now(timezone.utc) + timedelta(days=3)).replace(microsecond=0)
        iso1 = future1.isoformat().replace("+00:00", "Z")
        iso2 = future2.isoformat().replace("+00:00", "Z")

        content1 = f"```reminder\n{iso1}\nfirst\n```"
        r = user_session.post(f"{API}/notes", json={"content": content1})
        assert r.status_code == 200
        nid = r.json()["note_id"]

        # confirm 1 reminder present
        items = user_session.get(f"{API}/reminders/upcoming").json()
        assert sum(1 for x in items if x["note_id"] == nid) == 1

        # Update: two reminders
        content2 = (
            f"```reminder\n{iso1}\nfirst\n```\n\n"
            f"```reminder\n{iso2}\nsecond\n```"
        )
        ru = user_session.put(f"{API}/notes/{nid}", json={"content": content2})
        assert ru.status_code == 200
        items = user_session.get(f"{API}/reminders/upcoming").json()
        mine = [x for x in items if x["note_id"] == nid]
        assert len(mine) == 2
        assert {x["text"] for x in mine} == {"first", "second"}

        # Update: remove all reminders
        ru2 = user_session.put(f"{API}/notes/{nid}", json={"content": "no reminders here"})
        assert ru2.status_code == 200
        items = user_session.get(f"{API}/reminders/upcoming").json()
        assert not any(x["note_id"] == nid for x in items)

        user_session.delete(f"{API}/notes/{nid}")

    def test_delete_note_removes_reminders(self, user_session):
        future = (datetime.now(timezone.utc) + timedelta(days=5)).replace(microsecond=0)
        iso = future.isoformat().replace("+00:00", "Z")
        content = f"```reminder\n{iso}\ndeleteme\n```"
        r = user_session.post(f"{API}/notes", json={"content": content})
        nid = r.json()["note_id"]

        assert any(x["note_id"] == nid for x in user_session.get(f"{API}/reminders/upcoming").json())

        rd = user_session.delete(f"{API}/notes/{nid}")
        assert rd.status_code == 200
        assert not any(x["note_id"] == nid for x in user_session.get(f"{API}/reminders/upcoming").json())

    def test_upcoming_excludes_past_reminders(self, user_session):
        # A reminder in the past should not appear in /upcoming
        past = (datetime.now(timezone.utc) - timedelta(days=1)).replace(microsecond=0)
        iso = past.isoformat().replace("+00:00", "Z")
        content = f"```reminder\n{iso}\npast one\n```"
        r = user_session.post(f"{API}/notes", json={"content": content})
        nid = r.json()["note_id"]

        items = user_session.get(f"{API}/reminders/upcoming").json()
        assert not any(x["note_id"] == nid for x in items)

        user_session.delete(f"{API}/notes/{nid}")

    def test_upcoming_sorted_ascending(self, user_session):
        base = datetime.now(timezone.utc).replace(microsecond=0)
        f1 = (base + timedelta(days=10)).isoformat().replace("+00:00", "Z")
        f2 = (base + timedelta(days=2)).isoformat().replace("+00:00", "Z")
        content = f"```reminder\n{f1}\nlater\n```\n\n```reminder\n{f2}\nsooner\n```"
        r = user_session.post(f"{API}/notes", json={"content": content})
        nid = r.json()["note_id"]

        items = user_session.get(f"{API}/reminders/upcoming").json()
        mine = [x for x in items if x["note_id"] == nid]
        assert len(mine) == 2
        ts = [datetime.fromisoformat(x["at"].replace("Z", "+00:00")) for x in mine]
        assert ts == sorted(ts), f"Not sorted asc: {ts}"

        user_session.delete(f"{API}/notes/{nid}")

    def test_fire_reminder_marks_and_excludes(self, user_session):
        future = (datetime.now(timezone.utc) + timedelta(days=7)).replace(microsecond=0)
        iso = future.isoformat().replace("+00:00", "Z")
        content = f"```reminder\n{iso}\nfire me\n```"
        r = user_session.post(f"{API}/notes", json={"content": content})
        nid = r.json()["note_id"]

        items = user_session.get(f"{API}/reminders/upcoming").json()
        mine = [x for x in items if x["note_id"] == nid]
        assert len(mine) == 1
        rid = mine[0]["reminder_id"]

        rf = user_session.post(f"{API}/reminders/{rid}/fire")
        assert rf.status_code == 200
        assert rf.json().get("ok") is True

        items2 = user_session.get(f"{API}/reminders/upcoming").json()
        assert not any(x.get("reminder_id") == rid for x in items2)

        user_session.delete(f"{API}/notes/{nid}")

    def test_fire_nonexistent_returns_404(self, user_session):
        rf = user_session.post(f"{API}/reminders/rem_doesnotexist/fire")
        assert rf.status_code == 404


# ------------- Pin -------------
class TestPin:
    def test_pin_toggle_and_filter(self, user_session):
        # create two notes
        r1 = user_session.post(f"{API}/notes", json={"content": "note-a #pintest"})
        r2 = user_session.post(f"{API}/notes", json={"content": "note-b #pintest"})
        nid1 = r1.json()["note_id"]
        nid2 = r2.json()["note_id"]

        # default pinned=false
        assert r1.json().get("pinned") is False

        # toggle nid1 -> pinned true
        rp = user_session.patch(f"{API}/notes/{nid1}/pin")
        assert rp.status_code == 200
        assert rp.json()["pinned"] is True
        assert rp.json()["note_id"] == nid1

        # pinned=true only
        pinned_list = user_session.get(f"{API}/notes", params={"pinned": "true"}).json()
        ids_pinned = {n["note_id"] for n in pinned_list}
        assert nid1 in ids_pinned
        assert nid2 not in ids_pinned

        # pinned=false excludes pinned
        unpinned_list = user_session.get(f"{API}/notes", params={"pinned": "false"}).json()
        ids_unpinned = {n["note_id"] for n in unpinned_list}
        assert nid1 not in ids_unpinned
        assert nid2 in ids_unpinned

        # omitted -> returns all (both)
        all_list = user_session.get(f"{API}/notes", params={"tag": "pintest"}).json()
        all_ids = {n["note_id"] for n in all_list}
        assert nid1 in all_ids and nid2 in all_ids

        # toggle back off
        rp2 = user_session.patch(f"{API}/notes/{nid1}/pin")
        assert rp2.status_code == 200
        assert rp2.json()["pinned"] is False

        # cleanup
        user_session.delete(f"{API}/notes/{nid1}")
        user_session.delete(f"{API}/notes/{nid2}")

    def test_pin_nonexistent_note_404(self, user_session):
        r = user_session.patch(f"{API}/notes/note_missing/pin")
        assert r.status_code == 404


# ------------- Uploads / Files -------------
class TestUploads:
    def test_upload_and_download_image(self, user_session):
        files = {"file": ("pixel.png", PNG_1PX, "image/png")}
        # requests.Session default Content-Type is JSON — remove for multipart
        headers = {k: v for k, v in user_session.headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{API}/uploads/image", files=files, headers=headers, cookies=user_session.cookies)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "file_id" in data
        assert data["content_type"] == "image/png"
        assert data["size"] == len(PNG_1PX)
        assert data["url"].startswith("/api/files/")

        # download
        fid = data["file_id"]
        rd = user_session.get(f"{API}/files/{fid}")
        assert rd.status_code == 200
        assert rd.headers.get("content-type", "").startswith("image/png")
        assert rd.content == PNG_1PX

    def test_upload_rejects_non_image(self, user_session):
        files = {"file": ("note.txt", b"hello world", "text/plain")}
        headers = {k: v for k, v in user_session.headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{API}/uploads/image", files=files, headers=headers, cookies=user_session.cookies)
        assert r.status_code == 400

    def test_upload_requires_auth(self):
        files = {"file": ("pixel.png", PNG_1PX, "image/png")}
        r = requests.post(f"{API}/uploads/image", files=files)
        assert r.status_code == 401

    def test_files_download_requires_auth(self, user_session):
        # upload as user
        files = {"file": ("p.png", PNG_1PX, "image/png")}
        headers = {k: v for k, v in user_session.headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{API}/uploads/image", files=files, headers=headers, cookies=user_session.cookies)
        fid = r.json()["file_id"]

        r2 = requests.get(f"{API}/files/{fid}")  # no auth
        assert r2.status_code == 401

    def test_files_cross_user_isolation(self, user_session, admin_session):
        # upload as test_user
        files = {"file": ("p.png", PNG_1PX, "image/png")}
        headers = {k: v for k, v in user_session.headers.items() if k.lower() != "content-type"}
        r = requests.post(f"{API}/uploads/image", files=files, headers=headers, cookies=user_session.cookies)
        assert r.status_code == 200
        fid = r.json()["file_id"]

        # admin should NOT see it
        r2 = admin_session.get(f"{API}/files/{fid}")
        assert r2.status_code == 404


# ------------- Link preview -------------
class TestLinkPreview:
    def test_github_link_preview_has_title(self, user_session):
        r = user_session.get(f"{API}/link-preview", params={"url": "https://github.com"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert "title" in data
        assert isinstance(data["title"], str) and len(data["title"]) > 0
        assert data["title"] != "https://github.com"  # should be actual og:title
        # site_name is optional but should exist for GitHub
        assert "site_name" in data
        # 'image' key must be present (may be None)
        assert "image" in data

    def test_link_preview_unreachable_url_graceful(self, user_session):
        # A non-existent domain – should not 500
        r = user_session.get(
            f"{API}/link-preview",
            params={"url": "https://nonexistent-domain-inkwell-xyzq.example"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Graceful fallback: title == url
        assert data.get("title") == "https://nonexistent-domain-inkwell-xyzq.example"

    def test_link_preview_invalid_scheme_returns_400(self, user_session):
        r = user_session.get(f"{API}/link-preview", params={"url": "ftp://example.com"})
        assert r.status_code == 400


# ------------- Geocode -------------
class TestGeocode:
    def test_geocode_galata_kulesi(self, user_session):
        r = user_session.get(f"{API}/geocode", params={"q": "Galata Kulesi"})
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, list)
        assert len(data) > 0
        first = data[0]
        assert "display_name" in first and isinstance(first["display_name"], str)
        assert isinstance(first["lat"], float)
        assert isinstance(first["lng"], float)
        # Galata Kulesi is roughly at 41.02 N, 28.97 E
        assert 40.0 < first["lat"] < 42.0
        assert 28.0 < first["lng"] < 30.0
