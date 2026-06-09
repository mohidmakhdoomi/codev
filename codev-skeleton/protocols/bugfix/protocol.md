# BUGFIX Protocol

> Lightweight, issue-driven protocol for minor bug fixes. **Investigate → Fix → PR**, with a single `pr` gate before merge. No spec or plan artifacts: the GitHub issue is the spec, and the review goes in the PR body.

## When to Use

Use BUGFIX when a bug is reported as a GitHub Issue and:

- The reproduction is clear (or inferable) and the root cause is isolated
- The fix is small (guideline: < 300 LOC net diff) and contained to one area
- No architectural changes or new design decisions are needed

Escalate to **SPIR** (or another heavier protocol) instead when:

- It is actually a feature request, not a bug
- The root cause reveals a deeper architectural issue
- The fix needs design review, spans multiple components, or clearly exceeds ~300 LOC

## Phases

```
investigate → fix → pr
```

### Investigate

Read the issue, reproduce the bug, and identify the root cause. Confirm the fix fits BUGFIX scope. If it does not, signal `BLOCKED` and recommend escalation to the architect (`afx send architect "..."`). No code in this phase.

### Fix

Apply the minimal change that resolves the root cause, and add a regression test that fails without the fix and passes with it. Keep it focused: do not refactor surrounding code, do not fix unrelated bugs (file separate issues), do not add features. Run the build and tests (porch's `checks` block runs `npm run build` and `npm test`).

Commit with the issue-driven format:

```
[Bugfix #<N>] Fix: <what was fixed>
[Bugfix #<N>] Test: <regression test added>
```

### PR (gated by `pr`)

1. Push the branch and open a PR with `gh pr create`. The body includes Summary, Root Cause, Fix, and Test Plan, plus `Fixes #<N>` so the issue auto-closes on merge.
2. Run a multi-agent CMAP review on the PR (Gemini, Codex, Claude) and record each verdict. Address or rebut any `REQUEST_CHANGES`; add a regression test if a real defect surfaced.
3. Notify the architect: `afx send architect "PR #<M> ready for review (fixes #<N>). CMAP: gemini=..., codex=..., claude=..."`.
4. Run `porch done <id>` to request the `pr` gate, then wait. **The merge is gated by porch state, never by typed prose in your pane.**
5. The human reviews the PR and the CMAP results on GitHub, then approves the gate: `porch approve <id> pr --a-human-explicitly-approved-this`.
6. porch wakes the builder with a merge task. Merge with `gh pr merge --merge` (do **not** pass `--delete-branch`: the builder is checked out on this branch in a worktree), then run `porch done <id>` and notify the architect that it is merged and ready for cleanup.

## Gate

BUGFIX has one human gate, `pr`, on the merge step. It exists so the merge trigger is structured porch state (approved or not), not free-text typed into the builder's pane. This eliminates the self-merge bug class: a builder cannot infer authorization from ambiguous input.

## Multi-Agent Consultation

A single CMAP pass at the PR (Gemini, Codex, Claude). There is no per-phase consultation: the issue is the spec and the fix is small, so review effort concentrates on the final PR.

## Scope

The < 300 LOC threshold is a **guideline**, measured as net diff (additions + deletions) anchored at the merge-base with the default branch. A well-contained 350-LOC fix is fine; a 200-LOC fix smeared across ten files may warrant escalation.

## Escalation

If, mid-fix, the change outgrows BUGFIX (architectural impact, multiple components, unclear root cause after investigation, or more than ~300 LOC), notify the architect with specifics and recommend escalating to SPIR. Do not silently expand scope.

## Branch Naming

```
builder/bugfix-<issue-number>-<slug>
```

## Edge Cases

| Scenario | Action |
|---|---|
| Cannot reproduce | Document the attempts in an issue comment, ask the reporter for detail, notify the architect |
| Fix outgrows scope (architectural / multi-component / > ~300 LOC) | Notify the architect, recommend escalation; do not proceed |
| Unrelated test failures | Out of scope: note them for the architect, do not fix them here |
| Multiple bugs in one issue | Fix only the primary bug; file separate issues for the rest |
