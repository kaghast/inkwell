# Inkwell — Markdown SaaS Notes App (PRD)

## Original Problem Statement (Turkish)
Aşağıdaki özelliklere sahip bir not uygulaması yap. SAS projesi olacak:
- Single sign on ile çalışacak. Google hesabı ve normal eposta ile kayıt olarak giriş yapılabilecek.
- Her notun, içeriği gelişmiş markdown destekli olacak; not yazarken `#` ile etiket, `@` ile kişi eklenebilecek; tarihi/günü ve konumu olacak. Kişi ve etiket sistemden çekilip yazılan harflere göre filtrelenerek dropdown ile gösterilecek.
- Notun konum bilgisi tarayıcı üzerinden direkt yakalanacak; kullanıcı isterse değiştirebilecek ve yeniden isimlendirebilecek.
- Ana ekran 3 bölüm: sol sidebar (etiket/konum/kişi listesi + düzenleme — değişince ilgili notların içeriği de güncellenir), orta (o güne ait notlar), sağ (aylık takvim, gün sağ üstünde not sayısı badge).
- Her not/etiket kendi URL'i üzerinden erişebilir.
- Responsive + mobile uyumlu; Docker ile yapılandırılmış; Coolify'a kolay deploy edilebilir; DB seçimi serbest.

## User choices (gathered via ask_human)
- Auth: JWT email/şifre **+** Emergent Google Auth (her ikisi de)
- Harita: Leaflet (OpenStreetMap)
- DB: MongoDB
- AI: ileride
- Tema: Light + Dark toggle

## Architecture
- **Backend**: FastAPI (server.py) + Motor (MongoDB), bcrypt, PyJWT, httpx
- **Frontend**: React 19 + React Router 7 + Tailwind + shadcn/ui + react-markdown + react-leaflet + sonner
- **Auth**: dual flow — JWT httpOnly cookies (access 1d + refresh 7d) for email/password, Emergent Google OAuth exchanging session_id → session_token + JWT cookies
- **Data model**: `users`, `notes`, `tags`, `people`, `locations`, `user_sessions`; user-scoped via `user_id`; tag/person extraction from note content via Unicode regex on `#` / `@`.

## Implemented (2026-02-17)
- ✅ Auth: register/login/me/logout, Emergent Google session exchange
- ✅ Notes CRUD with #tag/@person auto-extraction; date/tag/person/location filters
- ✅ Tag & Person rename → propagates to note.content + note.tags array
- ✅ Location capture (browser geolocation), Leaflet picker, rename → notes reference by id (label updates auto)
- ✅ Aylık takvim count endpoint + UI with serif badge
- ✅ 3-column responsive dashboard + mobile drawer/sheet
- ✅ URL'e göre /day/:date, /tag/:name, /person/:name, /location/:id, /note/:id
- ✅ Light/Dark theme toggle (Cormorant Garamond + Manrope + JetBrains Mono)
- ✅ Editorial paper+ink aesthetic, no AI-slop colors
- ✅ Docker Compose + Dockerfile + nginx for Coolify deploy + README
- ✅ Backend tested 100% (15/15 pytest tests pass)

## Personas
1. **Günlük yazarı** — kişisel not / journal, etiket+kişi düzeniyle, konum/zaman bağlamı
2. **Bilgi işçisi** — markdown notlarını @kişi ve #proje ile organize eden çalışan

## P0 / P1 Backlog
- P1: Universal full-text search across notes
- P1: Export to Markdown/JSON
- P1: Note sharing (read-only public URL)
- P2: Pagination params (currently hard cap 500)
- P2: Brute-force lockout on /auth/login
- P2: lat/lng bounds validation in LocationIn
- P2: Migrate startup events to FastAPI lifespan
- P2: Tighten CORS for production deploy

## Test credentials
- admin@inkwell.app / admin12345 (seeded)
- test@inkwell.app / test12345 (registered)
