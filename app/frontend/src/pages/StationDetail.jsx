import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { SgdsAlert, SgdsBadge, SgdsButton, SgdsCard } from "@govtechsg/sgds-web-component/react";
import { LINES, stationByCode } from "../stations.js";
import { exitsForStation } from "../stationExits.js";
import { api } from "../api.js";
import { interpretAlerts } from "../services/serviceStatus.js";
import TrainDiagram from "../components/TrainDiagram1.jsx";
import BicycleParkingCard from "../components/BicycleParkingCard.jsx";
import PageHeader from "../components/PageHeader.jsx";

const QUICK_ACTIONS = [
  { key: "live", label: "Live Status" },
  { key: "boarding", label: "Platform Boarding" },
  { key: "facilities", label: "Facilities" },
  { key: "wayfinder", label: "Wayfinder" },
  { key: "bicycle", label: "Bicycle Parking" },
];

const CARD_TITLE = "sgds:text-label-md sgds:font-semibold sgds:uppercase sgds:text-default";
const NOTE = "sgds:mt-component-sm sgds:text-caption-md sgds:text-subtle";

// Deterministic mock so the same station always shows the same facility
// state during a session, rather than random flicker on every render.
function seededFacilities(stationCode) {
  const seed = stationCode.split("").reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const facilities = [
    { name: "Lift A (Concourse ↔ Platform)", type: "lift" },
    { name: "Lift B (Street ↔ Concourse)", type: "lift" },
    { name: "Escalator 1", type: "escalator" },
    { name: "Escalator 2", type: "escalator" },
    { name: "Wheelchair-accessible toilet", type: "amenity" },
    { name: "Passenger service centre", type: "amenity" },
  ];
  return facilities.map((f, i) => ({
    ...f,
    status: (seed + i) % 11 === 0 ? "down" : "operational",
  }));
}

