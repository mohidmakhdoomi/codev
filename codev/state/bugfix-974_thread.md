# bugfix-974 — scrollController stale test

## Issue
`packages/dashboard/__tests__/scrollController.test.ts` →
`onScroll handler > warns on unexpected scroll-to-top but does not auto-correct (Issue #630)`
fails deterministically on clean main: `expected "warn" to be called ... Number of calls: 0`.

## Investigation
- Reproduced clean baseline (after `pnpm --filter @cluesmith/codev-core build`):
  `1 failed | 316 passed | 1 skipped (318)` — sole failure is this test.
- `git log -S "unexpected scroll-to-top"` traced the warn path:
  - `42980bfa` added scroll-to-top correction + `console.warn`.
  - `28ef9307` / `a4eaea54` iterated on it (diagnostic vs jump-threshold correction).
  - **`a4c131ef` (v3.0.0-rc.6) deleted the entire diagnostic/correction block** from
    `scrollController.ts handleScroll` — root cause fixed upstream by blocking ESC[3J
    (`eraseInDisplay` case-3 interception in Terminal.tsx) + WebGL context-loss handler
    + EscapeBuffer. That commit touched ONLY the source, not the test.
- Result: test still asserts `console.warn('...unexpected scroll-to-top...')` that no
  longer exists by design.

## Root cause
Stale test, not a code regression. The warn diagnostic was intentionally removed; the
user-facing mitigation lives in `Terminal.tsx` (still intact: lines ~252 WebGL,
~343-355 ESC[3J block, ~418 EscapeBuffer).

## Fix shape
Update the test to pin current correct behavior: scroll-to-top is accepted (state
updated to viewportY=0), NOT auto-corrected (no scrollToLine/scrollToBottom), and NOT
warned. Asserting `warn` is NOT called turns the test into a guard against the
correction-hack being re-added. No source change — mitigation preserved.
