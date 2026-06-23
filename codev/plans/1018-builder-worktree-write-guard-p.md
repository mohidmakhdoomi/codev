# PIR Plan: Builder worktree write-guard (deterministic Write/Edit boundary)

## Understanding

A strict-mode builder runs in an isolated git worktree at `.builders/<id>/`, which
is nested inside the main checkout. The `Write`/`Edit` tools require **absolute**
paths, so the builder model must *synthesize* one. The current model/CLI runtime
sometimes anchors that path at the inferred **canonical repo root** instead of its
actual worktree `cwd`, dropping the `.builders/<id>/` segment. Because the worktree
is nested in the main checkout, the wrong path is a real writable directory, so the
mis-write **succeeds silently** — the file lands in the main checkout's working
tree. Byte-identical trees at branch base mean wrong-rooted *reads* also succeed
silently, so nothing corrects the model until a later `git add` in the worktree
fails with a pathspec error.

Per the issue, this is **not a codev code regression** — it is intrinsic
path-synthesis behavior of the builder runtime that drifts across model/CLI
upgrades. Instructions, per-agent memory, and bisects do not hold against a moving
runtime. **Only a deterministic guard holds across versions.** That is the
deliverable.

This plan implements the issue's two-part fix:
1. A **PreToolUse hook on Write/Edit** that rejects absolute paths resolving
   outside the worktree root (the real fix — model-proof, deterministic).
2. A **role-doc backstop** in `roles/builder.md` naming the failure mode (the
   cheap, drift-fragile secondary control).

