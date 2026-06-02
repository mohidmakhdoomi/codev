/**
 * PIR #936: reconnect-loop behavior for CodevPseudoterminal.
 *
 * These tests drive the *real* adapter close-loop — they fire genuine `ws`
 * lifecycle events (`open`/`close`/`error`) at the real `connect()`-registered
 * handlers and advance real timers, asserting the production backoff →
 * give-up → recover sequence. The only mocks are the module boundaries the
 * adapter talks to (the `ws` transport, the `vscode` API, the EscapeBuffer
 * collaborator, the wire-frame constants) — not the logic under test.
 *
 * This is deliberately distinct from the closed PR #937, which tested helper
 * functions in isolation rather than the close-loop, and pulled in `sinon`
 * where Vitest's fake timers suffice.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Track EscapeBuffer instantiations so we can assert the scheduled reconnect
// resets stream state before re-opening (PR #937 finding 2 / #630).
const hoisted = vi.hoisted(() => ({ escapeBufferCount: 0 }));

vi.mock('vscode', () => {
  class FakeEventEmitter<T> {
    private listeners: Array<(e: T) => void> = [];
    readonly event = (listener: (e: T) => void): { dispose: () => void } => {
      this.listeners.push(listener);
      return { dispose: () => { this.listeners = this.listeners.filter((l) => l !== listener); } };
    };
    fire = (e: T): void => { this.listeners.forEach((l) => l(e)); };
    dispose = (): void => { this.listeners = []; };
  }
  return { EventEmitter: FakeEventEmitter };
});

vi.mock('ws', () => {
  class FakeWebSocket {
    static OPEN = 1;
    static instances: FakeWebSocket[] = [];
    readyState = 0;
    binaryType = '';
    closed = false;
    private handlers: Record<string, Array<(...args: unknown[]) => void>> = {};
    constructor(public url: string) { FakeWebSocket.instances.push(this); }
    on(event: string, cb: (...args: unknown[]) => void): this {
      (this.handlers[event] ||= []).push(cb);
      return this;
    }
    send(): void {}
    close(): void { this.closed = true; }
    /** Test helper: synchronously dispatch a lifecycle event to handlers. */
    emit(event: string, ...args: unknown[]): void {
      (this.handlers[event] || []).forEach((cb) => cb(...args));
    }
  }
  return { default: FakeWebSocket };
});

vi.mock('@cluesmith/codev-core/escape-buffer', () => ({
  EscapeBuffer: class {
    constructor() { hoisted.escapeBufferCount++; }
    write(data: string): string { return data; }
    flush(): string { return ''; }
  },
}));

vi.mock('@cluesmith/codev-types', () => ({ FRAME_CONTROL: 0x00, FRAME_DATA: 0x01 }));

// Imports AFTER mocks are registered.
const WebSocket = (await import('ws')).default as unknown as {
  instances: Array<{ closed: boolean; emit(e: string, ...a: unknown[]): void }>;
  OPEN: number;
};
const { CodevPseudoterminal, RECONNECT_LINK_TEXT } = await import('../terminal-adapter.js');

const fakeOutputChannel = () => ({
  name: 'test', append: () => {}, appendLine: () => {}, clear: () => {},
  show: () => {}, hide: () => {}, dispose: () => {}, replace: () => {},
});

/** Latest fake socket the adapter created. */
function currentSocket() {
  return WebSocket.instances[WebSocket.instances.length - 1];
}

function makeAdapter() {
  const writes: string[] = [];
  const pty = new (CodevPseudoterminal as unknown as new (
    url: string, authKey: string | null, ch: unknown,
  ) => {
    open(d: unknown): void;
    reconnect(): void;
    onDidWrite: (cb: (s: string) => void) => void;
  })('ws://localhost:4100/x', null, fakeOutputChannel());
  pty.onDidWrite((s: string) => { if (s) { writes.push(s); } });
  pty.open(undefined);
  return { pty, writes };
}

beforeEach(() => {
  vi.useFakeTimers();
  WebSocket.instances.length = 0;
  hoisted.escapeBufferCount = 0;
});

