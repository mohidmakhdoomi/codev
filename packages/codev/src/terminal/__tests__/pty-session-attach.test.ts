import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PtySession, type PtySessionConfig } from '../pty-session.js';
import type { IShellperClient } from '../shellper-client.js';

/**
 * Fix E (#1047): attachShellper must be idempotent — re-attaching a session to
 * a new shellper client must drop the listeners it installed on the previous
 * client, so a reconnect can't accumulate duplicate `data` listeners that each
 * re-run onPtyData for every PTY byte (the listener-leak the hardening targets).
 */

function makeFakeClient(): IShellperClient {
  const emitter = new EventEmitter() as unknown as IShellperClient & { _lastDataAt: number };
  // attachShellper reads client.lastDataAt and subscribes data/exit/close.
  Object.defineProperty(emitter, 'lastDataAt', { get: () => Date.now() });
  return emitter;
}

function makeSession(): PtySession {
  const config: PtySessionConfig = {
    id: 'sess-1',
    command: '',
    args: [],
    cols: 80,
    rows: 24,
    cwd: '/tmp',
    env: {},
    label: 'test',
    logDir: '/tmp',
    diskLogEnabled: false, // avoid touching the filesystem
  };
  return new PtySession(config);
}

describe('PtySession.attachShellper idempotency (#1047 Fix E)', () => {
  it('removes listeners from the previous client on re-attach', () => {
    const session = makeSession();
    const clientA = makeFakeClient();
    const clientB = makeFakeClient();

    session.attachShellper(clientA, Buffer.alloc(0), 1234);
    expect(clientA.listenerCount('data')).toBe(1);

    // Re-attach to a new client (a reconnect): A's listeners must be dropped.
    session.attachShellper(clientB, Buffer.alloc(0), 5678);
    expect(clientA.listenerCount('data')).toBe(0);
    expect(clientA.listenerCount('exit')).toBe(0);
    expect(clientA.listenerCount('close')).toBe(0);
    expect(clientB.listenerCount('data')).toBe(1);
  });

  it('a data frame on the detached client no longer reaches the ring buffer', () => {
    const session = makeSession();
    const clientA = makeFakeClient();
    const clientB = makeFakeClient();

    session.attachShellper(clientA, Buffer.alloc(0), 1234);
    session.attachShellper(clientB, Buffer.alloc(0), 5678);

    const seqBefore = session.ringBuffer.currentSeq;
    clientA.emit('data', Buffer.from('stale\n', 'utf-8')); // from the old client
    expect(session.ringBuffer.currentSeq).toBe(seqBefore); // ignored

    clientB.emit('data', Buffer.from('fresh\n', 'utf-8')); // from the live client
    expect(session.ringBuffer.currentSeq).toBe(seqBefore + 1);
  });

  it('does not drop listeners when re-attaching the same client instance', () => {
    const session = makeSession();
    const clientA = makeFakeClient();

    session.attachShellper(clientA, Buffer.alloc(0), 1234);
    session.attachShellper(clientA, Buffer.alloc(0), 1234); // same instance
    // Guard only fires for a *different* client, so this is a no-op re-subscribe
    // path; the session stays attached and functional.
    expect(clientA.listenerCount('data')).toBeGreaterThanOrEqual(1);
  });
});
