// AUTOZUK UI constants extracted from script.js
import type { CombatStyle, MobType } from "../types.js";

export const WIKI_EQUIPMENT_URL =
  "https://raw.githubusercontent.com/weirdgloop/osrs-dps-calc/master/cdn/json/equipment.json";

export const GEAR_SLOTS: string[] = [
  "weapon",
  "head",
  "cape",
  "neck",
  "body",
  "shield",
  "legs",
  "hands",
  "feet",
  "ring",
];

export const GEAR_LABELS: Record<string, string> = {
  head: "Head",
  cape: "Cape",
  neck: "Neck",
  weapon: "Weapon",
  body: "Body",
  shield: "Shield",
  legs: "Legs",
  hands: "Hands",
  feet: "Feet",
  ring: "Ring",
};

export const PLAYER_ACCURACY_TARGETS: Exclude<MobType, "nothing">[] = [
  "nibbler",
  "bat",
  "blob",
  "blobletMelee",
  "blobletMage",
  "blobletRange",
  "meleer",
  "ranger",
  "mager",
];

export const PLAYER_ACCURACY_LABELS: Record<string, string> = {
  nibbler: "Nibbler",
  bat: "Bat",
  blob: "Blob",
  blobletMelee: "Bloblet Melee",
  blobletMage: "Bloblet Mage",
  blobletRange: "Bloblet Range",
  meleer: "Meleer",
  ranger: "Ranger",
  mager: "Mager",
};

export interface IncomingAccuracyRow {
  id: string;
  label: string;
  type: MobType;
  style: CombatStyle;
  path: string[];
}

export const INCOMING_ACCURACY_ROWS: IncomingAccuracyRow[] = [
  { id: "bat", label: "Bat", type: "bat", style: "range", path: ["bat"] },
  { id: "blob-mage", label: "Blob Magic", type: "blob", style: "magic", path: ["blob", "mage"] },
  { id: "blob-range", label: "Blob Range", type: "blob", style: "range", path: ["blob", "range"] },
  { id: "blob-melee", label: "Blob Melee", type: "blob", style: "melee", path: ["blob", "melee"] },
  {
    id: "bloblet-melee",
    label: "Bloblet Melee",
    type: "blobletMelee",
    style: "melee",
    path: ["blobletMelee"],
  },
  {
    id: "bloblet-mage",
    label: "Bloblet Mage",
    type: "blobletMage",
    style: "magic",
    path: ["blobletMage"],
  },
  {
    id: "bloblet-range",
    label: "Bloblet Range",
    type: "blobletRange",
    style: "range",
    path: ["blobletRange"],
  },
  { id: "meleer", label: "Meleer", type: "meleer", style: "melee", path: ["meleer"] },
  { id: "ranger", label: "Ranger Range", type: "ranger", style: "range", path: ["ranger"] },
  {
    id: "ranger-melee",
    label: "Ranger Melee",
    type: "ranger",
    style: "melee",
    path: ["ranger", "melee"],
  },
  { id: "mager", label: "Mager Magic", type: "mager", style: "magic", path: ["mager"] },
  {
    id: "mager-melee",
    label: "Mager Melee",
    type: "mager",
    style: "melee",
    path: ["mager", "melee"],
  },
];

export interface GearConfig {
  levels: { magic: number; def: number; hp: number };
  prayer: string;
  magicBoost: string;
  defBoost: string;
  gear: Record<string, string>;
}

export const DEFAULT_GEAR_CONFIGS: Record<string, GearConfig> = {
  ayak: {
    levels: { magic: 99, def: 99, hp: 99 },
    prayer: "augury",
    magicBoost: "saturatedHeart",
    defBoost: "brew",
    gear: {
      head: "Justiciar faceguard",
      cape: "Imbued zamorak cape (Normal)",
      neck: "Occult necklace",
      weapon: "Eye of ayak (Charged)",
      body: "Torva platebody (Restored)",
      shield: "Elidinis' ward (f)",
      legs: "Oathplate legs",
      hands: "Confliction gauntlets",
      feet: "Echo boots",
      ring: "Ring of suffering (i) (Recoil)",
    },
  },
  bloodBarrage: {
    levels: { magic: 99, def: 99, hp: 99 },
    prayer: "augury",
    magicBoost: "saturatedHeart",
    defBoost: "brew",
    gear: {
      head: "Justiciar faceguard",
      cape: "Imbued zamorak cape (Normal)",
      neck: "Occult necklace",
      weapon: "Kodai wand",
      body: "Torva platebody (Restored)",
      shield: "Elidinis' ward (f)",
      legs: "Oathplate legs",
      hands: "Confliction gauntlets",
      feet: "Echo boots",
      ring: "Ring of suffering (i) (Recoil)",
    },
  },
};

