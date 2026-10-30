// ==========================================
// DIFFICULTY CURVE AND ROCK PATTERNS
// ==========================================

// The round has four phases: easy (0-15 s), medium (15-30 s), challenging
// (30-45 s) and final (45-60 s). Each phase's settings are pinned at its
// midpoint and blend linearly into the next, so nothing changes abruptly at
// 15, 30 or 45 seconds. Times are active play, taken from the round timer.
//   speed:    rock approach speed (depth per frame)
//   interval: frames between waves
//   aim:      how far an aimed rock may miss the dragon's current x (px)
//   follow:   chance that a single rock is chased by a quick second one
//   boost:    extra width some rocks may get (0.18 = up to 18% wider)
//   room:     free space beyond the dragon's wingspan in a two-rock gate (px)
//   slack:    share of the model player's reach a wave may demand (see FAIRNESS);
//             lower means more spare time, so the opening is the most forgiving
//   mix:      relative weights of each wave pattern (see buildPattern)
const DIFFICULTY_PHASES = [
  { at: 7.5, speed: 0.0052, interval: 200, aim: 110, follow: 0, boost: 0, room: 170, slack: 0.65,
    mix: { single: 0.5, aimed: 0.5, double: 0, gate: 0, hurdle: 0, triple: 0 } },
  { at: 22.5, speed: 0.0065, interval: 170, aim: 85, follow: 0.1, boost: 0.06, room: 140, slack: 0.75,
    mix: { single: 0.25, aimed: 0.33, double: 0.27, gate: 0.08, hurdle: 0.07, triple: 0 } },
  { at: 37.5, speed: 0.0080, interval: 140, aim: 65, follow: 0.12, boost: 0.12, room: 115, slack: 0.85,
    mix: { single: 0.1, aimed: 0, double: 0.3, gate: 0.25, hurdle: 0.2, triple: 0.15 } },
  { at: 52.5, speed: 0.0095, interval: 108, aim: 50, follow: 0.08, boost: 0.18, room: 95, slack: 0.9,
    mix: { single: 0.05, aimed: 0, double: 0.3, gate: 0.25, hurdle: 0.2, triple: 0.2 } }
];

// A deliberately cautious model of a first-time player. Every wave must leave a
// safe spot this player can reach; otherwise it is rebuilt or simplified.
const FAIRNESS = {
  // A wave counts as readable once its rocks are this far from the horizon.
  readDepth: 0.14,
  // Time to notice the wave and decide where to go (0.45 s).
  reactionFrames: 27,
  // Still below full keyboard steering speed (9 px/frame).
  speed: 6.5,
  // Standing room required around a safe spot, for imprecise mouse or tracker aim.
  marginX: 22,
  marginY: 16
};

// Rocks can only hurt while their depth is in [0.92, 1); see updateGame().
const DANGER_DEPTHS = [0.92, 0.936, 0.952, 0.968, 0.984, 0.9999];
// Candidate dragon positions (playerX, playerY) used to map safe space.
const SAFE_COLS = 80;
const SAFE_ROWS = 33;
const ROCK_X_MIN = 110;
const ROCK_X_MAX = 790;
// Opaque wingspan of the widest flight frame, in screen pixels.
const DRAGON_SPAN = 254;
const PROFILE_BINS = 160;

let rockProfiles = {};
let dragonProfile = null;
let pacing = null;

function difficultyAt(seconds) {
  const phases = DIFFICULTY_PHASES;
  if (seconds <= phases[0].at) return phases[0];
  if (seconds >= phases[phases.length - 1].at) return phases[phases.length - 1];
  let i = 0;
  while (seconds > phases[i + 1].at) i++;
  const a = phases[i], b = phases[i + 1];
  const t = (seconds - a.at) / (b.at - a.at);
  const mix = {};
  for (const key in a.mix) mix[key] = lerp(a.mix[key], b.mix[key], t);
  return {
    at: seconds,
    speed: lerp(a.speed, b.speed, t),
    interval: lerp(a.interval, b.interval, t),
    aim: lerp(a.aim, b.aim, t),
    follow: lerp(a.follow, b.follow, t),
    boost: lerp(a.boost, b.boost, t),
    room: lerp(a.room, b.room, t),
    slack: lerp(a.slack, b.slack, t),
    mix
  };
}

