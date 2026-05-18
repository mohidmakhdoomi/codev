# Plan: Builder-to-Architect Message Routing (Multi-Architect Support v1)

## Metadata
- **ID**: 755-multi-architect-support-per-ar
- **Status**: draft
- **Specification**: [codev/specs/755-multi-architect-support-per-ar.md](../specs/755-multi-architect-support-per-ar.md)
- **Created**: 2026-05-17
- **GitHub Issue**: #755

## Executive Summary

The spec calls for letting a workspace host multiple named architect terminals so each builder's `afx send architect` message routes back to *its* spawning architect rather than to the lone singleton everyone uses today. The architect singleton is enforced in ~12 call sites across in-memory state, two SQLite databases, the Tower instance manager, the dashboard API, and several CLI commands. Relaxing it in one shot would be a sprawling, hard-to-review change with no obvious checkpoint.

This plan decomposes the work into **three sequential phases**, each ending in a demonstrable, committable state:

- **Phase 1 — Storage and Tower data-model relaxation.** Schema migration, in-memory data structure change, every internal Tower call site updated to iterate over a collection rather than a scalar. No user-visible behavior change yet (every workspace still has one architect named `main`).
- **Phase 2 — Naming CLI + spawn-time identity capture.** A new CLI surface lets the user start a second named architect; Tower injects the spawning architect's name into the architect terminal's environment; `afx spawn` records `spawnedByArchitect` on each new builder row.
- **Phase 3 — Affinity-aware routing.** The `from` field already arrives at `handleSend()` but is dropped before resolution. Phase 3 plumbs it into the resolver, implements the three security rules from the spec (legacy-builder fallback, architect-gone fallback, cross-architect-address rejection), and lights up the full routing matrix.

This ordering puts the user-visible win at the end: after Phase 3, a sibling-spawned builder's message lands where it should. Phases 1 and 2 are infrastructure that ship safely without exposing the feature, so they can be reviewed and merged independently if desired (single-PR or split-PR is the architect's call at the PR gate).

## Success Metrics

All criteria below come from `codev/specs/755-multi-architect-support-per-ar.md`. They roll up across phases; each phase's Acceptance Criteria carves out which subset that phase owns.

- [ ] Two architect terminals run simultaneously in one workspace, with distinct names.
- [ ] First architect defaults to `main`; subsequent auto-number to `architect-2`, `architect-3`; explicit name overrides the default.
- [ ] A builder spawned by architect `A` records `spawnedByArchitect: "A"` on its row.
- [ ] `afx send architect` from a builder reaches **only** its spawning architect.
- [ ] Single-architect workspaces show zero behavior change; `/api/state` shape unchanged.
- [ ] Legacy builders (no `spawnedByArchitect`) route to `main` if present, else fail with the asserted error.
- [ ] Architect-gone builders route to `main` if present, else fail with the asserted error (distinct from legacy).
- [ ] Architect reconnect (new `terminalId`, same name) is transparent to builders.
- [ ] Non-builder `architect`-target sends route to `main` (or first), unchanged.
- [ ] Cross-architect address spoofing rejected with asserted error.
- [ ] All existing tests pass; new tests cover the full routing matrix.
- [ ] No latency regression in the single-architect path.
- [ ] Local `state.db` migration and global `terminal_sessions` backfill both safe and idempotent.

## Phases (Machine Readable)

```json
{
  "phases": [
    {"id": "phase_1", "title": "Storage and Tower data-model relaxation"},
    {"id": "phase_2", "title": "Naming CLI and spawn-time identity capture"},
    {"id": "phase_3", "title": "Affinity-aware routing"}
  ]
}
```

## Phase Breakdown

### Phase 1: Storage and Tower data-model relaxation

**Dependencies**: None.

#### Objectives

- Let Tower store and operate on N architect terminals per workspace without breaking anything.
- Ship the SQLite migrations safely (local `state.db` schema change + global `terminal_sessions` data backfill).
- Touch every singleton call site the spec enumerates so that no code path silently retains the singleton assumption.
- **No user-visible change.** Every workspace still has one architect, named `main`.

#### Deliverables

