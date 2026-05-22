/**
 * Tests for state management with SQLite
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LOCAL_SCHEMA } from '../db/schema.js';

// Test directory
const testDir = resolve(process.cwd(), '.test-state');
let testDb: Database.Database;

// Mock the db module to use test database
vi.mock('../db/index.js', () => {
  return {
    getDb: () => {
      if (!testDb) {
        testDb = new Database(resolve(testDir, 'state.db'));
        testDb.pragma('journal_mode = WAL');
        testDb.pragma('busy_timeout = 5000');
        testDb.exec(LOCAL_SCHEMA);
        testDb.prepare('INSERT OR IGNORE INTO _migrations (version) VALUES (1)').run();
      }
      return testDb;
    },
    closeDb: () => {
      if (testDb) {
        testDb.close();
        testDb = null as any;
      }
    },
  };
});

// Import after mocking
const state = await import('../state.js');

describe('State Management', () => {
  beforeEach(() => {
    // Clean up before each test
    if (testDb) {
      testDb.close();
      testDb = null as any;
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (testDb) {
      testDb.close();
      testDb = null as any;
    }
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true });
    }
  });

  describe('loadState', () => {
    it('should return default state when database is empty', () => {
      const result = state.loadState();

      // Spec 786 Phase 5: loadState now returns `architects: []` alongside the
      // scalar `architect` shim (empty array when no rows in state.db.architect).
      expect(result).toEqual({
        architect: null,
        architects: [],
        builders: [],
        utils: [],
        annotations: [],
      });
    });

    // Spec 786 Phase 5: loadState populates `architects` with `main` first.
    it('returns architects collection with main first then siblings by started_at', () => {
      // Insert in a deliberately scrambled order: a sibling first, then main,
      // then another sibling. loadState must sort main to position 0.
      state.setArchitectByName('ob-refine', {
        name: 'ob-refine',
        cmd: 'claude',
        startedAt: '2026-05-22T10:00:00Z',
        terminalId: 'term-ob',
      });
      state.setArchitect({
        cmd: 'claude',
        startedAt: '2026-05-22T11:00:00Z',
        terminalId: 'term-main',
      });
      state.setArchitectByName('architect-3', {
        name: 'architect-3',
        cmd: 'claude',
        startedAt: '2026-05-22T12:00:00Z',
        terminalId: 'term-a3',
      });

      const result = state.loadState();
      expect(result.architects).toHaveLength(3);
      expect(result.architects[0].name).toBe('main');
      // Siblings in started_at order (ob-refine before architect-3).
      expect(result.architects[1].name).toBe('ob-refine');
      expect(result.architects[2].name).toBe('architect-3');
    });

    it('scalar `architect` shim points at architects[0] for backward-compat', () => {
      // With only a sibling registered (no main row), the scalar shim points
      // at the sibling (architects[0]) — preserving the Spec 755 fallback.
      state.setArchitectByName('ob-refine', {
        name: 'ob-refine',
        cmd: 'claude',
        startedAt: '2026-05-22T10:00:00Z',
      });

      const result = state.loadState();
      expect(result.architects).toHaveLength(1);
      expect(result.architects[0].name).toBe('ob-refine');
      expect(result.architect?.name).toBe('ob-refine');
    });
  });

  describe('setArchitect', () => {
    it('should set architect state', () => {
      const architect = {
        cmd: 'claude',
        startedAt: new Date().toISOString(),
      };

      state.setArchitect(architect);

      const result = state.loadState();
      expect(result.architect?.cmd).toBe('claude');
    });

    it('should clear architect when set to null', () => {
      // Set architect first
      state.setArchitect({
        cmd: 'claude',
        startedAt: new Date().toISOString(),
      });

      // Then clear it
      state.setArchitect(null);

      const result = state.loadState();
      expect(result.architect).toBeNull();
    });

    it('should replace existing architect (singleton)', () => {
      state.setArchitect({
        cmd: 'claude',
        startedAt: new Date().toISOString(),
      });

      state.setArchitect({
        cmd: 'claude --dangerously-skip-permissions',
        startedAt: new Date().toISOString(),
      });

      const result = state.loadState();
      expect(result.architect?.cmd).toBe('claude --dangerously-skip-permissions');
    });
  });

  describe('upsertBuilder', () => {
    it('should add new builder', () => {
      const builder = {
        id: 'B001',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
      };

      state.upsertBuilder(builder);

      const result = state.loadState();
      expect(result.builders).toHaveLength(1);
      expect(result.builders[0].id).toBe('B001');
      expect(result.builders[0].status).toBe('implementing');
    });

    it('should update existing builder', () => {
      const builder = {
        id: 'B001',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
      };

      state.upsertBuilder(builder);

      // Update status
      state.upsertBuilder({ ...builder, status: 'blocked' });

      const result = state.loadState();
      expect(result.builders).toHaveLength(1);
      expect(result.builders[0].status).toBe('blocked');
    });

    // Spec 755 Phase 2: spawnedByArchitect persistence.
    it('persists spawnedByArchitect when supplied', () => {
      state.upsertBuilder({
        id: 'B-spec755',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
        spawnedByArchitect: 'sibling',
      });

      const row = state.getBuilder('B-spec755');
      expect(row?.spawnedByArchitect).toBe('sibling');
    });

    it('preserves spawnedByArchitect across re-upserts (COALESCE)', () => {
      // First insert with an explicit architect name.
      state.upsertBuilder({
        id: 'B-spec755',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
        spawnedByArchitect: 'sibling',
      });

      // Subsequent status update without spawnedByArchitect must NOT clobber
      // the persisted name. The SQL uses COALESCE to preserve it.
      state.upsertBuilder({
        id: 'B-spec755',
        name: 'test-builder',
        status: 'blocked' as const,
        phase: 'review',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
        // spawnedByArchitect intentionally omitted.
      });

      const row = state.getBuilder('B-spec755');
      expect(row?.status).toBe('blocked');
      expect(row?.spawnedByArchitect).toBe('sibling');
    });

    it('leaves spawnedByArchitect null for legacy upserts that never supplied it', () => {
      state.upsertBuilder({
        id: 'B-spec755-legacy',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
      });

      const row = state.getBuilder('B-spec755-legacy');
      expect(row?.spawnedByArchitect).toBeUndefined();
    });
  });

  describe('removeBuilder', () => {
    it('should remove builder by id', () => {
      state.upsertBuilder({
        id: 'B001',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
      });

      state.removeBuilder('B001');

      const result = state.loadState();
      expect(result.builders).toHaveLength(0);
    });
  });

  describe('getBuilder', () => {
    it('should return builder by id', () => {
      state.upsertBuilder({
        id: 'B001',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
      });

      const builder = state.getBuilder('B001');
      expect(builder?.id).toBe('B001');
    });

    it('should return null for non-existent builder', () => {
      const builder = state.getBuilder('B999');
      expect(builder).toBeNull();
    });
  });

  describe('addUtil / removeUtil', () => {
    it('should add and remove utility terminals', () => {
      const util = {
        id: 'U001',
        name: 'test-util',
      };

      state.addUtil(util);

      let result = state.loadState();
      expect(result.utils).toHaveLength(1);
      expect(result.utils[0].id).toBe('U001');

      state.removeUtil('U001');

      result = state.loadState();
      expect(result.utils).toHaveLength(0);
    });
  });

  describe('addAnnotation / removeAnnotation', () => {
    it('should add and remove annotations', () => {
      const annotation = {
        id: 'A001',
        file: '/path/to/file.ts',
        parent: {
          type: 'architect' as const,
        },
      };

      state.addAnnotation(annotation);

      let result = state.loadState();
      expect(result.annotations).toHaveLength(1);
      expect(result.annotations[0].file).toBe('/path/to/file.ts');

      state.removeAnnotation('A001');

      result = state.loadState();
      expect(result.annotations).toHaveLength(0);
    });
  });

  describe('clearState', () => {
    it('should reset all state', () => {
      // Add some state
      state.setArchitect({
        cmd: 'claude',
        startedAt: new Date().toISOString(),
      });

      state.upsertBuilder({
        id: 'B001',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
      });

      // Clear it
      state.clearState();

      const result = state.loadState();
      // Spec 786 Phase 5: loadState now returns `architects: []` alongside the
      // scalar `architect` shim (empty array when no rows in state.db.architect).
      expect(result).toEqual({
        architect: null,
        architects: [],
        builders: [],
        utils: [],
        annotations: [],
      });
    });
  });

  // Spec 786 Phase 1: removeArchitect helper and clearRuntime variant.
  describe('removeArchitect (Spec 786)', () => {
    it('removes a named architect row from state.db', () => {
      state.setArchitectByName('ob-refine', {
        name: 'ob-refine',
        cmd: 'claude',
        startedAt: new Date().toISOString(),
        terminalId: 'term-1',
      });
      // Confirm it was inserted
      let architects = state.getArchitects();
      expect(architects.some(a => a.name === 'ob-refine')).toBe(true);

      state.removeArchitect('ob-refine');

      architects = state.getArchitects();
      expect(architects.some(a => a.name === 'ob-refine')).toBe(false);
    });

    it('is idempotent — removing a non-existent name is a no-op', () => {
      expect(() => state.removeArchitect('nonexistent')).not.toThrow();
    });

    it('does not affect other architects', () => {
      state.setArchitect({
        cmd: 'claude',
        startedAt: new Date().toISOString(),
        terminalId: 'main-term',
      });
      state.setArchitectByName('ob-refine', {
        name: 'ob-refine',
        cmd: 'claude',
        startedAt: new Date().toISOString(),
        terminalId: 'sibling-term',
      });

      state.removeArchitect('ob-refine');

      const architects = state.getArchitects();
      expect(architects.some(a => a.name === 'main')).toBe(true);
      expect(architects.some(a => a.name === 'ob-refine')).toBe(false);
    });
  });

  describe('clearRuntime (Spec 786)', () => {
    it('preserves all architect rows while wiping runtime tables', () => {
      // Set up: main + a sibling + a builder + a util + an annotation
      state.setArchitect({
        cmd: 'claude',
        startedAt: new Date().toISOString(),
        terminalId: 'main-term',
      });
      state.setArchitectByName('ob-refine', {
        name: 'ob-refine',
        cmd: 'claude',
        startedAt: new Date().toISOString(),
        terminalId: 'sibling-term',
      });
      state.upsertBuilder({
        id: 'B001',
        name: 'test-builder',
        status: 'implementing' as const,
        phase: 'init',
        worktree: '/tmp/worktree',
        branch: 'feature-branch',
        type: 'spec' as const,
      });

      state.clearRuntime();

      // Architects survive
      const architects = state.getArchitects();
      expect(architects).toHaveLength(2);
      expect(architects.some(a => a.name === 'main')).toBe(true);
      expect(architects.some(a => a.name === 'ob-refine')).toBe(true);

      // Builders are gone
      const result = state.loadState();
      expect(result.builders).toEqual([]);
      expect(result.utils).toEqual([]);
      expect(result.annotations).toEqual([]);
    });

    it('differs from clearState which wipes architects too', () => {
      // Confirm the differential behaviour: clearState removes architects;
      // clearRuntime preserves them.
      state.setArchitect({
        cmd: 'claude',
        startedAt: new Date().toISOString(),
      });
      state.setArchitectByName('ob-refine', {
        name: 'ob-refine',
        cmd: 'claude',
        startedAt: new Date().toISOString(),
      });

      state.clearState();

      const architectsAfterClear = state.getArchitects();
      expect(architectsAfterClear).toHaveLength(0);
    });
  });
});
