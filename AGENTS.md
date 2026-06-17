# AGENTS.md — AUTOZUK

## What this repo is
Pure-static HTML/JS/CSS single-page app: an Old School RuneScape Inferno wave simulator and tile solver. No framework, no build step, no package manager, no tests.

## Critical: the running code is inlined in `index.html`
The external `.js` files (`sim-core.js`, `autozuk-worker.js`) are **not** loaded by the app. The active code lives in inline `<script>` blocks inside `index.html`:
- `<script id="sim-core">` — simulation engine
- `<script id="autozuk-worker" type="text/worker-source">` — worker source

`script.js` is loaded externally via `<script src="script.js">`.

**Consequence:** editing only `sim-core.js` or `autozuk-worker.js` has **no effect** on the running app. You must update the matching inline block in `index.html`, or uncomment the external `<script src="...">` tags and remove the inline equivalents.

## Worker construction
At runtime, `buildWorkerBlobUrl()` (in `script.js`) concatenates the *textContent* of the two inline scripts above into a Blob and creates Web Workers from it. Workers run the headless simulation engine in parallel for the solver.

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
- **index.html** — markup + inlined sim-core + inlined worker source.
- **style.css** — plain CSS, no preprocessor.

## Key conventions
- Vanilla JS only; no transpilation.
- Spawn codes are uppercase letters (`M`, `R`, `X`, `B`, `Y`, `O`) with optional digit for game-index ordering.
- All coordinates use a local grid where the arena SW corner is `(1, 1)`.
- Mob `x,y` refers to the **south-west tile** of the NPC footprint.
