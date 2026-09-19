import random
import threading
import time

from prediction_engine import (
    calculate_prediction,
    get_guidance,
    get_crowd_level,
    DOOR_1_SEATS,
    DOOR_2_SEATS,
    DOOR_3_SEATS,
    DOOR_4_SEATS,
    ENGINE_UPDATE_INTERVAL,
)

# ============================================================
# PLATFORM B SIMULATOR
#
# Platform A (prediction_engine.py) gets its numbers from real
# CV1-CV5 cameras. Platform B has no cameras - this module
# generates random-but-plausible numbers on the same 5-second
# cadence instead, then runs them through the SAME scoring
# functions imported from prediction_engine.py (calculate_prediction,
# get_guidance, get_crowd_level). This guarantees Platform B's
# output has the identical shape and identical guidance logic
# as Platform A - the only difference is where the raw inputs
# come from.
#
# Door seat capacities (DOOR_1_SEATS etc.) are reused from
# Platform A's CV1/CV2 modules, assuming both platforms have
# doors of the same physical capacity. Change these below if
# Platform B's doors actually differ.
# ============================================================

DOOR_SEATS_TOTAL = {
    "door_1": DOOR_1_SEATS,
    "door_2": DOOR_2_SEATS,
    "door_3": DOOR_3_SEATS,
    "door_4": DOOR_4_SEATS,
}

# ============================================================
# SHARED SNAPSHOT
# ============================================================
snapshot_lock = threading.Lock()
_latest_snapshot = {
    "status": "starting",
    "message": "Platform B simulator has not produced a prediction yet.",
}

_engine_started = False
_engine_start_lock = threading.Lock()


def get_latest_snapshot():
    """
    Thread-safe read of Platform B's most recent simulated
    snapshot. Same interface as prediction_engine.get_latest_snapshot(),
    so api.py can treat both platforms identically.
    """
    with snapshot_lock:
        return dict(_latest_snapshot)


# ============================================================
# GENERATE ONE DOOR'S RANDOM RAW DATA
# ============================================================
def _generate_door_raw_data(seats_total):
    occupancy_percent = random.uniform(0, 100)
    seats_available = random.randint(0, seats_total)
    seat_availability_percent = (seats_available / seats_total) * 100
    boarding_score = random.uniform(0, 100)
    return occupancy_percent, seats_available, seat_availability_percent, boarding_score


# ============================================================
# SIMULATOR LOOP
#
# Runs forever on its own background thread, generating a new
# random snapshot every ENGINE_UPDATE_INTERVAL seconds - the
# same cadence Platform A uses, so both platforms feel
# consistent even though this one isn't tied to real video.
# ============================================================
def _simulator_loop():
    global _latest_snapshot

    while True:
        time.sleep(ENGINE_UPDATE_INTERVAL)

        flow_score = random.uniform(0, 100)

        doors = {}
        for door_name, seats_total in DOOR_SEATS_TOTAL.items():
            (
                occupancy_percent,
                seats_available,
                seat_availability_percent,
                boarding_score,
            ) = _generate_door_raw_data(seats_total)

            prediction = calculate_prediction(
                occupancy_percent, flow_score, boarding_score
            )

            doors[door_name] = {
                "occupancy_percent": round(occupancy_percent, 1),
                "seat_availability_percent": round(seat_availability_percent, 1),
                "seats_available": seats_available,
                "seats_total": seats_total,
                "boarding_score": round(boarding_score, 1),
                "predicted_crowd_score": round(prediction, 1),
                "predicted_crowd_level": get_crowd_level(prediction),
                "guidance": get_guidance(prediction),
            }

        # ========================================================
        # FIND BEST DOOR (lowest predicted crowd score, same rule
        # as Platform A)
        # ========================================================
        best_door_name = min(
            doors, key=lambda name: doors[name]["predicted_crowd_score"]
        )
        best = doors[best_door_name]
        best_door_label = "Door " + best_door_name.split("_")[1]

        snapshot = {
            "status": "ok",
            "platform": "B (simulated)",
            "updated_at": time.time(),
            "platform_flow_score": round(flow_score, 1),
            "doors": doors,
            "recommendation": {
                "door": best_door_label,
                "predicted_crowd_level": best["predicted_crowd_level"],
                "guidance": best["guidance"],
                "seats_available": best["seats_available"],
                "seats_total": best["seats_total"],
            },
        }

        with snapshot_lock:
            _latest_snapshot = snapshot


# ============================================================
# START SIMULATOR
#
# Same interface as prediction_engine.start_engine(): call once,
# non-blocking, safe to call multiple times.
# ============================================================
def start_engine():
    global _engine_started
    with _engine_start_lock:
        if _engine_started:
            return
        _engine_started = True
        threading.Thread(
            target=_simulator_loop, name="PlatformBSimLoop", daemon=True
        ).start()
