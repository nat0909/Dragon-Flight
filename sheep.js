// ==========================================
// FLYING SHEEP COLLECTIBLES
// ==========================================

// One sheep flies across the sea at each of these moments of active play
// (seconds). Time comes from the round timer, so the countdown, pauses, the
// crash and the victory flight never advance the schedule.
const SHEEP_TIMES = [10, 20, 30, 40, 50];
const SHEEP_POINTS = 50;
const BLACK_SHEEP_POINTS = 200;
// Drawn size: length along the flight direction (head to tail) and width across it.
const SHEEP_LENGTH = 118;
let sheepWidth = 74;
// Total flight time in seconds, randomized independently for every throw.
const SHEEP_FLIGHT_MIN_SECONDS = 1.5;
const SHEEP_FLIGHT_MAX_SECONDS = 2.5;
// Arc apexes remain visible and reachable without touching the top edge.
const SHEEP_MIN_Y = 110;
const SHEEP_MAX_Y = 300;
const SHEEP_PLAYER_GAP = 80;
const SHEEP_FADE_FRAMES = 20;

let sheepSprite = null;
let blackSheepSprite = null;
let blackSheepWidth = 74;
let blackSheepIndex = -1;
let sheepGlow = null;
let flock = [];
let sheepEffects = [];
let nextSheep = 0;
let sheepFirstDir = 1;
let lastSheepY = null;
let sheepCollected = 0;

