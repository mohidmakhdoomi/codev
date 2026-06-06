# PIR Review: Detect installed-vs-running Tower version divergence

Fixes #983

## Summary

The v3.1.7 #791 preflight verifies the *installed* `codev` CLI version but is blind to whether the *running* Tower process is executing that same code — after an `npm install -g` upgrade without a Tower restart, the two diverge silently and the user hits stale handlers / wire shapes with no signal. This PR adds an in-memory version probe: Tower exposes read-only `GET /api/version`, and the VS Code extension probes it alongside the CLI preflight, showing an actionable `Restart Tower` toast when the running Tower is behind the installed CLI. The healthy path stays silent.

## Files Changed

- `packages/types/src/api.ts` (+18) — `TowerVersionInfo` wire type
- `packages/types/src/index.ts` (+1) — export
- `packages/core/src/tower-client.ts` (+16/-1) — `getVersion()` probe (returns raw result so the caller distinguishes 404 from unreachable)
- `packages/codev/src/agent-farm/servers/tower-routes.ts` (+22) — `GET /api/version` route + handler + `RouteContext` `version`/`startedAt`
- `packages/codev/src/agent-farm/servers/tower-server.ts` (+7) — stamp `startedAt` at boot, populate `routeCtx`
- `packages/codev/src/agent-farm/__tests__/tower-routes.test.ts` (+18) — route test + makeCtx helper fields
- `packages/codev/src/agent-farm/__tests__/spec-761-api-state.test.ts` (+2) — makeCtx helper fields
- `packages/codev/src/agent-farm/__tests__/tower-cron-routes.test.ts` (+2) — makeCtx helper fields
- `packages/vscode/src/preflight/preflight-core.ts` (+97) — `TowerStatus`, `decideTowerStatus`, `towerDivergenceMessage` (pure)
- `packages/vscode/src/preflight/preflight.ts` (+163/-...) — probe, additive `PreflightState`, divergence toast, restart-reprobe, startup-race fix; `INSTALL_DOCS_URL` → `#quick-start`
- `packages/vscode/src/tower-starter.ts` (+72) — `restartTower` helper
- `packages/vscode/src/extension.ts` (+10/-...) — probe on `connected` transition
- `packages/vscode/src/views/status.ts` (+12/-...) — running-Tower version in the CLI-row tooltip
- `packages/vscode/src/__tests__/preflight-core.test.ts` (+74) — unit tests for the pure logic
- `codev/resources/arch.md`, `codev/resources/lessons-learned.md` — doc updates (see below)
- `codev/plans/983-*.md`, `codev/state/pir-983_thread.md` — plan + builder thread

## Commits

- `019d676a` Fix startup race: re-probe Tower after CLI version resolves
- `f5261fee` Point install-docs link at #quick-start anchor
- `3ac2077b` Fire Tower-divergence toast on running<installedCLI only, not vs extension
- `6f5e079f` restartTower: principled shutdown wait + honest failure on hung stop
- `677cc6af` vscode: Tower-version probe, divergence toast + restart action
- `95e43e47` tower: GET /api/version endpoint + RouteContext version/startedAt
- `1fba9c23` core: add TowerClient.getVersion() probe
- `815167f7` types: add TowerVersionInfo wire type
- (plus plan/thread commits)

## Test Results

- `pnpm build` (codev): ✓ pass; vscode `check-types` ✓, `lint` ✓
- Tests: ✓ vscode 328 unit tests (8 new for `decideTowerStatus`/`towerDivergenceMessage`); codev route suites 96 tests; porch `build` + `tests` checks passed at the dev-approval gate
- Manual verification (human, dev-approval gate): walked the toast behaviour in the Extension Development Host against a live branch Tower; surfaced and fixed two issues during review (see below).

## Architecture Updates

Updated `codev/resources/arch.md` — added a "Running-Tower version probe (#983)" bullet in the VS Code section, directly after the documented #791 CLI-preflight bullet it extends. Covers the new `GET /api/version` endpoint, the `running < installedCLI` divergence rule, the local-only restart action (and its dependency on #991's `afx tower stop` scoping), and the startup-race reconciliation.

