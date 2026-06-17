// =====================================================
// SIM CORE — pure engine (shared between main thread and workers)
// Depends on sim/constants.js
// =====================================================

// ===== UTILITY FUNCTIONS =====
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
function rangedDelay(dist) {
  if (dist <= 4) return 2;
  if (dist <= 8) return 3;
  if (dist <= 11) return 4;
  return 5;
}
function magicDelay(dist) {
  if (dist <= 6) return 2;
  if (dist <= 10) return 3;
  if (dist <= 14) return 4;
  return 5;
}
function magerDelay(dist) {
  if (dist <= 5) return 2;
  if (dist <= 9) return 3;
  if (dist <= 13) return 4;
  return 5;
}
function delayFromHitTickList(list, dist) {
  let d = Math.max(1, Math.floor(dist));
  let hitTick = list[Math.min(d, list.length) - 1];
  return hitTick - 1;
}
function monsterProjectileOrigin(mob) {
  // mob.x/mob.y is the SW tile of the NPC footprint.
  if (mob.type === "mager") return { x: mob.x + 2, y: mob.y - 2 }; // NE tile of the central 2x2
  if (mob.type === "bat") return { x: mob.x, y: mob.y }; // SW tile of the 2x2
  if (mob.type === "ranger" || mob.type === "blob") return { x: mob.x + 1, y: mob.y - 1 }; // center tile of 3x3
  return { x: mob.x, y: mob.y };
}
function monsterProjectileDistance(px, py, mob) {
  let o = monsterProjectileOrigin(mob);
  return chebyshev(px, py, o.x, o.y);
}
function monsterProjectileDelay(mob, style, player) {
  if (style === "melee") return 1;
  let originDist = monsterProjectileDistance(player.x, player.y, mob);
  if (mob.type === "mager")
    return delayFromHitTickList(MONSTER_PROJECTILE_HIT_TICKS.mager, originDist);
  if (mob.type === "ranger")
    return delayFromHitTickList(MONSTER_PROJECTILE_HIT_TICKS.ranger, originDist);
  if (mob.type === "bat") return delayFromHitTickList(MONSTER_PROJECTILE_HIT_TICKS.bat, originDist);
  if (mob.type === "blob")
    return delayFromHitTickList(
      style === "range"
        ? MONSTER_PROJECTILE_HIT_TICKS.blobRange
        : MONSTER_PROJECTILE_HIT_TICKS.blobMage,
      originDist,
    );
  // Preserve legacy timing for mobs not covered by the calibrated projectile-origin tables.
  let edgeDist = distToMob(player.x, player.y, mob);
  if (mob.type === "blobletRange") return magicDelay(edgeDist);
  if (style === "range") return rangedDelay(edgeDist);
  return magicDelay(edgeDist);
}
// Player projectile delays (weapon → hitsplat landing)
function playerBlowpipeDelay() {
  return 2;
}
function playerAyakDelay(dist) {
  if (dist <= 2) return 2;
  return 3;
}
function playerBarrageDelay(dist) {
  if (dist <= 1) return 2;
  if (dist <= 3) return 3;
  if (dist <= 7) return 4;
  return 5;
}
// Blood barrage calculates distance to mob's SW tile directly
function playerProjectileDelay(loadout, px, py, target) {
  if (loadout.atkSpeed === 2) return playerBlowpipeDelay(); // blowpipe
  if (loadout.isBloodBarrage) {
    let swDist = chebyshev(px, py, target.x, target.y);
    return playerBarrageDelay(swDist);
  }
  let dist = distToMob(px, py, target);
  return playerAyakDelay(dist); // mage tank
}

