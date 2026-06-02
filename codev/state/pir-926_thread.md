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

## Plan-gate discussion (resolved)

Long design back-and-forth at the plan gate. Net outcome: **ship both views'
rollups — the issue's original both-views design.**

- Briefly descoped the Builders rollup as "redundant/noisy," then reversed:
  those objections apply equally to the Backlog rollup we're keeping, so an
  asymmetry (Backlog headers with dots, Builders without) would just look
  unfinished. Consistency wins → both headers always carry a dot from the
  shared icon vocabulary, computed per-view.
- Confirmed the data model: issues with a builder are matched by `issueId`
  (`overview.ts` `activeBuilderIssues`) and filtered out of the backlog by
  `spawnableBacklog` (`!hasBuilder`). So the Backlog rollup must read
  `data.builders` keyed by `.area`, not the visible issues (which are
  builder-less by construction).
- Filed **#948** (area/vscode): keep in-progress issues in the Backlog with the
  builder's state icon instead of filtering them out — dissolves #926's known
  limitation, but changes Backlog semantics + breaks dashboard parity, so it's
  a deliberate follow-up, not folded into #926.
- Backlog rollup stays binary (green/grey); Builders rollup is worst-of-three
  (bell/comment-discussion/circle-filled). Tooltip carries counts in both.

Plan rewritten to cover both views again.

## Rebase on main + accuracy pass

Rebased onto origin/main (4 commits replayed clean; #920 + #791 had landed).
Re-verified every plan reference against the rebased code and fixed drift:

- **Blocked-row icon is no longer a hardcoded `bell`.** `builders.ts:203` now
  calls `gateIconFor(b.blockedGate)` (`builder-row.ts:35`) → gate-specific shape
  (book/checklist/code/git-pull-request/verified, bell fallback), color held
  uniform yellow. Plan's Builders rollup updated: header uses the **generic
  `bell`** for any-blocked (a group can hold builders at different gates;
  surfacing one gate's shape would misread). Dropped the "header pixel-matches
  the topmost row" claim — only severity/color matches for blocked.
- **Pure helpers relocated to the vscode-free modules** matching the
  established pattern: `activeBuilderCountByArea` → `backlog-filter.ts`,
  `rollupGroupState` → `builder-row.ts`. Tested under vitest `__tests__/`
  (`backlog-filter.test.ts`, `builder-row.test.ts`), not the Electron
  `src/test/` suite.
- **Fixed test/build commands**: unit = `pnpm test:unit` (vitest); type-check =
  `pnpm check-types`. The bogus `pnpm --filter @cluesmith/codev-vscode build`
  (no such script; pkg is `codev-vscode`, not part of root `pnpm build`) removed.
- Refreshed shifted line refs (api.ts area fields → 197/237; builders icon →
  202-206; rootChildren blocks → backlog 96-103 / builders 140-152).

## Implement phase (plan-approval approved)

Implemented both rollups per the plan:
- `backlog-filter.ts` → `activeBuilderCountByArea(builders)` (pure, keyed on raw
  `.area`).
- `builder-row.ts` → `rollupGroupState(builders, now)` (pure, reuses
  `isIdleWaiting`; blocked > idle > active).
- `BacklogGroupTreeItem` → binary green/grey icon + count tooltip.
- `BuilderGroupTreeItem` → worst-of-three icon (generic `bell` for blocked, not
  gate-specific) + "b · i · a" tooltip.
- Wired both into `backlog.ts` / `builders.ts` `rootChildren()`.
- Tests: +5 `rollupGroupState`, +5 `activeBuilderCountByArea` (vitest __tests__).

Verified (worktree needed `pnpm install` + core/types build first):
`pnpm check-types` ✓, `pnpm lint` ✓, `pnpm test:unit` ✓ (207 tests, 10 new),
`node esbuild.js` ✓. Awaiting go-ahead to commit + push, then dev-approval gate.