## Lessons Learned Updates

Updated `codev/resources/lessons-learned.md` with three lessons surfaced during this work:
1. Gate a remedy prompt on the condition the remedy actually fixes, not on any divergence (the futile-restart bug caught at the dev-approval gate).
2. To detect a daemon serving stale code after an in-place upgrade, probe the *running* process's in-memory version, not the on-disk binary.
3. A decision needing two independently-fetched async inputs must re-run when the later input resolves — a one-shot "fire on event X" is a latent bug when X can beat the data it depends on.

## Things to Look At During PR Review

- **Codex REQUEST_CHANGES (3-way consult, addressed)** — Codex (HIGH confidence) flagged that the `too-old` (404) path had the same futile-remedy bug we'd already fixed for the ext-version comparison: when the installed CLI is itself outdated (extension updated ahead of CLI) and the running Tower is that old endpoint-less code, a 404 raised "Restart Tower" — but restarting reloads the same CLI that still lacks `/api/version`. **Fixed** in `3ac…`→ commit below: `decideTowerStatus` now gates `too-old` on `cliStatus === 'ok'` (the installed CLI is current enough to include the endpoint); otherwise it returns `ok` and defers to #791's "update CLI" toast. `stale` is deliberately *not* gated (running < installedCLI always means a restart loads genuinely newer, endpoint-having code). Regression test added: `404 + cliStatus outdated → ok (no restart prompt)`, plus `404 + missing` and `stale + outdated-CLI`. Gemini and Claude both returned APPROVE. **This single fix was not independently re-reviewed by the consult (PIR is single-pass) — worth the human's eye at the `pr` gate.**
- **Divergence rule (`decideTowerStatus`)** — this is the spot that changed most during review. It fires on `running < installedCLI` only. Comparing against the *extension* version was removed: a restart can't load a version that isn't installed, so that arm produced a futile restart prompt naming a non-installed version. "CLI behind extension" is the existing #791 preflight's concern.
- **Startup race fix (`performPreflight`)** — the Tower probe fires on `connected`, but the installed-CLI version comes from a separate ~400ms spawn. If connect wins, the probe saw `installedCli=null` → `ok` → no toast (the headline open-after-upgrade case). Fixed by re-probing once the CLI check resolves. Worth a careful read of the ordering.
- **`restartTower` shutdown wait** — `afx tower stop` only SIGTERMs and returns immediately, so the helper polls `/health` until down (5s, matching Tower's own `STARTUP_TIMEOUT_MS`) and returns `false` on timeout rather than letting `autoStartTower`'s already-running early-return report a fake success.
- **Self-invoked restart safety** — the in-extension `Restart Tower` action is only safe because #991 (already on main) scoped `afx tower stop` to the listening Tower process; before it, the unfiltered `lsof` would have killed the extension host's own sockets.
- **Additive `PreflightState`** — extended with Tower fields without disturbing the existing `{ status, cliVersion }` consumers (`views/status.ts`), and the CLI command-guard `showPreflightFeedback()` was left no-arg (the Tower toast is a separate surface).
- **Rider**: `INSTALL_DOCS_URL` was repointed to `#quick-start` at reviewer request — a tweak to the existing #791 toast, not part of #983's core mechanism.

## How to Test Locally

- **View diff**: VSCode sidebar → right-click builder pir-983 → **Review Diff**
- **Run**: `pnpm -w run local-install` (makes the running Tower this branch, exposing `/api/version`); `curl -s localhost:4100/api/version` to confirm
- **What to verify** (maps to the plan's Test Plan):
  - Healthy: running == installed → no toast; CLI-row tooltip shows both versions matching
  - Stale: bump the globally-installed `@cluesmith/codev/package.json` version (simulates an upgrade) without restarting Tower, reload the Ext Dev Host → divergence toast with `Restart Tower`; clicking it restarts Tower and clears the toast
  - Too-old: point the extension at a pre-#983 Tower (404) → "too old to report" toast
  - Unreachable: stop Tower → only the existing "not connected" path, no new toast
  - Cross-machine: non-local `codev.towerHost` → toast names the host, omits the local restart button
