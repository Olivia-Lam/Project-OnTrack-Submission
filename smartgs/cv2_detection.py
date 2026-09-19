import cv2
import json
import time
from pathlib import Path
from ultralytics import YOLO


# ============================================================
# SETTINGS
# ============================================================

VIDEO_PATH = Path("videos/cv2/cv2_mrt_anonymised.mp4")
ROI_PATH = Path("config/cv2_rois.json")
SEAT_PATH = Path("config/cv2_seats.json")

MODEL_PATH = "yolov8s.pt"
CONFIDENCE = 0.10
PERSON_CLASS = 0

DISPLAY_WIDTH = 1280
DISPLAY_HEIGHT = 720

FRAME_INTERVAL = 5

DOOR_4_IMGSZ = 1280
DOOR_4_CROP_PADDING = 20
DUPLICATE_IOU_THRESHOLD = 0.40

SEAT_OCCUPANCY_THRESHOLD = 0.15

FULL_CAPACITY = 100
INTERIOR_OVERLAP_THRESHOLD = 0.15


# ============================================================
# LOAD CONFIG
# ============================================================

with open(ROI_PATH, "r") as file:
    rois = json.load(file)

with open(SEAT_PATH, "r") as file:
    seat_rois = json.load(file)


DOOR_3_SEATS = len(seat_rois["door_3"])
DOOR_4_SEATS = len(seat_rois["door_4"])

TOTAL_CALIBRATED_SEATS = DOOR_3_SEATS + DOOR_4_SEATS

if TOTAL_CALIBRATED_SEATS > 0:
    DOOR_3_FULL_CAPACITY = round(
        FULL_CAPACITY * DOOR_3_SEATS / TOTAL_CALIBRATED_SEATS
    )
else:
    DOOR_3_FULL_CAPACITY = 0

DOOR_4_FULL_CAPACITY = FULL_CAPACITY - DOOR_3_FULL_CAPACITY


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
print(f"Door 3 seats: {DOOR_3_SEATS}")
print(f"Door 4 seats: {DOOR_4_SEATS}")
print(f"Total seats: {TOTAL_CALIBRATED_SEATS}")
print(f"Door 3 full capacity: {DOOR_3_FULL_CAPACITY}")
print(f"Door 4 full capacity: {DOOR_4_FULL_CAPACITY}")
print(f"Seat overlap threshold: {SEAT_OCCUPANCY_THRESHOLD * 100:.1f}%")
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

    intersection = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    box_area = max(0, x2 - x1) * max(0, y2 - y1)

    if box_area <= 0:
        return 0.0

    return intersection / box_area


def box_in_any_roi(box, roi_list):
    return any(
        box_overlap_ratio(box, roi) >= INTERIOR_OVERLAP_THRESHOLD
        for roi in roi_list
    )


def seat_overlap_ratio(person_box, seat):
    x1, y1, x2, y2 = person_box

    sx1 = seat["x"]
    sy1 = seat["y"]
    sx2 = sx1 + seat["width"]
    sy2 = sy1 + seat["height"]

    ix1 = max(x1, sx1)
    iy1 = max(y1, sy1)
    ix2 = min(x2, sx2)
    iy2 = min(y2, sy2)

    intersection = max(0, ix2 - ix1) * max(0, iy2 - iy1)

    seat_area = seat["width"] * seat["height"]

    if seat_area <= 0:
        return 0.0

    return intersection / seat_area


def box_iou(box_a, box_b):
    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)
    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    intersection = max(0, ix2 - ix1) * max(0, iy2 - iy1)

    area_a = max(0, ax2 - ax1) * max(0, ay2 - ay1)
    area_b = max(0, bx2 - bx1) * max(0, by2 - by1)

    union = area_a + area_b - intersection

    if union <= 0:
        return 0.0

    return intersection / union


# ============================================================
# DOOR 4 CROP
# ============================================================

