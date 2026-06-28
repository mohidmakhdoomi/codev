# PIR Plan: Multi-architect conversation resume via derived per-architect session IDs

## Understanding

Issue #832 asks us to make Tower revive **every** architect into its own prior
Claude conversation after a restart/reboot/crash — not just `main`.

Background: #830 shipped main-architect conversation resume by discovering the
newest `*.jsonl` (by mtime) under `~/.claude/projects/<encoded-cwd>/` and passing
`claude --resume <uuid>`. That heuristic works for `main` and builders (#831)
because each has a unique cwd. It **cannot** disambiguate named sibling architects
added via `afx workspace add-architect` (Spec 755): they all share
`cwd = workspacePath`, so every sibling's jsonl lands in the same encoded-cwd
directory and "newest by mtime" can attach an architect to the wrong conversation.

Because of that ambiguity, #830 added a conservative guard in `launchInstance`
(`tower-instances.ts:495-511`): main only resumes when
`getArchitects(resolvedPath).length <= 1`; with siblings present it skips resume
entirely. Siblings themselves never resume. So any multi-architect workspace loses
**all** architect conversation on reboot — and for specialised siblings (`reviewer`,
`casa`, …) that means losing the first-message brief that defines their lane
(there is no per-architect role-doc loading; specialisation lives in the
conversation).

The issue proposed persisting a per-architect UUID in a new DB column. **This plan
takes a lighter, stateless approach the architect chose: derive the session ID
deterministically from `(workspacePath, architectName)` so nothing has to be
stored.** Same disambiguation, no schema migration, no new state.

## Proposed Change

Make each architect's Claude session ID a **pure function of its identity**:

```
sessionId = UUIDv5(ARCHITECT_NS, canonicalWorkspacePath + ':' + architectName)
```

Because the architect **name** is in the key, two siblings sharing one cwd derive
**different** IDs — the exact collision the jsonl heuristic couldn't resolve. The ID
is recomputable at any revive surface with no bookkeeping.

### Consistency model: derive everywhere, store nothing

> **The session ID is a pure function of `(workspacePath, name)`. Every spawn/revive
> surface recomputes it; none stores or looks anything up. Resume when its jsonl
> exists on disk, otherwise create it with that same ID.**

One decision helper, `resolveArchitectLaunch(...)`, owns the logic so it can't drift
across the three sites (lessons-critical: *consolidate duplicates*):

```ts
// utils/claude-session-discovery.ts
resolveArchitectLaunch(opts: {
  workspacePath: string;     // the SAME string passed as claude's cwd at spawn
  name: string;              // 'main' or sibling name
  baseArgs: string[];        // cmdParts.slice(1)
}): { args: string[]; env: Record<string, string> }
```

Decision (single source of truth):

1. `id = architectSessionId(workspacePath, name)`.
2. `sessionFileExists(workspacePath, id)` → **resume**:
   `{ args: [...baseArgs, '--resume', id], env: {} }`. Role injection skipped — the
   saved conversation already holds the role/system prompt.
3. Else → **fresh**: `{ args: [...buildArchitectArgs(...).args, '--session-id', id], env }`.
   Role injection included; the new session is created **at the derived ID**, so the
   next revival finds it and resumes.

No `mintIfAbsent` flag, no store-after-PTY step, no per-row state — every site is
identical. The shellper-restart bake uses the same helper; if claude crashes
in-process the shellper relaunches with `--resume <id>` (the jsonl exists from the
original spawn) and the conversation survives silently.

### New helpers in `utils/claude-session-discovery.ts`

- `architectSessionId(workspacePath, name)` — deterministic UUIDv5 via
  `node:crypto` `createHash('sha1')` (already used in `tower-instances.ts`; **no new
  dependency**). A fixed `ARCHITECT_NS` UUID constant namespaces the hash; first 16
  bytes of the digest with the version nibble set to `5` and the variant bits set,
  formatted `8-4-4-4-12`. Sits beside the existing `encodeClaudeProjectDir` (the
  other deterministic identity→artifact mapping).
- `sessionFileExists(workspacePath, sessionId)` — `existsSync` of
  `getClaudeProjectDir(workspacePath)/<sessionId>.jsonl` (reuses the existing path
  encoder).
- `resolveArchitectLaunch(...)` — the decision above.
- `deleteArchitectSessionFile(workspacePath, name)` — removes the derived jsonl
  (used by `removeArchitect`; see below).

`findLatestSessionId` is **unchanged** — builders still use it via `spawn.ts`. The
two mechanisms coexist (jsonl-discovery for unique-cwd builders, derived-ID for
shared-cwd architects), documented side by side in the same file.

### Spawn / revive sites (all call the one helper)

- `tower-instances.ts launchInstance` (main): **delete** the `safeToResume` /
  `findLatestSessionId` / `getArchitects().length <= 1` block (and the
  `findLatestSessionId` import). Call
  `resolveArchitectLaunch({ workspacePath, name: 'main', baseArgs: cmdParts.slice(1) })`
  and use its `args`/`env` for the PTY. The existing `setArchitect(...)` persistence
  is **unchanged** (it records the architect row as today; no session field added).
- `tower-instances.ts addArchitect`: call
  `resolveArchitectLaunch({ workspacePath, name, baseArgs: cmdParts.slice(1) })`.
  Covers both the user-driven `add-architect` (no jsonl yet → fresh) and the
  `launchInstance` reconcile loop (jsonl exists → resume) — `sessionFileExists`
  drives the branch, no signalling needed.
- `tower-terminals.ts reconcileTerminalSessions` (~L636-679): call
  `resolveArchitectLaunch({ workspacePath: dbSession.workspace_path, name: dbSession.role_id || 'main', baseArgs: cmdParts.slice(1) })`
  for `restartOptions.args`/`env`. Keep the existing `CODEV_ARCHITECT_NAME` env
  injection merged on top (identity must survive regardless of resume-vs-fresh).

### `removeArchitect`: honor "remove clears context"

Because the ID is recomputable, a removed-then-re-added sibling with the same name
would otherwise **resurrect** its old conversation. To match the issue's
"removing a named architect clears its UUID" criterion, after `removeArchitect`
kills the sibling PTY, call `deleteArchitectSessionFile(workspacePath, name)` so a
later re-add starts fresh. (Path discipline: the PTY is already dead at this point,
so the jsonl is not in use.)

### Path consistency note

The derived ID and the `sessionFileExists` check must key off the **same path string
claude used as its cwd**. Spawn sites create the PTY with `cwd: workspacePath`
(not `resolvedPath`), and #830's shipped `findLatestSessionId(workspacePath)` keyed
off the same value — so `resolveArchitectLaunch` takes `workspacePath` verbatim,
matching existing behavior.

## Files to Change

- `packages/codev/src/agent-farm/utils/claude-session-discovery.ts` — add
  `ARCHITECT_NS`, `architectSessionId`, `sessionFileExists`,
  `deleteArchitectSessionFile`, and `resolveArchitectLaunch`. No new dependency.
- `packages/codev/src/agent-farm/servers/tower-instances.ts` — `launchInstance`
  (main) + `addArchitect` (siblings) call `resolveArchitectLaunch`; remove the
  `safeToResume`/`findLatestSessionId` block + import; `removeArchitect` prunes the
  derived jsonl.
- `packages/codev/src/agent-farm/servers/tower-terminals.ts` — shellper-restart bake
  calls `resolveArchitectLaunch`.
- Tests — `__tests__/claude-session-discovery.test.ts`,
  `__tests__/tower-instances.test.ts`, `__tests__/tower-terminals.test.ts`.

**No database changes**: no migration, no `claude_session_id` column, no `schema.ts`
/ `db/index.ts` / `db/types.ts` / `types.ts` / `state.ts` edits. The `architect`
table is untouched.

**Also not touched**: `codev-skeleton/` (Tower implementation code, not a framework
doc/template). `findLatestSessionId` / builder `spawn.ts` path. `global.db`.

## Blast Radius & Rollout Control

Scoped to the architect spawn/revive machinery; **stateless and additive**.

**Surfaces touched** (who hits them / consequence if wrong):
- *`launchInstance` main path* — every `afx workspace start` / main revive. The **one
  genuine behavior change**: remove the `safeToResume` guard, derive + resume.
  Intentional — it's the regression-fix the issue asks for.
- *`addArchitect` + shellper-restart bake* — sibling spawn and architect crash-restart.
  New resume branch via the shared helper.
- *`removeArchitect`* — one added jsonl-prune call.
- *new helpers* — isolated, pure functions; `findLatestSessionId` untouched.

**Explicitly NOT touched**: the entire DB layer (no schema/migration/state changes);
builders / `spawn.ts` / builder jsonl-discovery; `global.db`; non-architect terminals;
Tower routing / messaging / SSE; porch / gates; `codev-skeleton/`.

**Why it's a controlled update:**
- **No persisted state** — nothing to migrate, back-fill, or corrupt; the ID is a
  pure function, recomputable forever. Removes a whole class of failure (store-after-
  PTY can't fail because it doesn't exist).
- **Soft-fail by design** — every site degrades to a fresh spawn when the jsonl is
  absent (legacy session, pruned store, first run). Worst case is "loses context
  once," never "fails to start." No `--resume` is ever issued against a missing file.
- **Backwards-compatible** — pre-#832 conversations were created under random session
  IDs, so the first post-upgrade spawn won't find a jsonl at the derived ID → fresh,
  then resumes cleanly on every subsequent revival (one-time loss, same as the column
  approach would have had).
- **Gated** — the behavior change lands behind the PIR `dev-approval` gate, where you
  exercise the running worktree (stop/start a multi-architect workspace) before any PR.
- **Size** — ~120–180 LOC incl. tests, all within `packages/codev`, no new deps/infra.

## Risks & Alternatives Considered

- **One-time context loss for `main`/siblings on the first reboot after this lands.**
  Pre-existing conversations used random IDs; the first derived-ID spawn is fresh, then
  self-heals. Matches the issue's Backwards-compatibility section.
- **Remove-then-re-add resurrection.** A recomputable ID would resume a removed
  sibling's old conversation on re-add. Mitigated by `deleteArchitectSessionFile` in
  `removeArchitect`.
- **claude must accept a chosen (v5) UUID for `--session-id` and resume by it.**
  **Verified empirically during planning** (not just from `--help`): passing a
  node:crypto-derived v5 UUID to `claude --print --session-id <id>` wrote the jsonl
  at exactly that name; `claude --print --resume <id>` from the same cwd recalled the
  prior turn, appended to the **same** jsonl (10977→13505 bytes), and did **not** fork
  a new session. So we control creation and resume; claude only auto-generates an ID
  when `--session-id` is omitted. This is the load-bearing assumption of the whole
  approach and it holds.
- **Workspace path instability.** The derived ID depends on the cwd string. A renamed
  workspace path changes the ID (loses resume) — but it also changes the
  `~/.claude/projects/<encoded-cwd>/` directory, so jsonl-discovery would break
  identically. No regression vs today; keyed off the same `workspacePath` #830 used.
- *Alternative — DB column (the issue's prescribed design).* Persists a random UUID
  per architect with a v12 migration. Rejected by the architect in favor of the
  stateless approach: no schema migration, fewer failure modes. (Its only edge —
  "remove clears UUID for free via row delete" — is matched here by the jsonl prune.)
- *Alternative — per-architect cwd so jsonl-discovery disambiguates.* Rejected:
  changes Spec 755 semantics (siblings intentionally share the workspace cwd) and is
  far more invasive.
- *Alternative — sidecar name→UUID file.* Rejected: fragments architect state away
  from the `architect` table (violates single-source-of-truth) for no gain over a
  pure function.

## Test Plan

Unit tests (run from the worktree: `pnpm --filter @cluesmith/codev test`):

- **Helper** (`claude-session-discovery.test.ts`):
  - `architectSessionId` is deterministic (same inputs → same canonical-format UUID),
    name-sensitive (different names same cwd → different IDs), and cwd-sensitive.
  - `sessionFileExists` true/false against a tmp `~/.claude/projects` (pin `homeDir`).
  - `resolveArchitectLaunch` → resume args (`--resume <id>`, empty env) when the jsonl
    exists; fresh args (`--session-id <id>`, role injection present) when it doesn't.
  - `deleteArchitectSessionFile` removes the derived jsonl; no-op when absent.
- **Cold-spawn — main** (`tower-instances.test.ts`): with a pre-seeded jsonl at the
  derived `main` ID, `launchInstance` passes `--resume <id>` and no role injection;
  with none, passes `--session-id <id>`. A multi-architect workspace resumes main
  (no `safeToResume` skip).
- **Cold-spawn — siblings** (`tower-instances.test.ts`): two siblings derive **distinct**
  IDs and each resumes its own jsonl (no cross-attachment); `removeArchitect` deletes
  the sibling's jsonl so a re-add is fresh.
- **Shellper auto-restart** (`tower-terminals.test.ts`, alongside the Spec 786 Phase 2
  restart-options tests ~L768-852): a sibling with an existing jsonl bakes
  `restartOptions.args` containing `--resume <id>` and skips role injection; without a
  jsonl it falls back to `buildArchitectArgs`; `CODEV_ARCHITECT_NAME` still resolved.

Manual (reviewer at `dev-approval`, optional — covered by units):
- Multi-architect workspace `afx workspace stop` + `start`; confirm main + a named
  sibling each land back in their own conversation and the sibling keeps its brief.
- `afx workspace remove-architect reviewer` then re-add `reviewer`; confirm it starts
  fresh (no resurrected conversation).
