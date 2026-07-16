import * as assert from 'assert';
import * as vscode from 'vscode';
import {
  BUILDER_FILE_SCHEME,
  BuilderFileTreeItem,
  builderFileResourceUri,
} from '../views/builder-file-tree-item.js';
import { BuilderDiffCache, type BuilderFileChange } from '../views/builder-diff-cache.js';
import { BuilderFileDecorationProvider } from '../views/builder-file-decoration.js';
import {
  planResources,
  type ChangeEntry,
  type ChangeStatus,
  type ResourcePlan,
} from '../commands/view-diff.js';

/**
 * Regression tests for #799: the changed-file rows under each builder in
 * the Builders view rendered with grey filenames because VSCode's built-in
 * Git FileDecorationProvider was also firing on these rows and winning the
 * color merge with `gitDecoration.ignoredResourceForeground`.
 *
 * The first shipped attempt (v3.1.4) only changed the URI *scheme*, on the
 * theory that Git gates on `scheme === 'file'`. It does not: Git's
 * decorators resolve a repository by *path* and `git check-ignore` the path,
 * scheme-agnostically — so a custom-scheme URI whose path was still the real
 * gitignored `.builders/<id>/…` path kept getting Git's grey decoration. The
 * real fix is a **synthetic path** that resolves into no open repository, so
 * `getRepository(uri)` returns undefined and Git never fires. These tests
 * assert that path-shape property, which the scheme-only tests missed.
 */

const WT = '/repo/.builders/0042';

function makeFileChange(path: string, status: ChangeStatus = 'M'): BuilderFileChange {
  const change: ChangeEntry = { status, oldPath: null, path };
  const [plan] = planResources([change], new Set<string>());
  return { change, plan: plan as ResourcePlan };
}

suite('builderFileResourceUri', () => {
  test('uses the custom scheme, not file:', () => {
    const uri = builderFileResourceUri(WT, 'src/a.ts');
    assert.notStrictEqual(uri.scheme, 'file');
    assert.strictEqual(uri.scheme, BUILDER_FILE_SCHEME);
  });

  test('path is synthetic — does NOT contain the worktree fs path (so Git cannot resolve a repo for it)', () => {
    // The crux of the fix. If the path were the real worktree path, the
    // built-in Git decorators would path-resolve it (main repo → gitignored,
    // or the worktree's own repo) and win the color merge with grey (#799).
    const uri = builderFileResourceUri(WT, 'src/a.ts');
    assert.ok(!uri.path.includes(WT), `path must not contain the worktree fs path; got ${uri.path}`);
    assert.strictEqual(uri.path, '/src/a.ts');
  });

  test('preserves the basename at the path tail (so the file-type icon resolves)', () => {
    const uri = builderFileResourceUri(WT, 'src/components/Foo.tsx');
    // IFileIconTheme keys off the basename — it must come through unchanged.
    assert.strictEqual(uri.path.split('/').pop(), 'Foo.tsx');
  });

  test('carries the worktree path in the query so it stays recoverable', () => {
    const uri = builderFileResourceUri(WT, 'src/a.ts');
    assert.strictEqual(new URLSearchParams(uri.query).get('wt'), WT);
  });

  test('is unique per builder for the same relative path (decoration cache keys by uri.toString())', () => {
    // Two builders can have the same changed file; without the worktree in
    // the query their URIs would collide in the global decoration map.
    const a = builderFileResourceUri('/repo/.builders/0042', 'src/a.ts');
    const b = builderFileResourceUri('/repo/.builders/0099', 'src/a.ts');
    assert.notStrictEqual(a.toString(), b.toString());
  });
});

suite('BuilderFileTreeItem (#799)', () => {
  test('resourceUri uses the custom scheme, not file:', () => {
    const item = new BuilderFileTreeItem(
      '0042',
      WT,
      'main',
      { status: 'M', oldPath: null, path: 'src/a.ts' },
      planResources([{ status: 'M', oldPath: null, path: 'src/a.ts' }], new Set<string>())[0]!,
    );
    assert.ok(item.resourceUri, 'resourceUri must be set');
    assert.strictEqual(item.resourceUri!.scheme, BUILDER_FILE_SCHEME);
    assert.notStrictEqual(item.resourceUri!.scheme, 'file');
  });
});

