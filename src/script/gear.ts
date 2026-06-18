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
  type GearPrayer,
  type IncomingAccuracyRow,
} from "./constants.js";
import { LOADOUTS } from "../sim/constants.js";
import type { GearConfig, GearDraftStats, Loadout, WikiEquipment } from "../types.js";
import { resetSim } from "./sim.js";
import { setStatus } from "./ui.js";

declare global {
  interface Window {
    autozukDesktop?: {
      getWikiEquipment: () => Promise<WikiEquipment[]>;
    };
  }
}

state.currentLoadoutKey = "ayak";
state.currentLoadout = LOADOUTS.ayak;
state.wikiEquipment = [];
state.wikiLoadStarted = false;
state.gearDraftStats = null;
state.isRenderingGear = false;
state.gearConfigs = JSON.parse(JSON.stringify(DEFAULT_GEAR_CONFIGS));

export function clamp01(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
}

export function clampStat(v: unknown, fallback = 99): number {
  let n = Number(v);
  if (!Number.isFinite(n)) n = fallback;
  return Math.max(1, Math.min(99, Math.round(n)));
}

export function clampHp(v: unknown, fallback = 99): number {
  let n = Number(v);
  if (!Number.isFinite(n)) n = fallback;
  return Math.max(1, Math.min(115, Math.round(n)));
}

export function cloneGearConfig(config: GearConfig): GearConfig {
  return JSON.parse(JSON.stringify(config));
}

export function syncSharedGearConfig(sourceKey: string, sourceConfig: GearConfig): GearConfig {
  const source = cloneGearConfig(sourceConfig);
  for (const key of Object.keys(DEFAULT_GEAR_CONFIGS)) {
    const existing = state.gearConfigs[key] || cloneGearConfig(DEFAULT_GEAR_CONFIGS[key]);
    const weapon =
      key === sourceKey
        ? (source.gear.weapon ?? "")
        : (existing.gear.weapon ?? DEFAULT_GEAR_CONFIGS[key].gear.weapon);
    const next = cloneGearConfig(source);
    next.gear = { ...source.gear, weapon };
    state.gearConfigs[key] = next;
  }
  return state.gearConfigs[sourceKey];
}

export function wikiItemLabel(item: WikiEquipment): string {
  return item.name + (item.version ? " (" + item.version + ")" : "");
}

export function resolveWikiItem(label: string | undefined): WikiEquipment | undefined {
  return state.wikiEquipment.find((item) => wikiItemLabel(item) === label);
}

export function namedItem(
  itemOrLabel: WikiEquipment | string | null | undefined,
  name: string,
): boolean {
  const text =
    typeof itemOrLabel === "string"
      ? itemOrLabel
      : itemOrLabel?.name || wikiItemLabel(itemOrLabel || ({} as WikiEquipment));
  return text.toLowerCase().includes(name.toLowerCase());
}

export function addItemTotals(totals: GearDraftStats["totals"], item: WikiEquipment): void {
  for (const section of ["offensive", "defensive", "bonuses"] as const) {
    for (const key in item[section] || {}) {
      totals[section][key] = (totals[section][key] || 0) + item[section]![key];
    }
  }
}

export function normalAccuracyRoll(attack: number, defence: number): number {
  return clamp01(
    attack > defence ? 1 - (defence + 2) / (2 * (attack + 1)) : attack / (2 * (defence + 1)),
  );
}

export function conflictionDoubleAccuracyRoll(attack: number, defence: number): number {
  if (attack <= 0 || defence < 0) return 0;
  const value =
    attack > defence
      ? 1 - ((defence + 2) * (2 * defence + 3)) / (6 * (attack + 1) * (attack + 1))
      : (attack * (4 * attack + 5)) / (6 * (attack + 1) * (defence + 1));
  return clamp01(value);
}

export function currentDefLevel(base: unknown, boostKey: string): number {
  const clamped = clampStat(base);
  const boost = DEF_BOOSTS[boostKey || "none"] || DEF_BOOSTS.none;
  if (boost.decay === null) return clamped;
  const amount = Math.max(0, Math.floor(clamped * 0.2) + 2 - boost.decay);
  return clamped + amount;
}

export function currentMagicLevel(base: unknown, boostKey: string): number {
  const clamped = clampStat(base);
  const boost = MAGIC_BOOSTS[boostKey || "none"] || MAGIC_BOOSTS.none;
  return clamped + boost.amount(clamped);
}

