import * as vscode from 'vscode';
import { AreaGroupTreeItem } from './area-group-tree-item.js';
import { BUILDER_STATE_GLYPH, worstBuilderState, type GroupRollup } from './builder-row.js';
import { displayArchitectName } from './architect-display.js';

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
 * Group header in the Builders tree. Thin subclass of `AreaGroupTreeItem` so the
 * per-view expand/collapse handler in `extension.ts` can scope to builder groups
 * via `instanceof` (distinct from `BacklogGroupTreeItem`, which uses the same base).
 *
 * `groupName` is whatever key the active grouping strategy produced (#952): a
 * lifecycle stage in stage mode, an `area/*` value in area mode. The header is
 * axis-agnostic — it just renders the name and the state rollup.
 *
 * Carries a worst-of-three roll-up icon (#926) over the group's
 * `{ blocked, idle, active }` counts (from `rollupGroupState`), reusing the
 * builder-row vocabulary: any blocked → yellow `bell`; else any idle → blue
 * `comment-discussion`; else green `circle-filled`. This is a *state* rollup,
 * orthogonal to the group the header names: the label says which group, the icon
 * says whether anyone in it needs attention. The blocked case uses a GENERIC
 * `bell` (not the row's gate-specific `gateIconFor` shape) because a group can
 * hold builders at different gates — the yellow color is the group-level "needs
 * attention" signal. The triple is spelled out in the tooltip. Set here in the
 * subclass, not the shared base, because the Backlog view rolls up differently.
 */
export class BuilderGroupTreeItem extends AreaGroupTreeItem {
  constructor(
    groupName: string,
    count: number,
    collapsibleState: vscode.TreeItemCollapsibleState,
    rollup: GroupRollup,
    /**
     * Owning architect's name when this group sits under an architect node in
     * the multi-architect Agents tree (Issue 1104), else `undefined` for the
     * single-architect root-level grouping. When set it namespaces the row id
     * so two architects' identically-keyed groups (e.g. both own a `TOWER`
     * group) don't collide on VSCode's id-keyed expansion state, and lets
     * `getChildren` filter that group's rows to the right architect.
     */
    public readonly architectName?: string,
  ) {
    super(groupName, 'builder', count, collapsibleState);
    if (architectName) {
      this.id = `builder-group:${architectName}:${groupName}`;
    }
    const { icon, color } = BUILDER_STATE_GLYPH[worstBuilderState(rollup)];
    this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
    this.tooltip = `${rollup.blocked} blocked · ${rollup.idle} waiting · ${rollup.active} active`;
  }
}

/**
 * Architect-tier node — the level-1 grouping in the Agents tree when the
 * workspace hosts more than one architect (Issue 1104). Renders the architect's
 * (uppercased) name and, when it owns builders, a worst-of rollup glyph + count
 * over ALL builders beneath it (summed across its area/phase sub-groups) — the
 * same `BUILDER_STATE_GLYPH` vocabulary and `"<b> blocked · <i> waiting · <a>
 * active"` tooltip as `BuilderGroupTreeItem`, one tier up.
 *
 * Two shapes:
 *  - **Owns builders** → `Collapsed`, rollup glyph, click opens that architect's
 *    terminal. Siblings carry a `-sibling` contextValue (Remove menu); `main`
 *    carries `-main` (undeletable).
 *  - **Passive** (REVIEWER pattern: zero builders) → `None` leaf with a neutral
 *    `person` icon, so it reads as an interactive-but-empty identity row rather
 *    than a falsely-green "active" dot. Still clickable to open its terminal.
 *
 * The synthetic "Unassigned" bucket (`UNASSIGNED_ARCHITECT`) is not a real
 * architect: `interactive: false` drops the open-terminal command and the
 * remove menu, and it gets a neutral `question` icon.
 */
export class ArchitectGroupTreeItem extends vscode.TreeItem {
  constructor(
    public readonly architectName: string,
    builderCount: number,
    rollup: GroupRollup,
    interactive: boolean = true,
  ) {
    const hasBuilders = builderCount > 0;
    super(
      hasBuilders ? `${displayArchitectName(architectName)} (${builderCount})` : displayArchitectName(architectName),
      hasBuilders ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
    );
    this.id = `agent-architect:${architectName}`;

    if (!interactive) {
      // Unassigned bucket: neutral, non-clickable, no remove.
      this.iconPath = new vscode.ThemeIcon('question', new vscode.ThemeColor('disabledForeground'));
      this.tooltip = `${rollup.blocked} blocked · ${rollup.idle} waiting · ${rollup.active} active`;
      this.contextValue = 'agent-unassigned';
      return;
    }

    if (hasBuilders) {
      const { icon, color } = BUILDER_STATE_GLYPH[worstBuilderState(rollup)];
      this.iconPath = new vscode.ThemeIcon(icon, new vscode.ThemeColor(color));
      this.tooltip = `${rollup.blocked} blocked · ${rollup.idle} waiting · ${rollup.active} active`;
    } else {
      this.iconPath = new vscode.ThemeIcon('person');
      this.tooltip = `${displayArchitectName(architectName)} — no builders`;
    }
    // `main` is workspace-defining and undeletable; siblings expose Remove via
    // the package.json menus contribution (mirrors Workspace > Architects).
    this.contextValue = architectName === 'main' ? 'agent-architect-main' : 'agent-architect-sibling';
    this.command = {
      command: 'codev.openArchitectTerminal',
      title: 'Open Architect Terminal',
      arguments: [architectName],
    };
  }
}
