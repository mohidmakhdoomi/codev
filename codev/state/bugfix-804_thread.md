# bugfix-804 — vscode: don't force-create a second editor group for builder terminals

## Investigate

Root cause: `packages/vscode/src/terminal-manager.ts` `openTerminal()` else-branch
unconditionally sets `location = { viewColumn: vscode.ViewColumn.Two }` for builder/shell
terminals. `ViewColumn.Two` is fixed by ordinal, so VS Code creates a second editor group
on demand when only one group exists — reshaping the user's layout.

Fix: when the else-branch resolves, pick Two only if ≥2 tab groups already exist, else One.
Architect (`ViewColumn.One`) and dev/panel terminals untouched.

Test pattern: `terminal-manager.test.ts` uses source-level regex assertions (full
TerminalManager needs heavy vscode mocking). Regression test follows same pattern.

## Implement (done)

- `terminal-manager.ts`: else-branch now computes `hasSecondGroup =
  vscode.window.tabGroups.all.length >= 2`; Two when true, One otherwise. Used
  if/else (not the issue's proposed ternary). Architect/dev/panel untouched.
- Added 3 source-level regression tests (#804 block).
- `pnpm test:unit terminal-manager` → 15 passed. `pnpm check-types` → clean.
- vscode-extension-only change; no codev-skeleton mirror needed.
