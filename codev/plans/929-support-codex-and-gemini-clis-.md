# PIR Plan: Support `codex` and `gemini` CLIs as architects

## Understanding

The harness abstraction (#591) already routes per-CLI role injection for claude/codex/gemini, and builders already run all three engines config-driven. The issue asks to bring **architects** to parity — selectable via `shell.architect` / `shell.architectHarness` in `.codev/config.json`.

The blocking defect is a **latent resume crash-loop for non-Claude harnesses**, present at two sites with one root cause: session-discovery and `--resume` argument construction are hard-coded to Claude's on-disk session store, never gated on the configured harness.

### Root cause (verified)

`findLatestSessionId()` (`packages/codev/src/agent-farm/utils/claude-session-discovery.ts:43`) reads **only** `~/.claude/projects/<encoded-cwd>/*.jsonl`. Two callers feed its result straight into a `<cmd> --resume <uuid>` invocation without checking which CLI `<cmd>` is:

1. **Architect** — `packages/codev/src/agent-farm/servers/tower-instances.ts:500`
   ```ts
   const resumeSessionId = safeToResume ? findLatestSessionId(workspacePath) : null;
   ...
   cmdArgs = [...cmdParts.slice(1), '--resume', resumeSessionId];   // line 507
   ```
   If `shell.architect` is `codex`/`gemini` **and** any prior Claude session exists for that workspace dir (true for anyone who has run Claude Code there — including this repo), `afx workspace start` launches e.g. `codex --resume <claude-uuid>` → invalid invocation → shellper restart-loops (`maxRestarts: 50`, `tower-instances.ts:538`) to death.

2. **Builder** — `packages/codev/src/agent-farm/commands/spawn.ts:83` (`discoverResumeSession()`, called at `:459` and `:838`) returns a Claude UUID on any `--resume`; `packages/codev/src/agent-farm/commands/spawn-worktree.ts:739-751` then bakes `${baseCmd} --resume "${resumeSessionId}"` into the launch script's restart loop. `packages/codev/src/agent-farm/commands/workspace-recover.ts:254` re-enters via `afx spawn <id> --resume`, inheriting the same bug. A resumed codex/gemini builder crash-loops identically. (Fresh builders never take this branch — which is why "builders already prove the path" does not cover resume.)

The fresh-launch paths are already correct: `buildArchitectArgs()` (`tower-utils.ts:176`) and `startBuilderSession()`'s role-injection branch (`spawn-worktree.ts:752-786`) both resolve the harness via `getArchitectHarness` / `getBuilderHarness` (`config.ts:252,267`) and inject per-CLI flags. Siblings (`add-architect`) and reconnect already route through `buildArchitectArgs`. **Only the resume seam is harness-blind.**

## Proposed Change

Add an optional capability to the `HarnessProvider` interface that encapsulates session discovery. Only Claude implements it; every other harness gets a fresh launch.

### 1. New `HarnessProvider` capability (`packages/codev/src/agent-farm/utils/harness.ts`)

Add **one** optional method that bundles discovery + both invocation forms. This mirrors the convention the interface already uses for role injection — `buildRoleInjection()` returns Node argv for `spawn()` call sites (`harness.ts:24`) and `buildScriptRoleInjection()` returns a shell-**escaped** bash fragment (`harness.ts:34`). Bundling discovery and invocation into a single method means the call sites never see an independently-optional second method (no non-null assertion `!`), and the builder bash path gets a pre-escaped fragment instead of word-splitting a raw argv array:

```ts
/**
 * Optional: discover a resumable prior session for the given working dir and
 * return how to resume it — in BOTH forms, mirroring buildRoleInjection /
 * buildScriptRoleInjection:
 *   - args:           Node argv for spawn() call sites (architect / tower-instances)
 *   - scriptFragment: shell-escaped fragment for bash script generation (builder)
 * Returns null when no resumable session exists or this harness has no
 * cwd-keyed session store → callers fall back to a fresh launch. Only Claude
 * implements it (store: ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl).
 */
buildResume?(absolutePath: string, opts?: { homeDir?: string }): {
  sessionId: string;
  args: string[];
  scriptFragment: string;
} | null;
```

`CLAUDE_HARNESS` implements it:

```ts
buildResume: (absolutePath, opts) => {
  const sessionId = findLatestSessionId(absolutePath, opts);
  if (!sessionId) return null;
  return {
    sessionId,
    args: ['--resume', sessionId],
    scriptFragment: `--resume '${shellEscapeSingleQuote(sessionId)}'`,
  };
},
```

`CODEX_HARNESS`, `GEMINI_HARNESS`, `OPENCODE_HARNESS`, and custom harnesses leave `buildResume` **undefined** → callers do `harness.buildResume?.(path) ?? null` → fresh launch. This is the "claude returns the resume invocation; codex/gemini return null" seam the issue and analysis §4.1 call for, with the Node-vs-script split the existing role-injection methods already establish. (Session ids are bare UUIDs so escaping is belt-and-suspenders today, but it keeps the bash path correct-by-construction and consistent with `buildScriptRoleInjection`'s `:769`/`:858` escaping.)

### 2. Architect site (`tower-instances.ts:500-509`)

Replace the unconditional `findLatestSessionId(workspacePath)` with the harness capability (Node-argv form), preserving the existing `safeToResume` sibling-collision guard:

```ts
const architectHarness = getArchitectHarness(workspacePath);
const resume = safeToResume ? (architectHarness.buildResume?.(workspacePath) ?? null) : null;
...
if (resume) {
  cmdArgs = [...cmdParts.slice(1), ...resume.args];
  harnessEnv = {};
  _deps.log('INFO', `Resuming main architect session ${resume.sessionId.slice(0, 8)}… for ${workspacePath}`);
} else {
  const built = buildArchitectArgs(cmdParts.slice(1), workspacePath);
  cmdArgs = built.args; harnessEnv = built.env;
}
```

Update the now-inaccurate "if a prior **Claude** session exists" comment to note the harness gate. (`getArchitectHarness` already resolves from `.codev/config.json` `shell.architect`/`architectHarness`, identical to `buildArchitectArgs`, so a codex/gemini config yields `undefined` → fresh, role-injected launch.)

### 3. Builder site (`spawn.ts:83`, callers `:459`/`:838`; consumed in `spawn-worktree.ts:739-751`)

Thread the builder harness into `discoverResumeSession`, gate on it, and return the bundled resume object (carrying the escaped `scriptFragment`) so the bash generator never re-derives the flag:

```ts
export function discoverResumeSession(
  worktreePath: string,
  isResume: boolean | undefined,
  harness: HarnessProvider,
): { sessionId: string; args: string[]; scriptFragment: string } | undefined {
  if (!isResume) return undefined;
  const resume = harness.buildResume?.(worktreePath) ?? null;
  if (resume) { logger.kv('Session', `${resume.sessionId.slice(0, 8)}… (resuming conversation)`); return resume; }
  logger.info('No prior conversation found for this worktree; starting a fresh session.');
  return undefined;
}
```

Both callers pass `getBuilderHarness(config.workspaceRoot)` and forward the result into `startBuilderSession`, whose `resumeSessionId?: string` param becomes `resume?: { scriptFragment: string }`. In the resume branch (`spawn-worktree.ts:739-751`) the script line becomes `${baseCmd} ${resume.scriptFragment}` — a single pre-escaped fragment, **not** a `.join(' ')` of a raw argv array (which would word-split / comma-stringify). When the harness returns `undefined` (codex/gemini), `startBuilderSession` takes the fresh role-injection path and the `--resume` restart loop is never reached. `workspace-recover.ts` inherits the fix for free (it shells out to `afx spawn --resume`). The existing `buildResumeNotice` prompt still prepends for fresh-launched resumed builders (`spawn.ts:462`).

### 4. Tests — placed at the layer where each bug actually lives

The two crash-loops live in **Tower launch** (`tower-instances.ts`) and **builder script generation** (`spawn-worktree.ts`), so the regression guards must sit there. `af-architect.test.ts` only exercises the no-Tower `afx architect` command (`spawn()` of the local session) — a resume-skip test there would **not** guard the real architect regression. Layering:

- **`packages/codev/src/agent-farm/__tests__/discover-resume-session.test.ts`** (unit, keep — correctly placed) — update calls to pass a harness; add cases asserting `CODEX_HARNESS`/`GEMINI_HARNESS` return `undefined` even when a stale Claude jsonl exists (`buildResume` undefined), and that `CLAUDE_HARNESS` returns `{ sessionId, args:['--resume',id], scriptFragment }` for the newest UUID.
- **`packages/codev/src/agent-farm/__tests__/tower-instances.test.ts`** (exists) — **architect regression guard**: stale Claude jsonl present + codex/gemini architect harness → asserts the launched command is the fresh `buildArchitectArgs` form (role-injected, harness env set) with **no `--resume`** in `cmdArgs`. Claude + stale jsonl → asserts `--resume <id>` is present (resume still works).
- **`packages/codev/src/agent-farm/__tests__/spawn-worktree.test.ts`** (exists) — **builder script-shape guard**: a resumed builder's generated `.builder-start.sh` uses the harness-provided escaped `scriptFragment` (e.g. `--resume '<id>'`), not an unquoted or comma-joined argv; codex/gemini resumed builder → fresh role-injection script, no `--resume`.
- **`packages/codev/src/agent-farm/__tests__/af-architect.test.ts`** — keep Claude-only as is; optionally add codex/gemini `buildArchitectArgs` fresh-launch arg/env construction (codex `-c model_instructions_file=`, gemini `GEMINI_SYSTEM_MD`) as plain coverage, with an explicit note that this file does **not** guard the resume regression (that's `tower-instances.test.ts`).
- Run existing reconnect/sibling tests to confirm no regression (they already route through `buildArchitectArgs`).

### 5. Gemini project-context manifest (promoted to MVP)

A codex architect reads `AGENTS.md` natively for project context; a **gemini** architect ships no `GEMINI.md` (none exists in the repo, nor a `.gemini/` dir), so without help it launches with the injected *role* but no native project *manifesto*. The near-zero-effort fix is `.gemini/settings.json` with `context.fileName` → `AGENTS.md`, which points gemini's context loader at the manifest codex already uses. Promoting from nice-to-have to MVP so gemini doesn't ship context-blind:

- Add an optional `getArchitectFiles?(workspacePath): Array<{ relativePath; content }>` to `HarnessProvider`, parallel to the existing `getWorktreeFiles?` (`harness.ts:44`). `GEMINI_HARNESS` returns `.gemini/settings.json` = `{ "context": { "fileName": "AGENTS.md" } }`. Others omit it.
- The architect launch path (`buildArchitectArgs` in `tower-utils.ts`, or its caller in `tower-instances.ts`) writes these files **only if missing** — never clobbering a user's existing `.gemini/settings.json`. Idempotent and merge-safe.
- Test in `tower-instances.test.ts` (or a small `harness.test.ts`): gemini architect with no `.gemini/settings.json` → file written with `context.fileName: "AGENTS.md"`; pre-existing file → left untouched.

### 6. `doctor` / docs

- No functional `doctor` change needed (`doctor.ts:594` already bars only OpenCode as architect; codex/gemini already pass). Add a short positive affirmation line that codex/gemini are supported architects.
- Document in the relevant resource doc (and CLAUDE.md / AGENTS.md if the architect section warrants it): codex/gemini are supported architects selected via `.codev/config.json` `shell.architect`/`shell.architectHarness`; **conversation resume is Claude-main-only** (codex/gemini architects relaunch fresh with role injection); `.codev/config.json` — not `TOWER_ARCHITECT_CMD`/`--architect-cmd`/`--builder-cmd` — is the supported harness-selection mechanism (see the two override-mismatch caveats in Risks).

### 7. Submit-strategy hook (conditional — decided at the `dev-approval` gate)

MVP item 3 (per-harness submit pacing / bracketed-paste in `message-write.ts`) is **conditional on empirical validation**. The current pacing (`message-write.ts:33` `writeMessageToSession`, tuned to Claude's TUI: single write + delayed Enter for ≤3 lines, line-by-line with 10ms gaps for >3) may or may not deliver cleanly on codex/gemini TUIs. If the human's `dev-approval` testing shows flaky multi-line/interrupt/streaming delivery, add an optional `getSubmitStrategy?()` to `HarnessProvider` and branch the writer on it. If delivery is clean, no change. The seam is designed but not implemented preemptively.

## Files to Change

- `packages/codev/src/agent-farm/utils/harness.ts` — add `buildResume?` (bundled discovery + Node-argv + escaped script fragment) and `getArchitectFiles?` to the interface; implement `buildResume` in `CLAUDE_HARNESS` (delegates to `findLatestSessionId`, returns `args` + escaped `scriptFragment`); implement `getArchitectFiles` in `GEMINI_HARNESS` (`.gemini/settings.json`); import `findLatestSessionId` from `claude-session-discovery.ts`.
- `packages/codev/src/agent-farm/servers/tower-instances.ts:500-514` — gate architect resume on `getArchitectHarness(...).buildResume?.()` (Node-argv form); write `getArchitectFiles?()` if-missing on launch; update comment.
- `packages/codev/src/agent-farm/commands/spawn.ts:83` — `discoverResumeSession` takes `harness`, returns the bundled resume object. `:459`, `:838` — pass `getBuilderHarness(config.workspaceRoot)`, forward object to `startBuilderSession`.
- `packages/codev/src/agent-farm/commands/spawn-worktree.ts:724-751` — `startBuilderSession`'s `resumeSessionId?: string` → `resume?: {...scriptFragment}`; resume branch emits `${baseCmd} ${resume.scriptFragment}`.
- `packages/codev/src/agent-farm/__tests__/discover-resume-session.test.ts` — pass harness; codex/gemini null-return + claude bundled-object cases.
- `packages/codev/src/agent-farm/__tests__/tower-instances.test.ts` — architect resume-skip regression guard (codex/gemini + stale jsonl → no `--resume`); gemini `getArchitectFiles` write-if-missing.
- `packages/codev/src/agent-farm/__tests__/spawn-worktree.test.ts` — builder resume script uses escaped `scriptFragment`; codex/gemini resumed builder → fresh script.
- `packages/codev/src/agent-farm/__tests__/af-architect.test.ts` — (optional) codex/gemini fresh arg-construction coverage; note it does not guard the resume regression.
- `packages/codev/src/commands/doctor.ts` — affirm codex/gemini architect support.
- Docs: a resource doc (e.g. `codev/resources/arch.md` or commands ref) + CLAUDE.md/AGENTS.md note on resume-is-Claude-only + config-driven selection.
- *(Conditional)* `packages/codev/src/agent-farm/servers/message-write.ts` + `harness.ts` — submit strategy, only if `dev-approval` validation reveals flakiness.

## Risks & Alternatives Considered

- **Risk: `harness.ts` importing `claude-session-discovery.ts`.** The latter imports only Node builtins — no circular dependency. Low risk.
- **Risk: `TOWER_ARCHITECT_CMD`/`--architect-cmd` architect-override without matching `.codev/config.json`.** `getArchitectHarness` resolves the harness from config only, so an env-set `codex` with no config still resolves the claude harness → would still attempt resume. This is the issue's explicit **nice-to-have** ("command-aware harness resolution"); MVP fixes the config-driven path (which all acceptance criteria target) and **documents** the override caveat rather than expanding scope.
- **Risk: `--builder-cmd`/builder-env override without matching config — the exact builder analog.** The builder command comes from `getResolvedCommands()` (`spawn.ts:469`/`:840`, honors `--builder-cmd` and env), but the harness comes from `getBuilderHarness(config…)` (config only, `config.ts:267`). Set `--builder-cmd codex` with no `builderHarness`/`shell.builder` config and a resumed builder would still resolve the claude harness and attempt `codex --resume <claude-id>`. Same disposition as the architect override: documented, not fixed (config-driven `shell.builder`/`builderHarness` is the supported selection mechanism).
- **Risk: empirical acceptance criteria can't be unit-tested here.** Launch-on-stale-jsonl, add-architect, `afx send` multiline/interrupt/streaming, reconnect, affinity, dashboard scrollback all need codex/gemini actually installed. These are validated by the human running the worktree at the `dev-approval` gate — the reason PIR (not AIR/BUGFIX) was chosen. The unit tests cover the deterministic core (arg construction + resume-skip logic).
- **Alternative: a boolean `supportsResume` flag + keep `findLatestSessionId` and literal `--resume` at call sites.** Rejected — leaves the Claude-specific discovery *and* the `--resume` flag-shape spread across call sites. A single `buildResume()` returning both the Node-argv and the **escaped** script fragment moves both fully into the provider (mirroring `buildRoleInjection`/`buildScriptRoleInjection`), so no Claude-specific string and no shell-quoting decision survives at the call site.
- **Alternative: two independently-optional methods (`discoverResumeSession` + `buildResumeInvocation`).** Rejected — independent optionality forces a non-null assertion (`!`) at call sites and tempts a raw-argv `.join(' ')` into the bash script (word-splits / comma-stringifies on any arg with whitespace). Bundling them removes the `!` and guarantees the script form is pre-escaped.

## Test Plan

**Unit (run in this worktree, gate-verifiable from the diff):**
- `pnpm --filter @cluesmith/codev test` (or the af test subset) — new/updated `discover-resume-session.test.ts` + `af-architect.test.ts` green; existing reconnect/sibling/architect tests still green.
- Build: `pnpm --filter @cluesmith/codev build` clean (TS types for the new optional method).

**Manual / empirical (reviewer at the `dev-approval` gate, needs codex & gemini installed). For each of codex and gemini set `shell.architect` accordingly in `.codev/config.json`:**
- `afx architect` (no-Tower) launches with role injected.
- `afx workspace start` main architect launches on a **clean** cwd.
- `afx workspace start` main architect launches with a **stale Claude `.jsonl` present** in `~/.claude/projects/<encoded-cwd>/` — must NOT crash-loop (primary regression target). Confirm no `--resume` in the launched command (check the shellper/PTY command).
- `afx workspace add-architect` sibling launches.
- **gemini only**: after launch, `.gemini/settings.json` exists with `context.fileName: "AGENTS.md"` (and a pre-existing one was not clobbered).
- `afx send` delivers + submits: single-line, multi-line (>3 lines, no swallowed Enter), `--interrupt`, and while the TUI is streaming. (If flaky → triggers the conditional submit-strategy work.)
- Tower stop→start reconnect and shellper auto-restart both relaunch the architect.
- A builder spawned by a codex/gemini architect preserves `CODEV_ARCHITECT_NAME` affinity.
- `afx spawn <id> --resume` on a non-Claude builder → fresh launch + resume notice (NOT `--resume <claude-id>`); inspect `.builder-start.sh`.
- Dashboard web-terminal scrollback survives heavy TUI redraw (nice-to-have; note if it regresses).
