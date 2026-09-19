import cv2
import json
from pathlib import Path
from ultralytics import YOLO
import threading


# ============================================================
# SETTINGS
# ============================================================

VIDEO_PATH = Path(
    "videos/cv5/cv5_mrt_anonymised.mp4"
)

ROI_PATH = Path(
    "config/cv5_rois.json"
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
# LOAD ROIs
# ============================================================

with open(
    ROI_PATH,
    "r"
) as file:

    roi_data = json.load(file)


# ============================================================
# SHARED RESULT
# ============================================================

latest_result = {

    "door_3_boarding": 0,

    "door_3_boarding_score": 0.0,

    "door_3_crowd_level": "LOW",

    "door_3_disembark": 0,

    "door_4_boarding": 0,

    "door_4_boarding_score": 0.0,

    "door_4_crowd_level": "LOW",

    "door_4_disembark": 0
}


result_lock = threading.Lock()


# ============================================================
# HELPER FUNCTIONS
# ============================================================

def point_inside_rectangle(
    x,
    y,
    rectangle
):

    return (
        rectangle["x"] <= x <= rectangle["x"] + rectangle["width"]
        and
        rectangle["y"] <= y <= rectangle["y"] + rectangle["height"]
    )


def classify_person(
    x,
    y
):

    for zone_name, rectangle in roi_data.items():

        if point_inside_rectangle(
            x,
            y,
            rectangle
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

    elif people_count > 15:

        return "CROWDED"

    elif people_count > 10:

        return "MODERATE"

    else:

        return "LOW"


# ============================================================
# BOARDING SCORE
# ============================================================

def get_boarding_score(
    people_count
):

    score = (
        people_count /
        30
    ) * 100

    return min(
        score,
        100
    )


# ============================================================
# GET LATEST RESULT
# ============================================================

def get_latest_result():

    with result_lock:

        return latest_result.copy()


# ============================================================
# RUN DETECTION
# ============================================================

def run_detection(
    display=True,
    loop_video=True
):

    global latest_result


    # ========================================================
    # LOAD MODEL
    # ========================================================

    print(
        "Loading YOLOv8s for CV5..."
    )

    model = YOLO(
        MODEL_PATH
    )

    print(
        "YOLOv8s CV5 loaded successfully."
    )


    # ========================================================
    # OPEN VIDEO
    # ========================================================

    cap = cv2.VideoCapture(
        str(VIDEO_PATH)
    )


    if not cap.isOpened():

        print(
            f"ERROR: Could not open {VIDEO_PATH}"
        )

        return get_latest_result()


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
    print("=" * 60)

    print(
        "SMARTGS CV5 BOARDING ZONE DETECTION"
    )

    print("=" * 60)

    print(
        f"Resolution     : {width} x {height}"
    )

    print(
        f"Video FPS      : {fps:.2f}"
    )

    print(
        f"Total frames   : {total_frames}"
    )

    print(
        f"Frame interval : {FRAME_INTERVAL}"
    )

    if fps > 0:

        print(
            f"Detection rate : "
            f"{fps / FRAME_INTERVAL:.2f} FPS"
        )

    print()

    print(
        "Door 3: Left + Right boarding zones"
    )

    print(
        "Door 4: Left + Right boarding zones"
    )

    print(
        "Disembarking zones excluded from boarding counts."
    )

    print()


    # ========================================================
    # DETECTION DATA
    # ========================================================

    door_3_left = []
    door_3_disembark = []
    door_3_right = []

    door_4_left = []
    door_4_disembark = []
    door_4_right = []

    outside = []


    door_3_left_count = 0
    door_3_disembark_count = 0
    door_3_right_count = 0

    door_4_left_count = 0
    door_4_disembark_count = 0
    door_4_right_count = 0


    door_3_boarding = 0
    door_4_boarding = 0

    door_3_boarding_score = 0.0
    door_4_boarding_score = 0.0

    door_3_crowd_level = "LOW"
    door_4_crowd_level = "LOW"


    # ========================================================
    # DISPLAY
    # ========================================================

    if display:

        cv2.namedWindow(
            "SmartGS CV5",
            cv2.WINDOW_NORMAL
        )

        if width > 0:

            display_height = int(
                height *
                DISPLAY_WIDTH /
                width
            )

            cv2.resizeWindow(
                "SmartGS CV5",
                DISPLAY_WIDTH,
                display_height
            )


    # ========================================================
    # FRAME COUNTER
    # ========================================================

    frame_number = 0


    # ========================================================
    # MAIN LOOP
    # ========================================================

    while True:

        ret, frame = cap.read()


        # ====================================================
        # VIDEO END
        # ====================================================

        if not ret:

            if loop_video:

                print(
                    "CV5 video finished. Restarting..."
                )

                cap.set(
                    cv2.CAP_PROP_POS_FRAMES,
                    0
                )

                frame_number = 0

                continue

            break


        frame_number += 1


        # ====================================================
        # FRAME SAMPLING
        # ====================================================

        process_frame = (
            frame_number % FRAME_INTERVAL == 0
        )


        # ====================================================
        # YOLO
        # ====================================================

        if process_frame:

            results = model(
                frame,
                conf=CONFIDENCE,
                classes=[PERSON_CLASS],
                verbose=False
            )


            # =================================================
            # RESET LISTS
            # =================================================

            door_3_left = []
            door_3_disembark = []
            door_3_right = []

            door_4_left = []
            door_4_disembark = []
            door_4_right = []

            outside = []


            # =================================================
            # CLASSIFY PEOPLE
            # =================================================

            for box in results[0].boxes:

                x1, y1, x2, y2 = map(
                    int,
                    box.xyxy[0]
                )


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


                if zone == "door_3_left":

                    door_3_left.append(
                        person_box
                    )

                elif zone == "door_3_disembark":

                    door_3_disembark.append(
                        person_box
                    )

                elif zone == "door_3_right":

                    door_3_right.append(
                        person_box
                    )

                elif zone == "door_4_left":

                    door_4_left.append(
                        person_box
                    )

                elif zone == "door_4_disembark":

                    door_4_disembark.append(
                        person_box
                    )

                elif zone == "door_4_right":

                    door_4_right.append(
                        person_box
                    )

                else:

                    outside.append(
                        person_box
                    )


            # =================================================
            # COUNTS
            # =================================================

            door_3_left_count = len(
                door_3_left
            )

            door_3_disembark_count = len(
                door_3_disembark
            )

            door_3_right_count = len(
                door_3_right
            )


            door_4_left_count = len(
                door_4_left
            )

            door_4_disembark_count = len(
                door_4_disembark
            )

            door_4_right_count = len(
                door_4_right
            )


            # =================================================
            # BOARDING
            # =================================================

            door_3_boarding = (
                door_3_left_count
                +
                door_3_right_count
            )

            door_4_boarding = (
                door_4_left_count
                +
                door_4_right_count
            )


            # =================================================
            # CROWD LEVEL
            # =================================================

            door_3_crowd_level = get_crowd_level(
                door_3_boarding
            )

            door_4_crowd_level = get_crowd_level(
                door_4_boarding
            )


            # =================================================
            # BOARDING SCORE
            # =================================================

            door_3_boarding_score = get_boarding_score(
                door_3_boarding
            )

            door_4_boarding_score = get_boarding_score(
                door_4_boarding
            )


            # =================================================
            # UPDATE SHARED RESULT
            # =================================================

            with result_lock:

                latest_result = {

                    "door_3_boarding":
                        door_3_boarding,

                    "door_3_boarding_score":
                        door_3_boarding_score,

                    "door_3_crowd_level":
                        door_3_crowd_level,

                    "door_3_disembark":
                        door_3_disembark_count,

                    "door_4_boarding":
                        door_4_boarding,

                    "door_4_boarding_score":
                        door_4_boarding_score,

                    "door_4_crowd_level":
                        door_4_crowd_level,

                    "door_4_disembark":
                        door_4_disembark_count
                }


            # =================================================
            # PRINT LIVE RESULT
            # =================================================

            print()
            print("-" * 60)

            print(
                f"CV5 LIVE RESULT - Frame {frame_number}"
            )

            print(
                f"Door 3 boarding: "
                f"{door_3_boarding}"
            )

            print(
                f"Door 3 boarding score: "
                f"{door_3_boarding_score:.1f}"
            )

            print(
                f"Door 3 crowd level: "
                f"{door_3_crowd_level}"
            )

            print(
                f"Door 3 disembark: "
                f"{door_3_disembark_count}"
            )

            print()

            print(
                f"Door 4 boarding: "
                f"{door_4_boarding}"
            )

            print(
                f"Door 4 boarding score: "
                f"{door_4_boarding_score:.1f}"
            )

            print(
                f"Door 4 crowd level: "
                f"{door_4_crowd_level}"
            )

            print(
                f"Door 4 disembark: "
                f"{door_4_disembark_count}"
            )

            print("-" * 60)


        # ====================================================
        # DISPLAY
        # ====================================================

        if display:

            for zone_name, region in roi_data.items():

                x = region["x"]
                y = region["y"]
                w = region["width"]
                h = region["height"]


                if "disembark" not in zone_name:

                    rectangle_color = (
                        0,
                        255,
                        0
                    )

                else:

                    rectangle_color = (
                        0,
                        165,
                        255
                    )


                cv2.rectangle(
                    frame,
                    (x, y),
                    (
                        x + w,
                        y + h
                    ),
                    rectangle_color,
                    2
                )


                cv2.putText(
                    frame,
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


            # =================================================
            # DRAW BOXES
            # =================================================

            def draw_boxes(
                boxes,
                color
            ):

                for box in boxes:

                    x1, y1, x2, y2 = box

                    cv2.rectangle(
                        frame,
                        (x1, y1),
                        (x2, y2),
                        color,
                        2
                    )


            draw_boxes(
                door_3_left,
                (0, 255, 0)
            )

            draw_boxes(
                door_3_right,
                (0, 255, 0)
            )

            draw_boxes(
                door_4_left,
                (0, 255, 0)
            )

            draw_boxes(
                door_4_right,
                (0, 255, 0)
            )


            draw_boxes(
                door_3_disembark,
                (0, 165, 255)
            )

            draw_boxes(
                door_4_disembark,
                (0, 165, 255)
            )


            draw_boxes(
                outside,
                (128, 128, 128)
            )


            # =================================================
            # INFORMATION PANEL
            # =================================================

            cv2.rectangle(
                frame,
                (20, 20),
                (620, 285),
                (0, 0, 0),
                -1
            )


            # =================================================
            # DOOR 3
            # =================================================

            cv2.putText(
                frame,
                "DOOR 3",
                (35, 55),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Left: {door_3_left_count}",
                (35, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Right: {door_3_right_count}",
                (35, 120),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Boarding: {door_3_boarding}",
                (35, 155),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2
            )


            cv2.putText(
                frame,
                f"Crowd Level: {door_3_crowd_level}",
                (35, 190),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Boarding Zone Score: "
                f"{door_3_boarding_score:.1f}",
                (35, 225),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Disembark: "
                f"{door_3_disembark_count}",
                (35, 260),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            # =================================================
            # DOOR 4
            # =================================================

            cv2.putText(
                frame,
                "DOOR 4",
                (330, 55),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.75,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Left: {door_4_left_count}",
                (330, 90),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Right: {door_4_right_count}",
                (330, 120),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Boarding: {door_4_boarding}",
                (330, 155),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.7,
                (0, 255, 0),
                2
            )


            cv2.putText(
                frame,
                f"Crowd Level: {door_4_crowd_level}",
                (330, 190),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Boarding Zone Score: "
                f"{door_4_boarding_score:.1f}",
                (330, 225),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.65,
                (255, 255, 255),
                2
            )


            cv2.putText(
                frame,
                f"Disembark: "
                f"{door_4_disembark_count}",
                (330, 260),
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
                else "YOLO: HOLDING LAST RESULT"
            )


            cv2.putText(
                frame,
                status_text,
                (35, 320),
                cv2.FONT_HERSHEY_SIMPLEX,
                0.55,
                (255, 255, 255),
                2
            )


            # =================================================
            # RESIZE + DISPLAY
            # =================================================

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


            cv2.imshow(
                "SmartGS CV5",
                display_frame
            )


            key = cv2.waitKey(1) & 0xFF


            if key == ord("q"):

                break


    # ========================================================
    # CLEANUP
    # ========================================================

    cap.release()


    if display:

        cv2.destroyAllWindows()


    # ========================================================
    # FINAL RESULT
    # ========================================================

    print()
    print("=" * 60)

    print(
        "CV5 DETECTION FINISHED"
    )

    print("=" * 60)

    print(
        f"Door 3 boarding: "
        f"{latest_result['door_3_boarding']}"
    )

    print(
        f"Door 3 boarding score: "
        f"{latest_result['door_3_boarding_score']:.1f}"
    )

    print(
        f"Door 3 crowd level: "
        f"{latest_result['door_3_crowd_level']}"
    )

    print(
        f"Door 3 disembark: "
        f"{latest_result['door_3_disembark']}"
    )

    print()

    print(
        f"Door 4 boarding: "
        f"{latest_result['door_4_boarding']}"
    )

    print(
        f"Door 4 boarding score: "
        f"{latest_result['door_4_boarding_score']:.1f}"
    )

    print(
        f"Door 4 crowd level: "
        f"{latest_result['door_4_crowd_level']}"
    )

    print(
        f"Door 4 disembark: "
        f"{latest_result['door_4_disembark']}"
    )

    print("=" * 60)


    return get_latest_result()


# ============================================================
# DIRECT EXECUTION
# ============================================================

if __name__ == "__main__":

    run_detection(
        display=True,
        loop_video=True
    )