function activePlaySeconds() {
  return (ROUND_DURATION_MS - timeLeftMs) / 1000;
}

function resetPacing() {
  pacing = { last: null, history: [], lastX: null, followFrom: null, waves: 0,
    lastCount: 0, nextAimWave: Math.floor(random(3, 5)), log: [] };
}

// ------------------------------------------
// Collision outlines (built once at load time)
// ------------------------------------------

// Row-by-row opaque extents of each rock sprite and of the dragon. Filling each
// row between its outermost pixels makes the safety map slightly pessimistic,
// never optimistic, compared with the pixel-accurate game collision.
function prepareRockPatterns() {
  rockProfiles = {};
  for (const kind in rockSprites) rockProfiles[kind] = spriteRowProfile(rockSprites[kind]);
  dragonProfile = buildDragonProfile(dragonFrames);
}

function spriteRowProfile(sprite) {
  const left = new Float32Array(PROFILE_BINS).fill(Infinity);
  const right = new Float32Array(PROFILE_BINS).fill(-Infinity);
  for (let y = 0; y < sprite.height; y++) {
    const bin = Math.floor(y / sprite.height * PROFILE_BINS);
    for (let x = 0; x < sprite.width; x++) {
      if (sprite.pixels[(y * sprite.width + x) * 4 + 3] < 200) continue;
      left[bin] = Math.min(left[bin], x / sprite.width);
      right[bin] = Math.max(right[bin], (x + 1) / sprite.width);
    }
  }
  return { left, right };
}

// Union over every flight frame, the hover bob, a little banking and the small
// steering offset in dragonRenderPose(), in px relative to (playerX, playerY).
function buildDragonProfile(frames) {
  const step = 2;
  const top = -100;
  const rows = 100;
  const left = new Float32Array(rows).fill(Infinity);
  const right = new Float32Array(rows).fill(-Infinity);
  const sway = 4;
  for (const frame of frames) {
    for (let y = 0; y < frame.height; y += 2) {
      for (let x = 0; x < frame.width; x += 2) {
        if (frame.pixels[(y * frame.width + x) * 4 + 3] < 200) continue;
        const dx = ((x + 1) / frame.width - 0.5) * DRAGON_W;
        const dy = ((y + 1) / frame.height - 0.5) * DRAGON_H;
        for (const angle of [-0.06, 0, 0.06]) {
          const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
          const ry = dx * Math.sin(angle) + dy * Math.cos(angle);
          for (const bob of [-3, 3]) {
            const bin = Math.floor((ry + bob - top) / step);
            if (bin < 0 || bin >= rows) continue;
            left[bin] = Math.min(left[bin], rx - 1.5 - sway);
            right[bin] = Math.max(right[bin], rx + 1.5 + sway);
          }
        }
      }
    }
  }
  return { top, step, rows, left, right };
}

// ------------------------------------------
// Safety map
// ------------------------------------------

function safeColX(c) {
  return MIN_X + (MAX_X - MIN_X) * c / (SAFE_COLS - 1);
}

function safeRowY(r) {
  return MIN_Y + (MAX_Y - MIN_Y) * r / (SAFE_ROWS - 1);
}

function rockGeometryAt(rock, depth) {
  const saved = rock.depth;
  rock.depth = depth;
  const g = rock.geometry();
  rock.depth = saved;
  return g;
}

// 1 where a dragon held at that grid position survives the whole danger window
// of every rock in the wave, 0 where any part of it could touch a rock.
function waveSafeCells(wave) {
  const safe = new Uint8Array(SAFE_COLS * SAFE_ROWS).fill(1);
  const prof = dragonProfile;
  const colStep = (MAX_X - MIN_X) / (SAFE_COLS - 1);
  for (const rock of wave) {
    const shape = rockProfiles[rock.kind];
    for (const depth of DANGER_DEPTHS) {
      const g = rockGeometryAt(rock, depth);
      const x0 = g.x - g.w / 2;
      for (let r = 0; r < SAFE_ROWS; r++) {
        const rowY = safeRowY(r);
        for (let k = 0; k < prof.rows; k++) {
          if (prof.left[k] > prof.right[k]) continue;
          const y = rowY + prof.top + (k + 0.5) * prof.step;
          if (y < g.top || y > g.base) continue;
          const bin = Math.min(PROFILE_BINS - 1, Math.floor((y - g.top) / g.h * PROFILE_BINS));
          if (shape.left[bin] > shape.right[bin]) continue;
          // Small sprite tilt about the base, plus a pixel of slack for rounding.
          const lean = (g.base - y) * rock.tilt;
          const rockLeft = x0 + shape.left[bin] * g.w + lean - 1;
          const rockRight = x0 + shape.right[bin] * g.w + lean + 1;
          // The dragon at playerX spans [playerX + left, playerX + right] on this row.
          const lo = Math.max(0, Math.ceil((rockLeft - prof.right[k] - MIN_X) / colStep));
          const hi = Math.min(SAFE_COLS - 1, Math.floor((rockRight - prof.left[k] - MIN_X) / colStep));
          for (let c = lo; c <= hi; c++) safe[r * SAFE_COLS + c] = 0;
        }
      }
    }
  }
  return safe;
}

