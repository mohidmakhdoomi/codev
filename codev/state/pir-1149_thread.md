# Builder thread: pir-1149

Tower recovery: Claude architect crash-loops on stale --resume with no user escape (issue #1149, PIR protocol).

## 2026-07-08 Plan phase

Investigated all resume-replay paths. Confirmed the issue's root cause and found the two cold-spawn sites in `tower-instances.ts` (~500, ~945) share the vulnerability with the two reconcile sites named in the issue, so the plan wires the fallback at all four.

Key design decisions in the plan:

- Detector lives in `SessionManager.setupAutoRestart` but stays harness-neutral: callers precompute a `crashLoopFallback` (args/env/onApply); the terminal layer never learns about `--resume`. Matches the HarnessProvider abstraction.
- Only nonzero-code exits count toward the 3-failures-in-30s window, so a user rapidly quitting a healthy session cannot lose a valid resumable conversation.
- Fallback args are the real fresh-launch variant from `resolveArchitectLaunch` (role injection + newly minted pinned id), not "args minus --resume", because the resume branch skips role injection.
- On fallback: clear `session_id` to NULL (per issue sketch; persisting the minted id considered and documented as an alternative).
- `CODEV_SKIP_RESUME=1` escape hatch in `resolveArchitectLaunch`.

Plan written to `codev/plans/1149-tower-recovery-claude-architec.md`. Sitting at the plan-approval gate.

## 2026-07-15 Rebase + plan recheck

Rebased onto main (103 commits, clean). Two related PRs merged in the interim and changed the plan materially:

- #1145: resolve-time ownership check (`verifyOwnership`, jsonl file-existence) now gates the resume branch in `resolveArchitectLaunch`; architect mtime-discovery fallback removed.
- #1150: sibling rows with no resumable-session evidence are pruned at reconcile.

Plan revisions:

- Reframed the fix as the runtime complement to #1145's bake-time check. Residual gaps it covers: jsonl vanishing between bake and replay (Claude's cleanupPeriodDays GC), corrupted/truncated jsonl that passes the existence check, any other runtime resume failure.
- Flipped the persistence decision: onApply now persists the fallback's minted session id instead of clearing to NULL. NULL would trip #1150's dead-registration pruning for siblings, and #1145 makes a never-materialized minted id safe (filtered at next bake). Helper renamed to `setArchitectSessionId`.
- Refreshed all file:line references; updated the manual repro (bare poisoned id no longer reproduces; corrupt the jsonl in place instead).

## 2026-07-15 Implement phase

Implemented per the approved plan, no deviations:

- `session-manager.ts`: `CrashLoopFallback` on both option types, `failingExitTimes` on the session, pure `isCrashLooping` helper (3 nonzero-code exits in 30s), one-shot swap in `setupAutoRestart` via `maybeApplyCrashLoopFallback`.
- `tower-utils.ts`: resume branch of `resolveArchitectLaunch` returns the precomputed fresh-launch `fallback`; `CODEV_SKIP_RESUME=1` escape hatch; shared `buildArchitectCrashLoopFallback` (logs once, persists the minted id via new `state.setArchitectSessionId`).
- Wired at all four bake sites (2 reconcile in tower-terminals, 2 cold-spawn in tower-instances).
- Tests: pure-helper unit tests, 2 CI-skipped real-shellper integration tests (fallback applied on fast failures; clean exits never trigger), launch/restart fallback-shape tests, escape-hatch test, `setArchitectSessionId` row-targeting tests.

Build green; the 3 affected test files pass (163 tests). Full suite running before porch done.

Commits: fa5c5137 (session manager), 5af6cb95 (tower wiring).
