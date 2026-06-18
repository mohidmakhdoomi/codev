/**
 * Codev Plan Review — inline comments on plan/spec files via VSCode's
 * Comments API.
 *
 * Hover any line in `codev/plans/*.md` or `codev/specs/*.md` → a "+" appears
 * in the gutter → click → comment input field opens inline → submit → the
 * comment is written into the file as `<!-- REVIEW(@<author>): <text> -->`
 * on the next line.
 *
 * The HTML-comment serialization re-uses the existing REVIEW convention
 * (codev/protocols/.../review.md, review-decorations.ts highlighting,
 * Codev: Add Review Comment palette command). Builders read REVIEW
 * markers when they re-read the plan and address them inline — no new
 * storage layer, no separate protocol surface to teach.
 *
 * Existing inline REVIEW comments in a file render as collapsed comment
 * threads when the file opens, so reviewers see prior notes as comment
 * UI rather than raw HTML.
 */

import * as vscode from 'vscode';
import {
  serializeReviewMarker,
  markerInsertionLine,
  isEligibleReviewPath,
} from '@cluesmith/codev-core/review-markers';
import type { OverviewCache } from '../views/overview-data.js';

/**
 * Matches the canonical inline form. Capture groups:
 *   [1] — author (the name inside @...)
 *   [2] — comment body text
 *
 * Tolerant of whitespace; mirrors the regex shape used elsewhere
 * (review-decorations.ts, snippets/review.json). The on-disk marker FORMAT and
 * the eligible-path rule now live in `@cluesmith/codev-core/review-markers` so
 * this editor path and the canvas host (#859) share one definition; this
 * thread-display pattern stays local because it anchors threads at the marker's
 * own position (the canvas instead anchors to the line above — same bytes,
 * different surface).
 */
const REVIEW_COMMENT_PATTERN = /<!--\s*REVIEW\s*\(@([^)]+)\)\s*:\s*([\s\S]*?)\s*-->/g;

const CONTROLLER_ID = 'codev-review';

/** Tracks threads we created per document URI so we can refresh on edit. */
const threadsByDoc = new Map<string, vscode.CommentThread[]>();

export function activateReviewComments(
  context: vscode.ExtensionContext,
  overviewCache: OverviewCache,
): void {
  const controller = vscode.comments.createCommentController(
    CONTROLLER_ID,
    'Codev Plan Review',
  );
  controller.options = {
    prompt: 'Add review comment',
    placeHolder: 'Type your review comment, then Submit',
  };
  context.subscriptions.push(controller);

  // Where the "+" appears. We accept any line in eligible files.
  controller.commentingRangeProvider = {
    provideCommentingRanges(document) {
      if (!isEligibleDocument(document)) { return []; }
      const lastLine = Math.max(0, document.lineCount - 1);
      return [new vscode.Range(0, 0, lastLine, 0)];
    },
  };

  function refreshDoc(document: vscode.TextDocument): void {
    if (!isEligibleDocument(document)) { return; }

    // Tear down stale threads so we re-create from the current text.
    const key = document.uri.toString();
    const existing = threadsByDoc.get(key) ?? [];
    for (const t of existing) { t.dispose(); }

    const text = document.getText();
    const fresh: vscode.CommentThread[] = [];
    let match: RegExpExecArray | null;
    REVIEW_COMMENT_PATTERN.lastIndex = 0;
    while ((match = REVIEW_COMMENT_PATTERN.exec(text)) !== null) {
      const startPos = document.positionAt(match.index);
      const thread = controller.createCommentThread(
        document.uri,
        new vscode.Range(startPos, startPos),
        [
          {
            body: new vscode.MarkdownString(match[2]),
            mode: vscode.CommentMode.Preview,
            author: { name: match[1] },
            // contextValue is matched in the comment-context menu's `when`
            // clause so the delete button only shows on inline-sourced
            // comments (not on new in-progress threads).
            contextValue: 'inline-review',
          },
        ],
      );
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      thread.canReply = false;
      thread.contextValue = 'inline-review';
      fresh.push(thread);
    }
    threadsByDoc.set(key, fresh);
  }

  // Render for already-open documents.
  for (const doc of vscode.workspace.textDocuments) { refreshDoc(doc); }

  // Refresh on open/change/close.
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(refreshDoc),
    vscode.workspace.onDidChangeTextDocument(e => refreshDoc(e.document)),
    vscode.workspace.onDidCloseTextDocument(doc => {
      const key = doc.uri.toString();
      const threads = threadsByDoc.get(key);
      if (threads) {
        for (const t of threads) { t.dispose(); }
        threadsByDoc.delete(key);
      }
    }),
  );

  // Command: submit a new review comment from an empty thread.
  context.subscriptions.push(
    // eslint-disable-next-line no-restricted-syntax -- intentionally unguarded: CLI-independent command (edits local review markers), so no regCli guard is wanted (#791)
    vscode.commands.registerCommand(
      'codev.submitReviewComment',
      async (reply: vscode.CommentReply) => {
        await submitReviewComment(reply, overviewCache);
      },
    ),
  );

  // Command: delete an inline review comment (removes the `<!-- REVIEW... -->`
  // line from the file).
  context.subscriptions.push(
    // eslint-disable-next-line no-restricted-syntax -- intentionally unguarded: CLI-independent command (edits local review markers), so no regCli guard is wanted (#791)
    vscode.commands.registerCommand(
      'codev.deleteReviewComment',
      async (thread: vscode.CommentThread) => {
        await deleteReviewCommentByThread(thread);
      },
    ),
  );
}