// Safe spots with standing room on every side. Play-area walls count as room:
// steering into a wall simply stops the dragon there.
function erodeSafeCells(safe) {
  const colStep = (MAX_X - MIN_X) / (SAFE_COLS - 1);
  const rowStep = (MAX_Y - MIN_Y) / (SAFE_ROWS - 1);
  const mx = Math.round(FAIRNESS.marginX / colStep);
  const my = Math.round(FAIRNESS.marginY / rowStep);
  const robust = new Uint8Array(safe.length);
  for (let r = 0; r < SAFE_ROWS; r++) {
    for (let c = 0; c < SAFE_COLS; c++) {
      let ok = 1;
      for (let j = Math.max(0, r - my); ok && j <= Math.min(SAFE_ROWS - 1, r + my); j++) {
        for (let i = Math.max(0, c - mx); i <= Math.min(SAFE_COLS - 1, c + mx); i++) {
          if (!safe[j * SAFE_COLS + i]) { ok = 0; break; }
        }
      }
      robust[r * SAFE_COLS + c] = ok;
    }
  }
  return robust;
}

// Exact squared distance (px) from every grid cell to the nearest target cell,
// via the separable Felzenszwalb-Huttenlocher transform.
function distanceToCells(target) {
  const colStep = (MAX_X - MIN_X) / (SAFE_COLS - 1);
  const rowStep = (MAX_Y - MIN_Y) / (SAFE_ROWS - 1);
  const FAR = 1e12;
  const grid = new Float64Array(target.length);
  for (let i = 0; i < target.length; i++) grid[i] = target[i] ? 0 : FAR;
  const n = Math.max(SAFE_COLS, SAFE_ROWS);
  const f = new Float64Array(n), d = new Float64Array(n);
  const v = new Int32Array(n), z = new Float64Array(n + 1);

  // Lower envelope of parabolas rooted at each sample; positions are q * spacing.
  const meet = (q, p, spacing) =>
    ((f[q] + (q * spacing) ** 2) - (f[p] + (p * spacing) ** 2)) / (2 * spacing * (q - p));
  const pass = (count, spacing) => {
    let k = 0;
    v[0] = 0; z[0] = -Infinity; z[1] = Infinity;
    for (let q = 1; q < count; q++) {
      let s = meet(q, v[k], spacing);
      while (s <= z[k]) {
        k--;
        s = meet(q, v[k], spacing);
      }
      k++;
      v[k] = q; z[k] = s; z[k + 1] = Infinity;
    }
    k = 0;
    for (let q = 0; q < count; q++) {
      while (z[k + 1] < q * spacing) k++;
      d[q] = ((q - v[k]) * spacing) ** 2 + f[v[k]];
    }
  };

  for (let r = 0; r < SAFE_ROWS; r++) {
    for (let c = 0; c < SAFE_COLS; c++) f[c] = grid[r * SAFE_COLS + c];
    pass(SAFE_COLS, colStep);
    for (let c = 0; c < SAFE_COLS; c++) grid[r * SAFE_COLS + c] = d[c];
  }
  for (let c = 0; c < SAFE_COLS; c++) {
    for (let r = 0; r < SAFE_ROWS; r++) f[r] = grid[r * SAFE_COLS + c];
    pass(SAFE_ROWS, rowStep);
    for (let r = 0; r < SAFE_ROWS; r++) grid[r * SAFE_COLS + c] = d[r];
  }
  return grid;
}

