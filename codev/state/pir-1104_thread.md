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
