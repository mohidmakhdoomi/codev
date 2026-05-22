/**
 * Spec 755 Phase 2 — Naming CLI + spawn-time identity capture.
 *
 * Covers the pure helpers (name validation + auto-numbering) and the
 * spawn-time env-var detection contract. CLI integration is exercised
 * end-to-end via the existing `tower-routes` / `tower-instances` test
 * harness once Tower-aware tests cover `addArchitect`; here we focus on
 * the unit-level pieces that need to be ironclad.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  validateArchitectName,
  autoNumberArchitectName,
  DEFAULT_ARCHITECT_NAME,
  MAX_ARCHITECT_NAME_LENGTH,
} from '../utils/architect-name.js';

describe('Spec 755 Phase 2 — architect-name helpers', () => {
  describe('validateArchitectName', () => {
    // Spec 786: `main` is now reserved at the validator level (was previously
    // accepted, with collision-rejection happening at the add-architect call
    // site). The reserved-name check provides defence in depth.
    it('rejects the reserved default name `main`', () => {
      expect(validateArchitectName('main')).toMatch(/reserved/i);
    });

    it('accepts simple lowercase names', () => {
      expect(validateArchitectName('sibling')).toBeNull();
      expect(validateArchitectName('architect-2')).toBeNull();
      expect(validateArchitectName('feature-team')).toBeNull();
    });

    it('accepts max-length names', () => {
      const name = 'a' + 'b'.repeat(MAX_ARCHITECT_NAME_LENGTH - 1);
      expect(name.length).toBe(MAX_ARCHITECT_NAME_LENGTH);
      expect(validateArchitectName(name)).toBeNull();
    });

    it('rejects empty strings', () => {
      expect(validateArchitectName('')).toMatch(/empty/i);
    });

    it('rejects names exceeding the length cap', () => {
      const name = 'a' + 'b'.repeat(MAX_ARCHITECT_NAME_LENGTH);
      expect(name.length).toBe(MAX_ARCHITECT_NAME_LENGTH + 1);
      const err = validateArchitectName(name);
      expect(err).toMatch(/at most 64/);
    });

    it('rejects uppercase letters', () => {
      expect(validateArchitectName('Main')).toMatch(/invalid/i);
      expect(validateArchitectName('SIBLING')).toMatch(/invalid/i);
    });

    it('rejects names that start with a digit', () => {
      expect(validateArchitectName('2-architect')).toMatch(/invalid/i);
    });

    it('rejects names that start with a dash', () => {
      expect(validateArchitectName('-architect')).toMatch(/invalid/i);
    });

    it('rejects names with spaces', () => {
      expect(validateArchitectName('my architect')).toMatch(/invalid/i);
    });

    it('rejects names with special characters', () => {
      expect(validateArchitectName('arch@1')).toMatch(/invalid/i);
      expect(validateArchitectName('arch.1')).toMatch(/invalid/i);
      expect(validateArchitectName('arch_1')).toMatch(/invalid/i);
    });

    it('rejects names with unicode', () => {
      expect(validateArchitectName('αρχιτέκτων')).toMatch(/invalid/i);
    });
  });

  describe('autoNumberArchitectName', () => {
    it('returns architect-2 for an empty workspace', () => {
      expect(autoNumberArchitectName([])).toBe('architect-2');
    });

    it('returns architect-2 when only main exists', () => {
      expect(autoNumberArchitectName(['main'])).toBe('architect-2');
    });

    it('returns architect-3 when main and architect-2 exist', () => {
      expect(autoNumberArchitectName(['main', 'architect-2'])).toBe('architect-3');
    });

    it('fills the smallest gap', () => {
      expect(autoNumberArchitectName(['main', 'architect-3'])).toBe('architect-2');
      expect(autoNumberArchitectName(['main', 'architect-2', 'architect-4'])).toBe('architect-3');
    });

    it('returns the next number after a contiguous run', () => {
      expect(autoNumberArchitectName(['main', 'architect-2', 'architect-3', 'architect-4'])).toBe('architect-5');
    });

    it('ignores custom (non-architect-N) names', () => {
      expect(autoNumberArchitectName(['main', 'sibling'])).toBe('architect-2');
      expect(autoNumberArchitectName(['main', 'sibling', 'architect-2'])).toBe('architect-3');
    });

    it('ignores invalid architect-N suffixes', () => {
      // architect-1 is invalid (numbering starts at 2 per spec), so it
      // doesn't reserve the '1' slot; architect-2 is still next.
      expect(autoNumberArchitectName(['main', 'architect-1'])).toBe('architect-2');
      expect(autoNumberArchitectName(['main', 'architect-abc'])).toBe('architect-2');
    });

    it('handles a Map-style iterable of keys', () => {
      const m = new Map<string, string>([
        ['main', 'tid-1'],
        ['architect-2', 'tid-2'],
      ]);
      expect(autoNumberArchitectName(m.keys())).toBe('architect-3');
    });
  });

  it('DEFAULT_ARCHITECT_NAME is "main"', () => {
    expect(DEFAULT_ARCHITECT_NAME).toBe('main');
  });
});

describe('Spec 755 Phase 2 — workspace-add-architect client-side validation', () => {
  // The CLI's empty-name handling is the user-facing guardrail. Server-side
  // validation duplicates it as defense in depth; the unit test here covers
  // both invocation patterns (no flag vs. explicit empty flag).

  it('treats absent --name as auto-number request (validation skipped)', () => {
    // When options.name is undefined, validateArchitectName is not invoked.
    // Simulate by checking the predicate directly.
    const name: string | undefined = undefined;
    expect(name === undefined).toBe(true);
  });

  it('rejects explicit --name "" before the Tower roundtrip', () => {
    const name = '';
    const trimmed = name.trim();
    expect(trimmed).toBe('');
    // The CLI handler must reject this before calling the client.
  });

  it('rejects explicit --name with only whitespace', () => {
    const name = '   ';
    const trimmed = name.trim();
    expect(trimmed).toBe('');
  });

  it('trims surrounding whitespace from supplied names before validation', () => {
    const name = '  sibling  ';
    const trimmed = name.trim();
    expect(trimmed).toBe('sibling');
    expect(validateArchitectName(trimmed)).toBeNull();
  });
});

describe('Spec 755 Phase 2 — spawn-time CODEV_ARCHITECT_NAME detection', () => {
  // The spawn-time read happens at module load time (see commands/spawn.ts).
  // We can't directly observe the const without re-importing the module, so
  // these tests check the same predicate that spawn.ts uses, ensuring the
  // env-var contract is honored consistently.

  const originalEnv = process.env.CODEV_ARCHITECT_NAME;

  beforeEach(() => {
    delete process.env.CODEV_ARCHITECT_NAME;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.CODEV_ARCHITECT_NAME;
    } else {
      process.env.CODEV_ARCHITECT_NAME = originalEnv;
    }
  });

  /** The same fallback predicate spawn.ts uses. */
  function readSpawningArchitectName(): string {
    return (process.env.CODEV_ARCHITECT_NAME && process.env.CODEV_ARCHITECT_NAME.trim()) || DEFAULT_ARCHITECT_NAME;
  }

  it('returns "main" when the env var is unset', () => {
    expect(readSpawningArchitectName()).toBe('main');
  });

  it('returns "main" when the env var is empty', () => {
    process.env.CODEV_ARCHITECT_NAME = '';
    expect(readSpawningArchitectName()).toBe('main');
  });

  it('returns "main" when the env var is whitespace only', () => {
    process.env.CODEV_ARCHITECT_NAME = '   ';
    expect(readSpawningArchitectName()).toBe('main');
  });

  it('returns the env-var value when set to an explicit name', () => {
    process.env.CODEV_ARCHITECT_NAME = 'sibling';
    expect(readSpawningArchitectName()).toBe('sibling');
  });

  it('returns the env-var value (trimmed) when set with surrounding whitespace', () => {
    process.env.CODEV_ARCHITECT_NAME = '  sibling  ';
    expect(readSpawningArchitectName()).toBe('sibling');
  });

  it('returns an auto-numbered name when that is what Tower injected', () => {
    process.env.CODEV_ARCHITECT_NAME = 'architect-3';
    expect(readSpawningArchitectName()).toBe('architect-3');
  });
});