// The sheep's wool is almost as light as the white backdrop, so a global
// near-white threshold would erase it. Instead the backdrop is flood-filled
// from the image border: only white connected to the edge becomes transparent,
// and enclosed whites such as the eyes are kept. Runs once at load time.
function prepareSheepSprite(source) {
  const out = source.get();
  out.loadPixels();
  const w = out.width;
  const h = out.height;
  const px = out.pixels;
  const backdrop = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let head = 0;
  let tail = 0;

  const isBackdropColor = i => {
    const low = Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    const high = Math.max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    return px[i * 4 + 3] === 0 || (low >= 236 && high - low <= 16);
  };

  // The JPEG has a one-pixel scan line along its top and bottom edges, so the
  // whole frame is treated as backdrop and seeds the fill.
  for (let i = 0; i < w * h; i++) {
    const x = i % w;
    const y = (i - x) / w;
    if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
      backdrop[i] = 2;
      queue[tail++] = i;
    }
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % w;
    for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
      if (n < 0 || n >= w * h || backdrop[n] || !isBackdropColor(n)) continue;
      backdrop[n] = 1;
      queue[tail++] = n;
    }
  }

  let left = w, top = h, right = -1, bottom = -1;
  for (let i = 0; i < w * h; i++) {
    let alpha = 255;
    if (backdrop[i] === 2) {
      alpha = 0;
    } else if (backdrop[i] === 1) {
      // Off-white JPEG fringe next to the outline keeps a little opacity,
      // which anti-aliases the edge instead of leaving it jagged.
      const low = Math.min(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
      alpha = constrain((250 - low) * 16, 0, 255);
    }
    alpha = Math.min(alpha, px[i * 4 + 3]);
    px[i * 4 + 3] = alpha;
    if (alpha > 24) {
      const x = i % w;
      const y = (i - x) / w;
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  }
  out.updatePixels();
  defringe(out);
  if (right < left) return out;

  const x1 = Math.max(0, left - 2);
  const y1 = Math.max(0, top - 2);
  return out.get(x1, y1, Math.min(w - 1, right + 2) - x1 + 1, Math.min(h - 1, bottom + 2) - y1 + 1);
}

function setupSheep(source, blackSource) {
  sheepSprite = prepareSheepSprite(source);
  sheepSprite.loadPixels();
  // Keep the artwork's proportions: the sprite's height runs head to tail.
  sheepWidth = SHEEP_LENGTH * sheepSprite.width / sheepSprite.height;
  blackSheepSprite = prepareSheepSprite(blackSource);
  blackSheepSprite.loadPixels();
  blackSheepWidth = SHEEP_LENGTH * blackSheepSprite.width / blackSheepSprite.height;
  sheepGlow = buildSoftBlob(255, 226, 150);
}

function resetSheep() {
  flock = [];
  sheepEffects = [];
  nextSheep = 0;
  // Choose exactly one of the scheduled sheep per round, not a per-spawn chance.
  blackSheepIndex = Math.floor(random(SHEEP_TIMES.length));
  sheepFirstDir = random() < 0.5 ? 1 : -1;
  lastSheepY = null;
  sheepCollected = 0;
}

// ------------------------------------------
// Spawning
// ------------------------------------------

// Called from updateGame() after rock collisions: a crash on this frame has
// already returned, so a bonus can never be collected instead of a fatal hit.
function updateSheep(dt) {
  const playedMs = ROUND_DURATION_MS - timeLeftMs;
  // Each milestone is consumed exactly once; pausing cannot replay it.
  while (nextSheep < SHEEP_TIMES.length && playedMs >= SHEEP_TIMES[nextSheep] * 1000) {
    spawnSheep(nextSheep);
    nextSheep++;
  }

  moveSheep(dt);

  for (const sheep of flock) {
    if (sheep.collected) continue;
    // Give a launched sheep time to enter play before it can award points.
    if (sheep.age < 21 || Math.hypot(sheep.x - sheep.launchX, sheep.y - sheep.launchY) < 90) continue;
    const contact = touchesSheep(sheep);
    if (contact) collectSheep(sheep, contact);
  }
}

function chooseSheepThrow(index, dir) {
  const margin = 80;
  let best = null;
  for (let attempt = 0; attempt < 36; attempt++) {
    const roll = random();
    const mode = roll < 0.25 ? "vertical" : roll < 0.55 ? "diagonal" : "cross";
    const duration = random(SHEEP_FLIGHT_MIN_SECONDS, SHEEP_FLIGHT_MAX_SECONDS);
    const launchY = mode === "cross" ? random(500, 565) : GH - margin;
    const launchX = mode === "cross" ? (dir > 0 ? -SHEEP_LENGTH : GW + SHEEP_LENGTH)
      : mode === "vertical" ? random(margin, GW - margin) : dir > 0 ? margin : GW - margin;
    const endX = mode === "vertical" ? launchX : mode === "cross"
      ? (dir > 0 ? GW + SHEEP_LENGTH : -SHEEP_LENGTH)
      : random(GW * 0.3, GW * 0.7);
    const apexY = random(SHEEP_MIN_Y, SHEEP_MAX_Y);
    const gravity = 8 * (launchY - apexY) / (duration * duration);
    const route = { mode, launchX, launchY, duration, apexY, gravity,
      velocityX: (endX - launchX) / duration, velocityY: -gravity * duration / 2 };
    let clearance = Infinity;
    for (let sample = 0; sample <= 48; sample++) {
      const t = sample / 48 * duration;
      const x = launchX + route.velocityX * t;
      const y = launchY + route.velocityY * t + gravity * t * t / 2;
      if (x < -60 || x > GW + 60 || y > GH + 60) continue;
      // Conservative separation around the stationary dragon's wings and body.
      clearance = Math.min(clearance, Math.max(Math.abs(x - playerX) / 215, Math.abs(y - playerY) / 165));
    }
    route.clearance = clearance;
    if (!best || clearance > best.clearance) best = route;
    if (clearance >= 1.1) return route;
  }
  // Prefer the most separated route when no candidate meets the preferred margin.
  return best;
}

function spawnSheep(index) {
  // Directions alternate, but a sheep never enters right beside the dragon:
  // it would be collected before the player had a chance to choose.
  let dir = index % 2 === 0 ? sheepFirstDir : -sheepFirstDir;
  const entryGap = dir > 0 ? playerX : GW - playerX;
  if (entryGap < 300 && GW - entryGap > entryGap) dir = -dir;

  const route = chooseSheepThrow(index, dir);
  const { launchX, launchY, duration, gravity } = route;
  lastSheepY = route.apexY;
  const angle = dir * HALF_PI - dir * 0.35;
  flock.push({
    mode: route.mode,
    routeClearance: route.clearance,
    isBlack: index === blackSheepIndex,
    points: index === blackSheepIndex ? BLACK_SHEEP_POINTS : SHEEP_POINTS,
    dir,
    x: launchX,
    y: launchY,
    launchX,
    launchY,
    duration,
    velocityX: route.velocityX,
    velocityY: route.velocityY,
    gravity,
    startAngle: angle,
    // Complete two to three full turns before leaving the screen.
    spin: dir * random(2, 3) * TWO_PI / duration,
    age: 0,
    angle,
    collected: false,
    fadeAge: 0,
    fade: 1
  });
}

// Heights vary between appearances and stay away from the dragon's current
// height, so most sheep ask the player to steer for them.
function pickSheepHeight() {
  const options = [];
  for (let y = SHEEP_MIN_Y; y <= SHEEP_MAX_Y; y += 25) options.push(y);
  // Rules relax in order: variety between sheep goes first, distance from the dragon last.
  for (const [playerGap, sheepGap] of [[SHEEP_PLAYER_GAP, 60], [SHEEP_PLAYER_GAP, 0], [40, 0]]) {
    const fits = options.filter(y => Math.abs(y - playerY) >= playerGap &&
      (lastSheepY === null || Math.abs(y - lastSheepY) >= sheepGap));
    if (fits.length) return random(fits);
  }
  return random(options);
}

// ------------------------------------------
// Motion and collection
// ------------------------------------------

function moveSheep(dt) {
  for (let i = flock.length - 1; i >= 0; i--) {
    const sheep = flock[i];
    sheep.age += dt;
    if (sheep.collected) {
      sheep.fadeAge += dt;
      if (sheep.fadeAge >= SHEEP_FADE_FRAMES) flock.splice(i, 1);
      continue;
    }
    // Evaluate from total active flight time so the arc is independent of frame steps.
    const seconds = sheep.age / 60;
    sheep.x = sheep.launchX + sheep.velocityX * seconds;
    sheep.y = sheep.launchY + sheep.velocityY * seconds + 0.5 * sheep.gravity * seconds * seconds;
    sheep.angle = sheep.startAngle + sheep.spin * seconds;
    // After its planned arc a sheep keeps falling; it is removed only once fully off screen.
    const gone = seconds >= sheep.duration && sheepOffScreen(sheep);
    if (gone) flock.splice(i, 1);
  }
}

// Uses the sprite's diagonal so no spinning corner is still visible.
// The crash camera tilts down, which shows extra world below the canvas.
function sheepOffScreen(sheep) {
  const reach = Math.hypot(SHEEP_LENGTH, sheep.isBlack ? blackSheepWidth : sheepWidth) / 2;
  return sheep.x < -reach || sheep.x > GW + reach || sheep.y > GH + cameraTilt + reach;
}

function sheepPose(sheep) {
  const sprite = sheep.isBlack ? blackSheepSprite : sheepSprite;
  const width = sheep.isBlack ? blackSheepWidth : sheepWidth;
  return spritePose(sprite, sheep.x, sheep.y, width, SHEEP_LENGTH,
    sheep.angle, -width / 2, -SHEEP_LENGTH / 2);
}

// Same opaque-pixel test as rocks (body and wings both count), so points are
// only awarded for visible overlap, never for flying close by.
function touchesSheep(sheep) {
  const pose = dragonRenderPose();
  return solidSpriteOverlap(
    spritePose(dragonSprite, pose.x, pose.y, DRAGON_W, DRAGON_H,
      pose.angle, -DRAGON_W / 2, -DRAGON_H / 2),
    sheepPose(sheep),
    GW, GH
  );
}

function collectSheep(sheep, contact) {
  if (sheep.collected) return;
  sheep.collected = true;
  score += sheep.points;
  sheepCollected++;

  sheepEffects.push({
    kind: "popup",
    points: sheep.points,
    x: constrain(contact.x, 50, GW - 50),
    y: constrain(contact.y - 34, 40, GH - 40),
    age: 0,
    life: 60
  });
  sheepEffects.push({ kind: "ring", x: sheep.x, y: sheep.y, age: 0, life: 32 });
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TWO_PI + random(-0.25, 0.25);
    const speed = random(1.6, 3.4);
    sheepEffects.push({
      kind: "sparkle",
      x: sheep.x, y: sheep.y,
      vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      size: random(4, 8),
      age: 0,
      life: random(28, 42)
    });
  }
}

