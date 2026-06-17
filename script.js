// =====================================================
// AUTOZUK — Phase 1 Sim Engine + Phase 2 Solver
// =====================================================

function isDarkColor(c) {
  let r = parseInt(c.slice(1, 3), 16),
    g = parseInt(c.slice(3, 5), 16),
    b = parseInt(c.slice(5, 7), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 < 128;
}

let currentLoadoutKey = "ayak";
let currentLoadout = LOADOUTS.ayak;

let wikiEquipment = [],
  wikiLoadStarted = false,
  gearDraftStats = null,
  isRenderingGear = false;
let gearConfigs = JSON.parse(JSON.stringify(DEFAULT_GEAR_CONFIGS));

function htmlEscape(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function clamp01(v) {
  v = Number(v);
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}
function clampStat(v, fallback = 99) {
  v = Number(v);
  if (!Number.isFinite(v)) v = fallback;
  return Math.max(1, Math.min(99, Math.round(v)));
}
function clampHp(v, fallback = 99) {
  v = Number(v);
  if (!Number.isFinite(v)) v = fallback;
  return Math.max(1, Math.min(115, Math.round(v)));
}
function editorNumber(id, fallback = 99) {
  let value = Number(document.getElementById(id)?.value);
  return Number.isFinite(value) ? value : fallback;
}
function cloneGearConfig(config) {
  return JSON.parse(JSON.stringify(config));
}
function syncSharedGearConfig(sourceKey, sourceConfig) {
  let source = cloneGearConfig(sourceConfig);
  for (let key of Object.keys(DEFAULT_GEAR_CONFIGS)) {
    let existing = gearConfigs[key] || cloneGearConfig(DEFAULT_GEAR_CONFIGS[key]);
    let weapon =
      key === sourceKey
        ? (source.gear?.weapon ?? "")
        : (existing.gear?.weapon ?? DEFAULT_GEAR_CONFIGS[key].gear.weapon);
    let next = cloneGearConfig(source);
    next.gear = { ...(source.gear || {}), weapon };
    gearConfigs[key] = next;
  }
  return gearConfigs[sourceKey];
}
function wikiItemLabel(item) {
  return item.name + (item.version ? " (" + item.version + ")" : "");
}
function resolveWikiItem(label) {
  return wikiEquipment.find((item) => wikiItemLabel(item) === label);
}
function namedItem(itemOrLabel, name) {
  let text =
    typeof itemOrLabel === "string"
      ? itemOrLabel
      : itemOrLabel?.name || wikiItemLabel(itemOrLabel || {});
  return text.toLowerCase().includes(name.toLowerCase());
}
function addItemTotals(totals, item) {
  for (let section of ["offensive", "defensive", "bonuses"])
    for (let key in item?.[section] || {})
      totals[section][key] = (totals[section][key] || 0) + item[section][key];
}
function normalAccuracyRoll(attack, defence) {
  return clamp01(
    attack > defence ? 1 - (defence + 2) / (2 * (attack + 1)) : attack / (2 * (defence + 1)),
  );
}
function conflictionDoubleAccuracyRoll(attack, defence) {
  if (attack <= 0 || defence < 0) return 0;
  let value =
    attack > defence
      ? 1 - ((defence + 2) * (2 * defence + 3)) / (6 * (attack + 1) * (attack + 1))
      : (attack * (4 * attack + 5)) / (6 * (attack + 1) * (defence + 1));
  return clamp01(value);
}
function currentDefLevel(base, boostKey) {
  base = clampStat(base);
  let boost = DEF_BOOSTS[boostKey || "none"] || DEF_BOOSTS.none;
  if (boost.decay === null) return base;
  let amount = Math.max(0, Math.floor(base * 0.2) + 2 - boost.decay);
  return base + amount;
}
function currentMagicLevel(base, boostKey) {
  base = clampStat(base);
  let boost = MAGIC_BOOSTS[boostKey || "none"] || MAGIC_BOOSTS.none;
  return base + boost.amount(base);
}
function calculateMagicMaxHit(config, key, weapon, totals, prayer, currentMagic) {
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
function getSelectedGear() {
  let gear = {};
  for (let slot of GEAR_SLOTS) {
    let input = document.getElementById("gear-slot-" + slot);
    gear[slot] = input?.value.trim() || "";
  }
  return gear;
}
function getLiveIncomingAcc(loadout, row) {
  let node = loadout.monsterAtk[row.path[0]];
  for (let i = 1; i < row.path.length; i++) node = node?.[row.path[i]];
  return clamp01(node?.acc || 0);
}
function setLiveIncomingAcc(loadout, row, value) {
  let node = loadout.monsterAtk[row.path[0]];
  for (let i = 1; i < row.path.length; i++) node = node[row.path[i]];
  node.acc = clamp01(value);
}
function formatPctInput(value) {
  return (clamp01(value) * 100).toFixed(2);
}
function formatPctDisplay(value) {
  return `${formatPctInput(value)}%`;
}
function parsePctInput(id, fallback) {
  let el = document.getElementById(id),
    value = Number(el?.value);
  if (!Number.isFinite(value)) return clamp01(fallback);
  return clamp01(value / 100);
}
function selectedItemsFromConfig(config) {
  let items = [];
  for (let slot of GEAR_SLOTS) {
    let label = config.gear?.[slot];
    let item = label ? resolveWikiItem(label) : null;
    if (item) items.push(item);
  }
  return items;
}
function deriveRecoilFlags(config, items) {
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
function deriveSpecialEffects(config, items) {
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
function calculateGearDraft(config, key = currentLoadoutKey) {
  if (!wikiEquipment.length) throw new Error("Wiki equipment is still loading.");
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
function populateGearStaticControls() {
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
function renderGearSlots() {
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
        if (!isRenderingGear) recalculateGearDraft();
      });
      let list = document.createElement("datalist");
      list.id = "wiki-slot-" + slot;
      field.append(label, input, list);
      container.appendChild(field);
    }
  }
  if (!wikiEquipment.length) return;
  for (let slot of GEAR_SLOTS) {
    let list = document.getElementById("wiki-slot-" + slot);
    if (!list) continue;
    list.innerHTML = "";
    let fragment = document.createDocumentFragment();
    for (let item of wikiEquipment.filter((i) => i.slot === slot)) {
      let option = document.createElement("option");
      option.value = wikiItemLabel(item);
      fragment.appendChild(option);
    }
    list.appendChild(fragment);
  }
}
function validateGearAgainstWiki(config) {
  if (!wikiEquipment.length) return;
  for (let slot of GEAR_SLOTS) {
    let label = config.gear?.[slot];
    if (label && !resolveWikiItem(label)) config.gear[slot] = "";
  }
}
async function loadWikiGearData() {
  if (wikiEquipment.length) {
    renderGearSlots();
    recalculateGearDraft();
    return;
  }
  if (wikiLoadStarted) return;
  wikiLoadStarted = true;
  try {
    let data = window.autozukDesktop?.getWikiEquipment
      ? await window.autozukDesktop.getWikiEquipment()
      : await fetch(WIKI_EQUIPMENT_URL).then((response) => {
          if (!response.ok) throw new Error("HTTP " + response.status);
          return response.json();
        });
    wikiEquipment = (Array.isArray(data) ? data : Object.values(data || {})).filter(
      (item) => item?.name && GEAR_SLOTS.includes(item.slot),
    );
    wikiEquipment.sort((a, b) => wikiItemLabel(a).localeCompare(wikiItemLabel(b)));
    for (let key in gearConfigs) validateGearAgainstWiki(gearConfigs[key]);
    renderGearSlots();
    renderGearDraft(currentLoadoutKey);
  } catch (error) {
    wikiLoadStarted = false;
    renderGearStatsPanel(null, error.message);
  }
}
function getEditorGearConfig() {
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
function renderGearDraft(key = currentLoadoutKey) {
  let config =
    gearConfigs[key] || cloneGearConfig(DEFAULT_GEAR_CONFIGS[key] || DEFAULT_GEAR_CONFIGS.ayak);
  gearConfigs[key] = config;
  isRenderingGear = true;
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
  isRenderingGear = false;
  recalculateGearDraft();
}
function recalculateGearDraft() {
  if (isRenderingGear) return;
  if (!document.getElementById("gearStatsPanel")) return;
  let config = syncSharedGearConfig(currentLoadoutKey, getEditorGearConfig());
  let magicCurrent = document.getElementById("gearCurrentMagic"),
    defCurrent = document.getElementById("gearCurrentDef");
  if (magicCurrent)
    magicCurrent.textContent = currentMagicLevel(config.levels.magic, config.magicBoost);
  if (defCurrent) defCurrent.textContent = currentDefLevel(config.levels.def, config.defBoost);
  try {
    gearDraftStats = calculateGearDraft(config, currentLoadoutKey);
    renderGearStatsPanel(gearDraftStats);
  } catch (error) {
    gearDraftStats = null;
    renderGearStatsPanel(null, error.message);
  }
}
function renderGearStatsPanel(draft, errorMessage) {
  let panel = document.getElementById("gearStatsPanel");
  if (!panel) return;
  let loadout = LOADOUTS[currentLoadoutKey] || LOADOUTS.ayak;
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
function renderSpecialEffects(draft) {
  let box = document.getElementById("gearSpecialEffects");
  if (!box) return;
  let effects = draft?.special?.effects || draft?.recoil?.effects || [];
  if (!effects.length) {
    box.textContent = "No active special effects.";
    return;
  }
  box.innerHTML = effects.map((effect) => `<div>${htmlEscape(effect)}</div>`).join("");
}
function collectDraftStatsFromInputs() {
  if (!gearDraftStats) return null;
  let draft = JSON.parse(JSON.stringify(gearDraftStats));
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
function applyGearStats() {
  let draft = collectDraftStatsFromInputs(),
    status = document.getElementById("gearStatus");
  if (!draft) {
    if (status) status.textContent = "No draft stats ready yet.";
    return;
  }
  let loadout = LOADOUTS[currentLoadoutKey] || LOADOUTS.ayak;
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
  currentLoadout = loadout;
  gearDraftStats = draft;
  renderGearStatsPanel(draft);
  updateActiveLoadoutSummary();
  if (sim) {
    resetSim();
    setStatus(
      "Gear stats updated; manual simulation reset to avoid mixing old and new rolls.",
      "info",
    );
  }
  if (status) status.textContent = "Live AUTOZUK values updated";
}
function openEquipmentSelector() {
  populateGearStaticControls();
  document.getElementById("gearModal")?.classList.add("open");
  currentLoadout = LOADOUTS[currentLoadoutKey] || LOADOUTS.ayak;
  renderGearDraft(currentLoadoutKey);
  loadWikiGearData();
}
function closeEquipmentSelector() {
  document.getElementById("gearModal")?.classList.remove("open");
}
function updateActiveLoadoutSummary() {
  let select = document.getElementById("activeLoadoutSelect");
  if (select) select.value = currentLoadoutKey;
}
function initializeEquipmentSelector() {
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

// ===== PHASE 1: STATE =====
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

// ===== PHASE 2: STATE =====
let autozukRunning = false,
  autozukResults = {},
  autozukMode = false,
  autozukHidden = false;
let selectedTile = null,
  excludedTiles = new Set();
let activePrayerSeq = null; // 4-slot prayer sequence for tick grid display
let solverPreviewState = null;
let facingSouth = true;
function drawFlipText(t, x, y) {
  if (facingSouth) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(-1, -1);
    ctx.fillText(t, 0, 0);
    ctx.restore();
  } else ctx.fillText(t, x, y);
}
function drawHealthBar(bx, byAbove, byBelow, bw, pct) {
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

const canvas = document.getElementById("grid");
const ctx = canvas.getContext("2d");
let TILE_SIZE = 20;

function resizeCanvas() {
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
window.addEventListener("resize", resizeCanvas);

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

function toggleCompass() {
  facingSouth = !facingSouth;
  document.getElementById("compassBtn").textContent = facingSouth ? "S" : "N";
  render();
}
function toggleLegend() {
  let popup = document.getElementById("legendPopup");
  let btn = document.getElementById("legendBtn");
  if (btn.style.display !== "none") {
    btn.style.display = "none";
    let content = document.createElement("div");
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
    let content = document.getElementById("legendContent");
    if (content) content.remove();
  }
}
function updatePrayerStrip() {
  let strip = document.getElementById("prayerStrip");
  let seq = activePrayerSeq;
  if (!seq && playerPlacement) {
    let pk = `${playerPlacement.x},${playerPlacement.y}`;
    if (autozukResults[pk]) seq = autozukResults[pk].prayer;
  }
  if (!seq) {
    strip.style.display = "none";
    return;
  }
  strip.style.display = "flex";
  let displayOrder = [1, 2, 3, 0],
    labels = ["START", "T1", "T2", "T3"];
  let prayColors = { mage: "#4488ff", range: "#44cc44", melee: "#888" };
  let html = "";
  for (let i = 0; i < 4; i++) {
    let p = seq[displayOrder[i]];
    html += `<div style="display:flex;flex-direction:column;align-items:center;gap:1px"><img src="${PRAYER_IMG_DATA[p]}" style="width:20px;height:20px;image-rendering:pixelated"><span style="font-size:7px;font-weight:700;color:${prayColors[p]};letter-spacing:0.5px">${labels[i]}</span></div>`;
  }
  strip.innerHTML = html;
}

// =====================================================
// RENDERING (Phase 1 + Phase 2 overlay)
// =====================================================
function render() {
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
  if (autozukMode && !autozukHidden) {
    for (let x = ARENA_X_MIN; x <= ARENA_X_MAX; x++) {
      for (let y = ARENA_Y_MIN; y <= ARENA_Y_MAX; y++) {
        let key = `${x},${y}`,
          px = (x - ARENA_X_MIN) * TILE_SIZE,
          py = (y - ARENA_Y_MIN) * TILE_SIZE;
        if (excludedTiles.has(key)) {
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
        let result = autozukResults[key];
        if (result) {
          let fx = x - ARENA_X_MIN,
            fy = y - ARENA_Y_MIN;
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
            let heat = autozukHeatValue(result);
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
    if (selectedTile) {
      let px = (selectedTile.x - ARENA_X_MIN) * TILE_SIZE,
        py = (selectedTile.y - ARENA_Y_MIN) * TILE_SIZE;
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.strokeRect(px, py, TILE_SIZE, TILE_SIZE);
    }
  }

  if (!sim && (!autozukMode || practiceState.open)) {
    let practicePreview = practiceState.open && practiceState.tick < 15;
    for (let pm of previewMobs) {
      let s = pm.size;
      ctx.globalAlpha = practicePreview ? 0.28 : 0.7;
      ctx.fillStyle = pm.color;
      ctx.fillRect(
        (pm.x - ARENA_X_MIN) * TILE_SIZE + 1,
        (pm.y - (s - 1) - ARENA_Y_MIN) * TILE_SIZE + 1,
        s * TILE_SIZE - 2,
        s * TILE_SIZE - 2,
      );
      let cx = (pm.x + (s - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2,
        cy = (pm.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
      ctx.fillStyle = isDarkColor(pm.color) ? "#fff" : "#000";
      ctx.font = `bold ${Math.max(10, Math.min(TILE_SIZE * s * 0.4, 20))}px JetBrains Mono`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      drawFlipText(pm.letter, cx, cy);
      ctx.globalAlpha = 1;
    }
    if (previewMobs.length === 0 && !practiceState.open) {
      ctx.globalAlpha = 0.15;
      for (let i = 0; i < SPAWN_LOCATIONS.length; i++) {
        let sp = SPAWN_LOCATIONS[i],
          sx = (sp.x - ARENA_X_MIN) * TILE_SIZE,
          sy = (sp.y - ARENA_Y_MIN) * TILE_SIZE;
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
  for (let key of ["S", "W", "N"]) {
    if (!pillars[key]) continue;
    let p = PILLAR_LOCS[key],
      isAlive = true;
    if (sim) {
      let rp = sim.region.pillars.find((pp) => pp.id === "pillar" + key);
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

  if (sim) {
    for (let mob of sim.mobs) {
      if (!mob.dead) drawMob(mob);
    }
    let p = sim.player,
      px = (p.x - ARENA_X_MIN) * TILE_SIZE,
      py = (p.y - ARENA_Y_MIN) * TILE_SIZE;
    ctx.fillStyle = "#bb88ff";
    ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(8, TILE_SIZE - 6)}px JetBrains Mono`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawFlipText("P", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
    if (p.aggro && !p.aggro.dead) {
      let ct = closestTileTo(p.aggro, p.x, p.y);
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
      let bt = p.lastBarrageTarget;
      let splashX = (bt.x - 1 - ARENA_X_MIN) * TILE_SIZE;
      let splashY = (bt.y - 1 - ARENA_Y_MIN) * TILE_SIZE;
      ctx.fillStyle = "rgba(255,0,0,0.18)";
      ctx.fillRect(splashX, splashY, TILE_SIZE * 3, TILE_SIZE * 3);
      ctx.strokeStyle = "rgba(255,0,0,0.35)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(splashX, splashY, TILE_SIZE * 3, TILE_SIZE * 3);
    }
    // Pass 2: HP bars on top of everything
    for (let mob of sim.mobs) {
      if (!mob.dead) drawMobHPBar(mob);
    }
    if (p.hp !== undefined && p.hp < p.maxHp) {
      let bx = px,
        bw = TILE_SIZE;
      drawHealthBar(bx, py - 4, py + TILE_SIZE + 1, bw, Math.max(0, p.hp / p.maxHp));
    }
  }

  if (!sim && playerPlacement) {
    let px = (playerPlacement.x - ARENA_X_MIN) * TILE_SIZE,
      py = (playerPlacement.y - ARENA_Y_MIN) * TILE_SIZE;
    ctx.fillStyle = "#bb88ff88";
    ctx.fillRect(px + 1, py + 1, TILE_SIZE - 2, TILE_SIZE - 2);
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(8, TILE_SIZE - 6)}px JetBrains Mono`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawFlipText("P", px + TILE_SIZE / 2, py + TILE_SIZE / 2);
  }

  // Draw preview mobs in autozuk mode (when no sim is rendering mobs)
  if (autozukMode && !sim) {
    let liveFrame = solverPreviewState && solverPreviewState.frame;
    if (liveFrame) drawSolverPreviewFrame(liveFrame);
    else {
      for (let pm of previewMobs) {
        let s = pm.size;
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = pm.color;
        ctx.fillRect(
          (pm.x - ARENA_X_MIN) * TILE_SIZE + 1,
          (pm.y - (s - 1) - ARENA_Y_MIN) * TILE_SIZE + 1,
          s * TILE_SIZE - 2,
          s * TILE_SIZE - 2,
        );
        let cx = (pm.x + (s - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2,
          cy = (pm.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
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
  updatePrayerStrip();
}

function drawMob(mob) {
  if (mob.dying > 0) ctx.globalAlpha = 0.14;
  let s = mob.size;
  ctx.fillStyle = mob.color;
  ctx.fillRect(
    (mob.x - ARENA_X_MIN) * TILE_SIZE + 1,
    (mob.y - (s - 1) - ARENA_Y_MIN) * TILE_SIZE + 1,
    s * TILE_SIZE - 2,
    s * TILE_SIZE - 2,
  );
  let cx = (mob.x + (s - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2,
    cy = (mob.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
  ctx.fillStyle = isDarkColor(mob.color) ? "#fff" : "#000";
  ctx.font = `bold ${Math.max(10, Math.min(TILE_SIZE * s * 0.4, 20))}px JetBrains Mono`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  drawFlipText(mob.letter, cx, cy);
  ctx.globalAlpha = 1;
}
function drawMobHPBar(mob) {
  if (mob.dying > 0 || mob.hp >= mob.maxHp) return;
  let s = mob.size;
  let bx = (mob.x - ARENA_X_MIN) * TILE_SIZE,
    bw = s * TILE_SIZE;
  let byAbove = (mob.y - s + 1 - ARENA_Y_MIN) * TILE_SIZE - 4;
  let byBelow = (mob.y - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE + 1;
  drawHealthBar(bx, byAbove, byBelow, bw, mob.hp / mob.maxHp);
}

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
function drawSolverPreviewFrame(frame) {
  let tx = (frame.tile.x - ARENA_X_MIN) * TILE_SIZE,
    ty = (frame.tile.y - ARENA_Y_MIN) * TILE_SIZE;
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 2;
  ctx.setLineDash([Math.max(3, TILE_SIZE * 0.35), Math.max(2, TILE_SIZE * 0.18)]);
  ctx.strokeRect(tx + 1, ty + 1, TILE_SIZE - 2, TILE_SIZE - 2);
  ctx.setLineDash([]);
  let aggroMob = frame.mobs.find((m) => m.id === frame.player.aggroId);
  if (aggroMob) {
    let pcx = (frame.player.x - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2,
      pcy = (frame.player.y - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
    let mcx = (aggroMob.x + (aggroMob.size - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2;
    let mcy = (aggroMob.y - (aggroMob.size - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
    ctx.strokeStyle = "rgba(255,107,43,0.75)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(pcx, pcy);
    ctx.lineTo(mcx, mcy);
    ctx.stroke();
  }
  for (let mob of frame.mobs) {
    let d = MOB_DEFS[mob.type];
    if (!d) continue;
    let s = mob.size,
      alpha = mob.dying > 0 ? 0.25 : 0.82;
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
    let cx = (mob.x + (s - 1) / 2 - ARENA_X_MIN) * TILE_SIZE + TILE_SIZE / 2,
      cy = (mob.y - (s - 1) / 2 - ARENA_Y_MIN) * TILE_SIZE + TILE_SIZE / 2;
    ctx.fillStyle = isDarkColor(d.color) ? "#fff" : "#000";
    ctx.font = `bold ${Math.max(10, Math.min(TILE_SIZE * s * 0.4, 20))}px JetBrains Mono`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    drawFlipText(d.letter, cx, cy);
  }
  ctx.globalAlpha = 0.88;
  let px = (frame.player.x - ARENA_X_MIN) * TILE_SIZE,
    py = (frame.player.y - ARENA_Y_MIN) * TILE_SIZE;
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

// ===== UI UPDATES =====
function syncStatusBox() {
  let statusBox = document.getElementById("statusBox");
  if (statusBox) statusBox.style.display = sim && sim.tick >= 1 ? "" : "none";
}
function updateUI() {
  document.getElementById("tickDisplay").innerHTML = `<span>TICK</span><br>${sim ? sim.tick : "—"}`;
  syncStatusBox();
  // Player status
  if (sim) {
    let p = sim.player;
    let isDead = p.hp !== undefined && p.hp <= 0;
    let hpColor = isDead ? "#ff4444" : p.hp > 66 ? "#00ff00" : p.hp > 33 ? "#ffff00" : "#ff4444";
    let hpText = isDead
      ? "\u2620 / " + (p.maxHp || 99)
      : (p.hp !== undefined ? p.hp : 99) + "/" + (p.maxHp || 99);
    let prayInfo = "";
    {
      let pray = getEffectivePrayerForTick(sim.tick);
      if (pray) {
        let pn = { mage: "Mage", range: "Range", melee: "Melee" };
        prayInfo = ` | Prayer: ${pn[pray] || "?"}`;
      }
    }
    document.getElementById("playerStatus").innerHTML =
      `<div class="mob-info-row"><span class="name" style="color:#bb88ff">P Player</span><span class="hp" style="color:${hpColor}">${hpText}</span><span class="pos">(${p.x},${p.y})${prayInfo}</span></div>`;
  } else {
    document.getElementById("playerStatus").innerHTML = "No simulation loaded";
  }
  let html = "";
  if (sim) {
    let alive = sim.mobs.filter((m) => !m.dead && m.dying <= 0);
    for (let m of alive)
      html += `<div class="mob-info-row"><span class="name" style="color:${isDarkColor(m.color) ? "#aaa" : m.color}">${m.letter} #${m.id}</span><span class="hp">${m.hp}/${m.maxHp}</span><span class="pos">(${m.x},${m.y})</span></div>`;
  }
  document.getElementById("mobInfo").innerHTML = html || "No mobs alive";
  updateTickGrid();
  updateEventList();
  render();
}
function rebuildTickGridHeader() {
  let html = '<tr><th class="tick-col">T</th>';
  if (practiceState.open)
    html += '<th class="mob-col practice-you-col" title="Your active prayer">YOU</th>';
  for (let col of gridMobColumns) {
    let tc = isDarkColor(col.color) ? "#fff" : "#000";
    html += `<th class="mob-col"><span class="mob-col-badge" style="background:${col.color};color:${tc}">${col.letter}</span></th>`;
  }
  html += "</tr>";
  document.getElementById("tickGridHead").innerHTML = html;
  document.getElementById("tickGridBody").innerHTML = "";
}
function updateTickGrid() {
  if (!sim) return;
  let currentTick = sim.tick,
    tbody = document.getElementById("tickGridBody");
  let hitCount = 0;
  for (let t in tickHits) hitCount += tickHits[t].length;
  document.getElementById("tickGridCount").textContent = `${hitCount} hits`;
  let startT = sim.startTick || 0;
  if (tbody.rows.length) {
    let lastTick = parseInt(tbody.rows[tbody.rows.length - 1].dataset.tick, 10);
    startT = isNaN(lastTick) ? startT : lastTick + 1;
  }
  for (let t = startT; t <= currentTick; t++) {
    let tr = document.createElement("tr");
    tr.dataset.tick = t;
    let tdTick = document.createElement("td");
    tdTick.className = "tick-col";
    // Prayer icon + tick number — show if tile has an AUTOZUK prayer solution
    let praySeq = activePrayerSeq;
    if (!praySeq && playerPlacement) {
      let pk = `${playerPlacement.x},${playerPlacement.y}`;
      if (autozukResults[pk]) praySeq = autozukResults[pk].prayer;
    }
    if (praySeq && (!practiceState.open || t >= 16)) {
      let pray = praySeq[solutionPrayerIndexForTick(t)];
      let src = PRAYER_IMG_DATA[pray];
      if (src) {
        let img = document.createElement("img");
        img.src = src;
        img.style.cssText =
          "width:12px;height:12px;vertical-align:middle;margin-right:2px;image-rendering:pixelated";
        tdTick.appendChild(img);
      }
    }
    tdTick.appendChild(document.createTextNode(t));
    tr.appendChild(tdTick);
    if (practiceState.open) {
      let tdPractice = document.createElement("td");
      tdPractice.className = "practice-prayer-cell";
      let actual = practicePrayerForTick(t),
        expected = expectedPracticePrayerForTick(t);
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
    for (let col of gridMobColumns) {
      let td = document.createElement("td");
      let hits = (tickHits[t] || []).filter((h) => h.mobId === col.id);
      for (let h of hits) {
        let block = document.createElement("span");
        block.className = "hit-block" + (h.isScan ? " scan" : "");
        block.style.background = h.color;
        // Color red if off-prayer
        if (!h.isScan && h.style) {
          let pray = practiceState.open ? getEffectivePrayerForTick(t) : null;
          if (!practiceState.open) {
            let usePraySeq = activePrayerSeq;
            if (!usePraySeq && playerPlacement) {
              let pk = `${playerPlacement.x},${playerPlacement.y}`;
              if (autozukResults[pk]) usePraySeq = autozukResults[pk].prayer;
            }
            if (usePraySeq) pray = usePraySeq[solutionPrayerIndexForTick(t)];
          }
          if ((practiceState.open && practiceState.solution) || (!practiceState.open && pray)) {
            let blocked =
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
  for (let row of tbody.rows) row.classList.remove("current-tick");
  let currentRow = Array.from(tbody.rows).find(
    (row) => parseInt(row.dataset.tick, 10) === currentTick,
  );
  if (currentRow) currentRow.classList.add("current-tick");
  let wrapper = document.getElementById("tickGridWrapper");
  if (!tickGridUserScrolled) wrapper.scrollTop = wrapper.scrollHeight;
}
function updateEventList() {
  let container = document.getElementById("eventListBody");
  let events = tickEvents.filter((e) => e.isHit || e.isScan || e.isPlayerAttack || e.isResurrect);
  document.getElementById("eventCount").textContent = `${events.length} events`;
  if (events.length === 0) {
    container.innerHTML =
      '<div style="padding:8px;text-align:center;color:var(--text-dim);font-size:10px">No events yet</div>';
    return;
  }
  let html = "";
  for (let e of events) {
    let bc = e.type;
    if (bc === "blobletMage") bc = "bloblet-mage";
    if (bc === "blobletRange") bc = "bloblet-range";
    if (bc === "blobletMelee") bc = "bloblet-melee";
    if (bc === "player-atk") bc = "player-atk";
    html += `<div class="tick-entry${e.isScan ? " scan" : ""}"><span class="tick-num">T${e.tick}</span><span class="tick-badge ${bc}">${MOB_DEFS[e.type]?.letter || "P"}</span><span class="tick-detail">${e.detail}</span></div>`;
  }
  container.innerHTML = html;
  let wrapper = document.getElementById("eventListBody");
  if (!eventListUserScrolled) wrapper.scrollTop = wrapper.scrollHeight;
}
function setStatus(msg, type) {}
function showSpawnCodeError() {
  let el = document.getElementById("spawnCodeError"),
    input = document.getElementById("spawnCode");
  if (el) {
    el.textContent = "Input wave code or click dice button";
    el.classList.add("show");
  }
  if (input) {
    input.classList.add("input-error");
    input.focus();
  }
}
function clearSpawnCodeError() {
  document.getElementById("spawnCodeError")?.classList.remove("show");
  document.getElementById("spawnCode")?.classList.remove("input-error");
}

// ===== SCROLL/RESIZE =====
document.getElementById("tickGridWrapper").addEventListener("scroll", function () {
  tickGridUserScrolled = this.scrollHeight - this.scrollTop - this.clientHeight > 30;
});
document.getElementById("eventListBody").addEventListener("scroll", function () {
  eventListUserScrolled = this.scrollHeight - this.scrollTop - this.clientHeight > 30;
});
(function () {
  let handle = document.getElementById("resizeHandle"),
    section = document.getElementById("eventlistSection"),
    dragging = false,
    startY,
    startH;
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

// ===== EVENT HANDLERS =====
canvas.addEventListener("click", function (e) {
  let rect = canvas.getBoundingClientRect();
  let gx, gy;
  if (facingSouth) {
    gx = ARENA_X_MAX - Math.floor((e.clientX - rect.left) / TILE_SIZE);
    gy = ARENA_Y_MAX - Math.floor((e.clientY - rect.top) / TILE_SIZE);
  } else {
    gx = Math.floor((e.clientX - rect.left) / TILE_SIZE) + ARENA_X_MIN;
    gy = Math.floor((e.clientY - rect.top) / TILE_SIZE) + ARENA_Y_MIN;
  }
  if (gx < ARENA_X_MIN || gx > ARENA_X_MAX || gy < ARENA_Y_MIN || gy > ARENA_Y_MAX) return;
  // Always set player placement
  playerPlacement = { x: gx, y: gy };
  if (autozukMode && !autozukRunning) {
    let key = `${gx},${gy}`;
    if (autozukResults[key]) {
      selectedTile = { x: gx, y: gy };
      activePrayerSeq = autozukResults[key].prayer;
      showTileDetail(gx, gy);
      setStatus(`Player placed at (${gx}, ${gy}) — click STEP/PLAY to sim`, "info");
      render();
      return;
    } else if (excludedTiles.has(key)) {
      setStatus(`Player placed at (${gx}, ${gy}) — excluded tile`, "info");
      render();
      return;
    }
  }
  setStatus(`Player placed at (${gx}, ${gy})`, "info");
  render();
});

function togglePillar(key) {
  pillars[key] = !pillars[key];
  document.getElementById("pillar" + key).classList.toggle("active");
  updatePreview();
  render();
}
function updatePreview() {
  let code = document.getElementById("spawnCode").value;
  previewMobs = [];
  if (!code.trim()) {
    render();
    return;
  }
  let parsed = parseSpawnCode(code);
  if (parsed.error) {
    render();
    return;
  }
  for (let spawn of parsed.spawns) {
    if (spawn.type === "nothing") continue;
    let d = MOB_DEFS[spawn.type];
    previewMobs.push({
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
function changeLoadout(key) {
  currentLoadoutKey = key || currentLoadoutKey;
  currentLoadout = LOADOUTS[currentLoadoutKey] || LOADOUTS.ayak;
  updateActiveLoadoutSummary();
  if (document.getElementById("gearModal")?.classList.contains("open"))
    renderGearDraft(currentLoadoutKey);
}
function pasteSpawnCode() {
  navigator.clipboard
    .readText()
    .then((text) => {
      text = text.trim();
      // Strip digits to count mob chars, validate 9 positions with optional index digits
      let stripped = text.replace(/[1-9]/g, "");
      if (
        stripped.length === 9 &&
        /^[MRXBYOmrxbyo]{9}$/i.test(stripped) &&
        text.length <= 18 &&
        /^[MRXBYOmrxbyo1-9]+$/i.test(text)
      ) {
        document.getElementById("spawnCode").value = text.toUpperCase();
        document.getElementById("spawnCode").dispatchEvent(new Event("input"));
      }
    })
    .catch(() => {});
}
function randomSpawnCode() {
  let monsters = ["M", "R"];
  if (Math.random() < 0.5) monsters.push("X");
  let addOns = [["B", "B"], ["B", "Y"], ["B", "Y", "Y"], ["B"]];
  monsters.push(...addOns[Math.floor(Math.random() * addOns.length)]);
  let slots = Array.from({ length: 9 }, (_, i) => i);
  for (let i = slots.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [slots[i], slots[j]] = [slots[j], slots[i]];
  }
  let codeSlots = Array(9).fill("O");
  for (let i = 0; i < monsters.length; i++) codeSlots[slots[i]] = monsters[i];
  let order = Array.from({ length: monsters.length }, (_, i) => i + 1);
  for (let i = order.length - 1; i > 0; i--) {
    let j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  let monsterIndex = 0;
  let code = codeSlots.map((ch) => (ch === "O" ? "O" : ch + order[monsterIndex++])).join("");
  let input = document.getElementById("spawnCode");
  input.value = code;
  input.dispatchEvent(new Event("input"));
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
function resetAutozuk() {
  if (autozukRunning) return;
  if (practiceState.open) closePracticeMode(true);
  stopSolverVisualPreview();
  autozukMode = false;
  autozukResults = {};
  excludedTiles = new Set();
  selectedTile = null;
  activePrayerSeq = null;
  autozukHidden = false;
  document.getElementById("progressFill").style.width = "0%";
  document.getElementById("autozukStatus").textContent = "";
  document.getElementById("detailPanel").classList.add("detail-hidden");
  document.getElementById("liveDetailPanel").style.display = "none";
  document.getElementById("liveFeedPanel").style.display = "none";
  document.getElementById("phase1Panel").style.display = "";
  document.getElementById("eventlistSection").style.display = "";

  document.getElementById("resizeHandle").style.display = "";
  document.getElementById("exportSection").style.display = "";
  document.getElementById("btnHideAZ").textContent = "HIDE";
  document.getElementById("btnHideAZ").style.background = "";
  setStatus("AUTOZUK data cleared", "info");
  render();
}
function toggleHideAutozuk() {
  autozukHidden = !autozukHidden;
  let btn = document.getElementById("btnHideAZ");
  if (autozukHidden) {
    btn.textContent = "SHOW";
    btn.style.background = "var(--accent-dim)";
  } else {
    btn.textContent = "HIDE";
    btn.style.background = "";
  }
  render();
}
function ensureTickGridView() {
  if (!document.getElementById("detailPanel").classList.contains("detail-hidden"))
    closeTileDetail();
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
document.getElementById("speedSlider").addEventListener("input", function () {
  document.getElementById("speedLabel").textContent = `${this.value} t/s`;
  if (playing) {
    clearInterval(playInterval);
    startPlay();
  }
});
document.getElementById("spawnCode").addEventListener("input", function () {
  if (practiceState.open) closePracticeMode(true);
  clearSpawnCodeError();
  if (sim) {
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
    document.getElementById("tickDisplay").innerHTML = "<span>TICK</span><br>—";
    syncStatusBox();
  }
  autozukMode = false;
  autozukResults = {};
  excludedTiles = new Set();
  selectedTile = null;
  document.getElementById("detailPanel").classList.add("detail-hidden");
  document.getElementById("phase1Panel").style.display = "";
  updatePreview();
});

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

// =====================================================
// PHASE 2: TILE DETAIL PANEL
// =====================================================
function showTileDetail(x, y) {
  let key = `${x},${y}`,
    result = autozukResults[key];
  if (!result) {
    document.getElementById("detailPanel").classList.add("detail-hidden");
    return;
  }

  // Switch right panel to detail view
  document.getElementById("phase1Panel").style.display = "none";
  document.getElementById("liveDetailPanel").style.display = "none";
  document.getElementById("eventlistSection").style.display = "none";

  document.getElementById("resizeHandle").style.display = "none";
  let dp = document.getElementById("detailPanel");
  dp.classList.remove("detail-hidden");

  let prayerHtml = '<div class="prayer-sequence">';
  let prayerNames = { mage: "MAGE", range: "RANGE", melee: "MELEE" };
  let displayOrder = [1, 2, 3, 0],
    slotLabels = ["START", "T1", "T2", "T3"];
  for (let i = 0; i < 4; i++) {
    let p = result.prayer[displayOrder[i]];
    prayerHtml += `<div class="prayer-slot ${p}"><div class="slot-num">${slotLabels[i]}</div>${prayerNames[p]}</div>`;
  }
  prayerHtml += "</div>";

  let dmgClass = result.avgDamage < 15 ? "good" : result.avgDamage < 30 ? "warn" : "bad";
  let o50Class = result.over50Pct < 10 ? "good" : result.over50Pct < 30 ? "warn" : "bad";
  let scoreLabel = currentLoadout.isBloodBarrage ? "Avg Max HP Deficit" : "Avg Damage";
  let over50Label = currentLoadout.isBloodBarrage ? "Runs > 50 deficit" : "Runs > 50 dmg";
  let scoreLabelClass = currentLoadout.isBloodBarrage ? "" : " score-active";
  let deathLabelClass = currentLoadout.isBloodBarrage ? " score-active" : "";
  let deathRateRow =
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
    let hc = document.getElementById("histCanvas");
    if (!hc) return;
    let hctx = hc.getContext("2d");
    hc.width = hc.parentElement.clientWidth;
    hc.height = 70;
    let buckets = new Array(20).fill(0);
    let maxDmg = Math.max(...result.damages, 100);
    for (let d of result.damages) {
      let b = Math.min(Math.floor((d / maxDmg) * 20), 19);
      buckets[b]++;
    }
    let maxB = Math.max(...buckets, 1);
    let bw = hc.width / 20;
    for (let i = 0; i < 20; i++) {
      let h = (buckets[i] / maxB) * 60;
      let dmgVal = ((i + 0.5) / 20) * maxDmg;
      hctx.fillStyle = histogramColor(dmgVal);
      hctx.fillRect(i * bw + 1, 70 - h, bw - 2, h);
    }
    // Red line at 50
    let x50 = (50 / maxDmg) * hc.width;
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

function updateLiveDetail(x, y, result) {
  let dp = document.getElementById("liveDetailPanel");
  let prayerHtml = '<div class="prayer-sequence">';
  let prayerNames = { mage: "MAGE", range: "RANGE", melee: "MELEE" };
  let slotLabels = ["START", "T1", "T2", "T3"],
    displayOrder = [1, 2, 3, 0];
  for (let i = 0; i < 4; i++) {
    let p = result.prayer[displayOrder[i]];
    prayerHtml += `<div class="prayer-slot ${p}"><div class="slot-num">${slotLabels[i]}</div>${prayerNames[p]}</div>`;
  }
  prayerHtml += "</div>";
  let dmgClass = result.avgDamage < 15 ? "good" : result.avgDamage < 30 ? "warn" : "bad";
  let o50Class = result.over50Pct < 10 ? "good" : result.over50Pct < 30 ? "warn" : "bad";
  let scoreLabel = currentLoadout.isBloodBarrage ? "Avg Max HP Deficit" : "Avg Damage";
  let over50Label = currentLoadout.isBloodBarrage ? "Runs > 50 deficit" : "Runs > 50 dmg";
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
    let hc = document.getElementById("liveHistCanvas");
    if (!hc) return;
    let hctx = hc.getContext("2d");
    hc.width = hc.parentElement.clientWidth;
    hc.height = 70;
    let buckets = new Array(20).fill(0);
    let maxDmg = Math.max(...result.damages, 100);
    for (let d of result.damages) {
      let b = Math.min(Math.floor((d / maxDmg) * 20), 19);
      buckets[b]++;
    }
    let maxB = Math.max(...buckets, 1);
    let bw = hc.width / 20;
    for (let i = 0; i < 20; i++) {
      let h = (buckets[i] / maxB) * 60;
      let dmgVal = ((i + 0.5) / 20) * maxDmg;
      hctx.fillStyle = histogramColor(dmgVal);
      hctx.fillRect(i * bw + 1, 70 - h, bw - 2, h);
    }
    let x50 = (50 / maxDmg) * hc.width;
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

function closeTileDetail() {
  document.getElementById("detailPanel").classList.add("detail-hidden");
  document.getElementById("phase1Panel").style.display = "";
  document.getElementById("eventlistSection").style.display = "";

  document.getElementById("resizeHandle").style.display = "";
  document.getElementById("exportSection").style.display = "";
  selectedTile = null;
  activePrayerSeq = null;
  render();
}

let practiceState = {
  open: false,
  running: false,
  tick: 1,
  interval: null,
  active: null,
  pending: undefined,
  visual: new Set(),
  clientOrder: [],
  records: {},
  solution: null,
  metronomeStart: 1,
  restoreAutozukHidden: null,
  restoreTile: null,
  popoutReady: false,
  popoutPos: null,
  dragging: null,
};

function openPracticeMode() {
  if (practiceState.open) {
    closePracticeMode(true);
    return;
  }
  initializePracticeIcons();
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
  if (!playerPlacement) {
    let status = document.getElementById("exportStatus");
    status.textContent = "Click a start tile first";
    status.style.color = "var(--accent)";
    setTimeout(() => {
      status.textContent = "";
      status.style.color = "";
    }, 1800);
    return;
  }
  practiceState.open = true;
  practiceState.running = false;
  practiceState.tick = 1;
  practiceState.active = null;
  practiceState.pending = undefined;
  practiceState.visual = new Set();
  practiceState.clientOrder = [];
  practiceState.records = {};
  practiceState.solution = getSelectedPrayerSequence();
  practiceState.metronomeStart = 1 + Math.floor(Math.random() * 4);
  practiceState.restoreAutozukHidden = autozukMode ? autozukHidden : null;
  practiceState.restoreTile = getPracticeRestoreTile();
  stopPlay();
  clearPracticeManualState();
  document.getElementById("practicePanel").classList.add("show");
  initializePracticePopout();
  positionPracticePopout();
  setPracticeButtonText();
  document.getElementById("detailPanel").classList.add("detail-hidden");
  document.getElementById("liveDetailPanel").style.display = "none";
  document.getElementById("phase1Panel").style.display = "";
  document.getElementById("eventlistSection").style.display = "";
  document.getElementById("resizeHandle").style.display = "";
  if (autozukMode && !autozukHidden) toggleHideAutozuk();
  recordPracticeTick(1);
  renderPracticeMode();
  startPracticeTimer();
}
function closePracticeMode(resetManual) {
  stopPracticeTimer();
  let restoreHidden = practiceState.restoreAutozukHidden,
    restoreTile = practiceState.restoreTile;
  practiceState.open = false;
  practiceState.tick = 1;
  practiceState.active = null;
  practiceState.pending = undefined;
  practiceState.visual = new Set();
  practiceState.clientOrder = [];
  practiceState.records = {};
  practiceState.restoreAutozukHidden = null;
  practiceState.restoreTile = null;
  document.getElementById("practicePanel")?.classList.remove("show");
  setPracticeButtonText();
  renderPracticeButtons();
  if (resetManual) clearPracticeManualState();
  restorePracticeUiState(restoreTile, restoreHidden);
}
function startPracticeTimer() {
  if (practiceState.interval) clearInterval(practiceState.interval);
  practiceState.running = true;
  practiceState.interval = setInterval(advancePracticeTick, 600);
}
function stopPracticeTimer() {
  if (practiceState.interval) clearInterval(practiceState.interval);
  practiceState.interval = null;
  practiceState.running = false;
}
function advancePracticeTick() {
  practiceState.tick++;
  if (practiceState.pending !== undefined) practiceState.active = practiceState.pending;
  practiceState.pending = undefined;
  practiceState.visual = new Set(practiceState.active ? [practiceState.active] : []);
  practiceState.clientOrder = practiceState.active ? [practiceState.active] : [];
  recordPracticeTick(practiceState.tick);
  if (practiceState.tick === 15) startPracticeSimulationAtSpawn();
  else if (practiceState.tick > 15) {
    if (!sim) startPracticeSimulationAtSpawn();
    if (sim && sim.tick < practiceState.tick) simulateTick();
  }
  renderPracticeMode();
}
function clickPracticePrayer(type) {
  if (!practiceState.open || !PRACTICE_PRAYERS[type]) return;
  let turningOff = practiceState.visual.has(type);
  if (turningOff) {
    practiceState.visual.delete(type);
    practiceState.clientOrder = practiceState.clientOrder.filter((p) => p !== type);
    practiceState.pending = practiceState.clientOrder.length
      ? practiceState.clientOrder[practiceState.clientOrder.length - 1]
      : null;
  } else {
    practiceState.visual.add(type);
    practiceState.clientOrder = practiceState.clientOrder.filter((p) => p !== type);
    practiceState.clientOrder.push(type);
    practiceState.pending = type;
  }
  renderPracticeButtons();
  playPracticePrayerSound(type, !turningOff);
}
function initializePracticeIcons() {
  for (let type of ["mage", "range", "melee"]) {
    let btn = document.getElementById(
      "practicePrayer" + (type === "range" ? "Range" : type === "mage" ? "Mage" : "Melee"),
    );
    if (btn && !btn.dataset.iconReady) {
      btn.innerHTML = `<img src="${PRAYER_IMG_DATA[type]}" alt="" draggable="false">`;
      btn.dataset.iconReady = "1";
    }
  }
}
function initializePracticePopout() {
  if (practiceState.popoutReady) return;
  let panel = document.getElementById("practicePanel"),
    handle = document.getElementById("practiceDragHandle");
  if (!panel || !handle) return;
  handle.addEventListener("pointerdown", (e) => {
    let r = panel.getBoundingClientRect();
    practiceState.dragging = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    handle.setPointerCapture?.(e.pointerId);
    e.preventDefault();
  });
  document.addEventListener("pointermove", (e) => {
    if (!practiceState.dragging) return;
    movePracticePopout(
      e.clientX - practiceState.dragging.dx,
      e.clientY - practiceState.dragging.dy,
    );
  });
  document.addEventListener("pointerup", () => {
    practiceState.dragging = null;
  });
  window.addEventListener("resize", () => {
    if (practiceState.popoutPos)
      movePracticePopout(practiceState.popoutPos.x, practiceState.popoutPos.y);
  });
  practiceState.popoutReady = true;
}
function positionPracticePopout() {
  let panel = document.getElementById("practicePanel");
  if (!panel) return;
  if (practiceState.popoutPos) {
    movePracticePopout(practiceState.popoutPos.x, practiceState.popoutPos.y);
    return;
  }
  panel.style.left = "18px";
  panel.style.bottom = "18px";
  panel.style.top = "auto";
  panel.style.right = "auto";
}
function movePracticePopout(x, y) {
  let panel = document.getElementById("practicePanel");
  if (!panel) return;
  let r = panel.getBoundingClientRect(),
    pad = 8;
  let maxX = Math.max(pad, window.innerWidth - r.width - pad),
    maxY = Math.max(pad, window.innerHeight - r.height - pad);
  x = Math.max(pad, Math.min(maxX, x));
  y = Math.max(pad, Math.min(maxY, y));
  panel.style.left = x + "px";
  panel.style.top = y + "px";
  panel.style.right = "auto";
  panel.style.bottom = "auto";
  practiceState.popoutPos = { x, y };
}
function clearPracticeManualState() {
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
  document.getElementById("tickDisplay").innerHTML = "<span>TICK</span><br>&mdash;";
  syncStatusBox();
  updatePreview();
  render();
}
function startPracticeSimulationAtSpawn() {
  if (sim) return;
  let code = document.getElementById("spawnCode").value;
  sim = initSim(code, playerPlacement, 15);
  if (!sim) {
    closePracticeMode(false);
    return;
  }
  sim.practiceMode = true;
  rebuildTickGridHeader();
  document.getElementById("tickGridBody").innerHTML = "";
  tickGridUserScrolled = false;
  eventListUserScrolled = false;
  setStatus(
    `Practice sim started! ${sim.mobs.filter((m) => !m.dead).length} mobs spawned on tick 15.`,
    "info",
  );
  updateUI();
}
function getSelectedPrayerSequence() {
  if (activePrayerSeq) return activePrayerSeq.slice();
  if (playerPlacement) {
    let pk = `${playerPlacement.x},${playerPlacement.y}`;
    if (autozukResults[pk]) return autozukResults[pk].prayer.slice();
  }
  return null;
}
function getPracticeRestoreTile() {
  if (selectedTile) return { x: selectedTile.x, y: selectedTile.y };
  if (playerPlacement && autozukResults[`${playerPlacement.x},${playerPlacement.y}`])
    return { x: playerPlacement.x, y: playerPlacement.y };
  return null;
}
function restorePracticeUiState(tile, hidden) {
  if (hidden !== null && autozukMode && autozukHidden !== hidden) toggleHideAutozuk();
  if (tile && autozukMode) {
    let key = `${tile.x},${tile.y}`;
    if (autozukResults[key]) {
      selectedTile = { x: tile.x, y: tile.y };
      playerPlacement = { x: tile.x, y: tile.y };
      activePrayerSeq = autozukResults[key].prayer;
      showTileDetail(tile.x, tile.y);
      return;
    }
  }
  render();
}
function expectedPracticePrayerForTick(tick) {
  if (!practiceState.open || !practiceState.solution || tick < 16) return null;
  return practiceState.solution[solutionPrayerIndexForTick(tick)];
}
function getEffectivePrayerForTick(tick) {
  if (practiceState.open) {
    let actual = practicePrayerForTick(tick);
    if (actual) return actual;
    return null;
  }
  let seq = getSelectedPrayerSequence();
  return seq ? seq[solutionPrayerIndexForTick(tick)] : null;
}
function solutionPrayerIndexForTick(tick) {
  return (tick + 1) % 4;
}
function recordPracticeTick(tick) {
  practiceState.records[tick] = practiceState.active;
}
function practicePrayerForTick(tick) {
  return practiceState.records[tick] || null;
}
function practiceGridIcon(prayer) {
  let src = PRAYER_IMG_DATA[prayer];
  return src ? `<span class="practice-grid-prayer"><img src="${src}" alt=""></span>` : "-";
}
function renderPracticeButtons() {
  initializePracticeIcons();
  for (let type of ["mage", "range", "melee"]) {
    document
      .getElementById(
        "practicePrayer" + (type === "range" ? "Range" : type === "mage" ? "Mage" : "Melee"),
      )
      ?.classList.toggle("lit", practiceState.visual.has(type));
  }
}
function renderPracticeMode() {
  document.getElementById("practiceTick").textContent = practiceState.tick;
  document.getElementById("practiceMetronome").textContent = practiceMetronomeValue();
  if (!sim)
    document.getElementById("tickDisplay").innerHTML = `<span>TICK</span><br>${practiceState.tick}`;
  renderPracticeButtons();
}
function practiceMetronomeValue() {
  return ((practiceState.metronomeStart - 1 + practiceState.tick - 1) % 4) + 1;
}
function setPracticeButtonText() {
  let btn = document.getElementById("practiceToggleBtn");
  if (btn) btn.textContent = practiceState.open ? "CLOSE PRACTICE" : "PRACTICE";
}
function exportTilemarker() {
  let pos = playerPlacement;
  if (!pos) {
    document.getElementById("exportStatus").textContent = "No tile selected";
    return;
  }
  // Map game coords to RuneLite tilemarker format
  // regionX = gameX + 16, regionY = 47 - gameY
  let regionX = pos.x + 16,
    regionY = 47 - pos.y;
  let marker = [{ regionId: 9043, regionX, regionY, z: 0, color: "#FF51B4BA", label: "Start" }];
  let json = JSON.stringify(marker);
  navigator.clipboard
    .writeText(json)
    .then(() => {
      document.getElementById("exportStatus").textContent = "Copied to clipboard!";
      document.getElementById("exportStatus").style.color = "var(--accent)";
      setTimeout(() => {
        document.getElementById("exportStatus").textContent = "";
        document.getElementById("exportStatus").style.color = "";
      }, 2000);
    })
    .catch(() => {
      // Fallback
      let ta = document.createElement("textarea");
      ta.value = json;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      document.getElementById("exportStatus").textContent = "Copied to clipboard!";
      document.getElementById("exportStatus").style.color = "var(--accent)";
      setTimeout(() => {
        document.getElementById("exportStatus").textContent = "";
        document.getElementById("exportStatus").style.color = "";
      }, 2000);
    });
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
window.addEventListener("beforeunload", () => {
  if (window._autozukPool) window._autozukPool.terminate();
});
initializeEquipmentSelector();
resizeCanvas();
updatePreview();
render();
