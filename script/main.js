// =====================================================
// AUTOZUK — solver / worker orchestration + app init
// =====================================================

// ===== PHASE 2: STATE =====
let autozukRunning = false,
  autozukResults = {},
  autozukMode = false,
  autozukHidden = false;
let selectedTile = null,
  excludedTiles = new Set();
let activePrayerSeq = null; // 4-slot prayer sequence for tick grid display
let solverPreviewState = null;
function startSolverVisualPreview(spawnCode, loadout, maxTicks, maxSims, seedBase) {
  stopSolverVisualPreview();
  solverPreviewState = {
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
  solverPreviewState.raf = requestAnimationFrame(tickSolverVisualPreview);
}
function stopSolverVisualPreview() {
  if (!solverPreviewState) return;
  if (solverPreviewState.raf) cancelAnimationFrame(solverPreviewState.raf);
  solverPreviewState = null;
}
function tickSolverVisualPreview(now) {
  let s = solverPreviewState;
  if (!s || !s.running) return;
  if (now - s.lastFrameAt > 52) {
    if (s.frames.length) {
      s.frame = s.frames.shift();
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
function registerSolverVisualPreview(tile, completedTiles) {
  let s = solverPreviewState;
  if (!s || !s.running) return;
  let now = performance.now();
  if (now < s.nextBuildAt && s.frames.length > 12) return;
  s.nextBuildAt = now + 70;
  let simIndex = (completedTiles * 17) % Math.max(1, s.maxSims || 1);
  let frames = buildSolverPreviewFrames(
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
function buildSolverPreviewFrames(spawnCode, tile, loadout, maxTicks, seedBase, simIndex) {
  let pillarConfig = { S: pillars.S, W: pillars.W, N: pillars.N };
  let region = createRegion(pillarConfig);
  let seed = (seedBase ^ (tile.x * 73856093) ^ (tile.y * 19349663) ^ (simIndex * 83492791)) >>> 0;
  let S = hlInitState(spawnCode, tile, pillarConfig, loadout, region, seed);
  if (!S) return [];
  let frames = [],
    sampleTicks = [0, 2, 4, 7, 10, 14, 19, 25],
    limit = Math.min(maxTicks || 25, 25);
  for (let target of sampleTicks) {
    if (target > limit) break;
    while (S.tick < target) hlTick(S);
    frames.push(captureSolverPreviewFrame(S, tile));
    if (S.mobs.every((m) => m.dead)) break;
  }
  return frames;
}
function captureSolverPreviewFrame(S, tile) {
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
class WorkerPool {
  constructor(size, pillarConfig, loadout) {
    this.size = Math.max(1, Math.min(size, 8));
    this.workers = [];
    this.idle = [];
    this.queue = [];
    for (let i = 0; i < this.size; i++) {
      let w = new Worker("autozuk-worker.js");
      w._pending = null;
      w.onmessage = (e) => this._onMessage(w, e.data);
      w.onerror = (e) => {
        console.error("[worker error]", e.message || e);
        if (w._pending) {
          let p = w._pending;
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
  _send(worker, msg) {
    return new Promise((resolve, reject) => {
      worker._pending = { resolve, reject };
      worker.postMessage(msg);
    });
  }
  _onMessage(worker, data) {
    let p = worker._pending;
    worker._pending = null;
    if (p) p.resolve(data);
    this._release(worker);
  }
  _release(worker) {
    if (this.queue.length > 0) {
      let job = this.queue.shift();
      this._send(worker, job.msg).then(job.resolve, job.reject);
    } else {
      this.idle.push(worker);
    }
  }
  async ready() {
    await this.initPromise;
  }
  dispatch(msg) {
    return new Promise((resolve, reject) => {
      if (this.idle.length > 0) {
        let w = this.idle.pop();
        this._send(w, msg).then(resolve, reject);
      } else {
        this.queue.push({ msg, resolve, reject });
      }
    });
  }
  terminate() {
    for (let w of this.workers) w.terminate();
    this.workers = [];
    this.idle = [];
    this.queue = [];
  }
}

// =====================================================
// PHASE 2: BATCH RUNNER
// =====================================================
async function startAutozuk() {
  if (autozukRunning) return;
  if (practiceState.open) closePracticeMode(true);
  if (window._autozukPool) {
    window._autozukPool.terminate();
    window._autozukPool = null;
  }
  stopSolverVisualPreview();
  let code = document.getElementById("spawnCode").value;
  if (!code.trim()) {
    showSpawnCodeError();
    setStatus("Enter a spawn code first", "error");
    return;
  }
  let parsed = parseSpawnCode(code);
  if (parsed.error) {
    setStatus(parsed.error, "error");
    return;
  }

  // Stop any Phase 1 sim and reset tick state
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
  document.getElementById("tickDisplay").innerHTML = "<span>TICK</span><br>—";
  syncStatusBox();

  autozukRunning = true;
  autozukMode = true;
  autozukResults = {};
  excludedTiles = new Set();
  selectedTile = null;
  activePrayerSeq = null;
  autozukHidden = false;
  document.getElementById("btnHideAZ").textContent = "HIDE";
  document.getElementById("btnHideAZ").style.background = "";
  document.getElementById("btnAutozuk").disabled = true;
  document.getElementById("btnAutozuk").textContent = "RUNNING...";
  document.getElementById("detailPanel").classList.add("detail-hidden");
  // Show live detail (replaces tick grid), show feed under canvas, keep event list
  document.getElementById("phase1Panel").style.display = "none";
  document.getElementById("liveDetailPanel").style.display = "flex";
  document.getElementById("liveDetailPanel").innerHTML =
    '<div style="padding:20px;text-align:center;color:var(--text-dim);font-size:11px;font-family:JetBrains Mono,monospace">Excluding tiles...</div>';
  document.getElementById("liveFeedPanel").style.display = "block";
  document.getElementById("liveFeedPanel").innerHTML = "";
  startSolverBuzz();
  let liveFeedEntries = 0;

  let maxSims = parseInt(document.getElementById("maxSims").value) || 400;
  let maxTicks = parseInt(document.getElementById("maxTicks").value) || 400;
  let loadout = currentLoadout;
  // Blood barrage waves take longer to resolve — add 50 ticks
  if (loadout.isBloodBarrage) maxTicks += 50;
  // Reduce tick cap for waves without a mager
  let hasMager = parsed.spawns.some((s) => s.type === "mager");
  if (!hasMager && maxTicks > 150) maxTicks = 150;

  // Build preview mobs for exclusion check
  updatePreview();
  let testMobs = [];
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
  let testRegion = createRegion(pillars);

  // STEP 1: Exclusion sweep (parallel, in workers)
  document.getElementById("autozukStatus").textContent = "Phase 1: Excluding tiles...";
  let allTiles = [];
  for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++)
    for (let x = ARENA_X_MIN; x <= ARENA_X_MAX; x++) allTiles.push({ x, y });

  let poolSize = Math.max(1, Math.min((navigator.hardwareConcurrency || 4) - 1, 8));
  window._autozukPool = new WorkerPool(poolSize, pillars, loadout);
  await window._autozukPool.ready();

  let eligibleTiles = [];
  let chunkSize = Math.max(20, Math.ceil(allTiles.length / (poolSize * 2)));
  let chunks = [];
  for (let i = 0; i < allTiles.length; i += chunkSize)
    chunks.push(allTiles.slice(i, i + chunkSize));
  let excludeCompleted = 0;
  let excludeResults = await Promise.all(
    chunks.map((chunk) => {
      return window._autozukPool
        .dispatch({ type: "exclude", tiles: chunk, spawnCode: code })
        .then((res) => {
          excludeCompleted += chunk.length;
          let pct = Math.floor((excludeCompleted / allTiles.length) * 100);
          document.getElementById("progressFill").style.width = pct * 0.2 + "%";
          document.getElementById("autozukStatus").textContent =
            `Excluding: ${excludeCompleted}/${allTiles.length} tiles checked`;
          return res;
        });
    }),
  );
  for (let res of excludeResults) {
    for (let t of res.excluded) {
      excludedTiles.add(`${t.x},${t.y}`);
      playExclusionBlip();
    }
    for (let t of res.eligible) eligibleTiles.push(t);
  }
  render();

  setStatus(`${eligibleTiles.length} tiles to simulate, ${excludedTiles.size} excluded`, "info");

  // STEP 2: Simulate each eligible tile (parallel, in workers)
  let totalTiles = eligibleTiles.length,
    completedTiles = 0;
  document.getElementById("autozukStatus").textContent =
    `Simulating ${totalTiles} tiles across ${poolSize} workers...`;
  let seedBase = (Date.now() & 0xffffffff) >>> 0;
  startSolverVisualPreview(code, loadout, maxTicks, maxSims, seedBase);

  await Promise.all(
    eligibleTiles.map((tile) => {
      return window._autozukPool
        .dispatch({
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
          let pct = 20 + Math.floor((completedTiles / totalTiles) * 80);
          document.getElementById("progressFill").style.width = pct + "%";
          document.getElementById("autozukStatus").textContent =
            `Simulated ${completedTiles}/${totalTiles} tiles`;
          if (res.summary) {
            let key = `${tile.x},${tile.y}`;
            autozukResults[key] = res.summary;
            playScoreBlip(res.summary.avgDamage);
            registerSolverVisualPreview(tile, completedTiles);
            updateLiveDetail(tile.x, tile.y, res.summary);
            liveFeedEntries++;
            let prayLabels = { mage: "M", range: "R", melee: "X" };
            let displayHeat = autozukHeatValue(res.summary, loadout);
            let dmgRound = autozukScoreText(res.summary, loadout);
            let dmgColor = heatmapColor(displayHeat, 1);
            let prayHtml = [1, 2, 3, 0]
              .map((i) => res.summary.prayer[i])
              .map((p) => `<div class="fp ${p}">${prayLabels[p]}</div>`)
              .join("");
            let barW = Math.min(100, displayHeat);
            let row = document.createElement("div");
            row.className = "feed-row";
            row.style.borderLeftColor = dmgColor;
            let deathLabel = res.summary.markedDead
              ? loadout.isBloodBarrage
                ? " \u2620"
                : ` \u2620${Math.round(res.summary.deathPct)}%`
              : "";
            row.innerHTML = `<span class="feed-tile">(${tile.x},${tile.y})</span><span class="feed-dmg" style="color:${dmgColor}">${dmgRound}${deathLabel}</span><div class="feed-bar"><div class="feed-bar-inner" style="width:${barW}%;background:${dmgColor}"></div></div><div class="feed-prayer">${prayHtml}</div><span class="feed-sims">${res.summary.totalSims}</span>`;
            let feedPanel = document.getElementById("liveFeedPanel");
            feedPanel.appendChild(row);
            feedPanel.scrollTop = feedPanel.scrollHeight;
          }
          render();
        });
    }),
  );

  // Tear down the pool now that the batch is complete
  if (window._autozukPool) {
    window._autozukPool.terminate();
    window._autozukPool = null;
  }
  stopSolverVisualPreview();
  stopSolverBuzz();

  // Done
  autozukRunning = false;
  sim = null;
  syncStatusBox();
  document.getElementById("btnAutozuk").disabled = false;
  document.getElementById("btnAutozuk").textContent = "START AUTOZUK";
  document.getElementById("progressFill").style.width = "100%";
  // Hide live panels, restore tick grid
  document.getElementById("liveDetailPanel").style.display = "none";
  document.getElementById("liveFeedPanel").style.display = "none";
  document.getElementById("phase1Panel").style.display = "";

  // Find best tile. Blood Barrage prioritizes survival first, then HP deficit.
  let bestKey = null,
    bestResult = null;
  for (let key in autozukResults) {
    let result = autozukResults[key];
    if (isBetterAutozukResult(result, bestResult, currentLoadout)) {
      bestResult = result;
      bestKey = key;
    }
  }
  if (bestKey) {
    let [bx, by] = bestKey.split(",").map(Number);
    selectedTile = { x: bx, y: by };
    playerPlacement = { x: bx, y: by };
    activePrayerSeq = autozukResults[bestKey].prayer;
    showTileDetail(bx, by);
    if (currentLoadout.isBloodBarrage) {
      document.getElementById("autozukStatus").textContent =
        `Done! Best tile: (${bx},${by}) — ${bestResult.deathPct.toFixed(1)}% death, avg ${Math.round(bestResult.avgDamage)} max HP deficit`;
      setStatus(
        `Best tile: (${bx},${by}) with ${bestResult.deathPct.toFixed(1)}% death chance`,
        "info",
      );
    } else {
      document.getElementById("autozukStatus").textContent =
        `Done! Best tile: (${bx},${by}) — avg ${Math.round(bestResult.avgDamage)} dmg`;
      setStatus(
        `Best tile: (${bx},${by}) with ~${Math.round(bestResult.avgDamage)} avg dmg`,
        "info",
      );
    }
  } else {
    document.getElementById("autozukStatus").textContent = "Done! No valid tiles found.";
    setStatus("No valid tiles found", "error");
  }
  render();
}
// ===== DEV / EQUIVALENCE HARNESS =====
function __fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
window.__autozukDevTest = function () {
  const scenarios = [
    { code: "MRYBXOOOO", tile: { x: 15, y: 15 }, sims: 20, seed: 1 },
    { code: "MMRRX", tile: { x: 10, y: 10 }, sims: 20, seed: 2 },
    { code: "XXXBB", tile: { x: 20, y: 20 }, sims: 20, seed: 3 },
  ];
  const pillarConfig = { S: true, W: true, N: true };
  const loadout = LOADOUTS.ayak;
  const region = createRegion(pillarConfig);
  let parts = [];
  for (let sc of scenarios) {
    let results = [];
    for (let s = 0; s < sc.sims; s++) {
      let r = hlRunSim(sc.code, sc.tile, pillarConfig, loadout, 400, region, sc.seed * 1000 + s);
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
  let hash = __fnv1a(parts.join("|"));
  console.log("[__autozukDevTest] hash =", hash);
  return hash;
};

// ===== INIT =====
function initApp() {
  window.addEventListener("beforeunload", () => {
    if (window._autozukPool) window._autozukPool.terminate();
  });
  initScrollResizeHandlers();
  initEventHandlers();
  initInputHandlers();
  initializeEquipmentSelector();
  resizeCanvas();
  updatePreview();
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
