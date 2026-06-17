// =====================================================
// PATHFINDING — shared pathing and collision helpers
// Depends on sim/constants.js
// =====================================================

function chebyshev(x1, y1, x2, y2) {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}
function collisionMath(x, y, s, x2, y2, s2) {
  return !(x > x2 + s2 - 1 || x + s - 1 < x2 || y - s + 1 > y2 || y < y2 - s2 + 1);
}
function closestTileTo(mob, tx, ty) {
  return {
    x: Math.max(mob.x, Math.min(mob.x + mob.size - 1, tx)),
    y: Math.max(mob.y - mob.size + 1, Math.min(mob.y, ty)),
  };
}
function distToMob(px, py, mob) {
  let ct = closestTileTo(mob, px, py);
  return chebyshev(px, py, ct.x, ct.y);
}
function collidesWithEntities(x, y, s, entities) {
  for (let e of entities) {
    if (collisionMath(x, y, s, e.x, e.y, e.size)) return true;
  }
  return false;
}
function collidesWithMobs(x, y, s, mobs, exclude, skipNibblers) {
  for (let m of mobs) {
    if (m === exclude || m.dead) continue;
    if (exclude && exclude.parentBlobId === m.id && m.dying > 0) continue;
    if (skipNibblers && m.type === "nibbler") continue;
    if (collisionMath(x, y, s, m.x, m.y, m.size)) return m;
  }
  return null;
}
function isWithinMeleeRange(mob, target) {
  let dx = target.x - mob.x,
    dy = target.y - mob.y,
    s = mob.size;
  return (
    (dx < s && dx >= 0 && (dy === 1 || dy === -s)) ||
    (dy > -s && dy <= 0 && (dx === -1 || dx === s))
  );
}
function isWithinSecondaryMeleeRange(mob, target) {
  // Ranger/mager/blob secondary melee can hit 1 tile from their footprint in any direction, including diagonals.
  let ct = closestTileTo(mob, target.x, target.y);
  return chebyshev(target.x, target.y, ct.x, ct.y) === 1;
}
function canUseSecondaryMelee(mob, player) {
  return (
    (mob.type === "mager" || mob.type === "ranger" || mob.type === "blob") &&
    isWithinSecondaryMeleeRange(mob, player)
  );
}

// ===== PLAYER PATHING =====
// Find closest face tile (melee-adjacent, non-diagonal) with N/S priority on ties, Manhattan tiebreaker
function getClosestFaceTile(mob, px, py, region) {
  let s = mob.size,
    mx = mob.x,
    my = mob.y,
    bl = region.blocked;
  let bestDist = Infinity,
    bestMan = Infinity,
    bestTile = null;
  function check(x, y, isNS) {
    if (bl[(x << 6) | y]) return;
    let d = chebyshev(px, py, x, y),
      m = Math.abs(px - x) + Math.abs(py - y);
    // Priority: 1) smallest Chebyshev, 2) N/S over E/W at same Chebyshev, 3) smallest Manhattan
    if (
      d < bestDist ||
      (d === bestDist && isNS && bestTile && !bestTile.isNS) ||
      (d === bestDist && isNS === (!bestTile || bestTile.isNS) && m < bestMan)
    ) {
      bestDist = d;
      bestMan = m;
      bestTile = { x, y, isNS };
    }
  }
  // South face
  for (let x = mx; x < mx + s; x++) check(x, my + 1, true);
  // North face
  for (let x = mx; x < mx + s; x++) check(x, my - s, true);
  // West face
  if (mx - 1 >= ARENA_X_MIN) for (let y = my - s + 1; y <= my; y++) check(mx - 1, y, false);
  // East face
  if (mx + s <= ARENA_X_MAX) for (let y = my - s + 1; y <= my; y++) check(mx + s, y, false);
  return bestTile;
}

// OSRS-style single walk step: straight in longer axis first, then diagonal
// Falls back to BFS if the direct step is blocked
function osrsWalkStep(sx, sy, tx, ty, region) {
  if (sx === tx && sy === ty) return null;
  let dx = tx - sx,
    dy = ty - sy,
    dxA = Math.abs(dx),
    dyA = Math.abs(dy);
  let xs = Math.sign(dx),
    ys = Math.sign(dy),
    bl = region.blocked;
  let nx, ny;
  if (dxA > dyA) {
    nx = sx + xs;
    ny = sy;
  } // straight in X
  else if (dyA > dxA) {
    nx = sx;
    ny = sy + ys;
  } // straight in Y
  else {
    nx = sx + xs;
    ny = sy + ys;
  } // diagonal
  // Validate move
  if (dxA === dyA) {
    // diagonal: check destination + both cardinal clipping tiles
    if (!bl[(nx << 6) | ny] && !bl[((sx + xs) << 6) | sy] && !bl[(sx << 6) | (sy + ys)])
      return { x: nx, y: ny };
  } else {
    // cardinal: just check destination
    if (!bl[(nx << 6) | ny]) return { x: nx, y: ny };
  }
  // Blocked — BFS fallback
  return playerBFS(sx, sy, tx, ty, region);
}

// BFS pathfinder for player: only entity collision, can walk through mobs
function playerBFS(sx, sy, tx, ty, region) {
  if (sx === tx && sy === ty) return null;
  let bl = region.blocked;
  let visited = new Uint8Array(4096); // 64×64
  visited[(sx << 6) | sy] = 1;
  // Directions: W,E,S,N,SW,SE,NW,NE (cardinal first, matches)
  let queue = [{ x: sx, y: sy, parent: null }],
    qi = 0;
  while (qi < queue.length && queue.length < 2000) {
    let node = queue[qi++];
    if (node.x === tx && node.y === ty) {
      // Backtrack to find first step
      let step = node;
      while (step.parent && !(step.parent.x === sx && step.parent.y === sy)) step = step.parent;
      return { x: step.x, y: step.y };
    }
    for (let d = 0; d < 8; d++) {
      let nx = node.x + BFS_DIRS[d][0],
        ny = node.y + BFS_DIRS[d][1];
      if (nx < ARENA_X_MIN || nx > ARENA_X_MAX || ny < ARENA_Y_MIN || ny > ARENA_Y_MAX) continue;
      let key = (nx << 6) | ny;
      if (visited[key]) continue;
      if (bl[key]) continue;
      // Diagonal: check both cardinal neighbors
      if (d >= 4) {
        if (bl[((node.x + BFS_DIRS[d][0]) << 6) | node.y]) continue;
        if (bl[(node.x << 6) | (node.y + BFS_DIRS[d][1])]) continue;
      }
      visited[key] = 1;
      queue.push({ x: nx, y: ny, parent: node });
    }
  }
  // No path found — try to get as close as possible (backup: direct step)
  let dx = Math.sign(tx - sx),
    dy = Math.sign(ty - sy),
    nx = sx + dx,
    ny = sy + dy;
  if (dx !== 0 && dy !== 0) {
    if (!bl[(nx << 6) | ny] && !bl[((sx + dx) << 6) | sy] && !bl[(sx << 6) | (sy + dy)])
      return { x: nx, y: ny };
    if (!bl[((sx + dx) << 6) | sy]) return { x: sx + dx, y: sy };
    if (!bl[(sx << 6) | (sy + dy)]) return { x: sx, y: sy + dy };
  } else if (dx !== 0 && !bl[(nx << 6) | ny]) return { x: nx, y: ny };
  else if (dy !== 0 && !bl[(nx << 6) | ny]) return { x: nx, y: ny };
  return null;
}