export interface GearPrayer {
  name: string;
  acc: number;
  def: number;
  magicDef: number;
  magicDmg: number;
}

export const GEAR_PRAYERS: Record<string, GearPrayer> = {
  none: { name: "None", acc: 100, def: 100, magicDef: 100, magicDmg: 0 },
  mysticMight: { name: "Mystic Might", acc: 115, def: 100, magicDef: 115, magicDmg: 20 },
  mysticVigour: { name: "Mystic Vigour", acc: 118, def: 105, magicDef: 118, magicDmg: 30 },
  augury: { name: "Augury", acc: 125, def: 125, magicDef: 125, magicDmg: 40 },
};

export interface MagicBoost {
  name: string;
  amount: (level: number) => number;
}

export const MAGIC_BOOSTS: Record<string, MagicBoost> = {
  none: { name: "None", amount: (_level) => 0 },
  imbuedHeart: { name: "Imbued Heart", amount: (level) => 1 + Math.floor(level * 0.1) },
  saturatedHeart: { name: "Saturated Heart", amount: (level) => 4 + Math.floor(level * 0.1) },
  forgottenBrew: { name: "Forgotten Brew", amount: (level) => 3 + Math.floor(level * 0.08) },
};

export interface DefBoost {
  name: string;
  decay: number | null;
}

export const DEF_BOOSTS: Record<string, DefBoost> = {
  none: { name: "None", decay: null },
  brew: { name: "Saradomin Brew", decay: 0 },
  brew3: { name: "Saradomin Brew -3", decay: 3 },
  brew5: { name: "Saradomin Brew -5", decay: 5 },
  brew7: { name: "Saradomin Brew -7", decay: 7 },
};

export interface NPCStats {
  def: number;
  magic: number;
  atk: number;
  str: number;
  ranged: number;
  off: Record<string, number>;
  defensive: Record<string, number>;
  max: number;
  style: string;
  meleeType?: string;
  meleeMax?: number;
}

export const INFERNO_NPCS: Record<string, NPCStats> = {
  nibbler: {
    def: 15,
    magic: 15,
    atk: 1,
    str: 1,
    ranged: 1,
    off: { crush: 0 },
    defensive: {
      stab: -20,
      slash: -20,
      crush: -20,
      magic: -20,
      light: -20,
      standard: -20,
      heavy: -20,
    },
    max: 4,
    style: "melee",
    meleeType: "crush",
  },
  bat: {
    def: 55,
    magic: 120,
    atk: 1,
    str: 1,
    ranged: 120,
    off: { ranged: 30 },
    defensive: { stab: 30, slash: 30, crush: 30, magic: -20, light: 45, standard: 45, heavy: 45 },
    max: 19,
    style: "range",
  },
  blob: {
    def: 95,
    magic: 160,
    atk: 160,
    str: 160,
    ranged: 160,
    off: { crush: 0, magic: 45, ranged: 45 },
    defensive: { stab: 25, slash: 25, crush: 25, magic: 25, light: 25, standard: 25, heavy: 25 },
    max: 29,
    style: "blob",
    meleeType: "crush",
  },
  blobletMage: {
    def: 95,
    magic: 120,
    atk: 1,
    str: 1,
    ranged: 1,
    off: { magic: 25 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 25, light: 0, standard: 0, heavy: 0 },
    max: 18,
    style: "magic",
  },
  blobletRange: {
    def: 95,
    magic: 1,
    atk: 1,
    str: 1,
    ranged: 120,
    off: { ranged: 25 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 0, light: 25, standard: 25, heavy: 25 },
    max: 18,
    style: "range",
  },
  blobletMelee: {
    def: 95,
    magic: 1,
    atk: 120,
    str: 120,
    ranged: 1,
    off: { crush: 0 },
    defensive: { stab: 25, slash: 25, crush: 25, magic: 0, light: 0, standard: 0, heavy: 0 },
    max: 18,
    style: "melee",
    meleeType: "crush",
  },
  meleer: {
    def: 120,
    magic: 120,
    atk: 210,
    str: 290,
    ranged: 220,
    off: { slash: 40 },
    defensive: { stab: 65, slash: 65, crush: 65, magic: 30, light: 50, standard: 50, heavy: 50 },
    max: 49,
    style: "melee",
    meleeType: "slash",
  },
  ranger: {
    def: 60,
    magic: 90,
    atk: 140,
    str: 180,
    ranged: 250,
    off: { ranged: 40, crush: 0 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 0, light: 0, standard: 0, heavy: 0 },
    max: 46,
    style: "range",
    meleeMax: 19,
    meleeType: "crush",
  },
  mager: {
    def: 260,
    magic: 300,
    atk: 370,
    str: 510,
    ranged: 510,
    off: { magic: 80, stab: 0 },
    defensive: { stab: 0, slash: 0, crush: 0, magic: 0, light: 0, standard: 0, heavy: 0 },
    max: 70,
    style: "magic",
    meleeMax: 52,
    meleeType: "stab",
  },
};

