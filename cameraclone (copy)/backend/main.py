import torch

# Fix for PyTorch 2.6+ weights_only=True security error
# We monkeypatch torch.load to default weights_only=False for the YOLO models
_original_torch_load = torch.load
def _patched_torch_load(*args, **kwargs):
    if 'weights_only' not in kwargs:
        kwargs['weights_only'] = False
    return _original_torch_load(*args, **kwargs)
torch.load = _patched_torch_load

try:
    from ultralytics.nn.tasks import DetectionModel
    import torch.nn as nn
    from ultralytics.nn.modules import Conv, C2f, DFL, Concat, Bottleneck, SPPF
    
    if hasattr(torch.serialization, 'add_safe_globals'):
        torch.serialization.add_safe_globals([
            DetectionModel, 
            nn.modules.container.Sequential,
            nn.modules.container.ModuleList,
            nn.modules.conv.Conv2d,
            nn.modules.batchnorm.BatchNorm2d,
            nn.modules.activation.SiLU,
            Conv, C2f, DFL, Concat, Bottleneck, SPPF,
            torch.Size
        ])
except:
    pass

from ultralytics import YOLO
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel
import cv2
import json
import os
import threading
import time
import shutil
import numpy as np
from datetime import datetime
from datetime import datetime
from fastapi import FastAPI, HTTPException, UploadFile, File, Depends

from database import SessionLocal, engine, Base
from models import Camera, Alert

# =============================
# INITIAL SETUP
# =============================

model = YOLO("yolov8s.pt")

Base.metadata.create_all(bind=engine)

app = FastAPI(root_path="/api")

# Mount data directory
os.makedirs("data", exist_ok=True)
app.mount("/data", StaticFiles(directory="data"), name="data")

@app.middleware("http")
async def add_cors_header(request, call_next):
    # Debug log to see Origin header
    origin = request.headers.get("origin")
    if origin:
        print(f"DEBUG: Request from Origin: {origin} - Path: {request.url.path}")
    response = await call_next(request)
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

CONFIG_DIR = "configs"
os.makedirs(CONFIG_DIR, exist_ok=True)

active_captures = {}
running_engines = {}
stop_events = {}

ALERT_COOLDOWN = 3
last_alert_time = {}
last_side = {}

# =============================
# Pydantic
# =============================

class CameraCreate(BaseModel):
    name: str
    url: str

class PolygonData(BaseModel):
    points: list

class LineData(BaseModel):
    x1: float
    y1: float
    x2: float
    y2: float

# =============================
# Utility & DB Dependency
# =============================

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# =============================
# RULE ENGINE
# =============================

