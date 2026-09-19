import cv2
import json
import time
from pathlib import Path
from ultralytics import YOLO


VIDEO_PATH = Path(
    "videos/cv3/cv3_mrt_anonymised.mp4"
)

ROI_PATH = Path(
    "config/cv3_flow_roi.json"
)

MODEL_PATH = "yolov8s.pt"

CONFIDENCE = 0.20
PERSON_CLASS = 0

DISPLAY_WIDTH = 1280
DISPLAY_HEIGHT = 720

FRAME_INTERVAL = 5

FLOW_REFERENCE = 7
FLOW_REFERENCE_SCORE = 75

CROSSING_TOLERANCE = 10


# ============================================================
# LOAD FLOW LINE
# ============================================================

with open(ROI_PATH, "r") as file:
    roi_data = json.load(file)

flow_line = roi_data["flow_line"]

line_start = (
    flow_line[0]["x"],
    flow_line[0]["y"]
)

line_end = (
    flow_line[1]["x"],
    flow_line[1]["y"]
)


# ============================================================
# LOAD YOLO
# ============================================================

print("Loading YOLOv8s...")

model = YOLO(MODEL_PATH)

print("YOLOv8s loaded successfully.")


# ============================================================
# LINE FUNCTIONS
# ============================================================

def side_of_line(point, line_start, line_end):

    px, py = point

    x1, y1 = line_start
    x2, y2 = line_end

    return (
        (x2 - x1) * (py - y1)
        -
        (y2 - y1) * (px - x1)
    )


def get_line_side(point):

    value = side_of_line(
        point,
        line_start,
        line_end
    )

    if value > CROSSING_TOLERANCE:
        return 1

    elif value < -CROSSING_TOLERANCE:
        return -1

    else:
        return 0


# ============================================================
# FLOW SCORE
# ============================================================

def calculate_flow_score(crossing_count):

    score = (
        crossing_count
        /
        FLOW_REFERENCE
    ) * FLOW_REFERENCE_SCORE

    return min(score, 100)


# ============================================================
# DEFAULT DATA
# ============================================================

def get_default_data():

    return {
        "flow_crossings": 0,
        "flow_score": 0.0
    }


