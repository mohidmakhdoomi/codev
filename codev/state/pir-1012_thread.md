# Builder thread: pir-1012

Issue #1012 — scaffold: `codev init` bootstraps `codev/resources/` with arch.md + lessons-learned.md starters. Protocol: PIR (strict, porch-driven).

## Plan phase

- Investigated scaffold flow. Root cause confirmed: `createUserDirs` (scaffold.ts:23) only creates specs/plans/reviews; nothing in init/adopt creates `codev/resources/`.
- Found `copyResourceTemplates` (scaffold.ts:113) is **dead code** — exported, tested, but no command calls it. It would copy the skeleton's rich template stubs plus framework docs (cheatsheet.md, lifecycle.md → #1011 territory). Plan proposes inline minimal starters instead, leaving the dead function untouched (flagged as an open question at the plan gate).
- `codev update` already never touches resources — acceptance criterion satisfied by status quo; adding a guard test.
- `codev adopt` aborts when `codev/` exists, so the "don't clobber" criterion is structurally unreachable; new function uses per-file skip-if-exists anyway.
- Plan written to `codev/plans/1012-scaffold-codev-init-bootstraps.md`. Awaiting plan-approval gate.
- Gate discussion: architect asked about VSCode extension behavior on uninitialized workspaces (answer: extension never invokes init/adopt; degrades gracefully, user bootstraps manually) and whether adopt should backfill pre-fix projects. Adopt can't (aborts when `codev/` exists), so architect approved a scope amendment: `codev update` backfills missing-only resources files (create-if-missing, never modifies existing). Plan revised accordingly.

## Rebase on main (2026-06-13)

- Rebased onto origin/main (was 63 behind). **Spec 987 had landed** — two-tier governance docs (HOT arch-critical.md/lessons-critical.md + COLD arch.md/lessons-learned.md). This re-scopes the issue significantly.
- 987 already wired `copyHotTierDefaults` into init/adopt/update (incl. update-backfill via skipExisting + dryRun handling) — but ONLY for the HOT tier. The COLD files (arch.md, lessons-learned.md), which #1012 is actually about, are STILL not materialized.
- COLD files are already in USER_DATA_PATTERNS (templates.ts:83-84) so update never overwrites them — they're just never created.
- The update-backfill "scope amendment" I discussed with the architect is now MOOT: 987 already ships update backfilling resources. Extending to cold is consistent house style, not a deviation.
- Revised plan: add `copyColdTierDefaults` (sibling of `copyHotTierDefaults`) + wire into the same 3 sites. Main open question for the gate: copy skeleton cold templates (consistent with 987) vs the issue's original "minimal inline content" preference. Plan recommends skeleton templates; awaiting architect sign-off.
- Dead `copyResourceTemplates` still dead; 987's own comment flags it. Out of scope.
