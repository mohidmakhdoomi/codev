/**
 * State management for Agent Farm
 *
 * Uses SQLite for ACID-compliant state persistence with proper concurrency handling.
 * All operations are synchronous and atomic.
 */

import type { DashboardState, ArchitectState, Builder, UtilTerminal, Annotation } from './types.js';
import { getDb, closeDb } from './db/index.js';
import type { DbArchitect, DbBuilder, DbUtil, DbAnnotation } from './db/types.js';
import {
  dbArchitectToArchitectState,
  dbBuilderToBuilder,
  dbUtilToUtilTerminal,
  dbAnnotationToAnnotation,
} from './db/types.js';
import { isPortConflictError } from './db/errors.js';

/**
 * Load complete state from database
 *
 * Spec 755: `DashboardState.architect` remains a scalar shape in v1. We load
 * the architect named 'main' if present, otherwise the first registered
 * architect (alphabetical by name). The /api/state contract is preserved so
 * the dashboard and VSCode extension see no shape change. Multi-architect UI
 * is deferred to issue #2 — see plan codev/plans/755-*.md.
 */
export function loadState(): DashboardState {
  const db = getDb();

  // Load architect (Spec 755: scalar shim — prefer 'main', else the
  // first-registered architect, ordered by started_at, not lexicographic name).
  let architectRow = db.prepare("SELECT * FROM architect WHERE id = 'main'").get() as DbArchitect | undefined;
  if (!architectRow) {
    architectRow = db.prepare('SELECT * FROM architect ORDER BY started_at LIMIT 1').get() as DbArchitect | undefined;
  }
  const architect = architectRow ? dbArchitectToArchitectState(architectRow) : null;

  // Load builders
  const builderRows = db.prepare('SELECT * FROM builders ORDER BY started_at').all() as DbBuilder[];
  const builders = builderRows.map(dbBuilderToBuilder);

  // Load utils
  const utilRows = db.prepare('SELECT * FROM utils ORDER BY started_at').all() as DbUtil[];
  const utils = utilRows.map(dbUtilToUtilTerminal);

  // Load annotations
  const annotationRows = db.prepare('SELECT * FROM annotations ORDER BY started_at').all() as DbAnnotation[];
  const annotations = annotationRows.map(dbAnnotationToAnnotation);

  return {
    architect,
    builders,
    utils,
    annotations,
  };
}

/**
 * Update architect state (main-only setter — preserved for backward-compat with
 * existing callers like `workspace start` / `stop`). Spec 755 added per-name
 * setters/getters below.
 *
 * If `architect` is provided with a non-default `name`, callers should use
 * `setArchitectByName(name, architect)` instead — this function always
 * writes the row with id = 'main'.
 */
export function setArchitect(architect: ArchitectState | null): void {
  const db = getDb();

  if (architect === null) {
    db.prepare("DELETE FROM architect WHERE id = 'main'").run();
  } else {
    db.prepare(`
      INSERT OR REPLACE INTO architect (id, pid, port, cmd, started_at, terminal_id)
      VALUES ('main', 0, 0, @cmd, @startedAt, @terminalId)
    `).run({
      cmd: architect.cmd,
      startedAt: architect.startedAt,
      terminalId: architect.terminalId ?? null,
    });
  }
}

/**
 * Update architect state by name (Spec 755). Used by the Phase 2 CLI for
 * registering additional named architects. When `architect` is null, removes
 * just that named architect; non-null upserts it.
 */
export function setArchitectByName(name: string, architect: ArchitectState | null): void {
  const db = getDb();

  if (architect === null) {
    db.prepare('DELETE FROM architect WHERE id = ?').run(name);
    return;
  }

  db.prepare(`
    INSERT OR REPLACE INTO architect (id, pid, port, cmd, started_at, terminal_id)
    VALUES (@name, 0, 0, @cmd, @startedAt, @terminalId)
  `).run({
    name,
    cmd: architect.cmd,
    startedAt: architect.startedAt,
    terminalId: architect.terminalId ?? null,
  });
}

