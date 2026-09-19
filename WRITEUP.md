# OnTrack — write-up

**Persona built for: Arjun** — a commuter who mixes MRT, LRT, bus and a bicycle in one trip, whose start time is flexible, and who cares about comfort: avoiding crowded platforms and doors, and knowing he can park his bike safely at the other end.

Live app: https://ontrack-1022580246088.asia-southeast1.run.app · Setup and run: [README.md](README.md)

## 1. What Arjun needs, and what we built

| Arjun's need | What OnTrack does | How real is it |
|---|---|---|
| One trip, several modes | Plans across bus, the North East Line, the Circle Line and the Sengkang-Punggol LRT in a single journey, drawn per line on a map (purple / orange / grey-green). Shows up to 3 route options, best first, with badges (Recommended, Fastest, Fewest transfers, Least walking). Trip Options switch modes on/off and re-rank. | Real routes from OneMap; ranking is ours |
| A bicycle | "Two-wheeler" option cycles to the nearest MRT station, then continues by transit (real OneMap cycle route, not a speed guess). A **Bicycle parking** layer shows racks with counts and shelter status. | Real: LTA DataMall (OpenStreetMap fallback) |
| Flexible start | "Arrive by" runs the real router at 5 departure times, 10 minutes apart, working back from the arrival time, and marks the latest one that still arrives on time. | Real routes; the 10-minute step is our UI choice (not derived from headways) |
| Comfort / crowding | Station crowd levels shown as coloured dots on the official system map; the best exit for his destination; the least crowded boarding door and free seats at the alighting station. | Station crowd: real (LTA). **Door and seat level: simulated** (see limitations) |
| Disruptions | Per-line status on Home and the Train tab; when a journey is hit, a bridging-bus reroute and a "replan" path; alternative exit if a lift is out. | Status: real (LTA / SGMRT). **Reroutes and lift/door faults: simulated scenarios, labelled** |

## 2. Architecture

```
 Phone / browser
   React + Vite app (SGDS components)  ── one origin ──►  Express API  (app/backend)
   OneMap map tiles (Leaflet)                                │
                                                             ├─► OneMap: search, public-transport, walk, cycle routing
                                                             ├─► LTA DataMall: alerts, crowd density, bicycle parking,
                                                             │       bus stops + routes
                                                             ├─► SGMRT Telegram channel: operator announcements (fallback)
                                                             ├─► OpenStreetMap / Overpass: bicycle parking (fallback)
                                                             └─► SmartGS (optional Python/FastAPI, camera crowd) ─ off by default

   Static, shipped in the repo:  station exit coordinates (LTA dataset + OneMap), line topology,
   bicycle-parking snapshot, captured / synthetic alert fixtures
```

- **One container, one origin.** The API also serves the built frontend, so there is no CORS setup; it deploys as a single Cloud Run service.
- **Disruption model.** `disruptions.js` is a pipeline: *source → normalised disruption → wayfinder → UI*. Only the source is simulated; swapping in a real feed changes one function. It generalises to any line's topology (rings, the Circle Line's Dhoby Ghaut arm, LRT loops).
- **Exit and walk.** For the chosen exit we ask OneMap for the **real walking route from that exact exit** and draw it, instead of scaling a distance.
- **Graceful degradation.** Every external source has a fallback, and the screen says which source it is using ("Live from LTA DataMall", "Live from SMRT / SBS Transit announcements", "Replay – …", "Live status unavailable"). Canned data is never shown as live.

## 3. Assumptions

- Scope is the three lines above plus buses. Any journey that needs another MRT line or the Bukit Panjang LRT is rejected, not partially shown.
- OneMap's public-transport router is the source of truth for timetables and fares.
- Nearest-station and "closest exit" rankings use straight-line distance between real coordinates; the walk itself is then re-routed for real.
- Station "centre" is the average of its real exit coordinates (LTA publishes no station centroid).
- The bridging bus takes **12 minutes**. That is a constant taken from the brief: bridging buses are ad-hoc and have no timetable in any feed we could find.
- Announcement text from the SGMRT channel is read conservatively: only the last 6 hours count, and a line is disrupted only if a message says it is affected and no later message says service resumed.

## 4. Claims, and how each was arrived at

Nothing below needs paid access. OneMap and LTA DataMall keys are free. Figures that come from live services drift day to day, so each row gives the date measured.

