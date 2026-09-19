import { SgdsBadge, SgdsIcon } from "@govtechsg/sgds-web-component/react";
import { lineBadgeVariant, lineLabel, lineTextClass } from "../services/lineStyle.js";

// Accent per travel mode, expressed as SGDS colour-token utility classes (no hex, no inline style).
const MODE_TEXT = {
  WALK: "sgds:text-subtle",
  BICYCLE: "sgds:text-success-default",
  BUS: "sgds:text-accent-default",
  SUBWAY: "sgds:text-primary-default",
  TRAM: "sgds:text-primary-default",
};

const MODE_TITLE = {
  WALK: "Walk",
  BICYCLE: "Cycle",
  BUS: "Bus",
  SUBWAY: "Purple Line",
  TRAM: "LRT",
};

// SGDS has no cycling icon in its registry, so this one glyph stays inline SVG.
function BicycleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="5.5" cy="17" r="3.5" />
      <circle cx="18.5" cy="17" r="3.5" />
      <path d="M5.5 17 9 8h5l4.5 9M9 8 12 17M14 8l-1.5-3H10" />
    </svg>
  );
}

function ModeIcon({ mode }) {
  const color = MODE_TEXT[mode] || "sgds:text-subtle";
  return (
    <span className={`sgds:inline-flex sgds:items-center ${color}`}>
      {mode === "BICYCLE" ? (
        <BicycleGlyph />
      ) : (
        <SgdsIcon name={mode === "BUS" ? "bus" : mode === "SUBWAY" || mode === "TRAM" ? "train" : "person"} size="md" />
      )}
    </span>
  );
}

function formatTime(ms) {
  if (!ms) return null;
  return new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(seconds) {
  const min = Math.round(seconds / 60);
  return min <= 1 ? "1 min" : `${min} min`;
}

const ROW = "sgds:grid sgds:grid-cols-[52px_20px_1fr] sgds:items-start sgds:gap-x-component-sm";

function TimelineStop({ time, name, isDestination }) {
  const dot = isDestination
    ? "sgds:size-3 sgds:border-3 sgds:border-primary-default"
    : "sgds:size-2.5 sgds:border-2 sgds:border-default";
  return (
    <div className={ROW}>
      <span className="sgds:text-caption-md sgds:text-subtle sgds:text-right sgds:pt-px">{formatTime(time)}</span>
      <span className={`sgds:justify-self-center sgds:mt-1 sgds:rounded-full sgds:bg-surface-default ${dot}`} />
      <span className="sgds:text-body-md sgds:font-semibold sgds:text-default sgds:pt-0.5 sgds:pb-component-sm">{name}</span>
    </div>
  );
}

function TimelineLeg({ leg }) {
  const isTransit = leg.mode !== "WALK" && leg.mode !== "BICYCLE";
  const stops = leg.intermediateStops?.length ?? 0;
  const bridging = leg.isBridging === true;
  let title;
  if (bridging) title = "Bridging Bus";
  else if (leg.mode === "BUS") title = `Bus ${leg.routeId}`;
  else if (leg.mode === "SUBWAY" || leg.mode === "TRAM") title = lineLabel(leg);
  else title = MODE_TITLE[leg.mode] || leg.mode;

  let caption;
  if (bridging) {
    caption = `Free shuttle service · Approx. ${formatDuration(leg.durationSeconds)}`;
  } else if (leg.mode === "WALK") {
    caption = `About ${formatDuration(leg.durationSeconds)}, ${Math.round(leg.distanceMeters)}m`;
  } else if (leg.mode === "BICYCLE") {
    caption = `${formatDuration(leg.durationSeconds)}, ${(leg.distanceMeters / 1000).toFixed(1)} km · OneMap cycling route`;
  } else {
    caption =
      `${formatDuration(leg.durationSeconds)}${stops > 0 ? ` · ${stops} stop${stops !== 1 ? "s" : ""}` : " (non-stop)"}` +
      (leg.to?.stopCode ? ` · Stop ID: ${leg.to.stopCode}` : "");
  }

  const detailBox = bridging
    ? "sgds:border sgds:border-dashed sgds:border-warning-default sgds:rounded-md sgds:bg-warning-surface-muted sgds:p-component-xs"
    : "";

  return (
    <div className={`${ROW} sgds:min-h-11`}>
      <span />
      <span className="sgds:justify-self-center sgds:self-stretch sgds:border-y-0 sgds:border-r-0 sgds:border-l-3 sgds:border-dotted sgds:border-muted sgds:min-h-9" />
      <div className={`sgds:pb-component-sm ${detailBox}`}>
        <div className="sgds:flex sgds:items-center sgds:gap-component-xs sgds:text-body-md sgds:font-medium sgds:text-default">
          <ModeIcon mode={leg.mode} leg={leg} />
          <span>{title}</span>
          {(leg.mode === "SUBWAY" || leg.mode === "TRAM") && !bridging && leg.routeId && <SgdsBadge variant={lineBadgeVariant(leg)}>{leg.routeId}</SgdsBadge>}
          {bridging && <SgdsBadge variant="warning">Disruption</SgdsBadge>}
        </div>
        <div className="sgds:mt-1 sgds:text-body-sm sgds:text-subtle">{caption}</div>
        {isTransit && leg.agencyName && !bridging && <div className="sgds:mt-0.5 sgds:text-caption-md sgds:text-subtle">Service run by {leg.agencyName}</div>}
      </div>
    </div>
  );
}

export default function JourneyTimeline({ legs }) {
  if (!legs || legs.length === 0) return null;
  const first = legs[0];
  const last = legs[legs.length - 1];

  return (
    <div className="sgds:flex sgds:flex-col">
      <TimelineStop time={first.startTimeMs} name={first.from?.name || "Start"} />
      {legs.map((leg, i) => (
        <div key={i}>
          <TimelineLeg leg={leg} />
          <TimelineStop time={leg.endTimeMs} name={leg.to?.name || "—"} isDestination={leg === last} />
        </div>
      ))}
    </div>
  );
}
