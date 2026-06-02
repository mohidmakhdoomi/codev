# PIR #952 — Builders tree: group by phase, area becomes row prefix

## Plan phase (in progress)

Investigated the Builders tree grouping stack:
- `packages/vscode/src/views/builders.ts` — `BuildersProvider`, groups via `groupByArea(ordered, b => b.area)`.
- `packages/vscode/src/views/builder-row.ts` — `builderRowLabel` (currently `[<phase>] #id title`), `rollupGroupState`, `BUILDER_STATE_GLYPH`, `gateIconFor`.
- `packages/core/src/area-grouping.ts` — `groupByArea` (alphabetical + Uncategorized-last) + `uppercaseAreaName`.
- `area-group-tree-item.ts` (base, field `areaName`), `builder-tree-item.ts` (`BuilderGroupTreeItem`), `area-group-expansion.ts` (generic store, `persistAreaGroupExpansion`).

Key data facts:
- `OverviewBuilder.protocolPhase` = coarse phase (raw `phase:` from status.yaml). Phase ids by protocol: spir/aspir = specify/plan/implement/review/verify; pir = plan/implement/review; air = implement/pr; bugfix = investigate/fix/pr; maintain = maintain/review; experiment = hypothesis/design/execute/analyze; research = scope/investigate/synthesize/critique; spike = spike. Terminal status values: `verified`/`complete`. Empty string when no live status.
- `b.area` wire values are lowercase (`vscode`, `tower`, `cross-cutting`); `Uncategorized` sentinel when unlabeled.

Design approach (recommendations in plan):
- New core helper `groupByPhase` (lifecycle order: specify→plan→implement→review→pr→verify→verified, custom phases appended sorted, unknown/empty bucket last). Empty groups omitted naturally.
- Reuse generic `AreaGroupExpansionStore` with NEW key `codev.buildersPhaseGroupExpansion`.
- `BuilderGroupTreeItem` shape unchanged — pass phase string into the `areaName` slot (per issue's explicit guidance; minimal churn).
- `builderRowLabel`: `[<area>] #id title<stateLabel>`, omit prefix when Uncategorized.
- Backlog tree untouched. Dashboard has no builders-by-area grouping → no dashboard scope.

#913 (ephemeral group state) still OPEN, not merged → proceed with persistence (new key); note coordination.

## Plan revision 1 (architect Q: "all phase types across all protocols?")

Audited all 9 bundled protocols (no `tick` protocol.json ships). Confirmed experiment/maintain/research/spike ARE spawnable as builders → their phases can appear. Found 2 gaps in draft 1:
- Gap A: `complete` (backward-compat terminal synonym of `verified`) would render as a stray COMPLETE group → fix: normalize complete→verified before bucketing.
- Gap B: "custom phases alphabetical" scrambles experiment/research/bugfix natural sequences → fix: single curated PHASE_DISPLAY_ORDER (17 ids) keeping each protocol's natural order; unrecognized-future alphabetical; unknown(empty) last.
Distinct buckets possible ≈ 19 (17 authored ids + verified + unknown, complete normalized away); realistically 1–7 live.
