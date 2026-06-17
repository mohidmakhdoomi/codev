# pir-913 thread

## Plan phase

Investigated issue #913 (Builders accordion collapses area-group headers; group expansion wrongly persisted).

Key findings beyond the issue text:

- Code drifted since filing: #952 added a second grouping axis (stage, now the default) with its own persisted key `codev.buildersStageGroupExpansion` alongside the issue's `codev.buildersGroupExpansion`. Plan removes persistence for both axes; Backlog's key stays.
- VSCode has no per-item collapse API, but changing a `TreeItem.id` makes VSCode treat the row as new and honor the provider's `Collapsed` state. Plan replaces the tree-wide `collapseAll` + reveal-repair with per-builder id salting (`collapseBuildersExcept` on the provider). Groups are never touched; the `reveal(expand:3)` folder-repair and the `reconciling` debounce become unnecessary.
- In-session group collapse memory comes free from VSCode's native per-id behavior, so no in-memory store replaces the deleted persisted one. Cross-reload defaults to expanded because contributed trees don't persist expansion natively (that's why the store existed).

Plan written to `codev/plans/913-vscode-accordion-shouldn-t-aff.md`. Sitting at plan-approval gate.

Plan-approval feedback: dropped the per-builder salt map in favor of a single monotonic `gen` counter + `openBuilderId`/`openGen` pin (architect questioned why a map was needed). Revised and re-pushed before approval.

## Implement phase

Plan approved. Implemented:

- `builder-grouping.ts`: dropped the `expansion` field from `BuilderGrouping` and both strategy factories (`stageGrouping()` / `areaGrouping()` now take no args).
- `builders.ts`: added `gen`/`openBuilderId`/`openGen` + `collapseBuildersExcept(item)`; `makeBuilderRow` renders `item.id = ${b.id}#${gen}` (open builder pinned to `openGen`); `rootChildren` renders groups always Expanded; removed the expansion store/wrapper and the `workspaceState` ctor param; added exported `generationOf` helper (guards empty/non-numeric suffix).
- `extension.ts`: removed `BuilderGroupTreeItem` import + builders `persistAreaGroupExpansion` wiring; one-shot cleanup deletes both `codev.buildersGroupExpansion` and `codev.buildersStageGroupExpansion` on activation; rewrote the accordion handler to be synchronous and call `collapseBuildersExcept` (no more `collapseAll`, `reveal(expand:3)`, or `reconciling`).
- Tests: trimmed `builder-grouping.test.ts`; new `builders-accordion.test.ts` (7 cases) pinning the salting contract + always-Expanded groups + `generationOf`.

Note: building requires `packages/core` and `packages/types` to be built first (their `dist/` was empty in the fresh worktree) — `tsc` subpath exports don't resolve otherwise. `pnpm compile` (check-types + lint + esbuild) green; `pnpm test:unit` 390/390 green.

One thing for the human to eyeball at dev-approval: `collapseBuildersExcept` fires the tree-data change event synchronously from inside the `onDidExpandElement` handler (during `openBuilderRow`'s `reveal`). Behaves correctly in tests/logic, but worth a visual check that the open builder's file tree doesn't flicker.

Sitting at dev-approval gate.

Dev-approval feedback: architect disliked the loose `gen`/`openBuilderId`/`openGen` fields + the `generationOf` string parser. Refactored into a single `AccordionRowIds` class that stores the open row's literal id (no number reconstruction → no parser, more robust against stale-version races). Behavior identical; all accordion tests pass unchanged, `generationOf` tests replaced by direct `AccordionRowIds` unit tests. dev-approval then approved.

## Review phase

Wrote `codev/reviews/913-vscode-accordion-shouldn-t-aff.md`. No arch.md change (behavioral fix, no module-boundary/pattern change). Added two `[From 913]` lessons to lessons-learned.md: (1) the VSCode "no per-item collapse API; version the id" technique, (2) match UI-state persistence to the lifetime of what it describes. Opened PR #1040.

3-way consult verdicts: Gemini=COMMENT (skipped — agy not installed), Claude=APPROVE (HIGH), Codex=REQUEST_CHANGES (HIGH). Codex found a REAL defect Claude missed: the accordion expand-guard kept `openBuilderId` across toggle off→on, so after disable→open another→re-enable, re-expanding the previously-open builder was skipped and others didn't collapse (violates an acceptance criterion). Fixed by extracting the guard into `AccordionGate` whose `setEnabled` resets the open-builder state on toggle; added a regression test for the exact repro. 395 unit tests green. Documented in the review's "Things to Look At" and escalating to the human at the pr gate (PIR is single-pass, no AI re-review).
