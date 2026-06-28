# PIR Plan: Support `codex` as an architect (codex-only revision)

> **Rescoped 2026-06-19 — CODEX-ONLY.** `agy` is dropped from #929 and split into follow-up **#1063**
> (agy's only role-injection channel is its first *user* turn via `--prompt-interactive` — visible,
> weaker, and less durable than claude's `--append-system-prompt` / codex's `-c model_instructions_file=`
> out-of-band injection; not worth shipping a degraded architect). The retiring `gemini` CLI (#778) is
> **removed from architect support** but **kept as a builder harness**. PR #1059 (on this branch, not
> merged) already landed the harness-agnostic resume crash-loop fix and `codex` architect parity; this
> revision delivers the **codex-only delta**: strip the gemini-*architect* additions #1059 made, leaving
> claude + codex as the only supported architects.

## Understanding

PR #1059 (on `builder/pir-929`, not yet merged) delivered three things. Two are **kept exactly as-is**;
the third is **reverted**:

**KEEP — engine-neutral, not gemini-specific:**
- **Harness-agnostic resume crash-loop fix** — the `HarnessProvider.buildResume` seam
  (`harness.ts`). Claude returns the resume invocation; every other harness returns `null` → fresh,
  role-injected launch. Applied at both the architect site (`tower-instances.ts` `launchInstance`) and
  the builder `--resume` site (`spawn.ts` `discoverResumeSession` + `spawn-worktree.ts`). This fixes the
  latent crash-loop where a non-Claude harness + a stale Claude `.jsonl` built an invalid
  `<cmd> --resume <claude-uuid>` and shellper restart-looped to death. **Untouched by this revision** —
  it is the core deliverable and is independent of which non-Claude harnesses are supported.
- **`codex` architect parity** — codex is unaffected by the gemini retirement. Its role injection via
  `-c model_instructions_file=<.architect-role.md>` (`CODEX_HARNESS.buildRoleInjection`), project
  context read natively from `AGENTS.md`, and fresh-launch / reconnect paths all stay.

**REVERT — the gemini-*architect* additions #1059 made (the codex-only delta):**
#1059 added gemini as a supported *architect*, which introduced an architect context-file seam
(`getArchitectFiles` + `writeArchitectContextFiles`) whose **only implementer is `GEMINI_HARNESS`** and
whose **only consumer is `buildArchitectArgs`**. With gemini removed as an architect, that entire seam
becomes dead code. Verified by grep — no other harness implements `getArchitectFiles`; claude and codex
do not (codex reads `AGENTS.md` natively). So the seam is deleted, not just gemini's implementation.

**Gemini stays a builder harness.** `GEMINI_HARNESS.buildRoleInjection` /
`buildScriptRoleInjection` (via `GEMINI_SYSTEM_MD`) and all gemini *builder* tests are untouched. Only
gemini's *architect* surface is removed.

### Why no `getArchitectFiles` seam survives

Grep on the current branch:
- `getArchitectFiles` interface method (`harness.ts:74`) — declared optional.
- `GEMINI_HARNESS.getArchitectFiles` (`harness.ts:135`) — the **only** implementer.
- `writeArchitectContextFiles` (`tower-utils.ts:181`) — the **only** consumer of `getArchitectFiles`.
- `writeArchitectContextFiles` is itself called from exactly one place: `buildArchitectArgs`
  (`tower-utils.ts:205`).

