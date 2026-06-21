/**
 * Tests for the Tower command relay.
 *
 * Scope: the command relay (canonical verbs broadcast to the active provider).
 * The module is stateless and reads NO project files.
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { Readable } from 'node:stream';
import type * as http from 'node:http';
import {
  initCommandRelay,
  shutdownCommandRelay,
  handleCommand,
  type CommandRelayDeps,
} from '../command-relay.js';

function fakeReq(body: unknown): http.IncomingMessage {
  return Readable.from([Buffer.from(JSON.stringify(body))]) as unknown as http.IncomingMessage;
}

function fakeRes(): { statusCode: number; body: string; res: http.ServerResponse } {
  const captured = { statusCode: 0, body: '', res: null as unknown as http.ServerResponse };
  captured.res = {
    writeHead(code: number) {
      captured.statusCode = code;
    },
    end(b?: string) {
      captured.body = b ?? '';
    },
  } as unknown as http.ServerResponse;
  return captured;
}

describe('command relay', () => {
  let broadcast: Mock<CommandRelayDeps['broadcast']>;

  beforeEach(() => {
    broadcast = vi.fn<CommandRelayDeps['broadcast']>();
    initCommandRelay({ broadcast });
  });

  afterEach(() => {
    shutdownCommandRelay();
    vi.restoreAllMocks();
  });

  it('broadcasts a canonical verb and rejects a verb-less command', async () => {
    const ok = fakeRes();
    await handleCommand(fakeReq({ verb: 'view-diff', args: ['0809'] }), ok.res);
    expect(JSON.parse(ok.body)).toEqual({ ok: true });
    expect(broadcast).toHaveBeenLastCalledWith('command', { verb: 'view-diff', args: ['0809'] });

    const bad = fakeRes();
    await handleCommand(fakeReq({}), bad.res);
    expect(bad.statusCode).toBe(400);
  });

  it('defaults args to an empty list when omitted', async () => {
    await handleCommand(fakeReq({ verb: 'refresh-overview' }), fakeRes().res);
    expect(broadcast).toHaveBeenLastCalledWith('command', { verb: 'refresh-overview', args: [] });
  });

  it('carries a workspace through to the broadcast when present', async () => {
    await handleCommand(fakeReq({ verb: 'view-diff', args: ['0809'], workspace: '/work/alpha' }), fakeRes().res);
    expect(broadcast).toHaveBeenLastCalledWith('command', { verb: 'view-diff', args: ['0809'], workspace: '/work/alpha' });
  });

  it('omits workspace from the broadcast when absent (no undefined field)', async () => {
    await handleCommand(fakeReq({ verb: 'view-diff', args: ['0809'] }), fakeRes().res);
    expect(broadcast).toHaveBeenLastCalledWith('command', { verb: 'view-diff', args: ['0809'] });
  });

  it('rejects a malformed JSON body with 400', async () => {
    const out = fakeRes();
    const badReq = Readable.from([Buffer.from('not json')]) as unknown as http.IncomingMessage;
    await handleCommand(badReq, out.res);
    expect(out.statusCode).toBe(400);
  });
});
