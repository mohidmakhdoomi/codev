import * as vscode from 'vscode';
import { AreaGroupTreeItem } from './area-group-tree-item.js';

/**
 * Minimal read/set contract for a group expand/collapse store, keyed by the
 * group's name (an area or a stage). Exists so `persistAreaGroupExpansion` can
 * accept either a concrete `AreaGroupExpansionStore` or a mode-routing wrapper
 * (the Builders view picks a per-mode store at call time — #952) without the
 * concrete class's private fields making the parameter nominally typed.
 */
export interface GroupExpansionStore {
  read(): Record<string, boolean>;
  set(name: string, expanded: boolean): void;
}

/**
 * Per-group expand/collapse state, persisted in `workspaceState`. One
 * instance per view + axis (each scopes its own key, e.g.
 * `codev.backlogGroupExpansion` / `codev.buildersGroupExpansion` /
 * `codev.buildersStageGroupExpansion`), so collapsing a group in one
 * place doesn't affect another.
 *
 * Default state for an untouched group is "expanded" — callers read
 * the map and apply `?? true` at render time.
 */
export class AreaGroupExpansionStore implements GroupExpansionStore {
  constructor(
    private readonly workspaceState: vscode.Memento,
    private readonly storageKey: string,
  ) {}

  read(): Record<string, boolean> {
    return this.workspaceState.get<Record<string, boolean>>(this.storageKey, {});
  }

  set(areaName: string, expanded: boolean): void {
    const map = this.read();
    map[areaName] = expanded;
    this.workspaceState.update(this.storageKey, map);
  }
}

/**
 * Wire a TreeView's expand/collapse events into an
 * AreaGroupExpansionStore. The `GroupClass` parameter is the
 * view-specific subclass (`BacklogGroupTreeItem` or
 * `BuilderGroupTreeItem`); the `instanceof` check ensures each store
 * only records events from its own view's groups, even though both
 * views ultimately produce `AreaGroupTreeItem`-derived rows.
 *
 * Returns the two `Disposable` subscriptions so the caller can push
 * them into the extension `context.subscriptions` array.
 */
export function persistAreaGroupExpansion(
  view: vscode.TreeView<vscode.TreeItem>,
  GroupClass: new (...args: never[]) => AreaGroupTreeItem,
  store: GroupExpansionStore,
): vscode.Disposable[] {
  return [
    view.onDidExpandElement((e) => {
      if (e.element instanceof GroupClass) {
        store.set(e.element.areaName, true);
      }
    }),
    view.onDidCollapseElement((e) => {
      if (e.element instanceof GroupClass) {
        store.set(e.element.areaName, false);
      }
    }),
  ];
}
