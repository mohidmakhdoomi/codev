/**
 * Unit tests for the pure helpers that back the Backlog view:
 * - `filterMine` (mine-only / show-all toggle, from #809)
 * - `spawnableBacklog` (excludes issues with active builders)
 * - `visibleBacklogCount` and `formatBacklogTitle` (title-count, from #911)
 *
 * Lives in `__tests__/` (vitest harness) rather than `src/test/` (vscode-test
 * Electron harness) because the helpers touch no `vscode` APIs.
 */

import { describe, it, expect } from 'vitest';
import type { OverviewBacklogItem, OverviewData } from '@cluesmith/codev-types';
import {
  filterMine,
  spawnableBacklog,
  visibleBacklogCount,
  formatBacklogTitle,
} from '../views/backlog-filter.js';

function assignedItem(id: string, assignees: string[]): OverviewBacklogItem {
  return { id, title: `t${id}`, hasBuilder: false, assignees } as unknown as OverviewBacklogItem;
}

function spawnableItem(id: string, hasBuilder: boolean, assignees: string[] = []): OverviewBacklogItem {
  return { id, title: `t${id}`, hasBuilder, assignees } as unknown as OverviewBacklogItem;
}

function dataFrom(
  backlog: OverviewBacklogItem[],
  currentUser?: string | null,
): Pick<OverviewData, 'backlog' | 'currentUser'> {
  return { backlog, currentUser: currentUser ?? undefined };
}

describe('filterMine', () => {
  it('keeps only items assigned to currentUser', () => {
    const out = filterMine([
      assignedItem('1', ['alice']),
      assignedItem('2', ['bob']),
      assignedItem('3', ['alice', 'carol']),
    ], 'alice');
    expect(out.map(i => i.id)).toEqual(['1', '3']);
  });

  it('returns input unchanged when currentUser is null (gh-unavailable fallback)', () => {
    const items = [
      assignedItem('1', ['alice']),
      assignedItem('2', []),
    ];
    expect(filterMine(items, null).map(i => i.id)).toEqual(['1', '2']);
    expect(filterMine(items, undefined).map(i => i.id)).toEqual(['1', '2']);
    expect(filterMine(items, '').map(i => i.id)).toEqual(['1', '2']);
  });

  it('matches logins case-insensitively', () => {
    const out = filterMine([
      assignedItem('1', ['Alice']),
      assignedItem('2', ['BOB']),
    ], 'alice');
    expect(out.map(i => i.id)).toEqual(['1']);
  });

  it('returns empty for empty input', () => {
    expect(filterMine([], 'alice')).toEqual([]);
  });

  it('drops items with missing assignees field when filtering', () => {
    const noAssignees = { id: 'x', title: 'tx', hasBuilder: false } as unknown as OverviewBacklogItem;
    const out = filterMine([noAssignees, assignedItem('y', ['alice'])], 'alice');
    expect(out.map(i => i.id)).toEqual(['y']);
  });
});

describe('spawnableBacklog', () => {
  it('drops items that already have an active builder', () => {
    const out = spawnableBacklog([
      spawnableItem('1', false),
      spawnableItem('2', true),
      spawnableItem('3', false),
    ]);
    expect(out.map(i => i.id)).toEqual(['1', '3']);
  });

  it('returns empty for empty input', () => {
    expect(spawnableBacklog([])).toEqual([]);
  });

  it('preserves order of the kept items', () => {
    const out = spawnableBacklog([
      spawnableItem('a', false),
      spawnableItem('b', true),
      spawnableItem('c', false),
      spawnableItem('d', false),
    ]);
    expect(out.map(i => i.id)).toEqual(['a', 'c', 'd']);
  });
});

describe('visibleBacklogCount', () => {
  it('returns full spawnable count for both visible and total when showAll is true', () => {
    const data = dataFrom([
      spawnableItem('1', false, ['alice']),
      spawnableItem('2', false, ['bob']),
      spawnableItem('3', false, []),
    ], 'alice');
    expect(visibleBacklogCount(data, true)).toEqual({ visible: 3, total: 3 });
  });

  it('filters visible to currentUser-assigned when showAll is false', () => {
    const data = dataFrom([
      spawnableItem('1', false, ['alice']),
      spawnableItem('2', false, ['bob']),
      spawnableItem('3', false, ['alice', 'carol']),
    ], 'alice');
    expect(visibleBacklogCount(data, false)).toEqual({ visible: 2, total: 3 });
  });

  it('falls through to total when mine-only is on but currentUser is null', () => {
    const data = dataFrom([
      spawnableItem('1', false, ['alice']),
      spawnableItem('2', false, ['bob']),
    ], null);
    // filterMine is a no-op here, so visible == total — matches BacklogProvider's safety branch.
    expect(visibleBacklogCount(data, false)).toEqual({ visible: 2, total: 2 });
  });

  it('excludes items with active builders from both visible and total', () => {
    const data = dataFrom([
      spawnableItem('1', false, ['alice']),
      spawnableItem('2', true,  ['alice']),  // has a builder — out
      spawnableItem('3', false, ['bob']),
      spawnableItem('4', true,  ['bob']),    // has a builder — out
    ], 'alice');
    // total = spawnable count (2); visible = spawnable + filterMine = 1.
    expect(visibleBacklogCount(data, false)).toEqual({ visible: 1, total: 2 });
    expect(visibleBacklogCount(data, true)).toEqual({ visible: 2, total: 2 });
  });

  it('returns zeros for empty backlog', () => {
    const data = dataFrom([], 'alice');
    expect(visibleBacklogCount(data, false)).toEqual({ visible: 0, total: 0 });
    expect(visibleBacklogCount(data, true)).toEqual({ visible: 0, total: 0 });
  });

  it('returns visible: 0, total > 0 when nothing is assigned to the current user', () => {
    const data = dataFrom([
      spawnableItem('1', false, ['bob']),
      spawnableItem('2', false, ['carol']),
    ], 'alice');
    expect(visibleBacklogCount(data, false)).toEqual({ visible: 0, total: 2 });
  });
});

describe('formatBacklogTitle', () => {
  it('returns plain "Backlog" when counts are unknown (no data)', () => {
    expect(formatBacklogTitle(undefined, undefined)).toBe('Backlog');
  });

  it('returns "Backlog (N)" when visible == total', () => {
    expect(formatBacklogTitle(5, 5)).toBe('Backlog (5)');
    expect(formatBacklogTitle(0, 0)).toBe('Backlog (0)');
  });

  it('returns "Backlog (V of T)" when mine-only is hiding rows', () => {
    expect(formatBacklogTitle(3, 47)).toBe('Backlog (3 of 47)');
    expect(formatBacklogTitle(0, 5)).toBe('Backlog (0 of 5)');
  });

  it('treats partial undefined counts as the no-data case', () => {
    expect(formatBacklogTitle(undefined, 5)).toBe('Backlog');
    expect(formatBacklogTitle(5, undefined)).toBe('Backlog');
  });
});
