# Plan: Migrate the Gemini consult lane to dual backends (Antigravity `agy` + Gemini Developer API)

## Metadata
- **ID**: plan-2026-06-02-778-gemini-antigravity-dual-backend
- **Status**: draft
- **Specification**: `codev/specs/778-gemini-cli-antigravity-cli-jun.md` (APPROVED 2026-06-02 + Amendment A1)
- **Created**: 2026-06-02

## Executive Summary
The `gemini` consult lane currently shells out to the retiring Google **Gemini CLI** (`gemini
--output-format json --model gemini-3.1-pro-preview`, role via `GEMINI_SYSTEM_MD`, prompt via stdin).
Per the approved spec + Amendment A1, we replace it with **two co-equal backends** behind a selector,
keeping the model identifier `gemini` everywhere (no rename — only the backend changes):

- **`agy`** (Antigravity CLI, OAuth/subscription): agentic file-reading via
  `agy --print --sandbox --add-dir`, `agy`'s **default** model (currently Flash), cheap. Plain-text
  output → graceful (no-per-token) cost degradation. Non-blocking `COMMENT` skip when unavailable.
- **`api`** (Gemini Developer API, `GEMINI_API_KEY`): single `@google/genai` `generateContent` call
  with **`gemini-3.1-pro-preview`** (Pro), **inlined** review content (no agentic file-reading),
  **real** cost rows from `usageMetadata`, env-var auth (CI-friendly, no interactive login).
- **Selector** `consult.gemini.backend: agy | api | auto`. The `auto` precedence is a real
  cost-vs-quality tradeoff and is **proposed and flagged for the architect** (Phase 3) — not silently
  hard-coded.

Both backends share: the `gemini` identifier, the non-blocking `COMMENT`-verdict skip when their
backend is unavailable, role injection, and the existing large-prompt/temp-file handling. The
combined design is reviewed by this Plan's 3-way consult per the architect.

## Success Metrics
- [ ] All spec success criteria met (both backends + selector; see spec, incl. Amendment A1).
- [ ] `agy` backend: end-to-end review with agentic file-reading; `COMMENT`-skip when unavailable.
- [ ] `api` backend: end-to-end review via `gemini-3.1-pro-preview`, real `usageMetadata` cost rows,
      no interactive login (CI-friendly).
- [ ] Selector routes `agy|api|auto` correctly; `auto` precedence deterministic + architect-approved.
- [ ] Model identifier stays `gemini` across all config/schema/docs surfaces (no rename).
- [ ] Porch-orchestrated run still advances when the chosen backend is unavailable (non-blocking skip).
- [ ] No regression to Codex/Claude lanes; existing consult/doctor/config/porch tests pass; coverage
      not reduced.

## Phases (Machine Readable)

<!-- REQUIRED: porch uses this JSON to track phase progress. -->

```json
{
  "phases": [
    {"id": "agy_backend", "title": "Phase 1: agy backend (OAuth/subscription, agentic file-reading)"},
    {"id": "api_backend", "title": "Phase 2: Gemini Developer API backend (Pro, inlined, usage data)"},
    {"id": "backend_selector", "title": "Phase 3: Backend selector + config (agy|api|auto)"},
    {"id": "docs_skeleton_e2e", "title": "Phase 4: Doctor + docs + skeleton consistency + e2e verification"}
  ]
}
```

## Phase Breakdown

### Phase 1: agy backend (OAuth/subscription, agentic file-reading)
**Dependencies**: None

#### Objectives
- Replace the retiring `gemini`-CLI dispatch in the consult `gemini` lane with an **`agy`** backend
  that preserves agentic file-reading and never blocks the run when unavailable.

#### Implementation Details
- **Files**: `packages/codev/src/commands/consult/index.ts` (dispatch + prompt assembly),
  `packages/codev/src/commands/consult/usage-extractor.ts` (`extractReviewText`/usage).
- **Binary resolution (verified, not PATH-trusting):** resolve the real CLI — prefer
  `~/.local/bin/agy`; else a PATH lookup **verified** to be the headless CLI (responds to
  `--version`/`--print` as the CLI, not the IDE Electron launcher). If none is valid (missing, or only
  the IDE symlink `~/.antigravity/.../agy`), treat the backend as **unavailable → skip** (below) —
  never launch the IDE.
- **Invocation:** `agy --print --sandbox --add-dir <workspaceRoot> [--print-timeout <N>]` with the
  reviewer **role folded into the prompt** (`${role}\n\n---\n\n${query}`, the `hermes` precedent at
  `index.ts:651-668`). Keep the existing "read the diff / explore the filesystem" prompt builders
  (agentic reading preserved); large content stays file-referenced (diff temp file + the >100k-char
  temp-file pattern) to avoid `E2BIG`.
