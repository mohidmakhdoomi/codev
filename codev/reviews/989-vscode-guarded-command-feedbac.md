# PIR Review: Guarded-command feedback — modal-first / ephemeral-after

Fixes #989

## Summary

The CLI preflight (#791) guards 15 VSCode commands; when the CLI is `missing`/`outdated`
the first guarded click showed a modal "run setup" toast and a one-shot `setupToastShown`
flag silenced every click afterwards, so the user got no point-of-action feedback for the
rest of the session. This replaces the one-shot suppressor with a modal-first /
ephemeral-after pattern: the first bad-state click keeps the modal, subsequent clicks show
a brief auto-dismissing status-bar message naming the state and the recovery command. The
dispatch is factored into a reusable `showPreflightFeedback` helper (wording derived by a
new pure `preflightFeedbackMessage`) so #983 can route its Tower-version dimension through
the same channel.

## Files Changed

- `packages/vscode/src/preflight/preflight-core.ts` (+13 / -0) — new pure `preflightFeedbackMessage(status)`
- `packages/vscode/src/preflight/preflight.ts` (+36 / -21) — `showSetupRequiredToast` → `showPreflightFeedback`; flag rename; ephemeral branch
- `packages/vscode/src/extension.ts` (+8 / -4) — import + guard call renamed; updated the stale "single toast" comment
- `packages/vscode/src/__tests__/preflight-core.test.ts` (+19 / -0) — 3 cases for the new helper

## Commits

- `379b5eaa` [PIR #989] Add pure preflightFeedbackMessage helper + tests
- `647e8ff1` [PIR #989] Replace one-shot toast with modal-first / ephemeral-after feedback
- `796bbdb9` [PIR #989] Update thread for implement phase

## Test Results

- `npm run build`: ✓ pass (porch check, 6.8s)
- `npm test`: ✓ pass (porch check, 20.7s)
- `pnpm --filter @cluesmith/codev-vscode test:unit`: ✓ 287 pass (+3 new) — the suite that
  actually covers this diff (the root `build`/`test` filter `@cluesmith/codev-core` +
  `@cluesmith/codev`, not the vscode package)
- `pnpm --filter @cluesmith/codev-vscode compile`: ✓ check-types + lint + esbuild
- Manual verification (human, at the `dev-approval` gate): first click → modal with
  `Run Setup`; subsequent clicks → ephemeral status-bar message; recheck→ok resets the
  modal-first pattern; happy path runs with no feedback noise

## Architecture Updates

No arch changes — this PR swaps the behaviour behind an existing guard rejection path
(#791's preflight). No module boundaries, data flow, or patterns changed: the new pure
helper lives in the already-established `preflight-core.ts` (pure logic) / `preflight.ts`
(vscode glue) split, and the guard wiring in `extension.ts` is unchanged in shape (it still
calls one helper on rejection). `codev/resources/arch.md` needs no update.

## Lessons Learned Updates

No durable lessons captured — the change is a localized UX fix following the module's
existing pure-core / vscode-glue convention. One worth-noting-but-not-arch-worthy
observation is recorded here rather than in `lessons-learned.md` (too narrow to generalize):
porch's PIR `build`/`test` checks filter `@cluesmith/codev-core` + `@cluesmith/codev` and do
**not** build/run the `@cluesmith/codev-vscode` package, so a green porch gate does not by
itself prove a vscode-package diff — the package's own `compile` + `test:unit` (run manually
here) and the human dev-approval run are the real verification. `codev/resources/lessons-learned.md`
needs no update.

## Things to Look At During PR Review

- **The `cachedStatus as PreflightStatus` cast** in the ephemeral branch
  (`preflight.ts`). It's safe because `guard` only calls the helper when `isCliReady()` is
  false (excludes `ok` and `pending`), and `preflightFeedbackMessage` degrades to the
  "not installed" string for any non-`outdated` value, so a future invariant change is
  cosmetic, never a crash. Inline comment documents this.
- **The modal branch is byte-for-byte the old `showSetupRequiredToast` body** — acceptance
  required it "unchanged from today", so the `Run Setup` → walkthrough / outdated-notification
  routing is preserved verbatim; only the surrounding flag semantics and the new ephemeral
  branch changed.
- **No-arg helper vs the issue's `showPreflightFeedback(state)` signature** — deliberately
  deferred the `PreflightState` parameter to #983 (CLI state is module-level here; #983 adds
  the second Tower dimension that warrants the discriminator). Reviewed and accepted at the
  plan gate.
- **Ephemeral copy** uses a period + quoted command name instead of the issue's em-dash
  example (`Codev: CLI not installed. Run "Codev: Recheck CLI" when ready.`) — project
  no-em-dash convention; functionally identical.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder pir-989 → **View Diff**
- **Run dev server**: `afx dev pir-989` (or the sidebar **Run Dev Server**) — though for a
  VSCode extension the realer test is launching the Extension Development Host against this
  worktree (esbuild `watch`, then reload the dev host); no Tower restart involved
- **What to verify** (CLI in `missing`/`outdated` state):
  1. First click on a guarded command (e.g. Spawn Builder) → modal toast with `Run Setup`
  2. Second + third clicks → brief status-bar message naming the state + `Codev: Recheck CLI`, no modal
  3. `Codev: Recheck CLI` while still broken → next click still status-bar (no reset)
  4. Fix CLI, `Codev: Recheck CLI` → `ok` info toast; next breakage restarts at the modal
  5. Happy path (`ok`/`pending`) → guarded commands run normally, zero feedback noise
