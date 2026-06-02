import * as vscode from 'vscode';
import { AreaGroupTreeItem } from './area-group-tree-item.js';
import { BUILDER_STATE_GLYPH, worstBuilderState, type GroupRollup } from './builder-row.js';

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
 *
 * Carries a worst-of-three roll-up icon (#926) over the group's
 * `{ blocked, idle, active }` counts (from `rollupGroupState`), reusing the
 * builder-row vocabulary: any blocked → yellow `bell`; else any idle → blue
 * `comment-discussion`; else green `circle-filled`. The blocked case uses a
 * GENERIC `bell` (not the row's gate-specific `gateIconFor` shape) because a
 * group can hold builders at different gates — the yellow color is the
 * group-level "needs attention" signal. The triple is spelled out in the
 * tooltip. Set here in the subclass, not the shared base, because the Backlog
 * view rolls up differently.
 */
export class BuilderGroupTreeItem extends AreaGroupTreeItem {
  constructor(
    areaName: string,
    count: number,
    collapsibleState: vscode.TreeItemCollapsibleState,
    rollup: GroupRollup,
  ) {
    super(areaName, 'builder', count, collapsibleState);
    const { icon, color } = BUILDER_STATE_GLYPH[worstBuilderState(rollup)];
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
    this.tooltip = `${rollup.blocked} blocked · ${rollup.idle} waiting · ${rollup.active} active`;
  }
}
