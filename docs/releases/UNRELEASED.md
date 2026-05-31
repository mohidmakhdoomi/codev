# Unreleased

<!--
  Scratch accumulator for the next release's notes. Renamed to
  vX.Y.Z-<codename>.md at release time (via `git mv`), merged into main
  alongside the version bump.

  Per-PR architect workflow:
    1. cd worktrees/changelog && git fetch && git rebase origin/main
    2. Add the CHANGELOG entry to packages/vscode/CHANGELOG.md under [Unreleased]
       (add the [Unreleased] heading if it's missing — post-release state removes it)
    3. Add the matching release-notes entry to this file under the right section
       (substantive change → its own ## section; small item → Polish; non-vscode → Other fixes)
    4. Commit both files together; push docs/vscode-changelog
-->

<!-- SUMMARY (filled at release time)
A one-paragraph framing of what shipped in this release. Lead with the biggest story.
-->

<!-- SUBSTANTIVE SECTIONS (added per PR as they land — one ## per significant change or themed cluster)

Section template:

  ## <Title> (#<issue>, PR #<pr>)

  <One or two narrative paragraphs explaining what changed, why, and any
  notable nuance. Use the v3.1.4 / v3.1.6 release notes as voice references.>

-->

## Polish

<!--
Smaller vscode items go here as bullets. Same shape as CHANGELOG bullets but
with PR/issue citations and slightly more context:

  - **<Short bold headline>** (#<issue>, PR #<pr>). <One paragraph of context.>

Move out to its own ## section if the entry grows past ~3 sentences.
-->

- **`[new]` prefix on freshly-created backlog rows** (#930, PR #949). Backlog items whose `createdAt` is within the last 24 hours now lead with a `[new]` prefix right after the issue number — e.g. `#930 [new] vscode: mark recently-created...`. The threshold is re-evaluated on every tree render so items naturally lose the prefix as they age past 24h, no per-user state, no manual dismissal. The `OverviewBacklogItem.createdAt` field was already on the wire from earlier work, so this was a pure UI-layer change in `packages/vscode/src/views/backlog.ts` plus a new `backlog-recency.ts` pure helper with vitest coverage. Architect made an in-flight placement call at dev-approval (commit `5ff73ac4`) to lead the row with `[new]` rather than trail it; commit `16cb365c` reconciled the plan and review docs to match the shipped order.

## Other fixes (dashboard, porch, infrastructure)

<!--
Non-vscode work that ships in the npm release goes here. Same bullet shape
as Polish above.
-->

- **Directory entries in `worktree.symlinks` via trailing-slash opt-in** (#805, PR #947). `worktree.symlinks` previously dropped directory matches silently — the `nodir: true` glob flag intentionally kept a footgun guard against a pattern like `"apps/auth"` symlinking the worktree's source over the parent's. A new trailing-slash form (`".local-user-data/"`) is treated as a literal-path directory symlink; entries without a trailing slash keep their existing file-only behavior (footgun guard intact). Use case: sharing per-worktree runtime state directories (gitignored, intentionally not branch-isolated) so builders boot against the parent's existing state instead of bootstrapping from scratch. Windows handled via `symlinkSync(src, dest, 'dir')`; glob metacharacters inside a trailing-slash entry emit a warning rather than silently mis-expanding.

## Breaking changes

None.

## Install

```bash
npm install -g @cluesmith/codev@X.Y.Z
afx tower stop && afx tower start
```

The VS Code extension ships separately via the Marketplace — `Codev` extension by `cluesmith.codev`, version `X.Y.Z`.

## Contributors

<!--
Filled at release time. Use the topic-first voice from v3.1.6:

  - **<Name> (@<handle>)** — <topic>: <what they did across which PRs>.
  - Builders working under AIR / BUGFIX / PIR / SPIR protocols across the PRs in this release.

Source: git log v<prev>..HEAD --merges --pretty=format:"%h %an %s" tells you who landed what.
-->
