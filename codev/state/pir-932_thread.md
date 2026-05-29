# PIR #932 — vscode: move Pull Requests below Backlog in sidebar

## Plan phase (2026-05-30)

Issue is a one-line array reorder in `packages/vscode/package.json`. Confirmed the
views block lives at `package.json:541-547`; `codev.pullRequests` (543) sits above
`codev.backlog` (544). The swap moves Backlog above Pull Requests so the triage
flow (Builders → Backlog) reads adjacently.

Verified there's no programmatic view-ordering layer — views are contributed
declaratively, so array position is the source of the default order. VSCode persists
user-reordered views per-workspace, so customized users are unaffected.

Plan written to `codev/plans/932-vscode-move-pull-requests-sect.md`. Awaiting
plan-approval gate.
