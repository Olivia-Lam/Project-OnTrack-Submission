// One place that turns the /api/train/alerts response into what the UI should say, so Home, Train and
// Station never present canned data as live. The backend answers from, in order:
//   - LTA DataMall (no `source` field): { value: { Status: 1 = normal | 2 = disrupted, AffectedSegments: [{ Line, ... }], Message: [...] } }
//   - the SGMRT channel (source "sgmrt"): { value: [{ Status: "0" ok | "1" disrupted, Line, Message }] } per line
//   - a canned "normal service" (source "mock"), which is never presented as live.
const SOURCE_LABELS = { sgmrt: "SMRT / SBS Transit announcements", lta: "LTA DataMall" };
// LTA names lines NEL, CCL (+ CEL) and SLRT / PLRT for the Sengkang and Punggol LRT.
const LTA_LINE_CODES = { NEL: ["NEL"], CCL: ["CCL", "CEL"], SPLRT: ["SLRT", "PLRT"] };
// LTA's alert messages are free text ("05:00-SK-Planned Service Adjustment. ..."); these pick out the ones about a line.
const NOTICE_PATTERNS = {
  NEL: /\bNEL\b|North[ -]East Line/i,
  CCL: /\bCCL\b|Circle Line/i,
  SPLRT: /-(SK|PG)-|\bSPLRT\b|Sengkang (West |East )?LRT|Punggol (West |East )?LRT|Sengkang-Punggol/i,
};

export function interpretAlerts(alerts, line = "NEL") {
  if (!alerts) return { state: "loading" };
  const source = alerts.source || "lta";
  if (source === "mock") return { state: "unavailable", source };
  // A replayed file says which feed's shape it imitates ("lta" or "sgmrt"); it is labelled as a replay wherever shown.
  const shape = alerts.shape || (source === "lta" ? "lta" : "sgmrt");
  const live = source !== "replay";

  let disrupted = false;
  let message = null;
  let notices = [];
  if (shape === "lta") {
    const v = Array.isArray(alerts.value) ? alerts.value[0] : alerts.value;
    const codes = LTA_LINE_CODES[line] || [line];
    const affected = (v?.AffectedSegments || []).some((seg) => codes.includes(seg.Line));
    disrupted = affected && String(v?.Status) === "2";
    // Planned adjustments and other notices about this line, shown even when service is running normally.
    notices = (v?.Message || []).map((m) => m.Content).filter((c) => c && NOTICE_PATTERNS[line]?.test(c));
    message = disrupted ? notices[0] || v?.Message?.[0]?.Content || null : null;
  } else {
    const list = Array.isArray(alerts.value) ? alerts.value : [];
    const entry = list.find((a) => a.Line === line);
    if (!entry) return { state: "unavailable", source }; // this line isn't covered by the feed
    disrupted = String(entry.Status) === "1";
    message = entry.Message?.[0]?.Content || null;
  }
  return {
    state: disrupted ? "disrupted" : "normal",
    source,
    live,
    sourceLabel: source === "replay" ? `Replay - ${alerts.replayLabel || "captured data"}` : SOURCE_LABELS[source] || source,
    // LTA says "Normal service"; the SGMRT feed can only say nothing has been announced recently.
    normalText: shape === "sgmrt" ? "No disruptions reported" : "Normal service",
    message,
    notices,
  };
}
