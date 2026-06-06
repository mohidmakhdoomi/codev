# Plan: Symmetric Hot/Cold Governance Docs — `arch.md` & `lessons-learned.md` Consumed at Decision Time

## Metadata
- **ID**: plan-2026-06-06-987-engineering-wisdom-write-only
- **Status**: draft
- **Specification**: `codev/specs/987-engineering-wisdom-is-write-on.md`
- **Created**: 2026-06-06

## Executive Summary

Implements the approved symmetric **hot/cold** model. Each governance doc gains a tiny, hard-capped, **always-on** companion:
- **HOT** — `arch-critical.md`, `lessons-critical.md`: capped facts **+** a bounded cold-doc map. Always injected into (1) every porch phase prompt via the runtime resolver, and (2) interactive sessions via a generated managed block in `CLAUDE.md`/`AGENTS.md`.
- **COLD** — `arch.md`, `lessons-learned.md`: kept intact as on-demand reference, made discoverable by the hot file's map.

Producers **route hot-vs-cold** at review time (instead of appending to an archive); MAINTAIN polices the **cap and the map's accuracy**. Nothing is retired.

### Pinned decisions (resolving the spec's open questions)
- **Per-hot-file cap (PINNED — confirm at plan gate):** each hot file ≤ **35 lines total** (incl. headers), comprising **≤ 10 single-line fact bullets** + a cold-doc map of **≤ 12 top-level topics** (one line each, `topic — consult when…`). Both hot files injected together ≈ ≤ 70 lines (well under ~1k tokens/prompt — negligible, which is what makes always-on viable).
- **porch injection form (PINNED):** `buildPhasePrompt()` **prepends an always-on context block** built from the resolver-located hot files — chosen over per-template `{{variable}}`s because it guarantees *unconditional* presence in **every** phase without depending on each prompt template remembering to include a variable. (Resolves via `resolveCodevFile()`; runtime fallback.)
- **Interactive mechanism (PINNED per spec):** generated managed block with begin/end markers; replace-in-place; `@import` rejected.
- **Skeleton placement (PINNED — from code audit):** hot files live in **both** `codev-skeleton/templates/` (scaffold source) **and** `codev-skeleton/resources/` (runtime tier-4 fallback location read by `resolveCodevFile('resources/…')`). These are distinct and both required.
- **Review section names (PINNED):** keep `## Architecture Updates` / `## Lessons Learned Updates` (so existing porch checks stay valid); change the *instructions* inside to route hot-vs-cold.

## Success Metrics
- [ ] All spec success criteria met
- [ ] `buildPhasePrompt()` injects both hot files verbatim into every phase prompt; runtime fallback works
- [ ] Managed block present + identical in `CLAUDE.md`/`AGENTS.md`; non-clobbering on regeneration
- [ ] All four files (`arch.md`, `arch-critical.md`, `lessons-learned.md`, `lessons-critical.md`) scaffolded into new projects and created on `codev update`
- [ ] Existing unit/e2e tests pass; updated where they assert the old template list / sections

## Phases (Machine Readable)

<!-- REQUIRED: porch uses this JSON to track phase progress. -->

```json
{
  "phases": [
    {"id": "phase_1", "title": "Hot files: curation, cap, placement"},
    {"id": "phase_2", "title": "Porch runtime injection (always-on, every phase)"},
    {"id": "phase_3", "title": "Interactive managed block in CLAUDE.md/AGENTS.md"},
    {"id": "phase_4", "title": "Install/update wiring (scaffold, templates.ts, tests)"},
    {"id": "phase_5", "title": "Producer routing (review prompts, both trees)"},
    {"id": "phase_6", "title": "MAINTAIN + skill policing, docs sweep, consistency"}
  ]
}
```

## Phase Breakdown

### Phase 1: Hot files — curation, cap, placement
**Dependencies**: None

#### Objectives
- Create the two always-on hot files, seeded by curation from the cold docs, within the pinned cap, and placed at every location the two surfaces resolve.

#### Implementation Details
- Author `arch-critical.md` and `lessons-critical.md`, each with two capped parts:
  - **Facts** (≤ 10 bullets): the behavior-changing, cross-cutting subset lifted from `arch.md` / `lessons-learned.md` (e.g. for lessons: "trust the protocol / never skip CMAP", "check existing work before building", "model permissions as roles not booleans", "verify end-to-end in a browser, not just compile", "single source of truth beats distributed state"). Curated, not exhaustive.
  - **Cold-doc map** (≤ 12 top-level topics): one line per top-level section of the corresponding cold doc, each `topic — consult when…`. For `lessons-critical.md`, map `lessons-learned.md`'s sections (Critical, Security, Architecture, Process, Testing, UI/UX, Documentation, 3-Way Reviews, Protocol Orchestration, Debugging). For `arch-critical.md`, map `arch.md`'s top-level sections.
  - A short header stating the cap + "generated/curated; edits are demote-on-add; see MAINTAIN."
