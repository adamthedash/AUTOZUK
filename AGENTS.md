# AGENTS.md — AUTOZUK

## What this repo is

Vite-based vanilla HTML/JS/CSS single-page app: an Old School RuneScape Inferno wave simulator and tile solver. No runtime dependencies. TypeScript is configured but the source is still mostly JavaScript (`allowJs: true`, `checkJs: false`, `strict: false`) for a gradual migration.

## Tooling

- Package manager: **pnpm** (`package.json` pins `devEngines.packageManager` to `pnpm@^11.2.2`).
- Build: **Vite** (`vite.config.ts` → output `dist/`, sourcemaps enabled).
- Lint: **oxlint** (config in `.oxlint.json`; only explicit rule is `no-debugger: error`).
- Format: **oxfmt**.
- Type check: **tsc --noEmit** (`tsconfig.json` only includes `src/**/*.js` and `src/**/*.ts`).

## Common commands

```bash
pnpm dev          # start Vite dev server
pnpm build        # production bundle → dist/
pnpm preview      # serve the built dist/ locally
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint .
pnpm format       # oxfmt --write .
pnpm format:check # oxfmt --check .
```

There are no tests; verify with `pnpm dev` / `pnpm build` / `pnpm preview` and manual browser checks.

## Project layout

- `index.html` is the only root asset. It loads one module entry:
  - `<script type="module" src="/src/script/main.js"></script>`
  - `<link rel="stylesheet" href="/src/style.css" />`
- Source lives under `src/`:
  - `src/sim/*` — headless engine (constants, pathing, combat, main engine). Shared with the worker.
  - `src/script/*` — UI code: state, constants, gear, audio, heatmap, sim controls, render, UI handlers, main orchestration.
  - `src/autozuk-worker.js` — web worker.
  - `src/style.css` — plain CSS.
- `public/assets/audio/` — static audio files copied verbatim to `dist/` by Vite.
- `dist/` — build output (gitignored).

(The old root `sim/` and `script/` directories no longer exist; files were moved to `src/` during the Vite migration.)

## Worker loading

The worker is instantiated as an ES module worker from `src/script/main.js`:

```js
new Worker(new URL("../autozuk-worker.js", import.meta.url), { type: "module" });
```

`src/autozuk-worker.js` uses standard `import` statements (not `importScripts`) to pull from `src/sim/`. Vite handles bundling it as a separate chunk during `pnpm build`.

## Module conventions

- All source files are ES modules. Browser-style bare script tags are gone.
- Keep `.js` extensions on relative imports (required for browser ES modules and the current tsconfig).
- `src/script/ui.js` exports functions only and has no top-level side effects.
- `src/script/main.js` owns app initialization and exposes selected functions onto `window` for inline HTML event handlers at the bottom of the file.
- `src/script/state.js` holds the global reactive UI state imported by `sim.js`, `render.js`, `heatmap.js`, `ui.js`, and `main.js`.

## External data dependency

The equipment selector fetches live OSRS Wiki equipment JSON on first open:

```
https://raw.githubusercontent.com/weirdgloop/osrs-dps-calc/master/cdn/json/equipment.json
```

If that fetch fails, the gear editor shows an error and falls back to hard-coded loadout presets (`LOADOUTS` in `src/sim/constants.js`).

## Domain conventions

- Spawn codes are uppercase letters (`M`, `R`, `X`, `B`, `Y`, `O`) with optional digit for game-index ordering.
- All coordinates use a local grid where the arena SW corner is `(1, 1)`.
- Mob `x,y` refers to the **south-west tile** of the NPC footprint.

## Things that changed in the Vite migration

- Build tool is Vite, not a manual static file server.
- Source is under `src/`.
- Worker is a module worker with `import`, not `importScripts`.
- `package.json` `"type": "module"` applies project-wide.
