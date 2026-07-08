# PIR Plan: Stop launchInstance from hijacking unrelated Claude sessions on fresh workspaces

## Understanding

When Tower's `launchInstance` creates the `main` architect for a workspace, it decides between resuming a persisted conversation and spawning fresh. The decision code at `packages/codev/src/agent-farm/servers/tower-instances.ts:489-499` is:

1. Read the stored session id from the `main` architect row in `~/.agent-farm/global.db` (keyed by `workspace_path`). Fresh workspace: no row, so `storedSessionId = null`.
2. If no stored id, run the "legacy bridge" fallback: when `getArchitects(resolvedPath).length <= 1`, call `harness.buildResume(workspacePath)` which is mtime-based jsonl discovery (`findLatestSessionId` in `packages/codev/src/agent-farm/utils/claude-session-discovery.ts`).

The fallback was introduced (#832) to bridge pre-#832 architect rows that exist but carry no `session_id`. But the gate `length <= 1` is satisfied by **zero** rows, so the fallback also fires for a workspace that has *never had an architect at all*: exactly the `codev adopt` / first-touch `launchInstance` case in issue #1145.

`findLatestSessionId` scans `~/.claude/projects/<encoded-cwd>/` for the newest `.jsonl`. Claude Code persists *every* interactive session there, including the user's personal (non-Codev) conversations. So if the user ever chatted with Claude Code in that project directory before adopting Codev, the brand-new "main architect" launches with `--resume <that-conversation>`. Two compounding effects:

- The architect inherits the personal conversation's full context (the "hijack").
- The resume branch of `resolveArchitectLaunch` (`packages/codev/src/agent-farm/servers/tower-utils.ts:223-230`) deliberately skips role injection (a genuinely-resumed architect already has its role in-conversation) — so the hijacked session also never receives the architect role prompt.

There is a second, cross-project vector: `encodeClaudeProjectDir` (`claude-session-discovery.ts:28-30`) replaces both `/` and `.` with `-`, which is lossy. Distinct paths can collide into the same store directory (e.g. `/x/foo.bar` and `/x/foo/bar` both encode to `-x-foo-bar`), so discovery can surface a session that genuinely belongs to a *different project*. The session jsonl records the true `cwd` on its user/assistant lines (verified against a real session file), which gives us an ownership tag to check.

Note: we never pass a bare `--resume` (the "most recent global session" form hypothesized in the issue) — every resume carries an explicit uuid. The hijack mechanism is the discovery fallback firing on fresh workspaces, plus the lossy dir encoding.

## Proposed Change

Two surgical changes, matching the issue's fix sketch:

### 1. Gate the discovery fallback on a pre-existing legacy architect row (tower-instances.ts)

The fallback exists solely to bridge legacy rows (pre-#832: row present, `session_id` NULL). Make the gate express that:

- Read the `main` row once. If it has a `sessionId`, use it (unchanged).
- Run jsonl discovery **only when the `main` row exists** (legacy row with no stored id) **and** it is the sole architect (the existing ambiguity guard).
- No row at all (fresh workspace, the `codev adopt` case) → always spawn fresh with a newly minted session id and role injection.

Degradation note: today the two reads have independent `try` blocks so a `global.db` read failure still allows discovery. With row-existence gating, an unreadable DB means we cannot prove a legacy row exists, so we spawn fresh. That trades a rare resume-miss (context loss on a corrupted DB) for never hijacking — the safe direction.

This does not regress normal stop/start resume: `afx workspace stop` preserves architect rows (`commands/stop.ts:42,98`), so a restarted workspace resumes via the stored-UUID path, not via discovery.

### 2. Verify session ownership before attach (claude-session-discovery.ts + harness.ts + tower-utils.ts)

**Discovery side** — teach `findLatestSessionId` to verify ownership: iterate candidate jsonls newest-first and return the first whose recorded `cwd` matches the requested path. Implementation: read the file's first ~64KB, scan lines for the first record carrying a `cwd` field, compare after `realpath`-canonicalizing both sides. Candidates with a mismatched `cwd` are skipped (encoding collision → not ours); candidates with *no* `cwd` record in the sample (e.g. a session that never got a user message) are skipped too — there is nothing worth resuming in them and skipping is the safe default. This hardens every `buildResume` consumer: the architect legacy fallback and builder resume (#831/#929) alike.

**Stored-id side** — the issue also asks that a passed session id be cross-checked. Add an optional, harness-gated capability alongside the existing `session` block in `HarnessProvider`:

```ts
session?: {
  newSessionArgs(sessionId: string): string[];
  resumeArgs(sessionId: string): string[];
  /** Optional: return false if the session on disk does not belong to cwd. */
  verifyOwnership?(sessionId: string, cwd: string, opts?: { homeDir?: string }): boolean;
}
```

Only Claude implements it: the session file must exist at `~/.claude/projects/<encoded-cwd>/<id>.jsonl` *and* its recorded `cwd` must match (same helper as above). `resolveArchitectLaunch` (tower-utils.ts) calls it before taking the resume branch; on `false` it falls through to the fresh branch (new id, role injection). Because `resolveArchitectLaunch` is the single choke point, this covers `launchInstance`, `add-architect` sibling re-spawn, and both shellper restart-bake sites (via `resolveArchitectRestart`) in one place. Harnesses without `verifyOwnership` keep today's behavior (trust the stored id), preserving harness neutrality.

Side benefit: a stored id whose jsonl was deleted (stale-id class, cousin of #929's crash-loop) now degrades to a fresh spawn instead of a broken `--resume`.

## Files to Change

- `packages/codev/src/agent-farm/utils/claude-session-discovery.ts` — add `sessionFileCwd`-style helper (scan first lines for `cwd`), make `findLatestSessionId` filter candidates by ownership (newest-first, first match wins); export a `verifySessionOwnership(absolutePath, sessionId, opts?)` for the harness.
- `packages/codev/src/agent-farm/utils/harness.ts:68-73,132-135` — add optional `session.verifyOwnership` to the `HarnessProvider` interface; implement it on `CLAUDE_HARNESS` using the discovery helper.
- `packages/codev/src/agent-farm/servers/tower-utils.ts:208-236` — in `resolveArchitectLaunch`, verify `storedSessionId` ownership (when the harness offers it) before the resume branch; on failure log-worthy fall-through to fresh (return `resumed: false`, fresh minted id).
- `packages/codev/src/agent-farm/servers/tower-instances.ts:489-499` — restructure the fallback gate: discovery only when a legacy `main` row exists without a session id and is the sole architect; update the long #832 comment block to document the new gate and the fresh-workspace guarantee.
- `packages/codev/src/agent-farm/__tests__/claude-session-discovery.test.ts` — new cases: mismatched-cwd jsonl skipped; falls back to next-newest matching; no matching candidate → null; cwd-less jsonl skipped; `verifySessionOwnership` true/false paths.
- `packages/codev/src/agent-farm/__tests__/tower-utils.test.ts` — `resolveArchitectLaunch`: stored id failing ownership → fresh spawn with role injection and a *new* session id.
- `packages/codev/src/agent-farm/__tests__/tower-instances.test.ts` — `launchInstance` on a fresh workspace (no architect row) with a decoy jsonl in the encoded project dir → spawn args contain no `--resume`; legacy row without session id + owned jsonl → still resumes (bridge preserved).

No `codev/` ↔ `codev-skeleton/` mirroring needed — all changes are package source (`packages/codev/src`), not framework files.

## Risks & Alternatives Considered

- **Risk: breaking the legacy bridge.** Pre-#832 rows must still self-migrate to stored-UUID resume. Mitigated by keeping discovery for the row-exists-without-id case and adding a regression test for it.
- **Risk: over-strict ownership check drops valid resumes.** A jsonl whose first 64KB lacks a `cwd` line would be skipped. Sampled real session files show `cwd` appears on the first user message (line ~5); sessions with no user message carry no resumable value. Accepted.
- **Risk: realpath comparison surprises with symlinked workspace paths.** Canonicalize both sides with `fs.realpathSync` (falling back to the raw string if realpath throws) so symlink vs. resolved-path launches compare equal.
- **Alternative: only fix the gate (change `<= 1` to row-exists), skip ownership verification.** Rejected: leaves the encoding-collision cross-project vector and the issue explicitly asks for the ownership check.
- **Alternative: verify ownership inside Tower instead of the harness.** Rejected: jsonl layout is Claude-specific; per the harness abstraction rule, agent-specific session mechanics live behind `HarnessProvider`.
- **Alternative: stop skipping role injection on resume.** Rejected: out of scope; genuine resumes already have the role in-conversation, and double-injection would bloat context.

## Test Plan

- **Unit** (vitest, run from the worktree: `pnpm --filter @cluesmith/codev test`):
  - discovery: ownership filtering, next-newest fallback, cwd-less skip, collision skip, `verifySessionOwnership` behavior with a fake `homeDir`.
  - `resolveArchitectLaunch`: stored id failing verification → fresh (new uuid, role args present, `resumed: false`); passing verification → resume unchanged; harness without `verifyOwnership` → resume unchanged.
  - `launchInstance`: fresh workspace + decoy personal jsonl → no `--resume` in spawn args; legacy row bridge still resumes.
- **Manual** (for the dev-approval gate):
  1. Create a scratch project dir (no `codev/`), run `claude` in it briefly so a personal session jsonl exists for that cwd, and exit.
  2. From the scratch dir, trigger the launch path (`codev adopt` then workspace start, or VS Code auto-adopt) against the locally installed build (`pnpm build && pnpm -w run local-install`).
  3. Observe the main architect terminal: it must open a **fresh** conversation (architect role prompt active, no prior chat context), and Tower's log must not print "Resuming architect 'main' …".
  4. Restart the workspace (`afx workspace stop` / `start`): the architect must now resume its *own* stored session (log shows "Resuming architect 'main' session …" with the minted id).
- **Cross-platform**: n/a (server-side Node path handling only; path canonicalization uses `fs.realpathSync` which is platform-neutral).
