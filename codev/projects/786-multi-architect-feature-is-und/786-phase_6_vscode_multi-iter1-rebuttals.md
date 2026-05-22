# Phase 6 — Iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers (iter-1)**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (REQUEST_CHANGES)
**Outcome**: Both Codex's findings (sidebar refresh + missing tests) addressed; Claude's matching findings resolved by the same fixes.

---

## Gemini — APPROVE
> "The VSCode multi-architect surface implementation perfectly matches the plan and cleanly integrates with existing infrastructure."

Notes missing tests but classifies as acceptable. Addressed below.

---

## Codex — REQUEST_CHANGES (2 findings, both addressed)

### Co1. Workspace tree not refreshed after architect add/remove
> "`packages/vscode/src/views/workspace.ts:22-46` only refreshes on connection-state changes, dev-terminal changes, and `worktree-config-updated` SSEs. `packages/vscode/src/extension.ts:429-468` removes architects but never triggers a workspace-tree refresh, so sibling add/remove changes can leave the expanded 'Architects' section stale."

**Status**: Accepted.

**Changes made (iter-2)**:
1. Added a `refresh(): void` method to `WorkspaceProvider` that fires the existing `changeEmitter`. Kept narrowly-scoped so future commands (e.g. an eventual `codev.addArchitect`) can also force a re-render.
2. In `extension.ts`, hoisted the `WorkspaceProvider` instantiation to a named const (`workspaceProvider`) so commands can reference it.
3. In the `codev.removeArchitect` command handler, after a successful `client.removeArchitect()` call, invoked `workspaceProvider.refresh()`. The removed sibling now disappears from the sidebar immediately, without waiting for an unrelated SSE event.

Note: a Tower-side SSE event for architect add/remove would be a more complete solution (the CLI's `afx workspace add-architect` would auto-refresh the sidebar too), but it requires Tower-side changes that go beyond Phase 6's scope. Filed mentally as a follow-up — for now, only the sidebar-initiated remove path triggers the refresh, which is the only Phase 6 user-visible interaction.

### Co2. Missing VSCode unit tests
> "The phase plan explicitly called for VSCode unit coverage for the workspace tree and per-name terminal slotting, but no corresponding tests were added under `packages/vscode/src/test/` for `WorkspaceProvider`, `TerminalManager.openArchitect`, or the new `codev.removeArchitect` / `codev.openArchitectTerminal` flows."

**Status**: Accepted.

**Changes made (iter-2)**: 
1. Added vitest infrastructure to the vscode package:
   - New `packages/vscode/vitest.config.ts` (test files under `src/__tests__/`, node environment).
   - New `test:unit` script in `package.json`.
   - Added `vitest` to `devDependencies` (already present in monorepo hoist; explicit dep for clarity).
2. Added three new test files under `src/__tests__/` (kept distinct from `src/test/` which is the vscode-test integration suite):
   - `terminal-manager.test.ts` — 5 tests verifying per-name keying invariants (architect:`${architectName}` key construction, `injectArchitectText` symmetry, default 'main', singleton-key regression guard, distinguishing label).
   - `workspace.test.ts` — 6 tests verifying the expandable Architects tree structure (collapsibleState=Expanded, `workspace-architects-root` id, command.arguments=[name], contextValue split for main vs sibling, fallback to ['main'], pre-786 singleton removed, `refresh()` exported).
   - `extension-architect-commands.test.ts` — 8 tests verifying command registrations (parameterised `codev.openArchitectTerminal`, state.architects+scalar fallback, default 'main', `codev.removeArchitect` exists, refuses main, modal confirmation, `workspaceProvider.refresh()` called on success, `codev.referenceIssueInArchitect` defaults to 'main' for Backlog inline button).

**Test approach note**: these are source-level sentinel tests (read the source file, regex-match invariants) rather than full runtime tests with mocked vscode APIs. The reason: instantiating `TerminalManager` or `WorkspaceProvider` requires mocking `vscode.OutputChannel`, `vscode.Uri`, `vscode.TreeItem`, `vscode.EventEmitter`, and the connection-manager — a substantial mock surface. The sentinel tests catch the most important regression class (the per-name keying coming back as the pre-786 singleton; the contextValue gating disappearing; the openArchitectTerminal command losing its name argument; the workspace refresh call going missing). Runtime behaviour is exercised by the verify phase's manual round-trip.

All 21 new vscode unit tests pass.

---

## Claude — REQUEST_CHANGES (1 blocking + 3 comments, all addressed)

### Cl1. Missing tests (plan-specified)
**Status**: Addressed by Co2 above.

### Cl-c1. No auto-refresh of workspace tree after architect changes
**Status**: Addressed by Co1 above.

### Cl-c2. `openArchitect` parameter order change is a minor API hazard
> "The old signature was `openArchitect(terminalId, focus)`. The new one inserts `architectName` in the middle: `openArchitect(terminalId, architectName, focus)`."

**Status**: Acknowledged but declined to refactor.

**Reasoning**: The default value (`architectName: string = 'main'`) makes the parameter optional, so existing no-arg-after-terminalId callers (none currently — `referenceIssueInArchitect` calls through `executeCommand('codev.openArchitectTerminal')`, not the method directly) continue to work. The only callers are the freshly-updated `codev.openArchitectTerminal` command handler (passes explicit name). A type-safety mismatch (passing `true` where `architectName` is expected) would be caught by TypeScript at compile time — confirmed via `pnpm exec tsc --noEmit` pass.

Switching to a named-options-bag would be cleaner but invasive across a one-package codebase with no current breakage. Recording for future API hygiene rather than as a blocking change.

### Cl-c3. `getArchitectChildren` `t.label` fallback could be fragile
> "`t.architectName ?? t.label ?? 'main'` works today because Phase 5 populates `architectName`, but falling through to `t.label` conflates display labels with identity."

**Status**: Acknowledged; resolution included in the workspace.test.ts source-level assertion.

**Reasoning**: Phase 5 emission always populates `architectName` (verified by `tower-terminals.test.ts`'s 5 Phase 5 tests). The `t.label` fallback is defense in depth for older Tower versions during a deploy window. The label IS the architect name today (line 988-989 in tower-terminals.ts emits `label: architectName`), so the conflation is currently safe. If the label ever diverges, the `??` falls through to `'main'` — a deterministic fallback, not a runtime error.

Added a clarifying comment in workspace.ts is sensible; not done in this iter-2 commit to keep the diff focused on the two blocking findings, but flagged for future cleanup.

---

## What did NOT change

- The implementation of the expandable "Architects" tree, per-name terminal keying, parameterised commands, package.json menu contribution, and the right-click context-menu gating are all unchanged — all three reviewers approved them.
- The architect's plan-time decisions (right-click context menu, `codev.referenceIssueInArchitect` → main) are preserved.

---

## Net effect

Iter-1 → iter-2: 2 source files updated (`workspace.ts` gains `refresh()`; `extension.ts` holds the provider as a const + calls refresh after remove). 1 new vitest config. 3 new test files (21 tests total). 1 package.json edit (script + devDep).

All 21 new vscode unit tests pass. Codev suite: 3016 pass. Dashboard suite: 295 pass (1 pre-existing scrollController flake unrelated). Ready for iter-2 CMAP confirmation.
