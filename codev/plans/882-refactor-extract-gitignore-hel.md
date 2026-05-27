# PIR Plan: Extract gitignore helpers out of `scaffold.ts`

## Understanding

`packages/codev/src/lib/scaffold.ts` was extracted in Maintenance Run 0004 to deduplicate logic shared between `codev init` and `codev adopt`. Its header still claims to be "Scaffold utilities for codev init and adopt commands", but the file now also contains:

- `updateGitignore()` — used by `adopt` to merge a Codev block into an existing `.gitignore` (line-level backfill of missing entries).
- `backfillGitignore()` — added in #881 for `codev update`, repairing stale gitignore state in long-lived projects.
- `parseEntryLines()` — internal helper used by `backfillGitignore`.
- The three gitignore-shaped types (`BackfillGitignoreResult`, `BackfillGitignoreOptions`, `UpdateGitignoreResult`).

The grep audit confirms the move list is exhaustive — the only external readers of these symbols are `init.ts`, `adopt.ts`, `update.ts`, and `__tests__/scaffold.test.ts` (verified via `grep -rn` on `packages/codev/src` and `packages/codev/tests`).

## Proposed Change

Pure file move + import rewire. No behavior changes, no function renames, no further pruning of `scaffold.ts`. After this PR:

- `packages/codev/src/lib/gitignore.ts` owns everything gitignore-related.
- `scaffold.ts` is back to true scaffolding helpers — directory creation, skeleton copying, root-file templating.
- Three command files and the test split point to the new module.

## Files to Change

### New file

- `packages/codev/src/lib/gitignore.ts` — new module. Contains:
  - `CODEV_GITIGNORE_ENTRIES` (const, exported)
  - `FULL_GITIGNORE_CONTENT` (const, exported)
  - `createGitignore()` (exported)
  - `updateGitignore()` (exported)
  - `backfillGitignore()` (exported)
  - `parseEntryLines()` (internal, not exported — same visibility as today)
  - Types: `UpdateGitignoreResult` (currently interface, kept as-is), `BackfillGitignoreOptions` (interface), `BackfillGitignoreResult` (currently `export interface` — preserved as exported)
  - A short module header explaining "gitignore management for init / adopt / update"
  - `import * as fs from 'node:fs'; import * as path from 'node:path';`

### Modified files

