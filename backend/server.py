from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import re
import uuid
import asyncio
import hashlib
import logging
import secrets
import unicodedata
import httpx
from bs4 import BeautifulSoup
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from urllib.parse import urlencode

from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Response, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse, FileResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, ConfigDict

import google_api
from google_api import GoogleAuthError, GoogleConfig, CALENDAR_SCOPE


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
def _env_bool(name: str, default: bool) -> bool:
    v = os.environ.get(name)
    if v is None or v == "":
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


if not os.environ.get("SECRET_KEY"):
    raise RuntimeError("SECRET_KEY must be set (e.g. `openssl rand -hex 32`)")

APP_URL = os.environ.get("APP_URL", "").rstrip("/")
GOOGLE = GoogleConfig.from_env()

SESSION_COOKIE = "inkwell_session"
OAUTH_STATE_COOKIE = "inkwell_oauth_state"
# Browsers cap cookie lifetime at 400 days; the session slides forward on use,
# so an active user never has to sign in again.
SESSION_DAYS = min(int(os.environ.get("SESSION_DAYS", "400")), 400)
SESSION_RENEW_AFTER = timedelta(hours=12)
COOKIE_SECURE = _env_bool("COOKIE_SECURE", True)
COOKIE_SAMESITE = (os.environ.get("COOKIE_SAMESITE") or "lax").lower()
if COOKIE_SAMESITE == "none":
    COOKIE_SECURE = True

mongo_url = os.environ["MONGO_URL"]
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ["DB_NAME"]]


# ---------------------------------------------------------------------------
# Session helpers (opaque random token in cookie, SHA-256 hash in DB)
# ---------------------------------------------------------------------------
def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _set_session_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite=COOKIE_SAMESITE,
        max_age=SESSION_DAYS * 24 * 60 * 60,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    # Legacy cookie names are cleared too so old browsers end up clean.
    for name in (SESSION_COOKIE, "access_token", "refresh_token", "session_token"):
        response.delete_cookie(key=name, path="/", secure=COOKIE_SECURE, samesite=COOKIE_SAMESITE, httponly=True)


async def create_session(user_id: str, request: Request) -> str:
    token = secrets.token_urlsafe(32)
    now = datetime.now(timezone.utc)
    await db.sessions.insert_one({
        "token_hash": _hash_token(token),
        "user_id": user_id,
        "created_at": now,
        "renewed_at": now,
        "expires_at": now + timedelta(days=SESSION_DAYS),
        "user_agent": (request.headers.get("User-Agent") or "")[:300],
    })
    return token


def _aware(dt):
    if isinstance(dt, datetime) and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


async def _user_from_session(request: Request, response: Optional[Response]) -> Optional[dict]:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
    if not token:
        return None
    sess = await db.sessions.find_one({"token_hash": _hash_token(token)})
    if not sess:
        return None
    now = datetime.now(timezone.utc)
    if _aware(sess["expires_at"]) < now:
        return None
    user = await db.users.find_one({"user_id": sess["user_id"]}, {"_id": 0, "password_hash": 0})
    if not user:
        return None
    # Sliding expiration: push expiry forward (at most twice a day).
    if response is not None and now - _aware(sess.get("renewed_at") or sess["created_at"]) > SESSION_RENEW_AFTER:
        await db.sessions.update_one(
            {"_id": sess["_id"]},
            {"$set": {"renewed_at": now, "expires_at": now + timedelta(days=SESSION_DAYS)}},
        )
        if request.cookies.get(SESSION_COOKIE):
            _set_session_cookie(response, token)
    return user


async def get_current_user(request: Request, response: Response) -> dict:
    user = await _user_from_session(request, response)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user


def _safe_next(next_path: Optional[str]) -> str:
    if not next_path or not next_path.startswith("/") or next_path.startswith("//") or "\\" in next_path:
        return "/"
    return next_path


def _app_redirect(path: str, **query) -> RedirectResponse:
    q = {k: v for k, v in query.items() if v is not None}
    url = f"{APP_URL}{path}"
    if q:
        url += ("&" if "?" in url else "?") + urlencode(q)
    return RedirectResponse(url, status_code=302)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class UserOut(BaseModel):
    model_config = ConfigDict(extra="ignore")
    user_id: str
    email: str
    name: Optional[str] = None
    picture: Optional[str] = None
    auth_provider: str = "google"
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
    area_ids: Optional[List[str]] = None  # None on update → keep existing areas
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
    area_ids: List[str] = []
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
# Auth endpoints — Google is the only sign-in method
# ---------------------------------------------------------------------------
@api_router.get("/auth/google/login")
async def google_login(request: Request, next: str = "/", calendar: bool = False):
    """Start Google sign-in. `calendar=1` additionally asks for Calendar access
    (offline, so it is granted once and kept)."""
    if not GOOGLE.configured:
        raise HTTPException(status_code=500, detail="Google OAuth is not configured")
    current = await _user_from_session(request, None)
    mode = "connect" if (calendar and current) else "login"
    state = secrets.token_urlsafe(32)
    verifier, challenge = google_api.new_pkce_pair()
    await db.oauth_states.insert_one({
        "state": state,
        "code_verifier": verifier,
        "next": _safe_next(next),
        "mode": mode,
        "user_id": current["user_id"] if current else None,
        "created_at": datetime.now(timezone.utc),
    })
    url = google_api.build_auth_url(
        GOOGLE,
        state=state,
        code_challenge=challenge,
        with_calendar=calendar,
        login_hint=current["email"] if current else None,
    )
    resp = RedirectResponse(url, status_code=302)
    resp.set_cookie(
        key=OAUTH_STATE_COOKIE, value=state, max_age=15 * 60,
        httponly=True, secure=COOKIE_SECURE, samesite="lax", path="/api/auth/google",
    )
    return resp


