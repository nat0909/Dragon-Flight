// ==========================================
// CRASH SEQUENCE
// ==========================================

// A confirmed rock hit plays impact -> falling -> splash, then the scene becomes
// "gameover". The animation has its own clock; the round timer and score stay
// frozen because updateGame() no longer runs.

// Water surface in the dragon's flight plane (a rock base at depth ~0.98).
const CRASH_WATER_Y = 600;
// The camera tilts down this far to keep the fall and splash on screen.
const CRASH_CAMERA_TILT = 120;
const CRASH_HITSTOP_S = 0.07;
const CRASH_IMPACT_S = 0.24;
const CRASH_GRAVITY = 1750;
const CRASH_SPLASH_HOLD_S = 1.3;
const CRASH_MIN_TOTAL_S = 2.0;
// Safety net: water entry is forced if the dragon somehow never reaches it.
const CRASH_MAX_FALL_S = 2.2;
const GAMEOVER_FADE_MS = 450;
const CRASH_LAYER_SIZE = 380;

// Every effect is spawned in a fixed batch except the small rings left by landing
// droplets and chips, which are capped here.
const CRASH_MAX_PLIPS = 32;
const ROCK_CHIP_COLORS = [[128, 127, 124], [166, 164, 158], [96, 94, 92]];

let crashState = null;
let cameraTilt = 0;
let gameOverAt = 0;
// Opaque outline points per flight frame, used to find the first water contact.
let dragonHulls = [];
// One reusable offscreen canvas for the tinted (flash / underwater) dragon passes.
let crashLayer = null;
let crashDustBlob = null;

function prepareCrashSprites(frames) {
  crashDustBlob = buildSoftBlob(172, 166, 156);
  dragonHulls = frames.map(frame => {
    const points = [];
    const step = 6;
    const solid = (x, y) => x >= 0 && y >= 0 && x < frame.width && y < frame.height &&
      frame.pixels[(y * frame.width + x) * 4 + 3] >= 200;
    for (let y = 0; y < frame.height; y += step) {
      for (let x = 0; x < frame.width; x += step) {
        if (!solid(x, y)) continue;
        if (solid(x - step, y) && solid(x + step, y) && solid(x, y - step) && solid(x, y + step)) continue;
        points.push((x + 0.5) / frame.width - 0.5, (y + 0.5) / frame.height - 0.5);
      }
    }
    return points;
  });
}

// Rocks standing nearer the camera than the splash must cover its ripples and foam.
function rockNearerThanSplash(rock) {
  return crashActive() && crashState.entry !== null && rock.depth <= 1 &&
    rock.geometry().base > CRASH_WATER_Y;
}

function crashActive() {
  return crashState !== null && (scene === "crashing" || scene === "gameover");
}

function resetCrash() {
  crashState = null;
  gameOverAt = 0;
}

function startCrash(pose, contact) {
  const hitX = contact ? contact.x : pose.x;
  const hitY = contact ? contact.y : pose.y;
  // Pushed away from the contact; a dead-center hit picks a side.
  let dir = Math.sign(pose.x - hitX);
  if (Math.abs(pose.x - hitX) < 6) dir = random() < 0.5 ? -1 : 1;

  // Knockback plus some of the steering momentum, kept inside the screen.
  const drag = 3.2;
  let vx = dir * 300 + velocityX * 60 * 0.35;
  const settleX = constrain(pose.x + vx / drag, 120, GW - 120);
  vx = (settleX - pose.x) * drag;

  crashState = {
    stage: "impact",
    t: 0,
    x: pose.x,
    y: pose.y,
    vx,
    // Upward knock shrinks near the top so a high dragon stays on screen.
    vy: constrain(-190 + velocityY * 15, -320, -60) * constrain((pose.y - 60) / 220, 0.25, 1),
    angle: pose.angle,
    spin: dir * 4.6,
    dir,
    drag,
    hit: { x: hitX, y: hitY },
    flapMs: flightAnimationMs,
    frame: Math.max(0, dragonFrames.indexOf(dragonSprite)),
    entry: null,
    crown: null,
    chips: [],
    droplets: [],
    foam: [],
    plips: [],
    mist: [],
    ripples: []
  };

  for (let i = 0; i < 12; i++) {
    const a = -HALF_PI + dir * random(0.2, 1.4) + random(-0.5, 0.5);
    const speed = random(160, 420);
    crashState.chips.push({
      x: hitX, y: hitY,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      rot: random(TWO_PI), spin: random(-12, 12),
      size: random(3, 7.5), color: random(ROCK_CHIP_COLORS), age: 0
    });
  }
  for (let i = 0; i < 4; i++) {
    crashState.mist.push({
      x: hitX + random(-10, 10), y: hitY + random(-10, 10),
      vx: dir * random(20, 60), vy: random(-40, 10),
      size: random(34, 56), grow: random(50, 90), life: random(0.45, 0.65),
      age: 0, dust: true, front: true
    });
  }
  shake = 9;
}

