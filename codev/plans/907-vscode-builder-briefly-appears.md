# PIR Plan: Stop builders flashing into UNCATEGORIZED during cleanup

> Issue #907 — `area/vscode`, `bug`. The Builders tree briefly shows a being-cleaned-up builder under the `UNCATEGORIZED` group for ~2-5s before it disappears.

## Understanding

After #818 introduced area grouping, the VSCode Builders tree buckets each builder by its server-projected `area` string (`groupByArea` in `packages/core/src/area-grouping.ts`). A builder with `area === 'Uncategorized'` lands in the `UNCATEGORIZED` group. During `afx cleanup`, a builder that previously sat in (e.g.) `VSCODE` briefly re-renders under `UNCATEGORIZED`, then vanishes. The jump reads as a real reclassification event.

### How `area` is computed (traced)

`area` is **not** stored on disk and **not** carried on the wire from the builder. It is derived server-side, per overview build, in `OverviewCache.getOverview`:

1. `discoverBuilders(workspaceRoot)` scans `.builders/<id>/` and constructs each `OverviewBuilder` with `area: UNCATEGORIZED_AREA` as the default (`overview.ts:599,659,694`). It has no access to issue labels.
2. The active-session filter keeps only builders whose `roleId` is in `activeBuilderRoleIds` — the set of role ids with a live PTY terminal (`overview.ts:796-799`, set built in `tower-routes.ts:870-874` from the rehydrated terminals registry).
3. Enrichment overwrites the default from the **open-issues** cache (`overview.ts:880-888`):
   ```ts
   const issueAreaMap = new Map(issues.map(i => [String(i.number), parseArea(i.labels)]));
   for (const b of builders) {
     if (b.issueId === null) continue;
     const area = issueAreaMap.get(b.issueId);
     if (area) b.area = area;   // only set when the issue is in the list
   }
   ```
4. `parseArea` (`packages/codev/src/lib/github.ts:552-562`) returns the first `area/*` label, or `UNCATEGORIZED_AREA` when there is none.

`OverviewCache` is a process-lifetime singleton (`tower-routes.ts:100`), so per-builder state can persist across refreshes; `invalidate()` clears only the fetch caches (`overview.ts:944-950`).

### Root cause (structural failure mode)

The enrichment in step 3 reads the **open-issues** list: `issue-list` runs `gh issue list` with no `--state`, which defaults to **open only** (`packages/codev/scripts/forge/github/issue-list.sh`). When a builder's issue is not in that list, `issueAreaMap.get(b.issueId)` is `undefined`, the `if (area)` guard fails, and the record **keeps the `UNCATEGORIZED_AREA` default** — even though the builder genuinely belongs to `VSCODE`.

That mis-classification only becomes *visible* while the builder still passes the active-session filter (step 2). Cleanup kills the terminal first (`cleanup.ts:269-279`), but the builder lingers in the overview until the rehydrated-terminals registry / SSE refresh catches up — exactly the observed 2-5s window. During that window the builder is present **and** un-enrichable, so it flashes into `UNCATEGORIZED`.

This matches every clue in the issue: it only appears after #818 (no grouping existed before), it is tied to cleanup (when the issue is most likely closed and/or the project metadata is being torn down), and it is transient (ends when the active-session filter finally drops the builder).

### Why I am not naming one single sub-trigger yet

Acceptance criterion #1 requires the root cause be **confirmed via reproduction with logging**, not asserted. Static reading proves the *failure mode* (enrichment can silently fall back to the default, and the active-session filter lags), but several conditions can make `issueAreaMap.get` miss during the window:

- **(a) Issue closed** — the common real-world case: builders are usually cleaned up after their PR merged, and `Fixes #N` auto-closes the issue, so it leaves the open-issues list.
- **(b) Project metadata torn down mid-window** — `removeBuilder` (`cleanup.ts:381`) then `cleanupPorchState` (`cleanup.ts:385`) drop the `state.db` row and `codev/projects/<id>-*/`, pushing `discoverBuilders` onto its soft-mode fallback (`overview.ts:670-697`).
- **(c) Transient `issue-list` failure / empty fetch** — `issues === null` skips the whole enrichment block.

