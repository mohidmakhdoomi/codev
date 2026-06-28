# PIR Review: Support `codex` as an architect (codex-only)

Fixes #929

## Summary

Brings the OpenAI `codex` CLI to parity with `claude` as a Codev **architect**, selectable via `.codev/config.json` (`shell.architect` / `shell.architectHarness`). The core fix routes session-discovery + `--resume` argument construction behind a new optional `HarnessProvider.buildResume` capability, eliminating a latent crash-loop where a non-Claude architect (or resumed builder) with any stale Claude `.jsonl` built an invalid `<cmd> --resume <claude-uuid>` invocation and shellper restart-looped to death. **Gemini is builder-only** — the Gemini CLI is retiring (#778), so the originally-scoped gemini-*architect* support was removed; gemini's `GEMINI_SYSTEM_MD` *builder* surface is untouched. (`agy`, the gemini successor, is deferred as an architect to follow-up #1063 — its only role-injection channel is a visible first user turn.)

## Scope note (codex-only rescope, 2026-06-19)

This branch was originally scoped as codex **+** gemini architects (the earlier #1059 implementation). It was rescoped mid-review to **codex-only**: the gemini-architect additions (the `getArchitectFiles` context-file seam, `writeArchitectContextFiles`, the doctor affirmation, the `.gemini/settings.json` gitignore entry, and gemini-architect tests) were reverted in a surgical, subtractive pass. The engine-neutral `buildResume` crash-loop fix and codex architect parity — the durable deliverables — are fully intact. The net diff vs `main` therefore reflects codex architect parity + the crash-loop fix, with no gemini-architect surface.

## Files Changed

Net vs `main` (`git diff --stat <merge-base>`):

- `packages/codev/src/agent-farm/utils/harness.ts` (+27) — `buildResume?` on the `HarnessProvider` interface; `CLAUDE_HARNESS.buildResume` (delegates to `findLatestSessionId`, returns bundled `{ sessionId, args, scriptFragment }`); codex/gemini/opencode leave it undefined → fresh launch
- `packages/codev/src/agent-farm/utils/config.ts` (+16) — `getArchitectHarness`/`getBuilderHarness` resolve from the *override-aware* command (`getResolvedCommands`); `getResolvedCommands.architect` honors `TOWER_ARCHITECT_CMD`
- `packages/codev/src/agent-farm/servers/tower-instances.ts` (+35/-…) — architect resume gated on `getArchitectHarness(...).buildResume?.()`, composed with the pre-existing `safeToResume` sibling-collision guard; WARN gated on resume support
- `packages/codev/src/agent-farm/servers/tower-utils.ts` (+3/-1) — `buildArchitectArgs` injects the architect role via the shared helper (the gemini-only `writeArchitectContextFiles` was added then removed in the rescope)
- `packages/codev/src/agent-farm/commands/spawn.ts` (+46/-…) — `discoverResumeSession` takes the builder harness, returns the bundled resume object; both call sites pass `getBuilderHarness(...)`; distinct "harness does not support resume" log
- `packages/codev/src/agent-farm/commands/spawn-worktree.ts` (+25/-…) — `startBuilderSession`'s `resumeSessionId?: string` → `resume?: { sessionId, scriptFragment }`; script emits the pre-escaped fragment
- `packages/codev/src/agent-farm/commands/architect.ts` (+…/-…) — no-Tower path calls the shared `buildArchitectArgs` (was duplicating role injection)
- `packages/codev/src/commands/doctor.ts` (+24) — affirm codex architect support; warn that gemini is builder-only (not an architect)
- `.gitignore`, `packages/codev/src/lib/gitignore.ts` — net unchanged (the `.gemini/settings.json` entry was added then removed in the rescope)

Tests:
- `packages/codev/src/agent-farm/__tests__/tower-instances.test.ts` (+102) — architect resume-skip regression guard (codex + stale Claude jsonl → fresh, no `--resume`; claude still resumes)
- `packages/codev/src/agent-farm/__tests__/spawn-worktree.test.ts` (+75) — builder resume script uses escaped `scriptFragment`; codex/gemini builders → fresh script, no `--resume`
- `packages/codev/src/agent-farm/__tests__/discover-resume-session.test.ts` (+45) — harness-arg threading; codex/gemini null-return + claude bundled-object cases
- `packages/codev/src/agent-farm/__tests__/config.test.ts` (+53) — override-aware harness resolution (`TOWER_ARCHITECT_CMD` / `--architect-cmd` / `--builder-cmd` → non-claude harness, no `buildResume`)
- `packages/codev/src/agent-farm/__tests__/af-architect.test.ts` (+17) — `buildArchitectArgs` delegation mocks
- `packages/codev/src/agent-farm/__tests__/tower-utils.test.ts` (+1) — minor

Docs / artifacts:
- `codev/resources/arch.md` — "Supported Architect Harnesses & Conversation Resume (#929)" subsection: claude + codex architects, gemini builder-only, Claude-only resume, override-aware resolution, #1062 caveat
- `codev/resources/lessons-learned.md` — one Architecture lesson (audit *all* invocation seams when extending a provider abstraction)
- `codev/plans/...`, `codev/reviews/...`, `codev/state/pir-929_thread.md`, `codev/projects/929-*/status.yaml`

## Commits

Net vs `main` (excluding porch chores + the main-merge commit):

- `53c9f037` [PIR #929] Thread: implement phase complete (codex-only)
- `be84f75a` [PIR #929] Tests + arch.md: claude+codex architects only (drop gemini-architect cases)
- `0d920884` [PIR #929] doctor: bar gemini as architect (builder-only); drop .gemini/settings.json gitignore
- `a6b42daa` [PIR #929] Remove gemini-architect context-file seam (codex-only)
- `db88349c` [PIR #929] Plan revised: codex-only (agy dropped → #1063, gemini builder-only)
- `1f4bfd30` [PIR #929] Doc: caveat — unrecognized override commands default to claude harness (#1062)
- `9b615cdf` [PIR #929] Address architect integration review: override-aware harness + centralized context files
- `69cf20de` [PIR 929][Phase: implement] feat: harness-gated session resume for codex/gemini architects

## Test Results

- `pnpm build`: ✓ pass (clean TS types)
- `pnpm test` (full suite): ✓ **3332 passed, 48 skipped, 0 failures**
- Manual verification: empirical codex architect lifecycle validation (clean + stale-jsonl launch, add-architect, `afx send`, reconnect, affinity, builder `--resume`) was exercised by the human at the `dev-approval` gate against the running worktree — the reason PIR was chosen over AIR/BUGFIX.

## Architecture Updates

**COLD (`codev/resources/arch.md`)** — updated. The "Supported Architect Harnesses & Conversation Resume (#929)" subsection documents: (1) claude + codex are supported architects selected via `.codev/config.json`; gemini is **builder-only** (Gemini CLI retiring, #778); (2) conversation resume is Claude-main-only via `HarnessProvider.buildResume`, and the crash-loop it fixes; (3) override-aware harness resolution and the #1062 unrecognized-command caveat; (4) no architect context-file seam exists — claude/codex read `AGENTS.md` natively, and the gemini-only `getArchitectFiles` seam was removed with gemini's architect support.

No **HOT** (`arch-critical.md`) change: this PR extends an existing abstraction (Spec 591) rather than introducing a new always-on invariant, so a cold-tier reference detail is the correct routing.

## Lessons Learned Updates

**COLD (`codev/resources/lessons-learned.md`, Architecture section)** — one lesson retained: when abstracting per-CLI behavior behind a provider, every call site that builds a CLI invocation must route through the provider — including resume/restart paths, not just the obvious fresh-launch path. The resume seam was the one path Spec 591 left harness-blind, and it only crash-loops on the `--resume` branch (fresh launches were already correct), which is why "builders already prove the path" didn't cover it.

No **HOT** (`lessons-critical.md`) change: this is a spec-narrow recipe better suited to the cold archive.

## Things to Look At During PR Review

- **The `buildResume` bundling decision** (`harness.ts`): one method returns both the Node-argv `args` (for the `spawn()` architect site) and a shell-escaped `scriptFragment` (for the builder bash generator), mirroring `buildRoleInjection`/`buildScriptRoleInjection`. Avoids a second independently-optional method (which would force a `!` non-null assertion) and avoids `.join(' ')`-ing a raw argv into bash (word-split/quoting bug).
- **The `safeToResume` interaction** (`tower-instances.ts`): the new harness gate composes with the pre-existing sibling-collision guard (`safeToResume`, #832) — resume happens only when *both* the harness implements `buildResume` *and* no persisted siblings exist.
- **Override-aware harness resolution precedence (BLOCKER B fix)**: `getResolvedCommands.architect` is `cliOverrides.architect || TOWER_ARCHITECT_CMD || config`. Within the Tower process `cliOverrides` is empty (set in the spawning `afx` process, not the long-lived server), so this matches the launch site's `TOWER_ARCHITECT_CMD || config`. An explicit `shell.architectHarness` / `shell.builderHarness` still wins over auto-detection by design.
- **Codex-only seam removal**: the gemini-architect `getArchitectFiles` / `writeArchitectContextFiles` seam was deleted (gemini was its only implementer; `buildArchitectArgs` was its only consumer). Confirm `buildArchitectArgs` still resolves `getArchitectHarness(...)` (used by `buildRoleInjection`) and that codex needs no context file (reads `AGENTS.md` natively). Grep-verified: zero residual `getArchitectFiles` / `writeArchitectContextFiles` / `.gemini/settings.json` references.
- **Known caveat — unrecognized override commands still default to the claude harness (follow-up: cluesmith/codev#1062).** The override-awareness covers *recognized* commands (claude/codex/gemini/opencode); `resolveHarness` still falls through to `CLAUDE_HARNESS` for an **unrecognized** override (e.g. `TOWER_ARCHITECT_CMD=bash`) with no explicit `shell.architectHarness`. Pre-existing, narrow, separable (not a #929 regression). Mitigation: set an explicit harness. Documented in `arch.md`; tracked in #1062.

## Consultation Findings & Dispositions

A **full 3-way advisory CMAP** (gemini, codex, claude) ran on this codex-only PR as a single pass, instructed to read every changed file **in full** plus callers/dependencies and assess the whole PR (not the unified diff). Verdicts:

- **codex: APPROVE** — no blocking issues. Confirmed the crash-loop fix is correct and the Claude-only resume gating is properly centralized behind `buildResume`. Three non-blocking coverage nits (below).
- **claude: APPROVE** — no blocking issues. Traced every changed file + callers; verified a codex/gemini harness can never reach a `--resume <claude-uuid>` at either the architect or builder site, that the gemini-architect seam removal is complete (zero dangling refs), and that the crash-loop regression is pinned from **four independent angles** (`discover-resume-session`, `tower-instances`, `config`, `spawn-worktree` tests). Four non-blocking observations (below).
- **gemini (agy): no usable verdict** — the Antigravity CLI returned a generic greeting in 8.1s rather than performing the review (the structural agy limitation — no durable task/system-prompt channel — that motivated deferring agy as an architect to #1063). Not a review of the code; recorded as unavailable, not as an APPROVE or REQUEST_CHANGES.

**Net: 2/2 substantive reviewers APPROVE, zero REQUEST_CHANGES, zero blocking defects → no code change required.**

**Non-blocking nits (consensus, accepted as a low-priority follow-up):** both codex and claude noted that the `doctor` architect-shell branch (the codex-affirm / gemini-builder-only-warning logic) and the no-Tower `afx architect` codex path lack *direct* unit tests, and that the "explicit `shell.architectHarness` wins" rule isn't pinned. Disposition: **deferred.** The branch logic is trivial and both reviewers independently verified it reads correctly; there is currently **no** test harness for the `doctor` `shell.architect` block at all (the pre-existing opencode-architect branch is likewise untested), so adding the first test for it is net-new infrastructure beyond this PR's subtractive scope — tracked as a follow-up rather than expanded here. claude also re-flagged the known `doctor`-reads-config-not-overrides cosmetic discrepancy (same class as the #1062 caveat) and the `safeToResume` stale-removed-sibling jsonl gap (documented "acceptable until #832"). No action; both pre-existing and separable.

Full reviewer outputs: `/tmp/cmap-929-{codex,claude,gemini}.md`.

## How to Test Locally

For reviewers pulling the branch:

- **View diff**: VSCode sidebar → right-click builder `pir-929` → **Review Diff**
- **Run dev server**: `afx dev pir-929`
- **What to verify** (needs codex installed; set `shell.architect: "codex"`):
  - `afx workspace start` main architect launches with a **stale Claude `.jsonl` present** in `~/.claude/projects/<encoded-cwd>/` — must NOT crash-loop, and no `--resume` in the launched command (primary regression target)
  - `afx architect` (no-Tower) + `afx workspace add-architect` launch with role injected
  - `afx send` single-line / multi-line (>3 lines) / `--interrupt` / while streaming
  - `afx spawn <id> --resume` on a non-Claude builder → fresh launch + resume notice, inspect `.builder-start.sh` for no `--resume <claude-id>`
  - `codev doctor` with `shell.architect: "codex"` → affirms codex; with `gemini` → warns builder-only-not-architect
