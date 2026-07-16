/**
 * Regression tests for #1122: the editor Comments-API write path must append a
 * new review marker BELOW any existing markers stacked on the annotated line
 * (newest-last), matching the preview composer. Previously it used
 * `markerInsertionLine` (prepend / newest-first), diverging from the composer.
 *
 * We drive `submitReviewComment` directly with a mocked `vscode` (the
 * established pattern from command-relay.test.ts) and inspect the position
 * handed to `WorkspaceEdit.insert`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('vscode', () => {
  class Position {
    constructor(public line: number, public character: number) {}
  }
  class WorkspaceEdit {
    inserts: Array<{ uri: unknown; position: Position; text: string }> = [];
    insert(uri: unknown, position: Position, text: string): void {
      this.inserts.push({ uri, position, text });
    }
  }
  return {
    Position,
    WorkspaceEdit,
    workspace: {
      openTextDocument: vi.fn(),
      applyEdit: vi.fn(async () => true),
    },
  };
});

const vscode = (await import('vscode')) as unknown as {
  workspace: {
    openTextDocument: ReturnType<typeof vi.fn>;
    applyEdit: ReturnType<typeof vi.fn>;
  };
};
const { submitReviewComment } = await import('../comments/plan-review.js');

/** A minimal TextDocument backed by a plain string. */
function makeDoc(text: string) {
  const lines = text.split('\n');
  return {
    uri: { toString: () => 'file:///codev/plans/1.md', fsPath: '/codev/plans/1.md' },
    getText: () => text,
    lineAt: (n: number) => ({ text: lines[n] ?? '' }),
    get lineCount() {
      return lines.length;
    },
    save: vi.fn(async () => true),
  };
}

/** A reply targeting `annotatedLine` (the block the "+" thread sits on). */
function makeReply(doc: ReturnType<typeof makeDoc>, annotatedLine: number, body: string) {
  return {
    thread: {
      uri: doc.uri,
      range: { start: { line: annotatedLine, character: 0 } },
      dispose: vi.fn(),
    },
    text: body,
  };
}

const overviewCache = { getData: () => ({ currentUser: 'alice' }) } as never;

/** The line index of the single insert applied during the last call. */
function insertedLine(): number {
  const edit = vscode.workspace.applyEdit.mock.calls[0][0] as {
    inserts: Array<{ position: { line: number }; text: string }>;
  };
  expect(edit.inserts).toHaveLength(1);
  return edit.inserts[0].position.line;
}

describe('submitReviewComment append behaviour (#1122)', () => {
  beforeEach(() => {
    vscode.workspace.openTextDocument.mockReset();
    vscode.workspace.applyEdit.mockClear();
  });

  it('appends below an existing run of two markers (newest-last), not at the top of the run', async () => {
    const text = [
      '## Heading', // line 0 — annotated block
      '<!-- REVIEW(@bob): first -->', // line 1
      '<!-- REVIEW(@carol): second -->', // line 2
      'body text', // line 3
    ].join('\n');
    const doc = makeDoc(text);
    vscode.workspace.openTextDocument.mockResolvedValue(doc);

    await submitReviewComment(makeReply(doc, 0, 'third') as never, overviewCache);

    // Past the two-marker run (line 3), NOT prepended at line 1.
    expect(insertedLine()).toBe(3);
  });

  it('writes the first comment at the insertion line (unchanged when no markers exist)', async () => {
    const text = ['## Heading', 'body text'].join('\n');
    const doc = makeDoc(text);
    vscode.workspace.openTextDocument.mockResolvedValue(doc);

    await submitReviewComment(makeReply(doc, 0, 'first') as never, overviewCache);

    // markerAppendLine === markerInsertionLine when there is no run to skip.
    expect(insertedLine()).toBe(1);
  });
});