export function calculateMagicMaxHit(
  config: GearConfig,
  key: string,
  weapon: WikiEquipment,
  totals: GearDraftStats["totals"],
  prayer: GearPrayer,
  currentMagic: number,
): { maxHit: number; baseMax: number; magicDamage: number; warnings: string[] } {
  let baseMax = 0;
  const warnings: string[] = [];
  if (key === "bloodBarrage") {
    baseMax = 29;
  } else if (namedItem(weapon, "eye of ayak")) {
    baseMax = Math.max(0, Math.floor(currentMagic / 3) - 6);
  } else {
    baseMax = LOADOUTS[key as keyof typeof LOADOUTS]?.maxHit || 0;
    warnings.push(
      "Max hit uses the live preset because this mode expects Eye of ayak or Blood Barrage.",
    );
  }
  const magicDamage = (totals.bonuses.magic_str || 0) + (prayer.magicDmg || 0);
  return {
    maxHit: Math.max(0, baseMax + Math.floor((baseMax * magicDamage) / 1000)),
    baseMax,
    magicDamage,
    warnings,
  };
}

export function getLiveIncomingAcc(loadout: Loadout, row: IncomingAccuracyRow): number {
  let node: unknown = loadout.monsterAtk[row.path[0]];
  for (let i = 1; i < row.path.length; i++) {
    if (node && typeof node === "object") node = (node as Record<string, unknown>)[row.path[i]];
  }
  return clamp01((node && typeof node === "object" ? (node as { acc?: number }).acc : 0) || 0);
}

export function setLiveIncomingAcc(
  loadout: Loadout,
  row: IncomingAccuracyRow,
  value: number,
): void {
  let node: Record<string, unknown> = loadout.monsterAtk[row.path[0]] as Record<string, unknown>;
  for (let i = 1; i < row.path.length; i++) node = node[row.path[i]] as Record<string, unknown>;
  node.acc = clamp01(value);
}

export function formatPctInput(value: number): string {
  return (clamp01(value) * 100).toFixed(2);
}

export function formatPctDisplay(value: number): string {
  return `${formatPctInput(value)}%`;
}

export function parsePctInput(id: string, fallback: number): number {
  const el = document.getElementById(id) as HTMLInputElement | null;
  const value = Number(el?.value);
  if (!Number.isFinite(value)) return clamp01(fallback);
  return clamp01(value / 100);
}

export function selectedItemsFromConfig(config: GearConfig): WikiEquipment[] {
  const items: WikiEquipment[] = [];
  for (const slot of GEAR_SLOTS) {
    const label = config.gear[slot];
    const item = label ? resolveWikiItem(label) : null;
    if (item) items.push(item);
  }
  return items;
}

export function deriveRecoilFlags(
  config: GearConfig,
  items: WikiEquipment[],
): GearDraftStats["recoil"] {
  const ringLabel = (config.gear.ring || "").toLowerCase();
  const feetLabel = (config.gear.feet || "").toLowerCase();
  const hasSuffering =
    ringLabel.includes("ring of suffering") ||
    items.some((item) => namedItem(item, "ring of suffering"));
  const hasRecoilRing =
    ringLabel.includes("ring of recoil") || items.some((item) => namedItem(item, "ring of recoil"));
  const hasRingRecoil = hasSuffering || hasRecoilRing;
  const hasEchoBoots =
    feetLabel.includes("echo boots") || items.some((item) => namedItem(item, "echo boots"));
  return {
    hasRecoil: hasRingRecoil || hasEchoBoots,
    hasRingRecoil,
    hasEchoBoots,
    hasSuffering,
    hasRecoilRing,
    hasBloodSceptre: false,
    effects: [],
  };
}

export function deriveSpecialEffects(
  config: GearConfig,
  items: WikiEquipment[],
): GearDraftStats["special"] {
  const recoil = deriveRecoilFlags(config, items);
  const weaponLabel = (config.gear.weapon || "").toLowerCase();
  const hasBloodSceptre =
    weaponLabel.includes("blood ancient sceptre") ||
    items.some((item) => namedItem(item, "blood ancient sceptre"));
  const effects: string[] = [];
  if (recoil.hasEchoBoots) effects.push("Echo Boots - Recoil");
  if (recoil.hasSuffering) effects.push("Ring of Suffering - Recoil");
  else if (recoil.hasRecoilRing) effects.push("Ring of Recoil - Recoil");
  if (hasBloodSceptre) effects.push("Blood Sceptre - 10% overheal, +10% healing");
  return { ...recoil, hasBloodSceptre, effects };
}

