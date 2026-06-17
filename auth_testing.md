# Inkwell — Auth Testing Playbook

## Endpoints
- POST /api/auth/register  body: { email, password, name? } → sets httpOnly cookies, returns UserOut
- POST /api/auth/login     body: { email, password }       → sets httpOnly cookies, returns UserOut
- POST /api/auth/logout                                    → clears cookies
- GET  /api/auth/me                                        → returns UserOut (uses cookies or Bearer)
- POST /api/auth/google/session  header X-Session-ID: <id> → exchanges Emergent session_id

Cookies: access_token (1 day) + refresh_token (7 days); secure, httpOnly, samesite=none.
Google login additionally sets session_token cookie.

## Curl smoke test
```bash
API=https://markdown-memo.preview.emergentagent.com/api
curl -c /tmp/c.txt -X POST $API/auth/login -H "Content-Type: application/json" \
  -d '{"email":"test@inkwell.app","password":"test12345"}'
curl -b /tmp/c.txt $API/auth/me
curl -b /tmp/c.txt -X POST $API/notes -H "Content-Type: application/json" \
  -d '{"content":"Bir not #etiket @kişi","title":"Test"}'
```

## Frontend
- Login page: /login (data-testid login-email-input, login-password-input, login-submit-btn, google-login-btn, register-name-input, register-email-input, register-password-input, register-submit-btn, tab-login, tab-register)
- Dashboard: /  (auto redirects to /login if not authenticated)
- After login: cookies set; AuthContext checks /api/auth/me on mount; user state populated.

## Test credentials
admin@inkwell.app / admin12345
test@inkwell.app / test12345
