# PIR #799 — vscode: builder changed-file rows render grey instead of SCM colors

## Builder thread (pir-799)

### Plan phase — opening

Key discovery on first investigation: **the fix described in the issue body was already implemented and shipped.**

- Commit `0301b7fa "Fix #799: use custom scheme for builder changed-file resourceUri"` already switched `builderFileResourceUri` to the custom `codev-builder-diff:` scheme (v3.1.4).
- Registration (`extension.ts:267`), cache keying (`resourcePath === c.path`, so tree-item URI and decoration map key match), and `onDidChangeDecorations` firing are all correct on paper. Unit tests in `builder-file-tree-item.test.ts` pass — but they only assert URI *shapes* and cache lookups, never actual *rendering*.
- The architect **reopened** the issue (2026-05-29) confirming via fresh screenshot that rows are STILL grey. So the custom-scheme theory in the issue body did NOT solve the visible bug.

Conclusion: the issue body's root-cause analysis is wrong or incomplete. This is now a genuine multi-hypothesis investigation — and a guess-fix already failed once, so the next fix must be confirmed on the *running* extension (exactly why PIR/dev-approval gate fits).

Central open question: when a custom TreeView TreeItem's `resourceUri` uses a NON-`file` scheme, does VSCode apply the FileDecorationProvider's `color` to the label, or only the badge?

Launched a 3-lens parallel investigation workflow (run `wf_7b1f578b-c4b`):
1. VSCode rendering semantics (does label color apply for non-file schemes? authoritative, from vscode source).
2. Code-path audit (timing/race/keying defects unit tests miss).
3. Alternative hypotheses + a definitive live diagnostic for the dev-approval gate.

### Investigation result (workflow wf_7b1f578b-c4b, 4 agents)

The two lead lenses disagreed; synthesis reconciled it decisively:

- **Falsified**: "VSCode doesn't invoke FileDecorationProvider for custom schemes." The badge (`A`/`M`/`D`) and the color come from the **same** `provideFileDecoration` return, rendered as two independent CSS classes (`badgeClassName`, `labelClassName`) in vscode `labels.ts`. A visible badge proves the provider IS invoked for `codev-builder-diff:` and the decoration reaches the renderer. `decorationsService.getDecoration` is scheme-agnostic — no layer inspects the scheme.
- **Therefore**: the prior custom-scheme fix could never have changed the label *color*. It correctly stopped the Git decorator from competing (a real, separate win), but the remaining grey is a **color-value** defect, masked by the first.
- **Root cause (medium confidence)**: `builder-file-decoration.ts:18-26` reuses `gitDecoration.*ResourceForeground` tokens, but `package.json` ships **no `contributes.colors`** (confirmed: contributes keys = commands/menus/snippets/keybindings/viewsContainers/views/configuration). We depend on tokens we don't own resolving to a saturated value in every theme — they resolve near-foreground/grey.

**Recommended fix**: KEEP the custom scheme (reverting re-introduces the intermittent Git-ignored grey). REPLACE borrowed tokens with first-class `contributes.colors` (`codev.builderDiff.*Foreground`) with saturated light/dark/highContrast defaults; point the DECO map at them. Robust to both "token undefined" and "token resolves near-foreground".

**PIR fit**: confidence is medium and unit tests can't render — so the plan is diagnostic-first at the dev-approval gate. The human runs the extension before any PR exists — exactly why PIR was chosen.

Plan v1 committed (`22f30291`), plan-approval gate requested.

### Plan v2 — reviewer feedback flipped the diagnosis (high confidence now)

Reviewer reported the decisive symptom: **correct colors render for a split second, then are instantly overridden by grey.** That flicker disproves the v1 "color value resolves to grey" theory (the SCM tokens clearly DO render) and points at a late grey decoration winning a re-merge.

