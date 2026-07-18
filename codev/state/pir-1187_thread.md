# PIR #1187 — Upgrade TypeScript to 6.0.3 (unify 5.7/5.9 drift)

## Plan phase

- Repo layout differs from issue: `dashboard`→`apps/web`, `vscode`→`apps/vscode`. 6 packages carry a `typescript` devDep (apps/web ^5.7.0, apps/vscode ^5.9.3, packages/{types,core,artifact-canvas} ^5.7.0, packages/codev ^5.7.2).
- **Version decision surfaced**: npm `latest` is now **7.0.2**; 6.0.3 is the latest 6.x stable. Issue scopes to 6.x → recommending 6.0.3, flagging TS 7 as out-of-scope for architect.
- **Did full empirical verification at plan time** (issue asked for it). Bumped all 6 → ^6.0.3, `pnpm install`, ran check-types/build/test/vscode:prepublish, captured real diagnostics, then reverted to clean. Verified diff saved to scratchpad.

### Verified fallout + fixes (all confirmed green end-to-end)
1. TS 6 defaults `types: []` (was: auto-include all `@types/*`). Breaks `@types/node` resolution (even `node:fs` imports → TS2591) in `core` (9 errs) + `codev` (22 errs). Fix: add `"types": ["node"]` to those two tsconfigs (both already depend on @types/node). `packages/types` needs nothing (0 errs, no node usage).
2. `types: []` also drops `vite/client` → CSS side-effect imports fail (TS2882) in apps/web. Fix: new `apps/web/src/vite-env.d.ts` with `/// <reference types="vite/client" />`.
3. apps/vscode's 98 "errors" were all **false cascades** from core being unbuilt (no dist/.d.ts). After core builds: host 0, webview 0. No vscode source changes needed.
4. `baseUrl` deprecation is now a hard error (TS5101) — surfaced via artifact-canvas's **tsup** DTS build (rollup-plugin-dts injects baseUrl). → resolved by the tsup→tsdown swap below (cleaner than `ignoreDeprecations: "6.0"` bandaid).

### User request (mid-plan): swap tsup → tsdown (tsup unmaintained)
- Verified: tsdown 0.22.8 (rolldown-powered) builds artifact-canvas clean, no baseUrl error.
- tsdown output naming differs from tsup: `index.mjs`/`index.d.mts` (ESM) + `index.cjs`/`index.d.cts` (CJS). Required updating artifact-canvas `exports`/`main`/`module`/`types` to match, and `scripts/smoke.mjs` (hardcoded old `dist/index.js`/`index.d.ts`).
- react/react-dom auto-externalized (peerDeps) — dropped the deprecated `external` option.
- Downstream consumers (apps/web, vscode webview) resolve the new exports fine.

### No-ops (verified)
- No `engines.node` bump: TS 6.0.3 declares `>=14.17`, repo already `>=20.0.0`.
- No `@types/node` bump: 22.x works.
- No tsconfig deprecated-option removal: all tsconfigs already modern (NodeNext/ES2022/strict, no baseUrl/classic/paths).

### Open decisions for architect at plan gate
- **A. Target version**: 6.0.3 (recommended, per issue scope) vs 7.0.2 (new major, native compiler — out of issue scope).
- **B. pnpm `catalog:` entry** (issue asked): recommend adding one to kill future drift; described in plan.

Plan written to `codev/plans/1187-chore-upgrade-typescript-to-6-.md`. Awaiting plan-approval gate.

## Implement phase

- plan-approval **approved**. Architect confirmed both gate decisions: **A = TS 6.0.3**, **B = add pnpm `catalog:`**.
- Applied the full verified fix set, this time with the catalog (the one path not covered by the plan-time experiment):
  - `pnpm-workspace.yaml` — new `catalog: { typescript: ^6.0.3 }`; all six manifests set to `"typescript": "catalog:"`. Lockfile resolves `catalogs.default.typescript ^6.0.3 → 6.0.3`, zero tsup refs remain.
  - `packages/core/tsconfig.json` + `packages/codev/tsconfig.json` — `"types": ["node"]`.
  - `apps/web/src/vite-env.d.ts` — new, `/// <reference types="vite/client" />`.
  - artifact-canvas tsup→tsdown: manifest (deps/build script/exports/main/module/types → tsdown `.mjs`/`.cjs`/`.d.mts`/`.d.cts` naming), new `tsdown.config.ts`, deleted `tsup.config.ts`, `scripts/smoke.mjs` retargeted.
