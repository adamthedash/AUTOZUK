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
  mobType?: MobType;
  mobId?: number;
  fireTick?: number;
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
  mobId: number;
  damage: number;
  source: "ring" | "echo";
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

export interface MonsterAtkEntry {
  max?: number;
  acc?: number;
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
  playerAcc: Record<Exclude<MobType, "nothing">, [number, number]>;
  monsterAtk: Record<Exclude<MobType, "nothing">, MonsterAtkEntry>;
}

export type LoadoutKey = "ayak" | "blowpipe" | "bloodBarrage";

export type Prayer = "mage" | "range" | "melee";
export type PrayerSequence = [Prayer, Prayer, Prayer, Prayer];

export interface AttackEvent {
  tick: number;
  isPlayerAttack?: boolean;
  isScan?: boolean;
  isRevive?: boolean;
  isAttack?: boolean;
  isHit?: boolean;
  isResurrect?: boolean;
  playerDmg?: number;
  mobDmg?: number;
  mobType?: MobType;
  mobId?: number;
  targetMobId?: number;
  targetMobType?: MobType;
  style?: CombatStyle | "blob" | null;
  scanTick?: number;
  accRoll?: number;
  dmgRoll?: number;
  distAtFire?: number;
  hitTick?: number;
  reviveHp?: number;
  detail?: string;
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
  attacks: AttackEvent[];
  completedTick: number;
  status: "complete" | "cleanup" | "trapped" | "timeout" | "invalid";
  cleanupReason?: string;
  mobs: Mob[];
  mobInitHP: HeadlessSim["mobInitHP"];
}

export interface AutozukSummary {
  avgDamage: number;
  damages: number[];
  completionTicks: number[];
  over50Pct: number;
  avgTicks: number;
  avgTime: string;
  prayer: PrayerSequence;
  invalidPct: number;
  totalSims: number;
  deathPct: number;
  markedDead: boolean;
}

export interface TickEvent {
  tick: number;
  type: MobType | "player-atk" | "blob";
  detail: string;
  mobId?: number;
  isHit?: boolean;
  isScan?: boolean;
  isAttack?: boolean;
  isPlayerAttack?: boolean;
  isResurrect?: boolean;
  hitTick?: number;
}

export interface TickHit {
  mobId: number;
  mobType: MobType;
  color: string;
  letter: string;
  style?: CombatStyle | "blob";
  isScan?: boolean;
}

export interface GridMobColumn {
  id: number;
  letter: string;
  color: string;
  type: MobType;
}

export interface PreviewMob {
  x: number;
  y: number;
  size: number;
  color: string;
  letter: string;
  type: MobType;
}

export interface SolverPreviewFrame {
  tile: Tile;
  tick: number;
  player: { x: number; y: number; aggroId: number | null };
  mobs: Array<{
    id: number;
    type: MobType;
    x: number;
    y: number;
    size: number;
    hp: number;
    maxHp: number;
    dying: number;
    hasLOS: boolean;
    flickering: boolean;
  }>;
}

export interface SolverPreviewState {
  running: boolean;
  spawnCode: string;
  loadout: Loadout;
  maxTicks: number;
  maxSims: number;
  seedBase: number;
  frames: SolverPreviewFrame[];
  frame: SolverPreviewFrame | null;
  lastFrameAt: number;
  nextBuildAt: number;
  raf: number;
}

export interface PracticeState {
  open: boolean;
  running: boolean;
  tick: number;
  interval: ReturnType<typeof setInterval> | null;
  active: Prayer | null;
  pending: Prayer | undefined;
  visual: Set<Prayer>;
  clientOrder: Prayer[];
  records: Record<number, Prayer | null>;
  solution: PrayerSequence | null;
  metronomeStart: number;
  restoreAutozukHidden: boolean | null;
  restoreTile: Point | null;
  popoutReady: boolean;
  popoutPos: Point | null;
  dragging: { dx: number; dy: number } | null;
}

export interface WikiEquipment {
  name: string;
  version?: string;
  slot: string;
  offensive?: Record<string, number>;
  defensive?: Record<string, number>;
  bonuses?: Record<string, number>;
}

export interface GearConfig {
  levels: { magic: number; def: number; hp: number };
  prayer: string;
  magicBoost: string;
  defBoost: string;
  gear: Record<string, string>;
}

export interface GearDraftStats {
  key: string;
  config: GearConfig;
  playerAcc: Record<string, [number, number]>;
  monsterAcc: Record<string, number>;
  recoil: {
    hasRecoil: boolean;
    hasRingRecoil: boolean;
    hasEchoBoots: boolean;
    hasSuffering: boolean;
    hasRecoilRing: boolean;
    hasBloodSceptre: boolean;
    effects: string[];
  };
  special: {
    hasRecoil: boolean;
    hasRingRecoil: boolean;
    hasEchoBoots: boolean;
    hasSuffering: boolean;
    hasRecoilRing: boolean;
    hasBloodSceptre: boolean;
    effects: string[];
  };
  maxHit: number;
  baseMaxHit: number;
  magicDamage: number;
  warnings: string[];
  hasConfliction: boolean;
  boosted: { magic: number; def: number };
  weapon: string;
  totals: {
    offensive: Record<string, number>;
    defensive: Record<string, number>;
    bonuses: Record<string, number>;
  };
}

export interface State {
  // Phase 1 simulation
  sim: Phase1Sim | null;
  pillars: PillarConfig;
  playerPlacement: Point | null;
  playing: boolean;
  playInterval: ReturnType<typeof setInterval> | null;
  tickEvents: TickEvent[];
  mobIdCounter: number;
  tickHits: Record<number, TickHit[]>;
  gridMobColumns: GridMobColumn[];
  previewMobs: PreviewMob[];
  tickGridUserScrolled: boolean;
  eventListUserScrolled: boolean;

  // AUTOZUK solver
  autozukRunning: boolean;
  autozukResults: Record<string, AutozukSummary>;
  autozukMode: boolean;
  autozukHidden: boolean;
  selectedTile: Tile | null;
  excludedTiles: Set<string>;
  activePrayerSeq: PrayerSequence | null;
  solverPreviewState: SolverPreviewState | null;

  // Gear / loadout
  currentLoadoutKey: LoadoutKey | string;
  currentLoadout: Loadout | null;
  wikiEquipment: WikiEquipment[];
  wikiLoadStarted: boolean;
  gearDraftStats: GearDraftStats | null;
  isRenderingGear: boolean;
  gearConfigs: Record<string, GearConfig>;
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
  | { type: "exclude-result"; excluded: Tile[]; eligible: Tile[] }
  | { type: "simulate-result"; tile: Tile; summary: AutozukSummary | null };
