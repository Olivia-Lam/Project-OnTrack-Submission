// Orders OneMap address suggestions so the one a person most likely means comes first.
//   1. Station entries on a line we cover, e.g. "BISHAN MRT STATION (CC15)" or "COMPASSVALE LRT STATION (SE1)".
//      OneMap also lists a bare "BISHAN MRT STATION" point, and routing from that exact point can return a much
//      worse itinerary (for example bus only) than from the station entry its router recognises.
//   2. Station entries on another line, e.g. "... (NS17)".
//   3. Everything else.
// Within each group, suggestions that contain what was typed come first ("Punggol MRT" should list
// "PUNGGOL MRT STATION (NE17)" before "PUNGGOL COAST MRT STATION (NE18)"). Otherwise OneMap's order is kept.
const COVERED_CODE = /\((?:[^)]*\b)?(?:NE|CC|SE|SW|PE|PW)\d+(?:\b[^)]*)?\)$|\((?:STC|PTC)\)$/;
const ANY_STATION_CODE = /\(\s*[A-Z]{1,3}\d+[^)]*\)$/;

export const stationRank = (label) => (COVERED_CODE.test(label) ? 0 : ANY_STATION_CODE.test(label) ? 1 : 2);

const squash = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();

export function sortSuggestions(results, query) {
  const q = squash(query);
  return results
    .map((r, i) => ({ r, i }))
    .sort(
      (a, b) =>
        stationRank(a.r.label) - stationRank(b.r.label) ||
        Number(!squash(a.r.label).includes(q)) - Number(!squash(b.r.label).includes(q)) ||
        a.i - b.i
    )
    .map((x) => x.r);
}
