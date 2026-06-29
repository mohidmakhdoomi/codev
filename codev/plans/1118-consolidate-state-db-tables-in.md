# PIR Plan: Consolidate state.db tables into global.db

## Understanding

`state.db` is named/located as workspace-local (`<workspaceRoot>/.agent-farm/state.db`)
but its scope is effectively user-global: since Bugfix #826 (Migration v11) the `architect`
table is keyed by `(workspace_path, id)`, so one file holds rows from every workspace Tower
touched while parked in that directory. The lie is the **file location**, not the schema.

**Root cause of "missing architect state after restart"** (verified):
`getDb()` (`packages/codev/src/agent-farm/db/index.ts:54`) is a singleton whose path is
`getConfig().stateDir` → `<workspaceRoot>/.agent-farm/state.db`, and `workspaceRoot` is
derived from the process CWD via `findWorkspaceRoot()` (`utils/config.ts:75`). Tower is a
system-wide singleton serving many workspaces, but its `getDb()` is frozen to whichever
workspace it was *started from*. `setArchitect(resolvedPath, …)` (`state.ts:113`) already
writes the correct `workspace_path` column, but always into Tower-CWD's state.db **file**.
So:

- Tower started from A → all architect rows (for A, B, C…) land in `A/.agent-farm/state.db`.
- Reboot, Tower starts from B → `getDb()` now opens `B/.agent-farm/state.db`; A's rows are
  intact on disk but invisible to the running Tower. Hence "some architects missing."

Two direct-open workarounds exist **because** of this singleton-path bug and should collapse
once the DB is genuinely process-wide:
- `state.ts:491` `lookupBuilderSpawningArchitect(builderId, workspacePath?)` opens
  `<workspacePath>/.agent-farm/state.db` read-only (line 496).
- `servers/overview.ts:817` opens `<workspaceRoot>/.agent-farm/state.db` read-only to enrich
  builders by `worktree`.

**Schema reality that shapes the design**: only `architect` carries `workspace_path`.
`builders` is keyed by `id` (and has a `worktree` path column), `utils` and `annotations`
are keyed by `id` with no workspace linkage at all. `builders`/`utils`/`annotations` are
runtime state (wiped by `clearRuntime()`/`clearState()` on workspace stop); the audited
stale rows in the issue (17 test-workspace + 11 builder-worktree) are all **architect** rows.

The fix: retire the per-workspace `state.db` *file*; move its four tables into the already
user-global `~/.agent-farm/global.db`; make `getDb()` return the global connection; let the
existing `workspace_path` column disambiguate architect rows within the single shared file.

## Proposed Change

### A. Schema: move the four tables into global.db (new global migration v14)
- Add `architect`, `builders`, `utils`, `annotations` (with their indexes + the
  `builders_updated_at` trigger and `idx_architect_workspace`) to `GLOBAL_SCHEMA`
  (`db/schema.ts`) so fresh installs create them in global.db at final shape.
- Bump `GLOBAL_CURRENT_VERSION` 13 → 14. Add migration v14 in `ensureGlobalDatabase()`
  (`db/index.ts:625`) that, on existing global.dbs, creates the four tables at their final
  v12-local shape (composite-PK architect incl. `session_id`, `type` CHECK incl. `'pir'`,
  `spawned_by_architect`, etc.). Idempotent via `CREATE TABLE IF NOT EXISTS` + the v14
  `_migrations` row.
- Drop `LOCAL_SCHEMA` and the entire `ensureLocalDatabase()` local-migration ladder (v1–v12)
  from the live path. Keep `LOCAL_SCHEMA` exported only if still referenced by the one-time
  consolidation reader (see C); otherwise remove. (Local migrations v1–v12 are folded into
  the v14 table definitions — they only ever ran against the now-retired file.)

### B. `getDb()` returns the global connection
- `db/index.ts`: `getDb()` → returns `getGlobalDb()` (single shared `~/.agent-farm/global.db`,
  honoring the existing `NODE_ENV=test`/`AF_TEST_DB` isolation in `getGlobalDbPath()`).
  Remove `_localDb`, `ensureLocalDatabase()`, and the CWD-dependent
  `resolve(config.stateDir, 'state.db')` creation. `getDbPath()` → returns
  `getGlobalDbPath()`. `closeDb()` → alias to `closeGlobalDb()` (or no-op; `closeAllDbs()`
  collapses).
- `state.ts` keeps all signatures unchanged — `workspace_path` stays the architect-row
  disambiguator, now within the shared DB instead of selecting a file.
- Replace the two direct-open workarounds with the now-correct shared connection:
  - `lookupBuilderSpawningArchitect`: drop the `<ws>/.agent-farm/state.db` open; query
    `getDb()` by `id` (builder ids are globally unique). Keep the `workspacePath?` param for
    signature stability (vestigial) or remove if no caller relies on it — confirm via grep.
  - `overview.ts:808-836`: open `getGlobalDbPath()` read-only (or use `getDb()`); match by
    `worktree` (unique) as today.

