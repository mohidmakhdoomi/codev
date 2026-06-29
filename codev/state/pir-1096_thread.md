# PIR #1096 — vscode: codev.openIssueByNumber + Cmd+K I

## Plan phase (2026-06-30)

Investigated the VSCode extension. Key findings:

- `codev.viewBacklogIssue` (`src/commands/view-issue.ts`) is the canonical open-preview path; `viewBacklogIssue()` fetches via `client.getIssue(id, workspacePath)` and renders a read-only `codev-issue:` markdown preview with deterministic column placement (`pickIssuePreviewColumn`). It already handles the connection check and the null-issue case (shows `Could not load issue #N (forge unavailable?)`).
- `codev.searchBacklog` (`src/commands/search-backlog.ts`) is the existing Quick Pick; on selection it delegates to `codev.viewBacklogIssue`. New command should follow the same delegation pattern.
- `client.getIssue` (`packages/core/src/tower-client.ts:347`) returns `IssueView | null` — null for BOTH not-found and transport failure. Cannot distinguish a 404 from a forge-down, so an assertive "not found in this repository" message would over-claim.
- Codev K-prefix keybindings: `cmd+k a` openArchitectTerminal, `cmd+k d` sendMessage, `cmd+k g` approveGate, `cmd+k b` forwardSelectionToBuilder. `cmd+k i` is free. (Issue text mislabels `cmd+k a` as addArchitect — actually openArchitectTerminal; immaterial.)
- Unit tests: pure-logic units live in `src/__tests__/**/*.test.ts` (vitest, `vi.mock('vscode')` pattern, see command-relay.test.ts). `src/test/` is the Electron vscode-test suite.
- This is product code (single source) — no codev-skeleton mirror needed.

Plan written to `codev/plans/1096-vscode-codev-openissuebynumber.md`. Awaiting plan-approval gate.

Key plan-gate recommendation: delegate the open path entirely to `codev.viewBacklogIssue` (DRY, identical placement) and keep its existing null message rather than asserting "not found" we can't verify. PRs (decision #4): recommend NO for v1 (issues only).
