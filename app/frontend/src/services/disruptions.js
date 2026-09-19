// ============================================================================
// Disruption simulation for the hackathon demo.
//
// Architecture (per the brief):
//
//   DISRUPTION SOURCE  ->  NORMALIZED DISRUPTION  ->  WAYFINDER  ->  UI
//   MockDisruptionSource -> disruption/fault object -> apply*() below -> JourneyPlanner
//
// MockDisruptionSource is the only thing that knows the data is fake. Every
// function below it (applyDisruptionToJourney, applyDoorFault,
// applyLiftFault, applyExitToRoute, pickAlternativeExit) only deals in the
// normalized shapes -
// they don't know or care where the disruption came from. To go live later,
// replace MockDisruptionSource with something like
// LTADataMallDisruptionSource that returns the same shapes from a real
// feed; nothing in JourneyPlanner.jsx would need to change.
//
// Real Singapore sources this could plug into (verified to actually exist -
// not aspirational):
//   1. LTA DataMall - Train Service Alerts. Already integrated in this app
//      (see backend/routes/train.js's /alerts route) - reports affected
//      line, affected stations, direction, and free bus/MRT shuttle
//      availability. Best match for the line-disruption scenarios below.
//   2. LTA DataMall - GTFS-Realtime Trip Updates - delays, cancellations,
//      skipped stops. Could make rerouting react to individual train
//      delays rather than only line-wide alerts.
//   3. LTA DataMall - GTFS Schedule (Train) - the planned network/timetable,
//      useful as the baseline to diff real-time changes against.
//   4. LTA DataMall - Train Station Exit Point - real exit coordinates.
//      Already used in this app (see stationExits.js).
//   5. LTA DataMall - Facilities Maintenance - ad-hoc LIFT/escalator outage
//      reports. This is a real, existing feed, and it's the one scenario
//      below (getLiftFault) that could plausibly be backed by it directly -
//      see the note on that function.
//
// IMPORTANT: LTA does not publish a public real-time open/closed feed for
// individual platform screen doors or fare gates - so the "Platform Door
// Fault" scenario is always simulated, never backed by a real feed today.
// It's kept isolated in MockDisruptionSource.getDoorFault so it can be
// swapped for a real operator/facility API later, if one appears, without
// touching the rest of the app.
// ============================================================================

import { LINES, lineIdForCode, pathBetween, stationByCode } from "../stations.js";
import { haversineMeters, nearestExit, stationCentroid } from "../stationExits.js";

export const SCENARIOS = {
  DOOR_FAULT: "door_fault", // a platform screen door is closed - affects the recommended boarding door (Follow Journey)
  LIFT: "lift", // a lift at the recommended exit is out of service - informational only, see the "use alternative exit" toggle
  UNPLANNED: "unplanned",
  PLANNED: "planned",
};

// Stays a constant on purpose: a bridging bus is an ad-hoc substitute the operator lays on
// during an incident, so it has no timetable in any feed. LTA DataMall's Train Service Alerts
// say WHETHER free bridging buses are running, not how long the ride takes, and GTFS/BusRoutes
// only describe scheduled services. 12 min is the demo brief's figure, not measured data.
const BRIDGE_DURATION_MIN = 12;

const REASONS = {
  [SCENARIOS.UNPLANNED]: "Signalling fault",
  [SCENARIOS.PLANNED]: "Scheduled engineering works",
};

// ---------------------------------------------------------------------------
// Real bus-stop data (LTA DataMall BusStops + BusRoutes via /api/bus/stops-near-nel).
// Used by applyExitToRoute to retarget the bus leg when the chosen exit changes. The LTA key
// is currently rejected (401), so `busStops` stays null and applyExitToRoute behaves exactly as
// documented before: relabel only, keep OneMap's numbers. Nothing here invents a stop.
// ---------------------------------------------------------------------------