// Called every frame from draw(). Effects finish playing after a crash or win;
// sheep still flying keep going (crash) or fade with the rocks (victory).
function updateSheepVisuals() {
  if (scene === "paused" || scene === "playing") {
    if (scene === "playing") advanceSheepEffects(constrain(deltaTime / 16.67, 0.5, 2));
    return;
  }
  const dt = constrain(deltaTime / 16.67, 0, 2);
  if (scene === "crashing" || scene === "gameover") moveSheep(dt);
  if (scene === "victory") {
    const fade = Math.max(0, 1 - victoryElapsed() / 500);
    for (const sheep of flock) sheep.fade = fade;
    if (fade === 0) flock = [];
  }
  advanceSheepEffects(dt);
}

function advanceSheepEffects(dt) {
  for (let i = sheepEffects.length - 1; i >= 0; i--) {
    const fx = sheepEffects[i];
    fx.age += dt;
    if (fx.kind === "sparkle") {
      fx.x += fx.vx * dt;
      fx.y += fx.vy * dt;
      fx.vx *= Math.pow(0.95, dt);
      fx.vy *= Math.pow(0.95, dt);
    }
    if (fx.age >= fx.life) sheepEffects.splice(i, 1);
  }
}

// ------------------------------------------
// Drawing
// ------------------------------------------