### C. One-time on-disk consolidation (migrate legacy state.db files)
New module `db/consolidate.ts`:
- `discoverLegacyStateDbFiles(globalDb): string[]` — union of: every
  `<workspace_path>/.agent-farm/state.db` from `known_workspaces`, plus
  `~/.agent-farm/state.db` (the `$HOME`-fallback file), filtered to existing files.
- `planConsolidation(globalDb, files): ConsolidationPlan` — pure read: for each of the four
  tables, collect rows from all sources, and report per-table merge counts + **conflicts**
  (same primary key present in ≥2 source files with differing content). No writes.
- `applyConsolidation(globalDb, files, plan)` — for each table, gather all source rows,
  sort ascending by `started_at`, `INSERT OR REPLACE` in that order so **latest-started_at
  wins** on PK collisions. Then rename each source file to `state.db.pre-merge-<timestamp>`
  (preserve, never delete). Wrapped in a transaction for the row merge; renames after commit.
- Idempotency marker: a dedicated single-row marker (recommended: a `_consolidation` row in
  global.db, or a reserved `_migrations` sentinel — see Open Questions). Once set, the step
  is a no-op.

**Where it runs**:
- Normal start: invoked at Tower boot in `tower-server.ts main()` (apply mode), before
  `initInstances()`. (Schema v14 is already applied by the first `getGlobalDb()`.)
- Preview: `afx tower start --dry-run-migration` computes + prints the plan (sources, per-table
  counts, conflicts) and **exits without spawning the server**. `--apply-migration` (or plain
  `afx tower start`) commits. Dry-run opens global.db read-only/defensively so it never
  applies the consolidation as a side effect.

### D. `afx prune-state` (new top-level command)
Removes stale rows whose owning workspace is not in `known_workspaces`. Dry-run by default;
`--apply` commits. Per-table strategy (differs because only `architect` has `workspace_path`):
- `architect`: delete where `workspace_path NOT IN (SELECT workspace_path FROM known_workspaces)`.
  (Covers the entire audited stale set.)
- `builders`: derive the owning workspace from the `worktree` path (prefix before
  `/.builders/`); delete where the derived workspace ∉ `known_workspaces`.
- `annotations`: delete orphans (`parent_id` no longer references a surviving
  architect/builder/util row).
- `utils`: runtime-ephemeral, no workspace linkage — **out of scope** for prune-state
  (documented), relies on `clearRuntime()`. (See Open Questions — reviewer may prefer a
  dead-PID prune.)

### E. `afx workspace forget <path>` (new workspaceCmd subcommand)
Canonicalizes `<path>`, deletes it from `known_workspaces`, then prunes its rows in one shot
(architect by `workspace_path`; builders by `worktree` prefix). The clean retire-a-deleted-
workspace command. Reuses the prune helpers from D scoped to one workspace.

### F. Leave in place (per issue "what doesn't change")
- `~/.agent-farm/global.db` location; `known_workspaces`, `terminal_sessions`,
  `port_allocations`, `file_tabs`, `cron_tasks`.
- `architect.workspace_path` column (still the disambiguator).
- The per-workspace `.agent-farm/` directory (forward-compat; not deleted by migration).
- Migration v12's `session_id` work.

## Files to Change

- `packages/codev/src/agent-farm/db/schema.ts` — add the four tables (+indexes/trigger) to
  `GLOBAL_SCHEMA`; retire/trim `LOCAL_SCHEMA`.
- `packages/codev/src/agent-farm/db/index.ts` — `getDb()`→`getGlobalDb()`; remove
  `ensureLocalDatabase` + local migration ladder; bump `GLOBAL_CURRENT_VERSION` to 14 + add
  global migration v14; `getDbPath()`→`getGlobalDbPath()`; collapse `closeDb`.
- `packages/codev/src/agent-farm/db/consolidate.ts` — **new**: discover/plan/apply + marker.
- `packages/codev/src/agent-farm/state.ts:491-516` — drop the per-workspace direct open in
  `lookupBuilderSpawningArchitect`; use `getDb()`.
- `packages/codev/src/agent-farm/servers/overview.ts:808-836` — open `getGlobalDbPath()` /
  `getDb()` instead of `<ws>/.agent-farm/state.db`.
- `packages/codev/src/agent-farm/servers/tower-server.ts` — invoke `applyConsolidation` at
  boot (apply mode, marker-guarded).
- `packages/codev/src/agent-farm/commands/tower.ts` — `--dry-run-migration` /
  `--apply-migration` handling in `towerStart` (preview-and-exit path).
- `packages/codev/src/agent-farm/commands/prune-state.ts` — **new**: `afx prune-state`.
- `packages/codev/src/agent-farm/commands/workspace-forget.ts` — **new**:
  `afx workspace forget <path>`.
- `packages/codev/src/agent-farm/cli.ts` — register `prune-state`, `workspace forget`, and
  the new tower-start flags.
- `packages/codev/src/agent-farm/commands/db.ts` — `--global`/local now alias the same file;
  simplify or keep both for compat.
