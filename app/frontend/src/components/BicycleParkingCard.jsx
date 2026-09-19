import { useEffect, useMemo, useState } from "react";
import { MapContainer, TileLayer, CircleMarker, Tooltip } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { SgdsAlert, SgdsBadge, SgdsCard } from "@govtechsg/sgds-web-component/react";
import { api } from "../api.js";
import { haversineMeters, stationCentroid } from "../stationExits.js";

// Search radius around the station, in km. 0.5 km is roughly a 6-7 minute walk - a
// UI choice for "near this station", not a value taken from any dataset.
const SEARCH_RADIUS_KM = 0.5;

/**
 * Real bicycle parking around a Purple Line station (LTA DataMall BicycleParkingv2 via
 * /api/bicycle/parking), shown as map pins plus a list. Self-contained: give it a station code.
 * While the LTA key is rejected the backend answers 503 and this renders an honest
 * "unavailable" message - it never shows made-up spots.
 */
export default function BicycleParkingCard({ stationCode }) {
  const center = useMemo(() => stationCentroid(stationCode), [stationCode]);
  const [state, setState] = useState({ status: "loading", spots: [], error: null, source: null });

  useEffect(() => {
    if (!center) {
      setState({ status: "unavailable", spots: [], error: "No coordinates known for this station" });
      return;
    }
    let cancelled = false;
    setState({ status: "loading", spots: [], error: null });
    api
      .getBicycleParking({ lat: center.lat, lng: center.lng, dist: SEARCH_RADIUS_KM })
      .then((data) => {
        if (cancelled) return;
        const spots = (data.spots || [])
          .map((s) => ({ ...s, distanceMeters: haversineMeters(center, s) }))
          .sort((a, b) => a.distanceMeters - b.distanceMeters);
        setState({ status: "ready", spots, error: null, source: data.source });
      })
      .catch((err) => !cancelled && setState({ status: "unavailable", spots: [], error: err.message }));
    return () => {
      cancelled = true;
    };
  }, [center]);

  return (
    <SgdsCard>
      <span slot="title" className="sgds:text-label-md sgds:font-semibold sgds:uppercase sgds:text-default">
        Bicycle Parking
      </span>
      <div className="sgds:flex sgds:flex-col sgds:gap-component-sm">
        {state.status === "loading" && <p className="sgds:text-body-sm sgds:text-subtle">Looking for bicycle parking nearby…</p>}

        {state.status === "unavailable" && (
          <SgdsAlert show variant="info" title="Bicycle parking unavailable">
            Live bicycle parking data couldn't be loaded right now, so nothing is shown rather than guessing. Try again later.
          </SgdsAlert>
        )}

        {state.status === "ready" && state.spots.length === 0 && (
          <p className="sgds:text-body-sm sgds:text-subtle">
            No bicycle parking is recorded within {SEARCH_RADIUS_KM * 1000}m of this station
            {state.source && state.source !== "lta" ? " (OpenStreetMap is community-mapped, so coverage can be patchy)." : "."}
          </p>
        )}

        {state.status === "ready" && state.spots.length > 0 && (
          <>
            <MapContainer
              center={[center.lat, center.lng]}
              zoom={17}
              scrollWheelZoom={false}
              className="sgds:h-64 sgds:w-full sgds:rounded-md"
            >
              <TileLayer
                url="https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png"
                attribution='Map data &copy; <a href="https://www.onemap.gov.sg/">OneMap</a> &amp; Singapore Land Authority'
                maxZoom={19}
              />
              <CircleMarker center={[center.lat, center.lng]} radius={8} pathOptions={{ color: "#634190", fillColor: "#8055BB", fillOpacity: 1 }}>
                <Tooltip>Station</Tooltip>
              </CircleMarker>
              {state.spots.map((s, i) => (
                <CircleMarker key={i} center={[s.lat, s.lng]} radius={6} pathOptions={{ color: "#166534", fillColor: "#22c55e", fillOpacity: 0.9 }}>
                  <Tooltip>{s.description}</Tooltip>
                </CircleMarker>
              ))}
            </MapContainer>
            <div className="sgds:flex sgds:flex-col">
              {state.spots.slice(0, 8).map((s, i) => (
                <div key={i} className="sgds:flex sgds:items-center sgds:gap-component-sm sgds:border-b sgds:border-muted sgds:py-component-sm sgds:last:border-b-0">
                  <div className="sgds:flex-1">
                    <div className="sgds:text-body-sm sgds:font-semibold sgds:text-default">{s.description}</div>
                    <div className="sgds:text-caption-md sgds:text-subtle">
                      {Math.round(s.distanceMeters)}m away
                      {s.rackType ? ` · ${s.rackType}` : ""}
                      {s.rackCount != null ? ` · ${s.rackCount} racks` : ""}
                    </div>
                  </div>
                  {s.sheltered === true && <SgdsBadge variant="success">Sheltered</SgdsBadge>}
                </div>
              ))}
            </div>
            <p className="sgds:text-caption-md sgds:text-subtle">
              {state.source === "lta" ? "Bicycle parking: LTA DataMall." : "Bicycle parking © OpenStreetMap contributors (community-mapped, may be incomplete)."}
            </p>
          </>
        )}
      </div>
    </SgdsCard>
  );
}