// How far from the chosen exit to look for a bus stop serving the same service. 400 m is the
// figure LTA itself uses as the walkable catchment for bus stops around an interchange - a
// planning rule of thumb, not something derived from this dataset.
const BUS_STOP_SEARCH_RADIUS_M = 400;
const BUS_STOP_RETRY_MS = 60 * 1000; // don't hammer the backend while LTA is down

let busStops = null; // null until real data has loaded; then [{code,name,lat,lng,services:[...]}]
let busStopsLoading = false;
let busStopsLastAttempt = 0;

/** Installs a bus-stop list (what the loader does on success; also lets tests supply data). */
export function setBusStops(list) {
  busStops = Array.isArray(list) && list.length > 0 ? list : null;
}

/** Fire-and-forget load of the real bus-stop data; silently keeps the no-data behaviour on failure. */
export function ensureBusStopsLoaded() {
  if (busStops || busStopsLoading || Date.now() - busStopsLastAttempt < BUS_STOP_RETRY_MS) return;
  busStopsLoading = true;
  busStopsLastAttempt = Date.now();
  import("../api.js")
    .then(({ api }) => api.getBusStopsNearNel())
    .then((data) => setBusStops(data.stops))
    .catch(() => {
      // 503 unavailable (LTA key rejected) or network error - stay on the documented fallback.
    })
    .finally(() => {
      busStopsLoading = false;
    });
}

if (typeof window !== "undefined") ensureBusStopsLoaded(); // warm up at load so data is ready before a journey is planned

function stationLabel(code) {
  const s = stationByCode(code);
  return s ? { code, name: s.name } : { code, name: code };
}

/**
 * Ordered list of {code, name} for every station between `fromCode` and `toCode` inclusive, along the line's
 * own topology from stations.js (NEL, Circle Line ring + arm, LRT loops). That table always covers every
 * station of the line, whereas the live route's intermediateStops isn't always present on short OneMap legs.
 */
function stationPathBetween(fromCode, toCode) {
  return pathBetween(fromCode, toCode);
}

/**
 * Given a station's exits ranked by distance to the destination (the same
 * ranking the Ideal Exit feature already uses), returns the next-best exit
 * that isn't `currentExitLabel` - i.e. "the real alternative", not just a
 * different one picked arbitrarily. Returns null if there's nothing else to
 * offer. Shared by the manual "use alternative exit" toggle and (for
 * messaging purposes) the lift-fault scenario.
 */
export function pickAlternativeExit(stationCode, currentExitLabel, destinationPoint) {
  if (!stationCode || !destinationPoint) return null;
  const ranked = nearestExit(stationCode, destinationPoint);
  if (ranked.length < 2) return null;
  return ranked.find((e) => e.exit !== currentExitLabel) || null;
}

/**
 * MockDisruptionSource - stands in for a real disruption feed. See the
 * module header for what a real replacement (LTADataMallDisruptionSource)
 * would look like and which LTA DataMall endpoints it would use.
 */
