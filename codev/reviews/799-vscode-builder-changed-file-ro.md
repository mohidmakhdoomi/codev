# PIR Review: Builder changed-file rows render grey instead of SCM colors (#799)

Fixes #799

## Summary

Builder changed-file rows in the VSCode Builders view rendered grey instead of SCM colors (Added green / Modified yellow / Deleted red). A prior fix (v3.1.4) switched the row's `resourceUri` to a custom scheme on the theory that VSCode's built-in Git decorator gates on `scheme === 'file'` — but it does not: Git's decorators resolve a repository by **path** and `git check-ignore` the path, scheme-agnostically. Since the URI's path was still the real gitignored `.builders/<id>/…` worktree path, Git kept emitting its grey "ignored" decoration and won the equal-weight color merge (all extension decorations are pinned to `weight: 10`) on a ~500 ms debounce — the "correct color flashes, then grey" symptom. The fix builds the `resourceUri` from a **synthetic path** that resolves into no open repository, so Git never decorates these rows and our SCM color stands uncontested. Coloring itself is unchanged (same provider, same theme tokens).

## Files Changed

- `packages/vscode/src/views/builder-file-tree-item.ts` (+33 / -10) — `builderFileResourceUri` now returns a synthetic-path URI; doc comments rewritten to the real (path-based) mechanism.
- `packages/vscode/src/test/builder-file-tree-item.test.ts` (+74 / -9) — regression tests that assert the path is not Git-resolvable, the worktree is recoverable, URIs are unique per builder, and the decoration carries a color + badge per status.

(Plan, thread, and porch state files also ship with the branch: `codev/plans/799-…md`, `codev/state/pir-799_thread.md`, `codev/projects/799-…/status.yaml`, plus the `codev/resources/lessons-learned.md` updates below.)

## Commits

- `bf9ee0a9` [PIR #799] Fix grey builder file rows: synthetic-path resourceUri so Git can't decorate them
- `7c36ce17` [PIR #799] thread: implement complete, pausing at dev-approval
- (plan-phase commits: `22f30291`, `8f6f0447`, `bff8bc84`, `5a409910`)

## Test Results

- `pnpm --filter codev-vscode compile` (check-types + lint + esbuild): ✓ pass
- `pnpm --filter codev-vscode test`: ✓ pass (105 tests, 7 new for #799)
- porch `build` ✓ / `tests` ✓
- Manual verification: confirmed at the `dev-approval` gate by running the Extension Development Host with the built-in Git extension enabled — builder file rows render stably colored (no flash-then-grey) in both list and tree mode.

## Architecture Updates

No `arch.md` changes needed — this fix changes the construction of one `resourceUri` inside an existing view; it introduces no new module, boundary, or architectural pattern. The decoration provider, cache, and registration are unchanged.

## Lessons Learned Updates

Two entries added to `codev/resources/lessons-learned.md`:

- **UI/UX**: VSCode's built-in Git `FileDecorationProvider` matches resources by repository *path*, not URI scheme, and all extension decorations share a fixed `weight: 10` (an extension can't outrank Git in the color merge). To keep Git off a custom TreeView row, the `resourceUri` needs a synthetic path that resolves into no open repo — a non-`file` scheme alone is insufficient.
- **Debugging and Root Cause Analysis**: a plausible fix that ships without live verification can mask the real root cause for a release. The prior #799 fix passed unit tests that only checked URI *shape* (never rendering) and addressed the wrong layer. The precise user symptom (late override, not static wrong value) plus reading the actual VSCode source — not the API docs — cracked it.

## Things to Look At During PR Review

- **The crux is one line**: `builderFileResourceUri` now uses `vscode.Uri.from({ scheme, path: '/' + rel, query: 'wt=' + encodeURIComponent(worktreePath) })`. The invariant is that `uri.path` must NOT be a real path inside any open repo (so Git's `getRepository` returns undefined). The worktree rides in the query purely to keep `uri.toString()` unique per builder (the global decoration cache keys by `uri.toString()`); nothing in production parses it back.
- **fsPath is now synthetic.** Verified safe: no menu contributes to the `builder-file` contextValue, and `codev.openBuilderFileDiff` (extension.ts:626) reads the tree-item's `plan`/`worktreePath`/`baseRef`, never `resourceUri`/`fsPath`. So open-diff and the right-click menu are unaffected. A future `revealFileInOS`/`copyFilePath` contribution on these rows would need the real path recovered from the `wt` query.
- **Why not contributes.colors / a different scheme?** The colors render correctly (the flicker proved it) — the borrowed `gitDecoration.*` tokens are fine; the only defect was Git winning the merge. Reverting the scheme would regress nothing useful. Extensions cannot set decoration weight, so out-ranking Git is not an option (vscode#187756, open).

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-799` → **View Diff**.
- **Run the extension**: build it (`pnpm --filter codev-vscode compile`) and launch the Extension Development Host (F5 "Run Extension") on a workspace with at least one spawned builder worktree containing Added/Modified/Deleted files.
- **What to verify** (with the built-in Git extension *enabled*):
  - Changed-file rows show stable SCM colors (Added green, Modified yellow, Deleted red) with no flash-then-grey, in **both list and tree mode**.
  - Holds across light, dark, and high-contrast themes.
  - Clicking a row still opens the per-file diff; the file-type icon still renders.
  - Root-cause sanity check on the *old* build: disabling the Git extension makes the grey disappear — confirming Git was the overrider.

## Note for reviewers

This was a fresh worktree with no `node_modules` (this repo has no `worktree.postSpawn` configured), so building required `pnpm install` + building the upstream `@cluesmith/codev-types` / `-core` packages first. Not part of the change; flagged so the build steps reproduce.
