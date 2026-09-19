import express from "express";
import fetch from "node-fetch";
import { routePublicTransport } from "../onemap.js";
import { isAllowedItinerary } from "./multimodal.js";

const router = express.Router();

const AGNES_BASE = "https://apihub.agnes-ai.com/v1";
const AGNES_MODEL = "agnes-2.5-flash";

router.post("/recommend", async (req, res) => {
  const { fromName, toName, stops, etaMinutes, hasDisruption, doors, bestDoor } = req.body || {};

  if (!fromName || !toName) {
    return res.status(400).json({ error: "fromName and toName are required" });
  }
  if (!process.env.AGNES_API_KEY) {
    return res.status(503).json({ error: "AGNES_API_KEY is not set on the backend" });
  }

  const doorSummary = Array.isArray(doors)
    ? doors.map((d) => `${d.doorId}: ${d.density}`).join(", ")
    : "not available";

  const userPrompt = `Journey data:
- From: ${fromName}
- To: ${toName}
- Stops: ${stops}
- Estimated time: ${etaMinutes} minutes
- Service status: ${hasDisruption ? "disruption reported on the line" : "normal service"}
- Door crowd density at destination platform: ${doorSummary}
- Recommended boarding door: ${bestDoor ? bestDoor.doorId : "not available"}

Write a short, friendly 2-4 sentence commuter summary of this journey, then one
proactive tip. Plain language, no markdown, no headers, no bullet points.`;

  try {
    const response = await fetch(`${AGNES_BASE}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AGNES_API_KEY}` },
      body: JSON.stringify({
        model: AGNES_MODEL,
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant embedded in a Singapore MRT commuter app for the North East (Purple) Line. You turn structured journey data into short, friendly, practical guidance.",
          },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.6,
        max_tokens: 200,
      }),
    });
    if (!response.ok) throw new Error(`Agnes AI returned ${response.status}: ${await response.text()}`);
    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("Agnes AI returned no content");
    res.json({ recommendation: text });
  } catch (err) {
    console.error("Error calling Agnes AI:", err.message);
    res.status(502).json({ error: "Failed to get AI recommendation", detail: err.message });
  }
});

function comfortScoreForTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const minutesSinceMidnight = h * 60 + m;
  const morningPeak = 8 * 60 + 15;
  const eveningPeak = 18 * 60 + 15;
  const distToPeak = Math.min(
    Math.abs(minutesSinceMidnight - morningPeak),
    Math.abs(minutesSinceMidnight - eveningPeak)
  );
  return Math.max(0, Math.round(100 - distToPeak * 1.2));
}

function scoreToDensity(score) {
  if (score < 35) return "low";
  if (score < 65) return "medium";
  return "high";
}

/**
 * GET /api/journey/best-departure?fromLat&fromLng&toLat&toLng&arrivalWindowStart&arrivalWindowEnd&date
 * (GET + query params, matching /api/journey/multimodal's pattern)
 */
router.get("/best-departure", async (req, res) => {
  const { fromLat, fromLng, toLat, toLng, arrivalWindowStart, arrivalWindowEnd, date } = req.query;

  if (!fromLat || !fromLng || !toLat || !toLng || !arrivalWindowStart || !arrivalWindowEnd) {
    return res.status(400).json({
      error: "fromLat, fromLng, toLat, toLng, arrivalWindowStart and arrivalWindowEnd are required",
    });
  }

  const start = `${fromLat},${fromLng}`;
  const end = `${toLat},${toLng}`;

  const CANDIDATE_COUNT = 7;
  const STEP_MINUTES = 10;
  const [endH, endM] = arrivalWindowEnd.split(":").map(Number);

  const results = [];

  // All times here are Singapore time, computed explicitly: Cloud Run (and most servers) run in UTC, so
  // using the server's local clock would shift every departure by 8 hours. Singapore has no daylight
  // saving, so a fixed UTC+8 offset is exact.
  const SGT_OFFSET_HOURS = 8;
  const fmtSgt = (ms, withSeconds = false) =>
    new Date(ms).toLocaleTimeString("en-GB", {
      timeZone: "Asia/Singapore",
      hourCycle: "h23",
      hour: "2-digit",
      minute: "2-digit",
      ...(withSeconds ? { second: "2-digit" } : {}),
    });
  let [year, month, day] = [0, 0, 0];
  if (date) {
    const [mm, dd, yyyy] = date.split("-").map(Number); // OneMap format MM-DD-YYYY
    [year, month, day] = [yyyy, mm, dd];
  } else {
    const sgtNow = new Date(Date.now() + SGT_OFFSET_HOURS * 3600 * 1000);
    [year, month, day] = [sgtNow.getUTCFullYear(), sgtNow.getUTCMonth() + 1, sgtNow.getUTCDate()];
  }
  const routeDate = date || `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}-${year}`;

  for (let i = 0; i < CANDIDATE_COUNT; i++) {
    const minutesBeforeEnd = 20 + i * STEP_MINUTES;
    const depMs = Date.UTC(year, month - 1, day, endH - SGT_OFFSET_HOURS, endM - minutesBeforeEnd, 0);
    const depTimeStr = fmtSgt(depMs, true);

    try {
      const route = await routePublicTransport({ start, end, date: routeDate, time: depTimeStr, numItineraries: 3 });
      const itineraries = route?.plan?.itineraries || [];
      const allowed = itineraries.filter((it) => isAllowedItinerary(it)) // wrapped: filter would otherwise pass the index as the `allow` argument;
      if (allowed.length === 0) continue;

      const withTransit = allowed.filter((it) => (it.legs || []).some((l) => l.mode !== "WALK"));
      const itinerary = (withTransit.length > 0 ? withTransit : allowed)[0];

      const arrivalTimeStr = fmtSgt(itinerary.endTime);
      const durationMinutes = Math.round(itinerary.duration / 60);

      const withinWindow = arrivalTimeStr >= arrivalWindowStart && arrivalTimeStr <= arrivalWindowEnd;
      if (!withinWindow) continue;

      const departureTime = depTimeStr.slice(0, 5);
      results.push({
        departureTime,
        arrivalTime: arrivalTimeStr,
        durationMinutes,
        crowdLevel: scoreToDensity(comfortScoreForTime(departureTime)),
      });
    } catch (err) {
      console.error(`OneMap routing failed for candidate ${depTimeStr}:`, err.message);
    }
  }

  if (results.length === 0) {
    return res.json({
      candidates: [],
      source: "onemap",
      note: "No candidates landed within that arrival window using bus + Purple Line only — try widening it.",
    });
  }

  const seen = new Set();
  const deduped = results.filter((r) => (seen.has(r.departureTime) ? false : seen.add(r.departureTime)));
  deduped.sort((a, b) => (a.crowdLevel === b.crowdLevel ? 0 : a.crowdLevel === "low" ? -1 : 1));

  res.json({
    candidates: deduped.map((r, i) => ({ ...r, recommended: i === 0 })),
    source: "onemap+simulated-crowd",
  });
});

export default router;