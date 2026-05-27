# PIR Plan: Restore VSCode auto-close of builder terminal tabs on cleanup

## Understanding

After `afx cleanup` (or VSCode "Cleanup Builder", or any path that
removes a builder), the builder's terminal tab in VSCode stays open as a
dead `Process exited` entry. The 3.0.6 fix
(`dedb09250889113d42ced4e3caf84945037591ef`) was an SSE-driven diff
against Tower's workspace state — when a builder went present→absent,
its `builder-<id>` and `dev-<id>` tabs were disposed. That fix has
regressed; the loop still runs but never observes the absence.

### Root cause (confirmed via live Tower probe)

The diff in `packages/vscode/src/extension.ts:209-234` reads
`client.getWorkspaceState(workspacePath)` and tracks
`state.builders.map(b => b.id)`. That source no longer drops cleaned-up
builders.

Side-by-side probe against the running Tower
(`http://localhost:4100`, my own machine, 2026-05-27):

- **`/workspace/.../api/state`** → 12 builders, including
  `builder-bugfix-799`, `builder-bugfix-838`, `builder-bugfix-839`,
  `builder-bugfix-840`, `builder-bugfix-880`, `builder-pir-819` —
  every one of which has had its worktree removed and PR merged.

- **`/api/overview`** → 6 builders, only the worktrees that still exist
  on disk (pir-793, pir-811, pir-818, pir-857, pir-882, pir-883).

The discrepancy comes from Tower's two builder-discovery paths:

- `/api/state.builders` is built in `handleWorkspaceState`
  (`packages/codev/src/agent-farm/servers/tower-routes.ts:1641`) from
  the in-memory `entry.builders` registry, which is rebuilt from
  SQLite `terminal_sessions` rows via
  `getRehydratedTerminalsEntry` →
  `getTerminalsForWorkspace`
  (`packages/codev/src/agent-farm/servers/tower-terminals.ts:744`).
  When `afx cleanup` leaves a shellper alive (the shellper is detached
  by design and survives Tower restarts), the reconnect-on-the-fly path
  at `tower-terminals.ts:776-879` rebuilds the PtySession from the
  surviving shellper. So the row stays "live" forever.

- `/api/overview.builders` comes from `discoverBuilders`
  (`packages/codev/src/agent-farm/servers/overview.ts:627`) which
  `readdirSync(.builders/)` and reads `status.yaml`. Once `afx cleanup`
  removes the worktree directory (which it does for bugfix builders),
  the builder disappears from this source immediately.

The current diff is reading the wrong source. The user explicitly marks
the Tower-side bookkeeping (orphan shellpers, ghost SQLite rows) as
**Out of scope** for this issue, so the VSCode side must become
resilient to it.

### Mapping the issue's six candidate causes

1. *prune no longer wired* — not the cause; `pruneClosedBuilderTerminals`
   is still called from `overviewCache.onDidChange` at
   `extension.ts:240`.
2. *Tower's `state.builders` not dropping the cleaned-up builder* —
   **yes, this is it**. Confirmed by the side-by-side probe above.
3. *`prevBuilderIds` init race* — not the cause; init was always `null`
   and the first tick after a connect has always populated it. Even if
   there were a race, it wouldn't explain why every long-running session
   sees the bug.
4. *`pruneInFlight` wedged* — not the cause; `finally { pruneInFlight = false; }`
   always resets. (Once we move off `client.getWorkspaceState`, the
   guard goes away entirely because there is no more async work to
   guard.)
5. *Key encoding drift in `closeBuilderTerminal`* — verified intact.
   `openBuilder` and `closeBuilderTerminal` both use map keys
   `builder-${roleId}` and `dev-${roleId}` against the canonical role
   ID; spawn-handler / QuickPick / sidebar all converge on
   `builder.id` from `state.builders` which is the canonical role ID
   for strict-mode builders.
6. *VSCode API regression on `terminal.dispose()`* — disposal is fine
   for terminals the diff actually finds; the bug is that the diff
   doesn't find them.

## Proposed Change

Switch `pruneClosedBuilderTerminals` to read from `overviewCache.getData()`
and diff on `OverviewBuilder.roleId`. The overview data is already
loaded by the cache (the listener fires *after* `refresh()` completes),
so this removes the secondary `getWorkspaceState` fetch entirely. The
function becomes synchronous, and the `pruneInFlight` guard is no
longer needed (no async, nothing to race).

The diff key changes from `state.builders[].id` (canonical roleId for
strict, PtySession UUID for soft mode) to `OverviewBuilder.roleId`
(canonical roleId for strict, `null` for soft mode). For strict-mode
builders both forms are identical — `builder-pir-883`. So the
`closeBuilderTerminal(prev)` call site stays correct.

For soft-mode builders (`task-*` / `worktree-*` worktrees with
`roleId: null`), the tab won't auto-close — but those are rare and the
issue's repro path is `afx spawn --protocol bugfix` (strict). Documented
as a known limitation in the code comment.

I considered alternative approaches and rejected them in
"Risks & Alternatives" below.

## Files to Change

