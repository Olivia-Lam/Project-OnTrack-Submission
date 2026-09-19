import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  SgdsAlert,
  SgdsBadge,
  SgdsButton,
  SgdsCard,
  SgdsCheckbox,
  SgdsDrawer,
  SgdsIconButton,
  SgdsInput,
  SgdsRadio,
  SgdsRadioGroup,
} from "@govtechsg/sgds-web-component/react";
import { api } from "../api.js";
import { nearestExit } from "../stationExits.js";
import JourneyTimeline from "../components/JourneyTimeline.jsx";
import JourneyMap, { BICYCLE_MIN_ZOOM } from "../components/JourneyMap.jsx";
import { saveRoute } from "../services/savedRoutes.js";
import { lineLabel } from "../services/lineStyle.js";
import {
  SCENARIOS,
  applyDisruptionToJourney,
  applyDoorFault,
  applyLiftFault,
  applyExitPreference,
  applyExitToRoute,
} from "../services/disruptions.js";
import {
  DEFAULT_TRIP_OPTIONS,
  TRIAL_DEPARTURE_COUNT,
  TRIAL_DEPARTURE_STEP_MIN,
  compareDepartureTimes,
  planTrip,
} from "../services/tripPlanner.js";

function toDateTimeLocalString(d) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Defaulting to the literal current instant is a trap in the small hours -
// NEL/bus service hasn't started yet (roughly before ~5:30 AM; this is an
// approximation, not an official schedule), so "plan journey" would always
// come back walk-only for no reason a first-time user would guess. If "now"
// falls in that window, default to 5:30 AM the same day instead.
function defaultDepartAt() {
  const d = new Date();
  if (d.getHours() < 5 || (d.getHours() === 5 && d.getMinutes() < 30)) {
    d.setHours(5, 30, 0, 0);
  }
  return toDateTimeLocalString(d);
}

// A saved route remembers a usual time of day, not a date that is now in the past: keep the
// HH:mm and put it on today. Falls back to the normal default when nothing was saved.
function todayAtTimeOf(savedDateTime) {
  if (!savedDateTime || !savedDateTime.includes("T")) return defaultDepartAt();
  return `${defaultDepartAt().split("T")[0]}T${savedDateTime.split("T")[1]}`;
}

const timeOf = (ms) => (ms ? new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "—");

const SORT_LABELS = {
  best: "Best route",
  fewerTransfers: "Fewer transfers",
  lessWalking: "Less walking",
  wheelchair: "Wheelchair accessible",
  earliestArrival: "Earliest arrival",
};

const CARD_TITLE = "sgds:text-label-md sgds:font-semibold sgds:uppercase sgds:text-default";
const INFO_ROW =
  "sgds:flex sgds:items-center sgds:gap-component-md sgds:rounded-md sgds:bg-surface-raised sgds:p-component-md";
const INFO_BADGE =
  "sgds:grid sgds:h-11 sgds:min-w-11 sgds:shrink-0 sgds:place-items-center sgds:whitespace-nowrap sgds:px-component-xs sgds:rounded-md sgds:border sgds:border-success-default sgds:bg-success-surface-muted sgds:font-bold sgds:text-success-default";

// Short description of how a route travels, e.g. "Purple Line · Circle Line" or "Bus 136".
function modeSummary(legs) {
  const parts = [];
  for (const l of legs || []) {
    let label = null;
    if (l.isBridging) label = "Bridging bus";
    else if (l.mode === "SUBWAY" || l.mode === "TRAM") label = lineLabel(l);
    else if (l.mode === "BUS") label = `Bus ${l.routeId}`;
    else if (l.mode === "BICYCLE") label = "Cycle";
    if (label && !parts.includes(label)) parts.push(label);
  }
  return parts.length > 0 ? parts.join(" · ") : "Walk";
}

// Badges for one option: the ideal route is always index 0 (backend ranks it), plus whatever it wins on.
function optionTags(options, i) {
  const tags = [];
  if (i === 0) tags.push("Recommended");
  if (options.length < 2) return tags;
  const wins = (key) => {
    const values = options.map((o) => o[key] ?? Infinity);
    const min = Math.min(...values);
    return values.filter((v) => v === min).length < values.length && values[i] === min;
  };
  if (wins("durationSeconds")) tags.push("Fastest");
  if (wins("transfers")) tags.push("Fewest transfers");
  if (wins("walkDistanceMeters")) tags.push("Least walking");
  return tags.slice(0, 3);
}

function RouteOptionCard({ route, tags, selected, onSelect }) {
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`Route option: ${modeSummary(route.legs)}, ${Math.round(route.durationSeconds / 60)} minutes`}
      aria-pressed={selected}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      className={`sgds:flex sgds:cursor-pointer sgds:items-center sgds:justify-between sgds:gap-component-sm sgds:rounded-lg sgds:border-2 sgds:p-component-sm ${
        selected ? "sgds:border-primary-default sgds:bg-surface-default" : "sgds:border-muted sgds:bg-surface-default"
      }`}
    >
      <div className="sgds:flex sgds:min-w-0 sgds:flex-col sgds:gap-1">
        <span className="sgds:text-body-md sgds:font-semibold sgds:text-default">{modeSummary(route.legs)}</span>
        <span className="sgds:text-caption-md sgds:text-subtle">
          {timeOf(route.startTimeMs)} – {timeOf(route.startTimeMs + route.durationSeconds * 1000)} · {Math.round(route.walkDistanceMeters)}m walk
        </span>
        <div className="sgds:flex sgds:flex-wrap sgds:gap-1">
          {tags.map((t) => (
            <SgdsBadge key={t} variant={t === "Recommended" ? "success" : "neutral"}>
              {t}
            </SgdsBadge>
          ))}
        </div>
      </div>
      <div className="sgds:shrink-0 sgds:text-right">
        <div className="sgds:text-heading-sm sgds:font-bold sgds:text-default">{Math.round(route.durationSeconds / 60)} min</div>
        <div className="sgds:text-caption-md sgds:text-subtle">
          {route.transfers} transfer{route.transfers !== 1 ? "s" : ""}
          {route.fare ? ` · $${route.fare}` : ""}
        </div>
      </div>
    </div>
  );
}

