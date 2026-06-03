# PIR #916 — sidebar data intermittently disappears

## Plan phase (2026-06-03)

### Root cause (high confidence)
Bug is **VSCode-side**, in `packages/vscode/src/views/overview-data.ts` — `OverviewCache.refresh()`.
The shared `OverviewCache` is consumed by all four data-views (Builders, Backlog, PullRequests,
RecentlyClosed). On a **transient** read it overwrites last-known-good with `null`:

- `overview-data.ts:44-48` — if `getState() !== 'connected'` (or no client), it sets `this.data = null` and fires.
- `overview-data.ts:52-54` — `client.getOverview() ?? null` → on a failed HTTP request commits `this.data = null`.

Every provider does `if (!data) return []` → all four views render empty simultaneously.

**Why WORKSPACE stays populated** (the architect's discriminating clue): `WorkspaceProvider` does NOT
use `OverviewCache` — it reads `connectionManager` + worktree-config + terminal state directly and
renders static rows. So a null overview cache empties the four data-views but never WORKSPACE. This
matches the screenshot exactly and **rules out** the Tower-side empty-payload theory (suspected path 3):
a `gh pr list`/`gh issue list` failure empties backlog/PRs only — builders come from `discoverBuilders()`
(filesystem), so Tower-side failure can't empty BUILDERS with an active fleet.

**Recovery-on-its-own**: after a transient blip, the next non-heartbeat SSE event triggers `refresh()`
again and repopulates. Heartbeats are filtered (`sse-client.ts:133`), so it waits for a real event
(spawn/cleanup/merge/overview-changed) — consistent with "seconds to minutes."

### Confirmed contract
`TowerClient.getOverview()` (`packages/core/src/tower-client.ts:314-318`) returns `null` ONLY on a failed
request; a legit-empty workspace returns a real `OverviewData` with empty arrays. So treating `null` as
"keep last-known-good" never masks a genuine empty workspace. Clean fix point.

### Fix direction
Make `OverviewCache` hold last-known-good: never clobber `this.data` with `null` on a transient
not-connected / failed read. Optionally trigger a refresh on reconnect (`onStateChange → 'connected'`)
to freshen promptly. Single chokepoint = the shared cache (not 4 providers).

### Test
Vitest unit test (`src/__tests__/`) mocking `vscode` (FakeEventEmitter, established pattern in
`workspace-sse-subscriber.test.ts`) + fake ConnectionManager. Invariant: a single null/disconnected
refresh does NOT empty `getData()` once it has been populated.

Plan written → awaiting `plan-approval` gate.

## Rebase on main (2026-06-03)
Rebased onto origin/main (was 79 behind). Re-verified plan accuracy against updated code:
- **`overview-data.ts` (the fix file): byte-identical** — all exact line refs (`:44-48`, `:52-54`,
  `:16-21`, `:58-60`) still correct. Null-emit mechanism unchanged.
- All four providers still `if (!data) { return []; }` (line numbers shifted: builders.ts grew ~40
  lines → guards now `:182-185` / `:219`; backlog `:69-70` / `:109`; pull-requests `:18`; recently-closed `:18`).
- `tower-client.ts:314` getOverview unchanged (null only on failure).
- `connection-manager.ts`: only a backoff refactor to shared `backoffDelayMs` (#961); reconnect-state
  semantics identical. `setState('reconnecting')` now `:177`, SSE-lost `:235`.
- `backlog.ts`: only an `areaName`→`groupName` param rename; null guard untouched.
Plan substantively unchanged; updated only the drifted evidence line-numbers. Force-pushed rebased branch.

## Implement phase (2026-06-03)
plan-approval gate approved. Implemented the fix:
- `overview-data.ts` `refresh()`: transient reads no longer clobber last-known-good. Not-connected /
  no-client → early return (was `this.data = null; fire()`). Failed fetch (`getOverview()` null) →
  early return (was committing null). Only a successful fetch commits + fires. `latestSeq` last-write-
  wins guard preserved.
- `overview-data.ts` constructor: added `onStateChange` subscription → `refresh()` on `'connected'` so
  the cache re-syncs promptly on reconnect (heartbeats are filtered, so SSE alone could leave it stale).
  Both subscriptions stored in `this.subscriptions[]` and disposed in `dispose()`.
- New `__tests__/overview-cache.test.ts` (7 tests): retains data on not-connected / no-client / failed
  fetch; commits valid-empty; starts+stays null on not-connected initial; freshens on reconnect; no
  refresh on non-connected transitions.

Worktree had no node_modules — ran `pnpm install` + built `@cluesmith/codev-types`+`-core` (vitest can't
resolve the types package otherwise; 6 unrelated test files fail to load without it — env, not my change).
After build: check-types ✓, lint ✓, vitest 21 files / 268 passed.
Pushed → awaiting `dev-approval` gate.

## Review phase (2026-06-03)
dev-approval approved. Wrote review (`codev/reviews/916-*.md`) + lessons-learned entry [From 916].
Opened PR #976, recorded with porch. 3-way consult (single advisory pass):
- Gemini APPROVE, Claude APPROVE, Codex **REQUEST_CHANGES** (2 points, both valid, both addressed):
  1. Cache-side `onStateChange` sub duplicated `extension.ts:467-469` → removed it (freshen-on-reconnect
     preserved by the existing extension path). One deviation from approved plan; documented in review.
  2. No test for the "don't fire onDidChange on transient read" invariant → added 3 fire/no-fire tests.
- Re-verified: check-types ✓, lint ✓, 21 files / 269 tests. PIR single-pass: fix NOT re-consulted, so
  escalated to architect leading with the REQUEST_CHANGES + disposition for human verify at pr gate.
Awaiting `pr` gate (human merges).
