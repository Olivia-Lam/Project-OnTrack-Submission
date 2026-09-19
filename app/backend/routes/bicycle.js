import express from "express";
import fetch from "node-fetch";
import { readFileSync } from "node:fs";
import { ltaGet } from "../lta.js";
import { normaliseOsmElement } from "../bicycleOsm.js";

const router = express.Router();

// Two real sources, tried in order:
//   1. LTA DataMall BicycleParkingv2 - the authoritative one (rack type, rack count, shelter).
//      Currently answers 401 with our key, so it is skipped for LTA_RETRY_MS after a failure.
//   2. OpenStreetMap (amenity=bicycle_parking) via the public Overpass API - keyless, real, but
//      community-mapped so coverage is patchier than LTA's. Responses say which one they used.
// (OneMap's "LTA Bicycle Rack" theme, queryName=bicyclerack, was checked too: it currently
// returns "No result(s) found" for every extent, so it is not used.)
const LTA_RETRY_MS = 10 * 60 * 1000;
const CACHE_MS = 10 * 60 * 1000; // parking changes slowly; also keeps us polite to Overpass
const MAX_SPAN_DEG = 0.06; // ~6.6 km (checked before snapping) - refuse whole-island queries
const MAX_SPOTS = 400;
const SNAP_DEG = 0.01; // ~1.1 km: queries are snapped outward to this grid so nearby pans hit the same cache entry
const UPSTREAM_TIMEOUT_MS = 6000; // the public Overpass server can stall for minutes when busy
const OVERPASS_ENDPOINTS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];

let ltaDisabledUntil = 0;
const cache = new Map(); // key -> { at, payload }
const inflight = new Map(); // key -> Promise<payload>: identical concurrent requests share one upstream call

function bboxFromQuery(q) {
  if (q.minLat && q.minLng && q.maxLat && q.maxLng) {
    return { minLat: +q.minLat, minLng: +q.minLng, maxLat: +q.maxLat, maxLng: +q.maxLng };
  }
  if (q.lat && q.lng) {
    const km = Number(q.dist) || 0.5;
    const dLat = km / 111;
    const dLng = km / (111 * Math.cos((+q.lat * Math.PI) / 180));
    return { minLat: +q.lat - dLat, maxLat: +q.lat + dLat, minLng: +q.lng - dLng, maxLng: +q.lng + dLng };
  }
  return null;
}

// LTA gives rack types like "MRT_RACKS" / "RACKS": show them as words.
const humanizeRackType = (t) => (t ? String(t).replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()) : null);

async function fromLta(bbox) {
  const lat = (bbox.minLat + bbox.maxLat) / 2;
  const lng = (bbox.minLng + bbox.maxLng) / 2;
  const radiusKm = Math.min(2, (Math.max(bbox.maxLat - bbox.minLat, bbox.maxLng - bbox.minLng) / 2) * 111);
  const data = await ltaGet("BicycleParkingv2", { Lat: lat, Long: lng, Dist: radiusKm });
  return (data.value || [])
    .map((s, i) => ({
      id: `lta-${i}-${s.Latitude}-${s.Longitude}`,
      description: s.Description,
      lat: Number(s.Latitude),
      lng: Number(s.Longitude),
      rackType: humanizeRackType(s.RackType),
      rackCount: s.RackCount != null ? Number(s.RackCount) : null,
      sheltered: s.ShelterIndicator == null ? null : String(s.ShelterIndicator).toUpperCase() === "Y",
      operator: "LTA",
    }))
    .filter((s) => s.lat >= bbox.minLat && s.lat <= bbox.maxLat && s.lng >= bbox.minLng && s.lng <= bbox.maxLng);
}

