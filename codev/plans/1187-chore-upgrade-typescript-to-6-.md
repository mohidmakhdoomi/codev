# PIR Plan: Upgrade TypeScript to 6.0.3 across the monorepo

> Issue #1187 — unify the 5.7/5.9 TypeScript drift onto a single lockstep version. This plan
> reflects **empirical verification done at plan time**: every fix below was applied to the
> worktree, driven through the full `check-types` / `build` / `test` / `vscode:prepublish`
> suite under TS 6.0.3, confirmed green, then reverted. Nothing here is speculative.

## Understanding

The monorepo carries `typescript` in six package manifests at three different versions, so each
package's `check-types` runs against a slightly different compiler. **The repo layout has moved
since the issue was written** — the issue's `packages/dashboard` is now `apps/web` and
`packages/vscode` is now `apps/vscode`. The six manifests and their current pins:

| Manifest | Current |
|---|---|
| `apps/web/package.json` | `^5.7.0` |
| `apps/vscode/package.json` | `^5.9.3` |
| `packages/types/package.json` | `^5.7.0` |
| `packages/core/package.json` | `^5.7.0` |
| `packages/codev/package.json` | `^5.7.2` |
| `packages/artifact-canvas/package.json` | `^5.7.0` |

(`packages/config` has no `typescript` dep — it only ships the shared `tsconfig.base.json`.)

