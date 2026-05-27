# PIR #857 — VSCode review-comment polish pass

## 2026-05-27 — Plan phase

Investigated the issue and the three files cited (`plan-review.ts`, `commands/review.ts`, `snippets/review.json`). Confirmed:

- Related #839 ("Codev:" prefix) is already shipped (commit `607ce43e`); no bundling needed.
- All four gaps are well-scoped and decoupled.

**Design decision for Fix 3 (author from git)**: introduced a new shared helper `packages/vscode/src/comments/author.ts` with a lazy-memoized `getReviewAuthor()` rather than threading the value through `extension.ts` activation. Two call sites, both already `async` — single source of truth, no activation-path async churn, falls back to `architect` on any failure.

Plan committed and awaiting `plan-approval`.

### Revision 1 — switch author source to `OverviewData.currentUser`

Reviewer flagged that codev already has a project-wide identity mechanism: `OverviewData.currentUser`, sourced via the `user-identity` forge concept (default `gh api user --jq .login`), already consumed by `BacklogProvider` for "assigned to you" sorting. Strictly better than `git config user.name`:

- It's the GitHub login → matches `@mentions` in issue threads (the right semantic for REVIEW markers)
- Already cached by Tower's 60s + SSE overview refresh — no new subprocess from VSCode
- Single source of truth (git config and GitHub login routinely diverge)

Dropped the new `author.ts` helper; thread `overviewCache` into `activateReviewComments` and `addReviewComment` instead. Read-at-write (not read-at-activate) so identity stays fresh through Tower's refresh cycle. Fallback to `'architect'` covers the pre-first-fetch race and unconfigured `gh`.
