# bugfix-1122 thread

Issue #1122 — vscode: align editor Comments-API review-comment write to append (`markerAppendLine`) for parity with the preview composer (#1107 follow-up).

## Investigate

Root cause confirmed (single site):
- `packages/vscode/src/comments/plan-review.ts` imports `markerInsertionLine` (line 24) and uses it at line 171 inside `submitReviewComment`. `markerInsertionLine(line)` = `line + 1`, so a new comment lands BEFORE an existing stacked run (newest-first / prepend).
- Preview composer (`markdown-preview/preview-provider.ts`) already uses `markerAppendLine(text, line)` which scans past the contiguous marker run → newest-last / append.
- `markerAppendLine` already exists in core (`packages/core/src/review-markers.ts:102`) with 3 passing regression tests. No core change needed.

Fix plan (fix phase):
1. Swap import `markerInsertionLine` → `markerAppendLine`.
2. In `submitReviewComment`, `document` is already loaded via `openTextDocument`; add `const text = document.getText();` and call `markerAppendLine(text, line)`.
3. Regression test: `submitReviewComment` is not currently exported. Export it (minimal) and add a vitest test under `src/__tests__/` mocking `vscode`, asserting a reply to a thread with two existing stacked markers inserts at line N+run (past the run), and that the zero-marker first-comment case is unchanged.

Scope: ~1 LOC behavioural change + test. Well within BUGFIX.

## Incident (self-inflicted, recovered)

While proving the regression test fails without the fix, I ran a `git stash push`
(to temporarily set my changes aside) that errored on an untracked-file pathspec,
then a paired `git stash pop` — which popped the PRE-EXISTING `stash@{0}: On main:
!!GitHub_Desktop<main>` (the user's uncommitted GitHub Desktop work) INTO this
worktree. That partially applied 44 files (32 new under `apps/codev-desktop/`,
`dev_docs/`, `.claude/settings.local.json`; 12 tracked modifications) with
conflicts, leaving conflict markers in `packages/codev/package.json` etc. and
breaking the build (EJSONPARSE on the conflict marker).

Recovery (surgical, non-destructive to user data):
- The pop hit conflicts, so the stash was KEPT — `stash@{0}` never dropped; the
  user's work was never at risk.
- Confirmed all 44 files are preserved in `stash@{0}` and that `apps/`, `dev_docs/`,
  `.claude/settings.local.json` are absent from HEAD (`git ls-tree HEAD`).
- `git reset --hard HEAD` reverted the 12 tracked modifications and removed the 32
  staged-new files (they were staged by the pop, so hard-reset deletes them).
- Restored my own `plan-review.ts` fix from a backup; test file + thread survived
  (untracked, untouched by reset).
- Verified `git stash list` still shows `stash@{0}` intact afterward.

Lesson: NEVER `git stash pop` in a worktree that carries a foreign pre-existing
stash — a bare pop targets `stash@{0}` regardless of intent. Use explicit file
backups (cp to /tmp) instead of stash for temporary set-aside, which is what I
should have done from the start.

## PR

- PR #1130 opened against main (Fixes #1122). Branch pushed, in sync with origin.
- CMAP (gemini/codex/claude, --type pr --issue 1122) running in background.
- `afx send architect` FAILED: "Workspace: not active in tower" / cannot resolve
  canonical builder id (#1094). This worktree isn't registered in Tower's state,
  so builder→architect messaging is down. Not fixing from the worktree (afx
  tower/workspace commands must run from the main root). Architect can see PR
  #1130 on GitHub; will retry `afx send` if the workspace gets activated.
- STASH HEADS-UP for architect (since messaging is down): stash@{0} (GitHub
  Desktop, on main) is intact and was never dropped — see the Incident section
  above. No action needed; flagging for transparency.

## CMAP verdicts (PR #1130)

- Gemini: SKIPPED (agy unavailable/unauthenticated — non-blocking).
- Codex: APPROVE, no key issues.
- Claude: APPROVE (HIGH), no key issues; confirmed the regression test fails under
  the old `markerInsertionLine` behaviour and parity with the preview composer.
- No REQUEST_CHANGES, no new defects. Posted summary as a PR comment.
- Next: `porch done bugfix-1122` to request the `pr` gate, then STOP for human approval.