/**
 * Add or update a builder
 * Note: This is now synchronous
 */
export function upsertBuilder(builder: Builder): void {
  const db = getDb();

  db.prepare(`
    INSERT INTO builders (
      id, name, port, pid, status, phase, worktree, branch,
      type, task_text, protocol_name, issue_number, terminal_id, spawned_by_architect
    )
    VALUES (
      @id, @name, 0, 0, @status, @phase, @worktree, @branch,
      @type, @taskText, @protocolName, @issueNumber, @terminalId, @spawnedByArchitect
    )
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      status = excluded.status,
      phase = excluded.phase,
      worktree = excluded.worktree,
      branch = excluded.branch,
      type = excluded.type,
      task_text = excluded.task_text,
      protocol_name = excluded.protocol_name,
      issue_number = excluded.issue_number,
      terminal_id = excluded.terminal_id,
      spawned_by_architect = COALESCE(excluded.spawned_by_architect, builders.spawned_by_architect)
  `).run({
    id: builder.id,
    name: builder.name,
    status: builder.status,
    phase: builder.phase,
    worktree: builder.worktree,
    branch: builder.branch,
    type: builder.type,
    taskText: builder.taskText ?? null,
    protocolName: builder.protocolName ?? null,
    issueNumber: builder.issueNumber != null ? String(builder.issueNumber) : null,
    terminalId: builder.terminalId ?? null,
    spawnedByArchitect: builder.spawnedByArchitect ?? null,
  });
}

/**
 * Remove a builder
 * Note: This is now synchronous
 */
export function removeBuilder(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM builders WHERE id = ?').run(id);
}

/**
 * Get a single builder by ID
 */
export function getBuilder(id: string): Builder | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM builders WHERE id = ?').get(id) as DbBuilder | undefined;
  return row ? dbBuilderToBuilder(row) : null;
}

/**
 * Get all builders
 */
export function getBuilders(): Builder[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM builders ORDER BY started_at').all() as DbBuilder[];
  return rows.map(dbBuilderToBuilder);
}

/**
 * Get builders by status
 */
export function getBuildersByStatus(status: Builder['status']): Builder[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM builders WHERE status = ? ORDER BY started_at').all(status) as DbBuilder[];
  return rows.map(dbBuilderToBuilder);
}

/**
 * Add a utility terminal
 * Note: This is now synchronous
 */
export function addUtil(util: UtilTerminal): void {
  const db = getDb();

  db.prepare(`
    INSERT INTO utils (id, name, port, pid, terminal_id)
    VALUES (@id, @name, 0, 0, @terminalId)
  `).run({
    id: util.id,
    name: util.name,
    terminalId: util.terminalId ?? null,
  });
}

/**
 * Try to add a utility terminal, returning false on ID conflict
 * Used to handle concurrent insertion race conditions
 */
