# PIR Plan: Backlog tree title-count reflects active view mode

## Understanding

The Backlog view's title is rendered as `Backlog (<count>)` at `packages/vscode/src/extension.ts:184`, where `<count>` is the total spawnable issue count (`spawnableBacklog(data.backlog).length`). Since #809 added a mine-only / show-all toggle, the tree below the title only renders the **current view mode's** rows — but the title-count still shows the unfiltered total in **both** modes.

Result: a fresh install opens to mine-only mode and shows a title like `Backlog (47)` while only 3 rows are visible — disorienting. The eye icon hints at the mode, but the title-count is the most prominent integer on the view, and right now it disagrees with what's visible.

Two coupled gaps to close:
1. **The count itself** — it always reads the unfiltered total, ignoring the filter mode.
2. **The refresh trigger** — `updateListViewTitles()` is wired into the overview-data listener at `extension.ts:243-248`, but flipping `codev.backlogShowAll` doesn't go through that listener. So even if (1) is fixed, the title would still stay stale until the next overview refresh fired.

## Proposed Change

Implement **option 2** from the issue's proposed-fix list (the architect's mild preference): `Backlog (3 of 47)` when mine-only, `Backlog (47)` when show-all. Surfaces both numbers; the "of 47" signals "there are more, click the eye to see them" without needing the user to click the toggle to confirm. Doesn't add a redundant mode label (the eye icon already labels the mode).

