"""Google OAuth 2.0 / OpenID Connect + Calendar helpers (no DB access here).

Flow: Authorization Code + PKCE, server side. Tokens never reach the browser.
Refresh tokens are encrypted at rest with a key derived from SECRET_KEY.
"""
from __future__ import annotations

import base64
import hashlib
import os
import secrets
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet, InvalidToken

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
REVOKE_URL = "https://oauth2.googleapis.com/revoke"
CALENDAR_API = "https://www.googleapis.com/calendar/v3"

LOGIN_SCOPES = ["openid", "email", "profile"]
CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly"


class GoogleAuthError(Exception):
    """Raised when Google rejects a request (e.g. revoked refresh token)."""

    def __init__(self, message: str, revoked: bool = False):
        super().__init__(message)
        self.revoked = revoked


@dataclass
class GoogleConfig:
    client_id: str
    client_secret: str
    redirect_uri: str

    @classmethod
    def from_env(cls) -> "GoogleConfig":
        app_url = os.environ.get("APP_URL", "").rstrip("/")
        redirect = os.environ.get("OAUTH_REDIRECT_URI") or f"{app_url}/api/auth/google/callback"
        return cls(
            client_id=os.environ.get("GOOGLE_CLIENT_ID", ""),
            client_secret=os.environ.get("GOOGLE_CLIENT_SECRET", ""),
            redirect_uri=redirect,
        )

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret and self.redirect_uri.startswith("http"))


# ---------------------------------------------------------------------------
# Encryption for refresh tokens at rest
# ---------------------------------------------------------------------------
def _fernet() -> Fernet:
    secret = os.environ["SECRET_KEY"].encode("utf-8")
    key = base64.urlsafe_b64encode(hashlib.sha256(b"inkwell-token-enc:" + secret).digest())
    return Fernet(key)


def encrypt(value: str) -> str:
    return _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt(value: str) -> Optional[str]:
    try:
        return _fernet().decrypt(value.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None


# ---------------------------------------------------------------------------
# PKCE
# ---------------------------------------------------------------------------
def new_pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode("ascii")).digest()).rstrip(b"=").decode("ascii")
    return verifier, challenge


def build_auth_url(
    cfg: GoogleConfig,
    *,
    state: str,
    code_challenge: str,
    with_calendar: bool,
    login_hint: Optional[str] = None,
) -> str:
    scopes = list(LOGIN_SCOPES)
    if with_calendar:
        scopes.append(CALENDAR_SCOPE)
    params = {
        "client_id": cfg.client_id,
        "redirect_uri": cfg.redirect_uri,
        "response_type": "code",
        "scope": " ".join(scopes),
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
        # offline → Google issues a refresh token; include_granted_scopes keeps
        # earlier grants (calendar) attached to every later token.
        "access_type": "offline",
        "include_granted_scopes": "true",
    }
    if with_calendar:
        # Force the consent screen so Google always returns a refresh token.
        params["prompt"] = "consent"
    if login_hint:
        params["login_hint"] = login_hint
    return f"{AUTH_URL}?{urlencode(params)}"


async def exchange_code(cfg: GoogleConfig, code: str, code_verifier: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(
            TOKEN_URL,
            data={
                "code": code,
                "client_id": cfg.client_id,
                "client_secret": cfg.client_secret,
                "redirect_uri": cfg.redirect_uri,
                "grant_type": "authorization_code",
                "code_verifier": code_verifier,
            },
        )
    if r.status_code != 200:
        raise GoogleAuthError(f"token exchange failed: {r.status_code} {r.text[:200]}")
    return r.json()


async def refresh_access_token(cfg: GoogleConfig, refresh_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.post(
            TOKEN_URL,
            data={
                "client_id": cfg.client_id,
                "client_secret": cfg.client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token",
            },
        )
    if r.status_code != 200:
        err = ""
        try:
            err = r.json().get("error", "")
        except ValueError:
            pass
        raise GoogleAuthError(f"refresh failed: {r.status_code} {err}", revoked=(err == "invalid_grant"))
    return r.json()


async def fetch_userinfo(access_token: str) -> dict:
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(USERINFO_URL, headers={"Authorization": f"Bearer {access_token}"})
    if r.status_code != 200:
        raise GoogleAuthError(f"userinfo failed: {r.status_code}")
    return r.json()


async def revoke_token(token: str) -> None:
    try:
        async with httpx.AsyncClient(timeout=10) as http:
            await http.post(REVOKE_URL, data={"token": token})
    except httpx.HTTPError:
        pass  # best effort


async def list_calendar_events(access_token: str, time_min: str, time_max: str, max_results: int = 250) -> list[dict]:
    params = {
        "timeMin": time_min,
        "timeMax": time_max,
        "singleEvents": "true",
        "orderBy": "startTime",
        "maxResults": str(max_results),
    }
    async with httpx.AsyncClient(timeout=15) as http:
        r = await http.get(
            f"{CALENDAR_API}/calendars/primary/events",
            params=params,
            headers={"Authorization": f"Bearer {access_token}"},
        )
    if r.status_code == 401:
        raise GoogleAuthError("calendar unauthorized")
    if r.status_code == 403:
        raise GoogleAuthError("calendar forbidden", revoked=True)
    if r.status_code != 200:
        raise GoogleAuthError(f"calendar error: {r.status_code} {r.text[:200]}")
    return r.json().get("items", []) or []
