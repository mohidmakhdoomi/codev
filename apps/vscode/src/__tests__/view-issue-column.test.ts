/**
 * #1074 — issue-preview editor-group placement.
 *
 * `pickIssuePreviewColumn` is the count-then-pick decision that aligns the
 * issue preview with the builder-terminal pattern (#804): group 2 when a second
 * editor group exists, group 1 otherwise. These tests pin that logic with the
 * `tabGroups.all.length` input mocked to 1 or 2 (per the acceptance criterion).
 *
 * The end-to-end placement (built-in preview opened via `vscode.openWith` with
 * `{ viewColumn, preserveFocus: true }`) is exercised manually — the helper is
 * the only branch worth a unit test.
 *
 * `view-issue.ts` imports `vscode` and constructs an `IssueContentProvider`
 * (which `new`s an `EventEmitter`) at module load; the minimal mock below just
 * lets that import chain resolve and supplies the `ViewColumn` enum values the
 * helper returns.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (): { dispose(): void } => ({ dispose() {} });
    fire(): void {}
    dispose(): void {}
  },
  // Mirror VS Code's enum: ViewColumn.One === 1, ViewColumn.Two === 2.
  ViewColumn: { One: 1, Two: 2 },
  Uri: { parse: (s: string): { toString(): string } => ({ toString: () => s }) },
}));

const { pickIssuePreviewColumn } = await import('../commands/view-issue.js');

describe('pickIssuePreviewColumn', () => {
  it('targets group 2 when a second editor group already exists', () => {
    expect(pickIssuePreviewColumn(2)).toBe(2); // ViewColumn.Two
  });

  it('targets group 2 for any layout with two or more groups', () => {
    expect(pickIssuePreviewColumn(3)).toBe(2);
    expect(pickIssuePreviewColumn(5)).toBe(2);
  });

  it('falls back to group 1 when only one editor group exists', () => {
    expect(pickIssuePreviewColumn(1)).toBe(1); // ViewColumn.One
  });

  it('falls back to group 1 for the zero-group edge (no editors open)', () => {
    // tabGroups.all is never empty in practice, but the helper must not pick
    // ViewColumn.Two and force a new group when there is nothing to sit beside.
    expect(pickIssuePreviewColumn(0)).toBe(1);
  });
});
