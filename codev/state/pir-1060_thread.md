# PIR #1060 — vscode cross-file diff navigation

## Plan phase

**Goal**: add `codev.diffNextFile` / `codev.diffPreviousFile` to walk files in a Codev View Diff session.

### Key research findings (from the VSCode 1.105 bundle + codebase)

- `codev.viewDiff` (`packages/vscode/src/commands/view-diff.ts`) opens the multi-file diff via the **public** `vscode.changes` command → `_workbench.changes`. That path creates the multi-diff editor with a **non-deterministic** source URI (`multi-diff-editor:${ms+Math.random()}`), so I can't address that editor later to reveal a file.
- VSCode has **no** built-in file-granular navigation. `multiDiffEditor.goToNextChange/goToPreviousChange` are **hunk**-granular (call `pane.goToNextChange()`); `multiDiffEditor.goToFile` opens the focused file as a standalone editor. None walk file-to-file.
- The internal command `_workbench.openMultiDiffEditor({ multiDiffSourceUri, resources:[{originalUri,modifiedUri}], title, reveal:{modifiedUri,range} })` **does** support revealing a specific file (`viewState.revealData`). Reveal only resolves when `resources` is passed (it searches the resources array for the matching `modifiedUri`).
- Editor identity is keyed by `multiDiffSource` URI → re-invoking with the **same** source URI reveals **in place** (no duplicate tab, focus stays on the diff editor).

### Design decision
Migrate `viewDiff`'s open call from `vscode.changes` to `_workbench.openMultiDiffEditor` with an explicit, deterministic per-builder source URI (`codev-multidiff:/<builderId>`). Navigation commands re-invoke the same command with the same source URI + resources + `reveal.modifiedUri`. A module-level nav-session store (keyed by builder id) holds the ordered resources + current index; active session resolved from `activeTextEditor`'s fsPath (falls back to most-recent). Pure helpers (ordering, edge-clamp, index-by-fsPath) carry the unit tests.

Plan written to `codev/plans/1060-vscode-next-file-previous-file.md`. Awaiting `plan-approval`.

### Revision 1 (architect feedback)
Architect redirected: **don't rely on VSCode multi-diff internals at all.** Reuse
the Builders sidebar's existing changed-file list mechanism. Rewrote the plan
around:
- `BuilderDiffCache.getDiff(builderId, worktreePath)` → ordered `files` (same
  source the sidebar uses; 15s TTL so no per-keypress git spawn).
- Current position resolved from the active editor via `getDiffInjectEntry(fsPath)`
  → `{builderId, relPath}` (already populated by viewDiff + openBuilderFileDiff).
- Open the next/prev file via the **existing** per-file `vscode.diff` path
  (extract `openBuilderFileDiff` helper, shared by the sidebar command + nav).
- No `_workbench.openMultiDiffEditor`, no viewDiff migration, no regression
  surface on the working View Diff open path.

New plan-gate items surfaced: navigation order (recommend canonical git order =
flat sidebar + View Diff list; file-tree mode visual order differs), and that
navigation opens per-file diffs (GitHub PR-review model). Recommitted; still
awaiting `plan-approval`.
