// Discover the most-recent Claude conversation session for a given working
// directory by inspecting Claude Code's on-disk session store.
//
// Claude Code automatically persists every interactive session to
//   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
// where the encoding replaces both '/' and '.' in the absolute path with '-'.
// We use the newest jsonl by mtime as a stand-in for "the last conversation
// that ran in this directory" so reviving a dead builder (or architect) can
// resume via `claude --resume <uuid>` without any spawn-time bookkeeping.
//
// This is intentionally a heuristic — multiple jsonl files in the same
// directory mean multiple past sessions, and we pick the most recent. For
// builder worktrees that almost always means the right one; for shared cwds
// the caller should be aware of the ambiguity.

import { existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const JSONL_EXT = '.jsonl';

/**
 * Encode an absolute path to the directory name Claude uses under
 * ~/.claude/projects/. The scheme is: replace every '/' and '.' with '-'.
 *
 * Example: '/Users/x/repos/foo/.builders/pir-1' → '-Users-x-repos-foo--builders-pir-1'
 */
export function encodeClaudeProjectDir(absolutePath: string): string {
  return absolutePath.replace(/[/.]/g, '-');
}

export function getClaudeProjectDir(absolutePath: string): string {
  return join(homedir(), '.claude', 'projects', encodeClaudeProjectDir(absolutePath));
}

/**
 * Return the session UUID of the most-recently-modified jsonl in the Claude
 * project dir for the given cwd, or null if none exists.
 *
 * `opts.homeDir` lets tests pin the home directory; otherwise resolves via
 * `os.homedir()`.
 */
export function findLatestSessionId(
  absolutePath: string,
  opts?: { homeDir?: string },
): string | null {
  const home = opts?.homeDir ?? homedir();
  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(absolutePath));
  if (!existsSync(dir)) return null;

  let bestName: string | null = null;
  let bestMtime = -Infinity;

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(JSONL_EXT)) continue;
    const fullPath = join(dir, entry.name);
    try {
      const mtime = statSync(fullPath).mtimeMs;
      if (mtime > bestMtime) {
        bestMtime = mtime;
        bestName = entry.name;
      }
    } catch {
      // stat failed (race with deletion, permissions) — skip
    }
  }

  if (!bestName) return null;
  return bestName.slice(0, -JSONL_EXT.length);
}

// ============================================================================
// Issue #832 — capture a running architect's live Claude session id
//
// Used by the transitional `scripts/backfill-architect-sessions.ts` backfill to
// record the session id of an architect that is already running under pre-#832
// code (its conversation exists on disk but Tower never stored the id). Going
// forward, ids are generated and stored at spawn, so this is a one-off bridge.
//
// Disambiguation is by COMMAND LINE, not by mtime or open file descriptors:
// Claude is launched with the session id as an explicit argument — `--session-id
// <uuid>` (spawned under #832) or `--resume <uuid>` (a prior revival) — so the id
// the conversation is using sits right on the running process's argv. Reading it
// back is exact and unambiguous even when named siblings share one cwd, where
// newest-by-mtime cannot tell their jsonls apart. (Claude does NOT hold the jsonl
// open, so process→open-file correlation finds nothing — the arg is the only
// reliable signal.) The id appears on the `claude` process itself (space-separated)
// and on its shellper parent (inside the JSON `args` blob), so we scan the whole
// process subtree. For a sole architect spawned BEFORE #832 — which carries no
// session-id arg — the cwd is unambiguous, so we fall back to findLatestSessionId.
// ============================================================================

/** Run a command, returning stdout (including any stdout produced before a
 *  non-zero exit, which `ps` emits when some pids match nothing). Never throws. */
function execCapture(cmd: string, args: string[]): string {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000 });
  } catch (err) {
    const out = (err as { stdout?: Buffer | string }).stdout;
    return out ? out.toString() : '';
  }
}

/** The given pid plus all of its transitive descendants, from one `ps` snapshot. */
function processSubtree(rootPid: number): number[] {
  const out = execCapture('ps', ['-axo', 'pid=,ppid=']);
  const childrenOf = new Map<number, number[]>();
  for (const line of out.split('\n')) {
    const m = line.trim().match(/^(\d+)\s+(\d+)$/);
    if (!m) continue;
    const pid = Number(m[1]);
    const ppid = Number(m[2]);
    const list = childrenOf.get(ppid);
    if (list) list.push(pid);
    else childrenOf.set(ppid, [pid]);
  }
  const result: number[] = [];
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop()!;
    result.push(p);
    for (const c of childrenOf.get(p) ?? []) stack.push(c);
  }
  return result;
}

/**
 * Pull a Claude session UUID out of a process command line.
 *
 * Matches the id that follows a `--session-id` or `--resume` flag, accepting both
 * the space-separated form on the `claude` process (`--resume <uuid>`) and the
 * JSON-encoded form on its shellper parent (`"--resume","<uuid>"`). The strict
 * UUID shape is what keeps prose in the injected role doc — which mentions the word
 * "resume" — from producing a false positive: a bare `--resume` with no UUID after
 * it does not match. Returns the lowercased UUID, or null.
 */
export function extractSessionIdFromCmdline(cmdline: string): string | null {
  const m = cmdline.match(
    /--(?:session-id|resume)["'\s,=]+([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
  );
  return m ? m[1].toLowerCase() : null;
}

/**
 * Capture the live Claude session id for a running architect.
 *
 * `pid` is the architect's recorded process (the shellper); the `claude` process is
 * a descendant. Claude is launched with its session id as an explicit argument
 * (`--session-id <uuid>` under #832, or `--resume <uuid>` after a revival), so we
 * read it straight off the command line of every process in the subtree — exact and
 * unambiguous even when siblings share one cwd. A sole architect spawned before #832
 * carries no such arg; for it the cwd's jsonl is unambiguous, so we fall back to the
 * newest-by-mtime id. Returns null when nothing can be resolved (e.g. a pre-#832
 * sibling, which self-heals on its first #832 revival).
 *
 * `opts.homeDir` lets tests pin the home directory.
 */
export function captureRunningClaudeSession(
  workspacePath: string,
  pid: number,
  opts: { soleArchitect: boolean; homeDir?: string },
): string | null {
  const pids = processSubtree(pid);
  if (pids.length > 0) {
    const out = execCapture('ps', ['-ww', '-o', 'command=', '-p', pids.join(',')]);
    const id = extractSessionIdFromCmdline(out);
    if (id) return id;
  }

  if (opts.soleArchitect) {
    return findLatestSessionId(workspacePath, { homeDir: opts.homeDir ?? homedir() });
  }
  return null;
}
