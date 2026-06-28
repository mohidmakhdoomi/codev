# PIR Plan: Multi-architect conversation resume via persisted per-architect session ID

> **Approach summary:** persist a generated, agent-neutral `session_id` on each
> architect row at spawn; resume from it at every revive surface; bridge pre-#832
> running architects across the upgrade restart with a transitional
> `afx workspace stop --capture-sessions`. No jsonl discovery in the spawn/revive path.

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
  /** Capture the live session id of an already-running agent process, for the
   *  `stop --capture-sessions` backfill. `pid` is the architect's recorded process.
   *  Agent-specific (Claude reads its on-disk session store). */
  captureRunningSession?(workspacePath: string, pid: number): string | null;
}
```

- `CLAUDE_HARNESS.session = { newSessionArgs: id => ['--session-id', id], resumeArgs: id => ['--resume', id], captureRunningSession: (ws, pid) => … }` (see Backfill below).
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

### Backfill: `afx workspace stop --capture-sessions` (transitional)

> **Transition-only.** This flag exists solely to bridge architects already running
> under pre-#832 code across the *one* upgrade restart. Once an architect has been
> spawned under the new code, its id is stored at spawn and capture is redundant. The
> flag is documented as a one-off transition aid (its `--help` says so) and is a
> candidate for removal in a later release — it carries no long-term role. Capture is
> deliberately minimal: current workspace only, no `--all`, no reporting beyond a
> per-architect captured/skipped line.

The only architects without a stored id are those **already running under pre-#832
code** at the moment of upgrade (their conversations exist on disk, but Tower never
recorded the id). For those, a restart would lose context once. The backfill closes
that gap for an *expected* restart:

```
afx workspace stop --capture-sessions
```

- A `--capture-sessions` flag on the existing `workspace stop` command. `stop()` runs
  a **capture pass before** `deactivateWorkspace` (the architects must still be alive
  to read their live session id), via a new Tower-side `captureArchitectSessions(ws)`.
- `captureArchitectSessions` iterates the workspace's architects. For each one that
  has **no** stored `session_id` and whose harness exposes `session.captureRunningSession`,
  it resolves the live id and persists it via `setArchitectByName(ws, name, { …, sessionId })`.
  Architects that already have an id are skipped (nothing to do); agents without a
  `session` capability are skipped (no resumable session).
- **Disambiguation (the crux):** capture maps each architect to *its own* conversation
  by process, not by mtime. The Claude harness's `captureRunningSession(ws, pid)`:
  - **Single architect** → `findLatestSessionId(ws)` (unambiguous; no `lsof`).
  - **Multiple architects** → correlate the architect's process subtree to the
    `~/.claude/projects/<encoded-cwd>/*.jsonl` it holds **open** (`lsof`; `/proc/<pid>/fd`
    on Linux). The recorded pid is the shellper; the agent is its descendant, so capture
    walks the subtree. A running process holds exactly one such jsonl open → exact match.
  - If correlation fails / `lsof` unavailable → skip that architect with a warning
    (it spawns fresh on restart — no worse than today). Graceful, never fatal to stop.
- Spec 786's intentional-stop logic already **preserves** architect rows across
  `stop`, so the captured `session_id` survives to the next `afx workspace start`,
  where `resolveArchitectLaunch` branch 2 resumes every architect — lone or sibling —
  deterministically.

So: **new architects are auto-deterministic** (id at spawn); **existing running
architects** survive a planned restart by snapshotting first with `--capture-sessions`.
`lsof` is confined to the multi-architect backfill path (a narrow, opt-in, transitional
case) and degrades gracefully.

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
  to `HarnessProvider`; implement it on `CLAUDE_HARNESS`; others omit.
- `packages/codev/src/agent-farm/utils/claude-session-discovery.ts` — **revert** the
  derived-id additions (`architectSessionId`, `sessionFileExists`,
  `deleteArchitectSessionFile`, `ARCHITECT_SESSION_NAMESPACE`). Keep `findLatestSessionId`
  (used by builders + the Claude harness's `captureRunningSession` single-architect path).
- `packages/codev/src/agent-farm/servers/tower-utils.ts` — rewrite
  `resolveArchitectLaunch` to the stored-id + harness-capability model above (no
  agent-specific flags here); drop the `isLoneMainArchitect`/discovery wiring.
- `packages/codev/src/agent-farm/servers/tower-instances.ts` — read stored `sessionId`
  + persist the returned id at `launchInstance` and `addArchitect`; drop the jsonl
  prune from `removeArchitect`; add `captureArchitectSessions(workspacePath)`.
- `packages/codev/src/agent-farm/servers/tower-terminals.ts` — both restart-bake sites
  read stored id + resume via the helper.
- **Backfill CLI**: `cli.ts` (`workspace stop --capture-sessions` flag) → `commands/stop.ts`
  (`stop({ captureSessions })`, run capture before `deactivateWorkspace`) →
  `lib/tower-client.ts` + the Tower route (new `captureArchitectSessions` RPC).
- DB layer: `db/schema.ts`, `db/index.ts` (v12), `db/types.ts`, `types.ts`, `state.ts`.
- Tests — `__tests__/state.test.ts` (round-trip + removal-clears), a migration test,
  `__tests__/tower-utils.test.ts` (harness-routed decision), the harness unit test, and
  a capture test (single-architect `findLatestSessionId` path; multi-architect skip /
  graceful-degrade behavior — the `lsof` subtree-correlation is integration-tested
  manually at the `dev-approval` gate).

**Not touched**: `codev-skeleton/`; builders / `spawn.ts`; `global.db`; Tower routing /
messaging / SSE; porch / gates.

## Blast Radius & Rollout Control

- **Migration v12** — every Tower DB open. One idempotent additive `ALTER ADD COLUMN`
  (same idiom as v2/v9). Old binaries ignore the column; nullable and additive →
  forward/backward compatible.
- **state.ts setters** — every architect spawn (4 sites) now writes `session_id`. No
  partial-update path exists, so no COALESCE needed; deletes are unaffected.
- **harness.ts** — additive optional capability; non-Claude providers unchanged.
- **resolveArchitectLaunch** — agent-neutral; the only behavior change is that
  architects now resume from their stored id.
- **`workspace stop --capture-sessions`** — opt-in flag; the default `stop` path is
  unchanged (no capture, no `lsof`). Capture runs only when the flag is passed.
- **Soft-fail** — no stored id (legacy row, first spawn, or no-session agent) → fresh
  spawn. Worst case "loses context once," never "fails to start." Capture failures are
  non-fatal to `stop`.
- **Size** — ~200–280 LOC incl. the capture command + tests, all within
  `packages/codev`, no new deps (`lsof` is invoked, not bundled).

## Risks & Alternatives Considered

- **One-time `main`/sibling context loss on the upgrade restart** — bridged by
  `afx workspace stop --capture-sessions`. Architects already running under pre-#832
  code have no stored id; capturing before a planned restart records their live ids so
  `start` resumes them. If a developer doesn't capture (or hits an *unplanned* reboot),
  those pre-#832 architects lose context once, then are deterministic forever after
  (the next spawn stores an id). New architects are never affected.
- **`lsof` dependency / portability.** Confined to the multi-architect `--capture-sessions`
  path. Single-architect capture uses `findLatestSessionId` (no `lsof`). If `lsof`
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
- **Capture** (`tower-instances.test.ts` or a capture-specific test): single-architect
  workspace captures via `findLatestSessionId` and persists `session_id`; an architect
  that already has an id is skipped; a no-`session` harness is skipped; correlation
  failure degrades gracefully (no throw, no row mutation).

Manual (reviewer at `dev-approval`):
- **Backfill end-to-end**: in a multi-architect workspace, `afx workspace stop
  --capture-sessions` then `afx workspace start`; confirm main + a named sibling each
  resume their own conversation and the sibling keeps its brief. (Exercises the `lsof`
  subtree correlation that unit tests can't.)
- Normal multi-architect `stop` + `start` for a workspace whose architects were spawned
  under the new code (ids stored at spawn) — confirm resume with no capture step.
- `afx workspace remove-architect reviewer` then re-add; confirm it starts fresh.
