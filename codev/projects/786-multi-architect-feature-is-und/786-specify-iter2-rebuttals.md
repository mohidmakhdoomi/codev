# Spec 786 — Iter-2 CMAP Rebuttal

**Date**: 2026-05-20
**Reviewers (iter-2)**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (APPROVE)
**Outcome**: All Codex findings accepted and incorporated into iter-4 spec. Gemini's and Claude's plan-time notes documented for the plan phase.

---

## Summary

Iter-2 CMAP converged on APPROVE from Gemini and Claude. Codex flagged 4 underspecified surfaces that, after verification against the codebase, all required spec-level fixes (not just plan-time notes). The iter-4 spec addresses each one. The architect's iter-3 decisions on OQ-A/B/D/G remain intact.

---

## Gemini — APPROVE
Three plan-time notes, all already covered by existing Risk-table mitigations or now codified explicitly:
- `stopInstance` / exit-handler cascade → addressed via new explicit MUST in iter-4 (graceful-stop vs permanent-exit distinction; enumerates the five exit handlers).
- `launchInstance` boot for `main` when siblings exist → new MUST added: "`launchInstance` correctly boots `main` even when sibling rows already exist."
- VSCode `getChildren` rework → covered by the new VSCode MUST and updated Dependencies.

No additional spec changes from Gemini.

---

## Claude — APPROVE
Two plan-time notes, both now explicit:
- Reconciliation exit-handler at `tower-terminals.ts:665-677` needs `setArchitectByName(name, null)` cleanup for OQ-B → the new MUST enumerates this exit handler explicitly alongside the four others.
- Active-tab fallback to `main` requires explicit code (existing `useTabs:194` fallback goes to `'work'`) → already in the spec as a SHOULD criterion ("Dashboard active-tab state survives sibling removal cleanly"); Claude's note confirms it requires new code rather than relying on the existing fallback. Plan phase will pin the implementation.

Additional second-caller note (`tower-routes.ts:~2061`) added to Dependencies per Claude.

No additional spec changes from Claude.

---

## Codex — REQUEST_CHANGES (4 findings, all accepted)

### Co1. Graceful stop/start persistence underspecified
> "In `packages/codev/src/agent-farm/servers/tower-instances.ts`, architect `on('exit')` handlers already delete `terminal_sessions` and `state.db` rows on terminal death. So changing only `stopInstance`'s bulk delete is not sufficient; the spec should explicitly define how intentional workspace stop suppresses that cleanup while permanent exit still deletes rows."

**Status**: Accepted.

**Verification**: Confirmed five exit-handler locations:
- `tower-instances.ts:452-462` — main's shellper-backed exit handler (calls `deleteTerminalSession`)
- `tower-instances.ts:507` — main's fallback PTY exit handler
- `tower-instances.ts:777-793` — addArchitect's shellper-backed sibling exit handler (calls both `setArchitectByName(name, null)` AND `deleteTerminalSession`)
- `tower-instances.ts:830-846` — addArchitect's fallback PTY sibling exit handler
- `tower-terminals.ts:665-677` — reconciliation exit handler (calls `deleteTerminalSession` but NOT `setArchitectByName`, per Claude)

Today, when `stopInstance` kills sibling architects via `killTerminalWithShellper`, the sibling exit handlers fire and delete the rows. Just changing `stopInstance`'s `deleteWorkspaceTerminalSessions` bulk-delete is therefore necessary but not sufficient.

**Changes made**: Added explicit MUST in iter-4:

> "The row-deletion paths must distinguish 'intentional stop' from 'permanent exit': intentional stop (via `stopInstance` / `handleWorkspaceStopAll`) preserves sibling rows; permanent exit (max-restart exhaustion, explicit `remove-architect`) deletes them per OQ-B. The exit handlers at `tower-instances.ts:452-462`, `:507`, `:777-793`, `:830-846` and the reconciliation exit handler at `tower-terminals.ts:665-677` must each be inspected and updated to honour this distinction (e.g. a 'shutdown in progress' flag, or routing intentional stops through a different teardown path that skips the `setArchitectByName(name, null)` call)."

Also added MUST for `launchInstance` boot semantics when siblings already exist (the existing `size === 0` gate becomes unsafe).

---

### Co2. VSCode requirement incomplete for the actual extension architecture
> "`packages/vscode/src/views/workspace.ts` is flat today, `packages/vscode/src/extension.ts` opens only `state.architect`, and `packages/vscode/src/terminal-manager.ts` treats architect terminals as a singleton keyed as `'architect'`. The spec should state whether selecting a sibling opens a separate VSCode terminal, reuses a single architect slot, and what the expected click behavior is."

