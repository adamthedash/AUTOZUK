// =====================================================
// Shared TypeScript types for the AUTOZUK engine and UI.
// Started as a best-effort inference from the JS source.
// Strictness is intentionally loose while the migration is in progress.
// =====================================================

export type Point = { x: number; y: number };
export type Tile = Point;

export type PillarKey = "S" | "W" | "N";
export type PillarConfig = Record<PillarKey, boolean>;

export type MobType =
  | "mager"
  | "ranger"
  | "meleer"
  | "blob"
  | "bat"
  | "nibbler"
  | "blobletMage"
  | "blobletRange"
  | "blobletMelee"
  | "nothing";

export type CombatStyle = "magic" | "range" | "melee";

export interface MobDef {
  letter: string;
  size: number;
  hp: number;
  atkSpeed: number;
  range: number;
  style: CombatStyle | "blob";
  color: string;
  hasFlicker?: boolean;
  hasDig?: boolean;
  isBlob?: boolean;
}

export interface Mob {
  id: number;
  type: MobType;
  x: number;
  y: number;
  size: number;
  hp: number;
  maxHp: number;
  atkSpeed: number;
  range: number;
  style: CombatStyle | "blob";
  attackDelay: number;
  stunned: number;
  frozen: number;
  dead: boolean;
  dying: number;
  dyingStartTick: number;
  corpseRemovalTick?: number;
  revivedOnce: boolean;
  hasLOS: boolean;
  hadLOS: boolean;
  isBlob: boolean;
  blobScanPrayer: string | null;
  hasDig: boolean;
  digTimer: number;
  digLocation: Point | null;
  hasFlicker: boolean;
  flickering: boolean;
  incomingProjectiles: Projectile[];
  noLOSTicks: number;
  currentStyle: CombatStyle | null;
  // Optional fields used by the UI or specific mobs
  letter?: string;
  color?: string;
  aggroTarget?: string;
  infNum?: number;
  parentBlobId?: number;
  _lastScanTick?: number;
  pendingRemovalTick?: number;
}

export interface Projectile {
  delay: number;
  damage: number;
  style?: CombatStyle | "blob";
  isScan?: boolean;
  scanTick?: number;
}

export interface Player {
  x: number;
  y: number;
  size: 1;
  hp: number;
  maxHp: number;
  aggro: Mob | null;
  attackDelay: number;
  range: number;
  atkSpeed: number;
  incomingProjectiles: Projectile[];
  autoRetaliate: boolean;
  lastHit: boolean;
  recoilQueue: RecoilEvent[];
  echoBootsCooldown: number;
  lastAttacker: Mob | null;
  // UI-only additions
  lastBarrageTarget?: { x: number; y: number; tick: number } | null;
}

export interface RecoilEvent {
  tick: number;
  damage: number;
  sourceMobId: number;
}

export interface Entity {
  x: number;
  y: number;
  size: number;
  hp?: number;
  maxHp?: number;
  isPillar?: boolean;
  dead?: boolean;
  id?: string;
}

export interface Pillar extends Entity {
  isPillar: true;
  id: string;
}

export interface Region {
  entities: Entity[];
  pillars: Pillar[];
  blocked: Uint8Array;
}

export interface MonsterAtkStats {
  max: number;
  acc: number;
}

export interface MonsterAtkEntry extends MonsterAtkStats {
  melee?: MonsterAtkStats;
  mage?: MonsterAtkStats;
  range?: MonsterAtkStats;
}

export interface Loadout {
  name: string;
  atkSpeed: number;
  maxHit: number;
  range: number;
  startingHp?: number;
  hasRecoil?: boolean;
  hasRingRecoil?: boolean;
  hasEchoBoots?: boolean;
  hasBloodSceptre?: boolean;
  isBloodBarrage?: boolean;
  playerAcc: Record<MobType, [number, number]>;
  monsterAtk: Record<MobType, MonsterAtkEntry>;
}

export type LoadoutKey = "ayak" | "blowpipe" | "bloodBarrage";

export type Prayer = "mage" | "range" | "melee";
export type PrayerSequence = [Prayer, Prayer, Prayer, Prayer];

export interface AttackEvent {
  tick: number;
  isPlayerAttack?: boolean;
  isScan?: boolean;
  playerDmg?: number;
  mobDmg?: number;
  mobType?: MobType;
  style?: CombatStyle | "blob";
  targetMobId?: number;
  targetMobType?: MobType;
  hitTick?: number;
}

export type RNG = () => number;

export interface HeadlessSim {
  region: Region;
  mobs: Mob[];
  player: Player;
  tick: number;
  deadMobs: Mob[];
  idCounter: number;
  loadout: Loadout;
  attacks: AttackEvent[];
  mobTypes: Set<MobType>;
  mobInitHP: Record<number, { hp: number; type: MobType }>;
  mobMap: Map<number, Mob>;
  delayedBlobletSpawns: { tick: number; blob: Mob }[];
  initialEnemyCount: number;
  rng: RNG;
}

export interface Phase1Sim {
  region: Region;
  mobs: Mob[];
  player: Player;
  tick: number;
  startTick: number;
  deadMobs: Mob[];
  delayedBlobletSpawns: { tick: number; blob: Mob }[];
  // UI-only additions
  practiceMode?: boolean;
}

export interface AutozukResult {
  // Shape is still being inferred from usage in sim.js / main.js / heatmap.js.
  // Marked flexible until those files are converted.
  attacks: AttackEvent[];
  completedTick: number;
  status: "complete" | "cleanup" | "trapped" | "timeout" | "invalid";
  cleanupReason?: string;
  mobs: Mob[];
  mobInitHP: HeadlessSim["mobInitHP"];
  avgDamage?: number;
}

export interface State {
  // Phase 1 simulation
  sim: Phase1Sim | null;
  pillars: PillarConfig;
  playerPlacement: Point | null;
  playing: boolean;
  playInterval: ReturnType<typeof setInterval> | null;
  tickEvents: unknown[];
  mobIdCounter: number;
  tickHits: Record<number, unknown>;
  gridMobColumns: unknown[];
  previewMobs: Mob[];
  tickGridUserScrolled: boolean;
  eventListUserScrolled: boolean;

  // AUTOZUK solver
  autozukRunning: boolean;
  autozukResults: Record<string, AutozukResult>;
  autozukMode: boolean;
  autozukHidden: boolean;
  selectedTile: Tile | null;
  excludedTiles: Set<string>;
  activePrayerSeq: PrayerSequence | null;
  solverPreviewState: unknown;

  // Gear / loadout
  currentLoadoutKey: LoadoutKey | string;
  currentLoadout: Loadout | null;
  wikiEquipment: unknown[];
  wikiLoadStarted: boolean;
  gearDraftStats: unknown;
  isRenderingGear: boolean;
  gearConfigs: unknown;
}

// Worker message shapes used by autozuk-worker.js and script/main.js.
export type WorkerRequest =
  | { type: "init"; pillarConfig: PillarConfig; loadout: Loadout }
  | { type: "exclude"; tiles: Tile[]; spawnCode: string }
  | {
    type: "simulate";
    tile: Tile;
    spawnCode: string;
    loadout: Loadout;
    maxTicks: number;
    maxSims: number;
    seedBase: number;
  };

export type WorkerResponse =
  | { type: "init-ok" }
  | { type: "exclude-result"; excluded: boolean; eligible: boolean }
  | { type: "simulate-result"; tile: Tile; summary: AutozukResult };
