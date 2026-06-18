// =====================================================
// AUTOZUK — UI layer
// =====================================================

import { state } from "./state.js";
import {
  DEFAULT_GEAR_CONFIGS,
  GEAR_SLOTS,
  GEAR_LABELS,
  GEAR_PRAYERS,
  MAGIC_BOOSTS,
  DEF_BOOSTS,
  WIKI_EQUIPMENT_URL,
  PLAYER_ACCURACY_TARGETS,
  PLAYER_ACCURACY_LABELS,
  INCOMING_ACCURACY_ROWS,
  PRAYER_IMG_DATA,
  PRACTICE_PRAYERS,
} from "./constants.js";
import {
  MOB_DEFS,
  ARENA_X_MIN,
  ARENA_X_MAX,
  ARENA_Y_MIN,
  ARENA_Y_MAX,
  LOADOUTS,
} from "../sim/constants.js";
import { parseSpawnCode } from "../sim/main.js";
import {
  syncSharedGearConfig,
  calculateGearDraft,
  wikiItemLabel,
  resolveWikiItem,
  getLiveIncomingAcc,
  setLiveIncomingAcc,
  formatPctInput,
  formatPctDisplay,
  parsePctInput,
  currentMagicLevel,
  currentDefLevel,
  clampStat,
  clampHp,
  cloneGearConfig,
  clamp01,
} from "./gear.js";
import { simulateTick, initSim, resetSim, stopPlay, startPlay } from "./sim.js";
import { render, resizeCanvas, canvas, TILE_SIZE, facingSouth } from "./render.js";
import { playPracticePrayerSound } from "./audio.js";
import { histogramColor } from "./heatmap.js";
import { stopSolverVisualPreview } from "./main.js";
import type {
  AutozukSummary,
  GearConfig,
  GearDraftStats,
  PillarKey,
  Point,
  Prayer,
  PrayerSequence,
  WikiEquipment,
} from "../types.js";

export function htmlEscape(text: string | number | boolean | null | undefined): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function editorNumber(id: string, fallback = 99): number {
  const value = Number((document.getElementById(id) as HTMLInputElement | null)?.value);
  return Number.isFinite(value) ? value : fallback;
}

export function getSelectedGear(): Record<string, string> {
  const gear: Record<string, string> = {};
  for (const slot of GEAR_SLOTS) {
    const input = document.getElementById("gear-slot-" + slot) as HTMLInputElement | null;
    gear[slot] = input?.value.trim() || "";
  }
  return gear;
}

export function populateGearStaticControls(): void {
  const prayer = document.getElementById("gearPrayer") as HTMLSelectElement | null;
  const magic = document.getElementById("gearMagicBoost") as HTMLSelectElement | null;
  const def = document.getElementById("gearDefBoost") as HTMLSelectElement | null;
  if (prayer && !prayer.options.length)
    for (const [key, value] of Object.entries(GEAR_PRAYERS)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      prayer.appendChild(option);
    }
  if (magic && !magic.options.length)
    for (const [key, value] of Object.entries(MAGIC_BOOSTS)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      magic.appendChild(option);
    }
  if (def && !def.options.length)
    for (const [key, value] of Object.entries(DEF_BOOSTS)) {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      def.appendChild(option);
    }
  renderGearSlots();
}

export function renderGearSlots(): void {
  const container = document.getElementById("gearSlots");
  if (!container) return;
  if (container.childNodes.length === 0) {
    for (const slot of GEAR_SLOTS) {
      const field = document.createElement("div");
      field.className = "gear-field" + (slot === "weapon" ? " weapon-slot" : "");
      const label = document.createElement("label");
      label.textContent = GEAR_LABELS[slot];
      const input = document.createElement("input");
      input.id = "gear-slot-" + slot;
      input.type = "text";
      input.placeholder = "None";
      input.setAttribute("list", "wiki-slot-" + slot);
      input.addEventListener("input", () => {
        if (!state.isRenderingGear) recalculateGearDraft();
      });
      const list = document.createElement("datalist");
      list.id = "wiki-slot-" + slot;
      field.append(label, input, list);
      container.appendChild(field);
    }
  }
  if (!state.wikiEquipment.length) return;
  for (const slot of GEAR_SLOTS) {
    const list = document.getElementById("wiki-slot-" + slot);
    if (!list) continue;
    list.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const item of state.wikiEquipment.filter((i) => i.slot === slot)) {
      const option = document.createElement("option");
      option.value = wikiItemLabel(item);
      fragment.appendChild(option);
    }
    list.appendChild(fragment);
  }
}

export function validateGearAgainstWiki(config: GearConfig): void {
  if (!state.wikiEquipment.length) return;
  for (const slot of GEAR_SLOTS) {
    const label = config.gear[slot];
    if (label && !resolveWikiItem(label)) config.gear[slot] = "";
  }
}

export async function loadWikiGearData(): Promise<void> {
  if (state.wikiEquipment.length) {
    renderGearSlots();
    recalculateGearDraft();
    return;
  }
  if (state.wikiLoadStarted) return;
  state.wikiLoadStarted = true;
  try {
    const data = window.autozukDesktop?.getWikiEquipment
      ? await window.autozukDesktop.getWikiEquipment()
      : await fetch(WIKI_EQUIPMENT_URL).then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json() as Promise<WikiEquipment[] | Record<string, WikiEquipment>>;
        });
    state.wikiEquipment = (Array.isArray(data) ? data : Object.values(data || {})).filter(
      (item): item is WikiEquipment => !!(item?.name && GEAR_SLOTS.includes(item.slot)),
    );
    state.wikiEquipment.sort((a, b) => wikiItemLabel(a).localeCompare(wikiItemLabel(b)));
    for (const key in state.gearConfigs) validateGearAgainstWiki(state.gearConfigs[key]);
    renderGearSlots();
    renderGearDraft(state.currentLoadoutKey);
  } catch (error: unknown) {
    state.wikiLoadStarted = false;
    renderGearStatsPanel(null, error instanceof Error ? error.message : String(error));
  }
}

export function getEditorGearConfig(): GearConfig {
  return {
    levels: {
      magic: clampStat(editorNumber("gearLvlMagic", 99)),
      def: clampStat(editorNumber("gearLvlDef", 99)),
      hp: clampHp(editorNumber("gearLvlHp", 99)),
    },
    prayer: (document.getElementById("gearPrayer") as HTMLSelectElement | null)?.value || "augury",
    magicBoost:
      (document.getElementById("gearMagicBoost") as HTMLSelectElement | null)?.value || "none",
    defBoost:
      (document.getElementById("gearDefBoost") as HTMLSelectElement | null)?.value || "brew",
    gear: getSelectedGear(),
  };
}

export function renderGearDraft(key = state.currentLoadoutKey): void {
  const config =
    state.gearConfigs[key] ||
    cloneGearConfig(DEFAULT_GEAR_CONFIGS[key] || DEFAULT_GEAR_CONFIGS.ayak);
  state.gearConfigs[key] = config;
  state.isRenderingGear = true;
  const magic = document.getElementById("gearLvlMagic") as HTMLInputElement | null;
  const def = document.getElementById("gearLvlDef") as HTMLInputElement | null;
  const hp = document.getElementById("gearLvlHp") as HTMLInputElement | null;
  const prayer = document.getElementById("gearPrayer") as HTMLSelectElement | null;
  const magicBoost = document.getElementById("gearMagicBoost") as HTMLSelectElement | null;
  const defBoost = document.getElementById("gearDefBoost") as HTMLSelectElement | null;
  if (magic) magic.value = String(config.levels?.magic ?? 99);
  if (def) def.value = String(config.levels?.def ?? 99);
  if (hp) hp.value = String(config.levels?.hp ?? 99);
  if (prayer) prayer.value = config.prayer || "augury";
  if (magicBoost) magicBoost.value = config.magicBoost || "none";
  if (defBoost) defBoost.value = config.defBoost || "brew";
  for (const slot of GEAR_SLOTS) {
    const input = document.getElementById("gear-slot-" + slot) as HTMLInputElement | null;
    if (input) input.value = config.gear?.[slot] || "";
  }
  state.isRenderingGear = false;
  recalculateGearDraft();
}

