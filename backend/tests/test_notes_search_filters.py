"""
Backend tests for new Inkwell notes endpoint features:
- Free-text search (?q=)
- Multi-filter via repeating params (?tags=a&tags=b, ?people=, ?location_ids=)
- Legacy single-param compatibility (?tag=, ?person=, ?location_id=) unioned with multi
- AND combination of q + tags + date filter
- PUT /api/notes/{id} with created_at ISO override

Run:
  pytest /app/backend/tests/test_notes_search_filters.py -v \
    --junitxml=/app/test_reports/pytest/pytest_search_filters.xml
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

TEST_USER = {"email": "test@inkwell.app", "password": "test12345"}


# ---------- session / fixtures ----------
def _login(session, creds):
    return session.post(f"{API}/auth/login", json=creds)


@pytest.fixture(scope="module")
def user_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    r = _login(s, TEST_USER)
    if r.status_code != 200:
        s.post(f"{API}/auth/register", json={**TEST_USER, "name": "Test"})
        r = _login(s, TEST_USER)
    assert r.status_code == 200, f"Test user login failed: {r.text}"
    return s


@pytest.fixture(scope="module")
def seed_notes(user_session):
    """Create deterministic seed notes for filter testing."""
    suffix = uuid.uuid4().hex[:6]
    tag_a = f"alpha{suffix}"
    tag_b = f"beta{suffix}"
    tag_c = f"gamma{suffix}"
    person_x = f"xavier{suffix}"
    person_y = f"yvonne{suffix}"

    # Create 2 locations
    loc1 = user_session.post(
        f"{API}/locations",
        json={"name": f"TEST_Loc1_{suffix}", "lat": 41.0, "lng": 29.0},
    )
    assert loc1.status_code == 200, loc1.text
    loc2 = user_session.post(
        f"{API}/locations",
        json={"name": f"TEST_Loc2_{suffix}", "lat": 39.0, "lng": 27.0},
    )
    assert loc2.status_code == 200, loc2.text
    loc1_id = loc1.json()["location_id"]
    loc2_id = loc2.json()["location_id"]

    date_today = datetime.now(timezone.utc).date().isoformat()
    date_other = "2099-01-15"  # far-future date for filter isolation

    def _create(title, content, date=date_today, location_id=None):
        r = user_session.post(
            f"{API}/notes",
            json={
                "title": title,
                "content": content,
                "date": date,
                "location_id": location_id,
            },
        )
        assert r.status_code == 200, r.text
        return r.json()

    notes = {
        # Has alpha+beta, person xavier, loc1
        "ab_x_l1": _create(
            f"TEST_AB_{suffix}",
            f"Search-needle PINEAPPLE alpha #{tag_a} #{tag_b} @{person_x}",
            location_id=loc1_id,
        ),
        # Has alpha only, person yvonne, loc2
        "a_y_l2": _create(
            f"TEST_A_{suffix}",
            f"Just alpha #{tag_a} @{person_y} something",
            location_id=loc2_id,
        ),
        # Has beta+gamma, both people, no location, OTHER DATE
        "bg_xy_nodate": _create(
            f"TEST_BG_{suffix}",
            f"beta+gamma #{tag_b} #{tag_c} @{person_x} @{person_y} PINEAPPLE elsewhere",
            date=date_other,
        ),
        # Has gamma only, no person, no location, today
        "g_only": _create(
            f"TEST_G_{suffix}",
            f"only gamma here #{tag_c} no-needle",
        ),
    }
    return {
        "suffix": suffix,
        "tag_a": tag_a,
        "tag_b": tag_b,
        "tag_c": tag_c,
        "person_x": person_x,
        "person_y": person_y,
        "loc1_id": loc1_id,
        "loc2_id": loc2_id,
        "date_today": date_today,
        "date_other": date_other,
        "notes": notes,
    }


def _ids(items):
    return {n["note_id"] for n in items}


# ---------------- Free-text search ----------------
class TestFreeTextSearch:
    def test_q_matches_content_case_insensitive(self, user_session, seed_notes):
        r = user_session.get(f"{API}/notes", params={"q": "pineapple"})
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] in ids
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] in ids
        assert seed_notes["notes"]["g_only"]["note_id"] not in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] not in ids

    def test_q_matches_title(self, user_session, seed_notes):
        # title TEST_BG_<suffix> is unique
        title = seed_notes["notes"]["bg_xy_nodate"]["title"]
        r = user_session.get(f"{API}/notes", params={"q": title.lower()})
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] in ids

    def test_q_no_match_returns_empty_or_excludes(self, user_session, seed_notes):
        # Use a random string very unlikely to match other notes from this account.
        r = user_session.get(f"{API}/notes", params={"q": f"zzz_nomatch_{uuid.uuid4().hex}"})
        assert r.status_code == 200
        ids = _ids(r.json())
        for k in seed_notes["notes"]:
            assert seed_notes["notes"][k]["note_id"] not in ids


# ---------------- Multi tags (repeating param) ----------------
class TestMultiTagFilter:
    def test_single_tags_param(self, user_session, seed_notes):
        r = user_session.get(f"{API}/notes", params=[("tags", seed_notes["tag_a"])])
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] in ids
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] not in ids
        assert seed_notes["notes"]["g_only"]["note_id"] not in ids

    def test_multi_tags_AND(self, user_session, seed_notes):
        r = user_session.get(
            f"{API}/notes",
            params=[("tags", seed_notes["tag_a"]), ("tags", seed_notes["tag_b"])],
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        # Only ab_x_l1 has BOTH alpha & beta
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] not in ids
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] not in ids

    def test_legacy_tag_unioned_with_tags(self, user_session, seed_notes):
        # legacy tag=alpha + tags=beta should match notes containing BOTH alpha AND beta
        r = user_session.get(
            f"{API}/notes",
            params=[("tag", seed_notes["tag_a"]), ("tags", seed_notes["tag_b"])],
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] not in ids


# ---------------- Multi people ----------------
class TestMultiPeopleFilter:
    def test_multi_people_AND(self, user_session, seed_notes):
        r = user_session.get(
            f"{API}/notes",
            params=[("people", seed_notes["person_x"]), ("people", seed_notes["person_y"])],
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        # Only bg_xy_nodate has both people
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] in ids
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] not in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] not in ids

    def test_legacy_person_unioned_with_people(self, user_session, seed_notes):
        r = user_session.get(
            f"{API}/notes",
            params=[("person", seed_notes["person_x"]), ("people", seed_notes["person_y"])],
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] in ids
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] not in ids


# ---------------- Multi location_ids ($in) ----------------
class TestMultiLocationFilter:
    def test_multi_location_ids_in(self, user_session, seed_notes):
        r = user_session.get(
            f"{API}/notes",
            params=[("location_ids", seed_notes["loc1_id"]), ("location_ids", seed_notes["loc2_id"])],
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        # Notes with loc1 or loc2
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] in ids
        # Notes with no location_id should NOT match
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] not in ids
        assert seed_notes["notes"]["g_only"]["note_id"] not in ids

    def test_single_location_ids(self, user_session, seed_notes):
        r = user_session.get(
            f"{API}/notes", params=[("location_ids", seed_notes["loc1_id"])]
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] not in ids

    def test_legacy_location_id_unioned(self, user_session, seed_notes):
        # legacy location_id=loc1 unioned with location_ids=loc2 → $in [loc1,loc2]
        r = user_session.get(
            f"{API}/notes",
            params=[("location_id", seed_notes["loc1_id"]), ("location_ids", seed_notes["loc2_id"])],
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] in ids


# ---------------- Combined filters (AND) ----------------
class TestCombinedFilters:
    def test_q_plus_tags_plus_date(self, user_session, seed_notes):
        # date=today + tags=alpha + q=pineapple → only ab_x_l1 (today, has alpha, has pineapple)
        r = user_session.get(
            f"{API}/notes",
            params=[
                ("q", "pineapple"),
                ("tags", seed_notes["tag_a"]),
                ("date", seed_notes["date_today"]),
            ],
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] in ids
        # bg_xy_nodate has pineapple but is on date_other → excluded by date
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] not in ids
        # a_y_l2: today + alpha but no pineapple → excluded by q
        assert seed_notes["notes"]["a_y_l2"]["note_id"] not in ids

    def test_empty_multi_with_date_only(self, user_session, seed_notes):
        # No tags=, no people=, only date filter → all notes on date_other
        r = user_session.get(
            f"{API}/notes",
            params=[("date", seed_notes["date_other"])],
        )
        assert r.status_code == 200
        ids = _ids(r.json())
        assert seed_notes["notes"]["bg_xy_nodate"]["note_id"] in ids
        # other seed notes are on date_today, must NOT be present
        assert seed_notes["notes"]["ab_x_l1"]["note_id"] not in ids
        assert seed_notes["notes"]["a_y_l2"]["note_id"] not in ids
        assert seed_notes["notes"]["g_only"]["note_id"] not in ids

    def test_no_params_returns_all_user_notes(self, user_session, seed_notes):
        r = user_session.get(f"{API}/notes")
        assert r.status_code == 200
        ids = _ids(r.json())
        # All 4 seed notes for current user must be present
        for k in seed_notes["notes"]:
            assert seed_notes["notes"][k]["note_id"] in ids


# ---------------- PUT /notes/{id} created_at override ----------------
class TestUpdateCreatedAt:
    def test_update_created_at_iso_z(self, user_session, seed_notes):
        note = seed_notes["notes"]["g_only"]
        new_iso = "2020-05-17T10:30:00Z"
        r = user_session.put(
            f"{API}/notes/{note['note_id']}",
            json={
                "title": note["title"],
                "content": note["content"],
                "date": note["date"],
                "location_id": note.get("location_id"),
                "created_at": new_iso,
            },
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # ISO string returned; verify date portion
        ca = data["created_at"]
        assert "2020-05-17" in ca, f"created_at not updated: {ca}"

        # GET to verify persistence
        g = user_session.get(f"{API}/notes/{note['note_id']}")
        assert g.status_code == 200
        assert "2020-05-17" in g.json()["created_at"]

    def test_update_created_at_invalid_is_silently_ignored(self, user_session, seed_notes):
        note = seed_notes["notes"]["a_y_l2"]
        before = user_session.get(f"{API}/notes/{note['note_id']}").json()["created_at"]
        r = user_session.put(
            f"{API}/notes/{note['note_id']}",
            json={
                "title": note["title"],
                "content": note["content"],
                "date": note["date"],
                "location_id": note.get("location_id"),
                "created_at": "not-a-date",
            },
        )
        assert r.status_code == 200
        # Should not crash; created_at should remain unchanged
        after = r.json()["created_at"]
        assert after == before or after.startswith(before[:10])


# ---------------- Regression: existing flows still work ----------------
class TestRegressionExistingFlows:
    def test_auth_me_works(self, user_session):
        r = user_session.get(f"{API}/auth/me")
        assert r.status_code == 200
        assert r.json()["email"] == TEST_USER["email"]

    def test_calendar_counts(self, user_session, seed_notes):
        today = datetime.now(timezone.utc).date()
        r = user_session.get(
            f"{API}/notes/calendar", params={"year": today.year, "month": today.month}
        )
        assert r.status_code == 200
        data = r.json()
        # Today must have at least the seed count we created
        assert data.get(seed_notes["date_today"], 0) >= 3

    def test_create_note_extracts_tags_and_people(self, user_session):
        suffix = uuid.uuid4().hex[:6]
        r = user_session.post(
            f"{API}/notes",
            json={
                "title": f"TEST_extract_{suffix}",
                "content": f"hello #regress{suffix} and @bob{suffix}",
            },
        )
        assert r.status_code == 200
        d = r.json()
        assert f"regress{suffix}" in d["tags"]
        assert f"bob{suffix}" in d["people"]

    def test_tag_rename_propagates(self, user_session):
        suffix = uuid.uuid4().hex[:6]
        old = f"renold{suffix}"
        new = f"rennew{suffix}"
        # Create note with the tag
        n = user_session.post(
            f"{API}/notes",
            json={"title": f"TEST_rn_{suffix}", "content": f"x #{old} y"},
        )
        assert n.status_code == 200
        note_id = n.json()["note_id"]
        # Find tag id
        tags = user_session.get(f"{API}/tags", params={"q": old}).json()
        assert any(t["name"] == old for t in tags)
        tag_id = next(t["tag_id"] for t in tags if t["name"] == old)
        # Rename
        r = user_session.put(f"{API}/tags/{tag_id}", json={"name": new})
        assert r.status_code == 200, r.text
        # Verify note updated
        g = user_session.get(f"{API}/notes/{note_id}").json()
        assert new in g["tags"]
        assert old not in g["tags"]
        assert f"#{new}" in g["content"]
