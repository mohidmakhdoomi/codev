# PIR Review: Overwrite reconnect notices in place, wipe on successful reconnect

Fixes #1001

## Summary

The VSCode terminal adapter wrote a fresh `\r\n`-terminated "Connection lost — retrying…" line on every reconnect attempt, so notices stacked in scrollback and were never cleared when the connection came back — leaving orphaned status lines above the resumed output. This change adopts the overwrite-in-place pattern the original `#936` PR intended: each retry notice now leads with `\r\x1b[2K` (carriage return + erase-line) and drops its trailing newline, so only one notice line is ever visible and the attempt counter ticks `1/6 → 6/6` in place. A `hadReconnectNotice` flag drives a `clearReconnectNotice()` helper called from the `ws.on('open')` success path, which wipes that single line before Tower's replayed buffer resumes. The give-up (`#939`) state overwrites the last retry notice but is itself never wiped, so it remains visible as the terminal failure state.

## Files Changed

- `packages/vscode/src/terminal-adapter.ts` (+40 / -3)
- `packages/vscode/src/__tests__/terminal-adapter.test.ts` (+78 / -0)

## Commits

- `c0d2f6cf` [PIR #1001] Plan draft
- `fc6c9bc7` [PIR #1001] Overwrite reconnect notices in place and wipe on successful reconnect
- `e8c1c846` [PIR #1001] Thread: implement phase complete

## Test Results

- `pnpm check-types`: ✓ pass
- `pnpm lint`: ✓ pass
- `node esbuild.js` (bundle): ✓ pass
- `pnpm test:unit` (`vitest run`): ✓ pass (336 tests, 6 new for PIR #1001)
- Manual verification: human approved at the `dev-approval` gate — confirmed working as expected (single notice line ticking in place, cleared on reconnect, give-up state preserved).

## Architecture Updates

No arch changes — this is a localized rendering fix within `CodevPseudoterminal`'s existing reconnect loop. It introduces no new module boundaries, dependencies, or patterns; it completes the in-place-overwrite mechanic the `#936` reconnect overhaul (already documented) had only partially implemented.

## Lessons Learned Updates

No new durable lesson worth promoting to `codev/resources/lessons-learned.md`. The one notable point is local-and-already-recorded in arch convention: transient terminal status notices should overwrite in place (`\r\x1b[2K`) and pair every "lost"-side write with a symmetric "recovered"-side wipe, rather than appending `\r\n`-terminated lines that orphan in scrollback. This is captured in the code comments at the change site and in the issue thread; it does not generalize beyond terminal-notice rendering.

## Things to Look At During PR Review

- **First-notice erase vs. partial output (acceptance criterion 4):** the leading `\r\x1b[2K` on the *first* retry notice erases whatever is on the terminal's current line, which can be a partial last line of real output if the drop happened mid-stream. This is intentional and safe because Tower replays its full scrollback buffer on every reconnect (the `pause`/`resume` path in `handleControlMessage`), so the content is re-rendered after the success-wipe. Verified manually at the dev-approval gate.
- **`giveUp()` conditional prefix:** the erase prefix is applied only when `hadReconnectNotice` is true (exhausted-budget path, where a retry notice is on the line). The immediate-4xx path writes no prefix so it doesn't disturb an unrelated current line — covered by the `immediate 4xx give-up has no erase prefix` test.
- **Em dashes dropped from both notice messages** ("Connection lost. retrying…" and the give-up text) per project convention. The issue only requested it for the retry notice; the give-up line was edited anyway for the conditional prefix, so its dash was aligned for consistency. Flagged at the plan gate; approved.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder pir-1001 → **View Diff**
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-1001`
- **What to verify**:
  - Open a Codev terminal, bounce Tower (`afx tower stop && afx tower start`) within the first 2-3 backoff intervals → a single notice line ticks the attempt counter in place; no orphaned `[Codev: Connection lost…]` line remains after reconnect.
  - Run `yes | head -200`, bounce Tower mid-stream → no garbled output after reconnect (replay restores it).
  - Keep Tower down past 6 attempts → the red `Click here to reconnect` give-up notice remains visible and is not wiped.
