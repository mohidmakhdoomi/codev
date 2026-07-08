# PIR Plan: VSCode IDE-mode foundation — dual-mode activation, context keys, empty-window surfaces

Issue: #1144

## Understanding

The extension today has no concept of a workspace-free layer. Its activation events (`workspaceContains:.codev`, `workspaceContains:codev`) mean it only ever activates inside a codev project, and everything downstream silently assumes that: the Workspace view renders fully-clickable Architects / Spawn Builder / New Shell rows unconditionally, and `activate()` unconditionally connects to (and auto-starts) Tower.

Three parts, one layer model:

**Part 1 (original bug)** — with no folder open, the Workspace view still renders dead actions. Root cause confirmed: `packages/vscode/src/views/workspace.ts:71-229` (`getChildren`) builds the Architects root, Spawn Builder, and New Shell rows unconditionally; nothing in `contributes.views` gates any view on workspace presence. (The data-bearing views — Agents, Backlog, Pull Requests, Recently Closed — already render empty when `OverviewCache` has no data, so they show blank trees rather than dead actions; but blank trees with no welcome content are still a poor surface. The Status view also renders rows unconditionally: `views/status.ts:22-30`.)

**Part 2 (dual-mode activation)** — one artifact, two channels (marketplace vsix + baked into the Codev IDE fork). Runtime split on `vscode.env.appName`. Adding `onStartupFinished` means `activate()` runs in **every window of every marketplace install**, so the guest+no-codev-workspace path must be provably inert. Activation side-effect inventory (the full list of things that must be gated):

1. `connectionManager.initialize()` — `extension.ts:1308`. Connects to Tower and **auto-starts it** (`connection-manager.ts:85-103`, `autoStartTower` default true) even when `detectWorkspacePath()` returns null. This is the headline inertness risk: today it's safe only because activation implies a codev workspace.
2. `runPreflight(...)` — `extension.ts:1305`. Spawns a `codev --version` child process; on a missing CLI it **opens the Getting Started walkthrough** (`preflight.ts:151-152`) — a focus steal + notification in a vanilla window.
3. One-time panel reveal — `extension.ts:515-519`. Executes `workbench.view.extension.codevPanel` (focus steal) and writes `globalState` on first activation per profile.
4. `statusBarItem.show()` — `extension.ts:150`. UI mutation in every window.
5. `workspaceState.update(...)` cleanup writes — `extension.ts:414-415` — and the `globalState` write in (3): state writes.

Everything else in `activate()` (constructing `ConnectionManager`/`TerminalManager`/`OverviewCache`, registering commands, tree providers, event subscriptions, content providers) is verified side-effect-free until a connection exists: `ConnectionManager`'s constructor only builds an auth wrapper; `OverviewCache` only subscribes to SSE events that never fire before `initialize()`; tree registration is invisible until the user opens the container.

**Part 3 (IDE empty-window surface)** — when `ideMode && !hasWorkspace`: focus the Codev container, show welcome content (Open Folder / Open Recent / spawn-your-first-builder pointer), one-time first-run gated on `globalState`, with the existing CLI-preflight walkthrough as the first-run path. Per the fork-side comment on the issue (2026-07-07): this surface is the product's **only** first-run UX (core onboarding is removed in the fork), and it must be **runtime code** (`setContext` + explicit focus + welcome views), never `configurationDefaults`, which register asynchronously and race first render.

### appName contract (pending confirmation)

The detection contract is `vscode.env.appName === 'Codev'` per the issue and its latest fork-side comment. **The architect has flagged that the fork rebrand has not landed and the exact `nameLong` value ('Codev' vs 'Codev IDE') is still being confirmed.** The design below single-sources the string as one exported constant (`CODEV_IDE_APP_NAME` in `src/ide-mode.ts`) so that if the confirmed value differs, changing that one line is the only edit. The constant carries a comment marking it as a cross-repo contract with the fork's `product.json` `nameLong`. I will not hard-code the string anywhere else (including tests, which import the constant).

## Proposed Change

### Layer model → two context keys + an activation tier

New module `packages/vscode/src/ide-mode.ts` (pure logic, fully unit-testable):

- `export const CODEV_IDE_APP_NAME = 'Codev'` — the cross-repo contract constant (see note above).
- `detectIdeMode(appName: string, opts: { devSeam?: string; isDevelopment: boolean }): boolean` — exact match against the constant, OR a test seam: `CODEV_SIMULATE_IDE=1` in the environment, honored **only when `context.extensionMode === vscode.ExtensionMode.Development`** so the seam is usable in the Extension Development Host and in tests but can never flip a production install into IDE mode.
- `decideActivationTier({ ideMode, hasCodevWorkspace }): 'full' | 'ide-empty' | 'dormant'`:
  - `hasCodevWorkspace` (i.e. `detectWorkspacePath() !== null`) → **`full`** — today's behavior, byte-for-byte, in both guest and IDE.
  - `ideMode && !hasCodevWorkspace` → **`ide-empty`** — Tower-level surfaces live (connection incl. auto-start, status bar, preflight) plus the Part 3 empty-window surface.
  - `!ideMode && !hasCodevWorkspace` → **`dormant`** — as inert as if activation had never fired.