// Furthest a player could have to travel, starting anywhere in `from` (all
// positions when null), to reach standing room in `robust`.
function worstTravel(from, robust) {
  const dist = distanceToCells(robust);
  let worst = 0;
  for (let i = 0; i < dist.length; i++) {
    if (from && !from[i]) continue;
    worst = Math.max(worst, dist[i]);
  }
  return Math.sqrt(worst);
}

// Check reachable safe space near the actual player rather than every possible
// position on the entire screen, which rejected most late-game formations.
function judgeWave(wave, now, soon) {
  const safe = waveSafeCells(wave);
  const robust = erodeSafeCells(safe);
  if (!robust.some(Boolean)) return null;

  // Speed only rises during a round: the later speed is the earliest arrival.
  const hitsAt = elapsed + DANGER_DEPTHS[0] / soon.speed;
  const passedAt = elapsed + 1 / now.speed;
  const noticedAt = elapsed + FAIRNESS.readDepth / now.speed + FAIRNESS.reactionFrames;
  const movesFrom = pacing.last ? Math.max(noticedAt, pacing.last.passedAt) : noticedAt;
  // Only part of the model player's reach may be needed, leaving spare time for
  // hesitation, so no wave sits exactly at the limit.
  const reach = (hitsAt - movesFrom) * FAIRNESS.speed * now.slack;
  if (reach <= 0) return null;
  const localStarts = new Uint8Array(safe.length);
  for (let r = 0; r < SAFE_ROWS; r++) {
    for (let c = 0; c < SAFE_COLS; c++) {
      const i = r * SAFE_COLS + c;
      if (Math.hypot(safeColX(c) - playerX, safeRowY(r) - playerY) <= 95 &&
          (!pacing.last || pacing.last.safe[i])) localStarts[i] = 1;
    }
  }
  // If the player is already outside the previous safe area, evaluate their
  // actual position instead of silently accepting an empty set of start cells.
  if (!localStarts.some(Boolean)) {
    const c = Math.round(constrain((playerX - MIN_X) / (MAX_X - MIN_X), 0, 1) * (SAFE_COLS - 1));
    const r = Math.round(constrain((playerY - MIN_Y) / (MAX_Y - MIN_Y), 0, 1) * (SAFE_ROWS - 1));
    localStarts[r * SAFE_COLS + c] = 1;
  }
  const need = worstTravel(localStarts, robust);
  if (need > reach) return null;
  return { safe, robust, passedAt, need, reach };
}

// A flying sheep should stay collectable: prefer waves that leave standing room
// at its height.
function leavesSheepRoute(robust) {
  const sheep = flock.find(s => !s.collected);
  if (!sheep) return true;
  for (let r = 0; r < SAFE_ROWS; r++) {
    if (Math.abs(safeRowY(r) - sheep.y) > 45) continue;
    for (let c = 0; c < SAFE_COLS; c++) if (robust[r * SAFE_COLS + c]) return true;
  }
  return false;
}

// ------------------------------------------
// Wave patterns
// ------------------------------------------

function pickPattern(d, attempt) {
  // Later retries fall back to simpler single-rock waves.
  const mix = attempt >= 14 ? { single: 1, aimed: 1 } : { ...d.mix };
  // Precise pursuit is scheduled separately every three or four accepted waves.
  mix.single = (mix.single || 0) + (mix.aimed || 0);
  mix.aimed = 0;
  // The very first wave passes to one side so new players see how rocks approach.
  if (pacing.waves === 0) return "intro";
  // Avoid the same formation three times in a row.
  const h = pacing.history;
  if (h.length >= 2 && h[h.length - 1] === h[h.length - 2] && Object.keys(mix).length > 2) {
    mix[h[h.length - 1]] = 0;
  }
  let total = 0;
  for (const key in mix) total += mix[key];
  let roll = random(total);
  for (const key in mix) {
    roll -= mix[key];
    if (roll <= 0 && mix[key] > 0) return key;
  }
  return "single";
}

function randomRockKind(tall = 0.45, medium = 0.30) {
  const roll = random();
  return roll < tall ? "tall" : roll < tall + medium ? "medium" : "short";
}