// ------------------------------------------
// Update
// ------------------------------------------

function updateCrash() {
  const c = crashState;
  const dt = Math.max(0, Math.min(deltaTime, 50)) / 1000;

  // Fixed substeps keep the fall identical at any frame rate.
  let remaining = dt;
  while (remaining > 1e-6) {
    const h = Math.min(remaining, 1 / 120);
    stepCrashBody(c, h);
    remaining -= h;
  }

  // Flap frantically right after the hit, then the wings go limp.
  const flapRate = c.t < CRASH_HITSTOP_S ? 0 : 2.4 * (1 - rampStep(0.1, 0.75, c.t));
  c.flapMs += dt * 1000 * flapRate;
  c.frame = Math.floor(c.flapMs / FLIGHT_FRAME_MS) % dragonFrames.length;
  dragonSprite = dragonFrames[c.frame];

  if (c.stage === "impact" && c.t >= CRASH_IMPACT_S) c.stage = "falling";

  if (!c.entry && c.t > CRASH_HITSTOP_S && c.vy > 0) {
    const low = lowestDragonPoint(c);
    if (low.y >= CRASH_WATER_Y || c.t > CRASH_MAX_FALL_S) enterWater(c, low);
  }

  if (c.stage === "splash" && scene === "crashing" &&
      c.t >= Math.max(c.entry.t + CRASH_SPLASH_HOLD_S, CRASH_MIN_TOTAL_S)) {
    c.stage = "done";
    scene = "gameover";
    gameOverAt = performance.now();
  }

  updateCrashRocks(dt);
  updateCrashEffects(c, dt);
}

function stepCrashBody(c, h) {
  c.t += h;
  // Hit-stop: hold the exact collision pose for a beat.
  if (c.t < CRASH_HITSTOP_S) return;
  const since = c.t - CRASH_HITSTOP_S;

  if (!c.entry) {
    // Control fades out and gravity takes over.
    c.vy += CRASH_GRAVITY * rampStep(0.02, 0.26, since) * h;
    c.vx *= Math.exp(-c.drag * h);
    c.spin += (c.dir * 1.35 - c.spin) * (1 - Math.exp(-h / 0.33));
  } else {
    // Water drag: a short plunge, then a steady sink.
    c.vy += (210 - c.vy) * (1 - Math.exp(-9 * h));
    c.vx *= Math.exp(-8 * h);
    c.spin *= Math.exp(-2.5 * h);
  }
  c.x += c.vx * h;
  c.y += c.vy * h;
  c.angle += c.spin * h;
}

// The camera stops with the dragon; rocks still behind the flight plane freeze
// there, while rocks already passing the camera finish leaving and fade.
function updateCrashRocks(dt) {
  const step = rockSpeed * dt * 60;
  for (let i = rocks.length - 1; i >= 0; i--) {
    const rock = rocks[i];
    if (rock.crashExit === undefined) rock.crashExit = rock.depth > 1;
    if (rock.crashExit) {
      rock.depth += step;
      rock.fade = Math.max(0, (rock.fade === undefined ? 1 : rock.fade) - dt * 4);
      if (rock.fade === 0 || rock.depth > 1.4) rocks.splice(i, 1);
    } else {
      rock.depth = Math.min(1, rock.depth + step * ocean.flow);
    }
  }
}