describe('PIR #936 — adapter-owned reconnect loop', () => {
  it('emits one backed-off notice per close, capping the delay at 30s', () => {
    const { writes } = makeAdapter();
    const expectedDelays = [1, 2, 4, 8, 16, 30];

    for (let attempt = 1; attempt <= expectedDelays.length; attempt++) {
      writes.length = 0;
      currentSocket().emit('close');
      // Exactly one notice fired for this close — not a per-event spam burst.
      expect(writes).toHaveLength(1);
      expect(writes[0]).toContain(`retrying in ${expectedDelays[attempt - 1]}s`);
      expect(writes[0]).toContain(`(attempt ${attempt}/6)`);
      // The scheduled retry opens a fresh socket after the backoff elapses.
      const before = WebSocket.instances.length;
      vi.advanceTimersByTime(expectedDelays[attempt - 1] * 1000);
      expect(WebSocket.instances.length).toBe(before + 1);
    }
  });

  it('gives up after the 6th failed attempt and stops scheduling retries', () => {
    const { writes } = makeAdapter();
    // Burn the 6-attempt budget.
    for (let i = 0; i < 6; i++) {
      currentSocket().emit('close');
      vi.advanceTimersByTime(30000);
    }
    writes.length = 0;
    const socketsBefore = WebSocket.instances.length;

    // The 7th close exhausts the budget → give-up state.
    currentSocket().emit('close');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(RECONNECT_LINK_TEXT);
    expect(writes[0]).toContain('\x1b[31m'); // red

    // No further reconnect is scheduled once given up.
    vi.advanceTimersByTime(60000);
    expect(WebSocket.instances.length).toBe(socketsBefore);
  });

  it('gives up immediately on a 4xx upgrade rejection (session unknown)', () => {
    const { writes } = makeAdapter();
    writes.length = 0;

    currentSocket().emit('error', new Error('Unexpected server response: 404'));
    // The matching abnormal close fires right after the error.
    currentSocket().emit('close');

    // One red give-up notice, no yellow "retrying" line, no scheduled retry.
    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain('no longer exists');
    expect(writes[0]).toContain(RECONNECT_LINK_TEXT);
    expect(writes.some((w) => w.includes('retrying'))).toBe(false);
    const sockets = WebSocket.instances.length;
    vi.advanceTimersByTime(60000);
    expect(WebSocket.instances.length).toBe(sockets);
  });

  it('keeps retrying on a 5xx / network error (transient)', () => {
    const { writes } = makeAdapter();
    writes.length = 0;
    currentSocket().emit('error', new Error('Unexpected server response: 502'));
    currentSocket().emit('close');
    // Transient → backoff, not give-up.
    expect(writes[0]).toContain('retrying in 1s');
  });

  it('ignores a stale socket\'s close after an intentional reconnect (identity guard)', () => {
    const { pty, writes } = makeAdapter();
    const stale = currentSocket();

    pty.reconnect();            // closes `stale`, opens a new active socket
    expect(stale.closed).toBe(true);
    writes.length = 0;

    stale.emit('close');        // the old socket's late close event
    // Must not schedule a stray retry against the healthy new connection.
    expect(writes).toHaveLength(0);
    vi.advanceTimersByTime(5000);
  });

  it('resets decoder + EscapeBuffer before the scheduled reconnect (no stale-byte leak)', () => {
    makeAdapter();
    const baseline = hoisted.escapeBufferCount; // constructed once at init
    currentSocket().emit('close');
    expect(hoisted.escapeBufferCount).toBe(baseline); // not yet — only on the timer
    vi.advanceTimersByTime(1000);
    expect(hoisted.escapeBufferCount).toBe(baseline + 1); // fresh buffer before connect()
  });

  it('resets the backoff chain after a successful reconnect', () => {
    const { writes } = makeAdapter();
    currentSocket().emit('close');           // attempt 1 → 1s
    vi.advanceTimersByTime(1000);            // opens a new socket
    currentSocket().emit('open');            // success — clears loop state
    writes.length = 0;

    currentSocket().emit('close');           // next failure starts fresh
    expect(writes[0]).toContain('retrying in 1s');
    expect(writes[0]).toContain('(attempt 1/6)');
  });

  it('clicking reconnect after give-up starts a fresh chain (reconnect resets state)', () => {
    const { pty, writes } = makeAdapter();
    for (let i = 0; i < 6; i++) { currentSocket().emit('close'); vi.advanceTimersByTime(30000); }
    currentSocket().emit('close'); // give up
    writes.length = 0;

    pty.reconnect();               // the #939 affordance calls this
    currentSocket().emit('close'); // now retries again from the base delay
    expect(writes[0]).toContain('retrying in 1s');
    expect(writes[0]).toContain('(attempt 1/6)');
  });
});
