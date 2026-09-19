import express from "express";
import { searchAddress } from "../onemap.js";

const router = express.Router();

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
    const results = (data.results || []).map((r) => ({
      label: r.SEARCHVAL,
      address: r.ADDRESS,
      postal: r.POSTAL !== "NIL" ? r.POSTAL : null,
      lat: Number(r.LATITUDE),
      lng: Number(r.LONGITUDE),
    }));
    res.json({ query: q, results });
  } catch (err) {
    console.error("Error calling OneMap search:", err.message);
    res.status(502).json({ error: "Failed to search address", detail: err.message });
  }
});

export default router;
