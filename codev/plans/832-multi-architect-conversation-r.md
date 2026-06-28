# PIR Plan: Multi-architect conversation resume via per-architect session UUID

## Understanding

Issue #832 asks us to make Tower revive **every** architect into its own prior
Claude conversation after a restart/reboot/crash — not just `main`.

Background: #830 shipped main-architect conversation resume by discovering the
newest `*.jsonl` (by mtime) under `~/.claude/projects/<encoded-cwd>/` and passing
`claude --resume <uuid>`. That heuristic works for `main` and for builders
(#831) because each has a unique cwd. It **cannot** disambiguate named sibling
architects added via `afx workspace add-architect` (Spec 755): they all share
`cwd = workspacePath`, so every sibling's jsonl lands in the same encoded-cwd
directory and "newest by mtime" can attach an architect to the wrong conversation.

Because of that ambiguity, #830 added a conservative guard in `launchInstance`
(`tower-instances.ts:495-511`): main only resumes when
`getArchitects(resolvedPath).length <= 1`; with siblings present it skips resume
entirely and spawns fresh. Siblings themselves never resume. So any
multi-architect workspace loses **all** architect conversation on reboot — and
for specialised siblings (`reviewer`, `casa`, …) that means losing the
first-message brief that defines their lane, since there is no per-architect
role-doc loading (see memory: specialised architects get their role from the
first user message, not from disk).

The robust fix (per the issue) is to stop inferring identity from on-disk jsonl
filenames and instead **persist a per-architect Claude session UUID** in a place
Tower controls: the existing `architect` SQLite table (Spec 755 / Bugfix #826).
This reuses the exact pattern Spec 786 Phase 2 already established with
`architect.role_id` ("store a per-architect anchor in state.db, read it on every
spawn/restart path").

### Revive surfaces that must read the stored UUID (verified)

1. `launchInstance` main cold-spawn — `tower-instances.ts:464-522` (the
   `safeToResume` / `findLatestSessionId` block this plan replaces).
2. `addArchitect` — `tower-instances.ts:876-1089`. Serves **both** a fresh
   `add-architect` and the sibling-reconcile loop in `launchInstance`
   (`tower-instances.ts:699-711`). It currently never resumes.
3. `reconcileTerminalSessions` shellper-restart options bake —
   `tower-terminals.ts:636-679`. Builds `restartOptions` the shellper uses to
   auto-relaunch claude after an in-process crash. Currently `buildArchitectArgs`
   only (role injection, no resume) — the silent-context-loss path.

### Key facts established during investigation

- `claude` CLI supports **both** `--session-id <uuid>` (set a specific session id
  at creation) and `-r, --resume [value]` (resume by session id) — verified via
  `claude --help`. Resuming **without** `--fork-session` keeps the same session
  id, so one stored UUID stays valid across unlimited revivals.
- `removeArchitect` (`tower-instances.ts:1108`) deletes the whole row via
  `setArchitectByName(..., null)`, so the UUID is cleared with the row for free.
- `findLatestSessionId` (`utils/claude-session-discovery.ts`) is still used by
  builders via `spawn.ts` (#831) — it stays; only `main` stops using it.
- Local DB migrations are at **v11**; this adds **v12**.

## Proposed Change

Add a nullable `claude_session_id TEXT` column to the `architect` table and thread
it through the data layer, then add a uniform UUID branch to all three spawn/revive
sites.

### Lookup contract (applied identically at all three sites)

- **Revive** (architect row already has a stored `claudeSessionId`): pass
  `--resume <uuid>`, **skip role injection** (the saved conversation already
  contains the role/system prompt). Do not regenerate or rewrite the UUID.
- **Fresh** (no stored UUID — first-ever spawn, or a legacy pre-v12 row): generate
  `crypto.randomUUID()`, build args with `buildArchitectArgs(...)` **plus**
  `--session-id <uuid>`, and persist the UUID on the row after the PTY is created.

For architects the fallback chain is **stored UUID → fresh spawn** (jsonl-discovery
is intentionally bypassed — ambiguous for shared cwd). Builders keep their existing
**jsonl-discovery → fresh** chain. The two coexist because the constraint differs
(unique cwd vs shared cwd); this is documented in code at the architect sites.

### Data layer

- `db/schema.ts` — add `claude_session_id TEXT` to the `architect` `CREATE TABLE`.
- `db/index.ts` — migration **v12**: `ALTER TABLE architect ADD COLUMN
  claude_session_id TEXT` wrapped in try/catch (fresh installs already have it from
  LOCAL_SCHEMA; the ALTER throws "duplicate column" and is swallowed — same idiom
  as v2). Runs after v11's table rebuild, so it lands on the rebuilt shape.
- `db/types.ts` — add `claude_session_id: string | null` to `DbArchitect`; map it to
  `claudeSessionId` in `dbArchitectToArchitectState`.
- `types.ts` — add optional `claudeSessionId?: string` to `ArchitectState`.
- `state.ts` — `setArchitect` / `setArchitectByName` write `claude_session_id`.
  Switch both upserts from `INSERT OR REPLACE` to `INSERT … ON CONFLICT(...) DO
  UPDATE` so an update that omits the UUID **preserves** the existing value via
  `claude_session_id = COALESCE(excluded.claude_session_id, architect.claude_session_id)`
  (mirrors the `spawned_by_architect` COALESCE in `upsertBuilder`). The getters
  (`getArchitects`, `getArchitectByName`) already `SELECT *`, so they surface the
  new field through the converter with no query change.

### Spawn / revive sites

- `tower-instances.ts launchInstance` (main): delete the `safeToResume` /
  `findLatestSessionId` / `getArchitects().length <= 1` block (and drop the now-unused
  `findLatestSessionId` import). Replace with the lookup contract above against the
  `'main'` row (`getArchitectByName(resolvedPath, 'main')?.claudeSessionId`). On the
  fresh path, generate the UUID, append `--session-id <uuid>`, and pass it into the
  existing `setArchitect(...)` calls (both shellper and fallback branches).
- `tower-instances.ts addArchitect`: look up
  `getArchitectByName(resolvedPath, name)?.claudeSessionId`. Present → revive branch;
  absent → fresh branch (generate + `--session-id` + store via the existing
  `setArchitectByName(...)` calls). This single branch covers both the user-driven
  `add-architect` (no row yet → fresh) and the launchInstance reconcile loop
  (row persisted with UUID → revive).
- `tower-terminals.ts reconcileTerminalSessions` (~L636-679): before calling
  `buildArchitectArgs`, look up
  `getArchitectByName(dbSession.workspace_path, dbSession.role_id || 'main')?.claudeSessionId`.
  Present → `restartOptions.args = [...cmdParts.slice(1), '--resume', uuid]`, skip
  `buildArchitectArgs`; keep the existing `CODEV_ARCHITECT_NAME` env injection
  (identity must survive regardless). Absent → current behavior. Add the
  `getArchitectByName` import.

### Why `addArchitect`'s branch is keyed on row-existence

When a user runs `afx workspace add-architect --name foo`, no architect row exists
yet → no stored UUID → fresh spawn (generates + stores). When `launchInstance`'s
reconcile loop calls `addArchitect` for a persisted sibling, the row already exists
with its UUID → revive. The same `getArchitectByName(...)` check distinguishes the
two with no extra signalling.

## Files to Change

- `packages/codev/src/agent-farm/db/schema.ts` — add `claude_session_id TEXT` to architect table.
- `packages/codev/src/agent-farm/db/index.ts` — migration v12 (ALTER ADD COLUMN, try/catch).
- `packages/codev/src/agent-farm/db/types.ts` — `DbArchitect.claude_session_id`; map in converter.
- `packages/codev/src/agent-farm/types.ts` — `ArchitectState.claudeSessionId?`.
- `packages/codev/src/agent-farm/state.ts` — write + COALESCE-preserve `claude_session_id` in both setters.
- `packages/codev/src/agent-farm/servers/tower-instances.ts` — main + sibling UUID branches; remove `safeToResume`/`findLatestSessionId`.
- `packages/codev/src/agent-farm/servers/tower-terminals.ts` — shellper-restart UUID branch; import `getArchitectByName`.
- Tests (see Test Plan) — `__tests__/state.test.ts`, `__tests__/tower-instances.test.ts`, `__tests__/tower-terminals.test.ts`, and a migration test (extend `bugfix-826-migration.test.ts` or a new `pir-832-session-id.test.ts`).

**Not touched**: `codev-skeleton/` (this is Tower implementation code, not a
framework doc/template — no skeleton mirror needed). `utils/claude-session-discovery.ts`
(still used by builders). `global.db` schema (the UUID lives in local state.db).

## Risks & Alternatives Considered

- **One-time context loss for `main` on the first reboot after this lands.** A
  legacy `main` row has no stored UUID, so the first revival falls back to fresh
  (and stores a UUID for next time). This is a mild regression vs #830's
  jsonl-discovery for the single-architect case, but it self-heals after one
  reboot and matches the issue's Backwards-compatibility section. Flagging it for
  the plan-gate reviewer.
  - *Alternative considered*: keep jsonl-discovery as a fallback for `main` only
    when `getArchitects().length <= 1`. **Rejected** — reintroduces the very guard
    the issue asks to remove and forks the architect path into two heuristics;
    the issue explicitly wants the uniform stored-UUID path.
- **`INSERT OR REPLACE` wiping the UUID.** A full-row replace that omits the UUID
  would null it. Mitigated by switching to `ON CONFLICT DO UPDATE` with COALESCE
  so partial updates preserve the stored value.
- **Migration ordering.** v12 runs after v11's table rebuild, so the column lands
  on the final architect shape. The try/catch makes it idempotent for fresh
  installs (column already present via LOCAL_SCHEMA) and upgrade installs alike.
- **`--session-id` collision.** UUIDs come from `crypto.randomUUID()`; collision
  probability is negligible and a fresh UUID is only generated when no row UUID
  exists.

## Test Plan

Unit tests (run from the worktree: `pnpm --filter @cluesmith/codev test`):

- **Data layer** (`state.test.ts`): set an architect with `claudeSessionId`, read it
  back via `getArchitectByName` / `getArchitects`; a later setter call omitting the
  UUID preserves it (COALESCE); `setArchitectByName(..., null)` clears the whole row
  (removal-clears-UUID).
- **Migration** (`bugfix-826-migration.test.ts` extension or new
  `pir-832-session-id.test.ts`): a pre-v12 architect table gains
  `claude_session_id` after migration; existing rows read back with `null`
  (legacy fallback).
- **Cold-spawn — main** (`tower-instances.test.ts`): stored UUID → `launchInstance`
  passes `--resume <uuid>` and no role injection; no stored UUID → generates,
  passes `--session-id <uuid>`, and persists it (spawn-stores-UUID). Multi-architect
  workspace: main resumes its own UUID (no `safeToResume` skip).
- **Cold-spawn — siblings** (`tower-instances.test.ts`): two persisted siblings each
  revive with their **own** stored UUID via `--resume` (no cross-attachment);
  fresh `add-architect` generates + stores a new UUID.
- **Shellper auto-restart** (`tower-terminals.test.ts`, alongside the existing
  Spec 786 Phase 2 restart-options tests ~L768-852): a sibling row with a stored
  UUID bakes `restartOptions.args` containing `--resume <uuid>` and skips role
  injection; a row without a UUID falls back to `buildArchitectArgs`; legacy
  `role_id` null still resolves `CODEV_ARCHITECT_NAME=main`.

Manual (reviewer at `dev-approval`, optional — covered by units):
- In a multi-architect workspace, `afx workspace stop` + `start`; confirm each
  architect lands back in its own conversation (main + a named sibling), and a
  specialised sibling retains its brief.
