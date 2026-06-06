# PIR #997 — Consultation Rebuttals (iteration 1)

Single advisory pass (`max_iterations: 1`). Verdicts: **Claude APPROVE** (HIGH), **Gemini COMMENT** (skipped), **Codex REQUEST_CHANGES**.

## Codex — REQUEST_CHANGES (ACCEPTED, fixed)

**Finding**: The plan's Test Plan called for a restart integration test proving a *single* `/api/state` read after a Tower restart returns the complete `role→terminalId` mapping, but the only test changes were unit tests of the barrier mechanism — the end-to-end regression for the actual bug scenario was missing.

**Disposition: agreed — this was a real gap, now fixed.**

- Added `tower-terminals.test.ts` › *"a single read after a restart reflects the completed reconcile (resolves after it)"*. It drives a **real** `reconcileTerminalSessions()` with a mock shellper held open mid-flight (via a deferred), issues a single `getRehydratedTerminalsEntry` concurrently, and asserts a **deterministic ordering**: the read resolves strictly *after* reconcile completes, and the returned `builders` map is fully populated on that first read (`size === 1`, contains the reconnected role).
- The assertion is ordering-based rather than timing-based, so it is not flaky.
- **Verified non-vacuous**: with the `await whenStartupReconcileSettled()` gate removed from `getRehydratedTerminalsEntry`, the read resolves *before* reconcile (`['read','reconcile']`) and the test fails; with the gate present it is `['reconcile','read']` and passes.
- Full worktree suite after the addition: 3258 passed, 13 skipped, 0 failed.

**PIR is single-pass**: this fix was not independently re-reviewed by a model. The human at the `pr` gate is the correctness backstop — please confirm the regression test. It is also documented in the review file's "Things to Look At During PR Review".

## Gemini — COMMENT (no action)

Gemini lane was **skipped** because the `agy` CLI is not installed in this environment ("agy produced no review output"). This is a non-blocking environmental skip, not a code finding. No rebuttal needed.

## Claude — APPROVE (no action)

APPROVE, HIGH confidence, `KEY_ISSUES: None`. Confirmed plan adherence, code quality, the barrier release paths, the WS synchronous fast-path, and the timeout-releases-waiter-not-barrier semantics. No action needed.
