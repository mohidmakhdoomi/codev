import * as assert from 'assert';
import {
  parseNameStatus,
  normalizeNumstatPath,
  parseBinaryPaths,
  planResources,
  encodeDiffQuery,
  decodeDiffQuery,
  type ChangeEntry,
} from '../commands/view-diff.js';

suite('view-diff parseNameStatus', () => {
  test('parses modified / added / deleted', () => {
    const out = parseNameStatus('M\tsrc/a.ts\nA\tsrc/b.ts\nD\tsrc/c.ts\n');
    assert.deepStrictEqual(out, [
      { status: 'M', oldPath: null, path: 'src/a.ts' },
      { status: 'A', oldPath: null, path: 'src/b.ts' },
      { status: 'D', oldPath: null, path: 'src/c.ts' },
    ]);
  });

  test('splits rename into old + new path', () => {
    const [r] = parseNameStatus('R096\told/name.ts\tnew/name.ts');
    assert.deepStrictEqual(r, { status: 'R', oldPath: 'old/name.ts', path: 'new/name.ts' });
  });

  test('splits copy into old + new path', () => {
    const [c] = parseNameStatus('C100\tsrc/orig.ts\tsrc/copy.ts');
    assert.deepStrictEqual(c, { status: 'C', oldPath: 'src/orig.ts', path: 'src/copy.ts' });
  });

  test('ignores blank lines and trailing CR', () => {
    const out = parseNameStatus('M\tsrc/a.ts\r\n\nA\tsrc/b.ts\n');
    assert.strictEqual(out.length, 2);
    assert.strictEqual(out[0].path, 'src/a.ts');
  });
});

suite('view-diff normalizeNumstatPath', () => {
  test('passes through a plain path', () => {
    assert.strictEqual(normalizeNumstatPath('src/a.ts'), 'src/a.ts');
  });

  test('resolves the braced rename form to the new path', () => {
    assert.strictEqual(normalizeNumstatPath('src/{old => new}/f.ts'), 'src/new/f.ts');
  });

  test('resolves the bare arrow rename form to the new path', () => {
    assert.strictEqual(normalizeNumstatPath('old/path.ts => new/path.ts'), 'new/path.ts');
  });
});

suite('view-diff parseBinaryPaths', () => {
  test('collects only the -\\t- (binary) rows', () => {
    const numstat = [
      '12\t3\tsrc/a.ts',
      '-\t-\tassets/logo.png',
      '0\t0\tsrc/empty.ts',
      '-\t-\tsrc/{old => new}/icon.ico',
    ].join('\n');
    const bin = parseBinaryPaths(numstat);
    assert.ok(bin.has('assets/logo.png'));
    assert.ok(bin.has('src/new/icon.ico'));
    assert.ok(!bin.has('src/a.ts'));
    assert.strictEqual(bin.size, 2);
  });
});

suite('view-diff planResources', () => {
  const empty = new Set<string>();

  test('modified → base ↔ file', () => {
    const c: ChangeEntry = { status: 'M', oldPath: null, path: 'src/a.ts' };
    const [p] = planResources([c], empty);
    assert.deepStrictEqual(p, {
      resourcePath: 'src/a.ts',
      left: { kind: 'base', path: 'src/a.ts' },
      right: { kind: 'file', path: 'src/a.ts' },
    });
  });

  test('added → empty ↔ file', () => {
    const [p] = planResources([{ status: 'A', oldPath: null, path: 'n.ts' }], empty);
    assert.deepStrictEqual(p.left, { kind: 'empty' });
    assert.deepStrictEqual(p.right, { kind: 'file', path: 'n.ts' });
  });

  test('deleted → base ↔ empty', () => {
    const [p] = planResources([{ status: 'D', oldPath: null, path: 'gone.ts' }], empty);
    assert.deepStrictEqual(p.left, { kind: 'base', path: 'gone.ts' });
    assert.deepStrictEqual(p.right, { kind: 'empty' });
  });

  test('renamed → old@base ↔ new file', () => {
    const [p] = planResources(
      [{ status: 'R', oldPath: 'old.ts', path: 'new.ts' }],
      empty,
    );
    assert.deepStrictEqual(p.left, { kind: 'base', path: 'old.ts' });
    assert.deepStrictEqual(p.right, { kind: 'file', path: 'new.ts' });
    assert.strictEqual(p.resourcePath, 'new.ts');
  });

  test('binary file → binary placeholder on both sides', () => {
    const [p] = planResources(
      [{ status: 'M', oldPath: null, path: 'logo.png' }],
      new Set(['logo.png']),
    );
    assert.deepStrictEqual(p.left, { kind: 'binary' });
    assert.deepStrictEqual(p.right, { kind: 'binary' });
  });

  test('renamed binary detected via old path', () => {
    const [p] = planResources(
      [{ status: 'R', oldPath: 'a.png', path: 'b.png' }],
      new Set(['a.png']),
    );
    assert.strictEqual(p.left.kind, 'binary');
    assert.strictEqual(p.right.kind, 'binary');
  });
});

suite('view-diff diff-query codec', () => {
  test('round-trips through encode/decode', () => {
    const q = { wt: '/repo/.builders/0042', ref: 'abc123', path: 'src/x.ts' };
    assert.deepStrictEqual(decodeDiffQuery(encodeDiffQuery(q)), q);
  });

  test('preserves the empty/binary sentinels', () => {
    assert.strictEqual(decodeDiffQuery(encodeDiffQuery({ wt: '', ref: '', path: 'p', empty: true })).empty, true);
    assert.strictEqual(decodeDiffQuery(encodeDiffQuery({ wt: '', ref: '', path: 'p', binary: true })).binary, true);
  });
});
