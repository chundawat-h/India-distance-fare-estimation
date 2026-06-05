// ═══════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════
let map, srcMarker, dstMarker, routeLayer;
let srcData = null, dstData = null;
let currentFares = null;
let currentDurationMin = 0;
let selectedMode = 'car';
let debounceTimers = {};
let APP_CONFIG = null; // loaded from /api/config

// Fallback config — used if /api/config fetch fails
const FALLBACK_CONFIG = {
    car:   { base: 40, per_km: 8,   label: 'Car / Taxi',     icon: '🚗', speed_factor: 1.0  },
    bus:   { base: 15, per_km: 2.5, label: 'State Bus',      icon: '🚌', speed_factor: 1.5  },
    bike:  { base: 20, per_km: 3,   label: 'Bike / Scooter', icon: '🛵', speed_factor: 1.25 },
    train: { base: 30, per_km: 2,   label: 'Express Train',  icon: '🚆', speed_factor: 0.55 },
};

// ═══════════════════════════════════════════════════════
// MOBILE PANEL STATE
// ═══════════════════════════════════════════════════════
const PANEL_HEIGHTS = { compact: '52vh', expanded: '92vh', collapsed: '68px' };
let mobilePanelState = 'compact';

function isMobile() {
    return window.innerWidth < 768;
}

/**
 * Sets the mobile bottom-sheet panel to a given state.
 * Also syncs the CSS custom property so leaflet controls,
 * toasts, and the click-hint stay correctly positioned.
 * @param {'compact'|'expanded'|'collapsed'} state
 */
function setPanelState(state) {
    if (!isMobile()) return;
    mobilePanelState = state;

    const panel = document.getElementById('sidePanel');
    const h = PANEL_HEIGHTS[state] || PANEL_HEIGHTS.compact;

    // Toggle state classes
    panel.classList.remove('panel-compact', 'panel-expanded', 'panel-collapsed');
    panel.classList.add(`panel-${state}`);

    // Sync CSS custom property — drives leaflet controls, toasts, click-hint
    document.documentElement.style.setProperty('--panel-h', h);
}

/** Tap-on-drag-handle: cycle collapsed → compact → expanded → compact */
function toggleMobilePanel() {
    if (mobilePanelState === 'collapsed') setPanelState('compact');
    else if (mobilePanelState === 'compact')  setPanelState('expanded');
    else                                       setPanelState('compact');
}

// ═══════════════════════════════════════════════════════
// CONFIG LOADER  — fetches fares.json via /api/config
// so frontend never needs hardcoded fare/speed values
// ═══════════════════════════════════════════════════════
async function loadConfig() {
    try {
        const res = await fetch('/api/config');
        if (!res.ok) throw new Error('config fetch failed');
        const data = await res.json();
        APP_CONFIG = data.modes;
    } catch {
        APP_CONFIG = FALLBACK_CONFIG;
    }
}

function getConfig() {
    return APP_CONFIG || FALLBACK_CONFIG;
}

// ═══════════════════════════════════════════════════════
// TOAST NOTIFICATIONS  — replaces all alert() calls
// ═══════════════════════════════════════════════════════
function showToast(message, type = 'error') {
    const container = document.getElementById('toastContainer');
    if (!container) return;

    const icons = { error: '⚠️', success: '✅', info: 'ℹ️' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `
        <span class="toast-icon">${icons[type] || icons.info}</span>
        <span class="toast-msg">${message}</span>
    `;
    container.appendChild(toast);

    // Double rAF ensures the transition fires after element is in DOM
    requestAnimationFrame(() => requestAnimationFrame(() => toast.classList.add('toast-visible')));

    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

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
        html: `<div style="width:36px;height:44px;position:relative;display:flex;align-items:center;justify-content:center;">
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

    document.getElementById(`${type}Chip`).classList.remove('hidden');
    document.getElementById(`${type}ChipText`).textContent = data.label;
    document.getElementById(`${type}Clear`).classList.remove('hidden');

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
    setPanelState('compact');  // reset panel height on mobile
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
// GEOCODE  — with sessionStorage cache
// Identical queries in the same browser session skip the network
// ═══════════════════════════════════════════════════════
async function fetchGeocodeResults(q) {
    const cacheKey = `geo:${q.toLowerCase().trim()}`;

    // Try session cache first
    try {
        const hit = sessionStorage.getItem(cacheKey);
        if (hit) return JSON.parse(hit);
    } catch { /* storage unavailable — continue */ }

    const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`);
    if (!res.ok) throw new Error(`Geocode error ${res.status}`);
    const items = await res.json();

    // Only cache non-empty valid results
    if (Array.isArray(items) && items.length > 0) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify(items)); } catch { /* quota exceeded */ }
    }

    return Array.isArray(items) ? items : [];
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
            try {
                const items = await fetchGeocodeResults(q);
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
            } catch {
                showToast('Search failed. Please try again.', 'error');
            }
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
        showToast('Please select both source and destination.', 'info');
        return;
    }

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
        showToast(err.message, 'error');
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
    currentDurationMin = data.duration_min;

    document.getElementById('statDist').textContent = data.distance_km;
    document.getElementById('routeSrc').textContent = srcData.label;
    document.getElementById('routeDst').textContent = dstData.label;

    document.getElementById('badgeSrc').textContent = srcData.label.split(',')[0];
    document.getElementById('badgeDst').textContent = dstData.label.split(',')[0];
    document.getElementById('badgeDist').textContent = data.distance_km + ' km';
    document.getElementById('mapInfoBadge').classList.remove('hidden');

    buildModeTabs(data.distance_km);
    selectMode('car', data.distance_km);

    document.getElementById('resultsSection').classList.remove('hidden');
    document.getElementById('emptyState').classList.add('hidden');

    setPanelState('expanded');  // auto-expand panel on mobile to show results
}

