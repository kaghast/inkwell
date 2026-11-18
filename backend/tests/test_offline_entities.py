"""Offline tests (no running server / MongoDB needed): tag & person consistency,
personal areas and graph data. Uses mongomock-motor + FastAPI TestClient.

Run:  pytest backend/tests/test_offline_entities.py
"""
import hashlib
import os
import secrets
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

mongomock_motor = pytest.importorskip("mongomock_motor")
from fastapi.testclient import TestClient  # noqa: E402

os.environ.setdefault("MONGO_URL", "mongodb://localhost:27017")
os.environ.setdefault("DB_NAME", "inkwell_offline")
os.environ.setdefault("SECRET_KEY", "offline-test-secret")
os.environ.setdefault("UPLOAD_DIR", tempfile.mkdtemp())
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import server  # noqa: E402


@pytest.fixture()
def client():
    server.client = mongomock_motor.AsyncMongoMockClient()
    server.db = server.client["inkwell_offline"]
    with TestClient(server.app, base_url="https://testserver") as c:
        def login(email):
            now = datetime.now(timezone.utc)
            uid = f"user_{secrets.token_hex(6)}"
            token = secrets.token_urlsafe(16)

            async def seed():
                await server.db.users.insert_one({"user_id": uid, "email": email, "name": email,
                                                  "auth_provider": "google", "created_at": now})
                await server.db.sessions.insert_one({"token_hash": hashlib.sha256(token.encode()).hexdigest(),
                                                     "user_id": uid, "created_at": now, "renewed_at": now,
                                                     "expires_at": now + timedelta(days=1)})
            c.portal.call(seed)
            c.cookies.set(server.SESSION_COOKIE, token)
            return uid
        c.login = login
        c.login("a@x.test")
        yield c


def names(c, kind):
    return sorted(t["name"] for t in c.get(f"/api/{kind}").json())


# ---------------- parsing ----------------
def test_parser_turkish_unicode_and_code_blocks():
    content = "Bugün #İstanbul ve #ÇALIŞMA @Ayşe #café-2\n```c\n#include <x>\n```\n`#inline` son #İstanbul"
    assert server.extract_tags(content) == ["istanbul", "çalışma", "café-2"]
    assert server.extract_people(content) == ["ayşe"]
    assert server.normalize_name("IŞIK") == "ışık"
    assert server.normalize_name("IBM") == "ibm"
    assert server.normalize_name("İzmir") == "izmir"


def test_rewrite_only_exact_token_outside_code():
    content = "#old #old-x #older\n```\n#old\n```\nend #old"
    renamed = server._rewrite_tokens(content, server.TAG_RE, "#", "old", "new")
    assert renamed == "#new #old-x #older\n```\n#old\n```\nend #new"
    removed = server._rewrite_tokens(content, server.TAG_RE, "#", "old", None)
    assert removed == "#old-x #older\n```\n#old\n```\nend"


# ---------------- tag / person consistency ----------------
def test_orphan_tags_disappear_when_notes_change(client):
    r = client.post("/api/notes", json={"content": "a #one #two @ali"})
    nid = r.json()["note_id"]
    assert names(client, "tags") == ["one", "two"]
    client.put(f"/api/notes/{nid}", json={"content": "a #two"})
    assert names(client, "tags") == ["two"]
    assert names(client, "people") == []
    client.delete(f"/api/notes/{nid}")
    assert names(client, "tags") == []


def test_delete_tag_strips_it_from_note_content(client):
    n1 = client.post("/api/notes", json={"content": "Toplantı #proje notları #iş"}).json()
    n2 = client.post("/api/notes", json={"content": "#proje\n```\n#proje in code\n```"}).json()
    tag = next(t for t in client.get("/api/tags").json() if t["name"] == "proje")
    r = client.delete(f"/api/tags/{tag['tag_id']}")
    assert r.json()["notes_updated"] == 2
    a = client.get(f"/api/notes/{n1['note_id']}").json()
    b = client.get(f"/api/notes/{n2['note_id']}").json()
    assert a["content"] == "Toplantı notları #iş" and a["tags"] == ["iş"]
    assert b["content"] == "\n```\n#proje in code\n```" and b["tags"] == []
    assert names(client, "tags") == ["iş"]


def test_delete_person_strips_mentions(client):
    n = client.post("/api/notes", json={"content": "@Ayşe ile @mehmet buluştu"}).json()
    p = next(x for x in client.get("/api/people").json() if x["name"] == "ayşe")
    client.delete(f"/api/people/{p['person_id']}")
    got = client.get(f"/api/notes/{n['note_id']}").json()
    assert got["content"] == "ile @mehmet buluştu" and got["people"] == ["mehmet"]
    assert names(client, "people") == ["mehmet"]


def test_rename_tag_does_not_touch_longer_tags(client):
    n = client.post("/api/notes", json={"content": "#old #old-x"}).json()
    tag = next(t for t in client.get("/api/tags").json() if t["name"] == "old")
    assert client.put(f"/api/tags/{tag['tag_id']}", json={"name": "#Yeni"}).status_code == 200
    got = client.get(f"/api/notes/{n['note_id']}").json()
    assert got["content"] == "#yeni #old-x"
    assert sorted(got["tags"]) == ["old-x", "yeni"]
    assert client.put(f"/api/tags/{tag['tag_id']}", json={"name": "two words"}).status_code == 400


