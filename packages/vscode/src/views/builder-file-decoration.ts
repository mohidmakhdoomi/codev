import * as vscode from 'vscode';
import type { ChangeStatus } from '../commands/view-diff.js';
import type { BuilderDiffCache } from './builder-diff-cache.js';

/**
 * SCM-style decorations for builder changed-file rows: a colored one-letter
 * status badge plus a label tint, exactly like VSCode's built-in Git
 * decorator (which can't see the gitignored `.builders/` worktrees, so we
 * provide our own). The native file-type icon is preserved because a
 * `FileDecoration` only adds a badge/color — it never replaces the icon.
 *
 * Status → letter / theme color follows the Git extension's convention so
 * the user's theme drives the exact colors.
 */

interface Deco { badge: string; color: string; label: string; }

const DECO: Record<ChangeStatus, Deco> = {
  A: { badge: 'A', color: 'gitDecoration.addedResourceForeground', label: 'Added' },
  M: { badge: 'M', color: 'gitDecoration.modifiedResourceForeground', label: 'Modified' },
  D: { badge: 'D', color: 'gitDecoration.deletedResourceForeground', label: 'Deleted' },
  R: { badge: 'R', color: 'gitDecoration.renamedResourceForeground', label: 'Renamed' },
  C: { badge: 'C', color: 'gitDecoration.renamedResourceForeground', label: 'Copied' },
  T: { badge: 'T', color: 'gitDecoration.modifiedResourceForeground', label: 'Type changed' },
  U: { badge: '!', color: 'gitDecoration.conflictingResourceForeground', label: 'Unmerged' },
};

export class BuilderFileDecorationProvider implements vscode.FileDecorationProvider {
  readonly onDidChangeFileDecorations: vscode.Event<vscode.Uri[]>;

  constructor(private readonly cache: BuilderDiffCache) {
    this.onDidChangeFileDecorations = cache.onDidChangeDecorations;
  }

  provideFileDecoration(uri: vscode.Uri): vscode.FileDecoration | undefined {
    const status = this.cache.decorationFor(uri);
    if (!status) { return undefined; }
    const d = DECO[status] ?? DECO.M;
    return {
      badge: d.badge,
      color: new vscode.ThemeColor(d.color),
      tooltip: d.label,
      // Don't tint the parent builder row / ancestor folders.
      propagate: false,
    };
  }
}
