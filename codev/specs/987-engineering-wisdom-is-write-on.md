# Specification: Symmetric Hot/Cold Governance Docs — Make `arch.md` and `lessons-learned.md` Consumed at Decision Time

## Metadata
- **ID**: spec-2026-06-05-987-engineering-wisdom-write-only
- **Issue**: #987
- **Status**: draft (revised per architect instruction 2026-06-05)
- **Created**: 2026-06-04 · **Revised**: 2026-06-05
- **Protocol**: SPIR (strict)

## Clarifying Questions Asked

The issue framed this as a genuine design fork. An initial round of architect answers (2026-06-04) chose "retire `lessons-learned.md` + single design-heuristics digest." After the architect and Waleed worked through it at the spec-approval gate, that approach was **superseded** by the model specified below (2026-06-05). The superseding decisions are **baked** (treated as fixed; see Constraints).

**Why the model changed (the reframe):** the problem is **not lessons-only**. `arch.md` is **identically write-only** — `buildPhasePrompt()` injects *neither* `arch.md` *nor* `lessons-learned.md` (verified: it injects only the GitHub/spec summary, the current plan phase, retry history, and user answers). Both governance docs are merely *written* by the review phase and *pruned* by MAINTAIN; neither is ever in context at decision time. So the fix must be **symmetric across both docs**, and retiring one of them was solving half the problem with an asymmetry. **Nothing is retired** in the new model.

## Problem Statement

Codev's two durable-knowledge governance documents — `codev/resources/arch.md` (system shape) and `codev/resources/lessons-learned.md` (engineering wisdom) — are both **write-only**. Knowledge accretes into them, but nothing in the framework *consumes* either one at the moment a decision is being made, so neither can change agent behavior under load.

Every framework reference to both files is producer-side or prune-side:
- The SPIR / ASPIR / PIR **review** phase (and `porch/prompts/review.md`) **append** to both (`## Architecture Updates` → `arch.md`; `## Lessons Learned Updates` → `lessons-learned.md`).
- **MAINTAIN** + the `update-arch-docs` skill **extract into / prune** both.
- Porch **checks** only enforce that the *review file* contains those two sections — never that anyone *reads* the docs.

**Nothing reads or injects either doc at decision time, and nothing enforces that it is read.** They are append-only archives with no consumer: documentation that hopes to be grepped, which under load agents do not do. The concrete downstream failure cited in the issue — a boolean-vs-role auth design miss — is exactly the class of mistake a *written-but-unread* governance doc can never prevent, because it is not in context when the design is chosen.

The governing principle (from the issue): **knowledge only changes behavior if it lives in always-on context, an executed protocol step, or an enforced check.** A markdown archive nobody reads is none of those.

## Current State

**The docs (verified):**
- `codev/resources/lessons-learned.md` — ~400 lines / ~250 one-line entries across topical sections; a large fraction are spec-narrow implementation recipes alongside a smaller set of genuinely behavior-changing, cross-cutting lessons.
- `codev/resources/arch.md` — the system-shape governance doc, maintained by the same review/MAINTAIN machinery.

**Producers (write/prune) — verified:**
- `codev-skeleton/protocols/{spir,aspir}/prompts/review.md` (§4 "Update Architecture and Lessons Learned Documentation") and `codev-skeleton/protocols/pir/prompts/review.md`: instruct the builder to **append** to both docs and record what was added in the review's `## Architecture Updates` / `## Lessons Learned Updates` sections.
- `codev-skeleton/porch/prompts/review.md`: same pattern.
- `codev-skeleton/protocols/maintain/{protocol.md,prompts/maintain.md}`: scan `codev/reviews/`, extract, and prune both docs.
- `update-arch-docs` skill (both trees): owns the pruning discipline and the arch.md-vs-lessons-learned two-doc routing.

**Enforcement — verified:** `protocol.json` for spir/aspir/pir defines review-phase checks `review_has_arch_updates` and `review_has_lessons_updates` (grep the review file for the two section headers). These police the **producer**, never the **consumer**.

