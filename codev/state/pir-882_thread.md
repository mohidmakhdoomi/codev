# pir-882 thread

## 2026-05-27 — Plan drafted

Refactor: extract gitignore helpers (`CODEV_GITIGNORE_ENTRIES`, `FULL_GITIGNORE_CONTENT`, `createGitignore`, `updateGitignore`, `backfillGitignore`, `parseEntryLines`, related types) out of `scaffold.ts` into a new `packages/codev/src/lib/gitignore.ts`. Pure file move + import rewire across `init.ts`, `adopt.ts`, `update.ts`, and a test split (new `__tests__/gitignore.test.ts` carrying the moved `describe` blocks verbatim).

Grep audit confirmed the consumer list is exhaustive — three command files plus `__tests__/scaffold.test.ts`. No external consumers, so no re-exports needed from `scaffold.ts`.

Plan at `codev/plans/882-refactor-extract-gitignore-hel.md`. Awaiting plan-approval gate.
