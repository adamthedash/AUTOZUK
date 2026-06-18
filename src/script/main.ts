// =====================================================
// AUTOZUK — solver / worker orchestration + app init
// =====================================================

import { state } from "./state.js";
import {
  ARENA_X_MIN,
  ARENA_X_MAX,
  ARENA_Y_MIN,
  ARENA_Y_MAX,
  MOB_DEFS,
  LOADOUTS,
} from "../sim/constants.js";
import { createRegion, parseSpawnCode, hlRunSim, hlInitState, hlTick } from "../sim/main.js";
import {
  initScrollResizeHandlers,
  initEventHandlers,
  initInputHandlers,
  initializeEquipmentSelector,
  updateLiveDetail,
  showTileDetail,
  syncStatusBox,
  showSpawnCodeError,
  setStatus,
  updatePreview,
  closePracticeMode,
} from "./ui.js";
import { stopPlay } from "./sim.js";
import { render } from "./render.js";
import {
  isBetterAutozukResult,
  autozukHeatValue,
  autozukScoreText,
  heatmapColor,
} from "./heatmap.js";
import { startSolverBuzz, stopSolverBuzz, playExclusionBlip, playScoreBlip } from "./audio.js";
import type {
  AutozukSummary,
  HeadlessSim,
  Loadout,
  MobType,
  PillarConfig,
  SolverPreviewFrame,
  Tile,
  WorkerRequest,
  WorkerResponse,
} from "../types.js";

// ===== PHASE 2: STATE =====
state.autozukRunning = false;
state.autozukResults = {};
state.autozukMode = false;
state.autozukHidden = false;
state.selectedTile = null;
state.excludedTiles = new Set();
state.activePrayerSeq = null; // 4-slot prayer sequence for tick grid display
state.solverPreviewState = null;

export function startSolverVisualPreview(
  spawnCode: string,
  loadout: Loadout,
  maxTicks: number,
  maxSims: number,
  seedBase: number,
): void {
  stopSolverVisualPreview();
  state.solverPreviewState = {
    running: true,
    spawnCode,
    loadout,
    maxTicks,
    maxSims,
    seedBase,
    frames: [],
    frame: null,
    lastFrameAt: 0,
    nextBuildAt: 0,
    raf: 0,
  };
  state.solverPreviewState.raf = requestAnimationFrame(tickSolverVisualPreview);
}

export function stopSolverVisualPreview(): void {
  if (!state.solverPreviewState) return;
  if (state.solverPreviewState.raf) cancelAnimationFrame(state.solverPreviewState.raf);
  state.solverPreviewState = null;
}

export function tickSolverVisualPreview(now: number): void {
  const s = state.solverPreviewState;
  if (!s || !s.running) return;
  if (now - s.lastFrameAt > 52) {
    if (s.frames.length) {
      s.frame = s.frames.shift() || null;
      s.lastFrameAt = now;
      render();
    } else if (s.frame && now - s.lastFrameAt > 160) {
      s.frame = null;
      s.lastFrameAt = now;
      render();
    }
  }
  s.raf = requestAnimationFrame(tickSolverVisualPreview);
}

export function registerSolverVisualPreview(tile: Tile, completedTiles: number): void {
  const s = state.solverPreviewState;
  if (!s || !s.running) return;
  const now = performance.now();
  if (now < s.nextBuildAt && s.frames.length > 12) return;
  s.nextBuildAt = now + 70;
  const simIndex = (completedTiles * 17) % Math.max(1, s.maxSims || 1);
  const frames = buildSolverPreviewFrames(
    s.spawnCode,
    tile,
    s.loadout,
    s.maxTicks,
    s.seedBase,
    simIndex,
  );
  if (!frames.length) return;
  s.frames.push(...frames);
  if (s.frames.length > 36) s.frames.splice(0, s.frames.length - 36);
}

