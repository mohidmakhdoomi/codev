# bugfix-903 thread

## Investigate → Fix

Architect confirmed root cause + decided fix (early-exit on `state.phase === 'verified'`
after record-only handlers, before protocol loading). Implemented as directed.

**Fix** — `packages/codev/src/commands/porch/index.ts` `done()`: 8-line early-exit
inserted after the `--merged` handler. Prints "Project <id> already verified — nothing
to do." in dim and returns. No state write, no commit. Record-only `--pr` / `--merged`
short-circuit before this guard so they continue to work on verified projects.

**Regression tests** — added 2 cases to `done-verification.test.ts`:
1. `phase: 'verified'` + `done()` → status.yaml byte-identical, output contains
   "already verified", no "PROTOCOL COMPLETE" banner.
2. `phase: 'verified'` + `done(... { pr: 42, branch })` → pr_history recorded,
   phase still 'verified'.

All 14 tests in the file pass. Unrelated workspace test failures observed
(harness-integration, session-manager) are pre-existing — `@cluesmith/codev-core`
package is not built in the worktree; not caused by this fix.