- [ ] `ArchitectState` (types.ts) gains a `name: string` field.
- [ ] `Builder` (types.ts) gains `spawnedByArchitect?: string` (optional for backward-compat with old rows).
- [ ] `WorkspaceTerminals` (tower-types.ts) changes `architect?: string` to `architects: Map<string, string>` (name → terminalId).
- [ ] Local `state.db` migration: drop `CHECK (id = 1)` on `architect` table; change `id` to `TEXT PRIMARY KEY`; rekey the existing row's `id` to `'main'`. Add `name` column equivalent if the column doesn't already exist (the `id` field doubles as the name; final shape is plan-phase decision but spec is clear there is no separate ID).
- [ ] Local `state.db`: add `spawned_by_architect TEXT` column on the `builders` table (nullable).
- [ ] Global `terminal_sessions` backfill: for rows where `type = 'architect' AND role_id IS NULL`, set `role_id = 'main'`. Idempotent.
- [ ] `loadState` / `setArchitect` / `upsertBuilder` updated to round-trip the new fields.
- [ ] Every Tower call site listed in the spec's References (~12 sites across `tower-instances.ts`, `tower-routes.ts`, `tower-terminals.ts`, `tower-tunnel.ts`, `commands/stop.ts`, `commands/status.ts`, `db/migrate.ts`) updated to iterate over the collection. The activation guard at `tower-instances.ts:354` is relaxed (multi-architect creation is now permitted; default name `main` is supplied for now).
- [ ] `/api/state` response shape preserved: continues to return `state.architect` as a scalar, populated from the `main` entry (or first, if `main` absent). Dashboard and VSCode extension untouched.
- [ ] `resolveAgentInWorkspace` (`tower-messages.ts:191-200`) updated to look up the architect by name from the collection. With only one architect (`main`) registered after Phase 1, behavior is unchanged from today.
- [ ] CI guardrail test: a grep-based unit test that fails if `entry.architect` (singular accessor) appears in any source file outside the documented allowed shim sites. Stops future contributors from re-introducing the singleton.
- [ ] Migration tests (one for the local schema change, one for the global `terminal_sessions` backfill).
- [ ] All existing tests pass with zero modifications, except for tests that directly inspect the old `entry.architect` scalar — those update to the new collection shape.

#### Implementation Details

**SQLite migration (local `state.db`).** The current schema is:

```sql
CREATE TABLE IF NOT EXISTS architect (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  pid INTEGER NOT NULL,
  port INTEGER NOT NULL,
  cmd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  terminal_id TEXT
);
```

SQLite cannot drop a CHECK constraint in place, so the migration follows the standard `CREATE TABLE new`, `INSERT SELECT`, `DROP TABLE old`, `ALTER TABLE new RENAME TO old` recipe. The new schema:

```sql
CREATE TABLE architect_v2 (
  id TEXT PRIMARY KEY,         -- architect name (e.g., 'main', 'architect-2', 'sibling')
  pid INTEGER NOT NULL,
  port INTEGER NOT NULL,
  cmd TEXT NOT NULL,
  started_at TEXT NOT NULL,
  terminal_id TEXT
);
INSERT INTO architect_v2 (id, pid, port, cmd, started_at, terminal_id)
  SELECT 'main', pid, port, cmd, started_at, terminal_id FROM architect;
DROP TABLE architect;
ALTER TABLE architect_v2 RENAME TO architect;
```

The migration goes in `db/migrate.ts` keyed by a new version number; the `_migrations` table records it.

**SQLite migration (`builders` table).** Add `spawned_by_architect TEXT` as a nullable column:

```sql
ALTER TABLE builders ADD COLUMN spawned_by_architect TEXT;
```

Trivial — single `ALTER`.

**`terminal_sessions` backfill (global `~/.agent-farm/global.db`).** No schema change; data only:

```sql
UPDATE terminal_sessions
   SET role_id = 'main'
 WHERE type = 'architect' AND role_id IS NULL;
```

Idempotent.

**In-memory shape.** `WorkspaceTerminals.architects` is a `Map<string, string>` (name → terminalId). The plural plus the keyed access pattern makes wrong-singleton-y code (`entry.architects` followed by a string method) fail loudly at the type level rather than producing wrong-but-plausible runtime behavior.

**Dashboard API shim.** In `tower-routes.ts:1411-1418`, the existing code populates `state.architect` from `entry.architect`. Phase 1 changes this to:

