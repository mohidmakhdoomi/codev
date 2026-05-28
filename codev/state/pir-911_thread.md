# PIR #911 — vscode backlog title-count

Issue: vscode Backlog tree title-count should reflect the active view mode, not the total spawnable set. Surfaced as a CMAP-2 nit on #910 / PIR #809.

## Plan phase

Wrote `codev/plans/911-vscode-backlog-tree-title-coun.md`. Picked option 2 (`Backlog (3 of 47)` mine-only / `Backlog (47)` show-all) per the architect's mild preference. Two pure helpers go into `backlog-filter.ts`:
- `visibleBacklogCount(data, showAll)` — mirrors `BacklogProvider.orderedSpawnable`'s filter chain (`spawnableBacklog` → conditionally `filterMine`) but only counts.
- `formatBacklogTitle(visible, total)` — returns `Backlog` / `Backlog (N)` / `Backlog (V of T)`.

Two coupled bugs being closed at once: (1) the count itself was unfiltered; (2) `updateListViewTitles` is wired only to the overview-data listener, so even a correct count would stay stale until the next overview tick when the user flipped showAll. Plan addresses both — the showAll-config-change listener at `extension.ts:361-367` will also call `updateListViewTitles()`.

Plan-approval gate granted.

## Implement phase

- Moved `spawnableBacklog` into `backlog-filter.ts` so the count helper and `BacklogProvider` share the same primitive without dragging `vscode` into the vitest harness. `backlog.ts` re-exports it (and uses it internally) so existing import paths in `extension.ts` and `src/test/backlog.test.ts` keep working.
- Added `visibleBacklogCount(data, showAll)` and `formatBacklogTitle(visible, total)` to `backlog-filter.ts`.
- `extension.ts`:
  - Replaced the inline `spawnableBacklog(data.backlog).length` title computation with `visibleBacklogCount` + `formatBacklogTitle`.
  - Hoisted `readBacklogShowAll` above `updateListViewTitles` so it can be read on every refresh.
  - Wired `updateListViewTitles()` into the `codev.backlogShowAll` config-change listener so the title updates in lockstep with the tree (closes bug 2 from the plan).
- Tests: extended `__tests__/backlog-filter.test.ts` with new coverage for `spawnableBacklog`, `visibleBacklogCount`, and `formatBacklogTitle`. Vitest reports 113 passed (10 files), check-types and lint clean, esbuild bundle clean.

Dev-approval gate granted.

## Review phase

PR #914 opened with `codev/reviews/911-vscode-backlog-tree-title-coun.md` as the body. 3-way consultation single pass:
- Gemini: APPROVE (HIGH)
- Codex: APPROVE (HIGH)
- Claude: APPROVE (HIGH)

All three flagged zero issues. The `spawnableBacklog` move from `backlog.ts` into `backlog-filter.ts` was noted by Claude as a necessary deviation from the plan's "no changes to backlog.ts" line — the helper had to migrate to keep the vscode-free guarantee of `backlog-filter.ts`, and `backlog.ts`'s re-export preserves the existing import paths. Awaiting human pr-gate approval.
