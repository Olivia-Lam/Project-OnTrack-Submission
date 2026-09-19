# OnTrack write-up

OnTrack is a commuter companion for Singapore's North East Line (Purple Line), Circle Line and Sengkang-Punggol LRT, plus buses. Its aim is to move commuters from information to action: a chosen route, an exit, a door and a plan for when something breaks, instead of a list of arrival times.

Live app: https://ontrack-1022580246088.asia-southeast1.run.app. Demo recording: https://www.youtube.com/watch?v=Oq2CU1IvZ8E. Setup and run: [README.md](README.md).

## 1. Persona: Arjun

Arjun travels from Punggol to one-north. Arjun mixes cycling, LRT, MRT and bus in a single trip, and the start time is flexible. Comfort, predictability and avoiding crowds matter more than saving a few minutes. Arjun also wants to know the bike will have somewhere safe to park at the other end.

| What Arjun needs | What OnTrack does | How real it is |
|---|---|---|
| One trip across several modes | Plans across bus, the North East Line, the Circle Line and the LRT, drawn per line on a map (purple, orange, grey-green). Shows up to 3 route options with badges (Recommended, Fastest, Fewest transfers, Least walking). Trip Options switch modes on and off and re-rank. | Routes are real (OneMap). The ranking is ours. |
| A bicycle | The "Two-wheeler" option cycles to the nearest MRT station, then continues by transit, using a real OneMap cycle route rather than a speed guess. A Bicycle parking layer shows racks with counts and shelter. | Real (LTA DataMall, with an OpenStreetMap fallback). |
| A flexible start | "Arrive by" runs the router at 5 departure times, 10 minutes apart, working back from the arrival time, and marks the latest one that still arrives on time. | Routes are real. The 10-minute step is a UI choice, not derived from train or bus headways. |
| Comfort and less crowding | Station crowd levels appear as coloured dots on the system map. For the destination station the app suggests the best exit, the boarding door and free seats. | Station crowd is real (LTA). Door and seat level is simulated, except at the one pilot station where SmartGS runs (see section 5). |
| A plan when a line is disrupted | Per-line status on Home and the Train tab. In a planned journey the disruption buttons add a bridging-bus reroute or an alternative exit. | Line status is real (LTA, SGMRT). The reroutes, lift faults and door faults are simulated scenarios and are labelled as such. |

## 2. Architecture

```
 Phone / browser
   React + Vite app (SGDS components)  --- one origin --->  Express API (app/backend)
   OneMap map tiles (Leaflet)                                  |
                                                               |-- OneMap: search, public transport, walk, cycle routing
                                                               |-- LTA DataMall: alerts, crowd density, bicycle parking,
                                                               |       bus stops and routes
                                                               |-- SGMRT Telegram channel: operator announcements (fallback)
                                                               |-- OpenStreetMap / Overpass: bicycle parking (fallback)
                                                               '-- SmartGS (optional Python/FastAPI, camera crowd), off by default

   Static, shipped in the repo: station exit coordinates (LTA dataset + OneMap), line topology,
   bicycle-parking snapshot, captured and synthetic alert fixtures
```

The system has four layers.

1. **Data.** LTA DataMall (train alerts, station crowd density, bicycle parking, bus stops and routes), OneMap (map tiles, search, public-transport, walking and cycling routes), the public SGMRT channel for operator announcements, and OpenStreetMap as a bicycle-parking fallback. OpenStreetMap is not the base network. OneMap is.
2. **Processing.** The backend normalises each source into one shape and labels where it came from. Every source has a fallback, and the screen names the source in use ("Live from LTA DataMall", "Live from SMRT / SBS Transit announcements", "Replay - ...", "Live status unavailable"). Canned data is never shown as live.
3. **Routing and decisions.** OneMap supplies the itineraries. OnTrack ranks up to three and tags them. It picks the best exit by straight-line distance to the destination, then asks OneMap for the real walking route from that exact exit and draws it. `disruptions.js` is a pipeline of source, normalised disruption, wayfinder, UI. Only the source is simulated today, so a real feed would replace one function. It handles any line's shape, including rings, the Circle Line's Dhoby Ghaut arm and LRT loops.
4. **Mobile interface.** Journey Planner, Live Status (Home and Train tabs), station wayfinder (exit, walk, boarding door), Facilities and bicycle parking.