```ts
const mainArchitectId = entry.architects.get('main') ?? entry.architects.values().next().value;
if (mainArchitectId) {
  const session = manager.getSession(mainArchitectId);
  if (session) state.architect = { ... };
}
```

This shim is intentional and documented in the spec (item 7).

**Files touched**:
- `packages/codev/src/agent-farm/types.ts`
- `packages/codev/src/agent-farm/servers/tower-types.ts`
- `packages/codev/src/agent-farm/db/schema.ts`
- `packages/codev/src/agent-farm/db/migrate.ts`
- `packages/codev/src/agent-farm/state.ts`
- `packages/codev/src/agent-farm/servers/tower-instances.ts`
- `packages/codev/src/agent-farm/servers/tower-routes.ts`
- `packages/codev/src/agent-farm/servers/tower-terminals.ts`
- `packages/codev/src/agent-farm/servers/tower-tunnel.ts`
- `packages/codev/src/agent-farm/servers/tower-messages.ts`
- `packages/codev/src/agent-farm/commands/stop.ts`
- `packages/codev/src/agent-farm/commands/status.ts`
- Test files mirroring each of the above.

#### Acceptance Criteria

- [ ] Migrations run forward cleanly on a fresh DB and on a pre-existing DB.
- [ ] Migration unit tests pass: pre-state with `id = 1` architect row + null `role_id` → post-state with `id = 'main'` and `role_id = 'main'`.
- [ ] All existing tests pass.
- [ ] `entry.architect` (singular) is not used anywhere in source code (CI guardrail).
- [ ] A single-architect workspace's `/api/state` response is byte-identical to before (after dashboard shim).
- [ ] 3-way consultation reviewed and feedback addressed.

#### Test Plan

- **Unit tests**:
  - Migration test for local `architect` table (one row → renamed and rekeyed).
  - Migration test for global `terminal_sessions` (null `role_id` → `'main'`; non-null untouched; non-architect rows untouched; idempotent on re-run).
  - `loadState` round-trip with multiple architect rows in `state.db`.
  - `WorkspaceTerminals.architects` collection access (add, get, delete, iterate).
- **Integration tests**:
  - Tower starts up against a freshly migrated DB and serves `/api/state` with the expected scalar shape.
  - Workspace stop kills the single architect terminal correctly via the new iteration code path.
- **Manual testing**:
  - Spin up a clean workspace; verify the architect tab appears in the dashboard and the architect terminal works exactly as before.

#### Rollback Strategy

The migration's reverse SQL (rebuild the singleton table, copy the `'main'` row back to `id = 1`, drop the `spawned_by_architect` column) is committed alongside the forward migration as a `_migrations` rollback. If Phase 1 ships and a bug is found, revert the PR and re-run the workspace; the rollback SQL restores the prior schema.

#### Risks

- **Risk**: A test or external consumer reads `entry.architect` (singular) directly and silently breaks. → **Mitigation**: TS compile error from the type change (renaming the field forces every call site to update); CI guardrail catches new occurrences.
- **Risk**: The migration loses the existing architect row in workspaces with a long history. → **Mitigation**: Migration test covers the pre-state explicitly; the rebuild table SQL preserves all columns; an integration test boots Tower against a migrated DB and verifies the architect is still there.
- **Risk**: The global `terminal_sessions` backfill races with an active Tower writing new rows. → **Mitigation**: The backfill runs as part of Tower startup before serving connections; documented in the migrate code.

---

### Phase 2: Naming CLI and spawn-time identity capture

**Dependencies**: Phase 1.

#### Objectives

- Give the user a way to start a second named architect terminal.
- Make the spawning architect's name observable to `afx spawn` via the architect terminal's environment.
- Record `spawnedByArchitect` on every new builder row.
- **Still no routing change.** Sends to `architect` continue to land on the singleton (now `main`); this phase only changes *which name* gets attached to each builder.

#### Deliverables

