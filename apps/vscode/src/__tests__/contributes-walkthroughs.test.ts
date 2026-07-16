/**
 * Invariants for the `Get started with Codev` walkthrough contribution (#791):
 * the walkthrough is declared, every step references a markdown file that
 * actually ships, and the recheck command the Verify step relies on exists.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));

interface WalkthroughStep {
  id: string;
  media?: { markdown?: string };
  completionEvents?: string[];
}
interface Walkthrough {
  id: string;
  title: string;
  steps: WalkthroughStep[];
}

const walkthroughs: Walkthrough[] = PKG.contributes.walkthroughs ?? [];
const gettingStarted = walkthroughs.find((w) => w.id === 'codevGettingStarted');
const commands: Array<{ command: string }> = PKG.contributes.commands;

describe('codevGettingStarted walkthrough', () => {
  it('is contributed', () => {
    expect(gettingStarted).toBeDefined();
    expect(gettingStarted!.title).toBe('Get started with Codev');
  });

  it('has detect / install / verify steps', () => {
    const ids = gettingStarted!.steps.map((s) => s.id);
    expect(ids).toEqual(['detect', 'install', 'verify']);
  });

  it('ships every step markdown file referenced', () => {
    for (const step of gettingStarted!.steps) {
      const md = step.media?.markdown;
      expect(md, `step ${step.id} should reference a markdown file`).toBeTruthy();
      expect(existsSync(resolve(ROOT, md!)), `${md} should exist on disk`).toBe(true);
    }
  });

  it('declares codev.recheckCli and completes Verify on the cliReady context', () => {
    expect(commands.some((c) => c.command === 'codev.recheckCli')).toBe(true);
    const verify = gettingStarted!.steps.find((s) => s.id === 'verify');
    // Completes only when the CLI is genuinely OK (preflight sets the context
    // key), not merely when a recheck was attempted.
    expect(verify!.completionEvents).toContain('onContext:codev.cliReady');
  });

  it('links the recheck command from the Verify step markdown', () => {
    const verify = gettingStarted!.steps.find((s) => s.id === 'verify');
    const body = readFileSync(resolve(ROOT, verify!.media!.markdown!), 'utf8');
    expect(body).toContain('command:codev.recheckCli');
  });
});
