/**
 * Regression tests for #1113: `consult --type integration` had no way to anchor
 * the diff on a long-lived integration branch ahead of the default branch, so
 * it inherited the PR's host-recorded base (`gh pr diff`) and produced 10k+ line
 * diffs that overflowed the reviewer.
 *
 * The fix adds a base override (`--base <ref>` flag / `consult.integrationBranch`
 * config) that computes the diff locally as `git diff origin/<base>...origin/<head>`
 * (three-dot), mirroring the hardened `--type impl` path. Default behavior (no
 * override) is unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

import {
  _computeLocalPRDiff as computeLocalPRDiff,
  _resolveIntegrationBase as resolveIntegrationBase,
} from '../commands/consult/index.js';
import { consult } from '../commands/consult/index.js';

function shell(cmd: string, cwd: string): void {
  execSync(cmd, { cwd, stdio: 'pipe' });
}

describe('#1113 computeLocalPRDiff anchors on the integration branch (three-dot)', () => {
  let workDir: string;
  let originDir: string;

  beforeEach(() => {
    originDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b1113-origin-'));
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b1113-work-'));

    // Bare origin + a working clone (so origin/* tracking refs exist locally).
    execSync(`git init --bare -b main "${originDir}"`, { stdio: 'pipe' });
    execSync(`git clone "${originDir}" "${workDir}"`, { stdio: 'pipe' });
    shell('git config user.email "test@test.com"', workDir);
    shell('git config user.name "Test"', workDir);

    // main: shared baseline.
    fs.writeFileSync(path.join(workDir, 'shared.txt'), 'shared baseline\n');
    shell('git add shared.txt', workDir);
    shell('git commit -m "initial on main"', workDir);
    shell('git push origin main', workDir);

    // ci: long-lived integration branch, well ahead of main (big delta).
    shell('git checkout -b ci', workDir);
    fs.writeFileSync(
      path.join(workDir, 'ci-big.txt'),
      Array.from({ length: 500 }, (_, i) => `ci line ${i}`).join('\n') + '\n',
    );
    shell('git add ci-big.txt', workDir);
    shell('git commit -m "advance ci far ahead of main"', workDir);
    shell('git push origin ci', workDir);

    // feature: branched off ci, small change. On the host the PR targets main.
    shell('git checkout -b feature', workDir);
    fs.writeFileSync(path.join(workDir, 'feature.txt'), 'the actual PR change\n');
    shell('git add feature.txt', workDir);
    shell('git commit -m "feature work"', workDir);
    shell('git push origin feature', workDir);
  });

  afterEach(() => {
    fs.rmSync(workDir, { recursive: true, force: true });
    fs.rmSync(originDir, { recursive: true, force: true });
  });

  it('three-dot against the integration branch yields ONLY the PR change', () => {
    const { diff, changedFiles } = computeLocalPRDiff(workDir, 'ci', 'feature');
    expect(changedFiles).toEqual(['feature.txt']);
    expect(diff).toContain('the actual PR change');
    // The ci-over-main delta — the overflow source — must be excluded.
    expect(diff).not.toContain('ci line 0');
    expect(diff).not.toContain('shared baseline');
  });

  it('demonstrates the bug: anchoring on main sweeps in the whole ci delta', () => {
    // What `gh pr diff` (PR base = main) surfaces: the feature change PLUS the
    // entire ci-over-main delta — the 10k-line overflow the issue reports.
    const { changedFiles } = computeLocalPRDiff(workDir, 'main', 'feature');
    expect(changedFiles).toContain('feature.txt');
    expect(changedFiles).toContain('ci-big.txt');
  });

  it('fails loudly with a `git fetch` hint when the base ref is unresolvable', () => {
    expect(() => computeLocalPRDiff(workDir, 'does-not-exist', 'feature')).toThrow(/git fetch/);
  });

  it('fails loudly when the head ref is unresolvable (no silent local-tree fallback)', () => {
    expect(() => computeLocalPRDiff(workDir, 'ci', 'no-such-head')).toThrow(/git fetch/);
  });
});

describe('#1113 resolveIntegrationBase precedence', () => {
  let workDir: string;
  let origHome: string | undefined;

  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'b1113-cfg-'));
    // Redirect HOME so the global ~/.codev/config.json layer can't make the
    // "no override → undefined" assertion machine-dependent (matches the
    // isolation pattern in config.test.ts).
    origHome = process.env.HOME;
    process.env.HOME = path.join(workDir, 'fake-home');
  });

  afterEach(() => {
    process.env.HOME = origHome;
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  function writeProjectConfig(config: Record<string, unknown>): void {
    const dir = path.join(workDir, '.codev');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config));
  }

  it('returns undefined with no flag and no config (default → gh pr diff, unchanged)', () => {
    writeProjectConfig({});
    expect(resolveIntegrationBase(workDir, undefined)).toBeUndefined();
  });

  it('reads consult.integrationBranch from config when no flag is given', () => {
    writeProjectConfig({ consult: { integrationBranch: 'ci' } });
    expect(resolveIntegrationBase(workDir, undefined)).toBe('ci');
  });

  it('the --base flag overrides config (flag precedence)', () => {
    writeProjectConfig({ consult: { integrationBranch: 'ci' } });
    expect(resolveIntegrationBase(workDir, 'release-2.0')).toBe('release-2.0');
  });

  it('propagates a malformed-config error instead of silently reverting to gh pr diff', () => {
    // CMAP (codex) finding: swallowing loadConfig errors would let a broken
    // consult.integrationBranch quietly fall back to the host base — the exact
    // overflow this fix prevents. The error must surface like every other
    // loadConfig caller.
    const dir = path.join(workDir, '.codev');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), '{ not valid json');
    expect(() => resolveIntegrationBase(workDir, undefined)).toThrow(/parse/i);
  });

  it('the explicit --base flag still works even with a broken config (short-circuits the read)', () => {
    const dir = path.join(workDir, '.codev');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), '{ not valid json');
    expect(resolveIntegrationBase(workDir, 'ci')).toBe('ci');
  });
});

describe('#1113 --base is rejected outside --type integration (fail-fast)', () => {
  it('throws when --base is used with a non-integration type', async () => {
    await expect(
      consult({ model: 'codex', type: 'impl', base: 'ci' }),
    ).rejects.toThrow(/--base only applies to --type integration/);
  });
});
