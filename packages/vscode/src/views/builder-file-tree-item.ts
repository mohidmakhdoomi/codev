import * as vscode from 'vscode';
import * as path from 'node:path';
import type { ChangeEntry, ChangeStatus, ResourcePlan } from '../commands/view-diff.js';

/**
 * Second-level tree row: one changed file under a builder in the Builders
 * view. Carries the typed fields the `codev.openBuilderFileDiff` handler
 * needs (it receives the item itself, like the backlog/builder rows, and
 * narrows via `instanceof`).
 *
 * `plan` (left/right `SideSpec`) feeds `diffUrisForChange`; `change`
 * carries the git status (used for the tooltip + rename source). The
 * status *icon* is deliberately NOT set here — `resourceUri` lets the
 * file-type icon show, and `BuilderFileDecorationProvider` adds the
 * SCM-style colored status-letter badge, mirroring VSCode's Git decorator.
 *
 * Used by views/builders.ts.
 */

const STATUS_LABEL: Record<ChangeStatus, string> = {
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  M: 'Modified',
  T: 'Type changed',
  U: 'Unmerged',
};

export class BuilderFileTreeItem extends vscode.TreeItem {
  constructor(
    public readonly builderId: string,
    public readonly worktreePath: string,
    public readonly baseRef: string,
    public readonly change: ChangeEntry,
    public readonly plan: ResourcePlan,
  ) {
    const rel = plan.resourcePath;
    super(path.basename(rel));

    const dir = path.dirname(rel);
    const dirLabel = dir === '.' ? '' : dir;
    this.description =
      change.status === 'R' && change.oldPath
        ? `${dirLabel ? dirLabel + '  ' : ''}↤ ${change.oldPath}`
        : dirLabel;

    // resourceUri → native file-type icon + the decoration-provider badge.
    this.resourceUri = vscode.Uri.file(path.join(worktreePath, rel));
    this.tooltip = `${STATUS_LABEL[change.status] ?? 'Changed'} · ${rel}`;
    this.contextValue = 'builder-file';
    this.command = {
      command: 'codev.openBuilderFileDiff',
      title: 'Open Diff',
      arguments: [this],
    };
  }
}