export function buildSolverPreviewFrames(
  spawnCode: string,
  tile: Tile,
  loadout: Loadout,
  maxTicks: number,
  seedBase: number,
  simIndex: number,
): SolverPreviewFrame[] {
  const pillarConfig: PillarConfig = { S: state.pillars.S, W: state.pillars.W, N: state.pillars.N };
  const region = createRegion(pillarConfig);
  const seed = (seedBase ^ (tile.x * 73856093) ^ (tile.y * 19349663) ^ (simIndex * 83492791)) >>> 0;
  const S = hlInitState(spawnCode, tile, pillarConfig, loadout, region, seed);
  if (!S) return [];
  const frames: SolverPreviewFrame[] = [];
  const sampleTicks = [0, 2, 4, 7, 10, 14, 19, 25];
  const limit = Math.min(maxTicks || 25, 25);
  for (const target of sampleTicks) {
    if (target > limit) break;
    while (S.tick < target) hlTick(S);
    frames.push(captureSolverPreviewFrame(S, tile));
    if (S.mobs.every((m) => m.dead)) break;
  }
  return frames;
}

export function captureSolverPreviewFrame(S: HeadlessSim, tile: Tile): SolverPreviewFrame {
  return {
    tile: { x: tile.x, y: tile.y },
    tick: S.tick,
    player: { x: S.player.x, y: S.player.y, aggroId: S.player.aggro ? S.player.aggro.id : null },
    mobs: S.mobs
      .filter((m) => !m.dead)
      .map((m) => ({
        id: m.id,
        type: m.type,
        x: m.x,
        y: m.y,
        size: m.size,
        hp: m.hp,
        maxHp: m.maxHp,
        dying: m.dying,
        hasLOS: m.hasLOS,
        flickering: m.flickering,
      })),
  };
}

// =====================================================
// WORKER POOL
// =====================================================
interface PendingCallback {
  resolve: (data: WorkerResponse) => void;
  reject: (reason?: unknown) => void;
}

interface AutozukWorker extends Worker {
  _pending: PendingCallback | null;
}

interface QueuedJob {
  msg: WorkerRequest;
  resolve: (data: WorkerResponse) => void;
  reject: (reason?: unknown) => void;
}

class WorkerPool {
  size: number;
  workers: AutozukWorker[];
  idle: AutozukWorker[];
  queue: QueuedJob[];
  initPromise: Promise<WorkerResponse[]>;

  constructor(size: number, pillarConfig: PillarConfig, loadout: Loadout) {
    this.size = Math.max(1, Math.min(size, 8));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    for (let i = 0; i < this.size; i++) {
      const w = new Worker(new URL("../autozuk-worker.ts", import.meta.url), {
        type: "module",
      }) as AutozukWorker;
      w._pending = null;
      w.onmessage = (e: MessageEvent<WorkerResponse>) => this._onMessage(w, e.data);
      w.onerror = (e: ErrorEvent) => {
        console.error("[worker error]", e.message || e);
        if (w._pending) {
          const p = w._pending;
          w._pending = null;
          p.reject(e);
          this._release(w);
        }
      };
      this.workers.push(w);
    }
    this.initPromise = Promise.all(
      this.workers.map((w) => this._send(w, { type: "init", pillarConfig, loadout })),
    );
  }

  _send(worker: AutozukWorker, msg: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      worker._pending = { resolve, reject };
      worker.postMessage(msg);
    });
  }

  _onMessage(worker: AutozukWorker, data: WorkerResponse): void {
    const p = worker._pending;
    worker._pending = null;
    if (p) p.resolve(data);
    this._release(worker);
  }

  _release(worker: AutozukWorker): void {
    if (this.queue.length > 0) {
      const job = this.queue.shift()!;
      this._send(worker, job.msg).then(job.resolve, job.reject);
    } else {
      this.idle.push(worker);
    }
  }

  async ready(): Promise<void> {
    await this.initPromise;
  }

  dispatch(msg: WorkerRequest): Promise<WorkerResponse> {
    return new Promise((resolve, reject) => {
      if (this.idle.length > 0) {
        const w = this.idle.pop()!;
        this._send(w, msg).then(resolve, reject);
      } else {
        this.queue.push({ msg, resolve, reject });
      }
    });
  }

  terminate(): void {
    for (const w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
  }
}

