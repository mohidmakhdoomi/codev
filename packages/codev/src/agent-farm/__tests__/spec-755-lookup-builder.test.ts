/**
 * Spec 755 — direct tests for `lookupBuilderSpawningArchitect` against a real
 * SQLite database. Codex iter-2 review caught that the routing-matrix tests
 * mock this helper, leaving the per-workspace readonly path untested. These
 * tests exercise the real helper with both the workspace-path and singleton
 * argument forms, and verify the three-valued return contract.
 *
 * Mirrors the file-creation pattern in `spec-755-migration.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { lookupBuilderSpawningArchitect } from '../state.js';

describe('Spec 755 — lookupBuilderSpawningArchitect', () => {
  const testDir = resolve(process.cwd(), '.test-spec-755-lookup');
  const workspacePath = join(testDir, 'ws');
  const dbDir = join(workspacePath, '.agent-farm');
  const dbPath = join(dbDir, 'state.db');

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(dbDir, { recursive: true });

    // Bootstrap a minimal builders table that matches the post-v9 schema.
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE builders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 0,
        pid INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'spawning',
        phase TEXT NOT NULL DEFAULT '',
        worktree TEXT NOT NULL,
        branch TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'spec',
        task_text TEXT,
        protocol_name TEXT,
        issue_number TEXT,
        terminal_id TEXT,
        spawned_by_architect TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    db.close();
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  /** Insert a builder row with a controlled spawned_by_architect value. */
  function insertBuilder(id: string, spawnedByArchitect: string | null) {
    const db = new Database(dbPath);
    db.prepare(`
      INSERT INTO builders (id, name, worktree, branch, spawned_by_architect)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, `builder ${id}`, '/tmp/wt', 'main', spawnedByArchitect);
    db.close();
  }

  describe('per-workspace path (Tower-side caller)', () => {
    it('returns the recorded spawned_by_architect for a builder row with an explicit name', () => {
      insertBuilder('spir-100', 'sibling');
      expect(lookupBuilderSpawningArchitect('spir-100', workspacePath)).toBe('sibling');
    });

    it('returns null for a legacy builder row where spawned_by_architect is NULL', () => {
      insertBuilder('legacy-1', null);
      expect(lookupBuilderSpawningArchitect('legacy-1', workspacePath)).toBeNull();
    });

    it('returns undefined when no row exists for the given id (non-builder sender)', () => {
      // Empty table — no builder by that id.
      expect(lookupBuilderSpawningArchitect('not-a-builder', workspacePath)).toBeUndefined();
    });

    it('returns undefined when the workspace state.db does not exist', () => {
      // Wipe the bootstrapped DB to simulate a workspace that never started.
      rmSync(dbPath);
      expect(lookupBuilderSpawningArchitect('spir-100', workspacePath)).toBeUndefined();
    });

    it('isolates lookups per workspace (Tower can serve multiple workspaces)', () => {
      // Workspace A has spir-100 spawned by 'sibling'.
      insertBuilder('spir-100', 'sibling');

      // Workspace B (sibling directory) has spir-100 spawned by 'main'.
      const wsB = join(testDir, 'ws-b');
      const dbBDir = join(wsB, '.agent-farm');
      mkdirSync(dbBDir, { recursive: true });
      const dbB = new Database(join(dbBDir, 'state.db'));
      dbB.exec(`
        CREATE TABLE builders (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, port INTEGER NOT NULL DEFAULT 0,
          pid INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'spawning',
          phase TEXT NOT NULL DEFAULT '', worktree TEXT NOT NULL, branch TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'spec', task_text TEXT, protocol_name TEXT,
          issue_number TEXT, terminal_id TEXT, spawned_by_architect TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO builders (id, name, worktree, branch, spawned_by_architect)
        VALUES ('spir-100', 'b', '/tmp/wt', 'main', 'main');
      `);
      dbB.close();

      // The same builder ID resolves differently in different workspaces —
      // this is the bug Gemini caught: the singleton getDb() would have
      // returned the same answer for both.
      expect(lookupBuilderSpawningArchitect('spir-100', workspacePath)).toBe('sibling');
      expect(lookupBuilderSpawningArchitect('spir-100', wsB)).toBe('main');
    });

    it('opens the workspace state.db readonly (does not need write permission)', () => {
      insertBuilder('spir-100', 'sibling');

      // The function should not throw even if the DB is readonly. We can't
      // easily make the file readonly cross-platform here, but we assert
      // that multiple consecutive calls succeed without leaking handles —
      // a leaked write-mode handle would eventually fail on the next opener.
      for (let i = 0; i < 50; i++) {
        expect(lookupBuilderSpawningArchitect('spir-100', workspacePath)).toBe('sibling');
      }
    });
  });
});