// Left, center and right thirds take turns so singles do not repeat a lane.
function laneAwayFrom(x) {
  const third = (ROCK_X_MAX - ROCK_X_MIN) / 3;
  const thirds = [0, 1, 2].filter(i => x === null ||
    Math.abs(ROCK_X_MIN + third * (i + 0.5) - x) > third * 0.75);
  const pick = random(thirds.length ? thirds : [0, 1, 2]);
  return ROCK_X_MIN + third * (pick + random(0.1, 0.9));
}

function rockAt(x, kind, d) {
  return new OceanRock(constrain(x, 70, GW - 70), kind, random(0, d.boost));
}

function aimOneRockAtPlayer(wave, d) {
  if (!wave.length) return;
  // Replace only the nearest member; preserve the other members of the formation.
  let nearest = 0;
  for (let i = 1; i < wave.length; i++) {
    if (Math.abs(wave[i].targetX - playerX) < Math.abs(wave[nearest].targetX - playerX)) nearest = i;
  }
  const preferred = playerY >= 420 ? "short" : playerY >= 250 ? "medium" : "tall";
  const kinds = preferred === "short" ? ["short", "medium", "tall"]
    : preferred === "medium" ? ["medium", "tall"] : ["tall"];
  for (const kind of kinds) {
    const aimed = rockAt(playerX, kind, d);
    // Confirm its visible silhouette actually threatens the current player pose.
    aimed.depth = 0.98;
    const threatens = touchesDragon(aimed);
    aimed.depth = 0;
    if (!threatens) continue;
    aimed.aimedAtPlayer = true;
    wave[nearest] = aimed;
    return true;
  }
  return false;
}

// Each pattern returns the rocks of one wave; judgeWave() decides if it is fair.
function buildPattern(type, d) {
  const side = playerX < GW / 2 ? 1 : -1;
  switch (type) {
    case "intro": {
      // Clearly beside the dragon, never at it.
      const x = constrain(playerX + random([-1, 1]) * random(290, 360), ROCK_X_MIN, ROCK_X_MAX);
      return [rockAt(Math.abs(x - playerX) < 250 ? playerX + side * 320 : x, "tall", d)];
    }
    case "single":
      return [rockAt(laneAwayFrom(pacing.lastX), randomRockKind(), d)];
    case "aimed": {
      // Aimed near the dragon: no spot on screen stays safe without steering.
      // High-flying players get pillars they cannot simply hop over.
      const kind = playerY < 300 ? randomRockKind(0.8, 0.2) : randomRockKind();
      return [rockAt(playerX + random(-d.aim, d.aim), kind, d)];
    }
    case "follow": {
      // Slalom: the second rock waits where the dragon most likely dodged to.
      const from = pacing.followFrom;
      const dir = from < GW / 2 ? 1 : -1;
      return [rockAt(from + dir * random(210, 280), randomRockKind(0.55, 0.3), d)];
    }
    case "double": {
      // One rock near the dragon and a partner further along: pick a side.
      const a = constrain(playerX + random(-d.aim, d.aim) * 1.5, ROCK_X_MIN, ROCK_X_MAX);
      const gap = random(300, 470);
      const dir = random() < 0.5 ? 1 : -1;
      const b = a + (ROCK_X_MIN <= a + dir * gap && a + dir * gap <= ROCK_X_MAX ? dir : -dir) * gap;
      const kinds = random() < 0.5 ? ["tall", randomRockKind()] : [randomRockKind(), "tall"];
      return [rockAt(a, kinds[0], d), rockAt(b, kinds[1], d)];
    }
    case "gate": {
      // Two pillars framing a gap the dragon fits through, offset from where it is now.
      const shift = random(90, 230) * (random() < 0.5 ? -1 : 1);
      const center = constrain(playerX + shift, MIN_X + 20, MAX_X - 20);
      const half = (DRAGON_SPAN + d.room) / 2;
      const leftRock = rockAt(0, random() < 0.7 ? "tall" : "medium", d);
      const rightRock = rockAt(0, random() < 0.7 ? "tall" : "medium", d);
      leftRock.targetX = center - half - leftRock.targetWidth / 2;
      rightRock.targetX = center + half + rightRock.targetWidth / 2;
      return [leftRock, rightRock].filter(rock => rock.targetX > -40 && rock.targetX < GW + 40);
    }
    case "hurdle": {
      // A low rock under the dragon with a pillar beside it: hop over or go around.
      const x = playerX + random(-50, 50);
      const pillar = x + side * random(250, 320);
      return [rockAt(x, "short", d), rockAt(pillar, "tall", d)];
    }
    case "triple": {
      // A wall of three rocks whose low middle section is the way through:
      // fly high over it. The low section sits a short way from the dragon.
      const spacing = random(270, 320);
      const low = constrain(playerX + random(60, 200) * (random() < 0.5 ? -1 : 1),
        MIN_X + 20, MAX_X - 20);
      const sides = random([["tall", "tall"], ["tall", "medium"], ["medium", "tall"]]);
      const wall = [rockAt(low, "short", d)];
      [-1, 1].forEach((dir, i) => {
        const rock = rockAt(0, sides[i], d);
        rock.targetX = low + dir * spacing;
        // Near a screen edge the outer rock would stand off screen; leave it out.
        if (rock.targetX > -40 && rock.targetX < GW + 40) wall.push(rock);
      });
      return wall;
    }
  }
  return [];
}

