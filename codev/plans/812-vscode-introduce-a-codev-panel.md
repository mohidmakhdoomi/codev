# PIR Plan: Codev panel tab (bottom-area view container) scaffolding

## Understanding

The Codev sidebar (`activitybar.codev`) now hosts seven views (Workspace, Builders, Backlog, Pull Requests, Recently Closed, Team, Status — confirmed in `packages/vscode/package.json` `contributes.views.codev`). The narrow-tall sidebar geometry suits some content poorly; the wide-short bottom **panel** area is a better fit for timelines, tabular data, and rosters.

Issue #812 is **scaffolding only**: introduce a panel-side viewsContainer (`codevPanel`) so that follow-up PRs — #813 (Recently Closed), #814 (Team), #815 (Status) — have a container to migrate views into. No existing view moves in this issue. The one piece of runtime content here is a single placeholder view that:
- explains the panel's purpose and points at the follow-up issues, and
- hides itself automatically once real views populate the container (via a `when` context key).

The existing sidebar container and all current views must be untouched (no behavior change).

### Key technical facts confirmed by codebase investigation

- `contributes.viewsContainers` currently has only `activitybar: [{ id: "codev", title: "Codev", icon: "icons/codev.svg" }]` — `packages/vscode/package.json`. Adding a sibling `panel: [...]` is the standard VS Code extension model.
- Views are wired in `src/extension.ts` (~line 326–356) via `createTreeView` (for views needing a live count) or `registerTreeDataProvider` (the rest). The placeholder is static, so `registerTreeDataProvider` matches the lighter views (`codev.workspace`, `codev.team`, `codev.status`).
- Context keys are set with `vscode.commands.executeCommand('setContext', 'codev.<key>', value)` — precedent at `src/extension.ts:168,189,507` (e.g. `codev.teamEnabled`). `when` clauses on views are honored by VS Code (`codev.team` uses `when: "codev.teamEnabled"`).
- TreeDataProvider precedent: `src/views/recently-closed.ts` is a 35-line provider — the placeholder provider mirrors it but returns one static item.
- package.json `contributes` is unit-tested by reading the manifest and asserting structure — precedent: `src/__tests__/contributes-walkthroughs.test.ts`, `contributes-commands.test.ts`.

### Note on `visibility: 'collapsed'`

In the VS Code contribution schema, `visibility` is a property of an individual **view** object (values `visible | hidden | collapsed`), not of a viewsContainer. The acceptance criterion "container starts collapsed" is satisfied two ways, both of which hold here:
1. Contributing a panel viewsContainer does **not** auto-open the bottom panel — the tab simply appears; the panel only expands when the user clicks it. So existing installs are not surprised with popped-open content on upgrade.
2. The placeholder view itself is declared with `"visibility": "collapsed"` so that even once the panel is opened, the section is collapsed until the user expands it.

The standard toggle command `workbench.view.extension.codevPanel` is generated automatically by VS Code from the container id `codevPanel` — no manual command contribution needed (acceptance criterion 6 is satisfied for free; we add a test asserting the id so the command name is stable).

## Proposed Change

### 1. `packages/vscode/package.json` — manifest contributions

Add a `panel` array to `contributes.viewsContainers`:

```jsonc
"viewsContainers": {
  "activitybar": [ { "id": "codev", "title": "Codev", "icon": "icons/codev.svg" } ],
  "panel": [ { "id": "codevPanel", "title": "Codev", "icon": "icons/codev.svg" } ]
}
```

Add a `codevPanel` array to `contributes.views` with the single placeholder, gated by the empty-container context key and collapsed by default:

```jsonc
"views": {
  "codev": [ /* unchanged */ ],
  "codevPanel": [
    { "id": "codev.placeholder", "name": "Codev", "when": "codev.panelContainerEmpty", "visibility": "collapsed" }
  ]
}
```

### 2. `packages/vscode/src/views/panel-placeholder.ts` — new provider

A minimal `TreeDataProvider<vscode.TreeItem>` returning one item whose label/tooltip carries the guidance text:

> Codev panel views land here. See issues #813 (Recently Closed), #814 (Team), #815 (Status).

Static (no cache subscription); mirrors the shape of `recently-closed.ts`.

### 3. `packages/vscode/src/extension.ts` — register + context key

