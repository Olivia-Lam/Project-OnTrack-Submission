import fetch from "node-fetch";

// Live rail-service status from the public SGMRT Telegram channel (https://t.me/s/sgmrt), which
// republishes SMRT / SBS Transit operator announcements. Named in the PS2 brief as a real live
// disruption source, and needs no API key - used when LTA DataMall's TrainServiceAlerts is
// unavailable (e.g. the account key is rejected).
//
// This is announcement text, not structured data, so it is interpreted conservatively:
//  - only messages from the last WINDOW_HOURS count as "current";
//  - a line is disrupted only if a recent message says it is affected AND no later message for that
//    line says service has resumed;
//  - plain notices (e.g. extended operating hours) match neither pattern and are ignored.
const CHANNEL_URL = "https://t.me/s/sgmrt";
const WINDOW_HOURS = 6; // how recent an announcement must be to describe "now"
const CACHE_MS = 60 * 1000;
const FETCH_TIMEOUT_MS = 6000;

export const LINE_PATTERNS = {
  NEL: /\bNEL\b|North[ -]East Line/i,
  CCL: /\bCCL\b|Circle Line/i,
  SPLRT: /\bSPLRT\b|\bSKLRT\b|\bPGLRT\b|\bSLRT\b|\bPLRT\b|Sengkang[ -]Punggol LRT|Sengkang LRT|Punggol LRT/i,
};

const RESOLVED = /resum|restor|ceased|back to normal|recovered|cleared|normal service/i;
const DISRUPTED = /disrupt|delay|fault|intrusion|affected|breakdown|not available|unavailable|no train|suspend|free (regular |bridging )?bus|bridging bus|shuttle/i;

let cache = null; // { at, messages }

function decode(text) {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchMessages() {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.messages;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(CHANNEL_URL, { signal: controller.signal, headers: { "User-Agent": "Mozilla/5.0 (compatible; OnTrack/0.1)" } });
    if (!response.ok) throw new Error(`SGMRT channel returned ${response.status}`);
    const html = await response.text();
    const messages = html
      .split('tgme_widget_message_wrap')
      .slice(1)
      .map((block) => {
        const text = block.match(/tgme_widget_message_text[^>]*>(.*?)<\/div>/s)?.[1];
        const time = block.match(/<time[^>]*datetime="([^"]+)"/)?.[1];
        return text && time ? { text: decode(text), at: new Date(time).getTime() } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.at - b.at);
    cache = { at: Date.now(), messages };
    return messages;
  } finally {
    clearTimeout(timeout);
  }
}

/** Pure interpretation step (exported so it can be tested without the network). */
export function interpretMessages(messages, lines = Object.keys(LINE_PATTERNS), now = Date.now()) {
  const since = now - WINDOW_HOURS * 3600 * 1000;
  const recent = messages.filter((m) => m.at >= since);
  return lines.map((line) => {
    const pattern = LINE_PATTERNS[line];
    let active = null;
    for (const m of recent) {
      if (!pattern.test(m.text)) continue;
      if (RESOLVED.test(m.text)) active = null;
      else if (DISRUPTED.test(m.text)) active = m;
    }
    return {
      Status: active ? "1" : "0",
      Line: line,
      Message: active ? [{ Content: active.text, CreatedDate: new Date(active.at).toISOString() }] : [],
    };
  });
}

/**
 * Status per line: [{ Status: "0"|"1", Line, Message: [{ Content, CreatedDate }] }] (same field names as
 * LTA's alerts so existing readers keep working), plus how fresh the data is.
 */
export async function getLineStatuses(lines = Object.keys(LINE_PATTERNS)) {
  const messages = await fetchMessages();
  return {
    value: interpretMessages(messages, lines),
    source: "sgmrt",
    windowHours: WINDOW_HOURS,
    newestMessageAt: messages.length ? new Date(messages.at(-1).at).toISOString() : null,
  };
}