- `packages/codev/src/lib/scaffold.ts:9-34` — remove `CODEV_GITIGNORE_ENTRIES` and `FULL_GITIGNORE_CONTENT` constants.
- `packages/codev/src/lib/scaffold.ts:222-331` — remove `createGitignore`, `UpdateGitignoreResult` interface, `updateGitignore`, `BackfillGitignoreOptions` interface, `BackfillGitignoreResult` interface, `parseEntryLines`, `backfillGitignore`.
- `packages/codev/src/lib/scaffold.ts:1-4` — update header to drop the "scaffold" gloss only enough to stay accurate (it's still used by init / adopt / update for directory creation and skeleton copying); no further pruning.
- `packages/codev/src/commands/init.ts:13-19` — split import: keep `createUserDirs, createProjectsDir, copySkills, copyRootFiles` from `../lib/scaffold.js`; add `import { createGitignore } from '../lib/gitignore.js';`.
- `packages/codev/src/commands/adopt.ts:14-20` — same split: keep scaffold imports; add `import { updateGitignore } from '../lib/gitignore.js';`.
- `packages/codev/src/commands/update.ts:25-30` — same split: keep `copySkills, copyRootFiles` from scaffold; add `import { backfillGitignore, CODEV_GITIGNORE_ENTRIES } from '../lib/gitignore.js';`.

### Test split

- `packages/codev/src/__tests__/gitignore.test.ts` — **new file**. Moves these `describe` blocks verbatim out of `scaffold.test.ts`:
  - `describe('createGitignore', ...)` (current scaffold.test.ts:277–300)
  - `describe('updateGitignore', ...)` (302–361)
  - `describe('CODEV_GITIGNORE_ENTRIES', ...)` (363–374)
  - `describe('backfillGitignore (issue #880)', ...)` (376–480)
  - Wraps them in a fresh `describe('Gitignore Utilities', ...)` outer block with its own minimal `beforeEach` / `afterEach` (just `tempDir` — these tests don't need `mockSkeletonDir` or the skeleton fixtures the scaffold tests build).
  - Imports come from `../lib/gitignore.js`.
- `packages/codev/src/__tests__/scaffold.test.ts` — remove the four moved `describe` blocks (lines 277–480) and the four corresponding import names from line 10–20. The scaffold-only fixtures (skeleton templates, consult-types, roles directories) stay. Keep the `describe('projectlist removal (Spec 0126)', ...)` regression block — it reads `scaffold.ts` source directly and remains correct.
- Optional regression addition (one new test in `scaffold.test.ts`) verifying `scaffold.ts` source no longer contains `gitignore` / `CODEV_GITIGNORE_ENTRIES` / `backfillGitignore` strings, mirroring the existing `projectlist` regression pattern. Cheap insurance against accidental re-introduction. **Inclusion decision deferred to dev-approval review.**

## Risks & Alternatives Considered

- **Risk: missed import site.** Mitigation: the grep audit covered both `packages/codev/src` and `packages/codev/tests` and found exactly the four files listed above. Will re-run grep after the edits to confirm zero stragglers, plus `pnpm --filter @cluesmith/codev build` (tsc) catches any missed symbol.
- **Risk: changing test names changes CI selectors.** Mitigation: outer describe label is the only thing changing (`'Scaffold Utilities'` → `'Gitignore Utilities'`). Inner test names and assertions are untouched. We don't filter CI by describe-name anywhere I could find.
- **Risk: `parseEntryLines` visibility regression.** Today it's module-private (not exported). Keeping it private in `gitignore.ts` preserves exactly that — no test reaches it directly, only via `backfillGitignore`.
- **Alternative: re-export the moved symbols from `scaffold.ts` for back-compat.** Rejected — internal module, no external consumers, three call sites all updated in this PR. Re-exports would just leave a dead breadcrumb.
- **Alternative: also pull `parseEntryLines` out as a separately exported helper.** Rejected — issue explicitly says "no renaming of the functions themselves" and "one refactor at a time." `parseEntryLines` stays internal.
- **Alternative: bundle a `copyRoles` → `roles.ts` move in the same PR.** Rejected per the issue's "Out of scope" — one refactor at a time.

## Test Plan

This is a pure move with no behavior change. Verification is mostly mechanical:

- **Static**:
  - `pnpm --filter @cluesmith/codev build` — must be clean (tsc catches any missed import).
  - `grep -rn -E '(createGitignore|updateGitignore|backfillGitignore|CODEV_GITIGNORE_ENTRIES|FULL_GITIGNORE_CONTENT|parseEntryLines|BackfillGitignoreResult|BackfillGitignoreOptions|UpdateGitignoreResult)' packages/codev/src packages/codev/tests` — expect references only in the new `gitignore.ts`, the three command files, and `gitignore.test.ts`. Zero hits in `scaffold.ts` or `scaffold.test.ts`.
- **Unit tests**:
  - `pnpm --filter @cluesmith/codev test -- gitignore` — the moved suite passes in its new home.
  - `pnpm --filter @cluesmith/codev test -- scaffold` — remaining scaffold tests still green; `projectlist removal` regression still passes.
  - `pnpm --filter @cluesmith/codev test` — full suite green. Existing `init.test.ts` / `adopt.test.ts` / `update.test.ts` exercise the rewired imports end-to-end (init creates a fresh gitignore, adopt merges into existing, update backfills missing entries).
- **Manual smoke** (only if any test fails):
  - `node packages/codev/dist/cli.js init /tmp/codev-init-smoke --yes` → `.gitignore` exists with the expected entries.
  - `cd /tmp/existing && echo 'node_modules/' > .gitignore && node /path/to/codev/dist/cli.js adopt --yes` → entries merged, `node_modules/` preserved.

No cross-platform / device testing needed — this is internal Node-only code with no UI surface.
