# PIR Plan: VSCode review-comment polish pass

## Understanding

Issue #857 is a four-part polish bundle on the native VS Code Comments wiring for `codev/{plans,specs}/*.md` (`packages/vscode/src/comments/plan-review.ts`) plus the markdown-only `Codev: Add Review Comment` palette command (`packages/vscode/src/commands/review.ts`):

1. **Default placeholders leak through.** `vscode.comments.createCommentController(...)` is called at `plan-review.ts:41-44` without `controller.options`, so the inline reply input shows generic VS Code copy.
2. **`codev/reviews/*.md` is excluded.** `ELIGIBLE_PATH_REGEX = /\/codev\/(plans|specs)\//` at `plan-review.ts:33` blocks review files. Everything downstream (`refreshDoc`, `submitReviewComment`, `deleteReviewCommentByThread`) is path-agnostic, so the fix is a single regex extension.
3. **Author is hardcoded to `@architect`.** `plan-review.ts:144` writes `<!-- REVIEW(@architect): ${body} -->`; `commands/review.ts:22` writes `syntax.wrap('REVIEW(@architect): ')`. Wrong for multi-human workspaces.
4. **Comments-panel discoverability.** Issue asks us to verify threads aggregate into VS Code's built-in Comments panel; fix the wiring only if they don't.

Related #839 ("Codev:" prefix on submit/delete titles) is **already merged** (commit `607ce43e`, before this branch). No bundling needed.

Out of scope: replies/threading, resolve state, builder-side write convention, gate integration, `snippets/review.json` change.

## Proposed Change

### Fix 1 — Codev-specific input copy

In `activateReviewComments` (`plan-review.ts`), set `controller.options` immediately after construction:

```ts
controller.options = {
  prompt: 'Add review comment',
  placeHolder: 'Type your review comment, then Submit',
};
```

### Fix 2 — Include `codev/reviews/*.md`

Extend the regex at `plan-review.ts:33`:

```ts
const ELIGIBLE_PATH_REGEX = /\/codev\/(plans|specs|reviews)\//;
```

Nothing else changes — `isEligibleDocument`, `refreshDoc`, submit, and delete all consult this single predicate.

### Fix 3 — Author from `OverviewData.currentUser` (with `architect` fallback)

The issue copy proposes reading `git config user.name`, but Codev already has a richer identity mechanism: `OverviewData.currentUser` (sourced via the `user-identity` forge concept, default `gh api user --jq .login`). It's already consumed by `BacklogProvider` (`packages/vscode/src/views/backlog.ts:43-45`) for the "assigned to you" sort and rides on Tower's existing 60s + SSE overview refresh — no extra subprocess from the extension.

This is strictly better than `git config user.name` for REVIEW markers:
- It's the **GitHub login**, which matches `@mentions` in issue threads (REVIEW markers are semantically @mentions of a reviewer)
- Already cached and refreshed by Tower
- Single source of truth — git `user.name` and GitHub login routinely diverge (people use display names in git; `@mentions` need the login)
- Zero new subprocess calls from the VSCode side

**Plumbing:** `overviewCache` already exists at the call site for `activateReviewComments` (`extension.ts:638`) and at the registration of `codev.addReviewComment` (`extension.ts:617`). Thread it through:

- `activateReviewComments(context, overviewCache)` — store `overviewCache` in closure, read `cache.getData()?.currentUser` inside `submitReviewComment` at the moment of writing.
- `addReviewComment(overviewCache)` — same pattern. The command registration becomes `() => addReviewComment(overviewCache)`.

Read-at-write (not read-at-activate) is the right shape because Tower can refresh `currentUser` mid-session (config change, SSE update); read-at-activate would freeze a stale value. The lookup is a synchronous in-memory cache hit — no perf concern.

Wire it into both call sites:

- `plan-review.ts:144` →
  ```ts
  const author = overviewCache.getData()?.currentUser ?? 'architect';
  const commentLine = `${indent}<!-- REVIEW(@${author}): ${body} -->`;
  ```
- `commands/review.ts:22` →
  ```ts
  const author = overviewCache.getData()?.currentUser ?? 'architect';
  const comment = syntax.wrap(`REVIEW(@${author}): `);
  ```

The fallback to `architect` covers: pre-first-fetch race at extension startup, `gh` unconfigured / unavailable, or no GitHub remote.

The cursor-offset math at `commands/review.ts:29` is unaffected (offset is measured from the *closing* delimiter and is independent of body length).

`addReviewComment` and `submitReviewComment` remain `async`; no signature/return-type changes beyond the extra `overviewCache` parameter. No new files needed.

### Fix 4 — Comments-panel discoverability

VS Code's built-in **Comments** panel (bottom panel, `workbench.panel.comments`) auto-aggregates threads from every registered `CommentController`. The current wiring already calls `controller.createCommentThread(...)` for each parsed REVIEW marker, and `controller.commentingRangeProvider` is set — both are the prerequisites for panel inclusion per the VS Code Comments API contract.

Expectation: threads already appear in the panel; this is a verification-only fix.

