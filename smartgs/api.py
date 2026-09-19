from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import prediction_engine
import platform_b_simulator
import train_timing_simulator

# ============================================================
# SMARTGS API
#
# Thin HTTP layer over two engines:
#   prediction_engine.py    - Platform A, real CV1-CV5 cameras
#   platform_b_simulator.py - Platform B, randomly generated
#                             data run through the same scoring
#                             math, since Platform B has no
#                             real cameras
#
# Both engines run continuously in the background and each
# recompute their own snapshot every 5 seconds. This file just
# exposes both snapshots over HTTP, so an external app or the
# Arduino demo can fetch either one instead of reading the
# terminal.
#
# Route layout:
#   /predictions, /seats, /guidance, /display          -> Platform A
#   /platform_b/predictions, /seats, /guidance, /display -> Platform B
#
# Existing Platform A routes are unchanged - anything already
# pointed at them (e.g. the Arduino sketch) keeps working
# exactly as before.
# ============================================================

app = FastAPI(title="SmartGS API")

# ============================================================
# CORS
#
# Required if your frontend runs in a browser on a different
# origin (e.g. a GitHub Pages site, or a dev server on another
# port) - otherwise the browser blocks the request. Restrict
# allow_origins to your actual frontend's URL once you know it,
# rather than leaving it open to "*".
# ============================================================
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup():
    # Starts CV1-CV5 and Platform A's 5-second prediction loop.
    prediction_engine.start_engine()
    # Starts Platform B's simulated 5-second loop.
    platform_b_simulator.start_engine()


# ============================================================
# SHARED RESPONSE BUILDERS
#
# Both platforms produce a snapshot with the identical shape,
# so the same formatting logic works for either one - just pass
# in which snapshot to use. This keeps Platform A and Platform B
# from ever silently drifting apart in how their responses look.
# ============================================================
def _build_seats_response(snapshot):
    if snapshot.get("status") != "ok":
        return snapshot

    doors = snapshot["doors"]
    return {
        "status": "ok",
        "updated_at": snapshot["updated_at"],
        "seats": {
            door_name: {
                "available": door_data["seats_available"],
                "total": door_data["seats_total"],
            }
            for door_name, door_data in doors.items()
        },
    }


def _build_guidance_response(snapshot):
    if snapshot.get("status") != "ok":
        return snapshot

    doors = snapshot["doors"]
    return {
        "status": "ok",
        "updated_at": snapshot["updated_at"],
        "guidance": {
            door_name: door_data["guidance"] for door_name, door_data in doors.items()
        },
    }


def _build_display_response(snapshot):
    if snapshot.get("status") != "ok":
        return snapshot

    guidance_response = _build_guidance_response(snapshot)
    return {
        "status": "ok",
        "updated_at": snapshot["updated_at"],
        "guidance": guidance_response["guidance"],
        "recommendation": snapshot["recommendation"],
    }


# ============================================================
# PLATFORM A (real CV1-CV5)
# ============================================================
@app.get("/predictions")
def get_predictions():
    """Full Platform A snapshot: occupancy/seats/boarding/guidance per door, plus the recommended door."""
    return prediction_engine.get_latest_snapshot()


@app.get("/seats")
def get_seat_availability():
    """Platform A seat availability only, from CV1 and CV2."""
    return _build_seats_response(prediction_engine.get_latest_snapshot())


@app.get("/guidance")
def get_guidance_only():
    """Platform A GREEN/YELLOW/RED guidance only, for all 4 doors."""
    return _build_guidance_response(prediction_engine.get_latest_snapshot())


@app.get("/display")
def get_display_data():
    """Platform A guidance + recommendation summary - what the Arduino demo uses."""
    return _build_display_response(prediction_engine.get_latest_snapshot())


# ============================================================
# PLATFORM B (simulated)
# ============================================================
@app.get("/platform_b/predictions")
def get_platform_b_predictions():
    """Full Platform B snapshot - same shape as /predictions, but randomly generated."""
    return platform_b_simulator.get_latest_snapshot()


@app.get("/platform_b/seats")
def get_platform_b_seats():
    """Platform B seat availability only (simulated)."""
    return _build_seats_response(platform_b_simulator.get_latest_snapshot())


@app.get("/platform_b/guidance")
def get_platform_b_guidance():
    """Platform B GREEN/YELLOW/RED guidance only (simulated)."""
    return _build_guidance_response(platform_b_simulator.get_latest_snapshot())


@app.get("/platform_b/display")
def get_platform_b_display():
    """Platform B guidance + recommendation summary (simulated)."""
    return _build_display_response(platform_b_simulator.get_latest_snapshot())


# ============================================================
# TRAIN TIMING (simulated, both platforms)
# ============================================================
@app.get("/train-timing")
def get_platform_a_train_timing():
    """Platform A's next and following train arrival (simulated)."""
    return train_timing_simulator.get_train_timing("A")


@app.get("/platform_b/train-timing")
def get_platform_b_train_timing():
    """Platform B's next and following train arrival (simulated)."""
    return train_timing_simulator.get_train_timing("B")


@app.get("/health")
def health():
    return {"status": "ok"}