export const FLOOR_RAW: string[][] =
  "311d25,2f1c24,301b22,311c24,311c22,301a20,301a1f,311b20,301b20,301b20,301c21,301c21,301c23,301c23,301c23,301c23,2f1c23,2e1b22,301d23,301c22,321e24,2c171d,311b21,311b21,321c23,321c23,311c22,301c21,2f1c23|2e1b23,2e1b23,2e1b22,311c23,311c22,301b21,311b20,311c21,311b20,311c21,311c22,311d23,301d24,311d24,311d24,311d24,321f26,301c23,2d1a20,2d1a20,321d23,301c21,321d23,311c22,311c22,311c22,301c21,301c21,2f1c23|2d1b23,301d25,301e24,301c23,2f1c21,301c21,311d21,311d21,321e23,321e23,331e23,331f24,332025,332026,332026,332026,342229,332127,301e23,311e24,311d23,311e24,311c22,311c22,301c21,301c21,301c21,301c21,2f1c23|2c1b23,2e1d25,2f1e25,2e1c22,2d1b20,301c22,321f23,331e23,352125,352125,362226,372227,362327,372428,372428,362429,342328,332329,342429,352328,301e23,301d23,2c181e,301b21,301b21,301b21,301c21,301c21,301c23|2c1b23,2d1d24,2d1d24,2c1b21,2d1c21,311e24,342125,352226,362327,372426,382529,39262a,39272a,3a272b,39282b,38282b,3b2b2f,322327,332327,332327,36252a,37252a,321e24,342127,301c21,301c21,301c21,301c21,301c21|2f2027,2e1e26,2d1e25,2f1f25,302025,312124,332225,362326,382628,392728,3b2829,3c2a2b,3d2b2b,3d2b2c,3d2b2c,3c2c2d,36282a,1d1014,1a0c14,1c0d14,302024,332327,2e1c21,2f1c21,301d23,311d23,311c22,301c21,301c21|291b22,26181f,281a20,302126,342429,342327,342326,382628,3c2a2b,3d2c2b,3e2d2c,402f2e,41302e,41302e,41302e,3f312f,3e3232,1a0d14,160b14,180b14,38292c,3b2b2e,36262a,362329,321e24,311e24,301d23,2f1c21,2e1b21|1a0d14,170b14,1d1016,2b1d22,34262a,362629,382829,3c2c2c,3f2e2d,402f2d,42312e,433230,443430,443430,443430,433431,403432,170d14,170c14,180c14,3b2d2f,38292c,362529,342429,322025,321e24,301d23,2f1c21,2e1b21|180b14,160b14,1a0c14,302326,36272a,392a2c,372727,3e2e2e,40312e,42332f,443630,463731,483932,493b34,493a32,473a32,453a34,423834,413532,3e3330,3e302f,3b2c2d,38282b,362529,352328,332126,311e24,2f1c21,2e1b21|190b14,180b14,1c0f14,2e2125,362729,3b2c2d,3c2c2b,433330,443430,463730,493a32,4a3c33,4c3e35,4d4035,4d4035,4b3e35,483e35,463c35,443933,423632,413330,3e2f2f,3b2b2c,38272a,362428,342227,321e24,301c22,2f1c21|2f2026,2f2026,302126,38292c,3a2b2c,3d2e2e,3e2e2c,43332f,483932,4a3c33,4d4035,4f4236,514438,524639,524639,514537,4d4337,4b4136,493e35,463a32,443731,413230,3d2d2e,3c2a2c,38262a,362327,332025,311d23,301c22|312128,322329,35252a,39292c,3b2b2c,3f302d,43332f,473831,4b3d34,4e3f34,514437,534739,554a3a,574c3b,574c3b,554b3a,524839,504637,4c4235,4a3d34,473931,433430,41302e,3d2c2c,3b282b,382529,342127,321e24,301d23|2d1c23,312125,362629,382829,3c2c2c,42312e,483732,4a3b33,4d3f35,514336,54483a,584c3b,5a4f3c,5b523e,5b523e,59503c,574d3a,554939,514637,4d4133,4a3c32,473630,42312f,3f2d2d,3c292b,39272b,362228,321f25,301e23|332126,352528,3c2b2e,3c2a2c,402f2e,42312d,483831,4a3a31,504236,544639,584c3b,5c513e,5e5440,5f5740,5f5740,5d553f,5d523d,5a4e3b,554938,514336,4d3e32,493931,44332f,412f2f,3d2a2c,3a272b,362327,332025,311e24|311e24,322024,39272a,3a2829,412f2e,42302c,493932,4c3c32,524437,56493a,5a4e3c,5e533f,605741,635a43,625a42,605841,5f553e,5d513c,584c39,544535,4f3f33,4a3931,46342f,42302f,3d2b2c,3b282b,362327,332025,311f25|362329,362327,3c292c,3b292a,43312f,41312c,4a3933,4c3d33,524437,564a39,5b503d,5e5540,625943,645c44,635d44,625a42,605640,5e513d,594c3a,544636,4f3f33,4a3a31,45342f,42312e,3d2b2c,3b282a,362327,332025,321e25|342125,362327,39272a,3d2b2c,402f2e,433431,483934,4b3e34,53463a,534838,5c5140,5e5541,625943,625a42,645e45,635b44,605542,5d513f,584c3b,534638,4e3f34,493a32,44352f,42312e,3d2c2b,3a282a,362327,332024,321e24|332125,362326,38272a,3c2b2b,3e2e2e,433330,473933,4a3d35,504439,55493c,564c3c,5f5543,5d5440,675e48,615a42,5f5741,5f5442,5c5040,574a3c,524638,4d4035,483b32,44352f,41322f,3d2c2b,3a282a,362327,332024,331e24|322024,352226,382629,3b292a,3e2e2d,42322f,463833,493c34,4f4239,54483c,554b3c,5d5342,5a523f,605744,5d543f,5e5540,5c5140,594d3d,55483a,504337,4c3e35,483932,433430,40312e,3c2b2a,39282a,362327,332024,321e24|322024,342225,372629,3b292a,3d2d2c,41312f,463632,483934,4d3f37,4f4337,564a3d,574c3d,5b5141,544c3a,584f3c,5c5240,584c3c,55493b,514437,4d4035,4a3b34,463730,41322e,3e2f2c,3b292a,392729,362326,322024,321d23|321f23,342125,362527,39282a,3c2b2b,3f2f2e,433431,463833,463830,4d4138,4f4239,4e4437,564c3d,5b5142,574d3e,53493a,53473a,514438,4e4036,4a3c33,473831,43342f,41302d,3e2d2b,3a2829,372627,342225,321f23,301d23|311e23,332024,352326,382628,3a282a,3e2c2d,41312f,433431,483a35,493c34,221514,170b14,1c0f14,4c4136,51463a,53473b,4f4237,4d4035,4a3c33,483931,453630,42322e,3f2e2c,3c2b2a,382628,362427,332024,311d23,301c23|301d21,321f23,342125,362326,382628,3b292a,3e2e2d,41312f,423330,463833,1a0b14,160b14,180b14,50433b,4a3e35,493d34,4a3d34,493b33,473831,443630,43322e,402f2c,3c2b2a,392829,372427,342226,321f23,301c22,2f1c23|2f1c20,311e22,332024,352226,362527,39282a,3c2c2c,3e2e2e,413130,423230,1c0d14,1a0b14,1e1014,483b35,443730,483934,473831,463730,43342f,41322e,402f2c,3d2c2a,392829,372527,362327,332125,311e24,2f1c21,2e1b22|301d21,301d21,311e22,332024,352326,382628,3b292b,3c2b2b,3d2d2e,3e2e2e,413130,423331,433431,433431,433431,423430,42332f,43322e,41302e,3f2e2c,3c2b2a,392829,382527,372427,332024,321e24,301d24,2f1c23,2e1b22|2f1c21,2f1c20,301d21,321f23,332125,362527,38272a,39282a,3b2b2c,3c2c2c,3d2d2e,3f2f2f,403030,3f312f,3f312f,3f302e,402f2d,3f2e2c,3e2d2c,3c2b2a,392829,372627,362326,342226,321e24,311e24,301d24,2f1c23,2e1b22|2e1b22,2e1b21,2f1c21,301d23,321e24,332125,352327,362527,382629,392729,3b292b,3b2b2c,3c2c2d,3c2c2c,3c2c2c,3c2c2c,3c2b2b,3c2a2a,3b2829,392629,372528,352226,332125,321f25,301d23,301d24,301c24,2f1c24,2f1c23|2e1b22,2e1b22,2e1b22,2f1c21,301d23,311e24,322025,322024,352327,362427,372629,382729,382829,38282a,382829,392729,392629,382628,372527,362327,342226,332025,321e24,311e25,2f1c23,2f1c23,2f1c24,2f1c24,2f1c23|2f1c24,2f1c23,2f1c23,2f1c23,301c23,301d23,311d23,311e23,332024,332124,342225,352326,362426,362426,362426,362426,362326,372226,362125,342025,322024,311e24,301d24,301c24,2e1b23,2e1b23,2f1c24,2f1c24,301c24|301c24,2f1c24,2f1c23,2f1c23,2f1c23,301c23,301c22,301d23,311e23,321f23,322023,322124,332123,332123,332123,332123,352125,342024,331f24,321e23,301d23,301c22,2f1c24,2e1b23,2f1c24,2f1c24,2f1c24,2f1c24,2f1c24"
    .split("|")
    .map((r) => r.split(",").map((c) => "#" + c));

