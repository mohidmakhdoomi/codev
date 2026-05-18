/**
 * Spec 755 — CI guardrail.
 *
 * Fails if any production source file uses the legacy singular accessor
 * `entry.architect` or `entry.architect =`. Spec 755 collapsed the singleton
 * into a name-keyed Map (`entry.architects`); a stray singular access would
 * silently miss a non-main architect's terminal, exactly the bug the spec set
 * out to fix. The test runs at build/test time and stops a future contributor
 * from accidentally re-introducing the assumption.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

const SRC_ROOT = resolve(__dirname, '../..');
const ALLOWED_EXTENSIONS = new Set(['.ts', '.tsx', '.js']);

/**
 * Files where references to a singular `architect` field are intentional and
 * not the Tower-side `WorkspaceTerminals.architect` we replaced. Entries are
 * matched by suffix to keep the list portable across worktrees.
 */
const ALLOWED_SUFFIXES: string[] = [
  // (none — Tower side is fully migrated. Comment kept to document intent.)
];

function listFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === '__tests__' || name === 'node_modules' || name.startsWith('.')) continue;
    const full = join(dir, name);
    const s = statSync(full);
    if (s.isDirectory()) {
      listFiles(full, out);
    } else if (ALLOWED_EXTENSIONS.has(full.slice(full.lastIndexOf('.')))) {
      out.push(full);
    }
  }
  return out;
}

describe('Spec 755 — guardrail: no singular `entry.architect`', () => {
  it('production code uses `entry.architects` (plural Map), never the legacy scalar', () => {
    const files = listFiles(SRC_ROOT);
    const offenders: Array<{ file: string; line: number; text: string }> = [];

    // Patterns that signal singleton access. We catch:
    //   - `entry.architect`        (read; not followed by 's')
    //   - `currentEntry.architect` (read; not followed by 's')
    //   - `freshEntry.architect`
    //   - `existingEntry.architect`
    //   - any `.architect = undefined` or `.architect = '…'` style writes
    // We deliberately allow `.architects` (plural) and `state.architect`
    // (the DashboardState scalar shim that v1 preserves).
    const READ_RE = /\b(?:entry|currentEntry|freshEntry|existingEntry)\.architect\b(?!s)/;
    const WRITE_RE = /\.architect\s*=\s*(?!=)/;

    for (const file of files) {
      if (ALLOWED_SUFFIXES.some(s => file.endsWith(s))) continue;
      const lines = readFileSync(file, 'utf8').split(/\r?\n/);
      for (let i = 0; i < lines.length; i++) {
        const text = lines[i];
        // Skip comments — singular `architect` appears legitimately in
        // explanatory commentary about the migration.
        if (/^\s*(\/\/|\*)/.test(text)) continue;
        if (READ_RE.test(text) || (WRITE_RE.test(text) && /entry|currentEntry|freshEntry|existingEntry/.test(text))) {
          offenders.push({ file: file.replace(SRC_ROOT, ''), line: i + 1, text: text.trim() });
        }
      }
    }

    if (offenders.length > 0) {
      const lines = offenders.map(o => `  ${o.file}:${o.line}: ${o.text}`).join('\n');
      throw new Error(
        `Spec 755 guardrail failed — singular \`entry.architect\` accessor found in production code:\n${lines}\n\n` +
          'Use \`entry.architects\` (Map<string, string>) instead. ' +
          'See codev/specs/755-multi-architect-support-per-ar.md.',
      );
    }
    expect(offenders).toEqual([]);
  });
});