- Three logical commits: (1) catalog unification, (2) TS6 tsconfig fallout, (3) tsdown migration.
- **Full re-verification green under catalog+tsdown**: `pnpm --recursive build` ✓, `pnpm --recursive check-types` ✓, `vscode:prepublish` ✓, artifact-canvas `build:smoke` ✓, tests: core 41 / artifact-canvas 73 / apps/web 323(+1 skip) / codev 3482(+48 skip).
- Awaiting **dev-approval** gate.

### Follow-up at gate (architect request): eliminate ALL TS 5 artifacts
- Architect wants zero legacy TS 5 anywhere (TS 7 move coming). Swept whole repo: the **only** remaining TS 5 pin was the vestigial e2e fixture `packages/codev/src/commands/porch/__tests__/e2e/fixtures/todo-app/package.json` (`typescript: ^5.0.0`).
- Fixture is dead: no src files, not referenced by any test (e2e `setup.ts` builds its own inline package.json), never installed/compiled, not a pnpm workspace member (so can't use `catalog:`).
- Bumped it directly: `typescript ^5.0.0 → ^6.0.3`, and aligned `@types/node ^20 → ^22`, `vitest ^1 → ^4` to match the real workspace (makes the "external todo app" fixture realistic for a TS 6 world). codev-skeleton has no TS pins.
- Zero lockfile impact (not a workspace member); codev suite still 3482 pass / 48 skip. Commit `cdd949ee`.
- Repo-wide grep now: **no `typescript` 5.x pins remain anywhere** (excl. node_modules/lockfile/dist).

## Review phase

- Wrote `codev/reviews/1187-*.md` (Summary/Files/Commits/Tests/Arch/Lessons/Things-to-look-at/How-to-test). Routed governance updates to COLD tier: arch.md (Technology Stack: catalog + TS6 `types:[]`; Monorepo: tsdown per-format build) and lessons-learned.md (Debugging: false-cascade + the CI config-loader trap). HOT tiers are at cap → COLD is correct.
- Opened **PR #1193**, recorded with porch. Ran the 2-way consult (claude + codex; gemini CLI unavailable): **both APPROVE, HIGH confidence, no blocking issues**.

### CI failure + fix (the real saga)
- Architect asked me to check failed GH Actions. **Unit Tests** job red: artifact-canvas build → `Error: Failed to import module "unrun"`.
- Root cause: tsdown 0.22.8's `auto` config-loader uses native `import()` only when Node has native TS support (Bun / Node ≥24.11), else falls back to `unrun` — an *optional* peer `unconfig-core` declares but pnpm never installs. Local Node 22 has native support (worked); CI's older Node + clean `--frozen-lockfile` hit the `unrun` branch. **Node-version-driven, not file-extension-driven.**
- **First fix attempt (WRONG)**: renamed `tsdown.config.ts` → `.mjs` assuming extension-based loader selection. Pushed → **CI failed again identically** (my assumption was unverified — the lesson I'd literally just written). Also caught a `git add` pathspec-abort that made a commit delete the config without adding the replacement (amended before push).
- **Second attempt (config-less CLI + copy script)**: worked but architect flagged it as hacky/sprawling. Reverted.
- **Final fix**: keep declarative `tsdown.config.mjs`; build script = `tsdown --config-loader native`. Forces native `import()` of the plain-ESM config on every Node version. **Verified rigorously**: reproduced CI's exact failure locally with `pnpm exec tsdown --config-loader unrun` (fails identically), confirmed `--config-loader native` builds clean under that same condition.
- **CI now fully green** (all 6 checks). Corrected the wrong `.mjs` explanation in both review + lessons docs.
- Note: consults reviewed the pre-CI-fix diff; the fix is a build-config-loader change only (no substantive impact on their APPROVE).