def rule_engine(camera_id, camera_url, stop_event):
    # Instantiate model PER THREAD for safe tracking persistence
    model = YOLO("yolov8s.pt")
    
    config_path = os.path.join(CONFIG_DIR, f"camera_{camera_id}.json")

    with open(config_path) as f:
        config = json.load(f)

    polygon = config.get("polygon")
    line = config.get("line")
    url = config["url"]

    if not polygon or not line:
        print(f"Camera {camera_id}: Polygon or Line missing")
        return

    print(f"DEBUG: Rule Engine Started for Camera {camera_id} - URL: {url}")

    cap = cv2.VideoCapture(url) # Let OpenCV auto-select backend
    
    # Local tracking state for this camera
    # format: { track_id: side }
    track_history = {}
    config_exported = False
    
    LINE_THRESHOLD = 10  # Normalized pixel distance threshold

    while not stop_event.is_set():
        success, frame = cap.read()
        if not success:
            print(f"Camera {camera_id}: Stream failed/ended. Retrying in 5s...")
            time.sleep(5)
            continue
            
        height, width = frame.shape[:2]
        
        # EXPORT PORTABLE JSON ONCE PER SESSION
        if not config_exported:
            try:
                log_dir = "data/logs"
                os.makedirs(log_dir, exist_ok=True)
                log_path = os.path.join(log_dir, f"config_{camera_id}.json")
                
                # Fetch name from DB
                db = SessionLocal()
                cam_db = db.query(Camera).filter(Camera.id == camera_id).first()
                camera_name = cam_db.name if cam_db else f"camera_{camera_id}"
                db.close()

                config_portable = {
                    "camera_id": camera_id,
                    "camera_name": camera_name,
                    "url": url,
                    "resolution": {"width": width, "height": height},
                    "polygon": [[int(p["x"] * width), int(p["y"] * height)] for p in polygon],
                    "line": {
                        "x1": int(line.get("x1", 0) * width),
                        "y1": int(line.get("y1", 0) * height),
                        "x2": int(line.get("x2", 0) * width),
                        "y2": int(line.get("y2", 0) * height)
                    }
                }
                with open(log_path, "w") as f:
                    json.dump(config_portable, f, indent=4)
                print(f"DEBUG: Portable config exported for Camera {camera_id}")
                config_exported = True
            except Exception as e:
                print(f"Error exporting config for camera {camera_id}: {e}")
        
        # Denormalize Polygon
        # Refactor Poly to NumPy format [np.array([[x,y], ...])]
        polygon_pts = np.array([[int(p["x"] * width), int(p["y"] * height)] for p in polygon], np.int32)
        denorm_polygon = [polygon_pts]
            
        # Denormalize Line & ENFORCE Robust direction
        lx1_raw = int(line["x1"] * width)
        ly1_raw = int(line["y1"] * height)
        lx2_raw = int(line["x2"] * width)
        ly2_raw = int(line["y2"] * height)
        
        dx = lx2_raw - lx1_raw
        dy = ly2_raw - ly1_raw
        
        # Sort based on dominant axis to determine a stable "forward" direction
        if abs(dx) > abs(dy): # More horizontal
            if lx1_raw > lx2_raw:
                lx1, ly1, lx2, ly2 = lx2_raw, ly2_raw, lx1_raw, ly1_raw
            else:
                lx1, ly1, lx2, ly2 = lx1_raw, ly1_raw, lx2_raw, ly2_raw
        else: # More vertical
            if ly1_raw > ly2_raw:
                lx1, ly1, lx2, ly2 = lx2_raw, ly2_raw, lx1_raw, ly1_raw
            else:
                lx1, ly1, lx2, ly2 = lx1_raw, ly1_raw, lx2_raw, ly2_raw
        
        line_len = np.sqrt((lx2 - lx1)**2 + (ly2 - ly1)**2) + 1e-6
 
        # Run Tracking with improved parameters
        # iou=0.5 helps with overlapping boxes in groups
        results = model.track(frame, classes=[0], conf=0.35, iou=0.5, persist=True, verbose=False)

        for r in results:
            if r.boxes.id is None:
                continue

            # Get boxes and IDs
            boxes = r.boxes.xyxy.cpu().numpy()
            track_ids = r.boxes.id.int().cpu().numpy()
            
            # CLEANUP: Remove old tracks
            active_ids = set(track_ids)
            track_history = {
                tid: side_val
                for tid, side_val in track_history.items()
                if tid in active_ids
            }

            for box, track_id in zip(boxes, track_ids):
                x1, y1, x2, y2 = map(int, box)
                cx = (x1 + x2) // 2
                cy = (y1 + y2) // 2

                # Calculate side (cross product)
                side_val = (lx2 - lx1) * (cy - ly1) - (ly2 - ly1) * (cx - lx1)
                # Normalize by line length to get pixel distance
                side = side_val / line_len
                
                # Check ROI (Polygon) using OpenCV pointPolygonTest
                # format: cv2.pointPolygonTest(contour, pt, measureDist)
                is_inside = cv2.pointPolygonTest(denorm_polygon[0], (float(cx), float(cy)), False)
                if is_inside < 0:
                    continue

                # Initialize history if new
                if track_id not in track_history:
                    track_history[track_id] = side
                    continue

                previous_side = track_history[track_id]

                # CROSSING LOGIC
                if (
                    abs(previous_side) > LINE_THRESHOLD and
                    abs(side) > LINE_THRESHOLD and
                    previous_side * side < 0
                ):
                    direction = "IN" if side > 0 else "OUT"
                    
                    # COOLDOWN PER TRACK
                    now = time.time()
                    key = (camera_id, int(track_id))

                    if key not in last_alert_time or (now - last_alert_time[key] > ALERT_COOLDOWN):
                        
                        # --- SAVE & LOG ---
                        data_dir = "data"
                        images_dir = os.path.join(data_dir, "camera_images")
                        logs_dir = os.path.join(data_dir, "logs")
                        
                        os.makedirs(images_dir, exist_ok=True)
                        os.makedirs(logs_dir, exist_ok=True)
                        
                        timestamp_str = time.strftime("%Y%m%d_%H%M%S")
                        iso_timestamp = datetime.now().isoformat()
                        
                        image_filename = f"camera{camera_id}_{direction}_{timestamp_str}.jpg"
                        image_path = os.path.join(images_dir, image_filename)
                        
                        try:
                            cv2.imwrite(image_path, frame)
                        except Exception as e:
                            print(f"Error saving image: {e}")
                        
                        # Save JSON Log
                        json_filename = f"camera{camera_id}_log.json"
                        json_path = os.path.join(logs_dir, json_filename)
                        
                        log_entry = {
                            "timestamp": iso_timestamp,
                            "camera_id": f"camera{camera_id}",
                            "event_type": direction,
                            "count": 1,
                            "image": image_filename,
                            "track_id": int(track_id),
                            "status": "success"
                        }
                        
                        current_logs = []
                        if os.path.exists(json_path):
                            try:
                                with open(json_path, 'r') as jf:
                                    content = jf.read()
                                    if content:
                                        current_logs = json.loads(content)
                            except:
                                current_logs = []
                        
                        current_logs.append(log_entry)
                        
                        with open(json_path, "w") as jf:
                            json.dump(current_logs, jf, indent=4)

                        # Database
                        db_image_path = f"data/camera_images/{image_filename}"
                        
                        try:
                            db = SessionLocal()
                            alert = Alert(
                                camera_id=camera_id, 
                                message=f"Person {direction}", 
                                image_path=db_image_path
                            )
                            db.add(alert)
                            db.commit()
                        except Exception as e:
                            print(f"DB Error: {e}")
                        finally:
                            db.close()

                        last_alert_time[key] = now
                        print(f"[ALERT] Camera {camera_id}: Person {track_id} went {direction}")
                
                # Update history
                track_history[track_id] = side

        time.sleep(0.01)

    cap.release()
    print(f"DEBUG: Rule Engine Stopped for Camera {camera_id}")

