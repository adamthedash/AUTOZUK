# AGENTS.md — AUTOZUK

Single-page HTML app (OSRS Inferno wave solver). No build system, no dependencies.

## Architecture

Everything lives in `index.html` (~210 KB). It contains three `<script>` blocks:

1. `<script id="sim-core">` — Pure simulation engine. Shared between the main thread and Web Workers.
2. `<script id="autozuk-worker" type="text/worker-source">` — Worker glue. At runtime the app concatenates `sim-core` + this block into a Blob URL for the worker.
3. `<script>` (main, no id) — UI, canvas rendering, DOM events, practice mode, gear modal.

## Critical constraint: sim-core must stay DOM-free

`sim-core` runs inside a worker. It must not reference `document`, `window`, `navigator`, or any DOM API.
If you add a helper that both main and sim-core need, move it into `sim-core`.

## Verification commands

Run these from the repo root after any change to `index.html`:

```bash
node scripts/check-syntax.js    # Parse all <script> blocks for JS syntax errors
node scripts/check-simcore.js   # Smoke-test sim-core in a worker-like sandbox
node scripts/check-worker.js    # Smoke-test sim-core + worker glue together
```

Regression test (deterministic hash of simulation outputs):

```bash
node scripts/equiv-hash.js      # Prints a hex hash; compare before/after changes
```

## Utility scripts

- `scripts/split-simcore.js` — One-shot script used to originally extract sim-core from main. Contains hardcoded line numbers; do not re-run without updating ranges.
- `scripts/move-helpers.js` — One-shot script to move helper functions from main into sim-core. Also uses hardcoded line numbers.

## Assets

`assets/audio/` contains MP3s for prayer sounds. They are loaded via standard `<audio>` elements in the main thread.

## Local development

Open `index.html` directly in a browser. No server or build step is required.