export function calculateGearDraft(
  config: GearConfig,
  key = state.currentLoadoutKey,
): GearDraftStats {
  if (!state.wikiEquipment.length) throw new Error("Wiki equipment is still loading.");
  const totals: GearDraftStats["totals"] = { offensive: {}, defensive: {}, bonuses: {} };
  const items: WikiEquipment[] = [];
  const warnings: string[] = [];
  for (const slot of GEAR_SLOTS) {
    const label = config.gear[slot];
    if (!label) continue;
    const item = resolveWikiItem(label);
    if (!item) {
      warnings.push(`Unknown ${GEAR_LABELS[slot]}: ${label}`);
      continue;
    }
    items.push(item);
    addItemTotals(totals, item);
  }
  const weapon = resolveWikiItem(config.gear.weapon || "");
  if (!weapon) throw new Error("Choose a weapon from the Wiki equipment list.");
  const prayer = GEAR_PRAYERS[config.prayer] || GEAR_PRAYERS.none;
  const baseMagic = clampStat(config.levels.magic);
  const baseDef = clampStat(config.levels.def);
  const boostedMagic = currentMagicLevel(baseMagic, config.magicBoost);
  const boostedDef = currentDefLevel(baseDef, config.defBoost);
  const effectiveMagicAttack = Math.floor((boostedMagic * prayer.acc) / 100) + 9;
  const attackRoll = effectiveMagicAttack * ((totals.offensive.magic || 0) + 64);
  const hasConfliction = items.some((item) => namedItem(item, "confliction gauntlets"));
  const playerAcc: Record<string, [number, number]> = {};
  for (const type of PLAYER_ACCURACY_TARGETS) {
    const npc = INFERNO_NPCS[type];
    const defenceRoll = (npc.magic + 9) * ((npc.defensive.magic || 0) + 64);
    const normal = normalAccuracyRoll(attackRoll, defenceRoll);
    const afterMiss = hasConfliction
      ? conflictionDoubleAccuracyRoll(attackRoll, defenceRoll)
      : normal;
    playerAcc[type] = [normal, afterMiss];
  }
  const effectiveDef = Math.floor((boostedDef * prayer.def) / 100);
  const effectiveMagicDef = Math.floor((boostedMagic * prayer.magicDef) / 100);
  function incomingAccuracy(type: string, style: string): number {
    const npc = INFERNO_NPCS[type];
    const defKey =
      style === "range" ? "ranged" : style === "magic" ? "magic" : npc.meleeType || "crush";
    const effective =
      style === "magic"
        ? Math.floor(effectiveMagicDef * 0.7) + Math.floor(effectiveDef * 0.3)
        : effectiveDef;
    const playerDefence = (effective + 8) * ((totals.defensive[defKey] || 0) + 64);
    const npcLevel = style === "magic" ? npc.magic : style === "range" ? npc.ranged : npc.atk;
    const npcOff =
      (npc.off[defKey] ??
        npc.off[style === "range" ? "ranged" : style === "magic" ? "magic" : "melee"]) ||
      0;
    return normalAccuracyRoll((npcLevel + 9) * (npcOff + 64), playerDefence);
  }
  const monsterAcc: Record<string, number> = {};
  for (const row of INCOMING_ACCURACY_ROWS)
    monsterAcc[row.id] = incomingAccuracy(row.type, row.style);
  const maxHit = calculateMagicMaxHit(config, key, weapon, totals, prayer, boostedMagic);
  warnings.push(...maxHit.warnings);
  const special = deriveSpecialEffects(config, items);
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
  if (magic) magic.value = String(config.levels.magic ?? 99);
  if (def) def.value = String(config.levels.def ?? 99);
  if (hp) hp.value = String(config.levels.hp ?? 99);
  if (prayer) prayer.value = config.prayer || "augury";
  if (magicBoost) magicBoost.value = config.magicBoost || "none";
  if (defBoost) defBoost.value = config.defBoost || "brew";
  for (const slot of GEAR_SLOTS) {
    const input = document.getElementById("gear-slot-" + slot) as HTMLInputElement | null;
    if (input) input.value = config.gear[slot] || "";
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
  const loadout = LOADOUTS[state.currentLoadoutKey] || LOADOUTS.ayak;
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
  const loadout = LOADOUTS[state.currentLoadoutKey] || LOADOUTS.ayak;
  for (const type of PLAYER_ACCURACY_TARGETS)
    loadout.playerAcc[type] = [
      clamp01(draft.playerAcc[type][0]),
      clamp01(draft.playerAcc[type][1]),
    ];
  for (const row of INCOMING_ACCURACY_ROWS)
    setLiveIncomingAcc(loadout, row, draft.monsterAcc[row.id]);
  loadout.maxHit = Math.max(0, Math.round(draft.maxHit || loadout.maxHit || 0));
  loadout.startingHp = clampHp(draft.config.levels.hp || loadout.startingHp || 99);
  loadout.hasRingRecoil = !!draft.recoil.hasRingRecoil;
  loadout.hasEchoBoots = !!draft.recoil.hasEchoBoots;
  loadout.hasRecoil = loadout.hasRingRecoil || loadout.hasEchoBoots;
  loadout.hasBloodSceptre = !!draft.special.hasBloodSceptre;
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
  state.currentLoadout = LOADOUTS[state.currentLoadoutKey] || LOADOUTS.ayak;
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

function htmlEscape(text: string | number | boolean | null | undefined): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function editorNumber(id: string, fallback = 99): number {
  const value = Number((document.getElementById(id) as HTMLInputElement | null)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function getSelectedGear(): Record<string, string> {
  const gear: Record<string, string> = {};
  for (const slot of GEAR_SLOTS) {
    const input = document.getElementById("gear-slot-" + slot) as HTMLInputElement | null;
    gear[slot] = input?.value.trim() || "";
  }
  return gear;
}
