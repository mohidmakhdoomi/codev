# bugfix-1224 — Tower/shellper architect session-ID collisions + non-recovering crash loops

Protocol: BUGFIX (strict). Issue #1224.

## Investigate

### Symptom A root cause (the headline: session-ID collision crash loop)

`resolveArchitectLaunch` (`packages/codev/src/agent-farm/servers/tower-utils.ts`) decides
whether to resume a persisted architect conversation. Since #1145 it resumes a stored
session id whenever the jsonl **exists on disk** (`sessionIsOwned` → `verifySessionOwnership`).

It never checks whether a **live process is already holding** that session id. When one is
(the report's two cases: a stale pre-restart shellper's claude child, or an unrelated
foreground claude), it bakes `claude --resume <id>` anyway → claude dies instantly with
`Error: Session ID <uuid> is already in use` → shellper auto-restarts → dies again → crash loop.

The existence check answers "does the transcript exist?" but not "is someone using it right now?"
— and a *held* session's jsonl exists precisely because the holder is writing to it, so the
#1145 guard is guaranteed to pass in exactly the collision case.

### Fix (reporter's suggestion (a)): verify no live holder before resuming

Before resuming a stored id, positively confirm **no live process holds it** (scan the process
table for the id in argv — the same observable technique as the #1007 orphan-shellper cleanup).
If a live holder is found, mint a fresh session instead of colliding. This is universally safe
for both holder cases: we never touch the holder (critical — case 2's holder is the user's own
foreground claude, must not be killed), and the new architect gets a working fresh conversation.
The crash loop never starts.

### Scope decision

- Fix (a) is the isolated root-cause fix for Symptom A. Implementing it.
- Fix (b) "crash-loop breaker in shellper" already largely exists (#1149
  `maybeApplyCrashLoopFallback`, 3 failing exits in 30s → swap to fresh). Noting in PR.
- Fix (c) "atomic deregistration/process death" (Symptom B registry divergence) is a separate,
  more architectural concern — will recommend a follow-up issue rather than expand scope here.

## Fix

`packages/codev/src/agent-farm/servers/tower-utils.ts`:
- New `sessionHasLiveHolder(sessionId, {list?})` — scans `ps -A -o args=` for a live process
  launched with `--session-id <id>` / `--resume <id>` (both space- and `=`-joined). Match is
  **flag-anchored**, not a bare substring — a bare substring false-positived on the short synthetic
  ids in the existing tests (e.g. `'x'`) and is generally unsafe. On scan failure returns `false`
  (purely additive guard: diverts to fresh only on positive evidence, never worse than today).
- `resolveArchitectLaunch` resume gate now requires `sessionIsOwned(...) && !hasLiveHolder(...)`.
  Held id → mint fresh (with a WARN log) instead of baking a colliding `--resume`. Added
  `hasLiveHolder` + `log` seams; ownership is still checked first so the (cheap-ish) `ps` scan is
  skipped for stale ids.
- `resolveArchitectRestart` threads `log` through (restart-bake path inherits the guard for free).

`tower-instances.ts`: pass `log: _deps.log` at the `addArchitect` and `launchInstance` main-path
call sites so the divert-to-fresh decision is diagnosable in Tower logs.

Tests (`tower-utils.test.ts`): +7 cases (held→mint-fresh with WARN, no-holder→resume, ownership
short-circuits the scan, and 4 `sessionHasLiveHolder` unit cases incl. scan-failure→false).

### Validation
- `porch check`: build ✓, tests ✓ (full suite, 26.8s). tsc --noEmit clean.
- Note: the worktree spawned WITHOUT `node_modules` (postSpawn `pnpm install` had not run); ran
  `pnpm install` + built `@cluesmith/codev-core` to get a working test env. A raw `vitest run`
  before the full build shows 8 pre-existing env failures (missing `dist/` + copied skeleton
  artifacts — adopt/update/consult/tier-materialization/consolidate/session-manager integration);
  all clear once porch's build check emits those artifacts. None touch changed code.

## PR

PR #1225 opened (`Fixes #1224`), mergeable. CMAP:
- Codex: APPROVE (HIGH, no issues)
- Claude: APPROVE (HIGH, no issues) — confirmed TOCTOU windows are safe (mint-fresh or #1149 backstop)
- Gemini: skipped non-blocking (couldn't emit a `--type pr` VERDICT in this worktree; known lane limitation)

No REQUEST_CHANGES. Requested the `pr` gate via `porch done`; awaiting human approval before merge.

Note for follow-up: consult's project auto-detect fails from a builder worktree that carries the
full `codev/projects/` tree ("Multiple projects found"); had to pin `--issue 1224 --project-id
bugfix-1224`. Worth a separate issue if it recurs.

## PR iteration 2 — architect requested 3 changes (approved scope expansion)

Gate NOT approved. Waleed wants (all in this PR):
1. **JSON-argv parent needles** — a remnant *shellper* carries the id as `"--session-id","<id>"`
   in its config JSON; the crash-looping child is dead <8s/respawn so the space/`=` needles miss
   the incident-1 holder during most of its life. Add JSON forms.
2. **Mint-or-RECLAIM** — when the holder is verifiably OUR OWN superseded shellper (shellper-main.js
   + same session id + same cwd + same CODEV_ARCHITECT_NAME, not self), kill its process group
   (SIGTERM→SIGKILL) and RESUME. Foreign holders never touched. Test never-kill-foreign explicitly.
3. **Symptom B** — (a) add/launch reconcile with an existing live shellper for the identity
   (reap, don't spawn a duplicate); (b) crash-loop give-up deregisters cleanly + reaps husk;
   (c) remove-architect clears live-process-no-row zombies; (d) capture dying child stderr/exit.

### Design
- New module `servers/architect-session-holder.ts`: `sessionIdNeedles` (space/`=`/JSON forms),
  `cmdlineHoldsSession`, `listProcessEntries` (ps -ww -eo pid=,args=), `classifyArchitectSessionHolder`
  → `{reclaimable: pid[], foreign: bool}` (reclaimable = shellper-main.js whose JSON has matching
  sessionId+cwd+CODEV_ARCHITECT_NAME), `findOwnArchitectShellpers` (identity w/o session, for
  remove-architect), and async `reclaimSupersededShellpers` (kill group + poll-for-death, injectable
  seams). Decision: foreign → mint fresh; else reclaimable → kill+resume; else resume.
- `sessionHasLiveHolder` (tower-utils) delegates to the shared needle helper (gets JSON forms).
- Wire async reconcile into `addArchitect` + `launchInstance` main before `resolveArchitectLaunch`,
  passing `hasLiveHolder: () => foreignHolder`.
- `removeArchitect` not-found branch: reap a matching live zombie shellper → success.
- SessionManager maxRestarts give-up: logStderrTail (capture child reason) + kill shellper group
  (reap husk) so give-up leaves no row-gone/process-alive zombie.

Root-cause mapping to forensic timeline (issue comments): incident 1 = self stale remnant →
reclaim; incident 3 foreign = user's tty claude → mint fresh (never touch); incident 3
wedge-after-free + silent-dereg → give-up reap + stderr capture + remove-architect zombie reap.

### Implemented (iteration 2)
- `servers/architect-session-holder.ts` (new): needles (+JSON parent form), `isOwnArchitectShellper`
  (shellper-main.js + cwd + CODEV_ARCHITECT_NAME identity gate), `classifyArchitectSessionHolder`
  (own→reclaimable / foreign), `findOwnArchitectShellpers`, `reapShellpers` (group SIGTERM→SIGKILL,
  poll-for-death), `reconcileArchitectSessionHolder` (foreign→mint-fresh / own→reap+resume).
- `tower-utils.sessionHasLiveHolder` delegates to shared needles (gains JSON form + `ps -ww`).
- `addArchitect` + `launchInstance` main: async reconcile before `resolveArchitectLaunch`
  (`hasLiveHolder: () => foreignHolder`).
- `removeArchitect`: reaps live-process-no-row zombies (identity match).
- `session-manager` give-up: stderr capture + process-group SIGTERM husk reap.

Validation: full build ✓; full suite **3582 passed / 48 skipped, 0 failed** (30s); tsc clean.
Tests: architect-session-holder.test.ts (needles/identity/classify/reap/reconcile incl. explicit
never-kill-foreign) + session-manager give-up husk-reap. Net add this iteration ≫300 LOC — expected
for the architect-approved scope expansion.

Honesty note for PR: the wedge-after-free deeper cause (children dying <8s with the session
demonstrably free) — claude's own error surfaces via the PTY data/ring buffer, not shellper stderr,
so give-up now logs exit code/signal + shellper stderr for diagnosis and reaps the husk so the loop
can't persist; the definitive root cause of that specific datapoint is captured-for-diagnosis, not
claimed-fixed (per architect's "document rather than chase blind").

### CMAP iteration 2
- claude = APPROVE (HIGH, no issues).
- codex = REQUEST_CHANGES: (1) `reapShellpers` didn't confirm death AFTER SIGKILL → resume could
  race the still-exiting holder → **fixed** (post-SIGKILL `killGraceMs` poll + test). (2) status.yaml
  + thread.md in the PR → **rebutted with evidence**: status.yaml is committed by porch's own
  `chore(porch)` commits (builders must not touch it; prior merged bugfixes e.g. #1220 carry the
  identical commits), and the thread is committed by builder-role design (ships to main). Deferring
  the final call to the architect at the gate.
- Also self-caught + fixed a regression: `resolveArchitectRestart` was self-detecting the very
  shellper being reconnected (its child's argv holds `--resume <id>`) → would bake fresh restart
  args on every healthy reconnect and drop conversation on next crash. Now `hasLiveHolder:()=>false`
  on the restart-bake path (collision-avoidance is at add/launch reconcile + #1149 runtime fallback).

Validation after fixes: full build ✓; full suite **3583 passed / 48 skipped / 0 failed**; tsc clean.
