import { api } from "../api.js";
import { MRT_STATION_CODES, stationByCode } from "../stations.js";
import { nearestStations, stationCentroid } from "../stationExits.js";

// Everything OnTrack covers is on by default: Purple Line (NEL), Circle Line, Sengkang-Punggol LRT and buses.
export const DEFAULT_TRIP_OPTIONS = { nel: true, ccl: true, bus: true, lrt: true, sort: "best", twoWheeler: false };

// Flexible Departure Optimiser: how many trial departures to compare, and how far apart.
// NOT derived from real data - real train/bus headways would come from LTA DataMall
// (PCDRealTime / bus arrival), which is blocked by the invalid LTA_ACCOUNT_KEY. 10 min is a
// UI step size: wide enough that consecutive trials land on genuinely different trips
// (each result is still a real OneMap itinerary, so the displayed times are real).
export const TRIAL_DEPARTURE_STEP_MIN = 10;
export const TRIAL_DEPARTURE_COUNT = 5;

// datetime-local value/Date -> OneMap's { date: "MM-DD-YYYY", time: "HH:MM:SS" }.
export function toOnemapDateTime(value) {
  const d = value instanceof Date ? value : new Date(value);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    date: `${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${d.getFullYear()}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:00`,
  };
}

function ptCall(fromPoint, toPoint, when, options) {
  const { date, time } = toOnemapDateTime(when);
  return api.getMultimodalRouteWithOptions({
    fromLat: fromPoint.lat,
    fromLng: fromPoint.lng,
    toLat: toPoint.lat,
    toLng: toPoint.lng,
    date,
    time,
    allowNel: options.nel,
    allowCcl: options.ccl,
    allowBus: options.bus,
    allowLrt: options.lrt,
    sort: options.sort,
  });
}

/**
 * Plans one trip at one departure time.
 *
 * Normal: a single /multimodal call.
 * Two-wheeler: two real OneMap calls composed - cycle origin -> nearest MRT station (Purple Line or Circle Line)
 * (routeType=cycle), then public transport from that station onwards, departing when the
 * cycle leg ends. Only the first mile is cycled: bikes stay at the origin-side station.
 * Bicycle parking availability at the station would come from LTA BicycleParkingv2 (blocked
 * by the invalid LTA key), so it is not shown.
 */
export async function planTrip({ fromPoint, toPoint, departAt, options = DEFAULT_TRIP_OPTIONS }) {
  const departDate = new Date(departAt);

  if (!options.twoWheeler) return ptCall(fromPoint, toPoint, departDate, options);

  const [nearest] = nearestStations(fromPoint, MRT_STATION_CODES);
  if (!nearest) throw new Error("No MRT station found to cycle to");
  const station = stationByCode(nearest.code);
  const centroid = stationCentroid(nearest.code);

  const cycle = await api.getCycleLeg({
    fromLat: fromPoint.lat,
    fromLng: fromPoint.lng,
    toLat: centroid.lat,
    toLng: centroid.lng,
  });

  const stationPoint = { label: `${station.name} MRT STATION`, lat: centroid.lat, lng: centroid.lng };
  const ptDepart = new Date(departDate.getTime() + cycle.durationSeconds * 1000);
  const pt = await ptCall(stationPoint, toPoint, ptDepart, options);

  const bikeLeg = {
    mode: "BICYCLE",
    distanceMeters: cycle.distanceMeters,
    durationSeconds: cycle.durationSeconds,
    routeId: null,
    agencyName: null,
    startTimeMs: departDate.getTime(),
    endTimeMs: ptDepart.getTime(),
    from: { name: fromPoint.label, lat: fromPoint.lat, lng: fromPoint.lng, stopCode: null },
    to: { name: stationPoint.label, lat: stationPoint.lat, lng: stationPoint.lng, stopCode: nearest.code },
    intermediateStops: [],
    polyline: cycle.polyline,
  };

  // The cycle leg is prefixed onto every option, so alternatives stay comparable and selectable.
  const withBike = (route) => ({
    ...route,
    startTimeMs: departDate.getTime(),
    durationSeconds: cycle.durationSeconds + route.durationSeconds,
    legs: [bikeLeg, ...route.legs],
  });
  const composed = withBike(pt);
  return {
    ...composed,
    alternatives: (pt.alternatives || [pt]).map(withBike),
    cycledToStation: { code: nearest.code, name: station.name, distanceMeters: cycle.distanceMeters },
  };
}

// Arrival time (epoch ms) of a planned trip - OneMap's own itinerary end time.
export function arrivalMsOf(route) {
  if (route.endTimeMs != null) return route.endTimeMs;
  const lastLeg = route.legs?.[route.legs.length - 1];
  return lastLeg?.endTimeMs ?? null;
}

/**
 * Flexible Departure Optimiser - a pure loop over planTrip().
 *
 * Given the latest acceptable arrival time, works backward:
 *  1. One probe trip departing at `arriveBy` gives a real duration D for this journey.
 *  2. Trial departures are (arriveBy - D) stepped back TRIAL_DEPARTURE_STEP_MIN each,
 *     TRIAL_DEPARTURE_COUNT times.
 *  3. Each trial is a real planTrip() call; `onTime` compares OneMap's actual arrival to arriveBy.
 * Calls run sequentially (OneMap returned 429s under bursts earlier).
 */
export async function compareDepartureTimes({ fromPoint, toPoint, arriveBy, options, onProgress }) {
  const arriveByDate = new Date(arriveBy);
  const probe = await planTrip({ fromPoint, toPoint, departAt: arriveByDate, options });
  const estimatedDepartMs = arriveByDate.getTime() - probe.durationSeconds * 1000;

  const trials = [];
  for (let i = 0; i < TRIAL_DEPARTURE_COUNT; i++) {
    const departAt = new Date(estimatedDepartMs - i * TRIAL_DEPARTURE_STEP_MIN * 60000);
    onProgress?.(i + 1, TRIAL_DEPARTURE_COUNT);
    try {
      const route = await planTrip({ fromPoint, toPoint, departAt, options });
      const arrival = arrivalMsOf(route);
      trials.push({ departAt, route, arrivalMs: arrival, onTime: arrival != null && arrival <= arriveByDate.getTime() });
    } catch (err) {
      trials.push({ departAt, route: null, error: err.message, onTime: false });
    }
  }
  return trials;
}
