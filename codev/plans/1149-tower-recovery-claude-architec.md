# PIR Plan: Break the stale `--resume` crash-loop with a crash-loop fallback

## Understanding

After a Tower recovery event, an architect row in `~/.agent-farm/global.db` can carry a `session_id` that Claude cannot resume. Every restart path bakes `--resume <uuid>` into the replayed launch args:

- Startup reconcile: `packages/codev/src/agent-farm/servers/tower-terminals.ts:656-675`
- On-the-fly reconnect: `packages/codev/src/agent-farm/servers/tower-terminals.ts:899-913`
- Cold spawn of `main`: `packages/codev/src/agent-farm/servers/tower-instances.ts:529-561`
- Cold spawn of a named sibling: `packages/codev/src/agent-farm/servers/tower-instances.ts:994-1026`

All four hand static args to the shellper layer. `SessionManager.setupAutoRestart` (`packages/codev/src/terminal/session-manager.ts:845-891`) replays `session.options.args` verbatim after `restartDelay` (2s) up to `maxRestarts` (50). Claude exits immediately on an unresumable `--resume`, so the restart counter never resets (`startRestartResetTimer` is cancelled on every exit at `session-manager.ts:853-856`), and the user watches ~100 seconds of "Could not resume session" with no escape short of killing Tower or hand-editing the DB. Worse, the poisoned id survives in the DB, so the next recovery relearns it.

### What already merged on main (this plan is rebased on top)

Two related fixes landed since the issue was filed and narrow the problem:

- **#1145** added a resolve-time ownership check: `resolveArchitectLaunch` (`tower-utils.ts:264-297`) only takes the resume branch when the harness's `verifyOwnership` confirms the session jsonl still exists on disk (`claude-session-discovery.ts:94-113`, file-existence only by design). A stored id whose jsonl is gone now degrades to a fresh spawn at bake time, and the fresh minted id the caller persists replaces the stale one. #1145 also removed the mtime jsonl-discovery fallback for architects entirely.
- **#1150** prunes dead sibling registrations at reconcile via `siblingRegistrationIsLive` (`tower-utils.ts:231-240`): a session-capable row whose stored id fails ownership is deleted instead of resurrected.

### The residual gap this issue still needs to close

The #1145 check runs once, at bake time. The baked args are then replayed verbatim for up to 50 restarts across the shellper's lifetime, which can span days. Three failure modes still produce the exact crash-loop the issue describes:

1. **Bake-to-replay divergence.** The jsonl exists when the restart args are baked (reconcile or spawn), then vanishes before a later Claude crash triggers the replay: Claude Code's own transcript cleanup (`cleanupPeriodDays`, 30 days by default), or any external pruning of `~/.claude`. The stale `--resume` is already frozen into `session.options.args` and no re-validation happens per restart.
2. **Corrupted transcript.** #1145 deliberately narrowed verification to file existence (content scanning was dropped). A machine crash mid-write leaves a truncated jsonl that exists but that Claude refuses to resume. Pre-flight passes; every restart fails.
3. **Any other runtime resume failure** (version-incompatible transcript format, etc.). Existence cannot predict resumability; only Claude's exit status is ground truth.