export const MockDisruptionSource = {
  /**
   * Returns a normalized line disruption for the given scenario type,
   * affecting a segment picked from `path` (the ordered stations the
   * current journey's Purple Line leg actually rides through). Returns
   * null if the path is too short to carve out a meaningful segment.
   */
  getLineDisruption(type, path) {
    if (path.length < 2) return null;

    const n = path.length - 1;
    let segmentStart, segmentEnd, hasResumeLeg;
    if (path.length <= 3) {
      // Not enough stations to show a "normal ride, then gap, then resume"
      // shape - bridge the whole leg instead.
      segmentStart = 0;
      segmentEnd = n;
      hasResumeLeg = false;
    } else {
      segmentStart = Math.min(Math.max(Math.round(n / 3), 1), n - 1);
      segmentEnd = Math.min(Math.max(Math.round((2 * n) / 3), segmentStart + 1), n - 1);
      hasResumeLeg = true;
    }

    const lineId = lineIdForCode(path[0].code);
    const lineName = LINES[lineId]?.name || "The line";
    const affectedStations = path.slice(segmentStart, segmentEnd + 1);
    const reason = REASONS[type] || "Service disruption";
    const message =
      type === SCENARIOS.PLANNED
        ? `${lineName} services between ${affectedStations[0].name} and ${affectedStations[affectedStations.length - 1].name} are unavailable due to scheduled engineering works. A Bridging Bus is operating between the affected stations. Your journey has been adjusted automatically.`
        : `A signalling fault is affecting ${lineName} services between ${affectedStations[0].name} and ${affectedStations[affectedStations.length - 1].name}. We've rerouted your journey using the Bridging Bus. Allow additional travel time.`;

    return {
      id: `${type}-${affectedStations[0].code}-${affectedStations[affectedStations.length - 1].code}`,
      type, // "unplanned" | "planned"
      active: true,
      line: lineId,
      affectedStations,
      reason,
      message,
      bridgingService: {
        label: "Bridging Bus",
        durationMinutes: BRIDGE_DURATION_MIN,
        from: affectedStations[0],
        to: affectedStations[affectedStations.length - 1],
      },
      // Internal to this module - describes how applyDisruptionToJourney
      // should splice the journey's legs; not part of the "normalized
      // disruption" a real source would need to provide.
      _reroute: { path, segmentStart, segmentEnd, hasResumeLeg },
    };
  },

  /**
   * Returns a normalized fault for the currently-recommended boarding door
   * at a station, plus a real alternative pulled from the same door list
   * Follow Journey already ranks by crowd density. Returns null if there's
   * no other door to recommend instead.
   */
  getDoorFault(doors, closedDoorId, stationName) {
    if (!doors || doors.length < 2) return null;
    const alternative = doors.find((d) => d.doorId !== closedDoorId);
    if (!alternative) return null;

    return {
      id: `door-${closedDoorId}`,
      type: "facility",
      active: true,
      station: { name: stationName },
      facilityType: "door",
      facilityId: closedDoorId,
      status: "closed",
      alternative,
      message: `Platform door ${closedDoorId} at ${stationName} is temporarily closed. Board near door ${alternative.doorId} instead.`,
    };
  },

  /**
   * Returns a normalized lift fault at the given exit. Unlike the door/exit
   * scenarios above, this maps to a real, existing LTA DataMall feed
   * (Facilities Maintenance reports ad-hoc lift/escalator outages) - so
   * this is the one facility scenario in this module that's realistic to
   * back with a real API later, not just illustrative. It's informational
   * only: it doesn't force a reroute by itself, since not every passenger
   * needs the lift - see the "use alternative exit" toggle for that.
   */
  getLiftFault(stationCode, exitLabel, destinationPoint) {
    const station = stationLabel(stationCode);
    const alternative = pickAlternativeExit(stationCode, exitLabel, destinationPoint);
    return {
      id: `lift-${stationCode}-${exitLabel}`,
      type: "facility",
      active: true,
      station,
      facilityType: "lift",
      facilityId: exitLabel,
      status: "closed",
      alternative,
      message: alternative
        ? `The lift at ${exitLabel}, ${station.name} is temporarily out of service. If you need step-free access, use the "alternative exit" toggle below to route via ${alternative.exit} instead.`
        : `The lift at ${exitLabel}, ${station.name} is temporarily out of service.`,
    };
  },
};

/**
 * Wayfinder layer: given the live journey `result` (from
 * api.getMultimodalRoute) and the active scenario key, returns the journey
 * the UI should actually render plus the disruption info for the warning
 * banner. This is the ONLY place that knows how a disruption changes a
 * journey - JourneyPlanner just calls it and renders whatever comes back,
 * rather than scattering `if (activeScenario === ...)` through its JSX.
 */
