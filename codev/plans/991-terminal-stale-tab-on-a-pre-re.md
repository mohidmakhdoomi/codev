# PIR Plan: Terminal self-heals onto the successor session after a Tower restart (dashboard + VSCode)

## Understanding

After a Tower restart, persistent (shellper-backed) terminal sessions — **builders and architects** — are reconnected under a **new** terminal id and the old SQLite row is deleted (`tower-terminals.ts:646`, `:669-672`, `:832`, `:868-872`). A terminal tab still holding the **old** id's WebSocket URL (`/ws/terminal/<oldId>`) gets a permanent close: `4404` (`WS_CLOSE_SESSION_UNKNOWN`) for the web terminal, the `Unexpected server response: 404` upgrade error for the VSCode terminal. Both correctly classify it `permanent` via `classifyUpgradeError` and give up — the old id really is gone. The missing piece on **both** surfaces is reconnecting to the **successor** id without a manual user action.

The "successor" is never found by mapping old-id → new-id (the old id is deleted from state). It is found by **stable session identity** → current `terminalId` in fresh workspace state. Both surfaces already consume the same wire type — `DashboardState` from `@cluesmith/codev-types` (dashboard via `/api/state`; VSCode via `TowerClient.getWorkspaceState`, which lives in `@cluesmith/codev-core`). Each session carries a stable id/name plus its current `terminalId`:

- `state.builders[]` → `{ id, terminalId }`
- `state.architects[]` → `{ name, terminalId }`

**Where each surface stands today:**

