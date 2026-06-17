import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guards the public `--codev-canvas-*` token vocabulary shipped by `default-theme.css` (spec 945
 * D4 colors + the #1053 typography tier). The vocabulary is a public contract (spec 945 D4 — "do
 * not change shapes without a spec amendment"), so the snapshot makes any add/remove a reviewed
 * diff rather than a silent contract change.
 */

const cssPath = join(dirname(fileURLToPath(import.meta.url)), '../styles/default-theme.css');
const css = readFileSync(cssPath, 'utf8');

/** Extract `--codev-canvas-*` custom-property *declarations* (name: value;), not `var()` refs. */
function declaredTokens(source: string): Map<string, string> {
  const tokens = new Map<string, string>();
  const re = /(--codev-canvas-[a-z0-9-]+)\s*:\s*([^;]+);/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    tokens.set(match[1], match[2].trim().replace(/\s+/g, ' '));
  }
  return tokens;
}

describe('default-theme.css token vocabulary', () => {
  const tokens = declaredTokens(css);

  it('declares exactly the locked token list (snapshot)', () => {
    expect([...tokens.keys()].sort()).toMatchInlineSnapshot(`
      [
        "--codev-canvas-accent",
        "--codev-canvas-background",
        "--codev-canvas-border",
        "--codev-canvas-code-background",
        "--codev-canvas-code-font-family",
        "--codev-canvas-code-font-size",
        "--codev-canvas-comment-marker",
        "--codev-canvas-font-family",
        "--codev-canvas-font-size",
        "--codev-canvas-foreground",
        "--codev-canvas-h1-size",
        "--codev-canvas-h2-size",
        "--codev-canvas-h3-size",
        "--codev-canvas-h4-size",
        "--codev-canvas-h5-size",
        "--codev-canvas-h6-size",
        "--codev-canvas-line-height",
        "--codev-canvas-link",
        "--codev-canvas-muted",
        "--codev-canvas-paragraph-spacing",
        "--codev-canvas-prose-max-width",
      ]
    `);
  });

  it('ships a non-empty fallback for every token', () => {
    for (const [name, value] of tokens) {
      expect(value, `${name} should have a fallback value`).not.toBe('');
    }
  });

  it('includes each typography token with its github-baseline default', () => {
    expect(tokens.get('--codev-canvas-font-size')).toBe('16px');
    expect(tokens.get('--codev-canvas-line-height')).toBe('1.5');
    expect(tokens.get('--codev-canvas-paragraph-spacing')).toBe('16px');
    expect(tokens.get('--codev-canvas-prose-max-width')).toBe('none');
    expect(tokens.get('--codev-canvas-h1-size')).toBe('2em');
    expect(tokens.get('--codev-canvas-h6-size')).toBe('0.85em');
    expect(tokens.get('--codev-canvas-code-font-size')).toBe('0.85em');
  });
});