# =============================
# AUTO STARTUP
# =============================
@app.on_event("startup")
def startup_event():
    print(f"DEBUG: Startup event triggered. Config dir: {CONFIG_DIR}")
    if not os.path.exists(CONFIG_DIR):
        print("DEBUG: Config dir does not exist")
        return

    files = os.listdir(CONFIG_DIR)
    print(f"DEBUG: Found config files: {files}")

    for filename in files:
        if filename.startswith("camera_") and filename.endswith(".json"):
            try:
                camera_id = int(filename.split("_")[1].split(".")[0])
                config_path = os.path.join(CONFIG_DIR, filename)
                with open(config_path) as f:
                    cfg = json.load(f)
                camera_url = cfg["url"]

                stop_event = threading.Event()
                t = threading.Thread(target=rule_engine, args=(camera_id, camera_url, stop_event))
                t.daemon = True
                t.start()
                running_engines[camera_id] = t
                stop_events[camera_id] = stop_event
                print(f"Auto-started camera {camera_id}")
            except Exception as e:
                print(f"Failed to auto-start {filename}: {e}")
    
    print("--------------------------------------------------")
    print(" >>> BACKEND VERSION 2.1 (LOGGING + STATS) LOADED <<< ")
    print("--------------------------------------------------")

# =============================
# CRUD
# =============================

@app.post("/cameras")
def create_camera(camera: CameraCreate, db: Session = Depends(get_db)):
    try:
        cam = Camera(name=camera.name, url=camera.url)
        db.add(cam)
        db.commit()
        db.refresh(cam)
        return cam
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=400, detail="Camera name exists")

@app.get("/cameras")
def get_cameras(db: Session = Depends(get_db)):
    cams = db.query(Camera).all()
    return cams

@app.get("/camera/{camera_id}")
def get_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    return cam

