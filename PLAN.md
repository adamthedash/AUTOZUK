# Vite Migration Plan

Goal: move the vanilla HTML/CSS/JS AUTOZUK app onto Vite + pnpm, with everything under `src/`, while keeping the existing JavaScript logic as-is. TypeScript migration will happen iteratively afterwards.

## 1. Bootstrap tooling

Create `package.json` via pnpm and install dev dependencies:

```bash
pnpm init
pnpm add -D vite typescript oxlint oxfmt
```

Add scripts to `package.json`:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc --noEmit",
    "lint": "oxlint .",
    "format": "oxfmt --write .",
    "format:check": "oxfmt --check ."
  }
}
```

There are no runtime dependencies to install.

## 2. TypeScript config (for gradual migration)

Create `tsconfig.json` that accepts the current `.js` files without requiring types yet:

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2020", "DOM", "WebWorker"],
    "allowJs": true,
    "checkJs": false,
    "strict": false,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*.js", "src/**/*.ts"]
}
```

This lets us keep `.js` files for now and rename them to `.ts` one-by-one later.

## 3. Vite config

Create `vite.config.ts`:

```ts
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
```

GitHub Pages / deployment base-path handling is out of scope for now and will be added later when needed.

## 4. Restructure files under `src/`

Move everything under `src/`:

```
src/
  sim/
    constants.js
    pathfinding.js
    combat.js
    main.js          # headless engine (formerly sim-core.js)
  script/
    constants.js
    gear.js
    audio.js
    heatmap.js
    sim.js
    render.js
    ui.js
    main.js          # UI entry point
  autozuk-worker.js
  style.css
public/
  assets/
    audio/           # static audio files served unchanged
      ...
index.html           # stays at project root
```

## 5. Convert to ES modules (minimal logic changes)

For each file, add `import`/`export` statements so Vite can bundle them. No logic rewrites.

- **Engine files** (`src/sim/*.js`): export all top-level functions and constants used by other files.
- **UI files** (`src/script/*.js`): export their public functions and import the engine/UI modules they depend on.
- **`src/autozuk-worker.js`**: replace `importScripts(...)` with ES module imports:

  ```js
  import { MOB_DEFS } from "./sim/constants.js";
  import {
    createRegion,
    parseSpawnCode,
    checkTileExcluded,
    hlRunSim,
    optimizePrayer,
  } from "./sim/main.js";
  import { calcSimDamage } from "./sim/combat.js";
  ```

- **`src/script/main.js`**: instantiate the worker as a module worker:

  ```js
  const worker = new Worker(new URL("../autozuk-worker.js", import.meta.url), { type: "module" });
  ```

All import paths keep the `.js` extension (required for browser ES modules).

## 6. Update `index.html`

Replace the long list of `<script>` tags with a single module entry and a CSS link:

```html
<!doctype html>
<html>
  <head>
    <link rel="stylesheet" href="/src/style.css" />
  </head>
  <body>
    <!-- existing markup -->
    <script type="module" src="/src/script/main.js"></script>
  </body>
</html>
```

## 7. Format / lint setup

Add minimal config files:

- `.oxlint.json` for lint rules.
- `oxfmt` config if supported; otherwise rely on CLI defaults.

The `lint`, `format`, and `format:check` scripts are already defined in step 1.

## 8. Verify locally

- `pnpm dev` — run the dev server locally.
- `pnpm build` — produce a production bundle in `dist/`.
- `pnpm preview` — test the production build locally.
- Smoke-test core flows: worker init, simulation, prayer optimizer, audio, canvas rendering.

## 9. Future TypeScript migration

When ready:

- Rename files `.js` → `.ts` one at a time.
- Turn on `checkJs: true` and incrementally enable `strict` flags.
- Add interfaces for shared types such as `Mob`, `Player`, `Region`, `Loadout`, and `SimState`.

## Notes

- The app currently has no runtime npm dependencies, so the built output will remain self-contained.
- `script/ui.js` declares functions only and has no top-level side effects, so it can be safely imported.
- `script/main.js` (UI entry) owns app initialization, which is exactly what Vite’s module entry will run.
