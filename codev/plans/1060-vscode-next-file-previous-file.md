# PIR Plan: Cross-file navigation in a Codev View Diff session

## Understanding

`codev.viewDiff` opens a builder worktree's full delta with a file-list pane;
clicking a file row (`codev.openBuilderFileDiff`) opens that file's per-file
diff. VSCode handles **within-file** hunk navigation (F7 / Shift+F7), but there
is no **cross-file** "next/previous file" gesture — the reviewer must click in
the file list. #1060 asks for the keyboard equivalent (GitHub PR review's
`j`/`k`).

Two new commands:

- `codev.diffNextFile` — open the next file's diff.
- `codev.diffPreviousFile` — open the previous file's diff.

### Approach (per architect direction): reuse the builder's changed-file list

The architect pointed out the clean path: **the Builders sidebar already builds
an ordered list of a builder's changed files** (`BuilderDiffCache.getDiff` →
`getBuilderChanges` → `planResources`, in `builder-diff-cache.ts` /
`view-diff.ts`). Navigation just walks that list top-to-bottom, opening each
file's per-file diff via the **existing** `codev.openBuilderFileDiff` open logic.

This needs **no** VSCode multi-diff editor internals and **no** changes to how
`viewDiff` opens — it's built entirely on already-shipped, public mechanisms:

1. **The ordered list** comes from `BuilderDiffCache.getDiff(builderId, worktreePath)`,
   which returns `{ baseRef, files: BuilderFileChange[] }`. `files` is in
   `git diff --name-status` order — exactly the flat-list sidebar order and the
   View Diff editor's file-list order. The cache has a 15s TTL, so navigation
   keypresses don't spawn a `git` process each.
2. **The current position** is resolved from the active editor: the diff-inject
   registry (`getDiffInjectEntry(fsPath)`, populated by both `viewDiff` and
   `openBuilderFileDiff`) maps the active editor's right-side worktree fsPath →
   `{ builderId, relPath }`. So "where am I" = the file the diff editor is
   currently showing; no stored pointer to drift out of sync.
3. **Opening the next file** reuses the per-file open path (`diffUrisForChange`
   → `vscode.diff` → `registerFileInjectSession`), i.e. the same thing clicking
   a sidebar file row does today.

The opened per-file diff becomes the active editor, so the *next* keypress
resolves the new current file and steps again — a clean walk.

> I initially scoped this around revealing files inside the `vscode.changes`
> multi-file editor, which would have required migrating `viewDiff` to the
> internal `_workbench.openMultiDiffEditor` command (the only thing that exposes
> a programmatic file reveal). The architect's file-list approach is strictly
> better: no internal/undocumented command, no regression surface on the working
> View Diff open path. That earlier approach is dropped.

## Proposed Change

### 1. Extract a reusable per-file open helper

Today the `codev.openBuilderFileDiff` handler (extension.ts ~877) inlines:
`diffUrisForChange` → `vscode.diff` → `registerFileInjectSession` →
`ensureDiffEditorCodeLens`. Extract that into a single exported function so the
command **and** the navigation commands share one code path:

```ts
// view-diff.ts (or a sibling)
export async function openBuilderFileDiff(args: {
  worktreePath: string; baseRef: string; builderId: string; plan: ResourcePlan;
}): Promise<void> { /* the existing handler body */ }
```

The existing handler becomes a thin caller (it already receives a
`BuilderFileTreeItem` and narrows via `instanceof`). No behavior change.

### 2. The navigation module (`commands/diff-nav.ts`, new)

`navigateDiff(direction: 1 | -1, deps)` where deps give access to the overview
(builderId → worktreePath) and the shared `BuilderDiffCache`:

1. **Resolve current file + builder.** Read
   `vscode.window.activeTextEditor?.document.uri.fsPath`; look it up via
   `getDiffInjectEntry` → `{ builderId, relPath }`. If unresolved, fall back to a
   module-level "last navigated position" (`{ builderId, relPath }`, updated on
   every successful navigation/open). If still unresolved → status-bar message
   ("Open a Codev file diff first") and return.
2. **Load the builder's ordered list.** Look up `worktreePath` from the overview
   by `builderId` (as `viewDiff` does); `cache.getDiff(builderId, worktreePath)`
   → `{ baseRef, files }`.
