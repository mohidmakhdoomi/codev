# Spec 823 — iter-2 CMAP Rebuttal

**Date**: 2026-05-22
**Reviewers**: Gemini (APPROVE), Codex (REQUEST_CHANGES), Claude (APPROVE)

---

## Summary

Iter-2 narrowed to Item-3-only findings. Codex's REQUEST_CHANGES surfaced three Item-3 corrections (strict-mode delivery rationale, in-flight thread location, skeleton MUST). Claude's APPROVE added three COMMENT-level dependency-list improvements. Gemini's APPROVE noted one minor wording observation. All seven findings addressed. No findings rejected.

---

## Gemini (APPROVE) — minor observation addressed

### G-2.1. Security Considerations wording

**Finding**: "Item 4: SSE event carries the architect collection (names, terminal IDs)" was iter-0 text that didn't reflect iter-1's OQ-F lock to `{ workspace }` payload. Slight contradiction (non-blocking, since the iter-1 payload is more restrictive).

**Resolution**: Tightened the Item 4 Security paragraph to reflect the post-iter-1 OQ-F payload — `{ workspace: <workspacePath> }` only, with subscribers re-fetching `/state`. Less exposure than the dashboard `/state` response, so "no new exposure" remains correct (and now obviously so).

**Where in spec**: Security Considerations / Item 4.

---

## Codex (REQUEST_CHANGES) — all three findings addressed

### C-2.1. Strict-mode delivery for thread-file instruction

**Finding**: The iter-1 spec said "no protocol-prompt-file changes beyond the shared `codev/roles/builder.md` update." Codex was concerned Porch-driven phase work uses `protocols/<name>/prompts/<phase>.md` files (verified by Codex at `packages/codev/src/commands/porch/prompts.ts`, `next.ts`), so just updating `codev/roles/builder.md` would NOT propagate the thread instruction into strict-mode builders' per-phase context.

**Verification**: I read the spawn code and confirmed:

```ts
// packages/codev/src/agent-farm/commands/spawn.ts:448
const builderPrompt = `You are a Builder. Read codev/roles/builder.md for your full role definition.\n${resumeNotice}${branchNotice}\n${initialPrompt}`;
```

Same pattern at lines `:515`, `:520`, `:817` (all four spawn paths — strict, soft, task, resume).

The role file is read ONCE at session start. The read result remains in the builder's context across all subsequent porch-driven phase prompts (which are appended to the same conversation, not separate sessions). So the thread-file instruction reaches every builder regardless of mode.

**Resolution**: Added "Strict-mode delivery rationale" to the Functional MUST / Item 3 list. The rationale explicitly says: builder.md read at session start + role file persists in context + porch prompts are appended to same conversation = instruction is honored in every phase. Per-phase reinforcement intentionally NOT added — it would be a porch hook, which the issue body explicitly rejects.

**Caveat acknowledged**: If context compaction drops the role file mid-session, the builder is responsible for re-reading. This is a general builder discipline that already applies to all role-file content; #823 doesn't introduce a new failure mode here.

**Where in spec**: Functional MUST / Item 3 (new "Strict-mode delivery rationale" paragraph).

### C-2.2. In-flight thread location

**Finding**: The iter-1 spec said architects discover and read in-flight builder threads via `cat codev/state/<builder-id>_thread.md` and `ls codev/state/` from the main workspace root. **Incorrect**: in-flight threads live in each builder's worktree (`.builders/<builder-id>/codev/state/<builder-id>_thread.md`), not in `main/codev/state/`.

**Verification**: Confirmed by reading the spec's own resolution rule (`<builder-id>` = basename of builder's worktree path, which IS `.builders/<id>/`). The main workspace's `codev/state/` only gets populated when builders commit their thread files and merge their PRs.

**Resolution**: Spec now distinguishes two discovery paths:
- **In-flight**: architects use `ls .builders/*/codev/state/*.md` to discover, `cat .builders/<id>/codev/state/<id>_thread.md` to read. Sibling builders use `cat ../<sibling-id>/codev/state/<sibling-id>_thread.md` from their own worktree (`.builders/` is the shared parent).
- **Post-merge**: thread file lands in `codev/state/` on `main`, becomes part of the historical review record alongside `codev/reviews/`.

Updated in three places: Desired State item 3, Functional MUST / Item 3 instruction text, Test Scenarios 6 / 7 / 7b (new) / 8.

**Where in spec**: Desired State (item 3 rewritten), Functional MUST / Item 3 (instruction expanded with the in-flight vs post-merge distinction), Test Scenarios 6-8.