After removing gemini's architect surface, nothing implements `getArchitectFiles`, so
`writeArchitectContextFiles` is a no-op for every harness. Per the brief ("remove the seam itself IF no
harness implements it anymore"), the whole chain is deleted: interface method, gemini impl,
`writeArchitectContextFiles`, and its `buildArchitectArgs` call site. `buildArchitectArgs` keeps its
`const harness = getArchitectHarness(...)` line — `harness` is still used immediately after for
`harness.buildRoleInjection(...)`.

## Proposed Change

### 1. Remove the gemini-architect context-file seam (`harness.ts`, `tower-utils.ts`)

- **`harness.ts`**: delete the `getArchitectFiles?(workspacePath)` method from the `HarnessProvider`
  interface (and its doc comment, ~lines 71–80), and delete `GEMINI_HARNESS.getArchitectFiles`
  (~lines 132–138, including the "Gemini reads project context from .gemini/settings.json" comment).
  Leave `GEMINI_HARNESS.buildRoleInjection` / `buildScriptRoleInjection` (the `GEMINI_SYSTEM_MD` builder
  surface) intact.
- **`tower-utils.ts`**: delete `writeArchitectContextFiles` (lines 171–190, including its doc comment)
  and its call in `buildArchitectArgs` (line 205). Update the `buildArchitectArgs` doc comment (line 196)
  to drop the "Also writes any harness-specific context files (e.g. Gemini's .gemini/settings.json)"
  sentence. Confirm `harness` (line 204) is still referenced by `buildRoleInjection` below (it is) — keep
  the `getArchitectHarness` call.

### 2. `doctor`: affirm codex, bar gemini as architect (`commands/doctor.ts:699–705`)

Split the current `resolvedHarness === 'codex' || resolvedHarness === 'gemini'` affirmation branch:
- **`codex`**: keep the green "✓ codex is configured as architect shell — supported" affirmation, with
  the "Conversation resume is Claude-main-only" + "select via `.codev/config.json`" gray notes.
- **`gemini`**: move into the warn/bar branch alongside `opencode` — print a yellow warning that gemini
  is **unsupported as an architect** (the Gemini CLI is retiring, #778) but **supported for builders**,
  recommending `claude` or `codex` for the architect. Add a matching `warningDetails` entry.

### 3. Remove the `.gemini/settings.json` gitignore entry

Nothing writes that file anymore (the seam is gone):
- **Root `.gitignore:11`** — remove the `.gemini/settings.json` line.
- **`lib/gitignore.ts:24`** (`CODEV_GITIGNORE_ENTRIES`) — remove the line. (`codev update`'s gitignore
  backfill only *appends*, so an adopter's existing line is left in place; no churn, no removal logic
  needed. No `codev-skeleton/` mirror exists — grep confirms.)

### 4. Tests

Drop gemini-*architect* cases; keep gemini *builder* cases.
- **`agent-farm/__tests__/tower-utils.test.ts`**: remove the `writeArchitectContextFiles (#929)` describe
  block (lines 207–239) and the `writeArchitectContextFiles` import (line 21). (The block's claude case
  "writes nothing" is moot once the function is deleted.)
- **`agent-farm/__tests__/tower-instances.test.ts:712,728`**: remove the two gemini
  `.gemini/settings.json` architect tests (write-if-missing + no-clobber). **Keep** the codex architect
  resume-skip regression guard (stale Claude `.jsonl` + codex → fresh `buildArchitectArgs`, no `--resume`)
  and the claude-still-resumes case — these guard the kept crash-loop fix.
- **`agent-farm/__tests__/config.test.ts:131`**: remove the `expect(harness.getArchitectFiles).toBeDefined()`
  assertion (the seam no longer exists). Keep the rest of that test's gemini *builder*-harness assertions.
- **`__tests__/gitignore.test.ts:140,211`** and **`__tests__/update.test.ts:530,550`**: drop
  `.gemini/settings.json` from the expected `added` / `gitignoreAdded` arrays.
- **`af-architect.test.ts`**: keep codex arg-construction cases; remove any gemini-*architect* case if
  present (grep at implement time). This file is the no-Tower command path; it does not guard the resume
  regression (that's `tower-instances.test.ts`).
- Sweep for any remaining gemini-*architect* test reference; **keep** every gemini *builder* test
  (`GEMINI_SYSTEM_MD` role injection, `getBuilderHarness` gemini cases).

### 5. Docs (`codev/resources/arch.md` #929 subsection, lines 272–281)

Rewrite to claude + codex architects only:
- Para 1 (line 274): "claude, codex, and gemini are all supported as architects" → "claude and codex are
  supported as architects; **gemini is builder-only** (Gemini CLI retiring, #778)". Drop the trailing
  "Gemini additionally gets a `.gemini/settings.json` … via `getArchitectFiles`" sentence entirely.
  Adjust the override-aware-resolution examples to use codex (the architect path); the gemini override
  example can be reframed as a *builder* example or dropped.
- Caveat para (line 276, #1062): keep — still valid. Reword "recognized codex/gemini cases" → "recognized
  codex case" (architect scope); the mechanism is unchanged.
- Conversation-resume para (line 278): keep. Reword "Codex/gemini architects" → "Codex architects"; keep
  "(and resumed codex/gemini **builders**, via `spawn.ts` `discoverResumeSession`)" — gemini builders
  still exercise the `buildResume → null` path.
- `getArchitectFiles` para (line 280): **delete entirely** — the seam is gone.
- **`CLAUDE.md` / `AGENTS.md`**: check the architect-harness guidance for any gemini-architect claim; if
  none needs changing, leave both untouched (they must stay byte-identical). The always-on context block
  references agy only for *consult*, not architect — no change expected there.

### 6. Stray comments referencing the removed seam

Grep-and-fix the prose comments that mention "Gemini's .gemini/settings.json" in non-test code so no dead
reference survives:
- `agent-farm/commands/architect.ts:29`
- `agent-farm/servers/tower-instances.ts:533`
- (the `tower-utils.ts` comments are removed with the function in §1)

## Files to Change

- `packages/codev/src/agent-farm/utils/harness.ts` — remove `getArchitectFiles?` from the interface and
  `GEMINI_HARNESS.getArchitectFiles`. (Keep `buildResume`, `CODEX_HARNESS`, gemini builder surface.)
- `packages/codev/src/agent-farm/servers/tower-utils.ts` — remove `writeArchitectContextFiles` + its
  `buildArchitectArgs` call; update the doc comment.
- `packages/codev/src/commands/doctor.ts` — affirm codex; bar gemini as architect (builder-only warning).
- `.gitignore` (root) and `packages/codev/src/lib/gitignore.ts` — remove `.gemini/settings.json`.
- `packages/codev/src/agent-farm/commands/architect.ts`,
  `packages/codev/src/agent-farm/servers/tower-instances.ts` — fix stray `.gemini/settings.json` comments.
- Tests: `tower-utils.test.ts`, `tower-instances.test.ts`, `config.test.ts`, `gitignore.test.ts`,
  `update.test.ts`, and `af-architect.test.ts` if it carries a gemini-architect case.
- Docs: `codev/resources/arch.md` (#929 subsection); `CLAUDE.md` / `AGENTS.md` only if a gemini-architect
  claim is present.

**Explicitly NOT changing** (dropped from the prior agy plan): no `AGY_HARNESS`, no `lib/agy-bin.ts`
extraction, no `resolveBinary` seam, no agy tests/docs, no `message-write.ts` submit strategy.

## Risks & Alternatives Considered

- **Risk — deleting the seam breaks codex architect context.** It does not: codex reads `AGENTS.md`
  natively (no pointer file), and the seam only ever served gemini. Regression covered by the kept codex
  resume-skip + arg-construction tests, and verified live at `dev-approval`.
- **Risk — leftover gemini-architect references compile/pass tests but mislead.** Mitigated by the
  grep-and-fix sweep (§4, §6) across both code and docs before signalling complete.
- **Risk — `codev update` adopters retain a stale `.gemini/settings.json` gitignore line.** Acceptable:
  the backfill only appends, so existing adopter lines are inert and harmless; no removal migration is in
  scope. New projects simply won't get the line.
- **Risk — `TOWER_ARCHITECT_CMD`/`--architect-cmd` override without matching `.codev/config.json`.**
  Pre-existing #1059/#1062 caveat (unrecognized override commands default to the claude harness). Out of
  scope; documented in arch.md's caveat para. Recommended selection remains `.codev/config.json`.
- **Alternative — keep gemini as an architect (status quo of #1059).** Rejected by the architect: the
  Gemini CLI retires 2026-06-18 (#778); shipping it as an architect would ship a dying dependency. agy,
  its intended successor, is deferred to #1063 because its role-injection channel is too weak.
- **Alternative — keep the `getArchitectFiles` seam "for future harnesses."** Rejected: no current
  harness uses it (claude/codex read `AGENTS.md` natively), and the brief explicitly says delete dead
  code. A future harness that needs a pointer file can reintroduce a purpose-built seam.

## Test Plan

**Unit (this worktree, gate-verifiable from the diff):**
- `pnpm --filter @cluesmith/codev build` clean (seam removal is purely subtractive in the interface).
- `pnpm --filter @cluesmith/codev test` — the kept codex architect resume-skip + claude-resume guards
  green; gemini *builder* tests green; gitignore/update tests reflect the dropped `.gemini/settings.json`
  entry; no test references the deleted `getArchitectFiles` / `writeArchitectContextFiles`.
- Grep-clean: no remaining `getArchitectFiles`, `writeArchitectContextFiles`, or
  `.gemini/settings.json` reference anywhere except (a) gemini *builder* code/tests, which must remain.

**Manual / empirical (reviewer at the `dev-approval` gate; needs `codex` installed + signed in). Set
`shell.architect: "codex …"` (and/or `shell.architectHarness: "codex"`) in `.codev/config.json`:**
- `afx architect` (no-Tower) launches codex with the role injected via `-c model_instructions_file=`.
- `afx workspace start` main architect launches on a **clean** cwd.
- `afx workspace start` main architect launches with a **stale Claude `.jsonl` present** in
  `~/.claude/projects/<encoded-cwd>/` — must **not** crash-loop; confirm **no `--resume`** in the
  launched command (the primary regression target, the kept crash-loop fix).
- `afx workspace add-architect` sibling codex launches with role injected.
- `afx send` delivers + submits: single-line, multi-line (>3 lines, no swallowed Enter), `--interrupt`,
  and while codex's TUI is streaming. (Flakiness → triggers the deferred submit-strategy follow-up.)
- Tower stop→start reconnect and shellper auto-restart both relaunch the codex architect.
- A builder spawned by a codex architect preserves `CODEV_ARCHITECT_NAME` affinity.
- `afx spawn <id> --resume` on a non-Claude builder → fresh launch + resume notice (not
  `--resume <claude-id>`).
- `codev doctor` with `shell.architect: "codex …"` → affirms codex; with `gemini` → warns
  builder-only-not-architect.
