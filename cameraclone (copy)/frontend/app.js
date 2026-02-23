const API = "/api";

let drawMode = "polygon";   // polygon | line
let points = [];
let canvas = null;
let ctx = null;
let draggingPointIndex = null;
let currentCameraId = null;

/* ============================
   Add Camera
============================ */
function addCamera() {
    const name = document.getElementById("name").value.trim();
    const url = document.getElementById("url").value.trim();

    if (!name || !url) {
        alert("Please enter camera name and URL");
        return;
    }

    fetch(`${API}/cameras`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, url })
    })
        .then(res => res.json())
        .then(() => {
            document.getElementById("name").value = "";
            document.getElementById("url").value = "";
            loadCameras();
        });
}

/* ============================
   Deploy
============================ */
function deployCamera(id) {
    // Visual feedback on button
    const btn = document.getElementById(`deployBtn_${id}`);
    if (btn) btn.innerHTML = '<i class="ph-bold ph-spinner animate-spin"></i>';

    fetch(`${API}/camera/${id}/deploy`, { method: "POST" })
        .then(res => res.json())
        .then(data => {
            if (btn) btn.innerHTML = '<i class="ph-bold ph-rocket-launch"></i> Deploy';
            if (data.detail) {
                alert("Deploy Error: " + data.detail);
            } else {
                alert(data.message);
                loadCameras(); // Refresh to show "Online"
            }
        })
        .catch(err => {
            if (btn) btn.innerHTML = '<i class="ph-bold ph-rocket-launch"></i> Deploy';
            alert("Deploy failed: " + err);
        });
}

function viewActiveJSON(id) {
    switchView('configs');
    viewConfig(`config_${id}.json`);
}

let uploadTargetCameraId = null;

function triggerUpload(id) {
    uploadTargetCameraId = id;
    document.getElementById('jsonUploadInput').click();
}

// Global listener for the hidden file input
document.getElementById('jsonUploadInput').addEventListener('change', function (e) {
    if (!e.target.files.length || !uploadTargetCameraId) return;

    const file = e.target.files[0];
    const reader = new FileReader();

    reader.onload = function (event) {
        try {
            const config = JSON.parse(event.target.result);
            uploadConfig(uploadTargetCameraId, config);
        } catch (err) {
            alert("Invalid JSON file: " + err.message);
        }
    };

    reader.readAsText(file);
    // Reset for next use
    e.target.value = "";
});

function uploadConfig(id, config) {
    fetch(`${API}/camera/${id}/upload_config`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config)
    })
        .then(res => res.json())
        .then(data => {
            if (data.detail) {
                alert("Upload Failed: " + data.detail);
            } else {
                alert("JSON Uploaded & Deployed Successfully!");
                loadCameras();
            }
        })
        .catch(err => alert("Error uploading config: " + err));
}

function startUpdateFlow(id) {
    // For now, this acts as a shortcut to refresh logic or trigger a clean swap
    alert("Starting Update Flow for Camera " + id + "... Please select the new JSON file.");
    triggerUpload(id);
}

