---
approved: 2026-06-02
validated: [gemini, codex, claude]
---

# Plan: Migrate the Gemini consult lane to the Antigravity CLI (`agy`)

## Metadata
- **ID**: plan-2026-06-02-778-gemini-antigravity-cli
- **Status**: approved (human-approved at the plan-approval gate 2026-06-02)
- **Specification**: `codev/specs/778-gemini-cli-antigravity-cli-jun.md` (APPROVED 2026-06-02, Approach B, single-agy)
- **Created**: 2026-06-02

## Executive Summary
The `gemini` consult lane currently shells out to the retiring Google **Gemini CLI** (`gemini
--output-format json --model gemini-3.1-pro-preview`, role via `GEMINI_SYSTEM_MD`, prompt via stdin).
Per the approved spec, we **swap the backend to the Antigravity CLI (`agy`)** — a lean
**single-backend** change (no API key, no second backend, no selector; agy is **OAuth-only** as
verified). The model identifier stays `gemini` everywhere (only the backend changes).

The lane invokes **`agy --print --sandbox --add-dir <repoRoot>`** with the reviewer role folded into
the prompt, **preserving agentic file-reading** (the diff/repo are read from disk), using `agy`'s
**default model** (currently Flash — no pro-pinning). Because `agy --print` returns plain text (no
usage JSON) and authenticates via interactive OAuth, the plan also covers: **graceful cost
degradation**, a **non-blocking `COMMENT` skip** when `agy` is missing/unauthed (so porch runs still
advance — the CI/headless story), verified **binary resolution** (never launch the IDE symlink), and
**doctor/docs** updates.

## Success Metrics
- [ ] All spec success criteria met (single-agy; see spec).
- [ ] `consult -m gemini` runs via `agy --print` and returns a review that used file contents
      (agentic reading), verified end-to-end on a spec, a plan, and a PR.
- [ ] Missing/unauthed/IDE-stub `agy` → non-blocking `COMMENT` skip; porch run still advances (2-way).
- [ ] Cost/usage rows degrade gracefully (no `NaN`).
- [ ] `codev doctor` reports the real `agy` CLI + auth accurately, with current guidance.
- [ ] Model identifier stays `gemini` (no rename); `pro` alias kept; Codex/Claude lanes unchanged.
- [ ] Existing consult/doctor/config/porch tests pass; coverage not reduced.

## Phases (Machine Readable)

<!-- REQUIRED: porch uses this JSON to track phase progress. -->

```json
{
  "phases": [
    {"id": "agy_backend", "title": "Phase 1: agy backend dispatch (OAuth, agentic file-reading, non-blocking skip)"},
    {"id": "docs_skeleton_e2e", "title": "Phase 2: Doctor + docs + skeleton consistency + e2e verification"}
  ]
}
```

## Cross-Cutting Implementation Contracts
- **Single backend.** The dispatch stays keyed on `model === 'gemini'` (`consult/index.ts:~631`); no
  backend sub-branching, no selector, no new config key. The `gemini`-CLI dispatch is **replaced** by
  the `agy` invocation.
- **Backend-aware parsing for plain text.** `extractReviewText`'s `gemini` branch
  (`usage-extractor.ts`, currently `JSON.parse(output).response`) is adapted to return the **raw
  output** (agy prints plain text); `extractGeminiUsage` returns **null** (no token JSON) → **graceful
  cost degradation** (no `NaN`; e.g. "n/a (subscription)"). The old `stats.models` JSON path is removed.
- **Model identifier stays `gemini`** everywhere (`MODEL_CONFIGS` key, `VALID_MODELS`,
  `protocol-schema.json` enum, default model lists, user config); `pro` alias kept. **No rename.**
- **No API key anywhere** (agy is OAuth-only; verified). CI/headless story = the non-blocking skip
  (optionally a pre-provisioned OAuth token), not an API key.

> **Test locations (canonical):** unit tests in `packages/codev/src/__tests__/` (`consult.test.ts`,
> `doctor.test.ts`, `config.test.ts`); e2e in `packages/codev/src/__tests__/cli/`; `metrics.test.ts`
> in `packages/codev/src/commands/consult/__tests__/`; `consultation-models.test.ts` in
> `packages/codev/src/commands/porch/__tests__/`. **`packages/codev/tests/e2e|unit` do NOT exist.**

## Phase Breakdown

### Phase 1: agy backend dispatch (OAuth, agentic file-reading, non-blocking skip)
**Dependencies**: None

#### Objectives
- Replace the retiring `gemini`-CLI dispatch in the consult `gemini` lane with an **`agy`** backend
  that preserves agentic file-reading and never blocks the run when unavailable.

