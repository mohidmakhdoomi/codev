# PIR #1052 — vscode terminal corrupted + cursor-at-top after window reactivation

## Phase: plan

### Investigation (root cause)
Issue lists 4 candidate mechanisms. Investigated the VSCode terminal relay path:

- `packages/vscode/src/terminal-adapter.ts` — `CodevPseudoterminal`. PR #1050 (#1047)
  added a **post-connect repaint nudge** (`scheduleRepaintNudge`): ~500ms after a WS
  *connect*, if nothing rendered, it sends a `rows-1 → rows` size delta to force a
  SIGWINCH so a full-screen TUI repaints. It is **gated on `renderedSinceConnect`** and
  only fires on connect — there is **no equivalent on window reactivation** (the repro
  in this issue: lose+regain window focus with no reconnect).
- The manual workaround in the issue ("resize the VSCode window clears the corruption")
  is exactly a SIGWINCH → full TUI redraw. So the proven fix lever already exists; it
  just needs a new trigger: window refocus.
- Mechanism #3 from the issue (extend the nudge to fire on `onDidChangeWindowState`) is
  the cleanest, lowest-risk, and matches the dashboard's existing model:
  `packages/dashboard/src/components/Terminal.tsx:741` already re-fits + SIGWINCHs on
  `visibilitychange`. VSCode has no such handler — that's the gap.

### Root-cause localization (folded into plan Understanding after architect Q)
The WS lives in the **extension host** (Node `ws`), NOT the renderer. On window blur the
ext host keeps draining the socket; Electron throttles the **renderer** (pauses rAF →
xterm.js render loop stalls while its buffer fills), and the refocus catch-up is where the
cursor desync / stacked frames appear. So: not backend, not the WS relay/replay (rules out
issue mechanisms #2/#4), it's xterm.js render-state drift (mechanism #1) — renderer-side,
in code we don't own. SIGWINCH redraw is the only available lever and matches the proven
manual workaround.

### Decision
Primary fix = mechanism #3. Add a public `forceRepaint()` to the adapter (the size-delta
SIGWINCH, refactored out of the nudge timer, ungated by `renderedSinceConnect`), and wire
`vscode.window.onDidChangeWindowState` (rising edge: unfocused→focused) in the extension
to call it on managed Codev terminals. This is the load-bearing case for PIR's
`dev-approval` gate: visual, reproducible-only-in-real-VSCode.

### Status
- Plan approved (architect, plan-approval gate). Now in **implement**.

## Phase: implement
Three changes landed:
- `terminal-adapter.ts`: extracted `forceSigwinchRedraw()` from the nudge timer; added
  public `forceRepaint()` (ungated by renderedSinceConnect; no-ops disposed / not-OPEN /
  replaying).
- `terminal-manager.ts`: `repaintAllOnRefocus()` fans forceRepaint over all managed ptys.
- `extension.ts`: `onDidChangeWindowState` rising-edge (unfocused→focused) →
  repaintAllOnRefocus.
Tests: 4 adapter behavioral tests (forceRepaint fires post-render; no-ops ×3) +
2 source-level manager guards + vscode CHANGELOG entry (matched #1050: CHANGELOG only,
no live UNRELEASED.md on this branch).

### ROOT-CAUSE PIVOT (dev-approval gate, attempt #2)
F5 build with the SIGWINCH-nudge approach STILL corrupted on initial load. Architect: only
manual resize OR close+reopen fixes it. Key insight: both of those re-render VS Code's
*xterm.js*; a Pseudoterminal CANNOT (no xterm handle; `onDidOverrideDimensions` only
overrides when smaller-than-panel, not a refresh hook). 2-way consult: Gemini misfired
(empty sandbox), Codex nailed it → **defer connect until real size known**.
Real root cause: `open(initialDimensions===undefined)` on first open → we connected
immediately → replay rendered at the 80×24 default width → corruption. close+reopen works
because the 2nd open has real dims. **Fix:** defer connect until first `setDimensions()`
(2s fallback). Removed the dead post-replay nudge. Kept refocus `forceRepaint` for the
(separate, unverified) reactivation symptom. Tests: removed fresh-replay tests, added 5
defer tests; 427 unit pass, F5 compile/lint clean. Awaiting F5 re-test of initial load.

### ATTEMPT #3 — onDidOverrideDimensions (the user's API hint) + diag logging
Defer fix ALSO failed on initial load (same screenshot). 2 misses → stop guessing.
Decisive fact: ONLY resize/reopen fix it, both = xterm.js re-render. The sole pty→xterm
lever VS Code exposes is `onDidOverrideDimensions` (user flagged this earlier; Codex had
dismissed it — overruled). Wired it: `forceXtermReflow()` fires override(cols-1,rows-1)
then undefined 100ms later → forces xterm re-layout (mimics manual resize). Triggers:
after fresh full replay's `resume` (reflowAfterReplay, lastSeq<=0) + on refocus. Kept defer
(harmless). Added `[#1052-diag]` logging (open initialDimensions, setDimensions, reflow
fires) so if it STILL fails the user can paste the Codev output channel and I get real data
instead of a 3rd guess. 430 unit tests pass, F5 compile/lint clean. **Unconfirmed — awaiting
F5 test. If it works: strip diag logs + finalize CHANGELOG.**

### DATA-DRIVEN PRUNE (diag log captured)
Architect ran F5 + pasted `[#1052-diag]` log. Decisive facts:
- `open() initialDimensions=114x40` (NOT undefined) → **defer-until-sized (attempt #2)
  FALSIFIED** — it never engages. Removed entirely: `awaitingInitialSize`,
  `initialConnectTimer`, `INITIAL_SIZE_FALLBACK_MS`, open/unsized branch, setDimensions
  deferred-connect branch, close cleanup, 5 defer tests. open() reverts to always-connect.
- replay is tiny/instant (pause→resume same ms) → "oversized replay renders corrupted" not
  the mechanism here.
- post-replay `forceXtermReflow` override(113x39)→release DID fire (mechanically works).
- **Smoking gun:** pane resized 114x40 → **116x41 at +148ms** (setDimensions AFTER our
  reflow already released). Geometry still settling; every redraw lever fires during the
  settling window against a stale size. → next fix direction (if reflow ineffective):
  debounce reflow until size stabilizes.
Still KEPT (not decided by this log): refocus path (attempt #1, different trigger, not
exercised) + post-replay reflow (attempt #3, live candidate). 425 unit tests pass.
Awaiting architect's visual result (fixed or not) before next step.

### dev-approval gate feedback (architect)
- Naming: renamed `forceSigwinchRedraw` → `sendRepaintNudge` (SIGWINCH was the only
  identifier in the repo baking in the signal name; all others keep it in comments).
- **Scope broadened.** Architect tested F5 dev build → corruption ALSO on *initial load*
  (until manual resize), not just refocus. Root cause = #1050's connect-time nudge is gated
  on `!renderedSinceConnect`, so a *corrupted-but-rendered* full replay skips the nudge
  (#1050 only fixed *blank* on open). Fix extended: arm `nudgeAfterReplay = (lastSeq<=0)` at
  connect; on the replay's `resume`, force one clean `sendRepaintNudge()`. Reconnect deltas
  (lastSeq>0) stay gated (no reflow, preserves #1050 intent). +2 adapter tests (fires on
  fresh replay; does NOT fire on reconnect delta). 424 unit tests green. Now covers BOTH
  triggers with one lever. Awaiting re-test of on-open at the gate.
