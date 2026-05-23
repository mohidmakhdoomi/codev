/**
 * SQLite Database Module
 *
 * Provides singleton database access for both local state and global registry.
 * Uses better-sqlite3 for synchronous operations with proper concurrency handling.
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, copyFileSync, unlinkSync, readdirSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { AGENT_FARM_DIR } from '../lib/tower-client.js';
import { LOCAL_SCHEMA, GLOBAL_SCHEMA } from './schema.js';
import { migrateLocalFromJson } from './migrate.js';
import { getConfig } from '../utils/index.js';

// Singleton instances
let _localDb: Database.Database | null = null;
let _globalDb: Database.Database | null = null;

/**
 * Ensure a directory exists
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Configure database pragmas for optimal concurrency and durability
 */
function configurePragmas(db: Database.Database): void {
  // Enable WAL mode for better concurrency (readers don't block writers)
  const journalMode = db.pragma('journal_mode = WAL', { simple: true });
  if (journalMode !== 'wal') {
    console.warn('[warn] WAL mode unavailable, using DELETE mode (concurrency limited)');
  }

  // NORMAL synchronous mode balances safety and performance
  db.pragma('synchronous = NORMAL');

  // 5 second timeout when waiting for locks
  db.pragma('busy_timeout = 5000');

  // Enable foreign key constraints
  db.pragma('foreign_keys = ON');
}

/**
 * Get the local database instance (state.db)
 * Creates and initializes the database if it doesn't exist
 */
export function getDb(): Database.Database {
  if (!_localDb) {
    _localDb = ensureLocalDatabase();
  }
  return _localDb;
}

/**
 * Get the global database instance (global.db)
 * Creates and initializes the database if it doesn't exist
 */
export function getGlobalDb(): Database.Database {
  if (!_globalDb) {
    _globalDb = ensureGlobalDatabase();
  }
  return _globalDb;
}

/**
 * Close the local database connection
 */
export function closeDb(): void {
  if (_localDb) {
    _localDb.close();
    _localDb = null;
  }
}

/**
 * Close the global database connection
 */
export function closeGlobalDb(): void {
  if (_globalDb) {
    _globalDb.close();
    _globalDb = null;
  }
}

/**
 * Close all database connections
 */
export function closeAllDbs(): void {
  closeDb();
  closeGlobalDb();
}

/**
 * Get the path to the local database
 */
export function getDbPath(): string {
  const config = getConfig();
  return resolve(config.stateDir, 'state.db');
}

/**
 * Get the path to the global database.
 * Uses per-test isolation when NODE_ENV=test:
 *   - AF_TEST_DB env var → custom DB name (e.g., "test-14500.db")
 *   - NODE_ENV=test without AF_TEST_DB → "test.db"
 *   - Production → "global.db"
 */
export function getGlobalDbPath(): string {
  let dbName = 'global.db';
  if (process.env.NODE_ENV === 'test') {
    dbName = process.env.AF_TEST_DB || 'test.db';
  }
  return resolve(AGENT_FARM_DIR, dbName);
}

/**
 * Initialize the local database (state.db)
 */
