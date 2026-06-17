# PIR #982 — Builder thread

Issue: vscode + tower "No active terminal for X" toast is unactionable. Label: `area/cross-cutting`.

## Plan phase (iteration 1)

**Root cause confirmed by reading code:** the sidebar tree and the terminal-opener read two different Tower sources.
- Sidebar renders from `OverviewBuilder` (overview cache, `/api/overview`) — disk-sourced, **no `terminalId`** (`packages/types/src/api.ts:141-225`). Row shows while worktree exists.
- Opener `openBuilderByRoleOrId` (`packages/vscode/src/terminal-manager.ts:186-215`) reads `getWorkspaceState` → `DashboardState.builders.terminalId` (in-memory PTY session id). Tower restart drops the in-memory registry → `terminalId` null → bare warning at `terminal-manager.ts:206-209`.

**Decision:** ship Option 1 (better message) + Option 2 (in-extension recovery), defer 3/4/5.
- New toast (replacing the bare warning): names the builder, explains likely cause (Tower restart), buttons **Recover Builders** + **Retry**.
- **Recover Builders** → `createTerminal({ cwd: workspacePath })` + `sendText('afx workspace recover')` (dry-run), mirroring `commands/run-worktree-setup.ts:51-56`. Deliberately stops at dry-run (recover is workspace-wide, can't target one builder).
- **Retry** → re-attempt open (handles the transient spawn/recover race, cause 3).
- Pure-vscode, confined to the `!terminalId` branch → happy path untouched.
- Deferred: Option 3 (sidebar icon) needs a `terminalId`/liveness field threaded through overview server + types — cross-package, no extra acceptance coverage → follow-up issue. Options 4/5 explicitly deferred by the issue.

Toast button pattern reference: `notifications/gate-toast.ts:109-139`. Tests extend `packages/vscode/src/__tests__/terminal-manager.test.ts` (vitest, `pnpm --filter codev-vscode test:unit`).

Plan written to `codev/plans/982-vscode-tower-no-active-termina.md`. Committed, pushed. Sitting at `plan-approval` gate.

## Plan check vs main + rebase (still at plan-approval)

Branch was 88 commits behind `origin/main` (based on `66144d90`; main at `586a2fcb`). Checked plan validity against main:
- Warning code at `terminal-manager.ts:206-209` is **byte-identical on main** — bug untouched, same lines.
- None of the plan's targeted files changed since the old base (terminal-manager, builder-row, builders, types/api.ts, run-worktree-setup, gate-toast, the test).
- Only adjacent change intersecting the plan: `overview.ts` got PIR #907's enrichment cache (for `area`) — did NOT add any `terminalId`/liveness field, and `OverviewBuilder` (api.ts) is unchanged. So the Option-3 deferral reasoning ("no liveness signal on OverviewBuilder") still holds.
- No merged PR references #982 — no duplicate fix shipped.

Rebased onto `origin/main` (586a2fcb) cleanly (no conflicts), force-pushed. Porch state intact (still gate_pending / plan / iter 1). Post-rebase line refs re-verified: warning at `:207`, `run-worktree-setup.ts:51-56` pattern present.

**Deep-dive on Tower-up causes (answered to reviewer):** `/api/state` (opener) omits a builder whose live `PtySession` is gone from `TerminalManager.sessions` (`tower-routes.ts:1834-1855` — included only `if (session)`); `/api/overview` (sidebar) is disk-sourced so still lists it. Tower-up triggers: non-shellper 5-min idle reap (`pty-session.ts:368-379`, shellper-exempt), PTY exit past 30s grace (`pty-manager.ts:97-101`), spawn race, explicit kill.

## Plan REVISED after reviewer feedback (still at plan-approval)

Reviewer: the case they actually hit is **transient unavailability, not session destruction** — wouldn't need afx recovery. They challenged recovery-as-primary. They're right.

Mechanism confirmed: `/api/state` rehydrates + on-the-fly shellper-reconnects on every call (`tower-terminals.ts:164-168`, `:780-886`); a click landing mid-rehydration / during startup `_reconciling` (`:53`/`:780`) / in the spawn race sees a momentary miss that resolves on the next call. **There is NO retry in the open path** — `terminal-manager.ts:206-208` warns on the first miss. That missing retry is the real defect.

**Reframed plan:**
- PRIMARY: bounded silent auto-retry in `openBuilderByRoleOrId` (~3 attempts, ~400ms apart). Re-query `getWorkspaceState` (re-triggers Tower self-heal). On any hit → open, NO toast. Transient case becomes invisible (= the issue's "self-recovers on next tick" AC).
- SECONDARY (persistent tail only): actionable toast leading with **Retry**; **Recover Builders** demoted to last-resort line (dry-run, dead-shellper case). Recovery is no longer the headline.
- Happy path untouched (first-attempt hit returns immediately). Option 3/4/5 still deferred.

## Backoff convention check (reviewer asked "same one used across the system?")

No — first draft's "fixed 400ms" was ad-hoc. Canonical convention is `packages/core/src/reconnect-policy.ts` (#961 consolidated 4 hand-rolled `Math.min(1000*2^attempt,cap)` copies). Exports `backoffDelayMs(attempt, opts)` (bare curve, parameterized: baseMs/capMs/maxAttempts/jitterMs/random), `BackoffController` (counter+give-up), `classifyUpgradeError` (WS close codes). Already used by `connection-manager.ts` (SSE reconnect → backoffDelayMs) and `terminal-adapter.ts` (WS reconnect → BackoffController).

Catch: defaults (base 1s, cap 30s, 6 attempts) are for persistent reconnect loops — too slow for an interactive click. Fix: reuse the **bare `backoffDelayMs`** (own a local counter, like the SSE/tunnel sites) with interactive params `{ baseMs: 150, capMs: 800 }` over ~3-4 attempts (~150/300/600ms, ~1s total). Don't use BackoffController (event-driven onClose machinery we don't need) or classifyUpgradeError (WS-only). Plan + Files-to-Change updated to import `@cluesmith/codev-core/reconnect-policy`.

## IMPLEMENT phase (iteration 1) — done, awaiting dev-approval

plan-approval approved; advanced to implement.

Changes:
- NEW `packages/vscode/src/terminal-resolve.ts` — vscode-free `resolveBuilderTerminal(roleOrId, fetchBuilders, {sleep, attempts?})`. Retries the resolve `TERMINAL_RESOLVE_ATTEMPTS` (4) times; uses `backoffDelayMs(attempt, {baseMs:150, capMs:800})` between attempts. Returns discriminated `{kind:'ok'|'ambiguous'|'missing'}`. Ambiguity short-circuits (stable, no retry). Deps injected → behaviorally testable.
- `terminal-manager.ts` — `openBuilderByRoleOrId` delegates to the helper; `missing` → new `promptNoTerminalRecovery` (Retry [primary] + Recover Builders [secondary, dry-run `afx workspace recover` at workspace root, mirrors run-worktree-setup]). `friendlyBuilderId` gives `#<issueId>` in the toast via overviewCache. Old bare "No active terminal" warning removed.
- Tests: NEW `terminal-resolve.test.ts` (7 behavioral — happy path / self-heal miss-then-hit / spawn-race empty-then-hit / persistent missing / backoff-curve-matches-shared-fn / ambiguous short-circuit / attempts override). `terminal-manager.test.ts` +5 source-level (delegation, no bare warning, missing→prompt, Retry+Recover labels, recover command wiring).

Verify: `pnpm --filter codev-vscode test:unit` → 27 files / 348 tests pass. `pnpm --filter codev-vscode compile` → check-types + lint + esbuild clean.
Note: fresh worktree needed `@cluesmith/codev-core` and `@cluesmith/codev-types` built first (tsc) — their dist wasn't present, caused subpath-resolution errors in unrelated tests until built. Not a code issue.

Committed (impl + tests separate). Next: push, `porch done`, sit at dev-approval.

## REVIEW phase — PR + consult + pr gate

dev-approval approved → review phase. Wrote `codev/reviews/982-...md` (Summary/Files/Commits/Tests/Arch[no change, server barrier already in arch.md:213]/Lessons[added sibling to From 916]/Things-to-look-at/How-to-test). Added lessons-learned.md entry [From 982]. PR #1006 opened (Fixes #982), recorded via `porch done --pr 1006`.

3-way consult (single advisory pass, type=impl): **claude=APPROVE, codex=REQUEST_CHANGES (HIGH), gemini=skipped (agy CLI not installed)**.
- Codex finding (REAL): Recover Builders used `cwd: workspacePath`; in a `.builders/<id>`-rooted VSCode window that's the worktree (detectWorkspacePath walks up to first `codev/`, worktree has its own), so `afx workspace recover` would run in the wrong dir. Fixed: new `mainCheckoutRoot(workspacePath)` helper strips trailing `/.builders/<id>`; recover cwd now uses it. +5 helper tests, source-guard updated. Pre-existing same pattern in run-worktree-setup.ts etc. = broader follow-up, out of scope.
- Tests: 353 pass (17 new). compile clean. Documented finding+fix in review "3-Way Consultation" + "Things to Look At".

Escalating REQUEST_CHANGES to architect (single-pass, won't be re-reviewed). Then wait at `pr` gate.
