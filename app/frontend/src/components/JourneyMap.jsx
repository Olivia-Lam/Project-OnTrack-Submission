import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Polyline, CircleMarker, Marker, Popup, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { api } from "../api.js";
import { decodePolyline } from "../services/polyline.js";
import { lineColor } from "../services/lineStyle.js";

const NEL_CENTER = [1.335, 103.87]; // roughly the middle of the North East Line, so the first view shows the line
// Below this zoom a viewport holds too many racks to fetch/draw usefully (the backend also refuses very large areas).
export const BICYCLE_MIN_ZOOM = 15;
const MAX_LOADED_SPOTS = 1200;

// Leaflet draws into SVG/canvas, so route colours are hex values (SGDS utility classes can't reach them).
// Rail colours come from LINES (stations.js): purple NEL, orange Circle Line, grey-green LRT.
const MODE_STYLE = {
  WALK: { color: "#475569", weight: 5, dashArray: "1 9", lineCap: "round" },
  BUS: { color: "#2563eb", weight: 6 },
  SUBWAY: { color: "#8055bb", weight: 7 },
  TRAM: { color: "#8055bb", weight: 5 },
  BICYCLE: { color: "#16a34a", weight: 6 },
};
const BRIDGING_STYLE = { color: "#f59e0b", weight: 6, dashArray: "10 8" };

function legPositions(leg) {
  const decoded = decodePolyline(leg.polyline);
  if (decoded.length > 1) return decoded;
  // Reroute legs built client-side (disruption simulation) carry no geometry: draw a straight line.
  if (leg.from?.lat != null && leg.from?.lng != null && leg.to?.lat != null && leg.to?.lng != null) {
    return [
      [leg.from.lat, leg.from.lng],
      [leg.to.lat, leg.to.lng],
    ];
  }
  return [];
}

const destinationIcon = L.divIcon({
  className: "",
  iconSize: [30, 38],
  iconAnchor: [15, 38],
  html: '<svg width="30" height="38" viewBox="0 0 30 38"><path d="M15 37C15 37 2 22.5 2 14a13 13 0 0 1 26 0c0 8.5-13 23-13 23z" fill="#dc2626" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5" fill="#fff"/></svg>',
});

// Green teardrop pin, matching the look of OneMap's bicycle-rack layer.
const parkingIcon = L.divIcon({
  className: "",
  iconSize: [28, 36],
  iconAnchor: [14, 36],
  popupAnchor: [0, -32],
  html: '<svg width="28" height="36" viewBox="0 0 30 38"><path d="M15 37C15 37 2 22.5 2 14a13 13 0 0 1 26 0c0 8.5-13 23-13 23z" fill="#22a447" stroke="#fff" stroke-width="2"/><circle cx="15" cy="14" r="5.5" fill="#fff"/></svg>',
});

function FitToRoute({ fitKey, legs, fromPoint, toPoint, padding }) {
  const map = useMap();
  useEffect(() => {
    const pts = [];
    (legs || []).forEach((l) => legPositions(l).forEach((p) => pts.push(p)));
    if (pts.length === 0) {
      [fromPoint, toPoint].filter(Boolean).forEach((p) => pts.push([p.lat, p.lng]));
    }
    if (pts.length === 0) return;
    // Padding keeps the route clear of the floating search bar (top) and the bottom sheet.
    map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [28, padding.top], paddingBottomRight: [28, padding.bottom], maxZoom: 17 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, fromPoint?.lat, fromPoint?.lng, toPoint?.lat, toPoint?.lng]);
  return null;
}

