# Spec 786 — Iter-1 CMAP Rebuttal

**Date**: 2026-05-20
**Reviewers**: Gemini (REQUEST_CHANGES), Codex (REQUEST_CHANGES), Claude (COMMENT)
**Outcome**: All key issues accepted and incorporated into iter-2 spec. No disagreements.

---

## Summary

The three reviewers converged on a single core finding: the iter-1 spec's "Known gaps" diagnoses didn't match current code. After direct verification against `tower-instances.ts`, `tower-terminals.ts`, `tower-utils.ts`, `state.ts`, `utils/architect-name.ts`, and `useTabs.ts`, the reviewers' corrections all check out. The iter-2 spec is a substantial rewrite of the Current State, Success Criteria, Constraints, and Open Questions sections.

---

## Gemini — REQUEST_CHANGES

### G1. Gap #3 root cause is wrong
> "The spec claims `addArchitect()` skips `setArchitectByName()`. This is false… The actual blocker for sibling auto-rebind is in `tower-terminals.ts` (`reconcileTerminalSessionsInner`), which hardcodes the re-spawn command to `claude`… Siblings lose their custom `cmd` on Tower restart…"

**Status**: Accepted with partial reframing.

**Verification**:
- `tower-instances.ts:767` and `:816` — `setArchitectByName(name, {...})` IS called on add. Confirmed.
- `tower-instances.ts:759` and `:813` — `saveTerminalSession(..., 'architect', name, ...)` IS called on add. Confirmed.
- `tower-terminals.ts:551-557` — restart command construction reads `config.shell?.architect` and DOES NOT read the sibling's persisted `cmd`. Confirmed.

**Reframe in iter-2**:
- The persistence-write story works.
- The actual graceful-restart gap is twofold:
  1. `stopInstance` at `tower-instances.ts:608` calls `deleteWorkspaceTerminalSessions` which deletes ALL rows for the workspace — siblings' rows are gone before any restart logic could read them.
  2. `launchInstance` at `:362-431` only creates `main` — even if rows survived, this path doesn't iterate them.

The `cmd`-hardcoding concern Gemini raises is real but secondary — it matters once the row-survival problem is fixed. The iter-2 spec calls it out in the assumptions section (the plan must verify that the persisted `cmd` column is read on restart, not just the config default).

**Changes made**: Known Gaps table row #3 rewritten (graceful-stop deletes rows; launchInstance only-creates-main). Success Criteria's persistence MUST is now scoped to "rows survive graceful stop AND launchInstance re-spawns from them with recorded `cmd` and re-injected `CODEV_ARCHITECT_NAME`."

---

### G2. Right-pane builder/shell tabs ALREADY have close buttons
> "`packages/dashboard/src/hooks/useTabs.ts` already sets `closable: true` for both builders and shells today."

**Status**: Accepted.

