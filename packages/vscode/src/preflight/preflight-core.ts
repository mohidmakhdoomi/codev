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
