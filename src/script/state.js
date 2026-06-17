// Central mutable state shared across UI modules.
// ES module imports are live but read-only in importers, so cross-module
// mutable state lives here and is accessed as properties on `state`.

export const state = {
  // Phase 1 simulation
  sim: null,
  pillars: { S: true, W: true, N: true },
  playerPlacement: null,
  playing: false,
  playInterval: null,
  tickEvents: [],
  mobIdCounter: 0,
  tickHits: {},
  gridMobColumns: [],
  previewMobs: [],
  tickGridUserScrolled: false,
  eventListUserScrolled: false,

  // AUTOZUK solver
  autozukRunning: false,
  autozukResults: {},
  autozukMode: false,
  autozukHidden: false,
  selectedTile: null,
  excludedTiles: new Set(),
  activePrayerSeq: null,
  solverPreviewState: null,

  // Gear / loadout
  currentLoadoutKey: "ayak",
  currentLoadout: null,
  wikiEquipment: [],
  wikiLoadStarted: false,
  gearDraftStats: null,
  isRenderingGear: false,
  gearConfigs: null,
};
