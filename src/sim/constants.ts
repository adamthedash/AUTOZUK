// =====================================================
// SIM CORE CONSTANTS — arena, mobs, loadouts, projectiles
// =====================================================
import type { Loadout, LoadoutKey, MobDef, Point, Tile } from "../types.js";

export const ARENA_X_MIN = 1;
export const ARENA_X_MAX = 29;
export const ARENA_Y_MIN = 1;
export const ARENA_Y_MAX = 30;
export const ARENA_W = ARENA_X_MAX - ARENA_X_MIN + 1;
export const ARENA_H = ARENA_Y_MAX - ARENA_Y_MIN + 1;

export const SPAWN_LOCATIONS: Tile[] = [
  { x: 2, y: 6 },
  { x: 23, y: 6 },
  { x: 4, y: 12 },
  { x: 24, y: 13 },
  { x: 17, y: 18 },
  { x: 6, y: 24 },
  { x: 24, y: 26 },
  { x: 2, y: 29 },
  { x: 16, y: 29 },
];

export const PILLAR_LOCS: Record<string, Point & { size: number }> = {
  S: { x: 11, y: 24, size: 3 },
  W: { x: 1, y: 10, size: 3 },
  N: { x: 18, y: 8, size: 3 },
};

export const BFS_DIRS: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, 1],
  [0, -1],
  [-1, 1],
  [1, 1],
  [-1, -1],
  [1, -1],
];

// Typed loosely as Record<string, …> while callers still pass dynamic MobType strings.
export const MOB_DEFS: Record<string, MobDef> = {
  mager: {
    letter: "M",
    size: 4,
    hp: 220,
    atkSpeed: 4,
    range: 15,
    style: "magic",
    color: "#4F86E8",
    hasFlicker: true,
  },
  ranger: {
    letter: "R",
    size: 3,
    hp: 125,
    atkSpeed: 4,
    range: 15,
    style: "range",
    color: "#43A85B",
  },
  meleer: {
    letter: "X",
    size: 4,
    hp: 75,
    atkSpeed: 4,
    range: 1,
    style: "melee",
    color: "#3E434B",
    hasDig: true,
  },
  blob: {
    letter: "B",
    size: 3,
    hp: 40,
    atkSpeed: 3,
    range: 15,
    style: "blob",
    color: "#D9C24A",
    isBlob: true,
  },
  bat: { letter: "Y", size: 2, hp: 25, atkSpeed: 3, range: 4, style: "range", color: "#B3FAB6" },
  nibbler: {
    letter: "N",
    size: 1,
    hp: 10,
    atkSpeed: 4,
    range: 1,
    style: "melee",
    color: "#aaaaaa",
  },
  blobletMage: {
    letter: "a",
    size: 1,
    hp: 15,
    atkSpeed: 4,
    range: 15,
    style: "magic",
    color: "#ff8844",
  },
  blobletRange: {
    letter: "b",
    size: 1,
    hp: 15,
    atkSpeed: 4,
    range: 15,
    style: "range",
    color: "#ffaa66",
  },
  blobletMelee: {
    letter: "c",
    size: 1,
    hp: 15,
    atkSpeed: 4,
    range: 1,
    style: "melee",
    color: "#cc6622",
  },
};

export const PLAYER_ATK_SPEED = 5;
export const PLAYER_RANGE = 6;
export const PLAYER_DAMAGE = 10;