So the fix is the runtime complement to #1145's pre-flight check: detect that the replayed launch is fast-failing, fall back to a fresh launch, and repair the stored id. This also matches the design intent recorded at `harness.ts:93-97`: codex/gemini never replay a session id and thus cannot loop; Claude should degrade into the same state automatically.

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
    /** Fired once when the fallback is applied (caller repairs persisted state, logs). */
    onApply?: () => void;
  };
  ```

- Add `failingExitTimes: number[]` to `ManagedSession` (`session-manager.ts:113-124`).
- In `setupAutoRestart`'s exit handler, read the `ExitMessage` payload (`{ code, signal }`, already emitted by `ShellperClient` but currently ignored by this handler). On each exit with `code !== 0`, record a timestamp and prune entries older than 30s. When 3 or more failing exits sit inside the window AND `crashLoopFallback` is present: swap `session.options.args` / `session.options.env` to the fallback values, log `Session <id> crash-looping; applying fallback launch args`, invoke `onApply` (guarded by try/catch), and clear the fallback so it is one-shot. The next scheduled spawn (attempt 4) picks up the swapped options automatically since `spawn()` reads `session.options`.
- Only failing exits count. A user who quits a healthy Claude session three times in 30 seconds (code 0) must not silently lose a valid resumable conversation.
- The detection threshold logic is extracted into a small exported pure helper (timestamps in, boolean out) so it is unit-testable without spawning processes.

### 2. Tower-side wiring: compute the fallback, repair the stored id

- `resolveArchitectLaunch` (`tower-utils.ts:264-297`): when it takes the resume branch, additionally compute the fresh-launch variant (mint a new uuid, pin via `newSessionArgs`, include role injection) and return it as `fallback: { args, env, sessionId }`. The resume branch skips role injection, so the fallback cannot be "args minus --resume"; it has to be the real fresh variant. Note: this mints a uuid and rewrites `.architect-role.md` on every resume resolve; both are cheap and idempotent, and resolves only run at Tower startup, reconnect, or spawn.
- `resolveArchitectRestart` (`tower-utils.ts:313-324`) passes `fallback` through.
- New helper in `state.ts` (near `setArchitectByName`, `state.ts:151-171`):

  ```ts
  export function setArchitectSessionId(workspacePath: string, name: string, sessionId: string | null): void
  ```

  Targeted `UPDATE architect SET session_id = ? WHERE workspace_path = ? AND id = ?` (no full-row upsert).
- At all four call sites, when `resumed` is true, build `crashLoopFallback` from the resolved fallback (env merged the same way as the primary env, e.g. `{ ...cleanEnv, ...fallback.env }`) with `onApply` doing two things: `setArchitectSessionId(workspacePath, architectName, fallback.sessionId)` and a single log line `resume session <uuid> unrecoverable; retrying without --resume`. The uuid-specific log lives at the Tower layer because only it knows the uuid; the session manager logs generically.

**Persist the fallback's minted id, not NULL.** The original issue sketch said "null out the stored session_id", and the first draft of this plan followed it. Two things merged on main flip that decision:

- #1150's liveness pruning treats a session-capable sibling row with a NULL id as a dead registration and deletes it at the next reconcile. Nulling a crash-looped sibling's id would silently unregister an architect the user never removed.
- #1145's ownership check makes persisting the minted id safe. The old risk was that the fresh spawn crashes before Claude writes the jsonl, leaving a poisoned id that loops again on the next recovery. Now a persisted id whose jsonl never materialized fails the existence check at the next bake and degrades to a fresh spawn with zero crash cycles.

Persisting the minted id also preserves the fallback session's conversation across the next Tower restart, which NULL would discard. The issue's actual goal ("future reconciles don't relearn the poisoned id") is satisfied either way: the poisoned id is replaced rather than cleared.

### 3. Escape hatch: `CODEV_SKIP_RESUME=1`

In `resolveArchitectLaunch`, when `process.env.CODEV_SKIP_RESUME === '1'`, ignore `storedSessionId` entirely and take the fresh branch. This gives users an immediate manual escape (restart Tower with the env var) even when the stored id passes the existence check but is unresumable in practice (the corrupted-transcript case), before the automatic fallback triggers.

## Files to Change

- `packages/codev/src/terminal/session-manager.ts:32-54` : add `crashLoopFallback` to `CreateSessionOptions` and `ReconnectRestartOptions`
- `packages/codev/src/terminal/session-manager.ts:113-124` : add `failingExitTimes` to `ManagedSession`
- `packages/codev/src/terminal/session-manager.ts:845-891` : failure-window detection + fallback swap in `setupAutoRestart`; small exported pure helper for the window check
- `packages/codev/src/agent-farm/servers/tower-utils.ts:264-297` : `CODEV_SKIP_RESUME` check; compute and return `fallback` on the resume branch
- `packages/codev/src/agent-farm/servers/tower-utils.ts:313-324` : pass `fallback` through `resolveArchitectRestart`
- `packages/codev/src/agent-farm/state.ts` : new `setArchitectSessionId(workspacePath, name, sessionId)`
- `packages/codev/src/agent-farm/servers/tower-terminals.ts:656-675, 899-913` : wire `crashLoopFallback` + `onApply` in both reconcile sites
- `packages/codev/src/agent-farm/servers/tower-instances.ts:529-561, 994-1026` : wire `crashLoopFallback` + `onApply` in both cold-spawn sites
- `packages/codev/src/terminal/__tests__/session-manager.test.ts` : detector tests (see Test Plan)
- `packages/codev/src/agent-farm/__tests__/tower-utils.test.ts` : `fallback` shape + `CODEV_SKIP_RESUME` tests (using the existing `homeDir` test seam from #1145)
- state tests (existing agent-farm test suite) : `setArchitectSessionId` updates only the target row's column

No `codev-skeleton/` mirror needed: this is package source, not framework template content.

## Risks & Alternatives Considered

- **Risk: false-positive fallback discards a valid conversation.** Mitigated by counting only nonzero-code exits and requiring 3 within 30s. A healthy interactive session cannot fail that pattern; intentional kills remove the session from the map before the handler runs (`session-manager.ts:848`).
- **Risk: the fresh fallback also crash-loops (broken binary, bad config).** The fallback is one-shot, so the loop then proceeds to the existing `maxRestarts` cap, which is today's behavior; no regression. The persisted minted id cannot re-poison the row: if its jsonl never materializes, the #1145 existence check filters it at the next bake.
- **Alternative: clear `session_id` to NULL on fallback (the issue sketch).** Rejected after rebase: #1150 prunes sibling rows with NULL ids as dead registrations, so nulling would unregister a live sibling architect at the next reconcile; and NULL discards the fallback session's continuity for no safety gain now that #1145 validates ids at bake time.
- **Alternative: re-validate ownership at each restart instead of once at bake** (make `setupAutoRestart` recompute args per attempt via a callback). Closes the bake-to-replay divergence but not the corrupted-transcript case (existence passes, resume fails), so the runtime detector is still needed; at that point per-restart re-validation is redundant machinery. Rejected.
- **Alternative: strip `--resume <uuid>` textually inside `setupAutoRestart`.** Rejected: puts a Claude-specific flag into the harness-neutral terminal layer, violating the HarnessProvider abstraction the codebase deliberately maintains (and that #1145 just reinforced via the `verifyOwnership` capability).
- **Alternative: health-signal-based restart counter reset (only reset after N seconds alive).** Broader redesign of restart accounting; heavier than needed and does not repair the poisoned id, so the user would still wait out a slow backoff on every restart.

## Test Plan

Unit tests (run from the worktree: `cd packages/codev && pnpm test`):

- Pure helper: timestamp windows (2 failures in 30s: no; 3 in 30s: yes; 3 spread over 40s: no).
- Session-manager integration (CI-skipped, real shellper, mirroring the existing `respects maxRestarts limit` test at `session-manager.test.ts:1078`): `createSession` with `command: /bin/sh, args: ['-c', 'exit 1']`, `restartDelay: 100`, and a `crashLoopFallback` whose args touch a sentinel file then sleep. Assert: `onApply` fired exactly once, the sentinel file appears (attempt 4 used fallback args), and no further failing restarts occur.
- Clean-exit guard: same setup but `exit 0`; assert `onApply` never fires.
- `resolveArchitectLaunch` (with the `homeDir` seam pointing at a fixture session store): resume branch returns `fallback` with role injection and a fresh pinned id; fresh branch returns no `fallback`; `CODEV_SKIP_RESUME=1` forces the fresh branch even with a stored, ownership-passing id.
- `setArchitectSessionId`: updates `session_id` for the target `(workspace_path, id)` row only.

Manual verification at the dev-approval gate. Note the repro changed after #1145: a bare poisoned id in the DB is now defused at bake time by the existence check, so the repro must make the jsonl exist but be unresumable (exactly residual failure mode 2):

1. Build and install locally: `pnpm build && pnpm -w run local-install` (restarts Tower).
2. In a scratch workspace with a running architect, read the stored id:
   `sqlite3 ~/.agent-farm/global.db "SELECT session_id FROM architect WHERE workspace_path = '<ws>' AND id = 'main'"`
3. Corrupt its transcript in place (keeps existence-check passing):
   `: > ~/.claude/projects/<encoded-ws>/<uuid>.jsonl`
4. Kill the architect's claude process (not the shellper): the auto-restart replays `--resume` against the now-empty transcript.
5. Observe in Tower logs: three fast "Could not resume" failures, then `resume session <uuid8>… unrecoverable; retrying without --resume`, then a fresh architect session comes up with the role prompt applied.
6. Verify the DB row: `session_id` now holds the fallback's freshly minted uuid, and after interacting with the fresh session its jsonl exists (so the next restart resumes it).
7. Escape hatch: repeat the corruption, restart Tower with `CODEV_SKIP_RESUME=1`, verify the architect starts fresh with no crash cycle at all.