// Bicycle-parking pins for whatever the map is showing. Fetches by viewport (debounced) once the
// map is zoomed in far enough, and keeps everything already loaded so panning back is instant.
function BicycleLayer({ enabled, onStatus }) {
  const map = useMap();
  const [spots, setSpots] = useState(new Map());
  const requestId = useRef(0);
  const timer = useRef(null);

  function load() {
    if (!enabled) return;
    if (map.getZoom() < BICYCLE_MIN_ZOOM) {
      onStatus({ state: "zoom", count: 0 });
      return;
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const id = ++requestId.current;
      const b = map.getBounds();
      onStatus({ state: "loading" });
      try {
        const data = await api.getBicycleParkingInBounds({
          minLat: b.getSouth(),
          minLng: b.getWest(),
          maxLat: b.getNorth(),
          maxLng: b.getEast(),
        });
        if (id !== requestId.current) return; // a newer pan superseded this response
        setSpots((prev) => {
          const next = new Map(prev);
          data.spots.forEach((s) => next.set(s.id, s));
          // Keep memory (and the number of DOM markers) bounded on long pans: drop the oldest entries.
          while (next.size > MAX_LOADED_SPOTS) next.delete(next.keys().next().value);
          return next;
        });
        onStatus({ state: "ready", source: data.source, count: data.spots.length });
      } catch (err) {
        if (id === requestId.current) onStatus({ state: "error", message: err.message });
      }
    }, 350);
  }

  useMapEvents({ moveend: load, zoomend: load });
  useEffect(() => {
    if (enabled) load();
    else onStatus({ state: "off" });
    return () => clearTimeout(timer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled) return null;
  return [...spots.values()].map((s) => (
      <Marker key={s.id} position={[s.lat, s.lng]} icon={parkingIcon}>
        <Popup autoPanPaddingTopLeft={[20, 275]} autoPanPaddingBottomRight={[20, 280]}>
          <div className="sgds:flex sgds:min-w-40 sgds:flex-col sgds:gap-1 sgds:text-center sgds:text-fixed-dark">
            <div className="sgds:text-label-xs sgds:font-semibold sgds:uppercase">
              {s.operator ? `${s.operator} racks` : "Bicycle parking"}
              {s.rackCount != null ? ` (${s.rackCount} racks)` : ""}
            </div>
            <div className="sgds:text-body-md sgds:font-bold">{s.description}</div>
            {s.rackType && <div className="sgds:text-caption-md">{s.rackType}</div>}
            <a
              className="sgds:text-body-sm"
              href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}&travelmode=bicycling`}
              target="_blank"
              rel="noreferrer"
            >
              Navigate
            </a>
            <div className="sgds:text-caption-md">
              {s.sheltered === true ? "Sheltered" : s.sheltered === false ? "Not sheltered" : "Shelter not recorded"}
            </div>
          </div>
        </Popup>
      </Marker>
    ));
}

const ALT_STYLE = { color: "#64748b", weight: 6, opacity: 0.55 };

export default function JourneyMap({ fromPoint, toPoint, legs, routeKey, showBicycle, onBicycleStatus, altRoutes = [], onSelectAlt, fitPadding = { top: 190, bottom: 260 } }) {
  const altLines = useMemo(() => altRoutes.map((r) => ({ index: r.index, positions: (r.legs || []).flatMap(legPositions) })), [altRoutes]);
  const lines = useMemo(
    () =>
      (legs || []).map((leg, i) => ({
        key: i,
        positions: legPositions(leg),
        style: leg.isBridging
          ? BRIDGING_STYLE
          : leg.mode === "SUBWAY" || leg.mode === "TRAM"
            ? { ...(MODE_STYLE[leg.mode] || MODE_STYLE.SUBWAY), color: lineColor(leg) }
            : MODE_STYLE[leg.mode] || MODE_STYLE.WALK,
      })),
    [legs]
  );
  const stops = useMemo(
    () =>
      (legs || [])
        .filter((l) => l.mode !== "WALK" && l.from?.lat != null)
        .flatMap((l) => [l.from, l.to])
        .filter((s) => s?.lat != null && s?.lng != null),
    [legs]
  );

  return (
    <MapContainer center={NEL_CENTER} zoom={12} minZoom={11} zoomControl={false} className="sgds:absolute sgds:inset-0 sgds:z-0">
      <TileLayer
        url="https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png"
        attribution='Map data &copy; <a href="https://www.onemap.gov.sg/">OneMap</a> &amp; Singapore Land Authority'
        maxZoom={19}
      />
      <FitToRoute fitKey={routeKey} legs={legs} fromPoint={fromPoint} toPoint={toPoint} padding={fitPadding} />

      {/* Other route options: faint grey lines under the selected route; tap one to switch to it */}
      {altLines.map((l) => (
        <Polyline
          key={`alt-${l.index}`}
          positions={l.positions}
          pathOptions={ALT_STYLE}
          eventHandlers={{ click: () => onSelectAlt?.(l.index) }}
        />
      ))}

      {lines.map((l) => (
        <Polyline key={`c-${l.key}`} positions={l.positions} pathOptions={{ color: "#ffffff", weight: (l.style.weight || 5) + 4, opacity: 0.9 }} />
      ))}
      {lines.map((l) => (
        <Polyline key={`l-${l.key}`} positions={l.positions} pathOptions={l.style} />
      ))}

      {stops.map((s, i) => (
        <CircleMarker key={i} center={[s.lat, s.lng]} radius={5} pathOptions={{ color: "#1e293b", weight: 2, fillColor: "#ffffff", fillOpacity: 1 }}>
          <Tooltip>{s.name}</Tooltip>
        </CircleMarker>
      ))}

      {fromPoint && (
        <CircleMarker center={[fromPoint.lat, fromPoint.lng]} radius={8} pathOptions={{ color: "#ffffff", weight: 3, fillColor: "#2563eb", fillOpacity: 1 }}>
          <Tooltip>{fromPoint.label}</Tooltip>
        </CircleMarker>
      )}
      {toPoint && (
        <Marker position={[toPoint.lat, toPoint.lng]} icon={destinationIcon}>
          <Tooltip>{toPoint.label}</Tooltip>
        </Marker>
      )}

      <BicycleLayer enabled={showBicycle} onStatus={onBicycleStatus} />
    </MapContainer>
  );
}
