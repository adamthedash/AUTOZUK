let sim = null,
  pillars = { S: true, W: true, N: true },
  playerPlacement = null;
let playing = false,
  playInterval = null;
let tickEvents = [],
  mobIdCounter = 0;
let tickHits = {},
  gridMobColumns = [];
let previewMobs = [];
let tickGridUserScrolled = false,
  eventListUserScrolled = false;

// ===== PHASE 1: SIM ENGINE =====
function createMob(type, x, y, id) {
  let d = MOB_DEFS[type];
  return {
    id: id || mobIdCounter++,
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
  };
}
function createPlayer(x, y) {
  let startHp = loadoutStartingHp(currentLoadout),
    maxHp = Math.max(startHp, loadoutBloodMaxHp(currentLoadout));
  return {
    x,
    y,
    size: 1,
    hp: startHp,
    maxHp,
    aggro: null,
    attackDelay: 0,
    range: currentLoadout.range,
    atkSpeed: currentLoadout.atkSpeed,
    incomingProjectiles: [],
    autoRetaliate: true,
    lastHit: true,
    recoilQueue: [],
    echoBootsCooldown: 0,
    lastBarrageTarget: null,
    lastAttacker: null,
  };
}

function initSim(spawnCode, playerPos, startTick = 15) {
  mobIdCounter = 0;
  tickEvents = [];
  tickHits = {};
  gridMobColumns = [];
  let region = createRegion(pillars),
    mobs = [],
    player = createPlayer(playerPos.x, playerPos.y),
    deadMobs = [];
  let parsed = parseSpawnCode(spawnCode);
  if (parsed.error) {
    setStatus(parsed.error, "error");
    return null;
  }
  for (let spawn of parsed.spawns) {
    if (spawn.type === "nothing") continue;
    let mob = createMob(spawn.type, spawn.x, spawn.y, mobIdCounter++);
    mob.aggroTarget = "player";
    mob.infNum = spawn.infNum || 0;
    mobs.push(mob);
  }
  // Sort by game index: higher infNum = lower game index = processed first
  if (parsed.hasIndexInfo) mobs.sort((a, b) => b.infNum - a.infNum);
  // Spawn 3 nibblers randomly if all pillars are dead
  let allPillarsDead = !pillars.S && !pillars.W && !pillars.N;
  if (allPillarsDead) {
    spawnNibblers(
      mobs,
      region,
      (t, x, y, id) => createMob(t, x, y, id),
      () => mobIdCounter++,
    );
  }
  for (let m of mobs)
    gridMobColumns.push({ id: m.id, letter: m.letter, color: m.color, type: m.type });
  sortMobColumns();
  return { region, mobs, player, tick: startTick, startTick, deadMobs, delayedBlobletSpawns: [] };
}

