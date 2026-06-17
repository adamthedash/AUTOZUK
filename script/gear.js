// =====================================================
// AUTOZUK — gear state and DPS / defence calculations
// =====================================================

let currentLoadoutKey = "ayak";
let currentLoadout = LOADOUTS.ayak;

let wikiEquipment = [],
  wikiLoadStarted = false,
  gearDraftStats = null,
  isRenderingGear = false;
let gearConfigs = JSON.parse(JSON.stringify(DEFAULT_GEAR_CONFIGS));

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
