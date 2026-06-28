/**
 * Utility functions for tower server.
 * Spec 0105: Tower Server Decomposition — Phase 1
 *
 * Contains: rate limiting, path normalization, temp directory detection,
 * workspace name extraction, MIME types, and static file serving.
 */

import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import type { ServerResponse } from 'node:http';
import type { RateLimitEntry } from './tower-types.js';
import { loadRolePrompt, type RoleConfig } from '../utils/roles.js';
import { getArchitectHarness } from '../utils/config.js';
import {
  architectSessionId,
  sessionFileExists,
  findLatestSessionId,
} from '../utils/claude-session-discovery.js';

// ============================================================================
// Rate Limiting
// ============================================================================

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX = 10;

const activationRateLimits = new Map<string, RateLimitEntry>();

/**
 * Check if a client has exceeded the rate limit for activations.
 * Returns true if rate limit exceeded, false if allowed.
 */
export function isRateLimited(clientIp: string): boolean {
  const now = Date.now();
  const entry = activationRateLimits.get(clientIp);

  if (!entry || now - entry.windowStart >= RATE_LIMIT_WINDOW_MS) {
    // New window
    activationRateLimits.set(clientIp, { count: 1, windowStart: now });
    return false;
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    return true;
  }

  entry.count++;
  return false;
}

/**
 * Clean up old rate limit entries.
 */
export function cleanupRateLimits(): void {
  const now = Date.now();
  for (const [ip, entry] of activationRateLimits.entries()) {
    if (now - entry.windowStart >= RATE_LIMIT_WINDOW_MS * 2) {
      activationRateLimits.delete(ip);
    }
  }
}

/**
 * Start periodic cleanup of stale rate limit entries.
 * Returns the interval handle so the orchestrator can clear it on shutdown.
 */
export function startRateLimitCleanup(): ReturnType<typeof setInterval> {
  return setInterval(cleanupRateLimits, 5 * 60 * 1000);
}

// ============================================================================
// Path Utilities
// ============================================================================

/**
 * Normalize a workspace path to its canonical form for consistent SQLite storage.
 * Uses realpath to resolve symlinks and relative paths.
 */
export function normalizeWorkspacePath(workspacePath: string): string {
  try {
    return fs.realpathSync(workspacePath);
  } catch {
    // Path doesn't exist yet, normalize without realpath
    return path.resolve(workspacePath);
  }
}

/**
 * Get workspace name from path.
 */
export function getWorkspaceName(workspacePath: string): string {
  return path.basename(workspacePath);
}

// Resolve once at module load: both symlinked and real temp dir paths
const _tmpDir = tmpdir();
const _tmpDirResolved = (() => {
  try {
    return fs.realpathSync(_tmpDir);
  } catch {
    return _tmpDir;
  }
})();

/**
 * Check if a workspace path points to a temp directory.
 */
export function isTempDirectory(workspacePath: string): boolean {
  return (
    workspacePath.startsWith(_tmpDir + '/') ||
    workspacePath.startsWith(_tmpDirResolved + '/') ||
    workspacePath.startsWith('/tmp/') ||
    workspacePath.startsWith('/private/tmp/')
  );
}

// ============================================================================
// Language & MIME Detection
// ============================================================================

/**
 * Get language identifier for syntax highlighting.
 */
export function getLanguageForExt(ext: string): string {
  const langMap: Record<string, string> = {
    js: 'javascript', ts: 'typescript', jsx: 'javascript', tsx: 'typescript',
    py: 'python', sh: 'bash', bash: 'bash', md: 'markdown',
    html: 'markup', css: 'css', json: 'json', yaml: 'yaml', yml: 'yaml',
    rs: 'rust', go: 'go', java: 'java', c: 'c', cpp: 'cpp', h: 'c',
  };
  return langMap[ext] || ext || 'plaintext';
}

/**
 * Get MIME type for a file path (by extension).
 */
export function getMimeTypeForFile(filePath: string): string {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  const mimeTypes: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
    pdf: 'application/pdf', txt: 'text/plain',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

// ============================================================================
// Static File Serving
// ============================================================================

/** MIME types for static file serving */
export const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json',
};

