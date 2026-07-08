# PIR Plan: Removed sibling architect resurrects after Tower recovery

Issue: #1150

## Understanding

`afx workspace remove-architect --name X` kills the sibling's terminal and deletes two DB rows: the `architect` row (via `setArchitectByName(resolvedPath, name, null)`) and the `terminal_sessions` row. Both deletes are wrapped in silent `try { … } catch { /* best-effort cleanup */ }` at `packages/codev/src/agent-farm/servers/tower-instances.ts:1175-1180`. If either delete fails (SQLITE_BUSY past the 5s timeout, IO error), the user still sees "Removed architect 'X'".

Separately, `launchInstance`'s sibling reconciliation loop (`tower-instances.ts:687-699`) reads `getArchitects(resolvedPath)` and unconditionally calls `addArchitect()` for every non-main row not already live in `entry.architects`. `addArchitect` reads the row's stored `session_id` and resumes the old conversation via the harness `session.resumeArgs()` (`--resume` for Claude). There is no liveness check: any residual `architect` row (from a swallowed delete failure, WAL loss at OS-crash time under `synchronous = NORMAL`, or a partial removal) resurrects the sibling on the next workspace launch, and a stale `session_id` additionally triggers the RC2 crash-loop.

Relevant context confirmed during investigation:

- Boot order: `reconcileTerminalSessions()` runs before `initInstances()` (`tower-server.ts:454`). Its Phase 2 sweep (`tower-terminals.ts:807-825`) deletes every `terminal_sessions` row whose shellper is dead. So after a machine crash, legitimate siblings have NO `terminal_sessions` row by the time `launchInstance` runs; their only liveness evidence is the conversation jsonl on disk (`~/.claude/projects/<encoded-cwd>/<session_id>.jsonl`, helpers in `utils/claude-session-discovery.ts`).
- After a clean `afx workspace stop`, the architect exit handlers delete `terminal_sessions` rows unconditionally (e.g. `tower-instances.ts:1020`) while the `architect` rows are preserved via the `intentionallyStopping` flag. Sibling persistence across stop/start (Spec 786 Phase 3) therefore relies solely on `architect` rows. Any liveness gate must not break this.
- Harnesses without the `session` capability (Codex, Gemini: `utils/harness.ts:138-158`) never store a `session_id`. Their rows can never have jsonl evidence, and their respawn is always a fresh spawn (no `--resume`), so pruning them on the strict "terminal_sessions row OR jsonl" rule would silently regress Spec 786 stop/start persistence for non-Claude architects while buying nothing (no conversation can resurrect).

## Proposed Change

Three parts, matching the issue's fix sketch with one deliberate refinement for session-less harnesses.

### Part 1: `removeArchitect` surfaces DB delete failures and becomes retryable

`tower-instances.ts:1158-1193`:

1. Replace the two silent catches with error collection. If either `setArchitectByName(..., null)` or `deleteTerminalSession(terminalId)` throws, still await the exit promise (terminal cleanup proceeds), then return `{ success: false, error: "Architect 'X' terminal was stopped, but deleting its registration failed (<cause>). Its record may resurrect on the next workspace start. Run 'afx workspace remove-architect --name X' again to retry." }`.
2. Make the retry actually work: today a retry after a partial removal hits the `entry.architects.get(name)` miss and returns "not found", even though the zombie row is exactly what needs deleting. In the not-found branch, check `getArchitectByName(resolvedPath, name)`; if a persisted row exists, delete it (plus any architect `terminal_sessions` rows keyed by `(workspace, role_id = name)`), log, and return success. This doubles as the user-facing purge tool for zombie registrations regardless of how they arose.

### Part 2: liveness gate in the sibling reconcile loop

`tower-instances.ts:687-699`: before `addArchitect()`, classify each persisted row:

1. **Live**: a `terminal_sessions` row exists for `(workspace_path IN (resolvedPath, workspacePath), type = 'architect', role_id = name)`. Query via `getGlobalDb()` (already imported).
2. **Live**: the resolved architect harness has no `session` capability. Rationale: the row can never carry resumable-session evidence, respawn is always fresh (no `--resume`, no RC2 exposure, no conversation resurrection), and pruning would break Spec 786 stop/start persistence for Codex/Gemini architects.
3. **Live**: the row has a `session_id` and the harness confirms the session artifact exists on disk (new optional `session.sessionExists()`, below). Checked against both `workspacePath` and `resolvedPath` encodings to be symlink-safe.
4. **Dead** otherwise (session-capable harness with no `session_id`, or a `session_id` whose jsonl is gone): prune with `setArchitectByName(resolvedPath, name, null)` inside its own try/catch, log at INFO ("Pruned dead sibling architect registration 'X': no live terminal and no resumable session"), and skip the respawn.

Harness support (respecting the harness abstraction, no Claude specifics in Tower):

- `utils/claude-session-discovery.ts`: add `sessionFileExists(absolutePath, sessionId, opts?): boolean` (existsSync of `<projects-dir>/<sessionId>.jsonl`, same `opts.homeDir` test hook as `findLatestSessionId`).
- `utils/harness.ts`: extend the `session` capability with optional `sessionExists?(cwd: string, sessionId: string, opts?: { homeDir?: string }): boolean`; implement it on `CLAUDE_HARNESS` via `sessionFileExists`. A session-capable harness that omits it is treated as unverifiable, hence live (never prune without positive evidence of staleness).

