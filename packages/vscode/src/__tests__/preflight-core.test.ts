/**
 * Unit tests for the pure preflight logic (#791). No `vscode` import, so this
 * runs under vitest like the other `src/__tests__/**` suites.
 */

import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import {
  parseSemver,
  compareSemver,
  parseCliVersion,
  preflightFeedbackMessage,
  resolveCodevPath,
  decidePreflight,
  decideTowerStatus,
  towerDivergenceMessage,
} from '../preflight/preflight-core.js';

describe('parseSemver', () => {
  it('parses a bare triple', () => {
    expect(parseSemver('3.1.5')).toEqual([3, 1, 5]);
  });
  it('ignores a leading v and trailing newline', () => {
    expect(parseSemver('v3.1.5\n')).toEqual([3, 1, 5]);
  });
  it('drops a prerelease suffix', () => {
    expect(parseSemver('3.1.5-rc.1')).toEqual([3, 1, 5]);
  });
  it('drops a build suffix', () => {
    expect(parseSemver('3.1.5+build.9')).toEqual([3, 1, 5]);
  });
  it('returns null for garbage', () => {
    expect(parseSemver('not-a-version')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('treats equal versions as equal', () => {
    expect(compareSemver('3.1.5', '3.1.5')).toBe(0);
  });
  it('compares each component', () => {
    expect(compareSemver('4.0.0', '3.9.9')).toBe(1);
    expect(compareSemver('3.2.0', '3.1.9')).toBe(1);
    expect(compareSemver('3.1.6', '3.1.5')).toBe(1);
    expect(compareSemver('3.1.4', '3.1.5')).toBe(-1);
    expect(compareSemver('2.9.9', '3.0.0')).toBe(-1);
  });
  it('ignores prerelease suffixes', () => {
    expect(compareSemver('3.1.5-rc.1', '3.1.5')).toBe(0);
  });
  it('sorts an unparseable version before a parseable one', () => {
    expect(compareSemver('garbage', '3.1.5')).toBe(-1);
    expect(compareSemver('3.1.5', 'garbage')).toBe(1);
    expect(compareSemver('garbage', 'nonsense')).toBe(0);
  });
});

describe('parseCliVersion', () => {
  it('extracts the version from bare stdout', () => {
    expect(parseCliVersion('3.1.5\n')).toBe('3.1.5');
  });
  it('tolerates surrounding whitespace', () => {
    expect(parseCliVersion('  3.1.5  ')).toBe('3.1.5');
  });
  it('returns null for empty / non-version output', () => {
    expect(parseCliVersion('')).toBeNull();
    expect(parseCliVersion('codev: command help')).toBeNull();
  });
});

describe('resolveCodevPath', () => {
  const wsBin = resolve('/ws', 'node_modules', '.bin', 'codev');

  it('prefers the workspace-local bin when it exists', () => {
    expect(resolveCodevPath('/ws', (p) => p === wsBin)).toBe(wsBin);
  });
  it('falls back to the bare name when the local bin is absent', () => {
    expect(resolveCodevPath('/ws', () => false)).toBe('codev');
  });
  it('falls back to the bare name when there is no workspace', () => {
    expect(resolveCodevPath(null, () => true)).toBe('codev');
  });
});

describe('decidePreflight', () => {
  const extVersion = '3.1.5';
  it('is missing when the CLI was not found', () => {
    expect(decidePreflight({ cliFound: false, cliVersion: null, extVersion })).toBe('missing');
  });
  it('is missing when the version is unparseable / null', () => {
    expect(decidePreflight({ cliFound: true, cliVersion: null, extVersion })).toBe('missing');
  });
  it('is ok when the CLI equals the extension', () => {
    expect(decidePreflight({ cliFound: true, cliVersion: '3.1.5', extVersion })).toBe('ok');
  });
  it('is ok when the CLI is newer than the extension', () => {
    expect(decidePreflight({ cliFound: true, cliVersion: '3.2.0', extVersion })).toBe('ok');
  });
  it('is outdated when the CLI is older than the extension', () => {
    expect(decidePreflight({ cliFound: true, cliVersion: '3.1.4', extVersion })).toBe('outdated');
  });
});

describe('preflightFeedbackMessage', () => {
  it('names the outdated state for an outdated CLI', () => {
    const msg = preflightFeedbackMessage('outdated');
    expect(msg).toContain('outdated');
    expect(msg).not.toContain('not installed');
  });
  it('names the not-installed state for a missing CLI', () => {
    const msg = preflightFeedbackMessage('missing');
    expect(msg).toContain('not installed');
    expect(msg).not.toContain('outdated');
  });
  it('points at the recheck recovery command in every case', () => {
    for (const status of ['missing', 'outdated'] as const) {
      expect(preflightFeedbackMessage(status)).toContain('Codev: Recheck CLI');
    }
  });
});

describe('decideTowerStatus', () => {
  it('is ok when running equals the installed CLI', () => {
    expect(decideTowerStatus({
      probeStatus: 200, runningVersion: '3.1.5', installedCli: '3.1.5', cliStatus: 'ok',
    })).toBe('ok');
  });

  it('is stale when running is older than the installed CLI (upgraded, not restarted)', () => {
    expect(decideTowerStatus({
      probeStatus: 200, runningVersion: '3.1.5', installedCli: '3.1.7', cliStatus: 'ok',
    })).toBe('stale');
  });

  it('is stale even when the installed CLI is itself behind the extension (restart still loads newer code)', () => {
    // running 3.1.5 < installedCli 3.1.6; the CLI being 'outdated' vs the
    // extension does not gate staleness — restarting genuinely advances Tower.
    expect(decideTowerStatus({
      probeStatus: 200, runningVersion: '3.1.5', installedCli: '3.1.6', cliStatus: 'outdated',
    })).toBe('stale');
  });

  it('does NOT flag a running Tower newer than the installed CLI (no false positive)', () => {
    expect(decideTowerStatus({
      probeStatus: 200, runningVersion: '3.2.0', installedCli: '3.1.5', cliStatus: 'ok',
    })).toBe('ok');
  });

  it('does NOT flag a Tower behind only the extension (CLI matches running) — that is #791, not a restart case', () => {
    // running == installed CLI; a restart would reload the same version, so no
    // divergence is reported here even if the extension itself is newer.
    expect(decideTowerStatus({
      probeStatus: 200, runningVersion: '3.1.7', installedCli: '3.1.7', cliStatus: 'outdated',
    })).toBe('ok');
  });

  it('is too-old when the probe returns 404 and the installed CLI is current (restart would add the endpoint)', () => {
    expect(decideTowerStatus({
      probeStatus: 404, runningVersion: null, installedCli: '3.1.7', cliStatus: 'ok',
    })).toBe('too-old');
  });

  it('does NOT prompt restart on a 404 when the installed CLI is itself outdated (restart is futile — #791 owns it)', () => {
    // Regression for the Codex review finding: extension updated ahead of an old
    // CLI; the running Tower (that old CLI) has no /api/version → 404. Restarting
    // reloads the same endpoint-less code, so suppress the Tower prompt.
    expect(decideTowerStatus({
      probeStatus: 404, runningVersion: null, installedCli: '3.1.6', cliStatus: 'outdated',
    })).toBe('ok');
  });

  it('does NOT prompt restart on a 404 when the CLI is missing', () => {
    expect(decideTowerStatus({
      probeStatus: 404, runningVersion: null, installedCli: null, cliStatus: 'missing',
    })).toBe('ok');
  });

  it('is unreachable when the probe cannot connect (status 0)', () => {
    expect(decideTowerStatus({
      probeStatus: 0, runningVersion: null, installedCli: '3.1.7', cliStatus: 'ok',
    })).toBe('unreachable');
  });

  it('does not flag staleness when the installed CLI is unknown (no restart basis)', () => {
    expect(decideTowerStatus({
      probeStatus: 200, runningVersion: '3.1.4', installedCli: null, cliStatus: 'ok',
    })).toBe('ok');
  });
});

describe('towerDivergenceMessage', () => {
  it('names the running and installed versions for a stale Tower with a local restart', () => {
    const msg = towerDivergenceMessage({
      status: 'stale', runningVersion: '3.1.5', installedVersion: '3.1.7', hostIsLocal: true, host: 'localhost',
    });
    expect(msg).toContain('3.1.5');
    expect(msg).toContain('3.1.7 is installed');
    expect(msg).toContain('Restart Tower');
  });

  it('uses stronger wording for a too-old Tower', () => {
    const msg = towerDivergenceMessage({
      status: 'too-old', runningVersion: null, installedVersion: '3.1.7', hostIsLocal: true, host: 'localhost',
    });
    expect(msg).toContain('too old');
  });

  it('names the remote host instead of a local restart when non-local', () => {
    const msg = towerDivergenceMessage({
      status: 'stale', runningVersion: '3.1.5', installedVersion: '3.1.7', hostIsLocal: false, host: 'dev.example.com',
    });
    expect(msg).toContain('dev.example.com');
    expect(msg).not.toContain('Restart Tower to load it.');
  });
});
