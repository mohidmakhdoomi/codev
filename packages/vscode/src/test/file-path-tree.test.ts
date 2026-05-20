import * as assert from 'assert';
import { buildFilePathTree, type FilePathNode } from '../views/file-path-tree.js';
import type { BuilderFileChange } from '../views/builder-diff-cache.js';
import type { ChangeStatus } from '../commands/view-diff.js';

/**
 * Tests for the path-tree builder + single-child folder compaction
 * (mirroring VSCode SCM behaviour).
 *
 * Fixtures fake the BuilderFileChange shape just enough for tree
 * grouping — only `plan.resourcePath` and `change.status` matter here;
 * the tree builder doesn't inspect anything else.
 */

function f(resourcePath: string, status: ChangeStatus = 'M'): BuilderFileChange {
	return {
		change: { status, path: resourcePath },
		plan: { resourcePath } as BuilderFileChange['plan'],
	} as BuilderFileChange;
}

/** Flatten a tree to `[name@fullPath, …]` for compact assertions. */
function flatten(nodes: FilePathNode[]): string[] {
	const out: string[] = [];
	const visit = (n: FilePathNode, indent: string) => {
		out.push(`${indent}${n.children ? '📁 ' : '📄 '}${n.name}@${n.fullPath}`);
		if (n.children) {
			for (const c of n.children) { visit(c, indent + '  '); }
		}
	};
	for (const n of nodes) { visit(n, ''); }
	return out;
}

suite('buildFilePathTree', () => {
	test('empty input → empty output', () => {
		assert.deepStrictEqual(buildFilePathTree([]), []);
	});

	test('flat-only files (no folders) → that many top-level leaves', () => {
		const out = buildFilePathTree([f('a.ts'), f('b.ts'), f('README.md')]);
		// All leaves, no children, sorted alphabetically (case-insensitive).
		assert.deepStrictEqual(out.map(n => n.name), ['a.ts', 'b.ts', 'README.md']);
		assert.ok(out.every(n => !n.children && n.file));
	});

	test('single deep file is fully compacted into one folder node', () => {
		// a/b/c/d.ts → one folder "a/b/c" containing one leaf "d.ts"
		const out = buildFilePathTree([f('a/b/c/d.ts')]);
		assert.strictEqual(out.length, 1);
		const folder = out[0]!;
		assert.strictEqual(folder.name, 'a/b/c');
		assert.strictEqual(folder.fullPath, 'a/b/c');
		assert.ok(folder.children);
		assert.strictEqual(folder.children!.length, 1);
		assert.strictEqual(folder.children![0]!.name, 'd.ts');
		assert.strictEqual(folder.children![0]!.fullPath, 'a/b/c/d.ts');
		assert.ok(folder.children![0]!.file);
	});

	test('multiple files sharing a prefix → shared folder, file children inside', () => {
		const out = buildFilePathTree([
			f('packages/codev/src/x.ts'),
			f('packages/codev/src/y.ts'),
		]);
		assert.strictEqual(out.length, 1);
		assert.strictEqual(out[0]!.name, 'packages/codev/src');
		assert.deepStrictEqual(
			out[0]!.children!.map(c => c.name),
			['x.ts', 'y.ts'],
		);
	});

	test('diverging branches keep their own compacted prefixes', () => {
		// Two top-level packages with deep internals — each side compacts
		// independently, no cross-branch merging.
		const out = buildFilePathTree([
			f('packages/codev/src/a.ts'),
			f('packages/vscode/src/b.ts'),
		]);
		assert.strictEqual(out.length, 1);
		assert.strictEqual(out[0]!.name, 'packages');
		const pkgs = out[0]!.children!;
		assert.strictEqual(pkgs.length, 2);
		assert.deepStrictEqual(pkgs.map(p => p.name), ['codev/src', 'vscode/src']);
	});

	test('mixed files and folders at one level → folders sort before files', () => {
		const out = buildFilePathTree([
			f('z.ts'),                  // top-level file
			f('a/sub.ts'),              // folder "a"
			f('README.md'),             // top-level file
		]);
		// Order: folder ("a"), then files (README.md, z.ts) — sort within group.
		assert.deepStrictEqual(out.map(n => n.name), ['a', 'README.md', 'z.ts']);
	});

	test('renames carry through to the leaf untouched', () => {
		const renamed = f('new/path.ts', 'R');
		(renamed.change as { oldPath?: string }).oldPath = 'old/path.ts';
		const out = buildFilePathTree([renamed]);
		// Walk to the leaf.
		assert.strictEqual(out[0]!.name, 'new');
		const leaf = out[0]!.children![0]!;
		assert.strictEqual(leaf.name, 'path.ts');
		assert.strictEqual(leaf.file!.change.status, 'R');
		assert.strictEqual((leaf.file!.change as { oldPath?: string }).oldPath, 'old/path.ts');
	});

	test('folder containing exactly one *file* (not folder) child stays uncompacted', () => {
		// VSCode SCM compacts single-child *folder* chains, but a folder
		// whose lone child is a file stays as two rows — the file is the
		// meaningful leaf.
		const out = buildFilePathTree([f('docs/README.md')]);
		assert.strictEqual(out.length, 1);
		assert.strictEqual(out[0]!.name, 'docs');
		assert.strictEqual(out[0]!.children!.length, 1);
		assert.strictEqual(out[0]!.children![0]!.name, 'README.md');
	});

	test('alphabetical sort is case-insensitive', () => {
		const out = buildFilePathTree([f('Zoo.ts'), f('apple.ts'), f('Banana.ts')]);
		assert.deepStrictEqual(out.map(n => n.name), ['apple.ts', 'Banana.ts', 'Zoo.ts']);
	});

	test('full-tree shape for a realistic monorepo PR', () => {
		const out = buildFilePathTree([
			f('packages/codev/src/commands/consult/index.ts'),
			f('packages/codev/src/commands/consult/types.ts'),
			f('packages/vscode/src/views/builders.ts'),
			f('CHANGELOG.md'),
		]);
		const flat = flatten(out);
		assert.deepStrictEqual(flat, [
			'📁 packages@packages',
			'  📁 codev/src/commands/consult@packages/codev/src/commands/consult',
			'    📄 index.ts@packages/codev/src/commands/consult/index.ts',
			'    📄 types.ts@packages/codev/src/commands/consult/types.ts',
			'  📁 vscode/src/views@packages/vscode/src/views',
			'    📄 builders.ts@packages/vscode/src/views/builders.ts',
			'📄 CHANGELOG.md@CHANGELOG.md',
		]);
	});
});
