import { defineConfig } from 'vitest/config';

/**
 * Spec 786 Phase 6: vitest config for unit-level tests of VSCode extension
 * code. The existing `src/test/` suite uses `vscode-test` (an Electron
 * harness) for integration tests; this config covers pure-logic units that
 * mock the `vscode` module entirely. Two separate harnesses: each does what
 * it does well.
 *
 * Test files live under `src/__tests__/` (kept distinct from `src/test/`
 * which is the vscode-test integration suite).
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/__tests__/**/*.test.ts'],
  },
});
