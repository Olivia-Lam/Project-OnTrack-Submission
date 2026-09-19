import fetch from "node-fetch";

// Shared LTA DataMall helper for the newer routes (bicycle parking, bus stops).
// Must be https - plain http:// 404s on every endpoint (see routes/train.js).
const LTA_BASE = "https://datamall2.mytransport.sg/ltaodataservice";

export async function ltaGet(path, params = {}) {
  const url = new URL(`${LTA_BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const response = await fetch(url.toString(), {
    headers: { AccountKey: process.env.LTA_ACCOUNT_KEY, accept: "application/json" },
  });
  if (!response.ok) {
    const err = new Error(`LTA API returned ${response.status}`);
    err.status = response.status;
    throw err;
  }
  return response.json();
}

// DataMall pages list endpoints 500 rows at a time via $skip; returns every row.
export async function ltaGetAll(path, params = {}) {
  const rows = [];
  for (let skip = 0; ; skip += 500) {
    const data = await ltaGet(path, { ...params, $skip: skip });
    const page = data.value || [];
    rows.push(...page);
    if (page.length < 500) break;
  }
  return rows;
}
