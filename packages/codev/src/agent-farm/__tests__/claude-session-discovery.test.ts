/**
 * Tests for Claude session discovery via on-disk jsonl introspection.
 *
 * Issue #829 — conversation resume.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  encodeClaudeProjectDir,
  findLatestSessionId,
  captureRunningClaudeSession,
} from '../utils/claude-session-discovery.js';

describe('encodeClaudeProjectDir', () => {
  it('replaces / with -', () => {
    expect(encodeClaudeProjectDir('/Users/x/repo')).toBe('-Users-x-repo');
  });

  it('replaces . with -', () => {
    expect(encodeClaudeProjectDir('/Users/x/repo/.builders/pir-1')).toBe(
      '-Users-x-repo--builders-pir-1',
    );
  });

  it('leaves dashes in the source path untouched', () => {
    expect(encodeClaudeProjectDir('/Users/x/repo/pir-1298')).toBe(
      '-Users-x-repo-pir-1298',
    );
  });

  it('handles paths with multiple dots and slashes', () => {
    expect(encodeClaudeProjectDir('/a/b.c/.d.e/f')).toBe('-a-b-c--d-e-f');
  });
});

describe('findLatestSessionId', () => {
  let fakeHome: string;
  let projectsRoot: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'csd-test-'));
    projectsRoot = join(fakeHome, '.claude', 'projects');
    mkdirSync(projectsRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function writeSession(absPath: string, uuid: string, mtime: number): void {
    const dir = join(projectsRoot, encodeClaudeProjectDir(absPath));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${uuid}.jsonl`);
    writeFileSync(file, `{"sessionId":"${uuid}"}\n`, 'utf-8');
    const t = mtime / 1000;
    utimesSync(file, t, t);
  }

  it('returns the newest session UUID by mtime', () => {
    const worktree = '/Users/x/repo/.builders/pir-1';
    writeSession(worktree, 'old-uuid', 1_000_000_000_000);
    writeSession(worktree, 'newest-uuid', 1_700_000_000_000);
    writeSession(worktree, 'middle-uuid', 1_400_000_000_000);
    expect(findLatestSessionId(worktree, { homeDir: fakeHome })).toBe('newest-uuid');
  });

  it('returns null when the project dir does not exist', () => {
    expect(findLatestSessionId('/nonexistent/path', { homeDir: fakeHome })).toBeNull();
  });

  it('returns null when the project dir exists but contains no jsonl files', () => {
    const worktree = '/Users/x/repo/.builders/pir-2';
    const dir = join(projectsRoot, encodeClaudeProjectDir(worktree));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'memory'), 'not a jsonl', 'utf-8');
    expect(findLatestSessionId(worktree, { homeDir: fakeHome })).toBeNull();
  });

  it('ignores non-jsonl files and subdirectories', () => {
    const worktree = '/Users/x/repo/.builders/pir-3';
    const dir = join(projectsRoot, encodeClaudeProjectDir(worktree));
    mkdirSync(dir, { recursive: true });
    mkdirSync(join(dir, 'some-uuid'), { recursive: true });
    writeFileSync(join(dir, 'history.txt'), 'text', 'utf-8');
    writeSession(worktree, 'the-uuid', 1_500_000_000_000);
    expect(findLatestSessionId(worktree, { homeDir: fakeHome })).toBe('the-uuid');
  });

  it('returns the single jsonl when only one exists', () => {
    const worktree = '/Users/x/repo/.builders/pir-4';
    writeSession(worktree, 'only-uuid', 1_500_000_000_000);
    expect(findLatestSessionId(worktree, { homeDir: fakeHome })).toBe('only-uuid');
  });
});

describe('captureRunningClaudeSession (Issue #832)', () => {
  let fakeHome: string;
  const ws = '/Users/x/repo';

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'csd-cap-'));
    mkdirSync(join(fakeHome, '.claude', 'projects'), { recursive: true });
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function seedSession(uuid: string): void {
    const dir = join(fakeHome, '.claude', 'projects', encodeClaudeProjectDir(ws));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${uuid}.jsonl`), `{"sessionId":"${uuid}"}\n`, 'utf-8');
  }

  // The current process holds no jsonl under the FAKE home open, so lsof
  // correlation finds nothing — exercising the sole-architect fallback and the
  // multi-architect "no match" path deterministically. (The lsof success path is
  // integration-tested manually at the dev-approval gate.)

  it('sole architect: falls back to newest-by-mtime when process correlation finds nothing', () => {
    seedSession('only-session');
    const id = captureRunningClaudeSession(ws, process.pid, { soleArchitect: true, homeDir: fakeHome });
    expect(id).toBe('only-session');
  });

  it('multiple architects: returns null when process correlation finds nothing (no mtime guess)', () => {
    seedSession('ambiguous-a');
    seedSession('ambiguous-b');
    const id = captureRunningClaudeSession(ws, process.pid, { soleArchitect: false, homeDir: fakeHome });
    expect(id).toBeNull();
  });

  it('returns null for a sole architect with no session on disk', () => {
    const id = captureRunningClaudeSession(ws, process.pid, { soleArchitect: true, homeDir: fakeHome });
    expect(id).toBeNull();
  });
});
