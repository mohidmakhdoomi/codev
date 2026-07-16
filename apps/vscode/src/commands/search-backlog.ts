import * as vscode from 'vscode';
import type { OverviewCache } from '../views/overview-data.js';
import { orderForSearch, toQuickPickItems } from '../views/backlog-search.js';

/**
 * `codev.searchBacklog` — open a Quick Pick over the current backlog and, on
 * selection, open the chosen issue via the same `codev.viewBacklogIssue` flow
 * a single sidebar-row click uses (issue #918).
 *
 * Snapshots `overviewCache` at invoke time (a one-shot picker; live-updating
 * rows while the user types would be jittery and unlike `Cmd+P`). Search runs
 * over the full spawnable backlog — NOT the mine-only set — so a user can find
 * an issue they didn't author.
 */
export async function searchBacklog(overviewCache: OverviewCache): Promise<void> {
  const data = overviewCache.getData();
  const items = data ? orderForSearch(data) : [];
  if (items.length === 0) {
    vscode.window.showInformationMessage(
      'Codev: No backlog issues to search (not connected, or the backlog is empty).',
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    toQuickPickItems(items, Date.now()),
    {
      placeHolder: 'Search backlog by id, title, area, assignee...',
      matchOnDescription: true,
      matchOnDetail: true,
    },
  );
  if (!picked) { return; }

  await vscode.commands.executeCommand('codev.viewBacklogIssue', picked.issueId);
}