function markMobForProjectileRemoval(mob, tick) {
  if (mob.dead) return;
  mob.hp = 0;
  if (mob.pendingRemovalTick === undefined || mob.pendingRemovalTick > tick + 1) {
    mob.pendingRemovalTick = tick + 1;
    mob.dyingStartTick = tick;
  }
}
function processCorpseExpiry(simRef, tick) {
  for (let mob of simRef.mobs) {
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
function processPendingMobDeaths(simRef, tick) {
  let player = simRef.player;
  for (let mob of simRef.mobs) {
    if (mob.dead || mob.dying > 0) continue;
    if (mob.pendingRemovalTick !== undefined && mob.pendingRemovalTick <= tick) {
      mob.pendingRemovalTick = undefined;
      mob.dying = DEATH_ANIM_TICKS;
      mob.corpseRemovalTick = tick + DEATH_ANIM_TICKS;
      onMobDeath(mob, player, simRef.region, simRef.mobs, tick, simRef);
    }
  }
}

function simulateTick() {
  if (!sim) return;
  sim.tick++;
  let t = sim.tick,
    region = sim.region,
    mobs = sim.mobs,
    player = sim.player;
  processCorpseExpiry(sim, t);
  processPendingMobDeaths(sim, t);
  processDelayedBlobletSpawns(sim, t);
  // Process recoil queue (ring of suffering + echo boots)
  if (player.recoilQueue.length > 0) {
    let rem = [];
    for (let r of player.recoilQueue) {
      if (r.tick <= t) {
        let mob = mobs.find(
          (m) => m.id === r.mobId && !m.dead && m.dying <= 0 && m.pendingRemovalTick === undefined,
        );
        if (mob && mob.dying === -1 && mob.pendingRemovalTick === undefined) {
          mob.hp -= r.damage;
          if (mob.hp <= 0) {
            markMobForProjectileRemoval(mob, t);
          }
          tickEvents.push({
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
    moveMob(mob, player, region, mobs, sim);
  }
  for (let mob of mobs) {
    if (mob.dead || mob.dying > 0 || mob.stunned > 0) continue;
    mob.attackDelay--;
    mobAttackStep(mob, player, region, mobs, t, sim);
  }
  // Player projectiles land after NPC actions for this tick. A fatal hit marks the
  // target for removal on the next tick, but it does not prevent this tick's attack.
  for (let mob of mobs) {
    if (!mob.dead && mob.dying <= 0) processIncomingProjectiles(mob, t);
  }
  processPlayerProjectiles(player, t);
  player.attackDelay--;
  movePlayer(player, region, mobs);
  playerAttackStep(player, mobs, region, t);
  if (!autozukRunning) updateUI();
}
function processIncomingProjectiles(mob, tick) {
  let rem = [];
  for (let p of mob.incomingProjectiles) {
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
function processPlayerProjectiles(player, tick) {
  let rem = [],
    arrived = [];
  for (let p of player.incomingProjectiles) {
    p.delay--;
    if (p.delay <= 0) {
      tickEvents.push({
        tick,
        type: p.mobType,
        detail: `${p.style} hit from ${p.mobType} (id:${p.mobId})`,
        mobId: p.mobId,
        isHit: true,
      });
      arrived.push(p);
      // Apply actual damage using loadout + prayer
      let blocked = false;
      {
        let prayTick = p.fireTick !== undefined ? p.fireTick : tick;
        let pray = getEffectivePrayerForTick(prayTick);
        if (p.style === "magic" && pray === "mage") blocked = true;
        if (p.style === "range" && pray === "range") blocked = true;
        if (p.style === "melee" && pray === "melee") blocked = true;
      }
      if (!blocked) {
        let loadout = currentLoadout;
        let atkStats = resolveMonsterAttackStats(loadout, p.mobType, p.style);
        if (atkStats) {
          let acc = atkStats.acc,
            maxH = atkStats.max;
          if (Math.random() < acc) {
            let dmg = Math.floor(Math.random() * (maxH + 1));
            if (dmg > 0) {
              player.hp -= dmg;
              // Recoil damage is driven by the selected ring/boots, not a manual toggle.
              let hasRingRecoil = loadoutHasRingRecoil(loadout),
                hasEchoBoots = loadoutHasEchoBoots(loadout);
              if (loadout.hasRecoil && (hasRingRecoil || hasEchoBoots)) {
                let attackerMob = sim.mobs.find(
                  (m) =>
                    m.id === p.mobId &&
                    !m.dead &&
                    m.dying <= 0 &&
                    m.pendingRemovalTick === undefined,
                );
                if (attackerMob) {
                  // Ring of Suffering: floor(dmg*0.1+1) damage, 1 tick after hit
                  if (hasRingRecoil) {
                    let ringDmg = Math.floor(dmg * 0.1 + 1);
                    player.recoilQueue.push({
                      tick: tick + 1,
                      mobId: p.mobId,
                      damage: ringDmg,
                      source: "ring",
                    });
                  }
                  // Echo Boots: 1 damage if attacker within 1 tile, 1 tick after hit, 4-tick cycle
                  let mobDist = distToMob(player.x, player.y, attackerMob);
                  if (hasEchoBoots && mobDist <= 1 && tick >= player.echoBootsCooldown) {
                    player.recoilQueue.push({
                      tick: tick + 1,
                      mobId: p.mobId,
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
      let target = player.lastAttacker;
      if (
        target &&
        !target.dead &&
        target.dying === -1 &&
        target.pendingRemovalTick === undefined
      ) {
        player.aggro = target;
        let fd = Math.floor(currentLoadout.atkSpeed / 2) + 1;
        if (player.attackDelay < fd) player.attackDelay = fd;
      }
    }
  }
  player.incomingProjectiles = rem;
}
function recordTickHit(tick, mobId, mobType, style, isScan) {
  if (!tickHits[tick]) tickHits[tick] = [];
  let d = MOB_DEFS[mobType];
  tickHits[tick].push({
    mobId,
    mobType,
    color: d ? d.color : "#888",
    letter: d ? d.letter : "?",
    style,
    isScan,
  });
  if (!gridMobColumns.find((c) => c.id === mobId)) {
    gridMobColumns.push({
      id: mobId,
      letter: d ? d.letter : "?",
      color: d ? d.color : "#888",
      type: mobType,
    });
    sortMobColumns();
    rebuildTickGridHeader();
  }
}
function sortMobColumns() {
  gridMobColumns.sort((a, b) => {
    let pa = MOB_TYPE_PRIORITY[a.type] ?? 99,
      pb = MOB_TYPE_PRIORITY[b.type] ?? 99;
    return pa !== pb ? pa - pb : a.id - b.id;
  });
}

function moveMob(mob, player, region, mobs, simRef) {
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
    mob.noLOSTicks = (mob.noLOSTicks || 0) + 1;
  }
  if (mob.hasLOS || mob.frozen > 0) return;
  if (mob.hasDig && !mob.hasLOS && !mob.digTimer) {
    if ((mob.attackDelay <= -38 && Math.random() < 0.1) || mob.attackDelay <= -50) {
      startDig(mob, player, region);
      return;
    }
  }
  let dx = mob.x + Math.sign(player.x - mob.x),
    dy = mob.y + Math.sign(player.y - mob.y);
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
  let xOff = dx - mob.x,
    yOff = mob.y - dy;
  // Diagonal: OSRS-style NPC movement only checks whether the destination footprint is clear.
  // Do NOT require the intermediate horizontal/vertical components to be clear,
  // or large NPCs will start their diagonal around pillars one tick too late.
  let both = canMoveTiles(mob, xOff, yOff, null, region, mobs);
  let canMoveX = false,
    canMoveY = false;
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
function canMoveTiles(mob, xOff, yOff, axis_unused, region, mobs) {
  if (xOff === 0 && yOff === 0) return true;
  let s = mob.size,
    dx = xOff,
    dy = -yOff; // dy: yOff=-1→south(+1), yOff=1→north(-1)
  let nx = mob.x + dx,
    ny = mob.y + dy,
    bl = region.blocked,
    isNib = mob.type === "nibbler";
  // Check new column tiles (if moving in x)
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
  // Check new row tiles (if moving in y)
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
function mobAttackStep(mob, player, region, mobs, tick, simRef) {
  if (mob.dead || mob.dying > 0 || mob.stunned > 0) return;
  mob.hadLOS = mob.hasLOS;
  mob.hasLOS = mobHasLOS(region, mob, player);
  if (mob.hasFlicker) {
    mob.flickering = mob.attackDelay === 1 && mob.hasLOS;
    if (!mob.hasLOS || mob.attackDelay > 0 || isUnderMob(mob, player)) return;
    if (Math.random() < 0.1 && simRef.deadMobs.length > 0) {
      let toRes = simRef.deadMobs.shift();
      toRes.revivedOnce = true;
      toRes.hp = Math.floor(toRes.maxHp / 2);
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
      toRes.aggroTarget = "player";
      if (!mobs.includes(toRes)) mobs.push(toRes);
      if (!gridMobColumns.find((c) => c.id === toRes.id)) {
        gridMobColumns.push({
          id: toRes.id,
          letter: toRes.letter,
          color: toRes.color,
          type: toRes.type,
        });
        sortMobColumns();
        rebuildTickGridHeader();
      }
      mob.attackDelay = mob.atkSpeed * 2;
      tickEvents.push({
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
      let style;
      let pray = getEffectivePrayerForTick(tick);
      if (pray) {
        if (pray === "mage") style = "range";
        else if (pray === "range") style = "magic";
        else style = Math.random() < 0.5 ? "magic" : "range";
      } else {
        style = Math.random() < 0.5 ? "magic" : "range";
      }
      mob.currentStyle = style;
      tickEvents.push({
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
  let actualStyle = mob.style;
  fireAttack(mob, player, region, tick, actualStyle);
  mob.attackDelay = mob.atkSpeed;
}
function fireAttack(mob, player, region, tick, overrideStyle) {
  let style = overrideStyle || mob.currentStyle || mob.style;
  if (style === "blob") style = mob.currentStyle || "magic";
  if (canUseSecondaryMelee(mob, player) && Math.random() < 0.5) style = "melee";
  let delay = monsterProjectileDelay(mob, style, player);
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
  tickEvents.push({
    tick,
    type: mob.type,
    detail: `${mob.type} attacks (${style}), pray T${tick}`,
    mobId: mob.id,
    isAttack: true,
    hitTick: tick + delay,
  });
}
function movePlayer(player, region, mobs) {
  if (
    !player.aggro ||
    player.aggro.dead ||
    player.aggro.dying > 0 ||
    player.aggro.pendingRemovalTick !== undefined
  )
    return;
  let target = player.aggro;
  // Already in range with LOS? Don't move
  if (
    distToMob(player.x, player.y, target) <= player.range &&
    playerHasLOS(region, player.x, player.y, target, player.range)
  )
    return;
  // Destination: closest face tile (melee-adjacent, N/S priority on ties)
  let dest = getClosestFaceTile(target, player.x, player.y, region);
  if (!dest) return;
  // Running: take 2 walk steps per tick
  let step1 = osrsWalkStep(player.x, player.y, dest.x, dest.y, region);
  if (!step1) return;
  player.x = step1.x;
  player.y = step1.y;
  if (player.x === dest.x && player.y === dest.y) return;
  let step2 = osrsWalkStep(player.x, player.y, dest.x, dest.y, region);
  if (step2) {
    player.x = step2.x;
    player.y = step2.y;
  }
}
function playerAttackStep(player, mobs, region, tick) {
  if (
    player.aggro &&
    (player.aggro.dead || (player.aggro.dying > 0 && tick > player.aggro.dyingStartTick))
  )
    player.aggro = null;
  if (!player.aggro || player.attackDelay > 0 || player.aggro.pendingRemovalTick !== undefined)
    return;
  let loadout = currentLoadout;
  if (!playerHasLOS(region, player.x, player.y, player.aggro, loadout.range)) return;
  let target = player.aggro;
  let delay = playerProjectileDelay(loadout, player.x, player.y, target);
  // Roll accuracy + damage using loadout
  let accArr = loadout.playerAcc[target.type];
  let acc = player.lastHit ? accArr[0] : accArr[1];
  let hit = Math.random() < acc;
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
    let hitCount = 1;
    for (let off of aoeOffsets) {
      if (hitCount >= 9) break;
      let ax = target.x + off[0],
        ay = target.y + off[1];
      for (let m of mobs) {
        if (m.dead || m.dying > 0 || m === target) continue;
        if (m.x === ax && m.y === ay) {
          hitCount++;
          let sAccArr = loadout.playerAcc[m.type];
          let sAcc = player.lastHit ? sAccArr[0] : sAccArr[1];
          let sHit = Math.random() < sAcc;
          let sDmg = sHit ? Math.floor(Math.random() * (loadout.maxHit + 1)) : 0;
          let sDelay = playerProjectileDelay(loadout, player.x, player.y, m);
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
  tickEvents.push({
    tick,
    type: "player-atk",
    detail: `Player → ${target.type} #${target.id}, ${dmg}dmg hits T${tick + delay}`,
    mobId: target.id,
    isPlayerAttack: true,
  });
}
function spawnBlobletsFromBlob(blob, tick, simRef) {
  let mobs = simRef.mobs;
  let bm = createMob("blobletMage", blob.x + 2, blob.y - 2, mobIdCounter++);
  bm.aggroTarget = "player";
  bm.stunned = 0;
  bm.frozen = 1;
  bm.attackDelay = 4;
  bm.parentBlobId = blob.id;
  mobs.push(bm);
  let br = createMob("blobletRange", blob.x + 1, blob.y - 1, mobIdCounter++);
  br.aggroTarget = "player";
  br.stunned = 0;
  br.frozen = 1;
  br.attackDelay = 4;
  br.parentBlobId = blob.id;
  mobs.push(br);
  let bx = createMob("blobletMelee", blob.x, blob.y, mobIdCounter++);
  bx.aggroTarget = "player";
  bx.stunned = 0;
  bx.frozen = 1;
  bx.attackDelay = 4;
  bx.parentBlobId = blob.id;
  mobs.push(bx);
  for (let bl of [bm, br, bx])
    gridMobColumns.push({ id: bl.id, letter: bl.letter, color: bl.color, type: bl.type });
  sortMobColumns();
  rebuildTickGridHeader();
  tickEvents.push({
    tick,
    type: "blob",
    detail: `Bloblets spawn (frozen this tick)`,
    mobId: blob.id,
  });
}
function processDelayedBlobletSpawns(simRef, tick) {
  let pending = simRef.delayedBlobletSpawns || [];
  if (pending.length === 0) return;
  let keep = [];
  for (let item of pending) {
    if (item.tick <= tick) spawnBlobletsFromBlob(item.blob, tick, simRef);
    else keep.push(item);
  }
  simRef.delayedBlobletSpawns = keep;
}
function onMobDeath(mob, player, region, mobs, tick, simRef) {
  if (mob.isBlob) {
    if (!simRef.delayedBlobletSpawns) simRef.delayedBlobletSpawns = [];
    simRef.delayedBlobletSpawns.push({ tick: tick + 1, blob: mob });
    tickEvents.push({
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

function ensureSim() {
  if (sim) return true;
  let code = document.getElementById("spawnCode").value;
  if (!code.trim()) {
    showSpawnCodeError();
    setStatus("Enter a spawn code first", "error");
    return false;
  }
  if (!playerPlacement) {
    setStatus("Click the grid to place the player first", "error");
    return false;
  }
  sim = initSim(code, playerPlacement);
  if (!sim) return false;
  rebuildTickGridHeader();
  document.getElementById("tickGridBody").innerHTML = "";
  tickGridUserScrolled = false;
  eventListUserScrolled = false;
  setStatus(
    `Sim started! ${sim.mobs.filter((m) => !m.dead).length} mobs spawned on tick 15.`,
    "info",
  );
  updateUI();
  return "created";
}

function resetSim() {
  if (practiceState.open) closePracticeMode(true);
  stopPlay();
  sim = null;
  tickEvents = [];
  tickHits = {};
  gridMobColumns = [];
  tickGridUserScrolled = false;
  eventListUserScrolled = false;
  document.getElementById("tickGridHead").innerHTML = '<tr><th class="tick-col">T</th></tr>';
  document.getElementById("tickGridBody").innerHTML = "";
  document.getElementById("tickGridCount").textContent = "0 hits";
  document.getElementById("eventCount").textContent = "0 events";
  document.getElementById("eventListBody").innerHTML =
    '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">Load a wave to see events</div>';
  document.getElementById("detailPanel").classList.add("detail-hidden");
  document.getElementById("phase1Panel").style.display = "";
  document.getElementById("eventlistSection").style.display = "";

  document.getElementById("resizeHandle").style.display = "";
  updateUI();
  setStatus(
    playerPlacement
      ? `Player at (${playerPlacement.x}, ${playerPlacement.y}) — ready`
      : "Enter spawn code and click a tile",
  );
  updatePreview();
  render();
}

function stepTick() {
  if (practiceState.open) closePracticeMode(true);
  let r = ensureSim();
  if (!r) return;
  ensureTickGridView();
  if (r === "created") return;
  simulateTick();
}

function togglePlay() {
  if (practiceState.open) closePracticeMode(true);
  let r = ensureSim();
  if (!r) return;
  ensureTickGridView();
  if (playing) stopPlay();
  else {
    playing = true;
    document.getElementById("btnPlay").textContent = "⏸ PAUSE";
    document.getElementById("btnPlay").classList.remove("btn-primary");
    document.getElementById("btnPlay").classList.add("btn-secondary");
    startPlay();
  }
}

function startPlay() {
  let speed = parseInt(document.getElementById("speedSlider").value),
    interval = Math.max(16, Math.floor(1000 / speed));
  playInterval = setInterval(() => {
    if (!sim) {
      stopPlay();
      return;
    }
    simulateTick();
    if (sim.mobs.every((m) => m.dead)) {
      stopPlay();
      setStatus(`All mobs dead at tick ${sim.tick}!`, "info");
    }
  }, interval);
}

function stopPlay() {
  playing = false;
  if (playInterval) clearInterval(playInterval);
  playInterval = null;
  document.getElementById("btnPlay").textContent = "▶ PLAY";
  document.getElementById("btnPlay").classList.add("btn-primary");
  document.getElementById("btnPlay").classList.remove("btn-secondary");
}

function runTicks(n) {
  if (!ensureSim()) return;
  stopPlay();
  for (let i = 0; i < n; i++) {
    simulateTick();
    if (sim.mobs.every((m) => m.dead)) {
      setStatus(`All mobs dead at tick ${sim.tick}!`, "info");
      break;
    }
  }
}
