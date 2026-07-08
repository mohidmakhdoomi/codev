# PIR Plan: Break the stale `--resume` crash-loop with a crash-loop fallback

## Understanding

After a Tower recovery event, an architect row in `~/.agent-farm/global.db` can carry a `session_id` whose Claude jsonl no longer exists (deleted, corrupted, or foreign per #1145). Every restart path bakes `--resume <uuid>` into the replayed launch args:

- Startup reconcile: `packages/codev/src/agent-farm/servers/tower-terminals.ts:663-675`
- On-the-fly reconnect: `packages/codev/src/agent-farm/servers/tower-terminals.ts:901-913`
- Cold spawn of `main`: `packages/codev/src/agent-farm/servers/tower-instances.ts:500-533` (this path can also learn a poisoned id via the legacy `buildResume` jsonl discovery at `tower-instances.ts:493-499`, the #1145 trigger)
- Cold spawn of a named sibling: `packages/codev/src/agent-farm/servers/tower-instances.ts:945-977`

All four hand static args to the shellper layer. `SessionManager.setupAutoRestart` (`packages/codev/src/terminal/session-manager.ts:845-891`) replays `session.options.args` verbatim after `restartDelay` (2s) up to `maxRestarts` (50). Claude exits immediately on an unresumable `--resume`, so the restart counter never resets (`startRestartResetTimer` is cancelled on every exit at `session-manager.ts:853-856`), and the user watches ~100 seconds of "Could not resume session" with no escape short of killing Tower or hand-editing the DB.

The design intent already exists in the codebase: the comment at `packages/codev/src/agent-farm/utils/harness.ts:85-88` notes codex/gemini avoid this class of crash-loop by never replaying a session id. Claude should degrade into the same state automatically.

## Proposed Change

Two mechanisms, matching the issue sketch, plus the optional escape hatch:

### 1. Generic crash-loop fallback in `SessionManager` (harness-neutral)

`session-manager.ts` is generic terminal infrastructure and must not know about `--resume` or any Claude flag. Instead, callers supply a precomputed fallback launch configuration, and the session manager applies it when it detects fast failure:

- Add to both `CreateSessionOptions` and `ReconnectRestartOptions` (`session-manager.ts:32-54`):

  ```ts
  /** Alternate launch config applied once if the session crash-loops
   *  (>= 3 failing exits within 30s). Caller precomputes it. */
  crashLoopFallback?: {
    args: string[];
    env: Record<string, string>;
    /** Fired once when the fallback is applied (caller clears persisted state, logs). */
    onApply?: () => void;
  };
  ```

- Add `failingExitTimes: number[]` to `ManagedSession` (`session-manager.ts:113-124`).
- In `setupAutoRestart`'s exit handler, read the `ExitMessage` payload (`{ code, signal }`, already emitted by `ShellperClient` at `shellper-client.ts:233-240` but currently ignored by this handler). On each exit with `code !== 0`, record a timestamp and prune entries older than 30s. When 3 or more failing exits sit inside the window AND `crashLoopFallback` is present: swap `session.options.args` / `session.options.env` to the fallback values, log `Session <id> crash-looping; applying fallback launch args`, invoke `onApply` (guarded by try/catch), and clear the fallback so it is one-shot. The next scheduled spawn (attempt 4) picks up the swapped options automatically since `spawn()` reads `session.options`.
- Only failing exits count. A user who quits a healthy Claude session three times in 30 seconds (code 0) must not silently lose a valid resumable conversation.
- The detection threshold logic is extracted into a small exported pure helper (timestamps in, boolean out) so it is unit-testable without spawning processes.

### 2. Tower-side wiring: compute the fallback, clear the poisoned id

- `resolveArchitectLaunch` (`tower-utils.ts:208-236`): when it takes the resume branch, additionally compute the fresh-launch variant (mint a new uuid, pin via `newSessionArgs`, include role injection) and return it as `fallback: { args, env, sessionId }`. The resume branch skips role injection, so the fallback cannot be "args minus --resume"; it has to be the real fresh variant. Note: this mints a uuid and rewrites `.architect-role.md` on every resume resolve; both are cheap and idempotent, and reconciles only run at Tower startup or reconnect.
- `resolveArchitectRestart` (`tower-utils.ts:252-260`) passes `fallback` through.
- New helper in `state.ts` (near `setArchitectByName`, `state.ts:151-171`):

  ```ts
  export function clearArchitectSessionId(workspacePath: string, name: string): void
  ```

  Targeted `UPDATE architect SET session_id = NULL WHERE workspace_path = ? AND id = ?` (no full-row upsert).
- At all four call sites, when `resumed` is true, build `crashLoopFallback` from the resolved fallback (env merged the same way as the primary env, e.g. `{ ...cleanEnv, ...fallback.env }`) with `onApply` doing two things: `clearArchitectSessionId(workspacePath, architectName)` and a single log line `resume session <uuid> unrecoverable; retrying without --resume`. The uuid-specific log lives at the Tower layer because only it knows the uuid; the session manager logs generically.

Clearing to NULL (rather than persisting the fallback's minted id) follows the issue sketch: future reconciles won't relearn the poisoned id, and the fresh branch already self-heals the column on the next cold spawn (existing behavior documented at `tower-terminals.ts:656-662`).

### 3. Escape hatch: `CODEV_SKIP_RESUME=1`

In `resolveArchitectLaunch`, when `process.env.CODEV_SKIP_RESUME === '1'`, ignore `storedSessionId` entirely and take the fresh branch. This gives users an immediate manual escape (restart Tower with the env var) even before the automatic fallback triggers, and covers non-architect resume paths becoming poisoned in ways the detector cannot see.

## Files to Change

- `packages/codev/src/terminal/session-manager.ts:32-54` : add `crashLoopFallback` to `CreateSessionOptions` and `ReconnectRestartOptions`
- `packages/codev/src/terminal/session-manager.ts:113-124` : add `failingExitTimes` to `ManagedSession`
- `packages/codev/src/terminal/session-manager.ts:845-891` : failure-window detection + fallback swap in `setupAutoRestart`; small exported pure helper for the window check
- `packages/codev/src/agent-farm/servers/tower-utils.ts:208-236` : `CODEV_SKIP_RESUME` check; compute and return `fallback` on the resume branch
- `packages/codev/src/agent-farm/servers/tower-utils.ts:252-260` : pass `fallback` through `resolveArchitectRestart`
- `packages/codev/src/agent-farm/state.ts` : new `clearArchitectSessionId(workspacePath, name)`
- `packages/codev/src/agent-farm/servers/tower-terminals.ts:663-675, 901-913` : wire `crashLoopFallback` + `onApply` in both reconcile sites
- `packages/codev/src/agent-farm/servers/tower-instances.ts:500-533, 945-977` : wire `crashLoopFallback` + `onApply` in both cold-spawn sites
- `packages/codev/src/terminal/__tests__/session-manager.test.ts` : detector tests (see Test Plan)
- `packages/codev/src/agent-farm/__tests__/tower-utils.test.ts` : `fallback` shape + `CODEV_SKIP_RESUME` tests
- state tests (existing agent-farm test suite) : `clearArchitectSessionId` nulls only the target row's column

No `codev-skeleton/` mirror needed: this is package source, not framework template content.

## Risks & Alternatives Considered

- **Risk: false-positive fallback discards a valid conversation.** Mitigated by counting only nonzero-code exits and requiring 3 within 30s. A healthy interactive session cannot fail that pattern; intentional kills remove the session from the map before the handler runs (`session-manager.ts:848`).
- **Risk: the fresh fallback also crash-loops (broken binary, bad config).** The fallback is one-shot, so the loop then proceeds to the existing `maxRestarts` cap, which is today's behavior; no regression.
- **Alternative: persist the fallback's minted session id instead of NULL.** Would preserve the fallback session's conversation across the next Tower restart. Rejected for now: if the fresh spawn crashes before Claude writes the jsonl, the row is poisoned again (the detector would still catch it, but each recovery costs another 3-crash cycle). NULL is strictly safer and matches the issue sketch. Easy follow-up if the conversation-continuity gap matters in practice.
- **Alternative: strip `--resume <uuid>` textually inside `setupAutoRestart`.** Rejected: puts a Claude-specific flag into the harness-neutral terminal layer, violating the HarnessProvider abstraction the codebase deliberately maintains.
- **Alternative: health-signal-based restart counter reset (only reset after N seconds alive).** Broader redesign of restart accounting; heavier than needed and does not remove the poisoned id, so the user would still wait out a slow backoff on every restart.

## Test Plan

Unit tests (run from the worktree: `cd packages/codev && pnpm test`):

- Pure helper: timestamp windows (2 failures in 30s: no; 3 in 30s: yes; 3 spread over 40s: no).
- Session-manager integration (CI-skipped, real shellper, mirroring the existing `respects maxRestarts limit` test at `session-manager.test.ts:1078`): `createSession` with `command: /bin/sh, args: ['-c', 'exit 1']`, `restartDelay: 100`, and a `crashLoopFallback` whose args touch a sentinel file then sleep. Assert: `onApply` fired exactly once, the sentinel file appears (attempt 4 used fallback args), and no further failing restarts occur.
- Clean-exit guard: same setup but `exit 0`; assert `onApply` never fires.
- `resolveArchitectLaunch`: resume branch returns `fallback` with role injection and a fresh pinned id; fresh branch returns no `fallback`; `CODEV_SKIP_RESUME=1` forces the fresh branch even with a stored id.
- `clearArchitectSessionId`: nulls `session_id` for the target `(workspace_path, id)` row only.

Manual verification at the dev-approval gate (poisoned-id repro):

1. Build and install locally: `pnpm build && pnpm -w run local-install` (restarts Tower).
2. In a scratch workspace with a running architect, poison the stored id:
   `sqlite3 ~/.agent-farm/global.db "UPDATE architect SET session_id = '00000000-0000-0000-0000-000000000000' WHERE workspace_path = '<ws>' AND id = 'main'"`
3. Kill the architect's claude process (not the shellper): the auto-restart replays `--resume` with the bogus id.
4. Observe in Tower logs: three fast "Could not resume" failures, then `resume session 00000000… unrecoverable; retrying without --resume`, then a fresh architect session comes up with the role prompt applied.
5. Verify the DB row: `session_id` is NULL.
6. Escape hatch: re-poison the row, restart Tower with `CODEV_SKIP_RESUME=1`, verify the architect starts fresh with no crash cycle at all.