- **Dashboard**: recovery is *reactive but un-triggered*. `useBuilderStatus` re-fetches `/api/state` on a 1s poll + on SSE; `useTabs` rebuilds tabs keyed on the **stable** id (`builder.id`, `architect`/`architect:<name>`), so the tab's `terminalId` field updates to the successor and `getTerminalWsPath` yields a new `wsPath`; the `Terminal` effect is keyed on `[wsPath]` (`Terminal.tsx:727`) and remounts. The gap: the permanent-close branch (`Terminal.tsx:533-537`) prints "session no longer exists" and stops — it never *triggers* the re-fetch. Recovery waits on an incidental poll/focus event (and the 1s poll throttles to ~1/min when the tab is hidden, while SSE is disconnected while hidden — `useSSE.ts`).
- **VSCode**: recovery machinery exists but the give-up path bypasses it. `terminal-adapter.ts:185` classifies the permanent close and calls `giveUp('this terminal session no longer exists on Tower')`, surfacing a clickable "Click here to reconnect" link (#936/#939). But the link routes to `terminal-manager.ts` `reconnectByTerminal()` → `pty.reconnect()` **with no URL**, so it retries the **same dead id** and fails again. Meanwhile the manager already knows how to resolve a successor — `openBuilderByRoleOrId` (`:180-208`) fetches `getWorkspaceState` and resolves `builder.terminalId` via `resolveAgentName`, and `openBuilder`/`openArchitect` already implement a **stale-replace** (dispose the terminal when `existing.id !== terminalId`, reopen on the new id — `:160-173`, `:109-123`). Nothing wires the give-up to that machinery, and there's no *automatic* trigger.

**This is one cross-cutting gap with one shared resolution rule and two surface-specific glue layers** — mirroring the cycle's established pattern (#961 `BackoffController`, #971 `classifyUpgradeError`): pure logic in `@cluesmith/codev-core`, surface glue in each package.

## Proposed Change

### 1. Core — shared successor-resolution helper (`@cluesmith/codev-core`)

New pure module `packages/core/src/session-successor.ts` exporting:

```ts
export type SessionRef =
  | { kind: 'builder'; id: string }
  | { kind: 'architect'; name: string };

/** Given fresh workspace state and a stable session reference, return the
 *  current (successor) terminalId, or null if the session is gone. */
export function resolveSuccessorTerminalId(
  state: Pick<DashboardState, 'builders' | 'architects'>,
  ref: SessionRef,
): string | null;
```

- `builder`: reuse the existing core `resolveAgentName(ref.id, state.builders)` (tail-matches bare numeric ids against canonical `builder-<proto>-<n>` ids, exactly as `openBuilderByRoleOrId` does today) → its `terminalId ?? null`.
- `architect`: `state.architects.find(a => a.name === ref.name)?.terminalId ?? null`.
- Type-only import of `DashboardState` (matches `tower-client.ts`'s house style); no runtime dep on `@cluesmith/codev-types`.
- Add a `./session-successor` subpath export to `packages/core/package.json` (mirrors `./reconnect-policy`, `./agent-names`).

Scope note: only **builder** and **architect** are persistent, restart-reconciled sessions (per the reconcile code the issue cites). Shell/dev terminals are non-persistent (they don't survive a restart), so they're intentionally out of the helper's `SessionRef` union. `util` is extensible later by id if a persistent-util case arises.

### 2. VSCode glue — automatic successor remount on permanent close

- **`terminal-adapter.ts`**: add an optional `onSessionGone?: () => void` (constructor param, defaulting undefined). In the permanent-close branch (`:185-186`), invoke `this.onSessionGone?.()` *before* falling back to the existing `giveUp(...)` message. This is the seam that lets the manager (which knows the stable identity; the adapter does not) attempt recovery. If `onSessionGone` is absent or recovery finds no successor, the current give-up link behavior is unchanged (graceful fallback).
- **`terminal-manager.ts`**:
  - In `openTerminal` (`:341`), pass an `onSessionGone` closure to `new CodevPseudoterminal(...)` that captures `mapKey`/`type` and calls a new `recoverSuccessor(mapKey)`.
  - New `private async recoverSuccessor(mapKey: string)`: derive a `SessionRef` from the mapKey (`builder-<id>` → `{kind:'builder', id}`, `architect:<name>` → `{kind:'architect', name}`; other kinds → return, leave give-up message), `await client.getWorkspaceState(workspacePath)`, call `resolveSuccessorTerminalId(state, ref)`. If it returns a **new** id (different from the dead `entry.id`), reopen via the existing stale-replace method (`openBuilder`/`openArchitect`) which disposes the dead terminal and attaches to the successor. If null, do nothing (the adapter's give-up link stands).
  - Route the manual `reconnectByTerminal` (`:392-398`) through `recoverSuccessor` too, so the "Click here to reconnect" affordance **also** re-resolves the successor instead of retrying the dead id — fixing the manual path's dead-URL bug as a bonus, with a final fall-through to `pty.reconnect()` when no successor exists (genuine transient give-up).

Net VSCode behavior: a post-restart permanent close auto-resolves the successor and reattaches; the manual link becomes a correct fallback rather than a no-op.

### 3. Dashboard glue — trigger the existing reactive remount (does **not** consume the core helper; see Design Notes)

- **`Terminal.tsx`**: add optional `onPermanentClose?: () => void`. In the permanent-close branch (`:533-537`): call `onPermanentClose?.()` (asks the parent to re-fetch state), set status `'reconnecting'` (not `'disconnected'`), and **defer** the "session no longer exists" message behind a bounded give-up timer (`PERMANENT_RECOVERY_MS ≈ 4000ms`, tracked on `rc`, cleared in cleanup). If the successor arrives, the parent hands a new `wsPath`, the effect cleanup runs (timer cleared) and the component remounts — the scary message never flashes. If the timer fires (no successor → genuine death), write the original message and set `'disconnected'`.
- **`App.tsx`**: pass `onPermanentClose={refresh}` to all three `Terminal` render sites (`:122`, `:162`, `:303`); add `refresh` to `renderPersistentTerminals`'s `useCallback` deps (`:173`). `refresh` is a stable `useCallback(..., [])`, so it won't churn the `[wsPath]` effect.

## Files to Change

**Core**
- `packages/core/src/session-successor.ts` — new: `SessionRef`, `resolveSuccessorTerminalId`.
- `packages/core/package.json` — add `./session-successor` export.
- `packages/core/__tests__/session-successor.test.ts` (match core's test layout) — unit tests.

**VSCode**
- `packages/vscode/src/terminal-adapter.ts` — add `onSessionGone?` ctor param; invoke in the permanent-close branch (`:185`).
- `packages/vscode/src/terminal-manager.ts` — pass `onSessionGone` in `openTerminal` (`:341`); add `recoverSuccessor(mapKey)`; route `reconnectByTerminal` (`:392`) through it.
- `packages/vscode/src/__tests__/terminal-adapter.test.ts` and/or `terminal-manager` tests — cover the new seam.

**Dashboard**
- `packages/dashboard/src/components/Terminal.tsx` — `onPermanentClose?` prop, `PERMANENT_RECOVERY_MS`, `rc.recoveryTimer`, reconnecting-then-deferred-message branch, cleanup.
- `packages/dashboard/src/components/App.tsx` — wire `onPermanentClose={refresh}` at `:122`/`:162`/`:303`; deps at `:173`.
- `packages/dashboard/__tests__/Terminal.reconnect.test.tsx` — extend `MockWs.simulateClose(code?)`; new tests.

## Design Notes / Open Question for the Architect

The architect's steer was a shared core helper that **both** surfaces consume. The resolution rule genuinely belongs in core and VSCode consumes it directly. **The dashboard, however, does not call the helper** — and forcing it to would be a net negative:

- The dashboard never holds the dead id at a resolution point. Its `useTabs` already rebuilds tabs from fresh state keyed on the **stable** id, so the successor `terminalId` flows in reactively and the `wsPath`-keyed `Terminal` remounts on its own. The only missing link is *triggering* the re-fetch, which `onPermanentClose → refresh()` supplies.
- To make the dashboard call `resolveSuccessorTerminalId` we'd have to plumb a `SessionRef` down into the `Terminal` component (which today knows only `wsPath`) and add an explicit resolution path that duplicates what `useTabs` does for free — more coupling, no benefit.

So my recommendation: **helper in core (canonical, unit-tested, consumed by VSCode); dashboard heals reactively via `refresh()`.** The helper still earns core placement on the #961/#971 precedent (cross-host terminal-session logic, sibling to `classifyUpgradeError`), and it de-duplicates the builder-lookup rule already inlined in `openBuilderByRoleOrId`. If you specifically want literal both-consume symmetry, the only consumption point would be refactoring `useTabs`/`getTerminalWsPath` to route `terminalId` reads through the helper — I'd advise against it (indirection without removing duplication), but flagging it so you can overrule at this gate.

## Risks & Alternatives Considered

- **Callback identity churns the dashboard `[wsPath]` effect** → mitigated: `refresh` is a stable `useCallback(..., [])`; read by closure (same pattern as `onFileOpen`), not added to deps.
- **Successor not yet reconciled when the give-up fires** → dashboard: the bounded timer spans several 1s polls and the interval keeps re-fetching; VSCode: `getWorkspaceState` is fetched at recovery time, after Tower is back up and has accepted the (rejected) upgrade, so reconcile has run. If a successor is momentarily absent, both fall back to the existing give-up message — no worse than today.
- **Infinite remount/recovery loop** → none: dashboard's permanent branch never re-opens a socket itself (only re-fetches); VSCode's `recoverSuccessor` only reopens when the resolved id **differs** from the dead one, so a still-stale state is a no-op. A genuinely-new-then-immediately-stale successor (double restart) simply repeats one bounded recovery — self-limiting.
- **VSCode adapter doesn't know its stable identity** → by design the manager owns identity; the `onSessionGone` closure captures `mapKey`. Adapter stays transport-only.
- **Alternative — dashboard minimal variant** (keep the immediate red message + `'disconnected'`, just add `onPermanentClose?.()`): smaller diff but flashes "session no longer exists" for up to ~1s before a successful heal. Rejected for the deferred-message UX; trivial to fall back to if preferred.
- **Alternative — VSCode: recover only on the manual link click, not automatically**: rejected — the issue's acceptance requires reconnect "without the user touching the refresh button."

## Test Plan

**Core unit (`session-successor.test.ts`):**
- builder ref resolves to the current `terminalId` (incl. bare-numeric tail-match via `resolveAgentName`); architect ref resolves by name.
- returns `null` when the session is absent / has no `terminalId`.
- a post-restart state (same stable id, new `terminalId`) returns the **new** id.

**Dashboard unit (`Terminal.reconnect.test.tsx`, vitest + jsdom, fake timers):**
- `simulateClose(code?)` defaults `1006`; pass `4404` for permanent.
- permanent close (`4404`) invokes `onPermanentClose` once; transient (`1006`) does not.
- permanent close creates **no** new WebSocket (no blind retry) and shows `terminal-status-reconnecting` with the "no longer exists" line **not yet** written.
- after `PERMANENT_RECOVERY_MS`, status → `terminal-status-disconnected` and the message is written.
- unmount after a permanent close + advance timers → no late `setConnStatus`/write (timer cleared).

**VSCode unit (adapter + manager):**
- adapter invokes `onSessionGone` on a permanent close; not on a transient close.
- `recoverSuccessor`: with a state whose builder/architect carries a new `terminalId`, it reopens onto the new id (stale-replace dispose+reopen); with no successor, it leaves the give-up message and (manual path) falls back to `pty.reconnect()`.

**Manual — dev-approval gate (`afx dev pir-991`), both surfaces, per the architect's instruction:**
1. Open a **VSCode** builder/architect terminal **and** a **dashboard** builder/architect terminal; confirm both connected.
2. Force a Tower restart (`pnpm -w run local-install`, or stop/start Tower) so both sessions reconnect under new ids.
3. **Without touching either refresh button**, confirm **both** terminals auto-remount onto the successor id within a few seconds (fresh replay, status returns to connected).
4. Negative: a non-persistent shell/dev terminal (no successor) settles to the give-up message/link after the bounded delay — no infinite "reconnecting", no loop.
5. Regression: an ordinary transient blip (brief drop, not a restart) still reconnects via normal backoff on both surfaces.

**Build/tests:** `pnpm --filter @cluesmith/codev-core build && pnpm --filter @cluesmith/codev-core test`; `pnpm --filter @cluesmith/codev-dashboard build && pnpm --filter @cluesmith/codev-dashboard test`; `pnpm --filter @cluesmith/codev-vscode build && pnpm --filter @cluesmith/codev-vscode test`.
