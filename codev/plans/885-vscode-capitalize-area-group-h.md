# PIR Plan: Capitalize area group header labels

## Understanding

After #811 (backlog grouping) and #818 (builders-tree grouping) shipped, the area group headers in both trees render area names verbatim from the wire (`OverviewBacklogItem.area` / `OverviewBuilder.area`). Since GitHub `area/*` labels are lowercase by convention, headers come out as `vscode (12)`, `tower (4)`, `porch (3)` — visually inconsistent next to the `Uncategorized (8)` fallback header, which is PascalCase by virtue of the `UNCATEGORIZED_AREA` constant value.

The wire value and the matcher sentinel (`UNCATEGORIZED_AREA = 'Uncategorized'`) are the canonical strings and must not change — only the *displayed* label changes.

Where the label is built today: `packages/vscode/src/views/area-group-tree-item.ts:23`, which forwards the raw `areaName` into `super(\`${areaName} (${count})\`, ...)`. That single line is the entire bug surface — both `BacklogGroupTreeItem` and `BuilderGroupTreeItem` route through it.

## Proposed Change

Apply plain sentence-case (`name.charAt(0).toUpperCase() + name.slice(1)`) to the displayed label inside `AreaGroupTreeItem`'s constructor. The raw `areaName` field, the `id`, and the `contextValue` keep using the wire value verbatim — only the human-visible TreeItem label gets capitalized.

**Picking sentence-case over the per-repo override map**:

- Codev's actual `area/*` set is `vscode, tower, porch, consult, panel, terminal, config, core, docs, cross-cutting`. None of these are real acronyms — `vscode` is a product name written without expansion in the wild. `Vscode (12)` reads fine.
- `'Uncategorized'.charAt(0).toUpperCase() + slice(1)` is a no-op (the fallback stays `Uncategorized`), so a single uniform rule covers every area including the sentinel — no special-case branch needed.
- Smallest change that fixes the visual inconsistency the issue actually reports.
- A `codev.areaDisplayNames` config override is a clean follow-up if acronym pain surfaces in a repo with `area/api`, `area/ui`, etc. The helper signature is single-string in, string out — adding a config-lookup wrapper later is non-breaking. Not paying that cost preemptively (YAGNI; the codev repo has zero acronyms today).
- Framework-neutrality: a pure capitalize-first-char rule operates on whatever string is passed in. A hardcoded `{ vscode: 'VSCode', api: 'API' }` dictionary inside codev would privilege specific label values, which conflicts with the principle that teams using codev pick their own labeling semantics.

**Helper location**: a new `formatAreaForDisplay(area: string): string` exported from `packages/core/src/area-grouping.ts`. Sits next to `groupByArea` — same concern, no vscode dep, reusable by future consumers (e.g. the dashboard equivalent of these views) without a second migration. The subpath `@cluesmith/codev-core/area-grouping` is already exported, so no `packages/core/package.json` change.

## Files to Change

- `packages/core/src/area-grouping.ts` — add `export function formatAreaForDisplay(area: string): string`. Two lines plus a brief JSDoc explaining the "wire stays raw; this is display-only" contract.
- `packages/vscode/src/views/area-group-tree-item.ts:23` — wrap `areaName` in the call site: `super(\`${formatAreaForDisplay(areaName)} (${count})\`, collapsibleState)`. Add the import at top.
- `packages/vscode/src/test/area-grouping.test.ts` — append a `suite('formatAreaForDisplay', ...)` block covering: lowercase area → capitalized first char; `'Uncategorized'` → unchanged; hyphenated (`'cross-cutting'` → `'Cross-cutting'`); empty string → empty string (defensive — never expected, but cheap to lock).

**Not changed** (per issue scope):
- `packages/core/src/constants.ts` — `UNCATEGORIZED_AREA` literal stays.
- `packages/core/src/area-grouping.ts` `groupByArea` — bucketing logic unchanged; it keys on raw `area`.
- `packages/codev/src/lib/github.ts` `parseArea` — wire-side parser unchanged.
- `packages/vscode/src/views/backlog.ts`, `packages/vscode/src/views/builders.ts` — `element.areaName === ...` lookups continue to use the raw value (the field is untouched).
- `packages/vscode/src/views/area-group-expansion.ts` — expansion store keys off raw `areaName`, so expand/collapse state is preserved across the rendering change with no migration.