def get_door_4_crop_bounds(frame_width, frame_height):
    d4_rois = rois["door_4_interior"]

    min_x = min(roi["x"] for roi in d4_rois)
    min_y = min(roi["y"] for roi in d4_rois)

    max_x = max(
        roi["x"] + roi["width"]
        for roi in d4_rois
    )

    max_y = max(
        roi["y"] + roi["height"]
        for roi in d4_rois
    )

    return (
        max(0, min_x - DOOR_4_CROP_PADDING),
        max(0, min_y - DOOR_4_CROP_PADDING),
        min(frame_width, max_x + DOOR_4_CROP_PADDING),
        min(frame_height, max_y + DOOR_4_CROP_PADDING)
    )


# ============================================================
# RESULT HELPERS
# ============================================================

def get_default_data():
    return {
        "door_3_interior_count": 0,
        "door_4_interior_count": 0,
        "door_3_seats_available": DOOR_3_SEATS,
        "door_4_seats_available": DOOR_4_SEATS,
        "door_3_seat_availability": 100.0,
        "door_4_seat_availability": 100.0,
        "door_3_occupancy": 0.0,
        "door_4_occupancy": 0.0,
    }


def get_boxes_from_result(result, source="FULL"):
    detections = []

    for box in result.boxes:
        x1, y1, x2, y2 = map(int, box.xyxy[0])

        detections.append({
            "box": (x1, y1, x2, y2),
            "confidence": float(box.conf[0]),
            "source": source,
        })

    return detections


# ============================================================
# SEAT OCCUPANCY
# ============================================================

def get_seat_occupancy(person_detections, seat_list):
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

        occupied = maximum_overlap >= SEAT_OCCUPANCY_THRESHOLD

        if occupied:
            occupied_seats += 1

        seat_status.append(occupied)
        seat_overlap_values.append(maximum_overlap)

    available_seats = len(seat_list) - occupied_seats

    return (
        available_seats,
        seat_status,
        seat_overlap_values
    )


