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

### Consistency model: mint once at cold-spawn, read everywhere else

The recovery approach is uniform across all three architect surfaces, governed by
one rule:

> **The Claude session UUID is minted exactly once — at the architect's first
> cold-spawn — and persisted on its `architect` row. Every other surface only
> *reads* that UUID to resume; none mints.**

This works because by the time an architect is *reviving* (reboot cold-spawn with a
persisted row, or an in-process shellper restart), its UUID was already minted at
the original cold-spawn and survives in state.db. The only site that ever generates
a UUID is a cold-spawn that finds no usable one on the row.

There is exactly **one decision helper**, called by all three sites, so the
resume-vs-fresh logic lives in one place and cannot drift (lessons-critical:
*consolidate duplicates rather than syncing them*):

```ts
// utils/claude-session-discovery.ts (architect resume lives next to builder discovery)
resolveArchitectLaunch(opts: {
  workspacePath: string;
  name: string;           // 'main' or sibling name (the architect-row id)
  baseArgs: string[];     // cmdParts.slice(1)
  mintIfAbsent: boolean;  // cold-spawn sites: true; shellper-restart bake: false
}): { args: string[]; env: Record<string, string>; sessionIdToStore: string | null }
```

Decision (single source of truth):

1. **Stored UUID present AND its jsonl exists on disk** → resume:
   `{ args: [...baseArgs, '--resume', uuid], env: {}, sessionIdToStore: null }`.
   Role injection skipped — the saved conversation already holds the role/system
   prompt. UUID is never regenerated.
2. **Else if `mintIfAbsent`** (cold-spawn, no usable UUID — first-ever spawn,
   legacy pre-v12 row, or a stored UUID whose jsonl was pruned) → fresh:
   `uuid = crypto.randomUUID()`, `{ args: [...buildArchitectArgs(...).args, '--session-id', uuid], env, sessionIdToStore: uuid }`.
   The caller persists `sessionIdToStore` on the row after PTY creation (overwriting
   any stale UUID).
3. **Else** (shellper-restart bake, no usable UUID) → role-injection fallback:
   `{ args, env } = buildArchitectArgs(...)`, `sessionIdToStore: null`. Nothing to
   store — the restart bake doesn't create the session. The next cold respawn mints.

**jsonl-existence guard (the safety the bare UUID lacked).** A stored UUID whose
jsonl has been pruned (e.g. user cleared `~/.claude/projects`) would make
`--resume <uuid>` fail. So resume is gated on
`sessionFileExists(workspacePath, uuid)` — a new tiny export in
`claude-session-discovery.ts` reusing its existing `getClaudeProjectDir()` path
encoding. This makes stored-UUID resume **as safe as #830's jsonl-discovery** (which
only ever picked files that exist) while keeping per-architect disambiguation.

