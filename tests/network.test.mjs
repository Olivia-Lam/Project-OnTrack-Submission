// Checks the rail network model (no keys, no network). Backs the coverage claims in WRITEUP.md.
import test from "node:test";
import assert from "node:assert/strict";
import { ALL_STATIONS, LINES, lineStations, pathBetween, stationByCode } from "../app/frontend/src/stations.js";
import { exitsForStation } from "../app/frontend/src/stationExits.js";

test("coverage: 74 physical stations - 17 NEL, 33 Circle Line, 29 Sengkang-Punggol LRT (interchanges counted once)", () => {
  assert.equal(ALL_STATIONS.length, 74);
  assert.equal(lineStations("NEL").length, 17);
  assert.equal(lineStations("CCL").length, 33);
  assert.equal(lineStations("SPLRT").length, 29);
});

test("interchanges resolve to one physical station", () => {
  for (const [alias, canonical] of [["CC1", "NE6"], ["CC13", "NE12"], ["CC29", "NE1"], ["STC", "NE16"], ["PTC", "NE17"]]) {
    assert.equal(stationByCode(alias).code, canonical);
  }
  assert.deepEqual(stationByCode("CC1").lines.sort(), ["CCL", "NEL"]);
});

test("every station has real exit coordinates (LTA exit dataset / OneMap)", () => {
  for (const s of ALL_STATIONS) {
    const exits = exitsForStation(s.code);
    assert.ok(exits.length > 0, `${s.code} ${s.name} has no exits`);
    for (const e of exits) assert.ok(e.lat > 1.2 && e.lat < 1.5 && e.lng > 103.6 && e.lng < 104.1, `${s.code} exit out of Singapore`);
  }
});

test("line topology: Circle Line ring wraps, arm joins the ring, LRT loops take the short way", () => {
  const codes = (a, b) => pathBetween(a, b).map((s) => s.code).join(">");
  assert.equal(codes("CC33", "CC4"), "CC33>CC34>CC4"); // ring closes Bayfront -> Promenade
  assert.equal(codes("CC1", "CC6"), "CC1>CC2>CC3>CC4>CC5>CC6"); // Dhoby Ghaut arm into the loop
  assert.equal(codes("STC", "SW5"), "STC>SW8>SW7>SW6>SW5"); // same order OneMap returned for a real route
  assert.equal(codes("NE12", "NE9"), "NE12>NE11>NE10>NE9");
  assert.deepEqual(pathBetween("NE1", "CC2"), []); // different lines
});

test("line metadata", () => {
  assert.deepEqual(Object.keys(LINES), ["NEL", "CCL", "SPLRT"]);
});