- [ ] New CLI subcommand for starting an additional named architect. The spec's example was `afx architect --name <name>`; the implementation should match unless a better shape emerges in 3-way review. The first architect (started by `afx workspace start`) gets `main` by default; a second instance without `--name` gets the next-available `architect-<N>` (smallest unused integer ≥ 2).
- [ ] Name validation: `[a-z][a-z0-9-]*`, max 64 chars. Re-using a registered name in the same workspace is rejected with a clear error.
- [ ] Tower injects an env var (proposed: `CODEV_ARCHITECT_NAME`) into the architect terminal's shell at start time. Final variable name is plan-phase but committed by the time this phase begins implementation.
- [ ] `afx spawn` reads `CODEV_ARCHITECT_NAME` and passes it to `upsertBuilder` as `spawnedByArchitect`. Defaults to `main` when the env var is absent (running outside any architect terminal).
- [ ] `afx status` continues to show a flat builder list with no filtering; the `spawnedByArchitect` column is **not** added in v1 (per spec — that's issue #2). The plan resists scope creep here.
- [ ] Unit tests for: name validation, auto-numbering, env var detection, default fallback.

#### Implementation Details

**Architect-start CLI shape.** Plan-phase decision after 3-way review. Strong candidates:

1. `afx architect --name <name>` — new noun subcommand, future-proof for `afx architect list`, `afx architect kill <name>`.
2. `afx workspace add-architect --name <name>` — keeps architect under the existing `workspace` namespace.

The spec's example was option 1; the plan adopts it unless review surfaces a strong reason to switch. Either way, the underlying mechanism is the same: a request to Tower to create a new architect terminal with a supplied name (or to auto-assign one).

**Env var contract.** Tower already injects environment variables into the terminals it spawns (the harness mechanism is documented in `agent-farm/types.ts:166-173` for harness providers). Phase 2 adds `CODEV_ARCHITECT_NAME=<name>` to every architect terminal's environment. The variable is documented in the README's "agent-farm environment" section.

**Spawn-time detection.** `commands/spawn.ts:439` calls `upsertBuilder`. The diff:

```ts
const spawnedByArchitect = process.env.CODEV_ARCHITECT_NAME ?? 'main';
upsertBuilder({ ..., spawnedByArchitect });
```

Two lines, plus a small helper if we want consistent handling across other state-writing paths (`afx resume`, `afx restart` if relevant — plan to confirm).

**Auto-numbering.** The "smallest unused integer ≥ 2" rule is implemented as a query on Tower's in-memory architect collection at architect-create time. The plan phase pins the tiebreak: starting `architect-2`, killing it, starting another with no name → the new one is `architect-2` again, because the collection is empty of `architect-2` at the time of the second start. This matches the spec's "smallest-unused-integer" semantics.

**Files touched**:
- `packages/codev/src/agent-farm/cli.ts` (new subcommand registration)
- `packages/codev/src/agent-farm/commands/architect.ts` (new file — the subcommand handler)
- `packages/codev/src/agent-farm/commands/spawn.ts` (read env var + pass to `upsertBuilder`)
- `packages/codev/src/agent-farm/state.ts` (`upsertBuilder` signature includes `spawnedByArchitect`)
- `packages/codev/src/agent-farm/servers/tower-instances.ts` (architect-create now accepts a `name` param + auto-assigns)
- `packages/codev/src/agent-farm/servers/tower-routes.ts` (new HTTP route for the architect-create API)
- `packages/core/src/tower-client.ts` (client method for the new route)
- Tests for each.

#### Acceptance Criteria

- [ ] Starting a second architect via `afx architect --name sibling` registers `sibling` in Tower's `architects` collection; `afx status` shows it (if the v1 plan-phase decision is to surface it — confirm in 3-way review).
- [ ] Starting a second architect without `--name` gets `architect-2`; a third gets `architect-3`.
- [ ] Re-using an existing name (or `main`) is rejected with a clear error.
- [ ] Invalid names (uppercase, spaces, leading digit, length > 64) are rejected.
- [ ] A builder spawned from inside an architect terminal whose `CODEV_ARCHITECT_NAME=sibling` records `spawnedByArchitect: 'sibling'` in `state.db`.
- [ ] A builder spawned from the workspace root (no env var) records `spawnedByArchitect: 'main'`.
- [ ] All Phase 1 acceptance criteria continue to hold.
- [ ] 3-way consultation reviewed.

#### Test Plan

- **Unit tests**:
  - Name validation (positive + negative).
  - Auto-numbering algorithm (smallest-unused-integer with gaps).
  - `commands/spawn.ts` env-var detection (set, unset, empty-string).
- **Integration tests**:
  - Start architect via CLI, observe it in Tower's state.
  - Spawn a builder from the new architect terminal, observe `spawned_by_architect` column in `state.db`.
  - Collision rejection (start `sibling`, attempt to start another `sibling`, observe error).
- **Manual testing**:
  - Run two architect terminals side by side. Confirm both show in `afx status`. Send messages — they still all go to `main` (routing change is Phase 3).

#### Rollback Strategy

Revert the new CLI subcommand and the env-var injection in Tower. The `spawned_by_architect` column from Phase 1 stays; existing data is preserved.

#### Risks

- **Risk**: The env-var injection conflicts with user-supplied env vars in their shell config. → **Mitigation**: `CODEV_*` prefix is reserved per existing convention; documented as Codev-controlled.
- **Risk**: CLI shape decision (option 1 vs. 2) gets pushed back during PR review. → **Mitigation**: Spec gave a clear example; if the architect surface wants something different at PR time, it's a small refactor of the subcommand file.
- **Risk**: Auto-numbering algorithm has subtle off-by-one. → **Mitigation**: Unit test with explicit cases (empty workspace, `main` only, `main + architect-2`, `main + architect-3` with `architect-2` missing).

---

### Phase 3: Affinity-aware routing

**Dependencies**: Phase 2.

#### Objectives

- When a builder runs `afx send architect`, deliver the message to that builder's spawning architect — not the singleton.
- Enforce the three security rules from the spec: legacy-builder fallback, architect-gone fallback, cross-architect-address rejection (with exact error texts).
- Light up the full routing test matrix from the spec.
- **This is the user-visible win.** After Phase 3, the feature works end-to-end.

#### Deliverables

- [ ] `from` (sender identity) plumbed from `handleSend()` into the resolution layer.
- [ ] `resolveTarget`'s signature (or a new sibling resolver) accepts the sender so the builder-context lookup can happen.
- [ ] `resolveAgentInWorkspace` (or its successor) implements:
  1. **Sender is a builder, target is `architect`** → look up sender's `spawnedByArchitect` in `state.db`; if the named architect is registered in `entry.architects`, route there. Otherwise apply architect-gone fallback (route to `main` if present; else error with the spec's architect-gone message).
  2. **Sender is not a builder, target is `architect`** → route to `main` if present; else route to the first registered architect.
  3. **Sender is a builder, target is `architect:<name>`** and `<name> !== sender's spawnedByArchitect` → reject with the spec's address-spoofing error message.
  4. **Legacy builder (no `spawnedByArchitect` row)** → route to `main` if present; else error with the spec's legacy-builder message.
