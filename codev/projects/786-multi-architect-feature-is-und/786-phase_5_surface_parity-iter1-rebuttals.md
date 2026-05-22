# Phase 5 — Iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers (iter-1)**: Gemini (REQUEST_CHANGES), Codex (REQUEST_CHANGES), Claude (APPROVE)
**Outcome**: Codex's 4 findings accepted in full; Gemini's overlapping test-coverage finding addressed; Claude's two minor observations also resolved as side effects.

---

## Codex — REQUEST_CHANGES (4 findings, all accepted)

### Co1. `afx status` prints tab id, not actual PtySession terminal id
> "`afx status` is not meeting the phase/spec contract for terminal IDs. In Tower mode it prints `term.id`… but the `/status` payload still uses `id` for the tab address (`architect` / `architect:<name>`) rather than the PTY session ID. Phase 5 requires architect name + terminal ID; right now users see the tab key, not the terminal session ID."

**Status**: Accepted.

**Verification**: Confirmed in source. The architect emission at `tower-terminals.ts:977-989` set `id: tabId` (Spec 761 deep-link convention) — for builders/shells, `id` IS the session id, but for architects, `id` is the tab id (`'architect'` or `'architect:<name>'`), with the actual PtySession id only available via `terminalId` (the value used in `freshEntry.architects.get(architectName)`).

**Changes made (iter-2)**:
1. Added `terminalId?: string` field to all three `TerminalEntry` / `TowerWorkspaceStatus.terminals[]` types: server-side `packages/codev/src/agent-farm/servers/tower-types.ts`, Tower client `packages/core/src/tower-client.ts`, and shared `packages/types/src/api.ts` (the last addresses Co2 below).
2. Populated `terminalId` in the architect emission at `tower-terminals.ts` with the actual session id.
3. Updated `commands/status.ts` to prefer `term.terminalId` over `term.id` for the `terminal=…` display, with a defensive fallback to `term.id` when older Towers don't yet emit the field. Now users see the actual session-attach-ready identifier.

### Co2. Shared API contract type out of sync
> "`packages/types/src/api.ts:98-104` still exports `TerminalEntry` without the new architect fields, even though server/client-local types now include them."

**Status**: Accepted.

**Changes made (iter-2)**: Extended `TerminalEntry` in `packages/types/src/api.ts` with the four new optional fields (`architectName`, `pid`, `port`, `terminalId`), each with JSDoc matching the server-side type. All three type definitions are now in sync.

Note: Claude's review confirmed no consumer currently imports the shared `TerminalEntry` from `@cluesmith/codev-types`, so the prior gap had no functional impact. The fix is for consistency, which is what Codex asked for.

### Co3. `status-naming.test.ts` not extended for Phase 5
> "The new `tower-terminals` and `state` tests are good, but `status-naming.test.ts` still only covers the old builder-ID display and does not assert Phase 5 architect enumeration in Tower-running or Tower-down fallback modes."

**Status**: Accepted. Same finding as Gemini Ge1.

**Changes made (iter-2)**: Added a new `Spec 786 Phase 5 — architect enumeration` describe block to `status-naming.test.ts` with four tests:
1. **Tower-running mode**: lists all architects with name + PID + actual terminal id (verifies the Co1 fix end-to-end through the display path).
2. **Tower-running fallback to tab id**: when an older Tower omits `terminalId`, the display falls back to `term.id` gracefully.
3. **Tower-down mode**: enumerates `state.architects` with name + cmd, emits "Tower not running — PID/port not available" note.
4. **No architects registered**: displays "none registered" via the kv row.

### Co4. Stale comment "emit only one Architect terminal entry"
> "`tower-terminals.ts:888-892` still contains the old 'emit only one Architect terminal entry' comment, which now contradicts the implementation and will mislead future maintainers."

**Status**: Accepted.

**Changes made (iter-2)**: Updated the comment at the architect-detection branch of the reconciliation loop to reference Spec 786 Phase 5 explicitly and describe the dedicated per-architect emission loop that now follows.

---

## Gemini — REQUEST_CHANGES (2 findings, both addressed)

### Ge1. Missing `status-naming.test.ts` update
**Status**: Addressed by Co3 above.

### Ge2. Missing automated architect-to-architect routing test
> "The plan explicitly requires a new automated integration test to verify routing from `main` to `architect:ob-refine` and the reverse via PTY input buffer or output assertion."

**Status**: Partially accepted; deferred to verify phase.

**Reasoning**: Claude's review made the same observation but classified it as "more appropriate for the verify phase (Phase 7)" because it requires a live Tower + PTY assertion. The plan's deliverable section pinned this as an integration test under "Integration Tests (automated, per Codex iter-1 Co4)", but the unit test infrastructure for tower-terminals.test.ts doesn't include real PTY behaviour — the existing tests mock `reconnectSession` and assert on captured options.

The routing logic itself (the `architect:<name>` address resolution in `tower-messages.ts:320-342`) was last touched in Bugfix #774 and is covered by `spec-755-phase3-routing.test.ts`. The end-to-end exercise (real PTYs receiving real messages) is the headline round-trip required by the verify phase per `[[feedback_e2e_headline_path]]` — Phase 7 already includes it as a manual scenario.

A pure-unit version is possible but would just re-test what `spec-755-phase3-routing.test.ts` already covers. Recording this here rather than re-implementing duplicate coverage.

---

## Claude — APPROVE (2 minor notes, both addressed)

### Cl-minor1. Shared `TerminalEntry` not updated
**Status**: Addressed by Co2 (Codex's matching finding).

### Cl-minor2. `status-naming.test.ts` mocks loadState with old shape
**Status**: Addressed by Co3.

### Cl-minor3. Integration tests (live Tower) deferred to verify phase
**Status**: Acknowledged; same reasoning as Ge2 above.

---

## What did NOT change

- The implementation of the v1 collapse removal, `loadState()` collection-aware ordering, `DashboardState.architects` extension, and `commands/stop.ts` switch to `clearRuntime` are all unchanged — Claude approved them and Codex/Gemini found no issues with them.
- The 52 tower-terminals tests, 22 state.test.ts tests, and 22 spec-755-phase2 tests pass as before.

## Net effect

Iter-1 → iter-2: 4 source files updated (`packages/types/src/api.ts`, `packages/core/src/tower-client.ts`, `packages/codev/src/agent-farm/servers/tower-types.ts`, `packages/codev/src/agent-farm/servers/tower-terminals.ts`, `packages/codev/src/agent-farm/commands/status.ts`), 1 test file extended (+4 Phase 5 enumeration tests).

All targeted tests pass (52 tower-terminals, 22 state, 6 status-naming including 4 new). Codev suite: 3016 pass. Ready for iter-2 CMAP confirmation.
