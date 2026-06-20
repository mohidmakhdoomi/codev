/**
 * Unit tests for the shared builder-by-id lookup helpers (Issue #1072).
 *
 * `builderById` / `builderWithWorktree` replace the `builders.find(b => b.id
 * === id)` pattern that was duplicated across six command files and
 * `views/builders.ts`. These cover the absent-data, no-match, and
 * worktree-narrowing paths the call sites rely on.
 */

import { describe, it, expect } from 'vitest';
import type { OverviewBuilder, OverviewData } from '@cluesmith/codev-types';
import { builderById, builderWithWorktree } from '../builder-lookup.js';

// Only the `id` and `worktreePath` fields matter to these helpers; the rest of
// the (large) OverviewBuilder shape is filled by the cast.
const builder = (o: Partial<OverviewBuilder> & { id: string }): OverviewBuilder =>
  ({ worktreePath: `.builders/${o.id}`, ...o } as OverviewBuilder);

const data = (builders: OverviewBuilder[]): OverviewData =>
  ({ builders } as OverviewData);

describe('builderById', () => {
  it('returns the builder whose id matches', () => {
    const target = builder({ id: 'air-1072' });
    const found = builderById(data([builder({ id: 'pir-1066' }), target]), 'air-1072');
    expect(found).toBe(target);
  });

  it('returns undefined when no builder matches', () => {
    expect(builderById(data([builder({ id: 'pir-1066' })]), 'air-1072')).toBeUndefined();
  });

  it('returns undefined when data is null or undefined', () => {
    expect(builderById(null, 'air-1072')).toBeUndefined();
    expect(builderById(undefined, 'air-1072')).toBeUndefined();
  });
});

describe('builderWithWorktree', () => {
  it('returns the builder when it has a worktree on record', () => {
    const target = builder({ id: 'air-1072', worktreePath: '.builders/air-1072' });
    const found = builderWithWorktree(data([target]), 'air-1072');
    expect(found).toBe(target);
    // Narrowed type: worktreePath is a plain string the caller can use directly.
    expect(found?.worktreePath).toBe('.builders/air-1072');
  });

  it('returns undefined when the builder has no worktree', () => {
    const target = builder({ id: 'air-1072', worktreePath: '' });
    expect(builderWithWorktree(data([target]), 'air-1072')).toBeUndefined();
  });

  it('returns undefined when no builder matches', () => {
    expect(builderWithWorktree(data([builder({ id: 'pir-1066' })]), 'air-1072')).toBeUndefined();
  });

  it('returns undefined when data is null', () => {
    expect(builderWithWorktree(null, 'air-1072')).toBeUndefined();
  });
});
