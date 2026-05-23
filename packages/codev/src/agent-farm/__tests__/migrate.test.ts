/**
 * Tests for JSON to SQLite migration
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOCAL_SCHEMA } from '../db/schema.js';
import { migrateLocalFromJson } from '../db/migrate.js';

describe('Migration', () => {
  const testDir = resolve(process.cwd(), '.test-migrate');
  let db: Database.Database;

  beforeEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('migrateLocalFromJson', () => {
    beforeEach(() => {
      db = new Database(resolve(testDir, 'state.db'));
      db.pragma('journal_mode = WAL');
      db.exec(LOCAL_SCHEMA);
    });

    it('should migrate architect state', () => {
      const jsonState = {
        architect: {
          pid: 1234,
          port: 4201,
          cmd: 'claude --dangerously-skip-permissions',
          startedAt: '2024-01-01T00:00:00.000Z',
          tmuxSession: 'architect-session',
        },
        builders: [],
        utils: [],
        annotations: [],
      };

      const jsonPath = resolve(testDir, 'state.json');
      writeFileSync(jsonPath, JSON.stringify(jsonState));

      // Bugfix #826: pass workspacePath; the migrated architect row is tagged
      // with it (workspace_path is part of the composite PK in v11+).
      migrateLocalFromJson(db, jsonPath, '/workspace/legacy');

      // Spec 755: legacy singleton row migrates to architect named 'main'.
      // Bugfix #826: scoped lookup by workspace_path.
      const architect = db
        .prepare("SELECT * FROM architect WHERE workspace_path = ? AND id = 'main'")
        .get('/workspace/legacy') as any;
      expect(architect.pid).toBe(1234);
      expect(architect.port).toBe(4201);
      expect(architect.cmd).toBe('claude --dangerously-skip-permissions');
      expect(architect.workspace_path).toBe('/workspace/legacy');
      // tmux_session column removed in Spec 0104 Phase 4 — no longer migrated
    });

    it('canonicalizes workspace_path via realpath when migrating (Bugfix #826 iter-6)', () => {
      // Create a real directory and a symlink to it. migrateLocalFromJson
      // must store the realpath form so Tower's canonical-path lookups find
      // the row regardless of which form was passed in.
      const { symlinkSync, realpathSync, mkdirSync: mkSync } = require('node:fs') as typeof import('node:fs');
      const { join: pathJoin } = require('node:path') as typeof import('node:path');

      const realDir = pathJoin(testDir, 'workspace-real');
      mkSync(realDir, { recursive: true });
      const symlinkPath = pathJoin(testDir, 'workspace-symlinked');
      symlinkSync(realDir, symlinkPath, 'dir');
      const canonical = realpathSync(realDir);

      const jsonState = {
        architect: {
          pid: 1234,
          port: 4201,
          cmd: 'claude',
          startedAt: '2024-01-01T00:00:00.000Z',
        },
        builders: [],
        utils: [],
        annotations: [],
      };

      const jsonPath = resolve(testDir, 'state.json');
      writeFileSync(jsonPath, JSON.stringify(jsonState));

      // Pass the SYMLINKED form; migration must canonicalize.
      migrateLocalFromJson(db, jsonPath, symlinkPath);

      // The stored workspace_path is the canonical realpath, not the symlink.
      const row = db
        .prepare("SELECT workspace_path FROM architect WHERE id = 'main'")
        .get() as { workspace_path: string } | undefined;
      expect(row?.workspace_path).toBe(canonical);
      expect(row?.workspace_path).not.toBe(symlinkPath);
    });

    it('should migrate builders', () => {
      const jsonState = {
        architect: null,
        builders: [
          {
            id: 'B001',
            name: 'test-builder',
            port: 4210,
            pid: 5678,
            status: 'implementing',
            phase: 'init',
            worktree: '/tmp/worktree',
            branch: 'feature-branch',
            tmuxSession: 'builder-session',
            type: 'spec',
            taskText: 'Fix the bug',
            protocolName: null,
          },
        ],
        utils: [],
        annotations: [],
      };

      const jsonPath = resolve(testDir, 'state.json');
      writeFileSync(jsonPath, JSON.stringify(jsonState));

      migrateLocalFromJson(db, jsonPath, '/workspace/legacy');

      const builders = db.prepare('SELECT * FROM builders').all() as any[];
      expect(builders).toHaveLength(1);
      expect(builders[0].id).toBe('B001');
      expect(builders[0].status).toBe('implementing');
      expect(builders[0].task_text).toBe('Fix the bug');
    });

    it('should migrate utils', () => {
      const jsonState = {
        architect: null,
        builders: [],
        utils: [
          {
            id: 'U001',
            name: 'test-util',
            port: 4230,
            pid: 9012,
            tmuxSession: 'util-session',
          },
        ],
        annotations: [],
      };

      const jsonPath = resolve(testDir, 'state.json');
      writeFileSync(jsonPath, JSON.stringify(jsonState));

      migrateLocalFromJson(db, jsonPath, '/workspace/legacy');

      const utils = db.prepare('SELECT * FROM utils').all() as any[];
      expect(utils).toHaveLength(1);
      expect(utils[0].id).toBe('U001');
    });

    it('should migrate annotations', () => {
      const jsonState = {
        architect: null,
        builders: [],
        utils: [],
        annotations: [
          {
            id: 'A001',
            file: '/path/to/file.ts',
            port: 4250,
            pid: 3456,
            parent: {
              type: 'builder',
              id: 'B001',
            },
          },
        ],
      };

      const jsonPath = resolve(testDir, 'state.json');
      writeFileSync(jsonPath, JSON.stringify(jsonState));

      migrateLocalFromJson(db, jsonPath, '/workspace/legacy');

      const annotations = db.prepare('SELECT * FROM annotations').all() as any[];
      expect(annotations).toHaveLength(1);
      expect(annotations[0].file).toBe('/path/to/file.ts');
      expect(annotations[0].parent_type).toBe('builder');
      expect(annotations[0].parent_id).toBe('B001');
    });

    it('should handle empty state', () => {
      const jsonState = {
        architect: null,
        builders: [],
        utils: [],
        annotations: [],
      };

      const jsonPath = resolve(testDir, 'state.json');
      writeFileSync(jsonPath, JSON.stringify(jsonState));

      // Should not throw
      migrateLocalFromJson(db, jsonPath, '/workspace/legacy');

      const architect = db.prepare('SELECT * FROM architect').all();
      expect(architect).toHaveLength(0);
    });

    it('should rollback on error', () => {
      const jsonState = {
        architect: null,
        builders: [
          {
            id: 'B001',
            name: 'valid-builder',
            port: 4210,
            pid: 1234,
            status: 'implementing',
            phase: 'init',
            worktree: '/tmp/1',
            branch: 'test1',
            type: 'spec',
          },
          {
            id: 'B001',  // Same ID - will cause PRIMARY KEY constraint violation
            name: 'duplicate-builder',
            port: 4211,
            pid: 5678,
            status: 'implementing',
            phase: 'init',
            worktree: '/tmp/2',
            branch: 'test2',
            type: 'spec',
          },
        ],
        utils: [],
        annotations: [],
      };

      const jsonPath = resolve(testDir, 'state.json');
      writeFileSync(jsonPath, JSON.stringify(jsonState));

      // Should throw and rollback
      expect(() => migrateLocalFromJson(db, jsonPath)).toThrow();

      // No builders should be inserted due to rollback
      const builders = db.prepare('SELECT * FROM builders').all();
      expect(builders).toHaveLength(0);
    });
  });

});
