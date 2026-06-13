# PIR Plan: `codev init` bootstraps `codev/resources/` cold-tier files (arch.md + lessons-learned.md)

> **Rebased on main 2026-06-13.** Spec 987 (two-tier governance docs) landed since this plan was first drafted and changes the picture materially. This revision re-scopes the work to ride the 987 rails. See "What Spec 987 already did" below.

## Understanding

The issue: fresh `codev init` projects have no `codev/resources/arch.md` or `lessons-learned.md`, so review prompts that read them error out.

### What Spec 987 already did (post-rebase reality)

Spec 987 introduced a **hot/cold two-tier** governance-doc model and, as part of it, wired resource materialization into init/adopt/update — but **only for the HOT tier**:

- `copyHotTierDefaults()` (`scaffold.ts:161`) copies skeleton `templates/arch-critical.md` + `templates/lessons-critical.md` into `codev/resources/`, with `skipExisting` for adopt/update. It is called at all three sites:
  - `init.ts:117` (no skip — fresh project)
  - `adopt.ts:159` (`skipExisting: true`)
  - `update.ts:263` (`skipExisting: true`, with a `dryRun` branch + `result.newFiles` reporting)
- `update` already **backfills** missing hot files for existing adopters (`update.ts:258-268`). The "should update touch resources?" question we discussed at the gate is therefore already settled in the codebase: backfill-missing-only via `skipExisting` is the shipped house style.
- The COLD files `resources/arch.md` and `resources/lessons-learned.md` are **already registered as protected user data** (`templates.ts:83-84`), so update's clean step will never overwrite them — they're just never *created*.

### What's still broken (the residual #1012 gap)

The **COLD** files are still not materialized by any command. The review prompts reference them directly:

- `spir/prompts/review.md:156` — "Read `arch-critical.md` (hot) and **skim `arch.md`** (cold)."
- `spir/prompts/review.md:163` — skim `lessons-learned.md` (cold).
- `pir/prompts/review.md:88,99-100` — routes changes into / `git add`s `arch.md` and `lessons-learned.md`.

Beyond the prompts, the cold files are the **archive that the hot-tier maps point into**: each hot template carries a "Map of arch.md (consult when…)" section that directs readers into `arch.md`. Materializing the cold tier is the coherent completion of 987's model, not just an error-avoidance patch.

So the fix is: **materialize a minimal placeholder for each cold file, wired into the same three commands that 987 already uses to materialize the hot tier.**

## Proposed Change

### Content decision (gate-approved): one-line placeholders, skeleton templates untouched

The materialized cold files are **minimal placeholders**, using the issue's suggested text verbatim:

`codev/resources/arch.md`:
```markdown
# Architecture

This document evolves as the project grows. Update it during the review phase of any work that introduces or changes architectural patterns.

_No architecture documented yet._
```

`codev/resources/lessons-learned.md`:
```markdown
# Lessons Learned

Durable engineering wisdom captured across the project's work. Update it during the review phase of any work that surfaces a generally-applicable pattern, gotcha, or constraint.

_No lessons captured yet._
```

**Consequence — the skeleton templates are NOT edited.** A placeholder has no skeleton file worth copying, so we do not copy `templates/arch.md`/`lessons-learned.md` and therefore do not need to trim their self-referential "Note on propagation" / MAINTAIN footer. The rich skeleton templates stay exactly as-is, preserving the manual-`cp` escape hatch they document. This is simpler and lower-risk than the copy-and-trim approach considered earlier.

**Why a small inline write is correct here, not a "forked mechanism":** the hot tier *copies* because its skeleton files (`arch-critical.md`/`lessons-critical.md`) are genuine, curated starters meant to land verbatim. The cold tier *writes a placeholder* because the desired content is an intentionally-trivial stub with no skeleton equivalent. Each tier uses the minimal mechanism its content nature calls for; there is no second copy of the *same* logic.

### Implementation