function crashPose(c) {
  const since = Math.max(0, c.t - CRASH_HITSTOP_S);
  // Squash on impact, springing back, then a slight pitch wobble while tumbling.
  const squash = c.t < CRASH_HITSTOP_S ? 1 : Math.cos(since * 32) * Math.exp(-since / 0.09);
  const settle = c.entry ? 1 - rampStep(c.entry.t, c.entry.t + 0.3, c.t) : 1;
  const wobble = 0.07 * (0.5 - 0.5 * Math.cos(since * 8)) * rampStep(0.1, 0.4, since) * settle;
  return {
    x: c.x,
    y: c.y,
    angle: c.angle,
    sx: 1 + 0.08 * squash,
    sy: (1 - 0.08 * squash) * (1 - wobble)
  };
}

function lowestDragonPoint(c) {
  const pose = crashPose(c);
  const points = dragonHulls[c.frame] || [];
  const cos = Math.cos(pose.angle), sin = Math.sin(pose.angle);
  let best = { x: pose.x, y: pose.y };
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] * DRAGON_W * pose.sx;
    const dy = points[i + 1] * DRAGON_H * pose.sy;
    const y = pose.y + dx * sin + dy * cos;
    if (y > best.y) best = { x: pose.x + dx * cos - dy * sin, y };
  }
  return best;
}

// Hull points within a band around the surface: where the body pierces the water.
function dragonWaterlineSpan(c) {
  const pose = crashPose(c);
  const points = dragonHulls[c.frame] || [];
  const cos = Math.cos(pose.angle), sin = Math.sin(pose.angle);
  let left = Infinity, right = -Infinity, above = false;
  for (let i = 0; i < points.length; i += 2) {
    const dx = points[i] * DRAGON_W * pose.sx;
    const dy = points[i + 1] * DRAGON_H * pose.sy;
    const y = pose.y + dx * sin + dy * cos;
    if (y < CRASH_WATER_Y - 2) above = true;
    if (Math.abs(y - CRASH_WATER_Y) > 9) continue;
    const x = pose.x + dx * cos - dy * sin;
    left = Math.min(left, x);
    right = Math.max(right, x);
  }
  return above && right > left ? { left, right } : null;
}

function enterWater(c, low) {
  const strength = constrain(c.vy / 850, 0.6, 1.25);
  const x = constrain(lerp(c.x, low.x, 0.5), 40, GW - 40);
  const y = CRASH_WATER_Y;
  const rx = 62 + 36 * strength;
  const ry = rx * waterAspect(y);
  c.entry = { x, y, t: c.t, strength, rx, ry, aspect: waterAspect(y) };
  c.stage = "splash";

  const spikes = [];
  for (let i = 0; i < 15; i++) {
    spikes.push({
      a: (i + random(-0.3, 0.3)) / 15 * TWO_PI,
      h: random(0.35, 1),
      lean: random(0.3, 0.75)
    });
  }
  c.crown = { spikes, height: 105 * strength };

  const drops = Math.round(40 + 34 * strength);
  for (let i = 0; i < drops; i++) {
    const a = random(TWO_PI);
    c.droplets.push({
      a,
      gx: x + Math.cos(a) * rx * 0.8,
      gy: y + Math.sin(a) * ry * 0.8,
      speed: random(90, 330) * strength,
      height: random(6, 34),
      vh: random(280, 640) * strength,
      size: random(1.6, 4.2),
      front: Math.sin(a) > 0
    });
  }

  for (let i = 0; i < 7; i++) {
    c.mist.push({
      x: x + random(-0.6, 0.6) * rx, y: y - random(10, 50) * strength,
      vx: random(-25, 25), vy: random(-70, -30),
      size: random(50, 110) * strength, grow: random(40, 90), life: random(1.1, 1.6),
      age: 0, dust: false, front: i % 2 === 0
    });
  }

  for (let i = 0; i < 44; i++) {
    const speck = i % 3 === 0;
    c.foam.push({
      speck,
      a: random(TWO_PI),
      r0: rx * random(0.2, 0.9),
      r1: rx * random(1.1, 2.3),
      size: speck ? random(1.5, 3.5) : random(10, 26),
      life: random(1.8, 2.8),
      age: 0,
      cx: x,
      cy: y
    });
  }

  [0, 0.15, 0.34, 0.62, 0.98].forEach((delay, i) => {
    c.ripples.push({
      delay,
      life: random(1.7, 2.1),
      r0: rx * 0.55,
      growth: (240 + 50 * i) * strength,
      seed: random(TWO_PI),
      age: 0
    });
  });

  shake = Math.max(shake, 4 * strength);
}

