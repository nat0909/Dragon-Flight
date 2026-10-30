
const GW = 900;
const GH = 600;
const SEA = 310;

const DRAGON_W = 258;
const DRAGON_H = 174;

const MIN_X = 133;
const MAX_X = GW - 133;
const MIN_Y = 93;
const MAX_Y = GH - 91;

// Round length in seconds; change to 90 or 120 for longer sessions.
const ROUND_DURATION_SECONDS = 60;
const ROUND_DURATION_MS = ROUND_DURATION_SECONDS * 1000;
const FINAL_COUNTDOWN_MS = 10000;
// Caps one frame's timer step so a sleeping tab cannot drain the clock.
const MAX_TIMER_STEP_MS = 100;

// Victory sequence timing, measured from the moment time runs out.
const VICTORY_FLIGHT_MS = 2600;
const VICTORY_FADE_START_MS = 2000;
const VICTORY_SCREEN_MS = 3200;
const HOME_X = GW / 2;

let dragonSprite, rockSprite;
let homeSprite;
let mountainSprite;
// Press I to swap the plain score for the score plus position debugging readout.
let showDebugHud = false;
// Viking-style lettering for all on-screen text except the I-key debug readout.
let gameFont = null;
const FLIGHT_FRAME_MS = 80;
let rockSprites = {};
const FLIGHT_FRAME_PATHS = Array.from({ length: 6 }, (_, index) =>
  "assets/dragon-flight/flight-" + String(index + 1).padStart(2, "0") + ".png");
let dragonFrames = [];
let flightAnimationMs = 0;
let ready = false;
let loadError = "";
let scene = "start";
const PREPARATION_MS = 3000;
let countdownEndsAt = 0;
let canvas;

let playerX = GW / 2;
let playerY = 445;
let velocityX = 0;
let velocityY = 0;

let mouseGoalX = playerX;
let mouseGoalY = playerY;
let controlMode = "keyboard";

let held = {
  left: false,
  right: false,
  up: false,
  down: false
};

let rocks = [];
let score = 0;
let bestScore = 0;
let elapsed = 0;
let spawnClock = 65;
let rockSpeed = 0.0062;
let shake = 0;
let timeLeftMs = ROUND_DURATION_MS;
let victoryStartedAt = 0;
let victoryFrom = null;
let newBest = false;

// ==========================================
// SETUP
// ==========================================

async function setup() {
  canvas = createCanvas(GW, GH);
  const stage = document.createElement("div");
  stage.id = "game-stage";
  document.querySelector("main").append(stage);
  stage.append(canvas.elt);

  frameRate(60);
  textFont("Arial");
  setupOcean();
  setupMotionControls();

  canvas.elt.tabIndex = 0;
  canvas.elt.style.outline = "none";

  canvas.mousePressed(() => {
    canvas.elt.focus();

    if (scene === "paused") {
      resumeMotionGame();
    } else if (ready && scene !== "playing") {
      startGame();
    } else if (scene === "playing") {
      aimAt(mouseX, mouseY);
    }
  });

  // Optional: without the font file the text falls back to a plain serif.
  loadFont("assets/fonts/Metamorphous-Regular.ttf")
    .then(font => { gameFont = font; })
    .catch(() => {});

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);

  window.addEventListener("blur", () => {
    if (motionEnabled && scene === "playing") scene = "paused";
    // Do not capture an origin while the player is in another window.
    if (scene === "countdown") scene = "start";
    held = {
      left: false,
      right: false,
      up: false,
      down: false
    };
  });

  try {
    const [frames, rock, tallRock, shortRock, sheep, home, blackSheep, mountains] = await Promise.all([
      Promise.all(FLIGHT_FRAME_PATHS.map(path => loadImage(path))),
      loadImage("rock.jpeg"),
      loadImage("assets/obstacles/rock-tall.png"),
      loadImage("assets/obstacles/rock-short.png"),
      loadImage("sheep.jpg"),
      loadImage("home.png?v=20261030-1"),
      loadImage("blacksheep2.png?v=20261028-1"),
      loadImage("mountainsnobackground.png?v=20261030-1")
    ]);

    // Preserve the shared source canvas so wing motion does not rescale the body.
    dragonFrames = frames.map(frame => {
      const sprite = removeBackground(frame, false);
      sprite.loadPixels();
      return sprite;
    });
    dragonSprite = dragonFrames[0];
    prepareCrashSprites(dragonFrames);
    rockSprite = removeBackground(rock);
    dragonSprite.loadPixels();
    rockSprite.loadPixels();
    rockSprites = {
      medium: rockSprite,
      tall: removeBackground(tallRock),
      short: removeBackground(shortRock)
    };
    Object.values(rockSprites).forEach(sprite => sprite.loadPixels());
    prepareRockPatterns();
    setupSheep(sheep, blackSheep);
    homeSprite = defringe(trimTransparentSprite(home));
    mountainSprite = muteMountains(trimTransparentSprite(mountains));

    ready = true;
  } catch (err) {
    loadError = "Could not load dragon flight frames, obstacle, sheep or home images";
    console.error(err);
  }
}