One container serves both the API and the built frontend on one origin, so there is no CORS setup and it deploys as a single Cloud Run service.

## 3. Assumptions

- Scope is the three lines above plus buses. A journey that needs another MRT line or the Bukit Panjang LRT is rejected, not partly shown.
- OneMap's public-transport router is the source of truth for timetables and fares.
- LTA DataMall and the other official APIs stay available. Each has a fallback, but the fallbacks give less.
- Crowd density means overall station conditions as LTA reports them (low, medium or high per station). It does not say which platform or door is busy.
- Personalisation comes from what the commuter states: modes on or off, arrive-by time, two-wheeler, wheelchair filter. The app does not learn preferences.
- Nearest-station and closest-exit rankings use straight-line distance between real coordinates. The walk itself is then routed for real.
- A station's centre is the average of its real exit coordinates, because LTA publishes no station centroid.
- The bridging bus takes 12 minutes. This constant comes from the brief. Bridging buses are ad hoc and no feed we found gives their timing.
- Announcement text from the SGMRT channel is read conservatively. Only the last 6 hours count, and a line counts as disrupted only if a message says it is affected and no later message says service resumed.
- Real disruptions are rare, so disruption scenarios use replayed or injected data, always labelled as simulated (section 5).

## 4. Claims, and how each was arrived at

Nothing here needs paid access. OneMap and LTA DataMall keys are free. Figures from live services drift, so each row gives the date measured.

| Claim | How we arrived at it | Reproduce |
|---|---|---|
| Arjun's trip, Punggol MRT (NE17) to one-north MRT (CC23), takes 49 to 50 minutes on the North East Line then the Circle Line, with one option offered. | One OneMap request per departure time on the live app, made on 2026-09-19 for 2026-09-19 16:30 and for Monday 2026-09-21 at 08:00, 13:00 and 18:00. All four returned the same two-line route. Four times on one trip, not a sample of trips. | Try-first steps in the README. |
| From Damai LRT (PE7) the same trip takes 62 to 64 minutes by LRT, North East Line and Circle Line, with a 67 to 70 minute alternative by bus 50 and rail. | Same method and dates as above. | Same, starting at Damai LRT. |
| The cycle leg from Damai LRT to the Punggol MRT area is 14 minutes over 2,311 m. | One OneMap cycling response, 2026-09-19. It is OneMap's own route and time, not a speed we assumed. | Plan the trip above with Two-wheeler turned on. |
| A single journey can combine all three lines: Compassvale LRT to Paya Lebar MRT gave Sengkang LRT, Purple Line, Circle Line in about 26 to 30 minutes, with 2 to 3 route options. | One OneMap request per time, for 2026-09-19 15:30 and Monday 2026-09-21 at 08:30, 13:00 and 18:30 (made on 2026-09-19). All four returned that route as the best option (29, 26, 30 and 27 minutes). We tried four candidate trips and kept this one because it was stable. | Plan that trip in the app. |
| The app models 74 stations: 17 North East Line, 33 Circle Line and 29 Sengkang-Punggol LRT (interchanges counted once), and each has real exit coordinates. | Counted from `app/frontend/src/stations.js` and the generated data. Exit coordinates come from the LTA MRT Station Exit dataset (data.gov.sg), plus OneMap search for Keppel, Cantonment and Prince Edward Road, which are newer than the dataset. | `npm test` (no keys) |
| For Kovan to Hougang Mall, the "closest exit" by straight-line distance (Exit B) is a 640 m real walk, while the alternative Exit C is 487 m. So straight-line ranking can pick the wrong exit. | OneMap walking responses for the two exits' coordinates to the destination, 2026-09-19. One trip, not a study. We make no claim about how often this happens. | Plan that trip, then Details, Lift Not Working, tick the alternative exit. Needs a free OneMap login. |
| LTA returns bicycle racks with counts and shelter: 96 racks (all with a count and shelter flag) in the box 1.295 to 1.305 N, 103.850 to 103.860 E. Within 0.5 km of Kovan station the OpenStreetMap fallback found no racks where LTA listed 138. | LTA `BicycleParkingv2` against the same area from OpenStreetMap (Overpass), both queried 2026-09-19. This measures data coverage, not accuracy. | Bicycle parking layer near Bugis or Kovan. Needs a free LTA key. |
| The status parser classifies six announcement patterns correctly: a fault, a fault then "resumed", a stale fault, a plain notice, two lines at once and a quiet channel. | Unit tests on synthetic messages we wrote, because the real channel had no in-scope incident to test on. Verified on those cases only, not validated against real incidents. | `npm test` |