**Status**: Accepted.

**Verification**: Confirmed singleton behavior:
- `workspace.ts:56-64` — single "Open Architect" tree item, single `codev.openArchitectTerminal` command (no name argument)
- `terminal-manager.ts:96, :116, :333` — `this.terminals.get('architect')` keyed on the literal `'architect'` string

**Changes made**: Added explicit MUST:

> "VSCode click behaviour and terminal-slot model: Clicking a child entry (e.g. `main` or a sibling name) opens that architect's terminal in the VSCode editor area. Each architect gets its own VSCode terminal slot keyed by architect name — `terminal-manager.ts` must replace its singleton `'architect'` key (used at `:96, :116, :333` today) with per-name keys (e.g. `architect:<name>`). Opening the same architect twice reuses the existing terminal; opening a different architect creates (or focuses) its own terminal. The existing `codev.openArchitectTerminal` command is extended (or replaced with a parameterised variant) to accept the architect name as an argument; the tree-item `command.arguments` carries the name."

---

### Co3. `afx status` needs a clearer contract
> "The Tower status shape currently exposes only terminal list metadata, and the Tower-down fallback reads `state.db` rows whose architect `pid/port` are currently persisted as `0` by `setArchitect()` / `setArchitectByName()`. If name/PID/port/terminal ID must always be shown, the spec needs to require the necessary API/state changes; otherwise it should scope that requirement to Tower-running mode."

**Status**: Accepted.

**Verification**: Confirmed:
- `state.ts:79` — `setArchitect` writes `pid: 0, port: 0` literally
- `state.ts:103` — `setArchitectByName` writes `pid: 0, port: 0` literally
- Even `main`'s row has pid/port 0 in state.db today

**Changes made**: Scoped the criterion to what's actually achievable without a state.db schema change:

> "`afx status` enumerates ALL registered architects when Tower is running, showing **at minimum: architect name and terminal ID**. PID and port are shown when available from Tower's in-memory `PtySession` (the architect-row's stored `pid`/`port` are 0 — `setArchitect()` / `setArchitectByName()` persist literal `0` per `state.ts:79, :103` — so PID/port enumeration requires Tower's live data, not state.db). In Tower-down (fallback) mode, `afx status` enumerates by name and `cmd` only; PID/port are omitted with a note ('Tower not running')."

If the architect later wants PID/port persisted, that's a separate enhancement (add an `UPDATE architect SET pid=?, port=?` call on spawn; out of scope for #786 unless explicitly requested).

---

### Co4. Wrong client path reference
> "`packages/codev/src/agent-farm/client/workspace-client.ts` does not exist in this repo. The active client surface is `packages/core/src/tower-client.ts` (re-exported via `packages/codev/src/agent-farm/lib/tower-client.ts`)."

**Status**: Accepted.

**Verification**:
- `packages/codev/src/agent-farm/client/workspace-client.ts` — no such file
- `packages/codev/src/agent-farm/lib/tower-client.ts:18` — re-exports from `@cluesmith/codev-core/tower-client`
- `packages/core/src/tower-client.ts` — actual implementation

**Changes made**: Corrected Dependencies entry to: "`packages/core/src/tower-client.ts` (new `removeArchitect` RPC; re-exported via `packages/codev/src/agent-farm/lib/tower-client.ts`)".

Also added `tower-routes.ts:~2061` to Dependencies per Claude's plan-time note.

---

## What did NOT change

- Architect's iter-3 decisions on OQ-A/B/D/G are preserved verbatim.
- Approach 1 endorsement is unchanged.
- Out-of-scope items are unchanged.
- Risk table is unchanged (mitigations already cover the surfaces flagged).
- Verify-phase round-trip discipline is unchanged.

---

## Net effect

Iter-3 → Iter-4: ~30 lines of additions across Functional MUST criteria, Dependencies, and the Consultation Log. No removals. The four Codex REQUEST_CHANGES findings each have a corresponding new MUST or scope-clarification in the spec. Gemini's and Claude's plan-time notes are documented but did not require spec changes beyond what Codex's iter-2 review already triggered.

Ready for iter-3 CMAP confirmation (per architect's directive: "Once iter-2 lands all-APPROVE or COMMENT (no REQUEST_CHANGES), come back for the spec-approval gate").
