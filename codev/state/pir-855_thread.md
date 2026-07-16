# PIR #855 — Monorepo layout: introduce apps/ for end-user surfaces

## Plan phase (2026-07-16)

Investigated the monorepo. Key findings:

- **7 packages now, not 6** (issue predates `@cluesmith/codev-artifact-canvas`).
  artifact-canvas is a shared React lib → stays in `packages/`.
- Moves: `packages/vscode` → `apps/vscode`, `packages/dashboard` → `apps/web`.
- **Highest-risk edit**: `packages/codev/package.json` `build:dashboard` /
  `dev:dashboard` use `cd ../dashboard` relative path → must become
  `cd ../../apps/web`. Silent failure mode if wrong (empty `dashboard-dist`).
- **tsconfig**: `apps/vscode/tsconfig.json` + `tsconfig.webview.json` extend
  `../config/tsconfig.base.json` → `../../packages/config/...`. dashboard tsconfig
  is self-contained.
- CI: only `test.yml:74,78` working-directories. No `paths:` filters affected.
- Scripts: `bump-vscode.sh` (real paths), `bump-all.sh` (comments only).
- `.vscode/{launch,tasks,settings}.json` live dev-env refs.
- Package rename `@cluesmith/codev-dashboard` → `@cluesmith/codev-web` is
  Decision 2 (open Q): blast radius is internal-only (1 dep + 3 test imports).
- Skeleton has ZERO refs — not a framework-file change, no dual-tree mirror.
- Historical records (specs/plans/reviews/projects/state/research) left as-is.

Plan written to `codev/plans/855-monorepo-layout-introduce-apps.md`. Awaiting
plan-approval gate. Presented issue's 4 open questions as reviewer decisions.
