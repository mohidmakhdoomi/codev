# PIR Review: Agents view — architect-aware grouping (VSCode)

Fixes #1104

## Summary

Renames the VSCode sidebar **Builders** view to **Agents** and makes architect→builder ownership visible by adding **architect** as a third group-by axis alongside stage and area (builders are grouped by exactly one axis at a time). The owning architect roster is plumbed onto `/api/overview` so the conversational `Codev: Add Architect` action can route through `main`. Note: the implementation pivoted at the dev-approval gate from the issue's originally-proposed *nested* architect tier to a *flat 3-way toggle* — the reviewer found the flat axis cleaner (no duplication with Workspace > Architects, no single-architect collapse awkwardness, and childless architects vanish for free).

## Files Changed

(`git diff --stat` against the merge-base; excludes the porch `status.yaml`/thread bookkeeping)

- `codev/plans/1104-vscode-merge-architects-builde.md` (+267) — plan
- `codev/state/pir-1104_thread.md` (+102) — builder thread
- `packages/types/src/api.ts` (+12) — `OverviewData.architects: ArchitectState[]`
- `packages/codev/src/agent-farm/servers/tower-routes.ts` (+/-72) — shared `liveArchitects` helper, `/api/overview` enrichment
- `packages/codev/src/agent-farm/servers/overview.ts` (+/-6) — `architects: []` default
- `packages/codev/src/agent-farm/__tests__/tower-routes.test.ts` (+42) — overview-roster tests
- `packages/dashboard/__tests__/{useOverview.stability,useSSE.reconnect}.test.ts` (+1 each) — mock `architects: []`
- `packages/vscode/package.json` (+/-111) — view id rename, group-by commands + toolbar button, octopus icon, settings/labels
- `packages/vscode/icons/architect{,-light,-dark}.svg` (new) — octopus glyph (monochrome light/dark pair)
- `packages/vscode/src/views/builder-grouping.ts` (+/-48) — `architectGrouping()` strategy
- `packages/vscode/src/views/builders.ts` (+/-35) — flat single-level grouping (nested tier removed)
- `packages/vscode/src/views/builder-tree-item.ts` — drop `ArchitectGroupTreeItem`
- `packages/vscode/src/commands/add-architect.ts` (new, +35) — conversational Add Architect helpers
- `packages/vscode/src/extension.ts` (+/-90) — group-by cycle commands, Add Architect rewrite, view-id wiring
- `packages/vscode/README.md` (+/-14) — Builders → Agents
- vscode tests: `builder-grouping`, `add-architect`, `extension-architect-commands`, `contributes-panel`, `menu-when-clauses`

## Commits

`git log main..HEAD --oneline` (squash-free; the development history shows the dev-gate pivot):

- `b7e738f2` Enrich /api/overview with the architect roster (shared collectArchitects)
- `08346c61` Add adaptive architect tier to the Agents tree *(later retired)*
- `cc4bc4d4` Conversational Add Architect + rename Builders view to Agents
- `b5bfce2f` Fix Agents view title flipping back to 'Builders' on data load
- `c8f3ad87` / `c014bf3c` Sweep user-facing 'Builders' labels to 'Agents' (settings + README)
- `ae035b61` Rename collectArchitects -> liveArchitects (live-session reader)
- `1ec60502` Pivot to flat 3-way group-by toggle, retire nested tier
- `8e7821e8` Name the active axis in the title *(later reverted)*
- `acaba08b` Single cycling toolbar button (icon = current axis)
- `189e0f7f` Present-tense titles, render first, drop redundant direct commands
- `9b4f88e3` Group-by button shows the NEXT axis (action), not current
- `85cc8f21` Drop the bogus 'Unassigned' architect group

## Test Results

- `pnpm build` (core + codev + dashboard): ✓ pass
- `pnpm --filter @cluesmith/codev test`: ✓ 3375 pass / 48 skipped
- `codev-vscode` check-types ✓, lint ✓, `test:unit` ✓ 512 pass
- `codev-dashboard` test: ✓ 322 pass / 1 skipped
- Manual verification (human, at dev-approval gate): Agents view in a multi-architect workspace; the single group-by toolbar button cycling stage → area → architect with the icon reflecting the next axis; the octopus icon at row size on light + dark; group headers correctly showing stage names / area labels / architect names per axis.

## Architecture Updates

COLD `codev/resources/arch.md` — added one bullet to the **VS Code Extension** design decisions ("Agents view + group-by axes (#1104)"): the view-id rename (`codev.builders` → `codev.agents`, user-facing only), the three group-by strategies, the `architect` axis semantics (null → main, childless absent), and the additive `/api/overview` `architects` field built by the shared `liveArchitects` helper (distinct from state.ts's persisted `getArchitects`). No HOT `arch-critical.md` change — this is feature/reference detail, not an always-inject system-shape invariant; module boundaries are unchanged (the extension stays a thin client; the Tower API gained one additive field).

## Lessons Learned Updates

COLD `codev/resources/lessons-learned.md` (UI/UX) — two `[From #1104]` entries:
1. **VS Code toolbar buttons have no pressed/selected state** (no `toggled` in the menu schema; icon is fixed to the command) — express one-of-N selection with a single button whose icon reflects state via show/hide commands, make it an action (show the *next* state), and let view content be the primary "what am I looking at" signal.
2. **Custom tree-row SVGs render at 16px** — author/verify at that size (rasterize on light+dark), and ship a monochrome light/dark pair (theme-foreground colors), not a hardcoded brand color, since tree `iconPath` SVGs aren't theme-tinted.

No HOT `lessons-critical.md` change — both are VS-Code-specific recipes, not high-blast-radius cross-cutting rules.

## Things to Look At During PR Review

- **The dev-gate pivot.** The approved plan describes a *nested* architect tier; the shipped code is a *flat* 3-way grouping axis. Commit `1ec60502` is the pivot. The nested-tier code (`ArchitectGroupTreeItem`, `partitionByArchitect`, the adaptive `architectCount` gate) was fully removed, so review `builders.ts` / `builder-grouping.ts` against the *flat* model, not the plan.
- **`liveArchitects` vs `getArchitects`.** `tower-routes.ts`'s `liveArchitects` (live terminal-session set) is intentionally distinct from state.ts's `getArchitects` (persisted table). The `/api/overview` enrichment reuses the exact helper the dashboard-state path uses so the two payloads can't drift — confirm the extraction is byte-equivalent to the former inline loop.
- **`/api/overview` is the only remaining consumer of the roster enrichment** (via Add Architect's `resolveMainArchitect`). The nested tier that originally also consumed it is gone; the enrichment is retained deliberately for Add Architect, not dead code.
- **No `toggled`** (it isn't a real menu property). The group-by button is one of three show/hide cycle commands; verify the `when`-clauses cover the unset-context-key case (`!codev.buildersGroupBy` → stage).
- **Null-owner folds into `main`** in `architectGrouping` — confirm that matches the affinity router's fallback and that there's no user-visible "Unassigned" group.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-1104` → **Review Diff**
- **Run dev server**: `afx dev pir-1104` (or sidebar → Run Dev Server)
- **What to verify**:
  - Agents view renders; the group-by button is the leftmost toolbar item, its icon = the *next* axis, clicking cycles stage → area → architect.
  - In `architect` mode, group headers are architect names; a builder whose owner isn't running still appears under `main`.
  - Single-architect workspace: architect mode shows one group (e.g. `MAIN`); no "Unassigned".
  - `Codev: Add Architect` with `main` running → request lands in main's terminal; with main absent → modal pointing at the CLI fallback.
  - Octopus icon legible at row size in both light and dark themes.