Edge case: when mine-only is active but `currentUser` is null (gh unavailable), `filterMine` is a no-op (per #809's safety branch), so visible count == total. In that case, fall back to plain `Backlog (47)` — no point rendering `Backlog (47 of 47)`.

Concretely:

1. **New pure helper** `visibleBacklogCount(data, showAll)` in `packages/vscode/src/views/backlog-filter.ts`. Takes overview data and the show-all flag; returns `{ visible, total }`. Mirrors `orderedSpawnable`'s filter chain (`spawnableBacklog` → conditionally `filterMine`) but only counts. Lives next to `filterMine` (same file, same vscode-free constraints) so it's unit-testable in the vitest harness.

2. **Title formatter** `formatBacklogTitle(visible, total)` — also in `backlog-filter.ts`, also vscode-free. Returns `Backlog` (no data), `Backlog (N)` (visible == total), or `Backlog (V of T)` (visible < total). Pure string function — cheap to test exhaustively.

3. **Wire the helper into `updateListViewTitles()`** at `extension.ts:178-186`. Replace the inline `spawnableBacklog(data.backlog).length` with a call to `visibleBacklogCount` + `formatBacklogTitle`. Read `codev.backlogShowAll` via the existing `readBacklogShowAll` reader (lifted from its current inner-scope position at line 358-359 to module scope or hoisted earlier in `activate`, so `updateListViewTitles` can see it — see Files to Change).

4. **Add `updateListViewTitles()` to the showAll-config-change listener** at `extension.ts:361-367`. Right now that listener calls `backlogProvider.refresh()` to redraw the tree rows; it also needs to call `updateListViewTitles()` so the title-count updates in lockstep.

Why not put the helper in `backlog.ts`? Because `backlog.ts` imports `vscode` (it defines `BacklogProvider` which extends a vscode interface). The whole point of `backlog-filter.ts` is to keep pure helpers vitest-testable without the vscode mock dance. Same precedent as `filterMine`.

## Files to Change

- `packages/vscode/src/views/backlog-filter.ts` — add `visibleBacklogCount(data, showAll)` and `formatBacklogTitle(visible, total)` helpers next to `filterMine`. The `data` parameter is typed as `Pick<OverviewData, 'backlog' | 'currentUser'>` so the helper has the minimum surface area it needs and is easy to test with bare objects.
- `packages/vscode/src/extension.ts:178-186` — `updateListViewTitles()` reads showAll and calls the new helpers for the backlog row.
- `packages/vscode/src/extension.ts:353-367` — re-order so `readBacklogShowAll` is declared *before* `updateListViewTitles` is wired (or hoist `readBacklogShowAll` to a top-of-`activate` const, matching how `readFileViewAsTree` is already structured). Add `updateListViewTitles()` to the showAll-config-change listener body.
- `packages/vscode/src/__tests__/backlog-filter.test.ts` — extend the existing test file with cases for `visibleBacklogCount` and `formatBacklogTitle`:
  - mine-only + currentUser known: visible reflects filterMine
  - mine-only + currentUser null: visible == total (the safety fallthrough)
  - show-all: visible == total
  - title format: no data → `Backlog`; equal counts → `Backlog (N)`; unequal counts → `Backlog (V of T)`
  - spawnable-vs-raw: items with `hasBuilder: true` excluded from both `visible` and `total` (mirrors `spawnableBacklog`'s contract)
  - empty backlog: returns `{ visible: 0, total: 0 }`, title is `Backlog (0)`

No changes to:
- `backlog.ts` itself — `orderedSpawnable` already computes the visible rows; we just need a parallel pure-count path that doesn't go through the provider class.
- `BacklogProvider.refresh()` — already fires on showAll-change (#809); the tree redraws in lockstep with the title once `updateListViewTitles()` is also called.

## Risks & Alternatives Considered

- **Risk: drift between the title count and the actual rendered rows.** The title helper and `BacklogProvider.orderedSpawnable` could diverge over time. Mitigation: both call `spawnableBacklog` and `filterMine` (the existing pure helpers) — the shared primitives are the source of truth. Mild duplication of the filter-chain shape (two callers), but no duplicated *logic*. Worth it to keep the title computation independent of instantiating the provider.
- **Risk: `currentUser` semantics.** `filterMine` is a no-op when `currentUser` is null. The acceptance criterion says "title shows the full count, matching the visible rows" in that case. The proposed `formatBacklogTitle(visible, total)` handles this naturally — when `visible == total`, the format is `Backlog (N)`, no "of" suffix. Verified in the test plan.
- **Risk: showAll-change listener fires before the views are constructed.** `updateListViewTitles` already guards with `if (backlogView)` so a too-early call is a no-op. Safe.
- **Alternative: emit a `visibleCount` via `BacklogProvider`'s `onDidChangeTreeData`.** Rejected — would couple the title-update to the provider's internal change emitter and require either a custom event or recomputing the visible count in the provider. The pure-helper approach keeps the title formatter independent of provider lifecycle.
- **Alternative: title format option 3 (`Backlog · Mine (3)`).** Rejected per the issue's stated mild preference for option 2. Option 3 duplicates info that the eye icon already conveys.
- **Alternative: title format option 1 (`Backlog (3)` flat).** Rejected because it loses the "you have a filter on, the full set is bigger" affordance that option 2 surfaces. Acceptable but less informative.

## Test Plan

### Unit tests (vitest, `packages/vscode/src/__tests__/backlog-filter.test.ts`)

- `visibleBacklogCount`:
  - showAll=true → visible == total == spawnable count
  - showAll=false, currentUser known → visible == filterMine'd spawnable count, total == spawnable count
  - showAll=false, currentUser null → visible == total (safety fallthrough)
  - items with `hasBuilder: true` excluded from both counts
  - empty `data.backlog` → `{ visible: 0, total: 0 }`
- `formatBacklogTitle`:
  - `(undefined, undefined)` → `Backlog` (no-data fallback)
  - `(5, 5)` → `Backlog (5)`
  - `(3, 47)` → `Backlog (3 of 47)`
  - `(0, 0)` → `Backlog (0)` (empty is still a known state, not the no-data case)
  - `(0, 5)` → `Backlog (0 of 5)` (mine-only with nothing assigned to you — title still shows you what's available)

Run: `pnpm --filter @cluesmith/codev test` (vitest unit suite).

### Manual verification at the dev-approval gate

1. Reviewer runs `afx dev pir-911` from the main checkout.
2. Open Codev sidebar → Backlog view.
3. **Default mode (mine-only):** verify title reads `Backlog (V of T)` where V matches the row count and T matches the total spawnable backlog. If you have nothing assigned, expect `Backlog (0 of T)` — and the empty-state placeholder row.
4. **Toggle the eye icon to show-all:** title immediately updates to `Backlog (T)`, row count matches.
5. **Toggle back to mine-only:** title immediately reverts to `Backlog (V of T)`.
6. **`currentUser` unavailable case (harder to reproduce):** when no GitHub auth, mine-only falls through to show-all per #809's branch. Title should read `Backlog (T)`, not `Backlog (T of T)`.

### Cross-platform

VSCode extension code — same behavior on macOS / Linux / Windows VSCode hosts. No platform-specific paths.

### No regression

- Builders view title still reads `Builders (N)`.
- Pull Requests view title still reads `Pull Requests (N)`.
- Recently Closed view title still reads `Recently Closed (N)`.
- Empty-state placeholder for mine-only still renders when mine-only + currentUser known + no matches (unchanged from #809).
