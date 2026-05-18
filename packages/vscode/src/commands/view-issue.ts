/**
 * Codev: View Issue — read the body + comments of a backlog issue inside
 * VSCode instead of opening a browser.
 *
 * Right-click a backlog row → "View Issue". Fetches via Tower's
 * forge-backed GET /api/issue (so it stays forge-agnostic and
 * tunnel-safe — the extension never shells out to `gh`), renders the
 * issue as markdown behind a read-only `codev-issue:` document, and
 * opens VSCode's built-in markdown preview.
 *
 * A TextDocumentContentProvider scheme is read-only by construction, so
 * there's no editable scratch buffer left behind (unlike opening an
 * untitled document).
 */

import * as vscode from 'vscode';
import type { IssueView } from '@cluesmith/codev-types';
import type { ConnectionManager } from '../connection-manager.js';

const SCHEME = 'codev-issue';

class IssueContentProvider implements vscode.TextDocumentContentProvider {
  private readonly contents = new Map<string, string>();

  /** Key is the issue id; value is the rendered markdown. */
  set(issueId: string, markdown: string): void {
    this.contents.set(issueId, markdown);
  }

  provideTextDocumentContent(uri: vscode.Uri): string {
    // URI form: codev-issue:<id>.md  → authority/path is `<id>.md`
    const issueId = uri.path.replace(/\.md$/, '');
    return this.contents.get(issueId) ?? `# Issue #${issueId}\n\n_Content unavailable._`;
  }
}

const provider = new IssueContentProvider();

export function activateIssueView(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(SCHEME, provider),
  );
}

function renderIssue(issueId: string, issue: IssueView): string {
  const lines: string[] = [
    `# #${issueId} ${issue.title}`,
    '',
    `**State:** ${issue.state}`,
    '',
    issue.body?.trim() ? issue.body : '_No description._',
  ];

  if (issue.comments.length > 0) {
    lines.push('', '---', '', `## Comments (${issue.comments.length})`, '');
    for (const c of issue.comments) {
      lines.push(`### @${c.author.login} — ${c.createdAt}`, '', c.body, '');
    }
  }

  return lines.join('\n');
}

export async function viewBacklogIssue(
  connectionManager: ConnectionManager,
  issueId: string | undefined,
): Promise<void> {
  if (!issueId) { return; }

  const client = connectionManager.getClient();
  const workspacePath = connectionManager.getWorkspacePath();
  if (!client || !workspacePath || connectionManager.getState() !== 'connected') {
    vscode.window.showErrorMessage('Codev: Not connected to Tower');
    return;
  }

  const issue = await client.getIssue(issueId, workspacePath);
  if (!issue) {
    vscode.window.showWarningMessage(
      `Codev: Could not load issue #${issueId} (forge unavailable?)`,
    );
    return;
  }

  provider.set(issueId, renderIssue(issueId, issue));
  const uri = vscode.Uri.parse(`${SCHEME}:${issueId}.md`);
  // Render as a read-only markdown preview in editor group 2 — the same
  // placement model as builder terminals (which target ViewColumn.Two).
  //
  // `markdown.showPreviewToSide` opens in ViewColumn.Beside, which is
  // RELATIVE to the active editor group, not an absolute column. Without
  // anchoring, the first click (sidebar focused → group 1 active) lands
  // in group 2, but a second click while that preview is focused makes
  // "Beside" resolve to group 3, then 4, … — a brand-new group per click.
  // Focusing group 1 first pins "Beside" to group 2 every time, so issue
  // previews consistently reuse a single group like the builder terminals.
  await vscode.commands.executeCommand('workbench.action.focusFirstEditorGroup');
  await vscode.commands.executeCommand('markdown.showPreviewToSide', uri);
}