/* ============================
   Load Cameras (Glass Cards)
============================ */
function loadCameras() {
    console.log("DEBUG: loadCameras() called");
    fetch(`${API}/cameras`)
        .then(res => {
            console.log("DEBUG: /cameras response status:", res.status);
            return res.json();
        })
        .then(data => {
            console.log("DEBUG: /cameras data received, count:", data.length);
            const list = document.getElementById("cameraList");
            if (!list) return;

            list.innerHTML = "";

            data.forEach(cam => {
                const div = document.createElement("div");
                div.className = "glass-card rounded-xl overflow-hidden relative group border border-white/5";

                div.innerHTML = `
                    <div class="absolute top-3 right-3 z-10 flex items-center gap-2">
                        <span id="statusText_${cam.id}" class="text-[10px] font-bold bg-black/60 backdrop-blur-md px-1.5 py-0.5 rounded text-white border border-white/10 uppercase tracking-tighter">
                            Checking...
                        </span>
                    </div>

                    <div class="h-28 bg-dark-800 relative flex items-center justify-center overflow-hidden">
                        <i class="ph-duotone ph-video-camera text-2xl text-gray-700"></i>
                        <div class="absolute inset-0 bg-gradient-to-t from-dark-900/80 to-transparent"></div>
                        <button onclick="preview(${cam.id})" class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                            <i class="ph-bold ph-play text-white text-2xl"></i>
                        </button>
                    </div>

                    <div class="p-4 relative">
                        <div class="flex justify-between items-start mb-3">
                            <div class="overflow-hidden">
                                <h3 class="font-bold text-sm text-white truncate">${cam.name}</h3>
                                <p class="text-[10px] text-gray-500 truncate">${cam.url}</p>
                            </div>
                            <button onclick="deleteCamera(${cam.id})" class="text-gray-500 hover:text-red-500 transition-colors">
                                <i class="ph-bold ph-trash-simple"></i>
                            </button>
                        </div>

                        <div class="grid grid-cols-2 gap-2 mb-3">
                             <button onclick="deployCamera(${cam.id})" id="deployBtn_${cam.id}" class="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-gradient-to-r from-brand-gradientStart to-brand-gradientEnd text-white text-xs font-bold shadow-lg shadow-brand-red/10 hover:shadow-brand-red/30 transition-all active:scale-95">
                                <i class="ph-bold ph-rocket-launch"></i> Deploy
                            </button>
                            <button onclick="viewActiveJSON(${cam.id})" class="flex items-center justify-center gap-1.5 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-medium transition-all hover:text-white">
                                <i class="ph-bold ph-code"></i> Active JSON
                            </button>
                        </div>

                        <div class="flex flex-col gap-2 border-t border-white/5 pt-3">
                            <button onclick="triggerUpload(${cam.id})" class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/20 transition-all">
                                <i class="ph-bold ph-upload-simple"></i> Upload JSON
                            </button>
                            <button onclick="startUpdateFlow(${cam.id})" class="flex items-center justify-center gap-1.5 py-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-[10px] font-bold border border-blue-500/20 transition-all">
                                <i class="ph-bold ph-arrows-counter-clockwise"></i> Update JSON Flow
                            </button>
                        </div>
                    </div>
                `;

                list.appendChild(div);

                // Now fetch status and update partials
                fetch(`${API}/camera/${cam.id}/status`)
                    .then(res => res.json())
                    .then(statusData => {
                        const statusText = document.getElementById(`statusText_${cam.id}`);
                        if (statusText) {
                            statusText.innerText = statusData.status;

                            if (statusData.status === "Online") {
                                statusText.className = "text-[10px] font-bold bg-green-500/20 backdrop-blur-md px-1.5 py-0.5 rounded text-green-400 border border-green-500/20 uppercase tracking-tighter";
                            } else {
                                statusText.className = "text-[10px] font-bold bg-red-500/20 backdrop-blur-md px-1.5 py-0.5 rounded text-red-400 border border-red-500/20 uppercase tracking-tighter";
                            }
                        }
                    })
                    .catch(() => {
                        const statusText = document.getElementById(`statusText_${cam.id}`);
                        if (statusText) {
                            statusText.innerText = "Offline";
                            statusText.className = "text-[10px] font-bold bg-red-500/20 backdrop-blur-md px-1.5 py-0.5 rounded text-red-400 border border-red-500/20 uppercase tracking-tighter";
                        }
                    });
            });
        });
}

