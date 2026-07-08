# Decision note — Q6: Session presence ("waiting for input" indicator)

**Status**: Proposed (needs main's ratification)
**Date**: 2026-07-07
**Question** (interaction-model §9.6): When a builder is "waiting for input," does mobile show a typing-indicator-style presence?

## Ground truth

Tower has no ground-truth "waiting for input" signal. What exists (verified 2026-07-07):

- `lastDataAt` — wall-clock timestamp of the last PTY output frame per builder; the dashboard flags builders silent past a threshold as *possibly* waiting.
- `OverviewBuilder.blocked` / `blockedGate` / `blockedSince` — porch-derived, reliable, but only covers *gate* blockage, not "the harness asked a free-form question and is idle."
- `idleMs` on the overview payload.

So there are two signal qualities: **reliable** (gate-blocked, pending `AskUserQuestion` once §8.1 plumbing exists) and **heuristic** (output-silence).

## Decision

**Yes to presence, but honest about signal quality: definitive states get definitive UI; the silence heuristic gets a soft hint, never a demand.**

1. **Definitive** — `blocked` on a gate, or a pending structured question: render as an explicit attention state ("Waiting for your approval", "Asked you a question · 4m"). These are inbox items ([[q5-multi-workspace]]) and push triggers ([[q4-push-controls]]), not just presence dots.
2. **Heuristic** — output-silence past threshold: render as a quiet "idle 6m" badge on the builder row. Do NOT phrase it as "waiting for you" (false positives: long test runs with buffered output, thinking pauses) and do NOT push-notify on it.
3. **Working** — recent output: a subtle activity shimmer/dot, the closest analog to a typing indicator. Derived from `lastDataAt` recency; costs nothing.
4. **No new plumbing for v0.** All three render from the existing overview snapshot on the normal poll/refetch cadence. If the structured-event work (§8.1) later adds harness-side "awaiting input" signals, the heuristic tier upgrades to definitive for free.

The typing-indicator framing from the question is the right instinct scoped to tier 3 (working shimmer); presenting tier-2 heuristics with tier-1 confidence would teach users to distrust the app.

## Related

- [[q3-offline-behavior]] (same snapshot-derived model), interaction-model §8.1.