- `packages/vscode/src/extension.ts:199-234` — replace the
  `client.getWorkspaceState` fetch with a synchronous read from
  `overviewCache.getData()`. Drop `pruneInFlight` (no async).
  Rename `prevBuilderIds` → `prevRoleIds` and the local `currIds` →
  `currRoleIds` so the variable names mirror the new diff key.
  Refresh the doc comment to explain why overview (worktree-disk scan)
  is the right source.

- `packages/vscode/src/__tests__/prune-builder-terminals.test.ts` —
  **new** unit test. Extracts the diff logic into a pure helper
  (`computeBuildersToClose(prev, curr) → string[]`) and asserts:
  - present→absent transition returns the absent role ID
  - first tick (prev=null) returns empty
  - state→empty closes all previously-tracked
  - no overview data returns empty (treat as "unknown", don't close)

  The helper lives in extension.ts adjacent to the wiring so it can be
  imported by the test without spinning up a full vscode harness.

## Risks & Alternatives Considered

- **Risk**: Soft-mode builders lose auto-close because their
  `OverviewBuilder.roleId` is `null`. *Mitigation*: documented in
  the code comment; soft-mode is rare and the issue's repro is
  strict-mode.

- **Risk**: A future refactor of `OverviewBuilder.roleId` shape could
  break the diff silently. *Mitigation*: the new unit test exercises
  the diff helper against synthetic OverviewBuilder shapes, so a type
  change would surface there.

- **Risk**: The Tower-side regression (orphan shellpers + ghost
  `terminal_sessions` rows) is left unfixed. *Mitigation*: explicitly
  marked out of scope in the issue. A separate Tower-side issue should
  follow this PR to clean up the ghosts — once that lands, the
  VSCode-side resilience here remains correct.

- **Alternative**: hook into `codev.cleanupBuilder` command to call
  `closeBuilderTerminal` directly after `afx cleanup` exits. *Rejected*
  as the primary fix because it only covers the VSCode-initiated
  cleanup path; CLI-initiated `afx cleanup` (which is what the issue's
  repro step 4 lists first) would still hit the broken diff. We get
  full coverage from the diff change alone, so the extra hook is
  unnecessary surface area.

- **Alternative**: emit a Tower-side `builder-cleaned-up` SSE event
  with the roleId, so VSCode closes directly without diffing.
  *Rejected* as larger-scope and protocol-touching; the OverviewCache
  is already a sufficient signal and is already piped through SSE.

- **Alternative**: check `fs.existsSync(builder.worktree)` in VSCode.
  *Rejected* because `state.builders[].worktree === ''` (empty
  string) — Tower doesn't populate it on this endpoint. We'd be
  adding a code path on the extension side that mirrors what
  `discoverBuilders` already does on the Tower side.

- **Alternative**: keep the `getWorkspaceState` fetch but
  cross-reference each `state.builders` entry against
  `overviewCache.getData().builders` to filter out ghosts.
  *Rejected* as more complex than just using the overview source
  directly. The information content is identical (and the prune is
  already triggered from overview's `onDidChange`).

## Test Plan

### Unit (Vitest)

- New `packages/vscode/src/__tests__/prune-builder-terminals.test.ts`
  exercises the diff helper as described in Files to Change. Asserts
  present→absent triggers close; first tick is a no-op; absent
  overview is a no-op.

### Manual (dev-approval gate — the reviewer runs the worktree)

1. `pnpm build` from the repo root, then `pnpm -w run local-install`
   so VSCode picks up the patched extension (note: this restarts Tower).
2. Spawn a builder: `afx spawn 883 --protocol bugfix` (any fresh
   issue number works — pick one that doesn't collide with an active
   builder).
3. Open the builder's terminal in VSCode (single-click the row in the
   Builders view).
4. Optionally start a dev terminal via right-click → Run Dev Server,
   so both `builder-<id>` and `dev-<id>` tabs exist.
5. Clean up the builder: `afx cleanup -p <id>` from a CLI **outside**
   VSCode, then re-clean from VSCode's right-click "Cleanup Builder"
   for the second variant.
6. Observe within ~5 s of the cleanup printing `Builder ... cleaned up!`:
   - the row disappears from the Builders sidebar (existing behaviour);
   - **the `Codev: <issue>` tab disappears from VSCode's terminal strip**;
   - if a dev terminal was started, **its `(dev)` tab disappears too**.
7. Spawn a fresh builder for an unrelated issue — its terminal opens
   normally (no map-state pollution from the closure).
8. **Regression probe for the orphan-shellper resilience**: confirm via
   `sqlite3 ~/.agent-farm/global.db "SELECT role_id FROM
   terminal_sessions WHERE type='builder'"` that the cleaned-up
   builder's row may still be present (this is the out-of-scope
   Tower-side bug). The VSCode tab still closes — that's the win.

### Negative — no regression on freshly-spawned builders

After step 6/7 above, the new builder's spawn handler must register
its terminal under the correct key so subsequent `openBuilder` calls
re-focus instead of creating a duplicate. Verified by clicking the
builder's row twice (or opening from the QuickPick) and confirming a
single tab.

### Cross-platform

The fix is pure TypeScript on the extension side; no OS-specific
behaviour. The reviewer can run this on whichever OS hosts their
VSCode.
