// =====================================================
// AUTOZUK — gear state and DPS / defence calculations
// =====================================================

import { state } from "./state.js";
import {
  DEFAULT_GEAR_CONFIGS,
  GEAR_SLOTS,
  GEAR_LABELS,
  PLAYER_ACCURACY_TARGETS,
  PLAYER_ACCURACY_LABELS,
  INCOMING_ACCURACY_ROWS,
  GEAR_PRAYERS,
  MAGIC_BOOSTS,
  DEF_BOOSTS,
  WIKI_EQUIPMENT_URL,
  INFERNO_NPCS,
} from "./constants.js";
import { LOADOUTS } from "../sim/constants.js";
import { resetSim } from "./sim.js";
import { setStatus } from "./ui.js";

state.currentLoadoutKey = "ayak";
state.currentLoadout = LOADOUTS.ayak;
state.wikiEquipment = [];
state.wikiLoadStarted = false;
state.gearDraftStats = null;
state.isRenderingGear = false;
state.gearConfigs = JSON.parse(JSON.stringify(DEFAULT_GEAR_CONFIGS));

export function clamp01(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
export function clampStat(v, fallback = 99) {
  v = Number(v);
  if (!Number.isFinite(v)) v = fallback;
  return Math.max(1, Math.min(99, Math.round(v)));
}
export function clampHp(v, fallback = 99) {
  v = Number(v);
  if (!Number.isFinite(v)) v = fallback;
  return Math.max(1, Math.min(115, Math.round(v)));
}
export function cloneGearConfig(config) {
  return JSON.parse(JSON.stringify(config));
}
export function syncSharedGearConfig(sourceKey, sourceConfig) {
  let source = cloneGearConfig(sourceConfig);
  for (let key of Object.keys(DEFAULT_GEAR_CONFIGS)) {
    let existing = state.gearConfigs[key] || cloneGearConfig(DEFAULT_GEAR_CONFIGS[key]);
    let weapon =
      key === sourceKey
        ? (source.gear?.weapon ?? "")
        : (existing.gear?.weapon ?? DEFAULT_GEAR_CONFIGS[key].gear.weapon);
    let next = cloneGearConfig(source);
    next.gear = { ...source.gear, weapon };
    state.gearConfigs[key] = next;
  }
  return state.gearConfigs[sourceKey];
}
export function wikiItemLabel(item) {
  return item.name + (item.version ? " (" + item.version + ")" : "");
}
export function resolveWikiItem(label) {
  return state.wikiEquipment.find((item) => wikiItemLabel(item) === label);
}
export function namedItem(itemOrLabel, name) {
  let text =
    typeof itemOrLabel === "string"
      ? itemOrLabel
      : itemOrLabel?.name || wikiItemLabel(itemOrLabel || {});
  return text.toLowerCase().includes(name.toLowerCase());
}
export function addItemTotals(totals, item) {
  for (let section of ["offensive", "defensive", "bonuses"])
    for (let key in item?.[section] || {})
      totals[section][key] = (totals[section][key] || 0) + item[section][key];
}
export function normalAccuracyRoll(attack, defence) {
  return clamp01(
    attack > defence ? 1 - (defence + 2) / (2 * (attack + 1)) : attack / (2 * (defence + 1)),
  );
}
export function conflictionDoubleAccuracyRoll(attack, defence) {
  if (attack <= 0 || defence < 0) return 0;
  let value =
    attack > defence
      ? 1 - ((defence + 2) * (2 * defence + 3)) / (6 * (attack + 1) * (attack + 1))
      : (attack * (4 * attack + 5)) / (6 * (attack + 1) * (defence + 1));
  return clamp01(value);
}
export function currentDefLevel(base, boostKey) {
  base = clampStat(base);
  let boost = DEF_BOOSTS[boostKey || "none"] || DEF_BOOSTS.none;
  if (boost.decay === null) return base;
  let amount = Math.max(0, Math.floor(base * 0.2) + 2 - boost.decay);
  return base + amount;
}
export function currentMagicLevel(base, boostKey) {
  base = clampStat(base);
  let boost = MAGIC_BOOSTS[boostKey || "none"] || MAGIC_BOOSTS.none;
  return base + boost.amount(base);
}
export function calculateMagicMaxHit(config, key, weapon, totals, prayer, currentMagic) {
  let baseMax = 0,
    warnings = [];
  if (key === "bloodBarrage") {
    baseMax = 29;
  } else if (namedItem(weapon, "eye of ayak")) {
    baseMax = Math.max(0, Math.floor(currentMagic / 3) - 6);
  } else {
    baseMax = LOADOUTS[key]?.maxHit || 0;
    warnings.push(
      "Max hit uses the live preset because this mode expects Eye of ayak or Blood Barrage.",
    );
  }
  let magicDamage = (totals.bonuses.magic_str || 0) + (prayer.magicDmg || 0);
  return {
    maxHit: Math.max(0, baseMax + Math.floor((baseMax * magicDamage) / 1000)),
    baseMax,
    magicDamage,
    warnings,
  };
}
export function getLiveIncomingAcc(loadout, row) {
  let node = loadout.monsterAtk[row.path[0]];
  for (let i = 1; i < row.path.length; i++) node = node?.[row.path[i]];
  return clamp01(node?.acc || 0);
}
export function setLiveIncomingAcc(loadout, row, value) {
  let node = loadout.monsterAtk[row.path[0]];
  for (let i = 1; i < row.path.length; i++) node = node[row.path[i]];
  node.acc = clamp01(value);
}
export function formatPctInput(value) {
  return (clamp01(value) * 100).toFixed(2);
}
export function formatPctDisplay(value) {
  return `${formatPctInput(value)}%`;
}
export function parsePctInput(id, fallback) {
  let el = document.getElementById(id),
    value = Number(el?.value);
  if (!Number.isFinite(value)) return clamp01(fallback);
  return clamp01(value / 100);
}
export function selectedItemsFromConfig(config) {
  let items = [];
  for (let slot of GEAR_SLOTS) {
    let label = config.gear?.[slot];
    let item = label ? resolveWikiItem(label) : null;
    if (item) items.push(item);
  }
  return items;
}
export function deriveRecoilFlags(config, items) {
  let ringLabel = (config.gear?.ring || "").toLowerCase();
  let feetLabel = (config.gear?.feet || "").toLowerCase();
  let hasSuffering =
    ringLabel.includes("ring of suffering") ||
    items.some((item) => namedItem(item, "ring of suffering"));
  let hasRecoilRing =
    ringLabel.includes("ring of recoil") || items.some((item) => namedItem(item, "ring of recoil"));
  let hasRingRecoil = hasSuffering || hasRecoilRing;
  let hasEchoBoots =
    feetLabel.includes("echo boots") || items.some((item) => namedItem(item, "echo boots"));
  return {
    hasRecoil: hasRingRecoil || hasEchoBoots,
    hasRingRecoil,
    hasEchoBoots,
    hasSuffering,
    hasRecoilRing,
  };
}
export function deriveSpecialEffects(config, items) {
  let recoil = deriveRecoilFlags(config, items);
  let weaponLabel = (config.gear?.weapon || "").toLowerCase();
  let hasBloodSceptre =
    weaponLabel.includes("blood ancient sceptre") ||
    items.some((item) => namedItem(item, "blood ancient sceptre"));
  let effects = [];
  if (recoil.hasEchoBoots) effects.push("Echo Boots - Recoil");
  if (recoil.hasSuffering) effects.push("Ring of Suffering - Recoil");
  else if (recoil.hasRecoilRing) effects.push("Ring of Recoil - Recoil");
  if (hasBloodSceptre) effects.push("Blood Sceptre - 10% overheal, +10% healing");
  return { ...recoil, hasBloodSceptre, effects };
}
export function calculateGearDraft(config, key = state.currentLoadoutKey) {
  if (!state.wikiEquipment.length) throw new Error("Wiki equipment is still loading.");
  let totals = { offensive: {}, defensive: {}, bonuses: {} },
    items = [],
    warnings = [];
  for (let slot of GEAR_SLOTS) {
    let label = config.gear?.[slot];
    if (!label) continue;
    let item = resolveWikiItem(label);
    if (!item) {
      warnings.push(`Unknown ${GEAR_LABELS[slot]}: ${label}`);
      continue;
    }
    items.push(item);
    addItemTotals(totals, item);
  }
  let weapon = resolveWikiItem(config.gear?.weapon || "");
  if (!weapon) throw new Error("Choose a weapon from the Wiki equipment list.");
  let prayer = GEAR_PRAYERS[config.prayer] || GEAR_PRAYERS.none;
  let baseMagic = clampStat(config.levels?.magic),
    baseDef = clampStat(config.levels?.def),
    boostedMagic = currentMagicLevel(baseMagic, config.magicBoost),
    boostedDef = currentDefLevel(baseDef, config.defBoost);
  let effectiveMagicAttack = Math.floor((boostedMagic * prayer.acc) / 100) + 9;
  let attackRoll = effectiveMagicAttack * ((totals.offensive.magic || 0) + 64);
  let hasConfliction = items.some((item) => namedItem(item, "confliction gauntlets"));
  let playerAcc = {};
  for (let type of PLAYER_ACCURACY_TARGETS) {
    let npc = INFERNO_NPCS[type],
      defenceRoll = (npc.magic + 9) * ((npc.defensive.magic || 0) + 64);
    let normal = normalAccuracyRoll(attackRoll, defenceRoll);
    let afterMiss = hasConfliction
      ? conflictionDoubleAccuracyRoll(attackRoll, defenceRoll)
      : normal;
    playerAcc[type] = [normal, afterMiss];
  }
  let effectiveDef = Math.floor((boostedDef * prayer.def) / 100);
  let effectiveMagicDef = Math.floor((boostedMagic * prayer.magicDef) / 100);
  function incomingAccuracy(type, style) {
    let npc = INFERNO_NPCS[type],
      defKey =
        style === "range" ? "ranged" : style === "magic" ? "magic" : npc.meleeType || "crush";
    let effective =
      style === "magic"
        ? Math.floor(effectiveMagicDef * 0.7) + Math.floor(effectiveDef * 0.3)
        : effectiveDef;
    let playerDefence = (effective + 8) * ((totals.defensive[defKey] || 0) + 64);
    let npcLevel = style === "magic" ? npc.magic : style === "range" ? npc.ranged : npc.atk;
    let npcOff = (npc.off[defKey] ?? npc.off[style === "range" ? "ranged" : style]) || 0;
    return normalAccuracyRoll((npcLevel + 9) * (npcOff + 64), playerDefence);
  }
  let monsterAcc = {};
  for (let row of INCOMING_ACCURACY_ROWS)
    monsterAcc[row.id] = incomingAccuracy(row.type, row.style);
  let maxHit = calculateMagicMaxHit(config, key, weapon, totals, prayer, boostedMagic);
  warnings.push(...maxHit.warnings);
  let special = deriveSpecialEffects(config, items);
  return {
    key,
    config: cloneGearConfig(config),
    playerAcc,
    monsterAcc,
    recoil: special,
    special,
    maxHit: maxHit.maxHit,
    baseMaxHit: maxHit.baseMax,
    magicDamage: maxHit.magicDamage,
    warnings,
    hasConfliction,
    boosted: { magic: boostedMagic, def: boostedDef },
    weapon: wikiItemLabel(weapon),
    totals,
  };
}

export function populateGearStaticControls() {
  let prayer = document.getElementById("gearPrayer"),
    magic = document.getElementById("gearMagicBoost"),
    def = document.getElementById("gearDefBoost");
  if (prayer && !prayer.options.length)
    for (let [key, value] of Object.entries(GEAR_PRAYERS)) {
      let option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      prayer.appendChild(option);
    }
  if (magic && !magic.options.length)
    for (let [key, value] of Object.entries(MAGIC_BOOSTS)) {
      let option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      magic.appendChild(option);
    }
  if (def && !def.options.length)
    for (let [key, value] of Object.entries(DEF_BOOSTS)) {
      let option = document.createElement("option");
      option.value = key;
      option.textContent = value.name;
      def.appendChild(option);
    }
  renderGearSlots();
}
export function renderGearSlots() {
  let container = document.getElementById("gearSlots");
  if (!container) return;
  if (container.childNodes.length === 0) {
    for (let slot of GEAR_SLOTS) {
      let field = document.createElement("div");
      field.className = "gear-field" + (slot === "weapon" ? " weapon-slot" : "");
      let label = document.createElement("label");
      label.textContent = GEAR_LABELS[slot];
      let input = document.createElement("input");
      input.id = "gear-slot-" + slot;
      input.type = "text";
      input.placeholder = "None";
      input.setAttribute("list", "wiki-slot-" + slot);
      input.addEventListener("input", () => {
        if (!state.isRenderingGear) recalculateGearDraft();
      });
      let list = document.createElement("datalist");
      list.id = "wiki-slot-" + slot;
      field.append(label, input, list);
      container.appendChild(field);
    }
  }
  if (!state.wikiEquipment.length) return;
  for (let slot of GEAR_SLOTS) {
    let list = document.getElementById("wiki-slot-" + slot);
    if (!list) continue;
    list.innerHTML = "";
    let fragment = document.createDocumentFragment();
    for (let item of state.wikiEquipment.filter((i) => i.slot === slot)) {
      let option = document.createElement("option");
      option.value = wikiItemLabel(item);
      fragment.appendChild(option);
    }
    list.appendChild(fragment);
  }
}
export function validateGearAgainstWiki(config) {
  if (!state.wikiEquipment.length) return;
  for (let slot of GEAR_SLOTS) {
    let label = config.gear?.[slot];
    if (label && !resolveWikiItem(label)) config.gear[slot] = "";
  }
}
export async function loadWikiGearData() {
  if (state.wikiEquipment.length) {
    renderGearSlots();
    recalculateGearDraft();
    return;
  }
  if (state.wikiLoadStarted) return;
  state.wikiLoadStarted = true;
  try {
    let data = window.autozukDesktop?.getWikiEquipment
      ? await window.autozukDesktop.getWikiEquipment()
      : await fetch(WIKI_EQUIPMENT_URL).then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        });
    state.wikiEquipment = (Array.isArray(data) ? data : Object.values(data || {})).filter(
      (item) => item?.name && GEAR_SLOTS.includes(item.slot),
    );
    state.wikiEquipment.sort((a, b) => wikiItemLabel(a).localeCompare(wikiItemLabel(b)));
    for (let key in state.gearConfigs) validateGearAgainstWiki(state.gearConfigs[key]);
    renderGearSlots();
    renderGearDraft(state.currentLoadoutKey);
  } catch (error) {
    state.wikiLoadStarted = false;
    renderGearStatsPanel(null, error.message);
  }
}
export function getEditorGearConfig() {
  return {
    levels: {
      magic: clampStat(editorNumber("gearLvlMagic", 99)),
      def: clampStat(editorNumber("gearLvlDef", 99)),
      hp: clampHp(editorNumber("gearLvlHp", 99)),
    },
    prayer: document.getElementById("gearPrayer")?.value || "augury",
    magicBoost: document.getElementById("gearMagicBoost")?.value || "none",
    defBoost: document.getElementById("gearDefBoost")?.value || "brew",
    gear: getSelectedGear(),
  };
}
export function renderGearDraft(key = state.currentLoadoutKey) {
  let config =
    state.gearConfigs[key] ||
    cloneGearConfig(DEFAULT_GEAR_CONFIGS[key] || DEFAULT_GEAR_CONFIGS.ayak);
  state.gearConfigs[key] = config;
  state.isRenderingGear = true;
  let magic = document.getElementById("gearLvlMagic"),
    def = document.getElementById("gearLvlDef"),
    hp = document.getElementById("gearLvlHp"),
    prayer = document.getElementById("gearPrayer"),
    magicBoost = document.getElementById("gearMagicBoost"),
    defBoost = document.getElementById("gearDefBoost");
  if (magic) magic.value = config.levels?.magic ?? 99;
  if (def) def.value = config.levels?.def ?? 99;
  if (hp) hp.value = config.levels?.hp ?? 99;
  if (prayer) prayer.value = config.prayer || "augury";
  if (magicBoost) magicBoost.value = config.magicBoost || "none";
  if (defBoost) defBoost.value = config.defBoost || "brew";
  for (let slot of GEAR_SLOTS) {
    let input = document.getElementById("gear-slot-" + slot);
    if (input) input.value = config.gear?.[slot] || "";
  }
  state.isRenderingGear = false;
  recalculateGearDraft();
}
export function recalculateGearDraft() {
  if (state.isRenderingGear) return;
  if (!document.getElementById("gearStatsPanel")) return;
  let config = syncSharedGearConfig(state.currentLoadoutKey, getEditorGearConfig());
  let magicCurrent = document.getElementById("gearCurrentMagic"),
    defCurrent = document.getElementById("gearCurrentDef");
  if (magicCurrent)
    magicCurrent.textContent = currentMagicLevel(config.levels.magic, config.magicBoost);
  if (defCurrent) defCurrent.textContent = currentDefLevel(config.levels.def, config.defBoost);
  try {
    state.gearDraftStats = calculateGearDraft(config, state.currentLoadoutKey);
    renderGearStatsPanel(state.gearDraftStats);
  } catch (error) {
    state.gearDraftStats = null;
    renderGearStatsPanel(null, error.message);
  }
}
export function renderGearStatsPanel(draft, errorMessage) {
  let panel = document.getElementById("gearStatsPanel");
  if (!panel) return;
  let loadout = LOADOUTS[state.currentLoadoutKey] || LOADOUTS.ayak;
  renderSpecialEffects(draft);
  let title = errorMessage
    ? `<div class="gear-note" style="color:#ff7777">${htmlEscape(errorMessage)}</div>`
    : "";
  if (!draft) {
    panel.innerHTML = title;
    return;
  }
  let liveMaxHit = loadout.maxHit || 0;
  let maxHitRow = `<span>Max Hit</span><input id="draft-max-hit" type="number" min="0" max="200" step="1" value="${Math.max(0, Math.round(draft.maxHit || 0))}"><span class="live">${liveMaxHit}</span>`;
  let playerRows = PLAYER_ACCURACY_TARGETS.map((type) => {
    let values = draft.playerAcc[type] || [0, 0],
      live = loadout.playerAcc[type] || [0, 0];
    return `<span>${PLAYER_ACCURACY_LABELS[type]}</span><input id="draft-player-${type}-hit" type="number" min="0" max="100" step="0.01" value="${formatPctInput(values[0])}"><input id="draft-player-${type}-miss" type="number" min="0" max="100" step="0.01" value="${formatPctInput(values[1])}"><span class="live">${formatPctDisplay(live[0])} / ${formatPctDisplay(live[1])}</span>`;
  }).join("");
  let monsterRows = INCOMING_ACCURACY_ROWS.map((row) => {
    let draftValue = draft.monsterAcc[row.id] || 0,
      liveValue = getLiveIncomingAcc(loadout, row);
    return `<span>${row.label}</span><input id="draft-monster-${row.id}" type="number" min="0" max="100" step="0.01" value="${formatPctInput(draftValue)}"><span class="live">${formatPctDisplay(liveValue)}</span>`;
  }).join("");
  let warning = draft.warnings.length
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
export function renderSpecialEffects(draft) {
  let box = document.getElementById("gearSpecialEffects");
  if (!box) return;
  let effects = draft?.special?.effects || draft?.recoil?.effects || [];
  if (!effects.length) {
    box.textContent = "No active special effects.";
    return;
  }
  box.innerHTML = effects.map((effect) => `<div>${htmlEscape(effect)}</div>`).join("");
}
export function collectDraftStatsFromInputs() {
  if (!state.gearDraftStats) return null;
  let draft = JSON.parse(JSON.stringify(state.gearDraftStats));
  draft.maxHit = Math.max(
    0,
    Math.round(Number(document.getElementById("draft-max-hit")?.value) || draft.maxHit || 0),
  );
  for (let type of PLAYER_ACCURACY_TARGETS) {
    draft.playerAcc[type] = [
      parsePctInput(`draft-player-${type}-hit`, draft.playerAcc[type]?.[0]),
      parsePctInput(`draft-player-${type}-miss`, draft.playerAcc[type]?.[1]),
    ];
  }
  for (let row of INCOMING_ACCURACY_ROWS)
    draft.monsterAcc[row.id] = parsePctInput(`draft-monster-${row.id}`, draft.monsterAcc[row.id]);
  return draft;
}
export function applyGearStats() {
  let draft = collectDraftStatsFromInputs(),
    status = document.getElementById("gearStatus");
  if (!draft) {
    if (status) status.textContent = "No draft stats ready yet.";
    return;
  }
  let loadout = LOADOUTS[state.currentLoadoutKey] || LOADOUTS.ayak;
  for (let type of PLAYER_ACCURACY_TARGETS)
    loadout.playerAcc[type] = [
      clamp01(draft.playerAcc[type][0]),
      clamp01(draft.playerAcc[type][1]),
    ];
  for (let row of INCOMING_ACCURACY_ROWS)
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
export function openEquipmentSelector() {
  populateGearStaticControls();
  document.getElementById("gearModal")?.classList.add("open");
  state.currentLoadout = LOADOUTS[state.currentLoadoutKey] || LOADOUTS.ayak;
  renderGearDraft(state.currentLoadoutKey);
  loadWikiGearData();
}
export function closeEquipmentSelector() {
  document.getElementById("gearModal")?.classList.remove("open");
}
export function updateActiveLoadoutSummary() {
  let select = document.getElementById("activeLoadoutSelect");
  if (select) select.value = state.currentLoadoutKey;
}
export function initializeEquipmentSelector() {
  populateGearStaticControls();
  updateActiveLoadoutSummary();
  let modal = document.getElementById("gearModal");
  if (modal)
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeEquipmentSelector();
    });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.getElementById("gearModal")?.classList.contains("open"))
      closeEquipmentSelector();
  });
}
function htmlEscape(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function editorNumber(id, fallback = 99) {
  let value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}
function getSelectedGear() {
  let gear = {};
  for (let slot of GEAR_SLOTS) {
    let input = document.getElementById("gear-slot-" + slot);
    gear[slot] = input?.value.trim() || "";
  }
  return gear;
}
