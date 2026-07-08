# Builder thread: pir-1150

PIR builder for issue #1150 (removed sibling architect resurrects after Tower recovery).

## 2026-07-08 — Plan phase

Investigated the resurrection path end to end:

- Confirmed the two silent catches in `removeArchitect` (tower-instances.ts:1175-1180) and the unconditional `addArchitect()` in the sibling reconcile loop (687-699).
- Key finding beyond the issue text: `reconcileTerminalSessions`' Phase 2 sweep deletes ALL stale `terminal_sessions` rows at boot, and the architect exit handlers delete them on every clean `afx workspace stop` too. So the issue's strict "terminal_sessions row OR jsonl" gate would prune legitimate Codex/Gemini siblings (they never carry a session_id) on every stop/start, regressing Spec 786 Phase 3 persistence.
- Plan therefore refines the gate: session-less harnesses are treated as live (their respawn is always fresh, so no conversation can resurrect and no RC2 crash-loop is possible); session-capable rows require jsonl evidence via a new optional harness `session.sessionExists()` (keeps Claude specifics out of Tower).
- Also making `removeArchitect` retryable: a retry after partial removal currently returns "not found" even though the zombie row is the thing needing deletion. The not-found branch will purge a persisted row if one exists.
- WAL-loss residual window (removal committed, power lost before fsync) is not closable by any liveness check; mitigated by `synchronous = FULL` (Part 3) and documented in the plan.

Plan written to `codev/plans/1150-afx-removed-sibling-architect-.md`. Sitting at plan-approval gate.
