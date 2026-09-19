import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { SgdsBadge, SgdsButton, SgdsCard, SgdsInput } from "@govtechsg/sgds-web-component/react";
import { LINES, LINE_IDS, lineGroups } from "../stations.js";
import { api } from "../api.js";
import { interpretAlerts } from "../services/serviceStatus.js";
import PageHeader from "../components/PageHeader.jsx";

// Line accent as SGDS token classes (no hex / inline style).
const LINE_DOT = { NEL: "sgds:bg-primary-default", CCL: "sgds:bg-warning-default", SPLRT: "sgds:bg-neutral-default" };
const LINE_BORDER = { NEL: "sgds:border-primary-muted", CCL: "sgds:border-warning-muted", SPLRT: "sgds:border-neutral-muted" };

export default function Train() {
  const navigate = useNavigate();
  const [lineId, setLineId] = useState("NEL");
  const [query, setQuery] = useState("");
  const [alerts, setAlerts] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api
      .getTrainAlerts()
      .then(setAlerts)
      .catch((err) => setError(err.message));
  }, []);

  const status = interpretAlerts(alerts, lineId);
  const line = LINES[lineId];

  // Groups (one for the NEL, an arm + loop for the Circle Line, four loops for the LRT), filtered by the search box.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return lineGroups(lineId)
      .map((g) => ({
        ...g,
        stations: g.stations.filter((s) => !q || s.name.toLowerCase().includes(q) || s.codes.some((c) => c.toLowerCase().includes(q))),
      }))
      .filter((g) => g.stations.length > 0);
  }, [lineId, query]);
  const total = new Set(groups.flatMap((g) => g.stations.map((st) => st.code))).size; // hubs appear in two LRT loops but count once

  return (
    <>
      <PageHeader title={line.name} onBack={() => navigate("/")} />
      <div className="sgds:flex sgds:flex-col sgds:gap-component-md sgds:p-layout-md">
        <div className="sgds:flex sgds:flex-wrap sgds:gap-component-xs" role="group" aria-label="Choose a line">
          {LINE_IDS.map((id) => (
            <SgdsButton
              key={id}
              size="sm"
              variant={lineId === id ? "primary" : "outline"}
              ariaLabel={LINES[id].name}
              onClick={() => {
                setLineId(id);
                setQuery("");
              }}
            >
              {id === "NEL" ? "Purple Line" : id === "CCL" ? "Circle Line" : "LRT"}
            </SgdsButton>
          ))}
        </div>

        <SgdsCard>
          <span slot="title" className="sgds:text-label-md sgds:font-semibold sgds:uppercase sgds:text-default">
            Service status
          </span>
          {error && <p className="sgds:text-body-sm sgds:text-subtle">Couldn't reach the backend — is it running? ({error})</p>}
          {!error && status.state === "loading" && <p className="sgds:text-body-sm sgds:text-subtle">Checking live status…</p>}
          {!error && status.state === "normal" && <SgdsBadge variant="success">{status.normalText}</SgdsBadge>}
          {!error && status.state === "unavailable" && <SgdsBadge variant="neutral">Live status unavailable</SgdsBadge>}
          {!error && status.state === "disrupted" && (
            <div className="sgds:flex sgds:flex-col sgds:gap-1">
              <SgdsBadge variant="warning">Disruption reported</SgdsBadge>
              {status.message && <span className="sgds:text-body-sm sgds:text-default">{status.message}</span>}
            </div>
          )}
          {status.notices?.length > 0 && (
            <div className="sgds:mt-component-sm sgds:flex sgds:flex-col sgds:gap-component-xs">
              <span className="sgds:text-label-xs sgds:font-semibold sgds:uppercase sgds:text-subtle">Notices</span>
              {status.notices.slice(0, 3).map((n, i) => (
                <p key={i} className="sgds:m-0 sgds:text-caption-md sgds:text-default">{n.replace(/^\d{2}:\d{2}-[A-Z]{2}-/, "").replace(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}-/, "")}</p>
              ))}
            </div>
          )}
          {status.sourceLabel && <p className="sgds:mt-component-xs sgds:text-caption-md sgds:text-subtle">Source: {status.sourceLabel}</p>}
        </SgdsCard>

        <SgdsInput
          type="search"
          label="Filter stations"
          placeholder="Station name or code"
          value={query}
          onSgdsInput={(e) => setQuery(e.target.value)}
        />

        <p className="sgds:m-0 sgds:text-label-xs sgds:font-semibold sgds:uppercase sgds:text-primary-default">
          {total} station{total !== 1 ? "s" : ""}
        </p>

        {groups.map((g) => (
          <section key={g.name} className="sgds:flex sgds:flex-col sgds:gap-component-xs">
            {(lineId !== "NEL" || groups.length > 1) && <h2 className="sgds:m-0 sgds:text-label-sm sgds:font-semibold sgds:text-subtle">{g.name}</h2>}
            <div className={`sgds:ml-2 sgds:border-l-2 sgds:pl-layout-sm ${LINE_BORDER[lineId]}`}>
              {g.stations.map((station) => (
                <div
                  key={`${g.name}-${station.lineCode}`}
                  role="button"
                  tabIndex={0}
                  className="sgds:relative sgds:cursor-pointer sgds:py-component-md"
                  onClick={() => navigate(`/train/${station.code}`)}
                  onKeyDown={(e) => e.key === "Enter" && navigate(`/train/${station.code}`)}
                >
                  <span className={`sgds:absolute sgds:-left-[calc(var(--sgds-spacer-5,1.25rem)+0.4rem)] sgds:top-5 sgds:size-2.5 sgds:rounded-full sgds:border-2 sgds:border-surface-default ${LINE_DOT[lineId]}`} />
                  <div className="sgds:flex sgds:flex-wrap sgds:items-center sgds:gap-component-xs sgds:text-body-md sgds:font-semibold sgds:text-default">
                    {station.name}
                    {station.codes.length > 1 && <SgdsBadge variant="purple">Interchange</SgdsBadge>}
                  </div>
                  <div className="sgds:text-caption-md sgds:text-subtle">{[station.lineCode, ...station.codes.filter((c) => c !== station.lineCode)].join(" · ")}</div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {total === 0 && <p className="sgds:py-layout-lg sgds:text-center sgds:text-body-sm sgds:text-subtle">No stations match "{query}"</p>}
      </div>
    </>
  );
}