export const PRAYER_IMG_DATA: Record<string, string> = {
  mage: "data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAbABsDASIAAhEBAxEB/8QAGAAAAwEBAAAAAAAAAAAAAAAAAAUHBgj/xAAmEAABAwQCAQQDAQAAAAAAAAABAgMFBAYREgAHMRQhIkEyUXFi/8QAFwEBAAMAAAAAAAAAAAAAAAAABQIDBv/EACgRAAEDAgQEBwAAAAAAAAAAAAECESEDBAAFMUEiUXLwBhMUMkJhcf/aAAwDAQACEQMRAD8A4y4ce2Rac5eU61DQFGamqdOB9JT58n68H+AEnABItVgdUW9DTzYlK9i5KxlIqnfQqUqnjmUpC1uvKT8XAkHGraiVH2StCgNqri5oWoCq62eQBKiHbhTqZgGA8EjCuXZPc35emGSNTsBz7h4fE3t6xKiPjG7qvFh+NhPNOpTYUp9wH4jQ/k3sNFke6MjIyQDkLir6aTmqqvo42njGHlbIpGCS2yMAapz74/uT+yfPNn3R2LX3pJNR6VqRDRilN0TO4WB7kFQIASAf8gDGAAlIQhE84hVrK8pNEpCWckAvLnVTByAwJACXdnDEwv10kH09D2g67k/vLuYx0nSzMjEdaWpQxRYpW5K3x6xxqmbDzwNQ6kpU6E76kNoBTtggYxji7sicjrF6+ct+iq/UXJcFOxUVS0tjFLTKAcQ2lRG2xyhalAgbJQkbaqPJdD9pdhw8XTxcVd8rRUVMjRlhl7VCE/oAcQ3LcEzcsoZSekX5GtUgIU+8crUkeAT944FSy1AzBd5UL8Slp6ip0E9A0b5BJ0DF648TINmbegkgkCYb703LAvJgbRhZw4cOJYx+P//Z",
  range:
    "data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAYABgDASIAAhEBAxEB/8QAGQABAQEAAwAAAAAAAAAAAAAAAAYEAwUI/8QAKhAAAgEEAQEGBwEAAAAAAAAAAQIDAAQREgUiBhMxMkFRFCElQ2FykqH/xAAVAQEBAAAAAAAAAAAAAAAAAAAEBf/EACURAAIBAQcFAQEAAAAAAAAAAAECESEAAwQSMUFRBWFxkdGB4f/aAAwDAQACEQMRAD8A8ZV2/ZWwt+Q5PS6DPHGFbuwde8ZpERVLeKrs4yQCcA4+dYuLsLjkbsW9uFBALu7nVI0Hi7H0Ue9Vn0/iuK+4LAP+k3ISr/qop/j8yHoo4HCM83pgATE6TyewMFvwVJALsJhi83hoBOuk/BSfVSQDy9qOBUpKDCkYjWS4t7i2gjVJEWPLqyDDBQy9LdXnAJJIJVN8p2gvuQtDavrHGxBk1eR2kx5QzOzEqDkhc4yScZpRr68LqgdszgVaInj0N4E8cnvXzKoY5mGp0nj0N4E8WobO5sYOM0f4YwmCKRliuYIttIA2Dqe8MhlBXqzjYkDbVlkeUv7jkbs3FwVBACIiDVI0Hgij0Ue1KVT6qWRVQMYavweBWBtJ5s/qDsFVZoa/zwNh3NstKUqJaVb/2Q==",
  melee:
    "data:image/png;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAUDBAQEAwUEBAQFBQUGBwwIBwcHBw8LCwkMEQ8SEhEPERETFhwXExQaFRERGCEYGh0dHx8fExciJCIeJBweHx7/2wBDAQUFBQcGBw4ICA4eFBEUHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh4eHh7/wAARCAAeAB4DASIAAhEBAxEB/8QAGgAAAQUBAAAAAAAAAAAAAAAABQADBgcIBP/EACcQAAICAQQBAwQDAAAAAAAAAAECAwQRBQYSIQAHEzIVIjFBYXFi/8QAFwEBAQEBAAAAAAAAAAAAAAAABAUBA//EAC8RAAEDAgQDBAsAAAAAAAAAAAECAxEhMRIiMkEABAUTM1HwQlJhYnGBkaGxweH/2gAMAwEAAhEDEQA/AMZeF9s7d1HcNg1tMjeewXCRwRQSzSyMVdsKkaMxwsbE9dAeCPJ7sptW2tNFfo2rFHVorMFkTwkhqIHIAP0QzyKzqIiDkE5H687tNLWha0gZUk5pAxQcIMVqqLVubA8J5ZsKJUvSBX6UHxJ8xPArStLrVu4p6epW5UyjKPcgrIR83DAcpPyAhHWMn9eObqSj9IZqcWfamhjklNeJMS8Zi6q0aLkYEZwckE+XxvbUdu+sHpre3LX06lo3qHt1Bb12GiYxNbpqBHO6vzAZVRQw58njMYQfNWfOO6rDvq01FQsdWjI8FeFOlRQxGf5Y4ySeyfDdI6yvqDDq3EdkWzgLUzmInET6QIqlW9AIAoxa0paJTpsAN5mp/s1gClpZ6abK1TWLqHTa3v3QiTPOU5wabE3azSn4+4QCUUkAY5HAHUk3la0PRKkuh6ROTWpOyXtSzzd5W+axkgc53wMseowB0pH2i9q+rOobc2da21pVyejBdMbz2IaYNqNhDFE4il90BcrF03DI5EjBAIrvWNSfUJI1WNa9WAcK9dD9sS/6x/JY9k+XuYQGAC4Mg0p9b3lfad7JEC2PJDQGMZRpHj7T+99hAt1XNw2puEMNenDThyK9dq0coiX+3Ukk4yT+z34Lszy2bMtiZucsrl3bAGWJyT1434vJb/NPP94on8fIWEWEWFOAuvuO61E+fDj/2Q==",
};

export const MOB_TYPE_PRIORITY: Record<string, number> = {
  mager: 0,
  ranger: 1,
  meleer: 2,
  blob: 3,
  bat: 4,
  nibbler: 5,
  blobletMage: 6,
  blobletRange: 7,
  blobletMelee: 8,
};

export interface PracticePrayer {
  label: string;
  audio: string;
}

export const PRACTICE_PRAYERS: Record<string, PracticePrayer> = {
  mage: { label: "Magic", audio: "assets/audio/Protect_from_Magic.mp3" },
  range: { label: "Range", audio: "assets/audio/Protect_from_Missiles.mp3" },
  melee: { label: "Melee", audio: "assets/audio/Protect_from_Melee.mp3" },
};

export const PRACTICE_DEACTIVATE_AUDIO = "assets/audio/prayer_deactivate_audio.mp3";
