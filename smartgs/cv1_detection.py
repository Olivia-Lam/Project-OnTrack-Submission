import cv2
import json
import time
from pathlib import Path
from ultralytics import YOLO


# ============================================================
# SETTINGS
# ============================================================

VIDEO_PATH = Path("videos/cv1/cv1_mrt_anonymised.mp4")
ROI_PATH = Path("config/cv1_rois.json")
SEAT_PATH = Path("config/cv1_seats.json")

MODEL_PATH = "yolov8s.pt"

CONFIDENCE = 0.10
PERSON_CLASS = 0

DISPLAY_WIDTH = 1280
DISPLAY_HEIGHT = 720

FRAME_INTERVAL = 5

# High-resolution Door 2 detection
DOOR_2_IMGSZ = 1280

# Duplicate removal
DUPLICATE_IOU_THRESHOLD = 0.40

# Seat detection
SEAT_OCCUPANCY_THRESHOLD = 0.10

# Overall carriage capacity
FULL_CAPACITY = 100

# Normal interior ROI threshold
INTERIOR_OVERLAP_THRESHOLD = 0.15

# Door 2 gets a more forgiving threshold because
# its calibrated interior ROIs are relatively thin.
DOOR_2_INTERIOR_OVERLAP_THRESHOLD = 0.05


# ============================================================
# LOAD CONFIG
# ============================================================

with open(ROI_PATH, "r") as file:
    rois = json.load(file)

with open(SEAT_PATH, "r") as file:
    seat_rois = json.load(file)


DOOR_1_SEATS = len(seat_rois["door_1"])
DOOR_2_SEATS = len(seat_rois["door_2"])

TOTAL_CALIBRATED_SEATS = (
    DOOR_1_SEATS +
    DOOR_2_SEATS
)


# ============================================================
# CAPACITY DISTRIBUTION
# ============================================================

if TOTAL_CALIBRATED_SEATS > 0:

    DOOR_1_FULL_CAPACITY = round(
        FULL_CAPACITY
        * DOOR_1_SEATS
        / TOTAL_CALIBRATED_SEATS
    )

else:

    DOOR_1_FULL_CAPACITY = 0


DOOR_2_FULL_CAPACITY = (
    FULL_CAPACITY
    - DOOR_1_FULL_CAPACITY
)


# ============================================================
# LOAD MODEL
# ============================================================

print("Loading YOLOv8s...")

model = YOLO(MODEL_PATH)

print("YOLOv8s loaded successfully.")

print()
print("=" * 60)
print("CALIBRATED SEAT INFORMATION")
print("=" * 60)

print(f"Door 1 seats: {DOOR_1_SEATS}")
print(f"Door 2 seats: {DOOR_2_SEATS}")
print(f"Total seats: {TOTAL_CALIBRATED_SEATS}")

print(
    f"Door 1 full capacity: "
    f"{DOOR_1_FULL_CAPACITY}"
)

print(
    f"Door 2 full capacity: "
    f"{DOOR_2_FULL_CAPACITY}"
)

print(
    f"Seat overlap threshold: "
    f"{SEAT_OCCUPANCY_THRESHOLD * 100:.1f}%"
)

print(
    f"Door 2 interior threshold: "
    f"{DOOR_2_INTERIOR_OVERLAP_THRESHOLD * 100:.1f}%"
)

print("=" * 60)
print()


# ============================================================
# ROI FUNCTIONS
# ============================================================

def point_in_roi(point, roi):

    x, y = point

    return (
        roi["x"] <= x <= roi["x"] + roi["width"]
        and
        roi["y"] <= y <= roi["y"] + roi["height"]
    )


def box_overlap_ratio(box, roi):

    x1, y1, x2, y2 = box

    rx1 = roi["x"]
    ry1 = roi["y"]

    rx2 = rx1 + roi["width"]
    ry2 = ry1 + roi["height"]

    ix1 = max(x1, rx1)
    iy1 = max(y1, ry1)

    ix2 = min(x2, rx2)
    iy2 = min(y2, ry2)

    intersection = (
        max(0, ix2 - ix1)
        *
        max(0, iy2 - iy1)
    )

    box_area = (
        max(0, x2 - x1)
        *
        max(0, y2 - y1)
    )

    if box_area <= 0:
        return 0.0

    return intersection / box_area


