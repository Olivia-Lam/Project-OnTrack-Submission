import sys
import threading
import time
import contextlib
import io

# ============================================================
# SUPPRESS MODEL-LOADING PRINTS AT IMPORT TIME
#
# "Loading YOLOv8s..." etc. is printed at module import time,
# on the main thread, before any CV thread exists. Imports are
# synchronous and single-threaded, so redirect_stdout is safe
# to use here (unlike inside the worker threads later).
# ============================================================
with contextlib.redirect_stdout(io.StringIO()):
    from cv1_detection import run_detection as run_cv1
    from cv1_detection import DOOR_1_SEATS, DOOR_2_SEATS
    from cv2_detection import run_detection as run_cv2
    from cv2_detection import DOOR_3_SEATS, DOOR_4_SEATS
    from cv3_detection import run_detection as run_cv3
    from cv4_detection import run_detection as run_cv4
    from cv5_detection import run_detection as run_cv5
    from cv5_detection import get_latest_result as get_cv5_latest_result

# ============================================================
# THREAD-AWARE STDOUT
#
# contextlib.redirect_stdout swaps sys.stdout, which is a
# single process-wide object - NOT per-thread. If CV1-CV5 each
# call it concurrently inside their own (never-returning) loops,
# they race to hijack sys.stdout permanently, which can silently
# swallow the main thread's own prints too (this is what was
# happening: the engine's periodic updates were being written
# into some CV thread's throwaway buffer instead of the terminal).
#
# Instead, install ONE stdout wrapper that checks which thread
# is calling print() and only forwards to the real terminal when
# the caller is not one of the CV worker threads. No swapping,
# no race condition.
# ============================================================
_REAL_STDOUT = sys.stdout
_SUPPRESSED_THREAD_NAMES = {"CV1", "CV2", "CV3", "CV4", "CV5"}


class ThreadAwareStdout:
    def write(self, text):
        if threading.current_thread().name in _SUPPRESSED_THREAD_NAMES:
            return
        _REAL_STDOUT.write(text)

    def flush(self):
        _REAL_STDOUT.flush()


sys.stdout = ThreadAwareStdout()

# ============================================================
# SMARTGS PREDICTION ENGINE
# ============================================================

# ============================================================
# VIDEO PATHS
# (CV4 and CV5 use their own internal default VIDEO_PATH,
#  so no path is passed to them here.)
# ============================================================
CV1_VIDEO = "videos/cv1/cv1_mrt_anonymised.mp4"
CV2_VIDEO = "videos/cv2/cv2_mrt_anonymised.mp4"
CV3_VIDEO = "videos/cv3/cv3_mrt_anonymised.mp4"

# ============================================================
# ENGINE UPDATE INTERVAL
# ============================================================
ENGINE_UPDATE_INTERVAL = 5

# ============================================================
# PREDICTION WEIGHTS
# ============================================================
OCCUPANCY_WEIGHT = 0.40
FLOW_WEIGHT = 0.15
BOARDING_WEIGHT = 0.45

# ============================================================
# HISTORICAL ALIGHTING
# ============================================================
ALIGHTING_RATE = 0.30
REMAINING_PASSENGER_RATE = 1.0 - ALIGHTING_RATE


# ============================================================
# GUIDANCE
# ============================================================
def get_guidance(prediction):
    if prediction <= 20:
        return "GREEN"
    elif prediction <= 25:
        return "YELLOW"
    else:
        return "RED"


# ============================================================
# CROWD LEVEL
# ============================================================
def get_crowd_level(prediction):
    if prediction <= 20:
        return "LOW"
    elif prediction <= 25:
        return "MODERATE"
    else:
        return "HIGH"


# ============================================================
# PREDICTION FUNCTION
# ============================================================
def calculate_prediction(incoming_occupancy, flow_score, boarding_score):
    post_alighting_occupancy = incoming_occupancy * REMAINING_PASSENGER_RATE

    prediction = (
        post_alighting_occupancy * OCCUPANCY_WEIGHT
        + flow_score * FLOW_WEIGHT
        + boarding_score * BOARDING_WEIGHT
    )

    prediction = max(0, min(prediction, 100))
    return prediction


