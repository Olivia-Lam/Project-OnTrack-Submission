// Checks how live-status data is interpreted. REAL fixtures are captured feed responses; SYNTHETIC ones are labelled as such.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { interpretAlerts } from "../app/frontend/src/services/serviceStatus.js";
import { interpretMessages } from "../app/backend/sgmrt.js";

const load = (f) => JSON.parse(readFileSync(new URL(`../app/backend/data/captured/${f}`, import.meta.url), "utf8"));

test("REAL captured LTA feed: service normal, and the Sengkang-Punggol LRT notice is picked out", () => {
  const f = load("lta-train-alerts-real.json");
  const alerts = { ...f.response, source: "replay", shape: f.shape, replayLabel: f.label };
  assert.equal(interpretAlerts(alerts, "NEL").state, "normal");
  const lrt = interpretAlerts(alerts, "SPLRT");
  assert.equal(lrt.state, "normal");
  assert.ok(lrt.notices.some((n) => /Sengkang West LRT/.test(n)), "expected the real Sengkang West LRT closure notice");
  assert.equal(lrt.live, false); // a replay is never presented as live
});

test("SYNTHETIC incident replay: NEL disrupted, other lines fine, labelled as a replay", () => {
  const f = load("synthetic-nel-fault.json");
  const alerts = { ...f.response, source: "replay", shape: f.shape, replayLabel: f.label };
  const nel = interpretAlerts(alerts, "NEL");
  assert.equal(nel.state, "disrupted");
  assert.match(nel.message, /SYNTHETIC TEST DATA/);
  assert.match(nel.sourceLabel, /^Replay/);
  assert.equal(interpretAlerts(alerts, "CCL").state, "normal");
});

test("canned fallback is never shown as normal service", () => {
  assert.equal(interpretAlerts({ source: "mock", value: [] }, "NEL").state, "unavailable");
});

test("SGMRT announcement parsing (SYNTHETIC messages - the real channel has had no in-scope incident to test on)", () => {
  const now = Date.parse("2026-09-19T10:00:00Z");
  const h = (x) => now - x * 3600e3;
  const status = (msgs) => Object.fromEntries(interpretMessages(msgs, ["NEL", "CCL", "SPLRT"], now).map((v) => [v.Line, v.Status]));
  assert.deepEqual(status([]), { NEL: "0", CCL: "0", SPLRT: "0" });
  assert.equal(status([{ text: "NEL: signalling fault, train service between Serangoon and Kovan is delayed. Free bus services available.", at: h(1) }]).NEL, "1");
  assert.equal(status([{ text: "NEL: track fault, service delayed.", at: h(2) }, { text: "NEL: train services have resumed.", at: h(1) }]).NEL, "0");
  assert.equal(status([{ text: "NEL: train service disrupted between X and Y", at: h(9) }]).NEL, "0"); // older than the 6-hour window
  assert.equal(status([{ text: "Operational hours of the DTL, NEL, SPLRT will be extended on National Day.", at: h(1) }]).NEL, "0"); // notice, not a fault
  const both = status([{ text: "CCL: train service delayed between Bishan and Serangoon", at: h(1) }, { text: "SPLRT: Sengkang LRT service affected, free shuttle bus available", at: h(0.5) }]);
  assert.deepEqual([both.CCL, both.SPLRT], ["1", "1"]);
});

test("REAL captured SGMRT channel: parses without error and reports nothing disrupted on the covered lines at capture time", () => {
  const f = load("sgmrt-channel-real.json");
  const msgs = f.messages.map((m) => ({ text: m.text, at: Date.parse(m.at) }));
  const at = Date.parse(f.capturedAt);
  assert.ok(msgs.length > 0);
  const out = interpretMessages(msgs, ["NEL", "CCL", "SPLRT"], at);
  assert.deepEqual(out.map((o) => o.Status), ["0", "0", "0"]);
});