export function tryAddUtil(util: UtilTerminal): boolean {
  try {
    addUtil(util);
    return true;
  } catch (err) {
    if (isPortConflictError(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * Update a utility terminal
 */
export function updateUtil(id: string, updates: Partial<UtilTerminal>): void {
  const db = getDb();
  const fields: string[] = [];
  const values: Record<string, unknown> = { id };

  if ('terminalId' in updates) {
    fields.push('terminal_id = @terminalId');
    values.terminalId = updates.terminalId ?? null;
  }
  if ('name' in updates) {
    fields.push('name = @name');
    values.name = updates.name;
  }

  if (fields.length > 0) {
    db.prepare(`UPDATE utils SET ${fields.join(', ')} WHERE id = @id`).run(values);
  }
}

/**
 * Remove a utility terminal
 * Note: This is now synchronous
 */
export function removeUtil(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM utils WHERE id = ?').run(id);
}

/**
 * Get all utility terminals
 */
export function getUtils(): UtilTerminal[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM utils ORDER BY started_at').all() as DbUtil[];
  return rows.map(dbUtilToUtilTerminal);
}

/**
 * Get a single utility terminal by ID
 */
export function getUtil(id: string): UtilTerminal | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM utils WHERE id = ?').get(id) as DbUtil | undefined;
  return row ? dbUtilToUtilTerminal(row) : null;
}

/**
 * Add an annotation
 * Note: This is now synchronous
 */
export function addAnnotation(annotation: Annotation): void {
  const db = getDb();

  db.prepare(`
    INSERT INTO annotations (id, file, port, pid, parent_type, parent_id)
    VALUES (@id, @file, 0, 0, @parentType, @parentId)
  `).run({
    id: annotation.id,
    file: annotation.file,
    parentType: annotation.parent.type,
    parentId: annotation.parent.id ?? null,
  });
}

/**
 * Remove an annotation
 * Note: This is now synchronous
 */
export function removeAnnotation(id: string): void {
  const db = getDb();
  db.prepare('DELETE FROM annotations WHERE id = ?').run(id);
}

/**
 * Get all annotations
 */
export function getAnnotations(): Annotation[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM annotations ORDER BY started_at').all() as DbAnnotation[];
  return rows.map(dbAnnotationToAnnotation);
}

/**
 * Clear all state
 * Note: This is now synchronous
 */
export function clearState(): void {
  const db = getDb();

  const clear = db.transaction(() => {
    db.prepare('DELETE FROM architect').run();
    db.prepare('DELETE FROM builders').run();
    db.prepare('DELETE FROM utils').run();
    db.prepare('DELETE FROM annotations').run();
  });

  clear();
}

/**
 * Get architect state (main-only — Spec 755 scalar shim).
 * Returns the architect named 'main' if present, otherwise the first
 * registered architect by name. For multi-architect access, use
 * `getArchitects()` or `getArchitectByName(name)` below.
 */
export function getArchitect(): ArchitectState | null {
  const db = getDb();
  let row = db.prepare("SELECT * FROM architect WHERE id = 'main'").get() as DbArchitect | undefined;
  if (!row) {
    // Spec 755: when 'main' is absent, fall back to the first-registered
    // architect (started_at ordering), not the lexicographically-first name.
    row = db.prepare('SELECT * FROM architect ORDER BY started_at LIMIT 1').get() as DbArchitect | undefined;
  }
  return row ? dbArchitectToArchitectState(row) : null;
}

/**
 * Get all architects (Spec 755).
 */
export function getArchitects(): ArchitectState[] {
  const db = getDb();
  const rows = db.prepare('SELECT * FROM architect ORDER BY id').all() as DbArchitect[];
  return rows.map(dbArchitectToArchitectState);
}

/**
 * Get a single architect by name (Spec 755).
 */
export function getArchitectByName(name: string): ArchitectState | null {
  const db = getDb();
  const row = db.prepare('SELECT * FROM architect WHERE id = ?').get(name) as DbArchitect | undefined;
  return row ? dbArchitectToArchitectState(row) : null;
}

/**
 * Look up a builder's spawning-architect name (Spec 755).
 *
 * Returns:
 *   - `string` — the recorded `spawned_by_architect` (builder context with explicit name)
 *   - `null`   — a row exists for that builder ID but `spawned_by_architect` is NULL (legacy row)
 *   - `undefined` — no row exists for that ID (not a builder)
 *
 * This three-valued return cleanly distinguishes "legacy builder" from
 * "non-builder sender." Used by the Phase 3 affinity-aware resolver.
 */
export function lookupBuilderSpawningArchitect(builderId: string): string | null | undefined {
  const db = getDb();
  const row = db.prepare('SELECT spawned_by_architect FROM builders WHERE id = ?').get(builderId) as
    | { spawned_by_architect: string | null }
    | undefined;
  if (!row) return undefined;
  return row.spawned_by_architect;
}

// Re-export closeDb for cleanup
export { closeDb };
