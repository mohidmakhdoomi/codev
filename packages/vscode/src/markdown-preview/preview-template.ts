/**
 * HTML document for the Codev Markdown Preview webview (#859).
 *
 * Extracted from `preview-provider.ts` so the markup isn't interleaved with the
 * host logic — mirrors the backlog-search webview's template split (#920). Pure
 * string-building: the provider resolves the webview-relative script/style URIs
 * and the CSP source; this builds the document with a fresh per-render nonce.
 */

export interface MarkdownPreviewHtmlOptions {
  /** `webview.cspSource` — the origin the webview may load styles/images/fonts from. */
  cspSource: string;
  /** `asWebviewUri(...)` for the bundled React app (`markdown-preview.js`), stringified. */
  scriptUri: string;
  /** `asWebviewUri(...)` for the bundled stylesheet (`markdown-preview.css`), stringified. */
  styleUri: string;
}

/** Build the full webview document with a fresh nonce bound into the CSP and the script tag. */
export function renderMarkdownPreviewHtml(opts: MarkdownPreviewHtmlOptions): string {
  const nonce = getNonce();
  const csp = [
    `default-src 'none'`,
    `img-src ${opts.cspSource} https: data:`,
    `font-src ${opts.cspSource}`,
    `style-src ${opts.cspSource} 'unsafe-inline'`,
    `script-src 'nonce-${nonce}'`,
  ].join('; ');
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link href="${opts.styleUri}" rel="stylesheet" />
  <style>
    html, body { background: var(--vscode-editor-background); margin: 0; padding: 0 14px; }
    /* Bind the canvas tokens to the active VS Code theme (package Model A). */
    .codev-artifact-canvas {
      --codev-canvas-foreground: var(--vscode-foreground);
      --codev-canvas-background: var(--vscode-editor-background);
      --codev-canvas-accent: var(--vscode-textLink-foreground);
      --codev-canvas-border: var(--vscode-panel-border);
      --codev-canvas-muted: var(--vscode-descriptionForeground);
      --codev-canvas-code-background: var(--vscode-textCodeBlock-background);
      --codev-canvas-link: var(--vscode-textLink-foreground);
      --codev-canvas-comment-marker: var(--vscode-editorWarning-foreground);
      color: var(--codev-canvas-foreground);
      background: var(--codev-canvas-background);
    }
  </style>
  <title>Codev Markdown Preview</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${opts.scriptUri}"></script>
</body>
</html>`;
}

/** CSP nonce — a fresh 32-char token per render (mirrors the backlog-search webview, #920). */
function getNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let text = '';
  for (let i = 0; i < 32; i++) {
    text += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return text;
}