export function recalculateGearDraft(): void {
  if (state.isRenderingGear) return;
  if (!document.getElementById("gearStatsPanel")) return;
  const config = syncSharedGearConfig(state.currentLoadoutKey, getEditorGearConfig());
  const magicCurrent = document.getElementById("gearCurrentMagic");
  const defCurrent = document.getElementById("gearCurrentDef");
  if (magicCurrent)
    magicCurrent.textContent = String(currentMagicLevel(config.levels.magic, config.magicBoost));
  if (defCurrent)
    defCurrent.textContent = String(currentDefLevel(config.levels.def, config.defBoost));
  try {
    state.gearDraftStats = calculateGearDraft(config, state.currentLoadoutKey);
    renderGearStatsPanel(state.gearDraftStats);
  } catch (error: unknown) {
    state.gearDraftStats = null;
    renderGearStatsPanel(null, error instanceof Error ? error.message : String(error));
  }
}

export function renderGearStatsPanel(draft: GearDraftStats | null, errorMessage?: string): void {
  const panel = document.getElementById("gearStatsPanel");
  if (!panel) return;
  const loadout = LOADOUTS[state.currentLoadoutKey as keyof typeof LOADOUTS] || LOADOUTS.ayak;
  renderSpecialEffects(draft);
  const title = errorMessage
    ? `<div class="gear-note" style="color:#ff7777">${htmlEscape(errorMessage)}</div>`
    : "";
  if (!draft) {
    panel.innerHTML = title;
    return;
  }
  const liveMaxHit = loadout.maxHit || 0;
  const maxHitRow = `<span>Max Hit</span><input id="draft-max-hit" type="number" min="0" max="200" step="1" value="${Math.max(0, Math.round(draft.maxHit || 0))}"><span class="live">${liveMaxHit}</span>`;
  const playerRows = PLAYER_ACCURACY_TARGETS.map((type) => {
    const values = draft.playerAcc[type] || [0, 0];
    const live = loadout.playerAcc[type] || [0, 0];
    return `<span>${PLAYER_ACCURACY_LABELS[type]}</span><input id="draft-player-${type}-hit" type="number" min="0" max="100" step="0.01" value="${formatPctInput(values[0])}"><input id="draft-player-${type}-miss" type="number" min="0" max="100" step="0.01" value="${formatPctInput(values[1])}"><span class="live">${formatPctDisplay(live[0])} / ${formatPctDisplay(live[1])}</span>`;
  }).join("");
  const monsterRows = INCOMING_ACCURACY_ROWS.map((row) => {
    const draftValue = draft.monsterAcc[row.id] || 0;
    const liveValue = getLiveIncomingAcc(loadout, row);
    return `<span>${row.label}</span><input id="draft-monster-${row.id}" type="number" min="0" max="100" step="0.01" value="${formatPctInput(draftValue)}"><span class="live">${formatPctDisplay(liveValue)}</span>`;
  }).join("");
  const warning = draft.warnings.length
    ? `<div class="gear-note" style="color:#ffb86b">${draft.warnings.map(htmlEscape).join("<br>")}</div>`
    : "";
  panel.innerHTML = `${title}
    <h3>Damage</h3>
    <div class="stat-table monster"><span class="head">Value</span><span class="head">Draft</span><span class="head live">Live</span>${maxHitRow}</div>
    <h3>Player Accuracy</h3>
    <div class="stat-table"><span class="head">Target</span><span class="head">Draft Hit</span><span class="head">Draft Miss</span><span class="head live">Live</span>${playerRows}</div>
    <h3>Incoming Accuracy</h3>
    <div class="stat-table monster"><span class="head">Enemy</span><span class="head">Draft</span><span class="head live">Live</span>${monsterRows}</div>
    ${warning}`;
}

export function renderSpecialEffects(draft?: GearDraftStats | null): void {
  const box = document.getElementById("gearSpecialEffects");
  if (!box) return;
  const effects = draft?.special?.effects || draft?.recoil?.effects || [];
  if (!effects.length) {
    box.textContent = "No active special effects.";
    return;
  }
  box.innerHTML = effects.map((effect) => `<div>${htmlEscape(effect)}</div>`).join("");
}

export function collectDraftStatsFromInputs(): GearDraftStats | null {
  if (!state.gearDraftStats) return null;
  const draft: GearDraftStats = JSON.parse(JSON.stringify(state.gearDraftStats));
  draft.maxHit = Math.max(
    0,
    Math.round(
      Number((document.getElementById("draft-max-hit") as HTMLInputElement | null)?.value) ||
        draft.maxHit ||
        0,
    ),
  );
  for (const type of PLAYER_ACCURACY_TARGETS) {
    draft.playerAcc[type] = [
      parsePctInput(`draft-player-${type}-hit`, draft.playerAcc[type]?.[0]),
      parsePctInput(`draft-player-${type}-miss`, draft.playerAcc[type]?.[1]),
    ];
  }
  for (const row of INCOMING_ACCURACY_ROWS)
    draft.monsterAcc[row.id] = parsePctInput(`draft-monster-${row.id}`, draft.monsterAcc[row.id]);
  return draft;
}

export function applyGearStats(): void {
  const draft = collectDraftStatsFromInputs();
  const status = document.getElementById("gearStatus");
  if (!draft) {
    if (status) status.textContent = "No draft stats ready yet.";
    return;
  }
  const loadout = LOADOUTS[state.currentLoadoutKey as keyof typeof LOADOUTS] || LOADOUTS.ayak;
  for (const type of PLAYER_ACCURACY_TARGETS)
    loadout.playerAcc[type] = [
      clamp01(draft.playerAcc[type][0]),
      clamp01(draft.playerAcc[type][1]),
    ];
  for (const row of INCOMING_ACCURACY_ROWS)
    setLiveIncomingAcc(loadout, row, draft.monsterAcc[row.id]);
  loadout.maxHit = Math.max(0, Math.round(draft.maxHit || loadout.maxHit || 0));
  loadout.startingHp = clampHp(draft.config?.levels?.hp || loadout.startingHp || 99);
  loadout.hasRingRecoil = !!draft.recoil.hasRingRecoil;
  loadout.hasEchoBoots = !!draft.recoil.hasEchoBoots;
  loadout.hasRecoil = loadout.hasRingRecoil || loadout.hasEchoBoots;
  loadout.hasBloodSceptre = !!draft.special?.hasBloodSceptre;
  state.currentLoadout = loadout;
  state.gearDraftStats = draft;
  renderGearStatsPanel(draft);
  updateActiveLoadoutSummary();
  if (state.sim) {
    resetSim();
    setStatus(
      "Gear stats updated; manual simulation reset to avoid mixing old and new rolls.",
      "info",
    );
  }
  if (status) status.textContent = "Live AUTOZUK values updated";
}

export function openEquipmentSelector(): void {
  populateGearStaticControls();
  document.getElementById("gearModal")?.classList.add("open");
  state.currentLoadout =
    LOADOUTS[state.currentLoadoutKey as keyof typeof LOADOUTS] || LOADOUTS.ayak;
  renderGearDraft(state.currentLoadoutKey);
  loadWikiGearData();
}