suite('BuilderDiffCache decorations (#799)', () => {
  test('decorationFor returns the status for a URI built via the same helper', () => {
    const cache = new BuilderDiffCache();
    try {
      // Internal accessor — exercises the path the real getDiff flow takes.
      const change = makeFileChange('src/a.ts', 'A');
      const result = { baseRef: 'main', files: [change] };
      (cache as unknown as { syncDecorations: (id: string, wt: string, r: typeof result) => void })
        .syncDecorations('0042', WT, result);

      const uri = builderFileResourceUri(WT, 'src/a.ts');
      assert.strictEqual(cache.decorationFor(uri), 'A');
    } finally {
      cache.dispose();
    }
  });

  test('decorationFor returns undefined for a plain file: URI of the same path', () => {
    // If a stray `file:` URI for the same path slipped into the tree,
    // we wouldn't decorate it — that's by design under the new scheme.
    const cache = new BuilderDiffCache();
    try {
      const change = makeFileChange('src/a.ts', 'M');
      (cache as unknown as { syncDecorations: (id: string, wt: string, r: { baseRef: string; files: BuilderFileChange[] }) => void })
        .syncDecorations('0042', WT, { baseRef: 'main', files: [change] });

      const fileUri = vscode.Uri.file(`${WT}/src/a.ts`);
      assert.strictEqual(cache.decorationFor(fileUri), undefined);
    } finally {
      cache.dispose();
    }
  });

  test('onDidChangeDecorations fires URIs with the custom scheme (so VSCode re-queries tree rows)', async () => {
    const cache = new BuilderDiffCache();
    try {
      const fired: vscode.Uri[] = [];
      const sub = cache.onDidChangeDecorations(uris => fired.push(...uris));
      try {
        const change = makeFileChange('src/a.ts', 'A');
        (cache as unknown as { syncDecorations: (id: string, wt: string, r: { baseRef: string; files: BuilderFileChange[] }) => void })
          .syncDecorations('0042', WT, { baseRef: 'main', files: [change] });

        assert.strictEqual(fired.length, 1, `expected 1 URI fired, got ${fired.length}`);
        assert.strictEqual(fired[0]!.scheme, BUILDER_FILE_SCHEME);
      } finally {
        sub.dispose();
      }
    } finally {
      cache.dispose();
    }
  });
});

suite('BuilderFileDecorationProvider (#799)', () => {
  test('returns a defined color + status badge per status (guards against a future color drop)', () => {
    const cache = new BuilderDiffCache();
    try {
      const statuses: ChangeStatus[] = ['A', 'M', 'D'];
      (cache as unknown as { syncDecorations: (id: string, wt: string, r: { baseRef: string; files: BuilderFileChange[] }) => void })
        .syncDecorations('0042', WT, { baseRef: 'main', files: statuses.map(s => makeFileChange(`src/${s}.ts`, s)) });

      const provider = new BuilderFileDecorationProvider(cache);
      for (const s of statuses) {
        const deco = provider.provideFileDecoration(builderFileResourceUri(WT, `src/${s}.ts`));
        assert.ok(deco, `expected a decoration for status ${s}`);
        assert.strictEqual(deco!.badge, s, `badge for ${s}`);
        // The bug was a missing/overridden *color*, not a missing badge — so
        // assert the color is present, the thing the scheme-only tests ignored.
        assert.ok(deco!.color, `expected a color for status ${s}`);
      }
    } finally {
      cache.dispose();
    }
  });

  test('returns undefined for an untracked URI', () => {
    const cache = new BuilderDiffCache();
    try {
      const provider = new BuilderFileDecorationProvider(cache);
      assert.strictEqual(provider.provideFileDecoration(builderFileResourceUri(WT, 'not/tracked.ts')), undefined);
    } finally {
      cache.dispose();
    }
  });
});
