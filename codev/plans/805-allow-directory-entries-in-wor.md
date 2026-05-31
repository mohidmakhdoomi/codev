# PIR Plan: Allow directory entries in `worktree.symlinks` via trailing-slash opt-in

Issue: #805 · Area: `area/config`

## Understanding

`worktree.symlinks` in `.codev/config.json` currently accepts **file entries only**.
A directory entry (e.g. `".local-user-data"`) is silently dropped — never symlinked,
never logged.

**Root cause** — `packages/codev/src/agent-farm/commands/spawn-worktree.ts:83-91`:

```ts
for (const pattern of getWorktreeConfig(config.workspaceRoot).symlinks) {
  for (const rel of globSync(pattern, { cwd: config.workspaceRoot, dot: true, nodir: true })) {
    ...
  }
}
```

The `nodir: true` glob flag filters directory matches out before they ever reach
`symlinkSync`. That flag is **intentional**: without it, a pattern like `"apps/auth"`
would symlink the worktree's own source directory back at the parent checkout — the
builder's branch would silently edit the parent's working copy, defeating the point
of `git worktree add`. So the fix must be an **opt-in for directories**, not a blanket
relaxation of the guard.

Goal: let a trailing slash on an entry (`".local-user-data/"`) mean "this is a
directory — symlink it", while every entry without a trailing slash keeps today's
exact behaviour (and the footgun guard).

## Proposed Change

In the `worktree.symlinks` loop of `symlinkConfigFiles`, branch on whether the entry
ends with `/`:

- **No trailing slash** → unchanged. Same `globSync(pattern, { dot: true, nodir: true })`
  loop, same code path. Directories that happen to match are still filtered out — the
  `"apps/auth"` footgun stays guarded.
- **Trailing slash** → strip the slash and treat the remainder as a **literal relative
  path** (no glob expansion). Compute `target = resolve(worktreePath, rel)` and
  `srcAbs = resolve(workspaceRoot, rel)`, keep the `existsSync(target) → continue`
  idempotency check, `mkdirSync(dirname(target), { recursive: true })`, then
  `symlinkSync(srcAbs, target)`.

### Why literal-path, not `globSync(nodir: false)`

Acceptance requires: *"Source not existing at spawn time is non-fatal (dangling link
is acceptable — runtime tooling creates the dir)."* A glob can only ever return paths
that **already exist**, so a globbed directory entry could never produce the dangling
link the use case wants (shannon's `.local-user-data/` is created by runtime tooling,
possibly after spawn). Treating the entry as a literal path lets us create the symlink
unconditionally; if the parent dir doesn't exist yet, the link dangles until runtime
tooling materialises it — exactly the desired behaviour. It is also simpler and more
self-documenting (`foo/` = "symlink this exact directory").

Trade-off: glob metacharacters inside a trailing-slash entry (e.g. `packages/*/data/`)
are **not** expanded — the `*` would be taken literally. The concrete use case is a
single literal directory, and directory-glob expansion is explicitly out of scope.
The implement phase will log a warning if a trailing-slash entry contains glob
metacharacters, so a misconfiguration is visible rather than silently producing a
`*`-named link.

### Cross-platform (Windows)

On POSIX the third `symlinkSync` type argument is ignored, but on Windows a directory
symlink needs `symlinkSync(src, dest, 'dir')`. We pass `'dir'` when the source exists
and is a directory:

```ts
const isDir = existsSync(srcAbs) && statSync(srcAbs).isDirectory();
symlinkSync(srcAbs, target, isDir ? 'dir' : undefined);
```

This is correct on POSIX (type ignored) and correct on Windows for the common case
(source exists at spawn). A dangling Windows dir-symlink (source absent at spawn) is
best-effort — documented, not engineered, matching the existing POSIX-leaning code.

### Sketch

```ts
for (const rawPattern of getWorktreeConfig(config.workspaceRoot).symlinks) {
  if (rawPattern.endsWith('/')) {
    const rel = rawPattern.slice(0, -1);
    if (!rel) continue;                       // guard bare "/"
    const target = resolve(worktreePath, rel);
    if (existsSync(target)) continue;         // idempotent
    const srcAbs = resolve(config.workspaceRoot, rel);
    mkdirSync(dirname(target), { recursive: true });
    const isDir = existsSync(srcAbs) && statSync(srcAbs).isDirectory();
    symlinkSync(srcAbs, target, isDir ? 'dir' : undefined);
    logger.info(`Linked directory ${rel}/ from workspace root`);
  } else {
    for (const rel of globSync(rawPattern, { cwd: config.workspaceRoot, dot: true, nodir: true })) {
      const target = resolve(worktreePath, rel);
      if (existsSync(target)) continue;
      mkdirSync(dirname(target), { recursive: true });
      symlinkSync(resolve(config.workspaceRoot, rel), target);
      logger.info(`Linked ${rel} from workspace root`);
    }
  }
}
```

