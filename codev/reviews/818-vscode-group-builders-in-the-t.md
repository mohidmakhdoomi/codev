# PIR Review: Group Builders Tree by Area (mirror #811, dedup primitives)

Fixes #818

## Summary

Builders tree in the VSCode sidebar now groups by `area/*` label (alphabetical specific areas, `Uncategorized` last), mirroring the backlog grouping that #886 shipped. To avoid duplicating ~67 LOC of structural code across the two views, the PR also extracts three shared primitives (`groupByArea<T>`, `AreaGroupTreeItem` base class, `AreaGroupExpansionStore` + `persistAreaGroupExpansion` helper) and migrates the already-shipped backlog view onto them in the same PR. Net effect: builders gains the new feature, backlog loses 50 LOC, and the "rule structurally identical to backlog's" acceptance criterion is enforced by `import`, not by reviewer attention.

## Files Changed

- `packages/core/package.json` (+4 / -0) — new `./area-grouping` export
- `packages/core/src/area-grouping.ts` (+44 / -0) — NEW: generic `groupByArea<T>`
- `packages/vscode/src/views/area-group-tree-item.ts` (+27 / -0) — NEW: shared `AreaGroupTreeItem` base
- `packages/vscode/src/views/area-group-expansion.ts` (+59 / -0) — NEW: `AreaGroupExpansionStore` + `persistAreaGroupExpansion`
- `packages/vscode/src/test/area-grouping.test.ts` (+82 / -0) — NEW: 7 tests for `groupByArea<T>`
- `packages/vscode/src/views/builders.ts` (+143 / -50) — two-level provider, `getParent`, single-Uncategorized flatten
- `packages/vscode/src/views/builder-tree-item.ts` (+13 / -0) — `BuilderGroupTreeItem` thin subclass
- `packages/vscode/src/views/backlog.ts` (+10 / -61) — migrated onto shared primitives
- `packages/vscode/src/views/backlog-tree-item.ts` (+10 / -0) — `BacklogGroupTreeItem` thin subclass
- `packages/vscode/src/test/backlog.test.ts` (+1 / -57) — dropped `groupBacklogByArea` suite (covered by generic)
- `packages/vscode/src/extension.ts` (+5 / -14) — `persistAreaGroupExpansion` ×2
- `codev/plans/818-vscode-group-builders-in-the-t.md` (+334 / -0) — plan artifact

## Commits

- `9e838a6c` [PIR #818] Rename wireAreaGroupExpansion → persistAreaGroupExpansion
- `a6561d29` [PIR #818] Thread: log implement phase completion
- `4419a7d7` [PIR #818] Apply area grouping to Builders tree
- `8bd1537c` [PIR #818] Migrate backlog view onto shared area-grouping primitives
- `d5186d46` [PIR #818] Extract shared area-grouping primitives (groupByArea, AreaGroupTreeItem, AreaGroupExpansionStore)
- `227ea3f3` [PIR #818] Plan revised — extract groupByArea + AreaGroupTreeItem + AreaGroupExpansionStore, migrate backlog onto them
- `6519ea35` [PIR #818] Plan revised — mirror #886's shipped shape (no toggle, alphabetical-only, single-Uncategorized flatten)
- `b6021767` [PIR #818] Plan draft

## Test Results

- `pnpm --filter codev-vscode check-types`: ✓ pass
- `pnpm --filter codev-vscode lint`: ✓ pass
- `pnpm --filter codev-vscode compile` (esbuild bundle): ✓ pass
- `pnpm --filter codev-vscode test`: ✓ pass (90 tests, 7 new `suite('groupByArea')`, 4 dropped `suite('groupBacklogByArea')` — coverage shifted to the generic)
- Manual verification at the dev-approval gate: human approved after side-by-side comparison with the backlog grouping; rename `wireAreaGroupExpansion → persistAreaGroupExpansion` applied as part of the same review pass

## Architecture Updates

No changes to `codev/resources/arch.md`. The change is confined to the VSCode extension's view layer — no impact on Tower internals, builder lifecycle, worktree management, shellper protocol, or any other surface arch.md documents.

## Lessons Learned Updates

Added one entry to `codev/resources/lessons-learned.md` under **Architecture**:

> [From 818] An acceptance criterion of "rule structurally identical to X" is a written-rule trap when the rule lives as duplicated prose in two views. Two copies drift even with diligence; the only durable enforcement is one shared function both views import. Extract when the second consumer lands — not before (no abstraction without users) and not later (drift starts on day one).

The original plan (v2) committed knowingly-duplicated code with the "byte-identical to #886" criterion enforced only by prose. The human caught it before approval; v3 added the extraction. The extraction itself was cheap (~3 small files, mechanical backlog migration); the lesson is recognizing the trap at plan time so the extraction lands together with the second consumer, not as a follow-up that competes with other priorities.

## Things to Look At During PR Review

- **Mechanical backlog migration**: `packages/vscode/src/views/backlog.ts` loses ~50 LOC. The diff is intentionally a no-op — `groupBacklogByArea` is replaced with `groupByArea(items, i => i.area)`; `setGroupExpanded` / `readExpansionState` / `EXPANSION_STATE_KEY` are replaced with an `AreaGroupExpansionStore` field. Walk the backlog view in VSCode first and confirm zero visible change — that's the highest-blast-radius part of the diff.
- **Accordion `reveal()` in grouping mode**: `views/builders.ts` overrides `getParent` to return the cached group for `BuilderTreeItem` children. The cache (`groupParentByBuilderId`) is repopulated every time `rootChildren()` runs in multi-group mode; cleared in the single-`Uncategorized` flatten case (builders are root again). Watch for the accordion behaviour with two builders in different areas — expanding one should auto-collapse the other.
- **`AreaGroupTreeItem` sub-classing pattern**: `BacklogGroupTreeItem` and `BuilderGroupTreeItem` are 3-line subclasses that exist solely so `extension.ts`'s per-view expand/collapse handlers can scope via `instanceof`. Without them, both handlers would fire on every group expand/collapse. Mentioned for clarity; the design isn't novel but the subclasses look almost empty so worth a sentence.
- **Wire-field reconciliation**: the revised #818 issue body still says `OverviewBuilder.areas[]` (plural) in places. The implementation consumes the single-string `OverviewBuilder.area` projection that #886 / #819 actually shipped. If you'd prefer rolling the wire shape forward to plural, that's a separate change against #819 — out of scope here.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder pir-818 → **Codev: View Diff** (auto-detects the repo's default branch)
- **Run dev server**: VSCode sidebar → right-click builder pir-818 → **Run Dev Server**, or `afx dev pir-818`
- **What to verify**:
  - Open the Backlog view → confirm grouping renders exactly as it did on `main` (no visible regression from the migration)
  - Open the Builders view → groups render with `<area> (<count>)` headers, alphabetical specifics, `Uncategorized` last
  - Within-group order preserves `orderForDisplay()` (blocked → idle-waiting → active)
  - Collapse a group, reload the window → still collapsed
  - Collapse `vscode` in Backlog → Builders' `vscode` group stays expanded (separate `workspaceState` keys)
  - With `codev.buildersAutoCollapse` on, expand one builder → others auto-collapse across groups
  - Add/remove an `area/*` label on an open issue via `gh issue edit` → next overview tick (~60s) re-groups the affected builder

## Flaky Tests

None.
