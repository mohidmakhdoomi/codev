# Phase 7 — Iter-1 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers (iter-1)**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (COMMENT)
**Outcome**: All Codex findings + Claude's stale-status-section comment addressed.

---

## Gemini — APPROVE
> "Phase 7 is fully implemented; all documentation updates, CHANGELOG entries, and the verify-scenarios script meet the spec and plan requirements."

No changes requested.

---

## Codex — REQUEST_CHANGES (3 findings, all accepted)

### Co1. `afx workspace stop-all` doesn't exist as a CLI command
> "`codev/resources/commands/agent-farm.md:260` documents `afx workspace stop-all`, but there is no such CLI command in `packages/codev/src/agent-farm/cli.ts:74-125`. Reword this to the actual surface (dashboard stop-all / API route)."

**Status**: Accepted.

**Verification**: Confirmed — `cli.ts:74-125` registers `start`, `stop`, `add-architect`, `remove-architect` under `workspace` but no `stop-all`. The stop-all path is API-only (`POST /workspace/<base64>/api/stop` → `handleWorkspaceStopAll`).

**Changes made (iter-2)**: Reworded the bullet in `agent-farm.md`'s "Persistence and recovery" section to: "Dashboard 'Stop All' (or `POST /workspace/<base64>/api/stop` directly): full wipe ... There is no `afx workspace stop-all` CLI today — the full-wipe path is currently API-only via the dashboard." This is accurate and tells users where to find the functionality.

### Co2. `afx open architect:ob-refine` is wrong in verify-scenarios.md
> "`codev/projects/786-multi-architect-feature-is-und/verify-scenarios.md:28` tells reviewers to use `afx open architect:ob-refine`, but `afx open` is a file-annotation command, not a terminal-opening command."

**Status**: Accepted.

**Verification**: Confirmed — `packages/codev/src/agent-farm/commands/open.ts:2-6` describes `afx open` as "File annotation viewer". There's no CLI shortcut to open an architect's PTY directly.

**Changes made (iter-2)**: Reworded the Scenario 1 step to point at the dashboard tab strip click OR VSCode sidebar → "Architects" expand → click, with an explicit note: "`afx open` is the file-annotation command, not a terminal opener."

### Co3. CHANGELOG mischaracterizes `afx tower stop` baseline
> "`CHANGELOG.md:18` says '`afx tower stop` and crash recovery already worked,' which conflicts with the approved spec baseline stating graceful `afx tower stop` was part of the persistence gap."

**Status**: Accepted.

**Verification**: Re-read the spec — the Desired State section says: *"Sibling architects survive `afx workspace stop` + `afx workspace start` (and `afx tower stop` + start)."* — explicitly listing `afx tower stop` as part of the persistence gap. My CHANGELOG entry conflated `afx tower stop` (graceful, broken pre-Spec-786) with Tower process crash (worked via crash-recovery path).

**Changes made (iter-2)**: Rewrote the entry: "sibling architects now survive both `afx workspace stop` + `afx workspace start` AND `afx tower stop` + start. Both paths were broken pre-Spec-786 because the cascaded exit handlers indiscriminately deleted the `state.db.architect` rows during shutdown. Crash recovery (Tower process killed without graceful shutdown — `terminal_sessions` rows survive and `reconcileTerminalSessions()` reconnects on startup) was already working; the matrix is now complete."

This distinguishes the three lifecycle paths (workspace stop, tower stop, crash) accurately.

---

## Claude — COMMENT (1 finding, accepted)

### Cl1. `agent-farm.md`'s `afx status` section is stale
> "**`agent-farm.md:340-368`** — The `afx status` section still reads: 'Displays the current state of all builders and **the architect**:' And shows the pre-786 collapsed table format with a single `arch | Architect | running | main` row. But the actual implementation (`status.ts:54-88`) now outputs a separate `Architects:` section listing each architect individually."

**Status**: Accepted.

**Changes made (iter-2)**: Rewrote the section to show both Tower-running and Tower-down output examples that match `status.ts:54-117`'s actual output (per-architect section with name + pid + terminal id when Tower is up; name + cmd when Tower is down). The description now reads: "Displays the current state of Tower, the registered architects (one per sibling — Spec 786 Phase 5 replaces the pre-786 single-row collapse), and the running builders."

---

## What did NOT change

- `arch.md`'s multi-architect lifecycle section — all three reviewers approved it.
- `verify-scenarios.md`'s 12 scenarios (other than the corrected step in Scenario 1).
- CLI `--help` text for `remove-architect` (verified by Claude; description string in `cli.ts:121-124` is correct).
- CHANGELOG's other Added/Changed entries.

## Net effect

Iter-1 → iter-2: 3 doc files updated (`agent-farm.md`, `verify-scenarios.md`, `CHANGELOG.md`). Pure-docs changes, no code. Ready for iter-2 CMAP confirmation.