If the verification at the `dev-approval` gate shows threads missing, the most likely culprits are (a) the controller needing a non-empty `label` (we pass `'Codev Plan Review'` — already correct) or (b) threads created with collapsed state being filtered (we set `Expanded` — also correct). If verification surfaces a real gap, I'll iterate on the controller wiring before opening the PR.

## Files to Change

- `packages/vscode/src/comments/plan-review.ts`
  - line 33 → extend regex to include `reviews`
  - lines 41-44 → add `controller.options` block after `createCommentController`
  - line 40 → `activateReviewComments(context, overviewCache)` — new parameter
  - line 144 → swap hardcoded `@architect` for `overviewCache.getData()?.currentUser ?? 'architect'`
  - new import for `OverviewCache` (type-only)
- `packages/vscode/src/commands/review.ts`
  - line 7 → `addReviewComment(overviewCache)` — new parameter
  - line 22 → swap hardcoded `@architect` for `overviewCache.getData()?.currentUser ?? 'architect'`
  - new import for `OverviewCache` (type-only)
- `packages/vscode/src/extension.ts`
  - line 617 → `() => addReviewComment(overviewCache)`
  - line 638 → `activateReviewComments(context, overviewCache)`
- *(no change)* `packages/vscode/snippets/review.json` — snippets can't expand commands; `@architect` stays as the template default per the issue's explicit instruction
- *(no change)* `packages/vscode/package.json` — #839 already shipped the `Codev:` prefix

No test file changes planned — the VS Code package's existing test harness covers extension activation; the changes here are user-facing wiring best validated at the `dev-approval` gate by exercising the inline comment flow against a real worktree.

## Risks & Alternatives Considered

- **Risk: `currentUser` is undefined at write time.** Possible during the pre-first-fetch window at extension startup, or if `gh` is unconfigured. Mitigated by the `?? 'architect'` fallback — the user sees the same string as before; nothing breaks.
- **Risk: GitHub login differs from what the user expects to see in REVIEW markers.** Considered acceptable — login is the canonical `@mention` handle and is the same identity Tower uses for "assigned to you" sorting, so it stays consistent across the extension's surfaces.
- **Alternative considered: `git config user.name` (the issue's original suggestion).** Rejected — `OverviewData.currentUser` is the existing project-wide identity mechanism, already cached by Tower, and produces the GitHub login (the right value for `@mention`-shaped markers). Reading `git config` would introduce a second identity source and an unnecessary subprocess.
- **Alternative considered: read at activation and cache locally inside the comments module.** Rejected — `overviewCache` already handles freshness via Tower's 60s + SSE cycle. Read-at-write picks up identity changes mid-session for free.
- **Back-compat:** existing `<!-- REVIEW(@architect): ... -->` markers in committed files keep rendering — `REVIEW_COMMENT_PATTERN` already captures any `@([^)]+)`, not just `@architect`.

## Test Plan

The reviewer will exercise this at the `dev-approval` gate (`afx dev pir-857` against this worktree).

### Build + unit
- `pnpm --filter @cluesmith/codev-vscode build` (or repo-root `pnpm build`) must succeed.
- `pnpm --filter @cluesmith/codev-vscode test` must pass.

### Manual — inline comments (Fix 1, 2)
1. Open any `codev/plans/*.md` file in the worktree → hover a line → confirm the `+` appears.
2. Click `+` → confirm the reply input shows **"Type your review comment, then Submit"** (Fix 1), not VS Code's default.
3. Type a comment → Submit → confirm a `<!-- REVIEW(@<your-github-login>): ... -->` marker is written on the next line (Fix 3 — author should be your GitHub login from `gh api user --jq .login`, not `architect`, unless `gh` is unconfigured or Tower hasn't done a first fetch yet).
4. Repeat (1)-(3) against a `codev/specs/*.md` file → same behavior.
5. **New for Fix 2**: repeat (1)-(3) against a `codev/reviews/*.md` file (e.g. any committed review under `codev/reviews/`) → confirm `+` appears and submitted comment lands inline.

### Manual — palette command (Fix 3, second call site)
6. Open any markdown file → cmd+shift+P → "Codev: Add Review Comment" → confirm the inserted comment uses your GitHub login as author.

### Manual — back-compat (Fix 3 regression check)
7. Open a file that already contains `<!-- REVIEW(@architect): ... -->` markers (any committed plan with prior review comments) → confirm threads render as collapsed comment UI exactly as before (the regex matches any `@<name>`).

### Manual — delete flow (regression check)
8. Hover an inline-rendered review thread → click trash icon → confirm the REVIEW line is removed from the file.

### Manual — Comments panel (Fix 4 verification)
9. Open the **Comments** panel (View → Open View → Comments, or `workbench.panel.comments`).
10. Open a plan/spec/review file containing REVIEW markers → confirm the threads appear in the Comments panel grouped under "Codev Plan Review".
11. If they don't appear, surface findings at the `dev-approval` gate so we can decide whether to iterate or accept the no-op finding (documented in the review file's "Comments panel aggregation" note).

### Cross-platform
None — VS Code extension, behaves identically across OS for these changes. No subprocesses introduced.
