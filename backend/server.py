from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import re
import uuid
import logging
import bcrypt
import jwt
import httpx
import requests
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, Query, UploadFile, File, Header
from fastapi.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr, ConfigDict


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
JWT_ALGORITHM = "HS256"
JWT_SECRET_KEY = "JWT_SECRET"
ACCESS_TOKEN_MIN = 60 * 24  # 1 day
REFRESH_TOKEN_DAYS = 7

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]


def get_jwt_secret() -> str:
    return os.environ[JWT_SECRET_KEY]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(minutes=ACCESS_TOKEN_MIN),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def create_refresh_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS),
        "type": "refresh",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def set_auth_cookies(response: Response, access_token: str, refresh_token: str):
    response.set_cookie(
        key="access_token",
        value=access_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=ACCESS_TOKEN_MIN * 60,
        path="/",
    )
    response.set_cookie(
        key="refresh_token",
        value=refresh_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        path="/",
    )


def clear_auth_cookies(response: Response):
    for name in ("access_token", "refresh_token", "session_token"):
        response.set_cookie(
            key=name, value="", max_age=0,
            httponly=True, secure=True, samesite="none", path="/",
        )


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class RegisterIn(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6, max_length=128)
    name: Optional[str] = None


class LoginIn(BaseModel):
    email: EmailStr
    password: str


class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: EmailStr
    name: Optional[str] = None
    picture: Optional[str] = None
    auth_provider: str = "email"
    created_at: datetime


class TagModel(BaseModel):
    tag_id: str
    user_id: str
    name: str
    created_at: datetime


class PersonModel(BaseModel):
    person_id: str
    user_id: str
    name: str
    created_at: datetime


class LocationModel(BaseModel):
    location_id: str
    user_id: str
    name: str
    lat: float
    lng: float
    created_at: datetime


class NoteIn(BaseModel):
    title: Optional[str] = ""
    content: str = ""
    date: Optional[str] = None  # ISO date YYYY-MM-DD
    location_id: Optional[str] = None
    created_at: Optional[str] = None  # ISO datetime override


class NoteOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    note_id: str
    user_id: str
    title: str
    content: str
    date: str
    tags: List[str]
    people: List[str]
    location_id: Optional[str] = None
    pinned: bool = False
    created_at: datetime
    updated_at: datetime


class RenameIn(BaseModel):
    name: str


class LocationIn(BaseModel):
    name: Optional[str] = None
    lat: float
    lng: float


# ---------------------------------------------------------------------------
# App + Router
# ---------------------------------------------------------------------------
app = FastAPI(title="Inkwell Notes API")
api_router = APIRouter(prefix="/api")


# ---------------------------------------------------------------------------
# Auth dependency
# ---------------------------------------------------------------------------
async def get_current_user(request: Request) -> dict:
    token = request.cookies.get("access_token")
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    # Also support Emergent Google session_token cookie
    session_token = request.cookies.get("session_token")

    if token:
        try:
            payload = jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])
            if payload.get("type") != "access":
                raise HTTPException(status_code=401, detail="Invalid token type")
            user = await db.users.find_one({"user_id": payload["sub"]}, {"_id": 0, "password_hash": 0})
            if user:
                return user
        except jwt.ExpiredSignatureError:
            pass
        except jwt.InvalidTokenError:
            pass

    if session_token:
        session = await db.user_sessions.find_one({"session_token": session_token}, {"_id": 0})
        if session:
            expires_at = session.get("expires_at")
            if isinstance(expires_at, str):
                expires_at = datetime.fromisoformat(expires_at)
            if expires_at and expires_at.tzinfo is None:
                expires_at = expires_at.replace(tzinfo=timezone.utc)
            if expires_at and expires_at >= datetime.now(timezone.utc):
                user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0, "password_hash": 0})
                if user:
                    return user

    raise HTTPException(status_code=401, detail="Not authenticated")


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@api_router.post("/auth/register", response_model=UserOut)
async def register(data: RegisterIn, response: Response):
    email = data.email.lower().strip()
    existing = await db.users.find_one({"email": email})
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    user_doc = {
        "user_id": user_id,
        "email": email,
        "name": data.name or email.split("@")[0],
        "password_hash": hash_password(data.password),
        "picture": None,
        "auth_provider": "email",
        "created_at": datetime.now(timezone.utc),
    }
    await db.users.insert_one(user_doc)
    set_auth_cookies(response, create_access_token(user_id, email), create_refresh_token(user_id))
    user_doc.pop("password_hash", None)
    user_doc.pop("_id", None)
    return user_doc