1. **`scaffold.ts`** — add a `createColdTierDefaults(targetDir, options)` function next to `copyHotTierDefaults` (Spec 987's materialization neighborhood):
   - A `COLD_TIER_STARTERS` map of `{ 'arch.md': <placeholder>, 'lessons-learned.md': <placeholder> }` (two short const strings).
   - Ensure `codev/resources/` exists; for each entry, **skip if the file already exists**, else `writeFileSync` the placeholder. Return `{ created, skipped }` matching the existing result-shape convention.
   - No `skeletonDir` parameter (nothing is copied).

2. **Wire `createColdTierDefaults` into the three commands**, immediately after each existing `copyHotTierDefaults` call, with identical logging / `fileCount` / `result.newFiles` handling:
   - `init.ts:~117` — `createColdTierDefaults(targetDir)` (no skip; fresh project).
   - `adopt.ts:~159` — `createColdTierDefaults(targetDir, { skipExisting: true })`.
   - `update.ts:~263` — `createColdTierDefaults(targetDir, { skipExisting: true })`, inside the same `dryRun` if/else, pushing created files to `result.newFiles` / logging `+ (new)`. Extend the dry-run message to mention `{arch,lessons}.md`.

   `update` backfilling missing cold files is consistent with the shipped 987 behavior (it already backfills missing hot files there via `skipExisting`); the cold files are already protected user-data (`templates.ts:83-84`), so a customized cold file is never overwritten.

## Files to Change

- `packages/codev/src/lib/scaffold.ts` — add `COLD_TIER_STARTERS` + `createColdTierDefaults` (~20 LOC). **Skeleton templates untouched.**
- `packages/codev/src/commands/init.ts` — import + call `createColdTierDefaults` after `copyHotTierDefaults` (~line 117).
- `packages/codev/src/commands/adopt.ts` — same (~line 159, `skipExisting`).
- `packages/codev/src/commands/update.ts` — same, inside the hot-tier `dryRun` block (~line 263); extend dry-run log line.
- `packages/codev/src/__tests__/hot-tier-materialization.test.ts` (or a new parallel `cold-tier-materialization.test.ts`) — unit tests: `createColdTierDefaults` creates both placeholder files (and the dir); `skipExisting` preserves a curated cold file; an update-integration test that `update` backfills the cold files into a project missing them.
- `packages/codev/src/__tests__/init.test.ts:74` — replace the stale comment ("resources/ is NOT created in minimal structure") with positive assertions that all four resource files exist after init.
- `packages/codev/src/__tests__/adopt.test.ts` — assert cold files appear after adopt.

Estimated net diff: ~20 LOC source + ~70 LOC tests. No skeleton or framework-template changes.

## Risks & Alternatives Considered

- **Content-source deviation from the issue**: none — this uses the issue's suggested placeholder text verbatim.
- **Risk: stale negative assertions break.** `init.test.ts:74` is only a comment (no assertion), so no breakage; I update it to a positive assertion. Full suite run will confirm nothing else asserts absence.
- **`copyResourceTemplates` remains dead code** (987's own comment flags it as such). Out of scope here; flagged for the architect to retire separately if desired.
- **Alternative: copy + trim the rich skeleton templates.** Rejected in favor of placeholders — copying drags the rich framework template (and its now-false propagation note) into every project, and the issue explicitly preferred minimal placeholder content.
- **Alternative: do nothing in `update`** (init/adopt only). Rejected — update is the only command that reaches pre-987/pre-fix projects, and 987 already backfills the hot tier there; leaving the cold tier out would be asymmetric and re-open the gap for existing projects.
- **Alternative: generalize `copyHotTierDefaults` into a shared copy helper.** Not applicable now — the cold tier writes placeholders rather than copying, so there is no shared copy body to extract. `copyHotTierDefaults` is left completely untouched (zero risk to the load-bearing 987 hot path).

## Test Plan

- **Unit**: `createColdTierDefaults` writes both placeholder files (creating `resources/`); `skipExisting` preserves a curated `arch.md` while creating the missing sibling.
- **Unit (init)**: `init --yes` yields all four `codev/resources/*.md` files.
- **Unit (adopt)**: `adopt --yes` on a plain repo yields the cold files.
- **Integration (update)**: update on a project missing the cold files creates both and reports them in `result.newFiles`; a customized `arch.md` survives byte-identical while `lessons-learned.md` is created; `--dry-run` writes nothing. (Mirror the existing hot-tier update integration test.)
- **Build + full suite**: `pnpm --filter @cluesmith/codev build && pnpm --filter @cluesmith/codev test` from the worktree.
- **Manual (dev-approval reviewer)**:
  1. Build, then run the built CLI `init` into a temp dir; confirm output lists `+ codev/resources/arch.md` and `+ codev/resources/lessons-learned.md` alongside the hot files.
  2. `cat` both cold files — present and readable (the original failure mode is gone).
  3. In a codev project missing the cold files (pre-fix simulation), run `codev update`; confirm both are backfilled and a pre-existing customized `arch.md` is untouched.
