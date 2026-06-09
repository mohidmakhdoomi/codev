# PIR Plan: Inject file/hunk reference into builder PTY from the unified-diff editor (codelens)

## Understanding

Reviewing a builder's changes is a per-file retype loop: open `codev.viewDiff`, read a file, switch to the builder terminal, manually retype the file path (and line numbers), add feedback, submit. The path-retyping is the bottleneck.

The fix mirrors the proven `codev.referenceIssueInArchitect` pattern (`extension.ts:785`): an inline action injects a reference token into a terminal's prompt buffer **without** pressing Enter, then the human types their feedback and submits. That command targets the *architect* terminal with `#<id> `; we want the same mechanic targeting the *builder* terminal with a file/hunk reference, surfaced as CodeLenses inside the diff editor `codev.viewDiff` opens.

Key facts established from the code:

- `codev.viewDiff` (`commands/view-diff.ts:301`) opens VSCode's multi-file diff editor via `vscode.changes`. For each changed file the **right** (modified) side is a plain `file:` URI at `<worktreePath>/<repoRelPath>` (added/modified/renamed); deleted/binary right sides are `codev-diff:` placeholders. The right side carries the new-side line numbers we need.
- `getBuilderChanges(wt)` (`view-diff.ts:261`) already resolves `defaultBranch`, the merge-base `baseRef`, the `ChangeEntry[]`, and the binary-path set — everything except the per-file hunk line ranges.
- `terminal-manager.ts` has `injectArchitectText(text)` (`:146`): look up `architect:<name>` terminal, `show()`, `sendText(text, false)` (no newline). There is no builder equivalent yet. `openBuilderByRoleOrId(roleOrId, focus)` (`:192`) resolves a builder and opens/reveals its terminal, but returns `void` and resolves `roleOrId` → a *canonical* `builder.id` that may differ from the input (e.g. `153` → `builder-spir-153`); the terminal is keyed `builder-<canonical-id>`.
- `buildArchitectReferenceInjection` (`architect-reference-injection.ts`) is the pure, unit-tested string builder precedent — palette-hidden command, no `vscode` import, tested in `__tests__/architect-reference-injection.test.ts`.
- Palette suppression: a command is kept out of the Command Palette either by a `commandPalette` `when:"false"` entry (e.g. `referenceIssueInArchitect`, `openBuilderFileDiff`) **or** by not declaring it in `contributes.commands` at all. CodeLens-backing commands are invoked programmatically and need no package.json declaration; no test enforces registered-vs-declared parity.

## Proposed Change

Add a `CodeLensProvider` that renders inject actions on the **right-side `file:` documents** shown in the multi-file diff editor, plus the builder-terminal injection plumbing.

**1. Pure helpers (new file `packages/vscode/src/diff-inject-ref.ts`, no `vscode` import — mirrors `architect-reference-injection.ts`):**
- `parseHunkRanges(patch: string): Array<{ newStart: number; newEnd: number }>` — parse `@@ -a,b +c,d @@` headers from a single file's unified diff. New-side start = `c`; length = `d` (absent → 1). `newEnd = newStart + max(length, 1) - 1`. A pure-deletion hunk (`+c,0`) clamps to a single anchor line at `c` (or `c+1`), so a click still references a sane location.
- `buildBuilderFileRef(relPath): string` → `` `${relPath} ` `` (trailing space, no Enter).
- `buildBuilderHunkRef(relPath, start, end): string` → `` `${relPath}:L${start}-L${end} ` ``.

**2. CodeLens provider (new file `packages/vscode/src/diff-inject-codelens.ts`):**
- `DiffInjectCodeLensProvider implements vscode.CodeLensProvider`, holding a registry `Map<fsPath, { builderId, relPath, hunks }>` and an `onDidChangeCodeLenses` emitter.
- `provideCodeLenses(document)`: look up `document.uri.fsPath`. If present, emit one **file-level** lens (range at line 0) titled `Send to builder PTY` and one lens **per hunk** (range at `newStart-1`) titled `Send to builder PTY (lines <start>-<end>)`. Each lens's `command` is `codev.injectBuilderFileRef` with args `[builderId, refText]`.
- `setSession(entries)` replaces the registry (one active diff session per `viewDiff` invocation) and fires the change event; provider registered once at activation for `{ scheme: 'file' }`.

**3. `viewDiff` populates the registry:** after `getBuilderChanges`, run one `git -C <wt> diff -M --unified=3 <baseRef>` (full multi-file patch), split it per file on `diff --git`, map each file's hunks to its new path, and call `provider.setSession(...)` keyed by the right-side fs path (`path.join(wt, resourcePath)`) before opening the editor. Deleted/binary files are skipped (no right-side file document). This is one extra git call alongside the two `getBuilderChanges` already runs.

**4. `terminal-manager.ts`:**
- Add `injectBuilderText(builderId, text): boolean` — look up `builder-<builderId>`, `show()`, `sendText(text, false)`; return false if absent (exact mirror of `injectArchitectText`).
- Change `openBuilderByRoleOrId` to **return** the resolved canonical `builder.id` (`Promise<string | undefined>`); existing callers ignore the return (non-breaking). This closes the id-mismatch gap so the inject targets the same terminal key that was opened.