@api_router.post("/auth/login", response_model=UserOut)
async def login(data: LoginIn, response: Response):
    email = data.email.lower().strip()
    user = await db.users.find_one({"email": email})
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(data.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    set_auth_cookies(response, create_access_token(user["user_id"], email), create_refresh_token(user["user_id"]))
    user.pop("password_hash", None)
    user.pop("_id", None)
    return user


@api_router.post("/auth/logout")
async def logout(response: Response, request: Request):
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_one({"session_token": session_token})
    clear_auth_cookies(response)
    return {"ok": True}


@api_router.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return user


@api_router.post("/auth/google/session", response_model=UserOut)
async def google_session(request: Request, response: Response):
    """Exchange Emergent session_id (sent as X-Session-ID header) for our session."""
    session_id = request.headers.get("X-Session-ID")
    if not session_id:
        raise HTTPException(status_code=400, detail="X-Session-ID header required")
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = (data.get("email") or "").lower().strip()
    if not email:
        raise HTTPException(status_code=400, detail="No email returned")
    existing = await db.users.find_one({"email": email})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": data.get("name") or existing.get("name"), "picture": data.get("picture")}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one(
            {
                "user_id": user_id,
                "email": email,
                "name": data.get("name") or email.split("@")[0],
                "picture": data.get("picture"),
                "auth_provider": "google",
                "password_hash": None,
                "created_at": datetime.now(timezone.utc),
            }
        )

    session_token = data.get("session_token") or f"sess_{uuid.uuid4().hex}"
    expires_at = datetime.now(timezone.utc) + timedelta(days=REFRESH_TOKEN_DAYS)
    await db.user_sessions.insert_one(
        {
            "user_id": user_id,
            "session_token": session_token,
            "expires_at": expires_at,
            "created_at": datetime.now(timezone.utc),
        }
    )
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=REFRESH_TOKEN_DAYS * 24 * 60 * 60,
        path="/",
    )
    set_auth_cookies(response, create_access_token(user_id, email), create_refresh_token(user_id))
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0, "password_hash": 0})
    return user


# ---------------------------------------------------------------------------
# Notes / Tags / People / Locations
# ---------------------------------------------------------------------------
TAG_RE = re.compile(r"(?<!\S)#([\w\-_ğüşıöçĞÜŞİÖÇ]+)", re.UNICODE)
MENTION_RE = re.compile(r"(?<!\S)@([\w\-_ğüşıöçĞÜŞİÖÇ]+)", re.UNICODE)


def extract_tags(content: str) -> List[str]:
    return list(dict.fromkeys([m.group(1).lower() for m in TAG_RE.finditer(content)]))


def extract_people(content: str) -> List[str]:
    return list(dict.fromkeys([m.group(1).lower() for m in MENTION_RE.finditer(content)]))


async def ensure_tags(user_id: str, tag_names: List[str]):
    for raw in tag_names:
        name = raw.strip().lower()
        if not name:
            continue
        existing = await db.tags.find_one({"user_id": user_id, "name": name})
        if not existing:
            await db.tags.insert_one(
                {
                    "tag_id": f"tag_{uuid.uuid4().hex[:12]}",
                    "user_id": user_id,
                    "name": name,
                    "created_at": datetime.now(timezone.utc),
                }
            )


