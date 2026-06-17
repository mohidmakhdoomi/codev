# PIR #982 — Review iteration 1 disposition

Single advisory pass (`max_iterations: 1`). Verdicts: claude=APPROVE, codex=REQUEST_CHANGES, gemini=skipped.

## codex — REQUEST_CHANGES (HIGH): Recover ran from the wrong cwd — ADDRESSED (fixed in code)

**Finding:** The **Recover Builders** action launched `afx workspace recover` with `cwd: workspacePath` from `connectionManager.getWorkspacePath()`. Because `detectWorkspacePath` (`workspace-detector.ts`) walks up to the first directory containing `codev/`, and a builder worktree (`.builders/<id>`) is a full checkout with its own `codev/`, a VSCode window *rooted at* a worktree resolves `getWorkspacePath()` to the worktree — so recovery would run inside the worktree, contradicting repo guidance that `afx` must run from the main checkout root.

**Assessment:** Real defect, confirmed against `workspace-detector.ts:9-20` (`findProjectRoot` stops at the first `codev/`). HIGH confidence is warranted for the worktree-rooted-window scenario.

**Fix (commit on branch):**
- Added `mainCheckoutRoot(workspacePath)` in `packages/vscode/src/terminal-resolve.ts` — strips a trailing `/.builders/<id>` segment (leaf-only; tolerates trailing slash and Windows separators), returning a normal main-checkout path unchanged.
- `promptNoTerminalRecovery` now uses `cwd: mainCheckoutRoot(workspacePath)` for the recover terminal.

**Regression coverage:**
- 5 behavioral tests for `mainCheckoutRoot` (unchanged path / strip worktree / trailing slash / non-leaf no-op / Windows separators).
- The `terminal-manager.ts` source-level guard now asserts `cwd: mainCheckoutRoot(workspacePath)` — it fails if the cwd reverts to the raw workspace path.

**Scope note:** The same `cwd: workspacePath` pattern for an `afx` command pre-exists in `run-worktree-setup.ts` (`afx setup`) and other call sites. A consistent main-root resolution across *all* afx invocations is broader than #982; this PR fixes only the affordance it introduces and flags the rest as a follow-up.

## codex — test-coverage note: ADDRESSED

The original source-level regex test would not have caught a wrong cwd. The new behavioral `mainCheckoutRoot` tests plus the tightened source-level assertion now pin the corrected behavior.

## gemini — skipped (non-blocking)

Antigravity `agy` CLI not installed in this environment; no review content. No action.

## claude — APPROVE

No changes requested.

## Escalation

PIR is single-pass: this fix will **not** be independently re-reviewed by the models. The human at the `pr` gate is the only remaining reviewer of the fix — flagged in the architect notification.
