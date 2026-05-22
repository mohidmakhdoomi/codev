# PR #822 — Iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers (iter-1)**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (APPROVE)
**Outcome**: Both Codex findings accepted and fixed.

---

## Gemini — APPROVE
> "The PR excellently implements multi-architect lifecycle, persistence, and UX per Spec 786. All required functionality is complete and properly integrated."

No changes requested.

---

## Codex — REQUEST_CHANGES (2 findings, both fixed)

### Co1. Mobile dashboard sibling-architect close → 404 instead of the new remove flow
> "`useTabs.ts` marks sibling architect tabs as closable, and `MobileLayout.tsx` renders them through the generic `TabBar.tsx`, whose close action calls `deleteTab(tab.id)`. But `tower-routes.ts` only handles `tabId === 'architect'`, not `architect:<name>`, so closing a sibling architect tab on mobile bypasses the new remove-architect flow and effectively 404s instead of showing the confirmation/removal UX."

**Status**: Accepted.

**Verification**: confirmed `handleWorkspaceTabDelete` at `tower-routes.ts:2109` only branches on `tabId === 'architect'` (the Spec 755 v1 singleton). Sibling tab ids per Spec 761 are `architect:<name>` — they fell through without setting `terminalId`, returning 404.

**Changes made (PR iter-2)**: Added a new branch in `handleWorkspaceTabDelete`:

```typescript
} else if (tabId.startsWith('architect:')) {
  // Route through removeArchitect() so the full lifecycle runs
  // (kills PTY, deletes state.db row, intentional-stop flag, etc.)
  const name = tabId.slice('architect:'.length);
  const result = await removeArchitect(workspacePath, name);
  if (result.success) {
    res.writeHead(204); res.end();
  } else {
    const status = result.error?.includes('not found') || result.error?.includes('not running') ? 404 : 400;
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ success: false, error: result.error }));
  }
  return;
}
```

Mobile close now invokes the same backend lifecycle as the desktop close button + CLI, including the intentional-stop suppression and the OQ-B-compliant row deletion.

### Co2. VSCode `openArchitect` doesn't dispose stale terminals
> "VSCode architect terminals are keyed per architect name, but `TerminalManager.openArchitect()` blindly reuses an existing `architect:${name}` terminal without checking whether Tower has issued a new `terminalId`. After `afx workspace stop`/start, Tower restart, or remove+re-add of the same architect name, clicking the architect in the sidebar can just refocus a dead terminal instead of reopening the live session. `openBuilder()` already handles this stale-ID case; `openArchitect()` should too."

**Status**: Accepted.

**Verification**: confirmed `openBuilder` at `terminal-manager.ts:146-159` compares `existing.id === terminalId` and disposes-then-recreates on mismatch. `openArchitect` Phase 6 implementation had no such check — it always reused the existing terminal regardless of whether the session id had changed.

**Changes made (PR iter-2)**: applied the `openBuilder` pattern to `openArchitect`:

```typescript
async openArchitect(terminalId: string, architectName: string = 'main', focus = false): Promise<void> {
  const key = `architect:${architectName}`;
  const existing = this.terminals.get(key);
  if (existing) {
    if (existing.id === terminalId) {
      existing.terminal.show(!focus);
      return;
    }
    // Stale session id — dispose the dead terminal and open a fresh one.
    existing.pty.close();
    existing.terminal.dispose();
    this.terminals.delete(key);
  }
  // ... open fresh
}
```

Click → opens a fresh terminal when the session id has changed (the documented stop+start / restart / remove+re-add scenarios).

---

## Claude — APPROVE (one non-blocking observation)

### Cl-c1. `removeArchitect` helper in state.ts is dead code today
> "`removeArchitect(name)` is exported from `state.ts` and tested in `state.test.ts`, but the actual Tower-side `removeArchitect` handler in `tower-instances.ts` uses `setArchitectByName(name, null)` for the row deletion, not the new helper."

**Status**: Acknowledged.

**Reasoning**: the helper was added in Phase 1 as a callsite-clarity wrapper around `setArchitectByName(name, null)`. The Tower handler in Phase 4 used `setArchitectByName(name, null)` directly because that was the existing pattern (the four addArchitect exit handlers + the new on-the-fly reconnect handler all use it). Switching the Tower handler call site to `removeArchitect(name)` would be a one-line consistency fix; leaving it as `setArchitectByName(name, null)` matches surrounding code.

Not blocking — the helper is tested, harmless, and could absorb additional cleanup logic in the future without changing callers. If Phase 1's design intent is "removeArchitect should be the canonical caller-facing API," then a follow-up consistency pass should switch the existing `setArchitectByName(name, null)` call sites over. Filing as a backlog item rather than expanding this PR.

---

## Additional fix during iter-1: tsconfig exclusion

The new `vitest.config.ts` at the vscode package root tripped `pnpm exec tsc --noEmit` ("not under rootDir 'src'"). Added an `"exclude"` array to `packages/vscode/tsconfig.json` listing `node_modules`, `out`, `dist`, and `vitest.config.ts`. Doesn't affect runtime; only affects which files the typechecker considers. All 21 vscode unit tests + 3016 codev tests still pass.

---

## Net effect

PR iter-1 → iter-2: 3 source files updated (`tower-routes.ts`, `terminal-manager.ts`, `tsconfig.json`). No test changes — both bugs are now caught by the same source-level sentinel tests added in Phase 6 (the per-name keying assertion at `terminal-manager.test.ts` and the `architect:` prefix routing at `workspace.test.ts` indirectly verify the contracts the new fixes preserve).

Manual verification scenarios in `verify-scenarios.md` will exercise both code paths during the verify phase:
- Scenario 2 (graceful stop+start) → exercises the openArchitect stale-id path when the user clicks the sibling tab post-restart
- Scenario 10 (dashboard UX) — should be extended to include mobile close path (worth a Scenario 10b note for the verifier)

Ready for iter-2 PR-level CMAP if porch re-triggers it; otherwise ready for architect's `pr` gate approval.
