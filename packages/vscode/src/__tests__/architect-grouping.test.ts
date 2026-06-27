/**
 * Unit tests for the architect-tier partition helpers (Issue 1104) — the pure,
 * vscode-free logic behind the multi-architect Agents tree.
 */

import { describe, it, expect } from 'vitest';
import type { OverviewBuilder } from '@cluesmith/codev-types';
import {
  partitionByArchitect,
  architectBadge,
  UNASSIGNED_ARCHITECT,
} from '../views/architect-grouping.js';

function builder(overrides: Partial<OverviewBuilder>): OverviewBuilder {
  return {
    id: 'pir-1', issueId: '1', issueTitle: 't', phase: 'implement', protocolPhase: 'implement',
    mode: 'strict', gates: {}, worktreePath: '/tmp/wt', roleId: null, protocol: 'pir',
    planPhases: [], progress: 0, blocked: null, blockedGate: null, blockedSince: null,
    startedAt: null, idleMs: 0, lastDataAt: null, spawnedByArchitect: null,
    area: 'Uncategorized', prReady: false,
    ...overrides,
  } as OverviewBuilder;
}

describe('partitionByArchitect (#1104)', () => {
  it('buckets builders under their owning architect, roster order preserved', () => {
    const builders = [
      builder({ id: 'a', spawnedByArchitect: 'main' }),
      builder({ id: 'b', spawnedByArchitect: 'vscode' }),
      builder({ id: 'c', spawnedByArchitect: 'main' }),
    ];
    const parts = partitionByArchitect(builders, ['main', 'vscode']);
    expect(parts.map(p => p.name)).toEqual(['main', 'vscode']);
    expect(parts[0].builders.map(b => b.id)).toEqual(['a', 'c']);
    expect(parts[1].builders.map(b => b.id)).toEqual(['b']);
    expect(parts.every(p => p.interactive)).toBe(true);
  });

  it('keeps a passive architect (zero builders) as an interactive empty partition', () => {
    const parts = partitionByArchitect(
      [builder({ id: 'a', spawnedByArchitect: 'main' })],
      ['main', 'reviewer'],
    );
    const reviewer = parts.find(p => p.name === 'reviewer');
    expect(reviewer).toBeDefined();
    expect(reviewer!.builders).toEqual([]);
    expect(reviewer!.interactive).toBe(true);
  });

  it('collects null-owner builders under a trailing, non-interactive Unassigned bucket', () => {
    const builders = [
      builder({ id: 'a', spawnedByArchitect: 'main' }),
      builder({ id: 'orphan', spawnedByArchitect: null }),
    ];
    const parts = partitionByArchitect(builders, ['main']);
    const last = parts[parts.length - 1];
    expect(last.name).toBe(UNASSIGNED_ARCHITECT);
    expect(last.interactive).toBe(false);
    expect(last.builders.map(b => b.id)).toEqual(['orphan']);
  });

  it('routes a builder whose owner is no longer in the roster to Unassigned', () => {
    // Architect removed after spawn: the row would otherwise vanish.
    const builders = [builder({ id: 'stale', spawnedByArchitect: 'gone' })];
    const parts = partitionByArchitect(builders, ['main']);
    expect(parts.find(p => p.name === UNASSIGNED_ARCHITECT)?.builders.map(b => b.id)).toEqual(['stale']);
  });

  it('emits no Unassigned bucket when every builder is owned', () => {
    const parts = partitionByArchitect(
      [builder({ id: 'a', spawnedByArchitect: 'main' })],
      ['main'],
    );
    expect(parts.some(p => p.name === UNASSIGNED_ARCHITECT)).toBe(false);
  });
});

describe('architectBadge (#1104)', () => {
  const b = builder({ spawnedByArchitect: 'vscode' });

  it('is empty in single-architect workspaces (one architect, badge = noise)', () => {
    expect(architectBadge(b, 1, false)).toBe('');
  });

  it('is empty when the owning architect is already the row ancestor', () => {
    expect(architectBadge(b, 3, true)).toBe('');
  });

  it('shows the owning architect when multi-architect AND not an ancestor', () => {
    // The Unassigned-bucket case: a stale owner still surfaces as attribution.
    expect(architectBadge(b, 3, false)).toBe('vscode');
  });

  it('is empty for a truly ownerless builder even when surfaced detached', () => {
    expect(architectBadge(builder({ spawnedByArchitect: null }), 3, false)).toBe('');
  });
});
