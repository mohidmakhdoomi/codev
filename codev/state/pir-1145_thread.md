# pir-1145 — builder thread

## 2026-07-08 — Plan phase

Investigated issue #1145 (main architect hijacks unrelated Claude session on fresh workspaces).

**Root cause**: the #832 legacy jsonl-discovery fallback in `launchInstance` (tower-instances.ts:493-499) is gated on `getArchitects().length <= 1`, which a *fresh* workspace (0 rows) satisfies. So first-ever launch runs mtime discovery over `~/.claude/projects/<encoded-cwd>/` and resumes the user's personal Claude conversation if one exists for that directory — with role injection skipped (resume branch of `resolveArchitectLaunch`). Second vector: the project-dir encoding maps both `/` and `.` to `-` (lossy), so distinct paths can collide into one store dir → genuine cross-project pickup.

**Plan** (codev/plans/1145-codev-adopt-launchinstance-mai.md):
1. Gate discovery on a legacy `main` row *existing* without a session id (the bridge case it was built for). No row → always fresh.
2. Ownership verification: jsonl candidates must record a `cwd` matching the requested path (discovery side), plus an optional harness-gated `session.verifyOwnership` checked in `resolveArchitectLaunch` before any stored-id resume.

Confirmed `afx workspace stop` preserves architect rows, so normal stop/start resume is unaffected. Sitting at plan-approval gate.
