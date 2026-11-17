# Inkwell — Markdown destekli SaaS not uygulaması

Düşüncelerinizi mürekkep gibi kâğıda dökün. Markdown destekli, #etiket / @kişi
otomatik tamamlama, konum bilgisi (Leaflet harita), günlük takvim ve çoklu
kullanıcı SaaS mimarisi ile.

## Özellikler
- **Yalnızca Google ile giriş** (OAuth 2.0 + PKCE, doğrudan Google — aracı servis yok).
- **Kalıcı oturum**: bir kez giriş yapınca cihazda 400 güne kadar açık kalır; her
  kullanımda süre ileri kayar, yani aktif kullanıcı tekrar giriş yapmaz.
- **Google Takvim**: izin bir kez verilir; şifreli saklanan refresh token ile erişim
  kalıcıdır (kullanıcı kaldırana ya da Google hesabından iptal edene kadar).
  Seçili günün etkinlikleri sağ panelde listelenir.
- **Markdown** destekli zengin notlar (`react-markdown` + GFM)
- **Kişisel alanlar**: Ayarlar'dan hayat alanlarınızı (İş, Aile, Sağlık…) renk ve
  açıklamayla tanımlayın; not yazarken notu bir veya birden fazla alanla ilişkilendirin.
- **Graph**: alanlar merkezde, yarıçapları içerdikleri not sayısına göre (alanı not
  sayısıyla orantılı). Bir alana tıklayınca ona bağlı birinci derece notların graph'ı
  açılır; ortak #etiket / @kişi paylaşan notlar kesikli çizgiyle bağlanır.
- `#etiket` ve `@kişi` ile **autocomplete dropdown**; her etiket/kişi kendi URL'ine sahip.
  Etiket listesi her zaman notlarla senkron: hiçbir notta geçmeyen etiket listeden düşer.
  Kod blokları içindeki `#include` gibi ifadeler etiket sayılmaz. Türkçe harfler için
  tutarlı küçük harf (`#ÇALIŞMA` = `#çalışma`, `#İzmir` = `#izmir`).
- **Konum**: Tarayıcının `geolocation` API'si; Leaflet/OpenStreetMap mini harita.
- **3 sütunlu** masaüstü layout; mobilde sol/sağ paneller drawer/sheet'e dönüşür.
- **Aylık takvim** günde kaç not olduğunu badge ile gösterir.
- Etiket/kişi/konum **yeniden adlandırma → tüm notlarda otomatik güncellenir**.
- Etiket/kişi **silme → `#etiket` / `@kişi` ifadeleri tüm notların içeriğinden de kaldırılır**.
- Görsel yükleme (yerel disk / Docker volume), hatırlatıcılar, link önizleme.
- **Light / Dark** tema.

## Teknik yığın
- **Backend**: FastAPI · Motor (MongoDB) · httpx · cryptography
- **Frontend**: React 19 · React Router 7 · Tailwind · shadcn/ui · react-markdown · react-leaflet
- **DB**: MongoDB