function addPlip(c, x, y, scale) {
  if (c.plips.length >= CRASH_MAX_PLIPS) return;
  c.plips.push({ x, y, r1: random(6, 14) * scale, life: random(0.45, 0.7), age: 0 });
}

function updateCrashEffects(c, dt) {
  for (let i = c.chips.length - 1; i >= 0; i--) {
    const chip = c.chips[i];
    chip.age += dt;
    chip.vy += 1600 * dt;
    chip.x += chip.vx * dt;
    chip.y += chip.vy * dt;
    chip.rot += chip.spin * dt;
    if (chip.y >= CRASH_WATER_Y) {
      addPlip(c, chip.x, CRASH_WATER_Y, 0.6);
      c.chips.splice(i, 1);
    } else if (chip.age > 1.6) {
      c.chips.splice(i, 1);
    }
  }

  const e = c.entry;
  for (let i = c.droplets.length - 1; i >= 0; i--) {
    const d = c.droplets[i];
    d.vh -= 1500 * dt;
    d.height += d.vh * dt;
    d.gx += Math.cos(d.a) * d.speed * dt;
    d.gy += Math.sin(d.a) * d.speed * e.aspect * dt;
    if (d.height <= 0 && d.vh < 0) {
      addPlip(c, d.gx, d.gy, 0.5 + d.size / 5);
      c.droplets.splice(i, 1);
    }
  }

  for (const list of [c.mist, c.foam, c.plips]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const item = list[i];
      item.age += dt;
      if (item.vx !== undefined) {
        item.x += item.vx * dt;
        item.y += item.vy * dt;
      }
      if (item.age >= item.life) list.splice(i, 1);
    }
  }

  for (let i = c.ripples.length - 1; i >= 0; i--) {
    const ripple = c.ripples[i];
    ripple.age += dt;
    if (ripple.age >= ripple.delay + ripple.life) c.ripples.splice(i, 1);
  }
}

// ------------------------------------------
// Camera
// ------------------------------------------

function updateCamera() {
  if (crashActive()) {
    // Tilt down toward the water, but never so far that a high dragon leaves the top.
    const eased = CRASH_CAMERA_TILT * easeInOut(constrain((crashState.t - 0.12) / 0.95, 0, 1));
    cameraTilt = Math.min(eased, Math.max(0, crashState.y - 100));
  } else if (scene === "playing") {
    cameraTilt = 0;
  } else {
    cameraTilt *= Math.exp(-Math.max(0, Math.min(deltaTime, 100)) / 140);
    if (cameraTilt < 0.3) cameraTilt = 0;
  }
}

function gameOverFade() {
  return easeInOut(constrain((performance.now() - gameOverAt) / GAMEOVER_FADE_MS, 0, 1));
}

// HUD stays frozen during the crash, then dissolves before the Game Over card.
function crashHudAlpha() {
  const c = crashState;
  if (!c || !c.entry) return 1;
  return 1 - rampStep(c.entry.t + 0.4, c.entry.t + CRASH_SPLASH_HOLD_S, c.t);
}

// ------------------------------------------
// Drawing
// ------------------------------------------

function waterlineY(x) {
  return CRASH_WATER_Y + 2.2 * Math.sin(x * 0.04 + ocean.time * 2.6);
}

function clipToWater(ctx, below) {
  ctx.beginPath();
  ctx.moveTo(-80, below ? CRASH_WATER_Y + 700 : -800);
  ctx.lineTo(GW + 80, below ? CRASH_WATER_Y + 700 : -800);
  for (let x = GW + 80; x >= -80; x -= 20) ctx.lineTo(x, waterlineY(x));
  ctx.closePath();
  ctx.clip();
}

// Layering: underwater dragon -> water surface effects -> rocks nearer than the
// splash -> crown back -> dragon above water -> crown front, droplets, mist, debris.
function drawCrashScene() {
  const c = crashState;
  const pose = crashPose(c);
  if (c.entry) drawSubmergedDragon(c, pose);
  if (c.entry) drawSplashSurface(c);
  for (const rock of rocks) {
    if (rockNearerThanSplash(rock)) rock.draw();
  }
  drawSplashLayer(c, false);
  drawDragonAboveWater(c, pose);
  drawSplashLayer(c, true);
  drawImpactEffects(c);
}

