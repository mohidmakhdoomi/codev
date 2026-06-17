# Review: gemini-cli-antigravity-cli-jun (Spec 778)

## Summary

Google retires Gemini-CLI subscription serving (Pro/Ultra/free) on **2026-06-18**. This
project swaps the `gemini` consult lane's backend from the retired Gemini CLI to the
**Antigravity CLI (`agy`)**, keeping everything else about the lane intact:

- **Single, OAuth-only backend.** `agy` authenticates via Google OAuth / subscription —
  it cannot take an API key (verified empirically), so there is no separate Gemini
  Developer API backend.
- **Agentic file reading preserved.** `agy --print --sandbox --add-dir <dir>` lets the
  reviewer read the workspace (PR diffs, source) the same way the old `--yolo` lane did.
- **agy's default model — no Pro pin.** The model identifier stays `gemini` everywhere
  and the `pro` alias is retained; only the *backend binary* changed.
- **Non-blocking skip.** When `agy` is missing, unauthenticated, an IDE-symlink stub, or
  times out, the lane emits `VERDICT: COMMENT` ("Gemini lane skipped — …") so porch's
  `allApprove` treats it as non-blocking and SPIR/ASPIR/BUGFIX phases still advance on
  the remaining reviewers (2-way). This was the core failure mode the spec defended.
- **Real-binary resolution.** `resolveAgyBin()` rejects the Antigravity IDE's `agy`
  symlink (by realpath) and prefers the real headless CLI (`~/.local/bin/agy`), with a
  `CODEV_AGY_BIN` override.

Implemented in two plan phases: **Phase 1 (`agy_backend`)** — dispatch, binary
resolution, non-blocking skip, graceful cost/usage degradation, `codev doctor`
integration, and tests; **Phase 2 (`docs_skeleton_e2e`)** — docs + skeleton consistency,
a guarded real-`agy` e2e (front-door + agentic-read), and a porch-orchestrated
progression test.

## Spec Compliance

- [x] **Backend swap to `agy`** — `MODEL_CONFIGS.gemini` dispatches via `runAgyConsultation`.
- [x] **Single backend, OAuth-only** — no API-key path; no separate Developer API backend.
- [x] **Agentic file reading (scoped)** — `--sandbox --add-dir <workspace> + a dedicated
  per-process consult sandbox subdir` (never the whole OS temp dir); proven live (e2e read a
  planted file).
- [x] **agy default model, no Pro pin** — no `--model` flag; `pro` alias kept; id stays `gemini`.
- [x] **Non-blocking COMMENT skip** — missing / unauthed / IDE-stub / timeout → `COMMENT`.
- [x] **Cost/usage degrade gracefully** — agy emits plain text; usage extraction returns
  `null` (no `NaN`), metrics still record.
- [x] **`codev doctor`** — presence via `resolveAgyBin()`; streaming `verifyAgy()` reports
  authed / needs-login / timeout with current install guidance.
- [x] **Docs reference only the supported setup; skeleton ↔ codev consistent.**
- [x] **E2E + porch-progression tests green.**
- [x] **Model identifier stays `gemini`** in `MODEL_CONFIGS`, `VALID_MODELS`, the
  skeleton `protocol-schema.json` enum, and all protocol-JSON default model lists.

## Deviations from Plan

- **Doc file list expanded beyond the plan.** The plan's Phase 2 file list named
  `CLAUDE.md`, `AGENTS.md`, `README.md`, the skeleton `consult.md`/`DEPENDENCIES.md`, and
  `SKILL.md`. Review iterations surfaced additional **agy-relevant** stale copies that the
  self-hosted four-tier resolver shadows: `codev/DEPENDENCIES.md`,
  `codev/resources/commands/consult.md`, `codev/`+skeleton `resources/commands/codev.md`,
  and the Consult Architecture section of `codev/resources/arch.md`. All were synced; the
  `codev/` copies of `consult.md` and `DEPENDENCIES.md` are now byte-identical to their
  skeleton twins. Rationale: the acceptance criterion is literally "skeleton ↔ codev
  consistent," and leaving these stale would document an unsupported setup.
