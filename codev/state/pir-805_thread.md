# PIR #805 — Allow directory entries in worktree.symlinks via trailing-slash opt-in

Builder: pir-805 · Protocol: PIR (strict) · Branch: builder/pir-805

## Plan phase (in progress)

**Issue**: `worktree.symlinks` drops directory entries because `symlinkConfigFiles`
globs with `nodir: true`. Add a trailing-slash opt-in so `".local-user-data/"`
produces a directory symlink, while file entries keep current behaviour and the
"can't mask source" footgun guard stays intact for non-slash entries.

**Root cause**: `packages/codev/src/agent-farm/commands/spawn-worktree.ts:83-91`
— the single glob loop uses `nodir: true`, silently filtering directories.

**Design decisions**:
- Trailing-slash entries → treated as a **literal relative path** (not globbed).
  Chosen over `globSync(nodir:false)` because the acceptance criterion requires a
  dangling link to be created when the source doesn't exist yet (glob can't match
  a missing source). Self-documenting: `foo/` means "this exact dir".
- Non-slash entries → unchanged glob path with `nodir: true` (footgun guard kept).
- Cross-platform: pass `'dir'` to `symlinkSync` when the source exists and is a
  directory (`existsSync && statSync().isDirectory()`); POSIX ignores the type arg.
- Keep `existsSync(target) → continue` idempotency in both branches.

**Test impact**: `node:fs` mock in `spawn-worktree.test.ts` needs `statSync` added
(currently inherits real one via `...actual`).

Plan written to `codev/plans/805-allow-directory-entries-in-wor.md`. Awaiting
`plan-approval` gate.

### Plan revision 1 (reviewer Q: "what if a folder already exists at the destination?")

Surfaced a real gap: `existsSync(target)` follows symlinks, so a **dangling**
dir-symlink reads as absent → a `afx setup` re-run would call `symlinkSync` again and
throw `EEXIST`. Since dangling links are a supported case AND `afx setup` is
idempotent-by-design, this path is real. Fix: added a `pathOccupied(target)` helper
(`existsSync` OR `lstatSync` succeeds) so any occupied destination — real dir,
resolvable link, or dangling link — is skipped. Never overwrites/merges. Added
`lstatSync` to imports + test mock, plus a dedicated idempotency-on-dangling-link test.