export default function JourneyPlanner() {
  const navigate = useNavigate();
  // Set when arriving from the Saved tab (SavedRoutes navigates here with { state: { prefill } }).
  const prefill = useLocation().state?.prefill;
  const [fromPoint, setFromPoint] = useState(prefill?.from ?? null); // { label, lat, lng }
  const [toPoint, setToPoint] = useState(prefill?.to ?? null);
  const [timeMode, setTimeMode] = useState(prefill?.arrivalWindow ? "arrive" : "depart"); // "depart" | "arrive"
  const [departAt, setDepartAt] = useState(todayAtTimeOf(prefill?.departAt));
  const [arriveBy, setArriveBy] = useState(todayAtTimeOf(prefill?.arrivalWindow));
  const [options, setOptions] = useState({ ...DEFAULT_TRIP_OPTIONS, ...(prefill?.tripOptions || {}) });
  const [justSaved, setJustSaved] = useState(false);
  // Bottom sheet while a route is active: "peek" (summary only, most of the map visible) | "half" (route options + controls) | "full" (everything).
  const [sheetState, setSheetState] = useState("peek");
  const [sheetDrag, setSheetDrag] = useState(0);
  const [sheetDragging, setSheetDragging] = useState(false);
  const sheetRef = useRef(null);
  const dragRef = useRef({ startY: 0, moved: false });
  const [editingRoute, setEditingRoute] = useState(false); // expands the compact top bar back into the From/To card
  const [routeOptions, setRouteOptions] = useState(null); // every candidate route, ideal first
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [showBicycle, setShowBicycle] = useState(false);
  const [bikeStatus, setBikeStatus] = useState({ state: "off" });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [trials, setTrials] = useState(null); // departure-optimiser comparison rows
  const [result, setResult] = useState(null);
  const [exitInfo, setExitInfo] = useState(null);
  const [bestDoor, setBestDoor] = useState(null);
  const [doorList, setDoorList] = useState(null); // full crowd-sorted door list - needed to pick an alternative on a door fault
  const [doorSource, setDoorSource] = useState(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState(null);
  // Hackathon demo controls - which simulated scenario is active, if any.
  // null | SCENARIOS.DOOR_FAULT | SCENARIOS.LIFT | SCENARIOS.UNPLANNED | SCENARIOS.PLANNED
  const [activeScenario, setActiveScenario] = useState(null);
  // Accessibility control (not a general preference) - "route me via a
  // step-free alternative exit", only meaningful and only shown while the
  // Lift Not Working scenario is active, so a lift outage never silently
  // lengthens an able-bodied passenger's route by default.
  const [preferAlternativeExit, setPreferAlternativeExit] = useState(false);
  // The "Wheelchair accessible" trip filter asks for the step-free alternative exit
  // unconditionally (there is no real lift data yet - LTA facilities feed is blocked).
  const wheelchairMode = options.sort === "wheelchair";
  const exitPreferenceActive = wheelchairMode || (activeScenario === SCENARIOS.LIFT && preferAlternativeExit);

  // Everything below is derived, not stored - switching scenarios (or
  // planning a new journey while one is active) always recomputes from the
  // real `result`/`exitInfo`, so there's nothing to keep in sync by hand.
  const { result: reroutedResult, disruption } = useMemo(
    () => applyDisruptionToJourney(result, activeScenario),
    [result, activeScenario]
  );
  const { bestDoor: displayBestDoor, doorFault } = useMemo(
    () => applyDoorFault(bestDoor, doorList, result?.alightStation?.name, activeScenario),
    [bestDoor, doorList, result, activeScenario]
  );
  const preferredExitInfo = useMemo(
    () => applyExitPreference(exitInfo, result?.alightStation?.stopCode, toPoint, exitPreferenceActive),
    [exitInfo, result, toPoint, exitPreferenceActive]
  );
  // Always labels the alighting stop with whichever exit is currently
  // recommended (not just while the alternative-exit toggle is active) -
  // a no-op numerically when nothing's been toggled, since chosenExit and
  // defaultExitInfo are then the same object.
  const exitAdjustedResult = useMemo(
    () => (preferredExitInfo ? applyExitToRoute(reroutedResult, preferredExitInfo, exitInfo) : reroutedResult),
    [reroutedResult, preferredExitInfo, exitInfo]
  );

  // applyExitToRoute (disruptions.js) can only relabel the stop and SCALE OneMap's original walk, and it
  // never redraws the line. OneMap's own walk also leaves the station from wherever ITS route chose, which
  // may not be the exit we recommend. So for the exit being shown - default or alternative - we ask OneMap
  // for the REAL walk from that exact exit to the next stop/destination and overlay its distance, time and
  // geometry on that leg, keeping every option comparable. If the request fails the estimate stays and the
  // card says so.
  const [realWalk, setRealWalk] = useState(null); // { key, distanceMeters, durationSeconds, polyline }
  const [walkStatus, setWalkStatus] = useState("idle"); // idle | loading | ready | error
  const walkTarget = useMemo(() => {
    if (!preferredExitInfo || !exitAdjustedResult?.legs) return null;
    const legs = exitAdjustedResult.legs;
    const lastSubway = legs.map((l) => l.mode).lastIndexOf("SUBWAY");
    const leg = legs[lastSubway + 1];
    if (lastSubway === -1 || !leg || leg.mode !== "WALK" || leg.to?.lat == null || leg.to?.lng == null) return null;
    const from = { lat: preferredExitInfo.lat, lng: preferredExitInfo.lng };
    const to = { lat: leg.to.lat, lng: leg.to.lng };
    return { legIndex: lastSubway + 1, from, to, key: `${from.lat},${from.lng}>${to.lat},${to.lng}` };
  }, [exitAdjustedResult, preferredExitInfo]);

  useEffect(() => {
    if (!walkTarget) {
      setWalkStatus("idle");
      return;
    }
    let cancelled = false;
    setWalkStatus("loading");
    api
      .getWalkLeg({ fromLat: walkTarget.from.lat, fromLng: walkTarget.from.lng, toLat: walkTarget.to.lat, toLng: walkTarget.to.lng })
      .then((w) => {
        if (cancelled) return;
        setRealWalk({ key: walkTarget.key, ...w });
        setWalkStatus("ready");
      })
      .catch(() => !cancelled && setWalkStatus("error"));
    return () => {
      cancelled = true;
    };
  }, [walkTarget?.key]);

  const realWalkReady = !!walkTarget && walkStatus === "ready" && realWalk?.key === walkTarget.key;
  const displayResult = useMemo(() => {
    if (!realWalkReady) return exitAdjustedResult;
    const legs = [...exitAdjustedResult.legs];
    const leg = legs[walkTarget.legIndex];
    legs[walkTarget.legIndex] = {
      ...leg,
      distanceMeters: realWalk.distanceMeters,
      durationSeconds: realWalk.durationSeconds,
      polyline: realWalk.polyline,
    };
    return {
      ...exitAdjustedResult,
      legs,
      durationSeconds: exitAdjustedResult.durationSeconds - leg.durationSeconds + realWalk.durationSeconds,
    };
  }, [realWalkReady, exitAdjustedResult, walkTarget, realWalk]);
  // Always describes the DEFAULT exit as the faulty one (not
  // `preferredExitInfo`) - otherwise toggling "use alternative exit" would
  // make the message flip to describe whatever you just switched *to* as
  // broken, offering to switch back to where you started. The fault and
  // its offered alternative need to stay fixed regardless of the toggle.
  const liftFault = useMemo(
    () => applyLiftFault(exitInfo, result?.alightStation?.stopCode, toPoint, activeScenario),
    [exitInfo, result, toPoint, activeScenario]
  );

  useEffect(() => {
    if (options.twoWheeler) setShowBicycle(true); // cycling to a station: show where to park
  }, [options.twoWheeler]);

  function toggleScenario(scenario) {
    setActiveScenario((current) => (current === scenario ? null : scenario));
    setPreferAlternativeExit(false); // scoped to whichever scenario is now active - always start unchecked
  }

  function setModeOption(key, on) {
    setOptions((current) => {
      const next = { ...current, [key]: on };
      // At least one public-transport mode must stay on, otherwise only a walking route could come back.
      if (!next.nel && !next.ccl && !next.bus && !next.lrt) return current;
      return next;
    });
  }

  function handleSaveRoute() {
    saveRoute({
      from: fromPoint,
      to: toPoint,
      departAt: timeMode === "depart" ? departAt : null,
      arrivalWindow: timeMode === "arrive" ? arriveBy : null,
      tripOptions: options,
    });
    setJustSaved(true);
    setTimeout(() => setJustSaved(false), 2500);
  }

  const samePoint =
    fromPoint && toPoint && fromPoint.lat === toPoint.lat && fromPoint.lng === toPoint.lng;
  const canPlan = fromPoint && toPoint && !samePoint;

  // Puts one planned route on screen and fetches the exit + boarding-door data for it.
  async function showRoute(route, { options, index } = {}) {
    const opts = options ?? route.alternatives ?? [route];
    setRouteOptions(opts);
    setSelectedIdx(index ?? 0);
    setResult(route);
    setExitInfo(null);
    setBestDoor(null);
    setDoorList(null);
    setDoorSource(null);
    setActiveScenario(null); // a fresh journey starts from normal, not a leftover demo scenario
    setPreferAlternativeExit(false);

    // Only makes sense if this route actually rides an MRT line - a
    // bus-only itinerary has no station to disembark at.
    if (route.alightStation?.stopCode) {
      const exits = nearestExit(route.alightStation.stopCode, toPoint);
      if (exits.length > 0) setExitInfo(exits[0]);

      try {
        const doorData = await api.getDoorDensity(route.alightStation.stopCode);
        const order = { low: 0, medium: 1, high: 2 };
        const sorted = doorData?.doors
          ? [...doorData.doors].sort((a, b) => order[a.density] - order[b.density])
          : null;
        if (sorted && sorted.length > 0) {
          setBestDoor(sorted[0]);
          setDoorList(sorted);
        }
        setDoorSource(doorData?.source);
      } catch {
        // Door-crowd data is a nice-to-have on top of the route itself -
        // don't fail the whole plan if SmartGS/mock data is unavailable.
      }
    }
  }

  function selectOption(i) {
    if (!routeOptions || i === selectedIdx) return;
    showRoute(routeOptions[i], { options: routeOptions, index: i });
  }

  async function planJourney() {
    if (!canPlan) return;
    setRouteOptions(null);
    setLoading(true);
    setError(null);
    setResult(null);
    setTrials(null);
    setExitInfo(null);
    setBestDoor(null);
    setDoorList(null);
    setDoorSource(null);
    setActiveScenario(null);
    setPreferAlternativeExit(false);
    try {
      if (timeMode === "arrive") {
        setProgress("Checking journey time…");
        const rows = await compareDepartureTimes({
          fromPoint,
          toPoint,
          arriveBy,
          options,
          onProgress: (i, n) => setProgress(`Comparing departure times (${i}/${n})…`),
        });
        setTrials(rows);
        const pick = rows.find((r) => r.onTime && r.route) || rows.find((r) => r.route);
        if (!pick) throw new Error(rows[0]?.error || "No route found for any trial departure time");
        await showRoute(pick.route);
        setSheetState("half"); // several departure times to compare: open the sheet so they are visible
      } else {
        const route = await planTrip({ fromPoint, toPoint, departAt, options });
        await showRoute(route);
        setSheetState("peek"); // on the move: keep the map as visible as possible
      }
      setEditingRoute(false);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
      setProgress(null);
    }
  }

  // Bottom-sheet geometry: three snap heights, draggable. The container is the viewport minus the bottom nav (4.5rem = 72px).
  const containerPx = typeof window !== "undefined" ? window.innerHeight - 72 : 700;
  const snapPx = { peek: 190, half: Math.round(containerPx * 0.55), full: Math.round(containerPx * 0.88) };
  const liveSheetPx = Math.min(snapPx.full, Math.max(snapPx.peek, snapPx[sheetState] + sheetDrag));
  // The height changes continuously while dragging, which no fixed utility class can express, so it is
  // passed as a CSS custom property (--sheet-h) that the h-(--sheet-h) class reads.
  useLayoutEffect(() => {
    sheetRef.current?.style.setProperty("--sheet-h", `${liveSheetPx}px`);
  }, [liveSheetPx, result]);

  function onHandleDown(e) {
    if (!result) return;
    setSheetDragging(true);
    dragRef.current = { startY: e.clientY, moved: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function onHandleMove(e) {
    if (!sheetDragging) return;
    const delta = dragRef.current.startY - e.clientY;
    if (Math.abs(delta) > 6) dragRef.current.moved = true;
    setSheetDrag(delta);
  }
  function onHandleUp() {
    if (!sheetDragging) return;
    setSheetDragging(false);
    if (!dragRef.current.moved) {
      setSheetState((s) => (s === "peek" ? "half" : s === "half" ? "full" : "peek")); // a tap steps through the states
    } else {
      const nearest = Object.entries(snapPx).sort((a, b) => Math.abs(a[1] - liveSheetPx) - Math.abs(b[1] - liveSheetPx))[0][0];
      setSheetState(nearest);
    }
    setSheetDrag(0);
  }

  // The selected option must show the same numbers as the summary (which includes the real exit walk);
  // the others only have OneMap's own figures.
  const optionFor = (r, i) =>
    i === selectedIdx && result
      ? { ...r, durationSeconds: displayResult.durationSeconds, transfers: displayResult.transfers, legs: displayResult.legs }
      : r;
  const activeRoute = !!result && !editingRoute; // a trip is on screen: compact top bar, small sheet
  const altRoutes = routeOptions && routeOptions.length > 1 ? routeOptions.map((r, i) => ({ index: i, legs: r.legs })).filter((r) => r.index !== selectedIdx) : [];

  const routeKey = result ? `${result.startTimeMs}-${result.durationSeconds}-${result.legs?.length}` : "none";
  const straightLineMeters = preferredExitInfo ? Math.round(preferredExitInfo.distanceMeters) : 0;
  const walkText = realWalkReady
    ? `${Math.round(realWalk.distanceMeters)}m walk, about ${Math.max(1, Math.round(realWalk.durationSeconds / 60))} min (real route)`
    : walkStatus === "loading"
      ? "finding the real walking route…"
      : walkStatus === "error"
        ? `about ${straightLineMeters}m in a straight line (couldn't fetch a real route)`
        : `about ${straightLineMeters}m in a straight line to your destination`;
  const bikeChipText =
    bikeStatus.state === "zoom"
      ? "Zoom in to see racks"
      : bikeStatus.state === "loading"
        ? "Loading racks…"
        : bikeStatus.state === "error"
          ? "Parking unavailable"
          : bikeStatus.state === "ready"
            ? `${bikeStatus.count} racks · ${{ lta: "LTA", osm: "OSM", "osm-snapshot": "OSM saved copy" }[bikeStatus.source] || bikeStatus.source}`
            : null;

  return (
    <div className="sgds:relative sgds:h-[calc(100dvh-4.5rem)] sgds:overflow-hidden">
      <JourneyMap
        fromPoint={fromPoint}
        toPoint={toPoint}
        legs={result ? displayResult.legs : null}
        routeKey={routeKey}
        showBicycle={showBicycle}
        onBicycleStatus={setBikeStatus}
        altRoutes={altRoutes}
        onSelectAlt={selectOption}
        fitPadding={{ top: activeRoute ? 130 : 200, bottom: result ? snapPx.peek + 20 : 300 }}
      />

      {/* Floating search card + layer chips (Google-Maps style) */}
      <div className="sgds:absolute sgds:inset-x-3 sgds:top-3 sgds:z-[1000] sgds:flex sgds:flex-col sgds:gap-component-xs">
        {activeRoute ? (
          <div className="sgds:flex sgds:items-center sgds:gap-component-xs sgds:rounded-2-xl sgds:bg-surface-raised sgds:px-component-sm sgds:py-1 sgds:shadow-3">
            <SgdsIconButton name="arrow-left" variant="ghost" tone="neutral" size="sm" ariaLabel="Back to home" onClick={() => navigate("/")} />
            <button
              type="button"
              aria-label="Edit trip"
              className="sgds:block sgds:min-w-0 sgds:flex-1 sgds:cursor-pointer sgds:truncate sgds:border-0 sgds:bg-transparent sgds:p-0 sgds:text-left sgds:text-body-sm sgds:font-semibold sgds:text-default"
              onClick={() => setEditingRoute(true)}
            >
              {fromPoint?.label} → {toPoint?.label}
            </button>
            <SgdsIconButton name="edit" variant="ghost" tone="neutral" size="sm" ariaLabel="Edit trip" onClick={() => setEditingRoute(true)} />
            <SgdsIconButton name="three-dots-vertical" variant="ghost" tone="neutral" size="sm" ariaLabel="Trip options" onClick={() => setOptionsOpen(true)} />
          </div>
        ) : (
          <div className="sgds:flex sgds:flex-col sgds:gap-component-xs sgds:rounded-2-xl sgds:bg-surface-raised sgds:p-component-sm sgds:shadow-3">
            <div className="sgds:flex sgds:items-center sgds:gap-component-xs">
              <SgdsIconButton name="arrow-left" variant="ghost" tone="neutral" size="sm" ariaLabel="Back to home" onClick={() => navigate("/")} />
              <span className="sgds:flex-1 sgds:text-body-md sgds:font-semibold sgds:text-heading-default">Journey Planner</span>
              {result && <SgdsIconButton name="cross" variant="ghost" tone="neutral" size="sm" ariaLabel="Close editing" onClick={() => setEditingRoute(false)} />}
              <SgdsIconButton name="three-dots-vertical" variant="ghost" tone="neutral" size="sm" ariaLabel="Trip options" onClick={() => setOptionsOpen(true)} />
            </div>
            <AddressInput label="From" placeholder="Choose starting point" value={fromPoint} onChange={setFromPoint} />
            <AddressInput label="To" placeholder="Choose destination" value={toPoint} onChange={setToPoint} />
          </div>
        )}

        <div className="sgds:flex sgds:items-center sgds:gap-component-xs">
          <div className="sgds:rounded-full sgds:bg-surface-raised sgds:shadow-2">
            <SgdsButton size="sm" variant={showBicycle ? "primary" : "outline"} ariaLabel="Toggle bicycle parking" onClick={() => setShowBicycle((v) => !v)}>
              {showBicycle ? "Bicycle parking: on" : "Bicycle parking"}
            </SgdsButton>
          </div>
          {showBicycle && bikeChipText && (
            <span className="sgds:whitespace-nowrap sgds:rounded-full sgds:bg-surface-raised sgds:px-component-sm sgds:py-1 sgds:text-caption-md sgds:text-default sgds:shadow-2">
              {bikeChipText}
            </span>
          )}
        </div>
      </div>

      {/* Bottom sheet: drag the handle (or tap it) between peek / half / full */}
      <div
        ref={sheetRef}
        className={`sgds:absolute sgds:inset-x-0 sgds:bottom-0 sgds:z-[1000] sgds:flex sgds:flex-col sgds:rounded-t-2-xl sgds:bg-surface-raised sgds:shadow-3 ${
          result ? `sgds:h-(--sheet-h) ${sheetDragging ? "" : "sgds:transition-[height] sgds:duration-200"}` : "sgds:max-h-[62%]"
        }`}
      >
        <button
          type="button"
          aria-label={sheetState === "full" ? "Collapse details" : "Expand details"}
          className={`sgds:flex sgds:w-full sgds:shrink-0 sgds:touch-none sgds:select-none sgds:justify-center sgds:border-0 sgds:bg-transparent sgds:py-3 ${result ? "sgds:cursor-grab" : "sgds:cursor-default"}`}
          onPointerDown={onHandleDown}
          onPointerMove={onHandleMove}
          onPointerUp={onHandleUp}
          onPointerCancel={onHandleUp}
        >
          <span className="sgds:h-1 sgds:w-10 sgds:rounded-full sgds:bg-neutral-muted" />
        </button>

        <div className="sgds:flex sgds:min-h-0 sgds:flex-col sgds:gap-component-md sgds:overflow-y-auto sgds:px-layout-md sgds:pb-layout-md sgds:[&>*]:shrink-0">
          {result && disruption && (
            <SgdsAlert
              show
              variant={disruption.type === "unplanned" ? "danger" : "warning"}
              title={disruption.type === "planned" ? "Planned engineering works" : "Service disruption"}
            >
              {disruption.message}
            </SgdsAlert>
          )}

          {result && (
            <div className="sgds:flex sgds:flex-col sgds:gap-component-xs">
              <div className="sgds:flex sgds:items-end sgds:justify-between sgds:gap-component-sm">
                <div className="sgds:flex sgds:items-end sgds:gap-layout-sm">
                  <Stat value={`~${Math.round(displayResult.durationSeconds / 60)}`} label="min" />
                  <Stat value={displayResult.transfers} label={`transfer${displayResult.transfers !== 1 ? "s" : ""}`} />
                  {result.fare && <Stat value={`$${result.fare}`} label="fare" />}
                </div>
                <SgdsButton size="sm" variant="outline" ariaLabel={sheetState === "full" ? "Hide details" : "Show details"} onClick={() => setSheetState((v) => (v === "full" ? "peek" : "full"))}>
                  {sheetState === "full" ? "Hide details" : "Details"}
                </SgdsButton>
              </div>
              <div className="sgds:text-caption-md sgds:text-subtle">
                {modeSummary(displayResult.legs)} · {timeOf(displayResult.startTimeMs)} – {timeOf(displayResult.startTimeMs + displayResult.durationSeconds * 1000)}
              </div>
              {sheetState === "peek" && routeOptions && routeOptions.length > 1 && (
                <div className="sgds:flex sgds:gap-component-xs sgds:overflow-x-auto sgds:pb-1" role="group" aria-label="Route options">
                  {routeOptions.map((r, i) => (
                    <SgdsButton
                      key={i}
                      size="xs"
                      variant={i === selectedIdx ? "primary" : "outline"}
                      ariaLabel={`Route option ${i + 1}: ${modeSummary(r.legs)}`}
                      onClick={() => selectOption(i)}
                    >
                      {Math.round(optionFor(r, i).durationSeconds / 60)} min · {modeSummary(r.legs)}
                    </SgdsButton>
                  ))}
                </div>
              )}
            </div>
          )}

          {error && (
            <SgdsAlert show variant="danger" title="Couldn't plan that journey">
              {error}
            </SgdsAlert>
          )}

          {result && sheetState !== "peek" && routeOptions && routeOptions.length > 1 && (
            <div className="sgds:flex sgds:flex-col sgds:gap-component-xs">
              <div className={CARD_TITLE}>Route options</div>
              {routeOptions.map((r, i) => (
                <RouteOptionCard key={i} route={optionFor(r, i)} tags={optionTags(routeOptions, i)} selected={i === selectedIdx} onSelect={() => selectOption(i)} />
              ))}
            </div>
          )}

          {(!result || sheetState !== "peek") && (
            <>
          <div className="sgds:flex sgds:gap-component-xs">
            <SgdsButton size="sm" variant={timeMode === "depart" ? "primary" : "outline"} ariaLabel="Depart at" onClick={() => setTimeMode("depart")}>
              Depart at
            </SgdsButton>
            <SgdsButton size="sm" variant={timeMode === "arrive" ? "primary" : "outline"} ariaLabel="Arrive by" onClick={() => setTimeMode("arrive")}>
              Arrive by
            </SgdsButton>
          </div>
          {timeMode === "depart" ? (
            <SgdsInput type="datetime-local" label="" value={departAt} onSgdsInput={(e) => setDepartAt(e.target.value)} />
          ) : (
            <SgdsInput
              type="datetime-local"
              label=""
              hintText={`Compares ${TRIAL_DEPARTURE_COUNT} departure times, ${TRIAL_DEPARTURE_STEP_MIN} min apart, that work back from this time.`}
              value={arriveBy}
              onSgdsInput={(e) => setArriveBy(e.target.value)}
            />
          )}
          {samePoint && <p className="sgds:m-0 sgds:text-body-sm sgds:text-subtle">Pick two different locations.</p>}
          <div className="sgds:flex sgds:gap-component-xs">
            <div className="sgds:flex-1">
              <SgdsButton
                variant="primary"
                fullWidth
                ariaLabel={timeMode === "arrive" ? "Compare departure times" : "Plan journey"}
                disabled={!canPlan || loading}
                loading={loading}
                onClick={planJourney}
              >
                {loading ? progress || "Planning…" : timeMode === "arrive" ? "Compare departure times" : "Plan journey"}
              </SgdsButton>
            </div>
            <SgdsButton variant="outline" ariaLabel="Save this route" disabled={!canPlan} onClick={handleSaveRoute}>
              {justSaved ? "Saved ✓" : "Save"}
            </SgdsButton>
          </div>

            </>
          )}

        {trials && sheetState !== "peek" && (
          <SgdsCard className="sgds:h-auto">
            <span slot="title" className={CARD_TITLE}>
              Departure options
            </span>
            <div className="sgds:flex sgds:flex-col sgds:gap-component-sm">
              <p className="sgds:text-body-sm sgds:text-subtle">Latest acceptable arrival: {timeOf(new Date(arriveBy).getTime())}</p>
              {trials.map((t, i) => {
                const recommended = t.onTime && t === trials.find((r) => r.onTime);
                return (
                  <div
                    key={i}
                    className="sgds:flex sgds:items-center sgds:justify-between sgds:gap-component-sm sgds:rounded-md sgds:bg-surface-raised sgds:p-component-sm"
                  >
                    <div className="sgds:flex sgds:flex-col">
                      <span className="sgds:text-body-md sgds:font-semibold sgds:text-default">
                        {t.route ? `${timeOf(t.departAt.getTime())} → ${timeOf(t.arrivalMs)}` : timeOf(t.departAt.getTime())}
                      </span>
                      <span className="sgds:text-caption-md sgds:text-subtle">
                        {t.route
                          ? `${Math.round(t.route.durationSeconds / 60)} min · ${t.route.transfers} transfer${t.route.transfers !== 1 ? "s" : ""} · ${Math.round(t.route.walkDistanceMeters)}m walk`
                          : t.error}
                      </span>
                    </div>
                    <div className="sgds:flex sgds:items-center sgds:gap-component-xs">
                      {recommended && <SgdsBadge variant="success">Recommended</SgdsBadge>}
                      {t.route && !t.onTime && <SgdsBadge variant="warning">Late</SgdsBadge>}
                      {t.route && (
                        <SgdsButton size="xs" variant="outline" ariaLabel="View this journey" onClick={() => showRoute(t.route)}>
                          View
                        </SgdsButton>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </SgdsCard>
        )}

          {result && sheetState === "full" && (
            <>

        {result && (
          <>
            {result.isWalkOnly && (
              <SgdsAlert show variant="info">
                No bus or train service was found for this departure time - showing a
                walking-only route instead. This usually means the departure time falls outside
                service hours; try a different time.
              </SgdsAlert>
            )}



            <SgdsCard className="sgds:h-auto">
              <span slot="title" className={CARD_TITLE}>
                Journey
              </span>
              <JourneyTimeline legs={displayResult.legs} />
            </SgdsCard>

            {preferredExitInfo && (
              <SgdsCard className="sgds:h-auto">
                <span slot="title" className={CARD_TITLE}>
                  Ideal Exit
                </span>
                <div className="sgds:flex sgds:flex-col sgds:gap-component-sm">
                  {liftFault && (
                    <SgdsAlert show variant="danger" title="Lift out of service">
                      {liftFault.message}
                    </SgdsAlert>
                  )}
                  <div className={INFO_ROW}>
                    <div className={INFO_BADGE}>{preferredExitInfo.exit}</div>
                    <div>
                      <div className="sgds:text-body-md sgds:font-semibold sgds:text-default">
                        Leave via {preferredExitInfo.exit} at {result.alightStation.name}
                      </div>
                      <div className="sgds:text-body-sm sgds:text-subtle">
                        {exitPreferenceActive
                          ? `Alternative exit (not verified step-free) - ${walkText}`
                          : `Closest exit to your destination - ${walkText}`}
                      </div>
                    </div>
                  </div>
                  {activeScenario === SCENARIOS.LIFT && !wheelchairMode && (
                    <>
                      <SgdsCheckbox checked={preferAlternativeExit} onSgdsChange={(e) => setPreferAlternativeExit(e.target.checked)}>
                        Use alternative exit (not verified step-free; updates the walking route)
                      </SgdsCheckbox>
                      {preferAlternativeExit && (
                        <p className="sgds:text-caption-md sgds:text-subtle">
                          Updates the exit throughout your journey. If there's a bus connection after
                          the station, its stop name updates too, but its distance/timing stays as
                          originally planned - confirming the exact walk to a different exit's bus
                          stop would need live bus-stop data.
                        </p>
                      )}
                    </>
                  )}
                </div>
              </SgdsCard>
            )}


            {displayBestDoor && (
              <SgdsCard className="sgds:h-auto">
                <span slot="title" className={CARD_TITLE}>
                  Follow Journey
                </span>
                <div className="sgds:flex sgds:flex-col sgds:gap-component-sm">
                  {doorFault && (
                    <SgdsAlert show variant="danger" title={`Door ${doorFault.facilityId} temporarily closed`}>
                      {doorFault.message}
                    </SgdsAlert>
                  )}
                  <div className={INFO_ROW}>
                    <div className={INFO_BADGE}>{displayBestDoor.doorId}</div>
                    <div>
                      <div className="sgds:text-body-md sgds:font-semibold sgds:text-default">Board near door {displayBestDoor.doorId}</div>
                      <div className="sgds:text-body-sm sgds:text-subtle">
                        {doorFault ? "Next best available door" : `Lowest crowding at ${result.alightStation.name}`}
                        {doorSource === "mock" ? " (simulated data)" : ""}
                      </div>
                    </div>
                  </div>
                </div>
              </SgdsCard>
            )}
          </>
        )}



              <SimulationControls active={activeScenario} onToggle={toggleScenario} />
              <p className="sgds:m-0 sgds:text-caption-md sgds:text-subtle">
                Map data © OneMap &amp; Singapore Land Authority. Bicycle parking: LTA DataMall when available, otherwise © OpenStreetMap contributors (community-mapped, may be incomplete; a saved copy is used if the live server is slow).
              </p>
            </>
          )}
        </div>
      </div>

      <TripOptionsDrawer
        open={optionsOpen}
        onClose={() => setOptionsOpen(false)}
        options={options}
        setOptions={setOptions}
        setModeOption={setModeOption}
      />
    </div>
  );
}

function Stat({ value, label }) {
  return (
    <div>
      <div className="sgds:text-heading-md sgds:font-bold sgds:text-default">{value}</div>
      <div className="sgds:text-label-xs sgds:uppercase sgds:text-subtle">{label}</div>
    </div>
  );
}

// The 3-dot menu: which transport modes to consider, and how to rank what comes back.
function TripOptionsDrawer({ open, onClose, options, setOptions, setModeOption }) {
  return (
    <SgdsDrawer open={open} placement="bottom" size="lg" ariaLabel="Trip options" onSgdsAfterHide={onClose}>
      <span slot="title">Trip options</span>
      <div className="sgds:flex sgds:flex-col sgds:gap-layout-sm">
        <div className="sgds:flex sgds:flex-col sgds:gap-component-sm">
          <div className={CARD_TITLE}>Transport modes</div>
          <SgdsCheckbox checked={options.nel} onSgdsChange={(e) => setModeOption("nel", e.target.checked)}>
            Purple Line (North East Line)
          </SgdsCheckbox>
          <SgdsCheckbox checked={options.ccl} onSgdsChange={(e) => setModeOption("ccl", e.target.checked)}>
            Circle Line
          </SgdsCheckbox>
          <SgdsCheckbox checked={options.bus} onSgdsChange={(e) => setModeOption("bus", e.target.checked)}>
            Bus
          </SgdsCheckbox>
          <SgdsCheckbox checked={options.lrt} onSgdsChange={(e) => setModeOption("lrt", e.target.checked)}>
            LRT (Sengkang / Punggol)
          </SgdsCheckbox>
          <SgdsCheckbox checked={options.twoWheeler} onSgdsChange={(e) => setOptions((o) => ({ ...o, twoWheeler: e.target.checked }))}>
            Two-wheeler (cycle to the nearest MRT station)
          </SgdsCheckbox>
          {options.twoWheeler && (
            <p className="sgds:text-caption-md sgds:text-subtle">
              Cycling time and distance come from OneMap's cycling route, then public transport
              continues from the station. Bicycle parking availability isn't shown yet - it needs
              LTA DataMall access.
            </p>
          )}
        </div>

        <SgdsRadioGroup
          label="Filter by"
          name="sort"
          value={options.sort}
          onSgdsChange={(e) => setOptions((o) => ({ ...o, sort: e.target.value }))}
        >
          {Object.entries(SORT_LABELS).map(([value, label]) => (
            <SgdsRadio key={value} value={value}>
              {label}
            </SgdsRadio>
          ))}
        </SgdsRadioGroup>
      </div>
      <div slot="footer" className="sgds:flex sgds:gap-component-sm">
        <SgdsButton variant="ghost" ariaLabel="Reset to defaults" onClick={() => setOptions(DEFAULT_TRIP_OPTIONS)}>
          Reset
        </SgdsButton>
        <SgdsButton variant="primary" ariaLabel="Done" onClick={onClose}>
          Done
        </SgdsButton>
      </div>
    </SgdsDrawer>
  );
}

// Hackathon/demo controls - not a normal passenger control. Lets a
// presenter show how Wayfinder reacts to a platform door fault, a lift
// outage, an unplanned Purple Line disruption, or planned engineering
// works, without depending on a real disruption actually happening during
// the demo. Deliberately offline - no live fetches behind these buttons.
function SimulationControls({ active, onToggle }) {
  const options = [
    { key: SCENARIOS.DOOR_FAULT, label: "Door Fault" },
    { key: SCENARIOS.LIFT, label: "Lift Not Working" },
    { key: SCENARIOS.UNPLANNED, label: "Unplanned Disruption" },
    { key: SCENARIOS.PLANNED, label: "Planned Disruption" },
  ];

  return (
    <div className="sgds:mt-component-xs sgds:border-x-0 sgds:border-b-0 sgds:border-t sgds:border-dashed sgds:border-default sgds:pt-component-md">
      <div className="sgds:mb-component-xs sgds:text-label-xs sgds:uppercase sgds:text-subtle">Simulate disruption</div>
      <div className="sgds:flex sgds:flex-wrap sgds:gap-component-xs">
        {options.map((opt) => (
          <SgdsButton
            key={opt.key}
            size="sm"
            variant={active === opt.key ? "primary" : "outline"}
            ariaLabel={opt.label}
            onClick={() => onToggle(opt.key)}
          >
            {opt.label}
          </SgdsButton>
        ))}
        {active && (
          <SgdsButton size="sm" variant="outline" tone="danger" ariaLabel="Reset" onClick={() => onToggle(null)}>
            Reset
          </SgdsButton>
        )}
      </div>
    </div>
  );
}

function AddressInput({ label, placeholder = "Search an address, building, or postal code", value, onChange }) {
  const [query, setQuery] = useState(value?.label || "");
  const [suggestions, setSuggestions] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Selected value's own label shouldn't immediately re-trigger a search.
    if (value && query === value.label) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    if (query.trim().length < 3) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.searchAddress(query.trim());
        setSuggestions(data.results || []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setSearching(false);
      }
    }, 350);

    return () => clearTimeout(debounceRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function pick(result) {
    setQuery(result.label);
    setOpen(false);
    onChange({ label: result.label, lat: result.lat, lng: result.lng });
  }

  return (
    <div className="sgds:relative">
      <SgdsInput
        type="text"
        label=""
        aria-label={label}
        placeholder={placeholder}
        autocomplete="off"
        loading={searching}
        value={query}
        onSgdsInput={(e) => {
          setQuery(e.target.value);
          if (value) onChange(null); // typing again invalidates the previous selection
        }}
        onSgdsFocus={() => suggestions.length > 0 && setOpen(true)}
        onSgdsBlur={() => setTimeout(() => setOpen(false), 150)} // allow click on a suggestion first
      />
      {open && suggestions.length > 0 && (
        <div className="sgds:absolute sgds:inset-x-0 sgds:top-full sgds:z-20 sgds:mt-1 sgds:max-h-64 sgds:overflow-y-auto sgds:rounded-md sgds:border sgds:border-default sgds:bg-surface-raised sgds:shadow-3">
          {suggestions.slice(0, 6).map((r, i) => (
            <div
              key={i}
              className="sgds:cursor-pointer sgds:border-b sgds:border-muted sgds:p-component-sm sgds:last:border-b-0 sgds:hover:bg-surface-default"
              onMouseDown={() => pick(r)}
            >
              <div className="sgds:text-body-sm sgds:text-default">{r.label}</div>
              {r.address && r.address !== r.label && (
                <div className="sgds:mt-0.5 sgds:text-caption-md sgds:text-subtle">{r.address}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
