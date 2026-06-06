# PIR Plan: Make the "No active terminal" click self-heal (and only suggest recovery as a last resort)

## Understanding

Clicking a builder row in the Codev sidebar can produce a dead-end warning toast:

```
Codev: No active terminal for <builder-id>
```

…and nothing else happens. The row keeps looking healthy, but the click can't open a terminal.

**Why the two surfaces disagree.** The sidebar and the terminal-opener read different Tower sources:

- The **sidebar** renders from `OverviewBuilder` (overview cache / `/api/overview`), which is disk-sourced (worktree + `status.yaml`) and has no `terminalId` field (`packages/types/src/api.ts`, `OverviewBuilder`). A builder shows up as long as its worktree exists.
- The **opener** (`openBuilderByRoleOrId`, `packages/vscode/src/terminal-manager.ts:186-215`) calls `getWorkspaceState` (`/api/state`), whose handler builds the `builders` array by iterating `entry.builders` and **including a builder only if its live PTY session resolves** (`tower-routes.ts:~1840` — `const session = manager.getSession(terminalId); if (session) { … }`). No live session → the builder is omitted → `resolveAgentName` finds no match → `builder` is `undefined` → the bare warning fires at `terminal-manager.ts:206-208`.

**The dominant cause is transient, not a destroyed session.** Every `/api/state` request first runs `getRehydratedTerminalsEntry` (`tower-terminals.ts:164-168`), which awaits a rehydrate + an **on-the-fly shellper reconnect** for any session that's in SQLite but not currently in the in-memory registry (`tower-terminals.ts:780-886`). A click that lands:

- mid-rehydration / mid-reconnect (sub-100ms, longer under load),
- during Tower's startup reconciliation window (`_reconciling` blocks the on-the-fly reconnect, `tower-terminals.ts:53`/`:780` — seconds), or
- in the spawn race (the worktree/`status.yaml` is visible to `/api/overview` a beat before the PTY session is registered in `entry.builders`)

…sees a momentary miss that **resolves on the very next call.** The session is not gone; it just isn't resolvable for a beat.

**The actual defect is the missing retry.** The open path surfaces the warning on the *first* miss with no second attempt (`terminal-manager.ts:206-208`) — Tower would have answered correctly a few hundred milliseconds later. So the user hits a dead-end for a condition that self-heals.

(Session genuinely destroyed while Tower runs — non-shellper 5-min idle reap, PTY exit past the 30s grace, or a dead shellper after machine sleep — is the *minority* tail. That tail is what `afx workspace recover` addresses, and it should be a secondary suggestion, not the headline.)

## Proposed Change

Reframe the fix around the dominant transient case: **let the click heal itself silently**, and only surface a toast on the genuinely-persistent tail — where recovery is a secondary, last-resort line, not the primary action.

### 1. Primary: bounded silent auto-retry in `openBuilderByRoleOrId` (`terminal-manager.ts:193-209`)

When the lookup misses (`!builder?.terminalId`), re-query `getWorkspaceState` a few times with a short backoff before surfacing anything. Each retry re-triggers Tower's rehydrate + on-the-fly reconnect, which is exactly the self-heal path.

**Reuse the system's shared backoff convention, not a hand-rolled delay.** The codebase consolidated four hand-rolled `Math.min(1000 * 2^attempt, cap)` curves into `packages/core/src/reconnect-policy.ts` (#961) specifically so new call sites don't re-invent it; the two closest analogues — `connection-manager.ts` (Tower/SSE reconnect, via `backoffDelayMs`) and `terminal-adapter.ts` (terminal WebSocket reconnect, via `BackoffController`) — already use it. So this retry will call `backoffDelayMs(attempt, opts)` from `@cluesmith/codev-core/reconnect-policy` with a **local attempt counter** (the bare-function form, matching how the SSE/tunnel sites use it — `BackoffController`'s status-machine + give-up wrapper is for event-driven onClose scheduling we don't need here).

