const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

async function get(path) {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export const api = {
  getTrainAlerts: () => get("/train/alerts"),
  getCrowdDensity: (lineCode) => get(`/train/crowd/${lineCode}`),
  getDoorDensity: (stationCode) => get(`/train/door-density/${stationCode}`),
  getAiRecommendation: (journeyData) => post("/journey/recommend", journeyData),
  searchAddress: (query) => get(`/geocode/search?q=${encodeURIComponent(query)}`),
  getMultimodalRoute: ({ fromLat, fromLng, toLat, toLng, date, time }) => {
    const params = new URLSearchParams({ fromLat, fromLng, toLat, toLng });
    if (date) params.set("date", date);
    if (time) params.set("time", time);
    return get(`/journey/multimodal?${params.toString()}`);
  },
  // Same endpoint as getMultimodalRoute plus the Trip Options query params
  // (allowNel / allowCcl / allowBus / allowLrt / sort). Kept separate so the original signature is untouched.
  getMultimodalRouteWithOptions: ({ fromLat, fromLng, toLat, toLng, date, time, allowNel, allowCcl, allowBus, allowLrt, sort }) => {
    const params = new URLSearchParams({ fromLat, fromLng, toLat, toLng });
    if (date) params.set("date", date);
    if (time) params.set("time", time);
    if (allowNel !== undefined) params.set("allowNel", String(allowNel));
    if (allowCcl !== undefined) params.set("allowCcl", String(allowCcl));
    if (allowBus !== undefined) params.set("allowBus", String(allowBus));
    if (allowLrt !== undefined) params.set("allowLrt", String(allowLrt));
    if (sort) params.set("sort", sort);
    return get(`/journey/multimodal?${params.toString()}`);
  },
  // Real OneMap cycling route (first mile of the Two-wheeler option).
  getCycleLeg: ({ fromLat, fromLng, toLat, toLng }) => {
    const params = new URLSearchParams({ fromLat, fromLng, toLat, toLng });
    return get(`/journey/cycle?${params.toString()}`);
  },
  // Real LTA bicycle parking near a point (503 { unavailable: true } while the LTA key is rejected).
  getBicycleParking: ({ lat, lng, dist = 0.5 }) => get(`/bicycle/parking?lat=${lat}&lng=${lng}&dist=${dist}`),
  // Real OneMap walking route (used to re-route the walk from a chosen station exit).
  getWalkLeg: ({ fromLat, fromLng, toLat, toLng }) => {
    const params = new URLSearchParams({ fromLat, fromLng, toLat, toLng });
    return get(`/journey/walk?${params.toString()}`);
  },
  // Bicycle parking inside a map viewport (LTA when available, otherwise OpenStreetMap - see routes/bicycle.js).
  getBicycleParkingInBounds: ({ minLat, minLng, maxLat, maxLng }) =>
    get(`/bicycle/parking?minLat=${minLat}&minLng=${minLng}&maxLat=${maxLat}&maxLng=${maxLng}`),
  // Real bus stops (with the services calling at each) along the NEL corridor.
  getBusStopsNearNel: () => get("/bus/stops-near-nel"),
  getBestDeparture: ({ fromLat, fromLng, toLat, toLng, arrivalWindowStart, arrivalWindowEnd, date }) => {
    const params = new URLSearchParams({ fromLat, fromLng, toLat, toLng, arrivalWindowStart, arrivalWindowEnd });
    if (date) params.set("date", date);
    return get(`/journey/best-departure?${params.toString()}`);
  },
};