// ==========================================
// REMOVE WHITE BACKGROUND
// ==========================================

// Preserve native PNG transparency and trim only the empty outer canvas.
function trimTransparentSprite(source) {
  source.loadPixels();
  let left = source.width, top = source.height, right = -1, bottom = -1;
  for (let y = 0; y < source.height; y++) {
    for (let x = 0; x < source.width; x++) {
      if (source.pixels[(y * source.width + x) * 4 + 3] <= 24) continue;
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
    }
  }
  if (right < left) return source.get();
  return source.get(left, top, right - left + 1, bottom - top + 1);
}

// Distant mountains lose colour: pull each pixel toward grey, then toward the cool sky haze.
// The peaks keep more colour; greying deepens toward the misty feet.
function muteMountains(sprite) {
  const topDesaturate = 0.35;
  const bottomDesaturate = 0.75;
  const airTint = 0.22;
  const air = [168, 190, 202];
  sprite.loadPixels();
  const px = sprite.pixels;
  // Pixel rows, not image rows, so this stays correct at any pixel density.
  const rows = sprite.height * sprite.pixelDensity();
  const rowLength = px.length / rows;
  for (let i = 0; i < px.length; i += 4) {
    const desaturate = lerp(topDesaturate, bottomDesaturate, Math.floor(i / rowLength) / (rows - 1));
    const grey = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    for (let c = 0; c < 3; c++) {
      const muted = px[i + c] + (grey - px[i + c]) * desaturate;
      px[i + c] = muted + (air[c] - muted) * airTint;
    }
  }
  sprite.updatePixels();
  return sprite;
}

