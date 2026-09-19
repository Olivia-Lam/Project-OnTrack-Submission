// Generates frontend/src/railData.js: station lists, line topology and REAL exit coordinates for the
// Circle Line (CCL) and the Sengkang-Punggol LRT (SPLRT). The North East Line keeps its curated data in
// frontend/src/stations.js + stationExits.js.
//
// Sources (nothing here is invented):
//  - Station codes and names: OneMap search labels and real OneMap routes (stopCode / intermediateStops).
//  - Exit coordinates: LTA "MRT Station Exit" GeoJSON on data.gov.sg (dataset d_b39d3a0871985372d7e1637193335da5).
//  - Exits for stations newer than that dataset (Circle Line Stage 6: Keppel, Cantonment, Prince Edward Road):
//    OneMap's own "<STATION> EXIT n" search results.
// Run from mrt-app/backend:  node scripts/build-rail-data.mjs
import "dotenv/config";
import { writeFileSync } from "node:fs";
import fetch from "node-fetch";
import { searchAddress } from "../onemap.js";

const DATASET = "d_b39d3a0871985372d7e1637193335da5";

// [code, display name, name as it appears in the LTA dataset (null = not in it)]
const CCL = [
  ["CC1", "Dhoby Ghaut", null], // interchange: reuses NEL exits (NE6)
  ["CC2", "Bras Basah", "BRAS BASAH MRT STATION"],
  ["CC3", "Esplanade", "ESPLANADE MRT STATION"],
  ["CC4", "Promenade", "PROMENADE MRT STATION"],
  ["CC5", "Nicoll Highway", "NICOLL HIGHWAY MRT STATION"],
  ["CC6", "Stadium", "STADIUM MRT STATION"],
  ["CC7", "Mountbatten", "MOUNTBATTEN MRT STATION"],
  ["CC8", "Dakota", "DAKOTA MRT STATION"],
  ["CC9", "Paya Lebar", "PAYA LEBAR MRT STATION"],
  ["CC10", "MacPherson", "MACPHERSON MRT STATION"],
  ["CC11", "Tai Seng", "TAI SENG MRT STATION"],
  ["CC12", "Bartley", "BARTLEY MRT STATION"],
  ["CC13", "Serangoon", null], // interchange: NE12
  ["CC14", "Lorong Chuan", "LORONG CHUAN MRT STATION"],
  ["CC15", "Bishan", "BISHAN MRT STATION"],
  ["CC16", "Marymount", "MARYMOUNT MRT STATION"],
  ["CC17", "Caldecott", "CALDECOTT MRT STATION"],
  ["CC19", "Botanic Gardens", "BOTANIC GARDENS MRT STATION"],
  ["CC20", "Farrer Road", "FARRER ROAD MRT STATION"],
  ["CC21", "Holland Village", "HOLLAND VILLAGE MRT STATION"],
  ["CC22", "Buona Vista", "BUONA VISTA MRT STATION"],
  ["CC23", "one-north", "ONE-NORTH MRT STATION"],
  ["CC24", "Kent Ridge", "KENT RIDGE MRT STATION"],
  ["CC25", "Haw Par Villa", "HAW PAR VILLA MRT STATION"],
  ["CC26", "Pasir Panjang", "PASIR PANJANG MRT STATION"],
  ["CC27", "Labrador Park", "LABRADOR PARK MRT STATION"],
  ["CC28", "Telok Blangah", "TELOK BLANGAH MRT STATION"],
  ["CC29", "HarbourFront", null], // interchange: NE1
  ["CC30", "Keppel", "OneMap:KEPPEL MRT STATION"],
  ["CC31", "Cantonment", "OneMap:CANTONMENT MRT STATION"],
  ["CC32", "Prince Edward Road", "OneMap:PRINCE EDWARD ROAD MRT STATION"],
  ["CC33", "Marina Bay", "MARINA BAY MRT STATION"],
  ["CC34", "Bayfront", "BAYFRONT MRT STATION"],
];