3. **Find current index** = `indexOfRelPath(files, relPath)`. (-1 → treat as
   "not in this list"; status message + return.)
4. **Compute target** via pure `computeNavTarget(index, files.length, direction)`.
   If `atEdge` → status-bar message ("Last file in diff" / "First file in diff"),
   **no wrap**, return.
5. **Open** the target via the extracted `openBuilderFileDiff` helper
   (`files[target].plan`, `worktreePath`, `baseRef`, `builderId`), passing
   `{ preview: true }` (see decision #8 — reuses a single tab instead of piling
   up). Update the "last navigated position".

Two commands, both thin wrappers: `codev.diffNextFile` → `navigateDiff(1)`,
`codev.diffPreviousFile` → `navigateDiff(-1)`.

### 3. Wiring (`extension.ts`)

- The shared `builderDiffCache` already exists (extension.ts:359). Pass it +
  `connectionManager` into the two new `reg(...)` registrations (CLI-independent;
  they act on editor state, not Tower) near `codev.viewDiff` (~838).

### 4. Contributions (`package.json`)

- `contributes.commands`: `Codev: Go to Next File in Diff` /
  `Codev: Go to Previous File in Diff`.
- **No default keybindings** (decision #1) — palette-only.
- No palette `when`-hiding (acceptance: palette-discoverable); they no-op with a
  status message when there's no active diff.

### 5. Pure helpers (unit-test surface) in `diff-nav.ts`

- `orderedRelPaths(files: BuilderFileChange[]): string[]` — the navigation order
  (asserts it equals `files` / git order, matching the sidebar flat list).
- `computeNavTarget(index, count, direction): { index: number; atEdge: boolean }`
  — clamp + edge detection (next-at-end / prev-at-start no-op).
- `indexOfRelPath(files, relPath): number` — current-file resolution; two
  independent file lists drive the multi-builder-isolation test.

## Files to Change

- `packages/vscode/src/commands/view-diff.ts` — extract `openBuilderFileDiff(args)`
  helper from the extension.ts handler body (move the `vscode.diff` +
  `registerFileInjectSession` + `ensureDiffEditorCodeLens` sequence). Re-export
  what's needed.
- `packages/vscode/src/commands/diff-nav.ts` (new) — `navigateDiff` + the three
  pure helpers.
- `packages/vscode/src/extension.ts` — register `codev.diffNextFile` /
  `codev.diffPreviousFile`; refactor the `codev.openBuilderFileDiff` handler to
  call the extracted helper.
- `packages/vscode/package.json` — two `contributes.commands` entries. No
  keybindings.
- `packages/vscode/src/__tests__/diff-nav.test.ts` (new) — unit tests for the
  three pure helpers (ordering, edge no-op, multi-builder isolation).
- `packages/vscode/src/__tests__/contributes-commands.test.ts` — assert the two
  new commands are declared (mirrors existing pattern).
- `packages/vscode/CHANGELOG.md` + `docs/releases/UNRELEASED.md` — per-PR
  changelog accumulation (vscode-relevant change).

No `codev-skeleton/` mirror: the VSCode extension is a published package, not a
skeleton-mirrored framework file.

## Plan-Gate Decisions

1. **Default keybindings** → ~~None (palette-only) + docs.~~ **AMENDED at the
   dev-approval gate (architect direction):** ship defaults **Ctrl+Alt+]** (next)
   / **Ctrl+Alt+[** (prev), avoiding function keys (F7 / Shift+F7 stay for
   within-file hunk nav). Scoped to `when: codev.activeEditorIsBuilderFile` (not
   the generic `isInDiffEditor`) so the chords only fire on a builder diff and
   don't act on stale state in unrelated diffs. The original palette-only lean
   was reversed by the human during dev-approval; recording it here so the plan
   matches the shipped code.
2. **Edge behavior** → **status-bar message + no wrap.** *(issue's lean)*
3. **Scope** → **per-builder Codev diff list (v1).** Generic any-diff-editor is a
   follow-up. *(issue's lean)*
4. **File-list pane collapsed/hidden** → **works regardless.** Navigation reads
   the cache + active editor, not any pane. *(issue's lean)*
5. **Restore last-viewed file across re-opens** → **out of scope.** Current file
   is always the active editor. *(issue's lean)*
6. **(New) Navigation order** → **canonical `getBuilderChanges` order (git
   `--name-status`).** This matches the View Diff editor's file list and the
   sidebar's **flat (list) mode**. Note: the sidebar's **file-tree mode** renders
   folders-first / alphabetical (`buildFilePathTree`), so its *visual* order
   differs from navigation order in that mode. Recommend git order for v1
   (deterministic, mode-independent, matches the issue's "file-list pane"
   acceptance). Flag for the gate: if you want navigation to mirror the
   file-tree-mode visual order exactly, say so and I'll flatten `buildFilePathTree`
   DFS instead.
7. **(New) What surface navigation opens** → **per-file `vscode.diff`** (the
   `openBuilderFileDiff` surface), one file at a time — the GitHub-PR-review
   model. Invoking next/prev while the multi-file View Diff editor is focused
   drills into the next file as a per-file diff. I'll confirm this feels right at
   the dev-approval gate.
8. **(New) Tab behavior on a walk** → **open with `preview: true`; do not
   force-close.** VSCode preview tabs are "replaced and reused until set to stay,"
   so walking files reuses **one** diff tab rather than accumulating N tabs — the
   same mechanic as single-clicking Explorer files or stepping through search
   results. Caveat (per the API doc): the preview flag is *ignored* if the user
   has disabled preview editors (`workbench.editor.enablePreview: false`), in
   which case tabs accumulate — consistent with that user's global choice that
   every open is permanent. Recommend respecting the setting (no force-close).
   Flag for the gate: if you want guaranteed single-tab behavior even with
   preview disabled, I'll add a "close the previously-navigated diff tab before
   opening the next" step (more complexity; must avoid closing a pinned/dirty
   tab).

## Risks & Alternatives Considered

- **Risk: resolving "current file" from the active editor.** If the user focuses
  a non-diff editor and hits the key, there's no current file. Mitigation: a
  module-level "last navigated position" fallback; failing that, a clear
  status-bar message rather than a silent no-op.
- **Risk: stale cache.** `BuilderDiffCache` has a 15s TTL; a file added/removed
  in the last 15s might not be in the list yet. Acceptable — it's the same list
  the sidebar shows, and the reviewer is reviewing a (mostly settled) branch. A
  refresh (collapse/expand the builder, or the 60s poll) reconciles it.
- **Risk: opening per-file diffs accumulates tabs.** Handled by opening with
  `preview: true` (decision #8) — preview tabs are replaced/reused, so a walk
  leaves one tab. Only piles up if the user disabled preview editors globally.
  Verified at dev-approval.
- **Alternative: scroll/reveal within the multi-file `vscode.changes` editor.**
  Rejected per architect direction — requires the internal
  `_workbench.openMultiDiffEditor` command and migrating the working `viewDiff`
  open path. The file-list approach avoids both.
- **Alternative: store a full nav session per builder at `viewDiff` time.**
  Unnecessary — the cache already holds the list and the active editor already
  encodes the current position; deriving both on demand avoids a second source
  of truth that could drift.

## Test Plan

### Unit (`diff-nav.test.ts`, vitest)
- `orderedRelPaths` returns `files` rel-paths in git order.
- `computeNavTarget`: mid-list advances/retreats by one; at last + forward →
  `atEdge:true`, index unchanged; at 0 + backward → `atEdge:true`.
- `indexOfRelPath`: resolves an index; -1 for unknown; two independent lists each
  resolve against their own files (multi-builder isolation).
- `contributes-commands.test.ts`: both new command ids declared with titles.

### Manual (dev-approval gate — load-bearing)
- Two builders with non-trivial multi-file diffs.
- Open a file diff for builder A (sidebar click or View Diff). `codev.diffNextFile`
  repeatedly → walks A's files in list order; at the last file → status-bar
  "Last file…", no wrap. `codev.diffPreviousFile` walks back; at first →
  "First file…".
- Confirm within-file F7 / Shift+F7 still works on each opened diff.
- Confirm it works with the Builders sidebar collapsed/hidden.
- Open a file for builder B; navigate → B's own list, independent of A
  (isolation). Switch back to an A file; navigate → resumes within A's list.
- Confirm no tab pile-up across a full walk; confirm existing `codev.viewDiff`
  and `codev.openBuilderFileDiff` are unchanged.