Behavior note (deviation from the issue's strict OR rule, called out for review): a legacy pre-#832 Claude-harness row with `session_id = NULL` and no `terminal_sessions` row is pruned (rule 4). That is a one-time migration edge; the user re-adds the sibling once. Session-less harnesses are exempted (rule 2) for the reasons above.

### Part 3 (defense in depth): `synchronous = FULL`

`db/index.ts:40`: switch the pragma from `NORMAL` to `FULL` in `configurePragmas`, with a comment explaining the WAL-loss window this closes (committed transactions lost at power loss under NORMAL). The pragma is per-connection and the shared `global.db` connection has a low write rate (spawn/exit/status events), so the extra fsync per commit is negligible. Toggling the pragma around architect writes only was rejected: it is racy on a shared connection and buys nothing at this write rate.

## Files to Change

- `packages/codev/src/agent-farm/servers/tower-instances.ts:1144-1147` — not-found branch: purge zombie row if a persisted registration exists
- `packages/codev/src/agent-farm/servers/tower-instances.ts:1172-1193` — surface DB delete failures from `removeArchitect`
- `packages/codev/src/agent-farm/servers/tower-instances.ts:687-699` — liveness gate + prune in the sibling reconcile loop (plus a small private helper, e.g. `isSiblingRegistrationLive()`)
- `packages/codev/src/agent-farm/utils/harness.ts` — optional `session.sessionExists?()` on the capability interface; Claude implementation
- `packages/codev/src/agent-farm/utils/claude-session-discovery.ts` — new `sessionFileExists()` helper
- `packages/codev/src/agent-farm/db/index.ts:40` — `synchronous = FULL`
- `packages/codev/src/agent-farm/__tests__/tower-instances.test.ts` — new tests (below)
- `packages/codev/src/agent-farm/__tests__/claude-session-discovery.test.ts` — `sessionFileExists` unit tests

No skeleton mirror needed: all touched files are package source, not framework docs.

## Risks & Alternatives Considered

- **Residual window (documented, not fully closable)**: if a removal commits and the OS then crashes before the WAL is fsync'd, the deletes are lost and the row returns with a valid `session_id` and existing jsonl. No liveness check can distinguish this from a legitimate sibling. Part 3 (`synchronous = FULL`) is the mitigation; Part 1's retryable purge is the recovery path.
- **Risk: pruning a legitimate sibling.** Mitigations: rule 2 exempts session-less harnesses; rule 3 checks both path encodings; jsonl files survive `afx workspace stop` so Spec 786 persistence is intact for Claude architects. The worst case of a wrong prune is "user re-adds the sibling", vs. the current worst case of "removed architect resurrects with its old conversation and can crash-loop".
- **Risk: `synchronous = FULL` slows writes.** Write rate on global.db is low (lifecycle events, not hot-path). Accepted.
- **Alternative rejected: strict "terminal_sessions row OR jsonl" gate exactly as sketched.** Regresses Spec 786 stop/start persistence for Codex/Gemini siblings (their rows never carry a session_id and their terminal_sessions rows are deleted on every clean stop), while the danger the gate targets (conversation resurrection via `--resume`) cannot occur for them.
- **Alternative rejected: tombstone table for removed architects.** A tombstone write is lost in exactly the same WAL-loss window as the delete it guards, so it adds schema for no additional durability.

## Test Plan

Unit tests (vitest, existing mock harness in `tower-instances.test.ts` already stubs the DB via `mockDbPrepare` and deps via `makeDeps()`):

- `removeArchitect`: make `setArchitectByName` (DB `run`) throw; expect `{ success: false }` with an error naming the architect and advising a retry; expect the terminal kill still happened.
- `removeArchitect`: name absent from `entry.architects` but `getArchitectByName` returns a row; expect the row purged and `{ success: true }`.
- Reconcile loop: persisted sibling row, no `terminal_sessions` row, Claude harness, `session_id` set but jsonl missing; expect prune (`DELETE FROM architect` issued for that name) and no spawn.
- Reconcile loop: same but jsonl present (via `homeDir` test hook or a mocked harness `sessionExists`); expect respawn attempt.
- Reconcile loop: matching `terminal_sessions` row; expect respawn attempt without consulting jsonl.
- Reconcile loop: session-less harness (Codex) row with `session_id = NULL`; expect respawn (fresh), not prune.
- `sessionFileExists`: true when the jsonl exists under the encoded dir, false when missing, `homeDir` override respected.

Build + full test suite from the worktree: `pnpm --filter @cluesmith/codev build && pnpm --filter @cluesmith/codev test`.

Manual verification at the dev-approval gate (commands for the reviewer; they mutate the live Tower DB so the reviewer runs them):

1. Insert a fake dead registration into `~/.agent-farm/global.db`:
   `sqlite3 ~/.agent-farm/global.db "INSERT OR REPLACE INTO architect (workspace_path, id, pid, port, cmd, started_at, terminal_id, session_id) VALUES ('<workspace>', 'ghost', 0, 0, 'claude', datetime('now'), NULL, 'deadbeef-0000-0000-0000-000000000000')"`
2. Restart the workspace (`afx workspace stop` / `start`) with the locally installed build; observe the "Pruned dead sibling architect registration 'ghost'" log line and confirm no ghost architect appears in `afx status`.
3. Add a real sibling (`afx workspace add-architect --name tmp`), `afx workspace stop`, `afx workspace start`: confirm the sibling still resurrects with its conversation (Spec 786 persistence intact).
4. `afx workspace remove-architect --name tmp`, then stop/start again: confirm it stays gone.
