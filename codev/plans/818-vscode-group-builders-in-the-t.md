# PIR Plan: Group Builders Tree by Area

## Understanding

The VSCode `Codev: Builders` tree (`packages/vscode/src/views/builders.ts:89`) is a flat list today. With multiple builders running across product surfaces (vscode, tower, porch, terminal, etc.), engineers can't see "what's running on `vscode` right now" without scanning every row's title. The `area/*` GitHub label namespace — already plumbed onto `OverviewBuilder.area` by the merged #819 — is the right axis: it mirrors how work is coordinated and matches the upcoming backlog grouping (#811) so engineers learn one mental model.

The wire field already exists. `OverviewBuilder.area: string` is **required-with-default** (`'Uncategorized'` when the builder has no issue or the issue has no `area/*` labels). The literal `'Uncategorized'` is exported as `UNCATEGORIZED_AREA` from `@cluesmith/codev-core/constants`. This change is therefore confined to the VSCode package: rendering, toggling, ordering, tests.

### Inheritance from #819 — what this plan does NOT re-litigate

Issue #818's original description was written before #819's design converged. Two reconciliations matter:

1. **`area` is a single string (`builder.area`), not an array.** The original spec proposed `BuilderOverview.areas: string[]` consumed via `parseAreaLabels`. The shipped contract is the single-string projection from `parseArea` (first-alphabetical wins). Each builder lives in exactly one area; the grouping layer doesn't see raw labels.

2. **`area/cross-cutting` has no parser-level privilege.** #819's final design dropped the "cross-cutting takes precedence" rule from the parser — it's now policy-free about label names. A builder tagged `[area/cross-cutting, area/vscode]` is projected to `'cross-cutting'` only because `'c'` < `'v'` alphabetically; tagged `[area/auth, area/cross-cutting]` it's projected to `'auth'`.

   #818's original "If `area/cross-cutting` is present → place under cross-cutting exclusively" rule cannot be honoured at the *resolution* layer without re-extending the wire to carry raw labels (and re-introducing the policy the #819 review deliberately removed). This plan honours the rule's *intent* at the **group-ordering** layer instead: when a `cross-cutting` group exists (because at least one builder has `area === 'cross-cutting'`), its header sorts first. The "exclusivity" property is enforced by the parser — each builder belongs to exactly one group regardless. Teams that want every multi-area builder to land in `cross-cutting` should tag them with `area/cross-cutting` *only* (the #819 convention).

   If we want stronger cross-cutting privilege later, that's a separate change to `parseArea` (not to this view). Flagged in **Risks** below.

The "byte-identical to #811" acceptance criterion translates to: both views use the same `area` projection + the same group-ordering rule (extracted as a shared helper so the code itself is shared, not just the spec).

## Proposed Change

### 1. Shared helper in core: `sortAreaGroups`

Extract one small pure function to `@cluesmith/codev-core` so #811's backlog grouping (and any dashboard equivalent) can reuse the same code, not just the same prose.

```ts
// packages/core/src/area-grouping.ts (new)
import { UNCATEGORIZED_AREA } from './constants.js';

/**
 * Sort area group names per the canonical Codev convention:
 *  1. `cross-cutting` first (when present) — coordination-risk surface
 *  2. alphabetical middle
 *  3. `UNCATEGORIZED_AREA` (`'Uncategorized'`) last
 *
 * Pure — operates on a list of distinct area names (typically the keys
 * of a Map<area, items[]>). Used by both the Builders view (#818) and
 * the Backlog view (#811) so engineers learn one mental model.
 */
export function sortAreaGroups(areas: string[]): string[] { ... }
```

Re-exported from the package barrel alongside `isIdleWaiting`.

### 2. Grouping mode in `BuildersProvider`

`BuildersProvider.getChildren()` gains a top-level branch on `codev.buildersGroupByArea`:

