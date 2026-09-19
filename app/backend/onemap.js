import fetch from "node-fetch";

// OneMap (Singapore's official mapping API) auth + search helpers.
// Uses the email/password token flow: POST credentials once, get back a
// bearer token that's valid for a while (OneMap's docs say ~3 days), then
// reuse it for subsequent calls instead of logging in every request.
const ONEMAP_BASE = "https://www.onemap.gov.sg";

let cachedToken = null;
let cachedExpiryMs = 0;

/**
 * Returns a valid OneMap access token, fetching a new one only if we don't
 * have one cached or the cached one is about to expire. Throws if
 * ONEMAP_EMAIL/ONEMAP_PASSWORD aren't set, or if OneMap's login fails.
 */
export async function getOnemapToken() {
  const now = Date.now();
  // Refresh 5 minutes before actual expiry so an in-flight request never
  // gets a token that dies mid-call.
  if (cachedToken && now < cachedExpiryMs - 5 * 60 * 1000) {
    return cachedToken;
  }

  if (!process.env.ONEMAP_EMAIL || !process.env.ONEMAP_PASSWORD) {
    throw new Error("ONEMAP_EMAIL / ONEMAP_PASSWORD are not set on the backend");
  }

  const response = await fetch(`${ONEMAP_BASE}/api/auth/post/getToken`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: process.env.ONEMAP_EMAIL,
      password: process.env.ONEMAP_PASSWORD,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OneMap login failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error("OneMap login response had no access_token");
  }

  cachedToken = data.access_token;
  // expiry_timestamp from OneMap is Unix seconds.
  cachedExpiryMs = data.expiry_timestamp ? Number(data.expiry_timestamp) * 1000 : now + 60 * 60 * 1000;

  return cachedToken;
}

/**
 * Address/postal-code search via OneMap's Search API — this endpoint works
 * without the token, but unauthenticated calls hit a much tighter rate limit
 * and start 429ing under normal debounced-typing traffic (confirmed live).
 * Attach the bearer token whenever login is configured; fall back to an
 * anonymous call rather than failing outright if login isn't set up yet.
 */
export async function searchAddress(query, pageNum = 1) {
  const url = new URL(`${ONEMAP_BASE}/api/common/elastic/search`);
  url.searchParams.set("searchVal", query);
  url.searchParams.set("returnGeom", "Y");
  url.searchParams.set("getAddrDetails", "Y");
  url.searchParams.set("pageNum", String(pageNum));

  let headers = {};
  try {
    headers = { Authorization: await getOnemapToken() };
  } catch {
    // No/invalid credentials configured - proceed unauthenticated. Search
    // still works this way, just at a lower rate limit.
  }

  const response = await fetch(url.toString(), { headers });
  if (!response.ok) {
    throw new Error(`OneMap search failed (${response.status})`);
  }
  return response.json();
}

/**
 * Public-transport route between two points via OneMap's Routing Service.
 * This DOES require the bearer token. start/end are "lat,lng" strings.
 *
 * NOTE: OneMap's PT routing considers all modes (any MRT line + bus) — it
 * has no "restrict to one line" filter. Restricting results to bus + NEL
 * only (per the OnTrack's scope) has to happen by filtering
 * the returned itinerary's legs after the fact, or by composing routes
 * manually from NEL_STATION_EXITS + LTA bus data instead of using this
 * endpoint directly. Kept here as the raw building block either way.
 */
function todayMMDDYYYY() {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}-${dd}-${d.getFullYear()}`;
}

export async function routePublicTransport({ start, end, date, time, mode = "TRANSIT", numItineraries = 3 }) {
  const token = await getOnemapToken();
  const url = new URL(`${ONEMAP_BASE}/api/public/routingsvc/route`);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("routeType", "pt");
  // NOTE: OneMap requires MM-DD-YYYY here, NOT ISO (YYYY-MM-DD) - confirmed
  // against a live call; ISO silently 400s with "Date must be a valid
  // calendar date in the format MM-DD-YYYY."
  url.searchParams.set("date", date || todayMMDDYYYY());
  url.searchParams.set("time", time || new Date().toTimeString().slice(0, 8));
  url.searchParams.set("mode", mode);
  // Ask for several candidate itineraries, not just one - OneMap's top pick
  // may use a different MRT line, which our NEL-only filter would then have
  // to reject. More candidates means a better chance one of them qualifies.
  // OneMap caps this at 3 (confirmed live: "numItineraries must be between
  // 1 and 3 (inclusive)") - clamp rather than pass through an invalid value.
  url.searchParams.set("numItineraries", String(Math.min(3, Math.max(1, numItineraries))));

  const response = await fetch(url.toString(), {
    headers: { Authorization: token },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OneMap routing failed (${response.status}): ${detail}`);
  }
  return response.json();
}

/**
 * Cycling route between two points via OneMap's routingsvc (routeType=cycle).
 * Confirmed live: returns { route_summary: { total_time (s), total_distance (m),
 * start_point, end_point }, route_geometry (encoded polyline), route_instructions }.
 * No date/time/mode params - the cycling graph is not time-dependent.
 * Used for the "Two-wheeler" trip option: cycle to a station, then routePublicTransport()
 * from there. The duration is OneMap's own - deliberately NOT estimated from a pace constant.
 */
async function routeSimple(routeType, { start, end }) {
  const token = await getOnemapToken();
  const url = new URL(`${ONEMAP_BASE}/api/public/routingsvc/route`);
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);
  url.searchParams.set("routeType", routeType);

  const response = await fetch(url.toString(), {
    headers: { Authorization: token },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`OneMap ${routeType} routing failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export function routeCycle(points) {
  return routeSimple("cycle", points);
}

/**
 * Walking route between two points (routeType=walk) - same response shape as cycle. Used to get a
 * REAL walk from a chosen station exit to the next stop/destination, instead of estimating it.
 */
export function routeWalk(points) {
  return routeSimple("walk", points);
}