// Renders the rotated sprite into the shared offscreen layer, washed with a color.
function renderTintedDragon(pose, rgba) {
  const size = CRASH_LAYER_SIZE;
  const density = pixelDensity();
  if (!crashLayer) crashLayer = document.createElement("canvas");
  if (crashLayer.width !== size * density) {
    crashLayer.width = crashLayer.height = size * density;
  }
  const ctx = crashLayer.getContext("2d");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, crashLayer.width, crashLayer.height);
  ctx.setTransform(density, 0, 0, density, size / 2 * density, size / 2 * density);
  ctx.rotate(pose.angle);
  ctx.scale(pose.sx, pose.sy);
  ctx.drawImage(dragonSprite.canvas, -DRAGON_W / 2, -DRAGON_H / 2, DRAGON_W, DRAGON_H);
  ctx.setTransform(density, 0, 0, density, 0, 0);
  ctx.globalCompositeOperation = "source-atop";
  ctx.fillStyle = rgba;
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
  return ctx;
}

// Seen through the surface: tinted blue and fading out with depth.
function drawSubmergedDragon(c, pose) {
  const since = c.t - c.entry.t;
  const alpha = 0.8 * (1 - rampStep(0.5, 1.35, since));
  if (alpha <= 0) return;
  const size = CRASH_LAYER_SIZE;
  const layer = renderTintedDragon(pose, "rgba(24, 96, 140, 0.62)");
  const surface = CRASH_WATER_Y - (pose.y - size / 2);
  const fade = layer.createLinearGradient(0, surface, 0, surface + 85);
  fade.addColorStop(0, "rgba(0, 0, 0, 1)");
  fade.addColorStop(1, "rgba(0, 0, 0, 0)");
  layer.globalCompositeOperation = "destination-in";
  layer.fillStyle = fade;
  layer.fillRect(0, 0, size, size);
  layer.globalCompositeOperation = "source-over";

  const ctx = drawingContext;
  ctx.save();
  clipToWater(ctx, true);
  ctx.globalAlpha = alpha;
  ctx.drawImage(crashLayer, pose.x - size / 2, pose.y - size / 2, size, size);
  ctx.restore();
}

function drawDragonAboveWater(c, pose) {
  // Fully sunk: nothing left above the surface.
  if (pose.y - CRASH_LAYER_SIZE / 2 > CRASH_WATER_Y + 4) return;
  push();
  clipToWater(drawingContext, false);
  translate(pose.x, pose.y);
  rotate(pose.angle);
  scale(pose.sx, pose.sy);
  imageMode(CENTER);
  image(dragonSprite, 0, 0, DRAGON_W, DRAGON_H);
  pop();

  // A white hit flash over the sprite, strongest during the hit-stop.
  const flash = c.t < CRASH_HITSTOP_S ? 0.34 : 0.34 * Math.exp(-(c.t - CRASH_HITSTOP_S) / 0.04);
  if (flash < 0.02) return;
  const size = CRASH_LAYER_SIZE;
  renderTintedDragon(pose, "rgb(255, 255, 255)");
  const ctx = drawingContext;
  ctx.save();
  clipToWater(ctx, false);
  ctx.globalAlpha = flash;
  ctx.drawImage(crashLayer, pose.x - size / 2, pose.y - size / 2, size, size);
  ctx.restore();
}

