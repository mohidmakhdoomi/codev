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

## Builder worktree write-guard: deterministic protection against main-checkout pollution (#1018, PR #1098)

Strict-mode builders run in isolated git worktrees nested inside the main checkout. The `Write` / `Edit` tools require absolute paths, so the builder model must synthesize one; the current runtime sometimes anchors that path at the inferred canonical repo root instead of the worktree `cwd`, dropping the `.builders/<id>/` segment. The wrong path is a real writable directory (the main checkout's working tree), so the mis-write succeeds silently. Byte-identical trees at branch base mean wrong-rooted reads succeed silently too, so nothing corrects the model until a later `git add` in the worktree fails with a pathspec error. The polluted file just sits in main's working tree.

This is not a Codev regression; it is intrinsic path-synthesis drift in the builder runtime that moves across model and CLI upgrades. Instructions and per-agent memory do not hold across that drift. Only a deterministic guard does.

The guard ships as a per-worktree Claude Code `PreToolUse` settings hook. At spawn time, the harness generates `.claude/settings.local.json` plus a self-contained Node guard script (`.claude/hooks/worktree-write-guard.cjs`) inside the new worktree. The guard:

- Rejects any `Write` or `Edit` whose absolute path resolves outside the worktree root, naming the worktree root in the rejection message so the model re-roots on the next attempt. Silent main-checkout pollution becomes a loud, correctable failure.
- Allowlists scratch directories (`/tmp`, `/private/tmp`, `$HOME/.claude` for builder memory writes).
- Reads the worktree root from `CODEV_WORKTREE_ROOT` baked at spawn time (absolute), with `git rev-parse --show-toplevel` as the runtime fallback. Both are canonicalised through `realpath` so the macOS `/tmp` versus `/private/tmp` symlink difference is normalised.
- Resolves the longest-existing-ancestor before joining the tail, so paths to non-existent new files canonicalise correctly.
- Fails open on any error (bad JSON, unresolvable root, missing git). A safety net must never brick a builder; worst case reverts to today's unguarded behavior.

Coverage is deterministic across all Claude builder spawn modes: the harness installation runs in both `startBuilderSession` and `buildWorktreeLaunchScript`, in both the role-bearing and no-role branches. The `--resume` path is intentionally excluded, since it reuses an existing worktree already guarded at its original spawn. A throwaway-builder verification matrix at dev-approval confirmed: a Write to the main checkout blocks with a re-root message, a legitimate `/tmp` write passes, a worktree-rooted Write passes and lands in the worktree, a `~/.claude/...` memory write passes, and a genuine sibling-thread cross-checkout read still works (reads are unaffected by this issue).

A role-doc backstop in `roles/builder.md` and `codev-skeleton/roles/builder.md` names the failure mode so the model has a chance to self-correct even when the guard is removed or bypassed. Backstop only; instructions do not hold across model drift.

Scope decision recorded at the plan gate: builder-only. The consult sub-agent read surface (issue #1092) is the architectural cousin of this guard but is intentionally out of scope. The guard module is factored so its boundary logic can later back a consult-side hook without duplication. #1092 stays open as a separate, lower-severity issue (mostly self-healing: the SDK's not-found error includes a cwd note that lets the model re-root, asymmetric to the silent-success path #1018 addresses).

## Tower command relay: external controllers can drive the active VS Code editor (#1087 / #1088 / #1089, PR #1091)

A new Tower-side command channel lets external controllers (a Stream Deck device, a hosted page, a CLI script, anything that can POST to Tower) drive the active VS Code window with a canonical set of verbs. Codev's VS Code extension exposes an allowlist-gated provider that subscribes to a Tower SSE stream and dispatches a small set of verbs to existing commands. This is the substrate that the separate Codev Stream Deck integration sits on; Codev does not ship a Stream Deck client itself, just the protocol surface.

What ships in this PR:

- A new wire contract for `CommandRequest` carrying `{ verb, args, workspace? }`. The verb-map is the security allowlist: only declared verbs reach the provider. Live verb set as of this release includes the four palette-and-keyboard commands listed below plus `view-diff`, `spawn-builder`, `run-dev`, `workspace-dev-start`, and `workspace-dev-stop`.
- A Tower HTTP route `POST /api/command` that broadcasts the request as an SSE envelope to active providers. The route sits behind Tower's existing `isRequestAllowed` auth gate so it inherits Tower's posture rather than bypassing it.
- A VS Code-side provider (`command-relay.ts`) that subscribes to the SSE stream, gates on `vscode.window.state.focused` for single-active-provider semantics (the focused window wins; an unfocused window stays idle), applies workspace scoping (drops events whose `workspace` field doesn't match `getWorkspacePath()`), and dispatches to the existing command via `executeCommand`. The workspace filter mirrors the precedent set by `builder-spawned` cross-workspace handling in `builder-spawn-handler.ts`.
- Four new commands wired into the relay's allowlist plus the command palette plus keyboard surfaces: `codev.forwardCurrentFileToBuilder` (forwards the cursor's current file path to the active builder PTY), `codev.forwardCurrentHunkToBuilder` (forwards the cursor's current hunk), `codev.diffFirstFile` and `codev.diffFirstHunk` (jump to the first file or first hunk in a View Diff session, completing the existing keyboard walk shipped in PR #1067 and PR #1075).
- A shared SSE envelope deduplication helper (`sse-envelope.ts`) so multi-subscriber streams don't double-dispatch.

The workspace-scoping field is defensive infrastructure landed ahead of demand: no controller populates it today, so the focus-gate is the only filter in active use. As soon as a controller starts addressing specific workspaces, the provider already does the right thing without further extension-side code change. The privileged verbs (`spawn-builder`, `run-dev`, `workspace-dev-start`, `workspace-dev-stop`) are safe to ship today because the focus-gate prevents accidental cross-workspace dispatch, and the workspace field is ready when controller-side addressing lands.

CMAP-3 caught and the author addressed two findings at review time: the four new commands now appear in the manifest (so they're palette-discoverable and keybindable, not just relay-callable), and the workspace-scope filter was added as described above (originally the relay was focus-gate-only, which the reviewer flagged as insufficient for multi-workspace setups). The defensive workspace filter is the second-place issue from the reviewer's three-option recommendation, kept in scope because it's separable from controller-side scoping and prevents a real wrong-target risk on the privileged verbs.

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
