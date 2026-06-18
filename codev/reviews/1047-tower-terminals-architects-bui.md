# PIR Review: Terminal freeze + blank-on-open (oversized-replay storm and missing connect-time redraw)

Fixes #1047

## Summary

Two client/server terminal bugs were fixed. (1) **Freeze:** a full-screen TUI (Claude's UI) redraws in place and emits almost no newlines, so Tower's reconnection buffers — bounded by *line count* — grew unbounded; the resulting multi-MB replay overflowed the VSCode client's 1 MB receive budget, and the client's "disconnect-and-reconnect for replay" response re-fetched the same oversized snapshot in a tight loop (~14k cycles/hour), pegging one CPU core and starving every terminal. (2) **Blank-on-open:** a freshly-attached terminal could render a blank pane until a manual window resize, because the connect-time resize could be a same-size no-op and a full-screen TUI only repaints on a size *change*. Tower now scans only new output (killing the O(n²) re-scan) and brackets replay with `pause`/`resume` so it is paced and excluded from backpressure; the client drops live output under overload instead of reconnecting, reconnects with a `?resume=<seq>` delta *for newline-bearing streams*, and forces a guaranteed redraw shortly after connect (mirroring the web dashboard). **Scope note:** the plan's byte-addressable seq and shellper-side byte cap (Fix B) were deliberately descoped during dev-approval — byte-trimming the buffer corrupts a full-screen TUI's replay (its alt-screen state lives in the cumulative stream), so `partial`/replay are kept whole. Consequence: for a pure no-newline TUI stream, a reconnect falls back to full (faithful) replay rather than a delta, and the shellper restart-replay is line-bounded only (unbounded for no-newline output — a memory trade-off the issue itself rated minor/orthogonal, now observable via the new partial-size monitor). The post-connect repaint nudge covers correctness in both cases.

## Files Changed

- `packages/codev/src/terminal/ring-buffer.ts` (+39 / -…) — `pushData` scans only the incoming chunk (O(|data|), not O(|partial|)); `partial` kept whole for faithful replay; `partialBytes` getter for observability.
- `packages/codev/src/terminal/pty-session.ts` (+14) — `attachShellper` idempotency (drop prior client listeners on re-attach); `partialBytes` passthrough.
- `packages/codev/src/terminal/pty-manager.ts` (+30 / -…) — `createSessionRaw` tears down a colliding session before overwrite; `inspectPartials()` for the monitor.
- `packages/codev/src/agent-farm/servers/tower-websocket.ts` (+8 / -…) — bracket replay with `pause`/`resume` control frames.
- `packages/codev/src/agent-farm/servers/tower-server.ts` (+32) — periodic ring-buffer-partial monitor (observability).
- `packages/vscode/src/terminal-adapter.ts` (+124 / -…) — replay excluded from backpressure; live overload **drops** instead of reconnecting; `?resume=<lastSeq>` delta reconnect; post-connect repaint nudge.
- `packages/codev/src/terminal/__tests__/ring-buffer.test.ts` (+25), `packages/codev/src/agent-farm/__tests__/tower-websocket.test.ts` (+14 / -…), `packages/vscode/src/__tests__/terminal-adapter.test.ts` (+137 / -…) — unit coverage.
- `packages/vscode/CHANGELOG.md` (+7) — user-facing entries for both fixes.
- `codev/resources/arch.md` (+4), `codev/resources/lessons-learned.md` (+3) — see sections below.

(`git diff --stat`: 12 files, +410 / -27, excluding plan/thread/status artifacts.)

## Commits

- `8868ac86` [PIR #1047] Fix A+E: byte-cap RingBuffer.partial (scan-only pushData) + reconnect listener hygiene
- `7d42dac9` [PIR #1047] Fix B: byte-cap ShellperReplayBuffer (bounds no-newline replay across restart)
- `f7e6b3a2` [PIR #1047] Fix C+D: pause/resume replay bracket, drop-not-reconnect on live overload, resume-delta reconnect
- `9f282745` [PIR #1047] Instrumentation: log terminal ring-buffer partial sizes on a Tower monitor interval
- `757a75a5` [PIR #1047] Update tower-websocket test for pause/resume replay bracket
- `2f5e6351` [PIR #1047] docs: user-facing CHANGELOG entry for terminal-freeze fix
- `b05b73f2` [PIR #1047] Hoist replay-cap resolution out of constructor args; document the three distinct size limits
- `02ff5546` [PIR #1047] Remove byte caps: keep partial/replay whole for faithful TUI replay
- `7100a5a3` [PIR #1047] Re-assert terminal size after replay (Option A) + temporary diag logging
- `81c4a83b` [PIR #1047] Force a post-connect redraw nudge (mirror web client's SIGWINCH-on-connect); revert Option A
- `6d994f72` [PIR #1047] docs: changelog entry for terminal blank-on-open fix
- `cc7fbdc7` [PIR #1047] Strip temporary [#1047-diag] diagnostic logging

(Plus the review/test-coverage commit carrying this file.)

## Test Results

- `pnpm build`: ✓ pass
- `pnpm --filter @cluesmith/codev test`: ✓ 3308 passed / 0 failed / 48 skipped
- `packages/vscode` adapter suite: ✓ 20 passed (including 5 storm-prevention + 2 repaint-nudge tests new for #1047); full VSCode suite previously green at 414.
- Manual verification (human, `dev-approval` gate, macOS VSCode against the worktree Tower): confirmed via the temporary `[#1047-diag]` client log that there is no connect→backpressure→reconnect storm, `seq` heartbeats stay clean, and — after the nudge landed — terminals **paint on open without a manual resize**.

## Architecture Updates

**COLD (`codev/resources/arch.md`)** — added a "Terminal reconnect/replay contract (#1047)" subsection under Shellper Lifecycle documenting the now-load-bearing behaviors: replay bracketed by `pause`/`resume` (excluded from client backpressure), `?resume=<seq>` delta reconnect, the deliberately-unbounded `partial` (faithful TUI replay) with CPU bounded by scan-only `pushData`, the client's connect-time forced redraw, and drop-not-reconnect under live overload.

No HOT (`arch-critical.md`) change: these are subsystem-level protocol details, not a top-tier always-injected system-shape fact, and the hot file is at its cap.

## Lessons Learned Updates

**COLD (`codev/resources/lessons-learned.md`, Debugging section)** — three `[From 1047]` entries: (1) cross-client differential diagnosis — a symptom in one client but not another sharing the backend localizes the bug to the client layer (web rendered fine → the app *was* painting → the VSCode adapter was at fault), and a full-screen TUI only repaints on a size *change*; (2) a buffer bounded by newline count is unbounded for a newline-free stream, with the on-disk PTY logs ("longest run without `\n`") as the decisive evidence, and the caution that front-trimming a buffer corrupts TUI replay; (3) a backpressure relief valve that re-fetches the overflowing payload is an infinite loop — drop ephemeral output, don't reconnect.

No HOT (`lessons-critical.md`) change: these are debugging recipes, not a top-tier cross-cutting rule, and the hot file is at its cap.

## Things to Look At During PR Review

- **The dropped byte caps (history).** Early commits added byte caps to `RingBuffer.partial` and `ShellperReplayBuffer`; they were **reverted** (`02ff5546`) after dev-approval testing showed front-trimming corrupts a full-screen TUI's replay (its alt-screen state lives in the cumulative stream from the alt-screen-enter onward). The freeze is fixed by *scan-only* `pushData` + the replay bracket, not by bounding the buffer. Net effect: `partial`/replay are functionally back to `main`'s faithful-but-unbounded behavior; the new `tower-server.ts` monitor logs partial size so unbounded growth (a known, issue-rated-minor trade-off) is observable.
- **The repaint nudge mechanism** (`terminal-adapter.ts`, `scheduleRepaintNudge`). It is a `rows-1` → `rows` size delta 500ms after connect, **gated** on `renderedSinceConnect` so a reconnect that already painted via replay doesn't reflow. The brief 1-row intermediate frame is intentional (guarantees a real `TIOCSWINSZ` delta even when the PTY is already at the target size). Confirm the gating and that it's cleared on close/reconnect (`resetStreamState`).
- **`#737` and the nudge are kept separate** (deliberate): `#737`'s on-open resize sets the correct size immediately (no flicker, common case); the nudge is the delayed backstop for the same-size no-op case. They're complementary, not redundant.
- **CMAP disposition (single-pass — please scrutinize at this gate).** 3-way consult: Codex `REQUEST_CHANGES`, Claude `APPROVE`, Gemini failed (consult ran against an empty sandbox and returned a clarification prompt, not a review — disregarded). Codex's two substantive points are the *deliberately descoped* byte-addressable seq and shellper byte cap (Fix B): both were dropped during dev-approval because byte-trimming a buffer corrupts a full-screen TUI's faithful replay (the regression the human caught when terminals went blank) — re-adding them would reintroduce that regression, and the issue itself rated the resulting unbounded memory as minor/orthogonal. So those are **rebutted, not fixed** (full rationale in `codev/projects/1047-*/1047-review-iter1-rebuttals.md`). The one point both reviewers raised that *was* legitimate — the review/comments overstating the `?resume=` delta as universal — is **fixed**: the Summary now scopes it to newline-bearing streams, and `RingBuffer.getSince` carries a comment documenting the no-newline behavior + nudge mitigation. Claude's Fix E test gap is **closed** (`pty-session-attach.test.ts`). Because PIR will not re-review, the human at this gate is the final check on whether the seq/Fix-B descope is acceptable.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-1047` → **Review Diff**.
- **Run dev server**: VSCode sidebar → **Run Dev Server**, or `afx dev pir-1047`.
- **What to verify**:
  - Open an architect/builder terminal running Claude's full-screen UI and let it redraw past ~1 MB of no-newline output; Tower CPU stays low and there is **no** connect→backpressure→reconnect storm (contrast the original ~14k-cycle capture).
  - Open a terminal that previously blanked — it **paints on open** without a manual window resize.
  - Reconnect a tab (close/reopen) → clean repaint; the reconnect URL carries `?resume=` (delta).
  - Optional: leave Tower running for hours on a real workload and confirm CPU stays flat (the true end-to-end soak; cannot fit a gate session).

## Flaky Tests

None skipped. (Earlier full-suite runs showed environmental failures in `session-manager`/`adopt`/`hot-tier` integration tests when `dist/` and the copied skeleton were absent; a full `pnpm build` resolves them — they are not related to this change and pass after build.)
