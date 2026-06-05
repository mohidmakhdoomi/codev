# PIR Review: Codev panel tab (bottom-area view container)

Fixes #812

## Summary

Introduces a panel-side viewsContainer (`codevPanel`) in the VS Code extension's bottom panel area (alongside Problems / Output / Terminal), as scaffolding for follow-up view migrations (#813 Recently Closed, #814 Team, #815 Status). The container hosts a single collapsed placeholder view that signposts those follow-ups and hides itself once a real panel view registers. No existing sidebar view moved. A one-time, globalState-guarded reveal opens the panel on first activation so users discover the new tab.

## Files Changed

- `packages/vscode/package.json` (+10 / -0) — `viewsContainers.panel[codevPanel]` + `views.codevPanel[codev.placeholder]`
- `packages/vscode/src/views/panel-placeholder.ts` (+24 / -0) — new `PanelPlaceholderProvider` (one signpost row)
- `packages/vscode/src/extension.ts` (+18 / -0) — register provider, seed `codev.panelContainerEmpty`, one-time first-run reveal
- `packages/vscode/src/__tests__/contributes-panel.test.ts` (+87 / -0) — manifest + wiring invariants
- `packages/vscode/src/__tests__/panel-placeholder.test.ts` (+47 / -0) — provider returns the follow-up signpost row
- `codev/plans/812-vscode-introduce-a-codev-panel.md` (+104 / -0) — approved plan
- `codev/state/pir-812_thread.md` (+31 / -0) — builder narrative

## Commits

- `e1918087` [PIR #812] Update builder thread (first-run reveal)
- `f7628e50` [PIR #812] Reveal panel once on first run for discoverability
- `7bbfde65` [PIR #812] Update builder thread (implement)
- `23cdfef9` [PIR #812] Add Codev panel container with placeholder view
- `80afa483` [PIR #812] Plan draft

## Test Results

- `pnpm check-types`: ✓ pass
- `pnpm lint`: ✓ pass
- `node esbuild.js` (bundle): ✓ pass
- `pnpm test:unit` (vitest): ✓ pass (293 tests, 16 new across two files)
- Porch gate `checks` (`build`, `tests`): ✓ pass
- Manual verification (dev-approval gate, Extension Development Host): the "Codev" tab appears in the bottom panel; the activitybar sidebar is unchanged with all seven views intact; opening the panel shows the single collapsed placeholder row pointing at #813/#814/#815. The reviewer confirmed the tab was reachable and, after the feedback round, that the first-run reveal surfaces it automatically.

## Architecture Updates

`codev/resources/arch.md` updated: the VS Code extension now contributes view containers to **two** locations (`activitybar.codev` and `panel.codevPanel`), not just the sidebar. This is a genuine new surface other views can target, so it's recorded in the extension section. No module-boundary or data-flow change — the panel view is a plain `TreeDataProvider` identical in kind to the existing sidebar providers.

## Lessons Learned Updates

`codev/resources/lessons-learned.md` updated with one entry: VS Code exposes **no** order/position control for panel view containers (the `viewsContainers` schema is `id`/`title`/`icon` only; there is no reposition API). A newly contributed panel tab lands last and spills into the `…` overflow. The only supported discoverability lever is a one-time, globalState-guarded reveal (`workbench.view.extension.<containerId>`) on first activation. Worth recording because it's a recurring constraint for any future panel-side surface.

## Things to Look At During PR Review

- **Scope deviation from the issue (intentional, approved at the dev-approval gate):** the issue's acceptance criterion #2 said the container should start collapsed and **not** auto-open, to avoid surprising existing installs on upgrade. The reviewer found the tab was effectively undiscoverable (last position, hidden behind the `…` overflow) and asked for it to be more visible. Since VS Code permits no positional control, the agreed resolution was a **one-time** reveal guarded by `context.globalState` (`codev.panelRevealedOnce`), firing once per profile rather than a permanent auto-open. This reverses criterion #2 as written; it was a deliberate decision made live at the gate, not an oversight. The placeholder view itself is still declared `visibility: collapsed`.
- **The `codev.panelContainerEmpty` context key** is seeded `true` unconditionally at activation. Follow-up PRs (#813/#814/#815) own flipping it `false` when they register real panel views, which auto-hides the placeholder. If a follow-up forgets, the placeholder will sit alongside real content — a cosmetic, self-evident bug, not a functional one.
- **Test strategy:** `panel-placeholder.test.ts` mocks `vscode` (vitest runs in a node env where the module is unresolvable), following the `overview-cache.test.ts` precedent. `contributes-panel.test.ts` asserts manifest shape and greps `extension.ts` source for the wiring (same sentinel style as `extension-architect-commands.test.ts`), since full activation needs the Electron host.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder pir-812 → **View Diff**
- **Run it**: this is a VS Code extension, so open `packages/vscode` and press **F5** (Extension Development Host) — `afx dev` does not exercise extension UI.
- **What to verify**:
  - First launch (fresh profile): the bottom panel opens once to the Codev tab (the first-run reveal). The single placeholder row references #813/#814/#815.
  - The activitybar Codev sidebar is unchanged — all seven views present and behaving as before.
  - Relaunch: the panel does not force itself open again (globalState flag set).
  - The tab is toggleable via `workbench.view.extension.codevPanel` from the command palette.
