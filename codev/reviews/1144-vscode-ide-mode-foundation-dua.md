# PIR Review: VSCode IDE-mode foundation (dual-mode activation, context keys, empty-window surfaces)

Fixes #1144

## Summary

The extension now has an explicit workspace-free layer model. A pure activation-tier decision (`full` / `ide-empty` / `dormant`, computed in the new `src/ide-mode.ts` from `vscode.env.appName` plus codev-workspace detection) gates every activation side effect, so `onStartupFinished` can safely run `activate()` in every window of every marketplace install: a guest window with no codev workspace is provably inert (no Tower auto-start, no preflight, no focus steal, no status bar, no state writes). IDE mode (`appName === CODEV_IDE_APP_NAME`, a single-sourced cross-repo contract with the fork's product.json) gets the empty-window onboarding surface: container focus, per-quadrant `viewsWelcome` content, and a one-time first-run notification that opens the existing Getting Started walkthrough. The original Part 1 bug (dead Spawn Builder / New Shell rows in a no-workspace window) is fixed by `when`-gating the workspace-bound views on the new `codev.hasWorkspace` context key.

## Deviations From the Approved Plan (agreed at the dev-approval gate)

Three changes emerged from the human's hands-on review of the running worktree, each explicitly agreed before implementation:

1. **`codev.stateKnown` context key + "Loading Codev…" welcome.** Unset context keys evaluate to false, so during the workbench-restore-to-activation gap the guest welcome ("Open a folder…") flashed inside real codev workspaces, and VS Code's raw "no data provider registered" message showed afterwards. Both `viewsWelcome` quadrants now require `codev.stateKnown` (set first-thing in `activate()`), and a `!codev.stateKnown` "Loading Codev…" entry covers the pre-activation window.
2. **Workspace detection no longer walks ancestors.** `findProjectRoot` walked up to the filesystem root; any folder under a codev-enabled home directory (the reviewer's real setup: `~/codev` + `~/.codev` exist) inherited that workspace, connected to Tower, and rendered live workspace rows in unrelated projects. Detection is now "the opened folder itself contains `codev/` or `.codev/`", with the `codev.workspacePath` setting as the escape hatch. This matches CLI semantics (afx runs from the workspace root; worktrees carry their own `codev/` copy so they still match directly). Trade-off accepted: a window opened on a *subfolder* of a codev repo is now dormant.
3. **`codev.hasWorkspace` means codev-workspace-presence, not folder-presence.** The issue's literal definition (`workspaceFolders?.length > 0`) would still render the Workspace view's static action rows in a non-codev folder window (the Part 1 bug, one level up). The key is now `detectWorkspacePath() !== null`.

## Files Changed

- `packages/vscode/src/ide-mode.ts` (+124 / -0) — new: `CODEV_IDE_APP_NAME`, `detectIdeMode` (with the Development-mode-only `CODEV_SIMULATE_IDE=1` seam), `decideActivationTier`, `activationPolicy`
- `packages/vscode/src/extension.ts` (+113 / -9) — tier computed before any side effect; three context keys; five gated side effects; IDE first-run surface; `codev.openGettingStarted`
- `packages/vscode/src/workspace-detector.ts` (+25 / -16) — ancestor walk removed; `isCodevWorkspaceRoot`
- `packages/vscode/package.json` (+25 / -7) — `onStartupFinished`; view `when` gates; `viewsWelcome` (loading + two quadrants)
- `packages/vscode/src/preflight/preflight.ts` (+9 / -3) — export `openWalkthrough` / `maybeOpenWalkthrough`
- `packages/vscode/src/__tests__/ide-mode.test.ts` (+99), `contributes-view-gating.test.ts` (+144), `workspace-detector.test.ts` (+95) — new test files
- `codev/resources/arch.md` (+3 / -1), `codev/resources/lessons-learned.md` (+2 / -0) — governance updates (below)
- `codev/plans/1144-…md` (+107), `codev/state/pir-1144_thread.md` (+29), `codev/projects/…/status.yaml` (+22) — protocol artifacts

## Commits

- `18eb3da0` [PIR #1144] Dual-mode activation: tier-gated side effects, context keys, empty-window surfaces
- `57f1531d` [PIR #1144] Tests: behavior-matrix policy + package.json gating invariants
- `c18f3a01` [PIR #1144] Gate viewsWelcome on codev.stateKnown to kill the pre-activation welcome flash
- `3a4b2e51` [PIR #1144] Replace the raw no-provider message with a Loading Codev placeholder
- `40028e77` [PIR #1144] Detection: the opened folder must itself be a codev root (drop ancestor walk)
- `555633a4` [PIR #1144] codev.hasWorkspace means codev-workspace-presence, not folder-presence

## Test Results

- `pnpm compile` (check-types + lint + esbuild): ✓ pass
- `pnpm test:unit`: ✓ pass — 578 tests, 31 new across the three new files
- Manual verification (human, at the dev-approval gate, via the Extension Development Host): the no-workspace guest window renders no dead actions; the pre-activation flash and the raw no-provider message were caught live and fixed; the non-codev-folder-under-home leak was caught live and fixed. Marketplace-inertness, IDE-simulation, and codev-workspace regression scenarios per the plan's test matrix.
- Build note: a fresh worktree needs `pnpm --filter @cluesmith/codev-types --filter @cluesmith/codev-core --filter @cluesmith/codev-artifact-canvas build` before the extension compiles (known pattern, lesson From #907).

## Architecture Updates

Routed to **COLD** `codev/resources/arch.md` (VS Code Extension → Key Design Decisions): a new "IDE-mode dual activation + layer model (#1144)" entry covering the runtime appName contract, the activation-tier/policy model and its inertness guarantee, the three context keys and their exact semantics, and the runtime-code-only constraint on first-launch surfaces. Also corrected the architecture diagram's WorkspaceDetector line (it described the now-removed ancestor walk). Nothing routed to the HOT tier: the layer model is load-bearing but extension-scoped, not a cross-cutting fact that should displace an existing hot entry.

## Lessons Learned Updates

Routed to **COLD** `codev/resources/lessons-learned.md`:

- UI/UX: unset VS Code context keys evaluate false, so negated-key `when`/`viewsWelcome` clauses assert wrong states during the pre-activation gap; the `stateKnown`-key + loading-welcome pattern.
- Architecture: when activation becomes ambient, detection heuristics become inertness gates and must be downgraded to exact rules; audit convenience heuristics whenever the trigger that constrained them broadens.

Nothing routed to the HOT tier: both lessons are situation-specific recipes, not behavior-changing cross-cutting rules worth a displacement.

## Things to Look At During PR Review

- `ide-mode.ts:32` — `CODEV_IDE_APP_NAME = 'Codev'` is the cross-repo contract with the fork's product.json `nameLong`. **The fork rebrand has not landed and the final string ('Codev' vs 'Codev IDE') is still being confirmed**; it is single-sourced so a differing confirmed value is a one-line edit (tests import the constant).
- The dormant path registers all commands and providers but skips `connectionManager.initialize()`. Anything added to `activate()` in the future that has a side effect must consult `activationPolicy` — the policy object is the checklist.
- The detection change (`workspace-detector.ts`) affects which Tower workspace every window attaches to, not just view visibility. Subfolder-of-repo windows now go dormant by design; the `codev.workspacePath` setting override is the documented escape hatch.
- Built-in vs marketplace-copy collision inside the IDE (acceptance item): both channels ship the same extension ID and VS Code lets the user-installed copy shadow the built-in. Safe by design: IDE mode is detected from appName at runtime, not install channel, so a newer marketplace copy inside the IDE behaves identically; shadowing is simply the update path. Documented at the constant in `ide-mode.ts`.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder pir-1144 → **View Diff**
- **Extension scenarios** (Extension Development Host from `packages/vscode`, F5):
  1. Guest inertness: `afx tower stop`, launch EDH with no folder → no process on port 4100, no status bar, no toasts; Codev icon shows Agents with the guest welcome only.
  2. Codev workspace regression: open this repo → today's full experience, Tower auto-starts.
  3. IDE simulation: launch EDH with `CODEV_SIMULATE_IDE=1`, no folder → container focused, IDE welcome (Open Folder / Open Recent / Get Started), first-run toast + walkthrough once, not on relaunch.
  4. Non-codev folder (incl. one under a codev-enabled home dir) → dormant; no Workspace rows, guest welcome shows.
- **Unit tests**: `pnpm --filter codev-vscode test:unit`