def test_tag_filter_is_turkish_safe(client):
    client.post("/api/notes", json={"content": "#İzmir gezisi"})
    assert len(client.get("/api/notes", params={"tags": "İZMİR"}).json()) == 1


# ---------------- areas ----------------
def test_area_crud_note_linking_and_graph(client):
    work = client.post("/api/areas", json={"name": "İş"}).json()
    home = client.post("/api/areas", json={"name": "Aile", "color": "#123456"}).json()
    assert home["color"] == "#123456" and work["color"].startswith("#")
    assert client.post("/api/areas", json={"name": "iş"}).status_code == 400  # case-insensitive unique

    n1 = client.post("/api/notes", json={"content": "a", "area_ids": [work["area_id"], "area_bogus"]}).json()
    assert n1["area_ids"] == [work["area_id"]]
    n2 = client.post("/api/notes", json={"content": "b", "area_ids": [work["area_id"], home["area_id"]]}).json()
    client.post("/api/notes", json={"content": "c"})

    # update without area_ids keeps them; with [] clears them
    client.put(f"/api/notes/{n2['note_id']}", json={"content": "b2"})
    assert client.get(f"/api/notes/{n2['note_id']}").json()["area_ids"] == [work["area_id"], home["area_id"]]

    areas = {a["name"]: a for a in client.get("/api/areas").json()}
    assert areas["İş"]["note_count"] == 2 and areas["Aile"]["note_count"] == 1

    assert len(client.get("/api/notes", params={"area_id": work["area_id"]}).json()) == 2

    g = client.get("/api/graph").json()
    assert len(g["areas"]) == 2 and len(g["notes"]) == 3
    focus = client.get("/api/graph", params={"area_id": home["area_id"]}).json()
    assert [n["note_id"] for n in focus["notes"]] == [n2["note_id"]]
    assert client.get("/api/graph", params={"area_id": "nope"}).status_code == 404

    client.delete(f"/api/areas/{work['area_id']}")
    assert client.get(f"/api/notes/{n1['note_id']}").json()["area_ids"] == []
    assert client.get(f"/api/notes/{n2['note_id']}").json()["area_ids"] == [home["area_id"]]


def test_areas_are_per_user(client):
    a = client.post("/api/areas", json={"name": "Gizli"}).json()
    client.login("b@x.test")
    assert client.get("/api/areas").json() == []
    n = client.post("/api/notes", json={"content": "x", "area_ids": [a["area_id"]]}).json()
    assert n["area_ids"] == []
    assert client.delete(f"/api/areas/{a['area_id']}").status_code == 404


def test_migration_rebuilds_entities(client):
    async def seed():
        await server.db.meta.delete_many({})
        await server.db.notes.insert_one({"note_id": "n_old", "user_id": "u_old", "title": "", "date": "2026-01-01",
                                          "content": "#İstanbul\n```\n#include\n```", "tags": ["i̇stanbul", "include"],
                                          "people": [], "created_at": datetime.now(timezone.utc),
                                          "updated_at": datetime.now(timezone.utc)})
        await server.db.tags.insert_one({"tag_id": "t1", "user_id": "u_old", "name": "include"})
        await server.migrate()
        note = await server.db.notes.find_one({"note_id": "n_old"})
        tags = await server.db.tags.distinct("name", {"user_id": "u_old"})
        return note, tags
    note, tags = client.portal.call(seed)
    assert note["tags"] == ["istanbul"] and note["area_ids"] == []
    assert tags == ["istanbul"]


# ---------------- split ----------------
def test_split_note_into_two(client):
    area = client.post("/api/areas", json={"name": "İş"}).json()
    content = "Sabah #a @ali\n\nÖğle #b\n```reminder\n2030-01-01T10:00:00Z\nara\n```"
    n = client.post("/api/notes", json={"title": "Gün", "content": content,
                                        "date": "2026-11-18", "area_ids": [area["area_id"]]}).json()
    # inside the reminder fence → rejected
    assert client.post(f"/api/notes/{n['note_id']}/split", json={"at_line": 4}).status_code == 400
    # empty side → rejected
    assert client.post(f"/api/notes/{n['note_id']}/split", json={"at_line": 0}).status_code == 400
    r = client.post(f"/api/notes/{n['note_id']}/split", json={"at_line": 2})
    assert r.status_code == 200, r.text
    first, second = r.json()
    assert first["note_id"] == n["note_id"] and first["title"] == "Gün"
    assert first["content"] == "Sabah #a @ali" and first["tags"] == ["a"] and first["people"] == ["ali"]
    assert second["content"].startswith("Öğle #b") and second["tags"] == ["b"]
    assert second["date"] == "2026-11-18" and second["area_ids"] == [area["area_id"]]
    listed = [x["note_id"] for x in client.get("/api/notes").json()]
    assert listed.index(first["note_id"]) + 1 == listed.index(second["note_id"])
    rems = client.get("/api/reminders/upcoming", params={"within_hours": 24 * 365 * 10}).json()
    assert {x["note_id"] for x in rems} == {second["note_id"]}
