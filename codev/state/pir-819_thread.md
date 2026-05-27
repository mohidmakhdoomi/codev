# pir-819 thread

## Plan phase — 2026-05-26

Drafted `codev/plans/819-core-parsearealabels-helper-fl.md` and pushed.

### Scope this PIR

Pure scaffolding for the `area/*` namespace — no UI consumers in this issue (those land in #811 backlog grouping and #818 builders tree grouping). Lands:

- `parseAreaLabels` helper in `packages/codev/src/lib/github.ts`
- `areas: string[]` field on `BacklogItem`, `BuilderOverview` (server-internal) and `OverviewBacklogItem`, `OverviewBuilder` (wire contracts) — required, never undefined
- `resolvePrimaryArea` policy helper in `packages/core/src/builder-helpers.ts`
- Unit tests in `packages/codev/src/__tests__/github.test.ts` + new builder-helpers test

### Non-obvious finding for the reviewer

Issue body §B (defensive `??= []` at cache serve-out OR cache invalidation on restart) is **already structurally satisfied** — `OverviewCache` only holds raw forge responses (`ForgePR[]`, `ForgeIssueListItem[]`), never derived `BacklogItem` / `BuilderOverview` objects. Those shapes are reconstructed fresh from raw cache entries on every `getOverview` call. No code added for §B; called out in the plan's Risks section so the reviewer knows where to look (and isn't surprised by its absence in the diff).

Awaiting `plan-approval`.

## Plan phase — follow-up

User flagged the mixed-separator state (`type:` / `priority:` colon vs `area/` slash) as a real concern. Chose option D: ship #819 as the spec calls for, file a follow-up to relitigate separators globally. Filed **#869** ("Label namespace separator: resolve mixed colon-vs-slash convention") — unassigned, `area/core` label, lays out options A (all-slash), B (all-colon), C (stay mixed) plus a "verify the web-dashboard pathway compatibility constraint" callout. Plan revised to reference #869 under Risks & Alternatives → Open question.

## Implement phase — 2026-05-27

Plan approved. Implemented in four commits matching the plan's logical units:

- `da040105` — `parseAreaLabels` helper + 10 unit tests (no labels, null/undefined/empty-string defensive paths, single area, mixed-namespace, alphabetical sort, dedup, cross-cutting alongside others, bare `area` rejected, `area:` separator-typo rejected).
- `fc8b3001` — `resolvePrimaryArea` helper in `packages/core/src/builder-helpers.ts` + 5 tests in `packages/vscode/src/test/builders.test.ts` (existing home of `isIdleWaiting` tests).
- `763d8170` — wire `areas[]` through `BacklogItem` and `BuilderOverview`: type declarations, `areas: []` init at all 3 `discoverBuilders` push sites, `parseAreaLabels(issue.labels)` populate in `deriveBacklog`, parallel `issueAreasMap` join in `getOverview` enrichment loop (refactored alongside existing `issueTitleMap` join for clarity).
- `6e90f5c6` — wire-contract `areas: string[]` field on `OverviewBuilder` and `OverviewBacklogItem` in `packages/types/src/api.ts`.

Verification:
- `pnpm -w build` — green (full workspace incl. dashboard)
- `pnpm --filter codev-vscode run check-types` — green (covers `builders.test.ts` with `resolvePrimaryArea` tests)
- `pnpm --filter @cluesmith/codev test src/__tests__/github.test.ts` — 66 tests pass (10 new)
- `pnpm --filter @cluesmith/codev test` (full) — 3149 tests pass, 13 pre-existing skips, no regressions

Branch pushed. Awaiting `dev-approval`.

## Implement phase — design revision (2026-05-27)

User caught the design smell during dev-approval review: `BacklogItem.areas: string[]` permitted multi-area at the data layer while `resolvePrimaryArea` immediately collapsed it to a single bucket at the UI boundary. Two operations cancelling each other out — pointing to a misalignment between the data shape and the project convention ("one `area/` per issue; `area/cross-cutting` is the explicit multi-area marker", per `feedback_single_area_per_issue.md` memory). The array shape was inherited from the issue body without questioning whether it matched the project's existing convention.

Revised to single-area at the parser (option B from the conversation):

- `1142aee99` — `parseAreaLabels: (...) => string[]` → `parseArea: (...) => string`. Parser now projects once at the boundary: `'cross-cutting'` if present, else first alphabetical, else `'Uncategorized'`. Symmetric with `parseLabelDefaults`'s single-string `type` / `priority` returns. Tests rewritten for single-string outputs (12 cases, +1 from the previous 10).
- `df442ca8` — deleted `resolvePrimaryArea` from `packages/core/src/builder-helpers.ts` and its 5-case suite from `packages/vscode/src/test/builders.test.ts`. The function had no callers — its job is now done at the parser.
- `5c8800f8` — `BacklogItem.areas: string[]` → `BacklogItem.area: string`; same for `BuilderOverview`. 3 `discoverBuilders` push sites now init `area: 'Uncategorized'`. `getOverview` enrichment loop renamed `issueAreasMap` → `issueAreaMap`.
- `7cf2d8cb` — same shape change on the wire-contract types in `packages/types/src/api.ts`.

Plan header updated with a revision note explaining the change.

Re-verification: build ✓, github tests (67 pass, +1) ✓, vscode check-types ✓. Net diff vs original revised design: ~30 LOC smaller (deleted helper + simpler test cases offset the unchanged parser body).

Still at `dev-approval`.

## Implement phase — cross-cutting privilege removed (2026-05-27)

