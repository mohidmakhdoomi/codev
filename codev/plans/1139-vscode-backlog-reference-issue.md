# PIR Plan: Backlog "Reference issue in architect" honors the QuickPick selection

## Understanding

In a multi-architect workspace, clicking the inline "Reference issue in architect" button on a Backlog row shows a QuickPick to choose the target architect, but the reference text is always injected into `architect:main` regardless of the pick. The picker is effectively a no-op for the injection. Single-architect workspaces are unaffected.

Root cause (verified against the current source):

1. `codev.openArchitectTerminal` (`packages/vscode/src/extension.ts:751`) resolves the target architect (explicit arg → QuickPick when >1 architects → default `'main'`) into a local `targetName` and opens that terminal. The handler returns nothing, so the resolution is lost to callers.
2. `codev.referenceIssueInArchitect` (`extension.ts:1019`) awaits `executeCommand('codev.openArchitectTerminal')` (which may run the picker), then calls `injectArchitectText(text)` with no architect name (`extension.ts:1029`).
3. `injectArchitectText` (`packages/vscode/src/terminal-manager.ts:146`) defaults `architectName` to `'main'` (a deliberate Spec 786 Phase 6 choice, before the Issue 841 Gap 2 picker existed), so injection always keys `architect:main`.
4. `codev.referencePRInArchitect` (`extension.ts:1034`, the PR-sidebar mirror per #1043) has the identical shape at `extension.ts:1039`.

Two independently-correct changes (786 Phase 6's default, 841 Gap 2's picker) crossed wires: the picker's selection is used for "which terminal to open" but never for "which terminal to inject into".

## Proposed Change

Follow the fix sketch from the issue — two surgical changes plus a docstring cleanup:

1. **`codev.openArchitectTerminal` returns the resolved architect name** (`string | undefined`):
   - Success path (terminal found and opened): return `targetName`.
   - All failure paths return `undefined`: not connected, picker dismissed, no matching architect (warning shown), and the catch block.
   - The `reg` helper (`extension.ts:732`) passes handler return values straight to `registerCommand`, so `executeCommand<string | undefined>(...)` receives the value with no plumbing changes.
   - The single-architect path also returns the resolved name (`'main'`), so callers rely on the return value uniformly.

2. **Both reference commands pass the resolved name through**:
   - `codev.referenceIssueInArchitect`: capture `const resolvedName = await vscode.commands.executeCommand<string | undefined>('codev.openArchitectTerminal')`. If `resolvedName` is undefined (picker cancelled or open failed), return without injecting — the open path already surfaced its own error/warning where one is warranted, and a picker cancel is a deliberate user action that should be silent. Otherwise call `injectArchitectText(text, resolvedName)`.
   - `codev.referencePRInArchitect`: same change.
   - The existing "Codev: Architect terminal not available" warning stays for the residual case where open succeeded but the terminal lookup misses.

3. **Docstring cleanup** at `terminal-manager.ts:139-144`: remove the "the Backlog button always targets `main` regardless of how many sibling architects exist" claim, note that reference-injection callers now pass the picker-resolved name, and that the `'main'` default remains for name-less callers. No behavior change in this file.

## Files to Change

- `packages/vscode/src/extension.ts:751-803` — `codev.openArchitectTerminal` handler returns `targetName` on success, `undefined` on every early-out (not connected, picker dismissed, architect not found, catch).
- `packages/vscode/src/extension.ts:1019-1033` — `codev.referenceIssueInArchitect` captures the returned name; skips injection when undefined; passes the name to `injectArchitectText`.
- `packages/vscode/src/extension.ts:1034-1043` — `codev.referencePRInArchitect` same change.
- `packages/vscode/src/terminal-manager.ts:133-145` — docstring only: drop the "always targets main" design claim, document the new caller contract.
- `packages/vscode/src/__tests__/extension-architect-commands.test.ts:145-159` — replace the "no name → defaults to 'main'" sentinel (which documents the old behavior) with assertions that (a) the resolved name is captured from `executeCommand` and passed as the second arg to `injectArchitectText`, and (b) injection is skipped when the resolved name is undefined. Add an assertion on the `codev.openArchitectTerminal` block that it `return targetName` on success (the new contract callers depend on).
- `packages/vscode/src/__tests__/reference-pr-in-architect.test.ts` — add the mirrored assertions for `codev.referencePRInArchitect` (resolved name passed through, no-inject on undefined).

Note on test style: this suite is deliberately source-level sentinel tests (reading `extension.ts` as text) because activating the extension requires mocking the whole `vscode` module. The updated tests keep that pattern — they anchor on the new source shape (`injectArchitectText(buildArchitectReferenceInjection(...), resolvedName)` and the early return) rather than executing the handlers.

## Risks & Alternatives Considered

- **Risk: double-picker UX.** None introduced — the picker still runs at most once, inside `openArchitectTerminal`; the reference commands only consume its result.
- **Risk: other callers of `codev.openArchitectTerminal` observing a new return value.** Verified all in-repo invokers: the two reference commands (`extension.ts:1028`, `extension.ts:1038`) are the only `executeCommand` call sites; the Workspace view row (`views/workspace.ts:287`) and the Builders architect-group header (`views/builders.ts:317`) invoke via TreeItem `command` bindings with an explicit name and ignore the return; the command-relay mapping (`command-relay.ts:53`) likewise ignores it. Returning a value is additive for all of them.
- **Risk: behavior change on failure.** Previously a failed/cancelled open still attempted injection and produced the "Architect terminal not available" warning. After the fix a cancelled picker exits silently. This is intentional (cancel is a deliberate user action) and matches the issue's fix sketch ("When the user cancels the picker, do not inject").
- **Alternative: have `injectArchitectText` itself resolve "the last opened architect".** Rejected — introduces hidden state in the terminal manager and breaks the single-source-of-truth resolution that already lives in `openArchitectTerminal`.
- **Alternative: duplicate the picker logic in the reference commands.** Rejected — two pickers to keep in sync; the return-value approach reuses the existing resolution untouched.
- **Out of scope** (per the issue): the single-architect default behavior, PR sidebar semantics beyond the mirror injection, other Backlog inline actions, and the sibling `afx workspace recover` attribution bug.

## Test Plan

- **Unit** (`pnpm --filter codev-vscode test`, or vitest from `packages/vscode/`):
  - Updated sentinel: `codev.referenceIssueInArchitect` passes the resolved architect name as the second argument to `injectArchitectText`, and early-returns when the resolved name is undefined.
  - New sentinel: `codev.openArchitectTerminal` returns `targetName` on the success path.
  - Mirrored sentinels for `codev.referencePRInArchitect`.
  - Full existing suite passes (notably `extension-architect-commands.test.ts`, `reference-pr-in-architect.test.ts`, `terminal-manager.test.ts`).
- **Manual** (at the dev-approval gate, in a workspace with ≥2 architects):
  1. Click the "Reference issue in architect" inline button on a Backlog row → QuickPick appears → pick a non-main architect → verify the reference text (`#<id> "<title>" `) lands in *that* architect's terminal input, focused, not submitted.
  2. Same flow, pick `main` → text lands in main.
  3. Same flow, press Escape on the picker → no injection, no warning toast.
  4. Repeat 1 with the PR sidebar's reference button → same routing.
  5. Single-architect workspace: button injects into main with no picker (unchanged).
