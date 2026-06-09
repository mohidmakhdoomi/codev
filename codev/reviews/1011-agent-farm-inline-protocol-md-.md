# PIR Review: Deliver framework files via resolver-aware channels (fresh-install class fix)

Fixes #1011.
Fixes #1013.

## Summary

Post-Spec-618, framework files (protocol docs, role docs, templates, framework resource docs) live only in the package skeleton (resolver tier 4) and are not on disk in fresh installs, yet several builder-facing consumers referenced them by literal `codev/...` path (`cat`/`cp`/"read this file"), which bypasses the four-tier resolver and fails in a fresh install. This PR is the class fix: it *delivers* framework files through resolver-aware channels (a `{{protocol_reference}}` context var that inlines `protocol.md` fresh at spawn, and a shared `{{> path}}` include directive resolved on both the spawn and porch phase-prompt channels), sweeps the literal-path references, and adds a `codev doctor` audit plus a principle-level convention note as enforcement. It also folds in #1013 (de-stale `bugfix/protocol.md` and ship it to the skeleton; drop the `experiment/protocol.md` partial template copy).

## Files Changed

48 files, +1113 / -774 (the large deletions are the stale 548-line `bugfix/protocol.md` and the divergent inline plan-structure block). Core code:

- `packages/codev/src/lib/skeleton.ts` (+24) — shared `resolveCodevIncludes()`
- `packages/codev/src/agent-farm/commands/spawn-roles.ts` (+45/-) — `{{protocol_reference}}` fill via fresh resolver read
- `packages/codev/src/commands/porch/prompts.ts` (+8) — phase-prompt include resolution
- `packages/codev/src/lib/framework-ref-audit.ts` (+85, new) — shell-fetch audit
- `packages/codev/src/commands/doctor.ts` (+23) — wire audit against workspace `codev/` overrides

Tests: `framework-ref-audit.test.ts` (+164, new), `spawn-roles.test.ts` (+134), `bugfix-619-aspir-prompt.test.ts` (+10/-), 3 Spec-746 baselines re-swept.

Markdown (skeleton + mirrored `codev/`): 9 builder-prompts, spir/aspir `prompts/plan.md`, experiment/spike `protocol.md`, spir `protocol.md`, `roles/builder.md`, new skeleton `bugfix/protocol.md` (rewritten from the stale `codev/` copy), `CLAUDE.md`/`AGENTS.md` convention note. Plus the plan + thread artifacts.

## Commits