// =====================================================
// PHASE 2: BATCH RUNNER
// =====================================================
export async function startAutozuk(): Promise<void> {
  if (state.autozukRunning) return;
  if (closePracticeMode) closePracticeMode(true);
  if (window._autozukPool) {
    window._autozukPool.terminate();
    window._autozukPool = undefined;
  }
  stopSolverVisualPreview();
  const spawnInput = document.getElementById("spawnCode") as HTMLInputElement | null;
  const code = spawnInput?.value ?? "";
  if (!code.trim()) {
    showSpawnCodeError();
    setStatus("Enter a spawn code first", "error");
    return;
  }
  const parsed = parseSpawnCode(code);
  if ("error" in parsed) {
    setStatus(parsed.error, "error");
    return;
  }

  // Stop any Phase 1 sim and reset tick state
  stopPlay();
  state.sim = null;
  state.tickEvents = [];
  state.tickHits = {};
  state.gridMobColumns = [];
  state.tickGridUserScrolled = false;
  state.eventListUserScrolled = false;
  const tickGridHead = document.getElementById("tickGridHead");
  if (tickGridHead) tickGridHead.innerHTML = '<tr><th class="tick-col">T</th></tr>';
  const tickGridBody = document.getElementById("tickGridBody");
  if (tickGridBody) tickGridBody.innerHTML = "";
  const tickGridCount = document.getElementById("tickGridCount");
  if (tickGridCount) tickGridCount.textContent = "0 hits";
  const tickDisplay = document.getElementById("tickDisplay");
  if (tickDisplay) tickDisplay.innerHTML = "<span>TICK</span><br>—";
  syncStatusBox();

  state.autozukRunning = true;
  state.autozukMode = true;
  state.autozukResults = {};
  state.excludedTiles = new Set();
  state.selectedTile = null;
  state.activePrayerSeq = null;
  state.autozukHidden = false;
  const btnHideAZ = document.getElementById("btnHideAZ");
  if (btnHideAZ) {
    btnHideAZ.textContent = "HIDE";
    (btnHideAZ as HTMLElement).style.background = "";
  }
  const btnAutozuk = document.getElementById("btnAutozuk");
  if (btnAutozuk) {
    (btnAutozuk as HTMLButtonElement).disabled = true;
    btnAutozuk.textContent = "RUNNING...";
  }
  document.getElementById("detailPanel")?.classList.add("detail-hidden");
  // Show live detail (replaces tick grid), show feed under canvas, keep event list
  const phase1Panel = document.getElementById("phase1Panel");
  if (phase1Panel) phase1Panel.style.display = "none";
  const liveDetailPanel = document.getElementById("liveDetailPanel");
  if (liveDetailPanel) {
    liveDetailPanel.style.display = "flex";
    liveDetailPanel.innerHTML =
      '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:11px;font-family:JetBrains Mono,monospace">Excluding tiles...</div>';
  }
  const liveFeedPanel = document.getElementById("liveFeedPanel");
  if (liveFeedPanel) {
    liveFeedPanel.style.display = "block";
    liveFeedPanel.innerHTML = "";
  }
  startSolverBuzz();

  const maxSimsInput = document.getElementById("maxSims") as HTMLInputElement | null;
  const maxTicksInput = document.getElementById("maxTicks") as HTMLInputElement | null;
  let maxSims = parseInt(maxSimsInput?.value ?? "") || 400;
  let maxTicks = parseInt(maxTicksInput?.value ?? "") || 400;
  const loadout = state.currentLoadout!;
  // Blood barrage waves take longer to resolve — add 50 ticks
  if (loadout.isBloodBarrage) maxTicks += 50;
  // Reduce tick cap for waves without a mager
  const hasMager = parsed.spawns.some((s) => s.type === "mager");
  if (!hasMager && maxTicks > 150) maxTicks = 150;

  // Build preview mobs for exclusion check
  updatePreview();
  const testMobs: Array<{
    x: number;
    y: number;
    size: number;
    type: MobType;
    range: number;
    dead: boolean;
  }> = [];
  for (const spawn of parsed.spawns) {
    if (spawn.type === "nothing") continue;
    const d = MOB_DEFS[spawn.type];
    testMobs.push({
      x: spawn.x,
      y: spawn.y,
      size: d.size,
      type: spawn.type,
      range: d.range,
      dead: false,
    });
  }

  // STEP 1: Exclusion sweep (parallel, in workers)
  const autozukStatus = document.getElementById("autozukStatus");
  if (autozukStatus) autozukStatus.textContent = "Phase 1: Excluding tiles...";
  const allTiles: Tile[] = [];
  for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++)
    for (let x = ARENA_X_MIN; x <= ARENA_X_MAX; x++) allTiles.push({ x, y });

  const poolSize = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  window._autozukPool = new WorkerPool(poolSize, state.pillars, loadout);
  await window._autozukPool.ready();

  const eligibleTiles: Tile[] = [];
  const chunkSize = Math.max(20, Math.ceil(allTiles.length / (poolSize * 2)));
  const chunks: Tile[][] = [];
  for (let i = 0; i < allTiles.length; i += chunkSize)
    chunks.push(allTiles.slice(i, i + chunkSize));
  let excludeCompleted = 0;
  const excludeResults = await Promise.all(
    chunks.map((chunk) => {
      return window
        ._autozukPool!.dispatch({ type: "exclude", tiles: chunk, spawnCode: code })
        .then((res) => {
          const r = res as Extract<WorkerResponse, { type: "exclude-result" }>;
          excludeCompleted += chunk.length;
          const pct = Math.floor((excludeCompleted / allTiles.length) * 100);
          const progressFill = document.getElementById("progressFill");
          if (progressFill) (progressFill as HTMLElement).style.width = pct * 0.2 + "%";
          if (autozukStatus)
            autozukStatus.textContent = `Excluding: ${excludeCompleted}/${allTiles.length} tiles checked`;
          return r;
        });
    }),
  );
  for (const res of excludeResults) {
    for (const t of res.excluded) {
      state.excludedTiles.add(`${t.x},${t.y}`);
      playExclusionBlip();
    }
    for (const t of res.eligible) eligibleTiles.push(t);
  }
  render();

  setStatus(
    `${eligibleTiles.length} tiles to simulate, ${state.excludedTiles.size} excluded`,
    "info",
  );

  // STEP 2: Simulate each eligible tile (parallel, in workers)
  const totalTiles = eligibleTiles.length;
  let completedTiles = 0;
  if (autozukStatus)
    autozukStatus.textContent = `Simulating ${totalTiles} tiles across ${poolSize} workers...`;
  const seedBase = (Date.now() & 0xffffffff) >>> 0;
  startSolverVisualPreview(code, loadout, maxTicks, maxSims, seedBase);

  await Promise.all(
    eligibleTiles.map((tile) => {
      return window
        ._autozukPool!.dispatch({
          type: "simulate",
          tile,
          spawnCode: code,
          loadout,
          maxTicks,
          maxSims,
          seedBase,
        })
        .then((res) => {
          completedTiles++;
          const pct = 20 + Math.floor((completedTiles / totalTiles) * 80);
          const progressFill = document.getElementById("progressFill");
          if (progressFill) (progressFill as HTMLElement).style.width = pct + "%";
          if (autozukStatus)
            autozukStatus.textContent = `Simulated ${completedTiles}/${totalTiles} tiles`;
          const r = res as Extract<WorkerResponse, { type: "simulate-result" }>;
          if (r.summary) {
            const key = `${tile.x},${tile.y}`;
            state.autozukResults[key] = r.summary;
            playScoreBlip(r.summary.avgDamage);
            registerSolverVisualPreview(tile, completedTiles);
            updateLiveDetail(tile.x, tile.y, r.summary);
            const prayLabels = { mage: "M", range: "R", melee: "X" };
            const displayHeat = autozukHeatValue(r.summary, loadout);
            const dmgRound = autozukScoreText(r.summary, loadout);
            const dmgColor = heatmapColor(displayHeat, 1);
            const prayHtml = [1, 2, 3, 0]
              .map((i) => r.summary!.prayer[i])
              .map((p) => `<div class="fp ${p}">${prayLabels[p]}</div>`)
              .join("");
            const barW = Math.min(100, displayHeat);
            const row = document.createElement("div");
            row.className = "feed-row";
            row.style.borderLeftColor = dmgColor;
            const deathLabel = r.summary.markedDead
              ? loadout.isBloodBarrage
                ? " \u2620"
                : ` \u2620${Math.round(r.summary.deathPct)}%`
              : "";
            row.innerHTML = `<span class="feed-tile">(${tile.x},${tile.y})</span><span class="feed-dmg" style="color:${dmgColor}">${dmgRound}${deathLabel}</span><div class="feed-bar"><div class="feed-bar-inner" style="width:${barW}%;background:${dmgColor}"></div></div><div class="feed-prayer">${prayHtml}</div><span class="feed-sims">${r.summary.totalSims}</span>`;
            const feedPanel = document.getElementById("liveFeedPanel");
            if (feedPanel) {
              feedPanel.appendChild(row);
              feedPanel.scrollTop = feedPanel.scrollHeight;
            }
          }
          render();
        });
    }),
  );

  // Tear down the pool now that the batch is complete
  if (window._autozukPool) {
    window._autozukPool.terminate();
    window._autozukPool = undefined;
  }
  stopSolverVisualPreview();
  stopSolverBuzz();

  // Done
  state.autozukRunning = false;
  state.sim = null;
  syncStatusBox();
  if (btnAutozuk) {
    (btnAutozuk as HTMLButtonElement).disabled = false;
    btnAutozuk.textContent = "START AUTOZUK";
  }
  const progressFill = document.getElementById("progressFill");
  if (progressFill) (progressFill as HTMLElement).style.width = "100%";
  // Hide live panels, restore tick grid
  if (liveDetailPanel) liveDetailPanel.style.display = "none";
  if (liveFeedPanel) liveFeedPanel.style.display = "none";
  if (phase1Panel) phase1Panel.style.display = "";

  // Find best tile. Blood Barrage prioritizes survival first, then HP deficit.
  let bestKey: string | null = null;
  let bestResult: AutozukSummary | null = null;
  for (const key in state.autozukResults) {
    const result = state.autozukResults[key];
    if (isBetterAutozukResult(result, bestResult, state.currentLoadout)) {
      bestResult = result;
      bestKey = key;
    }
  }
  if (bestKey && bestResult) {
    const [bx, by] = bestKey.split(",").map(Number);
    state.selectedTile = { x: bx, y: by };
    state.playerPlacement = { x: bx, y: by };
    state.activePrayerSeq = state.autozukResults[bestKey].prayer;
    showTileDetail(bx, by);
    if (state.currentLoadout?.isBloodBarrage) {
      if (autozukStatus)
        autozukStatus.textContent = `Done! Best tile: (${bx},${by}) — ${bestResult.deathPct.toFixed(1)}% death, avg ${Math.round(bestResult.avgDamage)} max HP deficit`;
      setStatus(
        `Best tile: (${bx},${by}) with ${bestResult.deathPct.toFixed(1)}% death chance`,
        "info",
      );
    } else {
      if (autozukStatus)
        autozukStatus.textContent = `Done! Best tile: (${bx},${by}) — avg ${Math.round(bestResult.avgDamage)} dmg`;
      setStatus(
        `Best tile: (${bx},${by}) with ~${Math.round(bestResult.avgDamage)} avg dmg`,
        "info",
      );
    }
  } else {
    if (autozukStatus) autozukStatus.textContent = "Done! No valid tiles found.";
    setStatus("No valid tiles found", "error");
  }
  render();
}

