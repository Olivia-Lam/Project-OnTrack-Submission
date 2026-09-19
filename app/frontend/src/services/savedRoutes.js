// Saved favourite routes, kept in localStorage (there are no user accounts).
//
// Stored shape (array under STORAGE_KEY):
//   { id, from: {label,lat,lng}, to: {label,lat,lng}, departAt: "YYYY-MM-DDTHH:mm" | null,
//     arrivalWindow: "YYYY-MM-DDTHH:mm" | null, tripOptions: {...} | null, savedAt: ISO string }
//
// `tripOptions` is JourneyPlanner's Trip Options object ({ nel, bus, lrt, sort, twoWheeler }) and
// `arrivalWindow` is its "Arrive by" datetime-local value (null when the route was saved in
// "Depart at" mode). JourneyPlanner writes routes here via saveRoute() and reads the `prefill` that
// SavedRoutes passes as router state, keeping only the time of day (see todayAtTimeOf there).

const STORAGE_KEY = "plc.savedRoutes";

function read() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return []; // corrupt/blocked storage - behave as empty rather than crash
  }
}

function write(routes) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(routes));
  } catch {
    // storage full or blocked - nothing more we can do client-side
  }
}

export function listRoutes() {
  return read();
}

export function saveRoute({ from, to, departAt = null, arrivalWindow = null, tripOptions = null }) {
  const route = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    from,
    to,
    departAt,
    arrivalWindow,
    tripOptions,
    savedAt: new Date().toISOString(),
  };
  write([route, ...read()]);
  return route;
}

export function deleteRoute(id) {
  write(read().filter((r) => r.id !== id));
}