def box_in_any_roi(
    box,
    roi_list,
    threshold=INTERIOR_OVERLAP_THRESHOLD
):

    return any(
        box_overlap_ratio(
            box,
            roi
        ) >= threshold
        for roi in roi_list
    )


def seat_overlap_ratio(
    person_box,
    seat
):

    x1, y1, x2, y2 = person_box

    sx1 = seat["x"]
    sy1 = seat["y"]

    sx2 = sx1 + seat["width"]
    sy2 = sy1 + seat["height"]

    ix1 = max(x1, sx1)
    iy1 = max(y1, sy1)

    ix2 = min(x2, sx2)
    iy2 = min(y2, sy2)

    intersection = (
        max(0, ix2 - ix1)
        *
        max(0, iy2 - iy1)
    )

    seat_area = (
        seat["width"]
        *
        seat["height"]
    )

    if seat_area <= 0:
        return 0.0

    return intersection / seat_area


def box_iou(
    box_a,
    box_b
):

    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)

    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    intersection = (
        max(0, ix2 - ix1)
        *
        max(0, iy2 - iy1)
    )

    area_a = (
        max(0, ax2 - ax1)
        *
        max(0, ay2 - ay1)
    )

    area_b = (
        max(0, bx2 - bx1)
        *
        max(0, by2 - by1)
    )

    union = (
        area_a +
        area_b -
        intersection
    )

    if union <= 0:
        return 0.0

    return intersection / union


# ============================================================
# DOOR 2 HIGH-RESOLUTION CROP
# ============================================================

def get_door_2_crop(frame):

    h, w = frame.shape[:2]

    # Expanded Door 2 detection area.
    # This is deliberately larger than the calibrated
    # Door 2 interior ROIs.

    x1 = 480
    y1 = 40

    x2 = min(1030, w)
    y2 = min(780, h)

    crop = frame[
        y1:y2,
        x1:x2
    ]

    return (
        crop,
        x1,
        y1,
        x2,
        y2
    )


def get_boxes_from_crop_result(
    result,
    offset_x,
    offset_y,
    source="DOOR_2_CROP"
):

    detections = []

    for box in result.boxes:

        x1, y1, x2, y2 = map(
            int,
            box.xyxy[0]
        )

        # Convert crop coordinates back
        # into original full-frame coordinates.

        x1 += offset_x
        x2 += offset_x

        y1 += offset_y
        y2 += offset_y

        detections.append({

            "box": (
                x1,
                y1,
                x2,
                y2
            ),

            "confidence":
                float(box.conf[0]),

            "source":
                source

        })

    return detections


def remove_duplicate_detections(
    detections,
    iou_threshold=0.40
):

    if not detections:
        return []

    # Highest confidence first.

    detections = sorted(
        detections,
        key=lambda d: d["confidence"],
        reverse=True
    )

    kept = []

    for detection in detections:

        duplicate = False

        for existing in kept:

            iou = box_iou(
                detection["box"],
                existing["box"]
            )

            if iou >= iou_threshold:

                duplicate = True
                break

        if not duplicate:

            kept.append(
                detection
            )

    return kept


# ============================================================
# RESULT HELPERS
# ============================================================

def get_default_data():

    return {

        "door_1_interior_count": 0,

        "door_2_interior_count": 0,

        "door_1_seats_available":
            DOOR_1_SEATS,

        "door_2_seats_available":
            DOOR_2_SEATS,

        "door_1_seat_availability":
            100.0,

        "door_2_seat_availability":
            100.0,

        "door_1_occupancy":
            0.0,

        "door_2_occupancy":
            0.0,

    }


def get_boxes_from_result(
    result,
    source="FULL"
):

    detections = []

    for box in result.boxes:

        x1, y1, x2, y2 = map(
            int,
            box.xyxy[0]
        )

        detections.append({

            "box": (
                x1,
                y1,
                x2,
                y2
            ),

            "confidence":
                float(box.conf[0]),

            "source":
                source

        })

    return detections


