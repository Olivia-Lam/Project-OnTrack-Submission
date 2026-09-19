import express from "express";
import { routePublicTransport, routeCycle, routeWalk } from "../onemap.js";

const router = express.Router();

// A missing OneMap login is the one setup problem a first-time user can hit; say exactly what to do about it.
const MISSING_ONEMAP = "Journey planning needs OneMap credentials. Set ONEMAP_EMAIL and ONEMAP_PASSWORD in .env (free: https://www.onemap.gov.sg/apidocs/register), or use the live app.";
const isMissingOnemap = (err) => /ONEMAP_EMAIL/.test(err.message);

// The rail services OnTrack covers, by OneMap route id (confirmed against live responses: leg.mode
// "SUBWAY" with route "NE" = North East Line, "CC" = Circle Line; leg.mode "TRAM" with route
// "SE"/"SW"/"PE"/"PW" = the Sengkang and Punggol LRT loops). Every other line (NS, EW, DT, TE, and the
// Bukit Panjang LRT "BP") is out of scope and rejects the whole itinerary.
const NEL_ROUTE = "NE";
const CCL_ROUTE = "CC";
const LRT_MODE = "TRAM"; // OneMap's leg.mode for LRT (observed live)
const SPLRT_ROUTES = new Set(["SE", "SW", "PE", "PW"]);

const routeOf = (leg) => leg.route || leg.routeId;

/**
 * True if every leg in this itinerary is WALK, or a mode the caller allowed (all on by default):
 *  - BUS
 *  - North East Line (allow.nel), Circle Line (allow.ccl)
 *  - Sengkang-Punggol LRT (allow.lrt)
 * Any other mode disqualifies the whole itinerary - we don't partially accept it, since a leg on
 * another line means the itinerary isn't inside the user's chosen scope any more.
 */
export function isAllowedItinerary(itinerary, allow = { nel: true, ccl: true, bus: true, lrt: true }) {
  return (itinerary.legs || []).every((leg) => {
    if (leg.mode === "WALK") return true;
    if (leg.mode === "BUS") return allow.bus;
    if (leg.mode === "SUBWAY") {
      const route = routeOf(leg);
      if (route === NEL_ROUTE) return allow.nel;
      if (route === CCL_ROUTE) return allow.ccl;
      return false;
    }
    if (leg.mode === LRT_MODE) return allow.lrt && SPLRT_ROUTES.has(routeOf(leg));
    return false; // RAIL, FERRY, or anything else - reject
  });
}

// "true"/"1" -> true, "false"/"0" -> false, missing -> the given default.
function flag(value, fallback) {
  if (value === undefined) return fallback;
  return value === "true" || value === "1";
}

const arrivalMs = (it) => it.endTime ?? (it.startTime != null ? it.startTime + it.duration * 1000 : Infinity);

// Re-rank the (max 3) candidates OneMap returned. "best" keeps OneMap's own order.
// NOTE: OneMap's PT routing has no accessibility data - a `wheelchair=true` param was tested
// live and returned identical itineraries, so it is not sent. "wheelchair" therefore ranks by
// fewest transfers then least walking as a proxy; the step-free EXIT choice is handled
// client-side by disruptions.js's applyExitPreference. Real lift data needs the LTA
// facilities feed, which is blocked by the invalid LTA_ACCOUNT_KEY.
const SORTERS = {
  best: null,
  fewerTransfers: (a, b) => a.transfers - b.transfers || a.duration - b.duration,
  lessWalking: (a, b) => a.walkDistance - b.walkDistance || a.duration - b.duration,
  earliestArrival: (a, b) => arrivalMs(a) - arrivalMs(b),
  wheelchair: (a, b) => a.transfers - b.transfers || a.walkDistance - b.walkDistance,
};

export function simplifyLeg(leg) {
  return {
    mode: leg.mode,
    distanceMeters: leg.distance,
    durationSeconds: leg.duration,
    routeId: leg.routeId || leg.route || null,
    agencyName: leg.agencyName || null, // e.g. "SBS Transit" - shown as "Service run by ..."
    startTimeMs: leg.startTime ?? null, // epoch ms - format client-side (server has no fixed locale/tz to assume)
    endTimeMs: leg.endTime ?? null,
    from: {
      name: leg.from?.name,
      lat: leg.from?.lat,
      lng: leg.from?.lon, // OneMap uses "lon", normalize to "lng" for the rest of this app
      stopCode: leg.from?.stopCode || null,
    },
    to: {
      name: leg.to?.name,
      lat: leg.to?.lat,
      lng: leg.to?.lon,
      stopCode: leg.to?.stopCode || null,
    },
    // Intermediate NEL stations passed through, if any (only present on SUBWAY legs).
    intermediateStops: (leg.intermediateStops || []).map((s) => ({
      name: s.name,
      stopCode: s.stopCode || null,
      lat: s.lat,
      lng: s.lon,
    })),
    // Encoded polyline (Google/OSRM 5-decimal-precision format) - kept for
    // any future map view, unused by the timeline UI.
    polyline: leg.legGeometry?.points || null,
  };
}

/**
 * GET /api/journey/multimodal?fromLat&fromLng&toLat&toLng[&date=MM-DD-YYYY&time=HH:MM:SS]
 *
 * Optional: allowNel, allowCcl, allowBus, allowLrt (all default true),
 * sort = best | fewerTransfers | lessWalking | earliestArrival | wheelchair.
 *
 * Plans a journey using only walking plus the modes the caller allowed (defaults:
 * bus + the North East / Purple Line) - asks OneMap for several candidate itineraries,
 * drops any that use a disallowed mode, re-ranks the rest, and returns the top one.
 * If none qualify, returns 404 rather than silently falling back to a route that
 * uses a disallowed mode.
 */
