/**
 * Unit tests for the adaptive architect tier of the Agents tree (Issue 1104).
 *
 * Pins the count-check root (single-architect collapse vs architect-rooted),
 * the passive-architect leaf rule, the level-2 area/phase delegation under an
 * architect, the Unassigned bucket, and the three-level `getParent` chain that
 * keeps `reveal` working. Mocks `vscode` per the established `__tests__` pattern
 * (see builders-accordion.test.ts).
 */

import { describe, it, expect, vi } from 'vitest';
import type { OverviewBuilder, OverviewData, ArchitectState } from '@cluesmith/codev-types';

/** Per-test config overrides the mocked `workspace.getConfiguration` reads. */
const configValues: Record<string, unknown> = {};

vi.mock('vscode', () => {
  class FakeEventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    readonly event = (listener: (e: T) => void): { dispose: () => void } => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
    };
    fire = vi.fn((e: T) => { this.listeners.forEach((l) => l(e)); });
  }
  class TreeItem {
    id?: string;
    tooltip?: string;
    description?: string;
    contextValue?: string;
    iconPath?: unknown;
    command?: unknown;
    constructor(public label: string, public collapsibleState?: number) {}
  }
  class ThemeIcon { constructor(public id: string, public color?: unknown) {} }
  class ThemeColor { constructor(public id: string) {} }
  return {
    EventEmitter: FakeEventEmitter,
    TreeItem,
    ThemeIcon,
    ThemeColor,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    workspace: {
      getConfiguration: () => ({
        get: (key: string, def: unknown) => (key in configValues ? configValues[key] : def),
      }),
    },
  };
});

const vscode = await import('vscode');
const { BuildersProvider } = await import('../views/builders.js');
const { ArchitectGroupTreeItem, BuilderGroupTreeItem, BuilderTreeItem } = await import('../views/builder-tree-item.js');

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

function arch(name: string): ArchitectState {
  return { name, port: 0, pid: 1, terminalId: `t-${name}`, persistent: false };
}

function fakeCache(builders: OverviewBuilder[], architects: ArchitectState[]) {
  const data = { builders, backlog: [], pendingPRs: [], recentlyClosed: [], architects } as unknown as OverviewData;
  return { getData: () => data, onDidChange: () => ({ dispose() {} }) } as never;
}

const fakeDiffCache = {} as never;

function makeProvider(builders: OverviewBuilder[], architects: ArchitectState[]) {
  return new BuildersProvider(fakeCache(builders, architects), fakeDiffCache);
}

describe('Agents tree — adaptive root (#1104)', () => {
  it('roots at area/phase groups (no architect tier) when one architect', async () => {
    const provider = makeProvider(
      [builder({ id: 'a', spawnedByArchitect: 'main' })],
      [arch('main')],
    );
    const roots = await provider.getChildren();
    expect(roots.some(r => r instanceof ArchitectGroupTreeItem)).toBe(false);
  });

  it('roots at area/phase groups when zero architects (today behaviour)', async () => {
    const provider = makeProvider([builder({ id: 'a' })], []);
    const roots = await provider.getChildren();
    expect(roots.some(r => r instanceof ArchitectGroupTreeItem)).toBe(false);
  });

  it('roots at architect nodes (main-first) when more than one architect', async () => {
    const provider = makeProvider(
      [
        builder({ id: 'a', spawnedByArchitect: 'main' }),
        builder({ id: 'b', spawnedByArchitect: 'vscode' }),
      ],
      [arch('vscode'), arch('main')], // liveArchitects returns main-first; emulate that order
    );
    const roots = await provider.getChildren();
    expect(roots.every(r => r instanceof ArchitectGroupTreeItem)).toBe(true);
    expect((roots as Array<{ architectName: string }>).map(r => r.architectName)).toContain('main');
    expect((roots as Array<{ architectName: string }>).map(r => r.architectName)).toContain('vscode');
  });

  it('renders a passive architect (zero builders) as a leaf, its owner as collapsible', async () => {
    const provider = makeProvider(
      [builder({ id: 'a', spawnedByArchitect: 'main' })],
      [arch('main'), arch('reviewer')],
    );
    const roots = await provider.getChildren() as Array<{ architectName: string; collapsibleState?: number }>;
    const main = roots.find(r => r.architectName === 'main')!;
    const reviewer = roots.find(r => r.architectName === 'reviewer')!;
    expect(main.collapsibleState).toBe(vscode.TreeItemCollapsibleState.Collapsed);
    expect(reviewer.collapsibleState).toBe(vscode.TreeItemCollapsibleState.None);
  });

  it('an architect node expands to its own builders, partitioned by owner', async () => {
    const provider = makeProvider(
      [
        builder({ id: 'a', spawnedByArchitect: 'main' }),
        builder({ id: 'b', spawnedByArchitect: 'vscode' }),
        builder({ id: 'c', spawnedByArchitect: 'main' }),
      ],
      [arch('main'), arch('vscode')],
    );
    const roots = await provider.getChildren() as Array<{ architectName: string }>;
    const mainNode = roots.find(r => r.architectName === 'main');
    const groups = await provider.getChildren(mainNode as never);
    const rows: unknown[] = [];
    for (const g of groups) { rows.push(...await provider.getChildren(g as never)); }
    const ids = (rows as Array<{ builderId: string }>).map(r => r.builderId);
    expect(ids.sort()).toEqual(['a', 'c']);
    expect(rows.every(r => r instanceof BuilderTreeItem)).toBe(true);
  });

  it('collects an orphan builder under a non-interactive Unassigned node', async () => {
    const provider = makeProvider(
      [
        builder({ id: 'a', spawnedByArchitect: 'main' }),
        builder({ id: 'orphan', spawnedByArchitect: null }),
      ],
      [arch('main'), arch('vscode')],
    );
    const roots = await provider.getChildren() as Array<{ architectName: string; contextValue?: string; command?: unknown }>;
    const unassigned = roots.find(r => r.contextValue === 'agent-unassigned');
    expect(unassigned).toBeDefined();
    expect(unassigned!.command).toBeUndefined(); // not a real architect → no open-terminal
  });

  it('walks builder → group → architect via getParent (reveal chain)', async () => {
    const provider = makeProvider(
      [builder({ id: 'a', spawnedByArchitect: 'main', protocolPhase: 'implement' }),
       builder({ id: 'z', spawnedByArchitect: 'vscode' })],
      [arch('main'), arch('vscode')],
    );
    const roots = await provider.getChildren() as Array<{ architectName: string }>;
    const mainNode = roots.find(r => r.architectName === 'main')!;
    const groups = await provider.getChildren(mainNode as never);
    const group = groups[0];
    const rows = await provider.getChildren(group as never);
    const row = rows[0];

    expect(row).toBeInstanceOf(BuilderTreeItem);
    expect(group).toBeInstanceOf(BuilderGroupTreeItem);
    expect(await provider.getParent(row)).toBe(group);
    expect(await provider.getParent(group)).toBe(mainNode);
    expect(await provider.getParent(mainNode as never)).toBeUndefined();
  });
});