- Set the context key once at activation, near the other early `setContext` calls (~line 168/189), before any panel view registers:
  `vscode.commands.executeCommand('setContext', 'codev.panelContainerEmpty', true);`
  This makes the placeholder's `when` resolve true today. Follow-up PRs that add real panel views will flip this to `false`, auto-hiding the placeholder (acceptance criterion 4).
- Register the provider alongside the other `registerTreeDataProvider` calls (~line 353–355):
  `vscode.window.registerTreeDataProvider('codev.placeholder', new PanelPlaceholderProvider()),`

### 4. Tests

- `src/__tests__/contributes-panel.test.ts` (new) — reads `package.json` and asserts:
  - `viewsContainers.panel` contains `{ id: 'codevPanel', title: 'Codev', icon: 'icons/codev.svg' }`;
  - the activitybar container is unchanged (id `codev`, title `Codev`);
  - `views.codevPanel` contains exactly the `codev.placeholder` view, gated by `when: 'codev.panelContainerEmpty'` and `visibility: 'collapsed'`;
  - `views.codev` (sidebar) still lists the seven existing views (regression guard against accidental edits).
- `src/__tests__/panel-placeholder.test.ts` (new) — instantiates `PanelPlaceholderProvider`, asserts `getChildren()` returns one item whose text references #813/#814/#815.
- Extend `src/__tests__/extension-architect-commands.test.ts` (or add to the new contributes test) with a source assertion that `extension.ts` sets `codev.panelContainerEmpty` and registers `codev.placeholder` — matching the existing `EXT_SRC`-grep style so the wiring can't silently regress.

## Files to Change

- `packages/vscode/package.json` — add `viewsContainers.panel` entry and `views.codevPanel` placeholder view.
- `packages/vscode/src/views/panel-placeholder.ts` — **new**; `PanelPlaceholderProvider` returning one guidance tree item.
- `packages/vscode/src/extension.ts` — set `codev.panelContainerEmpty` context key at activation; register `codev.placeholder` provider.
- `packages/vscode/src/__tests__/contributes-panel.test.ts` — **new**; manifest invariants.
- `packages/vscode/src/__tests__/panel-placeholder.test.ts` — **new**; provider returns guidance item.

## Risks & Alternatives Considered

- **Risk: panel auto-opens on upgrade, surprising users.** Mitigation: contributing a panel container does not expand the panel; the placeholder view is also `visibility: collapsed`. Verified at the `dev-approval` gate by launching the Extension Development Host and confirming the bottom panel stays closed until clicked.
- **Risk: `when` key never set / placeholder never shows (or shows forever).** Mitigation: context key set unconditionally at activation; tests assert both the manifest `when` and the `setContext` call. Follow-ups own flipping it false.
- **Risk: title collision between sidebar "Codev" and panel "Codev".** Per VS Code, containers are disambiguated by location (activitybar vs panel); no UI collision. Container **ids** differ (`codev` vs `codevPanel`), which is what matters for the generated `workbench.view.extension.<id>` command.
- **Alternative: `contributes.viewsWelcome` instead of a TreeDataProvider placeholder.** Rejected — the issue specifies a TreeDataProvider returning a single item, and the welcome-view content model is harder to test and to auto-hide via a context key.
- **Alternative: omit `visibility: collapsed` and rely solely on the panel not auto-opening.** Rejected — adding it is belt-and-suspenders for the "no surprise" criterion and is explicitly named in the issue.

## Test Plan

- **Unit**: `pnpm --filter @cluesmith/codev-vscode test` (or the package's test script) — new manifest + provider tests pass; existing contributes/extension tests still pass.
- **Build**: package compiles (`pnpm build` / tsc) with no type errors from the new provider and registration.
- **Manual (at `dev-approval`, Extension Development Host — F5 from `packages/vscode`)**:
  - On first load after activation, the bottom panel is **not** auto-opened; a "Codev" tab is present in the panel tab strip next to Problems/Output/Terminal.
  - Running the command palette → `View: Show Codev` for the panel (or `workbench.view.extension.codevPanel`) opens the panel tab and shows the single placeholder row with the #813/#814/#815 guidance text.
  - The existing activitybar Codev sidebar is unchanged — all seven views present and behaving as before.
  - Toggling the panel tab open/closed works via the standard panel UI.
- **Cross-platform**: N/A (VS Code desktop extension; no OS-specific code paths touched).