### Where the relevant code lives (verified)
- `packages/codev/src/agent-farm/commands/spawn-worktree.ts`
  - `startBuilderSession()` (≈724) — builds `.builder-start.sh`, which `cd`s into
    the worktree and launches the bare builder command. **No `--settings` flag.**
  - `writeWorktreeFiles(files, worktreePath)` (≈679) — the existing mechanism that
    writes per-worktree files (used today only for OpenCode's `opencode.json`).
    Uses `writeFileSync` with **no `mkdir`**, and `git update-index --skip-worktree`
    so generated files are not committed.
- `packages/codev/src/agent-farm/utils/harness.ts`
  - `HarnessProvider.getWorktreeFiles?(roleContent, roleFilePath)` (≈44) — optional
    hook for file-based worktree config. **Does not currently receive the worktree
    path.** `CLAUDE_HARNESS` (≈62) does not implement it today.
- `codev/roles/builder.md` and `codev-skeleton/roles/builder.md` — byte-identical
  (8623 bytes); both must be edited (dual-tree mirror rule).
- No `.claude/settings.json` is committed anywhere in the repo; a fresh worktree's
  `.claude/` contains only `skills/`.

## Proposed Change

### Part 1 — Deterministic PreToolUse guard (the real fix)

**Mechanism chosen:** generate a per-worktree `.claude/settings.local.json` plus a
self-contained Node guard script `.claude/hooks/worktree-write-guard.cjs` at spawn
time, via the existing `getWorktreeFiles` → `writeWorktreeFiles` path, routed
through `CLAUDE_HARNESS` (so it respects the harness abstraction and only applies
to Claude builders — `PreToolUse` is a Claude Code concept).

**Why a Node `.cjs` and not bash+jq:** Node is guaranteed present (codev/claude run
on it); `jq` is not. A `.cjs` is portable, has zero runtime deps, and is directly
testable by spawning it with fixture stdin.

**Why generated-into-the-worktree (not symlinked / not `$CLAUDE_PROJECT_DIR`):**
the published npm package must carry the guard so every adopter gets it
automatically. Emitting it from package code (a TS string constant) ships it for
free with no asset-copy build step. The settings file references the script by an
**absolute** path baked at spawn time, removing all ambiguity about the hook's cwd
or `$CLAUDE_PROJECT_DIR` semantics.

**Worktree-root resolution (deterministic, with self-healing fallback):** the
spawn-time generator knows the worktree absolute path, so it bakes it into the hook
command as `CODEV_WORKTREE_ROOT=<abs>`. The guard reads that env var as its primary
source and falls back to `git rev-parse --show-toplevel` (which returns the
worktree, not the main checkout) if the env var is ever absent. The issue suggests
`git rev-parse`; baking the value in is strictly more deterministic, with
`git rev-parse` retained as the documented fallback.

**Guard decision logic:**
1. Read the PreToolUse JSON from stdin; act only on `tool_name` ∈ {`Write`,
   `Edit`}; for any other tool, exit 0 (allow).
2. Read `tool_input.file_path`; if absent, exit 0.
3. Resolve the target to a canonical absolute path **without requiring it to
   exist**: make absolute against the hook's `cwd`, then resolve the longest
   existing ancestor with `fs.realpathSync` and re-append the non-existent tail.
   This handles new files/dirs *and* symlink normalization (macOS `/tmp` →
   `/private/tmp`).
4. Resolve the worktree root the same way (canonicalized).
5. **Allow** if the target is the worktree root or inside it (`root` or
   `root + sep` prefix).
6. **Allow** if the target is inside an allowlisted dir (see below).
7. Otherwise **deny** via the JSON protocol: exit 0 with
   `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny",
   "permissionDecisionReason":"<msg naming the worktree root>"}}`. The reason names
   the worktree root and the offending path so the model re-roots immediately.

**Allowlist (deliberate):**
- Temp dirs: `/tmp`, `/private/tmp`, and `$TMPDIR` (canonicalized) — legitimate
  scratch writes (incl. the session scratchpad under `/private/tmp/...`).
- `$HOME/.claude` — so builder **memory** writes (`~/.claude/projects/<slug>/memory/`)
  and Claude config writes are not blocked. This is the one out-of-worktree write
  builders legitimately perform; it is user config, never the main checkout.

Everything else outside the worktree — crucially the main checkout's `codev/...`,
sibling worktrees, and shared root config reached via symlink — is denied.

### Part 2 — Role-doc backstop

In **both** `codev/roles/builder.md` and `codev-skeleton/roles/builder.md`, add an
invariant that names the *failure mode* (not just "cwd is the worktree"):
- A byte-identical sibling main checkout exists; wrong-rooted reads succeed
  silently and mask the error until a write fails, so absolute paths for Write/Edit
  must be rooted at the worktree.
- Bash `cwd` is the worktree — **prefer relative paths there** (a relative path
  cannot be anchored to the wrong root, closing the Bash surface the Write/Edit
  hook does not cover).

## Files to Change

**New:**
- `packages/codev/src/agent-farm/utils/worktree-write-guard.ts` — exports
  `WORKTREE_WRITE_GUARD_SCRIPT` (the self-contained `.cjs` source as a string,
  single source of truth) and a small `buildWorktreeGuardFiles(worktreeAbsPath)`
  helper returning the `{relativePath, content}[]` for the settings + script.
- `packages/codev/src/__tests__/worktree-write-guard.test.ts` — unit tests that
  write the script to a tmp file and spawn `node` against it with fixture stdin.

**Modified:**
- `packages/codev/src/agent-farm/utils/harness.ts`
  - Extend `getWorktreeFiles?(roleContent, roleFilePath, worktreePath?)` (add the
    worktree path; backward compatible — OpenCode ignores it).
  - Implement `CLAUDE_HARNESS.getWorktreeFiles` to return the guard files via
    `buildWorktreeGuardFiles(worktreePath)`.
- `packages/codev/src/agent-farm/commands/spawn-worktree.ts`
  - `writeWorktreeFiles`: add `mkdirSync(dirname(targetPath), {recursive:true})`
    before writing (needed for `.claude/hooks/`).
  - Pass `worktreePath` to the `harness.getWorktreeFiles(...)` call (≈775).
- `codev/roles/builder.md` — add the backstop invariant.
- `codev-skeleton/roles/builder.md` — identical edit (mirror).

## Risks & Alternatives Considered

- **Risk: false-positive blocks a legitimate out-of-worktree write.** Mitigated by
  the allowlist (`$HOME/.claude` for memory/config; temp dirs for scratch). Reads
  are untouched, so codev's intentional cross-checkout reads (architect reads
  builder threads, sibling-thread reads) keep working. Symlinked shared root config
  (`.codev/config.json`, `.env`) resolves outside the worktree and is **denied** —
  this is judged correct (a builder should not mutate shared root config), but it
  is a behavior change worth a human's eyes at the gate.