Targeted source investigation (background agent, microsoft/vscode) confirmed, high confidence:
- The built-in Git decorators (`GitDecorationProvider`, `GitIgnoreDecorationProvider` in `extensions/git/src/decorationProvider.ts`) do **NOT** check `uri.scheme`. They resolve the repo by **path** and run `git check-ignore` on the fsPath. Our `Uri.file(worktreePath/rel).with({scheme})` keeps the real gitignored `.builders/<id>/…` path → Git STILL fires its grey `ignoredResourceForeground` decoration. **The shipped scheme swap was cosmetic.**
- Extensions can't set decoration weight; `mainThreadDecorations.ts` pins all extensions (Git + ours) to `weight: 10`. Merge picks `data.find(d=>!!d.color)` in non-deterministic order. Git's `checkIgnore` resolves on a **500ms debounce** → after our synchronous paint → re-merge → grey wins. Exactly the flicker. (Open vscode issue #187756.)
- Only lever: **URI shape**. A path that doesn't resolve into any open repo → `getRepository(uri)` undefined → Git never fires → ours is the sole colored decoration.

**Revised fix**: keep the custom scheme but build the URI from a **synthetic path** (`path: '/'+rel`, worktree carried in `query: wt=…`). Git can't path-resolve it; basename at the tail still drives the file icon; the query keeps `uri.toString()` unique per builder (cache no longer collides). Dropped the `contributes.colors` work (color value is fine). Diff command uses the item not the URI, so unaffected. New risk: synthetic fsPath breaks any built-in fsPath menu item (revealFileInOS/copyFilePath) — verify the `builder-file` contextValue menu during implement.

Live confirmation at dev-approval: disable the built-in Git extension → flicker should stop on the *current* build (proves Git is the overrider). Then verify the fix gives stable color with Git enabled.

Recommitting plan v2.

### plan-approval APPROVED → implement phase

Plan approved (after reviewer Q&A that strengthened it: the flicker symptom, the "works in codev not shannon" question — both explained by the path→repo→decoration chain and worktree-as-own-repo detection state; the fix is robust to all of it).

Pre-implementation de-risking confirmed:
- No menu item uses the `builder-file` contextValue → no built-in fsPath right-click actions to break.
- `codev.openBuilderFileDiff` (extension.ts:626-631) uses `arg.plan`/`worktreePath`/`baseRef`, never `resourceUri`/`fsPath` → synthetic path is safe for the diff command.

Implementing: synthetic-path `builderFileResourceUri` + updated doc comments + regression tests.

### Implement complete — pausing at dev-approval

Change (1 source file + 1 test file):
- `builder-file-tree-item.ts`: `builderFileResourceUri` now returns `vscode.Uri.from({ scheme: BUILDER_FILE_SCHEME, path: '/'+rel, query: 'wt='+encodeURIComponent(worktreePath) })` — synthetic path so Git's path-based `getRepository` returns undefined and it never decorates these rows. Doc comments rewritten to the real (path-based, not scheme-based) mechanism.
- `builder-file-tree-item.test.ts`: replaced scheme-only assertions with ones that catch this bug class — path is NOT Git-resolvable (no worktree path), basename preserved (icon), worktree recoverable from query, unique per builder; plus a `BuilderFileDecorationProvider` suite asserting a defined color+badge per status.

Verification (correct pnpm commands — porch's generic `npm run build`/`npm test` checks target the CLI package and fail at the monorepo root, unrelated to this change):
- Fresh worktree had NO node_modules (no `worktree.postSpawn` configured) → `pnpm install` + build upstream `@cluesmith/codev-types`/`-core`.
- `pnpm --filter codev-vscode compile` (check-types + lint + esbuild) ✓
- `pnpm --filter codev-vscode test` → **105 passing**, incl. all #799 regression tests ✓

Pausing at `dev-approval`. Reviewer's killer move: run the Extension Dev Host with the Git extension enabled and confirm builder file rows are stably colored (no flash-then-grey); the disable-Git-extension test on the OLD build confirms Git was the overrider.

### dev-approval APPROVED → review phase → PR #942 → pr gate pending

- Wrote `codev/reviews/799-vscode-builder-changed-file-ro.md` (retrospective: Summary/Files/Commits/Tests/Architecture Updates [none]/Lessons Learned/Things to Look At/How to Test).
- Added 2 lessons to `codev/resources/lessons-learned.md` (UI/UX: Git decorator matches by path + weight:10; Debugging: a plausible unverified fix can mask root cause).
- PR #942 opened with review as body (`Fixes #799`), recorded with porch.
- 3-way consultation (single advisory pass): **gemini=APPROVE (HIGH), codex=APPROVE (MEDIUM), claude=APPROVE (HIGH)** — no REQUEST_CHANGES, no KEY_ISSUES.
- Architect notified. **Waiting at `pr` gate** — merge is gated by porch state (`porch approve 799 pr --a-human-explicitly-approved-this`), not pane prose. After approval: verify gate, `gh pr merge --merge`, `porch done --merged 942`, final cleanup notification.