#### Implementation Details
- **Files**: `packages/codev/src/commands/consult/index.ts` (dispatch + prompt assembly),
  `packages/codev/src/commands/consult/usage-extractor.ts` (`extractReviewText`/usage),
  `packages/codev/src/commands/doctor.ts` (agy check).
- **Binary resolution (verified, not PATH-trusting):** resolve the real CLI — prefer
  `~/.local/bin/agy`; else a PATH lookup **verified** to be the headless CLI (responds to
  `--version`/`--print` as the CLI, not the IDE Electron launcher). If none is valid (missing, or only
  the IDE symlink `~/.antigravity/.../agy`), treat the backend as **unavailable → skip** (below) —
  never launch the IDE.
- **Invocation:** `agy --print --sandbox --add-dir <workspaceRoot> [--print-timeout <N>]` with the
  reviewer **role folded into the prompt** (`${role}\n\n---\n\n${query}`, the `hermes` precedent at
  `index.ts:651-668`). **Keep** the existing "read the diff / explore the filesystem" prompt builders
  (agentic reading preserved); large content stays file-referenced (diff temp file + the >100k-char
  temp-file pattern) to avoid `E2BIG`.
- **Output:** `--print` returns **plain text** = the review → adapt `extractReviewText`'s `gemini`
  branch to return raw output; `extractGeminiUsage` returns null → **cost rows degrade gracefully**
  (see Cross-Cutting Contracts).
- **Timeout ownership:** Codev manages its own timeout and SIGTERMs the child if `agy` hangs past it
  (does not rely solely on `--print-timeout`).
- **Fast non-blocking skip:** stream stdout/stderr; if the **OAuth URL** appears (unauthed) or the
  binary is unavailable/invalid, terminate early and emit **`VERDICT: COMMENT` / `SUMMARY: Skipped
  (agy unavailable: <reason>)`** — `verdict.ts` treats `COMMENT` as non-blocking (`:42,:54-59`), so
  porch advances rather than defaulting to a blocking `REQUEST_CHANGES`. This is the CI/headless story.
- **Doctor (agy):** update the gemini dependency/auth check (`doctor.ts:153-163,266-274`) to detect
  the real `agy` CLI + auth via a short-timeout probe (OAuth-URL ⇒ "needs login"); install hint →
  official script `antigravity.google/cli/install.sh`; drop the `gemini`-CLI/`--yolo` check. Ensure the
  "operational model" count treats an `agy`-usable setup as operational.

#### Deliverables
- [ ] agy dispatch + verified binary resolution + role-inlined prompt + plain-text handling.
- [ ] Fast non-blocking `COMMENT` skip (unavailable/unauthed/invalid-binary).
- [ ] Graceful cost degradation (no `NaN`).
- [ ] `doctor` agy presence/auth check + install hint + operational counting.
- [ ] Unit/integration tests.

#### Acceptance Criteria
- [ ] `consult -m gemini` (authed) returns a review that used file contents (agentic).
- [ ] Unauthed/missing/IDE-stub-only → fast `COMMENT` skip (no ~30s hang, no block).
- [ ] No `NaN` cost; `doctor` reports agy status correctly without hanging.
- [ ] All tests pass.

#### Test Plan
- **Unit** (`packages/codev/src/__tests__/consult.test.ts`): mock `spawn`/binary-resolver — agy
  invoked with `--print --sandbox --add-dir`; binary rejection (IDE symlink ⇒ unavailable); OAuth-URL
  ⇒ early `COMMENT` skip; plain-text → raw review; graceful cost.
- **Doctor** (`packages/codev/src/__tests__/doctor.test.ts`): agy present+authed / present+unauthed /
  absent; operational counting.
- **Integration**: a guarded real `agy --print` smoke (skippable when unauthed in CI).

#### Risks
- **Risk**: Codev launches the IDE symlink instead of the CLI. **Mitigation**: verified binary
  resolution + rejection → skip; binary-resolution test.
- **Risk**: prompt delivery (positional vs stdin) hits arg limits. **Mitigation**: `hermes` temp-file
  pattern for large prompts; confirm delivery empirically in this phase.
- **Risk**: `agy` self-updates and changes flags. **Mitigation**: pin observed flags; e2e (Phase 2)
  catches drift.

---

### Phase 2: Doctor consolidation + docs + skeleton consistency + e2e verification
**Dependencies**: Phase 1

#### Objectives
- Make the docs and skeleton coherent for the agy backend, and verify the headline path end-to-end
  (including porch progression on skip).

#### Implementation Details
- **Files**: docs — `CLAUDE.md`, `AGENTS.md`, `README.md`,
  `codev-skeleton/resources/commands/consult.md`, `.claude/skills/consult/SKILL.md` (+ skeleton copy),
  `codev-skeleton/DEPENDENCIES.md`; tests — `packages/codev/src/__tests__/cli/` (e2e) + a
  porch-progression test. (Any residual `doctor.ts` consolidation not done in Phase 1.)