// ===== DEV / EQUIVALENCE HARNESS =====
function __fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

window.__autozukDevTest = function (): string {
  const scenarios = [
    { code: "MRYBXOOOO", tile: { x: 15, y: 15 }, sims: 20, seed: 1 },
    { code: "MMRRX", tile: { x: 10, y: 10 }, sims: 20, seed: 2 },
    { code: "XXXBB", tile: { x: 20, y: 20 }, sims: 20, seed: 3 },
  ];
  const pillarConfig: PillarConfig = { S: true, W: true, N: true };
  const loadout = LOADOUTS.ayak;
  const region = createRegion(pillarConfig);
  const parts: string[] = [];
  for (const sc of scenarios) {
    const results = [];
    for (let s = 0; s < sc.sims; s++) {
      const r = hlRunSim(sc.code, sc.tile, pillarConfig, loadout, 400, region, sc.seed * 1000 + s);
      if (!r) {
        parts.push("null");
        continue;
      }
      results.push({
        t: r.completedTick,
        st: r.status,
        n: r.attacks.length,
        a: r.attacks
          .map(
            (a) =>
              `${a.tick}|${a.mobId ?? ""}|${a.style ?? ""}|${a.isPlayerAttack ? "P" : ""}|${a.hitTick ?? ""}|${a.dmgRoll ? Math.floor(a.dmgRoll * 1000) : ""}|${a.accRoll ? Math.floor(a.accRoll * 1000) : ""}`,
          )
          .join(","),
      });
    }
    parts.push(JSON.stringify(results));
  }
  const hash = __fnv1a(parts.join("|"));
  console.log("[__autozukDevTest] hash =", hash);
  return hash;
};