// Sheep share the dragon's flight plane: drawn after approaching rocks and
// before the dragon, so a touching wing visibly covers the sheep.
function drawSheep() {
  if (!sheepSprite) return;
  for (const sheep of flock) {
    const t = sheep.collected ? sheep.fadeAge / SHEEP_FADE_FRAMES : 0;
    const alpha = sheep.fade * (1 - t * t);
    if (alpha <= 0) continue;
    const grow = 1 + 0.35 * t;

    // A soft warm halo marks the sheep as a bonus rather than a hazard.
    const pulse = 0.8 + 0.2 * Math.sin(sheep.age * 0.12);
    const glow = SHEEP_LENGTH * 1.7 * grow;
    drawingContext.save();
    drawingContext.globalAlpha = 0.42 * pulse * alpha;
    drawingContext.drawImage(sheepGlow, sheep.x - glow / 2, sheep.y - glow * 0.4, glow, glow * 0.8);
    drawingContext.restore();

    push();
    translate(sheep.x, sheep.y);
    rotate(sheep.angle);
    scale(grow);
    imageMode(CENTER);
    if (alpha < 1) tint(255, 255 * alpha);
    image(sheep.isBlack ? blackSheepSprite : sheepSprite, 0, 0,
      sheep.isBlack ? blackSheepWidth : sheepWidth, SHEEP_LENGTH);
    pop();
  }
}

function drawSheepEffects() {
  for (const fx of sheepEffects) {
    const t = fx.age / fx.life;
    if (fx.kind === "ring") {
      noFill();
      stroke(255, 220, 142, 200 * (1 - t));
      strokeWeight(3 * (1 - t) + 1);
      circle(fx.x, fx.y, 40 + 110 * (1 - Math.pow(1 - t, 2)));
      noStroke();
    } else if (fx.kind === "sparkle") {
      const s = fx.size * (1 - 0.5 * t);
      stroke(255, 240, 190, 255 * (1 - t));
      strokeWeight(2);
      line(fx.x - s, fx.y, fx.x + s, fx.y);
      line(fx.x, fx.y - s, fx.x, fx.y + s);
      noStroke();
    } else if (fx.kind === "popup") {
      const rise = 46 * (1 - Math.pow(1 - t, 2));
      const alpha = 255 * (1 - rampStep(0.6, 1, t));
      const bounce = 1 + 0.25 * (1 - rampStep(0, 0.2, t));
      push();
      translate(fx.x, fx.y - rise);
      scale(bounce);
      textAlign(CENTER, CENTER);
      textStyle(BOLD);
      textSize(28);
      stroke(11, 33, 43, alpha * 0.85);
      strokeWeight(5);
      fill(255, 220, 142, alpha);
      text("+" + fx.points, 0, 0);
      pop();
      noStroke();
      textStyle(NORMAL);
    }
  }
}