function formatDuration(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

// ═══════════════════════════════════════════════════════
// MODE TABS  — driven by APP_CONFIG, not hardcoded arrays
// ═══════════════════════════════════════════════════════
function buildModeTabs(distKm) {
    const cfg = getConfig();
    const container = document.getElementById('modeTabs');
    container.innerHTML = '';

    Object.entries(cfg).forEach(([mode, modeCfg]) => {
        const fare = currentFares[mode]?.fare || 0;
        const btn = document.createElement('button');
        btn.className = `mode-tab rounded-xl px-3 py-2.5 text-left transition-all ${mode === selectedMode ? 'active' : ''}`;
        btn.id = `tab-${mode}`;
        btn.innerHTML = `
            <div class="flex items-center gap-1.5 mb-1">
                <span class="text-base">${modeCfg.icon}</span>
                <span class="text-[12px] font-500">${modeCfg.label}</span>
            </div>
            <div class="text-base font-700 text-brand-400 font-mono">₹${fare.toLocaleString('en-IN')}</div>
        `;
        btn.onclick = () => selectMode(mode, distKm);
        container.appendChild(btn);
    });
}

function selectMode(mode, distKm) {
    selectedMode = mode;
    const fare = currentFares?.[mode];
    if (!fare) return;

    const modeCfg = getConfig()[mode];
    if (!modeCfg) return;

    // Active tab highlight
    document.querySelectorAll('.mode-tab').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${mode}`)?.classList.add('active');

    // Duration — speed_factor comes from API config (no hardcoding)
    const adjustedMin = Math.round(currentDurationMin * modeCfg.speed_factor);
    document.getElementById('statTime').textContent = formatDuration(adjustedMin);

    // Fare stat card
    document.getElementById('statFare').textContent = '₹' + fare.fare.toLocaleString('en-IN');
    document.getElementById('statFareMode').textContent = mode;
    document.getElementById('selectedModeLabel').textContent = modeCfg.icon + ' ' + fare.label;

    // Breakdown — base comes from API response, no client-side FARE_BASES needed
    document.getElementById('breakBase').textContent = '₹' + fare.base;
    document.getElementById('breakRate').textContent = '₹' + fare.per_km + '/km';
    document.getElementById('breakDistLabel').textContent = `${distKm || '—'} km × ₹${fare.per_km}`;
    document.getElementById('breakDist').textContent = '₹' + Math.round((distKm || 0) * fare.per_km);
    document.getElementById('breakTotal').textContent = '₹' + fare.fare.toLocaleString('en-IN');
}

// ═══════════════════════════════════════════════════════
// ROUTE DRAWING
// ═══════════════════════════════════════════════════════
function drawRoute(geometry) {
    if (routeLayer) map.removeLayer(routeLayer);

    const coords = geometry.coordinates.map(([lng, lat]) => [lat, lng]);

    const shadow   = L.polyline(coords, { color: '#000',    weight: 8, opacity: 0.3, lineCap: 'round', lineJoin: 'round' });
    const mainLine = L.polyline(coords, { color: '#f97316', weight: 4, opacity: 0.9, lineCap: 'round', lineJoin: 'round' });
    const dashLine = L.polyline(coords, { color: '#fff',    weight: 2, opacity: 0.4, lineCap: 'round', dashArray: '8, 14' });

    routeLayer = L.layerGroup([shadow, mainLine, dashLine]).addTo(map);
}

function fitMapToBounds() {
    if (srcData && dstData) {
        map.fitBounds(
            L.latLngBounds([srcData.lat, srcData.lng], [dstData.lat, dstData.lng]),
            { padding: [80, 80] }
        );
    }
}

// ═══════════════════════════════════════════════════════
// DARK MODE TOGGLE
// ═══════════════════════════════════════════════════════
function setupThemeToggle() {
    let isDark = true;
    document.getElementById('themeToggle').addEventListener('click', () => {
        isDark = !isDark;
        document.documentElement.classList.toggle('dark', isDark);
        document.getElementById('themeIcon').textContent = isDark ? '☀️' : '🌙';
        document.querySelectorAll('.leaflet-tile').forEach(tile => {
            tile.style.filter = isDark
                ? 'brightness(0.55) saturate(0.6) hue-rotate(185deg)'
                : 'none';
        });
    });
}

// ═══════════════════════════════════════════════════════
// INIT  — async so loadConfig() can be awaited
// ═══════════════════════════════════════════════════════
async function init() {
    initMap();
    setupAutocomplete('srcInput', 'srcList', 'src');
    setupAutocomplete('dstInput', 'dstList', 'dst');
    setupThemeToggle();
    updateClickHint();
    await loadConfig();  // fetch fare config once; falls back to FALLBACK_CONFIG on failure
}

init();