- [ ] Error messages match the spec verbatim (asserted by test).
- [ ] `tower-cron.ts` and any other non-builder architect-target sender continues to resolve to `main` (no behavior change for cron).
- [ ] Builder-context detection at the resolver layer — distinguishing builder-from from architect-from. The detection rule is "if `from` matches a registered builder ID in this workspace's `entry.builders` Map, treat as builder-context." Plan-phase to pin the exact predicate.
- [ ] Architect-reconnect handling: when an architect terminal dies and is recreated with the same name (new `terminalId`), routing seamlessly picks up the new `terminalId` from `entry.architects.get(name)`. No builder-side change.
- [ ] Full routing-matrix tests (spec test scenarios 1–13, minus the broadcast scenarios which were dropped from v1).
- [ ] All security tests assert error texts verbatim.

#### Implementation Details

**Plumbing `from`.** `handleSend()` at `tower-routes.ts:854` currently calls:

```ts
const resolved = resolveTarget(to, workspace);
```

Phase 3 changes this to:

```ts
const resolved = resolveTarget(to, workspace, from);
```

`resolveTarget`'s signature becomes `(target, fallbackWorkspace?, sender?)`. The widening is backward-compatible for the cron and other callers that don't have a sender.

Inside `resolveAgentInWorkspace`, the new logic (pseudocode):