export function applyDisruptionToJourney(result, scenario) {
  if (!result || (scenario !== SCENARIOS.UNPLANNED && scenario !== SCENARIOS.PLANNED)) {
    return { result, disruption: null };
  }

  const subwayIndex = result.legs.findIndex((l) => l.mode === "SUBWAY" || l.mode === "TRAM");
  if (subwayIndex === -1) return { result, disruption: null }; // no rail leg to disrupt

  const subwayLeg = result.legs[subwayIndex];
  const path = stationPathBetween(subwayLeg.from.stopCode, subwayLeg.to.stopCode);
  const disruption = MockDisruptionSource.getLineDisruption(scenario, path);
  if (!disruption) return { result, disruption: null };

  const { segmentStart, segmentEnd, hasResumeLeg } = disruption._reroute;
  const n = path.length - 1;
  const perStopSeconds = n > 0 ? subwayLeg.durationSeconds / n : subwayLeg.durationSeconds;

  const newLegs = buildRerouteLegs({
    path,
    segmentStart,
    segmentEnd,
    hasResumeLeg,
    perStopSeconds,
    startTimeMs: subwayLeg.startTimeMs,
    agencyName: subwayLeg.agencyName,
    mode: subwayLeg.mode,
    routeId: subwayLeg.routeId,
  });

  const removedSeconds = subwayLeg.durationSeconds;
  const addedSeconds = newLegs.reduce((sum, l) => sum + l.durationSeconds, 0);

  const reroutedResult = {
    ...result,
    legs: [...result.legs.slice(0, subwayIndex), ...newLegs, ...result.legs.slice(subwayIndex + 1)],
    durationSeconds: result.durationSeconds - removedSeconds + addedSeconds,
    transfers: result.transfers + (hasResumeLeg ? 2 : 1), // onto the bridging bus, and (if applicable) back onto the NEL
  };

  return { result: reroutedResult, disruption };
}

function makeStopRef(station) {
  const centroid = stationCentroid(station.code); // may be null for a station without exit data - fine, the timeline only needs name/stopCode
  return { name: station.name, stopCode: station.code, lat: centroid?.lat ?? null, lng: centroid?.lng ?? null };
}

function buildRerouteLegs({ path, segmentStart, segmentEnd, hasResumeLeg, perStopSeconds, startTimeMs, agencyName, mode, routeId }) {
  const legs = [];
  let t = startTimeMs;

  if (segmentStart > 0) {
    const durationSeconds = Math.round(segmentStart * perStopSeconds);
    const endTimeMs = t != null ? t + durationSeconds * 1000 : null;
    legs.push({
      mode,
      routeId,
      agencyName,
      distanceMeters: null,
      durationSeconds,
      startTimeMs: t,
      endTimeMs,
      from: makeStopRef(path[0]),
      to: makeStopRef(path[segmentStart]),
      intermediateStops: path.slice(1, segmentStart).map(makeStopRef),
      polyline: null,
    });
    t = endTimeMs;
  }

  const bridgeDurationSeconds = BRIDGE_DURATION_MIN * 60;
  const bridgeEndMs = t != null ? t + bridgeDurationSeconds * 1000 : null;
  legs.push({
    mode: "BUS",
    isBridging: true, // JourneyTimeline gives this a distinct label/color while reusing the bus icon
    routeId: null,
    agencyName: "Free shuttle service",
    distanceMeters: null,
    durationSeconds: bridgeDurationSeconds,
    startTimeMs: t,
    endTimeMs: bridgeEndMs,
    from: makeStopRef(path[segmentStart]),
    to: makeStopRef(path[segmentEnd]),
    intermediateStops: [],
    polyline: null,
  });
  t = bridgeEndMs;

  if (hasResumeLeg && segmentEnd < path.length - 1) {
    const remainingStops = path.length - 1 - segmentEnd;
    const durationSeconds = Math.round(remainingStops * perStopSeconds);
    const endTimeMs = t != null ? t + durationSeconds * 1000 : null;
    legs.push({
      mode,
      routeId,
      agencyName,
      distanceMeters: null,
      durationSeconds,
      startTimeMs: t,
      endTimeMs,
      from: makeStopRef(path[segmentEnd]),
      to: makeStopRef(path[path.length - 1]),
      intermediateStops: path.slice(segmentEnd + 1, path.length - 1).map(makeStopRef),
      polyline: null,
    });
  }

  return legs;
}

