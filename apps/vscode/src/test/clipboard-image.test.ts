import * as assert from 'assert';
import { EventEmitter } from 'node:events';
import { readClipboardImage, type ClipboardDeps } from '../clipboard-image.js';

/**
 * Fake child process matching the shape clipboard-image's runCapture uses:
 * `.stdout`/`.stderr` emit 'data'; the child emits 'error' | 'close'.
 */
class FakeChild extends EventEmitter {
	stdout = new EventEmitter();
	stderr = new EventEmitter();
	kill(): void { /* no-op */ }
}

interface Scenario {
	stdout?: Buffer;
	stderr?: string;
	code?: number;
	enoent?: boolean;
}

interface SpawnCall { cmd: string; args: string[]; }

function makeDeps(
	platform: NodeJS.Platform,
	env: NodeJS.ProcessEnv,
	scenario: Scenario,
): { deps: ClipboardDeps; calls: SpawnCall[] } {
	const calls: SpawnCall[] = [];
	const spawn = ((cmd: string, args: string[]) => {
		calls.push({ cmd, args });
		const child = new FakeChild();
		setImmediate(() => {
			if (scenario.enoent) {
				child.emit('error', Object.assign(new Error(`spawn ${cmd} ENOENT`), { code: 'ENOENT' }));
				return;
			}
			if (scenario.stdout && scenario.stdout.length) { child.stdout.emit('data', scenario.stdout); }
			if (scenario.stderr) { child.stderr.emit('data', Buffer.from(scenario.stderr)); }
			child.emit('close', scenario.code ?? 0);
		});
		return child;
	}) as unknown as ClipboardDeps['spawn'];
	return { deps: { spawn, platform: () => platform, env }, calls };
}

suite('readClipboardImage', () => {
	test('unsupported platform → tool-missing', async () => {
		const { deps } = makeDeps('freebsd' as NodeJS.Platform, {}, {});
		const r = await readClipboardImage(deps);
		assert.strictEqual(r.kind, 'tool-missing');
	});

	test('linux X11 (no WAYLAND_DISPLAY) spawns xclip with clipboard target', async () => {
		const { deps, calls } = makeDeps('linux', {}, { stdout: Buffer.from('PNGDATA'), code: 0 });
		const r = await readClipboardImage(deps);
		assert.strictEqual(calls[0].cmd, 'xclip');
		assert.ok(calls[0].args.join(' ').includes('-selection clipboard -t image/png -o'));
		assert.strictEqual(r.kind, 'image');
		if (r.kind === 'image') {
			assert.strictEqual(r.mime, 'image/png');
			assert.strictEqual(r.bytes.toString(), 'PNGDATA');
		}
	});

	test('linux Wayland (WAYLAND_DISPLAY set) spawns wl-paste', async () => {
		const { deps, calls } = makeDeps('linux', { WAYLAND_DISPLAY: 'wayland-0' }, { stdout: Buffer.from('X'), code: 0 });
		await readClipboardImage(deps);
		assert.strictEqual(calls[0].cmd, 'wl-paste');
		assert.ok(calls[0].args.includes('image/png'));
	});

	test('linux ENOENT → tool-missing names the right tool per session', async () => {
		const x11 = makeDeps('linux', {}, { enoent: true });
		const rx = await readClipboardImage(x11.deps);
		assert.deepStrictEqual(rx, { kind: 'tool-missing', tool: 'xclip' });

		const way = makeDeps('linux', { WAYLAND_DISPLAY: ':0' }, { enoent: true });
		const rw = await readClipboardImage(way.deps);
		assert.deepStrictEqual(rw, { kind: 'tool-missing', tool: 'wl-clipboard' });
	});

	test('linux clean exit with empty stdout → no-image', async () => {
		const { deps } = makeDeps('linux', {}, { code: 0 });
		assert.deepStrictEqual(await readClipboardImage(deps), { kind: 'no-image' });
	});

	test('linux non-zero exit → no-image', async () => {
		const { deps } = makeDeps('linux', {}, { code: 1, stderr: 'target not available' });
		assert.deepStrictEqual(await readClipboardImage(deps), { kind: 'no-image' });
	});

	test('macOS osascript reports NO_IMAGE → no-image', async () => {
		const { deps, calls } = makeDeps('darwin', {}, { stdout: Buffer.from('NO_IMAGE\n'), code: 0 });
		assert.deepStrictEqual(await readClipboardImage(deps), { kind: 'no-image' });
		assert.strictEqual(calls[0].cmd, 'osascript');
	});

	test('macOS osascript OK but temp file unwritable → no-image (graceful)', async () => {
		// Fake osascript "succeeds" but no temp file was actually written.
		const { deps } = makeDeps('darwin', {}, { stdout: Buffer.from('OK\n'), code: 0 });
		assert.deepStrictEqual(await readClipboardImage(deps), { kind: 'no-image' });
	});

	test('windows PowerShell NO_IMAGE → no-image; spawns powershell.exe', async () => {
		const { deps, calls } = makeDeps('win32', {}, { stdout: Buffer.from('NO_IMAGE'), code: 0 });
		assert.deepStrictEqual(await readClipboardImage(deps), { kind: 'no-image' });
		assert.strictEqual(calls[0].cmd, 'powershell.exe');
	});
});
