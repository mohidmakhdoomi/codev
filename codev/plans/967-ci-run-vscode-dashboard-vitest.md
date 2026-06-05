# PIR Plan: Run vscode + dashboard vitest unit suites in CI

## Understanding

Two vitest unit suites have **zero CI coverage** today — they only ever run on a builder's
machine:

| Package | Suite | Runs in CI? |
|---|---|---|
| `packages/dashboard` (`@cluesmith/codev-dashboard`) | `vitest run` — `__tests__/*.test.ts(x)` | ❌ local only |
| `packages/vscode` (`codev-vscode`) | `test:unit` → `vitest run` — `src/__tests__/**/*.test.ts` | ❌ local only |

`test.yml`'s `unit` job runs `packages/core` (added in #961) and `packages/codev`. The dashboard's
Playwright e2e runs in `dashboard-e2e.yml`, but its **vitest unit** suite does not. A regression in
either uncovered suite (e.g. `dashboard/__tests__/Terminal.reconnect.test.tsx`,
`vscode/src/__tests__/terminal-adapter.test.ts`) passes CI today.

### Findings from running both suites on this clean tree

1. **Dashboard suite passes clean**: `vitest run` → **317 passed, 1 skipped (31 files)**, exit 0, ~1.9s.
2. **The pre-existing failing dashboard test no longer exists.** The issue flagged
   `scrollController.test.ts > ... > warns on unexpected scroll-to-top` as failing on a clean tree.
   That test has since been **replaced** by `accepts scroll-to-top without auto-correcting or warning
   (Issue #630)` and the whole `scrollController.test.ts` file passes 45/45. **No quarantine or fix is
   needed** — the prerequisite the issue worried about is already resolved upstream.
3. **vscode `test:unit` needs `@cluesmith/codev-types` built first.** On a tree where `packages/types`
   has no `dist/`, two files fail:
   `src/__tests__/terminal-adapter.test.ts` and `src/__tests__/reconnect-link-provider.test.ts`, with
   `Error: Failed to resolve entry for package "@cluesmith/codev-types"`. Root cause: types' export map
   is `{ "types": "./src/index.ts", "default": "./dist/index.js" }`
   (`packages/types/package.json`). vscode's vitest runs in a plain `node` environment and resolves the
   `default` condition → `dist/index.js`, which doesn't exist until `pnpm --filter @cluesmith/codev-types build`.
   After building types, vscode `test:unit` passes **284/284**, exit 0, <1s.
   (The dashboard suite resolves types from source `./src/index.ts` because Vite's react plugin
   transforms `.ts` on the fly, so it doesn't strictly need the build — but building types is harmless
   and makes the job robust.)
4. **Neither suite needs the forks-pool teardown-crash workaround** that `packages/codev` uses
   (pipefail + tee + grep). Both exit cleanly with code 0. A plain `vitest run` (via the package
   scripts) is sufficient — no output-scraping shim.

## Proposed Change

Add the two suites to the existing **`unit` job** in `.github/workflows/test.yml` as additional steps,
rather than creating separate jobs.

**Why fold into the `unit` job instead of new jobs:** the `unit` job already does `pnpm install` and
builds `packages/core`. Both new suites are sub-2s. Standing up two new jobs would each repeat
checkout + `pnpm install` (~30–60s) + a core build to run ~2s of tests — poor wall-clock and
CI-minute economics. Folding in reuses the install/build that's already paid for; the only marginal
addition is one `pnpm --filter @cluesmith/codev-types build` step (types isn't built in the job today).
The job already exercises `core` + `codev`, so "all unit suites in one job" stays cohesive.

Steps to add to the `unit` job, after the existing core build and before/after the codev steps:

1. **Build types package** — `pnpm --filter @cluesmith/codev-types build` (required by vscode's suite).
2. **Run dashboard unit tests** — `working-directory: packages/dashboard`, `run: pnpm test`
   (the `test` script is `vitest run`).
3. **Run vscode unit tests** — `working-directory: packages/vscode`, `run: pnpm test:unit`
   (the `test:unit` script is `vitest run`).

Use the package scripts (`pnpm test` / `pnpm test:unit`) rather than re-spelling `vitest run`, so the
CI command tracks whatever the package owner defines.

### Decisions on the issue's open questions

- **Fold vs. separate jobs** → fold into `unit` (rationale above).
- **Coverage thresholds** → **no**. Neither config defines coverage today, and `core` deliberately
  ships without a threshold (#961). Match that precedent; run plain `vitest run`. Adding thresholds is
  a separate, opt-in decision per package owner and out of scope for "make them run in CI".
- **Forks-pool teardown workaround** → **not needed**. Both suites exit 0 cleanly; plain `vitest run`
  via the package scripts suffices. No tee/grep shim.
- **The flagged failing dashboard test** → already resolved upstream (finding #2); nothing to fix or
  quarantine.

## Files to Change

- `.github/workflows/test.yml` — in the `unit` job, add three steps:
  - `Build types package` → `pnpm --filter @cluesmith/codev-types build`
  - `Run dashboard unit tests` → `working-directory: packages/dashboard`, `run: pnpm test`
  - `Run vscode unit tests` → `working-directory: packages/vscode`, `run: pnpm test:unit`

No source/test files change — both suites pass as-is on `main`.

## Risks & Alternatives Considered

- **Risk: the dashboard's 1 skipped test masks a real gap.** It's an intentional `.skip` in the suite,
  unrelated to this work; surfacing it is out of scope. Mention it in the review, don't touch it.
- **Risk: types build ordering.** vscode's suite hard-requires `packages/types/dist`. The new step
  builds it before the vscode step runs. Verified locally: clean tree → 2 failures; after types build →
  284/284 pass.
- **Risk: a future flaky-teardown crash in these suites** (the thing codev's tee/grep shim guards
  against). Not observed in either suite today. If it ever surfaces, the same documented workaround can
  be applied then — adding it pre-emptively would be cargo-culting. Documented here so the next person
  knows the option exists.
- **Alternative: separate jobs per package.** Rejected for cost (duplicate install/build for ~2s of
  tests). Revisit only if the `unit` job's wall-clock becomes a bottleneck or a suite needs a
  materially different toolchain/runner.
- **Alternative: add the dashboard unit suite to `dashboard-e2e.yml`.** Rejected — that workflow is
  schedule/dispatch-only (daily cron), so it wouldn't gate PRs. The unit suites must gate PRs, which
  means `test.yml` (runs on `pull_request` + push to `main`).

## Test Plan

This change is **CI-config only** — the "running worktree" to review at the `dev-approval` gate is the
CI behavior, verified by reproducing each CI step locally.

- **Reproduce the new CI steps locally** (from the worktree root):
  ```bash
  pnpm install
  pnpm --filter @cluesmith/codev-core build
  pnpm --filter @cluesmith/codev-types build
  pnpm --filter @cluesmith/codev-dashboard test     # expect: 317 passed, 1 skipped, exit 0
  pnpm --filter codev-vscode test:unit              # expect: 284 passed, exit 0
  ```
- **Negative check (proves the types build is load-bearing):** remove `packages/types/dist`, run the
  vscode suite, observe the 2 `Failed to resolve entry for "@cluesmith/codev-types"` failures; rebuild
  types, observe them pass.
- **Workflow lint:** confirm `.github/workflows/test.yml` YAML is valid (the added steps mirror the
  existing core/codev step structure exactly).
- **End-to-end:** once pushed, the `unit` job on the PR shows the two new steps green. (Final
  confirmation lands when the PR's CI runs.)
