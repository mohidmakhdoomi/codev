# bugfix-1110 thread

## Investigate

Issue #1110: flaky test `surfaces a synchronous FileAdapter.watch() failure via onError without throwing (D2)`
in `packages/artifact-canvas/src/components/__tests__/artifact-canvas.test.tsx`.

Verified root cause against source (lines 157-166):
- Line 163: `await waitFor(() => expect(onError).toHaveBeenCalled());`
- Line 164: bare synchronous `expect(document.querySelector('p[data-line]')).not.toBeNull();`

The async `read()` render can resolve after `onError` fires; under CI load the DOM query at
line 164 lands before the paragraph is in the tree. Race → intermittent failure.

Sibling test (line 171) uses the correct pattern: `await waitFor(() => expect(...).not.toBeNull())`.

Fix: wrap line 164's assertion in `waitFor`. One-line semantic-preserving change. Confirmed
BUGFIX scope (trivial, mechanical, no production code change).

## Fix

Applied the one-line change (line 164 wrapped in `waitFor`). Verified:
- `pnpm --filter @cluesmith/codev-artifact-canvas test` → 56/56 pass
- D2 test stress-run 5× in isolation → 5/5 pass
- porch checks: build ✓ (5.2s), tests ✓ (20.7s)
Committed `[Bugfix #1110]`, advanced to PR phase.

## PR

PR #1111 opened (https://github.com/cluesmith/codev/pull/1111).
Running CMAP (gemini/codex/claude) — consult needs `--issue 1110` to disambiguate
the many projects visible in this worktree's `codev/projects/`.

CMAP verdicts: gemini=APPROVE, codex=APPROVE, claude=APPROVE.
Claude flagged the identical bare-assertion race in the sibling D2 adapter-error
test (line 133) — the issue invited this ride-along, so applied the same waitFor
wrap (commit 846b53dc). 56/56 pass. Posted CMAP results as PR comment.

`pr` gate requested via `porch done`. Notified architect. **Waiting for human
approval** — will merge only after `porch approve bugfix-1110 pr`.