The fix below is deliberately robust to **all three**, because they funnel into the same observable defect (a present builder whose area can't be resolved this refresh). The implement phase will confirm which one actually fires in the reproduction and record it in the review.

## Proposed Change

Add **last-known-good area memoization** to `OverviewCache`. When enrichment cannot resolve an area for a builder that *was* previously classified, reuse the last successfully-resolved area instead of leaving the `UNCATEGORIZED_AREA` default. This keeps a being-cleaned-up builder in its real group until the active-session filter removes it entirely — satisfying the "stay in original area until it fully disappears" acceptance option.

Mechanics:

- New private field on `OverviewCache`: `private lastKnownArea = new Map<string, string>()`, keyed by the stable `worktreePath`.
- Rewrite the enrichment loop to distinguish *resolved* from *unresolved*:
  - When the issue **is** present in the list (`issueAreaMap.has(b.issueId)`): set `b.area` to the resolved value (which may legitimately be `Uncategorized` for a no-label issue) **and** store it in `lastKnownArea`. This is the only path that writes the cache, so a genuine no-area builder correctly records and keeps `Uncategorized`.
  - When the issue is **absent** (closed / not in list) or the whole fetch failed (`issues === null`): if `lastKnownArea` has a value for this `worktreePath`, apply it; otherwise leave the default `Uncategorized` (a builder that was never classified has no good value to fall back to — correct).
- `lastKnownArea` is **not** cleared by `invalidate()` — surviving invalidation is the point. Prune entries whose `worktreePath` is no longer in the current builders list each call, so the map can't grow unbounded.

Why this over the issue's other listed options:

- **Filter cleanup-in-progress builders (needs a `cleanupPending` signal)** — `afx cleanup` is a separate CLI process from Tower; signaling "cleanup started" into Tower's overview projection needs new cross-process plumbing and a new wire field. Heavier, and it changes *when* the builder disappears (immediately) rather than fixing the mis-classification at its source.
- **Make cleanup SSE payloads atomic** — the visible jump is driven by the active-session-filter lag and the open-only issue fetch, not by a half-mutated wire payload, so re-ordering cleanup steps doesn't address case (a).
- **No new wire field** — `area` already exists on `OverviewBuilder`; the fix is pure server-side cache state in Tower, invisible to `@cluesmith/codev-types`. (Wire contracts stay untouched.)

## Files to Change

- `packages/codev/src/agent-farm/servers/overview.ts`
  - Add `private lastKnownArea = new Map<string, string>()` to `OverviewCache` (near `~775-779`).
  - Rewrite the enrichment loop (`~880-888`) to use `issueAreaMap.has(...)`, write-through to `lastKnownArea` on resolve, and fall back to it on miss.
  - In the `issues === null` branch (`~871-873`), apply `lastKnownArea` fallback to discovered builders.
  - Prune `lastKnownArea` to current `worktreePath`s once per `getOverview`.
  - Do **not** touch `invalidate()` — last-known-good must survive it (add a one-line comment saying so).
- `packages/codev/src/agent-farm/__tests__/overview.test.ts`
  - Regression tests (see Test Plan).
- **Temporary, removed before PR**: targeted `logger.debug`/`console.error` lines in the enrichment loop to capture, during live reproduction, `{ id, issueId, hasIssue, resolvedArea, finalArea, passedActiveFilter }`. These confirm which sub-trigger fires; stripped before the implement phase ends.

Estimated net diff: well under 50 LOC at the fix site.

## Risks & Alternatives Considered

- **Risk: stale area masks a legitimate re-label.** If a user edits an open issue's `area/*` label while the builder runs, the issue is still *present* in the list, so enrichment resolves the new value and updates the cache — last-known-good only ever applies when the issue is **absent**. No masking. (Documented in the code comment.)
- **Risk: unbounded `Map` growth.** Mitigated by pruning to current `worktreePath`s every call.
- **Risk: a builder legitimately in `Uncategorized` keeps a stale specific area.** Can't happen — the only write to `lastKnownArea` is the resolved value, and a no-label issue resolves to `Uncategorized`, which is what gets cached.
- **Risk: cross-workspace key collisions.** `worktreePath` is absolute and unique per builder; safe even when Tower serves multiple workspaces.
- **Alternative — drop the open-only filter and fetch all issues for enrichment.** Rejected: widens the always-on `issue-list` payload (perf), and still leaves the soft-mode/`issues === null` windows unhandled. Last-known-good covers all of them.

## Test Plan

### Unit (regression)
In `overview.test.ts`, using the existing `mockFetchIssueList` harness and a real temp worktree:
1. **Last-known-good across issue close.** First `getOverview` with the issue present and labeled `area/vscode` → assert builder `area === 'vscode'`. Second call on the *same cache instance* with the issue **absent** from `fetchIssueList` (simulating close) → assert `area` stays `'vscode'`, **not** `'Uncategorized'`.
2. **No-area builder stays Uncategorized.** Issue present with no `area/*` label across two refreshes → `area === 'Uncategorized'` both times (no false fallback).
3. **No prior classification, issue absent.** Issue never present → `area === 'Uncategorized'` (nothing to fall back to).
4. **`issues === null`.** First call classifies `vscode`; second call with `fetchIssueList` → `null` → `area` stays `'vscode'`.

### Manual (the dev-approval reviewer's killer move — required by criterion #4)
1. `pnpm -w run local-install` to load the fix into Tower; open the VSCode Codev sidebar Builders view.
2. Spawn a builder against an issue labeled `area/vscode`; confirm it appears under the `VSCODE` group.
3. `afx cleanup -p <id>` (and repeat via the right-click *Cleanup Builder* action).
4. **Observe**: the builder must **not** jump to `UNCATEGORIZED` — it stays under `VSCODE` until it disappears entirely.
5. **No-regression check**: a builder spawned against an issue with **no** `area/*` label must still sit under `UNCATEGORIZED` throughout its normal lifecycle.
6. With the temporary logging in place, capture which sub-trigger ((a)/(b)/(c)) fires and record it in the review before stripping the logs.

### Build / checks
`pnpm --filter @cluesmith/codev build` + `pnpm --filter @cluesmith/codev test` (overview suite) green.
