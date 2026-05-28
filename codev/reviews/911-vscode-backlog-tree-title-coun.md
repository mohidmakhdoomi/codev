# PIR Review: vscode Backlog title-count reflects the active view mode

Fixes #911

## Summary

The Backlog tree title used to read `Backlog (47)` (the unfiltered spawnable total) even when the view was in mine-only mode showing just 3 rows — the most prominent integer on the view disagreed with what was rendered below. This PR rewrites the title to `Backlog (3 of 47)` in mine-only mode and `Backlog (47)` in show-all mode (option 2 from the issue), and wires the title-update into the `codev.backlogShowAll` config-change listener so it refreshes in lockstep with the tree rather than waiting for the next overview tick.

## Files Changed

- `packages/vscode/src/views/backlog-filter.ts` (+54 / -3) — new `visibleBacklogCount` and `formatBacklogTitle` helpers; `spawnableBacklog` moved in from `backlog.ts` so the vscode-free module owns all three primitives the title and the provider share.
- `packages/vscode/src/views/backlog.ts` (+5 / -10) — drops the local `spawnableBacklog`; imports + re-exports it from `backlog-filter.ts` so existing call sites keep working.
- `packages/vscode/src/extension.ts` (+22 / -4) — `updateListViewTitles` now calls `visibleBacklogCount` + `formatBacklogTitle` for the backlog row; `readBacklogShowAll` hoisted above the title helper; showAll-config-change listener also calls `updateListViewTitles()`.
- `packages/vscode/src/__tests__/backlog-filter.test.ts` (+131 / -1) — coverage for `spawnableBacklog`, `visibleBacklogCount`, `formatBacklogTitle`. Existing `filterMine` coverage preserved.
- `codev/plans/911-vscode-backlog-tree-title-coun.md` (new, +94) — approved plan.
- `codev/state/pir-911_thread.md` (new, +25) — builder thread.

## Commits

- `b6e98cf4` [PIR #911] Plan draft
- `8ee5e308` [PIR #911] Thread: plan phase complete
- `c614bf76` [PIR #911] Backlog title-count reflects active view mode
- `9512bbd8` [PIR #911] Thread: implement phase complete

(porch-managed phase-transition / gate commits omitted.)

## Test Results

- `pnpm check-types`: ✓ pass
- `pnpm lint`: ✓ pass (eslint, zero warnings)
- `pnpm test:unit`: ✓ pass — 113 tests across 10 files, ~20 new for the title-count path
- `pnpm package` (esbuild bundle, production): ✓ pass
- Manual verification at the `dev-approval` gate: ✓ approved by the human

## Architecture Updates

No arch changes needed. This PR works inside the existing Backlog-view module boundary (`backlog.ts` provider + `backlog-filter.ts` pure helpers) — the only structural shift is moving `spawnableBacklog` from `backlog.ts` (vscode-dependent) into `backlog-filter.ts` (vscode-free) so the title helper can reuse it from the vitest harness. That mirrors the precedent `filterMine` established in #809; not a new pattern.

## Lessons Learned Updates

No new durable lessons. The "keep vscode-free helpers in `backlog-filter.ts` so vitest can test them without vscode mocks" pattern is already documented implicitly by `filterMine`'s existence — this PR just continues that pattern. A re-statement in `lessons-learned.md` would be churn, not signal.

One contextual observation worth recording in the PR body (not the lessons file): two coupled bugs were closed at once — the count itself, and the refresh trigger. The count being wrong would have been obvious; the refresh trigger being wrong would have been masked by the periodic overview poll (the title would have updated within 60s of any showAll toggle, so it looked "almost right" most of the time). Worth knowing for future title/badge-counter work: any view title that depends on user-toggleable state needs to be refreshed on the toggle's listener, not just on the data-change listener.

## Things to Look At During PR Review

- **`visibleBacklogCount`'s `currentUser` fallthrough** (`backlog-filter.ts`). When mine-only is active but `currentUser` is null (gh unavailable), `filterMine` is a no-op, so `visible == total`. The title helper short-circuits this to plain `Backlog (T)` rather than `Backlog (T of T)` — matches the safety branch in `BacklogProvider.orderedSpawnable` and the third acceptance criterion in the issue.
- **Hoisting `readBacklogShowAll`** in `extension.ts`. The reader was previously declared inside the backlog-toggle listener block (around line 358 pre-change). The hoist moves it above `updateListViewTitles` so the title helper can call it on every refresh. The original site (now the listener) uses the hoisted reader.
- **Title format choice**. Option 2 (`Backlog (V of T)`) was the issue's mild preference. Options 1 and 3 are also acceptable and the helper could be swapped to either with a one-line change in `formatBacklogTitle`. Worth one re-read by the architect at PR review to confirm.
- **`src/test/backlog.test.ts` left in place**. The vscode-test (Electron) harness still has the old `spawnableBacklog` test file; it imports from `backlog.ts` which re-exports the moved helper, so it still passes. Deleting it would be cleanup but goes beyond the issue's "purely a count/title-string fix" scope.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder pir-911 → **Review Diff** (auto-detects the default branch)
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-911`
- **What to verify** (mapped from the plan's Test Plan):
  - Open the Backlog view in mine-only mode (default): title reads `Backlog (V of T)` where V matches the row count and T matches the unfiltered spawnable total. With nothing assigned to you, expect `Backlog (0 of T)` plus the empty-state placeholder from #809.
  - Toggle the eye icon to show-all: title immediately becomes `Backlog (T)`, row count matches.
  - Toggle back to mine-only: title immediately reverts to `Backlog (V of T)`. No stale count waiting for the next overview tick.
  - Other tree titles (`Builders`, `Pull Requests`, `Recently Closed`) still render with their existing `(N)` format — no regression.
