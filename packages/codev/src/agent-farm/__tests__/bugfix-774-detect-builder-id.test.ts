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

import { detectCurrentBuilderId } from '../commands/send.js';
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

  it('falls back to worktree dir name when workspace state.db is missing', () => {
    rmSync(join(workspacePath, '.agent-farm'), { recursive: true });
    process.chdir(worktreePath);
    expect(detectCurrentBuilderId()).toBe('bugfix-1599');
  });

  it('falls back to worktree dir name when no row matches', () => {
    // Workspace DB exists but has no row for this worktree.
    const wsDb = new Database(join(workspacePath, '.agent-farm', 'state.db'));
    wsDb.prepare('DELETE FROM builders').run();
    wsDb.close();

    process.chdir(worktreePath);
    expect(detectCurrentBuilderId()).toBe('bugfix-1599');
  });

  it('returns null when not in a builder worktree', () => {
    process.chdir(workspacePath);
    expect(detectCurrentBuilderId()).toBeNull();
  });
});
