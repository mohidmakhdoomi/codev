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

So the fix shrinks from the original "invent `createResourcesDir` with inline placeholder content" to: **add a cold-tier sibling to `copyHotTierDefaults` and wire it in at the same three sites.**

## Proposed Change

Mirror the proven 987 hot-tier path for the cold tier.

1. **`scaffold.ts`** — add, directly below `HOT_TIER_FILES` / `copyHotTierDefaults`:
   - `export const COLD_TIER_FILES = ['arch.md', 'lessons-learned.md'] as const;`
   - `export function copyColdTierDefaults(targetDir, skeletonDir, options)` — byte-for-byte structural mirror of `copyHotTierDefaults`: ensure `codev/resources/` exists, copy each cold file from `skeletonDir/templates/`, honor `skipExisting`, return `{ copied, skipped }`.

2. **Wire into the three commands**, immediately after each existing `copyHotTierDefaults` call (so cold files are materialized alongside hot, with identical logging/`fileCount`/`result.newFiles` handling):
   - `init.ts:~117` — `copyColdTierDefaults(targetDir, skeletonDir)` (no skip).
   - `adopt.ts:~159` — `copyColdTierDefaults(targetDir, skeletonDir, { skipExisting: true })`.
   - `update.ts:~263` — `copyColdTierDefaults(targetDir, templatesDir, { skipExisting: true })`, inside the same `dryRun` if/else, pushing to `result.newFiles` and logging `+ (new)`. Extend the dry-run message to mention `{arch,lessons}.md` too.

### Content decision: copy the skeleton templates (NOT inline minimal placeholders)

The original issue asked for *trivial inline* starter content and argued against seeding heavyweight generic content. **That preference predates Spec 987 and I propose overriding it**, for three reasons:

1. **Consistency**: 987 established that resource starters come from `skeleton/templates/` via a `copy*TierDefaults` function. Inventing a second mechanism (inline string constants) for the cold tier would be an inconsistent oddity sitting right next to the hot-tier code.
2. **The skeleton already ships curated cold starters**: `templates/arch.md` (126 lines) and `templates/lessons-learned.md` (66 lines) are proper "how to use this doc" stubs with section scaffolding and "skip if N/A" hints — more useful to a new project than a one-line `_No architecture documented yet._`.
3. **The hot tier points into the cold tier**: the hot template's cold-doc map expects `arch.md` to have real top-level sections to map onto. A skeletal-but-structured cold file satisfies that; a one-liner does not.

**This is the main judgment call and I want your explicit sign-off at the gate.** If you prefer the issue's original minimal-inline content, say so and I'll seed trivial placeholders instead (still via `copyColdTierDefaults`, just sourcing inline strings rather than the skeleton files — or I trim the skeleton templates down).

### Why a sibling function, not a generalization

I considered refactoring `copyHotTierDefaults` into a generic `copyResourceDefaults(files, …)` called twice. Rejected: 987 landed days ago and its hot path is load-bearing (porch injection + managed-block depend on it). A parallel `copyColdTierDefaults` is lower-risk, reads symmetrically, and keeps the 987 code untouched. The minor duplication is acceptable and easy to fold later if desired.

## Files to Change

- `packages/codev/src/lib/scaffold.ts` — add `COLD_TIER_FILES` + `copyColdTierDefaults` (~25 LOC, mirrors lines 147-190).
- `packages/codev/src/commands/init.ts` — import + call after `copyHotTierDefaults` (~line 117).
- `packages/codev/src/commands/adopt.ts` — import + call after `copyHotTierDefaults` (~line 159).
- `packages/codev/src/commands/update.ts` — import + call inside the hot-tier `dryRun` block (~line 263); extend dry-run log line.
- `packages/codev/src/__tests__/hot-tier-materialization.test.ts` (or a new parallel `cold-tier-materialization.test.ts`) — mirror the two unit tests (`copies both cold files` / `skip-existing preserves a curated copy`) and the update-integration test (`update creates the cold files`) for the cold tier.
- `packages/codev/src/__tests__/init.test.ts:74` — replace the stale comment ("resources/ is NOT created in minimal structure") with positive assertions that all four resource files exist after init.
- `packages/codev/src/__tests__/adopt.test.ts` — assert cold files appear after adopt.

Estimated net diff: ~30 LOC source + ~70 LOC tests.

## Risks & Alternatives Considered

- **Content-source deviation from the issue** (skeleton templates vs inline minimal). Documented above; gated on your approval. Will be recorded in the review file as a deliberate, approved deviation.
- **Risk: the skeleton cold templates drift / are seen as "too heavy."** Mitigated by the fact they're already the canonical MAINTAIN-curated stubs; if they're too heavy that's a separate skeleton-content concern, not a scaffold-wiring concern.
- **Risk: stale negative assertions break.** `init.test.ts:74` is only a comment (no assertion), so no breakage; I update it to a positive assertion. Full suite run will confirm nothing else asserts absence.
- **`copyResourceTemplates` remains dead code** (987's own comment flags it as such). Out of scope here; flagged for the architect to retire separately if desired.
- **Alternative: do nothing in `update`** (init/adopt only). Rejected — update is the only command that reaches pre-987/pre-fix projects, and 987 already backfills the hot tier there; leaving the cold tier out would be asymmetric and re-open the gap for existing projects.
- **Alternative: generalize `copyHotTierDefaults`.** Rejected (see above) to protect the freshly-landed 987 code.

## Test Plan

- **Unit**: `copyColdTierDefaults` copies both cold files (creating `resources/`); `skipExisting` preserves a curated `arch.md` while creating the missing sibling.
- **Unit (init)**: `init --yes` yields all four `codev/resources/*.md` files.
- **Unit (adopt)**: `adopt --yes` on a plain repo yields the cold files.
- **Integration (update)**: update on a project missing the cold files creates both and reports them in `result.newFiles`; a customized `arch.md` survives byte-identical while `lessons-learned.md` is created; `--dry-run` writes nothing. (Mirror the existing hot-tier update integration test.)
- **Build + full suite**: `pnpm --filter @cluesmith/codev build && pnpm --filter @cluesmith/codev test` from the worktree.
- **Manual (dev-approval reviewer)**:
  1. Build, then run the built CLI `init` into a temp dir; confirm output lists `+ codev/resources/arch.md` and `+ codev/resources/lessons-learned.md` alongside the hot files.
  2. `cat` both cold files — present and readable (the original failure mode is gone).
  3. In a codev project missing the cold files (pre-fix simulation), run `codev update`; confirm both are backfilled and a pre-existing customized `arch.md` is untouched.