## Files to Change

- `packages/codev/src/agent-farm/commands/spawn-worktree.ts:83-91` — branch the
  symlinks loop on trailing slash (per sketch above). Add `statSync` to the existing
  `node:fs` import on line 12.
- `packages/codev/src/agent-farm/types.ts:202-208` — extend the `symlinks` field
  JSDoc to document the trailing-slash directory opt-in and the footgun rationale.
- `packages/codev/src/agent-farm/__tests__/spawn-worktree.test.ts` — add `statSync`
  to the `node:fs` mock (line ~22-34, currently inherits the real one via `...actual`);
  add new `symlinkConfigFiles` test cases (see Test Plan).
- `CLAUDE.md` and `AGENTS.md` — in the "Config: the `worktree` block" section, note
  that a trailing slash on a `symlinks` entry opts a directory in (one sentence, kept
  in sync between the two files per their header contract).

Out of scope (per issue): `git check-ignore` auto-detection; shannon's own
`.codev/config.local.json` edit (tracked separately, one line, cross-repo follow-up).

## Risks & Alternatives Considered

- **Risk — footgun re-opened.** Mitigation: the guard only relaxes for entries that
  *explicitly* end in `/`. `"apps/auth"` (no slash) still routes through the
  `nodir: true` glob and is filtered out exactly as today. A test asserts a non-slash
  directory entry produces no symlink.
- **Risk — `statSync` on a missing source throws.** Mitigation: short-circuit with
  `existsSync(srcAbs) &&` before `statSync`, so a dangling-link case never calls
  `statSync`. The `node:fs` test mock gains `statSync` so unit tests don't hit the
  real fs for fake paths.
- **Risk — glob metacharacters in a trailing-slash entry.** A `*` would be taken
  literally and could create a `*`-named link. Mitigation: log a warning when a
  trailing-slash entry contains glob metacharacters; documented as a known limitation.
- **Alternative — `globSync(pattern, { nodir: false })` for slash entries.** Rejected:
  cannot satisfy the dangling-link acceptance criterion (glob only returns existing
  paths) and adds no value for the literal-directory use case.
- **Alternative — `git check-ignore` to auto-detect untracked dirs.** Rejected by the
  issue as out of scope; trailing-slash opt-in is simpler and self-documenting.

## Test Plan

**Unit** (`spawn-worktree.test.ts`, `symlinkConfigFiles` describe block; mirrors the
existing mocked-fs style — no real filesystem):

1. **Directory entry symlinks the dir** — `symlinks: ['.local-user-data/']`, source
   exists & is a directory → `symlinkSync('/projects/test/.local-user-data',
   '/tmp/wt/.local-user-data', 'dir')`, `globSync` **not** called for that entry.
2. **Dangling link when source absent** — `symlinks: ['.local-user-data/']`,
   `existsSync(srcAbs) → false` → `symlinkSync(srcAbs, target, undefined)` still called
   (link created), no throw.
3. **Idempotency** — target already exists in worktree → `symlinkSync` not called.
4. **Non-slash directory entry stays filtered** — `symlinks: ['apps/auth']`, `globSync`
   (nodir:true) returns `[]` → `symlinkSync` not called (footgun guard intact).
5. **File entries unaffected** — existing file-glob tests continue to pass unchanged.

**Build / typecheck**: `pnpm --filter @cluesmith/codev build` and the unit suite green.

**Manual (reviewer, at `dev-approval`)**:
- Add `".local-user-data/"` to a test `.codev/config.json` `worktree.symlinks`, spawn a
  builder, confirm `<worktree>/.local-user-data → <workspaceRoot>/.local-user-data` and
  that a write through the link lands at the parent path.
- Confirm a file-only config still spawns identically (no behaviour change).

**Cross-platform**: POSIX is the primary target (matches existing code). Windows
dir-symlink type is set when the source exists; not separately gated.
