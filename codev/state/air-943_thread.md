# air-943 — codev doctor/update: warn on PR-producing protocol overrides missing a `pr` gate

## Context
AIR builder, strict mode. Issue #943: post-#927 guardrail. #927 made Needs Attention
surface PRs via the universal `pr` gate (`derivePrReady` = `gates['pr'] === 'pending'`).
A tier-1/2 protocol override that lacks a `pr` gate silently loses PR surfacing.

## Investigation findings
- `derivePrReady` (overview.ts:508): PR surfaces iff the `pr` gate goes pending. Porch
  requests the `pr` gate only when `isPrCreatingPhase` (phase.gate === 'pr') is true
  (protocol.ts:434, index.ts:498). No `pr` gate anywhere → never requested → never surfaces.
- Bundled PR-producing protocols (all carry `gate: pr` on their PR-creating phase in stock):
  bugfix, air, spir, aspir, pir. experiment/maintain are NOT PR-producing.
- 4-tier resolver = `resolveCodevFile` (skeleton.ts): .codev/ → codev/ → cache → package skeleton.
- This repo has tier-2 copies under `codev/protocols/*` — all correctly pr-gated, so the
  check is clean (no output) when run here.

## Plan
1. New lib `lib/pr-gate-audit.ts`: `auditPrGates(root)` resolves each bundled PR-producing
   protocol via the 4-tier resolver, flags any whose resolved JSON has no phase gated `pr`.
   `formatPrGateWarning(w)` builds the loud message.
2. `doctor.ts`: add a "Protocol PR Gates" section (non-fatal warning, exit code unchanged).
3. `update.ts`: print the same warnings after the summary; expose via `result.prGateWarnings`.
4. Tests: unit (pr-gate-audit) + doctor integration + update integration.

## Implementation (done)
- `lib/pr-gate-audit.ts`: `auditPrGates()` + `formatPrGateWarning()`, `PR_PRODUCING_PROTOCOLS`.
- `doctor.ts`: new "Protocol PR Gates" section (non-fatal warning, exit code unchanged).
- `update.ts`: prints warnings after summary + `result.prGateWarnings`.
- Tests: pr-gate-audit.test.ts (8), doctor.test.ts (+2), update.test.ts (+2). All pass.

## Verification
- tsc --noEmit: clean (0 errors) after building codev-core.
- pr-gate-audit + doctor + update suites: 50/50 pass.
- Full unit suite: 3198 pass. 6 session-manager "real shellper" failures were a stale-`dist`
  artifact (shellper = `dist/terminal/shellper-main.js`); after `tsc` emit they pass 67/67.
  Porch's build check emits dist before the tests check, so no impact.
- Headline path (real CLI, built dist): `codev doctor` shows "✓ All PR-producing protocols
  are pr-gated" in this repo; against a gateless bugfix override it prints the loud warning.
  `codev update --dry-run` prints the same warning after the summary.
- Env note: fresh worktree needed `pnpm install` + core build + `pnpm copy-skeleton` before
  update.test.ts/doctor could resolve the skeleton dir.

## PR
- PR #944 open: https://github.com/cluesmith/codev/pull/944
- Review embedded in PR body (AIR convention — no separate review file).
- Implementation ~166 LOC (pr-gate-audit 127 + doctor 22 + update 17); tests ~245 LOC.
- Porch implement checks passed (build ✓, tests ✓). Advancing through PR phase → `pr` gate.

## Status
- [x] Investigation complete
- [x] Implementation
- [x] Tests
- [x] PR #944 open
- [ ] `pr` gate (awaiting human approval)
