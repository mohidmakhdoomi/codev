# PIR #1018 — Builder worktree write-guard

## Phase: plan (iteration 1)

### What this is
Deterministic PreToolUse guard so a builder's Write/Edit cannot silently land
files in the main checkout (outside its worktree). Root cause is model/CLI
path-synthesis drift, so only a runtime guard holds; instructions are a backstop.

### Investigation findings
- Builder sessions launch via `startBuilderSession()` (spawn-worktree.ts:724) which
  `cd`s into the worktree and runs the bare `claude` command — no `--settings` flag.
- The ONLY existing pattern for injecting per-worktree files is
  `HarnessProvider.getWorktreeFiles()` (harness.ts:44) + `writeWorktreeFiles()`
  (spawn-worktree.ts:679). OpenCode uses it for `opencode.json`.
- `getWorktreeFiles(roleContent, roleFilePath)` currently does NOT receive the
  worktree absolute path → plan extends the signature so the Claude harness can
  bake an absolute hook command path + worktree root.
- `writeWorktreeFiles` writes via `writeFileSync` (no mkdir) → must add mkdir -p
  because `.claude/hooks/` doesn't exist in a fresh worktree (only `.claude/skills/`).
- No committed `.claude/settings.json` in repo → use `.claude/settings.local.json`.
- `roles/builder.md` is byte-identical in `codev/roles/` and `codev-skeleton/roles/`
  (8623 bytes) → backstop edit must mirror both.
- Build is `tsc` only (no asset copy) → emit the guard as a TS string constant
  (single source), unit-tested by writing it to a tmp .cjs and spawning it.

### Key design decisions
- Guard authored as a self-contained Node `.cjs` (portable, no jq dep), emitted
  into `.claude/hooks/worktree-write-guard.cjs`.
- Worktree root baked in via env at spawn time (deterministic) with
  `git rev-parse --show-toplevel` as runtime fallback.
- Allowlist: temp dirs (`/tmp`, `/private/tmp`, `$TMPDIR`) + `$HOME/.claude`
  (so memory + claude config writes still work). realpath both sides (macOS
  `/tmp`→`/private/tmp`).
- Scope: Write/Edit only (reads unaffected → cross-checkout reads preserved);
  Claude harness only (PreToolUse is Claude-specific).
- #1092 (consult read surface) is a SIBLING issue — note the reuse seam, leave
  out of scope, surface to human at gate.

### Status
Plan drafted → awaiting plan-approval gate.
