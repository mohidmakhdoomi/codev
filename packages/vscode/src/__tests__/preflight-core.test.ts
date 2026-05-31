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
  resolveCodevPath,
  decidePreflight,
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