async def ensure_people(user_id: str, names: List[str]):
    for raw in names:
        name = raw.strip().lower()
        if not name:
            continue
        existing = await db.people.find_one({"user_id": user_id, "name": name})
        if not existing:
            await db.people.insert_one(
                {
                    "person_id": f"person_{uuid.uuid4().hex[:12]}",
                    "user_id": user_id,
                    "name": name,
                    "created_at": datetime.now(timezone.utc),
                }
            )


def today_iso() -> str:
    return datetime.now(timezone.utc).date().isoformat()


# ---- Reminders parsing/sync
REMINDER_RE = re.compile(
    r"```reminder\s*\n([^\n]+)\n([\s\S]*?)\n?```",
    re.IGNORECASE,
)


def extract_reminders(content: str) -> List[dict]:
    """Extract ``` reminder\\n<iso>\\n<text>\\n``` fenced blocks."""
    out: List[dict] = []
    for m in REMINDER_RE.finditer(content or ""):
        iso = m.group(1).strip()
        text = (m.group(2) or "").strip()
        try:
            dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
        except ValueError:
            continue
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        out.append({"at": dt, "text": text or "Hatırlatma"})
    return out


async def sync_reminders(user_id: str, note_id: str, content: str):
    """Replace all reminders for this note based on extracted fenced blocks."""
    await db.reminders.delete_many({"user_id": user_id, "note_id": note_id})
    extracted = extract_reminders(content)
    if not extracted:
        return
    docs = []
    for r in extracted:
        docs.append({
            "reminder_id": f"rem_{uuid.uuid4().hex[:12]}",
            "user_id": user_id,
            "note_id": note_id,
            "at": r["at"],
            "text": r["text"],
            "fired": False,
            "created_at": datetime.now(timezone.utc),
        })
    if docs:
        await db.reminders.insert_many(docs)


