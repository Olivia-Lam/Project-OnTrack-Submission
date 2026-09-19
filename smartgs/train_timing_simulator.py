import random
import threading
import time

# ============================================================
# TRAIN TIMING SIMULATOR
#
# Simulates incoming train arrivals for Platform A and
# Platform B independently - each platform gets its own queue
# of upcoming arrivals with a randomised 2-3 minute headway
# between trains. Nothing ties the two platforms' random values
# together, so they naturally don't line up with each other.
#
# No background thread needed: a train arrival is just a
# timestamp in the future. Each call checks whether the
# earliest queued arrival has already passed and, if so,
# replaces it with a new one - so the queue is always kept
# topped up to at least 2 upcoming arrivals per platform.
# ============================================================

MIN_HEADWAY_SECONDS = 120  # 2 minutes
MAX_HEADWAY_SECONDS = 180  # 3 minutes

_lock = threading.Lock()

# One independent queue of upcoming arrival timestamps (absolute
# time.time() values) per platform.
_queues = {
    "A": [],
    "B": [],
}


def _random_headway():
    return random.uniform(MIN_HEADWAY_SECONDS, MAX_HEADWAY_SECONDS)


def _ensure_queue(platform):
    """
    Drops any arrivals that have already happened, then tops
    the queue back up to at least 2 upcoming arrivals, each
    spaced by a fresh random 2-3 minute headway from the last
    scheduled arrival.
    """
    queue = _queues[platform]
    now = time.time()

    while queue and queue[0] <= now:
        queue.pop(0)

    while len(queue) < 2:
        base_time = queue[-1] if queue else now
        queue.append(base_time + _random_headway())


def _format_eta(seconds_remaining):
    seconds_remaining = max(0, seconds_remaining)
    minutes = seconds_remaining // 60
    seconds = seconds_remaining % 60
    return f"{minutes}:{seconds:02d}"


def get_train_timing(platform):
    """
    Returns the next two upcoming train arrivals for the given
    platform ("A" or "B"): how many seconds until each arrives,
    plus a formatted mm:ss ETA. Safe to call repeatedly and
    concurrently.
    """
    if platform not in _queues:
        raise ValueError(f"Unknown platform: {platform}")

    with _lock:
        _ensure_queue(platform)
        queue = _queues[platform]
        now = time.time()

        next_seconds = round(queue[0] - now)
        following_seconds = round(queue[1] - now)

        return {
            "status": "ok",
            "platform": platform,
            "next_train": {
                "seconds_until_arrival": next_seconds,
                "eta": _format_eta(next_seconds),
            },
            "following_train": {
                "seconds_until_arrival": following_seconds,
                "eta": _format_eta(following_seconds),
            },
        }
