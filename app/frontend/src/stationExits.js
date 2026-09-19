// Real MRT exit coordinates for North East Line (Purple Line) stations,
// sourced from LTA's MRTStationExit GeoJSON dataset (data.gov.sg / OneMap),
// with Punggol Coast (NE18) sourced from OneMap's search index instead (see
// its own comment below - that station postdates the GeoJSON snapshot used
// here). Coordinates are { lat, lng } in decimal degrees (WGS84), per exit.
//
// Covers every station currently in stations.js's NEL_STATIONS. If a new
// station is ever added there, add its exits here too, or the Ideal Exit /
// Lift Not Working features will silently have nothing to show for it -
// Woodleigh and Punggol Coast both hit exactly this gap: stations.js grew
// to include them after this file was originally built, and nothing
// flagged the mismatch since a missing station here just quietly renders
// no Ideal Exit card rather than erroring.
//
// Known source-data quirks, kept as-is rather than silently "corrected":
// - HarbourFront (NE1) has two "Exit A" entries at different coordinates.
// - Buangkok (NE15) has one exit labeled just "A" (missing the "Exit " prefix
//   the rest of the dataset uses) instead of "Exit A".
// Verify on-site if exact exit identity matters for your use case.
import { canonicalCode } from "./stations.js";
import { EXTRA_STATION_EXITS } from "./railData.js";

export const NEL_STATION_EXITS = {
  NE1: [ // HarbourFront
    { exit: "Exit A", lat: 1.265085, lng: 103.82251 },
    { exit: "Exit A", lat: 1.266013, lng: 103.820468 },
    { exit: "Exit B", lat: 1.265155, lng: 103.820509 },
    { exit: "Exit C", lat: 1.26526, lng: 103.822532 },
    { exit: "Exit D", lat: 1.265979, lng: 103.821399 },
    { exit: "Exit E", lat: 1.264972, lng: 103.82158 },
  ],
  NE3: [ // Outram Park
    { exit: "Exit 1", lat: 1.281602, lng: 103.838658 },
    { exit: "Exit 2", lat: 1.281675, lng: 103.838935 },
    { exit: "Exit 3", lat: 1.280993, lng: 103.839789 },
    { exit: "Exit 4", lat: 1.280213, lng: 103.840387 },
    { exit: "Exit 5", lat: 1.278947, lng: 103.839549 },
    { exit: "Exit 6", lat: 1.279051, lng: 103.838537 },
    { exit: "Exit 7", lat: 1.281022, lng: 103.83864 },
    { exit: "Exit 8", lat: 1.282322, lng: 103.838117 },
  ],
  NE4: [ // Chinatown
    { exit: "Exit A", lat: 1.283713, lng: 103.843798 },
    { exit: "Exit C", lat: 1.284675, lng: 103.842813 },
    { exit: "Exit D", lat: 1.285406, lng: 103.843476 },
    { exit: "Exit E", lat: 1.285044, lng: 103.844428 },
    { exit: "Exit F", lat: 1.284275, lng: 103.845463 },
    { exit: "Exit G", lat: 1.284736, lng: 103.844459 },
  ],
  NE5: [ // Clarke Quay
    { exit: "Exit A", lat: 1.286899, lng: 103.846065 },
    { exit: "Exit B", lat: 1.287806, lng: 103.845903 },
    { exit: "Exit C", lat: 1.289384, lng: 103.846666 },
    { exit: "Exit E", lat: 1.289, lng: 103.847033 },
    { exit: "Exit F", lat: 1.289406, lng: 103.84713 },
    { exit: "Exit G", lat: 1.289199, lng: 103.846594 },
  ],
  NE6: [ // Dhoby Ghaut
    { exit: "Exit A", lat: 1.298445, lng: 103.846788 },
    { exit: "Exit B", lat: 1.299056, lng: 103.84523 },
    { exit: "Exit C", lat: 1.299649, lng: 103.844748 },
    { exit: "Exit D", lat: 1.299931, lng: 103.84503 },
    { exit: "Exit E", lat: 1.299748, lng: 103.845372 },
    { exit: "Exit F", lat: 1.299635, lng: 103.845842 },
  ],
  NE7: [ // Little India
    { exit: "Exit A", lat: 1.305605, lng: 103.84936 },
    { exit: "Exit B", lat: 1.306564, lng: 103.848985 },
    { exit: "Exit C", lat: 1.306352, lng: 103.849705 },
    { exit: "Exit D", lat: 1.306855, lng: 103.849 },
    { exit: "Exit E", lat: 1.307426, lng: 103.850322 },
    { exit: "Exit F", lat: 1.307684, lng: 103.848304 },
  ],
  NE8: [ // Farrer Park
    { exit: "Exit A", lat: 1.312327, lng: 103.854773 },
    { exit: "Exit B", lat: 1.313544, lng: 103.854764 },
    { exit: "Exit C", lat: 1.311911, lng: 103.853267 },
    { exit: "Exit D", lat: 1.312454, lng: 103.852975 },
    { exit: "Exit E", lat: 1.311884, lng: 103.852651 },
    { exit: "Exit F", lat: 1.311422, lng: 103.853199 },
    { exit: "Exit G", lat: 1.312259, lng: 103.855501 },
    { exit: "Exit H", lat: 1.311884, lng: 103.856099 },
    { exit: "Exit I", lat: 1.311766, lng: 103.855807 },
  ],
  NE9: [ // Boon Keng
    { exit: "Exit A", lat: 1.320107, lng: 103.861502 },
    { exit: "Exit B", lat: 1.319235, lng: 103.861904 },
    { exit: "Exit C", lat: 1.317915, lng: 103.860707 },
  ],
  NE10: [ // Potong Pasir
    { exit: "Exit A", lat: 1.332801, lng: 103.868966 },
    { exit: "Exit B", lat: 1.331148, lng: 103.869333 },
    { exit: "Exit C", lat: 1.331067, lng: 103.868704 },
  ],
  NE11: [ // Woodleigh
    { exit: "Exit A", lat: 1.338511, lng: 103.870941 },
    { exit: "Exit B", lat: 1.338583, lng: 103.870508 },
    { exit: "Exit C", lat: 1.339867, lng: 103.871054 },
  ],
  NE12: [ // Serangoon
    { exit: "Exit A", lat: 1.349482, lng: 103.873957 },
    { exit: "Exit B", lat: 1.349834, lng: 103.873641 },
    { exit: "Exit C", lat: 1.350595, lng: 103.873694 },
    { exit: "Exit D", lat: 1.349902, lng: 103.874322 },
    { exit: "Exit E", lat: 1.35082, lng: 103.872902 },
    { exit: "Exit F", lat: 1.350948, lng: 103.871449 },
    { exit: "Exit G", lat: 1.35079, lng: 103.872867 },
    { exit: "Exit H", lat: 1.349728, lng: 103.873546 },
  ],
  NE13: [ // Kovan
    { exit: "Exit A", lat: 1.359708, lng: 103.884307 },
    { exit: "Exit B", lat: 1.360206, lng: 103.884722 },
    { exit: "Exit C", lat: 1.360028, lng: 103.885451 },
  ],
  NE14: [ // Hougang
    { exit: "Exit A", lat: 1.370209, lng: 103.892446 },
    { exit: "Exit B", lat: 1.371946, lng: 103.892972 },
    { exit: "Exit C", lat: 1.372142, lng: 103.891975 },
  ],
  NE15: [ // Buangkok
    { exit: "A", lat: 1.38341, lng: 103.892884 },
    { exit: "Exit B", lat: 1.38265, lng: 103.893463 },
  ],
  NE16: [ // Sengkang
    { exit: "Exit A", lat: 1.391829, lng: 103.895406 },
    { exit: "Exit B", lat: 1.391796, lng: 103.895637 },
    { exit: "Exit C", lat: 1.390882, lng: 103.895209 },
    { exit: "Exit D", lat: 1.392371, lng: 103.895705 },
  ],
  NE17: [ // Punggol
    { exit: "Exit A", lat: 1.40534, lng: 103.902306 },
    { exit: "Exit B", lat: 1.405186, lng: 103.902598 },
  ],
  // Punggol Coast (NE18) is a newer station, not present in the original
  // LTA MRTStationExit GeoJSON snapshot this file was built from - sourced
  // instead from OneMap's address search index (same underlying government
  // data, just a different endpoint), confirmed live via this app's own
  // /api/geocode/search. Exit codes here are numeric ("Exit 1"/"Exit 2"),
  // matching how OneMap labels them for this station specifically.
  NE18: [ // Punggol Coast
    { exit: "Exit 1", lat: 1.414776, lng: 103.909172 },
    { exit: "Exit 2", lat: 1.415089, lng: 103.91108 },
  ],
};

