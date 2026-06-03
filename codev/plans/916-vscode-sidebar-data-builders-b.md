# PIR Plan: Hold last-known-good overview data so the VSCode sidebar doesn't flicker empty on transient reads

## Understanding

The Codev VSCode sidebar intermittently renders **all** data-bearing views empty at once — BUILDERS,
BACKLOG, PULL REQUESTS, RECENTLY CLOSED — while their section headers/chevrons stay intact, then
recovers on its own after seconds-to-minutes with no user action. The WORKSPACE view stays populated
throughout (confirmed by the 2026-06-03 screenshot: WORKSPACE normal, BUILDERS expanded-but-empty
despite an active fleet of pir-952 / pir-961 / spir-945).

### Root cause (high confidence) — VSCode-side, not Tower-side

The four data-views share a single `OverviewCache` (`packages/vscode/src/views/overview-data.ts`),
injected into `BuildersProvider`, `BacklogProvider`, `PullRequestsProvider`, `RecentlyClosedProvider`.
Each provider short-circuits to an empty list on a falsy cache read (e.g. `builders.ts:182-185`,
`backlog.ts:69-70`, `pull-requests.ts:17-18`, `recently-closed.ts:17-18` all do `if (!data) return [];`).

`OverviewCache.refresh()` **discards last-known-good data and emits `null`** on a transient read, via
two paths:

1. `overview-data.ts:44-48` — when `getState() !== 'connected'` (or no client), it sets
   `this.data = null` and fires `onDidChange`. A transient SSE drop puts the connection manager into
   `disconnected`/`reconnecting` (SSE-lost handler at `connection-manager.ts:235`, `scheduleReconnect` →
   `setState('reconnecting')` at `:177`), so any `refresh()` racing that window nulls the cache.
2. `overview-data.ts:52-54` — `const result = await client.getOverview(...) ?? null; this.data = result;`
   On a failed HTTP request `getOverview()` returns `null` (`tower-client.ts:314-318`:
   `return result.ok ? result.data! : null`), so a single failed/timed-out fetch commits `this.data = null`.

A null `this.data` → every consumer renders `[]` → all four views empty simultaneously. The cache
repopulates on the **next non-heartbeat SSE event** (heartbeats are filtered at `sse-client.ts:133`, so
only a real event — spawn / cleanup / merge / `overview-changed` — re-triggers `refresh()`), which is
exactly the "recovers on its own after seconds-to-minutes" behavior.

### Why WORKSPACE is immune (the discriminating clue)

`WorkspaceProvider` (`packages/vscode/src/views/workspace.ts`) does **not** use `OverviewCache`. It reads
`connectionManager` state + worktree config (`loadWorktreeConfig`) + terminal registry directly and
renders mostly-static rows. So a null overview cache cannot empty it. This is why WORKSPACE stayed
populated in the screenshot while the four cache-backed views went empty.

