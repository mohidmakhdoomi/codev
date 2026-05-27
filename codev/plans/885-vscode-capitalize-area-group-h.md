# PIR Plan: Capitalize area group header labels

## Understanding

After #811 (backlog grouping) and #818 (builders-tree grouping) shipped, the area group headers in both trees render area names verbatim from the wire (`OverviewBacklogItem.area` / `OverviewBuilder.area`). Since GitHub `area/*` labels are lowercase by convention, headers come out as `vscode (12)`, `tower (4)`, `porch (3)` — visually inconsistent next to the `Uncategorized (8)` fallback header, which is PascalCase by virtue of the `UNCATEGORIZED_AREA` constant value.

The wire value and the matcher sentinel (`UNCATEGORIZED_AREA = 'Uncategorized'`) are the canonical strings and must not change — only the *displayed* label changes.

Where the label is built today: `packages/vscode/src/views/area-group-tree-item.ts:23`, which forwards the raw `areaName` into `super(\`${areaName} (${count})\`, ...)`. That single line is the entire bug surface — both `BacklogGroupTreeItem` and `BuilderGroupTreeItem` route through it.

## Proposed Change

Apply **title-case with separator-to-space normalization** to the displayed label inside `AreaGroupTreeItem`'s constructor. Split on `-`, `_`, and whitespace; capitalize the first character of each word; rejoin with a single space.

```ts
export function formatAreaForDisplay(area: string): string {
  return area
    .split(/[-_\s]+/)
    .filter(w => w.length > 0)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
```

Expected outputs:

- `vscode` → `Vscode`
- `tower` → `Tower`
- `cross-cutting` → `Cross Cutting`
- `front_end` → `Front End`
- `Uncategorized` → `Uncategorized` (no-op on the fallback sentinel)

The raw `areaName` field, the `id`, and the `contextValue` keep using the wire value verbatim — only the human-visible TreeItem label is transformed.

**Why this rule**:

- Codev's actual `area/*` set is `vscode, tower, porch, consult, panel, terminal, config, core, docs, cross-cutting`. None are real acronyms. The multi-word case (`cross-cutting`) is the most visible difference between rules, and `Cross Cutting` reads as a proper category name instead of a tag ID — meaningfully better than `Cross-cutting` or `Cross-Cutting`.
- The same rule applied to `Uncategorized` is a no-op (single-word, first char already upper), so a single uniform path covers every area including the sentinel — no special-case branch.
- Single-word acronyms (`api`, `ui`, `cli`) still mangle to `Api`, `Ui`, `Cli`. Codev's set has none today; if a downstream repo surfaces real acronym pain, the helper signature stays single-string-in, single-string-out, so adding a `codev.areaDisplayNames: Record<string, string>` config override on top is a clean non-breaking extension.
- Framework-neutrality: this is a purely structural rule (separator handling + capitalize first letter). No hardcoded list of "known acronyms" — that would privilege specific label values inside framework code and conflict with the principle that teams using codev decide their own label semantics.

**Helper location**: exported from `packages/core/src/area-grouping.ts`. Sits next to `groupByArea` — same concern, no vscode dep, reusable by future consumers (e.g. dashboard equivalent of these views) without a second migration. The subpath `@cluesmith/codev-core/area-grouping` is already exported, so no `packages/core/package.json` change.

## Files to Change

- `packages/core/src/area-grouping.ts` — add `export function formatAreaForDisplay(area: string): string`. Two lines plus a brief JSDoc explaining the "wire stays raw; this is display-only" contract.
- `packages/vscode/src/views/area-group-tree-item.ts:23` — wrap `areaName` in the call site: `super(\`${formatAreaForDisplay(areaName)} (${count})\`, collapsibleState)`. Add the import at top.
- `packages/vscode/src/test/area-grouping.test.ts` — append a `suite('formatAreaForDisplay', ...)` block covering: lowercase single-word area → capitalized first char; hyphenated `'cross-cutting'` → `'Cross Cutting'`; underscored `'front_end'` → `'Front End'`; mixed/multi-word; `'Uncategorized'` → unchanged; empty string → empty string (defensive — never expected, but cheap to lock).

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

- **Plain sentence-case** (`name.charAt(0).toUpperCase() + name.slice(1)`): renders `cross-cutting` as `Cross-cutting`, which reads as a tag ID rather than a proper category label. Title-case + separator-to-space gives `Cross Cutting`, which sits visually next to `Uncategorized` as a peer.
- **Per-repo `codev.areaDisplayNames` setting (issue's option 2)**: would solve single-word-acronym mangling cleanly, but costs a settings entry + config-read plumbing for a problem codev's own area set doesn't have. The chosen helper's signature (single string in, single string out) keeps this a clean non-breaking follow-up: a config-lookup wrapper layered on top, falling back to the structural rule for unconfigured areas.
- **Hardcoded acronym dictionary inside codev** (e.g. `const ACRONYMS = { vscode: 'VSCode', api: 'API' }`): privileges specific label values inside framework code, conflicting with the principle that teams using codev decide their own labeling semantics. A user-supplied config override is the framework-neutral way to opt in.
- **Length-based or vowel-pattern acronym heuristic** (e.g. uppercase if ≤3 chars, or no vowels): every variant has false positives in codev's own set — `web → WEB`, `app → APP`, `core → CORE`, `docs → DOCS`. No clean general rule exists.
- **Inline the helper at the call site (skip core export)**: only one caller today (`AreaGroupTreeItem`), so inlining is arguably YAGNI in the other direction. Exporting from core costs one extra file modification but pays for itself the first time another consumer (dashboard, CLI status output) needs the same display rule. A future cross-package consumer is plausible enough that I'd rather front-load the small abstraction than copy-paste later.

## Test Plan

**Unit (core helper, tested in vscode test suite where core helpers are tested)**:

Append a `suite('formatAreaForDisplay', ...)` to `packages/vscode/src/test/area-grouping.test.ts` with these cases:

- `formatAreaForDisplay('vscode')` → `'Vscode'`
- `formatAreaForDisplay('tower')` → `'Tower'`
- `formatAreaForDisplay('cross-cutting')` → `'Cross Cutting'`
- `formatAreaForDisplay('front_end')` → `'Front End'`
- `formatAreaForDisplay('Uncategorized')` → `'Uncategorized'` (no-op on the fallback sentinel — the single uniform rule covers it)
- `formatAreaForDisplay('')` → `''` (defensive — never expected, but cheap to lock the contract)

**Manual / dev-approval gate**:

- Run `afx dev pir-885` to launch the worktree's VSCode extension dev host.
- Open the Codev sidebar. Both **Backlog** and **Builders** trees should now show:
  - `Vscode (N)`, `Tower (N)`, `Porch (N)` — capitalized first letter, lowercase rest.
  - `Cross Cutting (N)` if there are cross-cutting items (hyphen replaced with space, each word capitalized).
  - `Uncategorized (N)` last — unchanged in appearance (was already PascalCase, rule is a no-op).
- Expand/collapse a group; reload the extension. The expansion state should persist (verifies `id` stability).
- Right-click a group header → context menu should still work (verifies `contextValue` stability).
- Right-click a builder / backlog row inside a group → existing per-row commands still work (verifies the tree-item shape downstream of the group is unchanged).
- Degenerate case: a workspace whose every issue is uncategorized still flat-lists the items with no group header (the `groups.length === 1 && groups[0].area === UNCATEGORIZED_AREA` early-return in both `backlog.ts:73` and `builders.ts:132` is untouched).

**Cross-platform**: VSCode-only change (no mobile / web surfaces).