### C-2.3. `codev-skeleton/roles/builder.md` — MUST, not sanity-check

**Finding**: The iter-1 Dependencies list called `codev-skeleton/roles/builder.md` a "sanity check." But that file IS the source of truth for external adopters (copied to `packages/codev/skeleton/roles/builder.md` at build time and shipped via npm). Leaving it as a sanity-check risks fixing only this repo's self-hosted copy while external adopters (Shannon and others) miss the feature.

**Verification**: Confirmed via `packages/codev/package.json:29`:
```json
"copy-skeleton": "rm -rf skeleton && cp -r ../../codev-skeleton skeleton"
```

`packages/codev/skeleton/` is regenerated from `codev-skeleton/` on every build. The published npm artifact contains the copied tree. External adopters running `codev update` get the skeleton's contents.

**Resolution**: Promoted from sanity-check to MUST. The Functional MUST for Item 3 now requires editing **both** `codev-skeleton/roles/builder.md` (source of truth) AND `codev/roles/builder.md` (project-local copy) atomically in the same commit. Dependencies / Item 3 explains the build-time copy and the propagation story.

**Where in spec**: Functional MUST / Item 3 (the first MUST item now reads "Both ... AND ..." atomically), Dependencies / Item 3 (rewritten to describe the source-of-truth vs build-artifact relationship).

---

## Claude (APPROVE) — three COMMENT-level dependency improvements addressed

### Cl-2.1. Skeleton path precision

**Finding**: Dependencies / Item 3 should clarify that the source-of-truth is `codev-skeleton/roles/builder.md` and that `packages/codev/skeleton/roles/builder.md` is a build artifact.

**Resolution**: Dependencies / Item 3 rewritten to describe the relationship explicitly. The MUST list also names both edit points (source + project-local copy).

**Where in spec**: Dependencies / Item 3.

### Cl-2.2. `packages/types/src/sse.ts` in Dependencies / Item 4

**Finding**: The plan phase needs to decide whether `architects-updated` is a new `SSEEventType` union entry or rides the existing `notification` channel (mirroring `worktree-config-updated`). The spec should mention `sse.ts` in Dependencies so the plan phase knows where the decision lands.

**Resolution**: Added `packages/types/src/sse.ts` to Dependencies / Item 4. Current union enumerated (`'overview-changed' | 'notification' | 'builder-spawned' | 'connected' | 'heartbeat'`). Recommendation: ride the notification channel (no new union entry), matching `worktree-config-updated`'s pattern.

**Where in spec**: Dependencies / Item 4.

### Cl-2.3. `codev/state/` directory creation on first write

**Finding**: `codev/state/` doesn't exist yet (greenfield per #823). Builder's first write to `codev/state/<id>_thread.md` needs to create the directory. The Write tool's `mkdir -p` semantics handle this, but the instruction in `builder.md` should mention it.

**Resolution**: Added directory-creation note to the Functional MUST / Item 3 instruction list. The instruction explicitly says "if `codev/state/` doesn't exist yet (which is the common case — it's greenfield per #823), the builder's first write to `codev/state/<id>_thread.md` creates the directory (the Write tool / `mkdir -p` handles this). Spell this out so the builder doesn't get a 'no such file or directory' failure on first write."

**Where in spec**: Functional MUST / Item 3 (new "Directory creation" bullet in the instruction list).

---

## Net spec change summary (iter-2)

- **1 MUST promoted to atomic edit of two files** (`codev-skeleton/roles/builder.md` + `codev/roles/builder.md`).
- **1 new MUST sub-bullet** (directory creation on first write).
- **1 new rationale paragraph** (strict-mode delivery via spawn.ts:448 read at session start).
- **3 Test Scenarios updated** (6, 7, 7b new, 8) to use correct `.builders/<id>/` paths for in-flight discovery.
- **1 Desired State item rewritten** (item 3, with in-flight vs post-merge discovery distinction).
- **1 Dependencies block rewritten** (Item 3 source-of-truth vs build-artifact relationship).
- **1 Dependency added** (`packages/types/src/sse.ts`).
- **1 Security paragraph tightened** (Item 4, post-iter-1 payload).
- **No findings rejected.** No disagreements with reviewers.

## Iter-3 readiness

Spec is ready for iter-3 CMAP. Codex's three REQUEST_CHANGES findings are fully addressed. Gemini and Claude were already APPROVE at iter-2; their minor improvements are folded in. Iter-3 should converge to APPROVE/APPROVE/APPROVE (or APPROVE/COMMENT-only); if any reviewer surfaces new findings, those will be addressed in iter-3 corrections.
