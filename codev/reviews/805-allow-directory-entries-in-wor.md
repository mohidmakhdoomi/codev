# PIR Review: Allow directory entries in `worktree.symlinks` via trailing-slash opt-in

Fixes #805

## Summary

`worktree.symlinks` previously accepted file entries only — directory entries were
silently dropped because the spawn-time symlink loop globbed with `nodir: true`. This
change adds a **trailing-slash opt-in**: an entry like `".local-user-data/"` is treated
as a literal path and symlinked into each new worktree whole, so builders can share a
gitignored runtime-state directory with the parent checkout instead of re-bootstrapping
it. Entries without a trailing slash keep their exact prior behaviour, preserving the
`nodir: true` guard that stops a glob from masking the worktree's own source.

## Files Changed

(vs merge-base `b4904bf9`, code + docs)

- `packages/codev/src/agent-farm/commands/spawn-worktree.ts` (+58 / -14) — branch the
  symlinks loop on trailing slash; add `pathOccupied()` helper; `statSync`/`lstatSync` imports
- `packages/codev/src/agent-farm/types.ts` (+16 / -) — `symlinks` field JSDoc documents the opt-in
- `packages/codev/src/agent-farm/__tests__/spawn-worktree.test.ts` (+120 / -) — 6 new cases + `node:fs` mock additions
- `CLAUDE.md` (+1 / -1), `AGENTS.md` (+1 / -1) — one-sentence note on the trailing-slash opt-in
- `codev/plans/805-…md`, `codev/state/pir-805_thread.md` — plan + cohort thread (ship with the PR)

## Commits

- `43db7bee` [PIR #805] Symlink directory entries via trailing-slash opt-in
- `be62b59b` [PIR #805] Test directory-symlink opt-in (dir type, dangling, idempotency, footgun)
- `23662e4f` [PIR #805] Document trailing-slash directory opt-in in worktree config
- (plan commits: `d91edb11` draft, `6489bac1` revised — dangling-symlink-safe idempotency)

## Test Results

- `pnpm build`: ✓ pass
- `pnpm test` (porch `tests` check, full suite): ✓ pass (20.5s)
- `spawn-worktree.test.ts`: ✓ 77 passed (6 new)
- Manual verification: human approved the running worktree at the `dev-approval` gate.

New test cases:
1. Directory entry symlinks the dir whole, passing the `'dir'` type
2. Dangling link created when the source directory is absent (no throw)
3. Idempotency — skip when a real target dir already exists
4. Idempotency — skip when a *dangling* link already occupies the target (no `EEXIST`)
5. Non-slash directory entry stays filtered (footgun guard intact)
6. Trailing-slash entry with glob metacharacters → warn + skip

## Architecture Updates

No `arch.md` changes needed. This change extends the behaviour of one existing helper
(`symlinkConfigFiles`) within the already-documented runnable-worktree setup flow; it
introduces no new module, boundary, or pattern. The runnable-worktree config surface
(`worktree.symlinks` / `postSpawn` / `devCommand`) is already described in CLAUDE.md /
AGENTS.md, which this PR keeps in sync.

## Lessons Learned Updates

No `lessons-learned.md` entry added — the one reusable gotcha here is narrow enough to
live in this review rather than the curated lessons file (which MAINTAIN keeps lean):

> **`existsSync` follows symlinks, so it reports `false` for a dangling link** even
> though the link file occupies the path. Any "create a symlink only if absent" guard
> that relies on `existsSync` will throw `EEXIST` on a re-run once a *dangling* link
> exists. Detect the link itself with `lstatSync` (which does not follow it). This
> matters specifically because directory symlinks here are allowed to dangle (the
> source may be created by runtime tooling after spawn) and `afx setup` re-runs the
> setup idempotently.

## Things to Look At During PR Review

- **Literal-path vs glob for trailing-slash entries.** Chosen literal-path because the
  acceptance criterion requires a *dangling* link when the source is absent, and a glob
  only ever matches existing paths. Trade-off: glob wildcards in a directory entry are
  not expanded — `packages/*/data/` would be a literal `*`. Mitigated by a warn-and-skip
  when a trailing-slash entry contains glob metacharacters (`/[*?[\]{}!()]/`).
- **`pathOccupied()` / `lstatSync` guard** — the dangling-link idempotency fix (see
  Lessons). Test case 4 pins it.
- **Windows dir-symlink type** — `symlinkSync(src, dest, isDir ? 'dir' : undefined)`.
  POSIX ignores the type; on Windows it's set only when the source exists at spawn.
  Dangling Windows dir-symlinks are best-effort, matching the existing POSIX-leaning code.
- **Footgun guard preserved** — a non-slash entry resolving to a directory is still
  filtered by `nodir: true` (test case 5).

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder `pir-805` → **View Diff**
- **Run dev server**: `afx dev pir-805` (or VSCode → **Run Dev Server**)
- **What to verify** (maps to the plan's Test Plan):
  - Add `".local-user-data/"` to a test repo's `.codev/config.json` `worktree.symlinks`,
    spawn a builder, confirm `<worktree>/.local-user-data → <workspaceRoot>/.local-user-data`
  - A write through the link lands at the parent path
  - Source absent at spawn → dangling link created, non-fatal
  - A file-only config spawns identically to before (no behaviour change)
