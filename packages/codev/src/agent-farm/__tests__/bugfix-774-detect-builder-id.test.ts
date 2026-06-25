/**
 * Regression test for Issue #774: Builder→architect messages misrouted when
 * worktree has its own state.db.
 *
 * The bug: `detectCurrentBuilderId()` used `loadState()` (singleton getDb()),
 * which resolves to the worktree's own .agent-farm/state.db when CWD is
 * inside `.builders/<id>/`. The worktree DB is empty, so the lookup falls
 * back to the worktree directory name (e.g. `bugfix-774`) instead of the
 * canonical builder ID (`builder-bugfix-774`). That breaks affinity routing
 * downstream — the sibling architect that spawned the builder is bypassed
 * and the message lands on 'main'.
 *
 * Fix: open the workspace's state.db directly (not the singleton).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';

import {
  detectCurrentBuilderId,
  BuilderIdResolutionError,
  describeStateDbOpenFailure,
} from '../commands/send.js';
import { LOCAL_SCHEMA } from '../db/schema.js';

function writeBuilderRow(dbPath: string, id: string, worktree: string): void {
  const db = new Database(dbPath);
  db.exec(LOCAL_SCHEMA);
  db.prepare(
    `INSERT INTO builders (id, name, worktree, branch, type, status, spawned_by_architect)
     VALUES (?, ?, ?, ?, 'bugfix', 'implementing', 'ob-refine')`,
  ).run(id, id, worktree, `builder/${id}`);
  db.close();
}

describe('detectCurrentBuilderId — issue #774', () => {
  let tmpRoot: string;
  let workspacePath: string;
  let worktreePath: string;
  const origCwd = process.cwd();

  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'bugfix-774-'));
    workspacePath = join(tmpRoot, 'workspace');
    worktreePath = join(workspacePath, '.builders', 'bugfix-1599');

    mkdirSync(join(workspacePath, '.agent-farm'), { recursive: true });
    mkdirSync(worktreePath, { recursive: true });

    // Populate the WORKSPACE state.db with the canonical builder row.
    writeBuilderRow(
      join(workspacePath, '.agent-farm', 'state.db'),
      'builder-bugfix-1599',
      worktreePath,
    );
  });

  afterEach(() => {
    process.chdir(origCwd);
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('returns canonical ID when CWD is the worktree and worktree has no state.db', () => {
    process.chdir(worktreePath);
    expect(detectCurrentBuilderId()).toBe('builder-bugfix-1599');
  });

  it('returns canonical ID even when worktree has its own EMPTY state.db (the original bug)', () => {
    // Simulate the v3.0.5 bug: the worktree opened its own state.db (created
    // by a stray getDb() call) which has zero builder rows.
    mkdirSync(join(worktreePath, '.agent-farm'), { recursive: true });
    const worktreeDbPath = join(worktreePath, '.agent-farm', 'state.db');
    const emptyDb = new Database(worktreeDbPath);
    emptyDb.exec(LOCAL_SCHEMA);
    emptyDb.close();

    process.chdir(worktreePath);
    expect(detectCurrentBuilderId()).toBe('builder-bugfix-1599');
  });

  // Issue #1094: in a confirmed builder worktree, an inability to verify the
  // canonical id is an ERROR — never a silent bare-name fallback (which would
  // misroute `afx send architect` to 'main'). The three unverifiable paths
  // below must all throw rather than return the bare worktree dir name.

  it('throws (does not return bare name) when workspace state.db is missing', () => {
    rmSync(join(workspacePath, '.agent-farm'), { recursive: true });
    process.chdir(worktreePath);
    expect(() => detectCurrentBuilderId()).toThrow(BuilderIdResolutionError);
    expect(() => detectCurrentBuilderId()).toThrow(/bugfix-1599/);
  });

  it('throws (does not return bare name) when no builder row matches', () => {
    // Workspace DB exists but has no row for this worktree.
    const wsDb = new Database(join(workspacePath, '.agent-farm', 'state.db'));
    wsDb.prepare('DELETE FROM builders').run();
    wsDb.close();

    process.chdir(worktreePath);
    expect(() => detectCurrentBuilderId()).toThrow(BuilderIdResolutionError);
    expect(() => detectCurrentBuilderId()).toThrow(/no matching builder row/);
  });

  it('throws (does not return bare name) when state.db cannot be opened — issue #1094', () => {
    // The real incident: a Node ABI mismatch made `new Database()` throw, and
    // the old `catch { return worktreeDirName }` swallowed it, shipping the
    // bare name `bugfix-1599`. Simulate an unopenable DB by replacing the file
    // with a directory at the same path (existsSync passes; open throws).
    rmSync(join(workspacePath, '.agent-farm'), { recursive: true });
    mkdirSync(join(workspacePath, '.agent-farm', 'state.db'), { recursive: true });

    process.chdir(worktreePath);

    // Must NOT silently return the bare worktree directory name.
    let returned: string | null | undefined;
    try {
      returned = detectCurrentBuilderId();
    } catch (err) {
      expect(err).toBeInstanceOf(BuilderIdResolutionError);
      expect((err as Error).message).toContain('bugfix-1599');
      expect((err as Error).message).not.toBe('bugfix-1599');
      expect((err as Error).message).toMatch(/issue #1094/);
      return;
    }
    // Reaching here means it returned instead of throwing — fail loudly.
    expect(returned).toBeUndefined(); // never reached if it threw; asserts no silent bare-name
    throw new Error(`Expected a throw, got a silent return of '${returned}'`);
  });

  it('returns null when not in a builder worktree', () => {
    process.chdir(workspacePath);
    expect(detectCurrentBuilderId()).toBeNull();
  });
});

describe('describeStateDbOpenFailure — issue #1094 actionable messages', () => {
  it('names the better-sqlite3 ABI mismatch and points at reinstalling codev', () => {
    const abiErr = new Error(
      "The module was compiled against a different Node.js version using NODE_MODULE_VERSION 147. " +
        "This version of Node.js requires NODE_MODULE_VERSION 127.",
    );
    const msg = describeStateDbOpenFailure('/ws/.agent-farm/state.db', 'bugfix-2461', abiErr);
    expect(msg).toMatch(/ABI mismatch/i);
    expect(msg).toMatch(/reinstall codev/i);
    expect(msg).toContain('bugfix-2461');
    expect(msg).toMatch(/issue #1094/);
  });

  it('gives a generic hint for non-ABI open failures', () => {
    const msg = describeStateDbOpenFailure('/ws/.agent-farm/state.db', 'bugfix-2461', new Error('disk I/O error'));
    expect(msg).toMatch(/corruption|permissions|stale lock/i);
    expect(msg).not.toMatch(/ABI mismatch/i);
    expect(msg).toContain('bugfix-2461');
  });
});
