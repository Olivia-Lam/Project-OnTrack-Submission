import cv2
import json
from pathlib import Path
from ultralytics import YOLO


# ============================================================
# SETTINGS
# ============================================================

VIDEO_PATH = Path(
    "videos/cv4/cv4_mrt_anonymised.mp4"
)

ROI_PATH = Path(
    "config/cv4_rois.json"
)

MODEL_PATH = "yolov8s.pt"

CONFIDENCE = 0.20

PERSON_CLASS = 0

DISPLAY_WIDTH = 1280


# ============================================================
# FRAME SAMPLING
# ============================================================

FRAME_INTERVAL = 5


# ============================================================
# CAPACITY
# ============================================================

BOARDING_CAPACITY = 30


# ============================================================
# LOAD ROIs
# ============================================================

with open(
    ROI_PATH,
    "r"
) as file:

    rois = json.load(file)


# ============================================================
# LOAD MODEL
# ============================================================

print(
    "Loading YOLOv8s for CV4..."
)

model = YOLO(
    MODEL_PATH
)

print(
    "YOLOv8s CV4 loaded successfully."
)


# ============================================================
# DEFAULT DATA
# ============================================================

def get_default_data():

    return {

        "door_1_boarding":
            0,

        "door_1_boarding_score":
            0.0,

        "door_1_crowd_level":
            "LOW",

        "door_1_disembark":
            0,

        "door_2_boarding":
            0,

        "door_2_boarding_score":
            0.0,

        "door_2_crowd_level":
            "LOW",

        "door_2_disembark":
            0
    }


# ============================================================
# LATEST DATA
# ============================================================

latest_data = get_default_data()


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def point_inside_rectangle(
    x,
    y,
    roi
):

    return (
        roi["x"] <= x <= roi["x"] + roi["width"]
        and
        roi["y"] <= y <= roi["y"] + roi["height"]
    )


def classify_person(
    x,
    y
):

    for zone_name, roi in rois.items():

        if point_inside_rectangle(
            x,
            y,
            roi
        ):

            return zone_name

    return None


# ============================================================
# CROWD LEVEL
# ============================================================

def get_crowd_level(
    people_count
):

    if people_count > 20:

        return "OVERCROWDED"

    elif people_count > 10:

        return "CROWDED"

    elif people_count > 5:

        return "MODERATE"

    else:

        return "LOW"


# ============================================================
# BOARDING SCORE
# ============================================================

def calculate_boarding_score(
    people_count
):

    score = (
        people_count
        /
        BOARDING_CAPACITY
    ) * 100

    return min(
        score,
        100
    )


# ============================================================
# GET LATEST RESULT
# ============================================================

def get_latest_result():

    return latest_data.copy()


# ============================================================
# DETECTION FUNCTION
# ============================================================

