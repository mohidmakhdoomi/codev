# PIR Plan: Cross-file navigation in a Codev View Diff session

## Understanding

`codev.viewDiff` (`packages/vscode/src/commands/view-diff.ts`) opens a builder
worktree's full delta as a single multi-file diff editor with a file-list pane
on the left. VSCode handles **within-file** hunk navigation natively (F7 /
Shift+F7 → `editor.action.diffReview.next/prev`), but there is no **cross-file**
"jump to next/previous file" gesture — the reviewer must click in the file list.
GitHub's PR review UI has `j` / `k` for exactly this; #1060 asks for the
equivalent on the Codev View Diff surface.

Two new commands, scoped to the active Codev diff session:

- `codev.diffNextFile` — reveal the next file in the file-list order.
- `codev.diffPreviousFile` — reveal the previous file.

Both palette-discoverable, keyboard-bindable, and operating relative to the file
the diff editor is currently showing — without requiring the file-list pane to
be focused or visible.

### What the codebase + VSCode actually expose (verified, not assumed)

I disassembled the VSCode 1.105 workbench bundle and read the relevant
extension source to pin down the mechanism before committing to an approach:

1. **Today's open path can't be re-addressed.** `viewDiff` opens the editor via
   the public `vscode.changes` command, which delegates to `_workbench.changes`
   and creates the multi-diff input with a **non-deterministic** source URI
   (`multi-diff-editor:${new Date().getMilliseconds()+Math.random()}`). There is
   no way to compute that URI afterward, so I cannot target that editor to
   programmatically scroll/reveal a file.

2. **No built-in file-granular navigation exists.** The bundle registers
   `multiDiffEditor.goToNextChange` / `goToPreviousChange`, but they are
   **hunk**-granular (they call `pane.goToNextChange()` and walk change-by-change,
   crossing file boundaries only incidentally). `multiDiffEditor.goToFile` opens
   the *currently focused* file as a standalone editor — not a walk. Neither is a
   "next file" primitive.

3. **The reveal primitive lives on an internal command.** `_workbench.openMultiDiffEditor`
   accepts:
   ```ts
   {
     multiDiffSourceUri?: UriComponents,
     resources?: { originalUri: UriComponents, modifiedUri: UriComponents }[],
     title?: string,
     reveal?: { modifiedUri: UriComponents, range?: IRange },
   }
   ```
   When `reveal.modifiedUri` matches one of `resources`' `modifiedUri`s, the
   editor scrolls to that file (`viewState.revealData`). Reveal resolution
   **requires** `resources` to be passed on the call (it searches that array).

4. **Editor identity is the source URI.** The multi-diff input is keyed by its
   `multiDiffSource` URI. Re-invoking `_workbench.openMultiDiffEditor` with the
   **same** source URI reuses the existing editor and just applies the reveal —
   in place, no duplicate tab, and focus stays on the diff editor (strictly
   better than clicking the file list, which can shift focus).

The consequence: to reveal files programmatically I must own a **deterministic**
source URI. That means migrating `viewDiff`'s open call from `vscode.changes` to
`_workbench.openMultiDiffEditor` with an explicit per-builder source URI, and
driving navigation through the same command.

## Proposed Change

### 1. Make the diff editor addressable (open path)

In `view-diff.ts`, replace the `vscode.changes` call with `_workbench.openMultiDiffEditor`,
passing a deterministic source URI per builder:

```ts
const sourceUri = vscode.Uri.from({ scheme: 'codev-multidiff', path: `/${builder.id}` });
await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
  multiDiffSourceUri: sourceUri,
  title: `Reviewing #${builder.issueId ?? builder.id} (${defaultBranch} ↔ HEAD)`,
  resources: plans.map(plan => {
    const { left, right } = diffUrisForChange(plan, { wt, ref: baseRef });
    return { originalUri: left, modifiedUri: right };
  }),
});
```

- The resources are built from the **same** `planResources` / `diffUrisForChange`
  seam used today — left = base blob (or empty/binary placeholder), right =
  on-disk worktree file (or placeholder). Only the *shape* changes (triples →
  `{originalUri, modifiedUri}`) and the source URI becomes explicit.
- A dedicated scheme `codev-multidiff` (distinct from the `codev-diff` content
  provider scheme) is used purely as an identity key. Because `resources` is
  passed inline, no `IMultiDiffSourceResolver` is needed for the scheme.
- The CodeLens "Forward to Builder" session registration (`setDiffInjectSession`
  with the right-side `file:` fsPaths + hunks) is **unchanged** — it keys off the
  modified-side fsPaths, which the migration preserves.

### 2. Track the navigable session

Add a small module-level nav-session store in `view-diff.ts` (or a sibling
`diff-nav.ts`), populated by `viewDiff` right after it opens the editor:

```ts
interface DiffNavFile { originalUri: vscode.Uri; modifiedUri: vscode.Uri; fsPath: string; }
interface DiffNavSession { builderId: string; sourceUri: vscode.Uri; title: string; files: DiffNavFile[]; index: number; }
```

- Keyed by `builderId` in a `Map`, so **multiple** builders' diff sessions
  coexist with independent file lists + pointers (acceptance: multi-builder
  isolation). Re-running View Diff for the same builder replaces that builder's
  session.
- `files` order == `plans` order == `git diff --name-status` order == the
  file-list pane order (acceptance: navigation order = visual order).
- `index` starts at 0.

### 3. The two navigation commands

`codev.diffNextFile` / `codev.diffPreviousFile` both call a shared `navigateDiff(direction)`:

1. **Resolve the active session.** Find the session whose `files` contains
   `vscode.window.activeTextEditor?.document.uri.fsPath`. If none matches (e.g.
   the user hasn't clicked into a sub-editor yet), fall back to the most-recently
   opened session. If there are no sessions at all → status-bar message
   ("No Codev diff session active") and return.
2. **Reconcile the pointer.** If the active editor's fsPath is in the session,
   set `index` to that file's index (keeps navigation correct after the user
   clicks a file in the list).
3. **Compute the target** via a pure helper: `target = index + direction`. If out
   of `[0, files.length)` → status-bar message ("Last file in diff session" /
   "First file in diff session"), **no wrap**, return (acceptance: edge behavior).
4. **Reveal** by re-invoking `_workbench.openMultiDiffEditor` with the session's
   `sourceUri` + `files` (as resources) + `reveal: { modifiedUri: files[target].modifiedUri }`.
   Same source URI ⇒ in-place reveal.
5. Update `session.index = target`.

Because reveal works on the open editor regardless of file-list pane visibility,
the commands work with the pane collapsed/hidden (acceptance).

### 4. Contributions

- `package.json` → `contributes.commands`: two entries,
  `Codev: Go to Next File in Diff` / `Codev: Go to Previous File in Diff`.
- **No default keybindings** (plan-gate decision #1, see below) — palette-only.
- No `when`-clause hiding from the palette (acceptance: palette-discoverable);
  they no-op with a status message when no session is active.

### 5. Pure helpers (the unit-test surface)

Exported, no vscode/git dependency:

- `diffFileOrder(plans: ResourcePlan[]): string[]` — modified fsPaths in list
  order (asserts ordering == file-list order).
- `computeNavTarget(index: number, count: number, direction: 1 | -1): { index: number; atEdge: boolean }`
  — clamp + edge detection (asserts next-at-end / prev-at-start no-op).
- `indexOfFsPath(files: { fsPath: string }[], fsPath: string | undefined): number`
  — pointer reconciliation, and the basis for the multi-builder-isolation test
  (two independent session objects, each resolves its own index).

## Files to Change

- `packages/vscode/src/commands/view-diff.ts`
  - Swap `vscode.changes` → `_workbench.openMultiDiffEditor` with explicit
    `codev-multidiff:/<builderId>` source URI (~line 378-382).
  - Add the nav-session store + `navigateDiff(direction)` + the three pure
    helpers. (Could live in a new `packages/vscode/src/commands/diff-nav.ts` if
    `view-diff.ts` gets crowded — decided at implementation time; leaning to keep
    it in `view-diff.ts` since it shares the resource-building seam.)
- `packages/vscode/src/extension.ts`
  - Register `codev.diffNextFile` / `codev.diffPreviousFile` via `reg(...)`
    (CLI-independent; they operate on editor state, not Tower) near the existing
    `codev.viewDiff` registration (~line 838).
- `packages/vscode/package.json`
  - Two `contributes.commands` entries. No `keybindings` entries.
- `packages/vscode/src/__tests__/diff-nav.test.ts` (new)
  - Unit tests for the three pure helpers (ordering, edge no-op, isolation).
- `packages/vscode/src/__tests__/contributes-commands.test.ts`
  - Extend to assert the two new commands are declared (mirrors existing pattern).
- `packages/vscode/CHANGELOG.md` + `docs/releases/UNRELEASED.md`
  - Per-PR changelog accumulation (this is a vscode-relevant change).

No `codev-skeleton/` mirror: the VSCode extension is a published package, not a
skeleton-mirrored framework file, so the dual-tree rule does not apply here.

## Plan-Gate Decisions

The issue locks five design calls at plan-approval. My recommendations:

1. **Default keybindings** → **None (palette-only) + documentation.** Smallest
   blast radius; no risk of clobbering a reviewer's existing bindings. Heavy
   users bind `j`/`k` (or Alt+J/K) themselves via `keybindings.json`. *(issue's
   stated lean)*
2. **Edge behavior** → **status-bar message + no wrap.** Wrapping invites
   accidental loops; silent no-op feels broken. *(issue's stated lean)*
3. **Scope resolution** → **per-diff-session (Codev View Diff only) for v1.**
   Generic any-diff-editor mode is a follow-up. *(issue's stated lean)*
4. **File-list pane collapsed/hidden** → **commands still work.** Reveal targets
   the editor, not the pane; pane visibility is a display preference. *(issue's
   stated lean)*
5. **Restore last-viewed file across re-opens** → **out of scope; always open at
   first file.** *(issue's stated lean)*

I concur with all five leans; calling them out explicitly so the gate can
confirm rather than infer.

## Risks & Alternatives Considered

- **Risk: `_workbench.openMultiDiffEditor` is an internal (underscore) command.**
  It's undocumented and could change across VSCode versions. Mitigations: (a)
  it's the same family the public `vscode.changes` already delegates into
  (`_workbench.changes`), and is widely used by VSCode's own SCM/timeline UI, so
  it's de-facto stable; (b) the migration is the *only* way to get programmatic
  file reveal — the public surface has no equivalent; (c) wrap the call so a
  throw degrades gracefully (navigation no-ops with a status message rather than
  breaking View Diff). I'll pin the engine expectation in a code comment.
- **Risk: migrating the working `viewDiff` open path (regression surface).**
  `vscode.changes` takes `[resource, original, modified]` triples and uses the
  first (a `file:` URI) for the file-list label; `_workbench.openMultiDiffEditor`
  takes `{originalUri, modifiedUri}` and derives the label from the modified
  side. For **deleted** files the modified side is a `codev-diff:` empty
  placeholder, so the list entry's *icon* may render generically instead of by
  file type (the path/label is still correct). This is cosmetic; I'll verify it
  at the dev-approval gate and, if it regresses noticeably, evaluate a
  file-typed placeholder URI. All other statuses (A/M/R/C) keep a `file:`
  modified URI → unchanged.
- **Alternative: keep `vscode.changes`, build file-nav on `goToNextChange`.**
  Rejected — it's hunk-granular; emulating file-granular by calling it in a loop
  until the active file changes overshoots and is fragile.
- **Alternative: per-file `vscode.diff` instead of the multi-diff editor.**
  Rejected — changes the established View Diff UX (single multi-file editor with
  a file list) the issue explicitly builds on.
- **Alternative: store the source URI from the existing `vscode.changes` open.**
  Impossible — that URI is randomly synthesized and not exposed.

## Test Plan

### Unit (`diff-nav.test.ts`, vitest)
- `diffFileOrder` returns modified fsPaths in plans order (ordering ==
  file-list order).
- `computeNavTarget`: mid-list advances/retreats by one; at last index + forward
  → `atEdge: true`, index unchanged; at index 0 + backward → `atEdge: true`.
- `indexOfFsPath`: resolves a file's index; returns -1 for an unknown path; two
  independent session objects each resolve against their own `files` (multi-
  builder isolation).
- `contributes-commands.test.ts`: both new command ids are declared with titles.

### Manual (dev-approval gate — the load-bearing verification)
- Spawn/identify two builders with non-trivial multi-file diffs.
- `codev.viewDiff` on builder A; run `codev.diffNextFile` repeatedly → editor
  walks A's files in list order; at the last file → status-bar "Last file…",
  no wrap. `codev.diffPreviousFile` walks back; at first → "First file…".
- Confirm focus stays in the diff editor (not stolen by the file list) and that
  it works with the file-list pane collapsed.
- Confirm within-file F7 / Shift+F7 hunk navigation still works unchanged.
- Open builder B's View Diff; navigate → B's own file list/pointer, independent
  of A (isolation). Switch back to A's tab, navigate → resumes A's pointer.
- Sanity-check the existing View Diff still renders correctly post-migration
  (added/modified/renamed/deleted/binary files, correct labels/icons).