# ============================================================
# MAIN DETECTION FUNCTION
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
            f"ERROR: Could not open {video_path}"
        )

        return get_default_data()


    # ========================================================
    # VIDEO INFORMATION
    # ========================================================

    fps = cap.get(
        cv2.CAP_PROP_FPS
    )

    if fps <= 0:
        fps = 30


    width = int(
        cap.get(
            cv2.CAP_PROP_FRAME_WIDTH
        )
    )

    height = int(
        cap.get(
            cv2.CAP_PROP_FRAME_HEIGHT
        )
    )


    # ========================================================
    # DISPLAY DELAY
    # ========================================================
    #
    # 10 ms gives a more natural playback speed for this
    # prototype without making the video excessively slow.
    #
    # ========================================================

    frame_delay = 10


    # ========================================================
    # VARIABLES
    # ========================================================

    previous_sides = {}

    crossed_ids = set()

    crossing_count = 0

    latest_boxes = []

    latest_track_ids = []

    latest_current_people = 0

    latest_data = get_default_data()

    frame_number = 0

    start_time = time.time()


    # ========================================================
    # DISPLAY WINDOW
    # ========================================================

    if display:

        cv2.namedWindow(
            "SmartGS CV3",
            cv2.WINDOW_AUTOSIZE
        )


    # ========================================================
    # VIDEO LOOP
    # ========================================================

    while True:

        # ----------------------------------------------------
        # Duration check
        # ----------------------------------------------------

        if duration is not None:

            elapsed = (
                time.time()
                -
                start_time
            )

            if elapsed >= duration:
                break


        # ----------------------------------------------------
        # Read frame
        # ----------------------------------------------------

        ret, frame = cap.read()


        # ----------------------------------------------------
        # End of video
        # ----------------------------------------------------

        if not ret:

            if loop_video:

                cap.set(
                    cv2.CAP_PROP_POS_FRAMES,
                    0
                )

                previous_sides = {}

                crossed_ids = set()

                crossing_count = 0

                frame_number = 0

                continue

            else:

                break


        frame_number += 1


        # ====================================================
        # RUN YOLO EVERY N FRAMES
        # ====================================================

        process_frame = (
            frame_number % FRAME_INTERVAL == 0
        )


        if process_frame:

            results = model.track(
                frame,
                conf=CONFIDENCE,
                classes=[PERSON_CLASS],
                persist=True,
                verbose=False
            )


            boxes = []

            track_ids = []


            # ------------------------------------------------
            # Check detections
            # ------------------------------------------------

            if (
                results
                and
                results[0].boxes is not None
                and
                results[0].boxes.id is not None
            ):

                detected_boxes = (
                    results[0]
                    .boxes
                    .xyxy
                    .cpu()
                    .numpy()
                )

                detected_ids = (
                    results[0]
                    .boxes
                    .id
                    .cpu()
                    .numpy()
                    .astype(int)
                )


                # --------------------------------------------
                # Store detections
                # --------------------------------------------

                for box, track_id in zip(
                    detected_boxes,
                    detected_ids
                ):

                    x1, y1, x2, y2 = map(
                        int,
                        box
                    )

                    boxes.append(
                        (
                            x1,
                            y1,
                            x2,
                            y2
                        )
                    )

                    track_ids.append(
                        track_id
                    )


                    # ----------------------------------------
                    # Bottom-centre point
                    # ----------------------------------------

                    centre_x = int(
                        (x1 + x2) / 2
                    )

                    bottom_y = y2

                    current_point = (
                        centre_x,
                        bottom_y
                    )


                    # ----------------------------------------
                    # Determine which side of the line
                    # the person is currently on
                    # ----------------------------------------

                    current_side = get_line_side(
                        current_point
                    )


                    # ----------------------------------------
                    # Check whether they crossed the line
                    # ----------------------------------------

                    if track_id in previous_sides:

                        previous_side = (
                            previous_sides[
                                track_id
                            ]
                        )


                        if (
                            previous_side != 0
                            and
                            current_side != 0
                        ):

                            crossed = (
                                previous_side
                                !=
                                current_side
                            )


                            if crossed:

                                if (
                                    track_id
                                    not in crossed_ids
                                ):

                                    crossing_count += 1

                                    crossed_ids.add(
                                        track_id
                                    )


                    # ----------------------------------------
                    # Update person's current side
                    # ----------------------------------------

                    previous_sides[
                        track_id
                    ] = current_side


            # ------------------------------------------------
            # Save latest detections
            # ------------------------------------------------

            latest_boxes = boxes

            latest_track_ids = track_ids

            latest_current_people = len(
                boxes
            )


            # =================================================
            # CALCULATE FLOW SCORE
            # =================================================

            flow_score = calculate_flow_score(
                crossing_count
            )


            latest_data = {

                "flow_crossings":
                    crossing_count,

                "flow_score":
                    flow_score

            }


            # =================================================
            # CALLBACK
            # =================================================

            if result_callback is not None:

                result_callback(
                    latest_data.copy()
                )


        # ====================================================
        # DRAW ANNOTATED FRAME
        # ====================================================

        annotated = frame.copy()


        # ----------------------------------------------------
        # Draw flow line
        # ----------------------------------------------------

        cv2.line(
            annotated,
            line_start,
            line_end,
            (0, 255, 255),
            4
        )


        # ----------------------------------------------------
        # Draw latest tracked people
        # ----------------------------------------------------

        for track_id, box in zip(
            latest_track_ids,
            latest_boxes
        ):

            x1, y1, x2, y2 = box


            cv2.rectangle(
                annotated,
                (x1, y1),
                (x2, y2),
                (0, 255, 0),
                2
            )


            cv2.putText(
                annotated,
                f"ID {track_id}",
                (x1, y1 - 10),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.6,
                (0, 255, 0),
                2
            )


        # ====================================================
        # DISPLAY INFORMATION
        # ====================================================

        cv2.rectangle(
            annotated,
            (20, 20),
            (400, 110),
            (0, 0, 0),
            -1
        )


        cv2.putText(
            annotated,
            f"Flow crossings: {crossing_count}",
            (35, 55),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2
        )


        cv2.putText(
            annotated,
            f"Flow score: {latest_data['flow_score']:.1f}",
            (35, 90),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2
        )


        # ====================================================
        # DISPLAY
        # ====================================================

        if display:

            scale = (
                DISPLAY_WIDTH
                /
                annotated.shape[1]
            )

            display_height = int(
                annotated.shape[0]
                *
                scale
            )


            display_frame = cv2.resize(
                annotated,
                (
                    DISPLAY_WIDTH,
                    display_height
                ),
                interpolation=cv2.INTER_AREA
            )


            cv2.imshow(
                "SmartGS CV3",
                display_frame
            )


            # ------------------------------------------------
            # Playback speed
            # ------------------------------------------------

            key = cv2.waitKey(
                frame_delay
            ) & 0xFF


            if key == ord("q"):

                break


    # ========================================================
    # CLEANUP
    # ========================================================

    cap.release()

    cv2.destroyAllWindows()


    return latest_data


# ============================================================
# STANDALONE TEST
# ============================================================

if __name__ == "__main__":

    final_data = run_detection(
        VIDEO_PATH,
        display=True,
        loop_video=True,
        duration=None
    )


    print()

    print("=" * 60)

    print("CV3 FINAL RESULT")

    print("=" * 60)


    print(
        f"Flow crossings: "
        f"{final_data['flow_crossings']}"
    )

    print(
        f"Flow score: "
        f"{final_data['flow_score']:.1f}"
    )