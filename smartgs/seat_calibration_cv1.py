import cv2
import json
from pathlib import Path


# ============================================================
# SETTINGS
# ============================================================

VIDEO_PATH = Path("videos/cv1/cv1_mrt.mp4")
OUTPUT_PATH = Path("config/cv1_seats.json")

DISPLAY_WIDTH = 1280
DISPLAY_HEIGHT = 720


# ============================================================
# OPEN VIDEO
# ============================================================

cap = cv2.VideoCapture(str(VIDEO_PATH))

if not cap.isOpened():
    print(f"ERROR: Could not open video: {VIDEO_PATH}")
    exit()

cap.set(cv2.CAP_PROP_POS_FRAMES, 100)

ret, frame = cap.read()

cap.release()

if not ret:
    print("ERROR: Could not read calibration frame.")
    exit()


# ============================================================
# MOUSE VARIABLES
# ============================================================

drawing = False

start_x = 0
start_y = 0

current_rect = None


def mouse_callback(event, x, y, flags, param):

    global drawing
    global start_x
    global start_y
    global current_rect

    if event == cv2.EVENT_LBUTTONDOWN:

        drawing = True

        start_x = x
        start_y = y

        current_rect = None

    elif event == cv2.EVENT_MOUSEMOVE:

        if drawing:

            current_rect = (
                start_x,
                start_y,
                x,
                y
            )

    elif event == cv2.EVENT_LBUTTONUP:

        drawing = False

        current_rect = (
            start_x,
            start_y,
            x,
            y
        )


# ============================================================
# WINDOW
# ============================================================

window_name = "SmartGS CV1 Seat Calibration"

cv2.namedWindow(
    window_name,
    cv2.WINDOW_NORMAL
)

cv2.resizeWindow(
    window_name,
    DISPLAY_WIDTH,
    DISPLAY_HEIGHT
)

cv2.setMouseCallback(
    window_name,
    mouse_callback
)


# ============================================================
# SELECT SEATS
# ============================================================

def select_seats(door_name):

    global current_rect

    seats = []

    print()
    print("=" * 60)
    print(f"{door_name.upper()} SEAT CALIBRATION")
    print("=" * 60)
    print("Draw one seat.")
    print("Press ENTER to save the seat.")
    print("Draw the next seat.")
    print("Press ESC when finished.")
    print()


    while True:

        current_rect = None

        while True:

            display = frame.copy()


            # ------------------------------------------------
            # Previously saved seats
            # ------------------------------------------------

            for index, seat in enumerate(
                seats,
                start=1
            ):

                cv2.rectangle(
                    display,
                    (seat["x"], seat["y"]),
                    (
                        seat["x"] + seat["width"],
                        seat["y"] + seat["height"]
                    ),
                    (255, 0, 255),
                    3
                )

                cv2.putText(
                    display,
                    f"SEAT {index}",
                    (
                        seat["x"],
                        max(seat["y"] - 8, 20)
                    ),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255, 0, 255),
                    2
                )


            # ------------------------------------------------
            # Current rectangle
            # ------------------------------------------------

            if current_rect is not None:

                x1, y1, x2, y2 = current_rect

                cv2.rectangle(
                    display,
                    (x1, y1),
                    (x2, y2),
                    (255, 0, 255),
                    3
                )


            cv2.putText(
                display,
                f"{door_name.upper()} - SEATS",
                (30, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.85,
                (255, 0, 255),
                2
            )

            cv2.putText(
                display,
                "ENTER = save seat    ESC = finish",
                (30, 75),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2
            )

            cv2.putText(
                display,
                f"Seats selected: {len(seats)}",
                (30, 110),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (255, 255, 255),
                2
            )


            cv2.imshow(
                window_name,
                display
            )


            key = cv2.waitKey(1) & 0xFF


            # ------------------------------------------------
            # ENTER
            # ------------------------------------------------

            if key == 13:

                if current_rect is None:
                    continue

                x1, y1, x2, y2 = current_rect

                left = min(x1, x2)
                right = max(x1, x2)

                top = min(y1, y2)
                bottom = max(y1, y2)

                seat = {
                    "x": left,
                    "y": top,
                    "width": right - left,
                    "height": bottom - top
                }

                seats.append(seat)

                print(
                    f"{door_name} Seat {len(seats)}: {seat}"
                )

                break


            # ------------------------------------------------
            # ESC
            # ------------------------------------------------

            elif key == 27:

                return seats


# ============================================================
# CALIBRATION SEQUENCE
# ============================================================

print()
print("SMARTGS CV1 SEAT CALIBRATION")
print()
print("First: Door 1")
print("Then: Door 2")


door_1_seats = select_seats(
    "door_1"
)


door_2_seats = select_seats(
    "door_2"
)


# ============================================================
# SAVE
# ============================================================

seats = {

    "door_1": door_1_seats,

    "door_2": door_2_seats
}


OUTPUT_PATH.parent.mkdir(
    parents=True,
    exist_ok=True
)


with open(
    OUTPUT_PATH,
    "w"
) as file:

    json.dump(
        seats,
        file,
        indent=4
    )


cv2.destroyAllWindows()


# ============================================================
# SUMMARY
# ============================================================

print()
print("=" * 60)
print("CV1 SEAT CALIBRATION COMPLETE")
print("=" * 60)

print(
    f"Door 1 seats: {len(door_1_seats)}"
)

print(
    f"Door 2 seats: {len(door_2_seats)}"
)

print(
    f"Saved to: {OUTPUT_PATH}"
)

print("=" * 60)