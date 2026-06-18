# PIR Plan: Builders accordion stops touching area-group headers; group expansion becomes ephemeral

## Understanding

Issue #913 has two joined problems in the VSCode Builders tree:

1. **The accordion collapses the whole tree.** Expanding one builder fires the accordion handler (`packages/vscode/src/extension.ts:459-479`), which runs `workbench.actions.treeView.codev.builders.collapseAll` and then re-reveals the clicked builder with `expand: 3`. `collapseAll` is tree-wide: it collapses the area/stage group headers too. The reveal re-expands only the group containing the clicked builder; every other group stays visibly collapsed.

2. **That collapse gets persisted.** `persistAreaGroupExpansion` (`packages/vscode/src/views/area-group-expansion.ts:54-71`) listens to `onDidCollapseElement` with no way to distinguish a user chevron-click from the programmatic `collapseAll`, so every accordion fire writes `false` for every group into `workspaceState`. The collapsed state then survives window reloads.

**Code drift since the issue was filed**: #952 split the Builders view into two grouping axes (stage, the default, and area), each with its own persisted store:

- `codev.buildersStageGroupExpansion` (stage axis, new in #952)
- `codev.buildersGroupExpansion` (area axis, the key named in the issue)

Both are `AreaGroupExpansionStore` instances created in `BuildersProvider` (`packages/vscode/src/views/builders.ts:111-114`), routed through the `expansion` wrapper (`builders.ts:95-98`), and wired to the view at `extension.ts:346-348`. The issue's "drop persistence in the Builders view" principle applies equally to both axes, so this plan removes both keys. Backlog's store (`codev.backlogGroupExpansion`, wired at `extension.ts:352-354`) is untouched.

**Two VSCode platform facts the design rests on** (both already relied on by existing code comments):

- VSCode preserves expand/collapse state *in-session* per `TreeItem.id`: when an item with a known id re-renders, the provider's `collapsibleState` is ignored. This is why the overview-poll refresh does not reset the tree today.
- VSCode does *not* restore contributed-tree expansion across window reloads; that is exactly why `AreaGroupExpansionStore` was built in the first place. So once our store is gone, groups render from the provider's default (Expanded) on every fresh session.
- The flip side of the first fact gives us programmatic collapse: VSCode has no "collapse this item" API, but an item whose `id` *changes* is treated as brand new and rendered with the provider's `collapsibleState`. Builder rows always render `Collapsed` (`builders.ts:240`), so changing a builder row's id collapses it.

## Proposed Change

### 1. Accordion: replace `collapseAll` + reveal with a generation-salted row id

A collapsed-by-accordion row must never render under a previously-used id (VSCode would resurrect the remembered "expanded" state for that id), so the salt has to be sticky. A single monotonic generation counter achieves that with three scalars and no per-builder map. Add to `BuildersProvider`:

- private state: `gen` (monotonic counter, starts at 0), `openBuilderId` and `openGen` (the one builder allowed to stay expanded, and the generation its row id is pinned to);
- a public `collapseBuildersExcept(item: BuilderTreeItem): void` that pins `openBuilderId` to the clicked builder, pins `openGen` to the generation parsed from the clicked element's rendered id (bulletproof against a render landing between bump and click), bumps `gen`, then fires the change emitter;
- `makeBuilderRow` renders `item.id` as `${b.id}#${openGen}` for the open builder and `${b.id}#${gen}` for every other builder.

Effect: on the next render, every builder row except the open one carries a new id, so VSCode renders it with the provider's `Collapsed` state. The clicked builder keeps its id, so its expanded state (and its file-tree's per-folder expansion, whose ids are keyed by `builderId`, not the row id: `builder-folder-tree-item.ts:23`) is untouched. Group headers never carry a generation suffix: their ids stay `builder-group:<name>`, so the refresh re-renders them in place and VSCode keeps whatever state they are in, satisfying acceptance criterion 1 for any group in any state. The mechanism is level-agnostic, so the single-`Uncategorized` flatten case (builders at root, no groups) works through the same code path with nothing special.

The accordion handler in `extension.ts` becomes synchronous and much smaller:

