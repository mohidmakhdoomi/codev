/**
 * Unit tests for the pure helpers behind the Search Backlog Quick Pick (#918):
 * - `orderForSearch` (full spawnable backlog, mine-first, NO mine-only filter)
 * - `toQuickPickItems` (label / description projection, deterministic age)
 *
 * Lives in `__tests__/` (vitest harness) rather than `src/test/` (vscode-test
 * Electron harness) because the helpers touch no `vscode` APIs.
 */

import { describe, it, expect } from 'vitest';
import type { OverviewBacklogItem, OverviewData } from '@cluesmith/codev-types';
import { orderForSearch, toQuickPickItems } from '../views/backlog-search.js';

function item(
  id: string,
  over: Partial<OverviewBacklogItem> = {},
): OverviewBacklogItem {
  return {
    id,
    title: `t${id}`,
    area: 'vscode',
    hasBuilder: false,
    assignees: [],
    createdAt: '2026-05-30T00:00:00.000Z',
    ...over,
  } as unknown as OverviewBacklogItem;
}

function dataFrom(
  backlog: OverviewBacklogItem[],
  currentUser?: string | null,
): Pick<OverviewData, 'backlog' | 'currentUser'> {
  return { backlog, currentUser: currentUser ?? undefined };
}

describe('orderForSearch', () => {
  it('drops items that already have an active builder', () => {
    const out = orderForSearch(dataFrom([
      item('1'),
      item('2', { hasBuilder: true }),
      item('3'),
    ]));
    expect(out.map(i => i.id)).toEqual(['1', '3']);
  });

  it('puts current-user-assigned items first, preserving order within segments', () => {
    const out = orderForSearch(dataFrom([
      item('1', { assignees: ['bob'] }),
      item('2', { assignees: ['alice'] }),
      item('3', { assignees: ['carol'] }),
      item('4', { assignees: ['alice', 'dave'] }),
    ], 'alice'));
    // mine (2, 4) first in input order, then rest (1, 3) in input order
    expect(out.map(i => i.id)).toEqual(['2', '4', '1', '3']);
  });

  it('does NOT apply the mine-only filter — the full set is retained', () => {
    const out = orderForSearch(dataFrom([
      item('1', { assignees: ['alice'] }),
      item('2', { assignees: ['bob'] }),
    ], 'alice'));
    expect(out.map(i => i.id)).toEqual(['1', '2']);
  });

  it('falls back to plain Tower order when currentUser is unavailable', () => {
    const out = orderForSearch(dataFrom([
      item('1', { assignees: ['alice'] }),
      item('2', { assignees: ['bob'] }),
    ], null));
    expect(out.map(i => i.id)).toEqual(['1', '2']);
  });
});

describe('toQuickPickItems', () => {
  const now = Date.parse('2026-05-30T00:00:00.000Z');

  it('formats label as "#<id> <title>"', () => {
    const [row] = toQuickPickItems([item('909', { title: 'webview thing' })], now);
    expect(row.label).toBe('#909 webview thing');
    expect(row.issueId).toBe('909');
  });

  it('formats description as "<area> · <age>" with a relative age', () => {
    const created = '2026-05-27T00:00:00.000Z'; // 3 days before `now`
    const [row] = toQuickPickItems([item('1', { area: 'tower', createdAt: created })], now);
    expect(row.description).toBe('tower · 3d ago');
  });

  it('appends "· @<assignee>" when an assignee is present', () => {
    const created = '2026-05-29T22:00:00.000Z'; // 2 hours before `now`
    const [row] = toQuickPickItems(
      [item('1', { area: 'docs', createdAt: created, assignees: ['alice', 'bob'] })],
      now,
    );
    expect(row.description).toBe('docs · 2h ago · @alice');
  });
});
