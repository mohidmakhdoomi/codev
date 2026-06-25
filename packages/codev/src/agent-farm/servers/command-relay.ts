/**
 * Command relay for Tower.
 *
 * Lets a CONTROLLER (an external control device or companion app) drive the
 * active editor PROVIDER (the VSCode extension today, the web dashboard later)
 * over Tower's EXISTING channels rather than a dedicated socket:
 *   - controller -> Tower: REST POST `/api/command`.
 *   - Tower -> provider: SSE `command` at /api/events (providers filter by type).
 *
 * The channel carries CANONICAL VERBS (`view-diff`, `forward-hunk`), not
 * provider-specific command ids, so one controller drives any provider; each
 * provider maps the verb to its own implementation. This module is a pure,
 * stateless relay: it reads NO project files and holds no per-controller state.
 *
 * NOTE: a single active provider is assumed today (the focused VSCode window
 * self-gates). Provider addressing/selection (VSCode vs dashboard) is a
 * deliberate later addition when a second provider type exists.
 */

import type * as http from 'node:http';
import type { CommandRequest } from '@cluesmith/codev-types';
import { parseJsonBody } from '../utils/server-utils.js';

// Wire names — the canonical contract lives in @cluesmith/codev-types
// (COMMAND_ROUTE / COMMAND_EVENT) and must match these. They are re-declared
// locally because codev runs UNBUNDLED from dist/ and codev-types is a
// compile-time-only (type) dependency with no runtime dist on the codev side, so
// a runtime value import from it would not resolve. This mirrors how
// terminal/ws-protocol.ts re-declares FRAME_CONTROL / FRAME_DATA.
export const COMMAND_ROUTE = '/api/command';
const COMMAND_EVENT = 'command';

export interface CommandRelayDeps {
  /** Fan an event out to all SSE clients (wraps broadcastNotification). */
  broadcast: (type: string, body: unknown) => void;
}

/** The slice of Tower's RouteContext this module needs (avoids a type import cycle). */
interface CommandRouteCtx {
  broadcastNotification: (n: { type: string; title: string; body: string }) => void;
}

let deps: CommandRelayDeps | null = null;
let inited = false;

/** Wire the module's dependencies. */
export function initCommandRelay(d: CommandRelayDeps): void {
  deps = d;
}

/** Tear down state (used by tests and shutdown). */
export function shutdownCommandRelay(): void {
  deps = null;
  inited = false;
}

/**
 * Single entry point for `/api/command`, delegated from tower-routes. Lazily
 * initializes from the RouteContext on first hit, then dispatches.
 */
export async function handleCommandRoute(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  ctx: CommandRouteCtx,
): Promise<void> {
  if (!inited) {
    inited = true;
    initCommandRelay({
      broadcast: (type, body) =>
        ctx.broadcastNotification({ type, title: type, body: JSON.stringify(body) }),
    });
  }
  if (req.method === 'POST' && url.pathname === COMMAND_ROUTE) return handleCommand(req, res);
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Unknown command route' }));
}

/**
 * POST /api/command — a controller asks the active provider to run a canonical
 * verb (`view-diff`, `forward-hunk`, ...). Tower fans it out as a `command` SSE
 * event; the provider maps the verb to its own implementation. Fire-and-forget:
 * the verb allowlist + execution live provider-side.
 *
 * Tower stays a dumb relay: it does not interpret `workspace`, just carries it
 * through so a provider can drop a command meant for a different workspace (a
 * single Tower may serve several). The field is optional and absent today.
 */
export async function handleCommand(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const d = requireDeps();
  let body: CommandRequest;
  try {
    body = (await parseJsonBody(req)) as unknown as CommandRequest;
  } catch {
    return sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
  }
  if (!body.verb || typeof body.verb !== 'string') {
    return sendJson(res, 400, { ok: false, error: 'Missing verb' });
  }
  const event: CommandRequest = { verb: body.verb, args: body.args ?? [] };
  if (typeof body.workspace === 'string') event.workspace = body.workspace;
  d.broadcast(COMMAND_EVENT, event);
  return sendJson(res, 200, { ok: true });
}

/** Access the wired deps, throwing a clear error if init was skipped. */
function requireDeps(): CommandRelayDeps {
  if (!deps) throw new Error('Command relay not initialized');
  return deps;
}

/** Write a JSON response with the given status code. */
function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
