# Phase 2 — Iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers (iter-1)**: Gemini (REQUEST_CHANGES), Codex (REQUEST_CHANGES), Claude (APPROVE)
**Outcome**: Both REQUEST_CHANGES findings accepted and addressed. Test added for the second injection site; stale comment fixed.

---

## Codex — REQUEST_CHANGES

### Co1. Test coverage only verifies the reconciliation path, not the workspace-status reconnect path
> "`packages/codev/src/agent-farm/__tests__/tower-terminals.test.ts:613` only covers `reconcileTerminalSessions()`; I found no test exercising the second Phase 2 injection site in `packages/codev/src/agent-farm/servers/tower-terminals.ts:777-799` (`getTerminalsForWorkspace()` on-the-fly reconnect). The plan explicitly requires 'Tests assert env contents on each path', so this phase is not fully delivered yet."

**Status**: Accepted.

**Changes made**: Added a fifth test inside the Phase 2 `describe` block that calls `getTerminalsForWorkspace('/real/project', 'http://example.test')` with a sibling architect DB session whose runtime PTY is gone. The test captures `restartOptions` via mocked `reconnectSession` (same pattern as the reconciliation tests) and asserts `CODEV_ARCHITECT_NAME === 'team-a'`. The test exercises the on-the-fly reconnect branch at lines 777-781 (post-fix) directly.

### Co2. Stale comment in fallback branch
> "Minor doc/code mismatch: `packages/codev/src/agent-farm/servers/tower-terminals.ts:580` says the fallback reconnect is 'without role injection,' but `cleanEnv` already includes `CODEV_ARCHITECT_NAME`. Not blocking by itself, but worth fixing while touching this area."

**Status**: Accepted.

**Changes made**: Updated the comment to: "Fall back to plain command without harness role-prompt args so the session can still reconnect. `cleanEnv` still carries `CODEV_ARCHITECT_NAME` (set above for Spec 786 Phase 2), so identity is preserved even on harness failure." Distinguishes the two things — the fallback path skips harness `args/env` but identity injection still applies.

---

## Gemini — REQUEST_CHANGES

### Ge1. Missing test coverage on `getTerminalsForWorkspace` path
> "The builder successfully added tests for the `reconcileTerminalSessions` path in `tower-terminals.test.ts`, but the `getTerminalsForWorkspace` (on-the-fly reconnect) path is completely untested for `CODEV_ARCHITECT_NAME` re-injection. The test plan suggested extracting the environment construction into a shared, unit-testable helper; since the code was duplicated instead, a test for the second location is mandatory."

**Status**: Accepted. Same fix as Codex Co1.

**Why not the helper extraction**: The plan listed both options ("extract a small helper OR assert on the constructed options object"). At only two sites, helper extraction is premature abstraction — the code path is structurally identical, the new comments explicitly cross-reference the matching block, and the duplication is bounded. Adding the second test closes the coverage gap with no abstraction debt. If a third site ever emerges, that's the moment to extract.

---

## Claude — APPROVE
> "Clean, minimal, and correct identity-preservation fix at both restartOptions sites with strong test coverage."

Claude noted the same coverage gap as a non-blocking observation: "An integration test covering the on-the-fly reconnect path in a later phase would close the gap completely." The fix in this rebuttal closes it now, in unit-test form, rather than deferring.

---

## What did NOT change
- The implementation of identity injection at both sites is unchanged — both reviewers confirmed the code is correct; only the test coverage was incomplete.
- The `|| 'main'` fallback for legacy null `role_id` is preserved.
- Phase 1 deliverables are untouched.

## Net effect
Iter-1 → iter-2: +47 lines (one new test, comment fix). All 47 tower-terminals tests pass; all 1785 agent-farm tests pass. Ready for iter-2 CMAP confirmation.
