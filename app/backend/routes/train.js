import express from "express";
import fetch from "node-fetch";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getLineStatuses } from "../sgmrt.js";

const router = express.Router();

// Must be https - confirmed live that plain http:// 404s on every endpoint
// regardless of path or key (LTA's gateway doesn't serve the API over
// insecure HTTP; https reaches the real API and correctly returns 401 for
// a bad/inactive key instead of a generic 404).
const LTA_BASE = "https://datamall2.mytransport.sg/ltaodataservice";

function ltaHeaders() {
  return {
    AccountKey: process.env.LTA_ACCOUNT_KEY,
    accept: "application/json",
  };
}

// --- Simulation helpers for stations SmartGS doesn't cover ---
const simulatedStationState = {};

function driftScore(current) {
  const delta = (Math.random() - 0.5) * 18; // small nudge each tick
  return Math.min(95, Math.max(5, current + delta));
}

function scoreToDensity(score) {
  if (score < 35) return "low";
  if (score < 65) return "medium";
  return "high";
}

function getSimulatedDoors(stationCode) {
  if (!simulatedStationState[stationCode]) {
    // seed each door with a different starting point so they don't all move in sync
    simulatedStationState[stationCode] = Array.from({ length: 4 }, () => 20 + Math.random() * 60);
  }
  simulatedStationState[stationCode] = simulatedStationState[stationCode].map(driftScore);

  const SEATS_PER_DOOR_ZONE = 8;

  return simulatedStationState[stationCode].map((score, i) => {
    const occupiedFraction = Math.min(1, score / 100);
    const seatsAvailable = Math.max(0, Math.round(SEATS_PER_DOOR_ZONE * (1 - occupiedFraction)));
    return {
      doorId: `D${i + 1}`,
      density: scoreToDensity(score),
      seatsAvailable,
      seatsTotal: SEATS_PER_DOOR_ZONE,
      updatedAt: new Date().toISOString(),
    };
  });
}
// --- end simulation helpers ---

/**
 * GET /api/train/alerts
 * Real-time train service alerts (disruptions, shuttle services) from LTA DataMall.
 * Falls back to the SGMRT channel (real operator announcements), then to a mocked "normal service" response.
 */
router.get("/alerts", async (req, res) => {
  // Replay mode (labelled everywhere it is shown): serve a captured or synthetic alerts file instead of the live
  // feeds, so a disruption can be demonstrated on a day when nothing is actually disrupted.
  // Set ALERTS_REPLAY to a file such as app/backend/data/captured/synthetic-nel-fault.json (see README).
  if (process.env.ALERTS_REPLAY) {
    try {
      const file = JSON.parse(readFileSync(path.resolve(process.env.ALERTS_REPLAY), "utf8"));
      return res.json({ ...file.response, source: "replay", shape: file.shape, replayLabel: file.label });
    } catch (err) {
      console.error(`ALERTS_REPLAY could not be read (${err.message}); using the live feeds instead.`);
    }
  }
  try {
    const response = await fetch(`${LTA_BASE}/TrainServiceAlerts`, {
      headers: ltaHeaders(),
    });
    if (!response.ok) {
      throw new Error(`LTA API returned ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    // LTA unavailable (e.g. the account key is rejected): use the operators' own announcements via the
    // public SGMRT channel, and only if that fails too fall back to the canned "normal service" answer.
    console.warn("LTA train alerts unavailable (%s); trying the SGMRT channel.", err.message);
    try {
      return res.json(await getLineStatuses());
    } catch (sgmrtErr) {
      console.error("SGMRT channel unavailable too, falling back to mock:", sgmrtErr.message);
      res.json({
        value: [{ Status: "0", Line: "NEL", Message: [] }],
        source: "mock",
      });
    }
  }
});

/**
 * GET /api/train/crowd/:lineCode
 * Real-time station crowd density for a given line (e.g. NEL for the Purple Line).
 */
router.get("/crowd/:lineCode", async (req, res) => {
  const { lineCode } = req.params;
  try {
    const response = await fetch(`${LTA_BASE}/PCDRealTime?TrainLine=${lineCode}`, {
      headers: ltaHeaders(),
    });
    if (!response.ok) {
      throw new Error(`LTA API returned ${response.status}`);
    }
    const data = await response.json();
    res.json(data);
  } catch (err) {
    console.error("Error fetching crowd density:", err.message);
    res.status(502).json({ error: "Failed to fetch crowd density from LTA", detail: err.message });
  }
});

/**
 * GET /api/train/door-density/:stationCode
 * Per-door crowd density + seat availability. Uses SmartGS (your friend's CV
 * service) for the one real pilot station (SMARTGS_STATION_CODE), and falls
 * back to simulated data for every other station or if the SmartGS call fails.
 */
router.get("/door-density/:stationCode", async (req, res) => {
  const { stationCode } = req.params;
  const isPilotStation = stationCode === process.env.SMARTGS_STATION_CODE;

  if (isPilotStation && process.env.SMARTGS_BASE_URL) {
    try {
      const authHeaders = process.env.SMARTGS_API_KEY
        ? { Authorization: `Bearer ${process.env.SMARTGS_API_KEY}` }
        : {};

      const [guidanceRes, seatsRes] = await Promise.all([
        fetch(`${process.env.SMARTGS_BASE_URL}/guidance`, { headers: authHeaders }),
        fetch(`${process.env.SMARTGS_BASE_URL}/seats`, { headers: authHeaders }),
      ]);

      if (!guidanceRes.ok) throw new Error(`SmartGS /guidance returned ${guidanceRes.status}`);
      const guidanceData = await guidanceRes.json();
      if (guidanceData.status !== "ok") {
        throw new Error(`SmartGS engine not ready yet (status: ${guidanceData.status})`);
      }

      // Seats is treated as optional — if it fails, doors just come back without seat info
      let seatsData = null;
      if (seatsRes.ok) {
        const parsed = await seatsRes.json();
        if (parsed.status === "ok") seatsData = parsed.seats;
      }

      const GUIDANCE_TO_DENSITY = { GREEN: "low", YELLOW: "medium", RED: "high" };
      const doors = Object.entries(guidanceData.guidance).map(([key, guidance]) => {
        const seatInfo = seatsData?.[key];
        return {
          doorId: `D${key.replace("door_", "")}`,
          density: GUIDANCE_TO_DENSITY[guidance] || "unknown",
          seatsAvailable: seatInfo ? seatInfo.available : null,
          seatsTotal: seatInfo ? seatInfo.total : null,
          updatedAt: guidanceData.updated_at,
        };
      });

      return res.json({ stationCode, doors, source: "smartgs" });
    } catch (err) {
      console.error("SmartGS call failed, falling back to simulated data:", err.message);
      // fall through to simulation below rather than breaking the UI
    }
  }

  res.json({ stationCode, doors: getSimulatedDoors(stationCode), source: "mock" });
});

export default router;