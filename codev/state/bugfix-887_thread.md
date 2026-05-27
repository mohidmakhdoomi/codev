# bugfix-887 thread

## Mission
Close the v3.1.4 BUGFIX timing gap for the canonical `pr_ready_for_human` signal by giving BUGFIX a `pr` gate (same shape as AIR). Issue body laid out the fix precisely.

## Diagnosis (handed to me — confirmed)
v3.1.4 PR #874 wired BUGFIX's `pr_ready_for_human=true` to the `advanceProtocolPhase` terminal-exit setter (`index.ts:453` pre-fix) because BUGFIX had no `pr` gate. That setter only fires when the builder calls `porch done` post-merge — by which point the human has already acted. BUGFIX PRs sat at `phase: pr, pr_ready_for_human: false` indefinitely, never surfacing in Needs Attention. Verified the architect's claim by reading the existing pr-ready-872 tests + the corresponding code path.

## Changes (single PR, < 300 LOC)

### Protocol JSON (both copies)
- `codev/protocols/bugfix/protocol.json` + skeleton — bumped to `1.2.0`, added `"gate": "pr"` to pr phase

### Porch code
- `index.ts:advanceProtocolPhase` — removed the BUGFIX-no-gate snapshot (`advancingFromPrPhase`) and the two conditional setters. Function now just advances; no PR-readiness logic since all PR phases have gates.
- `index.ts` `done()` gate-request setter — simplified `gate === 'pr' || isPrCreatingPhase(...)` to `gate === 'pr'` (the second clause is now redundant).
- `next.ts:handleVerifyApproved` — same simplification on the gate-request path; dropped `advancingFromPrPhase` from the no-gate-advance fallback.
- `next.ts` BUGFIX special-case at terminal state (the "architect takes over" return) — removed. BUGFIX now falls through to the AIR-shaped merge-instructions path.
- `protocol.ts:isPrCreatingPhase` — collapsed to `phase?.gate === 'pr'`, dropped `hasPrConsultation` field and its computation in `normalizePhase`. JSDoc updated.
- `types.ts:ProtocolPhase` — removed `hasPrConsultation` field. Updated `pr_ready_for_human` JSDoc.

### Prompts
- `codev[-skeleton]/protocols/bugfix/prompts/pr.md` — replaced "your work is done, architect takes over" with the new gate-driven flow: porch done → wait for `porch approve <id> pr` → follow porch's emitted merge task.

### Tests
- `pr-ready-872.test.ts` — bumped BUGFIX fixture to version 1.2.0 with `gate: "pr"`. Rewrote BUGFIX cases to test the gate-request path (matching AIR). Updated classifier describe block to reflect the now-single-marker invariant. Kept the RESEARCH false-classification regression tests intact.
- `next.test.ts` — renamed/rewrote the "no merge instruction for bugfix" test to "returns merge task for completed bugfix protocol (matches AIR post-#887)". Updated fixture to include `gate: "pr"` and `gates: { pr: approved }` on the terminal state.

### Docs
- `docs/releases/v3.1.4-jacobean.md` — prepended a "Superseded in v3.1.5 by issue #887" callout to the section that introduced the BUGFIX-specific terminal-exit set-point. The `derivePrReady` BUGFIX-fallback in `overview.ts` is kept intact for in-flight v3.1.4 projects (flagged for v3.2+ removal per the issue body).

## Out of scope (per issue body)
- Removing `derivePrReady` BUGFIX-fallback in `overview.ts` — left as graceful-degradation shim for in-flight v3.1.4 BUGFIX builders.
- Re-examining AIR's terminal-exit set-point — AIR uses the gate-request path correctly, no change needed.
- `codev/protocols/bugfix/protocol.md` long-form workflow doc — out of scope for this issue (still describes manual "afx send LGTM merge it" flow that's now redundant with the gate, but the issue scoped this strictly).

## Test results
- pr-ready-872.test.ts: 15/15 pass
- All porch tests: 334/334 pass
- overview.test.ts: 148/148 pass
- TypeScript: clean

## Status
Code complete. About to commit, push, open PR, run CMAP.