This also **rules out suspected path 3** (Tower-side empty-overview emit). On Tower, `builders` come from
`discoverBuilders()` (filesystem scan), independent of GitHub; a `gh pr list` / `gh issue list` failure
empties `backlog`/`pendingPRs` only — it cannot empty BUILDERS while a live fleet exists on disk. The
observed all-four-empty-including-BUILDERS pattern is only explainable by the single shared client-side
cache going null. (Suspected path 1 in the issue body is essentially correct, with the refinement that
the null originates in the VSCode cache's own transient-failure handling, not in `getData()` spontaneously.)

### Confirmed: `null` from `getOverview()` is unambiguous

`TowerClient.getOverview()` returns `null` **only** when the HTTP request fails (`!result.ok`). A
legitimately empty workspace returns a real `OverviewData` object with empty arrays. So treating `null`
as "transient failure — keep last-known-good" never masks a genuine empty workspace.

## Proposed Change

Make `OverviewCache` **hold last-known-good** data: never overwrite a populated `this.data` with `null`
in response to a transient not-connected state or a failed/empty fetch. This is the single correct
chokepoint — fixing it once in the shared cache covers all four providers, versus duplicating
last-known-good logic into each.

Concretely, in `OverviewCache.refresh()` (`overview-data.ts`):

1. **Not-connected / no-client branch** (currently `:44-48`): instead of `this.data = null; fire()`,
   **return early without clobbering** `this.data`. The connection state is already surfaced elsewhere
   (WORKSPACE view / status), and a sidebar showing slightly-stale data beats one flickering empty.
2. **Fetch branch** (currently `:52-54`): only commit when the fetch returns a real object. If
   `getOverview()` returns `null` (request failed), **skip the assignment** (keep last-known-good) rather
   than committing `null`. A successful fetch — including a legit empty workspace (`builders: []`, etc.) —
   is still committed and fires `onDidChange` as before.

Preserve the existing `latestSeq` last-write-wins guard exactly (it solves a different problem: ordering
of concurrent refreshes; see the doc comment at `:27-39`). The change is narrowly about *what value* we
commit, not *which* refresh wins.

3. **Complementary freshen-on-reconnect** (small, in `OverviewCache` constructor): subscribe to
   `connectionManager.onStateChange` and call `refresh()` when the state transitions to `'connected'`.
   Rationale: with hold-last-known-good, after a blip the cache keeps showing stale data until the next
   *non-heartbeat* SSE event; firing a refresh the moment the connection is re-established freshens it
   promptly (and on first connect, populates it) instead of waiting for incidental activity. This closes
   the recovery loop without reintroducing any empty flicker. Low-risk: `refresh()` already no-ops safely
   when not connected, and `latestSeq` dedupes against a near-simultaneous SSE-driven refresh.

No Tower-side change. No provider-side change (the `if (!data) return []` guards stay — they remain
correct for the genuine initial-load `null` before any data has arrived).

## Files to Change

- `packages/vscode/src/views/overview-data.ts`
  - `refresh()` `:44-48` — return early without nulling `this.data` when not connected / no client.
  - `refresh()` `:52-54` — only assign `this.data` when `getOverview()` returns a non-null object; keep
    last-known-good otherwise. Still fire `onDidChange` on a committed update.
  - constructor `:16-21` — add an `onStateChange` subscription that calls `refresh()` on transition to
    `'connected'` (kept in one place alongside the existing `onSSEEvent` wiring, per the project's
    "one subscription, named handler" convention). Store the disposable and clean it up in `dispose()`.
- `packages/vscode/src/views/overview-data.ts` `dispose()` `:58-60` — dispose the new state-change
  subscription.
- `packages/vscode/src/__tests__/overview-cache.test.ts` — **new** vitest unit test (see Test Plan).

## Risks & Alternatives Considered

- **Risk: stale data persists if Tower is genuinely down for a long time.** Mitigation: this is the
  explicitly desired behavior per the issue's acceptance ("hold the last-known-good data when an
  empty/null frame arrives"). The connection state is already visible via the WORKSPACE/status surfaces,
  and freshen-on-reconnect re-syncs the instant Tower returns. A sidebar that shows the last real fleet
  is strictly more useful than one that blanks. Out of scope: adding a distinct "disconnected" visual
  treatment to the data-views (a UX change, not this transient-handling bug).
- **Risk: masking a real "all data gone" state.** Mitigation: `getOverview()` returns `null` only on
  request failure; a real empty workspace returns an object with empty arrays and is still committed. So
  legitimate emptiness still renders; only failure-nulls are held.
- **Alternative — fix Tower-side empty emit:** rejected. Tower can't produce an empty BUILDERS list for
  an active on-disk fleet (filesystem-sourced), so it isn't the cause of the observed symptom. The
  client cache is the actual single point of failure.
- **Alternative — last-known-good in each provider:** rejected. Four duplicated implementations vs. one
  shared chokepoint; the cache is the natural owner of "what data do we currently have."
- **Alternative — `if (loading) return` gate in refresh():** rejected and explicitly warned against by
  the existing doc comment (`:35-37`) — it freezes the cache on a mid-transition state. The `latestSeq`
  design stays untouched.

## Test Plan

### Unit test (vitest, `src/__tests__/overview-cache.test.ts`)
Uses the established `vi.mock('vscode', ...)` FakeEventEmitter pattern (see
`workspace-sse-subscriber.test.ts`) plus a fake `ConnectionManager` exposing `getState()`,
`getClient()`, `getWorkspacePath()`, `onSSEEvent`, `onStateChange`. Assert the core invariant and the
fix:

- **Invariant — no empty flicker:** after a successful refresh populates `getData()` with real data, a
  subsequent refresh that occurs while `getState()` is `'reconnecting'` (or `getClient()` is null) leaves
  `getData()` unchanged (last-known-good), and does **not** fire `onDidChange` with null data.
- **Failed fetch holds data:** with state `'connected'` but `getOverview()` resolving `null`, `getData()`
  retains the previous value.
- **Legit empty still commits:** `getOverview()` resolving a real `OverviewData` with empty arrays
  replaces the cached value (empty arrays render, not held).
- **Initial load:** before any successful fetch, `getData()` is `null` (providers correctly render empty
  on genuine first-load) — a not-connected refresh keeps it `null`, doesn't crash.
- **Freshen-on-reconnect:** an `onStateChange('connected')` emission triggers a `refresh()` (assert
  `getOverview` is called).

### Manual (reviewer at the `dev-approval` gate, in the running worktree)
- Run the extension against a live Tower with an active fleet; confirm the sidebar populates normally.
- Simulate a transient blip: stop Tower briefly (or toggle network) so the SSE drops, then restart —
  observe the four data-views **retain** their last data instead of blanking, and refresh promptly on
  reconnect. (Reproducing the original intermittent blank on demand is hard; the unit test is the
  durable guard. Manual focus is "no regression + last-known-good visibly held across a blip.")
- Confirm a genuinely empty section (e.g. no open PRs) still renders empty as before.

### Build / checks
- `pnpm --filter @cluesmith/codev build` (or the package's `compile` = check-types + lint + esbuild)
- `pnpm --filter codev-vscode test:unit` (vitest) for the new test.
