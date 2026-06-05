from flask import Flask, render_template, request, jsonify
import requests
import math

app = Flask(__name__)

# Fare configuration (INR per km)
FARE_CONFIG = {
    "car": {"base": 50, "per_km": 12, "label": "Car / Taxi"},
    "bus": {"base": 30, "per_km": 4.5, "label": "State Bus"},
    "bike": {"base": 20, "per_km": 6, "label": "Bike / Scooter"},
    "train": {"base": 40, "per_km": 3, "label": "Express Train"},
}

OSRM_BASE = "http://router.project-osrm.org/route/v1/driving"

@app.route("/")
def index():
    return render_template("index.html")

@app.route("/api/route", methods=["POST"])
def get_route():
    data = request.get_json()
    src_lat = data.get("src_lat")
    src_lng = data.get("src_lng")
    dst_lat = data.get("dst_lat")
    dst_lng = data.get("dst_lng")

    if not all([src_lat, src_lng, dst_lat, dst_lng]):
        return jsonify({"error": "Missing coordinates"}), 400

    try:
        url = f"{OSRM_BASE}/{src_lng},{src_lat};{dst_lng},{dst_lat}"
        params = {
            "overview": "full",
            "geometries": "geojson",
            "steps": "false"
        }
        resp = requests.get(url, params=params, timeout=15)
        resp.raise_for_status()
        route_data = resp.json()

        if route_data.get("code") != "Ok":
            return jsonify({"error": "Route not found"}), 404

        route = route_data["routes"][0]
        distance_m = route["distance"]
        duration_s = route["duration"]
        geometry = route["geometry"]

        distance_km = round(distance_m / 1000, 1)
        duration_min = round(duration_s / 60)
        hours = duration_min // 60
        mins = duration_min % 60

        if hours > 0:
            time_str = f"{hours}h {mins}m"
        else:
            time_str = f"{mins}m"

        fares = {}
        for mode, config in FARE_CONFIG.items():
            fare = config["base"] + (distance_km * config["per_km"])
            fares[mode] = {
                "label": config["label"],
                "fare": round(fare),
                "per_km": config["per_km"]
            }

        return jsonify({
            "distance_km": distance_km,
            "duration_min": duration_min,
            "time_str": time_str,
            "fares": fares,
            "geometry": geometry
        })

    except requests.exceptions.Timeout:
        return jsonify({"error": "Route service timed out. Please try again."}), 504
    except requests.exceptions.RequestException as e:
        return jsonify({"error": f"Route service error: {str(e)}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route("/api/geocode", methods=["GET"])
def geocode():
    query = request.args.get("q", "")
    if not query:
        return jsonify([])

    try:
        url = "https://nominatim.openstreetmap.org/search"
        params = {
            "q": query + " India",
            "format": "json",
            "limit": 6,
            "countrycodes": "in",
            "addressdetails": 1
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
                "label": label,
                "display": r.get("display_name", ""),
                "lat": float(r["lat"]),
                "lng": float(r["lon"]),
                "type": r.get("type", "")
            })

        seen = set()
        unique = []
        for p in places:
            key = (round(p["lat"], 2), round(p["lng"], 2))
            if key not in seen:
                seen.add(key)
                unique.append(p)

        return jsonify(unique)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == "__main__":
    app.run(debug=True, port=5000)