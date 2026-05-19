/**
 * Codev: Paste Image into Terminal (#736).
 *
 * Bound to Cmd/Ctrl+V, scoped `when: codev.terminalFocused && terminalFocus`.
 * If the clipboard holds an image, upload it to Tower's /api/paste-image and
 * inject the returned path into the focused Codev PTY. For every other case
 * (no image, clipboard tool missing, read error, Tower down, non-Codev
 * terminal) we delegate to VSCode's built-in `workbench.action.terminal.paste`
 * so normal text paste — including bracketed-paste for multi-line input — is
 * preserved with zero regression by construction.
 */

import * as vscode from 'vscode';
import type { ConnectionManager } from '../connection-manager.js';
import type { TerminalManager } from '../terminal-manager.js';
import { readClipboardImage } from '../clipboard-image.js';

/** Defer to VSCode's own terminal paste (keeps bracketed-paste behaviour). */
function builtinPaste(): Thenable<unknown> {
  return vscode.commands.executeCommand('workbench.action.terminal.paste');
}

export async function pasteImage(
  connectionManager: ConnectionManager,
  terminalManager: TerminalManager,
): Promise<void> {
  const pty = terminalManager.getActiveManagedPty();
  if (!pty) {
    // The `when` clause should prevent this, but stay safe: never swallow paste.
    await builtinPaste();
    return;
  }

  const client = connectionManager.getClient();
  if (!client || connectionManager.getState() !== 'connected') {
    // Image upload needs Tower; text paste must still work with Tower down.
    await builtinPaste();
    return;
  }

  const result = await readClipboardImage();

  if (result.kind === 'no-image') {
    await builtinPaste();
    return;
  }
  if (result.kind === 'tool-missing') {
    await builtinPaste();
    vscode.window.showErrorMessage(
      `Codev: image paste needs ${result.tool} installed — pasted as text instead.`,
    );
    return;
  }
  if (result.kind === 'error') {
    await builtinPaste();
    vscode.window.showErrorMessage(
      `Codev: couldn't read clipboard image (${result.message}) — pasted as text instead.`,
    );
    return;
  }

  // result.kind === 'image' — an image was intended; do NOT fall back to text.
  const workspacePath = connectionManager.getWorkspacePath();
  if (!workspacePath) {
    pty.writeNotice('\r\n\x1b[31m[Image upload failed: no workspace]\x1b[0m\r\n');
    return;
  }
  pty.writeNotice('\r\n\x1b[90m[Uploading image...]\x1b[0m');
  const up = await client.pasteImage(workspacePath, result.bytes, result.mime);
  if (!up.ok || !up.path) {
    pty.writeNotice(
      `\r\x1b[2K\x1b[31m[Image upload failed${up.error ? `: ${up.error}` : ''}]\x1b[0m\r\n`,
    );
    return;
  }
  pty.writeNotice('\r\x1b[2K');
  pty.handleInput(up.path); // no newline — mirrors the dashboard's term.paste(path)
}
