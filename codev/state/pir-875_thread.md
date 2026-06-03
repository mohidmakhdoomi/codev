# PIR #875 — Collapse duplicate Overview*/*Overview types

## Plan phase (2026-06-03)

Investigated the duplication. Two parallel declarations:
- Wire: `packages/types/src/api.ts` (`OverviewBuilder`, `OverviewPR`, `OverviewBacklogItem`, `OverviewRecentlyClosed`, `OverviewData`)
- Server: `packages/codev/src/agent-farm/servers/overview.ts` (`BuilderOverview`, `PROverview`, `BacklogItem`, `RecentlyClosedItem`, `OverviewData`, local `PlanPhase`)

Key findings driving the plan:
- **Two unrelated `PlanPhase` types.** overview.ts's (`status: string`) is in scope → moves to api.ts. Porch's `commands/porch/types.ts` one (`status: PlanPhaseStatus`) is a different concern → untouched.
- **Rename is safe.** Only external importer of `servers/overview.js` is `overview.test.ts`, which imports functions, not type names. So renaming server-side identifiers to the wire names is clean, no alias layer needed.
- **No third copy.** dashboard `lib/api.ts` just re-exports from codev-types. VSCode/dashboard/core already consume the wire types — no consumer changes.
- **No name collision** for `PlanPhase` in codev-types.
- codev package already depends on `@cluesmith/codev-types` (workspace:*).

Plan written to `codev/plans/875-collapse-duplicate-overview-ov.md`, committed. Sitting at `plan-approval` gate.

## Implement phase (2026-06-03)

plan-approval approved. Applied the consolidation:
- `packages/types/src/api.ts`: added named `PlanPhase` interface; `OverviewBuilder.planPhases` now `PlanPhase[]` (was inlined).
- `packages/types/src/index.ts`: export `PlanPhase` from the barrel.
- `packages/codev/src/agent-farm/servers/overview.ts`: import the 5 wire types + `PlanPhase` from `@cluesmith/codev-types`; deleted the 6 local interface blocks; renamed server identifiers to the wire names (`BuilderOverview`→`OverviewBuilder`, `PROverview`→`OverviewPR`, `BacklogItem`→`OverviewBacklogItem`, `RecentlyClosedItem`→`OverviewRecentlyClosed`).

Note: worktree shipped without node_modules — had to `pnpm install` before the build/tests would run (the misleading first "exit 0" was `tail`'s, not the build's).

Verification: `pnpm build` green (no TS errors → confirms zero pre-existing drift between the formerly-duplicated declarations); overview unit suite 150/150 pass. No consumer changes needed (VSCode/dashboard/core already on the wire types; dashboard re-exports them).

Sitting at `dev-approval` gate.
