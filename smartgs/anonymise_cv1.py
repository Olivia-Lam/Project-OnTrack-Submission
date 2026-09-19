import cv2
from pathlib import Path
from ultralytics import YOLO


# ============================================================
# SETTINGS
# ============================================================

INPUT_VIDEO = Path("videos/cv1/cv1_mrt.mp4")
OUTPUT_VIDEO = Path("videos/cv1/cv1_mrt_anonymised.mp4")

FACE_MODEL_PATH = "yolov8n-face.pt"
PERSON_MODEL_PATH = "yolov8s.pt"

FACE_CONFIDENCE = 0.08
PERSON_CONFIDENCE = 0.20

IMAGE_SIZE = 1600

PERSON_CLASS = 0

BLUR_SIZE = 71

# Face detection → expand to cover entire head
HEAD_EXPAND_LEFT = 0.40
HEAD_EXPAND_RIGHT = 0.40
HEAD_EXPAND_UP = 0.65
HEAD_EXPAND_DOWN = 0.40

# Person detection fallback
FALLBACK_HEAD_TOP = 0.00
FALLBACK_HEAD_BOTTOM = 0.38

MIN_PERSON_HEIGHT = 40


# ============================================================
# LOAD MODELS
# ============================================================

print("Loading YOLOv8n-Face...")

face_model = YOLO(FACE_MODEL_PATH)

print("YOLOv8n-Face loaded successfully.")

print()
print("Loading YOLOv8s person detector...")

person_model = YOLO(PERSON_MODEL_PATH)

print("YOLOv8s person detector loaded successfully.")


# ============================================================
# OPEN VIDEO
# ============================================================

cap = cv2.VideoCapture(str(INPUT_VIDEO))

if not cap.isOpened():
    print(f"ERROR: Could not open {INPUT_VIDEO}")
    exit()


# ============================================================
# VIDEO INFORMATION
# ============================================================

width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))


print()
print("=" * 60)
print("SMARTGS CV1 VIDEO ANONYMISATION")
print("=" * 60)

print(f"Input      : {INPUT_VIDEO}")
print(f"Output     : {OUTPUT_VIDEO}")
print(f"Resolution : {width} x {height}")
print(f"FPS        : {fps:.2f}")
print(f"Frames     : {total_frames}")
print()


# ============================================================
# OUTPUT
# ============================================================

OUTPUT_VIDEO.parent.mkdir(
    parents=True,
    exist_ok=True
)

fourcc = cv2.VideoWriter_fourcc(*"mp4v")

writer = cv2.VideoWriter(
    str(OUTPUT_VIDEO),
    fourcc,
    fps,
    (width, height)
)

if not writer.isOpened():
    print("ERROR: Could not create output video.")
    cap.release()
    exit()


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def calculate_iou(box_a, box_b):

    ax1, ay1, ax2, ay2 = box_a
    bx1, by1, bx2, by2 = box_b

    ix1 = max(ax1, bx1)
    iy1 = max(ay1, by1)

    ix2 = min(ax2, bx2)
    iy2 = min(ay2, by2)

    intersection_width = max(
        0,
        ix2 - ix1
    )

    intersection_height = max(
        0,
        iy2 - iy1
    )

    intersection_area = (
        intersection_width *
        intersection_height
    )

    area_a = (
        max(0, ax2 - ax1) *
        max(0, ay2 - ay1)
    )

    area_b = (
        max(0, bx2 - bx1) *
        max(0, by2 - by1)
    )

    union_area = (
        area_a +
        area_b -
        intersection_area
    )

    if union_area <= 0:
        return 0.0

    return intersection_area / union_area


def blur_region(frame, x1, y1, x2, y2):

    x1 = max(0, int(x1))
    y1 = max(0, int(y1))
    x2 = min(width, int(x2))
    y2 = min(height, int(y2))

    if x2 <= x1 or y2 <= y1:
        return False

    region = frame[
        y1:y2,
        x1:x2
    ]

    if region.size == 0:
        return False

    kernel_width = min(
        BLUR_SIZE,
        region.shape[1]
    )

    kernel_height = min(
        BLUR_SIZE,
        region.shape[0]
    )

    if kernel_width < 3 or kernel_height < 3:
        return False

    if kernel_width % 2 == 0:
        kernel_width -= 1

    if kernel_height % 2 == 0:
        kernel_height -= 1

    blurred = cv2.GaussianBlur(
        region,
        (kernel_width, kernel_height),
        0
    )

    frame[
        y1:y2,
        x1:x2
    ] = blurred

    return True


