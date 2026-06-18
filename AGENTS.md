# AGENTS.md — AUTOZUK

## What this repo is

Vite-based vanilla HTML/TS/CSS single-page app: an Old School RuneScape Inferno wave simulator and tile solver. No runtime dependencies. TypeScript migration is complete; all source files under `src/` are now `.ts`, but `tsconfig.json` still sets `strict: false` and `allowJs: true` for safety.

## Tooling

- Package manager: **pnpm** (`package.json` pins `devEngines.packageManager` to `pnpm@^11.2.2`).
- Build: **Vite** (`vite.config.ts` → output `dist/`, sourcemaps enabled).
- Lint: **oxlint** (`.oxlint.json`; only explicit rule is `no-debugger: error`).
- Format: **oxfmt** (`.oxfmtrc.json`; no ignore patterns).
- Type check: **tsc --noEmit** (`tsconfig.json` includes `src/**/*.js` and `src/**/*.ts`; `moduleResolution: Bundler`, `types: ["vite/client"]`).

## Common commands

```bash
pnpm dev          # start Vite dev server
pnpm build        # production bundle → dist/
pnpm preview      # serve the built dist/ locally
pnpm typecheck    # tsc --noEmit
pnpm lint         # oxlint .
pnpm format       # oxfmt --write . (touches whole repo)
pnpm format:check # oxfmt --check .
```

There are no automated tests. Verify with `pnpm typecheck`, `pnpm build`, `pnpm lint`, and manual browser checks via `pnpm dev` / `pnpm preview`.

When touching only a few files, prefer targeted formatting:

```bash
pnpm exec oxfmt --write src/script/foo.ts src/script/bar.ts
```

## Project layout

- `index.html` is the only root asset. It loads:
  - `<script type="module" src="/src/script/main.ts"></script>`
  - `<link rel="stylesheet" href="/src/style.css" />`
- Source lives under `src/`:
  - `src/sim/*` — headless engine (constants, pathing, combat, main engine). Shared with the worker.
  - `src/script/*` — UI code: state, constants, gear, audio, heatmap, sim controls, render, UI handlers, main orchestration.
  - `src/autozuk-worker.ts` — web worker.
  - `src/types.ts` — shared TypeScript types.
  - `src/style.css` — plain CSS.
- `public/assets/audio/` — static audio files copied verbatim to `dist/` by Vite.
- `dist/` — build output (gitignored).

## Worker loading

The worker is instantiated as an ES module worker from `src/script/main.ts`:

```ts
new Worker(new URL("../autozuk-worker.ts", import.meta.url), { type: "module" });
```

`src/autozuk-worker.ts` uses standard ES `import` statements (not `importScripts`) to pull from `src/sim/`. Vite bundles it as a separate chunk during `pnpm build`.

## Module conventions

- All source files are ES modules. `package.json` sets `"type": "module"` project-wide.
- Keep `.js` extensions on relative TypeScript imports (e.g., `import { ... } from "./ui.js"`). This is required by the browser ES-module loader and by the current `tsconfig.json`.
- Use `.ts` in `new URL(...)` for the worker because it names the actual source file.
- `src/script/ui.ts` exports functions only and has no top-level side effects.
- `src/script/main.ts` owns app initialization and exposes selected functions onto `window` for inline HTML event handlers at the bottom of the file.
- `src/script/state.ts` holds the global reactive UI state imported by `sim.ts`, `render.ts`, `heatmap.ts`, `ui.ts`, and `main.ts`. `practiceState` also lives here.

## External data dependency

The equipment selector fetches live OSRS Wiki equipment JSON on first open:

```
https://raw.githubusercontent.com/weirdgloop/osrs-dps-calc/master/cdn/json/equipment.json
```

If that fetch fails, the gear editor shows an error and falls back to hard-coded loadout presets (`LOADOUTS` in `src/sim/constants.ts`).

## Domain conventions

- Spawn codes are uppercase letters (`M`, `R`, `X`, `B`, `Y`, `O`) with optional digit for game-index ordering.
- All coordinates use a local grid where the arena SW corner is `(1, 1)`.
- Mob `x,y` refers to the **south-west tile** of the NPC footprint.
