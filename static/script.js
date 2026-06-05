// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let map, srcMarker, dstMarker, routeLayer;
let srcData = null, dstData = null;
let currentFares = null;
let selectedMode = 'car';
let debounceTimers = {};

const FARE_BASES = { car: 50, bus: 30, bike: 20, train: 40 };
const MODE_ICONS = { car: '🚗', bus: '🚌', bike: '🛵', train: '🚆' };

// ═══════════════════════════════════════════════════════
// MAP INIT
// ═══════════════════════════════════════════════════════
function initMap() {
    map = L.map('map', {
    center: [22.5937, 80.9629],
    zoom: 5,
    zoomControl: false,
    attributionControl: false
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '© OpenStreetMap'
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.control.attribution({ position: 'bottomright', prefix: false })
    .addAttribution('© <a href="https://openstreetmap.org" target="_blank">OpenStreetMap</a>')
    .addTo(map);

    map.on('click', onMapClick);
}

// ═══════════════════════════════════════════════════════
// MAP CLICK
// ═══════════════════════════════════════════════════════
function onMapClick(e) {
    const { lat, lng } = e.latlng;
    const target = !srcData ? 'src' : (!dstData ? 'dst' : null);
    if (!target) return;

    reverseGeocode(lat, lng).then(name => {
    const data = { label: name, lat, lng };
    setLocation(target, data);
    document.getElementById(`${target}Input`).value = name;
    });
}

async function reverseGeocode(lat, lng) {
    try {
    const url = `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`;
    const r = await fetch(url, { headers: { 'User-Agent': 'IndiaFareDashboard/1.0' } });
    const d = await r.json();
    const addr = d.address || {};
    return addr.city || addr.town || addr.state_district || addr.state || d.display_name.split(',')[0];
    } catch {
    return `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
}

// ═══════════════════════════════════════════════════════
// MARKERS
// ═══════════════════════════════════════════════════════
function makeIcon(color) {
    return L.divIcon({
    className: '',
    html: `<div style="
        width:36px;height:44px;position:relative;
        display:flex;align-items:center;justify-content:center;">
        <svg width="36" height="44" viewBox="0 0 36 44" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M18 2C10.268 2 4 8.268 4 16c0 11 14 26 14 26s14-15 14-26C32 8.268 25.732 2 18 2z"
            fill="${color}" stroke="white" stroke-width="1.5"/>
        <circle cx="18" cy="16" r="6" fill="white"/>
        </svg>
    </div>`,
    iconSize: [36, 44],
    iconAnchor: [18, 44],
    popupAnchor: [0, -44]
    });
}

function placeMarker(type, lat, lng, label) {
    const color = type === 'src' ? '#4ade80' : '#f87171';
    if (type === 'src') {
    if (srcMarker) map.removeLayer(srcMarker);
    srcMarker = L.marker([lat, lng], { icon: makeIcon(color) })
        .addTo(map).bindPopup(`<b>${label}</b><br><small>Origin</small>`);
    } else {
    if (dstMarker) map.removeLayer(dstMarker);
    dstMarker = L.marker([lat, lng], { icon: makeIcon(color) })
        .addTo(map).bindPopup(`<b>${label}</b><br><small>Destination</small>`);
    }
}

// ═══════════════════════════════════════════════════════
// LOCATION SELECTION
// ═══════════════════════════════════════════════════════
function setLocation(type, data) {
    if (type === 'src') srcData = data;
    else dstData = data;

    placeMarker(type, data.lat, data.lng, data.label);

    const chipEl = document.getElementById(`${type}Chip`);
    const chipText = document.getElementById(`${type}ChipText`);
    const clearBtn = document.getElementById(`${type}Clear`);

    chipEl.classList.remove('hidden');
    chipText.textContent = data.label;
    clearBtn.classList.remove('hidden');

    updateClickHint();

    if (srcData && dstData) {
    document.getElementById('clickHint').classList.add('hidden');
    }
}

function clearLocation(type) {
    if (type === 'src') {
    srcData = null;
    if (srcMarker) { map.removeLayer(srcMarker); srcMarker = null; }
    document.getElementById('srcInput').value = '';
    document.getElementById('srcChip').classList.add('hidden');
    document.getElementById('srcClear').classList.add('hidden');
    } else {
    dstData = null;
    if (dstMarker) { map.removeLayer(dstMarker); dstMarker = null; }
    document.getElementById('dstInput').value = '';
    document.getElementById('dstChip').classList.add('hidden');
    document.getElementById('dstClear').classList.add('hidden');
    }

    if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    document.getElementById('resultsSection').classList.add('hidden');
    document.getElementById('emptyState').classList.remove('hidden');
    document.getElementById('mapInfoBadge').classList.add('hidden');
    updateClickHint();
}

function swapLocations() {
    const tmpData = srcData;
    const tmpInput = document.getElementById('srcInput').value;
    srcData = dstData;
    dstData = tmpData;

    document.getElementById('srcInput').value = document.getElementById('dstInput').value;
    document.getElementById('dstInput').value = tmpInput;

    if (srcData) { placeMarker('src', srcData.lat, srcData.lng, srcData.label); }
    if (dstData) { placeMarker('dst', dstData.lat, dstData.lng, dstData.label); }

    const srcChipText = document.getElementById('srcChipText').textContent;
    const dstChipText = document.getElementById('dstChipText').textContent;

    if (srcData) document.getElementById('srcChipText').textContent = srcData.label;
    else document.getElementById('srcChip').classList.add('hidden');

    if (dstData) document.getElementById('dstChipText').textContent = dstData.label;
    else document.getElementById('dstChip').classList.add('hidden');

    if (srcData && dstData) calculateRoute();
}

function updateClickHint() {
    const hint = document.getElementById('clickHint');
    const target = document.getElementById('clickHintTarget');
    if (!srcData) { hint.classList.remove('hidden'); target.textContent = 'source'; }
    else if (!dstData) { hint.classList.remove('hidden'); target.textContent = 'destination'; }
    else hint.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
// AUTOCOMPLETE
// ═══════════════════════════════════════════════════════
function setupAutocomplete(inputId, listId, type) {
    const input = document.getElementById(inputId);
    const list = document.getElementById(listId);
    let activeIdx = -1;

    input.addEventListener('input', () => {
    clearTimeout(debounceTimers[type]);
    const q = input.value.trim();
    if (q.length < 2) { list.classList.add('hidden'); return; }

    debounceTimers[type] = setTimeout(async () => {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
        const items = await res.json();
        if (!items.length) { list.classList.add('hidden'); return; }

        list.innerHTML = items.map((item, i) =>
        `<div class="autocomplete-item" data-idx="${i}">${item.label}</div>`
        ).join('');

        list.querySelectorAll('.autocomplete-item').forEach((el, i) => {
        el.addEventListener('mousedown', (e) => {
            e.preventDefault();
            setLocation(type, items[i]);
            input.value = items[i].label;
            list.classList.add('hidden');
        });
        });

        list.classList.remove('hidden');
        activeIdx = -1;
    }, 300);
    });

    input.addEventListener('keydown', (e) => {
    const items = list.querySelectorAll('.autocomplete-item');
    if (e.key === 'ArrowDown') { activeIdx = Math.min(activeIdx + 1, items.length - 1); }
    else if (e.key === 'ArrowUp') { activeIdx = Math.max(activeIdx - 1, 0); }
    else if (e.key === 'Escape') { list.classList.add('hidden'); return; }
    else if (e.key === 'Enter') {
        if (activeIdx >= 0) items[activeIdx].dispatchEvent(new Event('mousedown'));
        return;
    }
    items.forEach((el, i) => el.classList.toggle('active', i === activeIdx));
    });

    input.addEventListener('blur', () => setTimeout(() => list.classList.add('hidden'), 200));
}

// ═══════════════════════════════════════════════════════
// ROUTE CALCULATION
// ═══════════════════════════════════════════════════════
async function calculateRoute() {
    if (!srcData || !dstData) {
    alert('Please select both source and destination.');
    return;
    }

    // UI: loading state
    const btn = document.getElementById('calcBtn');
    const btnText = document.getElementById('calcBtnText');
    const btnIcon = document.getElementById('calcBtnIcon');
    const loader = document.getElementById('mapLoader');

    btn.disabled = true;
    btn.classList.add('opacity-70');
    btnIcon.textContent = '';
    btnText.textContent = 'Calculating…';
    const spinner = document.createElement('div');
    spinner.className = 'spinner w-4 h-4';
    btnIcon.appendChild(spinner);
    loader.classList.remove('hidden');

    try {
    const res = await fetch('/api/route', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
        src_lat: srcData.lat, src_lng: srcData.lng,
        dst_lat: dstData.lat, dst_lng: dstData.lng
        })
    });

    const data = await res.json();

    if (!res.ok || data.error) {
        throw new Error(data.error || 'Unknown error');
    }

    displayResults(data);
    drawRoute(data.geometry);
    fitMapToBounds();

    } catch (err) {
    alert('Error: ' + err.message);
    } finally {
    btn.disabled = false;
    btn.classList.remove('opacity-70');
    btnIcon.innerHTML = '🔍';
    btnText.textContent = 'Calculate Route';
    loader.classList.add('hidden');
    }
}

function displayResults(data) {
    currentFares = data.fares;

    document.getElementById('statDist').textContent = data.distance_km;
    document.getElementById('statTime').textContent = data.time_str;
    document.getElementById('routeSrc').textContent = srcData.label;
    document.getElementById('routeDst').textContent = dstData.label;

    // Map badge
    document.getElementById('badgeSrc').textContent = srcData.label.split(',')[0];
    document.getElementById('badgeDst').textContent = dstData.label.split(',')[0];
    document.getElementById('badgeDist').textContent = data.distance_km + ' km';
    document.getElementById('mapInfoBadge').classList.remove('hidden');

    // Mode tabs
    buildModeTabs(data.distance_km);
    selectMode('car', data.distance_km);

    // Show results
    document.getElementById('resultsSection').classList.remove('hidden');
    document.getElementById('emptyState').classList.add('hidden');
}

function buildModeTabs(distKm) {
    const container = document.getElementById('modeTabs');
    const modes = ['car', 'bus', 'bike', 'train'];
    const labels = { car: 'Car / Taxi', bus: 'State Bus', bike: 'Bike', train: 'Train' };
    container.innerHTML = '';
    modes.forEach(mode => {
    const fare = currentFares[mode]?.fare || 0;
    const btn = document.createElement('button');
    btn.className = `mode-tab rounded-xl px-3 py-2.5 text-left transition-all ${mode === selectedMode ? 'active' : ''}`;
    btn.id = `tab-${mode}`;
    btn.innerHTML = `
        <div class="flex items-center gap-1.5 mb-1">
        <span class="text-base">${MODE_ICONS[mode]}</span>
        <span class="text-[12px] font-500">${labels[mode]}</span>
        </div>
        <div class="text-base font-700 text-brand-400 font-mono">₹${fare.toLocaleString('en-IN')}</div>
    `;
    btn.onclick = () => selectMode(mode, distKm);
    container.appendChild(btn);
    });
}

function selectMode(mode, distKm) {
    selectedMode = mode;
    const fare = currentFares[mode];
    if (!fare) return;

    // Update active tab
    document.querySelectorAll('.mode-tab').forEach(el => el.classList.remove('active'));
    const tabEl = document.getElementById(`tab-${mode}`);
    if (tabEl) tabEl.classList.add('active');

    // Update stat card
    document.getElementById('statFare').textContent = '₹' + fare.fare.toLocaleString('en-IN');
    document.getElementById('statFareMode').textContent = mode;
    document.getElementById('selectedModeLabel').textContent = MODE_ICONS[mode] + ' ' + fare.label;

    // Breakdown
    const base = FARE_BASES[mode];
    const perKm = fare.per_km;
    const total = fare.fare;
    document.getElementById('breakBase').textContent = '₹' + base;
    document.getElementById('breakRate').textContent = '₹' + perKm + '/km';
    document.getElementById('breakDistLabel').textContent = `${distKm || '—'} km × ₹${perKm}`;
    document.getElementById('breakDist').textContent = '₹' + Math.round((distKm || 0) * perKm);
    document.getElementById('breakTotal').textContent = '₹' + total.toLocaleString('en-IN');
}

// ═══════════════════════════════════════════════════════
// ROUTE DRAWING
// ═══════════════════════════════════════════════════════
function drawRoute(geometry) {
    if (routeLayer) map.removeLayer(routeLayer);

    const coords = geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    // Shadow line
    const shadow = L.polyline(coords, {
    color: '#000', weight: 8, opacity: 0.3, lineCap: 'round', lineJoin: 'round'
    });

    // Main route line
    const mainLine = L.polyline(coords, {
    color: '#f97316', weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round'
    });

    // Animated dashes overlay
    const dashLine = L.polyline(coords, {
    color: '#fff', weight: 2, opacity: 0.4, lineCap: 'round',
    dashArray: '8, 14', dashOffset: '0'
    });

    routeLayer = L.layerGroup([shadow, mainLine, dashLine]).addTo(map);
}

function fitMapToBounds() {
    if (srcData && dstData) {
    const bounds = L.latLngBounds(
        [srcData.lat, srcData.lng],
        [dstData.lat, dstData.lng]
    );
    map.fitBounds(bounds, { padding: [80, 80] });
    }
}

// ═══════════════════════════════════════════════════════
// DARK MODE TOGGLE
// ═══════════════════════════════════════════════════════
let isDark = true;
document.getElementById('themeToggle').addEventListener('click', () => {
    isDark = !isDark;
    document.documentElement.classList.toggle('dark', isDark);
    document.getElementById('themeIcon').textContent = isDark ? '☀️' : '🌙';

    // Update tile filter
    document.querySelectorAll('.leaflet-tile').forEach(tile => {
    tile.style.filter = isDark ? 'brightness(0.55) saturate(0.6) hue-rotate(185deg)' : 'none';
    });
});

// ═══════════════════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════════════════
initMap();
setupAutocomplete('srcInput', 'srcList', 'src');
setupAutocomplete('dstInput', 'dstList', 'dst');
updateClickHint();