# SmartGS API - Setup Instructions

This document explains how to install, run, and use the SmartGS API on
your own machine.

## What this is

- `prediction_engine.py` runs CV1-CV5 continuously in the background and
  recomputes a combined snapshot every 5 seconds.
- `api.py` is a thin FastAPI web server that exposes that snapshot over
  HTTP, so any app (frontend, teammate's app, etc.) can fetch it instead
  of reading the terminal.
- Both `/predictions` and `/seats` below are served by this **same**
  running server - CV1-CV5 only ever run once, regardless of which
  endpoint is called.

## 1. Requirements

- Python 3.9 or newer installed
- All of these files present in the same project folder:
  - `api.py`
  - `prediction_engine.py`
  - `cv1_detection.py`, `cv2_detection.py`, `cv3_detection.py`,
    `cv4_detection.py`, `cv5_detection.py`
  - the `videos/` folder (video files the CV modules read)
  - the `config/` folder (if used by the CV modules)

## 2. Install dependencies

Open a terminal in the project folder (in VS Code: **Terminal > New
Terminal**, or use the terminal panel already open at the bottom) and run:

```bash
pip install fastapi uvicorn opencv-python ultralytics
```

Wait for it to finish with no red error text before continuing.

## 3. Run the API server

In the same terminal, run:

```bash
python -m uvicorn api:app --host 0.0.0.0 --port 8000
```

> Note: the module name before the colon (`api`) must match the actual
> Python filename (`api.py`), without the `.py` extension.

If it starts successfully, you'll see a line similar to:

```
Uvicorn running on http://0.0.0.0:8000
```

**Leave this terminal window open.** The server only runs while this
process is alive - closing the terminal or pressing `Ctrl+C` stops the API.

## 4. Test it

With the server still running, open a browser and go to either:

```
http://localhost:8000/predictions
```
Full snapshot - occupancy, boarding scores, guidance, and the
recommended door, for all four doors.

```
http://localhost:8000/seats
```
Seat availability only, for all four doors - a lighter-weight view
of the same underlying data.

Both should return a JSON response. This confirms the server and CV
pipeline are working.

A plain browser tab will **not** auto-refresh - it's a snapshot from the
moment the page loaded. A real frontend app should call these URLs on a
repeating 5-second interval (polling) instead of a person manually
refreshing.

You can also check `http://localhost:8000/health` for a simple
`{"status": "ok"}` response to confirm the server is alive.

## 5. Stopping the server

In the terminal running uvicorn, press `Ctrl+C`.

## 6. Sharing this with a teammate

Running the server only makes it reachable at `http://localhost:8000` on
**your own machine**. For someone else's app to call it, you have a few
options:

- **Same WiFi/network**: teammate calls
  `http://<your-computer's-local-IP>:8000/predictions` (or `/seats`)
  instead of `localhost`.
- **Quick public URL for testing**: run `ngrok http 8000` (or Cloudflare
  Tunnel) in a second terminal alongside uvicorn. It prints a temporary
  public HTTPS URL that forwards to your local server - share that URL.
- **Permanent solution**: deploy `api.py` and `prediction_engine.py` to a
  server/VPS you control, so it has a stable public URL both of you can
  use anytime. This needs to run continuously, since the CV pipeline
  processes video in real time.

## 7. Troubleshooting

- **"Module not found" error when running uvicorn**: the name before the
  colon in the run command must exactly match your Python filename
  (without `.py`). For `api.py`, use `api:app`.
- **Import errors on startup**: check the VS Code "Problems" tab for
  issues in `api.py` or `prediction_engine.py` before running.
- **`/predictions` or `/seats` returns `{"status": "starting", ...}`**:
  CV1-CV5 have not produced their first result yet. Wait a few seconds
  and refresh.
- **Browser can't reach the API from another device**: check that
  `--host 0.0.0.0` was used (not `127.0.0.1`), and that your firewall
  allows connections on port 8000.
