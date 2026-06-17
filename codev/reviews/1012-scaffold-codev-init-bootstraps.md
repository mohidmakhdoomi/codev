# PIR Review: Bootstrap cold-tier `codev/resources/` files on init/adopt/update

Fixes #1012

## Summary

Fresh `codev init` projects had no `codev/resources/arch.md` or `lessons-learned.md`, so the first PIR/SPIR/ASPIR/MAINTAIN review phase failed when it read those files. Spec 987 had already wired up materialization of the *hot*-tier governance files (`arch-critical.md`, `lessons-critical.md`) but left the *cold* tier uncreated. This change adds `copyColdTierDefaults`, which materializes `arch.md` and `lessons-learned.md` from minimal skeleton placeholder starters (`templates/{arch,lessons-learned}.starter.md`) on init/adopt/update — mirroring the hot-tier pattern, skip-existing so curated copies are never overwritten, and `update` backfills the cold files for projects created before this fix.

## Files Changed

- `codev-skeleton/templates/arch.starter.md` (+9 / -0) — new minimal cold starter with an explicit `STARTER:` replace-me marker
- `codev-skeleton/templates/lessons-learned.starter.md` (+9 / -0) — same, for lessons
- `packages/codev/src/lib/scaffold.ts` (+56 / -0) — `COLD_TIER_FILES` mapping + `copyColdTierDefaults`
- `packages/codev/src/commands/init.ts` (+9 / -0) — wire cold materialization beside hot
- `packages/codev/src/commands/adopt.ts` (+8 / -0) — same (skip-existing)
- `packages/codev/src/commands/update.ts` (+13 / -0) — same, with dry-run + `newFiles` reporting (backfill for existing adopters)
- `packages/codev/src/__tests__/cold-tier-materialization.test.ts` (+129 / -0) — new test file (7 tests)
- `packages/codev/src/__tests__/init.test.ts` (+7 / -1) — positive assertions for all four resource files
- `packages/codev/src/__tests__/adopt.test.ts` (+4 / -0) — assert cold files created on adopt
- `codev/resources/arch.md`, `codev/resources/lessons-learned.md` — governance-doc updates (see below)

## Commits

- `f0e75182` [PIR #1012] Bootstrap cold-tier resources (arch.md, lessons-learned.md) on init/adopt/update
- `04e4deb1` [PIR #1012] Tests: cold-tier materialization + init/adopt assertions
- `2d133f13` [PIR #1012] Source cold-tier content from skeleton *.starter.md instead of inline constants
- `04478a98` [PIR #1012] Tests: cold-tier copies from skeleton starters
- `f5f4b118` [PIR #1012] Mark cold-tier starters with explicit STARTER replace-me comment
- (plus `[PIR #1012] Thread:` / `Plan:` housekeeping commits)

## Test Results

- `pnpm build`: ✓ pass (build core first from worktree root — `codev-core` isn't pre-built in a fresh worktree)
- `pnpm test`: ✓ pass — full suite 163 files / 3310 tests, 48 pre-existing skips; 7 new cold-tier tests
- Manual verification (and at the dev-approval gate): built CLI `init` into a temp dir creates `codev/resources/{arch,lessons-learned}.md` with the placeholder + `STARTER:` marker; `.starter.md` source files do not leak into the project; `update` backfills missing cold files without clobbering a customized one; `--dry-run` writes nothing.

## Architecture Updates

**COLD** (`codev/resources/arch.md`) — updated. The "Governance Docs (Hot/Cold Tiers)" section previously stated only the hot files were materialized; extended it to record that the cold files are now bootstrapped by `copyColdTierDefaults` from `*.starter.md` placeholders (distinct from the rich manual-`cp` reference templates), both materializers skip-existing. No **HOT** (`arch-critical.md`) change: the existing hot fact about two-tier routing is unaffected — this adds materialization detail, which is reference-tier, not a capped always-on fact.

## Lessons Learned Updates

**COLD** (`codev/resources/lessons-learned.md`) — added two entries under Documentation: (1) materialized starter files belong in `codev-skeleton/templates/` and are copied, never hardcoded as TS constants — add a dedicated `*.starter.md` when the desired starter differs from an existing rich template; (2) a placeholder filled by the agent-driven review path needs an explicit "replace me" marker (mirroring the hot-tier `STARTER:` convention), since the review prompts and `update-arch-docs` skill never mention the placeholder. No **HOT** (`lessons-critical.md`) change: these are scaffold-convention reference tips, not behavior-changing rules warranting a capped slot.

## Things to Look At During PR Review

- **`COLD_TIER_FILES` is a `{ src, dest }` mapping** (`arch.starter.md` → `arch.md`), unlike the hot tier's same-name copy. This is deliberate: the plain `templates/arch.md` is the rich reference template (with a "this file is not copied into projects" note) and must NOT be the copied starter, so the minimal starter lives in a separate `*.starter.md` source.
- **`copyHotTierDefaults` is untouched** — the cold function is a sibling, so the load-bearing Spec 987 hot path carries zero risk from this change.
- **`update` backfill**: cold files are already in `USER_DATA_PATTERNS` (`templates.ts`), so update's clean step never overwrote them; this change makes update *create* the missing ones (consistent with how 987 backfills the hot files).
- **3-way consult outcome**: Gemini APPROVE (HIGH), Codex APPROVE (HIGH), Claude COMMENT (HIGH). Claude's COMMENT flagged apparent removals of unrelated governance entries (#859 from arch.md, #913 from lessons-learned.md). **Verified false positive**: `git diff <merge-base>...HEAD` showed the governance edits are purely additive (no removals); the branch was simply behind main, and those entries were added to main after the branch point. Resolved by rebasing onto current main — the branch is now 0 commits behind, `#859` is present, and the net governance diff remains additive (arch.md +1 sentence, lessons-learned.md +2 entries).

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder pir-1012 → **Review Diff**
- **What to verify**:
  1. `pnpm build` (from worktree root), then `node packages/codev/dist/cli.js init /tmp/p --yes` → inspect `/tmp/p/codev/resources/` (all four `.md` present; `arch.md`/`lessons-learned.md` carry the `STARTER:` marker; no `.starter.md` files).
  2. In a codev project missing the cold files, `codev update` backfills both; a customized `arch.md` survives byte-identical.
  3. `codev update --dry-run` writes nothing.