// ============================================================================
// Architect Role Prompt
// ============================================================================

/**
 * Build architect command args with role prompt injected via harness provider.
 * Writes the role to .architect-role.md in the workspace dir and uses the
 * configured harness to determine the correct CLI args and env vars.
 * Returns args and env for the caller to merge into session creation.
 */
export function buildArchitectArgs(baseArgs: string[], workspacePath: string): { args: string[]; env: Record<string, string> } {
  const codevDir = path.join(workspacePath, 'codev');
  const bundledRolesDir = path.resolve(import.meta.dirname, '../../../skeleton/roles');
  const config: RoleConfig = { codevDir, bundledRolesDir, workspaceRoot: workspacePath };

  const role = loadRolePrompt(config, 'architect');
  if (!role) return { args: baseArgs, env: {} };

  const roleFile = path.join(workspacePath, '.architect-role.md');
  fs.writeFileSync(roleFile, role.content);

  const harness = getArchitectHarness(workspacePath);
  const injection = harness.buildRoleInjection(role.content, roleFile);

  return {
    args: [...baseArgs, ...injection.args],
    env: injection.env,
  };
}

/**
 * Issue #832: resolve the args/env to launch (or revive) an architect, choosing
 * between resuming a prior Claude conversation and starting fresh.
 *
 * Decision order:
 *   1. The architect's DERIVED session id (a pure function of `(workspacePath,
 *      name)`) already has a jsonl on disk → `--resume <derivedId>`, skip role
 *      injection (the saved conversation already holds the role/system prompt).
 *   2. `discoveryFallback` set (lone `main` only — see callers) and #830's
 *      newest-by-mtime discovery finds a prior session → `--resume <legacyId>`.
 *      This preserves recovery of `main`'s existing (pre-#832, random-id)
 *      conversation in single-architect workspaces with no context loss.
 *   3. Otherwise → fresh: create the session AT the derived id via
 *      `--session-id <derivedId>`, with role injection, so the next revival finds
 *      it and resumes.
 *
 * `discoveryFallback` is only safe where the cwd unambiguously belongs to one
 * architect (a lone `main`). Siblings share the workspace cwd, so discovery
 * cannot attribute a jsonl to them — they always use the derived id.
 *
 * `workspacePath` is canonicalised (realpath) so the derived id and the
 * existence check key off the same physical path Claude uses as its cwd,
 * regardless of whether the caller passed a symlinked path.
 */
export function resolveArchitectLaunch(opts: {
  workspacePath: string;
  name: string;
  baseArgs: string[];
  discoveryFallback?: boolean;
}): { args: string[]; env: Record<string, string> } {
  const { workspacePath, name, baseArgs, discoveryFallback } = opts;

  let canonical = workspacePath;
  try {
    canonical = fs.realpathSync(workspacePath);
  } catch {
    // Path may not exist yet (fresh) — fall back to the raw value.
  }

  const derivedId = architectSessionId(canonical, name);
  if (sessionFileExists(canonical, derivedId)) {
    return { args: [...baseArgs, '--resume', derivedId], env: {} };
  }

  if (discoveryFallback) {
    const legacyId = findLatestSessionId(canonical);
    if (legacyId) {
      return { args: [...baseArgs, '--resume', legacyId], env: {} };
    }
  }

  // Fresh: build the role-injected args, then pin the new session to the derived
  // id so subsequent revivals resume it. `--session-id` precedes the injection
  // flags by being part of baseArgs.
  return buildArchitectArgs([...baseArgs, '--session-id', derivedId], workspacePath);
}

/**
 * Serve a static file from the React dashboard dist.
 * Returns true if the file was served, false otherwise.
 */
export function serveStaticFile(filePath: string, res: ServerResponse): boolean {
  if (!fs.existsSync(filePath)) {
    return false;
  }

  const ext = path.extname(filePath);
  const contentType = MIME_TYPES[ext] || 'application/octet-stream';

  try {
    const content = fs.readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
    return true;
  } catch {
    return false;
  }
}