```ts
function resolveAgentInWorkspace(agent, workspacePath, sender) {
  const entry = allWorkspaces.get(workspacePath);
  // ...
  if (agent === 'architect' || agent === 'arch') {
    // Singular 'architect' — sender-affinity-aware.
    if (sender && isBuilderInWorkspace(sender, entry)) {
      const spawnedByArchitect = lookupBuilderSpawningArchitect(sender);
      if (!spawnedByArchitect) {
        // Legacy builder (no spawnedByArchitect row).
        const main = entry.architects.get('main');
        if (main) return { terminalId: main, ... };
        return errorLegacyBuilder(sender, [...entry.architects.keys()]);
      }
      const target = entry.architects.get(spawnedByArchitect);
      if (target) return { terminalId: target, ... };
      // Architect-gone fallback.
      const main = entry.architects.get('main');
      if (main) return { terminalId: main, ... };
      return errorArchitectGone(sender, spawnedByArchitect, [...entry.architects.keys()]);
    }
    // Non-builder sender or no sender — singleton-style resolution.
    const main = entry.architects.get('main');
    if (main) return { terminalId: main, ... };
    const first = entry.architects.values().next().value;
    if (first) return { terminalId: first, ... };
    return errorNoArchitect(workspacePath);
  }
  // ...
  // 'architect:<name>' addressing — builder sender must match the name.
  if (agent.startsWith('architect:')) {
    const requestedName = agent.slice('architect:'.length);
    if (sender && isBuilderInWorkspace(sender, entry)) {
      const spawnedByArchitect = lookupBuilderSpawningArchitect(sender);
      if (spawnedByArchitect !== requestedName) {
        return errorAddressSpoofing(sender);
      }
    }
    const target = entry.architects.get(requestedName);
    if (target) return { terminalId: target, ... };
    // ... not-found error path
  }
  // Builders map matching (unchanged) ...
}
```

The exact API decomposition (one resolver vs. multiple sibling resolvers, where `lookupBuilderSpawningArchitect` lives, how to import `state.db` into the resolver layer without creating a cycle) is plan-phase work that should be confirmed in the 3-way review.

**Builder-context detection.** `isBuilderInWorkspace(sender, entry)` checks whether `sender` is a key in `entry.builders`. This is unambiguous: builder IDs and architect names follow disjoint patterns (builders use `<protocol>-<issue>` like `spir-755`, architects use `main` or `architect-<N>` or user-supplied names). The plan should still confirm there's no collision via test cases.

