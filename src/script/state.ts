// Central mutable state shared across UI modules.
// ES module imports are live but read-only in importers, so cross-module
// mutable state lives here and is accessed as properties on `state`.
import type { State } from "../types.js";

export const state: State = {
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

  // Practice mode
  practiceState: {
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
  },

  // Gear / loadout
  currentLoadoutKey: "ayak",
  currentLoadout: null,
  wikiEquipment: [],
  wikiLoadStarted: false,
  gearDraftStats: null,
  isRenderingGear: false,
  gearConfigs: {},
};