// Pixels near the cut-out edge are a blend of the artwork and the white backdrop,
// which shows as a pale halo over the sky and sea. Within `band` pixels of the
// transparent area, split each colour back into artwork colour plus coverage.
function defringe(img, bg = 250, band = 3) {
  img.loadPixels();
  const d = img.pixelDensity();
  const w = img.width * d;
  const h = img.height * d;
  const px = img.pixels;
  const dist = new Uint8Array(w * h).fill(255);
  let frontier = [];
  for (let i = 0; i < w * h; i++) {
    if (px[i * 4 + 3] <= 24) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  for (let step = 1; step <= band; step++) {
    const next = [];
    for (const i of frontier) {
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (n < 0 || n >= w * h || dist[n] !== 255) continue;
        dist[n] = step;
        next.push(n);
      }
    }
    frontier = next;
  }
  for (let i = 0; i < w * h; i++) {
    if (dist[i] === 0 || dist[i] > band) continue;
    const p = i * 4;
    let cover = 0;
    for (let c = 0; c < 3; c++) cover = Math.max(cover, (bg - px[p + c]) / bg);
    if (cover <= 0) {
      px[p + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      px[p + c] = constrain((px[p + c] - bg * (1 - cover)) / cover, 0, 255);
    }
    px[p + 3] = Math.min(px[p + 3], Math.round(cover * 255));
  }
  img.updatePixels();
  return img;
}

function removeBackground(source, crop = true) {
  const out = source.get();

  out.loadPixels();

  let left = out.width;
  let top = out.height;
  let right = -1;
  let bottom = -1;

  const px = out.pixels;
  const pw = out.width;

  px.forEach((_, i) => {
    if (i % 4 !== 0) return;

    const r = px[i];
    const g = px[i + 1];
    const b = px[i + 2];

    const low = Math.min(r, g, b);
    const high = Math.max(r, g, b);

    let opacity = 255;

    if (low > 209 && high - low < 25) {
      opacity = Math.max(
        0,
        Math.min(255, (242 - low) * 9)
      );
    }

    px[i + 3] = opacity;

    if (opacity > 24) {
      const x = (i / 4) % pw;
      const y = Math.floor((i / 4) / pw);

      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  });

  out.updatePixels();
  defringe(out);
  if (!crop) return out;

  if (right < left) return out;

  const x1 = Math.max(0, left - 2);
  const y1 = Math.max(0, top - 2);
  const x2 = Math.min(out.width - 1, right + 2);
  const y2 = Math.min(out.height - 1, bottom + 2);

  return out.get(
    x1,
    y1,
    x2 - x1 + 1,
    y2 - y1 + 1
  );
}

// ==========================================
// START GAME
// ==========================================

function startGame() {
  // A crash must finish falling and splashing before Game Over accepts a restart.
  if (scene === "countdown" || scene === "crashing") return;
  // Ignore stray input while the victory flight is still playing.
  if (scene === "victory" && !victoryScreenReady()) return;
  if (motionEnabled && !motionInput.fresh()) {
    motionNotice = "Start blocked: waiting for fresh tracker position.";
    return;
  }
  motionNotice = "";
  scene = "countdown";
  countdownEndsAt = performance.now() + PREPARATION_MS;
  motionInput.origin = null;

  playerX = GW / 2;
  playerY = motionEnabled ? (MIN_Y + MAX_Y) / 2 : 445;

  velocityX = 0;
  velocityY = 0;

  mouseGoalX = playerX;
  mouseGoalY = playerY;

  controlMode = motionEnabled ? "tracker" : "keyboard";

  held = {
    left: false,
    right: false,
    up: false,
    down: false
  };

  rocks = [];
  resetCrash();
  resetSheep();
  resetPacing();
  score = 0;
  elapsed = 0;
  timeLeftMs = ROUND_DURATION_MS;
  victoryFrom = null;
  newBest = false;
  flightAnimationMs = 0;
  dragonSprite = dragonFrames[0];

  spawnClock = 55;
  rockSpeed = difficultyAt(0).speed;
  shake = 0;
}

function updateCountdown() {
  if (performance.now() < countdownEndsAt) return;
  if (motionEnabled && !motionInput.captureOrigin()) {
    motionNotice = "Waiting for fresh tracker position. Hold your starting pose.";
    return;
  }
  motionNotice = "";
  scene = "playing";
}

function drawCountdown() {
  noStroke();
  fill(4, 16, 23, 185);
  rect(0, 0, GW, GH);
  fill(255);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(88);
  const remaining = Math.ceil((countdownEndsAt - performance.now()) / 1000);
  text(remaining > 0 ? remaining : "WAIT", GW / 2, 250);
  textStyle(NORMAL);
  textSize(22);
  text("GET READY", GW / 2, 335);
  textSize(17);
  text(motionEnabled
    ? (remaining > 0 ? "Your XY origin will be captured when the countdown ends."
      : "Waiting for tracker data. Hold your starting pose.")
    : "Dodge the rocks and catch the sheep.\nSurvive 60 seconds to get home!", GW / 2, 380);
    
}

// ==========================================
// DRAW
// ==========================================

function updateDragonAnimation() {
  // The crash sequence drives its own wing animation.
  if (!dragonFrames.length || scene === "paused" || scene === "gameover" || scene === "crashing") return;
  flightAnimationMs += Math.max(0, Math.min(deltaTime, 100));
  const frameIndex = Math.floor(flightAnimationMs / FLIGHT_FRAME_MS) % dragonFrames.length;
  // Rendering and pixel collision share this exact frame for the entire draw cycle.
  dragonSprite = dragonFrames[frameIndex];
}

function draw() {
  textFont(gameFont || "Georgia");
  updateMotionStatus();
  updateOcean();
  updateCamera();

  // World layers shift up together when the crash camera tilts down.
  push();
  translate(0, -cameraTilt);
  drawBackgroundScene();
  drawHome(homeVisibility());
  pop();

  if (!ready) {
    drawMessage(loadError || "Loading images...");
    return;
  }

  if (scene === "countdown") updateCountdown();
  updateDragonAnimation();

  if (scene === "playing") {
    updateGame();
  }

  if (crashActive()) updateCrash();
  if (scene === "victory") updateVictory();
  updateSheepVisuals();

  push();
  translate(0, -cameraTilt);

  if (shake > 0.1) {
    translate(
      random(-shake, shake),
      random(-shake, shake)
    );

    shake *= Math.pow(0.82, Math.min(deltaTime, 100) / 16.67);
  }

  rocks.sort((a, b) => a.depth - b.depth);

  for (const rock of rocks) {
    if (rock.depth <= 1 && !rockNearerThanSplash(rock)) rock.draw();
  }

  drawSheep();

  if (scene === "victory") drawVictoryDragon();
  else if (crashActive()) drawCrashScene();
  else drawDragon();

  for (const rock of rocks) {
    if (rock.depth > 1) rock.draw();
  }

  drawSheepEffects();

  pop();

  if (scene === "playing") {
    drawFinalCountdownGlow();
    drawHUD();
  }
  if (scene === "crashing") {
    // Score and timer stay frozen on screen while the dragon falls.
    push();
    drawingContext.globalAlpha = crashHudAlpha();
    drawHUD();
    pop();
  }
  if (scene === "victory") drawVictoryScreen();

  if (scene === "start") drawOverlay();
  if (scene === "gameover") {
    push();
    drawingContext.globalAlpha = gameOverFade();
    drawOverlay();
    pop();
  }
  if (scene === "countdown") drawCountdown();
  if (scene === "paused") {
    noStroke();
    fill(4, 16, 23, 210);
    rect(0, 0, GW, GH);
    fill(255);
    textAlign(CENTER, CENTER);
    textSize(28);
    text("TRACKER PAUSED", GW / 2, 245);
    textSize(18);
    text("Restore tracking, then click or press Space to resume.", GW / 2, 300);
    text("Your original starting position is preserved.", GW / 2, 337);
    fill(224, 239, 242);
    text("Time left: " + formatTime(timeLeftMs) + " (paused)", GW / 2, 385);
  }
}

// ==========================================
// GAME UPDATE
// ==========================================

function updateGame() {
  if (motionEnabled) {
    const target = motionInput.target({ minX: MIN_X, maxX: MAX_X, minY: MIN_Y, maxY: MAX_Y });
    if (!target) {
      scene = "paused";
      motionNotice = "Tracking interrupted. Restore tracking and resume.";
      return;
    }
    controlMode = "tracker";
    mouseGoalX = target.x;
    mouseGoalY = target.y;
  }
  const dt = constrain(
    deltaTime / 16.67,
    0.5,
    2
  );

  elapsed += dt;
  if (timeLeftMs > 0) score += dt * 0.11;
  timeLeftMs = Math.max(0, timeLeftMs - Math.min(deltaTime, MAX_TIMER_STEP_MS));

  // Approach speed follows the four-phase curve in difficulty.js.
  rockSpeed = difficultyAt(activePlaySeconds()).speed;

  // MOUSE MOVEMENT
  if (controlMode === "mouse" || controlMode === "tracker") {
    const oldX = playerX;
    const oldY = playerY;

    const follow = Math.min(1, 0.20 * dt);

    playerX = lerp(
      playerX,
      mouseGoalX,
      follow
    );

    playerY = lerp(
      playerY,
      mouseGoalY,
      follow
    );

    velocityX = (playerX - oldX) / dt;
    velocityY = (playerY - oldY) / dt;
  }

  // KEYBOARD MOVEMENT
  else {
    let dx =
      Number(held.right) - Number(held.left);

    let dy =
      Number(held.down) - Number(held.up);

    // Normalize diagonal speed
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }

    const steer = Math.min(1, 0.24 * dt);

    velocityX = lerp(
      velocityX,
      dx * 9,
      steer
    );

    velocityY = lerp(
      velocityY,
      dy * 9,
      steer
    );

    if (dx === 0) {
      velocityX *= Math.pow(0.80, dt);
    }

    if (dy === 0) {
      velocityY *= Math.pow(0.80, dt);
    }

    playerX += velocityX * dt;
    playerY += velocityY * dt;
  }

  // Keep entire dragon inside the screen
  playerX = constrain(playerX, MIN_X, MAX_X);
  playerY = constrain(playerY, MIN_Y, MAX_Y);

  // Spawn rocks
  spawnClock -= dt;

  if (timeLeftMs > 0 && spawnClock <= 0) {
    // Picks a formation for this phase and checks it leaves a reachable safe route.
    spawnClock = spawnPattern();
  }

  // Update rocks
  for (let i = rocks.length - 1; i >= 0; i--) {
    const rock = rocks[i];

    rock.depth += rockSpeed * dt;

    // Passed obstacles remain visible during exit but can never deal damage.
    if (rock.depth >= 1) {
      if (!rock.passed) {
        rock.passed = true;
        score += 15;
      }
      const g = rock.geometry();
      if (g.top > GH + 45 || rock.depth > 1.40) rocks.splice(i, 1);
      continue;
    }

    const contact = rock.depth >= 0.92 && touchesDragon(rock);
    if (contact) {
      crash(contact);
      return;
    }

  }

  // Sheep come after rocks, so a fatal hit on the same frame always wins.
  updateSheep(dt);

  // Collisions are resolved first, so a crash on the final frame still ends the round.
  // Keep flying through the last existing waves before starting the fixed-camera ending.
  if (timeLeftMs <= 0 && rocks.length === 0) winRound();
}

// ==========================================
// ROCK CLASS
// ==========================================

// Wave formations are chosen in difficulty.js; `sizeBoost` widens later rocks.
class OceanRock {
  constructor(targetX, kind = randomRockKind(), sizeBoost = 0) {
    this.targetX = targetX;
    this.depth = 0;
    this.targetWidth = random(145, 190) * (1 + sizeBoost);

    // Tall pillars reach the upper flight area; shorter ones allow flying over.
    this.kind = kind;
    this.sprite = rockSprites[this.kind];
    this.targetHeight = kind === "tall"
      ? random(650, 760)
      : kind === "medium"
        ? random(470, 580)
        : random(330, 450);
    if (this.kind === "short") {
      this.targetWidth = random(190, 230) * (1 + sizeBoost);
      // Keep the supplied squat silhouette instead of stretching it into a column.
      this.targetHeight = this.targetWidth * this.sprite.height / this.sprite.width;
    }
    this.tilt = random(-0.025, 0.025);
    this.passed = false;
  }

  geometry() {
    const d = this.depth;

    const p = Math.pow(
      constrain(d, 0, 1),
      1.4
    );

    let x =
      GW / 2 +
      (this.targetX - GW / 2) *
      (0.25 + 0.75 * p);

    let base = lerp(
      SEA + 4,
      GH + 5,
      p
    );

    let w = lerp(4, this.targetWidth, p);

    let h = lerp(
      this.kind === "short" ? 4 * this.sprite.height / this.sprite.width : 8,
      this.targetHeight,
      p
    );

    // Art-directed straight exit: keep the familiar downward slide, with a gentle
    // outward diagonal for side pillars. Avoid camera-style expansion and acceleration.
    if (d > 1) {
      const past = d - 1;
      x += (this.targetX - GW / 2) * past * 1.8;
      base += past * 2600;
    }

    const exitProgress = constrain((d - 1.25) / 0.15, 0, 1);
    const exitOpacity = 1 - exitProgress * exitProgress * (3 - 2 * exitProgress);

    return {
      x,
      base,
      w,
      h,
      exitOpacity,
      top: base - h
    };
  }

  draw() {
    const g = this.geometry();
    const visible = (this.fade === undefined ? 1 : this.fade) * g.exitOpacity;
    if (visible <= 0) return;

    drawRockReflection(this.sprite, g, visible);

    noStroke();
    fill(177, 225, 239, 90 * visible);

    ellipse(
      g.x,
      g.base - 3,
      g.w * 1.4,
      Math.max(3, g.w * 0.11)
    );
    drawRockFoam(g, visible);

    push();

    translate(g.x, g.base);
    rotate(this.tilt);

    imageMode(CORNER);
    if (visible < 1) tint(255, 255 * visible);

    image(
      this.sprite,
      -g.w / 2,
      -g.h,
      g.w,
      g.h
    );

    pop();
  }
}

// ==========================================
// X/Y COLLISION DETECTION
// ==========================================

// Transparent gaps, sprite tilt, and dragon bobbing all affect collision.

function touchesDragon(rock) {
  if (rock.depth >= 1) return false;
  const g = rock.geometry();
  const pose = dragonRenderPose();
  return solidSpriteOverlap(
    spritePose(dragonSprite, pose.x, pose.y, DRAGON_W, DRAGON_H,
      pose.angle, -DRAGON_W / 2, -DRAGON_H / 2),
    spritePose(rock.sprite, g.x, g.base, g.w, g.h, rock.tilt, -g.w / 2, -g.h),
    GW, GH
  );
}

// ==========================================
// CRASH
// ==========================================

// `contact` is the screen point where dragon and rock pixels first overlapped.
function crash(contact) {
  if (scene !== "playing") return;
  // Game Over follows once the fall and splash in crash.js have played.
  scene = "crashing";

  bestScore = Math.max(
    bestScore,
    Math.floor(score)
  );

  startCrash(dragonRenderPose(), contact);

  held = {
    left: false,
    right: false,
    up: false,
    down: false
  };
}


// ==========================================
// VICTORY
// ==========================================

function winRound() {
  if (scene !== "playing") return;
  scene = "victory";
  victoryStartedAt = performance.now();

  const pose = dragonRenderPose();
  victoryFrom = { x: pose.x, y: pose.y, angle: pose.angle };

  newBest = bestScore > 0 && Math.floor(score) > bestScore;
  bestScore = Math.max(bestScore, Math.floor(score));
  shake = 0;

  held = {
    left: false,
    right: false,
    up: false,
    down: false
  };

  for (const rock of rocks) rock.fade = 1;
}

function victoryElapsed() {
  return performance.now() - victoryStartedAt;
}

function victoryScreenReady() {
  return scene === "victory" && victoryElapsed() >= VICTORY_SCREEN_MS;
}

// The camera is stationary during departure; keep all remaining rocks in place.
function updateVictory() {
  // No movement, spawning, collision, or fading during the departure animation.
}

function easeInOut(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

// The sprite is seen from behind, so shrinking it toward the horizon reads as flying away.
function drawVictoryDragon() {
  const t = constrain(victoryElapsed() / VICTORY_FLIGHT_MS, 0, 1);
  if (t >= 1) {
    drawArrivalSparkle();
    return;
  }
  const e = easeInOut(t);
  const goalY = SEA - 72;

  const x = lerp(victoryFrom.x, HOME_X, e);
  const y = lerp(victoryFrom.y, goalY, e) - Math.sin(Math.PI * e) * 55 +
    Math.sin(frameCount * 0.10) * 3 * (1 - e);
  const bank = constrain((HOME_X - victoryFrom.x) * 0.0005, -0.12, 0.12);
  const angle = lerp(victoryFrom.angle, 0, e) + bank * Math.sin(Math.PI * e);
  const size = lerp(1, 0.07, e);

  push();
  translate(x, y);
  rotate(angle);
  imageMode(CENTER);
  if (t > 0.85) tint(255, 255 * (1 - t) / 0.15);
  image(dragonSprite, 0, 0, DRAGON_W * size, DRAGON_H * size);
  pop();
}

function drawArrivalSparkle() {
  const t = (victoryElapsed() - VICTORY_FLIGHT_MS) / 700;
  if (t > 1) return;

  noFill();
  stroke(255, 220, 142, 220 * (1 - t));
  strokeWeight(3);
  circle(HOME_X, SEA - 72, 10 + 70 * t);
  strokeWeight(2);
  circle(HOME_X, SEA - 72, 4 + 36 * t);
  noStroke();
}

function drawVictoryScreen() {
  const since = victoryElapsed();
  const overlay = constrain(
    (since - VICTORY_FADE_START_MS) / (VICTORY_SCREEN_MS - VICTORY_FADE_START_MS), 0, 1);
  if (overlay <= 0) return;

  noStroke();
  fill(4, 16, 23, 184 * overlay);
  rect(0, 0, GW, GH);

  const reveal = easeInOut(constrain(
    (since - VICTORY_FADE_START_MS - 400) / (VICTORY_SCREEN_MS - VICTORY_FADE_START_MS - 400), 0, 1));
  if (reveal <= 0) return;

  push();
  translate(0, (1 - reveal) * 14);
  textAlign(CENTER, CENTER);

  fill(255, 220, 142, 255 * reveal);
  textStyle(BOLD);
  textSize(50);
  text("HOME", GW / 2, 168);

  textStyle(NORMAL);
  textSize(20);
  fill(224, 239, 242, 255 * reveal);
  text("You survived " + ROUND_DURATION_SECONDS + " seconds over the sea!", GW / 2, 225);

  fill(255, 255 * reveal);
  textStyle(BOLD);
  textSize(30);
  text("Final Score: " + floor(score), GW / 2, 287);

  textStyle(NORMAL);
  textSize(18);
  if (newBest) {
    fill(135, 248, 132, 255 * reveal);
    text("NEW BEST!", GW / 2, 330);
  } else {
    fill(224, 239, 242, 255 * reveal);
    text("Best: " + bestScore, GW / 2, 330);
  }

  const canRestart = victoryScreenReady();
  const hover = canRestart && Math.abs(mouseX - GW / 2) < 125 && Math.abs(mouseY - 412) < 31;
  fill(hover ? color(172, 255, 168) : color(135, 248, 132, 255 * reveal));
  rect(GW / 2 - 125, 381, 250, 62, 31);

  fill(16, 44, 32, 255 * reveal);
  textStyle(BOLD);
  textSize(25);
  text("PLAY AGAIN", GW / 2, 413);
  textStyle(NORMAL);
  pop();
}

// ==========================================
// ISLAND OF HOME
// ==========================================

// Home appears in the horizon in the final seconds and fully during victory.
function homeVisibility() {
  const approach = 0.55 * constrain(1 - timeLeftMs / FINAL_COUNTDOWN_MS, 0, 1);
  if (scene === "victory") {
    return lerp(approach, 1, easeInOut(constrain(victoryElapsed() / 900, 0, 1)));
  }
  if (scene === "playing" || scene === "paused" || scene === "crashing" || scene === "gameover") return approach;
  return 0;
}

function drawHome(v) {
  if (v <= 0 || !homeSprite) return;

  push();
  translate(HOME_X, SEA);
  scale(0.6 + 0.4 * v);
  noStroke();

  // Warm haze behind the island, kept above the waterline.
  const glow = drawingContext.createRadialGradient(0, -30, 10, 0, -30, 210);
  glow.addColorStop(0, `rgba(255, 220, 142, ${0.5 * v})`);
  glow.addColorStop(1, "rgba(255, 220, 142, 0)");
  drawingContext.fillStyle = glow;
  drawingContext.fillRect(-215, -245, 430, 245);

  // Draw the supplied home artwork fully opaque at its native proportions, anchored to the sea.
  const homeWidth = 240;
  const homeHeight = homeWidth * homeSprite.height / homeSprite.width;
  imageMode(CORNER);
  noTint();
  image(homeSprite, -homeWidth / 2, 4 - homeHeight, homeWidth, homeHeight);

  fill(177, 225, 239, 90 * v);
  ellipse(4, 1, homeWidth, 8);
  pop();
}

// ==========================================
// DRAW DRAGON
// ==========================================

function dragonRenderPose() {
  return {
    // A small directional offset and bank make steering visible without moving the target.
    x: constrain(playerX + constrain(velocityX * 0.8, -8, 8), MIN_X, MAX_X),
    y: playerY + Math.sin(frameCount * 0.10) * 3,
    angle: constrain(velocityX * 0.018, -0.17, 0.17)
  };
}

function drawDragon() {
  const pose = dragonRenderPose();
  push();

  translate(
    pose.x,
    pose.y
  );

  rotate(pose.angle);

  imageMode(CENTER);

  image(
    dragonSprite,
    0,
    0,
    DRAGON_W,
    DRAGON_H
  );

  pop();
}

// ==========================================
// BACKGROUND
// ==========================================

function drawBackgroundScene() {
  background(112, 190, 229);
  noStroke();

  fill(255, 220, 142);
  circle(SUN_X, SUN_Y, 85);

  for (let i = 0; i < 5; i++) {
    let x =
      (
        140 +
        i * 215 -
        frameCount * (0.12 + i * 0.014)
      ) % 1120;

    if (x < -110) x += 1120;

    drawCloud(
      x,
      100 + (i % 3) * 40,
      0.75 + (i % 2) * 0.2
    );
  }

  // Preserve the supplied mountain silhouette and its native transparency.
  // The sea covers the bottom overlap so the mountain feet meet the horizon.
  if (mountainSprite) {
    const mountainWidth = GW;
    // Gently flatten the distant range while leaving its waterline anchor fixed.
    const mountainHeight = mountainWidth * mountainSprite.height / mountainSprite.width * 0.83;
    push();
    imageMode(CORNER);
    noTint();
    image(mountainSprite, 0, SEA + 40 - mountainHeight, mountainWidth, mountainHeight);
    pop();
  }

  // Ocean (see ocean.js), extended below the canvas while the camera tilts.
  drawOcean(GH + cameraTilt);
}

// ==========================================
// CLOUDS
// ==========================================

function drawCloud(x, y, s) {
  push();

  translate(x, y);
  scale(s);

  noStroke();
  fill(255, 255, 255, 115);

  ellipse(0, 4, 83, 25);
  ellipse(-26, 0, 48, 28);
  ellipse(5, -9, 48, 33);
  ellipse(28, 2, 45, 23);

  pop();
}

// ==========================================
// HUD
// ==========================================

// I-key debug mode keeps the original layout: debug box top-left, timer top-centre.
// Otherwise the timer sits top-left with the score directly beneath it.
function drawHUD() {
  noStroke();

  if (showDebugHud) {
    fill(11, 33, 43, 178);
    rect(18, 18, 220, 87, 15);
    drawDebugInfo();
    drawTimer(GW / 2, 49);
  } else {
    drawTimer(110, 49);
    drawCornerScore();
  }
}

// Matches the timer panel: same panel colour and the timer digits' white bold lettering.
function drawCornerScore() {
  push();
  noStroke();
  fill(11, 33, 43, 178);
  rect(18, 92, 184, 42, 15);
  textAlign(CENTER, CENTER);
  textStyle(BOLD);
  textSize(22);
  fill(255);
  text("SCORE  " + floor(score), 110, 113);
  textStyle(NORMAL);
  pop();
}

// The I-key readout keeps its original plain Arial look.
function drawDebugInfo() {
  push();
  textFont("Arial");
  fill(255);
  textAlign(LEFT, TOP);
  textSize(20);

  text(
    "Score  " + floor(score),
    35,
    31
  );

  textSize(14);
  fill(217, 235, 239);

  text(
    "Best " + bestScore +
    "   |   X: " + floor(playerX) +
    " Y: " + floor(playerY),
    35,
    68
  );

  textAlign(RIGHT, TOP);

  text(
    motionEnabled ? "MOVE YOUR TRACKED PROP" : "WASD / arrows / move mouse",
    GW - 20,
    25
  );

  text(
    "Mode: " + controlMode,
    GW - 20,
    49
  );
  pop();
}

function formatTime(ms) {
  const seconds = Math.ceil(ms / 1000);
  return Math.floor(seconds / 60) + ":" + String(seconds % 60).padStart(2, "0");
}

// Pulses once per second in the final countdown; strongest right after each tick.
function finalCountdownPulse() {
  if (timeLeftMs > FINAL_COUNTDOWN_MS) return 0;
  return Math.pow((timeLeftMs % 1000) / 1000, 3);
}

function drawTimer(centerX, centerY) {
  const final = timeLeftMs <= FINAL_COUNTDOWN_MS;
  const urgent = timeLeftMs <= 3000;
  const pulse = finalCountdownPulse();
  const accent = urgent ? color(255, 128, 96) : final ? color(255, 196, 84) : color(255);

  push();
  translate(centerX, centerY);
  scale(1 + 0.12 * pulse);
  noStroke();

  fill(final ? color(70, 34, 16, 205) : color(11, 33, 43, 178));
  rect(-92, -31, 184, 66, 15);

  if (final) {
    noFill();
    stroke(red(accent), green(accent), blue(accent), 90 + 140 * pulse);
    strokeWeight(2);
    rect(-92, -31, 184, 66, 15);
    noStroke();
  }

  textAlign(CENTER, TOP);
  textSize(12);
  fill(final ? accent : color(217, 235, 239));
  text(timeLeftMs <= 0 ? "CLEAR THE LAST ROCKS" : "TIME LEFT", 0, -24);

  textStyle(BOLD);
  textSize(28);
  fill(accent);
  text(formatTime(timeLeftMs), 0, -9);
  textStyle(NORMAL);

  fill(255, 255, 255, 45);
  rect(-74, 25, 148, 4, 2);
  fill(accent);
  rect(-74, 25, 148 * timeLeftMs / ROUND_DURATION_MS, 4, 2);
  pop();
}

// A thin edge glow keeps the warning visible without covering the play area.
function drawFinalCountdownGlow() {
  if (timeLeftMs > FINAL_COUNTDOWN_MS) return;
  const pulse = finalCountdownPulse();
  noFill();
  stroke(255, timeLeftMs <= 3000 ? 128 : 196, timeLeftMs <= 3000 ? 96 : 84, 35 + 85 * pulse);
  strokeWeight(10);
  rect(5, 5, GW - 10, GH - 10);
  noStroke();
}

// ==========================================
// START / GAME OVER
// ==========================================

function drawOverlay() {
  noStroke();

  fill(4, 16, 23, 184);
  rect(0, 0, GW, GH);

  textAlign(CENTER, CENTER);

  fill(255);
  textStyle(BOLD);
  textSize(51);

  text(
    scene === "start"
      ? "DRAGON FLIGHT"
      : "GAME OVER\nScore: " + Math.floor(score),
    GW / 2,
    174
  );

}

function drawMessage(msg) {
  fill(18, 39, 51);
  textAlign(CENTER, CENTER);
  textSize(22);

  text(msg, GW / 2, GH / 2);
}

// ==========================================
// MOUSE CONTROL â€” X AND Y
// ==========================================

function aimAt(x, y) {
  if (motionEnabled) return;
  if (
    scene !== "playing" ||
    x < 0 || x > GW ||
    y < 0 || y > GH
  ) {
    return;
  }

  controlMode = "mouse";

  // Scale the pointer's distance from the play-area centre by the 1-3 movement level.
  const centerX = (MIN_X + MAX_X) / 2;
  const centerY = (MIN_Y + MAX_Y) / 2;
  mouseGoalX = constrain(centerX + (x - centerX) * movementScale(), MIN_X, MAX_X);
  mouseGoalY = constrain(centerY + (y - centerY) * movementScale(), MIN_Y, MAX_Y);
}

// Just moving the mouse is enough
function mouseMoved() {
  aimAt(mouseX, mouseY);
}

// Dragging also works
function mouseDragged() {
  aimAt(mouseX, mouseY);
  return false;
}

// Touchscreen support
function touchMoved() {
  if (touches.length) {
    aimAt(touches[0].x, touches[0].y);
  }

  return false;
}

// ==========================================
// KEYBOARD CONTROL â€” X AND Y
// ==========================================

function onKeyDown(e) {
  const k = e.key.toLowerCase();

  const controls = {
    a: "left",
    arrowleft: "left",

    d: "right",
    arrowright: "right",

    w: "up",
    arrowup: "up",

    s: "down",
    arrowdown: "down"
  };

  if (k === "i" && !e.repeat) {
    showDebugHud = !showDebugHud;
    return;
  }

  if (MOVEMENT_SCALES[e.key]) {
    movementLevel = Number(e.key);
    // Re-aim right away so a still mouse picks up the new level.
    if (controlMode === "mouse") aimAt(mouseX, mouseY);
    return;
  }

  if (controls[k]) {
    if (motionEnabled) { e.preventDefault(); return; }
    held[controls[k]] = true;
    controlMode = "keyboard";
    e.preventDefault();
  }

  if (
    (e.code === "Space" ||
     e.key === "Enter") &&
    !e.repeat
  ) {
    e.preventDefault();

    if (scene === "paused") {
      resumeMotionGame();
    } else if (ready && scene !== "playing") {
      startGame();
    }
  }
}

function onKeyUp(e) {
  const controls = {
    a: "left",
    arrowleft: "left",

    d: "right",
    arrowright: "right",

    w: "up",
    arrowup: "up",

    s: "down",
    arrowdown: "down"
  };

  const action = controls[e.key.toLowerCase()];

  if (action) {
    held[action] = false;
    e.preventDefault();
  }
}
