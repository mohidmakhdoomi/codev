# PIR #1104 — merge Architects + Builders into one "Agents" tree (vscode)

## Plan phase

Investigated the VSCode sidebar tree code. Key findings:

- **There is NO standalone "Architects" tree view in VSCode.** Registered views are
  `codev.builders` (BuildersProvider) + a *Workspace > Architects subsection* inside
  `codev.workspace` (WorkspaceProvider.getArchitectChildren). The issue's "two parallel
  trees" framing matches the Tower dashboard, not the extension. So "remove the standalone
  Architects tree" is largely a no-op here — the real work is adding an architect tier to
  the Builders tree (renamed Agents). Surfaced this in the plan.
- `OverviewBuilder.spawnedByArchitect` exists (api.ts:201), populated from state.db
  (overview.ts:822-828). Good — builder→architect ownership is already on the wire.
- `OverviewData` has NO architect roster. Architects come from `getWorkspaceStatus`
  (terminals filtered by type==='architect', carrying `architectName`). WorkspaceProvider
  already fetches them this way and refreshes on the `architects-updated` SSE event.
- Add Architect command exists today (extension.ts:802) — shells to `client.addArchitect`.
  Issue wants it rewritten to dispatch a message to main via `client.sendMessage('architect:main', ...)`.

Data-source decision for the architect tier (recommended Option A in plan): fetch roster in
BuildersProvider via getWorkspaceStatus + refresh on architects-updated, mirroring
WorkspaceProvider — keeps change VSCode-contained, no OverviewData wire change. Alternative
B (enrich /api/overview with architects) is cleaner single-cache but crosses into area/tower.

Plan written to codev/plans/1104-vscode-merge-architects-builde.md. Awaiting plan-approval gate.

## Plan revision 1 — reviewer chose Option B

Reviewer directed Option B: enrich `/api/overview` with `architects: ArchitectState[]` so the roster
is reusable (dashboard + extension share one cache). Confirmed it's clean: `handleOverview`
(tower-routes.ts:864) already holds `entry.architects`; extract `collectArchitects(entry, manager)`
from the dashboard-state builder (tower-routes.ts:1823-1841) and reuse at both sites (single source
of truth). Add `architects` to OverviewData (types/api.ts), VSCode reads it synchronously off the
overview cache (no extra subscription — cache already refreshes on architects-updated). Add Architect
main-resolve also reads `data.architects` instead of getWorkspaceStatus.

Scope note flagged in plan: now spans packages/types + packages/codev + packages/vscode →
area/cross-cutting may fit better than area/vscode (architect's call). Plan revised + recommitted.

Decision: keep `ArchitectState[]` (not a leaner `string[]`) for shape-parity with
DashboardState.architects + the shared `collectArchitects` helper, even though the Agents tree only
reads `name` today. Reviewer confirmed. Plan already reflects this — no change.

## Implement phase

Plan approved. Two reviewer corrections applied at the start of implement:
1. NO Add Architect `+` on the Agents title bar — a `+` there is ambiguous (add-builder vs
   add-architect). Add Architect stays only in Workspace > Architects.
2. Rename the view ID `codev.builders` → `codev.agents` (not just the label) for consistency.
   Config keys (buildersGroupBy/AutoCollapse/FileViewAsTree) and command ids keep their names —
   only the tree-view id + all `view == codev.builders` when-clauses changed.

Built:
- **Wire (Option B):** `OverviewData.architects: ArchitectState[]`; extracted `collectArchitects`
  in tower-routes.ts, reused by dashboard-state + handleOverview (single source of truth);
  overview.ts defaults `architects: []` (handleOverview injects the live roster like lastDataAt).
- **Agents tree:** `architect-grouping.ts` (pure partition + badge helper), `ArchitectGroupTreeItem`,
  adaptive root in builders.ts (architectCount>1 → architect tier; else today's behaviour bit-for-bit).
  Passive architect → leaf; orphan/stale-owner builders → non-interactive Unassigned bucket;
  3-level getParent chain for reveal; group ids namespaced by architect to avoid collisions.
- **Conversational Add Architect:** `commands/add-architect.ts` (resolveMain + request message),
  extension.ts handler routes to `architect:main` via sendMessage; refuses with modal+CLI fallback
  when no main session.

All green: full build ✓, vscode check-types+lint+522 unit ✓, dashboard 322 ✓, codev 3375 ✓.
Note: the architect-attribution `description` badge is dormant in the nested tree (owner is always
the ancestor) — it only surfaces for stale-owner builders under Unassigned. Working as designed.
Dashboard Agents view is NOT built here (out of scope) — the enrichment just makes the roster
available for future reuse.

## DEV-GATE PIVOT: nested architect tier → flat 3-way group-by toggle

At the dev-approval gate the architect (reviewer) reviewed the running nested-tier tree and
redirected the design. Sequence of decisions:
1. Childless architects in the nested tree duplicated Workspace > Architects → first asked to hide them.
2. Explored alternatives; landed on: builders grouped by EXACTLY ONE axis at a time (stage | area |
   architect), a natural extension of the existing binary stage/area toggle. RETIRE the nested
   architect tier entirely.
3. Custom octopus icon for the architect axis (metaphor: one body, many arms = orchestrating builders).
   Iterated via Playwright-rendered previews (couldn't judge SVG blind). Final: radial 8-arm, no eyes,
   body r3.2, stroke 2.7, MONOCHROME light/dark pair (#1f1f1f / #cccccc) matching codev-light/dark
   convention (reviewer rejected hardcoded purple — must theme-adapt). Files: icons/architect{,-light,-dark}.svg.

Refactor done:
- REMOVED: views/architect-grouping.ts (partitionByArchitect/architectBadge), ArchitectGroupTreeItem,
  multiArchRoot/makeArchitectNode + all tier maps in builders.ts, the adaptive architectCount gate,
  the description badge, the architectName param on BuilderGroupTreeItem. Tests agents-tree.test.ts +
  architect-grouping.test.ts deleted.
- ADDED: architectGrouping() strategy in builder-grouping.ts (group by spawnedByArchitect, main-first,
  Unassigned last; childless architects produce no group = vanish for free; rowPrefix = lifecycle
  stage via stageForPhase). buildersGroupBy enum +'architect'. Three toolbar commands
  (groupBuildersByStage/ByArea/ByArchitect), three view/title buttons with `toggled` clauses keyed off
  the codev.buildersGroupBy context key (active one renders pressed). Octopus is the ByArchitect button
  icon. Architect grouping cases added to builder-grouping.test.ts.

Kept: /api/overview liveArchitects enrichment (still used by conversational Add Architect's
resolveMainArchitect). Workspace > Architects unchanged (the full-roster launch/config home).
Group headers keep the state-rollup glyph in all 3 modes (architect names distinguish architect mode;
octopus lives on the toggle button).

vscode check-types + lint + 512 unit ✓ after refactor.
