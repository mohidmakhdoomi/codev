/**
 * Pure, vscode-free logic for the startup CLI preflight (#791).
 *
 * Kept free of any `vscode` import so it can be unit-tested under vitest
 * (`src/__tests__/preflight-core.test.ts`). The vscode-dependent glue —
 * spawning the CLI, toasts, walkthrough, the Status-view row — lives in
 * `preflight.ts` and is reviewed by running the worktree at the
 * `dev-approval` gate.
 */

import { resolve } from 'node:path';

/**
 * The outcome of a preflight check.
 *
 * - `ok`       — the codev CLI is installed and its version is >= the extension's.
 * - `missing`  — the CLI could not be resolved, or `--version` failed / was
 *                unparseable. Treated as first-run / setup-required.
 * - `outdated` — the CLI is installed but older than the extension.
 */
export type PreflightStatus = 'ok' | 'missing' | 'outdated';

/** Parsed semver triple; suffixes (`-rc.1`, `+build`) are dropped. */
type SemverTriple = [number, number, number];

/**
 * Extract the first `X.Y.Z` from a string, ignoring a leading `v` and any
 * `-prerelease` / `+build` suffix. Returns `null` when no triple is present.
 */
export function parseSemver(raw: string): SemverTriple | null {
  const match = /(\d+)\.(\d+)\.(\d+)/.exec(raw);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/**
 * Numeric major/minor/patch comparison. Pre-release / build suffixes are
 * ignored (stripped by `parseSemver`). Unparseable inputs sort *before*
 * parseable ones so a garbage CLI version compares as "less than" the
 * extension — i.e. conservatively triggers an upgrade prompt.
 *
 * Returns -1 if `a < b`, 1 if `a > b`, 0 if equal.
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  if (!pa && !pb) { return 0; }
  if (!pa) { return -1; }
  if (!pb) { return 1; }
  for (let i = 0; i < 3; i++) {
    if (pa[i] < pb[i]) { return -1; }
    if (pa[i] > pb[i]) { return 1; }
  }
  return 0;
}

/**
 * Pull the version token out of `codev --version` stdout. Commander's
 * `program.version()` emits a bare `X.Y.Z\n`, but we trim and re-parse
 * defensively in case the output is wrapped or empty. Returns `null` when
 * no version can be found.
 */
export function parseCliVersion(stdout: string): string | null {
  const triple = parseSemver(stdout.trim());
  return triple ? triple.join('.') : null;
}

/**
 * Resolve the `codev` binary path, mirroring `resolveAfxPath` in
 * `tower-starter.ts`: prefer the workspace-local `node_modules/.bin/codev`,
 * else fall back to the bare name on `PATH`.
 *
 * `existsFn` is injected so this stays pure and unit-testable (the caller
 * passes `existsSync`).
 */
export function resolveCodevPath(
  workspacePath: string | null,
  existsFn: (p: string) => boolean,
): string {
  if (workspacePath) {
    const localPath = resolve(workspacePath, 'node_modules', '.bin', 'codev');
    if (existsFn(localPath)) {
      return localPath;
    }
  }
  return 'codev';
}

/**
 * Decide the preflight status from the resolved facts. The single source of
 * truth for the minimum version is the extension's own `package.json`
 * `version` (`extVersion`) — same-or-higher is the rule.
 */
export function decidePreflight(input: {
  cliFound: boolean;
  cliVersion: string | null;
  extVersion: string;
}): PreflightStatus {
  if (!input.cliFound || !input.cliVersion) {
    return 'missing';
  }
  return compareSemver(input.cliVersion, input.extVersion) < 0 ? 'outdated' : 'ok';
}

/**
 * Ephemeral status-bar text shown when a guarded command is rejected for a
 * non-ok preflight status, after the first-click modal has already fired this
 * session (see `showPreflightFeedback` in `preflight.ts`). Names the current
 * problem and the recovery command so the click reads as registered, not as a
 * silent no-op. Kept pure so the wording is unit-tested without a vscode mock.
 * The Tower-version dimension (#983) is a separate surface — see
 * `towerDivergenceMessage` below — rather than an overload of this CLI helper.
 */
export function preflightFeedbackMessage(status: PreflightStatus): string {
  const label = status === 'outdated' ? 'outdated' : 'not installed';
  return `Codev: CLI ${label}. Run "Codev: Recheck CLI" when ready.`;
}

// ---------------------------------------------------------------------------
// Tower-version dimension (#983)
//
// The CLI preflight above inspects the on-disk binary. This second dimension
// inspects the *running* Tower process via `GET /api/version`. After an
// `npm install -g` upgrade without a Tower restart the two diverge: the disk
// binary is current but Tower still serves the old in-memory code. These pure
// helpers decide the divergence state and word the toast; the vscode glue in
// `preflight.ts` owns the probe, caching, and the `Restart Tower` action.
// ---------------------------------------------------------------------------

/**
 * The Tower-version dimension of the preflight.
 *
 * - `ok`          — running Tower is at least as new as both the installed CLI
 *                   and the extension's expected version. No signal.
 * - `stale`       — running Tower is older than the installed CLI and/or the
 *                   extension. The user upgraded (or this build needs newer)
 *                   but Tower is still on old in-memory code. Prompt a restart.
 * - `too-old`     — the probe returned 404: this Tower predates the
 *                   `/api/version` endpoint entirely. Prompt a restart, with
 *                   stronger wording.
 * - `unreachable` — the probe could not reach Tower. Defer to the existing
 *                   "not connected to Tower" path; no new signal.
 * - `pending`     — the probe has not completed yet.
 */
export type TowerStatus = 'ok' | 'stale' | 'too-old' | 'unreachable' | 'pending';

/**
 * Decide the Tower-version dimension from the probe outcome and the known
 * versions. The divergence rule is `running < max(installedCli, extVersion)` —
 * a running Tower *newer* than the installed CLI (local-dev / global-install
 * lag) is deliberately **not** flagged, so the healthy path stays silent.
 *
 * `probeStatus` is the raw HTTP status from `TowerClient.getVersion()`
 * (`0` = unreachable, `404` = endpoint absent, `200` = reported).
 */
export function decideTowerStatus(input: {
  probeStatus: number;
  runningVersion: string | null;
  installedCli: string | null;
  extVersion: string;
}): TowerStatus {
  if (input.probeStatus === 404) {
    return 'too-old';
  }
  if (input.probeStatus !== 200 || !input.runningVersion) {
    return 'unreachable';
  }
  const baselines = input.installedCli
    ? [input.extVersion, input.installedCli]
    : [input.extVersion];
  const isStale = baselines.some((b) => compareSemver(input.runningVersion!, b) < 0);
  return isStale ? 'stale' : 'ok';
}

/**
 * Toast wording for a divergent Tower (`stale` / `too-old`). The action button
 * itself is attached by the vscode glue; this is just the message body, kept
 * pure so the wording is unit-tested without a vscode mock. When the Tower is
 * non-local (tunnelled / remote `towerHost`) the local `Restart Tower` action
 * would target the wrong machine, so the wording names the host instead.
 */
export function towerDivergenceMessage(input: {
  status: 'stale' | 'too-old';
  runningVersion: string | null;
  expectedVersion: string;
  hostIsLocal: boolean;
  host: string;
}): string {
  const runningClause = input.status === 'too-old'
    ? 'Codev Tower is running code too old to report its version'
    : `Codev Tower is running ${input.runningVersion ?? '(unknown)'}`;
  const restartClause = input.hostIsLocal
    ? 'Restart Tower to load it.'
    : `Restart the Tower on ${input.host} to load it.`;
  return `${runningClause}, but ${input.expectedVersion} is installed. ${restartClause}`;
}
