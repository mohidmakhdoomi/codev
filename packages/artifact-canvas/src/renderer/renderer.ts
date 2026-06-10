import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';

/**
 * Markdown renderer for Codev artifacts (spec D5 + D7).
 *
 * - `markdown-it` with `html: false` — raw inline/block HTML in the source is NOT passed
 *   through (D7, defense layer 1).
 * - A `data-line` core rule stamps the **0-based** source line (`token.map[0]`) onto block-level
 *   tokens (paragraphs, headings, list items, code blocks, blockquotes, tables) — the single
 *   source of truth the comment overlay uses to map a rendered block back to a source line (D5).
 * - The generated HTML is sanitized with **DOMPurify** before it is returned for the DOM (D7,
 *   defense layer 2) — this strips e.g. a markdown-generated `javascript:` link href that
 *   `html: false` does not catch. `data-*` attributes are preserved (DOMPurify default), so
 *   `data-line` survives.
 *
 * No host I/O here — the source string is supplied by the caller (a host `FileAdapter` in real
 * use). This module has zero filesystem / fetch / VSCode imports.
 */

const md: MarkdownIt = new MarkdownIt({ html: false, linkify: true });

/** Block tokens that carry a source map and should receive a `data-line` attribute. */
function isMappedBlock(tokenType: string): boolean {
  return tokenType.endsWith('_open') || tokenType === 'fence' || tokenType === 'code_block';
}

// Core rule: stamp data-line on mapped block tokens (0-based, from token.map[0]).
md.core.ruler.push('codev_data_line', (state) => {
  for (const token of state.tokens) {
    if (token.map && isMappedBlock(token.type)) {
      token.attrSet('data-line', String(token.map[0]));
    }
  }
  return true;
});

/** Render markdown to sanitized HTML carrying `data-line` attributes on block elements. */
export function renderMarkdown(source: string): string {
  const rawHtml = md.render(source);
  // DOMPurify keeps data-* attributes by default; html:false already blocked raw HTML, this
  // strips dangerous URLs/handlers that survive markdown rendering (e.g. javascript: hrefs).
  return DOMPurify.sanitize(rawHtml);
}
