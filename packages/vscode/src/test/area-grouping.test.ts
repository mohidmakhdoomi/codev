import * as assert from 'assert';
import { groupByArea, formatAreaForDisplay } from '@cluesmith/codev-core/area-grouping';

interface AreaItem {
	id: string;
	area: string;
}

const item = (id: string, area: string): AreaItem => ({ id, area });
const getArea = (i: AreaItem) => i.area;

suite('groupByArea', () => {
	test('empty in -> empty out', () => {
		assert.deepStrictEqual(groupByArea<AreaItem>([], getArea), []);
	});

	test('single Uncategorized item -> one Uncategorized group', () => {
		const out = groupByArea([item('1', 'Uncategorized')], getArea);
		assert.deepStrictEqual(out.map(g => g.area), ['Uncategorized']);
		assert.deepStrictEqual(out[0].items.map(i => i.id), ['1']);
	});

	test('alphabetical specifics then Uncategorized last', () => {
		const out = groupByArea([
			item('1', 'tower'),
			item('2', 'Uncategorized'),
			item('3', 'auth'),
			item('4', 'porch'),
		], getArea);
		assert.deepStrictEqual(
			out.map(g => g.area),
			['auth', 'porch', 'tower', 'Uncategorized'],
		);
	});

	test('omits empty area groups (no "<area> (0)" headers)', () => {
		// No items with area "vscode" -> no vscode header even though it's a
		// real area in the repo's label set.
		const out = groupByArea([
			item('1', 'auth'),
			item('2', 'tower'),
		], getArea);
		assert.deepStrictEqual(out.map(g => g.area), ['auth', 'tower']);
	});

	test('preserves input order within a group (no internal re-sort)', () => {
		const out = groupByArea([
			item('5', 'vscode'),
			item('2', 'vscode'),
			item('9', 'vscode'),
			item('1', 'vscode'),
		], getArea);
		assert.deepStrictEqual(out.map(g => g.area), ['vscode']);
		assert.deepStrictEqual(out[0].items.map(i => i.id), ['5', '2', '9', '1']);
	});

	test('groups multiple items per area correctly', () => {
		const out = groupByArea([
			item('1', 'vscode'),
			item('2', 'tower'),
			item('3', 'vscode'),
			item('4', 'tower'),
			item('5', 'vscode'),
		], getArea);
		assert.deepStrictEqual(out.map(g => g.area), ['tower', 'vscode']);
		assert.deepStrictEqual(out[0].items.map(i => i.id), ['2', '4']);
		assert.deepStrictEqual(out[1].items.map(i => i.id), ['1', '3', '5']);
	});

	test('works with arbitrary item shapes via getArea selector', () => {
		// Demonstrates the generic — items don't have to expose `.area`.
		const builders = [
			{ id: 'a', meta: { resolved: 'tower' } },
			{ id: 'b', meta: { resolved: 'vscode' } },
			{ id: 'c', meta: { resolved: 'tower' } },
		];
		const out = groupByArea(builders, b => b.meta.resolved);
		assert.deepStrictEqual(out.map(g => g.area), ['tower', 'vscode']);
		assert.deepStrictEqual(out[0].items.map(b => b.id), ['a', 'c']);
		assert.deepStrictEqual(out[1].items.map(b => b.id), ['b']);
	});
});

suite('formatAreaForDisplay', () => {
	test('lowercase single word -> capitalized first char', () => {
		assert.strictEqual(formatAreaForDisplay('vscode'), 'Vscode');
		assert.strictEqual(formatAreaForDisplay('tower'), 'Tower');
		assert.strictEqual(formatAreaForDisplay('porch'), 'Porch');
	});

	test('hyphenated -> separator replaced with space, each word capitalized', () => {
		assert.strictEqual(formatAreaForDisplay('cross-cutting'), 'Cross Cutting');
	});

	test('underscored -> separator replaced with space, each word capitalized', () => {
		assert.strictEqual(formatAreaForDisplay('front_end'), 'Front End');
	});

	test('mixed separators and >2 words', () => {
		assert.strictEqual(formatAreaForDisplay('front-end_ui'), 'Front End Ui');
	});

	test('Uncategorized sentinel is a no-op (single word, first char already upper)', () => {
		assert.strictEqual(formatAreaForDisplay('Uncategorized'), 'Uncategorized');
	});

	test('empty string -> empty string (defensive)', () => {
		assert.strictEqual(formatAreaForDisplay(''), '');
	});

	test('collapses multiple consecutive separators', () => {
		// Pathological but cheap to lock — no accidental double-spacing.
		assert.strictEqual(formatAreaForDisplay('a--b'), 'A B');
		assert.strictEqual(formatAreaForDisplay('a__b'), 'A B');
	});
});
