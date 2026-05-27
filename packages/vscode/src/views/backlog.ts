import * as vscode from 'vscode';
import type { OverviewBacklogItem } from '@cluesmith/codev-types';
import { UNCATEGORIZED_AREA } from '@cluesmith/codev-core/constants';
import type { OverviewCache } from './overview-data.js';
import { BacklogGroupTreeItem, BacklogTreeItem } from './backlog-tree-item.js';

const EXPANSION_STATE_KEY = 'codev.backlogGroupExpansion';

/**
 * Backlog rows the user can act on — exclude issues that already have an
 * active builder. Mirrors the dashboard's BacklogList
 * (`items.filter(i => !i.hasBuilder)`) so the extension and web show the
 * same "available work" set and you can't double-spawn from the Backlog.
 */
export function spawnableBacklog(items: OverviewBacklogItem[]): OverviewBacklogItem[] {
  return items.filter(i => !i.hasBuilder);
}

/**
 * Group backlog items by their resolved `area` (already projected on the
 * server via `parseArea`; see #819). Returned groups are ordered:
 *
 *   1. Any areas the caller pins via `priorityAreas`, in the listed order
 *   2. Alphabetical specific areas
 *   3. `Uncategorized` (last)
 *
 * Within-group order preserves the input order — the caller has already
 * applied any "mine-first" or sort policy. Empty groups are omitted
 * (no `<area> (0)` headers). Priority entries that don't match any
 * present area are silently skipped — same outcome as alphabetical for
 * absent areas.
 *
 * `priorityAreas` is per-repo policy supplied by the user via the
 * `codev.backlog.priorityAreas` setting. The framework intentionally
 * does NOT bake in any specific label name (e.g. `cross-cutting`) — that
 * decision belongs to the repo, not the framework, mirroring the
 * policy-free posture of `parseArea` (#819). Passing `[]` yields pure
 * alphabetical ordering, which is the appropriate default for any repo
 * that hasn't expressed a preference.
 *
 * Pure function — no VSCode dependency, unit-testable.
 */
export function groupBacklogByArea(
  items: OverviewBacklogItem[],
  priorityAreas: readonly string[] = [],
): Array<{ area: string; items: OverviewBacklogItem[] }> {
  const buckets = new Map<string, OverviewBacklogItem[]>();
  for (const item of items) {
    const bucket = buckets.get(item.area);
    if (bucket) {
      bucket.push(item);
    } else {
      buckets.set(item.area, [item]);
    }
  }

  const result: Array<{ area: string; items: OverviewBacklogItem[] }> = [];
  const consumed = new Set<string>();

  for (const area of priorityAreas) {
    // Uncategorized always lands last regardless of priority configuration —
    // it's the "no opinion" bucket, not a pinnable area.
    if (area === UNCATEGORIZED_AREA || consumed.has(area)) { continue; }
    const bucket = buckets.get(area);
    if (bucket) {
      result.push({ area, items: bucket });
      consumed.add(area);
    }
  }

  const uncategorized = buckets.get(UNCATEGORIZED_AREA);
  consumed.add(UNCATEGORIZED_AREA);

  const specifics = [...buckets.keys()]
    .filter(a => !consumed.has(a))
    .sort();
  for (const area of specifics) {
    result.push({ area, items: buckets.get(area)! });
  }

  if (uncategorized) {
    result.push({ area: UNCATEGORIZED_AREA, items: uncategorized });
  }

  return result;
}

/**
 * Backlog view: open GitHub issues with no PR yet, grouped by `area/*`
 * label. Group ordering: areas listed in the per-repo setting
 * `codev.backlog.priorityAreas` first (in their listed order), then
 * alphabetical specifics, then `Uncategorized` last. Within each group,
 * items assigned to the current user (auto-detected via
 * OverviewData.currentUser) sort to the top with an `account` icon; the
 * rest keep `issues`. Order within those two segments preserves Tower's
 * order.
 *
 * Row click starts work: it invokes codev.viewBacklogIssue with the
 * issue number pre-filled. Browser / copy / spawn actions live in the
 * right-click context menu (see package.json view/item/context).
 *
 * Group expand/collapse state persists per area name via
 * `workspaceState` under `codev.backlogGroupExpansion`. Default for
 * any group the user hasn't touched: expanded.
 */