/**
 * Wayfinder layer for the door-fault scenario: given the door Follow
 * Journey is currently recommending, returns the fault info plus a
 * replacement door (same shape as the sorted door list, so the existing
 * Follow Journey card doesn't need special-case rendering).
 */
export function applyDoorFault(bestDoor, doorList, stationName, scenario) {
  if (scenario !== SCENARIOS.DOOR_FAULT || !bestDoor) return { bestDoor, doorFault: null };

  const fault = MockDisruptionSource.getDoorFault(doorList, bestDoor.doorId, stationName);
  if (!fault) return { bestDoor, doorFault: null };

  return { bestDoor: fault.alternative, doorFault: fault };
}

/**
 * Wayfinder layer for the lift-fault scenario: informational only, doesn't
 * change which exit is displayed - pairs with the manual "use alternative
 * exit" toggle (applyExitPreference) for that.
 */
export function applyLiftFault(exitInfo, alightStationCode, destinationPoint, scenario) {
  if (scenario !== SCENARIOS.LIFT || !exitInfo || !alightStationCode) return null;
  return MockDisruptionSource.getLiftFault(alightStationCode, exitInfo.exit, destinationPoint);
}

/**
 * Wayfinder layer for the manual "use alternative exit" toggle - an
 * accessibility control (step-free routing for a wheelchair user, say),
 * scoped to the lift-fault scenario rather than a general-purpose feature,
 * which is why it's optional rather than always applied: it exists so a
 * lift outage doesn't silently lengthen every passenger's route. When
 * `wantAlternative` is true, swaps to the next-best real exit; otherwise
 * returns the original recommendation unchanged.
 */
export function applyExitPreference(exitInfo, alightStationCode, destinationPoint, wantAlternative) {
  if (!wantAlternative || !exitInfo || !alightStationCode) return exitInfo;
  return pickAlternativeExit(alightStationCode, exitInfo.exit, destinationPoint) || exitInfo;
}

