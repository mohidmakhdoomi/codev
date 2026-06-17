# Unreleased

<!--
  TEMPLATE — copy to docs/releases/UNRELEASED.md at the start of each release cycle:

      cp docs/releases/UNRELEASED.template.md docs/releases/UNRELEASED.md

  Edit UNRELEASED.md across the cycle (the working copy). NEVER edit this
  template directly — it's the cold-start structure, untouched between cycles.

  Per-PR architect workflow (on the docs/vscode-changelog branch):
    1. cd worktrees/changelog                       # no fetch / no rebase — branches diverge by design
    2. Add the CHANGELOG entry to packages/vscode/CHANGELOG.md under [Unreleased]
       (add the [Unreleased] heading if it's missing — post-release state removes it)
    3. Add the matching release-notes entry to UNRELEASED.md under the right section:
         substantive change → its own ## section
         small vscode item  → Polish
         non-vscode change  → Other fixes
    4. Commit both files together; plain `git push` (fast-forward, no force)

  Why no rebase, ever: main moves with code merges, docs/vscode-changelog moves
  with changelog/release-notes entries — neither branch touches the other's
  files, so they diverge by design and reconcile at release time via merge.
  Rebasing rewrites commit hashes and forces force-pushes for zero real benefit.

  At release time:
    1. Rename the title to `# vX.Y.Z <Codename>` and add `Released: YYYY-MM-DD`
    2. Replace this entire comment block with the release Summary paragraph
       (one paragraph framing what shipped — lead with the biggest story)
    3. Fill in the Contributors section at the bottom
    4. git mv docs/releases/UNRELEASED.md docs/releases/vX.Y.Z-<codename>.md
    5. Commit, plain push, merge to main alongside the version bump
    6. Re-cp the template back to UNRELEASED.md to start the next cycle
-->

## Cross-file navigation in the Codev View Diff session (#1060, PR #1067)

Two new commands, `codev.diffNextFile` and `codev.diffPreviousFile`, walk a builder's changed-file list and open the next or previous file's per-file diff. Bound to `Ctrl+Alt+]` / `Ctrl+Alt+[` by default and palette-discoverable; the keybindings are scoped via a new `codev.activeEditorIsBuilderFile` context key so they only fire while the active editor is a Codev builder-file diff, not in unrelated VS Code diff editors. The keyboard equivalent of clicking the next file row in the Builders sidebar, taken from GitHub PR review's `j` / `k` muscle memory.

The implementation deliberately reuses already-shipped machinery: the `BuilderDiffCache` that backs the Builders sidebar's changed-file list provides the ordered list (so navigation order matches what the sidebar shows), the diff-inject registry provides the "currently shown" position, and each step opens through the existing per-file `vscode.diff` path. No change to how `codev.viewDiff` itself opens.

The nav anchor is seeded on **every** open (sidebar click, `viewDiff`, programmatic open), not just after a navigation step, so a deleted or binary file opened directly from the sidebar is a valid starting point for a walk. The first cycle's CMAP-3 caught this edge case (deleted / binary files lack a `file:` right-side document and so are absent from the diff-inject registry); the fix is a small `recordDiffNavPosition` call from the `codev.openBuilderFileDiff` handler with a matching regression test.

A residual narrower edge is documented as a follow-up (#1066): focusing a deleted file *inside* the multi-file View Diff editor without a prior open or nav still can't seed the anchor, because `viewDiff` only registers `file:`-kind right sides. Sidebar-open path is fixed; the in-editor focus path is the sidebar-selection-sync follow-up.

## Polish

<!-- Small vscode items as bullets:
       - **<Headline>** (#<issue>, PR #<pr>). <One short paragraph of context.>
     Move out to its own ## section if the entry grows past ~3 sentences. -->

## Other fixes (dashboard, porch, infrastructure)

<!-- Non-vscode work that ships in the npm release. Same bullet shape as Polish. -->

## Breaking changes

None.

## Install

```bash
npm install -g @cluesmith/codev@X.Y.Z
afx tower stop && afx tower start
```

The VS Code extension ships separately via the Marketplace — `Codev` extension by `cluesmith.codev`, version `X.Y.Z`.

## Contributors

<!-- Filled at release time. Use the topic-first voice from prior release notes:
       - **<Name> (@<handle>)** — <topic>: <what they did across which PRs>.
       - Builders working under AIR / BUGFIX / PIR / SPIR protocols across the PRs in this release.
     Source: git log v<prev>..HEAD --merges --pretty=format:"%h %an %s" -->
