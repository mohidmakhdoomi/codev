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

Add two optional, paired methods to the interface (per the deep-dive analysis §4.1 recommendation — discovery and invocation both owned by the provider, so the Claude-specific `--resume` flag is never hard-coded at a call site):

```ts
/**
 * Optional: discover a resumable prior session for the given working dir.
 * Returns the session id to pass to buildResumeInvocation(), or null when
 * none exists / this harness has no cwd-keyed session store. Harnesses that
 * leave this undefined are treated as "no resume" → fresh launch.
 * Only Claude implements it (store: ~/.claude/projects/<encoded-cwd>/<uuid>.jsonl).
 */
discoverResumeSession?(absolutePath: string, opts?: { homeDir?: string }): string | null;

/**
 * Optional: given a session id from discoverResumeSession(), return the CLI
 * args that resume it (e.g. claude → ['--resume', sessionId]). Only harnesses
 * that implement discoverResumeSession need this. Keeps the resume flag-shape
 * owned by the provider rather than the call sites.
 */
buildResumeInvocation?(sessionId: string): { args: string[] };
```

- `CLAUDE_HARNESS` implements **both**: `discoverResumeSession` delegates to `findLatestSessionId(absolutePath, opts)`; `buildResumeInvocation` returns `{ args: ['--resume', sessionId] }`.
- `CODEX_HARNESS`, `GEMINI_HARNESS`, `OPENCODE_HARNESS`, and custom harnesses leave **both** undefined → callers coerce discovery `?? null` → fresh launch; `buildResumeInvocation` is never reached for them.

This is the "claude returns the resume invocation; codex/gemini return null" seam the issue and analysis both call for. The two call sites consume the pair: discover an id (null ⇒ fresh), and if non-null, splice in `harness.buildResumeInvocation!(id).args` instead of literal `['--resume', id]`.

### 2. Architect site (`tower-instances.ts:500-509`)

Replace the unconditional `findLatestSessionId(workspacePath)` with the harness capability, preserving the existing `safeToResume` sibling-collision guard:

```ts
const architectHarness = getArchitectHarness(workspacePath);
const resumeSessionId = safeToResume
  ? (architectHarness.discoverResumeSession?.(workspacePath) ?? null)
  : null;
...
if (resumeSessionId) {
  cmdArgs = [...cmdParts.slice(1), ...architectHarness.buildResumeInvocation!(resumeSessionId).args];
  ...
}
```

Update the now-inaccurate "if a prior **Claude** session exists" comment to note the harness gate. (`getArchitectHarness` already resolves from `.codev/config.json` `shell.architect`/`architectHarness`, identical to `buildArchitectArgs`, so a codex/gemini config yields `undefined` → fresh, role-injected launch.)

### 3. Builder site (`spawn.ts:83`, callers `:459`/`:838`)

Thread the builder harness into `discoverResumeSession` and gate on it:

```ts
export function discoverResumeSession(
  worktreePath: string,
  isResume: boolean | undefined,
  harness: HarnessProvider,
): string | undefined {
  if (!isResume) return undefined;
  const found = harness.discoverResumeSession?.(worktreePath) ?? null;
  if (found) { logger.kv('Session', `${found.slice(0, 8)}… (resuming conversation)`); return found; }
  logger.info('No prior conversation found for this worktree; starting a fresh session.');
  return undefined;
}
```

Both callers pass `getBuilderHarness(config.workspaceRoot)`. When the harness returns null, `startBuilderSession` receives `undefined` and takes the fresh role-injection path — so `spawn-worktree.ts:739-751` (the `--resume` restart loop) is naturally never reached for codex/gemini. In the claude resume branch, `startBuilderSession` builds the resume line from `getBuilderHarness(config.workspaceRoot).buildResumeInvocation!(resumeSessionId).args` (joined into the bash script) rather than the literal `--resume "<id>"`, so the flag-shape stays provider-owned. `workspace-recover.ts` inherits the fix for free (it shells out to `afx spawn --resume`). The existing `buildResumeNotice` prompt still prepends for fresh-launched resumed builders (`spawn.ts:462`).

### 4. Tests

- **`packages/codev/src/agent-farm/__tests__/discover-resume-session.test.ts`** — update calls to pass a harness; add cases asserting `CODEX_HARNESS`/`GEMINI_HARNESS` return `undefined` even when a Claude jsonl exists (the regression guard), and that `CLAUDE_HARNESS` still returns the newest UUID.
- **`packages/codev/src/agent-farm/__tests__/af-architect.test.ts`** (currently Claude-only) — add codex/gemini cases for `buildArchitectArgs` fresh-launch arg/env construction (codex `-c model_instructions_file=`, gemini `GEMINI_SYSTEM_MD`), and a resume-skip assertion: with a codex/gemini architect harness, `discoverResumeSession?.()` is undefined ⇒ resume is skipped even with a stale jsonl present.
- Run the existing reconnect/sibling tests to confirm no regression (they already route through `buildArchitectArgs`).

### 5. `doctor` / docs

- No functional `doctor` change needed (`doctor.ts:594` already bars only OpenCode as architect; codex/gemini already pass). Add a short positive affirmation line that codex/gemini are supported architects.
- Document in the relevant resource doc (and CLAUDE.md / AGENTS.md if the architect section warrants it): codex/gemini are supported architects selected via `.codev/config.json` `shell.architect`/`shell.architectHarness`; **conversation resume is Claude-main-only** (codex/gemini architects relaunch fresh with role injection); `.codev/config.json` — not `TOWER_ARCHITECT_CMD`/`--architect-cmd` — is the supported selection mechanism.

