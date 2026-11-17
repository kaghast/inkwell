"""Shared fixtures for Inkwell backend integration tests.

The app only supports Google sign-in, which cannot be automated. Tests therefore
create users + sessions directly in MongoDB (same format as the real OAuth
callback) and call the running API with that session cookie.

Env:
  INKWELL_API_URL  default http://localhost:8001
  MONGO_URL        default mongodb://localhost:27017
  DB_NAME          default inkwell
"""
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timedelta, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ.get("INKWELL_API_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"
SESSION_COOKIE = "inkwell_session"

_mongo = MongoClient(os.environ.get("MONGO_URL", "mongodb://localhost:27017"))
_db = _mongo[os.environ.get("DB_NAME", "inkwell")]


def make_session(email: str) -> requests.Session:
    """Return a requests.Session authenticated as `email` (user is created if missing)."""
    now = datetime.now(timezone.utc)
    user = _db.users.find_one({"email": email})
    if not user:
        user = {
            "user_id": f"user_{uuid.uuid4().hex[:12]}",
            "email": email,
            "google_sub": f"test-{uuid.uuid4().hex}",
            "name": email.split("@")[0],
            "picture": None,
            "auth_provider": "google",
            "created_at": now,
        }
        _db.users.insert_one(user)
    token = secrets.token_urlsafe(32)
    _db.sessions.insert_one({
        "token_hash": hashlib.sha256(token.encode()).hexdigest(),
        "user_id": user["user_id"],
        "created_at": now,
        "renewed_at": now,
        "expires_at": now + timedelta(days=1),
        "user_agent": "pytest",
    })
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    s.cookies.set(SESSION_COOKIE, token)
    return s


@pytest.fixture(scope="module")
def user_session():
    return make_session("test@inkwell.test")


@pytest.fixture(scope="module")
def admin_session():
    """A second, unrelated user (used for cross-user isolation checks)."""
    return make_session("other@inkwell.test")