# ============================================================
# SEAT OCCUPANCY
# ============================================================

def get_seat_occupancy(
    person_detections,
    seat_list
):

    occupied_seats = 0

    seat_status = []

    seat_overlap_values = []

    for seat in seat_list:

        maximum_overlap = 0.0

        for detection in person_detections:

            overlap = seat_overlap_ratio(
                detection["box"],
                seat
            )

            maximum_overlap = max(
                maximum_overlap,
                overlap
            )

        occupied = (
            maximum_overlap
            >= SEAT_OCCUPANCY_THRESHOLD
        )

        if occupied:
            occupied_seats += 1

        seat_status.append(
            occupied
        )

        seat_overlap_values.append(
            maximum_overlap
        )

    available_seats = (
        len(seat_list)
        -
        occupied_seats
    )

    return (
        available_seats,
        seat_status,
        seat_overlap_values
    )


# ============================================================
# DRAW SEATS
# ============================================================

def draw_seats(
    image,
    seat_list,
    seat_status,
    seat_overlap_values,
    label_prefix
):

    for index, seat in enumerate(
        seat_list
    ):

        occupied = seat_status[index]
        overlap = seat_overlap_values[index]

        color = (
            (0, 0, 255)
            if occupied
            else
            (0, 255, 0)
        )

        status = (
            "OCC"
            if occupied
            else
            "FREE"
        )

        x1 = seat["x"]
        y1 = seat["y"]

        x2 = x1 + seat["width"]
        y2 = y1 + seat["height"]

        cv2.rectangle(
            image,
            (x1, y1),
            (x2, y2),
            color,
            2
        )

        cv2.putText(
            image,

            (
                f"{label_prefix}"
                f"{index + 1} "
                f"{status} "
                f"{overlap * 100:.0f}%"
            ),

            (
                x1,
                max(y1 - 5, 20)
            ),

            cv2.FONT_HERSHEY_SIMPLEX,

            0.45,

            color,

            2
        )


# ============================================================
# MAIN DETECTION
# ============================================================

