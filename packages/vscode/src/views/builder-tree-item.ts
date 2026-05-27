import * as vscode from 'vscode';
import { AreaGroupTreeItem } from './area-group-tree-item.js';

/**
 * TreeItem subclass that carries a builder id as a typed field.
 *
 * Why: VSCode passes the tree item itself (not its `command.arguments`)
 * to commands invoked from `view/item/context` menus. Builder-scoped
 * commands (codev.openWorktreeWindow, codev.runWorktreeDev,
 * codev.stopWorktreeDev, codev.viewPlanFile, codev.approveGate, etc.)
 * need to know which builder was right-clicked, so the views construct
 * builder rows with this class and the command handlers narrow via
 * `instanceof BuilderTreeItem` to read `.builderId` safely.
 *
 * Used by views/builders.ts.
 */
export class BuilderTreeItem extends vscode.TreeItem {
  constructor(
    public readonly builderId: string,
    label: string,
  ) {
    super(label);
  }
}

/**
 * Area group header in the Builders tree. Thin subclass of
 * `AreaGroupTreeItem` so the per-view expand/collapse handler in
 * `extension.ts` can scope to builder groups via `instanceof`
 * (distinct from `BacklogGroupTreeItem`, which uses the same base).
 */
export class BuilderGroupTreeItem extends AreaGroupTreeItem {
  constructor(areaName: string, count: number, collapsibleState: vscode.TreeItemCollapsibleState) {
    super(areaName, 'builder', count, collapsibleState);
  }
}
