import * as assert from 'assert';
import type { OverviewBacklogItem } from '@cluesmith/codev-types';
import { spawnableBacklog } from '../views/backlog.js';

function item(id: string, hasBuilder: boolean): OverviewBacklogItem {
	// Only the fields spawnableBacklog reads matter; cast the rest.
	return { id, title: `t${id}`, hasBuilder } as unknown as OverviewBacklogItem;
}

suite('spawnableBacklog', () => {
	test('drops items that already have an active builder', () => {
		const out = spawnableBacklog([
			item('1', false),
			item('2', true),
			item('3', false),
		]);
		assert.deepStrictEqual(out.map(i => i.id), ['1', '3']);
	});

	test('empty in -> empty out', () => {
		assert.deepStrictEqual(spawnableBacklog([]), []);
	});

	test('all have builders -> empty', () => {
		assert.deepStrictEqual(spawnableBacklog([item('1', true), item('2', true)]), []);
	});

	test('preserves input order of the kept items', () => {
		const out = spawnableBacklog([
			item('a', false),
			item('b', true),
			item('c', false),
			item('d', false),
		]);
		assert.deepStrictEqual(out.map(i => i.id), ['a', 'c', 'd']);
	});
});
