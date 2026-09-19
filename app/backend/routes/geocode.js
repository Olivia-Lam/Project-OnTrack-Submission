import express from "express";
import { searchAddress } from "../onemap.js";

const router = express.Router();

// 0 = station entry on a covered line, e.g. "BISHAN MRT STATION (CC15)" or "COMPASSVALE LRT STATION (SE1)";
// 1 = station entry on another line, e.g. "... (NS17)"; 2 = everything else, keeping OneMap's order.
const COVERED_CODE = /\((?:[^)]*\b)?(?:NE|CC|SE|SW|PE|PW)\d+(?:\b[^)]*)?\)$|\((?:STC|PTC)\)$/;
const ANY_STATION_CODE = /\(\s*[A-Z]{1,3}\d+[^)]*\)$/;
const stationRank = (label) => (COVERED_CODE.test(label) ? 0 : ANY_STATION_CODE.test(label) ? 1 : 2);

/**
 * GET /api/geocode/search?q=<free text address or postal code>
 *
 * Address autocomplete/geocoding, proxied through the backend (same
 * gatekeeper pattern as /api/train) so the frontend never needs to know
 * OneMap exists. Returns a trimmed-down shape instead of OneMap's raw
 * SEARCHVAL/POSTAL/LATITUDE/LONGITUDE strings.
 */
router.get("/search", async (req, res) => {
  const q = (req.query.q || "").trim();
  if (!q) {
    return res.status(400).json({ error: "q is required" });
  }

  try {
    const data = await searchAddress(q);
    const results = (data.results || [])
      .map((r) => ({
        label: r.SEARCHVAL,
        address: r.ADDRESS,
        postal: r.POSTAL !== "NIL" ? r.POSTAL : null,
        lat: Number(r.LATITUDE),
        lng: Number(r.LONGITUDE),
      }))
      // Stable sort: station entries that carry a line code come first. OneMap also lists a bare "BISHAN MRT STATION"
      // point, and routing from that exact point can return a much worse itinerary (e.g. bus only) than from the
      // station entry that OneMap's router recognises as the station.
      .sort((a, b) => stationRank(a.label) - stationRank(b.label));
    res.json({ query: q, results });
  } catch (err) {
    console.error("Error calling OneMap search:", err.message);
    res.status(502).json({ error: "Failed to search address", detail: err.message });
  }
});

export default router;
