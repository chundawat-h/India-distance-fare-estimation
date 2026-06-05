# India-distance-fare-estimation

# 🗺 India Distance & Fare Dashboard

A clean, dark-mode travel estimation dashboard for Indian cities using OpenStreetMap + OSRM routing.

---

## 🚀 Quick Start

### 1. Install dependencies
```bash
pip install flask requests
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
├── app.py                  # Flask backend (routes, geocoding, OSRM API)
├── requirements.txt        # Python dependencies
├── templates/
│   └── index.html          # Full frontend (Tailwind + Leaflet + JS)
└── static/                 # (Optional) for custom CSS/JS files
```

---

## 🛠 Tech Stack

| Layer       | Technology                       | Why                              |
|-------------|----------------------------------|----------------------------------|
| Backend     | Flask (Python)                   | Lightweight, quick to set up     |
| Frontend    | HTML + Tailwind CSS (CDN)        | Utility-first, no build step     |
| Map         | Leaflet.js + OpenStreetMap       | Free, open, highly customizable  |
| Routing     | OSRM (public API)                | Free, fast, no API key needed    |
| Geocoding   | Nominatim (OpenStreetMap)        | Free, India coverage is good     |

---

## 🗺 How It Works

1. **User searches** for a city/state → frontend calls `/api/geocode` → Flask proxies to Nominatim
2. **User clicks Calculate** → frontend calls `/api/route` → Flask calls OSRM's public routing API
3. **Flask returns** distance, duration, and fare estimates
4. **Frontend renders** route on Leaflet map + displays stats in sidebar

---

## 💰 Fare Calculation Logic

Fares are estimates based on fixed per-km rates:

| Mode       | Base Fare | Per km  |
|------------|-----------|---------|
| Car / Taxi | ₹50       | ₹12/km  |
| State Bus  | ₹30       | ₹4.5/km |
| Bike       | ₹20       | ₹6/km   |
| Train      | ₹40       | ₹3/km   |

Formula: `Total = Base + (Distance_km × Rate_per_km)`

---

## ✨ Features

- 🔍 Autocomplete city/state search (Nominatim)
- 🗺 Interactive map with route visualization
- 🌙 Dark mode / Light mode toggle
- ⇅ Swap source ↔ destination
- 📍 Click-on-map to set locations
- 🚗 4 travel mode fare estimates
- 📊 Fare breakdown card
- 📱 Responsive layout

---

## 🔄 Alternative Tech Stacks

### Option A: FastAPI + React (More Scalable)
- **FastAPI** instead of Flask for async support, auto-docs
- **React + Vite** instead of vanilla JS for component reuse
- Best if you plan to add user auth, history, or multi-user support

### Option B: Next.js Full Stack (Simplest for deployment)
- Everything in one project (API routes + frontend)
- Deploy to Vercel in one click
- No Python needed; JS-only stack

### Option C: Pure Static (No backend at all)
- Call OSRM and Nominatim directly from the browser (no CORS issues for these APIs)
- Host on GitHub Pages / Netlify for free
- Limitation: can't add custom auth or DB later

### 🏆 Recommendation for production:
> **FastAPI + React + Mapbox GL JS**
> - FastAPI handles async, is faster than Flask
> - React makes the UI more maintainable at scale
> - Mapbox GL JS renders smoother routes than Leaflet for dense datasets
> - Cost: Free tier on Mapbox is sufficient for ~50k map loads/month

---

## ⚠️ Notes

- OSRM public API (`router.project-osrm.org`) is for development only. For production, host your own OSRM instance or use OpenRouteService (free API key required)
- Nominatim has a 1 req/sec rate limit. For production, use Photon or host your own Nominatim
- Fare rates are estimates only and do not reflect actual transport pricing

---

## 📦 Production Upgrade Checklist

- [ ] Replace public OSRM with OpenRouteService (free key) or self-hosted OSRM
- [ ] Add Redis caching for geocode/route results
- [ ] Add rate limiting with flask-limiter
- [ ] Move Tailwind from CDN to compiled build
- [ ] Add user trip history (SQLite or PostgreSQL)
- [ ] Deploy with Gunicorn + Nginx
