/**
 * Unit tests for tower-utils.ts (Spec 0105 Phase 1)
 *
 * Tests: rate limiting, path normalization, temp directory detection,
 * workspace name extraction, MIME types, static file serving.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import { tmpdir } from 'node:os';

// We need to import the functions under test
import {
  isRateLimited,
  cleanupRateLimits,
  startRateLimitCleanup,
  normalizeWorkspacePath,
  isTempDirectory,
  serveStaticFile,
  resolveArchitectLaunch,
} from '../servers/tower-utils.js';
import {
  architectSessionId,
  encodeClaudeProjectDir,
} from '../utils/claude-session-discovery.js';

describe('tower-utils', () => {
  describe('isRateLimited', () => {
    beforeEach(() => {
      // Clean up rate limit state between tests
      cleanupRateLimits();
    });

    it('allows first request from a client', () => {
      expect(isRateLimited('192.168.1.1')).toBe(false);
    });

    it('allows multiple requests within limit', () => {
      for (let i = 0; i < 9; i++) {
        expect(isRateLimited('192.168.1.2')).toBe(false);
      }
    });

    it('blocks requests exceeding rate limit', () => {
      // First 10 requests should be allowed
      for (let i = 0; i < 10; i++) {
        isRateLimited('192.168.1.3');
      }
      // 11th should be blocked
      expect(isRateLimited('192.168.1.3')).toBe(true);
    });

    it('tracks clients independently', () => {
      // Exhaust limit for client A
      for (let i = 0; i < 10; i++) {
        isRateLimited('client-a');
      }
      expect(isRateLimited('client-a')).toBe(true);
      // Client B should still be allowed
      expect(isRateLimited('client-b')).toBe(false);
    });

    it('resets after window expires', () => {
      vi.useFakeTimers();
      try {
        // Exhaust limit
        for (let i = 0; i < 10; i++) {
          isRateLimited('192.168.1.4');
        }
        expect(isRateLimited('192.168.1.4')).toBe(true);

        // Advance past the 1-minute window
        vi.advanceTimersByTime(61_000);

        // Should be allowed again
        expect(isRateLimited('192.168.1.4')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('cleanupRateLimits', () => {
    it('removes stale entries', () => {
      vi.useFakeTimers();
      try {
        // Create an entry
        isRateLimited('stale-client');

        // Advance past 2x the window (cleanup threshold)
        vi.advanceTimersByTime(121_000);

        cleanupRateLimits();

        // After cleanup, the client should get a fresh window
        // (first request in new window = not limited)
        expect(isRateLimited('stale-client')).toBe(false);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('startRateLimitCleanup', () => {
    it('returns an interval handle', () => {
      vi.useFakeTimers();
      try {
        const handle = startRateLimitCleanup();
        expect(handle).toBeDefined();
        clearInterval(handle);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('normalizeWorkspacePath', () => {
    it('resolves existing paths with realpath', () => {
      // Use the current directory which exists
      const normalized = normalizeWorkspacePath('.');
      expect(path.isAbsolute(normalized)).toBe(true);
    });

    it('resolves non-existent paths with path.resolve', () => {
      const normalized = normalizeWorkspacePath('/nonexistent/path/to/workspace');
      expect(normalized).toBe('/nonexistent/path/to/workspace');
    });

    it('resolves relative paths', () => {
      const normalized = normalizeWorkspacePath('relative/path');
      expect(path.isAbsolute(normalized)).toBe(true);
    });
  });

  describe('isTempDirectory', () => {
    it('detects /tmp/ paths', () => {
      expect(isTempDirectory('/tmp/test-project')).toBe(true);
    });

    it('detects /private/tmp/ paths (macOS)', () => {
      expect(isTempDirectory('/private/tmp/test-project')).toBe(true);
    });

    it('detects OS tmpdir paths', () => {
      const tmp = tmpdir();
      expect(isTempDirectory(path.join(tmp, 'test-project'))).toBe(true);
    });

    it('rejects normal paths', () => {
      expect(isTempDirectory('/Users/dev/my-project')).toBe(false);
    });

    it('rejects paths that merely contain tmp', () => {
      expect(isTempDirectory('/Users/dev/tmp-stuff/project')).toBe(false);
    });
  });

  describe('serveStaticFile', () => {
    it('returns false for non-existent file', () => {
      const mockRes = {
        writeHead: vi.fn(),
        end: vi.fn(),
      };
      const result = serveStaticFile('/nonexistent/file.html', mockRes as any);
      expect(result).toBe(false);
      expect(mockRes.writeHead).not.toHaveBeenCalled();
    });

    it('serves existing file with correct MIME type', () => {
      // Create a temp file
      const tmpFile = path.join(tmpdir(), `test-${Date.now()}.html`);
      fs.writeFileSync(tmpFile, '<html>test</html>');

      try {
        const mockRes = {
          writeHead: vi.fn(),
          end: vi.fn(),
        };
        const result = serveStaticFile(tmpFile, mockRes as any);
        expect(result).toBe(true);
        expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'text/html' });
        expect(mockRes.end).toHaveBeenCalled();
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });

    it('uses application/octet-stream for unknown extensions', () => {
      const tmpFile = path.join(tmpdir(), `test-${Date.now()}.xyz`);
      fs.writeFileSync(tmpFile, 'data');

      try {
        const mockRes = {
          writeHead: vi.fn(),
          end: vi.fn(),
        };
        serveStaticFile(tmpFile, mockRes as any);
        expect(mockRes.writeHead).toHaveBeenCalledWith(200, { 'Content-Type': 'application/octet-stream' });
      } finally {
        fs.unlinkSync(tmpFile);
      }
    });
  });
});

describe('resolveArchitectLaunch (Issue #832)', () => {
  let fakeHome: string;
  let workspace: string;
  let canonical: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    fakeHome = fs.mkdtempSync(path.join(tmpdir(), 'ral-home-'));
    workspace = fs.mkdtempSync(path.join(tmpdir(), 'ral-ws-'));
    // resolveArchitectLaunch canonicalises via realpath; mirror that so we seed
    // jsonls under the same encoded-cwd it will look in.
    canonical = fs.realpathSync(workspace);
    process.env.HOME = fakeHome;
    fs.mkdirSync(path.join(fakeHome, '.claude', 'projects'), { recursive: true });
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    fs.rmSync(fakeHome, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });

  function seedSession(uuid: string): void {
    const dir = path.join(fakeHome, '.claude', 'projects', encodeClaudeProjectDir(canonical));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${uuid}.jsonl`), `{"sessionId":"${uuid}"}\n`);
  }

  it('resumes the derived id (no role injection) when its jsonl exists', () => {
    const id = architectSessionId(canonical, 'reviewer');
    seedSession(id);
    const { args, env } = resolveArchitectLaunch({ workspacePath: workspace, name: 'reviewer', baseArgs: [] });
    expect(args).toEqual(['--resume', id]);
    expect(env).toEqual({});
  });

  it('spawns fresh with --session-id at the derived id when no jsonl exists', () => {
    const id = architectSessionId(canonical, 'reviewer');
    const { args } = resolveArchitectLaunch({ workspacePath: workspace, name: 'reviewer', baseArgs: [] });
    expect(args).not.toContain('--resume');
    expect(args).toContain('--session-id');
    expect(args[args.indexOf('--session-id') + 1]).toBe(id);
  });

  it('does NOT consult discovery without discoveryFallback (sibling-safe)', () => {
    // A legacy random-id session exists in the shared cwd, but a sibling must not
    // attach to it — only its own derived id (which has no jsonl) → fresh.
    seedSession('legacy-random-id');
    const id = architectSessionId(canonical, 'reviewer');
    const { args } = resolveArchitectLaunch({ workspacePath: workspace, name: 'reviewer', baseArgs: [] });
    expect(args).not.toContain('--resume');
    expect(args[args.indexOf('--session-id') + 1]).toBe(id);
  });

  it('with discoveryFallback, resumes a legacy session when no derived jsonl exists (lone main)', () => {
    seedSession('legacy-random-id');
    const { args, env } = resolveArchitectLaunch({
      workspacePath: workspace, name: 'main', baseArgs: [], discoveryFallback: true,
    });
    expect(args).toEqual(['--resume', 'legacy-random-id']);
    expect(env).toEqual({});
  });

  it('prefers the derived id over the discovery fallback when both exist', () => {
    const id = architectSessionId(canonical, 'main');
    seedSession('legacy-random-id');
    seedSession(id);
    const { args } = resolveArchitectLaunch({
      workspacePath: workspace, name: 'main', baseArgs: [], discoveryFallback: true,
    });
    expect(args).toEqual(['--resume', id]);
  });

  it('main resumes its OWN derived id in a multi-architect workspace (discoveryFallback off)', () => {
    // With siblings present, launchInstance calls the helper WITHOUT
    // discoveryFallback; main must resume its derived id (the recovery the old
    // safeToResume guard had to skip), never a sibling's session.
    const mainId = architectSessionId(canonical, 'main');
    seedSession(mainId);
    seedSession(architectSessionId(canonical, 'reviewer'));
    const { args } = resolveArchitectLaunch({ workspacePath: workspace, name: 'main', baseArgs: [] });
    expect(args).toEqual(['--resume', mainId]);
  });

  it('two siblings in the same cwd resolve to distinct derived ids (no cross-attachment)', () => {
    const reviewerId = architectSessionId(canonical, 'reviewer');
    const casaId = architectSessionId(canonical, 'casa');
    seedSession(reviewerId);
    seedSession(casaId);
    const reviewer = resolveArchitectLaunch({ workspacePath: workspace, name: 'reviewer', baseArgs: [] });
    const casa = resolveArchitectLaunch({ workspacePath: workspace, name: 'casa', baseArgs: [] });
    expect(reviewer.args).toEqual(['--resume', reviewerId]);
    expect(casa.args).toEqual(['--resume', casaId]);
    expect(reviewerId).not.toBe(casaId);
  });
});