function drawSplashSurface(c) {
  const e = c.entry;
  const since = c.t - e.t;
  const ctx = drawingContext;
  ctx.save();

  // Aerated, lighter water where the dragon went in.
  const glow = 1 - rampStep(0.2, 2.2, since);
  if (glow > 0) {
    const w = e.rx * (2.6 + 0.8 * rampStep(0, 1.5, since));
    ctx.globalAlpha = 0.55 * glow;
    ctx.drawImage(ocean.lightBlob, e.x - w / 2, e.y - w * e.aspect / 2, w, w * e.aspect);
  }

  for (const ripple of c.ripples) {
    const t = (ripple.age - ripple.delay) / ripple.life;
    if (t < 0 || t > 1) continue;
    const radius = ripple.r0 + ripple.growth * (1 - Math.pow(1 - t, 2.4));
    const a = Math.pow(1 - t, 1.6) * 0.75;
    const width = (3.4 - 2.2 * t) * e.strength;
    ctx.globalAlpha = 1;
    traceRipple(ctx, e, radius - 6, ripple.seed);
    ctx.lineWidth = width * 1.5;
    ctx.strokeStyle = `rgba(10, 54, 96, ${a * 0.4})`;
    ctx.stroke();
    traceRipple(ctx, e, radius, ripple.seed);
    ctx.lineWidth = width;
    ctx.strokeStyle = `rgba(222, 244, 250, ${a})`;
    ctx.stroke();
  }

  for (const foam of c.foam) {
    const t = foam.age / foam.life;
    const r = lerp(foam.r0, foam.r1, 1 - Math.pow(1 - t, 3));
    const a = 1 - rampStep(0.3, 1, t);
    const x = foam.cx + Math.cos(foam.a) * r;
    const y = foam.cy + Math.sin(foam.a) * r * e.aspect;
    if (foam.speck) {
      ctx.globalAlpha = 1;
      ctx.fillStyle = `rgba(246, 252, 253, ${a * 0.8})`;
      ctx.beginPath();
      ctx.ellipse(x, y, foam.size, foam.size * 0.45, 0, 0, TWO_PI);
      ctx.fill();
    } else {
      // Foam spreads thinner as it drifts outward.
      const size = foam.size * (1 + 1.2 * t);
      ctx.globalAlpha = a * 0.7;
      ctx.drawImage(ocean.lightBlob, x - size, y - size * 0.4, size * 2, size * 0.8);
    }
  }
  ctx.globalAlpha = 1;

  for (const plip of c.plips) {
    const t = plip.age / plip.life;
    const r = 2 + plip.r1 * (1 - Math.pow(1 - t, 2));
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(226, 246, 251, ${(1 - t) * 0.7})`;
    ctx.beginPath();
    ctx.ellipse(plip.x, plip.y, r, r * waterAspect(plip.y), 0, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.restore();
}

// Ripple rings wobble slightly and ride the passing swell.
function traceRipple(ctx, e, radius, seed) {
  ctx.beginPath();
  for (let k = 0; k <= 48; k++) {
    const a = k / 48 * TWO_PI;
    const r = Math.max(1, radius * (1 + 0.03 * Math.sin(5 * a + seed + ocean.time * 2.2)));
    const x = e.x + r * Math.cos(a);
    const y = e.y + r * e.aspect * Math.sin(a) + 1.8 * Math.sin(x * 0.03 + ocean.time * 1.4);
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

// Back half of the crown sits behind the dragon; the front half covers it.
function drawSplashLayer(c, front) {
  const e = c.entry;
  const ctx = drawingContext;
  ctx.save();
  if (e && c.crown) drawCrown(ctx, c, front);

  if (e) {
    ctx.lineCap = "round";
    for (const d of c.droplets) {
      if (d.front !== front) continue;
      const x = d.gx, y = d.gy - d.height;
      const vx = Math.cos(d.a) * d.speed, vy = Math.sin(d.a) * d.speed * e.aspect - d.vh;
      ctx.lineWidth = d.size;
      ctx.strokeStyle = "rgba(236, 248, 255, 0.92)";
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - vx * 0.022, y - vy * 0.022);
      ctx.stroke();
    }
  }

  if (front && e) {
    drawJet(ctx, c);
    drawWaterlineFoam(ctx, c);
  }

  for (const m of c.mist) {
    if (m.front !== front) continue;
    const t = m.age / m.life;
    const size = m.size + m.grow * t;
    ctx.globalAlpha = (m.dust ? 0.45 : 0.38) * Math.min(1, t * 6) * Math.pow(1 - t, 2);
    ctx.drawImage(m.dust ? crashDustBlob : ocean.lightBlob,
      m.x - size / 2, m.y - size / 2, size, size);
  }
  ctx.restore();
}

const CROWN_LIFE_S = 0.72;

// Liquid crown: rounded lobes on a translucent wall, rising fast then collapsing.
function drawCrown(ctx, c, front) {
  const e = c.entry;
  const t = (c.t - e.t) / CROWN_LIFE_S;
  if (t >= 1) return;
  const rise = t < 0.28 ? 1 - Math.pow(1 - t / 0.28, 3) : 1 - Math.pow((t - 0.28) / 0.72, 1.6);
  const height = c.crown.height * rise;
  const alpha = 1 - rampStep(0.55, 1, t);
  const grow = 0.85 + 0.5 * (1 - Math.pow(1 - t, 2));
  const rx = e.rx * grow, ry = e.ry * grow;
  const spikes = c.crown.spikes;
  const baseW = Math.PI * rx / spikes.length * 1.25;
  const from = front ? 0 : Math.PI, to = front ? Math.PI : TWO_PI;

  // Translucent water wall around the hole.
  const wall = ctx.createLinearGradient(0, e.y - height * 0.5, 0, e.y + ry);
  wall.addColorStop(0, `rgba(236, 249, 253, ${alpha * (front ? 0.62 : 0.72)})`);
  wall.addColorStop(1, `rgba(120, 196, 222, ${alpha * (front ? 0.28 : 0.4)})`);
  ctx.beginPath();
  for (let k = 0; k <= 24; k++) {
    const a = lerp(from, to, k / 24);
    const x = e.x + Math.cos(a) * rx * 1.03;
    const y = e.y + Math.sin(a) * ry - height * 0.36 * (0.8 + 0.2 * Math.sin(a * 7 + e.x));
    if (k === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  for (let k = 24; k >= 0; k--) {
    const a = lerp(from, to, k / 24);
    ctx.lineTo(e.x + Math.cos(a) * rx * 0.96, e.y + Math.sin(a) * ry * 0.96);
  }
  ctx.closePath();
  ctx.fillStyle = wall;
  ctx.fill();

  ctx.lineJoin = "round";
  for (const spike of spikes) {
    const sin = Math.sin(spike.a), cos = Math.cos(spike.a);
    if ((sin >= 0) !== front) continue;
    const h = height * spike.h;
    if (h < 3) continue;
    const bx = e.x + cos * rx, by = e.y + sin * ry;
    // Side lobes look narrower because they are seen edge-on.
    const w = baseW * (0.55 + 0.45 * Math.abs(sin)) * (0.8 + 0.4 * spike.h);
    const tipX = bx + cos * spike.lean * h * 0.7;
    const tipY = by - h;
    const bulb = Math.max(2, w * 0.34);

    const fill = ctx.createLinearGradient(0, tipY, 0, by);
    fill.addColorStop(0, `rgba(248, 253, 255, ${alpha * 0.96})`);
    fill.addColorStop(1, `rgba(150, 214, 234, ${alpha * 0.55})`);
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(bx - w, by);
    ctx.bezierCurveTo(bx - w * 0.35, by - h * 0.45, tipX - bulb * 1.1, tipY + bulb * 1.6, tipX - bulb, tipY + bulb * 0.2);
    ctx.arc(tipX, tipY + bulb * 0.2, bulb, Math.PI, 0);
    ctx.bezierCurveTo(tipX + bulb * 1.1, tipY + bulb * 1.6, bx + w * 0.35, by - h * 0.45, bx + w, by);
    ctx.closePath();
    ctx.fill();
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(104, 178, 210, ${alpha * 0.55})`;
    ctx.stroke();

    // A bead pinching off the lobe tip as the crown starts to fall.
    if (t > 0.25) {
      const lift = (t - 0.25) * h * 0.5;
      ctx.fillStyle = `rgba(246, 252, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(tipX + cos * 4 * t, tipY - lift, bulb * 0.7, 0, TWO_PI);
      ctx.fill();
    }
  }
}

// Worthington jet: the column that shoots up from the hole after the crown,
// tapering to a point that sheds a few beads.
function drawJet(ctx, c) {
  const e = c.entry;
  const t = (c.t - e.t - 0.16) / 0.62;
  if (t <= 0 || t >= 1) return;
  const rise = t < 0.42 ? 1 - Math.pow(1 - t / 0.42, 2.2) : 1 - Math.pow((t - 0.42) / 0.58, 1.8);
  const h = 115 * e.strength * rise;
  if (h < 4) return;
  const w = (9 + 6 * e.strength) * (1 + 0.4 * t);
  const alpha = 1 - rampStep(0.7, 1, t);
  const top = e.y - h;
  const sway = Math.sin(e.x) * 4 * t;
  const fill = ctx.createLinearGradient(0, top, 0, e.y);
  fill.addColorStop(0, `rgba(250, 254, 255, ${alpha * 0.95})`);
  fill.addColorStop(1, `rgba(160, 220, 238, ${alpha * 0.55})`);
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(e.x - w * 2.2, e.y + 2);
  ctx.bezierCurveTo(e.x - w * 0.6, e.y - h * 0.15, e.x - w * 0.45, top + h * 0.35, e.x + sway - w * 0.12, top);
  ctx.quadraticCurveTo(e.x + sway, top - w * 0.35, e.x + sway + w * 0.12, top);
  ctx.bezierCurveTo(e.x + w * 0.45, top + h * 0.35, e.x + w * 0.6, e.y - h * 0.15, e.x + w * 2.2, e.y + 2);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = `rgba(104, 178, 210, ${alpha * 0.45})`;
  ctx.stroke();

  if (t > 0.3) {
    const split = (t - 0.3) / 0.7;
    ctx.fillStyle = `rgba(248, 253, 255, ${alpha})`;
    for (let i = 0; i < 3; i++) {
      const lift = (14 + 16 * i) * split * e.strength;
      const r = w * (0.32 - 0.07 * i);
      ctx.beginPath();
      ctx.ellipse(e.x + sway + (i - 1) * 3 * split, top - lift, r * 0.85, r, 0, 0, TWO_PI);
      ctx.fill();
    }
  }
}

// Churning foam collar where the sinking body breaks the surface.
function drawWaterlineFoam(ctx, c) {
  const span = dragonWaterlineSpan(c);
  if (!span) return;
  const fade = 1 - rampStep(0.6, 1.2, c.t - c.entry.t);
  if (fade <= 0) return;
  const w = span.right - span.left + 30;
  const cx = (span.left + span.right) / 2;
  ctx.globalAlpha = 0.7 * fade;
  ctx.drawImage(ocean.lightBlob, cx - w / 2, CRASH_WATER_Y - 8, w, 18);
  // Irregular bubbling clumps, not an evenly spaced row.
  for (let i = 0; i < 7; i++) {
    const along = (i * 0.618 + 0.13) % 1;
    const x = span.left - 8 + along * (w - 14);
    const boil = 0.5 + 0.5 * Math.sin(ocean.time * (6 + i) + i * 2.3);
    const size = 9 + 9 * ((i * 0.37) % 1) + 6 * boil;
    ctx.globalAlpha = (0.55 + 0.35 * boil) * fade;
    ctx.drawImage(ocean.lightBlob, x - size / 2, CRASH_WATER_Y - 3 - size * 0.45, size, size * 0.7);
  }
  ctx.globalAlpha = 1;
}

// Brief cartoon impact star and stone chips knocked off the rock.
function drawImpactEffects(c) {
  const ctx = drawingContext;
  ctx.save();
  const t = c.t / 0.2;
  if (t < 1) {
    const grow = 1 - Math.pow(1 - t, 3);
    ctx.lineCap = "round";
    ctx.strokeStyle = `rgba(255, 252, 238, ${1 - t})`;
    for (let i = 0; i < 9; i++) {
      const a = i / 9 * TWO_PI + 0.3;
      const inner = 8 + 22 * grow, outer = 20 + 52 * grow * (i % 2 ? 0.7 : 1);
      ctx.lineWidth = 3.5 * (1 - t) + 0.5;
      ctx.beginPath();
      ctx.moveTo(c.hit.x + Math.cos(a) * inner, c.hit.y + Math.sin(a) * inner);
      ctx.lineTo(c.hit.x + Math.cos(a) * outer, c.hit.y + Math.sin(a) * outer);
      ctx.stroke();
    }
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.7 * (1 - t)})`;
    ctx.beginPath();
    ctx.arc(c.hit.x, c.hit.y, 10 + 46 * grow, 0, TWO_PI);
    ctx.stroke();
  }

  for (const chip of c.chips) {
    const [r, g, b] = chip.color;
    ctx.fillStyle = `rgba(${r}, ${g}, ${b}, ${1 - rampStep(1.1, 1.6, chip.age)})`;
    ctx.beginPath();
    for (let k = 0; k < 3; k++) {
      const a = chip.rot + k * 2.1;
      const x = chip.x + Math.cos(a) * chip.size, y = chip.y + Math.sin(a) * chip.size * 0.8;
      if (k === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}