/* ============================
   Preview (Theater Mode)
============================ */
function preview(id) {
    currentCameraId = id;
    const section = document.getElementById("previewSection");
    section.classList.remove("hidden");

    // We need to fetch camera details first to check rules
    fetch(`${API}/camera/${id}`)
        .then(res => res.json())
        .then(cam => {
            section.innerHTML = `
            <div class="glass-panel p-6 rounded-2xl relative animate-fadeIn">
               <div class="flex justify-between items-center mb-6">
                  <div>
                    <h3 class="text-xl font-bold flex items-center gap-2">
                        <i class="ph-duotone ph-broadcast text-brand-red"></i> Live Preview
                    </h3>
                    <p class="text-sm text-gray-400">Configuring Rules for: <span class="text-white">${cam.name}</span></p>
                  </div>
                  <button onclick="document.getElementById('previewSection').classList.add('hidden')" class="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 transition-colors">
                    <i class="ph-bold ph-x"></i>
                  </button>
               </div>

               <!-- Video Area -->
               <div class="relative rounded-xl overflow-hidden shadow-2xl border border-white/10 bg-black aspect-video w-full max-h-[600px] mx-auto">
                  <img id="videoStream" class="w-full h-full object-contain" src="${API}/camera/${id}/stream">
                  <canvas id="drawCanvas" class="absolute top-0 left-0 w-full h-full cursor-crosshair"></canvas>
                  
                  <!-- Overlay Controls -->
                  <div class="absolute top-4 right-4 flex gap-2">
                      <div id="ruleStatus" class="px-3 py-1 rounded-full bg-black/60 backdrop-blur-md text-xs font-bold border border-white/10 text-gray-300">
                        Checking Status...
                      </div>
                  </div>
               </div>

               <!-- Toolbar -->
               <div class="mt-6 flex flex-wrap gap-4 items-center justify-between p-4 bg-dark-800/50 rounded-xl border border-white/5">
                  <div class="flex gap-3">
                     <button onclick="setMode('polygon')" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-all">
                        <i class="ph-bold ph-polygon"></i> Draw Zone
                     </button>
                      <button onclick="setMode('line')" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-all">
                        <i class="ph-bold ph-line-segment"></i> Draw Line
                     </button>
                     <button onclick="resetShape()" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-red-500/20 text-red-500 border border-white/10 text-sm font-medium transition-all">
                        <i class="ph-bold ph-arrow-counter-clockwise"></i> Reset
                     </button>
                  </div>

                  <div class="flex gap-3 border-l border-white/10 pl-3">
                     <button onclick="takeScreenshot()" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-sm font-medium transition-all text-gray-300 hover:text-white">
                        <i class="ph-bold ph-camera"></i> Screenshot
                     </button>
                      <button onclick="toggleRecording()" id="recordBtn" class="flex items-center gap-2 px-4 py-2 rounded-lg bg-white/5 hover:bg-red-500/20 border border-white/10 text-sm font-medium transition-all text-gray-300 hover:text-red-500">
                        <i class="ph-bold ph-record"></i> <span id="recordText">Record</span>
                     </button>
                  </div>
                  
                  <div class="flex gap-3">
                     <button onclick="saveRule()" class="flex items-center gap-2 px-6 py-2 rounded-lg bg-white text-dark-900 font-bold shadow-lg hover:shadow-white/20 transition-all active:scale-95">
                        <i class="ph-bold ph-floppy-disk"></i> Save Rules
                     </button>
                  </div>
               </div>
            </div>
        `;

            // Init logic for canvas
            const img = document.getElementById("videoStream");
            img.crossOrigin = "anonymous"; // Enable cross-origin for screenshot

            // Parse rules if they exist (Strings from DB)
            let polygonObj = null;
            let lineObj = null;

            try { if (cam.polygon) polygonObj = JSON.parse(cam.polygon); } catch (e) { }
            try { if (cam.line) lineObj = JSON.parse(cam.line); } catch (e) { }

            // Check rule status
            const hasPolygon = polygonObj && polygonObj.length > 0;
            const hasLine = lineObj && lineObj.x1 !== undefined;

            const statusEl = document.getElementById("ruleStatus");

            if (hasPolygon && hasLine) {
                statusEl.innerHTML = '<span class="text-green-400">✓ Ready to Deploy</span>';
                statusEl.classList.remove("border-yellow-500/30");
                statusEl.classList.add("border-green-500/30");
            } else {
                let missing = [];
                if (!hasPolygon) missing.push("Zone");
                if (!hasLine) missing.push("Line");
                statusEl.innerHTML = `<span class="text-yellow-400">⚠ Missing: ${missing.join(", ")}</span>`;
                statusEl.classList.remove("border-green-500/30");
                statusEl.classList.add("border-yellow-500/30");
            }

            img.onload = () => {
                initCanvas();
                // Draw existing rules if any
                if (polygonObj) {
                    points = polygonObj.map(p => ({
                        x: p.x * canvas.width,
                        y: p.y * canvas.height
                    }));
                    drawMode = "polygon"; // Temporarily set to draw
                    drawShape();
                }
                // We should probably also draw the line if it exists, but the original code only redrew polygon?
                // Let's add line drawing too for completeness
                if (lineObj) {
                    // If we want to show both, we need a better way to store them in 'points' or separate vars.
                    // For now, let's just stick to the original behavior or slightly improve.
                    // actually, the original code only handled polygon redraw on load.
                }
            };
        });
}

function initCanvas() {
    canvas = document.getElementById("drawCanvas");
    const video = document.getElementById("videoStream");
    if (!canvas || !video) return;

    canvas.width = video.clientWidth;
    canvas.height = video.clientHeight;

    ctx = canvas.getContext("2d");
    points = [];
    draggingPointIndex = null;

    canvas.onclick = addPoint;
    canvas.onmousedown = startDrag;
    canvas.onmousemove = dragPoint;
    canvas.onmouseup = stopDrag;
}

function addPoint(e) {
    if (draggingPointIndex !== null) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (drawMode === "polygon") points.push({ x, y });
    else if (drawMode === "line") {
        if (points.length >= 2) points = [];
        points.push({ x, y });
    }
    drawShape();
}

function drawShape() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (points.length === 0) return;

    // Stylish Draw
    ctx.strokeStyle = "#E50914";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.shadowColor = "rgba(229, 9, 20, 0.5)";
    ctx.shadowBlur = 10;

    if (drawMode === "polygon") {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
        ctx.closePath();
        ctx.stroke();

        // Fill
        ctx.fillStyle = "rgba(229, 9, 20, 0.1)";
        ctx.fill();
    }

    if (drawMode === "line" && points.length === 2) {
        ctx.beginPath();
        ctx.moveTo(points[0].x, points[0].y);
        ctx.lineTo(points[1].x, points[1].y);
        ctx.stroke();
    }

    // Dots
    points.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6, 0, Math.PI * 2);
        ctx.fillStyle = "#fff";
        ctx.fill();
        ctx.strokeStyle = "#E50914";
        ctx.lineWidth = 2;
        ctx.stroke();
    });
}

