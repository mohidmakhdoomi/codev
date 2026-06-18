# PIR Review: Cross-file navigation in a Codev View Diff session

Fixes #1060

## Summary

Adds two palette + keyboard commands, `codev.diffNextFile` / `codev.diffPreviousFile` (Ctrl+Alt+] / Ctrl+Alt+[), that walk a builder's changed-file list and open each file's per-file diff — the keyboard equivalent of clicking the next file row in the Builders sidebar (GitHub PR review's `j`/`k`). The implementation deliberately reuses already-shipped machinery (the `BuilderDiffCache` that backs the sidebar for the ordered list, the diff-inject registry for the current position, and the per-file `vscode.diff` open path) rather than driving VSCode's multi-file diff editor internals, so there is no change to how `codev.viewDiff` opens.

## Files Changed

- `packages/vscode/src/commands/diff-nav.ts` (+133 / -0) — new: `navigateDiff` + pure helpers (`orderedRelPaths`, `computeNavTarget`, `indexOfRelPath`)
- `packages/vscode/src/commands/view-diff.ts` (+39 / -0) — extracted `openBuilderFileDiff(context, args, showOptions?)`, the shared per-file open seam
- `packages/vscode/src/extension.ts` (+11 / -14) — registered the two commands; refactored `codev.openBuilderFileDiff` to call the extracted helper
- `packages/vscode/package.json` (+18 / -0) — two `contributes.commands` + two `contributes.keybindings` entries
- `packages/vscode/src/__tests__/diff-nav.test.ts` (+103 / -0) — new: unit tests for the pure helpers
- `packages/vscode/src/__tests__/contributes-commands.test.ts` (+27 / -0) — assert the commands are declared, palette-discoverable, and bound (no function keys)
- `codev/resources/lessons-learned.md` — two cold-tier lessons (see below)

## Commits

- `5bda593a` [PIR #1060] Extract openBuilderFileDiff helper, refactor sidebar handler
- `50f7fb25` [PIR #1060] Add diffNextFile/diffPreviousFile cross-file navigation commands
- `f9fe8b76` [PIR #1060] Tests for nav helpers + command declarations
- `6649e752` [PIR #1060] Add Ctrl+Alt+] / Ctrl+Alt+[ keybindings (builder-diff scoped)
- (plus thread-log commits)

## Test Results

- `pnpm compile` (check-types + lint + esbuild): ✓ pass
- `pnpm test:unit`: ✓ pass (438 tests, 11 new in `diff-nav.test.ts` + 1 extended in `contributes-commands.test.ts`)
- Manual verification (human, at the `dev-approval` gate): walked files via the new commands in a running worktree — confirmed working ("File Navigation looks good"). The sidebar-selection-sync gap noticed during this review was spun out to a separate issue (#1066) rather than folded in.

## Architecture Updates

No arch changes needed. The feature introduces no new module boundaries: it reuses `BuilderDiffCache` (changed-file list), the diff-inject registry (`getDiffInjectEntry`), and the existing per-file diff path. The one structural touch — extracting `openBuilderFileDiff` from the `extension.ts` command handler into `view-diff.ts` — is a same-seam refactor (the sidebar command and the nav commands now share it), not a boundary change, so it doesn't rise to an `arch.md` / `arch-critical.md` entry.

## Lessons Learned Updates

Two cold-tier lessons added to `codev/resources/lessons-learned.md` (UI/UX section) — both VSCode-diff-narrow, so COLD not HOT:

1. Programmatic reveal inside VSCode's multi-file diff editor requires the internal `_workbench.openMultiDiffEditor` (the public `vscode.changes` synthesizes a random source URI and has no file-granular nav) — but the cheaper, more robust path is to reuse an existing changed-file list + per-file diffs. Check for an existing list before reaching for an internal `_workbench.*` command.
2. `preview: true` reuses one tab for a sequential-open walk (but is ignored when the user disabled preview editors — respect that, don't force-close); and scope a nav keybinding to the feature-specific context key (`codev.activeEditorIsBuilderFile`), not the broad `isInDiffEditor`, so it can't fire in an unrelated diff and act on stale state.

## 3-Way Consultation (single advisory pass)

- **Claude — APPROVE** (HIGH, no issues). Confirmed the refactor is behavior-preserving and called the keybindings a "good deviation."
- **Codex — REQUEST_CHANGES** (HIGH), two findings, both addressed:
  1. *Keybindings deviate from plan decision #1 (palette-only).* **Disposition: authorized, plan amended.** The keybindings were added at the human's explicit direction during the dev-approval gate (reversing the original lean, avoiding function keys); dev-approval was granted afterward. Plan decision #1 is now updated to record the amendment so the artifact matches the code. No code change.
  2. *Navigation can't be **initiated** from a deleted/binary file diff opened directly.* **Disposition: real defect, fixed + regression test.** Deleted/binary files have no `file:` right side, so `registerFileInjectSession` skips them and `getDiffInjectEntry` can't resolve them; with `lastPosition` unset, next/prev bailed. Fix: seed the nav anchor on *every* open via `recordDiffNavPosition` (called from the `codev.openBuilderFileDiff` handler), not just after a navigation step — so a subsequent next/prev resolves through the fallback. Regression coverage: `diff-nav.test.ts` now tests the record/peek/reset anchor and that a deleted file resolves in the list. Commit `<see PR>`.
- **Gemini — no usable verdict.** The `agy`/Antigravity run misfired: it went off investigating a "--sandbox" prompt and never reviewed the diff (output in `codev/projects/1060-*/1060-review-iter1-gemini.txt`). Not re-run (PIR consultation is single-pass advisory); flagged for the human.

## Things to Look At During PR Review

- **`navigateDiff` current-position resolution** (`diff-nav.ts`): it reads the active editor's fsPath via the diff-inject registry, with a module-level `lastPosition` fallback for when the active editor isn't a tracked diff file. Worth a look that the fallback + the no-op status messages (no session / file-not-in-list / at-edge) cover the cases sensibly.
- **`openBuilderFileDiff` behavior preservation**: the sidebar command (`codev.openBuilderFileDiff`) now calls the helper with no `showOptions`, so it runs `vscode.diff(left, right, title)` with no 4th arg — byte-identical to the pre-refactor call. Only navigation passes `{ preview: true }`. Confirm the refactor didn't change the sidebar-click path.
- **Keybinding `when` clause**: I used `codev.activeEditorIsBuilderFile` rather than the generic `isInDiffEditor` shown in the plan-gate option, to avoid the chord firing in unrelated diffs (where it would fall back to a stale position). Flagging the deliberate deviation.
- **Navigation order**: canonical `git --name-status` order (matches the View Diff file list and the sidebar's flat-list mode). In the sidebar's *file-tree* mode the visual order differs (folders-first/alphabetical) — documented as a plan decision, not a bug.

## How to Test Locally

For reviewers pulling the branch:

- **Run dev server**: VSCode sidebar → right-click builder `pir-1060` → **Run Dev Server**, or `afx dev pir-1060`
- **What to verify**:
  - Open a builder file diff (sidebar click or View Diff), run *Codev: Go to Next File in Diff* (or Ctrl+Alt+]) repeatedly → steps through files in list order, reusing one tab; at the last file a status-bar message ("last file in diff"), no wrap. Previous (Ctrl+Alt+[) walks back; at the first, "first file in diff".
  - Within-file hunk nav (F7 / Shift+F7) still works on each opened file.
  - Open a second builder's file; navigation stays within whichever builder's file is currently shown (isolation).
  - Works with the Builders sidebar collapsed/hidden.

## Changelog

Per the established workflow, `packages/vscode/CHANGELOG.md` and `docs/releases/UNRELEASED.md` are **not** touched on this branch — they live on the divergent `docs/vscode-changelog` branch (`worktrees/changelog/`) and are added by the architect post-cleanup. Flagged in the architect notification.