def run_detection(
    video_path,
    display=True,
    loop_video=False,
    duration=None,
    result_callback=None
):

    cap = cv2.VideoCapture(
        str(video_path)
    )

    if not cap.isOpened():

        print(
            f"ERROR: Could not open video: "
            f"{video_path}"
        )

        default_data = (
            get_default_data()
        )

        if result_callback is not None:

            result_callback(
                default_data.copy()
            )

        return default_data

    fps = cap.get(
        cv2.CAP_PROP_FPS
    )

    total_frames = int(
        cap.get(
            cv2.CAP_PROP_FRAME_COUNT
        )
    )

    frame_width = int(
        cap.get(
            cv2.CAP_PROP_FRAME_WIDTH
        )
    )

    frame_height = int(
        cap.get(
            cv2.CAP_PROP_FRAME_HEIGHT
        )
    )

    print()
    print("=" * 60)
    print("SMARTGS CV1 DETECTION")
    print("=" * 60)

    print(
        f"Video FPS       : "
        f"{fps:.2f}"
    )

    print(
        f"Total frames    : "
        f"{total_frames}"
    )

    print(
        f"Frame size      : "
        f"{frame_width} x {frame_height}"
    )

    print(
        f"Frame interval  : "
        f"{FRAME_INTERVAL}"
    )

    print(
        f"YOLO confidence : "
        f"{CONFIDENCE}"
    )

    print(
        f"Door 2 imgsz    : "
        f"{DOOR_2_IMGSZ}"
    )

    print(
        f"D1 calibrated seats: "
        f"{DOOR_1_SEATS}"
    )

    print(
        f"D2 calibrated seats: "
        f"{DOOR_2_SEATS}"
    )

    print(
        f"Seat threshold  : "
        f"{SEAT_OCCUPANCY_THRESHOLD * 100:.1f}%"
    )

    print(
        f"D2 interior threshold: "
        f"{DOOR_2_INTERIOR_OVERLAP_THRESHOLD * 100:.1f}%"
    )

    if fps > 0:

        print(
            f"Detection rate  : "
            f"{fps / FRAME_INTERVAL:.2f} FPS"
        )

    print("=" * 60)
    print()

    latest_data = (
        get_default_data()
    )

    door_1_seat_status = (
        [False] *
        DOOR_1_SEATS
    )

    door_2_seat_status = (
        [False] *
        DOOR_2_SEATS
    )

    door_1_seat_overlap_values = (
        [0.0] *
        DOOR_1_SEATS
    )

    door_2_seat_overlap_values = (
        [0.0] *
        DOOR_2_SEATS
    )

    if display:

        cv2.namedWindow(
            "SmartGS CV1 Detection",
            cv2.WINDOW_NORMAL
        )

        cv2.resizeWindow(
            "SmartGS CV1 Detection",
            DISPLAY_WIDTH,
            DISPLAY_HEIGHT
        )

    frame_number = 0
    start_time = time.time()

    # ========================================================
    # MAIN LOOP
    # ========================================================

    while True:

        if (
            duration is not None
            and
            time.time() - start_time
            >= duration
        ):

            break

        ret, frame = cap.read()

        if not ret:

            if loop_video:

                print(
                    "CV1 video finished. "
                    "Restarting..."
                )

                cap.set(
                    cv2.CAP_PROP_POS_FRAMES,
                    0
                )

                frame_number = 0

                continue

            break

        frame_number += 1

        process_frame = (
            frame_number %
            FRAME_INTERVAL
            ==
            0
        )

        annotated = frame.copy()

        # ====================================================
        # YOLO PROCESSING
        # ====================================================

        if process_frame:

            # ------------------------------------------------
            # FULL FRAME YOLO
            # ------------------------------------------------

            full_results = model(
                frame,
                conf=CONFIDENCE,
                classes=[PERSON_CLASS],
                verbose=False
            )

            full_detections = (
                get_boxes_from_result(
                    full_results[0],
                    "FULL"
                )
            )

            # ------------------------------------------------
            # DOOR 2 HIGH-RES YOLO
            # ------------------------------------------------

            (
                door_2_crop,
                crop_x,
                crop_y,
                crop_x2,
                crop_y2
            ) = get_door_2_crop(frame)

            if door_2_crop.size > 0:

                door_2_results = model(
                    door_2_crop,
                    conf=CONFIDENCE,
                    classes=[PERSON_CLASS],
                    imgsz=DOOR_2_IMGSZ,
                    verbose=False
                )

                door_2_detections = (
                    get_boxes_from_crop_result(
                        door_2_results[0],
                        crop_x,
                        crop_y,
                        "DOOR_2_CROP"
                    )
                )

            else:

                door_2_detections = []

            # ------------------------------------------------
            # COMBINE DETECTIONS
            # ------------------------------------------------

            combined_detections = (
                full_detections
                +
                door_2_detections
            )

            # ------------------------------------------------
            # REMOVE DUPLICATES
            # ------------------------------------------------

            combined_detections = (
                remove_duplicate_detections(
                    combined_detections,
                    DUPLICATE_IOU_THRESHOLD
                )
            )

            # =================================================
            # CLASSIFY DETECTIONS
            # =================================================

            door_1_interior_count = 0
            door_2_interior_count = 0

            for detection in (
                combined_detections
            ):

                x1, y1, x2, y2 = (
                    detection["box"]
                )

                person_box = (
                    x1,
                    y1,
                    x2,
                    y2
                )

                center_point = (

                    int(
                        (x1 + x2) / 2
                    ),

                    int(
                        (y1 + y2) / 2
                    )

                )

                region = "outside"

                # --------------------------------------------
                # DOOR 1 INTERIOR
                # --------------------------------------------

                if box_in_any_roi(
                    person_box,
                    rois["door_1_interior"],
                    INTERIOR_OVERLAP_THRESHOLD
                ):

                    region = (
                        "door_1_interior"
                    )

                    door_1_interior_count += 1

                # --------------------------------------------
                # DOOR 2 INTERIOR
                # --------------------------------------------

                elif box_in_any_roi(
                    person_box,
                    rois["door_2_interior"],
                    DOOR_2_INTERIOR_OVERLAP_THRESHOLD
                ):

                    region = (
                        "door_2_interior"
                    )

                    door_2_interior_count += 1

                # --------------------------------------------
                # DOOR 1
                # --------------------------------------------

                elif point_in_roi(
                    center_point,
                    rois["door_1"]
                ):

                    region = "door_1"

                # --------------------------------------------
                # DOOR 2
                # --------------------------------------------

                elif point_in_roi(
                    center_point,
                    rois["door_2"]
                ):

                    region = "door_2"

                detection["region"] = region

                # --------------------------------------------
                # DRAW DETECTION
                # --------------------------------------------

                if display:

                    color = (
                        (0, 255, 255)
                    )

                    cv2.rectangle(
                        annotated,
                        (x1, y1),
                        (x2, y2),
                        color,
                        2
                    )

                    cv2.circle(
                        annotated,
                        center_point,
                        5,
                        (0, 0, 255),
                        -1
                    )

                    cv2.putText(
                        annotated,
                        region,
                        (
                            x1,
                            max(
                                y1 - 10,
                                20
                            )
                        ),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        color,
                        2
                    )

            # =================================================
            # SEAT OCCUPANCY
            # =================================================

            door_1_person_detections = [

                detection

                for detection
                in combined_detections

                if detection.get(
                    "region"
                )
                ==
                "door_1_interior"

            ]

            door_2_person_detections = [

                detection

                for detection
                in combined_detections

                if detection.get(
                    "region"
                )
                ==
                "door_2_interior"

            ]

            (
                door_1_seats_available,
                door_1_seat_status,
                door_1_seat_overlap_values

            ) = get_seat_occupancy(

                door_1_person_detections,

                seat_rois["door_1"]

            )

            (
                door_2_seats_available,
                door_2_seat_status,
                door_2_seat_overlap_values

            ) = get_seat_occupancy(

                door_2_person_detections,

                seat_rois["door_2"]

            )

            # =================================================
            # SEAT AVAILABILITY
            # =================================================

            door_1_seat_availability = (

                door_1_seats_available
                /
                DOOR_1_SEATS
                *
                100

                if DOOR_1_SEATS > 0

                else 0

            )

            door_2_seat_availability = (

                door_2_seats_available
                /
                DOOR_2_SEATS
                *
                100

                if DOOR_2_SEATS > 0

                else 0

            )

            # =================================================
            # OCCUPANCY
            # =================================================

            door_1_occupancy = (

                min(

                    door_1_interior_count
                    /
                    DOOR_1_FULL_CAPACITY
                    *
                    100,

                    100

                )

                if DOOR_1_FULL_CAPACITY > 0

                else 0

            )

            door_2_occupancy = (

                min(

                    door_2_interior_count
                    /
                    DOOR_2_FULL_CAPACITY
                    *
                    100,

                    100

                )

                if DOOR_2_FULL_CAPACITY > 0

                else 0

            )

            # =================================================
            # LATEST DATA
            # =================================================

            latest_data = {

                "door_1_interior_count":
                    door_1_interior_count,

                "door_2_interior_count":
                    door_2_interior_count,

                "door_1_seats_available":
                    door_1_seats_available,

                "door_2_seats_available":
                    door_2_seats_available,

                "door_1_seat_availability":
                    door_1_seat_availability,

                "door_2_seat_availability":
                    door_2_seat_availability,

                "door_1_occupancy":
                    door_1_occupancy,

                "door_2_occupancy":
                    door_2_occupancy

            }

            # =================================================
            # TERMINAL OUTPUT
            # =================================================

            print()
            print("-" * 60)
            print("CV1 LIVE RESULT")
            print("-" * 60)

            print(
                f"Frame: "
                f"{frame_number}"
            )

            print(
                f"Total detections: "
                f"{len(combined_detections)}"
            )

            print()

            print(
                f"Door 1 occupancy: "
                f"{door_1_occupancy:.1f}%"
            )

            print(
                f"Door 1 seats: "
                f"{door_1_seats_available}/"
                f"{DOOR_1_SEATS}"
            )

            print(
                f"Door 1 seat availability: "
                f"{door_1_seat_availability:.1f}%"
            )

            print()

            print(
                f"Door 2 occupancy: "
                f"{door_2_occupancy:.1f}%"
            )

            print(
                f"Door 2 seats: "
                f"{door_2_seats_available}/"
                f"{DOOR_2_SEATS}"
            )

            print(
                f"Door 2 seat availability: "
                f"{door_2_seat_availability:.1f}%"
            )

            print()

            print(
                f"Door 1 interior people: "
                f"{door_1_interior_count}"
            )

            print(
                f"Door 2 interior people: "
                f"{door_2_interior_count}"
            )

            print()

            print(
                f"Door 1 occupied seats: "
                f"{DOOR_1_SEATS - door_1_seats_available}"
            )

            print(
                f"Door 2 occupied seats: "
                f"{DOOR_2_SEATS - door_2_seats_available}"
            )

            print("-" * 60)

            # =================================================
            # CALLBACK
            # =================================================

            if result_callback is not None:

                result_callback(
                    latest_data.copy()
                )

        # ====================================================
        # DISPLAY
        # ====================================================

        if display:

            # ------------------------------------------------
            # DOOR 1
            # ------------------------------------------------

            r = rois["door_1"]

            cv2.rectangle(
                annotated,

                (r["x"], r["y"]),

                (
                    r["x"] + r["width"],
                    r["y"] + r["height"]
                ),

                (0, 255, 0),

                4
            )

            cv2.putText(
                annotated,

                "DOOR 1",

                (
                    r["x"],
                    max(
                        r["y"] - 10,
                        20
                    )
                ),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.8,

                (0, 255, 0),

                2
            )

            # ------------------------------------------------
            # DOOR 2
            # ------------------------------------------------

            r = rois["door_2"]

            cv2.rectangle(
                annotated,

                (r["x"], r["y"]),

                (
                    r["x"] + r["width"],
                    r["y"] + r["height"]
                ),

                (0, 255, 0),

                4
            )

            cv2.putText(
                annotated,

                "DOOR 2",

                (
                    r["x"],
                    max(
                        r["y"] - 10,
                        20
                    )
                ),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.8,

                (0, 255, 0),

                2
            )

            # ------------------------------------------------
            # DOOR 1 INTERIOR ROIs
            # ------------------------------------------------

            for index, r in enumerate(
                rois["door_1_interior"],
                start=1
            ):

                cv2.rectangle(
                    annotated,

                    (r["x"], r["y"]),

                    (
                        r["x"] + r["width"],
                        r["y"] + r["height"]
                    ),

                    (255, 0, 0),

                    3
                )

                cv2.putText(
                    annotated,

                    f"D1 INT {index}",

                    (
                        r["x"],
                        r["y"] + 25
                    ),

                    cv2.FONT_HERSHEY_SIMPLEX,

                    0.6,

                    (255, 0, 0),

                    2
                )

            # ------------------------------------------------
            # DOOR 2 INTERIOR ROIs
            # ------------------------------------------------

            for index, r in enumerate(
                rois["door_2_interior"],
                start=1
            ):

                cv2.rectangle(
                    annotated,

                    (r["x"], r["y"]),

                    (
                        r["x"] + r["width"],
                        r["y"] + r["height"]
                    ),

                    (0, 165, 255),

                    3
                )

                cv2.putText(
                    annotated,

                    f"D2 INT {index}",

                    (
                        r["x"],
                        r["y"] + 25
                    ),

                    cv2.FONT_HERSHEY_SIMPLEX,

                    0.6,

                    (0, 165, 255),

                    2
                )

            # ------------------------------------------------
            # DOOR 2 HIGH-RES CROP
            # ------------------------------------------------

            (
                crop,
                crop_x,
                crop_y,
                crop_x2,
                crop_y2

            ) = get_door_2_crop(
                annotated
            )

            cv2.rectangle(
                annotated,

                (crop_x, crop_y),

                (crop_x2, crop_y2),

                (255, 0, 255),

                3
            )

            cv2.putText(
                annotated,

                "D2 HIGH-RES DETECTION AREA",

                (
                    crop_x,
                    max(
                        crop_y - 10,
                        20
                    )
                ),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.6,

                (255, 0, 255),

                2
            )

            # ------------------------------------------------
            # SEAT ROIs
            # ------------------------------------------------

            draw_seats(
                annotated,
                seat_rois["door_1"],
                door_1_seat_status,
                door_1_seat_overlap_values,
                "D1-S"
            )

            draw_seats(
                annotated,
                seat_rois["door_2"],
                door_2_seat_status,
                door_2_seat_overlap_values,
                "D2-S"
            )

            # =================================================
            # INFORMATION PANEL
            # =================================================

            cv2.rectangle(
                annotated,

                (20, 20),

                (500, 320),

                (0, 0, 0),

                -1
            )

            # ------------------------------------------------
            # DOOR 1 PANEL
            # ------------------------------------------------

            cv2.putText(
                annotated,
                "DOOR 1",
                (40, 55),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (0, 255, 0),
                2
            )

            cv2.putText(
                annotated,

                (
                    f"Incoming Occupancy: "
                    f"{latest_data['door_1_occupancy']:.1f}%"
                ),

                (40, 95),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.6,

                (255, 255, 255),

                2
            )

            cv2.putText(
                annotated,

                (
                    f"Seats Available: "
                    f"{latest_data['door_1_seats_available']}/"
                    f"{DOOR_1_SEATS}"
                ),

                (40, 130),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.6,

                (255, 255, 255),

                2
            )

            cv2.putText(
                annotated,

                (
                    f"Seat Availability: "
                    f"{latest_data['door_1_seat_availability']:.1f}%"
                ),

                (40, 160),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.6,

                (255, 255, 255),

                2
            )

            # ------------------------------------------------
            # DOOR 2 PANEL
            # ------------------------------------------------

            cv2.putText(
                annotated,
                "DOOR 2",
                (40, 205),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (0, 255, 0),
                2
            )

            cv2.putText(
                annotated,

                (
                    f"Incoming Occupancy: "
                    f"{latest_data['door_2_occupancy']:.1f}%"
                ),

                (40, 245),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.6,

                (255, 255, 255),

                2
            )

            cv2.putText(
                annotated,

                (
                    f"Seats Available: "
                    f"{latest_data['door_2_seats_available']}/"
                    f"{DOOR_2_SEATS}"
                ),

                (40, 280),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.6,

                (255, 255, 255),

                2
            )

            cv2.putText(
                annotated,

                (
                    f"Seat Availability: "
                    f"{latest_data['door_2_seat_availability']:.1f}%"
                ),

                (40, 310),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.6,

                (255, 255, 255),

                2
            )

            # =================================================
            # PROCESSING STATUS
            # =================================================

            status_text = (

                "YOLO: PROCESSING"

                if process_frame

                else

                "YOLO: HOLDING LAST RESULT"

            )

            cv2.putText(
                annotated,

                status_text,

                (520, 40),

                cv2.FONT_HERSHEY_SIMPLEX,

                0.5,

                (255, 255, 255),

                2
            )

            # =================================================
            # DISPLAY FRAME
            # =================================================

            display_frame = cv2.resize(
                annotated,
                (
                    DISPLAY_WIDTH,
                    DISPLAY_HEIGHT
                )
            )

            cv2.imshow(
                "SmartGS CV1 Detection",
                display_frame
            )

            frame_delay = (

                max(
                    1,
                    int(1000 / fps)
                )

                if fps > 0

                else 33

            )

            key = (
                cv2.waitKey(
                    frame_delay
                )
                &
                0xFF
            )

            if key == ord("q"):

                break

    # ========================================================
    # CLEANUP
    # ========================================================

    cap.release()

    if display:

        cv2.destroyAllWindows()

    return latest_data


# ============================================================
# STANDALONE
# ============================================================

if __name__ == "__main__":

    run_detection(
        VIDEO_PATH,
        display=True,
        loop_video=True
    )