async function submitReviewComment(
  reply: vscode.CommentReply,
  overviewCache: OverviewCache,
): Promise<void> {
  const thread = reply.thread;
  if (!thread.range) { return; }
  const document = await vscode.workspace.openTextDocument(thread.uri);
  const line = thread.range.start.line;
  const indent = document.lineAt(line).text.match(/^\s*/)?.[0] ?? '';
  // Author = current GitHub login (from Tower's overview cache), falling back
  // to "architect" before Tower has done a first fetch or when `gh` is
  // unconfigured. Same handle used for "assigned to you" sorting in the
  // Backlog view, so REVIEW markers @mention a real GitHub user.
  const author = overviewCache.getData()?.currentUser ?? 'architect';
  // Format + line convention come from the shared core codec (whitespace
  // normalization and the "marker on the line after the anchor" rule live there).
  const commentLine = serializeReviewMarker(author, reply.text, indent);

  const edit = new vscode.WorkspaceEdit();
  edit.insert(
    thread.uri,
    new vscode.Position(markerInsertionLine(line), 0),
    commentLine + '\n',
  );
  await vscode.workspace.applyEdit(edit);
  await document.save();

  // The change event fires refreshDoc, which disposes the in-progress
  // thread (it's currently in threadsByDoc as a placeholder) and re-creates
  // the canonical thread from the new inline marker.
  thread.dispose();
}

async function deleteReviewCommentByThread(thread: vscode.CommentThread): Promise<void> {
  if (!thread.range) { return; }
  const document = await vscode.workspace.openTextDocument(thread.uri);
  const line = thread.range.start.line;
  if (line >= document.lineCount) { return; }

  // Re-confirm the line is a REVIEW marker (it could have been edited
  // out manually between the user clicking the menu and this handler).
  const lineText = document.lineAt(line).text;
  if (!/^\s*<!--\s*REVIEW\s*\(@[^)]+\)\s*:.*-->/.test(lineText)) { return; }

  const edit = new vscode.WorkspaceEdit();
  // Delete the whole line including its trailing newline.
  const end = line + 1 < document.lineCount
    ? new vscode.Position(line + 1, 0)
    : new vscode.Position(line, lineText.length);
  edit.delete(thread.uri, new vscode.Range(new vscode.Position(line, 0), end));
  await vscode.workspace.applyEdit(edit);
  await document.save();
}

function isEligibleDocument(doc: vscode.TextDocument): boolean {
  if (doc.languageId !== 'markdown') { return false; }
  return isEligibleReviewPath(doc.uri.fsPath);
}
