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
