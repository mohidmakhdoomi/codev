# bugfix-870 thread

## Phase: investigate (2026-05-26)

Picking up issue #870: `getMaxIterations()` is dead code; porch ignores per-phase `max_iterations`.

Confirmed via grep — the only references in `packages/codev/src/`:
- `protocol.ts:228` — default parsing
- `protocol.ts:403` — definition (no other callers)
- `next.ts:617` — phantom comment that says "this MUST come before the max_iterations safety valve" but the safety valve doesn't exist

The verdict-handling flow in `next.ts:587-650` reaches the "no rebuttal yet — emit write rebuttal task" path on every iteration. There's no cap.

Design question for architect (from issue): Option A (cap at 1, force-advance) vs Option B (raise default to 2 + wire up). Reporter prefers Option B.

Plan: implement the wiring (Option B). The default-value bump is a single-line config decision; the wiring is the same in either option. I'll set the default to 2 in `protocol.ts:228` AND wire up the force-advance.

## 18:08 — Architect scope redirect

Reporter retracted the per-N-cap framing. New policy:
- ADVANCE on all-APPROVE-or-COMMENT (already handled by `allApprove` in verdict.ts:57)
- RE-ITER on any REQUEST_CHANGES, no normal-flow cap
- SAFETY CEILING via `getMaxIterations` (default 8), invoked only when REQUEST_CHANGES persists for many rounds

Current behavior verification:
- `getMaxIterations` is dead code (zero callers — confirmed)
- The rebuttal-exists branch at next.ts:594-614 currently *advances* the phase regardless of remaining REQUEST_CHANGES. That's the OPPOSITE of re-iter.
- I cannot find any code that increments `state.iteration`. The cycle the reporter observed must have come from some other mechanism (architect re-running consult manually, or a different fork).

Implementation plan:
1. Rewrite the rebuttal-exists branch in next.ts: record reviews → check max_iterations safety ceiling → either force-advance (with audit trail) or re-iter (increment iteration, build_complete=false).
2. Add `force_advanced` audit field to ProjectState type.
3. Bump SPIR/ASPIR `max_iterations: 1 → 8` per phase to enable normal-flow re-iter.
4. Leave PIR at `max_iterations: 1` — its docs explicitly require single-pass advisory; the new safety ceiling makes that semantic correct (force-advances immediately on iter=1 REQUEST_CHANGES).
5. Bump default in protocol.ts:228 from `?? 1 → ?? 8`.
6. Replace phantom comment at next.ts:617-618 with comment that describes live code.
7. Tests: (a) all-APPROVE-or-COMMENT → advance; (b) REQUEST_CHANGES + rebuttal → re-iter; (c) iter==ceiling + REQUEST_CHANGES → force-advance with audit trail.

## 18:10 — Scope note on PR voice

Architect: keep PR description, commit messages, code comments GENERIC. No external-adopter workspace names, no project IDs, no business-logic specifics. Issue body and reframe comment are already scrubbed — mirror that.

## 18:23 — Implementation complete

Code committed (abc06392), thread committed (5486e108), pushed to origin/builder/bugfix-870. PR #871 created. Diff: 237 LOC, 8 files. Full test suite: 3141 passed, 0 failed, 13 skipped (unrelated). Porch suite isolated: 319 passed.

## 18:30 — CMAP unanimous APPROVE

3-way `consult --protocol bugfix --type pr` (with `--project-id bugfix-870` to disambiguate the worktree's projects dir):

- Gemini → APPROVE / HIGH / no issues
- Codex → APPROVE / HIGH / no issues
- Claude → APPROVE / HIGH / no issues (also flagged that the existing rebuttal-advance test still works because the test fixture's `max_iterations: 1` puts iter=1 at the ceiling → force-advance path, same observable `gate_pending` outcome)

All reviews saved to `codev/projects/bugfix-870-porch-max-iterations-enforceme/`. PR body updated with CMAP summary table.

## Open items

- Architect approval needed before merge.
- One minor lift the architect may want to consider for follow-up: PIR docs (`prompts/review.md`, `consult-types/pr-review.md`) describe `max_iterations: 1` as the canonical lever for "single advisory pass" — that wording is still correct in spirit, but the mechanical force-advance + audit-trail trace it now produces could be mentioned in the PIR docs so a future reader knows what to look for. Out of scope for this BUGFIX.
