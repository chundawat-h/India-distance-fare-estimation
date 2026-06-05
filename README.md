# 🗺 India Distance & Fare Dashboard

A responsive, dark-mode travel estimation dashboard for Indian cities using OpenStreetMap + OSRM routing.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
pip install -r requirements.txt
```

### 2. Run the app
```bash
python app.py
```

### 3. Open in browser
```
http://localhost:5000
```

---

## 📁 Project Structure

```
india-fare-dashboard/
├── app.py                  # Flask backend (routes, geocoding, OSRM API, caching, rate limiting)
├── requirements.txt        # Python dependencies
├── config/
│   └── fares.json          # Single source of truth for fare rates, icons & speed factors
├── templates/
│   └── index.html          # Frontend (Tailwind CSS + Leaflet.js)
└── static/
    └── script.js           # All frontend logic (map, autocomplete, results, mobile panel)
```

---

## 🛠 Tech Stack

| Layer        | Technology                        | Why                                   |
|--------------|-----------------------------------|---------------------------------------|
| Backend      | Flask (Python)                    | Lightweight, quick to set up          |
| Caching      | Flask-Caching (SimpleCache/Redis) | Avoid repeat calls to OSRM/Nominatim  |
| Rate Limiting| Flask-Limiter                     | Respect Nominatim's 1 req/sec policy  |
| Validation   | Pydantic v2                       | Clean input validation at the boundary|
| Frontend     | HTML + Tailwind CSS (CDN)         | Utility-first, no build step          |
| Map          | Leaflet.js + OpenStreetMap        | Free, open, highly customizable       |
| Routing      | OSRM (public API)                 | Free, fast, no API key needed         |
| Geocoding    | Nominatim (OpenStreetMap)         | Free, good India coverage             |

---

## 🗺 How It Works

1. **User searches** for a city/state → frontend checks `sessionStorage` cache → calls `/api/geocode` → Flask proxies to Nominatim (with server-side cache)
2. **User clicks Calculate** → frontend calls `/api/route` → Flask checks route cache → calls OSRM
3. **Flask returns** distance, duration, and fare estimates for all 4 modes
4. **Frontend renders** route on Leaflet map + displays stats; switching modes updates fare **and duration**

---

## 💰 Fare & Duration Logic

Fares are loaded from `config/fares.json` — edit without restarting the server:

| Mode          | Base Fare | Per km   | Duration factor      |
|---------------|-----------|----------|----------------------|
| 🚗 Car / Taxi | ₹40       | ₹8/km    | 1.0× (OSRM baseline) |
| 🚌 State Bus  | ₹15       | ₹2.5/km  | 1.5× (slower)        |
| 🛵 Bike       | ₹20       | ₹3/km    | 1.25× (slower)       |
| 🚆 Train      | ₹30       | ₹2/km    | 0.55× (faster)       |

**Fare formula:** `Total = Base + (Distance_km × Rate_per_km)`  
**Duration:** OSRM road time is the car baseline; other modes apply a speed factor.

To add a new travel mode, add one entry to `config/fares.json` — no Python or JS changes needed.

---

## ✨ Features

### Core
- 🔍 Autocomplete city/state search with `sessionStorage` cache (instant repeat lookups)
- 🗺 Interactive Leaflet map with animated route line
- 🌙 Dark mode / Light mode toggle
- ⇅ Swap source ↔ destination
- 📍 Click-on-map to set locations (with reverse geocoding)
- 🚗 4 travel modes — fare **and estimated duration** both update on mode switch
- 📊 Fare breakdown card (base + per-km + total)

### Mobile
- 📱 Fully responsive — bottom-sheet panel on phones
- Tap drag handle to **collapse / compact / expand** the panel
- Map fills full screen behind the panel
- All map controls and badges reposition above the panel

### Backend
- ⚡ Route results cached 1 hour (keyed by coordinate hash)
- ⚡ Geocode results cached 30 minutes
- 🛡 Rate limiting: `/api/route` 30/min, `/api/geocode` 20/min
- ✅ Pydantic input validation on all coordinates
- 🔧 `/api/config` endpoint — serves fare config to frontend (one source of truth)

---

## ⚠️ Notes

- OSRM public API (`router.project-osrm.org`) is for **development only**. For production, host your own OSRM or use OpenRouteService (free API key required)
- Nominatim enforces **1 req/sec**. Rate limiting is enabled by default. For production, use Photon or self-hosted Nominatim
- Fare rates are estimates and do not reflect actual transport pricing
- Duration estimates for Bus/Bike/Train use fixed speed factors relative to road driving time

---

## 📦 Production Upgrade Checklist

- [ ] Replace public OSRM with OpenRouteService (free key) or self-hosted OSRM
- [x] ~~Add rate limiting with flask-limiter~~ ✅ Done
- [x] ~~Add caching for geocode/route results~~ ✅ Done (swap `SimpleCache` → `RedisCache` for prod)
- [ ] Move Tailwind from CDN to compiled build
- [ ] Add user trip history (SQLite or PostgreSQL)
- [ ] Deploy with Gunicorn + Nginx + Docker
- [ ] Add Redis for distributed caching (replace in-memory SimpleCache)
- [ ] Add structured logging (structlog)