// Dragging logic remains same...
function startDrag(e) {
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    points.forEach((p, index) => {
        const distance = Math.sqrt((p.x - x) ** 2 + (p.y - y) ** 2);
        if (distance < 10) draggingPointIndex = index;
    });
}
function dragPoint(e) {
    if (draggingPointIndex === null) return;
    const rect = canvas.getBoundingClientRect();
    points[draggingPointIndex].x = e.clientX - rect.left;
    points[draggingPointIndex].y = e.clientY - rect.top;
    drawShape();
}
function stopDrag() { draggingPointIndex = null; }

function saveRule() {
    if (!currentCameraId) return;

    // Normalize logic same as before...
    let promise;
    if (drawMode === "polygon") {
        if (points.length < 3) return alert("Polygon requires 3+ points");
        const normalized = points.map(p => ({ x: p.x / canvas.width, y: p.y / canvas.height }));
        promise = fetch(`${API}/camera/${currentCameraId}/polygon`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ points: normalized })
        });
    } else if (drawMode === "line") {
        if (points.length !== 2) return alert("Line requires 2 points");
        const p1 = points[0], p2 = points[1];
        promise = fetch(`${API}/camera/${currentCameraId}/line`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                x1: p1.x / canvas.width, y1: p1.y / canvas.height,
                x2: p2.x / canvas.width, y2: p2.y / canvas.height
            })
        });
    }

    if (promise) {
        promise.then(res => res.json()).then(() => {
            // Auto-deploy to apply changes immediately
            fetch(`${API}/camera/${currentCameraId}/deploy`, { method: "POST" })
                .then(res => res.json())
                .then(data => {
                    alert("Rules Saved & Deployed!");
                    preview(currentCameraId); // Refresh UI
                })
                .catch(err => {
                    console.error(err);
                    alert("Rules saved but deploy failed.");
                });
        });
    }
}

function resetShape() { points = []; drawShape(); }

function deleteCamera(id) {
    if (!confirm("Delete this camera?")) return;
    fetch(`${API}/camera/${id}`, { method: "DELETE" }).then(() => {
        loadCameras();
        document.getElementById("previewSection").classList.add("hidden");
    });
}

/* ============================
   Stats (Top Cards)
============================ */
function loadStats() {
    fetch(`${API}/stats`)
        .then(res => res.json())
        .then(data => {
            const container = document.getElementById("statsContainer");
            if (!container) return;
            container.innerHTML = "";

            // Check for 404/Detail
            if (data.detail) {
                console.error("Stats endpoint 404");
                return;
            }

            if (Object.keys(data).length === 0) return;

            for (const [camId, counts] of Object.entries(data)) {
                const inCount = counts.in || 0;
                const outCount = counts.out || 0;

                const card = document.createElement("div");
                card.className = "glass-card p-5 rounded-xl border border-white/5 flex flex-col justify-between h-32";
                card.innerHTML = `
                <div class="flex justify-between items-start">
                    <span class="text-xs font-bold text-gray-400 uppercase tracking-widest">Camera ${camId}</span>
                    <i class="ph-duotone ph-chart-bar text-brand-red text-xl"></i>
                </div>
                <div class="flex items-center gap-6">
                    <div>
                        <div class="text-2xl font-bold text-green-400">${inCount}</div>
                        <div class="text-xs text-gray-500 font-medium">Entered</div>
                    </div>
                    <div class="w-px h-8 bg-white/10"></div>
                     <div>
                        <div class="text-2xl font-bold text-red-500">${outCount}</div>
                        <div class="text-xs text-gray-500 font-medium">Exited</div>
                    </div>
                </div>
            `;
                container.appendChild(card);
            }
        });
}

