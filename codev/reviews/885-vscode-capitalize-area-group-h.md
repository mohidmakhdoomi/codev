# PIR Review: Capitalize area group header labels

Fixes #885

## Summary

The Backlog and Builders trees grouped by `area/*` rendered headers verbatim (`vscode (12)`, `tower (4)`), visually inconsistent next to the PascalCase `Uncategorized (8)` fallback. This PR adds a `formatAreaForDisplay` helper in `@cluesmith/codev-core/area-grouping` (title-case with `-`/`_` → space) and applies it in `AreaGroupTreeItem`'s label, so both trees now render `Vscode (12)`, `Tower (4)`, `Cross Cutting (N)`, `Uncategorized (8)`. The raw `areaName` field, the stable `id`, and the `contextValue` continue to use the wire value, so expansion-state persistence and `===` matchers in the view providers are untouched.

## Files Changed

- `packages/core/src/area-grouping.ts` (+27 / −0) — new `formatAreaForDisplay` next to `groupByArea`
- `packages/vscode/src/views/area-group-tree-item.ts` (+8 / −1) — wrap only the displayed label
- `packages/vscode/src/test/area-grouping.test.ts` (+35 / −1) — 7 new cases
- `codev/plans/885-vscode-capitalize-area-group-h.md` (+96 / −0) — approved PIR plan

## Commits

- `830aafe4` [PIR #885] Plan draft
- `a031721e` [PIR #885] Plan revised: title-case + separator-to-space
- `534d94e7` [PIR #885] feat: formatAreaForDisplay helper + apply in AreaGroupTreeItem
- `325ead6d` [PIR #885] test: formatAreaForDisplay cases

## Test Results

- `pnpm build`: ✓ pass
- `pnpm test` (vscode-test / mocha + esbuild type-check + lint): ✓ pass (97 tests, 7 new)
- `pnpm test:unit` (vitest, separate harness): ✓ pass (49 tests)
- Manual verification at the `dev-approval` gate: human reviewed the running worktree via `afx dev pir-885`; group headers in both Backlog and Builders trees render with the new capitalization; expansion state survives reload.

## Architecture Updates

No arch.md changes — this PR adds one helper next to an existing function in the same module, and the call site is a single line. No new module boundary, no new pattern, no consumer-facing API shift. The display-only nature of the helper is documented in its JSDoc (the "wire stays raw" contract).

## Lessons Learned Updates

No lessons-learned.md changes. The design call worth recording — *display-formatting helpers live in core next to the data they format, not in the view layer* — is one instance of a broader pattern already implicit in how `groupByArea` is structured. Two data points isn't a pattern. If a third consumer (e.g. dashboard parity for the same view) reuses `formatAreaForDisplay` directly without copy-paste, that becomes a lessons-worthy generalization.

## Things to Look At During PR Review

- **The acronym question** is intentionally deferred. The plan and the helper's JSDoc both explain this: codev's current `area/*` set has no real acronyms, so `vscode → Vscode` reads cleanly. If a downstream repo surfaces real pain (`api → Api` rather than `API`), a `codev.areaDisplayNames: Record<string, string>` config override is a clean non-breaking extension — the helper's signature (single string in, single string out) supports a config-lookup wrapper layered on top with sentence-case fallback. Not paying that cost preemptively.
- **No hardcoded acronym dictionary.** A built-in `{ vscode: 'VSCode', api: 'API' }` map inside framework code would conflict with `feedback_framework_neutral_on_label_semantics` — teams using codev decide their own labeling semantics; a user-supplied config is the framework-neutral way to opt in.
- **`UNCATEGORIZED_AREA` sentinel is intentionally a no-op** under the rule (single word, first char already upper). The single uniform path through the helper covers every area including the fallback — no special-case branch.
- **Stable `id`** is preserved (`${kind}-group:${areaName}` still uses the raw value), so per-group expansion state survives across the rendering change with zero migration.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-885` → **View Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-885`
- **What to verify**:
  - Open the Codev sidebar; both **Backlog** and **Builders** trees should show `Vscode (N)`, `Tower (N)`, `Porch (N)`, `Cross Cutting (N)` if present, and `Uncategorized (N)` last.
  - Expand/collapse a group, reload the extension — expansion state persists (verifies `id` stability).
  - Right-click a group header → context menu works (verifies `contextValue` stability).
  - Right-click rows inside a group → per-row commands still work (verifies tree shape downstream is unchanged).
  - Degenerate case: a workspace whose every issue is uncategorized still flat-lists items with no group header (the early-return at `backlog.ts:73` / `builders.ts:132` is untouched).
