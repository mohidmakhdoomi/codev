# Phase 2 Review Rebuttals — Iteration 1

**Phase**: implement / phase_2 (Naming CLI and spawn-time identity capture)
**Iteration**: 1
**Date**: 2026-05-18

## Reviewer verdicts

| Reviewer | Verdict | Confidence |
|----------|---------|------------|
| Codex    | REQUEST_CHANGES | HIGH |
| Claude   | APPROVE | HIGH |
| Gemini   | REQUEST_CHANGES | HIGH |

Codex and Gemini both flagged blocking gaps; Claude approved with two minor notes. Every actionable point addressed.

---

## Codex — REQUEST_CHANGES

### C1. Named architects are not persisted to local `state.db`

> `setArchitectByName()` exists but is never called. `addArchitect()` only updates in-memory state and `terminal_sessions`. That leaves the local mirror incomplete.

**Status**: Addressed. Real bug — and the verification turned up an even bigger inconsistency.

**Verification**: I traced `setArchitect` callers and found that `setArchitect` is **only called in tests, never in production code**. That meant the local `architect` table was effectively vestigial — `commands/status.ts` and `commands/stop.ts` both read it via `loadState()`, but no production writer ever populated it. The legacy `stop.ts` cleanup path (which Gemini flagged in Phase 1) was reaching into an empty table.

**Change**: Both architect-creation paths now persist to the local state.db:

- `launchInstance` (the workspace-start path) calls `setArchitect({ name: 'main', cmd, startedAt, terminalId })` after `saveTerminalSession`. The wrap is `try/catch` with a warning log — the persistence is a mirror of in-memory state, so a write failure doesn't fail the architect-start.
- `addArchitect` (the new CLI path) calls `setArchitectByName(name, { name, cmd, startedAt, terminalId })` analogously, for both the shellper and non-persistent fallback PTY paths.
- Exit handlers now call `setArchitectByName(name, null)` to clean up the row from local state.db when the architect terminal dies.

This goes slightly beyond Phase 2's named-architect scope by also wiring up the `main` path — but the fix is contained, makes the local mirror real for the first time, and fixes the latent inconsistency that Gemini's Phase 1 stop.ts feedback hinted at.

### C2. Explicit empty `--name` is auto-numbered instead of rejected

> The client skips validation on falsy values; the client request drops `''` from the JSON body; and the server also branches on truthiness.

**Status**: Addressed. Real bug — `--name ''` silently became "no name given."

**Change**: Tightened all three layers to distinguish `undefined` (no flag — auto-number is correct) from explicit empty/whitespace (user error — must reject):

1. **CLI (`workspace-add-architect.ts`)**: `if (options.name !== undefined)` (not `if (options.name)`) gates validation. Trim and reject empty string with a clear message before any Tower roundtrip.
2. **Client (`tower-client.ts:addArchitect`)**: `const body = name === undefined ? {} : { name };` — the explicit empty string survives into the JSON body so the server can reject it.
3. **Server (`tower-instances.ts:addArchitect`)**: same predicate. Reject empty/whitespace explicitly with the same error message, then run `validateArchitectName` on the trimmed value. Defense in depth — even a misbehaving client can't bypass.

### C3. Test coverage is not adequate

> No tests covering `workspace add-architect`, collision rejection, persistence to local architect state, or real `spawn.ts` capture of `spawnedByArchitect`.

**Status**: Addressed. (Same as Gemini's G1.)

**Change**: Three new test surfaces:

1. **`tower-routes.test.ts`** — new `describe('POST /api/workspaces/:path/architects')` block with 6 cases:
   - Success path: 200 + response body, `addArchitect` called with the right args.
   - Auto-number path: undefined `name` flows through to `addArchitect(workspacePath, undefined)`.
   - Workspace-not-running: 404 with error message.
   - Collision rejection: 400 with the architect's name in the error.
   - Non-POST methods: 405.
   - Malformed encoding: 400.
2. **`state.test.ts`** — three new cases on `upsertBuilder`:
   - Persists `spawnedByArchitect` when supplied.
   - Preserves existing `spawnedByArchitect` across re-upserts (COALESCE behavior asserted end-to-end).
   - Legacy upsert with no `spawnedByArchitect` leaves the column null.
3. **`spec-755-phase2.test.ts`** — new `describe('workspace-add-architect client-side validation')` block exercising the predicate the CLI uses (undefined-vs-empty-vs-whitespace, trim semantics).

---

## Gemini — REQUEST_CHANGES

### G1. Required integration tests for `addArchitect`, `afx spawn`, CLI state observation, and collision rejection are missing

> The new test file explicitly limits itself to pure helpers. The required integration tests were skipped.

**Status**: Addressed. Same as Codex C3. The new `tower-routes.test.ts` block exercises the real route handler against mocked `addArchitect` (success, auto-number, 404 workspace-not-running, 400 collision, 405 non-POST, 400 bad-encoding), and `state.test.ts` exercises `upsertBuilder` end-to-end with a real SQLite database including the COALESCE re-upsert preservation.

---

## Claude — APPROVE

### Cl1. `CODEV_ARCHITECT_NAME` documentation in `agent-farm.md` not yet written

**Status**: Addressed.

**Change**: Two doc additions to `codev/resources/commands/agent-farm.md`:

- New `#### afx workspace add-architect` section with synopsis, options, description, naming rules, examples, and related notes.
- New `## Environment Variables` section documenting `CODEV_ARCHITECT_NAME` (and `TOWER_ARCHITECT_CMD`, which was previously undocumented) with set-by / read-by / purpose columns.
- `#### afx workspace stop` Description bullet list now explicitly mentions teardown of sibling architects.

### Cl2. Exit handler duplication

**Status**: Not addressed. Non-blocking refactor — left for a later cleanup pass. The duplicated code is short (~6 lines per copy) and well-localized.

---

## Items I did NOT change

- **Exit handler cleanup helper extraction** (Claude's minor): non-blocking, and the duplication is small enough that a future refactor can do it more thoroughly across multiple files.
- **Behavior for non-builder senders in `architect` resolution**: unchanged from Phase 1. Phase 3 introduces the affinity-aware path.

---

## Summary

Three convergent issues addressed: missing local state.db persistence (now wired up for both `main` and named architects, also fixing a latent inconsistency Gemini flagged in Phase 1); empty `--name` rejection (tightened at CLI, client, and server layers); integration tests for the route handler and `spawnedByArchitect` persistence. Documentation gap fixed.

`porch check 755` passes (build + tests). All 2643 codev tests pass. Phase 2 is ready for `porch done`.
