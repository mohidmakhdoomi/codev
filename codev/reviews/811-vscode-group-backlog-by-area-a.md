# PIR Review: vscode — group backlog tree by area

Fixes #811

## Summary

The vscode Backlog tree is now grouped by `area/*` label. Group ordering is driven by a per-repo setting `codev.backlog.priorityAreas` (default empty → pure alphabetical) followed by `Uncategorized` last; a single-`Uncategorized` group collapses to flat rendering so repos that haven't adopted `area/*` labels see no visual regression. Cross-cutting privilege is *not* hardcoded — the framework stays policy-free about specific label names (extending #819's discipline to the view layer).

## Files Changed

Computed via `git diff --stat origin/main...HEAD`:

- `codev/plans/811-vscode-group-backlog-by-area.md` (+75 / -0)
- `codev/projects/811-vscode-group-backlog-by-area-a/status.yaml` (+22 / -0) — porch-managed
- `codev/reviews/811-vscode-group-backlog-by-area-a.md` (+TBD / -0) — this file
- `codev/state/pir-811_thread.md` (+TBD / -0)
- `packages/vscode/package.json` (+6 / -0) — registered the `codev.backlog.priorityAreas` setting
- `packages/vscode/src/extension.ts` (+19 / -3) — wire workspaceState + expand/collapse listeners + config-change listener
- `packages/vscode/src/test/backlog.test.ts` (+91 / -11) — 8 new `groupBacklogByArea` tests; one defensive test (`Uncategorized stays last even when listed in priorityAreas`)
- `packages/vscode/src/views/backlog-tree-item.ts` (+22 / -0) — `BacklogGroupTreeItem` class
- `packages/vscode/src/views/backlog.ts` (+193 / -21) — pure `groupBacklogByArea` helper + two-level `BacklogProvider` + single-Uncategorized flatten optimization

Total: 9 files, +428 / -35 (approx; final stat in PR description).

## Commits

```
68c3d070 [PIR #811] Group backlog tree by area/* label
5fd9351e [PIR #811] Thread: log implement-phase progress
aab03a27 [PIR #811] Replace hardcoded cross-cutting with codev.backlog.priorityAreas setting
f736c3cc [PIR #811] Plan + thread: revise to user-configurable priority areas
87fbf75b [PIR #811] Flatten single-Uncategorized backlog to row list (no header)
7309c94c [PIR #811] Plan draft
```

## Test Results

- `pnpm --filter codev-vscode test`: ✓ 92 pass (8 new `groupBacklogByArea` cases + 84 pre-existing)
- `pnpm build` (full workspace): ✓ green
- `pnpm --filter codev-vscode check-types`: ✓ green
- `pnpm --filter codev-vscode lint`: ✓ green (ESLint via the test pretest pipeline)
- Manual verification (at `dev-approval` gate): the human inspected the running implementation in the worktree dev server and approved.

## Architecture Updates

No changes to `codev/resources/arch.md`. This PR adds:

