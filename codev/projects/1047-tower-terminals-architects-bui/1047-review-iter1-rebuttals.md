# PIR #1047 — CMAP iteration-1 rebuttals / dispositions

3-way consult verdicts: **Codex `REQUEST_CHANGES`**, **Claude `APPROVE`**, **Gemini failed** (see below). PIR is single-pass (`max_iterations: 1`) — these dispositions are not independently re-reviewed; the human at the `pr` gate is the final check.

## Gemini — DISREGARD (not a real review)

The Gemini consult misfired: its output is *"Hi! The workspace directory is currently empty, and your prompt was `--sandbox`. Could you please clarify…"* — it ran against an empty sandbox and never saw the diff. This is a known agy/Gemini-consult environment issue, not a verdict. Porch grep-defaulted it to REQUEST_CHANGES because the text lacks "APPROVE". No actionable content; disregarded.

## Codex — REQUEST_CHANGES (HIGH)

### C1. "Byte-addressable seq not implemented → no true delta resume for no-newline streams" — REBUTTED (deliberate descope), with a doc fix

Accurate observation, but not a defect. `seq` stays line-based, so for a pure no-newline TUI stream `currentSeq` stays at the last real line and `connectUrl()` sends a full (faithful) replay rather than a `?resume=` delta.

This was **deliberately descoped during dev-approval**. The plan's byte-addressable seq existed to make a *bounded* (byte-capped) buffer resumable. But the byte caps were reverted (see C2) because front-trimming corrupts a full-screen TUI's replay — its alt-screen state lives in the cumulative stream from the alt-screen-enter onward, so a trimmed buffer renders blank/garbled (the exact regression the human caught at the gate). With the buffer kept whole, a no-newline reconnect does a full faithful replay, which is correct — it's `main`'s behavior, just without the bandwidth optimization for the pathological case. Correctness on (re)connect is guaranteed by the **post-connect repaint nudge** (forces a redraw SIGWINCH), which is implemented and human-verified.

Re-introducing byte-addressable seq + byte caps to chase the delta optimization would reintroduce the replay-corruption regression. Not warranted.

**Fix applied (the legitimate part):** the implementation was correct but the *docs overstated* it. Corrected:
- Review Summary now scopes `?resume=` to "newline-bearing streams" and adds an explicit Scope note on the descope.
- `RingBuffer.getSince` now carries a comment documenting that `seq` advances only on completed lines, that a caught-up no-newline client gets `[]`, and that the repaint nudge covers it.

### C2. "Shellper byte cap (Fix B) absent → unbounded restart replay for zero-newline sessions" — REBUTTED (deliberate descope)

Accurate: `ShellperReplayBuffer` is line-bounded only, so a no-newline session's shellper replay grows unbounded and Tower replays it fully on restart. This was **reverted on purpose**, for the same reason as the RingBuffer byte cap: a byte cap front-trims the buffer, which corrupts the TUI replay Tower reseeds from on reconnect. Unlike the Tower side, the shellper side has **no O(n²) hot path** (it just appends chunks and counts newlines), so its absence does **not** reintroduce the freeze — the freeze is fixed by scan-only `pushData` + the replay bracket + drop-not-reconnect, none of which depend on Fix B. The remaining cost is memory growth for long no-newline sessions, which issue #1047 explicitly rated minor/orthogonal ("+76 MB over 10h… probably orthogonal; the CPU is the load-bearing signal"), and which is now **observable** via the new `tower-server.ts` partial-size monitor. Accepted trade-off; not re-adding.

### C3. "Test coverage and review overstate what shipped" — PARTIALLY VALID, FIXED

The review did describe `?resume=<seq>` delta reconnect as the delivered contract without the no-newline caveat. **Fixed** (C1's doc corrections). There is intentionally no "no-newline seq/getSince regression test" because there is no byte-seq behavior to pin — the line-based behavior is now documented in the `getSince` comment instead.

## Claude — APPROVE (HIGH), with minor notes — ADDRESSED

- **"No Fix E unit tests"** — **Fixed.** Added `packages/codev/src/terminal/__tests__/pty-session-attach.test.ts` (3 tests): re-attach drops the previous client's `data`/`exit`/`close` listeners; a stale frame on the detached client no longer reaches the ring buffer; same-instance re-attach is a no-op.
- **"Document the getSince no-newline limitation in the code comment"** — **Fixed** (same comment as C1).
- **"`docs/releases/UNRELEASED.md` not updated"** — Not applicable: the file does not exist on this branch (only `UNRELEASED.template.md`); it's a between-releases gap, not an omission. CHANGELOG.md carries both user-facing entries.

## Net change from this iteration

Docs/comments corrected for accuracy; one regression-test gap (Fix E) closed. No behavioral code change — the descoped items (byte caps, byte-addressable seq) are intentionally not re-added, as re-adding them would regress the human-verified faithful-replay behavior. The seq/Fix-B descope is the decision the human should confirm at the `pr` gate.
