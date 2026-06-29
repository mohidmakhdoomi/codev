# PIR Plan: Multi-architect conversation resume via persisted per-architect session ID

> **Approach summary:** persist a generated, agent-neutral `session_id` on each
> architect row at spawn; resume from it at every revive surface; bridge pre-#832
> running architects across the upgrade restart with a transitional **standalone
> script** (`scripts/backfill-architect-sessions.ts`) kept out of the CLI/API. No
> jsonl discovery in the spawn/revive path.

> **Revision note (post-plan-approval, per dev-gate feedback).** An earlier revision
> derived the session ID statelessly by hashing `(workspacePath, name)`. That proved
> fragile: Claude *requires* a valid UUID (verified — a plain string is rejected with
> `Invalid session ID. Must be a valid UUID.`), so the scheme had to hand-fabricate a
> valid UUID, was sensitive to the workspace path string, and had to prune jsonl files
> to honour architect removal. This revision returns to **persisting the actual
> session ID** in the architect DB row — robust, genuinely deterministic, no guessing.
> The persisted column is **agent-neutral** (`session_id`, not `claude_session_id`)
> because architects can run other agents (Codex, Gemini); the agent-specific resume
> mechanics route through the existing harness abstraction.

## Understanding

Issue #832 asks us to make Tower revive **every** architect into its own prior
conversation after a restart/reboot/crash — not just `main`.

Background: #830 shipped main-architect conversation resume by discovering the
newest `*.jsonl` (by mtime) under `~/.claude/projects/<encoded-cwd>/`. That works
for `main` and builders (#831) because each has a unique cwd. It **cannot**
disambiguate named sibling architects (Spec 755): they share `cwd = workspacePath`,
so every sibling's jsonl lands in the same directory and "newest by mtime" can
attach an architect to the wrong conversation. #830's conservative guard
(`getArchitects(ws).length <= 1`) therefore *disables* main's resume whenever any
sibling exists, and siblings never resume at all. Multi-architect workspaces lose
all architect conversation on reboot — and for specialised siblings that erases the
first-message brief that defines their lane.

## Proposed Change

Persist the architect's real session ID in its existing `architect` state.db row.
We **generate** the ID at spawn (`crypto.randomUUID()`), hand it to the agent so the
agent uses exactly that ID, and store it. At every revive surface we read the stored
ID back and resume. No derivation, no on-disk guessing.

### Agent-neutral by construction

- **Column** is `session_id` (not `claude_session_id`) — it holds whatever opaque
  session identifier the architect's agent uses.
- **Mechanics** (how to start a session pinned to an ID, and how to resume one)
  route through the existing `HarnessProvider`. Claude knows `--session-id` /
  `--resume`; agents without resumable-session support simply don't participate and
  fall back to a normal fresh spawn. No agent-specific flags leak into Tower code.

### Harness capability (the agent-specific knowledge lives here)

Add an **optional** `session` capability to `HarnessProvider`
(`utils/harness.ts`), mirroring how `buildRoleInjection` already abstracts role args:

```ts
session?: {
  /** Args to START a new agent session pinned to `sessionId` (merged with role injection by the caller). */
  newSessionArgs(sessionId: string): string[];
  /** Args to RESUME an existing session by id (caller skips role injection). */
  resumeArgs(sessionId: string): string[];
}
```

The interface carries only the **steady-state** pin/resume contract. Capturing a
*live* process's id is transitional and Claude-specific (it reads Claude's on-disk
store), so it lives in `claude-session-discovery.ts` + the backfill script, **not** in
this permanent interface.

- `CLAUDE_HARNESS.session = { newSessionArgs: id => ['--session-id', id], resumeArgs: id => ['--resume', id] }`.
- `CODEX_HARNESS`, `GEMINI_HARNESS`, `OPENCODE_HARNESS`: **omit** `session` →
  treated as "no resumable sessions" → always fresh, nothing persisted, skipped by the
  backfill. (When/if a future agent gains resume support, it implements this capability
  and gets recovery for free.)
- Custom harnesses (`.codev/config.json`): out of scope — they omit `session` and
  behave like Codex/Gemini (fresh spawn).

### One decision helper (agent-neutral)