function hasLineOfSight(region, x1, y1, x2, y2, s, r, isNPC) {
  let bl = region.blocked;
  if (bl[(x1 << 6) | y1] || bl[(x2 << 6) | y2]) return false;
  if (collisionMath(x1, y1, s, x2, y2, 1)) return false;
  if (r === 1) {
    let dx = x2 - x1,
      dy = y2 - y1;
    return (
      (dx < s && dx >= 0 && (dy === 1 || dy === -s)) ||
      (dy > -s && dy <= 0 && (dx === -1 || dx === s))
    );
  }
  if (isNPC) {
    let tx = Math.max(x1, Math.min(x1 + s - 1, x2)),
      ty = Math.max(y1 - s + 1, Math.min(y1, y2));
    return hasLineOfSight(region, x2, y2, tx, ty, 1, r, false);
  }
  if (Math.abs(x2 - x1) > r || Math.abs(y2 - y1) > r) return false;
  return raycast(region, x1, y1, x2, y2);
}
function raycast(region, x1, y1, x2, y2) {
  let dx = x2 - x1,
    dy = y2 - y1,
    dxAbs = Math.abs(dx),
    dyAbs = Math.abs(dy),
    bl = region.blocked;
  if (dxAbs === 0 && dyAbs === 0) return true;
  if (dxAbs > dyAbs) {
    let xInc = dx > 0 ? 1 : -1,
      slope = Math.trunc((dy << 16) / dxAbs),
      y = (y1 << 16) + 0x8000;
    if (dy < 0) y -= 1;
    let xTile = x1;
    while (xTile !== x2) {
      xTile += xInc;
      let yTile = y >>> 16;
      if (bl[(xTile << 6) | yTile]) return false;
      y += slope;
      let ny = y >>> 16;
      if (ny !== yTile && bl[(xTile << 6) | ny]) return false;
    }
  } else {
    let yInc = dy > 0 ? 1 : -1,
      slope = Math.trunc((dx << 16) / dyAbs),
      x = (x1 << 16) + 0x8000;
    if (dx < 0) x -= 1;
    let yTile = y1;
    while (yTile !== y2) {
      yTile += yInc;
      let xTile = x >>> 16;
      if (bl[(xTile << 6) | yTile]) return false;
      x += slope;
      let nx = x >>> 16;
      if (nx !== xTile && bl[(nx << 6) | yTile]) return false;
    }
  }
  return true;
}
function mobHasLOS(region, mob, target) {
  return mob.range === 1
    ? isWithinMeleeRange(mob, target)
    : hasLineOfSight(region, mob.x, mob.y, target.x, target.y, mob.size, mob.range, true);
}
function playerHasLOS(region, px, py, mob, range) {
  let cp = closestTileTo(mob, px, py);
  return hasLineOfSight(region, px, py, cp.x, cp.y, 1, range, false);
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
function resolveMonsterAttackStats(loadout, mobType, style) {
  let monAtk = loadout.monsterAtk[mobType];
  if (!monAtk) return null;
  if (style === "melee" && monAtk.melee) return monAtk.melee;
  if (mobType === "blob") {
    if (style === "magic") return monAtk.mage;
    if (style === "range") return monAtk.range;
    return monAtk.range;
  }
  return monAtk;
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

function createRegion(pillarConfig) {
  let entities = [];
  for (let x = ARENA_X_MIN - 1; x <= ARENA_X_MAX + 1; x++) {
    entities.push({ x, y: ARENA_Y_MIN - 1, size: 1 });
    entities.push({ x, y: ARENA_Y_MAX + 1, size: 1 });
  }
  for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++) {
    entities.push({ x: ARENA_X_MIN - 1, y, size: 1 });
    entities.push({ x: ARENA_X_MAX + 1, y, size: 1 });
  }
  let p2 = [];
  for (let [key, loc] of [
    ["S", PILLAR_LOCS.S],
    ["W", PILLAR_LOCS.W],
    ["N", PILLAR_LOCS.N],
  ]) {
    if (pillarConfig[key]) {
      let p = {
        x: loc.x,
        y: loc.y,
        size: 3,
        hp: 255,
        maxHp: 255,
        isPillar: true,
        dead: false,
        id: "pillar" + key,
      };
      p2.push(p);
      entities.push(p);
    }
  }
  // Precompute blocked tile grid for O(1) entity collision lookups (if you watched this AUTOZUK video, this is how we got that massive boost in speed and efficiency)
  let blocked = new Uint8Array(4096); // 64×64 grid, index = (x<<6)|y
  for (let e of entities) {
    let ex1 = e.x + e.size - 1,
      ey0 = e.y - e.size + 1;
    for (let ex = e.x; ex <= ex1; ex++)
      for (let ey = ey0; ey <= e.y; ey++) blocked[(ex << 6) | ey] = 1;
  }
  return { entities, pillars: p2, blocked };
}

function spawnNibblers(mobs, region, createFn, idFn) {
  // Spawn 3 nibblers in the 3x3 box: gameX 19-21, gameY 25-27
  // (local coords 9:17 to 11:19 where SW=1:1)
  let positions = [];
  for (let x = 9; x <= 11; x++) for (let y = 12; y <= 14; y++) positions.push({ x, y });
  // Shuffle positions
  for (let i = positions.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  let spawned = 0;
  for (let pos of positions) {
    if (spawned >= 3) break;
    if (!region.blocked[(pos.x << 6) | pos.y] && !collidesWithMobs(pos.x, pos.y, 1, mobs, null)) {
      let nib = createFn("nibbler", pos.x, pos.y, idFn());
      nib.aggroTarget = "player";
      nib.stunned = 0;
      mobs.push(nib);
      spawned++;
    }
  }
}

function parseSpawnCode(code) {
  code = code.trim().toUpperCase();
  if (!code) return { error: "Enter a spawn code" };
  let spawns = [],
    i = 0,
    pos = 0;
  while (i < code.length && pos < 9) {
    let ch = code[i],
      type = null;
    switch (ch) {
      case "M":
        type = "mager";
        break;
      case "R":
        type = "ranger";
        break;
      case "X":
        type = "meleer";
        break;
      case "B":
        type = "blob";
        break;
      case "Y":
        type = "bat";
        break;
      case "O":
        type = "nothing";
        break;
      default:
        return { error: `Unknown '${ch}' at pos ${i + 1}` };
    }
    i++;
    // Check for optional infernoscouter index digit after mob char
    let infNum = 0;
    if (i < code.length && code[i] >= "1" && code[i] <= "9") {
      infNum = parseInt(code[i]);
      i++;
    }
    spawns.push({ type, x: SPAWN_LOCATIONS[pos].x, y: SPAWN_LOCATIONS[pos].y, infNum });
    pos++;
  }
  // Assign implied infernoscouter number to mob(s) without one
  let nonNothing = spawns.filter((s) => s.type !== "nothing");
  let hasExplicit = nonNothing.some((s) => s.infNum > 0);
  if (hasExplicit) {
    let usedNums = new Set(nonNothing.filter((s) => s.infNum > 0).map((s) => s.infNum));
    let remaining = [];
    for (let n = 1; n <= nonNothing.length; n++) if (!usedNums.has(n)) remaining.push(n);
    remaining.sort((a, b) => b - a); // assign highest remaining first
    let ri = 0;
    for (let s of nonNothing)
      if (s.infNum === 0 && ri < remaining.length) s.infNum = remaining[ri++];
  }
  return { spawns, hasIndexInfo: hasExplicit };
}

function findRespawnLocation(size, region, mobs) {
  for (let x = 16; x < 23; x++)
    for (let y = 11; y < 24; y++)
      if (
        !collidesWithMobs(x, y, size, mobs, null) &&
        !collidesWithEntities(x, y, size, region.entities)
      )
        return { x, y };
  return { x: 11, y: 9 };
}

// ===== SEEDED PRNG =====
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// =====================================================
// PHASE 2: HEADLESS SIMULATION ENGINE
// =====================================================
function hlCreateMob(type, x, y, id) {
  let d = MOB_DEFS[type];
  return {
    id,
    type,
    x,
    y,
    size: d.size,
    hp: d.hp,
    maxHp: d.hp,
    atkSpeed: d.atkSpeed,
    range: d.range,
    style: d.style,
    attackDelay: 0,
    stunned: 0,
    frozen: 0,
    dead: false,
    dying: -1,
    dyingStartTick: -1,
    corpseRemovalTick: undefined,
    revivedOnce: false,
    hasLOS: false,
    hadLOS: false,
    isBlob: d.isBlob || false,
    blobScanPrayer: null,
    hasDig: d.hasDig || false,
    digTimer: 0,
    digLocation: null,
    hasFlicker: d.hasFlicker || false,
    flickering: false,
    incomingProjectiles: [],
    noLOSTicks: 0,
    currentStyle: null,
  };
}
function hlCreatePlayer(x, y, loadout) {
  let startHp = loadoutStartingHp(loadout),
    maxHp = Math.max(startHp, loadoutBloodMaxHp(loadout));
  return {
    x,
    y,
    size: 1,
    aggro: null,
    attackDelay: 0,
    range: loadout.range,
    atkSpeed: loadout.atkSpeed,
    incomingProjectiles: [],
    autoRetaliate: true,
    lastHit: true,
    hp: startHp,
    maxHp,
    recoilQueue: [],
    echoBootsCooldown: 0,
    lastAttacker: null,
  };
}
function hlInitState(spawnCode, playerPos, pillarConfig, loadout, cachedRegion, seed) {
  let idCounter = 0;
  let rng = seed === undefined || seed === null ? Math.random : mulberry32(seed);
  let region = cachedRegion || createRegion(pillarConfig);
  let parsed = parseSpawnCode(spawnCode);
  if (parsed.error) return null;
  let initialEnemyCount = parsed.spawns.reduce(
    (count, spawn) => count + (spawn.type === "nothing" ? 0 : 1),
    0,
  );
  let mobs = [],
    player = hlCreatePlayer(playerPos.x, playerPos.y, loadout),
    deadMobs = [];
  for (let spawn of parsed.spawns) {
    if (spawn.type === "nothing") continue;
    let m = hlCreateMob(spawn.type, spawn.x, spawn.y, idCounter++);
    m.infNum = spawn.infNum || 0;
    mobs.push(m);
  }
  // Sort by game index: higher infNum = lower game index = processed first
  if (parsed.hasIndexInfo) mobs.sort((a, b) => b.infNum - a.infNum);
  // Spawn 3 nibblers randomly if all pillars are dead
  let allPillarsDead = !pillarConfig.S && !pillarConfig.W && !pillarConfig.N;
  if (allPillarsDead) {
    spawnNibblers(
      mobs,
      region,
      (t, x, y, id) => hlCreateMob(t, x, y, id),
      () => idCounter++,
    );
  }
  // Store initial mob HP for post-hoc recoil tracking in calcSimDamage
  let mobInitHP = {};
  let mobMap = new Map();
  for (let m of mobs) {
    mobInitHP[m.id] = { hp: m.hp, type: m.type };
    mobMap.set(m.id, m);
  }
  return {
    region,
    mobs,
    player,
    tick: 0,
    deadMobs,
    idCounter,
    loadout,
    attacks: [],
    mobTypes: new Set(mobs.map((m) => m.type)),
    mobInitHP,
    mobMap,
    delayedBlobletSpawns: [],
    initialEnemyCount,
    rng,
  };
}
function hlMarkMobForProjectileRemoval(mob, tick) {
  if (mob.dead) return;
  mob.hp = 0;
  if (mob.pendingRemovalTick === undefined || mob.pendingRemovalTick > tick + 1) {
    mob.pendingRemovalTick = tick + 1;
    mob.dyingStartTick = tick;
  }
}
function hlProcessCorpseExpiry(S, tick) {
  for (let mob of S.mobs) {
    if (mob.dead || mob.dying <= 0) continue;
    let remain = (mob.corpseRemovalTick ?? tick) - tick;
    if (remain <= 0) {
      mob.dead = true;
      mob.dying = 0;
      mob.corpseRemovalTick = undefined;
      mob.pendingRemovalTick = undefined;
    } else mob.dying = remain;
  }
}
function hlProcessPendingMobDeaths(S, tick) {
  let player = S.player;
  for (let mob of S.mobs) {
    if (mob.dead || mob.dying > 0) continue;
    if (mob.pendingRemovalTick !== undefined && mob.pendingRemovalTick <= tick) {
      mob.pendingRemovalTick = undefined;
      mob.dying = DEATH_ANIM_TICKS;
      mob.corpseRemovalTick = tick + DEATH_ANIM_TICKS;
      hlOnDeath(mob, player, S.region, S.mobs, tick, S);
    }
  }
}

function hlTick(S) {
  S.tick++;
  let t = S.tick,
    region = S.region,
    mobs = S.mobs,
    player = S.player,
    loadout = S.loadout;
  hlProcessCorpseExpiry(S, t);
  hlProcessPendingMobDeaths(S, t);
  hlProcessDelayedBlobletSpawns(S, t);
  // Move mobs
  for (let mob of mobs) {
    if (mob.dead || mob.dying > 0) continue;
    if (mob.stunned > 0) {
      mob.stunned--;
      continue;
    }
    if (mob.frozen > 0) {
      mob.frozen--;
      continue;
    }
    hlMoveMob(mob, player, region, mobs, S);
  }
  // Mob attacks (must happen before player projectile processing so lastAttacker is current)
  for (let mob of mobs) {
    if (mob.dead || mob.dying > 0 || mob.stunned > 0) continue;
    mob.attackDelay--;
    hlMobAttack(mob, player, region, mobs, t, S);
  }
  // Player projectiles land after NPC actions for this tick. Fatal hits remove on T+1.
  for (let mob of mobs) {
    if (mob.dead || mob.dying > 0) continue;
    let rem = [];
    for (let p of mob.incomingProjectiles) {
      p.delay--;
      if (p.delay <= 0) {
        if (mob.pendingRemovalTick === undefined) {
          mob.hp -= p.damage;
          if (mob.hp <= 0) {
            hlMarkMobForProjectileRemoval(mob, t);
          }
        }
      } else rem.push(p);
    }
    mob.incomingProjectiles = rem;
  }
  // Process player incoming projectiles (auto-retaliate)
  {
    let rem = [],
      arrived = [];
    for (let p of player.incomingProjectiles) {
      p.delay--;
      if (p.delay <= 0) {
        arrived.push(p);
      } else rem.push(p);
    }
    if (player.autoRetaliate && arrived.length > 0) {
      if (
        !player.aggro ||
        player.aggro.dead ||
        (player.aggro.dying > 0 && t > player.aggro.dyingStartTick)
      ) {
        // Target lastAttacker (set when mob fires, not when projectile lands)
        let target = player.lastAttacker;
        if (
          target &&
          !target.dead &&
          target.dying === -1 &&
          target.pendingRemovalTick === undefined
        ) {
          player.aggro = target;
          let fd = Math.floor(loadout.atkSpeed / 2) + 1;
          if (player.attackDelay < fd) player.attackDelay = fd;
        }
      }
    }
    player.incomingProjectiles = rem;
  }
  // Player attack
  player.attackDelay--;
  // Player movement — running (2 steps/tick), face tile destination
  if (
    player.aggro &&
    !player.aggro.dead &&
    player.aggro.dying <= 0 &&
    player.aggro.pendingRemovalTick === undefined
  ) {
    let dist = distToMob(player.x, player.y, player.aggro);
    if (
      dist > player.range ||
      !playerHasLOS(region, player.x, player.y, player.aggro, player.range)
    ) {
      let dest = getClosestFaceTile(player.aggro, player.x, player.y, region);
      if (dest) {
        let s1 = osrsWalkStep(player.x, player.y, dest.x, dest.y, region);
        if (s1) {
          player.x = s1.x;
          player.y = s1.y;
          if (player.x !== dest.x || player.y !== dest.y) {
            let s2 = osrsWalkStep(player.x, player.y, dest.x, dest.y, region);
            if (s2) {
              player.x = s2.x;
              player.y = s2.y;
            }
          }
        }
      }
    }
  }
  // Player attack step
  if (
    player.aggro &&
    (player.aggro.dead || (player.aggro.dying > 0 && t > player.aggro.dyingStartTick))
  )
    player.aggro = null;
  if (
    player.aggro &&
    player.attackDelay <= 0 &&
    player.aggro.pendingRemovalTick === undefined &&
    playerHasLOS(region, player.x, player.y, player.aggro, player.range)
  ) {
    let target = player.aggro;
    let delay = playerProjectileDelay(loadout, player.x, player.y, target);
    // Confliction Gauntlets: accuracy depends on last hit/miss
    let accArr = loadout.playerAcc[target.type];
    let acc = player.lastHit ? accArr[0] : accArr[1];
    let hit = S.rng() < acc;
    let dmg = 0;
    if (hit) {
      dmg = Math.floor(S.rng() * (loadout.maxHit + 1));
      player.lastHit = true;
    } else {
      player.lastHit = false;
    }
    target.incomingProjectiles.push({ delay, damage: dmg });
    // Record player attack event for post HP calculation. Damage is rolled now,
    // but mob HP/death is applied when the projectile lands.
    S.attacks.push({
      tick: t,
      isPlayerAttack: true,
      playerDmg: dmg,
      targetMobId: target.id,
      targetMobType: target.type,
      hitTick: t + delay,
    });
    // Blood barrage: 3x3 AOE around target's SW tile
    if (loadout.isBloodBarrage) {
      let aoeOffsets = [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ];
      let hitCount = 1; // primary target already hit
      for (let off of aoeOffsets) {
        if (hitCount >= 9) break;
        let ax = target.x + off[0],
          ay = target.y + off[1];
        for (let m of mobs) {
          if (m.dead || m.dying > 0 || m.pendingRemovalTick !== undefined || m === target) continue;
          // Check if mob's SW tile matches AOE offset position
          if (m.x === ax && m.y === ay) {
            hitCount++;
            let sAccArr = loadout.playerAcc[m.type];
            let sAcc = player.lastHit ? sAccArr[0] : sAccArr[1];
            let sHit = S.rng() < sAcc;
            let sDmg = sHit ? Math.floor(S.rng() * (loadout.maxHit + 1)) : 0;
            let sDelay = playerProjectileDelay(loadout, player.x, player.y, m);
            m.incomingProjectiles.push({ delay: sDelay, damage: sDmg });
            S.attacks.push({
              tick: t,
              isPlayerAttack: true,
              playerDmg: sDmg,
              targetMobId: m.id,
              targetMobType: m.type,
              hitTick: t + sDelay,
            });
            break; // one mob per offset tile
          }
        }
      }
    }
    player.attackDelay = loadout.atkSpeed;
  }
}

function hlMoveMob(mob, player, region, mobs, S) {
  if (mob.hasDig && mob.digTimer > 0) {
    mob.digTimer--;
    if (mob.digTimer === 0) {
      mob.x = mob.digLocation.x;
      mob.y = mob.digLocation.y;
      mob.attackDelay = 6;
      mob.frozen = 2;
      mob.digLocation = null;
      if (player.aggro === mob) player.aggro = null;
    }
    return;
  }
  mob.hadLOS = mob.hasLOS;
  mob.hasLOS = mobHasLOS(region, mob, player);
  if (mob.hasLOS) {
    mob.noLOSTicks = 0;
  } else {
    mob.noLOSTicks++;
  }
  if (mob.hasLOS || mob.frozen > 0) return;
  if (mob.hasDig && !mob.hasLOS && !mob.digTimer) {
    if ((mob.attackDelay <= -38 && S.rng() < 0.1) || mob.attackDelay <= -50) {
      startDig(mob, player, region);
      return;
    }
  }
  let dx = mob.x + Math.sign(player.x - mob.x),
    dy = mob.y + Math.sign(player.y - mob.y);
  if (collisionMath(mob.x, mob.y, mob.size, player.x, player.y, 1)) {
    if (S.rng() < 0.5) {
      dy = mob.y;
      dx = mob.x + (S.rng() < 0.5 ? 1 : -1);
    } else {
      dx = mob.x;
      dy = mob.y + (S.rng() < 0.5 ? 1 : -1);
    }
  } else if (collisionMath(dx, dy, mob.size, player.x, player.y, 1)) {
    dy = mob.y;
  }
  if (mob.attackDelay > mob.atkSpeed) return;
  let xOff = dx - mob.x,
    yOff = mob.y - dy;
  // Match live-game NPC movement: for diagonals, only the destination footprint must be open.
  // Requiring both cardinal components to be open delays large NPC diagonal turns by 1 tick.
  let both = hlCanMove(mob, xOff, yOff, region, mobs);
  let canX = false,
    canY = false;
  if (!both) {
    if (xOff !== 0) canX = hlCanMove(mob, xOff, 0, region, mobs);
    if (!canX && yOff !== 0) canY = hlCanMove(mob, 0, yOff, region, mobs);
  }
  if (both) {
    mob.x = dx;
    mob.y = dy;
  } else if (canX) {
    mob.x = dx;
  } else if (canY) {
    mob.y = dy;
  }
}
function hlCanMove(mob, xOff, yOff, region, mobs) {
  if (xOff === 0 && yOff === 0) return true;
  let s = mob.size,
    dx = xOff,
    dy = -yOff;
  let nx = mob.x + dx,
    ny = mob.y + dy,
    bl = region.blocked,
    isNib = mob.type === "nibbler";
  if (dx === -1)
    for (let i = 0; i < s; i++) {
      if (bl[(nx << 6) | (ny - i)]) return false;
      if (!isNib && collidesWithMobs(nx, ny - i, 1, mobs, mob, true)) return false;
    }
  else if (dx === 1) {
    let rx = nx + s - 1;
    for (let i = 0; i < s; i++) {
      if (bl[(rx << 6) | (ny - i)]) return false;
      if (!isNib && collidesWithMobs(rx, ny - i, 1, mobs, mob, true)) return false;
    }
  }
  if (dy === 1)
    for (let i = 0; i < s; i++) {
      if (bl[((nx + i) << 6) | ny]) return false;
      if (!isNib && collidesWithMobs(nx + i, ny, 1, mobs, mob, true)) return false;
    }
  else if (dy === -1) {
    let by = ny - s + 1;
    for (let i = 0; i < s; i++) {
      if (bl[((nx + i) << 6) | by]) return false;
      if (!isNib && collidesWithMobs(nx + i, by, 1, mobs, mob, true)) return false;
    }
  }
  return true;
}
function hlMobAttack(mob, player, region, mobs, tick, S) {
  if (mob.dead || mob.dying > 0 || mob.stunned > 0) return;
  mob.hadLOS = mob.hasLOS;
  mob.hasLOS = mobHasLOS(region, mob, player);
  if (mob.hasFlicker) {
    mob.flickering = mob.attackDelay === 1 && mob.hasLOS;
    if (!mob.hasLOS || mob.attackDelay > 0 || isUnderMob(mob, player)) return;
    if (S.rng() < 0.1 && S.deadMobs.length > 0) {
      let toRes = S.deadMobs.shift();
      toRes.revivedOnce = true;
      let reviveHp = Math.floor(toRes.maxHp / 2);
      toRes.hp = reviveHp;
      toRes.dead = false;
      toRes.dying = -1;
      toRes.pendingRemovalTick = undefined;
      toRes.corpseRemovalTick = undefined;
      toRes.attackDelay = toRes.atkSpeed + 1;
      toRes.stunned = 0;
      toRes.frozen = 0;
      let loc = findRespawnLocation(toRes.size, region, mobs);
      toRes.x = loc.x;
      toRes.y = loc.y;
      if (!mobs.includes(toRes)) mobs.push(toRes);
      S.attacks.push({ tick, mobId: toRes.id, mobType: toRes.type, isRevive: true, reviveHp });
      mob.attackDelay = mob.atkSpeed * 2;
      return;
    }
    hlFireAttack(mob, player, tick, S);
    mob.attackDelay = mob.atkSpeed;
    return;
  }
  if (mob.isBlob) {
    if (!mob.hasLOS && !mob.blobScanPrayer) return;
    if (mob.hasLOS && (!mob.hadLOS || (!mob.blobScanPrayer && mob.attackDelay <= 0))) {
      mob.blobScanPrayer = "scanned";
      mob.attackDelay = mob.atkSpeed;
      mob._lastScanTick = tick;
      mob.currentStyle = S.rng() < 0.5 ? "magic" : "range";
      S.attacks.push({
        tick,
        mobId: mob.id,
        mobType: "blob",
        style: null,
        isScan: true,
        scanTick: tick,
        accRoll: 0,
        dmgRoll: 0,
      });
      return;
    }
    if (mob.blobScanPrayer && mob.attackDelay <= 0) {
      hlFireAttack(mob, player, tick, S, "blob_attack", mob._lastScanTick || tick - 3);
      mob.blobScanPrayer = null;
      mob.attackDelay = mob.atkSpeed;
    }
    return;
  }
  if (!mob.hasLOS || mob.attackDelay > 0 || isUnderMob(mob, player)) return;
  let actualStyle = mob.style;
  hlFireAttack(mob, player, tick, S, actualStyle);
  mob.attackDelay = mob.atkSpeed;
}
function hlFireAttack(mob, player, tick, S, styleOrBlobFlag, scanTick) {
  let style,
    isBlob = false;
  if (styleOrBlobFlag === "blob_attack") {
    style = null;
    isBlob = true;
  } else {
    style = styleOrBlobFlag || mob.currentStyle || mob.style;
    if (style === "blob") style = mob.currentStyle || "magic";
  }
  // Calculate projectile delay for auto-retaliate timing. Blob damage style remains
  // prayer-resolved post-hoc unless the blob rolls its secondary melee here.
  let projectileStyle = isBlob ? mob.currentStyle || "magic" : style;
  if (canUseSecondaryMelee(mob, player) && S.rng() < 0.5) {
    projectileStyle = "melee";
    style = "melee";
    isBlob = false;
  }
  let delay = monsterProjectileDelay(mob, projectileStyle, player);
  let edgeDist = distToMob(player.x, player.y, mob);
  player.incomingProjectiles.push({
    delay: delay + 1,
    damage: 0,
    mobType: mob.type,
    mobId: mob.id,
    style: projectileStyle,
  });
  // last_attacker is set when mob fires, not when projectile lands
  setPlayerLastAttacker(player, mob);
  // Record attack event for prayer analysis
  S.attacks.push({
    tick,
    mobId: mob.id,
    mobType: mob.type,
    style: isBlob ? null : style,
    isScan: false,
    scanTick: isBlob ? scanTick || tick - 3 : -1,
    accRoll: S.rng(),
    dmgRoll: S.rng(),
    distAtFire: edgeDist,
    hitTick: tick + delay,
  });
}
function hlSpawnBlobletsFromBlob(blob, tick, S) {
  let mobs = S.mobs;
  let bm = hlCreateMob("blobletMage", blob.x + 2, blob.y - 2, S.idCounter++);
  bm.stunned = 0;
  bm.frozen = 1;
  bm.attackDelay = 4;
  bm.parentBlobId = blob.id;
  mobs.push(bm);
  let br = hlCreateMob("blobletRange", blob.x + 1, blob.y - 1, S.idCounter++);
  br.stunned = 0;
  br.frozen = 1;
  br.attackDelay = 4;
  br.parentBlobId = blob.id;
  mobs.push(br);
  let bx = hlCreateMob("blobletMelee", blob.x, blob.y, S.idCounter++);
  bx.stunned = 0;
  bx.frozen = 1;
  bx.attackDelay = 4;
  bx.parentBlobId = blob.id;
  mobs.push(bx);
  // Track bloblet HP for post-hoc recoil tracking + mob ID map
  S.mobInitHP[bm.id] = { hp: bm.hp, type: bm.type };
  S.mobInitHP[br.id] = { hp: br.hp, type: br.type };
  S.mobInitHP[bx.id] = { hp: bx.hp, type: bx.type };
  S.mobMap.set(bm.id, bm);
  S.mobMap.set(br.id, br);
  S.mobMap.set(bx.id, bx);
}
function hlProcessDelayedBlobletSpawns(S, tick) {
  let pending = S.delayedBlobletSpawns || [];
  if (pending.length === 0) return;
  let keep = [];
  for (let item of pending) {
    if (item.tick <= tick) hlSpawnBlobletsFromBlob(item.blob, tick, S);
    else keep.push(item);
  }
  S.delayedBlobletSpawns = keep;
}
function hlOnDeath(mob, player, region, mobs, tick, S) {
  if (mob.isBlob) {
    if (!S.delayedBlobletSpawns) S.delayedBlobletSpawns = [];
    S.delayedBlobletSpawns.push({ tick: tick + 1, blob: mob });
  }
  if (!mob.type.startsWith("bloblet") && mob.type !== "nibbler" && !mob.revivedOnce)
    S.deadMobs.push(mob);
  if (player.aggro === mob) player.aggro = null;
  if (player.lastAttacker === mob) player.lastAttacker = null;
}

function hlRequiresFullClear(S) {
  return (S.initialEnemyCount || 0) <= 3;
}
function hlCleanupStopReason(S) {
  if (hlRequiresFullClear(S)) return null;
  if ((S.delayedBlobletSpawns || []).length > 0) return null;
  let active = S.mobs.filter((m) => !m.dead && m.dying <= 0);
  if (active.length === 0) return null;
  if (active.every((m) => m.type.startsWith("bloblet"))) return "bloblets";
  if ((S.initialEnemyCount || 0) >= 4 && active.length === 1) return "last-enemy";
  return null;
}
function hlTrappedResultStatus(S, trappedBig) {
  return !hlRequiresFullClear(S) && checkTrappedValid(trappedBig) ? "trapped" : "invalid";
}
function hlTimeoutResultStatus(S) {
  return hlRequiresFullClear(S) ? "invalid" : "timeout";
}

function hlRunSim(spawnCode, playerPos, pillarConfig, loadout, maxTicks, cachedRegion, seed) {
  let S = hlInitState(spawnCode, playerPos, pillarConfig, loadout, cachedRegion, seed);
  if (!S) return null;
  for (let i = 0; i < maxTicks; i++) {
    hlTick(S);
    // Check wave complete — count dead mobs only when something changed
    let deadCount = 0;
    for (let j = 0; j < S.mobs.length; j++) if (S.mobs[j].dead) deadCount++;
    if (deadCount === S.mobs.length)
      return {
        attacks: S.attacks,
        completedTick: S.tick,
        mobs: S.mobs,
        status: "complete",
        mobInitHP: S.mobInitHP,
      };
    let cleanupReason = hlCleanupStopReason(S);
    if (cleanupReason)
      return {
        attacks: S.attacks,
        completedTick: S.tick,
        mobs: S.mobs,
        status: "cleanup",
        cleanupReason,
        mobInitHP: S.mobInitHP,
      };
    // Check trapped
    if (!S.player.aggro) {
      let allNoLOS = true,
        trappedBig = [],
        activeCount = 0;
      for (let j = 0; j < S.mobs.length; j++) {
        let m = S.mobs[j];
        if (m.dead || m.dying > 0 || m.hp <= 0) continue;
        activeCount++;
        if (m.noLOSTicks < 20) {
          allNoLOS = false;
          break;
        }
        if (m.type !== "nibbler" && !m.type.startsWith("bloblet")) trappedBig.push(m);
      }
      if (allNoLOS && activeCount > 0 && deadCount < S.mobs.length) {
        return {
          attacks: S.attacks,
          completedTick: S.tick,
          mobs: S.mobs,
          status: hlTrappedResultStatus(S, trappedBig),
          mobInitHP: S.mobInitHP,
        };
      }
    }
  }
  return {
    attacks: S.attacks,
    completedTick: maxTicks,
    mobs: S.mobs,
    status: hlTimeoutResultStatus(S),
    mobInitHP: S.mobInitHP,
  };
}

function checkTrappedValid(trapped) {
  if (trapped.length === 0) return true;
  if (trapped.length > 2) return false;
  if (trapped.some((m) => m.type === "mager")) return false;
  if (trapped.length === 1) return true;
  // 2 trapped: allowed combos: 2 blobs, 2 bats, bat+ranger
  let types = trapped.map((m) => m.type).sort();
  let key = types.join("+");
  return key === "blob+blob" || key === "bat+bat" || key === "bat+ranger";
}

// =====================================================
// PHASE 2: TILE EXCLUSION
// =====================================================
function checkTileExcluded(x, y, mobs, region) {
  // Physical blockers: pillar tiles cannot be selected.
  for (let p of region.pillars) {
    if (collisionMath(p.x, p.y, p.size, x, y, 1)) return true;
  }
  // Directly under an enemy footprint only. Adjacent/melee-range tiles are allowed.
  for (let m of mobs) {
    if (collisionMath(m.x, m.y, m.size, x, y, 1)) return true;
  }
  // Initial spawn attack-range overlap exclusions only:
  // mager+ranger, ranger+meleer, or mager+meleer.
  let fakeTarget = { x, y, size: 1 };
  let types = { mager: false, ranger: false, meleer: false };
  for (let m of mobs) {
    if (m.type === "mager" || m.type === "ranger" || m.type === "meleer") {
      let has =
        m.range === 1
          ? isWithinMeleeRange(m, fakeTarget)
          : hasLineOfSight(region, m.x, m.y, x, y, m.size, m.range, true);
      if (has) types[m.type] = true;
    }
  }
  if (types.mager && types.ranger) return true;
  if (types.ranger && types.meleer) return true;
  if (types.mager && types.meleer) return true;
  return false;
}

// =====================================================
// PHASE 2: PRAYER OPTIMIZER
// =====================================================
function optimizePrayer(allSimResults, spawnCode, pillarConfig, loadout) {
  // Determine which big3 types exist
  let parsed = parseSpawnCode(spawnCode);
  let mobTypes = new Set();
  for (let s of parsed.spawns) if (s.type !== "nothing") mobTypes.add(s.type);
  let hasMager = mobTypes.has("mager"),
    hasRanger = mobTypes.has("ranger"),
    hasMeleer = mobTypes.has("meleer");

  // Find big3 attack slots from first sim's data
  let slots = [null, null, null, null]; // slots[i] = prayer type or null (unknown)
  // Look at first attacks from big3 across all sims to find consistent slot
  let slotVotes = { mager: {}, ranger: {}, meleer: {} };
  for (let result of allSimResults) {
    for (let atk of result.attacks) {
      if (atk.isScan) continue;
      if (atk.mobType === "mager" && hasMager && !slotVotes.mager.found) {
        slotVotes.mager[atk.tick % 4] = (slotVotes.mager[atk.tick % 4] || 0) + 1;
        slotVotes.mager.found = true;
      }
      if (atk.mobType === "ranger" && hasRanger && !slotVotes.ranger.found) {
        slotVotes.ranger[atk.tick % 4] = (slotVotes.ranger[atk.tick % 4] || 0) + 1;
        slotVotes.ranger.found = true;
      }
      if (atk.mobType === "meleer" && hasMeleer && !slotVotes.meleer.found) {
        slotVotes.meleer[atk.tick % 4] = (slotVotes.meleer[atk.tick % 4] || 0) + 1;
        slotVotes.meleer.found = true;
      }
    }
    // Reset found for next sim
    delete slotVotes.mager.found;
    delete slotVotes.ranger.found;
    delete slotVotes.meleer.found;
  }
  // Assign slots for big3
  function getBestSlot(votes) {
    let best = -1,
      bestCount = 0;
    for (let s = 0; s < 4; s++) {
      let c = votes[s] || 0;
      if (c > bestCount) {
        bestCount = c;
        best = s;
      }
    }
    return best;
  }
  if (hasMager) {
    let s = getBestSlot(slotVotes.mager);
    if (s >= 0) slots[s] = "mage";
  }
  if (hasRanger) {
    let s = getBestSlot(slotVotes.ranger);
    if (s >= 0 && !slots[s]) slots[s] = "range";
  }
  if (hasMeleer) {
    let s = getBestSlot(slotVotes.meleer);
    if (s >= 0 && !slots[s]) slots[s] = "melee";
  }

  // Generate all possible sequences for unknown slots (only mage/range)
  let unknowns = [];
  for (let i = 0; i < 4; i++) if (!slots[i]) unknowns.push(i);

  let bestDmg = Infinity,
    candidates = [];
  let combos = 1 << unknowns.length; // 2^n combinations of mage/range
  function averageDamage(sequence) {
    let total = 0;
    for (let result of allSimResults)
      total += calcSimDamage(result.attacks, sequence, loadout, result.mobInitHP).damage;
    return total / allSimResults.length;
  }

  for (let c = 0; c < combos; c++) {
    let seq = [...slots];
    for (let i = 0; i < unknowns.length; i++) {
      seq[unknowns[i]] = (c >> i) & 1 ? "range" : "mage";
    }
    let avgDmg = averageDamage(seq);
    candidates.push({ sequence: seq, avgDamage: avgDmg });
    if (avgDmg < bestDmg) bestDmg = avgDmg;
  }
  let epsilon = 1e-9;
  let optimal = candidates.filter(
    (candidate) => Math.abs(candidate.avgDamage - bestDmg) <= epsilon,
  );
  let firstPass = [...slots];
  for (let slot of unknowns) {
    let prayers = new Set(optimal.map((candidate) => candidate.sequence[slot]));
    if (prayers.size === 1) firstPass[slot] = optimal[0].sequence[slot];
  }
  let priorities = [
    [1, 2, 3],
    [0, 2, 3],
    [3, 1, 0],
    [2, 1, 0],
  ];
  let fallback = firstPass.find(Boolean) || (hasRanger ? "range" : hasMeleer ? "melee" : "mage");
  let filled = firstPass.map((prayer, slot) => {
    if (prayer) return prayer;
    for (let backup of priorities[slot]) if (firstPass[backup]) return firstPass[backup];
    return fallback;
  });
  let filledDmg = averageDamage(filled);
  if (filledDmg > bestDmg + epsilon) {
    // Correlated blob scan/attack slots can make independently blank slots unsafe.
    // In that rare case, keep an optimal sequence closest to the preferred fill.
    let filledCandidate = optimal.reduce((best, candidate) => {
      let matches = candidate.sequence.reduce(
        (count, prayer, slot) => count + (prayer === filled[slot] ? 1 : 0),
        0,
      );
      return !best || matches > best.matches ? { candidate, matches } : best;
    }, null).candidate;
    filled = filledCandidate.sequence;
    filledDmg = filledCandidate.avgDamage;
  }
  return { sequence: filled, avgDamage: filledDmg };
}

function loadoutHasRingRecoil(loadout) {
  return !!loadout.hasRecoil && loadout.hasRingRecoil !== false;
}
function loadoutHasEchoBoots(loadout) {
  return !!loadout.hasRecoil && loadout.hasEchoBoots !== false;
}
function loadoutHasBloodSceptre(loadout) {
  return !!(loadout && loadout.isBloodBarrage && loadout.hasBloodSceptre);
}
function loadoutBloodHealRate(loadout) {
  return loadoutHasBloodSceptre(loadout) ? 0.275 : 0.25;
}
function loadoutBloodMaxHp(loadout) {
  return loadoutHasBloodSceptre(loadout) ? 108 : 99;
}
function loadoutStartingHp(loadout) {
  let hp = Number(loadout?.startingHp ?? 99);
  if (!Number.isFinite(hp)) hp = 99;
  return Math.max(1, Math.min(115, Math.round(hp)));
}

function calcSimDamage(attacks, prayerSeq, loadout, mobInitHP) {
  let startHp = loadoutStartingHp(loadout),
    hp = startHp,
    maxHp = Math.max(startHp, loadoutBloodMaxHp(loadout)),
    minHp = startHp,
    died = false;
  let hasRecoil = loadout.hasRecoil && mobInitHP;
  let hasRingRecoil = loadoutHasRingRecoil(loadout),
    hasEchoBoots = loadoutHasEchoBoots(loadout);
  // Recoil state: track mob HP, echo boots cooldown, pending recoil queue.
  // Player damage is rolled on attack initiation, but applied to mob HP on hitTick.
  let mobHP = {},
    deadMobs = new Set(),
    echoBootsCooldown = 0,
    pendingRecoil = [],
    pendingPlayerHits = [],
    pendingMobRemovals = [];
  if (hasRecoil) {
    for (let id in mobInitHP) mobHP[id] = mobInitHP[id].hp;
  }
  function applyPendingDeaths(currentTick) {
    if (!hasRecoil) return;
    for (let i = pendingMobRemovals.length - 1; i >= 0; i--) {
      let r = pendingMobRemovals[i];
      if (r.tick <= currentTick) {
        deadMobs.add(r.mobId);
        pendingMobRemovals.splice(i, 1);
      }
    }
  }
  function scheduleMobRemoval(mobId, hitTick) {
    if (!hasRecoil) return;
    if (deadMobs.has(mobId)) return;
    let removeTick = hitTick + 1;
    let existing = pendingMobRemovals.find((r) => r.mobId === mobId);
    if (existing) {
      existing.tick = Math.min(existing.tick, removeTick);
    } else pendingMobRemovals.push({ tick: removeTick, mobId });
  }
  function applyPendingPlayerHits(currentTick) {
    if (!hasRecoil || pendingPlayerHits.length === 0) return;
    for (let i = pendingPlayerHits.length - 1; i >= 0; i--) {
      let h = pendingPlayerHits[i];
      if (h.tick <= currentTick) {
        if (!deadMobs.has(h.mobId) && mobHP[h.mobId] !== undefined && mobHP[h.mobId] > 0) {
          mobHP[h.mobId] -= h.damage;
          if (mobHP[h.mobId] <= 0) scheduleMobRemoval(h.mobId, h.tick);
        }
        pendingPlayerHits.splice(i, 1);
      }
    }
  }
  // Process all events in tick order
  for (let atk of attacks) {
    applyPendingPlayerHits(atk.tick);
    applyPendingDeaths(atk.tick);
    // Apply pending recoil for this tick or earlier
    if (hasRecoil && pendingRecoil.length > 0) {
      for (let i = pendingRecoil.length - 1; i >= 0; i--) {
        let r = pendingRecoil[i];
        if (r.tick <= atk.tick) {
          if (!deadMobs.has(r.mobId) && mobHP[r.mobId] !== undefined && mobHP[r.mobId] > 0) {
            mobHP[r.mobId] -= r.damage;
            if (mobHP[r.mobId] <= 0) scheduleMobRemoval(r.mobId, r.tick);
          }
          pendingRecoil.splice(i, 1);
        }
      }
      applyPendingDeaths(atk.tick);
    }
    // Player attack: blood barrage heals 25% of damage dealt at cast time, but
    // mob HP/death is delayed until the projectile's hitTick.
    if (atk.isPlayerAttack) {
      if (loadout.isBloodBarrage && atk.playerDmg > 0 && hp < maxHp) {
        hp = Math.min(maxHp, hp + Math.floor(atk.playerDmg * loadoutBloodHealRate(loadout)));
      }
      if (hasRecoil && atk.targetMobId !== undefined && mobHP[atk.targetMobId] !== undefined) {
        pendingPlayerHits.push({
          tick: atk.hitTick !== undefined ? atk.hitTick : atk.tick,
          mobId: atk.targetMobId,
          damage: atk.playerDmg,
        });
      }
      continue;
    }
    if (atk.isRevive) {
      if (hasRecoil) {
        deadMobs.delete(atk.mobId);
        mobHP[atk.mobId] =
          atk.reviveHp !== undefined
            ? atk.reviveHp
            : mobInitHP[atk.mobId]
              ? Math.floor(mobInitHP[atk.mobId].hp / 2)
              : 0;
        pendingMobRemovals = pendingMobRemovals.filter((r) => r.mobId !== atk.mobId);
        pendingPlayerHits = pendingPlayerHits.filter((h) => h.mobId !== atk.mobId);
        pendingRecoil = pendingRecoil.filter((r) => r.mobId !== atk.mobId);
      }
      continue;
    }
    if (atk.isScan) continue;
    // Skip attacks from mobs that had already disappeared before this tick.
    if (hasRecoil && deadMobs.has(atk.mobId)) continue;
    let prayOnTick = prayerSeq[atk.tick % 4];
    let atkStyle = atk.style;
    // Blob: determine style from prayer on scan tick
    if (atkStyle === null) {
      let prayOnScan = prayerSeq[atk.scanTick % 4];
      atkStyle = prayOnScan === "mage" ? "range" : "magic";
    }
    // Check if prayer blocks
    let blocked = false;
    if (atkStyle === "magic" && prayOnTick === "mage") blocked = true;
    if (atkStyle === "range" && prayOnTick === "range") blocked = true;
    if (atkStyle === "melee" && prayOnTick === "melee") blocked = true;
    if (blocked) continue;
    // Calculate damage
    let atkStats = resolveMonsterAttackStats(loadout, atk.mobType, atkStyle);
    if (!atkStats) continue;
    let acc = atkStats.acc,
      maxH = atkStats.max;
    if (atk.accRoll < acc) {
      let dmg = Math.floor(atk.dmgRoll * (maxH + 1));
      if (dmg > 0) {
        hp -= dmg;
        if (hp < minHp) minHp = hp;
        // Schedule recoil damage (Blood Barrage loadout only)
        if (hasRecoil) {
          let recoilTick = (atk.hitTick !== undefined ? atk.hitTick : atk.tick + 1) + 1;
          // Ring of Suffering: floor(dmg*0.1+1) recoil, always activates
          if (hasRingRecoil) {
            let ringDmg = Math.floor(dmg * 0.1 + 1);
            pendingRecoil.push({ tick: recoilTick, mobId: atk.mobId, damage: ringDmg });
          }
          // Echo Boots: 1 fixed damage if attacker within 1 tile and off cooldown
          let dist = atk.distAtFire !== undefined ? atk.distAtFire : 99;
          if (hasEchoBoots && dist <= 1 && recoilTick >= echoBootsCooldown) {
            pendingRecoil.push({ tick: recoilTick, mobId: atk.mobId, damage: 1 });
            echoBootsCooldown = recoilTick + 4;
          }
        }
      }
      if (hp <= 0) {
        died = true;
        break;
      }
    }
  }
  // Apply remaining pending player damage/recoil for mob tracking completeness.
  if (hasRecoil) {
    let finalTick = Infinity;
    applyPendingPlayerHits(finalTick);
    for (let r of pendingRecoil) {
      if (!deadMobs.has(r.mobId) && mobHP[r.mobId] !== undefined && mobHP[r.mobId] > 0) {
        mobHP[r.mobId] -= r.damage;
        if (mobHP[r.mobId] <= 0) scheduleMobRemoval(r.mobId, r.tick);
      }
    }
  }
  return {
    damage: died
      ? startHp
      : loadout.isBloodBarrage
        ? Math.max(0, startHp - minHp)
        : Math.max(0, startHp - hp),
    died: died,
  };
}
// ===== Phase-1-shared helpers (also called from hl* in sim-core) =====
function canSetLastAttacker(player, mob) {
  let a = player.aggro;
  return !a || a.dead || a === mob;
}
function setPlayerLastAttacker(player, mob) {
  // While the player is already engaged, other NPCs do not steal last_attacker.
  if (canSetLastAttacker(player, mob)) player.lastAttacker = mob;
}
function startDig(mob, player, region) {
  mob.frozen = 6;
  mob.digTimer = 6;
  let s = mob.size;
  if (!collidesWithEntities(player.x - s + 1, player.y + s - 1, s, region.entities))
    mob.digLocation = { x: player.x - s + 1, y: player.y + s - 1 };
  else if (!collidesWithEntities(player.x, player.y, s, region.entities))
    mob.digLocation = { x: player.x, y: player.y };
  else if (!collidesWithEntities(player.x - s + 1, player.y, s, region.entities))
    mob.digLocation = { x: player.x - s + 1, y: player.y };
  else if (!collidesWithEntities(player.x, player.y + s - 1, s, region.entities))
    mob.digLocation = { x: player.x, y: player.y + s - 1 };
  else mob.digLocation = { x: player.x - 1, y: player.y + 1 };
}
function isUnderMob(mob, player) {
  return collisionMath(mob.x, mob.y, mob.size, player.x, player.y, 1);
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