User flagged that the parser still baked in a semantic convention about a specific label name (`if (areas.includes('cross-cutting')) return 'cross-cutting'`). Stripped: parser is now policy-free about which `area/*` value any team uses. First alphabetical wins; `'Uncategorized'` fallback. Codev framework code shouldn't impose its own conventions on teams using Codev — they pick their own labeling semantics.

Changes:
- Removed the `cross-cutting` privilege line from `parseArea`.
- Dropped two `cross-cutting`-specific test cases; added one explicit no-privilege regression-guard that uses `area/cross-cutting` as fixture data alongside other areas and asserts first-alphabetical wins regardless.
- Stripped docstring references to `cross-cutting` from `parseArea`, `BacklogItem.area`, `BuilderOverview.area` (server-internal), and `OverviewBacklogItem.area` / `OverviewBuilder.area` (wire-contract). Docstrings now only describe the mechanical behavior ("first-alphabetical wins; `'Uncategorized'` when no `area/*` labels").

Re-verification: build ✓, github tests (66 pass, net −1 from previous since two cross-cutting tests collapsed into one no-privilege guard) ✓.

Still at `dev-approval`.

## Implement phase — `'Uncategorized'` extracted to shared constant (2026-05-27)

User flagged: the `'Uncategorized'` literal was hardcoded in two places (parser fallback in `parseArea`, and the three `discoverBuilders` builder-init sites). Extracted to `UNCATEGORIZED_AREA` in `packages/core/src/constants.ts` (alongside `DEFAULT_TOWER_PORT`, `AGENT_FARM_DIR`). Both `github.ts` and `overview.ts` now import and reference the constant. Downstream UI consumers (dashboard, vscode) that ever want to filter/match against the default can import the same constant — single source of truth.

Build ✓, tests still 66/66 ✓.

Still at `dev-approval`.

## Review phase — 2026-05-27

`dev-approval` approved. Wrote `codev/reviews/819-core-parsearealabels-helper-fl.md` (commit `12f98fca`) with Summary, Files Changed, Commits, Test Results, Architecture Updates (none — no new boundaries), Lessons Learned Updates (no `lessons-learned.md` edits; the two principles surfaced went to the project's memory system instead via `feedback_framework_neutral_on_label_semantics.md`), Things to Look At, and How to Test Locally sections.

Opened PR #876 against main using the review file as the body. Recorded with porch (`porch done 819 --pr 876 --branch builder/pir-819`).

**Mid-PIR merge from origin/main**: user flagged a merge conflict. Fetched and merged `origin/main` (de4b060d) into the branch. Conflicts in two files, both stemming from the same upstream change — bugfix #872 added a `prReady: boolean` field to `OverviewBuilder` at the same position my PIR added `area: string`. Both fields are independent; resolved by keeping both. Three more conflicts in `discoverBuilders` push sites (same shape — `area: UNCATEGORIZED_AREA` and `prReady: false`/`derivePrReady(parsed)` both added at end of each push site). Resolved keeping both. Merge commit `6254a9c3`; pushed.

Re-verification post-merge: `pnpm -w build` ✓, `pnpm --filter @cluesmith/codev test src/__tests__/github.test.ts` ✓ (66 tests), `pnpm --filter @cluesmith/codev test` (full) ✓ (3172 tests pass, +23 from bugfix-872's new tests, 13 pre-existing skips, no regressions).

**3-way consultation results** (PIR single-pass, `max_iterations: 1`):
- **Claude**: APPROVE.
- **Codex**: COMMENT (two accuracy findings on the review file — files-changed count was 9 not 10 because I forgot to include the review file itself, and the `import { parseArea } from '@cluesmith/codev'` example was wrong since `parseArea` isn't exported from the package root). Both addressed in commit `234e88bc`. PR body re-uploaded.
- **Gemini**: persistently failing — three consecutive `consult -m gemini` attempts exited code 1 with opaque `[object Object]` error in ~2-4s, no output file written. The `[warn] Failed to extract usage for gemini: Unexpected end of JSON input` suggests Gemini API returned an empty/malformed body. Not a code issue — looks like an API/auth/quota problem with the `consult` CLI's Gemini path. Architect notified via `afx send` for direction (skip / retry later / investigate).

Porch currently blocking on Gemini producing an output. PR gate not yet pending — `porch next 819` reports `status: tasks` requesting another Gemini attempt.

### Architect directive — Gemini skip

Architect responded with explicit directive: skip Gemini, advance to pr gate. Root cause confirmed architect-side — `consult` CLI is hardcoded to `gemini-3-pro-preview` which Google has retired (`ModelNotFoundError`). Tracking the model-identifier bump as a separate `area/consult` bug. Standing: Codex=COMMENT addressed, Claude=APPROVE, 2/2 favorable; Gemini's absence is infra failure not signal.

Executed:
- Wrote `819-review-iter1-gemini.txt` with `VERDICT: SKIPPED` + the architect's directive verbatim for audit trail.
- Porch parsed SKIPPED as REQUEST_CHANGES (anything non-APPROVE/COMMENT does); wrote `819-review-iter1-rebuttals.md` documenting the architect-directed skip + Codex's addressed COMMENT + Claude's APPROVE.
- `porch done 819` → checks green → `porch gate 819` → **pr gate now pending**.
- Notified architect via `afx send` that pr gate is pending and ready for human approval.

Consult artifacts (`819-review-iter1-*.txt`, `-rebuttals.md`) live in the worktree only — they're gitignored per codev convention; the audit trail stays in the worktree until cleanup.

Awaiting `pr` gate approval; on approval, will merge via `gh pr merge --merge` then `porch done 819 --merged 876`.