@app.post("/camera/{camera_id}/polygon")
def save_polygon(camera_id: int, polygon: PolygonData, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    cam.polygon = json.dumps(polygon.points)
    db.commit()
    return {"message": "Polygon saved"}

@app.post("/camera/{camera_id}/line")
def save_line(camera_id: int, line: LineData, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")
    cam.line = json.dumps(line.dict())
    db.commit()
    return {"message": "Line saved"}

@app.post("/camera/{camera_id}/deploy")
def deploy_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    if not cam.polygon or not cam.line:
        raise HTTPException(status_code=400, detail="Please configure both polygon and line before deploying")

    p_norm = json.loads(cam.polygon)
    l_norm = json.loads(cam.line)

    # Save Internal Config
    cfg_internal = {"url": cam.url, "polygon": p_norm, "line": l_norm}
    path = os.path.join(CONFIG_DIR, f"camera_{camera_id}.json")
    with open(path, "w") as f:
        json.dump(cfg_internal, f)

    # Manage thread
    stop_event = stop_events.get(camera_id)
    if stop_event:
        stop_event.set()
        time.sleep(0.5)

    new_stop_event = threading.Event()
    stop_events[camera_id] = new_stop_event
    t = threading.Thread(target=rule_engine, args=(camera_id, cam.url, new_stop_event))
    t.daemon = True
    t.start()
    running_engines[camera_id] = t

    return {"message": "Deployment triggered. Tracking is starting in the background."}

@app.get("/camera/{camera_id}/active-config")
def get_active_config(camera_id: int):
    path = os.path.join(CONFIG_DIR, f"camera_{camera_id}.json")
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail="No active configuration found for this camera")
    with open(path, "r") as f:
        return json.load(f)

@app.post("/camera/{camera_id}/upload_config")
def upload_config(camera_id: int, config: dict, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()
    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    # Get dimensions for normalization (if needed)
    cap = cv2.VideoCapture(cam.url)
    success, frame = cap.read()
    if not success:
        cap.release()
        raise HTTPException(status_code=500, detail="Could not access camera to detect resolution for normalization")
    
    height, width = frame.shape[:2]
    cap.release()

    new_polygon = config.get("polygon", [])
    new_line = config.get("line", {})

    # Detect and Normalize if absolute
    def normalize_pts(pts, w, h):
        norm = []
        for p in pts:
            # Handle both list [x,y] and dict {"x":x, "y":y}
            if isinstance(p, list) and len(p) == 2:
                px, py = p[0], p[1]
            elif isinstance(p, dict):
                px, py = p.get("x", 0), p.get("y", 0)
            else:
                continue
            
            # Normalize if they look like absolute pixels
            nx = px / w if px > 1.0 else px
            ny = py / h if py > 1.0 else py
            norm.append({"x": nx, "y": ny})
        return norm

    def normalize_line(l, w, h):
        res = {}
        for k in ["x1", "y1", "x2", "y2"]:
            val = l.get(k, 0)
            res[k] = val / (w if "x" in k else h) if val > 1.0 else val
        return res

    p_norm = normalize_pts(new_polygon, width, height)
    l_norm = normalize_line(new_line, width, height)

    # Update DB
    cam.polygon = json.dumps(p_norm)
    cam.line = json.dumps(l_norm)
    db.commit()

    # Save Internal Config
    cfg_internal = {"url": cam.url, "polygon": p_norm, "line": l_norm}
    path = os.path.join(CONFIG_DIR, f"camera_{camera_id}.json")
    with open(path, "w") as f:
        json.dump(cfg_internal, f)

    # Stop old thread and start new
    stop_event = stop_events.get(camera_id)
    if stop_event:
        stop_event.set()
        time.sleep(0.5)

    new_stop_event = threading.Event()
    stop_events[camera_id] = new_stop_event
    t = threading.Thread(target=rule_engine, args=(camera_id, cam.url, new_stop_event))
    t.daemon = True
    t.start()
    running_engines[camera_id] = t

    return {"message": "Configuration uploaded and engine restarted successfully!"}

@app.get("/configs")
def list_configs():
    log_dir = "data/logs"
    if not os.path.exists(log_dir):
        return []
    files = [f for f in os.listdir(log_dir) if f.startswith("config_") and f.endswith(".json")]
    return sorted(files)

@app.get("/configs/{filename}")
def get_config_content(filename: str):
    log_dir = "data/logs"
    file_path = os.path.join(log_dir, filename)
    if not os.path.isfile(file_path):
        raise HTTPException(status_code=404, detail="Config file not found")
    
    with open(file_path, "r") as f:
        try:
            return json.load(f)
        except:
            raise HTTPException(status_code=500, detail="Error reading config JSON")

@app.delete("/camera/{camera_id}")
def delete_camera(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()

    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    if camera_id in stop_events:
        stop_events[camera_id].set()
        del stop_events[camera_id]
        if camera_id in running_engines:
            del running_engines[camera_id]

    db.delete(cam)
    db.commit()

    return {"message": "Camera deleted"}

@app.get("/alerts")
def get_alerts(db: Session = Depends(get_db)):
    alerts = db.query(Alert).order_by(Alert.timestamp.desc()).all()
    result = [
        {
            "id": a.id,
            "camera_id": a.camera_id,
            "message": a.message,
            "image": a.image_path if (a.image_path and a.image_path.startswith("data/")) else None,
            "timestamp": a.timestamp.isoformat() if a.timestamp else None
        }
        for a in alerts
    ]
    return result

@app.get("/alerts/summary")
def get_alerts_summary(db: Session = Depends(get_db)):
    cameras = db.query(Camera).all()
    summary = []

    for cam in cameras:
        # Optimized grouping/counting
        alerts = db.query(Alert).filter(Alert.camera_id == cam.id).order_by(Alert.timestamp.desc()).all()
        
        in_count = sum(1 for a in alerts if "IN" in a.message.upper())
        out_count = sum(1 for a in alerts if "OUT" in a.message.upper())
        
        recent_list = [
            {
                "id": a.id,
                "timestamp": a.timestamp.isoformat(),
                "image": a.image_path if (a.image_path and a.image_path.startswith("data/")) else None,
                "message": a.message
            }
            for a in alerts[:12] # Limit to last 12 for the card view
        ]
        
        summary.append({
            "camera_id": cam.id,
            "camera_name": cam.name,
            "total_in": in_count,
            "total_out": out_count,
            "alerts": recent_list
        })
        
    return summary

@app.get("/deployments/active")
def get_active_deployments(db: Session = Depends(get_db)):
    # running_engines stores { camera_id: thread_object }
    active_ids = list(running_engines.keys())
    
    if not active_ids:
        return []

    cameras = db.query(Camera).filter(Camera.id.in_(active_ids)).all()
    
    results = []
    for cam in cameras:
        # Load the portable config if exists
        config_path = f"data/logs/config_{cam.id}.json"
        config_data = {}
        if os.path.exists(config_path):
            try:
                with open(config_path, "r") as f:
                    config_data = json.load(f)
            except:
                pass
        
        results.append({
            "camera_id": cam.id,
            "camera_name": cam.name,
            "url": cam.url,
            "status": "Running",
            "config": config_data
        })
        
    return results

@app.delete("/alerts")
@app.delete("/alerts")
def clear_alerts(db: Session = Depends(get_db)):
    db.query(Alert).delete()
    db.commit()
    return {"message": "All alerts cleared"}

@app.get("/stats")
@app.get("/stats")
def get_stats(db: Session = Depends(get_db)):
    # Logic to count IN vs OUT
    # We can do this by querying alerts and filtering by message content
    alerts = db.query(Alert).all()
    
    stats = {}
    
    for a in alerts:
        cam_id = a.camera_id
        if cam_id not in stats:
            stats[cam_id] = {"in": 0, "out": 0}
            
        if "IN" in a.message:
            stats[cam_id]["in"] += 1
        elif "OUT" in a.message:
            stats[cam_id]["out"] += 1
            
    return stats

# --- GALLERY ENDPOINTS ---

GALLERY_DIR = os.path.join("data", "gallery")
os.makedirs(GALLERY_DIR, exist_ok=True)

@app.post("/gallery/upload")
async def upload_gallery_file(file: UploadFile = File(...)):
    # Save file to data/gallery
    timestamp_str = time.strftime("%Y%m%d_%H%M%S")
    # Clean filename or just use timestamp + extension
    ext = os.path.splitext(file.filename)[1]
    filename = f"capture_{timestamp_str}{ext}"
    
    file_path = os.path.join(GALLERY_DIR, filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
        
    return {"filename": filename, "path": f"/data/gallery/{filename}"}

@app.get("/gallery")
def get_gallery_items():
    # List all files in gallery dir
    files = []
    if os.path.exists(GALLERY_DIR):
        for f in os.listdir(GALLERY_DIR):
             if f.lower().endswith(('.png', '.jpg', '.jpeg', '.mp4', '.webm')):
                path = os.path.join(GALLERY_DIR, f)
                stats = os.stat(path)
                files.append({
                    "filename": f,
                    "url": f"/data/gallery/{f}",
                    "created": stats.st_mtime,
                    "type": "image" if f.lower().endswith(('.png', '.jpg', '.jpeg')) else "video"
                })
    
    # Sort by created desc
    files.sort(key=lambda x: x["created"], reverse=True)
    return files

@app.get("/camera/{camera_id}/status")
@app.get("/camera/{camera_id}/status")
def camera_status(camera_id: int, db: Session = Depends(get_db)):
    cam = db.query(Camera).filter(Camera.id == camera_id).first()

    if not cam:
        raise HTTPException(status_code=404, detail="Camera not found")

    cap = cv2.VideoCapture(cam.url, cv2.CAP_FFMPEG)
    success, _ = cap.read()
    cap.release()

    return {"status": "Online" if success else "Offline"}



# [(322, 234), (2465, 278), (2536, 1218), (298, 1059), (314, 230), (314, 226), (314, 226)]

def generate_frames(camera_id: int):

    db = SessionLocal()
    try:
        cam = db.query(Camera).filter(Camera.id == camera_id).first()
    finally:
        db.close()

    if not cam:
        return

    cap = cv2.VideoCapture(cam.url, cv2.CAP_FFMPEG)

    while True:
        success, frame = cap.read()
        if not success:
            break

        ret, buffer = cv2.imencode(".jpg", frame)
        frame_bytes = buffer.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
        )

    cap.release()


@app.get("/camera/{camera_id}/stream")
def stream_camera(camera_id: int):
    return StreamingResponse(
        generate_frames(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )

def generate_yolo_frames(camera_id: int):
    db = SessionLocal()
    try:
        cam = db.query(Camera).filter(Camera.id == camera_id).first()
    finally:
        db.close()

    if not cam:
        return

    # Using the standard detector model instance
    stream_cap = cv2.VideoCapture(cam.url)
    stream_cap.set(cv2.CAP_PROP_BUFFERSIZE, 1) # Reduce latency

    frame_count = 0
    results = None

    while True:
        # Optimization: Clear buffer by skipping old frames if processing is slow
        # This keeps the stream "live"
        for _ in range(5): 
             stream_cap.grab()
             
        success, frame = stream_cap.read()
        if not success:
            break

        frame_count += 1
        
        # Only run inference on every 3rd frame to save CPU/GPU
        if frame_count % 3 == 0 or results is None:
            # Resize for FASTER inference (Standard YOLOv8 training resolution is 640)
            inference_frame = cv2.resize(frame, (640, 480))
            results = model.predict(inference_frame, conf=0.3, verbose=False)
        
        # Plot boxes/labels on frame
        # Since we resized for inference, we need to ensure labels align with original frame
        # YOLO's results.plot() handles this internally if results are from resized, 
        # but for max smoothness we can use manual drawing or just plot on full frame if load allows
        
        # Actually, if we use results[0].plot() on the 'frame' (original size), 
        # it might be slow. Let's see if we can draw on the resized one and send that 
        # for maximum performance if lag persists. For now, let's plot on the original.
        annotated_frame = results[0].plot()

        ret, buffer = cv2.imencode(".jpg", annotated_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 70])
        frame_bytes = buffer.tobytes()

        yield (
            b"--frame\r\n"
            b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
        )

    stream_cap.release()

@app.get("/camera/{camera_id}/yolo_stream")
def stream_yolo_camera(camera_id: int):
    return StreamingResponse(
        generate_yolo_frames(camera_id),
        media_type="multipart/x-mixed-replace; boundary=frame"
    )
    
#test