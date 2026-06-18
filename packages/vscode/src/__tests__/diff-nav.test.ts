/**
 * #1060 — cross-file diff navigation pure helpers.
 *
 * These cover the logic that the acceptance criteria pin down without needing a
 * live VS Code: navigation order matches the file list, the edges no-op (no
 * wrap), and two builders' lists resolve independently (multi-builder
 * isolation). The command glue (`navigateDiff`) is exercised manually at the
 * dev-approval gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { BuilderFileChange } from '../views/builder-diff-cache.js';

// `diff-nav.ts` imports `vscode` and pulls in `diff-inject-codelens`, which
// instantiates an `EventEmitter` at module load. The pure helpers under test
// touch none of it — this minimal mock just lets the import chain resolve.
vi.mock('vscode', () => ({
  EventEmitter: class {
    event = (): { dispose(): void } => ({ dispose() {} });
    fire(): void {}
    dispose(): void {}
  },
}));

const {
  orderedRelPaths,
  computeNavTarget,
  indexOfRelPath,
  recordDiffNavPosition,
  peekDiffNavPosition,
  resetDiffNavState,
} = await import('../commands/diff-nav.js');

/** Minimal `BuilderFileChange` — the helpers only read `plan.resourcePath`. */
function mk(relPath: string): BuilderFileChange {
  return {
    change: { status: 'M', oldPath: null, path: relPath },
    plan: { resourcePath: relPath, left: { kind: 'base', path: relPath }, right: { kind: 'file', path: relPath } },
  };
}

describe('orderedRelPaths', () => {
  it('returns rel-paths in the file-list (git --name-status) order, unchanged', () => {
    const files = [mk('src/z.ts'), mk('src/a.ts'), mk('README.md')];
    // Deliberately non-alphabetical: navigation order is the list order, NOT a sort.
    expect(orderedRelPaths(files)).toEqual(['src/z.ts', 'src/a.ts', 'README.md']);
  });

  it('is empty for an empty list', () => {
    expect(orderedRelPaths([])).toEqual([]);
  });
});

describe('computeNavTarget', () => {
  const count = 3;

  it('advances by one mid-list', () => {
    expect(computeNavTarget(0, count, 1)).toEqual({ index: 1, atEdge: false });
    expect(computeNavTarget(1, count, 1)).toEqual({ index: 2, atEdge: false });
  });

  it('retreats by one mid-list', () => {
    expect(computeNavTarget(2, count, -1)).toEqual({ index: 1, atEdge: false });
    expect(computeNavTarget(1, count, -1)).toEqual({ index: 0, atEdge: false });
  });

  it('no-ops at the last file going forward (no wrap)', () => {
    expect(computeNavTarget(2, count, 1)).toEqual({ index: 2, atEdge: true });
  });

  it('no-ops at the first file going backward (no wrap)', () => {
    expect(computeNavTarget(0, count, -1)).toEqual({ index: 0, atEdge: true });
  });

  it('treats a single-file list as both edges', () => {
    expect(computeNavTarget(0, 1, 1)).toEqual({ index: 0, atEdge: true });
    expect(computeNavTarget(0, 1, -1)).toEqual({ index: 0, atEdge: true });
  });
});

describe('indexOfRelPath', () => {
  const files = [mk('a.ts'), mk('b.ts'), mk('c.ts')];

  it('finds the index of a present file', () => {
    expect(indexOfRelPath(files, 'b.ts')).toBe(1);
  });

  it('returns -1 for an absent file', () => {
    expect(indexOfRelPath(files, 'zzz.ts')).toBe(-1);
  });

  it('returns -1 for an undefined rel-path', () => {
    expect(indexOfRelPath(files, undefined)).toBe(-1);
  });

  it('resolves a deleted file — deletions are in the list and navigable once anchored', () => {
    // Regression for the Codex review finding: a deleted file (status 'D') has no
    // `file:` doc, so it can't be resolved through the diff-inject registry — but
    // it IS in the changed-file list, so once the nav anchor points at it (seeded
    // on open), indexOfRelPath finds it and stepping works.
    const withDeleted: BuilderFileChange[] = [
      mk('keep.ts'),
      { change: { status: 'D', oldPath: null, path: 'gone.ts' },
        plan: { resourcePath: 'gone.ts', left: { kind: 'base', path: 'gone.ts' }, right: { kind: 'empty' } } },
      mk('next.ts'),
    ];
    expect(indexOfRelPath(withDeleted, 'gone.ts')).toBe(1);
    expect(computeNavTarget(1, withDeleted.length, 1)).toEqual({ index: 2, atEdge: false });
  });

  it('resolves two builders independently (multi-builder isolation)', () => {
    const builderA = [mk('a/one.ts'), mk('a/two.ts')];
    const builderB = [mk('b/alpha.ts'), mk('b/beta.ts'), mk('b/gamma.ts')];

    // A's file isn't in B's list and vice-versa; each list has its own indices.
    expect(indexOfRelPath(builderA, 'a/two.ts')).toBe(1);
    expect(indexOfRelPath(builderB, 'a/two.ts')).toBe(-1);
    expect(indexOfRelPath(builderB, 'b/gamma.ts')).toBe(2);
    expect(indexOfRelPath(builderA, 'b/gamma.ts')).toBe(-1);

    // Stepping in one list is unaffected by the other's length.
    expect(computeNavTarget(indexOfRelPath(builderA, 'a/two.ts'), builderA.length, 1)).toEqual({ index: 1, atEdge: true });
    expect(computeNavTarget(indexOfRelPath(builderB, 'b/beta.ts'), builderB.length, 1)).toEqual({ index: 2, atEdge: false });
  });
});

describe('nav position anchor (recordDiffNavPosition / peek / reset)', () => {
  beforeEach(() => resetDiffNavState());

  it('starts empty', () => {
    expect(peekDiffNavPosition()).toBeUndefined();
  });

  it('records and overwrites the anchor (seeded on every open, incl. deleted/binary)', () => {
    recordDiffNavPosition('b1', 'src/gone.ts'); // e.g. a deleted file opened from the sidebar
    expect(peekDiffNavPosition()).toEqual({ builderId: 'b1', relPath: 'src/gone.ts' });

    recordDiffNavPosition('b2', 'pkg/other.ts'); // a later open replaces it (latest wins)
    expect(peekDiffNavPosition()).toEqual({ builderId: 'b2', relPath: 'pkg/other.ts' });
  });

  it('reset clears the anchor', () => {
    recordDiffNavPosition('b1', 'a.ts');
    resetDiffNavState();
    expect(peekDiffNavPosition()).toBeUndefined();
  });
});