### 6. Submit-strategy hook (conditional — decided at the `dev-approval` gate)

MVP item 3 (per-harness submit pacing / bracketed-paste in `message-write.ts`) is **conditional on empirical validation**. The current pacing (`message-write.ts:33` `writeMessageToSession`, tuned to Claude's TUI: single write + delayed Enter for ≤3 lines, line-by-line with 10ms gaps for >3) may or may not deliver cleanly on codex/gemini TUIs. If the human's `dev-approval` testing shows flaky multi-line/interrupt/streaming delivery, add an optional `getSubmitStrategy?()` to `HarnessProvider` and branch the writer on it. If delivery is clean, no change. The seam is designed but not implemented preemptively.

## Files to Change

- `packages/codev/src/agent-farm/utils/harness.ts` — add `discoverResumeSession?` + `buildResumeInvocation?` to interface; implement both in `CLAUDE_HARNESS` (`discoverResumeSession` delegates to `findLatestSessionId`, `buildResumeInvocation` → `['--resume', id]`); import `findLatestSessionId` from `claude-session-discovery.ts`.
- `packages/codev/src/agent-farm/servers/tower-instances.ts:500-509` — gate architect resume on `getArchitectHarness(...).discoverResumeSession?.()`; build args via `buildResumeInvocation`; update comment.
- `packages/codev/src/agent-farm/commands/spawn.ts:83` — add `harness` param; gate on it. `:459`, `:838` — pass `getBuilderHarness(config.workspaceRoot)`.
- `packages/codev/src/agent-farm/commands/spawn-worktree.ts:739-751` — in the claude resume branch, build the resume line from `getBuilderHarness(...).buildResumeInvocation!(id).args` instead of literal `--resume "<id>"`.
- `packages/codev/src/agent-farm/__tests__/discover-resume-session.test.ts` — pass harness; add codex/gemini null-return regression cases.
- `packages/codev/src/agent-farm/__tests__/af-architect.test.ts` — add codex/gemini arg-construction + resume-skip cases.
- `packages/codev/src/commands/doctor.ts` — affirm codex/gemini architect support.
- Docs: a resource doc (e.g. `codev/resources/arch.md` or commands ref) + CLAUDE.md/AGENTS.md note on resume-is-Claude-only + config-driven selection.
- *(Conditional)* `packages/codev/src/agent-farm/servers/message-write.ts` + `harness.ts` — submit strategy, only if `dev-approval` validation reveals flakiness.

## Risks & Alternatives Considered

- **Risk: `harness.ts` importing `claude-session-discovery.ts`.** The latter imports only Node builtins — no circular dependency. Low risk.
- **Risk: `TOWER_ARCHITECT_CMD`/`--architect-cmd` env/CLI override without matching `.codev/config.json`.** `getArchitectHarness` resolves the harness from config only, so an env-set `codex` with no config still resolves the claude harness → would still attempt resume. This is the issue's explicit **nice-to-have** ("command-aware harness resolution"); MVP fixes the config-driven path (which all acceptance criteria target) and **documents** the override caveat rather than expanding scope.
- **Risk: empirical acceptance criteria can't be unit-tested here.** Launch-on-stale-jsonl, add-architect, `afx send` multiline/interrupt/streaming, reconnect, affinity, dashboard scrollback all need codex/gemini actually installed. These are validated by the human running the worktree at the `dev-approval` gate — the reason PIR (not AIR/BUGFIX) was chosen. The unit tests cover the deterministic core (arg construction + resume-skip logic).
- **Alternative: a boolean `supportsResume` flag + keep `findLatestSessionId` and literal `--resume` at call sites.** Rejected — leaves the Claude-specific discovery *and* the `--resume` flag-shape spread across call sites. Pairing `discoverResumeSession` with `buildResumeInvocation` (per analysis §4.1) moves both fully into the provider, which is the cleaner seam. The builder bash path consumes `buildResumeInvocation(id).args` by joining them into the script (`${baseCmd} <args...>`), so no Claude-specific string survives at the call site.

## Test Plan

**Unit (run in this worktree, gate-verifiable from the diff):**
- `pnpm --filter @cluesmith/codev test` (or the af test subset) — new/updated `discover-resume-session.test.ts` + `af-architect.test.ts` green; existing reconnect/sibling/architect tests still green.
- Build: `pnpm --filter @cluesmith/codev build` clean (TS types for the new optional method).

**Manual / empirical (reviewer at the `dev-approval` gate, needs codex & gemini installed). For each of codex and gemini set `shell.architect` accordingly in `.codev/config.json`:**
- `afx architect` (no-Tower) launches with role injected.
- `afx workspace start` main architect launches on a **clean** cwd.
- `afx workspace start` main architect launches with a **stale Claude `.jsonl` present** in `~/.claude/projects/<encoded-cwd>/` — must NOT crash-loop (primary regression target). Confirm no `--resume` in the launched command (check the shellper/PTY command).
- `afx workspace add-architect` sibling launches.
- `afx send` delivers + submits: single-line, multi-line (>3 lines, no swallowed Enter), `--interrupt`, and while the TUI is streaming. (If flaky → triggers the conditional submit-strategy work.)
- Tower stop→start reconnect and shellper auto-restart both relaunch the architect.
- A builder spawned by a codex/gemini architect preserves `CODEV_ARCHITECT_NAME` affinity.
- `afx spawn <id> --resume` on a non-Claude builder → fresh launch + resume notice (NOT `--resume <claude-id>`); inspect `.builder-start.sh`.
- Dashboard web-terminal scrollback survives heavy TUI redraw (nice-to-have; note if it regresses).
