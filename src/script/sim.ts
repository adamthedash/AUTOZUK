import { state } from "./state.js";
import { MOB_TYPE_PRIORITY } from "./constants.js";
import { MOB_DEFS, DEATH_ANIM_TICKS } from "../sim/constants.js";
import type { Mob, MobType, Player, Point, Region, Phase1Sim, CombatStyle } from "../types.js";
import {
  collisionMath,
  collidesWithMobs,
  distToMob,
  getClosestFaceTile,
  osrsWalkStep,
  canUseSecondaryMelee,
} from "../sim/pathfinding.js";
import {
  mobHasLOS,
  playerHasLOS,
  playerProjectileDelay,
  monsterProjectileDelay,
  resolveMonsterAttackStats,
  loadoutHasRingRecoil,
  loadoutHasEchoBoots,
  loadoutStartingHp,
  loadoutBloodMaxHp,
  loadoutBloodHealRate,
  setPlayerLastAttacker,
} from "../sim/combat.js";
import {
  createRegion,
  parseSpawnCode,
  spawnNibblers,
  startDig,
  isUnderMob,
  findRespawnLocation,
} from "../sim/main.js";
import {
  updateUI,
  rebuildTickGridHeader,
  setStatus,
  showSpawnCodeError,
  ensureTickGridView,
  closePracticeMode,
  getEffectivePrayerForTick,
  updatePreview,
  practiceState,
} from "./ui.js";
import { render } from "./render.js";

state.sim = null;
state.pillars = { S: true, W: true, N: true };
state.playerPlacement = null;
state.playing = false;
state.playInterval = null;
state.tickEvents = [];
state.mobIdCounter = 0;
state.tickHits = {};
state.gridMobColumns = [];
state.previewMobs = [];
state.tickGridUserScrolled = false;
state.eventListUserScrolled = false;

type SpawnParseResult = ReturnType<typeof parseSpawnCode>;

