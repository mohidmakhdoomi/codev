# PIR Review: Gate builder-row Run/Stop Dev Server menu on `worktree.devCommand`

Fixes #975

## Summary

The builder-row **Run/Stop Dev Server** context-menu entries used to show on every builder row regardless of whether `worktree.devCommand` was configured, so picking one ran against a missing command (error toast or no-op). This PR gates those entries — plus the dev keybindings and the workspace-dev command-palette entries — on a new `codev.hasDevCommand` context key. The key is refreshed from `BuildersProvider`'s render path (no dedicated config-file listener), and a shared `hasRunnableDevCommand()` helper now backs both the key and the Workspace view's Start-row gate, also fixing a latent empty-string bug.

## Files Changed

- `packages/vscode/package.json` (+22 / -4) — `&& codev.hasDevCommand` on the two builder-row dev `when` clauses; `when` gating on the two dev keybindings; commandPalette entries (workspace-dev → `codev.hasDevCommand`, builder-row dev → `false`)
- `packages/vscode/src/load-worktree-config.ts` (+18 / -0) — `hasRunnableDevCommand()` helper (single source of truth)
- `packages/vscode/src/views/builders.ts` (+24 / -0) — `refreshDevCommandContext()` called fire-and-forget from `getChildren`'s root branch; `connectionManager` injected
- `packages/vscode/src/views/workspace.ts` (+~12 / -~11) — Start-row gate switched from `devCommand !== null` to `hasRunnableDevCommand(worktreeConfig)`
- `packages/vscode/src/extension.ts` (+1 / -1) — pass `connectionManager` to `BuildersProvider`
- `packages/vscode/src/__tests__/has-runnable-dev-command.test.ts` (+47 / -0, new) — helper truth table
- `packages/vscode/src/__tests__/menu-when-clauses.test.ts` (+67 / -0) — `when`-shape assertions for the gating across menu / palette / keybinding surfaces

## Commits

- `4c856a92` [PIR #975] Gate builder-row Run/Stop Dev Server menu on worktree.devCommand
- `50a66686` [PIR #975] Group BuildersProvider parameter-properties together

## Test Results

- `pnpm build`: ✓ pass (porch check, 6.3s)
- `pnpm test`: ✓ pass (porch check, 20.8s)
- `pnpm check-types`: ✓ clean
- `pnpm test:unit`: ✓ 276 tests pass (21 files), incl. 2 new test files
- `eslint` (changed files): ✓ clean
- Manual verification: performed by the human at the `dev-approval` gate against the running worktree — builder-row entries hidden with no `devCommand`, present with one, live on next tree refresh after a config edit; Workspace view unaffected.

## Architecture Updates

No `arch.md` changes needed. This PR fixes a UI-gating bug within the existing VSCode TreeView + `when`-clause / setContext pattern; it introduces no new module boundary or architectural pattern. The render-path context-key refresh is a local choice within `BuildersProvider`, consistent with the existing context-key usage in the builders tree (`codev.buildersAutoCollapse`, `codev.buildersGroupBy`).

## Lessons Learned Updates

No addition to `codev/resources/lessons-learned.md`. The one transferable observation — *gate a menu entry on the same condition that governs the resource it acts on, and pick a refresh cadence matched to the surface's lifecycle (ephemeral context menu ⇒ render-path snapshot, not a constant listener)* — is implementation guidance already captured in the code comments and this review, not broad enough to warrant a standing lessons entry.

## Things to Look At During PR Review

- **Render-path liveness trade-off (intentional).** `codev.hasDevCommand` is refreshed when `BuildersProvider.getChildren` renders the root, not via the `worktree-config-updated` SSE. So a `worktree.devCommand` edit is reflected on the *next* Builders-tree refresh (overview poll / tree event), not instantly. This was a deliberate design call (the context menu is on-demand and short-lived, unlike the always-on Workspace view, which keeps its SSE subscription). Acceptance #5 ("without a window reload") still holds.
- **Empty-string semantics.** `hasRunnableDevCommand` treats `"devCommand": ""` / whitespace as absent, matching `dev-shared.ts`'s `if (!devCommand)` runnability gate. This also changes the Workspace view's Start-row gate (previously `devCommand !== null`, which would have shown a Start row for `""` that errors on click) — a latent bug fix. Confirm no Workspace-view regression.
- **Builder-row dev palette entries pinned `when: false`.** They need a tree-row argument; argless palette invocation falls through (same rationale as `viewSpecFile`/`viewPlanFile`/`viewReviewFile`). This is a behavior change — before this PR they had no palette entry and so defaulted to visible.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-975` → **View Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-975`
- **What to verify**:
  - With no `worktree.devCommand` in `.codev/config.json`: right-click a builder row → **no** Run/Stop Dev Server entries.
  - Add `"devCommand": "pnpm dev"`, then interact with the Builders tree (refresh): entries appear.
  - Remove it again / set it to `""`: entries hidden.
  - Workspace view Start/Stop rows behave as before across the same edits.
  - Keybinding `cmd+alt+r` is silent with no dev command; starts dev with one.
