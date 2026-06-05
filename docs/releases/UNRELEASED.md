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

## Web terminal stops on dead sessions almost instantly (#971, PR #992)

When Tower restarts or otherwise loses a session, the dashboard's web terminal used to spend the full 6-attempt backoff (~60s) blindly retrying before giving up, because a browser can't read a failed WebSocket upgrade's HTTP status (it only sees close `1006`). v3.1.7's #961 narrowed the retry budget from 50 to 6 attempts but left the underlying mismatch in place. This release closes the gap: the web terminal now matches VSCode's near-instant give-up behavior.

Tower discriminates browser clients from Node clients via the `Origin` header. Browsers (which always send `Origin`) get an accepted WebSocket upgrade followed immediately by a close with the app-range code `4404`. The core reconnect-policy helper recognises `4404` as a permanent failure, and the dashboard's `onclose` handler fast-paths on it. Node clients (which never send `Origin`) keep the existing HTTP `404` upgrade-rejection path that #936's VSCode fast-path relies on, so there is no regression.

One transient retry is still expected when a session is killed mid-connection: the first drop sees the generic `1006` close (transient → one retry), the reconnect attempt hits `4404` → give up. Matches the VSCode sequence. Total dashboard dead-time for a killed session: roughly one backoff interval (1s), down from ~60s.

A follow-up (#991) tracks the next layer: a stale tab on a pre-restart terminal id can't self-recover because persistent sessions return under a new id after a Tower restart. The give-up signal is now correct; the auto-remount-onto-successor-id affordance is deferred.

## Codev Dev surface: bottom-panel tab + status-bar chip (#921, PR #996)

Two new complementary VSCode surfaces for the single `afx dev` PTY, so a reviewer can see at a glance whether a dev server is running, for which target, and stop or restart it fast without hunting through the terminal dropdown.

The **`Codev: Dev` tab** (the first real view inside #812's bottom-panel container) shows a status header: target name, live-ticking uptime, and best-effort port when derivable from `worktree.devUrls` or `worktree.devCommand`. Title-bar actions for Stop, Restart, Switch Target, and Show / Hide the Codev sidebar. When no dev is running, a placeholder row; when one was running and stopped, a brief "Stopped..." epitaph row.

An **always-visible status-bar chip** (`$(server-process) Dev: <target>`) appears in the bottom bar only while a dev is running, disappearing on stop. Click it to focus the Codev Dev tab. The chip is the at-a-glance signal that survives regardless of which surface you happen to be in.

Both surfaces derive from the single `TerminalManager.onDidChangeDevTerminals` event, so they stay in lockstep automatically. The native `Codev: <name> (dev)` terminal stays as the actual output surface; the new tab and chip coexist with it as status indicators rather than replacing the output. No PTY re-plumbing.

Two implementation details worth a conscious nod, captured as lessons-learned: VSCode's `StatusBarItem.backgroundColor` only honors `errorBackground` / `warningBackground`, not `prominentBackground`, so a "prominent but not alarming" cue uses the foreground (`prominentForeground`) instead. And `$(zap)` now reads as the AI / sparkle glyph in VSCode, so non-AI features want a literal glyph like `$(server-process)`.

## Polish

- **Guarded commands always give feedback now** (#989, PR #995). Clicking a CLI-dependent command (Spawn Builder, Approve Gate, Send Message, and 12 others) while the Codev CLI is missing or outdated used to produce a modal toast on the first click of the session, then go completely silent on every subsequent click for the rest of the session. The first-click modal is unchanged (the `Run Setup` action still works); subsequent clicks now show a brief auto-dismissing status-bar message naming the state and pointing at `Codev: Recheck CLI` as the recovery path. Once a recheck confirms `ok`, the modal-first pattern restarts the next time the state breaks. Implementation factors the feedback dispatch into a reusable `showPreflightFeedback` helper, so #983's Tower-version-divergence work can surface its own state through the same channel without reinventing the suppression logic.
- **New `Codev` tab in the bottom panel** (#812, PR #990). A second view container joins the existing activitybar Codev sidebar, this time docked alongside Problems / Output / Terminal in the bottom panel area. It opens once on first activation for discoverability, then stays out of the way. Initially shows a single placeholder row signposting the upcoming view migrations (Recently Closed, Team, Status) that will populate the panel in follow-up PRs. The activitybar sidebar is unchanged. Constraint worth noting: VS Code provides no positional control for panel view containers, so a new tab lands last and would otherwise spill into the `…` overflow; the one-time globalState-guarded reveal is the only discoverability lever available.

## Other fixes (dashboard, porch, infrastructure)

- **Builders with a merged PR but a still-pending `pr` gate no longer vanish from the dashboard's Needs Attention** (#966, PR #980). After a merge, a builder whose porch `pr` gate hadn't yet been approved silently dropped off both the Needs Attention rows and the Work surface entirely. Its PR had moved to recently-closed (so didn't surface via the open-PRs path), while its still-pending gate was incorrectly read as "ready". They now correctly surface via the gate-row path, matching the human-attention model where a merged-but-gate-pending builder is exactly what needs acknowledgement.
- **`consult -m claude` now bills against the Claude subscription, not the metered Opus API** (#985, PR #986). When both `CLAUDE_CODE_OAUTH_TOKEN` (subscription auth) and `ANTHROPIC_API_KEY` (metered API auth) were set in the environment, consult's Claude subprocess silently picked up the API key, routing all CMAP traffic through the metered API. The consult helper now strips the API-key vars from the subprocess's env copy when an OAuth token is present, so traffic routes via the subscription. CI and key-only environments are unaffected (no OAuth token → API key still used). Reported by an external adopter at roughly $150/day on a heavy dev day before the fix.

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