// ===== PHASE 1: SIM ENGINE =====
export function createMob(type: MobType, x: number, y: number, id?: number): Mob {
  const d = MOB_DEFS[type];
  return {
    id: id ?? state.mobIdCounter++,
    type,
    letter: d.letter,
    x,
    y,
    size: d.size,
    hp: d.hp,
    maxHp: d.hp,
    atkSpeed: d.atkSpeed,
    range: d.range,
    style: d.style,
    color: d.color,
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

export function createPlayer(x: number, y: number): Player {
  const loadout = state.currentLoadout!;
  const startHp = loadoutStartingHp(loadout);
  const maxHp = Math.max(startHp, loadoutBloodMaxHp(loadout));
  return {
    x,
    y,
    size: 1,
    hp: startHp,
    maxHp,
    aggro: null,
    attackDelay: 0,
    range: loadout.range,
    atkSpeed: loadout.atkSpeed,
    incomingProjectiles: [],
    autoRetaliate: true,
    lastHit: true,
    recoilQueue: [],
    echoBootsCooldown: 0,
    lastBarrageTarget: null,
    lastAttacker: null,
  };
}

export function initSim(spawnCode: string, playerPos: Point, startTick = 15): Phase1Sim | null {
  state.mobIdCounter = 0;
  state.tickEvents = [];
  state.tickHits = {};
  state.gridMobColumns = [];
  const region = createRegion(state.pillars);
  const mobs: Mob[] = [];
  const player = createPlayer(playerPos.x, playerPos.y);
  const deadMobs: Mob[] = [];
  const parsed: SpawnParseResult = parseSpawnCode(spawnCode);
  if ("error" in parsed) {
    setStatus(parsed.error, "error");
    return null;
  }
  for (const spawn of parsed.spawns) {
    if (spawn.type === "nothing") continue;
    const mob = createMob(spawn.type, spawn.x, spawn.y, state.mobIdCounter++);
    mob.aggroTarget = "player";
    mob.infNum = spawn.infNum || 0;
    mobs.push(mob);
  }
  // Sort by game index: higher infNum = lower game index = processed first
  if (parsed.hasIndexInfo) mobs.sort((a, b) => (b.infNum || 0) - (a.infNum || 0));
  // Spawn 3 nibblers randomly if all pillars are dead
  const allPillarsDead = !state.pillars.S && !state.pillars.W && !state.pillars.N;
  if (allPillarsDead) {
    spawnNibblers(
      mobs,
      region,
      (t, x, y, id) => createMob(t, x, y, id),
      () => state.mobIdCounter++,
    );
  }
  for (const m of mobs)
    state.gridMobColumns.push({
      id: m.id,
      letter: m.letter || "?",
      color: m.color || "#888",
      type: m.type,
    });
  sortMobColumns();
  return {
    region,
    mobs,
    player,
    tick: startTick,
    startTick,
    deadMobs,
    delayedBlobletSpawns: [],
  };
}

export function markMobForProjectileRemoval(mob: Mob, tick: number): void {
  if (mob.dead) return;
  mob.hp = 0;
  if (mob.pendingRemovalTick === undefined || mob.pendingRemovalTick > tick + 1) {
    mob.pendingRemovalTick = tick + 1;
    mob.dyingStartTick = tick;
  }
}

export function processCorpseExpiry(simRef: Phase1Sim, tick: number): void {
  for (const mob of simRef.mobs) {
    if (mob.dead || mob.dying <= 0) continue;
    const remain = (mob.corpseRemovalTick ?? tick) - tick;
    if (remain <= 0) {
      mob.dead = true;
      mob.dying = 0;
      mob.corpseRemovalTick = undefined;
      mob.pendingRemovalTick = undefined;
    } else mob.dying = remain;
  }
}

export function processPendingMobDeaths(simRef: Phase1Sim, tick: number): void {
  const player = simRef.player;
  for (const mob of simRef.mobs) {
    if (mob.dead || mob.dying > 0) continue;
    if (mob.pendingRemovalTick !== undefined && mob.pendingRemovalTick <= tick) {
      mob.pendingRemovalTick = undefined;
      mob.dying = DEATH_ANIM_TICKS;
      mob.corpseRemovalTick = tick + DEATH_ANIM_TICKS;
      onMobDeath(mob, player, simRef.region, simRef.mobs, tick, simRef);
    }
  }
}

export function simulateTick(): void {
  if (!state.sim) return;
  state.sim.tick++;
  const t = state.sim.tick;
  const region = state.sim.region;
  const mobs = state.sim.mobs;
  const player = state.sim.player;
  processCorpseExpiry(state.sim, t);
  processPendingMobDeaths(state.sim, t);
  processDelayedBlobletSpawns(state.sim, t);
  // Process recoil queue (ring of suffering + echo boots)
  if (player.recoilQueue.length > 0) {
    const rem: typeof player.recoilQueue = [];
    for (const r of player.recoilQueue) {
      if (r.tick <= t) {
        const mob = mobs.find(
          (m) => m.id === r.mobId && !m.dead && m.dying <= 0 && m.pendingRemovalTick === undefined,
        );
        if (mob && mob.dying === -1 && mob.pendingRemovalTick === undefined) {
          mob.hp -= r.damage;
          if (mob.hp <= 0) {
            markMobForProjectileRemoval(mob, t);
          }
          state.tickEvents.push({
            tick: t,
            type: mob.type,
            detail: `${r.source === "ring" ? "Ring of Suffering" : "Echo Boots"} recoil ${r.damage} → ${mob.type} #${mob.id}`,
            mobId: mob.id,
            isHit: true,
          });
        }
      } else {
        rem.push(r);
      }
    }
    player.recoilQueue = rem;
  }
  for (const mob of mobs) {
    if (mob.dead || mob.dying > 0) continue;
    if (mob.stunned > 0) {
      mob.stunned--;
      continue;
    }
    if (mob.frozen > 0) {
      mob.frozen--;
      continue;
    }
    moveMob(mob, player, region, mobs, state.sim);
  }
  for (const mob of mobs) {
    if (mob.dead || mob.dying > 0 || mob.stunned > 0) continue;
    mob.attackDelay--;
    mobAttackStep(mob, player, region, mobs, t, state.sim);
  }
  // Player projectiles land after NPC actions for this tick. A fatal hit marks the
  // target for removal on the next tick, but it does not prevent this tick's attack.
  for (const mob of mobs) {
    if (!mob.dead && mob.dying <= 0) processIncomingProjectiles(mob, t);
  }
  processPlayerProjectiles(player, t);
  player.attackDelay--;
  movePlayer(player, region, mobs);
  playerAttackStep(player, mobs, region, t);
  if (!state.autozukRunning) updateUI();
}

export function processIncomingProjectiles(mob: Mob, tick: number): void {
  const rem: typeof mob.incomingProjectiles = [];
  for (const p of mob.incomingProjectiles) {
    p.delay--;
    if (p.delay <= 0) {
      if (mob.pendingRemovalTick === undefined) {
        mob.hp -= p.damage;
        if (mob.hp <= 0) {
          markMobForProjectileRemoval(mob, tick);
        }
      }
    } else rem.push(p);
  }
  mob.incomingProjectiles = rem;
}

export function processPlayerProjectiles(player: Player, tick: number): void {
  const rem: typeof player.incomingProjectiles = [];
  const arrived: typeof player.incomingProjectiles = [];
  for (const p of player.incomingProjectiles) {
    p.delay--;
    if (p.delay <= 0) {
      state.tickEvents.push({
        tick,
        type: p.mobType || "nothing",
        detail: `${p.style} hit from ${p.mobType} (id:${p.mobId})`,
        mobId: p.mobId,
        isHit: true,
      });
      arrived.push(p);
      // Apply actual damage using loadout + prayer
      let blocked = false;
      {
        const prayTick = p.fireTick !== undefined ? p.fireTick : tick;
        const pray = getEffectivePrayerForTick(prayTick);
        if (p.style === "magic" && pray === "mage") blocked = true;
        if (p.style === "range" && pray === "range") blocked = true;
        if (p.style === "melee" && pray === "melee") blocked = true;
      }
      if (!blocked) {
        const loadout = state.currentLoadout!;
        const atkStats = resolveMonsterAttackStats(loadout, p.mobType || "", p.style || null);
        if (atkStats) {
          const acc = atkStats.acc;
          const maxH = atkStats.max;
          if (Math.random() < acc) {
            let dmg = Math.floor(Math.random() * (maxH + 1));
            if (dmg > 0) {
              player.hp -= dmg;
              // Recoil damage is driven by the selected ring/boots, not a manual toggle.
              const hasRingRecoil = loadoutHasRingRecoil(loadout);
              const hasEchoBoots = loadoutHasEchoBoots(loadout);
              if (loadout.hasRecoil && (hasRingRecoil || hasEchoBoots)) {
                const attackerMob = state.sim?.mobs.find(
                  (m) =>
                    m.id === p.mobId &&
                    !m.dead &&
                    m.dying <= 0 &&
                    m.pendingRemovalTick === undefined,
                );
                if (attackerMob) {
                  // Ring of Suffering: floor(dmg*0.1+1) damage, 1 tick after hit
                  if (hasRingRecoil) {
                    const ringDmg = Math.floor(dmg * 0.1 + 1);
                    player.recoilQueue.push({
                      tick: tick + 1,
                      mobId: p.mobId!,
                      damage: ringDmg,
                      source: "ring",
                    });
                  }
                  // Echo Boots: 1 damage if attacker within 1 tile, 1 tick after hit, 4-tick cycle
                  const mobDist = distToMob(player.x, player.y, attackerMob);
                  if (hasEchoBoots && mobDist <= 1 && tick >= player.echoBootsCooldown) {
                    player.recoilQueue.push({
                      tick: tick + 1,
                      mobId: p.mobId!,
                      damage: 1,
                      source: "echo",
                    });
                    player.echoBootsCooldown = tick + 4;
                  }
                }
              }
            } else {
              player.hp -= dmg; // dmg is 0, no recoil
            }
          }
        }
      }
    } else rem.push(p);
  }
  // Auto-retaliate: target lastAttacker (set when mob fires, not when projectile lands)
  if (player.autoRetaliate && arrived.length > 0) {
    if (
      !player.aggro ||
      player.aggro.dead ||
      (player.aggro.dying > 0 && tick > player.aggro.dyingStartTick)
    ) {
      const target = player.lastAttacker;
      if (
        target &&
        !target.dead &&
        target.dying === -1 &&
        target.pendingRemovalTick === undefined
      ) {
        player.aggro = target;
        const fd = Math.floor(state.currentLoadout!.atkSpeed / 2) + 1;
        if (player.attackDelay < fd) player.attackDelay = fd;
      }
    }
  }
  player.incomingProjectiles = rem;
}

export function recordTickHit(
  tick: number,
  mobId: number,
  mobType: MobType,
  style: CombatStyle | "blob" | null,
  isScan: boolean,
): void {
  if (!state.tickHits[tick]) state.tickHits[tick] = [];
  const d = MOB_DEFS[mobType];
  state.tickHits[tick].push({
    mobId,
    mobType,
    color: d ? d.color : "#888",
    letter: d ? d.letter : "?",
    style,
    isScan,
  });
  if (!state.gridMobColumns.find((c) => c.id === mobId)) {
    state.gridMobColumns.push({
      id: mobId,
      letter: d ? d.letter : "?",
      color: d ? d.color : "#888",
      type: mobType,
    });
    sortMobColumns();
    rebuildTickGridHeader();
  }
}

export function sortMobColumns(): void {
  state.gridMobColumns.sort((a, b) => {
    const pa = MOB_TYPE_PRIORITY[a.type] ?? 99;
    const pb = MOB_TYPE_PRIORITY[b.type] ?? 99;
    return pa !== pb ? pa - pb : a.id - b.id;
  });
}

export function moveMob(
  mob: Mob,
  player: Player,
  region: Region,
  mobs: Mob[],
  _simRef: Phase1Sim,
): void {
  if (mob.hasDig && mob.digTimer > 0) {
    mob.digTimer--;
    if (mob.digTimer === 0) {
      mob.x = mob.digLocation!.x;
      mob.y = mob.digLocation!.y;
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
    mob.noLOSTicks = (mob.noLOSTicks || 0) + 1;
  }
  if (mob.hasLOS || mob.frozen > 0) return;
  if (mob.hasDig && !mob.hasLOS && !mob.digTimer) {
    if ((mob.attackDelay <= -38 && Math.random() < 0.1) || mob.attackDelay <= -50) {
      startDig(mob, player, region);
      return;
    }
  }
  let dx = mob.x + Math.sign(player.x - mob.x);
  let dy = mob.y + Math.sign(player.y - mob.y);
  if (collisionMath(mob.x, mob.y, mob.size, player.x, player.y, 1)) {
    if (Math.random() < 0.5) {
      dy = mob.y;
      dx = mob.x + (Math.random() < 0.5 ? 1 : -1);
    } else {
      dx = mob.x;
      dy = mob.y + (Math.random() < 0.5 ? 1 : -1);
    }
  } else if (collisionMath(dx, dy, mob.size, player.x, player.y, 1)) {
    dy = mob.y;
  }
  if (mob.attackDelay > mob.atkSpeed) return;
  const xOff = dx - mob.x;
  const yOff = mob.y - dy;
  // Diagonal: OSRS-style NPC movement only checks whether the destination footprint is clear.
  // Do NOT require the intermediate horizontal/vertical components to be clear,
  // or large NPCs will start their diagonal around pillars one tick too late.
  const both = canMoveTiles(mob, xOff, yOff, null, region, mobs);
  let canMoveX = false;
  let canMoveY = false;
  if (!both) {
    if (xOff !== 0) canMoveX = canMoveTiles(mob, xOff, 0, null, region, mobs);
    if (!canMoveX && yOff !== 0) canMoveY = canMoveTiles(mob, 0, yOff, null, region, mobs);
  }
  if (both) {
    mob.x = dx;
    mob.y = dy;
  } else if (canMoveX) {
    mob.x = dx;
  } else if (canMoveY) {
    mob.y = dy;
  }
}

export function canMoveTiles(
  mob: Mob,
  xOff: number,
  yOff: number,
  _axis_unused: unknown,
  region: Region,
  mobs: Mob[],
): boolean {
  if (xOff === 0 && yOff === 0) return true;
  const s = mob.size;
  const dx = xOff;
  const dy = -yOff; // dy: yOff=-1→south(+1), yOff=1→north(-1)
  const nx = mob.x + dx;
  const ny = mob.y + dy;
  const bl = region.blocked;
  const isNib = mob.type === "nibbler";
  // Check new column tiles (if moving in x)
  if (dx === -1)
    for (let i = 0; i < s; i++) {
      if (bl[(nx << 6) | (ny - i)]) return false;
      if (!isNib && collidesWithMobs(nx, ny - i, 1, mobs, mob, true)) return false;
    }
  else if (dx === 1) {
    const rx = nx + s - 1;
    for (let i = 0; i < s; i++) {
      if (bl[(rx << 6) | (ny - i)]) return false;
      if (!isNib && collidesWithMobs(rx, ny - i, 1, mobs, mob, true)) return false;
    }
  }
  // Check new row tiles (if moving in y)
  if (dy === 1)
    for (let i = 0; i < s; i++) {
      if (bl[((nx + i) << 6) | ny]) return false;
      if (!isNib && collidesWithMobs(nx + i, ny, 1, mobs, mob, true)) return false;
    }
  else if (dy === -1) {
    const by = ny - s + 1;
    for (let i = 0; i < s; i++) {
      if (bl[((nx + i) << 6) | by]) return false;
      if (!isNib && collidesWithMobs(nx + i, by, 1, mobs, mob, true)) return false;
    }
  }
  return true;
}

export function mobAttackStep(
  mob: Mob,
  player: Player,
  region: Region,
  mobs: Mob[],
  tick: number,
  simRef: Phase1Sim,
): void {
  if (mob.dead || mob.dying > 0 || mob.stunned > 0) return;
  mob.hadLOS = mob.hasLOS;
  mob.hasLOS = mobHasLOS(region, mob, player);
  if (mob.hasFlicker) {
    mob.flickering = mob.attackDelay === 1 && mob.hasLOS;
    if (!mob.hasLOS || mob.attackDelay > 0 || isUnderMob(mob, player)) return;
    if (Math.random() < 0.1 && simRef.deadMobs.length > 0) {
      const toRes = simRef.deadMobs.shift()!;
      toRes.revivedOnce = true;
      toRes.hp = Math.floor(toRes.maxHp / 2);
      toRes.dead = false;
      toRes.dying = -1;
      toRes.pendingRemovalTick = undefined;
      toRes.corpseRemovalTick = undefined;
      toRes.attackDelay = toRes.atkSpeed + 1;
      toRes.stunned = 0;
      toRes.frozen = 0;
      const loc = findRespawnLocation(toRes.size, region, mobs);
      toRes.x = loc.x;
      toRes.y = loc.y;
      toRes.aggroTarget = "player";
      if (!mobs.includes(toRes)) mobs.push(toRes);
      if (!state.gridMobColumns.find((c) => c.id === toRes.id)) {
        state.gridMobColumns.push({
          id: toRes.id,
          letter: toRes.letter || "?",
          color: toRes.color || "#888",
          type: toRes.type,
        });
        sortMobColumns();
        rebuildTickGridHeader();
      }
      mob.attackDelay = mob.atkSpeed * 2;
      state.tickEvents.push({
        tick,
        type: "mager",
        detail: `Mager resurrected ${toRes.type}!`,
        mobId: mob.id,
        isResurrect: true,
      });
      return;
    }
    fireAttack(mob, player, region, tick);
    mob.attackDelay = mob.atkSpeed;
    return;
  }
  if (mob.isBlob) {
    if (!mob.hasLOS && !mob.blobScanPrayer) return;
    if (mob.hasLOS && (!mob.hadLOS || (!mob.blobScanPrayer && mob.attackDelay <= 0))) {
      mob.blobScanPrayer = "scanned";
      mob.attackDelay = mob.atkSpeed;
      // Blob scans prayer: opposite of what's prayed, or random if no sequence
      let style: CombatStyle;
      const pray = getEffectivePrayerForTick(tick);
      if (pray) {
        if (pray === "mage") style = "range";
        else if (pray === "range") style = "magic";
        else style = Math.random() < 0.5 ? "magic" : "range";
      } else {
        style = Math.random() < 0.5 ? "magic" : "range";
      }
      mob.currentStyle = style;
      state.tickEvents.push({
        tick,
        type: "blob",
        detail: `Blob SCAN (id:${mob.id}) → ${style}`,
        mobId: mob.id,
        isScan: true,
      });
      recordTickHit(tick, mob.id, mob.type, style, true);
      return;
    }
    if (mob.blobScanPrayer && mob.attackDelay <= 0) {
      fireAttack(mob, player, region, tick);
      mob.blobScanPrayer = null;
      mob.attackDelay = mob.atkSpeed;
    }
    return;
  }
  if (!mob.hasLOS || mob.attackDelay > 0) return;
  if (isUnderMob(mob, player)) return;
  const actualStyle = mob.style;
  fireAttack(mob, player, region, tick, actualStyle);
  mob.attackDelay = mob.atkSpeed;
}

export function fireAttack(
  mob: Mob,
  player: Player,
  region: Region,
  tick: number,
  overrideStyle?: CombatStyle | "blob",
): void {
  let style: CombatStyle | "blob" | null = overrideStyle || mob.currentStyle || mob.style;
  if (style === "blob") style = mob.currentStyle || "magic";
  if (canUseSecondaryMelee(mob, player) && Math.random() < 0.5) style = "melee";
  const delay = monsterProjectileDelay(mob, style, player);
  player.incomingProjectiles.push({
    delay: delay + 1,
    damage: 0,
    mobType: mob.type,
    mobId: mob.id,
    style,
    fireTick: tick,
  });
  // last_attacker is set when mob fires, not when projectile lands
  setPlayerLastAttacker(player, mob);
  recordTickHit(tick, mob.id, mob.type, style, false);
  state.tickEvents.push({
    tick,
    type: mob.type,
    detail: `${mob.type} attacks (${style}), pray T${tick}`,
    mobId: mob.id,
    isAttack: true,
    hitTick: tick + delay,
  });
}

export function movePlayer(player: Player, region: Region, _mobs: Mob[]): void {
  if (
    !player.aggro ||
    player.aggro.dead ||
    player.aggro.dying > 0 ||
    player.aggro.pendingRemovalTick !== undefined
  )
    return;
  const target = player.aggro;
  // Already in range with LOS? Don't move
  if (
    distToMob(player.x, player.y, target) <= player.range &&
    playerHasLOS(region, player.x, player.y, target, player.range)
  )
    return;
  // Destination: closest face tile (melee-adjacent, N/S priority on ties)
  const dest = getClosestFaceTile(target, player.x, player.y, region);
  if (!dest) return;
  // Running: take 2 walk steps per tick
  const step1 = osrsWalkStep(player.x, player.y, dest.x, dest.y, region);
  if (!step1) return;
  player.x = step1.x;
  player.y = step1.y;
  if (player.x === dest.x && player.y === dest.y) return;
  const step2 = osrsWalkStep(player.x, player.y, dest.x, dest.y, region);
  if (step2) {
    player.x = step2.x;
    player.y = step2.y;
  }
}

export function playerAttackStep(player: Player, mobs: Mob[], region: Region, tick: number): void {
  if (
    player.aggro &&
    (player.aggro.dead || (player.aggro.dying > 0 && tick > player.aggro.dyingStartTick))
  )
    player.aggro = null;
  if (!player.aggro || player.attackDelay > 0 || player.aggro.pendingRemovalTick !== undefined)
    return;
  const loadout = state.currentLoadout!;
  if (!playerHasLOS(region, player.x, player.y, player.aggro, loadout.range)) return;
  const target = player.aggro;
  const delay = playerProjectileDelay(loadout, player.x, player.y, target);
  // Roll accuracy + damage using loadout
  const accArr = loadout.playerAcc[target.type as Exclude<MobType, "nothing">];
  const acc = player.lastHit ? accArr[0] : accArr[1];
  const hit = Math.random() < acc;
  let dmg = 0;
  if (hit) {
    dmg = Math.floor(Math.random() * (loadout.maxHit + 1));
    player.lastHit = true;
  } else {
    player.lastHit = false;
  }
  target.incomingProjectiles.push({ delay, damage: dmg });
  // Blood barrage: heal 25% at cast time + 3x3 AOE
  if (loadout.isBloodBarrage) {
    player.maxHp = Math.max(loadoutStartingHp(loadout), loadoutBloodMaxHp(loadout));
    if (dmg > 0 && player.hp < player.maxHp) {
      player.hp = Math.min(
        player.maxHp,
        player.hp + Math.floor(dmg * loadoutBloodHealRate(loadout)),
      );
    }
    const aoeOffsets = [
      [-1, -1],
      [-1, 0],
      [-1, 1],
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 0],
      [1, 1],
    ];
    let hitCount = 1;
    for (const off of aoeOffsets) {
      if (hitCount >= 9) break;
      const ax = target.x + off[0];
      const ay = target.y + off[1];
      for (const m of mobs) {
        if (m.dead || m.dying > 0 || m === target) continue;
        if (m.x === ax && m.y === ay) {
          hitCount++;
          const sAccArr = loadout.playerAcc[m.type as Exclude<MobType, "nothing">];
          const sAcc = player.lastHit ? sAccArr[0] : sAccArr[1];
          const sHit = Math.random() < sAcc;
          const sDmg = sHit ? Math.floor(Math.random() * (loadout.maxHit + 1)) : 0;
          const sDelay = playerProjectileDelay(loadout, player.x, player.y, m);
          m.incomingProjectiles.push({ delay: sDelay, damage: sDmg });
          if (sDmg > 0 && player.hp < player.maxHp) {
            player.hp = Math.min(
              player.maxHp,
              player.hp + Math.floor(sDmg * loadoutBloodHealRate(loadout)),
            );
          }
          break;
        }
      }
    }
  }
  player.attackDelay = loadout.atkSpeed;
  // Track barrage splash visual (Phase 1 rendering only)
  if (loadout.isBloodBarrage && dmg > 0) {
    player.lastBarrageTarget = { x: target.x, y: target.y, tick };
  }
  state.tickEvents.push({
    tick,
    type: "player-atk",
    detail: `Player → ${target.type} #${target.id}, ${dmg}dmg hits T${tick + delay}`,
    mobId: target.id,
    isPlayerAttack: true,
  });
}

export function spawnBlobletsFromBlob(blob: Mob, tick: number, simRef: Phase1Sim): void {
  const mobs = simRef.mobs;
  const bm = createMob("blobletMage", blob.x + 2, blob.y - 2, state.mobIdCounter++);
  bm.aggroTarget = "player";
  bm.stunned = 0;
  bm.frozen = 1;
  bm.attackDelay = 4;
  bm.parentBlobId = blob.id;
  mobs.push(bm);
  const br = createMob("blobletRange", blob.x + 1, blob.y - 1, state.mobIdCounter++);
  br.aggroTarget = "player";
  br.stunned = 0;
  br.frozen = 1;
  br.attackDelay = 4;
  br.parentBlobId = blob.id;
  mobs.push(br);
  const bx = createMob("blobletMelee", blob.x, blob.y, state.mobIdCounter++);
  bx.aggroTarget = "player";
  bx.stunned = 0;
  bx.frozen = 1;
  bx.attackDelay = 4;
  bx.parentBlobId = blob.id;
  mobs.push(bx);
  for (const bl of [bm, br, bx])
    state.gridMobColumns.push({
      id: bl.id,
      letter: bl.letter || "?",
      color: bl.color || "#888",
      type: bl.type,
    });
  sortMobColumns();
  rebuildTickGridHeader();
  state.tickEvents.push({
    tick,
    type: "blob",
    detail: `Bloblets spawn (frozen this tick)`,
    mobId: blob.id,
  });
}

export function processDelayedBlobletSpawns(simRef: Phase1Sim, tick: number): void {
  const pending = simRef.delayedBlobletSpawns || [];
  if (pending.length === 0) return;
  const keep: typeof pending = [];
  for (const item of pending) {
    if (item.tick <= tick) spawnBlobletsFromBlob(item.blob, tick, simRef);
    else keep.push(item);
  }
  simRef.delayedBlobletSpawns = keep;
}

export function onMobDeath(
  mob: Mob,
  player: Player,
  region: Region,
  mobs: Mob[],
  tick: number,
  simRef: Phase1Sim,
): void {
  if (mob.isBlob) {
    if (!simRef.delayedBlobletSpawns) simRef.delayedBlobletSpawns = [];
    simRef.delayedBlobletSpawns.push({ tick: tick + 1, blob: mob });
    state.tickEvents.push({
      tick,
      type: "blob",
      detail: `Blob died → bloblets spawn T${tick + 1}`,
      mobId: mob.id,
    });
  }
  if (!mob.type.startsWith("bloblet") && mob.type !== "nibbler" && !mob.revivedOnce)
    simRef.deadMobs.push(mob);
  if (player.aggro === mob) player.aggro = null;
  if (player.lastAttacker === mob) player.lastAttacker = null;
}

export function ensureSim(): boolean | "created" {
  if (state.sim) return true;
  const code = (document.getElementById("spawnCode") as HTMLInputElement | null)?.value || "";
  if (!code.trim()) {
    showSpawnCodeError();
    setStatus("Enter a spawn code first", "error");
    return false;
  }
  if (!state.playerPlacement) {
    setStatus("Click the grid to place the player first", "error");
    return false;
  }
  state.sim = initSim(code, state.playerPlacement);
  if (!state.sim) return false;
  rebuildTickGridHeader();
  (document.getElementById("tickGridBody") as HTMLElement | null)!.innerHTML = "";
  state.tickGridUserScrolled = false;
  state.eventListUserScrolled = false;
  setStatus(
    `Sim started! ${state.sim.mobs.filter((m) => !m.dead).length} mobs spawned on tick 15.`,
    "info",
  );
  updateUI();
  return "created";
}

export function resetSim(): void {
  if (practiceState.open) closePracticeMode(true);
  stopPlay();
  state.sim = null;
  state.tickEvents = [];
  state.tickHits = {};
  state.gridMobColumns = [];
  state.tickGridUserScrolled = false;
  state.eventListUserScrolled = false;
  (document.getElementById("tickGridHead") as HTMLElement | null)!.innerHTML =
    '<tr><th class="tick-col">T</th></tr>';
  (document.getElementById("tickGridBody") as HTMLElement | null)!.innerHTML = "";
  (document.getElementById("tickGridCount") as HTMLElement | null)!.textContent = "0 hits";
  (document.getElementById("eventCount") as HTMLElement | null)!.textContent = "0 events";
  (document.getElementById("eventListBody") as HTMLElement | null)!.innerHTML =
    '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">Load a wave to see events</div>';
  (document.getElementById("detailPanel") as HTMLElement | null)!.classList.add("detail-hidden");
  (document.getElementById("phase1Panel") as HTMLElement | null)!.style.display = "";
  (document.getElementById("eventlistSection") as HTMLElement | null)!.style.display = "";

  (document.getElementById("resizeHandle") as HTMLElement | null)!.style.display = "";
  updateUI();
  setStatus(
    state.playerPlacement
      ? `Player at (${state.playerPlacement.x}, ${state.playerPlacement.y}) — ready`
      : "Enter spawn code and click a tile",
  );
  updatePreview();
  render();
}

export function stepTick(): void {
  if (practiceState.open) closePracticeMode(true);
  const r = ensureSim();
  if (!r) return;
  ensureTickGridView();
  if (r === "created") return;
  simulateTick();
}

export function togglePlay(): void {
  if (practiceState.open) closePracticeMode(true);
  const r = ensureSim();
  if (!r) return;
  ensureTickGridView();
  if (state.playing) stopPlay();
  else {
    state.playing = true;
    (document.getElementById("btnPlay") as HTMLElement | null)!.textContent = "⏸ PAUSE";
    (document.getElementById("btnPlay") as HTMLElement | null)!.classList.remove("btn-primary");
    (document.getElementById("btnPlay") as HTMLElement | null)!.classList.add("btn-secondary");
    startPlay();
  }
}

export function startPlay(): void {
  const speed = parseInt(
    (document.getElementById("speedSlider") as HTMLInputElement | null)?.value || "10",
  );
  const interval = Math.max(16, Math.floor(1000 / speed));
  state.playInterval = setInterval(() => {
    if (!state.sim) {
      stopPlay();
      return;
    }
    simulateTick();
    if (state.sim.mobs.every((m) => m.dead)) {
      stopPlay();
      setStatus(`All mobs dead at tick ${state.sim.tick}!`, "info");
    }
  }, interval);
}

export function stopPlay(): void {
  state.playing = false;
  if (state.playInterval) clearInterval(state.playInterval);
  state.playInterval = null;
  (document.getElementById("btnPlay") as HTMLElement | null)!.textContent = "▶ PLAY";
  (document.getElementById("btnPlay") as HTMLElement | null)!.classList.add("btn-primary");
  (document.getElementById("btnPlay") as HTMLElement | null)!.classList.remove("btn-secondary");
}

export function runTicks(n: number): void {
  if (!ensureSim()) return;
  stopPlay();
  for (let i = 0; i < n; i++) {
    simulateTick();
    if (state.sim!.mobs.every((m) => m.dead)) {
      setStatus(`All mobs dead at tick ${state.sim!.tick}!`, "info");
      break;
    }
  }
}
