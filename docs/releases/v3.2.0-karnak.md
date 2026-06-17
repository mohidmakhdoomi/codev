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

## Foundational package for cross-surface markdown artifact review: `@cluesmith/codev-artifact-canvas` (#945, PR #1027)

A new internal workspace package ships at `packages/artifact-canvas/`: a host-agnostic React library for rendering and reviewing Codev markdown artifacts (specs, plans, reviews) across surfaces (VSCode, dashboard, future mobile). Standalone in v1 and not directly visible to end users in this release. Hosts wire it up by implementing three small adapter interfaces (`FileAdapter`, `MarkerAdapter`, `ThemeAdapter`); the VSCode and dashboard integrations land in follow-up cycles.

What's in it:

- **Markdown renderer** with `markdown-it` (`html: false`) plus DOMPurify sanitization. 0-based `data-line` attribution on block tokens enables per-line marker overlay positioning.
- **`ArtifactCanvas` component**: intent-only comment overlay (emits `onAddComment(line)`, never writes markers itself), minimal v1 marker rendering, adapter-driven data flow with request-versioning, warn-once out-of-range handling, and a no-watcher `refreshKey` refresh path. Keyboard-accessible (focusable blocks, Enter/Space, ARIA).
- **Adapter contracts**: three small host-implemented interfaces. `FileAdapter` (read + watch), `MarkerAdapter` (list/add), `ThemeAdapter` (JS-side, off the v1 render path).
- **CSS-variable theming**: 8 `--codev-canvas-*` tokens plus a `./default-theme.css` export. Hosts theme by overriding the tokens; no JS theming on the render path.
- **Dual-format build** (CJS + ESM + `.d.ts`) via `tsup`. React externalized as a peer (`^18 || ^19`).
- **Smoke-test host** under `packages/artifact-canvas/examples/` with a full e2e round-trip test (mouse and keyboard), a Vite dev page, and a comprehensive README.

What it enables in subsequent cycles (already filed):

- **#859** — add review comments from the markdown preview pane (the canvas-powered comment surface in VSCode).
- **#860** — review summary webview aggregating all REVIEW markers.
- **#863** — marker-aware features in the markdown preview.
- **#1036** — raw `<!-- REVIEW -->` HTML-comment rendering (deferred from this PR's visual review; stripping shifts `data-line` accounting and entangles with host serialization).
- **#1029** — package web/native layering decision (filed during review).

Also worth a note: **#1028** — systemic tracker filed during PR review for the "prefer render-time attributes over post-render effect DOM-mutation for anything tests or accessibility tools read synchronously" pattern, surfaced from two CI-only races on this PR (an e2e overlay race and a `tabindex` race). Not a fix in this release; a tracker capturing the principle so future packages and effects in the codebase avoid the same class of race.

End-user-facing release content for this release stays the same; the canvas itself becomes visible when the next cycle's surfaces land on top of it.

## VSCode markdown preview becomes a review surface: `codev.openMarkdownPreview` (#859, PR #1045)

The first VSCode consumer of the `@cluesmith/codev-artifact-canvas` package shipped earlier this cycle in #945. A new `codev.openMarkdownPreview` command opens specs, plans, and reviews in a host-owned `CustomTextEditor` that renders the same canvas surface the dashboard will mount in a later cycle. Reviewing a `.md` artifact no longer means leaving the rendered preview to drop down to raw markdown — hover a rendered block, click the `+`, type your feedback in a quick-input, and a `<!-- REVIEW: author "body" -->` marker lands above the block.

Same on-disk convention as the editor's Comments-API thread, so the two surfaces are bit-compatible: a comment authored from the preview is indistinguishable from one authored in the raw `.md`, and `parseReviewMarkers` resolves both to the same anchor. Stacked markers on the same block all anchor to the block's start (the canvas renders them as a list).

Registered with `priority: "option"` so it never replaces the default `.md` editor or the built-in markdown preview — opt-in via `Reopen With…` or the command palette.

Folded-in rendering fixes that the original plan flagged as out-of-scope and surfaced during dev-approval:

- **`<!-- REVIEW -->` markers no longer render as visible HTML comments in the preview** (#1036). The canvas renderer strips full-line HTML comments before block parsing (fence-aware) with a cleaned→original line map, so markers are invisible AND `data-line` attribution stays correct on the original source lines.
- **Multi-line paragraphs no longer split around marker lines.** Stripping pre-parse means the paragraph rejoins around the removed marker line — previously, the marker on a line inside a block would terminate the markdown-it block prematurely.
- **Safe inline HTML now renders via DOMPurify** (#1042, amends spir-945 decision D7). `<img>`, `<details>`, `<kbd>`, `<table>`, `<sub>`, `<sup>`, etc. are sanitized and rendered. Script tags, event handlers, and `javascript:` / `data:` URLs are stripped — document-supplied JS never executes.

A known limitation for editor-authored comments on continuation lines of multi-line blocks (they anchor to a line with no rendered `data-line` and don't appear in the canvas) is tracked as **#863** — the canvas's richer in-canvas anchoring belongs in the shared package rather than the host. Not data-loss: the marker stays in the file and renders in the editor's Comments-API thread.

## VSCode: terminal renders corrupted on open — replay painted at the wrong width (#1052, PR #1061)

A Codev terminal pane in VSCode could come up corrupted on open: stacked / overlapping status lines, a ghost frame stranded in the scrollback, the cursor landing near the top instead of the prompt. The only workarounds were to resize the window, clear the terminal, or close and reopen the tab — each disruptive.

Root cause came from how VSCode reports a freshly-opened terminal's size: not as a single event, but in two steps roughly 120 ms apart. The terminal-adapter painted Tower's bracketed reconnection replay **immediately at the first, not-yet-final width**. The restored history wrapped at a width the terminal would never actually render at, and the late size correction left the wrong-width frame stranded in scrollback.

Four investigation paths landed in the commit history (three reverted, one shipped):

- *defer-until-sized* — falsified by per-pathway diag logging that proved VSCode always supplies a real size on `open()`. Reverted.
- *post-replay SIGWINCH nudge* — a PTY-side redraw redraws the program's *current frame* but cannot re-wrap xterm's existing scrollback, so it doesn't fix wrong-width history. Reverted.
- *`onDidOverrideDimensions` shrink-then-restore reflow* — caused scroll distortion by churning scrollback wrap flags. Reverted.
- **Buffer-and-flush at settled width** — the actual fix. The adapter holds the bracketed replay in a string (off the live-backpressure budget), debounces on `setDimensions`, and flushes once when the size has gone quiet (`REPLAY_SETTLE_MS = 150`). Mirrors the proven `flushInitialBuffer` approach in the web dashboard. Manual dev-approval verification on macOS confirmed a captured open: the size settled `112 → 114` cols mid-hold, the debounce reset on each event, and the 786 KB replay flushed once at `114` — clean paint, no ghost frame, cursor at the prompt.

A complementary path was prototyped for the original "after window reactivation" framing of #1052: `forceRepaint` triggered by `vscode.window.onDidChangeWindowState`, fanning a SIGWINCH to all managed terminals on refocus. An A/B test (architect-driven) showed no observable difference, so the path **ships off by default** behind a new setting `codev.terminal.repaintOnRefocus`. Retained as an escape hatch because the issue title named window-reactivation, and disconnected/replaying adapters no-op on `forceRepaint`, so it's safe to enable.

The #1047 freeze invariant is preserved: replay stays off the live `MAX_QUEUE` budget, the `pause`/`resume` bracket is intact, and the existing #1047 oversized-replay test was updated to advance past the settle window. Nine new unit tests cover the buffer-and-flush state machine and `forceRepaint`.

**Architecture note that lands with this**: the "terminal reconnect/replay contract (#1047)" subsection in `codev/resources/arch.md` is extended with the client-side rule that a connecting client must hold the bracketed replay and paint it once after the terminal size settles, debounced on size events. This is now a load-bearing part of the replay contract for both clients (VSCode and the web dashboard).

## Markdown preview: inline review-comment cards stop overlaying content; right-edge marker minimap (#863, PR #1056)

Two improvements to the canvas-powered Codev Markdown Preview that shipped in v3.1.8 via #859.

**Inline review-comment cards no longer overlay the targeted block.** The v1 marker rendering anchored comment cards as absolute-positioned overlays at the block's `data-line` y-coordinate, so cards sat on top of the first lines of the block they annotated and hid that content. Comment cards are now inserted *below* the annotated block, pushing subsequent content down by the stack's height. A thin left rule on the card stack ties back to the gutter where the `+` add-comment action lives, preserving the "this comment belongs to that block" visual association. Empty blocks (no comments) render no slot and consume no vertical space.

**Right-edge marker minimap.** A vertical strip on the right edge of the preview shows one colored dot per review comment in the document, positioned proportional to where the comment lives in the preview viewport. Hovering a dot reveals author + first ~80 chars of body. Clicking smooth-scrolls the preview to that comment's card. Hidden entirely on docs with zero comments. Composes with the existing floating TOC; the two surfaces share the right gutter without fighting for space.

**Multi-block markers render correctly.** Source lines that the renderer stamps multiple `data-line` attributes on (list items: both `<ul>` and `<li>` carry the same line; same for blockquotes and table rows) previously got a duplicate card stack per matching DOM node, plus invalid `<ul>` nested directly under `<ul>` markup. The render path now anchors the card stack and the `has-marker` decoration to the *outermost* element per line only (a `decoratedLines: Set<number>` guard), so each comment renders exactly once, attached to the right block. Regression test pins the list/blockquote case explicitly.

Together these complete the preview as a review surface: read the rendered prose, see existing feedback in context (cards under each annotated block), see where feedback is concentrated spatially (right-edge minimap), click to navigate, all without leaving the preview pane.

## Tower + VSCode: terminal-freeze fix from the oversized-replay reconnect storm (#1047, PR #1050)

Builder and architect terminals were becoming non-responsive together after the Tower process accumulated hours of uptime, recoverable only by `afx tower stop && afx tower start`. Root cause was a feedback loop between two existing components.

Full-screen TUIs like Claude Code's UI redraw in place using ANSI escape sequences and emit almost no newlines for the lifetime of an alt-screen session. Tower's `RingBuffer` sized its reconnection buffer by line count, so for a no-newline TUI session the buffer grew unbounded as the partial line filled. The resulting multi-megabyte snapshot overflowed the VSCode client's 1 MB receive budget; the client's response — disconnect and reconnect to re-fetch — pulled the same oversized snapshot again, cycling roughly fourteen thousand times per hour. That CPU loop pegged one core and starved every other terminal's `data` event delivery.

The fix is several coordinated changes:

- **Tower-side `RingBuffer.pushData`** now scans only the incoming chunk (`O(|data|)`, not `O(|partial|)` rescan). The partial line is kept whole — front-trimming corrupts faithful TUI replay because alt-screen state lives in the cumulative stream from alt-screen-enter onward. A new `partialBytes` getter feeds a Tower-side monitor that logs ring-buffer pressure on an interval, so the (now-bounded by session duration only) memory growth is observable.
- **`tower-websocket`** brackets the catch-up replay with `pause`/`resume` control frames so it's paced and excluded from the live-output backpressure path.
- **VSCode `terminal-adapter`** drops live output under overload instead of reconnecting, eliminating the storm. When the client does need to reconnect, it sends `?resume=<lastSeq>` to fetch only the delta on newline-bearing streams (no-newline streams fall back to a full faithful replay). Shortly after attaching, the client forces a guaranteed redraw (mirroring the Tower dashboard's behavior) so the TUI repaints cleanly regardless of replay shape — this is what catches the blank-pane-on-open case where a connect-time resize is a same-size no-op and emits no redraw signal.
- **`PtySession.attachShellper`** is now idempotent: re-attach drops the previous client's `data`/`exit`/`close` listeners, so a stale frame on a detached client can't reach the live buffer.

Net behavior change for users: long-running TUI sessions stay responsive across many days of uptime; a fresh attach to an alt-screen TUI repaints in <1s rather than rendering blank until manual resize. Memory growth for a no-newline session is now observable via the partial-size monitor and rated minor by the originating issue.

A byte-cap on the shellper-side replay buffer was prototyped during dev-approval and reverted because front-trimming corrupted the alt-screen replay; the CPU/storm fix is independent of that cap and works without it. The repaint nudge guarantees correctness on reconnect.

## Code-review feedback: codelens in the unified diff editor injects file / hunk references into the builder PTY (#789, PR #1023)

Architect-side review used to slow down at one specific point: you'd see something in the unified diff editor, want to give the builder targeted feedback about it, switch to the builder PTY, and type the file path and line range by hand into the prompt before adding your actual feedback. The file path was the typing bottleneck — error-prone, slow, and outside the diff editor where your attention already was.

The unified diff editor now carries inline codelens entries that close that gap. Above each file header, `> Send to builder PTY` injects `path/to/file.ts ` into the builder's prompt buffer. Above each hunk header, `> Send to builder PTY (lines N-M)` injects `path/to/file.ts:L42-L58 ` (the new-side line range parsed from the hunk). Enter is never pressed; you add the freeform feedback and submit when ready. The builder is taken from the diff's context, so there's no picker and no mode error.

The same action is bound to `Cmd/Ctrl+K B` for keyboard-first use and is available as a right-click menu entry on builder files in the file tree. Direct PTY write, no `afx send` wrapper — the inject reads as if you typed it. If the builder doesn't have an active terminal, the resolver falls through to the existing terminal-manager open-terminal flow before injecting.

Modelled on the established `codev.referenceIssueInArchitect` pattern that injects `#<id> ` into the architect's prompt on backlog row clicks, extended to the builder side with file and hunk awareness.

## Governance docs go two-tier (hot/cold): short summaries injected into every prompt, deep archives on demand (#987, PR #1034 — by @waleedkadous)

The architecture and engineering-wisdom documents (`arch.md` and `lessons-learned.md`) were the project's institutional memory but couldn't actually serve that role at the agent level: they're too long to inject into every prompt without dominating the context budget, and pointing builders at them by path doesn't work in fresh-install projects where the files don't exist on disk yet.

Spec 987 splits each of the two into a hard-capped HOT tier and a deep COLD tier:

- **HOT tier**: `arch-critical.md` + `lessons-critical.md`. Hard-capped at a small size. Auto-injected into every porch phase prompt AND into CLAUDE.md / AGENTS.md via a managed block (re-rendered by `codev init` / `codev update`, non-clobbering, preserves user content). Each hot file carries a "consult when..." map listing the sections of its cold counterpart.
- **COLD tier**: `arch.md` + `lessons-learned.md`. Reference archives. Not injected automatically; consulted on demand by following the maps in the hot files, during MAINTAIN, or when an investigator searches them.

The materializer that wires this in is `copyHotTierDefaults`, called from init / adopt / update with skip-existing semantics (curated copies are never overwritten). On `codev update` for projects that adopted before this change, the hot files are backfilled from the skeleton.

Producers route new facts and lessons by tier at review time. MAINTAIN polices the caps, displacement (demote to cold when a hot file is full), and cold-document map accuracy. The cap is load-bearing — it's what keeps the hot tier cheap enough to inject everywhere.

This is the foundation that several follow-up issues (cold-tier bootstrap #1012, fresh-install fixes #1011) all build on.

## Framework files reach builders via resolver-aware channels (#1011, PR #1015)

Post-Spec 618, framework files (protocol docs, role docs, templates, framework resource docs) live only in the package skeleton (the four-tier resolver's tier 4) and are not on disk in fresh installs. But several builder-facing consumers still referenced these files by literal `codev/...` path (`cat`, `cp`, "read this file"), which bypasses the resolver and fails for any project where the file hasn't been customized locally.

This is the class fix: it *delivers* the framework files through resolver-aware channels rather than asking the builder to read them by path. Two mechanisms:

- A `{{protocol_reference}}` context variable that inlines the protocol's `protocol.md` fresh at spawn time, via the resolver, so customizations override the skeleton.
- A shared `{{> path}}` include directive resolved on both the spawn channel and the porch phase-prompt channel.

The PR sweeps every literal-path reference, adds a `codev doctor` audit that catches new ones, and writes the convention into the role docs so future authoring stays aligned. The de-staled `bugfix/protocol.md` skeleton (#1013) and the dropped orphaned `experiment/protocol.md` partial template are folded into the same change.

Together with Spec 987's hot-tier materialization (above) and the cold-tier bootstrap (#1012, below), this closes the bulk of the fresh-install class of failure that affected anyone trying `codev init` on a clean project this cycle.

## Polish

<!-- Small vscode items as bullets:
       - **<Headline>** (#<issue>, PR #<pr>). <One short paragraph of context.>
     Move out to its own ## section if the entry grows past ~3 sentences. -->

- **PR sidebar sorts by ownership, with a `(draft)` badge** (#787, PR #1019). The Pull Requests view used to render PRs in arbitrary forge order with no fast scan-path to the ones you'd authored or were asked to review, and no way to distinguish drafts. It now groups into one flat list ordered mine → review-requested → others, newest-first within each bucket; drafts carry a `(draft)` suffix and a draft icon. Two new fields (`reviewRequests`, `isDraft`) flow end-to-end through the forge concept; github + gitlab fully populate, gitea safely defaults because `tea pulls list` doesn't expose the fields. When `gh` is unavailable the list falls back to plain createdAt-desc with no crash.
- **Pull Requests sidebar carries an inline `Reference PR in Architect` action** (#1043, PR #1044). Mirrors the existing backlog inline action: clicking the `$(mention)` icon on a PR row injects `#<pr-number> "<title>" ` into the architect's prompt buffer (no Enter), opening the architect terminal first if needed. Quotes inside PR titles are escaped. Also reachable from the row's right-click context menu. Closes the asymmetry that left PR rows without a fast hand-off to the architect.
- **Spawning a builder terminal no longer force-creates a second editor group** (#804, PR #1041). The builder/shell terminal spawn used to unconditionally target `ViewColumn.Two`, which VS Code creates on demand by ordinal — so single-column users had their layout reshaped every time a builder spawned. The spawn now picks `Two` only when a second tab group already exists; otherwise it attaches to the first/default group. Architect (`ViewColumn.One`) and dev/panel terminals are untouched.
- **Expanding a builder in the sidebar no longer collapses area-group headers** (#913, PR #1040). The Builders tree's accordion was firing the tree-wide `collapseAll` command, which collapsed every expandable node including the `VSCODE` / `TOWER` / etc. area-group headers — and every accordion click wrote `false` for every group to `workspaceState`, so the collapse survived reloads. The accordion now only touches sibling builder rows, area-group expansion in the Builders view is in-memory-only (Backlog's persistence is unchanged — different lifecycle), and previously-persisted Builders group state is cleared once on activation. Toggling the accordion title-bar button while one builder is open also now correctly resets so the next expand on any builder, including the previously-open one, collapses the rest.
- **CLI preflight no longer triggers a false "Get started with Codev" walkthrough on slow environments** (#1024, PR #1026). The startup CLI version probe used to cap at 400ms, too tight against the realistic 500-3500ms cold-spawn budget on remote SSH, WSL, `nvm` / `fnm` / `volta` shims, AV-scanning Windows, and network filesystems. A timed-out probe wrongly decided the CLI was missing and re-opened the walkthrough on every startup, even though `codev --version` succeeded from a terminal in the same window. The cap is now 5000ms by default and overrideable via a new `codev.cliVersionTimeoutMs` setting (range 100-60000ms) for users on extra-slow infra. Timeouts log a `[Preflight]` line to the Codev Output channel so the failure mode is diagnosable.

## Other fixes (dashboard, porch, infrastructure)

<!-- Non-vscode work that ships in the npm release. Same bullet shape as Polish. -->

- **`afx tower start` now waits for readiness and reports startup failure honestly** (#1030, PR #1031 — contributed by @timeleft--). The previous behavior returned exit code 0 once the daemon process was alive — even if `/api/status` never came up — so a failed startup silently looked successful and the first downstream CLI call hit a dead Tower. Startup now waits for `/api/status` to respond (configurable internally; default 30s, accommodating slow cold-start environments like remote SSH, WSL, NFS, AV-scanning Windows). If the daemon never becomes healthy, `afx tower start` exits non-zero with the log file path so the failure is diagnosable. The legacy `--wait` flag is retained as a deprecated no-op alias so existing scripts continue to parse.
- **Shellper startup errors carry actionable context instead of opaque JSON failures** (#1030, PR #1031). The `Invalid shellper info JSON` / `Shellper exited with code N before writing info` errors that surface during macOS PTY exhaustion or `node-pty` spawn failures used to drop a raw JSON blob into the error message with no path to the stderr log and no redaction. Errors now include the shellper's stderr tail (4 KB) and a safely-redacted stdout snippet — `env` and `args` keys are recursively replaced with `[redacted]` via a JSON-walk (no brittle regex), so secret values can never leak. Empty or malformed stdout is omitted from the snippet entirely. A new `settled` guard in the readShellperInfo path also fixes a race between `exit` and `end` events.
- **Shellper protocol now replays the `EXIT` frame to clients that connect after the PTY has already exited** (#905, PR #953 — contributed by @mohidmakhdoomi). Previously the `EXIT` broadcast in `ShellperProcess` reached only the clients connected *at the moment* the PTY exited, and `handleHello` sent `WELCOME` + `REPLAY` to late-connecting clients but never an `EXIT` frame. For commands that exited very fast (test fixtures using `exit 0` / `exit 1`, anything sub-millisecond) the broadcast could complete before `SessionManager.createSession` finished its spawn → readInfo → waitForSocket → connect handshake — the exit reached nobody and the client hung forever waiting for an `exit` event. The same race fired when Tower reconnected to a surviving shellper after restart and the shellper's PTY had exited during the disconnect window, leaving Tower's session map perpetually tracking the dead session as "active." `handleHello` now retains `exitInfo` set on `pty.onExit` (cleared on every respawn) and replays the `EXIT` frame to the late-connecting client after `WELCOME` + `REPLAY`. The shellper's broadcast and the new replay target mutually exclusive client sets (handler runs to completion in a single synchronous JS turn so there's no double-send window). A follow-up `waitForTerminalExit` short-circuit in `tower-instances.ts` resolves immediately when `session.status === 'exited'` — necessary because the primary fix makes exits propagate earlier, exposing a previously-latent `once('exit')` race in the teardown helper. Surfaced via three integration tests (`'respects maxRestarts limit'`, `'logs session exit without stderr tail'`, `'no stderr tail logged for file-based stderr'`) that timed out at 15s locally; with the fix they pass in <2s. Original `it.skipIf(!!process.env.CI)` guard is unchanged — the CI skip remains for the unrelated node-pty native module child-process limitation.
- **Fresh `codev init` projects now get `codev/resources/arch.md` and `lessons-learned.md` starter files** (#1012, PR #1046). Spec 987 introduced the hot/cold governance-doc tier split and shipped a hot-tier materializer (`copyHotTierDefaults`) so `arch-critical.md` and `lessons-critical.md` exist on disk after `codev init`/`adopt`/`update`. The matching cold-tier materializer was missing, so a fresh project hit the first PIR / SPIR / ASPIR / MAINTAIN review phase with no local `arch.md` or `lessons-learned.md` to write findings into — the four-tier resolver covered reads via the bundled skeleton, but writes had no parent path. A new `copyColdTierDefaults` ships the matching starter files from `codev-skeleton/templates/{arch,lessons-learned}.starter.md` with an explicit `STARTER:` replace-me marker. Skip-existing throughout, so curated copies are never overwritten; `codev update` backfills the cold files for projects adopted before this change. Completes the pair Spec 987 started.
- **`afx status` surfaces architect ↔ builder ownership** (#1057, PR #1058 — by @waleedkadous). Multi-architect workspaces (the canonical example being one with 8 architects running ~17 builders) had no first-class way to see which architect spawned which builder. The data lived in `state.db.builders.spawned_by_architect` from Spec 755 but wasn't exposed through the CLI, so ownership-scoped sweeps (cleanup, PR-close, messaging) meant hand-querying SQLite. `afx status` now adds an `Owner` column to the builder list (sorted by owner with unknown/legacy ones last, preserving `started_at` order within each owner group), splits builders out of the generic `Terminals:` list into a new `Builders:` section, and reads from `state.db` so ownership renders correctly whether or not Tower is running. Two new flags filter the view: `--architect <name>` scopes to a specific owner, `--mine` resolves the current architect from the `CODEV_ARCHITECT_NAME` env var that Tower injects into every architect terminal. A new `afx status --json` flag returns the same payload as machine-readable JSON (each builder carries `spawnedByArchitect` plus a `running` flag), so agents and scripts can ownership-filter without scraping the human table.
- **Contributor VSCode workspace no longer pegs CPU walking builder worktrees** (#1022, PR #1039). The repo's `.vscode/extensions.json` used to recommend `ms-vscode.extension-test-runner`, whose test discovery runs `rg --no-ignore --follow` over the workspace and chases symlinks into every `.builders/*/node_modules` pnpm farm — with ~15 worktrees that pegged CPU for ~30s at a time on file changes. The recommendation is removed and `.vscode/settings.json` gains `files.watcherExclude` + extended `search.exclude` covering `**/.builders/**` and `**/node_modules/**` as defense in depth. Contributor-experience only; nothing in the published extension changes.

## Breaking changes

None.

## Install

```bash
npm install -g @cluesmith/codev@X.Y.Z
afx tower stop && afx tower start
```

The VS Code extension ships separately via the Marketplace — `Codev` extension by `cluesmith.codev`, version `X.Y.Z`.

## Contributors

- **M Waleed Kadous (@waleedkadous)** — symmetric hot/cold governance docs: shipped Spec 987 (PR #1034), splitting `arch.md` and `lessons-learned.md` into hard-capped always-injected hot tiers plus on-demand cold reference archives, with the materializer that makes them appear on init / adopt / update. The architectural foundation for the cycle's fresh-install fixes (#1011, #1012). Also surfaced architect ↔ builder ownership in `afx status` (PR #1058, fixes #1057): owner column with stable sort, `--architect <name>` and `--mine` filters, and a `--json` payload — completes the multi-architect ergonomics story that Spec 755's `spawned_by_architect` column started.
- **Mohid Makhdoomi (@mohidmakhdoomi)** — shellper EXIT-replay race: fixed a latent race where late-connecting clients to a recently-exited PTY would hang waiting for an exit signal that already broadcast to nobody (PR #953, fixes #905). Surfaced the bug via three locally-flaky integration tests and shipped both the protocol fix and a follow-up `waitForTerminalExit` short-circuit that the primary fix exposed.
- **timeleft-- (@timeleft--)** — Tower start readiness + shellper diagnostics: made `afx tower start` actually wait for `/api/status` before reporting success, and rewrote shellper startup error diagnostics to carry actionable context including a safely-redacted stdout snippet and stderr tail (PR #1031, fixes #1030). Substantially improved Tower restart UX on slow / remote environments.
- **Amr Elsayed (@amrmelsayed)** — VS Code extension features: artifact-canvas package foundation (PR #1027), VSCode Markdown Preview as a review surface and its marker rendering (PR #1045, PR #1056), codelens injection in the unified diff editor (PR #1023), terminal correctness work (PR #1050, PR #1061), PR sidebar ownership sort + reference action (PR #1019, PR #1044), Builders accordion + terminal-group fixes (PR #1040, PR #1041), CLI preflight (PR #1026), VSCode workspace config (PR #1039), framework-file delivery (PR #1015), and the dual-accumulate changelog workflow across the cycle.
- AI builder agents working under AIR / BUGFIX / PIR / SPIR protocols across the PRs in this release.
