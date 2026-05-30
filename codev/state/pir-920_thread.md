# PIR #920 — vscode: editor-tab webview for rich backlog search

## Plan phase (2026-05-30)

Investigated the codebase before drafting the plan. Key findings:

- **Backlog data has no `body`.** The chain is `issue-list` forge concept (`gh issue list --json number,title,url,labels,createdAt,author,assignees`) → `IssueListItem` (forge-contracts.ts) → `deriveBacklog` → `BacklogItem`/`OverviewBacklogItem`. None carry body. The issue's acceptance requires **title + body** substring search, so body must be sourced. This is the central plan-gate decision.
- **No existing `WebviewPanel` in the extension.** This is the first one. `view-issue.ts` is the closest pattern (read-only content, throttled refresh off `OverviewCache.onDidChange`).
- **Data reaches the extension only via Tower** (`OverviewCache` → `TowerClient.getOverview` → `/api/overview`). The extension never shells out to `gh`; per-issue body is available via `/api/issue` (`issue-view` concept → `getIssue`), but that's one-at-a-time, unusable for live search over 200 issues.
- **#918 (Quick Pick) has no code yet** — only its porch `status.yaml`. The command name `codev.searchBacklog` is unclaimed; I propose `codev.openBacklogSearch` for this panel to avoid colliding with #918.
- Existing pure-helper pattern: `views/backlog-filter.ts` (vscode-free, vitest-tested). Issue's skeleton says extend it for multi-filter — so **filtering runs host-side in pure helpers**, webview sends debounced criteria, host posts back rows. Matches the stated test plan.

Plan written to `codev/plans/920-vscode-editor-tab-webview-for-.md`. Central gate decisions surfaced: (1) body source — overview field+truncate vs dedicated endpoint; (2) Status dropdown in v1 (closed search is out-of-scope); (3) command name; (4) age format; (5) whether typed `area/...` filters by area.

### Gate feedback round 1 (2026-05-30)
Reviewer chose **Option B** for body source — a dedicated `GET /api/backlog-search` endpoint (fresh fetch, full body, no overview caching/truncation). `/api/overview` + `OverviewBacklogItem` untouched; filtering still host-side (endpoint hit once on open/refresh, not per keystroke). Decisions 3/4/5 confirmed as-recommended. Plan revised accordingly. **Decision 2 (Status: functional Open/Closed/All vs Open-only) still open** — Option B makes a functional Status dropdown cheap; awaiting reviewer's a/b pick. Gate still pending.

### Gate feedback round 2 (2026-05-30)
Reviewer chose **(a)**: functional Status dropdown (Open/Closed/All), default Open. `/api/backlog-search` takes a `state` param → `gh issue list --state`. Note: Closed/All lift the PR-exclusion filter (closed issues usually have a merged PR). Status is the one criterion that re-hits the endpoint; all other filters stay host-side/instant. All five decisions now resolved. Plan finalized. Gate still pending approval.