**5. `extension.ts`:** register `codev.injectBuilderFileRef` via the existing `reg(...)` helper, **without** declaring it in `contributes.commands` (palette-hidden by omission). Handler:
```ts
reg('codev.injectBuilderFileRef', async (builderId: string, text: string) => {
  const resolvedId = await terminalManager?.openBuilderByRoleOrId(builderId, true); // open + focus, fallback flow
  const ok = resolvedId ? terminalManager?.injectBuilderText(resolvedId, text) : false;
  if (!ok) { vscode.window.showWarningMessage('Codev: Builder terminal not available'); }
});
```
`openBuilderByRoleOrId` already contains the "no active terminal" recovery flow (`promptNoTerminalRecovery`), satisfying the fallback acceptance criterion. Wire provider registration through a new `activateDiffInjectCodeLens(context)` called alongside `activateDiffView(context)`.

## Files to Change

- `packages/vscode/src/diff-inject-ref.ts` — **new**: pure helpers `parseHunkRanges`, `buildBuilderFileRef`, `buildBuilderHunkRef`.
- `packages/vscode/src/diff-inject-codelens.ts` — **new**: `DiffInjectCodeLensProvider` + `activateDiffInjectCodeLens(context)` returning the provider instance (so `viewDiff` can populate it).
- `packages/vscode/src/commands/view-diff.ts:261` / `:301` — fetch + parse the per-file patch in `getBuilderChanges` (or a sibling helper) and call `provider.setSession(...)` in `viewDiff` before `vscode.changes`.
- `packages/vscode/src/terminal-manager.ts:146` (add `injectBuilderText`), `:192` (return resolved id from `openBuilderByRoleOrId`).
- `packages/vscode/src/extension.ts:806` area — register `codev.injectBuilderFileRef`; call `activateDiffInjectCodeLens` near `activateDiffView` (`:884`); hold the provider so `viewDiff` reaches it (pass via the command registration / a module singleton, matching `view-diff`'s existing module-level `provider`).
- `packages/vscode/src/__tests__/diff-inject-ref.test.ts` — **new**: unit tests for hunk parsing + ref builders.

## Risks & Alternatives Considered

- **Primary risk — CodeLenses may not render inside `vscode.changes` (the multi-file diff editor).** CodeLens providers are document-scoped, and the multi-diff editor embeds standard diff editors; lenses normally render on the modified side, but multi-diff embedding has historically had gaps. **This is exactly what the `dev-approval` gate validates** — the reviewer runs the worktree and confirms lenses appear. Fallback if they don't render in the multi-diff editor: surface the same lenses in the per-file `vscode.diff` editor (`codev.openBuilderFileDiff`), which definitively renders CodeLenses — same provider, same registry, narrower entry point. I'll flag the outcome explicitly at the gate.
- **Over-trigger:** because the provider matches `{ scheme: 'file' }`, lenses also appear if the reviewer opens that exact worktree file *normally* (outside the diff) after running `viewDiff`. Accepted as benign — the injected reference is still correct and useful. The registry is replaced per `viewDiff` run, so stale sessions don't accumulate.
- **Id mismatch (builderId in registry vs terminal key):** resolved by returning the canonical id from `openBuilderByRoleOrId` and injecting against *that*, not the raw arg.
- **Deleted files:** no right-side `file:` document, so no lenses — you can't reference new lines of a deleted file. Acceptable and out of the issue's intent.
- **Alternative rejected — render lenses on the left `codev-diff:` side** (fully scoped to the diff editor, never over-triggers): rejected because the left side holds *old* content with old-side line numbers and is empty for added files, so it can't carry new-side hunk ranges.
- **Alternative rejected — replace the side-by-side editor with a single unified-diff text document** (file/hunk headers literally in text): rejected as a UX regression — reviewers rely on the side-by-side multi-file editor, and the issue asks to add lenses *to the existing `viewDiff` editor*, not replace it.

## Test Plan

**Unit (`diff-inject-ref.test.ts`, vitest — `pnpm --filter codev-vscode test:unit`):**
- `parseHunkRanges` on a multi-hunk patch → correct new-side `{newStart,newEnd}` per hunk; single-line hunk (`@@ -10 +11 @@`) → `{11,11}`; pure-deletion hunk (`+c,0`) clamps to one line; multiple files isolated correctly after the per-file split.
- `buildBuilderFileRef('a/b.ts')` → `'a/b.ts '`; `buildBuilderHunkRef('a/b.ts', 10, 20)` → `'a/b.ts:L10-L20 '`.

**Manual (at the `dev-approval` gate — the reviewer runs the worktree):**
1. `pnpm build` the vscode package; launch the Extension Development Host (or sideload).
2. With a builder that has changes, run **Codev: View Diff**.
3. Confirm a `Send to builder PTY` lens appears above each file and a `Send to builder PTY (lines N-M)` lens above each hunk. **(Validates the primary risk.)**
4. Click a file lens → builder terminal is revealed/focused and `<repo-relative-path> ` is typed into the prompt with **no Enter**.
5. Click a hunk lens → `<repo-relative-path>:L<start>-L<end> ` typed, no Enter; line range matches the hunk's new-side range.
6. Confirm `codev.injectBuilderFileRef` does **not** appear in the Command Palette.
7. Close the builder terminal, click a lens → the no-terminal recovery flow opens the terminal, then injects.

**Build/CI:** `pnpm --filter codev-vscode check-types`, `pnpm --filter codev-vscode lint`, and `pnpm --filter codev-vscode test:unit` must pass.
