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
