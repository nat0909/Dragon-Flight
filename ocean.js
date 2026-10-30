// ==========================================
// OCEAN
// ==========================================

// Layered water drawn in the same perspective as the rocks. Gradients, the sun
// column, and the horizon haze are cached once; each frame only adds thin wave
// strokes, whitecaps, glints, and soft light patches.

// Extra water painted below the canvas so the crash camera can tilt down.
const OCEAN_BELOW = 170;
// Haze rises this far above the horizon to soften the mountain bases.
const OCEAN_HAZE_ABOVE = 130;
const SUN_X = 760;
const SUN_Y = 89;

const ocean = {
  base: null,
  haze: null,
  lightBlob: null,
  shadeBlob: null,
  sunBlob: null,
  depthMax: 1,
  // Forward distance in rock-depth units; water texture scrolls with the rocks.
  travel: 0,
  // Camera speed: 1 while flying, eases to 0 when the camera stops after a crash.
  flow: 1,
  // Seconds; drives undulation even while travel is stopped.
  time: 0,
  swells: [],
  caps: [],
  glints: [],
  patches: []
};

// Reused per-frame sample buffer for wave crest lines (no per-frame allocation).
const swellSamples = new Float32Array(160);

function rampStep(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// Same depth mapping as OceanRock.geometry(), so rocks stay anchored in the water.
function seaProgress(depth) {
  return Math.pow(Math.max(0, depth), 1.4);
}

function seaY(p) {
  return lerp(SEA + 4, GH + 5, p);
}

function seaX(worldX, p) {
  return GW / 2 + (worldX - GW / 2) * (0.25 + 0.75 * p);
}

// How flat a circle lying on the water looks at screen height y.
function waterAspect(y) {
  return constrain((y - SEA) / 800, 0.02, 0.45);
}

function oceanRandom(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setupOcean() {
  const pMax = (GH + OCEAN_BELOW - SEA - 4) / (GH + 1 - SEA);
  ocean.depthMax = Math.pow(pMax, 1 / 1.4);
  ocean.base = buildOceanBase();
  ocean.haze = buildOceanHaze();
  ocean.lightBlob = buildSoftBlob(255, 255, 255);
  ocean.shadeBlob = buildSoftBlob(10, 52, 92);
  ocean.sunBlob = buildSoftBlob(255, 246, 218);

  const rand = oceanRandom(1337);
  const D = ocean.depthMax;

  for (let i = 0; i < 15; i++) {
    ocean.swells.push({
      offset: (i + rand() * 0.6) * D / 15,
      k: TWO_PI / (190 + rand() * 120),
      amp: 5 + rand() * 5,
      phase: rand() * TWO_PI,
      phase2: rand() * TWO_PI,
      speed: (0.55 + rand() * 0.6) * (i % 2 ? 1 : -1),
      maskK: TWO_PI / (420 + rand() * 300),
      maskPhase: rand() * TWO_PI
    });
  }

  for (let i = 0; i < 64; i++) {
    ocean.caps.push({
      offset: rand() * D,
      u: (rand() * 2 - 1) * GW * 0.85,
      rate: 0.5 + rand() * 0.7,
      seed: rand() * TWO_PI,
      lean: rand() < 0.5 ? -1 : 1
    });
  }

  // Most glints sit in the sun column; the rest catch the open sky.
  for (let i = 0; i < 78; i++) {
    const sun = i < 52;
    ocean.glints.push({
      sun,
      offset: rand() * D,
      u: sun ? (rand() + rand() - 1) : (rand() * 2 - 1) * GW * 0.8,
      rate: 1.6 + rand() * 2.4,
      seed: rand() * TWO_PI
    });
  }

  for (let i = 0; i < 8; i++) {
    ocean.patches.push({
      light: i < 5,
      offset: rand() * D,
      u: (rand() * 2 - 1) * GW * 0.75,
      size: 0.7 + rand() * 0.6,
      seed: rand() * TWO_PI
    });
  }
}

// Detached canvas at the sketch's pixel density; nothing is added to the page.
function createLayer(w, h) {
  const density = pixelDensity();
  const layer = document.createElement("canvas");
  layer.width = Math.ceil(w * density);
  layer.height = Math.ceil(h * density);
  const ctx = layer.getContext("2d");
  ctx.scale(density, density);
  return { canvas: layer, ctx, width: w, height: h };
}

function buildSoftBlob(r, g, b) {
  const size = 96;
  const blob = document.createElement("canvas");
  blob.width = blob.height = size;
  const ctx = blob.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, 1)`);
  grad.addColorStop(0.45, `rgba(${r}, ${g}, ${b}, 0.55)`);
  grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return blob;
}

// Static water body: depth gradient, sky reflection, sun column, darker corners.
function buildOceanBase() {
  const top = SEA - OCEAN_HAZE_ABOVE;
  const height = GH + OCEAN_BELOW - top;
  const horizon = SEA - top;
  const layer = createLayer(GW, height);
  const ctx = layer.ctx;
  const span = height - horizon;
  const stop = p => constrain((seaY(p) - SEA) / span, 0, 1);

  const water = ctx.createLinearGradient(0, horizon, 0, height);
  water.addColorStop(0, "rgb(146, 202, 221)");
  water.addColorStop(stop(0.03), "rgb(116, 189, 215)");
  water.addColorStop(stop(0.12), "rgb(84, 168, 204)");
  water.addColorStop(stop(0.30), "rgb(58, 145, 186)");
  water.addColorStop(stop(0.55), "rgb(40, 122, 166)");
  water.addColorStop(stop(0.85), "rgb(29, 101, 148)");
  water.addColorStop(stop(1.20), "rgb(21, 82, 129)");
  water.addColorStop(1, "rgb(16, 68, 114)");
  ctx.fillStyle = water;
  ctx.fillRect(0, horizon, GW, span);

  // The pale sky reflects most strongly at grazing angles near the horizon.
  const sky = ctx.createLinearGradient(0, horizon, 0, horizon + 55);
  sky.addColorStop(0, "rgba(220, 240, 247, 0.28)");
  sky.addColorStop(1, "rgba(220, 240, 247, 0)");
  ctx.fillStyle = sky;
  ctx.fillRect(0, horizon, GW, 55);

  // Sun column: narrow at the horizon, widening and dimming toward the viewer.
  for (let y = horizon; y < height; y += 2) {
    const p = (y + top - SEA - 4) / (GH + 1 - SEA);
    const half = 16 + 165 * Math.max(0, p);
    const strength = 0.36 * (1 - 0.6 * constrain(p, 0, 1.3));
    const glow = ctx.createLinearGradient(SUN_X - half, 0, SUN_X + half, 0);
    glow.addColorStop(0, "rgba(255, 238, 196, 0)");
    glow.addColorStop(0.5, `rgba(255, 238, 196, ${strength})`);
    glow.addColorStop(1, "rgba(255, 238, 196, 0)");
    ctx.fillStyle = glow;
    ctx.fillRect(SUN_X - half, y, half * 2, 2);
  }

  for (const cornerX of [0, GW]) {
    const shade = ctx.createRadialGradient(cornerX, height, 0, cornerX, height, 470);
    shade.addColorStop(0, "rgba(6, 34, 64, 0.34)");
    shade.addColorStop(1, "rgba(6, 34, 64, 0)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, horizon, GW, span);
  }
  return layer;
}

// Cached atmospheric mist blends the mountain feet into the distant water.
// It belongs to the background, so gameplay sprites are always drawn above it.
function buildOceanHaze() {
  const top = SEA - OCEAN_HAZE_ABOVE;
  const horizon = SEA - top;
  const bottom = horizon + 70;
  const layer = createLayer(GW, bottom);
  const ctx = layer.ctx;
  const haze = ctx.createLinearGradient(0, 0, 0, bottom);
  haze.addColorStop(0, "rgba(214, 236, 243, 0)");
  haze.addColorStop(horizon / bottom * 0.35, "rgba(198, 220, 230, 0.16)");
  haze.addColorStop(horizon / bottom * 0.7, "rgba(200, 222, 232, 0.45)");
  haze.addColorStop((horizon - 16) / bottom, "rgba(205, 227, 236, 0.72)");
  haze.addColorStop(horizon / bottom, "rgba(212, 232, 240, 0.85)");
  haze.addColorStop((horizon + 16) / bottom, "rgba(198, 224, 235, 0.50)");
  haze.addColorStop((horizon + 40) / bottom, "rgba(186, 217, 232, 0.16)");
  haze.addColorStop(1, "rgba(206, 234, 243, 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, GW, bottom);
  // Overlapping feathered wisps break up a perfectly straight photographic seam.
  // Cache once: no frame-by-frame blur or extra movement in the fixed-camera ending.
  for (let i = 0; i < 12; i++) {
    const x = -40 + i * 95;
    const y = horizon - 22 + Math.sin(i * 1.7) * 14;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(150 + (i % 3) * 25, 24 + (i % 2) * 12);
    const wisp = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    wisp.addColorStop(0, "rgba(222, 238, 244, 0.34)");
    wisp.addColorStop(0.5, "rgba(211, 231, 239, 0.16)");
    wisp.addColorStop(1, "rgba(209, 230, 239, 0)");
    ctx.fillStyle = wisp;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  return layer;
}

function oceanFlowTarget() {
  return scene === "crashing" || scene === "gameover" || scene === "paused" ? 0 : 1;
}

function updateOcean() {
  // The ending uses a stationary camera: freeze both scrolling and wave motion.
  if (scene === "victory") {
    ocean.flow = 0;
    return;
  }
  const dtMs = Math.max(0, Math.min(deltaTime, 100));
  const target = oceanFlowTarget();
  // The camera stops almost instantly on impact, but eases back up to speed.
  const tau = target < ocean.flow ? 120 : 600;
  ocean.flow += (target - ocean.flow) * (1 - Math.exp(-dtMs / tau));
  ocean.time += dtMs / 1000;
  ocean.travel += rockSpeed * (dtMs / 16.67) * ocean.flow;
  if (ocean.travel > 1e6) ocean.travel = 0;
}

function oceanDepth(offset) {
  const D = ocean.depthMax;
  return ((offset + ocean.travel) % D + D) % D;
}

// Fades features in at the horizon and out at the far end of their loop.
function oceanFade(depth) {
  return rampStep(0, 0.1, depth) * (1 - rampStep(ocean.depthMax - 0.06, ocean.depthMax, depth));
}

// `bottom` is the lowest world y currently on screen (larger while the camera tilts down).
function drawOcean(bottom) {
  if (!ocean.base) return;
  const ctx = drawingContext;
  const top = SEA - OCEAN_HAZE_ABOVE;
  ctx.drawImage(ocean.base.canvas, 0, top, ocean.base.width, ocean.base.height);

  ctx.save();
  drawOceanPatches(ctx, bottom);
  drawSwells(ctx, bottom);
  drawWhitecaps(ctx, bottom);
  drawGlints(ctx, bottom);
  ctx.restore();

  ctx.drawImage(ocean.haze.canvas, 0, top, ocean.haze.width, ocean.haze.height);
}

// Broad sky reflections and cloud shadows give the surface uneven lighting.
function drawOceanPatches(ctx, bottom) {
  for (const patch of ocean.patches) {
    const depth = oceanDepth(patch.offset);
    const p = seaProgress(depth);
    const y = seaY(p);
    if (y > bottom + 80) continue;
    const w = (140 + 560 * p) * patch.size;
    const h = w * waterAspect(y) * 0.6 + 5;
    const pulse = 0.65 + 0.35 * Math.sin(ocean.time * 0.35 + patch.seed);
    ctx.globalAlpha = (patch.light ? 0.09 : 0.12) * pulse * oceanFade(depth);
    ctx.drawImage(patch.light ? ocean.lightBlob : ocean.shadeBlob,
      seaX(GW / 2 + patch.u, p) - w / 2, y - h / 2, w, h);
  }
  ctx.globalAlpha = 1;
}

// Rows of swells: a dark wave face under each crest, with broken rim highlights.
function drawSwells(ctx, bottom) {
  const step = 10;
  const count = Math.ceil((GW + 40) / step) + 1;
  const t = ocean.time;

  for (const swell of ocean.swells) {
    const depth = oceanDepth(swell.offset);
    const p = seaProgress(depth);
    const y = seaY(p);
    if (y > bottom + 40 || p < 0.004) continue;
    const fade = oceanFade(depth);
    const scale = 0.25 + 0.75 * p;
    const amp = 0.4 + swell.amp * p;
    const thick = 3 + 30 * p;

    for (let i = 0; i < count; i++) {
      const x = -20 + i * step;
      const u = (x - GW / 2) / scale;
      const phase = swell.k * u + swell.phase + t * swell.speed;
      swellSamples[i] = y + amp * (0.7 * Math.sin(phase) +
        0.3 * Math.sin(2.1 * swell.k * u - t * swell.speed * 1.3 + swell.phase2));
    }

    // Back slope catching the sky, brightening up to the crest.
    const slope = ctx.createLinearGradient(0, y - thick * 0.8, 0, y + amp);
    slope.addColorStop(0, "rgba(176, 226, 242, 0)");
    slope.addColorStop(1, `rgba(176, 226, 242, ${(0.05 + 0.09 * p) * fade})`);
    ctx.fillStyle = slope;
    ctx.beginPath();
    ctx.moveTo(-20, swellSamples[0]);
    for (let i = 1; i < count; i++) ctx.lineTo(-20 + i * step, swellSamples[i]);
    for (let i = count - 1; i >= 0; i -= 2) ctx.lineTo(-20 + i * step, swellSamples[i] - thick * 0.8);
    ctx.lineTo(-20, swellSamples[0] - thick * 0.8);
    ctx.closePath();
    ctx.fill();

    const face = ctx.createLinearGradient(0, y - amp, 0, y + thick);
    face.addColorStop(0, `rgba(10, 54, 96, ${(0.12 + 0.2 * p) * fade})`);
    face.addColorStop(1, "rgba(10, 54, 96, 0)");
    ctx.fillStyle = face;
    ctx.beginPath();
    ctx.moveTo(-20, swellSamples[0]);
    for (let i = 1; i < count; i++) ctx.lineTo(-20 + i * step, swellSamples[i]);
    for (let i = count - 1; i >= 0; i -= 2) ctx.lineTo(-20 + i * step, swellSamples[i] + thick);
    ctx.lineTo(-20, swellSamples[0] + thick);
    ctx.closePath();
    ctx.fill();

    // Rim light only on crest tops that face the sky, broken up along the row.
    ctx.beginPath();
    let drawing = false;
    for (let i = 0; i < count; i++) {
      const x = -20 + i * step;
      const u = (x - GW / 2) / scale;
      const crest = Math.sin(swell.k * u + swell.phase + t * swell.speed);
      const mask = Math.sin(swell.maskK * u + swell.maskPhase + t * 0.2);
      const lit = crest > 0.2 && mask > -0.15;
      if (lit && drawing) ctx.lineTo(x, swellSamples[i] - 0.6);
      else if (lit) ctx.moveTo(x, swellSamples[i] - 0.6);
      drawing = lit;
    }
    ctx.lineCap = "round";
    ctx.lineWidth = 0.7 + 2.1 * p;
    ctx.strokeStyle = `rgba(212, 240, 247, ${(0.16 + 0.36 * p) * fade})`;
    ctx.stroke();
  }
}

// Small breaking crests that form and dissolve; foam tips only in the foreground.
function drawWhitecaps(ctx, bottom) {
  const t = ocean.time;
  ctx.lineCap = "round";
  for (const cap of ocean.caps) {
    const depth = oceanDepth(cap.offset);
    const p = seaProgress(depth);
    if (p < 0.05) continue;
    const y = seaY(p) + Math.sin(t * 1.4 + cap.seed) * 1.5 * p;
    if (y > bottom + 20) continue;
    const life = Math.sin(t * cap.rate + cap.seed);
    if (life <= 0) continue;
    const a = Math.pow(life, 1.5) * oceanFade(depth) * (0.22 + 0.5 * Math.min(1, p));
    const x = seaX(GW / 2 + cap.u, p);
    const w = 6 + 62 * p;
    const h = w * 0.17;
    const lean = cap.lean * w * 0.12;

    ctx.lineWidth = 1 + 2.6 * p;
    ctx.strokeStyle = `rgba(10, 50, 90, ${a * 0.45})`;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y + 2 + 2 * p);
    ctx.quadraticCurveTo(x + lean, y - h * 1.2 + 2 + 2 * p, x + w / 2, y + 2 + 2 * p);
    ctx.stroke();

    ctx.strokeStyle = `rgba(236, 248, 251, ${a})`;
    ctx.beginPath();
    ctx.moveTo(x - w / 2, y);
    ctx.quadraticCurveTo(x + lean, y - h * 1.6, x + w / 2, y - h * 0.15);
    ctx.stroke();

    if (p > 0.5) {
      ctx.fillStyle = `rgba(244, 251, 253, ${a * 0.85})`;
      ctx.beginPath();
      ctx.ellipse(x + lean * 0.6, y - h * 0.75, w * 0.12, w * 0.045, 0, 0, TWO_PI);
      ctx.fill();
    }
  }
}

// Brief twinkles: warm in the sun column, cool where the water mirrors the sky.
function drawGlints(ctx, bottom) {
  const t = ocean.time;
  for (const glint of ocean.glints) {
    const depth = oceanDepth(glint.offset);
    const p = seaProgress(depth);
    const y = seaY(p);
    if (y > bottom + 10 || p < 0.01) continue;
    const twinkle = Math.pow(Math.max(0, Math.sin(t * glint.rate + glint.seed)), 6);
    if (twinkle < 0.02) continue;
    const fade = oceanFade(depth);
    const x = glint.sun
      ? SUN_X + glint.u * (16 + 165 * p) * 0.9
      : seaX(GW / 2 + glint.u, p);
    // Soft streaks rather than hard rectangles, so close glints shimmer instead of reading as marks.
    const w = 3 + 22 * Math.min(p, 1.1);
    const h = 2 + 3 * Math.min(p, 1.1);
    ctx.globalAlpha = twinkle * fade * (glint.sun ? 0.95 : 0.5);
    ctx.drawImage(glint.sun ? ocean.sunBlob : ocean.lightBlob, x - w / 2, y - h / 2, w, h);
  }
  ctx.globalAlpha = 1;
}

// A wavy mirrored reflection below a rock's waterline, built from thin strips.
function drawRockReflection(sprite, g, alpha) {
  const length = Math.min(g.h * 0.36, GH + OCEAN_BELOW - g.base);
  if (length < 3 || alpha <= 0 || !sprite.canvas) return;
  const ctx = drawingContext;
  const src = sprite.canvas;
  const density = src.width / sprite.width;
  const strip = 6;
  ctx.save();
  for (let dy = 0; dy < length; dy += strip) {
    const t = dy / length;
    const srcY = sprite.height * (1 - (dy + strip) / g.h);
    if (srcY < 0) break;
    const wobble = Math.sin(dy * 0.09 + ocean.time * 2.4 + g.x * 0.013) *
      (0.6 + 3.2 * t) * (g.w / 170);
    ctx.globalAlpha = alpha * 0.3 * (1 - t) * (1 - t);
    ctx.drawImage(src,
      0, srcY * density, sprite.width * density, sprite.height * strip / g.h * density,
      g.x - g.w / 2 + wobble, g.base + dy, g.w, strip);
  }
  ctx.restore();
}

// Water lapping around a rock's base.
function drawRockFoam(g, alpha) {
  const ctx = drawingContext;
  const lap = 0.5 + 0.5 * Math.sin(ocean.time * 2.2 + g.x * 0.02);
  const w = g.w * (1.45 + 0.12 * lap);
  const h = Math.max(3, g.w * 0.12);
  ctx.save();
  ctx.lineWidth = Math.max(0.8, g.w * 0.016);
  ctx.strokeStyle = `rgba(232, 247, 251, ${alpha * (0.25 + 0.3 * lap)})`;
  ctx.beginPath();
  ctx.ellipse(g.x, g.base - 2, w / 2, h / 2, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.restore();
}