export default function StationDetail() {
  const { stationCode: routeCode } = useParams();
  const navigate = useNavigate();
  const station = stationByCode(routeCode);
  // Interchanges have several codes (Dhoby Ghaut is NE6 and CC1); everything below uses the canonical one.
  const stationCode = station?.code ?? routeCode;
  const lineId = station?.lines[0] ?? "NEL";
  // Platform-door guidance is built around MRT platforms; there is no LRT equivalent.
  const isLrtOnly = !!station && station.lines.every((l) => l === "SPLRT");
  const exitLabels = useMemo(() => [...new Set(exitsForStation(stationCode).map((e) => e.exit))], [stationCode]);

  const [activeTab, setActiveTab] = useState("boarding");
  const [doorData, setDoorData] = useState(null);
  const [doorError, setDoorError] = useState(null);
  const [alerts, setAlerts] = useState(null);
  const [alertsError, setAlertsError] = useState(null);
  const [pickedExit, setPickedExit] = useState(null);
  const selectedExit = pickedExit ?? exitLabels[0];

  useEffect(() => {
  setDoorData(null);
  setDoorError(null);

  if (isLrtOnly) {
    api.getTrainAlerts().then(setAlerts).catch((err) => setAlertsError(err.message));
    return undefined;
  }

  function fetchDoorData() {
    api
      .getDoorDensity(stationCode)
      .then(setDoorData)
      .catch((err) => setDoorError(err.message));
  }

  fetchDoorData(); // initial load
  const intervalId = setInterval(fetchDoorData, 5000); // matches SmartGS's own 5s cycle

  api
    .getTrainAlerts()
    .then(setAlerts)
    .catch((err) => setAlertsError(err.message));

  return () => clearInterval(intervalId); // stop polling when leaving the page
}, [stationCode, isLrtOnly]);

  const facilities = useMemo(() => seededFacilities(stationCode), [stationCode]);
  const brokenFacilities = facilities.filter((f) => f.status === "down");

  const status = interpretAlerts(alerts, lineId);

  const bestDoor = useMemo(() => {
    if (!doorData) return null;
    const order = { low: 0, medium: 1, high: 2 };
    return [...doorData.doors].sort((a, b) => order[a.density] - order[b.density])[0];
  }, [doorData]);

  return (
    <>
      <PageHeader title={station ? station.name : stationCode} onBack={() => navigate(-1)} />
      <div className="sgds:flex sgds:flex-col sgds:gap-component-md sgds:p-layout-md">
        <div className="sgds:flex sgds:flex-wrap sgds:items-center sgds:gap-component-xs">
          {(station?.codes ?? [stationCode]).map((c) => (
            <SgdsBadge key={c} variant="purple">{c}</SgdsBadge>
          ))}
          {station?.lines.map((l) => (
            <span key={l} className="sgds:text-caption-md sgds:text-subtle">{LINES[l].name}</span>
          ))}
        </div>

        <div className="sgds:grid sgds:grid-cols-2 sgds:gap-component-xs">
          {QUICK_ACTIONS.map((action) => (
            <SgdsButton
              key={action.key}
              fullWidth
              variant={activeTab === action.key ? "primary" : "outline"}
              ariaLabel={action.label}
              onClick={() => setActiveTab(action.key)}
            >
              {action.label}
            </SgdsButton>
          ))}
        </div>

        {activeTab === "bicycle" ? (
          <BicycleParkingCard stationCode={stationCode} />
        ) : (
          <SgdsCard>
            {activeTab === "live" && (
              <>
                <span slot="title" className={CARD_TITLE}>Live Status</span>
                {alertsError && <p className="sgds:text-body-sm sgds:text-subtle">Couldn't load live status ({alertsError})</p>}
                {!alertsError && !alerts && <p className="sgds:text-body-sm sgds:text-subtle">Checking service status…</p>}
                {!alertsError && alerts && (
                  <>
                    {status.state === "disrupted" ? (
                      <SgdsBadge variant="warning">Disruption reported on the {LINES[lineId].name}</SgdsBadge>
                    ) : status.state === "normal" ? (
                      <SgdsBadge variant="success">{status.normalText} on the {LINES[lineId].name}</SgdsBadge>
                    ) : (
                      <SgdsBadge variant="neutral">Live status unavailable</SgdsBadge>
                    )}
                    <p className={NOTE}>
                      Next-train countdown isn't in LTA's public data for MRT (only buses) — this section is
                      where SmartGS or an operator feed would plug in.
                    </p>
                  </>
                )}
              </>
            )}

            {activeTab === "boarding" && (
              <>
                <span slot="title" className={CARD_TITLE}>Platform Boarding</span>
                {isLrtOnly && (
                  <p className="sgds:text-body-sm sgds:text-subtle">
                    Door-level boarding guidance is only available for MRT platforms, not LRT stations.
                  </p>
                )}
                {!isLrtOnly && doorError && <p className="sgds:text-body-sm sgds:text-subtle">Couldn't load door data ({doorError})</p>}
                {!isLrtOnly && !doorError && !doorData && <p className="sgds:text-body-sm sgds:text-subtle">Reading platform sensors…</p>}
                {!isLrtOnly && doorData && (
                  <>
                    <p className="sgds:mb-1 sgds:text-body-sm sgds:text-subtle">Live from SmartGS</p>
                    <TrainDiagram doors={doorData.doors} />
                  </>
                )}
              </>
            )}

            {activeTab === "facilities" && (
              <>
                <span slot="title" className={CARD_TITLE}>Facilities</span>
                {brokenFacilities.length > 0 && (
                  <SgdsAlert show variant="warning">
                    {brokenFacilities.length} facilit{brokenFacilities.length > 1 ? "ies" : "y"} needs attention
                  </SgdsAlert>
                )}
                <div className="sgds:flex sgds:flex-col">
                  {facilities.map((f) => (
                    <div key={f.name} className="sgds:flex sgds:items-center sgds:gap-component-sm sgds:border-b sgds:border-muted sgds:py-component-sm sgds:last:border-b-0">
                      <FacilityIcon type={f.type} down={f.status === "down"} />
                      <span className="sgds:flex-1 sgds:text-body-sm sgds:text-default">{f.name}</span>
                      <SgdsBadge variant={f.status === "down" ? "danger" : "success"}>
                        {f.status === "down" ? "Under maintenance" : "Operational"}
                      </SgdsBadge>
                    </div>
                  ))}
                </div>
                <p className={NOTE}>
                  Simulated for this prototype — a real deployment would pull this from LTA/operator fault feeds.
                </p>
              </>
            )}

            {activeTab === "wayfinder" && (
              <>
                <span slot="title" className={CARD_TITLE}>Wayfinder</span>
                <p className="sgds:mb-component-sm sgds:text-body-sm sgds:text-subtle">Heading towards</p>
                <div className="sgds:mb-component-md sgds:flex sgds:flex-wrap sgds:gap-component-xs">
                  {exitLabels.map((exit) => (
                    <SgdsButton
                      key={exit}
                      size="sm"
                      variant={selectedExit === exit ? "primary" : "outline"}
                      ariaLabel={exit}
                      onClick={() => setPickedExit(exit)}
                    >
                      {exit}
                    </SgdsButton>
                  ))}
                </div>

                {!isLrtOnly && doorData && bestDoor && (
                  <div className="sgds:flex sgds:items-center sgds:gap-component-md sgds:rounded-md sgds:bg-surface-raised sgds:p-component-md">
                    <div className="sgds:grid sgds:size-11 sgds:shrink-0 sgds:place-items-center sgds:rounded-md sgds:border sgds:border-success-default sgds:bg-success-surface-muted sgds:font-bold sgds:text-success-default">
                      {bestDoor.doorId}
                    </div>
                    <div>
                      <div className="sgds:text-body-md sgds:font-semibold sgds:text-default">Board near door {bestDoor.doorId}</div>
                      <div className="sgds:text-body-sm sgds:text-subtle">
                        Lowest crowding right now, and closest lift/escalator access towards {selectedExit}
                      </div>
                    </div>
                  </div>
                )}
                {!isLrtOnly && !doorData && <p className="sgds:text-body-sm sgds:text-subtle">Waiting on platform boarding data…</p>}
                {exitLabels.length === 0 && <p className="sgds:text-body-sm sgds:text-subtle">No exit data for this station.</p>}
                <p className={NOTE}>
                  Exit-to-door mapping is simulated here — a real version would use the station's actual
                  exit/escalator layout.
                </p>
              </>
            )}
          </SgdsCard>
        )}
      </div>
    </>
  );
}

function FacilityIcon({ type, down }) {
  const tone = down ? "sgds:text-danger-default" : "sgds:text-subtle";
  const color = "currentColor";
  if (type === "lift") {
    return (
      <svg className={tone} width="18" height="18" viewBox="0 0 24 24" fill="none">
        <rect x="5" y="3" width="14" height="18" rx="2" stroke={color} strokeWidth="1.6" />
        <path d="M12 7v6M9.5 10 12 7l2.5 3" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "escalator") {
    return (
      <svg className={tone} width="18" height="18" viewBox="0 0 24 24" fill="none">
        <path d="M4 18h5l9-11h2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="6" cy="18" r="1.4" fill={color} />
        <circle cx="18" cy="7" r="1.4" fill={color} />
      </svg>
    );
  }
  return (
    <svg className={tone} width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="12" r="8" stroke={color} strokeWidth="1.6" />
      <path d="M12 8v4l3 2" stroke={color} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