router.get("/multimodal", async (req, res) => {
  const { fromLat, fromLng, toLat, toLng, date, time } = req.query;
  const allow = {
    nel: flag(req.query.allowNel, true),
    ccl: flag(req.query.allowCcl, true),
    bus: flag(req.query.allowBus, true),
    lrt: flag(req.query.allowLrt, true),
  };
  const sort = SORTERS[req.query.sort] !== undefined ? req.query.sort : "best";
  if (!fromLat || !fromLng || !toLat || !toLng) {
    return res.status(400).json({ error: "fromLat, fromLng, toLat, toLng are all required" });
  }

  try {
    const data = await routePublicTransport({
      start: `${fromLat},${fromLng}`,
      end: `${toLat},${toLng}`,
      date,
      time,
    });

    const itineraries = data?.plan?.itineraries || [];
    const candidatesConsidered = itineraries.length;
    const allowed = itineraries.filter((it) => isAllowedItinerary(it, allow));

    if (allowed.length === 0) {
      return res.status(404).json({
        error: "No route found for the selected transport modes",
        candidatesConsidered,
        detail:
          candidatesConsidered === 0
            ? "OneMap returned no itineraries at all for this start/end pair."
            : "Every itinerary OneMap returned needed a mode you have switched off (or a different MRT line).",
      });
    }

    // Prefer an itinerary that actually rides the Purple Line or a bus over
    // a pure-walk one, when both exist among the allowed candidates - a
    // walk-only result is only useful as a last resort (e.g. no service
    // running at this hour), not because it happened to sort first.
    const withTransit = allowed.filter((it) => (it.legs || []).some((l) => l.mode !== "WALK"));
    const pool = [...(withTransit.length > 0 ? withTransit : allowed)];
    if (SORTERS[sort]) pool.sort(SORTERS[sort]);
    const isWalkOnly = withTransit.length === 0;

    // Every candidate, best first, in the same shape as the top-level route - this is what lets the UI
    // offer several options (Google-Maps style) with the ideal one on top.
    const alternatives = pool.map((it) => {
      const legs = (it.legs || []).map(simplifyLeg);
      const railLegs = legs.filter((l) => l.mode === "SUBWAY");
      return {
        startTimeMs: it.startTime ?? null,
        endTimeMs: it.endTime ?? null,
        durationSeconds: it.duration,
        walkDistanceMeters: it.walkDistance,
        transfers: it.transfers,
        fare: it.fare,
        legs,
        alightStation: railLegs.length > 0 ? railLegs[railLegs.length - 1].to : null, // { name, lat, lng, stopCode }
        isWalkOnly,
      };
    });

    res.json({
      ...alternatives[0], // the ideal route, at the top level as before (existing callers keep working)
      sort,
      alternatives,
      candidatesConsidered,
      candidatesAccepted: allowed.length,
    });
  } catch (err) {
    // OneMap answers 404 "No route found" when nothing runs at that time (e.g. before first service).
    if (err.message.includes("(404)")) {
      return res.status(404).json({ error: "No public transport route found for that time - service may not be running." });
    }
    console.error("Error planning multimodal route:", err.message);
    if (isMissingOnemap(err)) return res.status(503).json({ error: MISSING_ONEMAP });
    res.status(502).json({ error: "Failed to plan route", detail: err.message });
  }
});

/**
 * GET /api/journey/cycle?fromLat&fromLng&toLat&toLng
 *
 * One half of the "Two-wheeler" trip option: a real OneMap cycling route (first mile,
 * origin -> station). The client composes it with a /multimodal call from the station.
 */
router.get("/cycle", async (req, res) => {
  const { fromLat, fromLng, toLat, toLng } = req.query;
  if (!fromLat || !fromLng || !toLat || !toLng) {
    return res.status(400).json({ error: "fromLat, fromLng, toLat, toLng are all required" });
  }
  try {
    const data = await routeCycle({ start: `${fromLat},${fromLng}`, end: `${toLat},${toLng}` });
    const summary = data?.route_summary;
    if (!summary) {
      return res.status(404).json({ error: "No cycling route found", detail: data?.status_message || null });
    }
    res.json({
      durationSeconds: summary.total_time,
      distanceMeters: summary.total_distance,
      polyline: data.route_geometry || null,
    });
  } catch (err) {
    console.error("Error planning cycle route:", err.message);
    if (isMissingOnemap(err)) return res.status(503).json({ error: MISSING_ONEMAP });
    res.status(502).json({ error: "Failed to plan cycling route", detail: err.message });
  }
});

/**
 * GET /api/journey/walk?fromLat&fromLng&toLat&toLng
 * A real OneMap walking route (e.g. from a specific station exit to the destination).
 */
router.get("/walk", async (req, res) => {
  const { fromLat, fromLng, toLat, toLng } = req.query;
  if (!fromLat || !fromLng || !toLat || !toLng) {
    return res.status(400).json({ error: "fromLat, fromLng, toLat, toLng are all required" });
  }
  try {
    const data = await routeWalk({ start: `${fromLat},${fromLng}`, end: `${toLat},${toLng}` });
    const summary = data?.route_summary;
    if (!summary) {
      return res.status(404).json({ error: "No walking route found", detail: data?.status_message || null });
    }
    res.json({
      durationSeconds: summary.total_time,
      distanceMeters: summary.total_distance,
      polyline: data.route_geometry || null,
    });
  } catch (err) {
    console.error("Error planning walk route:", err.message);
    if (isMissingOnemap(err)) return res.status(503).json({ error: MISSING_ONEMAP });
    res.status(502).json({ error: "Failed to plan walking route", detail: err.message });
  }
});

export default router;