export function closeEquipmentSelector(): void {
  document.getElementById("gearModal")?.classList.remove("open");
}

export function updateActiveLoadoutSummary(): void {
  const select = document.getElementById("activeLoadoutSelect") as HTMLSelectElement | null;
  if (select) select.value = state.currentLoadoutKey;
}

export function initializeEquipmentSelector(): void {
  populateGearStaticControls();
  updateActiveLoadoutSummary();
  const modal = document.getElementById("gearModal");
  if (modal)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeEquipmentSelector();
    });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("gearModal")?.classList.contains("open"))
      closeEquipmentSelector();
  });
}

export function toggleLegend(): void {
  const popup = document.getElementById("legendPopup") as HTMLElement | null;
  const btn = document.getElementById("legendBtn") as HTMLElement | null;
  if (!popup || !btn) return;
  if (btn.style.display !== "none") {
    btn.style.display = "none";
    const content = document.createElement("div");
    content.className = "legend-content";
    content.id = "legendContent";
    content.onclick = toggleLegend;
    content.innerHTML = `
      <div class="legend-item"><div class="legend-swatch" style="background:var(--mager-color)">M</div>Mager</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--ranger-color)">R</div>Ranger</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--meleer-color);border:1px solid #888">X</div>Meleer</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--blob-color)">B</div>Blob</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--bat-color)">Y</div>Bat</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--nibbler-color)">N</div>Nibbler</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-mage)">a</div>Bloblet-M</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-range)">b</div>Bloblet-R</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--bloblet-melee)">c</div>Bloblet-X</div>
      <div class="legend-item"><div class="legend-swatch" style="background:var(--player-color)">P</div>Player</div>`;
    popup.appendChild(content);
  } else {
    btn.style.display = "";
    const content = document.getElementById("legendContent");
    if (content) content.remove();
  }
}

export function updatePrayerStrip(): void {
  const strip = document.getElementById("prayerStrip");
  if (!strip) return;
  let seq: PrayerSequence | null = state.activePrayerSeq;
  if (!seq && state.playerPlacement) {
    const pk = `${state.playerPlacement.x},${state.playerPlacement.y}`;
    if (state.autozukResults[pk]) seq = state.autozukResults[pk].prayer;
  }
  if (!seq) {
    strip.style.display = "none";
    return;
  }
  strip.style.display = "flex";
  const displayOrder = [1, 2, 3, 0];
  const labels = ["START", "T1", "T2", "T3"];
  const prayColors = { mage: "#4488ff", range: "#44cc44", melee: "#888" };
  let html = "";
  for (let i = 0; i < 4; i++) {
    const p = seq[displayOrder[i]];
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:1px"><img src="${PRAYER_IMG_DATA[p]}" style="width:20px;height:20px;image-rendering:pixelated"><span style="font-size:7px;font-weight:700;color:${prayColors[p]};letter-spacing:0.5px">${labels[i]}</span></div>`;
  }
  strip.innerHTML = html;
}

// ===== UI UPDATES =====
export function syncStatusBox(): void {
  const statusBox = document.getElementById("statusBox");
  if (statusBox) statusBox.style.display = state.sim && state.sim.tick >= 1 ? "" : "none";
}

export function updateUI(): void {
  const tickDisplay = document.getElementById("tickDisplay");
  if (tickDisplay)
    tickDisplay.innerHTML = `<span>TICK</span><br>${state.sim ? state.sim.tick : "—"}`;
  syncStatusBox();
  // Player status
  if (state.sim) {
    const p = state.sim.player;
    const isDead = p.hp !== undefined && p.hp <= 0;
    const hpColor = isDead ? "#ff4444" : p.hp > 66 ? "#00ff00" : p.hp > 33 ? "#ffff00" : "#ff4444";
    const hpText = isDead
      ? "\u2620 / " + (p.maxHp || 99)
      : (p.hp !== undefined ? p.hp : 99) + "/" + (p.maxHp || 99);
    let prayInfo = "";
    {
      const pray = getEffectivePrayerForTick(state.sim.tick);
      if (pray) {
        const pn = { mage: "Mage", range: "Range", melee: "Melee" };
        prayInfo = ` | Prayer: ${pn[pray] || "?"}`;
      }
    }
    const playerStatus = document.getElementById("playerStatus");
    if (playerStatus)
      playerStatus.innerHTML = `<div class="mob-info-row"><span class="name" style="color:#bb88ff">P Player</span><span class="hp" style="color:${hpColor}">${hpText}</span><span class="pos">(${p.x},${p.y})${prayInfo}</span></div>`;
  } else {
    const playerStatus = document.getElementById("playerStatus");
    if (playerStatus) playerStatus.innerHTML = "No simulation loaded";
  }
  let html = "";
  if (state.sim) {
    const alive = state.sim.mobs.filter((m) => !m.dead && m.dying <= 0);
    for (const m of alive)
      html += `<div class="mob-info-row"><span class="name" style="color:${isDarkColor(m.color || "#888") ? "#aaa" : m.color}">${m.letter} #${m.id}</span><span class="hp">${m.hp}/${m.maxHp}</span><span class="pos">(${m.x},${m.y})</span></div>`;
  }
  const mobInfo = document.getElementById("mobInfo");
  if (mobInfo) mobInfo.innerHTML = html || "No mobs alive";
  updateTickGrid();
  updateEventList();
  render();
}

