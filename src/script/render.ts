// =====================================================
// AUTOZUK — Canvas rendering
// =====================================================

import { state } from "./state.js";
import { FLOOR_RAW } from "./constants.js";
import {
  ARENA_X_MIN,
  ARENA_X_MAX,
  ARENA_Y_MIN,
  ARENA_Y_MAX,
  ARENA_H,
  ARENA_W,
  PILLAR_LOCS,
  MOB_DEFS,
  SPAWN_LOCATIONS,
} from "../sim/constants.js";
import { closestTileTo } from "../sim/pathfinding.js";
import { heatmapBlended, autozukHeatValue, autozukScoreText } from "./heatmap.js";
import { updatePrayerStrip, practiceState } from "./ui.js";
import type { AutozukSummary, Mob, Phase1Sim, PillarKey, SolverPreviewFrame } from "../types.js";

function isDarkColor(c: string): boolean {
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export let facingSouth = true;

function drawFlipText(t: string, x: number, y: number): void {
  if (facingSouth) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, -1);
    ctx.fillText(t, 0, 0);
    ctx.restore();
  } else {
    ctx.fillText(t, x, y);
  }
}

function drawHealthBar(
  bx: number,
  byAbove: number,
  byBelow: number,
  bw: number,
  pct: number,
): void {
  if (facingSouth) {
    // Draw below mob in canvas coords (appears above after flip), counter-rotate fill
    ctx.save();
    ctx.translate(bx + bw / 2, byBelow + 1.5);
    ctx.scale(-1, -1);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(-bw / 2, -1.5, bw, 3);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(-bw / 2, -1.5, Math.max(0, bw * pct), 3);
    ctx.restore();
  } else {
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(bx, byAbove, bw, 3);
    ctx.fillStyle = "#00ff00";
    ctx.fillRect(bx, byAbove, Math.max(0, bw * pct), 3);
  }
}

export const canvas = document.getElementById("grid") as HTMLCanvasElement;
export const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
export let TILE_SIZE = 20;

export function resizeCanvas(): void {
  TILE_SIZE = Math.min(
    Math.floor((window.innerHeight - 70) / ARENA_H),
    Math.floor((window.innerWidth - 720) / ARENA_W),
    24,
  );
  TILE_SIZE = Math.max(TILE_SIZE, 14);
  canvas.width = ARENA_W * TILE_SIZE;
  canvas.height = ARENA_H * TILE_SIZE;
  render();
}

export function toggleCompass(): void {
  facingSouth = !facingSouth;
  (document.getElementById("compassBtn") as HTMLElement).textContent = facingSouth ? "S" : "N";
  render();
}

