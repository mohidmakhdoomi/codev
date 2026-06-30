/**
 * Codev: Open Issue by ID — open a specific issue's preview by typing its id,
 * without first having to find it in the backlog Quick Pick.
 *
 * Bound to `Cmd+K I` / `Ctrl+K I`. Prompts for an issue id, then delegates to
 * `codev.viewBacklogIssue` so the fetch path, preview placement, focus, reuse,
 * and not-found handling are all identical to a sidebar-row click (#1076) — no
 * duplicated forge fetch or render logic here. Because that path is a live forge
 * fetch (not the cached backlog set), this works for open AND closed/archived
 * issues, plus arbitrary ids not currently in the backlog.
 *
 * "ID" rather than "number": the term is forge-neutral (GitLab `iid`, Linear /
 * Jira identifiers are not bare numbers), matching the extension's existing
 * `issueId` vocabulary and Codev's forge-abstraction. The numeric validation in
 * `parseIssueId` is the GitHub-specific part; only it loosens if a non-numeric
 * forge is ever supported.
 */

import * as vscode from 'vscode';

/**
 * Normalize a typed issue id to its bare numeric string, or `undefined` if it
 * isn't a valid issue id. Accepts a single optional leading `#` and surrounding
 * whitespace (`" #1096 "` → `"1096"`); rejects empty, non-numeric, and
 * malformed input (`""`, `"abc"`, `"12a3"`, `"#"`, `"##12"`).
 *
 * Pure (no `vscode` dependency) so it is unit-testable in isolation and reusable
 * as the `showInputBox` validator.
 */
export function parseIssueId(input: string): string | undefined {
  const trimmed = input.trim();
  const withoutHash = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (withoutHash.length === 0) { return undefined; }
  if (!/^\d+$/.test(withoutHash)) { return undefined; }
  return withoutHash;
}

export async function openIssueById(): Promise<void> {
  const input = await vscode.window.showInputBox({
    title: 'Codev: Open Issue by ID',
    placeHolder: 'Issue ID, e.g. 1096 or #1096',
    prompt: 'Opens the issue preview — works for open, closed, or archived issues.',
    validateInput: (value) =>
      parseIssueId(value) === undefined
        ? 'Enter a numeric issue id (e.g. 1096 or #1096).'
        : undefined,
  });
  if (input === undefined) { return; }

  const issueId = parseIssueId(input);
  if (issueId === undefined) { return; }

  await vscode.commands.executeCommand('codev.viewBacklogIssue', issueId);
}