export const LOADOUTS: Record<LoadoutKey, Loadout> = {
  ayak: {
    name: "Ayak",
    atkSpeed: 3,
    maxHit: 39,
    range: 8,
    startingHp: 99,
    hasRecoil: true,
    hasRingRecoil: true,
    hasEchoBoots: true,
    playerAcc: {
      // [afterHit, afterMiss] — Confliction Gauntlets
      nibbler: [0.972, 0.999],
      bat: [0.85, 0.97],
      blob: [0.6025, 0.7894],
      blobletMelee: [0.983, 0.9996],
      blobletMage: [0.6966, 0.8773],
      blobletRange: [0.983, 0.9996],
      meleer: [0.6796, 0.8631],
      ranger: [0.8325, 0.9626],
      mager: [0.4784, 0.6379],
    },
    monsterAtk: {
      // {max, acc} — for blob: separate mage/range
      nibbler: { max: 4, acc: 1.0 },
      bat: { max: 19, acc: 0.0843 },
      blob: {
        mage: { max: 29, acc: 0.6188 },
        range: { max: 29, acc: 0.1281 },
        melee: { max: 29, acc: 0.0756 },
      },
      blobletMelee: { max: 18, acc: 0.0577 },
      blobletMage: { max: 18, acc: 0.4088 },
      blobletRange: { max: 18, acc: 0.0799 },
      meleer: { max: 49, acc: 0.153 },
      ranger: { max: 46, acc: 0.1873, melee: { max: 19, acc: 0.0666 } },
      mager: { max: 70, acc: 0.8422, melee: { max: 52, acc: 0.1745 } },
    },
  },
  blowpipe: {
    name: "Max Blowpipe",
    atkSpeed: 2,
    maxHit: 32,
    range: 5,
    startingHp: 99,
    playerAcc: {
      // [acc, acc] — single accuracy (no Confliction Gauntlets)
      nibbler: [0.9852, 0.9852],
      bat: [0.9025, 0.9025],
      blob: [0.8706, 0.8706],
      blobletMelee: [0.907, 0.907],
      blobletMage: [0.907, 0.907],
      blobletRange: [0.8706, 0.8706],
      meleer: [0.7945, 0.7945],
      ranger: [0.9383, 0.9383],
      mager: [0.7594, 0.7594],
    },
    monsterAtk: {
      nibbler: { max: 4, acc: 1.0 },
      bat: { max: 19, acc: 0.2462 },
      blob: {
        mage: { max: 29, acc: 0.3796 },
        range: { max: 29, acc: 0.374 },
        melee: { max: 29, acc: 0.1614 },
      },
      blobletMelee: { max: 18, acc: 0.1486 },
      blobletMage: { max: 18, acc: 0.2366 },
      blobletRange: { max: 18, acc: 0.2331 },
      meleer: { max: 49, acc: 0.283 },
      ranger: { max: 46, acc: 0.5428, melee: { max: 19, acc: 0.1423 } },
      mager: { max: 70, acc: 0.7273, melee: { max: 52, acc: 0.3936 } },
    },
  },
  bloodBarrage: {
    name: "Blood Barrage",
    atkSpeed: 5,
    maxHit: 40,
    range: 10,
    startingHp: 99,
    isBloodBarrage: true,
    hasRecoil: true,
    hasRingRecoil: true,
    hasEchoBoots: true,
    playerAcc: {
      // [afterHit, afterMiss] — Confliction Gauntlets
      nibbler: [0.9716, 0.9989],
      bat: [0.8476, 0.969],
      blob: [0.5962, 0.7826],
      blobletMelee: [0.9828, 0.9996],
      blobletMage: [0.6917, 0.8733],
      blobletRange: [0.9828, 0.9996],
      meleer: [0.6744, 0.8587],
      ranger: [0.8299, 0.9614],
      mager: [0.4709, 0.6278],
    },
    monsterAtk: {
      nibbler: { max: 4, acc: 1.0 },
      bat: { max: 19, acc: 0.0838 },
      blob: {
        mage: { max: 29, acc: 0.5946 },
        range: { max: 29, acc: 0.1273 },
        melee: { max: 29, acc: 0.0754 },
      },
      blobletMelee: { max: 18, acc: 0.0576 },
      blobletMage: { max: 18, acc: 0.3843 },
      blobletRange: { max: 18, acc: 0.0793 },
      meleer: { max: 49, acc: 0.094 },
      ranger: { max: 46, acc: 0.1862, melee: { max: 19, acc: 0.0665 } },
      mager: { max: 70, acc: 0.8322, melee: { max: 52, acc: 0.1737 } },
    },
  },
};

// Monster projectile hit tick tables. Entry 0 is distance 1 from the projectile origin
// and the value is the hitsplat tick if the attack was initiated on tick 1.
export const MONSTER_PROJECTILE_HIT_TICKS: Record<string, number[]> = {
  bat: [2, 2, 2, 3, 3],
  blobRange: [2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 5, 5, 5, 5, 6, 6],
  blobMage: [2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6],
  ranger: [3, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 6, 6, 6, 6],
  mager: [2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6],
};

export const DEATH_ANIM_TICKS = 3;
