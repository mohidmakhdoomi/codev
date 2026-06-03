# PIR Review: Hold last-known-good overview data so the VSCode sidebar doesn't flicker empty

Fixes #916

## Summary

The Codev VSCode sidebar intermittently blanked all four data-bearing views (Builders, Backlog, Pull
Requests, Recently Closed) at once while the Workspace view stayed populated, then recovered on its own.
Root cause: the shared `OverviewCache.refresh()` overwrote populated data with `null` on a *transient*
read — a not-`connected` connection state or a failed `/api/overview` fetch — and every provider renders
a falsy cache read as an empty list. The fix makes the cache **hold last-known-good**: transient reads
no longer clobber the cache, only a successful fetch commits, and the cache re-syncs the moment the
connection is re-established.

## Files Changed

(`git diff --stat` vs merge-base `083996ce`)

- `packages/vscode/src/views/overview-data.ts` (+35 / -8) — the fix: last-known-good retention + disposable cleanup
- `packages/vscode/src/__tests__/overview-cache.test.ts` (+196 / -0) — new vitest suite (8 tests)
- `codev/plans/916-vscode-sidebar-data-builders-b.md` (+149) — plan
- `codev/state/pir-916_thread.md` (+71) — builder thread
- `codev/resources/lessons-learned.md` (+2) — one durable lesson

## Commits

(`git log main..HEAD --oneline`, implementation commits only)

- `a3a34ec0` [PIR #916] Hold last-known-good overview data; refresh on reconnect
- `51fd71e6` [PIR #916] Add OverviewCache last-known-good retention tests
- `728963a9` [PIR #916] Plan revised: re-verify line refs after rebase on main
- `a1e52fa1` [PIR #916] Plan draft

(Plus a `[PIR #916] Review + retrospective` commit carrying this file and the lessons-learned update.)

## Test Results

- `pnpm --filter codev-vscode check-types` (tsc --noEmit): ✓ pass
- `pnpm --filter codev-vscode lint` (eslint): ✓ pass
- `pnpm --filter codev-vscode test:unit` (vitest): ✓ 21 files / 269 tests pass (8 new in `overview-cache.test.ts`)
- Porch gate `checks`: build ✓ (6.0s), tests ✓ (20.6s)
- Manual verification: human reviewed at the `dev-approval` gate.

> Note: a fresh worktree needs `pnpm install` + a build of `@cluesmith/codev-types` / `@cluesmith/codev-core`
> before vitest can resolve those packages — without it, 6 unrelated test files (anything importing the
> types package) fail to *load*. That is an environment prerequisite, not a code regression.

## Architecture Updates

No `arch.md` changes — this is a behavioral fix entirely within the existing `OverviewCache` component
(`packages/vscode/src/views/overview-data.ts`). No module boundaries, data sources, or sidebar structure
changed: the four data-views still share the same cache, and `WorkspaceProvider` still reads its own
sources. The durable behavioral contract that emerged ("hold last-known-good; don't null on transient
failure") is recorded in `lessons-learned.md` rather than `arch.md`, since it's a maintenance invariant
of one method, not a structural fact.

## Lessons Learned Updates

Added one entry to `codev/resources/lessons-learned.md` (`[From 916]`): a shared cache that nulls itself
on a transient failure correlates the failure across every consumer at once; hold last-known-good and
distinguish *failure-null* from *legitimately-empty*. It also captures the discriminating diagnostic —
when N sibling views empty together but one (Workspace) doesn't, suspect a shared dependency of the N
rather than N independent bugs. That observation is what ruled out the Tower-side empty-payload theory
(Builders is filesystem-sourced, so a `gh` failure can't empty it with a live fleet on disk).

## Things to Look At During PR Review

- **The `null`-means-failure contract.** The fix treats a `null` from `getOverview()` as "transient
  failure, keep last value." This is safe only because `TowerClient.getOverview()`
  (`packages/core/src/tower-client.ts:314-318`) returns `null` *only* on `!result.ok`; a genuinely empty
  workspace returns an `OverviewData` with empty arrays. If that contract ever changes (e.g. `getOverview`
  starts returning `null` for a valid-but-empty state), legitimate emptiness would stop rendering. The
  "commits a valid empty overview" test pins the empty-arrays-still-render behavior.
- **`latestSeq` left intact.** The pre-existing last-write-wins counter solves request *ordering* and is
  orthogonal to this change (which guards the *value* committed). I kept it and its doc comment verbatim;
  worth confirming the two interact as intended (a dropped-but-good in-flight fetch is benign — last value
  retained, next event refreshes).
- **Freshen-on-reconnect is the extension's existing path, not new code here.** The plan originally
  proposed adding an `onStateChange → 'connected'` subscription inside `OverviewCache`. The 3-way
  consultation (Codex) correctly flagged that `extension.ts:467-469` *already* does
  `onStateChange('connected') → overviewCache.refresh()`, so a cache-side subscription would issue a
  duplicate `/api/overview` fetch on every reconnect (`latestSeq` dedupes the commit but not the request).
  I removed the cache-side subscription; freshen-on-reconnect behavior is unchanged (provided by the
  existing extension wiring). This is the one deviation from the approved plan.
- **`onDidChange` is not fired on transient reads.** Beyond retaining the data, `refresh()` now only fires
  the change event on a successful commit — a transient not-connected/failed read fires nothing, so
  providers are never asked to re-render mid-blip. Pinned by three explicit fire/no-fire tests.
- **Trade-off by design.** If Tower is down for a long time, the sidebar now shows *stale* fleet data
  rather than blanking. This is the issue's stated acceptance ("hold last-known-good"). A distinct
  "disconnected" visual treatment for the data-views is intentionally out of scope.
- **Repro is intermittent.** The original flicker is hard to reproduce on demand; the unit suite is the
  durable guard, and the manual check is "data is visibly *held* across a simulated blip."

### 3-Way Consultation Disposition (single advisory pass)

Gemini: APPROVE · Claude: APPROVE · Codex: **REQUEST_CHANGES**. PIR's consult is a single pass and does
**not** re-review — so the human at the `pr` gate is the only remaining check on the changes below.
Both Codex findings were **addressed in code** (commit after the consult; see git history):

1. *Duplicate reconnect refresh.* Removed the cache-side `onStateChange` subscription that duplicated
   `extension.ts:467-469`. (Detailed above under "Freshen-on-reconnect…".)
2. *Missing no-fire test assertion.* Added three tests pinning that `onDidChange` fires only on a
   successful commit, never on a transient not-connected / failed read — covering the plan's
   "do not render an empty children array as a transient response" invariant at the event level.

Net test delta: removed two tests that asserted the now-deleted cache-side reconnect subscription; added
three `onDidChange` fire/no-fire tests (7 → 8 in this file; suite 268 → 269). Verbatim verdicts:
`codev/projects/916-vscode-sidebar-data-builders-b/916-review-iter1-{gemini,codex,claude}.txt`.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-916` → **View Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-916`
- **What to verify** (mapped to the plan's Test Plan):
  - With a live fleet, the four data-views populate normally.
  - Simulate a transient blip (stop/restart Tower, or toggle network so the SSE drops then reconnects):
    the four data-views **retain** their last data instead of blanking, and freshen promptly on reconnect.
  - A genuinely empty section (e.g. no open PRs) still renders empty.
  - `pnpm --filter codev-vscode test:unit` — the `overview-cache.test.ts` suite is green.
