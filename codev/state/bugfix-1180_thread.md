# bugfix-1180 — vscode: raise per-window terminal cap + expose as codev.maxTerminals

## Investigate

Issue #1180: VS Code extension caps concurrent terminals at 10 via static
`MAX_TERMINALS = 10` (`packages/vscode/src/terminal-manager.ts:10`), enforced in
`openTerminal` at `:465-468`. Impractical in multi-architect workspaces (each
architect consumes a slot). Tower's own backstop is 100, so nothing infra-side
requires the client cap to be 10.

Root cause confirmed: static constant, no config surface.

Fix (per issue):
1. New `codev.maxTerminals` setting in package.json (default 25, min 5, max 100).
2. Read it in the enforcement path; updated toast points at the setting.
3. Replace static constant with `DEFAULT_MAX_TERMINALS = 25` used as the getter default.

Test harness: `src/__tests__/terminal-manager.test.ts` uses source-level regex
guards (constructing TerminalManager needs heavy vscode mocking). Will add a
source-level guard verifying the setting is read and the cap enforced at the
configured value, matching the file's established pattern.

Scope: 2 files + test. Well within BUGFIX.

## Fix

Implemented:
- `terminal-manager.ts`: `MAX_TERMINALS = 10` → `DEFAULT_MAX_TERMINALS = 25`;
  `openTerminal` now reads `codev.maxTerminals` via config getter; toast points at
  the setting. Two doc-comment references updated to `codev.maxTerminals`.
- `package.json`: new `codev.maxTerminals` number setting (default 25, min 5,
  max 100) with a memory-vs-capacity markdownDescription.
- Test: added `#1180` source-level guards + a package.json schema assertion to
  `terminal-manager.test.ts` (matches the file's existing source-guard harness).

Verification: full vscode vitest suite green — 632 tests / 53 files pass.
(Note: a fresh worktree needs `@cluesmith/codev-core` + `@cluesmith/codev-types`
built first, else 16 suites fail on module resolution — unrelated to this fix.)
check-types clean. Net diff ~67 lines across 3 files.

