// Checks the disruption / exit re-routing logic. All journeys here are SYNTHETIC test fixtures, not live routes.
import test from "node:test";
import assert from "node:assert/strict";
import * as D from "../app/frontend/src/services/disruptions.js";
import { nearestExit } from "../app/frontend/src/stationExits.js";

const journey = (mode, routeId, from, to) => ({
  durationSeconds: 1200, transfers: 0,
  legs: [
    { mode: "WALK", from: { name: "A" }, to: { name: "S1" }, distanceMeters: 100, durationSeconds: 120, startTimeMs: 0, endTimeMs: 1 },
    { mode, routeId, agencyName: "X", from: { name: "S1", stopCode: from }, to: { name: "S2", stopCode: to }, durationSeconds: 900, distanceMeters: 5000, startTimeMs: 1000, endTimeMs: 2000, intermediateStops: [] },
    { mode: "WALK", from: { name: "S2" }, to: { name: "B" }, distanceMeters: 100, durationSeconds: 120 },
  ],
});

test("the exported contract other code depends on is intact", () => {
  for (const n of ["SCENARIOS", "pickAlternativeExit", "applyDisruptionToJourney", "applyDoorFault", "applyLiftFault", "applyExitPreference", "applyExitToRoute"]) {
    assert.ok(n in D, `missing export ${n}`);
  }
});

for (const [label, mode, route, from, to, lineName] of [
  ["North East Line", "SUBWAY", "NE", "NE12", "NE6", "North East Line"],
  ["Circle Line", "SUBWAY", "CC", "CC9", "CC15", "Circle Line"],
  ["Sengkang-Punggol LRT", "TRAM", "SW", "STC", "SW5", "Sengkang-Punggol LRT"],
]) {
  test(`planned disruption on the ${label} inserts a bridging bus and names the line`, () => {
    const { result, disruption } = D.applyDisruptionToJourney(journey(mode, route, from, to), D.SCENARIOS.PLANNED);
    assert.ok(disruption, "expected a disruption");
    assert.match(disruption.message, new RegExp(lineName));
    assert.ok(result.legs.some((l) => l.isBridging), "expected a bridging bus leg");
    assert.ok(result.legs.filter((l) => l.mode === mode).length >= 1, "rail legs keep their mode");
  });
}

test("exit change: numbers untouched without bus-stop data; retargets a real-shaped stop when data is supplied (SYNTHETIC stops)", () => {
  const exits = nearestExit("NE13", { lat: 1.362, lng: 103.899 });
  const [def, alt] = exits;
  const stop = { name: "STOP NEAR DEFAULT", stopCode: "T1", lat: def.lat + 0.0003, lng: def.lng };
  const result = { durationSeconds: 1500, transfers: 1, legs: [
    { mode: "SUBWAY", routeId: "NE", from: { name: "X", stopCode: "NE12" }, to: { name: "KOVAN", stopCode: "NE13", lat: def.lat, lng: def.lng }, durationSeconds: 600, distanceMeters: 1 },
    { mode: "WALK", from: { name: "KOVAN" }, to: stop, distanceMeters: 60, durationSeconds: 80 },
    { mode: "BUS", routeId: "43", from: stop, to: { name: "Z", stopCode: "Z" }, distanceMeters: 2000, durationSeconds: 500 },
    { mode: "WALK", from: { name: "Z" }, to: { name: "Dest" }, distanceMeters: 100, durationSeconds: 120 },
  ] };
  D.setBusStops(null);
  assert.equal(D.applyExitToRoute(result, alt, def).legs[1].distanceMeters, 60); // no data: honest relabel only
  D.setBusStops([
    { code: "T-NEAR", name: "NEAR ALT", lat: alt.lat + 0.0002, lng: alt.lng, services: ["43"] },
    { code: "T-WRONG", name: "WRONG SERVICE (closer)", lat: alt.lat + 0.00005, lng: alt.lng, services: ["12"] },
  ]);
  const out = D.applyExitToRoute(result, alt, def);
  assert.equal(out.legs[2].from.stopCode, "T-NEAR"); // the stop that actually serves the bus, not the closer one that doesn't
  D.setBusStops(null);
});