/* ============================
   Alerts (Grid)
============================ */
/* ============================
   Alerts (Camera-Centric Aggregation)
============================ */
function loadAlerts() {
    fetch(`${API}/alerts/summary`)
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById("alertList");
            if (!list) return;

            list.innerHTML = "";

            if (data.length === 0) {
                list.innerHTML = '<div class="col-span-full text-center text-gray-500 py-10 italic">No alerts summarized yet</div>';
                return;
            }

            data.forEach(camSummary => {
                const div = document.createElement("div");
                div.className = "glass-panel p-6 rounded-2xl border border-white/5 shadow-xl animate-fadeIn";

                div.innerHTML = `
                <div class="flex flex-col md:flex-row md:items-center justify-between mb-6 gap-4">
                    <div class="flex items-center gap-3">
                        <div class="w-12 h-12 rounded-xl bg-gradient-to-tr from-brand-red/20 to-orange-500/20 flex items-center justify-center border border-brand-red/30">
                            <i class="ph-duotone ph-bell-ringing text-2xl text-brand-red animate-bounce"></i>
                        </div>
                        <div>
                            <h3 class="font-bold text-xl text-white">${camSummary.camera_name}</h3>
                            <p class="text-xs text-gray-400">Camera ID: ${camSummary.camera_id}</p>
                        </div>
                    </div>
                    
                    <div class="flex items-center gap-4">
                        <div class="bg-green-500/10 border border-green-500/20 px-4 py-2 rounded-xl">
                            <div class="text-[10px] font-bold text-green-400 uppercase tracking-widest mb-1">Total IN</div>
                            <div class="text-2xl font-black text-white">${camSummary.total_in}</div>
                        </div>
                        <div class="bg-red-500/10 border border-red-500/20 px-4 py-2 rounded-xl">
                            <div class="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">Total OUT</div>
                            <div class="text-2xl font-black text-white">${camSummary.total_out}</div>
                        </div>
                    </div>
                </div>

                <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
                    ${camSummary.alerts.length > 0
                        ? camSummary.alerts.map(a => {
                            const isIn = a.message.toUpperCase().includes("IN");
                            const badgeClass = isIn ? "bg-green-500" : "bg-red-500";
                            const timeStr = new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                            const imageSrc = a.image ? `${API}/${a.image}` : null;

                            return `
                            <div class="group relative aspect-video rounded-lg overflow-hidden bg-dark-800 border border-white/5">
                                ${imageSrc
                                    ? `<img src="${imageSrc}" class="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500">`
                                    : `<div class="w-full h-full flex items-center justify-center"><i class="ph-duotone ph-image text-xl text-gray-700"></i></div>`
                                }
                                <div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2">
                                    <div class="flex items-center justify-between">
                                        <span class="text-[9px] font-mono text-gray-400">${timeStr}</span>
                                        <span class="w-2 h-2 rounded-full ${badgeClass}"></span>
                                    </div>
                                </div>
                                <a href="${imageSrc}" target="_blank" class="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <i class="ph-bold ph-magnifying-glass-plus text-white text-lg"></i>
                                </a>
                            </div>
                            `;
                        }).join('')
                        : '<div class="col-span-full py-4 text-center text-gray-600 text-sm">No recent images for this camera</div>'
                    }
                </div>
                `;
                list.appendChild(div);
            });
        });
}

function setMode(mode) {
    drawMode = mode;
    points = [];
    alert("Mode: " + mode.toUpperCase());
}

/* ============================
   Navigation
============================ */
function switchView(view) {
    // Hide all main sections
    const stats = document.getElementById("section-stats");
    const cameras = document.getElementById("section-cameras");
    const alerts = document.getElementById("section-alerts");
    const settings = document.getElementById("section-settings");
    const gallery = document.getElementById("section-gallery");
    const configs = document.getElementById("section-configs");
    const yolo = document.getElementById("section-yolo");
    const deployments = document.getElementById("section-deployments");
    const preview = document.getElementById("previewSection"); // Always hide preview on switch? maybe.

    if (!stats || !cameras || !alerts || !settings || !gallery || !configs || !yolo || !deployments) return;

    // Default: Reset visibilty
    stats.classList.remove("hidden");
    cameras.classList.remove("hidden");
    alerts.classList.remove("hidden");
    settings.classList.add("hidden");
    gallery.classList.add("hidden");
    configs.classList.add("hidden");
    yolo.classList.add("hidden");
    deployments.classList.add("hidden");

    // Sidebar active states
    document.querySelectorAll("nav button").forEach(btn => {
        btn.classList.remove("bg-white/5", "text-white", "border-white/5");
        btn.classList.add("text-gray-400", "border-transparent");
        // Reset icon color
        const icon = btn.querySelector("i");
        if (icon) icon.className = icon.className.replace("text-white", "text-gray-400"); // Simple hack, better done with classList logic
    });

    const activeBtn = document.getElementById(`nav-${view}`);
    if (activeBtn) {
        activeBtn.classList.add("bg-white/5", "text-white", "border-white/5");
        activeBtn.classList.remove("text-gray-400", "border-transparent");
    }

    if (view === "dashboard") {
        // Show Everything (Default)
        // Ensure Stats Visible
        stats.style.display = "grid";
    } else if (view === "cameras") {
        // Hide Stats, Alerts. Show Cameras.
        stats.classList.add("hidden");
        alerts.classList.add("hidden");
    } else if (view === "alerts") {
        // Hide Stats, Cameras. Show Alerts.
        stats.classList.add("hidden");
        cameras.classList.add("hidden");

        // Ensure Alerts is full view? 
        // We might want to expand the grid or remove limit if we had one.
    } else if (view === "settings") {
        // Hide Everything. Show Settings.
        stats.classList.add("hidden");
        cameras.classList.add("hidden");
        alerts.classList.add("hidden");
        preview.classList.add("hidden"); // Force close preview

        settings.classList.remove("hidden");
    } else if (view === "gallery") {
        // Hide Everything. Show Gallery.
        stats.classList.add("hidden");
        cameras.classList.add("hidden");
        alerts.classList.add("hidden");
        settings.classList.add("hidden");
        preview.classList.add("hidden");

        gallery.classList.remove("hidden");
        loadGallery();
    } else if (view === "configs") {
        // Hide Everything. Show Configs.
        stats.classList.add("hidden");
        cameras.classList.add("hidden");
        alerts.classList.add("hidden");
        settings.classList.add("hidden");
        gallery.classList.add("hidden");
        preview.classList.add("hidden");

        configs.classList.remove("hidden");
        loadConfigs();
    } else if (view === "yolo") {
        // Hide Everything. Show YOLO.
        stats.classList.add("hidden");
        cameras.classList.add("hidden");
        alerts.classList.add("hidden");
        settings.classList.add("hidden");
        gallery.classList.add("hidden");
        configs.classList.add("hidden");
        preview.classList.add("hidden");

        yolo.classList.remove("hidden");
        loadYoloCameras();
    } else if (view === "deployments") {
        // Hide Everything. Show Deployments.
        stats.classList.add("hidden");
        cameras.classList.add("hidden");
        alerts.classList.add("hidden");
        settings.classList.add("hidden");
        gallery.classList.add("hidden");
        configs.classList.add("hidden");
        yolo.classList.add("hidden");
        preview.classList.add("hidden");

        deployments.classList.remove("hidden");
        loadDeployments();
    }
}

