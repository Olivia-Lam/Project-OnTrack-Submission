import cv2
import json
from pathlib import Path


# ============================================================
# SETTINGS
# ============================================================

VIDEO_PATH = Path("videos/cv1/cv1_mrt.mp4")

OUTPUT_PATH = Path(
    "config/cv1_rois.json"
)

DISPLAY_WIDTH = 1280
DISPLAY_HEIGHT = 720


# ============================================================
# OPEN VIDEO
# ============================================================

cap = cv2.VideoCapture(
    str(VIDEO_PATH)
)

if not cap.isOpened():

    print(
        f"ERROR: Could not open video: {VIDEO_PATH}"
    )

    exit()


# Use a frame from the video for calibration
cap.set(
    cv2.CAP_PROP_POS_FRAMES,
    100
)

ret, frame = cap.read()

cap.release()


if not ret:

    print("ERROR: Could not read calibration frame.")

    exit()


# ============================================================
# VARIABLES
# ============================================================

drawing = False

start_x = 0
start_y = 0

current_rect = None


# ============================================================
# MOUSE CALLBACK
# ============================================================

def mouse_callback(
    event,
    x,
    y,
    flags,
    param
):

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
# CREATE WINDOW
# ============================================================

window_name = "SmartGS CV1 ROI Calibration"

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
# DRAW ONE ROI
# ============================================================

def select_single_roi(
    name,
    colour
):

    global current_rect

    print()
    print("=" * 60)
    print(f"SELECT {name.upper()}")
    print("=" * 60)
    print("Draw the rectangle.")
    print("Press ENTER to confirm.")
    print()


    while True:

        current_rect = None


        while True:

            display = frame.copy()


            if current_rect is not None:

                x1, y1, x2, y2 = current_rect

                cv2.rectangle(
                    display,
                    (x1, y1),
                    (x2, y2),
                    colour,
                    3
                )


            cv2.putText(
                display,
                f"SELECTING: {name.upper()}",
                (30, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.85,
                colour,
                2
            )

            cv2.putText(
                display,
                "Draw rectangle -> ENTER",
                (30, 75),
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


            if key == 13:

                if current_rect is None:

                    continue


                x1, y1, x2, y2 = current_rect

                left = min(x1, x2)
                right = max(x1, x2)

                top = min(y1, y2)
                bottom = max(y1, y2)


                return {

                    "x": left,
                    "y": top,
                    "width": right - left,
                    "height": bottom - top
                }


# ============================================================
# DRAW MULTIPLE INTERIOR ROIs
# ============================================================

def select_multiple_rois(
    name,
    colour
):

    global current_rect

    selected = []

    print()
    print("=" * 60)
    print(f"SELECT {name.upper()}")
    print("=" * 60)
    print("Draw one rectangle.")
    print("Press ENTER to save it.")
    print("Draw the next rectangle.")
    print("Press ESC when finished.")
    print()


    while True:

        current_rect = None


        while True:

            display = frame.copy()


            # ------------------------------------------------
            # Previously saved rectangles
            # ------------------------------------------------

            for index, roi in enumerate(
                selected,
                start=1
            ):

                cv2.rectangle(
                    display,
                    (roi["x"], roi["y"]),
                    (
                        roi["x"] + roi["width"],
                        roi["y"] + roi["height"]
                    ),
                    colour,
                    3
                )

                cv2.putText(
                    display,
                    f"{name.upper()} {index}",
                    (
                        roi["x"],
                        roi["y"] + 25
                    ),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    colour,
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
                    colour,
                    3
                )


            cv2.putText(
                display,
                f"SELECTING: {name.upper()}",
                (30, 40),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.85,
                colour,
                2
            )

            cv2.putText(
                display,
                "ENTER = save rectangle    ESC = finish",
                (30, 75),
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


                roi = {

                    "x": left,
                    "y": top,
                    "width": right - left,
                    "height": bottom - top
                }


                selected.append(
                    roi
                )


                print(
                    f"{name} {len(selected)}: {roi}"
                )


                break


            # ------------------------------------------------
            # ESC
            # ------------------------------------------------

            elif key == 27:

                return selected


# ============================================================
# CV1 CALIBRATION SEQUENCE
# ============================================================

rois = {}


# ------------------------------------------------------------
# Door 1
# ------------------------------------------------------------

rois["door_1"] = select_single_roi(
    "door_1",
    (0, 255, 0)
)


# ------------------------------------------------------------
# Door 2
# ------------------------------------------------------------

rois["door_2"] = select_single_roi(
    "door_2",
    (0, 255, 0)
)


# ------------------------------------------------------------
# Door 1 interior
# ------------------------------------------------------------

rois["door_1_interior"] = select_multiple_rois(
    "door_1_interior",
    (255, 0, 0)
)


# ------------------------------------------------------------
# Door 2 interior
# ------------------------------------------------------------

rois["door_2_interior"] = select_multiple_rois(
    "door_2_interior",
    (0, 165, 255)
)


# ============================================================
# SAVE
# ============================================================

OUTPUT_PATH.parent.mkdir(
    parents=True,
    exist_ok=True
)


with open(
    OUTPUT_PATH,
    "w"
) as file:

    json.dump(
        rois,
        file,
        indent=4
    )


cv2.destroyAllWindows()


# ============================================================
# SUMMARY
# ============================================================

print()
print("=" * 60)
print("CV1 ROI CALIBRATION COMPLETE")
print("=" * 60)

print()
print(f"Saved to: {OUTPUT_PATH}")

print()
print(
    f"Door 1 interior ROIs: "
    f"{len(rois['door_1_interior'])}"
)

print(
    f"Door 2 interior ROIs: "
    f"{len(rois['door_2_interior'])}"
)

print("=" * 60)