export class BacklogProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  constructor(
    private readonly cache: OverviewCache,
    private readonly workspaceState: vscode.Memento,
  ) {
    cache.onDidChange(() => this.changeEmitter.fire());
  }

  /** Re-render when the user edits `codev.backlog.priorityAreas`. */
  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: vscode.TreeItem): vscode.TreeItem[] {
    if (element instanceof BacklogGroupTreeItem) {
      return this.rowsForGroup(element.areaName);
    }
    if (element) {
      return [];
    }
    return this.rootChildren();
  }

  /**
   * Persist a user's expand/collapse choice for an area group. Called
   * from `extension.ts` via `backlogView.onDidExpand/CollapseElement`.
   */
  setGroupExpanded(areaName: string, expanded: boolean): void {
    const map = this.readExpansionState();
    map[areaName] = expanded;
    void this.workspaceState.update(EXPANSION_STATE_KEY, map);
  }

  private rootChildren(): vscode.TreeItem[] {
    const data = this.cache.getData();
    if (!data) { return []; }

    const items = this.orderedSpawnable(data);
    const groups = groupBacklogByArea(items, this.readPriorityAreas());

    // Degenerate case: a repo that doesn't use `area/*` labels yields a
    // single `Uncategorized` group containing every issue. Rendering its
    // header would add no information — collapse to flat rows so the
    // backlog looks the same as it did before grouping shipped.
    if (groups.length === 1 && groups[0].area === UNCATEGORIZED_AREA) {
      return groups[0].items.map(item => this.makeRow(item, data));
    }

    const expansion = this.readExpansionState();
    return groups.map(g => {
      const expanded = expansion[g.area] ?? true;
      const state = expanded
        ? vscode.TreeItemCollapsibleState.Expanded
        : vscode.TreeItemCollapsibleState.Collapsed;
      return new BacklogGroupTreeItem(g.area, g.items.length, state);
    });
  }

  private rowsForGroup(areaName: string): vscode.TreeItem[] {
    const data = this.cache.getData();
    if (!data) { return []; }

    const items = this.orderedSpawnable(data);
    const group = groupBacklogByArea(items, this.readPriorityAreas())
      .find(g => g.area === areaName);
    if (!group) { return []; }

    return group.items.map(item => this.makeRow(item, data));
  }

  private makeRow(
    item: OverviewBacklogItem,
    data: NonNullable<ReturnType<OverviewCache['getData']>>,
  ): BacklogTreeItem {
    const me = data.currentUser?.toLowerCase();
    const assigned = !!me && !!item.assignees?.some(a => a.toLowerCase() === me);
    const author = item.author ? ` @${item.author}` : '';
    const ti = new BacklogTreeItem(item.id, item.url, `#${item.id} ${item.title}${author}`);
    ti.tooltip = item.url;
    ti.contextValue = 'backlog-item';
    ti.iconPath = new vscode.ThemeIcon(assigned ? 'account' : 'issues');
    if (assigned) { ti.description = 'assigned to you'; }
    ti.command = {
      command: 'codev.viewBacklogIssue',
      title: 'View Issue',
      arguments: [item.id],
    };
    return ti;
  }

  /**
   * Spawnable items in display order (mine-first, then rest), preserving
   * Tower's order within each segment. Identical to the pre-grouping
   * behavior so within-group ordering matches the old flat list.
   */
  private orderedSpawnable(data: NonNullable<ReturnType<OverviewCache['getData']>>): OverviewBacklogItem[] {
    const me = data.currentUser?.toLowerCase();
    const isMine = (item: OverviewBacklogItem) =>
      !!me && !!item.assignees?.some(a => a.toLowerCase() === me);

    const items = spawnableBacklog(data.backlog);
    const mine = items.filter(isMine);
    const rest = items.filter(item => !isMine(item));
    return [...mine, ...rest];
  }

  private readExpansionState(): Record<string, boolean> {
    return this.workspaceState.get<Record<string, boolean>>(EXPANSION_STATE_KEY, {});
  }

  private readPriorityAreas(): readonly string[] {
    const raw = vscode.workspace
      .getConfiguration('codev')
      .get<unknown>('backlog.priorityAreas');
    return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string') : [];
  }
}
