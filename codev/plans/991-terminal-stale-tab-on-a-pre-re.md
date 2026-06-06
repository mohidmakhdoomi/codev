# PIR Plan: Terminals survive a Tower restart — core Tower fix

> **Note:** This plan was rewritten at the `dev-approval` gate after live debugging found the actual root cause. The original plan (a client-side "remount onto the successor id" on dashboard + VSCode) is preserved as the rejected alternative below — it could never work because of two Tower-level bugs it was unknowingly working around.

## Understanding

Issue #991 asked for a terminal to "self-heal onto its successor session" after a Tower restart, and framed it as a **client-side** problem: the terminal id changes on restart, so the old `/ws/terminal/<oldId>` url goes dead and the client should re-resolve and reconnect to the new id. The original plan took that framing at face value and treated the id change as a fixed given.

Live debugging at the `dev-approval` gate (the VSCode **Extension Host** log + the **Codev** output channel) revealed two **Tower-level root causes** that no client-side recovery could fix:

1. **`afx tower stop` was killing the VSCode extension host.** `getProcessesOnPort` (`commands/tower.ts`) ran `lsof -ti :PORT`, which returns the *listening server and every client* of the port. The extension host holds **client** sockets to Tower's port (the SSE stream + every terminal WebSocket), so `afx tower stop` SIGTERM'd it. **Proven empirically:** `lsof -ti :4100` returned the VSCode `Code Helper (Plugin)` host (the exact pid from the reviewer's log) *and* the node server; `lsof -ti :4100 -sTCP:LISTEN` returns only the server. Every restart destroyed and re-activated the whole extension host, wiping all terminal state — which is why every client-side recovery attempt was futile (there was no live extension to run it).

2. **Tower reassigns the terminal id on every reconcile.** `createSessionRaw` (`pty-manager.ts`) mints a fresh `randomUUID()`; both reconcile paths (`tower-terminals.ts:646` startup, `:832` on-the-fly) register the reconnected shellper under the new id and delete the old SQLite row. That id change is the *source* of the dead-id chain that #936/#971/#991/#997 all work around.

The clean fix is at the source: keep the host alive, and preserve the terminal id across reconcile. Then a Tower restart is just a transient WebSocket blip that the **existing** reconnect machinery (#442/#936) already handles — on both surfaces, with no special recovery code.

## Proposed Change

### Core fix 1 — `afx tower stop` must not kill port clients
`getProcessesOnPort` → `lsof -ti :${port} -sTCP:LISTEN` — match only the listening server, not clients. The function's doc comment already said "processes listening on a port"; this aligns the implementation with its contract. Both callers (the stop path and the running-check) want the listener, so the filter is safe for both.

### Core fix 2 — preserve the terminal id across reconcile
- `createSessionRaw(opts: { label; cwd; id? })` uses `opts.id ?? randomUUID()`. The in-memory sessions map is empty at reconcile time, so reusing the id can't collide.
- Both reconcile paths pass the persisted `dbSession.id`, so the session keeps its identity. The existing delete+save becomes an in-place row refresh under the same id.

Result: the client's `/ws/terminal/<id>` stays valid → the adapter's existing backoff reconnect re-attaches → the terminal resumes with replay. No client-side remount, no give-up-and-reopen.

### Remove the superseded client workarounds
The client-side approaches built earlier this cycle — VSCode successor-remount (`recoverSuccessor`/`onSessionGone`/`resyncAllTerminals`), then close-on-stop/reopen-on-reconnect, and the shared `resolveSuccessorTerminalId` core helper — are obviated by the core fix and were removed (reverted to the `#921` base). The dashboard self-heal (`Terminal.onPermanentClose → App.refresh`) is **kept** (harmless; now dormant since the web url stays valid across a restart).

## Files to Change
- `packages/codev/src/agent-farm/commands/tower.ts` — `getProcessesOnPort` LISTEN filter.
- `packages/codev/src/terminal/pty-manager.ts` — `createSessionRaw` optional `id`.
- `packages/codev/src/agent-farm/servers/tower-terminals.ts` — both reconcile paths pass `dbSession.id`; comments/log updated.
- `packages/codev/src/terminal/__tests__/tower-shellper-integration.test.ts` — id-reuse unit test.
- `packages/vscode/src/terminal-manager.ts`, `packages/vscode/src/extension.ts`, `packages/vscode/src/__tests__/terminal-manager.test.ts` — revert the close/reopen workaround to the `#921` base.
- *(kept)* `packages/dashboard/src/components/Terminal.tsx`, `App.tsx`, `__tests__/Terminal.reconnect.test.tsx` — dashboard self-heal.

## Risks & Alternatives Considered
- **Rejected alternative (the original plan): client-side remount onto the successor id.** Built and iterated extensively (core `resolveSuccessorTerminalId` helper; VSCode per-adapter recovery → reconnect-event resync → close/reopen; dashboard `onPermanentClose → refresh`). It never worked in the reviewer's environment — because the extension host was being killed (root cause #1) and the id kept changing (root cause #2). Abandoned in favor of the core fix. **Lesson: confirm the runtime survives the event before building recovery on top of it.**
- **Risk: LISTEN filter misses the server.** Verified empirically against the live port — `-sTCP:LISTEN` returns exactly the node server, nothing else.
- **Risk: reusing the id collides.** The sessions map is empty at reconcile (Tower just started), so no collision is possible.
- **Risk: reconcile-gap.** A reconnect landing in the brief window after Tower accepts connections but before startup reconcile finishes could still 404 once and recover on the next retry/click. Rare (the client's backoff timing usually lands after reconcile); **#997 (reconcile-before-serving)** makes it deterministic and is the right follow-up. Out of scope here.
- **Scope/area pivot:** #991 is now primarily a **Tower-server** fix (`area/tower`) plus the kept dashboard self-heal — not the cross-cutting client remount the issue framed. The reviewer directed this pivot live at the gate.

## Test Plan
- **Unit:** `createSessionRaw` reuses a provided id and mints a fresh one without one (added); the existing reconcile/shellper tests still pass (id-preservation doesn't break reconcile). Run: `pnpm --filter @cluesmith/codev exec vitest run src/terminal/__tests__/tower-shellper-integration.test.ts src/agent-farm/__tests__/tower-terminals.test.ts`.
- **Build/typecheck:** codev typecheck clean (`tsc --noEmit`); vscode + dashboard suites green.
- **Manual (the dev-approval test — live, reviewer-run since a real Tower bounce kills the builder session):**
  1. `pnpm build && pnpm -w run local-install` — deploys the new `afx` (host-kill fix) and the new Tower server (id preservation).
  2. With a builder/architect terminal open, `afx tower stop && afx tower start`.
  3. **Expect:** the VSCode extension host does **not** restart (it survives), and open terminals reconnect to the **same** session within the normal backoff (replay restored) — no dead pane, no reopen, no new window.
  4. **Negative:** a >~60s downtime shows the existing `Click here to reconnect` give-up; clicking it now reconnects (id preserved) rather than retrying a dead id.