function isDarkColor(c: string): boolean {
  const r = parseInt(c.slice(1, 3), 16);
  const g = parseInt(c.slice(3, 5), 16);
  const b = parseInt(c.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

export function rebuildTickGridHeader(): void {
  const tickGridHead = document.getElementById("tickGridHead");
  if (!tickGridHead) return;
  let html = '<tr><th class="tick-col">T</th>';
  if (state.practiceState.open)
    html += '<th class="mob-col practice-you-col" title="Your active prayer">YOU</th>';
  for (const col of state.gridMobColumns) {
    const tc = isDarkColor(col.color) ? "#fff" : "#000";
    html += `<th class="mob-col"><span class="mob-col-badge" style="background:${col.color};color:${tc}">${col.letter}</span></th>`;
  }
  html += "</tr>";
  tickGridHead.innerHTML = html;
  const tickGridBody = document.getElementById("tickGridBody");
  if (tickGridBody) tickGridBody.innerHTML = "";
}

export function updateTickGrid(): void {
  if (!state.sim) return;
  const currentTick = state.sim.tick;
  const tbody = document.getElementById("tickGridBody") as HTMLTableSectionElement | null;
  if (!tbody) return;
  let hitCount = 0;
  for (const t in state.tickHits) hitCount += state.tickHits[t].length;
  const tickGridCount = document.getElementById("tickGridCount");
  if (tickGridCount) tickGridCount.textContent = `${hitCount} hits`;
  let startT = state.sim.startTick || 0;
  if (tbody.rows.length) {
    const lastTick = parseInt(tbody.rows[tbody.rows.length - 1].dataset.tick || "", 10);
    startT = isNaN(lastTick) ? startT : lastTick + 1;
  }
  for (let t = startT; t <= currentTick; t++) {
    const tr = document.createElement("tr");
    tr.dataset.tick = String(t);
    const tdTick = document.createElement("td");
    tdTick.className = "tick-col";
    // Prayer icon + tick number — show if tile has an AUTOZUK prayer solution
    let praySeq: PrayerSequence | null = state.activePrayerSeq;
    if (!praySeq && state.playerPlacement) {
      const pk = `${state.playerPlacement.x},${state.playerPlacement.y}`;
      if (state.autozukResults[pk]) praySeq = state.autozukResults[pk].prayer;
    }
    if (praySeq && (!state.practiceState.open || t >= 16)) {
      const pray = praySeq[solutionPrayerIndexForTick(t)];
      const src = PRAYER_IMG_DATA[pray];
      if (src) {
        const img = document.createElement("img");
        img.src = src;
        img.style.cssText =
          "width:12px;height:12px;vertical-align:middle;margin-right:2px;image-rendering:pixelated";
        tdTick.appendChild(img);
      }
    }
    tdTick.appendChild(document.createTextNode(String(t)));
    tr.appendChild(tdTick);
    if (state.practiceState.open) {
      const tdPractice = document.createElement("td");
      tdPractice.className = "practice-prayer-cell";
      const actual = practicePrayerForTick(t);
      const expected = expectedPracticePrayerForTick(t);
      if (actual) tdPractice.innerHTML = practiceGridIcon(actual);
      else {
        tdPractice.textContent = "-";
        tdPractice.classList.add("waiting");
      }
      if (expected) {
        tdPractice.classList.add(actual === expected ? "correct" : "incorrect");
        tdPractice.title = actual === expected ? "Correct prayer" : "Missed prayer";
      }
      tr.appendChild(tdPractice);
    }
    for (const col of state.gridMobColumns) {
      const td = document.createElement("td");
      const hits = (state.tickHits[t] || []).filter((h) => h.mobId === col.id);
      for (const h of hits) {
        const block = document.createElement("span");
        block.className = "hit-block" + (h.isScan ? " scan" : "");
        block.style.background = h.color;
        // Color red if off-prayer
        if (!h.isScan && h.style) {
          let pray: Prayer | null = state.practiceState.open ? getEffectivePrayerForTick(t) : null;
          if (!state.practiceState.open) {
            let usePraySeq: PrayerSequence | null = state.activePrayerSeq;
            if (!usePraySeq && state.playerPlacement) {
              const pk = `${state.playerPlacement.x},${state.playerPlacement.y}`;
              if (state.autozukResults[pk]) usePraySeq = state.autozukResults[pk].prayer;
            }
            if (usePraySeq) pray = usePraySeq[solutionPrayerIndexForTick(t)];
          }
          if (
            (state.practiceState.open && state.practiceState.solution) ||
            (!state.practiceState.open && pray)
          ) {
            const blocked =
              (h.style === "magic" && pray === "mage") ||
              (h.style === "range" && pray === "range") ||
              (h.style === "melee" && pray === "melee");
            if (!blocked) {
              block.style.background = "#ff2222";
              block.style.boxShadow = "0 0 3px #ff0000";
              block.title = "OFF PRAYER: " + h.style + " vs protect " + (pray || "none");
            }
          }
        }
        td.appendChild(block);
      }
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  }
  for (const row of tbody.rows) row.classList.remove("current-tick");
  const currentRow = Array.from(tbody.rows).find(
    (row) => parseInt(row.dataset.tick || "", 10) === currentTick,
  );
  if (currentRow) currentRow.classList.add("current-tick");
  const wrapper = document.getElementById("tickGridWrapper");
  if (wrapper && !state.tickGridUserScrolled) wrapper.scrollTop = wrapper.scrollHeight;
}

export function updateEventList(): void {
  const container = document.getElementById("eventListBody");
  if (!container) return;
  const events = state.tickEvents.filter(
    (e) => e.isHit || e.isScan || e.isPlayerAttack || e.isResurrect,
  );
  const eventCount = document.getElementById("eventCount");
  if (eventCount) eventCount.textContent = `${events.length} events`;
  if (events.length === 0) {
    container.innerHTML =
      '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">No events yet</div>';
    return;
  }
  let html = "";
  for (const e of events) {
    let bc: string = e.type;
    if (bc === "blobletMage") bc = "bloblet-mage";
    if (bc === "blobletRange") bc = "bloblet-range";
    if (bc === "blobletMelee") bc = "bloblet-melee";
    if (bc === "player-atk") bc = "player-atk";
    html += `<div class="tick-entry${e.isScan ? " scan" : ""}"><span class="tick-num">T${e.tick}</span><span class="tick-badge ${bc}">${MOB_DEFS[e.type]?.letter || "P"}</span><span class="tick-detail">${e.detail}</span></div>`;
  }
  container.innerHTML = html;
  if (!state.eventListUserScrolled) container.scrollTop = container.scrollHeight;
}

export function setStatus(_message: string, _type?: string): void {}

export function showSpawnCodeError(): void {
  const el = document.getElementById("spawnCodeError");
  const input = document.getElementById("spawnCode") as HTMLInputElement | null;
  if (el) {
    el.textContent = "Input wave code or click dice button";
    el.classList.add("show");
  }
  if (input) {
    input.classList.add("input-error");
    input.focus();
  }
}

export function clearSpawnCodeError(): void {
  document.getElementById("spawnCodeError")?.classList.remove("show");
  document.getElementById("spawnCode")?.classList.remove("input-error");
}

// ===== SCROLL/RESIZE =====
export function initScrollResizeHandlers(): void {
  const tickGridWrapper = document.getElementById("tickGridWrapper");
  if (tickGridWrapper)
    tickGridWrapper.addEventListener("scroll", function (this: HTMLElement) {
      state.tickGridUserScrolled = this.scrollHeight - this.scrollTop - this.clientHeight > 30;
    });
  const eventListBody = document.getElementById("eventListBody");
  if (eventListBody)
    eventListBody.addEventListener("scroll", function (this: HTMLElement) {
      state.eventListUserScrolled = this.scrollHeight - this.scrollTop - this.clientHeight > 30;
    });
  (function () {
    const handle = document.getElementById("resizeHandle");
    const section = document.getElementById("eventlistSection") as HTMLElement | null;
    if (!handle || !section) return;
    let dragging = false,
      startY = 0,
      startH = 0;
    handle.addEventListener("mousedown", function (e) {
      dragging = true;
      startY = e.clientY;
      startH = section.offsetHeight;
      document.body.style.cursor = "ns-resize";
      document.body.style.userSelect = "none";
      e.preventDefault();
    });
    document.addEventListener("mousemove", function (e) {
      if (!dragging) return;
      section.style.height = Math.max(80, Math.min(500, startH + startY - e.clientY)) + "px";
    });
    document.addEventListener("mouseup", function () {
      if (dragging) {
        dragging = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    });
  })();
}

// ===== EVENT HANDLERS =====
export function initEventHandlers(): void {
  window.addEventListener("resize", resizeCanvas);
  canvas.addEventListener("click", function (e) {
    const rect = canvas.getBoundingClientRect();
    let gx: number, gy: number;
    if (facingSouth) {
      gx = ARENA_X_MAX - Math.floor((e.clientX - rect.left) / TILE_SIZE);
      gy = ARENA_Y_MAX - Math.floor((e.clientY - rect.top) / TILE_SIZE);
    } else {
      gx = Math.floor((e.clientX - rect.left) / TILE_SIZE) + ARENA_X_MIN;
      gy = Math.floor((e.clientY - rect.top) / TILE_SIZE) + ARENA_Y_MIN;
    }
    if (gx < ARENA_X_MIN || gx > ARENA_X_MAX || gy < ARENA_Y_MIN || gy > ARENA_Y_MAX) return;
    // Always set player placement
    state.playerPlacement = { x: gx, y: gy };
    if (state.autozukMode && !state.autozukRunning) {
      const key = `${gx},${gy}`;
      if (state.autozukResults[key]) {
        state.selectedTile = { x: gx, y: gy };
        state.activePrayerSeq = state.autozukResults[key].prayer;
        showTileDetail(gx, gy);
        setStatus(`Player placed at (${gx}, ${gy}) — click STEP/PLAY to sim`, "info");
        render();
        return;
      } else if (state.excludedTiles.has(key)) {
        setStatus(`Player placed at (${gx}, ${gy}) — excluded tile`, "info");
        render();
        return;
      }
    }
    setStatus(`Player placed at (${gx}, ${gy})`, "info");
    render();
  });
}

export function togglePillar(key: PillarKey): void {
  state.pillars[key] = !state.pillars[key];
  document.getElementById("pillar" + key)?.classList.toggle("active");
  updatePreview();
  render();
}

export function updatePreview(): void {
  const code = (document.getElementById("spawnCode") as HTMLInputElement | null)?.value || "";
  state.previewMobs = [];
  if (!code.trim()) {
    render();
    return;
  }
  const parsed = parseSpawnCode(code);
  if ("error" in parsed) {
    render();
    return;
  }
  for (const spawn of parsed.spawns) {
    if (spawn.type === "nothing") continue;
    const d = MOB_DEFS[spawn.type];
    if (!d) continue;
    state.previewMobs.push({
      x: spawn.x,
      y: spawn.y,
      size: d.size,
      color: d.color,
      letter: d.letter,
      type: spawn.type,
    });
  }
  render();
}

export function changeLoadout(key: string): void {
  state.currentLoadoutKey = key || state.currentLoadoutKey;
  state.currentLoadout =
    LOADOUTS[state.currentLoadoutKey as keyof typeof LOADOUTS] || LOADOUTS.ayak;
  updateActiveLoadoutSummary();
  if (document.getElementById("gearModal")?.classList.contains("open"))
    renderGearDraft(state.currentLoadoutKey);
}

export function pasteSpawnCode(): void {
  navigator.clipboard
    .readText()
    .then((text) => {
      text = text.trim();
      // Strip digits to count mob chars, validate 9 positions with optional index digits
      const stripped = text.replace(/[1-9]/g, "");
      if (
        stripped.length === 9 &&
        /^[MRXBYOmrxbyo]{9}$/i.test(stripped) &&
        text.length <= 18 &&
        /^[MRXBYOmrxbyo1-9]+$/i.test(text)
      ) {
        const input = document.getElementById("spawnCode") as HTMLInputElement | null;
        if (input) {
          input.value = text.toUpperCase();
          input.dispatchEvent(new Event("input"));
        }
      }
    })
    .catch(() => {});
}

export function randomSpawnCode(): void {
  const monsters = ["M", "R"];
  if (Math.random() < 0.5) monsters.push("X");
  const addOns = [["B", "B"], ["B", "Y"], ["B", "Y", "Y"], ["B"]];
  monsters.push(...addOns[Math.floor(Math.random() * addOns.length)]);
  const slots = Array.from({ length: 9 }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  const codeSlots: string[] = Array(9).fill("O");
  for (let i = 0; i < monsters.length; i++) codeSlots[slots[i]] = monsters[i];
  const order = Array.from({ length: monsters.length }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let monsterIndex = 0;
  const code = codeSlots.map((ch) => (ch === "O" ? "O" : ch + order[monsterIndex++])).join("");
  const input = document.getElementById("spawnCode") as HTMLInputElement | null;
  if (input) {
    input.value = code;
    input.dispatchEvent(new Event("input"));
  }
}

export function resetAutozuk(): void {
  if (state.autozukRunning) return;
  if (state.practiceState.open) closePracticeMode(true);
  stopSolverVisualPreview();
  state.autozukMode = false;
  state.autozukResults = {};
  state.excludedTiles = new Set();
  state.selectedTile = null;
  state.activePrayerSeq = null;
  state.autozukHidden = false;
  const progressFill = document.getElementById("progressFill");
  if (progressFill) progressFill.style.width = "0%";
  const autozukStatus = document.getElementById("autozukStatus");
  if (autozukStatus) autozukStatus.textContent = "";
  document.getElementById("detailPanel")?.classList.add("detail-hidden");
  const liveDetailPanel = document.getElementById("liveDetailPanel");
  if (liveDetailPanel) liveDetailPanel.style.display = "none";
  const liveFeedPanel = document.getElementById("liveFeedPanel");
  if (liveFeedPanel) liveFeedPanel.style.display = "none";
  const phase1Panel = document.getElementById("phase1Panel");
  if (phase1Panel) phase1Panel.style.display = "";
  const eventlistSection = document.getElementById("eventlistSection");
  if (eventlistSection) eventlistSection.style.display = "";
  const resizeHandle = document.getElementById("resizeHandle");
  if (resizeHandle) resizeHandle.style.display = "";
  const exportSection = document.getElementById("exportSection");
  if (exportSection) exportSection.style.display = "";
  const btnHideAZ = document.getElementById("btnHideAZ");
  if (btnHideAZ) {
    btnHideAZ.textContent = "HIDE";
    btnHideAZ.style.background = "";
  }
  setStatus("AUTOZUK data cleared", "info");
  render();
}

export function toggleHideAutozuk(): void {
  state.autozukHidden = !state.autozukHidden;
  const btn = document.getElementById("btnHideAZ");
  if (btn) {
    if (state.autozukHidden) {
      btn.textContent = "SHOW";
      btn.style.background = "var(--accent-dim)";
    } else {
      btn.textContent = "HIDE";
      btn.style.background = "";
    }
  }
  render();
}

export function ensureTickGridView(): void {
  if (!document.getElementById("detailPanel")?.classList.contains("detail-hidden"))
    closeTileDetail();
}

export function initInputHandlers(): void {
  const speedSlider = document.getElementById("speedSlider") as HTMLInputElement | null;
  if (speedSlider)
    speedSlider.addEventListener("input", function () {
      const speedLabel = document.getElementById("speedLabel");
      if (speedLabel) speedLabel.textContent = `${this.value} t/s`;
      if (state.playing) {
        if (state.playInterval) clearInterval(state.playInterval);
        startPlay();
      }
    });
  const spawnCode = document.getElementById("spawnCode") as HTMLInputElement | null;
  if (spawnCode)
    spawnCode.addEventListener("input", function () {
      if (state.practiceState.open) closePracticeMode(true);
      clearSpawnCodeError();
      if (state.sim) {
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
        const eventCount = document.getElementById("eventCount");
        if (eventCount) eventCount.textContent = "0 events";
        const eventListBody = document.getElementById("eventListBody");
        if (eventListBody)
          eventListBody.innerHTML =
            '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">Load a wave to see events</div>';
        const tickDisplay = document.getElementById("tickDisplay");
        if (tickDisplay) tickDisplay.innerHTML = "<span>TICK</span><br>—";
        syncStatusBox();
      }
      state.autozukMode = false;
      state.autozukResults = {};
      state.excludedTiles = new Set();
      state.selectedTile = null;
      document.getElementById("detailPanel")?.classList.add("detail-hidden");
      const phase1Panel = document.getElementById("phase1Panel");
      if (phase1Panel) phase1Panel.style.display = "";
      updatePreview();
    });
}

// ===== PHASE 2: TILE DETAIL PANEL =====
export function showTileDetail(x: number, y: number): void {
  const key = `${x},${y}`;
  const result = state.autozukResults[key];
  if (!result) {
    document.getElementById("detailPanel")?.classList.add("detail-hidden");
    return;
  }

  // Switch right panel to detail view
  const phase1Panel = document.getElementById("phase1Panel");
  if (phase1Panel) phase1Panel.style.display = "none";
  const liveDetailPanel = document.getElementById("liveDetailPanel");
  if (liveDetailPanel) liveDetailPanel.style.display = "none";
  const eventlistSection = document.getElementById("eventlistSection");
  if (eventlistSection) eventlistSection.style.display = "none";

  const resizeHandle = document.getElementById("resizeHandle");
  if (resizeHandle) resizeHandle.style.display = "none";
  const dp = document.getElementById("detailPanel");
  if (!dp) return;
  dp.classList.remove("detail-hidden");

  let prayerHtml = '<div class="prayer-sequence">';
  const prayerNames = { mage: "MAGE", range: "RANGE", melee: "MELEE" };
  const displayOrder = [1, 2, 3, 0];
  const slotLabels = ["START", "T1", "T2", "T3"];
  for (let i = 0; i < 4; i++) {
    const p = result.prayer[displayOrder[i]];
    prayerHtml += `<div class="prayer-slot ${p}"><div class="slot-num">${slotLabels[i]}</div>${prayerNames[p]}</div>`;
  }
  prayerHtml += "</div>";

  const dmgClass = result.avgDamage < 15 ? "good" : result.avgDamage < 30 ? "warn" : "bad";
  const o50Class = result.over50Pct < 10 ? "good" : result.over50Pct < 30 ? "warn" : "bad";
  const scoreLabel = state.currentLoadout?.isBloodBarrage ? "Avg Max HP Deficit" : "Avg Damage";
  const over50Label = state.currentLoadout?.isBloodBarrage ? "Runs > 50 deficit" : "Runs > 50 dmg";
  const scoreLabelClass = state.currentLoadout?.isBloodBarrage ? "" : " score-active";
  const deathLabelClass = state.currentLoadout?.isBloodBarrage ? " score-active" : "";
  const deathRateRow =
    result.deathPct !== undefined
      ? `<div class="detail-stat"><span class="label${deathLabelClass}">Death Rate</span><span class="value ${result.deathPct > 30 ? "bad" : result.deathPct > 10 ? "warn" : "good"}">${result.deathPct.toFixed(1)}%</span></div>`
      : "";

  dp.innerHTML = `
    <h3>Tile (${x}, ${y})</h3>
    <div style="margin-bottom:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Prayer Sequence (repeating)</label></div>
    ${prayerHtml}
    <div class="detail-stat"><span class="label${scoreLabelClass}">${scoreLabel}</span><span class="value ${dmgClass}">${result.avgDamage.toFixed(1)}</span></div>
    <div class="detail-stat"><span class="label">${over50Label}</span><span class="value ${o50Class}">${result.over50Pct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Avg Completion</span><span class="value">${Math.round(result.avgTicks)} ticks (${result.avgTime}s)</span></div>
    <div class="detail-stat"><span class="label">Invalid Runs</span><span class="value">${result.invalidPct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Total Sims</span><span class="value">${result.totalSims}</span></div>
    ${deathRateRow}
    <div style="margin-top:12px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Damage Distribution</label></div>
    <div class="histogram"><canvas id="histCanvas" width="340" height="70"></canvas></div>
    <div style="margin-top:8px;text-align:center">
      <button class="btn btn-secondary" onclick="closeTileDetail()" style="font-size:10px;padding:6px 16px">← Back to Tick Grid</button>
    </div>
  `;

  // Draw histogram
  requestAnimationFrame(() => {
    const hc = document.getElementById("histCanvas") as HTMLCanvasElement | null;
    if (!hc) return;
    const hctx = hc.getContext("2d");
    if (!hctx) return;
    if (hc.parentElement) hc.width = hc.parentElement.clientWidth;
    hc.height = 70;
    const buckets = Array.from({ length: 20 }, () => 0);
    const maxDmg = Math.max(...result.damages, 100);
    for (const d of result.damages) {
      const b = Math.min(Math.floor((d / maxDmg) * 20), 19);
      buckets[b]++;
    }
    const maxB = Math.max(...buckets, 1);
    const bw = hc.width / 20;
    for (let i = 0; i < 20; i++) {
      const h = (buckets[i] / maxB) * 60;
      const dmgVal = ((i + 0.5) / 20) * maxDmg;
      hctx.fillStyle = histogramColor(dmgVal);
      hctx.fillRect(i * bw + 1, 70 - h, bw - 2, h);
    }
    // Red line at 50
    const x50 = (50 / maxDmg) * hc.width;
    if (x50 < hc.width) {
      hctx.strokeStyle = "#ff0000";
      hctx.lineWidth = 2;
      hctx.setLineDash([4, 2]);
      hctx.beginPath();
      hctx.moveTo(x50, 0);
      hctx.lineTo(x50, 70);
      hctx.stroke();
      hctx.setLineDash([]);
    }
  });
}

export function updateLiveDetail(x: number, y: number, result: AutozukSummary): void {
  const dp = document.getElementById("liveDetailPanel");
  if (!dp) return;
  let prayerHtml = '<div class="prayer-sequence">';
  const prayerNames = { mage: "MAGE", range: "RANGE", melee: "MELEE" };
  const slotLabels = ["START", "T1", "T2", "T3"];
  const displayOrder = [1, 2, 3, 0];
  for (let i = 0; i < 4; i++) {
    const p = result.prayer[displayOrder[i]];
    prayerHtml += `<div class="prayer-slot ${p}"><div class="slot-num">${slotLabels[i]}</div>${prayerNames[p]}</div>`;
  }
  prayerHtml += "</div>";
  const dmgClass = result.avgDamage < 15 ? "good" : result.avgDamage < 30 ? "warn" : "bad";
  const o50Class = result.over50Pct < 10 ? "good" : result.over50Pct < 30 ? "warn" : "bad";
  const scoreLabel = state.currentLoadout?.isBloodBarrage ? "Avg Max HP Deficit" : "Avg Damage";
  const over50Label = state.currentLoadout?.isBloodBarrage ? "Runs > 50 deficit" : "Runs > 50 dmg";
  dp.innerHTML = `
    <h3 style="font-family:'JetBrains Mono',monospace;color:var(--accent);font-size:13px;font-weight:800;margin-bottom:6px;letter-spacing:1px">Tile (${x}, ${y})</h3>
    <div class="detail-stat"><span class="label">${scoreLabel}</span><span class="value ${dmgClass}">${result.avgDamage.toFixed(1)}</span></div>
    <div class="detail-stat"><span class="label">${over50Label}</span><span class="value ${o50Class}">${result.over50Pct.toFixed(1)}%</span></div>
    <div class="detail-stat"><span class="label">Avg Completion</span><span class="value">${Math.round(result.avgTicks)} ticks (${result.avgTime}s)</span></div>
    <div class="detail-stat"><span class="label">Sims</span><span class="value">${result.totalSims}</span></div>
    <div style="margin-top:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Prayer Sequence</label></div>
    ${prayerHtml}
    <div style="margin-top:8px"><label style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:1.5px">Damage Distribution</label></div>
    <div class="histogram"><canvas id="liveHistCanvas" width="340" height="70"></canvas></div>
  `;
  requestAnimationFrame(() => {
    const hc = document.getElementById("liveHistCanvas") as HTMLCanvasElement | null;
    if (!hc) return;
    const hctx = hc.getContext("2d");
    if (!hctx) return;
    if (hc.parentElement) hc.width = hc.parentElement.clientWidth;
    hc.height = 70;
    const buckets = Array.from({ length: 20 }, () => 0);
    const maxDmg = Math.max(...result.damages, 100);
    for (const d of result.damages) {
      const b = Math.min(Math.floor((d / maxDmg) * 20), 19);
      buckets[b]++;
    }
    const maxB = Math.max(...buckets, 1);
    const bw = hc.width / 20;
    for (let i = 0; i < 20; i++) {
      const h = (buckets[i] / maxB) * 60;
      const dmgVal = ((i + 0.5) / 20) * maxDmg;
      hctx.fillStyle = histogramColor(dmgVal);
      hctx.fillRect(i * bw + 1, 70 - h, bw - 2, h);
    }
    const x50 = (50 / maxDmg) * hc.width;
    if (x50 < hc.width) {
      hctx.strokeStyle = "#ff0000";
      hctx.lineWidth = 2;
      hctx.setLineDash([4, 2]);
      hctx.beginPath();
      hctx.moveTo(x50, 0);
      hctx.lineTo(x50, 70);
      hctx.stroke();
      hctx.setLineDash([]);
    }
  });
}

export function closeTileDetail(): void {
  document.getElementById("detailPanel")?.classList.add("detail-hidden");
  const phase1Panel = document.getElementById("phase1Panel");
  if (phase1Panel) phase1Panel.style.display = "";
  const eventlistSection = document.getElementById("eventlistSection");
  if (eventlistSection) eventlistSection.style.display = "";

  const resizeHandle = document.getElementById("resizeHandle");
  if (resizeHandle) resizeHandle.style.display = "";
  const exportSection = document.getElementById("exportSection");
  if (exportSection) exportSection.style.display = "";
  state.selectedTile = null;
  state.activePrayerSeq = null;
  render();
}

export function openPracticeMode(): void {
  if (state.practiceState.open) {
    closePracticeMode(true);
    return;
  }
  initializePracticeIcons();
  const spawnCode = document.getElementById("spawnCode") as HTMLInputElement | null;
  const code = spawnCode?.value || "";
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
  if (!state.playerPlacement) {
    const status = document.getElementById("exportStatus");
    if (status) {
      status.textContent = "Click a start tile first";
      status.style.color = "var(--accent)";
      setTimeout(() => {
        status.textContent = "";
        status.style.color = "";
      }, 1800);
    }
    return;
  }
  state.practiceState.open = true;
  state.practiceState.running = false;
  state.practiceState.tick = 1;
  state.practiceState.active = null;
  state.practiceState.pending = undefined;
  state.practiceState.visual = new Set();
  state.practiceState.clientOrder = [];
  state.practiceState.records = {};
  state.practiceState.solution = getSelectedPrayerSequence();
  state.practiceState.metronomeStart = 1 + Math.floor(Math.random() * 4);
  state.practiceState.restoreAutozukHidden = state.autozukMode ? state.autozukHidden : null;
  state.practiceState.restoreTile = getPracticeRestoreTile();
  stopPlay();
  clearPracticeManualState();
  document.getElementById("practicePanel")?.classList.add("show");
  initializePracticePopout();
  positionPracticePopout();
  setPracticeButtonText();
  document.getElementById("detailPanel")?.classList.add("detail-hidden");
  const liveDetailPanel = document.getElementById("liveDetailPanel");
  if (liveDetailPanel) liveDetailPanel.style.display = "none";
  const phase1Panel = document.getElementById("phase1Panel");
  if (phase1Panel) phase1Panel.style.display = "";
  const eventlistSection = document.getElementById("eventlistSection");
  if (eventlistSection) eventlistSection.style.display = "";
  const resizeHandle = document.getElementById("resizeHandle");
  if (resizeHandle) resizeHandle.style.display = "";
  if (state.autozukMode && !state.autozukHidden) toggleHideAutozuk();
  recordPracticeTick(1);
  renderPracticeMode();
  startPracticeTimer();
}

export function closePracticeMode(resetManual: boolean): void {
  stopPracticeTimer();
  const restoreHidden = state.practiceState.restoreAutozukHidden;
  const restoreTile = state.practiceState.restoreTile;
  state.practiceState.open = false;
  state.practiceState.tick = 1;
  state.practiceState.active = null;
  state.practiceState.pending = undefined;
  state.practiceState.visual = new Set();
  state.practiceState.clientOrder = [];
  state.practiceState.records = {};
  state.practiceState.restoreAutozukHidden = null;
  state.practiceState.restoreTile = null;
  document.getElementById("practicePanel")?.classList.remove("show");
  setPracticeButtonText();
  renderPracticeButtons();
  if (resetManual) clearPracticeManualState();
  restorePracticeUiState(restoreTile, restoreHidden);
}

export function startPracticeTimer(): void {
  if (state.practiceState.interval) clearInterval(state.practiceState.interval);
  state.practiceState.running = true;
  state.practiceState.interval = setInterval(advancePracticeTick, 600);
}

export function stopPracticeTimer(): void {
  if (state.practiceState.interval) clearInterval(state.practiceState.interval);
  state.practiceState.interval = null;
  state.practiceState.running = false;
}

export function advancePracticeTick(): void {
  state.practiceState.tick++;
  if (state.practiceState.pending !== undefined)
    state.practiceState.active = state.practiceState.pending;
  state.practiceState.pending = undefined;
  state.practiceState.visual = new Set(
    state.practiceState.active ? [state.practiceState.active] : [],
  );
  state.practiceState.clientOrder = state.practiceState.active ? [state.practiceState.active] : [];
  recordPracticeTick(state.practiceState.tick);
  if (state.practiceState.tick === 15) startPracticeSimulationAtSpawn();
  else if (state.practiceState.tick > 15) {
    if (!state.sim) startPracticeSimulationAtSpawn();
    if (state.sim && state.sim.tick < state.practiceState.tick) simulateTick();
  }
  renderPracticeMode();
}

export function clickPracticePrayer(type: Prayer): void {
  if (!state.practiceState.open || !PRACTICE_PRAYERS[type]) return;
  const turningOff = state.practiceState.visual.has(type);
  if (turningOff) {
    state.practiceState.visual.delete(type);
    state.practiceState.clientOrder = state.practiceState.clientOrder.filter((p) => p !== type);
    state.practiceState.pending = state.practiceState.clientOrder.length
      ? state.practiceState.clientOrder[state.practiceState.clientOrder.length - 1]
      : null;
  } else {
    state.practiceState.visual.add(type);
    state.practiceState.clientOrder = state.practiceState.clientOrder.filter((p) => p !== type);
    state.practiceState.clientOrder.push(type);
    state.practiceState.pending = type;
  }
  renderPracticeButtons();
  playPracticePrayerSound(type, !turningOff);
}

export function initializePracticeIcons(): void {
  for (const type of ["mage", "range", "melee"] as Prayer[]) {
    const btn = document.getElementById(
      "practicePrayer" + (type === "range" ? "Range" : type === "mage" ? "Mage" : "Melee"),
    );
    if (btn && !btn.dataset.iconReady) {
      btn.innerHTML = `<img src="${PRAYER_IMG_DATA[type]}" alt="" draggable="false">`;
      btn.dataset.iconReady = "1";
    }
  }
}

export function initializePracticePopout(): void {
  if (state.practiceState.popoutReady) return;
  const panel = document.getElementById("practicePanel");
  const handle = document.getElementById("practiceDragHandle");
  if (!panel || !handle) return;
  handle.addEventListener("pointerdown", (e) => {
    const r = panel.getBoundingClientRect();
    state.practiceState.dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  document.addEventListener("pointermove", (e) => {
    if (!state.practiceState.dragging) return;
    movePracticePopout(
      e.clientX - state.practiceState.dragging.dx,
      e.clientY - state.practiceState.dragging.dy,
    );
  });
  document.addEventListener("pointerup", () => {
    state.practiceState.dragging = null;
  });
  window.addEventListener("resize", () => {
    if (state.practiceState.popoutPos)
      movePracticePopout(state.practiceState.popoutPos.x, state.practiceState.popoutPos.y);
  });
  state.practiceState.popoutReady = true;
}

export function positionPracticePopout(): void {
  const panel = document.getElementById("practicePanel");
  if (!panel) return;
  if (state.practiceState.popoutPos) {
    movePracticePopout(state.practiceState.popoutPos.x, state.practiceState.popoutPos.y);
    return;
  }
  (panel as HTMLElement).style.left = "18px";
  (panel as HTMLElement).style.bottom = "18px";
  (panel as HTMLElement).style.top = "auto";
  (panel as HTMLElement).style.right = "auto";
}

export function movePracticePopout(x: number, y: number): void {
  const panel = document.getElementById("practicePanel");
  if (!panel) return;
  const r = panel.getBoundingClientRect();
  const pad = 8;
  const maxX = Math.max(pad, window.innerWidth - r.width - pad);
  const maxY = Math.max(pad, window.innerHeight - r.height - pad);
  x = Math.max(pad, Math.min(maxX, x));
  y = Math.max(pad, Math.min(maxY, y));
  (panel as HTMLElement).style.left = x + "px";
  (panel as HTMLElement).style.top = y + "px";
  (panel as HTMLElement).style.right = "auto";
  (panel as HTMLElement).style.bottom = "auto";
  state.practiceState.popoutPos = { x, y };
}

export function clearPracticeManualState(): void {
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
  const eventCount = document.getElementById("eventCount");
  if (eventCount) eventCount.textContent = "0 events";
  const eventListBody = document.getElementById("eventListBody");
  if (eventListBody)
    eventListBody.innerHTML =
      '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">Load a wave to see events</div>';
  const tickDisplay = document.getElementById("tickDisplay");
  if (tickDisplay) tickDisplay.innerHTML = "<span>TICK</span><br>&mdash;";
  syncStatusBox();
  updatePreview();
  render();
}

export function startPracticeSimulationAtSpawn(): void {
  if (state.sim) return;
  const spawnCode = document.getElementById("spawnCode") as HTMLInputElement | null;
  const code = spawnCode?.value || "";
  if (!state.playerPlacement) return;
  state.sim = initSim(code, state.playerPlacement, 15);
  if (!state.sim) {
    closePracticeMode(false);
    return;
  }
  state.sim.practiceMode = true;
  rebuildTickGridHeader();
  const tickGridBody = document.getElementById("tickGridBody");
  if (tickGridBody) tickGridBody.innerHTML = "";
  state.tickGridUserScrolled = false;
  state.eventListUserScrolled = false;
  setStatus(
    `Practice sim started! ${state.sim.mobs.filter((m) => !m.dead).length} mobs spawned on tick 15.`,
    "info",
  );
  updateUI();
}

export function getSelectedPrayerSequence(): PrayerSequence | null {
  if (state.activePrayerSeq) return state.activePrayerSeq.slice() as PrayerSequence;
  if (state.playerPlacement) {
    const pk = `${state.playerPlacement.x},${state.playerPlacement.y}`;
    if (state.autozukResults[pk]) return state.autozukResults[pk].prayer.slice() as PrayerSequence;
  }
  return null;
}

export function getPracticeRestoreTile(): Point | null {
  if (state.selectedTile) return { x: state.selectedTile.x, y: state.selectedTile.y };
  if (
    state.playerPlacement &&
    state.autozukResults[`${state.playerPlacement.x},${state.playerPlacement.y}`]
  )
    return { x: state.playerPlacement.x, y: state.playerPlacement.y };
  return null;
}

export function restorePracticeUiState(tile: Point | null, hidden: boolean | null): void {
  if (hidden !== null && state.autozukMode && state.autozukHidden !== hidden) toggleHideAutozuk();
  if (tile && state.autozukMode) {
    const key = `${tile.x},${tile.y}`;
    if (state.autozukResults[key]) {
      state.selectedTile = { x: tile.x, y: tile.y };
      state.playerPlacement = { x: tile.x, y: tile.y };
      state.activePrayerSeq = state.autozukResults[key].prayer;
      showTileDetail(tile.x, tile.y);
      return;
    }
  }
  render();
}

export function expectedPracticePrayerForTick(tick: number): Prayer | null {
  if (!state.practiceState.open || !state.practiceState.solution || tick < 16) return null;
  return state.practiceState.solution[solutionPrayerIndexForTick(tick)];
}

export function getEffectivePrayerForTick(tick: number): Prayer | null {
  if (state.practiceState.open) {
    const actual = practicePrayerForTick(tick);
    if (actual) return actual;
    return null;
  }
  const seq = getSelectedPrayerSequence();
  return seq ? seq[solutionPrayerIndexForTick(tick)] : null;
}

export function solutionPrayerIndexForTick(tick: number): number {
  return (tick + 1) % 4;
}

export function recordPracticeTick(tick: number): void {
  state.practiceState.records[tick] = state.practiceState.active;
}

export function practicePrayerForTick(tick: number): Prayer | null {
  return state.practiceState.records[tick] || null;
}

export function practiceGridIcon(prayer: Prayer): string {
  const src = PRAYER_IMG_DATA[prayer];
  return src ? `<span class="practice-grid-prayer"><img src="${src}" alt=""></span>` : "-";
}

export function renderPracticeButtons(): void {
  initializePracticeIcons();
  for (const type of ["mage", "range", "melee"] as Prayer[]) {
    const btn = document.getElementById(
      "practicePrayer" + (type === "range" ? "Range" : type === "mage" ? "Mage" : "Melee"),
    );
    btn?.classList.toggle("lit", state.practiceState.visual.has(type));
  }
}

export function renderPracticeMode(): void {
  const practiceTick = document.getElementById("practiceTick");
  if (practiceTick) practiceTick.textContent = String(state.practiceState.tick);
  const practiceMetronome = document.getElementById("practiceMetronome");
  if (practiceMetronome) practiceMetronome.textContent = String(practiceMetronomeValue());
  if (!state.sim) {
    const tickDisplay = document.getElementById("tickDisplay");
    if (tickDisplay) tickDisplay.innerHTML = `<span>TICK</span><br>${state.practiceState.tick}`;
  }
  renderPracticeButtons();
}

export function practiceMetronomeValue(): number {
  return ((state.practiceState.metronomeStart - 1 + state.practiceState.tick - 1) % 4) + 1;
}

export function setPracticeButtonText(): void {
  const btn = document.getElementById("practiceToggleBtn");
  if (btn) btn.textContent = state.practiceState.open ? "CLOSE PRACTICE" : "PRACTICE";
}

export function exportTilemarker(): void {
  const pos = state.playerPlacement;
  if (!pos) {
    const exportStatus = document.getElementById("exportStatus");
    if (exportStatus) exportStatus.textContent = "No tile selected";
    return;
  }
  // Map game coords to RuneLite tilemarker format
  // regionX = gameX + 16, regionY = 47 - gameY
  const regionX = pos.x + 16;
  const regionY = 47 - pos.y;
  const marker = [{ regionId: 9043, regionX, regionY, z: 0, color: "#FF51B4BA", label: "Start" }];
  const json = JSON.stringify(marker);
  navigator.clipboard
    .writeText(json)
    .then(() => {
      const exportStatus = document.getElementById("exportStatus");
      if (exportStatus) {
        exportStatus.textContent = "Copied to clipboard!";
        exportStatus.style.color = "var(--accent)";
        setTimeout(() => {
          exportStatus.textContent = "";
          exportStatus.style.color = "";
        }, 2000);
      }
    })
    .catch(() => {
      // Fallback
      const ta = document.createElement("textarea");
      ta.value = json;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      const exportStatus = document.getElementById("exportStatus");
      if (exportStatus) {
        exportStatus.textContent = "Copied to clipboard!";
        exportStatus.style.color = "var(--accent)";
        setTimeout(() => {
          exportStatus.textContent = "";
          exportStatus.style.color = "";
        }, 2000);
      }
    });
}
