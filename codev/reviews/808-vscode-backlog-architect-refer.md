# PIR Review: Inject issue title into backlog → architect reference

Fixes #808

## Summary

The Backlog inline action **Reference Issue in Architect** previously injected only `#<id> ` into the architect terminal's prompt buffer, forcing the user (and the architect AI) to look up the title before the prompt carried any working context. This PR threads the title through as a typed field on `BacklogTreeItem`, formats the injection as `#<id> "<title>" ` (with `"` → `\"` escaping and a fallback to the old `#<id> ` form for empty/missing titles), and adds direct unit coverage for the formatting helper.

## Files Changed

- `packages/vscode/src/architect-reference-injection.ts` (+21 / -0, new) — pure helper that builds the injection string; no `vscode` deps so it can be unit-tested directly.
- `packages/vscode/src/__tests__/architect-reference-injection.test.ts` (+47 / -0, new) — 6 tests covering title-present formatting, multi-quote escape, undefined/empty fallback, and backslash passthrough.
- `packages/vscode/src/extension.ts` (+25 / -1) — `extractIssueTitle(arg)` alongside `extractIssueId(arg)`; `codev.referenceIssueInArchitect` resolves both and passes them to the new helper.
- `packages/vscode/src/views/backlog-tree-item.ts` (+1 / -0) — `issueTitle: string` added as a readonly typed field on `BacklogTreeItem` next to `issueId` / `issueUrl`.
- `packages/vscode/src/views/backlog.ts` (+1 / -1) — `makeRow` passes `item.title` (the undecorated title from `OverviewBacklogItem`) into the new `BacklogTreeItem` constructor slot.
- `packages/vscode/src/__tests__/extension-architect-commands.test.ts` (+5 / -3) — source-sentinel regex updated to assert on the helper call rather than the old inline template literal; the spirit of the assertion (still no architect-name arg → defaults to `'main'`) is preserved.
- `codev/plans/808-vscode-backlog-architect-refer.md`, `codev/state/pir-808_thread.md` — protocol artifacts.

## Commits

- `5160a438` [PIR #808] Inject issue title into architect reference
- `f55896c8` [PIR #808] Update thread for implement phase
- `792b56bb` [PIR #808] Plan draft

(Porch state-transition commits omitted from the human-relevant list — they're visible in `git log` for audit.)

## Test Results

- `pnpm check-types` (vscode): ✓ pass (clean, no errors)
- `pnpm lint` (vscode): ✓ pass
- `node esbuild.js` (vscode): ✓ pass
- `pnpm test:unit` (vscode): ✓ 55 tests pass (49 baseline + 6 new in `architect-reference-injection.test.ts`)
- Porch gate checks at `implement → dev-approval`: `build` ✓ (5.4s), `tests` ✓ (20.5s)
- Manual verification: human reviewed the running worktree at the `dev-approval` gate and approved.

## Architecture Updates

No arch changes — the change is local to the VSCode extension's backlog command handler and one tree-item class. No new module boundaries, no new patterns. The "pure helper in its own file so it can be unit-tested without mocking `vscode`" approach (`architect-reference-injection.ts`) is a continuation of the existing precedent set by `prune-builder-terminals.ts`, not a new architectural rule.

## Lessons Learned Updates

No lessons captured — the change was mechanical (thread a field, escape one character, branch on a fallback). The one decision worth noting in the per-PR review (and already in the plan) was extracting the helper into its own file rather than exporting from `extension.ts`, but that's a re-use of an existing pattern, not new wisdom.

## Things to Look At During PR Review

- **Helper-file extraction vs plan.** The plan said `buildArchitectReferenceInjection` would be exported from `extension.ts`. I moved it into `packages/vscode/src/architect-reference-injection.ts` so the unit test can import the live function — `extension.ts` imports `vscode` at top level and won't load under vitest's node env without mocking the whole module. Same precedent as `prune-builder-terminals.ts`. The plan's intent (direct unit coverage of escape + fallback) is preserved.
- **Backslash policy.** Acceptance criteria specify `"` escaping only; titles with literal `\` pass through unmodified. The rationale is in `architect-reference-injection.ts`'s docstring: double-escaping would diverge from the visible row label (`#id title @author`), surprising the user.
- **Empty-title normalisation.** `extractIssueTitle` returns `undefined` for an empty string so the fallback branch in the helper is identical to the missing-title path. The helper *also* guards against `''` independently — defense in depth in case a future caller skips the wrapper.
- **Source-sentinel test loosening.** The pre-existing assertion at `extension-architect-commands.test.ts:84` regex-matched the literal `injectArchitectText(\`#\${issueId} \`)`. The new assertion matches `injectArchitectText(buildArchitectReferenceInjection(...)` — tight enough to catch a regression to the old inline shape, broad enough to not break if the helper's argument order or layout changes. Worth eyeballing.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-808` → **View Diff**
- **Run dev server**: VSCode sidebar → right-click → **Run Dev Server**, or CLI `afx dev pir-808`
- **What to verify**:
  - Open the Codev sidebar → Backlog view. Click the "Reference Issue in Architect" inline button on any backlog row. The architect terminal opens and focuses; the prompt buffer contains `#<id> "<title>" ` with the cursor after the trailing space, no Enter sent.
  - Try a backlog item whose title contains a literal `"` (the unit test `'Has "quoted" word'` covers this in code — for a live test, any GitHub issue with quotes in its title works). The buffer should show `\"` for each occurrence.
  - Confirm the fallback case via the unit tests (an empty-title backlog item is hard to reproduce in the wild).

No new dependencies, no contribution-point changes, no settings.