- `activationPolicy(tier)` → `{ initializeConnection, runPreflight, revealPanelOnce, showStatusBar, writeCleanupState, focusCodevContainer, ideFirstRun }` booleans. `activate()` consumes this policy; the policy function is where the behavior matrix is provable in unit tests, one assertion set per quadrant.

### extension.ts changes

At the very top of `activate()` (before any side effect):

1. Compute `ideMode` via `detectIdeMode(vscode.env.appName, ...)` and `hasCodevWorkspace` via the existing `detectWorkspacePath()`.
2. `setContext('codev.ideMode', ideMode)`.
3. `setContext('codev.hasWorkspace', (vscode.workspace.workspaceFolders?.length ?? 0) > 0)`, kept live via `vscode.workspace.onDidChangeWorkspaceFolders`. (`codev.hasWorkspace` is deliberately folder-presence per the issue's matrix, not codev-project-presence — it drives view visibility; the activation tier uses codev-project detection.)
4. Compute `tier` / `policy` and thread it through the five gated side effects listed in Understanding. In `dormant`: no `initialize()`, no preflight, no panel reveal, no `statusBarItem.show()`, no `workspaceState`/`globalState` writes. Commands, providers, and subscriptions still register — registration is invisible, and it keeps palette invocations from erroring with "command not found" (contributed commands are palette-visible regardless of activation; their existing guards already produce a graceful "Not connected to Tower" / preflight message).
5. When `policy.focusCodevContainer` (ide-empty only): `executeCommand('workbench.view.extension.codev')`.
6. When `policy.ideFirstRun` (ide-empty only): if `globalState.get('codev.ideFirstRunShown')` is unset, set it, show a one-time welcome notification, and open the existing `codevGettingStarted` walkthrough (through the same `maybeOpenWalkthrough` once-gate the preflight uses, so preflight and first-run can't double-open it). Subsequent launches: container focus + welcome content only, no toast.

Late workspace opening needs no listener dance: opening a folder from an empty window restarts the extension host, so the tier is recomputed naturally.

### package.json changes

- `activationEvents`: add `"onStartupFinished"`, **keep** both `workspaceContains` entries.
- View gating (Part 1): add `"when": "codev.hasWorkspace"` to `codev.workspace`, `codev.backlog`, `codev.pullRequests`, `codev.recentlyClosed`; `codev.team` becomes `"codev.teamEnabled && codev.hasWorkspace"`; `codev.status` becomes `"codev.hasWorkspace || codev.ideMode"` (Tower/CLI status is Tower-level, but a dormant guest window shouldn't render stale preflight rows). `codev.agents` stays ungated — it is the container's anchor and the welcome-content carrier (its tree is verified empty when no data: `builders.ts:277-281`).
- New `viewsWelcome` section on `codev.agents`:
  - `"when": "!codev.hasWorkspace && !codev.ideMode"` — "Open a folder to use Codev." + `[Open Folder](command:workbench.action.files.openFolder)`.
  - `"when": "!codev.hasWorkspace && codev.ideMode"` — the IDE empty-window surface: Open Folder, `[Open Recent](command:workbench.action.openRecent)`, and a "spawn your first builder" pointer linking to the Getting Started walkthrough via a small new command (`codev.openGettingStarted`) that wraps the preflight module's existing `openWalkthrough()` (welcome links can't pass args to `workbench.action.openWalkthrough`, so a wrapper command is the clean path; registered but not contributed to the palette).

### Built-in vs marketplace-copy collision (documented answer, acceptance item)

Both channels ship the same extension ID (`cluesmith.codev-vscode`). VS Code resolves same-ID conflicts by letting a user-installed extension shadow the built-in one. This is safe by design here: IDE mode is detected at runtime from `appName`, not from the install channel, so a newer marketplace copy running inside the Codev IDE still enters IDE mode with identical behavior. The only effect of shadowing is version skew (user copy may be newer than the baked-in one), which is the desired update path. This answer goes in the review file and as a comment block next to the `CODEV_IDE_APP_NAME` constant.

## Files to Change

- `packages/vscode/package.json` — `activationEvents` + `onStartupFinished`; `when` clauses on the five workspace-bound views; new `viewsWelcome` section; declare `codev.openGettingStarted` (menus-hidden).
- `packages/vscode/src/ide-mode.ts` — **new**: `CODEV_IDE_APP_NAME`, `detectIdeMode`, `decideActivationTier`, `activationPolicy`. Pure, no vscode import.
- `packages/vscode/src/extension.ts:136-151` — tier computation + context keys at the top of `activate()`; gate `statusBarItem.show()`.
- `packages/vscode/src/extension.ts:414-415` — gate the workspaceState cleanup writes on the policy.
- `packages/vscode/src/extension.ts:515-519` — gate the one-time panel reveal on the policy.
- `packages/vscode/src/extension.ts:1305` — gate `runPreflight` on the policy.
- `packages/vscode/src/extension.ts:1308` — gate `connectionManager.initialize()` on the policy.
- `packages/vscode/src/extension.ts` (commands block) — register `codev.openGettingStarted`; add the ide-empty startup surface (container focus + first-run) after registration.
- `packages/vscode/src/preflight/preflight.ts` — export `openWalkthrough` (and reuse `maybeOpenWalkthrough`'s once-gate for the first-run path).
- `packages/vscode/src/__tests__/ide-mode.test.ts` — **new**: appName detection (exact match; guest names 'Visual Studio Code', 'Cursor', 'VSCodium' are false; dev-seam honored only in Development mode) + `decideActivationTier` / `activationPolicy` assertions for all four quadrants of the issue's matrix.
- `packages/vscode/src/__tests__/contributes-view-gating.test.ts` — **new**: package.json invariants — `onStartupFinished` present AND both `workspaceContains` entries retained; each workspace-bound view carries `codev.hasWorkspace` in its `when`; `codev.agents` ungated; `viewsWelcome` entries exist with the exact quadrant `when` clauses and only reference commands that exist.

## Risks & Alternatives Considered

- **Risk: appName value changes when the fork rebrand lands.** Mitigation: single constant, one-line edit, tests import the constant. Pending confirmation is called out at the top of this plan; implementation proceeds with `'Codev'` and the constant flips if the codev-ide architect confirms otherwise.
- **Risk: missing a side effect → marketplace inertness fails.** Mitigation: the inventory above was built by reading the full 1319-line `activate()` and the constructors it invokes (`ConnectionManager`, `OverviewCache`, `TerminalManager`, providers); the five listed sites are the complete set of pre-connection side effects. The manual test plan includes a real no-Tower verification, not just unit tests.
- **Risk: hiding commands' host objects in dormant mode breaks palette invocations.** Avoided by design: dormant still registers everything; only the five side effects are gated.
- **Risk: brief view flash before `setContext` lands** (container rendered before keys set). Keys are set synchronously first-thing in `activate()`; with `onStartupFinished` the workbench is already restored, so in practice the keys land before the user opens the container. Accepted as cosmetic worst-case.
- **Edge case: `codev.workspacePath` setting override with no folder open** → tier is `full` (Tower connects against the override) but `codev.hasWorkspace` is false so workspace views stay hidden. Accepted: the override is a power-user seam; folder-presence semantics for the key follow the issue's matrix.
- **Alternative: gate Part 1 inside each provider (`getChildren` returns `[]`)** — rejected as the primary fix; view-level `when` + `viewsWelcome` matches VS Code conventions (per the issue) and gives users guidance instead of blank trees. Provider-level behavior was audited anyway: data views already render empty on null data.
- **Alternative: separate builds/IDs for IDE vs marketplace** — rejected; the issue mandates one codebase, one artifact, runtime split.
- **Alternative: `configurationDefaults` for any part of the first-run surface** — rejected outright per the fork's empirically-verified constraint (async registration races first render, ~1-in-3 leak).

## Test Plan

Automated (`pnpm --filter codev-vscode test:unit`, run from the worktree):

- `ide-mode.test.ts` — the behavior matrix, one describe per quadrant: guest+no-ws → dormant policy (all five side effects false); guest+ws(codev) → full; IDE+no-ws → ide-empty (connection+statusbar+preflight true, focus+first-run true, panel-reveal true); IDE+ws → full. Plus appName exact-match and dev-seam gating.
- `contributes-view-gating.test.ts` — package.json invariants as listed above.
- Existing suite must stay green (notably `workspace.test.ts`, `contributes-*.test.ts`, `menu-when-clauses.test.ts`).

Manual, in the Extension Development Host (for the dev-approval gate):

1. **Marketplace inertness (guest, no folder):** stop Tower (`afx tower stop`), launch EDH with no folder. Verify: no process appears on port 4100 (`lsof -i :4100`), no status-bar item, no toast, no focus steal, no walkthrough. Click the Codev activity-bar icon: only Agents shows, with the "Open a folder to use Codev" welcome — no dead action rows anywhere. Run a Codev command from the palette: graceful error, still no Tower spawn afterward from the guard path.
2. **Guest, codev folder (regression):** open this repo in EDH with Tower stopped. Verify today's exact experience: Tower auto-starts, status bar shows, all views populate, no welcome content, no container focus-steal beyond current behavior.
3. **IDE simulation, no folder:** launch EDH with `CODEV_SIMULATE_IDE=1` and no folder. Verify: Codev container focused on startup, IDE welcome (Open Folder / Open Recent / get-started pointer), first-run notification + walkthrough exactly once; relaunch → container focus + welcome only, no repeat toast. Tower-level surfaces live (status bar present, Status view visible).
4. **IDE simulation, codev folder:** full experience, identical to (2).
5. **Non-codev folder, guest:** open a folder with no `codev/`/`.codev` — dormant, same checks as (1).
