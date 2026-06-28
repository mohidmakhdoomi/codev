/**
 * Tests for Claude session discovery via on-disk jsonl introspection.
 *
 * Issue #829 — conversation resume.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { existsSync } from 'node:fs';

import {
  encodeClaudeProjectDir,
  findLatestSessionId,
  architectSessionId,
  sessionFileExists,
  deleteArchitectSessionFile,
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

describe('architectSessionId (Issue #832)', () => {
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

  it('produces a canonical-format UUIDv5 (version 5, RFC-4122 variant)', () => {
    const id = architectSessionId('/Users/x/repo', 'main');
    expect(id).toMatch(UUID_RE);
  });

  it('is deterministic — same (workspace, name) → same id', () => {
    const a = architectSessionId('/Users/x/repo', 'reviewer');
    const b = architectSessionId('/Users/x/repo', 'reviewer');
    expect(a).toBe(b);
  });

  it('is name-sensitive — different names in the SAME cwd derive different ids', () => {
    // This is the core disambiguation: siblings share a cwd but must not collide.
    const main = architectSessionId('/Users/x/repo', 'main');
    const reviewer = architectSessionId('/Users/x/repo', 'reviewer');
    const casa = architectSessionId('/Users/x/repo', 'casa');
    expect(new Set([main, reviewer, casa]).size).toBe(3);
  });

  it('is cwd-sensitive — same name in different workspaces derive different ids', () => {
    const a = architectSessionId('/Users/x/repo-a', 'main');
    const b = architectSessionId('/Users/x/repo-b', 'main');
    expect(a).not.toBe(b);
  });
});

describe('sessionFileExists / deleteArchitectSessionFile (Issue #832)', () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'csd-arch-'));
    mkdirSync(join(fakeHome, '.claude', 'projects'), { recursive: true });
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  function seedSession(absPath: string, uuid: string): string {
    const dir = join(fakeHome, '.claude', 'projects', encodeClaudeProjectDir(absPath));
    mkdirSync(dir, { recursive: true });
    const file = join(dir, `${uuid}.jsonl`);
    writeFileSync(file, `{"sessionId":"${uuid}"}\n`, 'utf-8');
    return file;
  }

  it('sessionFileExists is true only when the jsonl is present', () => {
    const ws = '/Users/x/repo';
    const id = architectSessionId(ws, 'reviewer');
    expect(sessionFileExists(ws, id, { homeDir: fakeHome })).toBe(false);
    seedSession(ws, id);
    expect(sessionFileExists(ws, id, { homeDir: fakeHome })).toBe(true);
  });

  it('deleteArchitectSessionFile removes the derived jsonl', () => {
    const ws = '/Users/x/repo';
    const id = architectSessionId(ws, 'reviewer');
    const file = seedSession(ws, id);
    expect(existsSync(file)).toBe(true);
    deleteArchitectSessionFile(ws, 'reviewer', { homeDir: fakeHome });
    expect(existsSync(file)).toBe(false);
  });

  it('deleteArchitectSessionFile is a no-op when the jsonl is absent', () => {
    expect(() =>
      deleteArchitectSessionFile('/Users/x/repo', 'reviewer', { homeDir: fakeHome }),
    ).not.toThrow();
  });

  it('deleteArchitectSessionFile only removes the named architect’s session', () => {
    const ws = '/Users/x/repo';
    const reviewerId = architectSessionId(ws, 'reviewer');
    const mainId = architectSessionId(ws, 'main');
    const reviewerFile = seedSession(ws, reviewerId);
    const mainFile = seedSession(ws, mainId);
    deleteArchitectSessionFile(ws, 'reviewer', { homeDir: fakeHome });
    expect(existsSync(reviewerFile)).toBe(false);
    expect(existsSync(mainFile)).toBe(true);
  });
});