// Spawns the next fair wave and returns the frames until the one after it.
function spawnPattern() {
  const now = difficultyAt(activePlaySeconds());
  const soon = difficultyAt(activePlaySeconds() + 2.5);
  // Keep normal wave pacing until the round has actually ended.
  if (timeLeftMs <= 0) return Infinity;

  const follow = pacing.followFrom !== null;
  pacing.followFrom = null;
  const aimDue = pacing.waves + 1 >= pacing.nextAimWave;
  for (let attempt = 0; attempt < 36; attempt++) {
    // If a formation cannot fit safely, simplify it in this same spawn attempt.
    // Reuse a recent lane first, with tall, medium and low alternatives.
    const fallback = attempt >= 18;
    const type = fallback ? "single" : follow && attempt < 3 ? "follow" : pickPattern(now, attempt);
    const fallbackXs = [pacing.lastX === null ? ROCK_X_MIN : pacing.lastX,
      ROCK_X_MIN, ROCK_X_MAX, GW / 2, playerX < GW / 2 ? ROCK_X_MAX : ROCK_X_MIN];
    const wave = fallback
      ? [rockAt(fallbackXs[(attempt - 18) % fallbackXs.length],
        ["tall", "medium", "short"][Math.floor((attempt - 18) / 5) % 3], now)]
      : buildPattern(type, now);
    if (!wave.length) continue;
    // If targeted waves are temporarily unsafe, defer pursuit rather than delaying all rocks.
    const aimed = aimDue && attempt < 8;
    if (aimed && !aimOneRockAtPlayer(wave, now)) continue;
    // Late play must not collapse into repeated low singles. Try a formation
    // first after a single, while retaining a safe fallback if space is tight.
    if (activePlaySeconds() >= 30 && !wave.some(rock => rock.kind !== "short")) continue;
    if (activePlaySeconds() >= 35 && pacing.lastCount === 1 && wave.length === 1 && attempt < 14) continue;
    const verdict = judgeWave(wave, now, soon);
    if (!verdict) continue;
    if (attempt < 7 && !leavesSheepRoute(verdict.robust)) continue;

    rocks.push(...wave);
    pacing.last = { safe: verdict.safe, passedAt: verdict.passedAt };
    pacing.history.push(type);
    if (pacing.history.length > 6) pacing.history.shift();
    pacing.lastX = wave[0].targetX;
    pacing.lastCount = wave.length;
    pacing.waves++;
    if (aimed) pacing.nextAimWave = pacing.waves + Math.floor(random(3, 5));
    pacing.log.push({ t: activePlaySeconds(), type, rocks: wave.length, attempt,
      wave: pacing.waves, aimed, fallback, kinds: wave.map(rock => rock.kind),
      need: verdict.need, reach: verdict.reach });

    // Keep gentle variation around each phase's own pace; never cap the easy
    // phase to the late-game interval, which would erase the difficulty ramp.
    const gap = now.interval * random(0.97, 1.03);
    if ((type === "single" || type === "aimed") && random() < now.follow) {
      pacing.followFrom = wave[0].targetX;
      return gap;
    }
    return gap;
  }
  // Nothing fair fits right now: wait a moment and try again.
  pacing.log.push({ t: activePlaySeconds(), type: "skipped", rocks: 0 });
  return 6;
}