- **Risk: non-existent target path breaks realpath.** Mitigated by the
  longest-existing-prefix resolution (resolve the existing ancestor, append the
  tail) rather than realpath on the full path.
- **Risk: `.claude/hooks/` doesn't exist → `writeFileSync` throws.** Mitigated by
  adding `mkdir -p` to `writeWorktreeFiles`.
- **Risk: generated files committed into the builder PR.** Mitigated by
  `git update-index --skip-worktree` (already in `writeWorktreeFiles`) and the
  builder's explicit-staging discipline. They sit as untracked infra files
  alongside the existing `.builder-*.{sh,txt,md}` files.
- **Scope limitation: non-Claude harnesses (codex/gemini) get no guard.** Accepted
  — `PreToolUse` is Claude-specific and the bug is observed on Claude. Noted, not
  fixed here.
- **Out of scope: full per-builder filesystem isolation.** Per the issue, this
  fights codev's shared-filesystem model (worktrees share the object DB; codev
  relies on cross-checkout reads + symlinked root config). The right answer for a
  future cloud/sandbox model, not local builders today.
- **Related but out of scope: #1092** (consult `impl-review` sub-agent reads from
  the outer checkout). Same root cause, **read** surface, lower severity
  (self-heals via the SDK's not-found cwd note). A sibling-architect comment
  proposes a unified guard covering both via two call sites; an earlier comment
  argues for keeping them scoped separately. **This plan stays scoped to #1018's
  Write/Edit surface** but factors the guard into `worktree-write-guard.ts` so the
  same logic could later be wired as a `PreToolUse` hook on the consult SDK
  `query()` for #1092. **Decision deferred to the human at the plan-approval gate.**
- **Alternative rejected — bash+jq guard:** `jq` is not guaranteed present.
- **Alternative rejected — symlink a static settings.json from root:** the hook
  command needs the per-builder worktree root; a static file cannot carry it, and
  it would not ship to adopters.
- **Alternative rejected — `$CLAUDE_PROJECT_DIR`-relative command:** its resolution
  vs `cwd` is not guaranteed; the baked absolute path is unambiguous.

## Test Plan

**Unit (`vitest`, run from the worktree):** write `WORKTREE_WRITE_GUARD_SCRIPT` to a
tmp `.cjs`, create a fake worktree dir, spawn `node tmp.cjs` with fixture stdin and
assert exit/stdout:
- Write **inside** the worktree → allow (exit 0, no deny JSON).
- Write to a **main-checkout path outside** the worktree (e.g. the worktree's
  parent `/codev/plans/x.md`) → **deny** (deny JSON, reason names the worktree root).
- Write to a **new nested** file whose parent dir does not yet exist, inside the
  worktree → allow (longest-prefix resolution).
- Write to `/tmp/...` and `/private/tmp/...` → allow (temp allowlist + macOS
  symlink normalization).
- Write to `$HOME/.claude/projects/.../memory/x.md` → allow.
- `Edit` tool → same as Write.
- Non-Write/Edit tool (e.g. `Bash`) → allow (untouched).
- `CODEV_WORKTREE_ROOT` unset → falls back to `git rev-parse` in a real git
  worktree fixture.
- `buildWorktreeGuardFiles(abs)` returns two files with the expected
  `relativePath`s and a settings file whose hook command references the absolute
  script path + bakes `CODEV_WORKTREE_ROOT`.

**Build/typecheck:** `pnpm --filter @cluesmith/codev build` is clean.

**Manual at the `dev-approval` gate (the real teeth — reviewer runs this):**
spawn a throwaway builder and confirm in its session:
1. A `Write` to a main-checkout path (e.g. `<repo>/codev/plans/zzz.md`) is
   **blocked** with a clear reason.
2. A legitimate `/tmp` (or scratchpad) write **passes**.
3. A genuine sibling-thread / cross-checkout **read** still works (reads unaffected).
4. A memory write under `~/.claude/...` **passes**.
5. A correctly worktree-rooted Write **passes** and the file lands in the worktree
   (`git status` in the worktree shows it; the main checkout is untouched).