**Files touched**:
- `packages/codev/src/agent-farm/servers/tower-messages.ts` (resolver core)
- `packages/codev/src/agent-farm/servers/tower-routes.ts` (`handleSend` plumbing at line 854)
- `packages/codev/src/agent-farm/state.ts` (helper to look up a builder's `spawnedByArchitect`)
- New error-construction module (or inline in `tower-messages.ts`) for the asserted-verbatim error texts.
- Tests covering every spec scenario.

#### Acceptance Criteria

- [ ] **Single-architect baseline (spec scenario 1)**: builder → `architect` → `main`. Unchanged.
- [ ] **Two architects, scoped routing (spec scenario 2)**: builder spawned by `main` → `architect` → `main`'s terminal only. Builder spawned by `sibling` → `architect` → `sibling`'s terminal only.
- [ ] **Legacy builder, `main` present (spec scenario 5)**: pre-feature builder row → `main`.
- [ ] **Legacy builder, `main` absent (spec scenario 6)**: pre-feature builder row → error; text matches spec verbatim.
- [ ] **Architect-gone, `main` present (spec scenario 7)**: builder with `spawnedByArchitect: 'sibling'` and `sibling` killed → `main`.
- [ ] **Architect-gone, `main` absent (spec scenario 8)**: same builder, no `main` → error; text matches spec verbatim including missing name and registered list.
- [ ] **Architect reconnect (spec scenario 9)**: `sibling` killed and recreated with same name → builder still reaches the new terminal.
- [ ] **Spawning-architect detection (spec scenario 10)**: `afx spawn` from `main`'s terminal → `spawnedByArchitect: 'main'`; from `sibling`'s terminal → `'sibling'`; outside any architect terminal → `'main'`.
- [ ] **Address-spoofing rejection (spec scenario 11)**: builder spawned by `main` → `architect:sibling` → error; text matches spec verbatim.
- [ ] **Non-builder architect-target sends (spec scenario 12)**: workspace-root `afx send architect` → `main`; cron-originated messages → `main`. No behavior change.
- [ ] **Workspace stop with multiple architects (spec scenario 13)**: stop tears down all architects.
- [ ] Latency parity: single-architect path microbenchmark shows no statistically significant regression.
- [ ] All Phase 1 + Phase 2 criteria continue to hold.
- [ ] 3-way consultation reviewed.

#### Test Plan

- **Unit tests**:
  - `resolveAgentInWorkspace` covering all four resolution branches (builder + match, builder + architect-gone, non-builder, builder + spoofing).
  - Error message text constants — each asserted verbatim against the spec.
  - `lookupBuilderSpawningArchitect` (returns the right name; returns `null` for legacy rows; returns `null` for unknown builder IDs).
- **Integration tests**:
  - End-to-end builder → architect routing through Tower's HTTP send endpoint, with two architects registered.
  - Architect reconnect: send to architect, kill terminal, recreate with same name, send again, assert delivery.
  - Cron-originated architect message ends up in `main`.
- **Manual testing**:
  - Spin up two architect terminals in one workspace. Spawn a builder from each. Have each builder send `afx send architect "hi from <name>"`. Confirm each architect terminal sees only its own builder's message.

#### Rollback Strategy

Revert the resolver changes; sends fall back to the singleton-style resolution. The `spawned_by_architect` column and the multi-architect storage stay in place (still useful for Phase 2's CLI). Effectively rolls back the routing fix without uninstalling the underlying capability.

#### Risks

- **Risk**: `resolveTarget`'s widened signature is called from many places; one caller breaks. → **Mitigation**: TS strict mode + comprehensive unit tests; the `sender` param is optional with a clear default branch.
- **Risk**: Error text drifts from the spec during implementation iteration. → **Mitigation**: error texts live as exported string constants imported by both the producer and the test asserter. A change to one breaks the other.
- **Risk**: A builder's `spawnedByArchitect` is set but Tower's `entry.architects` doesn't know about that name (e.g., the architect was registered to `state.db` but the in-memory map is stale). → **Mitigation**: explicit test for the in-memory/persistent divergence; documented as a Tower-side bug that the resolver doesn't paper over (it falls back to `main` per the spec rule, not silently to the closest match).

---

## Dependency Map

```
Phase 1 ──→ Phase 2 ──→ Phase 3
(storage)   (CLI +     (routing)
            spawn)
```

Linear chain. No optional or parallel phases.

## Resource Requirements

- **Engineers**: One builder-agent. Familiarity with Codev's Tower architecture (SQLite, in-memory terminal registry, message-resolution pipeline) is helpful but the spec and this plan provide all needed file-level pointers.
- **Environment**: Local dev environment with `pnpm`, `node`, `sqlite3`. No production database access required; all migrations target local `state.db` and global `~/.agent-farm/global.db`.
- **Infrastructure**: None beyond what the existing Codev workspace already provides.

## Integration Points

### Internal Systems

- **Tower (HTTP server + WebSocket)**: All routing changes live here. No new endpoints in Phase 1 (just data-model changes); Phase 2 adds the architect-create endpoint; Phase 3 modifies the existing `/api/send` resolution.
- **`afx` CLI**: Phase 2 adds a new subcommand. Phase 3 has no CLI surface.
- **SQLite (local `state.db` + global `terminal_sessions`)**: Phase 1 migrates schema + data. Phase 2 writes to the new `spawned_by_architect` column. Phase 3 reads from it.
- **Dashboard / VSCode extension**: No changes. The `/api/state` shim in Phase 1 preserves the existing contract.

### External Systems

None. This feature is entirely internal to Codev's workspace tooling.

## Risk Analysis

### Technical Risks

| Risk | Probability | Impact | Mitigation | Phase |
|------|-------------|--------|------------|-------|
| Singleton-relaxation sweep misses a call site | Medium | High | Spec enumerates ~12 sites; CI guardrail test; type-system catches new occurrences after the rename. | Phase 1 |
| Local migration loses the existing architect row | Low | High | Migration test with pre-state; rebuild SQL copies all columns; integration test boots Tower against migrated DB. | Phase 1 |
| Dashboard / VSCode extension breaks on shape change | Medium | High | API shim in `tower-routes.ts:1411-1418` preserves scalar shape; integration test asserts byte-identical response. | Phase 1 |
| Auto-numbering algorithm has subtle bug | Low | Low | Unit tests for empty workspace, `main`-only, gaps, name-reuse-after-kill. | Phase 2 |
| Env-var injection conflicts with user shell config | Low | Medium | `CODEV_*` prefix is reserved per existing convention; documented. | Phase 2 |
| Error text drifts from spec | Medium | Medium | Error texts as exported constants imported by tests; single source of truth. | Phase 3 |
| `resolveTarget` signature widening breaks a caller | Low | Medium | `sender` is optional with clear default; TS strict mode catches misuse. | Phase 3 |
| Latency regression in single-architect path | Low | Medium | Microbenchmark before/after; single-architect path is one `Map.get('main')` lookup. | Phase 3 |

### Schedule Risks

| Risk | Probability | Impact | Mitigation |
|------|-------------|--------|------------|
| 3-way consultation surfaces a structural rethink | Medium | Medium | Phase boundaries chosen so each phase commits independently; a rethink in one phase doesn't blow up the others. |
| Architect requests scope expansion at PR time (e.g., add filter to `afx status`) | Medium | Low | Spec is explicit about what's deferred to issue #2; this plan resists scope creep in Phase 2's `afx status` section. |

## Validation Checkpoints

1. **After Phase 1**: Migration tests pass on a clean DB and on a pre-existing DB. `entry.architect` (singular) is not used anywhere in source. Dashboard renders identically.
2. **After Phase 2**: A second named architect can be started; `state.db` records `spawned_by_architect` for new builders. Messages still all land on `main` (no routing change yet).
3. **After Phase 3**: Full routing matrix from the spec passes. Manual smoke test with two architects + two builders confirms scoped routing.
4. **Before PR merge**: All three phases' tests pass; the CI guardrail is in place; spec acceptance criteria all check off.

## Monitoring and Observability

This feature is internal to local workspaces; no production metrics or alerting changes are needed.

### Logging Requirements

- Debug-level log when a builder's `spawnedByArchitect` triggers architect-gone fallback. Useful for diagnosing user reports of "my messages went to main."
- Info-level log when an architect is registered with an auto-numbered name (`architect-2`, etc.) so the user can see in Tower logs which name their second architect got.

## Documentation Updates Required

- [ ] `CLAUDE.md` / `AGENTS.md`: mention the multi-architect capability and the default-naming policy (one-paragraph addition).
- [ ] `codev/resources/commands/agent-farm.md`: document the new `afx architect` subcommand (or the chosen CLI shape).
- [ ] `codev/resources/arch.md`: short addition under the Tower section explaining the architect-name-as-routing-key invariant.
- [ ] `codev/resources/lessons-learned.md`: any durable wisdom uncovered (e.g., "Tower routing is a singleton enforced in many places — relaxing it requires a CI guardrail").

## Post-Implementation Tasks

- [ ] Confirm a clean install (`pnpm -w run local-install`) works end-to-end.
- [ ] Open follow-up issues for the deferred feature asks (#2: `--architect` filter on `afx status`; #3: `THREAD.md`; #4: cross-thread visibility; #5: thread-aware `consult`).
- [ ] Manual smoke test on the reporter's workflow (two architects with their own builder pools).

## Expert Review

To be added after 3-way consultation (Gemini, Codex, Claude) per SPIR protocol.

## Approval

- [ ] 3-way consultation complete
- [ ] Architect review (M Waleed Kadous)
- [ ] Plan-approval gate (porch)

## Change Log

| Date | Change | Reason |
|------|--------|--------|
| 2026-05-17 | Initial plan draft | Spec approved; planning phase began. |

## Notes

- Phase 3 ships the user-visible win deliberately last. This means the reporter doesn't get value until all three phases land — but each individual phase commits cleanly and could ship in isolation if needed. The architect decides at PR time whether to bundle all three into one PR or split.
- The spec's "Out of scope" items (#2–#5 from issue #755) stay out of scope through all three phases. Plan-phase discipline matters: a small "while we're here" addition to Phase 2 (e.g., adding `spawnedByArchitect` to `afx status` output) is exactly the scope creep the spec called out as a risk.
- The CI guardrail test from Phase 1 is the most important non-obvious deliverable. Without it, a future contributor who adds a new `entry.architect` access (singular) will silently undo a piece of this feature in some edge case. With it, the build fails on that line.
