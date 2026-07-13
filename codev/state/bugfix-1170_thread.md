# bugfix-1170 — vscode Agents tree group-header contextValue collision

## Investigate

**Bug**: Right-clicking an Agents-tree group header (architect/phase/area axis) surfaces 7
builder-scoped context-menu entries that no-op on a group header.

**Root cause (confirmed)**: `packages/vscode/src/views/area-group-tree-item.ts:34` sets
`this.contextValue = `${kind}-group``. `BuilderGroupTreeItem` calls `super(groupName, 'builder', ...)`
(builder-tree-item.ts:54), so kind='builder' → contextValue `builder-group`. The 7 offending menu
entries in package.json (lines 537–587) gate on `/^(builder|blocked-builder|awaiting-builder)-/`,
which matches `builder-group`. The 3 protocol-scoped entries (viewSpec/Plan/ReviewFile) already
require a protocol suffix, so they're unaffected.

**Fix**: line 34 → `this.contextValue = `group-${kind}``. Yields `group-builder` / `group-backlog`,
neither matches the offending regexes. No package.json change. `id` (line 33) stays `${kind}-group`
(unrelated — drives expansion persistence).

**Tests**: grep found NO existing assertion on the literal `builder-group` string, so nothing to
update. The regression home is `packages/vscode/src/__tests__/menu-when-clauses.test.ts` — add a
block asserting the 7 builder-scoped regexes reject `group-builder` / `group-backlog`.

Scope: 1-line src change + new regression test. Comfortably within BUGFIX.

## Fix

- `area-group-tree-item.ts:34`: `${kind}-group` → `group-${kind}`. Build + tests green
  (`porch check`: build 6.2s, tests 21s; 566 tests pass).
- Regression test `group-header-context-value.test.ts` derives contextValue from the real
  `AreaGroupTreeItem` and feeds it to the actual package.json menu regexes. Verified it fails
  without the fix (8 failures) and passes with it.
- Note: unit tests need `@cluesmith/codev-core` + `@cluesmith/codev-types` built first, else
  suites fail at import resolution (pre-existing, unrelated). `porch check` runs the build.

## PR

- PR #1172 opened, `Fixes #1170`.
- CMAP (all three APPROVE, HIGH confidence, zero issues): gemini=APPROVE, codex=APPROVE
  (couldn't re-run vitest in its sandbox, approved on inspection), claude=APPROVE.
- Consult snag: `consult --type pr` auto-detect failed from the worktree ("Multiple projects
  found" — it scanned the full `codev/projects/`). Adding `--issue 1170` disambiguated. Worth
  a look for other bugfix builders.
- Requested `pr` gate via `porch done`. Awaiting human approval to merge.