# ============================================================
# SHARED CV RESULTS
#
# CV1-CV4 push their latest result into these globals via
# result_callback every time they finish a YOLO pass.
# CV5 keeps its own thread-safe store internally, so it is
# read directly through get_cv5_latest_result() instead.
# ============================================================
cv1_data = None
cv2_data = None
cv3_data = None
cv4_data = None

# ============================================================
# LOCK
# ============================================================
data_lock = threading.Lock()


# ============================================================
# CALLBACK FACTORY
#
# Each CV1-CV4 module already calls result_callback(data)
# every time it finishes processing a sampled frame. This
# wires that push straight into the shared globals above,
# under the lock, so the engine always has a live "latest
# result" for each CV without waiting for run_detection()
# to return (which it never does while loop_video=True).
# ============================================================
def make_callback(cv_name):
    def callback(data):
        global cv1_data, cv2_data, cv3_data, cv4_data
        with data_lock:
            if cv_name == "cv1":
                cv1_data = data
            elif cv_name == "cv2":
                cv2_data = data
            elif cv_name == "cv3":
                cv3_data = data
            elif cv_name == "cv4":
                cv4_data = data
    return callback


# ============================================================
# CV1 THREAD
# ============================================================
def run_cv1_thread():
    run_cv1(
        CV1_VIDEO,
        display=False,
        loop_video=True,
        result_callback=make_callback("cv1")
    )


# ============================================================
# CV2 THREAD
# ============================================================
def run_cv2_thread():
    run_cv2(
        CV2_VIDEO,
        display=False,
        loop_video=True,
        result_callback=make_callback("cv2")
    )


# ============================================================
# CV3 THREAD
# ============================================================
def run_cv3_thread():
    run_cv3(
        CV3_VIDEO,
        display=False,
        loop_video=True,
        result_callback=make_callback("cv3")
    )


# ============================================================
# CV4 THREAD
# ============================================================
def run_cv4_thread():
    run_cv4(
        display=False,
        loop_video=True,
        result_callback=make_callback("cv4")
    )


# ============================================================
# CV5 THREAD
#
# CV5 has no result_callback parameter - it maintains its
# own thread-safe "latest_result" internally and exposes it
# through get_latest_result(). So this thread just keeps the
# detection loop running continuously in the background; the
# engine reads CV5's data directly via get_cv5_latest_result()
# whenever it needs it.
# ============================================================
def run_cv5_thread():
    run_cv5(
        display=False,
        loop_video=True
    )


# ============================================================
# LATEST SNAPSHOT (for API consumption)
#
# Every 5-second cycle stores a JSON-serializable snapshot
# here under snapshot_lock. get_latest_snapshot() is what an
# API layer (e.g. FastAPI) calls to serve the data to a
# frontend app, instead of the frontend needing to read the
# terminal output.
# ============================================================
snapshot_lock = threading.Lock()
_latest_snapshot = {
    "status": "starting",
    "message": "Engine has not produced a prediction yet.",
}

_engine_started = False
_engine_start_lock = threading.Lock()


def get_latest_snapshot():
    """
    Thread-safe read of the most recent prediction snapshot.
    Safe to call from any thread, including a web framework's
    request-handling threads.
    """
    with snapshot_lock:
        return dict(_latest_snapshot)