- **Off** (today's behaviour): root returns ordered builder rows directly. Zero diff to existing UX.
- **On**: root returns `BuilderAreaGroupTreeItem[]` (the group headers); each group's `getChildren` returns the builders mapped into that group (already in `orderForDisplay` order).

Mapping algorithm:

```ts
const ordered = orderForDisplay(data.builders, now);  // unchanged
const byArea = new Map<string, OverviewBuilder[]>();
for (const b of ordered) {
  const list = byArea.get(b.area) ?? [];
  list.push(b);
  byArea.set(b.area, list);
}
const areaOrder = sortAreaGroups([...byArea.keys()]);
return areaOrder.map(area => new BuilderAreaGroupTreeItem(area, byArea.get(area)!));
```

Map iteration preserves insertion order → within-group order preserves `orderForDisplay()`'s blocked → idle-waiting → active sequence (acceptance criterion).

**Empty groups are not rendered** — only areas with ≥1 builder appear. The issue's mock shows `Uncategorized (0)` as a teaching device; rendering empty groups is noise in practice. Easy to flip if the reviewer prefers always-show-Uncategorized.

### 3. New tree item: `BuilderAreaGroupTreeItem`

`packages/vscode/src/views/builder-area-group-tree-item.ts` (new file, follows the existing one-file-per-TreeItem-subclass convention used by `BuilderTreeItem`, `BuilderFileTreeItem`, `BuilderFolderTreeItem`):

- Label: `<area> (<count>)` — e.g. `vscode (4)`
- Stable `id`: `area-group:<area>` — so VSCode persists expand/collapse state per-group across reloads (acceptance criterion)
- `collapsibleState`: `Expanded` by default (first-time render); VSCode replaces this with the persisted state on subsequent renders via the stable `id`
- `contextValue`: `builder-area-group` (lets us hang future per-group context-menu actions off it without touching the row-level menus)
- Carries the resolved `OverviewBuilder[]` for its area so `getChildren(group)` doesn't recompute the bucket

### 4. `getParent` for `reveal()`

The auto-collapse accordion (`extension.ts:312`) calls `buildersView.reveal(builderItem, { expand: 3 })`. `reveal()` requires `getParent` to return the parent chain. Today `getParent()` returns `undefined` for everything — fine because builder rows are roots.

With grouping on, builder rows are no longer roots. `getParent` must return the appropriate `BuilderAreaGroupTreeItem` for any `BuilderTreeItem`. Implementation: keep a `Map<builderId, BuilderAreaGroupTreeItem>` on the provider, populated each time `getChildren(root)` runs in grouping mode. (Group items, file items, folder items continue to return `undefined` — they're either roots themselves or never reveal targets.)

Without this, the accordion's `reveal()` in grouping mode would silently fail to expand the builder after the `collapseAll` half of the swap. With it, accordion behavior is identical in both modes.

### 5. Config flag + toggle commands

Mirror the existing `buildersFileViewAsTree` pattern exactly:

**`packages/vscode/package.json`** — declare:

```jsonc
// contributes.commands
{ "command": "codev.enableBuildersGroupByArea",  "title": "Codev: Group Builders by Area",       "icon": "$(group-by-ref-type)" },
{ "command": "codev.disableBuildersGroupByArea", "title": "Codev: Show Builders as Flat List",   "icon": "$(list-flat)" },

// contributes.menus.view/title
{ "command": "codev.disableBuildersGroupByArea", "when": "view == codev.builders && codev.buildersGroupByArea",  "group": "navigation" },
{ "command": "codev.enableBuildersGroupByArea",  "when": "view == codev.builders && !codev.buildersGroupByArea", "group": "navigation" },

// contributes.configuration.properties
"codev.buildersGroupByArea": {
  "type": "boolean",
  "default": true,
  "description": "Group the Builders tree by area/* label (cross-cutting first, alphabetical middle, Uncategorized last). When off, renders as a flat list."
}
```

**`packages/vscode/src/extension.ts`** — register the two commands (paired with the existing `enableBuildersFileTreeMode` / `disableBuildersFileTreeMode` pair around line 609) and a `setContext` mirror + `onDidChangeConfiguration` listener that calls `buildersProvider.refresh()` on flip (paired with the existing `buildersFileViewAsTree` block around lines 330-339).

Default `true` is safe even for repos without `area/*` labels: every builder projects to `'Uncategorized'`, so the tree renders as a single `Uncategorized (N)` group containing the same builders in the same order — functionally identical to flat. Engineers who actively prefer flat can flip the toggle.

### 6. Tests

Extend `packages/vscode/src/test/builders.test.ts` with a `groupBuildersByArea` suite (testing the pure mapping function extracted alongside the rendering) and a `sortAreaGroups` suite (covering the cross-cutting/alphabetical/Uncategorized ordering — owned by core but exercised here too since the integration matters).

Core unit tests for `sortAreaGroups` go in `packages/core/src/__tests__/area-grouping.test.ts` alongside the existing core tests.

### 7. Out of scope (preserve issue's contract)

- Grouping by `type:*` / `priority:*` / any non-area axis (the issue is explicit).
- Duplicating a builder across multiple area groups (the parser projects to one — `cross-cutting` tag is the explicit answer).
- Per-builder user-pickable primary area override (deferred).
- Backlog grouping (#811's job, but the shared `sortAreaGroups` helper unblocks it).
- Dashboard equivalent of grouping (no existing dashboard consumer of `builder.area` — separate change).

## Files to Change

- `packages/core/src/area-grouping.ts` — **new**, exports `sortAreaGroups(areas: string[]): string[]` and (optionally) `groupBuildersByArea` if we keep the mapping logic shared between dashboard and vscode; otherwise keep mapping in vscode only.
- `packages/core/src/index.ts` (or barrel) — re-export `sortAreaGroups`.
- `packages/core/src/__tests__/area-grouping.test.ts` — **new**, unit tests for `sortAreaGroups` (empty input, cross-cutting present/absent, Uncategorized handling, alphabetical sort, deduplication).
- `packages/vscode/src/views/builder-area-group-tree-item.ts` — **new** TreeItem subclass; carries `area`, `builders: OverviewBuilder[]`, stable id, label `<area> (<count>)`.
- `packages/vscode/src/views/builders.ts` — extend `BuildersProvider`:
  - `getChildren(root)`: branch on `codev.buildersGroupByArea` config; when on, build the `Map<area, OverviewBuilder[]>`, sort keys via `sortAreaGroups`, return group items.
  - `getChildren(BuilderAreaGroupTreeItem)`: return the group's builders, rendered with the existing per-builder logic refactored into a `renderBuilderRow(b, isBlocked, isIdle, ...)` helper to avoid duplication.
  - `getParent`: return the cached group for any `BuilderTreeItem` when in grouping mode; `undefined` otherwise.
  - Private `groupCache: Map<builderId, BuilderAreaGroupTreeItem>` populated on each root render.
- `packages/vscode/src/extension.ts:600` area — register `codev.enableBuildersGroupByArea` / `codev.disableBuildersGroupByArea`; add a `readGroupByArea()` + `setContext('codev.buildersGroupByArea', ...)` mirror + an `onDidChangeConfiguration('codev.buildersGroupByArea')` handler that calls `buildersProvider.refresh()`.
- `packages/vscode/package.json` — add the two commands, the two `view/title` menu entries, and the `codev.buildersGroupByArea` config property.
- `packages/vscode/src/test/builders.test.ts` — add `suite('groupBuildersByArea')` (within-group preserves `orderForDisplay`, mapping accuracy, count fields) and `suite('sortAreaGroups')` (cross-cutting first, alphabetical, Uncategorized last).

## Risks & Alternatives Considered

### Risks

- **`reveal()` regression in grouping mode**: If `getParent` doesn't return the right group, the accordion's `collapseAll + reveal` will fail to re-expand the builder after a click. Mitigation: cache the `builderId → group` map at root-render time; assert via an integration smoke test (manual at the `dev-approval` gate).
- **Expand state divergence between modes**: The stable id `area-group:<area>` persists per group; builder ids persist per builder. When the user toggles off and back on, VSCode restores whichever state it remembers per id. Acceptable — same model as the existing file-view-as-tree toggle.
- **Empty `Uncategorized` group**: When grouping is on and no builder lacks an area, no `Uncategorized` row renders. The issue's mock shows `Uncategorized (0)` as a teaching aid; I've chosen "render only non-empty groups" as the cleaner default. Reviewer can flip this preference at the `plan-approval` gate.
- **Default `true` is a UX change**: Existing users will see grouping appear on next launch. Mitigation: in single-area repos (Codev's own) everything lands under one group (e.g. `vscode (4)`) — visually similar to flat. Engineers who want true flat can flip the toggle.

### Alternatives Considered

- **Re-extend the wire to carry raw labels and re-implement cross-cutting privilege at the view layer.** Rejected: #819 deliberately removed the privilege from the parser; re-adding it at one consumer (vscode) without the parser (and without the backlog/dashboard consumers) creates inconsistency. If the privilege is wanted, the right move is reopening the policy discussion against `parseArea`.
- **Don't extract `sortAreaGroups` — duplicate the sort in vscode and in #811 later.** Rejected: the acceptance criterion explicitly calls out "byte-identical resolution rule" — the cheapest enforcement is one shared function. The extraction is ~10 LOC.
- **Default the toggle to `false` for a quieter rollout.** Rejected: the issue explicitly specifies `true` ("since the area-label set is established"). Reviewer can override at the `plan-approval` gate.
- **Always render every area group, including empties.** Rejected as default for the noise reason above; flip if review prefers.

## Test Plan

### Unit (CI + local `pnpm test`)

- `packages/core/src/__tests__/area-grouping.test.ts`:
  - empty input → empty output
  - `['vscode', 'tower', 'porch']` → alphabetical
  - `['vscode', 'cross-cutting', 'tower']` → cross-cutting first, then alphabetical
  - `['vscode', 'Uncategorized', 'tower']` → alphabetical then Uncategorized last
  - `['vscode', 'cross-cutting', 'Uncategorized', 'tower']` → all three rules at once
  - deduplication (defensive — caller may pass a non-unique list)
- `packages/vscode/src/test/builders.test.ts`:
  - `groupBuildersByArea`: each builder lands in exactly one group; within-group order preserves `orderForDisplay()` semantics (mix blocked + idle + active in two areas; verify per-area sequence)
  - count per group reflects the number of builders

### Manual (`dev-approval` gate)

The reviewer runs the worktree via `afx dev pir-818` and exercises:

- **Grouping on (default)**: open the Codev sidebar → Builders. Verify group headers render as `<area> (<count>)`. Verify cross-cutting (if any) sorts first, alphabetical middle, Uncategorized last.
- **Toggle off**: click the title-bar `Codev: Show Builders as Flat List` button. Verify the tree flattens to the existing-today layout. Verify the title-bar icon swaps to the "group" affordance.
- **Toggle on**: click the swapped button. Verify groups reappear; verify each group's expand/collapse state survives a sidebar hide/show.
- **Accordion in grouping mode**: with `buildersAutoCollapse` on, expand one builder's changed-files diff. Verify other builders (in same and other groups) auto-collapse. Verify the expanded builder remains expanded.
- **Reload**: close and reopen the VSCode window. Verify per-group expand/collapse state persists.
- **Zero `area/*` labels case**: there's no easy way to fake this without editing issue labels, but it's covered by unit tests. If reviewer wants to exercise manually, change all open issues' `area/*` labels temporarily.

### Cross-cutting

N/A — VSCode-only change, no cross-platform surface.
