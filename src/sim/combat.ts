// =====================================================
// COMBAT — attack delays, line-of-sight, targeting, and damage calculations
// Depends on sim/constants.js and sim/pathfinding.js
// =====================================================
import { MONSTER_PROJECTILE_HIT_TICKS, DEATH_ANIM_TICKS } from "./constants.js";
import {
  chebyshev,
  collisionMath,
  closestTileTo,
  distToMob,
  isWithinMeleeRange,
  canUseSecondaryMelee,
} from "./pathfinding.js";
import { isUnderMob, findRespawnLocation, hlCreateMob } from "./main.js";
import type {
  AttackEvent,
  CombatStyle,
  HeadlessSim,
  Loadout,
  Mob,
  MonsterAtkStats,
  Player,
  Point,
  PrayerSequence,
  Region,
} from "../types.js";

export function rangedDelay(dist: number): number {
  if (dist <= 4) return 2;
  if (dist <= 8) return 3;
  if (dist <= 11) return 4;
  return 5;
}

export function magicDelay(dist: number): number {
  if (dist <= 6) return 2;
  if (dist <= 10) return 3;
  if (dist <= 14) return 4;
  return 5;
}

export function magerDelay(dist: number): number {
  if (dist <= 5) return 2;
  if (dist <= 9) return 3;
  if (dist <= 13) return 4;
  return 5;
}

export function delayFromHitTickList(list: number[], dist: number): number {
  let d = Math.max(1, Math.floor(dist));
  let hitTick = list[Math.min(d, list.length) - 1];
  return hitTick - 1;
}

export function monsterProjectileOrigin(mob: Mob): Point {
  // mob.x/mob.y is the SW tile of the NPC footprint.
  if (mob.type === "mager") return { x: mob.x + 2, y: mob.y - 2 }; // NE tile of the central 2x2
  if (mob.type === "bat") return { x: mob.x, y: mob.y }; // SW tile of the 2x2
  if (mob.type === "ranger" || mob.type === "blob") return { x: mob.x + 1, y: mob.y - 1 }; // center tile of 3x3
  return { x: mob.x, y: mob.y };
}

export function monsterProjectileDistance(px: number, py: number, mob: Mob): number {
  let o = monsterProjectileOrigin(mob);
  return chebyshev(px, py, o.x, o.y);
}