// ===== INIT =====
function initApp(): void {
  window.addEventListener("beforeunload", () => {
    if (window._autozukPool) window._autozukPool.terminate();
  });
  initScrollResizeHandlers();
  initEventHandlers();
  initInputHandlers();
  initializeEquipmentSelector();
  renderMod.resizeCanvas();
  updatePreview();
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}

// Expose functions referenced by inline HTML event handlers.
import * as sim from "./sim.js";
import * as gear from "./gear.js";
import * as ui from "./ui.js";
import * as renderMod from "./render.js";

Object.assign(window, {
  pasteSpawnCode: ui.pasteSpawnCode,
  randomSpawnCode: ui.randomSpawnCode,
  togglePillar: ui.togglePillar,
  stepTick: sim.stepTick,
  togglePlay: sim.togglePlay,
  resetSim: sim.resetSim,
  startAutozuk,
  resetAutozuk: ui.resetAutozuk,
  toggleHideAutozuk: ui.toggleHideAutozuk,
  toggleCompass: renderMod.toggleCompass,
  clickPracticePrayer: ui.clickPracticePrayer,
  openPracticeMode: ui.openPracticeMode,
  closePracticeMode: ui.closePracticeMode,
  exportTilemarker: ui.exportTilemarker,
  toggleLegend: ui.toggleLegend,
  openEquipmentSelector: ui.openEquipmentSelector,
  applyGearStats: ui.applyGearStats,
  closeEquipmentSelector: ui.closeEquipmentSelector,
  changeLoadout: ui.changeLoadout,
  recalculateGearDraft: gear.recalculateGearDraft,
  closeTileDetail: ui.closeTileDetail,
});

declare global {
  interface Window {
    _autozukPool?: WorkerPool | undefined;
    __autozukDevTest?: (() => string) | undefined;
  }
}
