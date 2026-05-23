/**
 * Migration Functions
 *
 * Handles migration from JSON files to SQLite databases
 */

import type Database from 'better-sqlite3';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Legacy JSON state format (pre-SQLite migration).
 * Includes pid/port fields that no longer exist on current application types.
 */
interface LegacyJsonState {
  architect: { pid: number; port: number; cmd: string; startedAt: string; tmuxSession?: string } | null;
  builders: Array<{
    id: string; name: string; port: number; pid: number; status: string; phase: string;
    worktree: string; branch: string; tmuxSession?: string; type: string;
    taskText?: string; protocolName?: string;
  }>;
  utils: Array<{ id: string; name: string; port: number; pid: number; tmuxSession?: string }>;
  annotations: Array<{
    id: string; file: string; port: number; pid: number;
    parent: { type: string; id?: string };
  }>;
}

/**
 * Migrate local state from JSON to SQLite.
 *
 * Bugfix #826: the architect row needs a workspace_path. The legacy JSON
 * state has no such field — the architect was implicitly scoped to whatever
 * workspace this state.db belongs to. Callers pass `workspacePath` (the
 * workspace this state.db lives under) to fill that gap.
 *
 * Bugfix #826 iter-6: canonicalize (realpath) before write so a symlinked
 * workspaceRoot can't seed a row that Tower's canonical-path lookups won't
 * find. Mirrors the normalization in state.ts accessors.
 */
export function migrateLocalFromJson(
  db: Database.Database,
  jsonPath: string,
  workspacePath: string,
): void {
  const jsonContent = readFileSync(jsonPath, 'utf-8');
  const state: LegacyJsonState = JSON.parse(jsonContent);

  let canonicalWorkspacePath: string;
  try {
    canonicalWorkspacePath = realpathSync(workspacePath);
  } catch {
    canonicalWorkspacePath = resolve(workspacePath);
  }

  // Wrap in transaction for atomicity
  const migrate = db.transaction(() => {
    // Migrate architect (Spec 755: legacy singleton becomes architect named 'main')
    // Bugfix #826: tag with canonical workspace_path so the row is scoped.
    if (state.architect) {
      db.prepare(`
        INSERT INTO architect (workspace_path, id, pid, port, cmd, started_at)
        VALUES (@workspacePath, 'main', @pid, @port, @cmd, @startedAt)
      `).run({
        workspacePath: canonicalWorkspacePath,
        pid: state.architect.pid,
        port: state.architect.port,
        cmd: state.architect.cmd,
        startedAt: state.architect.startedAt,
      });
    }

    // Migrate builders
    for (const builder of state.builders || []) {
      db.prepare(`
        INSERT INTO builders (
          id, name, port, pid, status, phase, worktree, branch,
          type, task_text, protocol_name
        )
        VALUES (
          @id, @name, @port, @pid, @status, @phase, @worktree, @branch,
          @type, @taskText, @protocolName
        )
      `).run({
        id: builder.id,
        name: builder.name,
        port: builder.port,
        pid: builder.pid,
        status: builder.status,
        phase: builder.phase,
        worktree: builder.worktree,
        branch: builder.branch,
        type: builder.type,
        taskText: builder.taskText ?? null,
        protocolName: builder.protocolName ?? null,
      });
    }

    // Migrate utils
    for (const util of state.utils || []) {
      db.prepare(`
        INSERT INTO utils (id, name, port, pid)
        VALUES (@id, @name, @port, @pid)
      `).run({
        id: util.id,
        name: util.name,
        port: util.port,
        pid: util.pid,
      });
    }

    // Migrate annotations
    for (const annotation of state.annotations || []) {
      db.prepare(`
        INSERT INTO annotations (id, file, port, pid, parent_type, parent_id)
        VALUES (@id, @file, @port, @pid, @parentType, @parentId)
      `).run({
        id: annotation.id,
        file: annotation.file,
        port: annotation.port,
        pid: annotation.pid,
        parentType: annotation.parent.type,
        parentId: annotation.parent.id ?? null,
      });
    }
  });

  try {
    migrate();
  } catch (err) {
    console.error('[error] Migration failed. JSON file preserved.');
    console.error('[error] Manual recovery: delete state.db and restart');
    throw err;
  }
}
