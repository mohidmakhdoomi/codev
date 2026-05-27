# pir-811 thread

## 2026-05-27 — plan phase

Read issue #811 (group backlog by area). Investigated:
- `OverviewBacklogItem.area: string` already on the wire (added by #819).
- `parseArea` (singular) is policy-free — does NOT privilege `area/cross-cutting` (explicit decision + regression test in #819).
- `parseAreaLabels` (plural) does NOT exist. The "helper issue" referenced as Related in #811 was #819, which CLOSED with a different shape (singular projection on the server, no resolvePrimaryArea helper).

Design tension: AC #2 wants cross-cutting in its own top group, but the singular `area` field can't distinguish `[area/cross-cutting]` from `[area/auth, area/cross-cutting]` (the latter projects to `auth`).

Resolution chosen: lean on the issue body's own convention guidance — "Tag it `area/cross-cutting` only (don't list every individual area)". Under this convention, singular `area === 'cross-cutting'` is sufficient detection. Avoids re-litigating #819's wire-shape decision. Documented the alternative (`crossCutting: boolean` or `areas: string[]`) in the plan's Risks section as a follow-up if the convention proves brittle.

Plan written to `codev/plans/811-vscode-group-backlog-by-area.md`. Ready for plan-approval gate.

## 2026-05-27 — implement phase

Plan-approval gate approved. Implemented the area-grouping refactor:

- `views/backlog.ts`: added pure `groupBacklogByArea(items)` helper (cross-cutting first, alphabetical specifics, Uncategorized last; empty groups omitted; within-group order preserved). Refactored `BacklogProvider` to two-level (`getChildren()` returns groups when called with no element, rows when called with a `BacklogGroupTreeItem`). Constructor now takes `vscode.Memento` for expansion-state persistence.
- `views/backlog-tree-item.ts`: added `BacklogGroupTreeItem` class. Uses stable `id` (`backlog-group:<areaName>`) so VSCode preserves item identity across SSE-driven `onDidChangeTreeData` refreshes — which keeps the user's expand/collapse choice persistent visually as well as via the workspaceState write-back.
- `extension.ts`: passed `context.workspaceState` to `BacklogProvider`; wired `backlogView.onDidExpandElement` / `onDidCollapseElement` to call `setGroupExpanded()` so user choices persist.
- `test/backlog.test.ts`: 8 new tests for `groupBacklogByArea` covering empty input, lone cross-cutting, lone Uncategorized, full ordering, omitted empty groups, within-group order preservation, multi-item-per-area, and the defensive empty-string-area fallback.

Test results:
- `pnpm --filter codev-vscode test`: 91 pass (8 new groupBacklogByArea + all pre-existing).
- `pnpm build` (full workspace): green.
- `pnpm --filter @cluesmith/codev test`: first run showed 17 flakes in unrelated suites (cron-cli, etc.); re-run clean at 3173 pass. Not caused by this PIR — my changes are entirely in `packages/vscode/`.

Ready for dev-approval gate.
