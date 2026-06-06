# PIR #997 — reconcile terminal sessions before serving requests

## Plan phase

### Investigation findings
- Startup in `tower-server.ts`: `http.createServer` (343) → `server.listen()` (349) → inside the
  listen callback: shellper init, `initTerminals`, `startSendBuffer`, then
  `await reconcileTerminalSessions()` (405). So the TCP port is open and the HTTP handler
  is live *before* reconcile re-registers persistent sessions. That's the race.
- #991 (PR #999, merged) pivoted to **preserving terminal ids across restart** (pty-manager:121,
  tower-terminals). So the successor-id *reassignment* is gone on main; `recoverSuccessor` named
  in the issue does NOT exist on main (991 dropped that approach). What remains is the
  *registration-timing* race: state/WS served before reconcile finishes registering sessions.
- Shared chokepoint: `getRehydratedTerminalsEntry()` (tower-terminals.ts:164) feeds BOTH
  `/api/state` (handleWorkspaceState) and `/api/overview`. Gating here covers both with one edit.
- WS upgrade (`tower-websocket.ts:188`) calls `getSession()` directly — needs its own gate.
- `/health` = `handleHealthCheck` (tower-routes.ts:286) reports process-up only, no readiness.
- Existing `isReconciling()` (tower-terminals.ts:82) can't distinguish "not started" from "done"
  (false in both) → need a distinct settled-once barrier.
- Reconcile probes are already per-session time-bounded (session-manager socket timeouts ~5s),
  so a hung shellper won't block indefinitely — mitigates the issue's hung-probe concern.
- reconcile is startup-only (single call site, tower-server.ts:405).

### Chosen approach (hybrid; recommended at plan-gate)
Bounded **readiness barrier** + `ready` flag on `/health`:
- New settled-once barrier in tower-terminals.ts, resolved in `reconcileTerminalSessions()` finally.
- `getRehydratedTerminalsEntry` awaits the barrier → /api/state + /api/overview deterministic.
- WS upgrade awaits the barrier before getSession → no spurious reject during window.
- /health gains `ready: isStartupReconcileSettled()` (stays immediately answerable = liveness).
- Await-in-handler (not 503) → deterministic single call, zero required client changes.

Rejected: moving reconcile before listen() (closes port during startup, bigger refactor, hung
probe makes Tower wholly unreachable); 503-during-window (forces client poll); readiness-endpoint
alone (every client must learn handshake to get determinism).

Plan written, awaiting plan-approval gate.

### Rebase on main + re-verification (at plan-gate)
Rebased onto origin/main (was 88 behind, 3 ahead) — replayed clean. Re-checked every plan
assumption against updated main:
- The 88 commits touched only `servers/overview.ts` + new `resolved-enrichment-cache.ts` in
  servers/; nothing in the terminal/startup path. tower-server.ts / tower-terminals.ts /
  tower-websocket.ts / handleHealthCheck all unchanged.
- All plan line refs still hold: createServer:343, listen:349, reconcile:405; reconcile:476,
  getRehydratedTerminalsEntry:164, isReconciling:82, !_reconciling guard:780; handleHealthCheck:286.
- WS upgrade has TWO getSession sites to gate: :196 (direct /ws/terminal/:id) and :267
  (workspace-scoped) — both via rejectUnknownSession.
- /api/overview still resolves terminals through the same chokepoint (handleOverview →
  getRehydratedTerminalsEntry, tower-routes.ts:870), so gating that one helper covers state+overview.
- No competing readiness barrier exists anywhere — approach is unobstructed.
Conclusion: plan stands as written; the race is intact on current main. Force-pushed rebased branch.

## Implement phase

Plan approved. Implemented the readiness-barrier approach:
- `tower-terminals.ts`: monotonic settled-once barrier (`markStartupReconcileSettled` /
  `isStartupReconcileSettled` / `whenStartupReconcileSettled(timeoutMs)` + test reset hook).
  Resolved in `reconcileTerminalSessions()` finally + early `!_deps` return (non-blocking-on-failure).
  `getRehydratedTerminalsEntry` awaits it → /api/state + /api/overview deterministic on first read.
- `tower-websocket.ts`: both terminal upgrade routes gate on the barrier before getSession, with a
  `if (!isStartupReconcileSettled())` fast-path so post-startup upgrades stay synchronous (zero overhead).
- `tower-routes.ts` handleHealthCheck: adds `ready: isStartupReconcileSettled()` (sync, liveness preserved).
- `packages/core/tower-client.ts`: `TowerHealth.ready?: boolean` (optional, back-compat).

Design note for reviewer: the load-bearing fix is the **await-barrier on /api/state** (deterministic
single call, no client poll). `ready` on /health is additive — keeps `status:'healthy'` as pure
liveness (matters for restartTower's wait-for-/health logic) and gives a cheap non-blocking probe.
User asked "why ready vs healthy?" → confirmed keep `ready` (liveness≠readiness, K8s-style split).

Tests: barrier unit tests + gated-rehydrate test (tower-terminals.test.ts), /health.ready
(tower-routes.test.ts), WS mock updated for fast-path. Full unit suite green: 3249 passed, 13
skipped, 0 failed. Build clean. Heading to dev-approval gate.

## Review phase

dev-approval approved by human. Wrote review + retrospective, arch.md "Startup Readiness Barrier
(#997)" subsection, lessons-learned entry. PR #1004 opened (Fixes #997), recorded with porch.
Review checks all green (pr_exists, review_has_arch_updates, review_has_lessons_updates).

3-way consult (single advisory pass, max_iterations:1):
- claude: APPROVE, HIGH confidence, KEY_ISSUES: None.
- gemini: skipped (agy CLI not installed) — non-blocking environmental skip, not a code finding.
- codex: **Quota exceeded (billing)** — produced NO output file. Retried once per protocol; same
  result. Persistent, environmental, not a code finding.

Codex was quota-blocked initially; user fixed billing and asked me to retry. Codex then ran and
returned **REQUEST_CHANGES**: legitimate — original tests covered the barrier mechanism (unit) but
omitted the end-to-end restart-race regression the plan's Test Plan called for.

Addressed (PIR single-pass; no AI re-review):
- Added `tower-terminals.test.ts` › "a single read after a restart reflects the completed reconcile
  (resolves after it)": drives a real reconcile held mid-flight, issues one getRehydratedTerminalsEntry
  concurrently, asserts deterministic ordering (read resolves AFTER reconcile) + complete builders map.
- Verified non-vacuous: gate removed → ['read','reconcile'] fails; gate present → ['reconcile','read'].
- Documented finding+fix in review "Things to Look At"; flagged for human verification at pr gate.

VERIFICATION GOTCHA (mine): I'd been running `pnpm vitest` from the MAIN checkout
(/repos/cluesmith/codev/packages/codev), not the worktree — so earlier "passes" didn't include my
new tests, and the fails-without-gate check was a no-op. Re-ran FROM THE WORKTREE: with-gate 60/60
pass; gate-removed → the regression fails as designed. Full worktree suite: 3258 passed, 13 skipped,
0 failed. Lesson for future verification: always run tests from the worktree dir, not main.

Verdicts: claude=APPROVE, gemini=COMMENT(skipped/env), codex=REQUEST_CHANGES(addressed). Next:
porch next → record verdicts → pr gate. Will notify architect leading with the codex disposition.
