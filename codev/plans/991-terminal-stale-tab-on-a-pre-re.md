# PIR Plan: Dashboard terminal self-heals onto the successor session after a Tower restart

## Understanding

After a Tower restart, persistent (shellper-backed) terminal sessions are reconnected under a **new** terminal id and the old SQLite row is deleted (`tower-terminals.ts:646`, `:669-672`, `:832`, `:868-872`). A dashboard tab still holding the **old** id's WebSocket URL (`/ws/terminal/<oldId>`) gets a permanent close — Tower accepts the browser upgrade and immediately closes with the app-range code `4404` (`WS_CLOSE_SESSION_UNKNOWN`, wired in #971). The dashboard's `Terminal` `onclose` handler classifies that via `classifyUpgradeError({ code: 4404 }) === 'permanent'` and correctly gives up (no blind retry) — the old id really is gone.

The recovery path *already exists* but fires only incidentally today:

- `useBuilderStatus` re-fetches `/api/state` on a 1s `setInterval` poll **and** on every SSE event (`useSSE(refresh)`).
- A fresh state response carries the **successor** terminal id. Tab identity is stable across the id swap — `useTabs` keys builder tabs on `builder.id`, architect tabs on `architect`/`architect:<name>`, util tabs on `util.id` (`useTabs.ts:81-105`), and only the tab's `terminalId` field changes.
- `getTerminalWsPath(tab)` therefore produces a **new** `wsPath`, and the `Terminal` effect is keyed on `[wsPath]` (`Terminal.tsx:727`), so it tears down the dead socket and remounts onto the successor — a self-heal.

The gap: nothing connects the *give-up* to a *state re-fetch*. Recovery waits on the next incidental trigger — a user refresh, a tab-focus SSE reconnect, or a poll tick (and the 1s poll is throttled to ~1/min by the browser when the tab is backgrounded, while SSE is disconnected entirely while hidden — `useSSE.ts` closes the EventSource on `visibilitychange`). So a backgrounded or idle tab can sit on a dead socket far longer than necessary.

**Root cause of the UX gap** (not a correctness bug — the `4404` give-up is truthful): the permanent-close branch at `Terminal.tsx:533-537` writes a "session no longer exists" message and stops, without nudging the owner of `wsPath` to re-resolve the successor id.

## Proposed Change

Make the permanent close **proactively trigger a state re-fetch** so the successor id is resolved promptly and the existing `wsPath`-keyed remount heals the terminal — no manual refresh.

1. **`Terminal.tsx` — new optional prop `onPermanentClose?: () => void`.** In the `classifyUpgradeError(...) === 'permanent'` branch:
   - Call `onPermanentClose?.()` to ask the parent to re-fetch `/api/state` (resolving the successor id).
   - Set status to `'reconnecting'` (not `'disconnected'`) and **defer** the "session no longer exists" message. We're genuinely waiting on the successor, so the honest state is "reconnecting," and we avoid flashing a scary red "this terminal session no longer exists" line during a heal that's about to remount the component out from under it.
   - Start a bounded **give-up timer** (`PERMANENT_RECOVERY_MS`, ~4000ms — several 1s poll cycles plus reconcile slack). If it fires while this instance is still mounted (i.e. no successor appeared → genuine session death, e.g. a util terminal killed or a builder cleaned up), write the existing give-up message and set `'disconnected'`. If the successor *does* arrive, the parent hands down a new `wsPath`, the effect cleanup runs, the timer is cleared, and this instance is replaced — the message never shows.
   - Track the timer on the existing `rc` object and clear it in the effect cleanup (alongside `rc.timer`).

   The callback is captured by closure (the effect stays keyed on `[wsPath]` only), matching how `onFileOpen` is already used inside the effect without being a dependency. This is safe because the parent passes a stable `useCallback` reference (see below).

2. **`App.tsx` — wire `onPermanentClose={refresh}` into all three `Terminal` render sites.** `refresh` from `useBuilderStatus` is a stable `useCallback(..., [])`, so it won't churn the effect:
   - `renderTerminal` (`:122`)
   - `renderPersistentTerminals` (`:162`) — add `refresh` to its `useCallback` dependency list (`:173`)
   - desktop architect render (`:303`)

No Tower / core / backend changes: `WS_CLOSE_SESSION_UNKNOWN`, `classifyUpgradeError`, the 1s poll, and the SSE refresh all already exist. This is a dashboard-only seam that connects the give-up to the existing recovery machinery.

## Files to Change

- `packages/dashboard/src/components/Terminal.tsx`
  - `TerminalProps` (`:102-111`) — add `onPermanentClose?: () => void` with a doc comment.
  - component signature (`:192`) — destructure `onPermanentClose`.
  - add `const PERMANENT_RECOVERY_MS = 4000;` near the frame constants (`:98-100`).
  - `rc` object (`:396-404`) — add a `recoveryTimer` field.
  - permanent-close branch (`:533-537`) — call `onPermanentClose?.()`, set `'reconnecting'`, start the recovery timer that defers the give-up message.
  - cleanup (`:705-708`) — clear `rc.recoveryTimer`.
