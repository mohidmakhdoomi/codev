/**
 * Unit tests for the pure diff/ref helpers behind the "Forward to Builder"
 * CodeLens actions (#789). No `vscode` dependency, so the live implementation
 * is imported directly (same pattern as `architect-reference-injection.test.ts`).
 */

import { describe, it, expect } from 'vitest';
import {
  parseHunkRanges,
  parseUnifiedDiff,
  buildBuilderFileRef,
  buildBuilderHunkRef,
  buildLensDescriptors,
} from '../diff-inject-ref.js';

describe('parseHunkRanges', () => {
  it('reads the header span and the first/last actually-changed new-side lines', () => {
    const patch = [
      '@@ -1,4 +1,6 @@',
      ' a',     // new line 1 (context)
      '+b',     // new line 2 (added) ← first/last change
      ' c',     // new line 3 (context)
      '@@ -20,3 +22,10 @@ func()',
      ' x',     // new line 22 (context)
      ' y',     // new line 23 (context)
      '+z1',    // new line 24 (added) ← first change
      '+z2',    // new line 25 (added) ← last change
      ' w',     // new line 26 (context)
    ].join('\n');
    expect(parseHunkRanges(patch)).toEqual([
      { newStart: 1, newEnd: 6, changeStart: 2, changeEnd: 2 },
      { newStart: 22, newEnd: 31, changeStart: 24, changeEnd: 25 },
    ]);
  });

  it('does not let deleted (-) lines advance the new-side line counter', () => {
    const patch = [
      '@@ -10,4 +10,3 @@',
      ' ctx',   // new line 10
      '-gone1',  // old-side only
      '-gone2',  // old-side only
      '+added',  // new line 11 ← the change
      ' tail',   // new line 12
    ].join('\n');
    expect(parseHunkRanges(patch)).toEqual([
      { newStart: 10, newEnd: 12, changeStart: 11, changeEnd: 11 },
    ]);
  });

  it('treats an absent new-side length as a single line', () => {
    expect(parseHunkRanges('@@ -10 +11 @@\n+added')).toEqual([
      { newStart: 11, newEnd: 11, changeStart: 11, changeEnd: 11 },
    ]);
  });

  it('falls back to the header start for a pure-deletion hunk (no + lines)', () => {
    expect(parseHunkRanges('@@ -5,3 +4,0 @@\n-gone')).toEqual([
      { newStart: 4, newEnd: 4, changeStart: 4, changeEnd: 4 },
    ]);
  });

  it('ignores the "\\ No newline at end of file" marker', () => {
    const patch = ['@@ -1,1 +1,2 @@', ' a', '+b', '\\ No newline at end of file'].join('\n');
    expect(parseHunkRanges(patch)).toEqual([
      { newStart: 1, newEnd: 2, changeStart: 2, changeEnd: 2 },
    ]);
  });

  it('ignores non-hunk lines, including content that looks like @@', () => {
    const patch = ['+const x = "@@ not a header";', '@@ -1,1 +1,2 @@', '+real'].join('\n');
    expect(parseHunkRanges(patch)).toEqual([
      { newStart: 1, newEnd: 2, changeStart: 1, changeEnd: 1 },
    ]);
  });
});

describe('parseUnifiedDiff', () => {
  it('maps each file new-path to its hunk ranges', () => {
    const patch = [
      'diff --git a/src/a.ts b/src/a.ts',
      'index 111..222 100644',
      '--- a/src/a.ts',
      '+++ b/src/a.ts',
      '@@ -1,2 +1,3 @@',
      ' x',
      '+y',
      'diff --git a/src/b.ts b/src/b.ts',
      'index 333..444 100644',
      '--- a/src/b.ts',
      '+++ b/src/b.ts',
      '@@ -10,0 +11,2 @@',
      '+p',
      '+q',
    ].join('\n');
    const map = parseUnifiedDiff(patch);
    expect(map.get('src/a.ts')).toEqual([
      { newStart: 1, newEnd: 3, changeStart: 2, changeEnd: 2 },
    ]);
    expect(map.get('src/b.ts')).toEqual([
      { newStart: 11, newEnd: 12, changeStart: 11, changeEnd: 12 },
    ]);
  });

  it('uses the new path for a rename (+++ b/<new>)', () => {
    const patch = [
      'diff --git a/old/name.ts b/new/name.ts',
      'similarity index 90%',
      'rename from old/name.ts',
      'rename to new/name.ts',
      '--- a/old/name.ts',
      '+++ b/new/name.ts',
      '@@ -3,1 +3,2 @@',
      '+added',
    ].join('\n');
    const map = parseUnifiedDiff(patch);
    expect([...map.keys()]).toEqual(['new/name.ts']);
    expect(map.get('new/name.ts')).toEqual([
      { newStart: 3, newEnd: 4, changeStart: 3, changeEnd: 3 },
    ]);
  });

  it('omits deleted files (new side is /dev/null)', () => {
    const patch = [
      'diff --git a/gone.ts b/gone.ts',
      'deleted file mode 100644',
      '--- a/gone.ts',
      '+++ /dev/null',
      '@@ -1,3 +0,0 @@',
      '-x',
    ].join('\n');
    expect(parseUnifiedDiff(patch).size).toBe(0);
  });
});

describe('ref builders', () => {
  it('builds a file ref with a trailing space and no newline', () => {
    expect(buildBuilderFileRef('packages/vscode/src/extension.ts'))
      .toBe('packages/vscode/src/extension.ts ');
  });

  it('builds a hunk ref with the L<start>-L<end> range', () => {
    expect(buildBuilderHunkRef('a/b.ts', 10, 20)).toBe('a/b.ts:L10-L20 ');
  });
});

describe('buildLensDescriptors', () => {
  it('emits a file-level lens at line 0 plus one lens per hunk, anchored on the change', () => {
    const lenses = buildLensDescriptors('a/b.ts', [
      { newStart: 2, newEnd: 12, changeStart: 5, changeEnd: 9 },
      { newStart: 28, newEnd: 32, changeStart: 30, changeEnd: 30 },
    ]);
    expect(lenses).toEqual([
      { line: 0, title: 'Forward to Builder', refText: 'a/b.ts ' },
      { line: 4, title: 'Forward to Builder (lines 5-9)', refText: 'a/b.ts:L5-L9 ' },
      { line: 29, title: 'Forward to Builder (lines 30-30)', refText: 'a/b.ts:L30-L30 ' },
    ]);
  });

  it('clamps a hunk anchored at line 1 to a non-negative index', () => {
    const lenses = buildLensDescriptors('a/b.ts', [
      { newStart: 1, newEnd: 1, changeStart: 1, changeEnd: 1 },
    ]);
    expect(lenses[1]!.line).toBe(0);
  });

  it('emits just the file-level lens when there are no hunks', () => {
    expect(buildLensDescriptors('a/b.ts', [])).toEqual([
      { line: 0, title: 'Forward to Builder', refText: 'a/b.ts ' },
    ]);
  });
});
