/**
 * Tests for the discoverResumeSession helper — the spawn-CLI wrapper that
 * gates findLatestSessionId on the --resume flag and surfaces a user-facing
 * log line. (Issues #829 / #831.)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';

import { discoverResumeSession } from '../commands/spawn.js';
import { encodeClaudeProjectDir } from '../utils/claude-session-discovery.js';

// discoverResumeSession reads from $HOME via os.homedir() through
// findLatestSessionId. Override the env var for the duration of the test so
// the helper looks at our fake home instead of the user's real one.
function pinHome<T>(fakeHome: string, fn: () => T): T {
  const original = process.env.HOME;
  process.env.HOME = fakeHome;
  try {
    return fn();
  } finally {
    if (original === undefined) delete process.env.HOME;
    else process.env.HOME = original;
  }
}

function writeSession(projectsRoot: string, absPath: string, uuid: string, mtimeMs: number): void {
  const dir = join(projectsRoot, encodeClaudeProjectDir(absPath));
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${uuid}.jsonl`);
  writeFileSync(file, `{"sessionId":"${uuid}"}\n`, 'utf-8');
  const t = mtimeMs / 1000;
  utimesSync(file, t, t);
}

describe('discoverResumeSession', () => {
  let fakeHome: string;
  let projectsRoot: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), 'drs-test-'));
    projectsRoot = join(fakeHome, '.claude', 'projects');
    mkdirSync(projectsRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it('returns undefined when isResume is false (no filesystem touch)', () => {
    // Even if a jsonl exists, a non-resume spawn must not pick it up.
    const worktree = '/Users/x/repo/.builders/spir-1';
    writeSession(projectsRoot, worktree, 'should-not-pick', 1_700_000_000_000);
    pinHome(fakeHome, () => {
      expect(discoverResumeSession(worktree, false)).toBeUndefined();
    });
  });

  it('returns undefined when isResume is undefined', () => {
    const worktree = '/Users/x/repo/.builders/spir-2';
    writeSession(projectsRoot, worktree, 'should-not-pick', 1_700_000_000_000);
    pinHome(fakeHome, () => {
      expect(discoverResumeSession(worktree, undefined)).toBeUndefined();
    });
  });

  it('returns undefined when isResume is true but no jsonl exists', () => {
    const worktree = '/Users/x/repo/.builders/spir-3-no-jsonl';
    pinHome(fakeHome, () => {
      expect(discoverResumeSession(worktree, true)).toBeUndefined();
    });
  });

  it('returns the newest jsonl UUID when isResume is true and jsonls exist', () => {
    const worktree = '/Users/x/repo/.builders/pir-1661';
    writeSession(projectsRoot, worktree, 'older-uuid', 1_500_000_000_000);
    writeSession(projectsRoot, worktree, 'newest-uuid', 1_700_000_000_000);
    pinHome(fakeHome, () => {
      expect(discoverResumeSession(worktree, true)).toBe('newest-uuid');
    });
  });

  it('does not consult the filesystem when isResume is false (perf safety)', () => {
    // Negative case: isResume=false short-circuits before any filesystem
    // access happens. Tests pass even if HOME points at /nonexistent.
    pinHome('/nonexistent-home-path', () => {
      expect(discoverResumeSession('/some/worktree', false)).toBeUndefined();
    });
  });
});