# ============================================================
# ENGINE LOOP
#
# Runs forever on its own background thread. Starts CV1-CV5,
# waits for their first results, then every 5 seconds combines
# them, computes predictions/guidance, prints an update, and
# stores a snapshot for API consumers.
# ============================================================
def _engine_loop():
    # ========================================================
    # START MESSAGE
    # ========================================================
    print()
    print("=" * 70)
    print("SMARTGS PREDICTION ENGINE")
    print("=" * 70)
    print()
    print("Starting CV1-CV5...")
    print("CV1-CV5 will run continuously in the background.")
    print("Individual CV outputs are suppressed.")
    print(f"Prediction engine updates every {ENGINE_UPDATE_INTERVAL} seconds.")
    print()

    # ========================================================
    # CREATE THREADS
    # ========================================================
    threads = [
        threading.Thread(target=run_cv1_thread, name="CV1", daemon=True),
        threading.Thread(target=run_cv2_thread, name="CV2", daemon=True),
        threading.Thread(target=run_cv3_thread, name="CV3", daemon=True),
        threading.Thread(target=run_cv4_thread, name="CV4", daemon=True),
        threading.Thread(target=run_cv5_thread, name="CV5", daemon=True),
    ]

    # ========================================================
    # START THREADS
    # ========================================================
    for thread in threads:
        thread.start()

    # ========================================================
    # WAIT FOR INITIAL RESULTS
    #
    # CV1-CV4 start as None until their first callback fires.
    # CV5 is always available immediately since its module-level
    # default already exists.
    # ========================================================
    print("Waiting for initial CV results...")
    print()

    while True:
        with data_lock:
            ready = (
                cv1_data is not None
                and cv2_data is not None
                and cv3_data is not None
                and cv4_data is not None
            )
        if ready:
            break
        time.sleep(0.1)

    print("Initial CV results received.")
    print()

    # ========================================================
    # CONTINUOUS PREDICTION LOOP
    # ========================================================
    while True:
        # ====================================================
        # WAIT EXACTLY 5 SECONDS
        # ====================================================
        time.sleep(ENGINE_UPDATE_INTERVAL)

        # ====================================================
        # EXTRACT LATEST DATA FROM ALL 5 CVS
        #
        # THIS IS THE ONLY PLACE WHERE THE ENGINE
        # READS THE CV RESULTS.
        # ====================================================
        with data_lock:
            current_cv1 = cv1_data.copy()
            current_cv2 = cv2_data.copy()
            current_cv3 = cv3_data.copy()
            current_cv4 = cv4_data.copy()

        current_cv5 = get_cv5_latest_result()

        # ====================================================
        # CV1 -> Doors 1-2 occupancy / seats
        # ====================================================
        door_1_occupancy = current_cv1["door_1_occupancy"]
        door_1_seat_availability = current_cv1["door_1_seat_availability"]
        door_1_seats_available = current_cv1["door_1_seats_available"]
        door_2_occupancy = current_cv1["door_2_occupancy"]
        door_2_seat_availability = current_cv1["door_2_seat_availability"]
        door_2_seats_available = current_cv1["door_2_seats_available"]

        # ====================================================
        # CV2 -> Doors 3-4 occupancy / seats
        # ====================================================
        door_3_occupancy = current_cv2["door_3_occupancy"]
        door_3_seat_availability = current_cv2["door_3_seat_availability"]
        door_3_seats_available = current_cv2["door_3_seats_available"]
        door_4_occupancy = current_cv2["door_4_occupancy"]
        door_4_seat_availability = current_cv2["door_4_seat_availability"]
        door_4_seats_available = current_cv2["door_4_seats_available"]

        # ====================================================
        # CV3 -> Platform flow
        # ====================================================
        flow_crossings = current_cv3["flow_crossings"]
        flow_score = current_cv3["flow_score"]

        # ====================================================
        # CV4 -> Doors 1-2 boarding
        # ====================================================
        door_1_boarding_score = current_cv4["door_1_boarding_score"]
        door_2_boarding_score = current_cv4["door_2_boarding_score"]

        # ====================================================
        # CV5 -> Doors 3-4 boarding
        # ====================================================
        door_3_boarding_score = current_cv5["door_3_boarding_score"]
        door_4_boarding_score = current_cv5["door_4_boarding_score"]

        # ====================================================
        # CALCULATE PREDICTIONS
        # ====================================================
        door_1_prediction = calculate_prediction(
            door_1_occupancy, flow_score, door_1_boarding_score
        )
        door_2_prediction = calculate_prediction(
            door_2_occupancy, flow_score, door_2_boarding_score
        )
        door_3_prediction = calculate_prediction(
            door_3_occupancy, flow_score, door_3_boarding_score
        )
        door_4_prediction = calculate_prediction(
            door_4_occupancy, flow_score, door_4_boarding_score
        )

        # ====================================================
        # POST-ALIGHTING OCCUPANCY
        # ====================================================
        door_1_post_alighting = door_1_occupancy * REMAINING_PASSENGER_RATE
        door_2_post_alighting = door_2_occupancy * REMAINING_PASSENGER_RATE
        door_3_post_alighting = door_3_occupancy * REMAINING_PASSENGER_RATE
        door_4_post_alighting = door_4_occupancy * REMAINING_PASSENGER_RATE

        # ====================================================
        # CROWD LEVELS
        # ====================================================
        door_1_level = get_crowd_level(door_1_prediction)
        door_2_level = get_crowd_level(door_2_prediction)
        door_3_level = get_crowd_level(door_3_prediction)
        door_4_level = get_crowd_level(door_4_prediction)

        # ====================================================
        # GUIDANCE
        # ====================================================
        door_1_guidance = get_guidance(door_1_prediction)
        door_2_guidance = get_guidance(door_2_prediction)
        door_3_guidance = get_guidance(door_3_prediction)
        door_4_guidance = get_guidance(door_4_prediction)

        # ====================================================
        # PRINT UPDATE
        # ====================================================
        print()
        print("=" * 70)
        print("SMARTGS LIVE PREDICTION UPDATE")
        print("=" * 70)
        print()

        # ====================================================
        # DOOR 1
        # ====================================================
        print("DOOR 1")
        print(f"Incoming occupancy: {door_1_occupancy:.1f}%")
        print(f"Seat availability: {door_1_seat_availability:.1f}%")
        print(f"Post-alighting occupancy: {door_1_post_alighting:.1f}%")
        print(f"Boarding-zone score: {door_1_boarding_score:.1f}/100")
        print(f"Platform flow score: {flow_score:.1f}/100")
        print(f"Predicted crowd score: {door_1_prediction:.1f}/100")
        print(f"Predicted crowd level: {door_1_level}")
        print(f"Guidance: {door_1_guidance}")
        print()

        # ====================================================
        # DOOR 2
        # ====================================================
        print("DOOR 2")
        print(f"Incoming occupancy: {door_2_occupancy:.1f}%")
        print(f"Seat availability: {door_2_seat_availability:.1f}%")
        print(f"Post-alighting occupancy: {door_2_post_alighting:.1f}%")
        print(f"Boarding-zone score: {door_2_boarding_score:.1f}/100")
        print(f"Platform flow score: {flow_score:.1f}/100")
        print(f"Predicted crowd score: {door_2_prediction:.1f}/100")
        print(f"Predicted crowd level: {door_2_level}")
        print(f"Guidance: {door_2_guidance}")
        print()

        # ====================================================
        # DOOR 3
        # ====================================================
        print("DOOR 3")
        print(f"Incoming occupancy: {door_3_occupancy:.1f}%")
        print(f"Seat availability: {door_3_seat_availability:.1f}%")
        print(f"Post-alighting occupancy: {door_3_post_alighting:.1f}%")
        print(f"Boarding-zone score: {door_3_boarding_score:.1f}/100")
        print(f"Platform flow score: {flow_score:.1f}/100")
        print(f"Predicted crowd score: {door_3_prediction:.1f}/100")
        print(f"Predicted crowd level: {door_3_level}")
        print(f"Guidance: {door_3_guidance}")
        print()

        # ====================================================
        # DOOR 4
        # ====================================================
        print("DOOR 4")
        print(f"Incoming occupancy: {door_4_occupancy:.1f}%")
        print(f"Seat availability: {door_4_seat_availability:.1f}%")
        print(f"Post-alighting occupancy: {door_4_post_alighting:.1f}%")
        print(f"Boarding-zone score: {door_4_boarding_score:.1f}/100")
        print(f"Platform flow score: {flow_score:.1f}/100")
        print(f"Predicted crowd score: {door_4_prediction:.1f}/100")
        print(f"Predicted crowd level: {door_4_level}")
        print(f"Guidance: {door_4_guidance}")
        print()

        # ====================================================
        # FIND BEST DOOR
        # ====================================================
        all_predictions = {
            "Door 1": door_1_prediction,
            "Door 2": door_2_prediction,
            "Door 3": door_3_prediction,
            "Door 4": door_4_prediction,
        }

        door_levels = {
            "Door 1": door_1_level,
            "Door 2": door_2_level,
            "Door 3": door_3_level,
            "Door 4": door_4_level,
        }

        door_seats = {
            "Door 1": (door_1_seats_available, DOOR_1_SEATS),
            "Door 2": (door_2_seats_available, DOOR_2_SEATS),
            "Door 3": (door_3_seats_available, DOOR_3_SEATS),
            "Door 4": (door_4_seats_available, DOOR_4_SEATS),
        }

        best_door = min(all_predictions, key=all_predictions.get)
        best_score = all_predictions[best_door]
        best_level = door_levels[best_door]
        best_seats_available, best_seats_total = door_seats[best_door]

        # ====================================================
        # RECOMMENDATION
        # ====================================================
        print("=" * 70)
        print("BOARDING RECOMMENDATION")
        print("=" * 70)
        print()
        print(f"Recommended door: {best_door}")
        print(f"Predicted crowd level: {best_level}")
        print(f"Guidance: {get_guidance(best_score)}")
        print(f"Seats available: {best_seats_available}/{best_seats_total}")
        print()
        print("Lower predicted crowd score = better boarding choice.")
        print()
        print(f"Next prediction update in {ENGINE_UPDATE_INTERVAL} seconds...")

        # ====================================================
        # BUILD SNAPSHOT FOR API CONSUMERS
        #
        # This is the JSON-serializable object an API layer
        # (e.g. FastAPI) hands back to a frontend app. Plain
        # dicts/floats/strings only - no custom objects.
        # ====================================================
        snapshot = {
            "status": "ok",
            "updated_at": time.time(),
            "platform_flow_score": round(flow_score, 1),
            "doors": {
                "door_1": {
                    "occupancy_percent": round(door_1_occupancy, 1),
                    "seat_availability_percent": round(door_1_seat_availability, 1),
                    "seats_available": door_1_seats_available,
                    "seats_total": DOOR_1_SEATS,
                    "boarding_score": round(door_1_boarding_score, 1),
                    "predicted_crowd_score": round(door_1_prediction, 1),
                    "predicted_crowd_level": door_1_level,
                    "guidance": door_1_guidance,
                },
                "door_2": {
                    "occupancy_percent": round(door_2_occupancy, 1),
                    "seat_availability_percent": round(door_2_seat_availability, 1),
                    "seats_available": door_2_seats_available,
                    "seats_total": DOOR_2_SEATS,
                    "boarding_score": round(door_2_boarding_score, 1),
                    "predicted_crowd_score": round(door_2_prediction, 1),
                    "predicted_crowd_level": door_2_level,
                    "guidance": door_2_guidance,
                },
                "door_3": {
                    "occupancy_percent": round(door_3_occupancy, 1),
                    "seat_availability_percent": round(door_3_seat_availability, 1),
                    "seats_available": door_3_seats_available,
                    "seats_total": DOOR_3_SEATS,
                    "boarding_score": round(door_3_boarding_score, 1),
                    "predicted_crowd_score": round(door_3_prediction, 1),
                    "predicted_crowd_level": door_3_level,
                    "guidance": door_3_guidance,
                },
                "door_4": {
                    "occupancy_percent": round(door_4_occupancy, 1),
                    "seat_availability_percent": round(door_4_seat_availability, 1),
                    "seats_available": door_4_seats_available,
                    "seats_total": DOOR_4_SEATS,
                    "boarding_score": round(door_4_boarding_score, 1),
                    "predicted_crowd_score": round(door_4_prediction, 1),
                    "predicted_crowd_level": door_4_level,
                    "guidance": door_4_guidance,
                },
            },
            "recommendation": {
                "door": best_door,
                "predicted_crowd_level": best_level,
                "guidance": get_guidance(best_score),
                "seats_available": best_seats_available,
                "seats_total": best_seats_total,
            },
        }

        with snapshot_lock:
            global _latest_snapshot
            _latest_snapshot = snapshot


# ============================================================
# START ENGINE
#
# Call this once to kick everything off: starts the 5 CV
# threads plus the engine's own background loop thread, then
# returns immediately (non-blocking). Safe to call multiple
# times - only the first call actually starts anything, so an
# API server's startup hook can call it freely.
# ============================================================
def start_engine():
    global _engine_started
    with _engine_start_lock:
        if _engine_started:
            return
        _engine_started = True
        threading.Thread(target=_engine_loop, name="EngineLoop", daemon=True).start()


# ============================================================
# STANDALONE TERMINAL MODE
#
# Running this file directly (python prediction_engine.py)
# still works exactly as before - it just also keeps a
# snapshot available in memory in case something else wants
# to read get_latest_snapshot() from the same process.
# ============================================================
if __name__ == "__main__":
    start_engine()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print()
        print("=" * 70)
        print("SMARTGS PREDICTION ENGINE STOPPED")
        print("=" * 70)