- The module's *defaults* (base 1000ms, cap 30_000ms, 6 attempts → `1s,2s,4s,8s,16s,30s`) are tuned for persistent reconnect loops and are too slow for an interactive click. Use interactive-tuned options instead: `backoffDelayMs(attempt, { baseMs: 150, capMs: 800 })` over ~3–4 attempts → roughly `150ms, 300ms, 600ms` (total budget ~1s). Constants live next to the call site with a comment explaining the interactive tuning vs. the reconnect defaults.
- The first attempt is the existing call (no added latency on the happy path; retries happen only on the miss branch).
- On success at any attempt → open the builder terminal normally. **No toast** — the transient case becomes invisible, which is the best UX and directly implements the issue's "self-recovers gracefully on the next overview tick" acceptance bullet.
- The retry loop only re-fetches and re-resolves; it does not change the happy path (a first-attempt hit returns immediately).
- `classifyUpgradeError` (the module's third export) is **not** used — it classifies WebSocket close codes; our `/api/state` poll gets a builder list, so "resolved or not after N tries" is the only signal.

### 2. Secondary: an actionable toast only when retries are exhausted (likely-persistent)

If every attempt still misses, the session is probably genuinely gone — show a toast that leads with a **manual retry** and treats recovery as the fallback:

- Message (neutral, not over-promising recovery): e.g. `Codev: #<id>'s terminal isn't available — it may still be starting, or its session was dropped. Retry, or recover builders if it was lost.` (Use the friendly `#<issueId> <title>` identity from the resolved `OverviewBuilder` row when available.)
- **"Retry" button** (primary) → re-invokes the open (which runs the auto-retry again). Covers the longer startup-reconciliation window where ~1.2s wasn't enough.
- **"Recover Builders" button** (secondary, last resort) → opens a terminal at the workspace root running `afx workspace recover` (dry-run preview), mirroring `commands/run-worktree-setup.ts:51-56` (`createTerminal({ name, cwd: workspacePath })` + `sendText('afx workspace recover')`). Stays at the dry-run because recover is workspace-wide (cannot target one builder) — the user reviews scope before re-running with `--apply`. `workspacePath` is already in scope at `terminal-manager.ts:188`.

Button handling uses the established positional-args pattern (`notifications/gate-toast.ts:109-139`).

### What changed from the first draft (and why)

The first draft led with recovery (per the issue's options 1–2). That mis-weights the problem: the case actually seen in practice is transient unavailability that needs no recovery at all. Recovery is now demoted to the persistent tail, and the headline is the silent auto-retry that makes the dominant case disappear.

### Deferred options (with reasons)

- **Option 3 (sidebar icon for dropped sessions)** — `OverviewBuilder` carries no liveness/`terminalId` signal (confirmed unchanged on `main`; `overview.ts`'s recent #907 change added an `area` enrichment cache, not liveness). Flagging the row before a click would need a `hasLiveSession` field threaded from Tower's in-memory registry through the overview server and `@cluesmith/codev-types` — cross-package blast radius, and the auto-retry already removes the dominant dead-end. Recommend a separate follow-up. (Also: with auto-retry, a transient miss never even reaches a "dropped" state worth flagging.)
- **Option 4 (auto-recover on activation)** — a behavior decision the issue defers; out of scope.
- **Option 5 (persist Tower's session registry)** — the root-cause fix for the *destroyed-session* tail; explicitly a separate, larger discussion; out of scope.

## Files to Change

- `packages/vscode/src/terminal-manager.ts:193-209` — in `openBuilderByRoleOrId`, wrap the resolve in a bounded retry (re-fetch `getWorkspaceState`, re-run `resolveAgentName`, ~3–4 attempts with delays from `backoffDelayMs(attempt, { baseMs: 150, capMs: 800 })` and a local counter). On exhaustion, call a small private helper for the actionable toast (`Retry` + secondary `Recover Builders`). Keep the `ambiguous` and `not connected` branches as-is. Factor the toast + the sleep into helpers so the method stays readable and unit-testable; reuse the already-fetched `workspacePath`.
- `packages/vscode/src/terminal-manager.ts` (imports) — add `import { backoffDelayMs } from '@cluesmith/codev-core/reconnect-policy';` (same import surface `connection-manager.ts` / `terminal-adapter.ts` already use).
- `packages/vscode/src/__tests__/terminal-manager.test.ts` — extend the suite: (a) **miss-then-hit** → `getWorkspaceState` returns no session on attempt 1 and a session on attempt 2 → builder terminal opens, `showWarningMessage` NOT called; (b) **all-miss** → toast shown with `Retry` + `Recover Builders` labels; (c) selecting **Retry** re-attempts the open; (d) selecting **Recover Builders** → `createTerminal` with `cwd === workspacePath` + `sendText('afx workspace recover')`; (e) happy path (first-attempt session present) → opens immediately, no extra fetches, no warning. Inject a fake/fast sleep so tests don't wait real time.

No `package.json` command contribution needed (buttons handled inline). No types/server changes.

## Risks & Alternatives Considered

- **Risk: auto-retry adds latency.** Only on the miss branch, and bounded (~1.2s). The happy path (first-attempt hit) is unchanged — returns immediately. Mitigation: keep attempts/backoff small and configurable as constants.
- **Risk: retry masks a real persistent failure.** Bounded retries fail fast to the actionable toast; we don't retry indefinitely. The persistent tail still gets a clear signal + recovery path.
- **Risk: startup-reconciliation window exceeds the auto-retry budget (seconds).** Then attempt-set 1 falls through to the toast, but the **Retry** button (and a later natural re-click) succeeds once `_reconciling` clears. Acceptable: the toast is now actionable rather than a dead-end.
- **Risk: `afx workspace recover` doesn't help the live-process/dropped-session sub-case.** True, but it's the correct tool for the dead-shellper tail and is now secondary. The message doesn't over-promise ("it may still be starting, or its session was dropped").
- **Alternative: lead with recovery (first draft).** Rejected — mis-weights the problem; the dominant case needs no recovery.
- **Alternative: fix it Tower-side (block `/api/state` until rehydration fully settles).** Rejected for this issue — larger blast radius on a hot endpoint, and the client-side retry is the smaller, safer change that fixes the user-visible symptom. Tower-side hardening can be a follow-up (overlaps Option 5).
- **Risk: happy-path regression.** Mitigated by confining changes to the miss branch + an explicit happy-path test.

## Test Plan

**Unit (`packages/vscode/src/__tests__/terminal-manager.test.ts`, run via vitest — `pnpm --filter codev-vscode test:unit`):**
- Miss-then-hit → terminal opens, no warning (the transient self-heal).
- All attempts miss → actionable toast with `Retry` + `Recover Builders`.
- `Retry` → re-attempts the open.
- `Recover Builders` → `createTerminal` with `cwd === workspacePath`; `sendText('afx workspace recover')`.
- Happy path → first-attempt session present → opens immediately, no warning, no extra fetches.

**Manual (reviewer at the `dev-approval` gate — run the worktree):**
1. **Transient (the main case):** click a builder row right after a spawn / while Tower is settling. Expect the terminal to open after a brief pause with **no** dead-end toast (previously: instant warning). To force the window, click during the spawn race or just after a Tower restart while reconciliation runs.
2. **Persistent:** simulate a genuinely lost session (e.g. kill the shellper so it can't reconnect). Click the row → after the bounded retries, the actionable toast appears. Click **Retry** → still missing → toast returns (not a silent dead-end). Click **Recover Builders** → a terminal opens at the workspace root running `afx workspace recover` (dry-run); confirm cwd is the main checkout, not a worktree.
3. **Happy path:** click a healthy builder → terminal opens immediately, no toast (regression check).

**Cross-platform:** n/a (desktop VSCode extension only).

## Build / Verify Commands

- `pnpm --filter codev-vscode test:unit` — the vitest unit suite (where the new tests live).
- `pnpm --filter codev-vscode compile` — typecheck + lint + esbuild bundle of the extension.