# ---- Notes
@api_router.post("/notes", response_model=NoteOut)
async def create_note(payload: NoteIn, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    content = payload.content or ""
    tags = extract_tags(content)
    people = extract_people(content)
    await ensure_tags(user_id, tags)
    await ensure_people(user_id, people)

    note_id = f"note_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    doc = {
        "note_id": note_id,
        "user_id": user_id,
        "title": (payload.title or "").strip(),
        "content": content,
        "date": payload.date or today_iso(),
        "tags": tags,
        "people": people,
        "location_id": payload.location_id,
        "pinned": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.notes.insert_one(doc)
    await sync_reminders(user_id, note_id, content)
    doc.pop("_id", None)
    return doc


@api_router.get("/notes", response_model=List[NoteOut])
async def list_notes(
    date: Optional[str] = None,
    tag: Optional[str] = None,
    person: Optional[str] = None,
    location_id: Optional[str] = None,
    tags: List[str] = Query(default_factory=list),
    people: List[str] = Query(default_factory=list),
    location_ids: List[str] = Query(default_factory=list),
    q: Optional[str] = None,
    pinned: Optional[bool] = None,
    user: dict = Depends(get_current_user),
):
    qf: dict = {"user_id": user["user_id"]}
    if date:
        qf["date"] = date
    if pinned is True:
        qf["pinned"] = True
    elif pinned is False:
        qf["pinned"] = {"$ne": True}

    all_tags = list({t.lower() for t in tags} | ({tag.lower()} if tag else set()))
    if len(all_tags) == 1:
        qf["tags"] = all_tags[0]
    elif len(all_tags) > 1:
        qf["tags"] = {"$all": all_tags}

    all_people = list({p.lower() for p in people} | ({person.lower()} if person else set()))
    if len(all_people) == 1:
        qf["people"] = all_people[0]
    elif len(all_people) > 1:
        qf["people"] = {"$all": all_people}

    all_locs = list({l for l in location_ids} | ({location_id} if location_id else set()))
    if len(all_locs) == 1:
        qf["location_id"] = all_locs[0]
    elif len(all_locs) > 1:
        qf["location_id"] = {"$in": all_locs}

    if q:
        rx = {"$regex": re.escape(q), "$options": "i"}
        qf["$or"] = [{"title": rx}, {"content": rx}]

    items = await db.notes.find(qf, {"_id": 0}).sort("created_at", -1).to_list(500)
    return items


@api_router.get("/notes/calendar")
async def calendar_counts(year: int, month: int, user: dict = Depends(get_current_user)):
    start = f"{year:04d}-{month:02d}-01"
    if month == 12:
        end = f"{year+1:04d}-01-01"
    else:
        end = f"{year:04d}-{month+1:02d}-01"
    pipeline = [
        {"$match": {"user_id": user["user_id"], "date": {"$gte": start, "$lt": end}}},
        {"$group": {"_id": "$date", "count": {"$sum": 1}}},
    ]
    res = await db.notes.aggregate(pipeline).to_list(500)
    return {item["_id"]: item["count"] for item in res}


@api_router.get("/notes/{note_id}", response_model=NoteOut)
async def get_note(note_id: str, user: dict = Depends(get_current_user)):
    note = await db.notes.find_one({"note_id": note_id, "user_id": user["user_id"]}, {"_id": 0})
    if not note:
        raise HTTPException(404, "Not found")
    return note


@api_router.put("/notes/{note_id}", response_model=NoteOut)
async def update_note(note_id: str, payload: NoteIn, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    existing = await db.notes.find_one({"note_id": note_id, "user_id": user_id}, {"_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    content = payload.content or ""
    tags = extract_tags(content)
    people = extract_people(content)
    await ensure_tags(user_id, tags)
    await ensure_people(user_id, people)
    update = {
        "title": (payload.title or "").strip(),
        "content": content,
        "date": payload.date or existing["date"],
        "tags": tags,
        "people": people,
        "location_id": payload.location_id,
        "updated_at": datetime.now(timezone.utc),
    }
    if payload.created_at:
        try:
            iso = payload.created_at.replace("Z", "+00:00")
            update["created_at"] = datetime.fromisoformat(iso)
        except ValueError:
            pass
    await db.notes.update_one({"note_id": note_id, "user_id": user_id}, {"$set": update})
    await sync_reminders(user_id, note_id, content)
    note = await db.notes.find_one({"note_id": note_id}, {"_id": 0})
    return note


@api_router.patch("/notes/{note_id}/pin", response_model=NoteOut)
async def toggle_pin(note_id: str, user: dict = Depends(get_current_user)):
    note = await db.notes.find_one({"note_id": note_id, "user_id": user["user_id"]}, {"_id": 0})
    if not note:
        raise HTTPException(404, "Not found")
    new_val = not bool(note.get("pinned", False))
    await db.notes.update_one({"note_id": note_id}, {"$set": {"pinned": new_val, "updated_at": datetime.now(timezone.utc)}})
    note["pinned"] = new_val
    return note


@api_router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user: dict = Depends(get_current_user)):
    res = await db.notes.delete_one({"note_id": note_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    await db.reminders.delete_many({"note_id": note_id, "user_id": user["user_id"]})
    return {"ok": True}


# ---- Tags
@api_router.get("/tags")
async def list_tags(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    query: dict = {"user_id": user["user_id"]}
    if q:
        query["name"] = {"$regex": f"^{re.escape(q.lower())}"}
    tags = await db.tags.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    return tags


@api_router.put("/tags/{tag_id}")
async def rename_tag(tag_id: str, payload: RenameIn, user: dict = Depends(get_current_user)):
    new_name = payload.name.strip().lower()
    if not new_name:
        raise HTTPException(400, "Name required")
    tag = await db.tags.find_one({"tag_id": tag_id, "user_id": user["user_id"]}, {"_id": 0})
    if not tag:
        raise HTTPException(404, "Not found")
    old_name = tag["name"]
    if old_name == new_name:
        return tag
    # check conflict
    conflict = await db.tags.find_one({"user_id": user["user_id"], "name": new_name})
    if conflict:
        raise HTTPException(400, "Tag name already exists")
    await db.tags.update_one({"tag_id": tag_id}, {"$set": {"name": new_name}})
    # Update notes: tags array + content #old -> #new
    pattern = re.compile(r"(?<!\S)#" + re.escape(old_name) + r"(?!\w)", re.UNICODE | re.IGNORECASE)
    cursor = db.notes.find({"user_id": user["user_id"], "tags": old_name})
    async for n in cursor:
        new_content = pattern.sub(f"#{new_name}", n["content"])
        new_tags = [new_name if t == old_name else t for t in n.get("tags", [])]
        await db.notes.update_one(
            {"note_id": n["note_id"]},
            {"$set": {"content": new_content, "tags": new_tags, "updated_at": datetime.now(timezone.utc)}},
        )
    tag["name"] = new_name
    return tag


@api_router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, user: dict = Depends(get_current_user)):
    tag = await db.tags.find_one({"tag_id": tag_id, "user_id": user["user_id"]}, {"_id": 0})
    if not tag:
        raise HTTPException(404, "Not found")
    await db.tags.delete_one({"tag_id": tag_id})
    return {"ok": True}


# ---- People
@api_router.get("/people")
async def list_people(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    query: dict = {"user_id": user["user_id"]}
    if q:
        query["name"] = {"$regex": f"^{re.escape(q.lower())}"}
    people = await db.people.find(query, {"_id": 0}).sort("name", 1).to_list(500)
    return people


@api_router.put("/people/{person_id}")
async def rename_person(person_id: str, payload: RenameIn, user: dict = Depends(get_current_user)):
    new_name = payload.name.strip().lower()
    if not new_name:
        raise HTTPException(400, "Name required")
    person = await db.people.find_one({"person_id": person_id, "user_id": user["user_id"]}, {"_id": 0})
    if not person:
        raise HTTPException(404, "Not found")
    old_name = person["name"]
    if old_name == new_name:
        return person
    conflict = await db.people.find_one({"user_id": user["user_id"], "name": new_name})
    if conflict:
        raise HTTPException(400, "Person name already exists")
    await db.people.update_one({"person_id": person_id}, {"$set": {"name": new_name}})
    pattern = re.compile(r"(?<!\S)@" + re.escape(old_name) + r"(?!\w)", re.UNICODE | re.IGNORECASE)
    cursor = db.notes.find({"user_id": user["user_id"], "people": old_name})
    async for n in cursor:
        new_content = pattern.sub(f"@{new_name}", n["content"])
        new_people = [new_name if p == old_name else p for p in n.get("people", [])]
        await db.notes.update_one(
            {"note_id": n["note_id"]},
            {"$set": {"content": new_content, "people": new_people, "updated_at": datetime.now(timezone.utc)}},
        )
    person["name"] = new_name
    return person


@api_router.delete("/people/{person_id}")
async def delete_person(person_id: str, user: dict = Depends(get_current_user)):
    person = await db.people.find_one({"person_id": person_id, "user_id": user["user_id"]}, {"_id": 0})
    if not person:
        raise HTTPException(404, "Not found")
    await db.people.delete_one({"person_id": person_id})
    return {"ok": True}


# ---- Locations
@api_router.get("/locations")
async def list_locations(user: dict = Depends(get_current_user)):
    locs = await db.locations.find({"user_id": user["user_id"]}, {"_id": 0}).sort("created_at", -1).to_list(500)
    return locs


@api_router.post("/locations")
async def create_location(payload: LocationIn, user: dict = Depends(get_current_user)):
    name = (payload.name or f"Yer {datetime.now(timezone.utc).strftime('%H:%M')}").strip()
    # Reuse existing close-by? Just always create unique.
    loc = {
        "location_id": f"loc_{uuid.uuid4().hex[:12]}",
        "user_id": user["user_id"],
        "name": name,
        "lat": payload.lat,
        "lng": payload.lng,
        "created_at": datetime.now(timezone.utc),
    }
    await db.locations.insert_one(loc)
    loc.pop("_id", None)
    return loc


@api_router.put("/locations/{location_id}")
async def rename_location(location_id: str, payload: RenameIn, user: dict = Depends(get_current_user)):
    new_name = payload.name.strip()
    if not new_name:
        raise HTTPException(400, "Name required")
    loc = await db.locations.find_one({"location_id": location_id, "user_id": user["user_id"]}, {"_id": 0})
    if not loc:
        raise HTTPException(404, "Not found")
    await db.locations.update_one({"location_id": location_id}, {"$set": {"name": new_name}})
    # Notes referencing this location_id automatically get updated label via join.
    loc["name"] = new_name
    return loc


@api_router.delete("/locations/{location_id}")
async def delete_location(location_id: str, user: dict = Depends(get_current_user)):
    loc = await db.locations.find_one({"location_id": location_id, "user_id": user["user_id"]}, {"_id": 0})
    if not loc:
        raise HTTPException(404, "Not found")
    await db.locations.delete_one({"location_id": location_id})
    # Clear location_id on related notes
    await db.notes.update_many({"location_id": location_id}, {"$set": {"location_id": None}})
    return {"ok": True}


# ---- Health
@api_router.get("/")
async def root():
    return {"ok": True, "service": "inkwell"}


# ---- Geocoding proxy (Photon / Komoot — OpenStreetMap based, no UA requirement, CORS enabled)
# Proxied through backend for caching + uniform response shape.
_geocode_cache: dict[str, tuple[float, list[dict]]] = {}
_GEOCODE_TTL = 600  # 10 minutes


@api_router.get("/geocode")
async def geocode(q: str, limit: int = 6, user: dict = Depends(get_current_user)):
    key = f"{q.strip().lower()}|{limit}"
    now = datetime.now(timezone.utc).timestamp()
    cached = _geocode_cache.get(key)
    if cached and now - cached[0] < _GEOCODE_TTL:
        return cached[1]
    if not q.strip():
        return []
    url = "https://photon.komoot.io/api/"
    params = {
        "q": q,
        "limit": max(1, min(limit, 10)),
    }
    try:
        async with httpx.AsyncClient(timeout=10, headers={
            "User-Agent": "Mozilla/5.0 (compatible; InkwellNotes/1.0; +https://inkwell.app)",
            "Accept": "application/json",
            "Accept-Language": "tr,en;q=0.8",
        }) as http:
            r = await http.get(url, params=params)
        if r.status_code != 200:
            logging.warning("Photon upstream %s: %s", r.status_code, r.text[:200])
            raise HTTPException(status_code=502, detail="Geocoding upstream error")
        body = r.json() or {}
        feats = body.get("features", []) or []
        out = []
        for f in feats:
            props = f.get("properties", {}) or {}
            geom = f.get("geometry", {}) or {}
            coords = geom.get("coordinates") or [None, None]
            lon, lat = coords[0], coords[1]
            if lat is None or lon is None:
                continue
            # Build a friendly display label
            name = props.get("name") or ""
            parts = [
                name,
                props.get("street"),
                props.get("city") or props.get("county"),
                props.get("state"),
                props.get("country"),
            ]
            display_name = ", ".join([p for p in parts if p])
            out.append({
                "display_name": display_name or name or "—",
                "name": name,
                "lat": float(lat),
                "lng": float(lon),
                "type": props.get("type"),
                "osm_key": props.get("osm_key"),
            })
        _geocode_cache[key] = (now, out)
        _cache_trim(_geocode_cache)
        return out
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Geocoding upstream error")


# ---- File uploads (Emergent object storage)
STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
EMERGENT_KEY = os.environ.get("EMERGENT_LLM_KEY")
APP_NAME = "inkwell"

_storage_key: Optional[str] = None


def init_storage() -> str:
    """Call once at startup; returns cached session-scoped storage_key."""
    global _storage_key
    if _storage_key:
        return _storage_key
    if not EMERGENT_KEY:
        raise RuntimeError("EMERGENT_LLM_KEY not set")
    resp = requests.post(
        f"{STORAGE_URL}/init",
        json={"emergent_key": EMERGENT_KEY},
        timeout=30,
    )
    resp.raise_for_status()
    _storage_key = resp.json()["storage_key"]
    return _storage_key


def put_object(path: str, data: bytes, content_type: str) -> dict:
    key = init_storage()
    resp = requests.put(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key, "Content-Type": content_type},
        data=data, timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def get_object(path: str) -> tuple[bytes, str]:
    key = init_storage()
    resp = requests.get(
        f"{STORAGE_URL}/objects/{path}",
        headers={"X-Storage-Key": key}, timeout=60,
    )
    resp.raise_for_status()
    return resp.content, resp.headers.get("Content-Type", "application/octet-stream")


@api_router.post("/uploads/image")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    content_type = (file.content_type or "").lower()
    if not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Only images allowed")
    contents = await file.read()
    max_size = 10 * 1024 * 1024
    if len(contents) > max_size:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")
    ext = (file.filename or "img").split(".")[-1][:8] if "." in (file.filename or "") else "bin"
    path = f"{APP_NAME}/uploads/{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    try:
        result = put_object(path, contents, content_type)
    except Exception as e:
        logging.exception("Upload failed")
        raise HTTPException(status_code=500, detail=f"Upload failed: {e}")
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    await db.files.insert_one({
        "file_id": file_id,
        "user_id": user["user_id"],
        "storage_path": result["path"],
        "original_filename": file.filename,
        "content_type": content_type,
        "size": result.get("size", len(contents)),
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc),
    })
    return {"file_id": file_id, "url": f"/api/files/{file_id}", "size": len(contents), "content_type": content_type}


@api_router.get("/files/{file_id}")
async def download_file(file_id: str, user: dict = Depends(get_current_user)):
    rec = await db.files.find_one({"file_id": file_id, "user_id": user["user_id"], "is_deleted": False})
    if not rec:
        raise HTTPException(status_code=404, detail="File not found")
    try:
        data, ctype = get_object(rec["storage_path"])
    except Exception as e:
        logging.exception("File fetch failed")
        raise HTTPException(status_code=500, detail=f"Fetch failed: {e}")
    return Response(content=data, media_type=rec.get("content_type") or ctype)


# ---- Link preview (OpenGraph)
_link_cache: dict[str, tuple[float, dict]] = {}
_LINK_TTL = 24 * 60 * 60  # 1 day
_CACHE_MAX_ENTRIES = 500


def _cache_trim(cache: dict, max_entries: int = _CACHE_MAX_ENTRIES) -> None:
    if len(cache) > max_entries:
        # drop oldest ~10% by timestamp
        drop = sorted(cache.items(), key=lambda kv: kv[1][0])[: max(1, max_entries // 10)]
        for k, _ in drop:
            cache.pop(k, None)


def _pick_meta(soup, prop: str) -> Optional[str]:
    tag = soup.find("meta", attrs={"property": prop}) or soup.find("meta", attrs={"name": prop})
    if tag and tag.get("content"):
        return tag["content"].strip()
    return None


@api_router.get("/link-preview")
async def link_preview(url: str, user: dict = Depends(get_current_user)):
    if not url.startswith(("http://", "https://")):
        raise HTTPException(400, "Invalid URL")
    now = datetime.now(timezone.utc).timestamp()
    cached = _link_cache.get(url)
    if cached and now - cached[0] < _LINK_TTL:
        return cached[1]
    try:
        async with httpx.AsyncClient(timeout=10, follow_redirects=True, headers={
            "User-Agent": "Mozilla/5.0 (compatible; InkwellNotes/1.0)",
            "Accept": "text/html,application/xhtml+xml",
        }) as http:
            r = await http.get(url)
        if r.status_code >= 400:
            # Graceful fallback so the client always gets a usable shape
            result = {"url": url, "title": url, "description": None, "image": None, "site_name": None}
            _link_cache[url] = (now, result)
            return result
        html = r.text[:200_000]
        soup = BeautifulSoup(html, "lxml")
        title = _pick_meta(soup, "og:title") or (soup.title.string.strip() if soup.title and soup.title.string else url)
        desc = _pick_meta(soup, "og:description") or _pick_meta(soup, "description")
        image = _pick_meta(soup, "og:image")
        site = _pick_meta(soup, "og:site_name")
        result = {
            "url": url,
            "title": title[:300] if title else url,
            "description": (desc or "")[:500] or None,
            "image": image,
            "site_name": site,
        }
        _link_cache[url] = (now, result)
        _cache_trim(_link_cache)
        return result
    except HTTPException:
        raise
    except Exception as e:
        logging.warning("Link preview failed for %s: %s", url, e)
        return {"url": url, "title": url, "description": None, "image": None, "site_name": None}


# ---- Reminders
@api_router.get("/reminders/upcoming")
async def upcoming_reminders(within_hours: int = 24 * 30, user: dict = Depends(get_current_user)):
    now = datetime.now(timezone.utc)
    until = now + timedelta(hours=within_hours)
    cursor = db.reminders.find(
        {"user_id": user["user_id"], "at": {"$gte": now, "$lte": until}, "fired": False},
        {"_id": 0},
    ).sort("at", 1)
    items = await cursor.to_list(200)
    for it in items:
        at = it.get("at")
        if isinstance(at, datetime):
            it["at"] = at.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    return items


@api_router.post("/reminders/{reminder_id}/fire")
async def mark_reminder_fired(reminder_id: str, user: dict = Depends(get_current_user)):
    res = await db.reminders.update_one(
        {"reminder_id": reminder_id, "user_id": user["user_id"]},
        {"$set": {"fired": True, "fired_at": datetime.now(timezone.utc)}},
    )
    if res.matched_count == 0:
        raise HTTPException(404, "Not found")
    return {"ok": True}


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.notes.create_index([("user_id", 1), ("date", 1)])
    await db.notes.create_index("note_id", unique=True)
    await db.tags.create_index([("user_id", 1), ("name", 1)], unique=True)
    await db.people.create_index([("user_id", 1), ("name", 1)], unique=True)
    await db.locations.create_index("location_id", unique=True)
    await db.user_sessions.create_index("session_token", unique=True)
    await db.reminders.create_index([("user_id", 1), ("at", 1)])
    await db.reminders.create_index("reminder_id", unique=True)
    await db.files.create_index("file_id", unique=True)

    # Init object storage session key (safe to fail — uploads will just error)
    try:
        init_storage()
        logging.info("Storage initialized")
    except Exception as e:
        logging.warning("Storage init failed: %s", e)

    # seed admin
    admin_email = os.environ.get("ADMIN_EMAIL", "admin@inkwell.app").lower()
    admin_password = os.environ.get("ADMIN_PASSWORD", "admin12345")
    existing = await db.users.find_one({"email": admin_email})
    if not existing:
        await db.users.insert_one(
            {
                "user_id": f"user_{uuid.uuid4().hex[:12]}",
                "email": admin_email,
                "name": "Admin",
                "password_hash": hash_password(admin_password),
                "picture": None,
                "auth_provider": "email",
                "created_at": datetime.now(timezone.utc),
            }
        )


@app.on_event("shutdown")
async def shutdown():
    client.close()


# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_origin_regex=".*",
)

app.include_router(api_router)

logging.basicConfig(level=logging.INFO)
