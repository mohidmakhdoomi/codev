// Discover the most-recent Claude conversation session for a given working
// directory by inspecting Claude Code's on-disk session store.
//
// Claude Code automatically persists every interactive session to
//   ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl
// where the encoding replaces both '/' and '.' in the absolute path with '-'.
// We use the newest jsonl by mtime as a stand-in for "the last conversation
// that ran in this directory" so reviving a dead builder can resume via
// `claude --resume <uuid>` without any spawn-time bookkeeping.
//
// Because the encoding is lossy ('/' and '.' collapse to the same character),
// two different paths can collide into one store directory. Every candidate is
// therefore verified against the `cwd` the session itself recorded (Issue
// #1145): a jsonl whose recorded cwd does not match the requested path is
// skipped, as is one that never recorded a cwd at all (a session with no user
// message has nothing worth resuming).
//
// This remains a heuristic for shared cwds — multiple matching jsonls mean
// multiple past sessions in the same directory, and we pick the most recent.
// For builder worktrees that almost always means the right one; architect
// launch no longer uses discovery at all (Issue #1145).

import { closeSync, existsSync, openSync, readdirSync, readSync, statSync } from 'node:fs';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';

const JSONL_EXT = '.jsonl';

// Chunk size for the streaming cwd scan. The scan is semantic, not positional:
// it reads chunk by chunk until the first record carrying a `cwd` (or EOF), so
// ownership never depends on the byte offset the record happens to sit at.
// Real sessions record cwd on the first user message, so one chunk suffices.
const CWD_SCAN_CHUNK_BYTES = 64 * 1024;

// A single buffered line larger than this is dropped un-parsed (scanning
// continues on later records). Only guards runaway memory on pathological
// files; every user record carries a cwd, so a later one still qualifies.
const CWD_SCAN_MAX_LINE_BYTES = 8 * 1024 * 1024;

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

/** Canonicalize a path for comparison; fall back to the input when realpath fails. */
function realpathOrSelf(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return p;
  }
}

/** Parse one jsonl line and return its top-level `cwd`, or null. */
function parseCwdLine(line: string): string | null {
  if (!line.includes('"cwd"')) return null;
  try {
    const record = JSON.parse(line) as { cwd?: unknown };
    if (typeof record.cwd === 'string' && record.cwd.length > 0) {
      return record.cwd;
    }
  } catch {
    // Malformed or fragmentary line — skip.
  }
  return null;
}

/**
 * Read the `cwd` a session jsonl recorded, or null if the session never
 * recorded one. Session files interleave metadata records (mode,
 * file-history-snapshot, ...) with message records; the first user record
 * carries the launch cwd. Streams the file chunk by chunk with early exit,
 * so the result depends only on the file's records, never on their offsets.
 */
export function readSessionCwd(filePath: string): string | null {
  let fd: number;
  try {
    fd = openSync(filePath, 'r');
  } catch {
    return null;
  }

  try {
    const chunk = Buffer.alloc(CWD_SCAN_CHUNK_BYTES);
    const decoder = new StringDecoder('utf8');
    let carry = '';
    let position = 0;

    for (;;) {
      const bytesRead = readSync(fd, chunk, 0, CWD_SCAN_CHUNK_BYTES, position);
      if (bytesRead <= 0) break;
      position += bytesRead;
      carry += decoder.write(chunk.subarray(0, bytesRead));

      let newlineIdx = carry.indexOf('\n');
      while (newlineIdx !== -1) {
        const cwd = parseCwdLine(carry.slice(0, newlineIdx));
        if (cwd) return cwd;
        carry = carry.slice(newlineIdx + 1);
        newlineIdx = carry.indexOf('\n');
      }

      if (carry.length > CWD_SCAN_MAX_LINE_BYTES) {
        // Oversized record: drop the buffered prefix and keep scanning. The
        // remainder of this line arrives in later chunks and fails JSON.parse
        // as a fragment, which parseCwdLine skips harmlessly.
        carry = '';
      }
    }

    // Final line without a trailing newline.
    return parseCwdLine(carry + decoder.end());
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/**
 * True when the session jsonl's recorded cwd matches `absolutePath` (both
 * sides realpath-canonicalized, so symlinked launch paths compare equal).
 */
function sessionFileOwnedBy(filePath: string, absolutePath: string): boolean {
  const recordedCwd = readSessionCwd(filePath);
  if (!recordedCwd) return false;
  return realpathOrSelf(recordedCwd) === realpathOrSelf(absolutePath);
}

/**
 * Return the session UUID of the most-recently-modified jsonl in the Claude
 * project dir for the given cwd whose recorded cwd actually matches that path
 * (Issue #1145 ownership check), or null if none qualifies.
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

  const candidates: Array<{ name: string; mtime: number }> = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith(JSONL_EXT)) continue;
    const fullPath = join(dir, entry.name);
    try {
      candidates.push({ name: entry.name, mtime: statSync(fullPath).mtimeMs });
    } catch {
      // stat failed (race with deletion, permissions) — skip
    }
  }

  candidates.sort((a, b) => b.mtime - a.mtime);

  for (const candidate of candidates) {
    if (sessionFileOwnedBy(join(dir, candidate.name), absolutePath)) {
      return candidate.name.slice(0, -JSONL_EXT.length);
    }
  }
  return null;
}

/**
 * Verify that a specific session id belongs to `absolutePath` (Issue #1145):
 * its jsonl must exist in the cwd-encoded project dir AND its recorded cwd
 * must match. Used before resuming a *stored* session id, so a stale or
 * foreign id degrades to a fresh spawn instead of attaching to someone
 * else's conversation.
 */
export function verifySessionOwnership(
  absolutePath: string,
  sessionId: string,
  opts?: { homeDir?: string },
): boolean {
  const home = opts?.homeDir ?? homedir();
  // Claude keys the store dir by its process cwd, which the OS may report in
  // physical (symlink-resolved) form — e.g. /tmp/ws vs /private/tmp/ws on
  // macOS. Accept the session under either encoding of the same directory.
  const candidateDirs = new Set([
    encodeClaudeProjectDir(absolutePath),
    encodeClaudeProjectDir(realpathOrSelf(absolutePath)),
  ]);
  for (const dir of candidateDirs) {
    const filePath = join(home, '.claude', 'projects', dir, `${sessionId}${JSONL_EXT}`);
    if (existsSync(filePath) && sessionFileOwnedBy(filePath, absolutePath)) {
      return true;
    }
  }
  return false;
}
