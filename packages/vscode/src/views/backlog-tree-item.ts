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
 * Carries a binary roll-up icon (#926): green `circle-filled` when the area
 * already has ≥1 active builder (someone's working it), grey `circle-outline`
 * when it's open to spawn into. The count comes from
 * `activeBuilderCountByArea` (computed from `OverviewData.builders`, not the
 * visible issues — those are builder-less by construction); the exact count
 * lives in the tooltip, the glyph stays glanceable. The rollup is set here in
 * the subclass, not the shared base, because the Builders view rolls up
 * differently.
 */
export class BacklogGroupTreeItem extends AreaGroupTreeItem {
  constructor(
    areaName: string,
    count: number,
    collapsibleState: vscode.TreeItemCollapsibleState,
    activeBuilderCount: number,
  ) {
    super(areaName, 'backlog', count, collapsibleState);
    if (activeBuilderCount > 0) {
      this.iconPath = new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor('testing.iconPassed'));
      const plural = activeBuilderCount === 1 ? 'builder' : 'builders';
      this.tooltip = `${activeBuilderCount} ${plural} active in ${areaName}`;
    } else {
      this.iconPath = new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('disabledForeground'));
      this.tooltip = `No active builders in ${areaName}`;
    }
  }
}