- **No separate API backend / no Pro pin** — these were *removed* across the spec's own
  evolution (architect corrections during Specify), not deviations at implementation time.

## Lessons Learned

### What Went Well
- The non-blocking-skip contract (`COMMENT` → `allApprove` passes) made the lane swap
  safe by construction: even a totally absent `agy` cannot stall a phase.
- Empirical verification of the `agy` headless contract (flags, OAuth-only auth, IDE
  symlink vs. real bin) up front prevented guessing — the real CLI behaves as documented.
- The guarded real-`agy` e2e doubled as headline-path acceptance: it actually read a
  planted file and returned the codeword through the `consult -m gemini` front door.

### Challenges Encountered
- **Self-hosted doc-copy drift**: the biggest time sink. Each Phase-2 review round found
  another `codev/` instance copy still referencing the retired CLI. Resolved by a
  repo-wide scan that fixed every remaining current-doc reference in one pass and
  explicitly scoped out historical artifacts.
- **agy as a reviewer of code diffs (Phase 1)**: agy/Flash needs the diff *content* in
  the prompt, not just a file list, or it wanders; for docs (Phase 2) it reads files
  directly and reviews cleanly. (Captured as a follow-up on consult's impl-query shape.)

### What Would Be Done Differently
- Run the `diff codev/<f> codev-skeleton/<f>` consistency sweep *before* the first
  review, not in response to it — it would have collapsed three iterations into one.

### Methodology Improvements
- A porch/consult pre-flight that, for any doc-touching phase in a self-hosted repo,
  lists `codev/` ↔ `codev-skeleton/` divergences would catch this class early.

## Technical Debt
- The Gemini-CLI **builder** harness (`harness.ts`, plus `README.md` CLI-flag table and
  `architect`/`builder` config examples) still references the retired CLI. Out of scope
  per the approved spec; tracked as a follow-up.

## Consultation Feedback

### Specify Phase
- **Round 1** — gemini **REQUEST_CHANGES** (the single-shot API pivot would break file
  access), codex **REQUEST_CHANGES** (two behavior gaps; one feasibility req too strong),
  claude **APPROVE**. **Addressed**: pivoted to the agy-backed Approach B that preserves
  agentic reading.
- **Round 2** — codex **REQUEST_CHANGES** (one contradiction + under-specified skip
  contract), claude **REQUEST_CHANGES** (stale "Pro" reference contradicting the
  no-pinning decision), gemini **COMMENT** (endorsed the `COMMENT`-skip strategy).
  **Addressed**: removed the Pro references and tightened the skip contract; spec approved
  by the human at the `spec-approval` gate.

### Plan Phase
- **Round 1** — gemini **APPROVE**, codex **REQUEST_CHANGES** (two ambiguous contracts +
  wrong test paths), claude **COMMENT** (usage-extractor routing, test paths).
  **Addressed**: pinned the usage-extractor backend routing and corrected test-file
  locations; plan approved at the `plan-approval` gate. (The dual-backend plan was then
  superseded by the single-agy revert per the architect's final direction.)

### Implement — Phase 1 (`agy_backend`)
- **Round 1** — claude **APPROVE**, codex **REQUEST_CHANGES** (binary-resolution/auth-probe
  didn't fully meet the skip-safety contract), gemini **COMMENT** (dead code in doctor/tests).
  **Addressed**: hardened `resolveAgyBin`/auth probing; removed dead code.
- **Round 2** — claude **APPROVE**, codex **REQUEST_CHANGES** (missing happy-path
  integration verification), gemini **CONSULT skip**. **Addressed**: added the guarded
  real-`agy` integration test; added the `--print` timeout → non-blocking-skip handling.
- **Round 3** — gemini **COMMENT** (agy timed out → lane self-skipped), codex **APPROVE**,
  claude **APPROVE**. Advanced.

### Implement — Phase 2 (`docs_skeleton_e2e`)
- **Round 1** — gemini **APPROVE**, claude **COMMENT**, codex **REQUEST_CHANGES** (×4):
  e2e bypassed the `consult` front door; progression test not porch-orchestrated;
  `SKILL.md` `tick` divergence; stale `--yolo` in `consult.md`. **Addressed**: all four —
  added a real-binary front-door e2e case, added a `next()`-driven porch-orchestrated
  progression test, removed `tick`, fixed `--yolo`; also ran the live headline path
  (`consult -m gemini --type spec|plan`: COMMENT / APPROVE).
- **Round 2** — gemini **APPROVE**, claude **COMMENT**, codex **REQUEST_CHANGES** (×2):
  `codev/DEPENDENCIES.md` ↔ skeleton divergence; "Gemini Pro" wording in CLAUDE/AGENTS.
  **Addressed**: synced both; "Gemini Pro" → "Gemini (via agy)"; plus a repo-wide scan
  that fixed `consult.md`, `codev.md`, `arch.md`, and README blurbs, with out-of-scope
  items (historical artifacts, builder harness, generate-image skill) documented.
- **Round 3** — gemini **APPROVE**, codex **APPROVE**, claude **APPROVE**. Advanced to review.

### Review Phase — PR #988 CMAP (`--type pr`)
- **Round 1** — gemini **APPROVE**, claude **APPROVE**, codex **REQUEST_CHANGES** (3,
  integration-readiness): spec/plan lacked approval frontmatter; branch 310 commits
  behind `main`; `chore(porch)` commits in history. **Addressed**: added approval
  frontmatter (documents the human gate approvals); **merged `origin/main`** (conflict-free
  → 0 behind, rebuilt core, full suite green). **Rebutted**: the porch state-commits are
  required by repo policy (CLAUDE.md "DO NOT SQUASH MERGE — individual commits document the
  development process").
- **Re-consult** — gemini **APPROVE**, claude **APPROVE**, codex **REQUEST_CHANGES** (2 new,
  both valid): (a) **security** — the agy `--add-dir` granted the entire OS `tmpdir()`;
  (b) **doc drift** — the `origin/main` merge pulled the #985 "Claude auth" section into
  `codev/resources/commands/consult.md` but not the skeleton copy. **Addressed**: (a) added
  `consultSandboxDir()` — a per-process `mkdtemp` subdir holding the PR-diff + large-prompt
  files; agy is now granted only `workspaceRoot` + that subdir (pinned by a new test);
  (b) synced the #985 section into the skeleton so both `consult.md` copies are
  byte-identical again.

## Architecture Updates

Updated `codev/resources/arch.md` → **Consult Architecture**: the `gemini` lane's spawn
line and model-configuration table row now describe the `agy` mechanism (`agy --print
--sandbox --add-dir <workspace>`, role folded into the prompt, OAuth/subscription auth —
no API key) instead of the retired `gemini --yolo` / `GEMINI_SYSTEM_MD` / `GOOGLE_API_KEY`
mechanism. No new subsystems or data flows were introduced — this is a backend swap within
the existing CLI-delegation layer, so no structural diagram changes were needed.

## Lessons Learned Updates

Added one entry to `codev/resources/lessons-learned.md` under **Documentation**: in a
self-hosted Codev repo the four-tier resolver makes `codev/` instance copies shadow
`codev-skeleton/`, so shared docs drift independently; when changing a shared doc, grep
both trees and `diff` every shared file in one pass, and keep historical artifacts
(`specs/`, `plans/`, dated analyses) at their original wording. (Generalizes the existing
"[From 0099] exhaustive grep before all-instances-fixed" lesson to the skeleton/instance
split.)

## Flaky Tests
No flaky tests encountered. The full unit suite (3217 passing, 13 skipped) ran green on
every iteration; the 13 skips are the guarded real-`agy` e2e cases (no-op without `agy`).

## Follow-up Items
- Migrate the Gemini-CLI **builder** harness (`harness.ts`) off the retired CLI (separate
  effort, per spec).
- Improve consult's `impl`-review query to include diff *content* (not just a file list)
  so the agy/Flash reviewer doesn't wander on code-diff reviews.
- Non-agy pre-existing drift between `codev/resources/commands/codev.md` and its skeleton
  twin (unrelated command-doc content) — candidate for a MAINTAIN sweep.
