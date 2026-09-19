import express from "express";
import { ltaGetAll } from "../lta.js";

const router = express.Router();

// Rectangle around every covered line - the NEL, the Circle Line (west to Kent Ridge / Haw Par Villa) and the
// Sengkang-Punggol LRT - plus a margin, so we only hand the frontend the bus stops that could sit beside a
// station exit, not all ~5k.
const NEL_BBOX = { minLat: 1.25, maxLat: 1.43, minLng: 103.76, maxLng: 103.935 };
const CACHE_MS = 24 * 60 * 60 * 1000; // stops/routes change rarely; refetching ~60 pages per request would be wasteful

let cache = null; // { at, stops }
let inflight = null;

async function buildStops() {
  const [allStops, allRoutes] = await Promise.all([ltaGetAll("BusStops"), ltaGetAll("BusRoutes")]);
  const inBox = allStops.filter(
    (s) => s.Latitude >= NEL_BBOX.minLat && s.Latitude <= NEL_BBOX.maxLat && s.Longitude >= NEL_BBOX.minLng && s.Longitude <= NEL_BBOX.maxLng
  );
  const servicesByStop = new Map();
  for (const r of allRoutes) {
    if (!servicesByStop.has(r.BusStopCode)) servicesByStop.set(r.BusStopCode, new Set());
    servicesByStop.get(r.BusStopCode).add(r.ServiceNo);
  }
  return inBox.map((s) => ({
    code: s.BusStopCode,
    name: s.Description,
    road: s.RoadName,
    lat: s.Latitude,
    lng: s.Longitude,
    services: [...(servicesByStop.get(s.BusStopCode) || [])],
  }));
}

/**
 * GET /api/bus/stops-near-nel
 * Real bus stops along the NEL corridor with the services that call at each (LTA BusStops +
 * BusRoutes). Fails with 503 { unavailable: true } when the LTA key is rejected - the caller
 * must then fall back to its documented no-data behaviour.
 */
router.get("/stops-near-nel", async (req, res) => {
  try {
    if (!cache || Date.now() - cache.at > CACHE_MS) {
      inflight = inflight || buildStops().finally(() => (inflight = null));
      cache = { at: Date.now(), stops: await inflight };
    }
    res.json({ stops: cache.stops, source: "lta" });
  } catch (err) {
    console.error("Error fetching bus stops:", err.message);
    res.status(503).json({ unavailable: true, error: "Bus stop data is unavailable", detail: err.message });
  }
});

export default router;
