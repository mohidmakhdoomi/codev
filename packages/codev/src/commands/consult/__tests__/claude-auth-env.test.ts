import { describe, it, expect } from 'vitest';
import { buildClaudeConsultEnv } from '../index.js';

/**
 * Regression test for issue #985.
 *
 * `consult -m claude` must authenticate the Agent SDK with the Claude
 * subscription (`CLAUDE_CODE_OAUTH_TOKEN`) rather than the metered Opus API.
 * The SDK prioritizes `ANTHROPIC_API_KEY` over `CLAUDE_CODE_OAUTH_TOKEN`, so
 * when an OAuth token is present the API/auth tokens must be stripped from the
 * subprocess env. When no OAuth token is set, the API key must be preserved so
 * CI / key-only environments still authenticate.
 */
describe('buildClaudeConsultEnv (issue #985)', () => {
  it('strips ANTHROPIC_API_KEY/ANTHROPIC_AUTH_TOKEN when OAuth token is set', () => {
    const env = buildClaudeConsultEnv({
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-sub-token',
      ANTHROPIC_API_KEY: 'sk-metered-key',
      ANTHROPIC_AUTH_TOKEN: 'auth-token',
      PATH: '/usr/bin',
    });

    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    // OAuth token and unrelated vars are preserved.
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBe('oauth-sub-token');
    expect(env.PATH).toBe('/usr/bin');
  });

  it('preserves ANTHROPIC_API_KEY when no OAuth token is set (CI / key-only)', () => {
    const env = buildClaudeConsultEnv({
      ANTHROPIC_API_KEY: 'sk-metered-key',
      ANTHROPIC_AUTH_TOKEN: 'auth-token',
      PATH: '/usr/bin',
    });

    expect(env.ANTHROPIC_API_KEY).toBe('sk-metered-key');
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('auth-token');
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it('does not mutate the source process.env object', () => {
    const source: NodeJS.ProcessEnv = {
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-sub-token',
      ANTHROPIC_API_KEY: 'sk-metered-key',
      ANTHROPIC_AUTH_TOKEN: 'auth-token',
    };

    buildClaudeConsultEnv(source);

    // The deletion must be scoped to the returned copy, never the global env.
    expect(source.ANTHROPIC_API_KEY).toBe('sk-metered-key');
    expect(source.ANTHROPIC_AUTH_TOKEN).toBe('auth-token');
  });

  it('drops undefined values while copying', () => {
    const env = buildClaudeConsultEnv({
      DEFINED: 'yes',
      UNDEFINED: undefined,
    });

    expect(env.DEFINED).toBe('yes');
    expect('UNDEFINED' in env).toBe(false);
  });
});
