import cv2
import json
from pathlib import Path


# ============================================================
# SETTINGS
# ============================================================

VIDEO_PATH = Path(
    "videos/cv5/cv5_mrt_anonymised.mp4"
)

OUTPUT_PATH = Path(
    "config/cv5_rois.json"
)

DISPLAY_WIDTH = 1280


# ============================================================
# ZONE ORDER
# ============================================================

ZONE_NAMES = [

    "door_3_left",

    "door_3_disembark",

    "door_3_right",

    "door_4_left",

    "door_4_disembark",

    "door_4_right"

]


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
# READ FIRST FRAME
# ============================================================

ret, frame = cap.read()

cap.release()


if not ret:

    print(
        "ERROR: Could not read video."
    )

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
# ROI VARIABLES
# ============================================================

regions = {}

current_zone_index = 0

start_point = None

current_point = None

drawing = False


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

    global start_point
    global current_point
    global drawing


    if event == cv2.EVENT_LBUTTONDOWN:

        start_point = (

            int(x / scale),

            int(y / scale)

        )

        current_point = start_point

        drawing = True


    elif (
        event == cv2.EVENT_MOUSEMOVE
        and
        drawing
    ):

        current_point = (

            int(x / scale),

            int(y / scale)

        )


    elif event == cv2.EVENT_LBUTTONUP:

        current_point = (

            int(x / scale),

            int(y / scale)

        )

        drawing = False


# ============================================================
# WINDOW
# ============================================================

cv2.namedWindow(
    "SmartGS CV5 ROI Calibration"
)

cv2.setMouseCallback(
    "SmartGS CV5 ROI Calibration",
    mouse_callback
)


print()
print("=" * 60)
print("SMARTGS CV5 ROI CALIBRATION")
print("=" * 60)

print()

print(
    "You will define 6 zones."
)

print()

print(
    "1. Door 3 - Left boarding"
)

print(
    "2. Door 3 - Disembarking"
)

print(
    "3. Door 3 - Right boarding"
)

print(
    "4. Door 4 - Left boarding"
)

print(
    "5. Door 4 - Disembarking"
)

print(
    "6. Door 4 - Right boarding"
)

print()

print(
    "LEFT CLICK + DRAG = draw rectangle"
)

print(
    "ENTER = save current rectangle"
)

print(
    "R = reset current rectangle"
)

print(
    "C = clear all saved zones"
)

print(
    "ESC = finish and save"
)

print()


# ============================================================
# CALIBRATION LOOP
# ============================================================

while True:

    display = display_frame.copy()


    # ========================================================
    # CURRENT ZONE
    # ========================================================

    if current_zone_index < len(ZONE_NAMES):

        current_name = ZONE_NAMES[
            current_zone_index
        ]

    else:

        current_name = "COMPLETE"


    # ========================================================
    # DRAW SAVED ROIs
    # ========================================================

    for index, zone_name in enumerate(
        ZONE_NAMES
    ):

        if zone_name not in regions:

            continue


        region = regions[
            zone_name
        ]


        x = region["x"]
        y = region["y"]

        w = region["width"]
        h = region["height"]


        x1 = int(
            x * scale
        )

        y1 = int(
            y * scale
        )

        x2 = int(
            (x + w) * scale
        )

        y2 = int(
            (y + h) * scale
        )


        cv2.rectangle(
            display,
            (x1, y1),
            (x2, y2),
            (0, 255, 0),
            2
        )


        cv2.putText(
            display,
            zone_name,
            (
                x1,
                max(20, y1 - 10)
            ),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 255, 0),
            2
        )


    # ========================================================
    # DRAW CURRENT ROI
    # ========================================================

    if (
        start_point is not None
        and
        current_point is not None
    ):

        x1 = int(
            start_point[0] * scale
        )

        y1 = int(
            start_point[1] * scale
        )

        x2 = int(
            current_point[0] * scale
        )

        y2 = int(
            current_point[1] * scale
        )


        cv2.rectangle(
            display,
            (x1, y1),
            (x2, y2),
            (0, 255, 255),
            2
        )


    # ========================================================
    # INFORMATION PANEL
    # ========================================================

    cv2.rectangle(
        display,
        (20, 20),
        (700, 80),
        (0, 0, 0),
        -1
    )


    if current_zone_index < len(ZONE_NAMES):

        text = (
            f"Draw: {current_name}"
        )

    else:

        text = (
            "All 6 zones complete"
        )


    cv2.putText(
        display,
        text,
        (35, 58),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.65,
        (255, 255, 255),
        2
    )


    # ========================================================
    # DISPLAY
    # ========================================================

    cv2.imshow(
        "SmartGS CV5 ROI Calibration",
        display
    )


    key = cv2.waitKey(1) & 0xFF


    # ========================================================
    # ENTER — SAVE ROI
    # ========================================================

    if key == 13:

        if (
            current_zone_index
            >=
            len(ZONE_NAMES)
        ):

            continue


        if (
            start_point is not None
            and
            current_point is not None
        ):

            x1 = min(
                start_point[0],
                current_point[0]
            )

            y1 = min(
                start_point[1],
                current_point[1]
            )

            x2 = max(
                start_point[0],
                current_point[0]
            )

            y2 = max(
                start_point[1],
                current_point[1]
            )


            width = x2 - x1

            height = y2 - y1


            if (
                width > 0
                and
                height > 0
            ):

                zone_name = ZONE_NAMES[
                    current_zone_index
                ]


                regions[
                    zone_name
                ] = {

                    "x": x1,

                    "y": y1,

                    "width": width,

                    "height": height

                }


                print()

                print(
                    f"Saved: {zone_name}"
                )

                print(
                    f"x={x1}, "
                    f"y={y1}, "
                    f"width={width}, "
                    f"height={height}"
                )


                current_zone_index += 1


            start_point = None

            current_point = None


    # ========================================================
    # RESET CURRENT ROI
    # ========================================================

    elif key == ord("r"):

        start_point = None

        current_point = None


    # ========================================================
    # CLEAR ALL
    # ========================================================

    elif key == ord("c"):

        regions.clear()

        current_zone_index = 0

        start_point = None

        current_point = None

        print()

        print(
            "All zones cleared."
        )


    # ========================================================
    # ESC — FINISH AND SAVE
    # ========================================================

    elif key == 27:

        print()

        print(
            "Calibration finished."
        )

        break


# ============================================================
# SAVE CONFIGURATION
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
        regions,
        file,
        indent=4
    )


cv2.destroyAllWindows()


print()
print("=" * 60)
print("CV5 CALIBRATION COMPLETE")
print("=" * 60)

print(
    f"Zones saved: {len(regions)} / 6"
)

print(
    f"Saved to: {OUTPUT_PATH}"
)