- `d35e2c0d` [PIR #1011] Trim framework-files convention note (principle-level, drop cat/cp + padding)
- `1c673862` [PIR #1011] Drop porch leak from spir protocol.md Structure notes
- `126ffe7b` [PIR #1011] Trim plan-prompt lead-in (drop porch-internals leak)
- `9e0e46de` [PIR #1011] Fix: deliver spir/aspir plan template (with required phases JSON) via porch-resolved include
- `02178a99` [PIR #1011] Add non-fatal validateProtocol warning for json-without-md protocols
- `09f167f0` [PIR #1011] Remove {{#if protocol_reference}} guard; enforce protocol.md completeness
- `2cee4885` [PIR #1011] Repoint doctor audit to workspace codev/ overrides (end-user scope)
- `926168a5` [PIR #1011] Reword dead template-path pointers in spir/protocol.md
- `c2dc930d` [PIR #1011] Fold in #1013: de-stale bugfix protocol.md + drop experiment partial copy
- `15345f54` [PIR #1011] Tighten framework-files convention note (accuracy + scope)
- `4cfa872c` [PIR #1011] Rework delivery: fresh-at-spawn placeholder substitution
- `282bca0f` [PIR #1011] Layer 2 sweep + Patch 2 embeds + Layer 3 (convention + doctor audit)
- `d814851f` [PIR #1011] Inline protocol.md into builder spawn prompt
- `81d45d00` [PIR #1011] Review + retrospective
- (latest) [PIR #1011] Fail-fast on missing builder-prompt.md (Codex REQUEST_CHANGES iter-1)
- (plus `[PIR #1011] Plan draft` and the porch phase-transition chore commits)

## Test Results

- `pnpm build`: ✓ pass (core then codev, including dashboard + copy-skeleton)
- `pnpm test`: ✓ 3281 passed / 13 pre-existing skips on a clean run. New tests cover the `{{protocol_reference}}` fill, `{{> }}` include resolution on both spawn and porch channels, the plan template's phases JSON reaching the builder, the doctor audit (positive/negative/no-op), the protocol.md completeness check, the `validateProtocol` json-without-md warning, the skeleton sweep, the fail-fast behaviour when a protocol ships no `builder-prompt.md` (Codex iter-1 disposition), and the `hasFrameworkOverrides` true-no-op predicate (Codex iter-2 disposition).
- Manual verification: the human reviewed the running worktree at the `dev-approval` gate and approved. End-to-end against the real skeleton: `protocol.md` inlines fresh under "Protocol Reference (full text)", "Read and internalize" restored, `{{> }}` expands, zero handlebar residue.

## Architecture Updates

Added a "Builder Prompt: Protocol & Template Delivery (#1011)" subsection to `codev/resources/arch.md` (under Agent Farm Internals, next to the role-prompt-injection description). It documents the two new delivery channels (`{{protocol_reference}}` and the `{{> path}}` include resolved by `resolveCodevIncludes` on both the spawn and porch phase-prompt paths) and the `codev doctor` audit, because this PR introduced a genuinely new mechanism for how framework files reach builders.

## Lessons Learned Updates

Added three bullets to `codev/resources/lessons-learned.md` (Protocol Orchestration): deliver framework files via resolver-aware channels rather than fetching them by literal path; soft-mode protocols have only `protocol.md` as a guidance channel so a delivery fix must cover both channels; and don't drop a plan-template pointer as a dead reference because the spir/aspir plan template carries the phases JSON porch's plan gate requires.

## Things to Look At During PR Review

- **Consultation disposition (Codex REQUEST_CHANGES, iter-1, addressed).** Codex flagged that the no-`builder-prompt.md` fallback in `spawn-roles.ts` still pointed the builder at `codev/protocols/...` by literal path, re-introducing the bug class for custom protocols. Real finding. Disposition: rather than harden the fallback (which would duplicate template wording and drift), the fallback was **removed** in favour of fail-fast. `validateProtocol` now hard-errors when a protocol resolves no `builder-prompt.md`, with a defensive backstop in `buildPromptFromTemplate`. Every shipped protocol ships a `builder-prompt.md`, so this only affects a malformed custom protocol, which now gets a clear error instead of a silently degraded prompt. Pinned by two tests (`buildPromptFromTemplate` throws; `validateProtocol` fails fast on a json-only protocol). PIR is single-pass, so this was not independently re-reviewed: flagged for your attention at the `pr` gate. Claude APPROVE'd; Gemini was skipped non-blockingly (agy not authenticated).
- **Consultation disposition (iter-2, architect-requested re-review).** Because the iter-1 fix landed after that consult ran, a fresh single-pass 3-way was run against the final state: Claude APPROVE (HIGH, no issues); Codex REQUEST_CHANGES on one minor item — `codev doctor` printed a `✓` line even for projects with no `codev/` overrides, contradicting the documented "no-op". Addressed (true no-op): the audit is now gated on a tested `hasFrameworkOverrides` predicate, so a project with no overrides produces no output. Gemini skipped non-blockingly (agy authenticated but timed out producing the review in the builder env, twice — environmental, not auth). Verdicts: `codev/projects/1011-*/1011-review-iter2-*.txt`.
- **The `{{> path}}` include directive is new surface.** It's a Handlebars-style partial resolved by a shared `resolveCodevIncludes()` (recursive, depth-guarded at 5, unresolved → empty), run on two channels (spawn-time inside `protocol.md`, and porch's `loadPromptFile` for phase prompts). Worth confirming the mechanism choice and the dual-channel wiring.
- **The porch `loadPromptFile` change** (`commands/porch/prompts.ts`) is what makes the spir/aspir plan template resolve fresh at the plan phase. The plan gate needs the machine-readable phases JSON (`has_phases_json`), so this is load-bearing, not cosmetic.
- **Doctor scope.** The audit flags only shell-fetch verbs (`cat`/`cp`/…) against `codev/(protocols|roles)/...`, runs against the project's local `codev/` overrides (end-user-controlled), warn-not-error; the shipped skeleton is guarded by a CI unit test instead.
- **bugfix rewrite (#1013).** A stale 548-line manual-flow doc was rewritten to a ~78-line porch-accurate doc and shipped to the skeleton (it was absent). Worth a careful read that the porch-era flow (pr gate, CMAP, gate-driven merge) is described correctly.
- **Two-tree parity.** Every protocol/role change was hand-applied to both `codev-skeleton/` and the self-hosted `codev/` tree. Filed #1016 to add a CI parity guard.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder pir-1011 → **View Diff**
- **Run dev server**: `afx dev pir-1011` (or the VSCode Run Dev Server action)
- **What to verify**:
  - `porch next <id>` for a spir/aspir project at the plan phase contains the plan template's `"phases"` JSON and no literal `{{>`.
  - A fresh `codev init` scratch project, then `afx spawn --task ... --protocol spir`: the spawned builder's opening prompt contains the inlined `protocol.md` under "Protocol Reference (full text)" with zero `{{` residue (tier-4 skeleton fallback path).
  - `codev doctor` in a project with a `codev/` override containing a `cat codev/protocols/...` line flags it (warn), and is a no-op with no overrides.

## Flaky Tests

Two pre-existing tests flaked once under full-suite parallel load (5s timeouts), then passed on a clean re-run of the same code:

- `packages/codev/src/__tests__/team-cli.test.ts:140` ("auto-detects author when not provided")
- `packages/codev/src/__tests__/team-github.test.ts:241` ("returns gracefully when gh CLI succeeds or fails")

Both contend on the `gh` CLI / git-author subprocess under parallelism and are unrelated to this diff (which touches no `team-*` code). Not fixed or quarantined per protocol scope rules.