**Architects vs builders.** Architect fallback chain: **stored-UUID (if jsonl
exists) → fresh**. Builders keep their existing **jsonl-discovery → fresh** chain
(`spawn.ts`, #831). The two coexist because the constraint differs — unique cwd for
builders, shared cwd for architects — and both now live in
`claude-session-discovery.ts`, documented side by side.

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

### The single helper

`resolveArchitectLaunch(...)` (in `utils/claude-session-discovery.ts`) encapsulates
the decision above. It reads the row via `getArchitectByName(workspacePath, name)`,
applies the jsonl-existence guard, and returns `{ args, env, sessionIdToStore }`.
All three sites call it; none re-implements the branch.

### Spawn / revive sites (all call the one helper)

- `tower-instances.ts launchInstance` (main): **delete** the `safeToResume` /
  `findLatestSessionId` / `getArchitects().length <= 1` block (and drop the
  `findLatestSessionId` import — it's now unused here). Call
  `resolveArchitectLaunch({ workspacePath, name: 'main', baseArgs: cmdParts.slice(1), mintIfAbsent: true })`.
  Use the returned `args`/`env` for the PTY; after creation, if `sessionIdToStore`
  is non-null, pass it into the existing `setArchitect(...)` calls (both shellper and
  fallback branches) as `claudeSessionId`.
- `tower-instances.ts addArchitect`: call
  `resolveArchitectLaunch({ workspacePath, name, baseArgs: cmdParts.slice(1), mintIfAbsent: true })`.
  Same store-after-PTY pattern via the existing `setArchitectByName(...)` calls.
  This one call covers **both** the user-driven `add-architect` (no row → mint) and
  the `launchInstance` reconcile loop (persisted row with UUID → resume) — the row's
  presence/absence drives the branch inside the helper, no extra signalling.
- `tower-terminals.ts reconcileTerminalSessions` (~L636-679): call
  `resolveArchitectLaunch({ workspacePath: dbSession.workspace_path, name: dbSession.role_id || 'main', baseArgs: cmdParts.slice(1), mintIfAbsent: false })`
  and use its `args`/`env` for `restartOptions`. Keep the existing
  `CODEV_ARCHITECT_NAME` env injection merged on top (identity must survive
  regardless of resume-vs-fresh). `mintIfAbsent: false` because this site only
  pre-bakes restart options; a missing UUID here means a legacy row → role-injection
  fallback (the next cold respawn mints).

### Why `addArchitect`'s branch is keyed on row-existence

When a user runs `afx workspace add-architect --name foo`, no architect row exists
yet → no stored UUID → fresh spawn (generates + stores). When `launchInstance`'s
reconcile loop calls `addArchitect` for a persisted sibling, the row already exists
with its UUID → revive. The same `getArchitectByName(...)` check (inside the helper)
distinguishes the two with no extra signalling.

## Files to Change

- `packages/codev/src/agent-farm/db/schema.ts` — add `claude_session_id TEXT` to architect table.
- `packages/codev/src/agent-farm/db/index.ts` — migration v12 (ALTER ADD COLUMN, try/catch).
- `packages/codev/src/agent-farm/db/types.ts` — `DbArchitect.claude_session_id`; map in converter.
- `packages/codev/src/agent-farm/types.ts` — `ArchitectState.claudeSessionId?`.
- `packages/codev/src/agent-farm/state.ts` — write + COALESCE-preserve `claude_session_id` in both setters.
- `packages/codev/src/agent-farm/utils/claude-session-discovery.ts` — add `sessionFileExists(workspacePath, sessionId)` and the `resolveArchitectLaunch(...)` helper (the single resume-vs-fresh decision, reusing `getClaudeProjectDir`).
- `packages/codev/src/agent-farm/servers/tower-instances.ts` — main + sibling sites call `resolveArchitectLaunch`; remove `safeToResume`/`findLatestSessionId` block + import.
- `packages/codev/src/agent-farm/servers/tower-terminals.ts` — shellper-restart bake calls `resolveArchitectLaunch({ mintIfAbsent: false })`.
- Tests (see Test Plan) — `__tests__/claude-session-discovery.test.ts` (helper unit tests), `__tests__/state.test.ts`, `__tests__/tower-instances.test.ts`, `__tests__/tower-terminals.test.ts`, and a migration test (extend `bugfix-826-migration.test.ts` or a new `pir-832-session-id.test.ts`).

**Not touched**: `codev-skeleton/` (this is Tower implementation code, not a
framework doc/template — no skeleton mirror needed). `findLatestSessionId` itself
(still used by builders via `spawn.ts`). `global.db` schema (the UUID lives in local
state.db).

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
- **Stored UUID whose jsonl was pruned.** Resolved by the `sessionFileExists` guard
  in `resolveArchitectLaunch` — a UUID with no on-disk jsonl is treated as absent, so
  cold-spawn re-mints and the restart-bake falls back to role injection. No
  `--resume` is ever issued against a missing session.

## Test Plan

Unit tests (run from the worktree: `pnpm --filter @cluesmith/codev test`):

- **Helper** (`claude-session-discovery.test.ts`): `resolveArchitectLaunch` returns
  resume args (`--resume <uuid>`, empty env, `sessionIdToStore: null`) when the row
  has a UUID **and** its jsonl exists; mints (`--session-id`, `sessionIdToStore` set,
  role injection present) when absent and `mintIfAbsent: true`; falls back to plain
  role injection when absent and `mintIfAbsent: false`; treats a stored UUID with a
  **missing** jsonl as absent (existence-guard). `sessionFileExists` true/false cases.
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
