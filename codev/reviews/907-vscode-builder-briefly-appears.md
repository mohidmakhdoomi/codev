# PIR Review: Stop builders flashing into UNCATEGORIZED during cleanup

Fixes #907

## Summary

When a builder was cleaned up, the VSCode Builders tree briefly re-rendered it under the `UNCATEGORIZED` group for a few seconds before it disappeared. Root cause: `OverviewBuilder.area` is re-derived every refresh from the **open-only** `gh issue list`; once the builder's issue is unreachable (closed on PR merge, torn down mid-cleanup, or a failed fetch) the lookup misses and the record fell back to its `Uncategorized` default — visible during the lag between the cleanup terminal-kill and the active-session filter dropping the builder (which #818's area grouping turned into a placement jump). The fix caches the last *resolved* area in a new `ResolvedEnrichmentCache` (gated on issue reachability, not value emptiness) so the builder stays in its real group until it disappears. A separate build-tooling fix (root `pnpm build` now builds `@cluesmith/codev-types` first) was bundled in at the architect's request after the unbuilt `types` package crashed the extension at the dev-approval gate.

## Files Changed

- `packages/codev/src/agent-farm/servers/resolved-enrichment-cache.ts` (+74 / -0) — new generalized cache
- `packages/codev/src/agent-farm/servers/overview.ts` (+38 / -7) — resolve `area` through the cache
- `packages/codev/src/agent-farm/__tests__/resolved-enrichment-cache.test.ts` (+60 / -0) — unit tests for the cache contract
- `packages/codev/src/agent-farm/__tests__/overview.test.ts` (+100 / -0) — integration regression tests via `getOverview`
- `package.json` (+1 / -1) — root build now builds `types` first
- `codev/resources/arch.md` (+1 / -1) — corrected build-order doc
- `codev/resources/lessons-learned.md` (+2 / -0) — two durable lessons
- `codev/plans/907-vscode-builder-briefly-appears.md` (+104 / -0) — plan artifact
- `codev/state/pir-907_thread.md` — cohort thread

## Commits

- `71c49cf6` [PIR #907] Memoize last-known builder area to stop UNCATEGORIZED flash on cleanup
- `617a6a60` [PIR #907] Generalize resolved-area fallback into ResolvedEnrichmentCache
- `487090cd` [PIR #907] Extract ResolvedEnrichmentCache into its own module + test file
- `b70f1685` [PIR #907] Build @cluesmith/codev-types in root build so the extension bundles
- (plus `[PIR #907] Thread:` / plan commits)

## Test Results

- `pnpm --filter @cluesmith/codev build`: ✓ pass
- Full root `pnpm build` (types → core → codev + dashboard): ✓ pass
- `pnpm --filter codev-vscode compile`: ✓ pass (after `types` build)
- `pnpm test` (codev): ✓ **3239 passed / 13 skipped** (155 files) — 10 new tests (6 unit for the cache contract, 4 integration via `getOverview`); 13 skips are pre-existing and unrelated
- Manual verification: reproduced deterministically at the test level first (the regression tests fail on the unfixed code, printing `area = 'Uncategorized'` exactly when the issue leaves the open list or the fetch fails). Visual confirmation in a running VSCode session was the reviewer's check at the `dev-approval` gate.

## Architecture Updates

Updated `codev/resources/arch.md`: the "Build order" line said `core → codev`; it now reads `types → core → codev` and explains *why* `types` must be first — esbuild (the VS Code extension bundler) resolves the package's runtime `exports.default` (`./dist/index.js`), whereas tsc/vite resolve it from source via `exports.types`. This is the exact gap that crashed the extension. No module-boundary changes; `ResolvedEnrichmentCache` is an internal projection helper, not a new architectural layer.

## Lessons Learned Updates

Added two entries to `codev/resources/lessons-learned.md` (Architecture):
1. A package consumed as *source* by one toolchain and as *built output* by another resolves through different `exports` conditions — a green tsc/test run does not prove every bundler resolves it; a `default → ./dist` package must be built before any esbuild consumer.
2. Derived projection fields (`area`) need a fallback gated on **source reachability, not value emptiness**, so a transient source outage doesn't snap them to a default — and why the cache belongs on the process-lifetime singleton, not the per-refresh DTO.

## Things to Look At During PR Review

- **The `resolve` contract** in `resolved-enrichment-cache.ts` — the load-bearing decision is gating on `sourceAvailable` (was the issue reachable this refresh) rather than on whether the value is empty. That distinction is what lets a reachable-but-unlabeled issue cache a genuine `Uncategorized` (test: "caches a genuine sentinel value") while preventing a stale entry from masking a real label change (test: "does not mask a changed value while the source stays available"). If a future field adopts the cache, it must preserve that gating.
- **The enrichment loop in `overview.ts`** now always runs (even when `issues === null`) so the fallback applies on a failed fetch; `issueTitle` deliberately does **not** use the cache (it has a local slug fallback).
- **`package.json` build change** is outside the area-grouping bug — bundled at architect request; the rationale is in Architecture Updates. Worth a sanity check that you're comfortable with it living in this PR.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-907` → **View Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-907`
- **What to verify**:
  - Spawn a builder against an `area/vscode` issue → it appears under `VSCODE`.
  - `afx cleanup -p <id>` (and via the right-click *Cleanup Builder* action) → it must **not** jump to `UNCATEGORIZED`; it stays under `VSCODE` until it disappears.
  - No-regression: a builder on an issue with no `area/*` label stays under `UNCATEGORIZED` throughout its lifecycle.