- Place each hot file at: `codev/resources/` (instance live = tier 2), `codev-skeleton/templates/` (scaffold source), `codev-skeleton/resources/` (runtime tier-4 fallback), and `codev/templates/` (instance template mirror).
- **Cold docs untouched** in this phase.

#### Files
- `codev/resources/arch-critical.md`, `codev/resources/lessons-critical.md` (new)
- `codev-skeleton/templates/{arch-critical,lessons-critical}.md` (new)
- `codev-skeleton/resources/{arch-critical,lessons-critical}.md` (new)
- `codev/templates/{arch-critical,lessons-critical}.md` (new)

#### Acceptance Criteria
- [ ] Both hot files exist at all four locations (six paths incl. instance + skeleton)
- [ ] Each file is within the pinned cap (≤ 35 lines; ≤ 10 facts; ≤ 12 map topics)
- [ ] Map lists only top-level cold-doc topics (not a full enumeration), each with a "consult when…"
- [ ] `arch.md` and `lessons-learned.md` unchanged

#### Test Plan
- **Unit/structural**: a test asserts both hot files exist at the instance + skeleton resource/template paths, are non-empty, and are within the line cap; a test asserts the map section contains only top-level topics (heuristic: line count ≤ cap, each map line matches `… — consult when …`).

#### Rollback Strategy
- Delete the new files; no other surface depends on them yet.

#### Risks
- **Risk**: curation picks too much / exceeds cap. **Mitigation**: cap-check test fails loudly; displacement discipline documented in header.

---

### Phase 2: Porch runtime injection (always-on, every phase)
**Dependencies**: Phase 1

#### Objectives
- Make every porch phase prompt carry both hot files, resolved at runtime, with skeleton fallback.

#### Implementation Details
- In `packages/codev/src/commands/porch/prompts.ts`, `buildPhasePrompt()`: resolve `resources/arch-critical.md` and `resources/lessons-critical.md` via `resolveCodevFile()`; **prepend an always-on context block** (clear heading, e.g. `# Always-On Engineering Context (hot tier)`) containing both files verbatim, ahead of the phase-specific prompt body. Applies to all phases (specify, plan, implement, defend, evaluate, review).
- If a hot file resolves to null (should not happen given skeleton copy), inject nothing for that file and continue (no crash) — but the skeleton tier-4 copy from Phase 1 guarantees presence.

#### Files
- `packages/codev/src/commands/porch/prompts.ts`
- `packages/codev/src/commands/porch/__tests__/…` (prompt-assembly test; match existing test location/convention)

#### Acceptance Criteria
- [ ] Assembling a prompt for ≥2 distinct phases includes both hot files' text verbatim
- [ ] With the instance `codev/resources/arch-critical.md` absent, assembly falls back to the skeleton copy (no empty/failed injection)
- [ ] No phase prompt requires a `{{variable}}` edit to receive the block (it is prepended unconditionally)

#### Test Plan
- **Unit**: call `buildPhasePrompt()` for two phases; assert both hot files' content substrings appear. **Fallback**: point `resolveCodevFile` at a workspace lacking the instance file; assert skeleton content injected.

#### Rollback Strategy
- Revert the `prompts.ts` change; prompts return to prior behavior.

#### Risks
- **Risk**: block bloats prompts. **Mitigation**: the Phase-1 cap bounds it; assert combined size in test.

---

### Phase 3: Interactive managed block in `CLAUDE.md` / `AGENTS.md`
**Dependencies**: Phase 1

#### Objectives
- Surface the hot tier always-on for interactive sessions via a generated, non-clobbering managed block; dogfood it in this repo's root docs.

#### Implementation Details
- Add a managed-block generator (new helper in `packages/codev/src/lib/`, e.g. alongside `scaffold.ts`): reads both hot files via `resolveCodevFile()` (four-tier at generation time), renders a block delimited by explicit markers (`<!-- BEGIN CODEV HOT CONTEXT (generated — do not edit) -->` … `<!-- END CODEV HOT CONTEXT -->`), and writes it into `CLAUDE.md` and `AGENTS.md`:
  - If markers exist: **replace only between them**, preserving all surrounding user content.
  - If markers absent (existing adopter): **insert at a defined anchor** (e.g. immediately after the first H1) — never route the whole file to `.codev-new`.
- Wire generation into `codev init` (via `copyRootFiles`/scaffold path) and `codev update`.
- Update **this repo's** `CLAUDE.md` and `AGENTS.md` to contain the block (kept identical).

