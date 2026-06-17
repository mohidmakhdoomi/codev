/**
 * Unit tests for the Builders-view grouping strategies (#952). Each axis
 * (`stage` | `area`) is a `BuilderGrouping` that owns its bucketing, row prefix,
 * and flatten rule; this pins those per-axis decisions in one place. Pure /
 * vscode-free, so it runs under the vitest harness.
 */

import { describe, it, expect } from 'vitest';
import type { OverviewBuilder } from '@cluesmith/codev-types';
import { stageGrouping, areaGrouping } from '../views/builder-grouping.js';

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

describe('stageGrouping', () => {
  const g = stageGrouping();

  it('id is stage', () => {
    expect(g.id).toBe('stage');
  });

  it('buckets by protocolPhase → stage, in lifecycle order, empty stages omitted', () => {
    const builders = [
      builder({ id: 'a', protocolPhase: 'review' }),
      builder({ id: 'b', protocolPhase: 'plan' }),
      builder({ id: 'c', protocolPhase: 'fix' }),        // bugfix fix → implement
      builder({ id: 'd', protocolPhase: 'implement' }),
    ];
    expect(g.group(builders).map(x => x.key)).toEqual(['plan', 'implement', 'review']);
  });

  it('rowPrefix is the complementary area label; Uncategorized omitted', () => {
    expect(g.rowPrefix(builder({ area: 'vscode' }))).toBe('[vscode] ');
    expect(g.rowPrefix(builder({ area: 'cross-cutting' }))).toBe('[cross-cutting] ');
    expect(g.rowPrefix(builder({ area: 'Uncategorized' }))).toBe('');
  });

  it('does NOT flatten a lone Uncategorized group (stage axis always applies)', () => {
    expect(g.flattenLoneUncategorized).toBe(false);
  });
});

describe('areaGrouping', () => {
  const g = areaGrouping();

  it('id is area', () => {
    expect(g.id).toBe('area');
  });

  it('buckets by area (alphabetical, Uncategorized last)', () => {
    const builders = [
      builder({ id: 'a', area: 'tower' }),
      builder({ id: 'b', area: 'Uncategorized' }),
      builder({ id: 'c', area: 'vscode' }),
      builder({ id: 'd', area: 'core' }),
    ];
    expect(g.group(builders).map(x => x.key)).toEqual(['core', 'tower', 'vscode', 'Uncategorized']);
  });

  it('rowPrefix flips to the complementary phase label; empty phase omitted', () => {
    expect(g.rowPrefix(builder({ protocolPhase: 'implement' }))).toBe('[implement] ');
    expect(g.rowPrefix(builder({ protocolPhase: 'plan' }))).toBe('[plan] ');
    expect(g.rowPrefix(builder({ protocolPhase: '' }))).toBe('');
  });

  it('flattens a lone Uncategorized group (unlabeled-repo zero-regression)', () => {
    expect(g.flattenLoneUncategorized).toBe(true);
  });
});
