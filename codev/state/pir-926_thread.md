# PIR #926 — VSCode area-header roll-up icons

## Plan phase (start)

Issue #926 (area/vscode): add roll-up status icons to area group headers in the
Backlog and Builders sidebar views.

Investigation findings:
- `area-group-tree-item.ts` — shared base `AreaGroupTreeItem`; sets `id` +
  `contextValue`, no `iconPath` today. Issue says: do NOT put rollup here.
- `backlog-tree-item.ts` — `BacklogGroupTreeItem(areaName, count, state)`.
- `builder-tree-item.ts` — `BuilderGroupTreeItem(areaName, count, state)`.
- `backlog.ts` — `BacklogProvider.rootChildren()` builds group headers at L96-102.
  Has `data.builders` (each with `.area`) on the same overview cache.
- `builders.ts` — `BuildersProvider.rootChildren()` builds group headers L141-151.
  Already computes blocked/idle/active per builder in `makeBuilderRow` via
  `isIdleWaiting` (core helper) — within-group sort is blocked→idle→active.
- Builder-row icon vocabulary lives at `builders.ts:206-210`:
  bell/`notificationsWarningIcon.foreground`,
  comment-discussion/`notificationsInfoIcon.foreground`,
  circle-filled/`testing.iconPassed`.
- Types: `OverviewBuilder.area` and `OverviewBacklogItem.area` both
  required-with-default (`api.ts:182`, `:222`).
- Tests: `src/test/*.test.ts` run under vscode-test (mocha suite/test). Pure
  exported helpers (`orderForDisplay`, `spawnableBacklog`) are tested directly —
  I'll mirror that for the rollup helpers.

Plan written to `codev/plans/926-vscode-area-header-roll-up-ico.md`. Awaiting
plan-approval gate.