// Parallel: the public Overpass servers are often slow or rate-limited, so ask both mirrors at once
// and take whichever answers first (each bounded by UPSTREAM_TIMEOUT_MS).
async function queryOverpass(endpoint, query) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    // Overpass rejects requests without a User-Agent (406).
    const response = await fetch(endpoint, {
      signal: controller.signal,
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "PurpleLineCompanion/0.1 (hackathon prototype)", Accept: "*/*" },
      body: `data=${encodeURIComponent(query)}`,
    });
    if (!response.ok) throw new Error(`Overpass returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fromOverpass(bbox) {
  const b = `${bbox.minLat},${bbox.minLng},${bbox.maxLat},${bbox.maxLng}`;
  const query = `[out:json][timeout:20];nwr["amenity"="bicycle_parking"](${b});out center tags ${MAX_SPOTS};`;
  const data = await Promise.any(OVERPASS_ENDPOINTS.map((ep) => queryOverpass(ep, query)));
  return (data.elements || []).map(normaliseOsmElement).filter(Boolean);
}

// A saved copy of the NEL corridor's OpenStreetMap bicycle parking (generated from Overpass, see
// data/bicycle-parking-osm-snapshot.json), used only when every live source fails so the demo still
// shows real - if slightly dated - data. Responses labelled source "osm-snapshot".
let snapshot = null;
try {
  snapshot = JSON.parse(readFileSync(new URL("../data/bicycle-parking-osm-snapshot.json", import.meta.url), "utf8"));
} catch {
  console.warn("Bicycle parking: no saved snapshot found; live sources only.");
}

function fromSnapshot(bbox) {
  const c = snapshot?.coverage;
  if (!c || bbox.minLat < c.minLat || bbox.maxLat > c.maxLat || bbox.minLng < c.minLng || bbox.maxLng > c.maxLng) return null;
  return {
    spots: snapshot.spots.filter((s) => s.lat >= bbox.minLat && s.lat <= bbox.maxLat && s.lng >= bbox.minLng && s.lng <= bbox.maxLng),
    source: "osm-snapshot",
    snapshotDate: snapshot.generatedAt,
    attribution: snapshot.attribution,
  };
}

/**
 * GET /api/bicycle/parking?minLat&minLng&maxLat&maxLng   (map viewport)
 *   or  ?lat&lng[&dist=km]                                (around a point)
 *
 * Returns { spots: [{ id, description, lat, lng, rackType, rackCount, sheltered, operator }],
 * source: "lta" | "osm" | "osm-snapshot", attribution }. 503 { unavailable: true } only if every source failed.
 */
router.get("/parking", async (req, res) => {
  const bbox = bboxFromQuery(req.query);
  if (!bbox || Object.values(bbox).some((v) => !Number.isFinite(v))) {
    return res.status(400).json({ error: "Provide minLat,minLng,maxLat,maxLng or lat,lng" });
  }
  if (bbox.maxLat - bbox.minLat > MAX_SPAN_DEG || bbox.maxLng - bbox.minLng > MAX_SPAN_DEG) {
    return res.status(400).json({ error: "Area too large - zoom in" });
  }

  // Snap outward to a coarse grid so nearby pans share one upstream query and cache entry.
  const snapped = {
    minLat: Math.floor(bbox.minLat / SNAP_DEG) * SNAP_DEG,
    minLng: Math.floor(bbox.minLng / SNAP_DEG) * SNAP_DEG,
    maxLat: Math.ceil(bbox.maxLat / SNAP_DEG) * SNAP_DEG,
    maxLng: Math.ceil(bbox.maxLng / SNAP_DEG) * SNAP_DEG,
  };
  Object.assign(bbox, snapped);
  const key = [bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng].map((n) => n.toFixed(3)).join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return res.json(hit.payload);

  async function fetchPayload() {
    if (Date.now() >= ltaDisabledUntil) {
      try {
        return { spots: await fromLta(bbox), source: "lta", attribution: "LTA DataMall" };
      } catch (err) {
        ltaDisabledUntil = Date.now() + LTA_RETRY_MS;
        console.warn(`Bicycle parking: LTA unavailable (${err.message}); using OpenStreetMap for the next 10 min.`);
      }
    }
    try {
      return { spots: await fromOverpass(bbox), source: "osm", attribution: "© OpenStreetMap contributors" };
    } catch (err) {
      const saved = fromSnapshot(bbox);
      if (saved) {
        console.warn(`Bicycle parking: live OpenStreetMap unavailable (${err.message}); serving the saved snapshot from ${saved.snapshotDate}.`);
        return { payload: saved, transient: true };
      }
      throw err;
    }
  }

  let payload;
  try {
    if (!inflight.has(key)) inflight.set(key, fetchPayload().finally(() => inflight.delete(key)));
    const result = await inflight.get(key);
    payload = result.payload || result;
    // Cache the snapshot answer for only a minute (so repeated pans are fast) and then try the live sources again.
    if (result.transient) {
      cache.set(key, { at: Date.now() - CACHE_MS + 60 * 1000, payload });
      return res.json(payload);
    }
  } catch (err) {
    console.error("Error fetching bicycle parking:", err.message);
    return res.status(503).json({ unavailable: true, error: "Bicycle parking data is unavailable", detail: err.message });
  }

  cache.set(key, { at: Date.now(), payload });
  res.json(payload);
});

export default router;
