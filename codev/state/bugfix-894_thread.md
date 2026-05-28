# bugfix-894 — Thread

## 2026-05-28 — INVESTIGATE phase started

Issue #894: flaky 5s timeout in `next.test.ts` "emits BUILD tasks for fresh specify phase"

Failure observed on CI for PR #893 (pir-885), passed on `main` post-merge ~30s later with identical code → timing-dependent flake at 5s boundary.

Failing test location: `packages/codev/src/commands/porch/__tests__/next.test.ts:174`

Hypotheses from the issue:
1. Real subprocess spawn (git/afx/node) — startup variability on CI
2. File-system I/O slow on CI runner
3. Racy timer / event-await pattern

Investigating now: read `next.ts` to understand what the test actually exercises, then run locally to measure timing.

## Root cause

`next()` calls `buildPhasePrompt()` → `getProjectSummary()` → `fetchIssue()` → `executeForgeCommand('issue-view', …)` → real `gh` subprocess hitting GitHub API.

The `next.test.ts` mocks `loadConfig` but does **not** mock `../../../lib/github.js`. So every test exercising the "need build" path (~10 of 30 tests) spawns `gh issue view 0001`. Per-test timings from verbose run:

- Tests that hit the build path: 836-2000ms each (one gh call each, "is idempotent…" runs `next()` twice → ~1960ms)
- Tests that skip the build path: 2-7ms each

Locally each `gh` call is ~900ms (network round-trip). On CI under variable load that can spike past 5s → vitest's default per-test timeout fires.

Hypothesis #2 from the issue ("subprocess that should be mocked") is the correct one. Fixing by adding `vi.mock('../../../lib/github.js', …)` to `next.test.ts` — mirrors the established pattern in `src/__tests__/project-summary.test.ts:14`.

Side benefit: total file time drops from ~11s to ~1s; eliminates this whole class of flake (the failing test happened to be the first one to cross 5s; any of the 10 build-path tests was equally at risk).

