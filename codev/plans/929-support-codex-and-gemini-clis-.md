# PIR Plan: Support `codex` and `agy` (Antigravity CLI) as architects

> **Rescoped 2026-06-17** — `agy` (Antigravity CLI) replaces the retiring `gemini` CLI (#778) as the
> non-Claude architect. PR #1059 already landed the harness-agnostic resume fix, `codex` architect
> parity, and the `getArchitectFiles` context seam. This revision delivers the **agy delta**: add an
> `AGY_HARNESS`, swap `gemini` out of architect support, and update tests + docs.

## Understanding

PR #1059 (on this branch, not yet merged) already delivered, and we **keep**, the parts that are not
gemini-specific:

- **Harness-agnostic resume crash-loop fix** — the `HarnessProvider.buildResume` seam. Claude returns
  the resume invocation; every other harness returns `null` → fresh, role-injected launch. Applied at
  both the architect site (`tower-instances.ts:517`) and the builder `--resume` site
  (`spawn.ts` / `spawn-worktree.ts`). This is engine-neutral and stays exactly as-is.
- **`codex` architect parity** — codex is unaffected by the gemini retirement; its `-c
  model_instructions_file=` role injection and fresh-launch path are kept.
- **The `getArchitectFiles` context-injection seam** in `HarnessProvider` (`harness.ts:74`) + its
  shared writer `writeArchitectContextFiles` (`tower-utils.ts:181`, called from `buildArchitectArgs`).
  Built for gemini; the *seam* is reused, but agy turns out **not to need it** (see the finding below).

The **delta**: the Gemini CLI is retired 2026-06-18. Its replacement is Google's Antigravity CLI
(`agy`), which Codev's `consult` lane already uses (spec/plan 778). So the non-Claude *architect* must
land on `agy`, not the dying `gemini` CLI. Decision (architect, do not relitigate): **swap** — `agy`
replaces `gemini` as an architect; `GEMINI_HARNESS` stays for *builders* but gemini is no longer
offered/affirmed as an architect. Resume stays deferred (agy `buildResume` → `null`, fresh launch).

### 🔑 Key finding — agy's role/context mechanism differs from gemini's (flagged per the brief)

I confirmed agy's mechanism from `agy --help`, the `agy` binary's embedded strings, and the existing
`consult` agy lane (`commands/consult/index.ts:614-833`). **agy is closer to `codex` than to the
retired gemini CLI**:

1. **Project context: agy reads `AGENTS.md` natively** (no settings/pointer file needed). The binary's
   embedded guidance states rules are appended to *"`AGENTS.md` in the Workspace Customizations Root"*
   (the workspace = the architect's cwd) and a *Global Customizations Root* (`~/.gemini`). This is the
   **codex pattern** — codex also reads `AGENTS.md` natively. The retired gemini CLI needed
   `.gemini/settings.json` → `context.fileName: AGENTS.md` to be *pointed* at the manifest; **agy does
   not.** ⇒ **agy needs no `getArchitectFiles`.** The repo already ships `AGENTS.md`, so an agy
   architect gets project context for free.

2. **Role injection: agy has no `--append-system-prompt` flag and no `GEMINI_SYSTEM_MD`-style env var.**
   (`agy --help` exposes no system-prompt flag; the consult lane confirms *"agy has no system-prompt
   flag — fold the role into the prompt"*, `consult/index.ts:785`.) The architect role
   (`.architect-role.md`) is distinct from the committed `AGENTS.md` and must **not** clobber it.
   agy's purpose-built channel for this is **`-i` / `--prompt-interactive`** — *"Run an initial prompt
   interactively and continue the session"* (`agy --help`; called out in the issue as the architect
   launch shape). So agy injects the role by **folding it into the interactive launch prompt**
   (`agy --dangerously-skip-permissions --prompt-interactive "<role text>"`), mirroring the consult
   "hermes precedent" rather than the gemini `.gemini/settings.json` file pattern the brief
   hypothesized.

3. **Binary resolution:** a bare `agy` on `PATH` may be the Antigravity **IDE launcher symlink**
   (resolves to the Electron app), not the headless CLI — launching it opens the GUI and never produces
   an architect session. The consult lane already guards this with `resolveAgyBin()` / `isRealAgyCli()`
   / `agyRespondsToVersion()` (`consult/index.ts:644-696`), preferring `~/.local/bin/agy` and
   realpath-rejecting the IDE bundle. The architect launch must reuse this.

**Net divergence from the brief's hypothesis:** the brief expected agy role injection via a
`getArchitectFiles` settings file (gemini-style). In reality agy reads `AGENTS.md` natively (so no
context file is needed) and takes the role via `--prompt-interactive` (so no settings file is involved
at all). The `getArchitectFiles` *seam* stays in the interface (kept from #1059) but agy doesn't
implement it; gemini's implementation is removed with the swap. This is the one item the architect
asked me to surface, and it's empirically re-verified at the `dev-approval` gate (PIR's purpose).

## Proposed Change

### 1. Add `AGY_HARNESS` (`agent-farm/utils/harness.ts`)

```ts
export const AGY_HARNESS: HarnessProvider = {
  // agy has no system-prompt flag; fold the role into the interactive launch
  // prompt (`--prompt-interactive "<role>"`). The role rides as agy's initial
  // turn; project context comes from AGENTS.md, read natively (like codex).
  buildRoleInjection: (content, _filePath) => ({
    args: ['--prompt-interactive', content],
    env: {},
  }),
  buildScriptRoleInjection: (_content, filePath) => ({
    fragment: `--prompt-interactive "$(cat '${shellEscapeSingleQuote(filePath)}')"`,
    env: {},
  }),
  // Resume deferred (MVP): agy supports --continue/--conversation, but wiring
  // real resume is a follow-up. Leaving buildResume undefined → fresh launch.
  // No getArchitectFiles: agy reads AGENTS.md natively (no pointer file needed).
  resolveBinary: (cmd) => resolveAgyBin() ?? cmd,
};
```

- Register `agy: AGY_HARNESS` in `BUILTIN_HARNESSES`.
- Extend `detectHarnessFromCommand` so a command whose basename includes `agy` resolves to `'agy'`.
- **Exact `-i` arg form** (`--prompt-interactive <value>` as a trailing positional vs `=<value>`) is
  confirmed at implement time via a safe, non-hanging probe; the consult lane treats agy's prompt as a
  trailing positional after the mode flag (`--print … <prompt>`), so `--prompt-interactive` is modeled
  the same way (mode flag + positional). Re-verified live at `dev-approval`.

### 2. Binary-resolution seam (reuse consult's guard)

- **Extract** `resolveAgyBin`, `isRealAgyCli`, `agyRespondsToVersion` from `commands/consult/index.ts`
  into a shared module `lib/agy-bin.ts` (no behavior change; consult re-imports from there — verify the
  consult tests still pass).
- **Add** `resolveBinary?(cmd: string): string` to `HarnessProvider`. Default: harnesses omit it
  (executable used as-is). `AGY_HARNESS` implements it via `resolveAgyBin() ?? cmd` (prefer the real
  headless CLI; fall back to the configured token if resolution fails, so the user sees agy's own error
  rather than a silent Claude-flag mismatch).
- **Apply** at every architect executable-determination site, resolving the harness first
  (`getArchitectHarness(workspacePath)`):
  - `agent-farm/commands/architect.ts:26` (no-Tower `afx architect`)
  - `agent-farm/servers/tower-instances.ts:467` (main, workspace-start) and `:963` (sibling
    `add-architect`)
  - `agent-farm/servers/tower-terminals.ts:~657/671` and `:~879` (reconnect / auto-restart relaunch)
  Each becomes `const cmd = harness.resolveBinary?.(cmdParts[0]) ?? cmdParts[0];`. The sprawl mirrors
  the existing duplicated architect-command parsing; centralizing that parsing is explicitly **out of
  scope** (issue nice-to-have "command-aware harness resolution").

### 3. Remove `gemini` from architect support (the swap)

- **`doctor.ts:699-705`**: change the supported-architect affirmation from `codex`/`gemini` to
  `codex`/`agy`. Move `gemini` into the barred/warn branch alongside `opencode` (configuring `gemini`
  as architect now prints an "unsupported as architect; supported for builders" warning, pointing to
  `agy` or `claude`). agy presence/auth is already checked elsewhere in doctor (the consult lane).
- **`GEMINI_HARNESS.getArchitectFiles`** (`harness.ts:135-138`): **remove** it. It is architect-only;
  with gemini barred as architect it is dead code. `GEMINI_HARNESS`'s builder surface
  (`buildRoleInjection`/`buildScriptRoleInjection` via `GEMINI_SYSTEM_MD`) is untouched.
- **`.gemini/settings.json` gitignore entry** (`lib/gitignore.ts:24`): **remove** — nothing writes that
  file anymore. (`codev update`'s gitignore backfill only *appends*, so adopters' existing line is left
  in place; no churn. Mirror the removal in `codev-skeleton/` if a copy exists.)

### 4. Tests

- **`harness.test.ts`** (or the relevant unit file): `AGY_HARNESS.buildRoleInjection` →
  `['--prompt-interactive', <role>]`; `buildScriptRoleInjection` → escaped `--prompt-interactive
  "$(cat …)"`; `buildResume` undefined; `getArchitectFiles` undefined; `resolveBinary` returns the
  resolved bin (mock `resolveAgyBin`). `detectHarnessFromCommand('agy …') === 'agy'`.
- **`tower-utils.test.ts:207-239`**: replace the gemini `writeArchitectContextFiles` cases with agy —
  assert **no** architect context file is written for agy (it has no `getArchitectFiles`), claude still
  writes none, and `buildArchitectArgs` for agy yields `--prompt-interactive <role>` in `args` with
  empty `env`.
- **`tower-instances.test.ts`**: architect resume-skip regression guard extended to agy (stale Claude
  `.jsonl` present + agy architect → fresh `buildArchitectArgs` form, **no `--resume`**); claude still
  resumes. Keep the codex case.
- **`af-architect.test.ts`**: add agy fresh-launch arg construction (`--prompt-interactive` role) +
  `resolveBinary` substitution; keep the note that this file does not guard the resume regression.
- **gitignore tests** (`gitignore.test.ts`, `update.test.ts`): drop `.gemini/settings.json` from
  expected entries.
- Mirror any gemini-architect test that becomes agy; **keep** gemini *builder* tests.

### 5. Docs

- **`codev/resources/arch.md`** #929 subsection: rewrite the gemini-architect specifics to describe
  `agy` — selectable via `.codev/config.json` (`shell.architect: "agy …"` / `shell.architectHarness:
  "agy"`); role injected via `--prompt-interactive` (no system-prompt flag); project context from
  `AGENTS.md` read natively; binary resolved via `resolveAgyBin` (IDE-launcher guard); resume is
  Claude-main-only.
- **`lessons-learned.md`** (COLD, if warranted): one line — "when porting a provider abstraction across
  a CLI replacement, re-derive the new CLI's actual context/role mechanism from its `--help` + binary,
  don't assume parity with the predecessor (agy reads `AGENTS.md` natively + injects role via `-i`,
  unlike the retired gemini CLI's `GEMINI_SYSTEM_MD` + `.gemini/settings.json`)." Route by tier per
  Spec 987; HOT files are capped, so this goes COLD unless it displaces a weaker lesson.
- **`CLAUDE.md` / `AGENTS.md`**: only if the architect-harness section needs the gemini→agy swap noted;
  keep the two files byte-identical.

### 6. Submit-strategy hook (conditional — decided at `dev-approval`)

Unchanged from #1059's posture: if the human's `dev-approval` testing shows flaky multi-line /
interrupt / streaming `afx send` delivery on agy's TUI, add an optional `getSubmitStrategy?()` to
`HarnessProvider` and branch `message-write.ts`. Designed, not implemented preemptively.

## Files to Change

- `packages/codev/src/agent-farm/utils/harness.ts` — add `AGY_HARNESS` (+ register, + `detectHarnessFromCommand`); add optional `resolveBinary?` to the interface; import `resolveAgyBin` from the new shared module; **remove** `GEMINI_HARNESS.getArchitectFiles`.
- `packages/codev/src/lib/agy-bin.ts` — **new**: `resolveAgyBin` / `isRealAgyCli` / `agyRespondsToVersion` extracted from consult.
- `packages/codev/src/commands/consult/index.ts` — re-import those three from `lib/agy-bin.ts` (no behavior change).
- `packages/codev/src/agent-farm/commands/architect.ts:26` — `resolveBinary` the executable.
- `packages/codev/src/agent-farm/servers/tower-instances.ts:467,963` — `resolveBinary` at main + sibling launch.
- `packages/codev/src/agent-farm/servers/tower-terminals.ts` (~657/671, ~879) — `resolveBinary` at reconnect/relaunch.
- `packages/codev/src/commands/doctor.ts:699-705` — affirm `codex`/`agy`; bar `gemini` as architect.
- `packages/codev/src/lib/gitignore.ts:24` — remove `.gemini/settings.json` (mirror in `codev-skeleton/` if present).
- Tests: `harness.test.ts`, `tower-utils.test.ts`, `tower-instances.test.ts`, `af-architect.test.ts`, `gitignore.test.ts`, `update.test.ts`, and the consult test that touches the extracted functions.
- Docs: `codev/resources/arch.md` (#929 subsection), optionally `lessons-learned.md`, `CLAUDE.md`/`AGENTS.md`.
- *(Conditional)* `message-write.ts` + `harness.ts` — submit strategy, only if `dev-approval` reveals flakiness.

## Risks & Alternatives Considered

- **Risk — agy treats the `-i` role as a first user turn.** `--prompt-interactive` runs the role as the
  initial prompt and continues the session, so agy may "respond to" the role before the human types.
  Acceptable: it's exactly what the flag is for, and the architect role reads as standing instructions.
  Verified live at `dev-approval`. Mitigation if jarring: frame the injected content so agy treats it
  as configuration (decided after observing real behavior).
- **Risk — large role doc as a CLI arg (ARG_MAX).** The architect role is a few KB, well under ARG_MAX;
  the Node-spawn path passes it as one argv element, the script path `cat`s the file. Consult's
  temp-file fallback is only needed for very large prompts; not required here.
- **Risk — `resolveAgyBin` returns null (agy not at a trusted path).** `resolveBinary` falls back to the
  configured token, so the launch fails with agy's own error rather than silently mis-injecting. doctor
  surfaces the install/auth state. Documented.
- **Risk — `TOWER_ARCHITECT_CMD`/`--architect-cmd` override without matching `.codev/config.json`.**
  Pre-existing #1059 caveat (override-aware harness resolution already routes through
  `getResolvedCommands`; an *unrecognized* override command still defaults to claude — tracked in
  #1062). Out of scope; documented.
- **Alternative — implement agy role injection via `getArchitectFiles` writing `.gemini/settings.json`
  (the brief's hypothesis).** Rejected after confirming agy reads `AGENTS.md` natively (no pointer file
  needed) and exposes no settings key for a *separate* system-prompt file. A `.gemini/settings.json`
  would be cargo-culted from the retired gemini CLI and wouldn't inject the role.
- **Alternative — append the role to the workspace `AGENTS.md`.** Rejected: clobbers the project's
  committed instructions and pollutes git status. `--prompt-interactive` keeps the role ephemeral.
- **Alternative — add agy as a *builder* harness too.** Out of scope (issue is architect-only; builders
  already have gemini via `GEMINI_HARNESS`). `AGY_HARNESS` still provides `buildScriptRoleInjection` for
  interface completeness, but no builder wiring/tests are added.

## Test Plan

**Unit (this worktree, gate-verifiable from the diff):**
- `pnpm --filter @cluesmith/codev build` clean (new optional `resolveBinary` typing; new module).
- `pnpm --filter @cluesmith/codev test` — new agy harness/arg/resume-skip/`resolveBinary` cases green;
  gemini *builder* tests still green; gitignore tests reflect the dropped entry; consult tests still
  green after the extraction.

**Manual / empirical (reviewer at the `dev-approval` gate; needs `agy` installed + signed in). Set
`shell.architect: "agy --dangerously-skip-permissions"` (and/or `shell.architectHarness: "agy"`) in
`.codev/config.json`:**
- `afx architect` (no-Tower) launches the **real** agy CLI (not the IDE) with the role visible as the
  initial turn and `AGENTS.md` context available.
- `afx workspace start` main architect launches on a **clean** cwd.
- `afx workspace start` main architect launches with a **stale Claude `.jsonl` present** in
  `~/.claude/projects/<encoded-cwd>/` — must **not** crash-loop; confirm **no `--resume`** in the
  launched command (the primary regression target, now exercised for agy).
- `afx workspace add-architect` sibling launches (real bin + role).
- `afx send` delivers + submits: single-line, multi-line (>3 lines, no swallowed Enter), `--interrupt`,
  and while agy's TUI is streaming. (Flakiness → triggers the conditional submit-strategy work.)
- Tower stop→start reconnect and shellper auto-restart both relaunch the agy architect (real bin).
- A builder spawned by an agy architect preserves `CODEV_ARCHITECT_NAME` affinity.
- Confirm agy does **not** litter the worktree with an unignored `.gemini/`/`.agy/` dir; if it does, add
  the appropriate gitignore entry as a follow-up edit.
- Dashboard web-terminal scrollback survives heavy agy TUI redraw (nice-to-have; note if it regresses).
