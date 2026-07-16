import * as vscode from 'vscode';
import type { OverviewCache } from '../views/overview-data.js';

/**
 * Codev: Add Review Comment — inserts a REVIEW comment at the cursor
 * using the correct comment syntax for the file type.
 */
export async function addReviewComment(overviewCache: OverviewCache): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage('Codev: No active editor');
    return;
  }

  const syntax = getCommentSyntax(editor.document.languageId);
  if (!syntax) {
    vscode.window.showWarningMessage(`Codev: Cannot add review comment to ${editor.document.languageId} files`);
    return;
  }

  const line = editor.selection.active.line;
  const indent = editor.document.lineAt(line).text.match(/^\s*/)?.[0] ?? '';
  // Author = current GitHub login (from Tower's overview cache); same source
  // as the inline gutter-comment path in comments/plan-review.ts. Falls back
  // to "architect" before Tower's first fetch / when gh is unconfigured.
  const author = overviewCache.getData()?.currentUser ?? 'architect';
  const comment = syntax.wrap(`REVIEW(@${author}): `);

  await editor.edit(editBuilder => {
    editBuilder.insert(new vscode.Position(line + 1, 0), `${indent}${comment}\n`);
  });

  // Move cursor into the comment
  const newPos = new vscode.Position(line + 1, indent.length + comment.length - syntax.cursorOffset);
  editor.selection = new vscode.Selection(newPos, newPos);
}

interface CommentSyntax {
  wrap: (text: string) => string;
  cursorOffset: number;
}

function getCommentSyntax(languageId: string): CommentSyntax | null {
  switch (languageId) {
    case 'javascript':
    case 'typescript':
    case 'javascriptreact':
    case 'typescriptreact':
    case 'go':
    case 'rust':
    case 'java':
    case 'swift':
    case 'kotlin':
    case 'c':
    case 'cpp':
    case 'csharp':
    case 'dart':
    case 'scala':
      return { wrap: (t) => `// ${t}`, cursorOffset: 0 };

    case 'python':
    case 'ruby':
    case 'shellscript':
    case 'bash':
    case 'yaml':
    case 'toml':
    case 'perl':
      return { wrap: (t) => `# ${t}`, cursorOffset: 0 };

    case 'html':
    case 'markdown':
    case 'xml':
      return { wrap: (t) => `<!-- ${t} -->`, cursorOffset: 4 };

    case 'css':
    case 'scss':
    case 'less':
      return { wrap: (t) => `/* ${t} */`, cursorOffset: 3 };

    default:
      return null;
  }
}
