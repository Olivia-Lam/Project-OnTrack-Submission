import { LINES } from "../stations.js";

// One place that turns a route leg into its line (NEL / CCL / SPLRT), name and colour, so the timeline,
// map and summaries never disagree. Leg route ids are OneMap's: NE, CC, and SE/SW/PE/PW for the LRT loops.
export function lineIdOfLeg(leg) {
  const r = leg?.routeId;
  if (r === "NE") return "NEL";
  if (r === "CC") return "CCL";
  if (["SE", "SW", "PE", "PW"].includes(r)) return "SPLRT";
  return null;
}

export function lineLabel(leg) {
  const r = leg?.routeId;
  if (r === "NE") return "Purple Line";
  if (r === "CC") return "Circle Line";
  if (r === "PE" || r === "PW") return "Punggol LRT";
  if (r === "SE" || r === "SW") return "Sengkang LRT";
  return leg?.mode === "TRAM" ? "LRT" : "MRT";
}

export function lineColor(leg) {
  const id = lineIdOfLeg(leg);
  return id ? LINES[id].color : "#8055bb";
}

// SGDS badge variant / text-colour utility per line, for the timeline.
export function lineBadgeVariant(leg) {
  const id = lineIdOfLeg(leg);
  return id === "CCL" ? "warning" : id === "SPLRT" ? "neutral" : "purple";
}
export function lineTextClass(leg) {
  const id = lineIdOfLeg(leg);
  return id === "CCL" ? "sgds:text-warning-default" : id === "SPLRT" ? "sgds:text-neutral-default" : "sgds:text-primary-default";
}
