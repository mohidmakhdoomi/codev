import * as vscode from 'vscode';
import { AreaGroupTreeItem } from './area-group-tree-item.js';

/**
 * TreeItem subclass that carries a backlog issue's id and URL as typed fields.
 *
 * Why: VSCode passes the tree item itself (not its `command.arguments`)
 * to commands invoked from `view/item/context` menus. The backlog
 * context-menu commands (codev.spawnBuilder, codev.openBacklogIssue,
 * codev.copyBacklogIssueNumber) need to know which issue was
 * right-clicked, so BacklogProvider constructs rows with this class and
 * the command handlers narrow via `instanceof BacklogTreeItem` to read
 * `.issueId` / `.issueUrl` safely.
 *
 * Used by views/backlog.ts.
 */
export class BacklogTreeItem extends vscode.TreeItem {
  constructor(
    public readonly issueId: string,
    public readonly issueUrl: string,
    public readonly issueTitle: string,
    label: string,
  ) {
    super(label);
  }
}

/**
 * Area group header in the Backlog tree. Thin subclass of
 * `AreaGroupTreeItem` so the per-view expand/collapse handler in
 * `extension.ts` can scope to backlog groups via `instanceof`
 * (distinct from `BuilderGroupTreeItem`, which uses the same base).
 *
 * Carries a binary roll-up icon (#926): a filled grey `circle-filled` when the
 * area already has ≥1 active builder (someone's working it) vs. an outline grey
 * `circle-outline` when it's open to spawn into. Both use the muted
 * `disabledForeground` token, differing only in fill — green is deliberately
 * NOT used here so it stays exclusive to the Builders view's "agent actively
 * building" signal; the Backlog is a calm "where can I spawn" surface, not an
 * alert one. The count comes from `activeBuilderCountByArea` (computed from
 * `OverviewData.builders`, not the visible issues — those are builder-less by
 * construction); the exact count lives in the tooltip, the glyph stays
 * glanceable. The rollup is set here in the subclass, not the shared base,
 * because the Builders view rolls up differently.
 */
export class BacklogGroupTreeItem extends AreaGroupTreeItem {
  constructor(
    areaName: string,
    count: number,
    collapsibleState: vscode.TreeItemCollapsibleState,
    activeBuilderCount: number,
  ) {
    super(areaName, 'backlog', count, collapsibleState);
    const grey = new vscode.ThemeColor('disabledForeground');
    if (activeBuilderCount > 0) {
      this.iconPath = new vscode.ThemeIcon('circle-filled', grey);
      const plural = activeBuilderCount === 1 ? 'builder' : 'builders';
      this.tooltip = `${activeBuilderCount} ${plural} active in ${areaName}`;
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-outline', grey);
      this.tooltip = `No active builders in ${areaName}`;
    }
  }
}
