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

import { existsSync, readdirSync, statSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';

const JSONL_EXT = '.jsonl';

// Issue #832: fixed namespace for deriving deterministic per-architect Claude
// session IDs (UUIDv5). Never change this constant — it is the anchor that makes a
// given (workspace, architect-name) always map to the same session ID across
// restarts. It is an arbitrary, permanently-frozen random UUID.
const ARCHITECT_SESSION_NAMESPACE = 'b9d7f3a2-1c6e-4b8a-9f2d-7e5c3a1b0d84';

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
// Issue #832 — deterministic per-architect session IDs
//
// Named sibling architects (Spec 755) share `cwd = workspacePath`, so every
// sibling's jsonl lands in the same encoded-cwd directory and the newest-by-mtime
// heuristic above cannot attribute a file to a specific architect. Instead of
// storing a per-architect UUID, we DERIVE one deterministically from the
// architect's identity `(workspacePath, name)`. Because the name is part of the
// key, two architects sharing a cwd derive different IDs — the disambiguation the
// discovery heuristic can't provide — and the ID is recomputable at every
// spawn/revive surface with no persisted state.
//
// This coexists with findLatestSessionId: discovery is used where the cwd is
// unambiguous (builders have unique worktrees; a lone `main` has the workspace to
// itself), derived IDs where it isn't (siblings, multi-architect `main`).
// ============================================================================

function uuidBytes(uuid: string): Buffer {
  return Buffer.from(uuid.replace(/-/g, ''), 'hex');
}

function formatUuid(bytes: Buffer): string {
  const h = bytes.subarray(0, 16).toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/**
 * Derive a deterministic UUIDv5 Claude session ID for an architect from its
 * identity. Same `(workspacePath, name)` → same canonical-format UUID, forever.
 *
 * Uses `node:crypto` only (no `uuid` dependency): SHA-1 of the namespace bytes
 * concatenated with `"<workspacePath>:<name>"`, truncated to 16 bytes with the
 * version (5) and RFC-4122 variant bits set.
 */
export function architectSessionId(workspacePath: string, name: string): string {
  const digest = createHash('sha1')
    .update(Buffer.concat([uuidBytes(ARCHITECT_SESSION_NAMESPACE), Buffer.from(`${workspacePath}:${name}`, 'utf8')]))
    .digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC-4122 variant
  return formatUuid(bytes);
}

/**
 * Return true if a Claude session jsonl with the given ID exists for the given
 * cwd. Used to decide resume (`--resume`) vs fresh (`--session-id`): we never
 * issue `--resume` against a session whose jsonl is absent (pruned store, legacy
 * session, first run).
 *
 * `opts.homeDir` lets tests pin the home directory.
 */
export function sessionFileExists(
  workspacePath: string,
  sessionId: string,
  opts?: { homeDir?: string },
): boolean {
  const home = opts?.homeDir ?? homedir();
  const dir = join(home, '.claude', 'projects', encodeClaudeProjectDir(workspacePath));
  return existsSync(join(dir, `${sessionId}${JSONL_EXT}`));
}

/**
 * Delete the derived session jsonl for an architect, if present. Called when a
 * sibling is removed so that re-adding the same name starts a fresh conversation
 * rather than resurrecting the removed architect's (the ID being recomputable
 * would otherwise resume it). Best-effort; never throws.
 *
 * `opts.homeDir` lets tests pin the home directory.
 */
export function deleteArchitectSessionFile(
  workspacePath: string,
  name: string,
  opts?: { homeDir?: string },
): void {
  const home = opts?.homeDir ?? homedir();
  const id = architectSessionId(workspacePath, name);
  const file = join(home, '.claude', 'projects', encodeClaudeProjectDir(workspacePath), `${id}${JSONL_EXT}`);
  try {
    if (existsSync(file)) rmSync(file);
  } catch {
    // best-effort — a leftover jsonl is harmless (re-add will still derive the
    // same id; worst case it resumes, which a subsequent successful prune fixes)
  }
}
