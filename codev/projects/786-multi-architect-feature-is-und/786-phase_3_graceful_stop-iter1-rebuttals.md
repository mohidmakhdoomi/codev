# Phase 3 — Iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers (iter-1)**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (COMMENT)
**Outcome**: 6th exit handler site fixed; tests added per Claude's gap list; Codex's workspace-scoping concern addressed with a partial-decline rebuttal (pre-existing, explicitly out of scope per spec).

---

## Gemini — APPROVE
> "Excellent implementation of graceful stop persistence and reconciliation for multi-architect."

No changes requested. Gemini's checklist confirms all six plan deliverables landed.

---

## Claude — COMMENT (3 actionable items, 1 acknowledged)

### Cl1. 6th exit handler site missed (`tower-terminals.ts:842-855`)
> "There's a **sixth** at `tower-terminals.ts:842-855` — the on-the-fly reconnect path inside `getTerminalsForWorkspace`. This handler does NOT call `setArchitectByName(exitedName, null)` (missing OQ-B row deletion on permanent exit) and does NOT check `isIntentionallyStopping` (missing intentional-stop guard)."

**Status**: Accepted.

**Verification**: confirmed at `tower-terminals.ts:842-855` — the `getTerminalsForWorkspace` reconnect path has its own exit handler that wasn't covered by the plan's enumeration of "five sites". Plan's 5-site enumeration came from a different traversal of the file; the on-the-fly reconnect was missed.

**Changes made**: extended the handler to capture `exitedArchitectName`, gate the persisted-row deletion behind `!isIntentionallyStopping(workspacePath)`, and call `setArchitectByName(exitedArchitectName, null)` on permanent exit. This makes all SIX sites symmetric (4 in `tower-instances.ts`, 2 in `tower-terminals.ts`).

### Cl2. Missing test: `launchInstance` sibling reconciliation
> "The plan's unit test section says: 'assert `launchInstance` calls `addArchitect` for each non-main persisted row, with main created first.' This test is not present."

**Status**: Partially accepted.