**Target-version note (decision A, below).** The issue targets `6.0.3` and says "use whatever the
latest 6.x stable is if 6.0.3 has already been superseded." As of plan time, `npm view typescript`
reports `latest = 7.0.2` — TypeScript **7** (the native/Go compiler) has shipped. **6.0.3 is still
the latest 6.x stable** (only 6.0.2 and 6.0.3 exist on the 6.x line), so it satisfies the issue as
written. TS 7 is a separate major that the issue did not contemplate and explicitly scoped out
("Adopting new TypeScript 6-only features … as widespread refactors … are separate opt-in
workstreams"). This plan proceeds with **6.0.3** and flags TS 7 as an explicit architect decision.

## Verified fallout (what TS 6 actually breaks here)

TS 6 is a major bump. I installed it across all six packages and captured the compiler's own
diagnostics. Two behavior changes account for essentially all the fallout:

1. **`types` now defaults to `[]`** (TS 5.x auto-included every `@types/*` in `node_modules`). Under
   TS 6, a package that relies on ambient `@types/node` without declaring it loses the *entire*
   `@types/node` surface — even `import … from 'node:fs'` fails with `TS2591`. Confirmed:
   - `packages/core` — 9 errors (`node:fs`, `node:path`, `process`, `Buffer`, …)
   - `packages/codev` — 22 errors (same family, across 8 files)
   - `apps/web` — CSS side-effect imports fail with `TS2882` because the `vite/client` ambient
     module declarations (which `declare module '*.css'`) are no longer auto-loaded.
   - `packages/types` — **0 errors** (it uses no Node globals and has no `@types/node` dep — leave
     it alone; forcing `types: ["node"]` there actually errors with `TS2688`).
   - `apps/vscode` — its tsconfigs already declare `types` explicitly (`["node","mocha"]` host,
     `[]` webview), so it needs **no** `types` change.

2. **`baseUrl` deprecation is now a hard error** (`TS5101`, "will stop functioning in TypeScript
   7.0"). Our own tsconfigs don't set `baseUrl`, but **tsup**'s DTS builder (rollup-plugin-dts)
   injects it internally, so `packages/artifact-canvas`'s `pnpm build` fails on it. (This is
   resolved by the tsup→tsdown migration — see below — rather than an `ignoreDeprecations` bandaid.)

**Important cascade caveat.** A first `pnpm --recursive check-types` also lit up ~98 "errors" in
`apps/vscode` and a couple in `apps/web` — all `TS2307 Cannot find module '@cluesmith/codev-core/…'`
and their `TS7006` implicit-any follow-ons. These are **false cascades**: `packages/core` and
`packages/artifact-canvas` had never been built in the fresh worktree, so their `dist/*.d.ts` didn't
exist yet. After building `core` (with fix #1) and `artifact-canvas` (with the tsdown swap), those
counts drop to **zero**. No `apps/vscode` source changes are needed.

**Non-issues, verified so I don't touch them:**
- **`engines.node`** — no change. TS 6.0.3 declares `engines.node: ">=14.17"`, *below* the repo's
  existing `>=20.0.0` (in `packages/codev`). The issue's "Node floor climbing" concern does not apply.
- **`@types/node`** — no bump. The existing `22.x` pins work with TS 6.
- **Deprecated tsconfig options** — none. Every tsconfig is already modern (`NodeNext` / `ES2022` /
  `strict`), with no `baseUrl`, `moduleResolution: classic`, `paths`, or other removed options.
- **No new strict-flag failures** in our source. `strict` defaulting to `true` in TS 6 is a no-op
  here because `tsconfig.base.json` already sets `"strict": true`.

## Proposed Change

A single lockstep bump plus the minimal, mechanical fallout fixes above.

### 1. Bump all six manifests to `^6.0.3`

`apps/web`, `apps/vscode`, `packages/types`, `packages/core`, `packages/codev`,
`packages/artifact-canvas` — set `"typescript": "^6.0.3"`. Then `pnpm install` to refresh
`pnpm-lock.yaml`.

> **Decision B — pnpm `catalog:` (recommended).** The repo has no `catalog:` today. Since this
> issue exists *because* the version drifted, the durable fix is to centralize it: add a
> `catalog:` block to `pnpm-workspace.yaml` (`catalog: { typescript: ^6.0.3 }`) and set each of
> the six manifests to `"typescript": "catalog:"`. Future bumps become a one-line change and drift
> becomes structurally impossible. This is low-risk and I recommend it. If the architect prefers to
> keep it simple, we pin `^6.0.3` directly in all six (the verified diff used direct pins). **Either
> way the fallout fixes below are identical.**

### 2. `types: ["node"]` on the two packages that need it

- `packages/core/tsconfig.json` — add `"types": ["node"]` to `compilerOptions`.
- `packages/codev/tsconfig.json` — add `"types": ["node"]` to `compilerOptions`.

Both already depend on `@types/node`. (Not added to `packages/config/tsconfig.base.json`, because the
browser-context webview config and `packages/types` — which has no `@types/node` — would then error.)

### 3. Restore `vite/client` ambient types for apps/web

- New file `apps/web/src/vite-env.d.ts` containing `/// <reference types="vite/client" />`.

The triple-slash reference bypasses the `types: []` default and restores the `*.css` / `import.meta.env`
declarations. (`apps/web` genuinely had no `vite-env.d.ts` before — it had been coasting on the old
auto-`types` behavior.)

### 4. Migrate `packages/artifact-canvas` from tsup to tsdown *(architect-requested)*

tsup is effectively unmaintained (last publish 2025-11-12) and its DTS builder is what trips the TS 6
`baseUrl` error. Replace it with **tsdown** (`0.22.8`, the Rolldown-powered successor from the Vite/
VoidZero team). Verified to build clean with no `baseUrl` error and correct dual-format output.

- `packages/artifact-canvas/package.json`:
  - devDeps: remove `tsup`, add `tsdown` (`^0.22.8`).
  - `scripts.build`: `"tsup"` → `"tsdown"`.
  - **Output filenames change** (tsdown convention): update the manifest to point at tsdown's names:
    ```jsonc
    "exports": {
      ".": {
        "import":  { "types": "./dist/index.d.mts", "default": "./dist/index.mjs" },
        "require": { "types": "./dist/index.d.cts", "default": "./dist/index.cjs" }
      },
      "./default-theme.css": "./dist/default-theme.css"
    },
    "main":   "./dist/index.cjs",
    "module": "./dist/index.mjs",
    "types":  "./dist/index.d.cts",
    ```
    (tsup emitted `index.js` for ESM via an `outExtension` override; tsdown emits `index.mjs` +
    `index.d.mts` for ESM and `index.cjs` + `index.d.cts` for CJS. The `.cjs` require entry is
    unchanged; only the ESM/types names move.)
- Delete `packages/artifact-canvas/tsup.config.ts`; add `packages/artifact-canvas/tsdown.config.ts`:
  ```ts
  import { defineConfig } from 'tsdown';
  import { copyFileSync, mkdirSync } from 'node:fs';

  export default defineConfig({
    entry: ['src/index.ts'],
    format: ['cjs', 'esm'],
    dts: true,
    sourcemap: true,
    clean: true,
    onSuccess: () => {
      mkdirSync('dist', { recursive: true });
      copyFileSync('src/styles/default-theme.css', 'dist/default-theme.css');
    },
  });
  ```
  (No `external`/`treeshake` needed: tsdown tree-shakes by default and auto-externalizes
  `dependencies` + `peerDependencies`, so `react`/`react-dom` stay external — verified in the emitted
  bundles.)
- `packages/artifact-canvas/scripts/smoke.mjs`: the build-smoke asserts hardcoded old filenames
  (`dist/index.js`, `dist/index.d.ts`). Update to the tsdown set (`dist/index.mjs`, `dist/index.cjs`,
  `dist/index.d.cts`, `dist/index.d.mts`, `dist/default-theme.css`) and change the ESM
  `import('../dist/index.js')` to `import('../dist/index.mjs')`.

## Files to Change

- `apps/web/package.json` — `typescript` → `^6.0.3` (or `catalog:`)
- `apps/vscode/package.json` — `typescript` → `^6.0.3` (or `catalog:`)
- `packages/types/package.json` — `typescript` → `^6.0.3` (or `catalog:`)
- `packages/core/package.json` — `typescript` → `^6.0.3` (or `catalog:`)
- `packages/codev/package.json` — `typescript` → `^6.0.3` (or `catalog:`)
- `packages/artifact-canvas/package.json` — `typescript` → `^6.0.3` (or `catalog:`); tsup→tsdown; exports/main/module/types retargeted
- `packages/core/tsconfig.json` — add `"types": ["node"]`
- `packages/codev/tsconfig.json` — add `"types": ["node"]`
- `apps/web/src/vite-env.d.ts` — **new**, `/// <reference types="vite/client" />`
- `packages/artifact-canvas/tsdown.config.ts` — **new** (replaces `tsup.config.ts`)
- `packages/artifact-canvas/tsup.config.ts` — **deleted**
- `packages/artifact-canvas/scripts/smoke.mjs` — retarget artifact filenames
- `pnpm-workspace.yaml` — **only if decision B = catalog**: add `catalog:` block
- `pnpm-lock.yaml` — refreshed by `pnpm install`

## Risks & Alternatives Considered

- **Risk: TS 7 lands as `latest` and 6.0.3 feels behind.** Mitigation: 6.0.3 is the sanctioned
  migration bridge (it exists specifically to add TS 7 deprecation warnings while staying 5.9-API
  compatible). Unifying on 6.0.3 first is the correct sequencing regardless of a future TS 7 move.
  *Decision A is the architect's.*
- **Alternative to the tsdown swap: keep tsup + `"ignoreDeprecations": "6.0"`** on artifact-canvas's
  tsconfig. Rejected because (a) the architect explicitly asked to drop the unmaintained tsup, and
  (b) `ignoreDeprecations` is a temporary silence that stops working in TS 7 — a bandaid, not a fix.
- **Risk: tsdown is pre-1.0 (`0.22.8`).** Mitigation: it's the actively-maintained, widely-adopted
  Rolldown-based successor; the full build + smoke + downstream consumers (apps/web, vscode webview)
  were all verified green. If the architect wants to avoid a pre-1.0 build tool, fall back to the
  tsup + `ignoreDeprecations` alternative above.
- **Risk: consumers hardcode `@cluesmith/codev-artifact-canvas/dist/index.js`.** Checked — all
  consumers import the package root (resolved via `exports`), so the ESM filename move is transparent.
- **Risk: catalog change touches all six manifests.** Low — it's a mechanical `"catalog:"` swap;
  the only new moving part is the `pnpm-workspace.yaml` block. Deferrable (decision B).

## Test Plan

The exact sequence I ran under TS 6.0.3 (all passed; this is what the reviewer re-runs at the
`dev-approval` gate):

1. `pnpm install` — lockfile refreshes to TS 6.0.3 cleanly.
2. `pnpm --recursive check-types` — **all packages clean** (types, artifact-canvas, core, apps/vscode
   host+webview). *Run after a build so downstream `.d.ts` exist — see caveat above.*
3. `pnpm --recursive build` — **every package builds clean**, including `apps/web` (vite),
   `packages/codev` (tsc + dashboard bundle), and `packages/artifact-canvas` (tsdown dual-format).
4. `pnpm --filter codev-vscode run vscode:prepublish` — **passes** (topological workspace-dep build +
   `check-types` + `lint` + production esbuild).
5. Tests (note `packages/codev`'s `test` script is watch-mode `vitest`; run each suite in `run` mode):
   - `packages/core` → 41 passed
   - `packages/artifact-canvas` → 73 passed  + `pnpm build:smoke` → OK (CJS+ESM load, exports present)
   - `apps/web` → 323 passed, 1 skipped
   - `packages/codev` → 3482 passed, 48 skipped
6. Manual (dev-approval gate): the issue suggests exercising a running Codev instance built on the
   upgraded compiler — `afx workspace start`, spawn a builder, exercise consult, and confirm the
   VS Code extension packages. `afx dev` in this worktree serves that flow.

---

### Two things to confirm at the plan gate

- **A. Target version:** proceed with **TypeScript 6.0.3** (recommended, matches issue scope) — or
  redirect to **7.0.2** (out of issue scope; separate major).
- **B. Version-reference strategy:** add a pnpm **`catalog:`** entry (recommended — kills future
  drift) — or pin `^6.0.3` directly in all six manifests.
