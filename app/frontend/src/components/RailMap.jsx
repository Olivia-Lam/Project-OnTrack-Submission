import { useMemo } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Tooltip } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { ALL_STATIONS, LINES, LINE_IDS } from "../stations.js";
import { stationCentroid } from "../stationExits.js";

// Every covered station at its real position (centroid of its real exits), each line in its own colour.
// Line colours are hex because Leaflet draws into SVG; they come from LINES (stations.js).
export default function RailMap({ onSelect }) {
  const stations = useMemo(
    () =>
      ALL_STATIONS.map((s) => ({ ...s, pos: stationCentroid(s.code) })).filter((s) => s.pos),
    []
  );
  const positionOf = useMemo(() => new Map(stations.map((s) => [s.code, s.pos])), [stations]);

  const lines = useMemo(
    () =>
      LINE_IDS.flatMap((id) =>
        LINES[id].branches.map((b) => {
          const pts = b.codes
            .map((c) => positionOf.get(c) || positionOf.get(c === "STC" ? "NE16" : c === "PTC" ? "NE17" : c === "CC1" ? "NE6" : c === "CC13" ? "NE12" : c === "CC29" ? "NE1" : c))
            .filter(Boolean)
            .map((p) => [p.lat, p.lng]);
          if (b.ring && pts.length > 2) pts.push(pts[0]);
          return { key: `${id}-${b.name}`, color: LINES[id].color, pts };
        })
      ),
    [positionOf]
  );

  const bounds = useMemo(() => L.latLngBounds(stations.map((s) => [s.pos.lat, s.pos.lng])), [stations]);

  return (
    <MapContainer bounds={bounds} boundsOptions={{ padding: [16, 16] }} minZoom={10} className="sgds:h-full sgds:w-full sgds:rounded-lg">
      <TileLayer
        url="https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png"
        attribution='Map data &copy; <a href="https://www.onemap.gov.sg/">OneMap</a> &amp; Singapore Land Authority'
        maxZoom={19}
      />
      {lines.map((l) => (
        <Polyline key={l.key} positions={l.pts} pathOptions={{ color: l.color, weight: 4, opacity: 0.85 }} />
      ))}
      {stations.map((s) => {
        const primaryLine = LINES[s.lines[0]];
        return (
          <CircleMarker
            key={s.code}
            center={[s.pos.lat, s.pos.lng]}
            radius={s.codes.length > 1 ? 7 : 5}
            pathOptions={{ color: primaryLine.color, weight: 3, fillColor: "#ffffff", fillOpacity: 1 }}
            eventHandlers={{ click: () => onSelect(s.code) }}
          >
            <Tooltip>
              {s.name} ({s.codes.join(" / ")})
            </Tooltip>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
