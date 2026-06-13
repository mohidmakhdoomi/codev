# PIR Review: Builders accordion stops collapsing area-group headers; group expansion becomes ephemeral

Fixes #913

## Summary

The VSCode Builders tree's accordion (expand one builder → collapse the others) was implemented with `workbench.actions.treeView.codev.builders.collapseAll`, which is tree-wide — it collapsed the area/stage group headers too, and that collapse was then wrongly persisted to `workspaceState` and survived reloads. This replaces the accordion mechanism with per-row id versioning (`AccordionRowIds`) so only builder rows collapse, never group headers, and removes per-group expansion persistence for the Builders view entirely (groups default to expanded each session; in-session collapse is VSCode's native per-id behavior). Backlog's persistence — appropriate to its long-lived lifecycle — is untouched.

## Files Changed

- `packages/vscode/src/views/builders.ts` (+110 / -…) — `AccordionRowIds` class + `collapseBuildersExcept`; versioned `item.id`; groups always render Expanded; removed the expansion store, routing wrapper, and `workspaceState` ctor param.
- `packages/vscode/src/extension.ts` (+/-55) — synchronous accordion handler calling `collapseBuildersExcept`; removed `collapseAll`/`reveal(expand:3)`/`reconciling`; one-shot cleanup of both stale `workspaceState` keys; removed the builders `persistAreaGroupExpansion` wiring + `BuilderGroupTreeItem` import.
- `packages/vscode/src/views/builder-grouping.ts` (+/-23) — dropped the `expansion` field from the `BuilderGrouping` interface and both strategy factories.
- `packages/vscode/src/__tests__/builders-accordion.test.ts` (+216 / -0) — new: provider-level accordion behavior + direct `AccordionRowIds` unit tests.
- `packages/vscode/src/__tests__/builder-grouping.test.ts` (+/-16) — removed the expansion-store plumbing/assertions.

## Commits

- `344b01b8` [PIR #913] Accordion uses generation-salted row ids; groups never collapsed
- `2cb0215c` [PIR #913] Drop expansion-store test plumbing; add accordion id tests
- `858eeee8` [PIR #913] Update builder thread for implement phase
- `61ec9077` [PIR #913] Encapsulate accordion id versioning in AccordionRowIds; drop generationOf parser

## Test Results

- `pnpm compile` (check-types + lint + esbuild): ✓ pass
- `pnpm test:unit`: ✓ pass (392 tests; 12 new accordion/`AccordionRowIds` cases, plus the trimmed grouping suite)
- Porch `build` + `tests` checks: ✓ pass (full codev suite 3225 passed)
- Manual verification: approved by the human at the `dev-approval` gate against the running worktree.

## Architecture Updates

No `arch.md` changes — this is a behavioral fix within the existing Builders-view module. It changes neither module boundaries nor a documented architectural pattern (`arch.md` does not describe the accordion or expansion-persistence mechanics). The reusable insight is captured in `lessons-learned.md` instead.

## Lessons Learned Updates

Added two entries to `codev/resources/lessons-learned.md` (both `[From 913]`):
1. The VSCode `TreeView` "no per-item collapse API; version the id to force a collapse" technique, and why the open row must keep its verbatim id with a monotonic version.
2. Match UI-state persistence to the lifetime of what it describes — ephemeral nav state (short-lived builders) shouldn't be persisted; the same mechanism is still right for long-lived Backlog items.

## Things to Look At During PR Review

- **Accordion toggle guard (`AccordionGate`) — fixed from a consult finding.** The Codex review (REQUEST_CHANGES, HIGH) caught a real defect in the first cut: the expand handler's "is this builder already open" guard kept its `openBuilderId` across accordion enable/disable cycles. Repro: open A (accordion on) → toggle off → open B → toggle on → re-expand A — the guard saw A still recorded as open and skipped, so B never collapsed, violating the "toggle back on → next expand collapses others" acceptance criterion. Fix: extracted the guard into `AccordionGate` (`builders.ts`) whose `setEnabled` resets the open-builder state on every toggle, so the next expand of *any* builder (including the previously-open one) collapses the rest. Regression test added: `builders-accordion.test.ts` → "re-collapses after disable → open another → re-enable, even on the previously-open row". This was a single-pass consult finding (PIR does not re-review) — please confirm the fix and test at the `pr` gate.
- **`AccordionRowIds` correctness (`builders.ts`)**: the load-bearing invariant is that a re-opened builder never reuses an id VSCode remembers as expanded. The version is monotonic and the open row's id is stored verbatim (not reconstructed), which is what guarantees this. Covered by the "never reuses a version" test.
- **Synchronous `changeEmitter.fire()` inside `onDidExpandElement`**: `collapseBuildersExcept` fires the tree-data change synchronously from within the expand handler (during `openBuilderRow`'s `reveal`). Verified correct in logic and at the dev-approval gate; the `AccordionGate` re-fire guard prevents a loop on the same row.
- **One-shot key cleanup**: `extension.ts` deletes both `codev.buildersGroupExpansion` and `codev.buildersStageGroupExpansion` on every activation (idempotent — `update(key, undefined)` removes the key). The `#952` stage-axis key didn't exist when the issue was filed; both are cleared so no dead state lingers.
- **Backlog untouched**: confirm `backlogProvider.expansion` / its `persistAreaGroupExpansion` wiring is unchanged.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder pir-913 → **Review Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-913`
- **What to verify** (from the plan's Test Plan):
  - Expand a builder with builders spread across ≥2 groups → other builder rows collapse, **no group header collapses**, the opened builder's file tree stays expanded.
  - Manually collapse a group, then expand a builder in another group → the collapsed group stays collapsed.
  - Collapse a group, then Developer: Reload Window → **all** Builders groups render expanded.
  - Repeat after toggling the grouping axis (stage ↔ area, title-bar button).
  - Toggle the accordion off → expanding two builders leaves both open; toggle back on → next expand collapses the rest.
  - Backlog regression: collapse a Backlog group, reload → still collapsed.
