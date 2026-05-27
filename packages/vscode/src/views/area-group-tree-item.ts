import * as vscode from 'vscode';

export type AreaGroupKind = 'backlog' | 'builder';

/**
 * Shared base for area-group header rows in the Backlog and Builders
 * trees. The `kind` discriminator drives both the stable `id` prefix
 * (so VSCode persists per-group expansion across cache ticks) and the
 * `contextValue` (so per-view context menus can scope cleanly).
 *
 * Concrete subclasses (`BacklogGroupTreeItem`, `BuilderGroupTreeItem`)
 * are thin tags around this base — they exist so each view's
 * onDidExpand/Collapse handler can scope to its own groups via
 * `instanceof` rather than discriminating on a string field.
 */
export class AreaGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly areaName: string,
    public readonly kind: AreaGroupKind,
    count: number,
    collapsibleState: vscode.TreeItemCollapsibleState,
  ) {
    super(`${areaName} (${count})`, collapsibleState);
    this.id = `${kind}-group:${areaName}`;
    this.contextValue = `${kind}-group`;
  }
}