- Tests: update `__tests__/state.test.ts` mock (the four tables now come from `GLOBAL_SCHEMA`
  via `getGlobalDb`; `getDb` returns it); add `__tests__/consolidate.test.ts`,
  `prune-state.test.ts`, `workspace-forget.test.ts`. Audit other DB-touching tests
  (`bugfix-826-migration`, `migrate`, `tower-instances`, `overview`, `concurrency`,
  `spec-755-*`) for the `getDb`≡`getGlobalDb` change.
- Docs: `codev/resources/arch.md` + `arch-critical.md` (the "state lives in state.db +
  global.db" fact becomes "single user-global global.db"). Mirror to `AGENTS.md`/`CLAUDE.md`
  only if the hot fact text changes. Done in the review phase per tier routing.

## Risks & Alternatives Considered

- **Risk — data loss on a botched merge.** Mitigation: sources are renamed, never deleted
  (`*.pre-merge-<ts>`); merge is transactional; dry-run preview surfaces conflicts before any
  write; idempotent marker prevents re-merge.
- **Risk — a stray `getGlobalDb()` from a read-only CLI command triggers the file
  rename/merge before the user runs Tower.** Mitigation: schema (v14) is separated from the
  data consolidation; the consolidation is gated to Tower boot / explicit `--apply-migration`,
  not to mere DB open. Dry-run opens defensively (read-only) so it never applies.
- **Risk — single-writer contention.** One global.db already serves all of Tower; WAL mode +
  `busy_timeout` are configured. No new concurrency surface beyond what global.db already has.
- **Risk — test fallout** from `getDb`≡`getGlobalDb`. Mitigation: update the central mock;
  run the full agent-farm suite; the change generally *simplifies* test isolation (one file).
- **Alternative — per-workspace state.db with an LRU pool** (issue alt #1): rejected upstream
  as more complex than warranted; cross-workspace queries and the terminal_sessions join stay
  cross-file.
- **Alternative — just relocate state.db to `~/.agent-farm/state.db`** (issue alt #2): fixes
  CWD-dependence but keeps the arbitrary two-DB split; "which DB?" recurs for new tables.
  Rejected as a half-measure.
- **Alternative — force-migrate with no dry-run** (issue alt #3): rejected; dry-run preview +
  preserved sources is the gentler, equivalent-net-effect upgrade.

## Open Questions (for the plan gate)

1. **`prune-state` for `utils`/`annotations`** — they have no `workspace_path`. Plan proposes
   architect (by `workspace_path`) + builders (by `worktree` prefix) + annotations (orphan
   prune), and treats `utils` as out-of-scope (runtime-ephemeral). Acceptance criteria name
   all four; confirm this per-table interpretation, or specify a different rule (e.g. prune
   `utils`/`annotations` whose `pid` is dead).
2. **Consolidation marker location** — dedicated `_consolidation` row/table (clearest) vs a
   reserved `_migrations` sentinel (the issue's literal wording). Recommend the dedicated
   marker; confirm.
3. **Consolidation trigger** — Tower-boot step (recommended, matches "during the Tower
   restart that follows the upgrade") vs folding it into global migration v14 (auto-applies on
   any `getGlobalDb()`). Recommend the boot step so a stray read command can't silently rename
   files.
4. **`lookupBuilderSpawningArchitect` `workspacePath?` param** — keep vestigial for signature
   stability or remove. Will grep callers and recommend at implement time.

## Test Plan

**Unit**
- Cross-workspace isolation: architect rows for workspace A and B in one global.db; reads
  scoped by `workspace_path` return only the requested workspace's rows (port of the existing
  #826 isolation test onto the single file).
- Consolidation row-routing: synthesize 2–3 legacy `state.db` files with overlapping PKs and
  differing `started_at`; assert latest-started_at wins, all distinct rows present, conflicts
  reported, sources renamed (not deleted).
- Idempotency: second consolidation run is a no-op (marker set; no further renames/merges).
- `prune-state`: seed architect rows for known + unknown workspaces + builders under
  unknown worktrees; dry-run lists, `--apply` removes exactly the stale set, known rows
  untouched.
- `workspace forget`: end-to-end removes the `known_workspaces` row + its architect/builder
  rows; idempotent on a second call.

**Manual (dev-approval gate, against the local fragmented machine)**
- `afx tower start --dry-run-migration` against the real machine's 8 fragmented state.db
  files: preview lists every source + per-table counts + flags conflicts; no files changed.
- Reboot scenario: `afx tower stop` (from workspace A), `afx tower start` (from workspace B),
  confirm A's architects are now readable from Tower at B (`afx status` shows them).
- Confirm source `state.db` files are renamed to `*.pre-merge-<ts>` after the real start, and
  a second start does not re-migrate.
- `afx prune-state` (dry-run then `--apply`) clears the audited 17 test-workspace + 11
  builder-worktree stale rows; `afx workspace forget <deleted-path>` retires one cleanly.
- Sanity: spawn a builder + add a sibling architect post-merge; `afx status`, dashboard, and
  VS Code sidebar all read correct state regardless of Tower's start CWD.
