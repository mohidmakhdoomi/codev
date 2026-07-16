# PIR Review: Degrade crash-looping architect resume to a fresh session

Fixes #1149

## Summary

After a Tower recovery event, a Claude architect whose stored conversation id was unresumable (transcript corrupted by the crash, or garbage-collected by Claude's transcript cleanup) crash-looped: the shellper auto-restart replayed the same `--resume <uuid>` args verbatim every 2 seconds up to 50 times, with no escape short of killing Tower or hand-editing `global.db`, and the poisoned id survived to trigger the same loop on the next recovery. This PR adds the runtime complement to #1145's bake-time ownership check: the session manager now detects a crash loop (3 nonzero-code exits within 30 seconds), swaps once to a caller-precomputed fallback launch (a genuine fresh session with the role prompt re-injected and a freshly minted pinned id), and repairs the architect row so the unresumable id is never relearned. A `CODEV_SKIP_RESUME=1` env var provides a manual escape hatch. Codex/Gemini architects never had this bug because they never replay session ids; Claude now degrades into that same safe state automatically.

## Files Changed

Implementation and tests (vs merge-base with `main`):

- `packages/codev/src/terminal/session-manager.ts` (+84 / -1): `CrashLoopFallback` option on both session option types, `failingExitTimes` tracking, pure `isCrashLooping` helper, one-shot fallback swap in `setupAutoRestart`
- `packages/codev/src/agent-farm/servers/tower-utils.ts` (+84 / -3): resume branch of `resolveArchitectLaunch` precomputes and returns the fresh-launch `fallback`; `CODEV_SKIP_RESUME` check; shared `buildArchitectCrashLoopFallback`
- `packages/codev/src/agent-farm/servers/tower-terminals.ts` (+31 / -2): fallback wiring at both reconcile bake sites
- `packages/codev/src/agent-farm/servers/tower-instances.ts` (+34 / -2): fallback wiring at both cold-spawn sites
- `packages/codev/src/agent-farm/state.ts` (+13 / -0): `setArchitectSessionId` targeted-UPDATE helper
- `packages/codev/src/terminal/__tests__/session-manager.test.ts` (+142 / -1): detector tests
- `packages/codev/src/agent-farm/__tests__/tower-utils.test.ts` (+107 / -6): fallback-shape, escape-hatch, and fallback-builder tests
- `packages/codev/src/agent-farm/__tests__/state.test.ts` (+44 / -0): `setArchitectSessionId` tests

Protocol artifacts: `codev/plans/1149-tower-recovery-claude-architec.md`, this review, `codev/state/pir-1149_thread.md`, porch `status.yaml`.

## Commits

- `084a8962` [PIR #1149] Plan draft
- `d0575c56` [PIR #1149] Plan revised: rebase on main, account for merged #1145/#1150
- `fa5c5137` [PIR #1149] Session manager: crash-loop detector with caller-provided fallback launch
- `5af6cb95` [PIR #1149] Tower: wire architect crash-loop fallback at all four resume-bake sites + CODEV_SKIP_RESUME escape hatch
- `aa4af765` [PIR #1149] Thread: implement phase notes

(plus porch `chore(porch):` state-transition commits)

## Test Results

- `pnpm build` (core + codev): pass
- `pnpm vitest run` (full suite): pass. 3482 passed, 48 skipped (pre-existing skips), 0 failures
- New coverage: pure window-detection unit tests (below threshold, at threshold, stale entries ignored, exact boundary); two CI-skipped real-shellper integration tests (fallback applied after fast failures with `onApply` fired exactly once; clean exits never trigger it); `resolveArchitectLaunch` fallback shape and `CODEV_SKIP_RESUME` tests; `resolveArchitectRestart` pass-through; `buildArchitectCrashLoopFallback` env-merge, logging, and persistence-failure tests; `setArchitectSessionId` row-targeting and isolation tests
- Manual verification: the human reviewer exercised the running worktree at the `dev-approval` gate and approved

## Architecture Updates

Routed to COLD `codev/resources/arch.md` (Agent Farm Internals): the crash-loop fallback mechanism (the terminal layer detects fast-failing restarts and applies a caller-precomputed fallback launch; Tower supplies the policy at the four architect resume-bake sites) and the `CODEV_SKIP_RESUME=1` escape hatch. Not routed to HOT `arch-critical.md`: this is subsystem detail within Agent Farm internals, not a cross-cutting invariant worth displacing a capped entry.

## Lessons Learned Updates

Routed to COLD `codev/resources/lessons-learned.md`: a persisted launch hint (like a stored session id) is advisory, not a guarantee; existence checks at bake time cannot certify runtime resumability (corruption, post-bake GC, format drift), so the only complete defense is closing the loop from the runtime failure signal back to the stored state. Not routed to HOT `lessons-critical.md`: the capped hot tier already carries broader lessons; this one is specific to supervisor/restart design.

## Things to Look At During PR Review

- **The clean-exit guard** (`exit.code !== 0` in `session-manager.ts`): this is what prevents a user who quits a healthy session three times in 30 seconds from silently losing a valid resumable conversation. If this predicate is wrong, the failure mode is data loss (a discarded conversation), so it deserves a skeptical read.
- **Deliberate deviation from the issue sketch**: the issue said "null out the stored session_id"; the implementation persists the fallback's freshly minted id instead. Rationale (documented in the plan and in `buildArchitectCrashLoopFallback`'s doc comment): a NULL id would trip #1150's dead-registration pruning and unregister live sibling architects, and #1145's ownership check already defuses a minted id whose transcript never materializes.
- **Env precedence at the four call sites**: the fallback env is `{ ...baseEnv, ...fallback.env }` where `baseEnv` is the site's `cleanEnv` (which, at the spawn sites, already merged the resume branch's empty `harnessEnv`). Worth confirming no site needed the opposite precedence.
- **One-shot semantics**: after the fallback applies, `crashLoopFallback` is cleared; a fallback that itself crash-loops proceeds to the ordinary `maxRestarts` cap. This is intended (no fallback chains).

## How to Test Locally

- **View diff**: VSCode sidebar, right-click builder `pir-1149`, **View Diff**
- **Run**: `pnpm build && pnpm -w run local-install` (restarts Tower with this branch)
- **What to verify** (the corrupt-transcript repro; a bare poisoned id no longer reproduces because #1145 defuses it at bake time):
  1. In a scratch workspace with a running architect, read its stored id: `sqlite3 ~/.agent-farm/global.db "SELECT session_id FROM architect WHERE workspace_path = '<ws>' AND id = 'main'"`
  2. Truncate the transcript in place so the existence check still passes: `: > ~/.claude/projects/<encoded-ws>/<uuid>.jsonl`
  3. Kill the architect's claude process (not the shellper)
  4. Expect: three fast "Could not resume session" cycles (~6 seconds), one WARN (`Architect 'main' resume session <uuid8>… unrecoverable; falling back to a fresh session`), then a working fresh architect with the role prompt applied
  5. Verify the DB row now holds the replacement id; after interacting with the fresh session, its transcript exists, so the next restart resumes it
  6. Escape hatch: repeat the corruption, restart Tower with `CODEV_SKIP_RESUME=1`, verify the architect starts fresh with no crash cycle at all
