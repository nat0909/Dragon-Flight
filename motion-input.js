// Distances use the same units as the incoming tracker data.
const MOTION_CONFIG = {
  url: "ws://127.0.0.1:8080",
  halfRangeX: 20,
  halfRangeY: 20,
  invertX: false,
  invertY: true,
  propId: "",
  staleMs: 500
};

// Keys 1-3 pick how far a hand or mouse movement carries the dragon; 1 moves it least.
const MOVEMENT_SCALES = { 1: 0.75, 2: 1, 3: 1.5 };
let movementLevel = 2;

function movementScale() {
  return MOVEMENT_SCALES[movementLevel];
}

class MotionInput {
  constructor(config, now = () => performance.now()) {
    this.config = config;
    this.now = now;
    this.socket = null;
    this.latest = null;
    this.origin = null;
    this.selectedId = null;
    this.receivedAt = -Infinity;
    this.status = "Disconnected";
  }

  connect() {
    this.disconnect();
    this.status = "Connecting";
    try {
      const socket = new WebSocket(this.config.url);
      this.socket = socket;
      socket.onopen = () => {
        if (this.socket === socket) this.status = "Connected; waiting for position";
      };
      socket.onmessage = event => {
        if (this.socket !== socket) return;
        try { this.accept(JSON.parse(event.data)); }
        catch { this.status = "Invalid tracker message"; }
      };
      socket.onerror = () => {
        if (this.socket === socket) this.status = "Connection error";
      };
      socket.onclose = () => {
        if (this.socket === socket) {
          this.latest = null;
          this.status = "Disconnected";
        }
      };
    } catch {
      this.status = "Invalid WebSocket URL";
    }
  }

  disconnect() {
    const previous = this.socket;
    this.socket = null;
    if (previous) previous.close();
    this.latest = null;
    this.origin = null;
    this.selectedId = null;
    this.receivedAt = -Infinity;
    this.status = "Disconnected";
  }

  accept(message) {
    // LiveMotion uses props[].pos; simple bridges may send pos or x/y directly.
    if (!message || typeof message !== "object") return false;
    let prop = message;
    if (Array.isArray(message.props)) {
      const wanted = this.config.propId !== "" ? this.config.propId : this.selectedId;
      prop = wanted !== null
        ? message.props.find(item => item && String(item.id) === String(wanted))
        : message.props[0];
      if (!prop) return false;
    }
    if (prop.valid === false || prop.tracked === false) return false;
    const position = prop.pos || prop.position || prop;
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) return false;
    if (prop.id !== undefined && prop.id !== null) {
      const wanted = this.config.propId !== "" ? this.config.propId : this.selectedId;
      if (wanted !== null && String(prop.id) !== String(wanted)) return false;
      this.selectedId = prop.id;
    }
    this.latest = { x: position.x, y: position.y };
    this.receivedAt = this.now();
    this.status = "Tracking";
    return true;
  }

  fresh() {
    return this.latest !== null && this.now() - this.receivedAt <= this.config.staleMs;
  }

  captureOrigin() {
    if (!this.fresh()) return false;
    this.origin = { ...this.latest };
    return true;
  }

  target(bounds) {
    if (!this.fresh() || !this.origin) return null;
    const clamp = value => Math.max(-1, Math.min(1, value));
    const x = clamp((this.latest.x - this.origin.x) * movementScale() / this.config.halfRangeX)
      * (this.config.invertX ? -1 : 1);
    const y = clamp((this.latest.y - this.origin.y) * movementScale() / this.config.halfRangeY)
      * (this.config.invertY ? -1 : 1);
    return {
      x: (bounds.minX + bounds.maxX) / 2 + x * (bounds.maxX - bounds.minX) / 2,
      y: (bounds.minY + bounds.maxY) / 2 + y * (bounds.maxY - bounds.minY) / 2
    };
  }
}

const motionInput = new MotionInput(MOTION_CONFIG);
let motionEnabled = false;
let motionNotice = "";

function setupMotionControls() {
  const panel = document.createElement("section");
  panel.id = "motion-controls";
  panel.innerHTML = `
    <label><input id="motion-enabled" type="checkbox"> Motion tracker</label>
    <label>WebSocket URL <input id="motion-url" value="ws://127.0.0.1:8080"></label>
    <label>Prop ID <input id="motion-id" placeholder="First tracked prop"></label>
    <label>X half-range <input id="motion-range-x" type="number" min="0.001" step="any" value="20"></label>
    <label>Y half-range <input id="motion-range-y" type="number" min="0.001" step="any" value="20"></label>
    <label><input id="motion-invert-x" type="checkbox"> Invert X</label>
    <label><input id="motion-invert-y" type="checkbox" checked> Invert Y</label>
    <button id="motion-connect" type="button">Connect</button>
    <button id="motion-resume" type="button">Resume</button>
    <button id="game-fullscreen" type="button">Play fullscreen</button>
    <output id="motion-status">Mouse / keyboard mode</output>
    <small>Half-ranges use tracker units. XY is captured after the 3-second countdown. Z is ignored.</small>
  `;
  document.querySelector("main").prepend(panel);
  const field = id => document.getElementById(id);
  field("motion-enabled").onchange = event => {
    motionEnabled = event.target.checked;
    motionNotice = "";
    scene = "start";
    held = { left: false, right: false, up: false, down: false };
    velocityX = velocityY = 0;
    controlMode = motionEnabled ? "tracker" : "keyboard";
    if (!motionEnabled) motionInput.disconnect();
  };
  field("motion-connect").onclick = () => {
    const rangeX = Number(field("motion-range-x").value);
    const rangeY = Number(field("motion-range-y").value);
    if (!(Number.isFinite(rangeX) && rangeX > 0 && Number.isFinite(rangeY) && rangeY > 0)) {
      motionNotice = "Enter positive, finite half-ranges.";
      return;
    }
    motionEnabled = true;
    field("motion-enabled").checked = true;
    scene = "start";
    Object.assign(MOTION_CONFIG, {
      url: field("motion-url").value.trim(),
      propId: field("motion-id").value.trim(),
      halfRangeX: rangeX,
      halfRangeY: rangeY,
      invertX: field("motion-invert-x").checked,
      invertY: field("motion-invert-y").checked
    });
    motionNotice = "";
    controlMode = "tracker";
    motionInput.connect();
  };
  field("motion-resume").onclick = resumeMotionGame;
  field("game-fullscreen").onclick = async () => {
    try {
      await document.getElementById("game-stage").requestFullscreen();
      canvas.elt.focus();
    } catch {
      motionNotice = "Fullscreen unavailable. Use your browser's fullscreen command.";
      field("motion-status").textContent = motionNotice;
    }
  };
  // Buttons and text fields keep their native keyboard behavior.
  panel.addEventListener("keydown", event => event.stopPropagation());
  panel.addEventListener("keyup", event => event.stopPropagation());
}

function resumeMotionGame() {
  if (scene === "paused" && motionInput.fresh() && motionInput.origin) {
    scene = "playing";
    motionNotice = "";
  }
}

function updateMotionStatus() {
  const output = document.getElementById("motion-status");
  if (!output) return;
  const state = motionInput.fresh() ? "Tracking" : motionInput.status === "Tracking"
    ? "Position data timed out" : motionInput.status;
  output.textContent = motionEnabled
    ? (motionNotice || state) + (motionInput.origin ? " | Origin captured" : " | Waiting for game start")
    : "Mouse / keyboard mode";
}
