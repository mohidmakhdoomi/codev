# PIR #989 — guarded-command feedback (modal-first / ephemeral-after)

## Plan phase

Issue: vscode guarded commands go silent after the first "run setup" toast because
`setupToastShown` is a one-shot session suppressor. Want point-of-action feedback on
every click: modal first time, ephemeral status-bar message thereafter.

Key code:
- `packages/vscode/src/preflight/preflight.ts:244-261` — `showSetupRequiredToast` + `setupToastShown`
- `packages/vscode/src/preflight/preflight.ts:176-181` — flag reset on recheck→ok
- `packages/vscode/src/extension.ts:526-529` — `guard` wrapper calls the toast
- `packages/vscode/src/preflight/preflight-core.ts` — pure logic home (unit-tested)

Design: extract a reusable `showPreflightFeedback` helper; pure wording derivation in
preflight-core for testability; modal-vs-ephemeral chosen by a session flag that resets
on recheck→ok (unchanged semantics). Sets up #983 reuse (Tower dimension).

Wrote plan to `codev/plans/989-vscode-guarded-command-feedbac.md`. Awaiting plan-approval.

## Implement phase

Plan approved. Implemented as planned (no deviations):
- `preflight-core.ts`: new pure `preflightFeedbackMessage(status)` (em-dash-free copy:
  `Codev: CLI <state>. Run "Codev: Recheck CLI" when ready.`).
- `preflight.ts`: `showSetupRequiredToast` → `showPreflightFeedback`; flag
  `setupToastShown` → `modalShownThisSession`; modal first, `setStatusBarMessage(..., 4000)`
  after. Reset-on-recheck→ok unchanged.
- `extension.ts`: import + guard call renamed; updated the stale "single toast" comment.
- `preflight-core.test.ts`: +3 cases for the new helper.

Checks: porch build ✓ (6.8s), tests ✓ (20.7s, 287 pass / +3 new). Note: fresh worktree
needed `@cluesmith/codev-core` + `-types` built first or check-types fails on missing
declarations (env state, not my change).

Awaiting dev-approval.

## Review phase

dev-approval approved. Wrote `codev/reviews/989-vscode-guarded-command-feedbac.md`
(Summary / Files / Commits / Test Results / Architecture Updates [none] / Lessons [none] /
Things to Look At / How to Test Locally). No arch.md or lessons-learned.md changes needed.
Opening PR with the review as body (Fixes #989), recording with porch, then porch runs the
single-pass 3-way consult. Will lead architect notification with any REQUEST_CHANGES.
