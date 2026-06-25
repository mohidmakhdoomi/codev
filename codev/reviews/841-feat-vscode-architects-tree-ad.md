# PIR Review: Architects tree — Add Architect UI, Cmd+K A picker, label casing

Fixes #841

## Summary

Closed the three follow-up gaps on the Spec 786 Architects tree in the VS Code extension: there was no UI to register a sibling architect (CLI-only), `Cmd/Ctrl+K A` always opened `main` even with siblings registered, and the architect rows rendered the raw lowercase name (so the default row showed `main`, the only lowercase label in the Workspace view). This PR adds a `codev.addArchitect` command (inline `+` on the Architects row + Command Palette), a QuickPick picker when `Cmd/Ctrl+K A` is invoked in a multi-architect workspace, and UPPERCASE display labels for all architect rows — with the name validator relocated to `@cluesmith/codev-core` so the extension and Tower share one rule.

## Files Changed

- `packages/core/src/architect-name.ts` (+75 / -0) — new; pure validator + name constants, moved here so the extension can reuse the exact rule Tower enforces
- `packages/core/package.json` (+4) — `./architect-name` subpath export
- `packages/codev/src/agent-farm/utils/architect-name.ts` (+13 / -64) — re-export shim from core; `currentArchitectName` (env-reading) stays local
- `packages/vscode/src/views/architect-display.ts` (+37 / -0) — new; vscode-free pure helpers `displayArchitectName` (UPPERCASE) and `sortArchitectsForPicker` (main-first)
- `packages/vscode/src/views/workspace.ts` (+9 / -3) — render rows via `displayArchitectName`; carry raw name in `item.id`
- `packages/vscode/src/extension.ts` (+82 / -6) — `codev.addArchitect` command; `Cmd+K A` picker; `removeArchitect` resolves raw name from `item.id`
- `packages/vscode/package.json` (+10) — command + inline-menu contributions
- `packages/vscode/src/__tests__/architect-display.test.ts` (+73 / -0) — new; behavior tests for the pure helpers
- `packages/vscode/src/__tests__/extension-architect-commands.test.ts` (+44 / -1) — sentinels for add/picker/remove
- `packages/vscode/src/__tests__/workspace.test.ts` (+11) — label-via-helper + `item.id` sentinels

## Commits

- `1f1d7868` [PIR #841] Relocate architect-name validator to codev-core (shared single source)
- `1dd370a6` [PIR #841] Add Architect UI, Cmd+K A picker, UPPERCASE architect labels
- `d2cf131d` [PIR #841] Tests for add-architect, picker, and label casing
- `b7054a86` [PIR #841] Update builder thread

## Test Results

- `npm run build`: ✓ pass (porch check, 22.7s — builds types, core, artifact-canvas, codev)
- `npm test`: ✓ pass (porch check, 21.3s — full codev suite: 3337 passed, 48 skipped)
- vscode unit (architect-relevant): ✓ 34 passed (`architect-display` + `extension-architect-commands` + `workspace`)
- `check-types` ✓, `eslint` ✓ (changed files), `esbuild` bundles ✓
- Manual verification: the human approved the running worktree at the `dev-approval` gate (Extension Development Host) — add via the inline `+`, picker on `Cmd+K A`, UPPERCASE rows, and Remove on a sibling.

## Architecture Updates

No arch changes needed. The validator relocation to `@cluesmith/codev-core` does not introduce a new module boundary — it follows the **already-established** `agent-names` precedent (a pure cross-package helper that lives in core and is re-exported from `packages/codev` so the VS Code extension can share identical semantics). The "VS Code Extension" topic in `arch.md` already covers sidebar views / commands / keybindings; this is an in-pattern extension of that surface, not a system-shape change. Nothing rises to the HOT `arch-critical.md` tier.

## Lessons Learned Updates

Routed one COLD lesson to `codev/resources/lessons-learned.md` (UI/UX section): when a tree-row's display label is transformed for presentation (here UPPERCASE) so it no longer equals the canonical identifier, any command that targets the row must read the identifier from a stable channel (`item.id`), not re-derive it from the now-cosmetic label — otherwise the row's action operates on the wrong (or a non-existent) entity. This is spec-narrow enough for the cold tier; it does not displace anything in HOT `lessons-critical.md`.

## Things to Look At During PR Review

- **Label ↔ Remove coupling (the load-bearing change).** Because labels are now UPPERCASE, `arg.label` (`WEB`) no longer equals the Tower identity (`web`). `getArchitectChildren` sets `item.id = workspace-architect-<rawName>` and `codev.removeArchitect` strips that prefix to recover the lowercase name, falling back to `arg.label` only if `id` is absent. If this regressed, Remove would DELETE a name Tower doesn't know. Covered by a sentinel test asserting `removeArchitect` reads `arg.id`.
- **Picker scope.** The QuickPick only appears for **no-arg** invocations (keybinding / palette) **and** `architects.length > 1`. Tree-row clicks pass an explicit name (unchanged); single-architect workspaces open `main` directly (no picker). Verify the single-architect path didn't regress.
- **Validation is advisory client-side.** The InputBox validates with the shared `validateArchitectName` for instant feedback, but Tower remains the source of truth for duplicates (which the pure check can't see); the handler surfaces Tower's `error` on failure.
- **Palette visibility.** `Codev: Add Architect` is intentionally palette-visible; `Codev: Remove Architect` stays row-scoped (`when: false` in `commandPalette`, per Spec 786). No `category` on `addArchitect` to avoid a double `Codev: Codev:` label.

## How to Test Locally

- **View diff**: VS Code sidebar → right-click builder `pir-841` → **View Diff**
- **Run dev server**: VS Code sidebar → **Run Dev Server**, or `afx dev pir-841`, then open the Extension Development Host
- **What to verify**:
  - Hover the **Architects** row → click `+` → enter `web` / `mobile` → row appears (UPPERCASE) without manual refresh; entering `main` / `Bad Name` / empty is rejected inline; `Codev: Add Architect` works from the palette too
  - `Cmd/Ctrl+K A` with a single architect opens `MAIN` directly; with siblings registered it shows a QuickPick (`MAIN` first, then alphabetical)
  - Right-click a sibling (`WEB`) → **Remove** → modal → row disappears and Tower deregisters `web`

## Flaky Tests

None skipped. Note (not flaky — pre-existing and unrelated): `packages/vscode/src/__tests__/terminal-adapter.test.ts` and `reconnect-link-provider.test.ts` fail to *collect* under plain vitest (dynamic `import('ws')` / `terminal-link-provider.js`); confirmed identical on the base branch via `git stash`. They are out of scope for this PR and are not run by porch's `tests` check (which scopes to `pnpm --filter @cluesmith/codev test`).