## Risks & Alternatives Considered

- **Risk**: a future area label uses an acronym (`api`, `ui`, `cli`, `sdk`) and the mangle becomes painful. **Mitigation**: the helper is one line; layering a config-driven override map on top is a non-breaking extension when needed. Codev's current set has zero acronyms, so deferring is cheap.
- **Risk**: stable-id stability — the `id` field on the TreeItem is what VSCode uses to persist expansion state. We keep `this.id = \`${kind}-group:${areaName}\`` (raw), so expansion state survives. The `areaName` public field is also unchanged, so the views' `element.areaName === ...` lookups in `backlog.ts:54` and `builders.ts:158` still match against the wire value.
- **Risk**: someone reads the label string back (e.g. accessibility tooling) and tries to match it against the raw area. **Mitigation**: label is documented as display-only in the helper's JSDoc; matchers in the codebase all key off `.areaName` (the typed field), not the label string.

**Alternatives rejected**:

- **Per-repo `codev.areaDisplayNames` setting (issue's option 2)**: would solve the acronym problem cleanly, but costs a settings entry + config-read plumbing for a problem codev's own area set doesn't have. Defer until a real repo surfaces the pain.
- **Hardcoded acronym dictionary inside codev** (e.g. `const ACRONYMS = { vscode: 'VSCode' }`): privileges specific label values inside framework code, conflicting with the principle that teams using codev decide their own labeling semantics.
- **Title-case (capitalize every word)**: gains nothing for codev's single-word areas (`tower`, `porch`, etc.) and complicates `cross-cutting` → `Cross-Cutting` vs the issue's `Cross-cutting` expectation. Sentence-case matches what `Uncategorized` looks like.
- **Inline the helper at the call site (skip core export)**: only one caller today (`AreaGroupTreeItem`), so inlining is arguably YAGNI in the other direction. Exporting from core costs one extra file modification but pays for itself the first time another consumer (dashboard, CLI status output) needs the same display rule. Two callers in the same package would already justify the helper; a future cross-package consumer is plausible enough that I'd rather front-load the small abstraction than copy-paste later.

## Test Plan

**Unit (core helper, tested in vscode test suite where core helpers are tested)**:

Append a `suite('formatAreaForDisplay', ...)` to `packages/vscode/src/test/area-grouping.test.ts` with these cases:

- `formatAreaForDisplay('vscode')` → `'Vscode'`
- `formatAreaForDisplay('tower')` → `'Tower'`
- `formatAreaForDisplay('cross-cutting')` → `'Cross-cutting'`
- `formatAreaForDisplay('Uncategorized')` → `'Uncategorized'` (no-op on the fallback sentinel — the single uniform rule covers it)
- `formatAreaForDisplay('')` → `''` (defensive — never expected, but cheap to lock the contract)

**Manual / dev-approval gate**:

- Run `afx dev pir-885` to launch the worktree's VSCode extension dev host.
- Open the Codev sidebar. Both **Backlog** and **Builders** trees should now show:
  - `Vscode (N)`, `Tower (N)`, `Porch (N)` — capitalized first letter, lowercase rest.
  - `Cross-cutting (N)` if there are cross-cutting items.
  - `Uncategorized (N)` last — unchanged in appearance (was already PascalCase).
- Expand/collapse a group; reload the extension. The expansion state should persist (verifies `id` stability).
- Right-click a group header → context menu should still work (verifies `contextValue` stability).
- Right-click a builder / backlog row inside a group → existing per-row commands still work (verifies the tree-item shape downstream of the group is unchanged).
- Degenerate case: a workspace whose every issue is uncategorized still flat-lists the items with no group header (the `groups.length === 1 && groups[0].area === UNCATEGORIZED_AREA` early-return in both `backlog.ts:73` and `builders.ts:132` is untouched).

**Cross-platform**: VSCode-only change (no mobile / web surfaces).