export function monsterProjectileDelay(
  mob: Mob,
  style: CombatStyle | "blob" | null,
  player: { x: number; y: number },
): number {
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
export function playerBlowpipeDelay(): number {
  return 2;
}

export function playerAyakDelay(dist: number): number {
  if (dist <= 2) return 2;
  return 3;
}

export function playerBarrageDelay(dist: number): number {
  if (dist <= 1) return 2;
  if (dist <= 3) return 3;
  if (dist <= 7) return 4;
  return 5;
}

// Blood barrage calculates distance to mob's SW tile directly
export function playerProjectileDelay(
  loadout: Loadout,
  px: number,
  py: number,
  target: { x: number; y: number; size: number },
): number {
  if (loadout.atkSpeed === 2) return playerBlowpipeDelay(); // blowpipe
  if (loadout.isBloodBarrage) {
    let swDist = chebyshev(px, py, target.x, target.y);
    return playerBarrageDelay(swDist);
  }
  let dist = distToMob(px, py, target);
  return playerAyakDelay(dist); // mage tank
}

export function hasLineOfSight(
  region: Region,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  s: number,
  r: number,
  isNPC: boolean,
): boolean {
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

export function raycast(region: Region, x1: number, y1: number, x2: number, y2: number): boolean {
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

export function mobHasLOS(region: Region, mob: Mob, target: { x: number; y: number }): boolean {
  return mob.range === 1
    ? isWithinMeleeRange(mob, target)
    : hasLineOfSight(region, mob.x, mob.y, target.x, target.y, mob.size, mob.range, true);
}

export function playerHasLOS(
  region: Region,
  px: number,
  py: number,
  mob: { x: number; y: number; size: number },
  range: number,
): boolean {
  let cp = closestTileTo(mob, px, py);
  return hasLineOfSight(region, px, py, cp.x, cp.y, 1, range, false);
}

export function resolveMonsterAttackStats(
  loadout: Loadout,
  mobType: string,
  style: CombatStyle | "blob" | null,
): MonsterAtkStats | null {
  let monAtk = loadout.monsterAtk[mobType as keyof Loadout["monsterAtk"]];
  if (!monAtk) return null;
  if (style === "melee" && monAtk.melee) return monAtk.melee;
  if (mobType === "blob") {
    if (style === "magic") return monAtk.mage;
    if (style === "range") return monAtk.range;
    return monAtk.range;
  }
  return monAtk as MonsterAtkStats;
}

// ===== LOADOUT COMBAT HELPERS =====
export function loadoutHasRingRecoil(loadout: Loadout): boolean {
  return !!loadout.hasRecoil && loadout.hasRingRecoil !== false;
}

export function loadoutHasEchoBoots(loadout: Loadout): boolean {
  return !!loadout.hasRecoil && loadout.hasEchoBoots !== false;
}

export function loadoutHasBloodSceptre(loadout: Loadout): boolean {
  return !!(loadout && loadout.isBloodBarrage && loadout.hasBloodSceptre);
}

export function loadoutBloodHealRate(loadout: Loadout): number {
  return loadoutHasBloodSceptre(loadout) ? 0.275 : 0.25;
}

export function loadoutBloodMaxHp(loadout: Loadout): number {
  return loadoutHasBloodSceptre(loadout) ? 108 : 99;
}

export function loadoutStartingHp(loadout: Loadout): number {
  let hp = Number(loadout?.startingHp ?? 99);
  if (!Number.isFinite(hp)) hp = 99;
  return Math.max(1, Math.min(115, Math.round(hp)));
}

// ===== DAMAGE CALCULATION =====
export function calcSimDamage(
  attacks: AttackEvent[],
  prayerSeq: PrayerSequence,
  loadout: Loadout,
  mobInitHP: Record<number, { hp: number; type: string }>,
): { damage: number; died: boolean } {
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
  let mobHP: Record<number, number> = {},
    deadMobs = new Set<number>(),
    echoBootsCooldown = 0,
    pendingRecoil: { tick: number; mobId: number; damage: number }[] = [],
    pendingPlayerHits: { tick: number; mobId: number; damage: number }[] = [],
    pendingMobRemovals: { tick: number; mobId: number }[] = [];
  if (hasRecoil) {
    for (let id in mobInitHP) mobHP[id] = mobInitHP[id].hp;
  }
  function applyPendingDeaths(currentTick: number) {
    if (!hasRecoil) return;
    for (let i = pendingMobRemovals.length - 1; i >= 0; i--) {
      let r = pendingMobRemovals[i];
      if (r.tick <= currentTick) {
        deadMobs.add(r.mobId);
        pendingMobRemovals.splice(i, 1);
      }
    }
  }
  function scheduleMobRemoval(mobId: number, hitTick: number) {
    if (!hasRecoil) return;
    if (deadMobs.has(mobId)) return;
    let removeTick = hitTick + 1;
    let existing = pendingMobRemovals.find((r) => r.mobId === mobId);
    if (existing) {
      existing.tick = Math.min(existing.tick, removeTick);
    } else pendingMobRemovals.push({ tick: removeTick, mobId });
  }
  function applyPendingPlayerHits(currentTick: number) {
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
      if (loadout.isBloodBarrage && atk.playerDmg && atk.playerDmg > 0 && hp < maxHp) {
        hp = Math.min(maxHp, hp + Math.floor(atk.playerDmg * loadoutBloodHealRate(loadout)));
      }
      if (hasRecoil && atk.targetMobId !== undefined && mobHP[atk.targetMobId] !== undefined) {
        pendingPlayerHits.push({
          tick: atk.hitTick !== undefined ? atk.hitTick : atk.tick,
          mobId: atk.targetMobId,
          damage: atk.playerDmg || 0,
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
    let atkStyle: CombatStyle | "blob" | null = atk.style;
    // Blob: determine style from prayer on scan tick
    if (atkStyle === null) {
      let prayOnScan = prayerSeq[(atk.scanTick as number) % 4];
      atkStyle = prayOnScan === "mage" ? "range" : "magic";
    }
    // Check if prayer blocks
    let blocked = false;
    if (atkStyle === "magic" && prayOnTick === "mage") blocked = true;
    if (atkStyle === "range" && prayOnTick === "range") blocked = true;
    if (atkStyle === "melee" && prayOnTick === "melee") blocked = true;
    if (blocked) continue;
    // Calculate damage
    let atkStats = resolveMonsterAttackStats(loadout, atk.mobType || "", atkStyle);
    if (!atkStats) continue;
    let acc = atkStats.acc,
      maxH = atkStats.max;
    if (atk.accRoll !== undefined && atk.accRoll < acc) {
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

// ===== TARGETING / AGGRO HELPERS =====
export function canSetLastAttacker(player: Player, mob: Mob): boolean {
  let a = player.aggro;
  return !a || a.dead || a === mob;
}

export function setPlayerLastAttacker(player: Player, mob: Mob): void {
  // While the player is already engaged, other NPCs do not steal last_attacker.
  if (canSetLastAttacker(player, mob)) player.lastAttacker = mob;
}

// ===== MOB COMBAT ACTIONS =====
export function hlMarkMobForProjectileRemoval(mob: Mob, tick: number): void {
  if (mob.dead) return;
  mob.hp = 0;
  if (mob.pendingRemovalTick === undefined || mob.pendingRemovalTick > tick + 1) {
    mob.pendingRemovalTick = tick + 1;
    mob.dyingStartTick = tick;
  }
}

export function hlProcessCorpseExpiry(S: HeadlessSim, tick: number): void {
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

export function hlProcessPendingMobDeaths(S: HeadlessSim, tick: number): void {
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

export function hlMobAttack(
  mob: Mob,
  player: Player,
  region: Region,
  mobs: Mob[],
  tick: number,
  S: HeadlessSim,
): void {
  if (mob.dead || mob.dying > 0 || mob.stunned > 0) return;
  mob.hadLOS = mob.hasLOS;
  mob.hasLOS = mobHasLOS(region, mob, player);
  if (mob.hasFlicker) {
    mob.flickering = mob.attackDelay === 1 && mob.hasLOS;
    if (!mob.hasLOS || mob.attackDelay > 0 || isUnderMob(mob, player)) return;
    if (S.rng() < 0.1 && S.deadMobs.length > 0) {
      let toRes = S.deadMobs.shift();
      if (!toRes) return;
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
  let actualStyle: CombatStyle = mob.style === "blob" ? "magic" : mob.style;
  hlFireAttack(mob, player, tick, S, actualStyle);
  mob.attackDelay = mob.atkSpeed;
}

export function hlFireAttack(
  mob: Mob,
  player: Player,
  tick: number,
  S: HeadlessSim,
  styleOrBlobFlag?: CombatStyle | "blob_attack",
  scanTick?: number,
): void {
  let style: CombatStyle | null = null,
    isBlob = false;
  if (styleOrBlobFlag === "blob_attack") {
    isBlob = true;
  } else {
    let rawStyle: CombatStyle | "blob" = styleOrBlobFlag || mob.currentStyle || mob.style;
    style = rawStyle === "blob" ? mob.currentStyle || "magic" : rawStyle;
  }
  // Calculate projectile delay for auto-retaliate timing. Blob damage style remains
  // prayer-resolved post-hoc unless the blob rolls its secondary melee here.
  let projectileStyle: CombatStyle = isBlob ? mob.currentStyle || "magic" : style || "magic";
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

export function hlSpawnBlobletsFromBlob(blob: Mob, tick: number, S: HeadlessSim): void {
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

export function hlProcessDelayedBlobletSpawns(S: HeadlessSim, tick: number): void {
  let pending = S.delayedBlobletSpawns || [];
  if (pending.length === 0) return;
  let keep: { tick: number; blob: Mob }[] = [];
  for (let item of pending) {
    if (item.tick <= tick) hlSpawnBlobletsFromBlob(item.blob, tick, S);
    else keep.push(item);
  }
  S.delayedBlobletSpawns = keep;
}

export function hlOnDeath(
  mob: Mob,
  player: Player,
  region: Region,
  mobs: Mob[],
  tick: number,
  S: HeadlessSim,
): void {
  if (mob.isBlob) {
    if (!S.delayedBlobletSpawns) S.delayedBlobletSpawns = [];
    S.delayedBlobletSpawns.push({ tick: tick + 1, blob: mob });
  }
  if (!mob.type.startsWith("bloblet") && mob.type !== "nibbler" && !mob.revivedOnce)
    S.deadMobs.push(mob);
  if (player.aggro === mob) player.aggro = null;
  if (player.lastAttacker === mob) player.lastAttacker = null;
}
