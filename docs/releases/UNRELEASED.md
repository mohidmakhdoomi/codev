# Unreleased

<!--
  Scratch accumulator for the next release's notes. Renamed to
  vX.Y.Z-<codename>.md at release time (via `git mv`), merged into main
  alongside the version bump.

  Per-PR architect workflow:
    1. cd worktrees/changelog                       # no fetch / no rebase — branches diverge by design
    2. Add the CHANGELOG entry to packages/vscode/CHANGELOG.md under [Unreleased]
       (add the [Unreleased] heading if it's missing — post-release state removes it)
    3. Add the matching release-notes entry to this file under the right section
       (substantive change → its own ## section; small item → Polish; non-vscode → Other fixes)
    4. Commit both files together; plain `git push` (fast-forward, no force)

  Why no rebase: main moves with code merges, docs/vscode-changelog moves with
  changelog/release-notes entries — neither branch touches the other's files
  between releases, so they diverge intentionally and reconcile at release time
  via merge (no conflicts expected). Rebasing on every PR merge rewrites this
  branch's commit hashes and forces force-pushes — pointless churn.
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

## Search Backlog editor-tab webview (#920, PR #957)

The Backlog view's title bar gains a 🔍 icon that opens a new **Search Backlog** editor-tab panel — a full editor-area webview built for exploratory triage where the always-on sidebar tree and the Quick Pick both fall short.

Filter the open backlog by Area, Assignee, and Author (three native-styled dropdowns that AND together); substring-search title **and body** with a debounced live query; sort any column; row click opens the issue and the ↪ inline action references it in the architect chat with `#<id> "<title>"`. A match-count footer reads `N matches found · by-area breakdown`.

Three modes: `Open` (default, mirrors the sidebar's PR-excluded backlog), `Closed` (lifts the PR exclusion since closed issues usually have a merged PR), `All`. The panel is a singleton — re-invoking the command focuses the existing tab instead of stacking duplicates. Themed via CSS variables only, so dark / light / high-contrast all render cleanly without per-theme code.

This panel coexists with the sidebar Backlog tree and the `Codev: Search Backlog…` Quick Pick (#918) rather than replacing either. The sidebar is at-a-glance "what's on my plate"; Quick Pick is muscle-memory "I know it exists, find it, dismiss"; this panel is "scan, filter, sort, refine". Supersedes the closed #906.

## Codev CLI preflight on extension activation (#791, PR #955)

The extension now verifies, on every startup, that the `codev` CLI is installed on `PATH` and at a version at least as new as itself. The probe is fire-and-forget and bounded to 400ms so activation isn't blocked; the result caches for the session. Until #791 this dependency was implicit — a missing or out-of-date CLI surfaced only as a confusing "not connected to Tower" error from deep in the activation path, with no actionable guidance.

Three outcomes branch the UX:

- **OK** — no toast, no walkthrough. A new **Codev CLI** row in the sidebar's Status view shows the detected version with a green check.
- **Missing** — the new `Get started with Codev` walkthrough opens automatically (once per workspace), with three steps: detect (`codev --version`), install (`npm install -g @cluesmith/codev`, with Node ≥20 prereq surfaced), and verify.
- **Outdated** — a warning notification offers `Update via npm` (one-click install in an integrated terminal, with a re-verify that fires only when *that specific terminal* closes with a success exit code), `Open Install Docs`, or dismiss.

The Status row carries a recheck button on `missing`/`outdated` states (intentionally not on the ≤400ms `pending` probe window — a recheck button there is meaningless and would risk a second concurrent `codev --version`). A new `Codev: Recheck CLI` command exposes the same recovery path from the palette. Dismissing the prompt leaves Codev commands registered but no-op'ing with a single "run setup" toast rather than crashing — guarded commands fall through cleanly until the CLI is sorted out.

The walkthrough's Verify step completion keys off `onContext:codev.cliReady`, so a failed recheck doesn't falsely tick the step — only a genuinely successful preflight does.

## Polish

<!--
Smaller vscode items go here as bullets. Same shape as CHANGELOG bullets but
with PR/issue citations and slightly more context:

  - **<Short bold headline>** (#<issue>, PR #<pr>). <One paragraph of context.>

Move out to its own ## section if the entry grows past ~3 sentences.
-->

- **`[new]` prefix on freshly-created backlog rows** (#930, PR #949). Backlog items whose `createdAt` is within the last 24 hours now lead with a `[new]` prefix right after the issue number — e.g. `#930 [new] vscode: mark recently-created...`. The threshold is re-evaluated on every tree render so items naturally lose the prefix as they age past 24h, no per-user state, no manual dismissal. The `OverviewBacklogItem.createdAt` field was already on the wire from earlier work, so this was a pure UI-layer change in `packages/vscode/src/views/backlog.ts` plus a new `backlog-recency.ts` pure helper with vitest coverage. Architect made an in-flight placement call at dev-approval (commit `5ff73ac4`) to lead the row with `[new]` rather than trail it; commit `16cb365c` reconciled the plan and review docs to match the shipped order.
- **`Open Builder Terminal` and `Send Message` Quick Picks show `#<id> <title>`** (#925, PR #951). The two outlier builder pickers (palette commands `Codev: Open Builder Terminal` and `Codev: Send Message to Builder`) previously labelled rows with the internal builder name (e.g. `pir-1333`), while the seven other builder pickers in the extension already used the `#<id> <title>` format. This fix brings the two outliers into line. Mechanical `.map()` change in each picker's source; data was already on the wire via the same `getWorkspaceState` endpoint the canonical pickers consume. Surfaced a follow-up: there's no Send-Message-to-Architect Quick Pick at all — filed as #950.

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