def draw_seats(
    image,
    seat_list,
    seat_status,
    seat_overlap_values,
    label_prefix
):
    for index, seat in enumerate(seat_list):
        occupied = seat_status[index]
        overlap = seat_overlap_values[index]

        color = (0, 0, 255) if occupied else (0, 255, 0)
        status = "OCC" if occupied else "FREE"

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
            f"{label_prefix}{index + 1} {status} {overlap * 100:.0f}%",
            (x1, max(y1 - 5, 20)),
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
    cap = cv2.VideoCapture(str(video_path))

    if not cap.isOpened():
        print(f"ERROR: Could not open video: {video_path}")

        default_data = get_default_data()

        if result_callback is not None:
            result_callback(default_data.copy())

        return default_data

    fps = cap.get(cv2.CAP_PROP_FPS)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    frame_width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    frame_height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

    print()
    print("=" * 60)
    print("SMARTGS CV2 DETECTION")
    print("=" * 60)
    print(f"Video FPS       : {fps:.2f}")
    print(f"Total frames    : {total_frames}")
    print(f"Frame size      : {frame_width} x {frame_height}")
    print(f"Frame interval  : {FRAME_INTERVAL}")
    print(f"YOLO confidence : {CONFIDENCE}")
    print(f"D4 YOLO size    : {DOOR_4_IMGSZ}")
    print(f"D3 calibrated seats: {DOOR_3_SEATS}")
    print(f"D4 calibrated seats: {DOOR_4_SEATS}")
    print(f"Seat threshold  : {SEAT_OCCUPANCY_THRESHOLD * 100:.1f}%")

    if fps > 0:
        print(f"Detection rate  : {fps / FRAME_INTERVAL:.2f} FPS")

    print("=" * 60)
    print()

    (
        door_4_crop_x1,
        door_4_crop_y1,
        door_4_crop_x2,
        door_4_crop_y2
    ) = get_door_4_crop_bounds(
        frame_width,
        frame_height
    )

    print("Door 4 high-resolution crop:")
    print(
        f"X: {door_4_crop_x1} -> "
        f"{door_4_crop_x2}"
    )
    print(
        f"Y: {door_4_crop_y1} -> "
        f"{door_4_crop_y2}"
    )
    print()

    latest_data = get_default_data()

    door_3_seat_status = [False] * DOOR_3_SEATS
    door_4_seat_status = [False] * DOOR_4_SEATS

    door_3_seat_overlap_values = [0.0] * DOOR_3_SEATS
    door_4_seat_overlap_values = [0.0] * DOOR_4_SEATS

    if display:
        cv2.namedWindow(
            "SmartGS CV2 Detection",
            cv2.WINDOW_NORMAL
        )

        cv2.resizeWindow(
            "SmartGS CV2 Detection",
            DISPLAY_WIDTH,
            DISPLAY_HEIGHT
        )

    frame_number = 0
    start_time = time.time()

    while True:

        if (
            duration is not None
            and time.time() - start_time >= duration
        ):
            break

        ret, frame = cap.read()

        if not ret:
            if loop_video:
                print("CV2 video finished. Restarting...")

                cap.set(
                    cv2.CAP_PROP_POS_FRAMES,
                    0
                )

                frame_number = 0
                continue

            break

        frame_number += 1

        process_frame = (
            frame_number % FRAME_INTERVAL == 0
        )

        annotated = frame.copy()

        # ====================================================
        # YOLO PROCESSING
        # ====================================================

        if process_frame:

            # ------------------------------------------------
            # FULL FRAME
            # ------------------------------------------------

            full_results = model(
                frame,
                conf=CONFIDENCE,
                classes=[PERSON_CLASS],
                verbose=False
            )

            full_detections = get_boxes_from_result(
                full_results[0],
                "FULL"
            )

            # ------------------------------------------------
            # DOOR 4 HIGH-RES CROP
            # ------------------------------------------------

            door_4_crop = frame[
                door_4_crop_y1:door_4_crop_y2,
                door_4_crop_x1:door_4_crop_x2
            ]

            door_4_detections = []

            if door_4_crop.size > 0:

                d4_results = model(
                    door_4_crop,
                    conf=CONFIDENCE,
                    classes=[PERSON_CLASS],
                    imgsz=DOOR_4_IMGSZ,
                    verbose=False
                )

                d4_crop_detections = get_boxes_from_result(
                    d4_results[0],
                    "D4-HIGH-RES"
                )

                for detection in d4_crop_detections:
                    x1, y1, x2, y2 = detection["box"]

                    door_4_detections.append({
                        "box": (
                            x1 + door_4_crop_x1,
                            y1 + door_4_crop_y1,
                            x2 + door_4_crop_x1,
                            y2 + door_4_crop_y1
                        ),
                        "confidence": detection["confidence"],
                        "source": "D4-HIGH-RES"
                    })

            # ------------------------------------------------
            # COMBINE DETECTIONS
            # ------------------------------------------------

            combined_detections = full_detections.copy()

            for d4_detection in door_4_detections:
                duplicate = any(
                    box_iou(
                        d4_detection["box"],
                        existing["box"]
                    ) >= DUPLICATE_IOU_THRESHOLD
                    for existing in combined_detections
                )

                if not duplicate:
                    combined_detections.append(d4_detection)

            # ------------------------------------------------
            # CLASSIFY DETECTIONS
            # ------------------------------------------------

            door_3_interior_count = 0
            door_4_interior_count = 0

            for detection in combined_detections:
                x1, y1, x2, y2 = detection["box"]

                person_box = (x1, y1, x2, y2)

                center_point = (
                    int((x1 + x2) / 2),
                    int((y1 + y2) / 2)
                )

                region = "outside"

                if box_in_any_roi(
                    person_box,
                    rois["door_3_interior"]
                ):
                    region = "door_3_interior"
                    door_3_interior_count += 1

                elif box_in_any_roi(
                    person_box,
                    rois["door_4_interior"]
                ):
                    region = "door_4_interior"
                    door_4_interior_count += 1

                elif point_in_roi(
                    center_point,
                    rois["door_3"]
                ):
                    region = "door_3"

                elif point_in_roi(
                    center_point,
                    rois["door_4"]
                ):
                    region = "door_4"

                detection["region"] = region

                if display:
                    color = (
                        (255, 0, 255)
                        if detection["source"] == "D4-HIGH-RES"
                        else (0, 255, 255)
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
                        (x1, max(y1 - 10, 20)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.65,
                        color,
                        2
                    )

            # ------------------------------------------------
            # SEAT OCCUPANCY
            # ------------------------------------------------

            (
                door_3_seats_available,
                door_3_seat_status,
                door_3_seat_overlap_values
            ) = get_seat_occupancy(
                combined_detections,
                seat_rois["door_3"]
            )

            (
                door_4_seats_available,
                door_4_seat_status,
                door_4_seat_overlap_values
            ) = get_seat_occupancy(
                combined_detections,
                seat_rois["door_4"]
            )

            door_3_seat_availability = (
                door_3_seats_available / DOOR_3_SEATS * 100
                if DOOR_3_SEATS > 0
                else 0
            )

            door_4_seat_availability = (
                door_4_seats_available / DOOR_4_SEATS * 100
                if DOOR_4_SEATS > 0
                else 0
            )

            # ------------------------------------------------
            # OCCUPANCY
            # ------------------------------------------------

            door_3_occupancy = (
                min(
                    door_3_interior_count
                    / DOOR_3_FULL_CAPACITY
                    * 100,
                    100
                )
                if DOOR_3_FULL_CAPACITY > 0
                else 0
            )

            door_4_occupancy = (
                min(
                    door_4_interior_count
                    / DOOR_4_FULL_CAPACITY
                    * 100,
                    100
                )
                if DOOR_4_FULL_CAPACITY > 0
                else 0
            )

            latest_data = {
                "door_3_interior_count": door_3_interior_count,
                "door_4_interior_count": door_4_interior_count,
                "door_3_seats_available": door_3_seats_available,
                "door_4_seats_available": door_4_seats_available,
                "door_3_seat_availability": door_3_seat_availability,
                "door_4_seat_availability": door_4_seat_availability,
                "door_3_occupancy": door_3_occupancy,
                "door_4_occupancy": door_4_occupancy
            }

            # ------------------------------------------------
            # TERMINAL OUTPUT
            # ------------------------------------------------

            print()
            print("-" * 60)
            print("CV2 LIVE RESULT")
            print("-" * 60)

            print(f"Frame: {frame_number}")
            print(f"Total detections: {len(combined_detections)}")
            print(
                f"D4 high-res detections: "
                f"{len(door_4_detections)}"
            )

            print()

            print(
                f"Door 3 occupancy: "
                f"{door_3_occupancy:.1f}%"
            )

            print(
                f"Door 3 seats: "
                f"{door_3_seats_available}/{DOOR_3_SEATS}"
            )

            print(
                f"Door 3 seat availability: "
                f"{door_3_seat_availability:.1f}%"
            )

            print()

            print(
                f"Door 4 occupancy: "
                f"{door_4_occupancy:.1f}%"
            )

            print(
                f"Door 4 seats: "
                f"{door_4_seats_available}/{DOOR_4_SEATS}"
            )

            print(
                f"Door 4 seat availability: "
                f"{door_4_seat_availability:.1f}%"
            )

            print()

            print(
                f"Door 3 interior people: "
                f"{door_3_interior_count}"
            )

            print(
                f"Door 4 interior people: "
                f"{door_4_interior_count}"
            )

            print()

            print(
                f"Door 3 occupied seats: "
                f"{DOOR_3_SEATS - door_3_seats_available}"
            )

            print(
                f"Door 4 occupied seats: "
                f"{DOOR_4_SEATS - door_4_seats_available}"
            )

            print("-" * 60)

            if result_callback is not None:
                result_callback(latest_data.copy())

        # ====================================================
        # DISPLAY
        # ====================================================

        if display:

            # Door 3
            r = rois["door_3"]

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
                "DOOR 3",
                (r["x"], max(r["y"] - 10, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 0),
                2
            )

            # Door 4
            r = rois["door_4"]

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
                "DOOR 4",
                (r["x"], max(r["y"] - 10, 20)),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.8,
                (0, 255, 0),
                2
            )

            # Interior ROIs
            for index, r in enumerate(
                rois["door_3_interior"],
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
                    f"D3 INT {index}",
                    (r["x"], r["y"] + 25),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (255, 0, 0),
                    2
                )

            for index, r in enumerate(
                rois["door_4_interior"],
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
                    f"D4 INT {index}",
                    (r["x"], r["y"] + 25),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.6,
                    (0, 165, 255),
                    2
                )

            # Seat ROIs
            draw_seats(
                annotated,
                seat_rois["door_3"],
                door_3_seat_status,
                door_3_seat_overlap_values,
                "D3-S"
            )

            draw_seats(
                annotated,
                seat_rois["door_4"],
                door_4_seat_status,
                door_4_seat_overlap_values,
                "D4-S"
            )

            # D4 high-resolution crop
            cv2.rectangle(
                annotated,
                (
                    door_4_crop_x1,
                    door_4_crop_y1
                ),
                (
                    door_4_crop_x2,
                    door_4_crop_y2
                ),
                (255, 0, 255),
                2
            )

            cv2.putText(
                annotated,
                "D4 HIGH-RES YOLO",
                (
                    door_4_crop_x1,
                    max(door_4_crop_y1 - 10, 20)
                ),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 0, 255),
                2
            )

            # Information panel
            cv2.rectangle(
                annotated,
                (20, 20),
                (500, 320),
                (0, 0, 0),
                -1
            )

            cv2.putText(
                annotated,
                "DOOR 3",
                (40, 55),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (0, 255, 0),
                2
            )

            cv2.putText(
                annotated,
                f"Incoming Occupancy: "
                f"{latest_data['door_3_occupancy']:.1f}%",
                (40, 95),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

            cv2.putText(
                annotated,
                f"Seats Available: "
                f"{latest_data['door_3_seats_available']}/"
                f"{DOOR_3_SEATS}",
                (40, 130),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

            cv2.putText(
                annotated,
                f"Seat Availability: "
                f"{latest_data['door_3_seat_availability']:.1f}%",
                (40, 160),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

            cv2.putText(
                annotated,
                "DOOR 4",
                (40, 205),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (0, 255, 0),
                2
            )

            cv2.putText(
                annotated,
                f"Incoming Occupancy: "
                f"{latest_data['door_4_occupancy']:.1f}%",
                (40, 245),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

            cv2.putText(
                annotated,
                f"Seats Available: "
                f"{latest_data['door_4_seats_available']}/"
                f"{DOOR_4_SEATS}",
                (40, 280),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

            cv2.putText(
                annotated,
                f"Seat Availability: "
                f"{latest_data['door_4_seat_availability']:.1f}%",
                (40, 310),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (255, 255, 255),
                2
            )

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

            display_frame = cv2.resize(
                annotated,
                (DISPLAY_WIDTH, DISPLAY_HEIGHT)
            )

            cv2.imshow(
                "SmartGS CV2 Detection",
                display_frame
            )

            frame_delay = (
                max(1, int(1000 / fps))
                if fps > 0
                else 33
            )

            key = cv2.waitKey(frame_delay) & 0xFF

            if key == ord("q"):
                break

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