- **Output:** `--print` returns **plain text** = the review. Adapt `extractReviewText`'s `gemini`
  branch (currently `JSON.parse(output).response`) to return the **raw output** for the agy backend;
  usage extraction returns null → **cost rows degrade gracefully** (no `NaN`; e.g. "n/a (subscription)").
- **Timeout ownership:** Codev manages its own timeout and SIGTERMs the child if `agy` hangs past it
  (does not rely solely on `--print-timeout`).
- **Fast non-blocking skip:** stream stdout/stderr; if the **OAuth URL** appears (unauthed) or the
  binary is unavailable/invalid, terminate early and emit **`VERDICT: COMMENT` / `SUMMARY: Skipped
  (agy unavailable: <reason>)`** — `verdict.ts` treats `COMMENT` as non-blocking (`:42,:54-59`), so
  porch advances rather than defaulting to a blocking `REQUEST_CHANGES`.
- **Doctor (agy):** update the gemini dependency/auth check (`doctor.ts:153-163,266-274`) to detect
  the real `agy` CLI + auth via a short-timeout probe (OAuth-URL ⇒ "needs login"); install hint →
  official script `antigravity.google/cli/install.sh`.

#### Deliverables
- [ ] agy dispatch + binary resolution + role-inlined prompt + plain-text handling.
- [ ] Fast non-blocking `COMMENT` skip (unavailable/unauthed/invalid-binary).
- [ ] Graceful cost degradation for the agy backend.
- [ ] `doctor` agy presence/auth check + install hint.
- [ ] Unit/integration tests (below).

#### Acceptance Criteria
- [ ] `consult -m gemini` (backend agy, authed) returns a review that used file contents.
- [ ] Unauthed/missing/IDE-stub-only → `COMMENT` skip (no block), fast (no ~30s hang).
- [ ] No `NaN` cost; `doctor` reports agy status correctly without hanging.
- [ ] All tests pass.

#### Test Plan
- **Unit** (`consult.test.ts`): mock `spawn`/binary-resolver — agy invoked with
  `--print --sandbox --add-dir`; binary rejection (IDE symlink ⇒ unavailable); OAuth-URL ⇒ early
  `COMMENT` skip; plain-text → raw review; graceful cost.
- **Integration**: a real `agy --print` smoke (guarded/skippable when unauthed in CI).
- **Doctor** (`doctor.test.ts`): agy present+authed / present+unauthed / absent.

#### Risks
- **Risk**: `agy` self-updates and changes flags. **Mitigation**: pin observed flags; e2e headline
  test (Phase 4) catches drift.
- **Risk**: prompt delivery (positional vs stdin) hits arg limits. **Mitigation**: `hermes` temp-file
  pattern for large prompts; confirm delivery empirically in this phase.

---

### Phase 2: Gemini Developer API backend (Pro, inlined content, real usage)
**Dependencies**: None (independent of Phase 1; can proceed in parallel)

