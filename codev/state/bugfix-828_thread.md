# bugfix-828 — strict-mode locator collision

## Investigate

Issue #828: scheduled Dashboard E2E failed because `.work-section:has-text("Recently Closed")` matched **two** sections — the actual Recently Closed section *and* the Backlog section, which renders issue #813 ("vscode: migrate Recently Closed view from sidebar to Codev panel tab") as a row whose title contains the substring "Recently Closed".

`:has-text()` does substring-match across the whole subtree, so any backlog item whose title contains a section heading literal poisons the selector.

Four occurrences of the loose pattern, all in `packages/codev/src/agent-farm/__tests__/e2e/work-view-backlog.test.ts`:

- L77 `Backlog`
- L116 `Backlog`
- L152 `Recently Closed`
- L173 `Recently Closed`

`Backlog` is also vulnerable — any future issue whose title contains "Backlog" would break L77/L116 the same way.

`grep -rn ':has-text' packages/codev/src/agent-farm/__tests__/e2e/` shows no other `.work-section:has-text` matches — the rest of the `:has-text` usage is on tab buttons and `.instance a`, which aren't vulnerable to the same collision.

## Plan

Replace all four with the heading-scoped form:

```ts
page.locator('.work-section:has(h3.work-section-title:text-is("Backlog"))')
```

`:text-is()` matches the exact text content of the heading, not a substring of the section subtree.

## Implement

All four `.work-section:has-text(...)` occurrences in `work-view-backlog.test.ts` replaced with `.work-section:has(h3.work-section-title:text-is("..."))`. Single short comment on the first occurrence explains the workaround (referencing #828). Diff: +60 / -5, test-only.

`porch check` build/tests both pass (after one-time core build to materialize `@cluesmith/codev-core` declaration files in the worktree).

## Review

CMAP-3 all APPROVE:
- Gemini — APPROVE / HIGH
- Codex — APPROVE / MEDIUM
- Claude — APPROVE / HIGH

No KEY_ISSUES from any reviewer. Claude noted `.tab-bar-item:has-text("Work")` uses the same `:has-text` pattern but is safe (button with fixed link text, no dynamic descendants) — verified during sweep.

PR #917 created with CMAP table in body. Architect notified.

## Awaiting

`pr` gate approval from human.
