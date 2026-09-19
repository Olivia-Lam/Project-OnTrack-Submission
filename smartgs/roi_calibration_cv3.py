import cv2
from pathlib import Path
import json


# ============================================================
# SETTINGS
# ============================================================

VIDEO_PATH = Path(
    "videos/cv3/cv3_mrt_anonymised.mp4"
)

OUTPUT_PATH = Path(
    "config/cv3_flow_roi.json"
)

DISPLAY_WIDTH = 1280


# ============================================================
# OPEN VIDEO
# ============================================================

cap = cv2.VideoCapture(
    str(VIDEO_PATH)
)

if not cap.isOpened():

    print(
        f"ERROR: Could not open {VIDEO_PATH}"
    )

    exit()


# ============================================================
# GET FIRST FRAME
# ============================================================

ret, frame = cap.read()

cap.release()


if not ret:

    print("ERROR: Could not read video.")

    exit()


# ============================================================
# RESIZE FOR DISPLAY
# ============================================================

scale = (
    DISPLAY_WIDTH /
    frame.shape[1]
)

display_height = int(
    frame.shape[0] *
    scale
)

display_frame = cv2.resize(
    frame,
    (
        DISPLAY_WIDTH,
        display_height
    ),
    interpolation=cv2.INTER_AREA
)


# ============================================================
# LINE DRAWING
# ============================================================

points = []


def mouse_callback(
    event,
    x,
    y,
    flags,
    param
):

    if event == cv2.EVENT_LBUTTONDOWN:

        if len(points) < 2:

            # Convert display coordinates
            # back to original video coordinates

            original_x = int(
                x / scale
            )

            original_y = int(
                y / scale
            )

            points.append(
                {
                    "x": original_x,
                    "y": original_y
                }
            )

            print(
                f"Point {len(points)}: "
                f"x={original_x}, "
                f"y={original_y}"
            )


# ============================================================
# CREATE WINDOW
# ============================================================

cv2.namedWindow(
    "CV3 Flow Calibration"
)

cv2.setMouseCallback(
    "CV3 Flow Calibration",
    mouse_callback
)


print()
print("=" * 60)
print("SMARTGS CV3 FLOW CALIBRATION")
print("=" * 60)
print()
print("Click TWO points to create the flow line.")
print()
print("Point 1 → one end of the line")
print("Point 2 → the other end of the line")
print()
print("Press ENTER to save.")
print("Press ESC to cancel.")
print()


# ============================================================
# CALIBRATION LOOP
# ============================================================

while True:

    display = display_frame.copy()


    # Draw selected points

    for point in points:

        x = int(
            point["x"] * scale
        )

        y = int(
            point["y"] * scale
        )

        cv2.circle(
            display,
            (x, y),
            6,
            (0, 255, 0),
            -1
        )


    # Draw line

    if len(points) == 2:

        x1 = int(
            points[0]["x"] * scale
        )

        y1 = int(
            points[0]["y"] * scale
        )

        x2 = int(
            points[1]["x"] * scale
        )

        y2 = int(
            points[1]["y"] * scale
        )

        cv2.line(
            display,
            (x1, y1),
            (x2, y2),
            (0, 255, 0),
            3
        )


    cv2.imshow(
        "CV3 Flow Calibration",
        display
    )


    key = cv2.waitKey(1) & 0xFF


    if key == 13:  # ENTER

        if len(points) == 2:

            break

        print(
            "Please select exactly two points."
        )


    elif key == 27:  # ESC

        print(
            "Calibration cancelled."
        )

        cv2.destroyAllWindows()

        exit()


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
        {
            "flow_line": points
        },
        file,
        indent=4
    )


cv2.destroyAllWindows()


print()
print("=" * 60)
print("CALIBRATION COMPLETE")
print("=" * 60)

print(
    f"Saved to: {OUTPUT_PATH}"
)