| Claim | How we arrived at it (what against, on what) | Reproduce |
|---|---|---|
| The app models 74 stations: 17 North East Line, 33 Circle Line, 29 Sengkang-Punggol LRT (interchanges counted once), and every one has real exit coordinates. | Counted from `app/frontend/src/stations.js` and the generated data; exit coordinates from the LTA MRT Station Exit dataset (data.gov.sg), plus OneMap search for Keppel, Cantonment and Prince Edward Road, which are newer than that dataset. | `npm test` (no keys) |
| For Kovan → Hougang Mall, the "closest exit" by straight-line distance (Exit B) is a **640 m** real walk, while the alternative Exit C is **487 m**. So straight-line ranking can pick the wrong exit. | OneMap walking-route responses for the two exits' coordinates to the destination, measured 2026-09-19. A single trip, not a study — we are not claiming how often this happens. | In the app: plan that trip → Details → **Lift Not Working** → tick the alternative exit; the card shows each real walk. Needs a free OneMap login. |
| A single journey can combine all three lines: Damai LRT → Bishan MRT gave Punggol LRT → Purple Line → Circle Line in about 34–35 min. | One OneMap request for a Monday 09:00 departure (2026-09-21), made on 2026-09-19. Timetable-dependent, so the minutes will vary. | Try-first step 2 in the README |
| LTA returns bicycle racks with counts and shelter: 96 racks (all with a count and shelter flag) in the box 1.295–1.305 N, 103.850–103.860 E; within 0.5 km of Kovan station the OpenStreetMap fallback found no racks where LTA listed 138. | LTA `BicycleParkingv2` vs the same area from OpenStreetMap (Overpass), both queried 2026-09-19. Measures data coverage, not accuracy. | Bicycle parking layer near Bugis / Kovan. Free LTA key |
| The status parser classifies six announcement patterns correctly (a fault, a fault then "resumed", a stale fault, a plain notice, two lines at once, a quiet channel). | Unit tests on **synthetic** messages we wrote — the real channel had no in-scope incident to test on. It is verified on those cases only, **not** validated against real incidents. | `npm test` |

We do **not** claim any accuracy figure, speed-up, or novelty beyond the above.

## 5. Quiet feeds on judging day

Real disruptions are rare. To reproduce one, `ALERTS_REPLAY` (see the README) serves a captured or synthetic alerts file, and the UI labels it as a replay. Shipped in `app/backend/data/captured/`:

- `lta-train-alerts-real.json` — a **real** LTA response captured 2026-09-19: no disruption on the covered lines, but real notices (e.g. a Sengkang West LRT closure).
- `sgmrt-channel-real.json` — the **real** last 20 SMRT / SBS Transit announcements captured the same day.
- `synthetic-nel-fault.json` — a **synthetic**, clearly labelled North East Line signalling fault.

The in-app **Simulate disruption** buttons (door fault, lift out, unplanned and planned line disruption) are likewise labelled test faults, so the demo's disruption is a simulated one, on top of real routes.

## 6. Known limitations

- **Door-level crowding and free seats are simulated** everywhere except the one pilot station served by SmartGS. The SmartGS camera pipeline is included as source in `smartgs/`, but its videos and model weights are not (size and privacy), so judges cannot reproduce it and its output should be treated as unverified. When it is off, the app says the data is simulated.
- **Lift and facility status are simulated.** The "Lift Not Working" fault is a demo scenario, and the station Facilities tab is seeded mock data — there is no real lift feed wired in.
- **"Alternative exit" is not verified step-free.** We have no exit accessibility data, so the wheelchair filter re-ranks by fewest transfers and least walking, and the alternative exit is simply the next-closest one. The UI says "not verified step-free".
- **Circle Line Stage 6 stations on the official-map image** (Keppel, Cantonment, Prince Edward Road) are drawn on that edition of the map only as a dotted line, so their dots are spaced along it by estimate.
- **No LTA key on the judge's machine → reduced data**: line status falls back to announcements only (a quiet channel means "nothing announced", not a guaranteed all-clear), and crowd dots stay grey.
- **The bicycle-parking snapshot fallback covers the North East Line corridor only.**
- **OneMap availability**: the first request after idle can be slow; if OneMap is down, planning fails with a clear message.
- **Device testing was mostly emulated.** Automated browser checks ran at phone width (Playwright); checks on physical phones were limited.

## 7. How this was built

Built by our team with AI coding assistance (Claude Code) for implementation, review and testing. Design decisions, data-source choices and the persona are ours; every data source was checked against a live response before being relied on.
