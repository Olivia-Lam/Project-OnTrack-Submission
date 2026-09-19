import { useContext, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SgdsAlert, SgdsBadge, SgdsButton, SgdsCard, SgdsIcon, SgdsIconButton, SgdsInput } from "@govtechsg/sgds-web-component/react";
import { ALL_STATIONS, FAVORITE_STATION_CODES, LINES, LINE_IDS, stationByCode } from "../stations.js";
import { api } from "../api.js";
import MrtMapSheet from "../components/MrtMapSheet.jsx";
import PageHeader from "../components/PageHeader.jsx";
import { ThemeContext } from "../hooks/useTheme.js";
import { listRoutes } from "../services/savedRoutes.js";
import { interpretAlerts } from "../services/serviceStatus.js";

const SECTION_TITLE = "sgds:m-0 sgds:text-label-md sgds:font-semibold sgds:uppercase sgds:text-default";
const MAX_SAVED_SHOWN = 3;

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// A datetime-local value an hour from now, used to open the planner in "Arrive by" mode.
function inOneHour() {
  const d = new Date(Date.now() + 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function Home() {
  const navigate = useNavigate();
  const { theme, toggleTheme } = useContext(ThemeContext);
  const [query, setQuery] = useState("");
  const [alerts, setAlerts] = useState(null);
  const [alertsError, setAlertsError] = useState(null);
  const [savedRoutes] = useState(() => listRoutes());

  useEffect(() => {
    api
      .getTrainAlerts()
      .then(setAlerts)
      .catch((err) => setAlertsError(err.message));
  }, []);

  const statuses = Object.fromEntries(LINE_IDS.map((id) => [id, alertsError ? { state: "unavailable" } : interpretAlerts(alerts, id)]));
  const disrupted = LINE_IDS.filter((id) => statuses[id].state === "disrupted");
  const sourceLabel = LINE_IDS.map((id) => statuses[id].sourceLabel).find(Boolean);
  const isReplay = LINE_IDS.some((id) => statuses[id].live === false);

  function handleSearchSubmit() {
    const q = query.trim().toLowerCase();
    const match = ALL_STATIONS.find((s) => s.name.toLowerCase().includes(q) || s.codes.some((c) => c.toLowerCase() === q));
    if (match) navigate(`/train/${match.code}`);
  }

  // The planner reads router state as a prefill (see services/savedRoutes.js).
  const openPlanner = (prefill) => navigate("/journey-planner", prefill ? { state: { prefill } } : undefined);

  return (
    <>
      <PageHeader title="OnTrack" showLineDot>
        <SgdsIconButton
          name={theme === "dark" ? "sun" : "moon"}
          variant="ghost"
          tone="neutral"
          ariaLabel="Toggle light/dark mode"
          onClick={toggleTheme}
        />
      </PageHeader>

      <div className="sgds:flex sgds:flex-col sgds:gap-layout-sm sgds:p-layout-md sgds:pb-24">
        {/* Live service status, per line - only a strong signal when it is real */}
        {disrupted.length > 0 && (
          <SgdsAlert show variant="warning" title="Service disruption reported">
            <span>
              {statuses[disrupted[0]].message || `Check the ${LINES[disrupted[0]].name} before you travel.`}
              {disrupted.length > 1 ? ` (${disrupted.length} lines affected)` : ""}
            </span>
            <SgdsButton slot="action" size="sm" variant="primary" ariaLabel="View disruption details" onClick={() => navigate("/train")}>
              Details
            </SgdsButton>
          </SgdsAlert>
        )}
        <div className="sgds:flex sgds:flex-col sgds:gap-1">
          <div className="sgds:flex sgds:flex-wrap sgds:gap-component-xs" aria-label="Line status">
            {LINE_IDS.map((id) => {
              const st = statuses[id].state;
              return (
                <SgdsBadge key={id} variant={st === "normal" ? "success" : st === "disrupted" ? "warning" : "neutral"}>
                  {LINES[id].short}: {st === "normal" ? "OK" : st === "disrupted" ? "Disrupted" : st === "loading" ? "…" : "n/a"}
                </SgdsBadge>
              );
            })}
          </div>
          <span className="sgds:text-caption-md sgds:text-subtle">
            {sourceLabel ? (isReplay ? sourceLabel : `Live from ${sourceLabel}`) : "Live status unavailable right now"}
          </span>
        </div>

        {/* Hero: the main job of the app is planning a trip */}
        <div
          role="button"
          tabIndex={0}
          aria-label="Plan a journey"
          className="sgds:flex sgds:cursor-pointer sgds:flex-col sgds:gap-component-md sgds:rounded-2-xl sgds:bg-primary-default sgds:p-layout-md sgds:text-fixed-light sgds:shadow-3"
          onClick={() => openPlanner()}
          onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPlanner()}
        >
          <div>
            <div className="sgds:text-label-sm sgds:opacity-90">{greeting()}</div>
            <div className="sgds:text-heading-md sgds:font-bold">Where to today?</div>
          </div>
          <div className="sgds:flex sgds:items-center sgds:gap-component-sm sgds:rounded-full sgds:bg-surface-fixed-light sgds:px-component-md sgds:py-component-sm sgds:text-body-md sgds:text-fixed-dark">
            <SgdsIcon name="search" size="md" />
            Search a destination
          </div>
          <div className="sgds:flex sgds:flex-wrap sgds:gap-component-xs">
            <button
              type="button"
              className="sgds:cursor-pointer sgds:rounded-full sgds:border-0 sgds:bg-translucent-fixed-light sgds:px-component-md sgds:py-1.5 sgds:text-label-sm sgds:font-semibold sgds:text-fixed-light"
              onClick={(e) => {
                e.stopPropagation();
                openPlanner({ tripOptions: { twoWheeler: true } });
              }}
            >
              Cycle + train
            </button>
            <button
              type="button"
              className="sgds:cursor-pointer sgds:rounded-full sgds:border-0 sgds:bg-translucent-fixed-light sgds:px-component-md sgds:py-1.5 sgds:text-label-sm sgds:font-semibold sgds:text-fixed-light"
              onClick={(e) => {
                e.stopPropagation();
                openPlanner({ arrivalWindow: inOneHour() });
              }}
            >
              Arrive by a time
            </button>
          </div>
        </div>

        {/* Saved routes: one tap back to a regular trip */}
        <section className="sgds:flex sgds:flex-col sgds:gap-component-sm">
          <div className="sgds:flex sgds:items-center sgds:justify-between">
            <h2 className={SECTION_TITLE}>Saved routes</h2>
            {savedRoutes.length > 0 && (
              <SgdsButton size="xs" variant="ghost" ariaLabel="See all saved routes" onClick={() => navigate("/saved")}>
                See all
              </SgdsButton>
            )}
          </div>
          {savedRoutes.length === 0 ? (
            <SgdsCard>
              <div className="sgds:flex sgds:items-center sgds:justify-between sgds:gap-component-md">
                <span className="sgds:text-body-sm sgds:text-subtle">
                  Save a trip you make often and it will show up here, one tap from the planner.
                </span>
                <SgdsButton size="sm" variant="outline" ariaLabel="Add a saved route" onClick={() => navigate("/saved")}>
                  Add
                </SgdsButton>
              </div>
            </SgdsCard>
          ) : (
            <div className="sgds:flex sgds:flex-col sgds:gap-component-xs">
              {savedRoutes.slice(0, MAX_SAVED_SHOWN).map((r) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  aria-label={`Plan ${r.from.label} to ${r.to.label}`}
                  className="sgds:flex sgds:cursor-pointer sgds:items-center sgds:gap-component-sm sgds:rounded-lg sgds:border sgds:border-muted sgds:bg-surface-raised sgds:p-component-md"
                  onClick={() => openPlanner(r)}
                  onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && openPlanner(r)}
                >
                  <span className="sgds:text-primary-default">
                    <SgdsIcon name="bookmark" size="md" />
                  </span>
                  <div className="sgds:min-w-0 sgds:flex-1">
                    <div className="sgds:truncate sgds:text-body-sm sgds:font-semibold sgds:text-default">
                      {r.from.label} → {r.to.label}
                    </div>
                    <div className="sgds:text-caption-md sgds:text-subtle">
                      {r.arrivalWindow
                        ? `Arrive by ${new Date(r.arrivalWindow).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                        : r.departAt
                          ? `Usually ${new Date(r.departAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
                          : "Any time"}
                    </div>
                  </div>
                  <SgdsIcon name="chevron-right" size="md" />
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Stations: search or jump to a favourite */}
        <section className="sgds:flex sgds:flex-col sgds:gap-component-sm">
          <div className="sgds:flex sgds:items-center sgds:justify-between">
            <h2 className={SECTION_TITLE}>Stations</h2>
            <SgdsButton size="xs" variant="ghost" ariaLabel={`Browse all ${ALL_STATIONS.length} stations`} onClick={() => navigate("/train")}>
              All {ALL_STATIONS.length} stations
            </SgdsButton>
          </div>
          <div onKeyDown={(e) => e.key === "Enter" && handleSearchSubmit()}>
            <SgdsInput
              type="search"
              label=""
              aria-label="Find a station"
              placeholder="Search any MRT or LRT station"
              value={query}
              onSgdsInput={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="sgds:flex sgds:flex-wrap sgds:gap-component-xs">
            {FAVORITE_STATION_CODES.map((code) => {
              const station = stationByCode(code);
              if (!station) return null;
              return (
                <SgdsButton key={code} size="sm" variant="outline" tone="neutral" ariaLabel={station.name} onClick={() => navigate(`/train/${code}`)}>
                  {station.name}
                </SgdsButton>
              );
            })}
          </div>
        </section>
      </div>

      <MrtMapSheet />
    </>
  );
}
