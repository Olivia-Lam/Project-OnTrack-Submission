// Shared OpenStreetMap -> app-shape conversion for bicycle parking, used by the live Overpass
// path (routes/bicycle.js) and by the saved-snapshot generator.
const RACK_LABELS = {
  stands: "Stands",
  wall_loops: "Wall loops",
  rack: "Rack",
  wave: "Wave rack",
  shed: "Shed",
  lockers: "Lockers",
  building: "Building",
  two_tier: "Two-tier rack",
  anchors: "Anchors",
  bollard: "Bollards",
  handlebar_holder: "Handlebar holders",
};

export function normaliseOsmElement(e) {
  const lat = e.lat ?? e.center?.lat;
  const lng = e.lon ?? e.center?.lon;
  if (lat == null || lng == null) return null;
  const t = e.tags || {};
  const capacity = t.capacity != null ? parseInt(t.capacity, 10) : NaN;
  return {
    id: `osm-${e.type}-${e.id}`,
    description: t.name || t["name:en"] || t.operator || "Bicycle parking",
    lat,
    lng,
    rackType: RACK_LABELS[t.bicycle_parking] || null,
    rackCount: Number.isFinite(capacity) ? capacity : null,
    // OSM only tags shelter when someone surveyed it: absent means unknown, not "no".
    sheltered: t.covered === "yes" ? true : t.covered === "no" ? false : null,
    operator: t.operator || null,
  };
}
