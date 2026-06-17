# Inkwell — Markdown destekli SaaS not uygulaması

Düşüncelerinizi mürekkep gibi kâğıda dökün. Markdown destekli, #etiket / @kişi
otomatik tamamlama, konum bilgisi (Leaflet harita), günlük takvim ve çoklu
kullanıcı SaaS mimarisi ile.

## Özellikler
- **Çift kimlik doğrulama**: JWT tabanlı e-posta/şifre **+** Emergent‑managed Google SSO.
- **Markdown** destekli zengin notlar (`react-markdown` + GFM)
- `#etiket` ve `@kişi` ile **autocomplete dropdown**; her etiket/kişi kendi URL'ine sahip.
- **Konum**: Tarayıcının `geolocation` API'si üzerinden yakalama; Leaflet/OpenStreetMap
  ile mini harita, haritaya tıklayarak değiştirme, isim verme.
- **3 sütunlu** masaüstü layout; mobilde sol/sağ paneller drawer/sheet'e dönüşür.
- **Aylık takvim** günde kaç not olduğunu serif rakamlı badge ile gösterir.
- Sidebar üzerinden etiket/kişi/konum **yeniden adlandırma → tüm notlardaki içerikte
  ve referans alanlarda otomatik güncellenir**.
- **Light / Dark** tema toggle, kâğıt+mürekkep estetiği.

## Teknik yığın
- **Backend**: FastAPI · Motor (MongoDB) · bcrypt · PyJWT · httpx
- **Frontend**: React 19 · React Router 7 · Tailwind · shadcn/ui · react-markdown ·
  react-leaflet · sonner · framer-motion
- **DB**: MongoDB (motor async driver)

## Klasör yapısı
```
backend/      FastAPI uygulaması (server.py, Dockerfile)
frontend/     React uygulaması (Dockerfile, nginx.conf)
docker-compose.yml  Tek komutta Coolify/lokal kurulum
memory/test_credentials.md  Seed admin + test kullanıcı
```

## Geliştirme (yerel)
Backend ve frontend mevcut Emergent ortamında supervisor ile çalışır.

## Docker / Coolify Deploy
1. Coolify'da yeni bir uygulama oluşturun, repo URL'sini bağlayın.
2. "Docker Compose" deployment tipini seçin; `docker-compose.yml` algılanır.
3. Coolify ortam değişkenlerinde aşağıdakileri tanımlayın:

```
JWT_SECRET=<64 karakter rasgele hex — `openssl rand -hex 32`>
ADMIN_EMAIL=admin@inkwell.app
ADMIN_PASSWORD=<güçlü bir şifre>
DB_NAME=inkwell
MONGO_URL=mongodb://mongo:27017
REACT_APP_BACKEND_URL=https://<backend.domaininiz>
CORS_ORIGINS=https://<frontend.domaininiz>
```

4. Backend servisini `8001` portunda public domain ile, frontend'i `80` portunda
   public domain ile expose edin. Mongo'yu internal bırakın.
5. Coolify "Deploy" butonuna basın.

### Yerel docker compose
```bash
cp .env.example .env  # gerekli değişkenleri doldurun
docker compose up -d --build
```

## API
Tüm endpointler `/api` altındadır.
| Method | Endpoint | Açıklama |
| ------ | -------- | ------ |
| POST | `/api/auth/register` | E-posta+şifre kayıt |
| POST | `/api/auth/login` | E-posta+şifre giriş |
| POST | `/api/auth/google/session` | Emergent Google session_id exchange |
| GET  | `/api/auth/me` | Mevcut kullanıcı |
| POST | `/api/auth/logout` | Çıkış |
| GET/POST/PUT/DELETE | `/api/notes` | Notlar CRUD + `?date=`, `?tag=`, `?person=`, `?location_id=` filtreleri |
| GET | `/api/notes/calendar?year=&month=` | Aylık gün başına not sayısı |
| GET/PUT/DELETE | `/api/tags/:tag_id` | Etiket yönetimi (rename → notları güncelle) |
| GET/PUT/DELETE | `/api/people/:person_id` | Kişi yönetimi |
| GET/POST/PUT/DELETE | `/api/locations` | Konum yönetimi |

## Lisans
MIT
