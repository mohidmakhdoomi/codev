import * as vscode from 'vscode';

/**
 * Signpost view for the Codev panel container (#812). Scaffolding only: the
 * container exists so follow-up PRs can migrate real views into it, but until
 * one does there is nothing to show. This provider renders a single row that
 * explains the panel's purpose and points at the migration issues. Its view is
 * gated by the `codev.panelContainerEmpty` context key, so once a real panel
 * view registers (and flips that key false) the placeholder hides itself.
 */
export class PanelPlaceholderProvider implements vscode.TreeDataProvider<vscode.TreeItem> {
  getTreeItem(element: vscode.TreeItem): vscode.TreeItem {
    return element;
  }

  getChildren(): vscode.TreeItem[] {
    const item = new vscode.TreeItem(
      'Codev panel views land here. See issues #813 (Recently Closed), #814 (Team), #815 (Status).',
    );
    item.tooltip = 'Panel-side views migrate into this container via follow-up PRs (#813, #814, #815).';
    item.iconPath = new vscode.ThemeIcon('info');
    return [item];
  }
}