- `packages/dashboard/src/components/App.tsx`
  - `:122`, `:162`, `:303` — pass `onPermanentClose={refresh}`.
  - `:173` — add `refresh` to `renderPersistentTerminals`'s dependency array.
- `packages/dashboard/__tests__/Terminal.reconnect.test.tsx`
  - Extend `MockWs.simulateClose` to accept an optional close code (default `1006`).
  - New tests (see Test Plan).

## Risks & Alternatives Considered

- **Risk: callback identity churns the `[wsPath]` effect and forces needless remounts.** Mitigated — `refresh` is a stable `useCallback(..., [])`; the prop is read by closure, not added to the effect deps (same pattern as `onFileOpen`).
- **Risk: successor not yet reconciled when the give-up fires (Tower up but that session's reconcile in flight).** The give-up timer spans several 1s poll cycles, and the existing interval poll keeps re-fetching within the window, so a slightly-late successor is still caught. If it never appears, we fall back to the original give-up message — no worse than today.
- **Risk: infinite remount loop.** None — the permanent branch never re-opens a socket itself; it only re-fetches state. A successor triggers exactly one remount; the absence of one leaves a single deferred message. If the successor is *also* immediately stale (a second restart), the new instance simply repeats the one-shot heal — self-limiting.
- **Risk: misleading "reconnecting" status on a session that's truly gone.** Bounded by `PERMANENT_RECOVERY_MS`, after which the honest "no longer exists" message + `'disconnected'` dot returns.
- **Alternative — minimal variant: keep the immediate red message + `'disconnected'`, just add the `onPermanentClose?.()` call.** Smaller diff, but flashes "this terminal session no longer exists" for up to ~1s before the heal remounts — misleading during a successful recovery. Rejected in favor of the deferred-message UX, which matches the issue's "self-heals" framing. (Easy to fall back to if the reviewer prefers the smaller diff.)
- **Alternative — App-level bounded retry loop of `refresh`.** Unnecessary: the existing 1s interval poll already provides repeated attempts within the give-up window. Kept App's change to a single stable callback.
- **Scope — VSCode terminal.** The issue notes the same stale-id gap exists for the VSCode terminal and that folding it in would make this `area/cross-cutting`. This issue is labeled `area/dashboard`; the VSCode analogue (auto successor-id remount in `terminal-adapter.ts`) is left as a separate follow-up to preserve the single-area scope. Called out here so the reviewer can redirect if they want it folded in.

## Test Plan

**Unit (`Terminal.reconnect.test.tsx`, vitest + jsdom, fake timers):**

- `simulateClose(code?)` — default `1006`; pass `4404` for the permanent case.
- **Permanent close invokes `onPermanentClose`**: open, then `simulateClose(4404)` → the `onPermanentClose` spy is called once.
- **Permanent close does not blind-retry**: after `simulateClose(4404)`, advancing timers creates **no** new `WebSocket` (contrast with the existing transient-`1006` backoff test).
- **Status is `reconnecting`, message deferred**: immediately after `simulateClose(4404)`, the status dot is `terminal-status-reconnecting` and `term.write` has **not** written the "no longer exists" line.
- **Give-up fallback after the window**: advance past `PERMANENT_RECOVERY_MS` → status becomes `terminal-status-disconnected` and the "no longer exists" message is written.
- **Transient close does not invoke `onPermanentClose`**: `simulateClose(1006)` → spy not called; existing backoff behavior intact.
- **Cleanup clears the timer**: unmount after `simulateClose(4404)` then advance timers → no late `setConnStatus` / write (no act warnings).

**Manual (reviewer at the `dev-approval` gate, via `afx dev pir-991`):**

1. Open the dashboard, open a persistent terminal tab (builder or architect), confirm it's connected.
2. Restart Tower (`pnpm -w run local-install`, or stop/start Tower) so the session reconnects under a new id.
3. **Without** touching the page, observe the terminal tab: status briefly shows reconnecting, then the terminal **automatically remounts** onto the successor session (fresh replay) within a few seconds — no manual page refresh.
4. Negative: kill a non-persistent util/shell terminal so there's no successor; confirm the tab settles to the "session no longer exists" message + disconnected dot after the bounded delay (no infinite "reconnecting").
5. Confirm a normal transient blip (brief network drop, not a restart) still reconnects via the usual backoff (no regression).

**Build/test:** `pnpm --filter @cluesmith/codev-dashboard build` and the dashboard vitest suite (`pnpm --filter @cluesmith/codev-dashboard test`).
