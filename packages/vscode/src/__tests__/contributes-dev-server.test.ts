/**
 * Contributes invariants for the Codev Dev surface (#921):
 * - the `codev.devServer` view is the real tab in #812's `codevPanel` container;
 * - extension.ts flips `codev.panelContainerEmpty` false (so #812's placeholder
 *   yields) and registers the view + the chip refresh;
 * - the four title-bar actions are declared with icons and the right `when`
 *   gating (Stop/Restart only while running; Switch/Reveal always).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const PKG = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8'));
const EXT_SRC = readFileSync(resolve(ROOT, 'src/extension.ts'), 'utf8');

interface View { id: string; name: string; when?: string }
interface Menu { command: string; when?: string; group?: string }
interface Command { command: string; title: string; icon?: string }

const views = PKG.contributes.views as Record<string, View[]>;
const titleMenus = (PKG.contributes.menus['view/title'] ?? []) as Menu[];
const commands = PKG.contributes.commands as Command[];

describe('codev.devServer view (#921)', () => {
  it('lives in the codevPanel container with the title "Codev Dev"', () => {
    const dev = (views.codevPanel ?? []).find((v) => v.id === 'codev.devServer');
    expect(dev).toBeDefined();
    expect(dev!.name).toBe('Codev Dev');
    // Always present (no `when`), so the container is never empty.
    expect(dev!.when).toBeUndefined();
  });
});

describe('codev.devServer title-bar actions (#921)', () => {
  const action = (command: string) => titleMenus.find((m) => m.command === command);

  it('declares Stop/Restart gated on a running dev', () => {
    for (const cmd of ['codev.devServer.stop', 'codev.devServer.restart']) {
      expect(action(cmd)?.when).toBe('view == codev.devServer && codev.devServerRunning');
    }
  });

  it('declares Switch Target and Reveal shown whenever the view is active', () => {
    for (const cmd of ['codev.devServer.switchTarget', 'codev.devServer.revealInWorkspace']) {
      expect(action(cmd)?.when).toBe('view == codev.devServer');
    }
  });

  it('gives each action an icon', () => {
    const byId = Object.fromEntries(commands.map((c) => [c.command, c]));
    expect(byId['codev.devServer.stop']?.icon).toBe('$(debug-stop)');
    expect(byId['codev.devServer.restart']?.icon).toBe('$(debug-restart)');
    expect(byId['codev.devServer.switchTarget']?.icon).toBe('$(arrow-swap)');
    expect(byId['codev.devServer.revealInWorkspace']?.icon).toBe('$(eye)');
  });
});

describe('extension.ts wiring (#921)', () => {
  it('registers the dev-server tree view', () => {
    expect(EXT_SRC).toMatch(
      /registerTreeDataProvider\(['"]codev\.devServer['"], devServerProvider\)/,
    );
  });

  it('drives the chip + devServerRunning context key off the dev-terminal event', () => {
    expect(EXT_SRC).toMatch(/onDidChangeDevTerminals\(refreshDevSurface\)/);
    expect(EXT_SRC).toMatch(/setContext['"],\s*['"]codev\.devServerRunning['"]/);
  });
});