- keep the `accordionOn` config read, the context-key mirror, and the `openBuilderId` guard (it still suppresses the re-fired expand event from `openBuilderRow`'s `reveal`);
- drop the `reconciling` flag (no more await chain to debounce);
- drop the `collapseAll` command and the `reveal(e.element, { expand: 3 })` repair call. The repair existed only to undo `collapseAll`'s damage to folder rows; with salting, nothing under the clicked builder is ever collapsed.

Because the bump re-ids every builder except the open one (rather than only the previously-open builder), the handler is self-healing: if several builders are open because the accordion was just toggled on, the first expand collapses all of them. Re-iding an already-collapsed row is visually a no-op.

### 2. Group expansion: delete persistence for the Builders view

- `builder-grouping.ts`: remove the `expansion` field from `BuilderGrouping` and the parameter from `stageGrouping()` / `areaGrouping()`. The strategies keep bucketing, row prefix, and flatten rule.
- `builders.ts`: remove the two `AreaGroupExpansionStore` instances, the `expansion` routing wrapper, and the `workspaceState` constructor parameter. `rootChildren()` renders every group header `Expanded` unconditionally. In-session collapse memory is VSCode's native per-id behavior (group ids are stable within a session), so a user-collapsed group stays collapsed until reload with zero code on our side.
- `extension.ts:346-348`: delete the `persistAreaGroupExpansion(buildersView, ...)` wiring and the now-unused `BuilderGroupTreeItem` import (`extension.ts:38`). Backlog's wiring stays.
- One-shot cleanup: on activation, delete both stale keys with `context.workspaceState.update('codev.buildersGroupExpansion', undefined)` and the same for `codev.buildersStageGroupExpansion`. Updating to `undefined` removes the key; running it on every activation is idempotent and simpler than tracking a "done once" flag, and satisfies "stored value is deleted on activation".

`area-group-expansion.ts` itself is unchanged (Backlog still uses both the store and `persistAreaGroupExpansion`).

## Files to Change

- `packages/vscode/src/views/builders.ts`: add the `gen` / `openBuilderId` / `openGen` state and `collapseBuildersExcept`; generation-suffixed `item.id` in `makeBuilderRow`; remove `expansion` wrapper, store instances, and `workspaceState` ctor param; render groups always Expanded (`builders.ts:202-208` collapses to a constant); update class docblock (lines 76-79) which documents the persistence being removed.
- `packages/vscode/src/views/builder-grouping.ts`: drop `expansion` from the `BuilderGrouping` interface and from both strategy factories.
- `packages/vscode/src/extension.ts`: drop builders `persistAreaGroupExpansion` wiring (346-348) and `BuilderGroupTreeItem` import (38); add two-key workspaceState cleanup near provider construction; rewrite the accordion block (442-485) to call `buildersProvider.collapseBuildersExcept(...)`; update `BuildersProvider` construction (344) for the removed parameter.
- `packages/vscode/src/__tests__/builder-grouping.test.ts`: remove the `fakeStore` plumbing and the "exposes the passed expansion store" assertions.
- `packages/vscode/src/__tests__/builders-accordion.test.ts`: new unit test (vitest, `vi.mock('vscode')` per the existing `__tests__` pattern): after `collapseBuildersExcept(x)`, rendered ids change for all builders except `x`, `x`'s id is stable, group ids are stable; a builder collapsed by an earlier fire never reuses a previously-rendered id; the change event fires; group headers always render Expanded.

## Risks & Alternatives Considered

- **Risk**: the premise "VSCode does not persist contributed-tree expansion across reloads" could be wrong on some VSCode version, which would leave groups collapsed after reload despite our store being gone. Evidence it is right: `AreaGroupExpansionStore` was purpose-built for cross-reload persistence. Mitigation if dev-approval testing disproves it: salt the Builders group ids with a per-activation nonce so every session's groups are new items (in-session stability preserved, cross-session memory defeated). Not implemented unless observed.
- **Risk**: id churn on builder rows. The row id's two documented jobs (`builders.ts:233-235`) are poll-refresh expansion stability and accordion targeting. Salts only change on accordion fires, so poll-refresh stability holds between fires; accordion targeting by id is gone entirely (the clicked row is reached via its item instance in `openBuilderRow`'s `reveal`, unchanged).
- **Alternative: snapshot and restore around `collapseAll`** (issue option a): keep `collapseAll`, then re-reveal each previously-expanded group. Rejected: groups still visibly flap collapsed-then-open on every accordion fire, the persist listener (or its in-memory successor) sees spurious collapse events that need guarding, and the await chain keeps the `reconciling` complexity. Strictly more moving parts for a worse visual result.
- **Alternative: collapse other builders individually via reveal** (issue option b): impossible; the TreeView API has `reveal` with `expand` but no collapse direction.
- **Alternative: keep an in-memory expansion store** for groups. Redundant; VSCode's native per-id in-session memory already provides exactly the wanted semantics once persistence is removed.
- **Alternative: a per-builder salt map** (`Map<string, number>`) instead of the single generation counter. Functionally equivalent but carries per-row state that the generation scheme makes unnecessary; rejected during plan review.

## Test Plan

Unit (run in `packages/vscode/`: `pnpm vitest run`):

- updated `builder-grouping.test.ts` still pins bucketing/prefix/flatten per axis;
- new `builders-accordion.test.ts` pins the salting contract and always-Expanded groups as described above.

Manual (dev-approval gate; build with `pnpm build` then `pnpm -w run local-install`, or F5 Extension Development Host):

1. With builders spread across at least two groups: expand builder A in group one. Expect: the previously-open builder collapses; **no group header collapses**; A's file tree stays expanded.
2. Manually collapse group two, then expand a builder in group one. Expect: group two stays collapsed (accordion never touches it).
3. Collapse a group, then Developer: Reload Window. Expect: **all** Builders groups render expanded.
4. Repeat 1-3 in the other grouping mode (toggle stage/area via the title-bar button).
5. Toggle the accordion off (title-bar button): expanding two builders leaves both open. Toggle back on: next expand collapses all others.
6. Backlog regression: collapse a Backlog group, reload. Expect: still collapsed (its persistence is untouched).
7. Prior-install cleanup: with a workspace that has stale `codev.buildersGroupExpansion` state (any workspace used before this change), confirm after reload that groups are expanded and stay expanded across further reloads.