**Verification**:
- `useTabs.ts:77` — builders set `closable: true`. Confirmed.
- `useTabs.ts:91` — shells set `closable: true`. Confirmed.
- `TabBar.tsx:48-64` — renders X conditional on `closable`. Confirmed (per Explore agent's earlier note).

**Changes made**: Gap #2 in the iter-2 table narrowed to "architect tabs hardcode `closable: false`" only. The "right-pane terminals also lack a close button" claim from the issue body is moved to the **Out of Scope** section with a note explaining the issue body's diagnosis didn't match current code. OQ-2 from iter-1 is dropped.

---

### G3. Surface-parity fix needs explicit removal of v1 collapse logic
> "The spec must explicitly require the removal of the v1 UI truncation logic in `packages/codev/src/agent-farm/servers/tower-terminals.ts` (L928-L940). Currently, that function intentionally collapses all registered architects into a single `'architect'` API entry…"

**Status**: Accepted.

**Verification**:
- `tower-terminals.ts:928-940` — `if (freshEntry.architects.size > 0) { terminals.push({ type: 'architect', id: 'architect', label: 'Architect', ... }); }`. The comment explicitly says "Multi-architect UI is deferred to issue #2." Confirmed.

**Changes made**: Added Gap #5 in iter-2 table calling out the v1 collapse explicitly. Added a MUST in Success Criteria: "The v1 collapse logic at `tower-terminals.ts:928-940` is replaced with per-architect emission." Added the location to Dependencies and Risks table.

---

### G4. `validateArchitectName` accepts `main`
> "The existing `validateArchitectName()` function… currently allows it (as it matches the `^[a-z][a-z0-9-]*$` regex). The spec should explicitly note that this utility must be updated to reject `'main'`."

**Status**: Accepted.

**Verification**:
- `utils/architect-name.ts:24-35` — `validateArchitectName('main')` returns `null` (valid).
- Rejection of `'main'` today happens only via collision: `entry.architects.has('main')` at the add-architect path. If the in-memory map were empty (race or bug), `main` would be accepted.

**Changes made**: Added Gap #8 (main is rejected only by collision). Added MUST: "`validateArchitectName` rejects the reserved name `main` in addition to its existing checks." Added OQ-E: should the check live in the pure utility or at the call site? (Recommendation: utility — that's the canonical validation point.)

---

## Codex — REQUEST_CHANGES

### C1. Repo-level inaccuracies in Current State
> "Sibling architects are already persisted on add via `setArchitectByName(...)` in `packages/codev/src/agent-farm/servers/tower-instances.ts`, and right-pane builder/shell/file tabs are already closable via `packages/dashboard/src/hooks/useTabs.ts` + `packages/dashboard/src/components/TabBar.tsx`. `main` is also already labeled via `buildArchitectTabs()` in `useTabs.ts`."

**Status**: Accepted — same as G1, G2.

**Verification**: Same as G1, G2. Additionally confirmed `main` labelling: `useTabs.ts:47` defaults missing names to `'main'`; `:51` sets `label: name`. So `main`'s tab is labelled "main" today.

**Changes made**: Iter-2 Known Gaps table corrected throughout. The (probable) "Dashboard tab labelling" gap from the iter-1 spec is dropped since `main`'s label is already correct.

---

### C2. OQ-3 (remove-with-in-flight-builders) is blocking, not advisory
> "OQ-1 and especially OQ-3 are blocking, not merely advisory. The remove flow cannot be designed or tested cleanly until the spec decides what happens when removing an architect that still owns active builders."

**Status**: Partially accepted.

**Disagreement**: OQ-1 (persistence model) IS now resolved in the iter-2 spec — Approach 1 (persist + auto-rebind across graceful restart) is selected. The spec no longer presents it as an open question. So C2's framing of OQ-1 as blocking is moot.

**Agreement**: OQ-3 (renamed OQ-A in iter-2) is correctly flagged as blocking. The iter-2 spec includes a recommended resolution (option (b): remove the architect and let `tower-messages.ts:336` fallback route to main) with rationale, but leaves the final decision to the architect at the spec-approval gate. That's how SPIR's Open Questions are meant to work — recommended, but architect-call.

**Changes made**: OQ-1 promoted to a decided approach (Solution Approaches → Recommendation: Approach 1). OQ-A retained as a critical open question with a recommendation.

---

### C3. Naming requirements conflict with existing validator and spec examples
> "The repo currently enforces `[a-z][a-z0-9-]*` with a 64-character cap… the spec's accepted example `_internal` would fail today. Decide whether to keep the current validator or intentionally change it, and state the full rule set explicitly."

**Status**: Accepted.

**Verification**:
- `utils/architect-name.ts:13-14` — `ARCHITECT_NAME_PATTERN = /^[a-z][a-z0-9-]*$/`, `MAX_ARCHITECT_NAME_LENGTH = 64`. Confirmed.
- The iter-1 spec's "Accept: `_internal`" example contradicted this. My mistake.

**Changes made**: Iter-2 test scenarios use only names that match the existing regex (`ob-refine`, `team-a`, `architect-2`). The naming MUST is scoped to "extend the existing validator with a reserved-name check for `main`" — not "redefine the rules." OQ-6 from iter-1 is dropped (no change to the regex is desired or proposed); OQ-E asks the smaller question of whether the reserved-name check lives in the utility or at the call site.

---

### C4. Identity preservation across restart
> "A restarted sibling architect must preserve its architect identity for future builder affinity/routing, not just reappear as a PTY. In the current reconnect path…, architect restart env reconstruction does not obviously re-inject `CODEV_ARCHITECT_NAME`, so 'persistence parity' should define identity preservation, not only terminal resurrection."

**Status**: Accepted.

**Verification**:
- `tower-instances.ts:728` — `addArchitect` correctly injects `CODEV_ARCHITECT_NAME: name` at first spawn. Good.
- `tower-terminals.ts:559-567` — reconciliation builds `cleanEnv = { ...process.env }; delete cleanEnv['CLAUDECODE'];` — NO `CODEV_ARCHITECT_NAME` injection from `dbSession.role_id`. Confirmed.
- `tower-terminals.ts:773-776` — same pattern in the workspace-status reconnect path. Confirmed.

This means: when shellper auto-restarts a sibling's claude process (max-restart loop), the new claude process inherits Tower's process env (default architect name = main, or unset). Builders spawned after that point lose affinity to the sibling.

**Changes made**: Added Gap #4 calling out identity loss on auto-restart explicitly. Added MUST: "Identity preservation across shellper auto-restart… `restartOptions.env` with `CODEV_ARCHITECT_NAME: <name>` for every architect (where `<name>` comes from `dbSession.role_id`)." Added test scenario #5 to assert this via a builder spawned post-restart. Added to Risks table.

---

## Claude — COMMENT

Claude's review converged on the same factual corrections as Gemini and Codex and added two clarifying points:

### Cl1. "Mirror the builder pattern" constraint is misleading
> "Builders and architects already share the **same** reconciliation path in `tower-terminals.ts:reconcileTerminalSessions()`… The infrastructure for sibling reconnection already exists. The constraint should say 'extend the existing reconciliation path to survive graceful restarts' rather than 'mirror a builder pattern.'"

**Status**: Accepted.

**Changes made**: Constraints section rewritten — "Tower restart re-spawn must NOT mirror builder rebind exactly (per Claude's review — builders and architects already share `reconcileTerminalSessions()`). The constraint is to extend the existing reconciliation path, not invent a parallel mechanism."

### Cl2. Auto-numbering not mentioned in iter-1 spec
> "`afx workspace add-architect` without `--name` auto-numbers via `autoNumberArchitectName()`… when `remove-architect architect-2` runs, do we renumber `architect-3` → `architect-2`? (Presumably no, but worth stating.)"

**Status**: Accepted.

**Changes made**: Added a COULD criterion: "removing `architect-3` leaves the slot 'gap-filled' by the next add per `autoNumberArchitectName`'s existing semantics. No renumbering of existing architects." Added test scenario #12: add architect-2, architect-3; remove architect-2; add another — new one is named architect-2 (gap-filled). Documented `autoNumberArchitectName` in the Current-State capabilities table.

### Cl3. `validateArchitectName` location
> "It's actually defined in `utils/architect-name.ts` and imported by `workspace-add-architect.ts`."

**Status**: Accepted. Iter-1 spec's reference was off-by-one file.

**Changes made**: Dependencies and Known Gaps tables updated with correct path (`utils/architect-name.ts`).

### Cl4. `main` rejection is collision-based, not reserved
**Status**: Accepted — same as G4 / C3. Covered above.

---

## What did NOT change

- **Verify-phase requirement** ([[feedback_e2e_headline_path]]) is unchanged — all three reviewers endorsed it as the right discipline.
- **Approach 1 over Approaches 2/3** — endorsed by Claude ("Approach 1 reasoning is strong"); Gemini and Codex didn't dispute.
- **Out-of-scope items** (cross-workspace, renaming) unchanged.
- **Risk table structure** unchanged; new risks added based on review (env-injection misses, v1-collapse consumer impact).

---

## Net effect

Iter-1 → Iter-2: 168 line insertions, 131 deletions (one diff). Mostly rewrites of the Current State, Success Criteria, Open Questions, and Dependencies sections; minor additions elsewhere. The verdict-blocking issues from Gemini and Codex are all resolved by the iter-2 text. Ready for iter-2 CMAP.
