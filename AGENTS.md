# AGENTS.md — AUTOZUK

## What this repo is

Pure-static HTML/JS/CSS single-page app: an Old School RuneScape Inferno wave simulator and tile solver. No framework, no build step, no package manager, no tests.

## Script loading

`index.html` loads all JS from external files:

- `<script src="sim-core.js"></script>` — simulation engine
- `<script src="script.js"></script>` — UI layer

`autozuk-worker.js` is loaded directly by `new Worker('autozuk-worker.js')` in `script.js`.

## Worker construction

`autozuk-worker.js` begins with `importScripts('sim-core.js')` so workers share the same engine code as the main thread. The worker is instantiated directly from its file path.

## How to run / verify changes

Serve the repo root with any static file server and open `index.html`:

```bash
python3 -m http.server 8080
# or
npx serve .
```

There is no test suite, lint config, or CI. Manual browser verification is the only validation path.

## External data dependency

The equipment selector fetches live OSRS Wiki equipment JSON on first open:

```
https://raw.githubusercontent.com/weirdgloop/osrs-dps-calc/master/cdn/json/equipment.json
```

If that fetch fails, the gear editor shows an error and falls back to hard-coded loadout presets (`LOADOUTS` in `sim-core.js`).

## Code architecture (brief)

- **sim-core** — headless engine: spawn parsing, mob pathing, combat ticks, prayer optimizer, damage calculator. Shared verbatim between main thread and workers.
- **script.js** — UI layer: canvas rendering, event handling, manual simulation controls, gear editor, worker pool orchestration, AUTOZUK solver flow.
- **index.html** — markup only; loads `sim-core.js`, `script.js`, and `style.css` externally.
- **style.css** — plain CSS, no preprocessor.

## Key conventions

- Vanilla JS only; no transpilation.
- Spawn codes are uppercase letters (`M`, `R`, `X`, `B`, `Y`, `O`) with optional digit for game-index ordering.
- All coordinates use a local grid where the arena SW corner is `(1, 1)`.
- Mob `x,y` refers to the **south-west tile** of the NPC footprint.