// =====================================================
// RENDERING (Phase 1 + Phase 2 overlay)
// =====================================================
export function render(): void {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  if (facingSouth) {
    ctx.translate(canvas.width, canvas.height);
    ctx.scale(-1, -1);
  }
  // Floor background from inferno image
  for (let fy = 0; fy < FLOOR_RAW.length && fy < ARENA_H; fy++) {
    for (let fx = 0; fx < FLOOR_RAW[fy].length && fx < ARENA_W; fx++) {
      ctx.fillStyle = FLOOR_RAW[fy][fx];
      ctx.fillRect(fx * TILE_SIZE, fy * TILE_SIZE, TILE_SIZE, TILE_SIZE);
    }
  }
  // Grid lines
  ctx.strokeStyle = "#ffffff08";
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= ARENA_W; x++) {
    ctx.beginPath();
    ctx.moveTo(x * TILE_SIZE, 0);
    ctx.lineTo(x * TILE_SIZE, ARENA_H * TILE_SIZE);
    ctx.stroke();
  }
  for (let y = 0; y <= ARENA_H; y++) {
    ctx.beginPath();
    ctx.moveTo(0, y * TILE_SIZE);
    ctx.lineTo(ARENA_W * TILE_SIZE, y * TILE_SIZE);
    ctx.stroke();
  }

  // Phase 2: heatmap overlay
  if (state.autozukMode && !state.autozukHidden) {
    for (let x = ARENA_X_MIN; x <= ARENA_X_MAX; x++) {
      for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++) {
        const key = `${x},${y}`;
        const px = (x - ARENA_X_MIN) * TILE_SIZE;
        const py = (y - ARENA_Y_MIN) * TILE_SIZE;
        if (state.excludedTiles.has(key)) {
          ctx.fillStyle = "#0a0a0f88";
          ctx.fillRect(px, py, TILE_SIZE, TILE_SIZE);
          ctx.strokeStyle = "#ff000022";
          ctx.lineWidth = 0.5;
          ctx.beginPath();
          ctx.moveTo(px, py);
          ctx.lineTo(px + TILE_SIZE, py + TILE_SIZE);
          ctx.stroke();
          continue;
        }
        const result: AutozukSummary | undefined = state.autozukResults[key];
        if (result) {
          const fx = x - ARENA_X_MIN;
          const fy = y - ARENA_Y_MIN;
          if (result.markedDead) {
            ctx.fillStyle = heatmapBlended(99, fx, fy, 0.9);
            ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            if (TILE_SIZE >= 12) {
              ctx.fillStyle = "#888";
              ctx.font = `bold ${Math.max(8, TILE_SIZE * 0.5)}px JetBrains Mono`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              drawFlipText("\u2620", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
            }
          } else {
            const heat = autozukHeatValue(result);
            ctx.fillStyle = heatmapBlended(heat, fx, fy);
            ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
            if (TILE_SIZE >= 16) {
              ctx.fillStyle = heat > 60 ? "#888" : heat < 20 ? "#000" : "#fff";
              ctx.font = `bold ${Math.max(7, TILE_SIZE * 0.4)}px JetBrains Mono`;
              ctx.textAlign = "center";
              ctx.textBaseline = "middle";
              drawFlipText(autozukScoreText(result), px + TILE_SIZE / 2, py + TILE_SIZE / 2);
            }
          }
        }
      }
    }
    // Highlight selected tile
    if (state.selectedTile) {
      const px = (state.selectedTile.x - ARENA_X_MIN) * TILE_SIZE;
      const py = (state.selectedTile.y - ARENA_Y_MIN) * TILE_SIZE;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  if (!state.sim && (!state.autozukMode || practiceState.open)) {
    const practicePreview = practiceState.open && practiceState.tick < 15;
    for (const pm of state.previewMobs) {
      const s = pm.size;
      ctx.globalAlpha = practicePreview ? 0.28 : 0.7;
      ctx.fillStyle = pm.color;
      ctx.fillRect(
        (pm.x - ARENA_X_MIN) * TILE_SIZE + 1,
        (pm.y - (s - 1) - ARENA_Y_MIN) * TILE_SIZE + 1,
        s * TILE_SIZE - 2,
        s * TILE_SIZE - 2,
      );
      const cx = (pm.x + (s - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2;
      const cy = (pm.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
      ctx.fillStyle = isDarkColor(pm.color) ? "#fff" : "#000";
      ctx.font = `bold ${Math.max(10, Math.min(TILE_SIZE * s * 0.4, 20))}px JetBrains Mono`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      drawFlipText(pm.letter, cx, cy);
      ctx.globalAlpha = 1;
    }
    if (state.previewMobs.length === 0 && !practiceState.open) {
      ctx.globalAlpha = 0.15;
      for (let i = 0; i < SPAWN_LOCATIONS.length; i++) {
        const sp = SPAWN_LOCATIONS[i];
        const sx = (sp.x - ARENA_X_MIN) * TILE_SIZE;
        const sy = (sp.y - ARENA_Y_MIN) * TILE_SIZE;
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(sx, sy, TILE_SIZE, TILE_SIZE);
        ctx.globalAlpha = 0.3;
        ctx.font = `${Math.max(8, TILE_SIZE - 4)}px JetBrains Mono`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        drawFlipText(String(i + 1), sx + TILE_SIZE / 2, sy + TILE_SIZE / 2);
        ctx.globalAlpha = 0.15;
      }
      ctx.globalAlpha = 1;
    }
  }

  // Draw pillars
  for (const key of ["S", "W", "N"] as PillarKey[]) {
    if (!state.pillars[key]) continue;
    const p = PILLAR_LOCS[key];
    let isAlive = true;
    if (state.sim) {
      const rp = state.sim.region.pillars.find((pp) => pp.id === "pillar" + key);
      if (rp && rp.dead) isAlive = false;
    }
    if (!isAlive) continue;
    ctx.fillStyle = "#000000";
    ctx.fillRect(
      (p.x - ARENA_X_MIN) * TILE_SIZE + 1,
      (p.y - (p.size - 1) - ARENA_Y_MIN) * TILE_SIZE + 1,
      p.size * TILE_SIZE - 2,
      p.size * TILE_SIZE - 2,
    );
    ctx.fillStyle = "#ffffff";
    ctx.font = `bold ${Math.max(9, TILE_SIZE - 4)}px JetBrains Mono`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawFlipText(
      key,
      (p.x + 1 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2,
      (p.y - 1 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2,
    );
  }

  if (state.sim) {
    const sim: Phase1Sim = state.sim;
    for (const mob of sim.mobs) {
      if (!mob.dead) drawMob(mob);
    }
    const p = sim.player;
    const px = (p.x - ARENA_X_MIN) * TILE_SIZE;
    const py = (p.y - ARENA_Y_MIN) * TILE_SIZE;
    ctx.fillStyle = "#bb88ff";
    ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(8, TILE_SIZE - 6)}px JetBrains Mono`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawFlipText("P", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
    if (p.aggro && !p.aggro.dead) {
      const ct = closestTileTo(p.aggro, p.x, p.y);
      ctx.strokeStyle = "#ff6b2b88";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(px + TILE_SIZE / 2, py + TILE_SIZE / 2);
      ctx.lineTo(
        (ct.x - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2,
        (ct.y - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2,
      );
      ctx.stroke();
      ctx.setLineDash([]);
    }
    // Blood barrage 3x3 splash visual
    if (p.lastBarrageTarget && sim.tick - p.lastBarrageTarget.tick <= 1) {
      const bt = p.lastBarrageTarget;
      const splashX = (bt.x - 1 - ARENA_X_MIN) * TILE_SIZE;
      const splashY = (bt.y - 1 - ARENA_Y_MIN) * TILE_SIZE;
      ctx.fillStyle = "rgba(255,0,0,0.18)";
      ctx.fillRect(splashX, splashY, TILE_SIZE * 3, TILE_SIZE * 3);
      ctx.strokeStyle = "rgba(255,0,0,0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(splashX, splashY, TILE_SIZE * 3, TILE_SIZE * 3);
    }
    // Pass 2: HP bars on top of everything
    for (const mob of sim.mobs) {
      if (!mob.dead) drawMobHPBar(mob);
    }
    if (p.hp !== undefined && p.hp < p.maxHp) {
      const bx = px;
      const bw = TILE_SIZE;
      drawHealthBar(bx, py - 4, py + TILE_SIZE + 1, bw, Math.max(0, p.hp / p.maxHp));
    }
  }

  if (!state.sim && state.playerPlacement) {
    const px = (state.playerPlacement.x - ARENA_X_MIN) * TILE_SIZE;
    const py = (state.playerPlacement.y - ARENA_Y_MIN) * TILE_SIZE;
    ctx.fillStyle = "#bb88ff88";
    ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(8, TILE_SIZE - 6)}px JetBrains Mono`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawFlipText("P", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  }

  // Draw preview mobs in autozuk mode (when no sim is rendering mobs)
  if (state.autozukMode && !state.sim) {
    const liveFrame = state.solverPreviewState && state.solverPreviewState.frame;
    if (liveFrame) drawSolverPreviewFrame(liveFrame);
    else {
      for (const pm of state.previewMobs) {
        const s = pm.size;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = pm.color;
        ctx.fillRect(
          (pm.x - ARENA_X_MIN) * TILE_SIZE + 1,
          (pm.y - (s - 1) - ARENA_Y_MIN) * TILE_SIZE + 1,
          s * TILE_SIZE - 2,
          s * TILE_SIZE - 2,
        );
        const cx = (pm.x + (s - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2;
        const cy = (pm.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
        ctx.fillStyle = isDarkColor(pm.color) ? "#fff" : "#000";
        ctx.font = `bold ${Math.max(10, Math.min(TILE_SIZE * s * 0.4, 20))}px JetBrains Mono`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        drawFlipText(pm.letter, cx, cy);
        ctx.globalAlpha = 1;
      }
    }
  }
  ctx.restore();
  if (typeof updatePrayerStrip === "function") updatePrayerStrip();
}

function drawMob(mob: Mob): void {
  if (mob.dying > 0) ctx.globalAlpha = 0.14;
  const s = mob.size;
  ctx.fillStyle = mob.color ?? "#fff";
  ctx.fillRect(
    (mob.x - ARENA_X_MIN) * TILE_SIZE + 1,
    (mob.y - (s - 1) - ARENA_Y_MIN) * TILE_SIZE + 1,
    s * TILE_SIZE - 2,
    s * TILE_SIZE - 2,
  );
  const cx = (mob.x + (s - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2;
  const cy = (mob.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
  ctx.fillStyle = isDarkColor(mob.color ?? "#fff") ? "#fff" : "#000";
  ctx.font = `bold ${Math.max(10, Math.min(TILE_SIZE * s * 0.4, 20))}px JetBrains Mono`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawFlipText(mob.letter ?? "?", cx, cy);
  ctx.globalAlpha = 1;
}

function drawMobHPBar(mob: Mob): void {
  if (mob.dying > 0 || mob.hp >= mob.maxHp) return;
  const s = mob.size;
  const bx = (mob.x - ARENA_X_MIN) * TILE_SIZE;
  const bw = s * TILE_SIZE;
  const byAbove = (mob.y - s + 1 - ARENA_Y_MIN) * TILE_SIZE - 4;
  const byBelow = (mob.y - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE + 1;
  drawHealthBar(bx, byAbove, byBelow, bw, mob.hp / mob.maxHp);
}

function drawSolverPreviewFrame(frame: SolverPreviewFrame): void {
  const tx = (frame.tile.x - ARENA_X_MIN) * TILE_SIZE;
  const ty = (frame.tile.y - ARENA_Y_MIN) * TILE_SIZE;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([Math.max(3, TILE_SIZE * 0.35), Math.max(2, TILE_SIZE * 0.18)]);
  ctx.strokeRect(tx + 1, ty + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.setLineDash([]);
  const aggroMob = frame.mobs.find((m) => m.id === frame.player.aggroId);
  if (aggroMob) {
    const pcx = (frame.player.x - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2;
    const pcy = (frame.player.y - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
    const mcx = (aggroMob.x + (aggroMob.size - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2;
    const mcy = (aggroMob.y - (aggroMob.size - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
    ctx.strokeStyle = "rgba(255,107,43,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pcx, pcy);
    ctx.lineTo(mcx, mcy);
    ctx.stroke();
  }
  for (const mob of frame.mobs) {
    const d = MOB_DEFS[mob.type];
    if (!d) continue;
    const s = mob.size;
    const alpha = mob.dying > 0 ? 0.25 : 0.82;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = d.color;
    ctx.fillRect(
      (mob.x - ARENA_X_MIN) * TILE_SIZE + 1,
      (mob.y - (s - 1) - ARENA_Y_MIN) * TILE_SIZE + 1,
      s * TILE_SIZE - 2,
      s * TILE_SIZE - 2,
    );
    if (mob.hasLOS || mob.flickering) {
      ctx.strokeStyle = mob.flickering ? "#ffffff" : "rgba(255,255,255,0.45)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(
        (mob.x - ARENA_X_MIN) * TILE_SIZE + 1.5,
        (mob.y - (s - 1) - ARENA_Y_MIN) * TILE_SIZE + 1.5,
        s * TILE_SIZE - 3,
        s * TILE_SIZE - 3,
      );
    }
    const cx = (mob.x + (s - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2;
    const cy = (mob.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
    ctx.fillStyle = isDarkColor(d.color) ? "#fff" : "#000";
    ctx.font = `bold ${Math.max(10, Math.min(TILE_SIZE * s * 0.4, 20))}px JetBrains Mono`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawFlipText(d.letter, cx, cy);
  }
  ctx.globalAlpha = 0.88;
  const px = (frame.player.x - ARENA_X_MIN) * TILE_SIZE;
  const py = (frame.player.y - ARENA_Y_MIN) * TILE_SIZE;
  ctx.fillStyle = "#bb88ff";
  ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.fillStyle = "#fff";
  ctx.font = `bold ${Math.max(8, TILE_SIZE - 6)}px JetBrains Mono`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawFlipText("P", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  ctx.globalAlpha = 1;
  ctx.restore();
}
