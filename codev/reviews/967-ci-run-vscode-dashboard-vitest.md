# PIR Review: Run vscode + dashboard vitest unit suites in CI

Fixes #967

## Summary

The `Tests` workflow (`.github/workflows/test.yml`) only ran the `packages/core` and `packages/codev` vitest suites, so the `packages/dashboard` and `packages/vscode` unit suites (which exist and pass locally) had zero CI coverage: a regression in either would pass CI unnoticed. This PR adds those two suites to the existing `unit` job, plus the one prerequisite they need (building `@cluesmith/codev-types`). It is a CI-configuration-only change: no source or test code was modified, and both suites already pass on the current tree.

## Files Changed

- `.github/workflows/test.yml` (+12 / -0)

Supporting artifacts (not product code):
- `codev/plans/967-ci-run-vscode-dashboard-vitest.md` (plan)
- `codev/reviews/967-ci-run-vscode-dashboard-vitest.md` (this file)
- `codev/state/pir-967_thread.md` (builder thread)

## Commits

- `8dfdac77` [PIR #967] Run vscode + dashboard vitest unit suites in CI
- `c1574f7f` [PIR #967] Plan draft
- `166913b1` [PIR #967] Thread: implement phase

(plus porch phase-transition bookkeeping commits)

## Test Results

- `porch done` checks: `build` ✓, `tests` ✓
- Per-suite, reproducing the new CI steps locally:
  - dashboard `pnpm test`: 317 passed, 1 skipped (31 files), exit 0
  - vscode `pnpm test:unit`: 284 passed (22 files), exit 0
- **Full workflow run via `act`** (real GitHub Actions container, fresh checkout, `catthehacker/ubuntu:act-latest`): the entire `unit` job succeeded (`🏁 Job succeeded`). All 11 steps green, including the three new ones (`Build types package`, `Run dashboard unit tests`, `Run vscode unit tests`). This exercised the change under genuine CI conditions: clean `pnpm install` from scratch, no pre-existing `dist/`, correct step ordering.

## Architecture Updates

No arch changes. This is a CI-config change that adds existing test suites to an existing job; it introduces no new module, boundary, or pattern. `codev/resources/arch.md` is unaffected.

## Lessons Learned Updates

One durable lesson worth recording (captured here for the next MAINTAIN run to fold into `codev/resources/lessons-learned.md`, consistent with how that file is curated from reviews):

- **A node-environment vitest suite that imports `@cluesmith/codev-types` requires that package to be built (`dist/index.js`) before it runs, even though a Vite-based suite in the same monorepo does not.** The types package export map is `{ "types": "./src/index.ts", "default": "./dist/index.js" }`. The vscode suite runs in vitest's plain `node` environment and resolves the `default` condition to `dist/index.js`, so on a clean tree (no `dist/`) it fails with `Failed to resolve entry for package "@cluesmith/codev-types"`. The dashboard suite resolves the same dependency from source (`./src/index.ts`) because Vite's react plugin transforms `.ts` on the fly, so it needs no build. Takeaway for adding any future cross-package suite to CI: build the workspace `dist/` of any dependency the suite resolves at runtime in a node environment, do not assume the Vite-style source resolution applies.

## Things to Look At During PR Review

- **Placement of the `Build types package` step.** It sits after the core build and before the two new suites. This ordering is load-bearing for the vscode suite (verified by a negative test: removing `packages/types/dist` reproduces the two `Failed to resolve entry` failures; rebuilding fixes them). It also runs in the `unit` job specifically, which is where the suites that need it live.
- **Folded into the `unit` job rather than separate jobs.** Both suites are sub-7s; standing up new jobs would each repeat `pnpm install` (~90s in the act run) and a core build for a few seconds of tests. The plan documents this tradeoff and the rejected alternatives (separate jobs, adding the dashboard unit suite to the schedule-only `dashboard-e2e.yml`).
- **Deliberate non-additions:** no coverage thresholds (neither config has them; `core` ships without one by design) and no forks-pool tee/grep teardown shim (both suites exit 0 cleanly, unlike `codev`). Adding either would have been cargo-culting.
- **The flagged "pre-existing failing dashboard test" from the issue no longer exists.** `scrollController.test.ts > ... > warns on unexpected scroll-to-top` was replaced upstream by `accepts scroll-to-top without auto-correcting or warning (Issue #630)`; the file passes 45/45. Nothing was quarantined.
- The dashboard suite's 1 skipped test is an intentional pre-existing `.skip`, unrelated to this change, and was left untouched.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder pir-967 → **View Diff** (auto-detects default branch)
- **Reproduce the CI steps** (the change is CI-config, so the "running thing" is the workflow):
  ```bash
  pnpm install
  pnpm --filter @cluesmith/codev-core build
  pnpm --filter @cluesmith/codev-types build
  pnpm --filter @cluesmith/codev-dashboard test     # 317 passed / 1 skipped
  pnpm --filter codev-vscode test:unit              # 284 passed
  ```
- **Or run the job as CI would** (requires `act` + Docker):
  ```bash
  act pull_request -j unit -W .github/workflows/test.yml \
    --container-architecture linux/amd64 \
    -P ubuntu-latest=catthehacker/ubuntu:act-latest
  ```
- **Negative check** (proves the types build is required): delete `packages/types/dist`, run the vscode suite, observe the 2 resolution failures, rebuild types, observe them pass.
