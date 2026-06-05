# PIR-921 Thread — Codev Dev panel tab + status-bar chip

## Plan phase — investigation (start)

Issue #921: dedicated "Codev Dev" bottom-panel tab + always-visible status-bar chip for the `afx dev` PTY.

### Key findings from investigation

1. **Hard dependency #812 (codevPanel viewsContainer) is NOT landed.**
   - #812 still OPEN; no `codevPanel` in `packages/vscode/package.json` (only the `codev` activitybar container).
   - No branch / sibling builder working on it. So it is not in flight.
   - Issue #921 states it "cannot land until #812 ships." → genuine blocker / fork.

2. **Dev PTY is already a native VSCode terminal tab.**
   - `terminal-manager.ts` opens `Codev: <name> (dev)` as a `CodevPseudoterminal` (WebSocket → Tower) in `TerminalLocation.Panel`. Tracked client-side keyed `dev-<builderId>`; `listDevTerminals()` → `{builderId, terminalId}[]` (no port, no friendly target).
   - `onDidChangeDevTerminals` fires on start/stop/swap → the re-render hook both surfaces will subscribe to.
   - No Tower "dev started/stopped" SSE event; state is inferred client-side.

3. **Technical constraint**: VSCode can't embed a native terminal inside a custom panel webview. "Scrolling PTY output in the tab" ⇒ either xterm.js in a webview re-subscribing to the Tower WS (heavy; loses native search/copy/links) OR plain log lines. Reframes design calls #2 (rendering) and #3 (replace vs coexist).

4. Existing status-bar item: single connection-status item at `extension.ts:56,126` (Left, prio 100). New dev chip is a *second*, independent item (prio 99 per issue).

5. Views are all TreeDataProviders; no WebviewViewProvider exists yet. WebviewPanel (editor tab) precedent: `backlog-search-panel.ts` (theme-safe CSS via `var(--vscode-*)`, CSP nonce, postMessage). Tests: vitest in `src/__tests__/` for pure helpers.

### Forks raised to architect (awaiting direction before writing plan)
- #812 strategy: absorb minimal codevPanel into this PR vs ship chip+commands now & defer the tab vs pause.
- PTY-output rendering + replace/coexist (design calls #2/#3) given the embed constraint.

Design calls #1/#4/#5 will adopt the issue's canonical picks (hide-when-idle / prominentBackground / always-show Switch) unless redirected.

## Plan phase — decision + plan written

Architect decisions (via two AskUserQuestion rounds):
- Use case confirmed: ambient awareness + fast control of the single dev server, NOT terminal fidelity.
- #812 dependency is editorial (consolidation), not technical — but architect chose: **keep #921 whole, write full plan as design-of-record, HOLD for #812.** No implementation now.
- Action: raise #812 for scheduling.

Plan written to `codev/plans/921-vscode-codev-dev-surface-botto.md`. Key design decisions baked in:
- Tab = TreeDataProvider (status header + actions), NOT a webview/xterm. Output stays in the native terminal (coexist).
- Chip = 2nd StatusBarItem (Left, prio 99), prominentBackground, click→focus tab.
- Design calls: #1 placeholder+epitaph, #2 no in-tab output, #3 coexist, #4 prominentBackground, #5 Switch always-shown.
- Implementation gated on #812 (codevPanel container). Files-to-change is the shovel-ready spec for the implement phase post-#812.

Next: commit plan, porch done/next → plan-approval gate pending, notify architect to schedule #812, then hold.

## #812 landed (2026-06-05) — plan updated to active

Architect: hard prerequisite #812 merged (PR #990, c21a112). codevPanel container now on main.
Verified on origin/main:
- `viewsContainers.panel` has `codevPanel` (title "Codev").
- `views.codevPanel` has scaffolding `codev.placeholder` gated by context key `codev.panelContainerEmpty` (seeded true in extension.ts:363).
- Contract (panel-placeholder.ts): a real view registering in codevPanel must flip `codev.panelContainerEmpty` false so the signpost hides. Our `codev.devServer` is the first real tab → must set that key false on register.

Updated plan: removed the "HELD" framing → status now "unblocked, ready to implement"; folded in the panelContainerEmpty integration contract (extension.ts must flip it false; added a contributes test + manual placeholder check); dropped em dashes per new writing guidance.

Gate state: still `plan-approval` gate_pending. I cannot self-approve (strict mode). Plan is accurate and ready; waiting on the human to approve the gate. Implementation will merge origin/main first to get codevPanel, then proceed.