window.onload = function () {
    loadCameras();
    loadAlerts();
    loadStats();
    setInterval(() => {
        loadAlerts();
        loadStats();
    }, 3000);
};

/* ============================
   Media Tools (Upload to Gallery)
============================ */

async function uploadMedia(blob, filename) {
    const formData = new FormData();
    formData.append("file", blob, filename);

    try {
        const res = await fetch(`${API}/gallery/upload`, {
            method: "POST",
            body: formData
        });
        const data = await res.json();

        // Notify user
        alert("Saved to Gallery!");
    } catch (err) {
        console.error("Upload failed", err);
        alert("Upload failed");
    }
}

function takeScreenshot() {
    const video = document.getElementById("videoStream");
    const canvas = document.createElement("canvas");
    canvas.width = video.naturalWidth || video.width;
    canvas.height = video.naturalHeight || video.height;
    const ctx = canvas.getContext("2d");

    // Draw image
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Draw overlays
    const drawCanvas = document.getElementById("drawCanvas");
    if (drawCanvas) {
        ctx.drawImage(drawCanvas, 0, 0, canvas.width, canvas.height);
    }

    canvas.toBlob(blob => {
        uploadMedia(blob, `screenshot_${Date.now()}.png`);
    }, 'image/png');
}

let mediaRecorder;
let recordedChunks = [];

async function toggleRecording() {
    const btn = document.getElementById("recordBtn");
    const text = document.getElementById("recordText");
    const icon = btn.querySelector("i");

    if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        text.innerText = "Record";
        icon.classList.remove("text-red-500", "animate-pulse");
        btn.classList.remove("bg-red-500/10", "border-red-500/50");
    } else {
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({
                video: { mediaSource: "screen" }
            });

            mediaRecorder = new MediaRecorder(stream);
            recordedChunks = [];

            mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) recordedChunks.push(e.data);
            };

            mediaRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: "video/webm" });
                uploadMedia(blob, `recording_${Date.now()}.webm`);

                // Stop tracks
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.start();
            text.innerText = "Stop Rec";
            icon.classList.add("text-red-500", "animate-pulse");
            btn.classList.add("bg-red-500/10", "border-red-500/50");

        } catch (err) {
            console.error("Error: " + err);
        }
    }
}

function loadGallery() {
    fetch(`${API}/gallery`)
        .then(res => res.json())
        .then(data => {
            const grid = document.getElementById("galleryGrid");
            if (!grid) return;

            grid.innerHTML = "";

            if (data.length === 0) {
                grid.innerHTML = `<div class="col-span-full text-center text-gray-500 py-10">No items yet</div>`;
                return;
            }

            data.forEach(item => {
                const div = document.createElement("div");
                div.className = "glass-card rounded-xl overflow-hidden group relative border border-white/5";

                let content = "";
                if (item.type === "video") {
                    content = `<video src="${API}${item.url}" controls class="w-full aspect-video object-cover"></video>`;
                } else {
                    content = `<img src="${API}${item.url}" class="w-full aspect-video object-cover transition-transform group-hover:scale-105">`;
                }

                div.innerHTML = `
                ${content}
                <div class="p-3 bg-black/40 backdrop-blur-sm">
                    <div class="text-xs text-gray-300 truncate">${item.filename}</div>
                    <div class="text-[10px] text-gray-500">${new Date(item.created * 1000).toLocaleString()}</div>
                     <a href="${API}${item.url}" download class="absolute top-2 right-2 bg-black/60 text-white p-1 rounded hover:bg-brand-red opacity-0 group-hover:opacity-100 transition-opacity">
                        <i class="ph-bold ph-download-simple"></i>
                    </a>
                </div>
            `;
                grid.appendChild(div);
            });
        });
}