async def _upsert_google_user(info: dict) -> str:
    sub = info["sub"]
    email = (info.get("email") or "").lower().strip()
    now = datetime.now(timezone.utc)
    profile = {"name": info.get("name") or email.split("@")[0], "picture": info.get("picture")}
    user = await db.users.find_one({"google_sub": sub})
    if not user:
        # Link a pre-existing account (e.g. former e-mail/password user) by verified e-mail.
        user = await db.users.find_one({"email": email})
    if user:
        await db.users.update_one(
            {"user_id": user["user_id"]},
            {
                "$set": {**profile, "email": email, "google_sub": sub, "auth_provider": "google", "last_login_at": now},
                "$unset": {"password_hash": ""},
            },
        )
        return user["user_id"]
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    await db.users.insert_one({
        "user_id": user_id,
        "email": email,
        "google_sub": sub,
        "auth_provider": "google",
        "created_at": now,
        "last_login_at": now,
        **profile,
    })
    return user_id


async def _store_google_tokens(user_id: str, tokens: dict) -> set:
    granted = set((tokens.get("scope") or "").split())
    existing = await db.google_credentials.find_one({"user_id": user_id})
    now = datetime.now(timezone.utc)
    refresh = tokens.get("refresh_token")
    if refresh:
        await db.google_credentials.update_one(
            {"user_id": user_id},
            {"$set": {
                "refresh_token_enc": google_api.encrypt(refresh),
                "scopes": sorted(granted),
                "updated_at": now,
            }, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        _access_cache.pop(user_id, None)
    elif existing:
        # No new refresh token (normal for repeat sign-ins): keep the stored one,
        # but remember any newly granted scopes.
        scopes = set(existing.get("scopes") or []) | granted
        await db.google_credentials.update_one(
            {"user_id": user_id}, {"$set": {"scopes": sorted(scopes), "updated_at": now}},
        )
    return granted


@api_router.get("/auth/google/callback")
async def google_callback(
    request: Request,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    cookie_state = request.cookies.get(OAUTH_STATE_COOKIE)
    rec = await db.oauth_states.find_one_and_delete({"state": state}) if state else None
    if error:
        target = rec["next"] if rec and rec.get("mode") == "connect" else "/login"
        return _app_redirect(target, auth_error=error)
    if not code or not state or not cookie_state or not secrets.compare_digest(state, cookie_state) or not rec:
        return _app_redirect("/login", auth_error="invalid_state")
    try:
        tokens = await google_api.exchange_code(GOOGLE, code, rec["code_verifier"])
        info = await google_api.fetch_userinfo(tokens["access_token"])
    except (GoogleAuthError, httpx.HTTPError, KeyError) as e:
        logging.warning("Google OAuth callback failed: %s", e)
        return _app_redirect("/login", auth_error="google_failed")
    if not info.get("sub") or not info.get("email") or not info.get("email_verified"):
        return _app_redirect("/login", auth_error="email_not_verified")

    if rec.get("mode") == "connect":
        owner = await db.users.find_one({"user_id": rec["user_id"]})
        if not owner or (owner.get("google_sub") and owner["google_sub"] != info["sub"]):
            return _app_redirect(rec["next"], calendar="account_mismatch")

    user_id = await _upsert_google_user(info)
    granted = await _store_google_tokens(user_id, tokens)

    query = {}
    if rec.get("mode") == "connect" or CALENDAR_SCOPE in granted:
        query["calendar"] = "connected" if CALENDAR_SCOPE in granted else "denied"
    resp = _app_redirect(rec["next"], **query)

    # (Re)issue a long-lived session unless the browser already has one for this user.
    current = await _user_from_session(request, None)
    if not current or current["user_id"] != user_id:
        _set_session_cookie(resp, await create_session(user_id, request))
    resp.delete_cookie(OAUTH_STATE_COOKIE, path="/api/auth/google")
    return resp


@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        await db.sessions.delete_one({"token_hash": _hash_token(token)})
    _clear_auth_cookies(response)
    return {"ok": True}


@api_router.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return user


# ---------------------------------------------------------------------------
# Google Calendar — access is granted once and kept via the stored refresh token
# ---------------------------------------------------------------------------
_access_cache: dict[str, tuple[str, float]] = {}


async def _calendar_access_token(user_id: str) -> str:
    creds = await db.google_credentials.find_one({"user_id": user_id})
    if not creds or CALENDAR_SCOPE not in (creds.get("scopes") or []):
        raise HTTPException(status_code=409, detail="calendar_not_connected")
    now = datetime.now(timezone.utc).timestamp()
    cached = _access_cache.get(user_id)
    if cached and cached[1] - 60 > now:
        return cached[0]
    refresh = google_api.decrypt(creds.get("refresh_token_enc") or "")
    if not refresh:
        await db.google_credentials.delete_one({"user_id": user_id})
        raise HTTPException(status_code=409, detail="calendar_not_connected")
    try:
        tok = await google_api.refresh_access_token(GOOGLE, refresh)
    except GoogleAuthError as e:
        if e.revoked:
            # User revoked access in their Google account — forget the token.
            await db.google_credentials.delete_one({"user_id": user_id})
            raise HTTPException(status_code=409, detail="calendar_not_connected")
        raise HTTPException(status_code=502, detail="Google token refresh failed")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Google token refresh failed")
    if tok.get("scope") and CALENDAR_SCOPE not in tok["scope"].split():
        await db.google_credentials.update_one(
            {"user_id": user_id}, {"$set": {"scopes": sorted(set(tok["scope"].split()))}},
        )
        raise HTTPException(status_code=409, detail="calendar_not_connected")
    _access_cache[user_id] = (tok["access_token"], now + int(tok.get("expires_in", 3600)))
    return tok["access_token"]


@api_router.get("/google/calendar/status")
async def calendar_status(user: dict = Depends(get_current_user)):
    creds = await db.google_credentials.find_one({"user_id": user["user_id"]}, {"_id": 0, "scopes": 1, "updated_at": 1})
    connected = bool(creds and CALENDAR_SCOPE in (creds.get("scopes") or []))
    return {"connected": connected, "connected_at": creds.get("updated_at") if connected else None}


@api_router.get("/google/calendar/events")
async def calendar_events(time_min: str, time_max: str, user: dict = Depends(get_current_user)):
    """List events of the user's primary Google Calendar in [time_min, time_max) (RFC3339)."""
    for v in (time_min, time_max):
        try:
            datetime.fromisoformat(v.replace("Z", "+00:00"))
        except ValueError:
            raise HTTPException(400, "time_min/time_max must be RFC3339")
    token = await _calendar_access_token(user["user_id"])
    try:
        items = await google_api.list_calendar_events(token, time_min, time_max)
    except GoogleAuthError as e:
        _access_cache.pop(user["user_id"], None)
        if e.revoked:
            raise HTTPException(status_code=409, detail="calendar_not_connected")
        raise HTTPException(status_code=502, detail="Google Calendar error")
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Google Calendar error")
    out = []
    for ev in items:
        if ev.get("status") == "cancelled":
            continue
        start, end = ev.get("start") or {}, ev.get("end") or {}
        out.append({
            "id": ev.get("id"),
            "summary": ev.get("summary") or "(başlıksız)",
            "start": start.get("dateTime") or start.get("date"),
            "end": end.get("dateTime") or end.get("date"),
            "all_day": "date" in start and "dateTime" not in start,
            "location": ev.get("location"),
            "html_link": ev.get("htmlLink"),
        })
    return out


@api_router.delete("/google/calendar")
async def calendar_disconnect(user: dict = Depends(get_current_user)):
    creds = await db.google_credentials.find_one({"user_id": user["user_id"]})
    if creds:
        refresh = google_api.decrypt(creds.get("refresh_token_enc") or "")
        if refresh:
            await google_api.revoke_token(refresh)
        await db.google_credentials.delete_one({"user_id": user["user_id"]})
    _access_cache.pop(user["user_id"], None)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Notes / Tags / People / Locations
# ---------------------------------------------------------------------------
# ---- #tag / @person parsing (must match frontend/src/lib/names.ts)
# A token starts after whitespace (or at line start) and runs over letters,
# digits, "_" and "-". Code spans / fenced code blocks are never parsed or
# rewritten, so `#include` in a code block is not a tag.
TAG_RE = re.compile(r"(?<!\S)#([\w-]+)", re.UNICODE)
MENTION_RE = re.compile(r"(?<!\S)@([\w-]+)", re.UNICODE)
CODE_RE = re.compile(r"(```[\s\S]*?(?:```|$)|~~~[\s\S]*?(?:~~~|$)|`[^`\n]*`)")


TURKISH_CHARS = set("çğışöüÇĞŞÖÜİı")


def normalize_name(raw: str) -> str:
    """Canonical tag/person name: NFC + lowercase. Words containing Turkish-only
    letters use Turkish casing (I→ı, İ→i) so #ÇALIŞMA == #çalışma, while
    plain-ASCII words keep the usual rule (#IBM → ibm)."""
    s = unicodedata.normalize("NFC", raw or "").strip()
    if any(ch in TURKISH_CHARS for ch in s):
        s = s.replace("I", "ı")
    return s.replace("İ", "i").lower().replace("i̇", "i")


def _text_segments(content: str):
    """Yield (is_code, segment) pieces of markdown content."""
    pos = 0
    for m in CODE_RE.finditer(content or ""):
        if m.start() > pos:
            yield False, content[pos:m.start()]
        yield True, m.group(0)
        pos = m.end()
    if pos < len(content or ""):
        yield False, content[pos:]


def _extract(content: str, rx: re.Pattern) -> List[str]:
    found: List[str] = []
    for is_code, seg in _text_segments(content):
        if not is_code:
            found.extend(normalize_name(m.group(1)) for m in rx.finditer(seg))
    return list(dict.fromkeys(n for n in found if n))


def extract_tags(content: str) -> List[str]:
    return _extract(content, TAG_RE)


def extract_people(content: str) -> List[str]:
    return _extract(content, MENTION_RE)


def _rewrite_tokens(content: str, rx: re.Pattern, sigil: str, old: str, new: Optional[str]) -> str:
    """Rename (new=str) or remove (new=None) every `<sigil>old` token outside code."""
    def fix_segment(seg: str) -> str:
        out, pos = [], 0
        for m in rx.finditer(seg):
            if normalize_name(m.group(1)) != old:
                continue
            start, end = m.start(), m.end()
            if new is not None:
                out.append(seg[pos:start] + sigil + new)
                pos = end
                continue
            # Removal: also drop one adjacent space so no double spaces remain.
            if end < len(seg) and seg[end] in " \t":
                end += 1
            elif start > 0 and seg[start - 1] in " \t":
                start -= 1
            out.append(seg[pos:start])
            pos = end
        out.append(seg[pos:])
        return "".join(out)

    return "".join(seg if is_code else fix_segment(seg) for is_code, seg in _text_segments(content))


async def sync_entities(user_id: str) -> None:
    """Make the tags/people collections mirror exactly what notes reference."""
    now = datetime.now(timezone.utc)
    for coll, field, id_key, prefix in (
        (db.tags, "tags", "tag_id", "tag"),
        (db.people, "people", "person_id", "person"),
    ):
        used = {n for n in await db.notes.distinct(field, {"user_id": user_id}) if n}
        existing = {d["name"] for d in await coll.find({"user_id": user_id}, {"name": 1}).to_list(None)}
        missing = used - existing
        if missing:
            await coll.insert_many([
                {id_key: f"{prefix}_{uuid.uuid4().hex[:12]}", "user_id": user_id, "name": n, "created_at": now}
                for n in sorted(missing)
            ])
        orphans = existing - used
        if orphans:
            await coll.delete_many({"user_id": user_id, "name": {"$in": list(orphans)}})


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


async def _valid_area_ids(user_id: str, area_ids: Optional[List[str]]) -> List[str]:
    if not area_ids:
        return []
    wanted = list(dict.fromkeys(a for a in area_ids if a))
    found = await db.areas.distinct("area_id", {"user_id": user_id, "area_id": {"$in": wanted}})
    return [a for a in wanted if a in set(found)]


def _in_or_all(values: List[str], op: str = "$all"):
    return values[0] if len(values) == 1 else {op: values}


# ---- Notes
@api_router.post("/notes", response_model=NoteOut)
async def create_note(payload: NoteIn, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    content = payload.content or ""
    note_id = f"note_{uuid.uuid4().hex[:12]}"
    now = datetime.now(timezone.utc)
    doc = {
        "note_id": note_id,
        "user_id": user_id,
        "title": (payload.title or "").strip(),
        "content": content,
        "date": payload.date or today_iso(),
        "tags": extract_tags(content),
        "people": extract_people(content),
        "area_ids": await _valid_area_ids(user_id, payload.area_ids),
        "location_id": payload.location_id,
        "pinned": False,
        "created_at": now,
        "updated_at": now,
    }
    await db.notes.insert_one(doc)
    await sync_entities(user_id)
    await sync_reminders(user_id, note_id, content)
    doc.pop("_id", None)
    return doc


@api_router.get("/notes", response_model=List[NoteOut])
async def list_notes(
    date: Optional[str] = None,
    tag: Optional[str] = None,
    person: Optional[str] = None,
    location_id: Optional[str] = None,
    area_id: Optional[str] = None,
    tags: List[str] = Query(default_factory=list),
    people: List[str] = Query(default_factory=list),
    location_ids: List[str] = Query(default_factory=list),
    area_ids: List[str] = Query(default_factory=list),
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

    all_tags = sorted({normalize_name(t) for t in tags + ([tag] if tag else [])} - {""})
    if all_tags:
        qf["tags"] = _in_or_all(all_tags)
    all_people = sorted({normalize_name(p) for p in people + ([person] if person else [])} - {""})
    if all_people:
        qf["people"] = _in_or_all(all_people)
    all_locs = sorted(set(location_ids) | ({location_id} if location_id else set()))
    if all_locs:
        qf["location_id"] = _in_or_all(all_locs, "$in")
    all_areas = sorted(set(area_ids) | ({area_id} if area_id else set()))
    if all_areas:
        qf["area_ids"] = _in_or_all(all_areas)

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
    update = {
        "title": (payload.title or "").strip(),
        "content": content,
        "date": payload.date or existing["date"],
        "tags": extract_tags(content),
        "people": extract_people(content),
        "location_id": payload.location_id,
        "updated_at": datetime.now(timezone.utc),
    }
    if payload.area_ids is not None:  # omitted → keep current areas
        update["area_ids"] = await _valid_area_ids(user_id, payload.area_ids)
    if payload.created_at:
        try:
            iso = payload.created_at.replace("Z", "+00:00")
            update["created_at"] = datetime.fromisoformat(iso)
        except ValueError:
            pass
    await db.notes.update_one({"note_id": note_id, "user_id": user_id}, {"$set": update})
    await sync_entities(user_id)
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


class SplitIn(BaseModel):
    at_line: int  # content lines [0, at_line) stay; [at_line, ...) go to the new note


def _fence_open_before(lines: List[str], at_line: int) -> bool:
    """True if a ``` fence opened before `at_line` is still unclosed there."""
    inside = False
    for line in lines[:at_line]:
        if line.strip().startswith("```"):
            inside = not inside
    return inside


@api_router.post("/notes/{note_id}/split", response_model=List[NoteOut])
async def split_note(note_id: str, payload: SplitIn, user: dict = Depends(get_current_user)):
    """Cut a note in two at a line boundary. Returns [first_part, second_part]."""
    user_id = user["user_id"]
    note = await db.notes.find_one({"note_id": note_id, "user_id": user_id}, {"_id": 0})
    if not note:
        raise HTTPException(404, "Not found")
    lines = (note.get("content") or "").replace("\r\n", "\n").split("\n")
    at = payload.at_line
    if at <= 0 or at >= len(lines):
        raise HTTPException(400, "Geçersiz kesme noktası")
    if _fence_open_before(lines, at):
        raise HTTPException(400, "Kod/hatırlatma bloğunun içinden kesilemez")
    first = "\n".join(lines[:at]).strip("\n")
    second = "\n".join(lines[at:]).strip("\n")
    if not first.strip() or not second.strip():
        raise HTTPException(400, "Her iki parça da dolu olmalı")

    now = datetime.now(timezone.utc)
    await db.notes.update_one(
        {"note_id": note_id, "user_id": user_id},
        {"$set": {
            "content": first,
            "tags": extract_tags(first),
            "people": extract_people(first),
            "updated_at": now,
        }},
    )
    created = _aware(note["created_at"])
    new_id = f"note_{uuid.uuid4().hex[:12]}"
    new_doc = {
        "note_id": new_id,
        "user_id": user_id,
        "title": "",
        "content": second,
        "date": note["date"],
        "tags": extract_tags(second),
        "people": extract_people(second),
        "area_ids": list(note.get("area_ids") or []),
        "location_id": note.get("location_id"),
        "pinned": False,
        # one second earlier → listed right below the first part (newest-first order)
        "created_at": created - timedelta(seconds=1),
        "updated_at": now,
    }
    await db.notes.insert_one(new_doc)
    await sync_entities(user_id)
    await sync_reminders(user_id, note_id, first)
    await sync_reminders(user_id, new_id, second)
    new_doc.pop("_id", None)
    updated = await db.notes.find_one({"note_id": note_id}, {"_id": 0})
    return [updated, new_doc]


@api_router.delete("/notes/{note_id}")
async def delete_note(note_id: str, user: dict = Depends(get_current_user)):
    res = await db.notes.delete_one({"note_id": note_id, "user_id": user["user_id"]})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    await db.reminders.delete_many({"note_id": note_id, "user_id": user["user_id"]})
    await sync_entities(user["user_id"])
    return {"ok": True}


# ---- Tags & People share the same rename/delete logic
ENTITY_KINDS = {
    "tag": {"coll": "tags", "id": "tag_id", "field": "tags", "rx": TAG_RE, "sigil": "#", "label": "Tag"},
    "person": {"coll": "people", "id": "person_id", "field": "people", "rx": MENTION_RE, "sigil": "@", "label": "Person"},
}


async def _list_entities(kind: str, user_id: str, q: Optional[str]):
    k = ENTITY_KINDS[kind]
    query: dict = {"user_id": user_id}
    if q:
        query["name"] = {"$regex": f"^{re.escape(normalize_name(q))}"}
    return await db[k["coll"]].find(query, {"_id": 0}).sort("name", 1).to_list(500)


async def _rename_entity(kind: str, entity_id: str, raw_name: str, user_id: str):
    k = ENTITY_KINDS[kind]
    coll = db[k["coll"]]
    new_name = normalize_name(raw_name.lstrip(k["sigil"]))
    if not new_name or not re.fullmatch(r"[\w-]+", new_name):
        raise HTTPException(400, "Name may only contain letters, digits, '_' and '-'")
    doc = await coll.find_one({k["id"]: entity_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    old_name = doc["name"]
    if old_name == new_name:
        return doc
    if await coll.find_one({"user_id": user_id, "name": new_name}):
        raise HTTPException(400, f"{k['label']} name already exists")
    await coll.update_one({k["id"]: entity_id}, {"$set": {"name": new_name}})
    now = datetime.now(timezone.utc)
    async for n in db.notes.find({"user_id": user_id, k["field"]: old_name}):
        content = _rewrite_tokens(n["content"], k["rx"], k["sigil"], old_name, new_name)
        await db.notes.update_one(
            {"note_id": n["note_id"]},
            {"$set": {"content": content, k["field"]: _extract(content, k["rx"]), "updated_at": now}},
        )
    await sync_entities(user_id)
    doc["name"] = new_name
    return doc


async def _delete_entity(kind: str, entity_id: str, user_id: str):
    """Delete the tag/person AND strip its #token / @token from every note."""
    k = ENTITY_KINDS[kind]
    doc = await db[k["coll"]].find_one({k["id"]: entity_id, "user_id": user_id}, {"_id": 0})
    if not doc:
        raise HTTPException(404, "Not found")
    name = doc["name"]
    now = datetime.now(timezone.utc)
    updated = 0
    async for n in db.notes.find({"user_id": user_id, k["field"]: name}):
        content = _rewrite_tokens(n["content"], k["rx"], k["sigil"], name, None)
        await db.notes.update_one(
            {"note_id": n["note_id"]},
            {"$set": {"content": content, k["field"]: _extract(content, k["rx"]), "updated_at": now}},
        )
        updated += 1
    await db[k["coll"]].delete_one({k["id"]: entity_id})
    await sync_entities(user_id)
    return {"ok": True, "notes_updated": updated}


@api_router.get("/tags")
async def list_tags(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    return await _list_entities("tag", user["user_id"], q)


@api_router.put("/tags/{tag_id}")
async def rename_tag(tag_id: str, payload: RenameIn, user: dict = Depends(get_current_user)):
    return await _rename_entity("tag", tag_id, payload.name, user["user_id"])


@api_router.delete("/tags/{tag_id}")
async def delete_tag(tag_id: str, user: dict = Depends(get_current_user)):
    return await _delete_entity("tag", tag_id, user["user_id"])


@api_router.get("/people")
async def list_people(q: Optional[str] = None, user: dict = Depends(get_current_user)):
    return await _list_entities("person", user["user_id"], q)


@api_router.put("/people/{person_id}")
async def rename_person(person_id: str, payload: RenameIn, user: dict = Depends(get_current_user)):
    return await _rename_entity("person", person_id, payload.name, user["user_id"])


@api_router.delete("/people/{person_id}")
async def delete_person(person_id: str, user: dict = Depends(get_current_user)):
    return await _delete_entity("person", person_id, user["user_id"])


# ---- Personal areas (Ayarlar → Kişisel alanlar)
AREA_COLORS = ["#c2410c", "#0f766e", "#7c3aed", "#b91c1c", "#1d4ed8", "#a16207", "#be185d", "#15803d"]
HEX_COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


class AreaIn(BaseModel):
    name: str
    color: Optional[str] = None
    description: Optional[str] = None


class AreaPatch(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    description: Optional[str] = None
    position: Optional[int] = None


async def _area_counts(user_id: str) -> dict:
    res = await db.notes.aggregate([
        {"$match": {"user_id": user_id, "area_ids.0": {"$exists": True}}},
        {"$unwind": "$area_ids"},
        {"$group": {"_id": "$area_ids", "count": {"$sum": 1}}},
    ]).to_list(None)
    return {r["_id"]: r["count"] for r in res}


async def _list_areas(user_id: str) -> List[dict]:
    areas = await db.areas.find({"user_id": user_id}, {"_id": 0}).sort([("position", 1), ("created_at", 1)]).to_list(200)
    counts = await _area_counts(user_id)
    for a in areas:
        a["note_count"] = counts.get(a["area_id"], 0)
    return areas


def _clean_area_name(name: Optional[str]) -> str:
    n = unicodedata.normalize("NFC", (name or "").strip())
    if not n or len(n) > 60:
        raise HTTPException(400, "Area name must be 1-60 characters")
    return n


async def _ensure_unique_area(user_id: str, name: str, exclude: Optional[str] = None):
    key = normalize_name(name)
    query: dict = {"user_id": user_id, "name_key": key}
    if exclude:
        query["area_id"] = {"$ne": exclude}
    if await db.areas.find_one(query):
        raise HTTPException(400, "Area name already exists")


@api_router.get("/areas")
async def list_areas(user: dict = Depends(get_current_user)):
    return await _list_areas(user["user_id"])


@api_router.post("/areas")
async def create_area(payload: AreaIn, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    name = _clean_area_name(payload.name)
    await _ensure_unique_area(user_id, name)
    count = await db.areas.count_documents({"user_id": user_id})
    if count >= 50:
        raise HTTPException(400, "Too many areas (max 50)")
    color = payload.color if payload.color and HEX_COLOR_RE.match(payload.color) else AREA_COLORS[count % len(AREA_COLORS)]
    doc = {
        "area_id": f"area_{uuid.uuid4().hex[:12]}",
        "user_id": user_id,
        "name": name,
        "name_key": normalize_name(name),
        "color": color,
        "description": (payload.description or "").strip()[:280] or None,
        "position": count,
        "created_at": datetime.now(timezone.utc),
    }
    await db.areas.insert_one(doc)
    doc.pop("_id", None)
    doc["note_count"] = 0
    return doc


@api_router.put("/areas/{area_id}")
async def update_area(area_id: str, payload: AreaPatch, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    area = await db.areas.find_one({"area_id": area_id, "user_id": user_id})
    if not area:
        raise HTTPException(404, "Not found")
    upd: dict = {}
    if payload.name is not None:
        name = _clean_area_name(payload.name)
        await _ensure_unique_area(user_id, name, exclude=area_id)
        upd.update(name=name, name_key=normalize_name(name))
    if payload.color is not None:
        if not HEX_COLOR_RE.match(payload.color):
            raise HTTPException(400, "Color must be #rrggbb")
        upd["color"] = payload.color
    if payload.description is not None:
        upd["description"] = payload.description.strip()[:280] or None
    if payload.position is not None:
        upd["position"] = payload.position
    if upd:
        await db.areas.update_one({"area_id": area_id}, {"$set": upd})
    return next(a for a in await _list_areas(user_id) if a["area_id"] == area_id)


@api_router.delete("/areas/{area_id}")
async def delete_area(area_id: str, user: dict = Depends(get_current_user)):
    user_id = user["user_id"]
    res = await db.areas.delete_one({"area_id": area_id, "user_id": user_id})
    if res.deleted_count == 0:
        raise HTTPException(404, "Not found")
    await db.notes.update_many({"user_id": user_id, "area_ids": area_id}, {"$pull": {"area_ids": area_id}})
    return {"ok": True}


# ---- Graph data
def _snippet(content: str, limit: int = 90) -> str:
    text = "".join(seg for is_code, seg in _text_segments(content) if not is_code)
    text = re.sub(r"[#>*_`\[\]()!-]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit] + ("…" if len(text) > limit else "")


@api_router.get("/graph")
async def graph(area_id: Optional[str] = None, user: dict = Depends(get_current_user)):
    """Areas (with note counts) + lightweight note nodes. With `area_id`, only the
    notes directly linked to that area (its first-degree neighbourhood)."""
    user_id = user["user_id"]
    areas = await _list_areas(user_id)
    qf: dict = {"user_id": user_id}
    if area_id:
        if not any(a["area_id"] == area_id for a in areas):
            raise HTTPException(404, "Area not found")
        qf["area_ids"] = area_id
    notes = await db.notes.find(
        qf, {"_id": 0, "note_id": 1, "title": 1, "content": 1, "date": 1, "area_ids": 1, "tags": 1, "people": 1},
    ).sort("created_at", -1).to_list(2000)
    return {
        "areas": areas,
        "notes": [
            {
                "note_id": n["note_id"],
                "title": n.get("title") or "",
                "snippet": _snippet(n.get("content") or ""),
                "date": n.get("date"),
                "area_ids": n.get("area_ids") or [],
                "tags": n.get("tags") or [],
                "people": n.get("people") or [],
            }
            for n in notes
        ],
    }


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


# ---- File uploads (local disk; mount a volume at UPLOAD_DIR in production)
UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR") or (ROOT_DIR / "uploads")).resolve()
MAX_UPLOAD_BYTES = 10 * 1024 * 1024
# SVG is deliberately excluded: it can carry script and would be served from our origin.
ALLOWED_IMAGE_TYPES = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "image/avif": "avif",
}


def _resolve_upload(rel_path: str) -> Optional[Path]:
    p = (UPLOAD_DIR / rel_path).resolve()
    if UPLOAD_DIR not in p.parents:
        return None
    return p


def _write_file(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


@api_router.post("/uploads/image")
async def upload_image(file: UploadFile = File(...), user: dict = Depends(get_current_user)):
    content_type = (file.content_type or "").lower()
    ext = ALLOWED_IMAGE_TYPES.get(content_type)
    if not ext:
        raise HTTPException(status_code=400, detail="Only PNG, JPEG, GIF, WebP or AVIF images allowed")
    contents = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(contents) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="Image too large (max 10 MB)")
    rel_path = f"{user['user_id']}/{uuid.uuid4().hex}.{ext}"
    target = _resolve_upload(rel_path)
    if target is None:
        raise HTTPException(status_code=400, detail="Invalid path")
    try:
        await asyncio.to_thread(_write_file, target, contents)
    except OSError:
        logging.exception("Upload failed")
        raise HTTPException(status_code=500, detail="Upload failed")
    file_id = f"file_{uuid.uuid4().hex[:12]}"
    await db.files.insert_one({
        "file_id": file_id,
        "user_id": user["user_id"],
        "storage": "local",
        "storage_path": rel_path,
        "original_filename": file.filename,
        "content_type": content_type,
        "size": len(contents),
        "is_deleted": False,
        "created_at": datetime.now(timezone.utc),
    })
    return {"file_id": file_id, "url": f"/api/files/{file_id}", "size": len(contents), "content_type": content_type}


@api_router.get("/files/{file_id}")
async def download_file(file_id: str, user: dict = Depends(get_current_user)):
    rec = await db.files.find_one({"file_id": file_id, "user_id": user["user_id"], "is_deleted": False})
    if not rec or rec.get("storage") != "local":
        raise HTTPException(status_code=404, detail="File not found")
    path = _resolve_upload(rec["storage_path"])
    if path is None or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(
        path,
        media_type=rec.get("content_type") or "application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "private, max-age=86400"},
    )


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
# Data migrations (idempotent, versioned)
# ---------------------------------------------------------------------------
SCHEMA_VERSION = 2


async def migrate() -> None:
    meta = await db.meta.find_one({"_id": "schema"}) or {}
    if meta.get("version", 0) >= SCHEMA_VERSION:
        return
    # v2: re-derive tags/people with the unified parser (code blocks ignored,
    # Turkish-safe lowercase) and rebuild the tags/people collections.
    user_ids = set()
    async for n in db.notes.find({}, {"note_id": 1, "user_id": 1, "content": 1, "area_ids": 1}):
        content = n.get("content") or ""
        upd = {"tags": extract_tags(content), "people": extract_people(content)}
        if "area_ids" not in n:
            upd["area_ids"] = []
        await db.notes.update_one({"_id": n["_id"]}, {"$set": upd})
        user_ids.add(n["user_id"])
    user_ids |= set(await db.tags.distinct("user_id")) | set(await db.people.distinct("user_id"))
    for uid in user_ids:
        # Old docs may hold non-normalized names; rebuild from notes.
        await db.tags.delete_many({"user_id": uid})
        await db.people.delete_many({"user_id": uid})
        await sync_entities(uid)
    await db.meta.update_one({"_id": "schema"}, {"$set": {"version": SCHEMA_VERSION}}, upsert=True)
    logging.info("Migrated data to schema v%s (%d users)", SCHEMA_VERSION, len(user_ids))


# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------
@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("google_sub", unique=True, sparse=True)
    await db.notes.create_index([("user_id", 1), ("date", 1)])
    await db.notes.create_index("note_id", unique=True)
    await db.tags.create_index([("user_id", 1), ("name", 1)], unique=True)
    await db.people.create_index([("user_id", 1), ("name", 1)], unique=True)
    await db.locations.create_index("location_id", unique=True)
    await db.sessions.create_index("token_hash", unique=True)
    await db.sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.oauth_states.create_index("state", unique=True)
    await db.oauth_states.create_index("created_at", expireAfterSeconds=15 * 60)
    await db.google_credentials.create_index("user_id", unique=True)
    await db.reminders.create_index([("user_id", 1), ("at", 1)])
    await db.reminders.create_index("reminder_id", unique=True)
    await db.files.create_index("file_id", unique=True)
    await db.areas.create_index("area_id", unique=True)
    await db.areas.create_index([("user_id", 1), ("name_key", 1)], unique=True)
    await db.notes.create_index([("user_id", 1), ("area_ids", 1)])
    await migrate()
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    if not GOOGLE.configured:
        logging.warning("GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET / APP_URL not set — sign-in will not work")


@app.on_event("shutdown")
async def shutdown():
    client.close()


# CORS — only needed when the frontend is served from a different origin.
_cors_origins = [o.strip().rstrip("/") for o in os.environ.get("CORS_ORIGINS", "").split(",") if o.strip() and o.strip() != "*"]
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        allow_origins=_cors_origins,
    )

app.include_router(api_router)

logging.basicConfig(level=logging.INFO)
