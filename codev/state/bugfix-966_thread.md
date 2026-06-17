# bugfix-966 — Needs Attention: merged PR with still-pending pr gate vanishes

## Issue
`derivePrReady` in `packages/codev/src/agent-farm/servers/overview.ts` returns `true`
for a builder whose `pr` gate is `pending` + `requested_at` present, *even when the PR
has already merged*. A merged PR lives in `recentlyClosed`, not `pendingPRs`, so:
- `NeedsAttentionList` loop (A) emits no PR row (PR not in `pendingPRs`)
- loop (B) suppresses the builder row (`if (b.prReady) continue;`)
→ builder vanishes from the Work surface entirely.

## Investigation findings
- `merged: true` lives inside the `pr_history:` list in status.yaml (4-space indent,
  one entry per PR/stage). Last entry corresponds to the PR tied to the current pr gate.
- The parser (`parseStatusYaml`) does NOT currently parse `pr_history` at all.
- Confirmed fix is sufficient (no NeedsAttentionList change): once `prReady` is false,
  the builder is no longer suppressed in loop (B). Its `pr` gate is still `pending` with
  `requested_at`, so `detectBlocked` returns 'PR review' → builder surfaces as a gate row.

## Plan
1. Parse `merged` boolean from the LAST `pr_history` entry (handles SPIR checkpoint
   multi-PR case: an earlier merged PR + a later open PR awaiting review → not merged).
2. `derivePrReady` returns false when `parsed.merged` is true.
3. Unit tests: parseStatusYaml parses pr_history merged; derivePrReady false when merged.

## Implementation (done)
- `overview.ts`: added `merged: boolean` to `ParsedStatus`; parse it from the LAST
  `pr_history` entry; `derivePrReady` now `&& !parsed.merged`.
- `overview.test.ts`: +8 `#966` tests (5 parseStatusYaml, 2 derivePrReady, 1 end-to-end
  repro proving the builder surfaces via the gate row, not vanishes). All 8 pass. tsc clean.

## Environment blocker (NOT my code)
- Worktree had no node_modules. `pnpm install` fails compiling `better-sqlite3@12.9.0`:
  node-gyp reports "No Xcode or CLT version detected" (CLT pkgutil receipt missing) even
  though `xcode-select -p` is valid. node v26 (ABI 147) has no prebuilt; falls back to a
  compile that fails. Main workspace's binary is ABI 141 → incompatible with node 26.
- Effect: repo-wide `npm test` fails on better-sqlite3 (consult/metrics + OverviewCache
  tests). My change adds ZERO new failures — the 5 failing tests in overview.test.ts are
  all `new Database(...)` ABI errors; the 153 non-sqlite tests pass.
- This will block porch's `fix`-phase `tests` check. Needs CLT reinstall (user/sudo) or a
  node downgrade. Escalating to architect rather than bypassing.

## Environment UNBLOCKED (architect-authorized)
- Bumped better-sqlite3 ^12.5.0 → ^12.10.0 (commit 45da56b7). 12.10.0 ships a node-26
  ABI-147 prebuilt → `pnpm install` downloads it (prebuild-install, no compile, no CLT).
- `porch check`: build ✓, tests ✓ (full suite green under node 26, incl. my 8 #966 tests).

## PR
- PR #980 opened (Fixes #966). Net diff ~ overview.ts (57) + tests (152) + bump/lockfile.
- Running 3-way CMAP (gemini/codex/claude --protocol bugfix --type pr).

## CMAP (3-way) — all APPROVE / HIGH / no key issues
- Gemini ✅, Codex ✅, Claude ✅. One non-blocking note (Claude): test comment named an
  external adopter → scrubbed in 61333c38 per anonymization policy.

## Status
- [x] Investigate / root cause
- [x] Implement fix
- [x] Tests (8 new #966 tests pass; tsc clean)
- [x] Environment unblocked (better-sqlite3 bump)
- [x] PR #980 created
- [x] CMAP review (all APPROVE) + scrub
- [x] porch done → pr gate requested; architect notified
- [ ] AWAITING human pr-gate approval (do not self-approve / self-merge)
