# PIR Review: VSCode Quick Pick command for searching the backlog

Fixes #918

## Summary

Adds a `codev.searchBacklog` command (palette title `Codev: Search Backlog...`)
that opens a VSCode Quick Pick over the current open backlog with built-in fuzzy
match on issue id, title, area, and assignee. Selecting a row opens the issue via
the same `codev.viewBacklogIssue` flow a single sidebar-row click uses. This gives
the Backlog tree the find-by-recall / find-by-topic affordance it lacked — without
a webview (#906's path) or the impossible in-tree `<input>` (closed in pir-891).

## Files Changed

- `packages/vscode/src/views/backlog-search.ts` (+82 / -0) — new, vscode-free: `orderForSearch` + `toQuickPickItems`
- `packages/vscode/src/commands/search-backlog.ts` (+36 / -0) — new: command handler
- `packages/vscode/src/__tests__/backlog-search.test.ts` (+97 / -0) — new: 7 unit tests
- `packages/vscode/src/extension.ts` (+2 / -0) — register `codev.searchBacklog`
- `packages/vscode/package.json` (+5 / -0) — command contribution

## Commits

- `65bb678d` [PIR #918] Add Codev: Search Backlog... Quick Pick command
- `fa8ee2c7` [PIR #918] Update builder thread (implement phase)

## Test Results

- `pnpm check-types`: ✓ pass
- `pnpm lint`: ✓ pass (clean)
- `pnpm test:unit` (vitest): ✓ pass (120 tests, 7 new in `backlog-search.test.ts`)
- Porch checks: `build` ✓ (5.9s), `tests` ✓ (20.6s)
- Manual verification: approved by the human at the `dev-approval` gate via the
  Extension Development Host — command appears in the palette, picker lists open
  backlog issues, fuzzy filtering and selection-opens-issue verified.

## Architecture Updates

No arch changes — this PR adds a self-contained command that reuses the existing
`OverviewCache` data source and the existing `codev.viewBacklogIssue` action. It
introduces no new module boundary or pattern; the pure-helper-in-a-vscode-free-file
split it follows is the already-documented `backlog-filter.ts` convention.

## Lessons Learned Updates

No lessons captured — the change applied established conventions (vscode-free pure
helpers unit-tested from `__tests__/`, command registration in `extension.ts`,
palette visibility via the absence of a `commandPalette` `when:false` suppressor)
with no surprises worth recording for future work.

## Things to Look At During PR Review

- **`detail` deliberately omitted.** The issue floated an optional `detail` =
  issue-body first sentence. `OverviewBacklogItem` carries no body field, and
  fetching one would add the data path the issue explicitly forbids ("snapshot
  from `overviewCache` … no new data path"). So `detail` is not set. `matchOnDetail:
  true` is still passed — harmless today, and correct if a `detail` is added later.
- **`orderForSearch` is intentionally NOT `BacklogProvider.orderedSpawnable`.**
  The tree's helper applies the mine-only filter; search must run over the *full*
  backlog (issue decision 1). `orderForSearch` reuses `spawnableBacklog` and the
  mine-first segment split but skips the mine-only filter. `BacklogProvider` is
  left untouched (it could later delegate its split to the shared helper — out of
  scope here).
- **`now` injection** in `toQuickPickItems` is purely for deterministic relative-age
  tests; the command passes `Date.now()`.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-918` → **View Diff**
- **Run it**: this is a VSCode *extension* surface — launch the Extension
  Development Host (F5 in `packages/vscode`), not `afx dev` (which runs
  Tower/dashboard, a different surface).
- **What to verify** (maps to the plan's Test Plan):
  - `Codev: Search Backlog...` appears in the Command Palette.
  - Invoking it opens a Quick Pick listing every open spawnable backlog issue.
  - Typing an id / title fragment / area / assignee fuzzy-filters the list.
  - Selecting a row opens the same markdown preview a single sidebar click does.
  - Esc / click-away dismisses with no side effect.
  - Works with the Backlog sidebar view collapsed or hidden.