## Google Cloud kurulumu (bir kez)
1. [Google Cloud Console](https://console.cloud.google.com/) → yeni proje.
2. **APIs & Services → Library** → *Google Calendar API*'yi etkinleştirin.
3. **OAuth consent screen**: User type *External*; scope olarak `openid`, `email`,
   `profile` ve `.../auth/calendar.readonly` ekleyin.
4. **Publishing status → In production** yapın. ⚠️ *Testing* durumunda Google, refresh
   token'ları **7 gün** sonra iptal eder; takvim erişimi kalıcı olmaz.
   `calendar.readonly` hassas bir scope'tur: Google doğrulaması tamamlanana kadar
   kullanıcılar "doğrulanmamış uygulama" uyarısı görür ve üst sınır 100 kullanıcıdır.
5. **Credentials → Create credentials → OAuth client ID → Web application**.
   *Authorized redirect URI*: `https://<APP_URL>/api/auth/google/callback`
   (yerel geliştirme için ayrıca `http://localhost:3000/api/auth/google/callback`).
6. Client ID ve secret'ı ortam değişkenlerine yazın.

## Ortam değişkenleri
Bkz. [`.env.example`](.env.example). Zorunlu olanlar:

| Değişken | Açıklama |
| -------- | -------- |
| `SECRET_KEY` | `openssl rand -hex 32`. Refresh token şifrelemesinde kullanılır; değişirse kullanıcıların takvim bağlantısı düşer. |
| `APP_URL` | Kullanıcının açtığı adres, örn. `https://notes.example.com` |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth client |

## Docker / Coolify Deploy
Frontend konteynerindeki nginx `/api` isteklerini backend'e yönlendirir; uygulama ve
API **aynı alan adından** sunulur. Böylece oturum çerezi birinci taraf olur
(`SameSite=Lax`) ve tarayıcıların üçüncü taraf çerez engellemesine takılmaz.

1. Coolify'da "Docker Compose" uygulaması oluşturup repoyu bağlayın.
2. Yukarıdaki ortam değişkenlerini tanımlayın.
3. Yalnızca **frontend** servisini (port 80) domain ile yayınlayın. Backend ve Mongo
   dahili kalır.
4. Deploy.

Yerelde:
```bash
cp .env.example .env   # değerleri doldurun
docker compose up -d --build
```

## Geliştirme (yerel)
```bash
# backend/.env : MONGO_URL, DB_NAME, SECRET_KEY, GOOGLE_*, APP_URL=http://localhost:3000, COOKIE_SECURE=false
cd backend && pip install -r requirements-dev.txt && uvicorn server:app --port 8001 --reload
cd frontend && yarn install --frozen-lockfile && yarn start   # /api → localhost:8001 (src/setupProxy.js)
```

Çevrimdışı testler (sunucu/MongoDB gerekmez, mongomock kullanır):
```bash
pytest backend/tests/test_offline_entities.py
```

Entegrasyon testleri çalışan bir API ve MongoDB'ye karşı koşar (oturumlar doğrudan DB'ye yazılır):
```bash
INKWELL_API_URL=http://localhost:8001 MONGO_URL=mongodb://localhost:27017 pytest backend/tests
```

## API
Tüm endpointler `/api` altındadır.
| Method | Endpoint | Açıklama |
| ------ | -------- | ------ |
| GET | `/api/auth/google/login?next=&calendar=` | Google'a yönlendirir (`calendar=true` takvim izni de ister) |
| GET | `/api/auth/google/callback` | OAuth dönüşü; oturum çerezini kurar |
| GET  | `/api/auth/me` | Mevcut kullanıcı |
| POST | `/api/auth/logout` | Çıkış (takvim bağlantısı korunur) |
| GET | `/api/google/calendar/status` | Takvim bağlı mı |
| GET | `/api/google/calendar/events?time_min=&time_max=` | Birincil takvimdeki etkinlikler |
| DELETE | `/api/google/calendar` | Takvim bağlantısını kaldır (token Google'da da iptal edilir) |
| GET/POST/PUT/DELETE | `/api/notes` | Notlar CRUD + filtreler (`area_id`, `tags`, `people`, `q`…) |
| GET | `/api/notes/calendar?year=&month=` | Aylık gün başına not sayısı |
| GET/PUT/DELETE | `/api/tags/:tag_id` | Etiket yönetimi (silme notlardan da çıkarır) |
| GET/PUT/DELETE | `/api/people/:person_id` | Kişi yönetimi (silme notlardan da çıkarır) |
| GET/POST/PUT/DELETE | `/api/areas` | Kişisel alanlar (not sayılarıyla) |
| GET | `/api/graph?area_id=` | Graph verisi: alanlar + not düğümleri (opsiyonel: bir alanın birinci derece notları) |
| GET/POST/PUT/DELETE | `/api/locations` | Konum yönetimi |
| POST | `/api/uploads/image` · GET `/api/files/:id` | Görsel yükleme / indirme |

## Lisans
MIT
