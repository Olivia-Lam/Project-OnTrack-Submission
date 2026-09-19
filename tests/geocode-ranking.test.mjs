import test from "node:test";
import assert from "node:assert/strict";
import { sortSuggestions } from "../app/backend/stationRank.js";

const labels = (rs) => rs.map((r) => r.label);

test("station entries on covered lines come before bare places", () => {
  const out = sortSuggestions([{ label: "BISHAN MRT STATION" }, { label: "BISHAN MRT STATION (CC15)" }], "Bishan MRT");
  assert.deepEqual(labels(out), ["BISHAN MRT STATION (CC15)", "BISHAN MRT STATION"]);
});

test("within a group, the suggestion containing the typed text comes first", () => {
  const out = sortSuggestions(
    [{ label: "PUNGGOL COAST MRT STATION (NE18)" }, { label: "PUNGGOL MRT STATION (NE17)" }],
    "Punggol MRT"
  );
  assert.deepEqual(labels(out), ["PUNGGOL MRT STATION (NE17)", "PUNGGOL COAST MRT STATION (NE18)"]);
});

test("otherwise OneMap's order is kept", () => {
  const out = sortSuggestions([{ label: "B" }, { label: "A" }], "zzz");
  assert.deepEqual(labels(out), ["B", "A"]);
});
