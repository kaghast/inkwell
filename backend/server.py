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
from datetime import datetime, timezone, timedelta
from typing import List, Optional, Literal

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, status, Query
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
        "created_at": now,
        "updated_at": now,
    }
    await db.notes.insert_one(doc)
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
    user: dict = Depends(get_current_user),
):
    qf: dict = {"user_id": user["user_id"]}
    if date:
        qf["date"] = date

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
    note = await db.notes.find_one({"note_id": note_id}, {"_id": 0})
    return note


@api_router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user: dict = Depends(get_current_user)):
    res = await db.notes.delete_one({"note_id": note_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
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
