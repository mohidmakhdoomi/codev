# air-1074 — vscode: align backlog issue-preview placement (remove focus side-effect)

## Implement phase — BLOCKED on a baked-decision / API-fact conflict (2026-06-19)

Read the issue, the current `view-issue.ts:160-175`, the target pattern
`terminal-manager.ts:478-484`, and the existing `codev.openMarkdownPreview`
(`extension.ts:795-805`, which uses `vscode.openWith` + an explicit ViewColumn,
NOT the built-in markdown command).

Before coding against the issue's proposed call
`executeCommand('markdown.showPreview', uri, viewColumn, /* preserveFocus */ true)`,
I verified the built-in command's real signature against the bundled VS Code
1.124.2 markdown extension
(`/Applications/Visual Studio Code.app/.../markdown-language-features/dist/extension.js`).

**Finding (airtight):** `markdown.showPreview` does NOT accept an explicit
`viewColumn` and has NO `preserveFocus` param.

- `ShowPreviewCommand.execute(e, r, n)` → `e`=mainUri, `r`=allUris (iterated only
  if it's an array; a number falls back to `[e]`), `n`=settings where ONLY
  `n.locked` is read and `sideBySide` is hardcoded `false`.
- The internal `showPreview` computes
  `previewColumn = n.sideBySide ? Beside : (activeTextEditor?.viewColumn || ViewColumn.One)`.
- So the preview ALWAYS opens in the **active editor group**; the passed
  `viewColumn` (2) is silently dropped, and `true` (preserveFocus) only yields
  `true.locked === undefined` → no effect.

**Consequence:** 3 acceptance criteria + plan-gate decision #2 are unsatisfiable
as written. The built-in dynamic markdown preview anchors to the active editor
group by construction, so "explicit group-2 placement" + "preserve focus on the
sidebar click origin" can't both hold without a custom editor
(`vscode.openWith` / a WebviewPanel with `{viewColumn, preserveFocus}`) — which
the issue explicitly ruled out of scope (#1068).

**Action:** escalated to architect via `afx send` with evidence + options. Waiting
for direction before implementing. NOT relitigating inside spec/plan/review (none
exist in AIR) — surfacing per the Baked-Decisions rule.

### Options presented to architect
1. Custom editor via `vscode.openWith` (the existing Codev MarkdownPreviewProvider
   pattern from `codev.openMarkdownPreview`) — DOES take an explicit ViewColumn +
   `{preserveFocus}`. Satisfies all criteria but overlaps #1068's "off built-in
   preview" scope. Need a ruling on whether that's acceptable here.
2. Keep `markdown.showPreviewToSide` but make placement deterministic by focusing
   the *computed* target group (group 2 if it exists, else group 1) instead of
   always group 1. Removes the Beside-chaining + "group 1 closed" fragility but
   RETAINS a focus side-effect (fails the "preserve focus" criterion).
3. Redefine the acceptance criteria given the API reality.

## Implement phase — RESOLVED + DONE (2026-06-19)

Architect chose a corrected option 1: open the BUILT-IN preview's custom-editor
viewType `vscode.markdown.preview.editor` (NOT Codev's `codev.markdownPreview`,
so no #1068 overlap) via `vscode.openWith`, which DOES accept an explicit
ViewColumn + `{ preserveFocus }`.

Verified the viewType against bundled VS Code 1.124.2 markdown-language-features
manifest: `vscode.markdown.preview.editor`, priority "option", selector `*.md`
(our `codev-issue:<id>.md` URI path ends in `.md` → matches). Precedent for
`vscode.openWith` in our code: `extension.ts:804`, `view-artifact.ts:127`.

Implementation (`commands/view-issue.ts`):
- Removed the `workbench.action.focusFirstEditorGroup` call.
- Added pure helper `pickIssuePreviewColumn(groupCount)` → ViewColumn.Two when
  `>= 2`, else ViewColumn.One (if/else, no ternary, mirrors terminal-manager).
- Call site: `vscode.openWith` + `vscode.markdown.preview.editor` +
  `{ viewColumn, preserveFocus: true }`, column from
  `vscode.window.tabGroups.all.length`.
- Unit test `src/__tests__/view-issue-column.test.ts` (4 cases: 2→Two, 3/5→Two,
  1→One, 0→One) following the diff-nav minimal-vscode-mock pattern.
- Cache/refresh/close-cleanup (`IssueContentProvider`, `OverviewCache.onDidChange`,
  `onDidCloseTextDocument`) untouched.

Verification: `pnpm check-types` clean, `eslint` clean, full `vitest run` =
35 files / 446 tests pass (incl. the 4 new). (First suite run showed 8 files
failing to resolve `@cluesmith/codev-core` — pre-existing unbuilt-dep issue in
a fresh worktree; building core+types fixed it, unrelated to this change.)

Next: PR with review in the PR body, then `afx send architect`.
