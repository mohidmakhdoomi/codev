# PIR Plan: Introduce `apps/` for end-user surfaces

Issue: #855 — Monorepo layout: introduce apps/ for end-user surfaces

## Understanding

Today all workspace members live under `packages/*`. The issue proposes an
`apps/` vs `packages/` split so end-user client surfaces form a discoverable
peer set, distinct from shared libraries — motivated by an upcoming mobile app
(`apps/mobile`) that would look out of place if the existing clients stayed
under `packages/`.

Concretely, this PR:

- Adds `apps/*` to the workspace glob.
- Moves `packages/vscode` → `apps/vscode` (VS Code extension — end-user surface).
- Moves + renames `packages/dashboard` → `apps/web` (Tower management SPA — end-user surface).
- Leaves the shared libraries in place: `packages/codev`, `packages/core`,
  `packages/types`, `packages/config`, and `packages/artifact-canvas`.

Note vs. the issue text: the issue was written when there were "six packages."
There are now **seven** — `@cluesmith/codev-artifact-canvas` was added since.
It is a **shared React rendering library** ("Reusable React surface for
rendering and reviewing Codev markdown artifacts … across VSCode, the dashboard,
and future mobile hosts"), not an end-user surface, so it correctly **stays in
`packages/`**. This is consistent with the issue's rule that only end-user
clients move.

`workspace:*` deps resolve by package *name*, not path, and npm/Marketplace
publish key off the package, not the directory — so the move is mechanical. The
real work is fixing the handful of places that hardcode the *relative source
path* of the two moved packages, plus updating live docs that describe the
layout. Historical records (`codev/specs`, `codev/plans`, `codev/reviews`,
`codev/projects`, `codev/state`, `codev/research`) are point-in-time and are
**not** rewritten.

## Proposed Change

Do the whole split in **this one PR** (glob + both moves), rather than the
issue's suggested three separate PRs. Rationale: the changes are mechanical and
tightly coupled (the glob addition is a prerequisite for both moves, and leaving
one client under `packages/` mid-migration is exactly the half-applied-convention
state the issue warns against). `apps/mobile` still lands fresh later, out of
scope here. (See Decision 1 — the reviewer can redirect to phased PRs at the gate.)

Use `git mv` for the directory moves so `git log --follow` history is preserved.
After the moves, run `pnpm install` to regenerate `pnpm-lock.yaml` importer keys,
then `pnpm build` + tests to confirm the wiring.

### Decisions for the reviewer (issue's open questions)

These are the issue's "Questions for the team." My recommendation for each; the
`plan-approval` gate is where you confirm or redirect.

1. **Split now, all in one PR?** — *Recommend yes* (single PR, both moves). Redirect
   to phased PRs if you'd rather land the glob first.
2. **Rename npm package `@cluesmith/codev-dashboard` → `@cluesmith/codev-web`?**
   — *Recommend yes.* The package is `private: true`; blast radius is fully
   internal (one dependency entry in `packages/codev/package.json` + three test
   imports of `@cluesmith/codev-dashboard/lib/*` in `packages/codev`). Renaming
   keeps the package name aligned with its `apps/web` home; leaving it as
   `codev-dashboard` under `apps/web` is a lasting small dissonance. Say the word
   and I'll instead keep the package name and only move the directory.
3. **User-facing "Dashboard" brand** — *Recommend keep as-is.* This is a
   directory/package decision only. The many "Tower dashboard" references in code
   comments and the `area/dashboard` label describe the *product concept* and
   stay untouched.
4. **Naming (`web` vs `dashboard`, `mobile` vs `native`)** — *Recommend the
   issue's `web` / `mobile` / `vscode` surface axis.* No change proposed.

## Files to Change

### Directory moves (git mv)
- `packages/vscode/` → `apps/vscode/`
- `packages/dashboard/` → `apps/web/`

### Workspace glob
- `pnpm-workspace.yaml` — add `- apps/*` under `packages:`.

### Build wiring (highest risk — relative paths that break on move)
- `packages/codev/package.json:26` — `build:dashboard`: `cd ../dashboard` →
  `cd ../../apps/web`. The copy target `../../packages/codev/dashboard-dist`
  stays (codev doesn't move). *(The internal `dashboard-dist` output dir name and
  `tower-server.ts`'s `../../../dashboard-dist` resolve are unchanged — that's a
  concept name, not the moved path.)*
- `packages/codev/package.json:27` — `dev:dashboard`: `cd ../dashboard` →
  `cd ../../apps/web`.

### TypeScript config (relative `extends` from the moved vscode package)
- `apps/vscode/tsconfig.json:2` — `"../config/tsconfig.base.json"` →
  `"../../packages/config/tsconfig.base.json"`.
- `apps/vscode/tsconfig.webview.json:5` — same fix.
  *(dashboard/`apps/web` tsconfig is self-contained — no relative `extends` to fix.)*

### CI
- `.github/workflows/test.yml:74` — `working-directory: packages/dashboard` → `apps/web`.
- `.github/workflows/test.yml:78` — `working-directory: packages/vscode` → `apps/vscode`.
  *(Other workflows only reference `packages/core` / `packages/codev`, which don't move.
  No `on: paths:` filters reference the moved dirs.)*

### Release scripts
- `scripts/bump-vscode.sh` — real path refs `packages/vscode/package.json` and
  `packages/vscode/CHANGELOG.md` (lines ~29, 30, 64, 82) → `apps/vscode/...`,
  plus header comments (lines ~2, 4).
- `scripts/bump-all.sh` — comment/echo mentions of `packages/vscode` (lines ~18,
  23, 98) → `apps/vscode` for accuracy. The bump loop (line 90) doesn't touch the
  moved dirs.

### VS Code dev-environment configs (live)
- `.vscode/launch.json:9,12` — `packages/vscode` → `apps/vscode`.
- `.vscode/tasks.json:8` — `packages/vscode` → `apps/vscode`.
- `.vscode/settings.json:3,4,14,15` — `packages/vscode/out|dist` → `apps/vscode/...`.

### Moved package's own metadata
- `apps/vscode/package.json` — `repository.directory: "packages/vscode"` → `"apps/vscode"`.

### Package rename (only if Decision 2 = yes)
- `apps/web/package.json:2` — name `@cluesmith/codev-dashboard` → `@cluesmith/codev-web`.
- `packages/codev/package.json:55` — dependency key → `@cluesmith/codev-web: workspace:*`.
- `packages/codev/src/__tests__/filePathLinkProvider.test.ts:13-14` and
  `packages/codev/src/agent-farm/__tests__/open-files-shells-section.test.ts:11`
  — import specifiers `@cluesmith/codev-dashboard/lib/*` → `@cluesmith/codev-web/lib/*`.

### Live docs describing the layout
- `codev/resources/arch.md` — Monorepo Structure table + structure tree + ASCII
  diagram + prose (lines ~17-18, 120, 1026, 1053-1064, 1083, 1205-1207, 1284):
  update `packages/dashboard` / `packages/vscode` → `apps/web` / `apps/vscode`.
- `CLAUDE.md` / `AGENTS.md` — the "Directory Map" / structure references. These
  two must stay **byte-identical** to each other. Update only genuine
  *current-layout* references; the `area/dashboard` label description (keyed on
  the product concept / package name) changes only if Decision 2 = yes.
- `packages/core/src/review-markers.ts:16` — comment path
  `packages/vscode/src/comments/plan-review.ts` → `apps/vscode/...` (cosmetic accuracy).

### Not changed (intentionally)
- `codev-skeleton/**` — zero references to the moved paths; this is our own
  package layout, not framework content shipped to adopters. No dual-tree mirror needed.
- Historical records under `codev/specs|plans|reviews|projects|state|research` —
  point-in-time; left as written.
- `packages/vscode/src/**/*.test.ts` fixture strings like `packages/vscode/src/a.ts`
  — arbitrary path-tree test data, not real references; the tree logic is
  path-agnostic so they need no change.
- `pnpm-lock.yaml` — regenerated by `pnpm install`, not hand-edited.

## Risks & Alternatives Considered

- **Risk: broken dashboard build wiring.** The `cd ../dashboard` relative path in
  `build:dashboard`/`dev:dashboard` is the single most breakage-prone edit — a
  wrong relative depth silently fails to produce `dashboard-dist`, and Tower then
  serves no SPA. *Mitigation:* after the change, run `pnpm build` from repo root
  and confirm `packages/codev/dashboard-dist/index.html` exists; exercise Tower
  serving the web UI at the dev-approval gate.
- **Risk: stale relative `extends` in vscode tsconfig.** Missing the
  `../config` → `../../packages/config` fix breaks `tsc`/build for the extension.
  *Mitigation:* `pnpm --filter codev-vscode build` (or the workspace build) must pass.
- **Risk: lockfile / CI drift.** Importer keys are path-based. *Mitigation:*
  regenerate via `pnpm install`; CI `test.yml` working-directories updated in lockstep.
- **Risk: over-reaching doc edits.** Rewriting historical plans/reviews would be
  revisionist. *Mitigation:* explicit exclude list above; only live layout docs change.
- **Alternative: fix vscode tsconfig by switching `extends` to the package name
  `@cluesmith/codev-config/tsconfig.base.json`** (TS supports node_modules
  resolution). Rejected for this PR: it's a behavior-neutral refactor beyond the
  move's scope and would diverge the vscode tsconfig from how the other six
  packages extend the base. Keeping the relative form (just corrected for depth)
  matches the existing convention.
- **Alternative: phased PRs (issue's suggestion).** Rejected as default (see
  Proposed Change), but trivially available if the reviewer prefers it.

## Test Plan

- **Build:** `pnpm build` from repo root succeeds; `packages/codev/dashboard-dist/`
  is populated (index.html + assets present).
- **Unit tests:** `pnpm --filter @cluesmith/codev test` passes; the moved
  packages' own suites pass (`apps/web`, `apps/vscode`), including the three
  `packages/codev` tests that import from the web package's `/lib/*` (verifies the
  rename if Decision 2 = yes).
- **Workspace resolution:** `pnpm install` completes cleanly; `pnpm ls -r`
  shows all seven members with `apps/web` and `apps/vscode` at their new paths.
- **VS Code extension:** `pnpm --filter codev-vscode build` (or workspace build)
  succeeds — confirms the tsconfig `extends` depth fix.
- **Manual (dev-approval gate):** run the worktree via `afx dev pir-855`; confirm
  Tower serves the web management UI (workspace overview, terminals) — proves the
  `dashboard-dist` copy path survived the move.
- **git history:** `git log --follow apps/web/package.json` and
  `git log --follow apps/vscode/package.json` show history across the rename.
- **Grep sweep:** no operational (non-historical) file still references
  `packages/dashboard` or `packages/vscode`.
