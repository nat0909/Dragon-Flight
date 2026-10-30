// Collision uses opaque sprite pixels in the same transformed positions as rendering.
function spritePose(sprite, x, y, w, h, angle, anchorX, anchorY) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const corners = [[anchorX, anchorY], [anchorX + w, anchorY],
    [anchorX, anchorY + h], [anchorX + w, anchorY + h]].map(([a,b]) =>
      ({ x: x + a * cos - b * sin, y: y + a * sin + b * cos }));
  return { sprite, x, y, w, h, cos, sin, anchorX, anchorY,
    left: Math.min(...corners.map(p => p.x)), right: Math.max(...corners.map(p => p.x)),
    top: Math.min(...corners.map(p => p.y)), bottom: Math.max(...corners.map(p => p.y)) };
}

function opaqueAt(pose, x, y) {
  const dx = x - pose.x, dy = y - pose.y;
  const u = ((dx * pose.cos + dy * pose.sin) - pose.anchorX) / pose.w;
  const v = ((-dx * pose.sin + dy * pose.cos) - pose.anchorY) / pose.h;
  if (u < 0 || u >= 1 || v < 0 || v >= 1) return false;
  const image = pose.sprite;
  return image.pixels[(Math.floor(v * image.height) * image.width + Math.floor(u * image.width)) * 4 + 3] >= 200;
}

// Returns the first solid contact point (truthy), or false when the sprites miss.
function solidSpriteOverlap(a, b, screenWidth, screenHeight) {
  const left = Math.max(0, Math.ceil(Math.max(a.left, b.left)));
  const right = Math.min(screenWidth - 1, Math.floor(Math.min(a.right, b.right)));
  const top = Math.max(0, Math.ceil(Math.max(a.top, b.top)));
  const bottom = Math.min(screenHeight - 1, Math.floor(Math.min(a.bottom, b.bottom)));
  for (let y = top; y <= bottom; y++) {
    for (let x = left; x <= right; x++) {
      const px = x + 0.5, py = y + 0.5;
      if (!opaqueAt(a, px, py) || !opaqueAt(b, px, py)) continue;
      // A one-pixel inset ignores faint fringes and gives near misses some grace.
      if ([[1,0],[-1,0],[0,1],[0,-1]].every(([dx,dy]) =>
        opaqueAt(a, px + dx, py + dy) && opaqueAt(b, px + dx, py + dy))) return { x: px, y: py };
    }
  }
  return false;
}