- **Docs:** agy setup — official install script + one-time interactive `agy` login (subscription);
  remove dead references to the retiring `gemini` CLI auth flow. Note the model identifier stays
  `gemini` and the `pro` alias is kept. Note that the Gemini-CLI **builder** harness
  (`harness.ts:GEMINI_HARNESS`) is a **separate, untouched** concern (out of scope; will break for
  affected tiers — follow-up issue).
- **Model-identifier audit:** confirm `gemini` stays in `MODEL_CONFIGS`, `VALID_MODELS`
  (`porch/next.ts:51`), the **skeleton** `protocol-schema.json:155` enum (the `codev/protocols` copy
  has no model enum — distinct files), and all protocol-JSON default model lists. Keep skeleton ↔
  `codev/` copies identical.
- **E2E / headline path:** run `consult -m gemini` (via agy) on a spec, a plan, and a PR; and a
  **porch-orchestrated** test proving phase progression continues when `agy` is unavailable
  (`COMMENT` skip → 2-way) — the core failure prevented.

#### Deliverables
- [ ] Docs + skeleton updated and consistent; model-id-stays-`gemini` audit done.
- [ ] `harness.ts` separate-concern note; retiring-CLI references removed.
- [ ] E2E headline-path test + porch-progression test.

#### Acceptance Criteria
- [ ] Docs reference only supported setup; skeleton ↔ codev consistent.
- [ ] E2E + porch-progression tests green.

#### Test Plan
- **E2E** (`packages/codev/src/__tests__/cli/`): agy headline path; porch run advances on skip.
- **Consistency**: skeleton/codev schema+defaults; model-identifier audit assertion.

#### Risks
- **Risk**: doc/skeleton drift across the four-tier resolver. **Mitigation**: update both trees; a
  consistency test.

## Dependency Map
```
Phase 1 (agy backend) ──→ Phase 2 (doctor/docs/skeleton/e2e)
```

## Risk Analysis
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| agy uses Flash (no `--model`) → reviews less deep than old Pro CLI | Med | Low | Accepted (architect: don't pro-pin; lean). |
| Codev launches IDE symlink instead of CLI | Med | High | Verified binary resolution + rejection → skip (Phase 1); test. |
| Unauthed/CI → blocks porch | Med | High | Non-blocking `COMMENT` skip (Phase 1); porch-progression test (Phase 2). |
| First-run auth is interactive (can't run in CI) | Med | Med | Non-blocking skip = CI story; optional pre-provisioned OAuth token; doctor "needs login". |
| No token usage → cost reporting breaks | High | Low | Graceful degradation (no `NaN`). |
| skeleton/`codev` drift | Low | Med | Update both; consistency test (Phase 2). |

## Validation Checkpoints
1. **After Phase 1**: agy review works + skips non-blockingly; doctor agy ok; graceful cost.
2. **Before done**: e2e headline path + porch progression on skip; docs/skeleton consistent.

## Documentation Updates Required
- [ ] `CLAUDE.md` / `AGENTS.md` (agy setup; model id stays `gemini`).
- [ ] `README.md`, `codev-skeleton/resources/commands/consult.md`, consult `SKILL.md`,
      `codev-skeleton/DEPENDENCIES.md`.

## Expert Review
**Date**: 2026-06-02 (iteration 1 was on a since-superseded dual-backend draft; the API backend was
dropped per architect — agy is OAuth-only, no API-key auth). The agy-relevant iter-1 findings are
**retained** here: backend-aware plain-text parsing (`extractReviewText`/`extractGeminiUsage`),
corrected test paths (`src/__tests__/…`), doctor operational-model counting, and the `COMMENT`-skip
contract. A re-consult on this single-agy plan can be run at the architect's discretion.

## Approval
- [ ] Architect review (plan-approval gate)
- [ ] Expert AI consultation complete (3-way)

## Change Log
| Date | Change | Reason |
|------|--------|--------|
| 2026-06-02 | Initial dual-backend plan | (superseded) |
| 2026-06-02 | Reverted to **single-agy** plan; dropped API backend + selector | Architect: agy is OAuth-only (no API-key auth); API backend unwanted/unbuildable |

## Notes
- **No time estimates** (per protocol). Phases ship as commits within a single PR.
- Each phase runs the SPIR I-D-E cycle (implement → defend/tests → evaluate).
- **Lean by design:** single backend swap + skip safety + doctor/docs/e2e; no API key, no selector,
  no generic gateway, no Codex/Claude-lane changes, `harness.ts` untouched.

---

## Amendment History
<!-- TICK amendments, if any, recorded here. -->