`resolveArchitectLaunch(...)` in `tower-utils.ts` owns the resume-vs-fresh decision
for all three sites. It asks the resolved harness for the mechanics — it contains **no
agent-specific flags**:

```ts
resolveArchitectLaunch(opts: {
  workspacePath: string;
  name: string;
  baseArgs: string[];
  storedSessionId?: string | null;   // architect row's session_id
  discoveryBootstrap?: boolean;      // lone main only (see below)
}): { args: string[]; env: Record<string, string>; sessionId: string | null }
//   ^ sessionId = the id to write back onto the architect row (null if the agent
//     has no session support — nothing to resume next time)
```

Decision (single source of truth):

1. **No `harness.session`** (Codex/Gemini today) → plain fresh:
   `buildArchitectArgs(baseArgs)`, `sessionId: null`.
2. **`storedSessionId` present** → resume:
   `[...baseArgs, ...session.resumeArgs(storedSessionId)]`, no role injection,
   `sessionId: storedSessionId` (re-written unchanged).
3. **Else fresh**: `id = crypto.randomUUID()`,
   `buildArchitectArgs([...baseArgs, ...session.newSessionArgs(id)])`,
   `sessionId: id`.

The caller always writes the returned `sessionId` onto the row via its existing
`setArchitect(...)` / `setArchitectByName(...)` call, so the column is populated on
every spawn (fresh → new id; resume → same id; no-session → null). No partial updates
exist (the only other writes are full-row deletes on exit/remove), so `INSERT OR
REPLACE` can't wipe it — no COALESCE needed.

