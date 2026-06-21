/**
 * Wire contracts for Tower's command channel.
 *
 * Lets a CONTROLLER (an external control device or companion app) drive the
 * active editor PROVIDER (the VSCode extension today, the web dashboard later)
 * over Tower's existing SSE + REST transport:
 *  - controller -> Tower: REST POST `/api/command` (run a canonical verb).
 *  - Tower -> provider: SSE `command` (the verb to run).
 *
 * The channel carries CANONICAL VERBS (`view-diff`, `forward-hunk`, ...), not
 * provider-specific command ids, so one controller drives any provider; each
 * provider maps the verb to its own implementation. Pure wire shapes only.
 */

/**
 * Controller -> Tower (`/api/command`): run a canonical verb on the active
 * editor provider. The verb (e.g. `view-diff`, `forward-hunk`) is
 * provider-agnostic; the provider maps it to its own implementation. `args`
 * carries verb operands (typically the target builder id).
 */
export interface CommandRequest {
  verb: string;
  args?: unknown[];
}

/** Result of a relayed command (the `/api/command` response). */
export interface CommandResult {
  ok: boolean;
  error?: string;
}

// ----- Wire protocol names (single source for the route + event type) -----
// The route path and SSE event-type name ARE the contract: the controller,
// Tower, and the provider must agree on them. Defining them once here (rather
// than repeating string literals in each package) keeps the protocol in lockstep
// and gives compile-time references instead of stringly-typed coupling.

/** REST route a controller POSTs a command to. */
export const COMMAND_ROUTE = '/api/command';

/** SSE event-type name Tower fans a command out to providers as. */
export const COMMAND_EVENT = 'command';
