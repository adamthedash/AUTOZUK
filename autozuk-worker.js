// === AUTOZUK Worker ===
// Messages in:
//   {type:'init', pillarConfig, loadout}
//   {type:'exclude', tiles:[{x,y}], spawnCode}
//   {type:'simulate', tile:{x,y}, spawnCode, loadout, maxTicks, maxSims, seedBase}
// Messages out:
//   {type:'init-ok'}
//   {type:'exclude-result', excluded:[{x,y}], eligible:[{x,y}]}
//   {type:'simulate-result', tile, summary} where summary matches autozukResults[key]
importScripts("sim/constants.js", "sim/pathfinding.js", "sim/combat.js", "sim-core.js");
let W = { region: null, pillarConfig: null, loadout: null };
self.onmessage = function (e) {
  let msg = e.data;
  if (msg.type === "init") {
    W.pillarConfig = msg.pillarConfig;
    W.loadout = msg.loadout;
    W.region = createRegion(msg.pillarConfig);
    self.postMessage({ type: "init-ok" });
    return;
  }
  if (msg.type === "exclude") {
    let parsed = parseSpawnCode(msg.spawnCode);
    let testMobs = [];
    if (!parsed.error) {
      for (let spawn of parsed.spawns) {
        if (spawn.type === "nothing") continue;
        testMobs.push({
          x: spawn.x,
          y: spawn.y,
          size: MOB_DEFS[spawn.type].size,
          type: spawn.type,
          range: MOB_DEFS[spawn.type].range,
          dead: false,
        });
      }
    }
    let excluded = [],
      eligible = [];
    for (let t of msg.tiles) {
      if (checkTileExcluded(t.x, t.y, testMobs, W.region)) excluded.push(t);
      else eligible.push(t);
    }
    self.postMessage({ type: "exclude-result", excluded, eligible });
    return;
  }
  if (msg.type === "simulate") {
    let tile = msg.tile;
    let loadout = msg.loadout;
    let maxTicks = msg.maxTicks;
    let maxSims = msg.maxSims;
    let seedBase = msg.seedBase;
    let allResults = [];
    for (let s = 0; s < maxSims; s++) {
      let seed = (seedBase ^ (tile.x * 73856093) ^ (tile.y * 19349663) ^ (s * 83492791)) >>> 0;
      let result = hlRunSim(msg.spawnCode, tile, W.pillarConfig, loadout, maxTicks, W.region, seed);
      if (result) allResults.push(result);
      if (s === 2 && allResults.length >= 3) {
        let quickPrayer = optimizePrayer(allResults, msg.spawnCode, W.pillarConfig, loadout);
        let allDead = allResults.every(
          (r) => calcSimDamage(r.attacks, quickPrayer.sequence, loadout, r.mobInitHP).died,
        );
        if (allDead) break;
      }
      if (s === 9 && allResults.length >= 10) {
        let quickPrayer = optimizePrayer(allResults, msg.spawnCode, W.pillarConfig, loadout);
        let quickDmgs = allResults.map(
          (r) => calcSimDamage(r.attacks, quickPrayer.sequence, loadout, r.mobInitHP).damage,
        );
        let quickAvg = quickDmgs.reduce((a, b) => a + b, 0) / quickDmgs.length;
        if (quickAvg > 80) break;
      }
    }
    if (allResults.length === 0) {
      self.postMessage({ type: "simulate-result", tile, summary: null });
      return;
    }
    let prayer = optimizePrayer(allResults, msg.spawnCode, W.pillarConfig, loadout);
    let damages = [],
      completionTicks = [];
    let invalidCount = 0,
      deathCount = 0;
    for (let r of allResults) {
      if (r.status === "invalid") {
        invalidCount++;
        continue;
      }
      let res = calcSimDamage(r.attacks, prayer.sequence, loadout, r.mobInitHP);
      if (res.died) deathCount++;
      damages.push(res.damage);
      completionTicks.push(r.completedTick);
    }
    let deathPct = damages.length > 0 ? (deathCount / damages.length) * 100 : 0;
    let avgDmg = damages.length > 0 ? damages.reduce((a, b) => a + b, 0) / damages.length : 999;
    let over50 = damages.filter((d) => d > 50).length;
    let avgTicks =
      completionTicks.length > 0
        ? completionTicks.reduce((a, b) => a + b, 0) / completionTicks.length
        : maxTicks;
    let isMostlyDead = deathPct > 30;
    let invalidPct = allResults.length > 0 ? (invalidCount / allResults.length) * 100 : 0;
    let isMostlyInvalid = invalidPct > 20;
    let summary = {
      avgDamage: avgDmg,
      damages,
      completionTicks,
      over50Pct: damages.length > 0 ? (over50 / damages.length) * 100 : 100,
      avgTicks,
      avgTime: (avgTicks * 0.6).toFixed(1),
      prayer: prayer.sequence,
      invalidPct,
      totalSims: allResults.length,
      deathPct,
      markedDead: isMostlyDead || isMostlyInvalid,
    };
    self.postMessage({ type: "simulate-result", tile, summary });
    return;
  }
};