function ensureLocalDatabase(): Database.Database {
  const config = getConfig();
  const dbPath = resolve(config.stateDir, 'state.db');
  const jsonPath = resolve(config.stateDir, 'state.json');

  // Ensure directory exists
  ensureDir(config.stateDir);

  // Create/open database
  const db = new Database(dbPath);
  configurePragmas(db);

  // Run schema (creates tables if they don't exist)
  db.exec(LOCAL_SCHEMA);

  // Check if migration is needed
  const migrated = db.prepare('SELECT version FROM _migrations WHERE version = 1').get();

  if (!migrated && existsSync(jsonPath)) {
    // Migrate from JSON.
    // Bugfix #826: pass workspaceRoot so the architect row gets tagged
    // with workspace_path (the new composite-PK column).
    migrateLocalFromJson(db, jsonPath, config.workspaceRoot);

    // Record migration
    db.prepare('INSERT INTO _migrations (version) VALUES (1)').run();

    // Backup original JSON and remove it
    copyFileSync(jsonPath, jsonPath + '.bak');
    unlinkSync(jsonPath);

    console.log('[info] Migrated state.json to state.db (backup at state.json.bak)');
  } else if (!migrated) {
    // Fresh install, just mark migration as done
    db.prepare('INSERT OR IGNORE INTO _migrations (version) VALUES (1)').run();
    console.log('[info] Created new state.db at', dbPath);
  }

  // Migration v2: Add terminal_id columns (node-pty rewrite)
  const v2 = db.prepare('SELECT version FROM _migrations WHERE version = 2').get();
  if (!v2) {
    // Add terminal_id to tables that may already exist without it
    const tables = ['architect', 'builders', 'utils'];
    for (const table of tables) {
      try {
        db.exec(`ALTER TABLE ${table} ADD COLUMN terminal_id TEXT`);
      } catch {
        // Column already exists (fresh install ran full schema)
      }
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (2)').run();
  }

  // Migration v3: Remove UNIQUE constraint from utils.port (node-pty shells use port=0)
  const v3 = db.prepare('SELECT version FROM _migrations WHERE version = 3').get();
  if (!v3) {
    // Check if utils table has the UNIQUE constraint on port
    const tableInfo = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='utils'")
      .get() as { sql: string } | undefined;

    if (tableInfo?.sql?.includes('port INTEGER NOT NULL UNIQUE')) {
      // SQLite can't drop constraints, so recreate table
      db.exec(`
        CREATE TABLE utils_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 0,
          pid INTEGER NOT NULL DEFAULT 0,
          tmux_session TEXT,
          terminal_id TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO utils_new SELECT id, name, port, pid, tmux_session, terminal_id, started_at FROM utils;
        DROP TABLE utils;
        ALTER TABLE utils_new RENAME TO utils;
      `);
      console.log('[info] Migrated utils table: removed UNIQUE constraint from port');
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (3)').run();
  }

  // Migration v4: Remove UNIQUE constraint from builders.port (PTY-backed builders use port=0)
  const v4 = db.prepare('SELECT version FROM _migrations WHERE version = 4').get();
  if (!v4) {
    const tableInfo = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='builders'")
      .get() as { sql: string } | undefined;

    if (tableInfo?.sql?.includes('port INTEGER NOT NULL UNIQUE')) {
      // SQLite can't drop constraints, so recreate table
      db.exec(`
        CREATE TABLE builders_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 0,
          pid INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'spawning'
            CHECK(status IN ('spawning', 'implementing', 'blocked', 'pr', 'complete')),
          phase TEXT NOT NULL DEFAULT '',
          worktree TEXT NOT NULL,
          branch TEXT NOT NULL,
          tmux_session TEXT,
          type TEXT NOT NULL DEFAULT 'spec'
            CHECK(type IN ('spec', 'task', 'protocol', 'shell', 'worktree', 'bugfix')),
          task_text TEXT,
          protocol_name TEXT,
          issue_number INTEGER,
          terminal_id TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO builders_new SELECT * FROM builders;
        DROP TABLE builders;
        ALTER TABLE builders_new RENAME TO builders;
        CREATE INDEX IF NOT EXISTS idx_builders_status ON builders(status);
        CREATE INDEX IF NOT EXISTS idx_builders_port ON builders(port);
        CREATE TRIGGER IF NOT EXISTS builders_updated_at
          AFTER UPDATE ON builders
          FOR EACH ROW
          BEGIN
            UPDATE builders SET updated_at = datetime('now') WHERE id = NEW.id;
          END;
      `);
      console.log('[info] Migrated builders table: removed UNIQUE constraint from port');
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (4)').run();
  }

  // Migration v5: Remove UNIQUE constraint from annotations.port (all annotations use port=0)
  const v5 = db.prepare('SELECT version FROM _migrations WHERE version = 5').get();
  if (!v5) {
    const tableInfo = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='annotations'")
      .get() as { sql: string } | undefined;

    if (tableInfo?.sql?.includes('port INTEGER NOT NULL UNIQUE')) {
      db.exec(`
        CREATE TABLE annotations_new (
          id TEXT PRIMARY KEY,
          file TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 0,
          pid INTEGER NOT NULL DEFAULT 0,
          parent_type TEXT NOT NULL CHECK(parent_type IN ('architect', 'builder', 'util')),
          parent_id TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO annotations_new SELECT id, file, port, pid, parent_type, parent_id, started_at FROM annotations;
        DROP TABLE annotations;
        ALTER TABLE annotations_new RENAME TO annotations;
      `);
      console.log('[info] Migrated annotations table: removed UNIQUE constraint from port');
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (5)').run();
  }

  // Migration v6: Drop tmux_session columns (Spec 0104 - tmux replaced by shepherd)
  const v6 = db.prepare('SELECT version FROM _migrations WHERE version = 6').get();
  if (!v6) {
    const tables = ['architect', 'builders', 'utils'];
    for (const table of tables) {
      try {
        db.exec(`ALTER TABLE ${table} DROP COLUMN tmux_session`);
      } catch {
        // Column may not exist (fresh install with updated schema)
      }
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (6)').run();
  }

  // Migration v7: Rename builder status 'pr-ready' → 'pr' (Bugfix #368)
  const v7 = db.prepare('SELECT version FROM _migrations WHERE version = 7').get();
  if (!v7) {
    const tableInfo = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='builders'")
      .get() as { sql: string } | undefined;

    if (tableInfo?.sql?.includes('pr-ready')) {
      // SQLite can't alter CHECK constraints, so recreate table
      db.exec(`
        CREATE TABLE builders_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 0,
          pid INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'spawning'
            CHECK(status IN ('spawning', 'implementing', 'blocked', 'pr', 'complete')),
          phase TEXT NOT NULL DEFAULT '',
          worktree TEXT NOT NULL,
          branch TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'spec'
            CHECK(type IN ('spec', 'task', 'protocol', 'shell', 'worktree', 'bugfix')),
          task_text TEXT,
          protocol_name TEXT,
          issue_number INTEGER,
          terminal_id TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO builders_new
          SELECT id, name, port, pid,
            CASE WHEN status = 'pr-ready' THEN 'pr' ELSE status END,
            phase, worktree, branch, type, task_text, protocol_name,
            issue_number, terminal_id, started_at, updated_at
          FROM builders;
        DROP TABLE builders;
        ALTER TABLE builders_new RENAME TO builders;
        CREATE INDEX IF NOT EXISTS idx_builders_status ON builders(status);
        CREATE INDEX IF NOT EXISTS idx_builders_port ON builders(port);
        CREATE TRIGGER IF NOT EXISTS builders_updated_at
          AFTER UPDATE ON builders
          FOR EACH ROW
          BEGIN
            UPDATE builders SET updated_at = datetime('now') WHERE id = NEW.id;
          END;
      `);
      console.log('[info] Migrated builders table: renamed status pr-ready to pr');
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (7)').run();
  }

  // Migration v8: Widen issue_number from INTEGER to TEXT (Linear identifiers like "ENG-123")
  const v8 = db.prepare('SELECT version FROM _migrations WHERE version = 8').get();
  if (!v8) {
    const tableInfo = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='builders'")
      .get() as { sql: string } | undefined;

    if (tableInfo?.sql?.includes('issue_number INTEGER')) {
      db.exec(`
        CREATE TABLE builders_new (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          port INTEGER NOT NULL DEFAULT 0,
          pid INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL DEFAULT 'spawning'
            CHECK(status IN ('spawning', 'implementing', 'blocked', 'pr', 'complete')),
          phase TEXT NOT NULL DEFAULT '',
          worktree TEXT NOT NULL,
          branch TEXT NOT NULL,
          type TEXT NOT NULL DEFAULT 'spec'
            CHECK(type IN ('spec', 'task', 'protocol', 'shell', 'worktree', 'bugfix')),
          task_text TEXT,
          protocol_name TEXT,
          issue_number TEXT,
          terminal_id TEXT,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          updated_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT INTO builders_new
          SELECT id, name, port, pid, status, phase, worktree, branch, type,
            task_text, protocol_name, CAST(issue_number AS TEXT),
            terminal_id, started_at, updated_at
          FROM builders;
        DROP TABLE builders;
        ALTER TABLE builders_new RENAME TO builders;
        CREATE INDEX IF NOT EXISTS idx_builders_status ON builders(status);
        CREATE INDEX IF NOT EXISTS idx_builders_port ON builders(port);
        CREATE TRIGGER IF NOT EXISTS builders_updated_at
          AFTER UPDATE ON builders
          FOR EACH ROW
          BEGIN
            UPDATE builders SET updated_at = datetime('now') WHERE id = NEW.id;
          END;
      `);
      console.log('[info] Migrated builders table: widened issue_number to TEXT');
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (8)').run();
  }

  // Migration v9: Multi-architect support (Spec 755)
  //   - Rebuild architect table: drop CHECK(id=1), change id to TEXT PRIMARY KEY.
  //     Rekey the existing singleton row's id from 1 to 'main'.
  //   - Add builders.spawned_by_architect TEXT column (nullable).
  const v9 = db.prepare('SELECT version FROM _migrations WHERE version = 9').get();
  if (!v9) {
    const tableInfo = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='architect'")
      .get() as { sql: string } | undefined;

    // Architect table rebuild — only if it still has the old integer/CHECK shape.
    // Detect via 'CHECK (id = 1)' (or normalized variants) in the stored DDL.
    if (tableInfo?.sql && /CHECK\s*\(\s*id\s*=\s*1\s*\)/i.test(tableInfo.sql)) {
      db.exec(`
        CREATE TABLE architect_v9 (
          id TEXT PRIMARY KEY,
          pid INTEGER NOT NULL,
          port INTEGER NOT NULL,
          cmd TEXT NOT NULL,
          started_at TEXT NOT NULL DEFAULT (datetime('now')),
          terminal_id TEXT
        );
        INSERT INTO architect_v9 (id, pid, port, cmd, started_at, terminal_id)
          SELECT 'main', pid, port, cmd, started_at, terminal_id FROM architect;
        DROP TABLE architect;
        ALTER TABLE architect_v9 RENAME TO architect;
      `);
      console.log('[info] Migrated architect table: multi-architect support (Spec 755)');
    }

    // Add spawned_by_architect column to builders if absent.
    try {
      db.exec(`ALTER TABLE builders ADD COLUMN spawned_by_architect TEXT`);
    } catch {
      // Column already exists (fresh install ran the updated schema).
    }

    db.prepare('INSERT INTO _migrations (version) VALUES (9)').run();
  }

  // Migration v10: Add 'pir' to builders.type CHECK constraint (Issue 691).
  // Reintroduced post main-merge (the original collided with main's v9).
  // Drift-robust: derive builders_new from the LIVE builders DDL (only the
  // table name + the type CHECK literal are rewritten), so `SELECT *` can
  // never column-mismatch regardless of columns earlier migrations added
  // (e.g. v9's spawned_by_architect). Idempotent: skips if 'pir' is already
  // in the constraint (covers fresh installs and DBs that ran the old v9).
  const v10 = db.prepare('SELECT version FROM _migrations WHERE version = 10').get();
  if (!v10) {
    const builders = db
      .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='builders'")
      .get() as { sql: string } | undefined;

    if (builders?.sql && !builders.sql.includes("'pir'")) {
      const newSql = builders.sql
        .replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["'`]?builders["'`]?/i, 'CREATE TABLE builders_new')
        .replace(/(CHECK\s*\(\s*type\s+IN\s*\([^)]*)\)/i, "$1, 'pir')");
      db.exec(`
        ${newSql};
        INSERT INTO builders_new SELECT * FROM builders;
        DROP TABLE builders;
        ALTER TABLE builders_new RENAME TO builders;
        CREATE INDEX IF NOT EXISTS idx_builders_status ON builders(status);
        CREATE INDEX IF NOT EXISTS idx_builders_port ON builders(port);
        CREATE TRIGGER IF NOT EXISTS builders_updated_at
          AFTER UPDATE ON builders
          FOR EACH ROW
          BEGIN
            UPDATE builders SET updated_at = datetime('now') WHERE id = NEW.id;
          END;
      `);
      console.log("[info] Migrated builders table: added 'pir' to type CHECK constraint (v10)");
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (10)').run();
  }

  // Migration v11: Workspace-scoped architect rows (Bugfix #826).
  //
  // The architect table was global per Tower process, anchored to Tower's
  // startup CWD. With multi-architect (Spec 755 / 786), this meant siblings
  // registered in workspace A were re-spawned into workspace B at the next
  // launchInstance(B) — a real PTY leak. Fix by construction: add
  // `workspace_path` as part of the primary key so rows are explicitly scoped.
  //
  // Backfill source: global.db.terminal_sessions has per-architect rows with
  // workspace_path (its `role_id` column holds the architect name). We ATTACH
  // global.db and copy that mapping into the new architect rows. Architects
  // with no current terminal_session row are orphans (their PTY died and was
  // cleaned up before this migration ran) — they are dropped.
  //
  // Idempotent: skips when workspace_path column already exists (handles fresh
  // installs that ran the updated schema, and re-runs after partial failure).
  const v11 = db.prepare('SELECT version FROM _migrations WHERE version = 11').get();
  if (!v11) {
    // Check if workspace_path column already exists (fresh install via LOCAL_SCHEMA).
    const cols = db.prepare('PRAGMA table_info(architect)').all() as Array<{ name: string }>;
    const alreadyMigrated = cols.some(c => c.name === 'workspace_path');

    if (!alreadyMigrated) {
      const globalDbPath = getGlobalDbPath();

      // Step 1: rebuild table with composite PK (workspace_path, id).
      //   - Create _v11 table with the new shape.
      //   - Backfill workspace_path from global.db.terminal_sessions via ATTACH.
      //     Use LIMIT 1 to handle the (rare) case where multiple rows match.
      //   - Drop orphans (workspace_path IS NULL).
      //   - DETACH global.db before swapping table names.
      //   - Atomic swap: DROP architect, RENAME _v11 → architect.
      db.exec(`
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
        // ATTACH global.db so we can read terminal_sessions for the backfill.
        db.prepare("ATTACH DATABASE ? AS globaldb").run(globalDbPath);
        try {
          // Backfill: for each architect row, look up its workspace_path via
          // matching role_id in global.db.terminal_sessions. Architects without
          // a matching row get workspace_path = NULL and are dropped below.
          db.exec(`
            INSERT INTO architect_v11 (workspace_path, id, pid, port, cmd, started_at, terminal_id)
            SELECT
              (SELECT ts.workspace_path
                 FROM globaldb.terminal_sessions ts
                WHERE ts.role_id = a.id
                  AND ts.type = 'architect'
                LIMIT 1) AS workspace_path,
              a.id,
              a.pid,
              a.port,
              a.cmd,
              a.started_at,
              a.terminal_id
            FROM architect a
            WHERE EXISTS (
              SELECT 1 FROM globaldb.terminal_sessions ts
              WHERE ts.role_id = a.id AND ts.type = 'architect'
            );
          `);
        } finally {
          db.prepare('DETACH DATABASE globaldb').run();
        }
      } catch (err) {
        // If global.db can't be opened (e.g. doesn't exist yet in a fresh
        // install where Tower hasn't started), the architect table must be
        // empty for the migration to succeed. Verify and proceed; if there
        // are pre-existing architect rows we genuinely can't backfill, drop
        // them — they correspond to a never-started workspace.
        const remaining = db.prepare('SELECT COUNT(*) AS n FROM architect').get() as { n: number };
        if (remaining.n > 0) {
          console.log(`[warn] Migration v11: dropping ${remaining.n} architect row(s) — global.db unavailable for backfill: ${(err as Error).message}`);
        }
        // architect_v11 is empty in this path; carry on.
      }

      // Step 2: atomic swap.
      db.exec(`
        DROP TABLE architect;
        ALTER TABLE architect_v11 RENAME TO architect;
        CREATE INDEX IF NOT EXISTS idx_architect_workspace ON architect(workspace_path);
      `);

      console.log('[info] Migrated architect table: workspace-scoped rows (Bugfix #826)');
    }

    db.prepare('INSERT INTO _migrations (version) VALUES (11)').run();
  }

  return db;
}

/**
 * Initialize the global database (global.db)
 */
function ensureGlobalDatabase(): Database.Database {
  const dbPath = getGlobalDbPath();
  const globalDir = dirname(dbPath);

  // Ensure directory exists
  ensureDir(globalDir);

  // Create/open database
  const db = new Database(dbPath);
  configurePragmas(db);

  // Current migration version — bump when adding new migrations
  const GLOBAL_CURRENT_VERSION = 13;

  // Detect fresh vs existing database by checking if content tables exist.
  // On existing databases, GLOBAL_SCHEMA must NOT run because it references column names
  // (workspace_path) that don't exist until migration v9 renames them from project_path.
  // We check terminal_sessions (not _migrations) because _migrations could exist but be empty
  // in a partially-initialized legacy DB — running GLOBAL_SCHEMA on such a DB would fail
  // since CREATE INDEX on workspace_path would reference a non-existent column.
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='terminal_sessions'"
  ).get();
  const isFresh = !tableCheck;

  if (isFresh) {
    // Fresh install: create all tables at their latest state
    db.exec(GLOBAL_SCHEMA);
    // Mark all migrations as done — schema already reflects final state
    for (let v = 1; v <= GLOBAL_CURRENT_VERSION; v++) {
      db.prepare('INSERT OR IGNORE INTO _migrations (version) VALUES (?)').run(v);
    }
    console.log('[info] Created new global.db at', dbPath);
    return db;
  }

  // Existing database: only run migrations (skip GLOBAL_SCHEMA to avoid column name conflicts)
  // Ensure _migrations table exists for tracking
  db.exec(`CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`);

  // Migration v2: No-op (previously added columns to port_allocations, now removed by Spec 0098)
  const v2 = db.prepare('SELECT version FROM _migrations WHERE version = 2').get();
  if (!v2) {
    db.prepare('INSERT INTO _migrations (version) VALUES (2)').run();
  }

  // Migration v3: Add terminal_sessions table (Spec 0090 TICK-001)
  const v3 = db.prepare('SELECT version FROM _migrations WHERE version = 3').get();
  if (!v3) {
    // Create terminal_sessions table if it doesn't exist
    db.exec(`
      CREATE TABLE IF NOT EXISTS terminal_sessions (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('architect', 'builder', 'shell')),
        role_id TEXT,
        pid INTEGER,
        tmux_session TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_terminal_sessions_project ON terminal_sessions(project_path);
      CREATE INDEX IF NOT EXISTS idx_terminal_sessions_type ON terminal_sessions(type);
    `);
    db.prepare('INSERT INTO _migrations (version) VALUES (3)').run();
    console.log('[info] Created terminal_sessions table (Spec 0090 TICK-001)');
  }

  // Migration v4: Add file_tabs table (Spec 0099 Phase 4)
  const v4 = db.prepare('SELECT version FROM _migrations WHERE version = 4').get();
  if (!v4) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS file_tabs (
        id TEXT PRIMARY KEY,
        project_path TEXT NOT NULL,
        file_path TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_file_tabs_project ON file_tabs(project_path);
    `);
    db.prepare('INSERT INTO _migrations (version) VALUES (4)').run();
    console.log('[info] Created file_tabs table (Spec 0099 Phase 4)');
  }

  // Migration v5: Add known_projects table for persistent project registry
  const v5 = db.prepare('SELECT version FROM _migrations WHERE version = 5').get();
  if (!v5) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS known_projects (
        project_path TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        last_launched_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // Seed from existing terminal_sessions so current projects appear immediately
    db.exec(`
      INSERT OR IGNORE INTO known_projects (project_path, name, last_launched_at)
      SELECT DISTINCT project_path, '', datetime('now') FROM terminal_sessions;
    `);
    db.prepare('INSERT INTO _migrations (version) VALUES (5)').run();
    console.log('[info] Created known_projects table');
  }

  // Migration v6: Add shepherd columns to terminal_sessions (Spec 0104)
  const v6 = db.prepare('SELECT version FROM _migrations WHERE version = 6').get();
  if (!v6) {
    const cols = ['shepherd_socket TEXT', 'shepherd_pid INTEGER', 'shepherd_start_time INTEGER'];
    for (const col of cols) {
      try {
        db.exec(`ALTER TABLE terminal_sessions ADD COLUMN ${col}`);
      } catch {
        // Column already exists (fresh install ran updated schema)
      }
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (6)').run();
    console.log('[info] Added shepherd columns to terminal_sessions (Spec 0104)');
  }

  // Migration v7: Drop tmux_session column from terminal_sessions (Spec 0104 Phase 4)
  const v7 = db.prepare('SELECT version FROM _migrations WHERE version = 7').get();
  if (!v7) {
    // SQLite table-rebuild pattern to drop the tmux_session column
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS terminal_sessions_new (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('architect', 'builder', 'shell')),
          role_id TEXT,
          pid INTEGER,
          shepherd_socket TEXT,
          shepherd_pid INTEGER,
          shepherd_start_time INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO terminal_sessions_new
          SELECT id, project_path, type, role_id, pid, shepherd_socket, shepherd_pid, shepherd_start_time, created_at
          FROM terminal_sessions;
        DROP TABLE terminal_sessions;
        ALTER TABLE terminal_sessions_new RENAME TO terminal_sessions;
        CREATE INDEX IF NOT EXISTS idx_terminal_sessions_project ON terminal_sessions(project_path);
        CREATE INDEX IF NOT EXISTS idx_terminal_sessions_type ON terminal_sessions(type);
      `);
    } catch {
      // Table may already be in the correct schema (fresh install)
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (7)').run();
    console.log('[info] Dropped tmux_session column from terminal_sessions (Spec 0104)');
  }

  // Migration v8: Rename shepherd_* columns to shellper_* (Spec 0106)
  const v8 = db.prepare('SELECT version FROM _migrations WHERE version = 8').get();
  if (!v8) {
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS terminal_sessions_new (
          id TEXT PRIMARY KEY,
          project_path TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('architect', 'builder', 'shell')),
          role_id TEXT,
          pid INTEGER,
          shellper_socket TEXT,
          shellper_pid INTEGER,
          shellper_start_time INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO terminal_sessions_new
          SELECT id, project_path, type, role_id, pid, shepherd_socket, shepherd_pid, shepherd_start_time, created_at
          FROM terminal_sessions;
        DROP TABLE terminal_sessions;
        ALTER TABLE terminal_sessions_new RENAME TO terminal_sessions;
        CREATE INDEX IF NOT EXISTS idx_terminal_sessions_project ON terminal_sessions(project_path);
        CREATE INDEX IF NOT EXISTS idx_terminal_sessions_type ON terminal_sessions(type);
        UPDATE terminal_sessions SET shellper_socket = REPLACE(shellper_socket, 'shepherd-', 'shellper-')
          WHERE shellper_socket LIKE '%shepherd-%';
      `);
    } catch {
      // Table may already be in the correct schema (fresh install)
    }
    // Rename physical socket files on disk
    try {
      const runDir = join(homedir(), '.codev', 'run');
      if (existsSync(runDir)) {
        const files = readdirSync(runDir);
        for (const file of files) {
          if (file.startsWith('shepherd-') && file.endsWith('.sock')) {
            const newName = file.replace('shepherd-', 'shellper-');
            try {
              renameSync(join(runDir, file), join(runDir, newName));
            } catch {
              // Skip files that can't be renamed (missing, permissions, etc.)
            }
          }
        }
      }
    } catch {
      // Skip if run directory doesn't exist or can't be read
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (8)').run();
    console.log('[info] Renamed shepherd columns to shellper in terminal_sessions (Spec 0106)');
  }

  // Migration v9: Rename project_path → workspace_path in all tables (Spec 0112)
  // Note: Fresh installs never reach here (handled above), so old column names are guaranteed.
  // Wrapped in a transaction for atomicity — all three renames succeed or none do.
  const v9 = db.prepare('SELECT version FROM _migrations WHERE version = 9').get();
  if (!v9) {
    const migrate = db.transaction(() => {
      // 1. Rename terminal_sessions.project_path → workspace_path
      db.exec(`
        CREATE TABLE IF NOT EXISTS terminal_sessions_new (
          id TEXT PRIMARY KEY,
          workspace_path TEXT NOT NULL,
          type TEXT NOT NULL CHECK(type IN ('architect', 'builder', 'shell')),
          role_id TEXT,
          pid INTEGER,
          shellper_socket TEXT,
          shellper_pid INTEGER,
          shellper_start_time INTEGER,
          created_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO terminal_sessions_new
          SELECT id, project_path, type, role_id, pid, shellper_socket, shellper_pid, shellper_start_time, created_at
          FROM terminal_sessions;
        DROP TABLE terminal_sessions;
        ALTER TABLE terminal_sessions_new RENAME TO terminal_sessions;
        CREATE INDEX IF NOT EXISTS idx_terminal_sessions_workspace ON terminal_sessions(workspace_path);
        CREATE INDEX IF NOT EXISTS idx_terminal_sessions_type ON terminal_sessions(type);
      `);

      // 2. Rename file_tabs.project_path → workspace_path
      db.exec(`
        CREATE TABLE IF NOT EXISTS file_tabs_new (
          id TEXT PRIMARY KEY,
          workspace_path TEXT NOT NULL,
          file_path TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        INSERT OR IGNORE INTO file_tabs_new
          SELECT id, project_path, file_path, created_at
          FROM file_tabs;
        DROP TABLE file_tabs;
        ALTER TABLE file_tabs_new RENAME TO file_tabs;
        CREATE INDEX IF NOT EXISTS idx_file_tabs_workspace ON file_tabs(workspace_path);
      `);

      // 3. Rename known_projects → known_workspaces with project_path → workspace_path
      db.exec(`
        CREATE TABLE IF NOT EXISTS known_workspaces (
          workspace_path TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          last_launched_at TEXT NOT NULL DEFAULT (datetime('now'))
        );
        INSERT OR IGNORE INTO known_workspaces (workspace_path, name, last_launched_at)
          SELECT project_path, name, last_launched_at FROM known_projects;
        DROP TABLE IF EXISTS known_projects;
      `);

      db.prepare('INSERT INTO _migrations (version) VALUES (9)').run();
    });
    migrate();
    console.log('[info] Renamed project_path → workspace_path in global tables (Spec 0112)');
  }

  // Migration v10: Add cron_tasks table (Spec 399)
  const v10 = db.prepare('SELECT version FROM _migrations WHERE version = 10').get();
  if (!v10) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS cron_tasks (
        id TEXT PRIMARY KEY,
        workspace_path TEXT NOT NULL,
        task_name TEXT NOT NULL,
        last_run INTEGER,
        last_result TEXT,
        last_output TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        UNIQUE(workspace_path, task_name)
      );
    `);
    db.prepare('INSERT INTO _migrations (version) VALUES (10)').run();
    console.log('[info] Created cron_tasks table (Spec 399)');
  }

  // Migration v11: Add label column to terminal_sessions (Spec 468)
  const v11 = db.prepare('SELECT version FROM _migrations WHERE version = 11').get();
  if (!v11) {
    try {
      db.exec(`ALTER TABLE terminal_sessions ADD COLUMN label TEXT`);
    } catch {
      // Column may already exist from a fresh install
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (11)').run();
    console.log('[info] Added label column to terminal_sessions (Spec 468)');
  }

  // Migration v12: Add cwd column to terminal_sessions (Bugfix #506)
  const v12 = db.prepare('SELECT version FROM _migrations WHERE version = 12').get();
  if (!v12) {
    try {
      db.exec(`ALTER TABLE terminal_sessions ADD COLUMN cwd TEXT`);
    } catch {
      // Column may already exist from a fresh install
    }
    db.prepare('INSERT INTO _migrations (version) VALUES (12)').run();
    console.log('[info] Added cwd column to terminal_sessions (Bugfix #506)');
  }

  // Migration v13: Backfill terminal_sessions.role_id for legacy architect rows (Spec 755)
  // Pre-v13 rows for architects always stored role_id as NULL because there was only
  // ever one architect per workspace. Multi-architect support requires the name to be
  // present in role_id so reconnect can re-key the in-memory map. The idempotent
  // backfill sets role_id = 'main' for legacy rows; subsequent architect rows write
  // their explicit name and are unaffected.
  const v13 = db.prepare('SELECT version FROM _migrations WHERE version = 13').get();
  if (!v13) {
    db.prepare(`
      UPDATE terminal_sessions
         SET role_id = 'main'
       WHERE type = 'architect' AND role_id IS NULL
    `).run();
    db.prepare('INSERT INTO _migrations (version) VALUES (13)').run();
    console.log('[info] Backfilled architect role_id with \'main\' (Spec 755)');
  }

  return db;
}

// Re-export types and utilities
export { LOCAL_SCHEMA, GLOBAL_SCHEMA } from './schema.js';
export { withRetry } from './errors.js';
export type {
  DbArchitect,
  DbBuilder,
  DbUtil,
  DbAnnotation,
} from './types.js';
