# PIR Plan: VSCode startup preflight — verify codev CLI installed and version ≥ extension version

## Understanding

The VSCode extension today has exactly one CLI preflight: `tower-starter.ts:27-30` resolves the `afx` binary and, on failure, writes one line to the `Codev` OutputChannel. There is no:

- existence check for the `codev` CLI itself,
- version compatibility check between the installed CLI and the extension,
- user-facing guidance (toast / walkthrough) when the CLI is missing or stale.

A user with a missing or outdated CLI therefore hits cryptic Tower-startup failures (`autoStartTower` returns `false`, Tower never connects, the status bar sticks on "Offline") with no actionable "install/upgrade this, then retry" path.

The issue (#791) asks for a session-cached preflight that runs on `activate()`:

1. **Existence** — `codev --version` must resolve. Missing ⇒ first-run / setup-required.
2. **Version** — the source of truth for the minimum is **the extension's own `package.json` `version`** (`context.extension.packageJSON.version`, currently `3.1.5`). The CLI must report `codev --version ≥ extension.version`. No `compat.json`, no manifest field, no network fetch.
3. **Guidance UX (combination)**:
   - **Missing CLI** ⇒ auto-trigger a VSCode Walkthrough `Codev: Getting Started` (detect → install → verify). First activation per workspace.
   - **Outdated CLI** ⇒ rich `showWarningMessage` with `Update via npm` (runs `npm install -g @cluesmith/codev` in an integrated terminal, then re-verifies), `Open Install Docs`, `Dismiss`.
4. **Graceful degrade on dismiss** — Codev commands stay registered but no-op cleanly; the first invocation while unresolved shows a single `Codev: CLI not installed / outdated — run setup` toast with a `Run Setup` button. Re-prompts on next activation if still unresolved.

Key facts established by investigation:

- The CLI prints its version via commander's `program.version(version)` (`packages/codev/src/cli.ts:47`), so `codev --version` emits a bare `3.1.5\n`. The version string is the package version (`packages/codev/src/version.ts`).
- `resolveAfxPath` (`tower-starter.ts:66-77`) is the existing pattern for finding a Codev bin: try `<workspace>/node_modules/.bin/<name>`, else fall back to the bare name on `PATH`. The `codev` resolver should mirror it exactly.
- The extension has **no** `semver` dependency, so version comparison must be a small hand-rolled numeric compare (major/minor/patch, pre-release/build suffixes stripped).
- `package.json` has no `walkthroughs` contribution today; one must be added, with markdown step bodies under a new `walkthroughs/` media dir.
- Unit tests use **vitest** (`src/__tests__/**`, `vitest.config.ts`) and test *pure, vscode-free* logic + `package.json` invariants. The `vscode`-dependent glue is covered by the existing `vscode-test` Electron suite / manual review, not vitest. So the testable core must be split out into a `vscode`-free module.

## Proposed Change

Add a preflight subsystem split into a **pure core** (unit-tested) and a **thin vscode glue layer** (manually reviewed at the `dev-approval` gate — the natural fit for PIR's running-worktree review).

### 1. `packages/vscode/src/preflight/preflight-core.ts` (new, vscode-free)

Pure functions, fully unit-testable:

- `parseSemver(raw: string): [number, number, number] | null` — extract the first `X.Y.Z` from a string, dropping `-pre`/`+build` suffixes. Returns `null` if unparseable.
- `compareSemver(a: string, b: string): -1 | 0 | 1` — numeric major/minor/patch compare. Unparseable inputs are treated conservatively (documented below).
- `parseCliVersion(stdout: string): string | null` — trim `codev --version` output and pull the version token.
- `resolveCodevPath(workspacePath: string | null, existsFn: (p: string) => boolean): string` — mirror of `resolveAfxPath` for the `codev` bin, with `existsSync` injected for testability.
- `decidePreflight(input: { cliFound: boolean; cliVersion: string | null; extVersion: string }): PreflightStatus` where `PreflightStatus = 'ok' | 'missing' | 'outdated'`. Rules:
  - not found, or `--version` failed/unparseable ⇒ `'missing'` (treated as setup-required / first-run),
  - `compareSemver(cliVersion, extVersion) < 0` ⇒ `'outdated'`,
  - otherwise ⇒ `'ok'`.

### 2. `packages/vscode/src/preflight/preflight.ts` (new, vscode glue)

- `runCodevVersion(codevPath, cwd): Promise<{ ok: boolean; stdout: string }>` — `spawn(codevPath, ['--version'])`, collect stdout, resolve on exit, **hard 400ms timeout** (kill the child and resolve `ok:false` on timeout, so a hung binary can't blow the <500ms budget).
- `runPreflight(context, workspacePath, outputChannel): Promise<PreflightStatus>` — orchestrates resolve → run → decide, **caches** the resulting status in a module-level variable for the session, logs the outcome to the OutputChannel, and dispatches the UX:
  - `'missing'` ⇒ `maybeOpenWalkthrough(context)` (first-activation-per-workspace gate via `context.workspaceState`, key `codev.preflight.walkthroughShown`).
  - `'outdated'` ⇒ `showOutdatedNotification(cliVersion, extVersion)`.
  - `'ok'` ⇒ nothing.
- `getCachedStatus(): PreflightStatus | 'pending'` — the cache accessor for the command guard. Returns `'pending'` until the first run resolves.
- `isCliReady(): boolean` — `getCachedStatus()` is `'ok'` **or** `'pending'` (optimistic: never block a command because preflight hasn't finished its <500ms run yet).
- `showSetupRequiredToast()` — single-per-session `Codev: CLI not installed / outdated — run setup` warning with a `Run Setup` button that re-runs the resolution flow (re-open walkthrough if missing / re-show notification if outdated).
- `showOutdatedNotification(...)` — `showWarningMessage(msg, 'Update via npm', 'Open Install Docs', 'Dismiss')`:
  - `Update via npm` ⇒ create a **named, reference-held** integrated terminal, `sendText('npm install -g @cluesmith/codev')`. See the recheck design below for how completion is detected.
  - `Open Install Docs` ⇒ `env.openExternal` to the install docs URL.
  - `Dismiss` / dismissal ⇒ leave cached `'outdated'`; guard handles no-op.

### Recheck / re-verify design

A **single** command `codev.recheckCli` is the canonical re-verify action. It clears the cached status, re-runs `runPreflight(...)`, and reports the outcome (`✓ codev X.Y.Z` info toast on success; re-dispatches the missing/outdated UX otherwise). Every recheck path routes through it so there is exactly one re-verify code path. Entry points:

1. **Sidebar Status view** (`codev.status`) — a persistent `Codev CLI: <version>` row (✓ ok / ⚠ outdated / ✗ missing icon), present regardless of Tower connection state (unlike the Tunnel/Cron rows which require a live client). When the status is `missing`/`outdated`/`pending`, the row carries an inline action button bound to `codev.recheckCli` (via a `view/item/context` + inline menu contribution gated on a `contextValue`). This is the persistent, always-available recheck home.
2. **`Update via npm` completion** — the listener is **instance-matched and exit-code-gated**: hold the created terminal reference, register a `window.onDidCloseTerminal` that ignores every terminal except that exact instance, and on the matching close only re-verify when `terminal.exitStatus?.code === 0`. On a non-zero / undefined exit (failed or cancelled install) it does **not** silently re-cache; instead it shows a follow-up toast with an explicit `Recheck` button (→ `codev.recheckCli`) so the user drives the re-scan deterministically. On success it also shows a `✓ Updated — codev X.Y.Z` confirmation. The listener is one-shot (disposes itself after the matching close) and is registered on `context.subscriptions` as a safety net.
3. **Walkthrough Verify step** — the third walkthrough step's markdown embeds a `command:codev.recheckCli` completion link, so finishing the install flow ends in an explicit "verify it worked" click that runs the same command.
4. **`Run Setup` toast** (from `showSetupRequiredToast`) — unchanged; re-enters the resolution flow.

`runPreflight` is refactored so its dispatch (cache-clear → resolve → decide → UX) is reusable by both activation and `codev.recheckCli` with no duplication.

### 3. `packages/vscode/src/extension.ts` — wire-up

- After the synchronous command registration and before/around `connectionManager.initialize()`, fire `runPreflight(...)` **without awaiting** (fire-and-forget) so activation isn't blocked. Pass `connectionManager.getWorkspacePath()` (resolved synchronously is fine; fall back to `detectWorkspacePath()` if needed) — keep it cheap.
- Introduce a local `guard(handler)` wrapper: `(...args) => isCliReady() ? handler(...args) : showSetupRequiredToast()`. Apply it to the **CLI/Tower-dependent** `codev.*` command handlers (spawn, approve, cleanup, dev-server start/stop, worktree setup, send, tunnel, cron, etc.). **Do not** guard `codev.reconnect`, `codev.helloWorld`, view-toggle/config commands, or the setup re-entry path — those must work (or are inert) regardless of CLI state. The exact guarded/unguarded split is enumerated in "Files to Change" and is the main thing to sanity-check at the gate.

### 4. `packages/vscode/package.json` — walkthrough contribution

- Add `contributes.walkthroughs[0]` with `id: "codevGettingStarted"`, `title: "Codev: Getting Started"`, and three steps (Detect / Install / Verify), each with a `markdown` media file under `walkthroughs/`.
- Per VSCode's standard behavior, a contributed walkthrough is listed on the Welcome/Get Started page and is featured once per install/update (`workbench.welcomePage.walkthroughs.openOnInstall`, default on). Our explicit once-per-workspace `openWalkthrough` call on the `missing` path is additive to this default.
- Add the `walkthroughs/` dir to the packaged files (esbuild copies static assets; confirm `.vscodeignore` doesn't exclude it).

### 5. Install docs URL constant

A single `INSTALL_DOCS_URL` constant in `preflight.ts` (points at the Codev install docs). No new config surface.

## Files to Change

- `packages/vscode/src/preflight/preflight-core.ts` — **new**, pure logic (`parseSemver`, `compareSemver`, `parseCliVersion`, `resolveCodevPath`, `decidePreflight`, `PreflightStatus` type).
- `packages/vscode/src/preflight/preflight.ts` — **new**, vscode glue (`runCodevVersion`, `runPreflight`, `recheckCli`, `getCachedStatus`, `getCachedVersion`, `isCliReady`, `showSetupRequiredToast`, `showOutdatedNotification`, `maybeOpenWalkthrough`, `INSTALL_DOCS_URL`). Exposes a `PreflightState` accessor (`{ status, cliVersion }`) for the Status view row.
- `packages/vscode/src/extension.ts`:
  - `activate()` — call `runPreflight(...)` fire-and-forget (near the `connectionManager.initialize()` wiring, ~line 716). Register `codev.recheckCli` (unguarded) which calls `recheckCli(...)` and refreshes the Status view. Hold the `StatusProvider` reference so recheck can `.refresh()` it (mirrors how `workspaceProvider` is held for `codev.removeArchitect`).
  - Add the `guard(...)` helper and apply to CLI-dependent commands within the `context.subscriptions.push(...)` block (~lines 444-675). **Guarded**: `codev.spawnBuilder`, `codev.approveGate`, `codev.cleanupBuilder`, `codev.sendMessage`, `codev.runWorktreeDev`, `codev.stopWorktreeDev`, `codev.runWorkspaceDev`, `codev.stopWorkspaceDev`, `codev.runWorktreeSetup`, `codev.openWorktreeWindow`, `codev.connectTunnel`, `codev.disconnectTunnel`, `codev.cronTasks`, `codev.referenceIssueInArchitect`, `codev.removeArchitect`. **Unguarded**: `codev.reconnect`, `codev.recheckCli`, `codev.helloWorld`, all `codev.{enable,disable,show}*` config toggles, `codev.refreshOverview`, `codev.refreshTeam`, view/diff/file/issue read-only viewers, `codev.openDevUrl`, `codev.pasteImage`, `codev.addReviewComment`, terminal-open commands. (Final split confirmed at the dev-approval gate.)
- `packages/vscode/src/views/status.ts` — add a persistent `Codev CLI: <version>` row at the top of `getChildren()` (before the Tower row), driven by the preflight `PreflightState` accessor — not by `connectionManager`, so it renders even when Tower is offline. Icon: ✓ (`check`/iconPassed) for `ok`, ⚠ (`warning`) for `outdated`, ✗ (`error`/iconFailed) for `missing`, spinner (`sync~spin`) for `pending`. Set `contextValue = 'codev-cli-<status>'` so the recheck inline button shows only for non-ok states. The provider subscribes to a preflight `onDidChange` emitter (new) so the row updates after a recheck.
- `packages/vscode/package.json` — add the `codev.recheckCli` command (title `Codev: Recheck CLI`, icon `$(refresh)`); add a `view/item/context` inline menu entry binding it to the Status row's non-ok `contextValue`s; add `contributes.walkthroughs[0]` (id `codevGettingStarted`, title `Codev: Getting Started`, three steps Detect/Install/Verify).
- `packages/vscode/walkthroughs/detect.md`, `install.md`, `verify.md` — **new** walkthrough step bodies (Verify embeds a `command:codev.recheckCli` completion link).
- `packages/vscode/.vscodeignore` — ensure `walkthroughs/` ships (verify; edit only if needed).
- `packages/vscode/src/__tests__/preflight-core.test.ts` — **new**, vitest unit tests.
- `packages/vscode/src/__tests__/contributes-walkthroughs.test.ts` — **new**, package.json walkthrough-contribution invariants (id present, every step's `media.markdown` file exists on disk).

## Risks & Alternatives Considered

- **Risk: spawning `codev --version` adds activation latency.** Mitigation: fire-and-forget (never awaited in `activate`), hard 400ms timeout on the child, result cached for the session. Happy-path target <500ms is met because activation never blocks on it at all; the 400ms cap only bounds the background resolution.
- **Risk: `isCliReady()` returns `'pending'` optimistically, so a command fired in the first ~400ms while CLI is actually missing won't be guarded.** Accepted: the command will fail through its existing not-connected-to-Tower path (already handled gracefully today), and the walkthrough/notification still fires once preflight resolves. Treating `'pending'` as not-ready would risk a false "run setup" toast on a perfectly healthy install during the startup window — worse UX.
- **Risk: guarded/unguarded command split is a judgment call.** This is precisely why PIR (plan-approval) fits — the split is enumerated above for review, and the running behavior is checkable at the dev-approval gate.
- **Risk: `onDidCloseTerminal`-based re-verify firing on the wrong terminal / a failed install.** Mitigation (tightened): the listener is instance-matched (ignores all terminals except the one we created) and exit-code-gated (`exitStatus?.code === 0`); a non-zero/cancelled install does not silently re-cache — it surfaces a follow-up toast with an explicit `Recheck` button. All recheck paths (sidebar row, follow-up toast, walkthrough Verify step, `Run Setup`) funnel through the single `codev.recheckCli` command, so there is one re-verify code path to reason about.
- **Risk: persistent Status-view CLI row could mislead if it goes stale.** Mitigation: the row reads the live `PreflightState` accessor and the provider subscribes to a preflight `onDidChange` emitter that fires on every (re)check, so the row updates immediately after a recheck rather than waiting for a Tower/SSE tick.
- **Risk: `compareSemver` mishandling pre-release / odd version strings.** Mitigation: suffixes stripped before numeric compare; unparseable CLI version ⇒ `'missing'` (conservative — prompts setup rather than silently passing). Unit-tested across normal, equal, greater, lesser, pre-release, and garbage inputs.
- **Alternative: reuse `tower-starter`'s afx check / add version logic there.** Rejected — the issue explicitly scopes this to the `codev` CLI as the version proxy (afx version is out of scope), and preflight UX (walkthrough, notification, command guard) is a distinct concern from Tower auto-start.
- **Alternative: pull in the `semver` npm package.** Rejected — a ~10-line numeric compare avoids a new runtime dependency in the extension bundle for a trivially simple comparison.
- **Alternative: guard *all* `codev.*` commands via a central registration wrapper.** Rejected — would no-op harmless/recovery commands (`reconnect`, config toggles) and risks breaking the recovery path itself; selective guarding is safer.

## Test Plan

**Unit (vitest — `pnpm --filter @cluesmith/codev test:unit`):**
- `parseSemver`: `"3.1.5"`, `"v3.1.5"`, `"3.1.5\n"`, `"3.1.5-rc.1"`, `"3.1.5+build"`, `"garbage"` → expected tuples / `null`.
- `compareSemver`: equal, each component greater/lesser, pre-release suffix ignored.
- `parseCliVersion`: bare `"3.1.5\n"`, with surrounding whitespace, empty string.
- `resolveCodevPath`: workspace bin exists (injected `existsFn`) → local path; absent → bare `"codev"`; null workspace → bare `"codev"`.
- `decidePreflight`: missing → `'missing'`; equal → `'ok'`; CLI greater → `'ok'`; CLI lower → `'outdated'`; null/unparseable cliVersion → `'missing'`.
- `contributes-walkthroughs.test.ts`: walkthrough id present; each step's referenced markdown file exists; `codev.recheckCli` command is declared and `command:codev.recheckCli` is referenced by the Verify step markdown.

**Manual (at the dev-approval gate — run the worktree's extension):**
- **OK path**: current CLI installed → activate → no toast, no walkthrough; OutputChannel logs `preflight: ok`; status bar connects normally. Confirm activation feels instant.
- **Missing CLI**: shadow `codev` off PATH (or point workspace at a fake bin) → activate → `Codev: Getting Started` walkthrough opens once; second activation in the same workspace does **not** re-open it.
- **Outdated CLI**: stub `codev --version` to emit a version below `3.1.5` → activate → warning notification with `Update via npm` / `Open Install Docs` / `Dismiss`. Click `Open Install Docs` → browser opens. Click `Update via npm` → integrated terminal runs the install command.
- **Recheck — sidebar row**: in missing/outdated state, the Codev sidebar **Status** view shows a `Codev CLI: …` row with the ⚠/✗ icon and an inline recheck button. Fix the CLI, click the inline button (or run `Codev: Recheck CLI` from the palette) → row flips to ✓ `Codev CLI: <version>`, any lingering toast/walkthrough state clears. Confirm the row renders even with Tower offline.
- **Recheck — install completion**: after `Update via npm`, let the install **succeed** → on terminal close, `✓ Updated` confirmation and status flips to ok. Repeat with a **failed/cancelled** install (Ctrl-C the terminal) → no false "ok"; a follow-up toast with an explicit `Recheck` button appears, and clicking it re-verifies. Confirm closing an *unrelated* terminal does not trigger a re-verify.
- **Dismiss → no-op**: dismiss the notification, then invoke a guarded command (e.g. Spawn Builder) → single `Run Setup` toast; invoke a second guarded command → no second toast (single-per-session). Click `Run Setup` → flow re-opens. Confirm an unguarded command (e.g. Reconnect) still works.
- **Re-prompt**: with CLI still unresolved, reload the window → preflight prompts again.
