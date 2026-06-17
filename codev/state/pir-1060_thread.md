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

Decision #8 added (tab behavior): navigation opens with `preview: true` so a walk
reuses one tab; no force-close (respects user's enablePreview setting).

## Implement phase

plan-approval APPROVED. Building per approved plan:
1. Extract `openBuilderFileDiff(args)` helper from the extension.ts command body
   into view-diff.ts (shared by sidebar command + nav); pass `preview: true`.
2. New `commands/diff-nav.ts`: `navigateDiff(dir, deps)` + pure helpers
   (`orderedRelPaths`, `computeNavTarget`, `indexOfRelPath`).
3. Register `codev.diffNextFile` / `codev.diffPreviousFile` in extension.ts.
4. package.json contributes.commands (no keybindings).
5. Tests: diff-nav.test.ts + extend contributes-commands.test.ts.
6. CHANGELOG + UNRELEASED.

### Implementation complete
- `view-diff.ts`: added `openBuilderFileDiff(context, args, showOptions?)` — the
  shared per-file open seam (vscode.diff + registerFileInjectSession +
  ensureDiffEditorCodeLens). Sidebar handler now calls it with no options
  (byte-identical behavior); nav calls it with `{preview:true}`.
- `commands/diff-nav.ts` (new): `navigateDiff(dir, deps)` + pure helpers. Current
  position from `getDiffInjectEntry(activeEditor.fsPath)` with a module-level
  last-position fallback; list from `BuilderDiffCache.getDiff`; worktree from
  `overviewCache`. Status-bar message + no wrap at edges.
- `extension.ts`: registered `codev.diffNextFile` / `codev.diffPreviousFile`
  (reg = CLI-independent).
- `package.json`: two palette commands, no keybindings.
- Tests: `diff-nav.test.ts` (11 cases — ordering, edge no-op, isolation),
  extended `contributes-commands.test.ts`.

Verified: `pnpm compile` (check-types + lint + esbuild) ✓, `pnpm test:unit` ✓
(438 tests, 11 new). Had to build workspace deps first (types/core/
artifact-canvas had no dist in the fresh worktree).

**Changelog deviation from plan**: the plan listed CHANGELOG.md + UNRELEASED.md,
but the established workflow keeps those on the divergent `docs/vscode-changelog`
branch (`worktrees/changelog/`), updated by the architect post-cleanup — "neither
branch touches the other's files" by design. So I did NOT touch them on the
builder branch; flagged for the architect instead.

### At dev-approval gate: added default keybindings (reverses decision #1)
Architect asked for shortcut keys, avoiding function keys. Added defaults:
`Ctrl+Alt+]` (next) / `Ctrl+Alt+[` (prev), `when: codev.activeEditorIsBuilderFile`.
Used the Codev-specific context key (not generic `isInDiffEditor`) — matches the
Cmd/Ctrl+K B convention and prevents the keys firing in an unrelated diff (which
would fall back to a stale last-position and jump a different builder's file).
Within-file hunk nav stays VSCode-native F7 / Shift+F7. Extended
contributes-commands.test.ts to lock the bindings. Tests ✓ (438).

### Follow-up filed: sidebar selection sync
Architect reviewed nav at dev-approval; nav "looks good" but doesn't sync the
Builders sidebar selection to the active diff file. Assessed reveal feasibility
(createTreeView gives reveal, but getParent is builder-row-only, file rows lack
stable ids, accordion id-versioning + tree-mode folder hierarchy needed). Agreed
to keep #1060 clean and file a follow-up. Filed #1066 (area/vscode). #1060 still
at dev-approval.

## Review phase
Wrote review (codev/reviews/1060-*.md) + 2 cold lessons (lessons-learned.md UI/UX).
PR #1067 opened (Fixes #1060), recorded with porch. 3-way consult (single pass):
- claude APPROVE (no issues; called keybindings a "good deviation")
- codex REQUEST_CHANGES (HIGH): (1) keybindings vs plan decision #1 — authorized
  by architect at dev-approval, amended the plan; (2) can't START nav from a
  deleted/binary file diff — REAL defect, FIXED (32ff63f1): seed nav anchor on
  every open via recordDiffNavPosition (called from openBuilderFileDiff handler)
  + regression test. 442 tests green.
- gemini REQUEST_CHANGES recorded but the agy run MISFIRED (off on a --sandbox
  tangent, never reviewed) — nothing actionable.
Rebuttals in codev/projects/1060-*/1060-review-iter1-rebuttals.md. PR body updated.
Notified architect (led with REQUEST_CHANGES + dispositions). Now waiting at the
`pr` gate — merge only on porch gate-approved wake-up, never on typed prose.