function loadConfigs() {
    fetch(`${API}/configs`)
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById("configFileList");
            if (!list) return;

            list.innerHTML = "";

            if (data.length === 0) {
                list.innerHTML = `<div class="text-center text-gray-500 py-4 italic">No configs found</div>`;
                return;
            }

            data.forEach(filename => {
                const btn = document.createElement("button");
                btn.className = "w-full flex items-center gap-3 px-4 py-3 rounded-xl bg-white/5 hover:bg-white/10 text-gray-300 transition-all text-left border border-white/5 group";
                btn.onclick = () => viewConfig(filename);
                btn.innerHTML = `
                    <i class="ph-bold ph-file-js text-brand-red"></i>
                    <span class="text-sm font-medium truncate">${filename}</span>
                    <i class="ph-bold ph-caret-right ml-auto opacity-0 group-hover:opacity-100 transition-opacity"></i>
                `;
                list.appendChild(btn);
            });
        });
}

async function viewConfig(filename) {
    const area = document.getElementById("configContentArea");
    if (!area) return;

    area.innerHTML = `<div class="h-full flex items-center justify-center"><i class="ph-bold ph-spinner animate-spin text-2xl"></i></div>`;

    try {
        const res = await fetch(`${API}/configs/${filename}`);
        const data = await res.json();

        area.innerHTML = `
            <div class="flex items-center justify-between mb-4 border-b border-white/5 pb-4">
                <div>
                    <h2 class="font-bold text-lg text-white">${filename}</h2>
                    <p class="text-xs text-gray-400">Application Configuration Data</p>
                </div>
                <button onclick="navigator.clipboard.writeText(JSON.stringify(${JSON.stringify(data)}, null, 4)); alert('Copied!')" class="text-xs bg-white/5 hover:bg-white/10 px-3 py-1 rounded border border-white/10 transition-colors">
                    Copy JSON
                </button>
            </div>
            <pre class="bg-black/50 p-4 rounded-xl overflow-auto text-xs text-green-400 font-mono scrollbar-thin"><code>${JSON.stringify(data, null, 4)}</code></pre>
        `;
    } catch (err) {
        area.innerHTML = `<p class="text-red-500">Error loading config: ${err}</p>`;
    }
}
/* ============================
   YOLO Live Detections
============================ */
function loadYoloCameras() {
    fetch(`${API}/cameras`)
        .then(res => res.json())
        .then(data => {
            const list = document.getElementById("yoloCameraList");
            if (!list) return;

            list.innerHTML = "";

            if (data.length === 0) {
                list.innerHTML = '<div class="text-center text-gray-500 py-10 italic">Add cameras to view YOLO detections</div>';
                return;
            }

            data.forEach(cam => {
                const div = document.createElement("div");
                div.className = "glass-panel p-4 rounded-xl border border-white/5 flex items-center justify-between group hover:bg-white/5 transition-all";

                div.innerHTML = `
                    <div class="flex items-center gap-3 overflow-hidden">
                        <div class="w-10 h-10 rounded-lg bg-brand-red/10 flex items-center justify-center text-brand-red border border-brand-red/20 group-hover:bg-brand-red group-hover:text-white transition-all">
                            <i class="ph-bold ph-video-camera"></i>
                        </div>
                        <div class="overflow-hidden">
                            <h3 class="font-bold text-sm text-white truncate">${cam.name}</h3>
                            <p class="text-[10px] text-gray-500 truncate">${cam.url}</p>
                        </div>
                    </div>
                    <button onclick="viewYoloStream(${cam.id}, '${cam.name}')" class="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-brand-red text-white text-[10px] font-bold border border-white/10 transition-all">
                        View Detection
                    </button>
                `;
                list.appendChild(div);
            });
        });
}

function viewYoloStream(id, name) {
    const container = document.getElementById("yoloStreamContainer");
    if (!container) return;

    container.innerHTML = `
        <img src="${API}/camera/${id}/yolo_stream" class="w-full h-full object-contain bg-black" onerror="yoloStreamError(this)">
        <div class="absolute top-4 left-4 flex items-center gap-2">
            <span class="px-2 py-1 bg-brand-red text-white text-[10px] font-black rounded uppercase flex items-center gap-1.5">
                <span class="w-1.5 h-1.5 bg-white rounded-full animate-pulse"></span>
                Live AI
            </span>
            <span class="px-2 py-1 bg-black/60 backdrop-blur-md text-white text-[10px] font-bold rounded border border-white/10">
                ${name}
            </span>
        </div>
        <div class="absolute bottom-4 right-4 text-white/40 text-[10px] font-mono">
            YOLOv8 Real-time Inference Active
        </div>
    `;
}

function yoloStreamError(img) {
    img.parentElement.innerHTML = `
        <div class="text-center text-red-400 p-8">
            <i class="ph-bold ph-warning-circle text-5xl mb-4"></i>
            <p class="font-bold">Stream Connection Failed</p>
            <p class="text-xs opacity-60 mt-1">Ensure the camera is online and RTSP URL is correct.</p>
        </div>
    `;
}

