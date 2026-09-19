import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SgdsButton, SgdsIconButton, SgdsInput } from "@govtechsg/sgds-web-component/react";
import RailMap from "./RailMap.jsx";
import { EXTRA_MAP_POSITIONS } from "../mapPositions.js";
import { ALL_STATIONS, LINES, LINE_IDS } from "../stations.js";
import { api } from "../api.js";

const PEEK_HEIGHT = 74;
const EXPAND_FRACTION = 0.92;

/*
 * Coordinates are in the 554 x 586 SVG viewBox the 1280 x 1280 system-map.png is scaled into.
 * These control where each clickable NEL station sits (read off the map's own station markers; stations shared with
 * the Circle Line or LRT are centred between their two markers). Other lines: see mapPositions.js.
 */
const NEL_MAP_POSITIONS = {
  NE1: { x: 220.7, y: 418.1 },
  NE3: { x: 230.3, y: 373.1 },
  NE4: { x: 241.1, y: 359.7 },
  NE5: { x: 254.5, y: 350.1 },
  NE6: { x: 267.9, y: 333.7 },
  NE7: { x: 272.7, y: 299.9 },
  NE8: { x: 277.0, y: 283.0 },
  NE9: { x: 276.6, y: 267.0 },
  NE10: { x: 287.0, y: 251.4 },
  NE11: { x: 299.9, y: 236.3 },
  NE12: { x: 319.0, y: 220.3 },
  NE13: { x: 331.5, y: 207.3 },
  NE14: { x: 342.4, y: 196.0 },
  NE15: { x: 353.2, y: 185.2 },
  NE16: { x: 364.4, y: 174.4 },
  NE17: { x: 388.7, y: 148.9 },
  NE18: { x: 396.9, y: 139.4 },
};

function PersonIcon({ tone }) {
  return (
    <svg className={tone} width="14" height="14" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="7" r="4" fill="currentColor" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" fill="currentColor" />
    </svg>
  );
}

function normaliseDensity(value) {
  const density = String(value || "").toLowerCase();
  if (density === "low" || density === "l") return "low";
  if (density === "medium" || density === "moderate" || density === "m") return "medium";
  if (density === "high" || density === "h") return "high";
  return "unknown";
}

// Crowd level -> SGDS text-colour utility (the SVG dots paint with currentColor).
function crowdTone(density) {
  switch (normaliseDensity(density)) {
    case "low":
      return "sgds:text-success-default";
    case "medium":
      return "sgds:text-warning-default";
    case "high":
      return "sgds:text-danger-default";
    default:
      return "sgds:text-neutral-default";
  }
}