// Singapore bus stops next to an MRT exit are routinely named after it
// literally (e.g. "KOVAN STN EXIT C", "S'GOON STN EXIT E" - both real,
// observed live from OneMap). That's a genuine, visible naming convention
// in the data itself, not an assumption we're inventing - so when a
// downstream stop's name contains the old exit's label, swapping in the
// new one keeps the whole timeline's *story* consistent (you're told
// everywhere that you're now going via the new exit, not just at the
// station). Numbers for that swapped leg are deliberately left as they
// were, though - see the function doc comment for why.
function swapExitReference(stop, oldExitLabel, newExitLabel) {
  if (!stop?.name || !stop.name.toLowerCase().includes(oldExitLabel.toLowerCase())) return stop;
  const pattern = new RegExp(oldExitLabel.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const matched = stop.name.match(pattern)?.[0] ?? oldExitLabel;
  // Real stop names in this data are ALL CAPS ("KOVAN STN EXIT C") while our
  // exit labels are Title Case ("Exit C") - match the surrounding
  // convention rather than inserting mixed case mid-name.
  const replacement = matched === matched.toUpperCase() ? newExitLabel.toUpperCase() : newExitLabel;
  return { ...stop, name: stop.name.replace(pattern, replacement) };
}

/**
 * With real bus-stop data loaded: when the leg right after the station is a walk to a bus stop
 * followed by a BUS leg, finds the nearest real stop to the CHOSEN exit that the same service
 * calls at, and re-points both legs to it. Returns null (caller keeps the plain relabel) when there
 * is no data, no matching stop, or the geometry is unusable.
 *
 * The walk is scaled the same way the final-walk case is: OneMap's real walk distance times
 * (chosen exit -> new stop) / (default exit -> original stop), both straight-line from real
 * coordinates. Still approximated: the bus ride itself keeps OneMap's duration (same service, but
 * boarding a different stop could shift it slightly - BusRoutes' per-stop cumulative distance
 * could refine this later).
 */
function retargetBoardingStop(legs, walkIdx, chosenExit, defaultExitInfo) {
  ensureBusStopsLoaded();
  if (!busStops) return null;

  const walk = legs[walkIdx];
  const bus = legs[walkIdx + 1];
  if (!walk || !bus || walk.mode !== "WALK" || bus.mode !== "BUS" || !bus.routeId) return null;
  if (!defaultExitInfo || walk.to?.lat == null || walk.to?.lng == null) return null;

  const oldDistance = haversineMeters(defaultExitInfo, walk.to);
  if (!(oldDistance > 0)) return null;

  const nearest = busStops
    .filter((s) => s.services.some((svc) => String(svc).toLowerCase() === String(bus.routeId).toLowerCase()))
    .map((s) => ({ stop: s, distanceMeters: haversineMeters(chosenExit, s) }))
    .filter((c) => c.distanceMeters <= BUS_STOP_SEARCH_RADIUS_M)
    .sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
  if (!nearest) return null;

  const scale = nearest.distanceMeters / oldDistance;
  const newStopRef = { name: nearest.stop.name, stopCode: nearest.stop.code, lat: nearest.stop.lat, lng: nearest.stop.lng };
  const newWalk = {
    ...walk,
    to: newStopRef,
    distanceMeters: Math.round(walk.distanceMeters * scale),
    durationSeconds: Math.round(walk.durationSeconds * scale),
  };
  const newBus = { ...bus, from: newStopRef };
  const next = [...legs];
  next[walkIdx] = newWalk;
  next[walkIdx + 1] = newBus;
  return { legs: next, durationDelta: newWalk.durationSeconds - walk.durationSeconds };
}

/**
 * Rewrites the journey's route to always show which exit to use - not just
 * the Ideal Exit card. Always renames the alighting stop (so the journey
 * timeline shows e.g. "FARRER PARK MRT STATION (Exit C)"), and this runs
 * unconditionally whenever a recommended exit exists, not only while a
 * lift-fault scenario is active: `chosenExit` is whatever exit Ideal Exit
 * is currently showing (the default nearest one most of the time, or the
 * step-free alternative when that toggle is on), and `defaultExitInfo` is
 * always the original nearest recommendation - the same object as
 * `chosenExit` when nothing has been toggled, which naturally makes every
 * adjustment below a no-op (scale factor of 1, nothing to swap) in the
 * common case.
 *
 * For every leg from the station onward, any stop whose name references
 * the default exit (e.g. a bus stop literally named "KOVAN STN EXIT C")
 * gets that reference swapped to whichever exit is now chosen - see
 * swapExitReference() above. This keeps the whole timeline's naming
 * internally consistent instead of showing one exit at the station and a
 * different one two rows later.
 *
 * Distance/duration are only ever recomputed for ONE specific leg: the one
 * immediately after the station, and only if it's also the LAST leg in the
 * whole itinerary (walks straight to the final destination, nothing after
 * it). Rather than computing a fresh straight-line distance for the new
 * exit - which would mix a real, road-aware distance (OneMap's original
 * number) with a naive as-the-crow-flies one, and could easily make a
 * *farther* exit look like a *shorter* walk - this scales the leg's
 * REAL original distance/duration by how much farther the chosen exit is
 * than the default one in straight-line terms (both already computed by
 * nearestExit(), so no new distance math is needed). That guarantees a
 * farther exit always shows as a longer walk, never a shorter one, while
 * still being grounded in OneMap's real number rather than a fabricated
 * absolute distance.
 *
 * UPDATE: when real bus-stop data has loaded (see retargetBoardingStop above), the walk to the
 * bus stop next to the station is re-pointed to the real stop nearest the chosen exit that the
 * same service calls at. Without that data (LTA key rejected) the paragraph below still applies.
 *
 * Every other renamed leg (a walk to a specific bus stop, the bus ride
 * itself, etc.) keeps its ORIGINAL numbers - we have no way to know how
 * far the equivalent stop near a *different* exit actually is, or whether
 * the same bus service even runs from there. That would need real
 * bus-stop-proximity data (LTA DataMall's Bus Stops/Bus Routes, neither
 * integrated here). Relabeling those legs without pretending to know their
 * new numbers is the honest middle ground: consistent story, unverified
 * timing - not a fabricated one.
 *
 * No-ops (returns `result` unchanged) if there's no Purple Line leg or no
 * exit to show.
 */
export function applyExitToRoute(result, chosenExit, defaultExitInfo) {
  if (!result || !chosenExit) return result;

  const subwayIndexes = result.legs.reduce((acc, l, i) => (l.mode === "SUBWAY" ? [...acc, i] : acc), []);
  if (subwayIndexes.length === 0) return result;

  const lastSubwayIdx = subwayIndexes[subwayIndexes.length - 1];
  const subwayLeg = result.legs[lastSubwayIdx];
  const nextLeg = result.legs[lastSubwayIdx + 1];
  const nextLegIsFinal = !!nextLeg && lastSubwayIdx + 1 === result.legs.length - 1;
  const labeledStop = {
    ...subwayLeg.to,
    name: `${subwayLeg.to.name} (${chosenExit.exit})`,
    lat: chosenExit.lat,
    lng: chosenExit.lng,
  };

  const newLegs = [...result.legs];
  newLegs[lastSubwayIdx] = { ...subwayLeg, to: labeledStop };

  let durationDelta = 0;
  if (nextLegIsFinal && (nextLeg.mode === "WALK" || nextLeg.mode === "BUS")) {
    const updatedLeg = { ...nextLeg, from: labeledStop };

    if (nextLeg.mode === "WALK" && defaultExitInfo?.distanceMeters > 0) {
      const scaleFactor = chosenExit.distanceMeters / defaultExitInfo.distanceMeters;
      const newDistance = Math.round(nextLeg.distanceMeters * scaleFactor);
      const newDuration = Math.round(nextLeg.durationSeconds * scaleFactor);
      updatedLeg.distanceMeters = newDistance;
      updatedLeg.durationSeconds = newDuration;
      durationDelta = newDuration - nextLeg.durationSeconds;
    }
    // BUS as the final leg: only relabel the boarding point - numbers are
    // left alone, same reasoning as the non-final case below.

    newLegs[lastSubwayIdx + 1] = updatedLeg;
  } else if (nextLeg && defaultExitInfo && chosenExit.exit !== defaultExitInfo.exit) {
    // Not the final leg (e.g. a walk to a specific bus stop, then more
    // transit) - relabel any exit references downstream so the story stays
    // consistent, but leave every number exactly as OneMap gave it.
    for (let i = lastSubwayIdx + 1; i < newLegs.length; i++) {
      const leg = newLegs[i];
      const from = swapExitReference(leg.from, defaultExitInfo.exit, chosenExit.exit);
      const to = swapExitReference(leg.to, defaultExitInfo.exit, chosenExit.exit);
      if (from !== leg.from || to !== leg.to) newLegs[i] = { ...leg, from, to };
    }

    // Real bus-stop upgrade (no-op until LTA BusStops/BusRoutes data has loaded).
    const retargeted = retargetBoardingStop(newLegs, lastSubwayIdx + 1, chosenExit, defaultExitInfo);
    if (retargeted) {
      newLegs.splice(0, newLegs.length, ...retargeted.legs);
      durationDelta += retargeted.durationDelta;
    }
  }

  return { ...result, legs: newLegs, durationSeconds: result.durationSeconds + durationDelta };
}
