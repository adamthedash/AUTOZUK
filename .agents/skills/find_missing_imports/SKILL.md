---
name: find-missing-imports
description: Find missing or bad JavaScript/TypeScript imports that linters and type-checkers miss
license: MIT
compatibility: opencode
metadata:
  audience: developers
  workflow: debugging
---

## What I do

- Surface every function call in a target source file using `ast-grep`
- Filter down to unique bare identifier calls (excluding method/member calls)
- Compare each called identifier against:
  - imports at the top of the file
  - locally defined functions
  - browser/globals
  - function parameters
- Report any called identifier that lacks a matching import or local definition
- Provide the exact import block change needed to fix the mismatch

## When to use me

Use this when a static build/lint/type-check passes but the runtime still fails with a reference error, or when you suspect an ES module import is incomplete.

For best results, confirm the file is part of an ES module project (`"type": "module"` or `.mjs` / `.js` with `import`/`export` syntax). I do not currently handle CommonJS `require`.

## Example workflow

```bash
# 1. Confirm the usual tools pass
./node_modules/.bin/oxlint .
./node_modules/.bin/tsc --noEmit

# 2. List all calls
ast-grep --pattern '$F($$$A)' src/sim/main.js

# 3. Extract unique bare function calls
ast-grep --pattern '$F($$$A)' --json src/sim/main.js | \
node --input-type=module -e '
let data = "";
process.stdin.on("data", c => data += c);
process.stdin.on("end", () => {
  const arr = JSON.parse(data);
  const ids = new Set();
  for (const m of arr) {
    const f = m.metaVariables.single.F.text;
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(f)) ids.add(f);
  }
  console.log([...ids].sort().join("\n"));
});
'
```

Then classify each result and add any missing name to the appropriate `import { ... }` block.
