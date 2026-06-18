// === AUTOZUK Worker ===
// Messages in:
//   {type:'init', pillarConfig, loadout}
//   {type:'exclude', tiles:[{x,y}], spawnCode}
//   {type:'simulate', tile:{x,y}, spawnCode, loadout, maxTicks, maxSims, seedBase}
// Messages out:
//   {type:'init-ok'}
//   {type:'exclude-result', excluded:[{x,y}], eligible:[{x,y}]}
//   {type:'simulate-result', tile, summary} where summary matches autozukResults[key]
import { MOB_DEFS } from "./sim/constants.js";
import {
  createRegion,
  parseSpawnCode,
  checkTileExcluded,
  hlRunSim,
  optimizePrayer,
} from "./sim/main.js";
import { calcSimDamage } from "./sim/combat.js";
import type {
  AutozukResult,
  AutozukSummary,
  Loadout,
  Mob,
  PillarConfig,
  Point,
  Region,
} from "./types.js";

interface WorkerState {
  region: Region | null;
  pillarConfig: PillarConfig | null;
  loadout: Loadout | null;
}

interface InitMessage {
  type: "init";
  pillarConfig: PillarConfig;
  loadout: Loadout;
}

interface ExcludeMessage {
  type: "exclude";
  tiles: Point[];
  spawnCode: string;
}

interface SimulateMessage {
  type: "simulate";
  tile: Point;
  spawnCode: string;
  loadout: Loadout;
  maxTicks: number;
  maxSims: number;
  seedBase: number;
}

type WorkerMessage = InitMessage | ExcludeMessage | SimulateMessage;

const W: WorkerState = { region: null, pillarConfig: null, loadout: null };

self.onmessage = function (e: MessageEvent<WorkerMessage>) {
  const msg = e.data;

  if (msg.type === "init") {
    W.pillarConfig = msg.pillarConfig;
    W.loadout = msg.loadout;
    W.region = createRegion(msg.pillarConfig);
    self.postMessage({ type: "init-ok" });
    return;
  }

  if (msg.type === "exclude") {
    const parsed = parseSpawnCode(msg.spawnCode);
    const testMobs: Mob[] = [];
    if (!("error" in parsed)) {
      for (const spawn of parsed.spawns) {
        if (spawn.type === "nothing") continue;
        testMobs.push({
          x: spawn.x,
          y: spawn.y,
          size: MOB_DEFS[spawn.type].size,
          type: spawn.type,
          range: MOB_DEFS[spawn.type].range,
          dead: false,
        } as Mob);
      }
    }
    const excluded: Point[] = [];
    const eligible: Point[] = [];
    for (const t of msg.tiles) {
      if (checkTileExcluded(t.x, t.y, testMobs, W.region!)) excluded.push(t);
      else eligible.push(t);
    }
    self.postMessage({ type: "exclude-result", excluded, eligible });
    return;
  }

  if (msg.type === "simulate") {
    const tile = msg.tile;
    const loadout = msg.loadout;
    const maxTicks = msg.maxTicks;
    const maxSims = msg.maxSims;
    const seedBase = msg.seedBase;
    const allResults: AutozukResult[] = [];

    const region = W.region!;
    const pillarConfig = W.pillarConfig!;

    for (let s = 0; s < maxSims; s++) {
      const seed = (seedBase ^ (tile.x * 73856093) ^ (tile.y * 19349663) ^ (s * 83492791)) >>> 0;
      const result = hlRunSim(msg.spawnCode, tile, pillarConfig, loadout, maxTicks, region, seed);
      if (result) allResults.push(result);

      if (s === 2 && allResults.length >= 3) {
        const quickPrayer = optimizePrayer(allResults, msg.spawnCode, pillarConfig, loadout);
        const allDead = allResults.every(
          (r) => calcSimDamage(r.attacks, quickPrayer.sequence, loadout, r.mobInitHP).died,
        );
        if (allDead) break;
      }

      if (s === 9 && allResults.length >= 10) {
        const quickPrayer = optimizePrayer(allResults, msg.spawnCode, pillarConfig, loadout);
        const quickDmgs = allResults.map(
          (r) => calcSimDamage(r.attacks, quickPrayer.sequence, loadout, r.mobInitHP).damage,
        );
        const quickAvg = quickDmgs.reduce((a, b) => a + b, 0) / quickDmgs.length;
        if (quickAvg > 80) break;
      }
    }

    if (allResults.length === 0) {
      self.postMessage({ type: "simulate-result", tile, summary: null });
      return;
    }

    const prayer = optimizePrayer(allResults, msg.spawnCode, pillarConfig, loadout);
    const damages: number[] = [];
    const completionTicks: number[] = [];
    let invalidCount = 0;
    let deathCount = 0;

    for (const r of allResults) {
      if (r.status === "invalid") {
        invalidCount++;
        continue;
      }
      const res = calcSimDamage(r.attacks, prayer.sequence, loadout, r.mobInitHP);
      if (res.died) deathCount++;
      damages.push(res.damage);
      completionTicks.push(r.completedTick);
    }

    const deathPct = damages.length > 0 ? (deathCount / damages.length) * 100 : 0;
    const avgDmg = damages.length > 0 ? damages.reduce((a, b) => a + b, 0) / damages.length : 999;
    const over50 = damages.filter((d) => d > 50).length;
    const avgTicks =
      completionTicks.length > 0
        ? completionTicks.reduce((a, b) => a + b, 0) / completionTicks.length
        : maxTicks;
    const isMostlyDead = deathPct > 30;
    const invalidPct = allResults.length > 0 ? (invalidCount / allResults.length) * 100 : 0;
    const isMostlyInvalid = invalidPct > 20;

    const summary: AutozukSummary = {
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