# ============================================================
# PROCESS VIDEO
# ============================================================

frame_number = 0

total_face_detections = 0
total_person_detections = 0
total_fallback_blurs = 0


while True:

    ret, frame = cap.read()

    if not ret:
        break

    frame_number += 1


    # ========================================================
    # STAGE 1 — FACE DETECTION
    # ========================================================

    face_results = face_model(
        frame,
        conf=FACE_CONFIDENCE,
        imgsz=IMAGE_SIZE,
        verbose=False
    )

    detected_faces = []

    for box in face_results[0].boxes:

        x1, y1, x2, y2 = map(
            int,
            box.xyxy[0]
        )

        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(width, x2)
        y2 = min(height, y2)

        if x2 <= x1 or y2 <= y1:
            continue

        detected_faces.append(
            (x1, y1, x2, y2)
        )

    total_face_detections += len(
        detected_faces
    )


    # ========================================================
    # STAGE 2 — PERSON DETECTION
    # ========================================================

    person_results = person_model(
        frame,
        conf=PERSON_CONFIDENCE,
        classes=[PERSON_CLASS],
        imgsz=IMAGE_SIZE,
        verbose=False
    )

    detected_people = []

    for box in person_results[0].boxes:

        x1, y1, x2, y2 = map(
            int,
            box.xyxy[0]
        )

        x1 = max(0, x1)
        y1 = max(0, y1)
        x2 = min(width, x2)
        y2 = min(height, y2)

        person_height = y2 - y1

        if person_height < MIN_PERSON_HEIGHT:
            continue

        if x2 <= x1 or y2 <= y1:
            continue

        detected_people.append(
            (x1, y1, x2, y2)
        )

    total_person_detections += len(
        detected_people
    )


    # ========================================================
    # STAGE 3 — BLUR DETECTED FACES / HEADS
    # ========================================================

    for face_box in detected_faces:

        x1, y1, x2, y2 = face_box

        face_width = x2 - x1
        face_height = y2 - y1

        head_x1 = int(
            x1 -
            face_width *
            HEAD_EXPAND_LEFT
        )

        head_y1 = int(
            y1 -
            face_height *
            HEAD_EXPAND_UP
        )

        head_x2 = int(
            x2 +
            face_width *
            HEAD_EXPAND_RIGHT
        )

        head_y2 = int(
            y2 +
            face_height *
            HEAD_EXPAND_DOWN
        )

        blur_region(
            frame,
            head_x1,
            head_y1,
            head_x2,
            head_y2
        )


    # ========================================================
    # STAGE 4 — PERSON DETECTION FALLBACK
    # ========================================================

    for person_box in detected_people:

        px1, py1, px2, py2 = person_box

        person_height = py2 - py1

        face_found = False

        for face_box in detected_faces:

            iou = calculate_iou(
                person_box,
                face_box
            )

            if iou > 0.01:

                face_found = True
                break

        if face_found:
            continue

        # Face wasn't detected.
        # Blur upper part of person as fallback.

        fallback_y1 = int(
            py1 +
            person_height *
            FALLBACK_HEAD_TOP
        )

        fallback_y2 = int(
            py1 +
            person_height *
            FALLBACK_HEAD_BOTTOM
        )

        person_width = px2 - px1

        fallback_x1 = int(
            px1 +
            person_width *
            0.15
        )

        fallback_x2 = int(
            px2 -
            person_width *
            0.15
        )

        if blur_region(
            frame,
            fallback_x1,
            fallback_y1,
            fallback_x2,
            fallback_y2
        ):

            total_fallback_blurs += 1


    # ========================================================
    # WRITE FRAME
    # ========================================================

    writer.write(frame)


    # ========================================================
    # PROGRESS
    # ========================================================

    if frame_number % 10 == 0:

        percentage = (
            frame_number /
            total_frames *
            100
        )

        print(
            f"Processing: {percentage:5.1f}% | "
            f"Faces: {len(detected_faces):2d} | "
            f"People: {len(detected_people):2d}",
            end="\r"
        )


# ============================================================
# CLEANUP
# ============================================================

cap.release()
writer.release()


print()
print()
print("=" * 60)
print("CV1 ANONYMISATION COMPLETE")
print("=" * 60)

print(f"Frames processed  : {frame_number}")
print(f"Face detections   : {total_face_detections}")
print(f"Person detections : {total_person_detections}")
print(f"Fallback blurs    : {total_fallback_blurs}")
print(f"Saved to          : {OUTPUT_VIDEO}")