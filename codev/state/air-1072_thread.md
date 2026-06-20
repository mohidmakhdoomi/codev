# air-1072 — vscode: centralise duplicated builder-lookup and file-view config reads

## Context
AIR refactor (issue #1072). Pure refactor surfaced during PIR #1066. No behavior change.

## What I did
Two new shared modules in `packages/vscode/src/`:

1. **`builder-lookup.ts`** (pure, no vscode import — testable like `builder-pick-rows.ts`)
   - `builderById(data, id)` — replaces `builders.find(b => b.id === id)`
   - `builderWithWorktree(data, id)` — narrows `worktreePath` to non-null string (mirrors the #1066 helper)
   - Both accept the nullable `OverviewData` straight from `getData()` / `getOverview()`.
   - Exported `OverviewBuilderWithWorktree` type.

2. **`builders-config.ts`** — `readBuildersFileViewAsTree()`, one home for the `codev.buildersFileViewAsTree` key + `true` default. Scoped to just that key (the broader settings-module question is out of scope per the issue).

### Call sites updated
- Builder lookup: `open-worktree-window`, `run-worktree-dev`, `open-worktree-folder`, `view-artifact`, `view-diff` (command sites pass `overview`, keep their own `pickBuilder` fallback + not-found messages), `diff-nav` (uses `builderWithWorktree`), `views/builders.ts` (private wrapper now delegates).
- Config read: `views/builders.ts` (`viewAsTree()`), `extension.ts` (dropped the local `readFileViewAsTree` const), `diff-nav.ts` (dropped local `viewAsTree()`).

## Tests
- New `__tests__/builder-lookup.test.ts` (7 cases: match / no-match / null data / worktree narrowing).
- `pnpm test:unit` → 486 passed (was 479). `check-types` + `lint` clean.
- Had to build workspace deps first (`codev-core`, `codev-types`, `artifact-canvas`) — pre-existing, not my changes.

## Status
Implementation + tests complete. Diff ~24 ins / 26 del across 8 files + 3 new files. Running porch to PR gate.