export default function MrtMapSheet() {
  const navigate = useNavigate();

  const [densityMap, setDensityMap] = useState({});
  const [source, setSource] = useState(null);

  const [expanded, setExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dragDelta, setDragDelta] = useState(0);

  const [view, setView] = useState("official"); // "official" (image, NEL crowd dots) | "live" (all lines at real positions)
  const [query, setQuery] = useState("");
  const [selectedStation, setSelectedStation] = useState(null);

  const dragInfo = useRef({ startY: 0, moved: false });
  const sheetRef = useRef(null);

  // --- Zoom / pinch state (all hooks live inside the component) ---
  const [zoom, setZoom] = useState(1);
  const pinchRef = useRef({ pointers: new Map(), startDist: 0, startZoom: 1 });

  function clamp(v, min, max) {
    return Math.min(max, Math.max(min, v));
  }

  function getPinchDistance(pointers) {
    const pts = Array.from(pointers.values());
    const dx = pts[0].x - pts[1].x;
    const dy = pts[0].y - pts[1].y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function handleWheel(e) {
    e.preventDefault();
    setZoom((z) => clamp(z - e.deltaY * 0.0015, 1, 4));
  }

  function handleMapPointerDown(e) {
    pinchRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current.pointers.size === 2) {
      pinchRef.current.startDist = getPinchDistance(pinchRef.current.pointers);
      pinchRef.current.startZoom = zoom;
    }
  }
  function handleMapPointerMove(e) {
    if (!pinchRef.current.pointers.has(e.pointerId)) return;
    pinchRef.current.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current.pointers.size === 2) {
      const dist = getPinchDistance(pinchRef.current.pointers);
      const ratio = dist / pinchRef.current.startDist;
      setZoom(clamp(pinchRef.current.startZoom * ratio, 1, 4));
    }
  }
  function handleMapPointerUp(e) {
    pinchRef.current.pointers.delete(e.pointerId);
  }
  function handleDoubleClick() {
    setZoom((z) => (z >= 2 ? 1 : z + 1));
  }
  function zoomIn() {
    setZoom((z) => clamp(z + 0.4, 1, 4));
  }
  function zoomOut() {
    setZoom((z) => clamp(z - 0.4, 1, 4));
  }
  // --- end zoom / pinch state ---

  // LTA's real-time crowd feed is per train line: NEL and CCL for the MRT, SLRT and PLRT for the Sengkang / Punggol LRT.
  const CROWD_LINES = ["NEL", "CCL", "SLRT", "PLRT"];
  function loadDensity() {
    Promise.allSettled(CROWD_LINES.map((line) => api.getCrowdDensity(line))).then((results) => {
      const map = {};
      let anyOk = false;
      let liveSource = "live";
      results.forEach((r) => {
        if (r.status !== "fulfilled") return;
        anyOk = true;
        const res = r.value;
        liveSource = res.source || liveSource;
        const stations = res.stations || res.value || res.Value || [];
        stations.forEach((station) => {
          const code = station.code || station.stationCode || station.Station || station.station;
          const density = station.density || station.CrowdLevel || station.crowdLevel;
          if (code) map[code] = normaliseDensity(density);
        });
      });
      if (!anyOk) {
        console.error("Failed to load crowd density for any line");
        setSource("error");
        return;
      }
      setDensityMap(map);
      setSource(liveSource);
    });
  }

  useEffect(() => {
    loadDensity();
  }, []);

  const expandedPx = typeof window !== "undefined" ? window.innerHeight * EXPAND_FRACTION : 700;
  const baseHeight = expanded ? expandedPx : PEEK_HEIGHT;
  const liveHeight = Math.min(expandedPx, Math.max(PEEK_HEIGHT, baseHeight + dragDelta));
  const showFullContent = liveHeight > PEEK_HEIGHT + 90;

  // The sheet height changes continuously while dragging, which no fixed utility class can express,
  // so it is passed in as a CSS custom property (--sheet-h) that the h-(--sheet-h) class reads.
  useLayoutEffect(() => {
    sheetRef.current?.style.setProperty("--sheet-h", `${liveHeight}px`);
  }, [liveHeight]);

  function onHandlePointerDown(e) {
    setDragging(true);
    dragInfo.current = { startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }

  function onHandlePointerMove(e) {
    if (!dragging) return;
    const delta = dragInfo.current.startY - e.clientY;
    if (Math.abs(delta) > 5) dragInfo.current.moved = true;
    setDragDelta(delta);
  }

  function onHandlePointerUp() {
    if (!dragging) return;
    setDragging(false);
    const threshold = 55;
    if (!expanded && dragDelta > threshold) setExpanded(true);
    else if (expanded && dragDelta < -threshold) setExpanded(false);
    setDragDelta(0);
  }

  function handleHandleClick() {
    if (dragInfo.current.moved) {
      dragInfo.current.moved = false;
      return;
    }
    setExpanded((value) => !value);
  }

  function goToStation(code) {
    setExpanded(false);
    navigate(`/train/${code}`);
  }

  function handleSearchSubmit(e) {
    e.preventDefault();
    const search = query.trim().toLowerCase();
    if (!search) return;
    if (view === "live") {
      const any = ALL_STATIONS.find((st) => st.name.toLowerCase().includes(search) || st.codes.some((c) => c.toLowerCase() === search));
      if (any) goToStation(any.code);
      return;
    }
    const match = ALL_STATIONS.find(
      (station) => station.name.toLowerCase().includes(search) || station.codes.some((c) => c.toLowerCase() === search)
    );
    if (!match) return;
    setSelectedStation(match.code);
    setTimeout(() => {
      const marker = document.getElementById(`map-station-${match.code}`);
      marker?.scrollIntoView({ behavior: "smooth", block: "center", inline: "center" });
    }, 50);
  }

  return (
    <div
      ref={sheetRef}
      className={`sgds:fixed sgds:inset-x-0 sgds:bottom-16 sgds:z-[15] sgds:mx-auto sgds:flex sgds:h-(--sheet-h) sgds:w-full sgds:max-w-container-md sgds:flex-col sgds:overflow-hidden sgds:rounded-t-2-xl sgds:border sgds:border-b-0 sgds:border-default sgds:bg-surface-raised sgds:shadow-3 ${
        dragging ? "" : "sgds:transition-[height] sgds:duration-200"
      }`}
    >
      {/* DRAG HANDLE */}
      <div
        className="sgds:flex sgds:shrink-0 sgds:cursor-grab sgds:touch-none sgds:select-none sgds:flex-col sgds:items-center sgds:gap-1.5 sgds:pb-2 sgds:pt-2.5"
        onPointerDown={onHandlePointerDown}
        onPointerMove={onHandlePointerMove}
        onPointerUp={onHandlePointerUp}
        onPointerCancel={onHandlePointerUp}
        onClick={handleHandleClick}
      >
        <div className="sgds:h-1 sgds:w-10 sgds:rounded-full sgds:bg-neutral-muted" />
        {!showFullContent && (
          <div className="sgds:flex sgds:flex-col sgds:items-center sgds:gap-0.5 sgds:text-label-sm sgds:font-semibold sgds:text-primary-default">
            <span className="sgds:text-label-xs">▲</span>
            MRT/LRT System Map
          </div>
        )}
      </div>

      {/* EXPANDED SHEET */}
      {showFullContent && (
        <div className="sgds:flex sgds:min-h-0 sgds:flex-1 sgds:flex-col sgds:gap-component-sm sgds:overflow-hidden sgds:px-layout-sm sgds:pb-component-md">
          {/* HEADER */}
          <div className="sgds:flex sgds:items-center sgds:justify-between">
            <SgdsIconButton name="cross" variant="ghost" tone="neutral" size="sm" ariaLabel="Close map" onClick={() => setExpanded(false)} />
            <h2 className="sgds:m-0 sgds:text-heading-sm sgds:font-semibold sgds:text-heading-default">System Map</h2>
            <SgdsIconButton name="arrow-clockwise" variant="ghost" tone="neutral" size="sm" ariaLabel="Refresh crowd data" onClick={loadDensity} />
          </div>

          {/* SEARCH */}
          <div onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit(e)}>
            <SgdsInput
              type="search"
              label="Find a station"
              placeholder="Station name or code"
              value={query}
              onSgdsInput={(e) => setQuery(e.target.value)}
            />
          </div>

          {/* VIEW TOGGLE */}
          <div className="sgds:flex sgds:gap-component-xs" role="group" aria-label="Map view">
            <SgdsButton size="sm" variant={view === "official" ? "primary" : "outline"} ariaLabel="Official map" onClick={() => setView("official")}>
              Official map
            </SgdsButton>
            <SgdsButton size="sm" variant={view === "live" ? "primary" : "outline"} ariaLabel="Live map" onClick={() => setView("live")}>
              Live map
            </SgdsButton>
          </div>

          {view === "live" ? (
            <>
              <div className="sgds:flex sgds:flex-wrap sgds:gap-component-md sgds:text-caption-md sgds:text-subtle">
                {LINE_IDS.map((id) => (
                  <span key={id} className="sgds:flex sgds:items-center sgds:gap-1">
                    <span className={`sgds:size-2.5 sgds:rounded-full ${id === "NEL" ? "sgds:bg-primary-default" : id === "CCL" ? "sgds:bg-warning-default" : "sgds:bg-neutral-default"}`} />
                    {LINES[id].name}
                  </span>
                ))}
              </div>
              <div className="sgds:min-h-0 sgds:flex-1">
                <RailMap onSelect={goToStation} />
              </div>
              <p className="sgds:text-caption-md sgds:text-subtle">
                Every station at its real position. Tap a station to open it. Crowd colours are on the official map.
              </p>
            </>
          ) : (
            <>
          {/* CROWD LEGEND */}
          <div className="sgds:flex sgds:flex-wrap sgds:gap-component-md sgds:text-caption-md sgds:text-subtle">
            <span className="sgds:flex sgds:items-center sgds:gap-1">
              <PersonIcon tone="sgds:text-danger-default" />
              High
            </span>
            <span className="sgds:flex sgds:items-center sgds:gap-1">
              <PersonIcon tone="sgds:text-warning-default" />
              Moderate
            </span>
            <span className="sgds:flex sgds:items-center sgds:gap-1">
              <PersonIcon tone="sgds:text-success-default" />
              Low
            </span>
            <span className="sgds:flex sgds:items-center sgds:gap-1">
              <PersonIcon tone="sgds:text-neutral-default" />
              No Data
            </span>
          </div>

          {source === "error" && (
            <p className="sgds:m-0 sgds:text-caption-md sgds:text-subtle">
              Crowd data could not be loaded. Stations without data are shown in grey.
            </p>
          )}

          {/* MRT SYSTEM MAP */}
          <div className="sgds:relative sgds:min-h-0 sgds:flex-1">
            <div className="sgds:absolute sgds:right-2.5 sgds:top-2.5 sgds:z-[5] sgds:flex sgds:flex-col sgds:gap-1.5">
              <SgdsIconButton name="plus" variant="outline" tone="neutral" size="sm" ariaLabel="Zoom in" onClick={zoomIn} />
              <SgdsIconButton name="dash" variant="outline" tone="neutral" size="sm" ariaLabel="Zoom out" onClick={zoomOut} />
            </div>
            <div
              className="sgds:h-full sgds:touch-none sgds:overflow-auto sgds:rounded-lg sgds:border sgds:border-muted"
              onWheel={handleWheel}
              onPointerDown={handleMapPointerDown}
              onPointerMove={handleMapPointerMove}
              onPointerUp={handleMapPointerUp}
              onPointerCancel={handleMapPointerUp}
              onDoubleClick={handleDoubleClick}
            >
            <svg
              className="sgds:block"
              viewBox="0 0 554 586"
              width={554 * zoom}
              height={586 * zoom}
              xmlns="http://www.w3.org/2000/svg"
            >
              {/* OFFICIAL MRT MAP IMAGE */}
              <image
                href="/system-map.png"
                x="0"
                y="0"
                width="554"
                height="586"
                preserveAspectRatio="xMidYMid meet"
              />

              {/* INTERACTIVE STATIONS: NEL, Circle Line and Sengkang/Punggol LRT (shared stations are drawn once) */}
              {ALL_STATIONS.map((station) => {
                const position = NEL_MAP_POSITIONS[station.code] || EXTRA_MAP_POSITIONS[station.code];
                if (!position) return null;
                const isLrt = station.lines.every((l) => l === "SPLRT"); // LRT stations are packed tighter on the map, so smaller dots

                const density = station.codes.map((c) => densityMap[c]).find(Boolean) || "unknown";
                const selected = selectedStation === station.code;

                return (
                  <g
                    id={`map-station-${station.code}`}
                    key={station.code}
                    className={`sgds:cursor-pointer ${crowdTone(density)}`}
                    onClick={() => goToStation(station.code)}
                    role="button"
                    tabIndex="0"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") goToStation(station.code);
                    }}
                  >
                    {/* Invisible larger circle — easier to tap without visually covering the map */}
                    <circle cx={position.x} cy={position.y} r={isLrt ? "6" : "10"} fill="transparent" />

                    {/* Crowd density marker: dark ring + dot painted with the crowd-level colour (currentColor) */}
                    <circle cx={position.x} cy={position.y} r={selected ? 6.5 : isLrt ? 3.4 : 4.4} className="sgds:text-fixed-dark" fill="currentColor" />
                    <circle cx={position.x} cy={position.y} r={selected ? 5 : isLrt ? 2.4 : 3.2} fill="currentColor" />

                    <title>
                      {station.codes.join(" / ")} {station.name} | Crowd: {density === "unknown" ? "No data" : density}
                    </title>
                  </g>
                );
              })}
              </svg>
            </div>
          </div>

          <p className="sgds:text-caption-md sgds:text-subtle">
            Coloured dots show station crowd levels on the Purple Line, Circle Line and Sengkang / Punggol LRT.
            Tap a station to view it. Pinch, scroll, or use +/− to zoom.
          </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