def run_detection(
    video_path=VIDEO_PATH,
    display=True,
    loop_video=True,
    duration=None,
    result_callback=None
):

    global latest_data


    # ========================================================
    # OPEN VIDEO
    # ========================================================

    cap = cv2.VideoCapture(
        str(video_path)
    )


    if not cap.isOpened():

        print(
            f"ERROR: Could not open video: {video_path}"
        )

        latest_data = get_default_data()


        if result_callback is not None:

            result_callback(
                latest_data.copy()
            )


        return latest_data


    # ========================================================
    # VIDEO INFORMATION
    # ========================================================

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

    fps = cap.get(
        cv2.CAP_PROP_FPS
    )

    total_frames = int(
        cap.get(
            cv2.CAP_PROP_FRAME_COUNT
        )
    )


    print()
    print(
        "=" * 60
    )

    print(
        "SMARTGS CV4 BOARDING ZONE DETECTION"
    )

    print(
        "=" * 60
    )

    print(
        f"Resolution     : "
        f"{width} x {height}"
    )

    print(
        f"Video FPS      : "
        f"{fps:.2f}"
    )

    print(
        f"Total frames   : "
        f"{total_frames}"
    )

    print(
        f"Frame interval : "
        f"{FRAME_INTERVAL}"
    )

    if fps > 0:

        print(
            f"Detection rate : "
            f"{fps / FRAME_INTERVAL:.2f} FPS"
        )

    print()

    print(
        "Door 1: Left + Right boarding zones"
    )

    print(
        "Door 2: Left + Right boarding zones"
    )

    print(
        "Disembarking zones excluded from boarding counts."
    )

    print()


    # ========================================================
    # DETECTION VARIABLES
    # ========================================================

    door_1_left = []
    door_1_disembark = []
    door_1_right = []

    door_2_left = []
    door_2_disembark = []
    door_2_right = []

    outside = []


    door_1_left_count = 0
    door_1_disembark_count = 0
    door_1_right_count = 0

    door_2_left_count = 0
    door_2_disembark_count = 0
    door_2_right_count = 0


    door_1_boarding = 0
    door_2_boarding = 0

    door_1_boarding_score = 0.0
    door_2_boarding_score = 0.0

    door_1_crowd_level = "LOW"
    door_2_crowd_level = "LOW"


    # ========================================================
    # RESET LATEST DATA
    # ========================================================

    latest_data = get_default_data()


    # ========================================================
    # DISPLAY WINDOW
    # ========================================================

    if display:

        cv2.namedWindow(
            "SmartGS CV4",
            cv2.WINDOW_NORMAL
        )


    # ========================================================
    # FRAME COUNTER
    # ========================================================

    frame_number = 0


    # ========================================================
    # TIMER
    # ========================================================

    import time

    start_time = time.time()


    # ========================================================
    # MAIN LOOP
    # ========================================================

    while True:


        # ====================================================
        # OPTIONAL DURATION
        # ====================================================

        if (
            duration is not None
            and
            time.time() - start_time >= duration
        ):

            break


        # ====================================================
        # READ FRAME
        # ====================================================

        ret, frame = cap.read()


        # ====================================================
        # END OF VIDEO
        # ====================================================

        if not ret:

            if loop_video:

                print(
                    "CV4 video finished. Restarting..."
                )


                cap.set(
                    cv2.CAP_PROP_POS_FRAMES,
                    0
                )


                frame_number = 0


                # Reset display detection data

                door_1_left = []
                door_1_disembark = []
                door_1_right = []

                door_2_left = []
                door_2_disembark = []
                door_2_right = []

                outside = []


                door_1_left_count = 0
                door_1_disembark_count = 0
                door_1_right_count = 0

                door_2_left_count = 0
                door_2_disembark_count = 0
                door_2_right_count = 0


                door_1_boarding = 0
                door_2_boarding = 0

                door_1_boarding_score = 0.0
                door_2_boarding_score = 0.0

                door_1_crowd_level = "LOW"
                door_2_crowd_level = "LOW"


                latest_data = get_default_data()


                if result_callback is not None:

                    result_callback(
                        latest_data.copy()
                    )


                continue


            break


        # ====================================================
        # FRAME NUMBER
        # ====================================================

        frame_number += 1


        # ====================================================
        # FRAME SAMPLING
        # ====================================================

        process_frame = (
            frame_number % FRAME_INTERVAL == 0
        )


        # ====================================================
        # PROCESS FRAME
        # ====================================================

        if process_frame:


            # =================================================
            # YOLO DETECTION
            # =================================================

            results = model(
                frame,
                conf=CONFIDENCE,
                classes=[PERSON_CLASS],
                verbose=False
            )


            # =================================================
            # RESET LISTS
            # =================================================

            door_1_left = []
            door_1_disembark = []
            door_1_right = []

            door_2_left = []
            door_2_disembark = []
            door_2_right = []

            outside = []


            # =================================================
            # CLASSIFY PEOPLE
            # =================================================

            for box in results[0].boxes:


                x1, y1, x2, y2 = map(
                    int,
                    box.xyxy[0]
                )


                # ---------------------------------------------
                # BOTTOM-CENTRE POINT
                # ---------------------------------------------

                centre_x = int(
                    (x1 + x2) / 2
                )

                bottom_y = y2


                zone = classify_person(
                    centre_x,
                    bottom_y
                )


                person_box = (
                    x1,
                    y1,
                    x2,
                    y2
                )


                # ---------------------------------------------
                # ZONE CLASSIFICATION
                # ---------------------------------------------

                if zone == "door_1_left":

                    door_1_left.append(
                        person_box
                    )

                elif zone == "door_1_disembark":

                    door_1_disembark.append(
                        person_box
                    )

                elif zone == "door_1_right":

                    door_1_right.append(
                        person_box
                    )

                elif zone == "door_2_left":

                    door_2_left.append(
                        person_box
                    )

                elif zone == "door_2_disembark":

                    door_2_disembark.append(
                        person_box
                    )

                elif zone == "door_2_right":

                    door_2_right.append(
                        person_box
                    )

                else:

                    outside.append(
                        person_box
                    )


            # =================================================
            # COUNTS
            # =================================================

            door_1_left_count = len(
                door_1_left
            )

            door_1_disembark_count = len(
                door_1_disembark
            )

            door_1_right_count = len(
                door_1_right
            )


            door_2_left_count = len(
                door_2_left
            )

            door_2_disembark_count = len(
                door_2_disembark
            )

            door_2_right_count = len(
                door_2_right
            )


            # =================================================
            # BOARDING COUNTS
            # =================================================

            door_1_boarding = (
                door_1_left_count
                +
                door_1_right_count
            )


            door_2_boarding = (
                door_2_left_count
                +
                door_2_right_count
            )


            # =================================================
            # CROWD LEVEL
            # =================================================

            door_1_crowd_level = get_crowd_level(
                door_1_boarding
            )


            door_2_crowd_level = get_crowd_level(
                door_2_boarding
            )


            # =================================================
            # BOARDING SCORES
            # =================================================

            door_1_boarding_score = calculate_boarding_score(
                door_1_boarding
            )


            door_2_boarding_score = calculate_boarding_score(
                door_2_boarding
            )


            # =================================================
            # UPDATE LATEST DATA
            # =================================================

            latest_data = {

                "door_1_boarding":
                    door_1_boarding,

                "door_1_boarding_score":
                    door_1_boarding_score,

                "door_1_crowd_level":
                    door_1_crowd_level,

                "door_1_disembark":
                    door_1_disembark_count,

                "door_2_boarding":
                    door_2_boarding,

                "door_2_boarding_score":
                    door_2_boarding_score,

                "door_2_crowd_level":
                    door_2_crowd_level,

                "door_2_disembark":
                    door_2_disembark_count
            }


            # =================================================
            # LIVE CONSOLE OUTPUT
            # =================================================

            print()
            print(
                "-" * 60
            )

            print(
                "CV4 LIVE RESULT"
            )

            print(
                f"Frame: {frame_number}"
            )

            print()

            print(
                f"Door 1 boarding: "
                f"{door_1_boarding}"
            )

            print(
                f"Door 1 boarding score: "
                f"{door_1_boarding_score:.1f}"
            )

            print(
                f"Door 1 crowd level: "
                f"{door_1_crowd_level}"
            )

            print(
                f"Door 1 disembark: "
                f"{door_1_disembark_count}"
            )

            print()

            print(
                f"Door 2 boarding: "
                f"{door_2_boarding}"
            )

            print(
                f"Door 2 boarding score: "
                f"{door_2_boarding_score:.1f}"
            )

            print(
                f"Door 2 crowd level: "
                f"{door_2_crowd_level}"
            )

            print(
                f"Door 2 disembark: "
                f"{door_2_disembark_count}"
            )

            print(
                "-" * 60
            )


            # =================================================
            # SEND RESULT TO PREDICTION ENGINE
            # =================================================

            if result_callback is not None:

                result_callback(
                    latest_data.copy()
                )


        # ====================================================
        # ANNOTATED FRAME
        # ====================================================

        annotated = frame.copy()


        # ====================================================
        # DRAW ROIs
        # ====================================================

        if display:

            for zone_name, roi in rois.items():

                x = roi["x"]
                y = roi["y"]
                w = roi["width"]
                h = roi["height"]


                if "disembark" in zone_name:

                    rectangle_color = (
                        0,
                        165,
                        255
                    )

                else:

                    rectangle_color = (
                        0,
                        255,
                        0
                    )


                cv2.rectangle(
                    annotated,
                    (x, y),
                    (
                        x + w,
                        y + h
                    ),
                    rectangle_color,
                    2
                )


                cv2.putText(
                    annotated,
                    zone_name,
                    (
                        x,
                        max(
                            20,
                            y - 8
                        )
                    ),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.5,
                    rectangle_color,
                    2
                )


        # ====================================================
        # DRAW BOXES
        # ====================================================

        def draw_boxes(
            boxes,
            color
        ):

            for box in boxes:

                x1, y1, x2, y2 = box

                cv2.rectangle(
                    annotated,
                    (x1, y1),
                    (x2, y2),
                    color,
                    2
                )


        draw_boxes(
            door_1_left,
            (0, 255, 0)
        )

        draw_boxes(
            door_1_right,
            (0, 255, 0)
        )

        draw_boxes(
            door_2_left,
            (0, 255, 0)
        )

        draw_boxes(
            door_2_right,
            (0, 255, 0)
        )


        draw_boxes(
            door_1_disembark,
            (0, 165, 255)
        )

        draw_boxes(
            door_2_disembark,
            (0, 165, 255)
        )


        draw_boxes(
            outside,
            (128, 128, 128)
        )


        # ====================================================
        # INFORMATION PANEL
        # ====================================================

        if display:

            cv2.rectangle(
                annotated,
                (20, 20),
                (650, 350),
                (0, 0, 0),
                -1
            )


            # =================================================
            # DOOR 1
            # =================================================

            cv2.putText(
                annotated,
                "DOOR 1",
                (35, 55),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (255, 255, 255),
                2
            )


            cv2.putText(
                annotated,
                f"Boarding: "
                f"{latest_data['door_1_boarding']}",
                (35, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                annotated,
                f"Boarding Score: "
                f"{latest_data['door_1_boarding_score']:.1f}",
                (35, 120),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                annotated,
                f"Crowd Level: "
                f"{latest_data['door_1_crowd_level']}",
                (35, 150),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                annotated,
                f"Disembark: "
                f"{latest_data['door_1_disembark']}",
                (35, 180),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            # =================================================
            # DOOR 2
            # =================================================

            cv2.putText(
                annotated,
                "DOOR 2",
                (350, 55),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (255, 255, 255),
                2
            )


            cv2.putText(
                annotated,
                f"Boarding: "
                f"{latest_data['door_2_boarding']}",
                (350, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                annotated,
                f"Boarding Score: "
                f"{latest_data['door_2_boarding_score']:.1f}",
                (350, 120),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                annotated,
                f"Crowd Level: "
                f"{latest_data['door_2_crowd_level']}",
                (350, 150),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                annotated,
                f"Disembark: "
                f"{latest_data['door_2_disembark']}",
                (350, 180),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            # =================================================
            # STATUS
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
                (35, 225),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 255, 255),
                2
            )


            # =================================================
            # RESIZE
            # =================================================

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


            # =================================================
            # DISPLAY
            # =================================================

            cv2.imshow(
                "SmartGS CV4",
                display_frame
            )


            # =================================================
            # QUIT
            # =================================================

            key = (
                cv2.waitKey(1)
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


    # ========================================================
    # FINAL OUTPUT
    # ========================================================

    print()
    print(
        "=" * 60
    )

    print(
        "CV4 DETECTION FINISHED"
    )

    print(
        "=" * 60
    )

    print(
        f"Door 1 boarding: "
        f"{latest_data['door_1_boarding']}"
    )

    print(
        f"Door 1 boarding score: "
        f"{latest_data['door_1_boarding_score']:.1f}"
    )

    print(
        f"Door 1 crowd level: "
        f"{latest_data['door_1_crowd_level']}"
    )

    print(
        f"Door 1 disembark: "
        f"{latest_data['door_1_disembark']}"
    )

    print()

    print(
        f"Door 2 boarding: "
        f"{latest_data['door_2_boarding']}"
    )

    print(
        f"Door 2 boarding score: "
        f"{latest_data['door_2_boarding_score']:.1f}"
    )

    print(
        f"Door 2 crowd level: "
        f"{latest_data['door_2_crowd_level']}"
    )

    print(
        f"Door 2 disembark: "
        f"{latest_data['door_2_disembark']}"
    )

    print(
        "=" * 60
    )


    return latest_data


# ============================================================
# STANDALONE TEST
# ============================================================

if __name__ == "__main__":

    run_detection(
        VIDEO_PATH,
        display=True,
        loop_video=True
    )