**Consumers (read at decision time) — verified: NONE for either doc.**
- `packages/codev/src/commands/porch/prompts.ts` (`buildPhasePrompt()`) injects the project summary, current plan-phase metadata, retry-history header, and user answers via `{{variable}}` substitution (`substituteVariables`). It **reads neither `arch.md` nor `lessons-learned.md`.**
- The phase prompts (`specify.md`, `plan.md`, `implement.md`, …) never read either doc.
- Role files and `CLAUDE.md` / `AGENTS.md` mention them only as MAINTAIN *targets* / directory-map entries — no "consult before deciding" instruction, and no `@import` mechanism is in use today.

**Injection feasibility (verified):** prompts are markdown with `{{variable}}` placeholders filled by `substituteVariables`; framework files resolve through Codev's **four-tier fallback** (`.codev/` override → `codev/` project copy → runtime cache → installed-package skeleton). A new always-on injection can therefore be implemented as variables filled from resolver-located files.

**Scaffold / install / update path (verified):**
- `packages/codev/src/lib/scaffold.ts` copies `templates = ['lessons-learned.md', 'arch.md', 'cheatsheet.md', 'lifecycle.md']` into a new project's `resources/`.
- `packages/codev/src/__tests__/scaffold.test.ts` / `templates.test.ts` assert that behavior.
- `packages/codev/src/lib/templates.ts` `USER_DATA_PATTERNS` protects `resources/arch.md` and `resources/lessons-learned.md` from being overwritten by `codev update`.

