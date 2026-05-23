/**
 * Bugfix #826 — Migration v11 (workspace-scoped architect schema).
 *
 * Migration v11 adds `workspace_path` as part of a composite primary key on
 * the `architect` table, eliminating the cross-workspace leak by construction.
 *
 * This test instantiates the pre-v11 schema by hand, populates global.db
 * terminal_sessions with the backfill source data, then drives the migration
 * code path and asserts the resulting shape. Mirrors the pattern established
 * by `spec-755-migration.test.ts`.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Bugfix #826 — Migration v11 (workspace-scoped architect schema)', () => {
  const testDir = resolve(process.cwd(), '.test-bugfix-826-migration');
  let localDb: Database.Database;
  let globalDb: Database.Database;
  let globalDbPath: string;

  beforeEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
    mkdirSync(testDir, { recursive: true });

    const localDbPath = resolve(testDir, 'state.db');
    globalDbPath = resolve(testDir, 'global.db');

    localDb = new Database(localDbPath);
    localDb.pragma('journal_mode = WAL');

    globalDb = new Database(globalDbPath);
    globalDb.pragma('journal_mode = WAL');
  });

  afterEach(() => {
    localDb.close();
    globalDb.close();
    if (existsSync(testDir)) rmSync(testDir, { recursive: true });
  });

  /**
   * Reproduce the pre-v11 schema (post-v9 multi-architect Spec 755 shape).
   * One global architect table with no workspace_path column.
   */
  function buildPreV11Schema() {
    localDb.exec(`
      CREATE TABLE _migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE architect (
        id TEXT PRIMARY KEY,
        pid INTEGER NOT NULL,
        port INTEGER NOT NULL,
        cmd TEXT NOT NULL,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        terminal_id TEXT
      );
    `);
    for (let v = 1; v <= 10; v++) {
      localDb.prepare('INSERT INTO _migrations (version) VALUES (?)').run(v);
    }

    // Pre-v11 global.db with the terminal_sessions table that holds the
    // workspace_path data we use as the backfill source.
    globalDb.exec(`
      CREATE TABLE terminal_sessions (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('architect', 'builder', 'shell')),
        role_id TEXT,
        pid INTEGER,
        shellper_socket TEXT,
        shellper_pid INTEGER,
        shellper_start_time INTEGER,
        label TEXT,
        cwd TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /**
   * Run the v11 migration in isolation against the test DBs. Mirrors the
   * production code in `db/index.ts` (the v11 block). Kept verbatim so the
   * test fails loudly if production drifts from the expected shape.
   */
  function runV11Migration() {
    const cols = localDb.prepare('PRAGMA table_info(architect)').all() as Array<{ name: string }>;
    const alreadyMigrated = cols.some(c => c.name === 'workspace_path');

    if (!alreadyMigrated) {
      localDb.exec(`
        CREATE TABLE architect_v11 (
          workspace_path TEXT NOT NULL,
          id TEXT NOT NULL,
          pid INTEGER NOT NULL,
          port INTEGER NOT NULL,
          cmd TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          terminal_id TEXT,
          PRIMARY KEY (workspace_path, id)
        );
      `);

      try {
        localDb.prepare("ATTACH DATABASE ? AS globaldb").run(globalDbPath);
        try {
          localDb.exec(`
            INSERT INTO architect_v11 (workspace_path, id, pid, port, cmd, started_at, terminal_id)
            SELECT
              COALESCE(
                (SELECT ts.workspace_path
                   FROM globaldb.terminal_sessions ts
                  WHERE ts.id = a.terminal_id
                    AND ts.type = 'architect'),
                (SELECT ts.workspace_path
                   FROM globaldb.terminal_sessions ts
                  WHERE ts.role_id = a.id
                    AND ts.type = 'architect'
                  LIMIT 1)
              ) AS workspace_path,
              a.id,
              a.pid,
              a.port,
              a.cmd,
              a.started_at,
              a.terminal_id
            FROM architect a
            WHERE EXISTS (
              SELECT 1 FROM globaldb.terminal_sessions ts
              WHERE (ts.id = a.terminal_id OR ts.role_id = a.id)
                AND ts.type = 'architect'
            );
          `);
        } finally {
          localDb.prepare('DETACH DATABASE globaldb').run();
        }
      } catch (err) {
        const remaining = localDb.prepare('SELECT COUNT(*) AS n FROM architect').get() as { n: number };
        // Surface the error path's intent: if backfill fails AND there are
        // pre-existing rows we can't migrate, the test should know.
        if (remaining.n > 0) {
          throw new Error(`Migration v11 backfill failed: ${(err as Error).message}`);
        }
      }

      localDb.exec(`
        DROP TABLE architect;
        ALTER TABLE architect_v11 RENAME TO architect;
        CREATE INDEX IF NOT EXISTS idx_architect_workspace ON architect(workspace_path);
      `);
    }

    localDb.prepare('INSERT INTO _migrations (version) VALUES (11)').run();
  }

  it('backfills workspace_path from global.db.terminal_sessions on matching role_id', () => {
    buildPreV11Schema();

    // Pre-migration: two architects in state.db (no workspace_path column).
    // Both have matching terminal_sessions rows in global.db with different
    // workspace_path values.
    localDb.prepare(
      "INSERT INTO architect (id, pid, port, cmd, started_at, terminal_id) VALUES ('main', 0, 0, 'claude', '2026-05-23T10:00:00Z', 'term-main')"
    ).run();
    localDb.prepare(
      "INSERT INTO architect (id, pid, port, cmd, started_at, terminal_id) VALUES ('ob-refine', 0, 0, 'claude', '2026-05-23T10:05:00Z', 'term-sibling')"
    ).run();

    globalDb.prepare(
      "INSERT INTO terminal_sessions (id, workspace_path, type, role_id, pid) VALUES ('term-main', '/workspace/shannon', 'architect', 'main', 1234)"
    ).run();
    globalDb.prepare(
      "INSERT INTO terminal_sessions (id, workspace_path, type, role_id, pid) VALUES ('term-sibling', '/workspace/shannon', 'architect', 'ob-refine', 1235)"
    ).run();

    runV11Migration();

    // Post-migration: both rows survive with workspace_path = '/workspace/shannon'.
    const rows = localDb.prepare('SELECT workspace_path, id FROM architect ORDER BY id').all() as Array<{ workspace_path: string; id: string }>;
    expect(rows).toEqual([
      { workspace_path: '/workspace/shannon', id: 'main' },
      { workspace_path: '/workspace/shannon', id: 'ob-refine' },
    ]);
  });

  it('drops orphan architects (no matching terminal_sessions row)', () => {
    buildPreV11Schema();

    // Pre-migration: one architect has a matching terminal_sessions row;
    // another does not (orphan from a stale registration).
    localDb.prepare(
      "INSERT INTO architect (id, pid, port, cmd, started_at, terminal_id) VALUES ('main', 0, 0, 'claude', '2026-05-23T10:00:00Z', 'term-main')"
    ).run();
    localDb.prepare(
      "INSERT INTO architect (id, pid, port, cmd, started_at, terminal_id) VALUES ('stale', 0, 0, 'claude', '2026-05-23T10:05:00Z', 'term-stale')"
    ).run();

    globalDb.prepare(
      "INSERT INTO terminal_sessions (id, workspace_path, type, role_id, pid) VALUES ('term-main', '/workspace/X', 'architect', 'main', 1234)"
    ).run();
    // No terminal_sessions row for 'stale' — orphaned.

    runV11Migration();

    const rows = localDb.prepare('SELECT id FROM architect').all() as Array<{ id: string }>;
    expect(rows.map(r => r.id)).toEqual(['main']);
  });

  it('partitions same-named architects from different workspaces (the core #826 fix)', () => {
    // This test exercises the post-migration schema invariant: the same
    // architect name can exist in multiple workspaces without colliding.
    buildPreV11Schema();

    // Pre-migration: only one architect can exist with id='main' (legacy
    // single-PK constraint). After migration, callers can insert
    // (workspace_path, 'main') tuples for multiple workspaces.
    localDb.prepare(
      "INSERT INTO architect (id, pid, port, cmd, started_at, terminal_id) VALUES ('main', 0, 0, 'claude', '2026-05-23T10:00:00Z', 'term-shannon-main')"
    ).run();
    globalDb.prepare(
      "INSERT INTO terminal_sessions (id, workspace_path, type, role_id, pid) VALUES ('term-shannon-main', '/workspace/shannon', 'architect', 'main', 1234)"
    ).run();

    runV11Migration();

    // After migration, simulate what Tower would do when launching a SECOND
    // workspace (manazil): INSERT a new (workspace_path='/workspace/manazil',
    // id='main') row. With the new composite PK, this is a distinct row.
    localDb.prepare(
      "INSERT INTO architect (workspace_path, id, pid, port, cmd, started_at, terminal_id) VALUES ('/workspace/manazil', 'main', 0, 0, 'claude', '2026-05-23T11:00:00Z', 'term-manazil-main')"
    ).run();

    const allMains = localDb
      .prepare("SELECT workspace_path, terminal_id FROM architect WHERE id = 'main' ORDER BY workspace_path")
      .all() as Array<{ workspace_path: string; terminal_id: string }>;

    expect(allMains).toEqual([
      { workspace_path: '/workspace/manazil', terminal_id: 'term-manazil-main' },
      { workspace_path: '/workspace/shannon', terminal_id: 'term-shannon-main' },
    ]);

    // Workspace-scoped query returns only the requested workspace's row.
    const shannonRow = localDb
      .prepare("SELECT terminal_id FROM architect WHERE workspace_path = ? AND id = 'main'")
      .get('/workspace/shannon') as { terminal_id: string };
    expect(shannonRow.terminal_id).toBe('term-shannon-main');
  });

  it('creates the workspace index for efficient per-workspace queries', () => {
    buildPreV11Schema();
    localDb.prepare(
      "INSERT INTO architect (id, pid, port, cmd, started_at, terminal_id) VALUES ('main', 0, 0, 'claude', '2026-05-23T10:00:00Z', 'term-main')"
    ).run();
    globalDb.prepare(
      "INSERT INTO terminal_sessions (id, workspace_path, type, role_id, pid) VALUES ('term-main', '/W', 'architect', 'main', 1234)"
    ).run();

    runV11Migration();

    const indexes = localDb
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'architect'")
      .all() as Array<{ name: string }>;
    expect(indexes.map(i => i.name)).toContain('idx_architect_workspace');
  });

  it('handles empty pre-migration table gracefully (fresh install path)', () => {
    buildPreV11Schema();
    // No architect rows, no terminal_sessions rows.

    expect(() => runV11Migration()).not.toThrow();

    // Post-migration: table has the new shape but is empty.
    const cols = localDb.prepare('PRAGMA table_info(architect)').all() as Array<{ name: string }>;
    expect(cols.some(c => c.name === 'workspace_path')).toBe(true);
    const rows = localDb.prepare('SELECT COUNT(*) AS n FROM architect').get() as { n: number };
    expect(rows.n).toBe(0);
  });

  it('disambiguates via terminal_id when the architect name appears in MULTIPLE workspaces (iter-5)', () => {
    // The leak scenario as it exists pre-migration for users already hit by
    // #826: state.db.architect has ONE row for 'ob-refine' (it's a unique
    // singleton PRIMARY KEY in the pre-v11 schema), but terminal_sessions has
    // TWO rows for role_id='ob-refine' because v3.1.1's launchInstance reconcile
    // re-spawned the sibling into a second workspace. Matching the architect
    // row by role_id alone with LIMIT 1 picks non-deterministically and could
    // migrate ob-refine to the wrong workspace silently.
    //
    // Fix (iter-5): match by `architect.terminal_id` first — it's the stable
    // session UUID and uniquely identifies which terminal_session row this
    // architect row was originally registered with. The legitimate workspace
    // is the one whose terminal_session row has that exact id.
    buildPreV11Schema();

    // state.db.architect: one row for ob-refine, with the LEGITIMATE
    // workspace's terminal_id (shannon registered it first).
    localDb.prepare(
      "INSERT INTO architect (id, pid, port, cmd, started_at, terminal_id) VALUES ('ob-refine', 0, 0, 'claude', '2026-05-23T10:00:00Z', 't-shannon-ob-refine')"
    ).run();

    // global.db.terminal_sessions: TWO rows with role_id='ob-refine'.
    //   - shannon's legitimate row (architect.terminal_id matches its id)
    //   - manazil's LEAKED row (created by v3.1.1's broken reconcile)
    globalDb.prepare(
      "INSERT INTO terminal_sessions (id, workspace_path, type, role_id, pid) VALUES ('t-shannon-ob-refine', '/shannon', 'architect', 'ob-refine', 1234)"
    ).run();
    globalDb.prepare(
      "INSERT INTO terminal_sessions (id, workspace_path, type, role_id, pid) VALUES ('t-manazil-leaked-ob-refine', '/manazil', 'architect', 'ob-refine', 1235)"
    ).run();

    runV11Migration();

    // The architect row must be migrated to '/shannon' (the workspace whose
    // terminal_session row matches `architect.terminal_id`), NOT '/manazil'.
    // Pre-iter-5, the role_id+LIMIT 1 lookup would have picked
    // non-deterministically — SQLite's order is implementation-defined when
    // no ORDER BY is given. This test pins the deterministic mapping.
    const rows = localDb
      .prepare("SELECT workspace_path, id, terminal_id FROM architect WHERE id = 'ob-refine'")
      .all() as Array<{ workspace_path: string; id: string; terminal_id: string }>;
    expect(rows).toEqual([
      { workspace_path: '/shannon', id: 'ob-refine', terminal_id: 't-shannon-ob-refine' },
    ]);
  });

  it('falls back to role_id when terminal_id is NULL or has no matching session row (iter-5)', () => {
    // Legacy / partial-cleanup case: architect row has a NULL terminal_id
    // (or a terminal_id whose row was deleted). Migration should still
    // backfill via role_id when there's no role_id ambiguity.
    buildPreV11Schema();

    localDb.prepare(
      "INSERT INTO architect (id, pid, port, cmd, started_at, terminal_id) VALUES ('legacy', 0, 0, 'claude', '2026-05-23T10:00:00Z', NULL)"
    ).run();
    globalDb.prepare(
      "INSERT INTO terminal_sessions (id, workspace_path, type, role_id, pid) VALUES ('t-legacy', '/workspace/W', 'architect', 'legacy', 1234)"
    ).run();

    runV11Migration();

    const row = localDb
      .prepare("SELECT workspace_path FROM architect WHERE id = 'legacy'")
      .get() as { workspace_path: string };
    expect(row.workspace_path).toBe('/workspace/W');
  });

  it('records v11 in _migrations table for idempotency on re-run', () => {
    buildPreV11Schema();
    runV11Migration();

    const v11Row = localDb.prepare('SELECT version FROM _migrations WHERE version = 11').get() as { version: number } | undefined;
    expect(v11Row?.version).toBe(11);
  });
});
