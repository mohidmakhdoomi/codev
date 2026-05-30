# PIR Plan: Move Pull Requests below Backlog in the VSCode sidebar default order

## Understanding

The Codev VSCode sidebar (`codev` view container) declares its tree views in a fixed contribution order in `packages/vscode/package.json`. Today the order is:

```
Workspace → Builders → Pull Requests → Backlog → Recently Closed → Team → Status
```

Issue #932 asks to swap **Pull Requests** and **Backlog** so the default order becomes:

```
Workspace → Builders → Backlog → Pull Requests → Recently Closed → Team → Status
```

The rationale (from the issue): the active triage flow is `Builders → Backlog` (what's in flight, then what's next to start), so those two surfaces should sit adjacent. Pull Requests is a downstream / completion-side surface that reads better next to Recently Closed at the bottom.

This is purely a default-order change in the view contribution array. VSCode persists user-reordered views per-workspace; the contribution-declared order only applies until a user manually drags a view. So users who have already customized their order keep it — only fresh installs / un-customized users see the new default.

## Proposed Change

Swap the two object entries in the `contributes.views.codev` array in `packages/vscode/package.json` so `codev.backlog` precedes `codev.pullRequests`. No other lines change.

This is the minimal, correct change. The views themselves, their `when` clauses, menu contributions, and view providers are all keyed by view `id` — none of which change — so reordering the declaration array has no effect beyond the default display order.

## Files to Change

- `packages/vscode/package.json:543-544` — swap the `codev.pullRequests` and `codev.backlog` entries within the `contributes.views.codev` array.

Before:
```jsonc
{ "id": "codev.pullRequests", "name": "Pull Requests" },
{ "id": "codev.backlog", "name": "Backlog" },
```

After:
```jsonc
{ "id": "codev.backlog", "name": "Backlog" },
{ "id": "codev.pullRequests", "name": "Pull Requests" },
```

## Risks & Alternatives Considered

- **Risk: users with customized order are disrupted.** Mitigated by VSCode's per-workspace view-order persistence — the contributed order is only the default and is overridden the moment a user drags any view. No migration needed. (Called out explicitly in the issue's acceptance criteria.)
- **Risk: ordering is actually controlled somewhere other than `package.json` (e.g. programmatic `TreeView` registration order).** Investigated: the views are contributed declaratively via `contributes.views.codev`; the registration order in the array is the source of the default order. No programmatic ordering layer exists. Confirmed the only relevant block is at `package.json:541-547`.
- **Alternative: add an explicit `order` / sort key.** Rejected — VSCode view contributions use array position for default order; there is no per-view `order` field for this, and introducing any sort indirection would be over-engineering for a two-element swap.

## Test Plan

This change has no runtime logic, so verification is visual + a JSON-validity guard.

- **Build / lint**: `pnpm --filter @cluesmith/codev-vscode build` (or the package's configured build) succeeds — confirms `package.json` is still valid JSON and the manifest parses. Run whatever the package's check block specifies.
- **Manual (VSCode)**: Load the extension in an Extension Development Host (or install the packaged `.vsix`) in a *fresh* profile (no prior view customization). Open the Codev sidebar and confirm the section order top-to-bottom is: Workspace, Builders, **Backlog**, **Pull Requests**, Recently Closed, Team (if enabled), Status.
- **Manual (regression — customized users)**: In a profile where views were previously dragged into a custom order, confirm the custom order is preserved after the update (the new default does not override it).
- **Cross-platform**: N/A — pure manifest ordering, identical across OSes.
