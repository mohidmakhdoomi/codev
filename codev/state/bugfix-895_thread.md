# bugfix-895 thread

## Investigate
- Issue #895: Replace per-word capitalization with full uppercase for area group headers in VSCode sidebar.
- Current `formatAreaForDisplay` in `packages/core/src/area-grouping.ts` splits on `[-_\s]+`, capitalizes first char of each word, joins with space. Produces `Cross Cutting` for `cross-cutting`.
- Issue's before/after table shows `Cross-cutting (1)` → `CROSS-CUTTING (1)` (preserves hyphen). The simplest reading that matches the table: replace the entire pipeline with `area.toUpperCase()`. That preserves `-` and `_` and matches every example in the table.
- Plan: rename `formatAreaForDisplay` → `uppercaseAreaName`, implementation becomes `area.toUpperCase()`. Update test + one caller in `area-group-tree-item.ts`.
- Callers: `packages/vscode/src/views/area-group-tree-item.ts` (one site) + tests in `packages/vscode/src/test/area-grouping.test.ts`.

## Fix
- `packages/core/src/area-grouping.ts`: replaced multi-step pipeline with `area.toUpperCase()`; renamed `formatAreaForDisplay` → `uppercaseAreaName`; updated docstring.
- `packages/vscode/src/views/area-group-tree-item.ts`: import + call site renamed; updated docstring comment.
- `packages/vscode/src/test/area-grouping.test.ts`: suite renamed + assertions updated to uppercase expectations. Separator behavior changed: hyphens/underscores are now preserved (e.g. `cross-cutting` → `CROSS-CUTTING`, not `CROSS CUTTING`) — matches the issue's before/after table. The old "consecutive-separator collapsing" test was repurposed to lock in verbatim preservation.
- Verified: `pnpm --filter @cluesmith/codev-core build` (tsc), `pnpm --filter codev-vscode check-types`, `pnpm --filter codev-vscode lint`, `pnpm --filter codev-vscode test:unit` (49 pass), `pnpm --filter codev-vscode compile-tests` all clean.

