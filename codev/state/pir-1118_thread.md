# PIR #1118 — Consolidate state.db tables into global.db

## Phase: plan

### Investigation notes (plan phase)
- **Root of fragmentation**: `getDb()` (`db/index.ts:54`) is a singleton bound to Tower's
  startup CWD via `getConfig().stateDir` → `<workspaceRoot>/.agent-farm/state.db`.
  `setArchitect(resolvedPath, …)` already tags rows with `workspace_path` (Bugfix #826),
  but the *file* is still CWD-bound, so workspace B's architect row lands in workspace A's
  state.db. After a Tower restart from B, those rows are stranded.
- **Two direct-open workarounds** that exist *because* of the singleton-path bug and should
  collapse to `getDb()`/global.db after the fix:
  - `state.ts:496` `lookupBuilderSpawningArchitect` — opens `<ws>/.agent-farm/state.db` RO.
  - `overview.ts:817` — opens `<ws>/.agent-farm/state.db` RO, reads all builders by worktree.
- **Schema**: only `architect` has a `workspace_path` column (v11). `builders` (keyed by id,
  has `worktree` path), `utils`, `annotations` have NO workspace linkage. This is the main
  wrinkle for `prune-state` (acceptance criteria name all four). builders/utils/annotations
  are runtime-ephemeral (wiped by `clearRuntime`/`clearState`); the audited stale rows are
  all `architect` rows.
- global.db migrations live in `ensureGlobalDatabase` (`db/index.ts:625`),
  `GLOBAL_CURRENT_VERSION = 13`. Local migrations (1–12) in `ensureLocalDatabase`.
- CLI is commander-based (`cli.ts`); `workspace` is a command group. `afx prune-state`
  → top-level command; `afx workspace forget <path>` → workspaceCmd subcommand.
- Tower boot: `tower-server.ts` `main()` — good hook for the one-time data consolidation.
- Tests mock `getDb`/`getGlobalDb` separately (`__tests__/state.test.ts:16`); the 4 tables
  come from `LOCAL_SCHEMA`. After merge they must come from `GLOBAL_SCHEMA`; test mocks +
  fixtures need updating.

Plan written; flagging the prune-state per-table strategy + consolidation-as-boot-step
vs migration as the key plan-gate design decisions.

### Plan revision (architect feedback at plan-approval gate)
Architect pushed back on 4 points; plan revised:
1+2. **Cut `afx prune-state` + `afx workspace forget`.** Stale rows are harmless under
   workspace_path read-scoping; pruning was cosmetic + dragged in the per-table mess. Deviates
   from issue acceptance criteria — flagged for confirmation.
3. **Migration on Tower boot** — locked in (removed the fold-into-v14 alternative).
4. **`lookupBuilderSpawningArchitect` workspacePath param is LOAD-BEARING, not vestigial.**
   Investigating it surfaced the big finding: **builder ids collide across workspaces**
   (`<protocol>-<issueNumber>`; issue numbers repeat across repos). Per-workspace state.db FILES
   keep them distinct today; `spec-755-lookup-builder.test.ts:113-116` encodes this as a
   security-relevant contract (spoofing check). So **`builders` needs workspace_path + composite
   PK `(workspace_path, id)`** — the one structural reshape; mirrors #826/v11 for architect.

### Table verdict (architect asked: move as-is or reshape?)
- architect → as-is (already composite PK since v11)
- builders → RESHAPED (add workspace_path + composite PK) — the only structural change
- utils, annotations → as-is (UUID ids, no production addUtil/addAnnotation callers, vestigial)

Builder-read callsite audit (getBuilder/getBuilders/removeBuilder/getBuildersByStatus) is the
bounded extra cost. upsertBuilder can derive workspace_path from builder.worktree (no sig change).
### Migration scope decision (architect, plan-approval gate)
Architect chose **strict one-off migration of the ACTIVE state.db only** (not multi-file scan,
not per-boot). Key points:
- Runs ONCE in the install's lifetime, at first post-upgrade Tower boot. Persistent marker in
  global.db (written in the SAME txn as the row copy) → every later boot short-circuits;
  state.db is dead, never read again.
- Straight copy (single source, empty target) → NO conflict resolution needed.
- Satellite files (other workspaces' state.db) abandoned — accepted loss. Completeness depends
  on which workspace Tower is first started from after upgrade. Dry-run lets user confirm.
- Open marker set-policy question: strict (mark on first boot unconditionally) vs
  mark-on-first-real-migration (when active state.db absent/empty on first boot). Flagged in
  plan Open Q #3.

Still at plan-approval gate awaiting re-review.