We make no accuracy claim, no speed-up claim and no novelty claim beyond these.

## 5. What is real and what is simulated

Real: OneMap routes, walking and cycling times, station crowd levels (LTA), rail alerts (LTA, with SGMRT as fallback), bicycle racks (LTA, with OpenStreetMap as fallback).

Simulated, and labelled in the app:

- **Door-level crowding and free seats.** SmartGS is a separate Python/FastAPI service that reads five recorded, anonymised camera clips (CV1 to CV5) and recomputes its crowd snapshot every 5 seconds. Its train arrival timing and its Platform B feed are simulators. The app reads SmartGS only for one pilot station. Everywhere else the door and seat guidance is simulated and labelled "simulated". The SmartGS source is in `smartgs/`, but the videos and model weights are not, so judges cannot reproduce it.
- **Disruption reroutes.** The Simulate disruption buttons (door fault, lift out, unplanned and planned line disruption) apply a labelled fault to a planned journey. The app does not reroute automatically from the live status feed. For the Punggol to one-north trip, the unplanned disruption swaps an 11 minute rail segment for a 12 minute bridging bus and raises transfers from 1 to 3, so the total moves by about a minute (49 to 50). The reroute works, but this example shows little time cost. We measured it by running the disruption logic on the real OneMap response, 2026-09-19.
- **Lift and facility status.** No lift feed is wired in. The Lift Not Working fault is a demo scenario and the station Facilities tab is seeded mock data.

Real disruptions are rare, so on judging day the feed will probably be quiet. `ALERTS_REPLAY` (see the README) serves a captured or synthetic alerts file, and the UI labels it as a replay. Shipped in `app/backend/data/captured/`:

- `lta-train-alerts-real.json`: a real LTA response captured 2026-09-19. It shows no disruption on the covered lines but has real notices, such as a Sengkang West LRT closure.
- `sgmrt-channel-real.json`: the real last 20 SMRT / SBS Transit announcements, captured the same day.
- `synthetic-nel-fault.json`: a synthetic North East Line signalling fault, labelled as such.

## 6. Known limitations

- This is a hackathon prototype, not a production system.
- SmartGS (computer-vision boarding guidance) runs on one pilot station. Every other station shows simulated data, clearly labelled. It uses recorded footage, and its computer vision has not been validated against live operational MRT footage.
- No offline or underground handling has been built. Per brief section 2.6, the correct behaviour would be to cache the last-known journey state and mark it visibly stale once connectivity drops. A request made mid-tunnel currently fails instead of degrading gracefully.
- Facilities (lift and escalator) status is simulated rather than pulled from a real LTA maintenance feed.
- Crowding does not drive the route. Ranking uses time, transfers and walking. Crowd shows up as station dots and door and seat guidance.
- "Alternative exit" is not verified step-free. There is no exit accessibility data, so the wheelchair filter re-ranks by fewest transfers and least walking, and the alternative exit is the next-closest one. The UI says "not verified step-free".
- Each source updates on its own schedule. A quiet SGMRT channel means "nothing announced", not a guaranteed all-clear. Weather is not used.
- Without an LTA key, line status falls back to announcements, crowd dots stay grey and bicycle racks come from OpenStreetMap. Without OneMap credentials, journey planning is unavailable and the app says so.
- Circle Line Stage 6 stations on the official map image (Keppel, Cantonment, Prince Edward Road) appear only as a dotted line on that edition of the map, so their dots are spaced along it by estimate.
- The bicycle-parking snapshot fallback covers the North East Line corridor only.
- The first OneMap request after idle can be slow. If OneMap is down, planning fails with a clear message.
- Automated browser checks ran at phone width (Playwright). Testing on physical phones was limited, and the app has not been tested with many users at once.

## 7. How this was built

Built by our team with AI coding assistance (Claude Code) for implementation, review and testing. The persona, data-source choices and design decisions are ours. Each data source was checked against a live response before we relied on it.