const LRT = [
  ["SE1", "Compassvale", "COMPASSVALE LRT STATION"], ["SE2", "Rumbia", "RUMBIA LRT STATION"], ["SE3", "Bakau", "BAKAU LRT STATION"],
  ["SE4", "Kangkar", "KANGKAR LRT STATION"], ["SE5", "Ranggung", "RANGGUNG LRT STATION"],
  ["SW1", "Cheng Lim", "CHENG LIM LRT STATION"], ["SW2", "Farmway", "FARMWAY LRT STATION"], ["SW3", "Kupang", "KUPANG LRT STATION"],
  ["SW4", "Thanggam", "THANGGAM LRT STATION"], ["SW5", "Fernvale", "FERNVALE LRT STATION"], ["SW6", "Layar", "LAYAR LRT STATION"],
  ["SW7", "Tongkang", "TONGKANG LRT STATION"], ["SW8", "Renjong", "RENJONG LRT STATION"],
  ["PE1", "Cove", "COVE LRT STATION"], ["PE2", "Meridian", "MERIDIAN LRT STATION"], ["PE3", "Coral Edge", "CORAL EDGE LRT STATION"],
  ["PE4", "Riviera", "RIVIERA LRT STATION"], ["PE5", "Kadaloor", "KADALOOR LRT STATION"], ["PE6", "Oasis", "OASIS LRT STATION"],
  ["PE7", "Damai", "DAMAI LRT STATION"],
  ["PW1", "Sam Kee", "SAM KEE LRT STATION"], ["PW2", "Teck Lee", "TECK LEE LRT STATION"], ["PW3", "Punggol Point", "PUNGGOL POINT LRT STATION"],
  ["PW4", "Samudera", "SAMUDERA LRT STATION"], ["PW5", "Nibong", "NIBONG LRT STATION"], ["PW6", "Sumang", "SUMANG LRT STATION"],
  ["PW7", "Soo Teck", "SOO TECK LRT STATION"],
];

const url = (await (await fetch(`https://api-open.data.gov.sg/v1/public/api/datasets/${DATASET}/poll-download`)).json()).data.url;
const geo = await (await fetch(url)).json();
const byName = new Map();
for (const f of geo.features) {
  const n = f.properties.STATION_NA;
  if (!byName.has(n)) byName.set(n, []);
  const [lng, lat] = f.geometry.coordinates;
  byName.get(n).push({ exit: f.properties.EXIT_CODE, lat: +lat.toFixed(6), lng: +lng.toFixed(6) });
}

async function exitsFromOneMap(stationName) {
  const data = await searchAddress(`${stationName} EXIT`);
  const found = new Map();
  for (const r of data.results || []) {
    const m = r.SEARCHVAL.match(new RegExp(`^${stationName} EXIT (\\w+)$`));
    if (m) found.set(`Exit ${m[1]}`, { exit: `Exit ${m[1]}`, lat: +Number(r.LATITUDE).toFixed(6), lng: +Number(r.LONGITUDE).toFixed(6) });
  }
  return [...found.values()];
}

const exits = {};
const missing = [];
for (const [code, , source] of [...CCL, ...LRT]) {
  if (!source) continue; // interchange stations reuse NEL data
  let list;
  if (source.startsWith("OneMap:")) list = await exitsFromOneMap(source.slice(7));
  else list = byName.get(source) || [];
  if (list.length === 0) missing.push(code);
  else exits[code] = list.sort((a, b) => a.exit.localeCompare(b.exit, undefined, { numeric: true }));
}

const out = `// GENERATED by backend/scripts/build-rail-data.mjs - do not edit by hand (re-run the script).
// Generated ${new Date().toISOString().slice(0, 10)}. Sources: LTA MRT Station Exit GeoJSON (data.gov.sg) + OneMap.
// Exit coordinates are { lat, lng } in WGS84; codes/names/order verified against OneMap routes.

export const CCL_STATIONS = ${JSON.stringify(CCL.map(([code, name]) => ({ code, name })))};

export const SPLRT_STATIONS = ${JSON.stringify(LRT.map(([code, name]) => ({ code, name })))};

// Exits for stations that are not shared with the North East Line (interchanges reuse NEL exits).
export const EXTRA_STATION_EXITS = ${JSON.stringify(exits, null, 1)};
`;
writeFileSync(new URL("../../frontend/src/railData.js", import.meta.url), out);
console.log("stations:", CCL.length, "CCL +", LRT.length, "LRT | stations with exits:", Object.keys(exits).length, "| missing exits:", missing.join(",") || "none");
for (const c of ["CC30", "CC31", "CC32"]) console.log(c, JSON.stringify(exits[c]));