#### Objectives
- Add a **Gemini Developer API** backend to the `gemini` lane: Pro-class model, real token usage,
  CI-friendly env-var auth, with **inlined** review content (a single API call can't read files).

#### Implementation Details
- **Files**: `packages/codev/src/commands/consult/index.ts` (api dispatch + inlined-content prompt),
  `packages/codev/src/commands/consult/usage-extractor.ts` (api usage/cost), possibly a small
  `gemini-api.ts` helper. `@google/genai` (`^1.0.0`) is **already a dependency**.
- **Call:** `@google/genai` `generateContent` with model **`gemini-3.1-pro-preview`**; reviewer role →
  `systemInstruction`; auth from `GEMINI_API_KEY` (fallback `GOOGLE_API_KEY`).
- **Inlined content (no agentic reading):** for this backend, build the prompt by **embedding** the
  diff + spec/plan + relevant changed-file text directly, and **drop** the "read from disk / explore
  filesystem" instructions (`index.ts:664,884,1042,1051,1154,1588` are agy/CLI-only). Reuse the
  existing diff assembly; respect the API request-size limit (truncate-with-notice fallback for very
  large diffs — deterministic, never a silent partial review).
- **Real cost rows:** parse the response **`usageMetadata`** (`promptTokenCount`,
  `candidatesTokenCount`, cached tokens) into the existing usage pipeline; keep/þadjust the
  `gemini-3.1-pro` pricing key in `usage-extractor.ts`.
- **Non-blocking skip:** no `GEMINI_API_KEY`/`GOOGLE_API_KEY` ⇒ emit the `COMMENT` skip (same contract
  as Phase 1). No interactive login path (CI-friendly).
- **Doctor (api):** report `GEMINI_API_KEY` presence + a minimal reachability check; surface the
  June-19 unrestricted-key guidance (scope to the Generative Language API) without trying to detect it.

#### Deliverables
- [ ] API dispatch via `@google/genai` with `gemini-3.1-pro-preview` + `systemInstruction` role.
- [ ] Inlined-content prompt path (no filesystem instructions) + large-input fallback.
- [ ] Real cost rows from `usageMetadata`.
- [ ] `COMMENT` skip when no key; `doctor` api check.
- [ ] Unit/integration tests.

#### Acceptance Criteria
- [ ] backend=api + `GEMINI_API_KEY` → real review via Pro model with real cost rows, no login.
- [ ] No key → `COMMENT` skip (non-blocking).
- [ ] Large diff handled deterministically (no crash/silent truncation).
- [ ] All tests pass.

#### Test Plan
- **Unit** (`consult.test.ts`, `metrics.test.ts`): mock `@google/genai` — model id, systemInstruction
  role, inlined content (no "read from disk"), `usageMetadata`→cost, no-key `COMMENT` skip.
- **Integration**: guarded live call when `GEMINI_API_KEY` present (skippable in CI without a key).

#### Risks
- **Risk**: API request-size limit < large PR diff. **Mitigation**: deterministic truncate/fallback
  with notice; covered by a test.
- **Risk**: model id / pricing key mismatch. **Mitigation**: pin `gemini-3.1-pro-preview`; usage-parity
  test.

---

### Phase 3: Backend selector + config (`agy | api | auto`)
**Dependencies**: Phase 1, Phase 2

#### Objectives
- Route the `gemini` lane to the chosen backend via config + auto-detect, with the `auto` precedence
  **proposed and flagged for the architect** (not silently hard-coded).

#### Implementation Details
- **Files**: `packages/codev/src/lib/config.ts` (config schema + default + types),
  `packages/codev/src/commands/consult/index.ts` (selection logic).
- **Config knob:** `consult.gemini.backend: "agy" | "api" | "auto"` (exact shape finalized here).
  Default value is part of the auto-precedence decision below.
- **`auto` precedence (PROPOSE + FLAG — do not silently hard-code):** document the proposed rule and
  raise it for the architect at the plan-approval gate. **Proposed default:** prefer **`api`** when
  `GEMINI_API_KEY`/`GOOGLE_API_KEY` is set (Pro quality + real usage + CI), else **`agy`** if a valid
  authed CLI is present, else **skip** (`COMMENT`). Rationale + the cost-vs-quality tradeoff
  (agy = cheap/Flash vs api = pricier/Pro) are written up for the architect to confirm or invert.
- Both backends keep the `gemini` identifier; selection is internal to the lane (no new user-facing
  model name).

#### Deliverables
- [ ] `consult.gemini.backend` config (schema, default, validation) + selection logic.
- [ ] Written-up `auto` precedence proposal + explicit architect flag (in plan + surfaced at gate).
- [ ] Tests for routing + auto precedence.

#### Acceptance Criteria
- [ ] `agy|api|auto` each route to the correct backend; invalid value errors clearly.
- [ ] `auto` resolves deterministically per the (architect-approved) rule.
- [ ] All tests pass.

#### Test Plan
- **Unit** (`config.test.ts`, `consultation-models.test.ts`, `consult.test.ts`): config parse/default;
  routing for each backend value; `auto` precedence under {key present / absent} × {agy authed / not}.

#### Risks
- **Risk**: silent cost surprise if `auto` prefers `api` (paid) by default. **Mitigation**: flag the
  precedence for the architect; document clearly; `doctor`/first-run note.

---

### Phase 4: Doctor consolidation + docs + skeleton consistency + e2e verification
**Dependencies**: Phase 1, Phase 2, Phase 3

#### Objectives
- Make `codev doctor`, the docs, and the skeleton coherent for the dual-backend lane, and verify the
  headline paths end-to-end (including porch progression on skip).

#### Implementation Details
- **Files**: `packages/codev/src/commands/doctor.ts` (consolidated dual-backend reporting if not fully
  done in P1/P2); docs — `CLAUDE.md`, `AGENTS.md`, `README.md`,
  `codev-skeleton/resources/commands/consult.md`, `.claude/skills/consult/SKILL.md` (+ skeleton copy),
  `codev-skeleton/DEPENDENCIES.md`; tests — `packages/codev/tests/e2e/` (+ a porch-progression test).
- **Model-identifier audit:** confirm `gemini` stays in `MODEL_CONFIGS`, `VALID_MODELS`
  (`porch/next.ts:51`), `protocol-schema.json:155` enum, and all protocol-JSON default model lists —
  **no rename**; `pro` alias kept. Keep skeleton ↔ `codev/` copies identical.
- **`harness.ts` note:** docs note that the Gemini-CLI **builder** harness (`GEMINI_HARNESS`) is a
  separate, untouched concern (out of scope; will break for affected tiers — follow-up issue).
- **Docs:** dual-backend setup — `agy` install + one-time `agy` login (subscription), and
  `GEMINI_API_KEY` for the api backend (incl. June-19 key-restriction note); the `consult.gemini.backend`
  knob; remove dead references to the retiring `gemini` CLI auth flow.
- **E2E / headline path:** run `consult -m gemini` for **both** backends on a spec, a plan, and a PR;
  and a **porch-orchestrated** test proving phase progression continues when the chosen backend is
  unavailable (the core failure prevented).

#### Deliverables
- [ ] `doctor` reports both backends accurately with current guidance.
- [ ] Docs + skeleton updated and consistent; model-id-stays-`gemini` audit done.
- [ ] E2E headline-path tests (both backends) + porch-progression test.

#### Acceptance Criteria
- [ ] `doctor` correct under: agy authed/unauthed/absent; api key present/absent.
- [ ] Docs reference only supported setup; skeleton ↔ codev consistent.
- [ ] E2E + porch-progression tests green.

#### Test Plan
- **E2E** (`tests/e2e/`): both backends headline path; porch run advances on skip.
- **Consistency**: skeleton/codev schema+defaults; model-identifier audit assertion.

#### Risks
- **Risk**: doc/skeleton drift across the four-tier resolver. **Mitigation**: update both trees; a
  consistency test.

## Dependency Map
```
Phase 1 (agy) ─┐
               ├─→ Phase 3 (selector) ─→ Phase 4 (doctor/docs/e2e)
Phase 2 (api) ─┘
```
Phases 1 and 2 are independent (parallelizable). Phase 3 needs both. Phase 4 is the capstone.

## Risk Analysis
### Technical Risks
| Risk | Probability | Impact | Mitigation |
|------|------------|--------|------------|
| `agy` defaults to Flash (no `--model`) → weaker agy reviews | High | Low | Accepted (architect); the `api` backend provides Pro when a key is present. |
| `auto` precedence causes unexpected paid-API cost | Med | Med | Proposed + flagged for architect; documented; `doctor`/first-run note. |
| Codev launches IDE symlink instead of CLI | Med | High | Verified binary resolution + rejection → skip (Phase 1); binary-resolution test. |
| API request-size limit < large diff | Med | Med | Deterministic truncate/fallback with notice (Phase 2). |
| Skipped backend blocks porch | Med | High | `COMMENT`-verdict non-blocking skip, both backends; porch-progression test (Phase 4). |
| skeleton/`codev` drift | Low | Med | Update both; consistency test (Phase 4). |

## Validation Checkpoints
1. **After Phase 1**: agy review works + skips non-blockingly; doctor agy ok.
2. **After Phase 2**: api review works via Pro with real usage; skips without a key.
3. **After Phase 3**: selector + `auto` precedence (architect-confirmed).
4. **Before done**: e2e both backends + porch progression on skip; docs/skeleton consistent.

## Documentation Updates Required
- [ ] `CLAUDE.md` / `AGENTS.md` (dual-backend; model id stays `gemini`).
- [ ] `README.md`, `codev-skeleton/resources/commands/consult.md`, consult `SKILL.md`,
      `codev-skeleton/DEPENDENCIES.md`.

## Expert Review
**Date**: (pending — porch runs the Plan's 3-way consult on `porch done`)
**Models**: Gemini, Codex, Claude
**Key Feedback / Plan Adjustments**: (to be filled after consultation)

## Approval
- [ ] Architect review (plan-approval gate)
- [ ] Expert AI consultation complete (3-way)
- [ ] **Architect to confirm the `auto` backend precedence** (Phase 3 — flagged decision)

## Change Log
| Date | Change | Reason |
|------|--------|--------|
| 2026-06-02 | Initial plan (dual-backend agy + api + selector) | Approved spec + Amendment A1 |

## Notes
- **No time estimates** (per protocol). Phases ship as commits within a single PR (per builder PR
  strategy), not separate PRs.
- Each phase runs the SPIR I-D-E cycle (implement → defend/tests → evaluate) with its own consult.
- **Lean by design:** scope is exactly "two backends + a selector" + the supporting doctor/docs/e2e;
  no generic gateway, no Codex/Claude-lane changes, `harness.ts` untouched.

---

## Amendment History
<!-- TICK amendments, if any, recorded here. -->
