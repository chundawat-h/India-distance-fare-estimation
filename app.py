from flask import Flask, render_template, request, jsonify
from flask_caching import Cache
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from pydantic import BaseModel, field_validator, ValidationError
import requests
import hashlib
import json
import os

app = Flask(__name__)

# ─────────────────────────────────────────────────────────
# Cache  (SimpleCache for dev — swap CACHE_TYPE to "redis"
#          and add CACHE_REDIS_URL for production)
# ─────────────────────────────────────────────────────────
cache = Cache(app, config={
    "CACHE_TYPE": "SimpleCache",
    "CACHE_DEFAULT_TIMEOUT": 3600,  # 1 hour default
})

# ─────────────────────────────────────────────────────────
# Rate Limiter  (memory storage — swap to Redis URI in prod)
# ─────────────────────────────────────────────────────────
limiter = Limiter(
    get_remote_address,
    app=app,
    default_limits=["200/day", "60/minute"],
    storage_uri="memory://",
)

# ─────────────────────────────────────────────────────────
# Fare Config  (loaded once from JSON — edit without restart)
# ─────────────────────────────────────────────────────────
_CONFIG_PATH = os.path.join(os.path.dirname(__file__), "config", "fares.json")
with open(_CONFIG_PATH, encoding="utf-8") as _f:
    FARE_CONFIG: dict = json.load(_f)

OSRM_BASE = "http://router.project-osrm.org/route/v1/driving"


# ─────────────────────────────────────────────────────────
# Pydantic request model  (validates & sanitises input)
# ─────────────────────────────────────────────────────────
class RouteRequest(BaseModel):
    src_lat: float
    src_lng: float
    dst_lat: float
    dst_lng: float

    @field_validator("src_lat", "dst_lat")
    @classmethod
    def validate_lat(cls, v: float) -> float:
        if not (-90 <= v <= 90):
            raise ValueError("Latitude must be between -90 and 90")
        return round(v, 6)

    @field_validator("src_lng", "dst_lng")
    @classmethod
    def validate_lng(cls, v: float) -> float:
        if not (-180 <= v <= 180):
            raise ValueError("Longitude must be between -180 and 180")
        return round(v, 6)


# ─────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────
def _route_cache_key(src_lat: float, src_lng: float, dst_lat: float, dst_lng: float) -> str:
    """Round to ~100 m precision so nearby identical queries share cache."""
    raw = f"{round(src_lat, 3)},{round(src_lng, 3)},{round(dst_lat, 3)},{round(dst_lng, 3)}"
    return "route_" + hashlib.md5(raw.encode()).hexdigest()


def _geocode_cache_key(query: str) -> str:
    return "geocode_" + hashlib.md5(query.lower().strip().encode()).hexdigest()


# ─────────────────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────────────────
@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/config")
@cache.cached(timeout=86400, key_prefix="api_config")   # re-read once per day
def get_config():
    """Serve fare config (base, per_km, label, icon, speed_factor) to frontend.
    This is the single source of truth — no duplication between Python and JS.
    """
    return jsonify({"modes": FARE_CONFIG})


@app.route("/api/route", methods=["POST"])
@limiter.limit("30/minute")
def get_route():
    # 1. Validate input
    try:
        body = request.get_json(force=True) or {}
        req = RouteRequest(**body)
    except ValidationError as e:
        msgs = [err["msg"] for err in e.errors()]
        return jsonify({"error": "; ".join(msgs)}), 400
    except Exception:
        return jsonify({"error": "Invalid JSON body"}), 400

    # 2. Cache hit?
    cache_key = _route_cache_key(req.src_lat, req.src_lng, req.dst_lat, req.dst_lng)
    cached = cache.get(cache_key)
    if cached:
        return jsonify(cached)

    # 3. Call OSRM
    try:
        url = f"{OSRM_BASE}/{req.src_lng},{req.src_lat};{req.dst_lng},{req.dst_lat}"
        params = {"overview": "full", "geometries": "geojson", "steps": "false"}
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        route_data = resp.json()

        if route_data.get("code") != "Ok":
            return jsonify({"error": "Route not found between these points."}), 404

        route = route_data["routes"][0]
        distance_km = round(route["distance"] / 1000, 1)
        duration_min = round(route["duration"] / 60)

        # 4. Compute fares — include base so frontend never needs to hardcode it
        fares = {}
        for mode, cfg in FARE_CONFIG.items():
            fares[mode] = {
                "label":  cfg["label"],
                "fare":   round(cfg["base"] + distance_km * cfg["per_km"]),
                "base":   cfg["base"],
                "per_km": cfg["per_km"],
            }

        result = {
            "distance_km": distance_km,
            "duration_min": duration_min,
            "fares": fares,
            "geometry": route["geometry"],
        }

        cache.set(cache_key, result)
        return jsonify(result)

    except requests.exceptions.Timeout:
        return jsonify({"error": "Route service timed out. Please try again."}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Route service error: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@app.route("/api/geocode")
@limiter.limit("20/minute")
def geocode():
    query = request.args.get("q", "").strip()
    if not query or len(query) < 2:
        return jsonify([])

    # Cache hit?
    cache_key = _geocode_cache_key(query)
    cached = cache.get(cache_key)
    if cached:
        return jsonify(cached)

    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            "q": query + " India",
            "format": "json",
            "limit": 6,
            "countrycodes": "in",
            "addressdetails": 1,
        }
        headers = {"User-Agent": "IndiaFareDashboard/1.0"}
        resp = requests.get(url, params=params, headers=headers, timeout=10)
        resp.raise_for_status()
        results = resp.json()

        places = []
        for r in results:
            addr = r.get("address", {})
            name = (
                addr.get("city") or
                addr.get("town") or
                addr.get("state_district") or
                addr.get("state") or
                r.get("display_name", "").split(",")[0]
            )
            state = addr.get("state", "")
            label = f"{name}, {state}" if state and name != state else name
            places.append({
                "label":   label,
                "display": r.get("display_name", ""),
                "lat":     float(r["lat"]),
                "lng":     float(r["lon"]),
                "type":    r.get("type", ""),
            })

        # De-duplicate by ~1 km grid
        seen, unique = set(), []
        for p in places:
            key = (round(p["lat"], 2), round(p["lng"], 2))
            if key not in seen:
                seen.add(key)
                unique.append(p)

        cache.set(cache_key, unique, timeout=1800)   # 30-min TTL for geocode
        return jsonify(unique)

    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ─────────────────────────────────────────────────────────
# Error handlers for rate-limit responses
# ─────────────────────────────────────────────────────────
@app.errorhandler(429)
def ratelimit_handler(e):
    return jsonify({"error": f"Rate limit exceeded: {e.description}"}), 429


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_ENV", "production") == "development"
    app.run(host="0.0.0.0", port=port, debug=debug)