#### Files
- `packages/codev/src/lib/scaffold.ts` (or a new `managed-block.ts` helper invoked by it) + `codev update` command path
- `CLAUDE.md`, `AGENTS.md` (this repo, dogfood)
- tests under `packages/codev/src/__tests__/`

#### Acceptance Criteria
- [ ] After generation, both root docs contain the markers + hot content, identical between them
- [ ] Editing a hot file + regenerating updates the block only; content outside markers preserved
- [ ] A root doc with no markers gets the block inserted (not `.codev-new`)
- [ ] Block is a generated mirror (no hand-edit needed); single source = hot files

#### Test Plan
- **Unit**: generate into a fixture `CLAUDE.md` with user content above/below; assert markers+content present and user content intact; mutate a hot file, regenerate, assert block updated and user content unchanged; assert insert-when-absent path.

#### Rollback Strategy
- Remove the generator call; strip the block from root docs (markers make it mechanical).

#### Risks
- **Risk**: clobbering user edits. **Mitigation**: replace-only-between-markers + non-clobber test (spec's high-impact risk).

---

### Phase 4: Install/update wiring (scaffold, templates.ts, tests)
**Dependencies**: Phase 1, Phase 3

#### Objectives
- New projects and upgrading projects reliably receive and retain the hot files.

#### Implementation Details
- `packages/codev/src/lib/scaffold.ts`: add `arch-critical.md` and `lessons-critical.md` to the resource template copy list (keep `arch.md`, `lessons-learned.md`).
- `packages/codev/src/lib/templates.ts`: add `resources/arch-critical.md` and `resources/lessons-critical.md` to `USER_DATA_PATTERNS` (protected once present) and ensure `UPDATABLE_PREFIXES`/copy logic **creates** them for existing adopters on `codev update`.
- Update `scaffold.test.ts` / `templates.test.ts` to assert the new files are copied/created and the cold docs still are.

#### Files
- `packages/codev/src/lib/scaffold.ts`, `packages/codev/src/lib/templates.ts`
- `packages/codev/src/__tests__/scaffold.test.ts`, `packages/codev/src/__tests__/templates.test.ts`

#### Acceptance Criteria
- [ ] Fresh scaffold yields all four files in `codev/resources/`
- [ ] `codev update` on a repo lacking the hot files creates them; cold docs preserved; existing hot files not clobbered (USER_DATA)
- [ ] Tests updated and green

#### Test Plan
- **Unit**: extend existing scaffold/templates tests for the new copy list + user-data protection; add an update-path test that creates missing hot files without touching cold docs.

#### Rollback Strategy
- Revert the list/pattern changes and test updates.

#### Risks
- **Risk**: USER_DATA vs UPDATABLE interaction leaves hot files un-created or clobbered. **Mitigation**: explicit create-then-protect test.

---

### Phase 5: Producer routing (review prompts, both trees)
**Dependencies**: Phase 1

#### Objectives
- At review time, new facts/lessons are **routed hot-vs-cold** rather than appended to the archive — for both docs.

#### Implementation Details
- Update the review prompts' "Update Architecture and Lessons Learned Documentation" step in **both trees**:
  - `codev-skeleton/protocols/{spir,aspir,pir}/prompts/review.md` and `codev/protocols/{spir,aspir,pir}/prompts/review.md`
  - `codev-skeleton/porch/prompts/review.md` and `codev/protocols/maintain/prompts/review.md` (audit which review prompts exist in each tree; update all live ones)
- New instructions: for each new architecture fact and each new lesson, decide **hot** (behavior-changing → add to `*-critical.md`, respecting the cap via displacement) vs **cold** (reference → `arch.md`/`lessons-learned.md`). Keep the `## Architecture Updates` / `## Lessons Learned Updates` section names; the section now records the routing decision.
- Confirm porch `review_has_arch_updates` / `review_has_lessons_updates` checks still pass (section names unchanged).

#### Files
- Review prompt files across both trees (spir/aspir/pir + porch/maintain as present)

#### Acceptance Criteria
- [ ] Each updated review prompt instructs hot-vs-cold routing for both docs; no "append everything to the archive" wording remains
- [ ] Section headers unchanged → porch review checks still pass
- [ ] Both trees updated (no skeleton/instance drift)

#### Test Plan
- **Structural**: grep that each review prompt contains routing language ("hot", "critical", "cold", "consult when"/cap) and the retained section headers; a dry review file with the headers passes the porch check commands.

#### Rollback Strategy
- Revert the prompt edits.

#### Risks
- **Risk**: missing a review prompt copy in one tree. **Mitigation**: dual-tree audit list; rg verification.

---

### Phase 6: MAINTAIN + skill policing, docs sweep, consistency
**Dependencies**: Phase 1, Phase 5

#### Objectives
- MAINTAIN polices the hot cap + map accuracy and keeps cold docs as reference; all remaining live surfaces describe the hot/cold model; both trees consistent.

#### Implementation Details
- `update-arch-docs` skill (both trees): add hot-tier responsibilities — enforce the cap + displacement; keep each hot file's **cold-doc map bounded and accurate** (sync top-level topics as cold sections change); soften the cold-tier rule so cold docs may retain spec-narrow reference content. Update the skill frontmatter `description`.
- MAINTAIN protocol + `maintain.md` prompt (both trees): reflect cap/map policing + cold-as-reference.
- `CLAUDE.md` / `AGENTS.md`: add the two hot files to the directory map; add a short "always-on hot/cold governance" description (distinct region from the Phase-3 managed block); keep the two files identical.
- `protocol.md` for spir/aspir/pir/maintain (both trees): update any prose that described the docs as write-targets to reflect hot/cold + routing.
- Final **dual-tree audit + rg sweep**: every live surface referencing the governance docs reflects the new model; the four files cohere; historical artifacts untouched.

#### Files
- `**/.claude/skills/update-arch-docs/SKILL.md` (both trees)
- MAINTAIN `protocol.md` + `prompts/maintain.md` (both trees)
- `CLAUDE.md`, `AGENTS.md`
- `protocol.md` for affected protocols (both trees)

#### Acceptance Criteria
- [ ] Skill + MAINTAIN describe cap-policing + map bounded-and-accurate + cold-as-reference
- [ ] `CLAUDE.md` ≡ `AGENTS.md`; directory map lists hot files; model described
- [ ] rg sweep: no live surface still describes the docs as append-only write targets; historical artifacts unchanged
- [ ] All four governance files present and coherent; full test suite green

#### Test Plan
- **Structural**: grep skill/MAINTAIN for cap+map language; CLAUDE≡AGENTS diff check; rg sweep assertions. **Suite**: run unit + relevant e2e.

#### Rollback Strategy
- Revert per-file; the mechanism (Phases 2–4) stands independently of the doc prose.

#### Risks
- **Risk**: dual-tree drift / missed surface. **Mitigation**: explicit audit list + rg sweep (spec's footgun risk).

## Dependency Map
```
Phase 1 ──┬──→ Phase 2 (porch injection)
          ├──→ Phase 3 (managed block) ──→ Phase 4 (install/update wiring)
          └──→ Phase 5 (producer routing) ──→ Phase 6 (maintain/skill + sweep)
```

## Risk Analysis
### Technical Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| Managed-block regeneration clobbers user edits | Med | High | Replace-only-between-markers; non-clobber test; insert-at-anchor when absent |
| "Inject" degrades to a weak pointer | Low | High | Prepend verbatim block in `buildPhasePrompt`; assert verbatim text in test |
| Hot files grow past cap (re-accretion) | Med | High | Pinned cap + displacement + cap-check test + MAINTAIN policing |
| Missed surface across dual trees | High | Med | Explicit audit list + rg sweep in Phase 6 |
| Tier-4 fallback can't find hot files | Med | Med | Place hot files in `codev-skeleton/resources/` (verified tier-4 path), not only `templates/` |

## Validation Checkpoints
1. **After Phase 2**: porch prompts demonstrably carry the hot tier (runtime + fallback).
2. **After Phase 4**: fresh scaffold + update both yield/retain all four files.
3. **Before Review**: rg sweep clean; CLAUDE≡AGENTS; full suite green.

## Documentation Updates Required
- [ ] `CLAUDE.md` / `AGENTS.md` (directory map + model + managed block)
- [ ] MAINTAIN protocol + `update-arch-docs` skill
- [ ] Review prompts (routing)
- [ ] Affected `protocol.md` files

## Expert Review
**Date**: [to be run by porch after this draft]
**Models**: Gemini, Codex, Claude
**Key Feedback**: TBD
**Plan Adjustments**: TBD

## Approval
- [ ] Technical Lead Review (human gate: plan-approval)
- [ ] Expert AI Consultation Complete

## Notes
Phases 2, 3, and 5 each depend only on Phase 1 and can proceed in parallel in principle; the dependency map serializes 3→4 (update wiring composes with managed-block generation) and 5→6 (MAINTAIN polices what producers create, and the sweep is last). Phase 1's curation is deliberately separated from the mechanism phases per the spec's note. The pinned cap and injection form resolve the spec's Important open questions; the architect confirms the cap at the plan-approval gate.

---

## Amendment History

<!-- TICK amendments, if any, recorded here in chronological order. -->
