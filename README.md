# OnTrack

A commuter companion for Singapore's North East Line (Purple Line), Circle Line and Sengkang-Punggol LRT, plus buses. Plan a multi-modal trip on a real map, see the best exit and boarding door, find bicycle parking, and stay on track when a line is disrupted.

- Live app (nothing to install): https://ontrack-1022580246088.asia-southeast1.run.app
- Demo recording (phone-sized, one journey through a disruption): https://www.youtube.com/watch?v=Oq2CU1IvZ8E
- Write-up: [WRITEUP.md](WRITEUP.md) covers the persona, architecture, assumptions, limitations, and how every number was arrived at

The quickest way to evaluate is to open the live app on your phone. The steps below are for running your own copy.

## Try this first

The persona is Arjun, who travels from Punggol to one-north by cycling, LRT, MRT and bus.

1. Open the app (the live link, or `http://localhost:4000` after the steps below) on a phone or a phone-sized browser window.
2. Tap "Where to today?". For From, type `Punggol MRT` and pick PUNGGOL MRT STATION (NE17). For To, type `one-north MRT` and pick ONE-NORTH MRT STATION (CC23). Tap Plan journey.
   This is a North East Line then Circle Line trip. Drag the bottom sheet up for the timeline, the best exit and the boarding door. Pick the suggestion that has a station code in brackets; the address search lists those first.
   For a trip across all three lines, try Compassvale LRT (SE1) to Paya Lebar MRT (CC9). It shows more route options.
3. Under Details, find Simulate disruption. Choose Lift Not Working and tick the alternative exit, or choose Unplanned Disruption to see a bridging-bus reroute. These buttons inject simulated, clearly labelled faults, so a disruption can be shown on any day.
4. Turn on Bicycle parking (top of the map) and zoom in to see racks with counts and shelter. Turn on Two-wheeler in Trip Options to cycle to the nearest station first (try it from Damai LRT).
5. Open Train to browse every station on the three lines, and the map sheet on Home for crowd levels.

## Prerequisites

- Node.js 20 or newer (tested on 22 and 24) with npm: https://nodejs.org
- Internet access, because OneMap, LTA DataMall and map tiles are called live
- Python is not needed. It is only used by the optional `smartgs/` camera service.

## Install and run

Copy and paste these in order, from the repository root:

```bash
git clone <this repository's URL>
cd <the cloned folder>

npm run setup                 # installs the backend and frontend dependencies
cp .env.example .env          # Windows (cmd): copy .env.example .env
# open .env and fill in ONEMAP_EMAIL and ONEMAP_PASSWORD (see Configuration), and LTA_ACCOUNT_KEY if you have it

npm run build                 # builds the frontend
npm start                     # serves the app AND its API on one port
```

Then open http://localhost:4000. Stop with `Ctrl+C`.

To run the automated checks (no keys or network needed): `npm test`

<details><summary>Development mode (two terminals, hot reload)</summary>

```bash
npm run dev:backend      # terminal 1 -> http://localhost:4000
npm run dev:frontend     # terminal 2 -> http://localhost:5173 (proxies /api to :4000)
```
</details>

## Configuration

Copy `.env.example` to `.env` (same folder) and fill in what you have. Never commit `.env`.

| Variable | Needed? | What it does | Where to get it |
|---|---|---|---|
| `ONEMAP_EMAIL`, `ONEMAP_PASSWORD` | Required for journey planning | OneMap routing, walking and cycling (address search also uses it, for a higher rate limit) | Free: https://www.onemap.gov.sg/apidocs/register (the username is your email address) |
| `LTA_ACCOUNT_KEY` | Recommended | Live rail alerts, crowd colours on the map, bicycle racks with counts, bus stops | Free: https://datamall.lta.gov.sg, request API access (24 characters ending `==`, emailed on approval) |
| `ALERTS_REPLAY` | Optional | Replay a captured or synthetic disruption (see below) | A file path, no registration |
| `PORT`, `TZ`, `CORS_ORIGIN` | Optional | Port (default 4000), keeping times in Singapore, and cross-origin hosting only | None needed |
| `SMARTGS_*` | Optional | Camera platform-crowd service (`smartgs/`) | Not needed. Door crowding is then simulated and labelled. |
| `AGNES_API_KEY` | Not used by the screens | Only an optional endpoint reads it | None needed |

Without keys:

- With no OneMap credentials, journey planning fails with a message saying what to set. Address search still works at OneMap's lower anonymous rate limit, and everything else still loads. Use the live app to evaluate planning.
- With no LTA key, the app falls back to the public SGMRT announcements for line status and to OpenStreetMap for bicycle parking, and labels the source on screen. Crowd colours on the map stay grey.

## Showing a disruption when nothing is disrupted

Live feeds are usually quiet. To reproduce a disruption, set `ALERTS_REPLAY` in `.env` and restart `npm start`:

```
ALERTS_REPLAY=app/backend/data/captured/synthetic-nel-fault.json
```

Home then shows a North East Line disruption banner labelled "Replay - SYNTHETIC test data - NOT a real incident". The file `lta-train-alerts-real.json` in the same folder is a real captured LTA response. It shows no disruption but has real line notices, such as a Sengkang West LRT closure. Separately, the in-app Simulate disruption buttons inject labelled test faults into a planned journey.

## Known limitations

- This is a hackathon prototype, not a production system.
- SmartGS (computer-vision boarding guidance) runs on one pilot station. Every other station shows simulated data, clearly labelled.
- No offline or underground handling has been built yet. Per brief section 2.6, the correct behaviour would be to cache the last-known journey state and mark it visibly stale once connectivity drops. A request made mid-tunnel will currently fail rather than degrade gracefully.
- SmartGS's computer vision has not been validated against live operational MRT footage.
- Facilities (lift and escalator) status is simulated rather than pulled from LTA's real maintenance feed.

The full list is in [WRITEUP.md](WRITEUP.md#6-known-limitations).

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
tests/               `npm test`: network model, disruption logic, status parsing, suggestion ranking
```

## Data sources and credits

OneMap and Singapore Land Authority (routing, search, map tiles). LTA DataMall (alerts, crowd density, bicycle parking, bus stops). LTA MRT Station Exit dataset via data.gov.sg. SMRT and SBS Transit announcements via the public SGMRT Telegram channel. © OpenStreetMap contributors (bicycle-parking fallback). GovTech Singapore Government Design System (SGDS).

## Deploying (optional)

The `Dockerfile` builds one image that serves both the app and the API. On Google Cloud Run, create a service from this repository's Dockerfile, allow public access, and add the environment variables from `.env.example` (use Secret Manager for the keys).