**No jsonl discovery in the spawn/revive path.** Every *new* architect (main or
sibling, post-#832) gets a generated id stored at spawn, so it is restart-safe from
birth, deterministically, with zero on-disk guessing.

### Backfill: `scripts/backfill-architect-sessions.ts` — a thin Tower client (transitional)

> **Transition-only, no day-to-day CLI surface.** This bridge carries architects
> already running under pre-#832 code across the upgrade. It is **not** an `afx`
> subcommand. It IS a thin client over the running Tower: it reads via `TowerClient`
> and writes through ONE narrow, transitional Tower endpoint (a pure `session_id`
> setter — not capture/orchestration). Both the script and that endpoint are deleted
> once the upgrade is done. Architects spawned under #832 store their id at spawn, so
> this only does real work during the upgrade window (it re-writes the same id
> idempotently for already-#832 architects).

**Why a Tower endpoint and not a direct `state.db` write (Option B over A).** The
authoritative `state.db` is owned by the single running Tower; its file location is
cwd-derived (`getConfig()` → `findWorkspaceRoot(cwd)`). A script writing it directly
both (a) reaches around the owning process's open SQLite and (b) opens the *wrong*
DB unless run from exactly the right directory. Routing through Tower makes the
**owner** do the write, eliminates the cwd footgun, and lets the script run from
anywhere (it talks to Tower's port, never the filesystem).

The only architects without a stored id are those **already running under pre-#832
code** (their conversations exist on disk, but Tower never recorded the id). Run the
script by hand, while they are still alive, before a planned restart/reboot:

```
# preview every workspace (read-only — shows the id each architect WOULD get):
pnpm --filter @cluesmith/codev exec tsx scripts/backfill-architect-sessions.ts --all --dry-run
# apply (all workspaces, or a single workspace path):
pnpm --filter @cluesmith/codev exec tsx scripts/backfill-architect-sessions.ts --all
pnpm --filter @cluesmith/codev exec tsx scripts/backfill-architect-sessions.ts [workspacePath]
```

- **Tower-client only** — no `state.db`/`global.db`/`config` access, so no cwd
  coupling; runs from anywhere. Enumerate via `TowerClient.listWorkspaces()` (`--all`);
  per workspace, `TowerClient.getWorkspaceStatus(ws)` gives the live architect
  terminals (`architectName` + `pid`). It captures each one's live id with
  `captureRunningClaudeSession(ws, pid, { soleArchitect })` (`lsof`/`ps` — local OS
  introspection, the one non-HTTP bit), then writes via
  `TowerClient.setArchitectSessionId(ws, name, id)`.
- **The new endpoint:** `PUT /api/workspaces/:ws/architects/:name/session-id` →
  `setArchitectSessionId(ws, name, id)` server-side (targeted `session_id`-only
  UPDATE). Narrow setter, no capture/orchestration in Tower. Marked transitional.
- It does **not** need the stored `session_id`: it captures every live architect and
  writes the result. A non-Claude architect has no `~/.claude` jsonl → capture returns
  null → skipped. An already-#832 architect resolves to its existing id → idempotent
  re-write. (This avoids putting `session_id` on the wire `ArchitectState` in
  `@cluesmith/codev-types`.)
- **Disambiguation (the crux):** maps each architect to *its own* conversation by
  process, not by mtime, via `captureRunningClaudeSession(ws, pid, { soleArchitect })`:
  - **Single architect** → `findLatestSessionId(ws)` (unambiguous; no `lsof`).
  - **Multiple architects** → correlate the architect's process subtree to the
    `~/.claude/projects/<encoded-cwd>/*.jsonl` it holds **open** (`lsof`; `/proc/<pid>/fd`
    on Linux). The recorded pid is the shellper; the agent is its descendant, so it
    walks the subtree. A running process holds exactly one such jsonl open → exact match.
  - If correlation fails / `lsof` unavailable → that architect is skipped with a note
    (it spawns fresh on restart — no worse than today). Never fatal.
- Spec 786's intentional-stop logic already **preserves** architect rows across
  `afx workspace stop`, so a written `session_id` survives to the next
  `afx workspace start`, where `resolveArchitectLaunch` branch 2 resumes every
  architect — lone or sibling — deterministically.

So: **new architects are auto-deterministic** (id at spawn); **existing running
architects** survive a planned restart by running the backfill script first. `lsof`
is confined to the multi-architect script path (a narrow, opt-in, transitional case)
and degrades gracefully.

### Spawn / revive sites

All three sites follow the same shape: read the stored id → `resolveArchitectLaunch`
→ persist the returned id. No `discoveryBootstrap` flag (discovery is gone from this
path).

- `tower-instances.ts launchInstance` (main): read
  `getArchitectByName(resolvedPath, 'main')?.sessionId`, call `resolveArchitectLaunch`,
  pass the returned `sessionId` into the two existing `setArchitect(...)` calls.
- `tower-instances.ts addArchitect` (siblings): read
  `getArchitectByName(resolvedPath, name)?.sessionId`, call `resolveArchitectLaunch`,
  pass the returned `sessionId` into the existing `setArchitectByName(...)` calls.
  Serves both `add-architect` (no row → mint) and the launchInstance reconcile loop
  (row has id → resume).
- `tower-terminals.ts reconcileTerminalSessions` — **both** restart-bake sites
  (startup reconcile + on-the-fly reconnect): read
  `getArchitectByName(workspace, role_id||'main')?.sessionId`, call
  `resolveArchitectLaunch`, use the returned `args`/`env` for `restartOptions`. Keep
  the existing `CODEV_ARCHITECT_NAME` injection. The stored id is what makes an
  in-process crash resume the *same* conversation (the silent-context-loss path).

### `removeArchitect` — simplified

No jsonl pruning. The exit/remove path already deletes the architect row
(`setArchitectByName(..., null)`), which clears `session_id` with it — so a
removed-then-re-added sibling naturally starts fresh (branch 3). This is the DB
approach's clean win over the derived scheme, which needed an explicit file prune.

### Data layer

- `db/schema.ts` — add `session_id TEXT` to the `architect` `CREATE TABLE`.
- `db/index.ts` — migration **v12**: `ALTER TABLE architect ADD COLUMN session_id TEXT`
  in try/catch (idempotent; fresh installs already have it via LOCAL_SCHEMA, same idiom
  as v2). Runs after v11's rebuild, lands on the final shape.
- `db/types.ts` — `session_id: string | null` on `DbArchitect`; map to `sessionId` in
  `dbArchitectToArchitectState`.
- `types.ts` — `sessionId?: string` on `ArchitectState`.
- `state.ts` — `setArchitect` / `setArchitectByName` add `session_id` to the column
  list and params. Getters already `SELECT *` — no query change.

## Files to Change

- `packages/codev/src/agent-farm/utils/harness.ts` — add optional `session` capability
  (`newSessionArgs`/`resumeArgs` only) to `HarnessProvider`; implement on `CLAUDE_HARNESS`;
  others omit. (No capture method on the interface — that's transitional, see the script.)
- `packages/codev/src/agent-farm/utils/claude-session-discovery.ts` — **revert** the
  derived-id additions (`architectSessionId`, `sessionFileExists`,
  `deleteArchitectSessionFile`, `ARCHITECT_SESSION_NAMESPACE`). Keep `findLatestSessionId`
  (builders + the script's single-architect fallback); add `captureRunningClaudeSession`
  (the script's process-correlation capture — Claude-specific, called directly).
- `packages/codev/src/agent-farm/servers/tower-utils.ts` — rewrite
  `resolveArchitectLaunch` to the stored-id + harness-capability model above (no
  agent-specific flags here); drop the `isLoneMainArchitect`/discovery wiring.
- `packages/codev/src/agent-farm/servers/tower-instances.ts` — read stored `sessionId`
  + persist the returned id at `launchInstance` and `addArchitect`; drop the jsonl
  prune from `removeArchitect`.
- `packages/codev/src/agent-farm/servers/tower-terminals.ts` — both restart-bake sites
  read stored id + resume via the helper.
- **Backfill (transitional, no `afx` CLI surface)**:
  - `packages/codev/scripts/backfill-architect-sessions.ts` — thin `tsx` client over the
    running Tower (`TowerClient` reads + the new setter), capturing live ids with
    `captureRunningClaudeSession`. No DB/config imports → no cwd coupling.
  - `packages/codev/src/agent-farm/servers/tower-routes.ts` — `PUT
    /api/workspaces/:ws/architects/:name/session-id` → `setArchitectSessionId` (narrow
    transitional setter; `handleSetArchitectSessionId`).
  - `packages/core/src/tower-client.ts` — `setArchitectSessionId(ws, name, id)` client method.
- DB layer: `db/schema.ts`, `db/index.ts` (v12), `db/types.ts`, `types.ts`, `state.ts`
  (setters write `session_id`; new targeted `setArchitectSessionId`, called by the route).
- Tests — `__tests__/state.test.ts` (round-trip + removal-clears), a migration test,
  `__tests__/tower-utils.test.ts` (harness-routed decision), the harness unit test, and
  a capture test (single-architect `findLatestSessionId` path; multi-architect skip /
  graceful-degrade behavior — the `lsof` subtree-correlation is integration-tested
  manually at the `dev-approval` gate).

**Not touched**: `codev-skeleton/`; builders / `spawn.ts`; `global.db`; Tower
messaging / SSE; porch / gates; the wire `ArchitectState` in `@cluesmith/codev-types`
(the script avoids needing `session_id` over the wire). One narrow transitional Tower
route IS added (the backfill setter, above).

## Blast Radius & Rollout Control

- **Migration v12** — every Tower DB open. One idempotent additive `ALTER ADD COLUMN`
  (same idiom as v2/v9). Old binaries ignore the column; nullable and additive →
  forward/backward compatible.
- **state.ts setters** — every architect spawn (4 sites) now writes `session_id`. No
  partial-update path exists, so no COALESCE needed; deletes are unaffected.
- **harness.ts** — additive optional capability; non-Claude providers unchanged.
- **resolveArchitectLaunch** — agent-neutral; the only behavior change is that
  architects now resume from their stored id.
- **Backfill script** — zero day-to-day surface: not in `afx`, not a REST route, not a
  client method. Manually run, transitional. Writes only `session_id` (targeted UPDATE),
  safe alongside a live Tower.
- **Soft-fail** — no stored id (legacy row, first spawn, or no-session agent) → fresh
  spawn. Worst case "loses context once," never "fails to start." Script failures are
  per-architect skips, never fatal.
- **Size** — ~200–280 LOC incl. the script + tests, all within `packages/codev`, no new
  deps (`lsof`/`ps` are invoked, not bundled; `tsx` is already a devDependency).

## Risks & Alternatives Considered

- **One-time `main`/sibling context loss on the upgrade restart** — bridged by the
  `scripts/backfill-architect-sessions.ts` script. Architects already running under
  pre-#832 code have no stored id; running the script before a planned restart records
  their live ids so `start` resumes them. If a developer doesn't run it (or hits an
  *unplanned* reboot), those pre-#832 architects lose context once, then are
  deterministic forever after (the next spawn stores an id). New architects are never
  affected.
- **`lsof` dependency / portability.** Confined to the multi-architect script path.
  Single-architect capture uses `findLatestSessionId` (no `lsof`). If `lsof`
  (or `/proc`) is unavailable or correlation is ambiguous, capture skips that architect
  with a warning — it spawns fresh on restart (no worse than today). Never fatal.
- **`INSERT OR REPLACE` wiping the id.** Ruled out by the caller graph: every non-null
  write is a spawn site that passes the resolved `sessionId`; all other writes delete
  the row. No partial update exists.
- **Non-Claude architects.** They omit the harness `session` capability → fresh spawn,
  `session_id` stays null. No claude flags ever reach them. Graceful, and the column is
  ready when another agent gains resume support.
- **Claude accepts a chosen UUID for `--session-id` and resumes by it.** Verified
  empirically during planning (create at our id → jsonl written at that id; `--resume`
  → same session appended, no fork). A non-UUID is rejected, which is why we generate a
  real `crypto.randomUUID()` rather than a readable string.
- *Rejected — stateless derived id* (prior revision): fragile (must hand-fabricate a
  valid UUID, path-string-sensitive, needs jsonl pruning on removal). The DB row is the
  single source of truth instead.
- *Rejected — per-architect cwd so discovery disambiguates*: changes Spec 755 semantics
  and is far more invasive.

## Test Plan

Unit tests (run from the worktree: `pnpm --filter @cluesmith/codev test`):

- **Harness** (`harness.test.ts` or inline): `CLAUDE_HARNESS.session.newSessionArgs` /
  `resumeArgs` produce `--session-id` / `--resume`; Codex/Gemini have no `session`.
- **Data layer** (`state.test.ts`): set an architect with `sessionId`, read it back via
  `getArchitectByName` / `getArchitects`; `setArchitectByName(..., null)` clears the row
  (removal-clears-id); a spawn write updates the id.
- **Migration**: a pre-v12 architect table gains `session_id`; existing rows read back
  `null` (legacy fallback).
- **resolveArchitectLaunch** (`tower-utils.test.ts`): stored id → `--resume`, no role
  injection, returns the same id; no stored id → fresh `--session-id <newUuid>`,
  returns the new id; no-session harness → plain fresh, returns null; two siblings with
  distinct stored ids resume independently (no cross-attachment).
- **Shellper auto-restart** (`tower-terminals.test.ts`, alongside the Spec 786 Phase 2
  tests): a sibling row with a stored id bakes `restartOptions.args` with `--resume
  <id>` and skips role injection; no stored id → `buildArchitectArgs`;
  `CODEV_ARCHITECT_NAME` still resolved.
- **Capture helper** (`claude-session-discovery.test.ts`): the sole-architect fallback
  returns the newest jsonl when process correlation finds nothing; the multi-architect
  path returns null (no mtime guess); no session on disk → null. (The `lsof` success
  path is integration-tested manually below.)
- **Backfill state helper** (`state.test.ts`): `setArchitectSessionId` updates only the
  `session_id` column and is a no-op for a missing row.

Manual (reviewer at `dev-approval`, **post-deploy** — Tower must be on the #832 code
for the new write endpoint to exist):
- **Backfill end-to-end**: with a multi-architect workspace's architects alive, run
  `... backfill-architect-sessions.ts --all --dry-run` and confirm it lists each
  architect → a resolved id; then run without `--dry-run`, `afx workspace stop` +
  `afx workspace start`; confirm main + a named sibling each resume their own
  conversation and the sibling keeps its brief. (Exercises the `lsof` subtree
  correlation + the Tower setter route that unit tests can't.)
- Normal multi-architect `stop` + `start` for a workspace whose architects were spawned
  under the new code (ids stored at spawn) — confirm resume with no backfill step.
- `afx workspace remove-architect reviewer` then re-add; confirm it starts fresh.