/* ============================
   Active Deployments Monitoring
============================ */
function loadDeployments() {
    console.log("DEBUG: loadDeployments() called");
    const list = document.getElementById("deploymentList");
    if (!list) return;

    list.innerHTML = `
        <div class="flex items-center justify-center py-20">
            <i class="ph-bold ph-spinner animate-spin text-4xl text-brand-red"></i>
        </div>
    `;

    fetch(`${API}/deployments/active`)
        .then(res => res.json())
        .then(data => {
            console.log("DEBUG: Active deployments data:", data);
            if (data.length === 0) {
                list.innerHTML = `
                    <div class="glass-panel p-12 rounded-2xl border border-white/5 text-center">
                        <i class="ph-duotone ph-ghost text-6xl text-gray-700 mb-4"></i>
                        <p class="text-gray-500 font-medium">No active camera deployments found.</p>
                        <p class="text-xs text-gray-600 mt-2">Deploy a camera from the dashboard to see it here.</p>
                    </div>
                `;
                return;
            }

            list.innerHTML = "";
            data.forEach(dep => {
                const card = document.createElement("div");
                card.className = "glass-panel p-6 rounded-2xl border border-white/5 animate-fadeIn relative overflow-hidden group mb-4";

                const polyCount = dep.config.polygon ? dep.config.polygon.length : 0;
                const lineActive = dep.config.line ? "Active" : "None";

                card.innerHTML = `
                    <div class="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
                        <div class="flex items-center gap-5">
                            <div class="w-14 h-14 rounded-2xl bg-brand-red/10 flex items-center justify-center text-brand-red border border-brand-red/20 shadow-lg shadow-brand-red/5">
                                <i class="ph-duotone ph-rocket-launch text-2xl"></i>
                            </div>
                            <div>
                                <div class="flex items-center gap-3 mb-1">
                                    <h3 class="font-bold text-lg text-white">${dep.camera_name}</h3>
                                    <span class="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-black uppercase tracking-wider border border-emerald-500/20 flex items-center gap-1.5">
                                        <span class="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse"></span>
                                        ${dep.status}
                                    </span>
                                </div>
                                <p class="text-xs text-gray-500 font-mono text-blue-400 underline cursor-pointer" onclick="window.open('${dep.url}', '_blank')">${dep.url}</p>
                            </div>
                        </div>

                        <div class="flex items-center gap-8 px-6 py-3 bg-white/5 rounded-xl border border-white/5">
                            <div class="text-center">
                                <p class="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">Polygon Pts</p>
                                <p class="text-xl font-bold text-white font-mono">${polyCount}</p>
                            </div>
                            <div class="w-px h-8 bg-white/10"></div>
                            <div class="text-center">
                                <p class="text-[10px] text-gray-500 uppercase font-black tracking-widest mb-1">Line Rules</p>
                                <p class="text-xl font-bold text-brand-red font-mono">${lineActive}</p>
                            </div>
                        </div>

                        <div class="flex items-center gap-2">
                             <button onclick="toggleDeploymentJSON(${dep.camera_id})" class="px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-white text-xs font-bold border border-white/10 transition-all flex items-center gap-2">
                                <i class="ph-bold ph-code"></i> View Active JSON
                            </button>
                        </div>
                    </div>

                    <div id="json_viewer_${dep.camera_id}" class="hidden mt-6 animate-slideDown overflow-hidden border-t border-white/5 pt-6">
                        <div class="flex items-center justify-between mb-3 px-1">
                            <p class="text-[10px] text-gray-500 uppercase font-black tracking-widest">Active Configuration Layer</p>
                            <button onclick="copyDeploymentJSON(${dep.camera_id})" class="text-[10px] text-brand-red hover:underline font-bold">Copy JSON</button>
                        </div>
                        <pre id="json_content_${dep.camera_id}" class="bg-black/40 p-5 rounded-xl text-[11px] text-emerald-400 font-mono overflow-auto max-h-96 scrollbar-thin border border-white/5">${JSON.stringify(dep.config, null, 4)}</pre>
                    </div>
                `;
                list.appendChild(card);
            });
        })
        .catch(err => {
            console.error("DEBUG: Error loading deployments:", err);
            list.innerHTML = `<p class="text-red-500 p-10 text-center">Error loading deployments: ${err}</p>`;
        });
}

function toggleDeploymentJSON(id) {
    const el = document.getElementById(`json_viewer_${id}`);
    if (el) {
        el.classList.toggle("hidden");
    }
}

function copyDeploymentJSON(id) {
    const el = document.getElementById(`json_content_${id}`);
    if (el) {
        navigator.clipboard.writeText(el.innerText).then(() => {
            alert("JSON copied to clipboard!");
        });
    }
}
