# PIR #832 — Multi-architect conversation resume via per-architect session UUID

## Phase: plan (in progress)

### What this is
Follow-up to #830. Main-architect conversation resume shipped via jsonl-discovery
(newest `*.jsonl` by mtime). That heuristic can't disambiguate named sibling
architects (Spec 755) because they share `cwd = workspacePath` — all their jsonls
land in the same encoded-cwd dir. Fix: persist a per-architect Claude session UUID
in the `architect` state.db row; pass `--session-id <uuid>` at spawn and
`--resume <uuid>` at every revive surface.

### Investigation findings
- claude CLI confirmed to support both `--session-id <uuid>` and `-r/--resume [value]`
  (verified via `claude --help`). Resume WITHOUT `--fork-session` keeps the same
  session id, so a stored UUID stays valid across unlimited revivals.
- Three revive surfaces, all need the same lookup branch:
  1. `tower-instances.ts launchInstance` (main cold-spawn) — currently uses
     `findLatestSessionId` + `safeToResume = getArchitects().length <= 1` guard
     (the guard this issue removes).
  2. `tower-instances.ts addArchitect` (sibling cold-spawn + sibling reconcile loop) —
     currently NO resume (deliberate in #830).
  3. `tower-terminals.ts reconcileTerminalSessions` ~L636-679 (shellper auto-restart
     options bake) — currently `buildArchitectArgs` only, no resume. This is the
     silent-context-loss path (claude crash inside a live shellper).
- `removeArchitect` calls `setArchitectByName(..., null)` which DELETEs the whole
  row → UUID cleared automatically (satisfies "removal-clears-UUID").
- DB migrations are at v11; add v12 `ALTER TABLE architect ADD COLUMN claude_session_id TEXT`.
- `findLatestSessionId` stays (builders/#831 still use it via spawn.ts); only main
  stops using it.

### Design decisions to flag at plan gate
- Main loses jsonl-discovery fallback → one-time context loss on the FIRST reboot
  after this lands (legacy row has no stored UUID). Accepted per issue's
  Backwards-compat section. Hybrid alternative (keep jsonl fallback for main when
  count<=1) considered + rejected to keep the path uniform.
- setArchitect/setArchitectByName switched to COALESCE-preserving upsert so a
  later row update that omits the UUID can't wipe it (mirrors upsertBuilder's
  spawned_by_architect COALESCE pattern).

Plan written to codev/plans/832-multi-architect-conversation-r.md.

### Plan revision 1 (answering architect: "consistent approach for recovering architects?")
Tightened the design into one uniform model + fixed a real gap:
- **Consistency rule**: UUID minted exactly once at cold-spawn; every other surface
  only reads it. Single `resolveArchitectLaunch(...)` helper in
  claude-session-discovery.ts, called by all three sites (no per-site branch drift).
  `mintIfAbsent: true` for cold-spawn (launchInstance/addArchitect), false for the
  shellper-restart bake.
- **Gap fixed**: stored UUID whose jsonl was pruned would make `--resume` fail.
  Added `sessionFileExists` guard → resume only when the jsonl exists, else re-mint
  (cold) / role-inject (restart). Makes stored-UUID resume as safe as #830's
  jsonl-discovery. claude-session-discovery.ts now hosts BOTH builder discovery and
  architect resume, documented side by side.

### Plan revision 2 (architect chose STATELESS approach)
Architect asked "can we avoid DB updates?" → chose stateless derived session IDs.
Rewrote plan: NO db column, NO migration v12, NO schema/state.ts/types changes.
- sessionId = UUIDv5(ARCHITECT_NS, canonicalWorkspacePath + ':' + name) — pure
  function (node:crypto sha1, no new dep). Name in the key → siblings sharing cwd
  derive distinct IDs (solves the collision jsonl-discovery couldn't).
- Every site recomputes + resolveArchitectLaunch: jsonl exists → --resume, else
  --session-id (create at derived id). No store step anywhere.
- removeArchitect prunes the derived jsonl so remove-then-readd is fresh.
- Architect Q: "why is main recoverable but siblings not today?" → it's cwd-based,
  not capability-based. findLatestSessionId picks newest jsonl in the cwd's project
  dir; unique cwd (main-only, or builders) → recency disambiguates; shared cwd
  (siblings) → it can't. In multi-arch workspaces main ALSO skips resume (safeToResume
  guard). Fix puts NAME into the key.