// Accepts any code a station has (Dhoby Ghaut is NE6 and CC1; the Punggol LRT hub is PTC): shared stations use
// the curated NEL exits, other Circle Line / LRT stations use the generated real exits in railData.js.
export function exitsForStation(code) {
  return NEL_STATION_EXITS[canonicalCode(code)] || EXTRA_STATION_EXITS[code] || [];
}

// Straight-line distance in meters between two { lat, lng } points.
// Good enough for "which station/exit is closest" ranking — not a walking
// route distance (no roads/paths considered), so treat it as an estimate.
export function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Approximate station center = average of its own exit coordinates.
// Not the official station centroid (LTA doesn't publish one), but close
// enough for "which station is nearest to this address" ranking.
export function stationCentroid(code) {
  const exits = exitsForStation(code);
  if (exits.length === 0) return null;
  const lat = exits.reduce((sum, e) => sum + e.lat, 0) / exits.length;
  const lng = exits.reduce((sum, e) => sum + e.lng, 0) / exits.length;
  return { lat, lng };
}

// Given a point, returns NEL stations ranked nearest-first, using the
// approximate centroid above. Each entry: { code, distanceMeters }.
export function nearestStations(point, codes) {
  return codes
    .map((code) => {
      const centroid = stationCentroid(code);
      return centroid ? { code, distanceMeters: haversineMeters(point, centroid) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

// Given a station and a destination point, returns that station's exits
// ranked nearest-to-destination-first. Each entry: the exit object plus
// distanceMeters. This is the "ideal exit" building block — combine with
// door-crowd-density data (see JourneyPlanner's bestDoor logic) to weigh
// both crowding and walking distance rather than distance alone.
export function nearestExit(stationCode, destinationPoint) {
  return exitsForStation(stationCode)
    .map((exit) => ({ ...exit, distanceMeters: haversineMeters(exit, destinationPoint) }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}
