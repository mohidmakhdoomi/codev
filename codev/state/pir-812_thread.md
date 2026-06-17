# pir-812 thread — vscode Codev panel tab scaffolding

## Plan phase (2026-06-04)

Investigated `packages/vscode`. Findings:
- `contributes.viewsContainers` has only `activitybar.codev`; views wired in `src/extension.ts` ~L326–356.
- Context keys via `setContext` (precedent `codev.teamEnabled` at L507); view `when` clauses honored.
- TreeDataProvider precedent: `src/views/recently-closed.ts` (35 lines).
- package.json contributions are unit-tested: `src/__tests__/contributes-*.test.ts`.
- Verified follow-up issues: #813 Recently Closed, #814 Team, #815 Status — placeholder text matches.

Design note: `visibility: 'collapsed'` is a *view* property, not a container property. Container being collapsed is satisfied because contributing a panel container doesn't auto-open the bottom panel; placeholder view also set `visibility: collapsed`. Toggle command `workbench.view.extension.codevPanel` is auto-generated from container id.

Plan written to `codev/plans/812-vscode-introduce-a-codev-panel.md`. Awaiting plan-approval gate.

## Implement phase (2026-06-05)

Implemented per plan:
- package.json: added `viewsContainers.panel[codevPanel]` + `views.codevPanel[codev.placeholder]` (when `codev.panelContainerEmpty`, visibility collapsed).
- New `src/views/panel-placeholder.ts`: PanelPlaceholderProvider, one signpost row.
- extension.ts: import + register provider + `setContext codev.panelContainerEmpty true`.
- Tests: `__tests__/contributes-panel.test.ts` (manifest invariants), `__tests__/panel-placeholder.test.ts` (provider, vscode mocked).

Build/test: check-types ✓, lint ✓, esbuild ✓, vitest 293/293 ✓.
Note: initial unit run had 7 failures from unbuilt `@cluesmith/codev-types` (env, not my diff); built types+core, green after. Placeholder test needed a `vi.mock('vscode')` (TreeItem/ThemeIcon) since vitest runs in node env.

Committed 23cdfef9, pushed. Awaiting dev-approval gate.

## dev-approval feedback: first-run reveal (2026-06-05)

Reviewer noted the panel tab lands last and hides in the `...` overflow. VS Code exposes no order/position field for viewsContainers and no reposition API, so position can't be set directly. User chose: auto-reveal once on first install. Implemented in extension.ts — globalState-guarded `workbench.view.extension.codevPanel` call (key `codev.panelRevealedOnce`), fires once per profile. This intentionally reverses the issue's "don't auto-open" criterion #2; flag in PR/review. Added source-grep test for the guard. Commit f7628e50.

## Review phase (2026-06-05)

Wrote `codev/reviews/812-vscode-introduce-a-codev-panel.md` (Summary/Files/Commits/Test Results/Arch/Lessons/Things-to-look-at/How-to-test). Updated arch.md (panel container as second view-container location) and lessons-learned.md ([From 812] no panel-tab position control + first-run-reveal workaround). Committed 651063fa.

PR #990 opened (Fixes #812), recorded with porch. Running single-pass 3-way consult via `porch done`. Will notify architect with verdicts, then wait at `pr` gate.

## pr gate (2026-06-05)

3-way consult complete (single advisory pass). Verdicts: gemini=APPROVE, codex=APPROVE, claude=APPROVE — all HIGH, no key issues. (Codex consult died silently on first run producing no file; re-ran cleanly, 62.9s.) Claude's lone note: context key set after registration vs plan's "before" — no observable effect, not a bug. Architect notified. PR #990 at `pr` gate; waiting for human merge approval. No code changes needed.
