# PIR #956 — vscode lint rule banning bare `vscode.commands.registerCommand`

## Plan phase

Issue asks for a `no-restricted-syntax` ESLint rule enforcing the #791 `reg`/`regCli`
registrar convention.

**Key investigation finding the issue missed**: bare `vscode.commands.registerCommand`
exists at **four** sites in `packages/vscode/src/`, not two:
- `extension.ts:485,487` — the `reg`/`regCli` helper definitions (expected escape hatch)
- `comments/plan-review.ts:120,131` — `codev.submitReviewComment` / `codev.deleteReviewComment`,
  registered in a separate module with no access to the `activate`-scoped helpers. They're
  CLI-independent (local-file review-marker commands, graceful Tower fallback).

Plan decision: repo-wide ban + 4 visible `eslint-disable-next-line ... -- reason` escape
hatches (2 helpers + 2 plan-review commands). Rejected `extension.ts`-only scoping (leaves
new modules unguarded) and refactoring plan-review.ts to share the helpers (closure capture
+ would change guard behavior = runtime change the issue forbids). Flagged the 2 extra
exemptions for human review at the plan-approval gate.

Rule severity = `error` (not `warn` like the rest of the config) so `pnpm lint` actually fails.

Plan file: `codev/plans/956-vscode-lint-rule-banning-bare-.md` (exact name required by
`plan_exists` check: `test -f codev/plans/${PROJECT_TITLE}.md`).

`pnpm install` run (node_modules was missing in fresh worktree) so implement phase can run lint.

Awaiting plan-approval gate.
