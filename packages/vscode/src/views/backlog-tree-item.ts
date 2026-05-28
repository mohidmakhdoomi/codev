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
 */
export class BacklogGroupTreeItem extends AreaGroupTreeItem {
  constructor(areaName: string, count: number, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(areaName, 'backlog', count, collapsibleState);
  }
}
