# Spec 823 — iter-4 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers**: Gemini (APPROVE), Codex (REQUEST_CHANGES, two narrow internal-contradiction findings), Claude (APPROVE)

---

## Summary

Iter-4 narrowed to internal-consistency fixes Codex caught after iter-3's additions. Two contradictions (Item 2 scope wording, Item 3 commit-default reconciliation) plus one file-path typo from Gemini, all addressed. No new substantive findings; the spec is converging.

---

## Gemini (APPROVE) — file-path typo addressed, architectural notes folded in

### G-4.1. File-path typo for `spawn.ts`

**Finding**: The spec referenced `packages/codev/src/agent-farm/spawn.ts` (line :448, :515, :520, :817) but the actual file is at `packages/codev/src/agent-farm/commands/spawn.ts`.

**Resolution**: Global replace applied — all three references corrected.

**Where in spec**: Functional MUST / Item 3 (strict-mode delivery rationale paragraph), Dependencies / Item 3 (spawn-prompt reference), Consultation Log iter-2 rebuttal note.

### G-4.2. Architectural notes (no spec changes required)

Gemini affirmed two architectural details that the plan phase picks up directly:

1. **SSE emit seam**: `tower-routes.ts`'s `handleAddArchitect` route handler can fire the event using `ctx.broadcastNotification(...)` — the cleanest path. No deeper threading through `tower-instances.ts` is needed since `launchInstance` is intentionally excluded (per OQ-G).
2. **SQL `WHERE` removal is safe**: full table scan on the `builders` table is negligible, and conditional assignment on `row.issue_number != null` / `row.spawned_by_architect != null` handles soft-mode rows correctly.

No spec changes — both notes go directly to the plan phase.

---

## Codex (REQUEST_CHANGES) — two narrow contradictions addressed

### C-4.1. Item 2 scope wording contradiction

**Finding**: The Functional MUST / Item 2 said "No new behavior is introduced — this is a documentation surfacing pass only. **No code changes outside the three markdown files**." But the same MUST section also required updating `codev-skeleton/templates/CLAUDE.md` and `codev-skeleton/templates/AGENTS.md` (added in iter-3). So the section listed five files while claiming "three markdown files," which is internally contradictory and would confuse the plan-phase builder.

**Verification**: Conceded immediately — this is purely an editing error introduced by iter-3's additions without updating the "three markdown files" wording.

**Resolution**: Rewrote the wording to be explicit and consistent: "No new behavior is introduced and no code changes are required. Item 2's full scope is markdown edits to **five files**: `CLAUDE.md`, `AGENTS.md`, `codev/resources/commands/agent-farm.md`, `codev-skeleton/templates/CLAUDE.md`, `codev-skeleton/templates/AGENTS.md`."

**Where in spec**: Functional MUST / Item 2 (last bullet, rewritten).

### C-4.2. Item 3 behavior contradiction (commit-default vs optional-strip)

**Finding**: Desired State item 3 said thread files "land in `codev/state/` on `main` after merge" (definite). But the success criteria's commit/retention rule allowed builders to "intentionally omit staging/committing the thread" as an explicit choice. Codex's question: is post-merge presence the default expectation with rare exceptions, or a non-guaranteed maybe? Reconcile.

**Verification**: Conceded — the Desired State and the success criteria were misaligned. The intent (since iter-3) was always "default commit, rare exception when noise," but the language allowed reading the exception as more permissive than intended.

**Resolution**:

1. **Desired State item 3**: rewrote with explicit defaulting — "By default, builders commit the thread file as part of their PR — so after merge, the thread lands in `codev/state/` on `main`." The exception clause is now framed as rare and explicit: "A builder MAY intentionally omit the thread from its PR (via gitignore for that PR or by not staging the file) **when the thread turned out to be noise** rather than useful narrative. Post-merge presence is the default expectation with rare, explicit exceptions — not a non-guaranteed outcome."
2. **Functional MUST / Item 3 commit/retention rule**: rewrote to make the MUST explicit: "**Default disposition is COMMIT.** The builder MUST commit `codev/state/<builder-id>_thread.md` to its branch as part of the PR. **Rare exception**: when the thread turned out to be noise rather than useful narrative, the builder MAY intentionally strip it before PR. The exception is opt-out, not opt-in — silently leaving the thread uncommitted by accident is a builder bug, not an exercise of the exception."

Both edits now agree: post-merge presence is the default outcome; non-commit is a rare, explicit, narrative-justified choice.

**Where in spec**: Desired State item 3, Functional MUST / Item 3 (commit/retention rule).

---

## Claude (APPROVE) — two plan-phase observations (no spec changes required)

### Cl-4.1. Null-safety for `state.architects.length`

`WorkView`'s `state` prop is `DashboardState | null`. When `state` is null (loading), the builders section wouldn't render anyway, but the `architectCount` derivation needs null-guarding. Plan phase pins this — OQ-A defers the `architectCount` source decision to plan.

### Cl-4.2. `BuilderCard` also used by `NeedsAttentionList`

`WorkView.tsx:115` passes `overview?.builders` to `NeedsAttentionList`, which likely also renders `BuilderCard` components. The `architectCount` prop addition needs threading to both call sites. Plan phase checks; OQ-A's scope covers this.

Both observations are real plan-phase work, not spec defects. The spec correctly defers them via OQ-A.

---

## Net spec change summary (iter-4)

- **1 wording correction** (Item 2 scope: "three" → "five markdown files," contradiction resolved).
- **1 behavior reconciliation** (Item 3 default-commit explicit, exception rare-and-opt-out).
- **1 file-path typo fix** (`spawn.ts` global path correction).
- **No findings rejected.** No disagreements with reviewers.

## Iter-5 readiness

Spec is ready for iter-5 CMAP. Codex's two narrow internal-contradiction findings are resolved. Gemini and Claude were APPROVE at iter-4; their notes are folded in. Iter-5 should converge to APPROVE across all three reviewers; if any new findings surface, those will be addressed in iter-5 corrections.

If iter-5 verdicts are unanimous APPROVE (or APPROVE/COMMENT-only), spec is ready to return to the spec-approval gate per architect direction.
