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

Plan written next; flagging the prune-state per-table strategy + consolidation-as-boot-step
vs migration as the key plan-gate design decisions.