1. A pure view-layer grouping helper (`groupBacklogByArea`) over an existing wire shape (`OverviewBacklogItem.area`, added by #819) — no new module boundaries, no new wire fields, no new caching layers.
2. A two-level VSCode `TreeDataProvider` for the backlog view — a localized refactor of `BacklogProvider`, not a new tree-architecture pattern.
3. A per-repo VSCode setting (`codev.backlog.priorityAreas`) — registered in `packages/vscode/package.json` alongside the existing `buildersAutoCollapse` / `buildersFileViewAsTree` settings, mirroring their wiring discipline (read via `vscode.workspace.getConfiguration('codev')`, refresh provider on `onDidChangeConfiguration`).

None of these warrant arch-doc entries — they reuse established patterns. The framework-neutrality discipline (do not bake repo-specific label names into framework code) was already established in `codev/resources/arch.md` / lessons via #819 and remains the implicit rule this PR follows.

## Lessons Learned Updates

No additions to `codev/resources/lessons-learned.md`. Two design decisions worth noting are already covered by existing project memory:

1. **Framework code stays policy-free about specific label values.** The first iteration hardcoded `'cross-cutting'` into the view's grouping rule. The human at dev-approval flagged this as the same anti-pattern #819 corrected at the parser. Replaced with a per-repo VSCode setting `codev.backlog.priorityAreas: string[]`. This is the *view-layer mirror* of the parser-layer rule already captured in [`feedback_framework_neutral_on_label_semantics`](../../.claude/projects/-Users-amrmohamed-repos-cluesmith-codev/memory/feedback_framework_neutral_on_label_semantics.md) — same principle, different surface, no new lesson needed.

2. **Trust the wire contract; don't add defensive coercions for things the contract guarantees.** First iteration had `item.area || UNCATEGORIZED_AREA` as a defensive fallback even though the wire contract (`required-with-default`, set by `parseArea` server-side) guarantees `area` is always a populated string. Dropped the fallback and the corresponding empty-string test case. This is the system-prompt rule ("Don't add error handling, fallbacks, or validation for scenarios that can't happen") applied to the view boundary — not a new lesson.

A follow-up issue was filed during this PIR:

- **#885** — `vscode: capitalize area group header labels in backlog and builders trees`. The lowercase `area/*` label convention renders headers as `vscode (12)` next to `Uncategorized (8)`; visual inconsistency that this PIR did not address (it would touch the rendering layer and the same fix should land in #818's builders-tree grouping). Filed with both surfaces in scope and the sentence-case-vs-override-map decision left to the implementer.

## Things to Look At During PR Review

1. **Two design revisions during the implement phase**, visible in the commit history. The first iteration hardcoded `'cross-cutting'` as a privileged top group. The human flagged that as repo-specific policy leaking into framework code — replaced with `codev.backlog.priorityAreas` (per-repo setting). Then dropped the defensive `item.area || UNCATEGORIZED_AREA` coercion since the wire contract guarantees `area` is populated. Net: the final shape is smaller and cleaner than the first cut. The plan file's Risks section and the thread document the back-and-forth.

2. **Single-Uncategorized flatten optimization** (`packages/vscode/src/views/backlog.ts:154-160`). When the grouped output is exactly one group AND that group is `Uncategorized`, the view skips the header and returns rows directly. This means a repo that hasn't adopted `area/*` labels sees zero visual change from the pre-grouping flat list — the zero-cost migration property the issue body promised. Worth a glance to confirm the trigger condition is what you'd expect (it's specifically "1 group AND Uncategorized" — not just "1 group", since a single-`vscode` repo with all items in one specific area still gets a header for clarity).

3. **Group identity** (`BacklogGroupTreeItem.id = 'backlog-group:<areaName>'`). VSCode reuses the same TreeItem instance across `onDidChangeTreeData` refreshes when `id` matches, which keeps the user's expand/collapse state visually stable across the `OverviewCache` SSE tick. Without the stable `id`, every refresh would reset the visible expansion (the persisted state in `workspaceState` would still be honored, but the tree would flash collapsed-then-expanded on each tick).

4. **`Uncategorized` is unpinnable defensively** (`packages/vscode/src/views/backlog.ts:61-63`). Even if a repo misconfigures `codev.backlog.priorityAreas: ["Uncategorized"]`, it's skipped from the priority loop so it always lands last. Explicit regression test: `Uncategorized stays last even when listed in priorityAreas`. This pinning rule isn't documented in the setting's `markdownDescription`; the test is the contract.

5. **`pnpm --filter @cluesmith/codev test` showed 17 unrelated flakes on first run** (cron-cli and other agent-farm tests) that all passed on retry. The diff is 100% under `packages/vscode/` so the failures cannot be caused by this PIR. Mentioning for transparency, not as a flaky-test skip — no tests were quarantined.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-811` → **Review Diff** (auto-detects the repo's default branch). Or `git diff main...HEAD`.
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-811` from a shell.
- **What to verify**:
  - The Backlog tree shows grouped headers like `vscode (N)`, `tower (N)`, etc., ordered alphabetically with `Uncategorized` last.
  - Issue #854 (currently labeled `area/cross-cutting`) lives in its own `cross-cutting` group (alphabetical position, not pinned — pinning is opt-in via the setting).
  - Add `"codev.backlog.priorityAreas": ["vscode"]` to your VSCode user/workspace settings → the `vscode` group jumps to the top; everything else stays alphabetical; `Uncategorized` stays last.
  - Collapse a group, reload the VSCode window → that group stays collapsed.
  - Single-issue click → still opens via `codev.viewBacklogIssue`. Right-click → context menu actions (spawn, open in browser, copy issue number) still work.
  - On a hypothetical repo with no `area/*` labels at all, the view renders flat (no `Uncategorized (N)` header) — zero-cost migration.
  - Dashboard's `BacklogList` (web): no wire changes, no breakage; still renders as a flat list.

## Flaky Tests

None skipped or quarantined.