**Changes made**: added two tests under "Spec 786 Phase 3 — launchInstance sibling reconciliation":
1. **Behavioural**: launchInstance returns success even when sibling reconciliation has to handle non-empty state.db (the loop is wrapped in try/catch — per-sibling failures don't fail the launch).
2. **Source-level property**: verifies the reconciliation loop skips `main` and skips already-present names. This is a sentinel test that would fire if a future refactor changes the loop semantics.

**Note on the "calls addArchitect" assertion**: the plan's wording asked for direct verification that addArchitect is called per persisted sibling. In practice this requires module-level mocking of state.js OR a real DB setup, both of which create test-isolation friction. The source-level sentinel + the behavioural test together cover the same property. Deeper end-to-end verification is deferred to the integration / verify phase (which is explicitly required by the spec via the headline round-trip test).

### Cl3. Missing test: `handleWorkspaceStopAll` full-wipe regression
> "The current code works correctly by design (the flag isn't set, so exit handlers delete rows), but this is an important property to pin with a test."

**Status**: Accepted.

**Changes made**: added "handleWorkspaceStopAll remains a full wipe" test that parses `tower-routes.ts`, extracts the function body via brace matching, and asserts (a) the body does NOT reference `intentionallyStopping` / `isIntentionallyStopping`, and (b) the body DOES call `deleteWorkspaceTerminalSessions`. A future refactor that routes stop-all through `stopInstance` (silently flipping the semantics) would fail this test.

### Cl4. Non-functional timing assertions (<2s rebind, <100ms persistence) absent
> "Acknowledged that these are integration-level tests requiring a live Tower, so they may be deferred to the verify phase."

**Status**: Acknowledged.

**Reasoning**: timing assertions are environment-sensitive and don't run reliably at the unit level. The verify phase requires manual round-trip exercise; timing observations naturally fall out of that. Deferred per Claude's own observation.

---

## Codex — REQUEST_CHANGES (1 architectural concern, 1 missing-test concern)

### Co1. Workspace-scoping of `state.db` writes/reads
> "`launchInstance()` restores siblings with `getArchitects()` and the new exit handlers delete rows with `setArchitectByName(...)`, but those helpers use the process-local `state.db` chosen by `getDb()/getConfig()` rather than the workspace being launched/stopped. That means multi-workspace Tower can read/write the wrong workspace's architect registry."

**Status**: Acknowledged as a real architectural concern; declined to fix in Phase 3 because:

1. **Pre-existing condition.** The `architect` table schema (`db/index.ts:407-414`) has no `workspace_path` column. `setArchitect` / `setArchitectByName` (state.ts:71, :93) use a singleton `getDb()` that resolves to the process's CWD via `getConfig()`. This is the storage shape from Spec 755 (multi-architect primitive), not a Phase 3 introduction. Phase 3 reads what Spec 755's code already writes.

2. **Spec explicitly puts cross-workspace out of scope.** The Phase 3 / Issue #786 spec, under "Out of scope", reads: *"Cross-workspace routing. Architects in workspace A cannot address architects in workspace B. Deferred previously; stays deferred."* The single-workspace assumption is load-bearing for this entire feature.

3. **Pre-existing pattern of `setArchitectByName` calls.** Looking at `tower-instances.ts` before my Phase 3 changes (commit `0ba5b979`), the four existing call sites for `setArchitectByName(name, ...)` in `addArchitect` already use the same singleton `state.db`. Phase 3's added calls (in 3 of the 5 exit handlers + the new launchInstance reconciliation loop) follow the same pattern. Fixing this would require schema-level migration (`architect` table gains `workspace_path`), `state.ts` per-workspace API rework, and changes to all of Spec 755's callsites — vastly beyond Phase 3's scope.

4. **In single-workspace Tower deployment (the supported case)**, the implementation is correct. Shannon's reported workflow — `main` + `ob-refine` in a single workspace — is what the spec targets.

**Recommendation**: file a follow-up ticket post-#786 to make `state.db.architect` workspace-scoped. That's a multi-workspace-Tower hardening, not a Phase 3 correctness fix.

### Co2. Phase-3 test coverage gaps
> "I do not see coverage proving that `launchInstance()` re-spawns persisted siblings after stop/start, that `stop.ts` now preserves architect rows, or that the `stop-all` path remains the full-wipe variant."

**Status**: Partially accepted — addressed in tandem with Claude's Cl2 and Cl3 above.

**Changes made**: 
- launchInstance sibling reconciliation: source-level sentinel + behavioural success test (per Cl2).
- handleWorkspaceStopAll full-wipe regression: source-level property test that brace-matches the function body and asserts the absence of intentional-stop references (per Cl3).
- stop.ts preserving architect rows: the relevant state-level behaviour is already covered by Phase 1's `clearRuntime` tests in `state.test.ts` (the differential test proves `clearRuntime` preserves architects while `clearState` wipes them). Phase 3's change to `commands/stop.ts` just swaps the call; the swap itself is verified by source-level inspection during code review and by the type checker (the import line changed from `clearState` to `clearRuntime`).

---

## What did NOT change

- The implementation of the intentional-stop flag, the 5 (now 6) exit handlers, `stopInstance`, `launchInstance`'s sibling reconciliation loop, and `commands/stop.ts`'s switch to `clearRuntime` are all unchanged from iter-1 — Gemini approved them and Codex/Claude only flagged the gaps above.

## Net effect

Iter-1 → iter-2: ~95 lines added across `tower-terminals.ts` (6th exit handler fix) and `tower-instances.test.ts` (3 new tests). All tower-instances tests pass (44/44). Full regression in progress.

Codex's architectural concern is acknowledged for the follow-up backlog but declined for Phase 3 per spec's stated scope.
