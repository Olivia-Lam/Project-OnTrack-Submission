# OnTrack

A commuter companion for Singapore's **North East Line (Purple Line), Circle Line and Sengkang-Punggol LRT**, plus buses. Plan a multi-modal trip on a real map, see the best exit and boarding door, find bicycle parking, and stay on track when a line is disrupted.

- **Live app (nothing to install):** https://ontrack-1022580246088.asia-southeast1.run.app
- **Demo recording (phone-sized, one journey through a disruption):** _link to be added_
- **Write-up:** [WRITEUP.md](WRITEUP.md) — persona, architecture, assumptions, limitations, and how every number was arrived at

> **Fastest way to evaluate:** open the live app on your phone. The steps below are for running your own copy.

## Try this first

1. Open the app (live link above, or `http://localhost:4000` after the steps below) on a phone or a phone-sized browser window.
2. Tap **Where to today?** → **From**: type `Compassvale LRT` and pick **COMPASSVALE LRT STATION (SE1)** → **To**: type `Paya Lebar MRT` and pick **PAYA LEBAR MRT STATION (CC9)** → **Plan journey**.
   This is one trip across three lines (Sengkang LRT → Purple Line → Circle Line). Tap the other route options in the bottom sheet, then drag the sheet up for the timeline, the best exit and the boarding door.
   *Tip: pick the suggestion that has a station code in brackets. The address search lists those first.*
3. Under **Details**, find **Simulate disruption** → **Lift Not Working** → tick the alternative exit, or **Unplanned Disruption** to see a bridging-bus reroute. (These buttons inject **simulated, clearly labelled** faults so a disruption can be shown on any day.)
4. Turn on **Bicycle parking** (top of the map) and zoom in to see racks with counts and shelter.
5. Open **Train** to browse every station on the three lines, and the **map sheet** on Home for crowd levels.

## Prerequisites

- **Node.js 20 or newer** (tested on 22 and 24) with npm — https://nodejs.org
- Internet access (OneMap, LTA DataMall and map tiles are called live)
- Python is **not** needed. It is only used by the optional `smartgs/` camera service.

## Install and run

Copy-paste, in order, from the repository root:

```bash
git clone <this repository's URL>
cd <the cloned folder>

npm run setup                 # installs the backend and frontend dependencies
cp .env.example .env          # Windows (cmd): copy .env.example .env
# open .env and fill in ONEMAP_EMAIL and ONEMAP_PASSWORD (see Configuration), and LTA_ACCOUNT_KEY if you have it

npm run build                 # builds the frontend
npm start                     # serves the app AND its API on one port
```

Then open **http://localhost:4000**. Stop with `Ctrl+C`.

Run the automated checks (no keys or network needed): `npm test`

<details><summary>Development mode (two terminals, hot reload)</summary>

```bash
npm run dev:backend      # terminal 1 -> http://localhost:4000
npm run dev:frontend     # terminal 2 -> http://localhost:5173 (proxies /api to :4000)
```
</details>

## Configuration

Copy `.env.example` to `.env` (same folder) and fill in what you have. **Never commit `.env`.**

| Variable | Needed? | What it does | Where to get it |
|---|---|---|---|
| `ONEMAP_EMAIL`, `ONEMAP_PASSWORD` | **Required** for planning and address search | OneMap routing, walking, cycling, geocoding | Free: https://www.onemap.gov.sg/apidocs/register (username is your email address) |
| `LTA_ACCOUNT_KEY` | Recommended | Live rail alerts, crowd colours on the map, bicycle racks with counts, bus stops | Free: https://datamall.lta.gov.sg → request API access (24 characters ending `==`, emailed on approval) |
| `ALERTS_REPLAY` | Optional | Replay a captured or synthetic disruption (see below) | A file path, no registration |
| `PORT`, `TZ`, `CORS_ORIGIN` | Optional | Port (default 4000); keep times in Singapore; cross-origin hosting only | — |
| `SMARTGS_*` | Optional | Camera platform-crowd service (`smartgs/`) | Not needed; door crowding is then simulated and labelled |
| `AGNES_API_KEY` | Not used by the screens | Only an optional endpoint reads it | — |

**What happens without keys**

- No OneMap credentials → journey planning and address search fail (the app says so). Everything else still loads. Use the live app to evaluate.
- No LTA key → the app falls back to the public SGMRT announcements for line status and to OpenStreetMap for bicycle parking, and labels the source on screen. Crowd colours on the map stay grey.

## Showing a disruption when nothing is disrupted

Live feeds are usually quiet. To reproduce a disruption, set `ALERTS_REPLAY` in `.env` and restart `npm start`:

```
ALERTS_REPLAY=app/backend/data/captured/synthetic-nel-fault.json
```

Home then shows a North East Line disruption banner that is labelled **"Replay - SYNTHETIC test data - NOT a real incident"**. The file `lta-train-alerts-real.json` in the same folder is a **real** captured LTA response (no disruption, but with real line notices such as a Sengkang West LRT closure). Independently of this, the in-app **Simulate disruption** buttons inject labelled test faults into a planned journey.

## Repository layout

```
README.md            this file
WRITEUP.md           persona, architecture, assumptions, limitations, claims
.env.example         every variable the app reads (names only)
Dockerfile           one-container build (used for Google Cloud Run)
app/backend/         Express API: OneMap, LTA, SGMRT, OSM proxies; also serves the built frontend
app/backend/data/    bicycle-parking snapshot + captured/synthetic alert fixtures
app/backend/scripts/ regenerates the rail station data (needs OneMap credentials)
app/frontend/        React + Vite app using the Singapore Government Design System (SGDS)
smartgs/             optional camera-based platform-crowd service (Python; source only, no videos or model weights)
tests/               `npm test`: network model, disruption logic, status parsing
```

## Data sources and credits

OneMap and Singapore Land Authority (routing, search, map tiles) · LTA DataMall (alerts, crowd density, bicycle parking, bus stops) · LTA MRT Station Exit dataset via data.gov.sg · SMRT / SBS Transit announcements via the public SGMRT Telegram channel · © OpenStreetMap contributors (bicycle-parking fallback) · GovTech Singapore Government Design System (SGDS).

## Deploying (optional)

The `Dockerfile` builds one image that serves both the app and the API. On Google Cloud Run: create a service from this repository's Dockerfile, allow public access, and add the environment variables from `.env.example` (use Secret Manager for the keys).
