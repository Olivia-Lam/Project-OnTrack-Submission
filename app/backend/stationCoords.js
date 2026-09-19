// Real geographic coordinates for North East Line stations, sourced from
// the open sgraildata project (github.com/cheeaun/sgraildata), which
// compiles public OpenStreetMap rail data for Singapore. Used for OneMap
// routing calls, which need actual lat/lng — separate from the schematic
// x/y positions used for the on-screen map diagram.
export const NEL_LATLNG = {
  NE1: { lat: 1.265391, lng: 103.822403 },
  NE3: { lat: 1.280685, lng: 103.840241 },
  NE4: { lat: 1.28502, lng: 103.844003 },
  NE5: { lat: 1.288981, lng: 103.846869 },
  NE6: { lat: 1.298786, lng: 103.84502 },
  NE7: { lat: 1.306571, lng: 103.849299 },
  NE8: { lat: 1.312708, lng: 103.854377 },
  NE9: { lat: 1.319824, lng: 103.861521 },
  NE10: { lat: 1.331254, lng: 103.869093 },
  NE11: { lat: 1.339197, lng: 103.870754 },
  NE12: { lat: 1.349807, lng: 103.873771 },
  NE13: { lat: 1.359977, lng: 103.884874 },
  NE14: { lat: 1.371904, lng: 103.892754 },
  NE15: { lat: 1.383056, lng: 103.89305 },
  NE16: { lat: 1.39133, lng: 103.895294 },
  NE17: { lat: 1.405255, lng: 103.902354 },
  NE18: { lat: 1.415018, lng: 103.910329 },
};

export function latLngString(code) {
  const coord = NEL_LATLNG[code];
  if (!coord) return null;
  return `${coord.lat},${coord.lng}`;
}