**Scale & shape (verified):** the docs/term are referenced across **both** the `codev/` instance tree and the `codev-skeleton/` distribution tree (mirrored protocol copies for spir/aspir/pir/maintain, the skill in two places, `CLAUDE.md`, `AGENTS.md`, `templates.ts`), plus **historical** artifacts that must NOT be edited (`codev/maintain/*`, `codev/plans/*`, `codev/projects/*`, archives, prior reviews, the release protocol's historical references). This is a multi-file change across two mirrored trees, with the well-known dual-directory footgun.

## Desired State

Each governance doc is split into a **two-tier (hot/cold)** pair, **symmetrically**:

| Tier | Files | Size | Consumed how |
|---|---|---|---|
| **HOT** | `arch-critical.md`, `lessons-critical.md` | **Hard-capped** — a handful of lines each | **Always injected into context** (every porch phase prompt + interactive sessions, CLAUDE.md-style). The behavior-changer. |
| **COLD** | `arch.md`, `lessons-learned.md` | Full, may expand | **Kept** as on-demand reference (grep/read for depth). Not retired, not deleted; spec-narrow recipes stay. |

1. **Two new HOT files** (`codev/resources/arch-critical.md`, `codev/resources/lessons-critical.md`, mirrored into the template trees) hold only the small set of cross-cutting facts/heuristics that should change a decision *right now*. They are **hard-capped** and **always-on**.

2. **Both COLD docs are kept intact** — `arch.md` and `lessons-learned.md` continue to exist as the full reference archives. Nothing is deleted; spec-narrow content remains as honest reference. The cold tier simply stops *pretending* to change behavior — the hot tier does that.

3. **The hot tier reaches both consumption surfaces:**
   - **porch-driven builders** — `buildPhasePrompt()` injects both hot files into **every** phase prompt (not design-time-only).
   - **interactive sessions** (architect / human at the repo root) — the hot content is always-on the way `CLAUDE.md` is.
   Both resolve through the **four-tier fallback chain**, so a repo that upgrades the package before checking in its own hot files still gets the skeleton copy rather than a failed/empty injection.

4. **The hard cap is load-bearing.** It is the mechanism that makes "inject into every prompt" affordable (negligible per-prompt tokens) and that prevents re-accretion. Adding a fact to a hot file requires **demoting** a weaker fact into the corresponding cold doc (displacement discipline). The cap is policed by MAINTAIN; honored by the producer at capture time.

5. **Producers route hot-vs-cold, not append-everywhere.** At review time, each new architecture fact and each new lesson is **routed**: does it belong in the hot file (behavior-changing, earns/displaces a capped slot) or the cold doc (reference)? This replaces today's "append to the archive."

6. **MAINTAIN polices the cap (per hot file) and maintains the cold docs as reference.** It no longer treats accretion in the cold tier as the primary failure mode (the cold docs are allowed to be full reference); the discipline that matters moves to the hot-tier cap + correct hot/cold routing. The arch-vs-lessons routing the skill already owns is extended with the hot/cold axis.

Net effect: the small amount of knowledge that actually changes decisions is unavoidably in front of every agent at every step, while the full reference archives remain available on demand — symmetrically for system shape and engineering wisdom.

## Stakeholders
- **Primary Users**: every agent at every porch phase (consume the hot tier); interactive architect sessions (consume the hot tier); review-phase agents (route hot-vs-cold).
- **Secondary Users**: architects (curate the hot files, set/keep the cap); MAINTAIN runs (police the cap, maintain cold docs).
- **Technical Team**: Codev framework maintainers (this repo + downstream adopters who inherit the skeleton).
- **Business Owners**: M Waleed Kadous (architect / decision authority).

## Success Criteria
- [ ] **Two HOT files exist** — `codev/resources/arch-critical.md` and `codev/resources/lessons-critical.md` — as the live instance files and as starter templates in the trees scaffold reads from (`codev-skeleton/templates/` and `codev/templates/`), each with an explicit **hard cap** (stated as entry count and/or "fits in a handful of lines") and a documented **displacement discipline**.
- [ ] **HOT files are seeded by curation** — the genuinely behavior-changing, cross-cutting subset is lifted from the cold docs into the hot files. This is curation, **not** deletion: the cold docs are unchanged in content except for any demoted/duplicated framing.
- [ ] **Both COLD docs are KEPT** — `codev/resources/arch.md` and `codev/resources/lessons-learned.md` still exist with their reference content intact (no deletion, no wholesale gutting, spec-narrow recipes retained).
- [ ] **porch injects both hot files into every phase prompt** — `buildPhasePrompt()` injects `arch-critical.md` and `lessons-critical.md` content into the assembled prompt for **all** phases (specify, plan, implement, defend, evaluate, review). Verifiable: assemble a phase prompt for ≥2 distinct phases and confirm both hot files' text appears **verbatim and unconditionally** (not a "go read this file" pointer).
- [ ] **Interactive sessions get the hot tier always-on** — the hot content is present in auto-loaded context for an interactive session at the repo root, from a **single source of truth** (no hand-maintained duplicate that can drift) and in a **tool-agnostic** way (works for `CLAUDE.md` and `AGENTS.md` consumers). `CLAUDE.md` and `AGENTS.md` remain byte-identical to each other.
- [ ] **Injection resolves via the four-tier fallback chain** — both surfaces resolve the hot files through `.codev/` → `codev/` → cache → skeleton, so an upgraded-but-not-yet-seeded repo still injects the skeleton copy rather than failing/empty.
- [ ] **Scaffold copies the new files** — `scaffold.ts`'s copy list **adds** `arch-critical.md` and `lessons-critical.md` (while keeping `arch.md` and `lessons-learned.md`); `scaffold.test.ts` / `templates.test.ts` are updated to assert the new files are copied (and continue to assert the cold docs are copied).
- [ ] **`codev update` coherence** — `USER_DATA_PATTERNS` protects the two new hot files (in addition to the two cold docs); the update path is coherent for existing adopters (no crash; new files created from the skeleton; cold docs preserved).
- [ ] **Producers route hot-vs-cold** — the spir/aspir/pir + `porch/prompts/review.md` review prompts are changed from "append to `arch.md` / `lessons-learned.md`" to "**route** each new fact to the hot file (cap+displacement) or the cold doc," for **both** docs. The review sections reflect routing.
- [ ] **Porch review checks remain valid** — the existing `review_has_arch_updates` / `review_has_lessons_updates` checks still pass on a correctly-routed review (renamed if the review section names change). **No new consumption check is added** (consumption is via always-on injection, per the principle and the prior "executed step, no hard consumption check" decision).
- [ ] **MAINTAIN polices the cap** — the MAINTAIN protocol + `maintain.md` prompt + `update-arch-docs` skill (both trees) gain hot-tier cap-policing + displacement, and the skill's cold-tier philosophy is updated so the cold docs may retain spec-narrow reference content (the anti-accretion discipline moves to the hot cap). Arch-vs-lessons routing is extended with the hot/cold axis.
- [ ] **Explicit live-surface sweep (both trees)** — every live surface is updated, not left to grep alone: spir/aspir/pir/maintain `protocol.md`, the `protocols/*/templates/review.md` review templates, MAINTAIN templates, the PIR builder-prompt + implement prompt, `porch/prompts/review.md`, the `update-arch-docs` skill (frontmatter + body), `CLAUDE.md`/`AGENTS.md` (directory map + the new always-on model), role files, and `templates.ts` — each audited in **both** `codev/` and `codev-skeleton/`.
- [ ] All existing tests pass; tests referencing the old copy list / section names are updated.

## Constraints

### Architect's binding decisions (2026-06-05 — baked, treat as fixed)
- **Symmetric two-tier (hot/cold) across BOTH `arch.md` and `lessons-learned.md`.** Not a lessons-only change.
- **Nothing is retired / deleted.** The cold docs are kept and may expand; spec-narrow recipes stay as reference.
- **Hot files (`arch-critical.md`, `lessons-critical.md`) are HARD-CAPPED** (a handful of lines each). The cap is load-bearing and non-negotiable; growth happens by **demotion to cold**, not by raising the cap.
- **Injection scope = ALWAYS-ON** (every prompt, CLAUDE.md-style), not design-time-only.
- **Hot tier must reach BOTH surfaces** — porch builders (`buildPhasePrompt()`) **and** interactive sessions (CLAUDE.md-style) — via the four-tier fallback chain.
- **Producer = route hot-vs-cold at capture; MAINTAIN polices the cap.**

### Technical constraints
- Dual mirrored trees (`codev/` + `codev-skeleton/`) kept consistent; every edit audited in both.
- Historical artifacts are read-only history — do not rewrite them.
- Single source of truth for the hot content across the two consumption surfaces — no hand-maintained duplicate that can drift.
- Interactive-surface mechanism must be tool-agnostic (CLAUDE.md + AGENTS.md), not Claude-only, unless the architect accepts a Claude-only mechanism at the gate.
- Downstream adopters inherit the skeleton; it must ship a coherent hot/cold model with seeded hot-file templates and routing-based review prompts.

### Process constraints
- No time estimates (per protocol).
- Run the dual-directory audit + exhaustive `rg` before claiming "all surfaces updated."

## Assumptions
- The hot files' value comes from being *tiny and always-present*; the cap is the structural guarantee against re-accretion and the reason always-on injection is affordable.
- The behavior-changing subset distilled into each hot file is small (order a handful of entries); the bulk of each cold doc stays put as reference.
- Injecting into **every** phase (not just design) is correct per decision A; the marginal token cost is negligible given the cap.
- A single-source-of-truth file per hot tier can feed both the programmatic (porch) and interactive (CLAUDE/AGENTS) surfaces without a hand-maintained duplicate.

## Solution Approaches

### The two consumption surfaces (the meaty part)
The hot files must be always-on for two structurally different consumers. Source of truth = the two hot files (resolved via the four-tier chain).

**Surface 1 — porch-driven builders.** Inject via `buildPhasePrompt()`: resolve `arch-critical.md` + `lessons-critical.md` through the four-tier resolver and substitute them into every phase prompt (e.g. new `{{arch_critical}}` / `{{lessons_critical}}` variables, or a prepended always-on context block). Low-risk, mirrors the existing `{{variable}}` mechanism. **Recommended.**

**Surface 2 — interactive sessions.** Candidate mechanisms:
- **(a) Generated managed block in `CLAUDE.md` + `AGENTS.md`** mirrored from the hot files by a small sync/generation step (delimited markers prevent drift; mirrors the existing CLAUDE↔AGENTS sync discipline). *Pro:* tool-agnostic, truly always-on, single source of truth. *Con:* adds a generation/sync step + drift-guard. **Recommended.**
- **(b) `@import` of the hot files from `CLAUDE.md`.** *Pro:* no sync. *Con:* Claude-Code-specific (AGENTS.md consumers don't honor it), and import-path resolution doesn't follow the four-tier chain. Acceptable only if the architect accepts Claude-only for interactive.
- **(c) A "always read these" pointer.** *Rejected* — this is the exact write-only failure mode being fixed.

The spec **requires** that Surface 2 be always-on, single-source-of-truth, and (default) tool-agnostic; the final mechanism (a vs b) is a plan-level decision confirmed at the plan-approval gate.

### Approaches considered and rejected
- **Retire `lessons-learned.md` + single design-heuristics digest** (the prior 2026-06-04 model). Rejected by the architect because it is asymmetric — it ignores that `arch.md` is identically write-only — and because deleting reference content loses the on-demand archive. Replaced by hot/cold, which keeps the archives and fixes both docs.
- **Inject the whole cold docs at design time.** Rejected — re-creates unbounded context cost and drowns the few behavior-changing facts; the cap-bounded hot tier is the disciplined alternative.
- **Relevance-retrieval / tagging engine.** Rejected — the hard cap makes "always inject in full" viable, so no retrieval machinery is needed.

## Open Questions

### Critical (Blocks Progress)
- None — the model and its baked decisions are fixed by the architect instruction.

### Important (Affects Design)
- [ ] **Exact cap per hot file.** Proposed: each hot file ≤ ~10 single-line entries / "fits in a handful of lines at a glance." Final number set in the plan / confirmed at the plan gate.
- [ ] **Interactive-surface mechanism** — generated managed block (tool-agnostic, recommended) vs `@import` (Claude-only). Resolve in plan.
- [ ] **porch injection form** — `{{arch_critical}}`/`{{lessons_critical}}` template variables vs a prepended always-on block in `buildPhasePrompt()`. Lean: template variables. Resolve in plan.
- [ ] **Review-section naming** — keep `## Architecture Updates` / `## Lessons Learned Updates` (with routing instructions inside) vs rename to signal hot/cold routing. Keeping preserves the existing porch checks with minimal churn. Lean: keep names, change the instructions. Resolve in plan.

### Nice-to-Know (Optimization)
- [ ] Whether the hot files should carry a one-line "how to curate / demote" header for architects.
- [ ] Whether a lightweight cap-check (line count) belongs in MAINTAIN tooling vs. left to human judgment at MAINTAIN time.

## Test Scenarios

This is a methodology/mechanism change; "tests" are structural assertions plus prompt-assembly verification.

### Functional Tests
1. **Always-on injection (porch)**: assemble phase prompts for ≥2 phases (e.g. specify and implement) and assert both `arch-critical.md` and `lessons-critical.md` text appears verbatim in each.
2. **Single source of truth**: editing a hot file changes both the assembled porch prompt and the interactive always-on context (no second copy to hand-sync).
3. **Four-tier resolution**: with no `codev/resources/arch-critical.md` present, injection falls back to the skeleton copy (no empty/failed injection).
4. **Cold docs preserved**: `arch.md` and `lessons-learned.md` still exist with reference content after the change.
5. **Producer routes**: review prompts instruct hot-vs-cold routing for both docs; no "append everything to the archive" instruction remains.
6. **Checks valid**: porch review checks pass on a correctly-routed review.
7. **Scaffold**: a freshly scaffolded project contains all four files (`arch.md`, `arch-critical.md`, `lessons-learned.md`, `lessons-critical.md`).

### Non-Functional Tests
1. **Cap respected**: each seeded hot file fits the stated cap.
2. **Cross-tree consistency**: every changed file present in both trees is changed in both; the two new hot files exist in both template trees.
3. **Suite green**: existing unit/e2e tests pass; tests referencing the old copy list / sections updated.

## Dependencies
- **Internal**: `buildPhasePrompt()` + `substituteVariables` (`packages/codev/src/commands/porch/prompts.ts`); the framework-file four-tier resolver; the CLAUDE↔AGENTS sync path (if a generated managed block is used); the spir/aspir/pir/maintain protocol definitions + prompts + templates (both trees); `porch/prompts/review.md`; the `update-arch-docs` skill (both trees); `scaffold.ts` + `scaffold.test.ts` + `templates.test.ts`; `templates.ts` (`USER_DATA_PATTERNS`); `CLAUDE.md`/`AGENTS.md`; role files.
- **External**: none.
- **Libraries/Frameworks**: none new.

## Risks and Mitigation
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|-------------|
| Hot files silently grow past the cap (re-accretion) | Med | High | Explicit hard cap + demote-on-add discipline + MAINTAIN cap-policing; producer prompt forbids "append, trim later." |
| "Inject" implemented as a weak pointer (the very failure being fixed) | Med | High | Success criterion requires verbatim, unconditional text in the assembled prompt and always-on interactive context — not a file reference. |
| Interactive surface drifts from the source of truth | Med | Med | Single-source-of-truth requirement; generated managed block with drift-guard markers; CLAUDE≡AGENTS check. |
| Tool-specific interactive mechanism leaves AGENTS.md consumers without the hot tier | Med | Med | Default to tool-agnostic generated block; `@import` only if architect accepts Claude-only at the gate. |
| Missed surfaces in the dual tree (footgun) | High | Med | Explicit live-surface sweep list + exhaustive `rg` in both trees; CMAP reviewers historically catch this. |
| Always-on injection bloats every prompt | Low | Med | The hard cap keeps per-prompt cost negligible by construction; that is the cap's primary justification. |
| Editing historical artifacts to "tidy" them | Low | Med | Explicit out-of-scope list; leave history intact. |
| Cold-tier philosophy change misread as "stop maintaining arch.md/lessons-learned" | Low | Med | Spec is explicit: cold docs are kept and maintained as reference; only the *anti-accretion* emphasis moves to the hot cap. |

## Expert Consultation
**Date (iter 1, prior model)**: 2026-06-04 — Gemini APPROVE, Claude APPROVE, Codex REQUEST_CHANGES (four completeness gaps, all incorporated). That round reviewed the now-superseded retire-and-route model; its surviving, still-applicable findings (four-tier resolver, scaffold + tests, explicit live-surface sweep, route-not-append, MAINTAIN cap-policing, `codev update` coherence) are carried into this revision and re-scoped to the hot/cold split.

**Date (iter 2, this model)**: TBD — to be re-consulted (Gemini, Codex, Claude) after this revision.

## Approval
- [ ] Architect Review (human gate: spec-approval)
- [ ] Expert AI Consultation Complete (iter 2, on the hot/cold model)

## Notes
Spec altitude is intentionally WHAT/WHY. The two consumption surfaces and the cap value are described, but the final injection mechanism (template variable vs block; generated managed block vs `@import`), the exact cap number, and the precise seed contents of each hot file are deferred to the plan. The **one-time curation** that seeds the hot files (lifting the behavior-changing subset out of the cold docs) is meaningful work and should be its own plan phase, kept separate from the mechanical injection + scaffold + sweep changes.

---

## Amendments

<!-- TICK amendments, if any, recorded here in chronological order. -->
